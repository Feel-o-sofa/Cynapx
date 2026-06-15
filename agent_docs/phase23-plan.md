# Phase 23 작업 계획 — diagnostic-v20 대응

> **작성**: 2026-06-15 / **기준 문서**: `agent_docs/diagnostic-v20.md` (기준 커밋 `79ce7ff`, Phase 22 + Phase 22-1 완료)
> **목표**: diagnostic-v20이 발견한 **무위험 actionable 2건(M-1 v20, M-2 v20)** 을 해소한다. 둘 다 "graph/ 엔진 비즈니스 로직 자체가 라이브 MCP 도구 뒤에서 게이트 밖에 있다"는 P22-1과 동형의 격차이며, (b) 잣대(작고·테스트 동반·저위험)를 깨끗하게 충족한다. **M-1 v20**: `RemediationEngine.getRemediationStrategy()`(순수 함수, 7분기)가 0% 커버 → 테이블-드리븐 회귀 테스트 신규(prod 코드 무변경). **M-2 v20**: `OptimizationEngine.findDeadCode()`의 `optimizationPotential`이 빈 그래프에서 `"NaN%"`을 반환 → ~2줄 가드 + 경계 테스트. L-10(RefactoringEngine/PolicyDiscoverer 엔진 게이트 잔여)은 선택적 P23-3으로 시도하되, 범위가 무거우면 다음 사이클로 이연한다. 계속 보류/이연/추적 항목(L-2~L-9, L-11)은 추적만 갱신한다(4장).
>
> **맥락**: v19가 (b) 잣대로 L-9 클린업을 재판정해 architecture-engine 1건을 수확(P22-1)했듯, v20은 그 재판정의 *사각*을 짚었다 — 과거 3-way 대조(v15~v17)는 "도구 등록·디스패처 라우팅·인자검증"까지만 게이트화했고, *엔진 비즈니스 로직 자체*는 architecture-engine(P22-1) 외엔 게이트 밖이었다. graph/ 엔진 5종(architecture/optimization/remediation/refactoring/policy-discoverer)을 실제로 읽고 테스트 파일과 대조한 결과, remediation(7분기 순수 함수, 0% 커버)과 optimization(빈-그래프 division-by-zero 경계)이 P22-1과 동형의 "라이브 도구 뒤 미커버 순수/경계 분기"로 드러났다. 둘 다 prod 코드 변경이 ~0~2줄이거나 0줄(테스트-only)이라 리스크가 매우 낮다. 따라서 Phase 23은 **엔진-로직 게이트 2 서브 페이즈(P23-1·P23-2, 필수) + 선택적 P23-3(L-10 RefactoringEngine) + 추적 갱신**이며, 예상 **2~3커밋**(diagnostic-v20 + phase23-plan docs 커밋 1 + P23-1/P23-2 커밋 1 + 선택적 P23-3 커밋 1).

---

## 0. 작업 원칙

- P23-1은 **prod 코드 무변경**(테스트-only) — `RemediationEngine.getRemediationStrategy()`는 순수 함수(입력 `ArchitectureViolation` 리터럴 → 출력 `RemediationRecipe`, DB·side-effect·async 0)이므로 모킹·픽스처 없이 직접 인스턴스화해 호출 가능.
- P23-2는 **prod 코드 ~2줄 변경**(division-by-zero 가드) + 경계 테스트 1건. 비-빈 그래프 동작은 완전 동일(부동소수점 표현이 `toFixed(2)`를 거치므로 가드 분기와 산술 분기 모두 `"X.XX%"` 형태로 일치 — 가드는 `totalSymbols === 0`일 때만 분기).
- Phase 종료 시(P23-1+P23-2) `npx vitest run` **594 + 신규 케이스(>=8) 그린**, `npx tsc --noEmit` 그린, `npm audit` 0, `npm audit --omit=dev` 0 확인.
- Phase 종료 시 `agent_docs/diagnostic-v20.md`의 M-1 v20·M-2 v20에 [DONE] 마킹.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.** (`.git/info/exclude`에 이미 등록되어 있으므로 `git status --short`는 항상 깨끗해야 한다.)
- 한 사이클(1~2 항목) 제한 원칙에 따라, 구현 사이클은 보통 **P23-1과 P23-2를 하나의 작업 단위로 묶어 처리**한다(둘 다 작고 독립적이며 같은 패턴이라 합쳐도 리스크 증가 없음). P23-3은 별도 사이클로 분리해도 무방.

