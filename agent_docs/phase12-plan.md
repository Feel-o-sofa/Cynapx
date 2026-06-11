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

## 2. Phase 12-1: CRITICAL 즉시 패치 (데이터 손실/보안) — [DONE]

**목표**: 가장 파급력이 큰 3건. 코드 변경량은 작지만 영향 범위가 크므로 최우선.

| 항목 | 파일 | 작업 |
|------|------|------|
| C-1 [DONE] | `src/utils/lock-manager.ts` | suffix 배열에서 `''`(DB 본체) 제거. `-wal`/`-shm` 삭제 전 `wal_checkpoint(TRUNCATE)` 수행 후 저널 파일 삭제. |
| C-2 [DONE] | `src/server/api-server.ts` | 생성된 토큰을 stderr에 출력하지 않음. `~/.cynapx/api-token` (mode 0600)에 기록 + 안내 메시지에는 파일 경로만 출력. |
| C-3 [DONE] | `src/indexer/metrics-calculator.ts` | 탐색 경로를 `cynapx-native.${process.platform}-${process.arch}*.node` 패턴(prefix 매칭)으로 동적 생성. `build:copy`는 이미 플랫폼 무관 `.endsWith('.node')` 필터 사용 중 — 변경 불필요. |

**테스트**:
- `tests/lock-manager.test.ts`: stale lock 정리 시 실제 better-sqlite3 WAL DB를 만들어 **DB 본체 파일과 데이터가 보존됨**을 검증하는 회귀 테스트 추가 (C-1 핵심).
- `tests/infrastructure.test.ts`: 토큰 미설정 시 `console.error` 호출에 토큰 문자열이 포함되지 않고, `~/.cynapx/api-token`에 64자 hex 토큰이 기록됨을 검증 (C-2).
- C-3은 플랫폼 의존적이라 별도 테스트 없이 `npx tsc --noEmit` + 기존 parser/metrics 테스트로 회귀만 확인.

**산출물**: 1개 커밋, diagnostic-v9.md의 C-1/C-2/C-3에 [DONE] 표기. `npm test` 213/213 통과, `tsc --noEmit` 통과.

---

## 3. Phase 12-2: Lock/Failover 안정화 (H-4 → H-1)

**목표**: 동시성 결함 중 가장 구조적인 두 항목을 순서대로.

### Step 1 — H-4: Lock 원자적 획득 — [DONE]
- `src/utils/lock-manager.ts`: `acquire()`를 `fs.openSync(lockPath, 'wx')` 기반(`tryCreateLockFile`)으로 재작성. `EEXIST` 시 `getValidLock()`으로 stale 여부 확인 후 정리·재시도, 살아있는 락이면 `LockHeldError`를 throw.
- `src/bootstrap.ts`의 `acquireAndRun`/`attemptFailover` 양쪽에서 `LockHeldError`를 캐치하여 승격 레이스에서 진 경우 Terminal 모드로 폴백(`ipcCoordinator.close()` 후 재연결/재시도).
- nonce 비교 기반 stale 판정은 기존에 이미 구현되어 있었음(재확인만).
- 테스트: `tests/lock-manager.test.ts`에 "atomic acquire (H-4)" describe 블록 추가 — LockHeldError 발생, stale lock 정리 후 acquire 성공, TOCTOU 없이 두 번째 acquire가 거부됨을 검증. `npm test` 213 → 218 통과.

