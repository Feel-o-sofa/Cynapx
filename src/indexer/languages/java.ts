import { LanguageProvider, RawCodeEdge } from '../types';
import { SymbolType } from '../../types';
// @ts-ignore
import Java from 'tree-sitter-java';
import Parser from 'tree-sitter';

export class JavaProvider implements LanguageProvider {
    public extensions = ['java'];
    public languageName = 'java';

    public getLanguage() {
        return Java;
    }

    public getQuery(): string {
        return `
            (class_declaration name: (identifier) @class.name) @class.def
            (interface_declaration name: (identifier) @interface.name) @interface.def
            (method_declaration name: (identifier) @function.name parameters: (formal_parameters) @function.params) @function.def
            (constructor_declaration name: (identifier) @function.name parameters: (formal_parameters) @function.params) @function.def
            
            (superclass [(type_identifier) (scoped_type_identifier) (generic_type)] @relation.inherits)
            (super_interfaces (type_list [(type_identifier) (scoped_type_identifier) (generic_type)] @relation.implements))
            (extends_interfaces (type_list [(type_identifier) (scoped_type_identifier) (generic_type)] @relation.inherits))
            
            (method_invocation name: (identifier) @call.name) @call.expr
            (import_declaration [(scoped_identifier) (identifier)] @import.name) @import.def
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
            edges.push({ from_qname: fromQName, to_qname: text, edge_type: 'inherits', dynamic: false });
        } else if (captureName === 'relation.implements') {
            edges.push({ from_qname: fromQName, to_qname: text, edge_type: 'implements', dynamic: false });
        } else if (captureName?.includes('import')) {
            edges.push({ from_qname: fromQName, to_qname: text, edge_type: 'depends_on', dynamic: false });
        }
    }

    public getDecisionPoints(): string[] {
        return ['if_statement', 'for_statement', 'while_statement', 'catch_clause'];
    }
}
