import { LanguageProvider, RawCodeEdge } from '../types';
import { SymbolType } from '../../types';
// @ts-ignore
import Kotlin from 'tree-sitter-kotlin';
import Parser from 'tree-sitter';

export class KotlinProvider implements LanguageProvider {
    public extensions = ['kt', 'kts'];
    public languageName = 'kotlin';

    public getLanguage() {
        return Kotlin;
    }

    public getQuery(): string {
        return `
            (class_declaration 
                [(type_identifier) (simple_identifier)] @class.name
                (delegation_specifier [(user_type) (constructor_invocation)] @relation.inherits)?
            ) @class.def
            (function_declaration 
                (simple_identifier) @function.name
                (function_value_parameters) @function.params
            ) @function.def
            (call_expression 
                [(navigation_expression (simple_identifier) @call.name) (simple_identifier) @call.name]
            ) @call.expr
            (import_header (identifier) @import.name) @import.def
        `;
    }

    public mapCaptureToSymbolType(captureName: string): SymbolType {
        if (captureName.startsWith('class')) return 'class';
        return 'function';
    }

    public resolveImport(node: Parser.SyntaxNode, fromQName: string, edges: RawCodeEdge[], captureName?: string): void {
        const text = node.text;

        if (captureName === 'relation.inherits') {
            edges.push({
                from_qname: fromQName,
                to_qname: `class:${text.split('(')[0].trim()}`,
                edge_type: 'inherits',
                dynamic: false
            });
        } else if (captureName === 'import.name') {
            edges.push({
                from_qname: fromQName,
                to_qname: `package:${text}`,
                edge_type: 'depends_on',
                dynamic: false
            });
        }
    }

    public getDecisionPoints(): string[] {
        return ['if_expression', 'for_statement', 'while_statement', 'catch_block'];
    }
}
