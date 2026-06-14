# Phase 18 작업 계획 — diagnostic-v15 대응

> **작성**: 2026-06-14 / **기준 문서**: `agent_docs/diagnostic-v15.md` (기준 커밋 `7c5d965`, Phase 17 완료)
> **목표**: diagnostic-v15가 발견한 **유일한 actionable 항목 M-1 v15 — CI vitest 게이트의 도구 디스패처 테스트 공백** 을 해소한다. 등록된 20개 MCP 도구 중 6개(`search_symbols`, `analyze_impact`, `get_callers`, `get_callees`, `get_remediation_strategy`, `export_graph`)는 CI가 돌리는 `npx vitest run` 게이트에 디스패처-레벨 동작 테스트가 0건이며, `scripts/integration-test.js`(CI 미실행 e2e 하니스)에서만 행사된다. 이 6개의 핵심 분기를 기존 `makeDeps` mock으로 `tests/tool-dispatcher.test.ts`에 추가해 게이트로 끌어올린다. 계속 보류/이연 항목(L-2/L-3/L-4/L-5/L-6)은 본 계획에서 추적만 갱신하거나 제외하고 기록을 유지한다(4장).
>
> **맥락**: **v13→Phase16, v14→Phase17의 2연속 content-light 사이클을 깨고, 회의적인 신선한 전수 재검토에서 실재하는 무위험 actionable 항목 1건을 발견했다.** 공급망·CVE·코드 결함은 여전히 clean(CRITICAL/HIGH 0, 신규 CVE 도달 0)이나, 테스트 커버리지 정밀 교차 대조(레지스트리 ↔ vitest 케이스 ↔ CI 작업 3중 대조)에서 게이트 분포 격차가 드러났다. M-1 v15는 **프로덕션 코드 동작을 한 줄도 바꾸지 않는 순수 additive 테스트 항목**이다 — 6개 도구는 실제로 정상 동작하나(integration-test.js e2e 통과), 그 회귀가 CI 게이트를 통과할 수 있다는 예방적 공백을 메운다. 따라서 Phase 18은 **단일 테스트-only 서브 페이즈(P18-1) + 추적 상태 갱신**이며, 예상 **2커밋**(diagnostic-v15 + phase18-plan docs 커밋 1 + P18-1 테스트 커밋 1) 또는 운영 편의상 **1~2커밋**이다.

---

## 0. 작업 원칙

- 본 계획의 핵심 작업(P18-1)은 **테스트-only**다 — `src/` 프로덕션 코드는 한 줄도 바꾸지 않는다(핸들러는 정상). 신규 케이스는 `tests/tool-dispatcher.test.ts`에 추가한다.
- 본 사이클에 의존성 변경은 없다. `npm audit --omit=dev` **0 vulnerabilities** 유지가 baseline 불변(P14-1 audit 게이트 그대로 유효).
- Phase 종료 시 `npx vitest run`이 **563 + 신규 케이스**로 그린, `npx tsc --noEmit` 그린 확인. 통합 스크립트(`scripts/integration-test.js`)는 native/transport 무영향이라 선택 확인.
- Phase 종료 시 `agent_docs/diagnostic-v15.md`의 M-1 v15에 [DONE] 마킹.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.**

---

## 1. 의존성 맵 (작업 순서에 영향을 주는 관계)

```
P18-1 (6개 도구 디스패처 단위 테스트 추가)   독립 — 유일한 코드(테스트) 작업 단위.
  └─ export_graph 테스트  ← 우선순위 1 (순수 분기 코드, 가성비 최고, mock 의존 최소)
  └─ search_symbols / analyze_impact / get_callers / get_callees / get_remediation_strategy
        ← graphEngine/refactorEngine/remediationEngine mock 확장 필요 시 export_graph 다음
```

