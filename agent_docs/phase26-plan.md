# Phase 26 작업 계획 — diagnostic-v23 대응

> **작성**: 2026-06-15 / **기준 문서**: `agent_docs/diagnostic-v23.md` (기준 커밋 `9b34f5f`, Phase 25 + Phase 25-1/25-2 완료)
> **목표**: diagnostic-v23이 발견한 **무위험 actionable 2건(M-1 v23, M-2 v23)** 을 해소한다. **M-1 v23**: `src/server/tools/_utils.ts`의 순수 함수 `mergeResultsRRF()`(35-49줄)는 라이브 MCP 도구 `search_symbols`의 semantic 모드(`search-symbols.ts:30`) 뒤에서 RRF(Reciprocal Rank Fusion) 융합을 수행하나 직접 단위 테스트가 0건 → 의존 0(배열 in/out, DB·async·side-effect 없음)인 순수 함수에 결정적 게이트 추가(테스트-only, prod 코드 무변경). **M-2 v23**: `src/server/tools/get-related-tests.ts:17`이 스키마-required `qualified_name`을 약한 truthy 가드(`if (!args.qualified_name)`)로만 검증해, `qualified_name: 123`(비-문자열 truthy)이 통과해 misleading "Symbol not found"를 반환 → 형제 핸들러 9종과 동형의 strict 가드(`typeof !== 'string' || trim()===''`)로 정렬(~3줄) + 게이트. 두 건은 *서로 독립*(다른 파일·다른 부류)이나 둘 다 작고(M-1 테스트-only, M-2 ~3줄) 리스크가 매우 낮아 한 사이클에 함께 처리 가능하다. 계속 보류/이연/추적 항목(L-2~L-9, L-11, L-13, L-14)은 추적만 갱신한다(4장).
>
> **맥락**: v22는 graph/ 엔진 처방 5종(architecture/optimization/remediation/refactoring-getRiskProfile+proposeRefactor/policy)의 진입 로직을 전수 게이트로 덮었다. v23은 *그 다음* 미커버 후보를 두 신규 각도로 찾았다 — (1) graph/ 엔진은 전수 게이트됐으나 *서버 핸들러 보조 순수 로직*(`_utils.ts`)은 게이트 밖이었고, 그중 `mergeResultsRRF`는 RRF 점수 누적·dedup·정렬이라는 실질 비즈니스 로직이라 (b) 잣대를 가장 깨끗하게 충족(M-1 v23); (2) M-2 v22의 "스키마-required 인자 핸들러 검증" 각도를 `qualified_name`을 받는 10개 핸들러 전부에 재적용해, strict 가드를 쓰지 않는 1건(`get-related-tests`)을 발굴(M-2 v23). 둘 다 prod 코드 변경이 0줄(M-1, 테스트-only)이거나 ~3줄(M-2, 가드 정렬)이라 리스크가 매우 낮다. 따라서 Phase 26은 **mergeResultsRRF 게이트(P26-1) + get-related-tests qualified_name 가드 정렬(P26-2) + 추적 갱신**이며, 예상 **2~3커밋**(diagnostic-v23 + phase26-plan docs 커밋 1 + P26-1 커밋 1 + P26-2 커밋 1, 또는 P26-1·P26-2 합본).

---

## 0. 작업 원칙

- P26-1은 **prod 코드 무변경**(테스트-only) — `mergeResultsRRF(keywordNodes, vectorNodes, limit)`는 `src/server/tools/_utils.ts:35-49`에서 export된 순수 함수로, 배열 in → 배열 out·DB·async·side-effect 의존 0. `import { mergeResultsRRF } from '../../src/server/tools/_utils.js'` 후 노드 객체 리터럴(`{ id, ... }`)만 넣어 결정적 단언 가능.
- P26-2는 **prod 코드 ~3줄 변경**(`get-related-tests.ts:17-19`의 truthy 가드를 strict 가드로 교체) — `if (typeof args.qualified_name !== 'string' || args.qualified_name.trim() === '') return {isError, content:[{type:'text', text:'Invalid argument: qualified_name must be a non-empty string.'}]}`. 시그니처·반환 형태·정상 경로 동작은 무변경(비-문자열/빈 문자열에서만 isError로 분기, 메시지를 형제 핸들러와 통일).
- Phase 종료 시(P26-1·P26-2) `npx vitest run` **634 + 신규 케이스 그린**, `npx tsc --noEmit` 그린, `npm audit` 0, `npm audit --omit=dev` 0 확인.
- Phase 종료 시 `agent_docs/diagnostic-v23.md`의 M-1 v23·M-2 v23에 `[DONE]` 마킹.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.** (`.git/info/exclude`에 이미 등록 — `git status --short`는 항상 깨끗해야 한다.)
- 한 사이클(1~2 항목) 제한 원칙에 따라, **P26-1·P26-2는 둘 다 작고(테스트-only / ~3줄) 리스크가 낮아 한 작업 단위로 묶거나 2커밋으로 나눠도 무방**. 둘은 서로 독립(다른 파일·다른 부류)이라 순서 무관.

