# Cynapx 정밀 진단 보고서 v27

- **기준 커밋**: `a71d916` (Phase 29 + Phase 29-1 완료 — `graph-engine.ts` 시딩/env-파싱 순수 함수 3종(`mulberry32`·`parseClusterSeed`·`parseClusterMaxNodes`) 직접 게이트(P29-1, vitest 657→672), 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-16
- **진단 범위**: src/ 전체(server, db, indexer, graph, watcher, utils, cli, bootstrap) + **유지보수-모드 포커스 진단**. diagnostic-v26 §8 + phase29-plan §4-5가 명시한 대로 *내부 순수 함수 게이트 발굴 사이클은 사실상 소진*됐다(graph/ 엔진 진입 로직~P25-1, `qualified_name` 핸들러 strict 가드~P26-2, `server/tools/_utils.ts` export 순수 함수 100%~P27-1, `src/utils/paths.ts` `toCanonical` 변환~P28-1, `graph-engine.ts` 시딩/env-파싱 프리미티브~P29-1). 따라서 본 사이클은 phase29-plan §4-5의 **외부-트리거 기반 유지보수 포스처**로 정직하게 전환한다: (1) *targeted 내부 재검토*(신규 prod 코드 0 확인 + L-18 `getProvider` 엣지케이스가 여전히 비-actionable인지·L-17 dev/prod-dep within-pin 드리프트가 *마지막 남은 actionable*로 승격할 가치가 있는지 재판정), (2) *외부 컨텍스트 재스캔*(MCP SDK v2 npm 배포 상태[**CRITICAL — v2 stable 예정일 2026-07-28이 한 달 앞**], CVE/advisory, Miasma/Phantom Gyp 공급망 캠페인, node-tree-sitter#268).
- **진단 방법**: 단일 에이전트 오케스트레이션 + 회의적 코드 리뷰(유지보수-모드 targeted) + 로컬 직접 검증(`npx vitest run`[케이스 수·시간], `npx tsc --noEmit`, `npm audit`[dev 포함]·`npm audit --omit=dev`, `npm ls express better-sqlite3 vite @modelcontextprotocol/sdk`·`npm outdated`로 버전 드리프트 확인, `npm view`로 npm 레지스트리 직접 조회[better-sqlite3 12.11.1 dist-tags·@modelcontextprotocol/sdk dist-tags]) + **`git log --oneline ae69a8b..HEAD`로 신규 prod 코드 부재 실측**(= P27~P29 테스트-게이트/의존성 커밋만, 신규 도구/엔드포인트/유틸 0) + 외부 웹 재조사(MCP SDK v2 배포 상태·better-sqlite3/express/vite/tree-sitter/chokidar CVE·Miasma/Phantom Gyp 캠페인·node-tree-sitter#268).
- **현재 상태(직접 검증)**: `npx vitest run` **672/672**(47 파일, **6.47s** — 657→672 케이스 +15(P29-1 시딩/env-파싱 게이트)), `npx tsc --noEmit` 그린, **`npm audit`(dev 포함) = 0 vulnerabilities**, **`npm audit --omit=dev`(prod) = 0 vulnerabilities**. diagnostic-v26 전 항목 처리 완료(M-1 v26 [DONE — P29-1]), LOW 승계 추적.

> **요약**: **이 사이클은 *깊은 steady-state에 대한 정직한 유지보수-모드 사이클*이다.** **(1) 신규 prod 코드 0**: `git log --oneline ae69a8b..HEAD` = `a71d916`(P29-1 테스트 게이트)·`38c1e54`(phase29 docs)·`5a77e9b`(P28 게이트+lockfile)·`a47844b`(phase28 docs) — *전부 테스트-게이트/의존성/문서 커밋*이며 신규 MCP 도구·REST 엔드포인트·유틸 함수는 **0건**(게이트할 신규 prod 표면 없음). **(2) 내부 순수 함수 게이트 발굴 소진 재확인**: diagnostic-v26 §8 + phase29-plan §4-5가 명시한 대로 graph/ 엔진(진입+시딩)·핸들러 `qualified_name` strict 가드·`_utils.ts` export 순수 함수·`paths.ts` `toCanonical`·`graph-engine.ts` 시딩/env-파싱 프리미티브가 *모두* 직접 게이트됐다 — 남은 내부 후보(L-18 `getProvider` 확장자 엣지케이스)는 *정상 매핑·case-insensitivity가 이미 직접 게이트*되고 *엣지케이스는 전부 정확 처리되는 게이트 공백*(결함 아님)이라 (b) 잣대 우선순위가 낮다(비-actionable 추적 유지). **(3) 외부 0건**: prod·dev `npm audit` 0/0, MCP SDK v2 *여전히 pre-alpha*(npm `latest` = **1.29.0** 직접 재확인, 2.x dist-tag 부재, time.modified 2026-06-04, stable Q3 2026[스펙 publish 2026-07-28 — *한 달 앞이나 아직 미래*]), better-sqlite3 12.11.1 직접 CVE/하이재킹 0건(npm `latest` 직접 재확인 — *웹 검색의 "node-gyp 캠페인 포함·latest non-vulnerable 12.10.0" 문구는 Snyk vuln-DB의 native-모듈 일반론 프레이밍이지 12.11.1 표적 하이재킹이 아님*; npm `dist-tags.latest = 12.11.1`·악성 dist-tag 부재로 정합 — L-2/L-11 불변), Miasma/Phantom Gyp 캠페인 여전히 활발하나 *동일 컴프로마이즈 패키지군*(@redhat-cloud-services·@vapi-ai/server-sdk·jagreehal 계정 50+패키지)·*Cynapx 트리 미도달 재확인*(in-tree binding.gyp **0개**·컴프로마이즈 패키지 not in tree·`.claude/launch.json` 1개 양성·`.cursor`/`.gemini` 부재 — L-2 불변), node-tree-sitter#268 여전히 open(L-6 불변). **이로써 *내부 게이트 발굴이 소진되고 외부 트리거가 모두 정적(static)인* 사이클이다 — diagnostic-v26 §8 + phase29-plan §4-5가 예고한 "외부-트리거 기반 유지보수 포스처로의 전환"이 실제로 도래했다.** **신규 M-1 v27(actionable, 의존성 lockfile within-pin 정렬 — 마지막 남은 경량 actionable)**: `npm outdated`가 보고한 within-pin(semver-호환) lockfile 드리프트 3건 — `zod` 4.3.6→**4.4.3**(*prod-dep*, `^4.3.6` 핀-내, `src/server/api-server.ts`에서 도달 + MCP SDK의 zod와 dedupe), `@types/node` 20.19.33→**20.19.43**(dev-dep, `^20.12.7` 핀-내), `vitest` 4.1.2→**4.1.9**(dev-dep, `^4.1.2` 핀-내) — 을 `npm update`로 lockfile 정렬한다. **이것이 "마지막 남은 actionable"인 이유**: 내부 게이트 발굴 소진(2) + 외부 정적(3)이라 — *경량 위생 정렬*만이 prod 동작 무변경으로 닫을 수 있는 유일한 actionable 항목이다. **단 M-1 v23~v26(순수 함수 게이트)·M-2 v24/v25(prod-dep lockfile bump)와 부류가 다르다**: (a) `zod`는 prod-dep이나 드리프트가 *핀-내 patch/minor*(`^4.3.6`이 4.4.3 허용 — 핀 무변경·major 아님)라 *audit 0/0 불변·동작 무변경*이고, M-2 v24(better-sqlite3 12.x lockfile)·M-2 v25(express 4.22.x lockfile)처럼 *특정 advisory/긴급 정렬*이 아니라 *누적된 within-pin 드리프트의 일괄 위생 정렬*이다. (b) `@types/node`/`vitest`는 dev-only(prod 미도달). → **이는 L-17(diagnostic-v26의 "비-actionable 위생 추적")을 *마지막 남은 actionable로 승격*한 것이다** — v26은 "다음 dev 갱신 시 함께 정렬"로 이연했으나, *모든 다른 각도가 소진된 지금* 이 정렬이 *유일하게 남은 경량 actionable*이므로 경량 P30-1로 처리하는 것이 정직하다. **(b) 잣대 충족**: (1) 핀 무변경(`package.json` 수정 0 — `npm update`는 lockfile만 핀-내 갱신); (2) prod 동작 무변경(`zod` 4.3.6→4.4.3은 patch/minor backward-compatible, audit 0/0 불변, `npx vitest run` 672 그린·`npx tsc` 그린으로 검증); (3) M-2 v24/v25의 *prod-dep lockfile 위생 정렬*과 동형이되 *advisory-구동이 아닌 within-pin 누적 정렬*이고 일부는 dev-only다. → Phase 30-1(lockfile-only, 핀 무변경). **신규 M-2 v27 후보 검토 → *없음***: 내부 신규 게이트 후보 0(소진), 외부 신규 CVE/advisory 0(prod·dev audit 0/0), MCP SDK v2 미배포(L-3 이연 불변). **CRITICAL 0, HIGH 0, MEDIUM 1(M-1 v27 lockfile within-pin 위생 정렬 — Phase 30-1, lockfile-only·핀 무변경), LOW(L-2~L-9 v26 승계 + L-13/L-14 승계 + L-18 승계[getProvider 엣지케이스 게이트 공백, 비-actionable 추적] ; L-17은 M-1 v27로 승격되어 처리 → 추적 종료 예정 ; L-11/L-15/L-16 이전 해소).**

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건은 Phase 13에서, v11 HIGH(공급망)는 Phase 14-1에서, v12~v18 MEDIUM은 Phase 15~21에서, v19 MEDIUM은 Phase 22-1에서, v20 MEDIUM 2건+L-10 부분은 Phase 23에서, v21 MEDIUM 2건+L-12는 Phase 24에서, v22 MEDIUM 2건은 Phase 25에서, v23 MEDIUM 2건은 Phase 26에서, v24 MEDIUM 2건은 Phase 27에서, v25 MEDIUM 2건은 Phase 28에서, v26 MEDIUM 1건은 Phase 29에서 해소됐고, 본 유지보수-모드 재열람에서 새로운 CRITICAL/HIGH는 없다. IPC 핸드셰이크(challenge + HMAC-SHA256 + timingSafeEqual)·API Bearer(SHA-256 + timingSafeEqual)·세션 맵(TTL+cap+sweep unref) 모두 견고(직접 재열람).

---

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** 코드·공급망 어디에서도 신규 HIGH 없음. **prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0**(직접 재검증). 신규 prod 코드 0(`git log ae69a8b..HEAD` = 테스트-게이트/의존성/문서 커밋만)이라 신규 결함 표면 자체가 없다. M-1 v27(lockfile within-pin 위생 정렬)은 MEDIUM이다 — *advisory-구동 보안 정렬이 아니라 누적된 within-pin 드리프트의 일괄 위생*이며 prod 동작 무변경(audit 0/0 불변). 외부 CVE-2026-25727(`time` 크레이트)도 Cynapx prod 트리 미도달이라 LOW(L-14 불변). Miasma/Phantom Gyp 캠페인도 Cynapx 트리 미도달(L-2 불변). better-sqlite3 12.11.1은 npm `latest`·악성 dist-tag 부재로 *하이재킹 미도달*(L-2/L-11 불변).

---

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

| # | 위치 | 내용 |
|---|------|------|
| **M-1 v27** *(신규, actionable — lockfile within-pin 위생 정렬. L-17을 *마지막 남은 경량 actionable*로 승격. 내부 게이트 발굴 소진 + 외부 정적이라 prod 동작 무변경으로 닫을 수 있는 유일한 항목)* **[예정 — Phase 30-1]** | `package-lock.json`(`zod`/`@types/node`/`vitest` 엔트리), `package.json`(핀 `^4.3.6`/`^20.12.7`/`^4.1.2` *무변경*), 도달처: `zod`는 `src/server/api-server.ts`(prod) + MCP SDK dedupe, `@types/node`/`vitest`는 dev-only | **`npm update`로 within-pin(semver-호환) lockfile 드리프트 3건 정렬.** `npm outdated` 실측: `zod` Current 4.3.6·Wanted **4.4.3**(*prod-dep*, `^4.3.6` 핀-내 minor), `@types/node` 20.19.33·Wanted **20.19.43**(dev-dep, `^20.12.7` 핀-내 patch), `vitest` 4.1.2·Wanted **4.1.9**(dev-dep, `^4.1.2` 핀-내 patch) — 전부 *semver-호환·핀 무변경·audit 0/0 불변*. **부류 구분**: M-2 v24(better-sqlite3 12.x)·M-2 v25(express 4.22.x)는 *특정 prod-dep을 latest로 lockfile 정렬*했으나(advisory/누적 메이저-내 정렬), M-1 v27은 *누적된 within-pin 드리프트의 일괄 위생 정렬*이다 — `zod`만 prod-dep(`api-server.ts` 도달)이나 드리프트가 *핀-내 minor*(`^4.3.6` 허용)라 동작 무변경, 나머지는 dev-only. **이는 diagnostic-v26의 L-17("dev-dep within-pin lockfile 드리프트, 비-actionable 위생 추적 — 다음 dev 갱신 시 함께 정렬")을 *마지막 남은 actionable로 승격*한 것이다**: v26은 "비-actionable·다음 갱신 시"로 이연했으나 — *내부 순수 함수 게이트 발굴이 소진(diagnostic-v26 §8)되고 외부 트리거가 모두 정적(MCP SDK v2 미배포·CVE 0·캠페인 미도달)인 지금* 이 정렬이 *유일하게 남은 경량 actionable*이라, 더 이상 "다음 갱신을 기다릴" 다른 작업이 없으므로 경량 P30-1로 처리하는 것이 정직하다. **(b) 잣대 충족**: (1) `package.json` 핀 무변경(`npm update`는 lockfile만 핀-내 갱신 — major bump 아님); (2) prod 동작 무변경(`zod` 4.3.6→4.4.3 backward-compatible minor, `@types/node`/`vitest` patch — `npx vitest run` 672 + `npx tsc --noEmit` 그린·`npm audit` 0/0 불변으로 회귀 부재 검증); (3) M-2 v24/v25 *prod-dep lockfile 위생 정렬*과 동형이되 *advisory-구동이 아닌 within-pin 누적 정렬*이고 일부 dev-only. **verdict: actionable — Phase 30-1(lockfile-only).** (5장 상세) |

> **참고(M-2 v27 부재 근거 + 유지보수-모드 사이클 명시)**: 본 사이클은 *깊은 steady-state에 대한 정직한 유지보수-모드 사이클*이다. **(a) 내부 신규 게이트 후보 0**: `git log ae69a8b..HEAD`가 신규 prod 코드 0(테스트-게이트/의존성/문서 커밋만)임을 확인했고, 내부 순수 함수 게이트 발굴은 diagnostic-v26 §8 + phase29-plan §4-5대로 *레이어별 소진*됐다(graph/ 엔진 진입+시딩·핸들러 가드·`_utils.ts`·`paths.ts` 전수). 남은 L-18(`getProvider` 엣지케이스)은 *정상 매핑·case-insensitivity가 이미 직접 게이트*되고 엣지케이스 전부 정확 처리되는 *게이트 공백*(결함 아님)이라 (b) 잣대 우선순위가 M-1 v27보다도 낮다(비-actionable 추적 유지). **(b) 외부 신규 CVE/advisory 0**: prod·dev audit 0/0, MCP SDK v2 미배포(L-3 이연), better-sqlite3/express/vite/tree-sitter/chokidar 직접 CVE 0, Miasma/Phantom Gyp 미도달. 따라서 *유일한 actionable은 M-1 v27 lockfile 위생 정렬*뿐이며 — 이는 phase29-plan §4-5가 예고한 *"외부-트리거 기반 유지보수 포스처로의 전환"이 실제로 도래*했음을 뜻한다.

---

## 4. 최적화 (LOW) — 추적/이연 (v26 승계; L-17 → M-1 v27 승격; L-11/L-15/L-16 이전 해소)

| # | 위치 | 내용 |
|---|------|------|
| L-2(v27) | `package.json` (native deps), CI / Dockerfile, `.claude/` 설정 | **Miasma / Phantom Gyp / Node-gyp 공급망 캠페인 포스처 추적 — Cynapx 도달 0건 불변(재확인).** 진단 일자 직접 재대조: 캠페인은 *여전히 활발*(2026-06-01 @redhat-cloud-services 32패키지·06-03 @vapi-ai/server-sdk 4버전 + jagreehal 계정 50+패키지 → 57패키지/286악성버전, 157-byte binding.gyp 남용 self-propagating worm — preinstall/postinstall 대신 binding.gyp가 `npm install` 중 node-gyp 코드 실행을 트리거해 install-script 보안 검사 우회; Bun 런타임 다운로드·CI/CD·클라우드 자격증명 탈취·GitHub dead-drop·`.claude`/Cursor/Gemini 설정에 persistence 주입; Microsoft GitHub 73개 repo 영향 보고)이나 — *in-tree binding.gyp **0개***(`find . -name binding.gyp -not -path "*/node_modules/*"` = 0), 컴프로마이즈 패키지(@redhat-cloud-services·@vapi-ai/server-sdk·ai-sdk-ollama·jagreehal 패키지군) *not in tree*(`npm ls` = empty), in-tree 에이전트 설정은 `.claude/launch.json` 1개(양성), `.cursor`/`.gemini` 부재. native 의존(better-sqlite3 12.11.1 + tree-sitter 0.25.0 + 12 grammar) 무관·악성 버전 미발행. CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지 1차 방어선 유지. **즉각 조치 불필요 — 추적만.** 출처: [StepSecurity Miasma](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm), [Chainguard Miasma](https://www.chainguard.dev/unchained/chainguard-artifacts-safe-from-miasma-phantom-gyp-npm-attack), [OX Security Miasma](https://www.ox.security/blog/600000-monthly-downloads-affected-miasma-supply-chain-attack-is-back-on-npm/), [Wiz Miasma](https://www.wiz.io/blog/miasma-supply-chain-attack-targeting-redhat-npm-packages) |
| L-3(v27) | `src/server/api-server.ts` (session-id StreamableHTTP), `package.json:29`(`@modelcontextprotocol/sdk ^1.29.0`) | **MCP SDK v2 — *여전히 pre-alpha*(상태 불변, npm 레지스트리 직접 재확인).** `npm view @modelcontextprotocol/sdk version dist-tags` 직접 실행: `version = '1.29.0'`·`dist-tags = { latest: '1.29.0' }`·`time.modified = '2026-06-04T19:46:40Z'` — **2.x dist-tag 부재**(alpha/beta/rc 미배포). v2는 main 브랜치에서 pre-alpha 개발 중·**stable은 Q3 2026**(스펙 publish 2026-07-28 — *오늘 2026-06-16 기준 한 달 앞이나 아직 미래*) 예정, v1.x가 production 권장·v2 출시 후 최소 6개월 v1.x 보안/버그 수정 지속. → Cynapx 핀 `^1.29.0` 유지가 옳음. stateless protocol core(SEP-2567 session-id 제거)·Multi-Round-Trip·MCP Apps 마이그레이션은 **v2 stable 전환까지 계속 이연**. P15-3 `handleMcp()` 설계 메모가 출발점. **다음 사이클(2026-07-28 전후)에 v2 stable/2.x dist-tag 출현 재확인이 핵심 외부 트리거.** 출처: [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk), [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases), [MCP TS SDK V2 docs](https://ts.sdk.modelcontextprotocol.io/v2/) |
| L-4(v27) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환. **성능 문제 미관측 — 계속 보류.** 메시지가 작고 round-trip이 드물어 직렬화 병목 아님 |
| L-5(v27) | `src/graph/graph-engine.ts` | 클러스터링 본격 서브그래프 파티셔닝 — 100k+ 노드 실측 시 재검토(**계속 이연**). LPA O(V+E)·`MAX_ITER=20` 캡·count-first 가드(200k, `parseClusterMaxNodes`)·Fisher-Yates seeded PRNG(`mulberry32`) 직접 재확인 — OOM/편향 방어 정상. **시딩/캡 프리미티브의 순수 함수 동작은 P29-1로 게이트 완료(파티셔닝 자체는 계속 이연).** |
| L-6(v27) | CI / Dockerfile | Node 24 + tree-sitter 0.25.x 빌드 fragility([node-tree-sitter#268] / [salesforce/agentscript#7: C++20 미설정] 여전히 open·미해결, CVE 아님 — 진단 일자 재확인). CI Node 22/24 매트릭스 그린이나 Node 24 LTS 전환 전 prebuild 재확인. **추적만** 출처: [node-tree-sitter#268](https://github.com/tree-sitter/node-tree-sitter/issues/268), [salesforce/agentscript#7](https://github.com/salesforce/agentscript/issues/7) |
| L-7(v27) | `src/cli/admin.ts` (cmd* 9개), `tests/admin-cli.test.ts` | **admin CLI 명령 동작의 vitest 게이트 공백 — 비-actionable 추적.** 등록 명령 9개 `cmd*`는 모듈-private(미-export)이라 vitest 직접 호출 불가. **admin.ts 핸들러 export 리팩터 시 함께 게이트화 후보** |
| L-8(v27) | `src/indexer/worker-pool.ts`, `embedding-manager.ts`, `db/database.ts` | **에러-복구·마이그레이션 잔여 분기의 vitest 게이트 공백 — 비-actionable 추적.** worker `worker.on('error')`·queue backpressure·embedding A-7 stale supersedence 레이스·DB migration 잔여 분기는 직접 미검증이나 인접 분기 커버 + 타이밍-flaky 위험. **SCHEMA_VERSION 증분/worker-pool 리팩터 시 함께** |
| L-9(v27) | `src/indexer/update-pipeline.ts` (트랜잭션 보일러플레이트·progress `log.error`), `embedding-manager.ts:184`/`api-server.ts:625` (빈 catch) | **L-9 코드 클린업 잔여 — (b) 잣대 미충족, 비-actionable 추적.** `withWriteTransaction()` 추출은 트랜잭션 경계 5곳 재작성이라 회귀 표면 넓음; 빈 catch 2건은 의도적 silent-drop 방어. **update-pipeline 리팩터 페이즈로 묶어 처리 후보** |
| **L-13(v27)** *(승계 — analyze-impact use_cache 스키마-default 미강제, 무해)* | `src/server/tools/analyze-impact.ts:23` (`useCache: args.use_cache` 무검증·default 미강제) | **`analyze-impact` 핸들러가 `use_cache`(스키마 default `true`)를 검증·default-강제 없이 그대로 `traverse({useCache: args.use_cache})`에 전달 — 무해.** `args.use_cache`가 `undefined`면 traverse 내부 truthy 평가에서 캐시 *비활성*으로 동작(스키마 default `true`와 어긋날 수 있으나 *느려질 뿐* 정확성·크래시 영향 0). 동형 무해 패턴이 `export-graph`(`format`/`max_depth`)·`get-symbol-details`(`include_source`/`summary_only`)에도 존재 — 전부 다운스트림 undefined-안전. **verdict: 추적만(비-actionable)** |
| **L-14(v27)** *(승계 — CVE-2026-25727 `time` 크레이트, Cynapx 미도달 불변)* | (외부 — Rust `time` crate via tree-sitter Rust 생태계 언급), Cynapx prod 트리 무관 | **CVE-2026-25727(RFC 2822 파싱 스택 소진 DoS, `time` 크레이트 0.3.6~<0.3.47)은 *tree-sitter*로 거론되나 실제로는 Rust `time` 크레이트 결함 — Cynapx prod 트리 미도달 불변.** 본 CVE는 tree-sitter npm 바인딩/그래머가 아니라 Rust `time` 크레이트의 RFC 2822 날짜 파싱에 있고, Cynapx의 의존 표면(npm tree-sitter 0.25.0 + 12 grammar)에 `time` 크레이트는 부재 → **prod·dev 미도달, audit 0/0 불변.** tree-sitter Rust 생태계 모니터링 신호로 추적. **verdict: 추적만(비-actionable — 미도달)** 출처: [NVD CVE-2026-25727](https://nvd.nist.gov/vuln/detail/CVE-2026-25727) |
| **L-18(v27)** *(승계 — `LanguageRegistry.getProvider()` 확장자 엣지케이스 직접 테스트 공백, 비-actionable 추적)* | `src/indexer/language-registry.ts:111-136`(`getProvider()` — `filePath.split('.').pop()?.toLowerCase()`), `tests/language-registry.test.ts:90-116` | **`getProvider()`의 확장자 추출 엣지케이스가 직접 테스트되지 않음 — 무해, 비-actionable 추적.** `tests/language-registry.test.ts`는 *정상 확장자 매핑*(descriptor별)·*case-insensitivity*(`Main.PY`/`Widget.Hpp`)는 직접 게이트하나 — *무-확장자*(`Makefile`)·*미지 확장자*(`foo.xyz`)·*dotfile*(`.gitignore`)·*trailing-dot*(`foo.`)·*multi-dot*(`a.b.PY`) 엣지케이스는 단언하지 않는다(진단 일자 코드 재확인: `split('.').pop()` 112줄, `if (!ext) return undefined` 113줄). v26 `npx tsx` 실측대로 *전부 정확 처리*(`Makefile`/`foo.xyz`/`.gitignore`/`foo.`→`undefined`, `a.b.PY`→python) — 즉 *결함이 아니라 게이트 공백*이며 M-1 v27(lockfile 정렬)보다도 (b) 잣대 가치가 낮다(정상 동작 직접 게이트가 이미 있고 엣지케이스만 누락; `split('.').pop()`의 결정성은 자명). **verdict: 추적만(비-actionable — 여유 사이클에 `language-registry.test.ts`로 묶어도 무방)** |

> **L-17 승격 안내**: diagnostic-v26의 L-17(dev-dep within-pin lockfile 드리프트, 비-actionable 위생 추적)은 **본 사이클에서 M-1 v27로 승격**됐다 — *모든 다른 내부/외부 각도가 소진된 지금* lockfile within-pin 정렬이 *유일하게 남은 경량 actionable*이기 때문이다(prod-dep `zod` 4.3.6→4.4.3 포함, 핀 무변경). Phase 30-1 완료 시 L-17 추적 종료. **L-16(express lockfile)은 P28-2(4.22.2)에서, L-11(better-sqlite3)·L-15(vite)는 이전 사이클에서 이미 해소 — 추적 종료 유지.**

> **신규 LOW 부재 안내(prod 코드 동작 변경)**: M-1 v27(lockfile within-pin 위생 정렬, 핀 무변경)을 제외하면 prod 코드 *동작* 변경을 요하는 신규 LOW는 0건이다(신규 prod 코드 자체가 0 — `git log ae69a8b..HEAD`). L-13/L-14는 무해·미도달 추적, L-18은 테스트-only 게이트 공백이다.

---

## 5. 코드 품질 / 성능 전수 (유지보수-모드 targeted 재확인 + steady-state 재확인)

v29까지 graph/ 엔진 처방 5종 진입 로직 + 핸들러 보조 핵심 순수 로직(`mergeResultsRRF`·`escapeXml`·`escapeDot`) + `qualified_name` 10개 핸들러 strict 가드 + 공통 유틸 정규화 프리미티브(`toCanonical`) + graph 엔진 시딩/env-파싱 프리미티브(`mulberry32`·`parseClusterSeed`·`parseClusterMaxNodes`)가 전수 게이트/정렬됐다. **본 사이클은 유지보수-모드 targeted 재확인**: (1) 신규 prod 코드 부재 실측, (2) 남은 내부 후보(L-18) 재판정, (3) 외부 트리거 재스캔.

**(A) 신규 prod 코드 실측 — `git log --oneline ae69a8b..HEAD`**

| 커밋 | 내용 | 분류 |
|------|------|------|
| `a71d916` | Phase 29-1: gate mulberry32/parseClusterSeed/parseClusterMaxNodes (M-1 v26) | 테스트-게이트(prod 무변경) |
| `38c1e54` | Phase 29 cycle: diagnostic-v26 + phase29-plan docs | 문서 |
| `5a77e9b` | Phase 28: gate toCanonical() + express lockfile 4.22.2 | 테스트-게이트 + lockfile |
| `a47844b` | Phase 28 cycle: diagnostic-v25 + phase28-plan docs | 문서 |

핵심: ae69a8b..HEAD = *테스트-게이트/lockfile/문서 커밋만*이며 **신규 MCP 도구·REST 엔드포인트·유틸 함수는 0건**. → *게이트할 신규 prod 표면이 없다*(내부 게이트 발굴 소진 재확인).

**(B) 남은 내부 후보 재판정 — L-18 `getProvider` 확장자 엣지케이스 (비-actionable 유지)**

| 로직 | 코드 | 직접 테스트 | 판정 |
|------|------|------------|------|
| 정상 확장자 매핑 | `getProvider()`(descriptor별) | **커버**(`language-registry.test.ts:90-100`) | 정합 |
| case-insensitivity | `.toLowerCase()`(112줄) | **커버**(`Main.PY`/`Widget.Hpp`) | 정합 |
| 무-확장자·미지·dotfile·trailing-dot·multi-dot | `split('.').pop()` 엣지(112-113줄) | **미커버**(전부 정확 처리되나 단언 0) | L-18(비-actionable 추적 유지) |

핵심: 매핑은 *정상 경로·case-insensitivity가 이미 직접 게이트*되고 엣지케이스만 누락(`split('.').pop()` 결정성은 자명) → *결함 아닌 게이트 공백*. v26에서 "M-1 v26 처리 후 여유 사이클에 묶어도 무방"으로 판정했고 — 본 사이클은 *lockfile 정렬(M-1 v27)이 더 우선*이라 L-18은 *비-actionable 추적 유지*(L-18을 게이트하려면 `language-registry.test.ts`에 엣지케이스 5종 describe 추가가 필요하나 (b) 잣대 가치가 lockfile 정렬보다 낮고 *결함이 아닌 게이트 공백*이라 강제하지 않는다).

**(C) 의존성 lockfile within-pin 드리프트 — M-1 v27 (`npm outdated` 실측)**

| 패키지 | 핀 | Current | Wanted | Latest | 분류 | 판정 |
|--------|-----|---------|--------|--------|------|------|
| `zod` | `^4.3.6`(deps) | 4.3.6 | **4.4.3** | 4.4.3 | prod-dep, 핀-내 minor | **M-1 v27 — Phase 30-1** |
| `@types/node` | `^20.12.7`(devDeps) | 20.19.33 | **20.19.43** | 25.9.3 | dev-dep, 핀-내 patch | **M-1 v27 — Phase 30-1** |
| `vitest` | `^4.1.2`(devDeps) | 4.1.2 | **4.1.9** | 4.1.9 | dev-dep, 핀-내 patch | **M-1 v27 — Phase 30-1** |
| `@types/express`/`commander`/`express`/`typescript`/`@types/node`/`tree-sitter-c-sharp` (major/핀 외) | — | — | =Current | major | 즉시 비권장(major bump·핀 변경) |

핵심: within-pin(`npm update`가 `package.json` 핀 무변경으로 정렬 가능) 드리프트 3건 중 `zod`만 prod-dep이나 *핀-내 minor*(`^4.3.6`이 4.4.3 허용 — major 아님)라 동작 무변경, 나머지 2건은 dev-only. major 드리프트(`@types/express` 5·`express` 5·`commander` 15·`typescript` 6·`@types/node` 25)는 *핀 변경 수반*이라 즉시 비권장. `tree-sitter-c-sharp` 0.23.1 핀(0.23.5 latest이나 ERR_REQUIRE_ASYNC_MODULE 미해소 → 핀 유지가 옳음). → M-1 v27은 *within-pin 3건만* `npm update`로 정렬(lockfile-only, 핀 무변경).

**(D) prod steady-state 재확인 — 신규 prod 코드 결함 0**

| 항목 | 판정 |
|------|------|
| god-module / 순환 import | 0 — `openapi.ts`·`update-pipeline.ts`·`graph-engine.ts` 응집 불변. repos→engines→server/pipeline 단방향 |
| TODO/FIXME/XXX/HACK | 0건(`src/` 전수) |
| 핫패스 O(n²)-over-nodes | 0 — 클러스터링 count-first 가드(200k, `parseClusterMaxNodes`)+seeded PRNG(`mulberry32`), BFS index-pointer 큐, 반복 DFS+60s 캐시, architecture-engine O(1) Map(P22-1) |
| prod·dev audit | 0 / 0 vulnerabilities |
| 테스트 | `npx vitest run` **672/672**(47 파일, 6.47s) — 추세 무문제(657→672 케이스 +15[P29-1 시딩/env-파싱 게이트], 시간 머신 변동) |

**(E) 에러 핸들링 일관성 — 양호**

`Logger`(stderr-only, MCP stdio 안전) `normalizeData()` Error 언랩. update-pipeline catch는 log-and-rethrow + 롤백 선행. 미세 항목(progress log.error·빈 catch 2건)은 L-9 비-actionable 추적. `qualified_name` 10개 핸들러 strict 가드 전수 정합(M-2 v22+M-2 v23으로 완성). `search-symbols` `query` strict 가드(P25-2)·`get-related-tests` strict 가드(P26-2) 정렬 확인.

---

## 6. 외부 컨텍스트 (웹 조사 — 진단 일자 재실행, 출처 명시)

### 6.1 의존성 취약점 (prod·dev 둘 다 clean)

- **`npm audit`(dev 포함) = 0 + `npm audit --omit=dev`(prod) = 0**(둘 다 직접 실행). Phase 21-1 postcss override + vite `^8.0.16` bump(`473acf8` — L-15 해소)가 dev 트리도 clean 유지.
- **`npm ls express better-sqlite3 vite @modelcontextprotocol/sdk` + `npm outdated`(직접 실행)**: express **4.22.2**(P28-2 정렬)·better-sqlite3 **12.11.1**(npm `latest`)·vite **8.0.16**·sdk **1.29.0**. within-pin 드리프트 3건(`zod` 4.3.6→4.4.3·`@types/node` 20.19.33→20.19.43·`vitest` 4.1.2→4.1.9)은 **M-1 v27로 승격해 Phase 30-1에서 `npm update` 정렬**(diagnostic-v26 L-17 → M-1 v27). 비-긴급 major(@types/express 5·express 5·commander 15·typescript 6·@types/node 25): 즉시 비권장. `tree-sitter-c-sharp` 0.23.1 핀(0.23.5 latest이나 ERR_REQUIRE_ASYNC_MODULE 미해소 → 핀 유지가 옳음).
- **better-sqlite3 직접 재확인(npm 레지스트리 + 웹)**: `npm view better-sqlite3 version dist-tags` = `version = '12.11.1'`·`dist-tags = { latest: '12.11.1' }` — **12.11.1이 npm `latest`·악성 dist-tag 부재**로 *정상 릴리스 확인*. *웹 검색의 "node-gyp 공급망 캠페인 포함·latest non-vulnerable 12.10.0" 문구는 Snyk vuln-DB가 native-모듈 일반론을 프레이밍한 것이지 better-sqlite3 12.11.1 표적 하이재킹이 아니다*(npm `latest`가 12.11.1을 가리키고 12.10.0이 아니므로 — Snyk DB 프레이밍은 캠페인의 native-모듈 일반 경고이며 better-sqlite3 직접 하이재킹/CVE 0건, L-2/L-11 불변). chokidar non-vulnerable, tree-sitter npm 바인딩 직접 CVE 0건(CVE-2026-25727은 Rust `time` 크레이트 — L-14, Cynapx 미도달), vite advisory는 `^8.0.16`로 해소(L-15), express 4.22.2 직접 CVE 0건, @modelcontextprotocol/sdk 1.29.0 직접 CVE 0건. 출처: [Snyk better-sqlite3](https://security.snyk.io/package/npm/better-sqlite3), [expressjs releases](https://github.com/expressjs/express/releases)

### 6.2 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"` + Docker `node:22-bookworm-slim`. Node 22 LTS 2027-04 종료 — 여유. CI Node 22/24 매트릭스 그린(672/672). 문서 Node 버전(L-12, P24-2 해소)은 README/README_KR/GUIDE_EN/GUIDE_KR 전부 ≥ 22 정렬 유지.
- **tree-sitter 코어**: latest 0.25.0, 12 grammar 전부 dedupe/override. **tree-sitter-c-sharp**: 0.23.1 정확 핀 롤백 유지. Node 24 빌드 C++20 fragility([node-tree-sitter#268]·[salesforce/agentscript#7] 여전히 open·미해결 — 진단 일자 재확인) — L-6 추적.
- **better-sqlite3**: lockfile 12.11.1(npm `latest`, P27-2 정렬 — L-11 해소).
- **express**: lockfile 4.22.2(P28-2 정렬 — L-16 해소).
- **vite**: devDependency `^8.0.16`(L-15 해소).
- **within-pin 드리프트(M-1 v27)**: `zod` 4.3.6→4.4.3(prod-dep, 핀-내 minor)·`@types/node` 20.19.33→20.19.43·`vitest` 4.1.2→4.1.9(dev-dep, 핀-내 patch) — Phase 30-1 `npm update`로 정렬.

### 6.3 공급망 캠페인 — Miasma / Phantom Gyp / Node-gyp (계속 활발, Cynapx 도달 0건 불변)

진단 일자 직접 재대조: 캠페인은 *여전히 활발*(2026-06-01 @redhat-cloud-services 32패키지·06-03 @vapi-ai/server-sdk 4버전 + jagreehal 계정 50+패키지 → 57패키지/286악성버전, 157-byte binding.gyp 남용 self-propagating worm — binding.gyp가 `npm install` 중 node-gyp 코드 실행을 트리거해 대부분의 install-script 보안 검사 우회; Bun 런타임 다운로드·npm/GitHub/AWS/GCP/Azure/Vault/K8s 자격증명 탈취·GitHub dead-drop·`.claude`/Cursor/Gemini 설정 persistence 주입·자가전파; Microsoft GitHub 73개 repo 영향 보고). **Cynapx 트리 미도달 재확인**: *in-tree binding.gyp **0개***(직접 `find` 실행), 컴프로마이즈 패키지(@redhat-cloud-services·@vapi-ai/server-sdk·ai-sdk-ollama·jagreehal 패키지군) *not in tree*(`npm ls` = empty), in-tree 설정은 `.claude/launch.json` 1개(양성)·`.cursor`/`.gemini` 부재. CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지. **즉각 변경 불필요, 포스처 추적.** 출처: [StepSecurity Miasma](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm), [Chainguard Miasma](https://www.chainguard.dev/unchained/chainguard-artifacts-safe-from-miasma-phantom-gyp-npm-attack), [OX Security Miasma](https://www.ox.security/blog/600000-monthly-downloads-affected-miasma-supply-chain-attack-is-back-on-npm/), [Snyk node-gyp compromise](https://snyk.io/blog/node-gyp-supply-chain-compromise-self-propagating-npm-worm-binding-gyp/)

### 6.4 MCP 생태계 — SDK v2 여전히 pre-alpha (상태 불변, npm 레지스트리 직접 재확인)

- **MCP SDK v2가 여전히 pre-alpha**(npm 레지스트리 직접 확인): `npm view @modelcontextprotocol/sdk version dist-tags time.modified` = `1.29.0`·`{ latest: '1.29.0' }`·`2026-06-04T19:46:40Z` — **2.x dist-tag 부재**(alpha/beta/rc 미배포). v2는 main 브랜치에서 pre-alpha 개발 중, **stable은 Q3 2026**(스펙 publish 2026-07-28 — *오늘 2026-06-16 기준 한 달 앞이나 아직 미래*) 예정, v1.x가 production 권장·v2 출시 후 최소 6개월 v1.x 유지. → **Cynapx 핀 `^1.29.0` 유지가 옳다. stateless core/Tasks/MCP Apps/Multi-Round-Trip 마이그레이션(L-3)은 v2 stable까지 계속 이연.** **다음 사이클(2026-07-28 스펙 publish 전후)에 2.x dist-tag/v2 stable 출현 재확인이 핵심 외부 트리거** — 출현 시 L-3가 즉시 actionable화한다. 출처: [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk), [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases), [MCP TS SDK V2 docs](https://ts.sdk.modelcontextprotocol.io/v2/)
- **함의**: Cynapx 현 StreamableHTTP(session-id)는 v2 stateless core와 충돌 표면이 있으나 *마이그레이션은 stable 배포까지 이연*이 옳다.

### 6.5 경쟁/인접 도구 동향 (전략 추적 — 카테고리 지속)

- **로컬-퍼스트 코드 그래프 카테고리 지속**: CodeGraph(tree-sitter→SQLite+FTS5 MCP), Serena(LSP-over-MCP), GitNexus(zero-server on-device KG), Codebase-Memory(tree-sitter KG), code-graph-mcp(10개 언어 AST KG) 등이 "로컬·on-device·MCP·임베디드 SQLite·tree-sitter·no-code-egress" 패턴을 표준 기본값으로 정착. Cynapx의 "100% 로컬·격리·멀티프로세스 보안 IPC + risk/remediation/refactoring/policy *처방* 엔진 + 하이브리드(keyword+vector RRF) 검색" 포지션이 차별점. **함의: 처방 엔진 진입 로직(v22)·핵심 보조 순수 로직(RRF·escape, P26-1/P27-1)·정규화 프리미티브(toCanonical, P28-1)·graph 엔진 시딩 프리미티브(mulberry32·env-파서, P29-1)가 전수 게이트 완성됐고 — *내부 순수 함수 게이트 발굴이 소진*돼 신뢰성 차별화 축은 *외부-트리거 기반 위생/마이그레이션*(공급망·SDK v2)으로 이동했다.** 출처: [CodeGraph](https://github.com/colbymchenry/codegraph), [code-graph-mcp](https://github.com/sdsrss/code-graph-mcp)
- **SCIP가 LSIF 대체 심볼 인덱스 표준 정착** — `export_graph`에 SCIP 추가는 미래 상호운용 후보. protobuf 의존 부담으로 즉시 비권장 — 전략 후보 유지.
- **함의**: (1) 공급망 위생 유지(L-11/L-15/L-16 해소 — better-sqlite3·vite·express 정렬, within-pin 드리프트는 M-1 v27로 정렬), (2) MCP SDK v2 pre-alpha→stable 추적(2026-07-28 스펙 publish 전후 재확인), (3) **회귀 안전망은 graph 엔진 시딩 프리미티브까지 확장 완료(P29-1) — 이후는 신규 코드 추가 시에만 확장**.

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 유지보수-모드 재열람에서 신규 prod 코드 결함이 없었다(M-1 v27은 lockfile within-pin 위생 정렬·핀 무변경):

- `src/server/api-server.ts` — 세션 TTL/cap/sweep·timing-safe Bearer·8 REST 핸들러 + /healthz supertest 전수 게이트(P19-1)·rate-limit·session-마스킹 양호. `zod` 스키마 검증 도달(M-1 v27의 prod-dep 도달처 — 4.3.6→4.4.3 핀-내 minor 정렬은 동작 무변경).
- `src/utils/file-filter.ts`·`file-watcher.ts` — glob은 `ignore`/chokidar 위임(직접 RegExp 구성 0 — ReDoS 표면 0), path는 `path.relative`+`..` 가드 위임(path-escape 표면 0). **횡단 위험 부류(v26 A) 음성 불변.**
- `src/utils/paths.ts` — `isPathInside`(H-7, security.test 9케이스)·`isSystemPath`(initialize-project.test)·`getProjectHash`(phase13-8-b)·`toCanonical`(변환 동작, P28-1) 전부 동작까지 게이트됨.
- `src/server/tools/_utils.ts` — `requireEngine`(H-1)·`mergeResultsRRF`(P26-1)·`escapeXml`/`escapeDot`(P27-1) 3개 export 순수 함수 100% 커버.
- `src/graph/graph-engine.ts` — `fisherYatesShuffle`(P14-4)·`mulberry32`·`parseClusterSeed`·`parseClusterMaxNodes`(P29-1) export 순수 함수 4종 *전부 직접 게이트*. Fisher-Yates+seeded PRNG+count-first 가드(200k)+BFS index-pointer 큐 O(V+E) 알고리즘은 정상.
- `src/graph/*`(나머지) — architecture-engine(P22-1)·optimization-engine(P23-2)·remediation-engine(P23-1)·policy-discoverer(P24-1)·refactoring-engine getRiskProfile(P23-3)+proposeRefactor(P25-1) 처방 엔진 5종 진입 로직 전수 게이트.
- `src/indexer/language-registry.ts` — `getProvider()` 정상 매핑·case-insensitivity 직접 게이트(language-registry.test). **단 무-확장자/미지/dotfile/trailing-dot/multi-dot 엣지케이스는 직접 단언 없음(전부 정확 처리 — L-18 비-actionable 추적).**
- `src/server/resource-provider.ts`·`prompt-provider.ts` — MCP resource 4 URI(`tests/resource-provider.test.ts`)·prompt 3개 커버, Unknown McpError 경로 포함. **(v26 E) 음성 불변.**
- `src/server/tool-dispatcher.ts` — 20개 도구 스키마 `required ⊆ properties` 불변식 무결(위반 0), Terminal 포워딩·waitUntilReady·registry lookup·EngineNotReadyError 재시도 변환. **(v26 D) 음성 불변(독립 export 부재로 회귀 테스트 (b) 잣대 미충족).**
- `src/server/tools/*.ts` — `qualified_name` 10개 전수 strict 가드 정합(M-2 v22+v23). `search-symbols.ts` `query` strict 가드(P25-2)·`get-related-tests.ts` strict 가드(P26-2) 확인.
- `src/watcher/file-watcher.ts` — chokidar `ignored` 프레디킷·확장자 allowlist·flush 동시성·타이머 위생·대용량-배치 git-sync 라우팅·재시도/FATAL 강등(P20-1) 정상.
- `src/indexer/update-pipeline.ts` — 단일 책임·catch log-and-rethrow+롤백·원본 에러 보존(미세 항목만 L-9). `toCanonical` 키 정규화 호출은 P28-1 게이트의 다운스트림.
- `src/server/ipc-coordinator.ts` — challenge-response 인증·1MB 제한·per-tool 타임아웃·keepalive(unref)·pending reject-on-close 견고.
- `src/server/workspace-manager.ts`/`health-monitor.ts` — 버전-미스매치 reindex·dispose 순서(watcher→worker→DB)·ledger 일관성 견고.
- `package.json` overrides — tree-sitter `^0.25.0`·fast-uri·qs·hono·postcss 충족, vite `^8.0.16`(L-15 해소), better-sqlite3 lockfile **12.11.1**(P27-2, npm `latest`), express lockfile **4.22.2**(P28-2). dev·prod audit 0/0. within-pin 드리프트(`zod`/`@types/node`/`vitest`)는 M-1 v27로 정렬.
- `README.md`/`README_KR.md`/`GUIDE_EN.md`/`GUIDE_KR.md` — Node ≥ 22 전부 정렬(P24-2, L-12 해소).
- `.github/workflows/ci.yml` — Node 22/24 매트릭스 + `npm audit --omit=dev --audit-level=high`(P14-1) + `npm ci`. (cynapx-autonomous.yml은 본 진단 범위 외.)
- in-tree 에이전트 설정: `.claude/launch.json` 1개(양성), `.cursor`/`.gemini` 부재, in-tree binding.gyp **0개**(L-2 공급망 미도달 재확인).
- 신규 prod 코드: `git log ae69a8b..HEAD` = 테스트-게이트/lockfile/문서 커밋만 — 신규 도구/엔드포인트/유틸 **0건**(게이트할 신규 표면 없음).
- TODO/FIXME/XXX/HACK = 0건(`src/` 전수).

---

## 8. 권장 수정 순서 (Phase 30 제안 — 상세는 phase30-plan.md)

**Phase 29 이후 Cynapx는 *깊은 steady-state*다 — diagnostic-v26 §8 + phase29-plan §4-5가 명시한 대로 *내부 순수 함수 게이트 발굴 사이클이 레이어별로 소진*됐고(graph/ 엔진 진입+시딩·핸들러 가드·`_utils.ts`·`paths.ts` 전수), *연속되던 prod-dep lockfile 정렬 항목도 P28-2(express)로 비었다*.** 본 사이클은 phase29-plan §4-5가 예고한 **외부-트리거 기반 유지보수 포스처**로 정직하게 전환했고, 그 결과를 실측으로 확인했다: **(1) 신규 prod 코드 0**(`git log ae69a8b..HEAD` = 테스트-게이트/lockfile/문서 커밋만 — 게이트할 신규 표면 없음), **(2) 내부 게이트 발굴 소진 재확인**(남은 L-18은 결함 아닌 게이트 공백·비-actionable), **(3) 외부 트리거 모두 정적**(MCP SDK v2 미배포·CVE 0/0·캠페인 미도달·node-tree-sitter#268 open). **따라서 *유일한 actionable은 M-1 v27 lockfile within-pin 위생 정렬*뿐이다** — diagnostic-v26의 L-17(비-actionable 위생 추적)을 *마지막 남은 경량 actionable로 승격*한 것으로, 모든 다른 각도가 소진된 지금 prod 동작 무변경(핀 무변경)으로 닫을 수 있는 유일한 항목이다. CRITICAL/HIGH 0, MEDIUM 1(M-1 v27 lockfile 정렬 — lockfile-only·핀 무변경), LOW(L-2~L-9 v26 승계 + L-13/L-14 승계 + L-18 승계; L-17 → M-1 v27 승격 처리; L-11/L-15/L-16 이전 해소). 따라서 Phase 30은 **lockfile within-pin 정렬(P30-1, `npm update`·핀 무변경) + 추적 갱신**의 *경량 단일-항목 유지보수 사이클*이 합리적이다.

1. **P30-1 [예정]**: M-1 v27 해소 — `npm update`로 within-pin(semver-호환) lockfile 드리프트 3건 정렬(`zod` 4.3.6→4.4.3[prod-dep, 핀-내 minor]·`@types/node` 20.19.33→20.19.43·`vitest` 4.1.2→4.1.9[dev-dep, 핀-내 patch]). `package.json` 핀 무변경(lockfile-only). 정렬 후 `npx vitest run` 672 그린·`npx tsc --noEmit` 그린·`npm audit` 0·`npm audit --omit=dev` 0 + `npm outdated`에서 within-pin 드리프트 0 재확인.
2. **추적 상태 갱신**: L-2(Miasma/Phantom Gyp 도달 0 불변), L-3(SDK v2 *여전히 pre-alpha* — 2026-07-28 스펙 publish 전후 2.x dist-tag 재확인), L-6(node-tree-sitter#268 open), L-7/L-8 게이트 공백, L-9 잔여 클린업, L-13(analyze-impact use_cache 무해), L-14(CVE-2026-25727 time 크레이트 미도달), L-18(getProvider 엣지케이스 게이트 공백) 현 상태를 다음 사이클 출발점으로 고정. **L-17(dev-dep within-pin lockfile 드리프트)은 M-1 v27 → P30-1로 승격 처리 → 추적 종료 예정. L-11(better-sqlite3)·L-15(vite)·L-16(express) 해소 종료 유지.**

(L-4 IPC MessagePack 계속 보류, L-5 클러스터링 본격 파티셔닝 계속 이연, MCP 전면 stateless/task 마이그레이션은 SDK v2 stable 배포까지 이연, SCIP export는 전략 후보로 기록만.)

> **깊은 steady-state 및 향후 사이클 안내**: Phase 26~29가 핸들러 보조(`_utils.ts`)·공통 유틸(`paths.ts`)·graph 엔진 시딩(graph-engine.ts) 순수 함수 레이어의 게이트 발굴을 마무리했고 — *내부 순수 함수 게이트 발굴 사이클이 소진*됐다. **Phase 30은 *마지막 남은 경량 actionable인 lockfile within-pin 정렬*(M-1 v27 → P30-1)을 처리한다 — 이로써 prod-dep within-pin 드리프트까지 0이 된다.** 따라서 **Phase 30 이후 사이클은 *전적으로 외부-트리거 기반*으로 전환된다**: (1) 새 도구/엔진/핸들러/유틸 추가 시의 신규 게이트, (2) 공급망 위생(prod audit·lockfile 드리프트) 정기 점검, (3) **MCP SDK v2 stable 전환(L-3, 2026-07-28 스펙 publish 전후 — *다음 사이클의 핵심 외부 트리거*)**·node-tree-sitter#268 해소(L-6) 같은 *외부 상태 변화* 항목. phase30-plan은 이 *외부-트리거-only 포스처*를 명시하고, *향후 사이클을 더 긴 간격(예: 외부 CVE/SDK 재스캔 위주) 또는 외부-트리거-only 포커스로 운영하는 선택지*를 제안한다(5장 유지보수 포스처). **특히 다음 사이클은 MCP SDK v2 spec publish 일자(2026-07-28)와 맞물려 — v2 stable/2.x dist-tag 출현 시 L-3가 즉시 actionable화하므로, *그 재확인이 다음 사이클의 1순위 외부 트리거*다.**
