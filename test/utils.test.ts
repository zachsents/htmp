import { expect, test } from "bun:test"
import { type Element, type Text, isTag, isText } from "domhandler"
import { parseHtml } from "../src/lib/parser"
import {
    findElement,
    findElements,
    findNode,
    findNodes,
} from "../src/lib/utils"

const testFragment = "<div><p>Hello</p><b>World</b></div>"

test("findNode finds a node", async () => {
    const tree = await parseHtml(testFragment)
    const found = findNode(tree, n => isText(n))
    expect(found).toBeDefined()
    expect(found?.data).toBe("Hello")
})

test("findNode can find nodes in any branch (ref. fb55/domutils #1856)", async () => {
    const tree = await parseHtml(testFragment)
    const found = findNode(
        tree,
        (n): n is Text => isText(n) && n.data.includes("orl"),
    )
    expect(found).toBeDefined()
    expect(found?.data).toBe("World")
})

test("findNodes finds multiple nodes", async () => {
    const tree = await parseHtml(testFragment)
    const found = findNodes(
        tree,
        n =>
            (isTag(n) && n.tagName === "p") ||
            (isText(n) && n.data.includes("orl")),
    )
    expect(found).toHaveLength(2)
    expect((found[0] as Element).tagName).toBe("p")
    expect((found[1] as Text).data).toBe("World")
})

test("findElement finds a single element", async () => {
    const tree = await parseHtml(testFragment)
    const found = findElement(tree, "p")
    expect(found).toBeDefined()
    expect(found?.tagName).toBe("p")
})

test("findElements finds multiple elements", async () => {
    const tree = await parseHtml(testFragment)
    const found = findElements(tree, "p")
    expect(found).toHaveLength(1)
    expect(found[0].tagName).toBe("p")
})
