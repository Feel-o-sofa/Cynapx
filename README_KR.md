# 🧠 Cynapx (시냅스엑스) v1.0.0
### 고성능 AI-Native 코드 지식 엔진

**Cynapx**는 AI 에이전트와 개발자를 위한 고성능 격리형 코드 분석 엔진입니다. 코드베이스를 다차원 지식 그래프로 변환하여 LLM이 복잡한 구조와 관계를 즉각적으로 이해할 수 있게 돕습니다.

---

## 🌟 왜 Cynapx인가요?
- **관계 중심**: 상속, 구현, 호출 관계를 정밀하게 추출합니다.
- **무결성(Zero-Pollution)**: 프로젝트 폴더를 더럽히지 않고 `~/.cynapx/`에서 관리됩니다.
- **전역 장부**: 모든 데이터 정합성을 스스로 검증하여 신뢰할 수 있는 인덱스를 제공합니다.
- **AI 최적화**: 토큰 효율을 위한 스마트 프루닝 및 운영 지침 주입 기능을 내장했습니다.

---

## 🚀 빠른 시작 (GitHub 기반)

NPM 검색 없이 GitHub 주소만으로 바로 설치하고 실행할 수 있습니다.

### 1. 설치 방법
```bash
# GitHub 저장소를 통해 전역 설치
npm install -g Feel-o-sofa/cynapx
```

### 2. AI 에이전트 등록 (MCP)

#### 💎 Gemini CLI
```powershell
# npx를 사용하여 GitHub 저장소에서 즉시 등록
gemini mcp add cynapx "npx" "--" "-y" "github:Feel-o-sofa/cynapx" "--path" "$PWD"
```

#### 🤖 Claude Code
MCP 설정 파일에 다음 내용을 추가하세요:
```json
{
  "mcpServers": {
    "cynapx": {
      "command": "npx",
      "args": ["-y", "github:Feel-o-sofa/cynapx", "--path", "/프로젝트/절대/경로"]
    }
  }
}
```

#### 💻 OpenAI Codex / 기타
```bash
# 전역 설치된 경우
codex mcp add cynapx -- npx cynapx --path "$PWD"
```

---

## 🛠️ 핵심 기능
- `check_architecture_violations`: 레이어/도메인 위반 및 순환 의존성 탐지.
- `get_remediation_strategy`: 탐지된 위반에 대한 전문적인 3단계 수정 가이드 제공.
- `get_risk_profile`: Git 이력과 복잡도를 결합한 통합 위험 점수 산출.
- `export_graph`: Mermaid 다이어그램 시각화 및 JSON 구조 요약 반환.

---

## 🛡️ 보안 및 라이선스
- **경로 탈출 방지**: 안전하게 격리된 분석 환경을 보장합니다.
- **라이선스**: MIT License.

**Cynapx** - [Feel-o-sofa](https://github.com/Feel-o-sofa)에 의해 관리됩니다.