---

## 1. 의존성 맵

```
P23-1 (RemediationEngine.getRemediationStrategy() 7분기 게이트 — 테스트-only)   독립.
  └─ tests/remediation-engine.test.ts 신규
        ← RemediationEngine은 GraphEngine 의존 없음 — `new RemediationEngine()`만으로 인스턴스화
        ← 7개 ArchitectureViolation 리터럴(분기별 1개) → getRemediationStrategy() → strategy/steps[0] 단언
        ← prod 코드 무변경

P23-2 (OptimizationEngine.findDeadCode() 빈-그래프 NaN% 가드 — ~2줄 + 경계 테스트)   독립.
  └─ src/graph/optimization-engine.ts:53 optimizationPotential 계산에 totalSymbols===0 가드
  └─ tests/optimization-engine.test.ts에 신규 it: createInMemoryEngine()만(노드 0개) → findDeadCode() → optimizationPotential === '0.00%' && deadSymbols === 0 단언

P23-3 (선택, L-10 부분 해소: RefactoringEngine.getRiskProfile() 게이트 — 테스트-only)
  └─ tests/refactoring-engine.test.ts 신규
        ← getRiskProfile()은 graphEngine.getNodeByQualifiedName() 1회 룩업만 사용 — stub 가벼움
        ← churn/complexity/coupling 가중 → CRITICAL(>0.8)/HIGH(>0.5)/MEDIUM(>0.2)/LOW 임계 케이스별 단언
        ← proposeRefactor()(BFS traverse)는 범위 제외 — 다음 사이클
```

```
L-2 (Miasma / Phantom Gyp — 캠페인 계속 진행)  ──추적만──→  [`npm ls` + in-tree `.claude`/`.cursor`/`.gemini` 설정 무결성 재대조; 도달 0건 불변]
L-3 (MCP stateless/task 마이그레이션)          ──이연──→  [SDK v2 npm 정식 배포(Q3 2026 ~7-28 stable 예고)까지]
L-4 (IPC MessagePack)                          ──계속 보류──
L-5 (클러스터 본격 파티셔닝)                    ──계속 이연──→  [100k+ 노드 실측 시]
L-6 (Node 24 tree-sitter 빌드)                  ──추적만──→  [node-tree-sitter#268 해소 + Node 24 LTS 전환 시]
L-7 (admin CLI cmd* 게이트 공백)                ──추적만(비-actionable)──
L-8 (worker-pool/embedding/migration 잔여 분기) ──추적만(비-actionable)──
L-9 (update-pipeline 클린업 잔여)               ──추적만(비-actionable)──
L-10 (RefactoringEngine/PolicyDiscoverer 게이트 잔여)  ──P23-3에서 RefactoringEngine.getRiskProfile() 부분 해소 시도, PolicyDiscoverer는 다음 사이클──
L-11 (better-sqlite3 12.10.0→12.10.1 lockfile 정렬)  ──다음 정기 갱신 시──
```

---

## 2. Phase 23-1: RemediationEngine.getRemediationStrategy() 7분기 회귀 게이트 (M-1 v20) — 테스트-only [DONE]

**목표**: `src/graph/remediation-engine.ts`의 `getRemediationStrategy(violation: ArchitectureViolation): RemediationRecipe`는 순수 함수이며 7개 분기(아래 표)를 갖는다. 현재 `tests/`에 remediation-engine 전용 테스트 파일이 없고, `tests/tool-dispatcher.test.ts`는 엔진을 `remediationEngine: {} as any`로 stub해 인자 가드(`{}` → "Missing required argument", `{violation:{}}` → "Invalid violation object")만 검증한다 — 엔진 자체의 분기 로직은 0% 커버. **prod 코드는 무변경**(테스트-only).

