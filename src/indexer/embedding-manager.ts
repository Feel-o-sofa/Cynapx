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
 *
 * Pure process + IPC transport — no internal request queue.
 * EmbeddingManager serializes calls via its own queue.
 */
type PendingRequest = {
    resolve: (v: number[][]) => void;
    reject: (e: Error) => void;
} | null;

export class PythonEmbeddingProvider implements EmbeddingProvider {
    private child: ChildProcess | null = null;
    private rl: readline.Interface | null = null;
    private ready: boolean = false;
    private pendingRequest: PendingRequest = null;
    private dimensions: number = 896;
    // H-2(3): FTS5 폴백 모드 플래그 및 경고 출력 여부
    public fallbackMode: boolean = false;
    private fallbackWarned: boolean = false;
    // H-2(2): 자동 재시작 재시도 카운터
    private restartAttempts: number = 0;
    private static readonly MAX_RESTART_ATTEMPTS = 3;

    private async start() {
        if (this.child) return;
        const scriptPath = path.join(process.cwd(), 'scripts', 'cynapx_embedder.py');

        console.error(`[Embedding] Starting Python ML Sidecar...`);
        this.child = spawn('python', [scriptPath]);

        // M-7: Close any existing readline interface before creating a new one
        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }
        this.rl = readline.createInterface({ input: this.child.stdout! });
        const reader = this.rl;
        this.child.stderr!.on('data', (d) => console.error(`[Python-ML] ${d.toString().trim()}`));

        reader.on('line', (line) => {
            try {
                const data = JSON.parse(line);
                if (data.status === 'ready') {
                    this.ready = true;
                    this.restartAttempts = 0; // 정상 기동 시 재시도 카운터 초기화
                    this.dimensions = data.dim;
                    console.error(`[Embedding] Python Sidecar Ready (${data.device}, Dim: ${this.dimensions})`);
                } else if (data.vectors && this.pendingRequest) {
                    const pending = this.pendingRequest;
                    this.pendingRequest = null;
                    pending.resolve(data.vectors);
                } else if (data.vector && this.pendingRequest) {
                    const pending = this.pendingRequest;
                    this.pendingRequest = null;
                    pending.resolve([data.vector]);
                } else if (data.error && this.pendingRequest) {
                    const pending = this.pendingRequest;
                    this.pendingRequest = null;
                    pending.reject(new Error(data.error));
                }
            } catch (e) {}
        });

        // H-2(2): 프로세스 종료 시 자동 재시작 (최대 3회, 지수 백오프: 1s/2s/4s)
        this.child.on('exit', (code) => {
            this.child = null;
            this.ready = false;
            if (code !== 0 && code !== null) {
                console.error(`[Embedding] Python Sidecar crashed with code ${code}`);
            }
            if (this.restartAttempts < PythonEmbeddingProvider.MAX_RESTART_ATTEMPTS) {
                const delay = Math.pow(2, this.restartAttempts) * 1000; // 1s, 2s, 4s
                this.restartAttempts++;
                console.error(`[Embedding] Restarting Python Sidecar (attempt ${this.restartAttempts}/${PythonEmbeddingProvider.MAX_RESTART_ATTEMPTS}) in ${delay}ms...`);
                setTimeout(() => { this.start(); }, delay);
            } else {
                // H-2(3): 재시도 소진 시 FTS5 폴백 모드 활성화
                this.fallbackMode = true;
                if (!this.fallbackWarned) {
                    this.fallbackWarned = true;
                    console.error(`[Embedding] WARNING: Python Sidecar unavailable after ${PythonEmbeddingProvider.MAX_RESTART_ATTEMPTS} retries. Switching to FTS5 fallback mode. Semantic search disabled.`);
                }
                // 현재 대기 중인 요청을 거절
                const pendingOnFallback = this.pendingRequest;
                this.pendingRequest = null;
                if (pendingOnFallback) {
                    pendingOnFallback.reject(new Error('Sidecar unavailable; fallback mode active'));
                }
            }
        });
    }

    public async generate(text: string): Promise<number[]> {
        const batch = await this.generateBatch([text]);
        return batch[0];
    }

    public async generateBatch(texts: string[]): Promise<number[][]> {
        // H-2(3): 폴백 모드면 null을 graceful하게 반환
        if (this.fallbackMode) {
            return null as unknown as number[][];
        }

        if (!this.child) await this.start();

        // Wait for readiness with timeout
        let waitCount = 0;
        const maxWait = 300; // 30 seconds
        while (!this.ready) {
            if (waitCount > 0 && waitCount % 50 === 0) {
                console.error(`[Embedding] Still waiting for ML Sidecar... (${waitCount/10}s)`);
            }
            await new Promise(r => setTimeout(r, 100));
            if (++waitCount > maxWait) throw new Error("Python sidecar startup timed out.");
        }

        // Send one request and await one response — EmbeddingManager serializes calls
        return new Promise((resolve, reject) => {
            this.pendingRequest = { resolve, reject };
            this.child?.stdin?.write(JSON.stringify({ texts }) + '\n');
        });
    }

    public getDimensions(): number { return this.dimensions; }
    public getModelName(): string { return 'jinaai/jina-code-embeddings-0.5b (GPU Hybrid)'; }

    public dispose() {
        const pendingOnDispose = this.pendingRequest;
        this.pendingRequest = null;
        if (pendingOnDispose) {
            pendingOnDispose.reject(new Error('PythonEmbeddingProvider disposed'));
        }
        // M-7: Close readline interface to prevent resource leak
        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }
        if (this.child) {
            this.child.kill();
            this.child = null;
        }
    }
}

