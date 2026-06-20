# Cynapx v3.0.0 — The AI-Driven Knowledge Base

> **Vision:** Make Cynapx the *true* knowledge base for AI-driven development — so that AI agents can **always get exact context** on whatever they are involved in.

Cynapx is a high-performance, isolated **code knowledge engine** for AI agents: an MCP server + REST API backed by a tree-sitter multi-language parser and a SQLite (`better-sqlite3` + `sqlite-vec`) knowledge graph, with worker-thread indexing and git-based incremental sync.

v3.0.0 is the culmination of the **Vision Arc (P1–P9)** — a ground-up push to make the graph richer, more temporal, more semantic, and **model-agnostic** — layered on top of 22 maintenance cycles (Phases 12–33) of security, performance, and test-coverage hardening.

---

## 🌟 Headline Features

### Model-Agnostic Semantic Search (P9)
Semantic features now serve **any** AI agent model — Claude, ChatGPT Codex, local LLMs, and whatever comes next. No vendor lock-in at the embedding layer.

- **Pluggable embedding providers.** A factory (`createEmbeddingProviderFromEnv()`) selects the provider at runtime:
  - **OpenAI-compatible** (`text-embedding-3-small` by default; also works with Azure OpenAI, vLLM, LM Studio)
  - **Ollama** (`nomic-embed-text` by default, `localhost:11434`)
  - **Jina sidecar** (`jina-code-embeddings`, 896 dims — the default)
  - **Null** (no-op fallback)
  - Configured via `CYNAPX_EMBED_PROVIDER` / `_MODEL` / `_API_KEY` / `_ENDPOINT` / `_DIMENSIONS`, or per-project through `ProjectProfile.embedding`.
- **Query-time embedding pass-through.** Agents can pass a **pre-computed `query_embedding`** to `search_symbols`, so the model that *issues* the query is the model that *embeds* it — no server-side re-embedding, no model mismatch. Supplying a vector triggers semantic search even without `semantic: true`.
- **`find_similar_symbols` tool.** K-NN over stored embeddings to find semantically similar code — ideal for duplicate detection, pattern discovery, and refactoring. Self-excluded, score normalized as `1 / (1 + distance)`.
- **Confidence scoring.** Search results now expose their **relevance score** (RRF for hybrid search, positional for keyword-only), so agents can rank and filter by confidence.
- **Richer embedding snippets.** Embeddings now include the **code body** (sliced from disk by start/end line, truncated to 1000 chars), dramatically improving discrimination between same-named functions with different implementations.
- **Structured output.** Results return `{ qname, type, file, signature, docstring_snippet, tags, fan_in, score }` so any model can reason over them.

### Cross-Language Enrichment (P8)
Graph edges and structure are inherently model-agnostic — they benefit every agent. v3.0.0 makes the polyglot graph substantially denser and more accurate.

- **Intra-file call resolution.** `calls` edges now resolve to the **fully-qualified name** of same-file definitions (instead of bare identifiers), across all tree-sitter languages.
- **Cross-file local import resolution.**
  - **Python** relative imports (`from .utils import x`, `from ..common import y`) resolve to real `.py` / `__init__.py` file nodes.
  - **Rust** external module declarations (`mod foo;`) resolve to sibling `foo.rs` / `foo/mod.rs`.
- **Polyglot docstring normalization.** Per-language cleanup for cleaner semantic signal: **Rust** (`///` / `//!`), **C#** (XML doc tags), **Go** (`//`), **GDScript** (`##`).
- **Polyglot test-spec extraction.** The rich test linkage from P7 (TS/JS) now extends to **Python** (pytest + unittest), **Go** (`func Test*`, `t.Run` subtests), **Rust** (`#[test]`), and **Java** (`@Test`) — capturing test → assertions as behavioral contracts.

