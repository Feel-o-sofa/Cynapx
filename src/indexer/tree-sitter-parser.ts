/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import Parser from 'tree-sitter';
import { CodeParser, DeltaGraph, RawCodeEdge, LanguageProvider, TestSpec } from './types';
import { CodeNode, SymbolType, Visibility } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import { calculateChecksum } from '../utils/checksum';
import { LanguageRegistry } from './language-registry';
import { toCanonical } from '../utils/paths';
import { MetricsCalculator } from './metrics-calculator';

/**
 * AST node types that wrap a callee name when the call goes through a receiver
 * or qualifier. Most queries capture only the member name of a receiver call
 * (Kotlin's sits in a `navigation_suffix`, see memberContainer), and the
 * generic fallback grabs the first identifier of a member access — the
 * receiver. A name captured in one of these contexts is a method/member call,
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
 * The member expression around a callee name. Kotlin nests the name one level
 * deeper: `navigation_expression(receiver, navigation_suffix(. name))`.
 */
function memberContainer(nameNode: Parser.SyntaxNode | undefined): Parser.SyntaxNode | null | undefined {
    const parent = nameNode?.parent;
    return parent?.type === 'navigation_suffix' ? parent.parent : parent;
}

/**
 * True when the captured callee name sits inside a receiver-qualified call.
 * Java uses a single `method_invocation` node type for both free and receiver
 * calls, so it needs a field check instead of a parent-type check.
 */
export function isReceiverQualifiedCall(nameNode: Parser.SyntaxNode | undefined): boolean {
    const parent = memberContainer(nameNode);
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
        const receiver = memberContainer(nameNode)!.namedChildren[0];
        if (receiver && receiver.id !== nameNode.id && receiver.endIndex <= nameNode.startIndex) {
            return { qualifier: receiver.text, name: text };
        }
    }
    return { name: text };
}

/**
 * The declared types of a definition's parameters, by parameter name, for the
 * parameters whose type is a plain named type: `c *client.Client` (Go),
 * `Client c` (Java, C#), `c: Client` (Python, Kotlin), `c: &Client` (Rust).
 * A call through such a parameter, `c.configure()`, is a call on that type.
 */
export function parameterTypes(defNode: Parser.SyntaxNode): Map<string, string> {
    const types = new Map<string, string>();
    const params = defNode.childForFieldName('parameters')
        ?? defNode.namedChildren.find(c => c.type === 'function_value_parameters');
    if (!params) return types;
    for (const param of params.namedChildren) {
        const typeNode = param.childForFieldName('type') ?? param.namedChildren.find(c => c.type.includes('type'));
        if (!typeNode) continue;
        const nameNode = param.childForFieldName('name') ?? param.childForFieldName('pattern')
            ?? param.namedChildren.find(c => c.id !== typeNode.id && c.type.includes('identifier'));
        const typeName = namedType(typeNode.text);
        if (nameNode && typeName) types.set(nameNode.text, typeName);
    }
    return types;
}

/**
 * Local variables typed by how they are assigned in a definition's body:
 * `c = Client()` (Python), `Client c = new Client()` / `var c = new Client()`
 * (Java, C#), `c := &client.Client{}` (Go), `let c: Client` / `let c =
 * Client::new()` (Rust), `val c = Client()` (Kotlin). A name assigned two
 * different types is left out: which one a call sees is unknown.
 */
export function localTypes(defNode: Parser.SyntaxNode): Map<string, string> {
    const { bind, result } = typeBindings();
    for (const n of defNode.descendantsOfType(LOCAL_DECLARATIONS)) {
        switch (n.type) {
            case 'assignment': // Python
                bind(n.childForFieldName('left'), valueType(n.childForFieldName('right')));
                break;
            case 'local_variable_declaration': // Java
            case 'variable_declaration': { // C#
                const typeNode = n.childForFieldName('type') ?? n.namedChildren[0];
                const declared = typeNode && !['var', 'implicit_type'].includes(typeNode.type) && typeNode.text !== 'var'
                    ? namedType(typeNode.text) : undefined;
                for (const d of n.namedChildren.filter(c => c.type === 'variable_declarator')) {
                    const value = d.childForFieldName('value') ?? (d.namedChildren.length > 1 ? d.namedChildren[d.namedChildren.length - 1] : null);
                    bind(d.childForFieldName('name') ?? d.namedChildren[0], declared ?? valueType(value));
                }
                break;
            }
            case 'short_var_declaration': { // Go
                const left = n.childForFieldName('left')?.namedChildren ?? [];
                const right = n.childForFieldName('right')?.namedChildren ?? [];
                left.forEach((l, i) => bind(l, valueType(right[i])));
                break;
            }
            case 'let_declaration': { // Rust
                const t = n.childForFieldName('type');
                bind(n.childForFieldName('pattern'), t ? namedType(t.text) : valueType(n.childForFieldName('value')));
                break;
            }
            case 'property_declaration': { // Kotlin
                const v = n.namedChildren.find(c => c.type === 'variable_declaration');
                const declared = v?.namedChildren.find(c => c.type === 'user_type');
                const value = n.namedChildren[n.namedChildren.length - 1];
                bind(v?.namedChildren.find(c => c.type === 'simple_identifier'), declared ? namedType(declared.text) : valueType(value));
                break;
            }
        }
    }
    return result();
}

