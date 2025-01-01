import { HTmpCompiler } from "../.."
import { expect, test } from "bun:test"

test("Integration test 1", async () => {
    const html = await new HTmpCompiler({
        componentsRoot: "./test/integration-1/components",
        pretty: true,
    }).compile("<x-main />")

    const compareTo = `<header class="header main-header">
    <h1>Hello!</h1>
</header>
<main>
    <article class="max-w-sm mx-auto main-article">
    <h2>Integration Test</h2>
    <p>This demonstrates integration with components.</p>
    </article>

    <ul>
    <li>Item 1</li>

    <li>Item 2</li>

    <li>Item 3</li>
    </ul>
</main>
<footer class="footer">
    <p>&amp;copy; 2025 Your App. All rights reserved.</p>
</footer>`

    expect(html.replaceAll(/\s+/g, "")).toBe(compareTo.replaceAll(/\s+/g, ""))
})