/**
 * NullEmbeddingProvider is used when embeddings are unavailable
 * (e.g., Python sidecar failed and max retries exhausted).
 * Returns null/empty values, allowing the system to degrade gracefully.
 */
export class NullEmbeddingProvider implements EmbeddingProvider {
    public readonly unavailable = true;

    public async generate(_text: string): Promise<number[]> {
        return null as unknown as number[];
    }

    public async generateBatch(_texts: string[]): Promise<number[][]> {
        return null as unknown as number[][];
    }

    public getDimensions(): number { return 0; }
    public getModelName(): string { return 'null (unavailable)'; }
}

/**
 * Manages the lifecycle of embeddings for the knowledge graph.
 * Owns the serialization queue and per-batch timeout for all provider calls.
 */
export class EmbeddingManager {
    private provider: EmbeddingProvider;
    private queueTail: Promise<void> = Promise.resolve();
    private static readonly BATCH_TIMEOUT_MS = 120_000; // 2 minutes per batch

    constructor(
        private db: Database,
        private nodeRepo: NodeRepository,
        provider?: EmbeddingProvider,
        private onProviderFallback?: () => void
    ) {
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

    /**
     * Enqueues a batch request through the sequential promise chain and wraps it
     * with a per-batch timeout. On timeout, rejects this batch but allows
     * refreshAll() to catch and continue processing remaining batches.
     */
    private enqueuedBatch(texts: string[]): Promise<number[][]> {
        const timeoutMs = EmbeddingManager.BATCH_TIMEOUT_MS;
        let resolve!: (result: Promise<number[][]>) => void;
        const slot = new Promise<number[][]>((res) => { resolve = res; });

        this.queueTail = this.queueTail.then(() => {
            const batchPromise = this.provider.generateBatch(texts);
            const timeoutPromise = new Promise<never>((_res, rej) =>
                setTimeout(() => rej(new Error(`Batch timed out after ${timeoutMs}ms`)), timeoutMs)
            );
            resolve(Promise.race([batchPromise, timeoutPromise]));
            // Wait for the batch (or timeout) before releasing the queue slot
            return Promise.race([batchPromise, timeoutPromise]).then(() => {}, () => {});
        });

        return slot;
    }

    public async refreshAll(): Promise<void> {
        // If provider entered fallback mode, switch to NullEmbeddingProvider
        if (this.provider instanceof PythonEmbeddingProvider && this.provider.fallbackMode) {
            console.error('[EmbeddingManager] Primary provider in fallback mode — switching to NullEmbeddingProvider');
            this.provider = new NullEmbeddingProvider();
            this.onProviderFallback?.();
        }

        // NullEmbeddingProvider: skip embedding refresh entirely
        if (this.provider instanceof NullEmbeddingProvider) {
            return;
        }

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
                const vectors = await this.enqueuedBatch(snippets);
                if (!vectors) {
                    console.error('[EmbeddingManager] Batch returned null — skipping (fallback mode)');
                    continue;
                }

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
