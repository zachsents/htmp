import fs from "node:fs/promises"
import path from "node:path"
import type { Attributes, Content, Node, NodeTag } from "posthtml-parser"
import { render } from "posthtml-render"
import * as prettier from "prettier"
import { parseHtml } from "./lib/parser"

export interface HTempCompileOptions {
    /**
     * Optional object containing components. These will take precedence over
     * files in the componentsRoot.
     */
    components?: Record<string, string>
    /**
     * Where to look for components, which are just .html files.
     * Defaults to "./components"
     */
    componentsRoot?: string
    /**
     * The prefix to use for component tags.
     * Defaults to "x-"
     */
    componentTagPrefix?: string
    /**
     * The tag to use for yields.
     * Defaults to "yield"
     */
    yieldTag?: string
    /**
     * Whether to pretty-print the output. Uses prettier.
     * Defaults to true
     */
    pretty?: boolean
    /**
     * The attribute to use for passing attributes to components.
     * Defaults to "attr"
     */
    attrAttribute?: string
    /**
     * The tag to use for defining slots.
     * Defaults to "slot"
     */
    defineSlotTag?: string
    /**
     * The tag to use for filling slots.
     * Defaults to "fill"
     */
    fillSlotTag?: string
    /**
     * The tag to use for defining stacks.
     * Defaults to "stack"
     */
    stackTag?: string
    /**
     * The tag to use for pushing to stacks.
     * Defaults to "push"
     */
    pushTag?: string
    /**
     * The prefix for attributes that will be evaluated as
     * JavaScript.
     * Defaults to "eval"
     */
    evaluateAttributePrefix?: string
    /**
     * The pattern used to select content for evaluation.
     * The JS code should be contained in the first capture
     * group.
     * Defaults to `/%%(.+?)%%/g`
     */
    evaluateContentPattern?: RegExp
    /**
     * The tag used for dynamic content.
     * Defaults to "dynamic"
     */
    dynamicTag?: string
}

