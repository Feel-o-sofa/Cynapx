/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { Database } from 'better-sqlite3';
import { CodeNode } from '../types';
import { NodeRepository } from '../db/node-repository';
import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';

export interface EmbeddingProvider {
    generate(text: string): Promise<number[]>;
    generateBatch(texts: string[]): Promise<number[][]>;
    getDimensions(): number;
    getModelName(): string;
}

/**
 * Hybrid implementation using a Python Sidecar for full Jina 0.5b support.
 * Leverages GPU (CUDA) if available and supports bulk processing.
 */
export class PythonEmbeddingProvider implements EmbeddingProvider {
    private child: ChildProcess | null = null;
    private ready: boolean = false;
    private pending: ((v: any) => void) | null = null;
    private rejecter: ((e: any) => void) | null = null;
    private dimensions: number = 896;

    private async start() {
        if (this.child) return;
        const scriptPath = path.join(process.cwd(), 'scripts', 'cynapx_embedder.py');
        
        console.error(`[Embedding] Starting Python ML Sidecar...`);
        this.child = spawn('python', [scriptPath]);
        
        const reader = readline.createInterface({ input: this.child.stdout! });
        this.child.stderr!.on('data', (d) => console.error(`[Python-ML] ${d.toString().trim()}`));
        
        reader.on('line', (line) => {
            try {
                const data = JSON.parse(line);
                if (data.status === 'ready') {
                    this.ready = true;
                    this.dimensions = data.dim;
                    console.error(`[Embedding] Python Sidecar Ready (${data.device}, Dim: ${this.dimensions})`);
                } else if (data.vectors && this.pending) {
                    this.pending(data.vectors);
                    this.pending = null;
                } else if (data.vector && this.pending) {
                    this.pending([data.vector]);
                    this.pending = null;
                } else if (data.error && this.rejecter) {
                    this.rejecter(new Error(data.error));
                    this.pending = null;
                    this.rejecter = null;
                }
            } catch (e) {}
        });

        this.child.on('exit', (code) => {
            this.child = null;
            this.ready = false;
            if (code !== 0 && code !== null) {
                console.error(`[Embedding] Python Sidecar crashed with code ${code}`);
            }
        });
    }

    public async generate(text: string): Promise<number[]> {
        const batch = await this.generateBatch([text]);
        return batch[0];
    }

    public async generateBatch(texts: string[]): Promise<number[][]> {
        if (!this.child) await this.start();
        
        // Wait for readiness with timeout
        let waitCount = 0;
        const maxWait = 3000; // 300 seconds (5m)
        while (!this.ready) {
            if (waitCount > 0 && waitCount % 50 === 0) {
                console.error(`[Embedding] Still waiting for ML Sidecar... (${waitCount/10}s)`);
            }
            await new Promise(r => setTimeout(r, 100));
            if (++waitCount > maxWait) throw new Error("Python sidecar startup timed out.");
        }

        return new Promise((resolve, reject) => {
            this.pending = resolve;
            this.rejecter = reject;
            this.child?.stdin?.write(JSON.stringify({ texts }) + '\n');
        });
    }

    public getDimensions(): number { return this.dimensions; }
    public getModelName(): string { return 'jinaai/jina-code-embeddings-0.5b (GPU Hybrid)'; }

    public dispose() {
        if (this.child) {
            this.child.kill();
            this.child = null;
        }
    }
}

/**
 * Manages the lifecycle of embeddings for the knowledge graph.
 */
export class EmbeddingManager {
    private provider: EmbeddingProvider;

    constructor(private db: Database, private nodeRepo: NodeRepository, provider?: EmbeddingProvider) {
        this.provider = provider || new PythonEmbeddingProvider();
    }

    public createSnippet(node: CodeNode): string {
        let snippet = `Symbol: ${node.qualified_name}\nType: ${node.symbol_type}\n`;
        if (node.signature) snippet += `Signature: ${node.signature}\n`;
        
        let tags: string[] = [];
        if (node.tags) {
            tags = typeof node.tags === 'string' ? JSON.parse(node.tags) : node.tags;
        }
        if (tags.length > 0) snippet += `Context: ${tags.join(', ')}\n`;
        
        return snippet;
    }

    public async refreshAll(): Promise<void> {
        // Ensure model is ready and check dimensions
        await this.provider.generate("ping");
        const dim = this.provider.getDimensions();
        const modelName = this.provider.getModelName();

        try {
            const schema = this.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'node_embeddings'").get() as any;
            if (schema && !schema.sql.includes(`float[${dim}]`)) {
                console.error(`[EmbeddingManager] Dimension mismatch detected. Recreating node_embeddings table (Target: ${dim})...
`);
                this.db.exec('DROP TABLE IF EXISTS node_embeddings');
                this.db.exec(`CREATE VIRTUAL TABLE node_embeddings USING vec0(rowid INTEGER PRIMARY KEY, embedding float[${dim}])`);
                this.db.exec('DELETE FROM embedding_metadata');
            }
        } catch (e) {
            this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS node_embeddings USING vec0(rowid INTEGER PRIMARY KEY, embedding float[${dim}])`);
        }

        const nodesToProcess = this.db.prepare(`
            SELECT n.* FROM nodes n
            LEFT JOIN embedding_metadata m ON n.id = m.node_id
            WHERE m.node_id IS NULL OR n.checksum != m.checksum
        `).all() as any[];

        if (nodesToProcess.length === 0) return;

        console.error(`[EmbeddingManager] Refreshing embeddings for ${nodesToProcess.length} nodes...`);
        
        const batchSize = 50; 
        for (let i = 0; i < nodesToProcess.length; i += batchSize) {
            const batch = nodesToProcess.slice(i, i + batchSize);
            const snippets = batch.map(node => this.createSnippet(node));
            
            try {
                const vectors = await this.provider.generateBatch(snippets);
                
                this.db.transaction(() => {
                    vectors.forEach((vector, idx) => {
                        const node = batch[idx];
                        const nodeId = BigInt(node.id);
                        const buffer = Buffer.from(new Float32Array(vector).buffer);
                        this.db.prepare('INSERT OR REPLACE INTO node_embeddings(rowid, embedding) VALUES (?, ?)').run(nodeId, buffer);
                        this.db.prepare('INSERT OR REPLACE INTO embedding_metadata(node_id, checksum, model_name) VALUES (?, ?, ?)').run(
                            nodeId, node.checksum, modelName
                        );
                    });
                })();
                
                console.error(`[EmbeddingManager] Progress: ${Math.min(i + batchSize, nodesToProcess.length)}/${nodesToProcess.length}`);
            } catch (err) {
                console.error(`[EmbeddingManager] Batch failed: ${err}`);
            }
        }
        
        console.error(`[EmbeddingManager] Refresh complete.`);
    }
}
