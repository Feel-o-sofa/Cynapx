# Cynapx 정밀 진단 보고서 v9

- **기준 커밋**: `320a9a8` (v2.0.0 문서 개편) + `3f77124` (lockfile 버전 동기화)
- **진단 일자**: 2026-06-10
- **진단 범위**: src/ 전체 (서버, 인덱서, 그래프/DB, 인프라/유틸), 빌드 스크립트, Dockerfile, 테스트 커버리지
- **진단 방법**: 4개 영역 병렬 정밀 감사 + 핵심 발견 사항 수동 코드 검증
- **현재 상태**: `tsc --noEmit` 통과, 테스트 211/211 통과 — 그러나 아래 결함들은 테스트가 커버하지 않는 경로에 존재

---

## 1. CRITICAL — 즉시 수정 필요

> **[DONE — Phase 12-1]** C-1/C-2/C-3 모두 수정 완료. 회귀 테스트 추가, `npm test` 213/213 통과.

### C-1. Stale lock 정리 시 메인 DB 파일 삭제 (데이터 전손)
**`src/utils/lock-manager.ts:69-77`**

```typescript
const dbFile = path.join(getCentralStorageDir(), `${lockHash}_v2.db`);
['', '-wal', '-shm'].forEach(suffix => {
    const file = `${dbFile}${suffix}`;
    if (fs.existsSync(file)) {
        try { fs.unlinkSync(file); } catch(err) { ... }
    }
});
```

`''` suffix가 포함되어 있어 **`-wal`/`-shm` 저널뿐 아니라 DB 본체(`<hash>_v2.db`)까지 삭제**한다. Host 프로세스가 비정상 종료(크래시, OOM kill, 전원 차단)하면 다음에 뜨는 프로세스가 stale lock을 감지하고 **전체 인덱스를 날려버린다**. 대형 프로젝트라면 수십 분짜리 풀 재인덱싱이 강제된다.

추가로, `-wal`을 checkpoint 없이 삭제하면 WAL에만 존재하던 최근 커밋 데이터가 유실된다.

**수정**:
1. `''` suffix 제거 — DB 본체는 절대 삭제하지 않는다.
2. WAL 정리가 필요하면 삭제 대신 `new Database(dbFile)` 후 `PRAGMA wal_checkpoint(TRUNCATE)` 실행으로 안전하게 플러시한다. better-sqlite3는 어차피 다음 open 시 WAL을 자동 복구하므로, 사실상 저널 삭제 자체가 불필요하다.

### C-2. API 인증 토큰이 로그에 평문 노출
**`src/server/api-server.ts:117-119`**

```typescript
const generatedToken = crypto.randomBytes(32).toString('hex');
console.error('[cynapx] WARNING: No KNOWLEDGE_TOOL_TOKEN set. Generated temporary token:', generatedToken);
```

stderr가 로그 수집기(CloudWatch, Datadog, journald 등)로 포워딩되는 환경에서 토큰이 영구 기록된다. 로그 열람 권한만 있으면 API 전체에 접근 가능.

**수정**: 토큰 값은 로그에 남기지 않는다. 파일(`~/.cynapx/token`, mode 0600)에 기록하고 로그에는 경로만 안내하거나, 첫 8자만 마스킹 출력.

### C-3. 네이티브 가속 모듈이 Windows 전용 경로로 하드코딩
**`src/indexer/metrics-calculator.ts:13-18`**

```typescript
const possiblePaths = [
    path.resolve(__dirname, '../cynapx-native.win32-x64-msvc.node'),
    ...
];
```

탐색 경로 4개가 전부 `win32-x64-msvc` 고정. **Linux/macOS에서는 네이티브 가속이 절대 로드되지 않고** 조용히 JS 폴백으로 떨어진다(CC 계산 등이 수~수십 배 느려짐). Dockerfile로 배포하는 Linux 컨테이너에서도 항상 폴백이다.

**수정**: `cynapx-native.${process.platform}-${process.arch}*.node` 패턴으로 동적 탐색하고, 폴백 시 1회 경고 로그 출력. `build:copy` 스크립트도 동일하게 플랫폼 무관 처리.

---

## 2. HIGH — 안정성/정합성 결함

