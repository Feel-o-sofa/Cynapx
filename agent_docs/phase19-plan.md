# Phase 19 작업 계획 — diagnostic-v16 대응

> **작성**: 2026-06-14 / **기준 문서**: `agent_docs/diagnostic-v16.md` (기준 커밋 `94183ef`, Phase 18 + Phase 18-1 완료)
> **목표**: diagnostic-v16가 발견한 **유일한 actionable 항목 M-1 v16 — REST `/api/*` 핸들러 동작 분기의 게이트 공백** 을 해소한다. 등록된 8개 REST 핸들러 중 핸들러 *동작* 분기(특히 `getNodeByQualifiedName()` 실패 시 `404 SYMBOL_NOT_FOUND` 가드 5건, `handleExportGraph`의 `200`/`EXPORT_FAILED`, `validate()`의 `400`)는 실제 Express 앱을 통해 어느 게이트에서도 검증되지 않으며, `scripts/integration-test.js`/`ipc-e2e-test.js`(CI 미실행 e2e)에서조차 호출되지 않는다(REST 표면 미접촉). 이 8개의 핵심 분기를 기존 `fakeMcpServer`/supertest 하니스로 `tests/api-server-http.test.ts`에 추가해 CI vitest 게이트로 끌어올린다. 계속 보류/이연/추적 항목(L-2/L-3/L-4/L-5/L-6/L-7)은 본 계획에서 추적만 갱신하거나 제외하고 기록을 유지한다(4장).
>
> **맥락**: **v15→Phase18은 MCP 도구 디스패처의 게이트 분포 공백(M-1 v15)을 닫았다(20/20 도구 게이트 커버).** Phase 19는 그 3중 대조 방법론(등록 ↔ 테스트 케이스 ↔ CI 게이트)을 **MCP 도구에서 멈추지 않고 모든 등록 표면으로 확장**한 데서 나온다 — REST 라우트 8개 + admin CLI 명령 9개를 같은 격자로 재대조했고, **REST 표면에서 실재하는 무위험 공백**을 찾았다(admin CLI는 `cmd*` 미-export라 테스트-only로 메울 수 없어 L-7로 추적만, 의도적 비-actionable). 공급망·CVE·코드 결함은 여전히 clean(CRITICAL/HIGH 0, 신규 CVE 도달 0, Miasma wave-3 미출현). M-1 v16은 **프로덕션 코드 동작을 한 줄도 바꾸지 않는 순수 additive 테스트 항목**이다 — 8개 핸들러는 실제로 정상 동작하나, 그 동작 회귀(404 가드 제거로 null 노드가 500/크래시, export 포맷 회귀)가 어느 게이트도 통과 못 잡는다. 따라서 Phase 19는 **단일 테스트-only 서브 페이즈(P19-1) + 추적 상태 갱신**이며, 예상 **2커밋**(diagnostic-v16 + phase19-plan docs 커밋 1 + P19-1 테스트 커밋 1) 또는 운영 편의상 **1~2커밋**이다.

---

## 0. 작업 원칙

- 본 계획의 핵심 작업(P19-1)은 **테스트-only**다 — `src/` 프로덕션 코드는 한 줄도 바꾸지 않는다(핸들러는 정상). 신규 케이스는 `tests/api-server-http.test.ts`에 추가한다(기존 supertest 하니스 재사용).
- 본 사이클에 의존성 변경은 없다. `npm audit --omit=dev` **0 vulnerabilities** 유지가 baseline 불변(P14-1 audit 게이트 그대로 유효). supertest는 이미 dev 의존성·사용 중이라 신규 의존 도입 0.
- Phase 종료 시 `npx vitest run`이 **578 + 신규 케이스**로 그린, `npx tsc --noEmit` 그린 확인. e2e 스크립트(`integration-test.js`/`ipc-e2e-test.js`)는 REST 무접촉이라 영향 없음(선택 확인 불요).
- Phase 종료 시 `agent_docs/diagnostic-v16.md`의 M-1 v16에 [DONE] 마킹.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.**

