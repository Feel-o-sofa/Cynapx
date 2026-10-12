/**
 * WP-3 call resolution: members are qualified by their owning type, calls
 * through `self`/`this` or a Go receiver resolve to the caller's own type, and
 * cross-file calls resolve through the caller's imports. An ambiguous name
 * with nothing in scope stays unresolved rather than guessing.
 * End-to-end precision/recall is measured by tests/goldset.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { TreeSitterParser } from '../src/indexer/tree-sitter-parser';
import { DatabaseManager } from '../src/db/database';
import { NodeRepository } from '../src/db/node-repository';
import { EdgeRepository } from '../src/db/edge-repository';
import { UpdatePipeline } from '../src/indexer/update-pipeline';
import { createDefaultParser } from '../src/indexer/default-parser';
import { toCanonical } from '../src/utils/paths';

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-calls-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(rel: string, src: string): string {
    const file = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, src);
    return file;
}

/** Indexes the files and returns call edges as "caller -> callee" member paths. */
async function indexCalls(files: string[]): Promise<string[]> {
    const manager = new DatabaseManager(':memory:');
    const db = manager.getDb();
    try {
        const pipeline = new UpdatePipeline(db, new NodeRepository(db), new EdgeRepository(db), createDefaultParser());
        (pipeline as any).embeddingManager = { refreshAll: async () => {}, isAvailable: false };
        await pipeline.processBatch(files.map(file_path => ({ event: 'ADD' as const, file_path, commit: 'c' })), 1);
        const prefix = toCanonical(tmpDir) + '/';
        const strip = (q: string) => q.startsWith(prefix) ? q.slice(prefix.length) : q;
        return (db.prepare(`
            SELECT f.qualified_name AS f, t.qualified_name AS t FROM edges e
            JOIN nodes f ON f.id = e.from_id JOIN nodes t ON t.id = e.to_id
            WHERE e.edge_type = 'calls'`).all() as { f: string; t: string }[])
            .map(r => `${strip(r.f)} -> ${strip(r.t)}`).sort();
    } finally {
        manager.close?.();
    }
}

describe('owner-qualified qualified names', () => {
    it('keeps a method and a same-named free function apart (Python)', async () => {
        const file = write('client.py', `def configure():
    return 1

class Client:
    def configure(self):
        return configure()

    def run(self):
        return self.configure()
`);
        const { nodes, edges } = await new TreeSitterParser().parse(file, 'c', 1);
        const qnames = nodes.map(n => n.qualified_name.split('#')[1]).filter(Boolean);
        expect(qnames).toEqual(expect.arrayContaining(['configure', 'client', 'client.configure', 'client.run']));

        const calls = edges.filter(e => e.edge_type === 'calls').map(e => `${e.from_qname.split('#')[1]} -> ${e.to_qname.split('#')[1]}`);
        // Python has no implicit self: a bare call inside a method is the free function.
        expect(calls).toContain('client.configure -> configure');
        expect(calls).toContain('client.run -> client.configure');
    });

    it('qualifies a Go method by its receiver type and resolves calls through the receiver', async () => {
        const file = write('client.go', `package client

func Configure() string { return "free" }

type Client struct{}

func (cl *Client) Configure() string { return Configure() }

func (cl *Client) Run() string { return cl.Configure() }
`);
        const { edges } = await new TreeSitterParser().parse(file, 'c', 1);
        const calls = edges.filter(e => e.edge_type === 'calls').map(e => `${e.from_qname.split('#')[1]} -> ${e.to_qname.split('#')[1]}`);
        expect(calls).toContain('client.configure -> configure');
        expect(calls).toContain('client.run -> client.configure');
    });

    it('resolves a bare Java call to a member of the enclosing class', async () => {
        const file = write('Runner.java', `class Runner {
    static void configure() {}
    void run() { configure(); }
}
`);
        const { edges } = await new TreeSitterParser().parse(file, 'c', 1);
        const call = edges.find(e => e.edge_type === 'calls' && e.from_qname.endsWith('#runner.run'));
        expect(call?.to_qname).toMatch(/#runner\.configure$/);
        expect(call?.dynamic).toBe(false);
    });
});

describe('cross-file call resolution', () => {
    it('resolves a module-qualified call through the caller\'s imports (Rust)', async () => {
        const util = write('src/util.rs', 'pub fn log(m: &str) {}\n');
        const other = write('src/other.rs', 'pub fn log(m: &str) {}\n');
        const main = write('src/main.rs', 'mod util;\nmod other;\n\nfn run() {\n    util::log("x");\n}\n');
        expect(await indexCalls([util, other, main])).toEqual(['src/main.rs#run -> src/util.rs#log']);
    });

    it('resolves a type-qualified call to that type\'s member (Java)', async () => {
        const util = write('Util.java', 'class Util {\n    static void log(String m) {}\n}\n');
        const logger = write('Logger.java', 'class Logger {\n    void log(String m) {}\n}\n');
        const main = write('Main.java', 'class Main {\n    void run() { Util.log("x"); }\n}\n');
        expect(await indexCalls([util, logger, main])).toEqual(['main.java#main.run -> util.java#util.log']);
    });

    it('resolves a call through a typed parameter to that type\'s method, not a same-named module function (Go)', async () => {
        write('go.mod', 'module example.com/m\n');
        const client = write('client/client.go', 'package client\n\nfunc Configure() {}\n\ntype Client struct{}\n\nfunc (c *Client) Configure() {}\n');
        const main = write('main.go', 'package main\n\nimport "example.com/m/client"\n\nfunc Use(c *client.Client) {\n    c.Configure()\n}\n');
        expect(await indexCalls([client, main])).toEqual(['main.go#use -> client/client.go#client.configure']);
    });

    it('resolves a call through a typed parameter (Python, Rust)', async () => {
        const py = write('py/client.py', 'class Client:\n    def configure(self):\n        pass\n');
        const pyMain = write('py/main.py', 'from .client import Client\n\ndef use(c: Client):\n    c.configure()\n');
        const rs = write('rs/client.rs', 'pub struct Client;\n\nimpl Client {\n    pub fn configure(&self) {}\n}\n');
        const rsMain = write('rs/main.rs', 'mod client;\nuse client::Client;\n\nfn use_it(c: &mut Client) {\n    c.configure();\n}\n');
        expect(await indexCalls([py, pyMain, rs, rsMain])).toEqual([
            'py/main.py#use -> py/client.py#client.configure',
            'rs/main.rs#use_it -> rs/client.rs#client.configure',
        ]);
    });

    it('leaves an ambiguous bare name with nothing in scope unresolved', async () => {
        const a = write('a/helpers.py', 'def helper():\n    pass\n');
        const b = write('b/helpers.py', 'def helper():\n    pass\n');
        const c = write('c/main.py', 'def run():\n    helper()\n');
        expect(await indexCalls([a, b, c])).toEqual([]);
    });

    it('does not resolve a call through a variable of unknown type', async () => {
        const util = write('util.py', 'class Logger:\n    def log(self):\n        pass\n\ndef log():\n    pass\n');
        const main = write('main.py', 'from .util import log\n\ndef run(logger):\n    logger.log()\n');
        expect(await indexCalls([util, main])).toEqual([]);
    });
});