### H-1. Host 승격 윈도우 레이스 → 도구 핸들러 크래시 — partially [DONE — Phase 12-2 Step 2]
> `src/server/mcp-server.ts` `waitUntilReady()`의 `this.isInitialized = true` 부작용은 제거됨(`tests/mcp-server.test.ts`). `promoteToHost()` 순서 변경 + `requireEngine()` 가드 + 11곳 `ctx.xxx!` 교체는 아직 미착수.

**`src/bootstrap.ts:202-206`, `src/server/mcp-server.ts:111-122`, `src/server/tools/*.ts` (11곳)**

Terminal 모드에서는 `setTerminal()`이 `markReady(true)`를 호출해 `readyPromise`가 이미 resolve된 상태다. Host 사망으로 failover가 일어나면:

```typescript
mcpServer.promoteToHost();        // isTerminal=false — 이 순간부터 로컬 실행
await startHostServices();        // 엔진 초기화는 아직 진행 중
mcpServer.markReady(true);
```

`promoteToHost()`와 `startHostServices()` 완료 사이에 도구 호출이 들어오면, `executeTool`은 포워딩하지 않고(`isTerminal()=false`) `waitUntilReady()`도 통과(promise 이미 resolved)하여 핸들러가 실행된다. 이때 `ctx.optEngine!`, `ctx.archEngine!`, `ctx.refactorEngine!`, `ctx.policyDiscoverer!`, `ctx.gitService!`, `ctx.updatePipeline!` 등 **11곳의 non-null 단언이 undefined 호출로 크래시**한다.

또한 `waitUntilReady()` 자체에 부작용이 있다:

```typescript
private async waitUntilReady() {
    if (!this.isInitialized) {
        ...
        this.isInitialized = true;   // 엔진 초기화 없이 플래그만 set
    }
    await this.readyPromise;
}
```

레지스트리 등록 여부만 확인하고 `isInitialized = true`를 설정해 `isReady` getter와 실제 엔진 상태가 불일치하게 된다.

**수정**:
1. `promoteToHost()`를 `startHostServices()` **완료 후**에 호출하도록 순서 변경 (승격 전까지는 요청을 거부하거나 큐잉).
2. 도구 핸들러의 `ctx.xxx!`를 공용 가드 유틸(`requireEngine(ctx, 'optEngine')`)로 교체 — 미초기화 시 `isError` ToolResult 반환.
3. `waitUntilReady()`에서 상태 플래그 변경 제거.

### H-2. FileWatcher가 3개 확장자만 감시
**`src/watcher/file-watcher.ts:49`**

```typescript
if (!filePath.endsWith('.ts') && !filePath.endsWith('.js') && !filePath.endsWith('.py')) return;
```

인덱서는 13개 언어 + YAML/Markdown/JSON을 지원하는데 워처는 `.ts`/`.js`/`.py`만 통과시킨다. **Rust, Go, Java, C/C++, C#, Kotlin, PHP, GDScript 프로젝트는 실시간 동기화가 전혀 동작하지 않고** 인덱스가 조용히 낡아간다.

**수정**: `LanguageRegistry`의 확장자 목록(+메타데이터 파서 확장자)을 단일 소스로 참조.

### H-3. FileWatcher 동시 flush 가드 부재
**`src/watcher/file-watcher.ts:55-60, 62-102`**

`flush()`가 async인데 in-flight 가드가 없다. `BATCH_THRESHOLD` 도달로 `flush()`가 시작된 뒤(이때 `this.timer`는 정리되지 않음) 타이머가 발화하거나 추가 이벤트로 두 번째 flush가 트리거되면 **`processBatch()`/`syncWithGit()`이 동시에 실행**되어 DB 쓰기 경합과 메타데이터 커밋 역행이 발생할 수 있다.

**수정**: `flushing` 플래그 + 후속 이벤트는 다음 사이클로 이연하는 체이닝(`flushPromise = flushPromise.then(...)`) 적용. threshold 경로에서도 `clearTimeout` 수행.

### H-4. Lock 획득이 비원자적 (check-then-write TOCTOU) — [DONE — Phase 12-2 Step 1]
**`src/bootstrap.ts:212-241`, `src/utils/lock-manager.ts:93-103`**

