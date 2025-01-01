import { HTmpCompiler } from "."

const hc = new HTmpCompiler({
    evalContext: {
        test: "hello",
    },
    debug: true,
})
await hc.compile("<x-prop-test data-test=5 a=test>%% test %%</x-prop-test>")
// await hc.compile("<div data-test=5 a=test>%% test %%</div>")

console.log("Done!")
