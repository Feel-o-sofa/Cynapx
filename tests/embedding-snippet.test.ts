/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * Unit tests for EmbeddingManager.createSnippet() — verifies that code bodies
 * are read from disk and embedded into snippets (P9-1).
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EmbeddingManager, NullEmbeddingProvider } from '../src/indexer/embedding-manager';
import { CodeNode } from '../src/types';

function makeMockDb() {
    return {
        prepare: vi.fn().mockReturnValue({
            get: vi.fn().mockReturnValue(null),
            all: vi.fn().mockReturnValue([]),
            run: vi.fn(),
        }),
        exec: vi.fn(),
        transaction: vi.fn().mockImplementation((fn: () => void) => fn),
    } as any;
}

function makeMockNodeRepo() {
    return { getAllNodes: vi.fn().mockReturnValue([]) } as any;
}

function makeManager(): EmbeddingManager {
    return new EmbeddingManager(makeMockDb(), makeMockNodeRepo(), new NullEmbeddingProvider());
}

function baseNode(overrides: Partial<CodeNode>): CodeNode {
    return {
        qualified_name: 'pkg.foo',
        symbol_type: 'function',
        language: 'typescript',
        file_path: '/nonexistent/does-not-exist.ts',
        start_line: 1,
        end_line: 1,
        visibility: 'public' as any,
        is_generated: false,
        last_updated_commit: 'abc',
        version: 1,
        ...overrides,
    };
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-snippet-'));
const createdFiles: string[] = [];

function writeTmpFile(name: string, content: string): string {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, content, 'utf8');
    createdFiles.push(p);
    return p;
}

afterAll(() => {
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
});

describe('EmbeddingManager.createSnippet() — code body inclusion', () => {
    it('includes a Code: section when the file exists', () => {
        const filePath = writeTmpFile('exists.ts', [
            'export function add(a: number, b: number) {',
            '  return a + b;',
            '}',
        ].join('\n'));

        const node = baseNode({
            qualified_name: 'mod.add',
            symbol_type: 'function',
            signature: 'add(a: number, b: number): number',
            file_path: filePath,
            start_line: 1,
            end_line: 3,
        });

        const snippet = makeManager().createSnippet(node);

        expect(snippet).toContain('Code:');
        expect(snippet).toContain('return a + b;');
        // The extracted body should cover the requested line range.
        expect(snippet).toContain('export function add');
        expect(snippet).toContain('}');
    });

    it('preserves metadata sections (Symbol, Type, Signature, Context)', () => {
        const filePath = writeTmpFile('meta.ts', 'const x = 1;');
        const node = baseNode({
            qualified_name: 'mod.x',
            symbol_type: 'field',
            signature: 'const x: number',
            tags: ['constant', 'numeric'],
            file_path: filePath,
            start_line: 1,
            end_line: 1,
        });

        const snippet = makeManager().createSnippet(node);

        expect(snippet).toContain('Symbol: mod.x');
        expect(snippet).toContain('Type: field');
        expect(snippet).toContain('Signature: const x: number');
        expect(snippet).toContain('Context: constant, numeric');
        expect(snippet).toContain('Code:');
    });

    it.each(['file', 'module', 'package'] as const)(
        'skips Code: section for symbol_type "%s"',
        (symbolType) => {
            const filePath = writeTmpFile(`skip-${symbolType}.ts`, [
                'line one',
                'line two',
                'line three',
            ].join('\n'));

            const node = baseNode({
                qualified_name: `mod.${symbolType}`,
                symbol_type: symbolType,
                file_path: filePath,
                start_line: 1,
                end_line: 3,
            });

            const snippet = makeManager().createSnippet(node);

            expect(snippet).not.toContain('Code:');
            expect(snippet).toContain(`Type: ${symbolType}`);
        },
    );

    it('does not crash and omits Code: section when the file does not exist', () => {
        const node = baseNode({
            qualified_name: 'mod.missing',
            symbol_type: 'function',
            file_path: path.join(tmpDir, 'never-written.ts'),
            start_line: 1,
            end_line: 5,
        });

        const snippet = makeManager().createSnippet(node);

        expect(snippet).toContain('Symbol: mod.missing');
        expect(snippet).not.toContain('Code:');
    });

    it('truncates the code body at 1000 chars with a "..." suffix', () => {
        // A single long line well over 1000 characters.
        const longLine = 'a'.repeat(5000);
        const filePath = writeTmpFile('long.ts', longLine);

        const node = baseNode({
            qualified_name: 'mod.long',
            symbol_type: 'function',
            file_path: filePath,
            start_line: 1,
            end_line: 1,
        });

        const snippet = makeManager().createSnippet(node);

        expect(snippet).toContain('Code:');
        expect(snippet).toContain('...');
        // Body portion = exactly 1000 'a' chars followed by the ellipsis.
        expect(snippet).toContain('a'.repeat(1000) + '...');
        // Must not contain the full untruncated 5000-char run.
        expect(snippet).not.toContain('a'.repeat(1001) + '\n');
    });
});
