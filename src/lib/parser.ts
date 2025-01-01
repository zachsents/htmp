import render from "dom-serializer"
import { type AnyNode, type ChildNode, DomHandler } from "domhandler"
import { Parser } from "htmlparser2"

export async function parseHtml(html: string): Promise<ChildNode[]> {
    return new Promise((resolve, reject) => {
        const handler = new DomHandler(
            (err, dom) => {
                if (err) return reject(err)
                resolve(dom)
            },
            {
                xmlMode: true,
            },
        )

        const parser = new Parser(handler, {
            lowerCaseAttributeNames: true,
            lowerCaseTags: true,
            recognizeSelfClosing: true,
            xmlMode: true,
        })

        parser.write(html)
        parser.end()
    })
}

export function renderHtml(dom: AnyNode | AnyNode[]) {
    return render(dom, {
        emptyAttrs: true,
        selfClosingTags: false,
    })
}
