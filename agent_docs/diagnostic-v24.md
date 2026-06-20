# Cynapx 정밀 진단 보고서 v24

- **기준 커밋**: `473acf8` (Phase 26 + Phase 26-1/26-2 완료 + vite `^8.0.16` dev-bump, 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-15
- **진단 범위**: src/ 전체(server, db, indexer, graph, watcher, utils, cli, bootstrap) + **v23이 `_utils.ts`의 `mergeResultsRRF`(RRF 융합)를 게이트(M-1 v23 — P26-1)하고 `get-related-tests`의 `qualified_name` strict 가드를 정렬(M-2 v23 — P26-2)한 지금, 그 *다음* 미커버 후보를 두 각도로 실측**: (1) v23 §5가 `_utils.ts`의 *나머지* 순수 함수 `escapeXml`/`escapeDot`을 "단순 정규식 치환, 우선순위 낮은 추적만"으로 남겼는데 — `mergeResultsRRF` 게이트가 P26-1로 끝난 지금 *같은 파일·같은 부류(라이브 도구 `export_graph` 뒤 0-의존 순수 함수)의 마지막 미커버 후보*가 게이트할 가치가 생겼는지(특히 `export_graph` 디스패처 테스트가 *escape 동작 자체*(특수문자 치환)는 단언하지 않음을 실측); (2) L-11(better-sqlite3 lockfile 드리프트)이 v23 시점 `12.10.0 vs 12.10.1`이었는데 본 사이클 `npm outdated` 재실행 결과 *드리프트가 12.10.0 vs **12.11.1**로 확대*됐는지 — clean한 minor bump이면 의존성-정렬 actionable로 승격 가능한지 — + L-2/L-3/L-6/L-14 재확인 + 외부 컨텍스트(CVE/advisory, 공급망 캠페인, MCP SDK v2 npm 배포 상태, 경쟁/인접 도구)
- **진단 방법**: 단일 에이전트 오케스트레이션 + 회의적 전수 코드 리뷰 + 로컬 직접 검증(`npx vitest run`[시간·케이스 수 측정], `npx tsc --noEmit`, `npm audit`[dev 포함]·`npm audit --omit=dev`, `npm ls better-sqlite3`·`npm outdated`로 버전 드리프트 확인) + **신규 각도 2종: (1) v23이 `mergeResultsRRF`(P26-1)·`requireEngine`(디스패처 커버)를 게이트한 뒤 `_utils.ts`에 남은 *마지막* export 순수 함수 `escapeXml`/`escapeDot`이 라이브 도구 `export_graph`(graphml/dot)에서 호출되나 — `tests/tool-dispatcher.test.ts`의 `export_graph` 테스트(360-410줄)가 `<graphml`/`digraph G {` *구조 존재*만 단언하고 *escape 동작*(`&`→`&amp;`, `<`→`&lt;`, `"`→`&quot;` / `\`→`\\`, `"`→`\"`)은 *전혀 단언하지 않음*을 `grep`으로 실측. (2) L-11 lockfile 드리프트를 `npm outdated`로 재측정해 v23 시점(`12.10.0 vs 12.10.1`)에서 확대됐는지 확인.** + 외부 웹 재조사(better-sqlite3·MCP SDK v2 npm 배포 상태·tree-sitter/chokidar/vite CVE·공급망 캠페인·경쟁 도구)
- **현재 상태(직접 검증)**: `npx vitest run` **642/642**(47 파일, **8.12s** — 634→6.84s 대비 케이스 +8(P26-1 6 + P26-2 2)·시간 +1.28s[머신 변동, 추세 무문제]), `npx tsc --noEmit` 그린, **`npm audit`(dev 포함) = 0 vulnerabilities**, **`npm audit --omit=dev`(prod) = 0 vulnerabilities**. diagnostic-v23 전 항목 처리 완료(M-1 v23 [DONE — P26-1], M-2 v23 [DONE — P26-2]), LOW 승계 추적. **공급망: 별도 커밋 `473acf8`이 vite devDependency를 `^8.0.16`으로 bump해 신규 고-심각도 dev advisory(GHSA-v6wh-96g9-6wx3 / GHSA-fx2h-pf6j-xcff — launch-editor NTLMv2 / `server.fs.deny` Windows bypass, 둘 다 vitest@4.1.2의 transitive vite 의존)를 해소 — 본 진단 시점 `npm audit`·`npm audit --omit=dev` 모두 0 재확인(L-15 [해소]).**

> **요약**: **Phase 26까지 prod 코드는 steady-state(CRITICAL/HIGH 0, prod·dev audit 0/0, TODO 0, god-module 0, 핫패스 quadratic 0)이고, 외부도 신규 prod-도달 CVE 0건(better-sqlite3·chokidar·tree-sitter·vite·@modelcontextprotocol/sdk 직접 재확인)이다.** **v23이 `_utils.ts`의 `mergeResultsRRF`를 게이트하고 `get-related-tests` 가드를 정렬해 graph/ 엔진 5종 + 핸들러 보조 핵심 순수 로직(RRF) + `qualified_name` 10개 핸들러 strict 가드를 *모두* 게이트로 덮은 지금, v24는 그 *마지막 잔여 미커버 후보*를 드러낸다.** **신규 M-1 v24: `src/server/tools/_utils.ts`의 순수 함수 `escapeXml`(51-53줄)·`escapeDot`(55-57줄)은 라이브 MCP 도구 `export_graph`의 graphml(`export-graph.ts:34,39`)·dot(`export-graph.ts:50,55`) 포맷 뒤에서 노드/엣지 식별자를 이스케이프하나 — *escape 동작 자체에 대한 단위 테스트가 0건*이다. `tests/tool-dispatcher.test.ts`의 `export_graph` 테스트(383-409줄)는 `<graphml`·`<node`·`<edge`·`digraph G {`·`->`·`}` 같은 *구조 토큰 존재*만 단언할 뿐, escape 입력에 특수문자(`&`/`<`/`>`/`"`/`\`)가 *없는 평범한 qualified_name 픽스처*를 쓰므로 — `&`→`&amp;`·`<`→`&lt;`·`>`→`&gt;`·`"`→`&quot;`(escapeXml) / `\`→`\\`·`"`→`\"`(escapeDot)·*치환 순서*(escapeXml이 `&`를 가장 먼저 치환해 이중-이스케이프를 피함)·*다중 출현 전역 치환*(`/g` 플래그)이 *전부 미커버*다. 이는 v23이 "단순 정규식 치환이라 게이트 가치 낮음, 추적만"으로 남긴 항목이나(§5), `mergeResultsRRF` 게이트(P26-1)가 *같은 파일에 `tests/_utils.test.ts`를 이미 신설*한 지금 — 그 파일에 `import { escapeXml, escapeDot }`만 추가하면 *의존 0(문자열 in → 문자열 out, DB·async·side-effect·픽스처 전무)*이라 가장 가벼운 게이트로 `_utils.ts`의 *3개 export 순수 함수 전부(mergeResultsRRF·escapeXml·escapeDot)를 100% 커버*해 닫는다. 특히 escapeXml의 *`&`-우선 치환 순서*는 평범한 정규식 치환이 아니라 *이중-이스케이프 회피*라는 실질 정합성 속성이라 회귀 게이트 가치가 있다(예: `<`를 먼저 치환하면 `&lt;`의 `&`가 다시 `&amp;lt;`로 이중-이스케이프됨 — 현 코드는 `&`를 먼저 치환해 회피하나 미커버이므로 순서 회귀를 잡지 못함). → Phase 27-1(테스트-only, prod 코드 무변경).** **신규 M-2 v24: L-11(better-sqlite3 lockfile 드리프트)을 `npm outdated`로 재측정한 결과 *드리프트가 v23 시점 `12.10.0 vs 12.10.1`(patch)에서 `12.10.0 vs **12.11.1**(minor)로 확대*됐다 — `npm ls better-sqlite3` = `12.10.0`, `npm outdated` = Current `12.10.0` · Wanted/Latest `12.11.1`. 12.11.x는 직접 CVE 0건의 clean한 minor bump(Electron 빌드 타깃 추가 등 기능-only, 보안 결함 무관)이고, `package.json` 핀은 `^12.0.0`이라 *lockfile만 갱신*하면 정렬된다(`package.json` 무변경). v23이 "추적 — 다음 의존성 정렬 사이클"로 둔 L-11을 본 사이클은 *actionable한 의존성-정렬 항목으로 승격*한다(드리프트가 minor로 벌어졌고 clean bump이며, v23이 명시적으로 "L-11은 다음 의존성 정렬 사이클의 actionable 후보"라고 예고). `npm i better-sqlite3@12.11.1`(또는 `npm update better-sqlite3`) 후 `npm ci`-동등 재빌드 + 642 그린 + audit 0/0 재확인. → Phase 27-2(lockfile-only 정렬 + 베이스라인 재확인).** **외부 신선 재조사: better-sqlite3 12.11.1 직접 CVE 0건(2시간 전 publish, latest), MCP SDK v2 *여전히 pre-alpha*(`@modelcontextprotocol/sdk` latest 1.29.0 불변, v2 stable Q3 2026[7-28 publish 예정], v1.x production 권장 → 핀 `^1.29.0` 유지가 옳음[L-3]), vite advisory(GHSA-v6wh-96g9-6wx3 / GHSA-fx2h-pf6j-xcff)는 `^8.0.16` bump(`473acf8`)로 *이미 해소*(L-15 [해소]), tree-sitter npm 바인딩 직접 CVE 0건(CVE-2026-25727은 Rust `time` 크레이트 — L-14, Cynapx 미도달 불변), node-tree-sitter#268(C++20/Node 24 빌드) 여전히 open(L-6 불변). 경쟁: CodeGraph(detect_changes/rename/generate_map 추가)·Serena·GitNexus·Codebase-Memory(900+ stars 4주)·code-graph-mcp 등 로컬-퍼스트 tree-sitter+SQLite+MCP 코드 그래프 카테고리 지속 폭발 — Cynapx의 처방 엔진(risk/remediation/refactoring/policy) + 하이브리드(keyword+vector RRF) 검색이 차별점, 그 진입·보조 순수 로직은 v22~v23으로 전수 게이트 완성, v24는 *남은 마지막 보조 순수 함수(escape)*와 *의존성 위생(lockfile 정렬)*을 닫는다.** **CRITICAL 0, HIGH 0, MEDIUM 2(M-1 v24 escapeXml/escapeDot 게이트 — Phase 27-1, 테스트-only; M-2 v24 better-sqlite3 lockfile 12.10.0→12.11.1 정렬 — Phase 27-2, lockfile-only), LOW(L-2~L-9 v23 승계 + L-11 [해소-승격 → M-2 v24] + L-13 승계[analyze-impact use_cache 무해] + L-14 승계[CVE-2026-25727 time 크레이트 미도달] + L-15 [해소 — vite ^8.0.16 dev-bump]).**

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건은 Phase 13에서, v11 HIGH(공급망)는 Phase 14-1에서, v12~v18 MEDIUM은 Phase 15~21에서, v19 MEDIUM은 Phase 22-1에서, v20 MEDIUM 2건+L-10 부분은 Phase 23에서, v21 MEDIUM 2건+L-12는 Phase 24에서, v22 MEDIUM 2건은 Phase 25에서, v23 MEDIUM 2건은 Phase 26에서 해소됐고, 본 전수 재열람에서 새로운 CRITICAL/HIGH는 없다. IPC 핸드셰이크(challenge + HMAC-SHA256 + timingSafeEqual)·API Bearer(SHA-256 + timingSafeEqual)·세션 맵(TTL+cap+sweep unref) 모두 견고(직접 재열람).

---

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** 코드·공급망 어디에서도 신규 HIGH 없음. **prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0**(직접 재검증). 신규 고-심각도 dev advisory(GHSA-v6wh-96g9-6wx3 / GHSA-fx2h-pf6j-xcff, vitest@4.1.2 transitive vite)는 별도 커밋 `473acf8`의 vite `^8.0.16` bump로 *이미 해소*(L-15 [해소] — 본 진단 시점 audit 0/0 재확인). M-1 v24(escapeXml/escapeDot 게이트 격차)·M-2 v24(better-sqlite3 lockfile 드리프트)는 MEDIUM이다 — M-1은 게이트 공백(보안·크래시 결함 아님, escape 동작 미커버), M-2는 의존성 위생(clean minor bump 정렬, 보안 결함 아님). 외부 CVE-2026-25727(`time` 크레이트)도 Cynapx prod 트리 미도달이라 LOW(L-14 불변).

---

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

| # | 위치 | 내용 |
|---|------|------|
| **M-1 v24** *(신규, actionable — `_utils.ts` 마지막 미커버 순수 함수. v23이 `mergeResultsRRF`를 게이트하고 escapeXml/escapeDot을 "추적만"으로 남긴 뒤 그 마지막 후보를 닫는 각도)* **[DONE — Phase 27-1]** | `src/server/tools/_utils.ts`(`escapeXml()` 51-53줄·`escapeDot()` 55-57줄), `src/server/tools/export-graph.ts:34,39`(graphml escapeXml 호출)·`:50,55`(dot escapeDot 호출), `tests/tool-dispatcher.test.ts:383-409`(`export_graph` 구조-토큰만 단언, escape 동작 미커버), `tests/_utils.test.ts`(P26-1 신설 — `mergeResultsRRF`만 커버) | **`escapeXml()`·`escapeDot()`의 이스케이프 동작에 회귀 게이트 추가.** 두 순수 함수는 라이브 MCP 도구 `export_graph`의 graphml(`<node id="${escapeXml(...)}"/>`·`<edge source="${escapeXml(...)}".../>`)·dot(`"${escapeDot(...)}";`·`"${escapeDot(src)}" -> ...`) 출력에서 노드/엣지 식별자를 이스케이프하나 **escape 동작 자체에 대한 단위 테스트가 0건**: `tests/tool-dispatcher.test.ts`의 `export_graph` 테스트는 `<graphml`·`<node`·`<edge`·`digraph G {`·`->`·`}` *구조 토큰 존재*만 단언하고, *escape 입력에 특수문자가 없는 평범한 qualified_name 픽스처*를 쓴다 → 미커버 로직: (a) escapeXml `&`→`&amp;`·`<`→`&lt;`·`>`→`&gt;`·`"`→`&quot;`(line 52), (b) **escapeXml `&`-우선 치환 순서**(이중-이스케이프 회피 — `<`를 먼저 치환하면 `&lt;`의 `&`가 `&amp;lt;`로 이중-이스케이프됨; 현 코드는 `&`를 가장 먼저 치환해 회피하나 미커버이므로 *순서 회귀를 잡지 못함*), (c) escapeDot `\`→`\\`·`"`→`\"`(line 56), (d) `/g` 전역 플래그(한 문자열 내 다중 출현 전부 치환), (e) 특수문자 없는 입력은 무변경. **(b) 잣대 충족**: (1) prod 코드 무변경(테스트-only); (2) *의존 0* — 문자열 in → 문자열 out, DB·async·side-effect·픽스처 전무 → P26-1이 신설한 `tests/_utils.test.ts`에 `import { escapeXml, escapeDot }`만 추가하면 됨; (3) M-1 v23(mergeResultsRRF)과 *동형의 같은-파일·같은-부류 게이트*로, **이로써 `_utils.ts`의 3개 export 순수 함수(mergeResultsRRF·escapeXml·escapeDot) 100% 커버해 핸들러 보조 순수 로직 미커버 공백을 0으로 닫는다.** escapeXml의 `&`-우선 순서는 단순 치환이 아닌 *정합성 속성*이라 회귀 가치가 명확. **verdict: actionable — Phase 27-1.** (5장 상세) |
| **M-2 v24** *(신규, actionable — L-11 lockfile 드리프트 승격. v23이 "다음 의존성 정렬 사이클 actionable 후보"로 예고했고 본 사이클 드리프트가 minor로 확대)* **[DONE — Phase 27-2]** | `package-lock.json`(better-sqlite3 `12.10.0`), `package.json:31`(핀 `^12.0.0` — 변경 불필요), `npm outdated`(Current 12.10.0 · Wanted/Latest **12.11.1**) | **better-sqlite3 lockfile을 12.10.0 → 12.11.1로 정렬.** v23 시점 L-11은 `12.10.0 vs 12.10.1`(patch 드리프트)였으나 본 사이클 `npm outdated` 재실행 결과 *Wanted/Latest가 **12.11.1**로 갱신*돼 드리프트가 *minor-level로 확대*됐다(`npm ls better-sqlite3` = 12.10.0). 12.11.x는 직접 CVE 0건의 clean한 minor bump(Electron 빌드 타깃 추가 등 기능-only, 보안·정확성 결함 무관 — `npm audit` 0 불변)이고, `package.json` 핀이 `^12.0.0`이라 *lockfile만 갱신*하면 정렬된다(`package.json` 무변경, semver-호환). **(b) 잣대 충족**: (1) 변경 = `npm i better-sqlite3@12.11.1`(또는 `npm update better-sqlite3`)로 `package-lock.json`의 better-sqlite3 엔트리만 갱신 — prod 코드 무변경, 핀 무변경; (2) 검증 = 재빌드(better-sqlite3는 native 모듈이라 prebuild 재설치) 후 `npx vitest run` 642 그린 + `npx tsc --noEmit` 그린 + `npm audit`·`npm audit --omit=dev` 0/0 재확인; (3) v23이 L-11을 명시적으로 "다음 의존성 정렬 사이클 — `npm i better-sqlite3@12.10.1`"로 예고했고 본 사이클이 그 사이클이며 드리프트가 더 벌어져 정렬 가치가 커짐. **verdict: actionable — Phase 27-2.** (5장 상세) |

> **참고(M-2 v24 = L-11 승격 근거)**: v23 §4 L-11은 "lockfile 12.10.0 — Wanted/Latest 12.10.1 patch 드리프트 불변, **다음 의존성 정렬 사이클 actionable 후보**"로 기록됐다. 본 사이클은 (1) 드리프트가 `12.10.0 vs 12.11.1`(minor)로 확대됐고, (2) bump가 clean(CVE 0, 기능-only, semver-호환 — 핀 `^12.0.0` 무변경), (3) v23이 명시적으로 다음 사이클 정렬을 예고했으므로 — 작고(lockfile-only) 리스크 낮은(clean minor) actionable로 승격한다. 이는 과거 L-11이 P21(v20→12.10.1 정렬)에서 actionable화됐던 전례와 동형(이후 재-드리프트는 더 큰 minor로 누적).

---

## 4. 최적화 (LOW) — 추적/이연 (v23 승계 + L-15 신규-해소; L-11 [해소-승격 → M-2 v24])

| # | 위치 | 내용 |
|---|------|------|
| L-2(v24) | `package.json` (native deps), CI / Dockerfile, `.claude/` 설정 | **Miasma / Phantom Gyp / Node-gyp 공급망 캠페인 포스처 추적 — Cynapx 도달 0건 불변.** 진단 일자 직접 재대조: 컴프로마이즈 패키지 패밀리 전부 Cynapx 트리 "not in tree", native 의존(better-sqlite3 + tree-sitter 0.25.0 + 12 grammar) 무관·악성 버전 미발행, in-tree 에이전트 설정은 `.claude/launch.json` 1개(양성), `.cursor`/`.gemini` 부재. CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지 1차 방어선 유지. **즉각 조치 불필요 — 추적만.** 출처: [Snyk better-sqlite3](https://security.snyk.io/package/npm/better-sqlite3) |
| L-3(v24) | `src/server/api-server.ts` (session-id StreamableHTTP), `package.json:29`(`@modelcontextprotocol/sdk ^1.29.0`) | **MCP SDK v2 — *여전히 pre-alpha*(상태 불변).** 직접 확인: `@modelcontextprotocol/sdk` latest는 **여전히 1.29.0**(2개월 전 publish, v23 시점과 불변), v2는 main 브랜치에서 pre-alpha 개발 중·**stable은 Q3 2026**(스펙 publish 2026-07-28) 예정, v1.x가 production 권장·v2 출시 후 최소 6개월 v1.x 보안/버그 수정 지속. → Cynapx 핀 `^1.29.0` 유지가 옳음. stateless protocol core(SEP-2567 session-id 제거)·Multi-Round-Trip·MCP Apps 마이그레이션은 **v2 stable 전환까지 계속 이연**. P15-3 `handleMcp()` 설계 메모가 출발점. 출처: [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk), [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) |
| L-4(v24) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환. **성능 문제 미관측 — 계속 보류.** 메시지가 작고 round-trip이 드물어 직렬화 병목 아님 |
| L-5(v24) | `src/graph/graph-engine.ts` | 클러스터링 본격 서브그래프 파티셔닝 — 100k+ 노드 실측 시 재검토(**계속 이연**). LPA O(V+E)·`MAX_ITER=20` 캡·count-first 가드(200k)·Fisher-Yates seeded PRNG 직접 재확인 — OOM/편향 방어 정상 |
| L-6(v24) | CI / Dockerfile | Node 24 + tree-sitter 0.25.x 빌드 fragility([node-tree-sitter#268] / [salesforce/agentscript#7: C++20 미설정] 여전히 open·미해결, CVE 아님). CI Node 22/24 매트릭스 그린이나 Node 24 LTS 전환 전 prebuild 재확인. **추적만** 출처: [node-tree-sitter#268](https://github.com/tree-sitter/node-tree-sitter/issues/268) |
| L-7(v24) | `src/cli/admin.ts` (cmd* 9개), `tests/admin-cli.test.ts` | **admin CLI 명령 동작의 vitest 게이트 공백 — 비-actionable 추적.** 등록 명령 9개 `cmd*`는 모듈-private(미-export)이라 vitest 직접 호출 불가. **admin.ts 핸들러 export 리팩터 시 함께 게이트화 후보** |
| L-8(v24) | `src/indexer/worker-pool.ts`, `embedding-manager.ts`, `db/database.ts` | **에러-복구·마이그레이션 잔여 분기의 vitest 게이트 공백 — 비-actionable 추적.** worker `worker.on('error')`·queue backpressure·embedding A-7 stale supersedence 레이스·DB migration 잔여 분기는 직접 미검증이나 인접 분기 커버 + 타이밍-flaky 위험. **SCHEMA_VERSION 증분/worker-pool 리팩터 시 함께** |
| L-9(v24) | `src/indexer/update-pipeline.ts` (트랜잭션 보일러플레이트·progress `log.error`), `embedding-manager.ts:184`/`api-server.ts:625` (빈 catch) | **L-9 코드 클린업 잔여 — (b) 잣대 미충족, 비-actionable 추적.** `withWriteTransaction()` 추출은 트랜잭션 경계 5곳 재작성이라 회귀 표면 넓음; 빈 catch 2건은 의도적 silent-drop 방어. **update-pipeline 리팩터 페이즈로 묶어 처리 후보** |
| **L-11(v24)** *(해소-승격 → M-2 v24 — lockfile 드리프트 12.10.0 vs **12.11.1**로 확대, actionable화)* | `package-lock.json` (better-sqlite3) | **better-sqlite3 lockfile 12.10.0 → 정렬 actionable(M-2 v24로 승격).** v23 시점 `12.10.0 vs 12.10.1`(patch)였으나 본 사이클 `npm outdated` = Current 12.10.0 · Wanted/Latest **12.11.1**(minor-level로 확대). clean한 minor bump(CVE 0, 기능-only, semver-호환 핀 `^12.0.0` 무변경)이고 v23이 "다음 의존성 정렬 사이클 actionable 후보"로 예고 → **M-2 v24(Phase 27-2)에서 lockfile-only 정렬.** |
| **L-13(v24)** *(승계 — analyze-impact use_cache 스키마-default 미강제, 무해)* | `src/server/tools/analyze-impact.ts:23` (`useCache: args.use_cache` 무검증·default 미강제) | **`analyze-impact` 핸들러가 `use_cache`(스키마 default `true`)를 검증·default-강제 없이 그대로 `traverse({useCache: args.use_cache})`에 전달 — 무해.** `args.use_cache`가 `undefined`면 traverse 내부 truthy 평가에서 캐시 *비활성*으로 동작(스키마 default `true`와 어긋날 수 있으나 *느려질 뿐* 정확성·크래시 영향 0). 동형 무해 패턴이 `export-graph`(`format`/`max_depth`)·`get-symbol-details`(`include_source`/`summary_only`)에도 존재 — 전부 다운스트림 undefined-안전. **verdict: 추적만(비-actionable)** |
| **L-14(v24)** *(승계 — CVE-2026-25727 `time` 크레이트, Cynapx 미도달 불변)* | (외부 — Rust `time` crate via tree-sitter Rust 생태계 언급), Cynapx prod 트리 무관 | **CVE-2026-25727(RFC 2822 파싱 스택 소진 DoS, `time` 크레이트 0.3.6~<0.3.47)은 *tree-sitter*로 거론되나 실제로는 Rust `time` 크레이트 결함 — Cynapx prod 트리 미도달 불변.** 본 CVE는 tree-sitter npm 바인딩/그래머가 아니라 Rust `time` 크레이트의 RFC 2822 날짜 파싱(formally-deprecated 기능)에 있고 *비-악성 입력은 절대 도달 불가*. Cynapx의 의존 표면(npm tree-sitter 0.25.0 + 12 grammar)에 `time` 크레이트는 부재이고 optional Rust/NAPI 가속 모듈도 사용자-제공 RFC 2822 문자열을 파싱하지 않음 → **prod·dev 미도달, audit 0/0 불변.** tree-sitter Rust 생태계 모니터링 신호로 추적. **verdict: 추적만(비-actionable — 미도달)** 출처: [NVD CVE-2026-25727](https://nvd.nist.gov/vuln/detail/CVE-2026-25727) |
| **L-15(v24)** *(신규-해소 — vite dev advisory, `473acf8`에서 `^8.0.16` bump로 처리)* | `package.json:67`(`vite ^8.0.16`), vitest@4.1.2 transitive vite 의존 | **vite 신규 고-심각도 dev advisory(GHSA-v6wh-96g9-6wx3 / GHSA-fx2h-pf6j-xcff — launch-editor NTLMv2 / `server.fs.deny` Windows bypass)는 별도 커밋 `473acf8`의 vite `^8.0.16` bump로 *이미 해소*.** 둘 다 vitest@4.1.2가 transitive로 끌어오는 vite 의존에서 새로 publish된 advisory였고(dev-only — prod 트리 미도달), `vite` devDependency를 `^8.0.16`으로 명시 bump해 floor를 올림. **본 진단 시점 `npm audit`(dev) = 0 + `npm audit --omit=dev`(prod) = 0 재확인 — 완전 해소.** **verdict: 해소(추적 종료)** 출처: [vite releases](https://github.com/vitejs/vite/releases), [vite security](https://github.com/vitejs/vite/security) |

> **신규 LOW 부재 안내(prod 코드 동작 변경)**: M-1 v24(escapeXml/escapeDot 게이트, 테스트-only)·M-2 v24(better-sqlite3 lockfile 정렬, lockfile-only)를 제외하면 prod 코드 *동작* 변경을 요하는 신규 LOW는 0건이다(L-13/L-14는 무해·미도달 추적, L-15는 해소).

---

## 5. 코드 품질 / 성능 전수 (`_utils.ts` 마지막 미커버 순수 함수 + lockfile 드리프트 재측정 + steady-state 재확인)

v23까지 graph/ 엔진 처방 5종 + 핸들러 보조 핵심 순수 로직(`mergeResultsRRF`) + `qualified_name` 10개 핸들러 strict 가드가 전수 게이트/정렬됐다. v24는 **(1) `_utils.ts`에 남은 *마지막* export 순수 함수(`escapeXml`/`escapeDot`)의 escape 동작이 미커버임을 실측**하고, **(2) L-11 lockfile 드리프트를 `npm outdated`로 재측정**한다.

**(1) `_utils.ts` 순수 함수 ×테스트 대조 (마지막 미커버 후보)**

| 순수 함수 (`_utils.ts`) | 라이브 도구 | 로직 | 직접 단위 테스트 | 판정 |
|------------------------|------------|------|-----------------|------|
| `mergeResultsRRF()` (35-49줄) | `search_symbols`(semantic) | RRF 융합 | **커버**(`tests/_utils.test.ts` — P26-1, 6 케이스) | 정합(M-1 v23 [DONE]) |
| `requireEngine()` (27-33줄) | 전 핸들러 | EngineNotReadyError 가드 | 커버(디스패처 테스트 — H-1) | 정합 |
| **`escapeXml()`** (51-53줄) | `export_graph`(graphml) | `&`/`<`/`>`/`"` → 엔티티 + **`&`-우선 순서(이중-이스케이프 회피)** | **0건**(`export_graph` 디스패처 테스트는 구조 토큰만 단언, 특수문자 픽스처 부재) | **M-1 v24 — Phase 27-1** |
| **`escapeDot()`** (55-57줄) | `export_graph`(dot) | `\`/`"` 이스케이프 | **0건**(상동) | **M-1 v24 — Phase 27-1** |

핵심: P26-1이 `tests/_utils.test.ts`를 신설해 `mergeResultsRRF`를 게이트하면서 *같은 파일에 escapeXml/escapeDot을 추가할 자연스러운 자리*가 생겼다. v23은 이 둘을 "단순 정규식 치환, 우선순위 낮음"으로 남겼으나 — escapeXml의 *`&`-우선 치환 순서*는 이중-이스케이프 회피라는 *정합성 속성*이고(순서가 뒤집히면 회귀), `export_graph` 디스패처 테스트가 특수문자를 *전혀 투입하지 않아* escape 동작이 0% 커버이므로 — 가장 가벼운 게이트(문자열 in/out, 의존 0)로 `_utils.ts`의 3개 export 순수 함수를 100% 닫는다(M-1 v24).

**(2) better-sqlite3 lockfile 드리프트 재측정 (L-11 → M-2 v24)**

| 측정 | v23 시점 | v24 시점(본 사이클) | 판정 |
|------|----------|---------------------|------|
| `npm ls better-sqlite3` | 12.10.0 | 12.10.0(불변) | — |
| `npm outdated` Wanted/Latest | 12.10.1 | **12.11.1**(minor 확대) | 드리프트 확대 |
| 핀(`package.json`) | `^12.0.0` | `^12.0.0`(무변경) | semver-호환 |
| CVE / audit | 0 | 0(12.11.1 직접 CVE 0건) | clean bump |

핵심: 드리프트가 patch(12.10.1)에서 minor(12.11.1)로 확대됐고, clean bump(CVE 0, 기능-only)이며, v23이 명시적으로 "다음 의존성 정렬 사이클 actionable 후보"로 예고했으므로 — lockfile-only 정렬로 승격(M-2 v24).

**(3) prod steady-state 재확인 — 신규 prod 코드 결함 0**

| 항목 | 판정 |
|------|------|
| god-module / 순환 import | 0 — `openapi.ts`·`update-pipeline.ts`·`graph-engine.ts` 응집 불변. repos→engines→server/pipeline 단방향 |
| TODO/FIXME/XXX/HACK | 0건(`src/` 전수) |
| 핫패스 O(n²)-over-nodes | 0 — 클러스터링 count-first 가드(200k)+seeded PRNG, BFS index-pointer 큐, 반복 DFS+60s 캐시, architecture-engine O(1) Map(P22-1) |
| prod·dev audit | 0 / 0 vulnerabilities (vite ^8.0.16 dev-bump 후 재확인 — L-15 해소) |
| 테스트 | `npx vitest run` **642/642**(47 파일, 8.12s) — 추세 무문제(634→6.84s 대비 +8케이스, 시간은 머신 변동) |

**(4) 에러 핸들링 일관성 — 양호**

`Logger`(stderr-only, MCP stdio 안전) `normalizeData()` Error 언랩. update-pipeline catch는 log-and-rethrow + 롤백 선행. 미세 항목(progress log.error·빈 catch 2건)은 L-9 비-actionable 추적. `qualified_name` 10개 핸들러 strict 가드 전수 정합(M-2 v22+M-2 v23으로 완성).

---

## 6. 외부 컨텍스트 (웹 조사 — 진단 일자 재실행, 출처 명시)

### 6.1 의존성 취약점 (prod·dev 둘 다 clean)

- **`npm audit`(dev 포함) = 0 + `npm audit --omit=dev`(prod) = 0**(둘 다 직접 실행). Phase 21-1 postcss override + 본 사이클 vite `^8.0.16` bump(`473acf8`)가 dev 트리도 clean 유지(GHSA-v6wh-96g9-6wx3 / GHSA-fx2h-pf6j-xcff 해소 — L-15).
- **`npm ls better-sqlite3` = `12.10.0` + `npm outdated`(직접 실행)**: prod 코드 *동작* 변경을 요하는 긴급 업그레이드 0건. **L-11 드리프트 확대 — better-sqlite3 lockfile 12.10.0(Wanted/Latest 12.11.1, minor) → M-2 v24로 정렬.** 잔여 드리프트: `tree-sitter-c-sharp` 0.23.1 핀(0.23.5 latest이나 ERR_REQUIRE_ASYNC_MODULE 미해소 → 핀 유지가 옳음), `express`/`commander`/`typescript`/`@types/*` major(5.x/15/6.x — 비-긴급 major, 즉시 비권장), `zod` 4.3.6→4.4.3·`vitest` 4.1.2→4.1.9·`@types/node` 20.19.33→25.x(dev, 다음 갱신 시 정렬).
- **better-sqlite3 / chokidar / tree-sitter / vite / @modelcontextprotocol/sdk 직접 재확인(웹)**: better-sqlite3 **12.11.1**(2시간 전 publish, latest) 직접 CVE 0건(Snyk no direct vulns), chokidar non-vulnerable, tree-sitter npm 바인딩 직접 CVE 0건(CVE-2026-25727은 Rust `time` 크레이트 — L-14, Cynapx 미도달), vite advisory(GHSA-v6wh-96g9-6wx3 / GHSA-fx2h-pf6j-xcff)는 `^8.0.16`로 해소(L-15), @modelcontextprotocol/sdk 1.29.0 직접 CVE 0건. 출처: [Snyk better-sqlite3](https://security.snyk.io/package/npm/better-sqlite3), [npm better-sqlite3](https://www.npmjs.com/package/better-sqlite3)

### 6.2 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"` + Docker `node:22-bookworm-slim`. Node 22 LTS 2027-04 종료 — 여유. CI Node 22/24 매트릭스 그린(642/642). 문서 Node 버전(L-12, P24-2 해소)은 README/README_KR/GUIDE_EN/GUIDE_KR 전부 ≥ 22 정렬 유지.
- **tree-sitter 코어**: latest 0.25.0, 12 grammar 전부 dedupe/override. **tree-sitter-c-sharp**: 0.23.1 정확 핀 롤백 유지. Node 24 빌드 C++20 fragility([node-tree-sitter#268]·[salesforce/agentscript#7] 여전히 open) — L-6 추적.
- **better-sqlite3**: lockfile 12.10.0(L-11 → M-2 v24, Wanted 12.11.1).
- **vite**: devDependency `^8.0.16`(L-15 해소 — 본 사이클 bump).

### 6.3 공급망 캠페인 — Miasma / Phantom Gyp / Node-gyp June 2026 (계속 진행 중, Cynapx 도달 0건 불변)

진단 일자 직접 재대조: 컴프로마이즈 패밀리 전부 Cynapx 트리 "not in tree", native 의존 무관·악성 버전 미발행, in-tree 설정은 `.claude/launch.json` 1개(양성), `.cursor`/`.gemini` 부재. CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지. **즉각 변경 불필요, 포스처 추적.** 출처: [Snyk better-sqlite3](https://security.snyk.io/package/npm/better-sqlite3)

### 6.4 MCP 생태계 — SDK v2 여전히 pre-alpha (상태 불변)

- **MCP SDK v2가 여전히 pre-alpha**(직접 확인): `@modelcontextprotocol/sdk` latest는 **여전히 1.29.0**(v23 시점과 불변, 2개월 전 publish). v2는 main 브랜치에서 pre-alpha 개발 중, **stable은 Q3 2026**(스펙 publish 2026-07-28) 예정, v1.x가 production 권장·v2 출시 후 최소 6개월 v1.x 유지. → **Cynapx 핀 `^1.29.0` 유지가 옳다. stateless core/Tasks/MCP Apps/Multi-Round-Trip 마이그레이션(L-3)은 v2 stable까지 계속 이연.** 출처: [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk), [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases)
- **함의**: Cynapx 현 StreamableHTTP(session-id)는 v2 stateless core와 충돌 표면이 있으나 *마이그레이션은 stable 배포까지 이연*이 옳다.

### 6.5 경쟁/인접 도구 동향 (전략 추적 — 카테고리 지속 폭발)

- **로컬-퍼스트 코드 그래프 카테고리 지속 폭발**: **CodeGraph**(tree-sitter→SQLite+FTS5 심볼/콜/임포트 그래프 MCP 서버, OS-native 워처 증분 동기화, *detect_changes(pre-commit 리스크)·rename(다중-파일 심볼 리네임)·generate_map(Mermaid 아키텍처 다이어그램)* 신규 도구 추가, API 비용 ~35%·tool call ~70% 절감 주장), **Serena**(LSP-over-MCP, 25.2K stars), **GitNexus**(zero-server on-device 지식 그래프), **Codebase-Memory**(tree-sitter KG, 4주 만에 900+ stars), **code-graph-mcp**(10개 언어 AST KG — semantic search·call graph·impact analysis) 등이 "로컬·on-device·MCP·임베디드 SQLite·tree-sitter·no-embeddings-API·no-code-egress" 패턴을 표준 기본값으로 정착. Cynapx의 "100% 로컬·격리·멀티프로세스 보안 IPC + risk/remediation/refactoring/policy *처방* 엔진 + 하이브리드(keyword+vector RRF) 검색" 포지션이 차별점. **함의: 처방 엔진 진입 로직은 v22로, 핵심 보조 순수 로직(RRF)은 P26-1로 전수 게이트 완성됐고, v24는 *남은 마지막 보조 순수 함수(escape)*를 게이트로 메워(M-1) 차별 가치의 회귀 안전망을 `_utils.ts` 100% 커버로 완성하고 *의존성 위생(lockfile)*을 정렬(M-2)한다.** 경쟁사가 detect_changes/rename/generate_map로 *액션* 표면을 넓히는 추세는 Cynapx 처방 엔진의 회귀 안전망 가치를 재확인. 출처: [CodeGraph](https://github.com/colbymchenry/codegraph), [code-graph-mcp](https://github.com/sdsrss/code-graph-mcp), [GitNexus (MarkTechPost)](https://www.marktechpost.com/2026/04/24/meet-gitnexus-an-open-source-mcp-native-knowledge-graph-engine-that-gives-claude-code-and-cursor-full-codebase-structural-awareness/)
- **SCIP가 LSIF 대체 심볼 인덱스 표준 정착** — `export_graph`에 SCIP 추가는 미래 상호운용 후보. protobuf 의존 부담으로 즉시 비권장 — 전략 후보 유지.
- **함의**: (1) 공급망 위생 유지(L-15 vite 해소), (2) MCP SDK v2 pre-alpha→stable 추적, (3) **회귀 안전망을 `_utils.ts` 순수 함수 100%까지 확장**(M-1 v24 escape 게이트), (4) **의존성 위생(better-sqlite3 lockfile 정렬)**(M-2 v24)이 신뢰성 차별화 축.

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 정밀 재열람에서 신규 prod 코드 결함이 없었다(M-1 v24는 미커버 순수 함수 게이트, M-2 v24는 lockfile 정렬):

- `src/watcher/file-watcher.ts` — chokidar `ignored` 프레디킷·확장자 allowlist·flush 동시성·타이머 위생·대용량-배치 git-sync 라우팅·재시도/FATAL 강등(P20-1) 정상.
- `src/graph/graph-engine.ts` — Fisher-Yates + seeded PRNG + count-first 가드(200k) + BFS index-pointer 큐·반복 DFS 모두 O(V+E). `traverse('incoming')` direction 분기 정상.
- `src/graph/architecture-engine.ts`(P22-1)·`optimization-engine.ts`(P23-2)·`remediation-engine.ts`(P23-1)·`policy-discoverer.ts`(P24-1)·`refactoring-engine.ts` getRiskProfile(P23-3)+proposeRefactor(P25-1) — 처방 엔진 5종 진입 로직 전수 게이트 커버.
- `src/server/tools/*.ts` — `qualified_name` 10개 전수 strict 가드 정합(M-2 v22+M-2 v23 완성). `get-related-tests.ts` strict 가드 정렬 확인(P26-2).
- `src/server/tools/_utils.ts` — `requireEngine`(H-1, 디스패처 커버)·`mergeResultsRRF`(P26-1 커버). **단 `escapeXml`/`escapeDot`(escape 동작)은 직접 단위 테스트 0건 — M-1 v24.**
- `src/server/tools/export-graph.ts` — json/graphml/dot 분기·unknown-format 가드 디스패처 커버(P26 인접). **단 escape 동작 자체는 미커버 — M-1 v24.**
- `src/server/tools/search-symbols.ts` — `query` strict 가드(P25-2)·`limit` 클램프·`Promise.allSettled` O-12 가드·`mergeResultsRRF` 호출(P26-1 게이트) 정상.
- `src/indexer/update-pipeline.ts` — 단일 책임·catch log-and-rethrow+롤백·원본 에러 보존(미세 항목만 L-9).
- `src/indexer/metrics-calculator.ts` — cyclomatic 복잡도(TS AST + tree-sitter DFS) metrics-calculator.test.ts 커버.
- `src/server/api-server.ts` — 세션 TTL/cap/sweep·timing-safe Bearer·8 REST 핸들러 supertest 게이트(P19-1)·rate-limit 양호.
- `src/server/ipc-coordinator.ts` — challenge-response 인증·1MB 제한·per-tool 타임아웃·keepalive(unref)·pending reject-on-close 견고.
- `src/server/tool-dispatcher.ts` — Terminal 포워딩·waitUntilReady·registry lookup·EngineNotReadyError 재시도 변환.
- `src/server/workspace-manager.ts`/`health-monitor.ts` — 버전-미스매치 reindex·dispose 순서(watcher→worker→DB)·ledger 일관성 견고.
- `package.json` overrides — tree-sitter `^0.25.0`·fast-uri·qs·hono·postcss 충족, **vite `^8.0.16`(L-15 해소)**, dev·prod audit 0/0. **better-sqlite3 lockfile 12.10.0 — M-2 v24.**
- `README.md`/`README_KR.md`/`GUIDE_EN.md`/`GUIDE_KR.md` — Node ≥ 22 전부 정렬(P24-2, L-12 해소).
- `.github/workflows/ci.yml` — Node 22/24 매트릭스 + `npm audit --omit=dev --audit-level=high`(P14-1) + `npm ci`. (cynapx-autonomous.yml은 본 진단 범위 외.)
- TODO/FIXME/XXX/HACK = 0건(`src/` 전수).

---

## 8. 권장 수정 순서 (Phase 27 제안 — 상세는 phase27-plan.md)

**Phase 26 이후 prod 코드는 steady-state(CRITICAL/HIGH 0, prod·dev audit 0/0, TODO 0, god-module 0, 핫패스 quadratic 0)이고 신규 prod-도달 CVE도 0건이나, v24는 v23이 `mergeResultsRRF`를 게이트하고 escape를 "추적만"으로 남긴 뒤 *그 마지막 미커버 후보*(escapeXml/escapeDot)와 *드리프트가 확대된 의존성 위생*(better-sqlite3 lockfile)을 두 각도로 발굴했다.** CRITICAL/HIGH 0, MEDIUM 2(M-1 v24 escapeXml/escapeDot 게이트 — 테스트-only; M-2 v24 better-sqlite3 lockfile 12.10.0→12.11.1 정렬 — lockfile-only), LOW(L-2~L-9 v23 승계 + L-11 [해소-승격 → M-2 v24] + L-13/L-14 승계 + L-15 [해소 — vite ^8.0.16]). 따라서 Phase 27은 **escapeXml/escapeDot 게이트(P27-1, 테스트-only) + better-sqlite3 lockfile 정렬(P27-2, lockfile-only) + 추적 갱신**이 합리적이다. **이로써 `_utils.ts`의 3개 export 순수 함수가 100% 커버되어 핸들러 보조 순수 로직 미커버 공백이 0이 되고, 의존성 위생도 정렬된다 — 이후 프로젝트는 사실상 steady-state(남은 항목은 전부 L-tracking/이연)로 진입한다.**

1. **P27-1 [DONE — Phase 27-1]**: M-1 v24 해소 — `tests/_utils.test.ts`(P26-1 신설)에 `escapeXml`/`escapeDot` 단위 케이스 7건 추가(특수문자 치환·`&`-우선 순서·전역 치환·무특수문자 무변경, 의존 0, 테스트-only, prod 코드 무변경). **이로써 `_utils.ts` 3개 export 순수 함수 100% 커버.** (vitest 642→649 그린)
2. **P27-2 [DONE — Phase 27-2]**: M-2 v24 해소 — `npm i better-sqlite3@12.11.1`로 `package-lock.json` better-sqlite3 엔트리만 12.10.0→12.11.1 정렬(`package.json` 핀 `^12.0.0` 무변경) + 재빌드 + 649 그린 + audit 0/0 재확인. **lockfile-only.**
3. **추적 상태 갱신**: L-2(Miasma/Node-gyp 도달 0 불변), L-3(SDK v2 *여전히 pre-alpha* — stable Q3까지 이연), L-6(node-tree-sitter#268 open), L-7/L-8 게이트 공백, L-9 잔여 클린업, L-13(analyze-impact use_cache 무해), L-14(CVE-2026-25727 time 크레이트 미도달), **L-15(vite ^8.0.16 — 해소)** 현 상태를 다음 사이클 출발점으로 고정.

(L-4 IPC MessagePack 계속 보류, L-5 클러스터링 본격 파티셔닝 계속 이연, MCP 전면 stateless/task 마이그레이션은 SDK v2 stable 배포까지 이연, SCIP export는 전략 후보로 기록만.)
