import { type AnyNode, type Element, hasChildren, isTag } from "domhandler"

export function findNode<T extends AnyNode>(
    tree: AnyNode[],
    test: (node: AnyNode) => node is T,
): T | undefined
export function findNode(
    tree: AnyNode[],
    test: (node: AnyNode) => boolean,
): AnyNode | undefined
export function findNode(
    tree: AnyNode[],
    test: (node: AnyNode) => boolean,
): AnyNode | undefined {
    for (const node of tree) {
        if (test(node)) return node
        if (hasChildren(node) && node.children.length > 0) {
            const result = findNode(node.children, test)
            if (result) return result
        }
    }
}

export function findNodes<T extends AnyNode>(
    tree: AnyNode[],
    test: (node: AnyNode) => node is T,
): T[]
export function findNodes(
    tree: AnyNode[],
    test: (node: AnyNode) => boolean,
): AnyNode[]
export function findNodes(
    tree: AnyNode[],
    test: (node: AnyNode) => boolean,
): AnyNode[] {
    const result = tree.filter(test)
    for (const node of tree) {
        if (!hasChildren(node) || node.children.length === 0) continue
        result.push(...findNodes(node.children, test))
    }
    return result
}

export function findElement(tree: AnyNode[], tag: string): Element | undefined
export function findElement(
    tree: AnyNode[],
    test: (el: Element) => boolean,
): Element | undefined
export function findElement(
    tree: AnyNode[],
    tagOrTest: string | ((el: Element) => boolean),
): Element | undefined {
    return findNode(tree, (node): node is Element => {
        if (!isTag(node)) return false
        if (typeof tagOrTest === "string") return node.tagName === tagOrTest
        if (typeof tagOrTest === "function") return tagOrTest(node)
        return false
    })
}

export function findElements(tree: AnyNode[]): Element[]
export function findElements(tree: AnyNode[], tag: string): Element[]
export function findElements(
    tree: AnyNode[],
    test: (el: Element) => boolean,
): Element[]
export function findElements(
    tree: AnyNode[],
    tagOrTest?: string | ((el: Element) => boolean),
): Element[] {
    return findNodes(tree, (node): node is Element => {
        if (!isTag(node)) return false
        if (tagOrTest === undefined) return true
        if (typeof tagOrTest === "string") return node.tagName === tagOrTest
        if (typeof tagOrTest === "function") return tagOrTest(node)
        return false
    })
}
