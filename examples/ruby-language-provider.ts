/**
 * Ruby Language Provider — Example Plugin for Cynapx
 *
 * NOTE: This is an example file. It will NOT compile cleanly on its own because
 * it imports 'tree-sitter-ruby', which is not installed in this repository.
 * To use this provider:
 *   1. npm install tree-sitter-ruby  (in the directory from which Node resolves modules)
 *   2. Compile to CommonJS (e.g., npx tsc --module commonjs --target es2022)
 *   3. Copy the compiled .js file to ~/.cynapx/plugins/
 *
 * The LanguageProvider interface is imported from the Cynapx dist output.
 * Adjust the path below to match your local Cynapx installation directory.
 */

// Import the core types from the compiled Cynapx output.
// In a real plugin the path would be something like:
//   /usr/local/lib/cynapx/dist/indexer/types
//   or wherever your `npm install -g cynapx` lands.
import { LanguageProvider, RawCodeEdge } from '../src/indexer/types';
import { SymbolType } from '../src/types/index';

// The tree-sitter-ruby npm package provides the compiled Ruby grammar.
// @ts-ignore — no TypeScript declarations are published for this package
import Ruby from 'tree-sitter-ruby';

import Parser from 'tree-sitter';

/**
 * RubyProvider adds Cynapx knowledge-graph support for Ruby (.rb) and
 * Rake build files (.rake, Rakefile).
 *
 * Symbols extracted:
 *   - Classes (class ... end)
 *   - Modules (module ... end)
 *   - Instance methods (def ... end)
 *   - Singleton/class methods (def self.foo ... end)
 *   - Inheritance relationships (class Foo < Bar)
 *   - require / require_relative calls
 *   - include / prepend / extend calls (module mixins)
 */
export class RubyProvider implements LanguageProvider {
    // File extensions handled by this provider (lower-case, no leading dot).
    public extensions = ['rb', 'rake'];

    // Human-readable language name stored on every CodeNode this provider emits.
    public languageName = 'ruby';

    /**
     * Returns the tree-sitter Ruby grammar object.
     * This is passed directly to Parser.setLanguage() by TreeSitterParser.
     */
    public getLanguage(): any {
        return Ruby;
    }

    /**
     * Returns a tree-sitter S-expression query string.
     *
     * Capture naming conventions used by Cynapx:
     *   @class.def      — the whole class body node (used as the symbol boundary)
     *   @class.name     — the identifier holding the class name
     *   @method.def     — the whole method body node
     *   @method.name    — the identifier holding the method name
     *   @relation.inherits — the identifier of the superclass (triggers resolveImport)
     *   @import.stmt    — a require/require_relative call (triggers resolveImport)
     *   @relation.mixin — an include/prepend/extend call (triggers resolveImport)
     */
    public getQuery(): string {
        return `
; ── Classes ──────────────────────────────────────────────────────────────────
; Matches:  class Foo          (no superclass)
;           class Foo < Bar    (with superclass)
(class
    name: (constant) @class.name
    superclass: (superclass (constant) @relation.inherits)?) @class.def

; ── Modules ───────────────────────────────────────────────────────────────────
; Ruby modules act as namespaces and mixins. Map them to the 'module' SymbolType.
(module
    name: (constant) @module.name) @module.def

; ── Instance methods ──────────────────────────────────────────────────────────
; Matches:  def foo ... end
(method
    name: (identifier) @method.name) @method.def

; ── Singleton (class) methods ─────────────────────────────────────────────────
; Matches:  def self.foo ... end  or  def ClassName.foo ... end
(singleton_method
    name: (identifier) @method.name) @method.def

; ── require / require_relative ────────────────────────────────────────────────
; Cynapx calls resolveImport for these captures so dependency edges can be built.
(call
    method: (identifier) @_req_method
    arguments: (argument_list (string) @_req_path)
    (#match? @_req_method "^require(_relative)?$")) @import.stmt

; ── Module mixins (include / prepend / extend) ────────────────────────────────
; These create structural dependencies similar to inheritance.
(call
    method: (identifier) @_mixin_method
    arguments: (argument_list (constant) @relation.mixin)
    (#match? @_mixin_method "^(include|prepend|extend)$"))

; ── Method calls (call graph) ─────────────────────────────────────────────────
(call
    method: (identifier) @call.name) @call.expr
`;
    }