```
L-2 (Miasma wave-2 공급망 포스처)     ──추적만──→  [의존 추가 시 binding.gyp 검토 + npm ci lockfile 고정 + 매 사이클 npm ls 재대조]
L-3 (MCP stateless/task 마이그레이션) ──이연──→  [SDK v2 npm 배포까지 — RC는 있으나 npm 미배포, 착수 불가]
L-4 (IPC MessagePack)                ──계속 보류──
L-5 (클러스터 본격 파티셔닝)          ──계속 이연──
L-6 (Node 24 tree-sitter 빌드)        ──추적만──→  [node-tree-sitter#268 해소 + Node 24 LTS 전환 시]
SCIP export                          ──전략 후보──→  [P18-1을 선행 디딤돌로; protobuf 의존 부담으로 즉시 착수 비권장]
```

---

## 2. Phase 18-1: 6개 도구 디스패처 단위 테스트 추가 (M-1 v15) — 테스트-only·무위험 [PENDING]

**목표**: CI vitest 게이트의 도구 디스패처 테스트 공백을 메운다. 등록 도구 20개 중 디스패처 테스트가 없던 6개(`search_symbols`, `analyze_impact`, `get_callers`, `get_callees`, `get_remediation_strategy`, `export_graph`)의 핵심 분기를 `tests/tool-dispatcher.test.ts`에 `executeTool()` 케이스로 추가한다. **프로덕션 코드는 건드리지 않는다(핸들러 정상).**

| 항목 | 파일 | 작업 |
|------|------|------|
| export_graph 단위 테스트 (우선순위 1) | `tests/tool-dispatcher.test.ts` | (a) no-context 가드 → `isError: true` + "No active project" 메시지, (b) `format` 미지정 → json 골격(`### Graph Export`/`Nodes:`/`Edges:` + mermaid), (c) `format: 'graphml'` → `<?xml`/`<graphml`/`<node`/`<edge` 골격, (d) `format: 'dot'` → `digraph G {`/`->`/`}` 골격, (e) `format: 'bogus'` → `isError: true` + "Supported: json, graphml, dot". `makeDeps`의 `mockGraphEngine`에 `exportToMermaid`/`getGraphData`(nodes/edges 소량 fixture) mock 추가. |
| 나머지 5개 read-path 단위 테스트 | `tests/tool-dispatcher.test.ts` | `search_symbols`(빈 결과/매치 분기), `analyze_impact`·`get_callers`·`get_callees`(엔진 미준비 시 `EngineNotReadyError`→`isError` 변환 또는 정상 빈-결과 분기), `get_remediation_strategy`(remediationEngine 미준비 시 가드). 각 도구의 가장 안정적인 1~2 분기만 — mock 표면을 최소로 유지(과도한 mock 결합 회피). 필요한 mock은 `makeDeps` overrides로 주입. |
| 베이스라인 재확인 | (검증) | `npx vitest run` = 563 + 신규 케이스 그린, `npx tsc --noEmit` 그린, `npm audit --omit=dev` 0 vulnerabilities(불변). |
| M-1 v15 마킹 | `agent_docs/diagnostic-v15.md` | M-1 v15에 [DONE] + 게이트로 끌어올린 도구 목록·신규 케이스 수 기록. |

**설계 메모(핸들러 동작 — 직접 확인)**:
- `executeTool()`(`tool-dispatcher.ts:231-257`): `isTerminal()` 단락 → `waitUntilReady()` → `toolRegistry.get(name)` → `handler.execute(args, deps, progress)` → `EngineNotReadyError`는 `isError: true`로 변환. 기존 `makeDeps`(`isTerminal: () => false`, `waitUntilReady: resolved`)로 핸들러 직행.
- `export-graph.ts`: `getContext()` null → no-context `isError`; `requireEngine(ctx, 'graphEngine')`; `format ?? 'json'`; json은 `exportToMermaid` + `getGraphData`; graphml/dot은 `getGraphData` + `escapeXml`/`escapeDot`; 그 외 → "Unknown format … Supported: json, graphml, dot" `isError`. **순수 분기라 mock 의존 최소.**

