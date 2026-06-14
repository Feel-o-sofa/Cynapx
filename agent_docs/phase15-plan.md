# Phase 15 작업 계획 — diagnostic-v12 대응

> **작성**: 2026-06-14 / **기준 문서**: `agent_docs/diagnostic-v12.md` (기준 커밋 `73aa58d`, Phase 14 완료)
> **목표**: diagnostic-v12가 식별한 MEDIUM 4건(M-1~M-4 v12), LOW 6건(O-1~O-6 v12)을 의존성·리스크 기준으로 P15-1 ~ P15-3의 3개 서브 Phase로 순서화해 처리한다. 계속 보류 판정된 항목(O-3 IPC MessagePack, O-5 클러스터링 본격 파티셔닝, MCP 전면 task lifecycle)은 본 계획에서 제외하고 기록만 유지한다(7장).
>
> **맥락**: 14개 페이즈·~28 커밋의 하드닝 이후 **코드·공급망 양쪽 모두 CRITICAL/HIGH 신규 결함은 0**이다(진단 일자 `npm audit --omit=dev` = 0 vulnerabilities 직접 재검증). 이번 사이클의 본질적 신호는 코드 결함이 아니라 **생태계 변화**(MCP 2026-07-28 RC가 task를 extension으로 강등 + stateless transport)이며, 그 다음이 인덱싱 핫패스의 자원 위생 마감 + 의존성 정렬이다. 따라서 전체 리스크 프로파일은 Phase 14보다도 낮고, 작업량도 작다(예상 **3~5 커밋**).

---

## 0. 작업 원칙

- 각 서브 Phase는 **독립적으로 커밋 가능한 단위**로 쪼갠다 (한 Phase = 1~2개 PR급 커밋).
- 동작 변경(타이머 정리·가드 count-first·grammar 정렬)은 **출력 동등성 또는 명시적 기대값 회귀 테스트**를 동반하지 않으면 완료로 보지 않는다.
- 의존성 변경(M-3 grammar 정렬)은 `npm audit --omit=dev` **0 vulnerabilities 유지** + 언어별 파서 스냅샷 동등성을 객관 검증한 뒤에만 완료로 본다(P14-1 audit 게이트 baseline 불변).
- 파일/모듈이 겹치는 항목은 같은 Phase에 묶는다(M-2/M-4는 인덱싱 핫패스 자원 위생이라 동거).
- 매 Phase 종료 시 `npx vitest run` + `npx tsc --noEmit` 그린 확인 후 커밋. 통합 스크립트(`scripts/integration-test.js`)는 P15-2(grammar 정렬) 종료 시 추가 확인(native 파서 회귀).
- 매 Phase 종료 시 `agent_docs/diagnostic-v12.md`에 [DONE] 마킹.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.**

---

## 1. 의존성 맵 (작업 순서에 영향을 주는 관계)

```
P15-1 (M-2 임베딩 타이머 + M-4 클러스터 가드)   독립 — 가장 먼저(인덱싱 핫패스 자원 위생, 단일 파일급, 저위험)
P15-2 (M-3 tree-sitter grammar 정렬)             독립 — package.json + 스냅샷 회귀. P14-1 audit 게이트 통과 필요(의존 변경)
P15-3 (M-1 MCP 2026-07-28 추적 메모)             문서/주석 only — 코드 동작 무변경. 가장 마지막(미지수 없음, 회귀 위험 0)
```

순서 유연성: P15-1·P15-2는 서로 독립이라 순서 교환 가능. P15-3은 문서/주석 only라 언제 해도 무방하나, 코드 변경 Phase의 회귀 안전망이 깔린 뒤 마지막에 두는 게 깔끔하다.

```
M-1 (MCP transport 함의)  ──추적만──→  [SDK v2 release까지 전면 마이그레이션 이연]
O-3 (IPC MessagePack)     ──계속 보류──
O-5 (클러스터 파티셔닝)    ──계속 이연──
```

---

## 2. Phase 15-1: 인덱싱 핫패스 자원 위생 (M-2 임베딩 타이머 + M-4 클러스터 가드) — 저위험·고가치 `[DONE]`

