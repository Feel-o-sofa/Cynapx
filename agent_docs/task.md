# Task: Cynapx 프로젝트 진행 현황 및 로드맵

본 문서는 고성능 격리형 코드 분석 엔진 `Cynapx`의 완료된 과업과 향후 발전 방향을 기록합니다.

---

## 1. 완료된 마일스톤 (Completed Phases)

### Phase 1 ~ 6: 기반 엔진 및 CLI 구축
*   **저장소 및 파이프라인**: SQLite(better-sqlite3) 기반 격리 저장소(`~/.cynapx/`) 및 `git diff` 대응 증분 업데이트 완료.
*   **다국어 분석**: TypeScript, JavaScript, Python 정밀 분석 및 Tree-sitter 통합 완료.
*   **정합성 보존**: DB 트리거 기반 `fan_in/out` 자동 갱신 및 전역 호출 장부(Ledger) 시스템 구축 완료.
*   **시각화 및 배포**: Mermaid 그래프 익스포트(`export_graph`) 및 전역 CLI 패키징 완료.

### Phase 7: Full Gemini MCP Integration (진행 중)
*   **Task 16: MCP SDK 마이그레이션 (완료)**: `@modelcontextprotocol/sdk` 기반 리팩토링 및 Stdio 전송 계층 안정화.
*   **Task 17-0: 동적 호출 분석 기초 설계 (완료)**: `dynamic_calls` 타입 추가 및 전용 트리거/메트릭 컬럼(`fan_in_dynamic` 등) 구축 완료.
*   **Task 17: Capabilities 확장 (완료)**: `graph://ledger`, `graph://hotspots` 리소스 및 `/refactor-safety` 프롬프트 구축 완료.
*   **Task 19: 도구 스키마 및 설명 정교화 (1차 완료)**: 모든 도구에 Zod 스키마 및 상세 Docstring 적용 완료.

---

## 2. 현재 상태 (Current Status)
*   **브랜드**: **Cynapx (시냅스엑스)** - 코드의 신경망을 잇는 지능형 인덱스.
*   **통합**: 공식 MCP SDK를 통해 Gemini CLI와 안정적으로 연결됨.
*   **리소스**: `graph://summary`, `graph://ledger`, `graph://hotspots` 제공 중.
*   **프롬프트**: `explain-impact`, `check-health`, `refactor-safety` 워크플로우 지원 중.
*   **신뢰성**: `ConsistencyChecker`를 통한 자가 진단 및 `purge_index`를 통한 초기화 기능 지원.

---

## 3. 향후 발전 방향 (Future Roadmap)

### Phase 7: Full Gemini MCP Integration (고도화)

*   **Task 18: 응답 고도화 (Rich Content)**:
    *   **Mermaid Visualization**: `export_graph` 호출 시 텍스트 외에 구조화된 시각화 블록 반환. (완료)
    *   **Source Snippets**: `get_symbol_details`에서 반환하는 코드 블록에 메타데이터 및 가독성 최적화. (완료)
*   **Task 20: 수명 주기 및 안정성**:
    *   **Resource Cleanup**: 프로세스 종료 시 SQLite WAL 파일 정리 및 DB Lock 해제 로직 강화. (진행 중)
    *   **Error Reporting**: AI 에이전트가 이해하기 쉬운 구조화된 에러 응답(`error_code`) 도입. (대기)
*   **Task 21: 보안 및 환경 최적화**:
    *   **Sandbox Policy**: 샌드박스 환경에서의 파일 읽기 권한 검증 로직 고도화. (대기)
    *   **Project Registry**: 여러 프로젝트를 쉽게 전환하며 분석할 수 있는 레지스트리 관리 도구 강화. (진행 중)

---
**Status**: Phase 7 Integration - Enhancing Capabilities
**Context**: Ledger and Hotspots are fully operational. Moving towards "Rich Feedback" and UX optimization.
