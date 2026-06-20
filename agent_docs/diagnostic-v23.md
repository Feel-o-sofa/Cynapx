# Cynapx 정밀 진단 보고서 v23

- **기준 커밋**: `9b34f5f` (Phase 25 + Phase 25-1/25-2 완료, 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-15
- **진단 범위**: src/ 전체(server, db, indexer, graph, watcher, utils, cli, bootstrap) + **v22가 처방 엔진 5종의 *모든* 라이브-도구 진입 로직(architecture/optimization/remediation/refactoring-getRiskProfile+proposeRefactor/policy)을 회귀 게이트로 덮은 지금, 그 *다음* 미커버 후보를 찾는 두 신규 각도**: (1) graph/ 엔진은 전수 게이트됐으나 *서버 핸들러 보조 비즈니스 로직*(`src/server/tools/_utils.ts`의 순수 함수 — `mergeResultsRRF`(RRF 하이브리드 검색 융합)·`escapeXml`·`escapeDot`)은 라이브 도구(`search_symbols`/`export_graph`) 뒤에 있으나 *직접 단위 테스트가 0건*인지 실측; (2) v22가 `search_symbols` `query` 무검증(M-2 v22)을 메운 뒤, *같은 인자-가드 정합성 각도*를 `qualified_name`을 받는 10개 핸들러 전부에 재적용 — *strict 가드(`typeof !== 'string'`)를 쓰지 않는 약한 truthy 가드(`if (!args.x)`)* 가 남아 비-문자열 입력을 흘려보내는 형제 핸들러가 있는지 — + 그 핸들러 전수 + schema/, tests/, package.json/lockfile 동기화 + 외부 컨텍스트(CVE/advisory, 공급망 캠페인, MCP SDK v2 npm 배포 상태, 경쟁/인접 도구)
- **진단 방법**: 단일 에이전트 오케스트레이션 + 회의적 전수 코드 리뷰 + 로컬 직접 검증(`npx vitest run`[시간·케이스 수 측정], `npx tsc --noEmit`, `npm audit`[dev 포함]·`npm audit --omit=dev`, `npm ls better-sqlite3`·`npm outdated`로 버전 드리프트 확인) + **신규 각도 2종: (1) v22가 graph/ 엔진 처방 5종을 전수 게이트한 뒤, *서버 핸들러 보조 순수 로직*(`_utils.ts` RRF 융합·XML/DOT 이스케이프)이 라이브 도구 뒤에 있으나 직접 테스트 0건임을 `grep`으로 실측 — `mergeResultsRRF`는 `search_symbols`의 semantic 모드(`search-symbols.ts:30`)에서 RRF 점수 누적·dedup·정렬·limit slice를 수행하는 핵심 알고리즘. (2) M-2 v22의 "스키마-required 인자가 핸들러 검증 0건"각도를 *`qualified_name`을 받는 10개 핸들러 전부*에 재적용해, strict 가드를 쓰지 않는 약한 truthy 가드가 남았는지 대조.** + 외부 웹 재조사(better-sqlite3·MCP SDK v2 npm 배포 상태·tree-sitter/chokidar CVE·공급망 캠페인·경쟁 도구)
- **현재 상태(직접 검증)**: `npx vitest run` **634/634**(46 파일, **6.84s** — 618→6.72s 대비 케이스 +16(P25-1 12 + P25-2 4)·시간 +0.12s, 추세 무문제), `npx tsc --noEmit` 그린, **`npm audit`(dev 포함) = 0 vulnerabilities**, **`npm audit --omit=dev`(prod) = 0 vulnerabilities**. diagnostic-v22 전 항목 처리 완료(M-1 v22 [DONE — P25-1], M-2 v22 [DONE — P25-2]), LOW 승계 추적.

> **요약**: **Phase 25까지 prod 코드는 steady-state(CRITICAL/HIGH 0, prod·dev audit 0/0, TODO 0, god-module 0, 핫패스 quadratic 0)이고, 외부도 신규 prod-도달 CVE 0건(better-sqlite3·chokidar·tree-sitter·@modelcontextprotocol/sdk 직접 재확인)이다.** **v22가 graph/ 엔진 처방 5종을 전수 게이트로 덮은 지금, v23은 그 *다음* 미커버 후보를 두 신규 각도로 드러낸다.** **신규 M-1 v23: `src/server/tools/_utils.ts`의 순수 함수 `mergeResultsRRF()`(35-49줄)는 라이브 MCP 도구 `search_symbols`의 semantic 모드(`search-symbols.ts:30`) 뒤에서 *Reciprocal Rank Fusion(RRF)* 융합을 수행하나 — *직접 단위 테스트가 0건*(`tests/` 전수 `grep` 결과 `mergeResultsRRF`/`tools/_utils` import 0건)이다. 미커버 로직: (a) `k=60` 상수 + `1/(k+rank+1)` 랭크 점수 공식, (b) 같은 `node.id`가 keyword·vector 두 리스트에 모두 출현 시 *점수 누적*(dedup boost — `scores.get(id) || 0 + ...`), (c) `Array.from(scores.entries()).sort((a,b)=>b[1]-a[1])` 내림차순 정렬, (d) `.slice(0, limit)` 절단, (e) id→노드 매핑 복원. 이 함수는 처방 엔진과 동형의 "라이브 도구 뒤 미커버 순수 비즈니스 로직"이고, *의존 0(배열 in→배열 out, DB·async·side-effect 없음)*이라 모킹·픽스처 전무 → (b) 잣대를 가장 깨끗하게 충족 → Phase 26-1(테스트-only).** **신규 M-2 v23: `get-related-tests.ts:17` 핸들러는 스키마-required `qualified_name`을 *약한 truthy 가드*(`if (!args.qualified_name)`)로만 검증한다 — 형제 핸들러 9종(`analyze-impact:12`·`get-callers:12`·`get-callees:12`·`get-symbol-details:13`·`get-risk-profile:12`·`propose-refactor:12` 등)은 전부 strict `typeof args.qualified_name !== 'string' || args.qualified_name.trim() === ''` 가드를 쓰나 — *유일하게 `get-related-tests`만 truthy 가드*다. 결과: `qualified_name: 123`(비-문자열 truthy)이 가드를 통과해 `getNodeByQualifiedName(123)`로 흘러가고, SQLite `WHERE qualified_name = 123`은 매치 0행 → *misleading "Symbol not found"*를 반환한다(형제 핸들러의 일관된 "Invalid argument: qualified_name must be a non-empty string."와 메시지 불일치). 크래시는 아니나(M-2 v22가 `query.replace` undefined 크래시였던 것과 달리, 여기선 SQLite 바인딩이 숫자를 받아들여 무-매치) *입력-가드 정합성·메시지 일관성* 결함이다. 기존 `tests/tool-dispatcher.test.ts:157`은 `{}`(falsy 누락)만 게이트하고 `123`(non-string truthy)은 미커버. → Phase 26-2(~3줄 가드 정렬 + 게이트).** **`qualified_name` 10개 핸들러 전수 대조 결과: strict 가드 미사용은 `get-related-tests` 1건(M-2 v23). 나머지 9종 전부 strict.** **외부 신선 재조사: better-sqlite3 직접 CVE 0건(`npm ls` = 12.10.0, latest 12.10.1), MCP SDK v2 *여전히 pre-alpha*(`@modelcontextprotocol/sdk` latest 1.29.0 불변, v2 stable Q3 2026[7-28 publish 예정], v1.x production 권장 → 핀 `^1.29.0` 유지가 옳음[L-3]), CVE-2026-25727(tree-sitter로 거론되나 *실제로는 Rust `time` 크레이트의 RFC 2822 파싱 DoS* — Cynapx의 npm tree-sitter 바인딩/그래머에 부재, prod 트리 미도달 — 신규 L-14로 추적). better-sqlite3 lockfile *여전히 12.10.0*(L-11 불변 — Wanted/Latest 12.10.1). 경쟁: CodeGraph(47.4K stars, 5개월)·Serena(25.2K)·GitNexus 등 로컬-퍼스트 코드 그래프 카테고리 지속 폭발 — Cynapx의 처방 엔진(risk/remediation/refactoring/policy)이 차별점, 그 진입 로직은 v22로 전수 게이트 완성, v23은 *그 처방을 떠받치는 검색 융합(RRF)*과 *핸들러 입력 위생*을 게이트로 완성.** **CRITICAL 0, HIGH 0, MEDIUM 2(M-1 v23 mergeResultsRRF 게이트 — Phase 26-1, 테스트-only; M-2 v23 get-related-tests `qualified_name` strict 가드 정렬 — Phase 26-2, ~3줄+게이트), LOW(L-2~L-9 v22 승계 + L-11 불변[lockfile 12.10.0] + L-13 승계[analyze-impact use_cache 무해] + L-14 신규[CVE-2026-25727 time 크레이트 미도달]).**

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건은 Phase 13에서, v11 HIGH(공급망)는 Phase 14-1에서, v12~v18 MEDIUM은 Phase 15~21에서, v19 MEDIUM은 Phase 22-1에서, v20 MEDIUM 2건+L-10 부분은 Phase 23에서, v21 MEDIUM 2건+L-12는 Phase 24에서, v22 MEDIUM 2건은 Phase 25에서 해소됐고, 본 전수 재열람에서 새로운 CRITICAL/HIGH는 없다. IPC 핸드셰이크(challenge + HMAC-SHA256 + timingSafeEqual)·API Bearer(SHA-256 + timingSafeEqual)·세션 맵(TTL+cap+sweep unref) 모두 견고(직접 재열람).

---

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** 코드·공급망 어디에서도 신규 HIGH 없음. **prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0**(직접 재검증). M-1 v23(mergeResultsRRF 게이트 격차)·M-2 v23(get-related-tests truthy 가드)는 MEDIUM이다 — M-1은 게이트 공백(보안·크래시 결함 아님, 순수 함수 미커버), M-2는 입력-가드 정합성·메시지 일관성 결함(비-문자열 `qualified_name`이 strict 가드를 우회하나 SQLite 무-매치로 흡수되어 크래시 없음 → 방어적 정합성 결함이지 활성 보안 결함은 아님). 외부 CVE-2026-25727(`time` 크레이트)도 Cynapx prod 트리 미도달이라 LOW(L-14).

---

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

| # | 위치 | 내용 |
|---|------|------|
| **M-1 v23** *(신규, actionable — 라이브 도구 뒤 미커버 순수 비즈니스 로직. v22가 graph/ 엔진을 전수 게이트한 뒤 *서버 핸들러 보조 순수 로직*으로 각도 확장)* **[DONE — Phase 26-1]** | `src/server/tools/_utils.ts`(`mergeResultsRRF()` 35-49줄), `src/server/tools/search-symbols.ts:30`(유일 호출처, semantic 모드), `tests/`(직접 단위 테스트 부재 — `grep` 0건) | **`mergeResultsRRF()`의 RRF 융합 로직에 회귀 게이트 추가.** 이 순수 함수는 라이브 MCP 도구 `search_symbols`의 semantic 모드(`search-symbols.ts:30`: `mergeResultsRRF(keywordNodes, vectorNodes, limit)`) 뒤에서 *Reciprocal Rank Fusion*을 수행하나 **직접 단위 테스트가 0건**: `tests/` 전수 `grep` 결과 `mergeResultsRRF`/`tools/_utils` import가 0건이고, semantic 검색 경로는 디스패처/API 테스트에서 mock으로만 간접 노출. 미커버 로직: (a) `k=60` + `1/(k+rank+1)` 랭크 점수(line 41-44), (b) 같은 `node.id`가 keyword·vector 양쪽에 출현 시 *점수 누적*(dedup boost — `scores.set(id, (scores.get(id)||0) + ...)`, line 43; *RRF의 핵심 — 두 랭킹에서 모두 상위인 노드가 가장 높은 융합 점수*), (c) `sort((a,b)=>b[1]-a[1])` 내림차순(line 48), (d) `.slice(0, limit)` 절단(line 48), (e) `nodeMap`으로 id→원본 노드 복원(line 48). **(b) 잣대 충족**: (1) prod 코드 무변경(테스트-only); (2) *의존 0* — 배열 in → 배열 out, DB·async·side-effect·픽스처 전무 → `import { mergeResultsRRF }` 후 노드 배열 리터럴만 넣어 결정적 단언(remediation-engine 순수-함수 게이트 P23-1과 동형, 더 가벼움); (3) M-1 v20(remediation)/M-1 v21(policy)/M-1 v22(refactoring)와 동형의 "라이브 도구 뒤 미커버 비즈니스 로직 게이트"를 *서버 핸들러 보조 순수 로직*으로 확장. **이로써 검색 처방을 떠받치는 융합 알고리즘까지 회귀 게이트 커버.** **verdict: actionable — Phase 26-1.** (5장 상세) |
| **M-2 v23** *(신규, actionable — 핸들러 입력-가드 정합성 버그 + 게이트. M-2 v22 각도를 `qualified_name` 10개 핸들러 전수 재적용)* **[DONE — Phase 26-2]** | `src/server/tools/get-related-tests.ts:17`(약한 truthy 가드 `if (!args.qualified_name)`), `src/server/tool-dispatcher.ts:108-110`(스키마 `qualified_name` `required`+`string`), `src/db/node-repository.ts:198-201`(`getNodeByQualifiedName` — 숫자 바인딩 무-매치), `tests/tool-dispatcher.test.ts:157`(falsy `{}`만 게이트) | **`get-related-tests.ts` 핸들러의 `qualified_name` 가드를 형제 핸들러와 동형의 strict 가드로 정렬 + 회귀 게이트.** 핸들러는 line 17에서 `if (!args.qualified_name)`로만 검증한다 — *약한 truthy 가드*. 형제 핸들러 9종(`analyze-impact:12`·`get-callers:12`·`get-callees:12`·`get-symbol-details:13`·`get-risk-profile:12`·`propose-refactor:12` 등)은 전부 `typeof args.qualified_name !== 'string' || args.qualified_name.trim() === ''` strict 가드를 쓰나 — **유일하게 `get-related-tests`만 truthy 가드**. 결과: `qualified_name: 123`(비-문자열 truthy)이 가드를 통과해 `getNodeByQualifiedName(123)`(line 21)로 흘러가고, `node-repository.ts:199`의 `WHERE qualified_name = ?`는 숫자 바인딩에 매치 0행 → *misleading "Symbol not found"*(형제 핸들러의 일관된 "Invalid argument: qualified_name must be a non-empty string."와 메시지·동작 불일치). 또한 falsy 경로(`{}`/`''`)는 "Error: qualified_name is required."를 반환해 *형제와 다른 메시지*. **이는 M-2 v22(`search_symbols` `query` 무검증, undefined-크래시)의 *형제 변종*이다**: 거기선 검증 0건이었고 여기선 *약한 검증*이라 비-문자열을 흘려보냄(크래시 대신 무-매치로 흡수). **(b) 잣대 충족**: (1) 픽스 = line 17-19를 형제와 동형의 strict 가드로 교체(`if (typeof args.qualified_name !== 'string' || args.qualified_name.trim() === '') return {isError, ...}`, ~3줄) — 정상 경로·시그니처·반환 형태 무변경, 비-문자열에서만 일관된 isError; (2) 게이트는 `tests/tool-dispatcher.test.ts`에 `qualified_name: 123`/`qualified_name: ''` → isError("Invalid argument") 케이스 추가(기존 `{}` 케이스 유지); (3) M-2 v22와 같은 부류(핸들러 인자-가드 정합성)라 같은 정기-점검 축. **verdict: actionable — Phase 26-2.** (5장 상세) |

> **참고(`qualified_name` 10개 핸들러 전수 대조 결론)**: v23은 M-2 v22의 "스키마-required 인자 핸들러 검증 유무" 각도를 *`qualified_name`을 받는 10개 핸들러 전부*에 재적용했다(`analyze-impact`·`get-callers`·`get-callees`·`get-related-tests`·`get-symbol-details`·`get-risk-profile`·`propose-refactor`·`get-remediation-strategy`[`violation` 검증]·`check-architecture-violations`·`get-setup-context`). **결론**: (1) strict 가드(`typeof !== 'string' || trim()===''`) 미사용은 **1건 — `get-related-tests`(M-2 v23, truthy 가드)**. (2) M-2 v22(search_symbols `query`)는 P25-2로 정합(strict 가드 추가). (3) 나머지 8종 전부 strict 가드 일치. (4) `get-related-tests`의 falsy 메시지("...required")는 형제의 "Invalid argument..." 와 다른 문구라 *메시지 일관성*도 함께 정렬.

---

## 4. 최적화 (LOW) — 추적/이연 (v22 승계 + L-14 신규; L-11/L-13 승계)

| # | 위치 | 내용 |
|---|------|------|
| L-2(v23) | `package.json` (native deps), CI / Dockerfile, `.claude/` 설정 | **Miasma / Phantom Gyp / Node-gyp 공급망 캠페인 포스처 추적 — Cynapx 도달 0건 불변.** 진단 일자 직접 재대조: 컴프로마이즈 패키지 패밀리 전부 Cynapx 트리 "not in tree", native 의존(better-sqlite3 + tree-sitter 0.25.0 + 12 grammar) 무관·악성 버전 미발행, in-tree 에이전트 설정은 `.claude/launch.json` 1개(양성), `.cursor`/`.gemini` 부재. CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지 1차 방어선 유지. **즉각 조치 불필요 — 추적만.** 출처: [Snyk better-sqlite3](https://security.snyk.io/package/npm/better-sqlite3) |
| L-3(v23) | `src/server/api-server.ts` (session-id StreamableHTTP), `package.json:29`(`@modelcontextprotocol/sdk ^1.29.0`) | **MCP SDK v2 — *여전히 pre-alpha*(상태 불변).** 직접 확인: `@modelcontextprotocol/sdk` latest는 **여전히 1.29.0**(2개월 전 publish, v22 시점과 불변), v2는 main 브랜치에서 pre-alpha 개발 중·**stable은 Q3 2026**(스펙 publish 2026-07-28) 예정, v1.x가 production 권장·v2 출시 후 최소 6개월 v1.x 보안/버그 수정 지속. → Cynapx 핀 `^1.29.0` 유지가 옳음. stateless protocol core(SEP-2567 session-id 제거)·Multi-Round-Trip·MCP Apps 마이그레이션은 **v2 stable 전환까지 계속 이연**. P15-3 `handleMcp()` 설계 메모가 출발점. 출처: [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk), [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) |
| L-4(v23) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환. **성능 문제 미관측 — 계속 보류.** 메시지가 작고 round-trip이 드물어 직렬화 병목 아님 |
| L-5(v23) | `src/graph/graph-engine.ts` | 클러스터링 본격 서브그래프 파티셔닝 — 100k+ 노드 실측 시 재검토(**계속 이연**). LPA O(V+E)·`MAX_ITER=20` 캡·count-first 가드(200k)·Fisher-Yates seeded PRNG 직접 재확인 — OOM/편향 방어 정상 |
| L-6(v23) | CI / Dockerfile | Node 24 + tree-sitter 0.25.x 빌드 fragility([node-tree-sitter#268] / [salesforce/agentscript#7: C++20 미설정] 여전히 open·미해결, CVE 아님). CI Node 22/24 매트릭스 그린이나 Node 24 LTS 전환 전 prebuild 재확인. **추적만** |
| L-7(v23) | `src/cli/admin.ts` (cmd* 9개), `tests/admin-cli.test.ts` | **admin CLI 명령 동작의 vitest 게이트 공백 — 비-actionable 추적.** 등록 명령 9개 `cmd*`는 모듈-private(미-export)이라 vitest 직접 호출 불가. **admin.ts 핸들러 export 리팩터 시 함께 게이트화 후보** |
| L-8(v23) | `src/indexer/worker-pool.ts`, `embedding-manager.ts`, `db/database.ts` | **에러-복구·마이그레이션 잔여 분기의 vitest 게이트 공백 — 비-actionable 추적.** worker `worker.on('error')`·queue backpressure·embedding A-7 stale supersedence 레이스·DB migration 잔여 분기는 직접 미검증이나 인접 분기 커버 + 타이밍-flaky 위험. **SCHEMA_VERSION 증분/worker-pool 리팩터 시 함께** |
| L-9(v23) | `src/indexer/update-pipeline.ts` (트랜잭션 보일러플레이트·progress `log.error`), `embedding-manager.ts:184`/`api-server.ts:625` (빈 catch) | **L-9 코드 클린업 잔여 — (b) 잣대 미충족, 비-actionable 추적.** `withWriteTransaction()` 추출은 트랜잭션 경계 5곳 재작성이라 회귀 표면 넓음; 빈 catch 2건은 의도적 silent-drop 방어. **update-pipeline 리팩터 페이즈로 묶어 처리 후보** |
| **L-11(v23)** *(불변 — lockfile 12.10.0 유지)* | `package-lock.json` (better-sqlite3) | **better-sqlite3 lockfile 12.10.0 — Wanted/Latest 12.10.1로 patch 드리프트 불변.** `npm ls better-sqlite3` = `12.10.0` · `npm outdated` = Current 12.10.0 · Wanted 12.10.1 · Latest 12.10.1(v22 시점과 동일, 본 사이클도 12.10.0 유지). 드리프트는 patch-level(12.10.0→12.10.1)이라 영향 미미하고 보안·기능 결함 아님(12.10.0 직접 CVE 0건). **차기 `npm i better-sqlite3@12.10.1` 또는 `npm update`로 정렬 가능.** **verdict: 추적 — 다음 의존성 정렬 사이클** |
| **L-13(v23)** *(승계 — analyze-impact use_cache 스키마-default 미강제, 무해)* | `src/server/tools/analyze-impact.ts:23` (`useCache: args.use_cache` 무검증·default 미강제) | **`analyze-impact` 핸들러가 `use_cache`(스키마 default `true`)를 검증·default-강제 없이 그대로 `traverse({useCache: args.use_cache})`에 전달 — 무해.** `args.use_cache`가 `undefined`면 traverse 내부 truthy 평가에서 캐시 *비활성*으로 동작(스키마 default `true`와 어긋날 수 있으나 *느려질 뿐* 정확성·크래시 영향 0). 동형 무해 패턴이 `export-graph`(`format`/`max_depth`)·`get-symbol-details`(`include_source`/`summary_only`)에도 존재 — 전부 다운스트림 undefined-안전. **verdict: 추적만(비-actionable)** |
| **L-14(v23)** *(신규 — CVE-2026-25727 `time` 크레이트, Cynapx 미도달)* | (외부 — Rust `time` crate via tree-sitter Rust 생태계 언급), Cynapx prod 트리 무관 | **CVE-2026-25727(RFC 2822 파싱 스택 소진 DoS, `time` 크레이트 0.3.6~<0.3.47)은 *tree-sitter*로 거론되나 실제로는 Rust `time` 크레이트 결함 — Cynapx prod 트리 미도달.** 직접 확인: 본 CVE는 tree-sitter npm 바인딩/그래머가 아니라 Rust `time` 크레이트의 RFC 2822 날짜 파싱(formally-deprecated 기능)에 있고, *비-악성 입력은 절대 도달 불가*. Cynapx의 의존 표면(npm tree-sitter 0.25.0 + 12 grammar)에 `time` 크레이트는 부재이고, optional Rust/NAPI 가속 모듈도 사용자-제공 RFC 2822 문자열을 파싱하지 않는다 → **prod·dev 미도달, audit 0/0 불변**. 단 tree-sitter Rust 생태계 모니터링 신호로 추적. **verdict: 추적만(비-actionable — 미도달)** 출처: [NVD CVE-2026-25727](https://nvd.nist.gov/vuln/detail/CVE-2026-25727), [cvedetails CVE-2026-25727](https://www.cvedetails.com/cve/cve-2026-25727) |

> **신규 LOW 부재 안내(prod 코드 동작 변경)**: M-1 v23(mergeResultsRRF 게이트, 테스트-only)·M-2 v23(get-related-tests 가드 정렬 ~3줄)을 제외하면 prod 코드 *동작* 변경을 요하는 신규 LOW는 0건이다(L-11 lockfile은 의존성 정렬, L-13/L-14는 무해·미도달 추적).

---

## 5. 코드 품질 / 성능 전수 (서버 핸들러 보조 순수 로직 + qualified_name 10개 전수 대조 + steady-state 재확인)

v22까지 graph/ 엔진 처방 5종이 전수 게이트화됐다(architecture/optimization/remediation/refactoring-getRiskProfile+proposeRefactor/policy). v23은 **(1) 그 *다음* 미커버 후보로 *서버 핸들러 보조 순수 로직*(`_utils.ts`)을 실측**하고, **(2) M-2 v22의 인자-가드 정합성 각도를 `qualified_name` 10개 핸들러 전부로 재적용**한다.

**(1) 서버 핸들러 보조 순수 로직 ×테스트 대조 (신규 각도)**

| 순수 함수 (`_utils.ts`) | 라이브 도구 | 로직 | 직접 단위 테스트 | 판정 |
|------------------------|------------|------|-----------------|------|
| `mergeResultsRRF()` (35-49줄) | `search_symbols`(semantic 모드) | RRF 융합: `1/(k+rank+1)` 점수·dedup boost·정렬·limit slice | **0건**(`grep` `mergeResultsRRF`/`tools/_utils` import 0) | **M-1 v23 — Phase 26-1** (의존 0 순수 함수, 배열 in/out → 가장 가벼운 게이트) |
| `escapeXml()` (51-53줄) | `export_graph`(graphml) | `&`/`<`/`>`/`"` → 엔티티 치환 | 0건 | 추적(M-1과 함께 게이트 가능하나 RRF 우선 — 단순 치환이라 우선순위 낮음) |
| `escapeDot()` (55-57줄) | `export_graph`(dot) | `\`/`"` 이스케이프 | 0건 | 추적(상동) |

핵심: graph/ 엔진은 v22로 전수 게이트됐으나, *그 도구 핸들러가 호출하는 보조 순수 로직*(`_utils.ts`)은 게이트 밖이었다. 그중 `mergeResultsRRF`는 단순 치환(`escapeXml`/`escapeDot`)과 달리 *RRF 점수 누적·dedup·정렬*이라는 실질 비즈니스 로직이라 (b) 잣대를 가장 깨끗하게 충족(M-1 v23). `escapeXml`/`escapeDot`은 단순 정규식 치환이라 게이트 가치가 낮아 함께 추가하거나 추적.

**(2) `qualified_name` 핸들러 10개 전수 대조 (M-2 v22 각도 재적용)**

| 핸들러 | `qualified_name` 가드 | 판정 |
|--------|----------------------|------|
| `analyze-impact`·`get-callers`·`get-callees`·`get-symbol-details`·`get-risk-profile`·`propose-refactor` (+ `get-remediation-strategy`의 `violation`, `get-setup-context`) | `typeof !== 'string' \|\| trim()===''` strict | 정합 |
| `search-symbols` (`query`) | P25-2로 strict 가드 추가 | 정합(M-2 v22 [DONE]) |
| **`get-related-tests`** | **`if (!args.qualified_name)` truthy** | **M-2 v23 — Phase 26-2** (비-문자열 truthy 우회 → "Symbol not found" 오메시지) |

**(3) prod steady-state 재확인 — 신규 prod 코드 결함 0**

| 항목 | 판정 |
|------|------|
| god-module / 순환 import | 0 — `openapi.ts`·`update-pipeline.ts`·`graph-engine.ts` 응집 불변. repos→engines→server/pipeline 단방향 |
| TODO/FIXME/XXX/HACK | 0건(`src/` 전수) |
| 핫패스 O(n²)-over-nodes | 0 — 클러스터링 count-first 가드(200k)+seeded PRNG, BFS index-pointer 큐, 반복 DFS+60s 캐시, architecture-engine O(1) Map(P22-1) |
| prod·dev audit | 0 / 0 vulnerabilities |
| 테스트 | `npx vitest run` **634/634**(46 파일, 6.84s) — 추세 무문제(618→6.72s 대비 +16케이스·+0.12s) |

**(4) 에러 핸들링 일관성 — 양호(단 M-2 v23 get-related-tests 메시지 불일치)**

`Logger`(stderr-only, MCP stdio 안전) `normalizeData()` Error 언랩. update-pipeline catch는 log-and-rethrow + 롤백 선행. 미세 항목(progress log.error·빈 catch 2건)은 L-9 비-actionable 추적. **M-2 v23의 get-related-tests truthy 가드는 *입력-가드 정합성*(비-문자열 우회) + *메시지 일관성*(형제와 다른 문구) 결함이라 별도 actionable화.**

---

## 6. 외부 컨텍스트 (웹 조사 — 진단 일자 재실행, 출처 명시)

### 6.1 의존성 취약점 (prod·dev 둘 다 clean)

- **`npm audit`(dev 포함) = 0 + `npm audit --omit=dev`(prod) = 0**(둘 다 직접 실행). Phase 21-1 postcss override가 dev 트리도 clean 유지.
- **`npm ls better-sqlite3` = `12.10.0` + `npm outdated`(직접 실행)**: prod 코드 *동작* 변경을 요하는 긴급 업그레이드 0건. **L-11 불변 — better-sqlite3 lockfile 12.10.0(Wanted/Latest 12.10.1).** 잔여 드리프트: `tree-sitter-c-sharp` 0.23.1 핀(0.23.5 latest이나 ERR_REQUIRE_ASYNC_MODULE 미해소 → 핀 유지가 옳음), `express`/`commander`/`typescript`/`@types/*` major(5.x/15/6.x — 비-긴급 major, 즉시 비권장), `zod` 4.3.6→4.4.3·`vitest` 4.1.2→4.1.9·`@types/node` 20.19.33→25.x(dev, 다음 갱신 시 정렬).
- **better-sqlite3 / chokidar / tree-sitter / @modelcontextprotocol/sdk 직접 재확인(웹)**: better-sqlite3 직접 CVE 0건(latest 12.10.1 — "Node-gyp Supply Chain June 2026" 패밀리 거론되나 Cynapx 핀은 악성 미발행), chokidar non-vulnerable(CVE-2021-35065는 무효 보고), tree-sitter npm 바인딩 직접 CVE 0건(CVE-2026-25727은 Rust `time` 크레이트 — L-14, Cynapx 미도달), @modelcontextprotocol/sdk 1.29.0 직접 CVE 0건. 출처: [Snyk better-sqlite3](https://security.snyk.io/package/npm/better-sqlite3), [Snyk chokidar](https://security.snyk.io/package/npm/chokidar)

### 6.2 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"` + Docker `node:22-bookworm-slim`. Node 22 LTS 2027-04 종료 — 여유. CI Node 22/24 매트릭스 그린(634/634). 문서 Node 버전(L-12, P24-2 해소)은 README/README_KR/GUIDE_EN/GUIDE_KR 전부 ≥ 22 정렬 유지.
- **tree-sitter 코어**: latest 0.25.0, 12 grammar 전부 dedupe/override. **tree-sitter-c-sharp**: 0.23.1 정확 핀 롤백 유지. Node 24 빌드 C++20 fragility([salesforce/agentscript#7]·[node-tree-sitter#268] open) — L-6 추적.
- **better-sqlite3**: lockfile 12.10.0(L-11 불변, Wanted 12.10.1).

### 6.3 공급망 캠페인 — Miasma / Phantom Gyp / Node-gyp June 2026 (계속 진행 중, Cynapx 도달 0건 불변)

진단 일자 직접 재대조: 컴프로마이즈 패밀리 전부 Cynapx 트리 "not in tree", native 의존 무관·악성 버전 미발행, in-tree 설정은 `.claude/launch.json` 1개(양성), `.cursor`/`.gemini` 부재. CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지. **즉각 변경 불필요, 포스처 추적.** 출처: [Snyk better-sqlite3](https://security.snyk.io/package/npm/better-sqlite3)

### 6.4 MCP 생태계 — SDK v2 여전히 pre-alpha (상태 불변)

- **MCP SDK v2가 여전히 pre-alpha**(직접 확인): `@modelcontextprotocol/sdk` latest는 **여전히 1.29.0**(v22 시점과 불변, 2개월 전 publish). v2는 main 브랜치에서 pre-alpha 개발 중, **stable은 Q3 2026**(스펙 publish 2026-07-28) 예정, v1.x가 production 권장·v2 출시 후 최소 6개월 v1.x 유지. → **Cynapx 핀 `^1.29.0` 유지가 옳다. stateless core/Tasks/MCP Apps/Multi-Round-Trip 마이그레이션(L-3)은 v2 stable까지 계속 이연.** 출처: [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk), [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases)
- **함의**: Cynapx 현 StreamableHTTP(session-id)는 v2 stateless core와 충돌 표면이 있으나 *마이그레이션은 stable 배포까지 이연*이 옳다.

### 6.5 경쟁/인접 도구 동향 (전략 추적 — 카테고리 지속 폭발)

- **로컬-퍼스트 코드 그래프 카테고리 지속 폭발**: **CodeGraph**(tree-sitter→SQLite 심볼/콜/임포트 그래프 MCP 서버, OS-native 파일 워처 증분 동기화, 8개 에이전트 통합, 2026-01 런칭 5개월 만에 **47.4K stars** — 카테고리 최대), **Serena**(LSP-over-MCP, 25.2K stars, MIT, 심볼-레벨 검색/편집 표준), **GitNexus**(zero-server LadybugDB on-device), **CodeGraphContext**·**code-review-graph** 등이 "로컬·on-device·MCP·임베디드 SQLite·no-embeddings-API·no-code-egress" 패턴을 표준 기본값으로 정착. Cynapx의 "100% 로컬·격리·멀티프로세스 보안 IPC + risk/remediation/refactoring/policy *처방* 엔진 + 하이브리드(keyword+vector RRF) 검색" 포지션이 차별점. **함의: 처방 엔진 진입 로직은 v22로 전수 게이트 완성됐고, v23은 *그 처방·검색을 떠받치는 RRF 융합(M-1)*과 *핸들러 입력 위생(M-2)*을 게이트로 메워 차별 가치의 회귀 안전망을 한 겹 더 완성.** 출처: [CodeGraph](https://github.com/colbymchenry/codegraph), [Code Intelligence Tools Compared](https://rywalker.com/research/code-intelligence-tools)
- **SCIP가 LSIF 대체 심볼 인덱스 표준 정착** — `export_graph`에 SCIP 추가는 미래 상호운용 후보. protobuf 의존 부담으로 즉시 비권장 — 전략 후보 유지.
- **함의**: (1) 공급망 위생 유지, (2) MCP SDK v2 pre-alpha→stable 추적, (3) **회귀 안전망을 처방·검색 보조 순수 로직(RRF 융합)까지 확장**(M-1 v23), (4) **핸들러 입력-가드 정합성·메시지 일관성**(M-2 v23)이 신뢰성 차별화 축.

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 정밀 재열람에서 신규 prod 코드 결함이 없었다(M-1 v23은 미커버 순수 함수 게이트, M-2 v23은 get-related-tests 가드 정렬):

- `src/watcher/file-watcher.ts` — chokidar `ignored` 프레디킷·확장자 allowlist·flush 동시성·타이머 위생·대용량-배치 git-sync 라우팅·재시도/FATAL 강등(P20-1) 정상.
- `src/graph/graph-engine.ts` — Fisher-Yates + seeded PRNG + count-first 가드(200k) + BFS index-pointer 큐·반복 DFS 모두 O(V+E). `traverse('incoming')` direction 분기 정상.
- `src/graph/architecture-engine.ts`(P22-1)·`optimization-engine.ts`(P23-2)·`remediation-engine.ts`(P23-1)·`policy-discoverer.ts`(P24-1)·`refactoring-engine.ts` getRiskProfile(P23-3)+proposeRefactor(P25-1) — 처방 엔진 5종 진입 로직 전수 게이트 커버.
- `src/server/tools/*.ts` — `qualified_name` 10개 전수 대조: 9종 strict 가드 일치. **단 `get-related-tests.ts`만 truthy 가드 — M-2 v23.**
- `src/server/tools/_utils.ts` — `requireEngine`(H-1, 디스패처 테스트 커버)·`escapeXml`/`escapeDot`(단순 치환, 간접 커버). **단 `mergeResultsRRF`(RRF 융합)는 직접 단위 테스트 0건 — M-1 v23.**
- `src/server/tools/search-symbols.ts` — `query` strict 가드(P25-2)·`limit` 클램프·`Promise.allSettled` O-12 가드 정상. **단 그 안에서 호출하는 `mergeResultsRRF`가 미커버 — M-1 v23.**
- `src/indexer/update-pipeline.ts` — 단일 책임·catch log-and-rethrow+롤백·원본 에러 보존(미세 항목만 L-9).
- `src/indexer/metrics-calculator.ts` — cyclomatic 복잡도(TS AST + tree-sitter DFS·연산자/case-label 분기) metrics-calculator.test.ts 커버.
- `src/server/api-server.ts` — 세션 TTL/cap/sweep·timing-safe Bearer·8 REST 핸들러 supertest 게이트(P19-1)·rate-limit 양호.
- `src/server/ipc-coordinator.ts` — challenge-response 인증·1MB 제한·per-tool 타임아웃·keepalive(unref)·pending reject-on-close 견고.
- `src/server/tool-dispatcher.ts` — Terminal 포워딩·waitUntilReady·registry lookup·EngineNotReadyError 재시도 변환. 20/20 게이트(P18-1).
- `src/server/workspace-manager.ts`/`health-monitor.ts` — 버전-미스매치 reindex·dispose 순서(watcher→worker→DB)·ledger 일관성 체크 견고(직접 재열람).
- `package.json` overrides — tree-sitter `^0.25.0`·fast-uri·qs·hono·postcss 충족, dev·prod audit 0/0. **better-sqlite3 lockfile 12.10.0 — L-11.**
- `README.md`/`README_KR.md`/`GUIDE_EN.md`/`GUIDE_KR.md` — Node ≥ 22 전부 정렬(P24-2, L-12 해소).
- `.github/workflows/ci.yml` — Node 22/24 매트릭스 + `npm audit --omit=dev --audit-level=high`(P14-1) + `npm ci`. (cynapx-autonomous.yml은 본 진단 범위 외.)
- TODO/FIXME/XXX/HACK = 0건(`src/` 전수).

---

## 8. 권장 수정 순서 (Phase 26 제안 — 상세는 phase26-plan.md)

**Phase 25 이후 prod 코드는 steady-state(CRITICAL/HIGH 0, prod·dev audit 0/0, TODO 0, god-module 0, 핫패스 quadratic 0)이고 신규 prod-도달 CVE도 0건이나, v23은 v22가 graph/ 엔진을 전수 게이트한 뒤 *그 다음 미커버 후보*를 두 신규 각도로 발굴했다(서버 핸들러 보조 순수 로직 mergeResultsRRF + `qualified_name` 10개 전수 대조에서 get-related-tests truthy 가드).** CRITICAL/HIGH 0, MEDIUM 2(M-1 v23 mergeResultsRRF 게이트 — 테스트-only; M-2 v23 get-related-tests strict 가드 정렬 — ~3줄+게이트), LOW(L-2~L-9 v22 승계 + L-11 불변[lockfile 12.10.0] + L-13 승계[analyze-impact use_cache 무해] + L-14 신규[CVE-2026-25727 time 크레이트 미도달]). 따라서 Phase 26은 **mergeResultsRRF 게이트(P26-1, 테스트-only) + get-related-tests `qualified_name` strict 가드 정렬+게이트(P26-2, ~3줄) + 추적 갱신**이 합리적이다.

1. **P26-1 [DONE — Phase 26-1]**: M-1 v23 해소 — `tests/` 신규로 `mergeResultsRRF()`의 RRF 점수 공식(`1/(k+rank+1)`)·dedup boost(양쪽 출현 시 점수 누적)·내림차순 정렬·limit slice·빈-입력 경계를 결정적으로 게이트(`import { mergeResultsRRF }` 후 노드 배열 리터럴만 — 의존 0, 테스트-only, prod 코드 무변경). **이로써 검색 처방을 떠받치는 RRF 융합까지 회귀 게이트 커버.**
2. **P26-2 [DONE — Phase 26-2]**: M-2 v23 해소 — `src/server/tools/get-related-tests.ts:17`의 truthy 가드를 형제 핸들러(`analyze-impact:12`)와 동형의 strict 가드(`typeof !== 'string' || trim()===''`)로 정렬(~3줄) + `tests/tool-dispatcher.test.ts`에 `qualified_name: 123`/`qualified_name: ''` → isError("Invalid argument") 케이스 추가. **prod ~3줄 + 테스트.**
3. **추적 상태 갱신**: L-2(Miasma/Node-gyp 도달 0 불변), L-3(SDK v2 *여전히 pre-alpha* — stable Q3까지 이연), L-6(node-tree-sitter#268·C++20 fragility open), L-7/L-8 게이트 공백, L-9 잔여 클린업, **L-11 불변(better-sqlite3 lockfile 12.10.0→12.10.1 정렬 후보)**, L-13(analyze-impact use_cache 무해), **L-14 신규(CVE-2026-25727 time 크레이트 — Cynapx 미도달)** 현 상태를 다음 사이클 출발점으로 고정.

(L-4 IPC MessagePack 계속 보류, L-5 클러스터링 본격 파티셔닝 계속 이연, MCP 전면 stateless/task 마이그레이션은 SDK v2 stable 배포까지 이연, `escapeXml`/`escapeDot` 단순-치환 게이트는 우선순위 낮아 M-1과 함께 또는 추적, SCIP export는 전략 후보로 기록만.)
