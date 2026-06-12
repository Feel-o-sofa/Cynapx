# Cynapx 정밀 진단 보고서 v10

- **기준 커밋**: `ff94ac3` (Phase 12-8 완료)
- **진단 일자**: 2026-06-11
- **진단 범위**: src/ 전체 (server, db, indexer, graph, watcher, utils, bootstrap), schema/, scripts/, tests/, src-native/, Dockerfile, package.json/lockfile + 외부 컨텍스트(CVE, MCP 생태계, 경쟁 도구)
- **진단 방법**: 단일 에이전트 순차 전수 코드 리뷰 (파일 직접 열람) + 로컬 검증(테스트/타입체크/번들 SQLite 버전 확인) + 웹 검색 기반 외부 조사
- **현재 상태(직접 검증)**: `npm test` 336/336 통과, `npx tsc --noEmit` 통과. Phase 12에서 수정된 항목은 재보고하지 않음 — 아래는 전부 신규 또는 잔존 결함이다.

> **요약**: CRITICAL 3건(배포 경로 전손 1, 크래시 1, 인증 무력화 1), HIGH 9건, MEDIUM(A) 12건, LOW/최적화(O) 12건. Phase 12가 정상 경로의 견고성을 크게 올렸지만, 이번 진단은 **배포(Docker), 멀티프로세스 보안(IPC), 비-TS 언어 메트릭, 종료/재초기화 경로**에서 테스트가 닿지 않는 구조적 결함을 다수 발견했다.

---

## 1. CRITICAL — 즉시 수정 필요

### C-1. Docker 배포 경로 전손 — 런타임 이미지에 schema/·scripts/ 미포함, prepare 스크립트가 빌드 자체를 깨뜨림
**`Dockerfile:29-37, 50-54`, `src/db/database.ts:56-65`, `package.json:18`**

세 가지 결함이 겹쳐 Docker 경로가 통째로 동작하지 않는다:

1. **schema 미포함**: `DatabaseManager.initializeSchema()`는 `path.resolve(__dirname, '../../schema/schema.sql')`(`database.ts:58`)을 읽는다. 컨테이너에서는 `/app/schema/schema.sql`이다. 그런데 Dockerfile은 빌더에 `COPY src/ ./src/`(36행), 런타임에 `dist/`와 `node_modules`만 복사한다(50-54행) — **schema/ 디렉터리는 어느 스테이지에도 존재하지 않는다.** 첫 `initializeEngine()`에서 `Schema file not found` throw → 부트스트랩 Fatal 종료. `scripts/cynapx_embedder.py`도 미포함이라 임베딩 사이드카도 절대 동작 불가.
2. **prepare 스크립트 충돌**: `package.json:18`의 `"prepare": "npm run build"`는 `npm ci` 시점에 실행된다. 빌더 스테이지에서 `npm ci`(33행)는 `COPY src/`(36행) **이전**이라 tsc가 입력 없음(TS18003)으로 실패하고, 런타임 스테이지의 `npm ci --omit=dev`(51행)는 devDependency인 typescript가 없어 실패한다. 즉 **`docker build` 자체가 완주하지 못할 가능성이 높다.**
3. **python vs python3**: 런타임 이미지는 `python3`만 설치하는데(45-47행) 사이드카는 `spawn('python', ...)`(`embedding-manager.ts:58`)을 호출 → C-2와 결합해 컨테이너 크래시 경로가 된다.

CI/통합 테스트가 Docker 빌드를 한 번도 검증하지 않아(5장) 지금까지 발견되지 않았다.

**수정**:
1. Dockerfile에 `COPY schema/ ./schema/`, `COPY scripts/cynapx_embedder.py ./scripts/` 추가 (또는 `build:copy`에서 schema를 dist로 복사하고 코드의 후보 경로에 dist 내 경로 추가).
2. `prepare` → `prepack`으로 변경하거나 Dockerfile에서 `npm ci --ignore-scripts` 사용.
3. `scripts/docker-smoke.sh`(빌드 + `/healthz` 200 확인)를 통합 테스트에 추가.
4. 베이스 이미지를 `node:22-bookworm-slim`으로 (Node 20은 2026-04-30 EOL — 6장 참조).

### C-2. 임베딩 사이드카 spawn 'error' 미처리 → `python` 미설치 환경에서 서버 전체 크래시
**`src/indexer/embedding-manager.ts:55-67`, `src/bootstrap.ts:40-45`**

```typescript
this.child = spawn('python', [scriptPath]);
// stderr/data, exit 핸들러만 등록 — 'error' 핸들러 없음
```

spawn 실패(ENOENT — 대부분의 최신 Linux 배포판과 본 프로젝트의 Docker 이미지에는 `python` 바이너리가 없음)는 `exit`가 아니라 `error` 이벤트로 통지된다. ChildProcess는 EventEmitter이므로 **리스너 없는 'error'는 throw → `uncaughtException` → bootstrap.ts:44의 `process.exit(1)`** — 첫 인덱싱 배치의 `refreshAll()`이 호스트 프로세스를 통째로 죽인다. 자동 재시작/폴백 로직(H-2(2)/(3), Phase 12 H-5/H-6 수정 포함)은 전부 `exit` 이벤트 전제라 이 경로에선 한 번도 발동하지 못한다.

부수 결함: `scriptPath = path.join(process.cwd(), 'scripts', 'cynapx_embedder.py')`(55행) — cwd 기준이라 글로벌 설치/타 디렉터리 기동 시 항상 잘못된 경로.

