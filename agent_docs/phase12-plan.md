# Phase 12 작업 계획 — diagnostic-v9 대응

> **작성**: 2026-06-10 / **기준 문서**: `agent_docs/diagnostic-v9.md`
> **목표**: CRITICAL 3건, HIGH 7건, MEDIUM(A) 12건, LOW/최적화(O) 12건, 테스트 공백 6건의 전체 27+ 항목을 의존성과 리스크 기준으로 순서화하여 단계적으로 해소한다.

---

## 0. 작업 원칙

- 각 서브 Phase는 **독립적으로 커밋 가능한 단위**로 쪼갠다 (한 Phase = 1~3개 PR급 커밋).
- CRITICAL 항목은 **회귀 테스트를 동반**하지 않으면 완료로 보지 않는다.
- 파일/모듈이 겹치는 항목은 같은 Phase에 묶어 충돌 없는 순서로 처리한다.
- 매 Phase 종료 시 `npm test` + `npx tsc --noEmit` 그린 확인 후 커밋.

---

## 1. 의존성 맵 (작업 순서에 영향을 주는 관계)

```
C-1 (lock-manager DB 삭제)  ──→  H-4 (lock 원자화)        같은 파일, 순차 처리
H-4 (lock 원자화)           ──→  H-1 (failover 레이스)    failover 로직이 lock 위에서 동작
H-2 (watcher 확장자)        ──→  H-3 (flush 가드)          같은 파일(file-watcher.ts)
A-3 (engine SQL 누수)       ──→  A-2 (tags 정규화)          findDeadCode가 두 이슈 모두 포함
A-1 (N+1)                   독립
A-5 (언어 프로바이더)        독립, 작업량 큼 → 후순위
테스트 공백                  각 항목 수정 직후 동반 작성 (별도 Phase로 몰지 않음)
```

---

## 2. Phase 12-1: CRITICAL 즉시 패치 (데이터 손실/보안)

**목표**: 가장 파급력이 큰 3건. 코드 변경량은 작지만 영향 범위가 크므로 최우선.

| 항목 | 파일 | 작업 |
|------|------|------|
| C-1 | `src/utils/lock-manager.ts:69-77` | suffix 배열에서 `''`(DB 본체) 제거. `-wal`/`-shm` 삭제 전 가능하면 `wal_checkpoint(TRUNCATE)` 시도(실패 시 무시하고 진행 — better-sqlite3가 다음 open 시 자동 복구). |
| C-2 | `src/server/api-server.ts:117-119` | 토큰을 stderr에 출력하지 않음. `~/.cynapx/<hash>/token` (mode 0600)에 기록 + 안내 메시지에는 파일 경로만 출력. |
| C-3 | `src/indexer/metrics-calculator.ts:13-18` + `package.json` build:copy | 탐색 경로를 `cynapx-native.${process.platform}-${process.arch}*.node` 패턴으로 동적 생성. `build:copy`도 동일 네이밍 규칙 반영. |

**테스트**:
- `tests/lock-manager.test.ts`: stale lock 정리 후 **DB 본체 파일이 보존됨**을 단언하는 회귀 테스트 추가 (C-1 핵심).
- `tests/security.test.ts` 또는 신규 `tests/api-server-token.test.ts`: 토큰 미설정 시 stderr 출력에 토큰 문자열이 포함되지 않음을 확인.
- `metrics-calculator`는 플랫폼 의존적이라 단위 테스트는 "경로 패턴 생성 함수"만 분리해 테스트.

**산출물**: 1개 커밋, diagnostic-v9.md의 C-1/C-2/C-3에 [DONE] 표기.

---

## 3. Phase 12-2: Lock/Failover 안정화 (H-4 → H-1)

**목표**: 동시성 결함 중 가장 구조적인 두 항목을 순서대로.