| # | 분기 (소스 라인) | 트리거 조건 | 기대 `strategy` |
|---|------------------|-------------|------------------|
| 1 | line 17-27 | `!violation.source \|\| !violation.target` | `'Insufficient Violation Data'` |
| 2 | line 33-44 | `violation.policyId === 'circular-dependency'` | `'Dependency Decoupling (Abstractions or Events)'` |
| 3 | line 47-58 | `target.tags.includes('layer:api')` && (`source.tags.includes('layer:core')` \|\| `source.tags.includes('layer:data')`) | `'Dependency Inversion via Interface/DTO'` |
| 4 | line 61-72 | `source.tags.includes('role:utility')` && (`target.tags.includes('role:service')` \|\| `target.tags.includes('role:repository')`) | `'Stateless Helper Extraction'` |
| 5 | line 75-85 | `source.tags.includes('role:repository')` && `target.tags.includes('role:repository')` | `'Service-Layer Orchestration'` |
| 6 | line 88-99 | `(source.cyclomatic ?? 0) > 30` \|\| `(source.loc ?? 0) > 500` | `'Single Responsibility Principle (SRP) Decomposition'` |
| 7 | line 102-111 | 위 분기 전부 불일치(default) | `'Architectural Decoupling'` |

| 항목 | 파일 | 작업 |
|------|------|------|
| 신규 테스트 파일 | `tests/remediation-engine.test.ts` (신규) | `RemediationEngine`을 `new RemediationEngine()`으로 직접 인스턴스화(생성자 의존 없음 — `src/graph/remediation-engine.ts:12` 확인). 테이블-드리븐 `it.each` 또는 7개 개별 `it`로 위 표의 7분기를 각각 트리거하는 `ArchitectureViolation` 리터럴을 구성해 `getRemediationStrategy()` 호출 → `result.strategy === '<기대값>'` 단언(+ 최소 1건은 `steps[0]`이 비어있지 않음/`rationale`이 string임도 확인). |
| 분기 1 케이스 | (위 파일) | `{ source: undefined as any, target: undefined as any, edge: {} as any, policyId: 'x', description: 'x' }` (또는 `source`/`target`만 빠진 부분 객체) → `'Insufficient Violation Data'`. |
| 분기 2 케이스 | (위 파일) | `policyId: 'circular-dependency'`, `source`/`target`은 최소 유효 `CodeNode`(tags 없음) → `'Dependency Decoupling (Abstractions or Events)'`. **주의: 분기 순서상 분기 2가 분기 3~6보다 먼저 체크되므로, tags를 비워 다른 분기와 충돌하지 않게 한다.** |
| 분기 3 케이스 | (위 파일) | `source.tags: ['layer:core']`, `target.tags: ['layer:api']`, `policyId`는 `'circular-dependency'` 아님(예: `'layered-architecture'`) → `'Dependency Inversion via Interface/DTO'`. |
| 분기 4 케이스 | (위 파일) | `source.tags: ['role:utility']`, `target.tags: ['role:service']` → `'Stateless Helper Extraction'`. |
| 분기 5 케이스 | (위 파일) | `source.tags: ['role:repository']`, `target.tags: ['role:repository']` → `'Service-Layer Orchestration'`. |
| 분기 6 케이스 | (위 파일) | `source.cyclomatic: 31` (또는 `loc: 501`), `source.tags`/`target.tags`는 분기 3~5와 매칭되지 않도록(예: 빈 배열) → `'Single Responsibility Principle (SRP) Decomposition'`. |
| 분기 7 케이스 | (위 파일) | 위 어느 조건도 만족하지 않는 최소 violation(`tags: []`, `cyclomatic: 0`, `policyId: 'other-policy'`) → `'Architectural Decoupling'`, `rationale`에 `violation.description`이 포함되는지 확인(`rationale: \`Illegal relationship detected: ${violation.description}.\``). |
| `CodeNode` 최소 픽스처 | (위 파일) | `ArchitectureViolation.source`/`target`은 `CodeNode` 전체 타입이지만 분기 판정에 쓰이는 필드는 `tags`/`cyclomatic`/`loc`/`qualified_name`뿐이다. 헬퍼 `makeNode(overrides: Partial<CodeNode>): CodeNode`로 필수 필드(`qualified_name`, `symbol_type`, `language`, `file_path`, `start_line`, `end_line`, `visibility`, `is_generated`, `last_updated_commit`, `version`)에 더미 값을 채우고 `overrides`를 병합. `edge: CodeEdge`도 더미(필수 필드만) 채움. |
| 베이스라인 재확인 | (검증) | `npx vitest run` 594 + 신규(7개 이상) 그린, `npx tsc --noEmit` 그린, `npm audit` 0·`npm audit --omit=dev` 0(불변). |
| M-1 v20 마킹 | `agent_docs/diagnostic-v20.md` | M-1 v20에 `[DONE]` + 신규 테스트 파일·케이스 수 기록. |

