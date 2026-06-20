/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Phase 12-7 (A-4): reTagAllNodes() dirty-set worklist rewrite.
 *
 * - Full retag still produces correct tags (incl. multi-hop inheritance
 *   propagation) on a small fixture graph.
 * - Only the affected subgraph is reprocessed: mergeRoles() runs only for
 *   nodes with propagation parents, and replaceTags() is only invoked for
 *   nodes whose tags actually changed (dirty set), not for every node.
 * - node_tags mirror stays in sync after the worklist run (M2 invariant).
 * - Inheritance cycles terminate (safety bound / monotone merge).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { NodeRepository } from '../src/db/node-repository';
import { EdgeRepository } from '../src/db/edge-repository';
import { UpdatePipeline } from '../src/indexer/update-pipeline';
import { StructuralTagger } from '../src/indexer/structural-tagger';
import { CodeNode } from '../src/types';

function createInMemoryDb(): { db: Database.Database; nodeRepo: NodeRepository; edgeRepo: EdgeRepository } {
    const db = new Database(':memory:');
    const schemaPath = path.resolve(__dirname, '../schema/schema.sql');
    const fullSchema = fs.readFileSync(schemaPath, 'utf8');
    const filteredSchema = fullSchema
        .split(';')
        .filter(stmt => !stmt.includes('vec0'))
        .join(';');
    db.exec(filteredSchema);
    return { db, nodeRepo: new NodeRepository(db), edgeRepo: new EdgeRepository(db) };
}

function makeNode(nodeRepo: NodeRepository, overrides: Partial<CodeNode> & { qualified_name: string }): number {
    return nodeRepo.createNode({
        symbol_type: 'class',
        language: 'typescript',
        file_path: 'test.ts',
        start_line: 1,
        end_line: 10,
        visibility: 'public',
        is_generated: false,
        last_updated_commit: 'abc',
        version: 1,
        fan_in: 0,
        fan_out: 0,
        ...overrides,
    } as CodeNode);
}

function inherit(edgeRepo: EdgeRepository, childId: number, parentId: number): void {
    edgeRepo.createEdge({ from_id: childId, to_id: parentId, edge_type: 'inherits', dynamic: false });
}

function tagsOf(db: Database.Database, id: number): string[] {
    const row = db.prepare('SELECT tags FROM nodes WHERE id = ?').get(id) as { tags: string };
    return (JSON.parse(row.tags) as string[]).sort();
}

function mirrorTagsOf(db: Database.Database, id: number): string[] {
    const rows = db.prepare('SELECT tag FROM node_tags WHERE node_id = ? ORDER BY tag').all(id) as { tag: string }[];
    return rows.map(r => r.tag);
}

