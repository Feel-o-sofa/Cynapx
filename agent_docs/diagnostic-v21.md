# Cynapx 정밀 진단 보고서 v21

- **기준 커밋**: `2ac4a5f` (Phase 23 + Phase 23-1/23-2/23-3 완료, 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-15
- **진단 범위**: src/ 전체(server, db, indexer, graph, watcher, utils, cli, bootstrap) + **v20이 graph/ 엔진 5종을 직접 읽고 테스트 파일과 대조해 M-1(remediation 7분기)·M-2(dead-code 경계)·L-10 부분(RefactoringEngine.getRiskProfile)을 수확한 뒤 *명시적으로 다음 사이클로 이연한* L-10 잔여 2건(`PolicyDiscoverer.discoverPolicies()`, `RefactoringEngine.proposeRefactor()`)을 (b) 잣대로 재판정** + 그 도구 핸들러들의 인자 검증 경로 + schema/, scripts/, tests/ 전체, package.json/lockfile, README.md / README_KR.md / GUIDE_EN.md / GUIDE_KR.md 문서 동기화 + 외부 컨텍스트(CVE/advisory, 공급망 캠페인, MCP SDK v2 npm 배포 상태, 경쟁 도구)
- **진단 방법**: 단일 에이전트 오케스트레이션 + 회의적 전수 코드 리뷰 + 로컬 직접 검증(`npx vitest run`[시간·케이스 수 측정], `npx tsc --noEmit`, `npm audit`[dev 포함]·`npm audit --omit=dev`, `npm outdated`로 버전 드리프트 확인) + **신규 각도 2종: (1) v20이 "RefactoringEngine.getRiskProfile만 가장 깨끗해서 P23-3로 처리하고 proposeRefactor·PolicyDiscoverer는 픽스처가 무겁다며 이연"했는데, v21은 *그 이연 판정이 여전히 옳은지*를 재검증한다 — P23-3가 신설한 `tests/refactoring-engine.test.ts`/`tests/optimization-engine.test.ts`가 이미 `createInMemoryEngine()` + `makeNode()` 픽스처 하니스를 확립했으므로, "DB-heavy라 무겁다"던 PolicyDiscoverer 게이트가 *이제는 기존 하니스 복사만으로 가벼워졌는지*를 실측 평가한다. (2) 도구 *핸들러*의 인자 검증 경로를 엔진 로직과 분리해 읽는다 — v15~v20의 3-way 대조는 "핸들러가 인자를 검증하는가"를 봤지만, *검증 대상 인자명이 실제 엔진 호출 인자명과 일치하는가*는 한 번도 대조하지 않았다.** + 외부 웹 재조사(better-sqlite3·MCP SDK v2 npm 배포 상태·공급망 캠페인)
- **현재 상태(직접 검증)**: `npx vitest run` **608/608**(45 파일), `npx tsc --noEmit` 그린, **`npm audit`(dev 포함) = 0 vulnerabilities**, **`npm audit --omit=dev`(prod) = 0 vulnerabilities**. diagnostic-v20 전 항목 처리 완료(M-1 v20 [DONE — P23-1], M-2 v20 [DONE — P23-2], L-10 부분 [DONE — P23-3]), LOW 승계 추적.

> **요약**: **Phase 23까지 prod 코드는 steady-state(CRITICAL/HIGH 0, prod·dev audit 0/0, TODO 0, god-module 0, 핫패스 quadratic 0)이고, 외부도 신규 prod-도달 CVE 0건(better-sqlite3·chokidar·express·tree-sitter 직접 재확인)이다.** **v21은 v20이 *명시적으로 다음 사이클로 이연한* L-10 잔여를 (b) 잣대로 재판정하고, 도구 핸들러의 인자-검증 경로를 새 각도로 읽어 두 건의 actionable을 드러낸다.** **신규 M-1 v21: `PolicyDiscoverer.discoverPolicies()`(policy-discoverer.ts, 25-76줄)는 라이브 MCP 도구 `discover_latent_policies` 뒤에 있으나 *전용 테스트 파일이 없고*(`tests/policy-discoverer.test.ts` 부재), `tests/tool-dispatcher.test.ts:257`은 `discover_latent_policies`를 *엔진-not-ready 경로만* 검증(`policyDiscoverer` 미주입 → isError) — 엣지 필터링(`calls/dynamic_calls/inherits/implements/depends_on`만)·태그 관계 카운팅·`threshold`/`minCount` 게이팅·`probability` 계산 로직은 0% 커버. v20은 이를 "DB-heavy라 픽스처 무겁다"며 이연했으나, *P23-3가 이미 `tests/refactoring-engine.test.ts`에 `createInMemoryEngine()` + `makeNode()` + `edgeRepo` 하니스를 확립*했으므로 그 하니스 복사 + 엣지 셋업만으로 게이트 가능 → (b) 잣대 충족, 더 이상 무겁지 않다 → Phase 24-1.** **신규 M-2 v21: `discover-latent-policies.ts`(핸들러)의 인자 검증이 *실제 호출 인자와 어긋난다* — line 16-20은 `args.min_confidence`/`args.max_policies`를 검증하지만, line 22의 실제 엔진 호출은 `discoverPolicies(args.threshold, args.min_count)`다. MCP 도구 스키마(`tool-dispatcher.ts:200-201`)도 `threshold`(default 0.9)·`min_count`(default 5)만 선언한다. 즉 *검증 블록은 스키마·호출 어디에도 없는 인자명을 가드해 영구 dead-code이고*, 실제로 엔진에 전달되는 `threshold`/`min_count`는 *전혀 검증되지 않는다*(NaN·음수·>1 threshold가 그대로 엔진으로 들어감). M-1과 함께 게이트화 → Phase 24-1.** **외부 신선 재조사: better-sqlite3 직접 CVE 0건(lockfile 이제 12.10.1 — L-11 v20 정렬 완료), MCP SDK v2가 *npm에 alpha로 배포됨*(`@modelcontextprotocol/server`·`@modelcontextprotocol/client` 모듈 분리, 그러나 `@modelcontextprotocol/sdk` latest는 여전히 1.29.x이고 v1.x가 production 권장·stable Q3 2026 — Cynapx 핀 `^1.29.0` 유지가 옳음[L-3 상태 갱신]), 공급망 캠페인 Cynapx 도달 0건 불변. 문서 드리프트 발견: README_KR.md:62·GUIDE_EN.md:119·GUIDE_KR.md:119가 "Node.js ≥ 20"인데 README.md·package.json(`>=22`)·Dockerfile(`node:22`)은 22 — P21-2가 README EN만 갱신하고 형제 문서를 동기화 안 함[L-12].** **CRITICAL 0, HIGH 0, MEDIUM 2(M-1 v21 PolicyDiscoverer 로직 게이트 — Phase 24-1; M-2 v21 핸들러 인자-명 불일치 픽스+게이트 — Phase 24-1), LOW(L-2~L-9 v20 승계 + L-10 잔여 축소[proposeRefactor만] + L-12 신규 문서 드리프트; L-11 v20 [해소 — lockfile 12.10.1 정렬됨]).**

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건은 Phase 13에서, v11 HIGH(공급망)는 Phase 14-1에서, v12~v18 MEDIUM은 Phase 15~21에서, v19 MEDIUM(architecture-engine O(1)+circular 분기)은 Phase 22-1에서, v20 MEDIUM 2건(remediation 7분기·dead-code 경계)+L-10 부분(getRiskProfile)은 Phase 23에서 해소됐고, 본 전수 재열람에서 새로운 CRITICAL/HIGH는 없다. IPC 핸드셰이크(challenge + HMAC-SHA256 + timingSafeEqual)·API Bearer(SHA-256 + timingSafeEqual)·세션 맵(TTL+cap+sweep unref) 모두 견고(직접 재열람).

---

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** 코드·공급망 어디에서도 신규 HIGH 없음. **prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0**(직접 재검증). M-1 v21(PolicyDiscoverer 로직 게이트)·M-2 v21(핸들러 인자-명 불일치)은 보안·크래시 결함이 아니라 *게이트 격차 + 검증-정합성 버그*이므로 MEDIUM이다(M-2의 미검증 인자는 `discoverPolicies`가 `prob >= threshold`/`count >= minCount` 비교에서 NaN을 만나도 단순히 빈 결과를 내므로 크래시·데이터 손상은 아님 — 다만 의도된 입력 가드가 작동 안 하는 정합성 버그).

---

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

| # | 위치 | 내용 |
|---|------|------|
| **M-1 v21** *(신규, actionable — 라이브 도구 뒤 미커버 엔진 로직. v20이 이연했으나 P23-3 하니스로 이제 가벼움)* **[DONE — Phase 24-1]** (`tests/policy-discoverer.test.ts` 신규 7케이스, 테스트-only) | `src/graph/policy-discoverer.ts` (`discoverPolicies()`, 25-76줄), `tests/` (policy-discoverer 테스트 파일 부재), `tests/tool-dispatcher.test.ts:257`(엔진-not-ready 경로만) | **`PolicyDiscoverer.discoverPolicies()`의 핵심 로직에 회귀 게이트 추가.** 이 엔진은 라이브 MCP 도구 `discover_latent_policies`(`tools/discover-latent-policies.ts` → `_registry.ts:48`) 뒤에 있으나 **로직 자체는 0% 커버**: `tests/`에 전용 파일이 없고, 디스패처 테스트는 `policyDiscoverer` 미주입 시 isError만 검증(line 257-260). 미커버 로직: (a) 엣지 타입 필터(`calls/dynamic_calls/inherits/implements/depends_on`만 통과, line 32), (b) `fromNode`/`toNode` 또는 `tags` 누락 시 skip(line 39), (c) 태그쌍 관계 카운팅(`tagRelationships` 중첩 Map, line 41-52), (d) `totalOut < minCount` 게이트(line 59), (e) `prob = count/totalOut >= threshold && count >= minCount` 임계(line 62-63), (f) `probability`·`description`(`(prob*100).toFixed(1)%`) 생성(line 64-70). **v20은 "DB-heavy 집계라 in-memory 그래프 픽스처+다수 노드 셋업 필요 → (b) 작은 변경 잣대엔 무겁다"며 L-10으로 이연했으나, *P23-3가 이미 `tests/refactoring-engine.test.ts`에 `createInMemoryEngine()`(`:memory:` better-sqlite3 + schema.sql, vec0 필터) + `makeNode(nodeRepo, overrides)` 하니스를 확립*했고, `tests/optimization-engine.test.ts`/`tests/architecture-engine.test.ts`도 동일 패턴 + `edgeRepo.createEdge()` 셋업을 갖는다 → 그 하니스를 복사해 노드 2~3개 + 엣지 1~2개만 심으면 게이트 가능 → 더 이상 무겁지 않다.** **(b) 잣대 충족**: (1) prod 코드 무변경(테스트-only); (2) 기존 하니스 재사용 — 신규 픽스처 인프라 0; (3) M-1 v20(remediation)/L-10 부분(getRiskProfile)과 동형의 "라이브 도구 뒤 미커버 엔진 로직 게이트". **verdict: actionable — Phase 24-1.** (5장 상세) |
| **M-2 v21** *(신규, actionable — 핸들러 인자-검증 정합성 버그 + 게이트. 도구 핸들러 인자명을 엔진 호출 인자명과 대조한 신규 각도)* **[DONE — Phase 24-1]** (검증 인자명을 `threshold`/`min_count`로 정렬 ~5줄 + 디스패처 3케이스) | `src/server/tools/discover-latent-policies.ts:16-22` (검증 인자명 `min_confidence`/`max_policies` ≠ 호출 인자명 `threshold`/`min_count`), `src/server/tool-dispatcher.ts:200-201` (스키마 `threshold`/`min_count`만 선언) | **`discover-latent-policies.ts` 핸들러의 인자-검증 불일치 픽스 + 회귀 게이트.** 핸들러는 line 16-20에서 `args.min_confidence`(0~1 범위)와 `args.max_policies`(양의 정수)를 검증하지만, line 22의 실제 호출은 `discoverPolicies(args.threshold, args.min_count)`다. MCP 도구 스키마(`tool-dispatcher.ts:200-201`)도 `threshold`(default 0.9)·`min_count`(default 5)만 선언하므로, **검증 대상인 `min_confidence`/`max_policies`는 스키마·호출 어디에도 없는 인자명 → 검증 블록은 영구 dead-code이고**, 정작 엔진에 전달되는 `threshold`/`min_count`는 *전혀 검증되지 않는다*. 결과: NaN/음수/>1 `threshold`가 그대로 `prob >= threshold` 비교로 들어감(크래시는 아니나 의도된 가드가 무력화된 정합성 버그). **(b) 잣대 충족**: (1) 픽스 = 검증 블록의 인자명을 실제 호출 인자명(`threshold` 0~1, `min_count` 양의 정수)으로 정렬(~5줄, 의미는 검증을 *실제로 작동하게* 만드는 것) — 시그니처·반환 형태 무변경; (2) 게이트는 디스패처 테스트에 `threshold: 1.5`/`min_count: -1` → isError 케이스 추가(엔진 주입은 M-1 하니스 또는 stub로 가능); (3) M-1과 같은 도구·같은 파일이라 한 페이즈로 묶임. **verdict: actionable — Phase 24-1.** (5장 상세) |

> **참고**: v20은 graph/ 엔진 5종 중 remediation·optimization·refactoring(getRiskProfile)을 P23-1/2/3으로 게이트화하고 **PolicyDiscoverer·proposeRefactor를 "픽스처 무겁다"며 이연**했다. v21은 *그 이연 판정을 재검증*해 — P23-3가 확립한 `createInMemoryEngine()`/`makeNode()` 하니스 덕에 PolicyDiscoverer 게이트가 이제 "하니스 복사 + 엣지 셋업"으로 가벼워졌음을 확인 — M-1로 actionable화했다. 더해, 도구 핸들러 인자명을 엔진 호출 인자명과 대조하는 신규 각도로 M-2(검증-호출 불일치)를 발굴했다. `proposeRefactor()`는 여전히 `graphEngine.traverse()` BFS 그래프 픽스처가 필요해 L-10 잔여로 축소 추적한다.

---

## 4. 최적화 (LOW) — 추적/이연 (v20 승계 + L-10 잔여 축소 + L-12 신규 문서 드리프트; L-11 해소)

| # | 위치 | 내용 |
|---|------|------|
| L-2(v21) | `package.json` (native deps), CI / Dockerfile, `.claude/` 설정 | **Miasma / Phantom Gyp 공급망 캠페인 포스처 추적 — Cynapx 도달 0건 불변.** 진단 일자 직접 재대조: 컴프로마이즈 패키지 패밀리 전부 Cynapx 트리 "not in tree", native 의존(better-sqlite3 12.10.1 + tree-sitter 0.25.0 + 12 grammar) 무관·악성 버전 미발행, in-tree 에이전트 설정은 `.claude/launch.json` 1개(양성), `.cursor`/`.gemini` 부재. CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지 1차 방어선 유지. **즉각 조치 불필요 — 추적만.** 출처: [Snyk better-sqlite3](https://security.snyk.io/package/npm/better-sqlite3) |
| L-3(v21) | `src/server/api-server.ts` (session-id StreamableHTTP), `package.json:29`(`@modelcontextprotocol/sdk ^1.29.0`) | **MCP SDK v2 — *npm에 alpha 배포됨*(상태 갱신).** 직접 확인: v2 SDK가 모놀리식 `@modelcontextprotocol/sdk`에서 모듈 분리돼 `@modelcontextprotocol/server`·`@modelcontextprotocol/client`로 **npm alpha 배포**됨(breaking-change 예고, 피드백 수집 목적). **그러나 `@modelcontextprotocol/sdk` latest는 여전히 1.29.x이고, v1.x가 production 권장 + stable은 Q3 2026(스펙 publish 7-28) + v1.x는 v2 출시 후 최소 6개월 보안/버그 수정 지속.** → Cynapx 핀 `^1.29.0` 유지가 옳음. stateless protocol core(SEP-2567 session-id 제거)·Multi-Round-Trip·MCP Apps 마이그레이션은 **alpha→stable 전환까지 계속 이연**. P15-3 `handleMcp()` 설계 메모가 출발점. 출처: [MCP TS SDK V2](https://ts.sdk.modelcontextprotocol.io/v2/), [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) |
| L-4(v21) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환. **성능 문제 미관측 — 계속 보류.** 메시지가 작고 round-trip이 드물어 직렬화 병목 아님 |
| L-5(v21) | `src/graph/graph-engine.ts` | 클러스터링 본격 서브그래프 파티셔닝 — 100k+ 노드 실측 시 재검토(**계속 이연**). LPA O(V+E)·`MAX_ITER=20` 캡·count-first 가드(200k)·Fisher-Yates seeded PRNG 직접 재확인 — OOM/편향 방어 정상 |
| L-6(v21) | CI / Dockerfile | Node 24 + tree-sitter 0.25.x 빌드 fragility([node-tree-sitter#268] 여전히 open·미해결, CVE 아님). CI Node 22/24 매트릭스 그린이나 Node 24 LTS 전환 전 prebuild 재확인. **추적만** |
| L-7(v21) | `src/cli/admin.ts` (cmd* 9개), `tests/admin-cli.test.ts` | **admin CLI 명령 동작의 vitest 게이트 공백 — 비-actionable 추적.** 등록 명령 9개 `cmd*`는 모듈-private(미-export)이라 vitest 직접 호출 불가. **admin.ts 핸들러 export 리팩터 시 함께 게이트화 후보** |
| L-8(v21) | `src/indexer/worker-pool.ts`, `embedding-manager.ts`, `db/database.ts` | **에러-복구·마이그레이션 잔여 분기의 vitest 게이트 공백 — 비-actionable 추적.** worker `worker.on('error')`·queue backpressure·embedding A-7 stale supersedence 레이스·DB migration 잔여 분기는 직접 미검증이나 인접 분기 커버 + 타이밍-flaky 위험. **SCHEMA_VERSION 증분/worker-pool 리팩터 시 함께** |
| L-9(v21) | `src/indexer/update-pipeline.ts` (트랜잭션 보일러플레이트·progress `log.error`), `embedding-manager.ts:184`/`api-server.ts:625` (빈 catch) | **L-9 코드 클린업 잔여 — (b) 잣대 미충족, 비-actionable 추적.** `withWriteTransaction()` 추출은 트랜잭션 경계 5곳 재작성이라 회귀 표면 넓음; 빈 catch 2건은 의도적 silent-drop 방어. **update-pipeline 리팩터 페이즈로 묶어 처리 후보** |
| **L-10(v21)** *(축소 — proposeRefactor만 잔여)* | `src/graph/refactoring-engine.ts`(`proposeRefactor`) | **`RefactoringEngine.proposeRefactor()` 게이트 공백 — 추적.** P23-3가 `getRiskProfile()`을 게이트화했고, v21 M-1이 PolicyDiscoverer를 actionable화하므로, L-10 잔여는 `proposeRefactor()` 1건으로 축소된다. `proposeRefactor()`는 `graphEngine.traverse(node.id, 'BFS', {direction:'incoming', maxDepth:5})` 호출 + `calculateRisk`/`getRiskReasons`/`generateSteps`(private) 조합이라 **그래프 픽스처가 더 무겁다**(엣지로 incoming 의존 트리를 심어야 risk/impact가 의미 있음). `createInMemoryEngine()` 하니스로 가능하나 M-1(PolicyDiscoverer)보다 셋업이 무거워 본 사이클 범위 제외 — **다음 사이클 후보** |
| **L-12(v21)** *(신규 — 문서 Node 버전 드리프트)* **[DONE — Phase 24-2]** (README_KR.md:62·GUIDE_EN.md:119·GUIDE_KR.md:119 "≥ 20" → "≥ 22") | `README_KR.md:62`, `GUIDE_EN.md:119`, `GUIDE_KR.md:119` | **3개 문서가 "Node.js ≥ 20"인데 코드는 `>=22` — EN/KR/코드 드리프트.** `package.json:12`(`engines.node ">=22"`)·`Dockerfile:21,50`(`node:22-bookworm-slim`)·README.md:62(EN, "≥ 22")는 모두 22이나, **README_KR.md:62·GUIDE_EN.md:119·GUIDE_KR.md:119는 여전히 "Node.js ≥ 20"**. P21-2가 README EN만 22로 갱신하고 형제 문서(KR README·EN/KR GUIDE)를 동기화하지 않은 잔재. 사용자가 Node 20에서 설치 시 `engines` 경고 또는 better-sqlite3/tree-sitter 빌드 차이 가능. **(b) 잣대 충족(docs-only, 3줄 정렬)** — 다만 docs-only 픽스라 다음 docs 사이클 또는 Phase 24-2로 묶음 후보. **verdict: 추적 — Phase 24-2(선택)** |

> **L-11 v20 [해소]**: v20이 "better-sqlite3 lockfile 12.10.0 → wanted 12.10.1 정렬 후보"로 추적했으나, 본 사이클 `npm outdated` 직접 확인 결과 **lockfile이 이미 12.10.1로 정렬됨**(Current 12.10.1·Wanted 12.10.1·Latest 12.10.1). 드리프트 해소 — 추적 종료.
>
> **신규 LOW 부재 안내(prod 코드 동작 변경)**: M-1 v21(PolicyDiscoverer 게이트, 테스트-only)·M-2 v21(핸들러 인자-명 정렬, ~5줄)을 제외하면 prod 코드 *동작* 변경을 요하는 신규 LOW는 0건이다. L-12는 docs-only.

---

## 5. 코드 품질 / 성능 전수 (L-10 이연 재판정 + 핸들러 인자-검증 대조 + steady-state 재확인)

v20까지 graph/ 엔진 5종 중 4건(architecture/optimization/remediation/refactoring-getRiskProfile)이 게이트화됐다. v21은 **(1) v20이 "픽스처 무겁다"며 이연한 PolicyDiscoverer를 P23-3 하니스 기준으로 재판정**하고, **(2) 도구 핸들러 인자명을 엔진 호출 인자명과 대조**한다.

**(1) graph/ 엔진 ×테스트 파일 대조 (v20→v21 갱신)**

| 엔진 | 테스트 파일 | 라이브 도구 | 로직 커버 | 판정 |
|------|-------------|------------|-----------|------|
| `architecture-engine.ts` | `architecture-engine.test.ts` | `check_architecture_violations` | custom-rule + circular(P22-1) | 커버 |
| `optimization-engine.ts` | `optimization-engine.test.ts` | `find_dead_code` | dead-code 티어 + 빈-그래프 경계(P23-2) | 커버 |
| `remediation-engine.ts` | `remediation-engine.test.ts` | `get_remediation_strategy` | 7 분기(P23-1) | 커버 |
| `refactoring-engine.ts` | `refactoring-engine.test.ts` | `get_risk_profile`/`propose_refactor` | `getRiskProfile()` 임계/가중(P23-3) 커버; **`proposeRefactor()` BFS 잔여** | L-10 축소(proposeRefactor만) |
| `policy-discoverer.ts` | **없음** | `discover_latent_policies` | **엣지 필터·태그 카운팅·threshold/minCount 게이팅·probability 0% 커버** | **M-1 v21 — Phase 24-1** (P23-3 하니스 복사로 게이트, 더 이상 무겁지 않음) |

핵심: v20이 PolicyDiscoverer를 이연한 근거("DB-heavy 픽스처 무겁다")는 P23-3가 `createInMemoryEngine()`/`makeNode()`/`edgeRepo` 하니스를 확립하면서 무효화됐다. 그 하니스를 복사 + 노드 2~3개·엣지 1~2개만 심으면 `discoverPolicies()`의 임계·필터·카운팅을 결정적으로 게이트할 수 있다(테스트-only).

**(2) 도구 핸들러 인자-검증 대조 (신규 각도)**

`src/server/tools/*.ts`의 인자 검증 블록 인자명을 *같은 핸들러의 엔진 호출 인자명* 및 *디스패처 스키마*와 대조했다. **`discover-latent-policies.ts`에서 불일치 발견**: 검증=`min_confidence`/`max_policies`(line 16-20), 호출=`threshold`/`min_count`(line 22), 스키마=`threshold`/`min_count`(`tool-dispatcher.ts:200-201`). 검증 블록은 dead-code, 실제 인자는 미검증(M-2 v21). 다른 핸들러(`find-dead-code`·`analyze-impact`·`get-risk-profile`·`export-graph` 등)는 검증-호출 인자명이 일치(샘플 대조 — 불일치 0건).

**(3) prod steady-state 재확인 — 신규 prod 코드 결함 0**

| 항목 | 판정 |
|------|------|
| god-module / 순환 import | 0 — `openapi.ts`(정적 스키마 리터럴)·`update-pipeline.ts`·`graph-engine.ts` 응집 불변. repos→engines→server/pipeline 단방향 |
| TODO/FIXME/XXX/HACK | 0건(`src/` 전수) |
| 핫패스 O(n²)-over-nodes | 0 — 클러스터링 count-first 가드(200k)+seeded PRNG, BFS index-pointer 큐, 반복 DFS+60s 캐시, architecture-engine O(1) Map(P22-1) |
| prod·dev audit | 0 / 0 vulnerabilities |
| 테스트 | `npx vitest run` **608/608**(45 파일) — 추세 무문제 |

**(4) 에러 핸들링 일관성 — 양호**

`Logger`(stderr-only, MCP stdio 안전) `normalizeData()` Error 언랩. update-pipeline catch는 log-and-rethrow + 롤백 선행. 미세 항목(progress log.error·빈 catch 2건)은 L-9 비-actionable 추적. **M-2 v21의 핸들러 검증 불일치는 에러 핸들링이 아니라 *입력 가드 정합성*이라 별도 actionable화.**

---

## 6. 외부 컨텍스트 (웹 조사 — 진단 일자 재실행, 출처 명시)

### 6.1 의존성 취약점 (prod·dev 둘 다 clean)

- **`npm audit`(dev 포함) = 0 + `npm audit --omit=dev`(prod) = 0**(둘 다 직접 실행). Phase 21-1 postcss override가 dev 트리도 clean 유지.
- **`npm outdated`(직접 실행)**: prod 코드 *동작* 변경을 요하는 긴급 업그레이드 0건. **L-11 v20 해소 확인 — better-sqlite3 lockfile이 12.10.1로 정렬됨.** 잔여 드리프트: `tree-sitter-c-sharp` 0.23.1 핀(0.23.5 latest이나 ERR_REQUIRE_ASYNC_MODULE 미해소 → 핀 유지가 옳음), `express`/`commander`/`typescript`/`@types/*` major(5.x/15/6.x — 비-긴급 major, 즉시 비권장), `zod` 4.3.6→4.4.3·`vitest` 4.1.2→4.1.9(dev, 다음 갱신 시 정렬).
- **better-sqlite3 / chokidar / express / tree-sitter 직접 재확인(웹)**: better-sqlite3 직접 CVE 0건(latest 12.10.1 — "Node-gyp Supply Chain June 2026" 패밀리 거론되나 Cynapx 핀은 악성 미발행), chokidar 5.0.0·express 4.22.x non-vulnerable, 기타 의존 미해결 공개 취약점 미발견. 출처: [Snyk better-sqlite3](https://security.snyk.io/package/npm/better-sqlite3)

### 6.2 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"` + Docker `node:22-bookworm-slim`. Node 22 LTS 2027-04 종료 — 여유. CI Node 22/24 매트릭스 그린(608/608). **문서 드리프트: README_KR/GUIDE_EN/GUIDE_KR가 "≥ 20" — L-12.**
- **tree-sitter 코어**: latest 0.25.0, 12 grammar 전부 dedupe/override. **tree-sitter-c-sharp**: 0.23.1 정확 핀 롤백 유지.
- **better-sqlite3**: 12.10.1(lockfile 정렬 완료, L-11 해소).

### 6.3 공급망 캠페인 — Miasma / Phantom Gyp (계속 진행 중, Cynapx 도달 0건 불변)

진단 일자 직접 재대조: 컴프로마이즈 패밀리 전부 Cynapx 트리 "not in tree", native 의존 무관·악성 버전 미발행, in-tree 설정은 `.claude/launch.json` 1개(양성), `.cursor`/`.gemini` 부재. CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지. **즉각 변경 불필요, 포스처 추적.** 출처: [Wiz: Miasma](https://www.wiz.io/blog/miasma-supply-chain-attack-targeting-redhat-npm-packages)

### 6.4 MCP 생태계 — SDK v2가 npm에 alpha 배포됨 (상태 갱신)

- **MCP SDK v2가 npm에 alpha 형태로 배포됨**(직접 확인): 모놀리식 `@modelcontextprotocol/sdk`에서 **`@modelcontextprotocol/server`·`@modelcontextprotocol/client`로 모듈 분리** + alpha 배포(breaking-change 예고, 피드백 수집). v20 시점("RC 잠금됐으나 npm 1.29.x")에서 *alpha 패키지가 실제 npm에 올라온* 상태로 진전. **그러나 `@modelcontextprotocol/sdk` latest는 여전히 1.29.x이고, v1.x가 production 권장 + stable Q3 2026 + v1.x는 v2 출시 후 최소 6개월 보안/버그 수정 지속.** → **Cynapx 핀 `^1.29.0` 유지가 옳다. stateless core/Tasks/MCP Apps/Multi-Round-Trip 마이그레이션(L-3)은 alpha→stable 전환까지 계속 이연.** 출처: [MCP TS SDK V2](https://ts.sdk.modelcontextprotocol.io/v2/), [MCP Blog: 2026-07-28 RC](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
- **함의**: Cynapx 현 StreamableHTTP(session-id)는 v2 stateless core와 충돌 표면이 있으나 *마이그레이션은 stable 배포까지 이연*이 옳다. alpha 패키지 등장은 모니터링 신호이지 채택 트리거가 아니다.

### 6.5 경쟁/인접 도구 동향 (v20 승계 — 전략 추적)

- **로컬-퍼스트 코드 그래프 카테고리 성숙 지속**: Serena(LSP-over-MCP)·CodeGraph·GitNexus 등이 심볼-레벨 표준 기본값. Cynapx의 "100% 로컬·격리·멀티프로세스 보안 IPC + risk/remediation/refactoring/policy 처방 엔진" 포지션이 차별점. **함의: 그 처방 엔진들이 Cynapx 고유 가치인데 PolicyDiscoverer만 아직 게이트 밖 — M-1 v21이 그 마지막 격차를 메우면 처방 엔진 5종 전부 회귀 게이트 커버.**
- **SCIP가 LSIF 대체 심볼 인덱스 표준 정착** — `export_graph`에 SCIP 추가는 미래 상호운용 후보. protobuf 의존 부담으로 즉시 비권장 — 전략 후보 유지.
- **함의**: (1) 공급망 위생 유지, (2) MCP SDK v2 alpha→stable 추적, (3) **회귀 안전망을 처방 엔진 5종 전부로 완성**(M-1 v21), (4) **문서 위생**(L-12 EN/KR/코드 동기화)이 신뢰성 차별화 축.

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 정밀 재열람에서 신규 prod 코드 결함이 없었다(M-1/M-2 v21은 미커버 엔진 로직 게이트 + 핸들러 인자-명 정렬):

- `src/watcher/file-watcher.ts` — chokidar `ignored` 프레디킷·확장자 allowlist·flush 동시성·타이머 위생·대용량-배치 git-sync 라우팅·재시도/FATAL 강등(P20-1) 정상.
- `src/graph/graph-engine.ts` — Fisher-Yates + seeded PRNG + count-first 가드(200k) + BFS index-pointer 큐·반복 DFS 모두 O(V+E).
- `src/graph/architecture-engine.ts`(P22-1)·`optimization-engine.ts`(P23-2)·`remediation-engine.ts`(P23-1)·`refactoring-engine.ts` getRiskProfile(P23-3) — 게이트 커버.
- `src/graph/policy-discoverer.ts` — `discoverPolicies()` 로직 자체는 합리적(엣지 타입 필터·태그쌍 확률·threshold/minCount 게이트). **단 0% vitest 커버가 M-1 v21 대상, 핸들러 인자 검증 불일치가 M-2 v21 대상.**
- `src/server/tools/*.ts` — 대부분 검증-호출 인자명 일치(샘플 대조). **단 `discover-latent-policies.ts`만 불일치(M-2 v21).**
- `src/indexer/update-pipeline.ts` — 단일 책임·catch log-and-rethrow+롤백·원본 에러 보존(미세 항목만 L-9).
- `src/server/api-server.ts` — 세션 TTL/cap/sweep·timing-safe Bearer·8 REST 핸들러 supertest 게이트(P19-1)·rate-limit 양호.
- `src/server/ipc-coordinator.ts` — challenge-response 인증·1MB 제한·per-tool 타임아웃·keepalive(unref)·pending reject-on-close 견고.
- `src/server/tool-dispatcher.ts` — Terminal 포워딩·waitUntilReady·registry lookup·EngineNotReadyError 재시도 변환. 20/20 게이트(P18-1).
- `package.json` overrides — tree-sitter `^0.25.0`·fast-uri·qs·hono·postcss 충족, dev·prod audit 0/0. **better-sqlite3 lockfile 12.10.1 정렬(L-11 해소).**
- `README.md`(EN) — Node ≥ 22·export_graph·REST API 동기화(P21-2). **단 README_KR/GUIDE_EN/GUIDE_KR Node 버전은 ≥ 20 잔재 — L-12.**
- `.github/workflows/ci.yml` — Node 22/24 매트릭스 + `npm audit --omit=dev --audit-level=high`(P14-1) + `npm ci`. (cynapx-autonomous.yml은 본 진단 범위 외.)
- TODO/FIXME/XXX/HACK = 0건(`src/` 전수).

---

## 8. 권장 수정 순서 (Phase 24 제안 — 상세는 phase24-plan.md)

**Phase 23 이후 prod 코드는 steady-state(CRITICAL/HIGH 0, prod·dev audit 0/0, TODO 0, god-module 0, 핫패스 quadratic 0)이고 신규 prod-도달 CVE도 0건이나, v21은 v20이 *명시적으로 다음 사이클로 이연한* L-10 잔여를 P23-3 하니스 기준으로 재판정하고(PolicyDiscoverer가 이제 가벼움), 도구 핸들러 인자명을 엔진 호출 인자명과 대조해(검증-호출 불일치) 두 건의 actionable을 발굴했다.** CRITICAL/HIGH 0, MEDIUM 2(M-1 v21 PolicyDiscoverer 로직 게이트 — 테스트-only; M-2 v21 핸들러 인자-명 정렬+게이트 — ~5줄), LOW(L-2~L-9 v20 승계 + L-10 잔여 축소[proposeRefactor만] + L-12 신규 문서 드리프트; L-11 해소). 따라서 Phase 24는 **PolicyDiscoverer 게이트 + 핸들러 인자 정렬(P24-1, 같은 도구·같은 파일이라 한 페이즈) + 선택적 문서 동기화(P24-2) + 추적 갱신**이 합리적이다.

1. **P24-1 [예정]**: M-1 v21 + M-2 v21 해소 — (a) `tests/policy-discoverer.test.ts` 신규로 `discoverPolicies()`의 엣지 필터·태그쌍 카운팅·threshold/minCount 임계·probability 생성을 P23-3 `createInMemoryEngine()` 하니스 복사로 게이트(테스트-only); (b) `discover-latent-policies.ts`의 검증 블록 인자명을 실제 호출 인자명(`threshold` 0~1, `min_count` 양의 정수)으로 정렬(~5줄) + 디스패처/핸들러 테스트에 잘못된 인자 → isError 케이스 추가. 같은 도구·같은 파일이라 한 페이즈.
2. **(선택) P24-2 [예정]**: L-12 해소 — README_KR.md:62·GUIDE_EN.md:119·GUIDE_KR.md:119의 "Node.js ≥ 20"을 코드(`package.json >=22`)와 일치하도록 "≥ 22"로 정렬(docs-only, 3줄).
3. **추적 상태 갱신**: L-2(Miasma 도달 0 불변), L-3(SDK v2 *npm alpha 배포됨* — stable Q3까지 이연), L-6(node-tree-sitter#268 open), L-7/L-8 게이트 공백, L-9 잔여 클린업, L-10 잔여 축소(proposeRefactor만), **L-11 해소(better-sqlite3 12.10.1 정렬)**, L-12 문서 드리프트 현 상태를 다음 사이클 출발점으로 고정.

(L-4 IPC MessagePack 계속 보류, L-5 클러스터링 본격 파티셔닝 계속 이연, MCP 전면 stateless/task 마이그레이션은 SDK v2 stable 배포까지 이연, `proposeRefactor()` 게이트는 그래프 픽스처 무거워 다음 사이클, SCIP export는 전략 후보로 기록만.)
