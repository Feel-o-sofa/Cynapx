# Cynapx Diagnostic v6 — MCP Tool 기능 평가 + 전체 코드베이스 정적 분석

> **작성일**: 2026-04-14  
> **기준 커밋**: PR #18 merge 이후 (Phase 8 + 통합 테스트 완료)  
> **방법론**: Stage 1 (MCP 20개 tool 기능 평가) + Stage 2 (4개 관점 정적 분석) 병렬 수행  
> **이전 진단**: diagnostic-v5.md (Phase 7, 13개 항목 — 모두 ✅)
> **구현 완료**: Phase 8 (PR #17, 2026-04-14) + syncWithGit 버그 수정 (PR #18, 2026-04-15)

---

## 1. Stage 1 — MCP Tool 기능 평가 (20개 Tool)

### 평가 기준

| 기준 | 설명 |
|------|------|
| **정합성** | 입력 스키마 정의 vs. 실제 구현 일치 여부 |
| **안전성** | null guard, 인수 유효성 검사 적용 여부 |
| **정확성** | SQL/로직이 의도한 결과를 반환하는지 |
| **오류 처리** | 에러 응답이 명확하고 isError 플래그가 올바른지 |
| **상태 보호** | 파괴적 작업 전 확인 절차 존재 여부 |

### Tool 평가 결과 테이블

| Tool | 진단 당시 등급 | 현재 상태 | Phase 8 수정 내용 |
|------|--------------|-----------|------------------|
| `get_setup_context` | ✅ PASS | ✅ PASS | — |
| `initialize_project` | ⚠️ WARN | ✅ PASS | mode 3종 구현 + realpathSync 심볼릭 링크 방어 + 뮤텍스 |
| `search_symbols` | ⚠️ WARN | ✅ PASS | null guard 추가 |
| `get_symbol_details` | ✅ PASS | ✅ PASS | — |
| `analyze_impact` | ⚠️ WARN | ✅ PASS | max_depth 상한 20 적용 |
| `get_callers` | ⚠️ WARN | ✅ PASS | null qualified_name 가드 |
| `get_callees` | ⚠️ WARN | ✅ PASS | null qualified_name 가드 |
| `get_related_tests` | ❌ FAIL | ✅ PASS | null guard + 인수 검증 추가 |
| `check_architecture_violations` | ⚠️ WARN | ✅ PASS | null guard 추가 |
| `get_remediation_strategy` | ✅ PASS | ✅ PASS | — |
| `propose_refactor` | ⚠️ WARN | ✅ PASS | 인수 유효성 검사 추가 |
| `get_risk_profile` | ⚠️ WARN | ✅ PASS | 인수 유효성 검사 추가 |
| `get_hotspots` | ⚠️ WARN | ✅ PASS | NaN threshold 거부 |
| `find_dead_code` | ❌ FAIL | ✅ PASS | MEDIUM SQL 버그 수정 |
| `export_graph` | ❌ FAIL | ✅ PASS | json/graphml/dot 3종 포맷 구현 |
| `check_consistency` | ❌ FAIL | ✅ PASS | null guard 추가 |
| `purge_index` | ❌ FAIL | ✅ PASS | confirm=true 경로 null guard 추가 |
| `re_tag_project` | ❌ FAIL | ✅ PASS | null guard + Terminal 모드 가드 |
| `backfill_history` | ❌ FAIL | ✅ PASS | null guard + Terminal 모드 가드 |
| `discover_latent_policies` | ❌ FAIL | ✅ PASS | null guard + NaN/음수 파라미터 검증 |

**요약 (Phase 8 완료 후)**: 전체 20개 Tool ✅ PASS — 통합 테스트 56/56 어서션 통과

---

## 2. Stage 2 — 코드베이스 정적 분석

> **✅ Phase 8 수정 완료** — 아래 모든 항목이 PR #17에서 수정되었음.

### 2-A. 타입 안전성 분석

**파일**: 전체 `src/` (52개 TypeScript 파일)

| 항목 | 수량 | 심각도 |
|------|------|--------|
| `as any` 캐스팅 | 43+ 곳 | MEDIUM–HIGH |
| Non-null assertion `!` | 67+ 곳 | MEDIUM–CRITICAL |
| `JSON.parse()` try-catch 미보호 | 다수 | MEDIUM |
| `optimization-engine.ts` DB 직접 접근 | 1곳 | MEDIUM |

핵심 위험 지점:
- `const db = (this.graphEngine.nodeRepo as any).db` — `optimization-engine.ts`: 캡슐화 우회, `nodeRepo.db`가 private으로 변경되면 런타임 오류
- `node.tags` / `node.history` / `node.modifiers` JSON.parse 무보호: 손상된 DB 레코드 시 크래시

### 2-B. 오류 처리 / 동시성 안전성 분석

#### reTagAllNodes 트랜잭션 경계 버그 (Phase 7 H-3 회귀) → ✅ 수정됨 (PR #17 C-2)

```typescript
// update-pipeline.ts — 현재 코드 (버그 있음)
for (let pass = 0; pass < 5; pass++) {
    await new Promise<void>(resolve => setImmediate(resolve)); // ← 트랜잭션 밖
    db.transaction(() => { /* 해당 pass 커밋 */ })();
}
```

`setImmediate()` 가 `db.transaction()` 경계 **밖**에 위치 → 동시에 실행되는 `processBatch()` 호출이 pass 사이에 노드를 수정 → `reTagAllNodes` 가 나중에 커밋할 때 동시 수정 내용을 덮어씀.

**해결**: `setImmediate` → `db.transaction()` 내부로 이동하거나, 전체 5-pass를 하나의 트랜잭션으로 묶어 원자적 실행 보장.

#### readline 인터페이스 누수 → ✅ 수정됨 (PR #17 M-7)

프로세스 재시작 시 최대 3개의 readline 인터페이스가 닫히지 않고 누수. `rl.close()` 호출 위치 부재.

#### dispose() 타이머 미정리 → ✅ 수정됨 (PR #17 M-8)

`dispose()` 시 flush 타이머가 정리되지 않아 종료된 watcher에서 파이프라인 콜백이 호출될 수 있음.

### 2-C. 보안 분석

#### initialize_project 심볼릭 링크 공격 → ✅ 수정됨 (PR #17 H-5)

```typescript
// Phase 6 SEC-C-2 현재 구현 (tool-dispatcher.ts)
const resolved = path.resolve(args.projectPath);
// ← fs.realpathSync() 없음!
```

홈 디렉토리 내 심볼릭 링크(`~/link → /etc/`)가 `path.resolve()` 경계 검사를 통과 → 임의 경로 인덱싱 가능.

#### 파일 권한 0o644 → ✅ 수정됨 (PR #17 M-1)

IPC 포트 + nonce가 담긴 lock 파일과 API 포트 파일이 기본 umask(0o644)로 작성 → 동일 시스템의 다른 사용자가 읽기 가능 → nonce 도용으로 IPC 인증 우회.

#### discover_latent_policies NaN/음수 → ✅ 수정됨 (PR #17 M-2)

`min_confidence`, `max_policies` 파라미터에 NaN 또는 음수 전달 시 SQL 쿼리에 그대로 삽입.

### 2-D. 아키텍처 / 구조 분석

#### Terminal 모드에서 re_tag / backfill 크래시 → ✅ 수정됨 (PR #17 L-3)

Terminal 모드에서는 `toolDeps.getContext()` 가 null을 반환. `re_tag_project` / `backfill_history`는 `getContext()!` 패턴이므로 즉시 크래시. null guard가 없음.

#### 다중 MCP 세션 toolDeps 레이스 컨디션 → ✅ 수정됨 (PR #17 H-6)

`toolDeps` 객체가 세션 간 공유됨. `onInitialize` 콜백이 동시에 두 세션에서 호출될 경우, `setIsInitialized(true)` 가 race condition 발생. 세션별 독립 상태 관리 필요.

#### CYNAPX_INSTRUCTIONS "Phase 14" 오기재 → ✅ 수정됨 (PR #17 M-9)

```typescript
// mcp-server.ts
const CYNAPX_INSTRUCTIONS = `...Cynapx Phase 14...`; // 실제 버전: v1.0.6
```

AI 에이전트에게 잘못된 버전 정보를 전달.

#### initialize_project mode 파라미터 미구현 → ✅ 수정됨 (PR #17 H-1)

스키마: `enum: ["current", "existing", "custom"]`  
구현: `args.mode` 를 전혀 읽지 않음. `"existing"` / `"custom"` 모드 동작이 `"current"` 와 동일.

---

## 3. 통합 이슈 목록 (우선순위별)

> **✅ 모든 항목 Phase 8 (PR #17)에서 수정 완료.**

### CRITICAL (즉시 수정 필요)

| ID | 분류 | 파일 | 문제 | 영향 |
|----|------|------|------|------|
| C-1 | 안전성 | `tool-dispatcher.ts` | 10개 Tool context null guard 누락: `get_related_tests`, `check_architecture_violations`, `propose_refactor`, `get_risk_profile`, `find_dead_code`, `export_graph`, `check_consistency`, `purge_index`, `re_tag_project`, `backfill_history`, `discover_latent_policies` | 프로젝트 미초기화 상태에서 즉시 크래시 |
| C-2 | 동시성 | `update-pipeline.ts` | `reTagAllNodes` setImmediate이 트랜잭션 경계 밖 — 동시 쓰기로 데이터 손상 | 동시 인덱싱 시 태그 데이터 무결성 파괴 |
| C-3 | 정확성 | `tool-dispatcher.ts` | `export_graph` format 파라미터 스키마(`"json"/"graphml"/"dot"`) vs. 구현 불일치 | 항상 단일 형식만 반환, 스키마 계약 위반 |

### HIGH (Phase 8 Wave 1 목표)

| ID | 분류 | 파일 | 문제 | 영향 |
|----|------|------|------|------|
| H-1 | 기능 | `tool-dispatcher.ts` | `initialize_project` mode 파라미터 미구현 | `"existing"/"custom"` 모드가 동작하지 않음 |
| H-2 | 정확성 | `optimization-engine.ts` | `find_dead_code` MEDIUM 신뢰도 SQL: `symbol_type NOT IN ('class','interface','function') AND tags LIKE '%trait:internal%'` — 논리적 불가능 조합 → 항상 빈 결과 | MEDIUM 신뢰도 dead code 탐지 완전 비작동 |
| H-3 | 안전성 | `tool-dispatcher.ts` | `get_hotspots` threshold NaN 통과 (`typeof NaN === 'number'` true) | SQL에 NaN 삽입 → undefined behavior |
| H-4 | 안전성 | `tool-dispatcher.ts` | `propose_refactor`, `get_risk_profile` 인수 유효성 검사 없음 | 빈/null 인수로 크래시 또는 잘못된 결과 |
| H-5 | 보안 | `tool-dispatcher.ts` | `initialize_project` `fs.realpathSync()` 미사용 → 심볼릭 링크 경계 우회 | 임의 경로 인덱싱 |
| H-6 | 동시성 | `server/` (다중 파일) | 다중 MCP 세션 간 toolDeps 공유 → `onInitialize` race condition | 초기화 상태 오염 |

### MEDIUM

| ID | 분류 | 파일 | 문제 | 영향 |
|----|------|------|------|------|
| M-1 | 보안 | `lock-manager.ts`, `api-server.ts` | 파일 권한 0o644 — nonce/포트 파일 다른 사용자 읽기 가능 | 다중 사용자 환경에서 IPC 인증 우회 |
| M-2 | 안전성 | `tool-dispatcher.ts` | `discover_latent_policies` NaN/음수 min_confidence, max_policies | SQL에 잘못된 값 삽입 |
| M-3 | 타입 | `optimization-engine.ts` | `(this.graphEngine.nodeRepo as any).db` — 캡슐화 우회 | nodeRepo API 변경 시 런타임 오류 |
| M-4 | 안전성 | `tool-dispatcher.ts` | `analyze_impact` max_depth 상한 없음 | 깊은 그래프에서 무한 순회 / OOM |
| M-5 | 안전성 | `tool-dispatcher.ts` | `get_callers`, `get_callees` qualified_name null 경로 | null 입력 시 크래시 |
| M-6 | 타입 | 다수 파일 | JSON.parse (tags/history/modifiers) try-catch 미보호 | 손상 DB 레코드 시 크래시 |
| M-7 | 안정성 | `embedding-manager.ts` | readline 인터페이스 재시작 시 미종료 (최대 3개 누수) | 장시간 운영 시 파일 디스크립터 고갈 |
| M-8 | 안정성 | `file-watcher.ts` | dispose() 시 flush 타이머 미정리 | 종료된 watcher에서 파이프라인 호출 |
| M-9 | 정확성 | `mcp-server.ts` | `CYNAPX_INSTRUCTIONS` 내 "Phase 14" 오기재 | AI 에이전트에 잘못된 버전 정보 전달 |

### LOW

| ID | 분류 | 파일 | 문제 |
|----|------|------|------|
| L-1 | 타입 | 전체 src/ | `as any` 43+ 곳 점진적 제거 |
| L-2 | 타입 | 전체 src/ | Non-null assertion `!` 67+ 곳 — null guard로 교체 필요 |
| L-3 | 아키텍처 | `tool-dispatcher.ts` | Terminal 모드 re_tag/backfill 경로에 명시적 에러 반환 없음 |

---

## 4. Phase 8 구현 결과 (완료)

### 결과 요약

| Wave | 체인 수 | 수정 항목 | Gate 결과 |
|------|---------|-----------|-----------|
| Wave 1 | 3개 병렬 | C-1, C-2, C-3, H-2, H-3, H-4, M-2, M-4, M-5 | tsc 0 / vitest 146/146 ✅ |
| Wave 2 | 3개 병렬 | H-1, H-5, H-6, M-1, M-3, M-6, M-7, M-8, M-9, L-3 | tsc 0 / vitest 146/146 ✅ |

PR #17 merged: 2026-04-14T10:28:27Z

---

## 5. 현황 스냅샷

| 항목 | Phase 6 완료 후 | Phase 7 완료 후 | Phase 8 완료 후 |
|------|----------------|----------------|----------------|
| 테스트 수 | 146 | 146 | 146 (+ 통합 테스트 56 어서션) |
| tsc 오류 | 0 | 0 | 0 |
| Critical 이슈 | 0 | 0 | 0 |
| MCP Tool FAIL | — | 9개 발견 | 0 (전체 통과) |
| 미구현 Tool 기능 | — | mode/포맷 등 3개 | 0 |
| 실제 인덱싱 검증 | 미검증 | 미검증 | ✅ 64노드 116엣지 |

---

## 6. 파일별 수정 범위 요약

| 파일 | 수정 항목 |
|------|----------|
| `src/server/tool-dispatcher.ts` | C-1, C-3, H-1, H-3, H-4, H-5, M-2, M-4, M-5 |
| `src/indexer/update-pipeline.ts` | C-2 |
| `src/graph/optimization-engine.ts` | H-2, M-3 |
| `src/server/mcp-server.ts` | M-9 |
| `src/utils/lock-manager.ts` | M-1 |
| `src/server/api-server.ts` | M-1 (port 파일 권한) |
| `src/indexer/embedding-manager.ts` | M-7 |
| `src/watcher/file-watcher.ts` | M-8 |
| `src/server/` (다중) | H-6 (toolDeps race) |
| `src/db/` (다수) | M-6 (JSON.parse 보호) |

---

## 7. 통합 테스트 실행 결과 (PR #18, 2026-04-15)

실제 프로젝트 인덱싱 후 전 도구 검증. `scripts/integration-test.js` (56 어서션).

### 발견된 추가 버그 (즉시 수정)

| 버그 | 심각도 | 위치 | 수정 |
|------|--------|------|------|
| `syncWithGit()` 신규 DB에서 조기 반환 — `!lastCommit` 조건이 true일 때 즉시 return, 전체 인덱싱 불가 | **CRITICAL** | `update-pipeline.ts:351` | `lastCommit && lastCommit === currentHead` 로 조건 수정 + `GitService.getAllTrackedFiles()` 추가 |

### 실제 인덱싱 결과 (Cynapx 자기 자신 분석)

| 항목 | 값 |
|------|-----|
| 처리 파일 수 | 120개 (git ls-files) |
| 색인된 노드 | 64개 |
| 색인된 엣지 | 116개 |
| 아키텍처 위반 탐지 | ✅ (layer 위반 다수) |
| 잠재 정책 발견 | ✅ (layer:data→layer:data, prob=1.0 등) |
| 순환 복잡도 최고 파일 | `tool-dispatcher.ts` |
| fan_in 최고 | `graph-engine.ts` |

### 테스트 카테고리별 결과

| 카테고리 | 어서션 수 | 결과 |
|----------|-----------|------|
| Pre-init null guard (10 tools) | 10 | ✅ 10/10 |
| 인수 유효성 검사 | 8 | ✅ 8/8 |
| initialize_project (3 modes) | 4 | ✅ 4/4 |
| search_symbols | 2 | ✅ 2/2 |
| get_symbol_details | 2 | ✅ 2/2 |
| get_callers / get_callees | 3 | ✅ 3/3 |
| analyze_impact (depth cap) | 2 | ✅ 2/2 |
| get_hotspots (4 metrics) | 4 | ✅ 4/4 |
| find_dead_code (3 tiers) | 3 | ✅ 3/3 |
| export_graph (3 formats + invalid) | 4 | ✅ 4/4 |
| check_consistency | 1 | ✅ 1/1 |
| Architecture + policy tools | 2 | ✅ 2/2 |
| get_related_tests / remediation | 3 | ✅ 3/3 |
| purge_index 안전 가드 | 3 | ✅ 3/3 |
| Terminal mode guards | 2 | ✅ 2/2 |
| re_tag_project (실행) | 1 | ✅ 1/1 |
| **합계** | **56** | **✅ 56/56** |

---

*이 문서는 Stage 1 (20개 MCP Tool 기능 평가) + Stage 2 (4개 관점 정적 분석) 결과를 통합한 것임.*  
*Phase 8 구현 완료 (PR #17) + 통합 테스트 완료 (PR #18). 다음 진단: diagnostic-v7.md*
