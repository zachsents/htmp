import { HTmpCompiler } from "../.."

const html = await new HTmpCompiler({
    componentsRoot: "./test/integration-1/components",
    pretty: true,
}).compile("<x-main />")

console.log(html)