**목표**: 인덱싱 핫패스의 두 자원 규율 갭을 정리한다. (a) 임베딩 배치 timeout 타이머가 성공 시 clear되지 않아 배치당 2분 dangling 타이머가 누적되는 문제, (b) 클러스터링 대형 그래프 가드가 `getAllNodes()` 풀 로드 **이후**에 판정해 OOM 1차 방어선이 약한 문제. 둘 다 정합성 결함은 아니므로(결과는 올바름) 리스크가 낮고, 인덱싱 자원 거동을 WorkerPool/IPC/session-sweeper의 기존 clear/unref 규율과 정렬한다.

| 항목 | 파일 | 작업 |
|------|------|------|
| M-2 임베딩 배치 타이머 | `src/indexer/embedding-manager.ts:378-394` | `enqueuedBatch`의 `setTimeout` 핸들을 잡아 `Promise.race` 종료 시 `finally`에서 `clearTimeout`(또는 타이머 `.unref()`). 결과 시맨틱(성공/타임아웃 reject)은 불변 — 타이머가 만료 전 GC되지 않고 루프를 붙잡는 문제만 제거. WorkerPool(`worker-pool.ts:154-159`)·IPC keepalive(`ipc-coordinator.ts:184`) 패턴과 동일. |
| M-4 클러스터 count-first 가드 | `src/graph/graph-engine.ts:222-241`, `src/db/node-repository.ts` | `nodeRepo.countNodes()`(단일 `SELECT COUNT(*) FROM nodes`) probe 추가 → `performClustering()` 진입부에서 **그 카운트로 `CYNAPX_CLUSTER_MAX_NODES` 가드를 먼저 판정**하고, 통과 시에만 `getAllNodes()`/`getAllEdges()` 호출. 임계 초과 시 노드 배열을 적재하지 않고 short-circuit(`{clusterCount:0, nodesClustered:0}` + WARN). 기존 P14-4 가드 메시지/반환 형태는 동일하게 유지. |

**테스트** (`tests/embedding-queue.test.ts`·`tests/clustering.test.ts` 확장):
- M-2: fake timer로 배치 성공 후 pending 타이머 수가 0(또는 unref됨)인지 검증; 타임아웃 시 reject 거동 회귀(기존 동작 불변).
- M-4: `getAllNodes`를 spy해 임계 초과 시 **호출되지 않는지**, 임계 이하(기존 테스트)는 정상 진행 + `clusterCount`/노드별 `cluster_id` 기존과 동일한지(P14-4 결정성 테스트 회귀).
- 기존 `embedding-queue`·`clustering` 스위트 전체 그린.

**산출물**: 1개 커밋. **리스크: 낮음** (단일/핫패스 파일, 결과 시맨틱 불변, 자원 거동만 변경).

---

## 3. Phase 15-2: tree-sitter grammar 마이너 정렬 + override 일관화 (M-3 v12)

**목표**: 코어 `tree-sitter@0.25.x`와 grammar 패키지의 메이저 비대칭을 줄인다. (a) 각 native grammar을 최신 마이너로 일괄 정렬, (b) `overrides`의 중첩 `tree-sitter: ^0.25.0` 강제를 현재 5개(c-sharp/cpp/java/kotlin/typescript)에서 **모든** native grammar(rust/php/go/python/c/javascript 포함)로 일관 적용, (c) 정렬 후 언어별 파서 스냅샷 회귀로 노드/에지/CC 동등성 확인. 침묵 파싱 회귀의 잠재 표면(미래 코어 업그레이드 시 노드 누락·CC 오계산)을 선제 차단한다.

| 항목 | 파일 | 작업 |
|------|------|------|
| M-3(1) grammar 마이너 정렬 | `package.json:42-53` | 각 `tree-sitter-*` 의존을 최신 마이너로 갱신(메이저 변경은 회귀 위험이 크면 보류 — 마이너/패치 우선). lockfile 재생성 후 native 재빌드 확인. |
| M-3(2) override 일관 적용 | `package.json:69-89` | 현재 5개 grammar에만 있는 중첩 `tree-sitter: ^0.25.0` override를 **모든 native grammar에 일관 적용**(또는 top-level `tree-sitter: ^0.25.x` 강제로 충분하면 중첩 정리). ABI 통일을 명시적으로 보장. |
| M-3(3) 코어 마이너 | `package.json:41` | `tree-sitter` 코어 `^0.25.0` → npm 최신 마이너(0.25.1) 점검 후 정렬(기능 변화 없으면 채택). |

