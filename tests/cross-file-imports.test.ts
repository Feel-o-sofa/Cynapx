/**
 * P8-3: Cross-file local import resolution for tree-sitter languages.
 *
 * Verifies that the generic TreeSitterParser resolves local/relative imports
 * to canonical local file paths (so they become real cross-file edges once
 * indexed), while keeping external package imports (pypi:/crate:) unchanged.
 *
 * The parser returns raw `RawCodeEdge[]` whose `to_qname` is still a string
 * (not yet resolved to a node id), so we assert directly on the emitted
 * `to_qname` values.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { TreeSitterParser } from '../src/indexer/tree-sitter-parser';
import { toCanonical } from '../src/utils/paths';
import type { RawCodeEdge } from '../src/indexer/types';

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-p83-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function dependsOn(edges: RawCodeEdge[]): RawCodeEdge[] {
    return edges.filter(e => e.edge_type === 'depends_on');
}

function writeFile(rel: string, content: string): string {
    const abs = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return abs;
}

describe('P8-3 cross-file local import resolution', () => {
    it('Python: `from .utils import x` resolves to a sibling .py file', async () => {
        const file = writeFile('pkg/main.py', 'from .utils import x\n');
        writeFile('pkg/utils.py', 'def x():\n    pass\n');

        const parser = new TreeSitterParser();
        const { edges } = await parser.parse(file, 'commit1', 1);

        const expected = toCanonical(path.join(tmpDir, 'pkg', 'utils.py'));
        const edge = dependsOn(edges).find(e => e.to_qname === expected);
        expect(edge).toBeDefined();
        expect(edge!.dynamic).toBe(false);
    });

    it('Python: `from ..common import y` resolves up one directory', async () => {
        const file = writeFile('pkg/sub/main.py', 'from ..common import y\n');
        writeFile('pkg/common.py', 'def y():\n    pass\n');

        const parser = new TreeSitterParser();
        const { edges } = await parser.parse(file, 'commit1', 1);

        const expected = toCanonical(path.join(tmpDir, 'pkg', 'common.py'));
        const edge = dependsOn(edges).find(e => e.to_qname === expected);
        expect(edge).toBeDefined();
    });

    it('Python: `from . import z` resolves the imported name to a sibling module', async () => {
        const file = writeFile('pkg/main.py', 'from . import z\n');
        writeFile('pkg/z.py', 'pass\n');

        const parser = new TreeSitterParser();
        const { edges } = await parser.parse(file, 'commit1', 1);

        const expected = toCanonical(path.join(tmpDir, 'pkg', 'z.py'));
        const edge = dependsOn(edges).find(e => e.to_qname === expected);
        expect(edge).toBeDefined();
    });

    it('Python: absolute `import requests` still emits pypi:requests', async () => {
        const file = writeFile('pkg/main.py', 'import requests\n');

        const parser = new TreeSitterParser();
        const { edges } = await parser.parse(file, 'commit1', 1);

        const edge = dependsOn(edges).find(e => e.to_qname === 'pypi:requests');
        expect(edge).toBeDefined();
        // No relative file edge should have been emitted for an absolute import.
        const fileEdge = dependsOn(edges).find(e => e.to_qname.endsWith('requests.py'));
        expect(fileEdge).toBeUndefined();
    });

    it('Rust: `mod foo;` resolves to a sibling .rs file', async () => {
        const file = writeFile('lib.rs', 'mod foo;\n');
        writeFile('foo.rs', 'pub fn foo() {}\n');

        const parser = new TreeSitterParser();
        const { edges } = await parser.parse(file, 'commit1', 1);

        const expected = toCanonical(path.join(tmpDir, 'foo.rs'));
        const edge = dependsOn(edges).find(e => e.to_qname === expected);
        expect(edge).toBeDefined();
        expect(edge!.dynamic).toBe(false);
    });

    it('Rust: inline `mod bar { ... }` does NOT emit a file edge', async () => {
        const file = writeFile('lib.rs', 'mod bar {\n    pub fn x() {}\n}\n');

        const parser = new TreeSitterParser();
        const { edges } = await parser.parse(file, 'commit1', 1);

        const barFileEdge = dependsOn(edges).find(e => e.to_qname.endsWith('bar.rs'));
        expect(barFileEdge).toBeUndefined();
        const modModEdge = dependsOn(edges).find(e => e.to_qname.includes(toCanonical(path.join(tmpDir, 'bar'))));
        expect(modModEdge).toBeUndefined();
    });
});