---

## 1. 의존성 맵

```
P26-1 (mergeResultsRRF() RRF 융합 로직 게이트 — 테스트-only)   독립.
  └─ tests/_utils.test.ts (신규 파일) 또는 기존 tests/tool-dispatcher.test.ts에 신규 describe 블록
        ← import { mergeResultsRRF } from '../src/server/tools/_utils.js'
        ← 노드 객체 리터럴 배열만으로 결정적 단언(k=60, 1/(k+rank+1), dedup boost, 정렬, limit slice)
        ← prod 코드 무변경

P26-2 (get-related-tests.ts qualified_name strict 가드 정렬 — ~3줄)   독립.
  └─ src/server/tools/get-related-tests.ts:17-19 truthy 가드 → strict 가드 교체
  └─ tests/tool-dispatcher.test.ts에 qualified_name:123 / qualified_name:'' → isError("Invalid argument") 케이스 추가
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
L-11 (better-sqlite3 lockfile 12.10.0)    ──불변, 추적──→  [다음 의존성 정렬 사이클 `npm i better-sqlite3@12.10.1`]
L-13 (analyze-impact use_cache 무해)       ──추적만(비-actionable)──
L-14 (CVE-2026-25727 time 크레이트, 미도달)──추적만(비-actionable)──
```

---

## 2. Phase 26-1: mergeResultsRRF() RRF 융합 로직 게이트 (M-1 v23) [예정]

**목표**: `src/server/tools/_utils.ts`의 `mergeResultsRRF(keywordNodes, vectorNodes, limit)`(35-49줄)는 라이브 MCP 도구 `search_symbols`의 semantic 모드(`search-symbols.ts:30`: `mergeResultsRRF(keywordNodes, vectorNodes, limit)`) 뒤에서 RRF(Reciprocal Rank Fusion) 융합을 수행하나 *직접 단위 테스트가 0건*(`tests/` 전수 `grep` 결과 `mergeResultsRRF`/`tools/_utils` import 0건). 의존 0의 순수 함수(배열 in → 배열 out)에 결정적 게이트를 추가한다. **prod 코드 무변경**(테스트-only).

| 미커버 로직 (소스 라인) | 내용 | 게이트 케이스 |
|------------------------|------|---------------|
| line 36, 43 | `k=60` 상수 + `1/(k+rank+1)` 랭크 점수 공식 | rank 0 노드 → 점수 `1/61`, rank 1 노드 → `1/62` 등 정확한 점수 계산 단언(또는 상대 순서로 단언) |
| line 43 (dedup boost) | 같은 `node.id`가 keyword·vector 양쪽에 출현 시 점수 누적(`scores.set(id, (scores.get(id)||0) + ...)`) | id가 keyword 리스트와 vector 리스트 양쪽에 모두 존재 → 결과에서 해당 노드가 단독-출현 노드보다 상위(누적 점수가 더 큼)임을 단언 |
| line 48 (정렬) | `Array.from(scores.entries()).sort((a,b)=>b[1]-a[1])` 내림차순 | 입력 순서와 무관하게 결과가 점수 내림차순으로 반환됨을 단언 |
| line 48 (limit slice) | `.slice(0, limit)` 절단 | keyword+vector 합산 고유 노드 수 > limit인 입력 → 결과 길이 === limit 단언 |
| line 38, 48 (nodeMap 복원) | id→원본 노드 객체 매핑 복원 | 결과 배열의 각 원소가 원본 입력 노드 객체(참조 또는 deep-equal)와 일치함을 단언 |
| (경계) | 빈 입력 | `mergeResultsRRF([], [], limit)` → `[]` 반환 단언 |

