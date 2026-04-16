/**
 * Unit tests for metadata parsers: YamlParser, MarkdownParser, JsonConfigParser.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { YamlParser } from '../src/indexer/yaml-parser';
import { MarkdownParser } from '../src/indexer/markdown-parser';
import { JsonConfigParser } from '../src/indexer/json-config-parser';

const COMMIT = 'abc1234';
const VERSION = 1;

function writeTmp(ext: string, content: string): string {
    const tmpFile = path.join(os.tmpdir(), `cynapx-test-${Date.now()}${ext}`);
    fs.writeFileSync(tmpFile, content, 'utf8');
    return tmpFile;
}

// ---------------------------------------------------------------------------
// YamlParser
// ---------------------------------------------------------------------------
describe('YamlParser', () => {
    const parser = new YamlParser();

    it('supports .yml files', () => {
        expect(parser.supports('workflow.yml')).toBe(true);
    });

    it('supports .yaml files', () => {
        expect(parser.supports('config.yaml')).toBe(true);
    });

    it('does not support .ts files', () => {
        expect(parser.supports('index.ts')).toBe(false);
    });

    it('parses a simple YAML — file node and config_key nodes', async () => {
        const content = `name: my-workflow\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n`;
        const tmpFile = writeTmp('.yml', content);
        try {
            const delta = await parser.parse(tmpFile, COMMIT, VERSION);
            const types = delta.nodes.map(n => n.symbol_type);
            expect(types).toContain('file');
            expect(types).toContain('config_key');

            const fileNode = delta.nodes.find(n => n.symbol_type === 'file');
            expect(fileNode?.language).toBe('yaml');

            const configKeys = delta.nodes.filter(n => n.symbol_type === 'config_key');
            const keyNames = configKeys.map(n => n.qualified_name.split('#')[1]);
            expect(keyNames).toContain('name');
            expect(keyNames).toContain('on');
            expect(keyNames).toContain('jobs');
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it('extracts GitHub Actions job names as function nodes', async () => {
        const content = `name: ci\njobs:\n  build:\n    runs-on: ubuntu-latest\n  test:\n    runs-on: ubuntu-latest\n`;
        const tmpFile = writeTmp('.yml', content);
        try {
            const delta = await parser.parse(tmpFile, COMMIT, VERSION);
            const funcNodes = delta.nodes.filter(n => n.symbol_type === 'function');
            const funcNames = funcNodes.map(n => n.qualified_name.split('#')[1]);
            expect(funcNames).toContain('job:build');
            expect(funcNames).toContain('job:test');
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it('emits contains edges from file to top-level keys', async () => {
        const content = `name: test\nversion: 1\n`;
        const tmpFile = writeTmp('.yml', content);
        try {
            const delta = await parser.parse(tmpFile, COMMIT, VERSION);
            expect(delta.edges.length).toBeGreaterThan(0);
            expect(delta.edges.every(e => e.edge_type === 'contains')).toBe(true);
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });
});

// ---------------------------------------------------------------------------
// MarkdownParser
// ---------------------------------------------------------------------------
describe('MarkdownParser', () => {
    const parser = new MarkdownParser();

    it('supports .md files', () => {
        expect(parser.supports('README.md')).toBe(true);
    });

    it('supports .mdx files', () => {
        expect(parser.supports('page.mdx')).toBe(true);
    });

    it('does not support .ts files', () => {
        expect(parser.supports('index.ts')).toBe(false);
    });

    it('parses H1 and H2 headers as section nodes', async () => {
        const content = `# Getting Started\n\nSome text.\n\n## Installation\n\nMore text.\n\n## Usage\n\nEven more.\n`;
        const tmpFile = writeTmp('.md', content);
        try {
            const delta = await parser.parse(tmpFile, COMMIT, VERSION);
            const sections = delta.nodes.filter(n => n.symbol_type === 'section');
            expect(sections.length).toBe(3); // H1 + 2 H2

            const slugs = sections.map(n => n.qualified_name.split('#')[1]);
            expect(slugs).toContain('getting-started');
            expect(slugs).toContain('installation');
            expect(slugs).toContain('usage');
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it('produces a file node with language markdown', async () => {
        const content = `# Title\n`;
        const tmpFile = writeTmp('.md', content);
        try {
            const delta = await parser.parse(tmpFile, COMMIT, VERSION);
            const fileNode = delta.nodes.find(n => n.symbol_type === 'file');
            expect(fileNode).toBeDefined();
            expect(fileNode?.language).toBe('markdown');
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it('ignores H3+ headers', async () => {
        const content = `# H1\n## H2\n### H3\n#### H4\n`;
        const tmpFile = writeTmp('.md', content);
        try {
            const delta = await parser.parse(tmpFile, COMMIT, VERSION);
            const sections = delta.nodes.filter(n => n.symbol_type === 'section');
            expect(sections.length).toBe(2); // Only H1 and H2
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });
});

// ---------------------------------------------------------------------------
// JsonConfigParser
// ---------------------------------------------------------------------------
describe('JsonConfigParser', () => {
    const parser = new JsonConfigParser();

    it('supports tsconfig.json', () => {
        expect(parser.supports('tsconfig.json')).toBe(true);
    });

    it('supports .eslintrc.json', () => {
        expect(parser.supports('.eslintrc.json')).toBe(true);
    });

    it('supports .jsonc files', () => {
        expect(parser.supports('settings.jsonc')).toBe(true);
    });

    it('does not support package.json (handled by DependencyParser)', () => {
        expect(parser.supports('package.json')).toBe(false);
    });

    it('does not support package-lock.json', () => {
        expect(parser.supports('package-lock.json')).toBe(false);
    });

    it('parses a simple JSON config — file node and config_key nodes', async () => {
        const content = JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] }, null, 2);
        const tmpFile = writeTmp('.json', content);
        try {
            const delta = await parser.parse(tmpFile, COMMIT, VERSION);
            const fileNode = delta.nodes.find(n => n.symbol_type === 'file');
            expect(fileNode).toBeDefined();
            expect(fileNode?.language).toBe('json');

            const configKeys = delta.nodes.filter(n => n.symbol_type === 'config_key');
            const keyNames = configKeys.map(n => n.qualified_name.split('#')[1]);
            expect(keyNames).toContain('compilerOptions');
            expect(keyNames).toContain('include');
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it('handles malformed JSON gracefully — returns file node only', async () => {
        const content = `{ invalid json `;
        const tmpFile = writeTmp('.json', content);
        try {
            const delta = await parser.parse(tmpFile, COMMIT, VERSION);
            expect(delta.nodes.length).toBe(1);
            expect(delta.nodes[0].symbol_type).toBe('file');
            expect(delta.edges.length).toBe(0);
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it('strips JSONC comments before parsing', async () => {
        const content = `{\n  // This is a comment\n  "extends": "./base.json"\n}`;
        const tmpFile = writeTmp('.jsonc', content);
        try {
            const delta = await parser.parse(tmpFile, COMMIT, VERSION);
            const configKeys = delta.nodes.filter(n => n.symbol_type === 'config_key');
            expect(configKeys.length).toBe(1);
            expect(configKeys[0].qualified_name).toContain('extends');
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });
});