    /**
     * Maps a tree-sitter capture name to a Cynapx SymbolType.
     *
     * The capture name is the string after '@' in the query (e.g., 'class.def').
     * Use prefix matching so that 'class.def' and 'class.name' both return 'class'.
     */
    public mapCaptureToSymbolType(captureName: string): SymbolType {
        if (captureName.startsWith('class'))    return 'class';
        if (captureName.startsWith('module'))   return 'module';
        if (captureName.startsWith('method'))   return 'method';
        if (captureName.startsWith('function')) return 'function';

        // Relation, import, and call captures do not define symbols themselves.
        // Return 'field' as the required non-null fallback; these nodes are
        // processed separately by resolveImport and are not stored as CodeNodes.
        return 'field';
    }

    /**
     * Builds cross-file and cross-symbol edges for import and relation captures.
     *
     * Called by TreeSitterParser whenever a node matches a capture whose name
     * starts with 'relation.' or 'import.'.
     *
     * @param node        The SyntaxNode that matched the capture.
     * @param fromQName   Qualified name of the enclosing symbol (the edge source).
     * @param edges       Array to push RawCodeEdge entries into.
     * @param captureName The capture name that triggered this call.
     */
    public resolveImport(
        node: Parser.SyntaxNode,
        fromQName: string,
        edges: RawCodeEdge[],
        captureName?: string,
    ): void {
        // ── Inheritance: class Foo < Bar ──────────────────────────────────────
        if (captureName === 'relation.inherits') {
            // node.text is the constant name of the superclass, e.g., "ApplicationRecord"
            edges.push({
                from_qname: fromQName,
                to_qname: node.text,
                edge_type: 'inherits',
                dynamic: false,
            });
            return;
        }

        // ── Mixins: include Enumerable, prepend Logging, extend ClassMethods ──
        if (captureName === 'relation.mixin') {
            // node.text is the constant name of the mixed-in module
            edges.push({
                from_qname: fromQName,
                to_qname: node.text,
                edge_type: 'implements',   // closest semantic match available
                dynamic: false,
            });
            return;
        }

        // ── require / require_relative ────────────────────────────────────────
        if (node.type === 'call') {
            const methodNode = node.childForFieldName('method');
            const argsNode   = node.childForFieldName('arguments');
            if (!methodNode || !argsNode) return;

            const methodName = methodNode.text; // 'require' or 'require_relative'
            // First string argument is the path/gem name
            const firstArg = argsNode.namedChild(0);
            if (!firstArg) return;

            // Strip surrounding quotes from the string literal
            const rawPath = firstArg.text.replace(/^['"]|['"]$/g, '');

            if (methodName === 'require_relative') {
                // Relative file dependency within the same project
                edges.push({
                    from_qname: fromQName,
                    to_qname: rawPath,        // resolver will expand to absolute path
                    edge_type: 'depends_on',
                    dynamic: false,
                    target_file_hint: rawPath,
                });
            } else {
                // External gem dependency (require 'json', require 'nokogiri', etc.)
                const gemName = rawPath.split('/')[0]; // top-level gem name
                edges.push({
                    from_qname: fromQName,
                    to_qname: `gem:${gemName}`,
                    edge_type: 'depends_on',
                    dynamic: false,
                });
            }
        }
    }

    /**
     * Returns the tree-sitter node type names that represent branching or looping
     * constructs in Ruby. Used to calculate cyclomatic complexity per method.
     *
     * Ruby branching nodes to cover:
     *   if / unless / elsif / else (modifier forms included)
     *   case / when
     *   while / until / for (loop forms)
     *   rescue (exception handling branch)
     *   &&, ||, and, or (logical short-circuit operators)
     *   ternary (conditional_expression, if_modifier, unless_modifier)
     */
    public getDecisionPoints(): string[] {
        return [
            'if',
            'unless',
            'elsif',
            'if_modifier',
            'unless_modifier',
            'case',
            'when',
            'while',
            'while_modifier',
            'until',
            'until_modifier',
            'for',
            'rescue',
            'conditional',        // ternary: condition ? a : b
            'binary',             // catches &&, ||, and, or
        ];
    }
}
