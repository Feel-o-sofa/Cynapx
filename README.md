# 🧠 Cynapx (시냅스엑스) v1.0.0
### High-Performance AI-Native Code Knowledge Engine

**Cynapx**는 AI 에이전트와 개발자를 위해 설계된 고성능 격리형 코드 분석 엔진입니다. 코드베이스를 다차원 지식 그래프로 변환하여, LLM(예: Gemini)이 복잡한 아키텍처, 상속 계층, 호출 관계를 별도의 수동 컨텍스트 수집 없이도 즉각적으로 이해할 수 있게 돕습니다.

---

## 🌟 Why Cynapx? (핵심 가치)

### 1. 관계 중심의 사고 (Relationship-First)
단순한 텍스트 검색(`grep`)은 논리적 연결을 놓칩니다. Cynapx는 **상속(`inherits`)**, **구현(`implements`)**, **호출(`calls`)** 관계를 정밀하게 추출하여 코드의 "신경망"을 시각화합니다.

### 2. 의미론적 클러스터링 (Semantic Clustering)
Jaccard 유사도와 그래프 위상 분석을 통해 시스템의 **심장부(Core)**와 **도구(Utility)** 모듈을 자동으로 분류합니다. AI 에이전트는 이 정보를 바탕으로 어디가 중요한 코드인지 즉시 파악합니다.

### 3. 무결성 보존 법칙 (Conservation of Integrity)
**전역 장부(Global Ledger)** 시스템을 통해 `SUM(fan_in) == SUM(fan_out)` 정합성을 상시 검증합니다. 데이터 결점이 없는 완벽한 인덱스만을 에이전트에게 제공합니다.

### 4. Zero-Pollution (완벽한 격리)
분석 대상 프로젝트 디렉터리에는 어떤 파일도 생성하지 않습니다. 모든 지식 데이터는 중앙 격리 저장소(`~/Users/{userName}/.cynapx/`)에서 관리됩니다.

---

## 🌐 Supported Languages (지원 언어)

Cynapx는 현재 **12개**의 주요 언어를 지원합니다:

- **Web**: TypeScript, JavaScript, PHP
- **System**: C, C++, Rust, Go
- **Enterprise**: Java, Kotlin, C#
- **Scripting**: Python, GDScript

---

## 🛠️ Tools & Capabilities (MCP 인터페이스)

Cynapx는 **Model Context Protocol (MCP)**을 통해 AI 에이전트에게 다음과 같은 도구를 제공합니다.

### 🔍 탐색 및 검색
- `search_symbols`: FTS5 엔진 기반 전역 심볼 검색 (타입, 언어, 가시성 필터링 지원).
- `get_symbol_details`: 심볼의 시그니처, 복잡도 메트릭, 실시간 소스 코드 스니펫 제공.

### 📈 그래프 분석
- `get_callers` / `get_callees`: 특정 함수의 호출자 및 피호출자 목록 추적.
- `analyze_impact`: 특정 심볼 변경 시 영향을 받는 모든 의존성 노드를 Transitively 분석.
- `get_related_tests`: 생산 코드와 연관된 테스트 코드를 즉시 탐색.

### 💡 지능형 인사이트
- `perform_clustering`: 논리적 모듈 구조를 재구성하고 핵심 레이어 식별.
- `get_hotspots`: 복잡도가 높거나 결합도가 강한 "기술 부채" 영역 탐색.
- `export_graph`: 심볼 중심의 관계도를 **Mermaid.js** 다이어그램으로 즉시 출력.

---

## 🚀 Quick Start (설치 및 등록)

Cynapx는 NPM 전역 설치 또는 로컬 패키지 파일(`.tgz`)을 통해 설치할 수 있습니다. 설치 후 사용 중인 AI 에이전트(Gemini 또는 Codex)에 MCP 서버로 등록해야 합니다.

### 1. Cynapx 설치