**수정**: `child.on('error', ...)`에서 exit 핸들러와 동일한 재시도/폴백 처리. `python3` → `python` 순 폴백 탐색. 스크립트 경로는 `__dirname` 기준 패키지 루트로 해석.

### C-3. IPC "챌린지-응답"이 시크릿 nonce를 평문으로 먼저 송신 — 인증 사실상 무력화
**`src/server/ipc-coordinator.ts:69-90`**

```typescript
// Host: 접속 즉시
socket.write(JSON.stringify({ challenge: nonce }) + '\n');   // nonce = 락 파일의 시크릿
// 이후
if (msg.auth !== nonce) { socket.destroy(); ... }
```

Host가 **인증 시크릿(nonce) 그 자체를 "챌린지"로 모든 접속자에게 먼저 보낸다.** 공격자는 127.0.0.1 TCP 포트에 접속해 받은 challenge 값을 `{"auth": ...}`로 그대로 되돌려주면 인증된다. 락 파일을 0600으로 보호한 의미가 없다(소켓은 같은 머신의 모든 로컬 사용자가 접근 가능). 인증되면 `executeTool` 전체 — `get_symbol_details`의 소스 파일 읽기, `initialize_project`의 임의 경로 등록(custom 모드), `purge_index` 등 — 를 다른 로컬 계정이 실행할 수 있다.

**수정**: Host는 **랜덤 챌린지**(nonce와 무관한 일회용 값)를 보내고, Terminal은 `HMAC-SHA256(key=nonce, msg=challenge)`로 응답. nonce는 어떤 방향으로도 와이어에 싣지 않는다. 회귀 테스트: nonce를 모르는 클라이언트가 challenge를 에코해도 인증 실패해야 함.

---

## 2. HIGH — 안정성/보안/정합성 결함

### H-1. PID 재사용·죽은 IPC 포트 시 Terminal이 무한 재시도 — heartbeat는 쓰기만 하고 아무도 읽지 않음
**`src/utils/lock-manager.ts:57-61, 187-191`, `src/bootstrap.ts:239-244, 265`**

`getValidLock()`의 생존 판정은 `process.kill(pid, 0)`뿐이다. 죽은 Host의 PID를 무관한 프로세스가 재사용하면 락은 영원히 "유효"로 판정되고, `connectToHost`는 실패하며, `acquireAndRun`의 catch는 **횟수 제한 없이 2초마다 재귀 재시도**한다(bootstrap.ts:241) — MCP 서버가 영원히 ready되지 않는다. v9 H-4의 수정 노트는 "nonce를 heartbeat 검증에 활용"이라 했지만, 실제로는 `lastHeartbeat`를 **검증하는 코드가 코드베이스 어디에도 없다**(쓰기만 존재: lock-manager.ts:189, bootstrap.ts:265의 30초 타이머). 또한 `attemptFailover`로 승격된 Host는 heartbeat 타이머를 시작하지 않는다(bootstrap.ts:217-222에는 acquireAndRun:265와 같은 setInterval이 없음) — heartbeat가 실제 검증에 쓰이기 시작하면 이 누락이 즉시 split-brain 원인이 된다.

**수정**: (1) `getValidLock()`에 heartbeat age 검증 추가(예: 90초 초과 + 접속 실패 시 stale 판정), (2) connect 재시도 상한(예: 5회) 후 stale 처리로 에스컬레이션, (3) `attemptFailover` 승격 경로에도 heartbeat 타이머 시작.

### H-2. heartbeat()의 비원자적 in-place 덮어쓰기 → 경합 reader가 락을 "corrupt"로 오판·삭제 → split-brain
**`src/utils/lock-manager.ts:110-113, 187-191, 208-213`**

`heartbeat()`/`signalShutdown()`은 라이브 락 파일을 `fs.writeFileSync`로 제자리 덮어쓴다(tmp+rename 아님). 같은 순간 다른 프로세스의 `getValidLock()`이 파일을 읽으면 잘린 JSON을 볼 수 있고, 그 catch 경로(110-113행)는 **락 파일을 즉시 삭제**한다. 이후 그 프로세스가 acquire에 성공하면 동일 프로젝트에 Host가 둘이 된다(둘 다 같은 DB에 파이프라인/워처 가동). 30초마다 쓰기가 발생하므로 장기 운영에서 현실적인 확률이다. 추가로 `release()`(196-203행)는 파일 내용(nonce)을 확인하지 않고 unlink하므로, 자기 락이 교체된 뒤에도 남의 락을 지울 수 있다.

**수정**: heartbeat/signalShutdown을 tmp 파일 + `renameSync`로 원자화. `release()`는 파일의 nonce가 자신의 것일 때만 삭제. corrupt-락 삭제 경로는 1회 재시도(짧은 sleep 후 재독) 후에만 수행.

### H-3. 증분 동기화: from-커밋 소실(rebase/force-push/shallow) 시 영구·무음 동기화 중단
**`src/indexer/git-service.ts:60-87`, `src/indexer/sync-strategies/incremental-sync-strategy.ts:17-19`**

`getDiffFiles()`는 `git diff from..to` 실패 시 에러를 삼키고 `[]`를 반환한다. `IncrementalSyncStrategy.buildEvents()`는 `diffs.length === 0`이면 `null`을 반환하고, `syncWithGit()`은 워터마크를 전진시키지 않는다. `lastIndexedCommit`이 rebase로 사라진 커밋이면 **모든 후속 동기화가 같은 실패를 영원히 반복**하고, 인덱스는 조용히 낡아간다(에러 로그 한 줄 외 어떤 복구도 없음). 또한 diff 파싱이 `line.split(/\s+/)`이라 **공백 포함 파일 경로가 깨진다**(76행에서 `parts[parts.length-1]`만 취함).

