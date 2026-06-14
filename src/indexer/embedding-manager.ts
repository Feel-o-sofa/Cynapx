/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { Database } from 'better-sqlite3';
import { CodeNode } from '../types';
import { NodeRepository } from '../db/node-repository';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';
import { Logger } from '../utils/logger';


const log = new Logger('Embedding');
/**
 * C-1(3)/P13-1: probes whether a command is runnable (used to pick the
 * Python interpreter). Kept separate so tests can inject a fake probe.
 */
function canRunCommand(cmd: string): boolean {
    try {
        const result = spawnSync(cmd, ['--version'], { stdio: 'ignore', timeout: 5000 });
        return !result.error && result.status === 0;
    } catch {
        return false;
    }
}

/**
 * C-1(3)/P13-1: resolves the Python interpreter command for the embedding
 * sidecar. Modern Linux distros (and the Docker runtime image, which installs
 * only `python3`) have no `python` binary, while some environments expose
 * only `python` — try `python3` first, then fall back to `python`.
 * Returns null when no interpreter is available.
 */
export function resolvePythonCommand(
    probe: (cmd: string) => boolean = canRunCommand
): string | null {
    for (const cmd of ['python3', 'python']) {
        if (probe(cmd)) return cmd;
    }
    return null;
}

export interface EmbeddingProvider {
    generate(text: string): Promise<number[]>;
    generateBatch(texts: string[]): Promise<number[][]>;
    getDimensions(): number;
    getModelName(): string;
    // H-5: providers backed by external processes (e.g. PythonEmbeddingProvider)
    // implement this to terminate child processes on shutdown.
    dispose?(): void;
}

/**
 * Hybrid implementation using a Python Sidecar for full Jina 0.5b support.
 * Leverages GPU (CUDA) if available and supports bulk processing.
 *
 * Pure process + IPC transport — no internal request queue.
 * EmbeddingManager serializes calls via its own queue.
 */
type PendingRequest = {
    id: number;
    resolve: (v: number[][]) => void;
    reject: (e: Error) => void;
} | null;

export class PythonEmbeddingProvider implements EmbeddingProvider {
    private child: ChildProcess | null = null;
    private rl: readline.Interface | null = null;
    private ready: boolean = false;
    private pendingRequest: PendingRequest = null;
    // A-7: monotonic request id. Each generateBatch() request carries a unique
    // id echoed back by the sidecar. A response whose id does not match the
    // current pending request is a stale/late reply (e.g. for a batch the
    // EmbeddingManager already timed out) and is discarded instead of being
    // mis-delivered to a subsequent batch's pending slot.
    private nextRequestId: number = 1;
    private dimensions: number = 896;
    // H-2(3): FTS5 폴백 모드 플래그 및 경고 출력 여부
    public fallbackMode: boolean = false;
    private fallbackWarned: boolean = false;
    // H-2(2): 자동 재시작 재시도 카운터
    private restartAttempts: number = 0;
    private static readonly MAX_RESTART_ATTEMPTS = 3;
    // H-5: set by dispose() to stop the auto-restart loop and any in-flight kill escalation.
    private disposed: boolean = false;
    private static readonly KILL_TIMEOUT_MS = 5000;

    // C-1(3): resolved lazily on first start(); null = no interpreter found.
    private pythonCmd: string | null | undefined = undefined;

    /**
     * H-2(3)/C-1(3): switches the provider into FTS5 fallback mode, warning
     * once and rejecting any in-flight request.
     */
    private enterFallbackMode(reason: string): void {
        this.fallbackMode = true;
        if (!this.fallbackWarned) {
            this.fallbackWarned = true;
            log.error(`[Embedding] WARNING: ${reason}. Switching to FTS5 fallback mode. Semantic search disabled.`);
        }
        const pending = this.pendingRequest;
        this.pendingRequest = null;
        if (pending) {
            pending.reject(new Error(`${reason}; fallback mode active`));
        }
    }

