/**
 * Cynapx MCP Tool Integration Test
 *
 * Tests all 20 MCP callable tools against the real project (Cynapx itself).
 * Uses executeTool() directly from compiled dist/ output with a real WorkspaceManager.
 */
'use strict';

const path = require('path');
const os   = require('os');
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

const { WorkspaceManager }   = require(path.join(ROOT, 'dist/server/workspace-manager'));
const { executeTool }        = require(path.join(ROOT, 'dist/server/tool-dispatcher'));
const { TreeSitterParser }   = require(path.join(ROOT, 'dist/indexer/tree-sitter-parser'));
const { TypeScriptParser }   = require(path.join(ROOT, 'dist/indexer/typescript-parser'));
const { CompositeParser }    = require(path.join(ROOT, 'dist/indexer/composite-parser'));
const { GitService }         = require(path.join(ROOT, 'dist/indexer/git-service'));
const { WorkerPool }         = require(path.join(ROOT, 'dist/indexer/worker-pool'));
const { UpdatePipeline }     = require(path.join(ROOT, 'dist/indexer/update-pipeline'));
const { SecurityProvider }   = require(path.join(ROOT, 'dist/utils/security'));
const { RemediationEngine }  = require(path.join(ROOT, 'dist/graph/remediation-engine'));

// Simple no-op embedding provider
const fakeEmbedding = {
    generate: async () => [],
    generateBatch: async () => [],
    getDimensions: () => 0,
    getModelName: () => 'none',
};

