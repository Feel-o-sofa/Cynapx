# Cynapx 정밀 진단 보고서 v20

- **기준 커밋**: `79ce7ff` (Phase 22 + Phase 22-1 완료, 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-15
- **진단 범위**: src/ 전체(server, db, indexer, graph, watcher, utils, cli, bootstrap) + **그동안 3중-대조 방법론이 디스패처/REST/FileWatcher 분기만 훑느라 한 번도 직접 들여다보지 않은 graph 엔진 *비즈니스 로직*(architecture/optimization/refactoring/remediation/policy-discoverer)**, schema/, scripts/, tests/ 전체, src-native/, Dockerfile, `.github/workflows/ci.yml`, `.claude/launch.json`, package.json/lockfile, README.md + 외부 컨텍스트(CVE/advisory, 공급망 캠페인, MCP 생태계, 경쟁 도구)
- **진단 방법**: 단일 에이전트 오케스트레이션 + 회의적 전수 코드 리뷰 + 로컬 직접 검증(`npx vitest run`[시간 측정 포함], `npx tsc --noEmit`, `npm audit`[dev 포함] 및 `npm audit --omit=dev`, `npm outdated`, `npm ls`로 전이 의존 버전 확인) + **신규 각도: v18~v19가 "L-9 코드 클린업 후보(architecture-engine·update-pipeline·log.error·빈 catch)"를 (b) 잣대로 재판정하며 architecture-engine 1건을 수확(P22-1)했는데, v20은 그 재판정의 사각을 정직하게 짚는다 — 과거 3-way 대조(레지스트리↔테스트↔CI 게이트)는 *도구가 등록됐는지*와 *디스패처가 라우팅·인자검증을 하는지*만 검증했고, 그 도구 뒤의 *엔진 비즈니스 로직 자체*(risk 임계·점수 가중·remediation 분기·dead-code 집계)는 한 번도 게이트에 들어온 적이 없다. v20은 graph/ 엔진 5종을 *실제로 읽고* 테스트-파일 존재 여부와 대조해, P22-1(architecture-engine circular 분기)과 동형의 "라이브 MCP 도구 뒤의 미커버 순수 분기"를 추가로 발굴**한다.
- **현재 상태(직접 검증)**: `npx vitest run` **594/594**(43 파일, **6.87s** — 빠름·추세 무문제), `npx tsc --noEmit` 그린, **`npm audit`(dev 포함) = 0 vulnerabilities**, **`npm audit --omit=dev`(prod) = 0 vulnerabilities**(Phase 14-1/21-1 baseline 유지). diagnostic-v19 전 항목 처리 완료(M-1 v19 [DONE — P22-1]), LOW 7건(L-2~L-8) 승계 추적 + L-9 잔여 클린업 비-actionable 추적.

> **요약**: **v22-1까지 prod 코드는 steady-state(CRITICAL/HIGH 0, prod·dev audit 0/0, TODO 0, god-module 0, 핫패스 quadratic 0)이고, 외부도 신규 prod-도달 CVE 0건(better-sqlite3·chokidar·express·tree-sitter 직접 재확인, MCP SDK v2는 2026-07-28 RC 잠금됐으나 npm 정식 미배포)이다. 그러나 v20은 과거 방법론의 사각을 새 각도로 짚는다: v15~v17의 "3-way 대조(레지스트리↔테스트↔CI 게이트)"는 *도구 등록·디스패처 라우팅·인자검증*만 게이트화했고, P22-1이 architecture-engine의 circular-dependency 분기 1건을 메웠을 뿐, *graph/ 엔진들의 비즈니스 로직 자체*는 여전히 게이트 밖에 있다.** **graph/ 엔진 5종(architecture/optimization/refactoring/remediation/policy-discoverer)을 실제로 읽고 테스트 파일과 대조한 결과 두 건의 actionable이 드러난다.** **신규 M-1 v20: `RemediationEngine.getRemediationStrategy()`(remediation-engine.ts, 113줄)는 *순수 함수*(입력 `ArchitectureViolation` → 출력 `RemediationRecipe`, DB·side-effect 0)인데 7개 분기(insufficient-data / circular-dependency / bottom-up layer / utility→service / repo→repo / god-object / default)가 *전혀 테스트되지 않는다* — `tests/`에 remediation-engine 테스트 파일이 없고, `tests/tool-dispatcher.test.ts`는 `remediationEngine: {} as any`로 stub해 *인자 가드만*(empty args / `violation:{}`) 검증할 뿐 실제 엔진을 한 번도 호출하지 않는다. 이 엔진은 라이브 MCP 도구 `get_remediation_strategy` 뒤에 있다.** **이는 P22-1(architecture-engine circular 분기)과 정확히 동형의 "라이브 도구 뒤 미커버 순수 분기"이고, 순수 함수라 모킹·DB·시그니처 변경이 전혀 없어 (b) 잣대(작고·테스트 동반·저위험)를 가장 깨끗하게 충족한다 → Phase 23-1.** **신규 M-2 v20: `OptimizationEngine.findDeadCode()`(optimization-engine.ts:53)의 `optimizationPotential` 계산이 *빈 그래프에서 division-by-zero*다 — `totalSymbols=0`이면 `(0/0)*100 = NaN` → `"NaN%"` 문자열이 `find_dead_code` 도구 응답에 그대로 나간다. 현 `tests/optimization-engine.test.ts`는 항상 노드를 1개 이상 심은 그래프만 검증해 이 경계를 못 잡는다. 픽스는 ~2줄(`totalSymbols === 0 ? '0.00%' : ...`)이고, 테스트 하니스에 이미 `createInMemoryEngine()`이 있어 빈 그래프 케이스 추가가 즉시 가능 → Phase 23-2.** **나머지 엔진은 깨끗하다: RefactoringEngine은 미커버지만 순수-함수 분기라 후보로 추적(L-10), PolicyDiscoverer는 DB-heavy라 별도 픽스처 필요(L-10 추적), architecture-engine은 P22-1로 커버, graph-engine은 기존 게이트 충실.** **외부 신선 재조사: better-sqlite3 직접 CVE 0건(latest 12.10.0 — lockfile은 12.10.0, npm wanted 12.10.1 minor patch 존재[L-11]), chokidar 5.0.0·express 4.22.x/5.2.x 미해결 취약점 0건, MCP SDK v2는 2026-07-28 RC가 5/21 잠금됐으나(stateless core/Extensions/Tasks/MCP Apps/Multi-Round-Trip) npm 정식은 여전히 1.29.x — stable Q3, v1.x production 권장 불변, Miasma 캠페인 Cynapx 도달 0건 불변.** **CRITICAL 0, HIGH 0, MEDIUM 2(M-1 v20 remediation 순수 분기 게이트 — Phase 23-1; M-2 v20 dead-code NaN% 경계 + 게이트 — Phase 23-2), LOW 10(L-2~L-9 v19 승계 + L-10 엔진 게이트 잔여 + L-11 better-sqlite3 patch 정렬).**

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건(C-1~C-3)은 Phase 13에서, v11 HIGH(N-1 공급망)는 Phase 14-1에서, v12~v18 MEDIUM은 Phase 15~21에서, v19 MEDIUM(M-1 v19 architecture-engine O(E)→O(1) + circular 분기 게이트)은 Phase 22-1에서 해소됐고, 본 전수 재열람에서 새로운 CRITICAL/HIGH는 발견되지 않았다. IPC 핸드셰이크(random challenge + `HMAC-SHA256(nonce, challenge)` + `timingSafeEqual`), API Bearer(SHA-256 후 `timingSafeEqual`), 세션 맵(TTL+cap+sweep unref) 모두 견고(직접 재열람 확인).

---

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** 코드·공급망 어디에서도 신규 HIGH는 발견되지 않았다. **prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0 vulnerabilities**(직접 재검증, 6.1 참조). M-1 v20(remediation 순수 분기 게이트)·M-2 v20(dead-code NaN% 경계)은 보안·크래시 결함이 아니라 *게이트 격차 + 표시-품질 경계 버그*이므로 MEDIUM이다(NaN%는 도구 응답에 부정확한 문자열이 나가나 크래시·데이터 손상 아님). 외부 공급망 사건(Miasma, 6.3)도 Cynapx 의존 트리·in-tree 설정에 도달하지 않으므로 LOW(L-2)로 다룬다.

---

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

| # | 위치 | 내용 |
|---|------|------|
| **M-1 v20** *(신규, actionable — 작고·테스트 동반·저위험. 라이브 MCP 도구 뒤 미커버 순수 분기)* | `src/graph/remediation-engine.ts` (`getRemediationStrategy()`, 7 분기), `tests/` (remediation-engine 테스트 파일 부재), `tests/tool-dispatcher.test.ts:66`(`remediationEngine: {} as any` stub) | **`RemediationEngine.getRemediationStrategy()`의 7개 순수 분기에 회귀 게이트 추가.** 과거 3-way 대조(v15~v17)는 *도구 등록·디스패처 라우팅·인자검증*만 게이트화했다. 이 엔진은 라이브 MCP 도구 `get_remediation_strategy`(`tools/get-remediation-strategy.ts` → `_registry.ts:38`) 뒤에 있으나, **엔진 자체는 한 번도 호출되지 않는다**: `tests/`에 remediation-engine 테스트 파일이 없고, `tests/tool-dispatcher.test.ts`는 `remediationEngine: {} as any`로 엔진을 stub한 뒤 *인자 가드만*(`{}` → "Missing required argument", `{violation:{}}` → "Invalid violation object")을 검증한다(line 459-469). 즉 `getRemediationStrategy()`의 분기 로직(insufficient-data / circular-dependency / bottom-up layer:api←core/data / utility→service|repository / repo→repo / god-object[cyclomatic>30 \|\| loc>500] / default)은 **0% 커버**. **(b) 잣대 완벽 충족**: (1) 순수 함수 — 입력 `ArchitectureViolation` 리터럴 → 출력 `RemediationRecipe`, DB·worker·side-effect·async 전혀 없음 → 모킹·픽스처 0; (2) 시그니처·public API·반환 형태 *전혀 안 건드림* — 테스트 추가만; (3) P22-1(architecture-engine circular 분기)과 정확히 동형의 "라이브 도구 뒤 미커버 순수 분기 게이트 메우기". **verdict: actionable — Phase 23-1.** 각 분기에 대표 violation 리터럴을 넣어 `strategy`/`steps[0]`를 단언하는 테이블-드리븐 `it` 7개를 `tests/remediation-engine.test.ts`에 신규. (5장·6.5 상세) |
| **M-2 v20** *(신규, actionable — 작고·테스트 동반·저위험. 경계 버그 + 게이트)* | `src/graph/optimization-engine.ts:53` (`optimizationPotential` 계산), `tests/optimization-engine.test.ts` (빈-그래프 경계 미커버) | **`OptimizationEngine.findDeadCode()`의 빈-그래프 division-by-zero(`"NaN%"`) 픽스 + 경계 회귀 테스트.** line 53: `optimizationPotential: \`${(((highRows.length + mediumRows.length + lowRows.length) / totalSymbols) * 100).toFixed(2)}%\``. **`totalSymbols`는 line 40에서 `SELECT COUNT(*) FROM nodes`로 구하므로 *빈 그래프에서 0*이고, `0/0 = NaN` → `NaN.toFixed(2) = "NaN"` → `optimizationPotential: "NaN%"`가 `find_dead_code` 도구 응답(`tools/find-dead-code.ts`)에 그대로 나간다.** 크래시는 아니나 도구 응답의 표시-품질 경계 버그(빈/초기 그래프 또는 인덱싱 직후에 발생 가능). 현 `tests/optimization-engine.test.ts`(line 53~)는 `beforeEach`에서 `createInMemoryEngine()`을 만든 뒤 *항상 `makeNode()`로 노드를 1개 이상 심은* 그래프만 검증(line 64-95)해 이 경계를 못 잡는다. **(b) 잣대 충족**: (1) 픽스 ~2줄(`const pct = totalSymbols === 0 ? '0.00%' : (((...) / totalSymbols) * 100).toFixed(2); optimizationPotential: \`${pct}%\``) — 동작은 비-빈 그래프에서 완전 동일(0 분기만 가드), 시그니처·반환 형태 무변경; (2) 테스트 하니스에 이미 `createInMemoryEngine()`이 있어 *노드를 안 심은* 빈 그래프로 `findDeadCode()` 호출 → `summary.optimizationPotential === '0.00%'`·`deadSymbols === 0` 단언이 즉시 가능; (3) 미커버 경계 게이트 메우기. **verdict: actionable — Phase 23-2.** (5장 상세) |

> **참고**: v19는 L-9 코드 클린업 3건을 (b) 잣대로 재판정해 architecture-engine 1건을 수확(P22-1)했다. v20은 그 재판정의 *사각*을 새 각도로 짚었다 — 과거 3-way 대조는 도구 등록·디스패처 라우팅까지만 게이트화했고, *엔진 비즈니스 로직 자체*는 P22-1(architecture-engine circular 분기) 외엔 게이트 밖이었다. graph/ 엔진 5종을 실제로 읽고 테스트 파일과 대조해 P22-1과 동형의 "라이브 도구 뒤 미커버 순수 분기" 2건(remediation 7분기·dead-code 경계)을 발굴했다. 둘 다 순수/경계 변경이라 (b) 잣대를 깨끗이 넘는다. RefactoringEngine·PolicyDiscoverer는 각각 후보로 추적(L-10).

---

## 4. 최적화 (LOW) — 추적/이연 (v19 승계 8건 + L-10 엔진 게이트 잔여 + L-11 patch 정렬)

| # | 위치 | 내용 |
|---|------|------|
| L-2(v20) | `package.json` (native deps), CI / Dockerfile, `.claude/`·`.cursor/`·`.gemini/` 설정 | **Miasma / Phantom Gyp 공급망 캠페인 포스처 추적 — Cynapx 도달 0건 불변.** 진단 일자 직접 재대조: 컴프로마이즈 패키지 패밀리 전부 Cynapx 트리 "not in tree"(`npm ls`), native 의존(better-sqlite3 12.10.0 + tree-sitter 0.25.0 코어 + 12 grammar) 무관·악성 버전 미발행, Cynapx in-tree 에이전트 설정은 `.claude/launch.json` 1개뿐(프로젝트 자체 bootstrap 기동 양성 — SessionStart 훅·`setup.mjs`·원격 페이로드 없음), `.cursor`/`.gemini` 부재. better-sqlite3가 Snyk에서 "Node-gyp Supply Chain Compromise June 2026" 패밀리에 거론되나 *직접 CVE는 0건*이고 Cynapx 핀 버전은 악성 미발행. CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지 1차 방어선 유지. **즉각 조치 불필요 — 추적만.** 출처: [Snyk better-sqlite3](https://security.snyk.io/package/npm/better-sqlite3), [Wiz: Miasma RedHat](https://www.wiz.io/blog/miasma-supply-chain-attack-targeting-redhat-npm-packages) |
| L-3(v20) | `src/server/api-server.ts` (session-id StreamableHTTP) | MCP stateless transport 충돌 표면 — SDK v2 업그레이드 시 회귀 표면. **SDK v2 = 2026-07-28 RC가 5/21 잠금됐으나 npm 정식 미배포**(npm `latest`=1.29.x — `npm view` 직접 확인, 2.x dist-tag 0건) → **계속 이연**. RC는 stateless protocol core(SEP-2567 `Mcp-Session-Id` 제거 + SEP-2575 initialize 핸드셰이크 제거, 값이 매 요청 `_meta`로 이동) + Extensions/Tasks/MCP Apps + Multi-Round-Trip(server-initiated sampling/elicitation 대체)을 담는다. **stable은 Q3 2026(스펙 publish 7-28), v1.x는 production 권장 유지.** P15-3 `handleMcp()` 설계 메모가 출발점. **상태 갱신(RC 잠금) — 계속 이연** |
| L-4(v20) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환(v8→v20 이월). **성능 문제 미관측 — verdict: 계속 보류.** 메시지가 작고 round-trip이 드물어 직렬화가 병목 아님 |
| L-5(v20) | `src/graph/graph-engine.ts` | 클러스터링 본격 서브그래프 파티셔닝 — 100k+ 노드 실측 시 재검토(**계속 이연**). `performClustering()`는 LPA O(V+E)/반복·`MAX_ITER=20` 캡, count-first 가드(`DEFAULT_CLUSTER_MAX_NODES=200000`)·Fisher-Yates seeded PRNG(`mulberry32`) 직접 재확인 — OOM/편향 방어 정상 |
| L-6(v20) | CI / Dockerfile | Node 24 + tree-sitter 0.25.x 빌드 fragility(C++20/prebuild 부재) — [node-tree-sitter#268] 진단 일자 여전히 open·미해결(CVE 아님, 빌드 fragility). CI Node 22/24 매트릭스 그린이나 Node 24 LTS 전환 전 prebuild 재확인 필요. **추적만** |
| L-7(v20) | `src/cli/admin.ts` (cmd* 9개), `tests/admin-cli.test.ts` | **admin CLI 명령 동작의 vitest 게이트 공백 — 비-actionable 추적.** 등록 명령 9개 `cmd*` 함수는 모듈-private(미-export)이라 vitest 직접 호출 불가, 현 테스트는 *기반 프리미티브*(LockManager·VACUUM INTO·AuditLogger)만 검증. `cmd*` 테스트는 광범위 모킹 또는 export 리팩터 수반 → 프로덕션 시그니처 변경. **admin.ts 핸들러 export 리팩터 시 함께 게이트화 후보** |
| L-8(v20) | `src/indexer/worker-pool.ts`, `src/indexer/embedding-manager.ts`, `src/db/database.ts` | **에러-복구·마이그레이션 잔여 분기의 vitest 게이트 공백 — 비-actionable 추적.** worker `worker.on('error')`·queue backpressure 거부·embedding A-7 stale supersedence 레이스·DB migration 0→1/2→3는 직접 미검증이나 인접 분기 커버 + 마이그레이션 idempotent + A-7 타이밍-flaky 위험. **SCHEMA_VERSION 증분/worker-pool 리팩터 시 함께 게이트화** |
| L-9(v20) | `src/indexer/update-pipeline.ts` (트랜잭션 보일러플레이트·progress `log.error`), `src/indexer/embedding-manager.ts:184` / `src/server/api-server.ts:625` (빈 catch) | **L-9 코드 클린업 잔여 — (b) 잣대 미충족, 비-actionable 추적 유지.** (b1) `withWriteTransaction()` 추출(~40줄)은 트랜잭션 경계 5곳 전부 재작성이라 회귀 표면 넓음; (b2) progress `log.error` 재분류는 관측 동작 변경 + brittle 로그 단언; (b3) 빈 catch 2건은 silent-drop이 의도적 방어. **update-pipeline/사이드카 리팩터 페이즈로 묶어 처리 후보** |
| **L-10(v20)** *(신규 — 엔진 게이트 잔여)* | `src/graph/refactoring-engine.ts`(`getRiskProfile`/`proposeRefactor`), `src/graph/policy-discoverer.ts`(`discoverPolicies`) | **RefactoringEngine·PolicyDiscoverer 엔진 로직 게이트 공백 — 추적, 다음 사이클 후보.** v20이 graph/ 엔진 5종을 대조한 결과 M-1(remediation)·M-2(optimization 경계) 외에 두 엔진이 추가로 미커버: **(a) RefactoringEngine** — `getRiskProfile()`(churn 0.4/complexity 0.3/coupling 0.3 가중 → CRITICAL>0.8/HIGH>0.5/MEDIUM>0.2 임계)·`proposeRefactor()`(risk 임계 + reasons/steps 생성)는 라이브 도구 `get_risk_profile`/`propose_refactor` 뒤에 있고 *대체로 순수*(단 `proposeRefactor`는 `graphEngine.traverse()` BFS 호출이라 그래프 픽스처 필요 — `getRiskProfile`은 `getNodeByQualifiedName` 1회 룩업이라 stub 용이). 다음 사이클 후보로 **M-1/M-2와 같은 패턴이나 본 사이클은 가장 깨끗한 2건만**(범위 절제). **(b) PolicyDiscoverer** — `discoverPolicies(threshold, minCount)`는 DB-heavy(노드/엣지/태그 집계)라 in-memory 그래프 픽스처 + 다수 노드 셋업 필요 → 게이트 가치는 있으나 (b) "작은 변경" 잣대엔 다소 무거움. **verdict: 추적 — Phase 23-3 또는 다음 사이클에서 RefactoringEngine `getRiskProfile` 우선 게이트화 후보** |
| **L-11(v20)** *(신규 — patch 정렬)* | `package-lock.json` (better-sqlite3 12.10.0) | **better-sqlite3 lockfile 12.10.0 → npm wanted 12.10.1 minor patch 정렬 후보 — 비-긴급.** `npm outdated` 직접 확인: lockfile은 `12.10.0`인데 semver range `^12.0.0`의 wanted/latest는 `12.10.1`. *직접 CVE는 0건*(audit 0/0)이라 보안 긴급은 아니나, 다음 정기 의존성 갱신 시 `npm update better-sqlite3`로 12.10.1에 정렬하면 lockfile drift 해소. **추적 — 다음 정기 갱신 시 정렬(prod 코드 무관, lockfile-only)** |

> **신규 LOW 부재 안내(prod 코드 동작 변경 항목)**: M-1 v20(remediation 게이트, 테스트-only)·M-2 v20(dead-code NaN% 경계, ~2줄 가드)을 제외하면 prod 코드 *동작* 변경을 요하는 신규 LOW는 0건이다. tree-sitter 코어 0.25.0·tree-sitter-c-sharp 0.23.1 정확 핀 롤백 유지가 여전히 옳다(0.23.6 ERR_REQUIRE_ASYNC_MODULE 해소 신버전 없음). L-11은 lockfile-only 정렬이라 prod 동작 무관.

---

## 5. 코드 품질 / 성능 전수 (graph/ 엔진 비즈니스 로직 신규 대조 + steady-state 재확인)

v19까지의 3-way 대조는 디스패처/REST/FileWatcher 분기를 훑었고 P22-1이 architecture-engine circular 분기를 메웠다. v20은 **그동안 게이트가 닿지 않은 graph/ 엔진 비즈니스 로직 5종을 실제로 읽고 테스트 파일과 대조**했다.

**(1) graph/ 엔진 ×테스트 파일 대조 (신규 각도)**

| 엔진 | 테스트 파일 | 라이브 도구 | 로직 커버 | 판정 |
|------|-------------|------------|-----------|------|
| `architecture-engine.ts` | `architecture-engine.test.ts` | `check_architecture_violations` | custom-rule + (P22-1로) circular 분기 | 커버 — P22-1 |
| `optimization-engine.ts` | `optimization-engine.test.ts` | `find_dead_code` | dead-code 티어 분류는 커버, **빈-그래프 `optimizationPotential` 경계 미커버 → `"NaN%"`** | **M-2 v20 [DONE — Phase 23-2]** (가드 ~2줄 + 빈-그래프 경계 테스트) |
| `remediation-engine.ts` | `remediation-engine.test.ts` | `get_remediation_strategy` | **7 분기 0% — 디스패처 테스트는 `{} as any` stub로 인자 가드만** | **M-1 v20 [DONE — Phase 23-1]** (`tests/remediation-engine.test.ts` 신규, 7분기 게이트) |
| `refactoring-engine.ts` | `refactoring-engine.test.ts` | `get_risk_profile`/`propose_refactor` | `getRiskProfile()` 임계·가중 게이트 완료 (Phase 23-3); `proposeRefactor()` reasons/steps는 잔여 | **L-10 부분 해소 — Phase 23-3** (`getRiskProfile()` gated; `proposeRefactor()`/PolicyDiscoverer는 다음 사이클) |
| `policy-discoverer.ts` | **없음** | `discover_policies` | DB-heavy 집계 0% | L-10 추적(픽스처 무거움) |

핵심: 과거 3-way 대조는 "도구가 등록됐는가·디스패처가 라우팅/인자검증을 하는가"까지만 게이트화했고, *엔진 비즈니스 로직 자체*는 architecture/optimization 외엔 게이트 밖이었다. M-1(remediation 순수 7분기)·M-2(optimization 경계)는 P22-1과 동형의 "라이브 도구 뒤 미커버 순수/경계 분기"이며, 순수/경계라 (b) 잣대를 깨끗이 넘는다.

**(2) prod steady-state 재확인 — 신규 prod 코드 결함 0**

| 항목 | 판정 |
|------|------|
| god-module / 순환 import | 0 — `openapi.ts`(881, 정적 스키마 리터럴)·`update-pipeline.ts`(591)·`graph-engine.ts`(675) 응집 불변. repos→engines→server/pipeline 단방향 |
| TODO/FIXME/XXX/HACK | 0건(`src/` 전수 — 기술부채 코멘트 미축적) |
| 핫패스 O(n²)-over-nodes | 0 — 클러스터링 count-first 가드(200k)+Fisher-Yates seeded PRNG, BFS index-pointer 큐, 반복 DFS+60s 캐시, P22-1 architecture-engine O(1) Map 직접 재확인 |
| prod·dev audit | 0 / 0 vulnerabilities |
| 테스트 시간 | `npx vitest run` **6.87s/594케이스/43파일**(직접 측정) — 추세 무문제 |

**(3) 에러 핸들링 일관성 — 양호, 미세 항목은 L-9 잔여로 추적**

`Logger`(stderr-only, MCP stdio 안전)는 `normalizeData()`로 Error 객체 언랩. update-pipeline catch는 일관되게 log-and-rethrow + 트랜잭션 롤백 선행. 미세 항목(progress log.error·빈 catch 2건)은 L-9 비-actionable 추적. **신규: `findDeadCode()`의 `NaN%`는 에러가 아니라 *경계 계산 누락*이라 M-2로 actionable화**(가드 ~2줄).

**(4) 그 외 — 공백 없음**

도구 디스패처 20/20(P18-1)·REST 핸들러(P19-1)·FileWatcher 대용량-배치/복구(P20-1)·architecture-engine circular 분기(P22-1)·lock 경합·IPC e2e+인증·git 이력 재작성·임베딩 프로토콜·CrossProjectResolver·클러스터링 결정성+count-first·MCP progress·YAML 견고성이 이미 게이트 커버. **remediation/optimization 엔진 로직만 신규 게이트 격차(M-1/M-2로 메움), refactoring/policy-discoverer는 L-10 추적.**

---

## 6. 외부 컨텍스트 (웹 조사 — 진단 일자 재실행, 출처 명시)

### 6.1 의존성 취약점 (진단 일자 직접 재검증 — prod·dev 둘 다 clean)

- **`npm audit`(dev 포함) = 0 + `npm audit --omit=dev`(prod) = 0 vulnerabilities**(둘 다 직접 실행). Phase 21-1 postcss override가 dev 트리도 clean 유지(`overrides.postcss ^8.5.10`).
- **`npm outdated`(직접 실행)**: prod 코드 *동작* 변경을 요하는 긴급 업그레이드는 0건. 정렬 후보만: `better-sqlite3` lockfile 12.10.0 → wanted 12.10.1(L-11, lockfile-only), `tree-sitter-c-sharp` 0.23.1 핀(0.23.5 latest이나 0.23.6 ERR_REQUIRE_ASYNC_MODULE 미해소 → 핀 유지가 옳음), `express`/`commander`/`typescript`/`@types/*` major(5.x/15/6 — 비-긴급 major, breaking-change 검토 필요해 즉시 비권장), `zod` 4.3.6→4.4.3·`vitest` 4.1.2→4.1.8(dev, 다음 갱신 시 정렬).
- **`overrides`**: `tree-sitter ^0.25.0` / `fast-uri ^3.1.2`(CVE-2026-6321/6322 해소) / `qs ^6.15.2` / `hono ^4.12.21` / `postcss ^8.5.10` 전부 유효.
- **better-sqlite3 / chokidar / express / tree-sitter 직접 재확인(웹)**: better-sqlite3 직접 CVE 0건(latest 12.10.0, 단 "Node-gyp Supply Chain June 2026" 패밀리 거론 — Cynapx 핀은 악성 미발행), chokidar 5.0.0 non-vulnerable, express 4.22.x/5.2.x non-vulnerable(최근 CVE-2024-9266 open-redirect는 구버전), sqlite-vec 0.1.9 / js-yaml 4.x / commander 14 / simple-git 3.36 / ignore 7 / zod 4.x 미해결 공개 취약점 미발견. 출처: [Snyk better-sqlite3](https://security.snyk.io/package/npm/better-sqlite3), [Snyk chokidar](https://security.snyk.io/package/npm/chokidar), [Snyk express](https://security.snyk.io/package/npm/express)

### 6.2 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"` + Docker `node:22-bookworm-slim`. Node 22 LTS 유지 2027-04 종료 — 여유. CI Node 22/24 매트릭스 그린(594/594). Node 24 + tree-sitter 0.25.x는 [node-tree-sitter#268](https://github.com/tree-sitter/node-tree-sitter/issues/268)(여전히 open·미해결)의 fragility(L-6). README는 P21-2로 "Node.js ≥ 22"와 일치.
- **tree-sitter 코어**: npm `latest`=0.25.0. 12 grammar 전부 dedupe/override. **tree-sitter-c-sharp**: 0.23.1 정확 핀 롤백 유지(0.23.6 미배포 → ERR_REQUIRE_ASYNC_MODULE 해소 신버전 없음).
- **better-sqlite3**: 12.10.0 핀(SQLite 3.53.x), npm wanted 12.10.1(L-11 minor patch — 다음 정기 갱신 시 정렬).

### 6.3 공급망 캠페인 — Miasma / Phantom Gyp (계속 진행 중, Cynapx 도달 0건 불변)

- 진단 일자 직접 재대조: Miasma(Mini Shai-Hulud 기반 자가전파 워름)는 6/1 @redhat-cloud-services → 6/3-4 Phantom Gyp binding.gyp wave → 6/5 Microsoft 73 저장소(+ `.claude/setup.mjs`·`.cursor/rules`·`.gemini` AI-에이전트 설정 주입 변종)로 48~72h마다 피벗하며 지속 중. **본 사이클 재대조: (a) 컴프로마이즈 패밀리 전부 Cynapx 트리 "not in tree"(`npm ls`), native 의존 무관·악성 버전 미발행, (b) in-tree 설정은 `.claude/launch.json` 1개(양성), `.cursor`/`.gemini` 부재.** CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지. **즉각 변경 불필요, 포스처 추적.** 출처: [Wiz: Miasma RedHat](https://www.wiz.io/blog/miasma-supply-chain-attack-targeting-redhat-npm-packages), [StepSecurity: Phantom Gyp binding.gyp worm](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm)

### 6.4 MCP 생태계 — 2026-07-28 RC 잠금(5/21)됐으나 npm 정식 미배포 (상태 갱신)

- **MCP 스펙 2026-07-28 RC가 5/21 잠금**(직접 확인): stateless protocol core(SEP-2567 `Mcp-Session-Id` 제거 + SEP-2575 initialize/initialized 핸드셰이크 제거 — 값이 매 요청 `_meta`로 이동) + Extensions 프레임워크(Tasks, MCP Apps) + Multi-Round-Trip Requests(`InputRequiredResult`+`requestState`로 server-initiated sampling/elicitation 대체 — stateless 적합) + authorization hardening + 정식 deprecation 정책. **TS SDK는 `sessionIdGenerator: undefined`로 stateless 모드 설정 가능**(resumability 미지원). **그러나 npm `latest`는 여전히 1.29.x이고 2.x dist-tag는 0건** — stable은 Q3 2026(스펙 publish 7-28), **v1.x가 production 권장 유지**. → P15-3 stateless transport + task extension 마이그레이션(L-3)은 npm 정식 배포까지 착수 불가. progress-token opt-in(P14-5) 현행 정상. 출처: [MCP Blog: 2026-07-28 RC](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/), [MCP TS SDK v2 docs](https://ts.sdk.modelcontextprotocol.io/v2/)
- **함의**: Cynapx의 현 StreamableHTTP(session-id 기반)는 RC의 stateless core와 충돌 표면이 있으나, *마이그레이션은 npm 정식 배포까지 이연*이 옳다. RC의 **MCP Apps(sandboxed iframe UI 리소스)·Multi-Round-Trip(elicitation)** 은 Cynapx의 read-mostly 코드-그래프 도구 모델과 직접 충돌하지 않아 즉시 채택 압력 없음.

### 6.5 경쟁/인접 도구 동향 (v19 승계 — 전략 추적 + 엔진 로직 품질 함의)

- **로컬-퍼스트 코드 그래프 카테고리 성숙 지속**: Serena(LSP-over-MCP)·CodeGraph·GitNexus 등이 심볼-레벨 표준의 사실상 기본값. Cynapx의 "100% 로컬·격리·멀티프로세스 보안 IPC + risk/remediation/refactoring 처방 엔진" 포지션이 차별점이다. **함의: 그 처방 엔진들(remediation/refactoring)이 Cynapx 고유 가치인데 정작 게이트 밖이었다 — M-1 v20/L-10이 그 격차를 메우기 시작하는 게 차별 가치의 회귀 안전망 강화로 직결.**
- **SCIP가 LSIF 대체 심볼 인덱스 표준으로 정착** — `export_graph`(json/graphml/dot)에 SCIP 추가는 미래 상호운용 후보. MCP `export_graph`(P18-1)·REST `/api/graph/export`(P19-1) 디딤돌 마련 완료. protobuf 의존 + install-time 표면 확대 우려로 즉시 비권장 — 전략 후보 유지.
- **함의**: (1) 공급망 위생 유지(+ in-tree 에이전트 설정 무결성 + dev 트리 audit 위생), (2) 생태계 스펙 추적(MCP SDK v2 — Q3 stable까지 대기), (3) **회귀 안전망을 도구 *뒤 엔진 로직*까지 확장**(M-1/M-2/L-10), (4) 문서 위생이 신뢰성 차별화 축이다.

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 정밀 재열람에서 신규 prod 코드 결함이 없었다(M-1/M-2 v20은 미커버 순수 분기 게이트 + 경계 가드로 actionable):

- `src/watcher/file-watcher.ts` — chokidar `ignored` 프레디킷·확장자 allowlist·flush 동시성·타이머 위생·대용량-배치 git-sync 라우팅·재시도/FATAL 강등(P20-1 게이트) 정상.
- `src/graph/graph-engine.ts` — Fisher-Yates + seeded PRNG 결정성 + count-first 가드(200k) + BFS index-pointer 큐·반복 DFS 모두 O(V+E), 핫패스 quadratic 없음.
- `src/graph/architecture-engine.ts` — checkViolations O(E)·detectCycles 반복 DFS+60s 캐시 정상, **circular 분기 P22-1 O(1) Map + 게이트 커버**(직접 재확인).
- `src/graph/optimization-engine.ts` — dead-code 티어 분류(high/medium/low, node_tags JOIN) 정상. **단 빈-그래프 `optimizationPotential` division-by-zero(`"NaN%"`)가 M-2 v20 대상.**
- `src/graph/remediation-engine.ts` — `getRemediationStrategy()` 7 분기 로직 자체는 합리적(insufficient-data 가드·DIP/이벤트 처방). **단 7 분기 전부 vitest 미커버가 M-1 v20 대상**(순수 함수라 게이트화 깨끗).
- `src/graph/refactoring-engine.ts` / `policy-discoverer.ts` — 로직 합리적이나 vitest 미커버(L-10 추적 — RefactoringEngine `getRiskProfile`이 가장 깨끗한 다음 후보).
- `src/indexer/update-pipeline.ts` — 단일 책임 응집·catch log-and-rethrow+롤백·원본 에러 보존 정상(트랜잭션 dedup·progress log.error만 L-9 비-actionable).
- `src/server/openapi.ts` — 정적 OpenAPI 스키마 리터럴(로직 0), 분해 불요.
- `src/server/api-server.ts` — 세션 TTL/cap/sweep(unref)·timing-safe Bearer·8 REST 핸들러 supertest 게이트(P19-1)·rate-limit 양호(`.port` 빈 catch만 L-9 미세).
- `src/server/ipc-coordinator.ts` — challenge-response 인증·1MB 바이트 제한·per-tool 타임아웃·keepalive(unref)·pending reject-on-close 견고.
- `src/server/tool-dispatcher.ts` — Terminal 포워딩·waitUntilReady·registry lookup·EngineNotReadyError 재시도 변환 견고. 20/20 게이트(P18-1). **단 엔진 stub(`remediationEngine: {} as any`)이라 엔진 로직 자체는 디스패처 게이트 밖 — M-1 v20이 별도 엔진 테스트로 메움.**
- `src/indexer/worker-pool.ts` / `embedding-manager.ts` / `database.ts` — double-settle 가드·A-7 discipline·1→2 마이그레이션 명시 커버 견고(잔여 분기만 L-8).
- `package.json` overrides — tree-sitter `^0.25.0`·fast-uri `^3.1.2`·qs `^6.15.2`·hono `^4.12.21`·postcss `^8.5.10` 충족, dev·prod audit 0/0.
- `README.md` — P21-2로 Node ≥ 22·export_graph·REST API 8 라우트 동기화 완료.
- `.claude/launch.json` — 프로젝트 자체 bootstrap 기동용 양성 launch, `.cursor`/`.gemini` 부재.
- `.github/workflows/ci.yml` — Node 22/24 매트릭스 + `npm audit --omit=dev --audit-level=high` 게이트(P14-1) + `npm ci`. (cynapx-autonomous.yml은 본 진단 범위 외 — 미변경.)
- TODO/FIXME/XXX/HACK 코멘트 = 0건(`src/` 전수).

---

## 8. 권장 수정 순서 (Phase 23 제안 — 상세는 phase23-plan.md)

**22 페이즈 이후 prod 코드는 steady-state(CRITICAL/HIGH 0, prod·dev audit 0/0, TODO 0, god-module 0, 핫패스 quadratic 0)이고 신규 prod-도달 CVE도 0건이나, v20은 과거 3-way 대조의 사각을 새 각도로 짚어 — graph/ 엔진 비즈니스 로직 5종을 *실제로 읽고* 테스트 파일과 대조해 — P22-1(architecture-engine circular 분기)과 동형의 "라이브 MCP 도구 뒤 미커버 순수/경계 분기" 2건을 발굴했다.** CRITICAL/HIGH 0, MEDIUM 2(M-1 v20 remediation 7 순수 분기 게이트 — 작고·테스트 동반·저위험; M-2 v20 dead-code NaN% 경계 + 게이트 — ~2줄 가드+경계 테스트), LOW 10(L-2~L-9 v19 승계 + L-10 엔진 게이트 잔여 + L-11 better-sqlite3 patch 정렬). 따라서 Phase 23은 **엔진-로직 게이트 2 서브 페이즈(P23-1·P23-2) + 선택적 P23-3(L-10 RefactoringEngine) + 추적 갱신**이 합리적이다.

1. **P23-1 [DONE]**: M-1 v20 해소 — `tests/remediation-engine.test.ts` 신규로 `getRemediationStrategy()`의 7 순수 분기(insufficient-data/circular/bottom-up/utility/repo-repo/god-object/default)를 테이블-드리븐으로 게이트화. **prod 코드 무변경(테스트-only), 순수 함수라 모킹·픽스처 0.** (vitest 603 그린)
2. **P23-2 [DONE]**: M-2 v20 해소 — `optimization-engine.ts`의 빈-그래프 division-by-zero를 `totalSymbols === 0 ? '0.00%'` 가드로 픽스(~2줄, 비-빈 그래프 동작 동일) + `tests/optimization-engine.test.ts`에 빈-그래프 경계 케이스 추가(`createInMemoryEngine()`만으로 노드 0개 → `optimizationPotential === '0.00%'` 단언).
3. **(선택) P23-3**: L-10 부분 해소 — `tests/refactoring-engine.test.ts` 신규로 `getRiskProfile()`의 risk 임계·가중(churn/complexity/coupling → CRITICAL/HIGH/MEDIUM/LOW)을 게이트화(stub `getNodeByQualifiedName` 1회 룩업이라 픽스처 가벼움). `proposeRefactor`(BFS traverse)는 무거우니 다음 사이클.
4. **추적 상태 갱신**: L-2(Miasma 도달 0 불변), L-3(SDK v2 2026-07-28 RC 잠금·npm 미배포 — Q3 stable까지 이연), L-6(node-tree-sitter#268 open), L-7/L-8(게이트 공백 비-actionable), L-9 잔여 클린업, L-10(엔진 게이트 잔여), L-11(better-sqlite3 12.10.1 정렬) 현 상태를 다음 사이클 출발점으로 고정.

(L-4 IPC MessagePack 계속 보류, L-5 클러스터링 본격 파티셔닝 계속 이연, MCP 전면 stateless/task 마이그레이션은 SDK v2 npm 배포까지 이연, SCIP export는 디딤돌 마련된 전략 후보로 계속 기록만.)
