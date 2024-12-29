import { expect, test } from "bun:test"
import { HTempCompiler, normalizeContent, onlyTags } from ".."
import { parseHtml } from "../lib/parser"
import { render } from "posthtml-render"

const hc = new HTempCompiler({
    componentsRoot: "./test/components",
    pretty: false,
})

test("Attributes with evaluate prefix are computed as JavaScript", async () => {
    const html = await hc.compile(
        "<div eval:data-test=\"'hello' + 'world'\" />",
    )
    const tree = onlyTags(parseHtml(html))
    expect(tree[0].attrs).toHaveProperty("data-test", "helloworld")
})

test("Evaluated attributes convert non-string values to strings", async () => {
    const html = await hc.compile('<div eval:data-test="1 + 2" />')
    const tree = onlyTags(parseHtml(html))
    expect(tree[0].attrs).toHaveProperty("data-test", "3")
})

test("Attributes evaluated to true are rendered as empty strings", async () => {
    const html = await hc.compile('<div eval:data-test="true" />')
    const tree = onlyTags(parseHtml(html))
    expect(tree[0].attrs).toHaveProperty("data-test", "")
})

test("Attributes evaluated to false are not rendered", async () => {
    const html = await hc.compile('<div eval:data-test="false" />')
    const tree = onlyTags(parseHtml(html))
    expect(tree[0].attrs).not.toHaveProperty("data-test")
})

test("Content inside %% %% is evaluated as JavaScript", async () => {
    const html = await hc.compile("<div>%%1 + 2%%</div>")
    const innerHtml = render(
        normalizeContent(onlyTags(parseHtml(html))[0].content),
    )
    expect(innerHtml).toBe("3")
})

test("Evaluated content works inline with other content", async () => {
    const html = await hc.compile("<div>I have %%1 + 2%% apples.</div>")
    const innerHtml = render(
        normalizeContent(onlyTags(parseHtml(html))[0].content),
    )
    expect(innerHtml).toBe("I have 3 apples.")
})

test("False and nullish values are rendered as empty strings", async () => {
    const html = await hc.compile("<div>%%false%%</div><div>%%null%%</div>")
    expect(html).toBe("<div></div><div></div>")
})

test("Evaluation works in components", async () => {
    const html = await hc.compile("<x-test />", {
        components: {
            test: "<div eval:data-test=\"'hello' + 'world'\">%%'hello' + 'world'%%</div>",
        },
    })
    expect(html).toBe('<div data-test="helloworld">helloworld</div>')
})

test("Evaluation happens before merging attributes", async () => {
    const html = await hc.compile("<x-test eval:data-test='3+5' />", {
        components: {
            test: "<div eval:data-test='1+2' />",
        },
    })
    const tree = onlyTags(parseHtml(html))
    expect(tree[0].attrs).toHaveProperty("data-test", "8")
})
