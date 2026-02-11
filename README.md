# Cynapx MCP - High-Performance AI-Native Code Knowledge Engine

**Cynapx** is a high-performance, isolated code analysis engine built for AI agents and developers. It builds a multi-dimensional knowledge graph of your codebase, allowing LLMs like Gemini to understand complex architectures, dependencies, and code quality without manual context-gathering.

## ❌ Without Cynapx

AI agents struggle to see the "big picture" of large projects. They often:
- ❌ Rely on shallow grep searches that miss logical connections.
- ❌ Lack understanding of call hierarchies and ripple effects.
- ❌ Waste tokens reading irrelevant files to find definitions.
- ❌ Hallucinate impacts of code changes due to missing context.

## ✅ With Cynapx

Cynapx provides a deep, graph-based understanding of your code. Your AI agent gains:
- ✅ **Instant Symbol Discovery**: Find any function, class, or variable with full metadata.
- ✅ **Impact Analysis**: Automatically trace what will break if you modify a specific symbol.
- ✅ **Quality Metrics**: Identify technical debt via Cyclomatic Complexity and Coupling (Fan-in/out).
- ✅ **Visual Architecture**: Export logic-flow diagrams directly into the chat using Mermaid.

---

## Quick Start

### Installation

```bash
# Install the package (local tgz or from npm)
npm install ./cynapx-0.1.0.tgz
```

### Setup in Gemini CLI

Register Cynapx as an MCP server to enable specialized slash commands and deep analysis tools.

```bash
# Replace /your/project/path with the absolute path to your codebase
gemini mcp add cynapx "npx" "--" "cynapx" "--path" "/your/project/path" -e MCP_MODE=true
```

### Verification

Inside Gemini CLI, run:
```bash
/mcp
```
You should see `cynapx` listed as a connected server with tools like `search_symbols`, `analyze_impact`, etc.

---

## Core Capabilities

### 🛠️ Analysis Tools (MCP Tools)

- `search_symbols`: Search for any symbol with FTS5-powered indexing.
- `get_symbol_details`: View detailed metrics and **real-time source code** for any symbol.
- `analyze_impact`: Trace incoming dependencies to predict the ripple effect of changes.
- `get_hotspots`: Detect "dangerous" code areas with high complexity or tight coupling.
- `export_graph`: Generate **Mermaid.js** diagrams centered around specific symbols.
- `check_consistency`: Ensure the index is perfectly synced with your filesystem and Git state.

### 📄 Live Resources (MCP Resources)

- `graph://summary`: Get a snapshot of your project's knowledge density (nodes, edges, files).

### 💡 Workflow Prompts (MCP Prompts)

- `/explain-impact`: Ask the AI to perform a risk assessment for a specific code change.
- `/check-health`: Request a diagnostic report on the current index and project health.

---

## Security & Sandboxing

Cynapx is built with a **Zero-Pollution** philosophy. It never writes files to your project directory; all index data is stored in a central isolated directory (`~/.cynapx/`).

### Recommended Sandbox Setup (Docker)

For high-security environments, run Cynapx in a Read-Only container:

```bash
docker run -i --rm \
  -v "/your/project/path:/workspace:ro" \
  -v "$HOME/.cynapx:/root/.cynapx" \
  cynapx-image --path /workspace
```

### Protection Layers
- **Path Traversal Guard**: Built-in validation ensures the server never reads files outside your project root.
- **SQL Injection Shield**: Whitelisted metric queries prevent malicious database manipulation.
- **Privacy First**: No personal data, machine identifiers, or SSH keys are ever indexed or transmitted.

---

## Advanced Usage

### Hybrid Synchronization
Cynapx uses a unique **Hybrid Sync** logic. Every time the server starts, it reconciles your index using:
1. **Git State**: Rapidly catches up with commits and branch switches.
2. **File Checksums**: Detects local, uncommitted changes that Git might miss.
3. **Real-time Watcher**: Actively monitors and updates the graph as you type.

### Command Line Interface
You can also run Cynapx as a standalone API server:
```bash
npx cynapx --path "./my-project" --port 3000
```

---

## License

Internal proprietary software. All rights reserved.
