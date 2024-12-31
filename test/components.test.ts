import { expect, test } from "bun:test"
import { innerText, isTag } from "domutils"
import { HTmpCompiler } from ".."
import { parseHtml } from "../lib/parser"
import { findElement, findElements } from "../lib/utils"

const hc = new HTmpCompiler({
    componentsRoot: "./test/components",
    pretty: false,
})

test("Components are loaded from files", async () => {
    const html = await hc.compile("<x-box />")
    expect(html).toBe("<div>Hello!</div>")
})

test("Components are loaded from override object", async () => {
    const html = await hc.compile("<x-test />", {
        components: {
            test: "<p>Test</p>",
        },
    })
    expect(html).toBe("<p>Test</p>")
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

    const elements = findElements(await parseHtml(html))
    expect(elements).toHaveLength(3)
})

test("Components work recursively", async () => {
    const html = await hc.compile("<x-test />", {
        components: {
            test: "<x-hello />",
            hello: "<p>Hello!</p>",
        },
    })
    expect(html).toBe("<p>Hello!</p>")
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
    const elements = findElements(await parseHtml(html))

    expect(elements[0].attribs).toHaveProperty("data-test", "TEST")
    expect(elements[1].attribs).not.toHaveProperty("data-test")
})

test("Passed attributes override attributes in components", async () => {
    const html = await hc.compile("<x-test data-test='TEST' />", {
        components: {
            test: "<p data-test='ORIGINAL' />",
        },
    })
    const p = findElement(await parseHtml(html), "p")
    expect(p).toBeDefined()
    expect(p!.attribs).toHaveProperty("data-test", "TEST")
})

test("Text nodes are ignored when passing attributes in default manner", async () => {
    const html = await hc.compile("<x-test data-test='TEST' />", {
        components: {
            test: "Hello<p></p><p></p>",
        },
    })
    const elements = findElements(await parseHtml(html))

    expect(elements[0].attribs).toHaveProperty("data-test", "TEST")
    expect(elements[1].attribs).not.toHaveProperty("data-test")
})

test("Attributes are passed to element with attr", async () => {
    const html = await hc.compile("<x-test data-test='TEST' />", {
        components: {
            test: "<p></p><p attr></p>",
        },
    })
    const elements = findElements(await parseHtml(html))

    expect(elements[0].attribs).not.toHaveProperty("data-test")
    expect(elements[1].attribs).toHaveProperty("data-test", "TEST")
})

test("Attributes are passed to attribute slots", async () => {
    const html = await hc.compile("<x-test attr:inner:data-test='TEST' />", {
        components: {
            test: "<div><p attr='inner'></p></div>",
        },
    })
    const tree = await parseHtml(html)

    const div = findElement(tree, "div")
    expect(div?.attribs).not.toHaveProperty("data-test")

    const p = findElement(tree, "p")
    expect(p?.attribs).toHaveProperty("data-test", "TEST")
})

test("Attributes passed to attribute slots can have colons in them", async () => {
    const html = await hc.compile("<x-test attr:inner::class='TEST' />", {
        components: {
            test: "<div><p attr='inner'></p></div>",
        },
    })
    const tree = await parseHtml(html)

    const p = findElement(tree, "p")
    expect(p?.attribs).toHaveProperty(":class", "TEST")
})

test("Slots work", async () => {
    const html = await hc.compile(
        `<x-test>
                <fill slot=paragraph>PARAGRAPH</fill>
                <fill slot=foot>FOOTER</fill>
            </x-test>`,
        {
            components: {
                test: `<div>
                        <p><slot name=paragraph /></p>
                        <footer><slot name=foot /></footer>
                    </div>`,
            },
        },
    )

    const tree = await parseHtml(html)

    const p = findElement(tree, "p")
    expect(p).toBeDefined()
    expect(innerText(p!).trim()).toBe("PARAGRAPH")

    const footer = findElement(tree, "footer")
    expect(footer).toBeDefined()
    expect(innerText(footer!).trim()).toBe("FOOTER")
})
