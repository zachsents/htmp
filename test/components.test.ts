import { expect, test } from "bun:test"
import { Glob } from "bun"
import { innerText } from "domutils"
import { type HTmpCompileOptions, HTmpCompiler } from "../src"
import { parseHtml } from "../src/lib/parser"
import { findElement, findElements } from "../src/lib/utils"

const globalOpts: HTmpCompileOptions = {
    componentsRoot: "./test/components",
    pretty: false,
}

test("Components are loaded from files", async () => {
    const html = await new HTmpCompiler({ ...globalOpts }).compile("<x-box />")
    expect(html).toBe("<div>Hello!</div>")
})

test("Components can be loaded from an index file in a directory", async () => {
    const html = await new HTmpCompiler({ ...globalOpts }).compile(
        "<x-folder />",
    )
    expect(html).toBe("<div>folder</div>")
})

test("Components are loaded from override object", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "<p>Test</p>",
        },
    }).compile("<x-test />")
    expect(html).toBe("<p>Test</p>")
})

test("Components loaded from override object are converted from camelCase to kebab-case", async () => {
    const promise = new HTmpCompiler({
        ...globalOpts,
        components: {
            helloWorld: "<p></p>",
            test2: "<p></p>",
        },
    }).compile("<x-hello-world /><x-test-2 />")
    expect(promise).resolves.toBeDefined()
})

test("Components from override take precedence over files", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            box: "<p></p>",
        },
    }).compile("<x-box />")
    expect(html).toBe("<p></p>")
})

test("Component can insert multiple nodes", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "<p></p><div></div><section></section>",
        },
    }).compile("<x-test />")

    const elements = findElements(await parseHtml(html))
    expect(elements).toHaveLength(3)
})

test("Components work recursively", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "<x-hello />",
            hello: "<p>Hello!</p>",
        },
    }).compile("<x-test />")
    expect(html).toBe("<p>Hello!</p>")
})

test("Component yields content", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "<p><yield /></p>",
        },
    }).compile("<x-test>TEST</x-test>")
    expect(html).toContain("TEST")
})

test("Empty tag yields default content", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "<p><yield>DEFAULT</yield></p>",
        },
    }).compile("<x-test></x-test>")
    expect(html).toContain("DEFAULT")
})

test("Self-closing tag yields default content", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "<p><yield>DEFAULT</yield></p>",
        },
    }).compile("<x-test />")

    expect(html).toContain("DEFAULT")
})

test("Yield with default content ignores default content", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "<p><yield>DEFAULT</yield></p>",
        },
    }).compile("<x-test>TEST</x-test>")

    expect(html).toContain("TEST")
})

test("Multiple yields work", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "<p><yield /></p><small><yield /></small>",
        },
    }).compile("<x-test>MULTI</x-test>")

    expect(html.split("MULTI")).toHaveLength(3)
})

test("Component not found throws useful error (prefix-mode)", async () => {
    const promise = new HTmpCompiler({ ...globalOpts }).compile(
        "<x-not-real />",
    )

    // useful message
    expect(promise).rejects.toThrow("Component not found")
    // names tag explicitly
    expect(promise).rejects.toThrow("not-real")
})

test("Component not found throws useful error (tag-mode)", async () => {
    const promise = new HTmpCompiler({ ...globalOpts }).compile(
        "<component name='not-real' />",
    )

    // useful message
    expect(promise).rejects.toThrow("Component not found")
    // names tag explicitly
    expect(promise).rejects.toThrow("not-real")
})

test("Attributes are passed to first tag when attr is not present", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "<p></p><p></p>",
        },
    }).compile("<x-test data-test='TEST' />")

    const elements = findElements(await parseHtml(html))

    expect(elements[0].attribs).toHaveProperty("data-test", "TEST")
    expect(elements[1].attribs).not.toHaveProperty("data-test")
})

test("Script and style tags aren't considered when passing attributes to first tag", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "<script /><style /><p /><p />",
        },
    }).compile("<x-test data-test='TEST' />")

    const tree = await parseHtml(html)
    const script = findElement(tree, "script")
    expect(script).toBeDefined()
    expect(script!.attribs).not.toHaveProperty("data-test")

    const style = findElement(tree, "style")
    expect(style).toBeDefined()
    expect(style!.attribs).not.toHaveProperty("data-test")

    const paragraphs = findElements(tree, "p")
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0].attribs).toHaveProperty("data-test", "TEST")
    expect(paragraphs[1].attribs).not.toHaveProperty("data-test")
})

test("Passed attributes override attributes in components", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "<p data-test='ORIGINAL' />",
        },
    }).compile("<x-test data-test='TEST' />")

    const p = findElement(await parseHtml(html), "p")

    expect(p).toBeDefined()
    expect(p!.attribs).toHaveProperty("data-test", "TEST")
})

test("Text nodes are ignored when passing attributes in default manner", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "Hello<p></p><p></p>",
        },
    }).compile("<x-test data-test='TEST' />")

    const elements = findElements(await parseHtml(html))

    expect(elements[0].attribs).toHaveProperty("data-test", "TEST")
    expect(elements[1].attribs).not.toHaveProperty("data-test")
})

