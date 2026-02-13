# 🧠 Cynapx 완벽 가이드 (The Definitive Guide)
### "코드의 신경망을 잇는 지능형 지식 엔진"

Cynapx(시냅스엑스)를 선택해 주셔서 감사합니다. 이 가이드는 여러분이 Cynapx의 강력한 기능을 100% 활용하여, AI 에이전트와 함께 더 깊고 넓게 코드베이스를 이해할 수 있도록 돕기 위해 작성되었습니다.

---

## 📋 목차
1. [Cynapx 소개: 왜 지식 그래프인가?](#1-cynapx-소개-왜-지식-그래프인가)
2. [시작하기: 설치 및 에이전트 등록](#2-시작하기-설치-및-에이전트-등록)
3. [통신 모드: Stdio vs HTTP](#3-통신-모드-stdio-vs-http)
4. [주요 기능 깊이 읽기](#4-주요-기능-깊이-읽기)
5. [고급 활용 및 관리](#5-고급-활용-및-관리)
6. [문제 해결 (Troubleshooting)](#6-문제-해결-troubleshooting)

---

## 1. Cynapx 소개: 왜 지식 그래프인가?

기존의 텍스트 기반 검색(`grep`)은 코드가 가진 **"논리적 맥락"**을 읽지 못합니다. 함수 A가 함수 B를 호출한다는 사실, 혹은 클래스 C가 인터페이스 D를 구현한다는 사실은 단순한 텍스트 이상의 의미를 갖습니다.

Cynapx는 여러분의 코드를 분석하여 다음과 같은 핵심 가치를 제공합니다:

*   **Relationship-First (관계 중심)**: 단순 심볼 목록이 아닌, 코드 간의 유기적인 연결(상속, 구현, 호출)을 파악합니다.
*   **Zero-Pollution (무결성)**: 프로젝트 디렉터리에 어떠한 흔적도 남기지 않습니다. 모든 데이터는 중앙 저장소(`~/.cynapx/`)에서 안전하게 관리됩니다.
*   **Global Ledger (전역 장부)**: 인덱싱된 모든 데이터의 입출력 관계를 장부 형태로 기록하여 데이터의 누락이나 오류가 없는지 상시 검증합니다.

---

## 2. 시작하기: 설치 및 에이전트 등록

### 2.1 필수 의존성 (Native 빌드 도구)
Cynapx는 고성능 파싱을 위해 `tree-sitter` 네이티브 바인딩을 사용합니다. 설치 전 각 OS에 맞는 빌드 도구가 필요합니다.

*   **Windows**: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (C++ 데스크톱 개발 워크로드 포함)
*   **macOS**: 터미널에서 `xcode-select --install` 실행
*   **Linux**: `sudo apt install build-essential` (Ubuntu/Debian 기준)

### 2.2 설치 방법
```bash
# NPM을 통해 전역 설치하거나
npm install -g cynapx

# 로컬 패키지 파일을 설치할 수 있습니다.
npm install ./cynapx-1.0.0.tgz
```

### 2.3 에이전트 등록 (MCP Registration)
Cynapx는 **Model Context Protocol (MCP)**을 따릅니다. 사용 중인 에이전트에 따라 아래 명령어를 복사하여 터미널에 입력하세요.

<details>
<summary><b>💎 Gemini CLI 등록 (클릭)</b></summary>

*   **Windows (PowerShell)**:
    ```powershell
    gemini mcp add cynapx "npx" "--" "cynapx" "--path" "$PWD" -e MCP_MODE=true
    ```
*   **Linux / macOS**:
    ```bash
    gemini mcp add cynapx npx -- cynapx --path $(pwd) -e MCP_MODE=true
    ```
</details>

<details>
<summary><b>💻 Codex CLI 등록 (클릭)</b></summary>

*   **Windows (PowerShell)**:
    ```powershell
    codex mcp add cynapx --env MCP_MODE=true -- npx cynapx --path "$PWD"
    ```
*   **Linux / macOS**:
    ```bash
    codex mcp add cynapx --env MCP_MODE=true -- npx cynapx --path "$(pwd)"
    ```
</details>

---

## 3. 통신 모드: Stdio vs HTTP

Cynapx는 환경에 따라 두 가지 통신 방식을 제공합니다.

### 3.1 Stdio 모드 (MCP 기본값)
*   **방식**: AI 에이전트가 Cynapx를 직접 실행하여 파이프(`stdin/stdout`)로 대화합니다.
*   **장점**: 가장 빠르고 안전하며, 에이전트 종료 시 자동으로 함께 종료됩니다.
*   **활성화**: `MCP_MODE=true` 환경 변수를 설정합니다.

### 3.2 HTTP 모드 (독립 서버)
*   **방식**: Cynapx를 웹 서버로 띄워 네트워크를 통해 접근합니다.
*   **장점**: 다중 에이전트 접속이 가능하며, 외부 시각화 도구와 연동할 수 있습니다.
*   **실행**: `cynapx --path /project/path` (기본 포트: 3000)

---

## 4. 주요 기능 깊이 읽기

### 🔍 심볼 검색 및 상세 정보
*   **search_symbols**: 클래스명, 함수명 등으로 코드 내 심볼을 찾습니다. 가시성(public/private)이나 언어별 필터링이 가능합니다.
*   **get_symbol_details**: 특정 심볼의 소스 코드를 즉시 읽어오고, 복잡도(Cyclomatic Complexity)와 의존성 지표를 확인합니다.

### 📈 영향 범위 분석 (`analyze_impact`)
코드를 수정하기 전, "이 함수를 고치면 어디가 망가질까?"라는 질문에 답합니다.
*   **동작**: 특정 심볼을 참조하는 모든 상위 노드를 재귀적으로 추적하여 리스크 리포트를 생성합니다.
*   **활용**: 리팩토링 범위 산정 및 회귀 테스트 케이스 선정.

### 🧩 의미론적 클러스터링
*   **핵심**: 단순히 파일 구조가 아닌, 실제 호출 빈도와 결합도를 기반으로 논리적 모듈을 식별합니다.
*   **결과**: 시스템의 **핵심 도메인 로직**과 **공통 유틸리티**를 자동으로 분류해 줍니다.

### 📊 Mermaid 그래프 익스포트
*   복잡한 호출 관계를 마크다운에서 바로 볼 수 있는 **Mermaid 다이어그램**으로 변환합니다.
*   **프롬프트 예시**: "AuthService 클래스를 중심으로 호출 관계도를 그려줘."

---

## 5. 고급 활용 및 관리

### 5.1 데이터 저장 구조
Cynapx는 프로젝트별로 독립된 SQLite 데이터베이스를 생성합니다.
*   **저장 위치**: `~/.cynapx/`
*   **파일 포맷**: `{project_hash}.db` (정합성을 위해 FTS5 인덱스 포함)

### 5.2 인덱스 정합성 유지
Cynapx는 파일의 체크섬(Checksum)과 Git의 커밋 해시를 이중으로 체크합니다.
*   브랜치를 변경하거나 외부에서 파일이 수정되어도, 실행 시 자동으로 감지하여 차이점만 업데이트합니다.

---

## 6. 문제 해결 (Troubleshooting)

### Q1. 인덱싱 속도가 너무 느립니다.
*   **해결**: `node_modules`나 `dist`와 같은 빌드 결과물이 인덱싱 대상에 포함되지 않았는지 확인하세요. Cynapx는 기본적으로 주요 무시 패턴을 지원하지만, `.gitignore` 설정이 올바른지 다시 확인하는 것이 좋습니다.

### Q2. 심볼 검색 결과가 실제 코드와 다릅니다.
*   **해결**: `check_consistency` 도구를 실행하세요. `repair: true` 옵션을 주면 강제로 동기화를 시도합니다.

### Q3. "Database is locked" 오류가 발생합니다.
*   **해결**: 여러 에이전트가 동시에 같은 인덱스를 수정하려고 할 때 발생할 수 있습니다. HTTP 모드를 사용하거나, 잠시 대기 후 다시 시도하세요.

---

**Cynapx와 함께 더 똑똑한 코드 분석을 시작해 보세요!**
의문 사항이나 개선 제안은 언제든지 환영합니다.
