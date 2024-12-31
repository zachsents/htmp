import { expect, test } from "bun:test"
import { HTmpCompiler } from ".."

const hc = new HTmpCompiler({
    componentsRoot: "./test/components",
    pretty: false,
})

test("Minimal fragment compiles in under 2ms", async () => {
    /* for some reason calling it first (even with a different tree) 
    makes it like 10x faster. thank you Jarred 🙏 */
    hc.compile("")

    const start = performance.now()
    hc.compile("")
    const end = performance.now()
    expect(end - start).toBeLessThan(2)
})
