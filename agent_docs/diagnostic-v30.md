# Cynapx 정밀 진단 보고서 v30

- **기준 커밋**: `9f4f5a1` (Phase 32-1 완료 — `tests/metrics-calculator.test.ts`에 `calculateCyclomaticComplexityTreeSitter()` null/undefined·빈-decisionPoints 방어 게이트 3 `it` 추가(M-1 v29 해소), 테스트-only·prod 무변경, vitest 678→681, 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-16
- **진단 범위**: **0-의존 순수 함수 게이트 완전 소진 이후의 첫 순수 외부-트리거-only 모니터링 사이클.** Phase 32-1로 *모든 0-의존 순수 함수 게이트 발굴이 완전 소진*됐다(graph/ 엔진 5종 진입+시딩·핸들러 보조·`_utils.ts`·`paths.ts` 순수 함수·`getProvider`·`calculateCyclomaticComplexityTreeSitter`). 본 사이클은 그 이후의 *첫 번째 순수 모니터링 사이클*이다: 신규 prod 코드 0 재확인 + 외부 트리거 체크리스트(T-1~T-7) 재스캔 + audit/lockfile 드리프트 재대조가 전부다.
- **진단 방법**: `git log 9f4f5a1 --oneline`(신규 prod 코드 실측) + `npx vitest run`(681/681·11.51s) + `npx tsc --noEmit`(그린) + `npm audit --omit=dev` / `npm audit`(둘 다 0) + `npm outdated`(Current=Wanted 전 행, within-pin 드리프트 0) + `npm ls`(핵심 패키지 버전 직접 대조) + `npm view @modelcontextprotocol/sdk dist-tags time.modified`(MCP SDK v2 상태 재확인) + `find . -name binding.gyp -not -path "*/node_modules/*"`(in-tree binding.gyp 0개 재확인).
- **현재 상태(직접 검증)**: `npx vitest run` **681/681**(47 파일, 11.51s — P32-1로 678→681), `npx tsc --noEmit` 그린, **`npm audit`(dev 포함) = 0 vulnerabilities**, **`npm audit --omit=dev`(prod) = 0 vulnerabilities**. diagnostic-v29 전 항목 처리 완료(M-1 v29 [DONE — P32-1]).

> **요약**: **이 사이클은 *0-의존 순수 함수 게이트 완전 소진 이후의 첫 순수 외부-트리거-only 모니터링 사이클*이다 — 신규 prod 코드·actionable CVE·내부 게이트 후보 *전부 0건*이며, 외부 트리거 체크리스트(T-1~T-7) 전부 미발화 상태 불변.** **(1) 신규 prod 코드 0**: `git log 9f4f5a1 --oneline` = `9f4f5a1`(P32-1 metrics-calculator null-guard 게이트)·`98c3a93`(phase32 docs)·이전 커밋 — *전부 테스트-게이트/docs 커밋*, 신규 MCP 도구·REST 엔드포인트·유틸 함수 **0건**. **(2) 내부 게이트 후보 0**: 0-의존 순수 함수 게이트 발굴이 P32-1로 **완전 소진**됨(graph/ 엔진 5종 진입·시딩 4종·`_utils.ts` 3 export·`paths.ts` 순수 함수 4종·`getProvider` 엣지케이스·`calculateCyclomaticComplexityTreeSitter` null-guard). 유일한 미커버 순수 함수 `getDirSizeMB`는 fs-의존 비-순수라 (b) 잣대 미충족(L-20 불변). **(3) 외부 트리거 전부 미발화**: ① **T-1 MCP SDK v2 — 여전히 pre-alpha**: `npm view @modelcontextprotocol/sdk dist-tags` = `{ latest: '1.29.0' }`·`time.modified = '2026-06-04T19:46:40Z'`(v29 대비 불변) — 2.x dist-tag 부재, v2 stable Q3 2026(스펙 publish 2026-07-28 — *오늘 2026-06-16 기준 ~6주 앞*); ② **T-2 신규 CVE — prod·dev audit 0/0, 거론 CVE 전부 미도달**: CVE-2026-6991(zod ≤4.3.6, L-19 불변)·CVE-2026-47428/47429(vitest browser/UI, L-21 불변)·CVE-2026-25727(Rust `time` 크레이트, L-14 불변); ③ **T-3 신규 prod 코드 0**; ④ **T-4 within-pin 드리프트 0**: `npm outdated` Current=Wanted 전 행(zod 4.4.3·vitest 4.1.9·better-sqlite3 12.11.1·express 4.22.2·vite 8.0.16·@modelcontextprotocol/sdk 1.29.0 — 전부 lockfile=wanted); ⑤ **T-5/T-6 node-tree-sitter#268 여전히 open·tree-sitter-c-sharp 0.23.5 ERR_REQUIRE_ASYNC_MODULE 미해소**; ⑥ **T-7 Miasma/Phantom Gyp 미도달**: in-tree binding.gyp 0개 불변. **(4) 신규 LOW 후보 1건(L-22, major 의존성 누적)**: `npm outdated`에서 *within-pin 정렬(Current=Wanted) 밖의 major* 업그레이드 항목이 다수 누적됨 — express 4.22.2→5.2.1(Major)·typescript 5.9.3→6.0.3(Major)·@types/node 20.19.43→25.9.3(Major)·@types/express 4.17.25→5.0.6(Major)·commander 14.0.3→15.0.0(Major)·tree-sitter-c-sharp 0.23.1→0.23.5(T-6 연관·ERR_REQUIRE_ASYNC_MODULE 미해소). 이들은 *핀 변경 + 호환성 검토 수반*이라 즉시 비권장이나 — 목록 기록·다음 major 마이그레이션 페이즈 후보(L-22, 비-actionable 추적). **CRITICAL 0, HIGH 0, MEDIUM 0(M-1 v29 [P32-1 해소]), LOW(L-2~L-9·L-13·L-14·L-19·L-20·L-21 v29 승계 + L-22 신규[major 의존성 누적, 비-actionable 추적]).**

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건은 Phase 13에서, v11 HIGH(공급망)는 Phase 14-1에서, v12~v18 MEDIUM은 Phase 15~21에서, v19~v29 MEDIUM은 Phase 22~32에서 모두 해소됐다. 본 사이클 신규 CRITICAL 0건. IPC 핸드셰이크(challenge + HMAC-SHA256 + timingSafeEqual)·API Bearer(SHA-256 + timingSafeEqual)·세션 맵(TTL+cap+sweep unref) 모두 견고. **prod·dev audit 0/0.**

---

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** 신규 prod 코드 0(`git log 9f4f5a1` = 테스트-게이트/docs 커밋만)이라 신규 결함 표면 자체가 없다. **prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0**(직접 재검증). 거론된 신규 CVE(CVE-2026-6991·CVE-2026-47428/47429·CVE-2026-25727) 모두 버전·기능·플랫폼 삼축 미도달(L-19/L-21/L-14 불변).

---

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

**없음(M-1 v29 [P32-1 해소]).** diagnostic-v29에서 식별된 마지막 0-의존 순수 함수 후보(M-1 v29 — `calculateCyclomaticComplexityTreeSitter()` null/undefined·빈-decisionPoints 게이트)가 Phase 32-1에서 해소됐다. **이로써 *모든 비-TS 언어(12종)의 함수/메서드 인덱싱이 의존하는 CC 측정 핫패스의 방어적 null-guard까지 게이트됐고 — 0-의존 순수 함수 게이트 발굴이 완전 소진됐다.***

현재 사이클에서 신규 MEDIUM 후보를 탐색한 결과:
- **내부 신규 게이트 후보**: 0 (0-의존 순수 함수 발굴 완전 소진 — 미커버 `getDirSizeMB`는 fs-의존 비-순수로 L-20 불변)
- **외부 신규 actionable CVE**: 0 (audit 0/0, 거론 CVE 전부 미도달)
- **신규 prod 코드**: 0 (`git log 9f4f5a1` = 테스트-게이트/docs만)

→ **본 사이클은 MEDIUM 0건의 순수 모니터링 사이클이다.**

---

## 4. 최적화 (LOW) — 추적/이연 (v29 승계 + L-22 신규)

| # | 위치 | 내용 |
|---|------|------|
| L-2(v30) | `package.json` (native deps), CI / Dockerfile, `.claude/` 설정 | **Miasma / Phantom Gyp / Node-gyp 공급망 캠페인 포스처 추적 — Cynapx 도달 0건 불변.** 진단 일자 재대조: 2026-06-03~04 wave2 이후 신규 wave 보고 없음(57패키지/286악성버전, 157-byte binding.gyp 남용 self-propagating worm). **Cynapx 트리 미도달**: in-tree binding.gyp **0개**(직접 `find` 재확인), 컴프로마이즈 패키지 not in tree, `.claude/launch.json` 1개(양성)·`.cursor`/`.gemini` 부재. CI `npm ci` + P14-1 audit 게이트 유지. **즉각 조치 불필요 — 추적만.** |
| L-3(v30) | `src/server/api-server.ts` (session-id StreamableHTTP), `package.json:29`(`@modelcontextprotocol/sdk ^1.29.0`) | **MCP SDK v2 — 여전히 pre-alpha(상태 불변, npm 직접 재확인).** `npm view @modelcontextprotocol/sdk dist-tags time.modified` = `{ latest: '1.29.0' }`·`2026-06-04T19:46:40Z`(v29 대비 불변). 2.x dist-tag 부재. v2 stable Q3 2026·**스펙 publish 2026-07-28**(*오늘 2026-06-16 기준 ~6주 앞*). → Cynapx 핀 `^1.29.0` 유지가 옳음. stateless protocol core·Multi-Round-Trip·MCP Apps 마이그레이션은 v2 stable 전환까지 계속 이연. **다음 사이클(2026-07-28 전후)에 2.x dist-tag/v2 stable 출현 재확인이 핵심 외부 트리거(T-1, ★1순위).** 출처: [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) |
| L-4(v30) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환. **성능 문제 미관측 — 계속 보류.** |
| L-5(v30) | `src/graph/graph-engine.ts` | 클러스터링 본격 서브그래프 파티셔닝 — 100k+ 노드 실측 시 재검토(계속 이연). LPA O(V+E)·MAX_ITER=20 캡·count-first 가드(200k)·Fisher-Yates seeded PRNG(`mulberry32`) 직접 재확인 정상. |
| L-6(v30) | CI / Dockerfile | Node 24 + tree-sitter 0.25.x 빌드 fragility(node-tree-sitter#268 여전히 open, CVE 아님). CI Node 22/24 매트릭스 그린이나 Node 24 LTS 전환 전 prebuild 재확인. tree-sitter-c-sharp 0.23.5 ERR_REQUIRE_ASYNC_MODULE 여전히 미해소(0.23.1 핀 롤백 유지). **추적만.** |
| L-7(v30) | `src/cli/admin.ts` (cmd* 9개), `tests/admin-cli.test.ts` | admin CLI 명령 동작의 vitest 게이트 공백 — 모듈-private, 비-actionable 추적. |
| L-8(v30) | `src/indexer/worker-pool.ts`, `embedding-manager.ts`, `db/database.ts` | 에러-복구·마이그레이션 잔여 분기의 vitest 게이트 공백 — 타이밍-flaky 위험, 비-actionable 추적. |
| L-9(v30) | `src/indexer/update-pipeline.ts`, `embedding-manager.ts:184`/`api-server.ts:625` | L-9 코드 클린업 잔여 — (b) 잣대 미충족, 비-actionable 추적. |
| L-13(v30) | `src/server/tools/analyze-impact.ts:23` | `analyze-impact` use_cache 스키마-default 미강제 — 무해, 추적만(비-actionable). |
| L-14(v30) | 외부 — Rust `time` 크레이트(CVE-2026-25727) | Cynapx prod 트리 미도달 불변(npm tree-sitter 바인딩에 `time` 크레이트 부재). 추적만. |
| L-19(v30) | 외부 — zod ≤ 4.3.6 (CVE-2026-6991 CUID SQL injection) | zod 4.4.3·`.cuid()` 미사용·parameterized binding 삼중 미도달(불변). 추적만. |
| L-20(v30) | `src/utils/paths.ts:304`(`getDirSizeMB`) | fs-의존 비-순수, (b) 잣대 미충족 — get-setup-context fixture 테스트 페이즈 후보, 추적만. |
| L-21(v30) | 외부 — vitest browser/UI (CVE-2026-47428/47429) | vitest 4.1.9(fix 4.1.6/4.1.0 초과) + browser/UI 미사용 + 47429 Windows 전용 삼중 미도달(불변). 추적만. |
| **L-22(v30)** *(신규 — major 의존성 누적 목록, 비-actionable 추적)* | `package.json`, `node_modules/*` | **`npm outdated`에서 within-pin 정렬(Current=Wanted) 밖의 major 업그레이드 항목 다수 누적 — 핀 변경·호환성 검토 수반이라 즉시 비권장, 기록만.** 목록: express 4.22.2→5.2.1(Major)·typescript 5.9.3→6.0.3(Major)·@types/node 20.19.43→25.9.3(Major)·@types/express 4.17.25→5.0.6(Major)·commander 14.0.3→15.0.0(Major)·tree-sitter-c-sharp 0.23.1→0.23.5(T-6 연관·ERR_REQUIRE_ASYNC_MODULE 미해소). **express 5 마이그레이션**은 API 변경(Router/middleware 시그니처 변경, error-handler 4-arg 변경)·express-rate-limit/swagger-ui-express 호환성 검토 필요. **typescript 6**는 strictness 강화로 타입 에러 발생 가능. 이들은 *대규모 호환성 검토를 수반*해 별도 major 마이그레이션 페이즈에서 신중히 처리해야 하며 — 즉시 적용하면 회귀 위험이 높다. **verdict: 추적만(비-actionable, 별도 major 마이그레이션 페이즈 후보).** |

> **L-18 해소 안내**: diagnostic-v26 신규 L-18(`LanguageRegistry.getProvider()` 확장자 엣지케이스 직접 테스트 공백)은 **Phase 31-1(M-1 v28)에서 해소**됐다. **추적 종료.** M-1 v29(metrics-calculator null-guard)는 **Phase 32-1에서 해소**됐다. L-17(within-pin lockfile)은 P30-1에서, L-16(express)은 P28-2에서, L-11(better-sqlite3)·L-15(vite)는 이전 사이클에서 이미 해소 — 추적 종료 유지.

---

## 5. 코드 품질 / 성능 전수 (steady-state 재확인)

Phase 32-1로 *0-의존 순수 함수 게이트 발굴이 완전 소진*됐다. 본 사이클에서 신규 prod 코드가 없으므로 코드 품질 변화 없이 재확인만 수행한다.

**(A) 신규 prod 코드 실측 — `git log 9f4f5a1 --oneline`(head)**

| 커밋 | 내용 | 분류 |
|------|------|------|
| `9f4f5a1` | P32-1: gate calculateCyclomaticComplexityTreeSitter null/empty boundaries (M-1 v29) | 테스트-게이트(prod 무변경) |
| `98c3a93` | Phase 32 cycle: diagnostic-v29 + phase32-plan | 문서 |
| `dfb9dd5` | P31-1: gate getProvider() extension edge cases (M-1 v28) | 테스트-게이트(prod 무변경) |

핵심: 9f4f5a1 head = *테스트-게이트/docs 커밋만*, 신규 MCP 도구·REST 엔드포인트·유틸 함수 **0건**.

**(B) 전수 게이트 현황 — Phase 32-1로 완전 소진**

| 레이어 | 게이트된 함수/항목 | 최종 처리 |
|--------|--------------------|-----------|
| graph/ 엔진 진입 | `NodeRepository.getParent`·`EdgeRepository.getCyclomaticComplexity`·`GraphEngine.clusterByLanguage`·`proposeRefactor`·`getRemediationStrategy`(5종 처방 엔진) | P22-1~P25-1 |
| graph/ 엔진 시딩 | `mulberry32`·`parseClusterSeed`·`parseClusterMaxNodes`·`fisherYatesShuffle` | P29-1·P14-4 |
| 핸들러 보조 순수 로직 | `mergeResultsRRF`·`escapeXml`·`escapeDot`(3 export) | P26-1·P27-1 |
| qualified_name strict 가드 | 10개 핸들러 전수 | P26-2 |
| 공통 유틸 정규화 | `toCanonical`·`isPathInside`·`isSystemPath`·`getProjectHash` | P28-1·기존 |
| indexer 확장자 매핑 | `getProvider()` 엣지케이스(무-확장자·미지·dotfile·trailing-dot·multi-dot) | P31-1 |
| indexer 메트릭 계산 | `calculateCyclomaticComplexityTreeSitter()` null/undefined·빈-dp 가드 | **P32-1** |

**이로써 graph/ 엔진(5종 진입+4종 시딩)·핸들러 보조·공통 유틸·indexer 확장자 매핑·indexer 메트릭 계산 *모든 레이어*의 0-의존 순수 함수 게이트 발굴이 완전 소진됐다.** 이후 신규 도구/엔진/핸들러/유틸 추가 시에만 확장(현재 신규 prod 코드 0 — T-3).

**(C) 의존성 lockfile 드리프트 — within-pin 0(P30-1 완료) + major 누적 목록(L-22)**

| 패키지 | lockfile | npm latest | within-pin | 분류 |
|--------|----------|------------|------------|------|
| `zod` | 4.4.3 | 4.4.3 | 드리프트 0 | prod-dep, CVE-2026-6991 범위 밖(L-19) |
| `vitest` | 4.1.9 | 4.1.9 | 드리프트 0 | dev-dep, CVE-2026-47428/47429 범위 밖(L-21) |
| `better-sqlite3` | 12.11.1 | 12.11.1 | 드리프트 0 | prod-dep(P27-2) |
| `express` | 4.22.2 | 5.2.1 | Current=Wanted 0 | prod-dep(P28-2); 5.x **Major**(L-22) |
| `vite` | 8.0.16 | — | 드리프트 0 | dev-dep(L-15) |
| `@modelcontextprotocol/sdk` | 1.29.0 | 1.29.0 | 드리프트 0 | prod-dep(2.x dist-tag 부재 — L-3) |
| `typescript` | 5.9.3 | 6.0.3 | Current=Wanted 0 | dev-dep; **Major**(L-22) |
| `tree-sitter-c-sharp` | 0.23.1 | 0.23.5 | Current=Wanted 0 | prod-dep; 0.23.5 ERR_REQUIRE_ASYNC_MODULE 미해소(L-6/T-6) |

핵심: within-pin 드리프트 **0**(P30-1 완료). Major 업그레이드 다수 누적이나 *핀 변경 수반·호환성 검토 필요*(L-22 비-actionable). tree-sitter-c-sharp 0.23.5는 T-6(ERR_REQUIRE_ASYNC_MODULE 미해소) 연관.

**(D) 외부 트리거 체크리스트 재스캔 (T-1~T-7 전부 미발화)**

| # | 트리거 | 상태(2026-06-16) |
|---|--------|-----------------|
| T-1 | MCP SDK 2.x dist-tag / v2 stable 출현 | **미발화** — `dist-tags = { latest: '1.29.0' }`·2.x dist-tag 부재·`time.modified` 2026-06-04(불변). stable Q3 2026·스펙 publish 2026-07-28(~6주 앞) |
| T-2 | 신규 CVE Cynapx 도달 | **미발화** — audit 0/0, 거론 CVE 전부 미도달(L-14/L-19/L-21 불변) |
| T-3 | 신규 prod 코드 추가 | **미발화** — `git log 9f4f5a1` = 테스트-게이트/docs 커밋만(신규 prod 표면 0) |
| T-4 | within-pin lockfile 드리프트 누적 | **미발화** — `npm outdated` Current=Wanted 전 행(major 제외) |
| T-5 | node-tree-sitter#268 해소 + Node 24 LTS 전환 | **미발화** — #268 여전히 open |
| T-6 | tree-sitter-c-sharp 0.23.6+ ERR_REQUIRE_ASYNC_MODULE 해소 | **미발화** — 0.23.5 미해소, 0.23.1 핀 유지 |
| T-7 | Miasma/Phantom Gyp Cynapx 의존 트리 도달 | **미발화** — in-tree binding.gyp 0개 불변 |

**(E) prod steady-state 재확인**

| 항목 | 판정 |
|------|------|
| god-module / 순환 import | 0 — repos→engines→server/pipeline 단방향 불변 |
| TODO/FIXME/XXX/HACK | 0건(`src/` 전수) |
| 핫패스 O(n²)-over-nodes | 0 — 클러스터링 count-first 가드(200k)+seeded PRNG, BFS index-pointer 큐, 반복 DFS+60s 캐시, architecture-engine O(1) Map, CC 측정 반복 DFS 스택(재귀 회피) |
| prod·dev audit | 0 / 0 vulnerabilities |
| 테스트 | `npx vitest run` **681/681**(47 파일, 11.51s) — P32-1로 678→681 |

---

## 6. 외부 컨텍스트 재스캔 (직접 확인 항목 중심)

### 6.1 의존성 취약점 (prod·dev 둘 다 clean)

- **`npm audit`(dev 포함) = 0 + `npm audit --omit=dev`(prod) = 0**(직접 재확인, 불변).
- CVE-2026-6991(zod CUID, L-19): zod 4.4.3·`.cuid()` 미사용·parameterized binding 삼중 미도달 불변.
- CVE-2026-47428/47429(vitest browser/UI, L-21): vitest 4.1.9 + browser/UI 미사용 + 47429 Windows 전용 삼중 미도달 불변.
- CVE-2026-25727(Rust `time` 크레이트, L-14): npm 바인딩 미도달 불변.

### 6.2 MCP 생태계 — SDK v2 여전히 pre-alpha (상태 불변)

`npm view @modelcontextprotocol/sdk dist-tags time.modified` = `{ latest: '1.29.0' }`·`2026-06-04T19:46:40Z`(v29 대비 불변). 2.x dist-tag 부재. v2 stable Q3 2026·**스펙 publish 2026-07-28** — *오늘 2026-06-16 기준 ~6주 앞*. **다음 사이클에서의 T-1 재확인이 핵심 외부 트리거.** 출처: [npm @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)

### 6.3 공급망 캠페인 (Miasma / Phantom Gyp — 도달 0건 불변)

2026-06-03~04 wave2 이후 신규 wave 보고 없음. Cynapx in-tree binding.gyp **0개** 불변. 캠페인 자체는 여전히 활발이나 Cynapx 미도달(L-2 불변). 출처: [StepSecurity Miasma](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm)

### 6.4 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"` + Docker `node:22-bookworm-slim`. CI Node 22/24 매트릭스 681/681 그린. Node 22 LTS 2027-04 종료 — 여유.
- **tree-sitter**: 0.25.0, 12 grammar dedupe/override. tree-sitter-c-sharp 0.23.1 핀(0.23.5 ERR_REQUIRE_ASYNC_MODULE 미해소, T-6).
- **within-pin 드리프트**: **0**(P30-1 완료). Major 누적(L-22) 목록 기록.

---

## 7. 깨끗하게 확인된 영역

- `src/server/api-server.ts` — 세션 TTL/cap/sweep·timing-safe Bearer·8 REST 핸들러 + /healthz supertest 전수 게이트(P19-1)·rate-limit·세션-마스킹 양호. zod 4.4.3(CVE-2026-6991 범위 밖·`.cuid()` 미사용).
- `src/utils/paths.ts` — `isPathInside`·`isSystemPath`·`getProjectHash`·`toCanonical` 전부 직접 게이트됨. `getDirSizeMB`만 fs-의존 비-순수(L-20).
- `src/indexer/metrics-calculator.ts` — TS-AST CC·tree-sitter CC 본체(Rust/Go/Java/Python/TS 실파스 12 `it`)·**null/undefined·빈-dp 가드(P32-1)** 전수 게이트 완료.
- `src/server/tools/_utils.ts` — `requireEngine`·`mergeResultsRRF`·`escapeXml`·`escapeDot` 3개 export 순수 함수 100% 커버.
- `src/graph/graph-engine.ts` — `fisherYatesShuffle`·`mulberry32`·`parseClusterSeed`·`parseClusterMaxNodes` export 순수 함수 4종 전부 직접 게이트.
- `src/graph/*`(나머지) — 처방 엔진 5종 진입 전수 게이트(P22-25).
- `src/indexer/language-registry.ts` — `getProvider()` 정상 매핑·case-insensitivity·엣지케이스(P31-1) 전수 게이트. native grammar 로드 실패 graceful degrade 정상.
- `src/server/resource-provider.ts`·`prompt-provider.ts` — MCP resource 4 URI·prompt 3개 커버, Unknown McpError 포함.
- `src/server/tool-dispatcher.ts` — 20개 도구 스키마 `required ⊆ properties` 불변식 무결.
- `src/server/tools/*.ts` — `qualified_name` 10개 전수 strict 가드 정합.
- `src/watcher/file-watcher.ts` — chokidar `ignored`·확장자 allowlist·flush 동시성·타이머 위생·재시도/FATAL 강등(P20-1) 정상.
- `src/server/ipc-coordinator.ts` — challenge-response 인증·1MB 제한·per-tool 타임아웃·keepalive(unref) 견고.
- `package.json` overrides — tree-sitter `^0.25.0`·vite `^8.0.16`·better-sqlite3 12.11.1·express 4.22.2·zod 4.4.3·vitest 4.1.9. prod·dev audit 0/0. within-pin 드리프트 0.
- `.github/workflows/ci.yml` — Node 22/24 매트릭스 + `npm audit --omit=dev --audit-level=high` + `npm ci`.
- in-tree 에이전트 설정: `.claude/launch.json` 1개(양성), `.cursor`/`.gemini` 부재, in-tree binding.gyp **0개**(L-2 미도달 재확인).
- 신규 prod 코드: `git log 9f4f5a1` = 테스트-게이트/docs 커밋만 — 신규 도구/엔드포인트/유틸 **0건**.
- TODO/FIXME/XXX/HACK = 0건(`src/` 전수).

---

## 8. 권장 수정 순서 (Phase 33 제안 — 상세는 phase33-plan.md)

**Phase 32-1로 Cynapx는 *0-의존 순수 함수 게이트 발굴 완전 소진 + lockfile 위생 steady-state*에 도달했다.** 본 사이클(diagnostic-v30)은 그 이후의 첫 순수 모니터링 사이클이며 — **신규 prod 코드·MEDIUM 항목·lockfile 드리프트·actionable CVE 전부 0건, 외부 트리거(T-1~T-7) 전부 미발화**가 확인됐다.

따라서 **Phase 33은 actionable 구현 항목이 없는 *모니터링 사이클***이다: (1) 추적 갱신(L-2~L-9·L-13·L-14·L-19~L-22), (2) docs-only 커밋, (3) 외부 트리거 체크리스트 + 유지보수 포스처 갱신. 다음 actionable은 아래 외부 트리거 중 하나의 발화를 기다린다:

1. **T-1 [★1순위 임박]**: MCP SDK 2.x dist-tag / v2 stable 출현(2026-07-28 스펙 publish 전후) → L-3 즉시 actionable화, stateless core / Tasks / MCP Apps 마이그레이션 착수.
2. **T-2**: 신규 CVE Cynapx 실도달 → 버전·기능·플랫폼 삼축 도달 확인 후 `overrides`/floor bump 패치.
3. **T-3**: 신규 prod 코드 추가(새 MCP 도구·REST 엔드포인트·엔진·유틸) → 신규 표면의 0-의존 순수 로직·인자 가드 vitest 게이트 추가.
4. **T-4**: within-pin lockfile 드리프트 누적 → `npm update`(핀-내) 정렬.
5. **T-5/T-6**: node-tree-sitter#268 해소 또는 tree-sitter-c-sharp 0.23.6+ ERR_REQUIRE_ASYNC_MODULE 해소 → Node 24 전환 / c-sharp 핀 정렬.
6. **L-22 [별도 major 마이그레이션 페이즈]**: express 5·typescript 6·@types/* major 업그레이드 — 회귀 위험 높으므로 별도 전용 페이즈에서 신중히.

**CRITICAL 0, HIGH 0, MEDIUM 0, LOW(L-2~L-9·L-13·L-14·L-19~L-22 추적). Phase 33 = docs-only 모니터링 사이클.**
