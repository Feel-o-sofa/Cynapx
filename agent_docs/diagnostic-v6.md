# Cynapx Diagnostic v6 — MCP Tool 기능 평가 + 전체 코드베이스 정적 분석

> **작성일**: 2026-04-14  
> **기준 커밋**: PR #16 merge 이후 (Phase 7 완료 상태)  
> **방법론**: Stage 1 (MCP 20개 tool 기능 평가) + Stage 2 (4개 관점 정적 분석) 병렬 수행  
> **이전 진단**: diagnostic-v5.md (Phase 7, 13개 항목 — 모두 ✅)

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

| Tool | 등급 | 최대 심각도 | 핵심 문제 |
|------|------|-------------|-----------|
| `get_setup_context` | ✅ PASS | — | 없음 |
| `initialize_project` | ⚠️ WARN | HIGH | `mode` 파라미터 스키마 정의만 있고 구현에서 무시 |
| `search_symbols` | ⚠️ WARN | HIGH | context null guard 미적용 (Phase 7 C-1 누락) |
| `get_symbol_details` | ✅ PASS | MEDIUM | 경미한 edge case |
| `analyze_impact` | ⚠️ WARN | MEDIUM | `max_depth` 상한 없음 (무한 그래프 순회 가능) |
| `get_callers` | ⚠️ WARN | MEDIUM | `qualified_name` null 허용 경로 존재 |
| `get_callees` | ⚠️ WARN | MEDIUM | `qualified_name` null 허용 경로 존재 |
| `get_related_tests` | ❌ FAIL | CRITICAL | null guard 없음 + 인수 유효성 검사 없음 |
| `check_architecture_violations` | ⚠️ WARN | MEDIUM | context null guard 미적용 |
| `get_remediation_strategy` | ✅ PASS | — | 없음 |
| `propose_refactor` | ⚠️ WARN | HIGH | 인수 유효성 검사 없음 |
| `get_risk_profile` | ⚠️ WARN | HIGH | 인수 유효성 검사 없음 |
| `get_hotspots` | ⚠️ WARN | HIGH | `threshold` NaN 통과 (`typeof NaN === 'number'`) |
| `find_dead_code` | ❌ FAIL | HIGH | MEDIUM 신뢰도 SQL 로직 버그 — 항상 빈 결과 |
| `export_graph` | ❌ FAIL | CRITICAL | `format` 파라미터 스키마 vs. 구현 불일치 |
| `check_consistency` | ❌ FAIL | CRITICAL | context null guard 없음 → 즉시 크래시 |
| `purge_index` | ❌ FAIL | CRITICAL | context null guard 없음 (confirm=true 경로에서 크래시) |
| `re_tag_project` | ❌ FAIL | CRITICAL | null guard 없음 + `updatePipeline` undefined 크래시 |
| `backfill_history` | ❌ FAIL | CRITICAL | null guard 없음 + `updatePipeline` undefined 크래시 |
| `discover_latent_policies` | ❌ FAIL | CRITICAL | null guard 없음 + NaN/음수 파라미터 미검증 |

**요약**: PASS 3개 / WARN 8개 / FAIL 9개

---

## 2. Stage 2 — 코드베이스 정적 분석

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

#### reTagAllNodes 트랜잭션 경계 버그 (Phase 7 H-3 회귀)

```typescript
// update-pipeline.ts — 현재 코드 (버그 있음)
for (let pass = 0; pass < 5; pass++) {
    await new Promise<void>(resolve => setImmediate(resolve)); // ← 트랜잭션 밖
    db.transaction(() => { /* 해당 pass 커밋 */ })();
}
```

`setImmediate()` 가 `db.transaction()` 경계 **밖**에 위치 → 동시에 실행되는 `processBatch()` 호출이 pass 사이에 노드를 수정 → `reTagAllNodes` 가 나중에 커밋할 때 동시 수정 내용을 덮어씀.

**해결**: `setImmediate` → `db.transaction()` 내부로 이동하거나, 전체 5-pass를 하나의 트랜잭션으로 묶어 원자적 실행 보장.

#### readline 인터페이스 누수 (embedding-manager.ts)

프로세스 재시작 시 최대 3개의 readline 인터페이스가 닫히지 않고 누수. `rl.close()` 호출 위치 부재.

#### dispose() 타이머 미정리 (file-watcher.ts)

`dispose()` 시 flush 타이머가 정리되지 않아 종료된 watcher에서 파이프라인 콜백이 호출될 수 있음.

### 2-C. 보안 분석

#### initialize_project 심볼릭 링크 공격

```typescript
// Phase 6 SEC-C-2 현재 구현 (tool-dispatcher.ts)
const resolved = path.resolve(args.projectPath);
// ← fs.realpathSync() 없음!
```

홈 디렉토리 내 심볼릭 링크(`~/link → /etc/`)가 `path.resolve()` 경계 검사를 통과 → 임의 경로 인덱싱 가능.

#### 파일 권한 0o644 (lock-manager.ts, api-server.ts)

IPC 포트 + nonce가 담긴 lock 파일과 API 포트 파일이 기본 umask(0o644)로 작성 → 동일 시스템의 다른 사용자가 읽기 가능 → nonce 도용으로 IPC 인증 우회.

