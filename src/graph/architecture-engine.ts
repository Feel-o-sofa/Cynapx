/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as fs from 'fs';
import { GraphEngine } from './graph-engine';
import { PolicyDiscoverer, LatentPolicy } from './policy-discoverer';
import { CodeNode, CodeEdge } from '../types';

export interface ArchRule {
    name: string;
    from: string;  // layer name matched against file path segment
    to: string;    // layer name matched against file path segment
    allowed: boolean;
    rationale?: string; // why this rule exists (P6)
}

/**
 * Declared layer definition (P6).
 */
export interface LayerDef {
    name: string;         // e.g. "api", "core", "data"
    pathPattern: string;  // regex or glob matched against file_path
    description?: string;
}

/**
 * The project's declared architecture intent (P6).
 */
export interface ArchitectureIntent {
    layers: LayerDef[];
    rules: ArchRule[];
    responsibilities: Record<string, string>; // layer name → what it does
}

/**
 * Drift detection report comparing declared intent against actual graph (P6).
 */
export interface DriftReport {
    declaredLayers: { name: string; nodeCount: number; description?: string }[];
    unmappedLayers: string[];  // declared but 0 matching nodes
    ruleHealth: { rule: ArchRule; violationCount: number; status: 'healthy' | 'violated' }[];
    emergentPatterns: LatentPolicy[];  // from PolicyDiscoverer that aren't declared
}

export interface ArchitecturePolicy {
    id: string;
    description: string;
    forbidden: {
        from: string; // e.g. "layer:data"
        to: string;   // e.g. "layer:api"
    }[];
}

export interface ArchitectureViolation {
    source: CodeNode;
    target: CodeNode;
    edge: CodeEdge;
    policyId: string;
    description: string;
    rationale?: string; // present when the matched custom rule declares one (P6)
}

/**
 * ArchitectureEngine detects violations of architectural policies.
 */
export class ArchitectureEngine {
    private cycleCache: { timestamp: number; cycles: number[][] } | null = null;
    private customRules: ArchRule[] | null = null;

    private policies: ArchitecturePolicy[] = [
        {
            id: 'layer-hierarchy',
            description: 'Maintain strict layer hierarchy (API -> Core -> Data)',
            forbidden: [
                { from: 'layer:data', to: 'layer:api' },
                { from: 'layer:data', to: 'layer:core' },
                { from: 'layer:core', to: 'layer:api' },
                { from: 'layer:utility', to: 'layer:api' },
                { from: 'layer:utility', to: 'layer:core' },
                { from: 'layer:utility', to: 'layer:data' }
            ]
        },
        {
            id: 'role-integrity',
            description: 'Ensure role-based relationship integrity',
            forbidden: [
                { from: 'role:utility', to: 'role:service' },
                { from: 'role:utility', to: 'role:repository' },
                { from: 'role:repository', to: 'role:service' }
            ]
        },
        {
            id: 'api-integrity',
            description: 'API layer should only be accessed by external entrypoints or tests',
            forbidden: [
                { from: 'layer:core', to: 'layer:api' },
                { from: 'layer:data', to: 'layer:api' }
            ]
        },
        {
            id: 'domain-isolation',
            description: 'Prevent direct cross-domain repository access without service mediation',
            forbidden: [
                { from: 'role:repository', to: 'role:repository' }
            ]
        }
    ];

    constructor(private graphEngine: GraphEngine) {}

