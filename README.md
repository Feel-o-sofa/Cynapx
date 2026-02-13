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
분석 대상 프로젝트 디렉터리에는 어떤 파일도 생성하지 않습니다. 모든 지식 데이터는 중앙 격리 저장소(`~/.cynapx/`)에서 관리됩니다.

---

## 🌐 Supported Languages (지원 언어)

Cynapx는 현재 **12개**의 주요 언어를 완벽하게 지원합니다:

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

## 🚀 Quick Start

### 1. 설치
```bash
npm install -g cynapx
```

### 2. 프로젝트 초기화 (Gemini CLI 기준)
AI 에이전트에게 다음과 같이 명령하세요:
> "Cynapx를 사용해서 현재 프로젝트를 초기화해줘."

내부적으로 `initialize_project` 도구가 실행되어 무중단 인덱싱을 시작합니다.

### 3. 정합성 확인
```bash
graph://ledger  # 리소스를 읽어 장부 상태 확인
```

---

## 🛡️ Security & Integrity

- **Path Traversal Guard**: 프로젝트 루트 외부의 파일 접근을 원천 차단합니다.
- **Atomic Updates**: 모든 인덱스 갱신은 트랜잭션 단위로 처리되어 중단 시에도 마지막 정상 상태를 유지합니다.
- **Sandbox Friendly**: Read-Only 환경에서도 분석이 가능하도록 설계되었습니다.

---

## 🗺️ Roadmap (향후 계획)

- **Async Registry**: ESM 및 WASM 기반 최신 문법 지원을 위한 비동기 로딩 아키텍처 도입.
- **Rust Core Indexer**: 대규모 멀티 언어 처리를 위한 인덱싱 가속화.
- **Plugin System**: 사용자 정의 S-query 및 문법 추가를 위한 인터페이스 개방.

---

## 📄 License

Internal proprietary software. All rights reserved.
**Cynapx (시냅스엑스)** - 코드의 신경망을 잇는 지능형 인덱스.
