# Task: Code Knowledge Tool Phase 2 고도화 계획

본 문서는 `Code Knowledge Tool`의 핵심 기능을 강화하고 상용 수준의 분석 엔진으로 도약하기 위한 차기 구현 과업을 기술합니다.

## 1. 과업 개요
현재 도구는 TypeScript 정밀 분석 및 범용 Tree-sitter 기반 심볼 분석 능력을 갖추고 있습니다. 차기 목표는 **분석의 깊이(Call Graph)**, **검색의 속도(FTS5)**, **데이터의 입체성(Path & Metadata)**을 확보하는 것입니다.

---

## 2. 세부 과업 리스트 (Priority Order)

### Task 1: Python/JS 호출 관계 분석 (Cross-Language Call Graph)
*   **목표**: `TreeSitterParser`가 단순히 심볼 정의만 찾는 것을 넘어, 함수 간의 호출 관계(`calls` edge)를 생성하도록 개선합니다.
*   **구현 전략**:
    *   Tree-sitter 쿼리에 `(call_expression function: (identifier) @call.name)` 추가.
    *   `UpdatePipeline`에서 이름 기반의 휴리스틱 매칭을 통해 동일 프로젝트 내의 `qualified_name`으로 타겟을 해결(Resolve).
*   **기대 결과**: Python 프로젝트에서도 상위/하위 호출 계층 구조 파악 가능.

### Task 2: SQLite FTS5 기반 고속 검색 엔진 도입
*   **목표**: 심볼 검색 API(`/api/search/symbols`)의 성능과 정확도를 개선합니다.
*   **구현 전략**:
    *   `schema.sql`에 `fts_symbols` 가상 테이블 추가.
    *   `NodeRepository`에서 노드 생성/삭제 시 FTS 테이블 자동 동기화.
    *   `searchSymbols`에서 단순 `LIKE` 대신 `MATCH` 쿼리 사용 및 검색 순위 지원.
*   **기대 결과**: 수만 개의 심볼 사이에서도 밀리초 단위의 고속 검색 및 유사도 기반 결과 제공.

### Task 3: 경로 기반 정밀 영향 분석 (Path-based Impact Analysis)
*   **목표**: 영향 범위 분석 API(`/api/analysis/impact`)를 더 입체적으로 개선합니다.
*   **구현 전략**:
    *   `GraphEngine.traverse` 결과를 단순 노드 목록에서 **호출 경로(Path)** 정보가 포함된 구조로 확장.
    *   API 결과에 "A -> B -> C"와 같은 호출 연쇄와 각 연쇄의 소스 코드 라인 번호를 포함.
*   **기대 결과**: 개발자가 "이 함수를 고쳤을 때 왜 멀리 있는 저 함수가 깨지는지" 논리적 근거를 즉시 파악.

### Task 4: 프로젝트 메타데이터 및 의존성 인덱싱
*   **목표**: 소스 코드 외에 빌드 설정 및 외부 의존성 정보를 그래프에 편입합니다.
*   **구현 전략**:
    *   `package.json`, `requirements.txt` 전용 파서 구현.
    *   외부 라이브러리를 `symbol_type: 'package'` 노드로 등록하고, 프로젝트 코드와 `depends_on` 엣지로 연결.
*   **기대 결과**: 라이브러리 업데이트 시 영향 범위 분석 및 프로젝트 전반의 기술 스택 파악 가능.

---

## 3. 다음 에이전트를 위한 지침
1.  **아키텍처 확인**: `src/indexer/tree-sitter-parser.ts`의 쿼리 시스템을 먼저 분석하십시오.
2.  **데이터 무결성**: 모든 작업은 `UpdatePipeline`의 트랜잭션 내에서 수행되어 데이터 정합성을 유지해야 합니다.
3.  **검증**: `src/test_file.py`를 활용하여 Python 분석 능력이 향상되는지 지속적으로 체크하십시오.

---
**Status**: Ready for Implementation (Phase 2)
**Context**: TS TypeChecker Integration Completed, Tree-sitter Query Engine Integrated.