    /**
     * Checks for architectural violations in the current knowledge graph.
     */
    public async checkViolations(): Promise<ArchitectureViolation[]> {
        const violations: ArchitectureViolation[] = [];
        const edges = this.graphEngine.getAllEdges();

        // 1. Policy-based violations
        for (const edge of edges) {
            // We only care about active dependency edges
            if (!['calls', 'dynamic_calls', 'inherits', 'implements', 'depends_on', 'reads', 'writes'].includes(edge.edge_type)) {
                continue;
            }

            const fromNode = this.graphEngine.getNodeById(edge.from_id);
            const toNode = this.graphEngine.getNodeById(edge.to_id);

            if (!fromNode || !toNode) continue;

            // [Phase 13] Contextual Filtering
            // 1. Ignore calls within the same file
            if (fromNode.file_path === toNode.file_path) continue;

            // 2. Ignore calls within the same class/object (shared prefix before #)
            const fromPrefix = fromNode.qualified_name.split('#')[0];
            const toPrefix = toNode.qualified_name.split('#')[0];
            if (fromPrefix === toPrefix) continue;

            for (const policy of this.policies) {
                // 3. Special handling for domain-isolation
                if (policy.id === 'domain-isolation' && this.hasTag(toNode, 'trait:internal')) {
                    continue;
                }

                for (const rule of policy.forbidden) {
                    if (this.hasTag(fromNode, rule.from) && this.hasTag(toNode, rule.to)) {
                        violations.push({
                            source: fromNode,
                            target: toNode,
                            edge: edge,
                            policyId: policy.id,
                            description: `Illegal relationship: ${rule.from} -> ${rule.to}`
                        });
                    }
                }
            }
        }

        // 2. Custom rule violations
        if (this.customRules !== null) {
            for (const edge of edges) {
                if (!['calls', 'depends_on', 'imports'].includes(edge.edge_type)) {
                    continue;
                }

                const fromNode = this.graphEngine.getNodeById(edge.from_id);
                const toNode = this.graphEngine.getNodeById(edge.to_id);

                if (!fromNode || !toNode) continue;
                if (fromNode.file_path === toNode.file_path) continue;

                for (const rule of this.customRules) {
                    if (rule.allowed) continue;

                    const fromPath = (fromNode.file_path ?? '').replace(/\\/g, '/');
                    const toPath = (toNode.file_path ?? '').replace(/\\/g, '/');

                    const fromSegments = fromPath.split('/');
                    const toSegments = toPath.split('/');

                    if (fromSegments.includes(rule.from) && toSegments.includes(rule.to)) {
                        violations.push({
                            source: fromNode,
                            target: toNode,
                            edge: edge,
                            policyId: `custom:${rule.name}`,
                            description: `Custom rule violation "${rule.name}": ${rule.from} -> ${rule.to} is not allowed`,
                            ...(rule.rationale ? { rationale: rule.rationale } : {})
                        });
                    }
                }
            }
        }

        // 3. Circular Dependency Detection
        // Build an O(1) (from_id, to_id) -> edge index once, replacing the
        // former per-cycle O(E) `edges.find(...)` linear scan. `edges.find`
        // returns the FIRST match, so when multiple edges share the same
        // (from_id, to_id) pair (e.g. differing edge_type) we must preserve
        // the first one — hence the `if (!has)` guard (Map.set is last-wins).
        const edgeByPair = new Map<string, CodeEdge>();
        for (const e of edges) {
            const k = `${e.from_id}:${e.to_id}`;
            if (!edgeByPair.has(k)) edgeByPair.set(k, e);
        }

        const cycles = this.detectCycles();
        for (const cycle of cycles) {
            const source = this.graphEngine.getNodeById(cycle[0]);
            const target = this.graphEngine.getNodeById(cycle[1]);
            if (source && target) {
                // Check if we already reported this cycle to avoid redundancy
                const existing = violations.find(v => v.policyId === 'circular-dependency' && 
                    v.description.includes(source.qualified_name) && v.description.includes(target.qualified_name));
                
                if (!existing) {
                    violations.push({
                        source,
                        target,
                        edge: edgeByPair.get(`${cycle[0]}:${cycle[1]}`)!,
                        policyId: 'circular-dependency',
                        description: `Circular dependency detected: ${cycle.map(id => this.graphEngine.getNodeById(id)?.qualified_name).join(' -> ')} -> ${source.qualified_name}`
                    });
                }
            }
        }

        return violations;
    }

    private detectCycles(): number[][] {
        // Return cached result if fresh (< 60 seconds)
        if (this.cycleCache && (Date.now() - this.cycleCache.timestamp < 60_000)) {
            return this.cycleCache.cycles;
        }

        const cycles: number[][] = [];
        const visited = new Set<number>();
        const allNodes = this.graphEngine.getAllNodes();

        // Iterative DFS replacing the former recursive findCycles.
        // Each stack frame is either an "enter" frame (visit the node) or an
        // "exit" frame (pop the node from recStack after all neighbours are done).
        type Frame =
            | { kind: 'enter'; nodeId: number; path: number[] }
            | { kind: 'exit';  nodeId: number };

        for (const node of allNodes) {
            if (node.id === undefined || visited.has(node.id)) continue;

            const recStack = new Set<number>();
            const stack: Frame[] = [{ kind: 'enter', nodeId: node.id, path: [] }];

            while (stack.length > 0) {
                const frame = stack.pop()!;

                if (frame.kind === 'exit') {
                    recStack.delete(frame.nodeId);
                    continue;
                }

                const { nodeId, path } = frame;

                if (visited.has(nodeId)) {
                    // Node was already fully processed in a previous iteration;
                    // we still need to check recStack for the cycle-detection
                    // path that led here, but since it is visited we just skip.
                    continue;
                }

                visited.add(nodeId);
                recStack.add(nodeId);
                const currentPath = [...path, nodeId];

                // Schedule the exit action so recStack is cleaned up after all
                // descendants of this node have been processed.
                stack.push({ kind: 'exit', nodeId });

                const outgoing = this.graphEngine.getOutgoingEdges(nodeId).filter(e =>
                    ['calls', 'dynamic_calls', 'inherits', 'implements', 'depends_on'].includes(e.edge_type)
                );

                for (const edge of outgoing) {
                    if (!visited.has(edge.to_id)) {
                        stack.push({ kind: 'enter', nodeId: edge.to_id, path: currentPath });
                    } else if (recStack.has(edge.to_id)) {
                        // Cycle found
                        const cycleStartIdx = currentPath.indexOf(edge.to_id);
                        if (cycleStartIdx !== -1) {
                            cycles.push(currentPath.slice(cycleStartIdx));
                        }
                    }
                }
            }
        }

        this.cycleCache = { timestamp: Date.now(), cycles };
        return cycles;
    }

