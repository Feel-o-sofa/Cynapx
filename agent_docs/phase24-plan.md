# Phase 24 작업 계획 — diagnostic-v21 대응

> **작성**: 2026-06-15 / **기준 문서**: `agent_docs/diagnostic-v21.md` (기준 커밋 `2ac4a5f`, Phase 23 + Phase 23-1/23-2/23-3 완료)
> **목표**: diagnostic-v21이 발견한 **무위험 actionable 2건(M-1 v21, M-2 v21)** 을 해소한다. 둘 다 라이브 MCP 도구 `discover_latent_policies`(`PolicyDiscoverer.discoverPolicies()`)에 직결되며, **같은 도구·같은 호출 경로**라 한 페이즈(P24-1)로 묶인다. **M-1 v21**: `PolicyDiscoverer.discoverPolicies()`(엣지 필터·태그쌍 카운팅·threshold/minCount 임계·probability 생성)가 0% 커버 → P23-3가 확립한 `createInMemoryEngine()`/`makeNode()` 하니스를 복사해 게이트(테스트-only, prod 코드 무변경). **M-2 v21**: `discover-latent-policies.ts` 핸들러의 인자 검증이 `min_confidence`/`max_policies`(스키마·호출 어디에도 없는 인자명, dead-code)를 가드하고 실제 인자 `threshold`/`min_count`는 미검증 → 검증 인자명을 실제 호출 인자명으로 정렬(~5줄) + 잘못된 인자 → isError 게이트. **L-12(문서 Node 버전 드리프트)** 는 선택적 P24-2(docs-only)로 정렬한다. 계속 보류/이연/추적 항목(L-2~L-10)은 추적만 갱신한다(5장).
>
> **맥락**: v20은 graph/ 엔진 5종 중 4건을 P23-1/2/3으로 게이트화하고 **PolicyDiscoverer·proposeRefactor를 "픽스처 무겁다"며 L-10으로 이연**했다. v21은 *그 이연 판정을 재검증*했다 — P23-3가 신설한 `tests/refactoring-engine.test.ts`/`tests/optimization-engine.test.ts`가 이미 `:memory:` better-sqlite3 + schema.sql(vec0 필터) + `makeNode()` + `edgeRepo` 하니스를 확립했으므로, "DB-heavy라 무겁다"던 PolicyDiscoverer 게이트가 *그 하니스 복사 + 엣지 셋업만으로 가벼워졌다*. 더해, 도구 핸들러 인자명을 엔진 호출 인자명과 대조하는 신규 각도로 M-2(검증=`min_confidence`/`max_policies` ≠ 호출=`threshold`/`min_count` 불일치)를 발굴했다. 둘 다 prod 코드 변경이 0줄(M-1, 테스트-only)이거나 ~5줄(M-2, 인자명 정렬)이라 리스크가 매우 낮다. 따라서 Phase 24는 **PolicyDiscoverer 게이트 + 핸들러 인자 정렬(P24-1, 필수) + 선택적 문서 동기화(P24-2) + 추적 갱신**이며, 예상 **2~3커밋**(diagnostic-v21 + phase24-plan docs 커밋 1 + P24-1 커밋 1 + 선택적 P24-2 커밋 1).

---

## 0. 작업 원칙

- P24-1(a)는 **prod 코드 무변경**(테스트-only) — `PolicyDiscoverer.discoverPolicies()`는 `GraphEngine` 1개 의존이며, P23-3가 확립한 `createInMemoryEngine()`(`:memory:` DB + schema.sql + vec0 필터) → `new GraphEngine(nodeRepo, edgeRepo)` → `new PolicyDiscoverer(engine)`로 직접 인스턴스화 가능. 노드 2~3개 + 엣지 1~2개만 심어 결정적 게이트.
- P24-1(b)는 **prod 코드 ~5줄 변경**(핸들러 검증 인자명 정렬) — 검증 블록의 `min_confidence`/`max_policies`를 실제 호출 인자 `threshold`(0~1 범위)/`min_count`(양의 정수)로 교체. 시그니처·반환 형태·정상 경로 동작은 무변경(잘못된 인자에서만 isError로 분기). **선행: `discoverPolicies()`의 `threshold` 의미(line 62-63: `prob >= threshold`)가 0~1 확률이고 default 0.9, `minCount` default 5임을 소스에서 재확인**(diagnostic-v21 §3 인용 — 실제 소스를 따름).
- Phase 종료 시(P24-1) `npx vitest run` **608 + 신규 케이스(>=6) 그린**, `npx tsc --noEmit` 그린, `npm audit` 0, `npm audit --omit=dev` 0 확인.
- Phase 종료 시 `agent_docs/diagnostic-v21.md`의 M-1 v21·M-2 v21에 [DONE] 마킹.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.** (`.git/info/exclude`에 이미 등록 — `git status --short`는 항상 깨끗해야 한다.)
- 한 사이클(1~2 항목) 제한 원칙에 따라, **P24-1(a)+(b)는 같은 도구·같은 파일이라 하나의 작업 단위로 묶어 처리**한다(둘 다 작고 같은 호출 경로라 합쳐도 리스크 증가 없음). P24-2(문서)는 docs-only라 같은 커밋 또는 별도 커밋 모두 무방.

