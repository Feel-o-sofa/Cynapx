import { LanguageProvider, RawCodeEdge } from '../types';
import { SymbolType } from '../../types';
// @ts-ignore
import C from 'tree-sitter-c';
import Parser from 'tree-sitter';

export class CProvider implements LanguageProvider {
    public extensions = ['c', 'h'];
    public languageName = 'c';

    public getLanguage() {
        return C;
    }

    public getQuery(): string {
        return `
            (function_definition 
                declarator: (function_declarator 
                    declarator: (identifier) @function.name
                    parameters: (parameter_list) @function.params
                )
            ) @function.def
            (struct_specifier name: (type_identifier) @class.name) @class.def
            (enum_specifier name: (type_identifier) @class.name) @class.def
            (call_expression function: (identifier) @call.name) @call.expr
            (preproc_include path: [(string_literal) (system_lib_string)] @import.name) @import.def
        `;
    }

    public mapCaptureToSymbolType(captureName: string): SymbolType {
        if (captureName.startsWith('class')) return 'class';
        if (captureName.startsWith('function')) return 'function';
        return 'field';
    }

    public resolveImport(node: Parser.SyntaxNode, filePath: string, edges: RawCodeEdge[]): void {
        const pathNode = node.descendantsOfType('string_content')[0] || node;
        if (pathNode) {
            let headerPath = pathNode.text.replace(/[<">]/g, '');
            edges.push({
                from_qname: filePath,
                to_qname: `header:${headerPath}`,
                edge_type: 'depends_on',
                dynamic: false
            });
        }
    }

    public getDecisionPoints(): string[] {
        return ['if_statement', 'for_statement', 'while_statement', 'case_statement'];
    }
}