/**
 * Collects name → type bindings. A name bound to two different types is
 * dropped: which one a call sees is unknown.
 */
function typeBindings() {
    const types = new Map<string, string | null>();
    const bind = (nameNode: Parser.SyntaxNode | null | undefined, typeName: string | undefined) => {
        if (!nameNode || !typeName || !/identifier$/.test(nameNode.type)) return;
        const prior = types.get(nameNode.text);
        types.set(nameNode.text, prior === undefined || prior === typeName ? typeName : null);
    };
    const result = () => new Map([...types].filter((e): e is [string, string] => e[1] !== null));
    return { bind, result };
}

/**
 * Members typed by their declaration or assignment in the type's body:
 * `self.client = Client()` (Python), `private Client client;` (Java, C#),
 * struct fields `c *client.Client` / `c: Client` (Go, Rust), Kotlin properties.
 */
export function memberTypes(typeNodes: Parser.SyntaxNode[]): Map<string, string> {
    const { bind, result } = typeBindings();
    for (const t of typeNodes) {
        for (const n of t.descendantsOfType(['assignment', 'field_declaration', 'property_declaration'])) {
            if (n.type === 'assignment') {
                const left = n.childForFieldName('left');
                if (left?.type === 'attribute' && SELF_RECEIVERS.has(left.childForFieldName('object')?.text ?? '')) {
                    bind(left.childForFieldName('attribute'), valueType(n.childForFieldName('right')));
                }
            } else if (n.type === 'field_declaration') {
                const names = n.namedChildren.filter(c => c.type === 'field_identifier'); // Go, Rust
                if (names.length > 0) {
                    const typeName = namedType(n.childForFieldName('type')?.text ?? '');
                    for (const name of names) bind(name, typeName);
                } else { // Java, C#
                    const typeNode = n.childForFieldName('type') ?? n.namedChildren.find(c => c.type === 'variable_declaration')?.namedChildren[0];
                    for (const d of n.descendantsOfType('variable_declarator')) {
                        const value = d.childForFieldName('value') ?? (d.namedChildren.length > 1 ? d.namedChildren[d.namedChildren.length - 1] : null);
                        bind(d.childForFieldName('name') ?? d.namedChildren[0], (typeNode && namedType(typeNode.text)) ?? valueType(value));
                    }
                }
            } else { // Kotlin
                const v = n.namedChildren.find(c => c.type === 'variable_declaration');
                const declared = v?.namedChildren.find(c => c.type === 'user_type');
                bind(v?.namedChildren.find(c => c.type === 'simple_identifier'), declared ? namedType(declared.text) : valueType(n.namedChildren[n.namedChildren.length - 1]));
            }
        }
    }
    return result();
}

/**
 * What a value is known to be: the type it constructs, or else the result of
 * the call that produced it, written `callee()` for the update pipeline to
 * resolve through the callee's declared return type.
 */
function valueType(expr: Parser.SyntaxNode | null | undefined): string | undefined {
    const constructed = constructedType(expr);
    if (constructed || !expr) return constructed;
    const callee = expr.type === 'call' || expr.type === 'call_expression' ? (expr.childForFieldName('function') ?? expr.namedChildren[0])
        : expr.type === 'method_invocation' ? expr : undefined;
    if (!callee) return undefined;
    const text = expr.type === 'method_invocation'
        ? [expr.childForFieldName('object')?.text, expr.childForFieldName('name')?.text].filter(Boolean).join('.')
        : callee.text;
    return /^[\w$.:]+$/.test(text) ? `${text.replace(/::/g, '.')}()` : undefined;
}

const LOCAL_DECLARATIONS = ['assignment', 'local_variable_declaration', 'variable_declaration', 'short_var_declaration', 'let_declaration', 'property_declaration'];

