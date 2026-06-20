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

### 커밋 C — 그래프/스키마 정리 — [DONE]
- [DONE — verified] O-7: `graph-engine.ts`의 DFS `entry.depth > maxDepth` 가드 — 자식 노드는 `entry.depth < maxDepth`일 때만 push되므로 depth가 maxDepth를 초과하는 일이 없음을 회귀 테스트로 확인. 코드 변경 없음.
- [DONE — verified] O-8: `graph-engine.ts`의 `persistClusters()`에 이미 `clusterNodes.length < 2 && symbol_type !== 'file'`이면 스킵하는 로직이 구현되어 있음을 회귀 테스트로 확인. 코드 변경 없음.
- [DONE] O-9: `node_embeddings`(vec0)는 트리거 본문에서 참조 시 미존재 환경(vec0 미탑재 테스트 DB 등)에서 "no such table" 에러가 나므로, AFTER DELETE 트리거 대신 `NodeRepository.purgeEmbeddings()` + `deleteNodesByFilePath()`, `workspace-manager.ts`의 전체 재인덱싱 purge 경로에서 애플리케이션 레벨로 정리 (테이블 부재 시 무시).
- [DONE] O-6: `audit-logger.ts`에 `rotateIfNeeded()` 추가 — `audit.log`가 100MB(`MAX_LOG_SIZE_BYTES`)를 초과하면 `audit.log.1`로 회전 후 새 로그 시작.

**테스트**: `tests/phase12-6-commit-c.test.ts` (신규, 8개) — DFS maxDepth 경계, 단일 노드 클러스터 미영속화(파일 노드는 영속화), node_embeddings 정리(테이블 부재 시 무시 + 존재 시 정리), AuditLogger 회전(100MB 초과 시 `.1`로 rename, 미만이면 회전 안 함). `npm test` 269 → 277 통과, `tsc --noEmit` 통과.

**Phase 12-6 산출물**: 3개 커밋 (A: server/IPC, B: 인덱서, C: 그래프/스키마). `npm test` 250 → 277 통과.

### Phase 12-6 사후 리뷰 수정 — [DONE]

커밋 3b69c8f..7f1deea 코드 리뷰에서 발견된 후속 결함을 일괄 수정.

- [DONE] H1: `file-watcher.ts` — 임계치 flush 진행 중 배치 타이머가 발화하면 `this.timer`가 발화된 stale 핸들을 계속 보유해, flush 종료 후 재스케줄링이 생략되고 큐 이벤트가 방치되는 버그. 모든 타이머 콜백에서 flush 전에 `this.timer = null` 처리 + post-flush 재스케줄러를 무조건 clearTimeout 후 재스케줄로 변경.
- [DONE] M1: `cross-project-resolver.ts` — `resolve()` catch에서 이번 호출에 연 연결을 close 없이 캐시에서만 삭제(파일 핸들 누수)하고, 기캐시된 깨진 연결은 배치 내내 유지하던 문제 → 무조건 close 후 캐시에서 제거.
- [DONE] M2: `reTagAllNodes()`가 `UPDATE nodes SET tags = ?`만 수행해 node_tags 미러 불변식(마이그레이션 2)을 깨던 문제 → `NodeRepository.replaceTags()` 헬퍼 추가(nodes.tags 갱신 + node_tags delete/reinsert) 후 persist 루프에서 사용.
- [DONE] M3: `invalidateStatementCache()`(A-11)가 프로덕션에서 호출되지 않던 문제 → `DatabaseManager.onMigration(cb)` 추가(마이그레이션 실제 수행 시에만 콜백 발화), `workspace-manager.ts`에서 EdgeRepository 캐시 무효화를 등록.
- [DONE] M4: `search-symbols.ts` limit 클램프가 음수를 통과시켜 SQLite `LIMIT -1`(무제한)이 되던 문제 → `Math.min(Math.max(Math.floor(args.limit) || 10, 1), 200)`로 [1, 200] 클램프.
- [DONE] M5: 테스트 품질 — O-1 테스트를 실제 `searchSymbolsHandler.execute` 호출(mock ToolDeps)로 재작성(+음수/초과 limit 회귀), O-12는 `redactSensitiveFields`를 api-server에서 export해 실제 구현 검증, O-11 테스트는 import가 등록한 process 핸들러를 diff 후 제거.
- [DONE] L1: `PythonEmbeddingProvider.generateBatch` 폴백 시 `null as unknown as number[][]` 대신 `[]` 반환, `generate()`는 빈 배치 시 명시적 에러, `refreshAll()`은 빈 배열 스킵.
- [DONE] L6: `PythonEmbeddingProvider.start()`에 `disposed` 가드 추가 — dispose 후 사이드카 재기동 방지.
- [DONE] L4: redact 정규식에 passwd/credential/cookie/session 및 단독 `auth` 키(`(^|_)auth($|_)` — `author`는 미마스킹) 추가.