    /**
     * Handles one parsed JSON message line from the Python sidecar. Extracted
     * from the readline 'line' handler so the A-7 request-id discipline is unit
     * testable without spawning a real sidecar.
     */
    private handleSidecarMessage(data: any): void {
        if (data.status === 'ready') {
            this.ready = true;
            this.restartAttempts = 0; // 정상 기동 시 재시도 카운터 초기화
            this.dimensions = data.dim;
            log.error(`[Embedding] Python Sidecar Ready (${data.device}, Dim: ${this.dimensions})`);
        } else if (data.vectors || data.vector || data.error) {
            // A-7: a data-bearing response. Only deliver it to the pending
            // request if its id matches (or the sidecar omitted an id, for
            // backward compatibility with an embedder that doesn't echo
            // it). A response whose id mismatches the current pending
            // request is a stale/late reply for an already-resolved batch
            // and is discarded so it can't be mis-mapped onto a later one.
            const pending = this.pendingRequest;
            if (!pending) {
                // No outstanding request — nothing legitimately expects
                // this response. Discard.
            } else if (typeof data.id === 'number' && data.id !== pending.id) {
                log.error(`[Embedding] Discarding stale sidecar response (id=${data.id}, expected=${pending.id}).`);
            } else {
                this.pendingRequest = null;
                if (data.error) {
                    pending.reject(new Error(data.error));
                } else if (data.vectors) {
                    pending.resolve(data.vectors);
                } else {
                    pending.resolve([data.vector]);
                }
            }
        }
    }

    private async start() {
        // L6: a disposed provider must never resurrect the sidecar.
        if (this.disposed) return;
        if (this.child) return;

        // C-1(3)/P13-1: pick python3 first (modern distros / Docker runtime
        // image ship python3 only), fall back to python; if neither exists,
        // degrade to FTS5 fallback mode instead of spawning a doomed child.
        if (this.pythonCmd === undefined) {
            this.pythonCmd = resolvePythonCommand();
        }
        if (this.pythonCmd === null) {
            this.enterFallbackMode('No python3/python interpreter found');
            return;
        }

        // C-2 (diagnostic-v10): resolve the sidecar script relative to the
        // package root (__dirname = <root>/dist/indexer or <root>/src/indexer),
        // not process.cwd() — cwd is wrong for global installs and when the
        // server is launched from another directory.
        const scriptPath = path.resolve(__dirname, '..', '..', 'scripts', 'cynapx_embedder.py');

        log.error(`[Embedding] Starting Python ML Sidecar (${this.pythonCmd})...`);
        this.child = spawn(this.pythonCmd, [scriptPath]);

        // M-7: Close any existing readline interface before creating a new one
        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }
        this.rl = readline.createInterface({ input: this.child.stdout! });
        const reader = this.rl;
        this.child.stderr!.on('data', (d) => log.error(`[Python-ML] ${d.toString().trim()}`));

        reader.on('line', (line) => {
            try {
                this.handleSidecarMessage(JSON.parse(line));
            } catch (e) {}
        });

        // H-2(2)/C-2: shared failure path for 'exit' AND 'error'. spawn
        // failures (e.g. ENOENT, EACCES) are reported via the 'error' event —
        // NOT 'exit' — and a listenerless 'error' on a ChildProcess throws,
        // escalating to uncaughtException → process.exit(1). Both events
        // funnel into the same retry/fallback logic; the guard makes the
        // handling idempotent in case both fire for the same child.
        const child = this.child;
        let failureHandled = false;
        const handleChildGone = () => {
            if (failureHandled) return;
            failureHandled = true;
            if (this.child === child) {
                this.child = null;
            }
            this.ready = false;
            if (this.disposed) return;
            // 자동 재시작 (최대 3회, 지수 백오프: 1s/2s/4s)
            if (this.restartAttempts < PythonEmbeddingProvider.MAX_RESTART_ATTEMPTS) {
                const delay = Math.pow(2, this.restartAttempts) * 1000; // 1s, 2s, 4s
                this.restartAttempts++;
                log.error(`[Embedding] Restarting Python Sidecar (attempt ${this.restartAttempts}/${PythonEmbeddingProvider.MAX_RESTART_ATTEMPTS}) in ${delay}ms...`);
                setTimeout(() => { this.start(); }, delay);
            } else {
                // H-2(3): 재시도 소진 시 FTS5 폴백 모드 활성화
                this.enterFallbackMode(`Python Sidecar unavailable after ${PythonEmbeddingProvider.MAX_RESTART_ATTEMPTS} retries`);
            }
        };

        // C-2 (diagnostic-v10): without this listener a spawn failure crashes
        // the whole host process (uncaughtException). Mirror the exit handler.
        this.child.on('error', (err) => {
            log.error(`[Embedding] Python Sidecar spawn error: ${err.message}`);
            handleChildGone();
        });