#### discover_latent_policies NaN/음수 파라미터

`min_confidence`, `max_policies` 파라미터에 NaN 또는 음수 전달 시 SQL 쿼리에 그대로 삽입.

### 2-D. 아키텍처 / 구조 분석

#### Terminal 모드에서 re_tag / backfill 크래시

Terminal 모드에서는 `toolDeps.getContext()` 가 null을 반환. `re_tag_project` / `backfill_history`는 `getContext()!` 패턴이므로 즉시 크래시. null guard가 없음.

#### 다중 MCP 세션 toolDeps 레이스 컨디션

`toolDeps` 객체가 세션 간 공유됨. `onInitialize` 콜백이 동시에 두 세션에서 호출될 경우, `setIsInitialized(true)` 가 race condition 발생. 세션별 독립 상태 관리 필요.

#### CYNAPX_INSTRUCTIONS "Phase 14" 오기재

```typescript
// mcp-server.ts
const CYNAPX_INSTRUCTIONS = `...Cynapx Phase 14...`; // 실제 버전: v1.0.6
```

AI 에이전트에게 잘못된 버전 정보를 전달.

#### initialize_project mode 파라미터 미구현

스키마: `enum: ["current", "existing", "custom"]`  
구현: `args.mode` 를 전혀 읽지 않음. `"existing"` / `"custom"` 모드 동작이 `"current"` 와 동일.

---

## 3. 통합 이슈 목록 (우선순위별)

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

## 4. Phase 8 구현 계획

### Wave 설계 원칙

- 파일 충돌 없는 체인을 병렬 실행
- Gate = `tsc --noEmit` (0 errors) + `vitest run` (전체 통과)
- 각 Wave 완료 후 Gate 통과 확인

### Wave 1 — Critical 수정 (3개 체인 병렬)

**Chain A** (`tool-dispatcher.ts` null guard 10개 + NaN 수정):
- C-1: 10개 unguarded tool에 `getContext()` null guard 추가
- H-3: `get_hotspots` threshold `Number.isNaN()` 검사 추가
- H-4: `propose_refactor`, `get_risk_profile` 인수 유효성 검사
- M-2: `discover_latent_policies` NaN/음수 검사
- M-5: `get_callers`, `get_callees` null qualified_name 검사
- M-4: `analyze_impact` max_depth 상한(예: 20) 적용

**Chain B** (`update-pipeline.ts` 동시성 수정):
- C-2: `reTagAllNodes` 5-pass 전체를 단일 `db.transaction()` 으로 래핑 (setImmediate 제거 또는 트랜잭션 내부로 이동)

**Chain C** (`tool-dispatcher.ts` export_graph + find_dead_code):
- C-3: `export_graph` format별 실제 직렬화 구현 (json/graphml/dot)
- H-2: `optimization-engine.ts` MEDIUM SQL 버그 수정 (불가능 WHERE 조건 제거)

### Wave 2 — High/Medium 수정 (3개 체인 병렬)

**Chain D** (`tool-dispatcher.ts` 기능 완성):
- H-1: `initialize_project` mode 파라미터 구현 (`"existing"`: DB 재사용, `"custom"`: 파라미터로 경로 지정)
- H-5: `fs.realpathSync()` 심볼릭 링크 방어
- M-3: `optimization-engine.ts` nodeRepo.db 직접 접근 → public getter 또는 전용 메서드 추가

**Chain E** (보안 강화):
- M-1: `lock-manager.ts` + `api-server.ts` 파일 권한 `0o600` 적용
- M-6: JSON.parse 보호 (tags/history/modifiers) — try-catch + fallback 기본값

**Chain F** (안정성 + 아키텍처):
- M-7: `embedding-manager.ts` readline.close() 호출 추가
- M-8: `file-watcher.ts` dispose() 타이머 정리
- M-9: `mcp-server.ts` "Phase 14" → "v1.0.6" 수정
- H-6: toolDeps onInitialize race condition — 뮤텍스 또는 세션별 초기화 상태 분리
- L-3: Terminal 모드 명시적 에러 반환

### Wave 2 Gate
- tsc 0 errors
- vitest 전체 통과 (현재 146개 + 신규)
- 신규 테스트: null guard 동작, NaN 거부, export_graph format별 출력, find_dead_code SQL

---

## 5. 현황 스냅샷

| 항목 | Phase 6 완료 후 | Phase 7 완료 후 | Phase 8 목표 |
|------|----------------|----------------|-------------|
| 테스트 수 | 146 | 146 | 170+ |
| tsc 오류 | 0 | 0 | 0 |
| Critical 이슈 | 0 (Phase 6/7로 해소) | 0 | 0 |
| MCP Tool FAIL | — | — (신규 발견) | 0 |
| 미구현 Tool 기능 | — | — | 0 |

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

*이 문서는 Stage 1 (20개 MCP Tool 기능 평가) + Stage 2 (4개 관점 정적 분석) 결과를 통합한 것임.*  
*다음 단계: Phase 8 Wave 1 → Wave 2 순차 구현.*
