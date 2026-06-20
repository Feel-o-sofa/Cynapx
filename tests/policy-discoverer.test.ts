/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Unit tests for PolicyDiscoverer.discoverPolicies().
 * Phase 24-1 (M-1 v21): gates the dependency-edge filter, missing-tag skip,
 * tag-pair counting, totalOut/threshold/minCount thresholds and the
 * probability/description generation behind the live `discover_latent_policies`
 * MCP tool. Test-only — zero prod code changes.
 *
 * Uses the same in-memory better-sqlite3 + schema.sql harness as
 * tests/refactoring-engine.test.ts / tests/optimization-engine.test.ts, since
 * discoverPolicies() resolves nodes via GraphEngine.getNodeById()
 * (NodeRepository/SQLite-backed), not easily stubbable in isolation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { GraphEngine } from '../src/graph/graph-engine';
import { PolicyDiscoverer } from '../src/graph/policy-discoverer';
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

describe('PolicyDiscoverer.discoverPolicies() — Phase 24-1 (M-1 v21) regression gate', () => {
    let engine: GraphEngine;
    let nodeRepo: NodeRepository;
    let edgeRepo: EdgeRepository;
    let discoverer: PolicyDiscoverer;

    beforeEach(() => {
        ({ engine, nodeRepo, edgeRepo } = createInMemoryEngine());
        discoverer = new PolicyDiscoverer(engine);
    });

    it('emits a single policy for a consistent (role:utility -> role:service) pattern', async () => {
        // 5 distinct source nodes tagged role:utility, each calling one of 5
        // distinct target nodes tagged role:service.
        // totalOut('role:utility') = 5, count(util->service) = 5, prob = 1.0 >= 0.9.
        for (let i = 0; i < 5; i++) {
            const from = makeNode(nodeRepo, { qualified_name: `from${i}.ts#Util`, tags: ['role:utility'] });
            const to = makeNode(nodeRepo, { qualified_name: `to${i}.ts#Svc`, tags: ['role:service'] });
            edgeRepo.createEdge({ from_id: from, to_id: to, edge_type: 'calls', dynamic: false } as any);
        }

        const policies = await discoverer.discoverPolicies();
        expect(policies).toHaveLength(1);
        const p = policies[0];
        expect(p.fromTag).toBe('role:utility');
        expect(p.toTag).toBe('role:service');
        expect(p.occurrence).toBeGreaterThanOrEqual(5);
        expect(p.probability).toBeGreaterThanOrEqual(0.9);
        expect(p.description).toContain('role:utility');
        expect(p.description).toContain('role:service');
        expect(p.description).toContain('%');
        expect(p.description).toContain('100.0%');
    });

    it('rejects a pattern below minCount (totalOut < minCount)', async () => {
        // Only 4 qualifying edges => totalOut('role:utility') = 4 < 5 => skipped.
        for (let i = 0; i < 4; i++) {
            const from = makeNode(nodeRepo, { qualified_name: `from${i}.ts#Util`, tags: ['role:utility'] });
            const to = makeNode(nodeRepo, { qualified_name: `to${i}.ts#Svc`, tags: ['role:service'] });
            edgeRepo.createEdge({ from_id: from, to_id: to, edge_type: 'calls', dynamic: false } as any);
        }

        const policies = await discoverer.discoverPolicies();
        expect(policies).toEqual([]);
    });

    it('rejects a target pair whose probability falls below threshold', async () => {
        // totalOut('role:utility') = 10 (>= minCount), but split across two targets:
        //   6 -> role:service  (prob 0.6 < 0.9)
        //   4 -> role:repository (prob 0.4 < 0.9)
        // Neither pair reaches the 0.9 threshold => no policy.
        for (let i = 0; i < 6; i++) {
            const from = makeNode(nodeRepo, { qualified_name: `fromS${i}.ts#Util`, tags: ['role:utility'] });
            const to = makeNode(nodeRepo, { qualified_name: `toS${i}.ts#Svc`, tags: ['role:service'] });
            edgeRepo.createEdge({ from_id: from, to_id: to, edge_type: 'calls', dynamic: false } as any);
        }
        for (let i = 0; i < 4; i++) {
            const from = makeNode(nodeRepo, { qualified_name: `fromR${i}.ts#Util`, tags: ['role:utility'] });
            const to = makeNode(nodeRepo, { qualified_name: `toR${i}.ts#Repo`, tags: ['role:repository'] });
            edgeRepo.createEdge({ from_id: from, to_id: to, edge_type: 'calls', dynamic: false } as any);
        }

        const policies = await discoverer.discoverPolicies();
        expect(policies).toEqual([]);
    });

    it('ignores non-dependency edge types (e.g. defines)', async () => {
        // 6 `defines` edges between properly tagged nodes — filtered out at the
        // edge_type gate, so no counts accumulate at all.
        for (let i = 0; i < 6; i++) {
            const from = makeNode(nodeRepo, { qualified_name: `from${i}.ts#Util`, tags: ['role:utility'] });
            const to = makeNode(nodeRepo, { qualified_name: `to${i}.ts#Svc`, tags: ['role:service'] });
            edgeRepo.createEdge({ from_id: from, to_id: to, edge_type: 'defines', dynamic: false } as any);
        }

        const policies = await discoverer.discoverPolicies();
        expect(policies).toEqual([]);
    });

    it('skips edges whose endpoint node has no tags', async () => {
        // Source tagged role:utility, target with NO tags => skipped (line 39).
        // It is the only edge, so nothing is counted.
        for (let i = 0; i < 6; i++) {
            const from = makeNode(nodeRepo, { qualified_name: `from${i}.ts#Util`, tags: ['role:utility'] });
            const to = makeNode(nodeRepo, { qualified_name: `to${i}.ts#Untagged` }); // tags undefined
            edgeRepo.createEdge({ from_id: from, to_id: to, edge_type: 'calls', dynamic: false } as any);
        }

        const policies = await discoverer.discoverPolicies();
        expect(policies).toEqual([]);
    });

    it('does not count an untagged-endpoint edge toward an otherwise-qualifying pattern', async () => {
        // 5 qualifying util->service edges (prob 1.0) PLUS one util->untagged edge.
        // The untagged edge is skipped (line 39): it must not perturb the
        // util->service counts, so the policy still emits with occurrence 5.
        for (let i = 0; i < 5; i++) {
            const from = makeNode(nodeRepo, { qualified_name: `from${i}.ts#Util`, tags: ['role:utility'] });
            const to = makeNode(nodeRepo, { qualified_name: `to${i}.ts#Svc`, tags: ['role:service'] });
            edgeRepo.createEdge({ from_id: from, to_id: to, edge_type: 'calls', dynamic: false } as any);
        }
        const fromX = makeNode(nodeRepo, { qualified_name: 'fromX.ts#Util', tags: ['role:utility'] });
        const toX = makeNode(nodeRepo, { qualified_name: 'toX.ts#Untagged' }); // tags undefined
        edgeRepo.createEdge({ from_id: fromX, to_id: toX, edge_type: 'calls', dynamic: false } as any);

        const policies = await discoverer.discoverPolicies();
        expect(policies).toHaveLength(1);
        expect(policies[0].fromTag).toBe('role:utility');
        expect(policies[0].toTag).toBe('role:service');
        // The untagged edge was skipped before tagCounts incremented, so
        // totalOut stays 5 and occurrence stays 5 (prob remains 1.0).
        expect(policies[0].occurrence).toBe(5);
        expect(policies[0].probability).toBe(1.0);
    });

    it('respects custom threshold/minCount and the strict default minCount', async () => {
        // Small qualifying setup: totalOut = 2, count = 2, prob = 1.0.
        for (let i = 0; i < 2; i++) {
            const from = makeNode(nodeRepo, { qualified_name: `from${i}.ts#Util`, tags: ['role:utility'] });
            const to = makeNode(nodeRepo, { qualified_name: `to${i}.ts#Svc`, tags: ['role:service'] });
            edgeRepo.createEdge({ from_id: from, to_id: to, edge_type: 'calls', dynamic: false } as any);
        }

        // Lenient args (threshold 0.5, minCount 2) => the pair qualifies.
        const lenient = await discoverer.discoverPolicies(0.5, 2);
        expect(lenient).toHaveLength(1);
        expect(lenient[0].fromTag).toBe('role:utility');
        expect(lenient[0].toTag).toBe('role:service');

        // Default args (minCount 5) => the same setup is rejected.
        const strict = await discoverer.discoverPolicies();
        expect(strict).toEqual([]);
    });
});