**방법 A: NPM을 통한 전역 설치**
```bash
npm install -g cynapx
```

**방법 B: 로컬 패키지 파일(.tgz) 사용**
```bash
# 배포된 패키지 파일을 직접 설치
npm install ./cynapx-1.0.0.tgz
```

---

### 2. AI 에이전트 등록 (MCP Registration)

에이전트에 등록할 때는 반드시 **절대 경로**를 사용해야 합니다. 각 운영체제별 터미널 환경에 맞는 명령어를 참조하세요.

#### 💎 Gemini CLI에 등록하기
| OS | 설치 유형 | 등록 명령어 |
| :--- | :--- | :--- |
| **Windows (PS)** | NPM 전역 | `gemini mcp add cynapx "npx" "--" "cynapx" "--path" "$PWD" -e MCP_MODE=true` |
| | 로컬 소스 | `gemini mcp add cynapx "node" "--" "$((Resolve-Path ./dist/bootstrap.js).Path)" "--path" "$PWD" -e MCP_MODE=true` |
| **Linux / Mac** | NPM 전역 | `gemini mcp add cynapx npx -- cynapx --path $(pwd) -e MCP_MODE=true` |
| | 로컬 소스 | `gemini mcp add cynapx node -- $(pwd)/dist/bootstrap.js --path $(pwd) -e MCP_MODE=true` |

#### 💻 Codex CLI에 등록하기
| OS | 설치 유형 | 등록 명령어 |
| :--- | :--- | :--- |
| **Windows (PS)** | NPM 전역 | `codex mcp add cynapx --env MCP_MODE=true -- npx cynapx --path "$PWD"` |
| | 로컬 소스 | `codex mcp add cynapx --env MCP_MODE=true -- node "$((Resolve-Path ./dist/bootstrap.js).Path)" --path "$PWD"` |
| **Linux / Mac** | NPM 전역 | `codex mcp add cynapx --env MCP_MODE=true -- npx cynapx --path "$(pwd)"` |
| | 로컬 소스 | `codex mcp add cynapx --env MCP_MODE=true -- node "$(pwd)/dist/bootstrap.js" --path "$(pwd)"` |

---

### 💡 설치 팁 및 주의사항

*   **Native Bindings**: Cynapx는 `tree-sitter`를 사용하므로 설치 시 컴파일러가 필요할 수 있습니다.
    *   **Windows**: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 설치 필요.
    *   **Mac**: `xcode-select --install` 실행 필요.
    *   **Linux**: `sudo apt install build-essential` (Ubuntu 기준) 등 필요.
*   **권한 오류**: Linux/Mac에서 `EACCES` 오류 발생 시 명령어 앞에 `sudo`를 붙이거나 [NPM 권한 설정](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally)을 변경하세요.
*   **경로 공백**: 프로젝트 경로에 공백이 포함된 경우 반드시 따옴표(`" "`)로 감싸주어야 합니다.

---

### 3. 등록 확인 및 시작

에이전트가 Cynapx를 올바르게 인식했는지 확인합니다.

*   **Gemini**: `/mcp` 명령어를 입력하여 `cynapx`가 목록에 있는지 확인합니다.
*   **Codex**: `codex mcp list` 명령어를 통해 `cynapx`가 `enabled` 상태인지 확인합니다.

이제 에이전트에게 **"Cynapx로 이 프로젝트 분석해줘"**라고 말해보세요!

---

## 🛡️ Security & Integrity

- **Path Traversal Guard**: 프로젝트 루트 외부의 파일 접근을 원천 차단합니다.
- **Atomic Updates**: 모든 인덱스 갱신은 트랜잭션 단위로 처리되어 중단 시에도 마지막 정상 상태를 유지합니다.
- **Sandbox Friendly**: Read-Only 환경에서도 분석이 가능하도록 설계되었습니다.

---

## 📄 License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.
**Cynapx (시냅스엑스)** - 코드의 신경망을 잇는 지능형 인덱스.
