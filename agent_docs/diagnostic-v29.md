# Cynapx 정밀 진단 보고서 v29

- **기준 커밋**: `dfb9dd5` (Phase 31 + Phase 31-1 완료 — `tests/language-registry.test.ts`에 `getProvider()` 확장자 엣지케이스 6 `it` 추가로 M-1 v28(L-18 승격) 해소, 테스트-only·prod 무변경, vitest 672→678, 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-16
- **진단 범위**: src/ 전체(server, db, indexer, graph, watcher, utils, cli, bootstrap) + **외부-트리거-only 포스처 두 번째 사이클의 *정직한 내부 잔여 각도 재스캔* + 외부 컨텍스트 재스캔**. diagnostic-v28 §8 + phase31-plan §4-5가 명시한 대로 *내부 순수 함수 게이트 발굴 사이클은 graph/ 엔진(진입+시딩)·핸들러 strict 가드·`_utils.ts`·`paths.ts`·`getProvider`(P31-1)까지 레이어별로 소진*됐다. 본 사이클은 그 "소진" 주장을 **회의적으로 재검증**한다: phase32-task가 명시적으로 지목한 *세 후보*(① `paths.ts` 형제 함수 `isPathInside`/`isSystemPath`/`getProjectHash`/`getDirSizeMB`, ② `metrics-calculator.ts` 사이클로매틱 복잡도 측정 로직, ③ 그 외 부분 커버 모듈)를 *직접 코드+테스트 대조*로 전수 판정한다.
- **진단 방법**: 단일 에이전트 오케스트레이션 + 회의적 코드 리뷰(잔여 각도 targeted) + 로컬 직접 검증(`npx vitest run`[678/678·5.91s], `npx tsc --noEmit`, `npm audit`[dev 포함]·`npm audit --omit=dev`, `npm ls @modelcontextprotocol/sdk zod express better-sqlite3 vite`, `npm view` dist-tags 직접 조회) + **`git log dfb9dd5 --oneline`로 신규 prod 코드 부재 실측**(= P31 테스트-게이트/문서 커밋만, 신규 도구/엔드포인트/유틸 0) + **세 후보 코드↔테스트 직접 대조**(paths.ts 형제 4함수의 기존 테스트 매핑 grep·metrics-calculator null-guard `npx tsx` 실측) + **신규 vitest CVE 2건(CVE-2026-47428/47429) 도달성 삼축 판정** + 외부 웹 재조사(MCP SDK v2 dist-tags·vitest/better-sqlite3/express/zod/tree-sitter/chokidar CVE·Miasma/Phantom Gyp 캠페인·node-tree-sitter#268).
- **현재 상태(직접 검증)**: `npx vitest run` **678/678**(47 파일, **5.91s** — P31-1로 672→678), `npx tsc --noEmit` 그린, **`npm audit`(dev 포함) = 0 vulnerabilities**, **`npm audit --omit=dev`(prod) = 0 vulnerabilities**. diagnostic-v28 전 항목 처리 완료(M-1 v28 [DONE — P31-1], L-18 추적 종료), LOW 승계 추적.

> **요약**: **이 사이클은 *외부-트리거-only 포스처 두 번째 사이클*이며 — phase32-task가 지목한 "마지막 내부 각도" 세 후보를 회의적으로 재검증한 결과, *내부 순수 함수 게이트 후보 1건이 진짜로 남아 있었다*(metrics-calculator null-guard).** **(1) 신규 prod 코드 0**: `git log dfb9dd5 --oneline` = `dfb9dd5`(P31-1 `getProvider` 게이트)·`f9a061c`(phase31 docs)·`8b4d68f`(P30-1 lockfile)·`6033f3a`(phase30 docs)·`a71d916`(P29-1 게이트) — *전부 테스트-게이트/lockfile/문서 커밋*이며 신규 MCP 도구·REST 엔드포인트·유틸 함수는 **0건**. **(2) phase32-task 지목 후보 ①(`paths.ts` 형제) — 이미 전수 게이트됨(신규 0)**: `isPathInside`(security.test.ts §`isPathInside (H-7)` — 동일경로·자손·sibling-escape `parent-secrets`·`..`·case-sensitivity 9+ 단언), `isSystemPath`(initialize-project.test.ts §`isSystemPath` — `/etc`·`/usr/lib`·`/proc/1` 양성 + `/etcetera`·`/usrland` prefix-boundary 음성), `getProjectHash`(phase13-8-commit-b.test.ts §A-8 — POSIX 케이스-구분·win32/darwin 케이스-무구분)가 *모두 직접 게이트*돼 있다. `getDirSizeMB`(paths.ts:304, 디스크 사용량 재귀 walker)는 **diagnostic-v25 §5에서 이미 "fs 의존(픽스처 필요)·비-순수·추적 안 함"으로 판정** — 0-의존 순수 함수가 아니므로 (b) 잣대 미충족(L-20 비-actionable 추적으로 기록). → **paths.ts 형제에서 신규 actionable 0.** **(3) phase32-task 지목 후보 ②(`metrics-calculator.ts`) — *마지막 남은 0-의존 순수 함수 게이트 후보 1건 발견*(M-1 v29)**: `MetricsCalculator.calculateCyclomaticComplexityTreeSitter(node, decisionPoints)`의 본체 분기(operator 노드 `&&`/`||`/`??`/`and`/`or` 디스앰비규에이션·`switch_label` `namedChildCount` 가드·strings/comments 미카운트·TS-AST 경로)는 *Rust/Go/Java/Python/TypeScript 실파스로 전수 게이트*(metrics-calculator.test.ts 12 `it`)되나 — **`if (!node) return 1` *null/undefined 가드*(97줄)는 직접 단언이 없다**(`null`/`undefined` 입력 시 즉시 `1` 반환, 그래머/파서 *불필요*한 0-의존 결정 로직). `calculateCyclomaticComplexityTreeSitter`는 *모든 비-TS 언어(12종)의 함수/메서드 인덱싱마다 호출되는* CC 측정 핫패스이며, null-guard 회귀(예: 가드 제거 → `current.type` 접근 TypeError)는 *유효-노드 테스트를 우회로* 슬립할 수 있다(정상 테스트는 *항상 유효 노드만* 전달). **이는 M-1 v23(`mergeResultsRRF`)·M-1 v25(`toCanonical`)·M-1 v26(`mulberry32`)·M-1 v28(`getProvider`)과 *동형의 "라이브 핫패스 뒤 0-의존 순수 함수 미커버 게이트"*이며 — *indexer 메트릭 계산 레이어*를 덮는 마지막 후보다.** `npx tsx` 실측으로 결정성 확정: `calculateCyclomaticComplexityTreeSitter(null, [...])`→`1`, `(undefined, [...])`→`1`, `(유효노드, [])`(빈 decisionPoints)→`1`. **M-1 v29(Phase 32-1, 테스트-only)로 처리.** **(4) phase32-task 지목 후보 ③(그 외 부분 커버) — 신규 0**: TS-AST 경로(`calculateCyclomaticComplexity`)는 metrics-calculator.test.ts §`CC — TypeScript AST path unchanged`로 커버, get-setup-context(`getDirSizeMB` 소비자)는 통합 경로, admin CLI `cmd*`(L-7)·worker-pool/embedding/migration 잔여(L-8)는 *기존 추적 항목*(모듈-private·flaky 위험으로 (b) 미충족). **(5) 외부 모두 정적이되 신규 vitest CVE 2건 도달성 정밀 판정**: prod·dev `npm audit` 0/0, MCP SDK v2 *여전히 pre-alpha*(npm `dist-tags = { latest: '1.29.0' }`·`time.modified = 2026-06-04`[v28 대비 불변]·2.x dist-tag 부재, stable Q3 2026[스펙 publish 2026-07-28 — *6주여 앞이나 아직 미래*]), **신규 CVE-2026-47428(vitest browser-mode otelCarrier inline-script, Critical, 영향 *`>=4.0.17 <4.1.6`*)·CVE-2026-47429(vitest UI-server arbitrary file read/exec, Critical CVSS 9.8, 영향 *`>=4.0.0 <4.1.0`* + `<3.2.6*) — *Cynapx 미도달 삼중 확인***: ① **버전 — Cynapx vitest = 4.1.9**(P30-1 within-pin 정렬이 *우연히 두 CVE의 fix 라인(47428: 4.1.6 / 47429: 4.1.0)을 모두 초과* — `npm ls vitest` = `vitest@4.1.9`, audit 0 불변), ② **기능 — Cynapx는 vitest *browser-mode/UI-server 미사용***(`vitest run` 헤드리스 CI 전용 — `@vitest/browser`/`@vitest/ui` 미설치·`--api.host`/`api.host` 미설정), ③ **플랫폼 — 47429 path-traversal은 *Windows 전용***(Linux는 nonexistent-dir 에러로 미도달)·네트워크 노출 전제 미충족 → **버전·기능·플랫폼 삼중 미도달**(L-21 신규 추적; *P30-1의 vitest 4.1.9 정렬이 우연히 본 CVE 범위를 벗어난 점은 부수적 이득*, zod L-19와 동형). better-sqlite3 12.11.1 직접 CVE/하이재킹 0건(npm `dist-tags.latest = 12.11.1`), Miasma/Phantom Gyp 캠페인 여전히 활발(57패키지/286악성버전·liuende501 dead-drop·`.claude`/Cursor/Gemini persistence — *2026-06-03~04 wave2 이후 신규 wave 없음*)하나 *Cynapx 트리 미도달 재확인*(in-tree binding.gyp **0개**·컴프로마이즈 패키지 not in tree·`.claude/launch.json` 1개 양성·`.cursor`/`.gemini` 부재 — L-2 불변), node-tree-sitter#268 여전히 open(L-6 불변). **이로써 *paths.ts 형제는 이미 게이트 완료(후보 ① 소거)이되 metrics-calculator null-guard가 마지막 0-의존 순수 함수 후보로 남아 있었음*을 정직하게 확인하고 — 이를 M-1 v29로 처리한다.** **신규 M-2 v29 후보 검토 → *없음***: 내부 신규 게이트 후보 0(M-1 v29 후 소진), 외부 신규 actionable CVE/advisory 0(vitest CVE 2건 삼중 미도달·audit 0/0), MCP SDK v2 미배포(L-3 이연), lockfile within-pin 드리프트 0(`npm outdated` Current=Wanted). **CRITICAL 0, HIGH 0, MEDIUM 1(M-1 v29 — metrics-calculator null-guard 게이트, Phase 32-1, 테스트-only), LOW(L-2~L-9 v28 승계 + L-13/L-14 승계 + L-19 승계 + L-20 신규[`getDirSizeMB` fs-의존 비-순수, 비-actionable] + L-21 신규[vitest CVE 2건 삼중 미도달, 비-actionable] ; L-18 [P31-1 해소 — 추적 종료], L-17 [P30-1 해소], L-11/L-15/L-16 이전 해소).**

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건은 Phase 13에서, v11 HIGH(공급망)는 Phase 14-1에서, v12~v18 MEDIUM은 Phase 15~21에서, v19 MEDIUM은 Phase 22-1에서, v20~v27 MEDIUM은 Phase 23~30에서, v28 MEDIUM 1건(M-1 v28 `getProvider` 엣지케이스)은 Phase 31에서 해소됐고, 본 잔여-각도 재스캔에서 새로운 CRITICAL/HIGH는 없다. IPC 핸드셰이크(challenge + HMAC-SHA256 + timingSafeEqual)·API Bearer(SHA-256 + timingSafeEqual)·세션 맵(TTL+cap+sweep unref) 모두 견고(직접 재열람).

---

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** 코드·공급망 어디에서도 신규 HIGH 없음. **prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0**(직접 재검증). 신규 prod 코드 0(`git log dfb9dd5` = 테스트-게이트/문서 커밋만)이라 신규 결함 표면 자체가 없다. M-1 v29(metrics-calculator null-guard 게이트)는 MEDIUM이다 — *게이트 공백(보안·크래시 결함 아님, 0-의존 null-guard 결정성 미커버)*이며 prod 동작 무변경(테스트-only). **신규 vitest CVE 2건(CVE-2026-47428/47429, Critical)도 Cynapx 미도달이라 LOW(L-21)**: ① vitest 4.1.9(두 CVE fix 라인 4.1.6/4.1.0 초과), ② browser-mode/UI-server 미사용, ③ 47429 path-traversal Windows 전용·네트워크 노출 전제 미충족 → 삼중 미도달, audit 0 불변. CVE-2026-6991(zod CUID, L-19)·CVE-2026-25727(`time` 크레이트, L-14)·Miasma/Phantom Gyp(L-2)도 Cynapx 미도달 불변.

---

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

| # | 위치 | 내용 |
|---|------|------|
| **M-1 v29** `[DONE — Phase 32-1]` *(신규, actionable — `MetricsCalculator.calculateCyclomaticComplexityTreeSitter()` null/undefined 가드 게이트. `getProvider`(P31-1) 이후 *마지막 남은 0-의존 순수 함수 후보*)* | `src/indexer/metrics-calculator.ts:96-97`(`calculateCyclomaticComplexityTreeSitter(node, decisionPoints)` — `if (!node) return 1` null/undefined early-return 97줄), `tests/metrics-calculator.test.ts`(Rust/Go/Java/Python/TS 실파스 12 `it`로 본체 분기 전수 게이트 — *단 null/undefined·빈 decisionPoints 입력은 미커버*) | **`calculateCyclomaticComplexityTreeSitter()`의 null/undefined·빈-decisionPoints 입력에 회귀 게이트 추가.** 본 함수는 *모든 비-TS 언어(12종)의 함수/메서드 인덱싱마다 호출되는* CC 측정 핫패스이며 — 본체(operator 노드 `&&`/`||`/`??`/`and`/`or` 디스앰비규에이션[108-115줄]·`switch_label` `namedChildCount` 가드[116-120줄]·반복 DFS 스택 워크·strings/comments 미카운트·TS-AST 경로)는 *실파스 12 `it`로 전수 게이트*되나, **(a) `if (!node) return 1` *null/undefined early-return*(97줄)**과 **(b) 빈 `decisionPoints` → `points` 빈 Set → 모든 노드 미스 → CC=1** 경계는 직접 단언이 없다. 이 둘은 *동기·side-effect-free*한 0-의존 결정 로직(그래머/파서 불필요 — null/empty 입력은 즉시 `1`). **직접 실행(`npx tsx`)으로 재확정한 결정적 동작**: `calculateCyclomaticComplexityTreeSitter(null, ['if_statement'])`→`1`, `(undefined, ['if_statement'])`→`1`, `({type:'x',childCount:0,child:()=>null}, [])`(빈 decisionPoints)→`1`. **승격 근거**: phase32-task가 명시적으로 metrics-calculator를 "사이클로매틱 복잡도 측정 로직 — 이미 커버됐는지? 엣지케이스는?"으로 지목했고 — 회의적 재검토 결과 *본체는 커버·null-guard만 누락*임을 확인했다. **(b) 잣대 충족**: (1) prod 코드 무변경(테스트-only — `metrics-calculator.test.ts`에 null-guard describe 추가); (2) *의존 0 — 3개 결정적 케이스, 한 파일*(노드(또는 null) in → number out; null/undefined/빈-dp 케이스는 전부 *동기·side-effect-free*한 `1` 반환); (3) M-1 v23(`mergeResultsRRF`)·M-1 v25(`toCanonical`)·M-1 v26(`mulberry32`)·M-1 v28(`getProvider`)과 *동형의 0-의존 순수 함수 게이트*이되 *indexer 메트릭 계산 레이어*를 덮는다. **이로써 *모든 비-TS 함수 인덱싱이 의존하는* CC 측정 함수의 방어적 null-guard에 회귀 안전망을 친다** — 가드 회귀(예: `if (!node)` 제거 → `current.type`/`childCount` 접근 TypeError로 *전체 비-TS 인덱싱 크래시*)가 *유효-노드 테스트를 우회로* 슬립할 수 있으나(정상 테스트는 *항상 유효 노드만* 전달), null/undefined 고정값(`1`) 단언은 그 회귀를 결정적으로 잡는다. **verdict: actionable — Phase 32-1.** (5장 상세) |

> **참고(M-2 v29 부재 근거 + 잔여 각도 재스캔 결과)**: phase32-task는 *세 후보*(paths.ts 형제·metrics-calculator·그 외 부분 커버)를 정직하게 재검토하라 지시했다. **(a) paths.ts 형제(후보 ①) — 신규 0**: `isPathInside`/`isSystemPath`/`getProjectHash`는 *이미 전수 직접 게이트*(security.test.ts·initialize-project.test.ts·phase13-8-commit-b.test.ts), `getDirSizeMB`는 *fs-의존 비-순수*로 (b) 미충족(diagnostic-v25에서 이미 판정·L-20 추적). **(b) metrics-calculator(후보 ②) — M-1 v29 1건 발견**: 본체는 커버·null-guard만 누락. **(c) 그 외 부분 커버(후보 ③) — 신규 0**: TS-AST 경로 커버, get-setup-context는 통합, admin CLI(L-7)·worker-pool/embedding/migration(L-8)은 기존 추적(모듈-private·flaky). **(d) 외부 신규 actionable 0**: prod·dev audit 0/0, MCP SDK v2 미배포(L-3 이연), 신규 vitest CVE 2건 삼중 미도달(L-21), within-pin 드리프트 0. 따라서 *유일한 actionable은 M-1 v29(metrics-calculator null-guard)*뿐이며 — 이를 처리하면 *0-의존 순수 함수 게이트 발굴이 완전 소진*된다(이후는 신규 prod 코드 추가 시에만 확장).

---

## 4. 최적화 (LOW) — 추적/이연 (v28 승계; L-18 [P31-1 해소]; L-20/L-21 신규)

| # | 위치 | 내용 |
|---|------|------|
| L-2(v29) | `package.json` (native deps), CI / Dockerfile, `.claude/` 설정 | **Miasma / Phantom Gyp / Node-gyp 공급망 캠페인 포스처 추적 — Cynapx 도달 0건 불변(재확인).** 진단 일자 직접 재대조: 캠페인은 *여전히 활발*(57패키지/286악성버전, 157-byte binding.gyp 남용 self-propagating worm — binding.gyp가 `npm install` 중 node-gyp 코드 실행을 트리거해 install-script 보안 검사 우회; Bun 런타임 다운로드·AWS/GCP/Azure/GitHub/npm/SSH/K8s 자격증명 sweep·GitHub dead-drop[liuende501 236 repo]·`.claude`/Cursor/Gemini persistence 주입·`bypass_2fa: true` worm 전파; Microsoft GitHub 73 repo 영향 보고; Shai-Hulud/Miasma 계보 8번째)이나 *2026-06-03~04 wave2 이후 신규 wave 보고 없음*. **Cynapx 트리 미도달 재확인**: *in-tree binding.gyp **0개***(`find . -name binding.gyp -not -path "*/node_modules/*"` = 0), 컴프로마이즈 패키지 *not in tree*(`npm ls` = empty), in-tree 설정은 `.claude/launch.json` 1개(양성)·`.cursor`/`.gemini` 부재. native 의존(better-sqlite3 12.11.1 + tree-sitter 0.25.0 + 12 grammar) 무관·악성 버전 미발행. CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지 1차 방어선 유지. **즉각 조치 불필요 — 추적만.** 출처: [StepSecurity Miasma](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm), [Chainguard Miasma](https://www.chainguard.dev/unchained/chainguard-artifacts-safe-from-miasma-phantom-gyp-npm-attack), [Wiz Miasma](https://www.wiz.io/blog/miasma-supply-chain-attack-targeting-redhat-npm-packages), [Snyk node-gyp compromise](https://snyk.io/blog/node-gyp-supply-chain-compromise-self-propagating-npm-worm-binding-gyp/) |
| L-3(v29) | `src/server/api-server.ts` (session-id StreamableHTTP), `package.json:29`(`@modelcontextprotocol/sdk ^1.29.0`) | **MCP SDK v2 — *여전히 pre-alpha*(상태 불변, npm 레지스트리 직접 재확인).** `npm view @modelcontextprotocol/sdk dist-tags time.modified` 직접 실행: `dist-tags = { latest: '1.29.0' }` — **2.x dist-tag 부재**(`next`/`rc`/`alpha`/`beta` *어떤 dist-tag도 2.x를 가리키지 않음*; `2.0.0-alpha.x`는 npm `versions` 배열엔 존재하나 *dist-tag로 노출되지 않아* `npm install @modelcontextprotocol/sdk`는 여전히 1.29.0 설치)·`time.modified = '2026-06-04T19:46:40Z'`(**v28 대비 불변**). v2는 main 브랜치에서 pre-alpha 개발 중·**stable은 Q3 2026**(스펙 publish 2026-07-28 — *오늘 2026-06-16 기준 6주여 앞이나 아직 미래*) 예정, v1.x가 production 권장·v2 출시 후 최소 6개월 v1.x 보안/버그 수정 지속. → Cynapx 핀 `^1.29.0` 유지가 옳음. stateless protocol core(SEP-2567)·Multi-Round-Trip·MCP Apps 마이그레이션은 **v2 stable 전환까지 계속 이연**. P15-3 `handleMcp()` 설계 메모가 출발점. **다음 사이클(2026-07-28 전후)에 v2 stable/2.x dist-tag 출현 재확인이 핵심 외부 트리거.** 출처: [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk), [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) |
| L-4(v29) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환. **성능 문제 미관측 — 계속 보류.** 메시지가 작고 round-trip이 드물어 직렬화 병목 아님 |
| L-5(v29) | `src/graph/graph-engine.ts` | 클러스터링 본격 서브그래프 파티셔닝 — 100k+ 노드 실측 시 재검토(**계속 이연**). LPA O(V+E)·`MAX_ITER=20` 캡·count-first 가드(200k, `parseClusterMaxNodes`)·Fisher-Yates seeded PRNG(`mulberry32`) 직접 재확인 — OOM/편향 방어 정상. **시딩/캡 프리미티브의 순수 함수 동작은 P29-1로 게이트 완료.** |
| L-6(v29) | CI / Dockerfile | Node 24 + tree-sitter 0.25.x 빌드 fragility([node-tree-sitter#268] 여전히 open·미해결, CVE 아님 — 진단 일자 재확인: `No native build ... abi=127` + C++20/C++17 빌드 모순). CI Node 22/24 매트릭스 그린이나 Node 24 LTS 전환 전 prebuild 재확인. **추적만** 출처: [node-tree-sitter#268](https://github.com/tree-sitter/node-tree-sitter/issues/268) |
| L-7(v29) | `src/cli/admin.ts` (cmd* 9개), `tests/admin-cli.test.ts` | **admin CLI 명령 동작의 vitest 게이트 공백 — 비-actionable 추적.** 등록 명령 9개 `cmd*`는 모듈-private(미-export)이라 vitest 직접 호출 불가. **admin.ts 핸들러 export 리팩터 시 함께 게이트화 후보** |
| L-8(v29) | `src/indexer/worker-pool.ts`, `embedding-manager.ts`, `db/database.ts` | **에러-복구·마이그레이션 잔여 분기의 vitest 게이트 공백 — 비-actionable 추적.** worker `worker.on('error')`·queue backpressure·embedding A-7 stale supersedence 레이스·DB migration 잔여 분기는 직접 미검증이나 인접 분기 커버 + 타이밍-flaky 위험. **SCHEMA_VERSION 증분/worker-pool 리팩터 시 함께** |
| L-9(v29) | `src/indexer/update-pipeline.ts` (트랜잭션 보일러플레이트·progress `log.error`), `embedding-manager.ts:184`/`api-server.ts:625` (빈 catch) | **L-9 코드 클린업 잔여 — (b) 잣대 미충족, 비-actionable 추적.** `withWriteTransaction()` 추출은 트랜잭션 경계 5곳 재작성이라 회귀 표면 넓음; 빈 catch 2건은 의도적 silent-drop 방어. **update-pipeline 리팩터 페이즈로 묶어 처리 후보** |
| **L-13(v29)** *(승계 — analyze-impact use_cache 스키마-default 미강제, 무해)* | `src/server/tools/analyze-impact.ts:23` (`useCache: args.use_cache` 무검증·default 미강제) | **`analyze-impact` 핸들러가 `use_cache`(스키마 default `true`)를 검증·default-강제 없이 `traverse({useCache: args.use_cache})`에 전달 — 무해.** `args.use_cache`가 `undefined`면 캐시 *비활성*(스키마 default와 어긋나도 *느려질 뿐* 정확성·크래시 영향 0). 동형 무해 패턴이 `export-graph`·`get-symbol-details`에도 존재 — 전부 다운스트림 undefined-안전. **verdict: 추적만(비-actionable)** |
| **L-14(v29)** *(승계 — CVE-2026-25727 `time` 크레이트, Cynapx 미도달 불변)* | (외부 — Rust `time` crate via tree-sitter Rust 생태계 언급), Cynapx prod 트리 무관 | **CVE-2026-25727(RFC 2822 파싱 스택 소진 DoS, `time` 크레이트 0.3.6~<0.3.47)은 *tree-sitter*로 거론되나 실제로는 Rust `time` 크레이트 결함 — Cynapx prod 트리 미도달 불변.** Cynapx 의존 표면(npm tree-sitter 0.25.0 + 12 grammar)에 `time` 크레이트 부재 → prod·dev 미도달, audit 0/0 불변. tree-sitter Rust 생태계 모니터링 신호로 추적. **verdict: 추적만(비-actionable — 미도달)** 출처: [NVD CVE-2026-25727](https://nvd.nist.gov/vuln/detail/CVE-2026-25727) |
| **L-19(v29)** *(승계 — CVE-2026-6991 zod CUID 핸들러 SQL injection, Cynapx 버전·기능 양면 미도달)* | (외부 — zod ≤ 4.3.6 CUID 데이터타입 핸들러), Cynapx: `package-lock.json`(zod 4.4.3)·`src/server/api-server.ts`(`.cuid()` 미사용) | **CVE-2026-6991(zod CUID SQL injection, MEDIUM, 영향 *zod ≤ 4.3.6*)은 Cynapx 미도달 — *삼중 음성*.** ① **버전 — Cynapx zod = 4.4.3**(영향 ≤4.3.6 밖, `npm ls zod` = 4.4.3 deduped, audit 0), ② **기능 — `.cuid()`/`.cuid2()` 미사용**(`grep -rn 'cuid' src/` = 0; api-server.ts zod = `z.string()`/`z.number()`/`z.enum()`/`z.object()`만), ③ **바인딩 — parameterized statement만**(zod 값 문자열 보간 0). → 버전·기능·바인딩 삼중 미도달. zod 생태계 모니터링 신호로 추적. **verdict: 추적만(비-actionable — 미도달)** 출처: [Snyk zod](https://security.snyk.io/package/npm/zod) |
| **L-20(v29)** *(신규 — `getDirSizeMB` fs-의존 비-순수, (b) 잣대 미충족)* | `src/utils/paths.ts:304`(`getDirSizeMB(dir)` — 재귀 `fs.readdirSync`/`fs.statSync` walker), `src/server/tools/get-setup-context.ts:15`(소비자) | **`getDirSizeMB()`는 *paths.ts 형제 중 유일하게 직접 게이트되지 않은 함수*이나 — fs-의존 비-순수라 (b) 잣대 미충족(비-actionable 추적).** phase32-task가 paths.ts 형제 함수 게이트 가능성을 지목했으나 — `isPathInside`/`isSystemPath`/`getProjectHash`는 *이미 전수 게이트*(security.test.ts·initialize-project.test.ts·phase13-8-commit-b.test.ts)되고, `getDirSizeMB`만 미커버다. 그러나 `getDirSizeMB`는 *재귀 디렉토리 트리 walker*(`fs.existsSync`/`fs.readdirSync`/`fs.statSync`)라 **0-의존 순수 함수가 아니다 — 픽스처 디렉토리 트리 생성·정리(setup/teardown)가 필요**(diagnostic-v25 §5에서 이미 "fs 의존(픽스처 필요)·비-순수·추적 안 함"으로 판정). 게이트하려면 tmpdir에 실파일 트리를 만들고 바이트 합산을 단언해야 하는데, 이는 M-1 v23~v29의 *0-의존 결정적 케이스* 부류가 아니라 *fs-fixture 통합 테스트* 부류다. 소비자 `get-setup-context`는 통합 경로로 도달. **verdict: 추적만(비-actionable — fs-의존). get-setup-context fixture 테스트 페이즈를 별도로 묶을 때 함께 후보.** |
| **L-21(v29)** *(신규 — CVE-2026-47428/47429 vitest browser/UI RCE, Cynapx 버전·기능·플랫폼 삼중 미도달)* | (외부 — vitest `>=4.0.17 <4.1.6`[47428] / `>=4.0.0 <4.1.0`·`<3.2.6`[47429] browser-mode/UI-server), Cynapx: `package-lock.json`(vitest 4.1.9)·`vitest.config`(headless `vitest run` only) | **CVE-2026-47428(vitest browser-mode otelCarrier inline-script, Critical)·CVE-2026-47429(vitest UI-server arbitrary file read→RCE, Critical CVSS 9.8)는 Cynapx 미도달 — *삼중 확인*.** ① **버전 — Cynapx vitest = 4.1.9**(47428 fix 4.1.6·47429 fix 4.1.0 *둘 다 초과* — `npm ls vitest` = 4.1.9, `npm audit` 0[advisory가 4.1.9를 not-affected 처리]; *P30-1의 vitest 4.1.2→4.1.9 within-pin 정렬이 우연히 두 CVE fix 라인을 모두 넘김 — lockfile 위생이 보안 마진으로 작용*, zod L-19와 동형), ② **기능 — Cynapx는 browser-mode/UI-server 미사용**(`@vitest/browser`·`@vitest/ui` 미설치, `vitest run` 헤드리스 CI 전용 — otelCarrier inline-script 경로·UI `/__vitest_attachment__` 핸들러 *미도달*; `--api.host`/`api.host` 미설정), ③ **플랫폼 — 47429 path-traversal은 Windows 전용**(`\\?\\..\\` 우회, Linux는 nonexistent-dir 에러로 미도달)·네트워크 노출 전제(`api.host` non-localhost) 미충족. → **버전·기능·플랫폼 삼중 미도달, audit 0 불변.** vitest 생태계 모니터링 신호로 추적. **verdict: 추적만(비-actionable — 미도달)** 출처: [GHSA-2h32-95rg-cppp](https://github.com/advisories/GHSA-2h32-95rg-cppp), [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp), [vitest security](https://github.com/vitest-dev/vitest/security) |

> **L-18 해소 안내**: diagnostic-v26 신규/v27~v28 승계 L-18(`LanguageRegistry.getProvider()` 확장자 엣지케이스 직접 테스트 공백)은 **Phase 31-1(M-1 v28)에서 해소**됐다 — `tests/language-registry.test.ts`에 무-확장자·미지·dotfile·trailing-dot→undefined·multi-dot→python·case-insensitive 보강 6 `it` 추가(672→678). **추적 종료.** L-17(within-pin lockfile)은 P30-1에서, L-16(express)은 P28-2에서, L-11(better-sqlite3)·L-15(vite)는 이전 사이클에서 이미 해소 — 추적 종료 유지.

> **신규 LOW 부재 안내(prod 코드 동작 변경)**: M-1 v29(metrics-calculator null-guard 게이트, 테스트-only)를 제외하면 prod 코드 *동작* 변경을 요하는 신규 LOW는 0건이다(신규 prod 코드 자체가 0 — `git log dfb9dd5`). L-13/L-14/L-19/L-20/L-21은 무해·미도달·비-순수 추적, M-1 v29는 테스트-only 게이트 공백이다.

---

## 5. 코드 품질 / 성능 전수 (잔여 각도 targeted 재검토 + steady-state 재확인)

v31까지 graph/ 엔진 처방 5종 진입 + 핸들러 보조 핵심 순수 로직(`mergeResultsRRF`·`escapeXml`·`escapeDot`) + `qualified_name` 10개 strict 가드 + 공통 유틸 정규화 프리미티브(`toCanonical`·`isPathInside`·`isSystemPath`·`getProjectHash`) + graph 엔진 시딩/env-파싱 프리미티브(`mulberry32`·`parseClusterSeed`·`parseClusterMaxNodes`) + indexer 확장자 매핑(`getProvider` 엣지케이스, P31-1)이 전수 게이트/정렬됐다. **본 사이클은 phase32-task 지목 *세 후보의 정직한 재검토***.

**(A) 신규 prod 코드 실측 — `git log dfb9dd5 --oneline`(head)**

| 커밋 | 내용 | 분류 |
|------|------|------|
| `dfb9dd5` | P31-1: gate getProvider() extension edge cases (M-1 v28) | 테스트-게이트(prod 무변경) |
| `f9a061c` | Phase 31 cycle: diagnostic-v28 + phase31-plan docs | 문서 |
| `8b4d68f` | P30-1: npm update within-pin lockfile alignment (M-1 v27) | lockfile(prod 무변경) |
| `6033f3a` | Phase 30 cycle: diagnostic-v27 + phase30-plan docs | 문서 |
| `a71d916` | Phase 29-1: gate mulberry32/parseClusterSeed/parseClusterMaxNodes | 테스트-게이트(prod 무변경) |

핵심: dfb9dd5 head = *테스트-게이트/lockfile/문서 커밋만*이며 **신규 MCP 도구·REST 엔드포인트·유틸 함수는 0건**. → *게이트할 신규 prod 표면이 없다*.

**(B) phase32-task 후보 ① — `paths.ts` 형제 함수 테스트 매핑(전수 게이트 확인 + `getDirSizeMB` 비-순수 판정)**

| 함수 | 코드 | 직접 테스트 | 판정 |
|------|------|------------|------|
| `isPathInside(child, parent)` (H-7) | paths.ts:46-59 | **커버**(security.test.ts §`isPathInside (H-7)` — 동일경로·자손·sibling-escape `parent-secrets`·`..`·case-sensitivity) | 정합(신규 0) |
| `isSystemPath(p)` | paths.ts:61-67 | **커버**(initialize-project.test.ts §`isSystemPath` — `/etc`·`/usr/lib`·`/proc/1` 양성 + `/etcetera`·`/usrland` prefix-boundary 음성) | 정합(신규 0) |
| `getProjectHash(path)` (A-8) | paths.ts:273-277 | **커버**(phase13-8-commit-b.test.ts §A-8 — POSIX 케이스-구분·win32/darwin 케이스-무구분) | 정합(신규 0) |
| `toCanonical(s)` | paths.ts:285-295 | **커버**(P28-1) | 정합(신규 0) |
| `getDirSizeMB(dir)` | paths.ts:304-321 | **미커버**(fs 재귀 walker) | **L-20 — fs-의존 비-순수, (b) 미충족** |

핵심: paths.ts 형제 *순수 함수는 전부 직접 게이트*되고, 유일한 미커버 `getDirSizeMB`는 *fs-의존 비-순수*(diagnostic-v25 §5에서 이미 판정)라 0-의존 게이트 부류가 아니다(L-20 비-actionable 추적). → **후보 ①에서 신규 actionable 0.**

**(C) phase32-task 후보 ② — `metrics-calculator.ts` 커버리지 정직 판정(→ M-1 v29)**

| 로직 | 코드 | 직접 테스트 | 판정 |
|------|------|------------|------|
| TS-AST CC(`calculateCyclomaticComplexity`) | metrics-calculator.ts:42-75 | **커버**(metrics-calculator.test.ts §`CC — TypeScript AST path unchanged` — if+&&+for+ternary) | 정합 |
| tree-sitter CC 본체(operator 디스앰비규에이션·`switch_label` 가드·strings/comments 미카운트) | metrics-calculator.ts:107-131 | **커버**(Rust/Go/Java/Python/TS 실파스 12 `it` — `default`/`else` 미카운트·catch 카운트·match arms 포함) | 정합 |
| **null/undefined 가드 + 빈 decisionPoints** | metrics-calculator.ts:97(`if (!node) return 1`)·98(빈 Set) | **미커버**(정확 처리되나 단언 0) | **M-1 v29 — Phase 32-1** |

핵심: 본체·TS-AST는 *실파스로 전수 게이트*되고 *null-guard·빈-dp 경계만 누락*. **`npx tsx` 재실측**: `(null, [...])`→1, `(undefined, [...])`→1, `(유효노드, [])`→1. → `tests/metrics-calculator.test.ts`에 null-guard describe 추가(테스트-only, 의존 0).

**(D) phase32-task 후보 ③ — 그 외 부분 커버 모듈(신규 0)**

| 모듈 | 상태 | 판정 |
|------|------|------|
| TS-AST 경로(`calculateCyclomaticComplexity`) | metrics-calculator.test.ts §TS-AST 커버 | 정합(신규 0) |
| `get-setup-context`(`getDirSizeMB` 소비자) | 통합 경로 도달 | L-20과 함께 fixture 테스트 후보(비-actionable) |
| admin CLI `cmd*` 9개 | 모듈-private | L-7 기존 추적(비-actionable) |
| worker-pool/embedding/migration 잔여 분기 | 인접 분기 커버 + flaky | L-8 기존 추적(비-actionable) |

핵심: 후보 ③에서 *기존 추적 항목 외 신규 0-의존 actionable 0*.

**(E) 의존성 lockfile 드리프트 — within-pin 0(P30-1 완료) + major 비권장 (`npm ls`/`npm view` 실측)**

| 패키지 | lockfile | npm latest | 분류 | 판정 |
|--------|----------|------------|------|------|
| `zod` | 4.4.3 | 4.4.3 | prod-dep, 핀-내 정렬됨 | 드리프트 0(P30-1) — CVE-2026-6991 범위 밖(L-19) |
| `vitest` | 4.1.9 | 4.1.9 | dev-dep, 핀-내 정렬됨 | 드리프트 0(P30-1) — CVE-2026-47428/47429 범위 밖(L-21) |
| `better-sqlite3` | 12.11.1 | 12.11.1 | prod-dep | 정렬(P27-2 — npm latest) |
| `express` | 4.22.2 | (4.x latest) | prod-dep | 정렬(P28-2) |
| `vite` | 8.0.16 | — | dev-dep | 정렬(L-15) |
| `@modelcontextprotocol/sdk` | 1.29.0 | 1.29.0 | prod-dep | 정렬(2.x dist-tag 부재 — L-3) |

핵심: prod·within-pin 드리프트 모두 0. 잔여는 *전부 major*(express 5·typescript 6·@types/node 25·commander 15 등)로 *핀 변경 수반·즉시 비권장*. → 본 사이클은 *M-2(actionable 의존성 정렬)가 없다*.

**(F) 신규 외부 CVE 도달성 — vitest CVE 2건 (버전·기능·플랫폼 삼중 미도달 → L-21)**

| 판정 축 | 실측 | 결론 |
|---------|------|------|
| 버전(47428 fix 4.1.6 / 47429 fix 4.1.0) | `npm ls vitest` = **4.1.9**(P30-1 정렬, 두 fix 라인 모두 초과) | *영향 범위 밖* — audit 0 불변 |
| 기능(browser-mode/UI-server) | `@vitest/browser`·`@vitest/ui` 미설치; `vitest run` 헤드리스; `api.host` 미설정 | *공격 표면 경로 미도달* |
| 플랫폼(47429 path-traversal) | Linux(nonexistent-dir 에러로 미도달); Windows 전용 | *플랫폼 미도달* |

핵심: P30-1의 vitest 4.1.2→4.1.9 정렬이 *우연히 두 CVE fix 라인을 모두 넘겼고*, Cynapx는 browser/UI 미사용이며, 47429는 Windows 전용이라 — **삼중 미도달**(L-21 비-actionable 추적).

**(G) prod steady-state 재확인 — 신규 prod 코드 결함 0**

| 항목 | 판정 |
|------|------|
| god-module / 순환 import | 0 — repos→engines→server/pipeline 단방향 불변 |
| TODO/FIXME/XXX/HACK | 0건(`src/` 전수) |
| 핫패스 O(n²)-over-nodes | 0 — 클러스터링 count-first 가드(200k)+seeded PRNG, BFS index-pointer 큐, 반복 DFS+60s 캐시, architecture-engine O(1) Map(P22-1), CC 측정 반복 DFS 스택(재귀 회피) |
| prod·dev audit | 0 / 0 vulnerabilities |
| 테스트 | `npx vitest run` **678/678**(47 파일, 5.91s) — P31-1로 672→678 |

**(H) 에러 핸들링 일관성 — 양호**

`Logger`(stderr-only) `normalizeData()` Error 언랩. update-pipeline catch는 log-and-rethrow + 롤백 선행. `qualified_name` 10개 strict 가드 전수 정합. `getProvider()` native grammar 로드 실패 graceful degrade. `calculateCyclomaticComplexityTreeSitter` null-guard(97줄)는 *방어적 early-return*(잘못된 호출 시 CC=1로 안전 degrade) — 정상이되 게이트 미커버(M-1 v29).

---

## 6. 외부 컨텍스트 (웹 조사 — 진단 일자 재실행, 출처 명시)

### 6.1 의존성 취약점 (prod·dev 둘 다 clean)

- **`npm audit`(dev 포함) = 0 + `npm audit --omit=dev`(prod) = 0**(둘 다 직접 실행).
- **신규 vitest CVE 2건(CVE-2026-47428/47429, Critical) — Cynapx 미도달(L-21)**: ① vitest 4.1.9(두 CVE fix 라인 4.1.6/4.1.0 초과), ② browser-mode/UI-server 미사용(`vitest run` 헤드리스), ③ 47429 path-traversal Windows 전용·네트워크 노출 전제 미충족 → 삼중 미도달, audit 0 불변. *P30-1의 vitest 4.1.9 정렬이 우연히 본 CVE 범위를 벗어난 점은 부수적 이득*(lockfile 위생이 보안 마진으로 작용 — zod L-19와 동형). 출처: [GHSA-2h32-95rg-cppp](https://github.com/advisories/GHSA-2h32-95rg-cppp), [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp)
- **신규 CVE-2026-6991(zod CUID, ≤4.3.6) — Cynapx 미도달(L-19, 승계)**: zod 4.4.3·`.cuid()` 미사용·parameterized binding 삼중 미도달.
- **better-sqlite3 직접 재확인**: `npm view better-sqlite3 dist-tags` = `{ latest: '12.11.1' }` — 12.11.1이 npm `latest`·악성 dist-tag 부재(L-2 불변). chokidar non-vulnerable, tree-sitter npm 바인딩 직접 CVE 0건(CVE-2026-25727은 Rust `time` 크레이트 — L-14), vite `^8.0.16`(L-15), express 4.22.2 직접 CVE 0건, @modelcontextprotocol/sdk 1.29.0 직접 CVE 0건.

### 6.2 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"` + Docker `node:22-bookworm-slim`. Node 22 LTS 2027-04 종료 — 여유. CI Node 22/24 매트릭스 그린(678/678). 문서 Node 버전(L-12, P24-2 해소) ≥ 22 정렬 유지.
- **tree-sitter 코어**: latest 0.25.0, 12 grammar dedupe/override. **tree-sitter-c-sharp**: 0.23.1 정확 핀 롤백 유지(0.23.5 ERR_REQUIRE_ASYNC_MODULE 미해소). Node 24 빌드 C++20 fragility([node-tree-sitter#268] 여전히 open) — L-6.
- **better-sqlite3**: lockfile 12.11.1(npm `latest`, P27-2 — L-11).
- **express**: lockfile 4.22.2(P28-2 — L-16).
- **vite**: devDependency `^8.0.16`(L-15).
- **vitest**: dev-dep lockfile **4.1.9**(P30-1 정렬). CVE-2026-47428(<4.1.6)/47429(<4.1.0) 영향 범위 밖(L-21).
- **zod**: prod-dep lockfile **4.4.3**(P30-1). CVE-2026-6991(≤4.3.6) 영향 범위 밖(L-19).
- **within-pin 드리프트**: **0**(P30-1 완료). 매 사이클 `npm outdated`/`npm ls`로 누적 모니터링.

### 6.3 공급망 캠페인 — Miasma / Phantom Gyp / Node-gyp (계속 활발, Cynapx 도달 0건 불변)

진단 일자 직접 재대조: 캠페인은 *여전히 활발*(57패키지/286악성버전, 157-byte binding.gyp 남용 self-propagating worm — binding.gyp가 `npm install` 중 node-gyp 코드 실행을 트리거해 install-script 보안 검사 우회; Bun 런타임 다운로드·AWS/GCP/Azure/GitHub/npm/SSH/K8s 자격증명 sweep·GitHub dead-drop[liuende501 236 repo]·`.claude`/Cursor/Gemini persistence 주입·`bypass_2fa: true` worm 전파; Microsoft GitHub 73 repo 영향; Shai-Hulud/Miasma 계보 8번째)이나 *2026-06-03~04 wave2 이후 신규 wave 보고 없음*. **Cynapx 트리 미도달 재확인**: *in-tree binding.gyp **0개***(직접 `find`), 컴프로마이즈 패키지 *not in tree*(`npm ls` = empty), in-tree 설정은 `.claude/launch.json` 1개(양성)·`.cursor`/`.gemini` 부재. CI `npm ci` + P14-1 audit 게이트 + Dockerfile 멀티스테이지. **즉각 변경 불필요, 포스처 추적.** 출처: [StepSecurity Miasma](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm), [Phoenix Security Miasma wave2](https://phoenix.security/miasma-wave2-npm-supply-chain-bindingyp-zero-cve-2026/), [Snyk node-gyp compromise](https://snyk.io/blog/node-gyp-supply-chain-compromise-self-propagating-npm-worm-binding-gyp/)

### 6.4 MCP 생태계 — SDK v2 여전히 pre-alpha (상태 불변, npm 레지스트리 직접 재확인)

- **MCP SDK v2가 여전히 pre-alpha**: `npm view @modelcontextprotocol/sdk dist-tags time.modified` = `{ latest: '1.29.0' }`·`2026-06-04T19:46:40Z`(**v28 대비 불변**) — **2.x를 가리키는 dist-tag 부재**(`2.0.0-alpha.x`는 버전으로만 존재·dist-tag 미노출 → `npm install`은 여전히 1.29.0). v2는 main 브랜치 pre-alpha, **stable은 Q3 2026**(스펙 publish 2026-07-28 — *오늘 기준 6주여 앞이나 아직 미래*), v1.x production 권장. → **Cynapx 핀 `^1.29.0` 유지가 옳다. stateless core/Tasks/MCP Apps/Multi-Round-Trip 마이그레이션(L-3)은 v2 stable까지 계속 이연.** **다음 사이클(2026-07-28 스펙 publish 전후)에 2.x dist-tag/v2 stable 출현 재확인이 핵심 외부 트리거.** 출처: [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk), [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases)

### 6.5 경쟁/인접 도구 동향 (전략 추적 — 카테고리 지속)

- **로컬-퍼스트 코드 그래프 카테고리 지속**: CodeGraph·Serena·GitNexus·code-graph-mcp 등이 "로컬·on-device·MCP·임베디드 SQLite·tree-sitter·no-code-egress" 패턴을 표준 기본값으로 정착. Cynapx의 "100% 로컬·격리·멀티프로세스 보안 IPC + 처방 엔진 + 하이브리드 RRF 검색" 포지션이 차별점. **함의: 처방 엔진 진입(v22)·핵심 보조 순수 로직(RRF·escape)·정규화 프리미티브(toCanonical/paths 형제)·graph 엔진 시딩(mulberry32)·indexer 확장자 매핑(getProvider, P31-1)이 전수 게이트 완성됐고 — *마지막 0-의존 순수 함수 후보(metrics-calculator null-guard, M-1 v29)*를 처리하면 신뢰성 차별화 축은 *외부-트리거 기반 위생/마이그레이션*으로 완전 이동한다.** 출처: [CodeGraph](https://github.com/colbymchenry/codegraph), [code-graph-mcp](https://github.com/sdsrss/code-graph-mcp)
- **SCIP가 LSIF 대체 심볼 인덱스 표준 정착** — `export_graph` SCIP 추가는 미래 상호운용 후보(protobuf 의존 부담으로 즉시 비권장).
- **함의**: (1) 공급망 위생 유지(prod-dep·within-pin 드리프트 0), (2) MCP SDK v2 pre-alpha→stable 추적(2026-07-28 전후 1순위 트리거), (3) **회귀 안전망은 indexer 메트릭 계산 null-guard까지 확장 예정(M-1 v29/P32-1) — 이후는 신규 코드 추가 시에만 확장**.

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 잔여-각도 재검토에서 신규 prod 코드 결함이 없었다(M-1 v29는 테스트-only 게이트 공백 보강):

- `src/server/api-server.ts` — 세션 TTL/cap/sweep·timing-safe Bearer·8 REST 핸들러 + /healthz supertest 전수 게이트(P19-1)·rate-limit·session-마스킹 양호. zod 스키마(P30-1로 4.4.3 — CVE-2026-6991 범위 밖·`.cuid()` 미사용, L-19).
- `src/utils/paths.ts` — `isPathInside`(H-7, security.test 9케이스)·`isSystemPath`(initialize-project.test)·`getProjectHash`(phase13-8-b)·`toCanonical`(P28-1) 전부 동작까지 게이트됨. **`getDirSizeMB`만 fs-의존 비-순수로 미커버(L-20 — get-setup-context fixture 테스트 페이즈 후보).**
- `src/indexer/metrics-calculator.ts` — TS-AST CC(`CC — TypeScript AST path unchanged`)·tree-sitter CC 본체(Rust/Go/Java/Python/TS 실파스 12 `it` — operator 디스앰비규에이션·`switch_label` 가드·strings/comments 미카운트·`default`/`else` 미카운트) 전수 게이트. **단 `calculateCyclomaticComplexityTreeSitter` null/undefined·빈-dp 가드는 직접 단언 없음(전부 `1` 반환 — M-1 v29/P32-1로 보강 예정).**
- `src/server/tools/_utils.ts` — `requireEngine`(H-1)·`mergeResultsRRF`(P26-1)·`escapeXml`/`escapeDot`(P27-1) 3개 export 순수 함수 100% 커버.
- `src/graph/graph-engine.ts` — `fisherYatesShuffle`(P14-4)·`mulberry32`·`parseClusterSeed`·`parseClusterMaxNodes`(P29-1) export 순수 함수 4종 전부 직접 게이트.
- `src/graph/*`(나머지) — architecture(P22-1)·optimization(P23-2)·remediation(P23-1)·policy-discoverer(P24-1)·refactoring getRiskProfile(P23-3)+proposeRefactor(P25-1) 처방 엔진 5종 진입 전수 게이트.
- `src/indexer/language-registry.ts` — `getProvider()` 정상 매핑·case-insensitivity·**무-확장자/미지/dotfile/trailing-dot/multi-dot 엣지케이스(P31-1)** 전수 게이트. native grammar 로드 실패 graceful degrade 정상.
- `src/server/resource-provider.ts`·`prompt-provider.ts` — MCP resource 4 URI·prompt 3개 커버, Unknown McpError 경로 포함. 음성 불변.
- `src/server/tool-dispatcher.ts` — 20개 도구 스키마 `required ⊆ properties` 불변식 무결. 음성 불변(독립 export 부재로 (b) 미충족).
- `src/server/tools/*.ts` — `qualified_name` 10개 전수 strict 가드 정합. `search-symbols`/`get-related-tests` strict 가드 확인.
- `src/watcher/file-watcher.ts` — chokidar `ignored`·확장자 allowlist·flush 동시성·타이머 위생·재시도/FATAL 강등(P20-1) 정상.
- `src/indexer/update-pipeline.ts` — 단일 책임·catch log-and-rethrow+롤백. `getProvider()`/`toCanonical` 호출은 P31-1/P28-1 게이트의 다운스트림(인덱싱 핫패스). CC 측정(`calculateCyclomaticComplexityTreeSitter`) 호출은 M-1 v29 게이트의 다운스트림.
- `src/server/ipc-coordinator.ts` — challenge-response 인증·1MB 제한·per-tool 타임아웃·keepalive(unref) 견고.
- `package.json` overrides — tree-sitter `^0.25.0`·postcss·vite `^8.0.16`(L-15), better-sqlite3 12.11.1(P27-2), express 4.22.2(P28-2), zod 4.4.3(P30-1), vitest 4.1.9(P30-1). dev·prod audit 0/0. within-pin 드리프트 0.
- `.github/workflows/ci.yml` — Node 22/24 매트릭스 + `npm audit --omit=dev --audit-level=high`(P14-1) + `npm ci`. (cynapx-autonomous.yml은 진단 범위 외.)
- in-tree 에이전트 설정: `.claude/launch.json` 1개(양성), `.cursor`/`.gemini` 부재, in-tree binding.gyp **0개**(L-2 미도달 재확인).
- 신규 prod 코드: `git log dfb9dd5` = 테스트-게이트/lockfile/문서 커밋만 — 신규 도구/엔드포인트/유틸 **0건**.
- TODO/FIXME/XXX/HACK = 0건(`src/` 전수).

---

## 8. 권장 수정 순서 (Phase 32 제안 — 상세는 phase32-plan.md)

**Phase 31 이후 Cynapx는 *깊은 steady-state*다 — *내부 순수 함수 게이트 발굴 사이클*이 레이어별로 소진됐고(graph/ 엔진 진입+시딩·핸들러 가드·`_utils.ts`·`paths.ts`·`getProvider`), lockfile 위생(prod-dep·within-pin)도 비어 있다.** 본 사이클은 phase31-plan §4-5가 명시한 **외부-트리거-only 포스처**의 두 번째 실행이며 — phase32-task가 지목한 *세 후보를 회의적으로 재검토*한 결과: **(1) 신규 prod 코드 0**(`git log dfb9dd5`), **(2) paths.ts 형제는 이미 전수 게이트**(후보 ① 소거, `getDirSizeMB`만 fs-의존 비-순수 L-20), **(3) metrics-calculator null-guard가 *마지막 0-의존 순수 함수 후보*로 남아 있었음**(후보 ② — M-1 v29), **(4) 그 외 부분 커버는 기존 추적 항목 외 신규 0**(후보 ③), **(5) 외부 트리거 모두 정적**(MCP SDK v2 미배포·신규 vitest CVE 2건 삼중 미도달·CVE 0/0·캠페인 미도달·#268 open). **따라서 *유일한 actionable은 M-1 v29(metrics-calculator null-guard 게이트)*뿐이다.** CRITICAL/HIGH 0, MEDIUM 1(M-1 v29 — Phase 32-1, 테스트-only), LOW(L-2~L-9 v28 승계 + L-13/L-14/L-19 승계 + L-20/L-21 신규; L-18 [P31-1 해소], L-17 [P30-1 해소], L-11/L-15/L-16 이전 해소). Phase 32는 **metrics-calculator null-guard 게이트(P32-1, 테스트-only) + 추적 갱신**의 *경량 단일-항목 유지보수 사이클*이다.

1. **P32-1 [예정]**: M-1 v29 해소 — `tests/metrics-calculator.test.ts`에 `calculateCyclomaticComplexityTreeSitter()` null/undefined·빈-decisionPoints 가드 describe 추가(`null`→1·`undefined`→1·빈-dp→1). 의존 0, 테스트-only, prod 코드 무변경. 추가 후 `npx vitest run` 그린(678 → 대략 +2~3)·`npx tsc --noEmit` 그린·`npm audit` 0·`npm audit --omit=dev` 0 재확인.
2. **추적 상태 갱신**: L-2(Miasma/Phantom Gyp 도달 0 불변), L-3(SDK v2 *여전히 pre-alpha* — 2026-07-28 스펙 publish 전후 2.x dist-tag 재확인 = 1순위 외부 트리거), L-6(node-tree-sitter#268 open), L-7/L-8 게이트 공백, L-9 잔여 클린업, L-13(analyze-impact use_cache 무해), L-14(CVE-2026-25727 미도달), L-19(CVE-2026-6991 zod CUID 미도달), L-20(`getDirSizeMB` fs-의존 비-순수), L-21(vitest CVE 2건 삼중 미도달) 현 상태를 다음 사이클 출발점으로 고정. **L-18(getProvider 엣지케이스)은 P31-1 해소 종료. L-17/L-11/L-15/L-16 해소 종료 유지.**

(L-4 IPC MessagePack 계속 보류, L-5 클러스터링 본격 파티셔닝 계속 이연, MCP 전면 stateless/task 마이그레이션은 SDK v2 stable까지 이연, SCIP export·get-setup-context fixture 테스트는 전략 후보로 기록만.)

> **깊은 steady-state 및 향후 사이클 안내**: Phase 26~31이 핸들러 보조·공통 유틸·graph 엔진 시딩·indexer 확장자 매핑 순수 함수 레이어 + lockfile 위생을 마무리했고 — **Phase 32는 *0-의존 순수 함수 게이트 발굴 사이클의 마지막 후보인 metrics-calculator null-guard*를 처리한다(M-1 v29 → P32-1).** 이로써 *모든 비-TS 함수 인덱싱이 의존하는 CC 측정 함수의 방어적 null-guard*까지 게이트되어 **0-의존 순수 함수 게이트 발굴이 완전 소진**된다. **따라서 Phase 32 이후 사이클은 *전적으로 외부-트리거 기반*이다**: (1) 새 도구/엔진/핸들러/유틸 추가 시의 신규 게이트, (2) 공급망 위생(prod audit·lockfile 드리프트) 정기 점검 + 신규 CVE 도달성 삼축 판정, (3) **MCP SDK v2 stable 전환(L-3, 2026-07-28 스펙 publish 전후 — *다음 사이클의 1순위*)**·node-tree-sitter#268 해소(L-6)·tree-sitter-c-sharp 0.23.6+ 같은 *외부 상태 변화* 항목. phase32-plan은 이 *외부-트리거-only 포스처*(외부 트리거 체크리스트·유지보수 포스처)를 운영 지침으로 명시한다. **특히 다음 사이클은 MCP SDK v2 spec publish 일자(2026-07-28)와 정면으로 맞물려 — v2 stable/2.x dist-tag 출현 시 L-3가 즉시 actionable화하므로, *그 재확인이 다음 사이클의 1순위 외부 트리거*다.**