**설계 메모**:
- 분기 평가 순서가 중요하다(2→3→4→5→6→7, 1은 최우선 가드). 테스트 픽스처는 의도한 분기 *이전의* 모든 분기 조건을 회피해야 한다(예: 분기 6 테스트의 `source.tags`/`target.tags`는 분기 3~5 조건을 만족하면 안 됨).
- `RemediationRecipe`(`strategy: string; rationale: string; steps: string[]`)는 `src/types/index.ts:68`에서 import. `ArchitectureViolation`(`source/target: CodeNode; edge: CodeEdge; policyId: string; description: string`)은 `src/graph/architecture-engine.ts:26`에서 import.
- 분기 1의 가드는 `!violation.source || !violation.target` — `source`/`target`을 `undefined`로 두면 TypeScript 타입상 `ArchitectureViolation`과 불일치하므로 `as any`로 캐스팅하거나, 테스트 객체 자체를 `Partial<ArchitectureViolation> as ArchitectureViolation`으로 캐스팅.

**테스트**: `npx vitest run` 594 + 신규(>=7) 그린이 1차 검증 산출물. `npx tsc --noEmit` 그린, `npm audit` 0/0(불변).

**산출물**: 1개 신규 파일(`tests/remediation-engine.test.ts`) + diagnostic-v20 M-1 [DONE]. **리스크: 없음**(prod 코드 0줄 변경, 테스트-only 추가).

---

## 3. Phase 23-2: OptimizationEngine.findDeadCode() 빈-그래프 NaN% 가드 (M-2 v20) — ~2줄 + 경계 테스트 [DONE]

**목표**: `src/graph/optimization-engine.ts:53`의 `optimizationPotential` 계산은 `((highRows.length + mediumRows.length + lowRows.length) / totalSymbols) * 100`이며, `totalSymbols`(line 40, `SELECT COUNT(*) FROM nodes`)가 0인 빈 그래프에서 `0/0 = NaN` → `optimizationPotential: "NaN%"`가 `find_dead_code` 도구 응답에 그대로 노출된다. 픽스는 `totalSymbols === 0`일 때 `'0.00%'`를 반환하는 ~2줄 가드이며, 비-빈 그래프의 기존 산술 결과는 완전 동일(가드는 0-분기에만 적용).

