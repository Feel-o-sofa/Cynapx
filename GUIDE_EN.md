# 🧠 Cynapx Definitive Guide v1.0.5
### "Intelligent Architecture Analysis Engine Connecting the Neural Network of Code"

Cynapx is a **high-performance knowledge graph engine** designed to help AI agents and engineers understand large codebases like humans and design them like architects.

---

## 📋 Table of Contents
1. [Introduction: Intelligence Beyond Code](#1-introduction-intelligence-beyond-code)
2. [Getting Started: Installation & Registration](#2-getting-started-installation--registration)
3. [Intelligent Tools for AI Agents (Phases 12-14)](#3-intelligent-tools-for-ai-agents-phases-12-14)
4. [Operation Modes: Stdio, HTTP, and One-shot CLI](#4-operation-modes-stdio-http-and-one-shot-cli)
5. [Core Technologies: Integrity & AI-Native Optimization](#5-core-technologies-integrity--ai-native-optimization)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. Introduction: Intelligence Beyond Code

Standard text searches (`grep`) fail to capture **"design intent."** Cynapx transforms your code into a **living knowledge graph**, providing high-level insights beyond mere information retrieval.

*   **Relationship-First**: Transitively track inheritance, implementation, and static/dynamic call relationships.
*   **Architecture-Aware**: Understand symbol visibility (Public/Private) and context to identify true design flaws.
*   **Zero-Pollution**: No configuration files are created in your project directory; all data is kept in a central, isolated vault.
*   **Global Ledger**: Every call relationship is recorded in a ledger, ensuring 100% data integrity via self-verification.

---

## 2. Getting Started: Installation & Registration

### 2.1 Prerequisites
Cynapx uses native `tree-sitter` bindings for high-performance parsing. Build tools are required for your OS:
*   **Windows**: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (Desktop development with C++)
*   **macOS/Linux**: `xcode-select --install` or `build-essential`

### 2.2 Installation
```bash
# Install globally via NPM
npm install -g cynapx
```

### 2.3 Registration (e.g., Gemini CLI)
Cynapx fully supports the **Model Context Protocol (MCP)**.
```powershell
# Windows PowerShell
gemini mcp add cynapx "npx" "--" "cynapx" "--path" "$PWD"
```

---

## 3. Intelligent Tools for AI Agents (Phases 12-14)

Cynapx v1.0.5 includes a powerful toolset to support agent decision-making.

### 🛡️ Architectural Diagnosis & Remediation
*   **check_architecture_violations**: Automatically detects layer violations, domain isolation issues, and **Circular Dependencies**.
*   **get_remediation_strategy**: Provides professional refactoring strategies (e.g., DIP, Interface extraction) via a 3-step guide for detected violations.

### ⚠️ Risk Analysis & Policy Discovery
*   **get_risk_profile**: Calculates a **Danger Score** based on Git churn, complexity, and coupling.
*   **discover_latent_policies**: Identifies and proposes **latent architectural rules** that are statistically followed but not explicitly defined.

### 📊 Intelligent Visualization
*   **export_graph**: Visualizes complex relationships as Mermaid diagrams while simultaneously returning a **JSON Data Summary** for direct parsing by the agent.

---

## 4. Operation Modes: Stdio, HTTP, and One-shot CLI

### 4.1 Stdio Mode (Default for Agents)
Cynapx communicates directly with the agent via pipes. This offers the highest security and lowest latency.

### 4.2 One-shot CLI Mode (New)
Execute analysis commands directly from the terminal without starting an MCP server.
```bash
# Check architectural violations instantly
npx cynapx check_architecture_violations

# Analyze risk for a specific symbol
npx cynapx get_risk_profile --qualified_name "src/main.ts#Main"
```

---

## 5. Core Technologies: Integrity & AI-Native Optimization

### ⚡ AI-Native Token Optimization
*   **Smart Context Pruning**: Long source codes (>100 lines) are intelligently summarized to respect the agent's context window.
*   **Instruction Injection**: Automatically injects the **'Cynapx Operator Manual'** upon connection, guiding the agent to use tools effectively.

### 🔍 Precision Tagging System
*   **Visibility Awareness**: Marks Private/Protected methods as `trait:internal` to prevent unnecessary role propagation and false positives.
*   **Contextual Filtering**: Recognizes calls within the same class/file as 'self-calls' and excludes them from violation reports.

---

## 6. Troubleshooting

### Q1. Search results differ from the actual code.
*   **Fix**: Run `npx cynapx check_consistency --repair` to sync the index with your filesystem.

### Q2. Too many architectural violations are reported.
*   **Fix**: Run `npx cynapx re_tag_project` to apply the latest precision tagging rules. This will remove most 'self-call' noise.

---

**Experience 'Development by Design' with Cynapx!**
