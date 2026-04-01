# Extending Language Support in Cynapx

This document explains how to add support for a new programming language by implementing a **language provider** and installing it in the Cynapx plugin directory.

---

## Table of Contents

1. [Overview](#overview)
2. [Installation Directory](#installation-directory)
3. [The `LanguageProvider` Interface](#the-languageprovider-interface)
4. [Tree-sitter Query Syntax](#tree-sitter-query-syntax)
5. [Step-by-Step Guide](#step-by-step-guide)
6. [Available SymbolTypes](#available-symboltypes)
7. [Loading Verification](#loading-verification)
8. [Troubleshooting](#troubleshooting)

---

## Overview

Cynapx uses [tree-sitter](https://tree-sitter.github.io/tree-sitter/) to parse source code into a knowledge graph of symbols and relationships. Each language that Cynapx can index is backed by a **language provider** — a class that supplies:

- The file extensions it handles (e.g., `['rb']` for Ruby)
- The tree-sitter grammar to use
- A tree-sitter query that extracts symbols and relationships
- A mapping from query capture names to Cynapx `SymbolType` values
- (Optionally) import-resolution logic for cross-file dependency edges

The `LanguageRegistry` at startup automatically scans `~/.cynapx/plugins/` and loads any `.js` or `.ts` files it finds there. Every exported class that satisfies the `LanguageProvider` interface is registered automatically — no configuration file is required.

---

## Installation Directory

Place your compiled provider file in:

```
~/.cynapx/plugins/
```

On Windows, `~` resolves to `%USERPROFILE%` (e.g., `C:\Users\yourname`).

The directory is created by you; Cynapx will not create it automatically, but will silently skip it if it does not exist. Only `.js` and `.ts` files are scanned. The registry loads them with `require()`, so compiled CommonJS modules (`.js`) are the most reliable format.

---

## The `LanguageProvider` Interface

```typescript
export interface LanguageProvider {
    extensions: string[];
    languageName: string;
    getLanguage(): any;
    getQuery(): string;
    mapCaptureToSymbolType(captureName: string): SymbolType;
    resolveImport?(node: Parser.SyntaxNode, filePath: string, edges: RawCodeEdge[], captureName?: string): void;
    getDecisionPoints(): string[];
}
```

### `extensions: string[]`

A list of file extensions (without the leading dot) that this provider handles. Extensions are matched case-insensitively. If your provider handles both `.rb` and `.rake` files, set this to `['rb', 'rake']`.

If two providers claim the same extension, the one loaded most recently wins. External plugins always take precedence over internal built-in providers because plugins are scanned after the internal extension map is populated.

### `languageName: string`

A human-readable name stored in the `language` field of every `CodeNode` emitted by this provider (e.g., `'ruby'`, `'elixir'`).

### `getLanguage(): any`

Returns the tree-sitter language object — typically the default export of a `tree-sitter-<lang>` npm package. This is passed directly to `Parser.setLanguage()`.

```typescript
import Ruby from 'tree-sitter-ruby';

getLanguage() {
    return Ruby;
}
```

### `getQuery(): string`

Returns a tree-sitter S-expression query string. The query declares captures (names prefixed with `@`) that the parser uses to extract symbols and relationships. The capture naming conventions are described in the [Tree-sitter Query Syntax](#tree-sitter-query-syntax) section below.

You may inline the query string or read it from an `.scm` file on disk.

### `mapCaptureToSymbolType(captureName: string): SymbolType`

Translates a capture name (e.g., `'class.def'`) to a Cynapx `SymbolType` (e.g., `'class'`). The return value determines how the symbol appears in the knowledge graph. See [Available SymbolTypes](#available-symboltypes) for all valid values.

When a capture name has no meaningful symbol type (e.g., a relationship or import capture), return `'field'` as a safe fallback — those captures are handled separately by `resolveImport`.

### `resolveImport(node, filePath, edges, captureName?)` (optional)

Called for nodes that match `relation.*` and `import.*` captures. Use this to push `RawCodeEdge` entries into `edges`, which become edges in the knowledge graph.

| Parameter | Description |
|---|---|
| `node` | The `Parser.SyntaxNode` that was captured |
| `filePath` | Qualified name of the source file or containing symbol |
| `edges` | Array to push resolved `RawCodeEdge` objects into |
| `captureName` | The capture name that triggered this call (e.g., `'relation.inherits'`) |

If this method is omitted, import and relation captures are silently ignored.

### `getDecisionPoints(): string[]`

Returns a list of tree-sitter node type names that represent branching or looping constructs (e.g., `if_statement`, `case_expression`). These are used to compute the cyclomatic complexity of each symbol.

Return an empty array `[]` if you do not need complexity metrics, but providing accurate values improves code analysis quality.

---

## Tree-sitter Query Syntax

Cynapx uses a set of **capture naming conventions** that tree-sitter-parser interprets:

| Capture pattern | Meaning |
|---|---|
| `@class.def` | The node that defines a class (the whole class body node) |
| `@class.name` | The identifier node containing the class name |
| `@function.def` | The node that defines a top-level function |
| `@function.name` | The identifier node containing the function name |
| `@method.def` | The node that defines a method inside a class |
| `@method.name` | The identifier node containing the method name |
| `@relation.inherits` | A node whose text is the name of a parent class (inheritance) |
| `@import.stmt` | A full import/require statement node |
| `@import.from_stmt` | An import-from statement node (e.g., `from x import y`) |
| `@call.name` | The identifier of a function or method being called |
| `@call.expr` | The full call expression node |

**Naming rules:**

- Prefix determines how the capture is handled: `class.`, `function.`, `method.` produce `CodeNode` entries; `relation.` and `import.` trigger `resolveImport`; `call.` is used for call-graph edges.
- The `.def` suffix marks the enclosing node for a symbol definition. The `.name` suffix marks only the name identifier, which provides the qualified name.
- You may add arbitrary suffixes (e.g., `@function.params`, `@function.return`) for additional context — captures not matched by any convention are ignored.

**Example — Python class with inheritance:**

```scheme
(class_definition
    name: (identifier) @class.name
    (argument_list [(identifier) (attribute)] @relation.inherits)?) @class.def
```

This emits a `class` node and, when a base class is present, calls `resolveImport` with `captureName = 'relation.inherits'` so you can push an `inherits` edge.

---

## Step-by-Step Guide

This example adds support for a hypothetical language `Exemplar` with file extension `.ex`.

### 1. Install the tree-sitter grammar

```bash
npm install tree-sitter-exemplar
```

(Perform this in a directory where the module will be resolvable from `~/.cynapx/plugins/`. If you are writing a standalone plugin, bundle all dependencies into a single file using a bundler such as `esbuild`.)

### 2. Write the provider class

Create `exemplar-provider.ts`:

```typescript
// Import the LanguageProvider interface from the Cynapx dist output.
// Adjust the path to match your local Cynapx installation.
import { LanguageProvider, RawCodeEdge } from '/path/to/cynapx/dist/indexer/types';
import { SymbolType } from '/path/to/cynapx/dist/types/index';
// @ts-ignore — no type declarations for this grammar
import Exemplar from 'tree-sitter-exemplar';
import Parser from 'tree-sitter';

export class ExemplarProvider implements LanguageProvider {
    public extensions = ['ex'];
    public languageName = 'exemplar';

    public getLanguage() {
        return Exemplar;
    }

    public getQuery(): string {
        return `
(class_declaration
    name: (identifier) @class.name
    (superclass (identifier) @relation.inherits)?) @class.def

(function_declaration
    name: (identifier) @function.name) @function.def

(method_declaration
    name: (identifier) @method.name) @method.def

(import_declaration) @import.stmt
`;
    }

    public mapCaptureToSymbolType(captureName: string): SymbolType {
        if (captureName.startsWith('class'))    return 'class';
        if (captureName.startsWith('function')) return 'function';
        if (captureName.startsWith('method'))   return 'method';
        return 'field';
    }

    public resolveImport(node: Parser.SyntaxNode, fromQName: string, edges: RawCodeEdge[], captureName?: string): void {
        if (captureName === 'relation.inherits') {
            edges.push({
                from_qname: fromQName,
                to_qname: node.text,
                edge_type: 'inherits',
                dynamic: false,
            });
        }
        // Handle import_declaration nodes
        if (node.type === 'import_declaration') {
            const target = node.childForFieldName('module')?.text;
            if (target) {
                edges.push({
                    from_qname: fromQName,
                    to_qname: `exemplar:${target}`,
                    edge_type: 'depends_on',
                    dynamic: false,
                });
            }
        }
    }

    public getDecisionPoints(): string[] {
        return ['if_statement', 'for_statement', 'while_statement', 'case_expression'];
    }
}
```

### 3. Compile to CommonJS

```bash
npx tsc --module commonjs --target es2022 --outDir dist exemplar-provider.ts
```

Or use `esbuild` to bundle dependencies:

```bash
npx esbuild exemplar-provider.ts --bundle --platform=node --outfile=exemplar-provider.js
```

### 4. Install the plugin

```bash
cp dist/exemplar-provider.js ~/.cynapx/plugins/
```

### 5. Restart Cynapx

The registry is instantiated once at startup. Restart the Cynapx server (or re-initialize the project) to pick up the new plugin.

---

## Available SymbolTypes

The `SymbolType` union is defined in `src/types/index.ts`:

| Value | Meaning |
|---|---|
| `'file'` | A source file node |
| `'module'` | A module or namespace |
| `'class'` | A class definition |
| `'interface'` | An interface or protocol definition |
| `'method'` | A method defined inside a class |
| `'function'` | A top-level function |
| `'field'` | A field, property, attribute, or variable |
| `'test'` | A test case or test function |
| `'package'` | A package or library |

Use the value that most accurately represents what the capture describes. When uncertain, `'field'` is the safe fallback for leaf-level declarations.

---

## Loading Verification

When Cynapx successfully loads providers from a plugin file it logs to stderr:

```
LanguageRegistry: Registered 1 provider(s) from /home/user/.cynapx/plugins/exemplar-provider.js
```

If no such message appears, the file was either not found, failed to `require()`, or exported no class that satisfies the `LanguageProvider` duck-type check.

The registry validates providers with a duck-type check — it verifies that the instance has:
- An `extensions` array
- A `languageName` string
- A `getLanguage` function
- A `getQuery` function

No formal interface token or base class is required. A plain JavaScript object factory would also work as long as instances satisfy those four checks.

---

## Troubleshooting

### "Failed to load plugin ... Cannot find module 'tree-sitter-<lang>'"

The tree-sitter grammar npm package is not installed where Node.js can resolve it from the plugin file's location. Options:

- Install the grammar globally: `npm install -g tree-sitter-<lang>`
- Bundle the grammar into the plugin using `esbuild --bundle`
- Install to `~/.cynapx/node_modules/` and ensure `NODE_PATH` includes that directory

### "Failed to load plugin ... is not a constructor"

The plugin file uses ES module `export default` syntax but is loaded with `require()`. Compile with `--module commonjs`, or add `"type": "commonjs"` to the nearest `package.json`.

### "Registered 0 provider(s)" (no message at all)

The exported class does not pass the duck-type check. Verify that:
1. `extensions` is an array (not a string)
2. `languageName` is a string
3. `getLanguage` and `getQuery` are methods (not arrow-function properties assigned after construction — they must be present on the instance at construction time)

### Provider loads but symbols are missing

Run a parse against a test file and check the tree-sitter query using the [tree-sitter playground](https://tree-sitter.github.io/tree-sitter/playground). Common issues:

- The node type names in your query do not match the grammar (check with `tree-sitter parse`)
- The `.def` capture wraps a node that does not contain the `.name` identifier — the parser expects the name node to be a descendant of the def node

### Capture name not mapping to expected SymbolType

Check your `mapCaptureToSymbolType` implementation. The method receives the exact capture name string as returned by tree-sitter (e.g., `'class.def'`, `'method.name'`). Use `startsWith` matching on the prefix rather than exact equality so that all variants (`class.def`, `class.name`) map to the same type.
