/**
 * The tree-sitter parser used to mark every symbol `public`, so dead-code
 * analysis never had a private symbol to rank first outside TypeScript.
 * Visibility now comes from declared modifiers, or the language's rule.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TreeSitterParser } from '../src/indexer/tree-sitter-parser';
import { StructuralTagger } from '../src/indexer/structural-tagger';
import type { CodeNode } from '../src/types';

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-vis-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

async function parse(name: string, src: string): Promise<Map<string, CodeNode>> {
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, src);
    const { nodes } = await new TreeSitterParser().parse(file, 'c', 1);
    return new Map(nodes.filter(n => n.qualified_name.includes('#')).map(n => [n.qualified_name.split('#')[1], n]));
}

describe('tree-sitter visibility and modifiers', () => {
    it('Java: reads modifier keywords and annotations', async () => {
        const n = await parse('A.java', 'class A {\n  @Override private static void f() {}\n  protected void g() {}\n  void h() {}\n}\n');
        expect(n.get('a.f')?.visibility).toBe('private');
        expect(n.get('a.f')?.modifiers).toEqual(['@Override', 'private', 'static']);
        expect(n.get('a.g')?.visibility).toBe('protected');
        expect(n.get('a.h')?.visibility).toBe('public');
    });

    it('Rust: private without `pub`, except items of a trait impl', async () => {
        const n = await parse('a.rs', 'pub fn a() {}\nfn b() {}\nstruct X;\nimpl X { fn own(&self) {} }\nimpl Clone for X { fn clone(&self) -> X { X } }\n');
        expect(n.get('a')?.visibility).toBe('public');
        expect(n.get('b')?.visibility).toBe('private');
        expect(n.get('x.own')?.visibility).toBe('private');
        expect(n.get('x.clone')?.visibility).toBe('public');
    });

    it('Go: exported by capitalization', async () => {
        const n = await parse('a.go', 'package a\n\nfunc Exported() {}\n\nfunc unexported() {}\n');
        expect(n.get('exported')?.visibility).toBe('public');
        expect(n.get('unexported')?.visibility).toBe('private');
    });

    it('Python: decorators become modifiers and tag the symbol as decorated', async () => {
        const n = await parse('a.py', 'class A:\n    @property\n    def name(self):\n        return 1\n\n    def _helper(self):\n        pass\n');
        const name = n.get('a.name')!;
        expect(name.modifiers).toEqual(['@property']);
        expect(StructuralTagger.tagNode(name)).toContain('trait:decorated');
        // `_name` convention is read from the member's own name, not `A._helper`.
        expect(StructuralTagger.tagNode(n.get('a._helper')!)).toContain('trait:internal');
    });
});
