# 🧠 Cynapx 완벽 가이드 v1.0.0
### "GitHub 기반 지능형 아키텍처 분석 엔진"

Cynapx는 고성능 지식 그래프 엔진입니다. 이 가이드는 GitHub를 통해 Cynapx를 설치하고 운영하는 방법에 집중합니다.

---

## 2. 시작하기: 설치 및 에이전트 등록

### 2.1 설치 방법
NPM 공식 저장소 대신 GitHub에서 직접 최신 버전을 설치할 수 있습니다:
```bash
npm install -g Feel-o-sofa/cynapx
```

### 2.2 GitHub(npx)를 통한 MCP 등록
`npx`를 사용하면 별도의 설치 없이도 항상 저장소의 최신 버전을 유지하며 실행할 수 있습니다.

#### 💎 Gemini CLI
```powershell
gemini mcp add cynapx "npx" "--" "-y" "github:Feel-o-sofa/cynapx" "--path" "$PWD"
```

#### 🤖 Claude Code
`mcp_config.json`을 다음과 같이 수정하세요:
```json
{
  "mcpServers": {
    "cynapx": {
      "command": "npx",
      "args": ["-y", "github:Feel-o-sofa/cynapx", "--path" "$PWD"]
    }
  }
}
```

---

## 4. 운영 모드

### 4.1 One-shot CLI 모드
GitHub를 통해 설치한 경우 `cynapx` 명령어를 직접 쓰거나 `npx`로 즉시 실행할 수 있습니다:
```bash
npx github:Feel-o-sofa/cynapx check_architecture_violations
```

---
**관리자: [Feel-o-sofa](https://github.com/Feel-o-sofa)**