**테스트**:
- 신규 케이스 자체가 검증 산출물. 기존 563 케이스 불변 그린 + 신규 케이스 그린.
- `npx tsc --noEmit` 그린(테스트 타입 정합), `npm audit --omit=dev` 0 vulnerabilities(불변).
- (선택) `node scripts/integration-test.js` e2e — 본 작업은 e2e 무영향이나 게이트 분포 개선 후 회귀 없음 확인용.

**산출물**: 1개 커밋(`tests/tool-dispatcher.test.ts` 신규 케이스 + diagnostic-v15 [DONE] 마킹). **리스크: 매우 낮음** (테스트-only, 프로덕션 코드·설치본·동작 전부 불변. 최악의 경우 mock 결합으로 인한 테스트 취약성뿐이며, 핵심 분기·최소 mock 원칙으로 완화).

---

## 3. 유지보수 모드 포스처 ("정기 점검" 이월)

P18-1 외에는 17 페이즈 이후의 성숙도가 유지되므로, 다음을 정기 점검 항목으로 이월한다:

1. **공급망 위생(매 사이클)**: `npm audit --omit=dev` = 0 vulnerabilities 유지. 신규 advisory 시 `overrides`로 패치 floor 못 박기(fast-uri/qs/hono 패턴). **의존 추가 시 binding.gyp 검토**(Miasma/Phantom Gyp wave-2 — 2026-06-16 재발·확대, 647k monthly downloads 영향) + CI는 `npm ci`(lockfile 고정)만 사용. Miasma 패키지 패밀리가 트리에 진입했는지 매 사이클 `npm ls` 재대조(현재 0건).
2. **MCP SDK v2 npm 배포 모니터링**: npm `latest`가 2.x로 넘어가면(현재 1.29.0, RC 존재하나 npm 미배포) L-3(stateless transport + task extension 마이그레이션)이 비로소 actionable — P15-3 설계 메모가 출발점. 그 전까지 1.29.0 유지가 정답.
3. **런타임 수명주기**: Node 22 LTS(2027-04 종료)·tree-sitter 코어/grammar 신버전·tree-sitter-c-sharp 0.23.6+(ERR_REQUIRE_ASYNC_MODULE 해소) 출현 시 정렬 재검토. Node 24 LTS 전환은 node-tree-sitter#268(C++20/prebuild) 해소 후. better-sqlite3 12.10.1(Electron 전용 no-op 갱신)은 다음 정기 의존성 갱신 시 정렬 가능(비-긴급).
4. **회귀 안전망 위생(신규 — P18-1이 첫 사례)**: 새 도구/포맷 추가 시 디스패처-레벨 vitest 케이스를 함께 추가해 CI 게이트 커버리지 유지(integration-test.js는 CI 밖이므로 vitest 게이트가 1차 방어).

---

## 4. 보류/이연 항목 판정 (diagnostic-v15 → Phase 18 verdict)

| 항목 | diagnostic-v15 판정 | Phase 18 처리 |
|------|--------------------|---------------|
| **M-1 v15 CI vitest 게이트 도구 디스패처 테스트 공백** | 6개 도구 vitest 게이트 미검증, e2e만(CI 미실행) (**verdict: actionable, 무위험 additive**) | **P18-1에서 해소** — 6개 도구 디스패처 단위 테스트 추가, export_graph 우선 |
| **L-2(v15) Miasma / Phantom Gyp wave-2 공급망 포스처** | wave-2(2026-06-16) 재발·확대, Cynapx 트리 0건 재대조, `npm ci`+audit 1차 방어 (**verdict: 추적만, 도달 0건 불변**) | 추적 상태만 갱신(3장) + binding.gyp 검토·lockfile 고정·매 사이클 `npm ls` 재대조 |
| **L-3(v15) MCP stateless transport + task extension 마이그레이션** | SDK v2 RC 존재하나 npm 미배포, 착수 불가 (**verdict: 계속 이연, 상태 불변**) | 범위 제외 — SDK v2 npm 배포까지 이연. P15-3 설계 메모가 출발점 |
| **L-4(v15) IPC MessagePack 직렬화** | 성능 문제 미관측 (**verdict: 계속 보류**) | 범위 제외 — 기록만 유지 |
| **L-5(v15) 클러스터링 본격 서브그래프 파티셔닝** | 현실 규모 무해, 100k+ 노드 실측 시 재검토 (**verdict: 계속 이연**) | 범위 제외 — M-4(v12) count-first 가드가 OOM 방어 |
| **L-6(v15) Node 24 + tree-sitter 빌드 fragility** | node-tree-sitter#268 여전히 open, Node 24 CI 그린 (**verdict: 추적, 상태 불변**) | 추적 상태만 갱신, 본격 대응은 Node 24 LTS 전환 시 |
| **SCIP export(전략 후보)** | `export_graph` 자체가 게이트 단위 테스트 부재 → 신규 포맷 전에 기존 분기 게이트화가 선행 조건 (**verdict: 전략 후보, 즉시 비권장**) | 범위 제외 — **P18-1(export_graph 테스트)이 SCIP의 선행 디딤돌**. protobuf 의존 부담 + install-time 표면 확대 우려로 즉시 착수 비권장 |

