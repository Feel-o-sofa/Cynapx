# Cynapx 정밀 진단 보고서 v18

- **기준 커밋**: `e0e66ef` (Phase 20 + Phase 20-1 완료, 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-15
- **진단 범위**: src/ 전체(server, db, indexer, graph, watcher, utils, cli, bootstrap), schema/, scripts/, tests/ 전체, src-native/, Dockerfile, `.github/workflows/ci.yml`, `.claude/launch.json`, package.json/lockfile, README.md/GUIDE + 외부 컨텍스트(CVE/advisory, 공급망 캠페인, MCP 생태계, 경쟁 도구)
- **진단 방법**: 단일 에이전트 오케스트레이션 + 병렬 서브에이전트 전수 코드 리뷰 + 로컬 직접 검증(`npx vitest run`[시간 측정 포함], `npx tsc --noEmit`, `npm audit --omit=dev` 및 `npm audit`[dev 포함], `npm ls`로 전이 의존 버전 확인, `npm view`로 registry `latest`/dist-tag 확인) + **신규 각도: v15~v17의 3중 교차 대조(레지스트리 ↔ 테스트 ↔ CI 게이트)의 무위험 수확이 L-7/L-8에서 소진된 것으로 판단해, 본 사이클은 "테스트 격차"가 아니라 *코드 품질/아키텍처·성능·문서 동기화·dev 공급망 위생*으로 진단 각도를 전환** — (a) 모듈 성장/분해 필요성·TODO·에러 핸들링 일관성, (b) 핫패스 O(n²) 패턴 + 테스트 스위트 실행 시간 추세, (c) README ↔ 실제 피처(20 MCP 도구·8 REST 라우트·임베딩·클러스터링·progress) 동기화, (d) dev/prod 양쪽 audit 전수 + L-4/L-5/L-7/L-8/SCIP actionability 임계 재평가 + 웹 검색·페치 기반 외부 재조사(진단 일자 재실행)
- **현재 상태(직접 검증)**: `npx vitest run` **593/593**(43 파일, **6.72s** — 빠름·추세 무문제), `npx tsc --noEmit` 그린, **`npm audit --omit=dev` = 0 vulnerabilities**(prod 트리 clean — Phase 14-1 baseline 유지). **단, `npm audit`(dev 포함)에서 신규 moderate 1건 — `postcss < 8.5.10` XSS(GHSA-qx2v-qp2m-jg93), vitest→vite@8.0.8→postcss@8.5.8 전이 dev 의존**(직접 확인). diagnostic-v17 전 항목(M-1 v17 [DONE — Phase 20-1], LOW 7건 추적/이연).

> **요약**: **v13~v17의 5연속 "발견" 사이클(레지스트리↔테스트↔게이트 3중 대조의 점진 확장 — MCP 도구→REST 핸들러→이벤트 핸들러)은 L-7/L-8에서 무위험 actionable 수확이 사실상 소진됐다. 본 사이클은 정직하게 *각도를 전환*해 코드 품질·성능·문서·dev 공급망을 회의적으로 전수했고, 그 결과 (1) 실재하는 dev 전용 공급망 위생 항목 1건과 (2) README 문서 동기화 격차 1건을 새로 발견했다.** **prod 코드 동작 측면은 여전히 steady-state — CRITICAL/HIGH 0, prod audit 0 vulnerabilities, TODO/FIXME 0건, 핫패스 O(n²)-over-nodes 없음(count-first 가드 + Fisher-Yates seeded PRNG 직접 재확인), 모듈 god-object/순환 의존 없음.** **신규 신호 둘: (A) `postcss < 8.5.10` moderate XSS가 vitest→vite 전이 dev 의존으로 트리에 진입했다(`npm audit` dev 포함 직접 확인, prod `--omit=dev`는 여전히 0). postcss는 Cynapx 런타임 경로(CSS/HTML 처리 없음)에 도달 불가하나, *v17 fast-uri(Phase 16-1)·qs·hono와 동형의 `overrides` 패치-floor*로 무위험·additive하게 dev 트리를 clean화할 수 있다. (B) README.md가 현 피처셋과 3곳 어긋난다 — `Node.js ≥ 20`(실제 `engines: ">=22"`), `export_graph` 설명이 "Mermaid + JSON"만 언급(실제 `json`/`graphml`/`dot` 3포맷, export-graph.ts:20-58), REST API(8 라우트) 전면 미문서화.** 두 항목 모두 **prod 코드 동작 무변경**(override는 dev 트리만, README는 docs)이라 무위험이다. **코드 품질 전수 결과(서브에이전트 전수 리뷰): 분해가 필요한 god-module 없음(openapi.ts 881줄은 정적 OpenAPI 스키마 리터럴이라 분해 비권장, update-pipeline.ts 591줄은 단일 책임 응집)**. 단 3건의 *선택적·비-긴급* 클린업 후보를 정직하게 기록한다(architecture-engine.ts:179 사이클-당 O(E) `edges.find` 스캔, update-pipeline 트랜잭션 보일러플레이트 `withWriteTransaction` 추출, update-pipeline의 progress용 `log.error` 오분류) — 전부 prod 코드 변경 수반이라 "무위험 사이클" 원칙상 본 사이클 비-actionable, L-9로 추적만. 외부는 신선 재조사: **MCP SDK v2 여전히 npm 미배포**(latest 1.29.0, stable Q3 2026/~7-28 예고 불변), **node-tree-sitter#268 여전히 open·미해결**, **Miasma 캠페인 계속 진행 중이나 Cynapx 트리·in-tree 설정 도달 0건 불변**(`.claude/launch.json` 양성, `.cursor`/`.gemini` 부재 직접 재확인). **CRITICAL 0, HIGH 0, MEDIUM 1(M-1 v18, 신규 — postcss dev 공급망 위생, 무위험 override), LOW 8(L-2~L-8 v17 승계 추적/이연 + L-9 신규 — README 동기화는 actionable docs로 분리, 코드 클린업 3건은 비-actionable 추적).**

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건(C-1 Docker 배포 전손, C-2 사이드카 spawn 크래시, C-3 IPC 인증 무력화)은 Phase 13에서, v11의 HIGH 1건(N-1 공급망)은 Phase 14-1에서, v12 MEDIUM 4건은 Phase 15에서, v13 MEDIUM 1건(fast-uri floor)은 Phase 16에서, v15 MEDIUM 1건(도구 디스패처 게이트)은 Phase 18-1에서, v16 MEDIUM 1건(REST 핸들러 게이트)은 Phase 19-1에서, v17 MEDIUM 1건(FileWatcher 대용량-배치/복구 게이트)은 Phase 20-1에서 해소됐고, 본 전수 재열람에서 새로운 CRITICAL/HIGH는 발견되지 않았다. IPC 핸드셰이크는 random challenge + `HMAC-SHA256(nonce, challenge)` + `timingSafeEqual`로 견고하고, API Bearer는 SHA-256 후 `timingSafeEqual`, 세션 맵은 TTL+cap+sweep(unref)로 보호된다(직접 재열람 확인).

---

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** 코드·공급망 어디에서도 신규 HIGH는 발견되지 않았다. **prod `npm audit --omit=dev` = 0 vulnerabilities**(직접 재검증, 6.1 참조). M-1 v18(postcss dev 의존)은 (a) **dev-only**(prod 트리 미진입 — `--omit=dev` 여전히 0), (b) postcss XSS는 *user-supplied CSS를 HTML `<style>`에 재직렬화*할 때만 트리거되는데 **Cynapx는 CSS/HTML을 일절 처리하지 않으므로 런타임 도달 경로 0**, (c) vitest가 vite를 빌드 도구로 끌어올 뿐 Cynapx 테스트는 CSS 변환을 안 탐 → **현재 익스플로잇 가능 결함이 아니라 dev 트리 위생 격차**이므로 HIGH가 아니라 MEDIUM(무위험 override로 floor 못 박기)으로 정직하게 등급한다. 외부 공급망 사건(Miasma, 6.3)도 Cynapx 의존 트리·in-tree 설정에 도달하지 않으므로 LOW(포스처 추적, L-2)로 다룬다.

---

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

| # | 위치 | 내용 |
|---|------|------|
| **M-1 v18** *(신규, actionable, 무위험 override — dev 공급망 위생)* **[DONE — Phase 21-1]** | `package.json` `overrides` (+ lockfile), 전이 경로 `vitest@4.1.2 → vite@8.0.8 → postcss@8.5.8` | **[DONE — Phase 21-1]** `overrides`에 `"postcss": "^8.5.10"` 추가 → `npm install` 후 전이 postcss 8.5.8 → **8.5.15**로 승격(`npm why postcss` = "dev overridden" 확인). **`npm audit`(dev 포함) = 0 vulnerabilities**(postcss moderate 해소), **`npm audit --omit=dev` = 0**(불변). `npx vitest run` 593/593 그린·`npx tsc --noEmit` 그린. ─── (원 진단) **postcss `< 8.5.10` moderate XSS(GHSA-qx2v-qp2m-jg93)가 vitest 전이 dev 의존으로 트리에 진입 — prod 미도달이나 dev 트리 위생 격차.** 본 사이클 `npm audit`(dev 포함) 직접 실행에서 신규 moderate 1건이 드러났다: **`postcss < 8.5.10`**(고지 2026-04-20, CVSS 6.1) — CSS AST를 문자열로 재직렬화할 때 `</style>` 시퀀스를 escape하지 않아 HTML `<style>` 임베드 시 XSS. 전이 경로는 `vitest@4.1.2 → @vitest/mocker/vite@8.0.8 → postcss@8.5.8`(`npm why postcss` 직접 확인 — 전부 dev). **`npm audit --omit=dev`(prod)는 여전히 0 vulnerabilities** — postcss는 prod 의존 트리에 없고, 게다가 Cynapx는 CSS/HTML을 일절 처리하지 않아 **런타임 익스플로잇 경로 자체가 0**이다(테스트 빌드 도구 vite가 끌어올 뿐). **그러나 v17이 fast-uri(Phase 16-1, `^3.1.2`)·qs(`^6.15.2`)·hono(`^4.12.21`)에 적용한 것과 *동형의* `overrides` 패치-floor**(`"postcss": "^8.5.10"`)로 dev 트리를 무위험·additive하게 clean화할 수 있다(postcss 8.5.10 published, 최신 8.5.15 — `npm view` 확인, 8.5.x 패치 라인이라 vite 호환 안전). **verdict: actionable, 무위험 override — Phase 21-1.** prod 코드·동작 무변경(dev 트리 floor만). vite/vitest 메이저 업그레이드 불요(8.5.x 패치 floor로 충분). (6.1 상세) |

> **참고**: v15~v17은 3중 대조를 MCP 도구→REST 핸들러→이벤트 핸들러로 확장해 매 사이클 테스트 격차 1건을 찾았다. v18은 그 표면이 L-7(admin CLI)/L-8(worker-pool/migration)에서 무위험 수확 소진에 도달했다고 판단해 **각도를 dev 공급망 위생으로 전환**했고, 같은 회의적 강도로 postcss dev 의존을 새로 포착했다. 이는 v13의 fast-uri(MEDIUM, override로 해소)와 본질이 같다 — prod 미도달이지만 audit 게이트 위생을 위해 floor를 못 박는다. README 동기화(L-9)는 코드 동작과 무관한 docs라 LOW로 분리한다(4장). |

---

## 4. 최적화 (LOW) — 추적/이연 (v17 승계 7건 + L-9 신규 2갈래)

| # | 위치 | 내용 |
|---|------|------|
| L-2(v18) | `package.json` (native deps), CI / Dockerfile, `.claude/`·`.cursor/`·`.gemini/` 설정 | **Miasma / Phantom Gyp 공급망 캠페인 포스처 추적 — 캠페인 계속 진행 중, Cynapx 도달 0건 불변.** 진단 일자 직접 재조사: Miasma는 Mini Shai-Hulud 공개 코드(5/12) 기반 자가전파 워름으로 6/1 @redhat-cloud-services 32패키지 → 6/4 binding.gyp 악용 신규 wave(@vapi-ai/server-sdk 408k MD 포함 57패키지/286+ 버전) → 6/5 Microsoft 73 저장소(GitHub 직접 침투 + `.claude/setup.mjs`·`.cursor/rules`·`.gemini` AI-에이전트 설정 주입 변종)로 48~72h마다 전달 메커니즘을 피벗하며 지속 중. **본 사이클 직접 재대조: (a) 컴프로마이즈 패키지 패밀리 전부 Cynapx 트리 "not in tree"(`npm ls` 확인), native 의존(better-sqlite3 12.10.1 + tree-sitter 0.25.0 코어 + 12 grammar) 무관·악성 버전 미발행, (b) Cynapx in-tree 에이전트 설정은 `.claude/launch.json` 1개뿐 — 직접 열람 결과 프로젝트 자체 `src/bootstrap.ts`를 띄우는 양성 launch 설정(SessionStart 훅·`setup.mjs`·원격 페이로드 없음), `.cursor/`·`.gemini/` 부재.** CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지 1차 방어선 유지. **즉각 조치 불필요 — 추적만.** v17 대비 "캠페인 지속·신규 wave 없음, Cynapx 도달 0건 불변". 출처: [Wiz: Miasma RedHat](https://www.wiz.io/blog/miasma-supply-chain-attack-targeting-redhat-npm-packages), [StepSecurity: Phantom Gyp binding.gyp worm](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm), [Phoenix: Azure 73 repos](https://phoenix.security/miasma-azure-hades-pypi-supply-chain-worm-2026/) |
| L-3(v18) | `src/server/api-server.ts` (session-id StreamableHTTP) | MCP stateless transport 충돌 표면 — SDK v2 업그레이드 시 회귀 표면. **SDK v2 여전히 npm 미배포**(npm `latest`=**1.29.0** — `npm view dist-tags` 직접 확인, 2.x 0건) → **계속 이연**. v2 alpha는 main 브랜치 pre-release로 존재, **stable은 Q3 2026(~7-28 예고, 신스펙 동반)**, v1.x는 v2 출시 후 6개월+ 유지(공식 README — production은 v1.x 권장). P15-3 `handleMcp()` 설계 메모가 출발점. **v17 대비 상태 불변 — 계속 이연** |
| L-4(v18) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환(v8→v18 이월). **성능 문제 미관측 — verdict: 계속 보류.** 메시지가 작고 round-trip이 드물어 직렬화가 병목 아님. 기록만 유지 |
| L-5(v18) | `src/graph/graph-engine.ts` | 클러스터링 본격 서브그래프 파티셔닝 — 100k+ 노드 실측 시 재검토(**verdict: 계속 이연**). 본 사이클 핫패스 전수(서브에이전트): `performClustering()`는 LPA로 O(V+E)/반복·`MAX_ITER=20` 캡, count-first 가드(`countNodes()` probe → `DEFAULT_CLUSTER_MAX_NODES=200000` 단락, graph-engine.ts:235-246)·Fisher-Yates seeded PRNG(`mulberry32`, line 39-64) 직접 재확인 — OOM/편향 방어 정상. 본격 파티셔닝은 200k 임계 초과 모노레포 실측 시 |
| L-6(v18) | CI / Dockerfile | Node 24 + tree-sitter 0.25.x 빌드 fragility(C++20/prebuild 부재) — [node-tree-sitter#268]이 **진단 일자 여전히 open·미해결**(직접 웹 재확인 — C++20 미지정으로 Node 24 v8 헤더 빌드 실패, prebuild 부재, 관련 이슈 무해결 종료). CI `build-and-test`가 Node 22/24 매트릭스에서 그린이나 Node 24 LTS 전환 전 prebuild 재확인 필요. **추적만.** v17 대비 상태 불변 |
| L-7(v18) | `src/cli/admin.ts` (cmd* 9개), `tests/admin-cli.test.ts` | **admin CLI 명령 동작의 vitest 게이트 공백 — 의도적 비-actionable로 추적만.** 등록 명령 9개의 `cmd*` 함수는 모듈-private(미-export)이라 vitest 직접 호출 불가, 현 테스트는 *기반 프리미티브*(LockManager·VACUUM INTO·AuditLogger)만 검증. `cmd*` 테스트는 광범위 모킹 또는 export 리팩터 수반 → **프로덕션 시그니처 변경**(무위험 원칙 위반). **verdict: 추적만 — admin.ts 리팩터(핸들러 export) 시 함께 게이트화 후보.** v17 대비 불변 |
| L-8(v18) | `src/indexer/worker-pool.ts`, `src/indexer/embedding-manager.ts`, `src/db/database.ts` | **에러-복구·마이그레이션 잔여 분기의 vitest 게이트 공백 — 의도적 비-actionable로 추적만.** worker `worker.on('error')`·queue backpressure 거부·embedding A-7 stale supersedence 레이스·DB migration 0→1/2→3는 직접 미검증이나 (a) 인접 분기(replaceWorker/double-settle/1→2 명시 커버)가 가장 위험한 로직 보호, (b) 마이그레이션은 구버전 롤백 픽스처(추가 인프라) 필요 + idempotent라 회귀 위험 낮음, (c) A-7은 타이밍-flaky 위험. **verdict: 추적만 — SCHEMA_VERSION 증분 또는 worker-pool 리팩터 시 함께 게이트화.** v17 대비 불변 |
| **L-9(v18)** *(신규 — README 동기화는 actionable docs **[DONE — Phase 21-2]**, 코드 클린업 3건은 비-actionable 추적)* | `README.md` (+ 코드: `src/server/architecture-engine.ts:179`, `src/indexer/update-pipeline.ts`) | **[DONE — Phase 21-2]** README.md 3곳 동기화 완료: (1) "Node.js ≥ 20" → "≥ 22"(`engines: ">=22"`·Docker `node:22` 일치), (2) `export_graph` 설명을 `json`(embedded Mermaid)/`graphml`/`dot`(Graphviz) 3포맷으로 정정, (3) REST API 8 라우트 + `GET /healthz` 신규 섹션 추가(Bearer 인증·rate-limit·OpenAPI `openapi.ts`·`--api`/`--api-port` 플래그 명시). MCP 20 도구·admin 9 명령은 README와 정확 일치 확인(변경 불요). **코드 클린업 3건(architecture-engine.ts:179, withWriteTransaction, progress log.error 오분류)은 비-actionable로 추적 유지(미변경).** ─── (원 진단) **README ↔ 실제 피처셋 동기화 격차 — actionable docs(Phase 21-2) + 코드 클린업 3건 추적(비-actionable).** **(docs, actionable):** 직접 대조 결과 README가 현 피처와 3곳 어긋난다 — (1) "Prerequisites: Node.js ≥ 20"인데 실제 `package.json engines: ">=22"` (Step 1, README:62), (2) `export_graph` 설명이 "Mermaid diagram + JSON structural summary"만 언급하나 실제 `json`/`graphml`/`dot` 3포맷 지원(export-graph.ts:20-58 — `json`은 Mermaid 임베드, `graphml`은 XML, `dot`은 Graphviz), (3) **REST API(8 라우트: symbol/get·graph/callers·graph/callees·analysis/impact·analysis/hotspots·analysis/tests·search/symbols·graph/export + healthz)가 README에 전면 미문서화**(MCP·admin CLI만 소개). MCP 도구 20개·admin 9명령은 README와 정확히 일치(레지스트리 직접 대조). **docs-only·무위험 → Phase 21-2 후보.** **(코드 클린업, 비-actionable 추적):** 서브에이전트 전수에서 3건의 선택적 클린업 후보 — (a) `architecture-engine.ts:179` 사이클-당 `edges.find(...)` O(E) 선형 스캔(유일한 quadratic-ish 패턴, 사이클 수가 작아 실무 무해, `Map<from:to,edge>` 사전구축으로 O(1)화 가능 ~5줄), (b) `update-pipeline.ts` BEGIN/COMMIT/ROLLBACK + write-lock 보일러플레이트 5회 반복 → `withWriteTransaction()` 추출(~40줄 dedup), (c) `update-pipeline.ts`의 progress 메시지(line 168/204/245/269/380/496/511)가 `log.error`로 오분류(레벨 게이팅 시 progress까지 억제/에러 모니터링 오염). **세 건 모두 prod 코드 변경 수반이라 "무위험 사이클" 원칙상 본 사이클 비-actionable, 향후 update-pipeline/architecture-engine 리팩터 시 함께 정리 후보로 추적만.** |

> **신규 LOW 부재 안내(prod 코드 변경 항목)**: 본 전수에서 prod 코드 동작 변경을 요하는 신규 LOW는 **0건**이다(L-9의 코드 클린업 3건은 비-긴급·선택·추적만, prod 동작 무변경 사이클 원칙상 비-actionable). better-sqlite3 12.10.1·tree-sitter 코어 0.25.0·tree-sitter-c-sharp 0.23.5 신버전 없음 → 0.23.1 정확 핀 롤백 유지가 여전히 옳다. 따라서 v18의 LOW는 L-2~L-9의 8건이며 **L-2~L-8은 v17 승계 추적/이연, L-9는 신규(README docs는 Phase 21-2 actionable, 코드 클린업 3건은 추적만)**.

---

## 5. 코드 품질 / 성능 전수 (본 사이클 신규 각도 — 서브에이전트 전수 리뷰)

v13~v17의 "레지스트리↔테스트↔게이트" 3중 대조는 L-7(admin CLI)·L-8(worker-pool/migration)에서 무위험 actionable 수확이 소진됐다. 본 사이클은 정직하게 각도를 전환해 **코드 품질·아키텍처·성능·문서**를 회의적으로 전수했다.

**(1) 모듈 성장/분해 — 분해 필요한 god-module 없음**

| 모듈 | 줄수 | 판정 |
|------|:---:|------|
| `src/server/openapi.ts` | 881 | **분해 비권장** — 단일 `export const openApiSpec = {...} as const` 정적 OpenAPI 3.0 스키마 리터럴(로직·분기·함수 0). 크기는 ~9 엔드포인트 문서화의 내재 비용이라 분해는 import 의례만 늘림 |
| `src/graph/graph-engine.ts` | 675 | 응집(traversal+캐싱+클러스터링), god-object 아님 |
| `src/server/api-server.ts` | 629 | 8 REST 핸들러 + 세션/rate-limit, 응집 |
| `src/indexer/typescript-parser.ts` | 612 | 언어 프로바이더, 응집 |
| `src/indexer/update-pipeline.ts` | 591 | **분해 불필요(단일 책임 응집) — 단 watch 후보.** BEGIN/COMMIT/ROLLBACK+write-lock 댄스 5회 반복(L-9 클린업 (b)) |
| `src/cli/admin.ts` | 588 | CLI 9명령, 응집(L-7 게이트 추적) |

**TODO/FIXME/XXX/HACK = 0건**(`src/` 전수 grep — 기술부채 코멘트 미축적). **순환 import = 0**(repos → engines → server/pipeline 단방향, graph-engine은 소비자를 역참조 안 함). **god-object = 0**(UpdatePipeline 9-인자 생성자가 유일한 약한 smell이나 협력자 전부 정당).

**(2) 핫패스 성능 — O(n²)-over-nodes 없음, 테스트 시간 추세 무문제**

- **클러스터링**: `performClustering()`(LPA) O(V+E)/반복·`MAX_ITER=20` 캡. **count-first 가드 확인**(`countNodes()` COUNT(*) probe → `DEFAULT_CLUSTER_MAX_NODES=200000` 단락, graph-engine.ts:235-246). **Fisher-Yates seeded PRNG 확인**(`mulberry32` 39-48 + `fisherYatesShuffle` 56-64, 편향 `sort(()=>Math.random()-0.5)` 대체).
- **그래프 순회**: `bfs()`(573-626)는 index-pointer 큐(`head++`)로 `Array.shift()` O(n) 회피, `visited` 가드, `maxDepth` 바운드. `dfs()`(628-674) 반복형 스택. 둘 다 O(V+E).
- **아키텍처 엔진**: `checkViolations()` O(E×정책×규칙)이나 정책/규칙은 소수 고정 상수라 실질 O(E). `detectCycles()` 반복 DFS O(V+E) + 60s 캐시. **유일한 quadratic-ish: 사이클-당 `edges.find` O(E) 스캔(architecture-engine.ts:179)** — 사이클 수가 작아 실무 무해, L-9 클린업 (a)로 추적.
- **테스트 시간**: `npx vitest run` **6.72s/593케이스/43파일**(직접 측정) — 593 규모에 비해 빠르며 추세 문제 없음. e2e 스크립트는 CI 밖(vitest 게이트가 1차).

**(3) 에러 핸들링 일관성 — 양호, 미세 항목 2건**

`Logger`(stderr-only, MCP stdio 안전)는 `normalizeData()`로 Error 객체 언랩(직렬화 생존). update-pipeline catch는 일관되게 log-and-rethrow + 트랜잭션 롤백 선행(원본 에러 보존, 일반화 손실 없음). 미세 항목: (a) `embedding-manager.ts:184` 빈 catch(사이드카 malformed 라인 silent drop — 방어적이나 `log.debug` 권장), (b) `api-server.ts:625` 빈 catch(`.port` 파일 쓰기 실패 silent), (c) update-pipeline progress가 `log.error` 오분류(L-9 (c)). **전부 prod 변경 수반·비-긴급 → L-9 추적만.**

**(4) 문서 동기화 — README 3곳 격차(L-9 docs, actionable)**

20 MCP 도구·9 admin 명령은 레지스트리와 정확 일치. 격차: Node 버전(≥20 vs ≥22), export_graph 포맷(graphml/dot 누락), REST API 전면 미문서화(4장 L-9, 5.(4)). → Phase 21-2 docs 후보.

**(5) 그 외 — 공백 없음**

도구 디스패처 20/20(P18-1)·REST 핸들러(P19-1)·FileWatcher 대용량-배치/복구(P20-1)·lock 경합·IPC e2e+인증·git 이력 재작성·임베딩 프로토콜(A-7+M-2)·CrossProjectResolver·클러스터링 결정성+count-first·MCP progress·YAML 견고성이 이미 게이트 커버. 무위험으로 *prod 코드를 바꿔야* 메울 신규 결함은 없다.

---

## 6. 외부 컨텍스트 (웹 조사 — 진단 일자 재실행, 출처 명시)

### 6.1 의존성 취약점 (진단 일자 직접 재검증 — prod clean, dev moderate 1건 신규)

`npm audit --omit=dev`/`npm audit`/`npm ls`/`npm view`로 직접 재확인했다:

- **`npm audit --omit=dev`(prod) = 0 vulnerabilities**(직접 실행 — Phase 14-1 baseline 유지).
- **`npm audit`(dev 포함) = moderate 1건 신규 — `postcss < 8.5.10` XSS(GHSA-qx2v-qp2m-jg93, CVSS 6.1, 고지 2026-04-20)**. 전이 경로 `vitest@4.1.2 → vite@8.0.8 → postcss@8.5.8`(`npm why postcss` 직접 확인, 전부 dev). postcss는 prod 트리 부재 + Cynapx CSS/HTML 미처리라 **런타임 도달 0** — `overrides "postcss": "^8.5.10"`(8.5.x 패치, vite 호환)로 dev 트리 clean화(M-1 v18 / P21-1). 출처: [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93)
- **fast-uri**: `overrides`로 floor·설치본 모두 `3.1.2`(`npm ls fast-uri` 확인). CVE-2026-6321/6322 해소 → Phase 16-1 floor 유효.
- **`@modelcontextprotocol/sdk`**: npm `latest`=**1.29.0**(`npm view dist-tags --json` 확인 — 2.x 0건). Cynapx `overrides`(fast-uri/qs/hono) 계속 정답.
- **qs `^6.15.2` / hono `^4.12.21`(설치 4.12.25) / js-yaml 4.x / better-sqlite3 12.10.1(SQLite 3.53.1) / sqlite-vec 0.1.9 / swagger-ui-express 5 / commander 14 / chokidar 5 / simple-git 3.36 / ignore 7 / zod 4.x / express 4.22.x·5.2.x / supertest(dev)**: 미해결 공개 취약점 미발견.

### 6.2 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"` + Docker `node:22-bookworm-slim`. Node 22 LTS 유지 2027-04 종료 — 여유. CI Node 22/24 매트릭스 그린(593/593). Node 24 + tree-sitter 0.25.x는 [node-tree-sitter#268](https://github.com/tree-sitter/node-tree-sitter/issues/268)(여전히 open·미해결 — C++20 미지정 빌드 실패·prebuild 부재)의 fragility(L-6).
- **tree-sitter 코어**: npm `latest`=**0.25.0**. 12 grammar 전부 dedupe/override. **tree-sitter-c-sharp**: npm 최신 **0.23.5**(0.23.6 미배포 — ERR_REQUIRE_ASYNC_MODULE 해소 신버전 없음) → **0.23.1 정확 핀 롤백 유지가 여전히 옳다**.

### 6.3 공급망 캠페인 — Miasma / Phantom Gyp (계속 진행 중, Cynapx 도달 0건 불변)

- 진단 일자 직접 재조사: Miasma는 Mini Shai-Hulud 공개 코드(5/12) 기반 자가전파 워름으로 6/1 @redhat-cloud-services 32패키지(preinstall 훅 4.2MB 난독 페이로드) → 6/4 binding.gyp 악용 wave(@vapi-ai/server-sdk 408k MD 등 57패키지/286+ 버전) → 6/5 Microsoft 73 저장소(GitHub 직접 침투 + `.claude/setup.mjs`·`.cursor/rules`·`.gemini` AI-에이전트 설정 주입)로 48~72h마다 피벗하며 지속 중(TeamPCP 클러스터 귀속). **본 사이클 직접 재대조: (a) 컴프로마이즈 패밀리 전부 Cynapx 트리 "not in tree", native 의존 무관·악성 버전 미발행, (b) Cynapx in-tree 설정은 `.claude/launch.json` 1개(프로젝트 자체 bootstrap 기동 양성, SessionStart 훅·`setup.mjs`·원격 페이로드 없음), `.cursor`/`.gemini` 부재.** CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지 1차 방어선. **즉각 코드 변경 불필요, 포스처 추적.** 매 사이클 in-tree `.claude`/`.cursor`/`.gemini`에 SessionStart 훅/외부 스크립트 끼어듦 점검 항목 유지. 출처: [Wiz: Miasma RedHat](https://www.wiz.io/blog/miasma-supply-chain-attack-targeting-redhat-npm-packages), [StepSecurity: Phantom Gyp binding.gyp worm](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm), [Phoenix: Azure 73 repos / PyPI](https://phoenix.security/miasma-azure-hades-pypi-supply-chain-worm-2026/), [Upwind: Miasma credential harvest](https://www.upwind.io/feed/miasma-npm-supply-chain-worm-redhat-credential-harvest)

### 6.4 MCP 생태계 — SDK v2 alpha 존재하나 npm 정식 미배포 (v17 승계, 상태 불변)

- **MCP TypeScript SDK v2 = npm 정식 미배포**(직접 확인): v2는 stateless protocol core + Extensions + Tasks + MCP Apps + authorization hardening를 담았고 main 브랜치 alpha pre-release로 존재하나, **npm `latest`=1.29.0이고 2.x 버전/dist-tag는 0건**. v2 milestone: Alpha ~3월, Beta ~5월, **stable Q3 2026(~7-28 예고, 신스펙 동반)**. v1.x는 v2 출시 후 6개월+ 유지(공식 README — production은 v1.x 권장). → P15-3 stateless transport + task extension 마이그레이션은 여전히 착수 불가. progress-token opt-in(P14-5) 현행 정상. 출처: [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases), [MCP TS SDK v2 docs](https://ts.sdk.modelcontextprotocol.io/v2/)

### 6.5 경쟁/인접 도구 동향 (v17 승계 — 전략 추적)

- **로컬-퍼스트 코드 그래프 카테고리 성숙 지속**: Serena(LSP-over-MCP)·CodeGraph·GitNexus 등이 심볼-레벨 표준의 사실상 기본값. Cynapx의 "100% 로컬·격리·멀티프로세스 보안 IPC" 포지션이 차별점이며, 6.3의 AI-에이전트 설정 주입 변종은 격리·lockfile-고정·`npm ci`·in-tree 설정 무결성 포스처의 가치를 재확인한다.
- **SCIP가 LSIF를 대체하는 심볼 인덱스 표준으로 정착** — `export_graph`(json/graphml/dot)에 SCIP 추가는 미래 상호운용 후보. MCP `export_graph`는 P18-1, REST `/api/graph/export`는 P19-1로 게이트 커버(디딤돌 마련 완료). SCIP는 protobuf 의존 + install-time 표면 확대 우려로 즉시 비권장 — 전략 후보 유지.
- **함의**: v11~v17과 동일하게 (1) 공급망 위생 유지(+ in-tree 에이전트 설정 무결성 점검 + **dev 트리 audit 위생** — M-1 v18), (2) 생태계 스펙 추적(MCP SDK v2 — Q3 stable까지 대기), (3) 회귀 안전망·문서 위생이 신뢰성 차별화 축이다.

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 정밀 재열람에서 신규 prod 코드 결함이 없었다(M-1 v18은 dev override, L-9 README는 docs):

- `src/watcher/file-watcher.ts` — chokidar `ignored` 프레디킷·확장자 allowlist(H-2)·flush 동시성(H-3)·타이머 위생(H-1)·대용량-배치 git-sync 라우팅·재시도/FATAL 강등(P20-1 게이트 커버) 정상.
- `src/graph/graph-engine.ts` — P14-4 Fisher-Yates + seeded PRNG 결정성 + M-4 count-first 가드 + BFS index-pointer 큐·반복 DFS 모두 O(V+E), 핫패스 quadratic 없음(직접 재확인).
- `src/server/architecture-engine.ts` — checkViolations O(E)·detectCycles 반복 DFS+60s 캐시 정상(사이클-당 edges.find O(E) 스캔만 L-9 (a) 비-긴급 추적).
- `src/indexer/update-pipeline.ts` — 단일 책임 응집·catch log-and-rethrow+롤백·원본 에러 보존 정상(트랜잭션 보일러플레이트 dedup·progress log.error 오분류만 L-9 (b)/(c) 추적).
- `src/server/openapi.ts` — 정적 OpenAPI 스키마 리터럴(로직 0), 분해 불요.
- `src/server/api-server.ts` — 세션 TTL/cap/sweep(unref)·timing-safe Bearer·8 REST 핸들러 supertest 게이트(P19-1)·rate-limit 양호(`.port` 빈 catch만 미세).
- `src/server/ipc-coordinator.ts` — challenge-response 인증·1MB 바이트 제한·per-tool 타임아웃·keepalive(unref)·pending reject-on-close 견고.
- `src/server/tool-dispatcher.ts` — Terminal 포워딩·waitUntilReady·registry lookup·EngineNotReadyError 재시도 변환 견고. 20/20 게이트(P18-1).
- `src/indexer/worker-pool.ts` / `embedding-manager.ts` / `database.ts` — double-settle 가드·A-7 discipline·1→2 마이그레이션 명시 커버 견고(잔여 분기만 L-8 추적, `embedding-manager.ts:184` 빈 catch만 미세).
- `package.json` overrides — tree-sitter `^0.25.0`·fast-uri `^3.1.2`·qs `^6.15.2`·hono `^4.12.21` 충족(postcss `^8.5.10` 추가가 M-1 v18).
- `.claude/launch.json` — 프로젝트 자체 `src/bootstrap.ts` 기동용 양성 launch(SessionStart 훅·외부 `setup.mjs`·원격 페이로드 없음 — 6.3 Miasma 직접 대조 무해), `.cursor`/`.gemini` 부재.
- `.github/workflows/ci.yml` — Node 22/24 매트릭스 + `npm audit --omit=dev --audit-level=high` 게이트(P14-1) + `npm ci` 양호. (cynapx-autonomous.yml은 본 진단 범위 외 — 미변경.)
- TODO/FIXME/XXX/HACK 코멘트 = 0건(`src/` 전수).

---

## 8. 권장 수정 순서 (Phase 21 제안 — 상세는 phase21-plan.md)

**20개 페이즈 이후 prod 코드는 steady-state(CRITICAL/HIGH 0, prod audit 0, TODO 0, god-module 0, 핫패스 quadratic 0)이나, v13~v17의 테스트-격차 각도가 소진된 지점에서 각도를 dev 공급망·문서로 전환한 결과 무위험 actionable 2건이 드러났다.** CRITICAL/HIGH 0, MEDIUM 1(M-1 v18 postcss dev override — 무위험), LOW 8(L-2~L-8 v17 승계 + L-9 신규: README docs는 actionable, 코드 클린업 3건은 비-actionable 추적). 신규 prod-도달 CVE 0건, Miasma도 Cynapx 도달 0건. 따라서 Phase 21은 **override 1 서브 페이즈(P21-1) + docs 1 서브 페이즈(P21-2) + 추적 갱신**이 합리적이다.

1. **P21-1**: M-1 v18 해소 — `package.json` `overrides`에 `"postcss": "^8.5.10"` 추가(fast-uri/qs/hono 패턴 동형) → dev 트리 `npm audit` clean화. **dev 트리만, prod 코드·동작 무변경.** `npm audit` moderate 0, `npm audit --omit=dev` 0(불변), `npx vitest run` 593 그린, `npx tsc --noEmit` 그린 확인.
2. **P21-2**: L-9 docs 해소 — README.md 3곳 동기화(Node ≥20 → ≥22, export_graph 포맷에 graphml/dot 추가, REST API 8 라우트 섹션 추가). **docs-only, 코드·동작 무변경.**
3. **추적 상태 갱신**: L-2(Miasma 캠페인 지속·Cynapx 도달 0 불변), L-3(SDK v2 npm 미배포 — Q3 stable까지 이연), L-6(node-tree-sitter#268 여전히 open), L-7/L-8(게이트 공백 비-actionable), L-9 코드 클린업 3건(비-actionable) 현 상태를 다음 사이클 출발점으로 고정.

(L-4 IPC MessagePack 계속 보류, L-5 클러스터링 본격 파티셔닝 계속 이연, MCP 전면 stateless/task 마이그레이션은 SDK v2 npm 배포까지 이연, SCIP export는 디딤돌 마련 완료된 전략 후보로 계속 기록만.)
