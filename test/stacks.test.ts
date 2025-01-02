import { expect, test } from "bun:test"
import { selectOne } from "css-select"
import { innerText, isTag } from "domutils"
import { type HTmpCompileOptions, HTmpCompiler } from "../src"
import { parseHtml } from "../src/lib/parser"
import { findElement, findElements } from "../src/lib/utils"

const globalOpts: HTmpCompileOptions = {
    componentsRoot: "./test/components",
    pretty: false,
}

test("Push tag gets pushed to stack", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            test: "<push stack='test-stack'><p>PUSHED</p></push>",
        },
    }).compile("<div><x-test /></div><stack name='test-stack' />")

    expect(html).toBe("<div></div><p>PUSHED</p>")
})

test("Elements pushed to stack are de-duped by id", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            a: "<push stack='test-stack'><p id='p-in-test-stack'>PUSHED FROM A</p></push>",
            b: "<push stack='test-stack'><p id='p-in-test-stack'>PUSHED FROM B</p></push>",
        },
    }).compile("<div><x-a /><x-b /></div><stack name='test-stack' />")

    expect(html).toBe('<div></div><p id="p-in-test-stack">PUSHED FROM A</p>')
})

test("Stacks can be pushed to from multiple places", async () => {
    const html = await new HTmpCompiler(globalOpts)
        .compile(`
        <stack name="top" />        
        <div>
            <push stack="top"><p>A</p></push>
            <div>
                <push stack="top"><p>B</p></push>
            </div>
        </div>`)
        .then(html => html.replaceAll(/\s+/g, ""))

    expect(html).toBe("<p>A</p><p>B</p><div><div></div></div>")
})

test("Multiple stacks with the same name can be pushed to", async () => {
    const html = await new HTmpCompiler(globalOpts).compile(`
        <stack name="main" />        
        <div>
            <push stack="main"><p>A</p></push>
            <div>
                <push stack="main"><p>B</p></push>
            </div>
        </div>
        <stack name="main" />`)

    const tree = await parseHtml(html)

    expect(findElements(tree, "p")).toHaveLength(4)
    expect(findElements(tree, "push")).toHaveLength(0)
    expect(findElements(tree, "stack")).toHaveLength(0)
})

test("Move title to head when rendering full document", async () => {
    const html = await new HTmpCompiler(globalOpts).compile(`
        <html>
            <head />
            <body>
                <title>Hello</title>
            </body>
        </html>
    `)

    const tree = await parseHtml(html)
    const title = selectOne("html > head > title", tree)
    expect(title).toBeTruthy()
    expect(innerText(title!)).toBe("Hello")
})

test("Titles in body take precedence over titles in head", async () => {
    const html = await new HTmpCompiler(globalOpts).compile(`
        <html>
            <head>
                <title>Original</title>
            </head>
            <body>
                <title>New</title>
            </body>
        </html>
    `)

    const tree = await parseHtml(html)
    const title = selectOne("html > head > title", tree)
    expect(title).toBeTruthy()
    expect(innerText(title!)).toBe("New")
})

test("Deepest title takes precedence", async () => {
    const html = await new HTmpCompiler(globalOpts).compile(`
        <html>
            <head>
                <title>Original</title>
            </head>
            <body>
                <title>New</title>
                <div>
                    <title>Newer</title>
                </div>
            </body>
        </html>
    `)

    const tree = await parseHtml(html)
    const title = selectOne("html > head > title", tree)
    expect(title).toBeTruthy()
    expect(innerText(title!)).toBe("Newer")
})

test("Titles are left in place when rendering partial document (option)", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        titleBehaviorInPartial: "preserve",
    }).compile("<title>Hello</title>")

    const tree = await parseHtml(html)
    const title = selectOne("title", tree)
    expect(title).toBeTruthy()
})

test("Titles are removed when rendering partial document (option)", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        titleBehaviorInPartial: "remove",
    }).compile("<title>Hello</title>")

    const tree = await parseHtml(html)
    const title = selectOne("title", tree)
    expect(title).toBeFalsy()
})