---

## 1. 의존성 맵

```
P24-1(a) (PolicyDiscoverer.discoverPolicies() 로직 게이트 — 테스트-only)   독립.
  └─ tests/policy-discoverer.test.ts 신규
        ← createInMemoryEngine() 하니스를 tests/refactoring-engine.test.ts(또는 optimization-engine.test.ts)에서 복사
        ← makeNode(nodeRepo, {qualified_name, tags:[...]}) 로 태그 달린 노드 2~3개 + edgeRepo.createEdge()로 의존 엣지 1~2개
        ← discoverPolicies(threshold, minCount) → LatentPolicy[] 단언(probability·occurrence·description·임계 통과/탈락)
        ← prod 코드 무변경

P24-1(b) (discover-latent-policies.ts 핸들러 인자 검증 정렬 — ~5줄)   P24-1(a)와 같은 도구.
  └─ src/server/tools/discover-latent-policies.ts:16-20 검증 인자명 min_confidence/max_policies → threshold/min_count
  └─ tests/tool-dispatcher.test.ts(또는 핸들러 직접 테스트)에 threshold:1.5 / min_count:-1 → isError 케이스 추가

P24-2 (선택, L-12: 문서 Node 버전 드리프트 정렬 — docs-only)   독립.
  └─ README_KR.md:62 / GUIDE_EN.md:119 / GUIDE_KR.md:119 의 "Node.js ≥ 20" → "≥ 22"
```

```
L-2 (Miasma / Phantom Gyp)              ──추적만──→  [`npm ls` + in-tree 에이전트 설정 무결성 재대조; 도달 0건 불변]
L-3 (MCP stateless/task 마이그레이션)    ──이연──→  [SDK v2 npm alpha 배포됨; stable Q3 2026 전환까지]
L-4 (IPC MessagePack)                    ──계속 보류──
L-5 (클러스터 본격 파티셔닝)              ──계속 이연──→  [100k+ 노드 실측 시]
L-6 (Node 24 tree-sitter 빌드)            ──추적만──→  [node-tree-sitter#268 해소 + Node 24 LTS 전환 시]
L-7 (admin CLI cmd* 게이트 공백)          ──추적만(비-actionable)──
L-8 (worker-pool/embedding/migration 잔여)──추적만(비-actionable)──
L-9 (update-pipeline 클린업 잔여)         ──추적만(비-actionable)──
L-10 (proposeRefactor 게이트 잔여, 축소)   ──다음 사이클(그래프 픽스처 무거움)──
L-11 (better-sqlite3 12.10.1 정렬)        ──[해소 — lockfile 정렬 확인]──
L-12 (문서 Node 버전 드리프트)            ──P24-2(선택)에서 정렬──
```

---

## 2. Phase 24-1: PolicyDiscoverer 로직 게이트 + 핸들러 인자 검증 정렬 (M-1 v21 + M-2 v21) [DONE]

### 2-1. (a) PolicyDiscoverer.discoverPolicies() 회귀 게이트 — 테스트-only

**목표**: `src/graph/policy-discoverer.ts`의 `discoverPolicies(threshold=0.9, minCount=5)`는 라이브 MCP 도구 `discover_latent_policies` 뒤에 있으나 전용 테스트가 없고 디스패처 테스트는 엔진-not-ready 경로만 검증한다(`tests/tool-dispatcher.test.ts:257`). 미커버 로직 5종(엣지 타입 필터·노드/태그 누락 skip·태그쌍 카운팅·totalOut/threshold/minCount 게이트·probability/description 생성)을 결정적으로 게이트한다. **prod 코드 무변경**(테스트-only).

