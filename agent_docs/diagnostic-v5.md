# Cynapx v1.0.7 종합 진단서 (Phase 7 개선 계획)

> **작성일**: 2026-04-04 (12차 세션)
> **진단 방법**: 독립 Explore 에이전트 전체 소스 정밀 코드 리뷰 (Phase 6 완료 후)
> **진단 범위**: 동시성 안전성, 에러 처리, 타입 안전성, 성능, 리소스 관리

---

## Phase 7 구현 현황

| 항목 | 상태 | 커밋 |
|------|------|------|
| C-1 (getContext null 역참조) | ✅ 완료 | PR #16 |
| H-1 (embedding-manager 레이스 컨디션) | ✅ 완료 | PR #16 |
| H-2 (search_symbols Promise.all 전파 실패) | ✅ 완료 | PR #16 |
| H-3 (reTagAllNodes 동기 DB 이벤트 루프 블로킹) | ✅ 완료 | PR #16 |
| H-4 (bootstrap 예외 시 타이머/리소스 미정리) | ✅ 완료 | PR #16 |
| M-1 (IPC timeout handler pendingRequests 누수) | ✅ 완료 | PR #16 |
| M-2 (file-watcher syncWithGit 실패 복구 없음) | ✅ 완료 | PR #16 |
| M-3 (get_callers/callees N+1 쿼리) | ✅ 완료 | PR #16 |
| M-4 (MCP 도구 인수 런타임 검증 부재) | ✅ 완료 | PR #16 |
| M-5 (processBatch 파싱 실패 시 에러 메시지 미저장) | ✅ 완료 | PR #16 |
| M-6 (get_symbol_details node 타입 가드 불완전) | ✅ 완료 | PR #16 |
| L-1 (readFileSync ENOENT/EACCES 구분 없음) | ✅ 완료 | PR #16 |
| L-2 (Array.isArray(node.tags) 불필요한 이중 체크) | ✅ 완료 | PR #16 |

---

## 목차