export async function compile(
    html: string,
    {
        components: componentsOverride = {},
        componentsRoot = "./components",
        componentTagPrefix = "x-",
        yieldTag = "yield",
        pretty = true,
        attrAttribute = "attr",
        defineSlotTag = "slot",
        fillSlotTag = "fill",
        stackTag = "stack",
        pushTag = "push",
        evaluateAttributePrefix = "eval",
        evaluateContentPattern = /%%(.+?)%%/g,
        dynamicTag = "dynamic",
    }: HTempCompileOptions = {},
) {
    let tree = parseHtml(html)

    // initialize component cache
    const componentContentCache = new Map<string, string>(
        Object.entries(componentsOverride).map(([k, v]) => {
            const kebabKey =
                k
                    .match(/[a-z]+|[A-Z][a-z]+|[A-Z]+|\d+/g)
                    ?.join("-")
                    .toLowerCase() ?? ""
            return [kebabKey, v] as const
        }),
    )

    // Do initial evaluations
    const evaluationOptions = {
        evaluateAttributePrefix,
        evaluateContentPattern,
        dynamicTag,
    }
    tree = await expandEvaluations(tree, evaluationOptions)

    // Components
    tree = await walkTags(tree, async n => {
        // not a component -- skip
        if (!n.tag.startsWith(componentTagPrefix)) return n

        const componentName = n.tag.slice(componentTagPrefix.length)

        // component -- load, parse, and expand
        if (!componentContentCache.has(componentName)) {
            const componentPath = path.join(
                componentsRoot,
                `${componentName.replaceAll(".", path.sep)}.html`,
            )
            try {
                const componentContent = await fs.readFile(
                    componentPath,
                    "utf8",
                )
                componentContentCache.set(componentName, componentContent)
            } catch (err) {
                if (
                    typeof err === "object" &&
                    err != null &&
                    "code" in err &&
                    err.code === "ENOENT"
                )
                    throw new Error(`Component not found: ${n.tag}`)
                throw err
            }
        }

        let componentTree = parseHtml(componentContentCache.get(componentName)!)

        // do evaluations
        componentTree = await expandEvaluations(
            componentTree,
            evaluationOptions,
        )

        // organize attributes into a map
        const attrMap: Record<string, Attributes> = {}
        for (const [k, v] of Object.entries(n.attrs ?? {})) {
            const { isMatch, segments } = colonMatch(3, k)
            if (isMatch && segments[0] === attrAttribute) {
                // assign to attribute slot
                attrMap[segments[1]] ??= {}
                attrMap[segments[1]][segments[2]] = v
            } else {
                // default attribute slot
                attrMap[""] ??= {}
                attrMap[""][k] = v
            }
        }

        // pass attributes through to component
        let foundDefaultAttributeTarget = false
        componentTree = await walkTags(componentTree, n2 => {
            // true aliases to default slot -- not sure if this ever happens in practice
            if (n2.attrs?.[attrAttribute] === true) n2.attrs[attrAttribute] = ""

            // now we're only willing to deal with strings
            if (!(typeof n2.attrs?.[attrAttribute] === "string")) return n2

            const attrVal = n2.attrs[attrAttribute]
            if (attrVal === "") foundDefaultAttributeTarget = true
            delete n2.attrs[attrAttribute]
            if (attrMap[attrVal]) Object.assign(n2.attrs, attrMap[attrVal])

            return n2
        })

        // add attributes to first tag if no default slot was found
        if (!foundDefaultAttributeTarget && attrMap[""]) {
            const firstTag = onlyTags(componentTree)[0]
            if (firstTag) {
                firstTag.attrs ??= {}
                Object.assign(firstTag.attrs, attrMap[""])
            }
        }

        // organize content into slots and yields
        let yieldContent: Node[] | undefined
        const slotContent: Record<string, Node[] | undefined> = {}
        for (const contentNode of normalizeContent(n.content)) {
            if (isTagNode(contentNode) && typeof contentNode.tag === "string") {
                const { isMatch, segments } = colonMatch(2, contentNode.tag)

                if (isMatch && segments[0] === fillSlotTag) {
                    slotContent[segments[1]] ??= []
                    slotContent[segments[1]]!.push(
                        ...normalizeContent(contentNode.content),
                    )
                    continue
                }
            }
            yieldContent ??= []
            yieldContent.push(contentNode)
        }

        // pass content through to slots and yields
        componentTree = await walkTags(componentTree, async n2 => {
            if (n2.tag === yieldTag)
                return { tag: false, content: yieldContent ?? n2.content }

            const { isMatch, segments } = colonMatch(2, n2.tag)
            if (isMatch && segments[0] === defineSlotTag) {
                return {
                    tag: false,
                    content: slotContent[segments[1]] ?? n2.content,
                }
            }

            return n2
        })

        return componentTree
    })

    // Stacks
    const stackContent: Record<string, Node[]> = {}

    // find all pushes first
    tree = await walkByTag(tree, pushTag, n => {
        const stackName = n.attrs?.stack
        if (!stackName) throw new Error("Push tag must have a stack attribute")
        if (typeof stackName !== "string")
            throw new Error("Push tag stack attribute must be a string")

        stackContent[stackName] ??= []

        // make set of ids in stack -- optimization over checking every iteration...i think
        const idSet = stackContent[stackName].reduce((set, n) => {
            if (hasStringAttribute(n, "id") && n.attrs.id) set.add(n.attrs.id)
            return set
        }, new Set<string>())

        // only push content if the id is not already in the stack
        for (const n2 of normalizeContent(n.content)) {
            if (hasStringAttribute(n2, "id") && n2.attrs.id) {
                if (idSet.has(n2.attrs.id)) continue
                idSet.add(n2.attrs.id)
            }
            stackContent[stackName].push(n2)
        }

        return []
    })

    // then insert the pushed content into the stack
    tree = await walkByTag(tree, stackTag, n => {
        const stackName = n.attrs?.name
        if (!stackName) throw new Error("Stack tag must have a name attribute")
        if (typeof stackName !== "string")
            throw new Error("Stack tag name attribute must be a string")

        return stackContent[stackName] ?? []
    })

    let renderedHtml = render(tree)

    if (pretty)
        renderedHtml = await prettier.format(renderedHtml, { parser: "html" })

    return renderedHtml
}