**수정**: (1) getDiffFiles가 "빈 diff"와 "diff 실패"를 구분해 반환(실패 시 throw 또는 sentinel), (2) from-커밋이 무효(`git cat-file -e` 실패)면 FullScanStrategy로 폴백, (3) `--name-status -z` NUL 구분 파싱으로 교체.

### H-4. 열린 트랜잭션(BEGIN) 안에서 await — 파일당 순차 git subprocess 호출
**`src/indexer/update-pipeline.ts:273, 285` (`applyDelta`도 동일: 349, 359)**

`processBatch()`는 `BEGIN` 직후 Pass 1 루프에서 **파일마다 `await this.gitService.getHistoryForFile(...)`**을 호출한다. 두 가지 문제:

1. **동시성**: better-sqlite3는 동기지만, await 지점에서 이벤트 루프가 양보되므로 같은 커넥션을 쓰는 다른 코드가 열린 트랜잭션 *안에서* 실행될 수 있다. 실제 위험 경로: 직전 배치가 백그라운드로 띄운 `embeddingManager.refreshAll()`(330행)의 `db.transaction(...)` 쓰기가 이 창에서 실행되면 외부 트랜잭션에 합류해 ROLLBACK 시 함께 소실되거나 savepoint 의미가 꼬인다.
2. **성능**: 풀 스캔(파일 N개)이 N회의 순차 `git log --follow`(파일당 수십~수백 ms)를 **트랜잭션을 잡은 채** 수행한다. 1만 파일이면 git에만 수십 분. `FullScanStrategy`도 파일당 `getLatestCommit` 1회씩 추가 호출한다(`full-scan-strategy.ts:18-24`; simple-git 기본 동시성 5로 직렬에 가깝다).

**수정**: 히스토리를 BEGIN **이전**에 청크 병렬로 프리페치(`mapHistoryToProject`의 CHUNK_SIZE=20 패턴 재사용)하거나, `git log --name-only` 단일 패스로 전체 파일의 최신 커밋/히스토리를 한 번에 구축. 트랜잭션 본문은 순수 동기로 유지.

### H-5. 비-TS 12개 언어의 cyclomatic complexity가 사실상 가짜 값
**`src/indexer/tree-sitter-parser.ts:112`, `src/indexer/metrics-calculator.ts:49-88`, `src-native/src/lib.rs:46-54`**

`TreeSitterParser`는 tree-sitter `SyntaxNode`를 `MetricsCalculator.calculateCyclomaticComplexity(node, node.text)`로 넘긴다:

- **네이티브 미탑재 시(기본)**: JS 폴백은 `ts.forEachChild`로 **TypeScript AST**를 순회한다. tree-sitter 노드는 `kind`가 없어 순회가 즉시 끝나고 **CC가 항상 1**이다. Rust/Go/Java/C/C++/C#/Kotlin/PHP/Python/GDScript 전부 해당.
- **네이티브 탑재 시**: `lib.rs:46-54`는 소스를 **공백 분할 토큰**으로 나눠 `['if','for','while','case','catch','&&','||','??']` 문자열과 비교한다. `if(x)`처럼 괄호가 붙으면 안 잡히고, 문자열/주석 속 단어는 잡힌다 — 부정확하고 플랫폼 의존적인 값.

즉 `get_hotspots`, `get_risk_profile`, `propose_refactor`, 클러스터 분류(avg_complexity)가 비-TS 프로젝트에서 무의미하다. 아이러니하게도 각 언어 디스크립터에는 정확한 AST 노드 타입 목록(`decisionPoints`, 예: `languages/rust.ts:20`)이 정의돼 있고 `getDecisionPoints()`도 존재하지만 **호출하는 곳이 없다**(grep 검증).

**수정**: tree-sitter 커서 순회로 `provider.getDecisionPoints()`의 노드 타입 출현 횟수를 세는 경로를 추가하고 tree-sitter 파서는 그것만 사용. 네이티브 토큰 카운터는 제거하거나 동일 의미(AST 기반)로 재작성. 언어별 CC 기대값 회귀 테스트 추가.

### H-6. purge_index가 좀비 컨텍스트를 남김 — onPurge 미배선, 재초기화 불능, 닫힌 DB 핸들 사용
**`src/server/tools/purge-index.ts:20-23`, `src/server/mcp-server.ts:136-138`, `src/bootstrap.ts:117, 180-183`, `src/server/workspace-manager.ts:224-229`**

`purgeIndexHandler`는 `deps.onPurge` 호출 → `ctx.dbManager?.dispose()` → DB 파일 삭제를 수행하지만:

1. `setOnPurge()`는 **어디에서도 호출되지 않는다**(grep 검증: 정의만 존재) — onPurge는 항상 undefined.
2. `ctx.dbManager`를 dispose만 하고 **null로 비우지 않으며**, `graphEngine`/`metadataRepo`/`optEngine` 등은 닫힌 커넥션을 계속 참조한다. FileWatcher/UpdatePipeline/WorkerPool도 계속 가동 중이라 다음 워처 flush가 닫힌 DB에 쓰기를 시도한다.
3. purge 후 `initialize_project`를 다시 부르면 `startHostServicesForContext`의 `if (ctx.dbManager) return;`(bootstrap.ts:117) 가드가 **죽은 dbManager를 보고 초기화를 건너뛴다**. `markReady(true)`는 되므로 이후 모든 도구 호출이 "database connection is not open"류 에러를 맞는다.

