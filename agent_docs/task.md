# Task: Cynapx 프로젝트 진행 현황 및 로드맵

본 문서는 고성능 격리형 코드 분석 엔진 `Cynapx`의 완료된 과업과 향후 발전 방향을 기록합니다.

---

## 1. 완료된 마일스톤 (Completed Phases)

### Phase 1 ~ 6: 기반 엔진 및 CLI 구축
*   **저장소 및 파이프라인**: SQLite(better-sqlite3) 기반 격리 저장소(`~/.cynapx/`) 및 `git diff` 대응 증분 업데이트 완료.
*   **다국어 분석**: TypeScript, JavaScript, Python 정밀 분석 및 Tree-sitter 통합 완료.
*   **정합성 보존**: DB 트리거 기반 `fan_in/out` 자동 갱신 및 전역 호출 장부(Ledger) 시스템 구축 완료.
*   **시각화 및 배포**: Mermaid 그래프 익스포트(`export_graph`) 및 전역 CLI 패키징 완료.

### Phase 7: Full Gemini MCP Integration (통합 및 고도화)
*   **Task 16: MCP SDK 마이그레이션**: `@modelcontextprotocol/sdk` 기반 리팩토링 및 Stdio 전송 계층 안정화 완료.
*   **Task 17-0: 동적 호출 분석 기초 설계**: `dynamic_calls` 타입 추가 및 전용 트리거/메트릭 컬럼 구축 완료.
*   **Task 17: Capabilities 확장**: `graph://ledger`, `graph://hotspots` 리소스 및 `/refactor-safety` 프롬프트 구축 완료.
*   **Task 18: 응답 고도화 (Rich Content)**: Mermaid 스타일링 적용 및 `get_symbol_details` 가독성 개선 완료.
*   **Task 19: 도구 스키마 및 설명 정교화 (1차)**: 모든 도구에 Zod 스키마 및 상세 Docstring 적용 완료.
*   **Task 20: 수명 주기 및 안정성 고도화**: Resource Cleanup, Lifecycle Manager, 구조화된 Error Reporting 도입 완료.
*   **Task 21: 보안 및 환경 최적화**: SecurityProvider를 통한 Sandbox Policy 수립 및 Project Registry 메타데이터 확장 완료.
*   **Task 22: 검색 및 필터링 고도화**: FTS5 최적화(Prefix 검색) 및 `search_symbols` 고급 필터링(SymbolType, Language, Visibility) 구현 완료.
*   **Task 22.5: AI 에이전트 인터페이스 고도화**: 파서 메타데이터(Signature, Modifiers) 추출, 관계 탐색 전용 도구(callers/callees) 추가 및 Zero-Pollution 리팩토링 완료.
*   **Task 23: 성능 및 확장성 최적화**: DB PRAGMA 튜닝, 배치 ID 사전 조회(Pre-fetching) 및 샘플링 기반 정합성 체크 도입 완료.
*   **Task 24: 코드 의미론적 클러스터링 및 관계 추론**: Jaccard 유사도 기반 논리적 모듈 구조 자동 파악 및 Core/Utility 분류 시스템 구축 완료.
*   **Task 25: 다국어 확장 Wave 1, 2 & 3**: Java, Kotlin, C#, C, C++, Rust, Go 및 GDScript 정밀 분석 파서 구현 및 통합 완료. 2단계 배치 처리 및 Node-Object 매핑 기반 관계 추출 엔진 구축 완료.
*   **Task 25.5: 상속 및 구현 관계(Inheritance) 추출 정교화**: Java/C#/Python/TS/CPP 상속 관계 엣지 누락 현상 해결 및 정밀도 개선 완료.
*   **Task 26: Wave 3 확장 (PHP Integrated)**: PHP Trait 및 상속 관계 추출 엔진 구축 완료. (Lua 지원은 환경 호환성 문제로 철회)

### Phase 8: Connectivity & Security (연결성 및 보안 고도화)
*   **Task 27: Purely Ephemeral HTTPS**: 기동 시 휘발성 인증서 자동 생성 및 파일 시스템 흔적 없는(Zero-Pollution) 보안 모델 구축 완료.
*   **Task 28: MCP-over-SSE & Streamable HTTP**: MCP SDK v2 표준 기반 Streamable HTTP 전환, 다중 세션 관리 및 실시간 도구 연결 인프라 구축 완료.

