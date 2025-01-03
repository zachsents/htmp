export interface HTmpCompileOptions {
    /**
     * Optional object containing components. These will take precedence over
     * files in the componentsRoot.
     */
    components?: Record<string, string>
    /**
     * Where to look for components, which are just .html files.
     * Defaults to "./components"
     */
    componentsRoot?: string
    /**
     * The prefix to use for component tags.
     * Defaults to "x-"
     */
    componentTagPrefix?: string
    /**
     * The tag to use for components specified by name attribute.
     * An alternative to using the x- prefix pattern. Useful
     * for dynamically loading components.
     * Defaults to "component"
     */
    componentTag?: string
    /**
     * Whether or not to cache components loaded from files.
     * Defaults to true
     */
    cacheComponents?: boolean
    /**
     * The tag to use for yields.
     * Defaults to "yield"
     */
    yieldTag?: string
    /**
     * Whether to pretty-print the output. Uses prettier.
     * Defaults to true
     */
    pretty?: boolean
    /**
     * The attribute to use for passing attributes to components.
     * Defaults to "attr"
     */
    attrAttribute?: string
    /**
     * The tag to use for defining slots.
     * Defaults to "slot"
     */
    defineSlotTag?: string
    /**
     * The tag to use for filling slots.
     * Defaults to "fill"
     */
    fillSlotTag?: string
    /**
     * The tag to use for defining stacks.
     * Defaults to "stack"
     */
    stackTag?: string
    /**
     * The tag to use for pushing to stacks.
     * Defaults to "push"
     */
    pushTag?: string
    /**
     * The prefix for attributes that will be evaluated as
     * JavaScript.
     * Defaults to "eval"
     */
    evaluateAttributePrefix?: string
    /**
     * The pattern used to select content for evaluation.
     * The JS code should be contained in the first capture
     * group.
     * Defaults to `/%%(.+?)%%/g`
     */
    evaluateContentPattern?: RegExp
    /**
     * The tag used for dynamic content.
     * Defaults to "dynamic"
     */
    dynamicTag?: string
    /**
     * The context used for evaluating JavaScript.
     */
    evalContext?: Record<string, unknown>
    /**
     * Debug option. Prints the compiled step after every iteration.
     */
    debug?: boolean
    /**
     * Custom attribute merging strategies.
     */
    attributeMergeStrategies?:
        | Array<
              (
                  | {
                        pattern: RegExp
                    }
                  | {
                        name: string
                    }
              ) & {
                  merge: (
                      originalValue: string | undefined,
                      newValue: string,
                  ) => string | boolean | undefined | null
              }
          >
        | undefined
    /**
     * What to do with title tags found in the document when rendering
     * partial documents. This is useful for HTMX, because it handles
     * adding the document title.
     * Defaults to "preserve"
     */
    titleBehaviorInPartial?: "preserve" | "remove"
}

export function getDefaultOptions(
    passedOptions: HTmpCompileOptions,
): Required<HTmpCompileOptions> {
    const {
        components = {},
        componentsRoot = "./components",
        componentTagPrefix = "x-",
        componentTag = "component",
        cacheComponents = true,
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
        evalContext = {},
        debug = false,
        attributeMergeStrategies: passedAttributeMergeStrategies = [],
        titleBehaviorInPartial = "preserve",
    } = passedOptions

    // include default attribute merge strategies
    const attributeMergeStrategies = [...passedAttributeMergeStrategies]
    if (!attributeMergeStrategies.some(s => "name" in s && s.name === "class"))
        attributeMergeStrategies.push({
            name: "class",
            merge: (a, b) => `${a ?? ""} ${b}`.trim(),
        })
    if (!attributeMergeStrategies.some(s => "name" in s && s.name === "style"))
        attributeMergeStrategies.push({
            name: "style",
            merge: (a, b) => {
                let newA = a?.trim() ?? ""
                if (!newA.endsWith(";")) newA += ";"
                let newB = b.trim()
                if (!newB.endsWith(";")) newB += ";"
                return `${newA} ${newB}`.trim()
            },
        })

    return {
        components,
        componentsRoot,
        componentTagPrefix,
        componentTag,
        cacheComponents,
        yieldTag,
        pretty,
        attrAttribute,
        defineSlotTag,
        fillSlotTag,
        stackTag,
        pushTag,
        evaluateAttributePrefix,
        evaluateContentPattern,
        dynamicTag,
        evalContext,
        debug,
        attributeMergeStrategies,
        titleBehaviorInPartial,
    }
}
