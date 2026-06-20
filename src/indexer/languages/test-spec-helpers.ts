/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import Parser from 'tree-sitter';

/**
 * Shared helpers for per-language `extractTestSpecs` implementations. These are
 * pure functions over the tree-sitter AST — no file I/O. Each language's test
 * conventions differ, but the mechanics of walking the tree, normalizing
 * assertion text, and matching call prefixes are common.
 */

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