| 미커버 분기 (소스 라인) | 로직 | 게이트 케이스 |
|------------------------|------|---------------|
| line 32 | 엣지 타입 필터(`calls/dynamic_calls/inherits/implements/depends_on`만) | 허용 타입 엣지 1개 + 비-허용 타입(예: `defines`) 엣지 1개 → 후자는 카운트 0 |
| line 39 | `fromNode`/`toNode` 또는 `tags` 누락 시 skip | tags 없는 노드를 가리키는 엣지 → skip 확인 |
| line 41-52 | 태그쌍 관계 카운팅(중첩 Map) | 동일 (fromTag→toTag) 패턴을 N회 반복하는 엣지들 → `occurrence === N` |
| line 59 / 62-63 | `totalOut < minCount` 게이트 + `prob >= threshold && count >= minCount` 임계 | minCount 미만 → 탈락; threshold 정확히 도달/미달 경계 |
| line 64-70 | `probability` + `description`(`(prob*100).toFixed(1)%`) 생성 | 통과 케이스에서 `probability`·`description` 문자열 단언 |

| 항목 | 파일 | 작업 |
|------|------|------|
| 신규 테스트 파일 | `tests/policy-discoverer.test.ts` (신규) | `createInMemoryEngine()` 하니스를 `tests/refactoring-engine.test.ts`(line 26-40)에서 복사(`:memory:` DB + schema.sql vec0 필터 + NodeRepository/EdgeRepository/GraphEngine). `new PolicyDiscoverer(engine)` 인스턴스화. `makeNode(nodeRepo, {qualified_name, tags})` 헬퍼로 `layer:*`/`role:*` 태그 달린 노드 셋업 + `edgeRepo.createEdge({from_id, to_id, edge_type})`로 의존 엣지 셋업. |
| 임계 통과 케이스 | (위 파일) | 동일 (fromTag→toTag) 패턴 엣지를 `minCount`(=5) 이상 + `prob >= threshold`(=0.9)로 심어 → `discoverPolicies()`가 정확히 1개 `LatentPolicy` 반환, `occurrence >= 5`·`probability >= 0.9`·`fromTag`/`toTag` 단언. |
| 임계 탈락 케이스 | (위 파일) | (1) `totalOut < minCount`(엣지 4개) → 빈 배열; (2) `prob < threshold`(소수 패턴 섞임) → 빈 배열. |
| 엣지 타입 필터 케이스 | (위 파일) | 비-허용 엣지 타입(예: `defines`/`references`)만 심은 그래프 → 빈 배열(line 32 필터 확인). |
| 태그 누락 skip 케이스 | (위 파일) | `tags` 없는(또는 null) 노드를 가리키는 엣지 → 카운트되지 않음(line 39 skip 확인). |
| 기본값 케이스 | (위 파일) | 인자 없이 `discoverPolicies()` 호출 → default(0.9, 5) 적용 확인. |
| 베이스라인 재확인 | (검증) | `npx vitest run` 608 + 신규(>=5) 그린, `npx tsc --noEmit` 그린, `npm audit` 0·`npm audit --omit=dev` 0. |

**설계 메모**:
- `LatentPolicy`(`fromTag`/`toTag`/`occurrence`/`probability`/`description`)는 `src/graph/policy-discoverer.ts:8`에서 export — import해 단언.
- `edge.edge_type` 필드명·`createEdge` 시그니처를 `src/db/edge-repository.ts`에서 재확인(스키마 `edges` 테이블). `tests/architecture-engine.test.ts`가 이미 `edgeRepo.createEdge()`로 엣지를 심는 패턴을 가지면 그대로 차용.
- `getNodeById`로 노드 조회가 일어나므로(line 36-37) 노드는 반드시 `createNode`로 실제 DB에 심어야 한다(stub 불가 — in-memory DB가 정답).
- `probability` 계산은 `count / totalOut`(line 62)이고 `totalOut`은 fromTag의 *출현 횟수*(line 43, 엣지마다 fromTag별 +1)임에 유의 — 케이스 설계 시 `totalOut`이 의도대로 누적되는지 손으로 추적.

