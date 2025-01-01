/***
 * Credit to https://github.com/wobsoriano/bun-lib-starter/blob/main/build.ts
 */
import dts from "bun-plugin-dts"

await Bun.build({
    entrypoints: ["./index.ts"],
    outdir: "./dist",
    target: "node",
    format: "esm",
    plugins: [dts()],
    // naming: "[dir]/[name].js",
})
