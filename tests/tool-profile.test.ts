/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 *
 * Tool profiles (frontier / full).
 *
 * The owner's direction: Cynapx complements frontier agents instead of
 * competing with them, and already-built features are never deleted — they are
 * kept for smaller local models and disabled by default. These gates pin:
 *   - profile resolution from CYNAPX_TOOL_PROFILE,
 *   - the exact tool and prompt lists served per profile over real MCP,
 *   - hidden tools answer with an explanation, not "unknown tool",
 *   - the operator instructions never point an agent at a hidden tool,
 *   - search_symbols falls back to keywords and says so when embeddings are off.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer, buildCynapxInstructions } from '../src/server/mcp-server';
import { TOOL_DEFINITIONS } from '../src/server/tool-dispatcher';
import { toolRegistry } from '../src/server/tools/_registry';
import {
    resolveToolProfile, isToolEnabled, FRONTIER_HIDDEN_TOOLS, DEFAULT_TOOL_PROFILE,
} from '../src/utils/tool-profile';
import { searchSymbolsHandler, SEMANTIC_FALLBACK_NOTICE } from '../src/server/tools/search-symbols';
import { NullEmbeddingProvider } from '../src/indexer/embedding-manager';

const HIDDEN = [
    'find_similar_symbols', 'propose_refactor', 'discover_latent_policies',
    'export_graph', 're_tag_project', 'get_remediation_strategy',
];

const ENV_KEYS = ['CYNAPX_TOOL_PROFILE', 'CYNAPX_EMBED_PROVIDER'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
});

/** Starts a real McpServer for the given profile and connects an MCP client to it. */
async function connect(profile?: 'frontier' | 'full') {
    if (profile) process.env.CYNAPX_TOOL_PROFILE = profile;
    // Keep the full profile from reaching for the Python sidecar in tests.
    process.env.CYNAPX_EMBED_PROVIDER = 'null';
    const server = new McpServer();
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connectTransport(serverSide);
    const client = new Client({ name: 'tool-profile-test', version: '1.0' });
    await client.connect(clientSide);
    return { server, client };
}

describe('resolveToolProfile', () => {
    it('defaults to frontier', () => {
        expect(DEFAULT_TOOL_PROFILE).toBe('frontier');
        expect(resolveToolProfile({})).toBe('frontier');
    });

    it('accepts frontier and full, case- and whitespace-insensitively', () => {
        expect(resolveToolProfile({ CYNAPX_TOOL_PROFILE: 'full' })).toBe('full');
        expect(resolveToolProfile({ CYNAPX_TOOL_PROFILE: ' FULL ' })).toBe('full');
        expect(resolveToolProfile({ CYNAPX_TOOL_PROFILE: 'Frontier' })).toBe('frontier');
    });

    it('falls back to the default for unknown values', () => {
        expect(resolveToolProfile({ CYNAPX_TOOL_PROFILE: 'everything' })).toBe('frontier');
    });
});

describe('tool lists per profile', () => {
    it('defines 27 tools, each backed by a registered handler', () => {
        const names = TOOL_DEFINITIONS.map(t => t.name);
        expect(names).toHaveLength(27);
        expect(new Set(names).size).toBe(27);
        for (const n of names) expect(toolRegistry.has(n)).toBe(true);
    });

    it('hides exactly the six frontier tools, and nothing is deleted', () => {
        expect([...FRONTIER_HIDDEN_TOOLS].sort()).toEqual([...HIDDEN].sort());
        for (const n of HIDDEN) {
            expect(TOOL_DEFINITIONS.some(t => t.name === n)).toBe(true);
            expect(toolRegistry.has(n)).toBe(true);
            expect(isToolEnabled(n, 'frontier')).toBe(false);
            expect(isToolEnabled(n, 'full')).toBe(true);
        }
    });

    it('serves 21 tools over MCP by default (frontier)', async () => {
        const { client, server } = await connect();
        const { tools } = await client.listTools();
        const names = tools.map(t => t.name);
        expect(names).toHaveLength(21);
        for (const n of HIDDEN) expect(names).not.toContain(n);
        expect(server.toolProfile).toBe('frontier');
        await client.close();
    });

    it('serves all 27 tools over MCP under the full profile', async () => {
        const { client } = await connect('full');
        const { tools } = await client.listTools();
        expect(tools).toHaveLength(27);
        for (const n of HIDDEN) expect(tools.map(t => t.name)).toContain(n);
        await client.close();
    });
});

