/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { EmbeddingProvider } from '../embedding-manager';
import { EmbeddingConfig } from './index';

/**
 * P9-0: Ollama embedding provider. Talks to a local (or remote) Ollama daemon
 * via its `/api/embed` endpoint. Uses native fetch — no SDK dependency.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
    private endpoint: string;
    private model: string;
    private dims: number;

    constructor(config: EmbeddingConfig) {
        this.endpoint = config.endpoint ?? 'http://localhost:11434';
        this.model = config.model ?? 'nomic-embed-text';
        this.dims = config.dimensions ?? 768;
    }

    async generate(text: string): Promise<number[]> {
        const resp = await fetch(`${this.endpoint}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: this.model, input: text }),
        });
        if (!resp.ok) throw new Error(`Ollama embedding error: ${resp.status}`);
        const data = await resp.json() as any;
        // Ollama /api/embed returns { embeddings: [number[]] }
        return data.embeddings?.[0] ?? [];
    }

    async generateBatch(texts: string[]): Promise<number[][]> {
        // Ollama /api/embed supports input as array
        const resp = await fetch(`${this.endpoint}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: this.model, input: texts }),
        });
        if (!resp.ok) throw new Error(`Ollama embedding error: ${resp.status}`);
        const data = await resp.json() as any;
        return data.embeddings ?? [];
    }

    getDimensions(): number { return this.dims; }
    getModelName(): string { return `ollama/${this.model}`; }
}
