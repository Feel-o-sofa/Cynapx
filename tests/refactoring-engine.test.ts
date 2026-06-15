/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Unit tests for RefactoringEngine.getRiskProfile().
 * Phase 23-3 (L-10 partial): gates the churn(0.4)/complexity(0.3)/coupling(0.3)
 * weighted risk scoring and CRITICAL(>0.8)/HIGH(>0.5)/MEDIUM(>0.2)/LOW threshold
 * classification of getRiskProfile(). Test-only — zero prod code changes.
 *
 * Uses the same in-memory better-sqlite3 + schema.sql pattern as
 * tests/optimization-engine.test.ts, since GraphEngine.getNodeByQualifiedName()
 * is backed by NodeRepository/SQLite (and internal qnameCache), not easily
 * stubbable in isolation. proposeRefactor() (BFS traverse) is out of scope.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { GraphEngine } from '../src/graph/graph-engine';
import { RefactoringEngine } from '../src/graph/refactoring-engine';
import { NodeRepository } from '../src/db/node-repository';
import { EdgeRepository } from '../src/db/edge-repository';
import { CodeNode } from '../src/types';

function createInMemoryEngine(): { engine: GraphEngine; nodeRepo: NodeRepository; edgeRepo: EdgeRepository; db: Database.Database } {
    const db = new Database(':memory:');
    const schemaPath = path.resolve(__dirname, '../schema/schema.sql');
    const fullSchema = fs.readFileSync(schemaPath, 'utf8');
    const filteredSchema = fullSchema
        .split(';')
        .filter(stmt => !stmt.includes('vec0'))
        .join(';');
    db.exec(filteredSchema);

    const nodeRepo = new NodeRepository(db);
    const edgeRepo = new EdgeRepository(db);
    const engine = new GraphEngine(nodeRepo, edgeRepo);
    return { engine, nodeRepo, edgeRepo, db };
}

function makeNode(nodeRepo: NodeRepository, overrides: Partial<CodeNode> & { qualified_name: string }): number {
    return nodeRepo.createNode({
        symbol_type: 'method',
        language: 'typescript',
        file_path: 'test.ts',
        start_line: 1,
        end_line: 10,
        visibility: 'private',
        is_generated: false,
        last_updated_commit: 'abc',
        version: 1,
        fan_in: 0,
        fan_out: 0,
        ...overrides,
    } as CodeNode);
}

/** Build an array of N dummy git-history entries for churn counting. */
function dummyHistory(n: number): { hash: string; message: string; author: string; date: string }[] {
    return Array.from({ length: n }, (_, i) => ({
        hash: `hash${i}`,
        message: `commit ${i}`,
        author: 'tester',
        date: '2026-01-01',
    }));
}