describe('calling a hidden tool under frontier', () => {
    it('returns an explanatory error result instead of "unknown tool", without waiting for readiness', async () => {
        const { client } = await connect('frontier');
        // The server was never marked ready; a gate placed after
        // waitUntilReady() would hang here instead of answering.
        const result: any = await client.callTool({ name: 'find_similar_symbols', arguments: { qualified_name: 'x' } });
        expect(result.isError).toBe(true);
        const text = result.content[0].text as string;
        expect(text).toContain("'find_similar_symbols' is disabled");
        expect(text).toContain('CYNAPX_TOOL_PROFILE=full');
        await client.close();
    });

    it('still reports genuinely unknown tools as unknown', async () => {
        const { client } = await connect('frontier');
        await expect(client.callTool({ name: 'no_such_tool', arguments: {} })).rejects.toThrow();
        await client.close();
    });
});

describe('prompts per profile', () => {
    it('hides find-similar under frontier and explains why when it is requested', async () => {
        const { client } = await connect('frontier');
        const { prompts } = await client.listPrompts();
        expect(prompts.map(p => p.name)).not.toContain('find-similar');
        expect(prompts).toHaveLength(5);
        await expect(client.getPrompt({ name: 'find-similar', arguments: { qualified_name: 'x' } }))
            .rejects.toThrow(/CYNAPX_TOOL_PROFILE=full/);
        await client.close();
    });

    it('serves all six prompts under full', async () => {
        const { client } = await connect('full');
        const { prompts } = await client.listPrompts();
        expect(prompts.map(p => p.name)).toContain('find-similar');
        expect(prompts).toHaveLength(6);
        await client.close();
    });
});

describe('operator instructions per profile', () => {
    /** snake_case identifiers in backticks are tool references. */
    const toolRefs = (text: string) =>
        [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map(m => m[1]).filter(n => toolRegistry.has(n));

    it('frontier instructions only reference tools the frontier profile serves', () => {
        const text = buildCynapxInstructions('9.9.9', 'frontier');
        const refs = toolRefs(text);
        expect(refs.length).toBeGreaterThan(10);
        for (const n of refs) expect(isToolEnabled(n, 'frontier')).toBe(true);
        expect(text).toContain('Tool profile: frontier');
        expect(text).toContain('CYNAPX_TOOL_PROFILE=full');
    });

    it('full instructions keep the semantic and remediation guidance', () => {
        const text = buildCynapxInstructions('9.9.9', 'full');
        expect(text).toContain('`find_similar_symbols`');
        expect(text).toContain('`get_remediation_strategy`');
        expect(text).toContain('Tool profile: full');
    });

    it('is what the server actually sends at connect time', async () => {
        const { client } = await connect('frontier');
        expect(client.getInstructions()).toContain('Tool profile: frontier');
        await client.close();
    });
});

describe('search_symbols with embeddings off', () => {
    const node = { id: 1, qualified_name: 'src/a.ts#add', symbol_type: 'function', file_path: 'src/a.ts' };
    const deps: any = {
        embeddingProvider: new NullEmbeddingProvider(),
        workspaceManager: {
            getAllContexts: () => [{
                graphEngine: { nodeRepo: { searchSymbols: () => [node] }, getNodeById: () => node },
                vectorRepo: { search: () => { throw new Error('vector search must not run when embeddings are off'); } },
            }],
        },
    };

    it('answers semantic requests from the keyword index and says so', async () => {
        const result = await searchSymbolsHandler.execute({ query: 'add', semantic: true }, deps);
        expect(result.isError).toBeUndefined();
        expect(JSON.parse(result.content[0].text)).toHaveLength(1);
        expect(result.content[1]?.text).toBe(SEMANTIC_FALLBACK_NOTICE);
    });

    it('treats a caller-supplied query_embedding the same way', async () => {
        const result = await searchSymbolsHandler.execute({ query: 'add', query_embedding: [0.1, 0.2] }, deps);
        expect(result.content[1]?.text).toBe(SEMANTIC_FALLBACK_NOTICE);
    });

    it('adds no notice to plain keyword searches', async () => {
        const result = await searchSymbolsHandler.execute({ query: 'add' }, deps);
        expect(result.content).toHaveLength(1);
    });
});
