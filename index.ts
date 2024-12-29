import fs from "node:fs/promises"
import path from "node:path"
import type { Attributes, Content, Node, NodeTag } from "posthtml-parser"
import { render } from "posthtml-render"
import * as prettier from "prettier"
import { parseHtml } from "./lib/parser"
import { kMaxLength } from "node:buffer"

export interface HTempCompileOptions {
    /**
     * Optional object containing components. These will take precedence over
     * files in the componentsRoot.
     */
    components?: Record<string, string>
    /**
     * Where to look for components, which are just .html files.
     * @default "./components"
     */
    componentsRoot?: string
    /**
     * The prefix to use for component tags.
     * @default "x-"
     */
    componentTagPrefix?: string
    /**
     * The tag to use for yields.
     * @default "yield"
     */
    yieldTag?: string
    /**
     * Whether to pretty-print the output. Uses prettier.
     * @default true
     */
    pretty?: boolean
    /**
     * The attribute to use for passing attributes to components.
     * @default "attr"
     */
    attrAttribute?: string
    /**
     * The tag to use for defining slots.
     * @default "slot"
     */
    defineSlotTag?: string
    /**
     * The tag to use for filling slots.
     * @default "fill"
     */
    fillSlotTag?: string
    /**
     * The tag to use for defining stacks.
     * @default "stack"
     */
    stackTag?: string
    /**
     * The tag to use for pushing to stacks.
     * @default "push"
     */
    pushTag?: string
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

        // organize attributes into a map
        const attrMap: Record<string, Attributes> = {}
        for (const [k, v] of Object.entries(n.attrs ?? {})) {
            const split = k.split(":")
            if (split[0] === attrAttribute && split[1] && split[2]) {
                // assign to attribute slot
                attrMap[split[1]] ??= {}
                attrMap[split[1]][split[2]] = v
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
                const split = contentNode.tag.split(":")
                if (split[0] === fillSlotTag && split[1]) {
                    slotContent[split[1]] ??= []
                    slotContent[split[1]]!.push(
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

            const split = n2.tag.split(":")
            if (split[0] === defineSlotTag && split[1]) {
                return {
                    tag: false,
                    content: slotContent[split[1]] ?? n2.content,
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
 * Walks the tree, executing the callback on each node.
 */
export async function walk(
    tree: Node[],
    callback: WalkCallback,
): Promise<Node[]> {
    return Promise.all(
        tree.map(async n => {
            const cbResult = await callback(n)

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
    callback: (node: NodeTagWithTag) => ReturnType<WalkCallback>,
) {
    return walk(tree, async n => {
        if (isTagNode(n) && typeof n.tag === "string" && n.tag)
            return callback(n as NodeTagWithTag)
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
    callback: (node: NodeTagWithTag) => ReturnType<WalkCallback>,
) {
    return walkTags(tree, async n => (n.tag === tag ? callback(n) : n))
}

/**
 * Flattens, removes nodes with falsy tags, etc. Useful for cleaning
 * up the various union types of posthtml-parser.
 */
function normalizeContent(
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

type WalkCallback = (node: Node) => Node | Node[] | Promise<Node | Node[]>

type NodeTagWithTag = Omit<NodeTag, "tag"> & {
    tag: string
}