**테스트**: file-watcher H1 회귀, CrossProjectResolver 에러 경로(M1), replaceTags/reTagAllNodes node_tags 동기화(M2), onMigration 콜백(M3), 실핸들러 limit 클램프(M4/M5), redact 확장(L4), 폴백 반환 타입(L1)/post-dispose 가드(L6). `npm test` 277 → 289 통과, `tsc --noEmit` 통과.

**O-4(TS Program 재사용), O-5(클러스터링 파티셔닝)**: 변경 범위가 크고 현재 규모에선 영향 적음 → Phase 12 범위에서 제외, 별도 Phase 13 후보로 diagnostic-v9에 기록만 유지.

**산출물**: 3개 커밋.

---

## 8. Phase 12-7: 언어 프로바이더 데이터 주도화 (A-5) + 리태깅 최적화 (A-4) — [DONE]

작업량이 가장 크고 회귀 위험이 있어 마지막 배치로 분리.

| 항목 | 작업 |
|------|------|
| A-5 | [DONE] 13개 `src/indexer/languages/*.ts`를 `{ extensions, grammarModule, queryFile, captureMap }` 디스크립터로 변환하고 `language-registry.ts`가 디스크립터 배열을 순회하며 공용 팩토리로 인스턴스 생성. 클래스명 문자열 추론(`PythonProvider` 등) 제거. |
| A-4 | [DONE] `update-pipeline.ts` `reTagAllNodes()`를 dirty-set worklist 알고리즘으로 재작성 (변경된 태그를 가진 노드의 부모/이웃만 재처리 큐에 추가). |

### A-5 언어 프로바이더 데이터 주도화 — [DONE]

- [DONE] `src/indexer/languages/descriptor.ts` 신규 — `LanguageDescriptor` 타입(`{ name, extensions, grammarModule, grammarExport?, queryFile, captureMap, defaultSymbolType, decisionPoints, resolveImport? }`) + 공용 팩토리 `createLanguageProvider(descriptor)`. 팩토리가 `.scm` 로딩(`queries/` 공통 경로), `startsWith` 프리픽스 기반 `mapCaptureToSymbolType`, 그래머 lazy `require` + 캐싱을 일괄 처리.
- [DONE] 12개 언어 파일(`python.ts` 등) 전부 클래스 → 디스크립터 상수(`pythonDescriptor` 등)로 변환. 언어별 고유 로직인 `resolveImport`만 디스크립터의 옵셔널 함수 훅으로 유지(본문 그대로 보존) — 나머지는 전부 데이터. `tree-sitter-typescript`/`tree-sitter-php`의 서브 익스포트는 `grammarExport: 'typescript' | 'php'`로 표현.
- [DONE] `src/indexer/languages/index.ts` 신규 — `LANGUAGE_DESCRIPTORS` 배열이 단일 진실 공급원. 신규 언어 추가 = 디스크립터 1개 + 배열 1줄.
- [DONE] `language-registry.ts`: 하드코딩 확장자→모듈경로 맵과 클래스명 문자열 조립 추론(`'python' → PythonProvider`) 제거. 생성자가 `LANGUAGE_DESCRIPTORS`를 순회해 확장자→디스크립터 맵을 구축하고, `getProvider()`는 첫 조회 시 팩토리로 인스턴스 생성(그래머 로드 실패 시 기존처럼 undefined로 우아한 강등). 그래머 lazy 로딩/플러그인 우선순위/`getAllExtensions()` 의미는 기존과 동일.
- 부수 정합성 수정(리팩터에 본질적으로 얽힘): 기존에는 `CppProvider.extensions`에 있던 `hxx`가 레지스트리의 확장자 맵에는 누락되어 `.hxx` 조회가 로딩 순서에 따라 달라졌음 — 디스크립터 단일 소스화로 `.hxx`가 항상 cpp로 결정적으로 매핑됨.

