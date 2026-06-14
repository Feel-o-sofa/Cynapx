# Phase 13 작업 계획 — diagnostic-v10 대응

> **작성**: 2026-06-12 / **기준 문서**: `agent_docs/diagnostic-v10.md` (기준 커밋 `ff94ac3`, Phase 12-8 완료)
> **목표**: CRITICAL 3건(C-1~C-3), HIGH 9건(H-1~H-9), MEDIUM(A) 12건(A-1~A-12), LOW/최적화(O) 12건(O-1~O-12), 테스트 공백 9건을 의존성과 리스크 기준으로 P13-1 ~ P13-9의 9개 서브 Phase로 순서화하여 해소한다. Phase 12에서 이연된 항목(O-4, O-5, IPC MessagePack, 구조화 로깅, YamlParser)의 채택/보류 판정도 본 계획에 반영한다(12장).

---

## 0. 작업 원칙

- 각 서브 Phase는 **독립적으로 커밋 가능한 단위**로 쪼갠다 (한 Phase = 1~3개 PR급 커밋).
- CRITICAL/HIGH 항목은 **회귀 테스트를 동반**하지 않으면 완료로 보지 않는다 — 특히 이번 진단의 결함 대부분이 "테스트가 닿지 않는 영역"(배포, 멀티프로세스, 비-TS 메트릭, 종료/재초기화)에서 나왔으므로, 수정과 함께 해당 영역의 테스트 인프라(5장 공백)를 단계적으로 구축한다.
- 파일/모듈이 겹치는 항목은 같은 Phase에 묶어 충돌 없는 순서로 처리한다.
- 매 Phase 종료 시 `npm test` + `npx tsc --noEmit` 그린 확인 후 커밋. 통합 스크립트(`scripts/integration-test.js`)는 P13-4, P13-6, P13-9 종료 시 추가 확인.
- 매 Phase 종료 시 `agent_docs/diagnostic-v10.md`에 [DONE] 마킹.

---

## 1. 의존성 맵 (작업 순서에 영향을 주는 관계)

```
P13-1 (Node 22 / engines)      ──→  P13-7 (better-sqlite3 12.x)   12.x는 Node 20 prebuild 제거 — engines ≥22 선행 필수
C-1 (Dockerfile/schema 경로)   ──→  P13-9 (Docker smoke 테스트)    smoke는 빌드 가능해진 뒤에만 의미
C-3 (IPC HMAC 인증)            ──→  P13-9 (IPC 2-프로세스 e2e)     e2e는 새 프로토콜 기준으로 작성
H-2 (heartbeat 원자화)         ──→  H-1 (heartbeat age 검증)       heartbeat 쓰기가 원자적이어야 age 판정을 신뢰 가능 (같은 파일 lock-manager.ts)
H-1/H-2 (lock 프리미티브)      ──→  A-11 (PENDING 락 정체성)       락 획득/검증 위에서 동작
H-4 (트랜잭션 내 await 제거)   ──→  H-3 (diff 실패 폴백)           같은 영역(update-pipeline / sync-strategies), O-2가 H-4 수정에 흡수됨
A-1 (UPSERT/recursive_triggers)──→  H-4와 같은 파일(update-pipeline.ts applyDelta) — P13-4에 동거
H-6 (purge unmount)            ──→  P13-9 (purge→re-init 통합 테스트)
H-7 (isPathInside 헬퍼)        ──→  A-8 (paths.ts 해시)            같은 파일(paths.ts) 순차 — P13-7 → P13-8 순서 유지
H-5 (decisionPoints 배선)      독립 (tree-sitter-parser / metrics-calculator / src-native)
P13-8 (구조화 로깅 배선)       마지막 코드 Phase — 215곳 console.* 치환이 앞 Phase들의 diff와 충돌하지 않도록 후순위
P13-9 (테스트 공백 일괄)       전 단계 수정 완료 후 최종 검증
```

---

## 2. Phase 13-1: Docker/배포 경로 복구 + Node 22 (C-1, O-6, v9 A-8 잔존) — **[DONE]**

**목표**: 배포 경로 전손(C-1)의 일괄 복구. 변경 대상이 전부 빌드/배포 메타 파일이라 런타임 코드 리스크는 낮지만, P13-7(better-sqlite3 12.x)의 선행 조건(engines ≥22)이므로 최우선.

> **[DONE — 2026-06-12]** 1커밋으로 완료. 변경 요약:
> - **C-1(1)**: 런타임 스테이지에 `COPY schema/ ./schema/` 추가, `node_modules`는 빌더에서 `npm prune --omit=dev` 후 통째로 복사(런타임 `npm ci` 제거 — native 모듈 재빌드/스크립트 순서 문제 원천 차단). `.dockerignore` 신설(컨텍스트 최소화). **주의**: `scripts/cynapx_embedder.py`는 리포에 존재하지 않는 파일이라 COPY 불가 — 사이드카는 FTS5 폴백으로 우아하게 강등(주석으로 문서화).
> - **C-1(2)**: `"prepare"` → `"prepack"` 전환. 빌더 `npm ci`는 의존성 install 스크립트(native 빌드)가 필요하므로 `--ignore-scripts`를 쓰지 않고 prepack 전환만으로 순서 문제 해소. `npm pack --dry-run`으로 prepack 빌드 + schema/scripts 포함 회귀 확인.
> - **C-1(3)**: `embedding-manager.ts`에 `resolvePythonCommand()` 신설 — `python3` → `python` 순 프로브(spawnSync), 둘 다 없으면 spawn 없이 FTS5 폴백 모드 진입(+ generateBatch의 30초 ready 대기 루프가 폴백 진입 시 즉시 `[]` 반환). 유닛 테스트 7건 동반.
> - **Node 22 / O-6**: 베이스 이미지 2곳 `node:22-bookworm-slim`, `engines: {node: ">=22"}` 추가. CI(ci.yml) 매트릭스 [20,22]→[22,24], lint/build-native/release의 Node 20→22.
> - **v9 A-8 잔존**: Dockerfile에 `USER node`(비-root) + `~/.cynapx` 사전 생성/chown. `/healthz` pending 시 503 (HTTP 레벨 회귀 테스트 3건). **추가 발견**: 인증 미들웨어가 `/healthz`를 면제하지 않아 Docker HEALTHCHECK(무토큰 curl)가 항상 401이었음 — GET `/healthz` 면제 추가. 죽은 설정 `ENV CYNAPX_HOME`(코드 미사용) 제거.
> - **build:copy 무음 삼킴**: 인라인 `node -e` → `scripts/build-copy.js`로 추출, `catch(e){}` 제거 — src-native 디렉터리 부재만 허용, 그 외 복사 실패는 빌드 실패.
> - **테스트**: `scripts/docker-smoke.sh` 신규(빌드 → 샘플 프로젝트 마운트 → `--api` 기동 → `/healthz` 200 폴링, Docker 부재 시 SKIP exit 0). 통합 배선은 계획대로 P13-9. 유닛 346/346(+10), tsc 클린. `npm pack --dry-run`으로 prepack/패키징 회귀 확인.
> - **Docker 검증 (샌드박스 제약 명시)**: 샌드박스 egress 정책이 `deb.debian.org`를 차단(`host_not_allowed`)해 **리포지토리의 Dockerfile 그대로는 apt 단계에서 빌드 불가**. 검증은 apt 2단계만 제거하고 베이스를 `node:22-bookworm`(툴체인 사전 포함)으로 치환한 동등 변형으로 수행 — 그 외 모든 단계(npm ci 순서/prepack, tsc+build:copy, prune, 런타임 스테이지 조립, USER node)는 원본과 동일하게 실행됨. 결과: **빌드 성공 + 스모크 PASS** (`/healthz` 200, `{"status":"ok","indexed":true,"project":"/workspace"}`, 컨테이너 내 `whoami`=node, `/app/schema/schema.sql` 존재 확인). apt install 2줄 자체는 표준 패턴이라 정상 네트워크 환경에서 동작할 것으로 판단하나 본 샌드박스에서는 미실행.
> - **추가**: release.yml 아카이브에 `schema/` 누락 발견 → 추가(동일 C-1 계열). `.gitignore`의 `scripts/` 패턴을 `scripts/*`로 수정(신규 스크립트 추적 가능하도록).