    private hasTag(node: CodeNode, tag: string): boolean {
        if (!node.tags) return false;
        const lowerTag = tag.toLowerCase();
        return node.tags.some(t => t.toLowerCase() === lowerTag);
    }

    /**
     * Loads custom layer rules from a JSON file.
     * Throws if the file contains invalid JSON or is not an array.
     */
    public loadRules(rulesPath: string): void {
        let raw: string;
        try {
            raw = fs.readFileSync(rulesPath, 'utf-8');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`arch-rules.json: failed to read file at '${rulesPath}': ${msg}`);
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`arch-rules.json: invalid JSON in '${rulesPath}': ${msg}`);
        }

        if (!Array.isArray(parsed)) {
            throw new Error(`arch-rules.json: expected a JSON array in '${rulesPath}', got ${typeof parsed}`);
        }

        this.customRules = parsed as ArchRule[];
    }

    /**
     * Returns true if custom rules have been loaded.
     */
    public get hasCustomRules(): boolean {
        return this.customRules !== null;
    }

    /**
     * Adds a custom policy.
     */
    public addPolicy(policy: ArchitecturePolicy): void {
        this.policies.push(policy);
    }

    // -----------------------------------------------------------------------
    // P6 — Architecture Intent Model
    // -----------------------------------------------------------------------

    /**
     * Returns the underlying SQLite handle via the graph engine's node repo.
     * Mirrors the access pattern used in get-symbol-details / project overview.
     */
    private getDb() {
        return this.graphEngine.nodeRepo.getDb();
    }

    /**
     * Validates that a parsed value is a structurally-sound ArchitectureIntent.
     * Throws a descriptive error otherwise.
     */
    private validateIntent(parsed: unknown): ArchitectureIntent {
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`cynapx.architecture.json: expected a JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`);
        }
        const obj = parsed as Record<string, unknown>;

        if (!Array.isArray(obj.layers)) {
            throw new Error("cynapx.architecture.json: 'layers' must be an array of LayerDef");
        }
        for (const layer of obj.layers) {
            if (layer === null || typeof layer !== 'object' || Array.isArray(layer)) {
                throw new Error("cynapx.architecture.json: each layer must be an object with 'name' and 'pathPattern'");
            }
            const l = layer as Record<string, unknown>;
            if (typeof l.name !== 'string' || typeof l.pathPattern !== 'string') {
                throw new Error("cynapx.architecture.json: each layer requires string 'name' and 'pathPattern' fields");
            }
        }

        if (!Array.isArray(obj.rules)) {
            throw new Error("cynapx.architecture.json: 'rules' must be an array of ArchRule");
        }
        for (const rule of obj.rules) {
            if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
                throw new Error("cynapx.architecture.json: each rule must be an object");
            }
            const r = rule as Record<string, unknown>;
            if (typeof r.name !== 'string' || typeof r.from !== 'string' || typeof r.to !== 'string' || typeof r.allowed !== 'boolean') {
                throw new Error("cynapx.architecture.json: each rule requires 'name', 'from', 'to' (strings) and 'allowed' (boolean)");
            }
        }

        if (obj.responsibilities === undefined || obj.responsibilities === null ||
            typeof obj.responsibilities !== 'object' || Array.isArray(obj.responsibilities)) {
            throw new Error("cynapx.architecture.json: 'responsibilities' must be an object mapping layer names to descriptions");
        }

        return {
            layers: obj.layers as LayerDef[],
            rules: obj.rules as ArchRule[],
            responsibilities: obj.responsibilities as Record<string, string>,
        };
    }

    /**
     * Loads architecture intent from cynapx.architecture.json, validates it,
     * persists it into the singleton architecture_intent table (upsert id=1),
     * and merges its rules into the engine's active custom rules.
     * Throws if the file is missing, malformed, or structurally invalid.
     */
    public loadIntent(intentPath: string): ArchitectureIntent {
        let raw: string;
        try {
            raw = fs.readFileSync(intentPath, 'utf-8');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`cynapx.architecture.json: failed to read file at '${intentPath}': ${msg}`);
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`cynapx.architecture.json: invalid JSON in '${intentPath}': ${msg}`);
        }

        const intent = this.validateIntent(parsed);

        // Persist (upsert singleton row id = 1)
        const db = this.getDb();
        db.prepare(`
            INSERT INTO architecture_intent (id, layers, rules, responsibilities)
            VALUES (1, @layers, @rules, @responsibilities)
            ON CONFLICT(id) DO UPDATE SET
                layers = excluded.layers,
                rules = excluded.rules,
                responsibilities = excluded.responsibilities
        `).run({
            layers: JSON.stringify(intent.layers),
            rules: JSON.stringify(intent.rules),
            responsibilities: JSON.stringify(intent.responsibilities),
        });

        // Merge declared rules into active custom rules.
        const merged = [...(this.customRules ?? [])];
        for (const rule of intent.rules) {
            if (!merged.some(r => r.name === rule.name)) {
                merged.push(rule);
            }
        }
        this.customRules = merged;

        return intent;
    }

    /**
     * Reads the stored architecture intent from the database.
     * Returns null when no intent has been declared.
     */
    public getIntent(): ArchitectureIntent | null {
        const db = this.getDb();
        const row = db.prepare(
            'SELECT layers, rules, responsibilities FROM architecture_intent WHERE id = 1'
        ).get() as { layers: string | null; rules: string | null; responsibilities: string | null } | undefined;

        if (!row) return null;

        return {
            layers: row.layers ? JSON.parse(row.layers) as LayerDef[] : [],
            rules: row.rules ? JSON.parse(row.rules) as ArchRule[] : [],
            responsibilities: row.responsibilities ? JSON.parse(row.responsibilities) as Record<string, string> : {},
        };
    }

    /**
     * Counts how many nodes match a layer's pathPattern. The pattern is treated
     * as a regular expression against the (normalized) file path; if it is not a
     * valid regex it falls back to a simple substring match.
     */
    private countNodesForLayer(layer: LayerDef, nodes: CodeNode[]): number {
        let matcher: (filePath: string) => boolean;
        try {
            const re = new RegExp(layer.pathPattern);
            matcher = (fp) => re.test(fp);
        } catch {
            matcher = (fp) => fp.includes(layer.pathPattern);
        }
        let count = 0;
        for (const node of nodes) {
            const fp = (node.file_path ?? '').replace(/\\/g, '/');
            if (fp && matcher(fp)) count++;
        }
        return count;
    }

    /**
     * Compares the declared architecture intent against the actual graph,
     * producing a drift report: per-layer node counts, unmapped (empty) layers,
     * rule health (violated vs healthy), and emergent patterns discovered
     * statistically that were not declared.
     *
     * @param discoverer Optional PolicyDiscoverer; one is constructed from the
     *                   graph engine when not supplied.
     */
    public async compareIntentVsReality(discoverer?: PolicyDiscoverer): Promise<DriftReport> {
        const intent = this.getIntent();
        if (!intent) {
            return { declaredLayers: [], unmappedLayers: [], ruleHealth: [], emergentPatterns: [] };
        }

        const nodes = this.graphEngine.getAllNodes();

        // 1. Layer mapping
        const declaredLayers: DriftReport['declaredLayers'] = [];
        const unmappedLayers: string[] = [];
        for (const layer of intent.layers) {
            const nodeCount = this.countNodesForLayer(layer, nodes);
            declaredLayers.push({ name: layer.name, nodeCount, description: layer.description });
            if (nodeCount === 0) {
                unmappedLayers.push(layer.name);
            }
        }

        // 2. Rule health: count violations attributable to each declared rule.
        const violations = await this.checkViolations();
        const ruleHealth: DriftReport['ruleHealth'] = intent.rules.map(rule => {
            const violationCount = violations.filter(v => v.policyId === `custom:${rule.name}`).length;
            return {
                rule,
                violationCount,
                status: violationCount > 0 ? 'violated' : 'healthy',
            };
        });

        // 3. Emergent patterns: discovered policies that are not represented by a
        // declared rule (drift between intended and statistically-observed design).
        const disc = discoverer ?? new PolicyDiscoverer(this.graphEngine);
        const latent = await disc.discoverPolicies();
        const declaredPairs = new Set(
            intent.rules.map(r => `${r.from.toLowerCase()}->${r.to.toLowerCase()}`)
        );
        const emergentPatterns = latent.filter(p => {
            const fromLayer = p.fromTag.replace(/^layer:/i, '').toLowerCase();
            const toLayer = p.toTag.replace(/^layer:/i, '').toLowerCase();
            return !declaredPairs.has(`${fromLayer}->${toLayer}`);
        });

        return { declaredLayers, unmappedLayers, ruleHealth, emergentPatterns };
    }
}