### Step 1 — H-4: Lock 원자적 획득
- `src/utils/lock-manager.ts`: `acquire()`를 `fs.openSync(lockPath, 'wx')` 기반으로 재작성. `EEXIST` 시 기존 `getValidLock()` 경로로 폴백.
- heartbeat에 사용되는 `nonce` 비교를 stale 판정에 추가 (PID 재사용 방어).

### Step 2 — H-1: Host 승격 순서 + 가드 유틸
- `src/bootstrap.ts:202-206`: `mcpServer.promoteToHost()` 호출을 `startHostServices()` **완료 후**로 이동. 그 사이 들어오는 도구 호출은 `executeTool`에서 "엔진 초기화 중" 에러로 단기 거부(또는 짧은 재시도 큐).
- `src/server/tool-dispatcher.ts` 또는 `src/server/tools/_utils.ts`에 `requireEngine<K extends keyof EngineContext>(ctx, key): EngineContext[K]` 헬퍼 추가 — undefined면 `{ isError: true, content: [...] }` 반환.
- 11개 핸들러(`backfill-history`, `check-architecture-violations`, `check-consistency`, `discover-latent-policies`, `find-dead-code`, `get-risk-profile`, `propose-refactor`, `re-tag-project`, `health-monitor`)의 `ctx.xxx!`를 `requireEngine()` 호출로 교체.
- `src/server/mcp-server.ts:111-122` `waitUntilReady()`에서 `this.isInitialized = true` 부작용 제거 (레지스트리 체크는 에러 throw 용도로만 사용).

**테스트**:
- `tests/lock-manager.test.ts`: 동시 `acquire()` 호출 시 한쪽만 성공(EEXIST) 검증, PID 재사용 시나리오(`process.kill` mock).
- `tests/tool-dispatcher.test.ts`: 엔진 미초기화 컨텍스트로 11개 핸들러 호출 → 크래시 대신 `isError` ToolResult 반환 검증.

**산출물**: 2개 커밋 (Step별 분리).

---

## 4. Phase 12-3: FileWatcher 정합성 (H-2 → H-3)

| 항목 | 작업 |
|------|------|
| H-2 | `src/watcher/file-watcher.ts:49`의 하드코딩 확장자 체크를 `LanguageRegistry.getInstance().getAllExtensions()` (+ yaml/md/json 등 메타데이터 파서 확장자) 기반으로 교체. |
| H-3 | 같은 파일에서 `flushing` 플래그 도입. flush 진행 중 들어오는 변경은 큐에 누적만 하고, flush 완료 후 큐가 비어있지 않으면 재귀적으로 다음 flush 예약. threshold 경로에서도 `clearTimeout(this.timer)` 보장. |

**테스트**: `tests/file-watcher.test.ts` (신규) — 비-TS 확장자 변경 감지, flush 도중 추가 이벤트가 유실되지 않음(큐 길이 검증).

**산출물**: 1개 커밋.

---

## 5. Phase 12-4: 인덱싱 파이프라인 견고성 (H-5, H-6, H-7)

| 항목 | 작업 |
|------|------|
| H-5 | `src/indexer/embedding-manager.ts`: `PythonEmbeddingProvider`에 `dispose()` 추가(`SIGTERM` → 5초 후 `SIGKILL`, 재시작 루프 중단 플래그). `bootstrap.ts`에서 `lifecycle.track()`에 등록. |
| H-6 | 같은 파일의 `NullEmbeddingProvider.generate()`가 `null as unknown as number[]` 반환하는 부분을 `[]` 반환으로 변경, 호출부(`update-pipeline.ts` 임베딩 처리)에서 빈 배열 시 스킵 처리 확인. |
| H-7 | `src/indexer/update-pipeline.ts`: `processBatch()`에서 실패 파일을 별도 목록으로 추적, 트랜잭션 커밋 성공 후에만 `setLastIndexedCommit` 호출. 실패 파일은 다음 동기화 사이클에 재시도되도록 메타데이터에 보존(예: `pending_files` 또는 기존 메타데이터 테이블 재사용). |

