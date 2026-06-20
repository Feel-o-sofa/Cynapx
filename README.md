# 🧠 Cynapx v3.0.0
### High-Performance AI-Native Code Knowledge Engine for AI Agents

**Cynapx** transforms a codebase into a persistent, queryable knowledge graph of symbols and relationships — giving AI agents real structural understanding that survives session boundaries, context resets, and model restarts.

> **v3.0.0** completes the Vision Arc (P1–P9): docstring/intent capture, temporal context, agent annotation write-back, architecture drift detection, polyglot test-spec & import enrichment, and **model-agnostic semantic search** with pluggable embedding providers. See [RELEASE_NOTES_v3.0.0.md](./RELEASE_NOTES_v3.0.0.md).

---

[🌐 한국어](./README_KR.md) | [📖 User Guide (EN)](./GUIDE_EN.md) | [📖 사용자 가이드 (KR)](./GUIDE_KR.md)

---

## 🤔 The Problem: LLMs Work Blind on Large Codebases

When an AI agent is dropped into a large codebase, it faces a fundamental problem: it can only read files one at a time, has no memory of what it already read, and cannot answer questions like:

- *What calls this function?*
- *Which modules depend on this class?*
- *If I change this interface, what breaks?*
- *Where are the real complexity hotspots — not just the longest files?*

Text search and embedding retrieval help, but they describe **tokens**, not **structure**. Cynapx solves this by building a **persistent SQLite knowledge graph** from Tree-sitter parse results — encoding actual call edges, inheritance chains, import relationships, and containment hierarchies — so agents can query structure directly instead of guessing from text.

---

## ⚖️ Why Not Just Use ___?