`getValidLock()`으로 확인 후 `acquire()`가 `fs.writeFileSync()`로 덮어쓴다. 두 프로세스가 동시에 기동하면 둘 다 "lock 없음"을 보고 둘 다 Host가 될 수 있다(split-brain). failover 경로의 double-check는 이 창을 줄일 뿐 제거하지 못한다. PID 재사용(죽은 Host의 PID를 새 무관 프로세스가 받는 경우)도 `process.kill(pid, 0)`만으로는 오판한다.

**수정**: `fs.openSync(lockPath, 'wx')`(배타적 생성)로 생성과 획득을 원자화하고, `EEXIST`면 기존 lock 검증으로 진입. lock에 이미 있는 `nonce`를 heartbeat 검증에도 활용해 PID 재사용을 무력화.

### H-5. Python 임베딩 사이드카 종료 처리 부재
**`src/indexer/embedding-manager.ts:45-96`**

`spawn('python', ...)` 후 dispose 메커니즘이 없어 본 프로세스 종료 시 사이드카가 고아로 남고, 자동 재시작 루프가 죽은 프로세스를 무한히 부활시키려 시도한다.

**수정**: `dispose()` 추가(`child.kill('SIGTERM')` → 5초 후 SIGKILL, 재시작 루프 중지 플래그), `LifecycleManager`에 등록.

### H-6. NullEmbeddingProvider가 null을 number[]로 캐스팅
**`src/indexer/embedding-manager.ts:174-179`**

```typescript
public async generate(_text: string): Promise<number[]> {
    return null as unknown as number[];
}
```

사이드카 실패 시 이 프로바이더가 사용되는데, 호출부가 결과에 `.forEach()` 등을 호출하면 런타임 TypeError. 타입 캐스팅이 컴파일 타임 검출을 막고 있다.

**수정**: `[]` 반환 또는 반환 타입을 `number[] | null`로 바꾸고 호출부에서 명시 처리.

### H-7. 배치 부분 실패 시 lastIndexedCommit 드리프트
**`src/indexer/update-pipeline.ts:157-182, 184-276`**

배치 내 일부 파일 파싱이 실패해도 커밋 메타데이터 갱신 경로가 파일 단위로 분리되어 있어, 실패 파일이 누락된 채 `setLastIndexedCommit`이 진행될 수 있다. 이후 증분 동기화는 그 커밋 이전 변경을 다시 보지 않으므로 **실패 파일이 영구 누락**된다.

**수정**: `processBatch()`에서 트랜잭션 커밋 성공 후에만, 실패 파일 목록을 별도 보관(재시도 큐 또는 `pending_files` 테이블)한 뒤 메타데이터를 갱신.

---

## 3. MEDIUM — 아키텍처 개선

### A-1. N+1 쿼리 패턴 (4곳)
| 위치 | 내용 |
|------|------|
| `src/graph/architecture-engine.ts:85-128` | `checkViolations()`: 전체 에지 순회하며 에지당 `getNodeById()` 2회 |
| `src/graph/architecture-engine.ts:198-257` | `detectCycles()`: 노드별 `getOutgoingEdges()` 반복 호출 |
| `src/server/resource-provider.ts:57` | 클러스터별 `SELECT COUNT(*)` 개별 실행 → `GROUP BY` 1회로 대체 |
| `src/server/api-server.ts:434-441` | `mapToGraphEdge()`: 에지당 `getNodeById()` 2회 → 배치 프리페치 |

**수정**: 에지+노드 JOIN 단일 쿼리 또는 인접 리스트 1회 로드 후 인메모리 순회.

### A-2. `tags` LIKE 풀스캔
**`src/graph/optimization-engine.ts:36-68`**

`tags NOT LIKE '%trait:entrypoint%'` 류의 substring 매치는 인덱스를 탈 수 없어 `findDeadCode()` 1회당 풀스캔 3회.

**수정**: `node_tags(node_id, tag)` 정규화 테이블 + 인덱스로 마이그레이션, `WHERE tag = ?` JOIN으로 전환.

### A-3. 엔진에 raw SQL 누수
**`src/graph/optimization-engine.ts:29-95`**

