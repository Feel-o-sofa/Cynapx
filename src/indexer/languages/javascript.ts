import { LanguageProvider, RawCodeEdge } from '../types';
import { SymbolType } from '../../types';
// @ts-ignore
import JavaScript from 'tree-sitter-javascript';
import Parser from 'tree-sitter';

export class JavascriptProvider implements LanguageProvider {
    public extensions = ['js'];
    public languageName = 'javascript';

    public getLanguage() {
        return JavaScript;
    }

    public getQuery(): string {
        return `
            (function_declaration name: (identifier) @function.name) @function.def
            (class_declaration name: (identifier) @class.name) @class.def
            (method_definition name: (property_identifier) @method.name) @method.def
            (call_expression function: (identifier) @call.name) @call.expr
            (import_statement source: (string) @import.name)
        `;
    }

    public mapCaptureToSymbolType(captureName: string): SymbolType {
        if (captureName.startsWith('class')) return 'class';
        if (captureName.startsWith('function')) return 'function';
        if (captureName.startsWith('method')) return 'method';
        return 'field';
    }

    public resolveImport(node: Parser.SyntaxNode, fromQName: string, edges: RawCodeEdge[], captureName?: string): void {
        const nameCapture = node.children.find(c => c.type === 'string');
        if (nameCapture) {
            let pkgName = nameCapture.text;
            if (pkgName.startsWith("'") || pkgName.startsWith('"')) {
                pkgName = pkgName.substring(1, pkgName.length - 1);
            }
            if (!pkgName.startsWith('.')) {
                edges.push({
                    from_qname: fromQName,
                    to_qname: `package:${pkgName.split('/')[0]}`,
                    edge_type: 'depends_on',
                    dynamic: false
                });
            }
        }
    }

    public getDecisionPoints(): string[] {
        return [
            'if_statement', 'for_statement', 'while_statement', 'case_clause',
            'catch_clause', 'conditional_expression', 'binary_expression',
            'for_in_statement'
        ];
    }
}
