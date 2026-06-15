# Phase 25 작업 계획 — diagnostic-v22 대응

> **작성**: 2026-06-15 / **기준 문서**: `agent_docs/diagnostic-v22.md` (기준 커밋 `1de6f09`, Phase 24 + Phase 24-1/24-2 완료)
> **목표**: diagnostic-v22가 발견한 **무위험 actionable 2건(M-1 v22, M-2 v22)** 을 해소한다. **M-1 v22**: `RefactoringEngine.proposeRefactor()`(BFS traverse + `calculateRisk` 4-티어 + `getRiskReasons` 6-분기 + `generateSteps` risk-별 분기)가 0% 커버 → `tests/refactoring-engine.test.ts`가 *이미 보유한* `createInMemoryEngine()`(edgeRepo 포함)·`makeNode()` 하니스 + P24-1이 확립한 `edgeRepo.createEdge()` 엣지-셋업 패턴으로 게이트(테스트-only, prod 코드 무변경). **M-2 v22**: `search-symbols.ts` 핸들러가 스키마-`required` 인자 `query`를 *전혀 검증하지 않아* `node-repository.ts:299`의 `query.replace(...)`에서 undefined-크래시 가능 → 형제 핸들러(`analyze-impact:12`)와 동형의 string-required 가드 추가(~3줄) + 잘못된 인자 → isError 게이트. 두 건은 *서로 독립*(다른 파일·다른 부류)이나 둘 다 작고(M-1 테스트-only, M-2 ~3줄) 리스크가 매우 낮아 한 사이클에 함께 처리 가능하다. 계속 보류/이연/추적 항목(L-2~L-13)은 추적만 갱신한다(4장).
>
> **맥락**: v20/v21은 graph/ 엔진 처방 5종 중 4종+PolicyDiscoverer를 P23-1/2/3·P24-1로 게이트화하고 **`proposeRefactor()`를 "incoming 의존 트리 엣지 픽스처 무겁다"며 L-10으로 축소-추적**했다. v22는 *그 이연 판정을 재검증*했다 — P24-1이 `tests/policy-discoverer.test.ts`에서 `edgeRepo.createEdge({from_id,to_id,edge_type})`로 엣지를 심는 패턴을 확립했고, *결정적으로 `tests/refactoring-engine.test.ts` 자체가 이미 그 하니스(edgeRepo 반환 포함)를 보유*하므로, "픽스처 무겁다"던 판정이 *그 파일에 incoming 엣지만 추가하면 가벼워졌다*. 더해, M-2 v21의 "검증 인자명 vs 호출 인자명" 대조를 *20개 등록 도구 전부*에 전수 적용해, dead-validation 부류(검증=틀린 인자명)는 0건이나 그 *역* 부류(스키마-required 인자가 검증 0건)인 `search-symbols` `query` 무검증(M-2 v22)을 발굴했다. 둘 다 prod 코드 변경이 0줄(M-1, 테스트-only)이거나 ~3줄(M-2, 가드 추가)이라 리스크가 매우 낮다. 따라서 Phase 25는 **proposeRefactor 게이트(P25-1) + search-symbols `query` 검증(P25-2) + 추적 갱신**이며, 예상 **2~3커밋**(diagnostic-v22 + phase25-plan docs 커밋 1 + P25-1 커밋 1 + P25-2 커밋 1, 또는 P25-1·P25-2 합본).

---

## 0. 작업 원칙