**테스트** (`tests/parser.test.ts`·`tests/metrics-calculator.test.ts`·`tests/language-registry.test.ts`):
- **언어별 동등성 회귀**: 정렬 전후로 각 언어 fixture의 노드/에지/CC(cyclomatic)/loc 기대값이 동일한지(스냅샷 또는 명시 기대값). 회귀 시 해당 grammar 정렬 롤백.
- `npm audit --omit=dev` **0 vulnerabilities 유지**(신규 grammar 버전이 전이 취약점을 끌어오지 않는지 — P14-1 게이트).
- `npm run build && node scripts/integration-test.js` — native 바인딩·파서 정상(grammar ABI 통일 검증).
- 기존 `parser`·`metrics-calculator`·`language-registry` 스위트 전체 그린.

**산출물**: 1개 커밋. **리스크: 낮음-중간** (의존 변경 + native 재빌드. 언어 파서 출력 동등성 회귀로 다운스트림 영향 차단 필수. grammar별 메이저 점프는 회귀 시 개별 롤백).

---

## 4. Phase 15-3: MCP 2026-07-28 스펙 추적 메모 + 주석 표적 갱신 (M-1 v12) — 문서/주석 only

**목표**: MCP **2026-07-28 RC**가 확정한 두 방향 전환(Tasks core→extension 강등, stateless transport)을 코드 주석·설계 메모로 반영해 SDK v2 업그레이드 시 회귀 표면을 미리 잡아둔다. **코드 동작은 변경하지 않는다** — 전면 task lifecycle 마이그레이션과 stateless transport 전환은 SDK v2 stable(Q3 2026 예고, 현재 `latest`=1.29.0이라 미반영)까지 이연한다. 현재 착수 시 RC 변동으로 재작업 위험이 크기 때문이다.

| 항목 | 파일 | 작업 |
|------|------|------|
| M-1(1) progress/task 주석 표적 갱신 | `src/server/tools/_progress.ts:7-16`, `src/server/tool-dispatcher.ts:208-220`, `src/server/ipc-coordinator.ts:43-58` | "future direction"·SEP-1686 주석이 **2025-11-25판 Tasks**를 가리키는 부분을 **2026-07-28 extension 모델**(server-directed task handle via `tools/call` 응답, `tasks/get`/`update`/`cancel`, `tasks/list` 제거)을 가리키도록 갱신. progress-token opt-in(P14-5 채택)은 RC에서도 유지되므로 **폐기 대상이 아님**을 명시. |
| M-1(2) session-id↔stateless 충돌 설계 메모 | `src/server/api-server.ts:342-384`(주석) + `agent_docs/`(또는 본 계획 참조) | `handleMcp()`의 `mcp-session-id`/`sessionId` 기반 세션 맵·재접속(SEC-H-1)이 stateless RC(`initialize`/`Mcp-Session-Id` 제거, `Mcp-Method`/`Mcp-Name` 라우팅)와 충돌하는 지점을 주석으로 명시 — SDK v2 업그레이드 시 transport 계층 재설계가 필요함을 회귀 안전망으로 기록. **현재 SDK 1.x는 session-id 모델이라 코드 변경 불필요.** |
| M-1(3) 외부 추적 링크 | 위 주석 | 2026-07-28 RC 블로그·SEP-1686 이슈·typescript-sdk#2042 추적 링크 + "SDK v2 release까지 이연" 판정 명시. |

**테스트**:
- 코드 동작 무변경 — 기존 `tests/tool-dispatcher.test.ts`·`tests/phase14-5-progress.test.ts`·`tests/api-server-http.test.ts`·`tests/mcp-server.test.ts` 전체 그린(주석/문서 변경이 동작을 깨지 않음 회귀).
- `npx tsc --noEmit` 그린(주석 변경이 타입을 깨지 않음).

