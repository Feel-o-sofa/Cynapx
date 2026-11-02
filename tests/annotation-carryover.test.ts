/**
 * purge_index deletes the project's database file. Annotations live in that
 * file but are agent memory, not index data, so a purge sets them aside and
 * the next database at that path takes them back.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseManager } from '../src/db/database';
import { annotationCarryoverPath } from '../src/db/annotation-carryover';
import { executeTool, ToolDeps } from '../src/server/tool-dispatcher';
import { getDatabasePath } from '../src/utils/paths';

let home: string;
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-carry-'));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
});

afterEach(() => {
    process.env.HOME = saved.HOME;
    process.env.USERPROFILE = saved.USERPROFILE;
    fs.rmSync(home, { recursive: true, force: true });
});

function annotate(manager: DatabaseManager, qname: string, body: string): void {
    manager.getDb().prepare("INSERT INTO annotations (node_qname, kind, body, author) VALUES (?, 'decision', ?, 'agent')").run(qname, body);
}

const bodies = (manager: DatabaseManager) =>
    (manager.getDb().prepare('SELECT body FROM annotations ORDER BY id').all() as { body: string }[]).map(r => r.body);

async function purge(args: Record<string, unknown>): Promise<{ text: string; dbPath: string }> {
    const projectPath = path.join(home, 'proj');
    fs.mkdirSync(projectPath, { recursive: true });
    const dbPath = getDatabasePath(projectPath);
    const ctx: any = { projectPath, projectHash: 'h', dbManager: new DatabaseManager(dbPath) };
    annotate(ctx.dbManager, '/proj/a.py#run', 'keep the retry loop: the API drops 1% of calls');
    const deps = {
        waitUntilReady: async () => {},
        isTerminal: () => false,
        getTerminalCoordinator: () => undefined,
        getContext: () => ctx,
        setIsInitialized: vi.fn(),
        onPurge: async () => { ctx.dbManager.dispose(); ctx.dbManager = undefined; },
    } as unknown as ToolDeps;
    const result = await executeTool('purge_index', { confirm: true, ...args }, deps);
    return { text: result.content[0].text, dbPath };
}

describe('annotations across purge_index', () => {
    it('keeps annotations and restores them when the database is created again', async () => {
        const { text, dbPath } = await purge({});
        expect(text).toMatch(/1 annotation\(s\) were kept/);
        expect(fs.existsSync(dbPath)).toBe(false);
        expect(fs.existsSync(annotationCarryoverPath(dbPath))).toBe(true);

        const reopened = new DatabaseManager(dbPath);
        try {
            expect(bodies(reopened)).toEqual(['keep the retry loop: the API drops 1% of calls']);
            expect(fs.existsSync(annotationCarryoverPath(dbPath))).toBe(false);
        } finally {
            reopened.dispose();
        }
    });

    it('deletes them when asked', async () => {
        const { text, dbPath } = await purge({ keep_annotations: false });
        expect(text).toMatch(/Annotations were deleted/);
        expect(fs.existsSync(annotationCarryoverPath(dbPath))).toBe(false);
    });

    it('deletes them by default when the project is unregistered', async () => {
        const { dbPath } = await purge({ unregister: true });
        expect(fs.existsSync(annotationCarryoverPath(dbPath))).toBe(false);
    });

    it('leaves an unreadable set-aside file in place rather than losing it', () => {
        const dbPath = path.join(home, 'x.db');
        fs.writeFileSync(annotationCarryoverPath(dbPath), '{not json');
        const manager = new DatabaseManager(dbPath);
        try {
            expect(bodies(manager)).toEqual([]);
            expect(fs.existsSync(annotationCarryoverPath(dbPath))).toBe(true);
        } finally {
            manager.dispose();
        }
    });
});
