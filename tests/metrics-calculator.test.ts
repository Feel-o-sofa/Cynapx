/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */

/**
 * Phase 13-5 (H-5) — non-TS cyclomatic complexity accuracy.
 *
 * Before this phase, `TreeSitterParser` handed tree-sitter `SyntaxNode`s to the
 * TypeScript-AST traversal (which inspects `.kind`); tree-sitter nodes have no
 * `.kind`, so traversal terminated immediately and CC was always 1 for all 12
 * non-TS languages. (The native fallback was even worse — a whitespace-token
 * counter that missed `if(x)` and counted keywords inside strings.)
 *
 * These tests drive `calculateCyclomaticComplexityTreeSitter` against real
 * tree-sitter parses with hand-computed expected CC values (!= 1), and assert
 * that decision-point keywords appearing inside string literals / comments are
 * NOT counted (because we walk the parsed AST, not raw text).
 */

import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import { MetricsCalculator } from '../src/indexer/metrics-calculator';
import { createLanguageProvider } from '../src/indexer/languages';
import { rustDescriptor } from '../src/indexer/languages/rust';
import { goDescriptor } from '../src/indexer/languages/go';
import { javaDescriptor } from '../src/indexer/languages/java';
import { pythonDescriptor } from '../src/indexer/languages/python';
import { typescriptDescriptor } from '../src/indexer/languages/typescript';
import type { LanguageDescriptor } from '../src/indexer/languages/descriptor';

/**
 * Parse `source` and return the cyclomatic complexity of the first node whose
 * type is one of `fnTypes` (the function/method definition node), using the
 * descriptor's own `decisionPoints` — i.e. exactly what TreeSitterParser does.
 */
function ccOf(descriptor: LanguageDescriptor, source: string, fnTypes: string[]): number {
    const provider = createLanguageProvider(descriptor);
    const parser = new Parser();
    parser.setLanguage(provider.getLanguage());
    const tree = parser.parse(source);

    let fnNode: Parser.SyntaxNode | null = null;
    const walk = (n: Parser.SyntaxNode) => {
        if (!fnNode && fnTypes.includes(n.type)) fnNode = n;
        for (let i = 0; i < n.childCount && !fnNode; i++) {
            const c = n.child(i);
            if (c) walk(c);
        }
    };
    walk(tree.rootNode);
    if (!fnNode) throw new Error(`No node of type ${fnTypes.join('/')} found`);

    return MetricsCalculator.calculateCyclomaticComplexityTreeSitter(fnNode, provider.getDecisionPoints());
}

// ─── Rust ────────────────────────────────────────────────────────────────────

describe('CC (tree-sitter) — Rust', () => {
    it('counts if + && + for + 2 match arms (CC = 6), ignoring keywords in strings/comments', () => {
        const src = `fn classify(x: i32) -> i32 {
    // if for match while  <- comment keywords must NOT count
    let label = "if for match while && ||"; // string keywords must NOT count
    if x > 0 && x < 10 {            // if (+1), && (+1)
        return 1;
    }
    for _i in 0..x {                // for (+1)
        match x {
            1 => return 2,          // match_arm (+1)
            _ => {}                 // match_arm (+1)
        }
    }
    0
}`;
        // base 1 + if + && + for + 2 arms = 6
        expect(ccOf(rustDescriptor, src, ['function_item'])).toBe(6);
    });

    it('a trivial function has CC = 1', () => {
        const src = `fn id(x: i32) -> i32 { x }`;
        expect(ccOf(rustDescriptor, src, ['function_item'])).toBe(1);
    });
});

// ─── Go ──────────────────────────────────────────────────────────────────────

describe('CC (tree-sitter) — Go', () => {
    it('counts if + && + for + 2 switch cases (CC = 6), default not counted', () => {
        const src = `package m
func classify(x int) int {
    s := "if for switch" // keywords in string must NOT count
    if x > 0 && x < 10 { // if (+1), && (+1)
        return 1
    }
    for i := 0; i < x; i++ { // for (+1)
    }
    switch x {
    case 1: // expression_case (+1)
        return 2
    case 2: // expression_case (+1)
        return 3
    default: // default_case — NOT counted
        return 0
    }
    _ = s
    return 0
}`;
        // base 1 + if + && + for + 2 cases = 6
        expect(ccOf(goDescriptor, src, ['function_declaration'])).toBe(6);
    });

    it('uses the correct case node type (regression: was "expression_case_clause")', () => {
        const src = `package m
func f(x int) int {
    switch x {
    case 1:
        return 1
    case 2:
        return 2
    }
    return 0
}`;
        // base 1 + 2 cases = 3  (proves the case node name actually matches now)
        expect(ccOf(goDescriptor, src, ['function_declaration'])).toBe(3);
    });
});

// ─── Java ────────────────────────────────────────────────────────────────────