- P25-1은 **prod 코드 무변경**(테스트-only) — `RefactoringEngine.proposeRefactor()`는 `GraphEngine` 1개 의존이며, `tests/refactoring-engine.test.ts`가 *이미* `createInMemoryEngine()`(`:memory:` DB + schema.sql vec0 필터 + NodeRepository/EdgeRepository/GraphEngine) → `new RefactoringEngine(engine)`를 보유한다(line 26-77). 노드 N개 + `edgeRepo.createEdge()`로 incoming 엣지 N개만 추가하면 `traverse('incoming')`가 impact 배열을 내고 risk/reasons/steps를 결정적으로 게이트.
- P25-2는 **prod 코드 ~3줄 변경**(`search-symbols.ts` 상단에 `query` 가드 추가) — `if (typeof args.query !== 'string' || args.query.trim() === '') return {isError, ...}`. 시그니처·반환 형태·정상 경로 동작은 무변경(잘못된 인자에서만 isError로 분기). **선행: `node-repository.ts:299`의 `searchSymbols`가 첫 줄에서 `query.replace`를 호출함을 재확인**(diagnostic-v22 §3 인용 — 실제 소스를 따름).
- Phase 종료 시(P25-1·P25-2) `npx vitest run` **618 + 신규 케이스 그린**, `npx tsc --noEmit` 그린, `npm audit` 0, `npm audit --omit=dev` 0 확인.
- Phase 종료 시 `agent_docs/diagnostic-v22.md`의 M-1 v22·M-2 v22에 [DONE] 마킹.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.** (`.git/info/exclude`에 이미 등록 — `git status --short`는 항상 깨끗해야 한다.)
- 한 사이클(1~2 항목) 제한 원칙에 따라, **P25-1·P25-2는 둘 다 작고(테스트-only / ~3줄) 리스크가 낮아 한 작업 단위로 묶거나 2커밋으로 나눠도 무방**. 둘은 서로 독립(다른 파일·다른 부류)이라 순서 무관.

---

## 1. 의존성 맵

```
P25-1 (RefactoringEngine.proposeRefactor() 로직 게이트 — 테스트-only)   독립.
  └─ tests/refactoring-engine.test.ts 에 신규 describe 블록 추가
        ← 같은 파일의 createInMemoryEngine()(edgeRepo 포함)·makeNode() 하니스 재사용(line 26-57)
        ← edgeRepo.createEdge({from_id: caller, to_id: target, edge_type})로 incoming 엣지 N개 셋업
        ← proposeRefactor(qname) → RefactoringProposal 단언(risk·impactedNodeCount·reasons·steps)
        ← prod 코드 무변경

P25-2 (search-symbols.ts query 검증 추가 — ~3줄)   독립.
  └─ src/server/tools/search-symbols.ts 상단에 query string-required 가드
  └─ tests/tool-dispatcher.test.ts(또는 핸들러 직접 테스트)에 query:undefined / query:123 → isError 케이스 추가
```

```
L-2 (Miasma / Phantom Gyp / Node-gyp)    ──추적만──→  [`npm ls` + in-tree 에이전트 설정 무결성 재대조; 도달 0건 불변]
L-3 (MCP stateless/task 마이그레이션)     ──이연──→  [SDK v2 여전히 pre-alpha; sdk 1.29.0 불변; stable Q3 2026 전환까지]
L-4 (IPC MessagePack)                     ──계속 보류──
L-5 (클러스터 본격 파티셔닝)               ──계속 이연──→  [100k+ 노드 실측 시]
L-6 (Node 24 tree-sitter 빌드)            ──추적만──→  [node-tree-sitter#268 해소 + Node 24 LTS 전환 시]
L-7 (admin CLI cmd* 게이트 공백)           ──추적만(비-actionable)──
L-8 (worker-pool/embedding/migration 잔여)──추적만(비-actionable)──
L-9 (update-pipeline 클린업 잔여)          ──추적만(비-actionable)──
L-10 (proposeRefactor 게이트 잔여)         ──[해소 — M-1 v22로 승격, P25-1에서 처리]──
L-11 (better-sqlite3 lockfile 12.10.0)    ──재개방──→  [다음 의존성 정렬 사이클 `npm i better-sqlite3@12.10.1`]
L-12 (문서 Node 버전 드리프트)            ──[해소 — P24-2 검증, 4개 문서 전부 ≥ 22]──
L-13 (analyze-impact use_cache 무해)       ──추적만(비-actionable)──
```

---

## 2. Phase 25-1: RefactoringEngine.proposeRefactor() 로직 게이트 (M-1 v22) [예정]

**목표**: `src/graph/refactoring-engine.ts`의 `proposeRefactor(qualifiedName)`(line 64-85)는 라이브 MCP 도구 `propose_refactor` 뒤에 있으나 *0% 커버*다(`tests/refactoring-engine.test.ts`는 `getRiskProfile()`만 게이트, line 14에 "proposeRefactor() (BFS traverse) is out of scope" 명시). 미커버 로직(null-노드 경로·BFS traverse impact 수집·`calculateRisk` 4-티어·`getRiskReasons` 6-분기·`generateSteps` risk-별 분기)을 결정적으로 게이트한다. **prod 코드 무변경**(테스트-only).

