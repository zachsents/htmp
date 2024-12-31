import type { AnyNode, Element } from "domhandler"
import {
    hasChildren,
    isTag,
    isText,
    nextElementSibling,
    prepend,
    removeElement,
} from "domutils"
import fs from "node:fs/promises"
import path from "node:path"
import * as prettier from "prettier"
import { type HTmpCompileOptions, getDefaultOptions } from "./lib/options"
import { parseHtml, renderHtml } from "./lib/parser"
import { findElements } from "./lib/utils"

async function processTree(
    tree: AnyNode[],
    opts: Required<HTmpCompileOptions>,
) {
    let cursor = 0
    while (tree[cursor]) {
        if (opts.debug)
            console.log(
                await prettier.format(renderHtml(tree), { parser: "html" }),
            )

        const currentNode = tree[cursor]
        const shouldProceed = await processNode(currentNode, opts)

        // re-runs the loop without changing the cursor position
        if (!shouldProceed) continue

        // recurse into children
        if (hasChildren(currentNode))
            await processTree(currentNode.children, opts)

        // proceed to next node
        cursor++
    }
}

async function processNode(
    node: AnyNode,
    opts: Required<HTmpCompileOptions>,
): Promise<void | boolean> {
    const runScript = indirectEval

    if (isText(node)) {
        // evaluate content
        node.data = node.data.replaceAll(
            opts.evaluateContentPattern,
            (_, code) => {
                const evaluatedResult = runScript(code)
                // skip if result is false or null
                if (evaluatedResult === false || evaluatedResult == null)
                    return ""
                // otherwise, just try to make it a string
                return `${evaluatedResult}`
            },
        )
        return true
    }

    if (!isTag(node)) return true

    // evaluate attributes
    evaluateAttributes(node, opts, runScript)

    // dynamic tags
    if (node.tagName === opts.dynamicTag) {
        if (!("tag" in node.attribs))
            throw new Error("Dynamic tag must have a tag attribute")

        const evaluatedResult = runScript(node.attribs.tag)

        // false or nullish results means remove the wrapper
        if (evaluatedResult == null || evaluatedResult === false) {
            while (node.firstChild) prepend(node, node.firstChild)
            removeElement(node)
            return
        }

        // if it's a valid string, replace the tag
        if (
            typeof evaluatedResult === "string" &&
            /^\S+$/.test(evaluatedResult)
        ) {
            node.tagName = evaluatedResult
            delete node.attribs.tag
            return true
        }

        throw new Error(
            "Dynamic tag tag attribute must evaluate to a string (with no spaces), nullish, or false.",
        )
    }

    // conditional tags
    if (node.tagName === "if") {
        evaluateConditional(node)
        return
    }

    // now any leftover conditionals are errored
    if (node.tagName === "elseif") throw new Error("Unexpected elseif")
    if (node.tagName === "else") throw new Error("Unexpected else")

    // switch/case tags
    if (node.tagName === "switch") {
        if (!("value" in node.attribs))
            throw new Error("Switch tag must have a value attribute")

        const evaluatedResult = runScript(node.attribs.value)

        const caseChildren = node.children.filter(
            (n): n is Element => isTag(n) && n.tagName === "case",
        )

        const defaultCase = caseChildren.find(
            caseEl =>
                "default" in caseEl.attribs && !("case" in caseEl.attribs),
        )

        const winningCase =
            caseChildren.find(
                caseEl =>
                    "case" in caseEl.attribs &&
                    !("default" in caseEl.attribs) &&
                    runScript(caseEl.attribs.case) === evaluatedResult,
            ) ?? defaultCase

        if (winningCase) {
            while (winningCase.firstChild) prepend(node, winningCase.firstChild)
        }
        removeElement(node)
        return
    }

    // loop tags
    if (node.tagName === "for") {
        if ("item" in node.attribs && "in" in node.attribs) {
            if (!/[a-zA-Z_$][a-zA-Z0-9_$]*/.test(node.attribs.item))
                throw new Error(
                    "For tag item attribute must be a valid identifier",
                )

            const evaluatedResult = runScript(node.attribs.in)
            if (!(Symbol.iterator in evaluatedResult))
                throw new Error(
                    "For tag in attribute must evaluate to an array",
                )

            for (const item of evaluatedResult) {
            }
            return
        }
        throw new Error("For tag must have item and in attributes")
    }

    // components
    if (node.tagName.startsWith(opts.componentTagPrefix)) {
        const componentName = node.tagName.slice(opts.componentTagPrefix.length)

        // load into component cache
        if (!(componentName in opts.components)) {
            const componentPath = path.join(
                opts.componentsRoot,
                `${componentName.replaceAll(".", path.sep)}.html`,
            )
            try {
                const componentContent = await fs.readFile(
                    componentPath,
                    "utf8",
                )
                opts.components[componentName] = componentContent
            } catch (err) {
                if (
                    typeof err === "object" &&
                    err != null &&
                    "code" in err &&
                    err.code === "ENOENT"
                )
                    throw new Error(`Component not found: ${node.tagName}`)
                throw err
            }
        }

        const componentTree = await parseHtml(opts.components[componentName])

        // organize attributes into a map
        const attrMap: Record<string, Record<string, string>> = {}
        for (const [k, v] of Object.entries(node.attribs)) {
            const { isMatch, segments } = colonMatch(3, k)
            if (isMatch && segments[0] === opts.attrAttribute) {
                // assign to attribute slot
                attrMap[segments[1]] ??= {}
                attrMap[segments[1]][segments[2]] = v
            } else {
                // default attribute slot
                attrMap[""] ??= {}
                attrMap[""][k] = v
            }
        }

        // pass attributes through to component
        let foundDefaultAttributeTarget = false
        for (const innerEl of findElements(
            componentTree,
            el => opts.attrAttribute in el.attribs,
        )) {
            const attrVal = innerEl.attribs[opts.attrAttribute]
            if (attrVal === "") foundDefaultAttributeTarget = true
            delete innerEl.attribs[opts.attrAttribute]
            if (attrMap[attrVal]) {
                // evaluate first to enable custom merging strategies
                evaluateAttributes(innerEl, opts, runScript)
                Object.assign(innerEl.attribs, attrMap[attrVal])
            }
        }

        // add attributes to first tag if no default slot was found
        if (!foundDefaultAttributeTarget && attrMap[""]) {
            const firstTag = componentTree.find(isTag)
            if (firstTag) {
                // evaluate first to enable custom merging strategies
                evaluateAttributes(firstTag, opts, runScript)
                Object.assign(firstTag.attribs, attrMap[""])
            }
        }

        // organize content into slots and yields
        let yieldContent: AnyNode[] | undefined
        const slotContent: Record<string, AnyNode[] | undefined> = {}
        for (const child of node.children) {
            if (isTag(child) && child.tagName === opts.fillSlotTag) {
                if (!("slot" in child.attribs))
                    throw new Error("Fill tag must have a slot attribute")
                slotContent[child.attribs.slot] ??= []
                slotContent[child.attribs.slot]!.push(...child.children)
                continue
            }
            yieldContent ??= []
            yieldContent.push(child)
        }

        // pass content through to yields
        for (const yieldEl of findElements(componentTree, opts.yieldTag)) {
            for (const child of yieldContent ?? yieldEl.children)
                prepend(yieldEl, child.cloneNode(true))
            removeElement(yieldEl)
        }

        // pass content through to slots
        for (const slotEl of findElements(componentTree, opts.defineSlotTag)) {
            if (!("name" in slotEl.attribs))
                throw new Error("Slot tag must have a name attribute")

            for (const child of slotContent[slotEl.attribs.name] ??
                slotEl.children)
                prepend(slotEl, child.cloneNode(true))
            removeElement(slotEl)
        }

        // insert component content
        while (componentTree[0]) prepend(node, componentTree[0])
        removeElement(node)

        return
    }

    return true
}