**산출물**: 1개 커밋. **리스크: 매우 낮음** (문서/주석 only, 코드 동작 무변경, 회귀 위험 0).

---

## 5. 보류/이연 항목 판정 (diagnostic-v12 → Phase 15 verdict)

| 항목 | diagnostic-v12 판정 | Phase 15 처리 |
|------|--------------------|---------------|
| **O-3(v12) IPC MessagePack 직렬화** | 성능 문제 미관측, 메시지 작고 round-trip 드묾 (**verdict: 계속 보류**) | 범위 제외 — 기록만 유지 |
| **O-5(v12) 클러스터링 본격 서브그래프 파티셔닝** | 현실 규모 무해, 100k+ 노드 실측 시 재검토 (**verdict: 계속 이연**) | **count-first 가드(M-4)만 P15-1** 채택, 파티셔닝은 이연 |
| **MCP 전면 task lifecycle(2026-07-28 extension)** | RC 미확정 + SDK v2 미반영, 즉시 착수 시 재작업 위험 (**verdict: SDK v2까지 이연**) | **추적 메모만 P15-3**, 전면 마이그레이션은 SDK v2 release 후 별도 Phase |
| **SCIP export 상호운용** | SCIP가 심볼 인덱스 표준화 — Cynapx export 후보 (**verdict: 전략 추적**) | 범위 제외 — 전략 메모만(6.4) |
| **Node 24 + tree-sitter 빌드 fragility(O-6)** | CI 현재 그린, prebuild 가용성 의존 (**verdict: 추적**) | M-3 grammar 정렬 시 Node 24 빌드 부수 확인, 본격 대응은 Node 24 LTS 전환 시 |

---

## 6. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 15-1 `[DONE]` | M-2 임베딩 배치 타이머 위생 + M-4 클러스터 count-first 가드 | 1 | 낮음 (핫패스 자원 위생, 결과 불변) |
| 15-2 | M-3 tree-sitter grammar 마이너 정렬 + override 일관화 | 1 | 낮음-중간 (의존 변경 + 파서 동등성 회귀) |
| 15-3 | M-1 MCP 2026-07-28 추적 메모 + 주석 표적 갱신 (문서/주석 only) | 1 | 매우 낮음 (코드 동작 무변경) |

**총 3~5개 커밋**, P15-1·P15-2는 순서 유연, P15-3은 마지막(문서/주석). Phase 14 대비 **CRITICAL/HIGH 코드·공급망 결함 0**이라 전체 리스크·작업량 모두 더 낮다 — 이번 사이클의 본질은 **인덱싱 핫패스 자원 위생 마감 + 의존성 정렬 + MCP 2026-07-28 생태계 추적**이다. 각 Phase 종료 시 `agent_docs/diagnostic-v12.md`에 [DONE] 마킹.

---

## 7. 향후 후보 (Phase 15 범위 밖 — 기록 유지)

- **MCP transport v2 마이그레이션**: SDK v2 stable(Q3 2026 예고) + 2026-07-28 final 발행 후 — stateless transport(`Mcp-Method`/`Mcp-Name` 라우팅, session-id 제거) + task extension(server-directed handle, `tasks/get`/`update`/`cancel`) 전면 채택. M-1(2)의 설계 메모가 출발점.
- **O-3 IPC MessagePack**: 성능 실측에서 IPC 직렬화가 병목으로 드러날 때 재검토(현재 미관측).
- **O-5 클러스터링 서브그래프 파티셔닝**: 100k+ 노드 모노레포 실측 시 — 파일/디렉터리 경계 기반 파티셔닝(클러스터 품질 트레이드오프 동반). M-4의 count-first 가드가 그때까지 OOM 방어.
- **SCIP export**: `export_graph`에 SCIP 포맷 추가 — Sourcegraph/SCIP 생태계 상호운용(전략 후보).
- **Node 24 LTS 전환**: tree-sitter 0.25.x prebuild 가용성 + C++20 빌드 환경 확정 후(node-tree-sitter#268 해소 추적).
