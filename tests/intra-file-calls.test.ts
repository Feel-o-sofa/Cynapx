/**
 * P8-2: Intra-file call resolution for tree-sitter languages.
 *
 * Verifies that the generic TreeSitterParser resolves `calls` edges whose
 * target is a symbol defined in the same file to the symbol's fully qualified
 * name (and marks them as statically resolved, dynamic=false), while leaving
 * external / unknown / method-style calls as bare names (dynamic=true).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { TreeSitterParser } from '../src/indexer/tree-sitter-parser';
import type { RawCodeEdge } from '../src/indexer/types';

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-p82-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function callEdges(edges: RawCodeEdge[]): RawCodeEdge[] {
    return edges.filter(e => e.edge_type === 'calls');
}

describe('P8-2 intra-file call resolution', () => {
    it('resolves a call to a same-file function to its full qname (dynamic=false)', async () => {
        const src = `
function helper(x: number): number {
    return x + 1;
}

function processData(): number {
    return helper(41);
}
`;
        const file = path.join(tmpDir, 'helpers.ts');
        fs.writeFileSync(file, src);

        const parser = new TreeSitterParser();
        const { edges } = await parser.parse(file, 'commit1', 1);

        const helperCall = callEdges(edges).find(e => e.to_qname.endsWith('#helper'));
        expect(helperCall).toBeDefined();
        // Resolved to a fully qualified name (contains the file path + #helper).
        expect(helperCall!.to_qname).toContain('#helper');
        expect(helperCall!.to_qname).toContain('helpers.ts'.toLowerCase());
        expect(helperCall!.to_qname).not.toBe('helper');
        expect(helperCall!.dynamic).toBe(false);
        // Called from within processData.
        expect(helperCall!.from_qname).toContain('#processdata');
    });

    it('keeps a call to an external/unknown function as a bare name (dynamic=true)', async () => {
        const src = `
function run(): void {
    externalThing(1, 2);
}
`;
        const file = path.join(tmpDir, 'external.ts');
        fs.writeFileSync(file, src);

        const parser = new TreeSitterParser();
        const { edges } = await parser.parse(file, 'commit1', 1);

        const extCall = callEdges(edges).find(e => e.to_qname === 'externalThing');
        expect(extCall).toBeDefined();
        expect(extCall!.to_qname).toBe('externalThing');
        expect(extCall!.dynamic).toBe(true);
    });

    it('does not resolve a method call on an object (obj.method()) to a same-file symbol', async () => {
        // Go's call query captures member calls as `selector_expression field:
        // (field_identifier)`, which exercises the call-resolution path for an
        // attribute access. We define a free function `Configure` AND make a
        // method-style call `c.Configure()`. The method call must NOT be
        // statically resolved to the free function: it stays dynamic.
        const src = `package main

type Client struct{}

func (c *Client) Configure() {}

func Configure() {}

func Run() {
    c := &Client{}
    c.Configure()
}
`;
        const file = path.join(tmpDir, 'dotted.go');
        fs.writeFileSync(file, src);

        const parser = new TreeSitterParser();
        const { edges } = await parser.parse(file, 'commit1', 1);

        // The method call inside Run() is captured. Locate the call edge that
        // originates from Run.
        const fromRun = callEdges(edges).filter(e => e.from_qname.endsWith('#run'));
        const configureCall = fromRun.find(e => e.to_qname.toLowerCase().includes('configure'));
        expect(configureCall).toBeDefined();
        // It must remain unresolved (a method call on an instance is not the
        // same as the package-level free function) — kept dynamic.
        expect(configureCall!.dynamic).toBe(true);
    });

    it('only the bare same-file call is resolved; member access is not captured as a resolved call', async () => {
        // A direct same-file call `method()` resolves to `#method`. A member
        // access `ns.method()` is NOT an identifier-form call target, so it is
        // never resolved to the same-file `#method` symbol.
        const src = `
function method(): void {}

const ns = { method(): void {} };

function caller(): void {
    ns.method();
    method();
}
`;
        const file = path.join(tmpDir, 'guard.ts');
        fs.writeFileSync(file, src);

        const parser = new TreeSitterParser();
        const { edges } = await parser.parse(file, 'commit1', 1);

        const fromCaller = callEdges(edges).filter(e => e.from_qname.endsWith('#caller'));

        // The bare same-file call `method()` IS resolved (dynamic=false).
        const resolved = fromCaller.filter(e => e.to_qname.endsWith('#method'));
        expect(resolved.length).toBe(1);
        expect(resolved[0].dynamic).toBe(false);

        // No resolved (#-qualified) edge originates from a member access:
        // there is exactly one resolved `#method` edge, the direct call.
        // (The member access `ns.method()` does not contribute a second one.)
        expect(resolved.length).toBe(1);
    });
});
