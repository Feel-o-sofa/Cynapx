# Phase 22 작업 계획 — diagnostic-v19 대응

> **작성**: 2026-06-15 / **기준 문서**: `agent_docs/diagnostic-v19.md` (기준 커밋 `776afca`, Phase 21 + Phase 21-1 + Phase 21-2 완료)
> **목표**: diagnostic-v19가 발견한 **무위험 actionable 1건(M-1 v19)** 을 해소한다. **`src/graph/architecture-engine.ts:179`의 circular-dependency 분기에 있는 사이클-당 `edges.find(...)` O(E) 선형 스캔을 O(1) `Map` 룩업으로 최적화하면서, 동시에 *현 vitest 게이트에 전혀 커버되지 않는* circular-dependency 분기(line 165-185)에 회귀 테스트를 새로 깐다.** 이는 v18이 L-9 (a)로 "비-긴급·추적만" 분류했던 항목을, (b) 잣대(작고·잘-테스트되고·저위험)로 *실제 코드를 읽고* 재판정한 결과 actionable로 승격된 것이다 — 핵심은 이 `edges.find`가 사는 분기가 **미커버**라서, 최적화가 곧 Phase 18~20의 "게이트 격차 메우기"와 동형이 된다는 점이다(최적화만 단독으로 하는 게 아니라, 동작 동일성을 못 박는 회귀 테스트를 함께 깐다). 계속 보류/이연/추적 항목(L-2~L-8 + L-9 잔여 클린업)은 본 계획에서 추적만 갱신하거나 제외하고 기록을 유지한다(4장).
>
> **맥락**: **v15→Phase18(MCP 도구 디스패처 20/20)·v16→Phase19(REST 핸들러 8 분기)·v17→Phase20(FileWatcher 대용량-배치/복구)은 "레지스트리↔테스트↔CI 게이트" 3중 대조를 확장하며 매 사이클 테스트 격차 1건을 해소했다. v18은 그 수확이 L-7/L-8에서 소진됐다고 보고 각도를 dev 공급망(postcss override, P21-1)·문서(README 동기화, P21-2)로 전환해 actionable 2건을 처리했다.** v19는 그 두 actionable마저 소진된 뒤 — "할 일 없음"(v14/Phase17식 content-light)으로 직행하지 않고 — v18이 비-actionable로 추적만 한 L-9 코드 클린업 3건을 *실제 코드를 읽고* (b) 잣대로 재판정했다. 그 결과 **architecture-engine.ts:179 한 건만이 "작고·테스트 동반·저위험" 3조건을 동시에 만족**함을 발견했다: (i) `edges`가 이미 `checkViolations()` 진입부(line 87)에서 fetch돼 있어 Map 한 번 구축이 ~5줄·시그니처 무변경, (ii) 이 `edges.find`가 사는 circular-dependency 분기가 *현 vitest에 미커버*(stub `getOutgoingEdges: () => []`라 `detectCycles()`가 cycle 0개 반환 → line 179 미실행)라 최적화가 곧 게이트 격차 메우기. 나머지(update-pipeline `withWriteTransaction` ~40줄 추출, progress `log.error` 재분류, 빈 catch 2건)는 그 잣대를 못 넘어 비-actionable 추적을 유지한다. 따라서 Phase 22는 **최적화+회귀 게이트 1 서브 페이즈(P22-1) + 추적 갱신**이며, 예상 **2커밋**(diagnostic-v19 + phase22-plan docs 커밋 1 + P22-1 코드+테스트 커밋 1).

---

## 0. 작업 원칙

