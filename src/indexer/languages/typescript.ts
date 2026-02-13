import { LanguageProvider, RawCodeEdge } from '../types';
import { SymbolType } from '../../types';
// @ts-ignore
import TypeScript from 'tree-sitter-typescript';
import Parser from 'tree-sitter';

export class TypeScriptProvider implements LanguageProvider {
    public extensions = ['ts'];
    public languageName = 'typescript';

    public getLanguage() {
        return TypeScript.typescript;
    }

    public getQuery(): string {
        return `
            (class_declaration 
                name: (identifier) @class.name
                (modifiers)? @class.modifiers) @class.def
            (method_definition 
                name: (property_identifier) @method.name
                parameters: (formal_parameters) @method.params
                return_type: (type_annotation)? @method.return
                (modifiers)? @method.modifiers) @method.def
            (function_declaration 
                name: (identifier) @function.name
                parameters: (formal_parameters) @function.params
                return_type: (type_annotation)? @function.return
                (modifiers)? @function.modifiers) @function.def
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