`findDeadCode()`가 `db.prepare()`를 직접 호출. 스키마 변경 시 수정 지점이 분산된다.

**수정**: `NodeRepository.findDeadCodeCandidates(tier)`로 이동.

### A-4. `reTagAllNodes()` O(n·m·k) 패스 반복
**`src/indexer/update-pipeline.ts:76-97`**

최대 5패스 × 전체 노드 × 노드별 에지 조회. 대형 코드베이스에서 수십 초 정지 가능.

**수정**: dirty-set 기반 worklist 알고리즘 — 태그가 실제로 변한 노드의 이웃만 재처리, O(n+e).

### A-5. 13개 언어 프로바이더 보일러플레이트 중복
**`src/indexer/languages/*.ts`**

`getQuery()`의 `.scm` 로딩과 `mapCaptureToSymbolType()` 로직이 13회 반복.

**수정**: 선언적 디스크립터(`{ extensions, grammar, queryFile, captureMap }`) 배열 + 공용 팩토리로 전환. 신규 언어 추가가 데이터 1줄이 된다. `language-registry.ts:125-137`의 클래스명 문자열 조립 추론(`'python' → PythonProvider`)도 함께 제거 가능.

### A-6. `require('../../package.json')` 패키징 취약성
**`src/bootstrap.ts:48`, `src/server/mcp-server.ts:52-55, 154-157`, `src/server/workspace-manager.ts:110,172`, `src/cli/admin.ts:460`**

npm 패키지로 설치되면 상대 경로가 깨질 수 있고, 버전 읽기 로직이 4개 파일에 중복.

**수정**: `src/utils/version.ts` 단일 헬퍼로 통합(여러 후보 경로 + 캐싱).

### A-7. `build:copy` 인라인 스크립트
**`package.json:15`**

`node -e` 한 줄 스크립트가 에러를 silent swallow. `scripts/copy-build-artifacts.js`로 추출하고 실패 시 명확히 보고. C-3의 플랫폼별 `.node` 파일명도 여기서 함께 처리.

### A-8. Dockerfile 하드닝
**`Dockerfile:40, 63-64`**

- 런타임 스테이지가 root로 실행 → `USER` 지정 필요.
- `/healthz`가 DB 미준비(pending) 상태에도 200 반환 → 오케스트레이터가 고장 컨테이너를 재시작하지 못함. pending 시 503 반환.

### A-9. IPC 견고성
**`src/server/ipc-coordinator.ts:92-99, 189-199`**

- `err.message` 접근 전 Error 인스턴스 보장 없음 → `err instanceof Error ? err.message : String(err)`.
- 타임아웃으로 reject된 `pendingRequests` 엔트리가 맵에 잔존 → 거부 시점에 `delete` 보장.

### A-10. LifecycleManager dispose 타임아웃 부재
**`src/utils/lifecycle-manager.ts:22-36`**

하나의 dispose가 행에 걸리면 종료 전체가 멈춘다. `Promise.race` + 5초 타임아웃으로 개별 격리.

### A-11. 마이그레이션 후 prepared statement 무효화 부재
**`src/db/edge-repository.ts:23-32`** (node-repository 등 동일 패턴)

스키마 마이그레이션 후 캐시된 statement가 stale해질 수 있다. `DatabaseManager.runMigrations()`에서 리포지토리 캐시 무효화 훅 호출.

### A-12. Vector 검색 차원 불일치 시 무음 실패
**`src/db/vector-repository.ts:22-49`**

차원 불일치 시 빈 배열 반환 → 시맨틱 검색이 망가져도 인지 불가. 최소 경고 로그, 가급적 명시적 에러.

---

## 4. 최적화 (LOW~MEDIUM)

