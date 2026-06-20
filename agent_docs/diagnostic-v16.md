# Cynapx 정밀 진단 보고서 v16

- **기준 커밋**: `94183ef` (Phase 18 + Phase 18-1 완료, 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-14
- **진단 범위**: src/ 전체(server, db, indexer, graph, watcher, utils, cli, bootstrap), schema/, scripts/(integration-test.js·ipc-e2e-test.js·docker-smoke.sh 포함), tests/ 전체, src-native/, Dockerfile, `.github/workflows/ci.yml`, package.json/lockfile + 외부 컨텍스트(CVE/advisory, 공급망 캠페인, MCP 생태계, 경쟁 도구)
- **진단 방법**: 단일 에이전트 순차 전수 코드 리뷰 + 로컬 직접 검증(`npx vitest run`, `npx tsc --noEmit`, `npm audit --omit=dev`, `npm ls`로 전이 의존 버전 확인, `npm view`로 registry `latest`/dist-tag 확인, 번들 SQLite 버전 확인) + **신규: v15가 MCP 도구 디스패처에 적용한 "레지스트리 ↔ vitest 케이스 ↔ CI 작업" 3중 교차 대조를 *다른 등록 표면*(REST `/api/*` 라우트 9개, admin CLI 명령 9개)으로 확장 재적용** + 웹 검색·페치 기반 외부 조사(진단 일자 재실행 — v15 스냅샷 가정 안 함)
- **현재 상태(직접 검증)**: `npx vitest run` **578/578**(43 파일), `npx tsc --noEmit` 그린, `npm audit --omit=dev` **0 vulnerabilities**(info/low/moderate/high/critical 전부 0 — 직접 실행), 번들 `sqlite_version()`=**3.53.1**. diagnostic-v15 전 항목(M-1 v15 [DONE — Phase 18-1], LOW 5건 추적/이연).

> **요약**: **v15→Phase18 사이클이 MCP 도구 디스패처의 게이트 분포 공백(M-1 v15)을 닫은 직후, 본 사이클은 같은 회의적 3중 교차 대조 방법론을 *다른 두 등록 표면*에 적용해 한 곳에서 실재하는 무위험 actionable 항목을 새로 발견했다.** 공급망·CVE·코드 결함 측면은 여전히 clean(CRITICAL/HIGH 0, 신규 CVE 도달 0, Miasma wave-3 미출현·도달 0)이다. **신규 신호는 REST `/api/*` HTTP 표면이다 — 등록된 8개 REST 핸들러 중 핸들러 *동작* 분기(특히 `getNodeByQualifiedName()` 실패 시 `404 SYMBOL_NOT_FOUND` 가드 5건, `export_graph`의 `EXPORT_FAILED` 분기, catch→500 분기)는 실제 Express 앱을 통해 어느 게이트에서도 검증되지 않는다.** 현 HTTP 테스트(`tests/api-server-http.test.ts`)는 auth(401 timing-safe)·rate-limit(429)·`/mcp` 세션 수명주기·`/healthz` 같은 *미들웨어/메커니즘*은 두텁게 커버하나, 핸들러 본문 분기는 `search_symbols` 성공 1건만 행사한다. **결정적으로 이 REST 표면은 `scripts/integration-test.js`/`ipc-e2e-test.js`(CI 미실행 e2e)에서조차 호출되지 않는다**(직접 확인 — 두 스크립트에 `fetch`/`/api/` 호출 0건). 즉 v15가 "e2e에만 있음"이었던 것과 달리, 이 REST 분기들은 **어디에도 동작 테스트가 없다**. supertest가 이미 의존성에 있고(`api-server-http.test.ts`가 사용 중) 동일 `fakeMcpServer` 하니스로 무위험·additive하게 메울 수 있다. **이는 패딩이 아니라 v15의 3중 대조를 "MCP 도구"에서만 멈추지 않고 모든 등록 표면(REST·CLI)으로 끝까지 밀어붙였을 때 자연히 드러난 격차다.** 외부 측면은 신선하게 재조사했고(Miasma wave-2 후속 — AI 코딩 에이전트 백도어 변종 보고, MCP SDK v2 여전히 npm 미배포, better-sqlite3 12.10.1 published) 전부 Cynapx에 무영향임을 직접 재대조했다. **CRITICAL 0, HIGH 0, MEDIUM 1(M-1 v16, 신규 — REST 핸들러 동작 테스트 공백, 무위험 additive), LOW 5(전부 추적/이연, v15 승계 — 신규 0).**

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건(C-1 Docker 배포 전손, C-2 사이드카 spawn 크래시, C-3 IPC 인증 무력화)은 Phase 13에서, v11의 HIGH 1건(N-1 공급망)은 Phase 14-1에서, v12의 MEDIUM 4건은 Phase 15에서, v13의 MEDIUM 1건(M-1 fast-uri floor)은 Phase 16에서, v15의 MEDIUM 1건(M-1 도구 디스패처 게이트 공백)은 Phase 18-1에서 해소됐고, 전수 재열람에서 새로운 CRITICAL/HIGH는 발견되지 않았다. IPC 핸드셰이크(`src/server/ipc-coordinator.ts`)는 random challenge + `HMAC-SHA256(nonce, challenge)` + `timingSafeEqual`로 견고하고, API Bearer는 SHA-256 후 `timingSafeEqual`(`api-server.ts`), 세션 맵은 TTL+cap+sweep(unref)로 보호된다.

---

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** 코드·공급망 어디에서도 신규 HIGH는 발견되지 않았다. `npm audit --omit=dev` = 0 vulnerabilities(직접 재검증, 6.1 참조). M-1 v16(REST 핸들러 동작 테스트 공백)은 **현재 동작하는 결함이 아니라 회귀 방어막의 공백**이므로 HIGH가 아니라 MEDIUM으로 정직하게 등급한다 — 해당 REST 핸들러는 실제로 정상 동작한다(코드 재열람에서 결함 0). 특히 **`handleHotspots`의 SQL 문자열 보간은 안전하다** — `metric`은 `HotspotsSchema`의 `z.enum([...6개...])`(api-server.ts:95)를 `validate()`가 통과시킨 뒤에야 SQL에 닿으므로 임의 컬럼 주입이 불가능하다(직접 확인). 문제는 "이 핸들러들의 동작 회귀를 잡을 빠른 게이트가 없다"는 예방적 격차일 뿐이다. 외부 공급망 사건(Miasma wave-2 후속, 6.3)도 Cynapx 의존 트리에 도달하지 않으므로 HIGH가 아니라 LOW(포스처 추적, L-2)로 다룬다.

---

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

| # | 위치 | 내용 |
|---|------|------|
| **M-1 v16** `[DONE — Phase 19-1]` | `tests/api-server-http.test.ts` (+ `src/server/api-server.ts` 라우트, `scripts/integration-test.js`) | **[DONE — Phase 19-1]** `api-server-http.test.ts`에 supertest 케이스 **10건** 추가(테스트-only, `src/` 무변경)로 게이트화 완료. 커버: `handleGetSymbol` 404 SYMBOL_NOT_FOUND + 200, `handleGetCallers`/`GetCallees`/`ImpactAnalysis`/`Tests` 404 가드 4건(impact/tests는 공유 analyzeLimiter 예산 소진 시 429 허용으로 결정성 유지), `handleGetCallers` 200(빈 traverse), `handleExportGraph` 200(`{format:'mermaid'}`) + 500 EXPORT_FAILED, `validate()` 400 Validation failed. 검증: `npx vitest run` **588/588** 그린, `npx tsc --noEmit` 그린, `npm audit --omit=dev` 0 vulnerabilities. **REST `/api/*` 핸들러 동작 분기의 게이트 공백 — 8개 핸들러의 핵심 분기가 실제 Express 앱을 통해 미검증.** `setupRoutes()`(api-server.ts:322-331)에 등록된 REST 라우트는 8개다: `/api/symbol/get`(`handleGetSymbol`), `/api/graph/callers`(`handleGetCallers`), `/api/graph/callees`(`handleGetCallees`), `/api/analysis/impact`(`handleImpactAnalysis`), `/api/analysis/hotspots`(`handleHotspots`), `/api/analysis/tests`(`handleTests`), `/api/search/symbols`(`handleSymbolSearch`), `/api/graph/export`(`handleExportGraph`). 현 HTTP 테스트(`api-server-http.test.ts`, supertest)는 **auth(401)·rate-limit(429)·`/mcp` 세션·`/healthz`** 같은 미들웨어/메커니즘은 두텁게 커버하나, **핸들러 본문 분기는 `handleSymbolSearch` 성공 1건만** 실제로 행사한다. 미검증 핵심 분기: (a) **`404 SYMBOL_NOT_FOUND` 가드 5건**(`handleGetSymbol`/`GetCallers`/`GetCallees`/`ImpactAnalysis`/`Tests` 전부 `getNodeByQualifiedName()`이 null이면 404 반환 — 흔한 회귀 지점), (b) **`handleExportGraph`의 `200 {format:'mermaid'}` 성공 + catch→`500 EXPORT_FAILED`**, (c) `validate()` 실패 시 `400 Validation failed` 분기. **결정적: 이 REST 표면은 `integration-test.js`/`ipc-e2e-test.js`에서조차 호출되지 않는다**(직접 확인 — 두 스크립트에 `fetch`/`/api/` 0건). → v15(e2e에만 존재)와 달리 이 분기들은 **어디에도 동작 테스트가 없다.** **근본 원인은 테스트 *부재*다(분포가 아님) — REST 핸들러 동작은 supertest 기반 게이트에 들어온 적이 없다.** `api-server-http.test.ts`의 기존 `fakeMcpServer`/`makeServer` 하니스로 무위험·additive하게 메울 수 있다(supertest는 이미 의존성·사용 중). **verdict: actionable, 무위험 additive — Phase 19-1.** (5장 상세) |

> **참고**: v15는 MCP 도구 디스패처(`tool-dispatcher.test.ts`)에 3중 대조를 적용했다. v16은 **그 방법론을 "MCP 도구"에서 멈추지 않고 *모든 등록 표면*으로 끝까지 밀어붙였다** — REST 라우트 8개 + admin CLI 명령 9개를 같은 격자(등록 ↔ 테스트 케이스 ↔ CI 게이트)로 재대조했고, REST 표면에서 한 건의 실재 공백을 찾았다(admin CLI는 4장 L-7 참조로 추적, 의도적 비-actionable). 이는 "할 일을 만들어낸" 것이 아니라 prior 사이클의 정밀 검증을 인접 표면으로 *확장*한 자연스러운 발견이다. 프로덕션 코드는 한 줄도 바꾸지 않는다(핸들러 정상). |

---

## 4. 최적화 (LOW) — 전부 추적/이연 (v15 승계 + L-7 신규 추적 1건)

| # | 위치 | 내용 |
|---|------|------|
| L-2(v16) | `package.json` (native deps), CI / Dockerfile | **Miasma / Phantom Gyp 공급망 캠페인 포스처 추적 — wave-2 후속(AI 코딩 에이전트 백도어 변종) 반영.** v15가 추적한 wave-2(2026-06-16, 647k monthly downloads) 이후 **wave-3는 진단 일자 미출현**(직접 웹 재조사 — 신규 물결/패키지 패밀리 보고 없음, 보고는 여전히 wave-1 6/1~6/3 + wave-2 6/16). 신규 디테일은 **Phantom Gyp 변종이 `.claude/`·Cursor·Gemini 설정 디렉터리에 지속 명령을 심어 AI 코딩 워크플로를 전파·지속 표면으로 삼는다**는 점이다(Corgea/StepSecurity 보고). **본 사이클 직접 재대조: wave-1/2 컴프로마이즈 패키지 패밀리 12개(ai-sdk-ollama/autotel/awaitly/executable-stories/node-env-resolver/effect-analyzer/mountly/wrangler-deploy/evolv-coder-lite/@vapi-ai/server-sdk/@redhat-cloud-services/workflow) 전부 Cynapx 트리에 "not in tree"**(`npm ls` 각각 확인). Cynapx native 의존(better-sqlite3 12.10.0 + tree-sitter core + 12 grammar)도 전부 무관 계열·악성 버전 미발행. **즉각 조치 불필요** — CI가 `npm ci`(lockfile 고정) + audit 게이트(P14-1) + Dockerfile 멀티스테이지로 1차 방어선 유지. **verdict: 추적만**(6.3 상세). v15 대비 "물결 재발 없음(wave-3 미출현), Cynapx 트리 도달 0건 불변, AI 에이전트 표적화 변종 인지". |
| L-3(v16) | `src/server/api-server.ts` (session-id StreamableHTTP) | MCP stateless transport 충돌 표면 — SDK v2 업그레이드 시 회귀 표면. **SDK v2 여전히 npm 미배포**(npm `latest`=**1.29.0**, dist-tags `{ latest: '1.29.0' }`만 — `npm view dist-tags --json` 직접 확인, 2.x 버전/dist-tag 0건) → **계속 이연**. v2는 alpha 채널에 존재하나 메인 패키지 정식 배포는 아직 없음(Python SDK 기준 beta 2026-06-30, stable 2026-07-27 예고; TS stable Q3 2026). P15-3의 `handleMcp()` 설계 메모가 출발점. **v15 대비 상태 불변 — 계속 이연** |
| L-4(v16) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환(v8→v16 이월). **성능 문제 미관측, verdict: 계속 보류.** 메시지가 작고(주로 메타데이터) round-trip이 드물어 직렬화가 병목 아님. 기록만 유지 |
| L-5(v16) | `src/graph/graph-engine.ts` | 클러스터링 본격 서브그래프 파티셔닝(O-5) — 100k+ 노드 실측 시 재검토(**verdict: 계속 이연**). M-4(v12)의 count-first 가드(`countNodes()` probe → `getAllNodes()` 풀로드 이전 short-circuit)가 OOM 1차 방어 |
| L-6(v16) | CI / Dockerfile | Node 24 + tree-sitter 0.25.x 빌드 fragility(C++20/prebuild 부재) — 상류 이슈 [node-tree-sitter#268]이 **진단 일자 여전히 open·미해결**(직접 웹 재확인 — 2026-01-12 보고 이후 prebuild 릴리스/해결 댓글 없음). CI `build-and-test`가 Node 22/24 매트릭스에서 `npm test`를 돌리고 **현재 그린**이나, Node 24 LTS 전환 전 prebuild 가용성 재확인 필요. **추적만**(O-6 v12 승계). **v15 대비 상태 불변** |
| **L-7(v16)** *(신규 추적, 비-actionable)* | `src/cli/admin.ts` (cmd* 9개), `tests/admin-cli.test.ts` | **admin CLI 명령 동작의 vitest 게이트 공백 — 의도적 비-actionable로 추적만.** v16의 3중 대조를 admin CLI에 적용한 결과: 등록 명령 9개(status/list/inspect/doctor/purge/unregister/compact/backup/restore)의 `cmd*` 함수는 **모듈-private(미-export)이라** vitest에서 직접 호출이 불가능하고, 현 테스트는 그 *기반 프리미티브*(LockManager.probeProjectLock·VACUUM INTO·AuditLogger)만 검증한다. e2e refuse-path는 `integration-test.js`(backup/restore)에서만 행사된다. **그러나 M-1 v16(REST)과 달리 actionable로 올리지 않는다**: (a) `cmd*`를 테스트하려면 `process.exit`/`console`/파일시스템을 광범위하게 모킹하거나 핸들러를 export로 리팩터해야 해 **테스트-only가 아니라 프로덕션 시그니처 변경을 수반**한다(무위험 원칙 위반), (b) 기반 프리미티브(락 가드·VACUUM 일관성)는 이미 게이트로 커버돼 가장 위험한 로직은 보호됨, (c) admin CLI는 대화형 운영 도구라 회귀 비용이 REST 핸들러(자동화 클라이언트 대면)보다 낮다. **verdict: 추적만 — 향후 admin.ts 리팩터(핸들러 export) 시 함께 게이트화 후보로 기록.** |

> **신규 LOW 부재 안내(코드 변경 항목)**: better-sqlite3 12.10.1(published)은 v15가 확인한 대로 **Electron 42용 V8 external API 수정 + GHA 의존 갱신뿐 — 번들 SQLite 버전(3.53.1)·보안 수정 없음**. Cynapx는 Electron이 아니므로 12.10.0→12.10.1은 **기능상 no-op**이라 별도 LOW로 올리지 않는다(다음 정기 의존성 갱신 시 정렬 무방). 따라서 v16의 LOW는 L-2~L-7의 6건이며 **L-2~L-6은 v15 승계 추적/이연, L-7은 신규 추적(비-actionable)** — **코드 변경을 요하는 신규 LOW 0건**이다.

---

## 5. 테스트 공백 (M-1 v16 상세 — 본 사이클 핵심 신규 발견)

Phase 18-1 종료 시 578 테스트(43 파일)로 회귀 안전망이 두텁고, **MCP 도구 디스패처는 v15→P18-1로 20/20 게이트 커버**됐다. 본 사이클은 v15의 "등록 ↔ 테스트 ↔ CI 게이트" 3중 대조를 **MCP 도구 외의 다른 두 등록 표면**(REST 라우트, admin CLI)으로 확장했다.

**(1) REST `/api/*` 핸들러 동작 분기 공백 (M-1 v16, actionable)**

REST 라우트(8개) ↔ `api-server-http.test.ts`의 supertest 케이스 ↔ e2e 스크립트를 3중 대조한 결과:

| REST 라우트 (핸들러) | 핸들러 *동작* 분기 supertest 검증 | auth/rate-limit 메커니즘 검증 | e2e 스크립트(integration/ipc) |
|------|:---:|:---:|:---:|
| `/api/search/symbols` (handleSymbolSearch) | ✅ 성공 1건 | ✅ (401 timing-safe + 429 음성) | ❌ 미호출 |
| `/api/analysis/hotspots` (handleHotspots) | ⚠️ rate-limit용 200만(동작 분기 X) | ✅ (429 트립) | ❌ 미호출 |
| `/api/symbol/get` (handleGetSymbol) | ❌ 404/500/200 미검증 | ⚠️ 라우트별 직접 검증 X | ❌ 미호출 |
| `/api/graph/callers` (handleGetCallers) | ❌ 404/500/200 미검증 | ⚠️ | ❌ 미호출 |
| `/api/graph/callees` (handleGetCallees) | ❌ 404/500/200 미검증 | ⚠️ | ❌ 미호출 |
| `/api/analysis/impact` (handleImpactAnalysis) | ❌ 404/500/200 미검증 | ✅ (analyzeLimiter) | ❌ 미호출 |
| `/api/analysis/tests` (handleTests) | ❌ 404/500/200 미검증 | ✅ (analyzeLimiter) | ❌ 미호출 |
| `/api/graph/export` (handleExportGraph) | ❌ 200/EXPORT_FAILED 미검증 | ⚠️ | ❌ 미호출 |

> 주: `validate()` 헬퍼(api-server.ts:115-122)의 `400 Validation failed` 분기도 어느 라우트를 통해서도 supertest로 검증되지 않는다. `api-server-hotspots.test.ts`는 핸들러를 호출하지 않고 *로컬 재구현한* `validateMetric`을 검증할 뿐이라(스키마/핸들러 드리프트를 못 잡음), 실제 `HotspotsSchema` enum이 약화돼도 그 테스트는 그린이다 — 이 역시 실제 핸들러를 supertest로 행사하면 자연 보완된다.

**함의**: REST 핸들러 회귀(예: 404 가드 제거로 null 노드가 500/크래시, `export_graph` 포맷 회귀)는 **어느 게이트도 통과 못 잡는다**(e2e 스크립트조차 REST를 안 침). **Phase 19-1에서 8개 핸들러의 핵심 분기(특히 404 가드 5건 + export 성공/실패 + 1개 validate 400)를 기존 `fakeMcpServer`/supertest 하니스로 `api-server-http.test.ts`에 추가**해 게이트로 끌어올린다. `handleGetSymbol`의 404/200 한 쌍이 가성비 1위(가드 분기가 명확, mock 표면 최소).

**(2) admin CLI 명령 — 추적만(L-7, 비-actionable)**

admin CLI `cmd*` 9개는 미-export라 vitest 직접 호출 불가 → 테스트-only로 메울 수 없고 프로덕션 리팩터 수반(무위험 원칙 위반). 기반 프리미티브는 이미 게이트로 커버됨. 4장 L-7에 추적만.

**(3) 그 외 영역 — 공백 없음**

기존 스위트는 도구 디스패처 20/20(P18-1)·lock 경합·IPC e2e+인증·비-TS 메트릭·git 이력 재작성·purge 재초기화·임베딩 프로토콜(A-7 + M-2)·CrossProjectResolver 멀티프로젝트(P14-2)·클러스터링 결정성+count-first 가드(P14-4 + M-4)·MCP progress(P14-5)·YAML 견고성(P14-3)·REST auth/rate-limit/세션/healthz 메커니즘을 이미 커버한다. M-1 v16(REST 핸들러 동작) 외에 신규 테스트가 필요한 결함은 없다.

---

## 6. 외부 컨텍스트 (웹 조사 — 진단 일자 재실행, 출처 명시)

### 6.1 의존성 취약점 (진단 일자 직접 재검증 — 전부 clean)

`npm audit --omit=dev` + `npm ls` + `npm view`로 직접 재확인했다:

- **`npm audit --omit=dev` = 0 vulnerabilities** (info/low/moderate/high/critical 전부 0 — 직접 실행). Phase 14-1 baseline 유지.
- **fast-uri**: `overrides`로 floor·설치본 모두 `3.1.2`(`npm ls fast-uri`=`fast-uri@3.1.2 overridden` 직접 확인). **CVE-2026-6321**(path traversal, ≤3.1.0)·**CVE-2026-6322**(host confusion, ≤3.1.1) 둘 다 3.1.2에서 해소 → Phase 16-1 floor 유효. 출처: [GHSA-q3j6-qgpj-74h6 / CVE-2026-6321](https://github.com/advisories/GHSA-q3j6-qgpj-74h6), [GitLab advisory CVE-2026-6322](https://advisories.gitlab.com/npm/fast-uri/CVE-2026-6322/)
- **`@modelcontextprotocol/sdk`**: npm `latest`=**1.29.0**(직접 `npm view dist-tags --json` 확인 — `{ latest: '1.29.0' }`, 2.x 버전 목록 0건). Cynapx `overrides`(fast-uri/qs/hono)가 계속 정답. 설치본: ajv 8.18.0, hono 4.12.25, express-rate-limit 8.5.2. 출처: npm registry.
- **express-rate-limit 8.5.2 → ip-address 10.2.0**: CVE-2026-30827(IPv4-mapped IPv6 rate-limit bypass) 패치 라인. Cynapx는 `keyGenerator`를 `req.socket.remoteAddress`로 고정(`api-server.ts:128,133`)해 이중 우회. clean.
- **qs `^6.15.2`**(설치 6.15.2): express@4.22.1/express@5.2.1/sqlite-vec/swagger 경유 전부 dedupe·overridden(`npm ls qs` 확인). clean.
- **hono `^4.12.21`**(설치 4.12.25, override): bodyLimit/JSX/JWT/cache 모더릿 패치 라인 이상. clean.
- **js-yaml 4.2.0**: CVE-2025-64718(<4.1.1) 비해당. CVE-2026-33532(deeply-nested flow sequence DoS)는 `yaml`(eemeli) 대상이지 `js-yaml`(nodeca)이 아님 — Cynapx는 `js-yaml`만 사용.
- **better-sqlite3 12.10.0 / SQLite 3.53.1**: 로컬 `sqlite_version()`=**3.53.1** 직접 확인. **신규 릴리스 12.10.1(published)은 Electron 42용 V8 external API 수정 + GHA 의존 갱신뿐 — 번들 SQLite 버전·보안 수정 없음**. Cynapx는 Electron이 아니므로 기능상 no-op. Miasma 캠페인에서 악성 버전 미발행, clean. 출처: [WiseLibs/better-sqlite3 releases](https://github.com/WiseLibs/better-sqlite3/releases)
- **sqlite-vec 0.1.9 / swagger-ui-express 5 / commander 14 / chokidar 5 / simple-git 3.36 / ignore 7 / zod 4.3.6 / express 4.22.x / supertest(dev)**: 미해결 공개 취약점 미발견.

### 6.2 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"` + Docker `node:22-bookworm-slim`. Node 22 LTS 유지보수 2027-04 종료 — 여유. CI Node 22/24 매트릭스 그린(578/578). Node 24 + tree-sitter 0.25.x는 [node-tree-sitter#268](https://github.com/tree-sitter/node-tree-sitter/issues/268)(여전히 open·미해결, 2026-01-12 보고)의 C++20/prebuild 부재 fragility(L-6).
- **tree-sitter 코어**: npm `latest`=**0.25.0**(직접 확인 — 0.25.1 미존재). 12 grammar 전부 `tree-sitter@0.25.0 deduped/overridden`. **tree-sitter-c-sharp**: npm 최신 여전히 **0.23.5**(`npm view versions` tail = [..., 0.23.0, 0.23.1, 0.23.5], 0.23.6 미배포 — P15-2의 `ERR_REQUIRE_ASYNC_MODULE` 해소 신버전 없음) → **0.23.1 정확 핀 롤백 유지가 여전히 옳다**.

### 6.3 공급망 캠페인 — Miasma / Phantom Gyp (v15 승계, wave-3 미출현 — Cynapx 도달 0건 불변)

- **Miasma / Phantom Gyp — wave-3 미출현, AI 에이전트 표적 변종 인지**: v15가 추적한 wave-1(2026-06-01~03, @redhat-cloud-services 32 + @vapi-ai/server-sdk + 57패키지/286+ 악성 버전)·wave-2(2026-06-16, 647k monthly downloads)에 이어 **진단 일자 wave-3는 미출현**(직접 웹 재조사 — 신규 물결/패키지 패밀리 보고 없음). 신규 디테일은 핵심 기법(157-byte `binding.gyp`로 `npm install` 시 node-gyp 자동 실행, `--ignore-scripts` 우회)에 더해, **Phantom Gyp 변종이 페이로드로 `.claude/`·Cursor·Gemini 설정 디렉터리에 지속 명령을 주입해 AI 코딩 워크플로를 전파/지속 표면으로 삼는다**는 보고다. **본 사이클 직접 재대조: wave-1/2 패키지 패밀리 12개 전부 Cynapx 트리에 "not in tree"** + Cynapx native 의존(better-sqlite3 + tree-sitter 12 grammar) 전부 무관·악성 버전 미발행. **함의(L-2)**: Cynapx는 node-gyp 빌드 native 모듈 13개를 쓰므로 구조적 표적 표면에 노출되나, (a) CI `npm ci`(lockfile 고정), (b) P14-1 audit 게이트, (c) Dockerfile 멀티스테이지로 1차 방어선 유지. **즉각 코드 변경 불필요, 포스처 추적 — 의존 추가 시 binding.gyp 검토 + `npm ci` + 매 사이클 `npm ls` 재대조.** 출처: [Corgea: Phantom Gyp Miasma — Vapi/ai-sdk-ollama](https://corgea.com/research/miasma-phantom-gyp-npm-worm-vapi-ai-sdk-ollama-june-2026), [StepSecurity: self-spreading worm via Phantom Gyp](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm), [Snyk: Node-gyp Supply Chain Compromise](https://snyk.io/blog/node-gyp-supply-chain-compromise-self-propagating-npm-worm-binding-gyp/), [Chainguard: Miasma Phantom Gyp](https://www.chainguard.dev/unchained/chainguard-artifacts-safe-from-miasma-phantom-gyp-npm-attack)

### 6.4 MCP 생태계 — SDK v2 alpha 존재하나 npm 정식 미배포 (v15 승계, 상태 불변)

- **MCP TypeScript SDK v2 = npm 정식 미배포**(직접 확인): v2는 **stateless protocol core + Extensions framework + Tasks + MCP Apps + authorization hardening**를 담았고 alpha 채널에 존재하나, **npm `latest`=1.29.0이고 메인 패키지에 2.x 버전/dist-tag는 0건**(`npm view @modelcontextprotocol/sdk dist-tags --json` 직접 확인). v2 stable은 **Q3 2026 예고**(Python SDK 기준 beta 2026-06-30·stable 2026-07-27), v1.x는 v2 출시 후 6개월+ 유지. → **P15-3에서 이연한 stateless transport(session-id 제거) + task extension 전면 마이그레이션은 여전히 착수 불가**(SDK가 아직 npm `latest`에 없음). P15-3의 추적 메모(`_progress.ts`/`tool-dispatcher.ts`/`ipc-coordinator.ts`/`api-server.ts`)가 출시 시 출발점. progress-token opt-in(P14-5)은 현행 코드 정상. 출처: [MCP TS SDK v2 docs](https://ts.sdk.modelcontextprotocol.io/v2/), [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases), `npm view @modelcontextprotocol/sdk dist-tags`

### 6.5 경쟁/인접 도구 동향 (v15 승계 — 전략 추적, SCIP 후보 재평가)

- **로컬-퍼스트 코드 그래프 카테고리 성숙 지속**: Serena(LSP-over-MCP)·CodeGraph·GitNexus 등이 심볼-레벨 표준의 사실상 기본값. Cynapx의 "100% 로컬·격리·멀티프로세스 보안 IPC" 포지션이 차별점이며, **6.3의 AI 에이전트 표적 공급망 변종(`.claude/` 설정 주입)은 격리·lockfile-고정·`npm ci` 포스처의 가치를 재확인**한다.
- **SCIP가 LSIF를 대체하는 심볼 인덱스 표준으로 정착** — Cynapx `export_graph`(json/graphml/dot)에 SCIP export 추가는 미래 상호운용 후보. **재평가**: `export_graph`(MCP 도구)는 P18-1로 디스패처 게이트 커버됐으나, **REST `/api/graph/export`(`handleExportGraph`)는 여전히 게이트 미검증(M-1 v16 대상)** — SCIP 같은 신규 포맷을 얹기 전 REST export 분기도 게이트화하는 것이 합리적 선행이다. **Phase 19-1(REST 핸들러 테스트, export 포함)이 SCIP 후보의 추가 디딤돌**이 된다(SCIP 자체는 protobuf 의존 도입 + Miasma류 install-time 표면 확대 우려로 즉시 착수 비권장 — 전략 후보 유지).
- **함의**: v11~v15와 동일하게 (1) 공급망 위생 유지, (2) 생태계 스펙 추적(MCP SDK v2 — 여전히 대기), (3) **회귀 안전망 위생(v15 MCP 도구 → v16 REST 핸들러로 확장)**이 신뢰성 차별화 축이다.

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 정밀 재열람에서 신규 결함이 없었다(M-1 v16 외 코드 동작 변경 0):

- `src/server/api-server.ts` — 세션 TTL/cap/sweep(unref), timing-safe Bearer, sessionId 마스킹, per-session transport 페어, rate-limit keyGenerator 고정 양호. **`handleHotspots`의 SQL 보간은 `HotspotsSchema` z.enum + `validate()` 선행 가드로 안전(임의 컬럼 주입 불가 — 직접 확인).** 8개 REST 핸들러 코드 자체는 정상이나 동작 분기 supertest 게이트 부재(M-1 v16 대상). (L-3 stateless 충돌은 SDK v2까지 이연.)
- `src/server/ipc-coordinator.ts` — challenge-response 인증·라인 단위 1MB 바이트 제한·per-tool 타임아웃·keepalive(unref+clear)·pending reject-on-close 견고.
- `src/server/tool-dispatcher.ts` — `executeTool()` Terminal 포워딩 단락 → `waitUntilReady` → registry lookup → `EngineNotReadyError` 재시도 변환(H-1) 견고. **도구 디스패처 20/20 게이트 커버(P18-1).**
- `src/server/tools/export-graph.ts` — no-context 가드·json/graphml/dot 분기·unknown-format `isError` 양호(P18-1 게이트 커버). REST `handleExportGraph`(api-server.ts)는 별도 경로 — M-1 v16 대상.
- `src/cli/admin.ts` — 9개 명령의 락 가드(probeProjectLock)·VACUUM INTO 백업·refuse-on-live-Host(--force) 견고. `cmd*` 미-export로 vitest 직접 호출 불가(L-7 추적, 비-actionable).
- `src/indexer/worker-pool.ts` — WeakMap taskMap·double-settle 가드·timeout→replaceWorker·setImmediate 재진입 방지·dispose 큐/타이머 정리 견고.
- `src/indexer/embedding-manager.ts` — A-7 request-id discipline·spawn error 핸들러·지수 백오프 재시작·FTS5 폴백 강등·dispose SIGTERM→SIGKILL + M-2(P15-1) 배치 타이머 위생 양호.
- `src/indexer/cross-project-resolver.ts` — P14-2 indexed probe + 원격 DB sanity·1회 경고·핸들/캐시 무효화 건전.
- `src/graph/graph-engine.ts` — P14-4 Fisher-Yates + seeded PRNG 결정성 + M-4(P15-1) count-first 가드 양호(L-5 본격 파티셔닝만 이연).
- `src/server/tools/_progress.ts`·`tool-dispatcher.ts` — progress token opt-in·NOOP 폴백·sender 오류 swallow·payload 불변 + P15-3 RC 표적 주석 양호.
- `src/indexer/yaml-parser.ts` — P14-3 js-yaml 트리 파싱 + graceful 강등·라인 번호 캡처·reusable `uses` 에지 양호.
- `src/utils/lock-manager.ts` — atomic write/heartbeat staleness/nonce 자기 일치 release 검증.
- `package.json` overrides — tree-sitter `^0.25.0`(P15-2)·fast-uri `^3.1.2`(P16-1)·qs `^6.15.2`·hono `^4.12.21` 전부 패치/최신 floor 충족.
- `.github/workflows/ci.yml` — Node 22/24 매트릭스 + `npm audit --omit=dev --audit-level=high` 게이트(P14-1) + `npm ci`(lockfile 고정) 양호(Miasma 1차 방어선). `npm test`(vitest)만 돌리고 `integration-test.js`/`ipc-e2e-test.js`는 미실행 — **M-1 v16(REST 핸들러)도 vitest+supertest 게이트로 메우는 것이 정답**(e2e 스크립트는 REST를 안 침). (cynapx-autonomous.yml은 본 진단 범위 외 — 미변경.)

---

## 8. 권장 수정 순서 (Phase 19 제안 — 상세는 phase19-plan.md)

**18개 페이즈 이후 코드베이스는 여전히 성숙하나, v15의 3중 대조를 인접 등록 표면으로 확장한 신선한 재검토에서 실재하는 무위험 actionable 항목 1건(M-1 v16)이 드러났다.** CRITICAL/HIGH 0, MEDIUM 1(REST 핸들러 동작 테스트 공백 — 순수 additive), LOW 6(L-2~L-6 v15 승계 추적/이연 + L-7 신규 추적·비-actionable). 신규 CVE 중 Cynapx 도달 가능 0건, Miasma wave-3 미출현. 따라서 Phase 19는 **단일 테스트-only 서브 페이즈(P19-1) + 추적 상태 갱신**이 합리적이다.

1. **P19-1**: M-1 v16 해소 — 8개 REST 핸들러(`handleGetSymbol`/`GetCallers`/`GetCallees`/`ImpactAnalysis`/`Tests`/`Hotspots`/`SymbolSearch`/`ExportGraph`)의 핵심 동작 분기(404 가드 5건 + export 성공/실패 + 1개 validate 400)를 기존 `fakeMcpServer`/supertest 하니스로 `tests/api-server-http.test.ts`에 추가, CI vitest 게이트로 끌어올림. **`handleGetSymbol` 404/200 우선**(가드 분기 명확, mock 최소). **테스트-only, 프로덕션 코드 동작 무변경.** 578 → 신규 케이스 추가로 증가.
2. **추적 상태 갱신**: L-2(Miasma wave-3 미출현·Cynapx 트리 0건 불변, AI 에이전트 변종 인지), L-3(SDK v2 npm 미배포 — 계속 이연), L-6(node-tree-sitter#268 여전히 open), L-7(admin CLI 게이트 공백 — admin.ts 리팩터 시 후보) 현 상태를 다음 사이클 출발점으로 고정.

(L-4 IPC MessagePack 계속 보류, L-5 클러스터링 본격 파티셔닝 계속 이연, MCP 전면 stateless/task 마이그레이션은 SDK v2 npm 배포까지 이연, SCIP export는 P19-1(REST export 게이트화)을 추가 디딤돌로 두는 전략 후보로 계속 기록만.)
</content>
</invoke>