**수정**: `WorkspaceManager.unmountProject(hash)` 신설 — watcher/pipeline/workerPool dispose, dbManager dispose 후 ctx의 엔진 필드 전부 제거(또는 컨텍스트 자체 삭제). bootstrap에서 `mcpServer.setOnPurge(...)` 배선. 통합 테스트에 "purge → re-init → search" 시나리오 추가.

### H-7. 경로 경계 검사 3곳이 separator 없는 prefix-match — sibling 디렉터리 우회
**`src/utils/security.ts:43`, `src/server/mcp-server.ts:115-119`, `src/utils/paths.ts:179`**

```typescript
if (!realTarget.toLowerCase().startsWith(realRoot.toLowerCase())) { throw ... }
```

프로젝트 루트가 `/home/u/proj`일 때 `/home/u/proj-secrets/credentials.ts`가 **통과**한다. `get_symbol_details`의 소스 읽기 가드(SecurityProvider), `waitUntilReady`의 레지스트리 소속 판정, `findProjectAnchor`의 레지스트리 prefix 매칭이 모두 같은 패턴이다. 추가로 `toLowerCase()` 비교는 케이스 구분 파일시스템(Linux)에서 잘못된 수락을 만든다. (`initialize-project.ts:50,68`은 `base + path.sep`로 올바르게 구현돼 있어 대조적.)

**수정**: `isPathInside(child, parent)` 공용 헬퍼(`path.relative` 결과가 `..`로 시작하지 않고 절대경로가 아님) 신설, 3곳 교체. 케이스 처리 플랫폼 분기(win32만 case-insensitive).

### H-8. IPC 누적 바이트 제한이 정상 장수 연결을 강제 절단
**`src/server/ipc-coordinator.ts:60-67`**

```typescript
let totalBytes = 0;
socket.on('data', (chunk) => {
    totalBytes += chunk.length;
    if (totalBytes > MAX_MSG_BYTES) { socket.destroy(...); }
});
```

`totalBytes`가 **소켓 수명 전체에 걸쳐 누적**되고 리셋되지 않는다. Terminal 세션이 수천 번의 정상 도구 호출로 누적 1MB를 넘기면 Host가 연결을 끊고, Terminal은 `disconnected` → `attemptFailover`로 불필요한 승격 시도를 한다. 의도(SEC-H-3: 단일 메시지 크기 제한)와 구현이 다르다.

**수정**: 메시지(라인) 단위 제한으로 변경 — 줄바꿈 처리 시 카운터 리셋, 또는 현재 줄 버퍼 길이만 검사.

### H-9. `--https` 실패 시 무음 평문 HTTP 폴백
**`src/bootstrap.ts:306-313`**

```typescript
if (options.https) {
    try { httpsOptions = CertificateGenerator.generate(); } catch(e) { console.error("[!] SSL generation failed."); }
}
const apiServer = new ApiServer(httpsOptions);   // undefined면 HTTP로 기동
```

openssl 부재 등으로 인증서 생성이 실패하면 사용자가 명시적으로 요구한 HTTPS 대신 **HTTP로 조용히 기동**한다. `--bind 0.0.0.0`과 결합하면 토큰이 평문으로 네트워크에 노출된다.

**수정**: `--https` 요청 시 생성 실패는 fail-fast(`process.exit(1)`). 최소한 비-루프백 bind와의 조합은 거부.

---

## 3. MEDIUM — 아키텍처/정합성 개선 (A)

### A-1. `INSERT OR REPLACE` + `recursive_triggers` OFF → FTS 고아 행 누적, cross-file 에지 소실
**`src/db/node-repository.ts:34-49`, `schema/schema.sql:94-105`, `src/db/database.ts:36-47`, `src/indexer/update-pipeline.ts:342-374`**

SQLite에서 REPLACE 충돌 해소가 행을 삭제할 때 **DELETE 트리거는 `recursive_triggers=ON`일 때만 발화**하는데, `database.ts`는 이 pragma를 켜지 않는다. 따라서 기존 `qualified_name`과 충돌하는 `createNode()`(예: 워처의 ADD 이벤트가 이미 인덱스된 파일에 대해 발생하는 `applyDelta` 경로 — MODIFY와 달리 선삭제가 없음, update-pipeline.ts:350-357)는 `nodes_ad` 트리거를 건너뛰어 **fts_symbols에 고아 rowid가 누적**된다(검색 정합성은 JOIN이 걸러주지만 FTS 인덱스가 무한 성장). 동시에 FK CASCADE는 동작하므로 교체된 노드로 들어오던 **타 파일발 에지가 삭제되고 복원되지 않는다**.

**수정**: `PRAGMA recursive_triggers = ON` 추가 + 회귀 테스트(REPLACE 후 fts_symbols 행 수 검증). 근본적으로는 createNode를 명시적 UPSERT(`ON CONFLICT(qualified_name) DO UPDATE`)로 바꿔 id 보존(에지 소실도 함께 해소).

### A-2. API MCP 세션 맵 무한 증가 + sessionId가 로그에 노출되는 인증 토큰 역할
**`src/server/api-server.ts:120, 153-169, 171-186, 245-271`**