export class HTempCompiler {
    constructor(private options: HTempCompileOptions) {}

    async compile(html: string, options?: Partial<HTempCompileOptions>) {
        return compile(html, {
            ...this.options,
            ...options,
        })
    }
}

/**
 * Expands all evaluations for the tree.
 *
 * We have this as a separate function because it'll need
 * to be done both on the initial tree and on loaded
 * components. It needs to happen before any attribute merging
 * to accomodate custom merge strategies.
 */
async function expandEvaluations(
    tree: Node[],
    options: Required<
        Pick<
            HTempCompileOptions,
            "evaluateAttributePrefix" | "evaluateContentPattern" | "dynamicTag"
        >
    >,
): Promise<Node[]> {
    let newTree = await walk(tree, n => {
        // evaluate attributes
        if (isTagNode(n) && typeof n.tag === "string" && n.attrs) {
            for (const [k, v] of Object.entries(n.attrs)) {
                if (typeof v !== "string") continue

                const { isMatch, segments } = colonMatch(2, k)
                if (!isMatch || segments[0] !== options.evaluateAttributePrefix)
                    continue

                delete n.attrs[k]
                const evaluatedResult = indirectEval(v)

                // skip if result is false or null
                if (evaluatedResult === false || evaluatedResult == null)
                    continue

                // true is an empty but included attribute
                if (evaluatedResult === true) n.attrs[segments[1]] = true
                // otherwise, just try to make it a string
                else n.attrs[segments[1]] = `${evaluatedResult}`
            }
        }

        if (typeof n !== "string") return n

        // evaluate content
        return n.replaceAll(options.evaluateContentPattern, (_, code) => {
            const evaluatedResult = indirectEval(code)
            // skip if result is false or null
            if (evaluatedResult === false || evaluatedResult == null) return ""
            // otherwise, just try to make it a string
            return `${evaluatedResult}`
        })
    })

    const conditionalTagsThatShouldTrigger = new Set<NodeTagWithTag>()

    // other evaluations
    newTree = await walkTags(newTree, (n, i, arr) => {
        // dynamic tags
        if (n.tag === options.dynamicTag) {
            if (!hasStringAttribute(n, "tag"))
                throw new Error("Dynamic tag must have a tag attribute")

            const evaluatedResult = indirectEval(n.attrs.tag)

            if (evaluatedResult == null || evaluatedResult === false)
                return { tag: false, content: n.content }

            if (
                typeof evaluatedResult === "string" &&
                /^\S+$/.test(evaluatedResult)
            ) {
                n.tag = evaluatedResult
                delete (n.attrs as Partial<typeof n.attrs>).tag
                return n
            }

            throw new Error(
                "Dynamic tag tag attribute must evaluate to a string (with no spaces), nullish, or false.",
            )
        }

        // conditional tags
        if (n.tag === "if") {
            if (!hasStringAttribute(n, "condition"))
                throw new Error(
                    "Conditional tag must have a condition attribute",
                )

            const evaluatedResult = indirectEval(n.attrs.condition)

            // short-circuit truthy case
            if (evaluatedResult) return { tag: false, content: n.content }

            // set up to check for else-ifs and elses
            const nextNode = arr.at(i + 1)
            if (nextNode && ["elseif", "else"].includes(nextNode.tag)) {
                conditionalTagsThatShouldTrigger.add(nextNode)
            }

            return []
        }
        if (n.tag === "elseif") {
            if (!hasStringAttribute(n, "condition"))
                throw new Error(
                    "Conditional tag must have a condition attribute",
                )

            if (!conditionalTagsThatShouldTrigger.has(n)) return []

            const evaluatedResult = indirectEval(n.attrs.condition)

            // short-circuit truthy case
            if (evaluatedResult) return { tag: false, content: n.content }

            // set up to check for else-ifs and elses
            const nextNode = arr.at(i + 1)
            if (nextNode && ["elseif", "else"].includes(nextNode.tag)) {
                conditionalTagsThatShouldTrigger.add(nextNode)
            }

            return []
        }
        if (n.tag === "else") {
            return conditionalTagsThatShouldTrigger.has(n)
                ? { tag: false, content: n.content }
                : []
        }

        return n
    })

    return newTree
}