describe('Phase 12-7 A-4: reTagAllNodes() dirty-set worklist', () => {
    let db: Database.Database;
    let nodeRepo: NodeRepository;
    let edgeRepo: EdgeRepository;
    let pipeline: UpdatePipeline;

    beforeEach(() => {
        ({ db, nodeRepo, edgeRepo } = createInMemoryDb());
        pipeline = new UpdatePipeline(db, nodeRepo, edgeRepo, {} as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        db.close();
    });

    it('full retag computes baseline tags and propagates roles across multi-hop inheritance', async () => {
        // BaseRepository (role:repository) ← UserService (role:service) ← AdminController (role:controller)
        const repoId = makeNode(nodeRepo, { qualified_name: 'src/db/base.ts#BaseRepository', file_path: 'src/db/base.ts' });
        const svcId = makeNode(nodeRepo, { qualified_name: 'src/server/user.ts#UserService', file_path: 'src/server/user.ts' });
        const ctrlId = makeNode(nodeRepo, { qualified_name: 'src/server/admin.ts#AdminController', file_path: 'src/server/admin.ts' });
        inherit(edgeRepo, svcId, repoId);
        inherit(edgeRepo, ctrlId, svcId);

        await pipeline.reTagAllNodes();

        // Baseline structural tags
        expect(tagsOf(db, repoId)).toContain('role:repository');
        expect(tagsOf(db, repoId)).toContain('layer:data');
        // 1-hop propagation: service inherits repository role
        expect(tagsOf(db, svcId)).toEqual(expect.arrayContaining(['role:service', 'role:repository']));
        // 2-hop propagation through the worklist: controller gains service AND repository roles
        expect(tagsOf(db, ctrlId)).toEqual(
            expect.arrayContaining(['role:controller', 'role:service', 'role:repository'])
        );
    });

    it('is idempotent: a second run at the fixed point performs zero replaceTags() writes', async () => {
        const repoId = makeNode(nodeRepo, { qualified_name: 'src/db/base.ts#BaseRepository', file_path: 'src/db/base.ts' });
        const svcId = makeNode(nodeRepo, { qualified_name: 'src/server/user.ts#UserService', file_path: 'src/server/user.ts' });
        inherit(edgeRepo, svcId, repoId);
        for (let i = 0; i < 10; i++) {
            makeNode(nodeRepo, { qualified_name: `src/misc/standalone${i}.ts#Standalone${i}`, file_path: `src/misc/standalone${i}.ts` });
        }

        await pipeline.reTagAllNodes(); // reach fixed point

        const spy = vi.spyOn(nodeRepo, 'replaceTags');
        await pipeline.reTagAllNodes();
        expect(spy).not.toHaveBeenCalled();
    });

    it('only reprocesses the affected subgraph: replaceTags() touches dirty nodes only', async () => {
        const repoId = makeNode(nodeRepo, { qualified_name: 'src/db/base.ts#BaseRepository', file_path: 'src/db/base.ts' });
        const svcId = makeNode(nodeRepo, { qualified_name: 'src/server/user.ts#UserService', file_path: 'src/server/user.ts' });
        inherit(edgeRepo, svcId, repoId);
        const standaloneIds: number[] = [];
        for (let i = 0; i < 10; i++) {
            standaloneIds.push(makeNode(nodeRepo, { qualified_name: `src/misc/standalone${i}.ts#Standalone${i}`, file_path: `src/misc/standalone${i}.ts` }));
        }

        await pipeline.reTagAllNodes(); // fixed point: stored tags == computed tags everywhere

        // Simulate a tag-affecting change on ONE node (stale stored tags).
        db.prepare('UPDATE nodes SET tags = ? WHERE id = ?').run('[]', svcId);
        db.prepare('DELETE FROM node_tags WHERE node_id = ?').run(svcId);

        const spy = vi.spyOn(nodeRepo, 'replaceTags');
        await pipeline.reTagAllNodes();

        // Only the dirty node is rewritten — none of the 11 clean nodes.
        const touchedIds = spy.mock.calls.map(c => c[0]);
        expect(touchedIds).toEqual([svcId]);
        for (const id of standaloneIds) {
            expect(touchedIds).not.toContain(id);
        }
    });

    it('worklist merge work is proportional to the propagation subgraph, not the whole node set', async () => {
        // 20 standalone nodes (no propagation edges) + one 3-node chain.
        for (let i = 0; i < 20; i++) {
            makeNode(nodeRepo, { qualified_name: `src/misc/standalone${i}.ts#Standalone${i}`, file_path: `src/misc/standalone${i}.ts` });
        }
        const repoId = makeNode(nodeRepo, { qualified_name: 'src/db/base.ts#BaseRepository', file_path: 'src/db/base.ts' });
        const svcId = makeNode(nodeRepo, { qualified_name: 'src/server/user.ts#UserService', file_path: 'src/server/user.ts' });
        const ctrlId = makeNode(nodeRepo, { qualified_name: 'src/server/admin.ts#AdminController', file_path: 'src/server/admin.ts' });
        inherit(edgeRepo, svcId, repoId);
        inherit(edgeRepo, ctrlId, svcId);

        const mergeSpy = vi.spyOn(StructuralTagger, 'mergeRoles');
        await pipeline.reTagAllNodes();

        // Only nodes WITH parents enter the worklist: svc + ctrl (1 parent each),
        // plus one re-enqueue of ctrl after svc's tags change. The old algorithm
        // would have run up to 5 passes over all 23 nodes.
        expect(mergeSpy.mock.calls.length).toBeGreaterThan(0);
        expect(mergeSpy.mock.calls.length).toBeLessThanOrEqual(6);
    });

    it('keeps the node_tags mirror in sync for every node after the worklist run (M2 invariant)', async () => {
        const repoId = makeNode(nodeRepo, { qualified_name: 'src/db/base.ts#BaseRepository', file_path: 'src/db/base.ts' });
        const svcId = makeNode(nodeRepo, { qualified_name: 'src/server/user.ts#UserService', file_path: 'src/server/user.ts' });
        const ctrlId = makeNode(nodeRepo, { qualified_name: 'src/server/admin.ts#AdminController', file_path: 'src/server/admin.ts' });
        inherit(edgeRepo, svcId, repoId);
        inherit(edgeRepo, ctrlId, svcId);
        makeNode(nodeRepo, { qualified_name: 'src/misc/standalone.ts#Standalone', file_path: 'src/misc/standalone.ts' });

        await pipeline.reTagAllNodes();

        const allIds = (db.prepare('SELECT id FROM nodes').all() as { id: number }[]).map(r => r.id);
        for (const id of allIds) {
            expect(mirrorTagsOf(db, id)).toEqual(tagsOf(db, id));
        }
    });

    it('terminates on inheritance cycles and merges roles in both directions', async () => {
        const aId = makeNode(nodeRepo, { qualified_name: 'src/db/a.ts#ARepository', file_path: 'src/db/a.ts' });
        const bId = makeNode(nodeRepo, { qualified_name: 'src/server/b.ts#BService', file_path: 'src/server/b.ts' });
        inherit(edgeRepo, aId, bId);
        inherit(edgeRepo, bId, aId);

        await pipeline.reTagAllNodes(); // must not hang

        expect(tagsOf(db, aId)).toEqual(expect.arrayContaining(['role:repository', 'role:service']));
        expect(tagsOf(db, bId)).toEqual(expect.arrayContaining(['role:repository', 'role:service']));
    });

    it('EdgeRepository.getEdgesByTypes() returns only the requested edge types', () => {
        const aId = makeNode(nodeRepo, { qualified_name: 'a.ts#A', file_path: 'a.ts' });
        const bId = makeNode(nodeRepo, { qualified_name: 'b.ts#B', file_path: 'b.ts' });
        edgeRepo.createEdge({ from_id: aId, to_id: bId, edge_type: 'inherits', dynamic: false });
        edgeRepo.createEdge({ from_id: aId, to_id: bId, edge_type: 'implements', dynamic: false });
        edgeRepo.createEdge({ from_id: aId, to_id: bId, edge_type: 'calls', dynamic: false });

        const edges = edgeRepo.getEdgesByTypes(['inherits', 'implements']);
        expect(edges).toHaveLength(2);
        expect(edges.map(e => e.edge_type).sort()).toEqual(['implements', 'inherits']);
        expect(edgeRepo.getEdgesByTypes([])).toEqual([]);
    });
});
