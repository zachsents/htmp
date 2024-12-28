/***
 * This is a super thin wrapper around posthtml-parser that just
 * adds default options.
 */
import { parser, type Options as PosthtmlParserOptions } from "posthtml-parser"

const POSTHTML_PARSER_OPTIONS: PosthtmlParserOptions = {
    recognizeSelfClosing: true,
}

export function parseHtml(html: string, options?: PosthtmlParserOptions) {
    return parser(html, {
        ...POSTHTML_PARSER_OPTIONS,
        ...options,
    })
}
