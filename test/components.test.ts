import { expect, test } from "bun:test"
import { parser } from "posthtml-parser"
import { HTempCompiler, onlyTags, walkByTag, walkTags } from ".."
import { render } from "posthtml-render"
import { parseHtml } from "../lib/parser"

const hc = new HTempCompiler({
    componentsRoot: "./test/components",
    pretty: false,
})

test("Component inserts content", async () => {
    const html = await hc.compile("<x-box />")
    const tree = parseHtml(html)

    expect(tree).toEqual([{ tag: "div" }])
})

test("Component can insert multiple nodes", async () => {
    const html = await hc.compile("<x-input />")
    const tree = onlyTags(parseHtml(html))
    expect(tree).toHaveLength(2)
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

test("Attributes are passed to first tag when attr is not present", async () => {
    const html = await hc.compile("<x-input data-test='TEST' />")
    const tree = onlyTags(parseHtml(html))

    expect(tree[0].attrs).toHaveProperty("data-test", "TEST")
    expect(tree[1].attrs).not.toHaveProperty("data-test")
})

test("Attributes are passed to element with attr", async () => {
    const html = await hc.compile("<x-multi-yield data-test='TEST' />")
    const tree = parseHtml(html)

    await walkTags(tree, n => {
        if (n.tag === "b") expect(n.attrs).toHaveProperty("data-test", "TEST")
        else expect(n.attrs).not.toHaveProperty("data-test")
        return n
    })
})

test("Attributes are passed to attribute slots", async () => {
    const html = await hc.compile(
        "<x-multi-yield attr:wrapper:data-test='TEST' />",
    )
    const tree = parseHtml(html)

    await walkTags(tree, n => {
        if (n.tag === "div") expect(n.attrs).toHaveProperty("data-test", "TEST")
        else expect(n.attrs).not.toHaveProperty("data-test")
        return n
    })
})

test("Slots work", async () => {
    const html = await hc.compile(`<x-slot-test>
        <fill:paragraph>PARAGRAPH</fill:paragraph>
        <fill:foot>FOOTER</fill:foot>
    </x-slot-test>`)
    const tree = parseHtml(html)

    await walkByTag(tree, "p", n => {
        const snippet = render(n).replaceAll(/\s+/g, "")
        expect(snippet).toBe("<p>PARAGRAPH</p>")
        return n
    })

    await walkByTag(tree, "footer", n => {
        const snippet = render(n).replaceAll(/\s+/g, "")
        expect(snippet).toBe("<footer>FOOTER</footer>")
        return n
    })
})