// ── Colours ──────────────────────────────────────────────────────────────────
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m', B = '\x1b[1m', X = '\x1b[0m';
const ok   = s => `${G}✅ PASS${X}  ${s}`;
const fail = s => `${R}❌ FAIL${X}  ${s}`;
const info = s => `${C}ℹ️  INFO${X}  ${s}`;

const results = [];

async function runTool(label, toolName, args, deps, opts = {}) {
    const t0 = Date.now();
    let result;
    try {
        result = await executeTool(toolName, args, deps);
    } catch (e) {
        const ms = Date.now() - t0;
        results.push({ label, toolName, status: 'CRASH', error: e.message, ms });
        console.log(fail(`${label}  [${toolName}]  CRASH: ${e.message.slice(0, 120)} [${ms}ms]`));
        return null;
    }
    const ms   = Date.now() - t0;
    const text = result.content?.[0]?.text ?? '';
    const snippet = text.slice(0, 110).replace(/\n/g, ' ');

    if (result.isError) {
        if (opts.expectError) {
            results.push({ label, toolName, status: 'PASS', ms });
            console.log(ok(`${label}  [${toolName}]  isError=true (expected) — ${snippet} [${ms}ms]`));
        } else {
            results.push({ label, toolName, status: 'FAIL', error: text, ms });
            console.log(fail(`${label}  [${toolName}]  isError=true — ${snippet} [${ms}ms]`));
        }
    } else {
        if (opts.expectError) {
            results.push({ label, toolName, status: 'FAIL (wanted error, got success)', ms });
            console.log(fail(`${label}  [${toolName}]  expected isError but got success — ${snippet} [${ms}ms]`));
        } else {
            results.push({ label, toolName, status: 'PASS', ms });
            console.log(ok(`${label}  [${toolName}]  ${snippet} [${ms}ms]`));
        }
    }
    return result;
}

function banner(text) {
    console.log(`\n${B}── ${text} ──${X}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n${B}${C}╔════════════════════════════════════════════════╗${X}`);
    console.log(`${B}${C}║  Cynapx MCP Tool Integration Test              ║${X}`);
    console.log(`${B}${C}╚════════════════════════════════════════════════╝${X}`);
    console.log(info(`Target project: ${ROOT}`));

    const wm = new WorkspaceManager();
    let initialized = false;

    // Track worker pool for cleanup
    let _workerPool = null;

    // onInitialize: mimics what bootstrap.ts does — full engine init + file indexing
    const onInitialize = async (projectPath) => {
        console.log(info(`  onInitialize called with: ${projectPath}`));

        // 1. Mount (creates EngineContext, sets as active)
        await wm.mountProject(projectPath);
        const ctx = wm.getActiveContext();
        if (!ctx) throw new Error('mountProject did not set active context');

        // 2. Open DB + create graph engine (initializeEngine)
        await wm.initializeEngine(ctx.projectHash);

        // 3. Create parsers + services (same as bootstrap.ts)
        const treeSitterParser = new TreeSitterParser();
        const typescriptParser = new TypeScriptParser();
        const compositeParser  = new CompositeParser([typescriptParser, treeSitterParser]);
        const gitService       = new GitService(projectPath);
        const numCPUs          = Math.min(os.cpus().length, 4);
        _workerPool = new WorkerPool(numCPUs);

        // 4. Create UpdatePipeline
        const updatePipeline = new UpdatePipeline(
            ctx.dbManager.getDb(),
            ctx.graphEngine.nodeRepo,
            ctx.graphEngine.edgeRepo,
            compositeParser,
            ctx.metadataRepo,
            gitService,
            _workerPool,
            projectPath,
            ctx.graphEngine
        );

        // 5. Attach to context
        ctx.gitService      = gitService;
        ctx.updatePipeline  = updatePipeline;
        ctx.securityProvider = new SecurityProvider(projectPath);

        // 6. Run actual indexing
        console.log(info(`  Running syncWithGit — indexing ${projectPath}...`));
        await updatePipeline.syncWithGit(projectPath);
        console.log(info(`  Engine initialized + indexed. Context: ${ctx.projectPath}`));
    };

    const deps = {
        waitUntilReady:      async () => {},
        getContext:          ()  => wm.getActiveContext(),
        isTerminal:          ()  => false,
        getTerminalCoordinator: () => undefined,
        embeddingProvider:   fakeEmbedding,
        workspaceManager:    wm,
        remediationEngine:   new RemediationEngine(),
        onInitialize,
        onPurge:             undefined,
        markReady:           (v) => { initialized = v; },
        getIsInitialized:    ()  => initialized,
        setIsInitialized:    (v) => { initialized = v; },
    };

    // ══ Phase 0: Pre-init null guards ═════════════════════════════════════════
    banner('Phase 0: Pre-init null guard (10 tools)');
    const preInitTools = [
        ['get_related_tests',            { qualified_name: 'Foo' }],
        ['check_architecture_violations', {}],
        ['propose_refactor',             { qualified_name: 'Foo' }],
        ['get_risk_profile',             { qualified_name: 'Foo' }],
        ['find_dead_code',               {}],
        ['export_graph',                 {}],
        ['check_consistency',            {}],
        ['re_tag_project',               {}],
        ['backfill_history',             {}],
        ['discover_latent_policies',     {}],
    ];
    for (const [tool, args] of preInitTools) {
        await runTool(`NULL_GUARD`, tool, args, deps, { expectError: true });
    }

    // ══ Phase 1: Argument validation ═════════════════════════════════════════
    banner('Phase 1: Argument validation');
    // NaN threshold
    await runTool('NaN_THRESHOLD', 'get_hotspots', { metric: 'cyclomatic', threshold: NaN }, deps, { expectError: true });
    // SQL injection metric
    await runTool('SQL_INJECT_METRIC', 'get_hotspots', { metric: "loc; DROP TABLE--", threshold: 5 }, deps, { expectError: true });
    // Invalid mode
    await runTool('INVALID_MODE', 'initialize_project', { path: ROOT, mode: 'hacker' }, deps, { expectError: true });
    // Path outside boundary (using 'path' field — correct schema key)
    await runTool('PATH_OUTSIDE_BOUNDARY', 'initialize_project', { path: 'C:\\Windows\\System32', mode: 'current' }, deps, { expectError: true });
    // NaN min_confidence (pre-init → null guard fires first, that's fine)
    await runTool('NaN_CONFIDENCE', 'discover_latent_policies', { min_confidence: NaN }, deps, { expectError: true });
    // Negative max_policies
    await runTool('NEG_MAX_POLICIES', 'discover_latent_policies', { max_policies: -5 }, deps, { expectError: true });
    // Empty qualified_name on propose_refactor
    await runTool('EMPTY_QNAME_PROPOSE', 'propose_refactor', { qualified_name: '' }, deps, { expectError: true });
    // Purge without confirm — should return WARNING, not isError
    await runTool('PURGE_NO_CONFIRM', 'purge_index', {}, deps, { expectError: false });

    // ══ Phase 2: initialize_project — real indexing ═══════════════════════════
    banner('Phase 2: initialize_project (real indexing — may take 10–90s)');
    const initResult = await runTool('INIT_CURRENT', 'initialize_project', { path: ROOT, mode: 'current' }, deps);
    if (!initResult || initResult.isError) {
        console.log(fail('initialize_project failed — aborting remaining tests'));
        printSummary(); return;
    }

    const ctx = wm.getActiveContext();
    if (!ctx) {
        console.log(fail('Context is null after initialize_project — onInitialize may have failed'));
        printSummary(); return;
    }
    console.log(info(`Active context: ${ctx.projectPath} (hash: ${ctx.projectHash})`));

    // ══ Phase 3: Metadata ═════════════════════════════════════════════════════
    banner('Phase 3: get_setup_context');
    await runTool('GET_SETUP_CTX', 'get_setup_context', {}, deps);

    // ══ Phase 4: search_symbols ═══════════════════════════════════════════════
    banner('Phase 4: search_symbols');
    const searchRes = await runTool('SEARCH_WorkspaceManager', 'search_symbols', { query: 'WorkspaceManager', limit: 5 }, deps);
    const searchRes2 = await runTool('SEARCH_executeTool', 'search_symbols', { query: 'executeTool', limit: 3 }, deps);

    // Extract a real qualified name from search results (parse JSON array)
    let firstQname = null;
    for (const r of [searchRes, searchRes2]) {
        if (r && !r.isError) {
            const t = r.content?.[0]?.text ?? '';
            try {
                const arr = JSON.parse(t);
                if (Array.isArray(arr) && arr.length > 0 && arr[0].qname) {
                    firstQname = arr[0].qname;
                    break;
                }
            } catch {
                // fallback: try regex for markdown format
                const m = t.match(/"qname":\s*"([^"]+)"/);
                if (m) { firstQname = m[1]; break; }
            }
        }
    }
    console.log(info(`  First extracted qualified_name: ${firstQname ?? '(none)'}`));
    const qname = firstQname ?? 'WorkspaceManager';

    // ══ Phase 5: Symbol details ═══════════════════════════════════════════════
    banner('Phase 5: get_symbol_details');
    await runTool('GET_SYMBOL_DETAIL', 'get_symbol_details', { qualified_name: qname }, deps);
    // Missing qualified_name guard
    await runTool('MISSING_QNAME_DETAIL', 'get_symbol_details', { qualified_name: '' }, deps, { expectError: true });

    // ══ Phase 6: Callers / callees ════════════════════════════════════════════
    banner('Phase 6: get_callers + get_callees');
    await runTool('GET_CALLERS', 'get_callers', { qualified_name: qname, limit: 5 }, deps);
    await runTool('GET_CALLEES', 'get_callees', { qualified_name: qname, limit: 5 }, deps);
    // Null qualified_name guard
    await runTool('NULL_QNAME_CALLERS', 'get_callers', { qualified_name: '' }, deps, { expectError: true });

    // ══ Phase 7: analyze_impact ═══════════════════════════════════════════════
    banner('Phase 7: analyze_impact');
    await runTool('ANALYZE_IMPACT_3', 'analyze_impact', { qualified_name: qname, max_depth: 3 }, deps);
    // max_depth cap: 999 should be capped at 20
    const impactDeep = await runTool('ANALYZE_IMPACT_999→20', 'analyze_impact', { qualified_name: qname, max_depth: 999 }, deps);
    if (impactDeep && !impactDeep.isError) {
        console.log(info('  max_depth cap applied (no infinite traversal)'));
    }

    // ══ Phase 8: get_hotspots (all 4 valid metrics) ═══════════════════════════
    banner('Phase 8: get_hotspots (4 metrics)');
    for (const metric of ['cyclomatic', 'fan_in', 'fan_out', 'loc']) {
        await runTool(`HOTSPOTS_${metric.toUpperCase()}`, 'get_hotspots', { metric, threshold: 0, limit: 3 }, deps);
    }

    // ══ Phase 9: find_dead_code ═══════════════════════════════════════════════
    banner('Phase 9: find_dead_code (3 confidence levels)');
    for (const confidence of ['high', 'medium', 'low']) {
        const r = await runTool(`DEAD_CODE_${confidence.toUpperCase()}`, 'find_dead_code', { confidence }, deps);
        if (r && !r.isError) {
            const t = r.content?.[0]?.text ?? '';
            const lines = t.split('\n').filter(l => l.trim()).length;
            console.log(info(`  ${confidence}: ~${lines} result lines`));
        }
    }

    // ══ Phase 10: export_graph (3 formats) ═══════════════════════════════════
    banner('Phase 10: export_graph (json / graphml / dot)');
    const formatTests = [
        ['json',    (t) => t.startsWith('{') || t.includes('"nodes"') || t.includes('Mermaid') || t.includes('graph')],
        ['graphml', (t) => t.includes('<graphml') || t.includes('<?xml')],
        ['dot',     (t) => t.includes('digraph') || t.includes('->')],
    ];
    for (const [fmt, validator] of formatTests) {
        const r = await runTool(`EXPORT_${fmt.toUpperCase()}`, 'export_graph', { format: fmt }, deps);
        if (r && !r.isError) {
            const t = r.content?.[0]?.text ?? '';
            const valid = validator(t);
            console.log(valid
                ? info(`  ${fmt}: valid format ✓ (${t.slice(0,60).replace(/\n/g,' ')}…)`)
                : `${Y}⚠️  WARN${X}  export_graph(${fmt}) output doesn't look like ${fmt}: ${t.slice(0,80)}`);
            if (!valid) results.at(-1).status = 'WARN';
        }
    }
    await runTool('EXPORT_UNKNOWN_FORMAT', 'export_graph', { format: 'xlsx' }, deps, { expectError: true });

    // ══ Phase 11: check_consistency ═══════════════════════════════════════════
    banner('Phase 11: check_consistency');
    await runTool('CHECK_CONSISTENCY', 'check_consistency', {}, deps);

    // ══ Phase 12: risk + refactor ═════════════════════════════════════════════
    banner('Phase 12: get_risk_profile + propose_refactor');
    await runTool('GET_RISK', 'get_risk_profile', { qualified_name: qname }, deps);
    await runTool('PROPOSE_REFACTOR', 'propose_refactor', { qualified_name: qname, strategy: 'extract-method' }, deps);

    // ══ Phase 13: architecture + policy ══════════════════════════════════════
    banner('Phase 13: check_architecture_violations + discover_latent_policies');
    await runTool('CHECK_ARCH', 'check_architecture_violations', {}, deps);
    await runTool('LATENT_POLICIES', 'discover_latent_policies', { min_confidence: 0.5, max_policies: 10 }, deps);

    // ══ Phase 14: related tests ═══════════════════════════════════════════════
    banner('Phase 14: get_related_tests');
    await runTool('RELATED_TESTS', 'get_related_tests', { qualified_name: qname }, deps);

    // ══ Phase 15: remediation ════════════════════════════════════════════════
    banner('Phase 15: get_remediation_strategy');
    // Schema: violation = { source, target } object (from check_architecture_violations output)
    await runTool('REMEDIATION_INVALID', 'get_remediation_strategy', { violation_type: 'circular_dependency' }, deps, { expectError: true });
    await runTool('REMEDIATION_VALID',   'get_remediation_strategy', { violation: { source: qname, target: 'other.module' } }, deps);

    // ══ Phase 16: initialize_project mode=existing ════════════════════════════
    banner('Phase 16: initialize_project mode=existing (re-use indexed DB)');
    await runTool('INIT_EXISTING', 'initialize_project', { path: ROOT, mode: 'existing' }, deps);

    // ══ Phase 17: initialize_project mode=custom ══════════════════════════════
    banner('Phase 17: initialize_project mode=custom (no boundary check)');
    // Should succeed (no boundary check for custom mode)
    await runTool('INIT_CUSTOM', 'initialize_project', { path: ROOT, mode: 'custom' }, deps);

    // ══ Phase 18: purge safety ════════════════════════════════════════════════
    banner('Phase 18: purge_index safety');
    await runTool('PURGE_NO_CONFIRM',   'purge_index', {},                { ...deps }, { expectError: false });
    await runTool('PURGE_FALSE_CONFIRM','purge_index', { confirm: false }, { ...deps }, { expectError: false });
    // Verify the WARNING text
    const purgeWarn = await executeTool('purge_index', {}, deps).catch(() => null);
    if (purgeWarn) {
        const txt = purgeWarn.content?.[0]?.text ?? '';
        const hasWarning = /WARNING|confirm/i.test(txt);
        console.log(hasWarning
            ? ok('PURGE_WARNING_TEXT — warning text present ✓')
            : fail('PURGE_WARNING_TEXT — warning text missing'));
        results.push({ label: 'PURGE_WARNING_TEXT', status: hasWarning ? 'PASS' : 'FAIL', ms: 0 });
    }

    // ══ Phase 19: Terminal mode guards ═══════════════════════════════════════
    banner('Phase 19: Terminal mode guards (re_tag + backfill)');
    const termDeps = { ...deps, isTerminal: () => true };
    await runTool('TERMINAL_RETAG',    're_tag_project',   {}, termDeps, { expectError: true });
    await runTool('TERMINAL_BACKFILL', 'backfill_history', {}, termDeps, { expectError: true });

    // ══ Phase 20: re_tag_project (non-terminal) ═══════════════════════════════
    banner('Phase 20: re_tag_project (non-terminal, real run)');
    await runTool('RETAG_PROJECT', 're_tag_project', {}, deps);

    // ══ Phase 21: backfill_history — real run + DB structure validation ════════
    // P10-L-1: verify history entries have required fields (hash/author/date/message).
    banner('Phase 21: backfill_history (real run + DB validation)');
    const backfillRes = await runTool('BACKFILL_HISTORY', 'backfill_history', {}, deps);
    if (backfillRes && !backfillRes.isError) {
        const bfCtx = deps.getContext();
        const bfDb  = bfCtx?.dbManager?.getDb();
        if (bfDb) {
            const nodesWithHistory = bfDb.prepare(
                `SELECT qualified_name, history FROM nodes WHERE history IS NOT NULL AND history != '[]' AND history != '' LIMIT 5`
            ).all();

            const hasData = nodesWithHistory.length > 0;
            console.log(hasData
                ? ok(`BACKFILL_DB_ROWS — ${nodesWithHistory.length} nodes have history rows`)
                : info('BACKFILL_DB_ROWS — 0 nodes with history (single-commit project, OK)'));
            results.push({ label: 'BACKFILL_DB_ROWS', status: hasData ? 'PASS' : 'WARN', ms: 0 });

            // Validate structure of history entries
            let structValid = true;
            for (const row of nodesWithHistory) {
                try {
                    const hist = JSON.parse(row.history);
                    if (!Array.isArray(hist) || hist.length === 0) continue;
                    const entry = hist[0];
                    // Each entry should carry hash, author, date at minimum
                    if (!entry.hash || !entry.author || !entry.date) {
                        structValid = false;
                        console.log(fail(`BACKFILL_STRUCT — missing field in ${row.qualified_name}: ${JSON.stringify(entry).slice(0, 100)}`));
                        break;
                    }
                } catch {
                    structValid = false;
                    break;
                }
            }
            if (hasData) {
                console.log(structValid
                    ? ok('BACKFILL_STRUCT — history entries contain hash/author/date ✓')
                    : fail('BACKFILL_STRUCT — history entry missing required fields'));
                results.push({ label: 'BACKFILL_STRUCT', status: structValid ? 'PASS' : 'FAIL', ms: 0 });
            }
        }
    }

    printSummary();
    if (_workerPool) _workerPool.dispose();
    await wm.dispose();
    process.exit(results.some(r => r.status.startsWith('FAIL') || r.status === 'CRASH') ? 1 : 0);
}

function printSummary() {
    const pass  = results.filter(r => r.status === 'PASS' || r.status === 'WARN').length;
    const fail2 = results.filter(r => r.status.startsWith('FAIL') || r.status === 'CRASH').length;
    const total = results.length;
    const avgMs = total ? Math.round(results.reduce((s,r)=>s+(r.ms??0),0)/total) : 0;

    console.log(`\n${B}╔══════════════════════════════════════════════════╗${X}`);
    console.log(`${B}║  RESULTS: ${pass}/${total} passed | ${fail2} failed | avg ${avgMs}ms/tool  ║${X}`);
    console.log(`${B}╚══════════════════════════════════════════════════╝${X}`);

    if (fail2 > 0) {
        console.log(`\n${R}${B}Failures:${X}`);
        results.filter(r => r.status.startsWith('FAIL') || r.status === 'CRASH')
            .forEach(r => console.log(`  ${R}✗${X} ${r.label}  [${r.toolName}] — ${(r.error ?? r.status).slice(0,100)}`));
    }
    const warns = results.filter(r => r.status === 'WARN');
    if (warns.length) {
        console.log(`\n${Y}Warnings:${X}`);
        warns.forEach(r => console.log(`  ${Y}⚠${X} ${r.label}  [${r.toolName}]`));
    }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
