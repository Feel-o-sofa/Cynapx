# 🧠 Cynapx v1.0.6
### High-Performance AI-Native Code Knowledge Engine

**Cynapx** is a high-performance, isolated code analysis engine for AI agents and developers. It transforms a codebase into a multi-dimensional knowledge graph, enabling LLMs to understand complex architectures, relationships, and quality signals instantly.

---

[🌐 한국어 README](./README_KR.md) | [📖 User Guide (EN)](./GUIDE_EN.md) | [📖 사용자 가이드 (KR)](./GUIDE_KR.md)

---

## 🌟 Why Cynapx?

| Principle | Description |
|-----------|-------------|
| **Relationship-First** | Extracts inheritance, implementation, call, and containment edges — not just symbol names |
| **Zero-Pollution** | No files written to your project directory; all data stored in `~/.cynapx/` |
| **Confidence-Aware** | Dead code results split into HIGH / MEDIUM / LOW tiers to minimize false positives |
| **AI-Native** | Smart context pruning, operator instruction injection, and token-efficient output formatting |
| **Extensible** | Add support for new languages via the Language Provider extension point |

---

## 🚀 Quick Start

### 1. Prerequisites

```bash
# Node.js >= 20 required
node --version

# Install dependencies from the project root
npm install
```

### 2. Register with Claude Code

Create or edit `.mcp.json` in your project directory:

```json
{
  "mcpServers": {
    "cynapx": {
      "command": "npx",
      "args": ["ts-node", "src/bootstrap.ts", "--path", "."],
      "cwd": "/path/to/cynapx"
    }
  }
}
```

> **Dev workflow**: Add a `cynapx-dev` entry pointing to your working branch so you can test changes after a session restart without committing. See [GUIDE_EN.md §2](./GUIDE_EN.md#2-setup) for details.

### 3. Initialize a project

Once connected, call `initialize_project` to index your target codebase:

```
initialize_project  →  mode: "current"   # index the directory cynapx was started in
initialize_project  →  mode: "custom", path: "/your/project"  # index any path
```

Indexing runs in the background. Use `get_setup_context` to check status.

---

## 🛠️ MCP Tools (20 total)

### Setup & Lifecycle
| Tool | Description |
|------|-------------|
| `get_setup_context` | Check initialization status and registry |
| `initialize_project` | Index a project into the knowledge graph |
| `purge_index` | Delete the local index (requires `confirm: true`) |
| `re_tag_project` | Re-run structural characteristic tagging |
| `backfill_history` | Map Git commit history to indexed symbols |

### Symbol Navigation
| Tool | Description |
|------|-------------|
| `search_symbols` | Keyword + optional semantic (vector) symbol search |
| `get_symbol_details` | Full metrics, tags, history, and source snippet |
| `get_callers` | All symbols that directly call a given symbol |
| `get_callees` | All symbols called by a given symbol |
| `get_related_tests` | Test symbols linked to a production symbol |

### Architecture Analysis
| Tool | Description |
|------|-------------|
| `check_architecture_violations` | Detect layer/domain violations and circular dependencies |
| `get_remediation_strategy` | 3-step fix guidance for a detected violation |
| `discover_latent_policies` | Surface implicit architectural patterns from the graph |

### Quality & Risk
| Tool | Description |
|------|-------------|
| `find_dead_code` | Unused symbols in HIGH / MEDIUM / LOW confidence tiers |
| `get_hotspots` | Technical debt hotspots ranked by a chosen metric |
| `get_risk_profile` | Risk score combining cyclomatic complexity, churn, and coupling |
| `analyze_impact` | BFS ripple-effect analysis from a symbol outward |

### Refactoring & Export
| Tool | Description |
|------|-------------|
| `propose_refactor` | Risk-aware refactoring proposal for a symbol |
| `export_graph` | Mermaid diagram + JSON structural summary |
| `check_consistency` | Verify graph integrity against disk and Git |

---

## 🌐 Supported Languages

TypeScript · JavaScript · Python · Go · Java · C · C++ · C# · Kotlin · PHP · Rust · GDScript

> To add a new language, implement the `LanguageProvider` interface and place the file in `~/.cynapx/plugins/`. See [`docs/extending-language-support.md`](./docs/extending-language-support.md).

---

## 📡 REST API

When running, Cynapx exposes a REST API alongside the MCP server:

- **Swagger UI**: `GET /api/docs` — interactive API explorer (no auth required)
- **Rate limits**: 100 req/min global · 10 req/min for analysis endpoints
- **Auth**: Bearer token auto-generated on startup (disable with `--no-auth`)

---

## ⚙️ CLI Options

```
npx ts-node src/bootstrap.ts [options]

  --path <dir>    Project directory to analyze (default: cwd)
  --port <n>      REST API port (default: 3001)
  --bind <addr>   Bind address (default: 127.0.0.1)
  --no-auth       Disable Bearer token authentication
```

---

## 📖 Documentation

- [**User Guide (EN)**](./GUIDE_EN.md) — full tool reference, workflows, and configuration
- [**사용자 가이드 (KR)**](./GUIDE_KR.md) — 한국어 전체 가이드
- [**Extending Language Support**](./docs/extending-language-support.md) — add new language providers
- [**Contributing**](./CONTRIBUTING.md) — development setup and PR process

---

## 🛡️ Security

- **Path Traversal Guard**: All file access is validated against the registered project path
- **Isolated Storage**: `~/.cynapx/` — never writes to your project directory
- **Input Validation**: All REST endpoints protected by Zod schemas

---

**Cynapx** — maintained by [Feel-o-sofa](https://github.com/Feel-o-sofa)