**테스트**:
- `tests/embedding-queue.test.ts` 확장: dispose 호출 시 자식 프로세스 kill 검증(mock spawn).
- `tests/sync-strategies.test.ts` 확장: 배치 내 1개 파일 강제 실패 시 `lastIndexedCommit`이 실패 이전 커밋으로 유지되는지 검증.

**산출물**: 1~2개 커밋.

---

## 6. Phase 12-5: 그래프/DB 쿼리 최적화 (A-1, A-2, A-3, A-12)

같은 영역(`src/graph/`, `src/db/`)을 한 번에 정리.

| 항목 | 작업 |
|------|------|
| A-3 | `src/graph/optimization-engine.ts:29-95`의 raw SQL을 `NodeRepository.findDeadCodeCandidates(tier)`로 이동. |
| A-2 | 스키마 마이그레이션 추가: `node_tags(node_id, tag)` 정규화 테이블 + 인덱스. 인덱싱 파이프라인에서 태그 upsert 시 함께 기록. `findDeadCodeCandidates`가 LIKE 대신 JOIN 사용. |
| A-1 | `architecture-engine.ts`의 `checkViolations()`/`detectCycles()`를 노드+에지 1회 로드 후 인메모리 인접 리스트로 처리. `resource-provider.ts:57`의 클러스터 카운트를 `GROUP BY` 1회 쿼리로 교체. `api-server.ts:434-441`의 `mapToGraphEdge()`를 노드 ID 배치 프리페치로 변경. |
| A-12 | `vector-repository.ts:22-49`: 차원 불일치 시 `console.warn` 추가 (즉시 throw는 호출부 영향 커서 1차로는 경고만). |

**테스트**: `tests/architecture-engine.test.ts`, `tests/graph-engine.test.ts` 기존 스위트가 결과 동등성 보장하므로 결과값 비교 위주로 보강. 마이그레이션은 `tests/infrastructure.test.ts`에 스키마 버전 테스트 추가.

**산출물**: 2개 커밋 (마이그레이션/A-2 분리, 나머지 통합).

---

## 7. Phase 12-6: 잔여 LOW/최적화 일괄 처리 (O-1 ~ O-12, A-9 ~ A-11)

리스크 낮고 변경량 작은 항목을 모아 하나의 "정리" Phase로 처리. 각각 독립적이라 한 커밋에 모아도 무방하나, diff 가독성을 위해 영역별로 3개 커밋 권장.

### 커밋 A — server/IPC 정리
- O-1: `search-symbols.ts` limit 상한 `Math.min(args.limit ?? 10, 200)`
- O-12: `api-server.ts` `CYNAPX_LOG_PAYLOADS` 민감 필드 redact (token/secret/password)
- A-9: `ipc-coordinator.ts` 에러 타입 가드 + `pendingRequests` cleanup 보장
- A-10: `lifecycle-manager.ts` dispose에 5초 타임아웃 (`Promise.race`)
- A-11: `edge-repository.ts`/`node-repository.ts` 마이그레이션 후 prepared statement 무효화 훅

### 커밋 B — 인덱서 정리
- O-2: `update-pipeline.ts:391-393` canonical 키 저장으로 중복 루프 제거
- O-3: `cross-project-resolver.ts` 배치 내 원격 DB 결과 캐싱
- O-10: `worker-pool.ts` 타임아웃-메시지 경합 — `replaceWorker()`에서 타임아웃 핸들 정리
- O-11: `index-worker.ts` 톱레벨 `uncaughtException`/`unhandledRejection` 핸들러

### 커밋 C — 그래프/스키마 정리
- O-7: `graph-engine.ts:561` DFS `>` → `>=`
- O-8: `graph-engine.ts:256` 1-노드 클러스터 스킵
- O-9: `schema/schema.sql` 노드 삭제 시 `node_embeddings` 정리 트리거
- O-6: `audit-logger.ts` 100MB 기준 회전 로직

