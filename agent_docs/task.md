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

---

## 2. 현재 상태 (Current Status)
*   **브랜드**: **Cynapx (시냅스엑스)** - 코드의 신경망을 잇는 지능형 인덱스.
*   **통합**: 공식 MCP SDK를 통해 Gemini CLI와 안정적으로 연결됨.
*   **리소스**: `graph://summary`, `graph://ledger`, `graph://hotspots` 제공 중.
*   **탐색 도구**: `get_callers`, `get_callees`, `get_related_tests` 등 관계 중심 탐색 지원.
*   **정합성**: `HealthMonitor`를 통한 실시간 정합성 자가 진단 및 자동 복구 지원.
*   **성능**: 대용량 프로젝트 대응을 위한 메모리 맵핑(MMAP) 및 지능형 배치 처리 적용.

---

## 3. 향후 발전 방향 (Future Roadmap)

### Phase 8: Advanced Reasoning & Multilingual Expansion (지능형 추론 및 다국어 확장)

시스템 언어부터 게임 스크립트까지 아우르는 지능형 코드 지식 생태계 구축을 목표로 합니다.

*   **Task 23.5: Refactoring for Scale (아키텍처 고도화)**:
    *   **LanguageProvider 아키텍처**: `TreeSitterParser`에서 언어별 로직을 독립 모듈로 분리하여 플러그인 기반 마련.
    *   **Lazy Loading**: 분석 대상 파일 발견 시에만 해당 언어 문법을 동적 로드하여 메모리 점유율 최적화.
    *   **EdgeType 확장**: GDScript의 Signal, Rust의 Macro/Trait 등 특수 관계 지원을 위한 엣지 스키마 확장.

*   **Task 24: 코드 의미론적 클러스터링 및 관계 추론**:
    *   물리적 파일 구조를 넘어선 **논리적 모듈 구조 자동 파악**.
    *   함수 간 복잡한 호출 패턴 분석을 통한 '핵심 로직' 추출 가중치 시스템 도입.

*   **Task 25: 대규모 다국어 지원 확장 (Multilingual Waves)**:
    *   **Wave 1 (Systems)**: C, C++, Rust, Go 지원. 시스템 언어 특유의 선언 구조 및 매크로/패키지 분석.
    *   **Wave 2 (Enterprise)**: Java, Kotlin, C# 지원. OOP(상속, 인터페이스, 추상화) 관계 정밀 맵핑.
    *   **Wave 3 (Scripting & Game)**: Ruby, PHP, Lua, Perl, **GDScript** 지원.
    *   **GDScript 특화**: Godot 엔진의 Node 경로, Signal 연결 및 `extends` 기반 구조 분석 지원.

*   **Task 26: 인덱싱 가속화 및 생태계 개방**:
    *   **Rust 기반 Core Indexer**: 대규모 멀티 언어 처리를 위한 인덱서 코어의 Rust 전환 검토.
    *   **Plugin System**: 사용자 정의 Tree-sitter 문법 및 S-query 추가를 위한 플러그인 인터페이스 개방.

---
**Status**: Phase 7 Integration - **COMPLETED**
**Context**: Phase 8 planning finalized. Ready to conduct pre-requisite analysis for massive multilingual expansion.
