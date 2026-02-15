# 🧠 Cynapx v1.0.5
### High-Performance AI-Native Code Knowledge Engine

**Cynapx** is a high-performance, isolated code analysis engine designed for AI agents and developers. By transforming your codebase into a multi-dimensional knowledge graph, it enables LLMs (like Gemini) to instantly understand complex architectures, inheritance hierarchies, and call relationships without manual context gathering.

---

## 🌟 Why Cynapx?

### 1. Relationship-First Approach
Simple text searches (`grep`) miss logical connections. Cynapx precisely extracts **inheritance**, **implementation**, and **call** relationships to visualize the "neural network" of your code.

### 2. Semantic Clustering
Using Jaccard similarity and graph topology analysis, Cynapx automatically classifies your system into **Core** domain logic and **Utility** modules. AI agents use this to immediately identify critical components.

### 3. Conservation of Integrity
Our **Global Ledger** system constantly verifies that `SUM(fan_in) == SUM(fan_out)`. We provide only flawless indices to your agents, ensuring zero data corruption.

### 4. Zero-Pollution (Pure Isolation)
Cynapx never creates files within your project directory. All knowledge data is managed in a central isolated storage (`~/.cynapx/`).

---

## 🌐 Supported Languages

Cynapx currently supports **12** major languages:

- **Web**: TypeScript, JavaScript, PHP
- **System**: C, C++, Rust, Go
- **Enterprise**: Java, Kotlin, C#
- **Scripting**: Python, GDScript

---

## 🛠️ Tools & Capabilities (MCP Interface)

Cynapx provides the following tools to AI agents via the **Model Context Protocol (MCP)**:

### 🔍 Discovery & Search
- `search_symbols`: Global symbol search powered by FTS5 (supports filtering by type, language, and visibility).
- `get_symbol_details`: Signature, complexity metrics, and smart source code snippets.

### 📈 Graph Analysis
- `get_callers` / `get_callees`: Trace callers and callees of specific functions.
- `analyze_impact`: Transitively analyze all nodes affected by a specific symbol change.
- `get_related_tests`: Instantly find test code associated with production code.

### 💡 Intelligent Insights
- `check_architecture_violations`: Detect layer violations, domain isolation issues, and **Circular Dependencies**.
- `get_remediation_strategy`: Professional refactoring strategies (DIP, Interface extraction) for detected violations.
- `get_risk_profile`: Multi-dimensional risk score based on Git churn, complexity, and coupling.
- `export_graph`: Export symbol-centric relationship maps as **Mermaid.js** diagrams with structured JSON summaries.

---

## 🚀 Quick Start

### 1. Install Cynapx
```bash
npm install -g cynapx
```

### 2. Register with AI Agent (MCP)

#### Gemini CLI (Recommended)
```powershell
# Windows PowerShell
gemini mcp add cynapx "npx" "--" "cynapx" "--path" "$PWD"
```

---

## 🛡️ Security & Integrity

- **Path Traversal Guard**: Blocks access to files outside the project root.
- **Atomic Updates**: All index updates are transactional; the last known good state is preserved on failure.
- **AI-Native Optimization**: Includes smart context pruning and instruction injection for maximum token efficiency.

---

## 📄 License

This project is licensed under the **MIT License**.
**Cynapx** - Connecting the neural network of your code.
