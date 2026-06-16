# Cynapx 정밀 진단 보고서 v28

- **기준 커밋**: `8b4d68f` (Phase 30 + Phase 30-1 완료 — `npm update`로 within-pin lockfile 드리프트 3건 정렬(P30-1, `zod` 4.3.6→4.4.3[prod-dep, 핀-내 minor]·`@types/node` 20.19.33→20.19.43·`vitest` 4.1.2→4.1.9[dev-dep, 핀-내 patch], lockfile-only·핀 무변경), 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-16
- **진단 범위**: src/ 전체(server, db, indexer, graph, watcher, utils, cli, bootstrap) + **유지보수-모드 포커스 진단(외부-트리거-only 포스처 도래 후 첫 사이클)**. diagnostic-v27 §8 + phase29-plan §4-5 + phase30-plan §4-5가 명시한 대로 *내부 순수 함수 게이트 발굴 사이클은 소진*됐고(graph/ 엔진 진입~P25-1·시딩/env-파싱~P29-1, 핸들러 strict 가드~P26-2, `_utils.ts` export 순수 함수~P27-1, `paths.ts` `toCanonical`~P28-1), *prod-dep lockfile 정렬*도 P28-2(express)로, *within-pin 드리프트*도 P30-1(M-1 v27)로 닫혀 **lockfile 위생도 steady-state에 도달**했다. 따라서 본 사이클은 phase30-plan §4-5가 명시한 **외부-트리거 기반 유지보수 포스처**의 첫 실행이다: (1) *targeted 내부 재검토*(신규 prod 코드 0 확인 + **L-18 `getProvider` 확장자 엣지케이스가 — 모든 상위 내부 각도가 소진된 지금 — *마지막 남은 내부 actionable*로 승격할 가치가 있는지 재판정**), (2) *외부 컨텍스트 재스캔*(MCP SDK v2 npm 배포 상태[**2026-07-28 스펙 publish 한 달여 앞 — 핵심 트리거**], CVE/advisory[**신규 CVE-2026-6991 zod CUID 핸들러 — Cynapx 도달성 정밀 판정**], Miasma/Phantom Gyp 캠페인, node-tree-sitter#268).
- **진단 방법**: 단일 에이전트 오케스트레이션 + 회의적 코드 리뷰(유지보수-모드 targeted) + 로컬 직접 검증(`npx vitest run`[케이스 수·시간], `npx tsc --noEmit`, `npm audit`[dev 포함]·`npm audit --omit=dev`, `npm ls express better-sqlite3 vite @modelcontextprotocol/sdk zod`·`npm outdated`로 버전 드리프트 확인, `npm view`로 npm 레지스트리 직접 조회[@modelcontextprotocol/sdk dist-tags·versions·time.modified, better-sqlite3 dist-tags]) + **`git log 8b4d68f --oneline`로 신규 prod 코드 부재 실측**(= P28~P30 테스트-게이트/lockfile/문서 커밋만, 신규 도구/엔드포인트/유틸 0) + **L-18 엣지케이스 6종 `npx tsx` 재실측**(무-확장자·미지·dotfile·trailing-dot·multi-dot·case-insensitive 결정적 출력 확정) + **CVE-2026-6991 zod 도달성 정밀 실측**(`grep -rn 'cuid' src/` = 0 + `npm ls zod` = 4.4.3 + api-server.ts zod 스키마 전수 점검) + 외부 웹 재조사(MCP SDK v2 배포 상태·zod/better-sqlite3/express/vite/tree-sitter/chokidar CVE·Miasma/Phantom Gyp 캠페인·node-tree-sitter#268).
- **현재 상태(직접 검증)**: `npx vitest run` **672/672**(47 파일, **6.16s** — P30-1은 lockfile-only라 케이스 수 불변 672), `npx tsc --noEmit` 그린, **`npm audit`(dev 포함) = 0 vulnerabilities**, **`npm audit --omit=dev`(prod) = 0 vulnerabilities**. diagnostic-v27 전 항목 처리 완료(M-1 v27 [DONE — P30-1]), LOW 승계 추적.

> **요약**: **이 사이클은 *외부-트리거-only 포스처 도래 후 첫 유지보수 사이클*이다 — 그리고 phase30-plan §4-5가 예고한 대로 *내부 actionable은 단 1건(L-18 승격)*, *외부는 모두 정적*이다.** **(1) 신규 prod 코드 0**: `git log 8b4d68f --oneline` = `8b4d68f`(P30-1 lockfile)·`6033f3a`(phase30 docs)·`a71d916`(P29-1 게이트)·`38c1e54`(phase29 docs)·`5a77e9b`(P28 게이트+lockfile) — *전부 테스트-게이트/lockfile/문서 커밋*이며 신규 MCP 도구·REST 엔드포인트·유틸 함수는 **0건**(게이트할 신규 prod 표면 없음). **(2) 내부 순수 함수 게이트 발굴 소진 재확인 + 마지막 후보(L-18) 승격**: graph/ 엔진(진입+시딩)·핸들러 strict 가드·`_utils.ts`·`paths.ts`가 *모두* 직접 게이트됐고 — 남은 유일한 내부 후보는 L-18(`getProvider` 확장자 엣지케이스 게이트 공백)이다. **v26/v27은 "더 우선순위 높은 내부 항목(graph 시딩 게이트 M-1 v26 → lockfile 정렬 M-1 v27)이 존재"해 L-18을 *비-actionable 추적*으로 남겼으나 — 그 상위 항목들이 *모두 소진(P29-1·P30-1 완료)*된 지금, L-18이 *자연스러운 다음 후보*다.** L-18은 **(a) `src/indexer/language-registry.ts`의 `getProvider()` — *모든 파일 인덱싱 연산에서 호출되는 확장자→언어 매핑 함수*(라이브 핫패스)의 **(b) 0-의존 순수 결정 로직**(`filePath.split('.').pop()?.toLowerCase()`)의 엣지케이스가 직접 단언되지 않는 게이트 공백**이다. **이는 M-1 v23~v26과 *동형의 "라이브 핫패스 뒤 0-의존 순수 함수 미커버 게이트"*이며 — 본 사이클에서 *마지막 남은 내부 actionable로 승격*해 M-1 v28(Phase 31-1)로 처리한다.** **(b) 잣대 충족**: (1) prod 코드 무변경(테스트-only — `tests/language-registry.test.ts`에 엣지케이스 describe 추가); (2) *의존 0 — 5~6개 결정적 케이스, 한 파일*(`getProvider`는 파일경로 문자열 in → provider/undefined out, 엣지케이스는 전부 *동기·side-effect-free*한 `undefined` 또는 *이미 게이트된* 정상 매핑); (3) M-1 v23(mergeResultsRRF)·M-1 v25(toCanonical)·M-1 v26(mulberry32)과 *동형의 0-의존 순수 함수 게이트*. **직접 실행(`npx tsx`)으로 재확정한 결정적 동작**: `Makefile`→`undefined`(무-확장자: `pop()`='makefile' 미지 ext), `foo.xyz`→`undefined`(미지 ext), `.gitignore`→`undefined`(dotfile: `pop()`='gitignore' 미지 ext), `foo.`→`undefined`(trailing-dot: `pop()`='' → `!ext` early-return 113줄), `a.b.py`→python(multi-dot: 마지막 컴포넌트가 언어 결정), `Widget.PY`/`Main.TS`→python/typescript(case-insensitive — *이미 게이트됨* 113줄, 검증·보강). **(3) 외부 모두 정적이되 신규 CVE 1건 도달성 정밀 판정**: prod·dev `npm audit` 0/0, MCP SDK v2 *여전히 pre-alpha*(npm `dist-tags` = `{ latest: '1.29.0' }` 직접 재확인 — **2.x dist-tag 부재**[`next`/`rc`/`alpha`/`beta` 모두 없음, v2 `2.0.0-alpha.x`는 npm `versions` 배열엔 존재하나 *어떤 dist-tag도 가리키지 않음*], time.modified 2026-06-04 불변, stable Q3 2026[스펙 publish 2026-07-28 — *한 달여 앞이나 아직 미래*]), **신규 CVE-2026-6991(zod CUID 핸들러 SQL injection, CVSS 4.0 5.3 / 3.1 6.3 MEDIUM, *zod ≤ 4.3.6* 영향) — *Cynapx 미도달 이중 확인*: ① Cynapx zod는 P30-1로 **4.4.3**(영향 범위 ≤4.3.6 *밖* — P30-1의 `zod` 4.3.6→4.4.3 정렬이 *우연히 본 CVE 범위를 벗어남*, audit 0 불변), ② Cynapx는 `.cuid()`/`.cuid2()` 검증 *미사용*(`grep -rn 'cuid' src/` = 0; api-server.ts zod 스키마는 `z.string()`/`z.number()`/`z.enum()`/`z.object()`만 — CUID 데이터타입 핸들러 *경로 자체 미도달*) → **버전·기능 양면으로 미도달**(L-19 신규 추적)**, better-sqlite3 12.11.1 직접 CVE/하이재킹 0건(npm `dist-tags.latest = 12.11.1`·악성 dist-tag 부재), Miasma/Phantom Gyp 캠페인 여전히 활발(57패키지/286악성버전·liuende501 GitHub dead-drop·`.claude`/Cursor/Gemini persistence 주입)하나 *Cynapx 트리 미도달 재확인*(in-tree binding.gyp **0개**·컴프로마이즈 패키지 not in tree·`.claude/launch.json` 1개 양성·`.cursor`/`.gemini` 부재 — L-2 불변), node-tree-sitter#268 여전히 open(L-6 불변). **이로써 *내부 게이트 발굴이 소진되고 외부 트리거가 모두 정적인* 깊은 steady-state에서 — 유일하게 남은 내부 actionable인 L-18을 M-1 v28로 승격*한다(외부-트리거-only 포스처가 도래했으나 *내부 게이트 발굴의 마지막 한 후보가 남아 있었음*).** **신규 M-2 v28 후보 검토 → *없음***: 내부 신규 게이트 후보 0(L-18 승격 후 소진 완료), 외부 신규 actionable CVE/advisory 0(CVE-2026-6991은 버전·기능 양면 미도달, audit 0/0), MCP SDK v2 미배포(L-3 이연 불변), lockfile 드리프트 0(within-pin 모두 P30-1 정렬·major는 핀 변경 수반 비권장). **CRITICAL 0, HIGH 0, MEDIUM 1(M-1 v28 L-18 승격 — `getProvider` 확장자 엣지케이스 게이트, Phase 31-1, 테스트-only), LOW(L-2~L-9 v27 승계 + L-13/L-14 승계 + L-19 신규[CVE-2026-6991 zod CUID 버전·기능 양면 미도달, 비-actionable 추적] ; L-18은 M-1 v28로 승격되어 처리 → 추적 종료 예정 ; L-17 [P30-1 해소], L-11/L-15/L-16 이전 해소).**

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건은 Phase 13에서, v11 HIGH(공급망)는 Phase 14-1에서, v12~v18 MEDIUM은 Phase 15~21에서, v19 MEDIUM은 Phase 22-1에서, v20 MEDIUM 2건+L-10 부분은 Phase 23에서, v21 MEDIUM 2건+L-12는 Phase 24에서, v22 MEDIUM 2건은 Phase 25에서, v23 MEDIUM 2건은 Phase 26에서, v24 MEDIUM 2건은 Phase 27에서, v25 MEDIUM 2건은 Phase 28에서, v26 MEDIUM 1건은 Phase 29에서, v27 MEDIUM 1건은 Phase 30에서 해소됐고, 본 유지보수-모드 재열람에서 새로운 CRITICAL/HIGH는 없다. IPC 핸드셰이크(challenge + HMAC-SHA256 + timingSafeEqual)·API Bearer(SHA-256 + timingSafeEqual)·세션 맵(TTL+cap+sweep unref) 모두 견고(직접 재열람).

---

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** 코드·공급망 어디에서도 신규 HIGH 없음. **prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0**(직접 재검증). 신규 prod 코드 0(`git log 8b4d68f` = 테스트-게이트/lockfile/문서 커밋만)이라 신규 결함 표면 자체가 없다. M-1 v28(L-18 `getProvider` 엣지케이스 게이트)은 MEDIUM이다 — *게이트 공백(보안·크래시 결함 아님, 엣지케이스 결정성 미커버)*이며 prod 동작 무변경(테스트-only). **신규 외부 CVE-2026-6991(zod CUID SQL injection, ≤4.3.6)도 Cynapx 미도달이라 LOW(L-19)**: ① Cynapx zod 4.4.3(P30-1 정렬 — 영향 범위 ≤4.3.6 밖), ② `.cuid()`/`.cuid2()` 미사용(CUID 핸들러 경로 미도달) → 버전·기능 양면 미도달, audit 0 불변. CVE-2026-25727(`time` 크레이트)도 Cynapx prod 트리 미도달(L-14 불변). Miasma/Phantom Gyp 캠페인도 Cynapx 트리 미도달(L-2 불변). better-sqlite3 12.11.1은 npm `latest`·악성 dist-tag 부재로 *하이재킹 미도달*(L-2 불변).

---

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

| # | 위치 | 내용 |
|---|------|------|
| **M-1 v28** *(신규, actionable — L-18 승격. `LanguageRegistry.getProvider()` 확장자 엣지케이스 게이트. 모든 상위 내부 각도(graph 시딩 게이트·lockfile 정렬)가 소진된 지금 *마지막 남은 내부 actionable*)* **[예정 — Phase 31-1]** | `src/indexer/language-registry.ts:111-136`(`getProvider()` — `filePath.split('.').pop()?.toLowerCase()` 112줄, `if (!ext) return undefined` 113줄, `extensionMap.get(ext)` 120줄), `tests/language-registry.test.ts:90-116`(정상 매핑·case-insensitivity는 직접 게이트, 엣지케이스 미커버) | **`getProvider()`의 확장자 추출 엣지케이스에 회귀 게이트 추가.** `getProvider()`는 *모든 파일 인덱싱 연산에서 호출되는 확장자→언어 매핑 함수*(라이브 핫패스 — update-pipeline·worker-pool·file-watcher가 인덱싱할 파일마다 호출)이나, *정상 확장자 매핑*(descriptor별)·*case-insensitivity*(`Main.PY`/`Widget.Hpp`)만 직접 게이트되고 — *무-확장자*·*미지 확장자*·*dotfile*·*trailing-dot*·*multi-dot* 엣지케이스는 단언되지 않는다. 미커버 로직: (a) `split('.').pop()`이 무-확장자(`Makefile`→`'makefile'`)·dotfile(`.gitignore`→`'gitignore'`)에서 *미지 ext 토큰을 반환→`extensionMap` 미스→undefined*, (b) trailing-dot(`foo.`→`pop()`=`''`)에서 *`!ext` early-return*(113줄)→undefined, (c) 미지 확장자(`foo.xyz`)→undefined, (d) multi-dot(`a.b.py`)에서 *마지막 컴포넌트가 언어 결정*→python. **직접 실행(`npx tsx`)으로 재확정한 결정적 동작**: `Makefile`→`undefined`, `foo.xyz`→`undefined`, `.gitignore`→`undefined`, `foo.`→`undefined`, `a.b.py`→python, `src/dir.with.dot/a.b.py`→python(경로-내 dot 무관, 마지막 컴포넌트 우선), `Widget.PY`→python·`Main.TS`→typescript(case-insensitive — *이미 113줄 게이트*, 검증/보강). **승격 근거**: v26은 L-18을 신규 비-actionable로 기록, v27은 *상위 actionable(M-1 v27 lockfile 정렬)이 존재*해 비-actionable로 유지했다. 본 사이클은 *그 상위 항목들이 모두 소진(graph 시딩 게이트 P29-1·lockfile within-pin 정렬 P30-1 완료)*됐고 — *내부 순수 함수 게이트 발굴 사이클의 마지막 한 후보가 L-18*이다. **(b) 잣대 충족**: (1) prod 코드 무변경(테스트-only — `language-registry.test.ts`의 `LanguageRegistry` describe에 엣지케이스 케이스 추가); (2) *의존 0 — 5~6개 결정적 케이스, 한 파일*(파일경로 문자열 in → provider/undefined out; undefined-반환 케이스는 *동기·side-effect-free*, 정상 매핑 케이스는 *이미 게이트된* 경로의 재확인); (3) M-1 v23(`mergeResultsRRF`)·M-1 v25(`toCanonical`)·M-1 v26(`mulberry32`)과 *동형의 0-의존 순수 함수 게이트*이되 *indexer 확장자 매핑 레이어*를 덮는다. **이로써 *모든 파일 인덱싱이 의존하는* 확장자→언어 결정 로직의 엣지케이스(무-확장자·미지·dotfile·trailing-dot·multi-dot)에 회귀 안전망을 친다** — `split('.').pop()`/`!ext` 가드 회귀(예: trailing-dot 처리 오타·미지-ext fallthrough)가 *정상 매핑 직접 테스트를 우회로* 슬립할 수 있으나(정상 테스트는 *유효 ext만* 단언), 엣지케이스 고정값 단언은 그 회귀를 결정적으로 잡는다. **verdict: actionable — Phase 31-1.** (5장 상세) |

> **참고(M-2 v28 부재 근거 + 외부-트리거-only 포스처 첫 사이클 명시)**: 본 사이클은 *외부-트리거-only 포스처 도래 후 첫 유지보수 사이클*이다. **(a) 내부 신규 게이트 후보 0(L-18 승격 후 소진 완료)**: `git log 8b4d68f`가 신규 prod 코드 0(테스트-게이트/lockfile/문서 커밋만)임을 확인했고, 내부 순수 함수 게이트 발굴은 graph/ 엔진 진입+시딩·핸들러 가드·`_utils.ts`·`paths.ts` 전수에 더해 *마지막 후보 L-18(`getProvider`)을 M-1 v28로 승격*함으로써 *완전히 소진*된다(이후는 신규 도구/엔진/유틸 추가 시에만 확장). **(b) 외부 신규 actionable CVE/advisory 0**: prod·dev audit 0/0, MCP SDK v2 미배포(L-3 이연), **신규 CVE-2026-6991(zod CUID)은 버전(4.4.3 ≥ 영향 ≤4.3.6 상한 초과)·기능(`.cuid()` 미사용) 양면 미도달**(L-19 추적), better-sqlite3/express/vite/tree-sitter/chokidar 직접 CVE 0, Miasma/Phantom Gyp 미도달. (c) lockfile 드리프트 0(within-pin 전량 P30-1 정렬, major는 핀 변경 수반 비권장). 따라서 *유일한 actionable은 M-1 v28(L-18 승격)*뿐이며 — 이는 phase30-plan §4-5가 명시한 *"외부-트리거-only 포스처"의 첫 실행*이되, *내부 게이트 발굴의 마지막 후보가 마침 남아 있었던* 사이클이다.

---

## 4. 최적화 (LOW) — 추적/이연 (v27 승계; L-18 → M-1 v28 승격; L-19 신규; L-17/L-11/L-15/L-16 해소)

| # | 위치 | 내용 |
|---|------|------|
| L-2(v28) | `package.json` (native deps), CI / Dockerfile, `.claude/` 설정 | **Miasma / Phantom Gyp / Node-gyp 공급망 캠페인 포스처 추적 — Cynapx 도달 0건 불변(재확인).** 진단 일자 직접 재대조: 캠페인은 *여전히 활발*(@redhat-cloud-services 32패키지[06-01]·@vapi-ai/server-sdk 4버전[06-03] → 57패키지/286악성버전, 157-byte binding.gyp 남용 self-propagating worm — preinstall/postinstall 대신 binding.gyp가 `npm install` 중 node-gyp 코드 실행을 트리거해 install-script 보안 검사 우회; Bun 런타임 다운로드·CI/CD·클라우드 자격증명 탈취·GitHub dead-drop[liuende501 계정 236 repo]·`.claude`/Cursor/Gemini 설정에 persistence 주입; Microsoft GitHub 73개 repo 영향 보고)이나 — *in-tree binding.gyp **0개***(`find . -name binding.gyp -not -path "*/node_modules/*"` = 0), 컴프로마이즈 패키지(@redhat-cloud-services·@vapi-ai/server-sdk·ai-sdk-ollama·jagreehal 패키지군) *not in tree*, in-tree 에이전트 설정은 `.claude/launch.json` 1개(양성), `.cursor`/`.gemini` 부재. native 의존(better-sqlite3 12.11.1 + tree-sitter 0.25.0 + 12 grammar) 무관·악성 버전 미발행. CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지 1차 방어선 유지. **즉각 조치 불필요 — 추적만.** 출처: [StepSecurity Miasma](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm), [Chainguard Miasma](https://www.chainguard.dev/unchained/chainguard-artifacts-safe-from-miasma-phantom-gyp-npm-attack), [Wiz Miasma](https://www.wiz.io/blog/miasma-supply-chain-attack-targeting-redhat-npm-packages), [OX Security Miasma](https://www.ox.security/blog/600000-monthly-downloads-affected-miasma-supply-chain-attack-is-back-on-npm/) |
| L-3(v28) | `src/server/api-server.ts` (session-id StreamableHTTP), `package.json:29`(`@modelcontextprotocol/sdk ^1.29.0`) | **MCP SDK v2 — *여전히 pre-alpha*(상태 불변, npm 레지스트리 직접 재확인).** `npm view @modelcontextprotocol/sdk dist-tags versions time.modified` 직접 실행: `dist-tags = { latest: '1.29.0' }` — **2.x dist-tag 부재**(`next`/`rc`/`alpha`/`beta` *어떤 dist-tag도 2.x를 가리키지 않음*; `2.0.0-alpha.2`는 npm `versions` 배열엔 존재[약 2개월 전 publish]하나 *dist-tag로 노출되지 않아* `npm install @modelcontextprotocol/sdk`는 여전히 1.29.0 설치)·`time.modified = '2026-06-04T19:46:40Z'`(불변). v2는 main 브랜치에서 pre-alpha 개발 중·**stable은 Q3 2026**(스펙 publish 2026-07-28 — *오늘 2026-06-16 기준 한 달여 앞이나 아직 미래*) 예정, v1.x가 production 권장·v2 출시 후 최소 6개월 v1.x 보안/버그 수정 지속. → Cynapx 핀 `^1.29.0` 유지가 옳음. stateless protocol core(SEP-2567 session-id 제거)·Multi-Round-Trip·MCP Apps 마이그레이션은 **v2 stable 전환까지 계속 이연**. P15-3 `handleMcp()` 설계 메모가 출발점. **다음 사이클(2026-07-28 전후)에 v2 stable/2.x dist-tag 출현 재확인이 핵심 외부 트리거.** 출처: [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk), [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases), [typescript-sdk repo](https://github.com/modelcontextprotocol/typescript-sdk) |
| L-4(v28) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환. **성능 문제 미관측 — 계속 보류.** 메시지가 작고 round-trip이 드물어 직렬화 병목 아님 |
| L-5(v28) | `src/graph/graph-engine.ts` | 클러스터링 본격 서브그래프 파티셔닝 — 100k+ 노드 실측 시 재검토(**계속 이연**). LPA O(V+E)·`MAX_ITER=20` 캡·count-first 가드(200k, `parseClusterMaxNodes`)·Fisher-Yates seeded PRNG(`mulberry32`) 직접 재확인 — OOM/편향 방어 정상. **시딩/캡 프리미티브의 순수 함수 동작은 P29-1로 게이트 완료(파티셔닝 자체는 계속 이연).** |
| L-6(v28) | CI / Dockerfile | Node 24 + tree-sitter 0.25.x 빌드 fragility([node-tree-sitter#268] / [salesforce/agentscript#7: C++20 미설정] 여전히 open·미해결, CVE 아님 — 진단 일자 재확인). CI Node 22/24 매트릭스 그린이나 Node 24 LTS 전환 전 prebuild 재확인. **추적만** 출처: [node-tree-sitter#268](https://github.com/tree-sitter/node-tree-sitter/issues/268), [salesforce/agentscript#7](https://github.com/salesforce/agentscript/issues/7) |
| L-7(v28) | `src/cli/admin.ts` (cmd* 9개), `tests/admin-cli.test.ts` | **admin CLI 명령 동작의 vitest 게이트 공백 — 비-actionable 추적.** 등록 명령 9개 `cmd*`는 모듈-private(미-export)이라 vitest 직접 호출 불가. **admin.ts 핸들러 export 리팩터 시 함께 게이트화 후보** |
| L-8(v28) | `src/indexer/worker-pool.ts`, `embedding-manager.ts`, `db/database.ts` | **에러-복구·마이그레이션 잔여 분기의 vitest 게이트 공백 — 비-actionable 추적.** worker `worker.on('error')`·queue backpressure·embedding A-7 stale supersedence 레이스·DB migration 잔여 분기는 직접 미검증이나 인접 분기 커버 + 타이밍-flaky 위험. **SCHEMA_VERSION 증분/worker-pool 리팩터 시 함께** |
| L-9(v28) | `src/indexer/update-pipeline.ts` (트랜잭션 보일러플레이트·progress `log.error`), `embedding-manager.ts:184`/`api-server.ts:625` (빈 catch) | **L-9 코드 클린업 잔여 — (b) 잣대 미충족, 비-actionable 추적.** `withWriteTransaction()` 추출은 트랜잭션 경계 5곳 재작성이라 회귀 표면 넓음; 빈 catch 2건은 의도적 silent-drop 방어. **update-pipeline 리팩터 페이즈로 묶어 처리 후보** |
| **L-13(v28)** *(승계 — analyze-impact use_cache 스키마-default 미강제, 무해)* | `src/server/tools/analyze-impact.ts:23` (`useCache: args.use_cache` 무검증·default 미강제) | **`analyze-impact` 핸들러가 `use_cache`(스키마 default `true`)를 검증·default-강제 없이 그대로 `traverse({useCache: args.use_cache})`에 전달 — 무해.** `args.use_cache`가 `undefined`면 traverse 내부 truthy 평가에서 캐시 *비활성*으로 동작(스키마 default `true`와 어긋날 수 있으나 *느려질 뿐* 정확성·크래시 영향 0). 동형 무해 패턴이 `export-graph`·`get-symbol-details`에도 존재 — 전부 다운스트림 undefined-안전. **verdict: 추적만(비-actionable)** |
| **L-14(v28)** *(승계 — CVE-2026-25727 `time` 크레이트, Cynapx 미도달 불변)* | (외부 — Rust `time` crate via tree-sitter Rust 생태계 언급), Cynapx prod 트리 무관 | **CVE-2026-25727(RFC 2822 파싱 스택 소진 DoS, `time` 크레이트 0.3.6~<0.3.47)은 *tree-sitter*로 거론되나 실제로는 Rust `time` 크레이트 결함 — Cynapx prod 트리 미도달 불변.** 본 CVE는 tree-sitter npm 바인딩/그래머가 아니라 Rust `time` 크레이트의 RFC 2822 날짜 파싱에 있고, Cynapx의 의존 표면(npm tree-sitter 0.25.0 + 12 grammar)에 `time` 크레이트는 부재 → **prod·dev 미도달, audit 0/0 불변.** tree-sitter Rust 생태계 모니터링 신호로 추적. **verdict: 추적만(비-actionable — 미도달)** 출처: [NVD CVE-2026-25727](https://nvd.nist.gov/vuln/detail/CVE-2026-25727) |
| **L-19(v28)** *(신규 — CVE-2026-6991 zod CUID 핸들러 SQL injection, Cynapx 버전·기능 양면 미도달)* | (외부 — zod ≤ 4.3.6 `packages/zod/src/v4/core/regexes.ts` CUID 데이터타입 핸들러), Cynapx: `package-lock.json`(zod 4.4.3)·`src/server/api-server.ts`(zod 스키마, `.cuid()` 미사용) | **CVE-2026-6991(zod CUID 핸들러 SQL injection, CVSS 4.0 5.3 / 3.1 6.3 MEDIUM, 영향 *zod ≤ 4.3.6*)은 Cynapx 미도달 — *버전·기능 양면 확인*.** 본 CVE는 zod의 CUID 검증 정규식(`regexes.ts`)이 SQL-의미 특수문자를 충분히 중화하지 않아 — *검증 통과 값을 그대로 DB에 바인딩하면* SQL injection 가능. **Cynapx 도달성 이중 음성**: ① **버전 — Cynapx zod = 4.4.3**(P30-1의 `zod` 4.3.6→4.4.3 정렬이 *우연히 영향 범위 ≤4.3.6 상한을 초과* — `npm ls zod` = `zod@4.4.3`[top-level·MCP SDK·zod-to-json-schema 전부 deduped], `npm audit` 0 불변[GitHub advisory가 4.4.3을 not-affected로 처리]), ② **기능 — Cynapx는 `.cuid()`/`.cuid2()` 미사용**(`grep -rn 'cuid' src/` = 0; `api-server.ts` zod 스키마는 `z.string().min(1)`/`z.number().int().positive()`/`z.enum([...])`/`z.object({...})`만 — *CUID 데이터타입 핸들러 경로 자체에 도달하지 않음*). 게다가 ③ Cynapx는 *parameterized statement*(better-sqlite3 prepared)만 사용해 zod 검증 값을 *문자열 보간*하지 않는다(SQL injection 2차 방어). → **버전·기능·바인딩 삼중 미도달, audit 0 불변.** zod 생태계 모니터링 신호로 추적. **verdict: 추적만(비-actionable — 미도달)** 출처: [SentinelOne CVE-2026-6991](https://www.sentinelone.com/vulnerability-database/cve-2026-6991/), [CIRCL Vulnerability-Lookup](https://vulnerability.circl.lu/vuln/cve-2026-6991), [Snyk zod](https://security.snyk.io/package/npm/zod) |

> **L-18 승격 안내**: diagnostic-v26 신규/diagnostic-v27 승계 L-18(`LanguageRegistry.getProvider()` 확장자 엣지케이스 직접 테스트 공백, 비-actionable 추적)은 **본 사이클에서 M-1 v28로 승격**됐다 — *모든 상위 내부 각도(graph 시딩 게이트 M-1 v26 → lockfile within-pin 정렬 M-1 v27)가 소진된 지금* `getProvider` 엣지케이스 게이트가 *유일하게 남은 내부 actionable*이기 때문이다(*모든 파일 인덱싱이 의존하는* 확장자→언어 매핑 함수의 0-의존 순수 결정 로직). Phase 31-1 완료 시 L-18 추적 종료. **L-17(within-pin lockfile)은 P30-1에서, L-16(express)은 P28-2에서, L-11(better-sqlite3)·L-15(vite)는 이전 사이클에서 이미 해소 — 추적 종료 유지.**

> **신규 LOW 부재 안내(prod 코드 동작 변경)**: M-1 v28(L-18 승격, 테스트-only)을 제외하면 prod 코드 *동작* 변경을 요하는 신규 LOW는 0건이다(신규 prod 코드 자체가 0 — `git log 8b4d68f`). L-13/L-14/L-19는 무해·미도달 추적, L-18은 테스트-only 게이트 공백(M-1 v28로 승격)이다.

---

## 5. 코드 품질 / 성능 전수 (유지보수-모드 targeted 재확인 + steady-state 재확인)

v30까지 graph/ 엔진 처방 5종 진입 로직 + 핸들러 보조 핵심 순수 로직(`mergeResultsRRF`·`escapeXml`·`escapeDot`) + `qualified_name` 10개 핸들러 strict 가드 + 공통 유틸 정규화 프리미티브(`toCanonical`) + graph 엔진 시딩/env-파싱 프리미티브(`mulberry32`·`parseClusterSeed`·`parseClusterMaxNodes`)가 전수 게이트/정렬됐고, *prod-dep·within-pin lockfile 드리프트*도 P28-2·P30-1로 0이 됐다. **본 사이클은 유지보수-모드 targeted 재확인**: (1) 신규 prod 코드 부재 실측, (2) 마지막 남은 내부 후보(L-18) 승격 재판정, (3) 외부 트리거 재스캔(신규 CVE-2026-6991 도달성 포함).

**(A) 신규 prod 코드 실측 — `git log 8b4d68f --oneline`(head)**

| 커밋 | 내용 | 분류 |
|------|------|------|
| `8b4d68f` | Phase 30-1: npm update within-pin lockfile alignment (M-1 v27) | lockfile(prod 무변경) |
| `6033f3a` | Phase 30 cycle: diagnostic-v27 + phase30-plan docs | 문서 |
| `a71d916` | Phase 29-1: gate mulberry32/parseClusterSeed/parseClusterMaxNodes (M-1 v26) | 테스트-게이트(prod 무변경) |
| `38c1e54` | Phase 29 cycle: diagnostic-v26 + phase29-plan docs | 문서 |
| `5a77e9b` | Phase 28: gate toCanonical() + express lockfile 4.22.2 | 테스트-게이트 + lockfile |

핵심: 8b4d68f head = *테스트-게이트/lockfile/문서 커밋만*이며 **신규 MCP 도구·REST 엔드포인트·유틸 함수는 0건**. → *게이트할 신규 prod 표면이 없다*(내부 게이트 발굴 소진 재확인).

**(B) 마지막 남은 내부 후보 승격 재판정 — L-18 `getProvider` 확장자 엣지케이스 (→ M-1 v28)**

| 로직 | 코드 | 직접 테스트 | 판정 |
|------|------|------------|------|
| 정상 확장자 매핑 | `getProvider()`(descriptor별) | **커버**(`language-registry.test.ts:90-100`) | 정합 |
| case-insensitivity | `.toLowerCase()`(112줄) | **커버**(`Main.PY`/`Widget.Hpp`, 111-115줄) | 정합(M-1 v28에서 검증/보강) |
| 무-확장자·미지·dotfile·trailing-dot·multi-dot | `split('.').pop()`/`!ext` 엣지(112-113줄) | **미커버**(전부 정확 처리되나 단언 0) | **M-1 v28 — Phase 31-1** |

핵심: 매핑은 *정상 경로·case-insensitivity가 이미 직접 게이트*되고 엣지케이스만 누락(`split('.').pop()`/`!ext` 가드의 결정성). v26은 L-18을 비-actionable로 기록, v27은 *상위 actionable(lockfile 정렬)이 존재*해 비-actionable로 유지했으나 — *그 상위 항목들이 모두 소진된 지금* L-18이 *마지막 남은 내부 actionable로 승격*된다(M-1 v28). **`npx tsx` 재실측(진단 일자)**: `Makefile`→undefined, `foo.xyz`→undefined, `.gitignore`→undefined, `foo.`→undefined, `a.b.py`→python, `src/dir.with.dot/a.b.py`→python, `Widget.PY`→python, `Main.TS`→typescript. → `tests/language-registry.test.ts`의 `LanguageRegistry` describe에 엣지케이스 6종 케이스 추가(테스트-only, 의존 0).

**(C) 의존성 lockfile 드리프트 — within-pin 0(P30-1 완료) + major 비권장 (`npm outdated` 실측)**

| 패키지 | 핀 | Current | Wanted | Latest | 분류 | 판정 |
|--------|-----|---------|--------|--------|------|------|
| `zod` | `^4.3.6`(deps) | 4.4.3 | 4.4.3 | 4.4.3 | prod-dep, 핀-내 정렬됨 | **P30-1 정렬 완료(드리프트 0)** |
| `@types/node` | `^20.12.7`(devDeps) | 20.19.43 | 20.19.43 | 25.9.3 | dev-dep, 핀-내 정렬됨 | **P30-1 정렬 완료(within-pin 0)** |
| `vitest` | `^4.1.2`(devDeps) | 4.1.9 | 4.1.9 | 4.1.9 | dev-dep, 핀-내 정렬됨 | **P30-1 정렬 완료(within-pin 0)** |
| `@types/express`/`express`/`commander`/`typescript`/`@types/node`/`tree-sitter-c-sharp` | — | =Current | =Current | major/핀 외 | major(핀 변경 수반) | 즉시 비권장 |

핵심: `npm outdated` 실측 결과 *Current = Wanted*가 모든 행에서 성립 — **within-pin 드리프트 0**(P30-1이 `zod`/`@types/node`/`vitest`를 정렬, **lockfile 위생도 steady-state 도달**). 잔여는 *전부 major*(@types/express 5·express 5·commander 15·typescript 6·@types/node 25·tree-sitter-c-sharp 0.23.5)로 *핀 변경 수반·즉시 비권장*(`tree-sitter-c-sharp` 0.23.5는 ERR_REQUIRE_ASYNC_MODULE 미해소 → 0.23.1 핀 유지가 옳음). → 본 사이클은 *M-2(actionable 의존성 정렬)가 없다*.

**(D) 신규 외부 CVE 도달성 — CVE-2026-6991 zod CUID (버전·기능 양면 미도달 → L-19)**

| 판정 축 | 실측 | 결론 |
|---------|------|------|
| 버전(영향 ≤4.3.6) | `npm ls zod` = **4.4.3**(P30-1 정렬, top-level·MCP SDK·zod-to-json-schema 전부 deduped) | *영향 범위 밖*(4.4.3 > 4.3.6) — audit 0 불변 |
| 기능(CUID 핸들러) | `grep -rn 'cuid' src/` = **0**; api-server.ts zod = `z.string()`/`z.number()`/`z.enum()`/`z.object()`만 | *CUID 핸들러 경로 미도달* |
| SQL 바인딩(2차 방어) | better-sqlite3 prepared statement만 — zod 값 문자열 보간 0 | *injection 경로 미도달* |

핵심: P30-1의 `zod` 4.3.6→4.4.3 정렬이 *우연히 본 CVE 범위(≤4.3.6)를 벗어났고*, Cynapx는 애초에 `.cuid()`를 *미사용*이며, DB 바인딩도 parameterized라 — **삼중 미도달**(L-19 비-actionable 추적).

**(E) prod steady-state 재확인 — 신규 prod 코드 결함 0**

| 항목 | 판정 |
|------|------|
| god-module / 순환 import | 0 — `openapi.ts`·`update-pipeline.ts`·`graph-engine.ts` 응집 불변. repos→engines→server/pipeline 단방향 |
| TODO/FIXME/XXX/HACK | 0건(`src/` 전수) |
| 핫패스 O(n²)-over-nodes | 0 — 클러스터링 count-first 가드(200k, `parseClusterMaxNodes`)+seeded PRNG(`mulberry32`), BFS index-pointer 큐, 반복 DFS+60s 캐시, architecture-engine O(1) Map(P22-1) |
| prod·dev audit | 0 / 0 vulnerabilities |
| 테스트 | `npx vitest run` **672/672**(47 파일, 6.16s) — 추세 무문제(P30-1 lockfile-only라 케이스 수 불변 672, 시간 머신 변동) |

**(F) 에러 핸들링 일관성 — 양호**

`Logger`(stderr-only, MCP stdio 안전) `normalizeData()` Error 언랩. update-pipeline catch는 log-and-rethrow + 롤백 선행. 미세 항목(progress log.error·빈 catch 2건)은 L-9 비-actionable 추적. `qualified_name` 10개 핸들러 strict 가드 전수 정합(M-2 v22+M-2 v23으로 완성). `search-symbols` `query` strict 가드(P25-2)·`get-related-tests` strict 가드(P26-2) 정렬 확인. `getProvider()`는 native grammar 로드 실패 시 `getLanguage()` try/catch로 graceful degrade(→ undefined, 130-132줄) — 정상.

---

## 6. 외부 컨텍스트 (웹 조사 — 진단 일자 재실행, 출처 명시)

### 6.1 의존성 취약점 (prod·dev 둘 다 clean)

- **`npm audit`(dev 포함) = 0 + `npm audit --omit=dev`(prod) = 0**(둘 다 직접 실행). Phase 21-1 postcss override + vite `^8.0.16` bump(`473acf8` — L-15 해소)가 dev 트리도 clean 유지.
- **`npm ls express better-sqlite3 vite @modelcontextprotocol/sdk zod` + `npm outdated`(직접 실행)**: express **4.22.2**(P28-2 정렬)·better-sqlite3 **12.11.1**(npm `latest`)·vite **8.0.16**·sdk **1.29.0**·**zod 4.4.3**(P30-1 정렬). **within-pin 드리프트 0**(`npm outdated`에서 Current = Wanted 전 행 — P30-1 완료). 잔여 major(@types/express 5·express 5·commander 15·typescript 6·@types/node 25): 즉시 비권장(핀 변경 수반). `tree-sitter-c-sharp` 0.23.1 핀(0.23.5 latest이나 ERR_REQUIRE_ASYNC_MODULE 미해소 → 핀 유지가 옳음).
- **신규 CVE-2026-6991(zod CUID SQL injection, ≤4.3.6) — Cynapx 미도달(L-19)**: ① zod 4.4.3(영향 범위 밖), ② `.cuid()` 미사용, ③ parameterized binding — 삼중 미도달, audit 0 불변. *P30-1의 zod 정렬이 우연히 본 CVE 범위를 벗어난 점은 부수적 이득*(lockfile 위생이 보안 마진으로 작용).
- **better-sqlite3 직접 재확인(npm 레지스트리 + 웹)**: `npm view better-sqlite3 version dist-tags` = `12.11.1`·`{ latest: '12.11.1' }` — **12.11.1이 npm `latest`·악성 dist-tag 부재**로 *정상 릴리스 확인*. *웹 검색의 "node-gyp 캠페인 포함" 일반론은 Snyk vuln-DB의 native-모듈 프레이밍이지 12.11.1 표적 하이재킹이 아님*(L-2 불변). chokidar non-vulnerable, tree-sitter npm 바인딩 직접 CVE 0건(CVE-2026-25727은 Rust `time` 크레이트 — L-14, 미도달), vite advisory `^8.0.16`로 해소(L-15), express 4.22.2 직접 CVE 0건, @modelcontextprotocol/sdk 1.29.0 직접 CVE 0건. 출처: [Snyk better-sqlite3](https://security.snyk.io/package/npm/better-sqlite3), [expressjs releases](https://github.com/expressjs/express/releases), [Snyk zod](https://security.snyk.io/package/npm/zod)

### 6.2 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"` + Docker `node:22-bookworm-slim`. Node 22 LTS 2027-04 종료 — 여유. CI Node 22/24 매트릭스 그린(672/672). 문서 Node 버전(L-12, P24-2 해소)은 README/README_KR/GUIDE_EN/GUIDE_KR 전부 ≥ 22 정렬 유지.
- **tree-sitter 코어**: latest 0.25.0, 12 grammar 전부 dedupe/override. **tree-sitter-c-sharp**: 0.23.1 정확 핀 롤백 유지. Node 24 빌드 C++20 fragility([node-tree-sitter#268]·[salesforce/agentscript#7] 여전히 open·미해결 — 진단 일자 재확인) — L-6 추적.
- **better-sqlite3**: lockfile 12.11.1(npm `latest`, P27-2 정렬 — L-11 해소).
- **express**: lockfile 4.22.2(P28-2 정렬 — L-16 해소).
- **vite**: devDependency `^8.0.16`(L-15 해소).
- **zod**: prod-dep `^4.3.6` → lockfile **4.4.3**(P30-1 정렬 — L-17 within-pin 종료). CVE-2026-6991(≤4.3.6) 영향 범위 밖(L-19).
- **within-pin 드리프트**: **0**(P30-1 완료 — `zod`/`@types/node`/`vitest` 전량 정렬). 매 사이클 `npm outdated`로 누적 모니터링.

### 6.3 공급망 캠페인 — Miasma / Phantom Gyp / Node-gyp (계속 활발, Cynapx 도달 0건 불변)

진단 일자 직접 재대조: 캠페인은 *여전히 활발*(@redhat-cloud-services 32패키지[06-01]·@vapi-ai/server-sdk 4버전[06-03] → 57패키지/286악성버전, 157-byte binding.gyp 남용 self-propagating worm — binding.gyp가 `npm install` 중 node-gyp 코드 실행을 트리거해 대부분의 install-script 보안 검사 우회; Bun 런타임 다운로드·npm/GitHub/AWS/GCP/Azure/Vault/K8s 자격증명 탈취·GitHub dead-drop[liuende501 236 repo]·`.claude`/Cursor/Gemini 설정 persistence 주입·자가전파; Microsoft GitHub 73개 repo 영향 보고). **Cynapx 트리 미도달 재확인**: *in-tree binding.gyp **0개***(직접 `find` 실행), 컴프로마이즈 패키지 *not in tree*(`npm ls` = empty), in-tree 설정은 `.claude/launch.json` 1개(양성)·`.cursor`/`.gemini` 부재. CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지. **즉각 변경 불필요, 포스처 추적.** 출처: [StepSecurity Miasma](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm), [Chainguard Miasma](https://www.chainguard.dev/unchained/chainguard-artifacts-safe-from-miasma-phantom-gyp-npm-attack), [Wiz Miasma](https://www.wiz.io/blog/miasma-supply-chain-attack-targeting-redhat-npm-packages), [Snyk node-gyp compromise](https://snyk.io/blog/node-gyp-supply-chain-compromise-self-propagating-npm-worm-binding-gyp/)

### 6.4 MCP 생태계 — SDK v2 여전히 pre-alpha (상태 불변, npm 레지스트리 직접 재확인)

- **MCP SDK v2가 여전히 pre-alpha**(npm 레지스트리 직접 확인): `npm view @modelcontextprotocol/sdk dist-tags versions time.modified` = `{ latest: '1.29.0' }`·`versions`에 `2.0.0-alpha.2` 존재(약 2개월 전)·`2026-06-04T19:46:40Z` — **2.x를 가리키는 dist-tag 부재**(`next`/`rc`/`alpha`/`beta` 미배포; `2.0.0-alpha.x`는 *버전으로만 publish되고 dist-tag 미노출* → `npm install`은 여전히 1.29.0). v2는 main 브랜치에서 pre-alpha 개발 중, **stable은 Q3 2026**(스펙 publish 2026-07-28 — *오늘 2026-06-16 기준 한 달여 앞이나 아직 미래*) 예정, v1.x가 production 권장·v2 출시 후 최소 6개월 v1.x 유지. → **Cynapx 핀 `^1.29.0` 유지가 옳다. stateless core/Tasks/MCP Apps/Multi-Round-Trip 마이그레이션(L-3)은 v2 stable까지 계속 이연.** **다음 사이클(2026-07-28 스펙 publish 전후)에 2.x dist-tag(`next`/`latest`)/v2 stable 출현 재확인이 핵심 외부 트리거** — 출현 시 L-3가 즉시 actionable화한다. 출처: [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk), [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases), [typescript-sdk repo](https://github.com/modelcontextprotocol/typescript-sdk)
- **함의**: Cynapx 현 StreamableHTTP(session-id)는 v2 stateless core와 충돌 표면이 있으나 *마이그레이션은 stable 배포까지 이연*이 옳다.

### 6.5 경쟁/인접 도구 동향 (전략 추적 — 카테고리 지속)

- **로컬-퍼스트 코드 그래프 카테고리 지속**: CodeGraph(tree-sitter→SQLite+FTS5 MCP), Serena(LSP-over-MCP), GitNexus(zero-server on-device KG), code-graph-mcp(10개 언어 AST KG) 등이 "로컬·on-device·MCP·임베디드 SQLite·tree-sitter·no-code-egress" 패턴을 표준 기본값으로 정착. Cynapx의 "100% 로컬·격리·멀티프로세스 보안 IPC + risk/remediation/refactoring/policy *처방* 엔진 + 하이브리드(keyword+vector RRF) 검색" 포지션이 차별점. **함의: 처방 엔진 진입 로직(v22)·핵심 보조 순수 로직(RRF·escape, P26-1/P27-1)·정규화 프리미티브(toCanonical, P28-1)·graph 엔진 시딩 프리미티브(mulberry32·env-파서, P29-1)가 전수 게이트 완성됐고 — *내부 순수 함수 게이트 발굴이 (L-18 승격 후) 완전 소진*돼 신뢰성 차별화 축은 *외부-트리거 기반 위생/마이그레이션*(공급망·SDK v2)으로 완전 이동했다.** 출처: [CodeGraph](https://github.com/colbymchenry/codegraph), [code-graph-mcp](https://github.com/sdsrss/code-graph-mcp)
- **SCIP가 LSIF 대체 심볼 인덱스 표준 정착** — `export_graph`에 SCIP 추가는 미래 상호운용 후보. protobuf 의존 부담으로 즉시 비권장 — 전략 후보 유지.
- **함의**: (1) 공급망 위생 유지(L-11/L-15/L-16/L-17 해소 — lockfile prod-dep·within-pin 드리프트 모두 0), (2) MCP SDK v2 pre-alpha→stable 추적(2026-07-28 스펙 publish 전후 재확인이 1순위 외부 트리거), (3) **회귀 안전망은 indexer 확장자 매핑 엣지케이스까지 확장 예정(M-1 v28/P31-1) — 이후는 신규 코드 추가 시에만 확장**.

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 유지보수-모드 재열람에서 신규 prod 코드 결함이 없었다(M-1 v28은 테스트-only 게이트 공백 보강):

- `src/server/api-server.ts` — 세션 TTL/cap/sweep·timing-safe Bearer·8 REST 핸들러 + /healthz supertest 전수 게이트(P19-1)·rate-limit·session-마스킹 양호. `zod` 스키마 검증 도달(prod-dep, P30-1로 4.4.3 정렬 — CVE-2026-6991[≤4.3.6] 범위 밖·`.cuid()` 미사용, L-19).
- `src/utils/file-filter.ts`·`file-watcher.ts` — glob은 `ignore`/chokidar 위임(직접 RegExp 구성 0 — ReDoS 표면 0), path는 `path.relative`+`..` 가드 위임(path-escape 표면 0). **횡단 위험 부류 음성 불변.**
- `src/utils/paths.ts` — `isPathInside`(H-7, security.test 9케이스)·`isSystemPath`(initialize-project.test)·`getProjectHash`(phase13-8-b)·`toCanonical`(변환 동작, P28-1) 전부 동작까지 게이트됨.
- `src/server/tools/_utils.ts` — `requireEngine`(H-1)·`mergeResultsRRF`(P26-1)·`escapeXml`/`escapeDot`(P27-1) 3개 export 순수 함수 100% 커버.
- `src/graph/graph-engine.ts` — `fisherYatesShuffle`(P14-4)·`mulberry32`·`parseClusterSeed`·`parseClusterMaxNodes`(P29-1) export 순수 함수 4종 *전부 직접 게이트*. Fisher-Yates+seeded PRNG+count-first 가드(200k)+BFS index-pointer 큐 O(V+E) 알고리즘은 정상.
- `src/graph/*`(나머지) — architecture-engine(P22-1)·optimization-engine(P23-2)·remediation-engine(P23-1)·policy-discoverer(P24-1)·refactoring-engine getRiskProfile(P23-3)+proposeRefactor(P25-1) 처방 엔진 5종 진입 로직 전수 게이트.
- `src/indexer/language-registry.ts` — `getProvider()` 정상 매핑·case-insensitivity 직접 게이트(language-registry.test). **단 무-확장자/미지/dotfile/trailing-dot/multi-dot 엣지케이스는 직접 단언 없음(전부 정확 처리 — M-1 v28/P31-1로 보강 예정).** native grammar 로드 실패 시 `getLanguage()` try/catch graceful degrade(→undefined) 정상.
- `src/server/resource-provider.ts`·`prompt-provider.ts` — MCP resource 4 URI(`tests/resource-provider.test.ts`)·prompt 3개 커버, Unknown McpError 경로 포함. **음성 불변.**
- `src/server/tool-dispatcher.ts` — 20개 도구 스키마 `required ⊆ properties` 불변식 무결(위반 0), Terminal 포워딩·waitUntilReady·registry lookup·EngineNotReadyError 재시도 변환. **음성 불변(독립 export 부재로 회귀 테스트 (b) 잣대 미충족).**
- `src/server/tools/*.ts` — `qualified_name` 10개 전수 strict 가드 정합(M-2 v22+v23). `search-symbols.ts` `query` strict 가드(P25-2)·`get-related-tests.ts` strict 가드(P26-2) 확인.
- `src/watcher/file-watcher.ts` — chokidar `ignored` 프레디킷·확장자 allowlist·flush 동시성·타이머 위생·대용량-배치 git-sync 라우팅·재시도/FATAL 강등(P20-1) 정상.
- `src/indexer/update-pipeline.ts` — 단일 책임·catch log-and-rethrow+롤백·원본 에러 보존(미세 항목만 L-9). `toCanonical` 키 정규화 호출은 P28-1 게이트의 다운스트림. `getProvider()` 호출은 M-1 v28 게이트의 다운스트림(인덱싱 핫패스).
- `src/server/ipc-coordinator.ts` — challenge-response 인증·1MB 제한·per-tool 타임아웃·keepalive(unref)·pending reject-on-close 견고.
- `src/server/workspace-manager.ts`/`health-monitor.ts` — 버전-미스매치 reindex·dispose 순서(watcher→worker→DB)·ledger 일관성 견고.
- `package.json` overrides — tree-sitter `^0.25.0`·fast-uri·qs·hono·postcss 충족, vite `^8.0.16`(L-15 해소), better-sqlite3 lockfile **12.11.1**(P27-2), express lockfile **4.22.2**(P28-2), zod lockfile **4.4.3**(P30-1). dev·prod audit 0/0. within-pin 드리프트 0(P30-1 — L-17 종료).
- `README.md`/`README_KR.md`/`GUIDE_EN.md`/`GUIDE_KR.md` — Node ≥ 22 전부 정렬(P24-2, L-12 해소).
- `.github/workflows/ci.yml` — Node 22/24 매트릭스 + `npm audit --omit=dev --audit-level=high`(P14-1) + `npm ci`. (cynapx-autonomous.yml은 본 진단 범위 외.)
- in-tree 에이전트 설정: `.claude/launch.json` 1개(양성), `.cursor`/`.gemini` 부재, in-tree binding.gyp **0개**(L-2 공급망 미도달 재확인).
- 신규 prod 코드: `git log 8b4d68f` = 테스트-게이트/lockfile/문서 커밋만 — 신규 도구/엔드포인트/유틸 **0건**(게이트할 신규 표면 없음).
- TODO/FIXME/XXX/HACK = 0건(`src/` 전수).

---

## 8. 권장 수정 순서 (Phase 31 제안 — 상세는 phase31-plan.md)

**Phase 30 이후 Cynapx는 *깊은 steady-state*다 — *내부 순수 함수 게이트 발굴 사이클*이 레이어별로 소진됐고(graph/ 엔진 진입+시딩·핸들러 가드·`_utils.ts`·`paths.ts` 전수), *prod-dep lockfile 정렬*(P28-2)·*within-pin 드리프트 정렬*(P30-1)도 비어 lockfile 위생까지 steady-state다.** 본 사이클은 phase30-plan §4-5가 명시한 **외부-트리거-only 포스처**의 첫 실행이며, 그 결과를 실측으로 확인했다: **(1) 신규 prod 코드 0**(`git log 8b4d68f` = 테스트-게이트/lockfile/문서 커밋만 — 게이트할 신규 표면 없음), **(2) 내부 게이트 발굴 소진 + 마지막 후보 L-18 승격**(상위 내부 항목 전량 소진된 지금 `getProvider` 엣지케이스 게이트가 *유일하게 남은 내부 actionable*), **(3) 외부 트리거 모두 정적**(MCP SDK v2 미배포·신규 CVE-2026-6991 zod 버전·기능 양면 미도달·CVE 0/0·캠페인 미도달·node-tree-sitter#268 open). **따라서 *유일한 actionable은 M-1 v28(L-18 승격 — `getProvider` 확장자 엣지케이스 게이트)*뿐이다** — *모든 파일 인덱싱이 의존하는* 확장자→언어 매핑 함수의 0-의존 순수 결정 로직에 회귀 안전망을 친다. CRITICAL/HIGH 0, MEDIUM 1(M-1 v28 — Phase 31-1, 테스트-only), LOW(L-2~L-9 v27 승계 + L-13/L-14 승계 + L-19 신규[CVE-2026-6991 zod 미도달]; L-18 → M-1 v28 승격 처리; L-17 [P30-1 해소], L-11/L-15/L-16 이전 해소). 따라서 Phase 31은 **`getProvider` 확장자 엣지케이스 게이트(P31-1, 테스트-only) + 추적 갱신**의 *경량 단일-항목 유지보수 사이클*이 합리적이다.

1. **P31-1 [예정]**: M-1 v28 해소 — `tests/language-registry.test.ts`의 `LanguageRegistry — descriptor-driven registration` describe에 `getProvider()` 엣지케이스 케이스 추가(무-확장자 `Makefile`→undefined·미지 `foo.xyz`→undefined·dotfile `.gitignore`→undefined·trailing-dot `foo.`→undefined·multi-dot `a.b.py`→python·case-insensitive `Widget.PY`/`Main.TS` 검증/보강). 의존 0, 테스트-only, prod 코드 무변경. 추가 후 `npx vitest run` 그린(672 → 대략 +5~6 케이스)·`npx tsc --noEmit` 그린·`npm audit` 0·`npm audit --omit=dev` 0 재확인.
2. **추적 상태 갱신**: L-2(Miasma/Phantom Gyp 도달 0 불변), L-3(SDK v2 *여전히 pre-alpha* — 2026-07-28 스펙 publish 전후 2.x dist-tag 재확인 = 1순위 외부 트리거), L-6(node-tree-sitter#268 open), L-7/L-8 게이트 공백, L-9 잔여 클린업, L-13(analyze-impact use_cache 무해), L-14(CVE-2026-25727 time 크레이트 미도달), L-19(CVE-2026-6991 zod CUID 미도달) 현 상태를 다음 사이클 출발점으로 고정. **L-18(getProvider 엣지케이스)은 M-1 v28 → P31-1로 승격 처리 → 추적 종료 예정. L-17(within-pin lockfile, P30-1)·L-11(better-sqlite3)·L-15(vite)·L-16(express) 해소 종료 유지.**

(L-4 IPC MessagePack 계속 보류, L-5 클러스터링 본격 파티셔닝 계속 이연, MCP 전면 stateless/task 마이그레이션은 SDK v2 stable 배포까지 이연, SCIP export는 전략 후보로 기록만.)

> **깊은 steady-state 및 향후 사이클 안내**: Phase 26~30이 핸들러 보조(`_utils.ts`)·공통 유틸(`paths.ts`)·graph 엔진 시딩(graph-engine.ts) 순수 함수 레이어 + lockfile 위생(prod-dep·within-pin)을 마무리했고 — **Phase 31은 *내부 순수 함수 게이트 발굴 사이클의 마지막 후보인 L-18(`getProvider` 엣지케이스)*을 처리한다(M-1 v28 → P31-1).** 이로써 *모든 파일 인덱싱이 의존하는 확장자→언어 매핑 함수*까지 게이트되어 **내부 순수 함수 게이트 발굴이 완전 소진**된다. **따라서 Phase 31 이후 사이클은 *전적으로 외부-트리거 기반*이다**: (1) 새 도구/엔진/핸들러/유틸 추가 시의 신규 게이트, (2) 공급망 위생(prod audit·lockfile 드리프트) 정기 점검, (3) **MCP SDK v2 stable 전환(L-3, 2026-07-28 스펙 publish 전후 — *다음 사이클의 핵심 외부 트리거*)**·node-tree-sitter#268 해소(L-6)·신규 CVE 도달성 판정(L-14/L-19 부류) 같은 *외부 상태 변화* 항목. phase31-plan은 이 *외부-트리거-only 포스처*(더 긴 간격·외부 재스캔 위주·doc-only 경량 사이클)를 운영 지침으로 명시한다. **특히 다음 사이클은 MCP SDK v2 spec publish 일자(2026-07-28)와 정면으로 맞물려 — v2 stable/2.x dist-tag 출현 시 L-3가 즉시 actionable화하므로, *그 재확인이 다음 사이클의 1순위 외부 트리거*다.**
