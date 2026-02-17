# 🧠 Cynapx Definitive Guide v1.0.0
### "Intelligent Architecture Analysis Engine via GitHub"

Cynapx is a high-performance knowledge graph engine. This guide focuses on how to leverage Cynapx using direct GitHub integration.

---

[🏠 Home (EN)](./README.md) | [🏠 홈 (KR)](./README_KR.md) | [📖 사용자 가이드 (KR)](./GUIDE_KR.md)

---

## 2. Getting Started: Installation & Registration

### MCP Registration via GitHub (npx)
Using `npx` allows you to always use the latest version from the repository without manual updates.

#### 💎 Gemini CLI
```powershell
gemini mcp add cynapx "npx" "--" "-y" "github:Feel-o-sofa/cynapx" "--path" "$PWD"
```

#### 🤖 Claude Code
Edit your `mcp_config.json`:
```json
{
  "mcpServers": {
    "cynapx": {
      "command": "npx",
      "args": ["-y", "github:Feel-o-sofa/cynapx", "--path", "$PWD"]
    }
  }
}
```

---

## 4. Operation Modes

### 4.1 One-shot CLI Mode
If installed via GitHub, use `cynapx` directly or via `npx`:
```bash
npx github:Feel-o-sofa/cynapx check_architecture_violations
```

---
**Maintained by [Feel-o-sofa](https://github.com/Feel-o-sofa)**