### Step 2 — H-1: Host 승격 순서 + 가드 유틸 — [DONE]
- [DONE] `src/server/mcp-server.ts` `waitUntilReady()`에서 `this.isInitialized = true` 부작용 제거 (레지스트리 체크는 에러 throw 용도로만 사용). 회귀 테스트: `tests/mcp-server.test.ts`.
- [DONE] `src/bootstrap.ts` `attemptFailover`: 락 재획득 직후 `mcpServer.markReady(false)`로 `readyPromise`를 pending으로 리셋한 뒤 `promoteToHost()` → `startHostServices()` → `finally`에서 `markReady(true)`. 이 창 동안 들어오는 도구 호출은 `waitUntilReady()`에서 블록되어 엔진 미초기화 상태로 핸들러가 실행되지 않음.
- [DONE] `src/server/tools/_utils.ts`에 `EngineNotReadyError` + `requireEngine<K extends keyof EngineContext>(ctx, key): NonNullable<EngineContext[K]>` 헬퍼 추가. `src/server/tool-dispatcher.ts`의 `executeTool()`이 `EngineNotReadyError`를 캐치해 `{ isError: true, content: [...] }`로 변환.
- [DONE] 핸들러(`backfill-history`, `check-architecture-violations`, `check-consistency`, `discover-latent-policies`, `find-dead-code`, `get-risk-profile`, `propose-refactor`, `re-tag-project`, `health-monitor`, `export-graph`, `get-related-tests`, `search-symbols`)의 `ctx.xxx!`를 `requireEngine()` 호출로 교체. (`analyze-impact`는 이미 `!ctx.graphEngine` 가드가 있어 그대로 둠.)
- [DONE] `tests/tool-dispatcher.test.ts`에 "H-1 requireEngine guard" describe 블록 추가 — 6개 핸들러에 대해 엔진 미초기화 시 `isError` + 필드명 포함 메시지 검증. `npm test` 218 → 225 통과, `tsc --noEmit` 통과.

**산출물**: Step 1 커밋(fd25c94, waitUntilReady 포함) + Step 2 나머지 1개 커밋.

---

## 4. Phase 12-3: FileWatcher 정합성 (H-2 → H-3) — [DONE]

| 항목 | 작업 |
|------|------|
| H-2 | [DONE] `src/watcher/file-watcher.ts`의 하드코딩 확장자 체크를 `LanguageRegistry.getInstance().getAllExtensions()` (+ yaml/md/json 등 메타데이터 파서 확장자) 기반의 `watchedExtensions` Set으로 교체. |
| H-3 | [DONE] 같은 파일에서 `flushing` 플래그 도입. flush 진행 중 들어오는 변경은 큐에 누적만 하고, flush 완료 후 큐가 비어있지 않으면 재귀적으로 다음 flush 예약(또는 타이머 재설정). threshold 경로에서도 `clearTimeout(this.timer)` 보장. |

**테스트**: `tests/file-watcher.test.ts` (신규, 7개 테스트) — 비-TS 확장자(.rs/.go/.yaml/.md/.json) 큐잉, 미지원 확장자(.png/.exe) 무시, flush 도중 추가 이벤트가 유실되지 않고 후속 flush로 처리됨, 동시 flush 호출이 no-op임을 검증. `npm test` 225 → 232 통과, `tsc --noEmit` 통과.

**산출물**: 1개 커밋.

---

## 5. Phase 12-4: 인덱싱 파이프라인 견고성 (H-5, H-6, H-7) — [DONE]

| 항목 | 작업 |
|------|------|
| H-5 | [DONE] `src/indexer/embedding-manager.ts`: `PythonEmbeddingProvider`에 `dispose()` 보강 (`SIGTERM` → 5초 후 미종료 시 `SIGKILL`, `disposed` 플래그로 자동 재시작 루프 중단). `EmbeddingProvider` 인터페이스에 옵셔널 `dispose?()` 추가, `McpServer.getEmbeddingProvider()` 노출, `bootstrap.ts`에서 `lifecycle.track({ dispose: () => mcpServer.getEmbeddingProvider().dispose?.() })`로 등록. |
| H-6 | [DONE] 같은 파일의 `NullEmbeddingProvider.generate()`/`generateBatch()`가 `null as unknown as ...` 반환하던 것을 각각 `[]` 반환으로 변경. `vectorRepo.search([], limit)`은 차원 불일치로 `[]`를 반환하는 기존 가드와 자연스럽게 합류해 호출부(`search-symbols.ts`) 변경 불필요. |
| H-7 | [DONE] `src/indexer/update-pipeline.ts`: `processBatch(events, version, targetCommit?)`에 `targetCommit` 파라미터 추가. 트랜잭션 COMMIT 성공 후 실패 파일이 0건이면 `metadataRepo.setLastIndexedCommit(targetCommit)` 호출, 1건 이상이면 워터마크를 갱신하지 않고 로그로 보고 — 다음 `syncWithGit()`이 동일 diff 범위(실패 파일 포함)를 재시도. `syncWithGit()`은 `strategy.buildEvents()`가 반환한 `result.head`를 `targetCommit`으로 전달하도록 수정. |