function processStacks(tree: AnyNode[], opts: Required<HTmpCompileOptions>) {
    const stackInfo: Record<
        string,
        {
            content: AnyNode[]
            ids: Set<string>
        }
    > = {}

    // find all pushes first
    for (const pushEl of findElements(tree, opts.pushTag)) {
        if (!("stack" in pushEl.attribs))
            throw new Error("Push tag must have a stack attribute")

        const stackName = pushEl.attribs.stack
        stackInfo[stackName] ??= { content: [], ids: new Set() }

        // only push content if the id is not already in the stack
        for (const child of pushEl.children) {
            if (isTag(child) && "id" in child.attribs) {
                if (stackInfo[stackName].ids.has(child.attribs.id)) continue
                stackInfo[stackName].ids.add(child.attribs.id)
            }
            stackInfo[stackName].content.push(child)
        }
    }

    // then insert the pushed content into the stack
    for (const stackEl of findElements(tree, opts.stackTag)) {
        if (!("name" in stackEl.attribs))
            throw new Error("Stack tag must have a name attribute")

        for (const child of stackInfo[stackEl.attribs.name]?.content ?? [])
            prepend(stackEl, child.cloneNode(true))
        removeElement(stackEl)
    }
}

function evaluateAttributes(
    node: Element,
    opts: Required<HTmpCompileOptions>,
    runScript: (code: string) => unknown,
) {
    for (const [k, v] of Object.entries(node.attribs)) {
        const { isMatch, segments } = colonMatch(2, k)
        if (!isMatch || segments[0] !== opts.evaluateAttributePrefix) continue

        delete node.attribs[k]
        const evaluatedResult = runScript(v)

        // skip if result is false or null
        if (evaluatedResult === false || evaluatedResult == null) continue

        // true is an empty but included attribute
        if (evaluatedResult === true) node.attribs[segments[1]] = ""
        // otherwise, just try to make it a string
        else node.attribs[segments[1]] = `${evaluatedResult}`
    }
}

