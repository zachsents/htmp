import fs from "node:fs/promises"
import path from "node:path"
import { runInNewContext } from "node:vm"
import { type AnyNode, type ChildNode, Element } from "domhandler"
import {
    appendChild,
    innerText,
    isTag,
    isText,
    nextElementSibling,
    prepend,
    prependChild,
    removeElement,
} from "domutils"
import * as prettier from "prettier"
import { type HTmpCompileOptions, getDefaultOptions } from "./lib/options"
import { parseHtml, renderHtml } from "./lib/parser"
import { findElements } from "./lib/utils"

export class HTmpCompiler {
    private options: Required<HTmpCompileOptions>
    private passedComponents: Record<string, string>
    private componentCache: Map<string, string> = new Map()

    constructor(options: HTmpCompileOptions = {}) {
        this.options = getDefaultOptions(options)

        // convert components to kebab case and store
        this.passedComponents = Object.fromEntries(
            Object.entries(this.options.components).map(([k, v]) => {
                let newKey =
                    k.match(/[a-z]+|[A-Z][a-z]+|[A-Z]+|\d+/g)?.join("-") ?? k
                newKey = newKey.toLowerCase()
                return [newKey, v] as const
            }),
        )
    }

    public async compile(
        html: string,
        additionalEvalContext?: Record<string, unknown>,
    ) {
        const tree = await parseHtml(html)
        await this.processTree(tree, {
            ...this.options.evalContext,
            ...additionalEvalContext,
        })
        this.processStacks(tree)

        let renderedHtml = renderHtml(tree)

        if (this.options.debug)
            console.log(await prettier.format(renderedHtml, { parser: "html" }))

        if (this.options.pretty)
            renderedHtml = await prettier.format(renderedHtml, {
                parser: "html",
            })

        return renderedHtml
    }

    private async processTree(tree: AnyNode[], scope: object) {
        let cursor = 0
        while (tree[cursor]) {
            if (this.options.debug)
                console.log(await this.pretty(renderHtml(tree)))

            cursor += await this.processNode(tree[cursor], scope)
        }
    }

    private async processNode(
        node: AnyNode,
        prototypeScope: object,
    ): Promise<number> {
        const scope = Object.create(prototypeScope)

        if (isText(node)) {
            // evaluate content
            node.data = node.data.replaceAll(
                this.options.evaluateContentPattern,
                (_, code) => {
                    const evaluatedResult = runInNewContext(code, scope)
                    // skip if result is false or null
                    if (evaluatedResult === false || evaluatedResult == null)
                        return ""
                    // otherwise, just try to make it a string
                    return `${evaluatedResult}`
                },
            )
            return 1
        }

        if (!isTag(node)) return 1

        // evaluate attributes
        for (const [k, v] of Object.entries(node.attribs)) {
            const { isMatch, segments } = colonMatch(2, k)
            if (
                !isMatch ||
                segments[0] !== this.options.evaluateAttributePrefix
            )
                continue

            delete node.attribs[k]
            const evaluatedResult = runInNewContext(v, scope)

            // skip if result is false or null
            if (evaluatedResult === false || evaluatedResult == null) continue

            // true is an empty but included attribute
            if (evaluatedResult === true) node.attribs[segments[1]] = ""
            // otherwise, just try to make it a string
            else node.attribs[segments[1]] = `${evaluatedResult}`
        }

        // dynamic tags
        if (node.tagName === this.options.dynamicTag) {
            if (!("tag" in node.attribs))
                throw new Error("Dynamic tag must have a tag attribute")

            const evaluatedResult = runInNewContext(node.attribs.tag, scope)

            // recurse into content
            await this.processTree(node.children, scope)

            // false or nullish results means remove the wrapper
            if (evaluatedResult == null || evaluatedResult === false) {
                const childCount = node.children.length
                while (node.firstChild) prepend(node, node.firstChild)
                removeElement(node)
                return childCount
            }

            // if it's a valid string, replace the tag
            if (
                typeof evaluatedResult === "string" &&
                /^\S+$/.test(evaluatedResult)
            ) {
                node.tagName = evaluatedResult
                delete node.attribs.tag
                return 1
            }

            throw new Error(
                "Dynamic tag tag attribute must evaluate to a string (with no spaces), nullish, or false.",
            )
        }

        // conditional tags
        if (node.tagName === "if")
            return await this.processConditional(node, scope)

        // now any leftover conditionals are errored
        if (node.tagName === "elseif") throw new Error("Unexpected elseif")
        if (node.tagName === "else") throw new Error("Unexpected else")

        // switch/case tags
        if (node.tagName === "switch") {
            if (!("value" in node.attribs))
                throw new Error("Switch tag must have a value attribute")

            const evaluatedResult = runInNewContext(node.attribs.value, scope)

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
                        runInNewContext(caseEl.attribs.case, scope) ===
                            evaluatedResult,
                ) ?? defaultCase

            if (!winningCase) {
                removeElement(node)
                return 0
            }

            await this.processTree(winningCase.children, scope)

            const childCount = winningCase.children.length
            while (winningCase.firstChild) prepend(node, winningCase.firstChild)
            removeElement(node)
            return childCount
        }

