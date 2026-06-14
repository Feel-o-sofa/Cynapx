# Cynapx 정밀 진단 보고서 v13

- **기준 커밋**: `758d466` (Phase 15-3 + Phase 15 완료, 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-14
- **진단 범위**: src/ 전체 (server, db, indexer, graph, watcher, utils, cli, bootstrap), schema/, scripts/, tests/, src-native/, Dockerfile, `.github/workflows/ci.yml`, package.json/lockfile + 외부 컨텍스트(CVE/advisory, 공급망 캠페인, MCP 생태계, 경쟁 도구)
- **진단 방법**: 단일 에이전트 순차 전수 코드 리뷰 + 로컬 검증(`npx vitest run` 직접 실행, `npm audit --omit=dev` 직접 실행, `npm ls`로 전이 의존 버전 확인, `npm view`로 registry `latest`/버전 목록 확인, 번들 SQLite 버전 확인) + 웹 검색·페치 기반 외부 조사
- **현재 상태(직접 검증)**: Phase 15 종료 시점 — `npx vitest run` **563/563**(43 파일), `npx tsc --noEmit` 그린, `npm audit --omit=dev` **0 vulnerabilities**(info/low/moderate/high/critical 전부 0 — 직접 실행), `npm run build && node scripts/integration-test.js` 76/76(75 pass + 1 Docker SKIP). diagnostic-v12 전 항목 [DONE].

> **요약**: **15개 페이즈·~31 커밋의 하드닝 이후 코드·공급망 양쪽 모두 CRITICAL/HIGH 신규 결함은 0이다.** diagnostic-v12에서 식별한 MEDIUM 4건(M-1~M-4)·LOW 6건은 Phase 15-1~15-3에서 전부 처리됐고(임베딩 배치 타이머 위생, 클러스터링 count-first 가드, tree-sitter override 일관화, MCP 2026-07-28 추적 메모), 진단 일자 기준 `npm audit --omit=dev` = **0 vulnerabilities**가 유지된다. **이번 사이클의 본질적 신호는 두 가지 생태계 사건이고, 둘 다 즉시 코드 변경을 요구하지 않는다**: (1) **MCP TypeScript SDK v2가 여전히 pre-alpha**(npm `latest`=1.29.0, v2.x 미배포 — `npm view`로 직접 확인)라 P15-3에서 이연한 stateless transport / task extension 전면 마이그레이션은 **계속 이연**이 맞다(아직 착수 불가). (2) **2026-06-03 npm 공급망 캠페인 "Miasma / Phantom Gyp"**(binding.gyp로 `--ignore-scripts`를 우회하는 install-time 웜)가 native 모듈 생태계를 강타했으나, 컴프로마이즈된 57개 패키지(autotel/awaitly/executable-stories/node-env-resolver/wrangler-deploy/vapi-ai 계열)는 **Cynapx 의존성에 하나도 포함되지 않으며**, Cynapx의 native 의존(better-sqlite3 12.10.0 + tree-sitter 12개 grammar)은 전부 clean 라인이다 — 단 Cynapx가 node-gyp 빌드 native 모듈을 다수 쓰는 만큼 **이 기법은 공급망 위생 포스처 추적 대상**이다. 나머지는 소수의 신규 CVE(fast-uri **CVE-2026-6322** host confusion — Cynapx는 이미 패치 라인 3.1.2지만 override 선언 floor가 `^3.1.1`이라 명시성 갭)와 이전에 명시적으로 이연된 항목들(O-5 클러스터링 파티셔닝, O-3 IPC MessagePack, A-4(2) IPC progress relay, Node 24 tree-sitter 빌드 fragility)이다. **CRITICAL 0, HIGH 0, MEDIUM 1, LOW 5.** 15 페이즈 이후 코드베이스는 **steady state(유지보수 모드)에 도달**했다.

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건(C-1 Docker 배포 전손, C-2 사이드카 spawn 크래시, C-3 IPC 인증 무력화)은 Phase 13에서, v11의 HIGH 1건(N-1 공급망)은 Phase 14-1에서, v12의 MEDIUM 4건은 Phase 15에서 해소됐고, 전수 재열람에서 새로운 CRITICAL/HIGH는 발견되지 않았다. IPC 핸드셰이크(`src/server/ipc-coordinator.ts`)는 random challenge + `HMAC-SHA256(nonce, challenge)` + `timingSafeEqual`로 견고하고, API Bearer는 SHA-256 후 `timingSafeEqual`(`api-server.ts`), 세션 맵은 TTL+cap+sweep(unref)로 보호된다.

---

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** 코드·공급망 어디에서도 신규 HIGH는 발견되지 않았다. `npm audit --omit=dev` = 0 vulnerabilities(직접 재검증, 6.1 참조). 발견 부풀리기를 피하기 위해 명시한다 — 본 사이클에서 HIGH 등급으로 올릴 만한 결함은 없다. 외부 공급망 사건(Miasma, 6.3)도 Cynapx 의존 트리에 도달하지 않으므로 HIGH가 아니라 LOW(포스처 추적, L-2)로 다룬다.

---

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

### M-1(v13). fast-uri override 선언 floor(`^3.1.1`)가 CVE-2026-6322(host confusion) 패치 버전(3.1.2)보다 낮음 — lockfile은 3.1.2지만 floor 명시성 갭
**`package.json:69-74` (`overrides.fast-uri: "^3.1.1"`), 잠재 라우트: `src/server/api-server.ts`(SDK transport import)**

진단 일자 신규 advisory **CVE-2026-6322**(fast-uri host confusion via percent-encoded authority delimiters: `http://trusted.com%40evil.com/`이 정규화 시 host=`evil.com`/userinfo=`trusted.com`으로 재해석 → 도메인 검증 우회)는 **fast-uri ≤ 3.1.1 영향, 3.1.2에서 패치**(출처 직접 확인: GHSA-v39h-62p7-jpjc / CVE-2026-6322, CVSS 3.1 LOW-MEDIUM, CWE-436 Interpretation Conflict). Phase 14-1에서 추가한 fast-uri 관련 advisory(CVE-2026-6321 path traversal, ≤3.1.0 영향)는 floor `^3.1.1`로 충분했지만, **그 후 CVE-2026-6322가 3.1.1까지 영향 범위를 넓혔다.**

현재 상태(직접 확인):
- **lockfile은 이미 `fast-uri@3.1.2`로 핀**(`package-lock.json` `node_modules/fast-uri` version=3.1.2, `npm ls fast-uri`=`3.1.2 overridden`) → **실제 설치본은 CVE-2026-6322 패치 라인이고 `npm audit --omit=dev`도 0 vulnerabilities**(audit가 6322를 잡지 못하는 게 아니라 설치본이 이미 패치 버전이라 잡을 게 없음).
- 다만 **`overrides` 선언 floor가 `^3.1.1`**이라, lockfile을 새로 푸는 환경(`npm install` 재해석, lockfile 삭제 후 재생성, override만 보고 판단하는 SCA 도구)에서는 `^3.1.1`이 **이론상 3.1.1을 허용**한다. `^3.1.1`은 3.1.2도 만족하므로 npm은 registry 최신(3.1.2)을 선택하지만, 선언적 floor가 패치 버전보다 낮은 것은 **공급망 위생 관점에서 명시성 갭**이다(P14-1이 fast-uri를 override로 못 박은 의도와 약하게 어긋남).

**판정**: 코드 결함이 아니고 실제 설치본은 이미 안전하므로 **LOW 경계의 MEDIUM 하단**이다 — 단일 한 글자 변경(`^3.1.1` → `^3.1.2`)으로 선언적 floor를 CVE-2026-6322 패치에 못 박아 "override floor ≥ 알려진 패치 버전" 불변을 복원한다. qs(`^6.15.2`)·hono(`^4.12.21`)·tree-sitter(`^0.25.0`) floor는 각자 패치/최신을 이미 만족하므로 변경 불필요(확인). **테스트**: `npm ls fast-uri`가 `3.1.2`(또는 이상)인지, override 변경 후 `npm audit --omit=dev` **0 vulnerabilities 유지**, `tests/api-server-http.test.ts`·`tests/mcp-server.test.ts` transport 회귀 그린.

---

## 4. 최적화 (LOW)

| # | 위치 | 내용 |
|---|------|------|
| L-1(v13) | `package.json` overrides | M-1(fast-uri floor `^3.1.1`→`^3.1.2`)을 LOW로도 추적 가능 — 실설치본 이미 3.1.2라 위험 0, 선언 명시성만 보강. M-1에서 처리하면 본 항목 흡수 |
| L-2(v13) | `package.json` (native deps), CI / Dockerfile | **Miasma / Phantom Gyp 공급망 캠페인(2026-06-03) 포스처 추적.** binding.gyp가 `--ignore-scripts`를 우회해 node-gyp 빌드 시점에 임의 코드를 실행하는 install-time 웜. 컴프로마이즈 57개 패키지(autotel/awaitly/executable-stories/node-env-resolver/wrangler-deploy/vapi-ai 계열)는 **Cynapx 의존 트리에 0건**(직접 대조), Cynapx native 의존(better-sqlite3 12.10.0 = clean 최신, tree-sitter 12 grammar)도 전부 clean. **즉각 조치 불필요** — CI가 `npm ci`(lockfile 고정 install)를 쓰고 audit 게이트(P14-1)가 있으므로 1차 방어선은 있다. 추적 항목: (a) lockfile 무결성(`npm ci`만 사용, `npm install` 금지)·(b) 의존 추가 시 binding.gyp 검토·(c) audit 게이트 유지. **verdict: 추적만**(6.3 상세) |
| L-3(v13) | `src/server/api-server.ts` (session-id StreamableHTTP) | MCP stateless transport(2026-07-28 RC) 충돌 표면 — SDK v2 업그레이드 시 회귀 표면. SDK v2 **여전히 pre-alpha**(npm `latest`=1.29.0, v2.x 미배포 직접 확인) → **계속 이연**, P15-3의 `handleMcp()` 설계 메모가 출발점 |
| L-4(v13) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환(v8→v13 이월). **성능 문제 미관측, verdict: 계속 보류.** 메시지가 작고(주로 메타데이터) round-trip이 드물어 직렬화가 병목 아님. 기록만 유지 |
| L-5(v13) | `src/graph/graph-engine.ts` | 클러스터링 본격 서브그래프 파티셔닝(O-5) — 100k+ 노드 실측 시 재검토(**verdict: 계속 이연**). M-4(v12)의 count-first 가드가 OOM 1차 방어 |
| L-6(v13) | CI / Dockerfile | Node 24 + tree-sitter 0.25.x 빌드 fragility(C++20/prebuild 부재) — 상류 이슈 [node-tree-sitter#268]가 **진단 일자 여전히 open**(직접 확인). CI `build-and-test`가 Node 22/24 매트릭스에서 `npm test`를 돌리고 **현재 그린**이나, Node 24 LTS 전환 전 prebuild 가용성 재확인 필요. **추적만**(O-6 v12 승계) |

---

## 5. 테스트 공백

Phase 15 종료 시 563 테스트(43 파일, 통합 76 케이스)로 회귀 안전망이 매우 두텁다. 본 사이클의 신규/잔존 공백은 사실상 없다(코드 변경 항목이 M-1 override floor 1건뿐이고 그조차 동작 무변경):

| 공백 | 검증해야 할 시나리오 | 관련 항목 | 우선순위 |
|------|---------------------|-----------|----------|
| **override floor 회귀(있다면)** | M-1 적용 후 `npm ls fast-uri` ≥ 3.1.2 + `npm audit --omit=dev` 0 vulns + transport 회귀(`api-server-http`·`mcp-server`) 그린 | M-1 | 낮음(메타데이터, 동작 무변경) |

기존 스위트(`tests/`)는 lock 경합·IPC e2e+인증·REST HTTP·비-TS 메트릭·git 이력 재작성·purge 재초기화·임베딩 프로토콜(A-7 request-id discipline + M-2 배치 타이머 위생)·CrossProjectResolver 멀티프로젝트(P14-2)·클러스터링 결정성+count-first 가드(P14-4 + M-4)·MCP progress(P14-5)·YAML 견고성(P14-3)을 이미 커버한다 — **신규 테스트가 필요한 결함이 없다.**

---

## 6. 외부 컨텍스트 (웹 조사 — 출처 명시)

### 6.1 의존성 취약점 (진단 일자 직접 재검증 — 전부 clean)

`npm audit --omit=dev --json` + `npm ls` + `npm view`로 직접 재확인했다:

- **`npm audit --omit=dev` = 0 vulnerabilities** (info/low/moderate/high/critical 전부 0 — 직접 실행). Phase 14-1 baseline 유지.
- **fast-uri**: `overrides`로 설치본 `3.1.2`(`npm ls fast-uri`·lockfile 직접 확인). **CVE-2026-6321**(path traversal, ≤3.1.0)·**CVE-2026-6322**(host confusion, ≤3.1.1) 모두 **3.1.2에서 패치** → 설치본 무관. **단 override 선언 floor가 `^3.1.1`이라 6322 패치보다 낮음**(M-1로 명시성 보강 권고). SDK `@modelcontextprotocol/sdk@1.29.0`가 여전히 ajv→fast-uri를 끌어오나 override가 dedupe. 출처: [GHSA-v39h-62p7-jpjc / CVE-2026-6322](https://github.com/advisories/GHSA-v39h-62p7-jpjc), [GitLab advisory CVE-2026-6322](https://advisories.gitlab.com/npm/fast-uri/CVE-2026-6322/)
- **`@modelcontextprotocol/sdk`**: npm `latest`=**1.29.0**(직접 `npm view` 확인, 1.30/2.x 미배포). 상류 이슈 [typescript-sdk#2042](https://github.com/modelcontextprotocol/typescript-sdk/issues/2042)("Transitive dependencies with known vulnerabilities in 1.29.0", 2026-05-11 보고)는 **진단 일자 여전히 open** — 상류 패치 미반영이라 Cynapx의 `overrides`(fast-uri/qs/hono)가 계속 유효한 해법. 출처: 위 이슈, npm registry.
- **express-rate-limit 8.5.2** → **ip-address 10.2.0**(`npm ls` 확인): ip-address XSS·CVE-2026-30827(IPv4-mapped IPv6 rate-limit bypass) 패치 라인. Cynapx는 `keyGenerator`를 `req.socket.remoteAddress`로 고정(`api-server.ts`)해 bypass를 이중 우회. clean.
- **qs `^6.15.2`**: comma-format array stringify DoS 패치. express@4/SDK express@5/superagent 경유 전부 dedupe. clean.
- **js-yaml 4.2.0**(직접 확인): CVE-2025-64718(proto pollution, <4.1.1 영향)는 4.2.0이 패치 라인 이상이라 무관. CVE-2026-33532(deeply-nested flow sequence stack overflow DoS)는 **`yaml`(eemeli/yaml) 라이브러리 대상이지 `js-yaml`(nodeca)이 아니다** — Cynapx는 `js-yaml`만 쓰고 `yaml`을 쓰지 않으므로 무관. 출처: [CVE-2026-33532](https://www.sentinelone.com/vulnerability-database/cve-2026-33532/)
- **better-sqlite3 12.10.0 / SQLite 3.53.1**: 로컬 `sqlite_version()`=**3.53.1** 직접 확인. CVE-2025-7709(FTS5 integer overflow, 3.51.3 패치)·CVE-2025-70873(zipfile heap disclosure)·CVE-2025-6965(<3.50.2)는 모두 3.53.1에서 비해당/패치. **Miasma 캠페인에서 better-sqlite3는 직접 컴프로마이즈된 게 아니라(악성 버전 미발행), node-gyp을 쓰는 native 패키지 목록에 거론된 것** — 12.10.0이 clean 최신(6.3 상세). clean. 출처: [SQLite security](https://stack.watch/product/sqlite/sqlite/), [better-sqlite3 Snyk](https://security.snyk.io/package/npm/better-sqlite3)
- **sqlite-vec 0.1.9 / swagger-ui-express 5 / commander 14 / chokidar 5 / simple-git / ignore 7 / zod 4 / express 4.22.x**: 미해결 공개 취약점 미발견(express@4.22.1은 qs override로 알려진 전이 취약점 해소).

### 6.2 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"` + Docker `node:22-bookworm-slim`. Node 22 LTS 유지보수 2027-04 종료 — 여유. CI `build-and-test`가 Node 22/24 매트릭스에서 `npm test`를 돌린다(563/563 그린). Node 24 + tree-sitter 0.25.x는 상류에서 C++20/prebuild 부재 빌드 실패가 보고됐으나([node-tree-sitter#268], 진단 일자 여전히 open) Cynapx CI는 현재 통과 — prebuild 가용성 의존 fragility(L-6). 출처: [node-tree-sitter#268](https://github.com/tree-sitter/node-tree-sitter/issues/268)
- **tree-sitter 코어**: npm `latest`=**0.25.0**(직접 확인). 비-npm 배포(Slackware 등)에 0.26.x 빌드가 거론되나 npm registry `latest`는 0.25.0 — 코어 변경 여지 없음(P15-2에서 0.25.1 미존재 확인한 것과 일관). **tree-sitter-c-sharp**: npm 최신 여전히 **0.23.5**(0.23.6 미배포 직접 확인) — P15-2의 `ERR_REQUIRE_ASYNC_MODULE`(ESM/TLA 바인딩) 회귀를 해소하는 **신규 버전 없음** → **0.23.1 정확 핀 롤백 유지가 여전히 옳다**. 출처: `npm view tree-sitter-c-sharp versions`, [node-tree-sitter](https://www.npmjs.com/package/tree-sitter)

### 6.3 공급망 캠페인 — **본 사이클 핵심 외부 신호 ①**

- **Miasma / Phantom Gyp(2026-06-03 npm 공급망 웜)**: 2시간 내 **57개 패키지·286+ 악성 버전**을 컴프로마이즈한 자기증식 웜. 핵심 기법 "Phantom Gyp" — 보안 도구가 거의 보지 않는 **`binding.gyp`에 페이로드 트리거를 숨겨 `npm install` 시 node-gyp가 자동 실행되게 한다**. **`--ignore-scripts`는 preinstall/postinstall 훅만 막을 뿐 node-gyp 실행 경로는 막지 못해 우회된다.** 페이로드는 npm/GitHub/AWS/GCP/Azure/Vault/K8s 자격증명을 수집·유출하고 GitHub Actions 워크플로를 주입해 지속성을 확보, 도달 가능한 maintainer 계정에서 재발행하며 self-propagate한다. 컴프로마이즈된 패키지 계열: **autotel / awaitly / executable-stories / node-env-resolver / wrangler-deploy / @vapi-ai/server-sdk**(첫 표적, 0.11.1/0.11.2/1.2.1/1.2.2). **이 중 Cynapx 의존 트리에 포함된 것은 0건**(직접 대조: Cynapx native 의존은 better-sqlite3 + tree-sitter 12 grammar뿐, 모두 무관 계열). better-sqlite3는 "node-gyp을 쓰는 native 패키지"로 거론됐을 뿐 악성 버전이 발행되지 않았고 **12.10.0이 clean 최신**. **함의(L-2)**: Cynapx는 node-gyp 빌드 native 모듈을 13개(better-sqlite3 + tree-sitter core + 12 grammar) 사용하므로 이 기법의 표적 표면에 구조적으로 노출돼 있다 — 단 (a) CI가 `npm ci`(lockfile 고정)를 쓰고, (b) P14-1 audit 게이트가 있으며, (c) Dockerfile이 멀티스테이지로 빌드 산출물만 런타임에 복사한다는 점에서 1차 방어선은 존재. **즉각 코드 변경 불필요, 포스처 추적**: 의존 추가 시 binding.gyp 검토 + lockfile 무결성(`npm ci`만) 유지. 출처: [Snyk: Node-gyp Supply Chain Compromise June 2026](https://security.snyk.io/node-gyp-supply-chain-compromise-june-2026), [StepSecurity: Miasma](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm), [Chainguard: Miasma Phantom Gyp](https://www.chainguard.dev/unchained/chainguard-artifacts-safe-from-miasma-phantom-gyp-npm-attack)

### 6.4 MCP 생태계 — **본 사이클 핵심 외부 신호 ②**

- **MCP TypeScript SDK v2 = 여전히 pre-alpha**(직접 확인): v2 문서 사이트([ts.sdk.modelcontextprotocol.io/v2](https://ts.sdk.modelcontextprotocol.io/v2/))는 *"main 브랜치 = v2, 개발 중, pre-alpha, 프로덕션 비권장"*을 명시. **npm `latest`=1.29.0, 2.x 버전·dist-tag 미배포**(`npm view @modelcontextprotocol/sdk dist-tags`/`versions` 직접 확인 — 최신은 1.29.0). v2 stable은 **Q3 2026 예고**(2026-07-28 스펙 final 정렬), v1.x는 v2 출시 후 6개월+ 보안/버그픽스 유지. → **P15-3에서 이연한 stateless transport(`Mcp-Method`/`Mcp-Name` 라우팅, session-id 제거) + task extension(server-directed handle, `tasks/get`/`update`/`cancel`) 전면 마이그레이션은 여전히 착수 불가**(SDK가 아직 없음). P15-3의 `_progress.ts`/`tool-dispatcher.ts`/`ipc-coordinator.ts`/`api-server.ts` 추적 메모가 SDK v2 출시 시 출발점으로 유효. progress-token opt-in(P14-5)은 RC에서도 유지·폐기 대상 아님(P15-3 확인) → **현행 코드 정상**. 출처: [MCP TS SDK v2 docs](https://ts.sdk.modelcontextprotocol.io/v2/), `npm view @modelcontextprotocol/sdk`
- **typescript-sdk#2042 여전히 open**: SDK 1.29.0 전이 취약점(ajv/fast-uri/hono/express-rate-limit) 추적 이슈가 진단 일자에도 미해결 → Cynapx `overrides`가 계속 정답. 출처: [typescript-sdk#2042](https://github.com/modelcontextprotocol/typescript-sdk/issues/2042)

### 6.5 경쟁/인접 도구 동향

- **로컬-퍼스트 코드 그래프 카테고리의 성숙 지속**: Serena(LSP-over-MCP)·CodeGraph·GitNexus 등이 심볼-레벨 표준의 사실상 기본값. Cynapx의 "100% 로컬·격리·멀티프로세스 보안 IPC" 포지션은 차별점이지만, 경쟁자 다수가 LSP/SCIP 정밀 심볼 해석을 채택 → Cynapx의 tree-sitter 휴리스틱 심볼 해석은 정밀도에서 LSP/SCIP에 뒤질 수 있음(차별화 축은 정밀도가 아니라 격리·보안·증분 동기화 견고성). **2026-06 공급망 사건(Miasma)은 오히려 Cynapx의 격리·lockfile-고정 포스처의 가치를 재확인**한다. 출처: diagnostic-v12 6.4 승계.
- **SCIP가 LSIF를 대체하는 심볼 인덱스 표준으로 정착** — Cynapx `export_graph`(json/graphml/dot)에 SCIP export 추가는 미래 상호운용 후보(전략 추적, Phase 16 범위 아님). 출처: diagnostic-v12 6.4 승계.
- **함의**: v11·v12와 동일하게 **기능 추가보다 (1) 공급망 위생 유지(이번엔 Miasma 포스처 + fast-uri floor), (2) 생태계 스펙 추적(MCP SDK v2 — 여전히 대기), (3) 자원/안정성 위생(이미 마감)**이 신뢰성 차별화 축이다.

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 정밀 재열람에서 신규 결함이 없었다:

- `src/server/ipc-coordinator.ts` — challenge-response 인증·라인 단위 1MB 바이트 제한·per-tool 타임아웃·keepalive(unref+clear)·pending reject-on-close 견고.
- `src/server/api-server.ts` — 세션 TTL/cap/sweep(unref), timing-safe Bearer, sessionId 마스킹, per-session transport 페어(CVE-2026-25536 무관), rate-limit keyGenerator 고정 양호(L-3 stateless 충돌은 SDK v2까지 이연).
- `src/indexer/worker-pool.ts` — WeakMap taskMap·double-settle 가드·timeout→replaceWorker·setImmediate 재진입 방지·dispose 큐/타이머 정리 견고.
- `src/indexer/embedding-manager.ts` — A-7 request-id discipline·spawn error 핸들러·자동 재시작 지수 백오프·FTS5 폴백 강등·dispose SIGTERM→SIGKILL 에스컬레이션 + **M-2(P15-1) 배치 타이머 clear/unref 위생 마감** 양호.
- `src/indexer/cross-project-resolver.ts` — P14-2 indexed probe + 원격 DB sanity·1회 경고·핸들/캐시 무효화 건전.
- `src/graph/graph-engine.ts` — P14-4 Fisher-Yates + seeded PRNG 결정성 + **M-4(P15-1) count-first 가드(COUNT(*) probe → getAllNodes 풀로드 이전 short-circuit)** 양호(L-5 본격 파티셔닝만 이연).
- `src/server/tools/_progress.ts`·`tool-dispatcher.ts` — progress token opt-in·NOOP 폴백·sender 오류 swallow·payload 불변 + P15-3 2026-07-28 RC 표적 주석 양호.
- `src/indexer/yaml-parser.ts` — P14-3 js-yaml 트리 파싱 + graceful 강등·라인 번호 캡처·reusable `uses` 에지 양호.
- `src/utils/lock-manager.ts` — atomic write/heartbeat staleness/nonce 자기 일치 release 검증.
- `package.json` overrides — tree-sitter 단일 top-level `^0.25.0`(P15-2 일관화, 12 grammar dedupe)·qs `^6.15.2`·hono `^4.12.21` 양호(**fast-uri floor만 M-1로 6322 패치에 못 박을 여지**).
- `.github/workflows/ci.yml` — Node 22/24 매트릭스 + `npm audit --omit=dev --audit-level=high` 게이트(P14-1) + `npm ci`(lockfile 고정) 양호(Miasma 1차 방어선). (cynapx-autonomous.yml은 본 진단 범위 외 — 미변경.)

---

## 8. 권장 수정 순서 (Phase 16 제안 — 상세는 phase16-plan.md)

**15개 페이즈 이후 코드베이스는 steady state(유지보수 모드)에 도달했다.** CRITICAL/HIGH 0, 코드 변경이 필요한 항목은 **M-1(fast-uri override floor, 한 글자, 동작 무변경) 1건뿐**이다. 나머지는 전부 추적/이연 항목이다. 따라서 Phase 16은 **단일 소형 서브 페이즈 + 유지보수 포스처 확립**이 합리적이다.

1. **P16-1**: M-1 fast-uri override floor `^3.1.1`→`^3.1.2`로 못 박기 + Miasma(L-2)·SDK v2(L-3)·Node 24 빌드(L-6) 추적 상태 갱신. (공급망 위생 명시성 복원, 동작 무변경·저위험.)
2. **유지보수 모드 포스처**: 정기 의존성-업데이트/audit 점검 + MCP SDK v2 출시 모니터링(출시 시 L-3 stateless/task 마이그레이션이 비로소 actionable) + Miasma류 install-time 공급망 위생(lockfile `npm ci` 고정, 의존 추가 시 binding.gyp 검토).

(O-3 IPC MessagePack 계속 보류, O-5 클러스터링 본격 파티셔닝 계속 이연, MCP 전면 task lifecycle/stateless transport는 SDK v2 stable까지 이연 — SDK가 아직 pre-alpha라 착수 불가.)
