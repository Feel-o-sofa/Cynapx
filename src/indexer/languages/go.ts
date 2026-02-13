import { LanguageProvider, RawCodeEdge } from '../types';
import { SymbolType } from '../../types';
// @ts-ignore
import Go from 'tree-sitter-go';
import Parser from 'tree-sitter';

export class GoProvider implements LanguageProvider {
    public extensions = ['go'];
    public languageName = 'go';

    public getLanguage() {
        return Go;
    }

    public getQuery(): string {
        return `
            (function_declaration 
                name: (identifier) @function.name
                parameters: (parameter_list) @function.params
            ) @function.def
            (method_declaration 
                name: (field_identifier) @method.name
                parameters: (parameter_list) @method.params
            ) @method.def
            (type_spec name: (type_identifier) @class.name) @class.def
            (call_expression function: [(identifier) (selector_expression field: (field_identifier))] @call.name) @call.expr
            (import_spec path: (interpreted_string_literal) @import.name) @import.def
        `;
    }

    public mapCaptureToSymbolType(captureName: string): SymbolType {
        if (captureName.startsWith('class')) return 'class';
        if (captureName.startsWith('function')) return 'function';
        if (captureName.startsWith('method')) return 'method';
        return 'field';
    }

    public resolveImport(node: Parser.SyntaxNode, fromQName: string, edges: RawCodeEdge[], captureName?: string): void {
        const pathNode = node.descendantsOfType('interpreted_string_literal')[0];
        if (pathNode) {
            let pkgPath = pathNode.text.replace(/"/g, '');
            edges.push({
                from_qname: fromQName,
                to_qname: `package:${pkgPath}`,
                edge_type: 'depends_on',
                dynamic: false
            });
        }
    }

    public getDecisionPoints(): string[] {
        return ['if_statement', 'for_statement', 'expression_case_clause'];
    }
}
