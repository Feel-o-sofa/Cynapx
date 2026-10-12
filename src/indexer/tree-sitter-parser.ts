/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import Parser from 'tree-sitter';
import { CodeParser, DeltaGraph, RawCodeEdge, LanguageProvider, TestSpec } from './types';
import { CodeNode, SymbolType } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import { calculateChecksum } from '../utils/checksum';
import { LanguageRegistry } from './language-registry';
import { toCanonical } from '../utils/paths';
import { MetricsCalculator } from './metrics-calculator';

/**
 * AST node types that wrap a callee name when the call goes through a receiver
 * or qualifier. Some queries capture only a bare identifier for receiver calls
 * (e.g. Kotlin's navigation calls capture the receiver `simple_identifier`,
 * and the generic fallback grabs the first identifier of a member access — the
 * receiver). A name captured in one of these contexts is a method/member call,
 * so it must never be resolved to a same-named free function defined in the
 * same file (P8-2 precision).
 */
const RECEIVER_CONTEXT_TYPES = new Set([
    'selector_expression',      // Go
    'member_access_expression', // C#
    'navigation_expression',    // Kotlin
    'attribute',                // Python / GDScript
    'field_expression',         // Rust / C / C++
    'member_expression'         // JavaScript / TypeScript
]);

/**
 * True when the captured callee name sits inside a receiver-qualified call.
 * Java uses a single `method_invocation` node type for both free and receiver
 * calls, so it needs a field check instead of a parent-type check.
 */
export function isReceiverQualifiedCall(nameNode: Parser.SyntaxNode | undefined): boolean {
    const parent = nameNode?.parent;
    if (!parent) return false;
    if (RECEIVER_CONTEXT_TYPES.has(parent.type)) return true;
    return parent.type === 'method_invocation' && parent.childForFieldName('object') !== null;
}

/** Receivers that name the caller's own type. */
const SELF_RECEIVERS = new Set(['self', 'this', 'cls', 'Self']);

/**
 * Splits a captured callee into its qualifier and name. Go and Rust capture the
 * whole callee (`util.Format`, `util::log`); other languages capture only the
 * name, and the qualifier is the receiver that precedes it in the enclosing
 * member expression. Kotlin captures the receiver itself, which is left bare.
 */
export function splitCallee(text: string, nameNode: Parser.SyntaxNode | undefined): { qualifier?: string; name: string } {
    const qualified = /^(.+)(?:\.|::)([^.:]+)$/s.exec(text);
    if (qualified) return { qualifier: qualified[1], name: qualified[2] };
    if (nameNode && isReceiverQualifiedCall(nameNode)) {
        const receiver = nameNode.parent!.namedChildren[0];
        if (receiver && receiver.id !== nameNode.id && receiver.endIndex <= nameNode.startIndex) {
            return { qualifier: receiver.text, name: text };
        }
    }
    return { name: text };
}

/** `new Client()` is a receiver of type `Client`; `a::b` is written `a.b`. */
function normalizeQualifier(qualifier: string): string {
    const constructed = /^new\s+([\w.]+)\s*(?:<.*>)?\s*\(.*\)$/s.exec(qualifier.trim());
    return (constructed ? constructed[1] : qualifier.trim()).replace(/::/g, '.');
}