| 미커버 분기 (소스 라인) | 로직 | 게이트 케이스 |
|------------------------|------|---------------|
| line 65-66 | `getNodeByQualifiedName` null 또는 `id === undefined` → null 반환 | 존재하지 않는 qname → `proposeRefactor()` null 단언 |
| line 68-72 | `traverse(node.id, 'BFS', {direction:'incoming', maxDepth:5})` impact 수집 | incoming 엣지 N개를 심은 노드 → `impactedNodeCount === N`(또는 transitive 합) 단언 |
| line 92-95 (`calculateRisk`) | 4-티어: `fanIn>=50\|\|cyc>=30\|\|impact>=100`→CRITICAL; `>=20\|\|>=15\|\|>=30`→HIGH; `>=5\|\|>=8\|\|>=10`→MEDIUM; else LOW | 각 티어 경계값으로 노드 셋업(예: fan_in=50→CRITICAL, fan_in=20→HIGH, fan_in=5→MEDIUM, 0→LOW) → `risk` 단언 |
| line 99-108 (`getRiskReasons`) | 6-분기: fanIn>20·cyc>15·impact>30·tag `trait:entrypoint`·`layer:core`·`layer:data` + 빈 경우 fallback("Low complexity and coupling.") | 각 분기 트리거 노드 → `reasons` 배열에 해당 문자열 포함 단언; 무-트리거 → fallback 단언 |
| line 117-126 (`generateSteps`) | risk-별: CRITICAL/HIGH→Abstraction+Incremental; MEDIUM→Preparation; + impact.slice(0,3) 보간 | CRITICAL 케이스 → steps에 "Branch by Abstraction" 포함; MEDIUM → "Ensure unit tests" 포함; impact 상위 3개 qname 보간 확인 |

| 항목 | 파일 | 작업 |
|------|------|------|
| 신규 describe 블록 | `tests/refactoring-engine.test.ts` (기존 파일에 추가) | 기존 `createInMemoryEngine()`(line 26-40, edgeRepo 반환)·`makeNode()`(line 42-57) 하니스 *그대로 재사용*. `new RefactoringEngine(engine)` 인스턴스화(기존 `beforeEach` 재사용 또는 신규 describe). |
| null-노드 케이스 | (위 파일) | 존재하지 않는 qname → `proposeRefactor()`가 null 반환(line 65-66). |
| CRITICAL/HIGH/MEDIUM/LOW 케이스 | (위 파일) | `makeNode`로 fan_in/cyclomatic을 4-티어 경계값으로 셋업 + `edgeRepo.createEdge({from_id: callerN, to_id: target, edge_type: 'calls'})`로 incoming 엣지를 심어 impact 카운트 → `risk` 단언. **note: impact-기반 티어(`impact>=100/30/10`)는 엣지 다수 셋업이 무거우므로, 우선 fan_in/cyclomatic-기반 티어로 risk를 결정적으로 게이트하고 impact는 작은 수(엣지 1~2개)로 `impactedNodeCount` 단언만.** |
| reasons 6-분기 케이스 | (위 파일) | fan_in>20·cyclomatic>15 노드 + `tags:['trait:entrypoint']`/`['layer:core']`/`['layer:data']` 노드 각각 → `reasons` 포함 문자열 단언; 무-트리거 노드 → "Low complexity and coupling." fallback 단언. |
| steps risk-별 케이스 | (위 파일) | CRITICAL/HIGH 노드 → steps에 "Branch by Abstraction"·"Abstraction" 포함; MEDIUM 노드 → "Ensure unit tests" 포함; impact.slice(0,3) qname 보간 확인. |
| 베이스라인 재확인 | (검증) | `npx vitest run` 618 + 신규 그린, `npx tsc --noEmit` 그린, `npm audit` 0·`npm audit --omit=dev` 0. |
| M-1 v22 마킹 | `agent_docs/diagnostic-v22.md` | M-1 v22에 `[DONE]` + 신규 케이스 수 기록. |

