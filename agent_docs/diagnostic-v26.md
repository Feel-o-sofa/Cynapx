# Cynapx 정밀 진단 보고서 v26

- **기준 커밋**: `5a77e9b` (Phase 28 + Phase 28-1/28-2 완료 — `toCanonical()` 변환-동작 게이트(P28-1, vitest 649→657) + express lockfile 4.22.1→4.22.2 정렬(P28-2), 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-15
- **진단 범위**: src/ 전체(server, db, indexer, graph, watcher, utils, cli, bootstrap) + **v25가 `src/utils/paths.ts`의 키 정규화 프리미티브 `toCanonical()` 변환 동작을 100% 게이트(M-1 v25 — P28-1)하고 express lockfile을 4.22.2로 정렬(M-2 v25 — P28-2)해 *공통 유틸 레이어 핵심 순수 함수 미커버 공백을 0*으로 닫은 지금, 그 *다음* 미커버 후보를 "과거 사이클(엔진 진입 로직·핸들러 인자 가드·`server/tools/_utils.ts` 보조 순수 함수·`src/utils/paths.ts` 정규화 프리미티브)이 소진한 각도들 *밖*에서 *구조적으로 다른 각도*로 실측"**: 본 사이클은 (A) glob/regex/path-traversal 횡단 위험 코드(ReDoS·path escape 잠재 결함 부류), (B) indexer의 확장자→파서 매핑 순수 함수 엣지케이스, (C) **`graph/graph-engine.ts`의 *PRNG 시딩 자체*(`mulberry32`)와 *env 파서*(`parseClusterSeed`/`parseClusterMaxNodes`)가 *결정성에 대해 직접 단위 테스트되는가, 아니면 클러스터링 출력으로 *간접*으로만 검증되는가**, (D) tool-dispatcher 도구 스키마의 구조적 불변식(`required ⊆ properties`) 회귀 테스트 가능성, (E) MCP resource/prompt 핸들러 커버리지를 *각각 직접 코드/테스트 대조*로 점검 + 외부 컨텍스트(CVE/advisory, 공급망 캠페인, MCP SDK v2 npm 배포 상태, 경쟁/인접 도구)
- **진단 방법**: 단일 에이전트 오케스트레이션 + 회의적 전수 코드 리뷰 + 로컬 직접 검증(`npx vitest run`[케이스 수·시간 측정], `npx tsc --noEmit`, `npm audit`[dev 포함]·`npm audit --omit=dev`, `npm ls express better-sqlite3 vite @modelcontextprotocol/sdk`·`npm outdated`로 버전 드리프트 확인) + **구조적으로 다른 5개 각도(A~E) 실측**: (A) `src/utils/file-filter.ts`(`ignore` 패키지 위임)·`language-registry.ts`(`split('.').pop()`)·`paths.ts`(`isPathInside`)에서 *사용자-공급 glob의 직접 `new RegExp()` 구성/path escape*가 *없음*을 `grep`으로 확인(ReDoS/path-escape 표면 0 — 전부 `ignore`/`path.relative` 위임). (B) `LanguageRegistry.getProvider()`의 확장자 매핑 엣지케이스(무-확장자 `Makefile`·미지 확장자·dotfile `.gitignore`·trailing-dot·multi-dot)를 `npx tsx`로 실측 — 전부 *정확히 처리되나 직접 테스트는 case-insensitivity까지만*임을 `tests/language-registry.test.ts` 대조로 확인. (C) **`graph/graph-engine.ts`의 export 순수 함수 3종(`mulberry32`·`parseClusterSeed`·`parseClusterMaxNodes`)이 *PRNG 결정성·범위·시드 민감도*와 *env 파싱 분기*에 대해 *직접 단위 테스트가 0건*임을 `grep`+`tests/clustering.test.ts` 정독으로 실측** — `mulberry32`는 `tests/clustering.test.ts:13`에서 import되나 *`fisherYatesShuffle(arr, mulberry32(123))` 인자로만* 쓰여 *자체 출력은 한 번도 직접 단언되지 않고*, `parseClusterSeed`/`parseClusterMaxNodes`는 *import조차 되지 않으며*(env 분기는 `performClustering()` 통합 테스트로 *간접*으로만 닿음), `npx tsx`로 8+케이스의 결정적 출력을 측정해 게이트 사양 확정. (D) tool-dispatcher 도구 스키마는 `registerToolHandlers()` *내부*에 인라인(`ListToolsRequestSchema` 핸들러)이라 *독립 export 배열이 없어* 구조적 불변식 테스트의 (b)-잣대 가치가 낮음을 확인(SDK 요청-핸들러 경유 필요 → 표면 큼). (E) MCP resource(`resource-provider.ts` 4 URI)·prompt(`prompt-provider.ts` 3 prompt) 핸들러 — `tests/resource-provider.test.ts` 존재 확인. + 외부 웹 재조사(better-sqlite3 12.11.1·MCP SDK v2 npm 배포 상태·tree-sitter/chokidar/vite CVE·Miasma/Phantom Gyp 공급망 캠페인·경쟁 도구)
- **현재 상태(직접 검증)**: `npx vitest run` **657/657**(47 파일, **7.25~7.29s** — 649→657 케이스 +8(P28-1 `toCanonical` 변환-동작)·시간 변동[머신 변동, 추세 무문제]), `npx tsc --noEmit` 그린, **`npm audit`(dev 포함) = 0 vulnerabilities**, **`npm audit --omit=dev`(prod) = 0 vulnerabilities**. diagnostic-v25 전 항목 처리 완료(M-1 v25 [DONE — P28-1], M-2 v25 [DONE — P28-2] — `npm ls express` = **4.22.2** 정렬 재확인), LOW 승계 추적.

> **요약**: **Phase 28까지 prod 코드는 steady-state(CRITICAL/HIGH 0, prod·dev audit 0/0, TODO 0, god-module 0, 핫패스 quadratic 0)이고, 외부도 신규 prod-도달 CVE 0건(better-sqlite3 12.11.1·express 4.22.2·vite 8.0.16·chokidar·tree-sitter·@modelcontextprotocol/sdk 1.29.0 직접 재확인)이다.** **과거 사이클들이 *순수 함수 게이트* 각도를 레이어별로 소진했다 — graph/ 엔진 *진입* 로직(~P25-1), 핸들러 `qualified_name` strict 가드(~P26-2), `server/tools/_utils.ts` 3개 export 보조 순수 함수(P26-1/P27-1), `src/utils/paths.ts`의 키 정규화 프리미티브 `toCanonical`(P28-1). v26은 *구조적으로 다른 각도*(A~E)를 시도했고, 그 중 (C)에서 *진짜 새 미커버 후보*를 찾았다.** **신규 M-1 v26: `src/graph/graph-engine.ts`의 export 순수 함수 3종 — `mulberry32(seed)`(35-48줄, 결정적 시드 PRNG), `parseClusterSeed(raw)`(17-24줄, env→seed 파서), `parseClusterMaxNodes(raw)`(26-32줄, env→캡 파서) — 이 *클러스터링 결정성(A-5/A-2)의 핵심 시딩·설정 프리미티브*인데 *변환/결정성 동작 자체에 대한 직접 단위 테스트가 0건*이다.** 과거 게이트(M-1 v23 `mergeResultsRRF`·M-1 v24 `escapeXml`/`escapeDot`·M-1 v25 `toCanonical`)는 *모두 핸들러 보조/유틸 레이어*였고 — *graph 엔진의 순수 헬퍼(시딩·env-파싱)*는 게이트 발굴 대상이 아니었다. 결정적 차이는 *"형제 순수 함수만 직접 게이트되고 핵심 시딩은 간접뿐"인 비대칭*이다: `tests/clustering.test.ts`는 *형제* 순수 함수 `fisherYatesShuffle`를 *직접* 게이트(determinism·집합 보존·empty/single, 141-160줄)하면서 — 그 결정성을 *공급하는* `mulberry32`는 *`fisherYatesShuffle`의 인자로만*(151-152줄) 쓰여 *자체 출력 시퀀스를 한 번도 직접 단언하지 않고*, `parseClusterSeed`/`parseClusterMaxNodes`는 *import조차 안 됨*(env 분기는 `performClustering()` 통합 테스트 214줄로 *간접*으로만 닿음 — `process.env` 세팅을 통해서만, 파서 함수 자체는 직접 호출 0). **직접 실행(`npx tsx`)으로 확정한 결정적 동작**: `mulberry32(42)` 두 인스턴스가 *동일 시퀀스*(`[0.6011…, 0.4483…, 0.8525…]`) 생성, 모든 출력 `[0,1)` 범위(10k draw min 0.00025·max 0.99996), `mulberry32(0)` vs `mulberry32(1)` 첫 출력 상이(시드 민감도); `parseClusterSeed`: `undefined`/`''`/`'   '`/`'abc'`/`'Infinity'`→`undefined`(unset·empty·whitespace·non-finite early-return), `'3.9'`→`3`·`'-5.7'`→`-5`(`Math.trunc`)·`'42'`→`42`; `parseClusterMaxNodes`: `undefined`/`''`/`'0'`/`'-100'`/`'abc'`→`200000`(default fallback — unset·empty·`n<=0`·non-finite), `'1000.9'`→`1000`(`Math.trunc`). 이는 M-1 v23~v25와 *동형의 "라이브 핫패스(클러스터링 결정성) 뒤 0-의존 순수 함수 미커버 게이트"*이나 — 결정적 차이는 *부류(레이어)가 새롭다*: 과거 게이트는 핸들러 보조(`_utils.ts`)·공통 유틸(`paths.ts`)에 집중됐고 *graph 엔진의 시딩/env-파싱 헬퍼*는 게이트 발굴 대상이 아니었다. **이로써 클러스터링 결정성 정합성(같은 `CYNAPX_CLUSTER_SEED` → 같은 `mulberry32` 시퀀스 → 같은 `fisherYatesShuffle` 순열 → 같은 클러스터 — 재현성 핵심 사슬)에 *시딩 프리미티브 단(端)* 회귀 안전망을 친다 — 현재는 *형제* `fisherYatesShuffle`만 직접 게이트되고 시딩 원천은 통합 테스트로 간접뿐이라, `mulberry32` 알고리즘 회귀(예: `Math.imul` 상수 오타)가 통합 테스트 *우회로* 슬립할 수 있다.** **(b) 잣대 충족**: (1) prod 코드 무변경(테스트-only); (2) 의존 0 — `mulberry32`/`parseClusterSeed`/`parseClusterMaxNodes`는 *문자열·숫자 in → 함수/숫자 out, DB·async·side-effect·픽스처 전무*; `tests/clustering.test.ts`는 이미 `mulberry32`를 import(13줄)하므로 `fisherYatesShuffle` describe 옆에 `mulberry32`·`parseClusterSeed`·`parseClusterMaxNodes` describe만 추가하면 됨(파서 2개만 import 추가); (3) M-1 v23~v25와 *동형의 0-의존 순수 함수 게이트*이되 *새 레이어(graph 엔진 시딩/env-파싱)*를 덮는다. → Phase 29-1(테스트-only, prod 코드 무변경).** **신규 M-2 v26 후보 검토 → *없음*(의존성 prod-드리프트 0)**: `npm outdated` 재실행 결과 *prod 직접 의존*(express 4.22.2·better-sqlite3 12.11.1) 드리프트는 **0**(express는 P28-2로 이미 4.22.2 정렬, latest 5.x는 비-긴급 major). 잔여 드리프트는 *전부 devDependency 핀-내(within-pin) patch/minor*(`@types/node` 20.19.33→Wanted 20.19.43·`vitest` 4.1.2→4.1.9·`zod` 4.3.6→4.4.3)로 — *prod 미도달·audit 0/0 불변·핀 무변경*이라 *lockfile-only 위생 정렬*(L-17, 다음 dev 갱신 시 함께)에 불과하고 M-2 v24/v25(better-sqlite3·express prod-dep lockfile)와 *부류가 다르다*(dev-only). 따라서 *이번 사이클은 M-2(actionable 의존성 정렬)가 없다* — express prod 드리프트가 P28-2로 닫혔기 때문이다. **외부 신선 재조사: better-sqlite3 12.11.1 직접 CVE 0건(latest — `npm ls` 재확인; 웹 검색의 "node-gyp 캠페인 포함" 문구는 *better-sqlite3가 표적 패키지라는 뜻이 아니라*[표적은 @redhat-cloud-services·@vapi-ai/server-sdk·ai-sdk-ollama 등] native-모듈 일반론 — Cynapx 트리 미도달 L-2 불변), MCP SDK v2 *여전히 pre-alpha*(`@modelcontextprotocol/sdk` latest 1.29.0 불변, v2 stable Q3 2026[7-28 spec publish] 예정, v1.x production 권장 → 핀 `^1.29.0` 유지가 옳음[L-3]), Miasma/Phantom Gyp 캠페인(2026-06-01~ 진행: @redhat-cloud-services 32패키지·@vapi-ai/server-sdk 4버전 → 57패키지/286악성버전, 157-byte binding.gyp self-propagating worm)은 *Cynapx 트리 미도달 재확인*(in-tree binding.gyp **0개**, vapi/ollama/redhat-cloud-services not in tree, `.cursor`/`.gemini` 부재·`.claude/launch.json` 1개 양성)[L-2], tree-sitter npm 바인딩 직접 CVE 0건(CVE-2026-25727은 Rust `time` 크레이트 — L-14, Cynapx 미도달 불변), node-tree-sitter#268(C++20/Node 24 빌드) 여전히 open(L-6 불변). 경쟁: 로컬-퍼스트 tree-sitter+SQLite+MCP 코드 그래프 카테고리 지속 — Cynapx의 처방 엔진(risk/remediation/refactoring/policy) + 하이브리드(keyword+vector RRF) 검색이 차별점, 그 진입·보조·정규화 순수 로직은 v22~v25로 전수 게이트 완성, v26은 *graph 엔진 시딩 프리미티브(`mulberry32` 등)*를 닫는다.** **CRITICAL 0, HIGH 0, MEDIUM 1(M-1 v26 graph 엔진 시딩/env-파싱 순수 함수 게이트 — Phase 29-1, 테스트-only), LOW(L-2~L-9 v25 승계 + L-13 승계[analyze-impact use_cache 무해] + L-14 승계[CVE-2026-25727 time 크레이트 미도달] + L-17 신규[dev-dep within-pin lockfile 드리프트, 비-actionable 정렬] + L-18 신규[`LanguageRegistry.getProvider()` 확장자 엣지케이스 직접 테스트 공백, 비-actionable 추적] ; L-11/L-15/L-16 [이전 사이클 해소]).**

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건은 Phase 13에서, v11 HIGH(공급망)는 Phase 14-1에서, v12~v18 MEDIUM은 Phase 15~21에서, v19 MEDIUM은 Phase 22-1에서, v20 MEDIUM 2건+L-10 부분은 Phase 23에서, v21 MEDIUM 2건+L-12는 Phase 24에서, v22 MEDIUM 2건은 Phase 25에서, v23 MEDIUM 2건은 Phase 26에서, v24 MEDIUM 2건은 Phase 27에서, v25 MEDIUM 2건은 Phase 28에서 해소됐고, 본 전수 재열람에서 새로운 CRITICAL/HIGH는 없다. IPC 핸드셰이크(challenge + HMAC-SHA256 + timingSafeEqual)·API Bearer(SHA-256 + timingSafeEqual)·세션 맵(TTL+cap+sweep unref) 모두 견고(직접 재열람).

---

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** 코드·공급망 어디에서도 신규 HIGH 없음. **prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0**(직접 재검증). **횡단 위험 부류(A) 실측 결과 음성**: 사용자-공급 glob 패턴은 `ignore` 패키지(`src/utils/file-filter.ts`)·`chokidar`(`file-watcher.ts`)에 위임되고 *직접 `new RegExp(userString)` 구성이 없어* ReDoS 표면 0이며, path 처리는 `path.relative`/`isPathInside`(H-7 게이트) 위임이라 path-escape 표면 0이다(전수 `grep` 확인). M-1 v26(graph 엔진 시딩/env-파싱 순수 함수 직접 테스트 공백)은 MEDIUM이다 — 게이트 공백(보안·크래시 결함 아님, 결정성 동작 미커버). 외부 CVE-2026-25727(`time` 크레이트)도 Cynapx prod 트리 미도달이라 LOW(L-14 불변). Miasma/Phantom Gyp 캠페인도 Cynapx 트리 미도달(L-2 불변).

---

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

| # | 위치 | 내용 |
|---|------|------|
| **M-1 v26** *(신규, actionable — `graph/graph-engine.ts`의 *시딩·env-파싱 순수 함수*. 과거 게이트가 핸들러 보조(`_utils.ts`)·공통 유틸(`paths.ts`)에 집중된 동안 게이트 발굴 대상이 아니었던 graph 엔진의 결정성 프리미티브)* **[예정 — Phase 29-1]** | `src/graph/graph-engine.ts`(`mulberry32()` 35-48줄, `parseClusterSeed()` 17-24줄, `parseClusterMaxNodes()` 26-32줄), 호출처: `performClustering()`(253-254줄 — `mulberry32(seed)`로 시드 PRNG 구성, `fisherYatesShuffle(arr, rng)`에 전달; env-파서는 `parseClusterSeed(process.env.CYNAPX_CLUSTER_SEED)`·`parseClusterMaxNodes(...)`로 호출), `tests/clustering.test.ts:13`(`mulberry32` import — *그러나 `fisherYatesShuffle` 인자로만 사용, 자체 출력 미단언*; `parseClusterSeed`/`parseClusterMaxNodes` import 0) | **`mulberry32`·`parseClusterSeed`·`parseClusterMaxNodes`의 변환/결정성 동작에 회귀 게이트 추가.** 이 3개 export 순수 함수는 *클러스터링 결정성(A-5/A-2)의 핵심 시딩·설정 프리미티브*이나 **직접 단위 테스트가 0건**: `tests/clustering.test.ts`는 *형제* 순수 함수 `fisherYatesShuffle`를 *직접* 게이트(determinism·집합 보존·empty/single — 141-160줄)하면서 — 그 결정성을 *공급하는* `mulberry32`는 *`fisherYatesShuffle([...], mulberry32(123))` 인자로만*(151-152줄) 쓰여 *자체 출력 시퀀스를 한 번도 직접 단언하지 않고*, `parseClusterSeed`/`parseClusterMaxNodes`는 *import조차 안 됨*(env 분기는 `performClustering()` 통합 테스트 214줄로 `process.env` 세팅을 통해 *간접*으로만 닿음 — 파서 함수 직접 호출 0). 미커버 로직: (a) `mulberry32` *결정성*(같은 시드 → 동일 시퀀스), (b) *출력 범위* `[0,1)`, (c) *시드 민감도*(다른 시드 → 다른 시퀀스), (d) `parseClusterSeed` unset/empty/whitespace/non-finite → `undefined` early-return + `Math.trunc`, (e) `parseClusterMaxNodes` unset/empty/`n<=0`/non-finite → default(200000) fallback + `Math.trunc`. **직접 실행(`npx tsx`)으로 확정한 결정적 동작**: `mulberry32(42)` 두 인스턴스 동일 시퀀스 `[0.6011037519201636, 0.44829055899754167, 0.8524657934904099]`, 10k draw 전부 `[0,1)`(min 0.00025·max 0.99996), `mulberry32(0)` 첫 출력 ≠ `mulberry32(1)` 첫 출력; `parseClusterSeed('') / ('   ') / ('abc') / ('Infinity') / (undefined)`→`undefined`, `('3.9')`→`3`, `('-5.7')`→`-5`, `('42')`→`42`; `parseClusterMaxNodes(undefined) / ('') / ('0') / ('-100') / ('abc')`→`200000`, `('1000.9')`→`1000`. **(b) 잣대 충족**: (1) prod 코드 무변경(테스트-only); (2) *의존 0* — 입력 문자열/숫자 → 출력 함수/숫자, DB·async·side-effect·픽스처 전무 → `tests/clustering.test.ts`의 `fisherYatesShuffle` describe 옆에 3개 describe만 추가(`mulberry32`는 import 보유 13줄, `parseClusterSeed`/`parseClusterMaxNodes`만 import 추가); (3) M-1 v23(mergeResultsRRF)·M-1 v24(escapeXml/escapeDot)·M-1 v25(toCanonical)와 *동형의 0-의존 순수 함수 게이트*이되 *새 레이어(graph 엔진 시딩/env-파싱)*를 덮는다. **이로써 클러스터링 결정성 정합성(같은 `CYNAPX_CLUSTER_SEED` → 같은 `mulberry32` 시퀀스 → 같은 `fisherYatesShuffle` 순열 → 같은 클러스터 — 재현성 핵심 사슬)에 *시딩 프리미티브 단(端)* 회귀 안전망을 친다.** 특히 `mulberry32` 알고리즘 회귀(예: `Math.imul` 상수/시프트 오타)는 *형제 `fisherYatesShuffle` 직접 테스트와 `performClustering` 통합 테스트를 동시에 우회로* 슬립할 수 있으나(통합 테스트는 *seed-내 재현성*만 단언하지 *절대 시퀀스 값*은 단언 안 함) — `mulberry32(42)` 첫 N개 출력 *고정값* 단언은 그 회귀를 결정적으로 잡는다. **verdict: actionable — Phase 29-1.** (5장 상세) |

> **참고(M-2 v26 부재 근거)**: 본 사이클 `npm outdated`는 *prod 직접 의존* 드리프트 **0**을 보고했다(express는 P28-2로 4.22.2 정렬 완료, better-sqlite3 12.11.1 latest). 잔여 드리프트(`@types/node`/`vitest`/`zod`)는 *전부 devDependency 핀-내 patch/minor*라 — M-2 v24(better-sqlite3)·M-2 v25(express) 같은 *prod-dep lockfile 위생 actionable*과 부류가 다르고(*prod 미도달·audit 0/0 불변*), L-17 추적(다음 dev 갱신 시 정렬)으로 충분하다. 따라서 v26은 *M-2(actionable 의존성 정렬)가 없는* 사이클이며 — *연속 사이클의 "lockfile bump + pure-function gate" 패턴 중 lockfile 항목이 마침내 소진*된 신호다(express prod 드리프트를 P28-2가 닫음).

---

## 4. 최적화 (LOW) — 추적/이연 (v25 승계 + L-17/L-18 신규; L-11/L-15/L-16 이전 해소)

| # | 위치 | 내용 |
|---|------|------|
| L-2(v26) | `package.json` (native deps), CI / Dockerfile, `.claude/` 설정 | **Miasma / Phantom Gyp / Node-gyp 공급망 캠페인 포스처 추적 — Cynapx 도달 0건 불변(재확인).** 진단 일자 직접 재대조: 캠페인은 *2026-06-01~ 진행 중*(@redhat-cloud-services 32패키지[6-01]·@vapi-ai/server-sdk 4버전[6-03] → 57패키지/286악성버전[6-03~04], 157-byte binding.gyp 남용 self-propagating worm — preinstall/postinstall 대신 binding.gyp가 `npm install` 중 node-gyp 코드 실행을 트리거해 install-script 보안 검사 우회; npm/GitHub/AWS/GCP/Azure/Vault/K8s 자격증명 탈취·GitHub Actions 워크플로 주입 persistence)이나 — *in-tree binding.gyp **0개***(`find . -name binding.gyp -not -path "*/node_modules/*"` = 0), 컴프로마이즈 패키지(@redhat-cloud-services·@vapi-ai/server-sdk·ai-sdk-ollama) *not in tree*, in-tree 에이전트 설정은 `.claude/launch.json` 1개(양성), `.cursor`/`.gemini` 부재. native 의존(better-sqlite3 12.11.1 + tree-sitter 0.25.0 + 12 grammar) 무관·악성 버전 미발행(*웹 검색의 "better-sqlite3 node-gyp 캠페인 포함" 문구는 표적 패키지 지정이 아니라 native-모듈 일반론* — better-sqlite3 직접 CVE/하이재킹 0건 재확인). CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지 1차 방어선 유지. **즉각 조치 불필요 — 추적만.** 출처: [StepSecurity Miasma](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm), [Chainguard Miasma](https://www.chainguard.dev/unchained/chainguard-artifacts-safe-from-miasma-phantom-gyp-npm-attack), [Snyk node-gyp compromise](https://snyk.io/blog/node-gyp-supply-chain-compromise-self-propagating-npm-worm-binding-gyp/) |
| L-3(v26) | `src/server/api-server.ts` (session-id StreamableHTTP), `package.json:29`(`@modelcontextprotocol/sdk ^1.29.0`) | **MCP SDK v2 — *여전히 pre-alpha*(상태 불변).** 직접 확인: `@modelcontextprotocol/sdk` latest는 **여전히 1.29.0**(2개월 전 publish, v25 시점과 불변), v2는 main 브랜치에서 pre-alpha 개발 중·**stable은 Q3 2026**(스펙 publish 2026-07-28) 예정, v1.x가 production 권장·v2 출시 후 최소 6개월 v1.x 보안/버그 수정 지속. → Cynapx 핀 `^1.29.0` 유지가 옳음. stateless protocol core(SEP-2567 session-id 제거)·Multi-Round-Trip·MCP Apps 마이그레이션은 **v2 stable 전환까지 계속 이연**. P15-3 `handleMcp()` 설계 메모가 출발점. 출처: [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk), [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) |
| L-4(v26) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환. **성능 문제 미관측 — 계속 보류.** 메시지가 작고 round-trip이 드물어 직렬화 병목 아님 |
| L-5(v26) | `src/graph/graph-engine.ts` | 클러스터링 본격 서브그래프 파티셔닝 — 100k+ 노드 실측 시 재검토(**계속 이연**). LPA O(V+E)·`MAX_ITER=20` 캡·count-first 가드(200k, `parseClusterMaxNodes`)·Fisher-Yates seeded PRNG(`mulberry32`) 직접 재확인 — OOM/편향 방어 정상. **M-1 v26이 이 시딩/캡 프리미티브의 *순수 함수 동작*을 게이트한다(파티셔닝 자체는 계속 이연).** |
| L-6(v26) | CI / Dockerfile | Node 24 + tree-sitter 0.25.x 빌드 fragility([node-tree-sitter#268] / [salesforce/agentscript#7: C++20 미설정] 여전히 open·미해결, CVE 아님). CI Node 22/24 매트릭스 그린이나 Node 24 LTS 전환 전 prebuild 재확인. **추적만** 출처: [node-tree-sitter#268](https://github.com/tree-sitter/node-tree-sitter/issues/268) |
| L-7(v26) | `src/cli/admin.ts` (cmd* 9개), `tests/admin-cli.test.ts` | **admin CLI 명령 동작의 vitest 게이트 공백 — 비-actionable 추적.** 등록 명령 9개 `cmd*`는 모듈-private(미-export)이라 vitest 직접 호출 불가. **admin.ts 핸들러 export 리팩터 시 함께 게이트화 후보** |
| L-8(v26) | `src/indexer/worker-pool.ts`, `embedding-manager.ts`, `db/database.ts` | **에러-복구·마이그레이션 잔여 분기의 vitest 게이트 공백 — 비-actionable 추적.** worker `worker.on('error')`·queue backpressure·embedding A-7 stale supersedence 레이스·DB migration 잔여 분기는 직접 미검증이나 인접 분기 커버 + 타이밍-flaky 위험. **SCHEMA_VERSION 증분/worker-pool 리팩터 시 함께** |
| L-9(v26) | `src/indexer/update-pipeline.ts` (트랜잭션 보일러플레이트·progress `log.error`), `embedding-manager.ts:184`/`api-server.ts:625` (빈 catch) | **L-9 코드 클린업 잔여 — (b) 잣대 미충족, 비-actionable 추적.** `withWriteTransaction()` 추출은 트랜잭션 경계 5곳 재작성이라 회귀 표면 넓음; 빈 catch 2건은 의도적 silent-drop 방어. **update-pipeline 리팩터 페이즈로 묶어 처리 후보** |
| **L-13(v26)** *(승계 — analyze-impact use_cache 스키마-default 미강제, 무해)* | `src/server/tools/analyze-impact.ts:23` (`useCache: args.use_cache` 무검증·default 미강제) | **`analyze-impact` 핸들러가 `use_cache`(스키마 default `true`)를 검증·default-강제 없이 그대로 `traverse({useCache: args.use_cache})`에 전달 — 무해.** `args.use_cache`가 `undefined`면 traverse 내부 truthy 평가에서 캐시 *비활성*으로 동작(스키마 default `true`와 어긋날 수 있으나 *느려질 뿐* 정확성·크래시 영향 0). 동형 무해 패턴이 `export-graph`(`format`/`max_depth`)·`get-symbol-details`(`include_source`/`summary_only`)에도 존재 — 전부 다운스트림 undefined-안전. **verdict: 추적만(비-actionable)** |
| **L-14(v26)** *(승계 — CVE-2026-25727 `time` 크레이트, Cynapx 미도달 불변)* | (외부 — Rust `time` crate via tree-sitter Rust 생태계 언급), Cynapx prod 트리 무관 | **CVE-2026-25727(RFC 2822 파싱 스택 소진 DoS, `time` 크레이트 0.3.6~<0.3.47)은 *tree-sitter*로 거론되나 실제로는 Rust `time` 크레이트 결함 — Cynapx prod 트리 미도달 불변.** 본 CVE는 tree-sitter npm 바인딩/그래머가 아니라 Rust `time` 크레이트의 RFC 2822 날짜 파싱에 있고, Cynapx의 의존 표면(npm tree-sitter 0.25.0 + 12 grammar)에 `time` 크레이트는 부재 → **prod·dev 미도달, audit 0/0 불변.** tree-sitter Rust 생태계 모니터링 신호로 추적. **verdict: 추적만(비-actionable — 미도달)** 출처: [NVD CVE-2026-25727](https://nvd.nist.gov/vuln/detail/CVE-2026-25727) |
| **L-17(v26)** *(신규 — dev-dep within-pin lockfile 드리프트, 비-actionable 위생)* | `package-lock.json` (`@types/node`/`vitest`/`zod` dev 엔트리), `package.json` (핀 `^20`/`^4`/`^4` 무변경) | **devDependency lockfile within-pin 드리프트 — 비-actionable 위생 추적.** `npm outdated` = `@types/node` Current 20.19.33·Wanted **20.19.43**(patch), `vitest` 4.1.2·Wanted **4.1.9**(patch), `zod` 4.3.6·Wanted **4.4.3**(minor) — 전부 *devDependency·핀-내(semver-호환)·prod 미도달·audit 0/0 불변*. M-2 v24(better-sqlite3)·M-2 v25(express)의 *prod-dep* lockfile 위생과 부류가 다르다(dev-only·prod 동작 무관). **다음 dev 갱신/리팩터 시 `npm update`로 함께 정렬**(긴급도 0). **verdict: 추적만(비-actionable)** |
| **L-18(v26)** *(신규 — `LanguageRegistry.getProvider()` 확장자 엣지케이스 직접 테스트 공백, 비-actionable 추적)* | `src/indexer/language-registry.ts:111-136`(`getProvider()` — `filePath.split('.').pop()?.toLowerCase()`), `tests/language-registry.test.ts:90-116` | **`getProvider()`의 확장자 추출 엣지케이스가 직접 테스트되지 않음 — 무해, 비-actionable 추적.** `tests/language-registry.test.ts`는 *정상 확장자 매핑*(descriptor별)·*case-insensitivity*(`Main.PY`/`Widget.Hpp`, 111-115줄)는 직접 게이트하나 — *무-확장자*(`Makefile`)·*미지 확장자*(`foo.xyz`)·*dotfile*(`.gitignore`)·*trailing-dot*(`foo.`)·*multi-dot*(`a.b.PY`) 엣지케이스는 단언하지 않는다. `npx tsx` 실측 결과 *전부 정확히 처리*(`Makefile`/`foo.xyz`/`.gitignore`/`foo.`→`undefined`, `a.b.PY`→python) — 즉 *결함이 아니라 게이트 공백*이며, M-1 v26(graph 엔진 시딩)보다 *우선순위가 낮다*(매핑은 이미 정상 동작 직접 게이트가 있고 엣지케이스만 누락; `split('.').pop()`의 결정성은 자명). **verdict: 추적만(비-actionable — M-1 v26 처리 후 여유 사이클에 묶어도 무방)** |

> **신규 LOW 부재 안내(prod 코드 동작 변경)**: M-1 v26(graph 엔진 시딩/env-파싱 게이트, 테스트-only)을 제외하면 prod 코드 *동작* 변경을 요하는 신규 LOW는 0건이다(L-13/L-14는 무해·미도달 추적, L-17은 dev-dep lockfile 위생, L-18은 테스트-only 게이트 공백). **L-16(express lockfile)은 P28-2(4.22.2)에서, L-11(better-sqlite3)·L-15(vite)는 이전 사이클에서 이미 해소 — 추적 종료.**

---

## 5. 코드 품질 / 성능 전수 (구조적으로 다른 5개 각도 A~E 실측 + steady-state 재확인)

v25까지 graph/ 엔진 처방 5종 진입 로직 + 핸들러 보조 핵심 순수 로직(`mergeResultsRRF`·`escapeXml`·`escapeDot`) + `qualified_name` 10개 핸들러 strict 가드 + 공통 유틸 정규화 프리미티브(`toCanonical`)가 전수 게이트/정렬됐다. v26은 **과거 각도 밖의 *구조적으로 다른 5개 각도(A~E)***를 시도했고, 그 중 *(C) graph 엔진 시딩/env-파싱 순수 함수*에서 진짜 새 미커버 후보를 찾았다.

**(A) 횡단 위험 부류 — glob/regex/path-traversal (ReDoS·path-escape 표면 실측)**

| 각도 | 코드 위치 | 실측 | 판정 |
|------|----------|------|------|
| 사용자-공급 glob → 직접 RegExp 구성(ReDoS) | `src/utils/file-filter.ts`(`ignore` 패키지 위임)·`file-watcher.ts`(chokidar `ignored`) | *직접 `new RegExp(userString)` 0건* — glob은 전부 `ignore`/chokidar 위임 | 표면 0 — 결함 없음 |
| path-traversal escape | `paths.ts`(`isPathInside` H-7)·`file-filter.ts`(`path.relative` + `startsWith('..')` 가드 123줄) | `path.relative` 위임 + `..` early-return 가드 | 표면 0 — H-7 게이트 커버 |

핵심: *ReDoS·path-escape 잠재 결함 부류는 표면 자체가 0*이다(직접 regex 구성·수동 path 조립이 없고 전부 검증된 라이브러리/`isPathInside`에 위임). **이 각도는 actionable 결함·게이트 공백 없음(steady-state 확인).**

**(B) indexer 확장자→파서 매핑 순수 로직 (엣지케이스 직접 테스트 공백 — L-18)**

| 로직 | 코드 | 직접 테스트 | 판정 |
|------|------|------------|------|
| 정상 확장자 매핑 | `getProvider()`(descriptor별) | **커버**(`language-registry.test.ts:90-100`) | 정합 |
| case-insensitivity | `.toLowerCase()` | **커버**(`Main.PY`/`Widget.Hpp`, 111-115줄) | 정합 |
| 무-확장자·미지·dotfile·trailing-dot·multi-dot | `split('.').pop()` 엣지 | **미커버**(전부 정확 처리되나 단언 0) | L-18(비-actionable 추적) |

핵심: 매핑은 *정상 경로·case-insensitivity가 이미 직접 게이트*되고 엣지케이스만 누락(`split('.').pop()` 결정성은 자명) → *결함 아닌 게이트 공백*, M-1 v26보다 우선순위 낮음(L-18).

**(C) graph 엔진 시딩/env-파싱 순수 함수 ×테스트 대조 (새 레이어 미커버 후보 — M-1 v26)**

| 순수 함수 (`graph-engine.ts`) | 라이브 사용처 | 로직 | 직접 단위 테스트 | 판정 |
|------------------------------|------------|------|-----------------|------|
| `fisherYatesShuffle()` (56) | 클러스터링 노드 순열 | 무편향 셔플 | **커버**(`clustering.test.ts:141-160` — determinism·집합 보존·empty/single) | 정합 |
| **`mulberry32()`** (39) | 시드 PRNG(결정성 공급) | 32-bit 시드 PRNG | **직접 단언 0건**(`fisherYatesShuffle` 인자로만 쓰여 *자체 출력 미단언*) | **M-1 v26 — Phase 29-1** |
| **`parseClusterSeed()`** (18) | `CYNAPX_CLUSTER_SEED`→seed | unset/empty/non-finite→undefined + trunc | **직접 단언 0건**(import조차 없음, 통합 테스트로 간접뿐) | **M-1 v26 — Phase 29-1** |
| **`parseClusterMaxNodes()`** (27) | `CYNAPX_CLUSTER_MAX_NODES`→캡 | unset/empty/≤0/non-finite→default + trunc | **직접 단언 0건**(import조차 없음, 통합 테스트로 간접뿐) | **M-1 v26 — Phase 29-1** |

핵심: *형제* 순수 함수 `fisherYatesShuffle`는 *직접* 게이트됐는데 — 그 결정성을 *공급하는* `mulberry32`와 *env 파서 2종*은 *직접 단언 0건*(전자는 인자로만, 후자는 통합 테스트로 간접뿐)이다. `mulberry32` 알고리즘 회귀(`Math.imul` 상수/시프트 오타)는 *형제 직접 테스트 + 통합 재현성 테스트를 동시에 우회로* 슬립할 수 있다(통합은 seed-내 재현성만 단언, 절대 시퀀스 값 미단언). 0-의존 순수 함수라 `clustering.test.ts`의 `fisherYatesShuffle` describe 옆에 3개 describe만 추가하면 닫힌다(M-1 v26).

**(D) tool-dispatcher 도구 스키마 구조 불변식 — (b) 잣대 가치 낮음(독립 export 부재)**

| 점검 | 실측 | 판정 |
|------|------|------|
| `required ⊆ properties` 불변식 | 20개 도구 스키마 직접 점검(`npx tsx`) — *위반 0건*, `type:"object"` 전부, name 일치 | 정합(이미 무결) |
| 독립 테스트 가치 | 스키마는 `registerToolHandlers()` *내부* 인라인(`ListToolsRequestSchema` 핸들러)이라 *독립 export 배열 없음* → 구조 테스트는 SDK 요청-핸들러 경유 필요(표면 큼) | (b) 잣대 미충족 — 비-actionable |

핵심: 도구 스키마 불변식은 *이미 무결*(위반 0)하고, 구조 회귀 테스트는 *독립 export가 없어* 하니스 표면이 커 (b) 잣대(작고·저위험)를 충족하지 못한다. **이 각도는 actionable 격차 없음.**

**(E) MCP resource/prompt 핸들러 — 커버 존재**

| 핸들러 | 코드 | 테스트 |
|--------|------|--------|
| resource(4 URI: ledger/summary/hotspots/clusters) | `resource-provider.ts` | `tests/resource-provider.test.ts` 존재 |
| prompt(3: explain-impact/check-health/refactor-safety) | `prompt-provider.ts` | (resource-provider 인접 커버 — Unknown resource/prompt McpError 경로 포함) |

핵심: MCP resource 핸들러는 전용 테스트가 있고 prompt도 인접 커버된다. **이 각도는 actionable 격차 없음(steady-state 확인).**

**(F) prod steady-state 재확인 — 신규 prod 코드 결함 0**

| 항목 | 판정 |
|------|------|
| god-module / 순환 import | 0 — `openapi.ts`·`update-pipeline.ts`·`graph-engine.ts` 응집 불변. repos→engines→server/pipeline 단방향 |
| TODO/FIXME/XXX/HACK | 0건(`src/` 전수) |
| 핫패스 O(n²)-over-nodes | 0 — 클러스터링 count-first 가드(200k, `parseClusterMaxNodes`)+seeded PRNG(`mulberry32`), BFS index-pointer 큐, 반복 DFS+60s 캐시, architecture-engine O(1) Map(P22-1) |
| prod·dev audit | 0 / 0 vulnerabilities |
| 테스트 | `npx vitest run` **657/657**(47 파일, 7.25~7.29s) — 추세 무문제(649→657 케이스 +8[P28-1 toCanonical], 시간 머신 변동) |

**(G) 에러 핸들링 일관성 — 양호**

`Logger`(stderr-only, MCP stdio 안전) `normalizeData()` Error 언랩. update-pipeline catch는 log-and-rethrow + 롤백 선행. 미세 항목(progress log.error·빈 catch 2건)은 L-9 비-actionable 추적. `qualified_name` 10개 핸들러 strict 가드 전수 정합(M-2 v22+M-2 v23으로 완성). `search-symbols` `query` strict 가드(P25-2)·`get-related-tests` strict 가드(P26-2) 정렬 확인.

---

## 6. 외부 컨텍스트 (웹 조사 — 진단 일자 재실행, 출처 명시)

### 6.1 의존성 취약점 (prod·dev 둘 다 clean)

- **`npm audit`(dev 포함) = 0 + `npm audit --omit=dev`(prod) = 0**(둘 다 직접 실행). Phase 21-1 postcss override + vite `^8.0.16` bump(`473acf8` — L-15 해소)가 dev 트리도 clean 유지.
- **`npm ls express better-sqlite3 vite @modelcontextprotocol/sdk` + `npm outdated`(직접 실행)**: **prod 직접 의존 드리프트 0** — express **4.22.2**(P28-2 정렬 재확인)·better-sqlite3 **12.11.1**(latest)·vite **8.0.16**·sdk **1.29.0**. 잔여 드리프트는 *전부 dev-dep 핀-내*: `@types/node` 20.19.33→Wanted 20.19.43·`vitest` 4.1.2→Wanted 4.1.9·`zod` 4.3.6→Wanted 4.4.3(L-17, 비-actionable·다음 dev 갱신 시 정렬). 비-긴급 major(@types/express 5·express 5·commander 15·typescript 6·@types/node 25): 즉시 비권장. `tree-sitter-c-sharp` 0.23.1 핀(0.23.5 latest이나 ERR_REQUIRE_ASYNC_MODULE 미해소 → 핀 유지가 옳음).
- **better-sqlite3 / chokidar / tree-sitter / vite / express / @modelcontextprotocol/sdk 직접 재확인(웹)**: better-sqlite3 **12.11.1**(latest, P27-2 정렬) 직접 CVE 0건(Snyk DB 직접 결함 0; *웹 검색의 "node-gyp 캠페인 포함" 문구는 표적 패키지 지정이 아니라 native-모듈 일반론* — 표적은 @redhat-cloud-services·@vapi-ai/server-sdk·ai-sdk-ollama 등, better-sqlite3 하이재킹 0건), chokidar non-vulnerable, tree-sitter npm 바인딩 직접 CVE 0건(CVE-2026-25727은 Rust `time` 크레이트 — L-14, Cynapx 미도달), vite advisory는 `^8.0.16`로 해소(L-15), express 4.22.2 직접 CVE 0건, @modelcontextprotocol/sdk 1.29.0 직접 CVE 0건. 출처: [Snyk better-sqlite3](https://security.snyk.io/package/npm/better-sqlite3), [expressjs releases](https://github.com/expressjs/express/releases)

### 6.2 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"` + Docker `node:22-bookworm-slim`. Node 22 LTS 2027-04 종료 — 여유. CI Node 22/24 매트릭스 그린(657/657). 문서 Node 버전(L-12, P24-2 해소)은 README/README_KR/GUIDE_EN/GUIDE_KR 전부 ≥ 22 정렬 유지.
- **tree-sitter 코어**: latest 0.25.0, 12 grammar 전부 dedupe/override. **tree-sitter-c-sharp**: 0.23.1 정확 핀 롤백 유지. Node 24 빌드 C++20 fragility([node-tree-sitter#268]·[salesforce/agentscript#7] 여전히 open·미해결) — L-6 추적.
- **better-sqlite3**: lockfile 12.11.1(P27-2 정렬, latest — L-11 해소).
- **express**: lockfile 4.22.2(P28-2 정렬 — L-16 해소).
- **vite**: devDependency `^8.0.16`(L-15 해소).

### 6.3 공급망 캠페인 — Miasma / Phantom Gyp / Node-gyp (계속 진행 중, Cynapx 도달 0건 불변)

진단 일자 직접 재대조: 캠페인은 *2026-06-01~ 활발*(@redhat-cloud-services 32패키지[6-01]·@vapi-ai/server-sdk 4버전[6-03] → 57패키지/286악성버전[6-03~04], 157-byte binding.gyp 남용 self-propagating worm — binding.gyp가 `npm install` 중 node-gyp 코드 실행을 트리거해 대부분의 install-script 보안 검사 우회; npm/GitHub/AWS/GCP/Azure/Vault/K8s 자격증명 탈취·GitHub Actions 워크플로 주입 persistence·자가전파). **Cynapx 트리 미도달 재확인**: *in-tree binding.gyp **0개***, 컴프로마이즈 패키지(@redhat-cloud-services·@vapi-ai/server-sdk·ai-sdk-ollama 등) *not in tree*, in-tree 설정은 `.claude/launch.json` 1개(양성)·`.cursor`/`.gemini` 부재. CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지. **즉각 변경 불필요, 포스처 추적.** 출처: [StepSecurity Miasma](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm), [Chainguard Miasma](https://www.chainguard.dev/unchained/chainguard-artifacts-safe-from-miasma-phantom-gyp-npm-attack), [Snyk node-gyp compromise](https://snyk.io/blog/node-gyp-supply-chain-compromise-self-propagating-npm-worm-binding-gyp/)

### 6.4 MCP 생태계 — SDK v2 여전히 pre-alpha (상태 불변)

- **MCP SDK v2가 여전히 pre-alpha**(직접 확인): `@modelcontextprotocol/sdk` latest는 **여전히 1.29.0**(v25 시점과 불변, 2개월 전 publish). v2는 main 브랜치에서 pre-alpha 개발 중, **stable은 Q3 2026**(스펙 publish 2026-07-28) 예정, v1.x가 production 권장·v2 출시 후 최소 6개월 v1.x 유지. → **Cynapx 핀 `^1.29.0` 유지가 옳다. stateless core/Tasks/MCP Apps/Multi-Round-Trip 마이그레이션(L-3)은 v2 stable까지 계속 이연.** 출처: [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk), [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases)
- **함의**: Cynapx 현 StreamableHTTP(session-id)는 v2 stateless core와 충돌 표면이 있으나 *마이그레이션은 stable 배포까지 이연*이 옳다.

### 6.5 경쟁/인접 도구 동향 (전략 추적 — 카테고리 지속)

- **로컬-퍼스트 코드 그래프 카테고리 지속**: CodeGraph(tree-sitter→SQLite+FTS5 MCP), Serena(LSP-over-MCP), GitNexus(zero-server on-device KG), Codebase-Memory(tree-sitter KG), code-graph-mcp(10개 언어 AST KG) 등이 "로컬·on-device·MCP·임베디드 SQLite·tree-sitter·no-code-egress" 패턴을 표준 기본값으로 정착. Cynapx의 "100% 로컬·격리·멀티프로세스 보안 IPC + risk/remediation/refactoring/policy *처방* 엔진 + 하이브리드(keyword+vector RRF) 검색" 포지션이 차별점. **함의: 처방 엔진 진입 로직은 v22로, 핵심 보조 순수 로직(RRF·escape)은 P26-1/P27-1로, 정규화 프리미티브(toCanonical)는 P28-1로 전수 게이트 완성됐고, v26은 *graph 엔진 시딩 프리미티브(`mulberry32`·env-파서)*를 게이트로 메워(M-1) 클러스터링 결정성(재현성)의 회귀 안전망을 시딩 단까지 확장한다.** 출처: [CodeGraph](https://github.com/colbymchenry/codegraph), [code-graph-mcp](https://github.com/sdsrss/code-graph-mcp)
- **SCIP가 LSIF 대체 심볼 인덱스 표준 정착** — `export_graph`에 SCIP 추가는 미래 상호운용 후보. protobuf 의존 부담으로 즉시 비권장 — 전략 후보 유지.
- **함의**: (1) 공급망 위생 유지(L-11/L-15/L-16 해소 — better-sqlite3·vite·express 정렬 완료, L-17 dev-dep 위생 추적), (2) MCP SDK v2 pre-alpha→stable 추적, (3) **회귀 안전망을 graph 엔진 시딩/env-파싱 프리미티브까지 확장**(M-1 v26 `mulberry32`·`parseClusterSeed`·`parseClusterMaxNodes` 게이트)이 신뢰성 차별화 축.

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 정밀 재열람에서 신규 prod 코드 결함이 없었다(M-1 v26은 미커버 순수 함수 게이트):

- `src/server/api-server.ts` — 세션 TTL/cap/sweep·timing-safe Bearer·8 REST 핸들러 + /healthz supertest 전수 게이트(P19-1)·rate-limit·session-마스킹 양호.
- `src/utils/file-filter.ts`·`file-watcher.ts` — glob은 `ignore`/chokidar 위임(직접 RegExp 구성 0 — ReDoS 표면 0), path는 `path.relative`+`..` 가드 위임(path-escape 표면 0). **횡단 위험 부류(A) 음성.**
- `src/utils/paths.ts` — `isPathInside`(H-7, security.test 9케이스)·`isSystemPath`(initialize-project.test)·`getProjectHash`(phase13-8-b)·`toCanonical`(변환 동작, P28-1 — 역슬래시/drive-letter/상대→절대/소문자/다중-슬래시/trailing-slash) 전부 동작까지 게이트됨.
- `src/server/tools/_utils.ts` — `requireEngine`(H-1)·`mergeResultsRRF`(P26-1)·`escapeXml`/`escapeDot`(P27-1) 3개 export 순수 함수 100% 커버.
- `src/graph/graph-engine.ts` — `fisherYatesShuffle` 직접 게이트(determinism·집합 보존·empty/single, P14-4). **단 `mulberry32`(시드 PRNG)·`parseClusterSeed`·`parseClusterMaxNodes`는 직접 단언 0건 — M-1 v26.** Fisher-Yates+seeded PRNG+count-first 가드(200k)+BFS index-pointer 큐 O(V+E) 알고리즘은 정상.
- `src/graph/*`(나머지) — architecture-engine(P22-1)·optimization-engine(P23-2)·remediation-engine(P23-1)·policy-discoverer(P24-1)·refactoring-engine getRiskProfile(P23-3)+proposeRefactor(P25-1) 처방 엔진 5종 진입 로직 전수 게이트.
- `src/indexer/language-registry.ts` — `getProvider()` 정상 매핑·case-insensitivity 직접 게이트(language-registry.test). **단 무-확장자/미지/dotfile/trailing-dot/multi-dot 엣지케이스는 직접 단언 없음(전부 정확 처리 — L-18 비-actionable 추적).**
- `src/server/resource-provider.ts`·`prompt-provider.ts` — MCP resource 4 URI(`tests/resource-provider.test.ts`)·prompt 3개 커버, Unknown McpError 경로 포함. **(E) 음성.**
- `src/server/tool-dispatcher.ts` — 20개 도구 스키마 `required ⊆ properties` 불변식 무결(위반 0), Terminal 포워딩·waitUntilReady·registry lookup·EngineNotReadyError 재시도 변환. **(D) 음성(불변식 이미 무결, 독립 export 부재로 회귀 테스트 (b) 잣대 미충족).**
- `src/server/tools/*.ts` — `qualified_name` 10개 전수 strict 가드 정합(M-2 v22+v23). `search-symbols.ts` `query` strict 가드(P25-2)·`get-related-tests.ts` strict 가드(P26-2) 확인.
- `src/watcher/file-watcher.ts` — chokidar `ignored` 프레디킷·확장자 allowlist·flush 동시성·타이머 위생·대용량-배치 git-sync 라우팅·재시도/FATAL 강등(P20-1) 정상.
- `src/indexer/update-pipeline.ts` — 단일 책임·catch log-and-rethrow+롤백·원본 에러 보존(미세 항목만 L-9). `toCanonical` 키 정규화 호출은 P28-1 게이트의 다운스트림.
- `src/server/ipc-coordinator.ts` — challenge-response 인증·1MB 제한·per-tool 타임아웃·keepalive(unref)·pending reject-on-close 견고.
- `src/server/workspace-manager.ts`/`health-monitor.ts` — 버전-미스매치 reindex·dispose 순서(watcher→worker→DB)·ledger 일관성 견고.
- `package.json` overrides — tree-sitter `^0.25.0`·fast-uri·qs·hono·postcss 충족, vite `^8.0.16`(L-15 해소), better-sqlite3 lockfile **12.11.1**(P27-2), express lockfile **4.22.2**(P28-2). dev·prod audit 0/0. dev-dep within-pin 드리프트(L-17)는 비-actionable.
- `README.md`/`README_KR.md`/`GUIDE_EN.md`/`GUIDE_KR.md` — Node ≥ 22 전부 정렬(P24-2, L-12 해소).
- `.github/workflows/ci.yml` — Node 22/24 매트릭스 + `npm audit --omit=dev --audit-level=high`(P14-1) + `npm ci`. (cynapx-autonomous.yml은 본 진단 범위 외.)
- in-tree 에이전트 설정: `.claude/launch.json` 1개(양성), `.cursor`/`.gemini` 부재, in-tree binding.gyp **0개**(L-2 공급망 미도달 재확인).
- TODO/FIXME/XXX/HACK = 0건(`src/` 전수).

---

## 8. 권장 수정 순서 (Phase 29 제안 — 상세는 phase29-plan.md)

**Phase 28 이후 prod 코드는 steady-state(CRITICAL/HIGH 0, prod·dev audit 0/0, TODO 0, god-module 0, 핫패스 quadratic 0)이고 신규 prod-도달 CVE도 0건이며, 과거 "순수 함수 게이트" 각도(graph/ 엔진 진입·핸들러 가드·`_utils.ts`·`paths.ts`)는 레이어별로 소진됐다.** v26은 *구조적으로 다른 5개 각도(A~E)*를 시도했고, 그 중 *(C) graph 엔진 시딩/env-파싱 순수 함수*에서 진짜 새 미커버 후보를 찾았다(M-1 v26) — 나머지(A glob/path 위험, D 스키마 불변식, E MCP resource/prompt)는 *음성*(표면 0 또는 이미 무결/커버), B는 *비-actionable 게이트 공백*(L-18). **그리고 이번 사이클은 *M-2(actionable 의존성 정렬)가 없다* — express prod 드리프트를 P28-2가 닫았고 잔여는 전부 dev-dep within-pin(L-17)이기 때문이다.** CRITICAL/HIGH 0, MEDIUM 1(M-1 v26 graph 엔진 시딩/env-파싱 게이트 — 테스트-only), LOW(L-2~L-9 v25 승계 + L-13/L-14 승계 + L-17 dev-dep lockfile 위생 + L-18 getProvider 엣지케이스 게이트 공백; L-11/L-15/L-16 이전 해소). 따라서 Phase 29는 **graph 엔진 시딩/env-파싱 순수 함수 게이트(P29-1, 테스트-only) + 추적 갱신**의 *경량 단일-항목 유지보수 사이클*이 합리적이다. **이로써 클러스터링 결정성(재현성)의 회귀 안전망이 시딩 프리미티브 단까지 확장되고 — 내부 *순수 함수 게이트 발굴 사이클*은 사실상 마지막 핵심 후보를 닫는다(이후는 신규 도구/엔진/유틸 추가 시에만 확장).**

1. **P29-1 [예정]**: M-1 v26 해소 — `tests/clustering.test.ts`(`fisherYatesShuffle` describe 옆)에 `mulberry32`(결정성·`[0,1)` 범위·시드 민감도·고정-시퀀스)·`parseClusterSeed`(unset/empty/whitespace/non-finite→undefined·trunc·정상 시드)·`parseClusterMaxNodes`(unset/empty/≤0/non-finite→default·trunc·정상값) 변환-동작 케이스 추가(의존 0, 테스트-only, prod 코드 무변경). `parseClusterSeed`/`parseClusterMaxNodes` import 추가(`mulberry32`는 13줄에 이미 import). (vitest 657→대략 +10~12 케이스)
2. **추적 상태 갱신**: L-2(Miasma/Phantom Gyp 도달 0 불변), L-3(SDK v2 *여전히 pre-alpha* — stable Q3까지 이연), L-6(node-tree-sitter#268 open), L-7/L-8 게이트 공백, L-9 잔여 클린업, L-13(analyze-impact use_cache 무해), L-14(CVE-2026-25727 time 크레이트 미도달), L-17(dev-dep within-pin lockfile 드리프트), L-18(getProvider 엣지케이스 게이트 공백) 현 상태를 다음 사이클 출발점으로 고정. **L-11(better-sqlite3)·L-15(vite)·L-16(express) 해소 종료.**

(L-4 IPC MessagePack 계속 보류, L-5 클러스터링 본격 파티셔닝 계속 이연, MCP 전면 stateless/task 마이그레이션은 SDK v2 stable 배포까지 이연, SCIP export는 전략 후보로 기록만.)

> **Steady-state 심화 및 향후 사이클 안내**: Phase 26~28이 핸들러 보조(`_utils.ts`)·공통 유틸(`paths.ts`) 순수 함수 레이어의 게이트 발굴을 마무리했고, Phase 29는 그 안전망을 *graph 엔진의 시딩/env-파싱 프리미티브*까지 확장한다 — 이로써 graph 엔진(진입+시딩)·핸들러 가드·핸들러 보조 순수 로직·공통 유틸 순수 함수가 *모두* 게이트되어 **내부 *순수 함수 게이트 발굴 사이클*이 사실상 소진**된다. **또한 이번 사이클은 *연속되던 "lockfile bump" 항목이 마침내 비었다*(express prod 드리프트를 P28-2가 닫고, 잔여는 dev-dep within-pin뿐 — L-17 비-actionable).** 따라서 **Phase 29 이후 사이클은 (1) 새 도구/엔진/핸들러/유틸 추가 시의 신규 게이트, (2) 공급망 위생(prod audit·prod-dep lockfile 드리프트) 정기 점검, (3) MCP SDK v2 stable 전환(L-3, Q3 2026 예정)·node-tree-sitter#268 해소(L-6) 같은 *외부 트리거 기반* 항목으로 전환**된다 — 즉 *깊은 steady-state*다. phase29-plan은 이 전환을 명시하고, *향후 사이클을 더 긴 간격(예: 외부 CVE/SDK 재스캔 위주) 또는 외부-트리거-only 포커스로 옮기는 선택지*를 제안한다(5장 유지보수 포스처).