1. [진단 요약](#1-진단-요약)
2. [CRITICAL](#2-critical)
3. [HIGH](#3-high)
4. [MEDIUM](#4-medium)
5. [LOW](#5-low)
6. [Wave 설계](#6-wave-설계)

---

## 1. 진단 요약

| 우선순위 | 항목 수 | 완료 | 잔여 |
|----------|---------|------|------|
| 🔴 CRITICAL | 1 | 0 | 1 |
| 🟠 HIGH | 4 | 0 | 4 |
| 🟡 MEDIUM | 6 | 0 | 6 |
| 🟢 LOW | 2 | 0 | 2 |
| **합계** | **13** | **0** | **13** |

---

## 2. CRITICAL

---

### C-1: `tool-dispatcher.ts` — `getContext()` null 역참조로 프로세스 크래시

**파일**: `src/server/tool-dispatcher.ts` (다수 case)
**우선순위**: 🔴 CRITICAL

**현상**:
```typescript
case 'analyze_impact': {
    const ctx = deps.getContext();
    const node = ctx.graphEngine!.getNodeByQualifiedName(args.qualified_name);
    // ctx가 null이면 TypeError: Cannot read properties of null
```

`deps.getContext()`가 null을 반환하는 경우(미초기화 프로젝트, 병렬 purge/initialize 중)에 대한 처리가 없다. `analyze_impact`, `get_callers`, `get_callees`, `get_callers_by_path`, `get_callees_by_path`, `re_tag_project`, `get_symbol_details`, `search_symbols` 등 거의 모든 tool case에서 동일 패턴.

**재현 조건**: `initialize_project` 없이 임의 MCP 도구 호출, 또는 `purge_index` 직후 다른 도구 호출.

**수정 방향**: `executeTool` 내에서 또는 각 case 앞에 null 가드 추가:
```typescript
const ctx = deps.getContext();
if (!ctx || !ctx.graphEngine) {
    return { isError: true, content: [{ type: 'text', text: 'No active project. Call initialize_project first.' }] };
}
```
또는 `deps.getContext()`가 null 시 McpError(InvalidRequest) throw하도록 래퍼 추가.

**수정 파일**: `src/server/tool-dispatcher.ts`
**노력**: M (1시간)

---

## 3. HIGH

---

### H-1: `embedding-manager.ts` — `pendingResolve/Reject` 레이스 컨디션

**파일**: `src/indexer/embedding-manager.ts:30-31, 97-102`
**우선순위**: 🟠 HIGH

**현상**:
```typescript
// 필드가 외부에서 접근 가능 (public 또는 최소한 동시 호출 가능)
if (this.pendingReject) {
    const reject = this.pendingReject;
    this.pendingResolve = null;
    this.pendingReject = null;
    reject(new Error('Sidecar unavailable; fallback mode active'));
}
```

Python sidecar 프로세스가 크래시되는 시점과 폴백 모드 전환 사이에 경합 상태 발생 가능. 동시 대기 중인 embedding 요청이 있을 때 이중 resolve/reject, 타입 불일치, 데드락 위험.

**수정 방향**: `pendingResolve/Reject` 쌍을 단일 객체로 묶고, 상태를 enum 기반 상태 머신으로 관리:
```typescript
type PendingRequest = { resolve: (v: number[]) => void; reject: (e: Error) => void } | null;
private pendingRequest: PendingRequest = null;
```
원자적으로 교체 후 reject 호출하여 중복 호출 방지.

**수정 파일**: `src/indexer/embedding-manager.ts`
**노력**: M (1시간)

---

### H-2: `search_symbols` — `Promise.all` 하나 실패 시 전체 실패

**파일**: `src/server/tool-dispatcher.ts` (search_symbols case)
**우선순위**: 🟠 HIGH

**현상**:
```typescript
const results = await Promise.all(deps.workspaceManager.getAllContexts().map(async (ctx) => {
    // 하나의 context에서 vectorRepo.search() 또는 embedding 생성 실패 →
    // 전체 Promise.all reject → 모든 프로젝트 검색 결과 손실
}));
```

여러 프로젝트가 마운트된 상태에서 하나만 실패해도 전체 `search_symbols` 호출이 실패한다.

**수정 방향**: `Promise.allSettled()` 사용 후 성공한 결과만 집계:
```typescript
const settled = await Promise.allSettled(
    deps.workspaceManager.getAllContexts().map(async (ctx) => { ... })
);
const results = settled
    .filter((r): r is PromiseFulfilledResult<...> => r.status === 'fulfilled')
    .flatMap(r => r.value);
```

**수정 파일**: `src/server/tool-dispatcher.ts`
**노력**: S (20분)

---

### H-3: `reTagAllNodes` — 5중 반복 동기 DB 쿼리로 이벤트 루프 블로킹

**파일**: `src/indexer/update-pipeline.ts` (reTagAllNodes 메서드)
**우선순위**: 🟠 HIGH

**현상**:
```typescript
for (let i = 0; i < 5; i++) {
    let changed = false;
    for (const [id, data] of nodeMap.entries()) {
        const outgoing = this.edgeRepo.getOutgoingEdges(id).filter(...);
        // 각 노드마다 DB 쿼리 → 수천 노드 × 5 패스 = 수만 번 동기 DB 쿼리
    }
}
```

대형 프로젝트(수천 노드)에서 `re_tag_project` 호출 시 메인 스레드 수 초~수십 초 블로킹. 이 동안 MCP 요청, REST API, 파일 워처 모두 응답 불능.

**수정 방향**: `setImmediate()`로 이벤트 루프 양보를 패스 사이에 삽입:
```typescript
for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setImmediate(resolve)); // 이벤트 루프 양보
    // ... 패스 로직
}
```
또는 전체 재태깅을 단일 SQL 배치로 최적화.

**수정 파일**: `src/indexer/update-pipeline.ts`
**노력**: M (1.5시간)

---

### H-4: `bootstrap.ts` — 예외 시 jitter 타이머/재시도 타이머 미정리

**파일**: `src/bootstrap.ts:165-195`
**우선순위**: 🟠 HIGH

**현상**:
```typescript
setTimeout(acquireAndRun, 2000);  // 재시도 타이머 등록
// 예외 발생 시 이 타이머가 lifecycle.track()에 등록되지 않아 정리 안 됨
```

`acquireAndRun()` 중 예외 발생 또는 `attemptFailover()`의 jitter 타이머가 lifecycle.dispose() 호출 없이 남음 → 좀비 타이머, 포트 점유 지속, lock 파일 미해제.

**수정 방향**: 모든 `setTimeout` 반환값을 lifecycle에 등록하거나, `try/finally`로 정리 보증:
```typescript
const retryTimer = setTimeout(acquireAndRun, 2000);
lifecycle.track({ dispose: () => clearTimeout(retryTimer) });
```

**수정 파일**: `src/bootstrap.ts`
**노력**: M (1시간)

---

## 4. MEDIUM

---

### M-1: `ipc-coordinator.ts` — timeout 핸들러에서 `pendingRequests.delete()` 누락

**파일**: `src/server/ipc-coordinator.ts`
**우선순위**: 🟡 MEDIUM

**현상**:
```typescript
this.pendingRequests.set(id, {
    resolve: (v: any) => { clearTimeout(timeout); resolve(v); },
    reject: (e: any) => { clearTimeout(timeout); reject(e); }
});
// timeout 핸들러:
const timeout = setTimeout(() => {
    reject(new Error('IPC timeout'));
    // ← pendingRequests.delete(id) 없음 → Map에 고아 항목 잔류
}, TIMEOUT_MS);
```

장기 실행 서버에서 타임아웃이 발생하는 요청이 누적되면 `pendingRequests` Map이 계속 증가한다.

**수정 방향**:
```typescript
const timeout = setTimeout(() => {
    this.pendingRequests.delete(id);
    reject(new Error('IPC timeout'));
}, TIMEOUT_MS);
```

**수정 파일**: `src/server/ipc-coordinator.ts`
**노력**: S (10분)

---

### M-2: `file-watcher.ts` — `syncWithGit()` 실패 시 복구 로직 없음

**파일**: `src/watcher/file-watcher.ts:70-89`
**우선순위**: 🟡 MEDIUM

**현상**:
```typescript
try {
    await this.pipeline.syncWithGit(this.projectPath);
} catch (error) {
    console.error('Error during Git-based catch-up from watcher:', error);
    // 에러 후 복구/재시도 없음 → 이후 파일 변경이 누락될 수 있음
}
```

Git sync 실패 후에도 정상 동작처럼 계속 진행. 실제로는 인덱스와 파일시스템 상태가 불일치.

**수정 방향**: 실패 상태 플래그(`this.syncFailed = true`) 설정 후 다음 `flush()` 호출 시 full sync 재시도. 또는 재시도 횟수 제한(max 3회).

**수정 파일**: `src/watcher/file-watcher.ts`
**노력**: M (45분)

---

### M-3: `get_callers`/`get_callees` — N+1 쿼리 패턴

**파일**: `src/server/tool-dispatcher.ts` (get_callers, get_callees case)
**우선순위**: 🟡 MEDIUM

**현상**:
```typescript
const callers = ctx.graphEngine!.getIncomingEdges(node.id!).map(e => ({
    qname: ctx.graphEngine!.getNodeById(e.from_id)?.qualified_name,
    // 각 edge마다 getNodeById() 호출 → edge N개 = N번 DB 쿼리
    line: e.call_site_line
}));
```

높은 fan-in/fan-out을 가진 심볼(예: 유틸리티 함수)의 경우 수백 개 쿼리 발생.

**수정 방향**: 단일 JOIN 쿼리로 edge + node 정보를 한 번에 조회:
```sql
SELECT e.from_id, e.call_site_line, n.qualified_name
FROM edges e JOIN nodes n ON e.from_id = n.id
WHERE e.to_id = ? AND e.type = 'calls'
```
또는 `getIncomingEdgesWithNodes()` 메서드를 NodeRepository/EdgeRepository에 추가.

**수정 파일**: `src/server/tool-dispatcher.ts`, `src/graph/edge-repository.ts` (또는 `node-repository.ts`)
**노력**: M (1시간)

---

### M-4: MCP 도구 인수 런타임 스키마 검증 부재

**파일**: `src/server/tool-dispatcher.ts:213, 234`
**우선순위**: 🟡 MEDIUM

**현상**:
```typescript
// executeTool(name: string, args: any, ...)
// args.threshold, args.metric 등 검증 없이 직접 사용
if (!ALLOWED_METRICS.includes(args.metric as AllowedMetric)) {
    // args.metric이 숫자(123)여도 TypeScript 컴파일 통과
}
```

잘못된 타입의 인수(예: `metric: 123`, `threshold: "abc"`)가 SQL 쿼리까지 전달되면 DB 에러 또는 비정상 결과.

**수정 방향**: 각 tool case 진입부에서 타입 검증 추가. Zod를 이미 사용 중이라면 스키마 재활용:
```typescript
if (typeof args.threshold !== 'number' || !Number.isInteger(args.threshold)) {
    return { isError: true, content: [{ type: 'text', text: 'threshold must be an integer' }] };
}
```

**수정 파일**: `src/server/tool-dispatcher.ts`
**노력**: M (1시간)

---

### M-5: `processBatch` — 파싱 실패 시 에러 메시지 미저장

**파일**: `src/indexer/update-pipeline.ts` (processBatch 메서드)
**우선순위**: 🟡 MEDIUM

**현상**:
```typescript
} catch (error) {
    console.error(`Failed to parse ${event.file_path}:`, error);
    return { event, status: 'error' as const };
    // error.message가 결과에 포함되지 않아 호출자가 실패 원인 알 수 없음
}
```

실패 결과에 에러 정보가 없어 상위 레이어에서 어떤 파일이 왜 실패했는지 추적 불가.

**수정 방향**:
```typescript
return { event, status: 'error' as const, error: (error as Error).message ?? String(error) };
```
반환 타입에 `error?: string` 필드 추가.

**수정 파일**: `src/indexer/update-pipeline.ts`
**노력**: S (20분)

---

### M-6: `get_symbol_details` — `node` 변수 타입 가드 불완전

**파일**: `src/server/tool-dispatcher.ts` (get_symbol_details case)
**우선순위**: 🟡 MEDIUM

**현상**:
```typescript
const node = ctx.graphEngine!.getNodeByQualifiedName(args.qualified_name);
if (!node) return { isError: true, ... };
if (args.summary_only) return { content: ... };
// early return 이후 node는 절대 null 아님 — TypeScript는 알지만 코드 흐름이 복잡
const snippet = content.slice(node.start_line - 1, node.end_line);
// node.start_line이 0이거나 end_line < start_line인 경우 빈 배열 반환 (silent)
```

`start_line`이 0인 경우 `content.slice(-1, node.end_line)` → 배열 끝에서 슬라이싱. `end_line < start_line`이면 빈 배열. 어느 경우에도 에러 없이 잘못된 소스가 반환됨.

**수정 방향**: 슬라이싱 전 유효성 검증:
```typescript
if (node.start_line < 1 || node.end_line < node.start_line) {
    text += '\n> [!WARNING] Invalid line range in DB.';
} else {
    const snippet = content.slice(node.start_line - 1, node.end_line);
    text += `\`\`\`\n${snippet.join('\n')}\n\`\`\``;
}
```

**수정 파일**: `src/server/tool-dispatcher.ts`
**노력**: S (15분)

---

## 5. LOW

---

### L-1: `readFileSync` 예외 — ENOENT/EACCES 구분 없는 경고

**파일**: `src/server/tool-dispatcher.ts` (get_symbol_details 파일 읽기)
**우선순위**: 🟢 LOW

**현상**:
```typescript
} catch (e) {
    text += `\n> [!WARNING] Source unavailable: ${e}`;
    // 파일 없음(ENOENT)과 권한 없음(EACCES)을 같은 메시지로 처리
}
```

**수정 방향**:
```typescript
} catch (e: any) {
    const reason = e.code === 'ENOENT' ? 'File not found'
        : e.code === 'EACCES' ? 'Permission denied'
        : String(e);
    text += `\n> [!WARNING] Source unavailable: ${reason}`;
}
```

**수정 파일**: `src/server/tool-dispatcher.ts`
**노력**: S (5분)

---

### L-2: `Array.isArray(node.tags)` — 불필요한 이중 체크

**파일**: `src/server/tool-dispatcher.ts` (get_symbol_details case)
**우선순위**: 🟢 LOW

**현상**:
```typescript
text += `- **Structural Tags**: ${Array.isArray(node.tags) ? node.tags.map(t => `${t}`).join(', ') : node.tags}\n`;
// node.tags의 타입이 string[] | string으로 정의되어 있다면 Array.isArray 필요
// 하지만 DB에서 JSON 파싱 후 항상 string[] 또는 null이라면 불필요한 분기
```

**수정 방향**: 타입 정의를 명확히 하고 불필요한 런타임 분기 제거. `node.tags.join(', ')` 또는 타입 가드 명확화.

**수정 파일**: `src/server/tool-dispatcher.ts`
**노력**: S (5분)

---

## 6. Wave 설계

### 파일 충돌 분석

| 파일 | 항목 |
|------|------|
| `src/server/tool-dispatcher.ts` | C-1, H-2, M-3, M-4, M-6, L-1, L-2 |
| `src/indexer/update-pipeline.ts` | H-3, M-5 |
| `src/indexer/embedding-manager.ts` | H-1 |
| `src/bootstrap.ts` | H-4 |
| `src/server/ipc-coordinator.ts` | M-1 |
| `src/watcher/file-watcher.ts` | M-2 |
| `src/graph/edge-repository.ts` (또는 유사) | M-3 (일부) |

---

### Wave 1 (병렬 4체인)

> Gate: `npx tsc --noEmit` 0 errors + `npx vitest run` 전체 통과

| Chain | 항목 | 파일 | 노력 |
|-------|------|------|------|
| A | C-1 + H-2 + M-4 + M-6 + L-1 + L-2 | `tool-dispatcher.ts` | L |
| B | H-3 + M-5 | `update-pipeline.ts` | M |
| C | H-1 | `embedding-manager.ts` | M |
| D | H-4 + M-1 + M-2 | `bootstrap.ts`, `ipc-coordinator.ts`, `file-watcher.ts` | M |

※ Chain A의 M-3도 `tool-dispatcher.ts` 수정이 포함되나, Edge repository JOIN 최적화는 별도 파일도 포함 가능. Chain A에 통합하되 edge-repository 수정은 Chain A 내에서 처리.