| 항목 | 파일 | 작업 |
|------|------|------|
| C-1(1) schema/scripts 미포함 | `Dockerfile:29-37, 50-54` | 빌더·런타임 스테이지에 `COPY schema/ ./schema/`, `COPY scripts/cynapx_embedder.py ./scripts/` 추가. (대안 검토: `build:copy`에서 schema를 dist로 복사 + `database.ts:58`에 dist 내 후보 경로 추가 — Docker 외 글로벌 설치 경로도 함께 해결되면 이쪽 채택) |
| C-1(2) prepare 충돌 | `package.json:18` | `"prepare"` → `"prepack"` 변경. Dockerfile의 두 `npm ci`에 `--ignore-scripts` 병기(이중 안전). |
| C-1(3) python vs python3 | `Dockerfile:45-47` | 런타임 이미지에 `python` 심볼릭 링크 또는 C-2(P13-2)의 python3 폴백과 합류 — Dockerfile 쪽은 `python3` 존재만 보장. |
| Node 22 전환 | `Dockerfile:29, 43` | 베이스 이미지 `node:20-bookworm-slim` → `node:22-bookworm-slim` (Node 20은 2026-04-30 EOL). |
| O-6 | `package.json` | `"engines": { "node": ">=22" }` 추가. |
| v9 A-8 잔존 (A-10 표) | `Dockerfile`, `src/server/api-server.ts:202-218` | Dockerfile에 비-root `USER node` 추가. `/healthz`가 엔진 pending 상태일 때 200 대신 503 반환. |
| build:copy 무음 삼킴 (A-10 표) | `package.json:15` | `catch(e){}` 제거 — 복사 실패 시 빌드 실패로 표면화. schema 복사를 채택한 경우 여기서 처리. |

**테스트**:
- `scripts/docker-smoke.sh` 신규 — `docker build` 완주 + `--api` 기동 + `/healthz` 200 확인. CI/통합 테스트 훅은 P13-9에서 배선(Docker 데몬 부재 환경은 skip 처리).
- `/healthz` pending→503 은 기존 api-server 유닛 테스트 파일에 회귀 추가.
- `npm pack --dry-run`으로 prepack 전환 후 패키징 회귀 확인.

**산출물**: 1~2개 커밋 (Dockerfile+package.json / healthz·smoke). **리스크: 중간** (런타임 코드 변경은 작으나 빌드 체인 변경 — Docker 환경 검증 필수).

---

## 3. Phase 13-2: 크래시·보안 일괄 패치 (C-2, C-3, H-8, H-9) — **[DONE]**

**목표**: 서버 전체 크래시 1건 + 인증/보안 결함 3건. 변경량 대비 파급력이 가장 큰 묶음.

> **[DONE — 2026-06-12]** 변경 요약:
> - **C-2**: `embedding-manager.ts`에 `child.on('error', ...)` 추가 — exit 핸들러와 공유하는 `handleChildGone()`(멱등 가드: error+exit 동시 발화 시 1회 재시도)로 funnel. spawn ENOENT/EACCES가 더는 uncaughtException으로 호스트를 죽이지 않고 재시도(1s/2s/4s)→FTS5 폴백으로 강등. P13-1의 `resolvePythonCommand()` probe가 spawn 자체 실패(권한 등)를 막지 못하는 경로를 방어적으로 커버. `scriptPath`를 `process.cwd()`→`__dirname` 패키지 루트 기준으로 교체.
> - **C-3**: `ipc-coordinator.ts` 챌린지-응답 재설계. Host는 nonce와 무관한 일회용 랜덤 challenge(32B) 송신, Terminal은 `HMAC-SHA256(key=nonce, msg=challenge)`로 응답, Host는 `crypto.timingSafeEqual` 검증(`computeAuthResponse` export). nonce는 양방향 와이어에 부재. 공개 API/연결 흐름(`startHost`/`connectToHost`/`forwardExecuteTool`)은 불변 — 와이어 핸드셰이크만 변경, 기존 IPC 테스트(infrastructure / phase12-6-commit-a A-9)는 대칭 사용이라 무수정 통과.
> - **H-8**: 누적 `totalBytes`→라인 단위 `currentLineBytes`(청크 내 `\n` 경계마다 리셋). 장수 연결 누적 1MB+ 정상 트래픽 생존, 단일 1MB+ 메시지는 절단.
> - **H-9**: `src/utils/https-options.ts` 신설(`resolveHttpsOptions`/`isLoopbackAddress`/`HttpsUnavailableError`). `--https` 실패는 fail-fast(`process.exit(1)`), 비-루프백+평문 경고. `CertificateGenerator` 직접 호출을 헬퍼로 추출(테스트 주입 가능).
> - **C-3 회귀 증명**: git stash로 구 코드(challenge===nonce)에서 에코-공격 테스트가 즉시 실패함을 확인 후 복원.
> - **테스트**: `tests/ipc-coordinator.test.ts`(신규, C-3 6건 + H-8 3건), `tests/bootstrap-https.test.ts`(신규, H-9), `tests/embedding-queue.test.ts` 확장(C-2 spawn-error 5건 + 패키지 루트 경로 1건). 유닛 **376/376**(+30), `tsc --noEmit` 클린.

| 항목 | 파일 | 작업 |
|------|------|------|
| C-2 | `src/indexer/embedding-manager.ts:55-67` | `child.on('error', ...)` 추가 — exit 핸들러와 동일한 재시도/폴백(NullEmbeddingProvider 강등) 처리. spawn 커맨드를 `python3` → `python` 순 폴백 탐색. `scriptPath`를 `process.cwd()` 기준에서 `__dirname` 기준 패키지 루트 해석으로 교체. |
| C-3 | `src/server/ipc-coordinator.ts:69-90` | 챌린지-응답 재설계: Host는 nonce와 무관한 **일회용 랜덤 챌린지**를 송신, Terminal은 `HMAC-SHA256(key=nonce, msg=challenge)`로 응답, Host는 동일 계산으로 검증. nonce는 어떤 방향으로도 와이어에 싣지 않음. |
| H-8 | `src/server/ipc-coordinator.ts:60-67` | 누적 `totalBytes`를 메시지(라인) 단위 제한으로 교체 — 줄바꿈 처리 시 카운터 리셋(현재 줄 버퍼 길이만 검사). |
| H-9 | `src/bootstrap.ts:306-313` | `--https` 요청 시 인증서 생성 실패는 fail-fast(`process.exit(1)`) — 무음 HTTP 폴백 제거. 비-루프백 `--bind`와 HTTP 조합 경고. |

**테스트**:
- `tests/embedding-queue.test.ts` 확장 — mock spawn으로 `error` 이벤트(ENOENT) 발생 시 크래시 없이 폴백/재시도 동작, python3→python 폴백 순서, `__dirname` 기준 경로 해석 검증 (C-2).
- `tests/ipc-coordinator.test.ts` (신규 또는 확장) — **nonce를 모르는 클라이언트가 challenge를 에코해도 인증 실패**(C-3 핵심 회귀), 올바른 HMAC 응답은 인증 성공, 정상 메시지 수천 건 누적 1MB+ 트래픽에서 연결 유지 + 단일 1MB+ 메시지는 절단 (H-8).
- `tests/bootstrap-https.test.ts` 또는 기존 infra 테스트 — 인증서 생성 실패 mock 시 평문 기동 없이 종료 (H-9).