---

## 1. 의존성 맵 (작업 순서에 영향을 주는 관계)

```
P19-1 (8개 REST 핸들러 동작 분기 supertest 테스트 추가)   독립 — 유일한 코드(테스트) 작업 단위.
  └─ handleGetSymbol 404/200 테스트  ← 우선순위 1 (가드 분기 명확, mock 최소, 패턴 재사용)
  └─ handleGetCallers / handleGetCallees / handleImpactAnalysis / handleTests
        ← 동일 404 가드 패턴(getNodeByQualifiedName null) — handleGetSymbol 패턴 복제
  └─ handleExportGraph (200 mermaid 성공 + catch→EXPORT_FAILED 500)
        ← graphEngine.exportToMermaid mock; 성공/throw 두 분기
  └─ validate 400 1건  ← 임의 라우트에 잘못된 body POST → 400 Validation failed
```

```
L-2 (Miasma wave-3 공급망 포스처)      ──추적만──→  [wave-3 미출현; 의존 추가 시 binding.gyp 검토 + npm ci lockfile 고정 + 매 사이클 npm ls 재대조; AI 에이전트(.claude/) 표적 변종 인지]
L-3 (MCP stateless/task 마이그레이션)  ──이연──→  [SDK v2 npm 정식 배포까지 — alpha는 있으나 npm latest 미배포, 착수 불가]
L-4 (IPC MessagePack)                 ──계속 보류──
L-5 (클러스터 본격 파티셔닝)           ──계속 이연──
L-6 (Node 24 tree-sitter 빌드)         ──추적만──→  [node-tree-sitter#268 해소 + Node 24 LTS 전환 시]
L-7 (admin CLI cmd* 게이트 공백)       ──추적만(비-actionable)──→  [admin.ts 핸들러 export 리팩터 시 함께 게이트화]
SCIP export                           ──전략 후보──→  [P19-1(REST export 게이트화)을 추가 디딤돌로; protobuf 의존 부담으로 즉시 착수 비권장]
```

---

## 2. Phase 19-1: 8개 REST 핸들러 동작 분기 supertest 테스트 추가 (M-1 v16) — 테스트-only·무위험

**목표**: CI vitest 게이트의 REST 핸들러 동작 테스트 공백을 메운다. `setupRoutes()`에 등록된 8개 REST 핸들러의 핵심 동작 분기를 `tests/api-server-http.test.ts`에 supertest 케이스로 추가한다. **프로덕션 코드는 건드리지 않는다(핸들러 정상).**

| 항목 | 파일 | 작업 |
|------|------|------|
| handleGetSymbol 404/200 (우선순위 1) | `tests/api-server-http.test.ts` | (a) `getNodeByQualifiedName` null mock → `POST /api/symbol/get` → `404` + `error_code: 'SYMBOL_NOT_FOUND'`, (b) 노드 + `getOutgoingEdges`/`getIncomingEdges` 빈 배열 mock → `200` + `node.symbol.qualified_name` 검증. `fakeMcpServer({ ctx })`의 `ctx.graphEngine`에 `getNodeByQualifiedName`/`getOutgoingEdges`/`getIncomingEdges`/`getNodeById` mock 추가(소량 fixture). |
| 404 가드 4개 (callers/callees/impact/tests) | `tests/api-server-http.test.ts` | 각 라우트에 `getNodeByQualifiedName` null mock → `404 SYMBOL_NOT_FOUND`. handleGetSymbol 패턴 복제 — 가장 안정적인 1 분기만(과도한 traverse mock 회피). 정상 200 분기는 가성비 따라 1~2개만 선택 추가(예: callers 200 — `traverse` 빈/소량 결과 mock). |
| handleExportGraph 200 + 500 | `tests/api-server-http.test.ts` | (a) `exportToMermaid` resolve mock → `POST /api/graph/export` → `200` + `{ format: 'mermaid', content }`, (b) `exportToMermaid` reject(throw) mock → catch → `500` + `error_code: 'EXPORT_FAILED'`. |
| validate 400 1건 | `tests/api-server-http.test.ts` | 임의 라우트(예: `/api/search/symbols`)에 스키마 위반 body(예: `{ query: '' }` — min(1) 위반, 또는 `{}`) POST → `400` + `error: 'Validation failed'`. `validate()` 헬퍼의 400 분기를 실 라우트로 1회 행사. |
| 베이스라인 재확인 | (검증) | `npx vitest run` = 578 + 신규 케이스 그린, `npx tsc --noEmit` 그린, `npm audit --omit=dev` 0 vulnerabilities(불변). |
| M-1 v16 마킹 | `agent_docs/diagnostic-v16.md` | M-1 v16에 [DONE] + 게이트로 끌어올린 핸들러 목록·신규 케이스 수 기록. |