- 본 계획의 핵심 작업(P22-1)은 **prod 코드 *동작* 무변경 + 시그니처 무변경**이다 — `edges.find(...)`를 동일 결과를 주는 `Map.get(...)`으로 바꿀 뿐(첫 매칭 edge 반환 동일), public API·반환 형태·violation 객체 모양은 한 글자도 안 바뀐다. 변경은 `architecture-engine.ts` 국소(~5줄) + `tests/architecture-engine.test.ts` 신규 회귀 케이스에 한정한다.
- P22-1은 *미커버 분기에 회귀 테스트를 새로 깐다* — 최적화 단독이 아니라, circular-dependency 분기의 동작(위반 emit + `.edge` 채움)을 못 박는 vitest 케이스를 함께 추가해 회귀를 봉쇄한다(Phase 18~20 "게이트 격차 메우기"와 동형).
- Phase 종료 시 `npx vitest run` **593 + 신규 케이스 그린**(circular-dependency 분기가 비로소 실행됨), `npx tsc --noEmit` 그린, `npm audit` 0, `npm audit --omit=dev` 0 확인.
- Phase 종료 시 `agent_docs/diagnostic-v19.md`의 M-1 v19에 [DONE] 마킹.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.**

---

## 1. 의존성 맵 (작업 순서에 영향을 주는 관계)

```
P22-1 (architecture-engine O(E)→O(1) Map + 미커버 circular-dependency 분기 회귀 게이트)   독립.
  └─ checkViolations() circular-dependency 루프 직전에 Map<"from:to", edge> 한 번 구축
        ← edges는 이미 line 87에서 fetch됨(getAllEdges() 재호출 불요)
        ← edgeByPair.set(`${e.from_id}:${e.to_id}`, e) — 첫 매칭 보존(Map.set 마지막 승리 주의: edges.find는 *첫* 매칭이므로 set 시 이미 키 존재하면 skip)
  └─ line 179 edges.find(...) → edgeByPair.get(`${cycle[0]}:${cycle[1]}`)  (동작 동일)
  └─ tests/architecture-engine.test.ts에 회귀 케이스 신규
        ← stub getOutgoingEdges로 A→B→A 사이클 구성 → detectCycles()가 cycle 반환
        ← checkViolations()가 policyId 'circular-dependency' 위반 emit + .edge가 올바른 edge로 채워짐 단언
        ← (현 stub은 getOutgoingEdges: () => [] 라 이 분기 0% 커버 — 신규 케이스가 첫 커버)
  └─ npx vitest run 593+신규 그린 재확인
```

```
L-2 (Miasma / Phantom Gyp — 캠페인 계속 진행)  ──추적만──→  [캠페인 지속·신규 wave 없음; 매 사이클 in-tree `.claude`/`.cursor`/`.gemini`에 SessionStart 훅/외부 스크립트 끼어듦 점검(현재 `.claude/launch.json` 양성) + binding.gyp 검토 + npm ci lockfile 고정 + npm ls 재대조; Cynapx 도달 0건 불변]
L-3 (MCP stateless/task 마이그레이션)  ──이연──→  [SDK v2 npm 정식 배포(Q3 2026 ~7-28 stable 예고)까지 — alpha는 있으나 npm latest 1.29.0]
L-4 (IPC MessagePack)                 ──계속 보류──
L-5 (클러스터 본격 파티셔닝)           ──계속 이연──→  [count-first 가드(200k)가 OOM 방어; 임계 초과 모노레포 실측 시]
L-6 (Node 24 tree-sitter 빌드)         ──추적만──→  [node-tree-sitter#268 해소 + Node 24 LTS 전환 시]
L-7 (admin CLI cmd* 게이트 공백)       ──추적만(비-actionable)──→  [admin.ts 핸들러 export 리팩터 시 함께 게이트화]
L-8 (worker-pool/embedding/migration 잔여 분기)  ──추적만(비-actionable)──→  [SCHEMA_VERSION 증분/worker-pool 리팩터 시 함께 게이트화]
L-9 잔여 클린업 (update-pipeline withWriteTransaction ~40줄; progress log.error 재분류; 빈 catch 2건 log.debug)  ──추적만(비-actionable)──→  [update-pipeline/사이드카 리팩터 시 함께; (b) 잣대 미충족 — 회귀 표면 넓거나/동작 변경/본질 무변경]
SCIP export                           ──전략 후보──→  [P18-1(MCP export) + P19-1(REST export) 디딤돌 마련 완료; protobuf 의존 부담으로 즉시 비권장]
```

---

## 2. Phase 22-1: architecture-engine O(E)→O(1) Map + 미커버 circular-dependency 분기 회귀 게이트 (M-1 v19) — 작고·테스트 동반·저위험 [예정]

