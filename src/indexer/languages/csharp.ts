import { LanguageProvider, RawCodeEdge } from '../types';
import { SymbolType } from '../../types';
// @ts-ignore
import CSharp from 'tree-sitter-c-sharp';
import Parser from 'tree-sitter';

export class CsharpProvider implements LanguageProvider {
    public extensions = ['cs'];
    public languageName = 'csharp';

    public getLanguage() {
        return CSharp;
    }

    public getQuery(): string {
        return `
            (class_declaration 
                (identifier) @class.name
                (base_list (identifier) @relation.inherits)?
            ) @class.def
            (interface_declaration 
                (identifier) @interface.name
                (base_list (identifier) @relation.inherits)?
            ) @interface.def
            (method_declaration 
                (identifier) @function.name
                (parameter_list) @function.params
            ) @function.def
            (invocation_expression 
                function: [(identifier) (member_access_expression name: (identifier))] @call.name
            ) @call.expr
            (using_directive (identifier) @import.name) @import.def
        `;
    }

    public mapCaptureToSymbolType(captureName: string): SymbolType {
        if (captureName.startsWith('class')) return 'class';
        if (captureName.startsWith('interface')) return 'interface';
        return 'function';
    }

    public resolveImport(node: Parser.SyntaxNode, fromQName: string, edges: RawCodeEdge[], captureName?: string): void {
        const text = node.text;

        if (captureName === 'relation.inherits') {
            edges.push({
                from_qname: fromQName,
                to_qname: `type:${text}`,
                edge_type: 'inherits',
                dynamic: false
            });
        } else if (captureName === 'import.name') {
            edges.push({
                from_qname: fromQName,
                to_qname: `namespace:${text}`,
                edge_type: 'depends_on',
                dynamic: false
            });
        }
    }

    public getDecisionPoints(): string[] {
        return ['if_statement', 'for_statement', 'foreach_statement', 'while_statement', 'switch_section', 'catch_clause'];
    }
}