| 항목 | 파일 | 작업 |
|------|------|------|
| 신규 테스트 파일 또는 describe 블록 | `tests/_utils.test.ts` (신규, 권장) — 순수 함수 단위 테스트이므로 별도 파일이 자연스러움. 또는 `tests/tool-dispatcher.test.ts`에 describe 블록 추가도 가능 | `import { mergeResultsRRF } from '../src/server/tools/_utils.js'`. 노드 객체는 `{ id: number, qualified_name: string, ... }` 형태의 최소 리터럴(필드는 RRF 로직이 `id`만 참조하므로 `id` + 식별용 필드 1~2개로 충분). |
| RRF 점수/정렬 케이스 | (위 파일) | rank 기반 점수 공식과 내림차순 정렬을 단언. |
| dedup boost 케이스 | (위 파일) | 동일 id가 keyword·vector 양쪽에 존재 → 누적 점수로 최상위 정렬됨을 단언(RRF의 핵심 — 두 랭킹 모두에서 상위인 노드가 최종 1위). |
| limit slice 케이스 | (위 파일) | 합산 고유 노드 수 > limit → 결과 길이 `=== limit`. |
| 빈 입력 케이스 | (위 파일) | `mergeResultsRRF([], [], N)` → `[]`. |
| 베이스라인 재확인 | (검증) | `npx vitest run` 634 + 신규 그린, `npx tsc --noEmit` 그린, `npm audit` 0·`npm audit --omit=dev` 0. |
| M-1 v23 마킹 | `agent_docs/diagnostic-v23.md` | M-1 v23에 `[DONE]` + 신규 케이스 수 기록. |

**설계 메모**:
- `mergeResultsRRF`는 `any[]` 시그니처(35줄)이고 `node.id!`만 참조(41줄)하므로, 테스트 노드 객체는 `{ id: 1, qualified_name: 'a' }` 같은 최소 리터럴로 충분 — `makeNode`/`createInMemoryEngine` 하니스 불필요(graph/ 엔진 게이트들과 달리 DB 의존 0).
- dedup boost 검증 시 주의: rank가 낮을수록(0이 1위) 점수가 높음(`1/(60+0+1) > 1/(60+1+1)`). 양쪽 리스트에서 모두 출현하는 노드는 두 점수의 합이 단독-출현 노드의 단일 점수보다 항상 큼(RRF 점수는 항상 양수) — 이 성질로 "양쪽 출현 노드가 최상위"를 결정적으로 단언 가능.
- `escapeXml`/`escapeDot`(51-57줄)은 단순 정규식 치환으로 게이트 가치가 낮아 본 phase 범위 밖(diagnostic-v23 §5 — 추적만, M-1과 함께 추가해도 되나 우선순위 낮음). P26-1 구현 중 여유가 있으면 같은 파일에 1~2 케이스씩 추가해도 무방하나 필수는 아님.

**테스트**: `npx vitest run` 634 + 신규(>=5) 그린이 1차 검증 산출물. `npx tsc --noEmit` 그린, `npm audit` 0/0.

**산출물**: `tests/_utils.test.ts`(신규) 또는 `tests/tool-dispatcher.test.ts`(신규 describe 블록) + diagnostic-v23 M-1 `[DONE]`. **리스크: 매우 낮음**(테스트-only, prod 코드 0줄, 의존 0 순수 함수). **이로써 검색 처방을 떠받치는 RRF 융합까지 회귀 게이트 커버.**

---

## 3. Phase 26-2: get-related-tests.ts qualified_name strict 가드 정렬 (M-2 v23) [예정]

