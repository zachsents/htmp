import { parser } from "posthtml-parser"
import { compile } from "."

const html = await compile("<x-multi-yiel>DHJHWD</x-multi-yiel>", {
    componentsRoot: "./test/components",
})

console.log(html)
console.log(parser(html))