**테스트 (A-5)**: `tests/language-registry.test.ts` (신규, 19개 — `metadata-parsers.test.ts`는 Yaml/Md/Json 파서 전용이라 별도 파일로 분리) — 디스크립터 무결성(12개 언어, 확장자 중복 없음, 쿼리 파일 존재), 12개 언어 전부 팩토리로 동작하는 provider 생성(그래머 로드 + 쿼리 컴파일 + captureMap/decisionPoints 데이터 일치), 레지스트리가 전체 확장자→provider 매핑을 해석(언어 누락 없음, 클래스명 추론 무관), 대소문자 무시 조회. `tests/parser.test.ts`/`tests/benchmarks/parsing.bench.ts`는 클래스 대신 디스크립터+팩토리 사용으로 갱신(스냅샷 전부 그린 유지). `npm test` 296 → 315 통과, `tsc --noEmit` + `npm run build` 통과.

### A-4 리태깅 최적화 — [DONE]

- [DONE] `EdgeRepository.getEdgesByTypes(types)` 추가 — `edge_type IN (...)` 단일 스캔으로 전파 인접 리스트(`parentsOf`/`childrenOf`)를 1회 구축. 기존의 "패스마다 노드별 `getOutgoingEdges()` 호출" 패턴 제거.
- [DONE] `reTagAllNodes()`를 dirty-set worklist로 재작성: 부모(`inherits`/`implements`)가 있는 노드만 큐에 시드 → 노드의 태그가 실제로 변한 경우에만 직계 자식들을 재큐잉. `inQueue` Set으로 중복 큐잉 방지, 인덱스 기반 FIFO(O(1) pop), `nodeMap.size * 5` 안전 상한(기존 MAX_PASSES=5와 동일한 의미). 고정 5패스 상한이 사라져 깊이 5 초과 상속 체인도 완전 전파됨.
- [DONE] persist 단계도 dirty 기반: 계산된 태그가 저장된 `nodes.tags`와 집합 단위로 다른 노드만 `nodeRepo.replaceTags()` 호출 (M2 node_tags 미러 불변식 유지, 불필요한 전체 노드 rewrite 제거 — fixed point에서 재실행 시 쓰기 0회).

**테스트 (A-4)**: `tests/phase12-7-a4.test.ts` (신규, 7개) — 다단계 상속 전파 정확성, fixed point 멱등성(replaceTags 0회), dirty 노드만 rewrite, mergeRoles 호출 수가 전파 서브그래프에 비례(전체 노드 수 무관), node_tags 미러 동기화(M2), 상속 사이클 종료, `getEdgesByTypes` 필터링. `tests/benchmarks/retag.bench.ts` (신규) — 200/2000 노드 fixture 풀 리태그 벤치마크. `npm test` 289 → 296 통과, `tsc --noEmit` 통과.

**테스트**:
- [DONE] 기존 `tests/parser.test.ts` 언어 스냅샷 전부 그린 유지가 1차 회귀 기준.
- [DONE] 언어 디스크립터 등록 누락 검증(전체 확장자 → provider 매핑 존재)은 `tests/language-registry.test.ts` 신규 파일로 추가 (`metadata-parsers.test.ts`는 메타데이터 파서 전용이라 범위 불일치).
- [DONE] A-4는 대형 fixture로 패스 횟수/실행 시간 비교 벤치마크(`tests/benchmarks/`) 추가.

**산출물**: 2개 커밋 (언어 리팩터, 리태깅 분리) — 완료.

---

## 9. Phase 12-8: 통합 테스트 보강 (테스트 공백 일괄) — [DONE]

마지막으로 전체 변경에 대한 통합 검증.