**테스트**:
- `tests/embedding-queue.test.ts` 확장 — `PythonEmbeddingProvider.dispose()` describe 블록 3건(mock spawn): SIGTERM→SIGKILL 에스컬레이션, 정상 종료 시 SIGKILL 미발송, dispose 후 자동 재시작 루프 중단. `NullEmbeddingProvider` 테스트를 `[]` 반환 기준으로 갱신.
- `tests/update-pipeline-batch.test.ts` (신규) — `processBatch()`가 전체 성공 시 `targetCommit`으로 워터마크를 전진시키고, 1개 파일 실패 시 워터마크를 전진시키지 않으며, `targetCommit` 미전달 시 호출하지 않음을 검증.

`npm test` 232 → 238 통과, `tsc --noEmit` 통과.

**산출물**: 1개 커밋.

---

## 6. Phase 12-5: 그래프/DB 쿼리 최적화 (A-1, A-2, A-3, A-12) — [DONE]

같은 영역(`src/graph/`, `src/db/`)을 한 번에 정리.

| 항목 | 작업 |
|------|------|
| A-3 | [DONE] `src/graph/optimization-engine.ts`의 raw SQL을 `NodeRepository.findDeadCodeCandidates(tier)`로 이동. |
| A-2 | [DONE] 스키마 마이그레이션 1→2 추가: `node_tags(node_id, tag)` 정규화 테이블 + 인덱스 (+ 기존 데이터 백필). `NodeRepository.createNode()`에서 태그 upsert 시 함께 기록. `findDeadCodeCandidates`가 LIKE 대신 `node_tags` EXISTS/JOIN 사용. |
| A-1 | [PARTIAL DONE] `resource-provider.ts:57`의 클러스터별 `COUNT(*)`를 `GROUP BY cluster_id` 1회 쿼리로 교체. `architecture-engine.ts`의 `checkViolations()`/`detectCycles()`와 `api-server.ts`의 `mapToGraphEdge()`는 `GraphEngine`의 `nodeCache`/`qnameCache`(LRU 10k)로 이미 캐시되어 있어 반복 SQL 비용이 사실상 제거됨 — 인접 리스트 전면 재작성은 고위험이라 별도 Phase로 이연 (diagnostic-v9 A-1 항목에 근거 기록). |
| A-12 | [DONE — 기 구현 확인] `vector-repository.ts`의 `search()`는 이미 차원 불일치 시 `console.error` 경고 + `[]` 반환을 구현하고 있음을 확인. 코드 변경 없음. |

**테스트**:
- `tests/optimization-engine.test.ts` (신규) — `findDeadCode()`가 `node_tags` 기반으로 trait:entrypoint/trait:abstract/trait:internal을 올바르게 필터링하고, `createNode()`가 `node_tags`를 upsert/replace함을 검증.
- `tests/database-migration.test.ts` (신규) — `SCHEMA_VERSION`, `node_tags`/인덱스 생성, 마이그레이션 1→2 백필 검증.
- `tests/resource-provider.test.ts` (신규) — `graph://clusters`가 `GROUP BY` 기반 `node_count`를 올바르게 반환함을 검증.

`npm test` 238 → 250 통과, `tsc --noEmit` 통과.

**산출물**: 2개 커밋 (마이그레이션+A-2/A-3 / A-1+A-12).

---

## 7. Phase 12-6: 잔여 LOW/최적화 일괄 처리 (O-1 ~ O-12, A-9 ~ A-11)

