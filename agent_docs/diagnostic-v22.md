# Cynapx 정밀 진단 보고서 v22

- **기준 커밋**: `1de6f09` (Phase 24 + Phase 24-1/24-2 완료, 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-15
- **진단 범위**: src/ 전체(server, db, indexer, graph, watcher, utils, cli, bootstrap) + **v21이 명시적으로 다음 사이클로 이연한 두 후보의 재판정**: (1) `RefactoringEngine.proposeRefactor()`(L-10 잔여) — P24-1이 `tests/policy-discoverer.test.ts`에서 `edgeRepo.createEdge()` 엣지-셋업 패턴을 확립한 지금, 그래프 픽스처가 v20/v21 평가보다 가벼워졌는지 실측; (2) M-2 v21 "핸들러 검증 인자명 vs 엔진 호출 인자명" 대조를 **20개 등록 도구 전부에 체계적으로 적용** — 다른 dead-validation/미검증-인자 불일치가 있는지 — + 그 도구 핸들러 전수 + schema/, scripts/, tests/, package.json/lockfile, README.md / README_KR.md / GUIDE_EN.md / GUIDE_KR.md 문서 동기화 + 외부 컨텍스트(CVE/advisory, 공급망 캠페인, MCP SDK v2 npm 배포 상태, 경쟁/인접 도구)
- **진단 방법**: 단일 에이전트 오케스트레이션 + 회의적 전수 코드 리뷰 + 로컬 직접 검증(`npx vitest run`[시간·케이스 수 측정], `npx tsc --noEmit`, `npm audit`[dev 포함]·`npm audit --omit=dev`, `npm outdated`로 버전 드리프트 확인) + **신규 각도 2종: (1) v21이 "`proposeRefactor()`는 incoming 의존 트리를 엣지로 심어야 risk/impact가 의미 있어 그래프 픽스처가 더 무겁다"며 L-10 잔여로 축소-추적했는데, v22는 *P24-1이 `tests/policy-discoverer.test.ts`에서 이미 `createInMemoryEngine()` + `edgeRepo.createEdge()`로 엣지를 심는 패턴을 확립*했으므로 — 그리고 `refactoring-engine.test.ts` 자체가 이미 그 하니스(`edgeRepo` 포함)를 들고 있으므로 — *그 이연 판정이 여전히 옳은지*를 실측 재검증한다. (2) M-2 v21의 "핸들러 검증 인자명 ≠ 엔진 호출 인자명" 대조를 *한 도구(`discover_latent_policies`)에만 적용*했는데, v22는 이를 *20개 등록 도구 전부*에 전수 적용해 다른 같은-부류 버그(dead-validation, 또는 그 역(逆)인 schema-required-but-unvalidated)를 찾는다.** + 외부 웹 재조사(better-sqlite3·MCP SDK v2 npm 배포 상태·공급망 캠페인·경쟁 도구)
- **현재 상태(직접 검증)**: `npx vitest run` **618/618**(46 파일, **6.72s** — 594→6.9s 대비 케이스 +24·시간 -0.2s, 추세 무문제), `npx tsc --noEmit` 그린, **`npm audit`(dev 포함) = 0 vulnerabilities**, **`npm audit --omit=dev`(prod) = 0 vulnerabilities**. diagnostic-v21 전 항목 처리 완료(M-1 v21 [DONE — P24-1], M-2 v21 [DONE — P24-1], L-12 [DONE — P24-2]), LOW 승계 추적.

> **요약**: **Phase 24까지 prod 코드는 steady-state(CRITICAL/HIGH 0, prod·dev audit 0/0, TODO 0, god-module 0, 핫패스 quadratic 0)이고, 외부도 신규 prod-도달 CVE 0건(better-sqlite3·chokidar·express·tree-sitter 직접 재확인)이다.** **v22는 v21이 *명시적으로 다음 사이클로 이연한* 두 후보를 재판정해 두 건의 actionable을 드러낸다.** **신규 M-1 v22: `RefactoringEngine.proposeRefactor()`(refactoring-engine.ts, 64-85줄 + private `calculateRisk`/`getRiskReasons`/`generateSteps` 87-128줄)는 라이브 MCP 도구 `propose_refactor` 뒤에 있으나 *0% 커버* — `tests/refactoring-engine.test.ts`는 `getRiskProfile()`만(P23-3) 게이트하고 `proposeRefactor()`(BFS traverse + risk 3-임계 + reasons 6-분기 + steps risk-별 분기)는 명시적으로 "out of scope"(test 파일 line 14). v20/v21은 "`graphEngine.traverse('incoming')` BFS 그래프 픽스처가 무겁다"며 이연했으나, *P24-1이 `tests/policy-discoverer.test.ts`에서 `createInMemoryEngine()` + `edgeRepo.createEdge({from_id,to_id,edge_type})`로 엣지를 심는 패턴을 이미 확립*했고 — *결정적으로, `tests/refactoring-engine.test.ts` 자체가 이미 그 하니스(`edgeRepo` 반환 포함)를 들고 있어* incoming 엣지 N개만 추가하면 traverse가 의미를 가짐 → 더 이상 무겁지 않다 → (b) 잣대 충족 → Phase 25-1.** **신규 M-2 v22: `search-symbols.ts` 핸들러는 스키마-`required` 인자 `query`(`tool-dispatcher.ts:62-68`)를 *전혀 검증하지 않는다* — line 18은 `graphEngine.nodeRepo.searchSymbols(args.query, ...)`를 직접 호출하고, `node-repository.ts:299`의 `searchSymbols`는 첫 줄에서 `query.replace(/[*"']/g, '')`를 호출하므로 `args.query`가 `undefined`/비-문자열이면 *`TypeError: Cannot read properties of undefined (reading 'replace')`로 크래시*한다. 이 예외는 `Promise.allSettled` map 안에서 reject로 잡히나 `EngineNotReadyError`가 아니므로 O-12 가드(line 35-42)를 통과하지 못하고 — 모든 컨텍스트가 그렇게 reject하면 *misleading 빈 success* 또는 핸들러 외부로 전파된다. 이는 M-2 v21(검증=틀린 인자명)의 *역(逆) 부류*다: 스키마-required 인자가 핸들러 검증 0건 — 형제 핸들러(`analyze-impact`/`get-callers`/`get-risk-profile` 등)는 전부 `qualified_name`을 `typeof !== 'string'` 가드하나 `search-symbols`만 `query`를 무가드. → Phase 25-2.** **체계적 인자-명 전수 대조 결과: M-2 v21 부류(검증=틀린 인자명, dead-validation)의 신규 사례는 0건(20개 도구 전수 — discover-latent-policies는 P24-1로 이미 정합). 다만 그 역 부류(M-2 v22, search-symbols `query` 무검증)와 미세 항목(analyze-impact `use_cache` 스키마-default 미강제, 단 엔진이 undefined 처리 → 무해)을 발견.** **외부 신선 재조사: better-sqlite3 직접 CVE 0건, MCP SDK v2 *여전히 pre-alpha*(`@modelcontextprotocol/sdk` latest 1.29.0 불변, v2 stable Q3 2026, v1.x production 권장 → Cynapx 핀 `^1.29.0` 유지가 옳음[L-3]), 공급망 캠페인 Cynapx 도달 0건 불변. better-sqlite3 lockfile *12.10.0으로 재-드리프트*(v21에서 12.10.1로 정렬됐으나 Current 12.10.0·Wanted/Latest 12.10.1 — L-11 재개방). 문서 Node 버전(L-12)은 P24-2로 완전 정렬 확인(README/README_KR/GUIDE_EN/GUIDE_KR 전부 ≥ 22). 경쟁: CodeGraph(47K stars)·Serena(25.2K)·Codebase-Memory 등 로컬-퍼스트 코드 그래프 카테고리 급성장 — Cynapx의 처방 엔진(risk/remediation/refactoring/policy)이 차별점, M-1 v22가 그 마지막 게이트 격차(proposeRefactor)를 메움.** **CRITICAL 0, HIGH 0, MEDIUM 2(M-1 v22 proposeRefactor 로직 게이트 — Phase 25-1, 테스트-only; M-2 v22 search-symbols `query` 검증 추가 — Phase 25-2, ~3줄+게이트), LOW(L-2~L-9 v21 승계 + L-10 [해소-승격 → M-1 v22] + L-11 재개방[lockfile 12.10.0 재드리프트] + L-13 신규[analyze-impact use_cache 미세, 무해]; L-12 [해소 — P24-2 검증]).**

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건은 Phase 13에서, v11 HIGH(공급망)는 Phase 14-1에서, v12~v18 MEDIUM은 Phase 15~21에서, v19 MEDIUM은 Phase 22-1에서, v20 MEDIUM 2건+L-10 부분은 Phase 23에서, v21 MEDIUM 2건+L-12는 Phase 24에서 해소됐고, 본 전수 재열람에서 새로운 CRITICAL/HIGH는 없다. IPC 핸드셰이크(challenge + HMAC-SHA256 + timingSafeEqual)·API Bearer(SHA-256 + timingSafeEqual)·세션 맵(TTL+cap+sweep unref) 모두 견고(직접 재열람).

---

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** 코드·공급망 어디에서도 신규 HIGH 없음. **prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0**(직접 재검증). M-1 v22(proposeRefactor 로직 게이트)·M-2 v22(search-symbols `query` 무검증)는 MEDIUM이다 — M-1은 게이트 격차(보안·크래시 결함 아님), M-2는 입력-가드 정합성 버그(스키마-required 인자가 비-문자열일 때 핸들러가 크래시할 수 있으나, MCP 스키마가 `query`를 `required`+`string`으로 선언하므로 정상 클라이언트 경로에선 도달 어려움 → 방어적 정합성 결함이지 활성 보안 결함은 아님).

---

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

| # | 위치 | 내용 |
|---|------|------|
| **M-1 v22** *(신규, actionable — 라이브 도구 뒤 미커버 엔진 로직. v20/v21이 "그래프 픽스처 무겁다"며 이연했으나 P24-1 엣지-셋업 패턴 + 기존 하니스로 이제 가벼움)* **[DONE — Phase 25-1]** | `src/graph/refactoring-engine.ts`(`proposeRefactor()` 64-85줄 + private `calculateRisk` 87-96·`getRiskReasons` 98-110·`generateSteps` 112-128줄), `tests/refactoring-engine.test.ts`(`getRiskProfile`만 게이트, line 14에 "proposeRefactor() (BFS traverse) is out of scope" 명시) | **`RefactoringEngine.proposeRefactor()`의 핵심 로직에 회귀 게이트 추가.** 이 엔진은 라이브 MCP 도구 `propose_refactor`(`tools/propose-refactor.ts` → `_registry.ts:39`) 뒤에 있으나 **로직 자체는 0% 커버**: `tests/refactoring-engine.test.ts`는 `getRiskProfile()`만 게이트(P23-3)하고 `proposeRefactor()`는 명시적으로 out-of-scope. 미커버 로직: (a) `getNodeByQualifiedName` null → null 반환(line 65-66), (b) `traverse(node.id, 'BFS', {direction:'incoming', maxDepth:5})`로 impact 수집(line 68-72), (c) `calculateRisk`의 3-임계(`fanIn>=50||cyc>=30||impact>=100`→CRITICAL; `>=20||>=15||>=30`→HIGH; `>=5||>=8||>=10`→MEDIUM; else LOW, line 92-95), (d) `getRiskReasons`의 6-분기(fanIn>20·cyc>15·impact>30·tag:`trait:entrypoint`·`layer:core`·`layer:data` + 빈 경우 fallback, line 99-108), (e) `generateSteps`의 risk-별 분기(CRITICAL/HIGH·MEDIUM·기타 + impact.slice(0,3) 보간, line 117-126). **v20/v21은 "incoming 의존 트리를 엣지로 심어야 risk/impact가 의미 있음 → 픽스처 무겁다"며 L-10 잔여로 축소-추적했으나, *P24-1이 `tests/policy-discoverer.test.ts`에서 `createInMemoryEngine()` + `edgeRepo.createEdge({from_id,to_id,edge_type})`로 incoming 엣지를 심는 정확한 패턴을 확립*했고 — *결정적으로 `tests/refactoring-engine.test.ts` 자체가 이미 `createInMemoryEngine()`(`edgeRepo` 반환 포함)·`makeNode()` 하니스를 들고 있다* → 그 파일에 노드 N개 + `edgeRepo.createEdge`로 incoming 엣지 N개만 추가하면 `traverse('incoming')`가 impact 배열을 내고 risk/reasons/steps를 결정적으로 게이트 가능 → 더 이상 무겁지 않다.** **(b) 잣대 충족**: (1) prod 코드 무변경(테스트-only); (2) 기존 하니스 *동일 파일* 재사용 — 신규 픽스처 인프라 0; (3) M-1 v21(PolicyDiscoverer)/M-1 v20(remediation)과 동형의 "라이브 도구 뒤 미커버 엔진 로직 게이트". **이로써 처방 엔진 5종(architecture/optimization/remediation/refactoring-getRiskProfile+proposeRefactor/policy)의 *모든* 라이브-도구 진입 로직이 회귀 게이트 커버 완성.** **verdict: actionable — Phase 25-1.** (5장 상세) |
| **M-2 v22** *(신규, actionable — 핸들러 입력-가드 정합성 버그 + 게이트. M-2 v21 부류의 *역*: 스키마-required 인자가 검증 0건. 20개 도구 전수 인자-명 대조의 산물)* **[DONE — Phase 25-2]** | `src/server/tools/search-symbols.ts:14,18,21` (스키마-`required` `query` 무검증), `src/server/tool-dispatcher.ts:62-68` (스키마 `query` `required`), `src/db/node-repository.ts:299` (`query.replace(...)` — undefined 시 throw) | **`search-symbols.ts` 핸들러에 `query` 인자 검증 추가 + 회귀 게이트.** 핸들러는 `limit`만 클램프(line 14)하고 `query`는 *전혀 검증하지 않은 채* `graphEngine.nodeRepo.searchSymbols(args.query, limit, ...)`(line 18)·`embeddingProvider.generate(args.query)`(line 21)로 직접 전달한다. MCP 스키마(`tool-dispatcher.ts:62-68`)는 `query`를 `required`+`string`으로 선언하나, `node-repository.ts:299`의 `searchSymbols`는 *첫 줄에서 `query.replace(/[*"']/g, '').trim()`*를 호출하므로 **`args.query`가 `undefined`/비-문자열이면 `TypeError: Cannot read properties of undefined (reading 'replace')`로 크래시**한다. 이 예외는 `Promise.allSettled`(line 16)의 reject로 잡히나 `EngineNotReadyError`가 아니라서 O-12 가드(line 35-42, "모든 reject가 `EngineNotReadyError`일 때만 isError")를 통과하지 못한다 → `results.length===0 && contexts.length>0`이면 *misleading 빈 success*를 내거나, 컨텍스트가 0개면 핸들러 밖으로 throw가 전파될 수 있다. **이는 M-2 v21(검증=`min_confidence`/`max_policies`라는 *틀린 인자명*을 가드 → dead-validation)의 *역 부류*다**: 여기선 *올바른 인자명*(`query`)이지만 *검증 자체가 0건*. 형제 핸들러(`analyze-impact:12`·`get-callers:12`·`get-risk-profile:12`·`propose-refactor:12`·`get-symbol-details:13` 등)는 전부 `qualified_name`을 `typeof !== 'string' || trim()===''` 가드하나 — *유일하게 `search-symbols`만 자신의 string-required 인자를 무가드*. **(b) 잣대 충족**: (1) 픽스 = 핸들러 상단에 `if (typeof args.query !== 'string' || args.query.trim() === '') return {isError, ...}` 추가(~3줄, 형제 핸들러와 동형); (2) 게이트는 디스패처/핸들러 테스트에 `query: undefined`/`query: 123` → isError 케이스 추가; (3) M-2 v21과 같은 부류(핸들러 인자-가드 정합성)라 같은 정기-점검 축. **verdict: actionable — Phase 25-2.** (5장 상세) |

> **참고(인자-명 전수 대조 결론)**: v22는 M-2 v21의 "검증 인자명 vs 엔진 호출 인자명" 대조를 *20개 등록 도구 전부*에 체계적으로 적용했다(`analyze-impact`·`backfill-history`·`check-architecture-violations`·`check-consistency`·`discover-latent-policies`·`export-graph`·`find-dead-code`·`get-callees`·`get-callers`·`get-hotspots`·`get-related-tests`·`get-remediation-strategy`·`get-risk-profile`·`get-setup-context`·`get-symbol-details`·`initialize-project`·`propose-refactor`·`purge-index`·`re-tag-project`·`search-symbols`). **결론**: (1) M-2 v21 부류(검증=틀린 인자명, dead-validation)의 신규 사례 **0건** — discover-latent-policies는 P24-1로 이미 정합(`threshold`/`min_count` 검증·호출·스키마 3-way 일치 확인). (2) 그 *역* 부류(스키마-required 인자가 검증 0건)는 **1건**(M-2 v22, `search-symbols` `query`). (3) 미세 항목: `analyze-impact`의 `use_cache`(line 23)는 무검증으로 `traverse({..., useCache: args.use_cache})`에 전달되나 — `args.use_cache`가 `undefined`면 traverse 내부에서 truthy 평가되어 무해(스키마 default `true`가 핸들러에서 강제되진 않음, L-13으로 추적). 동일 무해 패턴이 `export-graph`(`max_depth`/`format`)·`get-symbol-details`(`include_source`/`summary_only`)에도 있으나 전부 다운스트림이 undefined-안전 → 비-actionable.

---

## 4. 최적화 (LOW) — 추적/이연 (v21 승계 + L-10 승격[→M-1 v22] + L-11 재개방 + L-13 신규; L-12 해소)

| # | 위치 | 내용 |
|---|------|------|
| L-2(v22) | `package.json` (native deps), CI / Dockerfile, `.claude/` 설정 | **Miasma / Phantom Gyp / Node-gyp 공급망 캠페인 포스처 추적 — Cynapx 도달 0건 불변.** 진단 일자 직접 재대조: 컴프로마이즈 패키지 패밀리 전부 Cynapx 트리 "not in tree", native 의존(better-sqlite3 + tree-sitter 0.25.0 + 12 grammar) 무관·악성 버전 미발행, in-tree 에이전트 설정은 `.claude/launch.json` 1개(양성), `.cursor`/`.gemini` 부재. CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지 1차 방어선 유지. **즉각 조치 불필요 — 추적만.** 출처: [Snyk better-sqlite3](https://security.snyk.io/package/npm/better-sqlite3) |
| L-3(v22) | `src/server/api-server.ts` (session-id StreamableHTTP), `package.json:29`(`@modelcontextprotocol/sdk ^1.29.0`) | **MCP SDK v2 — *여전히 pre-alpha*(상태 갱신).** 직접 확인: `@modelcontextprotocol/sdk` latest는 **여전히 1.29.0**(v21 시점과 불변), v2는 main 브랜치에서 pre-alpha 개발 중·**stable은 Q3 2026** 예정, v1.x가 production 권장. → Cynapx 핀 `^1.29.0` 유지가 옳음. stateless protocol core(SEP-2567 session-id 제거)·Multi-Round-Trip·MCP Apps 마이그레이션은 **v2 stable 전환까지 계속 이연**. P15-3 `handleMcp()` 설계 메모가 출발점. 출처: [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk), [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) |
| L-4(v22) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환. **성능 문제 미관측 — 계속 보류.** 메시지가 작고 round-trip이 드물어 직렬화 병목 아님 |
| L-5(v22) | `src/graph/graph-engine.ts` | 클러스터링 본격 서브그래프 파티셔닝 — 100k+ 노드 실측 시 재검토(**계속 이연**). LPA O(V+E)·`MAX_ITER=20` 캡·count-first 가드(200k)·Fisher-Yates seeded PRNG 직접 재확인 — OOM/편향 방어 정상 |
| L-6(v22) | CI / Dockerfile | Node 24 + tree-sitter 0.25.x 빌드 fragility([node-tree-sitter#268] 여전히 open·미해결, CVE 아님). CI Node 22/24 매트릭스 그린이나 Node 24 LTS 전환 전 prebuild 재확인. **추적만** |
| L-7(v22) | `src/cli/admin.ts` (cmd* 9개), `tests/admin-cli.test.ts` | **admin CLI 명령 동작의 vitest 게이트 공백 — 비-actionable 추적.** 등록 명령 9개 `cmd*`는 모듈-private(미-export)이라 vitest 직접 호출 불가. **admin.ts 핸들러 export 리팩터 시 함께 게이트화 후보** |
| L-8(v22) | `src/indexer/worker-pool.ts`, `embedding-manager.ts`, `db/database.ts` | **에러-복구·마이그레이션 잔여 분기의 vitest 게이트 공백 — 비-actionable 추적.** worker `worker.on('error')`·queue backpressure·embedding A-7 stale supersedence 레이스·DB migration 잔여 분기는 직접 미검증이나 인접 분기 커버 + 타이밍-flaky 위험. **SCHEMA_VERSION 증분/worker-pool 리팩터 시 함께** |
| L-9(v22) | `src/indexer/update-pipeline.ts` (트랜잭션 보일러플레이트·progress `log.error`), `embedding-manager.ts:184`/`api-server.ts:625` (빈 catch) | **L-9 코드 클린업 잔여 — (b) 잣대 미충족, 비-actionable 추적.** `withWriteTransaction()` 추출은 트랜잭션 경계 5곳 재작성이라 회귀 표면 넓음; 빈 catch 2건은 의도적 silent-drop 방어. **update-pipeline 리팩터 페이즈로 묶어 처리 후보** |
| **L-11(v22)** *(재개방 — lockfile 12.10.0 재드리프트)* | `package-lock.json` (better-sqlite3) | **better-sqlite3 lockfile이 12.10.0으로 재-드리프트 — v21에서 12.10.1로 정렬됐으나 다시 벌어짐.** `npm outdated` 직접 확인: better-sqlite3 **Current 12.10.0 · Wanted 12.10.1 · Latest 12.10.1**(v21 시점엔 Current 12.10.1로 정렬돼 "해소" 선언됐으나, 본 사이클엔 lockfile이 12.10.0으로 되돌아옴 — 중간 작업 중 lockfile 재생성 추정). **드리프트는 patch-level(12.10.0→12.10.1)이라 영향 미미하나, 차기 `npm update better-sqlite3` 또는 `npm install` 시 자동 정렬되거나 의도적 `npm i better-sqlite3@12.10.1`로 정렬 가능.** 보안·기능 결함은 아님(12.10.0 직접 CVE 0건). **verdict: 추적 — 다음 의존성 정렬 사이클** |
| **L-13(v22)** *(신규 — analyze-impact use_cache 스키마-default 미강제, 무해)* | `src/server/tools/analyze-impact.ts:23` (`useCache: args.use_cache` 무검증·default 미강제) | **`analyze-impact` 핸들러가 `use_cache`(스키마 default `true`)를 검증·default-강제 없이 그대로 `traverse({useCache: args.use_cache})`에 전달 — 무해.** `args.use_cache`가 `undefined`(스키마 default가 클라이언트단 미적용 시)면 traverse 내부 truthy 평가에서 캐시 *비활성*으로 동작(스키마가 약속한 `true` default와 어긋날 수 있음). 단 캐시 비활성은 *느려질 뿐* 정확성·크래시 영향 0이라 **비-actionable**. 동형 무해 패턴이 `export-graph`(`max_depth`/`format`)·`get-symbol-details`(`include_source`/`summary_only`)에도 존재 — 전부 다운스트림 undefined-안전. **verdict: 추적만(비-actionable)** |

> **L-10 v21 [해소 — M-1 v22로 승격]**: v21이 "`proposeRefactor()`는 그래프 픽스처 무거워 다음 사이클 후보"로 축소-추적했으나, 본 사이클 재판정 결과 *P24-1의 엣지-셋업 패턴 + `tests/refactoring-engine.test.ts`가 이미 보유한 동일 하니스* 덕에 더 이상 무겁지 않음을 확인 → **actionable M-1 v22로 승격**(L-10 추적 종료).
>
> **L-12 v21 [해소 — P24-2 검증]**: v21이 "README_KR/GUIDE_EN/GUIDE_KR Node ≥ 20 vs 코드 ≥ 22 드리프트"로 추적했으나, 본 사이클 `grep` 직접 확인 결과 **4개 문서 전부 ≥ 22로 정렬됨**(README.md:62·README_KR.md:62·GUIDE_EN.md:119·GUIDE_KR.md:119). P24-2가 완전 처리 — 추적 종료.
>
> **신규 LOW 부재 안내(prod 코드 동작 변경)**: M-1 v22(proposeRefactor 게이트, 테스트-only)·M-2 v22(search-symbols `query` 검증 ~3줄)을 제외하면 prod 코드 *동작* 변경을 요하는 신규 LOW는 0건이다(L-11 lockfile은 의존성 정렬, L-13은 무해 추적).

---

## 5. 코드 품질 / 성능 전수 (L-10 이연 재판정 + 인자-명 20개 전수 대조 + steady-state 재확인)

v21까지 graph/ 엔진 5종 중 PolicyDiscoverer까지 게이트화(P24-1)됐고, 잔여는 `proposeRefactor()` 1건이었다. v22는 **(1) v21이 "그래프 픽스처 무겁다"며 L-10으로 축소-추적한 `proposeRefactor()`를 P24-1 패턴 + 기존 하니스 기준으로 재판정**하고, **(2) M-2 v21의 인자-명 대조를 20개 도구 전부로 전수 확대**한다.

**(1) graph/ 엔진 ×테스트 파일 대조 (v21→v22 갱신)**

| 엔진 | 테스트 파일 | 라이브 도구 | 로직 커버 | 판정 |
|------|-------------|------------|-----------|------|
| `architecture-engine.ts` | `architecture-engine.test.ts` | `check_architecture_violations` | custom-rule + circular(P22-1) | 커버 |
| `optimization-engine.ts` | `optimization-engine.test.ts` | `find_dead_code` | dead-code 티어 + 빈-그래프 경계(P23-2) | 커버 |
| `remediation-engine.ts` | `remediation-engine.test.ts` | `get_remediation_strategy` | 7 분기(P23-1) | 커버 |
| `policy-discoverer.ts` | `policy-discoverer.test.ts` | `discover_latent_policies` | 엣지 필터·태그 카운팅·threshold/minCount·probability(P24-1) | 커버 |
| `refactoring-engine.ts` | `refactoring-engine.test.ts` | `get_risk_profile`/`propose_refactor` | `getRiskProfile()` 임계/가중(P23-3) 커버; **`proposeRefactor()` BFS+risk+reasons+steps 잔여(0% 커버)** | **M-1 v22 — Phase 25-1** (P24-1 엣지-셋업 + 동일 파일 하니스로 게이트, 더 이상 무겁지 않음) |

핵심: v20/v21이 `proposeRefactor()`를 이연한 근거("incoming 의존 트리 엣지 픽스처 무겁다")는 P24-1이 `tests/policy-discoverer.test.ts`에서 `edgeRepo.createEdge()` 엣지-셋업을 확립하고 — 결정적으로 `tests/refactoring-engine.test.ts`가 *이미 같은 `createInMemoryEngine()`(edgeRepo 포함)·`makeNode()` 하니스를 보유* — 함으로써 무효화됐다. 그 파일에 incoming 엣지만 추가하면 traverse가 의미를 가짐 → `calculateRisk` 4-티어·`getRiskReasons` 6-분기·`generateSteps` risk-별 분기를 결정적으로 게이트(테스트-only).

**(2) 도구 핸들러 인자-명 20개 전수 대조 (M-2 v21 각도 확대)**

`src/server/tools/*.ts` 20개 전부의 검증-블록 인자명을 *같은 핸들러의 엔진 호출 인자명* 및 *디스패처 스키마*와 대조했다.

| 부류 | 결과 |
|------|------|
| M-2 v21 부류(검증=틀린 인자명 → dead-validation) | **신규 0건.** discover-latent-policies는 P24-1로 정합(threshold/min_count 3-way 일치). |
| 역(逆) 부류(스키마-required 인자가 검증 0건) | **1건 — `search-symbols` `query`(M-2 v22).** 형제 핸들러는 전부 string-required 인자를 가드하나 search-symbols만 무가드 → `query.replace` undefined 크래시 경로. |
| 미세(스키마-default 핸들러 미강제, 무해) | `analyze-impact` `use_cache`(L-13) + `export-graph`/`get-symbol-details`의 optional 인자 — 전부 다운스트림 undefined-안전, 비-actionable. |

**(3) prod steady-state 재확인 — 신규 prod 코드 결함 0**

| 항목 | 판정 |
|------|------|
| god-module / 순환 import | 0 — `openapi.ts`·`update-pipeline.ts`·`graph-engine.ts` 응집 불변. repos→engines→server/pipeline 단방향 |
| TODO/FIXME/XXX/HACK | 0건(`src/` 전수) |
| 핫패스 O(n²)-over-nodes | 0 — 클러스터링 count-first 가드(200k)+seeded PRNG, BFS index-pointer 큐, 반복 DFS+60s 캐시, architecture-engine O(1) Map(P22-1) |
| prod·dev audit | 0 / 0 vulnerabilities |
| 테스트 | `npx vitest run` **618/618**(46 파일, 6.72s) — 추세 무문제(594→6.9s 대비 +24케이스·-0.2s) |

**(4) 에러 핸들링 일관성 — 양호(단 M-2 v22 search-symbols 무가드 예외)**

`Logger`(stderr-only, MCP stdio 안전) `normalizeData()` Error 언랩. update-pipeline catch는 log-and-rethrow + 롤백 선행. 미세 항목(progress log.error·빈 catch 2건)은 L-9 비-actionable 추적. **M-2 v22의 search-symbols `query` 무검증은 *입력 가드 정합성* 결함(스키마-required string 인자가 핸들러 검증 0건 → `query.replace` undefined 크래시)이라 별도 actionable화.**

---

## 6. 외부 컨텍스트 (웹 조사 — 진단 일자 재실행, 출처 명시)

### 6.1 의존성 취약점 (prod·dev 둘 다 clean)

- **`npm audit`(dev 포함) = 0 + `npm audit --omit=dev`(prod) = 0**(둘 다 직접 실행). Phase 21-1 postcss override가 dev 트리도 clean 유지.
- **`npm outdated`(직접 실행)**: prod 코드 *동작* 변경을 요하는 긴급 업그레이드 0건. **L-11 재개방 — better-sqlite3 lockfile이 12.10.0으로 재드리프트(Wanted/Latest 12.10.1).** 잔여 드리프트: `tree-sitter-c-sharp` 0.23.1 핀(0.23.5 latest이나 ERR_REQUIRE_ASYNC_MODULE 미해소 → 핀 유지가 옳음), `express`/`commander`/`typescript`/`@types/*` major(5.x/15/6.x — 비-긴급 major, 즉시 비권장), `zod` 4.3.6→4.4.3·`vitest` 4.1.2→4.1.9·`@types/node` 20.19.33→25.x(dev, 다음 갱신 시 정렬).
- **better-sqlite3 / chokidar / express / tree-sitter 직접 재확인(웹)**: better-sqlite3 직접 CVE 0건(latest 12.10.1 — "Node-gyp Supply Chain June 2026" 패밀리 거론되나 Cynapx 핀은 악성 미발행), chokidar·express 4.22.x non-vulnerable, 기타 의존 미해결 공개 취약점 미발견. 출처: [Snyk better-sqlite3](https://security.snyk.io/package/npm/better-sqlite3)

### 6.2 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"` + Docker `node:22-bookworm-slim`. Node 22 LTS 2027-04 종료 — 여유. CI Node 22/24 매트릭스 그린(618/618). **문서 Node 버전 드리프트 해소(L-12 — README/README_KR/GUIDE_EN/GUIDE_KR 전부 ≥ 22, P24-2 검증).**
- **tree-sitter 코어**: latest 0.25.0, 12 grammar 전부 dedupe/override. **tree-sitter-c-sharp**: 0.23.1 정확 핀 롤백 유지.
- **better-sqlite3**: lockfile 12.10.0 재드리프트(L-11 재개방, Wanted 12.10.1).

### 6.3 공급망 캠페인 — Miasma / Phantom Gyp / Node-gyp June 2026 (계속 진행 중, Cynapx 도달 0건 불변)

진단 일자 직접 재대조: 컴프로마이즈 패밀리 전부 Cynapx 트리 "not in tree", native 의존 무관·악성 버전 미발행, in-tree 설정은 `.claude/launch.json` 1개(양성), `.cursor`/`.gemini` 부재. CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지. **즉각 변경 불필요, 포스처 추적.** 출처: [Snyk better-sqlite3](https://security.snyk.io/package/npm/better-sqlite3)

### 6.4 MCP 생태계 — SDK v2 여전히 pre-alpha (상태 갱신)

- **MCP SDK v2가 여전히 pre-alpha**(직접 확인): `@modelcontextprotocol/sdk` latest는 **여전히 1.29.0**(v21 시점과 불변, 2개월 전 publish). v2는 main 브랜치에서 pre-alpha 개발 중, **stable은 Q3 2026** 예정, v1.x가 production 권장. → **Cynapx 핀 `^1.29.0` 유지가 옳다. stateless core/Tasks/MCP Apps/Multi-Round-Trip 마이그레이션(L-3)은 v2 stable까지 계속 이연.** 출처: [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk), [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases)
- **함의**: Cynapx 현 StreamableHTTP(session-id)는 v2 stateless core와 충돌 표면이 있으나 *마이그레이션은 stable 배포까지 이연*이 옳다.

### 6.5 경쟁/인접 도구 동향 (전략 추적 — 카테고리 급성장)

- **로컬-퍼스트 코드 그래프 카테고리 폭발적 성장**: **CodeGraph**(tree-sitter→SQLite 심볼/콜/임포트 그래프 MCP 서버, 21언어, 5개월 만에 **47K+ stars**, 8개 에이전트 통합), **Serena**(LSP-over-MCP, 25.2K stars, MIT), **Codebase-Memory**(tree-sitter→MCP 지식그래프, 66언어, 4주 만에 900+ stars), **GitNexus** 등이 "로컬·on-device·MCP·임베디드 SQLite" 패턴을 표준 기본값으로 정착. Cynapx의 "100% 로컬·격리·멀티프로세스 보안 IPC + risk/remediation/refactoring/policy *처방* 엔진" 포지션이 차별점. **함의: 그 처방 엔진들이 Cynapx 고유 가치인데 `proposeRefactor()`만 아직 게이트 밖 — M-1 v22가 그 마지막 격차를 메우면 처방 엔진 진입 로직 전부 회귀 게이트 커버 완성.** 출처: [CodeGraph](https://codegraph.codes/), [Codebase-Memory arXiv](https://arxiv.org/html/2603.27277v1), [Code Intelligence Tools Compared](https://rywalker.com/research/code-intelligence-tools)
- **SCIP가 LSIF 대체 심볼 인덱스 표준 정착** — `export_graph`에 SCIP 추가는 미래 상호운용 후보. protobuf 의존 부담으로 즉시 비권장 — 전략 후보 유지.
- **함의**: (1) 공급망 위생 유지, (2) MCP SDK v2 pre-alpha→stable 추적, (3) **회귀 안전망을 처방 엔진 진입 로직 전부로 완성**(M-1 v22), (4) **핸들러 입력-가드 정합성**(M-2 v22)이 신뢰성 차별화 축.

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 정밀 재열람에서 신규 prod 코드 결함이 없었다(M-1 v22는 미커버 엔진 로직 게이트, M-2 v22는 search-symbols `query` 가드 추가):

- `src/watcher/file-watcher.ts` — chokidar `ignored` 프레디킷·확장자 allowlist·flush 동시성·타이머 위생·대용량-배치 git-sync 라우팅·재시도/FATAL 강등(P20-1) 정상.
- `src/graph/graph-engine.ts` — Fisher-Yates + seeded PRNG + count-first 가드(200k) + BFS index-pointer 큐·반복 DFS 모두 O(V+E). `traverse('incoming')` direction 분기 정상(getIncomingEdges 라우팅).
- `src/graph/architecture-engine.ts`(P22-1)·`optimization-engine.ts`(P23-2)·`remediation-engine.ts`(P23-1)·`policy-discoverer.ts`(P24-1)·`refactoring-engine.ts` getRiskProfile(P23-3) — 게이트 커버. **단 `refactoring-engine.ts` `proposeRefactor()`만 0% 커버 — M-1 v22.**
- `src/server/tools/*.ts` — 20개 전수 인자-명 대조: 검증=호출 인자명 일치(dead-validation 0건). **단 `search-symbols.ts`만 스키마-required `query` 무검증 — M-2 v22.**
- `src/indexer/update-pipeline.ts` — 단일 책임·catch log-and-rethrow+롤백·원본 에러 보존(미세 항목만 L-9).
- `src/server/api-server.ts` — 세션 TTL/cap/sweep·timing-safe Bearer·8 REST 핸들러 supertest 게이트(P19-1)·rate-limit 양호.
- `src/server/ipc-coordinator.ts` — challenge-response 인증·1MB 제한·per-tool 타임아웃·keepalive(unref)·pending reject-on-close 견고.
- `src/server/tool-dispatcher.ts` — Terminal 포워딩·waitUntilReady·registry lookup·EngineNotReadyError 재시도 변환. 20/20 게이트(P18-1).
- `package.json` overrides — tree-sitter `^0.25.0`·fast-uri·qs·hono·postcss 충족, dev·prod audit 0/0. **better-sqlite3 lockfile 12.10.0 재드리프트 — L-11 재개방.**
- `README.md`/`README_KR.md`/`GUIDE_EN.md`/`GUIDE_KR.md` — Node ≥ 22 전부 정렬(P24-2, L-12 해소).
- `.github/workflows/ci.yml` — Node 22/24 매트릭스 + `npm audit --omit=dev --audit-level=high`(P14-1) + `npm ci`. (cynapx-autonomous.yml은 본 진단 범위 외.)
- TODO/FIXME/XXX/HACK = 0건(`src/` 전수).

---

## 8. 권장 수정 순서 (Phase 25 제안 — 상세는 phase25-plan.md)

**Phase 24 이후 prod 코드는 steady-state(CRITICAL/HIGH 0, prod·dev audit 0/0, TODO 0, god-module 0, 핫패스 quadratic 0)이고 신규 prod-도달 CVE도 0건이나, v22는 v21이 *명시적으로 다음 사이클로 이연한* 두 후보를 재판정해(proposeRefactor가 이제 가벼움 + 인자-명 20개 전수 대조에서 search-symbols `query` 무검증 발견) 두 건의 actionable을 발굴했다.** CRITICAL/HIGH 0, MEDIUM 2(M-1 v22 proposeRefactor 로직 게이트 — 테스트-only; M-2 v22 search-symbols `query` 검증 추가 — ~3줄+게이트), LOW(L-2~L-9 v21 승계 + L-10 승격[→M-1 v22] + L-11 재개방[lockfile 12.10.0] + L-13 신규[analyze-impact use_cache 무해]; L-12 해소). 따라서 Phase 25는 **proposeRefactor 게이트(P25-1, 테스트-only) + search-symbols `query` 검증+게이트(P25-2, ~3줄) + 추적 갱신**이 합리적이다.

1. **P25-1 [DONE]**: M-1 v22 해소 — `tests/refactoring-engine.test.ts`에 `proposeRefactor()` 게이트를 추가(같은 파일의 `createInMemoryEngine()`(edgeRepo 포함)·`makeNode()` 하니스 재사용 + `edgeRepo.createEdge()`로 incoming 엣지 셋업). `calculateRisk` 4-티어(CRITICAL/HIGH/MEDIUM/LOW)·`getRiskReasons` 6-분기·`generateSteps` risk-별 분기·null-노드 경로를 결정적으로 게이트(테스트-only, prod 코드 무변경). **이로써 처방 엔진 진입 로직 전부 회귀 게이트 커버 완성.**
2. **P25-2 [DONE]**: M-2 v22 해소 — `src/server/tools/search-symbols.ts` 상단에 `query` string-required 가드 추가(형제 핸들러 `analyze-impact:12`과 동형, ~3줄) + 디스패처/핸들러 테스트에 `query: undefined`/`query: 123` → isError 케이스 추가. **prod ~3줄 + 테스트.**
3. **추적 상태 갱신**: L-2(Miasma/Node-gyp 도달 0 불변), L-3(SDK v2 *여전히 pre-alpha* — stable Q3까지 이연), L-6(node-tree-sitter#268 open), L-7/L-8 게이트 공백, L-9 잔여 클린업, **L-11 재개방(better-sqlite3 lockfile 12.10.0→12.10.1 정렬 후보)**, L-13(analyze-impact use_cache 무해) 현 상태를 다음 사이클 출발점으로 고정.

(L-4 IPC MessagePack 계속 보류, L-5 클러스터링 본격 파티셔닝 계속 이연, MCP 전면 stateless/task 마이그레이션은 SDK v2 stable 배포까지 이연, SCIP export는 전략 후보로 기록만.)