**목표**: `checkViolations()`의 circular-dependency 분기(architecture-engine.ts:165-185)에서 사이클-당 `edges.find(...)` O(E) 선형 스캔(line 179)을 한 번 구축한 `Map`의 O(1) 룩업으로 바꾸면서, *현재 vitest에 미커버인* 이 분기에 회귀 테스트를 새로 깐다. **prod 코드 *동작*·시그니처 무변경(동일 결과 + 미커버 분기 게이트 신규).**

| 항목 | 파일 | 작업 |
|------|------|------|
| edge 인덱스 Map 구축 | `src/graph/architecture-engine.ts` (circular-dependency 루프 직전, ~line 165) | circular-dependency 루프 진입 전에 `const edgeByPair = new Map<string, CodeEdge>(); for (const e of edges) { const k = \`${e.from_id}:${e.to_id}\`; if (!edgeByPair.has(k)) edgeByPair.set(k, e); }` 한 번 구축. **`edges.find`는 *첫* 매칭을 반환하므로 `if (!has)` 가드로 첫 매칭만 보존**(set의 last-wins와 다름 — 동작 동일성 보존의 핵심). `edges`는 이미 line 87에서 fetch됨(재호출 불요). |
| O(E) 스캔 → O(1) 룩업 | `src/graph/architecture-engine.ts:179` | `edge: edges.find(e => e.from_id === cycle[0] && e.to_id === cycle[1])!,` → `edge: edgeByPair.get(\`${cycle[0]}:${cycle[1]}\`)!,`. 동작 동일(첫 매칭 edge 반환), 복잡도 O(cycles × E) → O(E + cycles). `!` non-null 단언 유지(기존과 동일 — 사이클 edge는 존재 보장). |
| 미커버 분기 회귀 테스트 | `tests/architecture-engine.test.ts` (신규 `describe`/`it`) | stub GraphEngine을 A→B→A 사이클이 나오도록 구성: `getAllNodes` 2노드(다른 file_path), `getAllEdges` 2 edge[A→B, B→A], `getOutgoingEdges(A)=[A→B]`·`getOutgoingEdges(B)=[B→A]`, `getNodeById` 매핑. `checkViolations()` 호출 → `policyId === 'circular-dependency'` 위반이 emit되고 `.edge`가 올바른 edge 객체로 채워지는지 단언(Map 룩업이 `edges.find`와 동일 결과를 줌을 못 박음). **이 분기는 현 테스트에서 0% 커버(stub `getOutgoingEdges: () => []`)라 신규 케이스가 첫 커버 + O(1) 변경 회귀 봉쇄.** |
| 베이스라인 재확인 | (검증) | `npx vitest run` = **593 + 신규 그린**, `npx tsc --noEmit` 그린, `npm audit` 0·`npm audit --omit=dev` 0(불변). |
| M-1 v19 마킹 | `agent_docs/diagnostic-v19.md` | M-1 v19에 [DONE] + O(1) 변경·미커버 분기 게이트 추가 기록. |

**설계 메모(직접 확인)**:
- `checkViolations()`(line 85)는 진입부에서 `const edges = this.graphEngine.getAllEdges()`(line 87)로 edge를 *이미 한 번* materialize한다. circular-dependency 루프(line 167)는 detectCycles()가 반환한 각 cycle마다 `edges.find`로 그 edge를 재탐색하는데, 이게 사이클-당 O(E) 선형 스캔이다. cycle 수가 작아 실무 무해하나, 같은 `edges`로 Map을 한 번 구축하면 O(1)로 떨어진다.
- **첫-매칭 보존 주의**: `edges.find`는 `(from,to)` 첫 매칭을 반환한다. 같은 `(from,to)` edge가 둘 이상(edge_type만 다름)일 수 있으므로 Map 구축 시 `if (!has) set`으로 *첫* edge만 보존해 `edges.find`와 정확히 동일한 결과를 보장한다(이 디테일이 무위험성의 핵심).
- **미커버 분기**: `tests/architecture-engine.test.ts`의 stub은 `getOutgoingEdges: () => []`라서 `detectCycles()`의 DFS가 outgoing edge를 못 따라가 cycle을 0개 반환한다 → circular-dependency 루프와 line 179가 한 번도 실행되지 않는다(custom-rule 분기만 stub edge로 커버). 신규 케이스가 이 분기를 *처음으로* 실행하므로, O(1) 변경의 회귀를 봉쇄하면서 동시에 Phase 18~20식 게이트 격차를 메운다.
- 패턴: Phase 18-1(디스패처)·19-1(REST)·20-1(FileWatcher)이 "미커버 분기에 게이트 추가"를 한 것과 동형 — 단 본 건은 *동시에* 핫패스 미세 최적화를 안전하게 끼운다(회귀 테스트가 동작 동일성을 못 박으므로).

