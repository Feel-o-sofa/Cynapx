# Cynapx 정밀 진단 보고서 v17

- **기준 커밋**: `0e3e092` (Phase 19 + Phase 19-1 완료, 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-15
- **진단 범위**: src/ 전체(server, db, indexer, graph, watcher, utils, cli, bootstrap), schema/, scripts/(integration-test.js·ipc-e2e-test.js·docker-smoke.sh 포함), tests/ 전체, src-native/, Dockerfile, `.github/workflows/ci.yml`, `.claude/launch.json`, package.json/lockfile + 외부 컨텍스트(CVE/advisory, 공급망 캠페인, MCP 생태계, 경쟁 도구)
- **진단 방법**: 단일 에이전트 오케스트레이션 + 병렬 서브에이전트 전수 코드 리뷰 + 로컬 직접 검증(`npx vitest run`, `npx tsc --noEmit`, `npm audit --omit=dev`, `npm ls`로 전이 의존 버전 확인, `npm view`로 registry `latest`/dist-tag 확인, 번들 SQLite 버전 확인) + **신규: v15(MCP 도구)·v16(REST 핸들러)이 적용한 "레지스트리 ↔ vitest 케이스 ↔ CI 게이트" 3중 교차 대조를 *세 번째 등록 표면 후보군*(file-watcher chokidar 이벤트 핸들러, bootstrap/CLI 부트 엔트리, worker-pool/embedding-manager 에러-복구 경로, DB 스키마 마이그레이션)으로 확장 재적용** + 웹 검색·페치 기반 외부 조사(진단 일자 재실행 — v16 스냅샷 가정 안 함)
- **현재 상태(직접 검증)**: `npx vitest run` **588/588**(43 파일), `npx tsc --noEmit` 그린, `npm audit --omit=dev` **0 vulnerabilities**(info/low/moderate/high/critical 전부 0 — 직접 실행), 번들 `sqlite_version()`=**3.53.1**. diagnostic-v16 전 항목(M-1 v16 [DONE — Phase 19-1], LOW 6건 추적/이연).

> **요약**: **v15→Phase18(MCP 도구)·v16→Phase19(REST 핸들러)에 이어 본 사이클은 같은 회의적 3중 교차 대조를 *세 번째 등록 표면 후보군*에 적용해, file-watcher 표면에서 한 건의 실재하는 무위험 actionable 항목을 새로 발견했다.** 공급망·CVE·코드 결함 측면은 여전히 clean(CRITICAL/HIGH 0, 신규 CVE 도달 0)이다. **신규 신호는 `FileWatcher`의 대용량-배치 `syncWithGit()` 경로다 — `start()`가 등록하는 chokidar 이벤트(`add`/`change`/`unlink`)가 `flush()`로 흘러드는데, `flush()`의 두 분기 중 *대용량-배치 분기*(`currentQueue.length >= 50 || syncFailedCount > 0`, file-watcher.ts:138-154)와 그에 딸린 *에러-복구 상태머신*(`syncFailedCount++`, `>= MAX_SYNC_RETRIES(3)` FATAL 분기, 실패 후 재시도 로그, 성공 시 카운터 리셋)은 어느 게이트에서도 검증되지 않는다.** 현 `file-watcher.test.ts`는 H-2(확장자 allowlist)·H-3/H-1(flush 동시성·타이머 위생)을 두텁게 커버하나 **전부 소용량 `processBatch` 경로만** 행사한다 — `syncWithGit` mock은 정의돼 있으나 단 한 번도 호출되지 않는다. **결정적으로 이 대용량-배치 경로는 e2e(`integration-test.js`)에서도 *FileWatcher를 통해* 검증되지 않는다**(직접 확인 — integration-test.js:173은 `updatePipeline.syncWithGit()`을 *직접* 부르지 FileWatcher 경로가 아님). 즉 v16의 REST 격차와 동형이다: 등록된 표면의 핵심 동작 분기가 어디에도 동작 테스트가 없다. mock(`makePipeline()`)이 이미 하니스에 있고 무위험·additive하게 메울 수 있다. **이는 패딩이 아니라 v15/v16의 3중 대조를 "세 번째 등록 표면(이벤트 핸들러)"으로 끝까지 밀어붙였을 때 자연히 드러난 격차다.** 외부 측면은 신선하게 재조사했고(**Miasma 캠페인의 신규 변종 — GitHub 저장소 직접 침투형 AI-에이전트 설정 주입: 6/5 MS 73개 저장소, `.claude/setup.mjs`·`.claude/settings.json`·`.cursor/rules/setup.mdc`·`.gemini/settings.json` 주입**, MCP SDK v2 여전히 npm 미배포(latest 1.29.0), node-tree-sitter#268 여전히 open) 전부 Cynapx에 무영향임을 직접 재대조했다(Cynapx in-tree `.claude/launch.json`은 양성 — SessionStart 훅/원격 페이로드 없음). **CRITICAL 0, HIGH 0, MEDIUM 1(M-1 v17, 신규 — FileWatcher 대용량-배치/복구 경로 동작 테스트 공백, 무위험 additive), LOW 7(L-2~L-7 v16 승계 추적/이연 + L-8 신규 추적·비-actionable).**

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건(C-1 Docker 배포 전손, C-2 사이드카 spawn 크래시, C-3 IPC 인증 무력화)은 Phase 13에서, v11의 HIGH 1건(N-1 공급망)은 Phase 14-1에서, v12의 MEDIUM 4건은 Phase 15에서, v13의 MEDIUM 1건(M-1 fast-uri floor)은 Phase 16에서, v15의 MEDIUM 1건(도구 디스패처 게이트 공백)은 Phase 18-1에서, v16의 MEDIUM 1건(REST 핸들러 게이트 공백)은 Phase 19-1에서 해소됐고, 전수 재열람에서 새로운 CRITICAL/HIGH는 발견되지 않았다. IPC 핸드셰이크(`src/server/ipc-coordinator.ts`)는 random challenge + `HMAC-SHA256(nonce, challenge)` + `timingSafeEqual`로 견고하고, API Bearer는 SHA-256 후 `timingSafeEqual`(`api-server.ts`), 세션 맵은 TTL+cap+sweep(unref)로 보호된다.

---

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** 코드·공급망 어디에서도 신규 HIGH는 발견되지 않았다. `npm audit --omit=dev` = 0 vulnerabilities(직접 재검증, 6.1 참조). M-1 v17(FileWatcher 대용량-배치/복구 경로 테스트 공백)은 **현재 동작하는 결함이 아니라 회귀 방어막의 공백**이므로 HIGH가 아니라 MEDIUM으로 정직하게 등급한다 — 해당 경로의 코드(대용량-배치 git 동기화, 재시도 카운터, FATAL 강등)는 재열람에서 결함 0이다. 문제는 "이 동작 분기의 회귀를 잡을 빠른 게이트가 없다"는 예방적 격차일 뿐이다. 외부 공급망 사건(Miasma GitHub-저장소 변종, 6.3)도 Cynapx 의존 트리·in-tree 설정에 도달하지 않으므로 HIGH가 아니라 LOW(포스처 추적, L-2)로 다룬다.

---

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

| # | 위치 | 내용 |
|---|------|------|
| **M-1 v17** *(신규, actionable, 무위험 additive)* | `tests/file-watcher.test.ts` (+ `src/watcher/file-watcher.ts` flush 분기, `scripts/integration-test.js`) | **FileWatcher 대용량-배치 `syncWithGit()` 경로 + 에러-복구 상태머신의 게이트 공백 — `flush()`의 핵심 *동작* 분기가 어느 게이트(vitest·e2e)에서도 미검증.** `start()`(file-watcher.ts:79-82)는 chokidar 이벤트 3종(`add`→ADD, `change`→MODIFY, `unlink`→DELETE)을 등록해 전부 `handleChange()`→`flush()`로 흘려보낸다. `flush()`(file-watcher.ts:123-185)는 두 갈래다: (a) **소용량 분기**(`processBatch`, line 155-167) — 현 `file-watcher.test.ts`가 H-2/H-3/H-1로 두텁게 커버, (b) **대용량-배치 분기**(`currentQueue.length >= BATCH_THRESHOLD(50) || syncFailedCount > 0`, line 138-154) — **어느 테스트도 행사 안 함**. 미검증 핵심 분기: (1) **대용량 트리거 → `pipeline.syncWithGit()` 호출 + 성공 시 `syncFailedCount=0` 리셋**(line 145-146), (2) **catch → `syncFailedCount++` + 재시도 경로**(line 147-148), (3) **`syncFailedCount >= MAX_SYNC_RETRIES(3)` → FATAL 에러 로그 분기 vs 그 미만 → retriable 에러 분기**(line 149-153), (4) **`syncFailedCount > 0`일 때 "재시도" 진입(소용량이어도 대용량 분기로 라우팅)**(line 138-140) — 즉 한 번 실패하면 후속 flush가 git-sync 경로로 락인되는 복구 동작. **현 테스트의 `makePipeline()`은 `syncWithGit` mock을 정의하나 단 한 번도 호출되지 않는다**(전 케이스가 queue<50, syncFailedCount=0 → `processBatch`만 탐). **결정적: 이 경로는 e2e에서도 *FileWatcher를 통해* 미검증** — `integration-test.js:173`은 `updatePipeline.syncWithGit()`을 *직접* 호출하지 watcher의 대용량-배치 라우팅·재시도 락인·FATAL 강등을 행사하지 않는다(직접 확인). → v16의 REST 격차와 **동형**: 등록된 이벤트-핸들러 표면의 핵심 동작 분기가 어디에도 동작 테스트가 없다. **근본 원인은 테스트 *부재*(분포 아님) — 대용량/복구 분기는 supertest-급 게이트에 들어온 적이 없다.** 기존 `makePipeline()` + `(watcher as any).flush()` 직접 호출 패턴(이미 H-3에서 사용 중)으로 무위험·additive하게 메울 수 있다. **verdict: actionable, 무위험 additive — Phase 20-1.** (5장 상세) |

> **참고**: v15는 MCP 도구 디스패처에, v16은 REST `/api/*` 핸들러에 3중 대조를 적용했다. v17은 **그 방법론을 "세 번째 등록 표면"인 이벤트-핸들러(chokidar)로 확장**해, file-watcher의 대용량-배치/복구 분기에서 한 건의 실재 공백을 찾았다. 같은 패스에서 bootstrap 엔트리·worker-pool/embedding 에러-복구·DB 마이그레이션도 동일 격자로 대조했으나, 그 격차들은 (a) 인접 분기가 이미 게이트 커버, (b) 테스트-only로 메우려면 광범위 모킹/프로덕션 시그니처 변경 수반이라 **무위험 원칙상 비-actionable**로 L-8에 추적만 한다(5장 (2)/(3)). FileWatcher만이 "기존 하니스로 핵심 분기를 행사 가능 + 어디에도 동작 테스트 부재"라는 v16 동형 조건을 충족한다. 프로덕션 코드는 한 줄도 바꾸지 않는다(경로 정상). |

---

## 4. 최적화 (LOW) — 전부 추적/이연 (v16 승계 6건 + L-8 신규 추적 1건)

| # | 위치 | 내용 |
|---|------|------|
| L-2(v17) | `package.json` (native deps), CI / Dockerfile, `.claude/`·`.cursor/`·`.gemini/` 설정 | **Miasma / Phantom Gyp 공급망 캠페인 포스처 추적 — *신규 변종: GitHub 저장소 직접 침투형 AI-에이전트 설정 주입* 반영.** v16이 추적한 npm wave(6/1~6/3: @redhat-cloud-services 32 + @vapi-ai/server-sdk + 57패키지/286+ 악성 버전, ai-sdk-ollama 120k+ MD) 이후, 진단 일자 직접 재조사로 **신규 변종**을 확인했다: 공격자가 npm 레지스트리를 *우회*해 **GitHub 소스 저장소에 직접 커밋**(`chore: update dependencies [skip ci]`)을 밀어 **AI-코딩-에이전트 설정 파일을 주입**한다 — 확인된 주입 파일: `.claude/setup.mjs`(Claude Code **SessionStart 훅**), `.claude/settings.json`(설정 주입), `.cursor/rules/setup.mdc`(프로젝트 오픈 시 로드되는 Cursor 규칙·프롬프트 인젝션), `.gemini/settings.json`. **6/5 Microsoft 73개 저장소가 탈취된 컨트리뷰터 자격증명으로 침해**됐고, 개발자가 영향받은 저장소를 Claude Code/Gemini CLI/Cursor/VS Code로 열면 워크스페이스 초기화 시 페이로드가 자동 실행돼 AWS/GCP/Azure 키·GHA 시크릿·로컬 패스워드 스토어를 수집한다. **본 사이클 직접 재대조: (a) wave-1/2 컴프로마이즈 패키지 패밀리 전부 Cynapx 트리 "not in tree"(`npm ls` 확인), Cynapx native 의존(better-sqlite3 12.10.1 + tree-sitter 0.25.0 코어 + 12 grammar) 전부 무관·악성 버전 미발행. (b) 신규 변종 관련: Cynapx in-tree 설정은 `.claude/launch.json` 단 1개이며 — 직접 열람 결과 — 프로젝트 자체 `src/bootstrap.ts`를 띄우는 양성 launch 설정으로 SessionStart 훅·`setup.mjs`·원격 페이로드가 없다. `.cursor/`·`.gemini/` 디렉터리 부재.** **즉각 조치 불필요** — CI가 `npm ci`(lockfile 고정) + audit 게이트(P14-1) + Dockerfile 멀티스테이지로 1차 방어선 유지. **verdict: 추적만**(6.3 상세). v16 대비 "npm wave 재발 없음, **GitHub-저장소 직접 침투 + AI-에이전트 설정 주입 변종 신규 인지**, Cynapx 트리·in-tree 설정 도달 0건 불변". |
| L-3(v17) | `src/server/api-server.ts` (session-id StreamableHTTP) | MCP stateless transport 충돌 표면 — SDK v2 업그레이드 시 회귀 표면. **SDK v2 여전히 npm 미배포**(npm `latest`=**1.29.0**, dist-tags `{ latest: '1.29.0' }`만 — `npm view dist-tags --json` 직접 확인, 2.x 버전/dist-tag 0건) → **계속 이연**. v2 alpha는 main 브랜치 pre-release로 존재하나 정식 stable은 **2026-07-28 예고**(스펙 갱신 동반), v1.x는 v2 출시 후 6개월+ 유지(공식 README — production은 v1.x 권장). P15-3의 `handleMcp()` 설계 메모가 출발점. **v16 대비 상태 불변(stable 일자만 7/28로 구체화) — 계속 이연** |
| L-4(v17) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환(v8→v17 이월). **성능 문제 미관측, verdict: 계속 보류.** 메시지가 작고(주로 메타데이터) round-trip이 드물어 직렬화가 병목 아님. 기록만 유지 |
| L-5(v17) | `src/graph/graph-engine.ts` | 클러스터링 본격 서브그래프 파티셔닝(O-5) — 100k+ 노드 실측 시 재검토(**verdict: 계속 이연**). M-4(v12)의 count-first 가드(`countNodes()` probe → `getAllNodes()` 풀로드 이전 short-circuit)가 OOM 1차 방어 |
| L-6(v17) | CI / Dockerfile | Node 24 + tree-sitter 0.25.x 빌드 fragility(C++20/prebuild 부재) — 상류 이슈 [node-tree-sitter#268]이 **진단 일자 여전히 open·미해결**(직접 웹 재확인 — 2026-01-12 보고 이후 후속 댓글/prebuild 릴리스 0). CI `build-and-test`가 Node 22/24 매트릭스에서 `npm test`를 돌리고 **현재 그린**이나, Node 24 LTS 전환 전 prebuild 가용성 재확인 필요. **추적만**(O-6 v12 승계). **v16 대비 상태 불변** |
| L-7(v17) | `src/cli/admin.ts` (cmd* 9개), `tests/admin-cli.test.ts` | **admin CLI 명령 동작의 vitest 게이트 공백 — 의도적 비-actionable로 추적만.** 등록 명령 9개(status/list/inspect/doctor/purge/unregister/compact/backup/restore)의 `cmd*` 함수는 모듈-private(미-export)이라 vitest 직접 호출 불가, 현 테스트는 *기반 프리미티브*(LockManager.probeProjectLock·VACUUM INTO·AuditLogger)만 검증. `cmd*` 테스트는 `process.exit`/`console`/fs 광범위 모킹 또는 export 리팩터 수반 → **테스트-only가 아니라 프로덕션 시그니처 변경**(무위험 원칙 위반). **verdict: 추적만 — admin.ts 리팩터(핸들러 export) 시 함께 게이트화 후보.** **v16 대비 불변** |
| **L-8(v17)** *(신규 추적, 비-actionable)* | `src/indexer/worker-pool.ts`(line 90 error 이벤트, line 134 backpressure), `src/indexer/embedding-manager.ts`(line 275 A-7 supersedence 레이스), `src/db/database.ts`(migration 0→1 line 98 / 2→3 line 139 / 콜백 예외 격리 line 178) | **에러-복구·마이그레이션 잔여 분기의 vitest 게이트 공백 — 의도적 비-actionable로 추적만.** v17의 3중 대조를 worker-pool/embedding/DB 마이그레이션에 적용한 결과: (a) **worker-pool `worker.on('error')`**(line 90)는 직접 미검증이나 timeout→`replaceWorker` 경로가 인접 분기로 커버(phase12-6-commit-b)되고 호출 체인 동일, **queue backpressure 거부**(maxQueueSize, line 134)는 게터값만 검증, (b) **embedding A-7 stale 응답 supersedence 레이스**(line 275)는 fake-timer 타이밍 레이스라 단정 어렵고 가드 로직 자체는 건전, (c) **DB migration 0→1/2→3**는 테스트 스위트가 `SCHEMA_VERSION`에서 초기화돼 실행 안 됨(1→2는 malformed-JSON skip까지 명시 커버, database-migration.test.ts:69-94). **그러나 M-1 v17(FileWatcher)과 달리 actionable로 올리지 않는다**: (1) worker error 이벤트·backpressure는 인접 분기(replaceWorker/double-settle/dispose)가 이미 게이트 커버해 가장 위험한 로직은 보호됨, (2) 마이그레이션 0→1/2→3을 행사하려면 DB를 구버전으로 롤백 후 재마이그레이션하는 픽스처가 필요해 *추가 테스트 인프라*를 요하고 idempotent(`INSERT OR IGNORE`/`ADD COLUMN` 백필)라 회귀 위험 자체가 낮음, (3) A-7 레이스는 타이밍 의존이라 flaky 위험. **verdict: 추적만 — 향후 마이그레이션 추가(SCHEMA_VERSION 증분) 또는 worker-pool 리팩터 시 함께 게이트화 후보로 기록.** |

> **신규 LOW 부재 안내(코드 변경 항목)**: better-sqlite3는 v16 시점 12.10.1(published)에서 변동 없음 — Electron 42용 V8 external API 수정 + GHA 의존 갱신뿐, 번들 SQLite 버전(3.53.1)·보안 수정 없음. Cynapx는 Electron이 아니므로 **기능상 no-op**이라 별도 LOW로 올리지 않는다. tree-sitter 코어(0.25.0)·tree-sitter-c-sharp(0.23.5, 0.23.6 미배포) 신버전 없음 → 0.23.1 정확 핀 롤백 유지가 여전히 옳다. 따라서 v17의 LOW는 L-2~L-8의 7건이며 **L-2~L-7은 v16 승계 추적/이연, L-8은 신규 추적(비-actionable)** — **코드 변경을 요하는 신규 LOW 0건**이다.

---

## 5. 테스트 공백 (M-1 v17 상세 — 본 사이클 핵심 신규 발견)

Phase 19-1 종료 시 588 테스트(43 파일)로 회귀 안전망이 두텁고, **MCP 도구 디스패처(v15→P18-1, 20/20)·REST 핸들러(v16→P19-1, 8개 핸들러 동작 분기)는 게이트 커버**됐다. 본 사이클은 그 "등록 ↔ 테스트 ↔ CI 게이트" 3중 대조를 **MCP 도구·REST 외의 세 번째 등록 표면 후보군**(file-watcher 이벤트 핸들러, bootstrap 엔트리, worker-pool/embedding 에러-복구, DB 마이그레이션)으로 확장했다.

**(1) FileWatcher 대용량-배치 `syncWithGit()` + 복구 상태머신 공백 (M-1 v17, actionable)**

chokidar 이벤트(`add`/`change`/`unlink`) ↔ `file-watcher.test.ts`의 vitest 케이스 ↔ e2e 스크립트를 3중 대조한 결과:

| `flush()` 분기 (file-watcher.ts) | vitest 동작 검증 | e2e(FileWatcher 경유) |
|------|:---:|:---:|
| 소용량 → `processBatch`(line 155-167) | ✅ H-2/H-3/H-1 다수 | ❌ 미접촉 |
| 대용량 트리거 → `syncWithGit` 호출 + 성공 리셋(line 145-146) | ❌ 미검증 (`syncWithGit` mock 0회 호출) | ❌ (integration-test.js:173은 *직접* 호출) |
| catch → `syncFailedCount++` 재시도(line 147-148) | ❌ 미검증 | ❌ |
| `>= MAX_SYNC_RETRIES(3)` → FATAL vs 미만 → retriable(line 149-153) | ❌ 미검증 | ❌ |
| `syncFailedCount > 0` → 후속 flush git-sync 락인(line 138-140) | ❌ 미검증 | ❌ |

> 주: `start()`의 chokidar `ignored` 프레디킷(dotfile + `fileFilter.isIgnored`, line 71-74)·`error`/`ready` 이벤트(미등록)도 vitest 미행사이나, 이는 chokidar 라이브러리 통합 경계라 테스트-only 단위로 메우기 어렵다(M-1 v17은 라이브러리 경계가 아닌 *우리 코드*의 `flush` 분기에 집중). `handleChange`의 DELETE 분기(line 94-95)·maxFileSize 가드(line 96)도 부수적으로 미검증이나 가성비상 후순위.

**함의**: FileWatcher 회귀(예: 대용량 임계 라우팅 제거로 50+ 파일 일괄 변경이 개별 처리로 폭주, 재시도 카운터 회귀로 무한 git-sync 루프, FATAL 강등 분기 회귀로 무한 실패 침묵)는 **어느 게이트도 통과 못 잡는다**(e2e조차 watcher 경로를 안 침). **Phase 20-1에서 대용량-배치 라우팅 + 성공 리셋 + 실패 재시도 + FATAL 강등 + 재시도 락인을 기존 `makePipeline()`/`flush()` 직접 호출 하니스로 `file-watcher.test.ts`에 추가**해 게이트로 끌어올린다. 대용량 트리거→`syncWithGit` 1회 호출 검증이 가성비 1위(mock 표면 최소, 분기 명확).

**(2) bootstrap 엔트리 — 추적만(비-actionable)**

bootstrap의 다수 분기(acquireAndRun 락 상태머신, HTTPS 실패 exit, 원샷 CLI, 시그널 핸들러)는 *의존 프리미티브*(LockManager·LifecycleManager·ApiServer·resolveHttpsOptions)가 각각 단위 게이트로 두텁게 커버되나 **bootstrap-레벨 시퀀스 통합은 미검증**이다. 그러나 (a) 의존 불변식이 이미 게이트 커버, (b) bootstrap을 통합 테스트하려면 `process.exit`/시그널/IPC를 광범위하게 모킹하거나 엔트리를 분해 리팩터해야 해 **테스트-only가 아니라 프로덕션 구조 변경 수반**(무위험 원칙 위반)이라 M-1 v17(FileWatcher)과 달리 actionable로 올리지 않는다. L-8 인접 — 향후 bootstrap 분해 리팩터 시 함께 게이트화 후보.

**(3) worker-pool / embedding / DB 마이그레이션 — 추적만(L-8, 비-actionable)**

worker error 이벤트·backpressure·A-7 supersedence 레이스·migration 0→1/2→3은 (a) 인접 분기가 이미 게이트 커버, (b) 마이그레이션은 구버전 롤백 픽스처(추가 인프라) 필요 + idempotent라 회귀 위험 낮음, (c) A-7은 타이밍 의존 flaky 위험 → 4장 L-8에 추적만.

**(4) 그 외 영역 — 공백 없음**

기존 스위트는 도구 디스패처 20/20(P18-1)·REST 핸들러 동작(P19-1)·lock 경합·IPC e2e+인증·비-TS 메트릭·git 이력 재작성·purge 재초기화·임베딩 프로토콜(A-7 + M-2)·CrossProjectResolver 멀티프로젝트(P14-2)·클러스터링 결정성+count-first 가드(P14-4 + M-4)·MCP progress(P14-5)·YAML 견고성(P14-3)·REST auth/rate-limit/세션/healthz 메커니즘·FileWatcher H-2/H-3/H-1(소용량 flush)를 이미 커버한다. M-1 v17(FileWatcher 대용량-배치/복구) 외에 신규 테스트가 *무위험으로* 필요한 결함은 없다.

---

## 6. 외부 컨텍스트 (웹 조사 — 진단 일자 재실행, 출처 명시)

### 6.1 의존성 취약점 (진단 일자 직접 재검증 — 전부 clean)

`npm audit --omit=dev` + `npm ls` + `npm view`로 직접 재확인했다:

- **`npm audit --omit=dev` = 0 vulnerabilities** (info/low/moderate/high/critical 전부 0 — 직접 실행). Phase 14-1 baseline 유지.
- **fast-uri**: `overrides`로 floor·설치본 모두 `3.1.2`(`npm ls fast-uri`=`fast-uri@3.1.2 overridden` 직접 확인). **CVE-2026-6321**(path traversal, ≤3.1.0)·**CVE-2026-6322**(host confusion, ≤3.1.1) 둘 다 3.1.2에서 해소 → Phase 16-1 floor 유효. 출처: [GHSA-q3j6-qgpj-74h6 / CVE-2026-6321](https://github.com/advisories/GHSA-q3j6-qgpj-74h6)
- **`@modelcontextprotocol/sdk`**: npm `latest`=**1.29.0**(직접 `npm view dist-tags --json` 확인 — `{ latest: '1.29.0' }`, 2.x 버전 목록 0건). Cynapx `overrides`(fast-uri/qs/hono)가 계속 정답. 설치본: ajv 8.18.0, hono 4.12.25, express 5.2.1(전이) + 4.22.1(직접). 출처: [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- **qs `^6.15.2`**(설치 6.15.2): express@4.22.1/express@5.2.1/supertest 경유 전부 dedupe·overridden(`npm ls qs` 직접 확인). clean.
- **hono `^4.12.21`**(설치 4.12.25, override): bodyLimit/JSX/JWT/cache 모더릿 패치 라인 이상. clean.
- **js-yaml 4.x**: CVE-2025-64718(<4.1.1) 비해당. CVE-2026-33532(deeply-nested flow sequence DoS)는 `yaml`(eemeli) 대상이지 `js-yaml`(nodeca)이 아님 — Cynapx는 `js-yaml`만 사용.
- **better-sqlite3 12.10.1 / SQLite 3.53.1**: 로컬 `sqlite_version()`=**3.53.1** 직접 확인(node 인-메모리 probe). Snyk 직접 취약점 0건. Miasma 캠페인에서 악성 버전 미발행, clean. 출처: [Snyk better-sqlite3](https://security.snyk.io/package/npm/better-sqlite3)
- **sqlite-vec 0.1.9 / swagger-ui-express 5 / commander 14 / chokidar 5 / simple-git 3.36 / ignore 7 / zod 4.x / express 4.22.x·5.2.x / supertest(dev)**: 미해결 공개 취약점 미발견.

### 6.2 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"` + Docker `node:22-bookworm-slim`. Node 22 LTS 유지보수 2027-04 종료 — 여유. CI Node 22/24 매트릭스 그린(588/588). Node 24 + tree-sitter 0.25.x는 [node-tree-sitter#268](https://github.com/tree-sitter/node-tree-sitter/issues/268)(여전히 open·미해결, 2026-01-12 보고·후속 0)의 C++20/prebuild 부재 fragility(L-6).
- **tree-sitter 코어**: npm `latest`=**0.25.0**(직접 확인). 12 grammar 전부 `tree-sitter@0.25.0 deduped/overridden`. **tree-sitter-c-sharp**: npm 최신 여전히 **0.23.5**(`npm view version`=0.23.5, 0.23.6 미배포 — P15-2의 `ERR_REQUIRE_ASYNC_MODULE` 해소 신버전 없음) → **0.23.1 정확 핀 롤백 유지가 여전히 옳다**.

### 6.3 공급망 캠페인 — Miasma / Phantom Gyp (신규 변종: GitHub-저장소 직접 침투형 AI-에이전트 설정 주입)

- **Miasma / Phantom Gyp — 신규 변종 인지(GitHub 저장소 직접 침투 + AI-에이전트 설정 주입), Cynapx 도달 0건 불변**: v16이 추적한 npm wave(6/1~6/3: @redhat-cloud-services 32 + @vapi-ai/server-sdk(408k MD) + 57패키지/286+ 악성 버전, jagreehal 계정 50+ 패키지·ai-sdk-ollama 120k+ MD)에 더해, 진단 일자 직접 재조사로 **GitHub 소스 저장소를 npm *우회* 직접 침투하는 병렬 변종**을 확인했다. 공격자가 탈취 자격증명으로 `chore: update dependencies [skip ci]` 커밋을 밀어 **AI-코딩-에이전트 설정 파일을 주입**한다 — 확인 파일: `.claude/setup.mjs`(Claude Code **SessionStart 훅**), `.claude/settings.json`, `.cursor/rules/setup.mdc`(프롬프트 인젝션으로 Cursor 에이전트가 페이로드를 "프로젝트 셋업"으로 실행하게 유도), `.gemini/settings.json`. **6/5 Microsoft 73개 저장소 침해**(Azure Functions Action 등). 개발자가 영향 저장소를 Claude Code/Gemini CLI/Cursor/VS Code로 열면 워크스페이스 초기화 시 페이로드 자동 실행 → AWS/GCP/Azure 키·GHA 시크릿(러너 프로세스 메모리)·로컬 패스워드 스토어 수집. **본 사이클 직접 재대조**: (a) wave-1/2 패키지 패밀리 전부 Cynapx 트리 "not in tree" + native 의존(better-sqlite3 12.10.1 + tree-sitter 0.25.0 + 12 grammar) 무관·악성 버전 미발행, (b) **신규 변종 관련 — Cynapx in-tree 설정은 `.claude/launch.json` 1개뿐이며 직접 열람 결과 프로젝트 자체 `src/bootstrap.ts`를 띄우는 양성 launch 설정(SessionStart 훅·`setup.mjs`·원격 페이로드 없음), `.cursor/`·`.gemini/` 부재.** **함의(L-2)**: Cynapx는 node-gyp 빌드 native 모듈을 쓰므로 구조적 표적 표면에 노출되나, (i) CI `npm ci`(lockfile 고정), (ii) P14-1 audit 게이트, (iii) Dockerfile 멀티스테이지로 1차 방어선 유지. **신규 변종은 npm 의존이 아니라 *저장소 협업 위생*(컨트리뷰터 자격증명·in-tree 에이전트 설정 무결성)을 표적으로 하므로, 매 사이클 in-tree `.claude/`·`.cursor/`·`.gemini/` 설정에 SessionStart 훅/외부 스크립트가 끼어들지 않았는지 점검 항목 추가**(현재 `.claude/launch.json` 양성). **즉각 코드 변경 불필요, 포스처 추적.** 출처: [StepSecurity: Miasma hits Microsoft GitHub repos](https://www.stepsecurity.io/blog/miasma-worm-hits-microsoft-again-azure-functions-action-and-72-other-repositories-disabled-after-supply-chain-attack-targeting-ai-coding-agents), [SafeDep: Miasma worm AI coding agent config injection](https://safedep.io/miasma-worm-ai-coding-agent-config-injection/), [The Hacker News: Miasma worm hits 73 Microsoft GitHub repos](https://thehackernews.com/2026/06/miasma-worm-hits-73-microsoft-github.html), [Corgea: Phantom Gyp Miasma](https://corgea.com/research/miasma-phantom-gyp-npm-worm-vapi-ai-sdk-ollama-june-2026)

### 6.4 MCP 생태계 — SDK v2 alpha 존재하나 npm 정식 미배포 (v16 승계, stable 일자 구체화)

- **MCP TypeScript SDK v2 = npm 정식 미배포**(직접 확인): v2는 stateless protocol core + Extensions framework + Tasks + MCP Apps + authorization hardening를 담았고 main 브랜치 alpha pre-release로 존재하나, **npm `latest`=1.29.0이고 메인 패키지에 2.x 버전/dist-tag는 0건**(`npm view @modelcontextprotocol/sdk dist-tags --json` 직접 확인). v2 milestone: Alpha ~3월 중순, Beta ~5월, **stable 신스펙 출시 2026-07-28 예고**. v1.x는 v2 출시 후 6개월+ 유지(공식 README — production은 v1.x 권장). → **P15-3에서 이연한 stateless transport(session-id 제거) + task extension 전면 마이그레이션은 여전히 착수 불가**(SDK가 아직 npm `latest`에 없음). progress-token opt-in(P14-5)은 현행 코드 정상. 출처: [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases), [MCP TS SDK v2 docs](https://ts.sdk.modelcontextprotocol.io/v2/), `npm view @modelcontextprotocol/sdk dist-tags`

### 6.5 경쟁/인접 도구 동향 (v16 승계 — 전략 추적)

- **로컬-퍼스트 코드 그래프 카테고리 성숙 지속**: Serena(LSP-over-MCP)·CodeGraph·GitNexus 등이 심볼-레벨 표준의 사실상 기본값. Cynapx의 "100% 로컬·격리·멀티프로세스 보안 IPC" 포지션이 차별점이며, **6.3의 AI-에이전트 설정 주입 변종(`.claude/`/`.cursor/`/`.gemini/` 침투)은 격리·lockfile-고정·`npm ci`·in-tree 설정 무결성 포스처의 가치를 재확인**한다.
- **SCIP가 LSIF를 대체하는 심볼 인덱스 표준으로 정착** — Cynapx `export_graph`(json/graphml/dot)에 SCIP export 추가는 미래 상호운용 후보. `export_graph`(MCP 도구)는 P18-1로, REST `/api/graph/export`는 P19-1로 게이트 커버됐다(신규 포맷의 디딤돌 마련 완료). SCIP 자체는 protobuf 의존 도입 + Miasma류 install-time 표면 확대 우려로 즉시 착수 비권장 — 전략 후보 유지.
- **함의**: v11~v16과 동일하게 (1) 공급망 위생 유지(+ in-tree 에이전트 설정 무결성 점검 추가), (2) 생태계 스펙 추적(MCP SDK v2 — 7/28 stable까지 대기), (3) **회귀 안전망 위생(v15 MCP 도구 → v16 REST 핸들러 → v17 이벤트 핸들러로 확장)**이 신뢰성 차별화 축이다.

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 정밀 재열람에서 신규 결함이 없었다(M-1 v17 외 코드 동작 변경 0):

- `src/watcher/file-watcher.ts` — chokidar `ignored` 프레디킷(dotfile + FileFilter)·확장자 allowlist(H-2)·flush 동시성 가드(H-3)·타이머 위생(H-1·M-8 dispose)·대용량-배치 git-sync 라우팅·재시도 카운터·FATAL 강등 로직 자체는 정상이나 대용량/복구 분기 vitest 게이트 부재(M-1 v17 대상).
- `src/bootstrap.ts`·`src/utils/lifecycle-manager.ts` — Host/Terminal 락 상태머신·failover jitter+double-check·HTTPS 실패 exit·원샷 CLI·시그널 teardown·disposeAll 순서 견고. bootstrap-레벨 시퀀스 통합 게이트 부재(L-8 인접, 비-actionable — 의존 프리미티브는 게이트 커버).
- `src/server/api-server.ts` — 세션 TTL/cap/sweep(unref), timing-safe Bearer, sessionId 마스킹, per-session transport 페어, rate-limit keyGenerator 고정 양호. 8개 REST 핸들러 동작 분기 supertest 게이트 커버(P19-1). `handleHotspots` SQL 보간은 z.enum + validate 선행 가드로 안전.
- `src/server/ipc-coordinator.ts` — challenge-response 인증·라인 단위 1MB 바이트 제한·per-tool 타임아웃·keepalive(unref+clear)·pending reject-on-close 견고.
- `src/server/tool-dispatcher.ts` — `executeTool()` Terminal 포워딩 단락 → `waitUntilReady` → registry lookup → `EngineNotReadyError` 재시도 변환(H-1) 견고. 도구 디스패처 20/20 게이트 커버(P18-1).
- `src/indexer/worker-pool.ts` — WeakMap taskMap·double-settle 가드·timeout→replaceWorker·setImmediate 재진입 방지·dispose 큐/타이머 정리 견고(error 이벤트·backpressure 분기만 인접-커버, L-8 추적).
- `src/indexer/embedding-manager.ts` — A-7 request-id discipline·spawn error 핸들러·지수 백오프 재시작·FTS5 폴백 강등·dispose SIGTERM→SIGKILL + M-2(P15-1) 배치 타이머 위생 양호(A-7 supersedence 레이스만 L-8 추적).
- `src/db/database.ts` — 스키마 버전 게이트·1→2 마이그레이션(malformed-JSON skip 포함) 명시 커버·콜백 firing 양호(0→1/2→3·콜백 예외 격리만 L-8 추적, idempotent).
- `src/indexer/cross-project-resolver.ts` — P14-2 indexed probe + 원격 DB sanity·1회 경고·핸들/캐시 무효화 건전.
- `src/graph/graph-engine.ts` — P14-4 Fisher-Yates + seeded PRNG 결정성 + M-4(P15-1) count-first 가드 양호(L-5 본격 파티셔닝만 이연).
- `src/utils/lock-manager.ts` — atomic write/heartbeat staleness/nonce 자기 일치 release 검증.
- `package.json` overrides — tree-sitter `^0.25.0`(P15-2)·fast-uri `^3.1.2`(P16-1)·qs `^6.15.2`·hono `^4.12.21` 전부 패치/최신 floor 충족.
- `.claude/launch.json` — 프로젝트 자체 `src/bootstrap.ts` 기동용 양성 launch 설정(SessionStart 훅·외부 `setup.mjs`·원격 페이로드 없음 — 6.3 Miasma 변종 직접 대조 결과 무해).
- `.github/workflows/ci.yml` — Node 22/24 매트릭스 + `npm audit --omit=dev --audit-level=high` 게이트(P14-1) + `npm ci`(lockfile 고정) 양호(Miasma 1차 방어선). `npm test`(vitest)만 돌리고 `integration-test.js`/`ipc-e2e-test.js`는 미실행 — **M-1 v17(FileWatcher 대용량-배치)도 vitest 게이트로 메우는 것이 정답**(e2e는 watcher 경로를 안 침). (cynapx-autonomous.yml은 본 진단 범위 외 — 미변경.)

---

## 8. 권장 수정 순서 (Phase 20 제안 — 상세는 phase20-plan.md)

**19개 페이즈 이후 코드베이스는 여전히 성숙하나, v15/v16의 3중 대조를 세 번째 등록 표면(이벤트 핸들러)으로 확장한 신선한 재검토에서 실재하는 무위험 actionable 항목 1건(M-1 v17)이 드러났다.** CRITICAL/HIGH 0, MEDIUM 1(FileWatcher 대용량-배치/복구 테스트 공백 — 순수 additive), LOW 7(L-2~L-7 v16 승계 추적/이연 + L-8 신규 추적·비-actionable). 신규 CVE 중 Cynapx 도달 가능 0건, Miasma 신규 변종(GitHub 저장소 침투)도 Cynapx 트리·in-tree 설정 도달 0건. 따라서 Phase 20은 **단일 테스트-only 서브 페이즈(P20-1) + 추적 상태 갱신**이 합리적이다.

1. **P20-1**: M-1 v17 해소 — FileWatcher `flush()` 대용량-배치 경로(대용량 트리거→`syncWithGit` 호출 + 성공 리셋) + 에러-복구 상태머신(실패 재시도, `>= MAX_SYNC_RETRIES(3)` FATAL 강등, `syncFailedCount > 0` 후속 flush git-sync 락인)을 기존 `makePipeline()`/`(watcher as any).flush()` 직접 호출 하니스로 `tests/file-watcher.test.ts`에 추가, CI vitest 게이트로 끌어올림. **대용량 트리거→`syncWithGit` 1회 호출 우선**(분기 명확, mock 최소). **테스트-only, 프로덕션 코드 동작 무변경.** 588 → 신규 케이스 추가로 증가.
2. **추적 상태 갱신**: L-2(Miasma 신규 변종 — GitHub 저장소 침투형 AI-에이전트 설정 주입 인지, in-tree `.claude/` 무결성 점검 추가, Cynapx 도달 0건 불변), L-3(SDK v2 npm 미배포 — 7/28 stable까지 이연), L-6(node-tree-sitter#268 여전히 open), L-7(admin CLI 게이트 공백), L-8(에러-복구/마이그레이션 잔여 분기 — 비-actionable) 현 상태를 다음 사이클 출발점으로 고정.

(L-4 IPC MessagePack 계속 보류, L-5 클러스터링 본격 파티셔닝 계속 이연, MCP 전면 stateless/task 마이그레이션은 SDK v2 npm 배포까지 이연, SCIP export는 P18-1/P19-1로 디딤돌 마련 완료된 전략 후보로 계속 기록만.)