**설계 메모(핸들러 동작 — 직접 확인)**:
- 라우트 등록: `setupRoutes()`(api-server.ts:322-331) — `/api/symbol/get`·`/api/graph/callers`·`/api/graph/callees`·`/api/analysis/impact`·`/api/analysis/hotspots`·`/api/analysis/tests`·`/api/search/symbols`·`/api/graph/export`.
- `validate()`(api-server.ts:115-122): `schema.safeParse(req.body)` 실패 → `400 { error: 'Validation failed', details }`, return null로 단락.
- 404 가드 5건: `handleGetSymbol`/`GetCallers`/`GetCallees`/`ImpactAnalysis`/`Tests` 모두 `getNodeByQualifiedName(qname)`이 null/`id===undefined`면 `404 SYMBOL_NOT_FOUND` 반환(api-server.ts:432,469,491,513,562).
- `handleExportGraph`(api-server.ts:412-423): `exportToMermaid({ rootQName, maxDepth })` resolve → `200 { format:'mermaid', content }`; throw → catch → `500 EXPORT_FAILED`. **mock 의존 최소(exportToMermaid 하나)라 export 분기 가성비 높음.**
- 하니스: `api-server-http.test.ts`의 `makeServer(fakeMcpServer({ ctx }))` + `request(server).post(route).set('Authorization', AUTH).send(body)` 패턴 그대로 재사용. `KNOWLEDGE_TOOL_TOKEN`은 `beforeAll`에서 이미 설정됨.

**테스트**:
- 신규 케이스 자체가 검증 산출물. 기존 578 케이스 불변 그린 + 신규 케이스 그린.
- `npx tsc --noEmit` 그린(테스트 타입 정합), `npm audit --omit=dev` 0 vulnerabilities(불변).
- e2e 스크립트는 REST 무접촉이라 무영향(선택 확인 불요).

**산출물**: 1개 커밋(`tests/api-server-http.test.ts` 신규 케이스 + diagnostic-v16 [DONE] 마킹). **리스크: 매우 낮음** (테스트-only, 프로덕션 코드·설치본·동작 전부 불변. 최악의 경우 mock 결합으로 인한 테스트 취약성뿐이며, 핵심 분기·최소 mock 원칙으로 완화).

---

## 3. 유지보수 모드 포스처 ("정기 점검" 이월)

P19-1 외에는 18 페이즈 이후의 성숙도가 유지되므로, 다음을 정기 점검 항목으로 이월한다:

