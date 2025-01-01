import { expect, test } from "bun:test"
import { innerText, isTag } from "domutils"
import { type HTmpCompileOptions, HTmpCompiler } from "../src"
import { parseHtml } from "../src/lib/parser"

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

    const elements = (await parseHtml(html)).filter(isTag)

    expect(elements[0].tagName).toBe("div")
    expect(elements[1].tagName).toBe("p")
})

test("Elements pushed to stack are de-duped by id", async () => {
    const html = await new HTmpCompiler({
        ...globalOpts,
        components: {
            a: "<push stack='test-stack'><p id='p-in-test-stack'>PUSHED FROM A</p></push>",
            b: "<push stack='test-stack'><p id='p-in-test-stack'>PUSHED FROM B</p></push>",
        },
    }).compile(
        `<div><x-a /><x-b /></div>
        <div><stack name='test-stack' /></div>`,
    )

    const elements = (await parseHtml(html)).filter(isTag)

    expect(innerText(elements[1]).trim()).toBe("PUSHED FROM A")
})
