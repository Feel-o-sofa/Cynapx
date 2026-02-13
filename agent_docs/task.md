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

---

## 2. 현재 상태 (Current Status)
*   **브랜드**: **Cynapx (시냅스엑스)** - 코드의 신경망을 잇는 지능형 인덱스.
*   **통합**: 공식 MCP SDK를 통해 Gemini CLI와 안정적으로 연결됨.
*   **다국어 지원**: TS, JS, PY, C, CPP, RS, GO, GD, JAVA, KT, CS, PHP (총 12개 언어) 지원.
*   **지능형 분석**: 의미론적 클러스터링을 통한 시스템 '심장부(Core)' 및 '유틸리티' 자동 식별 지원.
*   **안정성**: Canonical Path Normalization 및 비차단 상태 체크가 적용된 견고한 아키텍처.

---

## 3. 향후 발전 방향 (Future Roadmap)

### Phase 8: Advanced Reasoning & Scalability (지능형 추론 및 확장성 고도화)

*   **Task 27: 대규모 분석 성능 고도화 및 플러그인 시스템**:
    *   **Rust 기반 Core Indexer**: 대규모 멀티 언어 처리를 위한 인덱서 코어의 Rust 전환 검토.
    *   **Plugin System**: 사용자 정의 Tree-sitter 문법 및 S-query 추가를 위한 플러그인 인터페이스 개방.
    *   **Async Registry**: ESM/TLA 모듈 지원을 위한 비동기 로딩 아키텍처 전환 검토.

---
**Status**: Phase 8 - **Multilingual Expansion (Optimization & Expansion)**
**Context**: Major systems and enterprise languages are integrated. Next focus is refining relationship extraction precision and further scripting language support.