**테스트**:
- `npx vitest run` 593 + 신규 케이스 그린(circular-dependency 분기가 비로소 실행 + Map 룩업 동작 동일성 단언)이 1차 검증 산출물.
- `npx tsc --noEmit` 그린, `npm audit` 0/0(불변).

**산출물**: 1개 커밋(`architecture-engine.ts` + `tests/architecture-engine.test.ts` + diagnostic-v19 [DONE]). **리스크: 매우 낮음**(국소 ~5줄 변경 + 동작 동일성을 못 박는 신규 회귀 테스트 동반, 시그니처·public API·반환 형태 무변경. 최악의 경우 첫-매칭 보존 누락이나 `if (!has) set` 가드로 봉쇄).

---

## 3. 보류/이연 항목 판정 (diagnostic-v19 → Phase 22 verdict)

| 항목 | diagnostic-v19 판정 | Phase 22 처리 |
|------|--------------------|---------------|
| **M-1 v19 architecture-engine O(E)→O(1) + 미커버 분기 게이트** | edges.find O(E) 스캔이 국소·~5줄·시그니처 무변경 + circular-dependency 분기가 vitest 미커버 → 최적화가 곧 게이트 격차 메우기 (**verdict: actionable, 작고·테스트 동반·저위험**) | **P22-1에서 해소** — Map O(1) 룩업 + circular-dependency 분기 회귀 테스트 신규 |
| **L-9 잔여: update-pipeline `withWriteTransaction()` 추출(~40줄)** | 트랜잭션 경계 5곳 전부 재작성이라 회귀 표면 넓음(데이터 무결성 핵심) → "작은 변경" 조건 위반 (**verdict: 비-actionable, 추적만**) | 범위 제외 — update-pipeline 리팩터 페이즈로 묶어 처리 후보 |
| **L-9 잔여: progress `log.error` 재분류 + 빈 catch 2건** | 로그 레벨 재분류는 관측 동작 변경 + brittle 로그 단언, 빈 catch silent-drop은 의도적 방어라 본질 무변경 (**verdict: 비-actionable, 추적만**) | 범위 제외 — 사이드카/update-pipeline 리팩터 시 함께 |
| **L-2(v19) Miasma / Phantom Gyp 포스처** | 캠페인 계속 진행 중·신규 wave 없음, Cynapx 트리·in-tree 설정 0건 재대조 (**verdict: 추적만, 도달 0건 불변**) | 추적 상태만 갱신(5장) + binding.gyp 검토·lockfile 고정·`npm ls` + in-tree 에이전트 설정 무결성 점검 |
| **L-3(v19) MCP stateless/task 마이그레이션** | SDK v2 alpha 존재하나 npm 정식 미배포(latest 1.29.0, Q3 ~7-28 stable 예고) (**verdict: 계속 이연, 상태 불변**) | 범위 제외 — SDK v2 npm 배포까지 이연. P15-3 설계 메모가 출발점 |
| **L-4(v19) IPC MessagePack 직렬화** | 성능 문제 미관측 (**verdict: 계속 보류**) | 범위 제외 — 기록만 유지 |
| **L-5(v19) 클러스터링 본격 파티셔닝** | 현실 규모 무해, count-first 가드(200k)가 OOM 방어 (**verdict: 계속 이연**) | 범위 제외 — 100k+ 노드 실측 시 |
| **L-6(v19) Node 24 + tree-sitter 빌드** | node-tree-sitter#268 여전히 open·미해결, Node 24 CI 그린 (**verdict: 추적, 상태 불변**) | 추적 상태만 갱신, 본격 대응은 Node 24 LTS 전환 시 |
| **L-7(v19) admin CLI cmd* 게이트 공백** | `cmd*` 미-export, 프로덕션 리팩터 수반 (**verdict: 추적만, 비-actionable**) | 범위 제외 — admin.ts 핸들러 export 리팩터 시 함께 게이트화 |
| **L-8(v19) worker-pool/embedding/migration 잔여 분기** | 인접 분기 게이트 커버 + 롤백 픽스처/타이밍-flaky 위험 (**verdict: 추적만, 비-actionable**) | 범위 제외 — SCHEMA_VERSION 증분/worker-pool 리팩터 시 함께 게이트화 |
| **SCIP export(전략 후보)** | MCP `export_graph`(P18-1) + REST `/api/graph/export`(P19-1) 디딤돌 마련 완료 (**verdict: 전략 후보, 즉시 비권장**) | 범위 제외 — protobuf 의존 부담으로 즉시 착수 비권장 |

