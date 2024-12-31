import { expect, test } from "bun:test"
import { HTmpCompiler } from ".."
import { parseHtml } from "../lib/parser"
import { isTag } from "domhandler"
import { findElement } from "../lib/utils"

const hc = new HTmpCompiler({
    componentsRoot: "./test/components",
    pretty: false,
})

test("Attributes with evaluate prefix are computed as JavaScript", async () => {
    const html = await hc.compile(
        "<div eval:data-test=\"'hello' + 'world'\" />",
    )
    const tree = (await parseHtml(html)).filter(isTag)
    expect(tree[0].attribs).toHaveProperty("data-test", "helloworld")
})

test("Evaluated attributes convert non-string values to strings", async () => {
    const html = await hc.compile('<div eval:data-test="1 + 2" />')
    const tree = (await parseHtml(html)).filter(isTag)
    expect(tree[0].attribs).toHaveProperty("data-test", "3")
})

test("Attributes evaluated to true are rendered as empty strings", async () => {
    const html = await hc.compile('<div eval:data-test="true" />')
    const tree = (await parseHtml(html)).filter(isTag)
    expect(tree[0].attribs).toHaveProperty("data-test", "")
})

test("Attributes evaluated to false are not rendered", async () => {
    const html = await hc.compile('<div eval:data-test="false" />')
    const tree = (await parseHtml(html)).filter(isTag)
    expect(tree[0].attribs).not.toHaveProperty("data-test")
})

test("Content inside %% %% is evaluated as JavaScript", async () => {
    const html = await hc.compile("<div>%%1 + 2%%</div>")
    expect(html).toBe("<div>3</div>")
})

test("Evaluated content works inline with other content", async () => {
    const html = await hc.compile("<div>I have %%1 + 2%% apples.</div>")
    expect(html).toBe("<div>I have 3 apples.</div>")
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
    const div = findElement(await parseHtml(html), "div")
    expect(div).toBeDefined()
    expect(div!.attribs).toHaveProperty("data-test", "8")
})

test("Dynamic tags are computed", async () => {
    const html = await hc.compile("<dynamic tag=\"'div'\" />")
    expect(html).toBe("<div></div>")
})

test("Nullish tag evaluations are removed", async () => {
    const html = await hc.compile('<dynamic tag="null">TEST</dynamic>')
    expect(html).toBe("TEST")
})

test("False tag evaluations are removed", async () => {
    const html = await hc.compile('<dynamic tag="false">TEST</dynamic>')
    expect(html).toBe("TEST")
})

test("Other attributes are preserved on dynamic tags", async () => {
    const html = await hc.compile("<dynamic tag=\"'div'\" class='test' />")
    expect(html).toBe('<div class="test"></div>')
})

test("Dynamic tag evaluations cannot be invalid values", async () => {
    const promise1 = hc.compile("<dynamic tag='1' />")
    expect(promise1).rejects.toBeDefined()
    const promise2 = hc.compile("<dynamic tag='tag with space' />")
    expect(promise2).rejects.toBeDefined()
})

test("Conditional tags evaluated to true are rendered", async () => {
    const html = await hc.compile("<if condition='true'>TEST</if>")
    expect(html.trim()).toBe("TEST")
})

test("Conditional tags evaluated to false are not rendered", async () => {
    const html = await hc.compile("<if condition='false'>TEST</if>")
    expect(html.trim()).toBe("")
})

test("Else tags are rendered if condition is false", async () => {
    const html = await hc.compile(
        "<if condition='false'>TEST</if><else>ELSE</else>",
    )
    expect(html.trim()).toBe("ELSE")
})

test("Else-if chains work", async () => {
    const html = await hc.compile(
        `<if condition='false'>TEST</if>
        <elseif condition='true'>ELSE IF</elseif>
        <else>ELSE</else>`,
    )
    expect(html.trim()).toBe("ELSE IF")
})

test("Non-consecutive if/elseif/else tags are treated like different branches", async () => {
    const html = await hc.compile(
        `<if condition='false'>TEST A</if>
        <div>Hello</div>
        <!-- These should be ignored -->
        <if condition='true'>TEST B</if>
        <else>TEST C</else>`,
    )
    expect(html).not.toContain("TEST A")
    expect(html).toContain("TEST B")
    expect(html).not.toContain("TEST C")
})

test("Hanging elseif tags throw an error", async () => {
    const promise = hc.compile("<elseif />")
    expect(promise).rejects.toThrow()
})

test("Hanging else tags throw an error", async () => {
    const promise = hc.compile("<else />")
    expect(promise).rejects.toThrow()
})

test("Switch-case rendering for matching case", async () => {
    const html = await hc.compile(
        `<switch value="'apple'">
            <case case="'apple'">Apple case</case>
            <case case="'banana'">Banana case</case>
        </switch>`,
    )
    expect(html.trim()).toBe("Apple case")
})

test("Switch-case rendering for non-matching cases and default case", async () => {
    const html = await hc.compile(
        `<switch value="'orange'">
            <case case="'apple'">Apple case</case>
            <case case="'banana'">Banana case</case>
            <case default>Default case</case>
        </switch>`,
    )
    expect(html.trim()).toBe("Default case")
})

test("Switch-case with no match and no default results in empty output", async () => {
    const html = await hc.compile(
        `<switch value="'grape'">
            <case case="'apple'">Apple</case>
            <case case="'banana'">Banana</case>
        </switch>`,
    )
    expect(html.trim()).toBe("")
})

test("Switch evaluates to no output with only default", async () => {
    const html = await hc.compile(
        `<switch value="'pear'">
            <case default>Default only case</case>
        </switch>`,
    )
    expect(html.trim()).toBe("Default only case")
})

test("Switch with a complex JavaScript evaluation", async () => {
    const html = await hc.compile(
        `<switch value="1 + 1">
            <case case="2">Case for 2</case>
            <case default>Default case</case>
        </switch>`,
    )
    expect(html.trim()).toBe("Case for 2")
})

test("Switch-case ignores non-matching cases", async () => {
    const html = await hc.compile(
        `<switch value="'banana'">
            <case case="'apple'">Wrong</case>
            <case case="'banana'">Correct</case>
            <case case="'orange'">Wrong</case>
        </switch>`,
    )
    expect(html.trim()).toBe("Correct")
})