/** The type an expression constructs: `Client()`, `new Client()`, `&pkg.T{}`, `T { .. }`, `T::new()`. */
function constructedType(expr: Parser.SyntaxNode | null | undefined): string | undefined {
    if (!expr) return undefined;
    switch (expr.type) {
        case 'call': { // Python: calling a class constructs it
            const f = expr.childForFieldName('function');
            return f && (f.type === 'identifier' || f.type === 'attribute') ? namedType(f.text) : undefined;
        }
        case 'object_creation_expression': // Java, C#
            return namedType((expr.childForFieldName('type') ?? expr.namedChildren[0])?.text ?? '');
        case 'composite_literal': // Go
            return namedType(expr.childForFieldName('type')?.text ?? '');
        case 'unary_expression': // Go `&T{}`
            return expr.childForFieldName('operator')?.text === '&' ? constructedType(expr.childForFieldName('operand')) : undefined;
        case 'struct_expression': // Rust
            return namedType(expr.childForFieldName('name')?.text ?? '');
        case 'call_expression': {
            const f = expr.childForFieldName('function') ?? expr.namedChildren[0];
            if (f?.type === 'scoped_identifier') { // Rust `T::new()`: constructors by convention
                const name = f.childForFieldName('name')?.text ?? '';
                return /^(new|default)$|^(new|with|from)_/.test(name) ? namedType(f.childForFieldName('path')?.text ?? '') : undefined;
            }
            return f?.type === 'simple_identifier' ? namedType(f.text) : undefined; // Kotlin `Client()`
        }
    }
    return undefined;
}

/** Base types a class names: Python `class A(Base)`, Java `extends`, C# base list, Kotlin delegation. */
export function baseTypeNames(classNode: Parser.SyntaxNode): string[] {
    const bases: string[] = [];
    const supers = classNode.childForFieldName('superclasses'); // Python
    for (const c of supers?.namedChildren ?? []) if (c.type === 'identifier' || c.type === 'attribute') bases.push(c.text);
    for (const c of classNode.namedChildren) {
        if (c.type === 'superclass') bases.push(c.namedChildren[0]?.text ?? ''); // Java
        else if (c.type === 'base_list') bases.push(...c.namedChildren.map(b => b.text)); // C#
        else if (c.type === 'delegation_specifier') bases.push(c.descendantsOfType('user_type')[0]?.text ?? ''); // Kotlin
    }
    return bases.map(b => namedType(b)).filter((b): b is string => !!b);
}

