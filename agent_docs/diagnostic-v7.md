# Cynapx diagnostic-v7

> **작성일**: 2026-04-15  
> **대상 버전**: v1.0.6 + Phase 9 (PR #19)  
> **기준**: Phase 8 완료 + 통합 테스트(56/56) 이후 상태

---

## 1. 진단 개요

Phase 8 + 통합 테스트(PR #18) 완료 후 상태를 재진단. Phase 9 구현 과제 8개를 도출·해결함.

| 구분 | Phase 8 완료 시 | Phase 9 완료 후 |
|------|----------------|----------------|
| 단위 테스트 | 146개 | **164개** (+18) |
| 통합 테스트 어서션 | 56개 | 56개 (변경 없음) |
| `as any` 캐스트 | 34개 | **3개** (주석 1개 포함) |
| tsc 오류 | 0 | **0** |
| MCP 도구 실기능 공백 | 1개 (get_related_tests) | **0개** |

---

## 2. Phase 9 구현 결과 (PR #19, 2026-04-15)

### P9-H-1 — `get_related_tests` 실구현 ✅

**문제**: `edge_type: 'tests'` 엣지가 파서에 의해 전혀 생성되지 않아 항상 `[]` 반환.

**해결**:
- `src/indexer/typescript-parser.ts`: `isTestFile()` + `inferProductionFilePath()` + `emitTestEdges()` 추가.
  - `*.test.ts` / `*.spec.ts` / `__tests__/` 패턴 탐지
  - 파일 수준 엣지: `testFile --[tests]--> productionFile`
  - `describe('ClassName', ...)` 블록별 엣지: `testFile --[tests]--> productionFile#ClassName`
- `src/server/tool-dispatcher.ts`: 두 단계 조회로 확장.
  1. 대상 노드에 직접 연결된 `tests` 엣지 조회
  2. 대상 노드를 포함하는 파일 노드에 연결된 `tests` 엣지 조회 (파일 수준 커버리지)
  - 결과 중복 제거 후 반환
- 신규 유닛 테스트 6개 (`isTestFile` true/false, `inferProductionFilePath` 3종 패턴).

### P9-H-2 — WorkerPool 큐 오버플로우 수정 ✅

**문제**: `processBatch()`가 120개 파일을 한꺼번에 `Promise.all`로 풀에 제출 → 101번째 이후 파일 `"queue is full"` 오류로 무음 누락.

**해결**:
- `src/indexer/worker-pool.ts`: `_maxQueueSize` 필드로 리네임 + `public get maxQueueSize()` getter 추가.
- `src/indexer/update-pipeline.ts`: `processBatch()`에서 `CHUNK_SIZE = min(maxQueueSize, 100)` 단위 청킹. 청크별 `await Promise.all` 후 결과 누적, DB 트랜잭션은 기존과 동일하게 전체 결과를 단일 트랜잭션으로 처리.
- 신규 유닛 테스트 2개 (getter 값 확인).

### P9-M-1 — arch-rules.json 외부 설정 ✅

**문제**: `check_architecture_violations`가 엔진 내부 고정 규칙만 사용, 프로젝트별 레이어 규칙 정의 불가.

**해결**:
- `src/graph/architecture-engine.ts`:
  - `ArchRule` 타입 (`name`, `from`, `to`, `allowed`)
  - `loadRules(rulesPath)` 메서드 — JSON 파싱 + 배열 검증
  - `get hasCustomRules()` getter
  - `checkViolations()` 내에 커스텀 규칙 평가 블록 추가 (`calls`/`depends_on`/`imports` 엣지 대상, 경로 세그먼트 매칭)
- `src/server/workspace-manager.ts`: `initializeEngine()` 후 `<projectPath>/arch-rules.json` 자동 탐색·로드.
- `src/server/tool-dispatcher.ts`: 응답에 `customRulesLoaded` 필드 추가.
- 신규 테스트 파일 `tests/architecture-engine.test.ts` 6개 케이스.

**arch-rules.json 예시**:
```json
[
  { "name": "No server→db direct access", "from": "server", "to": "db", "allowed": false },
  { "name": "graph can call db", "from": "graph", "to": "db", "allowed": true }
]
```

### P9-M-3 — Embedding 상태 노출 ✅

**문제**: Python sidecar 부재 시 `refreshAll()` 백그라운드 실패 → `get_setup_context`에서 임베딩 동작 여부 알 수 없음.

**해결**:
- `src/indexer/embedding-manager.ts`: `_available: boolean` + `isAvailable` getter. 첫 번째 sidecar ping 성공 시 `true`, NullEmbeddingProvider 전환 시 `false`.
- `src/indexer/update-pipeline.ts`: `embeddingsAvailable` 위임 getter 추가.
- `src/server/tool-dispatcher.ts`: `get_setup_context` 응답에 `"embeddings": "enabled"|"disabled"` 포함.
- 신규 유닛 테스트 1개.

### P9-M-4 — .gitignore 정리 ✅

`!scripts/integration-test.js` 예외 추가 → `git add -f` 불필요.

### P9-L-1 — as any 34→3개 제거 ✅

| 파일 | 제거 전 | 제거 후 | 방법 |
|------|---------|---------|------|
| `db/edge-repository.ts` | 5 | 0 | `EdgeRow` 인터페이스 |
| `db/node-repository.ts` | 4 | 0 | `NodeRow` 타입 별칭 |
| `db/vector-repository.ts` | 1 | 0 | `{sql?:string}\|undefined` |
| `server/resource-provider.ts` | 4 | 0 | `CountRow`, `ClusterRow` |
| `indexer/embedding-manager.ts` | 2 | 0 | `CodeNode&{id}`, `{sql?:string}` |
| `indexer/cross-project-resolver.ts` | 1 | 0 | `RemoteNodeRow` 인터페이스 |
| `indexer/update-pipeline.ts` | 2 | 0 | `ChangeType` 캐스팅 |
| `indexer/typescript-parser.ts` | 5 | 0 | `SymbolWithParent`, `ts.NamedDeclaration` |
| `indexer/worker-pool.ts` | 6 | 1* | `WeakMap<Worker, ActiveTask\|null>` |
| `server/interactive-shell.ts` | 3 | 0 | `McpServer.isInTerminalMode`/`isReady` getter |
| `server/mcp-server.ts` | 0 | 0 | getter 추가 |
> *잔여 1개는 주석 문자열 (`// replaces (worker as any).currentTask`)

### P9-L-2 — backfill_history 검증 테스트 ✅

`tests/tool-dispatcher.test.ts`에 3개 케이스 추가:
1. context 없음 → `isError: true`
2. Terminal 모드 → `isError: true`  
3. context + pipeline 존재 → `mapHistoryToProject()` 호출 확인

---

## 3. 미완료 항목 (Phase 10 이관)

| ID | 항목 | 이유 |
|----|------|------|
| P9-M-2 | 비-TypeScript 파일 인덱싱 | 독립 파서 구현 필요, 대형 스코프 — 별도 Phase |
| P9-L-3 | diagnostic-v7.md | **본 문서** |

---

## 4. 현황 스냅샷

| 항목 | 값 |
|------|----|
| 단위 테스트 | 164개 (11개 파일) |
| 통합 테스트 | 56/56 (scripts/integration-test.js) |
| tsc 오류 | 0 |
| `as any` (실 코드) | 2개 (embedding-manager.ts 내 SQLite 스키마 쿼리 — 런타임 다형적 결과) |
| MCP 도구 기능 공백 | 0개 |
| PR | #19 merged to master |

---

## 5. Phase 10 예비 과제

| ID | 항목 | 우선순위 |
|----|------|---------|
| P10-M-1 | 비-TypeScript 파일 인덱싱 (YAML/JSON/Markdown) | MEDIUM |
| P10-M-2 | `get_related_tests` 함수 수준 정밀 매핑 (현재 파일 수준) | MEDIUM |
| P10-L-1 | `backfill_history` 멀티 커밋 정확도 E2E 검증 | LOW |
| P10-L-2 | 나머지 `as any` 2개 제거 (SQLite schema 동적 쿼리) | LOW |
