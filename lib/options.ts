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
}

export function getDefaultOptions(
    passedOptions: HTmpCompileOptions,
): Required<HTmpCompileOptions> {
    const {
        components = {},
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
        evalContext = {},
        debug = false,
    } = passedOptions

    // convert components to kebab case
    const convertedComponents = Object.fromEntries(
        Object.entries(components).map(([k, v]) => {
            let newKey =
                k.match(/[a-z]+|[A-Z][a-z]+|[A-Z]+|\d+/g)?.join("-") ?? k
            newKey = newKey.toLowerCase()
            return [newKey, v] as const
        }),
    )

    return {
        components: convertedComponents,
        componentsRoot,
        componentTagPrefix,
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
    }
}
