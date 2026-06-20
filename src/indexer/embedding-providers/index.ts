/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { EmbeddingProvider, PythonEmbeddingProvider, NullEmbeddingProvider } from '../embedding-manager';
import { OpenAIEmbeddingProvider } from './openai';
import { OllamaEmbeddingProvider } from './ollama';

/**
 * P9-0: Configuration for an embedding provider. Mirrors the `embedding`
 * field on ProjectProfile so a profile can drive provider selection.
 */
export interface EmbeddingConfig {
    provider: 'jina-sidecar' | 'openai' | 'ollama' | 'null';
    model?: string;
    apiKey?: string;
    endpoint?: string;
    dimensions?: number;
}

/**
 * P9-0: Factory that maps an EmbeddingConfig to a concrete EmbeddingProvider.
 * When config is undefined or `jina-sidecar`, the existing Python sidecar
 * provider is returned (default behavior, unchanged from before P9-0).
 */
export function createEmbeddingProvider(config?: EmbeddingConfig): EmbeddingProvider {
    if (!config || config.provider === 'jina-sidecar') {
        return new PythonEmbeddingProvider();
    }
    if (config.provider === 'openai') {
        return new OpenAIEmbeddingProvider(config);
    }
    if (config.provider === 'ollama') {
        return new OllamaEmbeddingProvider(config);
    }
    // 'null' or unknown
    return new NullEmbeddingProvider();
}

/**
 * P9-0: Builds an EmbeddingProvider from environment variables. Lets users
 * switch providers without editing a profile:
 *   CYNAPX_EMBED_PROVIDER, CYNAPX_EMBED_MODEL, CYNAPX_EMBED_API_KEY,
 *   CYNAPX_EMBED_ENDPOINT, CYNAPX_EMBED_DIMENSIONS
 * Absent/`jina-sidecar` -> default sidecar provider.
 */
export function createEmbeddingProviderFromEnv(): EmbeddingProvider {
    const provider = process.env.CYNAPX_EMBED_PROVIDER;
    if (!provider || provider === 'jina-sidecar') {
        return new PythonEmbeddingProvider();
    }
    const config: EmbeddingConfig = {
        provider: provider as any,
        model: process.env.CYNAPX_EMBED_MODEL,
        apiKey: process.env.CYNAPX_EMBED_API_KEY,
        endpoint: process.env.CYNAPX_EMBED_ENDPOINT,
        dimensions: process.env.CYNAPX_EMBED_DIMENSIONS
            ? parseInt(process.env.CYNAPX_EMBED_DIMENSIONS, 10)
            : undefined,
    };
    return createEmbeddingProvider(config);
}

export { OpenAIEmbeddingProvider } from './openai';
export { OllamaEmbeddingProvider } from './ollama';