**설계 메모**:
- `RefactoringProposal`(`symbol`/`risk`/`impactedNodeCount`/`reasons`/`steps`)는 `src/graph/refactoring-engine.ts:11`에서 export — import해 단언.
- `edgeRepo.createEdge({from_id, to_id, edge_type})` 시그니처는 `src/db/edge-repository.ts:53` 확인(`from_id`/`to_id`/`edge_type` + optional `dynamic`/`call_site_line`). incoming 엣지는 *target을 `to_id`로* 심는다(traverse `direction:'incoming'`은 `getIncomingEdges(to_id)` → `from_id`로 확장, graph-engine.ts:617).
- `getNodeByQualifiedName`로 노드 조회가 일어나므로 노드는 반드시 `makeNode`(=`createNode`)로 실제 in-memory DB에 심어야 한다(stub 불가).
- risk 티어는 `||` 조건이라 *하나의 메트릭*만으로 결정 가능(예: `fan_in=50`이면 impact 0이어도 CRITICAL) → 케이스 설계가 가볍다. impact-기반 상위 티어(`impact>=100`)는 엣지 100개 셋업이 무거우므로 *우선순위 낮춤* — fan_in/cyclomatic으로 티어를 게이트하고 impact는 작은 수로 카운트만 단언.
- `getRiskReasons`는 fan_in>20·cyc>15·impact>30·tag 3종이 *독립 push*라 한 노드에 여러 트리거를 겹쳐 다중-reason 케이스도 가능.

**테스트**: `npx vitest run` 618 + 신규(>=6) 그린이 1차 검증 산출물. `npx tsc --noEmit` 그린, `npm audit` 0/0.

**산출물**: `tests/refactoring-engine.test.ts`(신규 describe 블록) + diagnostic-v22 M-1 [DONE]. **리스크: 매우 낮음**(테스트-only, prod 코드 0줄, *동일 파일* 하니스 재사용). **이로써 처방 엔진 진입 로직(architecture/optimization/remediation/refactoring getRiskProfile+proposeRefactor/policy) 전부 회귀 게이트 커버 완성.**

---

## 3. Phase 25-2: search-symbols.ts query 인자 검증 추가 (M-2 v22) [예정]

**목표**: `src/server/tools/search-symbols.ts`는 `limit`만 클램프(line 14)하고 스키마-`required` 인자 `query`(`tool-dispatcher.ts:62-68`, `required:["query"]`+`type:"string"`)를 *전혀 검증하지 않은 채* `nodeRepo.searchSymbols(args.query, ...)`(line 18)·`embeddingProvider.generate(args.query)`(line 21)로 직접 전달한다. `node-repository.ts:299`의 `searchSymbols`는 *첫 줄에서 `query.replace(/[*"']/g, '').trim()`*를 호출하므로 `args.query`가 `undefined`/비-문자열이면 `TypeError`로 크래시한다(`Promise.allSettled` reject로 잡히나 `EngineNotReadyError`가 아니라 O-12 가드를 통과 못 함 → misleading 빈 success 또는 throw 전파). 형제 핸들러(`analyze-impact:12` 등)와 동형의 가드를 추가한다.

| 항목 | 파일 | 작업 |
|------|------|------|
| query 가드 추가 | `src/server/tools/search-symbols.ts` (line 14 `limit` 클램프 직전 또는 직후, contexts 조회 *전*) | `if (typeof args.query !== 'string' || args.query.trim() === '') { return { isError: true, content: [{ type: 'text', text: 'Invalid argument: query must be a non-empty string.' }] }; }` 추가(~3줄, `analyze-impact.ts:12-14`과 동형). 정상 경로·시그니처·반환 형태 무변경 — 잘못된 인자에서만 isError 분기. |
| 핸들러/디스패처 게이트 | `tests/tool-dispatcher.test.ts` (또는 핸들러 직접 테스트) | `search_symbols`를 (1) `query` 누락(undefined) → isError + "non-empty string", (2) `query: 123`(비-문자열) → isError, (3) `query: ''`(빈 문자열) → isError, (4) 유효 `query` → 정상(isError 아님) 케이스 추가. **note: 가드가 contexts 조회 전이므로 엔진 주입 없이도 (1)~(3) 검증 가능 — 형제 `analyze-impact` 핸들러 테스트 패턴 참고.** |
| 베이스라인 재확인 | (검증) | `npx vitest run` 618 + 신규(>=3) 그린, `npx tsc --noEmit` 그린, `npm audit` 0/0. |
| M-2 v22 마킹 | `agent_docs/diagnostic-v22.md` | M-2 v22에 `[DONE]` + 가드 추가·케이스 수 기록. |

