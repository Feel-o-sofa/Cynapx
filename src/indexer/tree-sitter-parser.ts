import Parser from 'tree-sitter';
// @ts-ignore
import TypeScript from 'tree-sitter-typescript';
// @ts-ignore
import Python from 'tree-sitter-python';
// @ts-ignore
import JavaScript from 'tree-sitter-javascript';
import { CodeParser, DeltaGraph } from './types';
import { CodeNode, CodeEdge, SymbolType } from '../types';
import * as fs from 'fs';

/**
 * Advanced TreeSitterParser using Query API for precise multi-language extraction.
 */
export class TreeSitterParser implements CodeParser {
    private parser: Parser;

    constructor() {
        this.parser = new Parser();
    }

    public supports(filePath: string): boolean {
        return filePath.endsWith('.ts') || filePath.endsWith('.js') || filePath.endsWith('.py');
    }

    /**
     * Define language-specific queries for symbol extraction.
     */
    private getQuery(extension: string, language: any): Parser.Query {
        const queryStrings: Record<string, string> = {
            py: `
                (function_definition name: (identifier) @function.name) @function.def
                (class_definition name: (identifier) @class.name) @class.def
            `,
            ts: `
                (class_declaration name: (identifier) @class.name) @class.def
                (method_definition name: (property_identifier) @method.name) @method.def
                (function_declaration name: (identifier) @function.name) @function.def
            `,
            js: `
                (function_declaration name: (identifier) @function.name) @function.def
                (class_declaration name: (identifier) @class.name) @class.def
                (method_definition name: (property_identifier) @method.name) @method.def
            `
        };
        return new Parser.Query(language, queryStrings[extension] || '');
    }

    public async parse(filePath: string, commit: string, version: number): Promise<DeltaGraph> {
        const extension = filePath.split('.').pop() || '';
        let language;

        if (extension === 'ts') language = TypeScript.typescript;
        else if (extension === 'js') language = JavaScript;
        else if (extension === 'py') language = Python;

        if (!language) throw new Error(`Unsupported language: ${filePath}`);
        this.parser.setLanguage(language as any);

        const sourceCode = fs.readFileSync(filePath, 'utf8');
        const tree = this.parser.parse(sourceCode);
        const query = this.getQuery(extension, language);
        const matches = query.matches(tree.rootNode);

        const nodes: CodeNode[] = [];
        const edges: CodeEdge[] = [];

        // 1. File Node
        nodes.push({
            qualified_name: filePath,
            symbol_type: 'file',
            language: extension === 'py' ? 'python' : 'typescript',
            file_path: filePath,
            start_line: 1,
            end_line: sourceCode.split('\n').length,
            visibility: 'public',
            is_generated: false,
            last_updated_commit: commit,
            version: version,
            loc: sourceCode.split('\n').length
        });

        // 2. Extract Symbols using Matches
        for (const match of matches) {
            const captures = match.captures;
            const defCapture = captures.find(c => c.name.endsWith('.def'));
            const nameCapture = captures.find(c => c.name.endsWith('.name'));

            if (defCapture && nameCapture) {
                const node = defCapture.node;
                const name = nameCapture.node.text;
                const type = this.c_to_symbol_type(defCapture.name);

                const qname = `${filePath}#${name}`;

                nodes.push({
                    qualified_name: qname,
                    symbol_type: type,
                    language: extension === 'py' ? 'python' : 'typescript',
                    file_path: filePath,
                    start_line: node.startPosition.row + 1,
                    end_line: node.endPosition.row + 1,
                    visibility: 'public',
                    is_generated: false,
                    last_updated_commit: commit,
                    version: version,
                    loc: node.endPosition.row - node.startPosition.row + 1,
                    cyclomatic: this.calculateCC(node)
                });

                edges.push({
                    from_qname: filePath,
                    to_qname: qname,
                    edge_type: 'defines',
                    dynamic: false
                } as any);
            }
        }

        return { nodes, edges };
    }

    /**
     * Language-agnostic Cyclomatic Complexity using Tree-sitter nodes.
     */
    private calculateCC(node: Parser.SyntaxNode): number {
        let complexity = 1;
        const decisionPoints = [
            'if_statement', 'for_statement', 'while_statement', 'case_clause',
            'catch_clause', 'conditional_expression', 'binary_expression',
            'for_in_statement', 'if_expression'
        ];

        const walk = (n: Parser.SyntaxNode) => {
            if (decisionPoints.includes(n.type)) {
                if (n.type === 'binary_expression') {
                    const text = n.text;
                    if (text.includes('&&') || text.includes('||') || text.includes('and') || text.includes('or')) complexity++;
                } else {
                    complexity++;
                }
            }
            for (let i = 0; i < n.childCount; i++) {
                walk(n.child(i)!);
            }
        };

        walk(node);
        return complexity;
    }

    private c_to_symbol_type(captureName: string): SymbolType {
        if (captureName.startsWith('class')) return 'class';
        if (captureName.startsWith('function')) return 'function';
        if (captureName.startsWith('method')) return 'method';
        return 'field';
    }
}