- [DONE] `scripts/integration-test.js`에 **Phase 24: 동시성** 추가 — (24a) 병렬 `search_symbols` 5건 `Promise.allSettled` 동시 실행 전부 성공 검증, (24b) failover 도중 도구 호출(H-1) 시뮬레이션: 단일 프로세스 하니스라 실제 Host 승격은 불가하므로 `attemptFailover`가 여는 `markReady(false)` 창을 pending `waitUntilReady` 게이트로 충실히 재현 — not-ready 창 동안 도구 호출이 블록되고 `markReady(true)` 후 정상 완료됨을 검증, (24c) 엔진 미구성 컨텍스트(`optEngine` 부재)에 대해 `requireEngine()`이 크래시 대신 구조화된 `isError`(EngineNotReadyError 메시지)를 반환함을 검증.
- [DONE] `tests/initialize-project.test.ts` 신규 (13개) — current/existing/custom × 경로 허용/거부 매트릭스 (HOME을 임시 디렉터리로 스텁해 레지스트리 격리): current/existing은 home/cwd 밖 경로 거부 + 허용 경로에서 `onInitialize`/`markReady(true)` 호출, existing은 기인덱스 DB 재사용 시 `onInitialize` 스킵, custom은 경계 검사 생략하되 시스템 경로는 `addToRegistry`의 `isSystemPath` 가드로 차단(`/etc`, `/usr/lib`) 확인. `isSystemPath` 단위 검증(시스템 경로 true / home·tmp·prefix-유사 경로 false) 포함.
- [DONE] `tests/certificate-generator.test.ts` 신규 (7개) — `child_process.execSync` 모킹으로 실제 openssl 불필요: 성공 경로(key/cert 버퍼 반환 + 임시 파일 즉시 삭제), openssl 부재(ENOENT) 시 래핑된 에러 + 임시 파일 미잔존, 비정상 종료(부분 출력) 시 에러 + finally 정리, 출력 파일 미생성 시 에러, 호출별 임시 파일명 유일성, 비대화형 인자(`-nodes`/`-subj`) 검증.
- [DONE] 부수 수정 (통합 스크립트 자체 버그): Phase 1의 `PATH_OUTSIDE_BOUNDARY`가 `'C:\\Windows\\System32'`를 사용 — POSIX에서는 상대 경로로 해석되어 cwd 하위로 resolve되면서 경계 검사를 **통과**(리포 안에 `C:\Windows\System32` 정크 디렉터리 생성 + 레지스트리 오염). 플랫폼 무관 절대 경로(`path.parse(ROOT).root + 'cynapx-outside-boundary-test'`)로 교체.

**산출물**: 1개 커밋. `npm test` 315 → 336 통과, `tsc --noEmit` 통과, 통합 스크립트 **69/69 (Phase 0~24) 통과**.

---

## 9.5. Phase 12 전체 완료

**Phase 12-1 ~ 12-8 전부 [DONE]** — diagnostic-v9의 CRITICAL 3건, HIGH 7건, MEDIUM(A) 항목(이연분 제외), LOW/최적화(O) 항목(O-4/O-5 이연), 테스트 공백 6건 해소 완료. 최종 상태: `npm test` 336/336, `tsc --noEmit` 그린, 통합 스크립트 69/69 (Phase 0~24). 잔여 이연 항목은 11장(Phase 13 후보) 참조.

---

## 10. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 12-1 | C-1, C-2, C-3 | 1 | 낮음 (영향 큼, 변경 작음) |
| 12-2 | H-4, H-1 | 2 | 중간 (동시성 로직) |
| 12-3 | H-2, H-3 | 1 | 낮음 |
| 12-4 | H-5, H-6, H-7 | 1~2 | 중간 |
| 12-5 | A-1, A-2, A-3, A-12 | 2 | 중간 (스키마 마이그레이션 포함) |
| 12-6 | O-* (A-5 제외 LOW 일괄) — [DONE] | 3 | 낮음 |
| 12-7 | A-5, A-4 — [DONE] | 2 | 높음 (대규모 리팩터) |
| 12-8 | 테스트 공백 — [DONE] | 1 | 낮음 |

**총 13~14개 커밋**, Phase 12-1부터 순차 진행. 각 Phase 종료 시 `agent_docs/diagnostic-v9.md`에 [DONE] 마킹 후 `agent_docs/improvement-plan.md`에 Phase 12 완료 요약 추가.

---

## 11. 보류 항목 (Phase 13 후보)

- O-4: TypeScript Program 재사용/incremental build
- O-5: 클러스터링 파티셔닝 (100k+ 노드 대비)
- v8 잔여: IPC MessagePack 직렬화, 구조화 로그(pino/winston), YamlParser → js-yaml