---

## 4. 유지보수 모드 포스처 ("정기 점검" 이월)

P22-1 외에는 21 페이즈 이후의 성숙도가 유지되므로, 다음을 정기 점검 항목으로 이월한다:

1. **공급망 위생(매 사이클)**: **prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0** 유지(P21-1 postcss override로 dev 트리도 clean). 신규 advisory 시 `overrides`로 패치 floor 못 박기(fast-uri/qs/hono/postcss 패턴). **의존 추가 시 binding.gyp 검토**(Miasma/Phantom Gyp) + CI는 `npm ci`(lockfile 고정)만 + 매 사이클 `npm ls`로 컴프로마이즈 패밀리 트리 진입 재대조(현재 0건) + **매 사이클 in-tree `.claude`/`.cursor`/`.gemini` 설정에 SessionStart 훅/외부 `setup.mjs`/원격 스크립트 끼어듦 점검**(현재 `.claude/launch.json` 양성).
2. **MCP SDK v2 npm 배포 모니터링**: npm `latest`가 2.x로 넘어가면(현재 1.29.0, Q3 ~7-28 stable 예고) L-3(stateless transport + task extension 마이그레이션)이 비로소 actionable. 그 전까지 1.29.0 유지가 정답.
3. **런타임 수명주기**: Node 22 LTS(2027-04 종료)·tree-sitter 코어/grammar 신버전·tree-sitter-c-sharp 0.23.6+(ERR_REQUIRE_ASYNC_MODULE 해소) 출현 시 정렬 재검토. Node 24 LTS 전환은 node-tree-sitter#268 해소 후. better-sqlite3 12.10.1은 다음 정기 갱신 시 정렬(비-긴급).
4. **회귀 안전망·문서 위생**: 새 도구/REST 라우트/이벤트 핸들러/포맷/**미커버 분기** 추가·발견 시 디스패처-레벨 또는 supertest/단위-레벨 vitest 케이스를 함께 추가(P18-1→P19-1→P20-1→**P22-1** 확장)해 CI 게이트 유지 + README/GUIDE 동기화 동반(P21-2). admin CLI(L-7)·worker-pool/migration(L-8)·L-9 잔여 클린업은 핸들러 export/SCHEMA_VERSION 증분/리팩터 시 함께 처리.

---

## 5. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 22-(docs) | diagnostic-v19 + phase22-plan 신규 docs | 1 | 없음 (docs-only) |
| 22-1 **[예정]** | M-1 v19: architecture-engine.ts:179 `edges.find` O(E) → `Map` O(1) + 미커버 circular-dependency 분기 회귀 테스트 신규 + diagnostic-v19 [DONE] — 593+신규 그린, tsc 그린, audit 0/0(불변) | 1 | 매우 낮음 (국소 ~5줄·시그니처 무변경·동작 동일 + 회귀 테스트가 동작 동일성 못 박음) |

**총 2개 커밋.** 본 사이클은 **v18의 두 actionable(dev 공급망·문서)마저 소진된 지점에서, "할 일 없음"으로 직행하지 않고 v18이 비-actionable로 추적만 한 L-9 코드 클린업을 (b) 잣대로 *실제 코드를 읽고* 재판정**한 데서 나온다 — prod 코드는 steady-state(CRITICAL/HIGH 0, prod·dev audit 0/0, TODO 0, 핫패스 quadratic 0, god-module 0) 확인이 핵심 결론이며, 그 재판정에서 한 건(architecture-engine.ts:179)이 "작고·테스트 동반·저위험" 3조건을 동시에 만족(미커버 분기라 최적화가 곧 게이트 격차 메우기)함을 정직하게 포착했다. **이번 사이클의 본질은 (1) 반사적 전부-이연도·억지 prod 변경도 아닌 정직한 중간 판정 + (2) 핫패스 미세 최적화(O(E)→O(1))를 회귀 테스트로 안전하게 끼우기 + (3) 미커버 circular-dependency 분기 게이트 격차 메우기(Phase 18~20 패턴 계승) + (4) 추적 상태 고정(L-9 잔여 비-actionable + Miasma/SDK v2 포스처)**이다. Phase 22 종료 시 `agent_docs/diagnostic-v19.md`의 M-1 v19에 [DONE] 마킹.

---

## 6. 향후 후보 (Phase 22 범위 밖 — 기록 유지)

- **MCP transport v2 마이그레이션**: SDK v2 stable(Q3 2026 ~7-28 예고, alpha는 npm 정식 미배포) + spec final 후 — stateless transport(session-id 제거) + task extension 전면 채택. L-3 + P15-3 설계 메모가 출발점. **트리거: npm `latest`가 2.x로 전환.**
- **SCIP export**: `export_graph`(+ REST `/api/graph/export`)에 SCIP 포맷 추가 — Sourcegraph/SCIP 생태계 상호운용. **선행 조건: P18-1 + P19-1 디딤돌 마련 완료.** protobuf 빌드 의존 + install-time 공급망 표면 확대 우려로 즉시 비권장.
- **L-9 잔여 클린업**: update-pipeline `withWriteTransaction()` 추출(~40줄 dedup, 트랜잭션 경계 5곳 재작성 — 회귀 표면 넓어 update-pipeline 리팩터 페이즈로), update-pipeline progress `log.error` → `info`/`debug` 재분류 + 빈 catch(embedding-manager.ts:184, api-server.ts:625)에 `log.debug` 추가(사이드카/observability 리팩터 시 함께). 셋 다 (b) 잣대(작고·테스트 가능·저위험) 미충족으로 본 사이클 비-actionable.
- **bootstrap 엔트리 게이트화**: `process.exit`/시그널/IPC 광범위 모킹 또는 엔트리 분해 리팩터 수반 — 별도 리팩터 페이즈로(의존 프리미티브는 이미 게이트 커버).
- **admin CLI 게이트화(L-7)**: `admin.ts`의 `cmd*` 핸들러 export 분리 리팩터 동반 시 status/list/inspect/doctor 등 비-파괴 명령부터 vitest 게이트 추가.
- **worker-pool/embedding/migration 게이트화(L-8)**: SCHEMA_VERSION 증분(롤백 픽스처 인프라 동반) 또는 worker-pool 리팩터 시 함께. A-7은 fake-timer flaky 위험으로 신중히.
- **L-4 IPC MessagePack**: 성능 실측에서 IPC 직렬화가 병목으로 드러날 때 재검토(현재 미관측).
- **L-5 클러스터링 서브그래프 파티셔닝**: 100k+ 노드 모노레포 실측 시 — 파일/디렉터리 경계 기반. count-first 가드(200k)가 그때까지 OOM 방어.
- **Node 24 LTS 전환**: tree-sitter 0.25.x prebuild 가용성 + C++20 빌드 환경 확정 후(node-tree-sitter#268 해소 추적).
- **tree-sitter-c-sharp 0.23.6+ / better-sqlite3 정렬**: 신버전 출현·다음 정기 의존성 갱신 시.
- **README_KR/GUIDE 동기화**: P21-2가 README.md(영문 진입점)를 정정했으므로, 동일 격차가 있으면 README_KR.md/GUIDE_EN.md/GUIDE_KR.md도 다음 docs 사이클에 정렬.