**목표**: `src/server/tools/get-related-tests.ts:17`은 스키마-required `qualified_name`(`tool-dispatcher.ts`에서 `required:["qualified_name"]`+`type:"string"`)을 *약한 truthy 가드*(`if (!args.qualified_name)`)로만 검증한다. 형제 핸들러 9종(`analyze-impact:12`·`get-callers:12`·`get-callees:12`·`get-symbol-details:13`·`get-risk-profile:12`·`propose-refactor:12` 등)은 전부 `typeof args.qualified_name !== 'string' || args.qualified_name.trim() === ''` strict 가드를 쓰나 — `get-related-tests`만 truthy 가드다. 결과: `qualified_name: 123`(비-문자열 truthy)이 가드를 통과해 `getNodeByQualifiedName(123)`(line 21)로 흘러가고, `node-repository.ts`의 `WHERE qualified_name = ?`는 숫자 바인딩에 매치 0행 → misleading "Symbol not found"를 반환(형제 핸들러의 "Invalid argument: qualified_name must be a non-empty string."와 메시지·동작 불일치). 또한 falsy 경로(`{}`/`''`)는 "Error: qualified_name is required."를 반환해 형제와 다른 메시지다. 형제와 동형의 strict 가드 + 통일된 메시지로 정렬한다.

| 항목 | 파일 | 작업 |
|------|------|------|
| qualified_name 가드 정렬 | `src/server/tools/get-related-tests.ts:17-19` | 기존 `if (!args.qualified_name) { return { content: [{ type: 'text', text: 'Error: qualified_name is required.' }], isError: true }; }`를 형제 핸들러(`analyze-impact.ts:12-14`)와 동형의 `if (typeof args.qualified_name !== 'string' || args.qualified_name.trim() === '') { return { isError: true, content: [{ type: 'text', text: 'Invalid argument: qualified_name must be a non-empty string.' }] }; }`로 교체(~3줄). 정상 경로·시그니처·반환 형태 무변경 — 비-문자열/빈 문자열에서만 isError, 메시지를 형제와 통일. |
| 디스패처 게이트 | `tests/tool-dispatcher.test.ts` | `get_related_tests`를 (1) `qualified_name` 누락(undefined/`{}`) → isError + "Invalid argument...non-empty string"(기존 `{}` 케이스가 있다면 기대 메시지를 갱신), (2) `qualified_name: 123`(비-문자열) → isError + 동일 메시지, (3) `qualified_name: ''`(빈 문자열) → isError, (4) 유효 `qualified_name` → 정상(isError 아님, 기존 happy-path 케이스 유지) 케이스 추가/갱신. |
| 베이스라인 재확인 | (검증) | `npx vitest run` 634 + 신규(>=3) 그린, `npx tsc --noEmit` 그린, `npm audit` 0/0. |
| M-2 v23 마킹 | `agent_docs/diagnostic-v23.md` | M-2 v23에 `[DONE]` + 가드 정렬·케이스 수 기록. |

**설계 메모**:
- 기존 `tests/tool-dispatcher.test.ts`에 `get_related_tests` + `{}`(falsy 누락) 케이스가 있다면, 기대 메시지가 "Error: qualified_name is required."에서 "Invalid argument: qualified_name must be a non-empty string."로 바뀌므로 해당 단언을 갱신해야 한다(테스트 깨짐 방지).
- `qualified_name: 123` 케이스는 가드가 ctx 체크(line 14) *이후*에 있으므로, 테스트에서 active project 컨텍스트가 설정된 상태에서 호출해야 가드 분기에 도달함을 확인(`analyze-impact` 형제 핸들러 테스트의 컨텍스트 셋업 패턴 참고).
- 정상 경로(유효 `qualified_name`)의 동작은 완전히 무변경 — `getNodeByQualifiedName`·`getIncomingEdges`·파일-레벨 테스트 조회 로직은 그대로.

**테스트**: `npx vitest run` 634 + 신규(M-1 >=5 + M-2 >=3) 그린이 1차 검증 산출물. `npx tsc --noEmit` 그린, `npm audit` 0/0.

**산출물**: `src/server/tools/get-related-tests.ts`(~3줄) + `tests/tool-dispatcher.test.ts`(신규/갱신 케이스) + diagnostic-v23 M-2 `[DONE]`. **리스크: 매우 낮음**(가드 정렬 — 정상 경로 동작 무변경, 비-문자열/빈 문자열에서만 isError + 메시지 통일, 형제 핸들러와 동형).

