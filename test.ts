import { compile } from "."

const html = await compile(
    `<x-button>Test</x-button>
    <div><a>
        <x-button>Hey!</x-button>
    </a></div>`,
)

console.log(html)