        this.child.on('exit', (code) => {
            if (code !== 0 && code !== null) {
                log.error(`[Embedding] Python Sidecar crashed with code ${code}`);
            }
            handleChildGone();
        });
    }

    public async generate(text: string): Promise<number[]> {
        const batch = await this.generateBatch([text]);
        // L1: an empty batch means fallback mode / no embeddings produced —
        // signal it explicitly instead of returning undefined.
        if (batch.length === 0) {
            throw new Error('Embedding provider unavailable (fallback mode): no embeddings produced');
        }
        return batch[0];
    }

    public async generateBatch(texts: string[]): Promise<number[][]> {
        // H-2(3)/L1: 폴백 모드면 빈 배열을 graceful하게 반환 (타입 위반 null 대신)
        if (this.fallbackMode) {
            return [];
        }

        if (!this.child) await this.start();
        // C-1(3): start() may have entered fallback mode (no interpreter).
        if (this.fallbackMode) {
            return [];
        }

        // Wait for readiness with timeout
        let waitCount = 0;
        const maxWait = 300; // 30 seconds
        while (!this.ready) {
            // Fallback mode entered while waiting (e.g. crash retries exhausted)
            if (this.fallbackMode) {
                return [];
            }
            if (waitCount > 0 && waitCount % 50 === 0) {
                log.error(`[Embedding] Still waiting for ML Sidecar... (${waitCount/10}s)`);
            }
            await new Promise(r => setTimeout(r, 100));
            if (++waitCount > maxWait) throw new Error("Python sidecar startup timed out.");
        }

        // Send one request and await one response — EmbeddingManager serializes calls
        return new Promise((resolve, reject) => {
            // A-7: if a previous request is somehow still pending (e.g. the
            // EmbeddingManager-level batch timeout fired but the sidecar never
            // replied), reject it before taking over the single slot so a late
            // reply for it cannot resolve this new request with the wrong
            // vectors. The id check on the response is the second line of
            // defence against mis-delivery.
            if (this.pendingRequest) {
                const stale = this.pendingRequest;
                this.pendingRequest = null;
                stale.reject(new Error('Embedding request superseded before response'));
            }
            const id = this.nextRequestId++;
            this.pendingRequest = { id, resolve, reject };
            this.child?.stdin?.write(JSON.stringify({ id, texts }) + '\n');
        });
    }

    public getDimensions(): number { return this.dimensions; }
    public getModelName(): string { return 'jinaai/jina-code-embeddings-0.5b (GPU Hybrid)'; }

    public dispose() {
        // H-5: stop the auto-restart loop before tearing down the child process.
        this.disposed = true;

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
            const child = this.child;
            this.child = null;
            child.kill('SIGTERM');
            const killTimer = setTimeout(() => {
                if (child.exitCode === null && child.signalCode === null) {
                    child.kill('SIGKILL');
                }
            }, PythonEmbeddingProvider.KILL_TIMEOUT_MS);
            killTimer.unref?.();
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
        return [];
    }

    public async generateBatch(_texts: string[]): Promise<number[][]> {
        return [];
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
    private _available: boolean = false;

    public get isAvailable(): boolean {
        return this._available;
    }

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
            log.error('[EmbeddingManager] Primary provider in fallback mode — switching to NullEmbeddingProvider');
            this.provider = new NullEmbeddingProvider();
            this._available = false;
            this.onProviderFallback?.();
        }

        // NullEmbeddingProvider: skip embedding refresh entirely
        if (this.provider instanceof NullEmbeddingProvider) {
            return;
        }

        // Ensure model is ready and check dimensions
        await this.provider.generate("ping");
        this._available = true;
        const dim = this.provider.getDimensions();
        const modelName = this.provider.getModelName();

        try {
            const schema = this.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'node_embeddings'").get() as { sql?: string } | undefined;
            if (schema?.sql && !schema.sql.includes(`float[${dim}]`)) {
                log.warn(`[EmbeddingManager] Dimension mismatch detected. Recreating node_embeddings table (Target: ${dim}).`);
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
        `).all() as (CodeNode & { id: number })[];

        if (nodesToProcess.length === 0) return;

        log.error(`[EmbeddingManager] Refreshing embeddings for ${nodesToProcess.length} nodes...`);

        const batchSize = 50;
        for (let i = 0; i < nodesToProcess.length; i += batchSize) {
            const batch = nodesToProcess.slice(i, i + batchSize);
            const snippets = batch.map(node => this.createSnippet(node));

            try {
                const vectors = await this.enqueuedBatch(snippets);
                // L1: fallback mode now returns [] instead of null — treat
                // both as "no embeddings produced" and skip the batch.
                if (!vectors || vectors.length === 0) {
                    log.error('[EmbeddingManager] Batch returned no vectors — skipping (fallback mode)');
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

                log.error(`[EmbeddingManager] Progress: ${Math.min(i + batchSize, nodesToProcess.length)}/${nodesToProcess.length}`);
            } catch (err) {
                log.error(`[EmbeddingManager] Batch failed: ${err}`);
            }
        }

        log.error(`[EmbeddingManager] Refresh complete.`);
    }
}