/** `*client.Client`, `&mut Client`, `"Client"`, `Optional[Client]` → `Client`; anything else → undefined. */
function namedType(text: string): string | undefined {
    let t = text.trim().replace(/^["']|["']$/g, '');
    const optional = /^Optional\[(.+)\]$/s.exec(t);
    if (optional) t = optional[1];
    t = t.replace(/^&\s*(?:'\w+\s+)?(?:mut\s+)?/, '').replace(/^\*+/, '');
    const name = t.split(/::|\./).pop() ?? '';
    // Type names are capitalized; this also skips primitives such as `int`.
    return /^[A-Z]\w*$/.test(name) ? name : undefined;
}

/**
 * Modifiers, annotations and decorators declared on a definition: Java and
 * Kotlin `modifiers` (`@Override private static`), C# `[Attr]` and `modifier`,
 * Rust and PHP `visibility_modifier`, Python `@decorator` lines.
 */
export function declaredModifiers(defNode: Parser.SyntaxNode): string[] {
    const out: string[] = [];
    if (defNode.parent?.type === 'decorated_definition') {
        for (const c of defNode.parent.namedChildren) if (c.type === 'decorator') out.push(c.text.trim());
    }
    for (const c of defNode.namedChildren) {
        if (c.type === 'modifiers') {
            // Keywords such as `private` are anonymous nodes, so read every child.
            out.push(...c.children.map(m => m.text.trim()));
        } else if (c.type === 'modifier' || c.type === 'visibility_modifier' || c.type === 'attribute_list') {
            out.push(c.text.trim());
        }
    }
    return out.filter(Boolean);
}

/** Visibility named by a modifier keyword, or undefined when none is declared. */
function keywordVisibility(modifiers: readonly string[]): Visibility | undefined {
    for (const m of modifiers) {
        if (m === 'private' || m === 'protected' || m === 'internal') return m;
        if (m === 'public' || m.startsWith('pub')) return 'public';
    }
    return undefined;
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
            const modifiers = modifiersCapture ? modifiersCapture.node.text.split(/\s+/) : declaredModifiers(node);

            nodes.push({
                qualified_name: qname,
                symbol_type: type,
                language: provider.languageName,
                file_path: normalizedFilePath,
                start_line: node.startPosition.row + 1,
                end_line: node.endPosition.row + 1,
                visibility: provider.visibilityOf?.(node, name, modifiers) ?? keywordVisibility(modifiers) ?? 'public',
                is_generated: false,
                last_updated_commit: commit,
                version: version,
                loc: node.endPosition.row - node.startPosition.row + 1,
                cyclomatic: MetricsCalculator.calculateCyclomaticComplexityTreeSitter(node, provider.getDecisionPoints()),
                signature: paramsCapture ? `${name}${paramsCapture.node.text}` : undefined,
                return_type: returnCapture ? returnCapture.node.text.replace(/^[:\s->]+/, '') : undefined,
                modifiers: modifiers.length > 0 ? modifiers : undefined,
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

        /**
         * The type that owns a definition: its enclosing class (with the class
         * node, for its bases), or for a Go method its receiver type.
         */
        const ownerOf = (defNode: Parser.SyntaxNode): { name: string; node?: Parser.SyntaxNode } | undefined => {
            for (let p = defNode.parent; p; p = p.parent) {
                const d = definitionById.get(p.id);
                if (d && OWNER_SYMBOL_TYPES.has(d.type)) return { name: d.name, node: p };
            }
            const receiverType = provider.ownerTypeName?.(defNode);
            return receiverType ? { name: receiverType } : undefined;
        };
        const memberTypeCache = new Map<string, Map<string, string>>();
        const memberTypesOf = (typeName: string) => {
            let types = memberTypeCache.get(typeName);
            if (!types) {
                // Every definition of the type in this file: a Rust struct and
                // its impl blocks, or a Go type and its methods' receiver.
                const nodes = definitions.filter(d => d.name === typeName && OWNER_SYMBOL_TYPES.has(d.type)).map(d => d.node);
                memberTypeCache.set(typeName, types = memberTypes(nodes));
            }
            return types;
        };
        const localTypeCache = new Map<number, Map<string, string>>();
        const localTypesOf = (defNode: Parser.SyntaxNode) => {
            let types = localTypeCache.get(defNode.id);
            if (!types) localTypeCache.set(defNode.id, types = localTypes(defNode));
            return types;
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
                            // Java `shared()` in a subclass: an inherited member.
                            const owner = callerNode ? ownerOf(callerNode) : undefined;
                            if (!localTarget && provider.implicitMemberCalls && owner?.name) toQName = `${owner.name}.${callee.name}`;
                        }
                    } else {
                        let qualifier = normalizeQualifier(callee.qualifier);
                        const receiverVar = callerNode ? provider.receiverName?.(callerNode) : undefined;
                        const owner = callerNode ? ownerOf(callerNode) : undefined;
                        const isSelf = (q: string) => SELF_RECEIVERS.has(q) || q === receiverVar;
                        if (isSelf(qualifier)) {
                            localTarget = resolveOwnMember(callee.name.toLowerCase(), fromQName);
                            // Not defined on the caller's own type here: it may be
                            // inherited, or defined in another file of a Go package.
                            if (owner?.name) qualifier = owner.name;
                        } else if (/^super(\(.*\))?$/s.test(qualifier)) {
                            qualifier = (owner?.node && baseTypeNames(owner.node)[0]) || qualifier;
                        } else {
                            // A parameter, a local, or (where `foo` means `this.foo`) a field.
                            if (callerNode && /^[\w$]+$/.test(qualifier)) {
                                qualifier = parameterTypes(callerNode).get(qualifier)
                                    ?? localTypesOf(callerNode).get(qualifier)
                                    ?? (provider.implicitMemberCalls && owner ? memberTypesOf(owner.name).get(qualifier) : undefined)
                                    ?? qualifier;
                            }
                            // Java `make().configure()`: a bare call in a chain is `this.make()`.
                            if (provider.implicitMemberCalls && owner && /^[\w$]+\(.*\)$/s.test(qualifier)) {
                                qualifier = `${owner.name}.${qualifier}`;
                            }
                            // `self.client.configure()`: the attribute's type. A call
                            // on self (`self.make().run()`) is the owner's method. An
                            // attribute of unknown type stays `self.<attr>`, which is
                            // never mistaken for a module of the same name.
                            const head = qualifier.split('.')[0];
                            if (head !== qualifier && isSelf(head)) {
                                const rest = qualifier.slice(head.length + 1);
                                qualifier = rest.endsWith(')')
                                    ? `${owner?.name ?? 'self'}.${rest}`
                                    : (owner && /^[\w$]+$/.test(rest) ? memberTypesOf(owner.name).get(rest) : undefined) ?? `self.${rest}`;
                            }
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
