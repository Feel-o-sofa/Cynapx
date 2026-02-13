import { LanguageProvider, RawCodeEdge } from '../types';
import { SymbolType } from '../../types';
// @ts-ignore
import CPP from 'tree-sitter-cpp';
import Parser from 'tree-sitter';

export class CppProvider implements LanguageProvider {
    public extensions = ['cpp', 'cc', 'hpp', 'hxx'];
    public languageName = 'cpp';

    public getLanguage() {
        return CPP;
    }

    public getQuery(): string {
        return `
            (function_definition 
                type: (_)? @function.return
                declarator: (function_declarator 
                    declarator: (_) @function.name
                    parameters: (parameter_list) @function.params
                )
            ) @function.def
            (class_specifier name: (type_identifier) @class.name) @class.def
            (struct_specifier name: (type_identifier) @class.name) @class.def
            (namespace_definition name: (_) @module.name) @module.def
            (call_expression function: (_) @call.name) @call.expr
            (preproc_include path: (_) @import.name) @import.def
        `;
    }

    public mapCaptureToSymbolType(captureName: string): SymbolType {
        if (captureName.startsWith('class')) return 'class';
        if (captureName.startsWith('function')) return 'function';
        if (captureName.startsWith('module')) return 'module';
        return 'field';
    }

    public resolveImport(node: Parser.SyntaxNode, fromQName: string, edges: RawCodeEdge[], captureName?: string): void {
        const pathNode = node.descendantsOfType('string_content')[0] || node;
        if (pathNode) {
            let headerPath = pathNode.text.replace(/[<">]/g, '');
            edges.push({
                from_qname: fromQName,
                to_qname: `header:${headerPath}`,
                edge_type: 'depends_on',
                dynamic: false
            });
        }
    }

    public getDecisionPoints(): string[] {
        return ['if_statement', 'for_statement', 'while_statement', 'catch_clause'];
    }
}
