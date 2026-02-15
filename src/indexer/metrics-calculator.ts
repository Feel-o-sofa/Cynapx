/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

let nativeModule: any = null;
try {
    // Look for the native binary in the same directory or up one level (dist/ or dist/indexer/)
    const possiblePaths = [
        path.resolve(__dirname, '../cynapx-native.win32-x64-msvc.node'),
        path.resolve(__dirname, '../../cynapx-native.win32-x64-msvc.node'),
        path.resolve(__dirname, './cynapx-native.win32-x64-msvc.node'),
        path.resolve(__dirname, '../../src-native/cynapx-native.win32-x64-msvc.node')
    ];

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            nativeModule = require(p);
            break;
        }
    }

    if (nativeModule) {
        console.error('[Metrics] Native acceleration enabled.');
    }
} catch (err) {
    console.error(`[Metrics] Native acceleration unavailable: ${err}`);
}

/**
 * Utility to calculate code metrics from AST.
 */
export class MetricsCalculator {
    /**
     * Calculates the cyclomatic complexity of a function/method node.
     * Formula: CC = number of decision points + 1
     */
    public static calculateCyclomaticComplexity(node: any, sourceCode?: string): number {
        // Use native acceleration if available and source code is provided
        if (nativeModule && sourceCode) {
            const decisionPoints = ['if', 'for', 'while', 'case', 'catch', '&&', '||'];
            return nativeModule.calculateCyclomaticComplexityNative(sourceCode, decisionPoints);
        }

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
                        binaryExpr.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
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
}