리스크 낮고 변경량 작은 항목을 모아 하나의 "정리" Phase로 처리. 각각 독립적이라 한 커밋에 모아도 무방하나, diff 가독성을 위해 영역별로 3개 커밋 권장.

### 커밋 A — server/IPC 정리 — [DONE]
- [DONE] O-1: `search-symbols.ts` limit 상한 `Math.min(args.limit || 10, 200)`로 변경.
- [DONE] O-12: `api-server.ts`에 `redactSensitiveFields()` 추가 (token/secret/password/apikey/api_key/authorization 키를 재귀적으로 `[REDACTED]`), `CYNAPX_LOG_PAYLOADS=1` 로깅 경로에 적용.
- [DONE] A-9: `ipc-coordinator.ts` Host 측 `executeTool` catch를 `err: unknown` + `err instanceof Error ? err.message : String(err)`로 타입 가드. Terminal 측 소켓 `close` 이벤트에서 `pendingRequests`에 남은 요청을 모두 reject 후 clear (30초 타임아웃을 기다리지 않음).
- [DONE] A-10: `lifecycle-manager.ts`의 `disposeAll()`에서 각 리소스의 `dispose()`를 5초(`DISPOSE_TIMEOUT_MS`) `Promise.race` 타임아웃으로 감싸 무한 대기 방지.
- [DONE] A-11: `edge-repository.ts`에 `invalidateStatementCache()` 추가 — 캐시된 prepared statement를 모두 초기화해 다음 호출 시 현재 스키마로 재준비되도록 함. (`node-repository.ts`는 prepared statement를 캐시하지 않아 변경 불필요.)

**테스트**: `tests/phase12-6-commit-a.test.ts` (신규, 11개) — limit clamp, redact 재귀 동작, IPC 연결 종료 시 pending 요청 reject 및 비-Error 에러 처리, LifecycleManager의 dispose 타임아웃/예외 후속 처리, EdgeRepository 캐시 무효화 후 정상 동작 검증. `npm test` 250 → 261 통과, `tsc --noEmit` 통과.

### 커밋 B — 인덱서 정리 — [DONE]
- [DONE] O-2: `update-pipeline.ts`의 `resolveNodeId()`에서 `internalMap`(symbolCache)이 이미 canonical 키로 저장되므로, `toCanonical(key) === canonicalQName` 전체 재스캔 루프를 제거하고 `Map.get()` 직접 조회만 사용.
- [DONE] O-3: `cross-project-resolver.ts`에 `beginBatch()`/`endBatch()` 추가 — 배치 동안 원격 DB 연결을 `batchDbCache`에 캐싱해 재사용하고, 배치 종료 시 일괄 close. `update-pipeline.ts`의 `processBatch()`가 트랜잭션 전후로 호출.
- [DONE — verified] O-10: `worker-pool.ts`의 타임아웃-메시지 경합 — 기존 `settled` 플래그 + `clearTimeout(active.timeoutHandle)` 가드가 이미 안전하게 동작함을 fake `worker_threads` + `vi.useFakeTimers()`로 검증 (메시지 우선 시 타임아웃 무효화, 타임아웃 시 워커 교체+reject, dispose 시 큐잉된 작업 reject). 코드 변경 없음.
- [DONE] O-11: `index-worker.ts`에 톱레벨 `process.on('uncaughtException'/'unhandledRejection', ...)` 핸들러 추가 — 로그 출력 후 재throw하여 메인 스레드의 `worker.on('error', ...)` (`replaceWorker`)로 명확히 전파.

**테스트**: `tests/phase12-6-commit-b.test.ts` (신규, 8개) — `toCanonical` 멱등성, CrossProjectResolver 배치 캐싱(연결 재사용 + endBatch 시 close, 비배치 모드 호환), WorkerPool 타임아웃/메시지 settle 가드(fake worker_threads), index-worker 핸들러 등록 확인. `npm test` 261 → 269 통과, `tsc --noEmit` 통과.

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