`mcpSessions`는 transport `onclose`에서만 제거된다 — 클라이언트가 닫지 않으면 세션(SdkMcpServer + transport 페어)이 영구 누적된다(인증된 사용자가 새 `mcp-session-id` 헤더만 보내도 무한 생성 가능). 한편 GET `/mcp?sessionId=...`는 알려진 sessionId만으로 인증을 우회하는데(176-179행, 재접속 설계), 요청 로거(161행)가 **쿼리스트링 포함 전체 URL을 로그에 남기므로** sessionId가 로그 수집기에 영구 기록된다 — C-2(v9)에서 토큰 로그 노출을 고친 것과 같은 부류의 누출이 남아 있는 셈이다.

**수정**: 세션 idle TTL(예: 30분) + 상한(예: 100) 도입, 로그에서 sessionId 쿼리 파라미터 마스킹.

### A-3. Bearer 토큰 비교가 non-constant-time
**`src/server/api-server.ts:182`**

`authHeader !== \`Bearer ${AUTH_TOKEN}\`` — `crypto.timingSafeEqual`로 교체(길이 불일치 처리 포함). 로컬호스트 기본값에선 위험도가 낮지만 `--bind 0.0.0.0` 운용 시 의미가 생긴다.

### A-4. 배치마다 전 노드 fan 메트릭 풀 재계산 + 미해석 에지당 leading-wildcard LIKE 풀스캔
**`src/indexer/update-pipeline.ts:435-441`, `src/db/node-repository.ts:320-325`**

`recomputeFanMetrics()`는 워처 flush 한 번마다 **전체 nodes에 상관 서브쿼리 UPDATE**를 수행한다(스키마 트리거가 이미 증분 유지 중이므로 이중 작업이기도 함). `resolveNodeId()`의 폴백 `findNodesBySymbolName()`은 `LIKE '%#name'` — 인덱스 불가, 미해석 에지 1건당 풀스캔. 대형 그래프에서 증분 업데이트 지연의 주범이 된다.

**수정**: fan 재계산을 배치에서 변경된 노드 집합으로 한정(또는 트리거 단일화 후 제거). 심볼명 역조회용 컬럼(`symbol_name`) + 인덱스 추가로 LIKE 제거.

### A-5. NodeRepository가 호출마다 prepare / persistClusters 루프가 트랜잭션 밖
**`src/db/node-repository.ts:35, 86, 101-108`, `src/graph/graph-engine.ts:247-303`**

`createNode()`/`replaceTags()`는 매 호출 `db.prepare()`를 재컴파일한다(EdgeRepository는 캐싱하는 것과 비대칭). `persistClusters()`는 DELETE만 트랜잭션으로 묶고 **클러스터 INSERT + 노드별 `updateCluster()` 수천 건을 auto-commit으로** 실행한다 — WAL fsync가 노드 수만큼 발생하고, 중간 크래시 시 부분 상태가 남는다.

**수정**: NodeRepository statement 캐싱(+ `invalidateStatementCache()` 패턴 재사용), persistClusters 전체를 단일 트랜잭션으로.

### A-6. 워처 경로가 gitignore를 무시 + ProjectProfile이 통째로 죽은 설정
**`src/watcher/file-watcher.ts:48-52`, `src/utils/file-filter.ts`, `src/utils/profile.ts:14-35`, `src/server/workspace-manager.ts:88`**

chokidar ignore는 dotfile 정규식뿐이다. `FileFilter`(.gitignore 해석)는 ConsistencyChecker만 사용한다 — `dist/`, `build/` 등 **gitignore된 산출물 편집이 워처 경로로 인덱스에 들어가** git 기반 동기화와 영구 불일치를 만든다. 또한 `ProjectProfile`(excludePatterns/maxFileSize/languageOverrides/webhookUrl)은 `ctx.profile`에 로드만 되고 **소비처가 src 전체에 한 곳도 없다**(grep 검증) — 사용자가 프로필을 작성해도 아무 효과가 없다.

**수정**: FileWatcher에 FileFilter 적용(chokidar `ignored` 콜백). profile은 (a) 파이프라인/워처/스캔 전략에 excludePatterns·maxFileSize를 실제 배선하거나 (b) 기능 제거 후 문서화 — 둘 중 하나로 정리.

### A-7. 임베딩 IPC에 요청-응답 상관관계 없음 → 타임아웃 후 응답이 다음 배치에 오배달
**`src/indexer/embedding-manager.ts:77-89, 152-156, 251-267`**

프로토콜에 요청 id가 없고 `pendingRequest` 단일 슬롯뿐이다. 배치 N이 EmbeddingManager의 2분 타임아웃으로 reject된 뒤 사이드카가 뒤늦게 N의 벡터를 보내면, 그 사이 전송된 배치 N+1의 `pendingRequest`가 **N의 벡터로 resolve**된다 — `vectors[idx]`가 N+1의 노드에 매핑되어 **잘못된 임베딩이 조용히 저장**된다(시맨틱 검색 품질 오염).

**수정**: 요청에 `id` 필드 추가, 응답 매칭 시 id 불일치는 폐기. 타임아웃 시 사이드카 재시작도 고려(상태 동기화 단순화).

### A-8. 프로젝트 해시가 lowercase MD5 — 케이스 구분 FS에서 서로 다른 프로젝트가 같은 DB/락 공유
**`src/utils/paths.ts:193-196`, (관련: 98-131 레지스트리 lost-update)**