1. **공급망 위생(매 사이클)**: `npm audit --omit=dev` = 0 vulnerabilities 유지. 신규 advisory 시 `overrides`로 패치 floor 못 박기(fast-uri/qs/hono 패턴). **의존 추가 시 binding.gyp 검토**(Miasma/Phantom Gyp — wave-3 미출현이나 AI 에이전트 `.claude/`/Cursor/Gemini 설정 주입 변종 인지) + CI는 `npm ci`(lockfile 고정)만 사용. Miasma 패키지 패밀리가 트리에 진입했는지 매 사이클 `npm ls` 재대조(현재 0건).
2. **MCP SDK v2 npm 배포 모니터링**: npm `latest`가 2.x로 넘어가면(현재 1.29.0, alpha 존재하나 npm 정식 미배포) L-3(stateless transport + task extension 마이그레이션)이 비로소 actionable — P15-3 설계 메모가 출발점. 그 전까지 1.29.0 유지가 정답.
3. **런타임 수명주기**: Node 22 LTS(2027-04 종료)·tree-sitter 코어/grammar 신버전·tree-sitter-c-sharp 0.23.6+(ERR_REQUIRE_ASYNC_MODULE 해소) 출현 시 정렬 재검토. Node 24 LTS 전환은 node-tree-sitter#268(C++20/prebuild) 해소 후. better-sqlite3 12.10.1(Electron 전용 no-op 갱신)은 다음 정기 의존성 갱신 시 정렬 가능(비-긴급).
4. **회귀 안전망 위생(P18-1 MCP 도구 → P19-1 REST 핸들러로 확장)**: 새 도구/REST 라우트/포맷 추가 시 디스패처-레벨 또는 supertest-레벨 vitest 케이스를 함께 추가해 CI 게이트 커버리지 유지(integration-test.js/ipc-e2e-test.js는 CI 밖이고 REST는 e2e조차 안 침 — vitest+supertest 게이트가 1차 방어). admin CLI(L-7)는 핸들러 export 리팩터 시 함께 게이트화.

---

## 4. 보류/이연 항목 판정 (diagnostic-v16 → Phase 19 verdict)

| 항목 | diagnostic-v16 판정 | Phase 19 처리 |
|------|--------------------|---------------|
| **M-1 v16 REST 핸들러 동작 분기 게이트 공백** | 8개 핸들러 동작 분기(404 가드 5 + export + validate 400) 실 Express 게이트 미검증, e2e조차 REST 미접촉 (**verdict: actionable, 무위험 additive**) | **P19-1에서 해소** — 8개 핸들러 동작 분기 supertest 테스트 추가, handleGetSymbol 404/200 우선 |
| **L-2(v16) Miasma / Phantom Gyp 공급망 포스처** | wave-3 미출현, AI 에이전트 변종 인지, Cynapx 트리 0건 재대조, `npm ci`+audit 1차 방어 (**verdict: 추적만, 도달 0건 불변**) | 추적 상태만 갱신(3장) + binding.gyp 검토·lockfile 고정·매 사이클 `npm ls` 재대조 |
| **L-3(v16) MCP stateless transport + task extension 마이그레이션** | SDK v2 alpha 존재하나 npm 정식 미배포, 착수 불가 (**verdict: 계속 이연, 상태 불변**) | 범위 제외 — SDK v2 npm 배포까지 이연. P15-3 설계 메모가 출발점 |
| **L-4(v16) IPC MessagePack 직렬화** | 성능 문제 미관측 (**verdict: 계속 보류**) | 범위 제외 — 기록만 유지 |
| **L-5(v16) 클러스터링 본격 서브그래프 파티셔닝** | 현실 규모 무해, 100k+ 노드 실측 시 재검토 (**verdict: 계속 이연**) | 범위 제외 — M-4(v12) count-first 가드가 OOM 방어 |
| **L-6(v16) Node 24 + tree-sitter 빌드 fragility** | node-tree-sitter#268 여전히 open·미해결, Node 24 CI 그린 (**verdict: 추적, 상태 불변**) | 추적 상태만 갱신, 본격 대응은 Node 24 LTS 전환 시 |
| **L-7(v16) admin CLI cmd* 게이트 공백** | `cmd*` 미-export라 테스트-only로 메울 수 없음(프로덕션 리팩터 수반), 기반 프리미티브는 이미 게이트 커버 (**verdict: 추적만, 비-actionable**) | 범위 제외 — admin.ts 핸들러 export 리팩터 시 함께 게이트화 후보로 기록 |
| **SCIP export(전략 후보)** | MCP `export_graph`는 P18-1 게이트 커버됐으나 REST `/api/graph/export`는 미검증 → 신규 포맷 전 REST export 게이트화가 합리적 선행 (**verdict: 전략 후보, 즉시 비권장**) | 범위 제외 — **P19-1(REST export 게이트화)이 SCIP의 추가 디딤돌**. protobuf 의존 부담 + install-time 표면 확대 우려로 즉시 착수 비권장 |

