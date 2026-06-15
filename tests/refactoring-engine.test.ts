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
