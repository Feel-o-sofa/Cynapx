# Cynapx 정밀 진단 보고서 v15

**[DONE — Phase 18-1]**: 본 보고서가 식별한 **신규 actionable 항목 M-1 v15(CI vitest 게이트의 도구 디스패처 테스트 공백)는 Phase 18-1에서 해소됐다.** 공백이던 6개 도구(`export_graph`, `search_symbols`, `analyze_impact`, `get_callers`, `get_callees`, `get_remediation_strategy`)에 `executeTool()` 디스패처-레벨 단위 테스트 **15건**을 `tests/tool-dispatcher.test.ts`에 추가해(export_graph 5 + 나머지 각 2) CI vitest 게이트로 끌어올렸다 — vitest **563 → 578 그린**, `tsc --noEmit` 그린, `npm audit --omit=dev` 0 vulnerabilities(불변). 프로덕션 코드(`src/`) 무변경(테스트-only). 나머지 LOW 5건(L-2/L-3/L-4/L-5/L-6)은 전부 추적/이연이다.

- **기준 커밋**: `7c5d965` (Phase 17 + Phase 17-1 완료, 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-14
- **진단 범위**: src/ 전체(server, db, indexer, graph, watcher, utils, cli, bootstrap), schema/, scripts/(integration-test.js·ipc-e2e-test.js·docker-smoke.sh 포함), tests/ 전체, src-native/, Dockerfile, `.github/workflows/ci.yml`, package.json/lockfile + 외부 컨텍스트(CVE/advisory, 공급망 캠페인, MCP 생태계, 경쟁 도구)
- **진단 방법**: 단일 에이전트 순차 전수 코드 리뷰 + 로컬 직접 검증(`npx vitest run`, `npx tsc --noEmit`, `npm audit --omit=dev`, `npm ls`로 전이 의존 버전 확인, `npm view`로 registry `latest`/dist-tag 확인, 번들 SQLite 버전 확인) + **신규: 도구 레지스트리(20개) ↔ vitest `executeTool()` 테스트 케이스 ↔ CI 작업 정의 3중 교차 대조** + 웹 검색·페치 기반 외부 조사(진단 일자 재실행 — v14 스냅샷 가정 안 함)
- **현재 상태(직접 검증)**: `npx vitest run` **563/563**(43 파일), `npx tsc --noEmit` 그린, `npm audit --omit=dev` **0 vulnerabilities**(info/low/moderate/high/critical 전부 0 — 직접 실행), 번들 `sqlite_version()`=**3.53.1**. diagnostic-v14 전 항목 [DONE](Phase 17은 docs-only steady-state 사이클, 코드 변경 0).

> **요약**: **이번 사이클은 v13→Phase16, v14→Phase17의 2연속 content-light 사이클을 깨고, 회의적인 신선한 전수 재검토에서 실재하는 actionable 항목 1건을 발견했다.** 공급망·CVE·코드 결함 측면은 여전히 clean(CRITICAL/HIGH 0, 신규 CVE 도달 0)이나, **테스트 커버리지 정밀 교차 대조에서 새 신호가 드러났다 — 등록된 20개 MCP 도구 중 6개(`search_symbols`, `analyze_impact`, `get_callers`, `get_callees`, `get_remediation_strategy`, `export_graph`)는 CI가 실제로 돌리는 `npx vitest run` 게이트(563 테스트)에 디스패처-레벨 동작 테스트가 0건이다.** 이 6개는 `scripts/integration-test.js`(무거운 e2e 하니스)에서만 행사되는데, **CI(`.github/workflows/ci.yml`)는 `npm test`(=vitest) + `npm run lint`만 돌리고 `integration-test.js`는 호출하지 않는다.** 즉 이 도구들의 회귀는 **CI 게이트를 통과**할 수 있다. 특히 `export_graph` 핸들러는 세 포맷 분기(json/graphml/dot) + unknown-format 에러 분기 + no-context 가드를 가진 순수 분기 코드인데, `tool-dispatcher.test.ts`에 이미 존재하는 mock 하니스(`makeDeps`)로 즉시·무위험 단위 테스트가 가능하다. **이는 패딩이 아니라 prior 사이클들이 "테스트 통과"만 보고 "어떤 도구가 *어느 게이트에서* 테스트되는가"를 파일/케이스 레벨로 대조하지 않았던 진짜 공백이다.** 외부 측면은 신선하게 재조사했고(Miasma wave-2/2026-06-16 신규 물결, better-sqlite3 12.10.1 신규 릴리스 포함) 전부 Cynapx에 무영향임을 직접 재대조했다. **CRITICAL 0, HIGH 0, MEDIUM 1(M-1 v15, 신규 — 테스트 게이트 공백, 무위험 additive), LOW 5(전부 추적/이연, v14 승계 — 신규 0).**

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건(C-1 Docker 배포 전손, C-2 사이드카 spawn 크래시, C-3 IPC 인증 무력화)은 Phase 13에서, v11의 HIGH 1건(N-1 공급망)은 Phase 14-1에서, v12의 MEDIUM 4건은 Phase 15에서, v13의 MEDIUM 1건(M-1 fast-uri floor)은 Phase 16에서 해소됐고, 전수 재열람에서 새로운 CRITICAL/HIGH는 발견되지 않았다. IPC 핸드셰이크(`src/server/ipc-coordinator.ts`)는 random challenge + `HMAC-SHA256(nonce, challenge)` + `timingSafeEqual`로 견고하고, API Bearer는 SHA-256 후 `timingSafeEqual`(`api-server.ts`), 세션 맵은 TTL+cap+sweep(unref)로 보호된다.

---

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** 코드·공급망 어디에서도 신규 HIGH는 발견되지 않았다. `npm audit --omit=dev` = 0 vulnerabilities(직접 재검증, 6.1 참조). M-1 v15(테스트 게이트 공백)는 **현재 동작하는 결함이 아니라 회귀 방어막의 공백**이므로 HIGH가 아니라 MEDIUM으로 정직하게 등급한다 — 해당 6개 도구는 실제로 정상 동작하며(integration-test.js가 e2e로 통과), 문제는 "CI가 돌리는 빠른 게이트가 회귀를 못 잡는다"는 예방적 격차다. 외부 공급망 사건(Miasma wave-2, 6.3)도 Cynapx 의존 트리에 도달하지 않으므로 HIGH가 아니라 LOW(포스처 추적, L-2)로 다룬다.

---

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

| # | 위치 | 내용 |
|---|------|------|
| **M-1 v15** | `tests/tool-dispatcher.test.ts` (+ `scripts/integration-test.js`, `.github/workflows/ci.yml`) | **CI vitest 게이트의 도구 디스패처 테스트 공백 — 6개 도구가 빠른 게이트에서 미검증.** 등록 도구 20개(`src/server/tools/_registry.ts`의 `toolRegistry`) 중 `tool-dispatcher.test.ts`의 `executeTool('<name>', …)` 케이스로 동작 검증되는 것은 14개다(직접 대조). **검증 공백 6개: `search_symbols`, `analyze_impact`, `get_callers`, `get_callees`, `get_remediation_strategy`, `export_graph`.** 이 6개는 `scripts/integration-test.js`에서만 행사되는데 **CI `build-and-test` 작업은 `npm test`(=`vitest run`) + `npm run lint`(=`tsc --noEmit`)만 돌리고 `integration-test.js`를 호출하지 않는다**(직접 확인 — `ci.yml`에 `node scripts/integration-test.js` 라인 없음). → **이 6개 도구의 회귀는 563 게이트와 CI를 통과**할 수 있다. **근본 원인은 테스트 *부재*가 아니라 테스트가 CI 게이트 밖(무거운 e2e 하니스)에만 있다는 분포 문제다.** `executeTool()`은 `deps.isTerminal()` 단락 후 `waitUntilReady()`→`toolRegistry.get(name)`→`handler.execute()`로 직행하므로(`tool-dispatcher.ts:231-257`) 기존 `makeDeps` mock으로 무위험 단위 테스트가 가능하다. 특히 `export_graph`(`export-graph.ts`)는 no-context 가드·json/graphml/dot 3분기·unknown-format `isError` 분기로 순수 분기 코드라 테스트 가성비가 가장 높다. **verdict: actionable, 무위험 additive — Phase 18-1.** (5장 상세) **[DONE — Phase 18-1]**: 6개 도구에 `executeTool()` 단위 테스트 15건 추가(export_graph 5 + search_symbols/analyze_impact/get_callers/get_callees/get_remediation_strategy 각 2), vitest 563→578 그린. |

> **참고**: v14는 코드-변경 항목 0건이었고 v13은 1건(fast-uri floor)이었다. v15는 **순수 additive 테스트 항목 1건**으로, 코드 동작은 한 줄도 바꾸지 않으면서 CI 회귀 안전망의 실재 공백을 메운다. 이는 "할 일을 만들어낸" 것이 아니라 **레지스트리 ↔ 테스트 케이스 ↔ CI 작업 3중 대조라는, prior 사이클이 수행하지 않은 정밀 검증에서 자연히 드러난** 격차다.

---

## 4. 최적화 (LOW) — 전부 추적/이연 (v14 승계, 신규 0)

| # | 위치 | 내용 |
|---|------|------|
| L-2(v15) | `package.json` (native deps), CI / Dockerfile | **Miasma / Phantom Gyp 공급망 캠페인 포스처 추적 — wave-2(2026-06-16) 신규 물결 반영.** v14가 추적한 1차 물결(2026-06-03, 57패키지/286+ 악성 버전) 이후 **2026-06-16 전후로 weaponized `binding.gyp`의 추가 물결이 보고됐고**(OX Security "Miasma is back", Sonatype "new Shai-Hulud Miasma wave", Semgrep "Miasma v2"), 영향 범위는 **647,204 monthly downloads**로 확대됐다(ai-sdk-ollama 31k/wk, @vapi-ai/server-sdk 71k/wk 포함). **본 사이클 직접 재대조: wave-2 컴프로마이즈 패키지 패밀리(ai-sdk-ollama/autotel/awaitly/executable-stories/node-env-resolver/workflow/effect-analyzer/mountly/wrangler-deploy/evolv-coder-lite/@vapi-ai/server-sdk/@redhat-cloud-services) 12개 전부 Cynapx 트리에 "not in tree".** Cynapx native 의존(better-sqlite3 12.10.0 + tree-sitter core + 12 grammar)도 전부 무관 계열·악성 버전 미발행. **즉각 조치 불필요** — CI가 `npm ci`(lockfile 고정) + audit 게이트(P14-1) + Dockerfile 멀티스테이지로 1차 방어선 유지. **verdict: 추적만**(6.3 상세). v14 대비 "물결이 재발·확대됐으나 Cynapx 트리 도달 0건은 불변" |
| L-3(v15) | `src/server/api-server.ts` (session-id StreamableHTTP) | MCP stateless transport(2026-07-28 RC) 충돌 표면 — SDK v2 업그레이드 시 회귀 표면. **SDK v2 여전히 pre-alpha**(npm `latest`=**1.29.0**, 2.x 버전/dist-tag 미배포 — `npm view dist-tags` 직접 확인 `{ latest: '1.29.0' }`, versions 목록에 2.x 0건) → **계속 이연**. v2 RC가 stateless core/Extensions/Tasks를 담았으나 **npm 정식 배포는 아직 없음**(stable Q3 2026 예고, spec final 2026-07-28). P15-3의 `handleMcp()` 설계 메모가 출발점. **v14 대비 상태 불변 — 계속 이연** |
| L-4(v15) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환(v8→v15 이월). **성능 문제 미관측, verdict: 계속 보류.** 메시지가 작고(주로 메타데이터) round-trip이 드물어 직렬화가 병목 아님. 기록만 유지 |
| L-5(v15) | `src/graph/graph-engine.ts` | 클러스터링 본격 서브그래프 파티셔닝(O-5) — 100k+ 노드 실측 시 재검토(**verdict: 계속 이연**). M-4(v12)의 count-first 가드(`countNodes()` probe → `getAllNodes()` 풀로드 이전 short-circuit)가 OOM 1차 방어 |
| L-6(v15) | CI / Dockerfile | Node 24 + tree-sitter 0.25.x 빌드 fragility(C++20/prebuild 부재) — 상류 이슈 [node-tree-sitter#268]이 **진단 일자 여전히 open**(직접 확인 — 2026-01-12 보고, 후속 해결 댓글/prebuild 릴리스 없음). CI `build-and-test`가 Node 22/24 매트릭스에서 `npm test`를 돌리고 **현재 그린**이나, Node 24 LTS 전환 전 prebuild 가용성 재확인 필요. **추적만**(O-6 v12 승계). **v14 대비 상태 불변** |

> **신규 LOW 부재 안내**: better-sqlite3 12.10.1(2026-06-13 신규 릴리스)은 **Electron 42용 V8 external API 수정 + GitHub Actions 의존 갱신뿐이며 번들 SQLite 버전(3.53.1)·보안 수정 없음**(릴리스 노트 직접 확인). Cynapx는 Electron이 아니므로 12.10.0→12.10.1은 **기능상 no-op 갱신**이라 별도 LOW로 올리지 않는다(다음 정기 의존성 갱신 시 12.10.1로 정렬해도 무방, 비-긴급). 따라서 v15의 LOW는 L-2~L-6의 5건이며 **전부 추적/이연(코드 변경 불요)**, **신규 LOW 0건**이다.

---

## 5. 테스트 공백 (M-1 v15 상세 — 본 사이클 핵심 신규 발견)

Phase 17 종료 시 563 테스트(43 파일)로 회귀 안전망이 두텁다. **그러나 "테스트가 통과한다"와 "각 도구가 *CI가 돌리는 게이트에서* 검증된다"는 다르다.** 본 사이클은 후자를 파일/케이스 레벨로 대조했고, 다음 공백을 발견했다:

**(1) 게이트 분포 격차 (M-1 v15, actionable)**

`toolRegistry`(20개) ↔ `tool-dispatcher.test.ts`의 `executeTool()` 케이스 ↔ `ci.yml` 작업을 3중 대조한 결과:

| 도구 | vitest 디스패처 테스트(`executeTool`) | integration-test.js e2e | CI가 돌리는가 |
|------|:---:|:---:|:---:|
| get_setup_context / get_symbol_details / initialize_project / get_related_tests / check_architecture_violations / get_risk_profile / get_hotspots / find_dead_code / check_consistency / purge_index / re_tag_project / backfill_history / discover_latent_policies / propose_refactor (14개) | ✅ 있음 | ✅ | ✅ vitest 게이트 |
| **search_symbols** | ❌ 없음 | ✅ | ⚠️ e2e만 (CI 미실행) |
| **analyze_impact** | ❌ 없음 | ✅ | ⚠️ e2e만 (CI 미실행) |
| **get_callers** | ❌ 없음 | ✅ | ⚠️ e2e만 (CI 미실행) |
| **get_callees** | ❌ 없음 | ✅ | ⚠️ e2e만 (CI 미실행) |
| **get_remediation_strategy** | ❌ 없음 | ✅ | ⚠️ e2e만 (CI 미실행) |
| **export_graph** | ❌ 없음 | ✅ | ⚠️ e2e만 (CI 미실행) |

> 주: `search_symbols`/`get_callers`는 `phase13-8-*`·`ipc-coordinator` 등에서 *문자열로 언급*되나 `executeTool()`을 통한 디스패처 동작 테스트는 아니다(IPC 포워딩/스키마 맥락). `export_graph`/`analyze_impact`/`get_callees`/`get_remediation_strategy`는 `scripts/integration-test.js`에서만 실제 호출된다.

**함의**: `integration-test.js`는 CI `build-and-test`(`npm test`=vitest + `npm run lint`)에서 호출되지 않으므로, 이 6개 도구의 핸들러 회귀(예: `export_graph`의 포맷 분기 깨짐, no-context 가드 제거)는 **CI를 통과**한다. **Phase 18-1에서 6개 도구의 핵심 분기를 기존 `makeDeps` mock으로 디스패처-레벨 단위 테스트에 추가해 게이트로 끌어올린다.** `export_graph`가 우선순위 1위(순수 분기 코드, 가성비 최고): no-context 가드 → `isError`, unknown-format → `isError` + "Supported: json, graphml, dot", json/graphml/dot 각 포맷의 골격(예: graphml은 `<graphml`/`<node`/`<edge`, dot은 `digraph G {`/`->`) 검증.

**(2) 그 외 영역 — 공백 없음**

기존 스위트는 lock 경합·IPC e2e+인증·REST HTTP·비-TS 메트릭·git 이력 재작성·purge 재초기화·임베딩 프로토콜(A-7 + M-2)·CrossProjectResolver 멀티프로젝트(P14-2)·클러스터링 결정성+count-first 가드(P14-4 + M-4)·MCP progress(P14-5)·YAML 견고성(P14-3)을 이미 커버한다. M-1 v15 외에 신규 테스트가 필요한 결함은 없다.

---

## 6. 외부 컨텍스트 (웹 조사 — 진단 일자 재실행, 출처 명시)

### 6.1 의존성 취약점 (진단 일자 직접 재검증 — 전부 clean)

`npm audit --omit=dev` + `npm ls` + `npm view`로 직접 재확인했다:

- **`npm audit --omit=dev` = 0 vulnerabilities** (info/low/moderate/high/critical 전부 0 — 직접 실행). Phase 14-1 baseline 유지.
- **fast-uri**: `overrides`로 floor·설치본 모두 `3.1.2`(`package.json`=`^3.1.2`, `npm ls fast-uri`=`@modelcontextprotocol/sdk → ajv@8.18.0 → fast-uri@3.1.2 overridden` 직접 확인). **CVE-2026-6321**(path traversal, ≤3.1.0, 3.1.1 패치)·**CVE-2026-6322**(host confusion, ≤3.1.1, 3.1.2 패치) 둘 다 3.1.2에서 해소 → Phase 16-1 floor 못 박음 유효. 출처: [GHSA-q3j6-qgpj-74h6 / CVE-2026-6321](https://github.com/advisories/GHSA-q3j6-qgpj-74h6), [GitLab advisory CVE-2026-6322](https://advisories.gitlab.com/npm/fast-uri/CVE-2026-6322/)
- **`@modelcontextprotocol/sdk`**: npm `latest`=**1.29.0**(직접 `npm view dist-tags` 확인 — `{ latest: '1.29.0' }`, 2.x 버전 목록 0건). 상류 이슈 [typescript-sdk#2042](https://github.com/modelcontextprotocol/typescript-sdk/issues/2042)(1.29.0 전이 취약점 추적)는 여전히 open — Cynapx `overrides`(fast-uri/qs/hono)가 계속 정답. 제안 타깃(ajv ≥8.18.0, hono ≥4.12.18, express-rate-limit ≥8.5.1) 이미 충족(설치본: ajv 8.18.0, hono 4.12.25, express-rate-limit 8.5.2). 출처: 위 이슈, npm registry.
- **express-rate-limit 8.5.2 → ip-address 10.2.0**: CVE-2026-30827(IPv4-mapped IPv6 rate-limit bypass) 패치 라인. Cynapx는 `keyGenerator`를 `req.socket.remoteAddress`로 고정(`api-server.ts`)해 이중 우회. clean.
- **qs `^6.15.2`**(설치 6.15.2): express@4.22.1/express@5.2.1/superagent 경유 전부 dedupe(`npm ls qs` 확인). comma-format array stringify DoS 패치. clean.
- **hono `^4.12.21`**(설치 4.12.25, override): #2042 거론 모더릿 취약점(bodyLimit/JSX/JWT/cache) 패치 라인 이상. clean.
- **js-yaml 4.2.0**: CVE-2025-64718(<4.1.1) 비해당. CVE-2026-33532(deeply-nested flow sequence DoS)는 `yaml`(eemeli) 대상이지 `js-yaml`(nodeca)이 아님 — Cynapx는 `js-yaml`만 사용. 출처: [CVE-2026-33532](https://www.sentinelone.com/vulnerability-database/cve-2026-33532/)
- **better-sqlite3 12.10.0 / SQLite 3.53.1**: 로컬 `sqlite_version()`=**3.53.1** 직접 확인. **신규 릴리스 12.10.1(2026-06-13)은 Electron 42용 V8 external API 수정 + GitHub Actions 의존 갱신뿐 — 번들 SQLite 버전·보안 수정 없음**(릴리스 노트 직접 확인). Cynapx는 Electron이 아니므로 기능상 no-op 갱신. CVE-2025-7709/70873/6965 등은 3.53.1에서 비해당/패치. Miasma 캠페인에서 악성 버전 미발행, clean. 출처: [WiseLibs/better-sqlite3 releases](https://github.com/WiseLibs/better-sqlite3/releases), [better-sqlite3 Snyk](https://security.snyk.io/package/npm/better-sqlite3)
- **sqlite-vec 0.1.9 / swagger-ui-express 5 / commander 14 / chokidar 5 / simple-git 3.36 / ignore 7 / zod 4.3.6 / express 4.22.x**: 미해결 공개 취약점 미발견.

### 6.2 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"` + Docker `node:22-bookworm-slim`. Node 22 LTS 유지보수 2027-04 종료 — 여유. CI Node 22/24 매트릭스 그린(563/563). Node 24 + tree-sitter 0.25.x는 [node-tree-sitter#268](https://github.com/tree-sitter/node-tree-sitter/issues/268)(여전히 open, 2026-01-12 보고)의 C++20/prebuild 부재 fragility(L-6).
- **tree-sitter 코어**: npm `latest`=**0.25.0**(직접 확인 — 0.25.1 미존재). 12 grammar 전부 `tree-sitter@0.25.0 deduped/overridden`(single top-level override, `npm ls tree-sitter` 직접 확인). **tree-sitter-c-sharp**: npm 최신 여전히 **0.23.5**(`npm view versions` tail = [..., 0.23.0, 0.23.1, 0.23.5], 0.23.6 미배포 — P15-2의 `ERR_REQUIRE_ASYNC_MODULE` 해소 신버전 없음) → **0.23.1 정확 핀 롤백 유지가 여전히 옳다**. 출처: `npm view tree-sitter-c-sharp versions`, [tree-sitter npm v0.26 미배포 이슈 #5334](https://github.com/tree-sitter/tree-sitter/issues/5334)

### 6.3 공급망 캠페인 — Miasma / Phantom Gyp wave-2 (v14 승계, 물결 재발·확대 — Cynapx 도달 0건 불변)

- **Miasma / Phantom Gyp wave-2(2026-06-16 전후 신규 물결)**: v14가 추적한 1차 물결(2026-06-03, 57패키지/286+ 악성 버전, @redhat-cloud-services 32 + @vapi-ai/server-sdk) 이후, 2026-06-16 전후로 **weaponized `binding.gyp`의 추가 물결**이 보고됐다(OX Security "Miasma is back" — 647,204 monthly downloads 영향, Sonatype "new Shai-Hulud Miasma wave", Semgrep "Miasma v2", Phoenix Security "Miasma Wave2"). 핵심 기법은 동일 — **157-byte `binding.gyp`에 페이로드 트리거를 숨겨 `npm install` 시 node-gyp가 자동 실행**, `--ignore-scripts`(preinstall/postinstall만 차단)를 우회. 페이로드는 npm/GitHub/AWS/GCP/Azure/Vault/K8s 자격증명 수집·유출 + GitHub Actions 워크플로 주입 + self-propagate. **본 사이클 직접 재대조: wave-2 패키지 패밀리(ai-sdk-ollama/autotel/awaitly/executable-stories/node-env-resolver/workflow/effect-analyzer/mountly/wrangler-deploy/evolv-coder-lite/@vapi-ai/server-sdk/@redhat-cloud-services) 12개 전부 Cynapx 트리에 "not in tree"** + Cynapx native 의존(better-sqlite3 + tree-sitter 12 grammar) 전부 무관·악성 버전 미발행. **함의(L-2)**: Cynapx는 node-gyp 빌드 native 모듈 13개를 쓰므로 이 기법의 표적 표면에 구조적으로 노출되나, (a) CI `npm ci`(lockfile 고정), (b) P14-1 audit 게이트, (c) Dockerfile 멀티스테이지로 1차 방어선 유지. **즉각 코드 변경 불필요, 포스처 추적 — 의존 추가 시 binding.gyp 검토 + `npm ci`만 유지 + 매 사이클 `npm ls` 재대조.** 출처: [OX Security: Miasma is back](https://www.ox.security/blog/600000-monthly-downloads-affected-miasma-supply-chain-attack-is-back-on-npm/), [Semgrep: Miasma v2](https://semgrep.dev/blog/2026/miasma-v2-self-spreading-npm-worm-now-uses-malicious-bindinggyp-file-and-compromises-57-packages/), [Sonatype: new Shai-Hulud Miasma wave](https://www.sonatype.com/blog/new-shai-hulud-miasma-wave-hits-hundreds-of-npm-packages), [Snyk: Node-gyp Supply Chain Compromise](https://snyk.io/blog/node-gyp-supply-chain-compromise-self-propagating-npm-worm-binding-gyp/), [Chainguard: Miasma Phantom Gyp](https://www.chainguard.dev/unchained/chainguard-artifacts-safe-from-miasma-phantom-gyp-npm-attack)

### 6.4 MCP 생태계 — SDK v2 RC 존재하나 npm 미배포 (v14 승계, 상태 불변)

- **MCP TypeScript SDK v2 = 여전히 pre-alpha·npm 미배포**(직접 확인): v2 RC가 **stateless protocol core + Extensions framework + Tasks + MCP Apps + authorization hardening + formal deprecation policy**를 담았고(2026-07-28 spec final 정렬), TS SDK는 `sessionIdGenerator`를 `undefined`로 두면 stateless 모드가 된다. **그러나 npm `latest`=1.29.0이고 2.x 버전/dist-tag는 0건**(`npm view @modelcontextprotocol/sdk dist-tags` 직접 확인). v2 stable은 여전히 **Q3 2026 예고**, v1.x는 v2 출시 후 6개월+ 유지. → **P15-3에서 이연한 stateless transport(session-id 제거) + task extension 전면 마이그레이션은 여전히 착수 불가**(SDK가 아직 npm에 없음). P15-3의 추적 메모(`_progress.ts`/`tool-dispatcher.ts`/`ipc-coordinator.ts`/`api-server.ts`)가 출시 시 출발점으로 유효. progress-token opt-in(P14-5)은 RC에서도 유지 → 현행 코드 정상. 출처: [MCP TS SDK v2 docs](https://ts.sdk.modelcontextprotocol.io/v2/), [2026-07-28 RC 블로그](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/), `npm view @modelcontextprotocol/sdk dist-tags`

### 6.5 경쟁/인접 도구 동향 (v14 승계 — 전략 추적, SCIP 후보 재평가)

- **로컬-퍼스트 코드 그래프 카테고리 성숙 지속**: Serena(LSP-over-MCP)·CodeGraph·GitNexus 등이 심볼-레벨 표준의 사실상 기본값. Cynapx의 "100% 로컬·격리·멀티프로세스 보안 IPC" 포지션이 차별점이며, 2026-06 공급망 물결(Miasma wave-2)은 격리·lockfile-고정 포스처의 가치를 재확인한다.
- **SCIP가 LSIF를 대체하는 심볼 인덱스 표준으로 정착** — Cynapx `export_graph`(json/graphml/dot)에 SCIP export 추가는 미래 상호운용 후보. **재평가**: SCIP는 protobuf 스키마 의존(새 빌드 의존 도입)이고, `export_graph` 핸들러는 현재 **그 자체가 CI vitest 게이트에 단위 테스트가 없다**(M-1 v15) — 따라서 SCIP 같은 신규 포맷을 얹기 *전에* 기존 포맷 분기를 게이트로 끌어올리는 것이 올바른 선행 조건이다. **Phase 18-1(export_graph 단위 테스트)이 SCIP 후보의 합리적 첫 디딤돌**이 된다(SCIP 자체는 여전히 Phase 18 범위 밖 전략 후보 — protobuf 의존 추가 부담 + Miasma류 install-time 표면 확대 우려로 즉시 착수 비권장).
- **함의**: v11~v14와 동일하게 (1) 공급망 위생 유지, (2) 생태계 스펙 추적(MCP SDK v2 — 여전히 대기), (3) **회귀 안전망 위생(M-1 v15가 첫 actionable)**이 신뢰성 차별화 축이다.

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 정밀 재열람에서 신규 결함이 없었다(M-1 v15 외 코드 동작 변경 0):

- `src/server/ipc-coordinator.ts` — challenge-response 인증·라인 단위 1MB 바이트 제한·per-tool 타임아웃·keepalive(unref+clear)·pending reject-on-close 견고.
- `src/server/api-server.ts` — 세션 TTL/cap/sweep(unref), timing-safe Bearer, sessionId 마스킹, per-session transport 페어, rate-limit keyGenerator 고정 양호(L-3 stateless 충돌은 SDK v2까지 이연).
- `src/server/tool-dispatcher.ts` — `executeTool()` Terminal 포워딩 단락 → `waitUntilReady` → registry lookup → `EngineNotReadyError` 재시도 변환(H-1) 견고. (M-1 v15는 이 디스패처의 *동작* 결함이 아니라 6개 도구의 *테스트 게이트 분포* 격차다 — 코드는 정상.)
- `src/server/tools/export-graph.ts` — no-context 가드·json(mermaid+summary)/graphml(escapeXml)/dot(escapeDot) 분기·unknown-format `isError` 양호. **코드 정상이나 vitest 게이트 단위 테스트 부재(M-1 v15 대상).**
- `src/indexer/worker-pool.ts` — WeakMap taskMap·double-settle 가드·timeout→replaceWorker·setImmediate 재진입 방지·dispose 큐/타이머 정리 견고.
- `src/indexer/embedding-manager.ts` — A-7 request-id discipline·spawn error 핸들러·지수 백오프 재시작·FTS5 폴백 강등·dispose SIGTERM→SIGKILL + M-2(P15-1) 배치 타이머 위생 양호.
- `src/indexer/cross-project-resolver.ts` — P14-2 indexed probe + 원격 DB sanity·1회 경고·핸들/캐시 무효화 건전.
- `src/graph/graph-engine.ts` — P14-4 Fisher-Yates + seeded PRNG 결정성 + M-4(P15-1) count-first 가드 양호(L-5 본격 파티셔닝만 이연).
- `src/server/tools/_progress.ts`·`tool-dispatcher.ts` — progress token opt-in·NOOP 폴백·sender 오류 swallow·payload 불변 + P15-3 2026-07-28 RC 표적 주석 양호.
- `src/indexer/yaml-parser.ts` — P14-3 js-yaml 트리 파싱 + graceful 강등·라인 번호 캡처·reusable `uses` 에지 양호.
- `src/utils/lock-manager.ts` — atomic write/heartbeat staleness/nonce 자기 일치 release 검증.
- `package.json` overrides — tree-sitter `^0.25.0`(P15-2)·fast-uri `^3.1.2`(P16-1)·qs `^6.15.2`·hono `^4.12.21` 전부 패치/최신 floor 충족.
- `.github/workflows/ci.yml` — Node 22/24 매트릭스 + `npm audit --omit=dev --audit-level=high` 게이트(P14-1) + `npm ci`(lockfile 고정) 양호(Miasma 1차 방어선). **단, `npm test`(vitest)만 돌리고 `integration-test.js`는 미실행 — M-1 v15가 이 게이트 분포를 메운다.** (cynapx-autonomous.yml은 본 진단 범위 외 — 미변경.)

---

## 8. 권장 수정 순서 (Phase 18 제안 — 상세는 phase18-plan.md)

**17개 페이즈 이후 코드베이스는 여전히 성숙하나, 신선한 정밀 교차 대조에서 실재하는 무위험 actionable 항목 1건(M-1 v15)이 드러났다.** CRITICAL/HIGH 0, MEDIUM 1(테스트 게이트 공백 — 순수 additive), LOW 5(전부 추적/이연, v14 승계, 신규 0). 신규 CVE 중 Cynapx 도달 가능 0건. 따라서 Phase 18은 **단일 테스트-only 서브 페이즈(P18-1) + 추적 상태 갱신**이 합리적이다.

1. **P18-1**: M-1 v15 해소 — 6개 도구(`search_symbols`, `analyze_impact`, `get_callers`, `get_callees`, `get_remediation_strategy`, `export_graph`)의 디스패처-레벨 단위 테스트를 기존 `makeDeps` mock으로 `tool-dispatcher.test.ts`에 추가, CI vitest 게이트로 끌어올림. **`export_graph` 우선**(순수 분기 코드). **테스트-only, 프로덕션 코드 동작 무변경.** 563 → 신규 케이스 추가로 증가.
2. **추적 상태 갱신**: L-2(Miasma wave-2 — Cynapx 트리 0건 불변), L-3(SDK v2 npm 미배포 — 계속 이연), L-6(node-tree-sitter#268 여전히 open) 현 상태를 다음 사이클 출발점으로 고정.

(L-4 IPC MessagePack 계속 보류, L-5 클러스터링 본격 파티셔닝 계속 이연, MCP 전면 stateless/task 마이그레이션은 SDK v2 npm 배포까지 이연 — SDK 미배포라 착수 불가, SCIP export는 P18-1을 선행 디딤돌로 두는 전략 후보로 계속 기록만.)
