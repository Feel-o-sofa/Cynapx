# 🧠 Cynapx User Guide v1.0.6
### Complete Reference for the Code Knowledge Engine

---

[🏠 README (EN)](./README.md) | [🏠 홈 (KR)](./README_KR.md) | [📖 사용자 가이드 (KR)](./GUIDE_KR.md)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Setup](#2-setup)
3. [Project Lifecycle](#3-project-lifecycle)
4. [MCP Tool Reference](#4-mcp-tool-reference)
   - [4.1 Setup & Lifecycle](#41-setup--lifecycle)
   - [4.2 Symbol Navigation](#42-symbol-navigation)
   - [4.3 Architecture Analysis](#43-architecture-analysis)
   - [4.4 Quality & Risk](#44-quality--risk)
   - [4.5 Refactoring & Export](#45-refactoring--export)
5. [REST API](#5-rest-api)
6. [Supported Languages](#6-supported-languages)
7. [Zero-Pollution Principle](#7-zero-pollution-principle)
8. [Extending Language Support](#8-extending-language-support)

---

## 1. Architecture Overview

```
Your Project (any language)
        │
        ▼
┌──────────────────────────────────────────────┐
│              Indexing Pipeline               │
│  Tree-sitter Parser → Symbol Extraction      │
│  TypeScript Compiler API → Type Edges         │
│  Git Service → Commit History Mapping         │
│  Structural Tagger → Tag Propagation (5-pass) │
│  Python Sidecar → Vector Embeddings (optional)│
└──────────────────────┬───────────────────────┘
                       │
                       ▼
        SQLite Knowledge Graph (~/.cynapx/)
          nodes: symbols, metrics, tags
          edges: calls, contains, inherits,
                 implements, overrides, imports
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
     MCP Server    REST API    Graph Engine
     (stdio)      (:3001)    (BFS/DFS/LRU)
```

**Key concepts:**

- **Knowledge Graph**: Every symbol (function, class, method, field) is a node with metrics (LOC, cyclomatic complexity, fan-in, fan-out). Relationships between symbols are edges with typed semantics.
- **Zero-Pollution**: All data lives in `~/.cynapx/` — Cynapx never writes to your project directory.
- **Structural Tags**: Each node carries tags like `layer:api`, `role:repository`, `trait:internal` that enable architecture rule checking.
- **Confidence-Aware Analysis**: Dead code results are split into HIGH / MEDIUM / LOW tiers based on visibility and false-positive probability.

---

## 2. Setup

### 2.1 Prerequisites

- Node.js >= 20
- Git (for history backfill)
- Python 3.x (optional — for vector embedding support)

### 2.2 Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/Feel-o-sofa/Cynapx.git
cd Cynapx
npm install
npm run build        # compile TypeScript → dist/
```

### 2.3 Connecting to Claude Code

Place a `.mcp.json` file in your project directory (or at the repository root):

```json
{
  "mcpServers": {
    "cynapx": {
      "command": "npx",
      "args": ["ts-node", "src/bootstrap.ts", "--path", "."],
      "cwd": "/absolute/path/to/Cynapx"
    }
  }
}
```

**Dev workflow** — test source changes without commit/PR/merge:

```json
{
  "mcpServers": {
    "cynapx": {
      "command": "npx",
      "args": ["ts-node", "src/bootstrap.ts", "--path", "."]
    },
    "cynapx-dev": {
      "command": "npx",
      "args": ["ts-node", "src/bootstrap.ts", "--path", "."],
      "cwd": "/absolute/path/to/Cynapx/.claude/worktrees/<branch-name>"
    }
  }
}
```

After editing source in the worktree, restart the Claude Code session — `cynapx-dev` picks up the latest source immediately (no build needed; `ts-node` transpiles on the fly).

### 2.4 CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| `--path <dir>` | `cwd` | Project directory to analyze |
| `--port <n>` | `3001` | REST API listening port |
| `--bind <addr>` | `127.0.0.1` | Bind address (use `0.0.0.0` for LAN access) |
| `--no-auth` | `false` | Disable Bearer token authentication |

Authentication token is auto-generated on every startup and printed to stderr. Pass it as `Authorization: Bearer <token>` on REST requests.

---

## 3. Project Lifecycle

Typical workflow for a new project:

```
1. initialize_project   →  index symbols, build knowledge graph
2. backfill_history     →  map Git commits to symbols (enables churn metrics)
3. re_tag_project       →  run structural tagging (layers, roles, traits)
        ┆
   [ongoing — file watcher keeps graph in sync automatically]
        ┆
4. purge_index          →  delete index (start fresh or switch projects)
```

The file watcher triggers incremental re-indexing on every save. A full `initialize_project` is only needed once per project (or after `purge_index`).

---

## 4. MCP Tool Reference

### 4.1 Setup & Lifecycle

---

#### `get_setup_context`
Check whether a project is initialized and list the registry of known projects.

**Returns:** `{ status, current_path, registered_projects[] }`

**When to use:** First call in a new session to confirm the engine is ready.

---

#### `initialize_project`

Index a project and activate the analysis engine.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | `"current"` \| `"existing"` \| `"custom"` | required | `current` = cwd, `existing` = re-use registered path, `custom` = specify `path` |
| `path` | string | — | Required when `mode: "custom"` |
| `zero_pollution` | boolean | `true` | When `false`, writes an anchor file to the project dir |

---

#### `purge_index`

Permanently delete the local SQLite index for the current project.

| Parameter | Type | Description |
|-----------|------|-------------|
| `confirm` | boolean | Must be `true` — safety gate |
| `unregister` | boolean | Also remove the project from the global registry |

> ⚠️ Irreversible. Run `initialize_project` again to rebuild.

---

#### `re_tag_project`

Re-run the 5-pass structural tagging algorithm over all indexed nodes. Use after manually editing tags or upgrading Cynapx.

---

#### `backfill_history`

Fetch Git commit history and map each commit to the symbols it touched. Enables churn-based metrics in `get_risk_profile` and `get_hotspots`.

---

### 4.2 Symbol Navigation

---

#### `search_symbols`

Search for symbols by name or description.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | required | Search term |
| `symbol_type` | string | — | Filter by type: `class`, `method`, `function`, `field`, etc. |
| `limit` | number | `10` | Max results |
| `semantic` | boolean | `false` | Enable vector similarity search (requires Python sidecar) |

**Returns:** Array of `{ qname, type, file, tags }`

---

#### `get_symbol_details`

Retrieve full information for a symbol including metrics, tags, history, and source.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `qualified_name` | string | required | Fully qualified symbol name |
| `include_source` | boolean | `true` | Include source code snippet (truncated at 100 lines) |
| `summary_only` | boolean | `false` | Return only metrics, skip source |

**Returns:** Formatted text with signature, file location, structural tags, last 3 Git commits, LOC/CC/fan-in/fan-out metrics, and source snippet.

---

#### `get_callers`

List all symbols that directly call a given symbol.

| Parameter | Type | Description |
|-----------|------|-------------|
| `qualified_name` | string | Target symbol |

**Returns:** `[{ qname, line }]` — caller name and call-site line number.

---

#### `get_callees`

List all symbols called by a given symbol.

| Parameter | Type | Description |
|-----------|------|-------------|
| `qualified_name` | string | Source symbol |

**Returns:** `[{ qname, line }]`

---

#### `get_related_tests`

Find test symbols linked to a production symbol via `tests` edges.

| Parameter | Type | Description |
|-----------|------|-------------|
| `qualified_name` | string | Production symbol to look up |

**Returns:** Array of test symbol qualified names.

---

### 4.3 Architecture Analysis

---

#### `check_architecture_violations`

Detect layer ordering violations (e.g., `db` calling `api`) and circular dependencies using the structural tags assigned during indexing.

**Returns:** Array of violation objects `{ type, source, target, message }`

**Common violation types:**
- `layer_violation` — lower layer depends on higher layer
- `circular_dependency` — A → B → … → A cycle

---

#### `get_remediation_strategy`

Get a concrete 3-step refactoring plan for a specific violation.

| Parameter | Type | Description |
|-----------|------|-------------|
| `violation` | object | A violation object returned by `check_architecture_violations` |

**Returns:** `{ strategy, steps[], effort, risk }`

---

#### `discover_latent_policies`

Analyze the graph to surface implicit architectural patterns — conventions that exist in practice but are not formally declared (e.g., "all `layer:db` nodes avoid direct `calls` to `layer:api`").

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `threshold` | number | `0.8` | Minimum consistency ratio (0–1) to report a policy |
| `min_count` | number | `3` | Minimum occurrences before considering it a policy |

**Returns:** Array of `{ policy_id, description, confidence, examples[] }`

---

### 4.4 Quality & Risk

---

#### `find_dead_code`

Identify symbols with `fan_in = 0` (nothing calls them), split into three confidence tiers:

| Tier | Criteria | False-Positive Rate | Action |
|------|----------|---------------------|--------|
| **HIGH** | `private` visibility + `fan_in = 0` | < 5% | Review immediately |
| **MEDIUM** | `public` + `trait:internal` tag + `fan_in = 0` | ~30% | Review with context |
| **LOW** | `public` + `fan_in = 0` (no `trait:internal`) | > 80% | Count only — likely external API surface |

**No parameters.**

**Returns:** Summary counts per tier + full list for HIGH and MEDIUM + count-only for LOW.

> **Note:** `this.field.method()` call patterns are not fully resolved by static analysis, which is why `public` methods often appear in LOW/MEDIUM even when called. HIGH tier (`private`) is reliable.

---

#### `get_hotspots`

Rank symbols by a chosen complexity or coupling metric.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `metric` | string | required | Column name: `cyclomatic`, `fan_in`, `fan_out`, `loc` |
| `threshold` | number | `0` | Minimum value to include |

**Returns:** Top 20 symbols by the chosen metric.

---

#### `get_risk_profile`

Calculate a composite risk score for a symbol based on cyclomatic complexity, Git churn frequency, and structural coupling.

| Parameter | Type | Description |
|-----------|------|-------------|
| `qualified_name` | string | Symbol to profile |

**Returns:** `{ risk_score, complexity, churn, coupling, recommendations[] }`

---

#### `analyze_impact`

BFS traversal of incoming edges to find all symbols that depend (directly or indirectly) on a given symbol — the "ripple effect" of changing it.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `qualified_name` | string | required | Symbol to analyze |
| `max_depth` | number | `3` | BFS depth limit |
| `use_cache` | boolean | `true` | Use cached traversal results |

**Returns:** `[{ node, distance, impact_path }]` sorted by distance.

---

### 4.5 Refactoring & Export

---

#### `propose_refactor`

Generate a risk-aware refactoring proposal for a symbol, considering its complexity, coupling, and dependents.

| Parameter | Type | Description |
|-----------|------|-------------|
| `qualified_name` | string | Symbol to refactor |

**Returns:** Proposal with suggested split points, estimated risk, and ordered steps.

---

#### `export_graph`

Export a subgraph as a Mermaid diagram and JSON structural summary.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `root_qname` | string | — | Root symbol (omit for full graph) |
| `max_depth` | number | `2` | How many hops from root to include |

**Returns:** Mermaid `graph LR` diagram + `{ nodes[], edges[] }` JSON.

---

#### `check_consistency`

Verify that the knowledge graph is in sync with the current state of disk and Git.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `repair` | boolean | `false` | Auto-repair detected inconsistencies |
| `force` | boolean | `false` | Force full re-scan even if checksums match |

**Returns:** Consistency report with pass/fail per check and any repaired items.

---

## 5. REST API

The REST API runs on the same process as the MCP server (default port `3001`).

### Interactive Explorer

```
GET /api/docs
```

Opens Swagger UI — no authentication required. All endpoints are documented with request/response schemas.

### Rate Limits

| Scope | Limit |
|-------|-------|
| Global | 100 requests / minute |
| Analysis endpoints (`/api/analysis/*`) | 10 requests / minute |

Exceeding limits returns `429 Too Many Requests`.

### Authentication

All endpoints except `GET /api/docs` require:
```
Authorization: Bearer <token>
```

The token is printed to stderr on startup. Disable with `--no-auth` for local-only use.

### Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Server health check |
| `GET` | `/api/analysis/hotspots` | Hotspot analysis |
| `POST` | `/api/analysis/impact` | Impact analysis |
| `GET` | `/api/symbols/:id` | Symbol details |
| `GET` | `/api/symbols/:id/callers` | Symbol callers |
| `GET` | `/api/symbols/:id/callees` | Symbol callees |
| `GET` | `/api/search` | Symbol search |
| `GET` | `/api/tests/:symbolId` | Related tests |

---

## 6. Supported Languages

| Language | Extension(s) | Notes |
|----------|-------------|-------|
| TypeScript | `.ts`, `.tsx` | Full type-aware edge extraction via TS compiler API |
| JavaScript | `.js`, `.jsx` | AST-based, no type inference |
| Python | `.py` | Includes inheritance and import edges |
| Go | `.go` | Struct methods, interfaces |
| Java | `.java` | Classes, interfaces, constructors |
| C | `.c`, `.h` | Functions, structs, enums |
| C++ | `.cpp`, `.hpp` | Classes, namespaces, templates |
| C# | `.cs` | Classes, interfaces, methods |
| Kotlin | `.kt` | Classes, interfaces, functions |
| PHP | `.php` | Functions, classes, methods |
| Rust | `.rs` | Functions, structs, traits, impls |
| GDScript | `.gd` | Classes, functions (Godot) |

---

## 7. Zero-Pollution Principle

Cynapx never modifies your project directory. All persistent data is stored under `~/.cynapx/`:

```
~/.cynapx/
├── registry.json          # list of all registered project paths
├── locks/                 # per-project process lock files
├── certs/                 # TLS certificates (if applicable)
└── <project-hash>/
    └── index.db           # SQLite knowledge graph (nodes + edges)
```

The `<project-hash>` is a deterministic hash of the absolute project path, ensuring isolation between projects.

To fully remove Cynapx data for a project:
```
purge_index  →  confirm: true, unregister: true
```

To remove all data:
```bash
rm -rf ~/.cynapx/
```

---

## 8. Extending Language Support

Cynapx supports adding new languages via the Language Provider extension point.

1. Implement the `LanguageProvider` interface (see [`docs/extending-language-support.md`](./docs/extending-language-support.md))
2. Place the compiled `.js` file (or `.ts` with `ts-node`) in `~/.cynapx/plugins/`
3. Restart Cynapx — the registry auto-discovers and loads the provider

A fully annotated example for Ruby is provided in [`examples/ruby-language-provider.ts`](./examples/ruby-language-provider.ts).

---

**Cynapx** — maintained by [Feel-o-sofa](https://github.com/Feel-o-sofa)