| 항목 | 파일 | 작업 |
|------|------|------|
| division-by-zero 가드 | `src/graph/optimization-engine.ts:53` | ```ts\nconst deadCount = highRows.length + mediumRows.length + lowRows.length;\nconst optimizationPotential = totalSymbols === 0\n    ? '0.00%'\n    : `${((deadCount / totalSymbols) * 100).toFixed(2)}%`;\n``` 그 후 `summary.optimizationPotential: optimizationPotential` (및 `deadSymbols: deadCount`로 기존 `highRows.length + mediumRows.length + lowRows.length` 중복 계산을 재사용해도 되나, **필수는 아님** — 최소 변경은 `optimizationPotential` 라인만 3항 연산자로 감싸는 것). 반환 형태(`OptimizationReport.summary` 모양)·시그니처·비-빈 그래프 동작은 완전 동일. |
| 빈-그래프 경계 테스트 | `tests/optimization-engine.test.ts` (신규 `it`, 기존 `describe` 블록 내) | `beforeEach`의 `createInMemoryEngine()`으로 만든 빈 DB에서 **노드를 하나도 심지 않고** `await optEngine.findDeadCode()` 호출 → `result.summary.totalSymbols === 0`, `result.summary.deadSymbols === 0`, `result.summary.optimizationPotential === '0.00%'`(NOT `'NaN%'`) 단언. |
| 베이스라인 재확인 | (검증) | `npx vitest run` 594(P23-1 이후 601+) + 신규 그린, `npx tsc --noEmit` 그린, `npm audit` 0·`npm audit --omit=dev` 0(불변). |
| M-2 v20 마킹 | `agent_docs/diagnostic-v20.md` | M-2 v20에 `[DONE]` + 가드 추가·경계 테스트 기록. |

**설계 메모**:
- `nodeRepo.findDeadCodeCandidates('high'|'medium'|'low')`는 빈 DB(노드 0개)에서 모두 빈 배열을 반환하므로 `highRows.length + mediumRows.length + lowRows.length === 0`이고, `totalSymbols === 0`이므로 가드 없이는 `(0/0)*100 = NaN`.
- 비-빈 그래프(`totalSymbols > 0`)에서는 가드 분기를 타지 않으므로 기존 산술식이 그대로 실행 — 동작 완전 동일. 기존 8개 테스트(line 64~)는 전부 노드 1개 이상이라 영향 없음.

**테스트**: `npx vitest run` 통과 케이스 수가 (P23-1 이후 baseline) + 1 이상 증가 확인. `npx tsc --noEmit` 그린, `npm audit` 0/0(불변).

**산출물**: `src/graph/optimization-engine.ts`(~2줄) + `tests/optimization-engine.test.ts`(신규 1 case) + diagnostic-v20 M-2 [DONE]. **리스크: 매우 낮음**(division-by-zero 가드만 추가, 비-0 분기 동작 무변경, 경계 테스트로 회귀 봉쇄).

---

## 4. Phase 23-3 (선택): RefactoringEngine.getRiskProfile() 게이트 (L-10 부분 해소) — 테스트-only [DONE]

**목표**: L-10이 식별한 두 엔진(RefactoringEngine, PolicyDiscoverer) 중 `RefactoringEngine.getRiskProfile()`만 우선 게이트화한다. `getRiskProfile()`은 `graphEngine.getNodeByQualifiedName()` 1회 룩업 + churn(0.4)/complexity(0.3)/coupling(0.3) 가중합 → `CRITICAL(>0.8)/HIGH(>0.5)/MEDIUM(>0.2)/LOW` 임계 분류로, stub 1개로 테스트 가능하다. `proposeRefactor()`(BFS traverse, `graphEngine.traverse()` 호출)은 그래프 픽스처가 더 무거우므로 **본 사이클에서는 범위 제외**, 다음 사이클(또는 PolicyDiscoverer와 함께) 처리.

**선행 작업(구현 전 필수 확인)**: `src/graph/refactoring-engine.ts`를 직접 읽고 `getRiskProfile()`의 정확한 시그니처·가중 공식·임계값·반환 타입(`RiskProfile` 등)을 확인할 것 — 본 계획의 가중치(0.4/0.3/0.3)·임계값(0.8/0.5/0.2)은 diagnostic-v20 §4 L-10의 서술을 인용한 것으로, 실제 소스와 차이가 있으면 실제 소스를 따른다.

