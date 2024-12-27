import path from "node:path"
import fs from "node:fs/promises"
import { parser, type Node, type NodeTag } from "posthtml-parser"
import { render } from "posthtml-render"

export type PosthtmlFrameworkOptions = ComponentsPluginOptions

export async function compile(
    html: string,
    {
        componentsRoot = "components",
        componentTagPrefix = "x-",
        yieldTag = "yield",
    }: PosthtmlFrameworkOptions = {},
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
            const componentContent = await fs.readFile(componentPath, "utf8")
            componentContentCache.set(n.tag, componentContent)
        }

        // pass content through to yield tag
        return walkByTag(
            parser(componentContentCache.get(n.tag)!),
            yieldTag,
            yieldNode => ({
                tag: false,
                content: n.content ?? yieldNode.content,
            }),
        )
    })

    return render(tree)
}

export interface ComponentsPluginOptions {
    componentsRoot?: string
    componentTagPrefix?: string
    yieldTag?: string
    /** TODO */
    pretty?: boolean
}

async function walk(tree: Node[], callback: WalkCallback): Promise<Node[]> {
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

async function walkTags(
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

async function walkByTag(
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

type WalkCallback = (node: Node) => Node | Node[] | Promise<Node | Node[]>

type NodeTagWithTag = Omit<NodeTag, "tag"> & {
    tag: string
}