### 2-2. (b) discover-latent-policies.ts 핸들러 인자 검증 정렬 — ~5줄

**목표**: `src/server/tools/discover-latent-policies.ts:16-20`은 `args.min_confidence`(0~1)·`args.max_policies`(양의 정수)를 검증하지만, line 22의 실제 호출은 `discoverPolicies(args.threshold, args.min_count)`이고 MCP 스키마(`tool-dispatcher.ts:200-201`)도 `threshold`/`min_count`만 선언한다. 검증 블록은 dead-code이고 실제 인자는 미검증이다. 검증 인자명을 실제 호출 인자명으로 정렬한다.

| 항목 | 파일 | 작업 |
|------|------|------|
| 인자 검증 정렬 | `src/server/tools/discover-latent-policies.ts:16-20` | `min_confidence` → `threshold`(0~1 범위 검증 유지: `typeof !== 'number' \|\| NaN \|\| <0 \|\| >1` → "Invalid argument: threshold must be a number between 0 and 1."), `max_policies` → `min_count`(양의 정수 검증 유지: `typeof !== 'number' \|\| NaN \|\| <1 \|\| !Number.isInteger` → "Invalid argument: min_count must be a positive integer."). 호출(line 22)·스키마(tool-dispatcher.ts:200-201)는 무변경 — 이미 `threshold`/`min_count`라 정합. |
| 핸들러/디스패처 게이트 | `tests/tool-dispatcher.test.ts` (또는 핸들러 직접 테스트) | `policyDiscoverer`가 주입된 컨텍스트(M-1 in-memory 하니스 또는 최소 stub)에서 `discover_latent_policies`를 (1) `threshold: 1.5` → isError + "between 0 and 1", (2) `min_count: -1` → isError + "positive integer", (3) 유효 인자 → 정상(isError 아님)으로 호출하는 케이스 추가. **주의: 기존 line 257-260(엔진-not-ready isError)는 유지** — 검증은 엔진 호출 *전*이므로, 검증 케이스는 엔진 주입 컨텍스트가 필요하다(또는 검증이 ctx 체크 다음·엔진 호출 전에 있음을 활용). |
| 베이스라인 재확인 | (검증) | `npx vitest run` 그린, `npx tsc --noEmit` 그린, `npm audit` 0/0. |
| M-1/M-2 v21 마킹 | `agent_docs/diagnostic-v21.md` | M-1 v21·M-2 v21에 `[DONE]` + 신규 테스트 파일·케이스 수·인자 정렬 기록. |

**설계 메모**:
- 검증 순서: 핸들러 line 13-15(ctx 체크) → line 16-20(인자 검증) → line 22(엔진 호출). 인자 검증을 정렬해도 이 순서는 유지 — ctx 없으면 여전히 "No active project" 먼저.
- `args.threshold`/`args.min_count`가 `undefined`면(스키마 default가 클라이언트단 적용이라 핸들러엔 `undefined`로 올 수 있음) 기존처럼 검증 통과(`!== undefined` 가드 유지) → 엔진의 default(0.9/5)가 적용된다. 즉 *제공된 경우에만* 범위 검증.

**테스트**: `npx vitest run` 608 + 신규(M-1 >=5 + M-2 >=2) 그린이 1차 검증 산출물. `npx tsc --noEmit` 그린, `npm audit` 0/0.

**산출물**: `tests/policy-discoverer.test.ts`(신규) + `src/server/tools/discover-latent-policies.ts`(~5줄) + `tests/tool-dispatcher.test.ts`(신규 케이스) + diagnostic-v21 M-1/M-2 [DONE]. **리스크: 매우 낮음**(M-1 테스트-only; M-2는 dead-code 검증을 실제 작동하게 정렬 — 정상 경로 동작 무변경, 잘못된 인자에서만 isError 추가).

---

## 3. Phase 24-2 (선택): 문서 Node 버전 드리프트 정렬 (L-12) — docs-only [DONE]

**목표**: `package.json:12`(`engines.node ">=22"`)·`Dockerfile:21,50`(`node:22-bookworm-slim`)·README.md:62(EN, "≥ 22")는 모두 22이나, `README_KR.md:62`·`GUIDE_EN.md:119`·`GUIDE_KR.md:119`는 여전히 "Node.js ≥ 20"이다(P21-2가 README EN만 갱신한 잔재). 코드와 일치하도록 정렬한다.

