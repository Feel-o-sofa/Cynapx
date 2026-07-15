/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import Parser from 'tree-sitter';
import * as path from 'path';
import { toCanonical } from '../../utils/paths';

/**
 * Shared helpers for per-language `extractTestSpecs` implementations. These are
 * pure functions over the tree-sitter AST — no file I/O. Each language's test
 * conventions differ, but the mechanics of walking the tree, normalizing
 * assertion text, and matching call prefixes are common.
 */

/**
 * Infer the production file a test file exercises from its naming convention
 * (mirroring the `foo.test.ts` → `foo.ts` rule the TypeScript parser uses):
 *
 *   - `foo_test.go` → `foo.go` (also `_test.cpp` / `_test.cc` / `_test.py`)
 *   - `test_foo.py` → `foo.py`
 *   - `FooTest.java` / `FooTests.cs` / `FooTest.kt` / `FooTest.php` → `Foo.*`
 *
 * For Maven/Gradle-style layouts the `/src/test/<lang>/` segment is mapped to
 * `/src/main/<lang>/` so the candidate points into the production tree.
 *
 * Returns the *canonical* prod-file path (matching stored file-node qnames),
 * or undefined when the file name carries no test convention. The candidate
 * is not checked for existence: a spec whose target_qname resolves to nothing
 * simply never matches a lookup, which is harmless (P8 best-effort contract).
 */
export function inferProdFilePath(testFilePath: string): string | undefined {
    const dir = path.dirname(testFilePath);
    const ext = path.extname(testFilePath);
    const base = path.basename(testFilePath, ext);

    let prodBase: string | undefined;
    if (base.startsWith('test_')) {
        prodBase = base.slice('test_'.length);
    } else if (base.endsWith('_test')) {
        prodBase = base.slice(0, -'_test'.length);
    } else {
        const camel = base.match(/^(.*?)Tests?$/);
        if (camel && camel[1]) prodBase = camel[1];
    }
    if (!prodBase) return undefined;

    // Map test source roots onto the production tree (src/test/java|kotlin|…).
    const prodDir = dir.replace(/([/\\])src\1test\1/, '$1src$1main$1');
    return toCanonical(path.join(prodDir, prodBase + ext));
}

/**
 * Collapse whitespace and truncate an assertion expression to a single short
 * line suitable for storage as a behavioral contract string.
 */
export function truncate(text: string, n = 100): string {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    return collapsed.length > n ? collapsed.slice(0, n - 1) + '…' : collapsed;
}

/**
 * Returns the direct, top-level named children of `root` of the given type.
 * Unlike `descendantsOfType`, this does not recurse, so it can be used to find
 * only module-level (or class-body-level) declarations.
 */
export function directChildrenOfType(parent: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
    const out: Parser.SyntaxNode[] = [];
    for (const child of parent.namedChildren) {
        if (child.type === type) out.push(child);
    }
    return out;
}

/**
 * Find every `call`/`call_expression`/`method_invocation`-style node under
 * `scope` whose callee text starts with `prefix` (e.g. `self.assert`, `t.Error`,
 * `assert.`). The callee text is matched against the node's `function` field
 * (Python/Go) or reconstructed for Java method invocations by the caller.
 */
export function collectCallsByPrefix(
    scope: Parser.SyntaxNode,
    callType: string,
    prefixes: string[]
): Parser.SyntaxNode[] {
    const out: Parser.SyntaxNode[] = [];
    for (const call of scope.descendantsOfType(callType)) {
        const fn = call.childForFieldName('function');
        const calleeText = (fn ?? call).text.replace(/\s+/g, '');
        if (prefixes.some(p => calleeText.startsWith(p))) {
            out.push(call);
        }
    }
    return out;
}