`getProjectHash()`는 경로를 `toLowerCase()` 후 해시한다. Linux에서 `/home/u/Foo`와 `/home/u/foo`는 별개 디렉터리지만 **같은 해시 → 같은 DB 파일·락**을 공유해 인덱스가 서로를 덮어쓴다. 또한 레지스트리 쓰기(read-modify-write + 고정 `.tmp` 이름)는 다중 프로세스 동시 갱신에서 lost-update가 가능하다.

**수정**: 해시 입력의 lowercase를 win32/darwin에만 적용. 레지스트리 tmp 파일명에 pid 포함 + (가능하면) 재시도 기반 병합.

### A-9. admin CLI가 라이브 DB에 비안전 백업/VACUUM/복원
**`src/cli/admin.ts:300-311, 351-372, 393-396, 449-451`**

`backup`은 가동 중일 수 있는 WAL DB를 `fs.copyFileSync`로 복사한다(체크포인트 시점에 따라 비일관 스냅샷). `purge`/`compact`/`restore`는 해당 프로젝트의 Host 락 존재 여부를 확인하지 않고 라이브 DB를 삭제/VACUUM/덮어쓴다.

**수정**: better-sqlite3의 온라인 백업 API(`db.backup()`) 또는 `VACUUM INTO` 사용. 파괴적 명령 전 `~/.cynapx/locks/<hash>.lock` 생존 확인 후 경고/거부.

### A-10. v9 이월 잔존 부채 (유효성 재확인)
| 항목 | 위치 | 상태 |
|------|------|------|
| package.json 버전 읽기 5곳 중복 (v9 A-6) | `bootstrap.ts:48`, `mcp-server.ts:52-55,161-165`, `workspace-manager.ts:114,180`, `admin.ts:460`, `api-server.ts:207-212` | 여전히 잔존 — `utils/version.ts` 단일화 필요 |
| build:copy 인라인 스크립트 (v9 A-7) | `package.json:15` | 잔존 — 에러 무음 삼킴(`catch(e){}`), C-1의 schema 복사도 여기서 처리 가능 |
| Dockerfile root 실행 + pending에도 healthz 200 (v9 A-8) | `Dockerfile`(USER 없음), `api-server.ts:202-218` | 잔존 — C-1 수정과 함께 처리 |
| 구조화 로깅 (v8 이월) | `src/utils/logger.ts` vs 22개 파일 215곳 `console.*` | **Logger 클래스는 작성돼 있으나 사용처 0곳(dead code)** — 배선만 하면 됨 |
| YamlParser 수제 파싱 (v8 이월) | `src/indexer/yaml-parser.ts` | 잔존 — 현 용도(top-level key + jobs)에는 충분, 우선순위 낮음 |
| IPC JSON 평문 직렬화 (v8 이월) | `ipc-coordinator.ts` | 잔존 — 성능 문제 미관측, MessagePack 전환은 보류 권고(11장) |

### A-11. PENDING 모드 락 정체성 불일치 — 같은 프로젝트에 Host 둘 가능
**`src/bootstrap.ts:105-109`**

프로젝트 없이 기동한 프로세스는 `getCentralStorageDir()` 기반 **글로벌 락**을 잡고, 이후 `initialize_project`로 프로젝트 X를 마운트해도 락 정체성은 그대로다. 동시에 X 디렉터리에서 기동한 다른 프로세스는 **X의 프로젝트 락**을 잡는다 — 둘 다 자신이 Host라 믿고 X의 DB에 파이프라인/워처를 가동한다(WAL이 충돌은 막지만 이중 인덱싱·워터마크 경합 발생).

**수정**: initialize_project 완료 시 해당 프로젝트 락을 추가 획득(실패 시 Terminal 강등), 또는 최소한 DB open 시 프로젝트 락 보유 검증.

### A-12. Terminal 도구 호출 30초 고정 타임아웃
**`src/server/ipc-coordinator.ts:196-199`**

`backfill_history`, `re_tag_project`, `initialize_project`(대형 리포 첫 인덱싱), `check_consistency --repair`는 30초를 쉽게 초과한다 — Terminal 사용자는 항상 타임아웃을 보고, Host는 작업을 계속한다(중복 재시도 유발). 도구별 타임아웃 또는 Host의 진행 중 응답(keepalive) 도입 필요. (6장: MCP 2025-11-25의 task 기반 워크플로가 장기 작업의 정석 해법.)

---

## 4. 최적화 (LOW)