**O-4(TS Program 재사용), O-5(클러스터링 파티셔닝)**: 변경 범위가 크고 현재 규모에선 영향 적음 → Phase 12 범위에서 제외, 별도 Phase 13 후보로 diagnostic-v9에 기록만 유지.

**산출물**: 3개 커밋.

---

## 8. Phase 12-7: 언어 프로바이더 데이터 주도화 (A-5) + 리태깅 최적화 (A-4)

작업량이 가장 크고 회귀 위험이 있어 마지막 배치로 분리.

| 항목 | 작업 |
|------|------|
| A-5 | 13개 `src/indexer/languages/*.ts`를 `{ extensions, grammarModule, queryFile, captureMap }` 디스크립터로 변환하고 `language-registry.ts`가 디스크립터 배열을 순회하며 공용 팩토리로 인스턴스 생성. 클래스명 문자열 추론(`PythonProvider` 등) 제거. |
| A-4 | `update-pipeline.ts:76-97` `reTagAllNodes()`를 dirty-set worklist 알고리즘으로 재작성 (변경된 태그를 가진 노드의 부모/이웃만 재처리 큐에 추가). |

**테스트**:
- 기존 `tests/parser.test.ts` 13개 언어 전부 그린 유지가 1차 회귀 기준.
- `tests/metadata-parsers.test.ts`에 언어 디스크립터 등록 누락 검증(전체 확장자 → provider 매핑 존재) 추가.
- A-4는 대형 fixture로 패스 횟수/실행 시간 비교 벤치마크(`tests/benchmarks/`) 추가.

**산출물**: 2개 커밋 (언어 리팩터, 리태깅 분리).

---

## 9. Phase 12-8: 통합 테스트 보강 (테스트 공백 일괄)

마지막으로 전체 변경에 대한 통합 검증.

- `scripts/integration-test.js`에 **Phase 24: 동시성** 추가 — 병렬 `search_symbols` 5건, failover 도중 도구 호출(H-1 시나리오) 시뮬레이션.
- `tests/initialize-project.test.ts` 신규 — current/existing/custom × 경로 허용/거부 매트릭스, custom 모드에서도 시스템 경로(`isSystemPath`) 차단 확인 (diagnostic-v9 A-x 외 v8 잔여 항목인 시스템 경로 가드와 연계).
- `tests/certificate-generator.test.ts` 신규 — openssl 부재/실패 시 에러 처리 + 임시 파일 정리.

**산출물**: 1개 커밋, `npm test` 전체 그린 + 통합 스크립트 24 phase 통과 확인.

---

## 10. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 12-1 | C-1, C-2, C-3 | 1 | 낮음 (영향 큼, 변경 작음) |
| 12-2 | H-4, H-1 | 2 | 중간 (동시성 로직) |
| 12-3 | H-2, H-3 | 1 | 낮음 |
| 12-4 | H-5, H-6, H-7 | 1~2 | 중간 |
| 12-5 | A-1, A-2, A-3, A-12 | 2 | 중간 (스키마 마이그레이션 포함) |
| 12-6 | O-* (A-5 제외 LOW 일괄) | 3 | 낮음 |
| 12-7 | A-5, A-4 | 2 | 높음 (대규모 리팩터) |
| 12-8 | 테스트 공백 | 1 | 낮음 |

**총 13~14개 커밋**, Phase 12-1부터 순차 진행. 각 Phase 종료 시 `agent_docs/diagnostic-v9.md`에 [DONE] 마킹 후 `agent_docs/improvement-plan.md`에 Phase 12 완료 요약 추가.

---

## 11. 보류 항목 (Phase 13 후보)

- O-4: TypeScript Program 재사용/incremental build
- O-5: 클러스터링 파티셔닝 (100k+ 노드 대비)
- v8 잔여: IPC MessagePack 직렬화, 구조화 로그(pino/winston), YamlParser → js-yaml
