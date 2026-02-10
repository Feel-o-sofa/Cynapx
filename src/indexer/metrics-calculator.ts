import * as ts from 'typescript';

/**
 * Utility to calculate code metrics from AST.
 */
export class MetricsCalculator {
    /**
     * Calculates the cyclomatic complexity of a function/method node.
     * Formula: CC = number of decision points + 1
     */
    public static calculateCyclomaticComplexity(node: ts.Node): number {
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
