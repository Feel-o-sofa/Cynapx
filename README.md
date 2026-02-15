# 🧠 Cynapx v1.0.0
### High-Performance AI-Native Code Knowledge Engine

**Cynapx** is a high-performance, isolated code analysis engine designed for AI agents and developers. It transforms your codebase into a multi-dimensional knowledge graph, enabling LLMs to understand complex architectures and relationships instantly.

---

## 🌟 Why Cynapx?
- **Relationship-First**: Extracts inheritance, implementation, and call relationships.
- **Zero-Pollution**: No files created in your project directory; all data is kept in `~/.cynapx/`.
- **Global Ledger**: Ensures 100% data integrity via self-verification.
- **AI-Native**: Smart context pruning and instruction injection for token efficiency.

---

## 🚀 Quick Start (GitHub Based)

You can now install or run Cynapx directly from GitHub without searching through NPM.

### 1. Installation
```bash
# Install globally via GitHub
npm install -g Feel-o-sofa/cynapx
```

### 2. Registration with AI Agents (MCP)

#### 💎 Gemini CLI
```powershell
# Point directly to the GitHub repository using npx
gemini mcp add cynapx "npx" "--" "-y" "github:Feel-o-sofa/cynapx" "--path" "$PWD"
```

#### 🤖 Claude Code
Add the following to your MCP configuration:
```json
{
  "mcpServers": {
    "cynapx": {
      "command": "npx",
      "args": ["-y", "github:Feel-o-sofa/cynapx", "--path", "/your/project/path"]
    }
  }
}
```

#### 💻 OpenAI Codex / Custom Agents
```bash
# If installed globally
codex mcp add cynapx -- npx cynapx --path "$PWD"
```

---

## 🛠️ Key Capabilities
- `check_architecture_violations`: Detect layer/domain violations and Circular Dependencies.
- `get_remediation_strategy`: Get 3-step refactoring guides for detected violations.
- `get_risk_profile`: Multi-dimensional risk score based on Git churn and complexity.
- `export_graph`: Visual Mermaid diagrams + JSON structural summaries.

---

## 🛡️ Security & License
- **Path Traversal Guard**: Securely isolated analysis.
- **License**: MIT License.

**Cynapx** - Maintained by [Feel-o-sofa](https://github.com/Feel-o-sofa)
