import path from "node:path"
import fs from "node:fs/promises"
import {
    parser,
    type Attributes,
    type Node,
    type NodeTag,
} from "posthtml-parser"
import { render } from "posthtml-render"
import * as prettier from "prettier"

export interface HTempCompileOptions {
    componentsRoot?: string
    componentTagPrefix?: string
    yieldTag?: string
    pretty?: boolean
    attrAttribute?: string
}

export async function compile(
    html: string,
    {
        componentsRoot = "components",
        componentTagPrefix = "x-",
        yieldTag = "yield",
        pretty = true,
        attrAttribute = "attr",
    }: HTempCompileOptions = {},
) {
    let tree = parser(html)

    // Components
    const componentContentCache = new Map<string, string>()
    tree = await walkTags(tree, async n => {
        // not a component -- skip
        if (!n.tag.startsWith(componentTagPrefix)) return n

        // component -- load, parse, and expand
        if (!componentContentCache.has(n.tag)) {
            const componentPath = path.join(
                componentsRoot,
                `${n.tag.slice(componentTagPrefix.length).replaceAll(".", path.sep)}.html`,
            )
            try {
                const componentContent = await fs.readFile(
                    componentPath,
                    "utf8",
                )
                componentContentCache.set(n.tag, componentContent)
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

        let componentTree = parser(componentContentCache.get(n.tag)!)

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

        // pass content through to yield tag
        componentTree = await walkByTag(componentTree, yieldTag, yieldNode => ({
            tag: false,
            content: n.content ?? yieldNode.content,
        }))

        return componentTree
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

export async function walk(
    tree: Node[],
    callback: WalkCallback,
): Promise<Node[]> {
    return Promise.all(
        tree.map(async n => {
            const cbResult = await callback(n)

            // flattening clean up steps
            const halfCleaned = Array.isArray(cbResult)
                ? cbResult.map(flattenFalsyTaggedNode)
                : flattenFalsyTaggedNode(cbResult)

            const cleaned = Array.isArray(halfCleaned)
                ? halfCleaned.flat(2)
                : halfCleaned

            // re-run arrays
            if (Array.isArray(cleaned)) return walk(cleaned, callback)

            // skip primitives
            if (typeof cleaned === "string" || typeof cleaned === "number")
                return cleaned

            // recurse into content
            if (cleaned.content != null) {
                if (Array.isArray(cleaned.content))
                    cleaned.content = await walk(
                        cleaned.content.flat(),
                        callback,
                    )
                else cleaned.content = await walk([cleaned.content], callback)
            }

            return cleaned
        }),
    ).then(tree => tree.flat())
}

export async function walkTags(
    tree: Node[],
    callback: (node: NodeTagWithTag) => ReturnType<WalkCallback>,
) {
    return walk(tree, async n => {
        if (
            typeof n === "string" ||
            typeof n === "number" ||
            !n.tag ||
            typeof n.tag !== "string"
        )
            return n
        return callback(n as NodeTagWithTag)
    })
}

export async function walkByTag(
    tree: Node[],
    tag: string,
    callback: (node: NodeTagWithTag) => ReturnType<WalkCallback>,
) {
    return walkTags(tree, async n => (n.tag === tag ? callback(n) : n))
}

function flattenFalsyTaggedNode(n: Node) {
    if (typeof n === "string" || typeof n === "number") return n
    if (!n.tag) return n.content ?? []
    return n
}

export function onlyTags(tree: Node[]) {
    return tree.filter(n => typeof n === "object")
}

type WalkCallback = (node: Node) => Node | Node[] | Promise<Node | Node[]>

type NodeTagWithTag = Omit<NodeTag, "tag"> & {
    tag: string
}