test("Attributes are passed to element with attr", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "<p></p><p attr></p>",
        },
    }).compile("<x-test data-test='TEST' />")

    const elements = findElements(await parseHtml(html))

    expect(elements[0].attribs).not.toHaveProperty("data-test")
    expect(elements[1].attribs).toHaveProperty("data-test", "TEST")
})

test("Attributes are passed to attribute slots", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "<div><p attr='inner'></p></div>",
        },
    }).compile("<x-test attr:inner:data-test='TEST' />")

    const tree = await parseHtml(html)

    const div = findElement(tree, "div")
    expect(div?.attribs).not.toHaveProperty("data-test")

    const p = findElement(tree, "p")
    expect(p?.attribs).toHaveProperty("data-test", "TEST")
})

test("Attributes passed to attribute slots can have colons in them", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "<div><p attr='inner'></p></div>",
        },
    }).compile("<x-test attr:inner::class='TEST' />")

    const tree = await parseHtml(html)

    const p = findElement(tree, "p")
    expect(p?.attribs).toHaveProperty(":class", "TEST")
})

test("Slots work", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: `<div>
                    <p><slot name=paragraph /></p>
                    <footer><slot name=foot /></footer>
                </div>`,
        },
    }).compile(
        `<x-test>
            <fill slot=paragraph>PARAGRAPH</fill>
            <fill slot=foot>FOOTER</fill>
        </x-test>`,
    )

    const tree = await parseHtml(html)

    const p = findElement(tree, "p")
    expect(p).toBeDefined()
    expect(innerText(p!).trim()).toBe("PARAGRAPH")

    const footer = findElement(tree, "footer")
    expect(footer).toBeDefined()
    expect(innerText(footer!).trim()).toBe("FOOTER")
})

test("Props work", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: `<script server>
                localProp = props.prop ?? "default prop value"
            </script>
            <div>%% localProp %%</div>`,
        },
    }).compile("<x-test prop='test' />")

    expect(html.trim()).toBe("<div>test</div>")
})

test("Class attributes are merged by concatenating by default", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: `<div class="b">Hello</div>`,
        },
    }).compile("<x-test class='a' />")

    const tree = await parseHtml(html)
    const div = findElement(tree, "div")
    expect(div).toBeDefined()
    expect(div!.attribs).toHaveProperty("class", "b a")
})

test("Style attributes are merged by concatenating by default", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: `<div style="color: red;">Hello</div>`,
        },
    }).compile("<x-test style='color: blue;' />")

    const tree = await parseHtml(html)
    const div = findElement(tree, "div")
    expect(div).toBeDefined()
    expect(div!.attribs).toHaveProperty("style", "color: red; color: blue;")
})

test("Default custom merge strategies can be overridden", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: `<div class="b">Hello</div>`,
        },
        attributeMergeStrategies: [{ name: "class", merge: (_, val) => val }],
    }).compile("<x-test class='a' />")

    const tree = await parseHtml(html)
    const div = findElement(tree, "div")
    expect(div).toBeDefined()
    expect(div!.attribs).toHaveProperty("class", "a")
})

test("Custom merge strategies can use Regex patterns", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "<div a2=x b5=y>Hello</div>",
        },
        attributeMergeStrategies: [{ pattern: /[a-z]\d/, merge: () => "" }],
    }).compile("<x-test a2=a b5=b />")

    const tree = await parseHtml(html)
    const div = findElement(tree, "div")
    expect(div).toBeDefined()
    expect(div!.attribs).toHaveProperty("a2", "")
    expect(div!.attribs).toHaveProperty("b5", "")
})

test("Component tag inserts component specified by name attribute", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "<div>Hello</div>",
        },
    }).compile("<component name='test' />")

    console.log()

    expect(html).toBe("<div>Hello</div>")
})

test("Component tag works with eval: attribute computation", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "<div>Hello</div>",
        },
    }).compile("<component eval:name=\"'test'\" />")

    expect(html).toBe("<div>Hello</div>")
})

test("Additional eval context passed to compile is available in components", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "<div>%% a %% %% b %%</div>",
        },
        evalContext: {
            a: "hello",
        },
    }).compile("<x-test />", {
        b: "world",
    })

    expect(html).toBe("<div>hello world</div>")
})

test("Component preloading works", async () => {
    const compiler = new HTmpCompiler(globalOpts)
    // @ts-ignore
    expect(compiler.componentCache.size).toBe(0)

    const actualComponentNames = await Array.fromAsync(
        new Glob("**/*.html").scan(globalOpts.componentsRoot),
    ).then(arr =>
        arr
            .map(f =>
                f
                    .replace(/\.html$/, "")
                    .replace(/[\\\/]index$/, "")
                    .replaceAll(/[\\\/]/g, "."),
            )
            .sort(),
    )

    await compiler.preloadComponents()
    // @ts-ignore
    const cacheNames = Array.from(compiler.componentCache.keys()).sort()

    expect(cacheNames).toEqual(actualComponentNames)
})