describe('RefactoringEngine.getRiskProfile() — Phase 23-3 risk threshold gate', () => {
    let engine: GraphEngine;
    let nodeRepo: NodeRepository;
    let refactorEngine: RefactoringEngine;

    beforeEach(() => {
        ({ engine, nodeRepo } = createInMemoryEngine());
        refactorEngine = new RefactoringEngine(engine);
    });

    it('classifies maxed-out churn+complexity+coupling as CRITICAL (score 1.0)', async () => {
        // churn: min(20/20,1)*0.4 = 0.4
        // complexity: min(30/30,1)*0.3 = 0.3
        // coupling: min(50/50,1)*0.3 = 0.3  => total 1.0 (>0.8 => CRITICAL)
        const qn = 'a.ts#Foo.critical';
        makeNode(nodeRepo, {
            qualified_name: qn,
            history: dummyHistory(20),
            cyclomatic: 30,
            fan_in: 50,
        });

        const result = await refactorEngine.getRiskProfile(qn);
        expect(result).not.toBeNull();
        expect(result!.symbol).toBe(qn);
        expect(result!.level).toBe('CRITICAL');
        expect(result!.score).toBe(parseFloat((1.0).toFixed(2)));
        expect(result!.score).toBe(1.0);

        expect(result!.factors).toEqual([
            { metric: 'Git Churn', value: 20, impact: 0.4 },
            { metric: 'Complexity', value: 30, impact: 0.3 },
            { metric: 'Coupling (Fan-in)', value: 50, impact: 0.3 },
        ]);
    });

    it('classifies churn 0.4 + complexity 0.15 as HIGH (score 0.55)', async () => {
        // churn: min(20/20,1)*0.4 = 0.4
        // complexity: min(15/30,1)*0.3 = 0.15
        // coupling: 0  => total 0.55 (>0.5 => HIGH)
        const qn = 'a.ts#Foo.high';
        makeNode(nodeRepo, {
            qualified_name: qn,
            history: dummyHistory(20),
            cyclomatic: 15,
            fan_in: 0,
        });

        const result = await refactorEngine.getRiskProfile(qn);
        expect(result).not.toBeNull();
        expect(result!.level).toBe('HIGH');
        expect(result!.score).toBe(0.55);
    });

    it('classifies churn-only 0.3 as MEDIUM (score 0.3, boundary > 0.2)', async () => {
        // churn: min(15/20,1)*0.4 = 0.75*0.4 = 0.3
        // complexity: 0, coupling: 0  => total 0.3 (>0.2 => MEDIUM, strictly above the 0.2 boundary)
        const qn = 'a.ts#Foo.medium';
        makeNode(nodeRepo, {
            qualified_name: qn,
            history: dummyHistory(15),
            cyclomatic: 0,
            fan_in: 0,
        });

        const result = await refactorEngine.getRiskProfile(qn);
        expect(result).not.toBeNull();
        expect(result!.level).toBe('MEDIUM');
        expect(result!.score).toBe(0.3);
    });

    it('classifies all-zero metrics as LOW (score 0)', async () => {
        // churn: 0, complexity: 0, coupling: 0 => total 0 (LOW)
        const qn = 'a.ts#Foo.low';
        makeNode(nodeRepo, {
            qualified_name: qn,
            history: [],
            cyclomatic: 0,
            fan_in: 0,
        });

        const result = await refactorEngine.getRiskProfile(qn);
        expect(result).not.toBeNull();
        expect(result!.symbol).toBe(qn);
        expect(result!.level).toBe('LOW');
        expect(result!.score).toBe(0);
        expect(result!.factors).toEqual([
            { metric: 'Git Churn', value: 0, impact: 0 },
            { metric: 'Complexity', value: 0, impact: 0 },
            { metric: 'Coupling (Fan-in)', value: 0, impact: 0 },
        ]);
    });

    it('returns null for a non-existent symbol (!node branch)', async () => {
        const result = await refactorEngine.getRiskProfile('does.not.exist');
        expect(result).toBeNull();
    });
});