| # | 위치 | 내용 |
|---|------|------|
| O-1 | `src/server/tools/search-symbols.ts:13` | `limit` 상한 없음 → `Math.min(args.limit ?? 10, 200)` |
| O-2 | `src/indexer/update-pipeline.ts:391-393` | `resolveNodeId()` canonical 미스 시 전체 맵 재순회 — 키를 canonical로 저장하면 루프 제거 |
| O-3 | `src/indexer/cross-project-resolver.ts:47-95` | 외부 심볼 해석마다 원격 DB open/close — 배치 내 캐싱 |
| O-4 | `src/indexer/typescript-parser.ts:30-42` | 파일마다 `ts.createProgram` 신규 생성 — incremental program 또는 LanguageService 재사용 |
| O-5 | `src/graph/graph-engine.ts:168-245` | 클러스터링이 전체 노드/에지 메모리 적재 — 현재 규모는 허용, 100k+ 노드 시 파티셔닝 필요 |
| O-6 | `src/utils/audit-logger.ts:42-53` | 로그 무한 증가 + 쓰기 실패 무시 — 크기 기반 회전(100MB) |
| O-7 | `src/graph/graph-engine.ts:561` | DFS `entry.depth > maxDepth` — maxDepth+1 깊이 노드가 반환됨 (`>=`로 수정) |
| O-8 | `src/graph/graph-engine.ts:256` | 1-노드 클러스터가 영속화됨 — `length < 2` 일괄 스킵 |
| O-9 | `schema/schema.sql` | `node_embeddings`(vec0)에 노드 삭제 연동 없음 — AFTER DELETE 트리거로 고아 임베딩 정리 |
| O-10 | `src/indexer/worker-pool.ts:150-156` | 타임아웃 vs 메시지 settle 경합 — `replaceWorker()`에서 타임아웃 핸들 정리 보장 |
| O-11 | `src/indexer/index-worker.ts:24-35` | 워커 톱레벨 `uncaughtException`/`unhandledRejection` 핸들러 추가 |
| O-12 | `src/server/api-server.ts:132-136` | `CYNAPX_LOG_PAYLOADS=1` 시 민감 필드 미마스킹 — token/secret/password 키 redact |

---

## 5. 테스트 공백

현재 211개 테스트가 전부 통과하지만, 위 결함 대부분이 **테스트되지 않는 경로**에 있다:

| 공백 | 검증해야 할 시나리오 |
|------|---------------------|
| `worker-pool.test.ts` 부재 | 타임아웃 → 워커 교체 → 후속 태스크 정상 처리 |
| `lock-manager` PID 재사용 | `process.kill` 성공 모킹 + nonce 불일치 시 stale 판정. **C-1 회귀 테스트(DB 본체 보존) 필수** |
| `initialize-project` 경계 검증 | current/existing/custom 모드별 경로 허용/거부 매트릭스 |
| `file-watcher` | 확장자 커버리지(H-2), 동시 flush(H-3) |
| 통합 테스트 동시성 | Phase 24: 병렬 도구 호출 5건 동시 실행, failover 중 도구 호출(H-1) |
| `certificate-generator` | openssl 부재/실패 시 에러 처리와 임시 파일 정리 |

---

## 6. 권장 수정 순서 (Phase 12 제안)

1. **P12-1 (즉시)**: C-1 DB 삭제 제거 + 회귀 테스트 — 한 줄 수정으로 데이터 전손 방지
2. **P12-2 (즉시)**: C-2 토큰 로그 마스킹, C-3 플랫폼 동적 탐색
3. **P12-3**: H-1 승격 순서 + `requireEngine` 가드 유틸, H-4 `wx` 원자적 lock
4. **P12-4**: H-2/H-3 FileWatcher (레지스트리 연동 + flush 직렬화)
5. **P12-5**: H-5~H-7 (사이드카 dispose, Null 프로바이더, 커밋 드리프트)
6. **P12-6**: A-1/A-2 쿼리 최적화 (N+1 제거, node_tags 정규화)
7. **P12-7**: A-5 언어 프로바이더 데이터 주도화, A-4 worklist 리태깅
8. **P12-8**: 테스트 공백 보강 (5장)

---

## 7. 참고 — 이전 진단(v8) 잔여 과제와의 관계

- v8의 "IPC 평문 직렬화", "YamlParser 라이브러리화", "구조화 로그"는 여전히 유효하나 본 진단의 CRITICAL/HIGH 대비 우선순위 낮음.
- v8에서 "20/20 도구 정상"으로 평가했으나, 이는 **정상 초기화 경로** 기준이다. 본 진단은 failover/부분 실패/비정상 종료 등 예외 경로에서의 결함을 다수 발견했다 — 테스트 그린이 곧 견고함이 아님을 보여주는 사례.