describe('CC (tree-sitter) — Java', () => {
    it('counts if + && + for + 2 switch cases (CC = 6), default label not counted', () => {
        const src = `class C {
    int classify(int x) {
        String s = "if for while switch"; // string keywords must NOT count
        if (x > 0 && x < 10) {   // if (+1), && (+1)
            return 1;
        }
        for (int i = 0; i < x; i++) {} // for (+1)
        switch (x) {
            case 1: return 2;    // switch_label with value (+1)
            case 2: return 3;    // switch_label with value (+1)
            default: return 0;   // bare switch_label — NOT counted
        }
    }
}`;
        // base 1 + if + && + for + 2 cases = 6
        expect(ccOf(javaDescriptor, src, ['method_declaration'])).toBe(6);
    });

    it('counts a catch clause as a decision point', () => {
        const src = `class C {
    void f() {
        try { g(); } catch (Exception e) { } // catch (+1)
    }
}`;
        expect(ccOf(javaDescriptor, src, ['method_declaration'])).toBe(2);
    });
});

// ─── Python ──────────────────────────────────────────────────────────────────

describe('CC (tree-sitter) — Python', () => {
    it('counts if + and + elif + for (CC = 5), ignoring keywords in strings/comments', () => {
        const src = `def classify(x):
    # if for while and  <- comment keywords must NOT count
    s = "if for while and or"   # string keywords must NOT count
    if x > 0 and x < 10:        # if (+1), and (+1)
        return 1
    elif x < 0:                 # elif_clause (+1)
        return -1
    for i in range(x):          # for (+1)
        pass
    return 0`;
        // base 1 + if + and + elif + for = 5
        expect(ccOf(pythonDescriptor, src, ['function_definition'])).toBe(5);
    });

    it('counts except clauses and match cases', () => {
        const src = `def f(x):
    try:
        match x:
            case 1:
                return 1
            case _:
                return 0
    except ValueError:
        return -1`;
        // base 1 + except (+1) + case 1 (+1) + case _ (+1) = 4
        expect(ccOf(pythonDescriptor, src, ['function_definition'])).toBe(4);
    });
});

// ─── String / comment isolation (explicit, language-agnostic) ────────────────

describe('CC (tree-sitter) — decision keywords inside strings/comments are not counted', () => {
    it('Rust: function whose only "branches" live in a string/comment has CC = 1', () => {
        const src = `fn f() {
    // if for while match && ||
    let _s = "if for while match && ||";
}`;
        expect(ccOf(rustDescriptor, src, ['function_item'])).toBe(1);
    });

    it('Python: function whose only "branches" live in a string/comment has CC = 1', () => {
        const src = `def f():
    # if elif for while and or
    s = "if elif for while and or"
    return s`;
        expect(ccOf(pythonDescriptor, src, ['function_definition'])).toBe(1);
    });
});

// ─── TypeScript equivalence (TS keeps its dedicated TS-AST path) ─────────────

describe('CC — TypeScript AST path unchanged', () => {
    it('counts if + && + for + ternary via the TypeScript-AST calculator', () => {
        const ts = require('typescript');
        const src = `function classify(x: number): number {
    const s = "if for while"; // string keywords ignored by TS AST too
    if (x > 0 && x < 10) {     // if (+1), && (+1)
        return 1;
    }
    for (let i = 0; i < x; i++) {} // for (+1)
    return x > 5 ? 2 : 3;          // ternary (+1)
}`;
        const sf = ts.createSourceFile('f.ts', src, ts.ScriptTarget.Latest, true);
        let fn: any = null;
        const find = (n: any) => {
            if (!fn && ts.isFunctionDeclaration(n)) fn = n;
            ts.forEachChild(n, find);
        };
        find(sf);
        // base 1 + if + && + for + ternary = 5
        expect(MetricsCalculator.calculateCyclomaticComplexity(fn)).toBe(5);
    });

    it('the tree-sitter TypeScript descriptor also yields > 1 for branchy code', () => {
        const src = `function classify(x: number): number {
    if (x > 0 && x < 10) { return 1; }
    for (let i = 0; i < x; i++) {}
    return 0;
}`;
        // base 1 + if + && + for = 4
        expect(ccOf(typescriptDescriptor, src, ['function_declaration'])).toBe(4);
    });
});

// ─── Defensive guards (Phase 32-1, M-1 v29) ──────────────────────────────────
//
// `calculateCyclomaticComplexityTreeSitter` is on the hot path for every non-TS
// function/method index (12 languages). Its null/undefined guard
// (`if (!node) return 1`) and the empty-decisionPoints boundary are not directly
// asserted by the language-parse tests above (those always pass a valid node and
// a non-empty decision-point list). These cases pin the safe-degrade behaviour so
// a regression that drops the guard — causing a `null` deref crash across all
// non-TS indexing — is caught deterministically.

describe('CC (tree-sitter) — defensive guards', () => {
    it('returns 1 for a null node (early-return guard)', () => {
        expect(
            MetricsCalculator.calculateCyclomaticComplexityTreeSitter(null, ['if_statement'])
        ).toBe(1);
    });

    it('returns 1 for an undefined node (same falsy guard)', () => {
        expect(
            MetricsCalculator.calculateCyclomaticComplexityTreeSitter(undefined, ['if_statement'])
        ).toBe(1);
    });

    it('returns 1 when decisionPoints is empty (no node type can match)', () => {
        // A minimal stub node whose type *would* match a non-empty list, but with
        // an empty decisionPoints set nothing is counted → base complexity 1.
        const stub = { type: 'if_statement', namedChildCount: 0, childCount: 0, child: () => null };
        expect(MetricsCalculator.calculateCyclomaticComplexityTreeSitter(stub, [])).toBe(1);
    });
});