---

## 4. 보류/이연 항목 판정 (diagnostic-v23 → Phase 26 verdict)

| 항목 | diagnostic-v23 판정 | Phase 26 처리 |
|------|--------------------|---------------|
| **M-1 v23 mergeResultsRRF 게이트** | 라이브 도구 뒤 0% 커버, 의존 0 순수 함수로 가장 가벼운 게이트 (**verdict: actionable, 테스트-only**) | **P26-1에서 해소** |
| **M-2 v23 get-related-tests qualified_name truthy 가드** | `qualified_name` 10개 핸들러 전수 대조에서 유일한 truthy 가드, 비-문자열 우회 + 메시지 불일치 (**verdict: actionable, ~3줄**) | **P26-2에서 해소** |
| **L-2 Miasma / Phantom Gyp / Node-gyp 포스처** | 캠페인 진행 중, Cynapx 도달 0건 재대조 (**verdict: 추적만**) | 추적 상태만 갱신 — `npm ls` + in-tree 설정 재점검 |
| **L-3 MCP stateless/task 마이그레이션** | SDK v2 *여전히 pre-alpha*, sdk 1.29.0 불변, v1.x production 권장, stable Q3 2026 예정 (**verdict: 계속 이연**) | 범위 제외 — v2 stable 전환 시 |
| **L-4 IPC MessagePack** | 성능 문제 미관측 (**verdict: 계속 보류**) | 범위 제외 |
| **L-5 클러스터링 본격 파티셔닝** | count-first 가드(200k) OOM 방어 (**verdict: 계속 이연**) | 범위 제외 |
| **L-6 Node 24 tree-sitter 빌드** | node-tree-sitter#268·C++20 fragility 여전히 open (**verdict: 추적**) | 추적 상태만 갱신 |
| **L-7 admin CLI cmd* 게이트 공백** | 모듈-private, 리팩터 수반 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-8 worker-pool/embedding/migration 잔여** | 인접 분기 커버 + flaky 위험 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-9 update-pipeline 클린업 잔여** | (b) 잣대 미충족 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-11 better-sqlite3 lockfile 12.10.0** | 불변(Wanted/Latest 12.10.1, patch-level 드리프트, CVE 0건) (**verdict: 추적, 재정렬 후보**) | 다음 의존성 정렬 사이클 — `npm i better-sqlite3@12.10.1` 또는 `npm update` |
| **L-13 analyze-impact use_cache 무해** | 스키마-default 핸들러 미강제, 캐시 비활성=느려질 뿐 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-14 CVE-2026-25727 time 크레이트 (미도달)** | tree-sitter로 거론되나 실제 Rust `time` 크레이트 결함, Cynapx prod 트리 미도달 (**verdict: 추적만, 비-actionable**) | 범위 제외 — tree-sitter Rust 생태계 모니터링 신호로만 추적 |

---

## 5. 유지보수 모드 포스처 ("정기 점검" 이월)

1. **공급망 위생(매 사이클)**: prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0 유지. 신규 advisory 시 `overrides`로 패치 floor. 의존 추가 시 binding.gyp 검토 + `npm ci` + 매 사이클 `npm ls`/in-tree `.claude`/`.cursor`/`.gemini` 설정 재대조(현재 `.claude/launch.json` 양성, 0건). **lockfile patch-level 드리프트(L-11, better-sqlite3 12.10.0→12.10.1) 정기 정렬 후보 — 다음 의존성 정렬 사이클에서 일괄 처리 권장.**
2. **MCP SDK v2 stable 배포 모니터링**: `@modelcontextprotocol/sdk` latest가 *여전히 1.29.0*(v2 pre-alpha, stable Q3 2026 예정). 2.x로 전환(또는 v2 stable)되면 L-3 actionable화. 그 전까지 핀 `^1.29.0` 유지.
3. **런타임 수명주기**: Node 22 LTS·tree-sitter 신버전·tree-sitter-c-sharp 0.23.6+ 출현 시 정렬. Node 24 LTS 전환은 node-tree-sitter#268 해소 후. 문서 Node 버전(L-12, P24-2 해소)은 코드와 동기화 유지.
4. **회귀 안전망·핸들러 위생**: 새 도구/REST 라우트/이벤트 핸들러/엔진 비즈니스 로직/**핸들러 보조 순수 로직**/핸들러 인자 검증의 미커버·불일치 발견 시 vitest 케이스 추가(P18-1→P19-1→P20-1→P22-1→P23-1/2/3→P24-1→P25-1/2→**P26-1/2** 확장). **P26-1로 처방·검색을 떠받치는 RRF 융합까지 회귀 게이트 커버 완성**(graph/ 엔진 + 핸들러 보조 순수 로직 미커버 공백 0 — `escapeXml`/`escapeDot`은 우선순위 낮은 추적만). **P26-2로 `qualified_name` 10개 핸들러 전부 strict 가드 정합 완성**(M-2 v22+M-2 v23으로 인자-가드 정합성 점검 2종 완료). 도구 핸들러 인자명↔엔진 호출 인자명 + 스키마-required 인자의 핸들러 검증 유무 대조를 정기 점검 항목에 유지.