/**
 * Walks the tree, executing the callback on each node.
 */
export async function walk(
    tree: Node[],
    callback: (node: Node, i: number, arr: Node[]) => WalkReturn,
): Promise<Node[]> {
    return Promise.all(
        tree.map(async (n, i, arr) => {
            const cbResult = await callback(n, i, arr)

            const cleaned = normalizeContent(cbResult)

            // re-run arrays
            if (Array.isArray(cbResult)) return walk(cleaned, callback)

            // recurse into content
            for (const n2 of onlyTags(cleaned)) {
                n2.content = await walk(normalizeContent(n2.content), callback)
            }

            return cleaned
        }),
    ).then(tree => tree.flat())
}

/**
 * Walks the tree, only executing the callback on nodes that
 * are tags.
 */
export async function walkTags(
    tree: Node[],
    callback: (
        node: NodeTagWithTag,
        i: number,
        arr: NodeTagWithTag[],
    ) => WalkReturn,
) {
    const filteredArrCache = new Map<Node[], NodeTagWithTag[]>()

    return walk(tree, async (n, i, arr) => {
        const qualifies = (n: Node): n is NodeTagWithTag =>
            isTagNode(n) && typeof n.tag === "string" && !!n.tag

        if (qualifies(n)) {
            if (!filteredArrCache.has(arr))
                filteredArrCache.set(arr, arr.filter(qualifies))
            return callback(n, i, filteredArrCache.get(arr)!)
        }

        return n
    })
}

/**
 * Walks the tree, only executing the callback on nodes with
 * the specified tag.
 */
export async function walkByTag(
    tree: Node[],
    tag: string,
    callback: (node: NodeTagWithTag) => WalkReturn,
) {
    return walkTags(tree, n => (n.tag === tag ? callback(n) : n))
}

/**
 * Flattens, removes nodes with falsy tags, etc. Useful for cleaning
 * up the various union types of posthtml-parser.
 */
export function normalizeContent(
    content: Node | Node[] | Content | undefined,
): Node[] {
    if (content == null) return []
    return (Array.isArray(content) ? content.flat() : [content]).flatMap(n => {
        if (isTagNode(n) && !n.tag) return normalizeContent(n.content ?? [])
        return n
    })
}

/**
 * Simple filter to ignore non-tag nodes. Doesn't traverse.
 */
export function onlyTags(tree: Node[]) {
    return tree.filter(isTagNode)
}

/**
 * Checks if a node is a tag node. Adds some extra type
 * safety.
 */
export function isTagNode(node: Node): node is NodeTag {
    return typeof node === "object"
}

/**
 * Checks if a node has a string attribute. Adds some extra
 * type safety.
 */
export function hasStringAttribute<Attr extends string>(
    node: Node,
    attr: Attr,
): node is Omit<NodeTag, "attrs"> & {
    attrs: {
        [k in Attr]: string
    }
} {
    return isTagNode(node) && typeof node.attrs?.[attr] === "string"
}

/**
 * Small helper to match segments split by colons. Need
 * special handling since some colons are used in the
 * attribute syntax.
 */
function colonMatch(
    numSegments: number,
    str: string,
): { isMatch: boolean; segments: string[] } {
    const pattern = new RegExp(`^${"(.+?):".repeat(numSegments - 1)}(.+)$`)
    const match = str.match(pattern)
    return match
        ? {
              isMatch: true,
              segments: match.slice(1),
          }
        : {
              isMatch: false,
              segments: [],
          }
}

/**
 * Uses indirect eval in strict mode to evaluate the string.
 */
function indirectEval(str: string) {
    return eval?.(`"use strict";\n${str}`)
}

type WalkReturn = Node | Node[] | Promise<Node | Node[]>

type NodeTagWithTag = Omit<NodeTag, "tag"> & { tag: string }
