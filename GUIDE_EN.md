# 🧠 Cynapx v2.0.0 — User Guide

> Complete how-to reference for the AI-native Code Knowledge Engine

---

[🏠 README (EN)](./README.md) | [🏠 홈 (KR)](./README_KR.md) | [📖 사용자 가이드 (KR)](./GUIDE_KR.md)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Setup](#2-setup)
   - [2.1 Prerequisites](#21-prerequisites)
   - [2.2 Installation](#22-installation)
   - [2.3 Connecting to Claude Code](#23-connecting-to-claude-code)
   - [2.4 Developer Workflow (Live Source Changes)](#24-developer-workflow-live-source-changes)
   - [2.5 CLI Options](#25-cli-options)
3. [Project Lifecycle](#3-project-lifecycle)
4. [MCP Tool Reference](#4-mcp-tool-reference)
   - [4.1 Setup & Lifecycle](#41-setup--lifecycle)
   - [4.2 Symbol Navigation](#42-symbol-navigation)
   - [4.3 Architecture Analysis](#43-architecture-analysis)
   - [4.4 Quality & Risk](#44-quality--risk)
   - [4.5 Refactoring & Export](#45-refactoring--export)
5. [Admin CLI Reference](#5-admin-cli-reference)
6. [Real-World Workflows](#6-real-world-workflows)
   - [6.1 Understanding an Unfamiliar Codebase](#61-understanding-an-unfamiliar-codebase)
   - [6.2 Pre-Change Impact Analysis](#62-pre-change-impact-analysis)
   - [6.3 Technical Debt Sprint](#63-technical-debt-sprint)
7. [Storage & Data Management](#7-storage--data-management)
8. [Supported Languages](#8-supported-languages)
9. [Extending Language Support](#9-extending-language-support)

---

## 1. Architecture Overview

```
Your Project (any of 12 supported languages)
        │
        ▼
┌──────────────────────────────────────────────────────┐
│                  Indexing Pipeline                   │
│                                                      │
│  Tree-sitter Parser   →  Symbol Extraction           │
│  TypeScript Compiler API  →  Type-Aware Edge Build   │
│  Git Service          →  Commit History Mapping      │
│  Structural Tagger    →  5-Pass Tag Propagation      │
│  Python Sidecar       →  Vector Embeddings (optional)│
└──────────────────────────┬───────────────────────────┘
                           │
                           ▼
              SQLite Knowledge Graph
              stored in ~/.cynapx/<project-hash>_v2.db
              ┌────────────────────────────────────┐
              │  Nodes: symbols + metrics + tags   │
              │  Edges: calls · contains · inherits│
              │         implements · overrides     │
              │         imports                    │
              └────────────────────────────────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
       MCP Server      REST API      Graph Engine
       (stdio)        (:3001)      (BFS/DFS/LRU cache)
       20 tools     Swagger UI     Impact traversal
```

### Key Concepts

**Nodes — Symbols with Metrics**

Every function, method, class, field, interface, and module is a node. Each node carries:

| Metric | Meaning |
|--------|---------|
| `loc` | Lines of code |
| `cyclomatic` (CC) | McCabe cyclomatic complexity |
| `fan_in` | Number of callers (how many things depend on this) |
| `fan_out` | Number of callees (how many things this depends on) |

**Edges — Typed Relationships**

| Edge Type | Meaning |
|-----------|---------|
| `calls` | Direct invocation |
| `contains` | Structural containment (class → method) |
| `inherits` | Class inheritance |
| `implements` | Interface implementation |
| `overrides` | Method override |
| `imports` | Module-level import |

**Structural Tags**

Each node is labeled during the 5-pass tagging phase with tags like `layer:api`, `layer:db`, `role:repository`, `role:service`, `domain:auth`, `trait:internal`. These tags power `check_architecture_violations` and `discover_latent_policies`.

**Confidence Tiers**

Dead code analysis and impact results use a tiered confidence model:

- **HIGH** — private symbols with `fan_in = 0`. Very reliable; act immediately.
- **MEDIUM** — public symbols with `trait:internal` tag + `fan_in = 0`. ~30% false positive.
- **LOW** — public symbols with `fan_in = 0` and no `trait:internal`. Likely external API surface; count only.

**Zero-Pollution**

Cynapx never writes to your project directory. All persistent data lives in `~/.cynapx/`. The only exception is when `initialize_project` is called with `zero_pollution: false`, which writes a `.cynapx-config` anchor file to the project root.

---

## 2. Setup

### 2.1 Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | >= 20 | Required |
| Git | Any recent | Required for `backfill_history` and churn metrics |
| Python | 3.x | Optional — enables `semantic: true` vector search in `search_symbols` |

> Cynapx is **not published to npm**. Installation is via `git clone` only.

### 2.2 Installation

```bash
# 1. Clone the repository
git clone https://github.com/Feel-o-sofa/Cynapx.git
cd Cynapx

# 2. Install dependencies
npm install

# 3. Compile TypeScript to dist/
npm run build

# Verify the build
node dist/bootstrap.js --help
```

The compiled entry point is `dist/bootstrap.js`. The admin CLI binary (`cynapx-admin`) is also available at `dist/cli/admin.js` after the build.

### 2.3 Connecting to Claude Code

Create or edit `.mcp.json` in your project's root directory (or in `~/.claude/` for global registration):

```json
{
  "mcpServers": {
    "cynapx": {
      "command": "node",
      "args": ["/absolute/path/to/Cynapx/dist/bootstrap.js", "--path", "."]
    }
  }
}
```

Replace `/absolute/path/to/Cynapx` with the actual path where you cloned the repository.

**With explicit options:**

```json
{
  "mcpServers": {
    "cynapx": {
      "command": "node",
      "args": [
        "/absolute/path/to/Cynapx/dist/bootstrap.js",
        "--path", "/absolute/path/to/your-project",
        "--port", "3001",
        "--no-auth"
      ]
    }
  }
}
```

After saving `.mcp.json`, restart Claude Code. Cynapx appears in the MCP tools panel and all 20 tools become available.

### 2.4 Developer Workflow (Live Source Changes)

When developing Cynapx itself (or testing patches in a worktree), use `ts-node` to skip the build step and pick up source changes immediately:

```json
{
  "mcpServers": {
    "cynapx": {
      "command": "npx",
      "args": ["ts-node", "src/bootstrap.ts", "--path", "."],
      "cwd": "/absolute/path/to/Cynapx"
    },
    "cynapx-dev": {
      "command": "npx",
      "args": ["ts-node", "src/bootstrap.ts", "--path", "."],
      "cwd": "/absolute/path/to/Cynapx/.claude/worktrees/<branch-name>"
    }
  }
}
```

`cynapx-dev` points to the worktree for the feature branch being developed. After editing source in the worktree, restart the Claude Code session — `ts-node` transpiles on the fly, no `npm run build` needed.

### 2.5 CLI Options

These options are passed to `node dist/bootstrap.js` (or `ts-node src/bootstrap.ts`):

| Option | Default | Description |
|--------|---------|-------------|
| `--path <dir>` | `cwd` | Absolute or relative path to the project directory to analyze |
| `--port <n>` | `3001` | Port for the REST API and Swagger UI |
| `--bind <addr>` | `127.0.0.1` | Bind address. Use `0.0.0.0` for LAN access |
| `--no-auth` | `false` (auth enabled) | Disable Bearer token authentication on the REST API |

**Authentication:** when auth is enabled, a token is auto-generated on every startup and printed to `stderr`. Use it as `Authorization: Bearer <token>` on REST requests. The MCP server (stdio) does not require the token — it is only for REST.

---

## 3. Project Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│  First time for a project                                       │
│                                                                 │
│  1. initialize_project  →  parse, extract symbols, build graph  │
│  2. backfill_history    →  attach Git commits to symbols        │
│  3. re_tag_project      →  run 5-pass structural tagging        │
│                                                                 │
│  Ongoing (automatic)                                            │
│                                                                 │
│  File watcher  →  incremental re-index on every save           │
│                                                                 │
│  Maintenance                                                    │
│                                                                 │
│  4. check_consistency  →  detect & optionally repair drift      │
│  5. purge_index        →  wipe index, start fresh               │
└─────────────────────────────────────────────────────────────────┘
```

**When to call each step:**

| Step | When |
|------|------|
| `initialize_project` | First time you work with a project, or after `purge_index` |
| `backfill_history` | After initial indexing — unlocks churn metrics in `get_risk_profile` and `get_hotspots` |
| `re_tag_project` | After upgrading Cynapx, or after manually editing structural tag rules |
| `check_consistency` | Before a major analysis session; use `repair: true` if drift is detected |
| `purge_index` | When you want a clean slate — e.g., after a major rename or restructuring |

The **file watcher** runs continuously after `initialize_project`. It monitors the project directory for changes and triggers incremental re-indexing automatically. You do not need to call `initialize_project` again on every session start — Cynapx loads the persisted SQLite database from `~/.cynapx/`.

---

## 4. MCP Tool Reference

> **Session startup:** always call `get_setup_context` first to confirm the project is indexed. If `status` is `"NOT_INITIALIZED"`, run `initialize_project` before any other tool.

---

### 4.1 Setup & Lifecycle

---

#### `get_setup_context`

Check whether the current project is indexed and get a registry overview.

**Parameters:** none

**Returns:**

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | `"ALREADY_INITIALIZED"` or `"NOT_INITIALIZED"` |
| `current_path` | string | Absolute path Cynapx is pointed at |
| `registered_projects` | array | All projects in the global registry |
| `disk_usage_mb` | number | Total MB used by `~/.cynapx/` |
| `disk_warning` | string | Present only when `disk_usage_mb > 1024` |

**Example call:**

```
Tool: get_setup_context
(no parameters)
```

**Example output:**

```
Status: ALREADY_INITIALIZED
Current path: /home/user/my-project
Disk usage: 142 MB

Registered projects (3):
  • my-project       /home/user/my-project        nodes: 4821  edges: 18302
  • api-service      /home/user/api-service        nodes: 2104  edges: 7891
  • legacy-monolith  /home/user/legacy-monolith    nodes: 9340  edges: 41200
```

---

#### `initialize_project`

Parse a project and build the SQLite knowledge graph. Safe to call on an already-indexed project — it performs an incremental update rather than a full rebuild.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `mode` | `"current"` \| `"existing"` \| `"custom"` | required | `current` = use the path Cynapx was launched with; `existing` = re-index a project already in the registry; `custom` = specify an arbitrary path |
| `path` | string | — | Absolute path to the project. Required when `mode` is `"custom"` |
| `zero_pollution` | boolean | `true` | When `false`, writes a `.cynapx-config` anchor file to the project root |

**Returns:** Success message with total node and edge counts.

**Example call:**

```
Tool: initialize_project
mode: "custom"
path: "/home/user/my-project"
zero_pollution: true
```

**Example output:**

```
Project initialized: my-project
Path: /home/user/my-project
Nodes indexed: 4,821
Edges built:  18,302
Duration: 8.3s
```

---

#### `purge_index`

Permanently delete the SQLite knowledge graph for the current project.

> **Warning:** This is irreversible. Run `initialize_project` again to rebuild.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `confirm` | boolean | required | Must be `true` — safety gate to prevent accidental deletion |
| `unregister` | boolean | `false` | Also remove the project from `registry.json` |

**Example call:**

```
Tool: purge_index
confirm: true
unregister: false
```

**Example output:**

```
Index purged for: my-project (/home/user/my-project)
Database file deleted: ~/.cynapx/a3f9e1d2_v2.db
Registry entry retained (unregister: false)
```

---

#### `re_tag_project`

Re-run the full 5-pass structural tagging algorithm over every indexed node. This re-derives all `layer:*`, `role:*`, `domain:*`, and `trait:*` tags from the current graph topology.

**Parameters:** none

**Returns:** Count of re-tagged nodes.

**Example call:**

```
Tool: re_tag_project
(no parameters)
```

**Example output:**

```
Re-tagging complete.
Nodes re-tagged: 4,821
Pass breakdown:
  Pass 1 (layer inference):   2,341 nodes updated
  Pass 2 (role assignment):   1,204 nodes updated
  Pass 3 (domain grouping):     891 nodes updated
  Pass 4 (trait detection):     312 nodes updated
  Pass 5 (propagation):          73 nodes updated
Duration: 2.1s
```

---

#### `backfill_history`

Walk the Git log for all indexed files and map each commit to the symbols it touched. This populates the `churn` metric used by `get_risk_profile` and `get_hotspots`.

**Parameters:** none

**Returns:** Count of history entries added.

**Example call:**

```
Tool: backfill_history
(no parameters)
```

**Example output:**

```
Git history backfilled.
Commits scanned: 1,842
Symbol-commit mappings added: 23,409
Churn metrics now available for: 3,201 symbols
Duration: 14.7s
```

---

### 4.2 Symbol Navigation

---

#### `search_symbols`

Search the knowledge graph for symbols by name or description. Supports exact prefix matching (default) or vector similarity search when the Python sidecar is running.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `query` | string | required | Search term — matched against qualified names and descriptions |
| `symbol_type` | string | — | Filter by type: `class`, `method`, `function`, `field`, `interface`, `enum`, `module` |
| `limit` | number | `10` | Maximum number of results to return |
| `semantic` | boolean | `false` | Enable vector similarity search (requires Python ML sidecar to be running) |

**Returns:** Array of `{ qname, type, file, line, tags }`.

**Example call:**

```
Tool: search_symbols
query: "authenticate"
symbol_type: "method"
limit: 5
semantic: false
```

**Example output:**

```
Found 3 results for "authenticate" (type: method):

1. UserService.authenticate
   Type: method | File: src/services/UserService.ts:42
   Tags: layer:service, role:auth, domain:identity

2. OAuthProvider.authenticate
   Type: method | File: src/auth/OAuthProvider.ts:88
   Tags: layer:service, domain:identity

3. BasicAuthMiddleware.authenticate
   Type: method | File: src/middleware/BasicAuth.ts:15
   Tags: layer:api, role:middleware
```

---

#### `get_symbol_details`

Retrieve the full profile of a symbol: signature, location, structural tags, recent Git commits, complexity metrics, and source code snippet.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `qualified_name` | string | required | Fully qualified symbol name (e.g. `UserService.authenticate`) |
| `include_source` | boolean | `true` | Include the source code snippet (truncated at 100 lines) |
| `summary_only` | boolean | `false` | Return only metrics — skip source and commit history |

**Returns:** Formatted text block.

**Example call:**

```
Tool: get_symbol_details
qualified_name: "UserService.authenticate"
include_source: true
summary_only: false
```

**Example output:**

```
Symbol: UserService.authenticate
Type:   method
File:   src/services/UserService.ts  (line 42)
Tags:   layer:service · role:auth · domain:identity · trait:internal

Metrics:
  LOC:         38
  Cyclomatic:   7
  Fan-in:       4  (callers)
  Fan-out:      6  (callees)

Recent commits (last 3):
  a1b2c3d  2026-04-10  "fix: token expiry edge case in authenticate"
  d4e5f6a  2026-03-28  "refactor: extract TokenValidator from authenticate"
  b7c8d9e  2026-03-01  "feat: add MFA support to authenticate"

Source (lines 42–80):
  async authenticate(credentials: Credentials): Promise<AuthResult> {
    const user = await this.userRepo.findByEmail(credentials.email);
    if (!user) throw new UnauthorizedError('User not found');
    ...
  }
```

---

#### `get_callers`

List all symbols that directly call a given symbol (one hop of incoming `calls` edges).

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `qualified_name` | string | The symbol whose callers you want |

**Returns:** Array of `{ qname, file, line }`.

**Example call:**

```
Tool: get_callers
qualified_name: "UserService.authenticate"
```

**Example output:**

```
Callers of UserService.authenticate (4):

1. AuthController.login          src/controllers/AuthController.ts:29
2. SessionMiddleware.validate    src/middleware/SessionMiddleware.ts:54
3. ApiGateway.handleRequest      src/gateway/ApiGateway.ts:103
4. TestHelper.authenticateUser   tests/helpers/TestHelper.ts:17
```

---

#### `get_callees`

List all symbols directly called by a given symbol (one hop of outgoing `calls` edges).

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `qualified_name` | string | The symbol whose callees you want |

**Returns:** Array of `{ qname, file, line }`.

**Example call:**

```
Tool: get_callees
qualified_name: "UserService.authenticate"
```

**Example output:**

```
Callees of UserService.authenticate (6):

1. UserRepository.findByEmail     src/repositories/UserRepository.ts:18
2. PasswordHasher.verify          src/crypto/PasswordHasher.ts:35
3. TokenValidator.validate        src/auth/TokenValidator.ts:12
4. MfaService.check               src/auth/MfaService.ts:44
5. AuditLogger.logAuthAttempt     src/audit/AuditLogger.ts:67
6. EventBus.emit                  src/events/EventBus.ts:22
```

---

#### `get_related_tests`

Find test symbols that cover a given production symbol, using `tests` edges in the knowledge graph.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `qualified_name` | string | The production symbol to look up |

**Returns:** Array of test symbol qualified names.

**Example call:**

```
Tool: get_related_tests
qualified_name: "UserService.authenticate"
```

**Example output:**

```
Related tests for UserService.authenticate (3):

1. UserService.spec.authenticate_success
   tests/unit/UserService.spec.ts:34

2. UserService.spec.authenticate_invalid_password
   tests/unit/UserService.spec.ts:58

3. AuthController.spec.login_calls_authenticate
   tests/integration/AuthController.spec.ts:112
```

---

### 4.3 Architecture Analysis

---

#### `check_architecture_violations`

Detect structural rule violations across the entire project using the `layer:*`, `role:*`, and `domain:*` tags assigned during indexing.

**Parameters:** none

**Returns:** Array of violation objects.

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `"layer_violation"`, `"circular_dependency"`, or `"domain_violation"` |
| `source` | string | Qualified name of the violating symbol |
| `target` | string | Qualified name of the violated symbol |
| `message` | string | Human-readable description |

**Example call:**

```
Tool: check_architecture_violations
(no parameters)
```

**Example output:**

```
Architecture violations found: 3

[1] layer_violation
    Source: UserRepository.sendWelcomeEmail  (layer:db)
    Target: EmailService.send               (layer:service)
    Message: db layer symbol calls service layer symbol — lower layer must not depend on higher layer

[2] circular_dependency
    Source: OrderService.create             (layer:service)
    Target: OrderService.create             (layer:service)
    Path:   OrderService.create → InventoryService.reserve → OrderService.confirm → OrderService.create
    Message: Circular dependency cycle detected (length 3)

[3] domain_violation
    Source: PaymentGateway.charge           (domain:billing)
    Target: UserService.getProfile          (domain:identity)
    Message: Cross-domain direct call without an anti-corruption layer
```

---

#### `get_remediation_strategy`

Get a concrete refactoring plan to fix a specific architecture violation.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `violation` | object | A violation object returned by `check_architecture_violations` |

**Returns:** `{ strategy, steps[], effort, risk }`

**Example call:**

```
Tool: get_remediation_strategy
violation: {
  "type": "layer_violation",
  "source": "UserRepository.sendWelcomeEmail",
  "target": "EmailService.send",
  "message": "db layer symbol calls service layer symbol"
}
```

**Example output:**

```
Strategy: Extract and invert dependency via domain event

Steps:
  1. Remove the direct call to EmailService.send from UserRepository.sendWelcomeEmail
  2. Emit a UserCreated domain event from UserRepository instead
  3. Create an EmailNotificationHandler in the service layer that subscribes to UserCreated
  4. Register EmailNotificationHandler with the EventBus

Effort: Medium (estimated 2–4 hours)
Risk:   Low — no public API changes; event-driven decoupling is reversible
```

---

#### `discover_latent_policies`

Analyze the graph to surface implicit architectural conventions — patterns that exist in practice but have never been formally declared.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `threshold` | number | `0.8` | Minimum consistency ratio (0.0–1.0) for a pattern to be reported |
| `min_count` | number | `3` | Minimum occurrences before treating a pattern as a policy |

**Returns:** Array of `{ policy_id, description, confidence, examples[] }`.

**Example call:**

```
Tool: discover_latent_policies
threshold: 0.85
min_count: 5
```

**Example output:**

```
Latent policies discovered (2):

[POL-001] confidence: 0.94
  Description: All layer:db symbols that call external systems do so exclusively via
               symbols tagged role:gateway — no direct HTTP calls from db layer.
  Examples:
    • UserRepository → HttpGateway.get (not HttpClient.fetch)
    • OrderRepository → HttpGateway.post
    • ProductRepository → HttpGateway.put
    (+ 8 more)

[POL-002] confidence: 0.88
  Description: Every domain:auth symbol exposes at most one public method.
  Examples:
    • TokenValidator (1 public method: validate)
    • MfaService (1 public method: check)
    • SessionManager (1 public method: refresh)
    (+ 3 more)
```

---

### 4.4 Quality & Risk

---

#### `find_dead_code`

Identify symbols with `fan_in = 0` (nothing in the indexed codebase calls them), split into confidence tiers.

**Parameters:** none

**Returns:** Summary counts per tier, full symbol list for HIGH and MEDIUM, count-only for LOW.

| Tier | Criteria | False-Positive Rate | Recommended Action |
|------|----------|---------------------|--------------------|
| **HIGH** | `private` visibility + `fan_in = 0` | < 5% | Delete or document why it exists |
| **MEDIUM** | `public` + `trait:internal` tag + `fan_in = 0` | ~30% | Review in context before deleting |
| **LOW** | `public` + `fan_in = 0`, no `trait:internal` | > 80% | Likely external API surface — count only |

> **Note:** Static analysis does not resolve all dynamic call patterns (e.g., `this.registry[key]()`, reflection). MEDIUM and LOW tiers will always contain some false positives.

**Example call:**

```
Tool: find_dead_code
(no parameters)
```

**Example output:**

```
Dead code analysis complete.

HIGH confidence (11 symbols — review immediately):
  • InternalCache._evictStale          src/cache/InternalCache.ts:204   [private]
  • UserRepository._legacyFindAll      src/repositories/UserRepository.ts:341  [private]
  • (+ 9 more)

MEDIUM confidence (24 symbols — review with context):
  • ReportBuilder.buildLegacyPdf       src/reports/ReportBuilder.ts:88  [public, trait:internal]
  • (+ 23 more)

LOW confidence (103 symbols — likely external API surface, count only):
  103 public symbols with fan_in=0 and no trait:internal tag.
  These are probably intended to be called by consumers outside this codebase.
```

---

#### `get_hotspots`

Rank the top 20 symbols by a chosen complexity or coupling metric.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `metric` | string | required | One of: `cyclomatic`, `fan_in`, `fan_out`, `loc` |
| `threshold` | number | `0` | Only include symbols with a metric value above this threshold |

**Returns:** Top 20 symbols sorted descending by the chosen metric.

**Example call:**

```
Tool: get_hotspots
metric: "cyclomatic"
threshold: 10
```

**Example output:**

```
Top hotspots by cyclomatic complexity (threshold: 10):

Rank  Symbol                              CC   LOC  Fan-in  File
───────────────────────────────────────────────────────────────────────────
 1    OrderService.processCheckout        34   212     8    src/services/OrderService.ts:88
 2    ReportGenerator.buildSummary        28   178     3    src/reports/ReportGenerator.ts:44
 3    RulesEngine.evaluate                24   156    12    src/rules/RulesEngine.ts:201
 4    MigrationRunner.run                 19   134     1    src/db/MigrationRunner.ts:67
 5    PaymentGateway.charge               17    98     5    src/gateway/PaymentGateway.ts:33
(+ 15 more above threshold 10)
```

---

#### `get_risk_profile`

Calculate a composite risk score for a symbol, combining cyclomatic complexity, Git churn frequency, and structural coupling.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `qualified_name` | string | Symbol to profile |

**Returns:** `{ risk_score, complexity, churn, coupling, recommendations[] }`

**Example call:**

```
Tool: get_risk_profile
qualified_name: "OrderService.processCheckout"
```

**Example output:**

```
Risk Profile: OrderService.processCheckout

  Risk Score:  87 / 100  (HIGH)
  Complexity:  34 (cyclomatic)  — top 2% of codebase
  Churn:       42 commits in last 90 days  — very high
  Coupling:    fan_in=8, fan_out=14  — high coupling

Recommendations:
  1. Decompose processCheckout into smaller single-responsibility methods
     (target: CC < 10 per method)
  2. Introduce a CheckoutOrchestrator to reduce fan_out
  3. Add integration tests before any refactor — current test coverage: 2 related tests
  4. Backlog: review 42 recent commits for recurring bug patterns
```

---

#### `analyze_impact`

BFS traversal of incoming edges to enumerate every symbol that depends (directly or transitively) on a given symbol — the "ripple effect" of a change.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `qualified_name` | string | required | The symbol you plan to change |
| `max_depth` | number | `3` | BFS depth limit (higher = broader but slower) |
| `use_cache` | boolean | `true` | Use cached traversal results for repeat queries |

**Returns:** Array of `{ node, distance, impact_path }` sorted by distance ascending.

**Example call:**

```
Tool: analyze_impact
qualified_name: "UserRepository.findByEmail"
max_depth: 3
use_cache: true
```

**Example output:**

```
Impact analysis for: UserRepository.findByEmail
BFS depth: 3 | Affected symbols: 9

Distance 1 (direct callers):
  • UserService.authenticate         src/services/UserService.ts:42
    Path: UserRepository.findByEmail ← UserService.authenticate

  • PasswordResetService.initiate    src/services/PasswordResetService.ts:28
    Path: UserRepository.findByEmail ← PasswordResetService.initiate

Distance 2:
  • AuthController.login             src/controllers/AuthController.ts:29
  • SessionMiddleware.validate       src/middleware/SessionMiddleware.ts:54
  • PasswordResetController.request  src/controllers/PasswordResetController.ts:17

Distance 3:
  • ApiGateway.handleRequest         src/gateway/ApiGateway.ts:103
  • Router.dispatch                  src/Router.ts:55
  • IntegrationTest.loginFlow        tests/integration/AuthFlow.spec.ts:8
  • IntegrationTest.resetFlow        tests/integration/PasswordReset.spec.ts:22
```

---

### 4.5 Refactoring & Export

---

#### `propose_refactor`

Generate a risk-aware, step-by-step refactoring proposal for a symbol, taking its complexity, coupling, and dependent graph into account.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `qualified_name` | string | The symbol to refactor |

**Returns:** Proposal with suggested split points, estimated risk, and ordered steps.

**Example call:**

```
Tool: propose_refactor
qualified_name: "OrderService.processCheckout"
```

**Example output:**

```
Refactoring Proposal: OrderService.processCheckout (CC=34, risk=87)

Suggested split points:
  1. Extract validateCart(cart: Cart): ValidationResult
     — Lines 90–118: 7 independent validation branches
  2. Extract applyDiscounts(cart: Cart, user: User): Cart
     — Lines 119–154: discount logic with no side effects
  3. Extract reserveInventory(items: LineItem[]): Promise<ReservationResult>
     — Lines 155–189: calls InventoryService (can be async/queued)
  4. Extract chargePayment(total: Money, method: PaymentMethod): Promise<Receipt>
     — Lines 190–234: delegates entirely to PaymentGateway

Estimated risk: Medium
  — 8 callers affected; ensure all pass through a facade method
    that delegates to the new sub-methods for a zero-diff refactor

Ordered steps:
  1. Write characterization tests covering processCheckout current behavior (2 tests missing)
  2. Extract validateCart → run tests green
  3. Extract applyDiscounts → run tests green
  4. Extract reserveInventory → run tests green
  5. Extract chargePayment → run tests green
  6. Rename processCheckout → orchestrateCheckout and update 8 callers
```

---

#### `export_graph`

Export a subgraph (or the full project graph) as a Mermaid diagram and structured JSON.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `root_qname` | string | — | Root symbol. Omit to export the full project graph |
| `max_depth` | number | `2` | Hops from root to include |

**Returns:** Mermaid `graph LR` diagram + `{ nodes[], edges[] }` JSON.

**Example call:**

```
Tool: export_graph
root_qname: "UserService.authenticate"
max_depth: 2
```

**Example output:**

```
Mermaid diagram:

graph LR
  A["UserService.authenticate\n(method)"]
  B["UserRepository.findByEmail\n(method)"]
  C["PasswordHasher.verify\n(method)"]
  D["TokenValidator.validate\n(method)"]
  E["AuditLogger.logAuthAttempt\n(method)"]
  F["AuthController.login\n(method)"]
  G["SessionMiddleware.validate\n(method)"]
  A --> B
  A --> C
  A --> D
  A --> E
  F --> A
  G --> A

JSON summary:
{
  "nodes": [
    { "qname": "UserService.authenticate", "type": "method", "tags": ["layer:service"] },
    ...
  ],
  "edges": [
    { "from": "UserService.authenticate", "to": "UserRepository.findByEmail", "type": "calls" },
    ...
  ]
}
```

---

#### `check_consistency`

Verify that the knowledge graph reflects the current state of the files on disk and in Git. Detects stale nodes for deleted files, missing symbols from newly added files, and checksum mismatches.

**Parameters:**

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `repair` | boolean | `false` | Automatically repair any detected inconsistencies |
| `force` | boolean | `false` | Force a full re-scan even if file checksums match |

**Returns:** Consistency report listing pass/fail for each check, plus any repaired items.

**Example call:**

```
Tool: check_consistency
repair: true
force: false
```

**Example output:**

```
Consistency check complete.

Checks:
  [PASS] Registry entry matches current path
  [PASS] SQLite schema version: v2
  [WARN] 3 stale nodes found (files deleted from disk)   → repaired
  [WARN] 1 file modified since last index                → repaired (incremental re-index)
  [PASS] Edge referential integrity
  [PASS] Git HEAD matches backfilled history tip

Repaired:
  - Removed 3 stale nodes for deleted files
  - Re-indexed: src/services/NewFeature.ts (modified 2026-04-17)

Graph is now consistent.
```

---

## 5. Admin CLI Reference

The `cynapx-admin` binary (also available as `node /path/to/Cynapx/dist/cli/admin.js`) provides a command-line dashboard for managing all registered projects across your machine.

### `status`

Full dashboard overview of every registered project, including node/edge counts and database sizes.

```bash
cynapx-admin status
```

```
Cynapx Registry — 3 projects

  Project           Path                          Nodes   Edges   DB Size   Last Indexed
  ──────────────────────────────────────────────────────────────────────────────────────
  my-project        /home/user/my-project          4821   18302   48 MB     2026-04-17
  api-service       /home/user/api-service         2104    7891   21 MB     2026-04-16
  legacy-monolith   /home/user/legacy-monolith     9340   41200   98 MB     2026-04-10

Total disk usage: 167 MB  (~/.cynapx/)
```

### `list`

Compact one-line-per-project table (useful for scripting).

```bash
cynapx-admin list
```

```
my-project       /home/user/my-project
api-service      /home/user/api-service
legacy-monolith  /home/user/legacy-monolith
```

### `inspect <name>`

Detailed stats for one project. Accepts project name or project path.

```bash
cynapx-admin inspect my-project
# or
cynapx-admin inspect /home/user/my-project
```

```
Project: my-project
Path:    /home/user/my-project
DB:      ~/.cynapx/a3f9e1d2_v2.db  (48 MB)
Schema:  v2

Nodes:  4,821
  class:      142
  method:    2,104
  function:    891
  field:     1,684

Edges:  18,302
  calls:      9,841
  contains:   6,204
  imports:    1,891
  inherits:     248
  implements:    98
  overrides:     20

Last indexed:  2026-04-17T14:32:11Z
Git HEAD:      a1b2c3d (2026-04-17 "feat: add MFA support")
History:       23,409 symbol-commit mappings
```

### `doctor`

Detect stale or broken registry entries (projects whose paths no longer exist on disk, or whose DB files are missing).

```bash
cynapx-admin doctor
```

```
Registry doctor — scanning 3 entries...

  [OK]   my-project       /home/user/my-project
  [OK]   api-service      /home/user/api-service
  [WARN] legacy-monolith  /home/user/legacy-monolith  — project path not found on disk

1 issue detected. Run `cynapx-admin unregister legacy-monolith` to clean up.
```

### `purge <name>`

Delete the SQLite database files for a project. The registry entry is kept unless `--yes` is combined with `unregister`.

```bash
cynapx-admin purge my-project
# or skip the confirmation prompt:
cynapx-admin purge my-project --yes
```

```
Purging index for: my-project
  DB file: ~/.cynapx/a3f9e1d2_v2.db (48 MB)

Confirm deletion? [y/N]: y
Deleted. Registry entry retained.
```

### `unregister <name>`

Remove a project from `registry.json`. The database files are kept on disk (use `purge` to delete them).

```bash
cynapx-admin unregister legacy-monolith --yes
```

```
Unregistered: legacy-monolith
Registry entry removed. DB files retained at ~/.cynapx/9f8c3b21_v2.db
```

### `compact`

Run SQLite `VACUUM` on all project databases to reclaim deleted-row space.

```bash
cynapx-admin compact --yes
```

```
Compacting 3 databases...
  my-project:       48 MB → 41 MB  (saved 7 MB)
  api-service:      21 MB → 21 MB  (no change)
  legacy-monolith:  98 MB → 79 MB  (saved 19 MB)

Total reclaimed: 26 MB
```

### `backup <name>`

Create a timestamped backup of a project's database in `~/.cynapx/backups/`.

```bash
cynapx-admin backup my-project
```

```
Backup created:
  Source:  ~/.cynapx/a3f9e1d2_v2.db
  Target:  ~/.cynapx/backups/my-project-2026-04-18T06-43-39/
           ├── meta.json
           └── a3f9e1d2_v2.db

Backup size: 48 MB
```

### `restore <backup-path>`

Restore a project database from a backup directory. The current database is overwritten.

```bash
cynapx-admin restore ~/.cynapx/backups/my-project-2026-04-18T06-43-39 --yes
```

```
Restoring from: ~/.cynapx/backups/my-project-2026-04-18T06-43-39/
  meta.json: project=my-project, backed-up=2026-04-18T06:43:39Z
  Overwriting: ~/.cynapx/a3f9e1d2_v2.db

Restore complete. Re-run initialize_project to sync with any file changes since backup.
```

---

## 6. Real-World Workflows

### 6.1 Understanding an Unfamiliar Codebase

You've just joined a project or need to quickly understand an unfamiliar service. Use Cynapx to build a mental map without reading every file.

**Step 1 — Confirm the project is indexed**

```
Tool: get_setup_context
```

If `status` is `NOT_INITIALIZED`, run `initialize_project` → `backfill_history` → `re_tag_project` first.

**Step 2 — Search for the entry point or concept you care about**

```
Tool: search_symbols
query: "checkout"
symbol_type: "method"
limit: 10
```

Review the results and pick the most relevant symbol (e.g., `OrderService.processCheckout`).

**Step 3 — Get the full profile of the symbol**

```
Tool: get_symbol_details
qualified_name: "OrderService.processCheckout"
include_source: true
summary_only: false
```

Read the metrics, recent commits, and source snippet to understand what it does and how it has evolved.

**Step 4 — Walk the call graph in both directions**

```
Tool: get_callers
qualified_name: "OrderService.processCheckout"
```

```
Tool: get_callees
qualified_name: "OrderService.processCheckout"
```

This gives you a two-hop picture of the surrounding architecture: what triggers checkout (callers) and what checkout depends on (callees).

**Step 5 — Visualize the subgraph**

```
Tool: export_graph
root_qname: "OrderService.processCheckout"
max_depth: 2
```

Paste the Mermaid output into a renderer (e.g., GitHub, mermaid.live) for a visual diagram. Use the JSON output to build a custom view if needed.

**Outcome:** In under 10 minutes you have the symbol's metrics, its recent change history, its complete two-hop neighborhood, and a visual diagram — without reading a single file end-to-end.

---

### 6.2 Pre-Change Impact Analysis

Before modifying `UserRepository.findByEmail`, you need to know what will break and whether the change is safe.

**Step 1 — Map the ripple effect**

```
Tool: analyze_impact
qualified_name: "UserRepository.findByEmail"
max_depth: 3
use_cache: false
```

The output lists every symbol that transitively depends on `findByEmail`, ordered by distance. This tells you how many call sites you need to update or verify.

**Step 2 — Assess the risk of the symbol itself**

```
Tool: get_risk_profile
qualified_name: "UserRepository.findByEmail"
```

Check `risk_score`, `churn`, and `coupling`. High churn means this symbol is frequently changed and bugs may be lurking; high `fan_in` means many things depend on it.

**Step 3 — Find the tests that cover it**

```
Tool: get_related_tests
qualified_name: "UserRepository.findByEmail"
```

Review the list. If coverage is thin (fewer tests than callers), write characterization tests before making the change.

**Step 4 — If the symbol is complex, get a refactor proposal first**

```
Tool: propose_refactor
qualified_name: "UserRepository.findByEmail"
```

Even if you are not refactoring today, the proposal tells you the natural split points — which is useful context for keeping your change minimal and safe.

**Outcome:** You now know: how many symbols your change affects, how risky the symbol is, whether tests exist to catch regressions, and what a clean change boundary looks like.

---

### 6.3 Technical Debt Sprint

You have a sprint to reduce technical debt. Use Cynapx to identify and prioritize what to fix, then get concrete plans.

**Step 1 — Find the most complex symbols**

```
Tool: get_hotspots
metric: "cyclomatic"
threshold: 10
```

The top 20 results are your primary refactoring candidates. Also run with `metric: "fan_out"` to find symbols with excessive dependencies.

**Step 2 — Find unused code to delete**

```
Tool: find_dead_code
```

Focus on HIGH-tier results first — these are private symbols with `fan_in = 0` and less than 5% false-positive rate. Deleting them immediately reduces maintenance burden.

**Step 3 — Check for architecture violations**

```
Tool: check_architecture_violations
```

Each violation is a structural debt item. Note the `type` and affected symbols.

**Step 4 — Get remediation plans for violations**

For each violation returned in Step 3:

```
Tool: get_remediation_strategy
violation: { <paste violation object from Step 3> }
```

The response includes `effort` and `risk` estimates — use these to prioritize which violations to tackle in this sprint vs. backlog.

**Step 5 — Discover hidden conventions that should be formalized**

```
Tool: discover_latent_policies
threshold: 0.85
min_count: 5
```

Policies with high confidence (> 0.9) are good candidates for Architecture Decision Records (ADRs) or linter rules, preventing the same violations from recurring.

**Outcome:** A prioritized, evidence-based debt backlog with concrete steps and effort estimates for each item.

---

## 7. Storage & Data Management

### Full `~/.cynapx/` Layout

```
~/.cynapx/
├── registry.json                         # All registered project paths + metadata
├── audit.log                             # NDJSON audit trail of all tool calls
├── locks/                                # Per-project process lock files
│   └── a3f9e1d2.lock
├── profiles/                             # Per-project configuration profiles
│   └── a3f9e1d2.profile.json
├── backups/                              # Timestamped backup directories
│   └── my-project-2026-04-18T06-43-39/
│       ├── meta.json                     # Backup metadata (project name, timestamp, source hash)
│       └── a3f9e1d2_v2.db               # Copy of the SQLite database at backup time
└── a3f9e1d2_v2.db                        # SQLite knowledge graph for "my-project"
    (one _v2.db per registered project — filename is a hash of the project's absolute path)
```

**`registry.json` format (excerpt):**

```json
{
  "projects": [
    {
      "name": "my-project",
      "path": "/home/user/my-project",
      "hash": "a3f9e1d2",
      "registeredAt": "2026-03-15T10:22:00Z",
      "lastIndexed": "2026-04-17T14:32:11Z"
    }
  ]
}
```

**`audit.log` format (NDJSON, one entry per line):**

```json
{"ts":"2026-04-18T06:00:01Z","tool":"analyze_impact","args":{"qualified_name":"UserService.authenticate"},"durationMs":142}
```

### Backup & Restore Workflow

**Create a backup before any risky operation (major refactor, Cynapx upgrade, purge):**

```bash
cynapx-admin backup my-project
```

**List available backups:**

```bash
ls ~/.cynapx/backups/
# my-project-2026-04-18T06-43-39/
# my-project-2026-04-10T09-12-55/
```

**Restore from a backup:**

```bash
cynapx-admin restore ~/.cynapx/backups/my-project-2026-04-18T06-43-39 --yes
```

After restoring, run `check_consistency repair: true` to re-sync with any file changes that occurred after the backup was taken.

### Uninstall Instructions

**Remove data for a single project:**

```bash
# Via MCP tool (while Cynapx is running):
Tool: purge_index
confirm: true
unregister: true

# Or via admin CLI:
cynapx-admin purge my-project --yes
cynapx-admin unregister my-project --yes
```

**Remove all Cynapx data (complete uninstall):**

```bash
rm -rf ~/.cynapx/
```

Then remove the `cynapx` entry from `.mcp.json` and optionally delete the cloned repository:

```bash
rm -rf /path/to/Cynapx
```

---

## 8. Supported Languages

| Language | Extension(s) | Notes |
|----------|-------------|-------|
| TypeScript | `.ts`, `.tsx` | Full type-aware edge extraction via TypeScript Compiler API. Most accurate call/inherits/implements edges. |
| JavaScript | `.js`, `.jsx` | AST-based via Tree-sitter. No type inference; some dynamic calls unresolvable. |
| Python | `.py` | Includes inheritance, import, and decorator edges. |
| Go | `.go` | Struct methods, interfaces, goroutine calls. |
| Java | `.java` | Classes, interfaces, constructors, annotations. |
| C | `.c`, `.h` | Functions, structs, enums, macro definitions. |
| C++ | `.cpp`, `.hpp` | Classes, namespaces, templates, operator overloads. |
| C# | `.cs` | Classes, interfaces, properties, extension methods. |
| Kotlin | `.kt` | Classes, interfaces, data classes, extension functions. |
| PHP | `.php` | Functions, classes, traits, methods. |
| Rust | `.rs` | Functions, structs, traits, impls, lifetimes (as annotations). |
| GDScript | `.gd` | Classes, functions (Godot Engine 4.x). |

TypeScript is the most feature-complete provider — it uses the full compiler API rather than Tree-sitter alone, which means type-resolved edges (e.g., resolving a method call through an interface to its concrete implementation) are available only for TypeScript projects.

---

## 9. Extending Language Support

Cynapx supports adding new languages via the `LanguageProvider` extension point.

### Interface

Implement the `LanguageProvider` interface defined in the Cynapx source (`src/language/LanguageProvider.ts`):

```typescript
interface LanguageProvider {
  // File extensions this provider handles (e.g. ['.rb', '.rbw'])
  extensions: string[];

  // Parse a file and return symbols + edges
  parse(filePath: string, source: string): Promise<ParseResult>;

  // Optional: resolve cross-file type edges after all files are parsed
  resolveTypes?(graph: MutableGraph): Promise<void>;
}

interface ParseResult {
  symbols: Symbol[];
  edges: Edge[];
}
```

### Installation

1. Implement the interface in TypeScript (or compile to `.js`)
2. Place the compiled `.js` file in `~/.cynapx/plugins/`
3. Restart Cynapx — the plugin registry auto-discovers and loads all providers in that directory

### Example

A fully annotated example for Ruby is provided in the Cynapx repository at [`examples/ruby-language-provider.ts`](./examples/ruby-language-provider.ts).

### Notes

- A custom provider runs in the same process as Cynapx — it has access to the full Node.js API
- Providers are loaded in alphabetical order; built-in providers take precedence for extensions they already handle
- If your provider throws during `parse()`, the file is skipped and an error is recorded in `audit.log`

---

**Cynapx** — maintained by [Feel-o-sofa](https://github.com/Feel-o-sofa)