| # | 위치 | 내용 |
|---|------|------|
| O-1 | `src/graph/graph-engine.ts:510-511` | BFS가 `queue.shift()` — 대형 순회에서 O(n²). 인덱스 포인터(head++)로 교체 (dfs/reTag는 이미 적용된 패턴) |
| O-2 | `src/indexer/sync-strategies/full-scan-strategy.ts:18-24` | 풀 스캔 시 파일당 `getLatestCommit` — `git log --name-only` 단일 패스로 대체 (H-4와 함께 처리) |
| O-3 | `src/server/api-server.ts:206-212` | `/healthz`가 매 요청 package.json 디스크 읽기 — A-10 version 헬퍼 캐싱으로 해소 |
| O-4 | `src/indexer/typescript-parser.ts:30-42` | **(v9 이월)** 파일마다 `ts.createProgram` + lib 재로딩 — 여전히 유효. LanguageService/incremental 재사용 권장 (11장 verdict: 채택) |
| O-5 | `src/graph/graph-engine.ts:168-245` | **(v9 이월)** 클러스터링 전체 메모리 적재 — 현재 규모 무해. verdict: 계속 보류 (단 persistClusters 트랜잭션화는 A-5로 흡수) |
| O-6 | `package.json` | `engines` 필드 부재 — Node ≥22 명시 권장 (Node 20 EOL, 6장) |
| O-7 | `src/server/interactive-shell.ts:21` | 셸 도구 목록에 미등록 도구 `perform_clustering` 표기 (`_registry.ts`에 없음) — 자동완성/도움말 오류 |
| O-8 | `src/utils/certificate-generator.ts:32` | openssl이 키 파일을 기본 umask로 생성 — /tmp에서 잠시 타 사용자 가독 가능. 디렉터리 0700 생성 후 그 안에서 작업 |
| O-9 | `src/utils/audit-logger.ts:84-93` | `readRecent()`가 최대 100MB 전체 읽기 — tail 방식 부분 읽기로 |
| O-10 | `src/bootstrap.ts:290-303` | One-shot CLI가 `process.exit`로 즉시 종료 — lifecycle/lock release 우회(스테일 처리로 복구되나 WAL 미체크포인트). disposeAll 후 종료로 |
| O-11 | `src/utils/file-filter.ts:19-28` | 루트 .gitignore만 로드 — 중첩 .gitignore 미지원 |
| O-12 | `src/server/tools/search-symbols.ts:15-28` | 컨텍스트별 `EngineNotReadyError`가 `allSettled`로 무음 필터링 — 전 컨텍스트 미준비 시 빈 결과 대신 에러 반환이 옳음 |

---

## 5. 테스트 공백

336개 테스트와 통합 스크립트 69 케이스에도 불구하고, 이번 발견의 대부분은 다음 미검증 영역에 있다:

| 공백 | 검증해야 할 시나리오 | 잡았을 결함 |
|------|---------------------|------------|
| **REST API HTTP 레벨** | 실제 listen + supertest: 인증(401/timing), rate limit(429), `/mcp` 세션 생성·GET 우회·정리, `/healthz` 상태별 코드. 현 유닛은 metric enum 검증뿐(`tests/api-server-hotspots.test.ts`) | A-2, A-3, v9 A-8 |
| **Docker 빌드/기동** | `docker build` + `--api` 기동 + healthz smoke | **C-1 전체** |
| **IPC 2-프로세스 e2e** | 실제 Host/Terminal 프로세스 분리: 인증 협상(악성 에코 클라이언트 거부), 1MB+ 누적 트래픽, Host kill → failover | C-3, H-8, H-1 |
| **purge → 재초기화** | purge_index 후 initialize_project → search_symbols 정상 동작 | H-6 |
| **비-TS 언어 메트릭** | Rust/Go/Java fixture의 CC 기대값 (≠1), 네이티브/JS 경로 동등성 | H-5 |
| **git 이력 재작성** | rebase/force-push 후 syncWithGit가 풀스캔 폴백으로 복구 | H-3 |
| **lock 경합 스트레스** | heartbeat 중 동시 getValidLock 반복(원자성), PID 재사용 시뮬레이션 + 재시도 상한 | H-1, H-2 |
| **임베딩 프로토콜** | 타임아웃 후 늦은 응답이 다음 배치에 오배달되지 않음 (mock sidecar) | A-7 |
| **크로스 플랫폼** | 케이스 구분 FS에서 해시/경계 검사, python3-only 환경 spawn | C-2, H-7, A-8 |

---

## 6. 외부 컨텍스트 (웹 조사 — 출처 명시)

### 6.1 의존성 취약점 (CVE)