| Approach | What it gives you | What it misses |
|---|---|---|
| **grep / text search** | Lines that contain a string | Relationships, callers, transitive impact |
| **Embeddings only** | Semantically similar code | Structural edges — who calls what, cyclomatic complexity, coupling |
| **LSP** | Real-time symbol resolution in an editor | Persistent storage, cross-session memory, batch analysis, AI-friendly output |
| **Cynapx** | Persistent structural graph + AI-native tool API | (You're already here) |

---

## 🌟 Core Principles

| Principle | Description |
|---|---|
| **Relationship-First** | Extracts call, inheritance, implementation, import, containment, and override edges — not just symbol names |
| **Zero-Pollution** | Writes nothing to your project directory; all data lives in `~/.cynapx/` |
| **Confidence-Aware** | Dead code results are stratified into HIGH / MEDIUM / LOW tiers to minimize false positives |
| **AI-Native** | Token-efficient output formatting, operator instruction injection, and smart context pruning for LLM consumption |
| **Model-Agnostic** | Semantic/embedding layer is pluggable — OpenAI, Ollama, Jina sidecar, or your own. Agents can pass pre-computed query vectors so the model issuing a query is the model embedding it |
| **Extensible** | New languages can be added by implementing the `LanguageProvider` interface |

---

## 🚀 Quick Start

### Step 1 — Clone and build

> Cynapx is **GitHub-only** — it is not published to npm.

```bash
git clone https://github.com/Feel-o-sofa/cynapx.git
cd cynapx
npm install
npm run build
# Entry point: dist/bootstrap.js
```

**Prerequisites:** Node.js ≥ 22, Git

### Step 2 — Register with Claude Code

Create or edit `.mcp.json` in your project directory:

```json
{
  "mcpServers": {
    "cynapx": {
      "command": "node",
      "args": ["/absolute/path/to/cynapx/dist/bootstrap.js", "--path", "."]
    }
  }
}
```

Replace `/absolute/path/to/cynapx` with the directory where you cloned the repository. Restart Claude Code after saving.

### Step 3 — Initialize a project

Once connected, call `initialize_project` from within Claude Code:

```
initialize_project  →  mode: "current"             # index the directory cynapx was started in
initialize_project  →  mode: "existing"             # re-index a previously registered project
initialize_project  →  mode: "custom", path: "/your/project"   # index any path on disk
```

After indexing completes, all 27 tools are active. Use `get_setup_context` at any time to check status and disk usage.

---

## 🛠️ MCP Tools — 27 Total

### Setup & Lifecycle

| Tool | Description |
|---|---|
| `get_setup_context` | Check initialization status, `disk_usage_mb`, and registered projects |
| `get_project_overview` | Token-efficient whole-project briefing for agents bootstrapping context |
| `initialize_project` | Index a project into the knowledge graph (`mode`: `"current"` \| `"existing"` \| `"custom"`) |
| `purge_index` | Permanently delete the local index — requires `confirm: true` |
| `re_tag_project` | Re-run structural characteristic tagging without full re-index |
| `backfill_history` | Walk Git commit history and map commits to indexed symbols |

### Symbol Navigation & Semantic Search

| Tool | Description |
|---|---|
| `search_symbols` | Keyword search with optional semantic (vector) mode; accepts a pre-computed `query_embedding` for model-agnostic queries |
| `find_similar_symbols` | K-NN semantic similarity over stored embeddings — duplicate detection, pattern discovery, refactoring |
| `get_symbol_details` | Full metrics, structural tags, churn history, and source snippet for a symbol |
| `get_callers` | All symbols that directly call a given symbol |
| `get_callees` | All symbols called by a given symbol |
| `get_related_tests` | Test-file symbols linked to a production symbol via call or import edges |

### Temporal Context & Agent Memory

| Tool | Description |
|---|---|
| `get_recent_changes` | Recently changed symbols, derived from Git history |
| `get_symbol_history` | Change history and rationale for a single symbol — "why does this exist?" |
| `add_annotation` | Persist an agent note onto a symbol (`decision` \| `gotcha` \| `todo` \| `rationale`) |
| `get_annotations` | Retrieve agent-authored annotations for a symbol |

### Architecture Analysis

| Tool | Description |
|---|---|
| `get_architecture` | Declared architecture intent + drift report against the real graph |
| `check_architecture_violations` | Detect illegal layer/domain crossings and circular dependencies |
| `get_remediation_strategy` | Generate a 3-step, prioritized fix plan for a detected violation |
| `discover_latent_policies` | Surface implicit architectural patterns encoded in the graph |

### Quality & Risk

| Tool | Description |
|---|---|
| `find_dead_code` | Unreachable symbols stratified into HIGH / MEDIUM / LOW confidence tiers |
| `get_hotspots` | Top symbols ranked by `cyclomatic`, `fan_in`, `fan_out`, or `loc` |
| `get_risk_profile` | Composite risk score combining cyclomatic complexity, churn rate, and coupling |
| `analyze_impact` | BFS ripple-effect analysis — which symbols are transitively affected by a change |

### Refactoring & Export

| Tool | Description |
|---|---|
| `propose_refactor` | Risk-aware refactoring proposal anchored to the symbol's actual graph position |
| `export_graph` | Structural summary of the knowledge graph in `json` (with embedded Mermaid), `graphml`, or `dot` (Graphviz) format |
| `check_consistency` | Verify graph integrity against disk state and Git HEAD |

---

## 💻 Admin CLI — `cynapx-admin`

The `cynapx-admin` binary provides operational control over all registered projects and stored data.

| Command | What it does |
|---|---|
| `status` | Show current disk usage and registered project count |
| `list` | List all registered projects with their paths and index state |
| `inspect <hash>` | Detailed view of a single project index |
| `doctor` | Run health checks across all indexes and surface inconsistencies |
| `purge <hash>` | Delete the index for a specific project |
| `unregister <hash>` | Remove a project from the registry without deleting its index |
| `compact <hash>` | Run SQLite VACUUM to reclaim disk space |
| `backup <hash>` | Create a timestamped backup of a project index |
| `restore <hash> <backup>` | Restore a project index from a backup file |

---

## 🌐 REST API

In addition to the MCP interface, Cynapx can expose its analysis engine over an authenticated HTTP REST API. Start it by passing `--api` at boot (optionally `--api-port <number>`, default `3000`). All `/api/*` routes require a **Bearer token** (constant-time validated) and are protected by per-IP **rate limiting** (heavy analysis routes use a stricter limiter). The full contract is published as an OpenAPI 3.0 spec (`src/server/openapi.ts`), served via Swagger UI at `/api/docs` in non-production environments.

| Route | Description |
|---|---|
| `POST /api/symbol/get` | Full details for a single symbol |
| `POST /api/graph/callers` | Symbols that directly call a given symbol |
| `POST /api/graph/callees` | Symbols called by a given symbol |
| `POST /api/analysis/impact` | BFS ripple-effect impact analysis |
| `POST /api/analysis/hotspots` | Top symbols ranked by a chosen metric |
| `POST /api/analysis/tests` | Tests linked to a production symbol |
| `POST /api/search/symbols` | Keyword / semantic symbol search |
| `POST /api/graph/export` | Export the graph as `json`, `graphml`, or `dot` |
| `GET /healthz` | Unauthenticated liveness/readiness probe |

---

## 🔌 Model-Agnostic Embeddings

Cynapx's semantic layer is **pluggable** so it can serve any AI agent model — Claude, ChatGPT Codex, local LLMs, and future models. The embedding provider is selected at runtime; the default is the bundled Jina code-embeddings sidecar.

| Env var | Purpose | Example |
|---|---|---|
| `CYNAPX_EMBED_PROVIDER` | `openai` \| `ollama` \| `jina-sidecar` \| `null` | `openai` |
| `CYNAPX_EMBED_MODEL` | Model name for the chosen provider | `text-embedding-3-small` |
| `CYNAPX_EMBED_API_KEY` | API key (OpenAI-compatible providers) | `sk-...` |
| `CYNAPX_EMBED_ENDPOINT` | Base URL override (Azure / vLLM / LM Studio / self-hosted) | `https://api.openai.com` |
| `CYNAPX_EMBED_DIMENSIONS` | Embedding dimensionality | `1536` |

- **OpenAI-compatible** — native `fetch` to `/v1/embeddings`; works with OpenAI, Azure OpenAI, vLLM, and LM Studio.
- **Ollama** — native `fetch` to `localhost:11434/api/embed` (e.g. `nomic-embed-text`).
- **Jina sidecar** — bundled `jina-code-embeddings` (896 dims), the default.
- **Per-project override** — set `embedding` in the project profile to pin a provider for one project.

Agents can also bypass server-side embedding entirely by passing a pre-computed `query_embedding` to `search_symbols` — keeping the query vector in the same model space the agent uses.

---

## 🌐 Supported Languages

| | | | |
|---|---|---|---|
| TypeScript | JavaScript | Python | Go |
| Java | C | C++ | C# |
| Kotlin | PHP | Rust | GDScript |

> To add a new language, implement the `LanguageProvider` interface. See [GUIDE_EN.md](./GUIDE_EN.md) for the extension point API.

---

## 📂 Storage Layout (`~/.cynapx/`)

Cynapx never writes to your project directory. All persistent data lives under `~/.cynapx/`:

```
~/.cynapx/
├── registry.json          # Maps project paths to their index hashes
├── <hash>_v2.db           # SQLite knowledge graph for each indexed project
├── audit.log              # Append-only log of all index mutations
├── backups/               # Timestamped .db backups created by cynapx-admin backup
├── locks/                 # Per-project write locks (prevent concurrent indexing)
└── profiles/              # Stored structural tag profiles per project
```

The `<hash>` is derived from the canonical absolute path of the indexed project, ensuring each project gets a stable, collision-resistant storage key.

---

## 🛡️ Security

**Path Traversal Guard** — All file access is validated against the registered project root. Attempts to read or index paths outside the registered directory are rejected before they reach the filesystem.

**System Path Guard** — OS-level directories are blocked from registration. This includes `C:\Windows`, `C:\Program Files`, `/usr`, `/bin`, `/etc`, `/lib`, `/sys`, and their subdirectories. The `isSystemPath()` guard prevents accidental indexing of system files regardless of how the path is supplied.

**Zod Input Validation** — Every MCP tool input is validated against a strict Zod schema before processing. Malformed or unexpected inputs are rejected at the boundary with a structured error response.

**Rate Limiting** — Analysis endpoints enforce per-minute rate limits to prevent resource exhaustion during automated agent loops.

**Isolated Storage** — The `~/.cynapx/` directory is the only location Cynapx ever writes to. Project directories are always opened read-only.

---

## 📖 Documentation

- [**User Guide (EN)**](./GUIDE_EN.md) — complete tool reference, agent workflows, and configuration options
- [**사용자 가이드 (KR)**](./GUIDE_KR.md) — 전체 도구 레퍼런스 및 워크플로우 (한국어)

---

**Cynapx** — maintained by [Feel-o-sofa](https://github.com/Feel-o-sofa)
