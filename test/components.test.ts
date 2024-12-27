import { expect, test } from "bun:test"
import { parser } from "posthtml-parser"
import { HTempCompiler } from ".."

const hc = new HTempCompiler({
    componentsRoot: "./test/components",
    pretty: false,
})

test("Component inserts content", async () => {
    const html = await hc.compile("<x-box />")
    const tree = parser(html)

    expect(tree).toEqual([{ tag: "div" }])
})

test("Component can insert multiple nodes", async () => {
    const html = await hc.compile("<x-input />")
    const tree = parser(html)
    const tagChildren = tree.filter(n => typeof n === "object")
    expect(tagChildren).toHaveLength(2)
})

test("Component yields content", async () => {
    const html = await hc.compile("<x-button>TEST</x-button>")
    expect(html).toContain("TEST")
})

test("Empty tag yields default content", async () => {
    const html = await hc.compile("<x-button></x-button>")
    expect(html).toContain("DEFAULT BUTTON")
})

test("Self-closing tag yields default content", async () => {
    const html = await hc.compile("<x-button />")
    expect(html).toContain("DEFAULT BUTTON")
})

test("Multiple yields work", async () => {
    const html = await hc.compile("<x-multi-yield>MULTI</x-multi-yield>")
    expect(html.split("MULTI")).toHaveLength(3)
})

test("Component not found throws useful error", async () => {
    const promise = hc.compile("<x-not-real />")
    // useful message
    expect(promise).rejects.toThrow("Component not found")
    // names tag explicitly
    expect(promise).rejects.toThrow("x-not-real")
})