| 항목 | 파일 | 작업 |
|------|------|------|
| README KR 정렬 | `README_KR.md:62` | "Node.js ≥ 20" → "Node.js ≥ 22" |
| GUIDE EN 정렬 | `GUIDE_EN.md:119` | 표 행 "Node.js \| >= 20" → "Node.js \| >= 22" |
| GUIDE KR 정렬 | `GUIDE_KR.md:119` | 표 행 "Node.js \| >= 20" → "Node.js \| >= 22" |
| 베이스라인 재확인 | (검증) | (docs-only, 코드 무변경) `npx vitest run` 608 불변, `npx tsc --noEmit` 그린, `npm audit` 0/0. |
| L-12 마킹 | `agent_docs/diagnostic-v21.md` | L-12에 `[DONE]` 마킹. |

**설계 메모**:
- 변경 전 `grep -n ">= 20\|≥ 20" README*.md GUIDE*.md`로 다른 Node 20 참조가 없는지 재확인(현재 정확히 3곳). EN README는 이미 ≥ 22라 무변경.
- docs-only라 테스트 영향 0. **이 서브페이즈는 선택** — P24-1로 1세트를 채웠다면 P24-2는 같은 커밋에 묶거나 다음 docs 사이클로 넘겨도 무방.

**산출물**: `README_KR.md`/`GUIDE_EN.md`/`GUIDE_KR.md` 각 1줄 + diagnostic-v21 L-12 [DONE]. **리스크: 없음**(docs-only).

---

## 4. 보류/이연 항목 판정 (diagnostic-v21 → Phase 24 verdict)

| 항목 | diagnostic-v21 판정 | Phase 24 처리 |
|------|--------------------|---------------|
| **M-1 v21 PolicyDiscoverer 로직 게이트** | 라이브 도구 뒤 0% 커버, P23-3 하니스로 가벼움 (**verdict: actionable, 테스트-only**) | **P24-1(a)에서 해소** |
| **M-2 v21 핸들러 인자-명 불일치** | 검증=`min_confidence`/`max_policies` ≠ 호출=`threshold`/`min_count`, dead-code 검증 (**verdict: actionable, ~5줄**) | **P24-1(b)에서 해소** |
| **L-12 문서 Node 버전 드리프트** | README_KR/GUIDE_EN/GUIDE_KR "≥ 20" vs 코드 "≥ 22" (**verdict: docs-only, 3줄**) | **P24-2(선택)에서 정렬** |
| **L-2 Miasma / Phantom Gyp 포스처** | 캠페인 진행 중, Cynapx 도달 0건 재대조 (**verdict: 추적만**) | 추적 상태만 갱신 — `npm ls` + in-tree 설정 재점검 |
| **L-3 MCP stateless/task 마이그레이션** | SDK v2 *npm alpha 배포됨*, sdk latest 1.29.x, v1.x production 권장 (**verdict: 계속 이연**) | 범위 제외 — alpha→stable 전환 시 |
| **L-4 IPC MessagePack** | 성능 문제 미관측 (**verdict: 계속 보류**) | 범위 제외 |
| **L-5 클러스터링 본격 파티셔닝** | count-first 가드(200k) OOM 방어 (**verdict: 계속 이연**) | 범위 제외 |
| **L-6 Node 24 tree-sitter 빌드** | node-tree-sitter#268 여전히 open (**verdict: 추적**) | 추적 상태만 갱신 |
| **L-7 admin CLI cmd* 게이트 공백** | 모듈-private, 리팩터 수반 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-8 worker-pool/embedding/migration 잔여** | 인접 분기 커버 + flaky 위험 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-9 update-pipeline 클린업 잔여** | (b) 잣대 미충족 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-10 proposeRefactor 게이트 잔여(축소)** | `graphEngine.traverse()` BFS 그래프 픽스처 무거움 (**verdict: 다음 사이클**) | 범위 제외 — PolicyDiscoverer 다음 후보 |
| **L-11 better-sqlite3 12.10.0→12.10.1** | lockfile 정렬 확인 (**verdict: 해소**) | 추적 종료 |

---

## 5. 유지보수 모드 포스처 ("정기 점검" 이월)