**산출물**: 2개 커밋 (C-2 / C-3+H-8+H-9). **리스크: 중간** (IPC 프로토콜 변경 — Host/Terminal 양쪽 동시 배포 전제, 버전 혼용 시 인증 실패는 의도된 동작).

---

## 4. Phase 13-3: Lock 단일성 (H-2 → H-1 → A-11) — **[DONE]**

**목표**: split-brain(Host 이중화)으로 수렴하는 락 결함 3건을 의존성 순서대로. Phase 12-2와 같은 영역이라 기존 테스트 기반 위에서 작업.

> **[DONE — 2026-06-13]** 3커밋(H-2 원자화 / H-1 staleness+재시도 상한 / A-11+docs). 변경 요약:
> - **H-2**: `lock-manager.ts`에 `atomicWrite()` 신설(tmp `${lockPath}.${pid}.${rand}.tmp` → `renameSync`) — `heartbeat()`/`signalShutdown()`이 제자리 `writeFileSync` 대신 원자 교체. 경합 reader가 잘린 JSON을 볼 수 없음. `getValidLock()`의 corrupt-락 삭제 경로는 50ms sleep 후 1회 재독·재liveness 후에만 삭제(transient partial write 보호). `release()`는 on-disk nonce가 자신의 것일 때만 unlink — failover 교체 후 남의 락 삭제 차단. 회귀: 100회 heartbeat+getValidLock 인터리브 corrupt 오판 0회, partial→완성 재시도 보존, release 타인-nonce 보존.
> - **H-1**: `getValidLock()`은 stale을 자동 삭제하지 않음(정체성 보존) — 대신 `isHeartbeatStale(lock)`(90s 임계 `HEARTBEAT_STALE_MS`) 제공. bootstrap `acquireAndRun` connect 실패 처리는 순수 함수 `decideConnectFailureAction(stale, retries, max=5)`로 추출 — heartbeat stale이거나 재시도 5회 도달 시 `forceReclaim(nonce)`(자기-관측 nonce 일치 시에만 삭제) 후 재acquire 에스컬레이션, 그 외 2s 백오프. 무한 루프 제거. heartbeat 타이머를 단일 `startHeartbeatTimer()`로 통합해 `attemptFailover` 승격 경로에도 가동(이전엔 acquireAndRun에만 존재). 회귀: stale 판정 매트릭스, retry-cap 결정표, 무한루프 부재(반드시 5회에 reclaim 수렴), forceReclaim nonce 가드.
> - **A-11**: `setOnInitialize`가 primary 락 base와 다른 프로젝트를 초기화할 때 해당 프로젝트 전용 `LockManager.acquire()` 추가 획득(Host의 ipcPort/nonce 재사용) — `LockHeldError` 시 host 서비스 시작을 건너뛰어(DB open·파이프라인 미가동) 기존 Host에 정체성 양보. 프로젝트 락도 heartbeat 타이머에 합류. `hostIpcPort`/`hostNonce`를 acquire/failover 양 경로에서 기록. 회귀(`tests/bootstrap-failover.test.ts` 신규): 동일 경로 2차 acquire→LockHeldError, 상이 경로 독립 락, 승격-Host heartbeat 신선도.
> - **테스트**: `tests/lock-manager.test.ts` +17(16→33), `tests/bootstrap-failover.test.ts` 신규 3건. 유닛 **405/405**(+17), `tsc --noEmit` 클린. 동시성 민감 테스트 안정성 위해 전체 2회 + 락 스위트 3회 반복 그린 확인.
> - **Phase 12-2 보존**: 기존 "atomic acquire (H-4)" 블록(O_EXCL `wx` 획득) 무변경 — H-2는 heartbeat/release 쓰기 경로만 원자화, acquire의 생성 원자성은 그대로. 16개 기존 락 테스트 전수 통과.

### Step 1 — H-2: heartbeat/release 원자화
- `src/utils/lock-manager.ts:110-113, 187-191, 196-203, 208-213`: `heartbeat()`/`signalShutdown()`을 tmp 파일 + `renameSync`로 원자화. `release()`는 파일의 nonce가 자신의 것일 때만 unlink. corrupt-락 삭제 경로(110-113행)는 짧은 sleep 후 1회 재독 재시도 후에만 수행.

### Step 2 — H-1: heartbeat 검증 + 재시도 상한 + failover heartbeat
- `src/utils/lock-manager.ts:57-61`: `getValidLock()`에 heartbeat age 검증 추가 — `process.kill(pid, 0)` 생존 + heartbeat 90초 초과 + IPC 접속 실패 조합이면 stale 판정 (PID 재사용 대응).
- `src/bootstrap.ts:239-244`: `connectToHost` 실패 시 무한 2초 재귀 재시도에 상한(5회) 도입 — 초과 시 stale 처리로 에스컬레이션해 acquire 재시도.
- `src/bootstrap.ts:217-222`: `attemptFailover` 승격 경로에 acquireAndRun(265행)과 동일한 heartbeat `setInterval` 시작 추가.

### Step 3 — A-11: PENDING 모드 락 정체성
- `src/bootstrap.ts:105-109`, `src/server/workspace-manager.ts`: `initialize_project` 완료 시 해당 프로젝트의 프로젝트 락을 추가 획득 — 실패(`LockHeldError`) 시 Terminal로 강등해 기존 Host에 연결. 최소 보증으로 DB open 시 프로젝트 락 보유 검증.

**테스트**:
- `tests/lock-manager.test.ts` 확장 — heartbeat 원자성(쓰기 도중 read 경합 시뮬레이션: 100회 반복 heartbeat+getValidLock에서 corrupt 오판 0회), release가 타인 nonce 락을 삭제하지 않음, heartbeat age 90초 초과 + 접속 불가 시 stale 판정(PID 재사용 시뮬레이션 — 살아있는 무관 PID 기재).
- `tests/bootstrap-failover.test.ts` (신규 또는 기존 확장) — connect 재시도 상한 후 에스컬레이션, failover 승격 후 heartbeat 타이머 가동, PENDING→initialize_project 시 프로젝트 락 획득/강등.

**산출물**: 2~3개 커밋 (H-2 / H-1 / A-11). **리스크: 높음** (동시성 코어 — Phase 12-2의 H-4/H-1과 같은 수준의 신중함 필요).

---

## 5. Phase 13-4: 인덱싱 정합성·트랜잭션 (H-4, H-3, A-1, O-2) — **[DONE]**

**목표**: 증분 동기화의 무음 중단과 트랜잭션 오염 — 인덱스 신뢰성의 핵심 묶음. 전부 `src/indexer/` + `src/db/` 영역.

