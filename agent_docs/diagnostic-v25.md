# Cynapx 정밀 진단 보고서 v25

- **기준 커밋**: `ae69a8b` (Phase 27 + Phase 27-1/27-2 완료 — escapeXml/escapeDot 게이트 + better-sqlite3 12.11.1 lockfile 정렬, 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-15
- **진단 범위**: src/ 전체(server, db, indexer, graph, watcher, utils, cli, bootstrap) + **v24가 `_utils.ts`의 3개 export 순수 함수(mergeResultsRRF·escapeXml·escapeDot)를 100% 게이트(M-1 v24 — P27-1)하고 better-sqlite3 lockfile을 12.11.1로 정렬(M-2 v24 — P27-2)해 *핸들러 보조 순수 로직(`server/tools/_utils.ts`) 미커버 공백을 0*으로 닫은 지금, 그 *다음* 미커버 후보를 "low-hanging fruit가 소진된 steady-state에서의 *진짜 새 각도*"로 실측**: 과거 사이클이 `server/tools/_utils.ts`(핸들러 보조)·`graph/` 엔진(처방)·핸들러 인자 가드를 전수 덮었으나 — **`src/utils/`(공통 유틸 모듈)의 *핵심 순수 함수* `toCanonical()`(paths.ts:285-295)이 *전 파서·cross-project 리졸버·get-related-tests의 qualified-name 키 정규화 프리미티브*인데도 그 *변환 동작 자체*는 단 하나의 테스트(O-2 멱등성)만 갖고 7개 변환 분기(backslash→slash·빈-문자열·drive-letter 감지·상대→절대 prepend·소문자화·다중-슬래시 축약·trailing-slash 제거)가 *전부 미커버*임을 `grep`+직접 실행으로 실측** + REST API 라우트(api-server.ts 8 핸들러 P19-1 supertest 커버 재확인)·indexer/db pure-helper·CLI 재점검 + 외부 컨텍스트(CVE/advisory, 공급망 캠페인, MCP SDK v2 npm 배포 상태, 경쟁/인접 도구)
- **진단 방법**: 단일 에이전트 오케스트레이션 + 회의적 전수 코드 리뷰 + 로컬 직접 검증(`npx vitest run`[시간·케이스 수 측정], `npx tsc --noEmit`, `npm audit`[dev 포함]·`npm audit --omit=dev`, `npm ls better-sqlite3`·`npm ls express`·`npm outdated`로 버전 드리프트 확인) + **신규 각도: (1) `src/utils/paths.ts`의 `toCanonical(s)`가 라이브 인덱싱 핫패스(tree-sitter/typescript/markdown/yaml/json-config 파서 전부 + cross-project-resolver + get-related-tests)의 qualified-name *키 정규화 프리미티브*임을 `grep`으로 확인하고, `tests/phase12-6-commit-b.test.ts`의 유일한 `toCanonical` 테스트(O-2)가 *`toCanonical(toCanonical(x))===toCanonical(x)` 멱등성*과 *symbolCache 키 일치*만 단언할 뿐 *변환 동작*(역슬래시 정규화·드라이브 레터·상대→절대·소문자·다중-슬래시·trailing-slash)을 *전혀 단언하지 않음*을 실측 + `npx tsx`로 8개 입력의 실제 출력을 측정해 결정적 게이트 사양 확정. (2) REST API 라우트 8개(api-server.ts:323-331)가 supertest(P19-1: tests/api-server-http/hotspots/security/healthz)로 전수 커버됨을 재확인(신규 라우트 0). (3) express lockfile 드리프트(`npm ls express` = 4.22.1, Wanted 4.22.2 patch)를 `npm outdated`로 재측정 — clean한 patch bump(4.22.0 erroneous breaking change revert, CVE 0)이고 핀 `^4.19.2` 무변경.** + 외부 웹 재조사(better-sqlite3 12.11.1·MCP SDK v2 npm 배포 상태·tree-sitter/chokidar/vite CVE·Miasma/Phantom Gyp 공급망 캠페인·경쟁 도구)
- **현재 상태(직접 검증)**: `npx vitest run` **649/649**(47 파일, **7.90s** — 642→8.12s 대비 케이스 +7(P27-1 escapeXml/escapeDot)·시간 변동[머신 변동, 추세 무문제]), `npx tsc --noEmit` 그린, **`npm audit`(dev 포함) = 0 vulnerabilities**, **`npm audit --omit=dev`(prod) = 0 vulnerabilities**. diagnostic-v24 전 항목 처리 완료(M-1 v24 [DONE — P27-1], M-2 v24 [DONE — P27-2] — `npm ls better-sqlite3` = **12.11.1** 정렬 재확인), LOW 승계 추적.

> **요약**: **Phase 27까지 prod 코드는 steady-state(CRITICAL/HIGH 0, prod·dev audit 0/0, TODO 0, god-module 0, 핫패스 quadratic 0)이고, 외부도 신규 prod-도달 CVE 0건(better-sqlite3 12.11.1·chokidar·tree-sitter·vite·@modelcontextprotocol/sdk 직접 재확인)이다.** **과거 사이클들이 "low-hanging fruit" 각도(graph/ 엔진 진입 로직 게이트[~P25-1]·핸들러 `qualified_name` strict 가드[~P26-2]·`server/tools/_utils.ts` 3개 export 순수 함수 100% 커버[P26-1/P27-1])를 *소진*한 지금, v25는 *진짜 새 각도*를 `src/utils/`(과거 사이클이 게이트 발굴 대상으로 삼지 않은 공통 유틸 레이어)에서 찾는다.** **신규 M-1 v25: `src/utils/paths.ts`의 순수 함수 `toCanonical(s: string): string`(285-295줄)은 *전 파서(tree-sitter/typescript/markdown/yaml/json-config)·cross-project-resolver(178·213줄)·get-related-tests(33줄)·update-pipeline(338·426·569줄)의 qualified-name 키 정규화 프리미티브*인데 — *변환 동작 자체에 대한 단위 테스트가 0건*이다. `tests/phase12-6-commit-b.test.ts`의 유일한 `toCanonical` 테스트(O-2, 22-39줄)는 *`toCanonical(toCanonical(x))===toCanonical(x)` 멱등성*과 *symbolCache 키 round-trip*만 단언할 뿐 — (a) 역슬래시→슬래시 정규화(287줄 `replace(/\\/g, '/')`), (b) 빈-문자열 early-return(286줄), (c) 드라이브-레터 감지 분기(288줄 `/^[a-zA-Z]:/`), (d) 상대경로→절대경로 prepend(290-293줄 `startsWith('/') && !startsWith('//')`), (e) 소문자화(294줄), (f) 다중-슬래시 축약(294줄 `replace(/\/+/g, '/')`), (g) trailing-slash 제거(294줄 `replace(/\/$/, '')`)를 *전혀 단언하지 않는다*. 직접 실행(`npx tsx`)으로 확정한 결정적 동작: `''`→`''`, `'src\\windows\\path.ts'`→`'src/windows/path.ts'`, `'/Abs/Path/File.TS'`→`'/abs/path/file.ts'`, `'rel/path/x.ts'`→`'rel/path/x.ts'`, `'//unc/share'`→`'/unc/share'`, `'a//b///c/'`→`'a/b/c'`, `'C:\\Foo\\Bar'`→`'c:/foo/bar'`, `'Already/Lower/'`→`'already/lower'`. 이는 M-1 v23(mergeResultsRRF)·M-1 v24(escapeXml/escapeDot)와 *동형의 "라이브 핫패스 뒤 0-의존 순수 함수 미커버 게이트"*이나 — 결정적 차이는 *부류(레이어)가 새롭다*: 과거 게이트는 `server/tools/_utils.ts`(핸들러 보조)·`graph/` 엔진(처방)에 집중됐고 `src/utils/`(공통 유틸)는 게이트 발굴 대상이 아니었다. `toCanonical`은 *문자열 in→문자열 out, DB·async·side-effect·픽스처 전무*라 가장 가벼운 게이트이며, *키 정규화 정합성*(같은 파일을 가리키는 역슬래시/슬래시·대소문자·trailing-slash 변형이 *동일 canonical 키로 수렴*해야 cross-project 심볼 해소·symbolCache·get-related-tests 매칭이 정확)이라는 *실질 정합성 속성*을 회귀 게이트한다. (b) 잣대 충족: (1) prod 코드 무변경(테스트-only); (2) 의존 0; (3) P26-1/P27-1과 동형의 순수 함수 게이트. → Phase 28-1(테스트-only, prod 코드 무변경).** **신규 M-2 v25: `express` lockfile이 `4.22.1`인데 `npm outdated` Wanted가 `4.22.2`(patch)로 드리프트 — clean한 patch bump(4.22.0의 erroneous extended-query-parser breaking change를 완전 revert, CVE 0 — `npm audit` 0 불변)이고 핀 `^4.19.2`(semver-호환)라 *lockfile만* 갱신하면 정렬된다(`package.json` 무변경). M-2 v24(better-sqlite3 12.10.0→12.11.1 lockfile 정렬)와 *동형의 lockfile-only 의존성 위생* 항목으로, 직접 express(4.22.1)는 이미 4.22.0 breakage를 피한 버전이라 4.22.2는 순수 유지보수 정렬(보안 결함 무관). → Phase 28-2(lockfile-only 정렬 + 베이스라인 재확인).** **외부 신선 재조사: better-sqlite3 12.11.1 직접 CVE 0건(latest, P27-2로 정렬됨 — `npm ls` 재확인), MCP SDK v2 *여전히 pre-alpha*(`@modelcontextprotocol/sdk` latest 1.29.0 불변, v2 stable Q3 2026[7-28 publish 예정], v1.x production 권장 → 핀 `^1.29.0` 유지가 옳음[L-3]), Miasma/Phantom Gyp/Node-gyp 공급망 캠페인(2026-06-01~ 진행 중, binding.gyp 남용 self-propagating worm, 57패키지/286악성버전 — @vapi-ai/server-sdk·ai-sdk-ollama 등)은 *Cynapx 트리 미도달 재확인*(in-tree binding.gyp 0개, `.cursor`/`.gemini` 부재, `.claude/launch.json` 1개 양성, vapi/ollama not in tree)[L-2], tree-sitter npm 바인딩 직접 CVE 0건(CVE-2026-25727은 Rust `time` 크레이트 — L-14, Cynapx 미도달 불변), node-tree-sitter#268(C++20/Node 24 빌드) 여전히 open(L-6 불변). 경쟁: CodeGraph·Serena·GitNexus·Codebase-Memory·code-graph-mcp 등 로컬-퍼스트 tree-sitter+SQLite+MCP 코드 그래프 카테고리 지속 — Cynapx의 처방 엔진(risk/remediation/refactoring/policy) + 하이브리드(keyword+vector RRF) 검색이 차별점, 그 진입·보조 순수 로직은 v22~v24로 전수 게이트 완성, v25는 *공통 유틸 레이어의 핵심 순수 함수(toCanonical)*와 *의존성 위생(express lockfile 정렬)*을 닫는다.** **CRITICAL 0, HIGH 0, MEDIUM 2(M-1 v25 toCanonical 변환 동작 게이트 — Phase 28-1, 테스트-only; M-2 v25 express lockfile 4.22.1→4.22.2 정렬 — Phase 28-2, lockfile-only), LOW(L-2~L-9 v24 승계 + L-13 승계[analyze-impact use_cache 무해] + L-14 승계[CVE-2026-25727 time 크레이트 미도달] + L-16 신규[express lockfile 드리프트 → M-2 v25로 승격] ; L-11/L-15 [이전 사이클 해소]).**

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건은 Phase 13에서, v11 HIGH(공급망)는 Phase 14-1에서, v12~v18 MEDIUM은 Phase 15~21에서, v19 MEDIUM은 Phase 22-1에서, v20 MEDIUM 2건+L-10 부분은 Phase 23에서, v21 MEDIUM 2건+L-12는 Phase 24에서, v22 MEDIUM 2건은 Phase 25에서, v23 MEDIUM 2건은 Phase 26에서, v24 MEDIUM 2건은 Phase 27에서 해소됐고, 본 전수 재열람에서 새로운 CRITICAL/HIGH는 없다. IPC 핸드셰이크(challenge + HMAC-SHA256 + timingSafeEqual)·API Bearer(SHA-256 + timingSafeEqual)·세션 맵(TTL+cap+sweep unref) 모두 견고(직접 재열람).

---

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** 코드·공급망 어디에서도 신규 HIGH 없음. **prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0**(직접 재검증). M-1 v25(toCanonical 변환 동작 게이트 격차)·M-2 v25(express lockfile 드리프트)는 MEDIUM이다 — M-1은 게이트 공백(보안·크래시 결함 아님, 변환 동작 미커버), M-2는 의존성 위생(clean patch bump 정렬, 보안 결함 아님). 외부 CVE-2026-25727(`time` 크레이트)도 Cynapx prod 트리 미도달이라 LOW(L-14 불변). Miasma/Phantom Gyp 캠페인도 Cynapx 트리 미도달(L-2 불변).

---

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

| # | 위치 | 내용 |
|---|------|------|
| **M-1 v25** *(신규, actionable — `src/utils/` 레이어의 핵심 순수 함수. 과거 게이트가 `server/tools/_utils.ts`·`graph/`에 집중된 동안 게이트 발굴 대상이 아니었던 공통 유틸의 키 정규화 프리미티브)* **[DONE — Phase 28-1]** | `src/utils/paths.ts`(`toCanonical()` 285-295줄), 호출처: `tree-sitter-parser.ts:37,93`·`typescript-parser.ts`(다수)·`markdown-parser.ts:22`·`yaml-parser.ts:48`·`json-config-parser.ts:27`·`cross-project-resolver.ts:178,213`·`get-related-tests.ts:33`·`update-pipeline.ts:338,426,569`, `tests/phase12-6-commit-b.test.ts:22-39`(O-2 — 멱등성·symbolCache 키만 단언, 변환 동작 미커버) | **`toCanonical()`의 변환 동작에 회귀 게이트 추가.** 이 순수 함수는 *전 파서 + cross-project 리졸버 + get-related-tests + update-pipeline*의 qualified-name *키 정규화 프리미티브*이나 **변환 동작 자체에 대한 단위 테스트가 0건**: `tests/phase12-6-commit-b.test.ts`의 O-2 테스트는 `toCanonical(toCanonical(x))===toCanonical(x)` *멱등성*과 *symbolCache 키 round-trip*만 단언하고, 변환 결과(어떤 입력이 *무엇으로* 정규화되는지)를 단언하지 않는다 → 미커버 로직: (a) 역슬래시→슬래시(287줄 `s.replace(/\\/g, '/')`), (b) **빈-문자열 early-return**(286줄 `if (!s) return ''`), (c) 드라이브-레터 감지 분기(288줄 `/^[a-zA-Z]:/` → prepend 생략), (d) **상대경로→절대 prepend**(290-293줄 — `startsWith('/') && !startsWith('//')`일 때만 cwd 루트 prepend; `//`(UNC-유사) 입력은 prepend 생략), (e) 소문자화(294줄 `.toLowerCase()`), (f) 다중-슬래시 축약(294줄 `.replace(/\/+/g, '/')`), (g) trailing-slash 제거(294줄 `.replace(/\/$/, '')`). **직접 실행(`npx tsx`)으로 확정한 결정적 동작(POSIX, cwd 루트 `/`)**: `''`→`''`, `'src\\windows\\path.ts'`→`'src/windows/path.ts'`, `'/Abs/Path/File.TS'`→`'/abs/path/file.ts'`, `'rel/path/x.ts'`→`'rel/path/x.ts'`, `'//unc/share'`→`'/unc/share'`, `'a//b///c/'`→`'a/b/c'`, `'C:\\Foo\\Bar'`→`'c:/foo/bar'`, `'Already/Lower/'`→`'already/lower'`. **(b) 잣대 충족**: (1) prod 코드 무변경(테스트-only); (2) *의존 0* — 문자열 in → 문자열 out, DB·async·side-effect·픽스처 전무 → `tests/phase12-6-commit-b.test.ts`의 O-2 describe 옆에 변환-동작 describe만 추가하면 됨(기존 `import { toCanonical }` 재사용); (3) M-1 v23(mergeResultsRRF)·M-1 v24(escapeXml/escapeDot)와 *동형의 0-의존 순수 함수 게이트*이되 *새 레이어(`src/utils/`)*를 덮는다. **이로써 키 정규화 정합성(역슬래시/대소문자/trailing-slash 변형 → 동일 canonical 키 수렴 — cross-project 심볼 해소·symbolCache·get-related-tests 매칭의 토대)에 회귀 안전망을 친다.** 특히 *상대→절대 prepend의 `//` 가드*(UNC-유사 입력은 prepend하지 않고 다중-슬래시 축약만 적용)와 *드라이브-레터 분기*는 단순 치환이 아닌 *플랫폼-인지 정규화 정합성 속성*이라 회귀 가치가 명확. **verdict: actionable — Phase 28-1.** (5장 상세) |
| **M-2 v25** *(신규, actionable — express lockfile 드리프트. M-2 v24(better-sqlite3 12.10.0→12.11.1)와 동형의 lockfile-only 의존성 위생)* **[DONE — Phase 28-2]** | `package-lock.json`(express `4.22.1`), `package.json:34`(핀 `^4.19.2` — 변경 불필요), `npm outdated`(express Current 4.22.1 · Wanted **4.22.2**) | **express lockfile을 4.22.1 → 4.22.2로 정렬.** `npm outdated` 재실행 결과 직접 의존 `express`가 `4.22.1`(lockfile) · Wanted `4.22.2`(patch 드리프트)다. 4.22.2는 *4.22.0의 erroneous extended-query-parser breaking change를 완전 revert한 clean patch*(직접 CVE 0건 — CVE-2024-51999 rejected, `npm audit` 0 불변)이고, `package.json` 핀이 `^4.19.2`(semver-호환)라 *lockfile만 갱신*하면 정렬된다(`package.json` 무변경). 직접 express(4.22.1)는 *이미 4.22.0 breakage를 피한 버전*이라 4.22.2 정렬은 *순수 유지보수 위생*(동작 변화·보안 결함 무관). **(b) 잣대 충족**: (1) 변경 = `npm i express@4.22.2`(또는 `npm update express`)로 `package-lock.json`의 express 엔트리만 갱신 — prod 코드 무변경, 핀 무변경; (2) 검증 = `npx vitest run` 649 그린(api-server supertest 8 핸들러 — P19-1 — 전부 그린) + `npx tsc --noEmit` 그린 + `npm audit`·`npm audit --omit=dev` 0/0 재확인 + `npm ls express` = 4.22.2; (3) M-2 v24(better-sqlite3 12.10.0→12.11.1 lockfile-only)와 *동형의 lockfile-only 의존성 정렬* — 매 사이클 lockfile 드리프트 모니터링(유지보수 포스처)의 산물. **verdict: actionable — Phase 28-2.** (5장 상세) |

> **참고(M-2 v25 = L-16 승격 근거)**: 본 사이클 `npm outdated`는 express(direct dep) Current 4.22.1 · Wanted 4.22.2(patch)를 보고했다. 이는 M-2 v24(better-sqlite3 12.10.0→12.11.1)와 동형의 *lockfile-only 의존성 위생* 항목으로 — (1) clean patch(4.22.0 breakage revert, CVE 0), (2) semver-호환(핀 `^4.19.2` 무변경), (3) 작고(lockfile-only) 리스크 낮음(api-server supertest 649 회귀 게이트)이라 actionable로 승격한다(L-16 [해소-승격 → M-2 v25]). 단 직접 express는 이미 4.22.1로 4.22.0 breakage를 회피한 상태라 *긴급도는 M-2 v24보다 낮다*(순수 유지보수 정렬) — M-2 v25를 deferral해 L-16 추적으로 남겨도 무방(Phase 28을 더 가볍게 가져갈 경우).

---

## 4. 최적화 (LOW) — 추적/이연 (v24 승계 + L-16 신규[→M-2 v25]; L-11/L-15 이전 해소)

| # | 위치 | 내용 |
|---|------|------|
| L-2(v25) | `package.json` (native deps), CI / Dockerfile, `.claude/` 설정 | **Miasma / Phantom Gyp / Node-gyp 공급망 캠페인 포스처 추적 — Cynapx 도달 0건 불변(재확인).** 진단 일자 직접 재대조: 캠페인은 *2026-06-01~ 진행 중*(binding.gyp 남용 self-propagating worm, 57패키지/286악성버전 — @vapi-ai/server-sdk·ai-sdk-ollama 등 hijack, npm/GitHub/AWS/GCP/Azure 자격증명 탈취)이나 — *in-tree binding.gyp 0개*(`find . -name binding.gyp -not -path "*/node_modules/*"` = 0), 컴프로마이즈 패키지(@vapi-ai/server-sdk·ai-sdk-ollama) *not in tree*(`npm ls` empty), in-tree 에이전트 설정은 `.claude/launch.json` 1개(양성), `.cursor`/`.gemini` 부재. native 의존(better-sqlite3 12.11.1 + tree-sitter 0.25.0 + 12 grammar) 무관·악성 버전 미발행. CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지 1차 방어선 유지. **즉각 조치 불필요 — 추적만.** 출처: [StepSecurity Miasma](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm), [Snyk node-gyp compromise](https://snyk.io/blog/node-gyp-supply-chain-compromise-self-propagating-npm-worm-binding-gyp/) |
| L-3(v25) | `src/server/api-server.ts` (session-id StreamableHTTP), `package.json:29`(`@modelcontextprotocol/sdk ^1.29.0`) | **MCP SDK v2 — *여전히 pre-alpha*(상태 불변).** 직접 확인: `@modelcontextprotocol/sdk` latest는 **여전히 1.29.0**(2개월 전 publish, v24 시점과 불변), v2는 main 브랜치에서 pre-alpha 개발 중·**stable은 Q3 2026**(스펙 publish 2026-07-28) 예정, v1.x가 production 권장·v2 출시 후 최소 6개월 v1.x 보안/버그 수정 지속. → Cynapx 핀 `^1.29.0` 유지가 옳음. stateless protocol core(SEP-2567 session-id 제거)·Multi-Round-Trip·MCP Apps 마이그레이션은 **v2 stable 전환까지 계속 이연**. P15-3 `handleMcp()` 설계 메모가 출발점. 출처: [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk), [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) |
| L-4(v25) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환. **성능 문제 미관측 — 계속 보류.** 메시지가 작고 round-trip이 드물어 직렬화 병목 아님 |
| L-5(v25) | `src/graph/graph-engine.ts` | 클러스터링 본격 서브그래프 파티셔닝 — 100k+ 노드 실측 시 재검토(**계속 이연**). LPA O(V+E)·`MAX_ITER=20` 캡·count-first 가드(200k)·Fisher-Yates seeded PRNG 직접 재확인 — OOM/편향 방어 정상 |
| L-6(v25) | CI / Dockerfile | Node 24 + tree-sitter 0.25.x 빌드 fragility([node-tree-sitter#268] / [salesforce/agentscript#7: C++20 미설정] 여전히 open·미해결, CVE 아님). CI Node 22/24 매트릭스 그린이나 Node 24 LTS 전환 전 prebuild 재확인. **추적만** 출처: [node-tree-sitter#268](https://github.com/tree-sitter/node-tree-sitter/issues/268) |
| L-7(v25) | `src/cli/admin.ts` (cmd* 9개), `tests/admin-cli.test.ts` | **admin CLI 명령 동작의 vitest 게이트 공백 — 비-actionable 추적.** 등록 명령 9개 `cmd*`는 모듈-private(미-export)이라 vitest 직접 호출 불가. **admin.ts 핸들러 export 리팩터 시 함께 게이트화 후보** |
| L-8(v25) | `src/indexer/worker-pool.ts`, `embedding-manager.ts`, `db/database.ts` | **에러-복구·마이그레이션 잔여 분기의 vitest 게이트 공백 — 비-actionable 추적.** worker `worker.on('error')`·queue backpressure·embedding A-7 stale supersedence 레이스·DB migration 잔여 분기는 직접 미검증이나 인접 분기 커버 + 타이밍-flaky 위험. **SCHEMA_VERSION 증분/worker-pool 리팩터 시 함께** |
| L-9(v25) | `src/indexer/update-pipeline.ts` (트랜잭션 보일러플레이트·progress `log.error`), `embedding-manager.ts:184`/`api-server.ts:625` (빈 catch) | **L-9 코드 클린업 잔여 — (b) 잣대 미충족, 비-actionable 추적.** `withWriteTransaction()` 추출은 트랜잭션 경계 5곳 재작성이라 회귀 표면 넓음; 빈 catch 2건은 의도적 silent-drop 방어. **update-pipeline 리팩터 페이즈로 묶어 처리 후보** |
| **L-13(v25)** *(승계 — analyze-impact use_cache 스키마-default 미강제, 무해)* | `src/server/tools/analyze-impact.ts:23` (`useCache: args.use_cache` 무검증·default 미강제) | **`analyze-impact` 핸들러가 `use_cache`(스키마 default `true`)를 검증·default-강제 없이 그대로 `traverse({useCache: args.use_cache})`에 전달 — 무해.** `args.use_cache`가 `undefined`면 traverse 내부 truthy 평가에서 캐시 *비활성*으로 동작(스키마 default `true`와 어긋날 수 있으나 *느려질 뿐* 정확성·크래시 영향 0). 동형 무해 패턴이 `export-graph`(`format`/`max_depth`)·`get-symbol-details`(`include_source`/`summary_only`)에도 존재 — 전부 다운스트림 undefined-안전. **verdict: 추적만(비-actionable)** |
| **L-14(v25)** *(승계 — CVE-2026-25727 `time` 크레이트, Cynapx 미도달 불변)* | (외부 — Rust `time` crate via tree-sitter Rust 생태계 언급), Cynapx prod 트리 무관 | **CVE-2026-25727(RFC 2822 파싱 스택 소진 DoS, `time` 크레이트 0.3.6~<0.3.47)은 *tree-sitter*로 거론되나 실제로는 Rust `time` 크레이트 결함 — Cynapx prod 트리 미도달 불변.** 본 CVE는 tree-sitter npm 바인딩/그래머가 아니라 Rust `time` 크레이트의 RFC 2822 날짜 파싱에 있고, Cynapx의 의존 표면(npm tree-sitter 0.25.0 + 12 grammar)에 `time` 크레이트는 부재 → **prod·dev 미도달, audit 0/0 불변.** tree-sitter Rust 생태계 모니터링 신호로 추적. **verdict: 추적만(비-actionable — 미도달)** 출처: [NVD CVE-2026-25727](https://nvd.nist.gov/vuln/detail/CVE-2026-25727) |
| **L-16(v25)** *(신규-해소-승격 → M-2 v25 — express lockfile 4.22.1 vs 4.22.2 patch 드리프트, actionable화)* | `package-lock.json` (express `4.22.1`) | **express lockfile 4.22.1 → 정렬 actionable(M-2 v25로 승격).** `npm outdated` = express Current 4.22.1 · Wanted **4.22.2**(patch 드리프트). 4.22.2는 4.22.0의 erroneous extended-query-parser breaking change를 revert한 clean patch(CVE 0, semver-호환 핀 `^4.19.2` 무변경)이고 직접 express는 이미 4.22.1로 breakage를 회피한 상태 → **M-2 v25(Phase 28-2)에서 lockfile-only 정렬**(긴급도 낮음 — deferral해 추적으로 남겨도 무방). |

> **신규 LOW 부재 안내(prod 코드 동작 변경)**: M-1 v25(toCanonical 게이트, 테스트-only)·M-2 v25(express lockfile 정렬, lockfile-only)를 제외하면 prod 코드 *동작* 변경을 요하는 신규 LOW는 0건이다(L-13/L-14는 무해·미도달 추적, L-16은 lockfile 위생). **L-11(better-sqlite3 lockfile)·L-15(vite dev advisory)는 각각 P27-2·`473acf8`에서 이미 해소 — 추적 종료.**

---

## 5. 코드 품질 / 성능 전수 (`src/utils/` 핵심 순수 함수 미커버 + lockfile 드리프트 재측정 + steady-state 재확인)

v24까지 graph/ 엔진 처방 5종 + 핸들러 보조 핵심 순수 로직(`mergeResultsRRF`·`escapeXml`·`escapeDot` — `server/tools/_utils.ts` 3개 export 100%) + `qualified_name` 10개 핸들러 strict 가드가 전수 게이트/정렬됐다. v25는 **"low-hanging fruit 소진" 후의 *진짜 새 각도***로 **(1) `src/utils/paths.ts`의 *키 정규화 프리미티브* `toCanonical()` 변환 동작이 미커버임을 실측**하고, **(2) express lockfile 드리프트를 `npm outdated`로 재측정**하며, **(3) REST API 라우트 supertest 커버를 재확인**한다.

**(1) `src/utils/` 순수 함수 ×테스트 대조 (새 레이어 미커버 후보)**

| 순수 함수 (`src/utils/`) | 라이브 사용처 | 로직 | 직접 단위 테스트 | 판정 |
|------------------------|------------|------|-----------------|------|
| `isPathInside()` (paths.ts:46) | 등록/경계 가드 | H-7 containment | **커버**(`tests/security.test.ts:124-170` — 9 케이스) | 정합 |
| `isSystemPath()` (paths.ts:61) | 등록 가드 | 시스템 경로 거부 | **커버**(`tests/initialize-project.test.ts:76-93`) | 정합 |
| `getProjectHash()` (paths.ts:273) | DB/lock 키 | 플랫폼 case-sensitivity 해시 | **커버**(`tests/phase13-8-commit-b.test.ts:91-127`) | 정합 |
| **`toCanonical()`** (paths.ts:285) | 전 파서·cross-project·get-related-tests·update-pipeline (qualified-name 키 정규화) | 역슬래시→슬래시·빈-문자열·drive-letter·상대→절대·소문자·다중-슬래시·trailing-slash | **변환 동작 0건**(O-2는 멱등성·symbolCache 키만 단언) | **M-1 v25 — Phase 28-1** |
| `getDirSizeMB()` (paths.ts:304) | admin doctor disk usage | 재귀 디렉토리 크기 | fs 의존(픽스처 필요) — 비-순수, 추적 안 함 | — |

핵심: `toCanonical`은 멱등성(O-2)만 게이트되고 *변환 결과*(어떤 입력→무엇)는 0% 커버다. 같은 부류의 다른 `src/utils/` 순수 함수(`isPathInside`·`isSystemPath`·`getProjectHash`)는 이미 *동작*까지 게이트됐는데 — *가장 광범위하게 쓰이는*(전 파서 + cross-project + get-related-tests + update-pipeline) `toCanonical`만 변환 동작 미커버다. 0-의존 순수 함수라 `tests/phase12-6-commit-b.test.ts`의 O-2 describe 옆에 변환-동작 describe만 추가하면 닫힌다(M-1 v25).

**(2) express lockfile 드리프트 재측정 (L-16 → M-2 v25)**

| 측정 | v24 시점 | v25 시점(본 사이클) | 판정 |
|------|----------|---------------------|------|
| `npm ls better-sqlite3` | 12.10.0 → **12.11.1**(P27-2 정렬) | 12.11.1(불변, latest) | 정렬됨(L-11 해소) |
| `npm ls express` | (미측정) | 4.22.1(Wanted 4.22.2 patch) | 드리프트 — L-16/M-2 v25 |
| express 핀(`package.json`) | `^4.19.2` | `^4.19.2`(무변경) | semver-호환 |
| CVE / audit | 0 | 0(express 4.22.2 직접 CVE 0건, CVE-2024-51999 rejected) | clean bump |

핵심: M-2 v24(better-sqlite3)와 동형의 lockfile-only 의존성 위생. express 4.22.2는 clean patch(4.22.0 breakage revert), 직접 express는 이미 4.22.1로 breakage 회피 → 순수 유지보수 정렬(M-2 v25, 긴급도 낮음).

**(3) REST API 라우트 ×supertest 대조 (신규 라우트 0 — P19-1 커버 재확인)**

| 라우트 (api-server.ts:323-331) | 핸들러 | supertest 커버 |
|------------------------------|--------|---------------|
| `/healthz` (GET) | 인라인 | `tests/api-server-healthz.test.ts` |
| `/api/symbol/get` | handleGetSymbol | `tests/api-server-http.test.ts:355,373` |
| `/api/graph/callers` | handleGetCallers | `tests/api-server-http.test.ts:394,418,428` |
| `/api/graph/callees` | handleGetCallees | `tests/api-server-http.test.ts:395` |
| `/api/analysis/impact` | handleImpactAnalysis | `tests/api-server-http.test.ts:396` |
| `/api/analysis/hotspots` | handleHotspots | `tests/api-server-hotspots.test.ts`·`http:139` |
| `/api/analysis/tests` | handleTests | `tests/api-server-http.test.ts:397` |
| `/api/search/symbols` | handleSymbolSearch | `tests/api-server-http.test.ts:87,116,159,475` |
| `/api/graph/export` | handleExportGraph | `tests/api-server-http.test.ts:446,462` |

핵심: **REST 라우트 8 핸들러 + /healthz 전부 supertest 커버(P19-1) — 신규 라우트 0, 미커버 라우트 0.** Bearer/rate-limit/마스킹 미들웨어도 `tests/api-server-security.test.ts` 커버. *이 각도는 actionable 격차 없음*(steady-state 확인).

**(4) prod steady-state 재확인 — 신규 prod 코드 결함 0**

| 항목 | 판정 |
|------|------|
| god-module / 순환 import | 0 — `openapi.ts`·`update-pipeline.ts`·`graph-engine.ts` 응집 불변. repos→engines→server/pipeline 단방향 |
| TODO/FIXME/XXX/HACK | 0건(`src/` 전수) |
| 핫패스 O(n²)-over-nodes | 0 — 클러스터링 count-first 가드(200k)+seeded PRNG, BFS index-pointer 큐, 반복 DFS+60s 캐시, architecture-engine O(1) Map(P22-1) |
| prod·dev audit | 0 / 0 vulnerabilities |
| 테스트 | `npx vitest run` **649/649**(47 파일, 7.90s) — 추세 무문제(642→8.12s 대비 +7케이스[P27-1], 시간 머신 변동) |

**(5) 에러 핸들링 일관성 — 양호**

`Logger`(stderr-only, MCP stdio 안전) `normalizeData()` Error 언랩. update-pipeline catch는 log-and-rethrow + 롤백 선행. 미세 항목(progress log.error·빈 catch 2건)은 L-9 비-actionable 추적. `qualified_name` 10개 핸들러 strict 가드 전수 정합(M-2 v22+M-2 v23으로 완성). `search-symbols` `query` strict 가드(P25-2)·`get-related-tests` strict 가드(P26-2) 정렬 확인.

---

## 6. 외부 컨텍스트 (웹 조사 — 진단 일자 재실행, 출처 명시)

### 6.1 의존성 취약점 (prod·dev 둘 다 clean)

- **`npm audit`(dev 포함) = 0 + `npm audit --omit=dev`(prod) = 0**(둘 다 직접 실행). Phase 21-1 postcss override + vite `^8.0.16` bump(`473acf8` — L-15 해소)가 dev 트리도 clean 유지.
- **`npm ls better-sqlite3` = `12.11.1`(P27-2 정렬 재확인) + `npm ls express` = `4.22.1` + `npm outdated`(직접 실행)**: prod 코드 *동작* 변경을 요하는 긴급 업그레이드 0건. **L-16 드리프트 — express lockfile 4.22.1(Wanted 4.22.2, patch) → M-2 v25로 정렬.** 잔여 드리프트: `tree-sitter-c-sharp` 0.23.1 핀(0.23.5 latest이나 ERR_REQUIRE_ASYNC_MODULE 미해소 → 핀 유지가 옳음), `@types/express`/`commander`/`typescript`/`@types/node`/`express` major(5.x/15/6.x/25/5.x — 비-긴급 major, 즉시 비권장), `zod` 4.3.6→4.4.3·`vitest` 4.1.2→4.1.9(dev, 다음 갱신 시 정렬).
- **better-sqlite3 / chokidar / tree-sitter / vite / express / @modelcontextprotocol/sdk 직접 재확인(웹)**: better-sqlite3 **12.11.1**(latest, P27-2 정렬) 직접 CVE 0건, chokidar non-vulnerable, tree-sitter npm 바인딩 직접 CVE 0건(CVE-2026-25727은 Rust `time` 크레이트 — L-14, Cynapx 미도달), vite advisory는 `^8.0.16`로 해소(L-15), express 4.22.2 직접 CVE 0건(CVE-2024-51999 rejected), @modelcontextprotocol/sdk 1.29.0 직접 CVE 0건. 출처: [Snyk better-sqlite3](https://security.snyk.io/package/npm/better-sqlite3), [expressjs releases](https://github.com/expressjs/express/releases)

### 6.2 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"` + Docker `node:22-bookworm-slim`. Node 22 LTS 2027-04 종료 — 여유. CI Node 22/24 매트릭스 그린(649/649). 문서 Node 버전(L-12, P24-2 해소)은 README/README_KR/GUIDE_EN/GUIDE_KR 전부 ≥ 22 정렬 유지.
- **tree-sitter 코어**: latest 0.25.0, 12 grammar 전부 dedupe/override. **tree-sitter-c-sharp**: 0.23.1 정확 핀 롤백 유지. Node 24 빌드 C++20 fragility([node-tree-sitter#268]·[salesforce/agentscript#7] 여전히 open, 2026-01-12 개설·미해결) — L-6 추적.
- **better-sqlite3**: lockfile 12.11.1(P27-2 정렬, latest — L-11 해소).
- **express**: lockfile 4.22.1(L-16 → M-2 v25, Wanted 4.22.2 patch).
- **vite**: devDependency `^8.0.16`(L-15 해소).

### 6.3 공급망 캠페인 — Miasma / Phantom Gyp / Node-gyp (계속 진행 중, Cynapx 도달 0건 불변)

진단 일자 직접 재대조: 캠페인은 *2026-06-01~ 활발*(binding.gyp 남용 self-propagating worm — preinstall/postinstall 스크립트 대신 binding.gyp가 `npm install` 중 코드 실행을 트리거해 대부분의 install-script 보안 검사 우회; 57패키지/286악성버전, npm/GitHub/AWS/GCP/Azure/Vault/K8s 자격증명 탈취·GitHub Actions 워크플로 주입 persistence·자가전파). **Cynapx 트리 미도달 재확인**: *in-tree binding.gyp 0개*, 컴프로마이즈 패키지(@vapi-ai/server-sdk·ai-sdk-ollama 등) *not in tree*, in-tree 설정은 `.claude/launch.json` 1개(양성)·`.cursor`/`.gemini` 부재. CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지. **즉각 변경 불필요, 포스처 추적.** 출처: [StepSecurity Miasma](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm), [Snyk node-gyp compromise](https://snyk.io/blog/node-gyp-supply-chain-compromise-self-propagating-npm-worm-binding-gyp/), [Wiz Miasma](https://www.wiz.io/blog/miasma-supply-chain-attack-targeting-redhat-npm-packages)

### 6.4 MCP 생태계 — SDK v2 여전히 pre-alpha (상태 불변)

- **MCP SDK v2가 여전히 pre-alpha**(직접 확인): `@modelcontextprotocol/sdk` latest는 **여전히 1.29.0**(v24 시점과 불변, 2개월 전 publish). v2는 main 브랜치에서 pre-alpha 개발 중, **stable은 Q3 2026**(스펙 publish 2026-07-28) 예정, v1.x가 production 권장·v2 출시 후 최소 6개월 v1.x 유지. → **Cynapx 핀 `^1.29.0` 유지가 옳다. stateless core/Tasks/MCP Apps/Multi-Round-Trip 마이그레이션(L-3)은 v2 stable까지 계속 이연.** 출처: [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk), [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases)
- **함의**: Cynapx 현 StreamableHTTP(session-id)는 v2 stateless core와 충돌 표면이 있으나 *마이그레이션은 stable 배포까지 이연*이 옳다.

### 6.5 경쟁/인접 도구 동향 (전략 추적 — 카테고리 지속)

- **로컬-퍼스트 코드 그래프 카테고리 지속**: CodeGraph(tree-sitter→SQLite+FTS5 심볼/콜/임포트 그래프 MCP, detect_changes/rename/generate_map 도구), Serena(LSP-over-MCP), GitNexus(zero-server on-device KG), Codebase-Memory(tree-sitter KG), code-graph-mcp(10개 언어 AST KG) 등이 "로컬·on-device·MCP·임베디드 SQLite·tree-sitter·no-code-egress" 패턴을 표준 기본값으로 정착. Cynapx의 "100% 로컬·격리·멀티프로세스 보안 IPC + risk/remediation/refactoring/policy *처방* 엔진 + 하이브리드(keyword+vector RRF) 검색" 포지션이 차별점. **함의: 처방 엔진 진입 로직은 v22로, 핵심 보조 순수 로직(RRF·escape)은 P26-1/P27-1로 전수 게이트 완성됐고, v25는 *공통 유틸 레이어의 키 정규화 프리미티브(toCanonical)*를 게이트로 메워(M-1) 차별 가치의 회귀 안전망을 인덱싱 핫패스 토대까지 확장하고 *의존성 위생(express lockfile)*을 정렬(M-2)한다.** 출처: [CodeGraph](https://github.com/colbymchenry/codegraph), [code-graph-mcp](https://github.com/sdsrss/code-graph-mcp)
- **SCIP가 LSIF 대체 심볼 인덱스 표준 정착** — `export_graph`에 SCIP 추가는 미래 상호운용 후보. protobuf 의존 부담으로 즉시 비권장 — 전략 후보 유지.
- **함의**: (1) 공급망 위생 유지(L-15 vite·L-11 better-sqlite3 해소, L-16 express 정렬), (2) MCP SDK v2 pre-alpha→stable 추적, (3) **회귀 안전망을 `src/utils/` 키 정규화 프리미티브까지 확장**(M-1 v25 toCanonical 게이트), (4) **의존성 위생(express lockfile 정렬)**(M-2 v25)이 신뢰성 차별화 축.

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 정밀 재열람에서 신규 prod 코드 결함이 없었다(M-1 v25는 미커버 순수 함수 게이트, M-2 v25는 lockfile 정렬):

- `src/server/api-server.ts` — 세션 TTL/cap/sweep·timing-safe Bearer·**8 REST 핸들러 + /healthz supertest 전수 게이트(P19-1) 재확인**(신규 라우트 0, 미커버 라우트 0)·rate-limit·session-마스킹 양호.
- `src/utils/paths.ts` — `isPathInside`(H-7, security.test 9케이스)·`isSystemPath`(initialize-project.test)·`getProjectHash`(phase13-8-b, 플랫폼 case-sensitivity) 동작까지 게이트됨. **단 `toCanonical`(변환 동작)은 멱등성(O-2)만 커버, 변환 결과 미커버 — M-1 v25.**
- `src/server/tools/_utils.ts` — `requireEngine`(H-1, 디스패처 커버)·`mergeResultsRRF`(P26-1)·`escapeXml`/`escapeDot`(P27-1) 3개 export 순수 함수 100% 커버.
- `src/graph/*` — architecture-engine(P22-1)·optimization-engine(P23-2)·remediation-engine(P23-1)·policy-discoverer(P24-1)·refactoring-engine getRiskProfile(P23-3)+proposeRefactor(P25-1) — 처방 엔진 5종 진입 로직 전수 게이트. Fisher-Yates+seeded PRNG+count-first 가드(200k)+BFS index-pointer 큐 O(V+E).
- `src/server/tools/*.ts` — `qualified_name` 10개 전수 strict 가드 정합(M-2 v22+v23). `search-symbols.ts` `query` strict 가드(P25-2)·`get-related-tests.ts` strict 가드(P26-2) 확인.
- `src/watcher/file-watcher.ts` — chokidar `ignored` 프레디킷·확장자 allowlist·flush 동시성·타이머 위생·대용량-배치 git-sync 라우팅·재시도/FATAL 강등(P20-1) 정상.
- `src/indexer/update-pipeline.ts` — 단일 책임·catch log-and-rethrow+롤백·원본 에러 보존(미세 항목만 L-9). `toCanonical` 키 정규화 호출(338·426·569줄)은 M-1 v25 게이트의 다운스트림.
- `src/indexer/cross-project-resolver.ts`·전 파서 — `toCanonical` 키 정규화 의존(M-1 v25가 그 프리미티브 동작을 게이트).
- `src/server/ipc-coordinator.ts` — challenge-response 인증·1MB 제한·per-tool 타임아웃·keepalive(unref)·pending reject-on-close 견고.
- `src/server/tool-dispatcher.ts` — Terminal 포워딩·waitUntilReady·registry lookup·EngineNotReadyError 재시도 변환.
- `src/server/workspace-manager.ts`/`health-monitor.ts` — 버전-미스매치 reindex·dispose 순서(watcher→worker→DB)·ledger 일관성 견고.
- `package.json` overrides — tree-sitter `^0.25.0`·fast-uri·qs·hono·postcss 충족, vite `^8.0.16`(L-15 해소), better-sqlite3 lockfile **12.11.1**(P27-2). **express lockfile 4.22.1 — M-2 v25.** dev·prod audit 0/0.
- `README.md`/`README_KR.md`/`GUIDE_EN.md`/`GUIDE_KR.md` — Node ≥ 22 전부 정렬(P24-2, L-12 해소).
- `.github/workflows/ci.yml` — Node 22/24 매트릭스 + `npm audit --omit=dev --audit-level=high`(P14-1) + `npm ci`. (cynapx-autonomous.yml은 본 진단 범위 외.)
- in-tree 에이전트 설정: `.claude/launch.json` 1개(양성), `.cursor`/`.gemini` 부재, in-tree binding.gyp 0개(L-2 공급망 미도달 재확인).
- TODO/FIXME/XXX/HACK = 0건(`src/` 전수).

---

## 8. 권장 수정 순서 (Phase 28 제안 — 상세는 phase28-plan.md)

**Phase 27 이후 prod 코드는 steady-state(CRITICAL/HIGH 0, prod·dev audit 0/0, TODO 0, god-module 0, 핫패스 quadratic 0)이고 신규 prod-도달 CVE도 0건이며, 과거 "low-hanging fruit" 각도(graph/ 엔진·핸들러 가드·`server/tools/_utils.ts` 순수 함수)는 소진됐다.** v25는 그 *다음* 각도를 *새 레이어(`src/utils/`)*에서 찾았다 — `toCanonical()`(전 파서·cross-project·get-related-tests의 키 정규화 프리미티브)의 *변환 동작 미커버*(M-1 v25)와 *express lockfile 드리프트*(M-2 v25). CRITICAL/HIGH 0, MEDIUM 2(M-1 v25 toCanonical 게이트 — 테스트-only; M-2 v25 express lockfile 4.22.1→4.22.2 정렬 — lockfile-only), LOW(L-2~L-9 v24 승계 + L-13/L-14 승계 + L-16 [해소-승격 → M-2 v25]; L-11/L-15 이전 해소). 따라서 Phase 28은 **toCanonical 변환 동작 게이트(P28-1, 테스트-only) + express lockfile 정렬(P28-2, lockfile-only) + 추적 갱신**이 합리적이다. **이로써 `src/utils/paths.ts`의 핵심 순수 함수까지 동작 게이트가 확장되고, 의존성 위생도 정렬된다 — 프로젝트는 더 깊은 steady-state로 진입한다(남은 항목은 전부 L-tracking/이연).**

1. **P28-1 [DONE — Phase 28-1]**: M-1 v25 해소 — `tests/phase12-6-commit-b.test.ts`(O-2 describe 옆)에 `toCanonical` 변환-동작 케이스 8건 추가(역슬래시→슬래시·빈-문자열·drive-letter·상대→절대 prepend(+`//` 가드)·소문자·다중-슬래시 축약·trailing-slash 제거, 의존 0, 테스트-only, prod 코드 무변경). (vitest 649→657 그린)
2. **P28-2 [DONE — Phase 28-2]**: M-2 v25 해소 — `npm i express@4.22.2`로 `package-lock.json` express 엔트리만 4.22.1→4.22.2 정렬(`package.json` 핀 `^4.19.2` 무변경) + 657 그린(api-server supertest 회귀 게이트) + audit 0/0 재확인. **lockfile-only.**
3. **추적 상태 갱신**: L-2(Miasma/Phantom Gyp 도달 0 불변), L-3(SDK v2 *여전히 pre-alpha* — stable Q3까지 이연), L-6(node-tree-sitter#268 open), L-7/L-8 게이트 공백, L-9 잔여 클린업, L-13(analyze-impact use_cache 무해), L-14(CVE-2026-25727 time 크레이트 미도달) 현 상태를 다음 사이클 출발점으로 고정. **L-11(better-sqlite3)·L-15(vite) 해소 종료.**

(L-4 IPC MessagePack 계속 보류, L-5 클러스터링 본격 파티셔닝 계속 이연, MCP 전면 stateless/task 마이그레이션은 SDK v2 stable 배포까지 이연, SCIP export는 전략 후보로 기록만.)
