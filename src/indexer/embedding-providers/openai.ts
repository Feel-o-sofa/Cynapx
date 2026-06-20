/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { EmbeddingProvider } from '../embedding-manager';
import { EmbeddingConfig } from './index';

/**
 * P9-0: OpenAI-compatible embedding provider. Talks to any endpoint exposing
 * the `/v1/embeddings` API (OpenAI, Azure OpenAI gateways, LM Studio, vLLM,
 * etc.). Uses native fetch — no SDK dependency.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
    private endpoint: string;
    private model: string;
    private apiKey: string;
    private dims: number;

    constructor(config: EmbeddingConfig) {
        this.endpoint = config.endpoint ?? 'https://api.openai.com';
        this.model = config.model ?? 'text-embedding-3-small';
        this.apiKey = config.apiKey ?? process.env.CYNAPX_EMBED_API_KEY ?? '';
        this.dims = config.dimensions ?? 1536;
    }

    async generate(text: string): Promise<number[]> {
        const result = await this.generateBatch([text]);
        return result[0] ?? [];
    }

    async generateBatch(texts: string[]): Promise<number[][]> {
        const resp = await fetch(`${this.endpoint}/v1/embeddings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({ model: this.model, input: texts }),
        });
        if (!resp.ok) {
            throw new Error(`OpenAI embedding API error: ${resp.status} ${resp.statusText}`);
        }
        const data = await resp.json() as any;
        // OpenAI returns { data: [{ embedding: number[], index: number }, ...] }
        const sorted = (data.data as any[]).sort((a, b) => a.index - b.index);
        return sorted.map((d: any) => d.embedding);
    }

    getDimensions(): number { return this.dims; }
    getModelName(): string { return `openai/${this.model}`; }
}