> **[DONE — 2026-06-13]** 3스텝(Step 1 H-4+O-2 / Step 2 H-3 / Step 3 A-1+docs). 변경 요약:
> - **Step 1 (H-4 + O-2)**: `UpdatePipeline.prefetchHistories(filePaths)` 신설 — `mapHistoryToProject`의 CHUNK_SIZE=20 청크 병렬 패턴 재사용 + Set de-dup. `processBatch`/`applyDelta`가 BEGIN **이전**에 모든 비-DELETE 파일의 git 히스토리를 프리페치하고, 트랜잭션 본문(Pass 1/Pass 2)은 프리페치된 `Map`만 조회 → await 0(트랜잭션 중 git subprocess spawn으로 인한 이벤트루프 양보·외부 트랜잭션 합류 제거). O-2: `git-service.ts`에 `getLatestCommitsForFiles()`(`git log --name-only --pretty=format:%x01%H` 단일 패스, NUL/%x01 구분으로 commit→files 블록 파싱, 최신순 first-seen 맵) 신설 — `FullScanStrategy`/`IncrementalSyncStrategy`의 파일당 `getLatestCommit` 호출 제거(맵 미스 시 head 폴백).
> - **Step 2 (H-3)**: `getDiffFiles()`가 diff 명령 실패 시 `DiffFailedError`(typed) throw — "빈 diff `[]`"와 "diff 실패"를 구분. 파싱을 `git diff --name-status -z` NUL 구분으로 교체(공백/탭 포함 경로 무손상, R###/C### rename/copy 처리). `git-service.ts`에 `commitExists(ref)`(`cat-file -e <ref>^{commit}`) 추가. `syncWithGit()`는 (1) lastCommit 존재 시 `commitExists` 선검사 — 소실 시 즉시 `FullScanStrategy` 폴백, (2) Incremental 경로에서 `DiffFailedError` catch 시에도 폴백 — rebase/force-push로 워터마크가 사라져도 풀스캔으로 복구하며 워터마크 전진.
> - **Step 3 (A-1)**: `database.ts`에 `PRAGMA recursive_triggers = ON` 추가 — UPSERT의 UPDATE 분기가 `nodes_au` AFTER UPDATE 트리거(fts_symbols delete+insert)를 올바르게 발화시키도록(트리거가 다른 테이블을 수정하므로 필요). `node-repository.ts:createNode()`를 `INSERT ... ON CONFLICT(qualified_name) DO UPDATE SET ... RETURNING id`로 교체 — 노드 id 보존(`lastInsertRowid`는 순수 UPDATE에서 미설정이므로 `RETURNING id` 사용), 타 파일발 에지(FK CASCADE)·FTS 정합성 유지. UPDATE 분기 stale `node_tags` 선삭제 후 재삽입.
> - **테스트**: `tests/update-pipeline-batch.test.ts`(+3: BEGIN 이전 프리페치 호출순서·동일 히스토리 매핑·de-dup), `tests/git-sync.test.ts`(신규 7: 실제 임시 git 리포 — 빈 diff vs DiffFailedError, 공백 파일명 `-z` 파싱, A/M/D, O-2 단일패스 맵, 첫 동기화 워터마크, **orphan checkout+reflog expire+gc로 lastCommit 소실 후 풀스캔 폴백·워터마크 복구**), `tests/database-migration.test.ts`(+3: id 보존·cross-file 에지 유지·재인덱스 5회 후 fts 1행·pragma ON), `tests/sync-strategies.test.ts`(O-2 단일패스 맵으로 갱신). 임시 리포는 `mkdtempSync`+`afterEach rmSync`로 정리.
> - **검증**: 유닛 **418/418**(+13, 405→418), `tsc --noEmit` 클린, `scripts/integration-test.js` **69/69**. git 리포 기반 타이밍 민감성 위해 전체 2회 + 대상 스위트 추가 반복 그린 확인.
> - **Phase 12 보존**: 12-4 H-7(`targetCommit`/실패 파일 워터마크 미전진)·12-6 O-2/O-3(`resolveNodeId`/CrossProjectResolver 배칭) 무변경 — 프리페치는 처리 파일 집합/순서를 바꾸지 않고(히스토리만 사전 조회) 기존 batch 테스트 전수 통과.

### Step 1 — H-4 + O-2: 트랜잭션 내 await 제거 + git 단일 패스
- `src/indexer/update-pipeline.ts:273, 285, 349, 359`: 파일별 `getHistoryForFile` 호출을 `BEGIN` **이전** 프리페치로 이동 — `mapHistoryToProject`의 CHUNK_SIZE=20 청크 병렬 패턴 재사용. 트랜잭션 본문은 순수 동기로 유지.
- `src/indexer/sync-strategies/full-scan-strategy.ts:18-24` (O-2): 파일당 `getLatestCommit` 호출을 `git log --name-only` 단일 패스로 대체해 전체 파일의 최신 커밋을 한 번에 구축 (H-4 프리페치와 동일 메커니즘으로 흡수).

### Step 2 — H-3: diff 실패 구분 + 풀스캔 폴백
- `src/indexer/git-service.ts:60-87`: `getDiffFiles()`가 "빈 diff"와 "diff 실패"를 구분해 반환(실패 시 throw 또는 sentinel). diff 파싱을 `--name-status -z` NUL 구분으로 교체(공백 포함 경로 대응).
- `src/indexer/sync-strategies/incremental-sync-strategy.ts:17-19`: from-커밋 무효(`git cat-file -e` 실패) 시 `FullScanStrategy` 폴백으로 워터마크 복구 — rebase/force-push/shallow 후 영구 중단 해소.

### Step 3 — A-1: UPSERT + recursive_triggers
- `src/db/database.ts:36-47`: `PRAGMA recursive_triggers = ON` 추가.
- `src/db/node-repository.ts:34-49`: `createNode()`의 `INSERT OR REPLACE`를 `ON CONFLICT(qualified_name) DO UPDATE`로 교체 — 노드 id 보존으로 타 파일발 에지 소실까지 함께 해소.

**테스트**:
- `tests/update-pipeline-batch.test.ts` 확장 — 트랜잭션 본문에 await 부재 검증(프리페치 후 동기 처리), 프리페치 결과가 기존과 동일한 히스토리 매핑 생성.
- `tests/git-sync.test.ts` (신규) — 실제 임시 git 리포로 rebase 후 `syncWithGit()`이 풀스캔 폴백으로 복구(5장 "git 이력 재작성" 공백), 공백 포함 파일명 diff 파싱.
- `tests/database-migration.test.ts` 또는 node-repository 테스트 확장 — qualified_name 충돌 REPLACE 후 `fts_symbols` 고아 행 0건, 노드 id 보존으로 기존 에지 유지 (A-1 회귀).

**산출물**: 2~3개 커밋 (H-4+O-2 / H-3 / A-1). **리스크: 높음** (인덱싱 파이프라인 핵심 경로 — 통합 스크립트 69케이스 전체 재검증 필수).

---

## 6. Phase 13-5: 비-TS 언어 메트릭 정확성 (H-5) — **[DONE]**

**목표**: 12개 비-TS 언어의 cyclomatic complexity가 가짜 값(항상 1 또는 토큰 카운트)인 문제 — 경쟁력 직결 항목(6.4장).

> **[DONE — 2026-06-13]** 1커밋으로 완료. 변경 요약:
> - **H-5(1) tree-sitter 경로**: `MetricsCalculator.calculateCyclomaticComplexityTreeSitter(node, decisionPoints)` 신설 — tree-sitter `SyntaxNode`를 `.children`/`child(i)` 기반 반복 DFS로 순회하며 `decisionPoints`(provider.getDecisionPoints())에 든 노드 타입 출현 횟수를 카운트(CC = 결정점 + 1). `tree-sitter-parser.ts:112`를 이 경로로 배선, `(node, node.text)`로 TS-AST 폴백(native 포함)에 넘기던 호출 제거. 기존 `calculateCyclomaticComplexity(node)`는 TS-AST 전용(`sourceCode` 파라미터/native 분기 제거)으로 축소 — `typescript-parser.ts:509`가 인자 1개로 호출하므로 무영향.
> - **문자열/주석 격리**: 실제 파싱 트리를 걷기 때문에 문자열 리터럴(`string`/`string_literal`)·주석(`comment`)은 결정점 노드 타입과 절대 매칭되지 않고 내부로 내려가지도 않음 → `"if for while"`/`// if for` 속 키워드 미카운트(언어별 회귀 테스트로 검증).
> - **연산자 분별**: `binary_expression`/`boolean_operator`/`binary_operator`는 `operator` 필드가 단락 논리연산자(`&&`/`||`/`??`/`and`/`or`)일 때만 +1(산술/비교 미카운트). `switch_label`(Java)은 case 값이 있을 때만 +1(bare `default:` 제외).
> - **디스크립터 보정**: Go `decisionPoints`의 `expression_case_clause`(문법에 없는 오타 — 항상 미매칭) → `expression_case`/`type_case`/`communication_case`로 수정 + `binary_expression` 추가. Rust에 `loop_expression`/`binary_expression`, Java에 `enhanced_for_statement`/`do_statement`/`switch_label`/`ternary_expression`/`binary_expression`, Python은 TS용 잘못된 토큰(`binary_expression`/`catch_clause`/`for_in_statement`/`if_expression`)을 실제 문법 노드(`elif_clause`/`except_clause`/`boolean_operator`)로 교체. (실제 grammar node-types를 노드 인스펙션으로 확인 후 반영.)
> - **H-5(2) 네이티브 경로**: `src-native/src/lib.rs`의 `calculate_cyclomatic_complexity_native`(공백 분할 토큰 카운터) **삭제** — 이제 비-TS 포함 모든 언어가 JS-side AST 경로로 일원화돼 native CC 함수는 호출처가 없는 dead+broken 코드. `calculate_bulk_line_counts_parallel`(라인 수 전용)만 유지. **네이티브 빌드 검증**: 샌드박스에 Rust 툴체인 존재 → `cargo build --release` 성공으로 lib.rs 소스 정합성 확인(napi `.node` 패키징은 배포 시점 `napi build`로 수행). TS 측 native 로더(`metrics-calculator.ts`)도 더는 사용처가 없어 함께 제거 — CC는 항상 정확한 단일 JS 경로.
> - **테스트**: `tests/metrics-calculator.test.ts` 신규(12건) — Rust/Go/Java/Python 손계산 CC(6/6/6/5 등 ≠1) + 문자열/주석 격리 + Go case-node 회귀(과거 오타 증명) + Java catch + Python except/match + TS AST 경로 불변(CC=5) + TS tree-sitter 디스크립터(CC=4). 유닛 **388/388**(+12), `tsc --noEmit` 클린.
> - **다운스트림 스냅샷**: 비-TS CC가 1→실값으로 변하지만, 스냅샷/하드코딩 테스트 중 비-TS CC 실값에 의존하는 것은 없음(`tests/parser.test.ts.snap`은 capture 텍스트만, hotspots/dispatcher 테스트는 메트릭 *이름* 문자열만 검증) → 스냅샷 갱신 불필요(전수 확인).

| 항목 | 파일 | 작업 |
|------|------|------|
| H-5(1) tree-sitter 경로 | `src/indexer/tree-sitter-parser.ts:112`, `src/indexer/metrics-calculator.ts:49-88` | tree-sitter 커서 순회로 `provider.getDecisionPoints()`(각 언어 디스크립터에 이미 정의된 AST 노드 타입 목록, 예: `languages/rust.ts:20`)의 출현 횟수를 세는 `calculateCyclomaticComplexityTreeSitter(node, decisionPoints)` 경로 신설. `TreeSitterParser`는 이 경로만 사용 — TypeScript AST 순회 폴백(`ts.forEachChild`)으로 tree-sitter 노드를 넘기는 호출 제거. |
| H-5(2) 네이티브 경로 | `src-native/src/lib.rs:46-54` | 공백 분할 토큰 카운터 제거 — TS 파서 전용으로 유지하거나 AST 기반 동일 의미로 재작성. 비-TS 언어는 항상 (1)의 tree-sitter 경로 사용으로 일원화. |

**테스트**:
- `tests/metrics-calculator.test.ts` 확장 — Rust/Go/Java/Python fixture(if/for/match/&&를 포함한 알려진 CC의 함수)에 대해 **언어별 CC 기대값(≠1) 회귀 테스트** (5장 "비-TS 언어 메트릭" 공백 해소). 문자열/주석 속 `if`가 카운트되지 않음 검증.
- TS 언어의 기존 CC 스냅샷 회귀 유지 (네이티브/JS 경로 동등성).

**산출물**: 1~2개 커밋. **리스크: 중간** (계산 로직 신설이지만 hotspots/risk_profile/클러스터 분류의 입력값이 일제히 변함 — 다운스트림 스냅샷 갱신 동반).

---

## 7. Phase 13-6: 수명주기·운영 도구 (H-6, A-9) — **[DONE]**

**목표**: purge 후 좀비 컨텍스트와 admin CLI의 라이브 DB 파괴 가능성 — 운영 경로 정리.

> **[DONE — 2026-06-13]** 1커밋(H-6+A-9). 변경 요약:
> - **H-6**: `WorkspaceManager.unmountProject(hash, {remove?})` 신설 — Phase 12-4 H-5 dispose 역순(watcher → workerPool → dbManager) 으로 정리 후 ctx의 모든 엔진 필드(`dbManager`/`graphEngine`/`metadataRepo`/`vectorRepo`/`archEngine`/`refactorEngine`/`optEngine`/`policyDiscoverer`/`gitService`/`updatePipeline`/`securityProvider`/`watcher`/`workerPool`/`reindexTriggeredByVersion`) 를 `undefined` 처리(컨텍스트는 path/hash만 남겨 재마운트 가능, `remove:true` 시 엔트리 삭제 + active 재지정). `EngineContext`에 `watcher`/`workerPool` 필드 추가, bootstrap `startHostServicesForContext`가 두 핸들을 ctx에 저장(이전엔 `lifecycle.track`만). `mcpServer.setOnPurge(...)` 를 bootstrap에서 처음으로 배선(`unmountProject(hash)` + 해당 프로젝트의 A-11 락 release) — 이전엔 정의만 있고 호출처 0곳(grep 확인). `onPurge` 시그니처를 `(hash)` 인자로 확장(tool-dispatcher/mcp-server/purge-index 합류). purge-index 핸들러는 `onPurge` 배선 시 unmount에 위임, 미배선(테스트) 시에만 bare `dbManager.dispose()+null`. **가드 합류**: unmount가 `dbManager`를 null 처리하므로 `initializeEngine`의 `if (ctx.dbManager) return ctx`와 bootstrap `startHostServicesForContext`의 `if (ctx.dbManager) return` 가드가 더는 dispose된 dbManager를 살아있는 것으로 오판하지 않음 → purge 후 `initialize_project` 재초기화가 정상 재빌드.
> - **A-9**: `admin.ts` `backup`을 `fs.copyFileSync`(.db+volatile -wal/-shm) → better-sqlite3 `VACUUM INTO ?` 온라인 백업으로 교체(`onlineBackup()`) — 라이브 WAL DB에서도 단일·일관·체크포인트 완료 스냅샷(sidecar 없음). `restore`는 VACUUM INTO 산출물(self-contained)에 맞춰 대상의 stale -wal/-shm 선삭제(legacy sidecar 백업은 호환 복사 유지). `purge`/`compact`/`restore` 파괴 명령 전 `assertNoLiveHost()` 가드 추가 — Phase 13-3의 PID 생존+heartbeat staleness 정책을 재사용하는 신규 **read-only** `LockManager.probeProjectLock(projectPath)`(side-effect 없음 — admin은 남의 락을 관찰만, 절대 삭제·정리하지 않음)로 라이브 Host 검출, 존재 시 거부(`-f/--force`로만 우회). 세 명령에 `--force` 플래그 추가.
> - **테스트**: `tests/workspace-manager.test.ts` 신규(6건 — 엔진 필드 null화, watcher/workerPool dispose 순서, 닫힌 DB 핸들 사용불가, 재초기화 가드 통과+신규 핸들, `remove:true` active 재지정, unknown hash no-op), `tests/admin-cli.test.ts` 신규(7건 — probeProjectLock 매트릭스: 무락/라이브/죽은 PID/stale heartbeat/unparseable/read-only 불변 + VACUUM INTO 백업이 integrity_check ok 통과·sidecar 없음). 통합 스크립트 Phase 25 추가(purge → 엔진필드 null화 검증 → initialize_project → 라이브 DB 핸들 → search_symbols 정상). 유닛 **431/431**(+13, 418→431), `tsc --noEmit` 클린, `node scripts/integration-test.js` **74/74**(+5).
> - **Phase 12-4 H-5 보존**: unmount의 dispose 순서가 LifecycleManager 역순(watcher→pool→DB) 과 동일 — 기존 종료 경로 무변경. Phase 13-3 락 정체성/heartbeat 보존: admin은 LockManager 헬퍼만 재사용(PID/heartbeat 로직 재구현 0).

| 항목 | 파일 | 작업 |
|------|------|------|
| H-6 | `src/server/workspace-manager.ts:224-229`, `src/server/tools/purge-index.ts:20-23`, `src/server/mcp-server.ts:136-138`, `src/bootstrap.ts:117, 180-183` | `WorkspaceManager.unmountProject(hash)` 신설 — watcher/pipeline/workerPool dispose, dbManager dispose 후 ctx의 엔진 필드(graphEngine/metadataRepo/optEngine 등) 전부 제거(또는 컨텍스트 자체 삭제). bootstrap에서 `mcpServer.setOnPurge(...)` 배선(현재 미호출 — grep 검증됨). `startHostServicesForContext`의 `if (ctx.dbManager) return;` 가드가 dispose된 dbManager를 살아있는 것으로 오판하지 않도록 null 처리와 합류. |
| A-9 | `src/cli/admin.ts:300-311, 351-372, 393-396, 449-451` | `backup`을 `fs.copyFileSync` → better-sqlite3 온라인 백업 API(`db.backup()`) 또는 `VACUUM INTO`로 교체. `purge`/`compact`/`restore` 실행 전 `~/.cynapx/locks/<hash>.lock` 생존 확인 — 라이브 Host 존재 시 경고/거부(`--force`로만 우회). |

**테스트**:
- `tests/workspace-manager.test.ts` 확장 — `unmountProject` 후 ctx 엔진 필드 제거, 재초기화 시 가드 통과, 닫힌 DB 핸들 참조 0건.
- 통합 스크립트에 **"purge → initialize_project → search_symbols 정상 동작"** 시나리오 추가 (5장 "purge → 재초기화" 공백 해소 — P13-9에서 최종 배선해도 무방하나 본 Phase에서 작성).
- `tests/admin-cli.test.ts` (신규 또는 확장) — 라이브 락 존재 시 purge/compact/restore 거부, 온라인 백업 산출물이 열리는 유효 DB임을 검증.

**산출물**: 1~2개 커밋 (H-6 / A-9). **리스크: 중간** (수명주기 분해 순서 — Phase 12-4 H-5 dispose 체계 위에서 작업).

---

## 8. Phase 13-7: 경로 경계·API 보안 + CVE 의존성 업그레이드 (H-7, A-2, A-3, CVE) **[DONE]**

> **[DONE — Phase 13-7]**
> - **H-7**: `isPathInside(child, parent)` 공용 헬퍼 신설(`src/utils/paths.ts`) — `path.relative(parent, child)` 결과가 `..`로 시작/절대경로면 외부로 판정, sibling `<root>-secrets` 우회 차단. win32만 lowercase 후 비교(POSIX 케이스 구분). `security.ts:43`·`mcp-server.ts:117`·`paths.ts:179`(findProjectAnchor) 3곳 separator-less prefix-match를 헬퍼로 교체, `initialize-project.ts` 경계 검사 2곳도 헬퍼로 통일(동작 동일). 기존 case-insensitive 단언 테스트는 플랫폼 분기로 갱신.
> - **A-2**: `mcpSessions`에 idle TTL 30분 + 상한 100 도입 — `setInterval` 5분 sweep(HealthMonitor 패턴, `.unref()`) + `/mcp` 요청마다 lazy sweep. 상한 도달 시 새 세션 429 거부, 기존 세션 접근 시 `lastAccess` 갱신. 요청 로거에서 `sessionId` 쿼리 파라미터 마스킹(`maskSessionInUrl`/`maskSessionId`, prefix 8자 + `***`).
> - **A-3**: Bearer 비교를 `timingSafeEqualStr`로 교체 — 양측을 SHA-256(32바이트 고정 길이) 해시 후 `crypto.timingSafeEqual` 비교. 길이 불일치 throw 회피 + 길이 기반 조기 종료 타이밍 누출 제거.
> - **CVE-2025-7709 — 성공**: better-sqlite3 11.10.0 → **12.10.0**(SQLite **3.53.1** 번들 확인), sqlite-vec `0.1.7-alpha.2` → **0.1.9**(`vec_version()` v0.1.9 확인), `@modelcontextprotocol/sdk` 1.26.0 → **1.29.0**. native 바인딩 정상 로드, FTS5/sqlite-vec 동작 확인. P13-6의 백업은 `db.backup()`이 아닌 `VACUUM INTO`(표준 SQL)라 12.x API 변경 무영향. `sqlite_version() >= 3.50.3` 회귀 테스트 추가.
> - **테스트**: `tests/security.test.ts`(isPathInside 매트릭스 + sibling + 플랫폼 케이스), `tests/api-server-security.test.ts`(신규 — timingSafeEqualStr/마스킹/TTL eviction/cap 429/로그 미노출), `tests/database-migration.test.ts`(SQLite 버전 가드). **455/455 통과**(431 → +24), tsc 클린, 통합 스크립트 74/74.

**목표**: 보안 마이너 묶음 + 의존성 보안 업그레이드. P13-1의 engines ≥22 전환이 선행 조건.

| 항목 | 파일 | 작업 |
|------|------|------|
| H-7 | `src/utils/security.ts:43`, `src/server/mcp-server.ts:115-119`, `src/utils/paths.ts:179` | `isPathInside(child, parent)` 공용 헬퍼 신설(`path.relative` 결과가 `..` 시작/절대경로가 아님 기준) — separator 없는 prefix-match 3곳 전부 교체(sibling 디렉터리 `/proj-secrets` 우회 차단). 케이스 비교는 win32만 case-insensitive로 플랫폼 분기. (`initialize-project.ts:50,68`은 이미 올바름 — 헬퍼로 통일만.) |
| A-2 | `src/server/api-server.ts:120, 153-169, 171-186, 245-271` | `mcpSessions`에 idle TTL(30분) + 상한(100) 도입. 요청 로거(161행)에서 `sessionId` 쿼리 파라미터 마스킹. |
| A-3 | `src/server/api-server.ts:182` | Bearer 토큰 비교를 `crypto.timingSafeEqual`로 교체(길이 불일치 선처리 포함). |
| CVE-2025-7709 | `package.json`, lockfile | better-sqlite3 11.10.0 → **12.x**(SQLite 3.53.1 번들 — 현 번들 3.49.2는 FTS5 heap OOB write 영향 범위). sqlite-vec `0.1.7-alpha.2` → **0.1.9 안정판**. `@modelcontextprotocol/sdk` 1.26.0 → 1.29.0 (마이너, A-12의 tasks/progress 채택 기반). 업그레이드 후 전체 테스트 + 통합 스크립트로 native 바인딩 회귀 확인. |

**테스트**:
- `tests/security.test.ts` 확장 — `isPathInside` 단위 매트릭스: sibling(`/proj-secrets`), 정확히 루트, 하위, `..` 탈출, 케이스 차이(Linux는 구분/win32는 무시) (H-7).
- REST API HTTP 레벨 테스트의 1차분 — supertest 류로 실제 listen: 세션 TTL 만료/상한 초과 시 거부, 로그에 sessionId 미노출, timing-safe 비교 경로 정상 동작(401) (5장 "REST API HTTP 레벨" 공백의 인증/세션 부분 — 잔여는 P13-9).
- 의존성 업그레이드 후 `sqlite_version()` ≥ 3.50.3 어서션 테스트 추가 (CVE 회귀 방지).

**산출물**: 2개 커밋 (H-7+A-2+A-3 / 의존성 업그레이드). **리스크: 중간** (native 모듈 메이저 업그레이드 — prebuild/ABI 검증 필요, P13-1 선행 전제).

---

## 9. Phase 13-8: 아키텍처 정리 일괄 (A-4~A-8, A-10, A-12, O-1/O-3/O-4, 구조화 로깅, 잔여 O)

**목표**: 리스크 낮은~중간의 정리 항목을 영역별 커밋으로 일괄 처리. Phase 12-6과 같은 "정리" 성격.

### 커밋 A — DB/인덱서 성능 (A-4, A-5, A-7, O-4) — **[DONE]**
- A-4: `src/indexer/update-pipeline.ts:435-441` — `recomputeFanMetrics()`를 배치에서 변경된 노드 집합으로 한정(스키마 트리거가 증분 유지 중이므로 사실상 이중 작업 제거). `src/db/node-repository.ts:320-325` — `LIKE '%#name'` 폴백 제거: `symbol_name` 컬럼 + 인덱스 추가(스키마 마이그레이션)로 역조회 인덱스화.
- A-5: `src/db/node-repository.ts:35, 86, 101-108` — statement 캐싱(+ Phase 12-6 `invalidateStatementCache()` 패턴 재사용). `src/graph/graph-engine.ts:247-303` — `persistClusters()` 전체(클러스터 INSERT + `updateCluster()` 루프)를 단일 트랜잭션으로.
- A-7: `src/indexer/embedding-manager.ts:77-89, 152-156, 251-267` — 임베딩 IPC에 요청 `id` 필드 추가, 응답 id 불일치 시 폐기(타임아웃 후 늦은 응답의 오배달 차단). 타임아웃 시 사이드카 재시작 검토.
- O-4 **(v9 이월 — 채택)**: `src/indexer/typescript-parser.ts:30-42` — 파일마다 `ts.createProgram` + lib 재로딩을 LanguageService/incremental Program 재사용으로 교체.

### 커밋 B — 워처/경로/IPC (A-6, A-8, A-12) — **[DONE]**
- A-6: `src/watcher/file-watcher.ts:48-52` — chokidar `ignored` 콜백에 `FileFilter`(.gitignore 해석) 적용. `src/utils/profile.ts` — `ProjectProfile`의 excludePatterns/maxFileSize를 파이프라인/워처/스캔 전략에 실제 배선(불가 판단 시 기능 제거 + 문서화 — 죽은 설정 방치 금지).
- A-8: `src/utils/paths.ts:193-196` — `getProjectHash()`의 lowercase를 win32/darwin에만 적용(Linux 케이스 구분 FS에서 별개 프로젝트의 DB/락 공유 차단). 레지스트리 tmp 파일명에 pid 포함 + 재시도 기반 병합(lost-update 완화).
- A-12: `src/server/ipc-coordinator.ts:196-199` — 30초 고정 타임아웃을 도구별 타임아웃 테이블로 교체(`backfill_history`/`re_tag_project`/`initialize_project`/`check_consistency`는 장기 허용) + Host의 진행 중 keepalive 응답. (장기 해법인 MCP 2025-11-25 task 워크플로는 SDK 1.29 기반 후속 Phase 후보로 기록.)

### 커밋 C — LOW 일괄 (O-1, O-3, O-7~O-12) + A-10 잔존 — **[DONE]**
> **[DONE — Phase 13-8 커밋 C]** O-1 BFS `queue.shift()` → `head++` 인덱스 포인터. O-3+A-10 `src/utils/version.ts` 신설(walk-up package.json 탐색 + 1회 캐싱, `getVersion()`) — bootstrap/mcp-server x2/workspace-manager x2/admin/api-server `/healthz`의 5곳 중복 읽기 일괄 제거(불필요해진 `fs`/`path` import 정리). O-7 셸 도구 목록에서 미등록 `perform_clustering` 제거(테스트가 `_registry.ts`와 1:1 동기화 검증). O-8 `CertificateGenerator`가 0700 전용 디렉터리(`cynapx-tls-<id>/`) 생성 후 그 안에서 키 작업, 종료 시 디렉터리 통째 정리. O-9 `readRecent()`를 64KB 청크 후방 tail 읽기로(전체 파일 적재 제거, 멀티바이트 경계 안전: 버퍼 누적 후 1회 디코드, 손상 라인 skip). O-10 one-shot CLI가 `lifecycle.disposeAll()` + `lockManager.release()` 후 종료(WAL 체크포인트 보장, exitCode 보존). O-11 `FileFilter` 중첩 .gitignore 지원(경로별 조상 디렉터리 .gitignore 지연 로드 + 서브트리 스코프 prefix, 부정 `!` 처리). O-12 search_symbols가 컨텍스트는 있으나 전부 `EngineNotReadyError`면 빈 success 대신 `isError` 반환. 테스트: `tests/phase13-8-commit-c.test.ts`(17). 502/502, tsc clean.
- O-1: `src/graph/graph-engine.ts:510-511` — BFS `queue.shift()`를 인덱스 포인터(head++)로 교체 (dfs/reTag 기적용 패턴).
- O-3 + A-10(version 중복): `src/utils/version.ts` 신설(1회 읽기 + 캐싱) — `bootstrap.ts:48`, `mcp-server.ts:52-55,161-165`, `workspace-manager.ts:114,180`, `admin.ts:460`, `api-server.ts:207-212`의 5곳 중복 제거. `/healthz`의 매 요청 디스크 읽기 해소.
- O-7: `src/server/interactive-shell.ts:21` — 미등록 도구 `perform_clustering` 표기 제거(`_registry.ts` 기준 동기화).
- O-8: `src/utils/certificate-generator.ts:32` — 0700 디렉터리 생성 후 그 안에서 키 파일 작업.
- O-9: `src/utils/audit-logger.ts:84-93` — `readRecent()`를 tail 방식 부분 읽기로.
- O-10: `src/bootstrap.ts:290-303` — one-shot CLI가 `disposeAll()` 후 종료(WAL 체크포인트 보장).
- O-11: `src/utils/file-filter.ts:19-28` — 중첩 .gitignore 지원.
- O-12: `src/server/tools/search-symbols.ts:15-28` — 전 컨텍스트 `EngineNotReadyError` 시 빈 결과 대신 에러 반환.

### 커밋 D — 구조화 로깅 배선 (v8 이월 — 채택) — **[DONE]**
> **[DONE — Phase 13-8 커밋 D]** dead code였던 `src/utils/logger.ts`(Logger)를 17개 라이브러리 파일에 배선 — embedding-manager/ipc-coordinator/workspace-manager/health-monitor/mcp-server/dependency-parser/language-registry/worker-pool/index-worker/update-pipeline/git-service/consistency-checker/file-watcher/vector-repository/lock-manager/lifecycle-manager/api-server. 각 파일에 모듈 레벨 `const log = new Logger('Ctx')` + 진단성 `console.*`를 `log.{info,warn,error,debug}`로 변환(2인자 `console.x(msg, err)` 형태는 `{ detail }` 구조화 필드로 흡수). Logger를 보강: 모든 출력은 **stderr 전용**(stdout은 MCP stdio 프로토콜 예약), `data` 내 Error 값을 `{message,name}`으로 정규화(JSON `{}` 직렬화 손실 방지). bootstrap에 `CYNAPX_LOG_LEVEL`(debug|info|warn|error|silent) → `Logger.setGlobalLevel()` 배선. **의도적 미변환(판단)**: `cli/admin.ts`(73 console.log — 별도 admin CLI의 사용자 대상 대시보드 UI, MCP stdio와 무관), `server/interactive-shell.ts`(REPL 사용자 출력/배너), `bootstrap.ts` 시작 배너·`[*]`/`[!]` 운영자 상태 라인(이미 stderr + 기존 MCP-mode `console.log=console.error` 가드로 stdout 오염 차단)과 one-shot CLI 결과 stdout 출력(파이프 의도). 테스트: `tests/phase13-8-commit-d.test.ts`(6 — stderr 전용/레벨 필터/SILENT/Error 정규화 + 17개 배선 파일의 stdout 비오염 소스 가드). 507/507, tsc clean, 통합 74/74.

- `src/utils/logger.ts`(작성 완료, 사용처 0곳 — dead code)를 22개 파일 215곳의 `console.*`에 배선. MCP stdio 오염 방지를 위해 stderr 출력 유지, 레벨/컨텍스트 필드 표준화. **앞 커밋들과의 diff 충돌을 피하기 위해 Phase 13 코드 변경의 마지막 커밋으로 수행.**

**테스트**:
- 커밋 A: fan 메트릭 한정 재계산 정합성(트리거 결과와 일치), `symbol_name` 마이그레이션/조회, persistClusters 트랜잭션 원자성(중간 실패 시 전무), mock sidecar로 **늦은 응답 오배달 차단**(5장 "임베딩 프로토콜" 공백), O-4 파싱 결과 동등성 + 벤치마크(`tests/benchmarks/parsing.bench.ts` 갱신).
- 커밋 B: gitignore된 경로의 워처 이벤트 무시, profile excludePatterns 실효성, 케이스 구분 FS 해시 분리(5장 "크로스 플랫폼" 일부), 도구별 타임아웃 적용.
- 커밋 C: 각 항목 단위 회귀 (Phase 12-6 커밋 A/B/C 테스트 패턴 재사용).
- 커밋 D: logger 배선 후 기존 로그 어서션 테스트 갱신 + stdio 비오염 검증.

**산출물**: 4개 커밋 (A/B/C/D). **리스크: 중간** (A-4/A-5는 스키마 마이그레이션 동반, D는 변경 파일 수가 많으나 기계적). **Phase 13-8 전체 [DONE]** — 커밋 A/B/C/D 모두 완료(507/507 테스트, tsc clean, 통합 74/74).

---

## 10. Phase 13-9: 테스트 공백 일괄 + 최종 통합 검증 (5장)

**목표**: 각 Phase에서 수정 직후 동반 작성된 테스트 외에, 인프라가 필요해 이연된 공백을 일괄 구축. 전 단계 완료 후 최종 검증.

| 공백 (5장) | 작업 | 커버 결함 |
|------|------|------|
| REST API HTTP 레벨 | supertest 기반 `tests/api-server-http.test.ts` — 실제 listen: 401/timing, rate limit 429, `/mcp` 세션 생성·GET 우회·정리, `/healthz` 상태별 코드 (P13-7 1차분의 잔여) | A-2, A-3, v9 A-8 |
| Docker 빌드/기동 | P13-1의 `scripts/docker-smoke.sh`를 통합 테스트/CI에 배선 (Docker 부재 환경 skip) | C-1 |
| IPC 2-프로세스 e2e | `scripts/integration-test.js` 또는 전용 스크립트 — 실제 Host/Terminal 프로세스 분리: 악성 에코 클라이언트 인증 거부(C-3), 누적 1MB+ 정상 트래픽 유지(H-8), Host kill → failover 승격 | C-3, H-8, H-1 |
| purge → 재초기화 | P13-6에서 작성한 시나리오를 통합 스크립트 정식 Phase로 편입 | H-6 |
| lock 경합 스트레스 | heartbeat 중 동시 `getValidLock` 반복(원자성), PID 재사용 + 재시도 상한 — P13-3 유닛의 통합판 | H-1, H-2 |
| 크로스 플랫폼 | python3-only 환경 spawn(C-2), 케이스 구분 FS 해시/경계(H-7, A-8) — CI 매트릭스 또는 시뮬레이션 | C-2, H-7, A-8 |

(비-TS 메트릭 공백은 P13-5, git 이력 재작성 공백은 P13-4, 임베딩 프로토콜 공백은 P13-8 커밋 A에서 수정과 동반 작성 — 본 Phase는 누락분 점검만.)

- 최종: `npm test` 전체 그린, `npx tsc --noEmit`, 통합 스크립트 전체(신규 Phase 포함) 통과, `agent_docs/diagnostic-v10.md` 전 항목 [DONE] 마킹, `agent_docs/improvement-plan.md`에 Phase 13 완료 요약 추가.

**산출물**: 1~2개 커밋. **리스크: 낮음** (테스트 전용 — 단 e2e 인프라 신설로 작업량은 큼).

---

## 11. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 13-1 | C-1 Docker/배포 + Node 22 + O-6 + v9 A-8 잔존 | 1~2 | 중간 (빌드 체인) |
| 13-2 | C-2, C-3, H-8, H-9 (크래시·보안) | 2 | 중간 (IPC 프로토콜 변경) |
| 13-3 | H-2, H-1, A-11 (lock 단일성) | 2~3 | 높음 (동시성 코어) |
| 13-4 **[DONE]** | H-4, H-3, A-1, O-2 (인덱싱 정합성·트랜잭션) | 3 | 높음 (파이프라인 핵심) |
| 13-5 | H-5 (비-TS 메트릭 정확성) | 1~2 | 중간 (다운스트림 값 변동) |
| 13-6 **[DONE]** | H-6, A-9 (수명주기·운영 도구) | 1 | 중간 |
| 13-7 | H-7, A-2, A-3 + CVE 의존성 업그레이드 | 2 | 중간 (native 메이저 업그레이드) |
| 13-8 | A-4~A-8, A-10, A-12, O-1/O-3/O-4, O-7~O-12, 구조화 로깅 | 4 | 중간 (마이그레이션 포함) |
| 13-9 | 테스트 공백 일괄 + 최종 통합 검증 | 1~2 | 낮음 |

**총 16~22개 커밋**, P13-1부터 순차 진행 (P13-1 → P13-7 의존성 외에는 P13-5/P13-6의 순서 유연성 있음). 각 Phase 종료 시 `agent_docs/diagnostic-v10.md`에 [DONE] 마킹.

---

## 12. Phase 12 이연 항목 판정 (phase12-plan.md 11장 → diagnostic-v10 verdict)

| 이연 항목 | diagnostic-v10 판정 | Phase 13 처리 |
|-----------|--------------------|---------------|
| O-4: TS Program 재사용/incremental | 여전히 유효 — 파일마다 `ts.createProgram` + lib 재로딩 (v10 O-4, **verdict: 채택**) | **P13-8 커밋 A**에 편입 |
| O-5: 클러스터링 파티셔닝 (100k+ 노드) | 현재 규모 무해 (v10 O-5, **verdict: 계속 보류**) — 단 persistClusters 트랜잭션화는 v10 A-5로 흡수 | 트랜잭션화만 **P13-8 커밋 A**, 파티셔닝은 Phase 14 후보 유지 |
| IPC MessagePack 직렬화 | 성능 문제 미관측 (v10 A-10 표, **verdict: 보류 권고**) | Phase 13 범위 제외 — Phase 14 후보 기록만 유지 |
| 구조화 로깅 (pino/winston) | Logger 클래스 작성 완료·사용처 0곳(dead code) — 배선만 하면 됨 (v10 A-10 표, **verdict: 채택**) | **P13-8 커밋 D**로 배선 |
| YamlParser → js-yaml | 현 용도(top-level key + jobs)에 충분, 우선순위 낮음 (v10 A-10 표, **verdict: 계속 보류**) | Phase 13 범위 제외 — Phase 14 후보 유지 |