1. **공급망 위생(매 사이클)**: prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0 유지. 신규 advisory 시 `overrides`로 패치 floor. 의존 추가 시 binding.gyp 검토 + `npm ci` + 매 사이클 `npm ls`/in-tree `.claude`/`.cursor`/`.gemini` 설정 재대조(현재 `.claude/launch.json` 양성, 0건).
2. **MCP SDK v2 stable 배포 모니터링**: `@modelcontextprotocol/server`·`@modelcontextprotocol/client` v2 alpha가 npm에 배포됨. `@modelcontextprotocol/sdk` latest가 2.x로 전환(또는 v2 stable Q3 2026)되면 L-3 actionable화. 그 전까지 핀 `^1.29.0` 유지.
3. **런타임 수명주기**: Node 22 LTS·tree-sitter 신버전·tree-sitter-c-sharp 0.23.6+ 출현 시 정렬. Node 24 LTS 전환은 node-tree-sitter#268 해소 후. **문서 Node 버전(L-12)은 코드와 동기화 유지.**
4. **회귀 안전망·문서 위생**: 새 도구/REST 라우트/이벤트 핸들러/**엔진 비즈니스 로직/핸들러 인자 검증**의 미커버·불일치 발견 시 vitest 케이스 추가(P18-1→P19-1→P20-1→P22-1→P23-1/2/3→**P24-1** 확장). **P24-1로 처방 엔진 5종(architecture/optimization/remediation/refactoring-getRiskProfile/policy) 전부 회귀 게이트 커버 완성** — 잔여는 `proposeRefactor()`(L-10, 그래프 픽스처) 1건. 도구 핸들러 인자명↔엔진 호출 인자명 대조를 정기 점검 항목에 추가.

---

## 6. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 24-(docs) | diagnostic-v21 + phase24-plan 신규 docs | 1 | 없음 (docs-only) |
| 24-1 [DONE] (vitest 618) | M-1 v21: `tests/policy-discoverer.test.ts` 신규 7케이스(테스트-only) + M-2 v21: `discover-latent-policies.ts` 인자명 정렬(~5줄) + 디스패처 3케이스 — 같은 도구·같은 파일 | 1 | 매우 낮음 |
| 24-2 (선택) [DONE] (vitest 618 불변, docs-only) | L-12: README_KR/GUIDE_EN/GUIDE_KR Node "≥ 20" → "≥ 22" 정렬 | 1 (24-1과 합본) | 없음 (docs-only) |

**총 2~3개 커밋(P24-2 포함 시).** P24-1(a)+(b)는 같은 도구·같은 호출 경로라 한 구현 사이클에서 함께 처리하는 것을 권장한다(1~2항목 제한 원칙 부합). P24-2는 docs-only라 P24-1 커밋에 묶거나 별도/다음 사이클 모두 무방.

---

## 7. 향후 후보 (Phase 24 범위 밖 — 기록 유지)

- **RefactoringEngine.proposeRefactor() 게이트화(L-10 잔여)**: `graphEngine.traverse()` BFS + private `calculateRisk`/`getRiskReasons`/`generateSteps` — incoming 의존 트리를 엣지로 심어야 risk/impact가 의미 있음(그래프 픽스처 무거움). P24-1(PolicyDiscoverer) 이후 다음 사이클.
- **MCP transport v2 마이그레이션**: v2 alpha가 npm에 배포됨. `@modelcontextprotocol/sdk` latest가 2.x로 전환되거나 v2 stable(Q3 2026) 시 L-3 + P15-3 설계 메모 기반 착수.
- **SCIP export**: P18-1 + P19-1 디딤돌 마련 완료, protobuf 의존 부담으로 즉시 비권장.
- **L-9 잔여 클린업**: update-pipeline `withWriteTransaction()` 추출, progress `log.error` 재분류, 빈 catch 2건 — update-pipeline 리팩터 페이즈로.
- **admin CLI 게이트화(L-7)** / **worker-pool/embedding/migration 게이트화(L-8)**: 각각 핸들러 export 리팩터 / SCHEMA_VERSION 증분 시 함께.
- **L-4 IPC MessagePack** / **L-5 클러스터링 파티셔닝**: 실측 트리거 시.
- **Node 24 LTS 전환** / **tree-sitter-c-sharp 0.23.6+ 정렬**: 신버전·환경 확정 후.
