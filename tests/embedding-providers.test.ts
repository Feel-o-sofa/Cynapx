/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * P9-0/P9-5: Tests for the pluggable embedding provider registry
 * (createEmbeddingProvider / createEmbeddingProviderFromEnv, OpenAI + Ollama
 * providers), the toStructuredResult() helper backing rich search output, and
 * ProjectProfile round-trip with embedding config.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

import {
    createEmbeddingProvider,
    createEmbeddingProviderFromEnv,
    OpenAIEmbeddingProvider,
    OllamaEmbeddingProvider,
} from '../src/indexer/embedding-providers/index';
import { PythonEmbeddingProvider, NullEmbeddingProvider } from '../src/indexer/embedding-manager';
import { toStructuredResult } from '../src/server/tools/_utils';
import { loadProfile, saveProfile, ProjectProfile } from '../src/utils/profile';

// ---------------------------------------------------------------------------
// createEmbeddingProvider — factory dispatch
// ---------------------------------------------------------------------------

describe('createEmbeddingProvider', () => {
    it('returns PythonEmbeddingProvider for undefined config', () => {
        const p = createEmbeddingProvider();
        expect(p).toBeInstanceOf(PythonEmbeddingProvider);
        p.dispose?.();
    });

    it('returns PythonEmbeddingProvider for jina-sidecar config', () => {
        const p = createEmbeddingProvider({ provider: 'jina-sidecar' });
        expect(p).toBeInstanceOf(PythonEmbeddingProvider);
        p.dispose?.();
    });

    it('returns NullEmbeddingProvider for null config', () => {
        const p = createEmbeddingProvider({ provider: 'null' });
        expect(p).toBeInstanceOf(NullEmbeddingProvider);
    });

    it('returns OpenAIEmbeddingProvider for openai config', () => {
        const p = createEmbeddingProvider({ provider: 'openai' });
        expect(p).toBeInstanceOf(OpenAIEmbeddingProvider);
    });

    it('returns OllamaEmbeddingProvider for ollama config', () => {
        const p = createEmbeddingProvider({ provider: 'ollama' });
        expect(p).toBeInstanceOf(OllamaEmbeddingProvider);
    });
});

// ---------------------------------------------------------------------------
// OpenAIEmbeddingProvider — defaults + custom config
// ---------------------------------------------------------------------------

describe('OpenAIEmbeddingProvider', () => {
    it('constructs with correct defaults', () => {
        const p = new OpenAIEmbeddingProvider({ provider: 'openai' });
        expect(p.getDimensions()).toBe(1536);
        expect(p.getModelName()).toBe('openai/text-embedding-3-small');
    });

    it('uses custom endpoint, model, and dimensions when provided', () => {
        const p = new OpenAIEmbeddingProvider({
            provider: 'openai',
            endpoint: 'https://gateway.example.com',
            model: 'my-embed-model',
            dimensions: 3072,
        });
        expect(p.getDimensions()).toBe(3072);
        expect(p.getModelName()).toBe('openai/my-embed-model');
    });

    it('generateBatch posts to {endpoint}/v1/embeddings and sorts by index', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                data: [
                    { index: 1, embedding: [4, 5, 6] },
                    { index: 0, embedding: [1, 2, 3] },
                ],
            }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const p = new OpenAIEmbeddingProvider({
            provider: 'openai',
            endpoint: 'https://gw.test',
            apiKey: 'sk-test',
        });
        const result = await p.generateBatch(['a', 'b']);
        expect(result).toEqual([[1, 2, 3], [4, 5, 6]]);
        expect(fetchMock).toHaveBeenCalledWith(
            'https://gw.test/v1/embeddings',
            expect.objectContaining({ method: 'POST' }),
        );
        vi.unstubAllGlobals();
    });

    it('throws on non-ok response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' }));
        const p = new OpenAIEmbeddingProvider({ provider: 'openai' });
        await expect(p.generate('x')).rejects.toThrow(/401/);
        vi.unstubAllGlobals();
    });
});

// ---------------------------------------------------------------------------
// OllamaEmbeddingProvider — defaults + custom config
// ---------------------------------------------------------------------------

describe('OllamaEmbeddingProvider', () => {
    it('constructs with correct defaults', () => {
        const p = new OllamaEmbeddingProvider({ provider: 'ollama' });
        expect(p.getDimensions()).toBe(768);
        expect(p.getModelName()).toBe('ollama/nomic-embed-text');
    });

    it('uses custom endpoint, model, and dimensions when provided', () => {
        const p = new OllamaEmbeddingProvider({
            provider: 'ollama',
            endpoint: 'http://gpu-box:11434',
            model: 'mxbai-embed-large',
            dimensions: 1024,
        });
        expect(p.getDimensions()).toBe(1024);
        expect(p.getModelName()).toBe('ollama/mxbai-embed-large');
    });

    it('generate posts to {endpoint}/api/embed and returns first embedding', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ embeddings: [[7, 8, 9]] }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const p = new OllamaEmbeddingProvider({ provider: 'ollama', endpoint: 'http://ollama.test' });
        const result = await p.generate('hello');
        expect(result).toEqual([7, 8, 9]);
        expect(fetchMock).toHaveBeenCalledWith(
            'http://ollama.test/api/embed',
            expect.objectContaining({ method: 'POST' }),
        );
        vi.unstubAllGlobals();
    });
});

