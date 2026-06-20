# Cynapx 정밀 진단 보고서 v14

**[DONE — Phase 17-1]**: 본 보고서가 식별한 LOW 5건(L-2/L-3/L-4/L-5/L-6)은 전부 추적/이연이며, Phase 17-1에서 추적 상태를 재확인·고정했다(phase17-plan.md §2 참조). 코드 변경 항목 0건이므로 본 보고서 자체가 Phase 17-1의 산출물이다.

- **기준 커밋**: `af196fe` (Phase 16-1 + Phase 16 완료, 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-14
- **진단 범위**: src/ 전체 (server, db, indexer, graph, watcher, utils, cli, bootstrap), schema/, scripts/, tests/, src-native/, Dockerfile, `.github/workflows/ci.yml`, package.json/lockfile + 외부 컨텍스트(CVE/advisory, 공급망 캠페인, MCP 생태계, 경쟁 도구)
- **진단 방법**: 단일 에이전트 순차 전수 코드 리뷰 + 로컬 검증(`npx vitest run` 직접 실행, `npx tsc --noEmit` 직접 실행, `npm audit --omit=dev` 직접 실행, `npm ls`로 전이 의존 버전 확인, `npm view`로 registry `latest`/dist-tag 확인, 번들 SQLite 버전 확인) + 웹 검색·페치 기반 외부 조사
- **현재 상태(직접 검증)**: Phase 16 종료 시점 — `npx vitest run` **563/563**(43 파일), `npx tsc --noEmit` 그린, `npm audit --omit=dev` **0 vulnerabilities**(info/low/moderate/high/critical 전부 0 — 직접 실행), 번들 `sqlite_version()`=**3.53.1**. diagnostic-v13 전 항목 [DONE](M-1 v13 fast-uri override floor `^3.1.2` Phase 16-1에서 커밋·푸시 완료).

> **요약**: **16개 페이즈·~33 커밋의 하드닝 이후 코드·공급망 양쪽 모두 신규 결함 0이다 — 코드베이스는 v13에서 선언한 steady state(유지보수 모드)를 유지한다.** diagnostic-v13의 유일한 코드-변경 항목(M-1 v13: fast-uri override floor `^3.1.1`→`^3.1.2`)은 Phase 16-1에서 처리·커밋됐고, 본 사이클 직접 재검증 결과 `overrides.fast-uri`=`^3.1.2`·`npm ls fast-uri`=`3.1.2 overridden`·`npm audit --omit=dev`=**0 vulnerabilities**가 모두 확인된다. **이번 사이클에는 새로운 actionable 신호가 없다 — 신규 CVE 중 Cynapx에 도달 가능한 것 0건, 새로운 코드 결함 0건이며, 추적 중인 4개 외부 항목(Miasma 공급망, MCP SDK v2, node-tree-sitter#268, 경쟁 도구 동향)은 v13 대비 상태가 전부 불변이다.** 구체적으로: (1) **MCP TypeScript SDK v2는 여전히 pre-alpha**(npm `latest`=1.29.0, v2.x dist-tag 미배포 — `npm view`로 직접 확인)라 stateless transport / task extension 전면 마이그레이션은 **계속 착수 불가·이연**. (2) **Miasma / Phantom Gyp 공급망 캠페인**(2026-06-03)의 컴프로마이즈 패키지(@redhat-cloud-services 32개 + @vapi-ai/server-sdk + jagreehal 계열 57패키지/286+ 악성 버전)는 **Cynapx 의존 트리에 여전히 0건**(직접 대조 재확인). (3) **node-tree-sitter#268**(Node 24 빌드 fragility)은 진단 일자 **여전히 open**(직접 확인), Node 22/24 CI 그린 유지. (4) fast-uri **CVE-2026-6322**는 Phase 16-1에서 floor를 못 박아 이미 해소. **CRITICAL 0, HIGH 0, MEDIUM 0, LOW 5(전부 추적/이연, v13 승계 — 신규 0).** 이 보고서는 정직하게 말한다 — **이번 사이클에는 본질적으로 새로 할 코드 작업이 없다.** Phase 17은 유지보수 모드 포스처의 정기 점검 갱신이 본질이다.

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건(C-1 Docker 배포 전손, C-2 사이드카 spawn 크래시, C-3 IPC 인증 무력화)은 Phase 13에서, v11의 HIGH 1건(N-1 공급망)은 Phase 14-1에서, v12의 MEDIUM 4건은 Phase 15에서, v13의 MEDIUM 1건(M-1 fast-uri floor)은 Phase 16에서 해소됐고, 전수 재열람에서 새로운 CRITICAL/HIGH는 발견되지 않았다. IPC 핸드셰이크(`src/server/ipc-coordinator.ts`)는 random challenge + `HMAC-SHA256(nonce, challenge)` + `timingSafeEqual`로 견고하고, API Bearer는 SHA-256 후 `timingSafeEqual`(`api-server.ts`), 세션 맵은 TTL+cap+sweep(unref)로 보호된다.

---

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** 코드·공급망 어디에서도 신규 HIGH는 발견되지 않았다. `npm audit --omit=dev` = 0 vulnerabilities(직접 재검증, 6.1 참조). 발견 부풀리기를 피하기 위해 명시한다 — 본 사이클에서 HIGH 등급으로 올릴 만한 결함은 없다. 외부 공급망 사건(Miasma, 6.3)도 Cynapx 의존 트리에 도달하지 않으므로 HIGH가 아니라 LOW(포스처 추적, L-2)로 다룬다.

---

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

**없음.** diagnostic-v13의 유일한 MEDIUM(M-1 v13: fast-uri override floor 명시성)은 Phase 16-1에서 해소됐고(직접 확인: `package.json` `overrides.fast-uri`=`^3.1.2`, `npm ls fast-uri`=`3.1.2 overridden`), 전수 재열람에서 **신규 MEDIUM은 발견되지 않았다.** 본 사이클에는 코드 변경을 요구하는 결함이 0건이다 — 이는 부족한 진단이 아니라 16 페이즈 하드닝 이후 도달한 성숙도의 정직한 반영이다(7장 "깨끗하게 확인된 영역" 참조).

> **참고**: 이전 사이클들은 매번 최소 1건의 코드-변경 항목을 가졌으나(v12=4 MEDIUM, v13=1 MEDIUM), v14에는 그조차 없다. 외부 신호 두 가지(Miasma 공급망, MCP SDK v2)는 v13에서 식별된 그대로이며 둘 다 여전히 즉시 코드 변경을 요구하지 않는다(SDK v2는 미배포라 착수 불가, Miasma는 의존 트리 미도달). 따라서 v14는 **추적/이연 항목의 상태 갱신**이 전부다.

---

## 4. 최적화 (LOW) — 전부 추적/이연 (v13 승계, 신규 0)

| # | 위치 | 내용 |
|---|------|------|
| L-2(v14) | `package.json` (native deps), CI / Dockerfile | **Miasma / Phantom Gyp 공급망 캠페인(2026-06-03) 포스처 추적.** binding.gyp가 `--ignore-scripts`를 우회해 node-gyp 빌드 시점에 임의 코드를 실행하는 install-time 웜. 컴프로마이즈된 57개 패키지(autotel/awaitly/executable-stories/node-env-resolver/wrangler-deploy/@vapi-ai/server-sdk 계열 + @redhat-cloud-services 32개 + jagreehal 계열)는 **Cynapx 의존 트리에 0건**(본 사이클 `npm ls` 직접 재대조 — 7개 패키지 패밀리 전부 "not in tree"), Cynapx native 의존(better-sqlite3 12.10.0 = clean 최신, tree-sitter 12 grammar)도 전부 clean. **즉각 조치 불필요** — CI가 `npm ci`(lockfile 고정 install)를 쓰고 audit 게이트(P14-1)가 있으므로 1차 방어선은 있다. **verdict: 추적만**(6.3 상세). **Phase 16-1(v13) 대비 상태 불변** — 새로운 컴프로마이즈 패키지가 Cynapx 트리에 진입한 정황 없음. 다음 사이클도 추적만 |
| L-3(v14) | `src/server/api-server.ts` (session-id StreamableHTTP) | MCP stateless transport(2026-07-28 RC) 충돌 표면 — SDK v2 업그레이드 시 회귀 표면. **SDK v2 여전히 pre-alpha**(npm `latest`=1.29.0, v2.x dist-tag 미배포 직접 확인) → **계속 이연**. P15-3의 `handleMcp()` 설계 메모가 출발점. **v13 대비 상태 불변** — v2 alpha 마일스톤(2026-03 예고)·beta(2026-05 예고)가 npm 배포로 이어지지 않았으며, stable은 여전히 Q3 2026(2026-07-28 spec final) 예고. 계속 이연 |
| L-4(v14) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환(v8→v14 이월). **성능 문제 미관측, verdict: 계속 보류.** 메시지가 작고(주로 메타데이터) round-trip이 드물어 직렬화가 병목 아님. 기록만 유지 |
| L-5(v14) | `src/graph/graph-engine.ts` | 클러스터링 본격 서브그래프 파티셔닝(O-5) — 100k+ 노드 실측 시 재검토(**verdict: 계속 이연**). M-4(v12)의 count-first 가드(`countNodes()` probe → `getAllNodes()` 풀로드 이전 short-circuit)가 OOM 1차 방어 |
| L-6(v14) | CI / Dockerfile | Node 24 + tree-sitter 0.25.x 빌드 fragility(C++20/prebuild 부재) — 상류 이슈 [node-tree-sitter#268]가 **진단 일자 여전히 open**(직접 확인 — "No native build found for ... runtime=node abi=127", postinstall C++17/Node 24 부정합, 최근 해결 정황 없음). CI `build-and-test`가 Node 22/24 매트릭스에서 `npm test`를 돌리고 **현재 그린**이나, Node 24 LTS 전환 전 prebuild 가용성 재확인 필요. **추적만**(O-6 v12 승계). **v13 대비 상태 불변** — 다음 사이클도 추적만 |

> **L-1 부재 안내**: v13의 L-1(fast-uri floor LOW 추적)은 M-1 v13과 함께 Phase 16-1에서 해소됐으므로 v14에는 승계하지 않는다. 따라서 v14의 LOW는 L-2~L-6의 5건이며 **전부 추적/이연(코드 변경 불요)**이고 **신규 LOW는 0건**이다.

---

## 5. 테스트 공백

Phase 16 종료 시 563 테스트(43 파일, 통합 76 케이스)로 회귀 안전망이 매우 두텁다. **본 사이클의 신규/잔존 공백은 0이다** — 코드 변경 항목이 없으므로 추가 검증이 필요한 시나리오가 발생하지 않았다.

기존 스위트(`tests/`)는 lock 경합·IPC e2e+인증·REST HTTP·비-TS 메트릭·git 이력 재작성·purge 재초기화·임베딩 프로토콜(A-7 request-id discipline + M-2 배치 타이머 위생)·CrossProjectResolver 멀티프로젝트(P14-2)·클러스터링 결정성+count-first 가드(P14-4 + M-4)·MCP progress(P14-5)·YAML 견고성(P14-3)을 이미 커버한다 — **신규 테스트가 필요한 결함이 없다.** override floor(fast-uri `^3.1.2`)는 선언적 메타데이터이며 설치본 불변이라 별도 회귀 테스트가 불필요하다(transport 경유 회귀는 기존 `api-server-http`·`mcp-server` 스위트가 커버, 본 사이클 563/563 그린으로 재확인).

---

## 6. 외부 컨텍스트 (웹 조사 — 출처 명시)

### 6.1 의존성 취약점 (진단 일자 직접 재검증 — 전부 clean)

`npm audit --omit=dev` + `npm ls` + `npm view`로 직접 재확인했다:

- **`npm audit --omit=dev` = 0 vulnerabilities** (info/low/moderate/high/critical 전부 0 — 직접 실행). Phase 14-1 baseline 유지.
- **fast-uri**: `overrides`로 floor·설치본 모두 `3.1.2`(`package.json`=`^3.1.2`, `npm ls fast-uri`=`3.1.2 overridden`·lockfile 직접 확인). **CVE-2026-6321**(path traversal via percent-encoded dot segments, ≤3.1.0 영향, CVSS 7.5 HIGH, 3.1.1 패치)·**CVE-2026-6322**(host confusion via percent-encoded authority delimiters, ≤3.1.1 영향, 3.1.2 패치) **둘 다 3.1.2에서 패치** → 설치본·선언 floor 모두 무관. **Phase 16-1에서 floor를 `^3.1.1`→`^3.1.2`로 못 박아 "override floor ≥ 알려진 패치 버전" 불변을 선언 수준에서 복원 완료.** SDK `@modelcontextprotocol/sdk@1.29.0`가 여전히 ajv→fast-uri를 끌어오나 override가 dedupe. 출처: [GHSA-q3j6-qgpj-74h6 / CVE-2026-6321](https://github.com/advisories/GHSA-q3j6-qgpj-74h6), [GitLab advisory CVE-2026-6322](https://advisories.gitlab.com/npm/fast-uri/CVE-2026-6322/)
- **`@modelcontextprotocol/sdk`**: npm `latest`=**1.29.0**(직접 `npm view dist-tags` 확인 — `{ latest: '1.29.0' }`, 1.30/2.x dist-tag 미배포). 상류 이슈 [typescript-sdk#2042](https://github.com/modelcontextprotocol/typescript-sdk/issues/2042)("Transitive dependencies with known vulnerabilities in 1.29.0", 2026-05-11 보고)는 **진단 일자 여전히 open** — 상류 패치 미반영이라 Cynapx의 `overrides`(fast-uri/qs/hono)가 계속 유효한 해법. 이슈가 제안한 타깃(ajv ≥8.18.0, hono ≥4.12.18, express-rate-limit ≥8.5.1)은 Cynapx가 이미 충족(hono override `^4.12.21`→설치 4.12.25, express-rate-limit `8.5.2`→ip-address 10.2.0). 출처: 위 이슈, npm registry.
- **express-rate-limit 8.5.2** → **ip-address 10.2.0**(`npm ls` 확인): ip-address XSS·CVE-2026-30827(IPv4-mapped IPv6 rate-limit bypass) 패치 라인. Cynapx는 `keyGenerator`를 `req.socket.remoteAddress`로 고정(`api-server.ts`)해 bypass를 이중 우회. clean.
- **qs `^6.15.2`**(설치 6.15.2): comma-format array stringify DoS 패치. express@4.22.1/SDK express@5.2.1/superagent 경유 전부 dedupe(`npm ls qs` 확인 — 전 경로 6.15.2). clean.
- **hono `^4.12.21`**(설치 4.12.25, override): bodyLimit bypass·JSX injection·JWT validation·cache leakage 등 #2042가 거론한 모더릿 취약점 패치 라인 이상. clean.
- **js-yaml 4.2.0**: CVE-2025-64718(proto pollution, <4.1.1 영향)는 4.2.0이 패치 라인 이상이라 무관. CVE-2026-33532(deeply-nested flow sequence stack overflow DoS)는 **`yaml`(eemeli/yaml) 라이브러리 대상이지 `js-yaml`(nodeca)이 아니다** — Cynapx는 `js-yaml`만 쓰고 `yaml`을 쓰지 않으므로 무관. 출처: [CVE-2026-33532](https://www.sentinelone.com/vulnerability-database/cve-2026-33532/)
- **better-sqlite3 12.10.0 / SQLite 3.53.1**: 로컬 `sqlite_version()`=**3.53.1** 직접 확인. CVE-2025-7709(FTS5 integer overflow, 3.51.3 패치)·CVE-2025-70873(zipfile heap disclosure)·CVE-2025-6965(<3.50.2)는 모두 3.53.1에서 비해당/패치. better-sqlite3는 Snyk DB에 직접 취약점 0건(전이 의존 제외). **Miasma 캠페인에서 better-sqlite3는 악성 버전이 발행되지 않았고 12.10.0이 clean 최신**(6.3 상세). clean. 출처: [SQLite security](https://stack.watch/product/sqlite/sqlite/), [better-sqlite3 Snyk](https://security.snyk.io/package/npm/better-sqlite3)
- **sqlite-vec 0.1.9 / swagger-ui-express 5 / commander 14 / chokidar 5 / simple-git / ignore 7 / zod 4 / express 4.22.x**: 미해결 공개 취약점 미발견(express@4.22.1은 qs override로 알려진 전이 취약점 해소).

### 6.2 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"` + Docker `node:22-bookworm-slim`. Node 22 LTS 유지보수 2027-04 종료 — 여유. CI `build-and-test`가 Node 22/24 매트릭스에서 `npm test`를 돌린다(563/563 그린). Node 24 + tree-sitter 0.25.x는 상류에서 C++20/prebuild 부재 빌드 실패가 보고됐으나([node-tree-sitter#268], 진단 일자 여전히 open) Cynapx CI는 현재 통과 — prebuild 가용성 의존 fragility(L-6). 출처: [node-tree-sitter#268](https://github.com/tree-sitter/node-tree-sitter/issues/268)
- **tree-sitter 코어**: npm `latest`=**0.25.0**(직접 `npm view tree-sitter version` 확인 — 0.25.1 여전히 미존재). 코어 변경 여지 없음(P15-2 일관). 12 grammar 전부 `tree-sitter@0.25.0 deduped`(top-level 단일 override, `npm ls tree-sitter` 직접 확인). **tree-sitter-c-sharp**: npm 최신 여전히 **0.23.5**(`npm view versions` = [..., 0.23.1, 0.23.5], 0.23.6 미배포 직접 확인) — P15-2의 `ERR_REQUIRE_ASYNC_MODULE`(ESM/TLA 바인딩) 회귀를 해소하는 **신규 버전 없음** → **0.23.1 정확 핀 롤백 유지가 여전히 옳다**. 출처: `npm view tree-sitter-c-sharp versions`, [node-tree-sitter](https://www.npmjs.com/package/tree-sitter)

### 6.3 공급망 캠페인 — Miasma / Phantom Gyp (v13 승계, 상태 불변)

- **Miasma / Phantom Gyp(2026-06-03 npm 공급망 웜)**: 2시간 내 **57개 패키지·286+ 악성 버전**을 컴프로마이즈한 자기증식 웜. 선행 표적은 **@redhat-cloud-services 32개 패키지(2026-06-01)** + **@vapi-ai/server-sdk 4개 버전(2026-06-03 23:30 UTC)**이며, 1시간 후 jagreehal maintainer 계정으로 피벗해 50+ 패키지를 추가 오염. 핵심 기법 "Phantom Gyp" — 보안 도구가 거의 보지 않는 **157-byte `binding.gyp`에 페이로드 트리거를 숨겨 `npm install` 시 node-gyp가 자동 실행되게 한다**. **`--ignore-scripts`는 preinstall/postinstall 훅만 막을 뿐 node-gyp 실행 경로는 막지 못해 우회된다.** 페이로드는 npm/GitHub/AWS/GCP/Azure/Vault/K8s 자격증명을 수집·유출하고 GitHub Actions 워크플로를 주입해 지속성을 확보, self-propagate한다(npm/RubyGems 확산). **이 중 Cynapx 의존 트리에 포함된 것은 0건**(본 사이클 `npm ls` 직접 재대조: autotel/awaitly/executable-stories/node-env-resolver/wrangler-deploy/vapi-ai/redhat-cloud-services 7개 패키지 패밀리 전부 "not in tree"). Cynapx native 의존은 better-sqlite3 + tree-sitter 12 grammar뿐, 모두 무관 계열·악성 버전 미발행·clean 최신. **함의(L-2)**: Cynapx는 node-gyp 빌드 native 모듈을 13개(better-sqlite3 + tree-sitter core + 12 grammar) 사용하므로 이 기법의 표적 표면에 구조적으로 노출돼 있다 — 단 (a) CI가 `npm ci`(lockfile 고정)를 쓰고, (b) P14-1 audit 게이트가 있으며, (c) Dockerfile이 멀티스테이지로 빌드 산출물만 런타임에 복사한다는 점에서 1차 방어선은 존재. **즉각 코드 변경 불필요, 포스처 추적**: 의존 추가 시 binding.gyp 검토 + lockfile 무결성(`npm ci`만) 유지. 출처: [Snyk: Node-gyp Supply Chain Compromise](https://snyk.io/blog/node-gyp-supply-chain-compromise-self-propagating-npm-worm-binding-gyp/), [StepSecurity: Miasma](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm), [Chainguard: Miasma Phantom Gyp](https://www.chainguard.dev/unchained/chainguard-artifacts-safe-from-miasma-phantom-gyp-npm-attack)

### 6.4 MCP 생태계 — SDK v2 여전히 pre-alpha (v13 승계, 상태 불변)

- **MCP TypeScript SDK v2 = 여전히 pre-alpha**(직접 확인): v2 문서 사이트([ts.sdk.modelcontextprotocol.io/v2](https://ts.sdk.modelcontextprotocol.io/v2/))는 *"main 브랜치 = v2, 개발 중, pre-alpha"*·*"v1.x remains the recommended version for production use"*를 명시. **npm `latest`=1.29.0, 2.x 버전·dist-tag 미배포**(`npm view @modelcontextprotocol/sdk dist-tags` 직접 확인 — `{ latest: '1.29.0' }`, versions 목록 끝=1.29.0). v2 alpha 마일스톤(2026-03 예고)·beta(2026-05 예고)가 **npm 정식 배포로 이어지지 않았으며**, v2 stable은 여전히 **Q3 2026 예고**(2026-07-28 스펙 final 정렬), v1.x는 v2 출시 후 6개월+ 보안/버그픽스 유지. → **P15-3에서 이연한 stateless transport(`Mcp-Method`/`Mcp-Name` 라우팅, session-id 제거) + task extension(server-directed handle, `tasks/get`/`update`/`cancel`) 전면 마이그레이션은 여전히 착수 불가**(SDK가 아직 npm에 없음). P15-3의 `_progress.ts`/`tool-dispatcher.ts`/`ipc-coordinator.ts`/`api-server.ts` 추적 메모가 SDK v2 출시 시 출발점으로 유효. progress-token opt-in(P14-5)은 RC에서도 유지·폐기 대상 아님 → **현행 코드 정상**. 출처: [MCP TS SDK v2 docs](https://ts.sdk.modelcontextprotocol.io/v2/), `npm view @modelcontextprotocol/sdk dist-tags`
- **typescript-sdk#2042 여전히 open**: SDK 1.29.0 전이 취약점(ajv/fast-uri/hono/express-rate-limit) 추적 이슈가 진단 일자에도 미해결 → Cynapx `overrides`가 계속 정답. 출처: [typescript-sdk#2042](https://github.com/modelcontextprotocol/typescript-sdk/issues/2042)

### 6.5 경쟁/인접 도구 동향 (v13 승계 — 전략 추적, 코드 함의 없음)

- **로컬-퍼스트 코드 그래프 카테고리의 성숙 지속**: Serena(LSP-over-MCP)·CodeGraph·GitNexus 등이 심볼-레벨 표준의 사실상 기본값. Cynapx의 "100% 로컬·격리·멀티프로세스 보안 IPC" 포지션은 차별점이지만, 경쟁자 다수가 LSP/SCIP 정밀 심볼 해석을 채택 → Cynapx의 tree-sitter 휴리스틱 심볼 해석은 정밀도에서 LSP/SCIP에 뒤질 수 있음(차별화 축은 정밀도가 아니라 격리·보안·증분 동기화 견고성). **2026-06 공급망 사건(Miasma)은 오히려 Cynapx의 격리·lockfile-고정 포스처의 가치를 재확인**한다.
- **SCIP가 LSIF를 대체하는 심볼 인덱스 표준으로 정착** — Cynapx `export_graph`(json/graphml/dot)에 SCIP export 추가는 미래 상호운용 후보(전략 추적, Phase 17 범위 아님).
- **함의**: v11~v13과 동일하게 **기능 추가보다 (1) 공급망 위생 유지, (2) 생태계 스펙 추적(MCP SDK v2 — 여전히 대기), (3) 자원/안정성 위생(이미 마감)**이 신뢰성 차별화 축이다.

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 정밀 재열람에서 신규 결함이 없었다(전 영역 clean, 본 사이클 코드 변경 0):

- `src/server/ipc-coordinator.ts` — challenge-response 인증·라인 단위 1MB 바이트 제한·per-tool 타임아웃·keepalive(unref+clear)·pending reject-on-close 견고.
- `src/server/api-server.ts` — 세션 TTL/cap/sweep(unref), timing-safe Bearer, sessionId 마스킹, per-session transport 페어, rate-limit keyGenerator 고정 양호(L-3 stateless 충돌은 SDK v2까지 이연, P15-3 설계 메모 존치).
- `src/indexer/worker-pool.ts` — WeakMap taskMap·double-settle 가드·timeout→replaceWorker·setImmediate 재진입 방지·dispose 큐/타이머 정리 견고.
- `src/indexer/embedding-manager.ts` — A-7 request-id discipline·spawn error 핸들러·자동 재시작 지수 백오프·FTS5 폴백 강등·dispose SIGTERM→SIGKILL 에스컬레이션 + M-2(P15-1) 배치 타이머 clear/unref 위생 양호.
- `src/indexer/cross-project-resolver.ts` — P14-2 indexed probe + 원격 DB sanity·1회 경고·핸들/캐시 무효화 건전.
- `src/graph/graph-engine.ts` — P14-4 Fisher-Yates + seeded PRNG 결정성 + M-4(P15-1) count-first 가드(COUNT(*) probe → getAllNodes 풀로드 이전 short-circuit) 양호(L-5 본격 파티셔닝만 이연).
- `src/server/tools/_progress.ts`·`tool-dispatcher.ts` — progress token opt-in·NOOP 폴백·sender 오류 swallow·payload 불변 + P15-3 2026-07-28 RC 표적 주석 양호.
- `src/indexer/yaml-parser.ts` — P14-3 js-yaml 트리 파싱 + graceful 강등·라인 번호 캡처·reusable `uses` 에지 양호.
- `src/utils/lock-manager.ts` — atomic write/heartbeat staleness/nonce 자기 일치 release 검증.
- `package.json` overrides — tree-sitter 단일 top-level `^0.25.0`(P15-2 일관화, 12 grammar dedupe)·**fast-uri `^3.1.2`(P16-1, CVE-2026-6322 패치 floor 못 박음)**·qs `^6.15.2`·hono `^4.12.21` 전부 패치/최신 floor 충족.
- `.github/workflows/ci.yml` — Node 22/24 매트릭스 + `npm audit --omit=dev --audit-level=high` 게이트(P14-1) + `npm ci`(lockfile 고정) 양호(Miasma 1차 방어선). (cynapx-autonomous.yml은 본 진단 범위 외 — 미변경.)

---

## 8. 권장 수정 순서 (Phase 17 제안 — 상세는 phase17-plan.md)

**16개 페이즈 이후 코드베이스는 steady state(유지보수 모드)를 유지한다 — 이번 사이클에는 코드 변경이 필요한 항목이 0건이다.** CRITICAL/HIGH/MEDIUM 0, LOW 5(전부 추적/이연, v13 승계, 신규 0). 신규 CVE 중 Cynapx 도달 가능 0건, 새로운 코드 결함 0건. 따라서 Phase 17은 **단일 docs-only 서브 페이즈(추적 상태 갱신 + 유지보수 포스처 재확인)**가 합리적이며, 이는 패딩이 아니라 프로젝트 성숙도의 정직한 반영이다.

1. **P17-1**: 추적/이연 항목(L-2 Miasma 공급망 포스처, L-3 MCP SDK v2 대기, L-6 Node 24 빌드)의 현 상태를 다음 사이클 출발점으로 고정 + 유지보수 모드 포스처 재선언. **docs-only, 코드 동작 무변경.**
2. **유지보수 모드 포스처**: 정기 의존성-업데이트/audit 점검 + MCP SDK v2 npm 배포 모니터링(배포 시 L-3 stateless/task 마이그레이션이 비로소 actionable) + Miasma류 install-time 공급망 위생(lockfile `npm ci` 고정, 의존 추가 시 binding.gyp 검토).

(L-4 IPC MessagePack 계속 보류, L-5 클러스터링 본격 파티셔닝 계속 이연, MCP 전면 task lifecycle/stateless transport는 SDK v2 stable까지 이연 — SDK가 아직 npm에 없어 착수 불가.)
