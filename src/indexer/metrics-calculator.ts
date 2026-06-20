/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as ts from 'typescript';

/**
 * Logical (short-circuit) operators that introduce a branch and therefore add
 * one to cyclomatic complexity. Used to disambiguate generic `binary_expression`
 * / `boolean_operator` tree-sitter nodes (which also cover `+`, `==`, ...) so we
 * only count the ones that are actual decision points.
 */
const LOGICAL_OPERATORS = new Set(['&&', '||', '??', 'and', 'or']);

/**
 * Tree-sitter node types that wrap a binary/logical operator. For these we only
 * increment complexity when the operator is one of LOGICAL_OPERATORS, otherwise
 * arithmetic/comparison expressions would inflate the metric.
 */
const OPERATOR_NODE_TYPES = new Set(['binary_expression', 'boolean_operator', 'binary_operator']);

/**
 * Case-label node types that should only count when they carry an actual case
 * value. The bare `default:` / `else` label (no named child) is a fall-through,
 * not a new branch, so it must not increment complexity.
 */
const CASE_LABEL_NODE_TYPES = new Set(['switch_label']);

/**
 * Utility to calculate code metrics from AST.
 */
export class MetricsCalculator {
    /**
     * Calculates the cyclomatic complexity of a function/method node.
     * Formula: CC = number of decision points + 1
     *
     * This path expects a **TypeScript** AST node (`ts.Node`). For tree-sitter
     * `SyntaxNode`s use `calculateCyclomaticComplexityTreeSitter` instead — the
     * two AST shapes are incompatible (tree-sitter nodes have no `.kind`).
     */
    public static calculateCyclomaticComplexity(node: any): number {
        let complexity = 1;
        const visit = (n: ts.Node) => {
            switch (n.kind) {
                case ts.SyntaxKind.IfStatement:
                case ts.SyntaxKind.ForStatement:
                case ts.SyntaxKind.ForInStatement:
                case ts.SyntaxKind.ForOfStatement:
                case ts.SyntaxKind.WhileStatement:
                case ts.SyntaxKind.DoStatement:
                case ts.SyntaxKind.CatchClause:
                case ts.SyntaxKind.ConditionalExpression: // ternary
                    complexity++;
                    break;
                case ts.SyntaxKind.BinaryExpression:
                    const binaryExpr = n as ts.BinaryExpression;
                    if (binaryExpr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
                        binaryExpr.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
                        binaryExpr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
                        complexity++;
                    }
                    break;
                case ts.SyntaxKind.CaseClause:
                    if ((n as ts.CaseClause).statements.length > 0) {
                        complexity++;
                    }
                    break;
            }
            ts.forEachChild(n, visit);
        };

        visit(node);
        return complexity;
    }

    /**
     * Calculates cyclomatic complexity for a **tree-sitter** `SyntaxNode` by
     * walking the real syntax tree and counting nodes whose `.type` appears in
     * `decisionPoints` (the per-language list from
     * `LanguageProvider.getDecisionPoints()`).
     *
     * Formula: CC = number of decision points + 1.
     *
     * Because we walk the parsed AST — not raw text — keywords like `if` that
     * appear inside string literals or comments are *not* counted: tree-sitter
     * parses those as opaque leaf nodes (`string_literal`, `comment`, ...) whose
     * type never matches a decision point, and we never descend into them
     * looking for keyword text.
     *
     * Generic operator nodes (`binary_expression`, `boolean_operator`, ...) are
     * only counted when their operator is a short-circuit logical one
     * (`&&`, `||`, `??`, `and`, `or`); arithmetic/comparison operators do not
     * add a branch.
     */
    public static calculateCyclomaticComplexityTreeSitter(node: any, decisionPoints: string[]): number {
        if (!node) return 1;
        const points = new Set(decisionPoints);
        let complexity = 1;

        // Iterative DFS over the tree-sitter cursor/children API to avoid deep
        // recursion on large functions.
        const stack: any[] = [node];
        while (stack.length > 0) {
            const current = stack.pop();

            if (points.has(current.type)) {
                if (OPERATOR_NODE_TYPES.has(current.type)) {
                    // Only short-circuit logical operators are decision points.
                    const opNode = typeof current.childForFieldName === 'function'
                        ? current.childForFieldName('operator')
                        : null;
                    if (opNode && LOGICAL_OPERATORS.has(opNode.text)) {
                        complexity++;
                    }
                } else if (CASE_LABEL_NODE_TYPES.has(current.type)) {
                    // `case X:` adds a branch; bare `default:` (no value) does not.
                    if ((current.namedChildCount ?? 0) > 0) {
                        complexity++;
                    }
                } else {
                    complexity++;
                }
            }

            const childCount = current.childCount ?? 0;
            for (let i = 0; i < childCount; i++) {
                const child = current.child(i);
                if (child) stack.push(child);
            }
        }

        return complexity;
    }
}
