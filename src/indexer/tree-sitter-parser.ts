import Parser from 'tree-sitter';
import { CodeParser, DeltaGraph, RawCodeEdge, LanguageProvider } from './types';
import { CodeNode, SymbolType } from '../types';
import * as fs from 'fs';
import { calculateChecksum } from '../utils/checksum';
import { LanguageRegistry } from './language-registry';

/**
 * Optimized Generic TreeSitterParser that delegates language-specific logic to LanguageProviders.
 */
export class TreeSitterParser implements CodeParser {
    private parser: Parser;
    private registry: LanguageRegistry;

    constructor() {
        this.parser = new Parser();
        this.registry = LanguageRegistry.getInstance();
    }

    public supports(filePath: string): boolean {
        return this.registry.getProvider(filePath) !== undefined;
    }

    public async parse(filePath: string, commit: string, version: number): Promise<DeltaGraph> {
        const provider = this.registry.getProvider(filePath);
        if (!provider) throw new Error(`Unsupported language for file: ${filePath}`);

        this.parser.setLanguage(provider.getLanguage());

        const sourceCode = fs.readFileSync(filePath, 'utf8');
        const tree = this.parser.parse(sourceCode);
        const query = new Parser.Query(provider.getLanguage(), provider.getQuery());
        const matches = query.matches(tree.rootNode);

        const nodes: CodeNode[] = [];
        const edges: RawCodeEdge[] = [];

        // 1. File Node
        nodes.push({
            qualified_name: filePath,
            symbol_type: 'file',
            language: provider.languageName,
            file_path: filePath,
            start_line: 1,
            end_line: sourceCode.split('\n').length,
            visibility: 'public',
            is_generated: false,
            last_updated_commit: commit,
            version: version,
            checksum: calculateChecksum(sourceCode),
            loc: sourceCode.split('\n').length
        });

        // 2. Extract Symbols and Calls
        const rangeToSymbolMap = new Map<string, string>(); 

        // First pass: Definitions
        for (const match of matches) {
            const captures = match.captures;
            const defCapture = captures.find(c => c.name.endsWith('.def'));
            const nameCapture = captures.find(c => c.name.endsWith('.name'));

            if (defCapture && nameCapture && !captures.some(c => c.name.startsWith('call')) && !captures.some(c => c.name.startsWith('import'))) {
                const node = defCapture.node;
                const name = nameCapture.node.text;
                const type = provider.mapCaptureToSymbolType(defCapture.name);
                const qname = `${filePath}#${name}`;

                // Extract Metadata
                const paramsCapture = captures.find(c => c.name.endsWith('.params'));
                const returnCapture = captures.find(c => c.name.endsWith('.return'));
                const modifiersCapture = captures.find(c => c.name.endsWith('.modifiers'));

                const signature = paramsCapture ? `${name}${paramsCapture.node.text}` : undefined;
                const returnType = returnCapture ? returnCapture.node.text.replace(/^[:\s->]+/, '') : undefined;
                const modifiers = modifiersCapture ? modifiersCapture.node.text.split(/\s+/) : undefined;

                nodes.push({
                    qualified_name: qname,
                    symbol_type: type,
                    language: provider.languageName,
                    file_path: filePath,
                    start_line: node.startPosition.row + 1,
                    end_line: node.endPosition.row + 1,
                    visibility: 'public',
                    is_generated: false,
                    last_updated_commit: commit,
                    version: version,
                    loc: node.endPosition.row - node.startPosition.row + 1,
                    cyclomatic: this.calculateCC(node, provider),
                    signature,
                    return_type: returnType,
                    modifiers
                });

                edges.push({
                    from_qname: filePath,
                    to_qname: qname,
                    edge_type: 'defines',
                    dynamic: false
                });

                const rangeKey = `${node.startPosition.row + 1}-${node.endPosition.row + 1}`;
                rangeToSymbolMap.set(rangeKey, qname);
            }
        }

        // Second pass: Calls & Imports
        for (const match of matches) {
            const captures = match.captures;
            const callCapture = captures.find(c => c.name.endsWith('.expr'));
            const importCapture = captures.find(c => c.name.startsWith('import'));
            const nameCapture = captures.find(c => c.name.endsWith('.name'));

            if (callCapture && nameCapture && captures.some(c => c.name.startsWith('call'))) {
                const node = callCapture.node;
                const targetName = nameCapture.node.text;
                const callLine = node.startPosition.row + 1;

                // Find enclosing symbol (tightest scope)
                let fromQName = filePath;
                let minRange = Number.MAX_SAFE_INTEGER;

                for (const [range, qname] of rangeToSymbolMap) {
                    const [start, end] = range.split('-').map(Number);
                    if (callLine >= start && callLine <= end) {
                        const len = end - start;
                        if (len < minRange) {
                            minRange = len;
                            fromQName = qname;
                        }
                    }
                }
                edges.push({
                    from_qname: fromQName,
                    to_qname: targetName,
                    edge_type: 'calls',
                    dynamic: true,
                    call_site_line: callLine
                });
            } else if (importCapture && provider.resolveImport) {
                provider.resolveImport(importCapture.node, filePath, edges);
            }
        }

        return { nodes, edges };
    }

    /**
     * Language-aware Cyclomatic Complexity using Provider's decision points.
     */
    private calculateCC(node: Parser.SyntaxNode, provider: LanguageProvider): number {
        let complexity = 1;
        const decisionPoints = provider.getDecisionPoints();

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
}
