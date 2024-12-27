import { parser } from "posthtml-parser"
import { compile } from "."

const html = await compile(
    // "<x-multi-yield class='hello' data-test='testing'>DHJHWD</x-multi-yield>",
    "<x-input class='test' attr:wrapper:data-test='hello' />",
    {
        componentsRoot: "./test/components",
    },
)

console.log(html)

console.log(parser(html))