- **CVE-2025-7709 — SQLite FTS5 integer overflow (heap OOB write)**: 영향 범위 3.49.1 ≤ v < 3.50.3, 수정 3.50.3. **본 프로젝트의 better-sqlite3 11.10.0이 번들한 SQLite는 3.49.2로 영향 범위 안에 있음을 로컬에서 직접 확인했다**(`sqlite_version()` = 3.49.2). 프로젝트는 FTS5(`fts_symbols`)를 적극 사용하고, `CrossProjectResolver`는 레지스트리에 등록된 **외부 DB 파일을 열어 쿼리**하므로(crafted DB file 공격 벡터) 무시할 수 없는 노출이다. 트리거 조건이 "공격자 제어 쿼리 또는 공격자 제어 DB 파일"이라 위험도는 환경 의존적이지만, 업그레이드가 정석. 출처: [openwall oss-security](https://www.openwall.com/lists/oss-security/2025/09/06/2), [GitHub advisory GHSA-v2c8-vqqp-hv3g](https://github.com/google/security-research/security/advisories/GHSA-v2c8-vqqp-hv3g)
  - **조치**: better-sqlite3 **12.x 업그레이드**(최신 12.10.0은 SQLite 3.53.1 번들). 주의: 12.x 최신 릴리스는 Node 20 prebuild를 제거했으므로(EOL 정리) engines ≥22 전환과 함께 진행. 출처: [better-sqlite3 releases](https://github.com/WiseLibs/better-sqlite3/releases), [Snyk better-sqlite3](https://security.snyk.io/package/npm/better-sqlite3) (패키지 자체 직접 취약점은 0건)
- **CVE-2025-70873 (SQLite zipfile extension)**: zipfile 확장은 better-sqlite3 기본 빌드에 포함되지 않음 — 해당 없음으로 판단. 출처: [SentinelOne CVE DB](https://www.sentinelone.com/vulnerability-database/cve-2025-70873/)
- express 4.22.1, express-rate-limit 8.3.1, zod 4.3.6, vitest 4.1.2, simple-git 3.36.0 — 조사 범위에서 미해결 공개 취약점 발견 못 함(lockfile 버전 직접 확인).

### 6.2 런타임/의존성 수명주기

- **Node.js 20은 2026-04-30 EOL** — Dockerfile의 `node:20-bookworm-slim`은 진단 시점 기준 EOL 이미지다. Node 22(LTS, 2027-04 유지보수 종료) 또는 24로 전환 필요. `engines` 필드도 부재(O-6). 출처: [endoflife.date/nodejs](https://endoflife.date/nodejs), [nodejs.org EOL](https://nodejs.org/en/about/eol)
- **sqlite-vec**: 프로젝트는 `0.1.7-alpha.2` 고정. 이후 **0.1.9 안정판**이 공개됐고(0.1.10-alpha.4 진행 중, Mozilla 후원으로 개발 재개) alpha 의존 탈피 가능. 출처: [sqlite-vec releases](https://github.com/asg017/sqlite-vec/releases), [npm sqlite-vec](https://www.npmjs.com/package/sqlite-vec)

### 6.3 MCP 생태계

- **스펙 2025-11-25가 stable 릴리스**: task 기반 워크플로(SEP-1686, 장기 실행 작업의 정석 — A-12의 30초 타임아웃 문제의 표준 해법), Client ID Metadata Documents 인증(SEP-991), URL 모드 elicitation(SEP-1036), 도구/리소스 **icons 메타데이터**, sampling-with-tools(SEP-1577). 2026-07-28 차기 스펙 RC도 예고됨. 출처: [MCP 2025-11-25 changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog), [MCP blog — 2026-07-28 RC](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
- **SDK 드리프트**: 프로젝트 `@modelcontextprotocol/sdk` 1.26.0 vs 최신 **1.29.0**(npm registry 직접 확인). 마이너 업그레이드로 위 신기능 채택 기반 확보 가능. 장기 인덱싱 작업(initialize_project/backfill_history)의 **tasks/progress 통지 채택**이 가장 실익이 큼.

### 6.4 경쟁/인접 도구 동향

- **Sourcegraph MCP**: SCIP 정밀 인덱싱 기반 크로스-리포 code intelligence를 MCP로 노출 — 정확한 go-to-def/find-refs가 상용 기준선. 출처: [sourcegraph.com/mcp](https://sourcegraph.com/mcp)
- **codegraph** (오픈소스, 2026-05 트렌딩): tree-sitter + SQLite + FTS 구성의 사전 인덱스 코드 지식 그래프 MCP 서버 — **Cynapx와 거의 동일한 아키텍처 포지션**. "토큰 절약·툴콜 절감·100% 로컬"을 전면에 내세우고 Claude Code/Cursor/Codex 등 멀티 클라이언트 지원을 강조. 같은 주에 유사 구현 3개가 GitHub 트렌딩에 올랐다는 보도 — **이 카테고리가 table stakes화 중**. 출처: [github.com/colbymchenry/codegraph](https://github.com/colbymchenry/codegraph), [bighatgroup.com 분석](https://www.bighatgroup.com/blog/codegraph-2026-05-26/)
- **시사점**: 경쟁 우위는 (1) 멀티 언어 **메트릭의 정확성**(H-5가 직접 훼손 중), (2) 컨테이너/CI 배포 신뢰성(C-1), (3) 증분 동기화의 견고함(H-3/H-4) — 즉 이번 진단의 상위 결함들이 곧 경쟁력 항목이다.

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 정밀 열람 결과 특이 결함이 없었다:

- `src/db/vector-repository.ts`, `metadata-repository.ts` — 단순·건전.
- `src/indexer/worker-pool.ts` — Phase 12-6 검증대로 settle 가드/교체 로직 안전.
- `src/server/resource-provider.ts`, `prompt-provider.ts`, `tools/get-callers.ts`(JOIN 적용), `get-symbol-details.ts`, `export-graph.ts`(이스케이프 처리), `check-consistency.ts` — 가드/검증 양호.
- `src/utils/lifecycle-manager.ts`, `audit-logger.ts`(회전 포함), `profile.ts`(원자적 저장), `checksum`, `file-filter` 자체 로직 — 건전 (A-6은 *미사용*이 문제).
- `src/graph/refactoring-engine.ts`, `remediation-engine.ts`, `policy-discoverer.ts` — 휴리스틱 로직에 결함 없음(단 H-5로 입력 메트릭 자체가 오염됨).
- 언어 디스크립터 체계(Phase 12-7 산출물) — 구조 견고, 테스트 충실.

---

## 8. 권장 수정 순서 (Phase 13 제안 — 상세는 phase13-plan.md)

1. **P13-1**: C-1 Docker/배포 복구 + Node 22 + engines (smoke 테스트 동반)
2. **P13-2**: C-2 사이드카 크래시, C-3 IPC 인증, H-8/H-9 (보안·크래시 일괄)
3. **P13-3**: H-1/H-2/A-11 lock 단일성
4. **P13-4**: H-3/H-4/A-1/O-2 인덱싱 정합성·트랜잭션
5. **P13-5**: H-5 메트릭 정확성 (decisionPoints 배선)
6. **P13-6**: H-6/A-9 수명주기·운영 도구
7. **P13-7**: H-7/A-2/A-3 + CVE 의존성 업그레이드
8. **P13-8**: A-4~A-8/A-10/A-12, O-1/O-3/O-4, 구조화 로깅 배선
9. **P13-9**: 5장 테스트 공백 일괄