/** Symbol types whose members are qualified by their name (`file#Type.member`). */
const OWNER_SYMBOL_TYPES = new Set<SymbolType>(['class', 'interface', 'module']);

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

    /**
     * Extracts a leading comment (sibling) or a leading string docstring (Python)
     * for a captured definition node. Captured as "intent" for the knowledge base (P1).
     */
    private extractTreeSitterDocstring(captureNode: Parser.SyntaxNode, provider?: LanguageProvider): string | undefined {
        // Look for an immediately preceding comment node (sibling)
        const prev = captureNode.previousNamedSibling;
        if (prev && (prev.type === 'comment' || prev.type === 'block_comment'
                     || prev.type === 'line_comment' || prev.type === 'doc_comment'
                     || prev.type === 'documentation_comment' || prev.type === 'multiline_comment')) {
            let text: string;
            if (provider?.normalizeDocstring) {
                text = provider.normalizeDocstring(prev.text);
            } else {
                text = prev.text
                    .replace(/^\/\*\*?|\*\/$|^\/\/\/?|^#+\s?|^\s*\*\s?/gm, '')
                    .trim();
            }
            return text || undefined;
        }
        // Python: check first child for string node (docstring)
        const firstChild = captureNode.firstNamedChild;
        if (firstChild && (firstChild.type === 'string' || firstChild.type === 'expression_statement')) {
            const possibleDocstring = firstChild.firstNamedChild ?? firstChild;
            if (possibleDocstring.type === 'string' || possibleDocstring.type === 'string_content') {
                const raw = possibleDocstring.text.replace(/^["'`]{1,3}|["'`]{1,3}$/g, '').trim();
                return raw || undefined;
            }
        }
        return undefined;
    }

    public async parse(filePath: string, commit: string, version: number): Promise<DeltaGraph> {
        const provider = this.registry.getProvider(filePath);
        if (!provider) throw new Error(`Unsupported language for file: ${filePath}`);

        const normalizedFilePath = path.resolve(filePath);
        const canonicalFilePath = toCanonical(normalizedFilePath);
        
        this.parser.setLanguage(provider.getLanguage());

        const sourceCode = fs.readFileSync(normalizedFilePath, 'utf8');
        const tree = this.parser.parse(sourceCode);
        
        let query: Parser.Query;
        try {
            query = new Parser.Query(provider.getLanguage(), provider.getQuery());
        } catch (err: any) {
            throw new Error(`TreeSitterQueryError in ${normalizedFilePath} (${provider.languageName}): ${err.message}`);
        }
        
        const matches = query.matches(tree.rootNode);

        const nodes: CodeNode[] = [];
        const edges: RawCodeEdge[] = [];

        // 1. File Node
        nodes.push({
            qualified_name: canonicalFilePath,
            symbol_type: 'file',
            language: provider.languageName,
            file_path: normalizedFilePath,
            start_line: 1,
            end_line: sourceCode.split('\n').length,
            visibility: 'public',
            is_generated: false,
            last_updated_commit: commit,
            version: version,
            checksum: calculateChecksum(sourceCode),
            loc: sourceCode.split('\n').length
        });

        // 2. Map for context-aware relation extraction
        const nodeToSymbolMap = new Map<number, string>(); 

        // First pass: Extract Definitions. Names are collected before qnames are
        // built because a definition's qname depends on its owner (below).
        interface Definition { node: Parser.SyntaxNode; match: Parser.QueryMatch; prefix: string; type: SymbolType; name: string }
        const definitions: Definition[] = [];
        const definitionById = new Map<number, Definition>();
        for (const match of matches) {
            for (const capture of match.captures) {
                if (capture.name.endsWith('.def')) {
                    const node = capture.node;
                    const prefix = capture.name.split('.')[0];
                    const type = provider.mapCaptureToSymbolType(capture.name);
                    
                    // Find name capture within the same match
                    const nameCapture = match.captures.find(c => c.name === `${prefix}.name`);
                    let name = nameCapture?.node.text;
                    
                    if (!name) {
                        const idNode = node.childForFieldName('name') || 
                                       node.children.find(c => c.type.includes('identifier'));
                        name = idNode ? idNode.text : `unknown_${node.type}_${node.startPosition.row}`;
                    }

                    const def: Definition = { node, match, prefix, type, name };
                    definitions.push(def);
                    if (!definitionById.has(node.id)) definitionById.set(node.id, def);
                }
            }
        }

        // A member is qualified by its enclosing types, `file#Outer.Inner.member`,
        // as the TypeScript parser does; otherwise a method and a same-named free
        // function in one file would collapse into a single node. Only types
        // qualify: a function nested in a function keeps its own name.
        const ownerPath = (def: Definition): string[] => {
            const owners: string[] = [];
            for (let current = def.node.parent; current; current = current.parent) {
                const owner = definitionById.get(current.id);
                if (owner && OWNER_SYMBOL_TYPES.has(owner.type)) owners.unshift(owner.name);
            }
            const receiverType = provider.ownerTypeName?.(def.node);
            if (receiverType) owners.push(receiverType);
            return owners;
        };

        // Member paths (the part after '#') that name a type, for scope lookup.
        const typeScopes = new Set<string>();
        for (const def of definitions) {
            const { node, match, prefix, type, name } = def;
            const memberPath = [...ownerPath(def), name].join('.');
            if (OWNER_SYMBOL_TYPES.has(type)) typeScopes.add(memberPath.toLowerCase());
            const qname = toCanonical(`${normalizedFilePath}#${memberPath}`);

            // Metadata Extraction
            const paramsCapture = match.captures.find(c => c.name === `${prefix}.params`);
            const returnCapture = match.captures.find(c => c.name === `${prefix}.return`);
            const modifiersCapture = match.captures.find(c => c.name === `${prefix}.modifiers`);

            nodes.push({
                qualified_name: qname,
                symbol_type: type,
                language: provider.languageName,
                file_path: normalizedFilePath,
                start_line: node.startPosition.row + 1,
                end_line: node.endPosition.row + 1,
                visibility: 'public',
                is_generated: false,
                last_updated_commit: commit,
                version: version,
                loc: node.endPosition.row - node.startPosition.row + 1,
                cyclomatic: MetricsCalculator.calculateCyclomaticComplexityTreeSitter(node, provider.getDecisionPoints()),
                signature: paramsCapture ? `${name}${paramsCapture.node.text}` : undefined,
                return_type: returnCapture ? returnCapture.node.text.replace(/^[:\s->]+/, '') : undefined,
                modifiers: modifiersCapture ? modifiersCapture.node.text.split(/\s+/) : undefined,
                docstring: this.extractTreeSitterDocstring(node, provider)
            });

            edges.push({
                from_qname: canonicalFilePath,
                to_qname: qname,
                edge_type: 'defines',
                dynamic: false
            });

            nodeToSymbolMap.set(node.id, qname);
        }

        // Build member path → qname index for intra-file call resolution (P8-2)
        const localSymbolMap = new Map<string, string>();
        for (const [, qname] of nodeToSymbolMap) {
            const hashIdx = qname.lastIndexOf('#');
            if (hashIdx >= 0) {
                localSymbolMap.set(qname.slice(hashIdx + 1), qname);
            }
        }

        /**
         * Resolves a bare call to a definition in this file. The caller's
         * enclosing types are searched innermost first, but only in languages
         * where a bare call can name a member (Java's `foo()` is `this.foo()`;
         * Python's `foo()` never is). The file scope is searched last.
         */
        const resolveLocal = (name: string, fromQName: string): string | undefined => {
            const hashIdx = fromQName.lastIndexOf('#');
            const callerPath = hashIdx >= 0 ? fromQName.slice(hashIdx + 1).split('.') : [];
            if (provider.implicitMemberCalls) {
                for (let i = callerPath.length; i > 0; i--) {
                    const scope = callerPath.slice(0, i).join('.');
                    if (!typeScopes.has(scope)) continue;
                    const hit = localSymbolMap.get(`${scope}.${name}`);
                    if (hit) return hit;
                }
            }
            return localSymbolMap.get(name);
        };

        /**
         * Resolves `self.name` to a member of the caller's own type. The owner
         * is the caller's member path minus the caller itself, so a Go method
         * resolves even though its type is declared elsewhere in the file.
         */
        const resolveOwnMember = (name: string, fromQName: string): string | undefined => {
            const hashIdx = fromQName.lastIndexOf('#');
            if (hashIdx < 0) return undefined;
            const callerPath = fromQName.slice(hashIdx + 1).split('.');
            if (callerPath.length < 2) return undefined;
            return localSymbolMap.get(`${callerPath.slice(0, -1).join('.')}.${name}`);
        };

        // Second pass: Extract Relations (Calls, Inheritance, Imports)
        for (const match of matches) {
            for (const capture of match.captures) {
                const cName = capture.name;
                const node = capture.node;

                // Determine context (fromQName) by walking up the AST
                let fromQName = canonicalFilePath;
                let current: Parser.SyntaxNode | null = node.parent;
                while (current) {
                    if (nodeToSymbolMap.has(current.id)) {
                        fromQName = nodeToSymbolMap.get(current.id)!;
                        break;
                    }
                    current = current.parent;
                }
                const callerNode = current;

                if (cName.endsWith('.expr')) {
                    // Call expression
                    const prefix = cName.split('.')[0];
                    const nameCapture = match.captures.find(c => c.name === `${prefix}.name`);
                    let targetNode = nameCapture?.node;
                    let targetName = targetNode?.text;

                    if (!targetName) {
                        const funcNode = node.childForFieldName('function') || node.childForFieldName('name') || node;
                        targetNode = funcNode.descendantsOfType('identifier')[0] || funcNode;
                        targetName = targetNode.text;
                    }

                    // P8-2: resolve intra-file calls to fully qualified names.
                    // A bare call resolves through the caller's scopes. A call
                    // through `self`/`this` (or a Go method's receiver) resolves
                    // to the caller's own type. Any other qualified call keeps its
                    // qualifier, `util.Format` or `Config.configure`, for the
                    // update pipeline to resolve against the file's imports;
                    // resolving it here to a same-named local function would
                    // fabricate a wrong edge. Lookups are lowercased because
                    // localSymbolMap keys come from canonical (lowercase) qnames.
                    const callee = splitCallee(targetName, targetNode);
                    let localTarget: string | undefined;
                    let toQName = targetName;
                    if (callee.qualifier === undefined) {
                        if (!isReceiverQualifiedCall(targetNode)) {
                            localTarget = resolveLocal(callee.name.toLowerCase(), fromQName);
                        }
                    } else {
                        const qualifier = normalizeQualifier(callee.qualifier);
                        const receiverVar = callerNode ? provider.receiverName?.(callerNode) : undefined;
                        if (SELF_RECEIVERS.has(qualifier) || qualifier === receiverVar) {
                            localTarget = resolveOwnMember(callee.name.toLowerCase(), fromQName);
                        }
                        toQName = `${qualifier}.${callee.name}`;
                    }
                    edges.push({
                        from_qname: fromQName,
                        to_qname: localTarget ?? toQName,
                        edge_type: 'calls',
                        dynamic: localTarget === undefined,
                        call_site_line: node.startPosition.row + 1
                    });
                } else if (cName.includes('relation') || cName.includes('import')) {
                    // Import or OOP Relation
                    if (provider.resolveImport) {
                        provider.resolveImport(node, fromQName, edges, cName, normalizedFilePath);
                    }
                }
            }
        }

        // P8-1: Language-specific test-spec extraction (behavioral contracts).
        let testSpecs: TestSpec[] | undefined;
        if (provider.extractTestSpecs) {
            try {
                testSpecs = provider.extractTestSpecs(tree.rootNode, normalizedFilePath, canonicalFilePath);
            } catch (err) {
                // Test-spec extraction is best-effort; never fail the whole parse over it.
                testSpecs = undefined;
            }
        }
        return testSpecs && testSpecs.length > 0 ? { nodes, edges, testSpecs } : { nodes, edges };
    }

}