| 항목 | 파일 | 작업 |
|------|------|------|
| 신규 테스트 파일 | `tests/refactoring-engine.test.ts` (신규) | `RefactoringEngine` 생성자 의존(아마 `GraphEngine`)을 stub — `getNodeByQualifiedName`만 필요한 값을 반환하도록 mock. churn/complexity/coupling 조합별로 `getRiskProfile(qualifiedName)` 호출 → `riskLevel`(또는 실제 필드명) 이 `CRITICAL`/`HIGH`/`MEDIUM`/`LOW` 임계에 맞게 분류되는지 단언(임계값 경계 포함 — 예: 정확히 0.8/0.5/0.2 부근). |
| 베이스라인 재확인 | (검증) | `npx vitest run` 이전 baseline + 신규 그린, `npx tsc --noEmit` 그린, `npm audit` 0·`npm audit --omit=dev` 0(불변). |
| L-10 부분 갱신 | `agent_docs/diagnostic-v20.md` | L-10에 "RefactoringEngine.getRiskProfile() 게이트 완료, proposeRefactor·PolicyDiscoverer는 다음 사이클" 갱신. |

**산출물**: `tests/refactoring-engine.test.ts`(신규) + diagnostic-v20 L-10 부분 갱신. **리스크: 낮음**(테스트-only). **이 서브페이즈는 선택이다** — 구현 사이클에서 P23-1+P23-2로 이미 1세트를 채웠다면, P23-3은 다음 사이클로 넘겨도 된다(작업량 1~2항목 제한 원칙).

---

## 5. 보류/이연 항목 판정 (diagnostic-v20 → Phase 23 verdict)

| 항목 | diagnostic-v20 판정 | Phase 23 처리 |
|------|--------------------|---------------|
| **M-1 v20 RemediationEngine 7분기 게이트** | 순수 함수·0% 커버·테스트-only (**verdict: actionable, 작고·테스트 동반·저위험**) | **P23-1에서 해소** |
| **M-2 v20 OptimizationEngine NaN% 경계** | division-by-zero, ~2줄 가드 (**verdict: actionable, 작고·테스트 동반·저위험**) | **P23-2에서 해소** |
| **L-10 RefactoringEngine/PolicyDiscoverer 게이트 잔여** | getRiskProfile은 가벼움(stub 1개), proposeRefactor/discoverPolicies는 픽스처 무거움 (**verdict: 부분 actionable**) | **P23-3(선택)에서 getRiskProfile만 부분 해소**, proposeRefactor·PolicyDiscoverer는 다음 사이클 |
| **L-2(v20) Miasma / Phantom Gyp 포스처** | 캠페인 계속 진행 중, Cynapx 도달 0건 재대조 (**verdict: 추적만**) | 추적 상태만 갱신 — `npm ls` + in-tree 에이전트 설정 재점검 |
| **L-3(v20) MCP stateless/task 마이그레이션** | SDK v2 2026-07-28 RC 잠금, npm 정식 미배포(latest 1.29.x) (**verdict: 계속 이연**) | 범위 제외 — npm `latest` 2.x 전환 시 |
| **L-4(v20) IPC MessagePack** | 성능 문제 미관측 (**verdict: 계속 보류**) | 범위 제외 |
| **L-5(v20) 클러스터링 본격 파티셔닝** | count-first 가드(200k)가 현재 OOM 방어 (**verdict: 계속 이연**) | 범위 제외 |
| **L-6(v20) Node 24 tree-sitter 빌드** | node-tree-sitter#268 여전히 open (**verdict: 추적**) | 추적 상태만 갱신 |
| **L-7(v20) admin CLI cmd* 게이트 공백** | 모듈-private, 리팩터 수반 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-8(v20) worker-pool/embedding/migration 잔여 분기** | 인접 분기 커버 + flaky 위험 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-9(v20) update-pipeline 클린업 잔여** | (b) 잣대 미충족 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-11(v20) better-sqlite3 12.10.0→12.10.1** | lockfile-only, 비-긴급 (**verdict: 추적, 다음 정기 갱신**) | 범위 제외 |

---

## 6. 유지보수 모드 포스처 ("정기 점검" 이월)