---

## 5. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 18-(docs) | diagnostic-v15 + phase18-plan 신규 docs | 1 | 없음 (docs-only) |
| 18-1 | M-1 v15: 6개 도구 디스패처 단위 테스트 추가(export_graph 우선) + diagnostic-v15 [DONE] | 1 | 매우 낮음 (테스트-only, 프로덕션 코드 무변경) |

**총 1~2개 커밋.** 본 사이클은 **v13→Phase16, v14→Phase17의 2연속 content-light 사이클을 깬다** — Phase 17(코드 0)·Phase 16(코드 한 글자)보다 실질이 있되, 프로덕션 동작은 여전히 불변(테스트-only)이라 무위험이다. **이번 사이클의 본질은 (1) 신선한 정밀 교차 대조로 실재 공백 발견 + (2) CI 회귀 안전망 위생 + (3) 추적 상태 고정 + 유지보수 포스처 이월**이다. Phase 18 종료 시 `agent_docs/diagnostic-v15.md`의 M-1 v15에 [DONE] 마킹.

---

## 6. 향후 후보 (Phase 18 범위 밖 — 기록 유지)

- **MCP transport v2 마이그레이션**: SDK v2 stable(Q3 2026 예고, RC 존재하나 npm 미배포) + 2026-07-28 spec final 후 — stateless transport(session-id 제거) + task extension(`tasks/get`/`update`/`cancel`) 전면 채택. L-3 + P15-3 설계 메모가 출발점. **트리거: npm `latest`가 2.x로 전환.**
- **SCIP export**: `export_graph`에 SCIP 포맷 추가 — Sourcegraph/SCIP 생태계 상호운용. **선행 조건: P18-1(export_graph 게이트 단위 테스트) 완료** — 기존 분기가 게이트로 보호된 뒤 신규 포맷 추가가 안전. protobuf 빌드 의존 추가 부담 + install-time 공급망 표면(Miasma류) 확대 우려로 즉시 착수 비권장.
- **L-4 IPC MessagePack**: 성능 실측에서 IPC 직렬화가 병목으로 드러날 때 재검토(현재 미관측).
- **L-5 클러스터링 서브그래프 파티셔닝**: 100k+ 노드 모노레포 실측 시 — 파일/디렉터리 경계 기반 파티셔닝. M-4 count-first 가드가 그때까지 OOM 방어.
- **Node 24 LTS 전환**: tree-sitter 0.25.x prebuild 가용성 + C++20 빌드 환경 확정 후(node-tree-sitter#268 해소 추적).
- **tree-sitter-c-sharp 0.23.6+ 정렬**: ERR_REQUIRE_ASYNC_MODULE 해소 신버전 출현 시 0.23.1 정확 핀 롤백 해제 검토(현재 npm 최신 0.23.5도 미해소).
- **better-sqlite3 12.10.1 정렬**: Electron 전용 no-op 갱신이라 비-긴급 — 다음 정기 의존성 갱신 시 정렬.
