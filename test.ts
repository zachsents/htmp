import { parser } from "posthtml-parser"
import { compile } from "."

const html = await compile("<x-multi-yield>DHJHWD</x-multi-yield>", {
    componentsRoot: "./test/components",
})

console.log(html)
console.log(parser(html))