### Phase 9: Massive Scaling & AI-Native Optimization (대규모 확장 및 AI 최적화)
*   **Task 29: 대규모 분석 성능 고도화 및 플러그인 시스템**:
    *   **Rust-Native Hybrid Core**: `napi-rs` 기반 네이티브 가속 및 Rayon 병렬 파일 처리 엔진 구축 완료.
    *   **S-Query 외부화**: 12개 언어의 Tree-sitter 쿼리(`*.scm`) 분리 및 유연한 캡처 규칙 구조 확립 완료.
    *   **Async Registry**: 비차단 방식의 인덱스 로딩 및 쓰기 잠금 최적화 완료.
    *   **Dynamic Plugin System**: `~/.cynapx/plugins` 내 외부 플러그인(`.js/.ts`) 자동 탐지 및 런타임 등록 엔진 구현 완료. (Task 29.5 완료)
*   **Task 30: AI-Native Token Optimization (AI 에이전트 전용 토큰 효율화)**:
    *   **Symbol-First Query Protocol**: `get_symbol_details`에 `summary_only` 및 `include_source` 옵션 추가.
    *   **Smart Context Pruning**: 100라인 이상의 긴 심볼 소스 코드를 지능적으로 생략(50라인)하여 토큰 낭비 방지.
    *   **Graph-based Caching**: `GraphEngine` 내 영향 분석 결과(Impact Analysis) 1분 캐싱 도입으로 반복 질의 최적화.
*   **Task 31: Boundaryless Edge Discovery (경계 없는 호출지 탐색)**:
    - 전역 레지스트리를 기반으로 프로젝트 간 물리적 호출/참조를 자동 연결하는 Shadow Node 아키텍처 구축 완료.
    - 정적 분석 결과가 로컬 범위를 벗어날 경우 타 프로젝트 DB를 역추적하여 전역적 의존성 지형 데이터 제공 완료. (심볼명 기반 역추적 고도화 완료)
*   **Task 32: Structural Characteristic Tagging (구조적 특성 태깅)**:
    - 경로, 명명 규칙, 상속 계층 등 물리적 사실에 기반한 심볼 특성(Layer, Role, Trait) 추출 엔진 구축 완료.
    - 상속 계층을 통한 역할 전이(Role Propagation) 및 다중 역할 병렬 기재 알고리즘 적용 완료.
*   **Task 33: Historical Evidence Mapping (역사적 증거 맵핑)**:
    - 심볼 단위로 Git 커밋 이력(Hash, Message, Author)을 직접 연결하여 구현 배경(Rationale) 데이터 제공 완료.
    - `backfill_history` 도구를 통해 기존 인덱스에 대한 역사적 컨텍스트 전면 매핑 완료.
*   **Phase 10 Ultimate Verification**: 멀티 저장소 환경에서의 크로스 프로젝트 분석, 역할 전이, 이력 매핑 통합 테스트 통과 (100% Pass).

---

## 2. 현재 상태 (Current Status)
*   **브랜드**: **Cynapx (시냅스엑스)** - 코드의 신경망을 잇는 지능형 인덱스.
*   **통합**: MCP SDK v2 (Streamable HTTP) 표준 준수, AI 에이전트 전용 고효율 쿼리 프로토콜 내장.
*   **지능**: 단일 저장소의 경계를 넘는 전역 의존성 파악 및 구조/역사적 맥락을 기반으로 한 객관적 추론 데이터 제공.
*   **성능**: Rust 네이티브 가속 및 그래프 캐싱을 통해 대규모 프로젝트 분석 및 반복 질의 성능 극대화.

---

## 3. 향후 발전 방향 (Future Roadmap)

### Phase 11: Architectural Reasoning & Autonomous Refactoring (아키텍처 추론 및 자율 리팩토링)

*   **Task 34: Policy-based Architecture Violation Detection (정책 기반 설계 위반 탐지)**:
    - 추출된 `layer` 및 `role` 태그를 기반으로 허용되지 않은 참조 관계(예: Data 계층이 API 계층을 참조)를 자동으로 식별.
    - 에이전트가 "설계 원칙 위반"을 객관적 지표로 보고할 수 있는 인프라 구축.
*   **Task 35: Impact-Aware Refactoring Proposal (영향도 인식 리팩토링 제안)**:
    - `analyze_impact`와 `structural tags`를 결합하여, 수정 시 위험도가 높은(High Fan-in) 심볼에 대한 안전한 리팩토링 경로 자동 계산.
    - 단순 코드 수정을 넘어 시스템 전체의 결합도(Coupling)를 낮추는 방향의 구조적 개선안 제시.
*   **Task 36: Knowledge Graph Pruning & Optimization (지식 그래프 정제)**:
    - 사용 빈도가 낮거나 죽은 코드(Dead Code)를 탐지하여 그래프에서 제외하거나 최적화하는 기능.
    - 인덱스 크기 최적화 및 쿼리 응답성 향상.

---

**Status**: Phase 11 - **Architectural Intelligence & Autonomous Optimization**

**Context**: Global dependency mapping and historical context are established. Moving towards active architectural diagnosis and self-improvement suggestions.