**설계 메모**:
- 검증 순서: 가드를 *contexts 조회(line 15) 전*에 두면 엔진 상태 무관하게 즉시 isError → 테스트가 가볍다. `analyze-impact`는 ctx 체크 *후* 인자 검증이나 — search-symbols는 인자가 ctx보다 선행해도 무방(인자 검증이 더 싸므로 먼저 빠르게 reject).
- `limit`는 이미 `Math.min(Math.max(Math.floor(args.limit) || 10, 1), 200)`로 클램프돼 NaN/음수 안전(O-1/M4) — `query`만 가드 누락이었음.
- `args.symbol_type`/`args.semantic`은 optional이고 다운스트림 undefined-안전(undefined symbol_type → 필터 미적용; falsy semantic → keyword-only) → 추가 가드 불필요.

**테스트**: `npx vitest run` 618 + 신규(M-1 >=6 + M-2 >=3) 그린이 1차 검증 산출물. `npx tsc --noEmit` 그린, `npm audit` 0/0.

**산출물**: `src/server/tools/search-symbols.ts`(~3줄) + `tests/tool-dispatcher.test.ts`(신규 케이스) + diagnostic-v22 M-2 [DONE]. **리스크: 매우 낮음**(가드 추가 — 정상 경로 동작 무변경, 잘못된 인자에서만 isError 추가, 형제 핸들러와 동형).

---

## 4. 보류/이연 항목 판정 (diagnostic-v22 → Phase 25 verdict)

| 항목 | diagnostic-v22 판정 | Phase 25 처리 |
|------|--------------------|---------------|
| **M-1 v22 proposeRefactor 로직 게이트** | 라이브 도구 뒤 0% 커버, P24-1 엣지-셋업 + 동일 파일 하니스로 가벼움 (**verdict: actionable, 테스트-only**) | **P25-1에서 해소** |
| **M-2 v22 search-symbols query 무검증** | 스키마-required string 인자 검증 0건, `query.replace` undefined 크래시 경로 (**verdict: actionable, ~3줄**) | **P25-2에서 해소** |
| **L-2 Miasma / Phantom Gyp / Node-gyp 포스처** | 캠페인 진행 중, Cynapx 도달 0건 재대조 (**verdict: 추적만**) | 추적 상태만 갱신 — `npm ls` + in-tree 설정 재점검 |
| **L-3 MCP stateless/task 마이그레이션** | SDK v2 *여전히 pre-alpha*, sdk 1.29.0 불변, v1.x production 권장 (**verdict: 계속 이연**) | 범위 제외 — v2 stable(Q3 2026) 전환 시 |
| **L-4 IPC MessagePack** | 성능 문제 미관측 (**verdict: 계속 보류**) | 범위 제외 |
| **L-5 클러스터링 본격 파티셔닝** | count-first 가드(200k) OOM 방어 (**verdict: 계속 이연**) | 범위 제외 |
| **L-6 Node 24 tree-sitter 빌드** | node-tree-sitter#268 여전히 open (**verdict: 추적**) | 추적 상태만 갱신 |
| **L-7 admin CLI cmd* 게이트 공백** | 모듈-private, 리팩터 수반 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-8 worker-pool/embedding/migration 잔여** | 인접 분기 커버 + flaky 위험 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-9 update-pipeline 클린업 잔여** | (b) 잣대 미충족 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-10 proposeRefactor 게이트 잔여** | P24-1 패턴 + 동일 파일 하니스로 가벼워짐 (**verdict: 해소 — M-1 v22로 승격**) | **P25-1로 처리(L-10 추적 종료)** |
| **L-11 better-sqlite3 lockfile 12.10.0 재드리프트** | v21 12.10.1 정렬 후 12.10.0으로 되돌아옴, patch-level (**verdict: 재개방, 추적**) | 다음 의존성 정렬 사이클 — `npm i better-sqlite3@12.10.1` |
| **L-12 문서 Node 버전 드리프트** | 4개 문서 전부 ≥ 22 정렬 확인 (**verdict: 해소 — P24-2 검증**) | 추적 종료 |
| **L-13 analyze-impact use_cache 무해** | 스키마-default 핸들러 미강제, 캐시 비활성=느려질 뿐 (**verdict: 추적만, 비-actionable**) | 범위 제외 |

---

## 5. 유지보수 모드 포스처 ("정기 점검" 이월)

