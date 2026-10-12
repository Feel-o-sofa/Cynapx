// Availability soak + fault-injection probe against a running Cynapx API server.
// Usage: KNOWLEDGE_TOOL_TOKEN=<token> node scripts/availability-probe.mjs <fixture-project-dir>
// See docs/availability-verification.md for the methodology and reference results.
// Measures: healthz continuity, valid-request success rate, fault-handling
// correctness (4xx not 5xx/conn-error), process survival under file churn.
import * as fs from 'fs';
import * as path from 'path';

const BASE = process.env.CYNAPX_PROBE_BASE ?? 'http://127.0.0.1:3777';
const TOKEN = process.env.KNOWLEDGE_TOOL_TOKEN ?? '';
const FIXTURE = process.argv[2];
const SOAK_MS = 90_000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const stats = {
    healthz: { ok: 0, bad: 0, connErr: 0, latencies: [] },
    valid: { ok: 0, throttled: 0, bad: 0, connErr: 0, latencies: [] },
    faults: { correct: 0, wrong5xx: 0, connErr: 0, detail: {} },
    churn: { writes: 0 },
};

async function timedFetch(url, opts) {
    const t0 = performance.now();
    const res = await fetch(url, opts);
    return { res, ms: performance.now() - t0 };
}

// Wait for the rate-limit window to reset so the soak starts with a clean budget.
if (!process.env.SKIP_WAIT) { console.log('[probe] waiting 62s for fresh window...'); await sleep(62_000); }

const tEnd = Date.now() + SOAK_MS;

// --- healthz prober: every 250ms for the whole soak ---
const healthzLoop = (async () => {
    while (Date.now() < tEnd) {
        try {
            const { res, ms } = await timedFetch(`${BASE}/healthz`);
            stats.healthz.latencies.push(ms);
            if (res.status === 200) stats.healthz.ok++; else stats.healthz.bad++;
        } catch { stats.healthz.connErr++; }
        await sleep(250);
    }
})();

// --- valid traffic: ~1 req/s (60/min, within the 100/min budget incl. faults) ---
const validBodies = [
    ['/api/search/symbols', { query: 'add' }],
    ['/api/symbol/get', { qualified_name: 'src/calc.ts#add' }],
    ['/api/graph/callers', { qualified_name: 'src/calc.ts#add' }],
];
const validLoop = (async () => {
    let i = 0;
    while (Date.now() < tEnd) {
        const [route, body] = validBodies[i++ % validBodies.length];
        try {
            const { res, ms } = await timedFetch(`${BASE}${route}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            stats.valid.latencies.push(ms);
            if (res.status === 429) stats.valid.throttled++;
            else if (res.status >= 200 && res.status < 500) stats.valid.ok++; // 404 "not found" is a correct answer
            else stats.valid.bad++;
        } catch { stats.valid.connErr++; }
        await sleep(1000);
    }
})();

// --- fault injection: ~1 fault every 3s (20/min) ---
const faults = [
    ['malformed-json', () => fetch(`${BASE}/api/symbol/get`, { method: 'POST', headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: '{"qualified_name": ' })],
    ['oversized-body', () => fetch(`${BASE}/api/symbol/get`, { method: 'POST', headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ qualified_name: 'x'.repeat(1_200_000) }) })],
    ['bad-auth', () => fetch(`${BASE}/api/symbol/get`, { method: 'POST', headers: { 'Authorization': 'Bearer wrong-token', 'Content-Type': 'application/json' }, body: '{"qualified_name":"x"}' })],
    ['unknown-route', () => fetch(`${BASE}/api/does/not/exist`, { method: 'POST', headers: { 'Authorization': `Bearer ${TOKEN}` } })],
    ['wrong-method', () => fetch(`${BASE}/api/symbol/get`, { method: 'GET', headers: { 'Authorization': `Bearer ${TOKEN}` } })],
    ['type-confusion', () => fetch(`${BASE}/api/search/symbols`, { method: 'POST', headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: { $ne: null } }) })],
];
const faultLoop = (async () => {
    let i = 0;
    while (Date.now() < tEnd) {
        const [name, fire] = faults[i++ % faults.length];
        stats.faults.detail[name] ??= { correct: 0, wrong: 0 };
        try {
            const res = await fire();
            if (res.status >= 400 && res.status < 500) { stats.faults.correct++; stats.faults.detail[name].correct++; }
            else { stats.faults.wrong5xx++; stats.faults.detail[name].wrong++; stats.faults.detail[name].lastStatus = res.status; }
        } catch (e) { stats.faults.connErr++; stats.faults.detail[name].wrong++; stats.faults.detail[name].lastErr = String(e); }
        await sleep(3000);
    }
})();

// --- file churn: modify/add-broken/delete source files during the soak ---
const churnLoop = (async () => {
    const churnFile = path.join(FIXTURE, 'src', 'churn.ts');
    const brokenFile = path.join(FIXTURE, 'src', 'broken.ts');
    let n = 0;
    while (Date.now() < tEnd) {
        fs.writeFileSync(churnFile, `export function churn${n}(): number { return ${n}; }\n`);
        fs.writeFileSync(brokenFile, `export function broken( {{{ ~~~ %%% not valid at all ${n}\n`);
        stats.churn.writes += 2;
        n++;
        await sleep(5000);
        if (n % 3 === 0) { try { fs.unlinkSync(brokenFile); } catch {} }
    }
})();

await Promise.all([healthzLoop, validLoop, faultLoop, churnLoop]);

const pct = (arr, p) => arr.length ? arr.sort((a, b) => a - b)[Math.floor(arr.length * p)] : null;
const summary = {
    soakSeconds: SOAK_MS / 1000,
    healthz: {
        total: stats.healthz.ok + stats.healthz.bad + stats.healthz.connErr,
        ok: stats.healthz.ok, non200: stats.healthz.bad, connErr: stats.healthz.connErr,
        availabilityPct: (100 * stats.healthz.ok / (stats.healthz.ok + stats.healthz.bad + stats.healthz.connErr)).toFixed(3),
        p50ms: pct(stats.healthz.latencies, 0.5)?.toFixed(1), p99ms: pct(stats.healthz.latencies, 0.99)?.toFixed(1),
    },
    validTraffic: {
        total: stats.valid.ok + stats.valid.throttled + stats.valid.bad + stats.valid.connErr,
        ok: stats.valid.ok, throttled429: stats.valid.throttled, serverErr5xx: stats.valid.bad, connErr: stats.valid.connErr,
        successPct: (100 * stats.valid.ok / Math.max(1, stats.valid.ok + stats.valid.bad + stats.valid.connErr)).toFixed(3),
        p50ms: pct(stats.valid.latencies, 0.5)?.toFixed(1), p99ms: pct(stats.valid.latencies, 0.99)?.toFixed(1),
    },
    faultInjection: {
        total: stats.faults.correct + stats.faults.wrong5xx + stats.faults.connErr,
        handledAs4xx: stats.faults.correct, leaked5xxOrOther: stats.faults.wrong5xx, connErr: stats.faults.connErr,
        detail: stats.faults.detail,
    },
    fileChurnWrites: stats.churn.writes,
};
console.log(JSON.stringify(summary, null, 2));
