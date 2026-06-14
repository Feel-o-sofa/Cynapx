# Cynapx 정밀 진단 보고서 v12

- **기준 커밋**: `73aa58d` (Phase 14-5 + Phase 14 완료, 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-14
- **진단 범위**: src/ 전체 (server, db, indexer, graph, watcher, utils, bootstrap), schema/, scripts/, tests/, src-native/, Dockerfile, `.github/workflows/ci.yml`, package.json/lockfile + 외부 컨텍스트(CVE/advisory, MCP 생태계, 경쟁 도구)
- **진단 방법**: 단일 에이전트 순차 전수 코드 리뷰 + 로컬 검증(`npx tsc --noEmit` 그린, `npm audit --omit=dev --json` 직접 실행, `npm ls`로 전이 의존 버전 확인, 번들 SQLite 버전 확인) + 웹 검색 기반 외부 조사
- **현재 상태(직접 검증)**: Phase 14 종료 시점 — `npx vitest run` **558/558**(43 파일), `npx tsc --noEmit` 그린, `npm audit --omit=dev` **0 vulnerabilities**(info/low/moderate/high/critical 전부 0), `npm run build && node scripts/integration-test.js` 76/76(75 pass + 1 Docker SKIP). diagnostic-v11 전 항목 [DONE].

> **요약**: **14개 페이즈·~28 커밋의 하드닝 이후 코드·공급망 양쪽 모두 CRITICAL/HIGH 신규 결함은 0이다.** diagnostic-v11의 최상위 항목이었던 공급망 취약점(fast-uri HIGH 등)은 Phase 14-1의 `overrides` + `express-rate-limit` 8.5.x 업그레이드로 완전히 해소됐고(직접 재검증: `npm audit --omit=dev` = 0 vulnerabilities, `js-yaml@4.2.0`·`ip-address@10.2.0`·`qs@6.15.x`·`fast-uri@3.1.2` 모두 패치 라인), 진단 일자 기준 신규 CVE 중 Cynapx에 **도달 가능한 것은 발견되지 않았다**. **이번 사이클의 본질적 신호는 코드 결함이 아니라 생태계 변화다**: MCP **2026-07-28 스펙 RC**(2026-05-21 lock)가 (1) Phase 14-5에서 Cynapx가 채택한 **task/progress 워크플로(SEP-1686)를 core에서 extension으로 강등**하고, (2) `initialize`/`Mcp-Session-Id` 핸드셰이크를 제거하는 **stateless transport**로 전환한다 — 이는 Cynapx의 현재 session-id 기반 StreamableHTTP 구조(`api-server.ts:342-384`)와 P14-5의 progress 배선에 **직접적인 마이그레이션 함의**가 있다(즉시 대응 불필요, RC라 추적·계획 대상). 나머지는 이전에 명시적으로 보류된 항목들(O-3 IPC MessagePack, O-5 클러스터링 파티셔닝, A-4(2) IPC progress relay)과 소수의 신규 MEDIUM/LOW(타이머/리소스 위생, Node 24 tree-sitter 빌드 취약성, tree-sitter grammar 버전 드리프트)다. **CRITICAL 0, HIGH 0, MEDIUM 4, LOW 6.**

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건(C-1 Docker 배포 전손, C-2 사이드카 spawn 크래시, C-3 IPC 인증 무력화)은 Phase 13에서, v11의 HIGH 1건(N-1 공급망)은 Phase 14-1에서 해소됐고, 전수 재열람에서 새로운 CRITICAL/HIGH는 발견되지 않았다. IPC 핸드셰이크(`ipc-coordinator.ts:166-209`)는 random challenge + `HMAC-SHA256(nonce, challenge)` + `timingSafeEqual`로 견고하고, API Bearer는 SHA-256 후 `timingSafeEqual`(`api-server.ts:64-68`), 세션 맵은 TTL+cap+sweep로 보호된다.

---

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** diagnostic-v11의 유일한 HIGH였던 N-1(공급망)은 Phase 14-1에서 완전 해소됐고(아래 6.1에서 직접 재검증), 신규 HIGH는 코드·공급망 어디에서도 발견되지 않았다. 발견 부풀리기를 피하기 위해 명시한다 — 본 사이클에서 HIGH 등급으로 올릴 만한 결함은 없다.

> **단, MEDIUM의 M-1(MCP 2026-07-28 stateless/task extension 전환)은 "현 코드 결함"은 아니지만 생태계 방향 전환이라는 점에서 본 사이클 최상위 추적 항목이다.** 아래 3장 첫 항목으로 다룬다.

---

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

### M-1(v12). MCP 2026-07-28 RC가 task/progress를 extension으로 강등 + stateless transport 전환 — P14-5 배선과 session-id 구조에 마이그레이션 함의
**`src/server/tool-dispatcher.ts:208-220`, `src/server/tools/_progress.ts`, `src/server/api-server.ts:342-384`(session-id 기반 StreamableHTTP)**

P14-5에서 Cynapx는 MCP 2025-11-25 stable의 흐름에 맞춰 `notifications/progress`(progress token opt-in)를 4개 장기 도구에 배선했다. 그런데 **2026-07-28 스펙 RC(2026-05-21 lock, 2026-07-28 최종 예정)**가 두 가지 방향 전환을 확정했다:

1. **Tasks(SEP-1686)가 core spec → extension으로 강등.** 공식 블로그(2026-07-28 RC): *"Production use surfaced enough redesign that the right home for it is an extension rather than the specification."* task 생성은 **server-directed**(서버가 `tools/call` 응답으로 task handle 반환), 클라이언트가 `tasks/get`/`tasks/update`/`tasks/cancel`로 진행을 구동, `tasks/list`는 세션 부재로 제거. → **2025-11-25의 experimental Tasks API를 쓰던 코드는 마이그레이션 필요한 breaking change.** Cynapx는 task lifecycle을 채택하지 **않고** progress 송신만 했으므로 *현재 깨지는 코드는 없다* — 하지만 향후 task lifecycle 전면 채택(diagnostic-v11에서 후속 후보로 명시)을 한다면 **2025-11-25판이 아니라 2026-07-28 extension 모델을 기준으로 설계해야 한다**(설계 표적이 바뀌었다).

2. **Stateless transport: `initialize`/`initialized` 핸드셰이크 + `Mcp-Session-Id` 헤더 제거**, 대신 `Mcp-Method`/`Mcp-Name` 라우팅 헤더 + 모든 요청 `_meta`에 client info. Cynapx의 `handleMcp()`(`api-server.ts:342-384`)는 `mcp-session-id`/`sessionId` 기반 세션 맵·재접속(SEC-H-1)에 의존한다. SDK 1.x(현재 1.29.0, 최신)는 여전히 session-id 모델이고 stateless RC는 **SDK 1.x에 아직 반영되지 않았으며**(npm `latest`=1.29.0 직접 확인, v2 stable은 Q3 2026 예고), 따라서 **즉시 대응 불필요**. 단 SDK v2 + 2026-07-28 final이 나오면 transport 계층 재설계가 따라온다.

**판정**: **추적 + 1차 설계 메모만.** 코드 결함이 아니며 RC라 미확정이다. Phase 15에서 할 일은 (a) `_progress.ts`/`tool-dispatcher.ts`/`ipc-coordinator.ts`의 "future direction" 주석을 **2025-11-25판 SEP-1686이 아니라 2026-07-28 extension 모델**을 가리키도록 갱신, (b) `api-server.ts`의 session-id 구조가 stateless RC와 충돌하는 지점(핸드셰이크 의존·`Mcp-Session-Id`)을 짧게 문서화해 SDK v2 업그레이드 시 회귀 표면을 미리 잡아두는 것. **전면 마이그레이션은 SDK v2 release까지 이연**(현재 착수 시 RC 변동으로 재작업 위험).

### M-2(v12). `EmbeddingManager.enqueuedBatch`의 timeout 타이머가 성공 시 clear되지 않음 — 배치당 2분 dangling 타이머 `[DONE — Phase 15-1]`
**`src/indexer/embedding-manager.ts:378-394`**

```ts
const timeoutPromise = new Promise<never>((_res, rej) =>
    setTimeout(() => rej(new Error(`Batch timed out after ${timeoutMs}ms`)), timeoutMs)  // ← 성공해도 clearTimeout 없음
);
resolve(Promise.race([batchPromise, timeoutPromise]));
return Promise.race([batchPromise, timeoutPromise]).then(() => {}, () => {});
```

`Promise.race`가 `batchPromise`(성공/실패)로 먼저 결판나도 **`timeoutPromise`의 `setTimeout` 핸들은 clear되지 않는다**. 배치가 50개 노드 단위로 수백 회 돌면(`refreshAll`), 각 배치마다 `BATCH_TIMEOUT_MS`(120s) 동안 살아있는 타이머가 누적된다 — 대형 리포 초기 인덱싱에서 수백 개의 dangling 타이머가 동시 존재할 수 있다. 타이머는 reject 후 GC되지만, **만료 전까지 이벤트 루프에 등록돼 있고** unref도 안 돼 있어 (a) 프로세스가 인덱싱 직후 종료하려 할 때 최대 2분 지연시킬 수 있고(타이머가 루프를 붙잡음), (b) 수백 개가 동시 존재하면 메모리·타이머 큐 압박이 미미하게 발생한다. **정합성 문제는 아니다**(결과는 올바름) — 자원 위생 결함.

**수정 권고**: `setTimeout` 핸들을 잡아 race 종료 시 `finally`에서 `clearTimeout`, 또는 타이머에 `.unref()`. WorkerPool(`worker-pool.ts:154-159`)·IPC keepalive(`ipc-coordinator.ts:184`)·session sweeper(`api-server.ts:201`)는 이미 clear/unref 규율을 지키므로 동일 패턴으로 정렬. **테스트**: fake timer로 배치 성공 후 pending 타이머가 0인지(또는 unref됐는지) 검증.

### M-3(v12). tree-sitter 코어와 grammar 패키지의 메이저 버전 드리프트 — override로 봉합 중이나 ABI/기능 정합성 비검증 (O-2 v11 승계) `[DONE — Phase 15-2]`
**`package.json:41-53, 69-89`**

**Phase 15-2 처리 결과**:
- **M-3(2) override 일관 적용 [채택]**: 진단 시점 `npm ls tree-sitter`로 확인한 결과, **top-level `overrides.tree-sitter: ^0.25.0` 하나가 이미 모든 native grammar의 전이 `tree-sitter` 의존을 0.25.0으로 dedupe**하고 있었다(중첩 5개 override는 동일 효과의 중복). 따라서 5개 grammar별 중첩 `tree-sitter` override(c-sharp/cpp/java/kotlin/typescript)를 제거하고 **top-level 단일 override로 일관화**했다. 변경 후 `npm ls tree-sitter`에서 12개 grammar 전부 `tree-sitter@0.25.0 deduped` 확인 → ABI 통일을 단일 지점으로 명시 보장. **메타데이터-only, 무회귀.**
- **M-3(3) 코어 마이너 [해당 없음/이미 정렬]**: npm registry 직접 조회 결과 `tree-sitter` 코어 최신은 **0.25.0**이며 0.25.1은 **존재하지 않음**(`npm view tree-sitter versions` = 0.0.25, 0.25.0뿐). 진단 6.2의 0.25.1 언급은 registry `latest` 태그와 불일치. 코어는 이미 최신 → 변경 없음.
- **M-3(1) grammar 마이너 정렬 [대부분 이미 최신; c-sharp는 롤백]**: rust/php/go/python/c/javascript/cpp/java/kotlin/gdscript/typescript는 **선언 범위가 이미 각 패키지의 npm `latest`와 일치**(추가 마이너 여지 없음). 유일하게 신규 버전이 있던 **`tree-sitter-c-sharp` 0.23.1 → 0.23.5** 갱신을 시도했으나, 0.23.5는 node 바인딩(`bindings/node/index.js`)을 **ESM + top-level await 그래프로 전환**해 `descriptor.ts`의 동기 `require()`가 `ERR_REQUIRE_ASYNC_MODULE`로 실패(`language-registry.test.ts` 2건 회귀). → **c-sharp를 `0.23.1`로 정확히 핀(`^` 제거, ~0.23.1도 0.23.5를 끌어오므로 정확 핀 필요)하여 롤백.** 다른 grammar는 영향 없음(개별 롤백 원칙 준수).
- **최종 override 구조**: `overrides = { tree-sitter: ^0.25.0, fast-uri, qs, hono }` (grammar별 중첩 override 전부 제거, 단일 top-level로 ABI 통일).
- **회귀 검증**: 변경 전후 `vitest run` 563/563 동일, `tsc --noEmit` clean, `npm audit --omit=dev` 0 vulnerabilities, integration 76/76. 기존 fixture 기반 `parser`·`metrics-calculator`·`language-registry` 스위트가 언어별 노드/에지/CC/loc 동등성 바 역할을 그대로 수행(c-sharp 0.23.5 회귀를 정확히 포착) → 신규 테스트 불필요.

코어 `tree-sitter@^0.25.0`(설치 0.25.0)와 일부 grammar이 메이저가 다르다: `tree-sitter-typescript@^0.23.2`, `tree-sitter-c-sharp@^0.23.1`, `tree-sitter-cpp@^0.23.4`, `tree-sitter-java@^0.23.5`, `tree-sitter-rust@^0.24.0`, `tree-sitter-php@^0.24.2`, `tree-sitter-kotlin@^0.3.8`, `tree-sitter-gdscript@^6.1.0`. `overrides`가 5개 grammar(c-sharp/cpp/java/kotlin/typescript)에 대해 중첩 `tree-sitter: ^0.25.0`을 강제해 ABI를 통일하지만, **rust/php/go/python/c/javascript는 override 미적용**이고 grammar 자체 마이너 업그레이드 여지가 남아 있다. 진단 시점에 테스트 558/558 그린이라 **현재 파싱은 정상**이지만, grammar별 메이저 비대칭은 미래 코어 업그레이드 시 침묵 파싱 회귀(노드 누락·CC 오계산)의 잠재 표면이다.

**판정**: LOW였던 O-2(v11)를 MEDIUM 하단으로 약승격 — 자체 결함은 아니나 "override 봉합에 의존하는 비대칭"이 누적되면 유지보수 비용이 커진다. Phase 15에서 (a) 각 grammar의 최신 마이너로 일괄 정렬 + (b) override를 **모든** native grammar에 일관 적용(현재 5개만)하고, (c) 정렬 후 언어별 파서 스냅샷 회귀로 노드/에지/CC 동등성 확인. **테스트**: 언어별 fixture의 노드·에지·메트릭 기대값(`tests/parser.test.ts`·`metrics-calculator.test.ts`) 동등성.

### M-4(v12). 클러스터링 대형 그래프 가드가 `getAllNodes()`를 이미 한 번 적재한 뒤에 판정 — 가드 직전 풀 로드로 OOM 1차 방어선이 약함 `[DONE — Phase 15-1]`
**`src/graph/graph-engine.ts:222-241`**

P14-4의 A-2 가드는 `nodes.length > maxNodes`를 검사해 인접 리스트·라벨 맵 구축 전에 short-circuit한다 — 이는 정확하고 좋은 개선이다. 다만 가드 판정 자체가 `const nodes = this.nodeRepo.getAllNodes()`(223행)로 **전체 노드 배열을 메모리에 이미 적재한 뒤** 이뤄진다. 200k 임계 가드의 목적이 RSS 폭증 방어인데, 200k+ 노드를 가진 리포에서는 가드가 발동하기 전에 `getAllNodes()`가 이미 수백 MB를 적재한다(노드 객체에 signature/tags/history JSON 포함). `getAllEdges()`(224행)는 가드 통과 전에는 호출되지 않으므로 에지 풀 로드는 막혔지만, 노드 적재는 막지 못한다.

**판정**: 가드의 1차 방어선을 노드 풀 로드 **이전**으로 끌어올리는 저비용 개선 — `nodeRepo`에 `countNodes()`(단일 `SELECT COUNT(*)`) probe를 추가해 가드를 그 카운트로 판정하고, 통과 시에만 `getAllNodes()`를 호출한다. O-5(본격 서브그래프 파티셔닝)는 계속 이연하되, 가드의 실효성을 카운트-우선으로 보강. **테스트**: 임계 초과 시 `getAllNodes()`가 호출되지 않는지(spy), 임계 이하는 정상 진행 + 기존 클러스터링 결과 불변.

---

## 4. 최적화 (LOW)

| # | 위치 | 내용 |
|---|------|------|
| O-1(v12) | `src/server/api-server.ts` | session-id 기반 StreamableHTTP가 stateless RC(M-1)와 충돌 — SDK v2 업그레이드 시 회귀 표면. **추적만**(M-1에 포함), SDK 1.x 동안 변경 불필요 |
| O-2(v12) | `package.json` overrides | tree-sitter grammar 메이저 드리프트(M-3에 흡수) — override 일관 적용 + 마이너 정렬 `[DONE — Phase 15-2: top-level 단일 override로 일관화, c-sharp 0.23.5는 ESM/TLA 회귀로 롤백]` |
| O-3(v12) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환(v8→v11 이월). **성능 문제 미관측, verdict: 계속 보류.** 메시지가 작고(주로 메타데이터) round-trip이 드물어 직렬화가 병목 아님. 기록만 유지 |
| O-4(v12) | `src/server/_progress.ts`·`tool-dispatcher.ts`·`ipc-coordinator.ts:43-58` | progress/task "future direction" 주석이 2025-11-25판 SEP-1686을 가리킴 — 2026-07-28 extension 모델로 갱신(M-1(a)에 포함, 문서/주석 only) |
| O-5(v12) | `src/graph/graph-engine.ts` | 클러스터링 본격 서브그래프 파티셔닝 — 100k+ 노드 실측 시 재검토(**verdict: 계속 이연**). M-4의 count-first 가드는 별개로 채택 |
| O-6(v12) | CI / Dockerfile | Node 24 + tree-sitter 0.25.x 빌드 취약성(C++20/prebuild 부재) — CI `build-and-test`가 Node 24 매트릭스에서 `npm test`를 돌리고 현재 그린이나(prebuild 해소 중), 상류 이슈(node-tree-sitter#268)가 미해결. Node 24 LTS 전환 전 prebuild 가용성 재확인 필요. **추적만** |

---

## 5. 테스트 공백

Phase 14 종료 시 558 테스트(통합 76 케이스)로 회귀 안전망이 두텁다. 본 사이클의 신규/잔존 공백은 좁다:

| 공백 | 검증해야 할 시나리오 | 관련 항목 | 우선순위 |
|------|---------------------|-----------|----------|
| **임베딩 배치 타이머 위생** `[DONE — Phase 15-1]` | 배치 성공 후 dangling `setTimeout`이 0(또는 unref)인지(fake timer) | M-2 | 중간 |
| **클러스터링 count-first 가드** `[DONE — Phase 15-1]` | 임계 초과 시 `getAllNodes()` 미호출(spy) + 임계 이하 결과 불변 | M-4 | 중간 |
| **tree-sitter grammar 정렬 회귀** `[DONE — Phase 15-2]` | grammar 마이너 정렬 후 언어별 노드/에지/CC 동등성(기존 fixture 스위트가 바 역할; c-sharp 0.23.5 회귀 포착→롤백) | M-3 | 중간 |
| **MCP transport 스펙 추적(설계 메모)** | (코드 변경 아님) session-id 구조의 stateless 충돌 지점 문서화 | M-1 | 낮음(문서) |

기존 스위트(`tests/`)는 lock 경합·IPC e2e+인증·REST HTTP·비-TS 메트릭·git 이력 재작성·purge 재초기화·임베딩 프로토콜(A-7 request-id discipline)·CrossProjectResolver 멀티프로젝트(P14-2)·클러스터링 결정성(P14-4)·MCP progress(P14-5)를 이미 커버한다.

---

## 6. 외부 컨텍스트 (웹 조사 — 출처 명시)

### 6.1 의존성 취약점 (진단 일자 직접 재검증 — 전부 clean)

Phase 14-1의 해소가 진단 일자에도 유효한지 `npm audit --omit=dev --json` + `npm ls`로 직접 재확인했다:

- **`npm audit --omit=dev` = 0 vulnerabilities** (info/low/moderate/high/critical 전부 0 — 직접 실행). Phase 14-1 baseline 유지.
- **fast-uri**: `overrides`로 `3.1.2` 강제 — CVE-2026-6321(percent-encoded dot-segment path traversal, HIGH; ≤3.1.0 영향) 패치 라인. SDK `@modelcontextprotocol/sdk@1.29.0`가 여전히 ajv→fast-uri를 끌어오나 override가 패치 버전으로 dedupe. 출처: [GHSA-q3j6-qgpj-74h6](https://github.com/advisories/GHSA-q3j6-qgpj-74h6)
- **`@modelcontextprotocol/sdk` 전이 의존 묶음**: 상류 이슈 [typescript-sdk#2042](https://github.com/modelcontextprotocol/typescript-sdk/issues/2042)(2026-05-10 보고)는 **진단 시점 여전히 open**이고 SDK는 **1.29.0이 npm `latest`**(직접 확인) — 상류 패치 미반영이라 Cynapx의 `overrides`가 계속 유효한 해법. 이슈가 제안한 타깃 버전(`fast-uri ≥3.1.2`, `hono ≥4.12.18`, `ip-address ≥10.2.0`, `express-rate-limit ≥8.5.1`)은 Cynapx가 이미 충족(override hono `^4.12.21`, express-rate-limit `8.5.2`→ip-address `10.2.0`). 출처: 위 이슈, npm registry.
- **express-rate-limit 8.5.2** → **ip-address 10.2.0**(직접 `npm ls ip-address` 확인): ip-address XSS(Address6 HTML 메서드) 패치 라인. CVE-2026-30827(IPv4-mapped IPv6 rate-limit bypass, 8.3.0에서 1차 수정)도 8.5.2가 반영하며, Cynapx는 `keyGenerator`를 `req.socket.remoteAddress`로 고정(`api-server.ts:128,133`)해 bypass를 이중 우회. 출처: [CVE-2026-30827](https://nvd.nist.gov/vuln/detail/CVE-2026-30827)
- **qs**: `overrides` `^6.15.2` — comma-format array stringify DoS(MODERATE) 패치. express@4.22.1·SDK express@5.2.1·superagent 경유 전부 dedupe. 출처: [GHSA-q8mj-m7cp-5q26](https://github.com/advisories/GHSA-q8mj-m7cp-5q26)
- **js-yaml 4.2.0**(직접 확인, P14-3에서 prod 추가): **CVE-2025-64718**(prototype pollution via `__proto__`, js-yaml < 4.1.1 / < 3.14.2 영향, **4.1.1에서 패치**) → Cynapx 4.2.0은 **패치 라인 이상이라 무관**. **CVE-2026-33532**(deeply-nested flow sequence stack overflow DoS)는 **`yaml` 라이브러리(eemeli/yaml) 대상이지 `js-yaml`(nodeca)이 아니다** — Cynapx는 `js-yaml`을 쓰고 `yaml`을 쓰지 않으므로 무관. 추가로 P14-3 파서는 CI 워크플로 YAML(신뢰 입력, 인덱싱 대상 파일)만 파싱하고 `yaml.load()`(YAMLException graceful 강등)를 쓴다. 출처: [CVE-2025-64718](https://github.com/nodeca/js-yaml/issues/628), [CVE-2026-33532](https://www.sentinelone.com/vulnerability-database/cve-2026-33532/)
- **better-sqlite3 12.x / SQLite 3.53.1**: 로컬 `sqlite_version()` = **3.53.1** 직접 확인. CVE-2025-7709(FTS5 integer overflow)·CVE-2025-70873(zipfile heap disclosure, ≤3.51.1)는 모두 3.53.1에서 비해당/패치. 신규 SQLite CVE 중 3.53.1 영향 미발견. **clean.** 출처: [SQLite security](https://stack.watch/product/sqlite/sqlite/), [better-sqlite3 Snyk](https://security.snyk.io/package/npm/better-sqlite3)
- **sqlite-vec 0.1.9 / swagger-ui-express 5 / commander / chokidar 5 / simple-git / ignore / zod 4**: 미해결 공개 취약점 미발견.

### 6.2 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"` + Docker `node:22-bookworm-slim`(builder+runtime 직접 확인). Node 22 LTS 유지보수 2027-04 종료 — 여유. **단 CI `build-and-test`가 Node 22·24 매트릭스에서 `npm test`를 돌린다**(현재 558/558 그린). Node 24 + tree-sitter 0.25.x는 상류에서 C++20/prebuild 부재 빌드 실패가 보고됐으나(node-tree-sitter#268), Cynapx CI는 현재 통과 — prebuild 가용성에 의존하는 잠재 fragility(O-6). 출처: [node-tree-sitter#268](https://github.com/tree-sitter/node-tree-sitter/issues/268)
- **tree-sitter 코어**: npm에 0.25.1 존재(설치본 0.25.0). 마이너 갱신 여지(M-3). 출처: [node-tree-sitter](https://www.npmjs.com/package/tree-sitter)

### 6.3 MCP 생태계 — **본 사이클 핵심 신호**

- **MCP 2026-07-28 스펙 RC**(2026-05-21 lock, 2026-07-28 최종 예정): (1) **Tasks(SEP-1686)를 core spec → extension으로 강등** — *"production use surfaced enough redesign that the right home for it is an extension"*. server-directed task 생성(`tools/call`이 task handle 반환), `tasks/get`/`update`/`cancel`, `tasks/list` 제거. **2025-11-25 experimental Tasks를 쓰던 코드는 breaking migration.** (2) **Stateless transport**: `initialize`/`initialized` + `Mcp-Session-Id` 제거, `Mcp-Method`/`Mcp-Name` 라우팅 헤더 + `_meta` client info. → Cynapx의 P14-5 progress 배선과 session-id 구조(M-1)에 직접 함의. **SDK v2 stable은 Q3 2026 예고, SDK `latest`=1.29.0(아직 session-id 모델)** — 즉시 대응 불필요, 추적·설계 메모 대상. 출처: [2026-07-28 RC 블로그](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/), [SEP-1686 Tasks](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1686)
- **SEP-1686 lifecycle 갭**: 초기 프로덕션 사용에서 (a) 일시적 실패 시 retry 시맨틱, (b) 완료 후 결과 보존 expiry 정책이 미비로 드러남 — Cynapx가 전면 task lifecycle을 채택한다면 이 갭들이 설계 부담. progress-token 기반 진행률(P14-5가 채택한 최소 모델)은 RC에서도 유지되므로 **P14-5 배선 자체는 폐기 대상이 아니다**(token opt-in은 호환). 출처: 위 SEP-1686 이슈.

### 6.4 경쟁/인접 도구 동향

- **로컬-퍼스트 코드 그래프가 명백한 승리 패턴으로 자리잡음**(2026): CodeGraph(2026-01 출시 5개월 만에 47.4k stars), GitNexus(2026-04→06 1.2k→42k stars), **Serena**(25.2k stars, MIT, **LSP-over-MCP**)가 심볼-레벨 표준의 사실상 기본값. Cynapx의 "100% 로컬·격리·멀티프로세스 보안 IPC" 포지션은 이 카테고리 안에서 차별점이지만, **경쟁자 다수가 LSP/SCIP 정밀 심볼 해석을 채택**한다는 점이 함의: Cynapx의 tree-sitter 기반 휴리스틱 심볼 해석(cross-project LIKE/probe 등)은 정밀도에서 LSP/SCIP에 뒤질 수 있다(차별화 축은 정밀도가 아니라 격리·보안·증분 동기화 견고성). 출처: [Code Intelligence Tools for AI Agents](https://rywalker.com/research/code-intelligence-tools)
- **SCIP가 LSIF를 대체하는 심볼 인덱스 표준으로 굳어짐**(scip-typescript/java/rust-analyzer/clang/python/dotnet/php 등 다수 인덱서가 emit). Cynapx의 그래프 export(`export_graph`: json/graphml/dot)에 **SCIP export를 미래 후보로 검토**하면 Sourcegraph/기타 생태계와의 상호운용성이 생긴다(Phase 15 범위 아님, 전략 메모). 출처: [SCIP announce](https://sourcegraph.com/blog/announcing-scip)
- **함의**: 이번 사이클도 v11과 동일하게 **기능 추가보다 (1) 생태계 스펙 추적(MCP 2026-07-28), (2) 공급망 위생 유지, (3) 자원/안정성 위생**이 신뢰성 차별화 축이다. SCIP/LSP 정밀도 경쟁은 Cynapx의 포지션(격리·보안)과 직접 충돌하지 않으므로 전략 추적 대상으로만 둔다.

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 정밀 재열람에서 신규 결함이 없었다:

- `src/server/ipc-coordinator.ts` — challenge-response 인증·라인 단위 1MB 바이트 제한·per-tool 타임아웃·keepalive(unref+clear)·pending reject-on-close 모두 견고.
- `src/server/api-server.ts` — 세션 TTL/cap/sweep(unref), timing-safe Bearer(SHA-256+timingSafeEqual), sessionId 마스킹(로그/URL), per-session transport 페어(CVE-2026-25536 무관), rate-limit keyGenerator 고정 양호.
- `src/indexer/worker-pool.ts` — WeakMap taskMap·double-settle 가드·timeout→replaceWorker·setImmediate 재진입 방지·dispose 시 큐/타이머 정리 모두 견고.
- `src/indexer/embedding-manager.ts` — A-7 request-id discipline·spawn error 핸들러·자동 재시작 지수 백오프·FTS5 폴백 강등·dispose 시 SIGTERM→SIGKILL 에스컬레이션 양호(단 M-2 배치 타이머 위생만 잔여).
- `src/indexer/cross-project-resolver.ts` — P14-2 indexed probe + 원격 DB sanity(user_version/nodes 검사)·1회 경고·핸들/캐시 무효화 건전.
- `src/graph/graph-engine.ts` — P14-4 Fisher-Yates + seeded PRNG 결정성·대형 그래프 가드 양호(단 M-4 count-first 보강 여지).
- `src/server/tools/_progress.ts`·`tool-dispatcher.ts` — progress token opt-in·NOOP 폴백·sender 오류 swallow·payload 불변 양호(단 M-1 주석 표적 갱신).
- `src/utils/lock-manager.ts` — atomic write/heartbeat staleness/nonce 자기 일치 release 검증.
- `.github/workflows/ci.yml` — Node 22/24 매트릭스 + `npm audit --omit=dev --audit-level=high` 게이트(P14-1) 양호. (cynapx-autonomous.yml은 본 진단 범위 외 — 미변경.)

---

## 8. 권장 수정 순서 (Phase 15 제안 — 상세는 phase15-plan.md)

14개 페이즈 이후 **CRITICAL/HIGH 코드·공급망 결함 0**이라 본 사이클은 v11보다도 작다(예상 3~5 커밋). 핵심은 코드 결함 수정이 아니라 **자원 위생 마감 + 생태계 추적 메모 + 의존성 정렬**이다.

1. **P15-1** `[DONE]`: M-2 임베딩 배치 타이머 위생 + M-4 클러스터링 count-first 가드 (자원/안정성 위생, 저위험·단일 파일급). 두 항목 모두 인덱싱 핫패스의 자원 규율 정렬.
2. **P15-2**: M-3 tree-sitter grammar 마이너 정렬 + override 일관 적용 (언어 파서 스냅샷 회귀 동반).
3. **P15-3**: M-1 MCP 2026-07-28 추적 — progress/task "future direction" 주석을 extension 모델로 갱신 + session-id↔stateless 충돌 지점 설계 메모 (문서/주석 only, 코드 동작 무변경).

(O-3 MessagePack 계속 보류, O-5 클러스터링 본격 파티셔닝 계속 이연, MCP 전면 task lifecycle은 SDK v2 release까지 이연.)