        // loop tags
        if (node.tagName === "for") {
            if ("item" in node.attribs && "in" in node.attribs) {
                if (!/[a-zA-Z_$][a-zA-Z0-9_$]*/.test(node.attribs.item))
                    throw new Error(
                        "For tag item attribute must be a valid identifier",
                    )

                const evaluatedArray = runInNewContext(node.attribs.in, scope)
                if (!Array.isArray(evaluatedArray))
                    throw new Error(
                        "For tag in attribute must evaluate to an array",
                    )

                scope.__array = evaluatedArray
                let totalChildCount = 0

                for (const item of evaluatedArray) {
                    scope[node.attribs.item] = item
                    const innerTree = node.children.map(n => n.cloneNode(true))
                    await this.processTree(innerTree, scope)
                    totalChildCount += innerTree.length
                    for (const child of innerTree) prepend(node, child)
                }
                removeElement(node)
                return totalChildCount
            }

            throw new Error("For tag must have item and in attributes")
        }

        // components
        const isComponentByPrefix = node.tagName.startsWith(
            this.options.componentTagPrefix,
        )
        const isComponentByTag = node.tagName === this.options.componentTag
        if (isComponentByPrefix || isComponentByTag) {
            let componentName: string

            if (isComponentByTag) {
                if (!("name" in node.attribs))
                    throw new Error("Component tag must have a name attribute")
                componentName = node.attribs.name
                delete node.attribs.name
            } else if (isComponentByPrefix) {
                componentName = node.tagName.slice(
                    this.options.componentTagPrefix.length,
                )
            } else {
                // illegal state
                throw new Error("Invalid component tag")
            }

            let componentFileContent: string

            // first see if the component was passed in the constructor
            if (componentName in this.passedComponents) {
                componentFileContent = this.passedComponents[componentName]
            }
            // either pull from cache
            else if (
                this.options.cacheComponents &&
                this.componentCache.has(componentName)
            ) {
                componentFileContent = this.componentCache.get(componentName)!
            }
            // or load from file
            else {
                const directFilePath = path.join(
                    this.options.componentsRoot,
                    `${componentName.replaceAll(".", path.sep)}.html`,
                )

                const indexFilePath = path.join(
                    this.options.componentsRoot,
                    `${componentName.replaceAll(".", path.sep)}/index.html`,
                )

                componentFileContent = await fs
                    .readFile(directFilePath, "utf8")
                    .catch(err => {
                        if (!isENOENT(err)) throw err
                        return fs.readFile(indexFilePath, "utf8")
                    })
                    .catch(err => {
                        if (!isENOENT(err)) throw err
                        throw new Error(`Component not found: ${componentName}`)
                    })

                if (this.options.cacheComponents)
                    this.componentCache.set(componentName, componentFileContent)
            }

            const componentTree = await parseHtml(componentFileContent)

            const innerComponentScope = Object.create(scope)

            innerComponentScope.props = new Proxy(
                {} as Record<string, unknown>,
                {
                    get(target, key, receiver) {
                        if (typeof key === "string") {
                            if (key in target) return target[key]

                            const evalFlag = key.startsWith("$")
                            const varName = evalFlag ? key.slice(1) : key

                            if (varName in node.attribs) {
                                target[key] = evalFlag
                                    ? runInNewContext(
                                          node.attribs[varName],
                                          Object.create(scope),
                                      )
                                    : node.attribs[varName]
                                delete node.attribs[varName]
                                return target[key]
                            }
                        }
                        return Reflect.get(target, key, receiver)
                    },
                },
            )

            const serverScripts = componentTree.filter(
                n =>
                    isTag(n) && n.tagName === "script" && "server" in n.attribs,
            )
            for (const scriptEl of serverScripts) {
                runInNewContext(innerText(scriptEl), innerComponentScope)
                removeElement(scriptEl)
            }

            delete innerComponentScope.props

            await this.processTree(componentTree, innerComponentScope)

            // organize attributes into a map
            const attrMap: Record<string, Record<string, string>> = {}
            for (const [k, v] of Object.entries(node.attribs)) {
                const { isMatch, segments } = colonMatch(3, k)
                if (isMatch && segments[0] === this.options.attrAttribute) {
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
                el => this.options.attrAttribute in el.attribs,
            )) {
                const attrVal = innerEl.attribs[this.options.attrAttribute]
                if (attrVal === "") foundDefaultAttributeTarget = true
                delete innerEl.attribs[this.options.attrAttribute]
                if (attrMap[attrVal]) {
                    this.assignAttributesToElement(innerEl, attrMap[attrVal])
                }
            }

            // add attributes to first tag if no default slot was found
            if (!foundDefaultAttributeTarget && attrMap[""]) {
                const firstTag = componentTree.find(
                    (n): n is Element =>
                        isTag(n) &&
                        n.tagName !== "script" &&
                        n.tagName !== "style",
                )
                if (firstTag) {
                    this.assignAttributesToElement(firstTag, attrMap[""])
                }
            }

            // recurse into content
            await this.processTree(node.children, scope)

            // organize content into slots and yields
            let yieldContent: AnyNode[] | undefined
            const slotContent: Record<string, AnyNode[] | undefined> = {}
            for (const child of node.children) {
                if (
                    isTag(child) &&
                    child.tagName === this.options.fillSlotTag
                ) {
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
            for (const yieldEl of findElements(
                componentTree,
                this.options.yieldTag,
            )) {
                for (const child of yieldContent ?? yieldEl.children)
                    prepend(yieldEl, child.cloneNode(true))
                removeElement(yieldEl)
            }

            // pass content through to slots
            for (const slotEl of findElements(
                componentTree,
                this.options.defineSlotTag,
            )) {
                if (!("name" in slotEl.attribs))
                    throw new Error("Slot tag must have a name attribute")

                for (const child of slotContent[slotEl.attribs.name] ??
                    slotEl.children)
                    prepend(slotEl, child.cloneNode(true))
                removeElement(slotEl)
            }

            // insert component content
            const childCount = componentTree.length
            while (componentTree[0]) prepend(node, componentTree[0])
            removeElement(node)
            return childCount
        }

        await this.processTree(node.children, scope)
        return 1
    }

    private async processConditional(
        el: Element,
        scope: object,
    ): Promise<number> {
        let doesMatch = false

        if (el.tagName === "if" || el.tagName === "elseif") {
            if (!("condition" in el.attribs))
                throw new Error(
                    "Conditional tag must have a condition attribute",
                )

            doesMatch = !!runInNewContext(el.attribs.condition, scope)
        } else if (el.tagName === "else") {
            doesMatch = true
        } else
            throw new Error(
                `evaludateConditional called on invalid tag: ${el.tagName}`,
            )

        // truthy case
        if (doesMatch) {
            // recurse into content
            await this.processTree(el.children, scope)

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

            // insert content
            const childCount = el.children.length
            while (el.firstChild) prepend(el, el.firstChild)
            removeElement(el)
            return childCount
        }

        // falsy case
        const nextSibling = nextElementSibling(el)
        removeElement(el)

        return nextSibling &&
            (nextSibling.tagName === "elseif" || nextSibling.tagName === "else")
            ? await this.processConditional(nextSibling, scope)
            : 0
    }

    private processStacks(tree: AnyNode[]) {
        const stackInfo: Record<
            string,
            {
                content: ChildNode[]
                ids: Set<string>
            }
        > = {}

        // find all pushes first
        for (const pushEl of findElements(tree, this.options.pushTag)) {
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
            removeElement(pushEl)
        }

        // then insert the pushed content into the stack
        for (const stackEl of findElements(tree, this.options.stackTag)) {
            if (!("name" in stackEl.attribs))
                throw new Error("Stack tag must have a name attribute")

            for (const child of stackInfo[stackEl.attribs.name]?.content ?? [])
                prepend(stackEl, child.cloneNode(true))
            removeElement(stackEl)
        }

        // move titles to head
        // handle full documents -- probably only one but handle all
        const htmlEls = findElements(tree, "html")
        for (const htmlEl of htmlEls) {
            const body = htmlEl.children.find(
                (el): el is Element => isTag(el) && el.tagName === "body",
            )
            if (!body) continue

            // find deepest title
            const getDepth = (el: Element): number => {
                let current = el
                let depth = 0
                while (current.parent !== body) {
                    current = current.parent as Element
                    depth++
                }
                return depth
            }

            let deepestTitle: Element | undefined
            let deepestDepth = -Infinity

            for (const titleEl of findElements(body.children, "title")) {
                const depth = getDepth(titleEl)
                if (depth >= deepestDepth) {
                    deepestTitle = titleEl
                    deepestDepth = depth
                }
                removeElement(titleEl)
            }

            if (!deepestTitle) continue

            const existingHead = htmlEl.children.find(
                (el): el is Element => isTag(el) && el.tagName === "head",
            )

            if (existingHead) {
                for (const existingTitle of findElements(
                    existingHead.children,
                    "title",
                ))
                    removeElement(existingTitle)
                appendChild(existingHead, deepestTitle.cloneNode(true))
            } else {
                prependChild(
                    htmlEl,
                    new Element("head", {}, [deepestTitle.cloneNode(true)]),
                )
            }
        }

        // optionally remove titles in partial documents
        if (
            this.options.titleBehaviorInPartial === "remove" &&
            htmlEls.length === 0
        ) {
            for (const titleEl of findElements(tree, "title"))
                removeElement(titleEl)
        }
    }

    private assignAttributesToElement(
        target: Element,
        sourceAttributes: Record<string, string>,
    ) {
        for (const [k, v] of Object.entries(sourceAttributes)) {
            let mergeFn = this.options.attributeMergeStrategies.find(
                s => "name" in s && s.name === k,
            )?.merge
            mergeFn ??= this.options.attributeMergeStrategies.find(
                s => "pattern" in s && s.pattern.test(k),
            )?.merge
            mergeFn ??= (_, val) => val

            const mergeResult = mergeFn(target.attribs[k], v)

            if (typeof mergeResult === "string") target.attribs[k] = mergeResult
            else if (typeof mergeResult === "boolean" && mergeResult)
                target.attribs[k] = ""
            else delete target.attribs[k]
        }
    }

    private async pretty(html: string) {
        return await prettier.format(html, { parser: "html" })
    }

    public async preloadComponents() {
        const loadComponents = async (
            dir = this.options.componentsRoot,
            segments: string[] = [],
            startingDir = dir,
        ) => {
            const fileEntries = await fs.readdir(dir, { withFileTypes: true })

            await Promise.all(
                fileEntries.map(async entry => {
                    if (entry.isDirectory())
                        return loadComponents(
                            path.join(dir, entry.name),
                            [...segments, entry.name],
                            startingDir,
                        )

                    if (!entry.isFile()) return

                    const nameMatch = entry.name.match(/^([\w\-]+)\.html$/)
                    if (!nameMatch) return

                    const content = await fs.readFile(
                        path.join(dir, entry.name),
                        "utf8",
                    )

                    const componentName =
                        nameMatch[1] === "index" && dir !== startingDir
                            ? segments.join(".")
                            : [...segments, nameMatch[1]].join(".")

                    this.componentCache.set(componentName, content)
                }),
            )
        }

        await loadComponents()
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

function isENOENT(err: unknown): err is ErrnoException {
    return (
        typeof err === "object" &&
        err != null &&
        "code" in err &&
        err.code === "ENOENT"
    )
}

export type { HTmpCompileOptions }