describe('RefactoringEngine.proposeRefactor() — Phase 25-1 traverse/risk/reasons/steps gate', () => {
    let engine: GraphEngine;
    let nodeRepo: NodeRepository;
    let edgeRepo: EdgeRepository;
    let refactorEngine: RefactoringEngine;

    beforeEach(() => {
        ({ engine, nodeRepo, edgeRepo } = createInMemoryEngine());
        refactorEngine = new RefactoringEngine(engine);
    });

    /** Seed N caller nodes with incoming 'calls' edges into the target node. */
    function seedIncomingCallers(targetId: number, n: number): void {
        for (let i = 0; i < n; i++) {
            const callerId = makeNode(nodeRepo, { qualified_name: `caller${i}.ts#Caller.m${i}` });
            edgeRepo.createEdge({ from_id: callerId, to_id: targetId, edge_type: 'calls', dynamic: false });
        }
    }

    it('returns null for a non-existent qualified_name (!node branch)', async () => {
        const result = await refactorEngine.proposeRefactor('does.not.exist');
        expect(result).toBeNull();
    });

    it('counts impacted nodes via incoming BFS traversal (target + callers)', async () => {
        const qn = 'a.ts#Foo.target';
        const targetId = makeNode(nodeRepo, { qualified_name: qn });
        seedIncomingCallers(targetId, 3);

        const result = await refactorEngine.proposeRefactor(qn);
        expect(result).not.toBeNull();
        expect(result!.symbol).toBe(qn);
        // BFS includes the start node itself plus its 3 incoming callers.
        expect(result!.impactedNodeCount).toBe(4);
    });

    it('calculateRisk: fan_in 50 => CRITICAL', async () => {
        const qn = 'a.ts#Foo.crit';
        makeNode(nodeRepo, { qualified_name: qn, fan_in: 50, cyclomatic: 0 });
        const result = await refactorEngine.proposeRefactor(qn);
        expect(result!.risk).toBe('CRITICAL');
    });

    it('calculateRisk: fan_in 20 => HIGH', async () => {
        const qn = 'a.ts#Foo.high';
        makeNode(nodeRepo, { qualified_name: qn, fan_in: 20, cyclomatic: 0 });
        const result = await refactorEngine.proposeRefactor(qn);
        expect(result!.risk).toBe('HIGH');
    });

    it('calculateRisk: cyclomatic 8 => MEDIUM', async () => {
        const qn = 'a.ts#Foo.med';
        makeNode(nodeRepo, { qualified_name: qn, fan_in: 0, cyclomatic: 8 });
        const result = await refactorEngine.proposeRefactor(qn);
        expect(result!.risk).toBe('MEDIUM');
    });

    it('calculateRisk: all-zero metrics => LOW', async () => {
        const qn = 'a.ts#Foo.low';
        makeNode(nodeRepo, { qualified_name: qn, fan_in: 0, cyclomatic: 0 });
        const result = await refactorEngine.proposeRefactor(qn);
        expect(result!.risk).toBe('LOW');
    });

    it('getRiskReasons: fanIn>20 and cyclomatic>15 push coupling/complexity reasons', async () => {
        const qn = 'a.ts#Foo.coupled';
        makeNode(nodeRepo, { qualified_name: qn, fan_in: 21, cyclomatic: 16 });
        const result = await refactorEngine.proposeRefactor(qn);
        expect(result!.reasons.some(r => r.includes('High coupling'))).toBe(true);
        expect(result!.reasons.some(r => r.includes('High complexity'))).toBe(true);
    });

    it('getRiskReasons: tags trigger entrypoint/core/data reasons', async () => {
        const qn = 'a.ts#Foo.tagged';
        makeNode(nodeRepo, {
            qualified_name: qn,
            fan_in: 0,
            cyclomatic: 0,
            tags: ['trait:entrypoint', 'layer:core', 'layer:data'],
        });
        const result = await refactorEngine.proposeRefactor(qn);
        expect(result!.reasons.some(r => r.includes('System entrypoint'))).toBe(true);
        expect(result!.reasons.some(r => r.includes('Core layer symbol'))).toBe(true);
        expect(result!.reasons.some(r => r.includes('Data layer symbol'))).toBe(true);
    });

    it('getRiskReasons: low/untagged node falls back to "Low complexity and coupling."', async () => {
        const qn = 'a.ts#Foo.plain';
        makeNode(nodeRepo, { qualified_name: qn, fan_in: 0, cyclomatic: 0, tags: [] });
        const result = await refactorEngine.proposeRefactor(qn);
        expect(result!.reasons).toContain('Low complexity and coupling.');
    });

    it('generateSteps: CRITICAL risk includes Investigation, Abstraction, Branch by Abstraction, and Cleanup backfill', async () => {
        const qn = 'a.ts#Foo.critsteps';
        makeNode(nodeRepo, { qualified_name: qn, fan_in: 50, cyclomatic: 0 });
        const result = await refactorEngine.proposeRefactor(qn);
        const steps = result!.steps;
        expect(steps[0]).toContain('[Investigation]');
        expect(steps.some(s => s.includes('[Abstraction]'))).toBe(true);
        expect(steps.some(s => s.includes('Branch by Abstraction'))).toBe(true);
        expect(steps[steps.length - 1]).toContain('[Cleanup]');
        expect(steps[steps.length - 1]).toContain('backfill_history');
    });

    it('generateSteps: MEDIUM risk includes a Preparation step mentioning unit tests', async () => {
        const qn = 'a.ts#Foo.medsteps';
        makeNode(nodeRepo, { qualified_name: qn, fan_in: 0, cyclomatic: 8 });
        const result = await refactorEngine.proposeRefactor(qn);
        const steps = result!.steps;
        expect(steps[0]).toContain('[Investigation]');
        expect(steps.some(s => s.startsWith('2. [Preparation]') && s.includes('Ensure unit tests'))).toBe(true);
    });

    it('generateSteps: Verification step interpolates impact.slice(0,3) qualified names', async () => {
        const qn = 'a.ts#Foo.verify';
        const targetId = makeNode(nodeRepo, { qualified_name: qn });
        const callerId = makeNode(nodeRepo, { qualified_name: 'caller.ts#Caller.only' });
        edgeRepo.createEdge({ from_id: callerId, to_id: targetId, edge_type: 'calls', dynamic: false });

        const result = await refactorEngine.proposeRefactor(qn);
        const verification = result!.steps.find(s => s.includes('[Verification]'));
        expect(verification).toBeDefined();
        expect(verification!).toContain('caller.ts#Caller.only');
    });
});