### Temporal & Intent Context (P1–P7)
- **Docstring capture (P1).** JSDoc / docstrings / comment blocks are stored as each node's `docstring` (its *intent*).
- **Meaningful embedding snippets (P2).** Symbol + Type + Signature + Context (tags) + Description (docstring).
- **`get_project_overview` (P3).** A token-efficient project briefing for agents bootstrapping context.
- **`get_recent_changes` / `get_symbol_history` (P4).** "What changed recently?" and "Why does this symbol exist?" — answered from git history.
- **Agent annotation write-back (P5).** Agents can persist `decision` / `gotcha` / `todo` / `rationale` notes onto symbols via `add_annotation` / `get_annotations` — the knowledge base *learns* from the agents using it.
- **Architecture intent model (P6).** Declare intended architecture in `cynapx.architecture.json`; Cynapx materializes it into an `architecture_intent` table and **detects drift** against the real graph.
- **Rich test linkage (P7).** `it()` / `test()` blocks and `expect()` assertions captured as `test_specs`.

---

## 🛠️ New MCP Tools

| Tool | Purpose |
|------|---------|
| `find_similar_symbols` | K-NN semantic similarity over stored embeddings |
| `get_project_overview` | Token-efficient whole-project briefing |
| `get_recent_changes` | Recently changed symbols (git-derived) |
| `get_symbol_history` | Change history / rationale for a symbol |
| `add_annotation` / `get_annotations` | Agent write-back of decisions, gotchas, TODOs |
| `get_architecture` | Architecture intent + drift report |

`search_symbols` gains a `query_embedding` parameter for model-agnostic query-time vectors.

---

## 🔧 Configuration

New embedding environment variables (all optional; default = Jina sidecar):

```bash
CYNAPX_EMBED_PROVIDER=openai        # openai | ollama | jina-sidecar | null
CYNAPX_EMBED_MODEL=text-embedding-3-small
CYNAPX_EMBED_API_KEY=sk-...
CYNAPX_EMBED_ENDPOINT=https://api.openai.com
CYNAPX_EMBED_DIMENSIONS=1536
```

Per-project overrides are also supported via `ProjectProfile.embedding`.

---

## 🔒 Hardening & Quality (Phases 12–33)

Beyond the vision arc, this release folds in 22 maintenance cycles of precision diagnostics and fixes:

- **Security:** supply-chain CVE remediation via dependency overrides, IPC HMAC auth + per-message limits, path-boundary hardening, sidecar crash handling, fail-fast HTTPS cert validation, `npm audit` CI gate (**0 vulnerabilities**).
- **Reliability:** atomic lock acquisition, host-promotion race fixes, failover heartbeat, registry lost-update fix, recursive-trigger + UPSERT correctness.
- **Performance:** dirty-set re-tagging worklist, `O(1)` cycle-edge lookups in the architecture engine, prefetched git history outside transactions, indexing hot-path resource hygiene.
- **Architecture:** data-driven language providers via descriptors (the `LanguageDescriptor` hook pattern that made P8 polyglot work clean), structured logging, MCP progress notifications.

---

## ✅ Quality Gates

- **839/839 tests passing** across 57 test files
- `tsc --noEmit` — clean
- `npm run build` — clean
- `npm audit --omit=dev` — **0 vulnerabilities**

---

## ⏭️ Intentionally Deferred

- **Express 5 / TypeScript 6 major upgrades** — high regression risk, zero new capability. Deliberately postponed.
- **Go module import resolution** (needs `go.mod` path mapping), selector-vs-identifier precision for method calls, cross-file `targetQname` resolution for tree-sitter test-specs, and docstring/test-spec coverage for remaining languages (C/C++/PHP/Kotlin) — tracked as future candidates.

---

## 📦 Upgrade Notes

- The knowledge-graph schema is extended (annotations, architecture intent, test specs, embeddings with code body). Existing projects are migrated automatically; a **re-index** is recommended to populate the new richer embeddings and cross-language edges.
- No breaking changes to existing MCP tool signatures — all additions are backward-compatible (`query_embedding` is optional, new tools are additive).

---

**Full diff:** `v2.0.0...v3.0.0` — 209 files changed, +26,556 / −1,474.
