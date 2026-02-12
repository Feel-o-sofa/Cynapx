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

---

## 2. 현재 상태 (Current Status)
*   **브랜드**: **Cynapx (시냅스엑스)** - 코드의 신경망을 잇는 지능형 인덱스.
*   **통합**: 공식 MCP SDK를 통해 Gemini CLI와 안정적으로 연결됨.
*   **리소스**: `graph://summary`, `graph://ledger`, `graph://hotspots` 제공 중.
*   **프롬프트**: `explain-impact`, `check-health`, `refactor-safety` 워크플로우 지원 중.
*   **신뢰성**: `ConsistencyChecker`를 통한 자가 진단 및 `purge_index`를 통한 초기화 기능 지원.

---

## 3. 향후 발전 방향 (Future Roadmap)

### Phase 7: Full Gemini MCP Integration (최적화 로드맵)

시스템의 **안정성(Stability) -> 보안(Security) -> 성능(Performance)** 순으로 우선순위를 재정렬하여 진행합니다.

*   **Task 22: 검색 및 필터링 고도화 (우선순위: 1)**:
    *   **FTS5 최적화**: SQLite FTS5 도입을 통한 접두사(Prefix) 검색 지원 및 검색어 매칭도 기반 가중치 랭킹 시스템 구축.
    *   **Advanced Filtering**: `search_symbols` 도구에 Symbol Type, Language, Visibility 기반의 고급 필터 옵션 추가하여 검색 노이즈 최소화.
    *   **Context Efficiency**: 정교한 검색을 통해 AI 에이전트의 불필요한 파일 접근을 줄이고 토큰 사용 효율성 극대화.
*   **Task 23: 성능 및 확장성 최적화 (우선순위: 2)**:
    *   대규모 프로젝트를 위한 워커 풀 성능 튜닝 및 DB 인덱스 최적화.

---
**Status**: Phase 7 Integration - Performance Phase
**Context**: Task 21 completed. Starting Task 22 to enhance search intelligence and filtering capabilities.
