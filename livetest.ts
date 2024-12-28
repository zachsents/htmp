import { compile } from "."
import { parseHtml } from "./lib/parser"

const html = await compile(
    `<x-slot-test>
        <fill:paragraph>PARAGRAPH</fill:paragraph>
        <fill:foot>FOOTER</fill:foot>
    </x-slot-test>`,
    {
        componentsRoot: "./test/components",
    },
)

console.log(html)

console.log(parseHtml(html))
