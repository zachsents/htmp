# HTmp: A Powerful HTML Templating Library

## Overview

HTmp is a versatile HTML templating library designed for developers who need dynamic and customizable server-side HTML generation. It processes HTML templates with advanced features like conditional rendering, loops, dynamic components, and more, providing an expressive way to build complex templates.

## Key Features

- **Components**: Define reusable HTML components with support for scoped properties.
- **Dynamic Attribute Values**: Evaluate and include attributes dynamically as JavaScript expressions.
- **Conditional Rendering**: Render elements conditionally using `<if>`, `<elseif>`, and `<else>` tags.
- **Switch/Case Rendering**: Define conditional rendering blocks with `<switch>` and `<case>` tags.
- **Loops**: Iterate over arrays directly in your templates with `<for>` tags.
- **Dynamic Tags**: Dynamically set HTML tag names using template logic.
- **Slot and Yield System**: Support for content slots and dynamic content replacement.
- **Stacks**: Define stackable content and include it anywhere in your templates.
- **Prettify Output**: Automatically format the output HTML using Prettier.

## Installation

Install HTmp via npm:

```bash
npm install @zachsents/htmp
```

## Usage

### Basic Example

```typescript
import { HTmpCompiler } from "htmp";

const compiler = new HTmpCompiler({
  components: {
    "header-component": "<header><h1>{{title}}</h1></header>",
  },
  pretty: true,
});

const template = `
<if condition="user.isLoggedIn">
  <p>Welcome, {{user.name}}!</p>
<elseif condition="user.isGuest" />
  <p>Welcome, Guest!</p>
<else>
  <p>Please log in.</p>
</if>`;

const html = await compiler.compile(template, { user: { isLoggedIn: true, name: "John" } });
console.log(html);
```

### Options

The `HTmpCompiler` accepts an options object:

- **`components`**: Object mapping component names to their HTML strings.
- **`componentsRoot`**: Path to load components from disk.
- **`dynamicTag`**: Tag used for dynamic tags (default: `<dynamic>`).
- **`pretty`**: Format the output HTML (default: `false`).
- **`evalContext`**: Default context for evaluating template expressions.
- **`debug`**: Enable debugging output (default: `false`).
- **`attributeMergeStrategies`**: Custom merging strategies for attributes.

### Attribute Evaluation

Dynamic attribute evaluation is a powerful feature in HTmp. Attributes prefixed with `eval:` are interpreted as JavaScript expressions and evaluated in the current scope:

```html
<div eval:id="'dynamic-' + user.id"></div>
```

This mechanic is also at play in dynamic component names, as shown below:

```html
<component eval:name="dynamicComponentName" title="Welcome!" />
```

### Components

Components allow for reusable template snippets. There are two ways to use components:

#### Primary Method: Using Prefix (`x-`)

Use the `x-` prefix to define components inline:

```html
<x-header-component title="Welcome!" />
```

#### Secondary Method: Using `<component>` Tag

Alternatively, use the `<component>` tag:

```html
<component name="header-component" title="Welcome!" />
```

#### Dynamic Component Names

You can use `eval:name` to dynamically determine the component name:

```html
<component eval:name="dynamicComponentName" title="Welcome!" />
```

### Conditional Rendering

```html
<if condition="user.isLoggedIn">
  <p>Welcome, {{user.name}}!</p>
</if>
<elseif condition="user.isGuest">
  <p>Welcome, Guest!</p>
</elseif>
<else>
  <p>Please log in.</p>
</else>
```

### Switch/Case Rendering

```html
<switch value="user.role">
  <case case="'admin'">
    <p>Welcome, Admin!</p>
  </case>
  <case case="'user'">
    <p>Welcome, User!</p>
  </case>
  <case default>
    <p>Welcome, Guest!</p>
  </case>
</switch>
```

### Loops

```html
<for item="item" in="items">
  <li>%% item %%</li>
</for>
```

### Slots and Yields

Define slots in components to allow content insertion:

```html
<template>
  <div>
    <div class="header">
      <slot name="header">Default Header</slot>
    </div>
    <div class="content">
      <slot>Default Content</slot>
    </div>
  </div>
</template>
```

Use slots in a parent template:

```html
<x-layout>
  <fill slot="header">
    <h1>Title</h1>
  </fill>
  <fill>
    <p>Main Content</p>
  </fill>
</x-layout>
```

### Dynamic Tags

```html
<dynamic tag="user.tag">
  <p>Dynamic Content</p>
</dynamic>
```

### Stacks

```html
<push stack="scripts">
  <script src="/app.js"></script>
</push>

<stack name="scripts" />
```

## Preloading Components

To preload components:

```typescript
await compiler.preloadComponents();
```

## API

### `HTmpCompiler.compile(html: string, additionalEvalContext?: Record<string, unknown>): Promise<string>`

Compiles the given HTML template with an optional evaluation context.

### `HTmpCompiler.preloadComponents(): Promise<void>`

Preloads components from the `componentsRoot` directory.

## Advanced Configuration

The library supports detailed configuration through the `HTmpCompileOptions` interface. Refer to the `options` documentation for fine-grained control over behavior.

## Error Handling

HTmp throws meaningful errors when templates are improperly defined. Examples include:

- Missing required attributes for tags like `<if>` or `<for>`.
- Invalid component definitions.
- Evaluation errors in template expressions.

## Debugging

Enable debugging to view intermediate HTML states:

```typescript
const compiler = new HTmpCompiler({ debug: true });
```

## License

This project is licensed under the MIT License. See the LICENSE file for details.