---

## 6. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 26-(docs) | diagnostic-v23 + phase26-plan 신규 docs | 1 | 없음 (docs-only) |
| 26-1 [예정] | M-1 v23: `tests/_utils.test.ts`(신규) 또는 `tests/tool-dispatcher.test.ts`에 `mergeResultsRRF()` 게이트(의존 0 순수 함수, 테스트-only) — RRF 점수 공식·dedup boost·정렬·limit slice·빈 입력 (목표: 신규 >=5 케이스, vitest 634→639+) | 1 | 매우 낮음 |
| 26-2 [예정] | M-2 v23: `get-related-tests.ts` `qualified_name` strict 가드 정렬(~3줄, 형제 핸들러 동형) + 디스패처 케이스 갱신/추가 (목표: 신규 >=3 케이스, vitest 639+→642+) | 1 (26-1과 합본 가능) | 매우 낮음 |

**총 2~3개 커밋(P26-1·P26-2 분리/합본).** 두 항목은 서로 독립(다른 파일·다른 부류)이라 순서 무관·합본 무방(둘 다 작고 리스크 낮음 — 1~2항목 제한 원칙 부합).

---

## 7. 향후 후보 (Phase 26 범위 밖 — 기록 유지)

- **MCP transport v2 마이그레이션(L-3)**: SDK v2 여전히 pre-alpha. `@modelcontextprotocol/sdk` latest가 2.x로 전환되거나 v2 stable(Q3 2026) 시 P15-3 설계 메모 기반 착수.
- **better-sqlite3 lockfile 정렬(L-11)**: `npm i better-sqlite3@12.10.1`로 Current 12.10.0→12.10.1 정렬 — 다음 의존성 정렬 사이클.
- **escapeXml/escapeDot 게이트**: `_utils.ts`의 단순 정규식 치환 함수 — 게이트 가치 낮음, P26-1과 함께 추가하거나 별도 추적.
- **SCIP export**: P18-1 + P19-1 디딤돌 마련 완료, protobuf 의존 부담으로 즉시 비권장. CodeGraph/Serena 생태계 상호운용 신호 시 재검토.
- **L-9 잔여 클린업**: update-pipeline `withWriteTransaction()` 추출, progress `log.error` 재분류, 빈 catch 2건 — update-pipeline 리팩터 페이즈로.
- **admin CLI 게이트화(L-7)** / **worker-pool/embedding/migration 게이트화(L-8)**: 각각 핸들러 export 리팩터 / SCHEMA_VERSION 증분 시 함께.
- **L-4 IPC MessagePack** / **L-5 클러스터링 파티셔닝**: 실측 트리거 시.
- **Node 24 LTS 전환** / **tree-sitter-c-sharp 0.23.6+ 정렬**: 신버전·환경 확정 후.
- **analyze-impact `use_cache` 스키마-default 강제(L-13)**: 핸들러에서 `args.use_cache ?? true`로 스키마-default를 명시 강제하는 미세 개선 — 무해라 우선순위 낮음.
- **L-14 CVE-2026-25727 모니터링**: tree-sitter Rust 생태계 신호 — Cynapx 미도달이나 tree-sitter 코어/그래머 업데이트 시 재확인.
