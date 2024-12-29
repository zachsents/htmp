import { expect, test } from "bun:test"
import { render } from "posthtml-render"
import { HTempCompiler, onlyTags } from ".."
import { parseHtml } from "../lib/parser"

const hc = new HTempCompiler({
    componentsRoot: "./test/components",
    pretty: false,
})

test("Push tag gets pushed to stack", async () => {
    const html = await hc.compile(
        "<div><x-test /></div><stack name='test-stack' />",
        {
            components: {
                test: "<push stack='test-stack'><p>PUSHED</p></push>",
            },
        },
    )
    const tree = onlyTags(parseHtml(html))
    expect(render(tree[1])).toBe("<p>PUSHED</p>")
})

test("Elements pushed to stack are de-duped by id", async () => {
    const html = await hc.compile(
        `<div><x-a /><x-b /></div>
        <div><stack name='test-stack' /></div>`,
        {
            components: {
                a: "<push stack='test-stack'><p id='p-in-test-stack'>PUSHED FROM A</p></push>",
                b: "<push stack='test-stack'><p id='p-in-test-stack'>PUSHED FROM B</p></push>",
            },
        },
    )
    const tree = onlyTags(parseHtml(html))
    const snippet = render(tree[1])
    expect(snippet).toContain("PUSHED FROM A")
    expect(snippet).not.toContain("PUSHED FROM B")
})
