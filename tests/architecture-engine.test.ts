/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Unit tests for ArchitectureEngine custom rule loading (P9-M-1).
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ArchitectureEngine, ArchRule } from '../src/graph/architecture-engine';

// ---------------------------------------------------------------------------
// Minimal GraphEngine stub — only what ArchitectureEngine constructor touches
// ---------------------------------------------------------------------------
function makeStubGraphEngine() {
    return {
        getAllEdges: () => [],
        getAllNodes: () => [],
        getNodeById: (_id: number) => undefined,
        getOutgoingEdges: (_id: number) => [],
    } as unknown as import('../src/graph/graph-engine').GraphEngine;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let tmpFiles: string[] = [];

function writeTmp(content: string): string {
    const p = path.join(os.tmpdir(), `arch-rules-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(p, content, 'utf-8');
    tmpFiles.push(p);
    return p;
}

afterEach(() => {
    for (const f of tmpFiles) {
        try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    tmpFiles = [];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ArchitectureEngine custom rules', () => {
    it('loadRules() parses valid JSON and hasCustomRules becomes true', () => {
        const rules: ArchRule[] = [
            { name: 'No server→db direct access', from: 'server', to: 'db', allowed: false },
            { name: 'graph can call db', from: 'graph', to: 'db', allowed: true },
        ];
        const rulesPath = writeTmp(JSON.stringify(rules));

        const engine = new ArchitectureEngine(makeStubGraphEngine());
        expect(engine.hasCustomRules).toBe(false);

        engine.loadRules(rulesPath);

        expect(engine.hasCustomRules).toBe(true);
    });

    it('loadRules() throws a descriptive error on invalid JSON', () => {
        const rulesPath = writeTmp('{ this is not valid json }');

        const engine = new ArchitectureEngine(makeStubGraphEngine());

        expect(() => engine.loadRules(rulesPath)).toThrow(/arch-rules\.json.*invalid JSON/i);
    });

    it('loadRules() throws when file content is not an array', () => {
        const rulesPath = writeTmp(JSON.stringify({ name: 'not an array' }));

        const engine = new ArchitectureEngine(makeStubGraphEngine());

        expect(() => engine.loadRules(rulesPath)).toThrow(/arch-rules\.json.*expected a JSON array/i);
    });

    it('loadRules() throws when file does not exist', () => {
        const engine = new ArchitectureEngine(makeStubGraphEngine());

        expect(() => engine.loadRules('/nonexistent/path/arch-rules.json')).toThrow(/arch-rules\.json.*failed to read file/i);
    });

    it('checkViolations() emits custom rule violations for forbidden path-segment edges', async () => {
        const rules: ArchRule[] = [
            { name: 'No server→db direct access', from: 'server', to: 'db', allowed: false },
        ];
        const rulesPath = writeTmp(JSON.stringify(rules));

        const fromNode = { id: 1, qualified_name: 'server/handler', file_path: 'src/server/handler.ts', tags: [], symbol_type: 'function' };
        const toNode   = { id: 2, qualified_name: 'db/client',      file_path: 'src/db/client.ts',      tags: [], symbol_type: 'function' };
        const edge     = { from_id: 1, to_id: 2, edge_type: 'calls' };

        const stubEngine = {
            getAllEdges: () => [edge],
            getAllNodes: () => [],
            getNodeById: (id: number) => id === 1 ? fromNode : id === 2 ? toNode : undefined,
            getOutgoingEdges: () => [],
        } as unknown as import('../src/graph/graph-engine').GraphEngine;

        const engine = new ArchitectureEngine(stubEngine);
        engine.loadRules(rulesPath);

        const violations = await engine.checkViolations();

        const customViolation = violations.find(v => v.policyId.startsWith('custom:'));
        expect(customViolation).toBeDefined();
        expect(customViolation!.policyId).toBe('custom:No server→db direct access');
        expect(customViolation!.description).toMatch(/server.*db/);
    });

    it('checkViolations() does not emit violations for allowed custom rules', async () => {
        const rules: ArchRule[] = [
            { name: 'graph can call db', from: 'graph', to: 'db', allowed: true },
        ];
        const rulesPath = writeTmp(JSON.stringify(rules));

        const fromNode = { id: 1, qualified_name: 'graph/engine', file_path: 'src/graph/engine.ts', tags: [], symbol_type: 'function' };
        const toNode   = { id: 2, qualified_name: 'db/client',    file_path: 'src/db/client.ts',    tags: [], symbol_type: 'function' };
        const edge     = { from_id: 1, to_id: 2, edge_type: 'calls' };

        const stubEngine = {
            getAllEdges: () => [edge],
            getAllNodes: () => [],
            getNodeById: (id: number) => id === 1 ? fromNode : id === 2 ? toNode : undefined,
            getOutgoingEdges: () => [],
        } as unknown as import('../src/graph/graph-engine').GraphEngine;

        const engine = new ArchitectureEngine(stubEngine);
        engine.loadRules(rulesPath);

        const violations = await engine.checkViolations();

        const customViolations = violations.filter(v => v.policyId.startsWith('custom:'));
        expect(customViolations).toHaveLength(0);
    });
});