// ---------------------------------------------------------------------------
// createEmbeddingProviderFromEnv — env-var driven selection
// ---------------------------------------------------------------------------

describe('createEmbeddingProviderFromEnv', () => {
    const ENV_KEYS = [
        'CYNAPX_EMBED_PROVIDER',
        'CYNAPX_EMBED_MODEL',
        'CYNAPX_EMBED_API_KEY',
        'CYNAPX_EMBED_ENDPOINT',
        'CYNAPX_EMBED_DIMENSIONS',
    ];
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    });
    afterEach(() => {
        for (const k of ENV_KEYS) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k]!;
        }
    });

    it('returns PythonEmbeddingProvider when CYNAPX_EMBED_PROVIDER is unset', () => {
        const p = createEmbeddingProviderFromEnv();
        expect(p).toBeInstanceOf(PythonEmbeddingProvider);
        p.dispose?.();
    });

    it('reads openai env vars correctly', () => {
        process.env.CYNAPX_EMBED_PROVIDER = 'openai';
        process.env.CYNAPX_EMBED_MODEL = 'text-embedding-3-large';
        process.env.CYNAPX_EMBED_DIMENSIONS = '3072';
        const p = createEmbeddingProviderFromEnv();
        expect(p).toBeInstanceOf(OpenAIEmbeddingProvider);
        expect(p.getModelName()).toBe('openai/text-embedding-3-large');
        expect(p.getDimensions()).toBe(3072);
    });

    it('returns OllamaEmbeddingProvider when CYNAPX_EMBED_PROVIDER=ollama', () => {
        process.env.CYNAPX_EMBED_PROVIDER = 'ollama';
        const p = createEmbeddingProviderFromEnv();
        expect(p).toBeInstanceOf(OllamaEmbeddingProvider);
    });
});

// ---------------------------------------------------------------------------
// toStructuredResult — P9-5 rich search output
// ---------------------------------------------------------------------------

describe('toStructuredResult', () => {
    it('returns full structured output', () => {
        const node = {
            qualified_name: 'pkg.mod#Foo.bar',
            symbol_type: 'method',
            file_path: 'src/mod.ts',
            signature: 'bar(x: number): string',
            docstring: 'Computes the bar.',
            tags: ['public', 'hot'],
            fan_in: 12,
        };
        const r = toStructuredResult(node, { score: 0.87 });
        expect(r).toEqual({
            qname: 'pkg.mod#Foo.bar',
            type: 'method',
            file: 'src/mod.ts',
            signature: 'bar(x: number): string',
            docstring_snippet: 'Computes the bar.',
            tags: ['public', 'hot'],
            fan_in: 12,
            score: 0.87,
        });
    });

    it('omits missing optional fields', () => {
        const node = {
            qualified_name: 'a#b',
            symbol_type: 'function',
            file_path: 'a.ts',
        };
        const r = toStructuredResult(node);
        expect(r).toEqual({ qname: 'a#b', type: 'function', file: 'a.ts' });
        expect(r).not.toHaveProperty('signature');
        expect(r).not.toHaveProperty('fan_in');
        expect(r).not.toHaveProperty('score');
    });

    it('parses JSON-string tags and drops empty tag arrays', () => {
        const r = toStructuredResult({
            qualified_name: 'a#b', symbol_type: 'class', file_path: 'a.ts', tags: '["x","y"]',
        });
        expect(r.tags).toEqual(['x', 'y']);
        const r2 = toStructuredResult({
            qualified_name: 'a#b', symbol_type: 'class', file_path: 'a.ts', tags: '[]',
        });
        expect(r2).not.toHaveProperty('tags');
    });

    it('truncates long docstrings to 200 chars', () => {
        const long = 'x'.repeat(500);
        const r = toStructuredResult({
            qualified_name: 'a#b', symbol_type: 'function', file_path: 'a.ts', docstring: long,
        });
        expect(r.docstring_snippet).toHaveLength(200);
    });

    it('drops fan_in when zero', () => {
        const r = toStructuredResult({
            qualified_name: 'a#b', symbol_type: 'function', file_path: 'a.ts', fan_in: 0,
        });
        expect(r).not.toHaveProperty('fan_in');
    });
});

// ---------------------------------------------------------------------------
// ProjectProfile — round-trip with embedding config
// ---------------------------------------------------------------------------

describe('ProjectProfile embedding round-trip', () => {
    let fakeHome: string;

    beforeEach(() => {
        fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-profile-home-'));
        // os.homedir() reads HOME/USERPROFILE — point the storage dir at the sandbox.
        vi.stubEnv('HOME', fakeHome);
        vi.stubEnv('USERPROFILE', fakeHome);
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(fakeHome, { recursive: true, force: true });
    });

    it('persists and reloads the embedding config', () => {
        const projectPath = '/some/project';
        const profile: ProjectProfile = {
            embedding: {
                provider: 'openai',
                model: 'text-embedding-3-small',
                apiKey: 'sk-roundtrip',
                endpoint: 'https://api.openai.com',
                dimensions: 1536,
            },
        };
        saveProfile(projectPath, profile);
        const loaded = loadProfile(projectPath);
        expect(loaded.embedding).toEqual(profile.embedding);
    });

    it('leaves embedding undefined when not configured (default jina-sidecar)', () => {
        const projectPath = '/another/project';
        saveProfile(projectPath, { maxFileSize: 1234 });
        const loaded = loadProfile(projectPath);
        expect(loaded.embedding).toBeUndefined();
    });
});
