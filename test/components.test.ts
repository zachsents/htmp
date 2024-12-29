import { expect, test } from "bun:test"
import { render } from "posthtml-render"
import { HTempCompiler, onlyTags, walkByTag } from ".."
import { parseHtml } from "../lib/parser"

const hc = new HTempCompiler({
    componentsRoot: "./test/components",
    pretty: false,
})

test("Components are loaded from files", async () => {
    const html = await hc.compile("<x-box />")
    expect(html).toBe("<div></div>")
})

test("Components are loaded from override object", async () => {
    const html = await hc.compile("<x-test />", {
        components: {
            test: "<p></p>",
        },
    })
    expect(html).toBe("<p></p>")
})

test("Components loaded from override object are converted from camelCase to kebab-case", async () => {
    const promise = hc.compile("<x-hello-world /><x-test-2 />", {
        components: {
            helloWorld: "<p></p>",
            test2: "<p></p>",
        },
    })
    expect(promise).resolves.toBeDefined()
})

test("Components from override take precedence over files", async () => {
    const html = await hc.compile("<x-box />", {
        components: {
            box: "<p></p>",
        },
    })
    expect(html).toBe("<p></p>")
})

test("Component can insert multiple nodes", async () => {
    const html = await hc.compile("<x-test />", {
        components: {
            test: "<p></p><div></div><section></section>",
        },
    })
    const tree = onlyTags(parseHtml(html))
    expect(tree).toHaveLength(3)
})

test("Component yields content", async () => {
    const html = await hc.compile("<x-test>TEST</x-test>", {
        components: {
            test: "<p><yield /></p>",
        },
    })
    expect(html).toContain("TEST")
})

test("Empty tag yields default content", async () => {
    const html = await hc.compile("<x-test></x-test>", {
        components: {
            test: "<p><yield>DEFAULT</yield></p>",
        },
    })
    expect(html).toContain("DEFAULT")
})

test("Self-closing tag yields default content", async () => {
    const html = await hc.compile("<x-test />", {
        components: {
            test: "<p><yield>DEFAULT</yield></p>",
        },
    })
    expect(html).toContain("DEFAULT")
})

test("Yield with default content ignores default content", async () => {
    const html = await hc.compile("<x-test>TEST</x-test>", {
        components: {
            test: "<p><yield>DEFAULT</yield></p>",
        },
    })
    expect(html).toContain("TEST")
})

test("Multiple yields work", async () => {
    const html = await hc.compile("<x-test>MULTI</x-test>", {
        components: {
            test: "<p><yield /></p><small><yield /></small>",
        },
    })
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
    const html = await hc.compile("<x-test data-test='TEST' />", {
        components: {
            test: "<p></p><p></p>",
        },
    })
    const tree = onlyTags(parseHtml(html))

    expect(tree[0].attrs).toHaveProperty("data-test", "TEST")
    expect(tree[1].attrs).not.toHaveProperty("data-test")
})

test("Text nodes are ignored when passing attributes in default manner", async () => {
    const html = await hc.compile("<x-test data-test='TEST' />", {
        components: {
            test: "Hello<p></p><p></p>",
        },
    })
    const tree = onlyTags(parseHtml(html))

    expect(tree[0].attrs).toHaveProperty("data-test", "TEST")
    expect(tree[1].attrs).not.toHaveProperty("data-test")
})

test("Attributes are passed to element with attr", async () => {
    const html = await hc.compile("<x-test data-test='TEST' />", {
        components: {
            test: "<p></p><p attr></p>",
        },
    })
    const tree = onlyTags(parseHtml(html))

    expect(tree[0].attrs).not.toHaveProperty("data-test")
    expect(tree[1].attrs).toHaveProperty("data-test", "TEST")
})

test("Attributes are passed to attribute slots", async () => {
    const html = await hc.compile("<x-test attr:inner:data-test='TEST' />", {
        components: {
            test: "<div><p attr='inner'></p></div>",
        },
    })
    const tree = parseHtml(html)

    await walkByTag(tree, "div", n => {
        expect(n.attrs).not.toHaveProperty("data-test")
        return n
    })

    await walkByTag(tree, "p", n => {
        expect(n.attrs).toHaveProperty("data-test", "TEST")
        return n
    })
})

test("Slots work", async () => {
    const html = await hc.compile(
        `<x-test>
            <fill:paragraph>PARAGRAPH</fill:paragraph>
            <fill:foot>FOOTER</fill:foot>
        </x-test>`,
        {
            components: {
                test: `<div>
                    <p><slot:paragraph /></p>
                    <footer><slot:foot /></footer>
                </div>`,
            },
        },
    )
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
