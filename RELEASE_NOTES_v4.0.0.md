# Cynapx v4.0.0 — Complement the Agent, Don't Compete With It

> **Vision:** Make Cynapx the *true* knowledge base for AI-driven development — so that AI agents can **always get exact context** on whatever they are involved in.

Frontier AI agents now locate and read code faster and more accurately than an index can serve it. Cynapx v4.0.0 refocuses on what such an agent **cannot** do on its own, and stops competing with what it already does well.

> **Upgrading and want the v3 behavior back?** Set `CYNAPX_TOOL_PROFILE=full` in your MCP server's `env` block. All 27 tools and the embedding sidecar return. Nothing was deleted.

---

## 🎚️ Tool Profiles (Breaking: new default)

`CYNAPX_TOOL_PROFILE` selects the toolset for each server process:

| Profile | Tools | Embeddings without `CYNAPX_EMBED_PROVIDER` | Intended for |
|---|---|---|---|
| `frontier` (**new default**) | 21 | Off | Frontier-class agents (Claude, Codex, …) |
| `full` | 27 | Jina sidecar | Smaller local models |

**What `frontier` keeps** — the capabilities an agent lacks:

- **Cross-session memory**: `add_annotation`, `get_annotations`
- **Time**: `get_symbol_history`, `get_recent_changes`, `backfill_history`
- **Declared intent**: `get_architecture`, `check_architecture_violations`
- **Reverse relationships at scale**: `get_callers`, `get_callees`, `analyze_impact`, `get_related_tests`
- **Deterministic metrics**: `get_hotspots`, `get_risk_profile`, `find_dead_code`, `get_project_overview`

**What `frontier` hides** (code and tests intact): `find_similar_symbols`, `propose_refactor`, `discover_latent_policies`, `export_graph`, `re_tag_project`, `get_remediation_strategy`, and the `find-similar` prompt. For these, a frontier agent's own reading and reasoning is now the better tool.

How it behaves:

- Calling a hidden tool returns an error result that names the fix (`CYNAPX_TOOL_PROFILE=full`), never a bare "unknown tool".
- `search_symbols` with `semantic: true` or `query_embedding` answers from the keyword index and appends a one-line notice while embeddings are off.
- The operator instructions sent at connect time describe only the tools the profile serves.

---

## 🛠️ Fixes That Matter

- **The server exits when its MCP client disconnects.** MCP clients close a stdio server's stdin and wait for it to exit. Cynapx ignored that, outlived every client, and could be orphaned holding the singleton lock when the client's SIGTERM reached only the `npx`/`tsx` wrapper.
- **Running from source works again.** Since 2026-06-15, `npm start`, `npm run dev`, `npm run admin`, `.claude/launch.json` and the repository's own `.mcp.json` crashed at startup. Tests and the built `dist/` kept passing, so nothing flagged it — this is why the repository's Cynapx MCP server would not connect. The source runner is now `tsx`, and index workers load correctly from source.
- **Embedding configuration now reaches the indexer.** Index time always started the Python sidecar, ignoring `CYNAPX_EMBED_*`. With `=openai`, queries ran against vectors from a different model. Query and index time now share one resolver.
- **Unknown tools and hidden prompts answer immediately** instead of hanging until indexing finished.
- **Availability** (from the 99.9% verification): `/healthz` is exempt from rate limiting, so heavy legitimate load no longer trips container restart loops, and malformed or oversized requests return 400/413 instead of 500. See `docs/availability-verification.md`.
- **Call graph precision**: same-file call resolution no longer fails silently for symbols with uppercase letters, and method calls through a receiver no longer resolve to unrelated free functions.

## 🌍 Polyglot Follow-ups

- Test-spec extraction for **Kotlin**, **PHP**, **C++ (GoogleTest)** and **C# (xUnit/NUnit/MSTest)**, with best-effort links to the production code they exercise (`targetQname`), so `get_related_tests` can surface them.
- **Go** imports inside the module (`go.mod`) resolve to real file-to-file edges.
- **KDoc** and **PHPDoc** are captured and normalized as docstrings.

---

## 🔒 Security

- **Advisories: 12 → 0** for production dependencies (3 critical, 4 high, 5 moderate), and **0 across the full tree including dev**.
  - Production: `simple-git` 4 (2 critical), `proxy-addr` (critical), `@modelcontextprotocol/sdk` 1.32.1, and `js-yaml` 4.3.2. The `js-yaml` issue was reachable: the indexer parses repository YAML.
  - Dev: `ts-node-dev`, unmaintained since 2022, carried advisories with no fix and was replaced by `tsx`.
- **Maintenance no longer depends on someone remembering it.** A weekly CI workflow audits dependencies, reports drift, watches for MCP TypeScript SDK v2, runs the tests, and opens an issue when it fails.

---

## ✅ Quality Gates

- **904/904 tests passing** (60 files), including new gates for tool profiles, documentation sync, and the stdio lifecycle
- `tsc --noEmit` clean · `npm run build` clean
- `npm audit --omit=dev`: 0 · `npm audit`: 0

---

## 📦 Upgrade Notes

- **Breaking — default toolset.** If your agent uses a hidden tool or semantic search, set `CYNAPX_TOOL_PROFILE=full`, or set `CYNAPX_EMBED_PROVIDER` for embeddings alone:
  ```json
  "cynapx": { "command": "node", "args": ["/path/to/Cynapx/dist/bootstrap.js"], "env": { "CYNAPX_TOOL_PROFILE": "full" } }
  ```
- **Breaking — source runner.** If you run Cynapx from source, use `npm start` / `npm run dev` or `npx tsx src/bootstrap.ts` instead of `ts-node`. The built `node dist/bootstrap.js` is unchanged.
- **No schema change, no migration.** Re-indexing is recommended (`purge_index` then `initialize_project`) to pick up the new docstrings, test specs and corrected call edges.
- **Embedding provider switches** still require a re-index, as before.

---

**Full diff:** `v3.1.0...v4.0.0`