1. **공급망 위생(매 사이클)**: prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0 유지. 신규 advisory 시 `overrides`로 패치 floor. 의존 추가 시 binding.gyp 검토 + `npm ci` + 매 사이클 `npm ls`/in-tree `.claude`/`.cursor`/`.gemini` 설정 재대조(현재 `.claude/launch.json` 양성, 0건).
2. **MCP SDK v2 npm 배포 모니터링**: npm `latest`가 2.x로 전환되면 L-3 actionable화. 그 전까지 1.29.x 유지.
3. **런타임 수명주기**: Node 22 LTS·tree-sitter 신버전·better-sqlite3 12.10.1(L-11)·tree-sitter-c-sharp 0.23.6+ 출현 시 정렬. Node 24 LTS 전환은 node-tree-sitter#268 해소 후.
4. **회귀 안전망·문서 위생**: 새 도구/REST 라우트/이벤트 핸들러/**엔진 비즈니스 로직**의 미커버 분기 발견 시 vitest 케이스 추가(P18-1→P19-1→P20-1→P22-1→**P23-1/P23-2** 확장). PolicyDiscoverer·RefactoringEngine.proposeRefactor(L-10 잔여)는 다음 사이클 후보.

---

## 7. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 23-(docs) | diagnostic-v20 + phase23-plan 신규 docs | 1 | 없음 (docs-only) |
| 23-1 [DONE] (vitest 603) | M-1 v20: `tests/remediation-engine.test.ts` 신규 — `getRemediationStrategy()` 7분기 테이블-드리븐 게이트(테스트-only) | 1 (23-2와 합본) | 없음 |
| 23-2 [DONE] (vitest 603) | M-2 v20: `optimization-engine.ts` 빈-그래프 `NaN%` → `'0.00%'` 가드(~2줄) + 경계 테스트 | 1 (23-1과 합본) | 매우 낮음 |
| 23-3 (선택) [DONE] (vitest 608) | L-10 부분: `tests/refactoring-engine.test.ts` 신규 — `getRiskProfile()` 임계/가중 게이트(테스트-only) | 1 | 낮음 |

**총 3~4개 커밋(P23-3 포함 시).** P23-1·P23-2는 둘 다 작고 독립적이며 같은 "라이브 도구 뒤 미커버 순수/경계 분기 게이트" 패턴이므로 한 구현 사이클에서 함께 처리하는 것을 권장한다(1~2항목 제한 원칙에 부합). P23-3은 선택이며 다음 사이클로 넘겨도 무방.

---

## 8. 향후 후보 (Phase 23 범위 밖 — 기록 유지)

- **PolicyDiscoverer.discoverPolicies() 게이트화(L-10 잔여)**: DB-heavy 집계, in-memory 그래프 픽스처 + 다수 노드 셋업 필요 — P23-3 이후 별도 사이클.
- **RefactoringEngine.proposeRefactor() 게이트화(L-10 잔여)**: `graphEngine.traverse()` BFS 호출 — 그래프 픽스처 무거움, P23-3(getRiskProfile) 이후.
- **MCP transport v2 마이그레이션**: SDK v2 npm `latest`가 2.x로 전환되면 L-3 + P15-3 설계 메모 기반 착수.
- **SCIP export**: P18-1 + P19-1 디딤돌 마련 완료, protobuf 의존 부담으로 즉시 비권장.
- **L-9 잔여 클린업**: update-pipeline `withWriteTransaction()` 추출, progress `log.error` 재분류, 빈 catch 2건 — update-pipeline 리팩터 페이즈로.
- **admin CLI 게이트화(L-7)** / **worker-pool/embedding/migration 게이트화(L-8)**: 각각 핸들러 export 리팩터 / SCHEMA_VERSION 증분 시 함께.
- **L-4 IPC MessagePack** / **L-5 클러스터링 파티셔닝**: 실측 트리거 시.
- **Node 24 LTS 전환** / **tree-sitter-c-sharp 0.23.6+ / better-sqlite3 12.10.1(L-11) 정렬**: 신버전·환경 확정 후.