export async function compile(html: string, options: HTmpCompileOptions) {
    const opts = getDefaultOptions(options)
    const tree = await parseHtml(html)
    await processTree(tree, opts)
    processStacks(tree, opts)

    let renderedHtml = renderHtml(tree)

    if (opts.debug)
        console.log(await prettier.format(renderedHtml, { parser: "html" }))

    if (opts.pretty)
        renderedHtml = await prettier.format(renderedHtml, { parser: "html" })

    return renderedHtml
}

export class HTmpCompiler {
    constructor(private options: HTmpCompileOptions) {}

    async compile(html: string, options?: Partial<HTmpCompileOptions>) {
        return compile(html, {
            ...this.options,
            ...options,
        })
    }
}

/**
 * Small helper to match segments split by colons. Need
 * special handling since some colons are used in the
 * attribute syntax.
 */
function colonMatch(
    numSegments: number,
    str: string,
): { isMatch: boolean; segments: string[] } {
    const pattern = new RegExp(`^${"(.+?):".repeat(numSegments - 1)}(.+)$`)
    const match = str.match(pattern)
    return match
        ? {
              isMatch: true,
              segments: match.slice(1),
          }
        : {
              isMatch: false,
              segments: [],
          }
}

/**
 * Uses indirect eval in strict mode to evaluate the string.
 */
function indirectEval(str: string) {
    return eval?.(`"use strict";\n${str}`)
}

function evaluateConditional(el: Element) {
    if (!("condition" in el.attribs))
        throw new Error("Conditional tag must have a condition attribute")

    const evaluatedResult = indirectEval(el.attribs.condition)

    // truthy case
    if (evaluatedResult) {
        // find & remove subsequent elseifs and elses
        while (true) {
            const nextSibling = nextElementSibling(el)
            if (!nextSibling) break

            if (
                nextSibling.tagName === "elseif" ||
                nextSibling.tagName === "else"
            ) {
                removeElement(nextSibling)
                continue
            }

            break
        }
        while (el.firstChild) prepend(el, el.firstChild)
        removeElement(el)
        return
    }

    // falsy case
    const nextSibling = nextElementSibling(el)
    if (nextSibling) {
        if (nextSibling.tagName === "elseif") evaluateConditional(nextSibling)
        else if (nextSibling.tagName === "else") {
            while (nextSibling.firstChild)
                prepend(nextSibling, nextSibling.firstChild)
            removeElement(nextSibling)
        }
    }
    removeElement(el)
}

export type { HTmpCompileOptions }