1. **공급망 위생(매 사이클)**: prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0 유지. 신규 advisory 시 `overrides`로 패치 floor. 의존 추가 시 binding.gyp 검토 + `npm ci` + 매 사이클 `npm ls`/in-tree `.claude`/`.cursor`/`.gemini` 설정 재대조(현재 `.claude/launch.json` 양성, 0건). **lockfile patch-level 드리프트(L-11) 정기 정렬.**
2. **MCP SDK v2 stable 배포 모니터링**: `@modelcontextprotocol/sdk` latest가 *여전히 1.29.0*(v2 pre-alpha). 2.x로 전환(또는 v2 stable Q3 2026)되면 L-3 actionable화. 그 전까지 핀 `^1.29.0` 유지.
3. **런타임 수명주기**: Node 22 LTS·tree-sitter 신버전·tree-sitter-c-sharp 0.23.6+ 출현 시 정렬. Node 24 LTS 전환은 node-tree-sitter#268 해소 후. **문서 Node 버전(L-12 해소)은 코드와 동기화 유지.**
4. **회귀 안전망·핸들러 위생**: 새 도구/REST 라우트/이벤트 핸들러/**엔진 비즈니스 로직/핸들러 인자 검증**의 미커버·불일치 발견 시 vitest 케이스 추가(P18-1→P19-1→P20-1→P22-1→P23-1/2/3→P24-1→**P25-1/2** 확장). **P25-1로 처방 엔진 진입 로직 전부 회귀 게이트 커버 완성**(잔여 graph/ 엔진 게이트 공백 0). **도구 핸들러 인자명↔엔진 호출 인자명 + 스키마-required 인자의 핸들러 검증 유무 대조를 정기 점검 항목에 유지**(P25-2가 그 역-부류 마지막 격차를 메움 — 20개 도구 전수 후 dead-validation 0건·미검증-required 0건 달성 예정).

---

## 6. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 25-(docs) | diagnostic-v22 + phase25-plan 신규 docs | 1 | 없음 (docs-only) |
| 25-1 [예정] | M-1 v22: `tests/refactoring-engine.test.ts`에 `proposeRefactor()` 게이트(동일 파일 하니스 재사용, 테스트-only) — risk 4-티어·reasons 6-분기·steps risk-별·null-노드 | 1 | 매우 낮음 |
| 25-2 [예정] | M-2 v22: `search-symbols.ts` `query` string-required 가드(~3줄, 형제 핸들러 동형) + 디스패처 케이스 | 1 (25-1과 합본 가능) | 매우 낮음 |

**총 2~3개 커밋(P25-1·P25-2 분리/합본).** 두 항목은 서로 독립(다른 파일·다른 부류)이라 순서 무관·합본 무방(둘 다 작고 리스크 낮음 — 1~2항목 제한 원칙 부합).

---

## 7. 향후 후보 (Phase 25 범위 밖 — 기록 유지)

- **MCP transport v2 마이그레이션(L-3)**: SDK v2 여전히 pre-alpha. `@modelcontextprotocol/sdk` latest가 2.x로 전환되거나 v2 stable(Q3 2026) 시 P15-3 설계 메모 기반 착수.
- **better-sqlite3 lockfile 정렬(L-11)**: `npm i better-sqlite3@12.10.1`로 Current 12.10.0→12.10.1 정렬 — 다음 의존성 정렬 사이클.
- **SCIP export**: P18-1 + P19-1 디딤돌 마련 완료, protobuf 의존 부담으로 즉시 비권장. CodeGraph/Serena 생태계 상호운용 신호 시 재검토.
- **L-9 잔여 클린업**: update-pipeline `withWriteTransaction()` 추출, progress `log.error` 재분류, 빈 catch 2건 — update-pipeline 리팩터 페이즈로.
- **admin CLI 게이트화(L-7)** / **worker-pool/embedding/migration 게이트화(L-8)**: 각각 핸들러 export 리팩터 / SCHEMA_VERSION 증분 시 함께.
- **L-4 IPC MessagePack** / **L-5 클러스터링 파티셔닝**: 실측 트리거 시.
- **Node 24 LTS 전환** / **tree-sitter-c-sharp 0.23.6+ 정렬**: 신버전·환경 확정 후.
- **analyze-impact `use_cache` 스키마-default 강제(L-13)**: 핸들러에서 `args.use_cache ?? true`로 스키마-default를 명시 강제하는 미세 개선 — 무해라 우선순위 낮음.