---

## 5. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 19-(docs) | diagnostic-v16 + phase19-plan 신규 docs | 1 | 없음 (docs-only) |
| 19-1 | M-1 v16: 8개 REST 핸들러 동작 분기 supertest 테스트 추가(handleGetSymbol 404/200 우선) + diagnostic-v16 [DONE] — 578 + 신규 케이스 그린 | 1 | 매우 낮음 (테스트-only, 프로덕션 코드 무변경) |

**총 1~2개 커밋.** 본 사이클은 **v15→Phase18(MCP 도구 디스패처 게이트화)의 회귀-안전망 위생 작업을 인접 등록 표면(REST 핸들러)으로 확장**한다 — 프로덕션 동작은 여전히 불변(테스트-only)이라 무위험이다. **이번 사이클의 본질은 (1) v15의 3중 대조를 모든 등록 표면(REST·CLI)으로 끝까지 확장해 실재 공백 발견 + (2) CI 회귀 안전망 위생 + (3) 추적 상태 고정(L-7 신규 추적 포함) + 유지보수 포스처 이월**이다. Phase 19 종료 시 `agent_docs/diagnostic-v16.md`의 M-1 v16에 [DONE] 마킹.

---

## 6. 향후 후보 (Phase 19 범위 밖 — 기록 유지)

- **MCP transport v2 마이그레이션**: SDK v2 stable(Q3 2026 예고, alpha 존재하나 npm 정식 미배포) + spec final 후 — stateless transport(session-id 제거) + task extension(`tasks/get`/`update`/`cancel`) 전면 채택. L-3 + P15-3 설계 메모가 출발점. **트리거: npm `latest`가 2.x로 전환.**
- **SCIP export**: `export_graph`(+ REST `/api/graph/export`)에 SCIP 포맷 추가 — Sourcegraph/SCIP 생태계 상호운용. **선행 조건: P18-1(MCP export 디스패처 게이트) + P19-1(REST export 게이트) 완료** — 기존 분기가 게이트로 보호된 뒤 신규 포맷 추가가 안전. protobuf 빌드 의존 추가 부담 + install-time 공급망 표면(Miasma류) 확대 우려로 즉시 착수 비권장.
- **admin CLI 게이트화(L-7)**: `admin.ts`의 `cmd*` 핸들러를 export로 분리하는 리팩터를 동반할 때, status/list/inspect/doctor 등 비-파괴 명령부터 vitest 게이트 추가. 프로덕션 시그니처 변경 수반이라 무위험 사이클에는 부적합 — 별도 리팩터 페이즈로.
- **L-4 IPC MessagePack**: 성능 실측에서 IPC 직렬화가 병목으로 드러날 때 재검토(현재 미관측).
- **L-5 클러스터링 서브그래프 파티셔닝**: 100k+ 노드 모노레포 실측 시 — 파일/디렉터리 경계 기반 파티셔닝. M-4 count-first 가드가 그때까지 OOM 방어.
- **Node 24 LTS 전환**: tree-sitter 0.25.x prebuild 가용성 + C++20 빌드 환경 확정 후(node-tree-sitter#268 해소 추적).
- **tree-sitter-c-sharp 0.23.6+ 정렬**: ERR_REQUIRE_ASYNC_MODULE 해소 신버전 출현 시 0.23.1 정확 핀 롤백 해제 검토(현재 npm 최신 0.23.5도 미해소).
- **better-sqlite3 12.10.1 정렬**: Electron 전용 no-op 갱신이라 비-긴급 — 다음 정기 의존성 갱신 시 정렬.
</content>
</invoke>
