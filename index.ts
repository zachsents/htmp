import type { AnyNode, Element } from "domhandler"
import { isTag, isText, nextElementSibling, removeElement } from "domutils"
import fs from "node:fs/promises"
import path from "node:path"
import * as prettier from "prettier"
import type { HTmpCompileOptions } from "./lib/options"
import { parseHtml, renderHtml } from "./lib/parser"
import {
    copyAndReplace,
    findElement,
    findElements,
    findNodes,
} from "./lib/utils"

export async function compile(
    html: string,
    {
        components: componentsOverride = {},
        componentsRoot = "./components",
        componentTagPrefix = "x-",
        yieldTag = "yield",
        pretty = true,
        attrAttribute = "attr",
        defineSlotTag = "slot",
        fillSlotTag = "fill",
        stackTag = "stack",
        pushTag = "push",
        evaluateAttributePrefix = "eval",
        evaluateContentPattern = /%%(.+?)%%/g,
        dynamicTag = "dynamic",
    }: HTmpCompileOptions = {},
) {
    const tree = await parseHtml(html)

    // initialize component cache
    const componentContentCache = new Map<string, string>(
        Object.entries(componentsOverride).map(([k, v]) => {
            const kebabKey =
                k
                    .match(/[a-z]+|[A-Z][a-z]+|[A-Z]+|\d+/g)
                    ?.join("-")
                    .toLowerCase() ?? ""
            return [kebabKey, v] as const
        }),
    )

    // Do initial evaluations
    const evaluationOptions: Parameters<typeof expandEvaluations>[1] = {
        evaluateAttributePrefix,
        evaluateContentPattern,
        dynamicTag,
    }
    await expandEvaluations(tree, evaluationOptions)

    // Components
    const componentElements = findElements(tree, el =>
        el.tagName.startsWith(componentTagPrefix),
    )
    await Promise.all(
        componentElements.map(async el => {
            const componentName = el.tagName.slice(componentTagPrefix.length)

            // load into component cache
            if (!componentContentCache.has(componentName)) {
                const componentPath = path.join(
                    componentsRoot,
                    `${componentName.replaceAll(".", path.sep)}.html`,
                )
                try {
                    const componentContent = await fs.readFile(
                        componentPath,
                        "utf8",
                    )
                    componentContentCache.set(componentName, componentContent)
                } catch (err) {
                    if (
                        typeof err === "object" &&
                        err != null &&
                        "code" in err &&
                        err.code === "ENOENT"
                    )
                        throw new Error(`Component not found: ${el.tagName}`)
                    throw err
                }
            }

            const componentTree = await parseHtml(
                componentContentCache.get(componentName)!,
            )

            // do evaluations
            await expandEvaluations(componentTree, evaluationOptions)

            // organize attributes into a map
            const attrMap: Record<string, Record<string, string>> = {}
            for (const [k, v] of Object.entries(el.attribs)) {
                const { isMatch, segments } = colonMatch(3, k)
                if (isMatch && segments[0] === attrAttribute) {
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
                el => attrAttribute in el.attribs,
            )) {
                const attrVal = innerEl.attribs[attrAttribute]
                if (attrVal === "") foundDefaultAttributeTarget = true
                delete innerEl.attribs[attrAttribute]
                if (attrMap[attrVal])
                    Object.assign(innerEl.attribs, attrMap[attrVal])
            }

            // add attributes to first tag if no default slot was found
            if (!foundDefaultAttributeTarget && attrMap[""]) {
                const firstTag = componentTree.find(isTag)
                if (firstTag) Object.assign(firstTag.attribs, attrMap[""])
            }

            // organize content into slots and yields
            let yieldContent: AnyNode[] | undefined
            const slotContent: Record<string, AnyNode[] | undefined> = {}

            for (const child of el.children) {
                if (isTag(child) && child.tagName === fillSlotTag) {
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
            for (const yieldEl of findElements(componentTree, yieldTag)) {
                copyAndReplace(yieldEl, yieldContent ?? yieldEl.children)
            }

            // pass content through to slots
            for (const slotEl of findElements(componentTree, defineSlotTag)) {
                if (!("name" in slotEl.attribs))
                    throw new Error("Slot tag must have a name attribute")

                copyAndReplace(
                    slotEl,
                    slotContent[slotEl.attribs.name] ?? slotEl.children,
                )
            }

            // finish
            copyAndReplace(el, componentTree)
        }),
    )

    // Stacks
    const stackInfo: Record<
        string,
        {
            content: AnyNode[]
            ids: Set<string>
        }
    > = {}

    // find all pushes first
    for (const pushEl of findElements(tree, pushTag)) {
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
    for (const stackEl of findElements(tree, stackTag)) {
        if (!("name" in stackEl.attribs))
            throw new Error("Stack tag must have a name attribute")

        copyAndReplace(stackEl, stackInfo[stackEl.attribs.name]?.content ?? [])
    }

    let renderedHtml = renderHtml(tree)

    if (pretty)
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
 * Expands all evaluations for the tree.
 *
 * We have this as a separate function because it'll need
 * to be done both on the initial tree and on loaded
 * components. It needs to happen before any attribute merging
 * to accomodate custom merge strategies.
 */
async function expandEvaluations(
    nodes: AnyNode[],
    options: Required<
        Pick<
            HTmpCompileOptions,
            "evaluateAttributePrefix" | "evaluateContentPattern" | "dynamicTag"
        >
    >,
): Promise<void> {
    // evaluate attributes
    for (const el of findElements(nodes)) {
        for (const [k, v] of Object.entries(el.attribs)) {
            const { isMatch, segments } = colonMatch(2, k)
            if (!isMatch || segments[0] !== options.evaluateAttributePrefix)
                continue

            delete el.attribs[k]
            const evaluatedResult = indirectEval(v)

            // skip if result is false or null
            if (evaluatedResult === false || evaluatedResult == null) continue

            // true is an empty but included attribute
            if (evaluatedResult === true) el.attribs[segments[1]] = ""
            // otherwise, just try to make it a string
            else el.attribs[segments[1]] = `${evaluatedResult}`
        }
    }

    // evaluate content
    for (const textNode of findNodes(nodes, isText)) {
        textNode.data = textNode.data.replaceAll(
            options.evaluateContentPattern,
            (_, code) => {
                const evaluatedResult = indirectEval(code)
                // skip if result is false or null
                if (evaluatedResult === false || evaluatedResult == null)
                    return ""
                // otherwise, just try to make it a string
                return `${evaluatedResult}`
            },
        )
    }

    // dynamic tags
    for (const el of findElements(nodes, options.dynamicTag)) {
        if (!("tag" in el.attribs))
            throw new Error("Dynamic tag must have a tag attribute")

        const evaluatedResult = indirectEval(el.attribs.tag)

        // false or nullish results means remove the wrapper
        if (evaluatedResult == null || evaluatedResult === false) {
            copyAndReplace(el, el.children)
            continue
        }

        // if it's a valid string, replace the tag
        if (
            typeof evaluatedResult === "string" &&
            /^\S+$/.test(evaluatedResult)
        ) {
            el.tagName = evaluatedResult
            delete el.attribs.tag
            continue
        }

        throw new Error(
            "Dynamic tag tag attribute must evaluate to a string (with no spaces), nullish, or false.",
        )
    }

    // conditional tags
    for (const el of findElements(nodes, "if")) evaluateConditional(el)

    // now any leftover conditionals are errored
    if (findElement(nodes, "elseif")) throw new Error("Unexpected elseif")
    if (findElement(nodes, "else")) throw new Error("Unexpected else")

    // switch/case tags
    for (const el of findElements(nodes, "switch")) {
        if (!("value" in el.attribs))
            throw new Error("Switch tag must have a value attribute")

        const evaluatedResult = indirectEval(el.attribs.value)

        const caseChildren = el.children.filter(
            (n): n is Element => isTag(n) && n.tagName === "case",
        )

        const defaultCase = caseChildren.find(
            caseEl =>
                "default" in caseEl.attribs && !("case" in caseEl.attribs),
        )

        const winningCase = caseChildren.find(
            caseEl =>
                "case" in caseEl.attribs &&
                !("default" in caseEl.attribs) &&
                indirectEval(caseEl.attribs.case) === evaluatedResult,
        )

        if (winningCase) copyAndReplace(el, winningCase.children)
        else if (defaultCase) copyAndReplace(el, defaultCase.children)
        else removeElement(el)
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
        copyAndReplace(el, el.children)
        return
    }

    // falsy case
    const nextSibling = nextElementSibling(el)
    if (nextSibling) {
        if (nextSibling.tagName === "elseif") evaluateConditional(nextSibling)
        else if (nextSibling.tagName === "else")
            copyAndReplace(nextSibling, nextSibling.children)
    }
    removeElement(el)
}

export type { HTmpCompileOptions }
