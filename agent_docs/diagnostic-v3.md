# Cynapx v1.0.6 종합 진단서 (Phase 5 개선 계획)

> **작성일**: 2026-04-03 (9차 세션)
> **최종 업데이트**: 2026-04-03 (9차 세션)
> **진단 방법**: Phase 4 완료 후 전체 소스 정밀 코드 리뷰 (15개 핵심 파일)
> **진단 범위**: 기능 결함, 보안, 성능, 아키텍처, 유지보수성, 테스트 커버리지

## Phase 5 구현 현황

| 항목 | 상태 | PR |
|------|------|-----|
| C-1~C-2 (CRITICAL 전체) | ⏳ 대기 | Phase 5 |
| H-1~H-4 (HIGH 전체) | ⏳ 대기 | Phase 5 |
| M-1~M-5 (MEDIUM 전체) | ⏳ 대기 | Phase 5 |
| L-1~L-5 (LOW 전체) | ⏳ 대기 | Phase 5 |

---

## 목차

1. [진단 요약](#1-진단-요약)
2. [CRITICAL — 즉시 수정](#2-critical--즉시-수정)
3. [HIGH — 안정성/보안](#3-high--안정성보안)
4. [MEDIUM — 구조적 품질](#4-medium--구조적-품질)
5. [LOW — 장기 개선](#5-low--장기-개선)
6. [Wave 설계](#6-wave-설계)

---

## 1. 진단 요약

| 우선순위 | 항목 수 | 완료 | 잔여 | 핵심 위험 |
|----------|---------|------|------|-----------|
| 🔴 CRITICAL | 2 | 0 | 2 | SQL 인젝션, null 역참조 크래시 |
| 🟠 HIGH | 4 | 0 | 4 | 스택 오버플로우, 캡슐화 파괴, ready-promise 재사용 불가, 페이로드 유출 |
| 🟡 MEDIUM | 5 | 0 | 5 | 빈 쿼리 조기 반환, 고아 엣지, NaN DB 삽입, SIGTERM 누락, N+1 git 호출 |
| 🟢 LOW | 5 | 0 | 5 | 비결정적 셔플, 테스트 공백, 미사용 파라미터, MCP GET 인증, isChecking 고착 |
| **합계** | **16** | **0** | **16** | |

---

## 2. CRITICAL — 즉시 수정

---

### C-1. `get_hotspots` — SQL 인젝션 (tool-dispatcher.ts)

**파일**: `src/server/tool-dispatcher.ts:345`

**현상**: `args.metric` 값을 화이트리스트 검증 없이 SQL 쿼리 문자열에 직접 보간한다.
```typescript
const hotspots = db.prepare(
    `SELECT qualified_name, symbol_type, ${args.metric} FROM nodes
     WHERE ${args.metric} >= ? ORDER BY ${args.metric} DESC LIMIT 20`
).all(args.threshold || 0);
```
반면 `api-server.ts`의 `handleHotspots()`은 Zod enum 검증으로 보호된다. MCP 경로만 노출.

**영향**: `metric: "loc; DROP TABLE nodes;--"` 같은 값으로 DB 파괴 또는 데이터 탈취 가능. MCP는 인증 없는 stdio 채널이므로 접근 장벽이 낮다.

**해결책**:
```typescript
case 'get_hotspots': {
    const ALLOWED_METRICS = ['cyclomatic', 'fan_in', 'fan_out', 'loc'] as const;
    if (!ALLOWED_METRICS.includes(args.metric)) {
        return { isError: true, content: [{ type: 'text',
            text: `Invalid metric. Allowed: ${ALLOWED_METRICS.join(', ')}` }] };
    }
    // 이후 기존 쿼리 사용
}
```

**수정 파일**: `src/server/tool-dispatcher.ts`
**노력**: S (15분)
**의존성**: 없음

---

### C-2. `EmbeddingManager.refreshAll()` — null 반환값 역참조 크래시

**파일**: `src/indexer/embedding-manager.ts:113-116`, `277-288`

**현상**: `PythonEmbeddingProvider.generateBatch()`는 fallbackMode 시 `null as unknown as number[][]`를 반환한다. `refreshAll()`의 `enqueuedBatch()` 경로에서 이 null을 `vectors.forEach()`에 전달해 `TypeError`가 발생한다.
```typescript
// embedding-manager.ts:113-116
if (this.fallbackMode) {
    return null as unknown as number[][];  // 실제 null 반환
}

// embedding-manager.ts:279-280 — enqueuedBatch 결과 사용
this.db.transaction(() => {
    vectors.forEach((vector, idx) => { ... }); // null.forEach → TypeError
})();
```

**영향**: fallback 모드 진입 후 `refreshAll()` 호출 시마다 반복 실패. 임베딩 갱신 영구 중단.

**해결책**: `enqueuedBatch` 결과에 null 가드 추가:
```typescript
const vectors = await this.enqueuedBatch(snippets);
if (!vectors) {
    console.error('[EmbeddingManager] Batch returned null — skipping (fallback mode)');
    continue;
}
```

**수정 파일**: `src/indexer/embedding-manager.ts`
**노력**: S (15분)
**의존성**: 없음

---

## 3. HIGH — 안정성/보안

---

### H-1. `detectCycles()` — 재귀 DFS로 스택 오버플로우 위험 (architecture-engine.ts)

**파일**: `src/graph/architecture-engine.ts:157-184`

**현상**: `findCycles`가 재귀 함수로 구현되어 있다. Node.js 기본 콜 스택 한도 ~10,000-15,000 프레임. 깊은 호출 체인(데코레이터, 체인 패턴)에서 `Maximum call stack size exceeded` 발생.
```typescript
const findCycles = (nodeId: number, path: number[]) => {
    // ...
    findCycles(edge.to_id, [...path]);  // 재귀 — 스택 위험
};
```
`graph-engine.ts`의 BFS/DFS는 이미 반복적(iterative) 구현으로 교체됐지만 여기만 남아 있다.

**영향**: `check_architecture_violations`, `check_consistency` 호출 시 프로세스 크래시.

**해결책**: 명시적 스택 배열을 사용하는 반복적 DFS로 교체:
```typescript
// 재귀 제거 — 명시적 스택으로 교체
interface DfsFrame { nodeId: number; path: number[] }
const stack: DfsFrame[] = [{ nodeId: startId, path: [] }];
while (stack.length > 0) {
    const { nodeId, path } = stack.pop()!;
    // ... 기존 로직
    for (const edge of outgoing) {
        stack.push({ nodeId: edge.to_id, path: [...path, nodeId] });
    }
}
```

**수정 파일**: `src/graph/architecture-engine.ts`
**노력**: M (1시간)
**의존성**: 없음

---

### H-2. `persistClusters()` — `as any` private 필드 접근 + 비원자적 삭제 (graph-engine.ts)

**파일**: `src/graph/graph-engine.ts:233`

**현상**: `GraphEngine`이 `NodeRepository`의 내부 `db` 필드를 `as any`로 강제 접근한다.
```typescript
const db = (this.nodeRepo as any).db;  // 캡슐화 파괴
db.prepare('DELETE FROM logical_clusters').run();
db.prepare('UPDATE nodes SET cluster_id = NULL').run();
// 위 두 SQL이 별도 트랜잭션 — 부분 실패 시 데이터 불일치
```

**영향**: `NodeRepository`의 내부 구현 변경 시 런타임 실패. `DELETE`와 `UPDATE`가 별도 실행되므로 중간 상태 진입 가능.

**해결책**: `NodeRepository`에 `getDb(): Database` 메서드 추가 또는 클러스터 관련 SQL을 `NodeRepository.clearClusterData()` 메서드로 캡슐화. `DELETE` + `UPDATE`를 단일 트랜잭션으로 묶음.

**수정 파일**: `src/graph/graph-engine.ts`, `src/db/node-repository.ts`
**노력**: M (1시간)
**의존성**: 없음

---

### H-3. `markReady()` — `readyPromise` 재사용 불가: purge 후 상태 불일치 (mcp-server.ts)

**파일**: `src/server/mcp-server.ts:67, 89-95`

**현상**: `readyPromise`는 생성자에서 한 번만 생성된다. `purge_index` 후 `isInitialized=false`로 돌아가더라도, `waitUntilReady()`는 이미 resolved된 `readyPromise`를 await하여 즉시 통과한다. 실제로는 미초기화 상태임에도 도구가 실행된다.
```typescript
// 생성자에서 한 번만 생성
this.readyPromise = new Promise((resolve) => { this.resolveReady = resolve; });

// purge 후 waitUntilReady() → 이미 resolved → 즉시 통과 (버그)
await this.readyPromise;
```

**영향**: `purge_index` → `initialize_project` 재초기화 플로우에서 초기화 완료 전에 다른 도구들이 실행되어 null 참조 예외 발생 가능.

**해결책**: `markReady(false)` 시 `readyPromise`와 `resolveReady`를 재생성:
```typescript
public markReady(ready: boolean) {
    if (ready && this.resolveReady) {
        this.resolveReady();
        this.isInitialized = true;
        this.startHealthMonitor();
    } else if (!ready) {
        // purge 후 새 promise 생성
        this.isInitialized = false;
        this.readyPromise = new Promise((resolve) => { this.resolveReady = resolve; });
    }
}
```

**수정 파일**: `src/server/mcp-server.ts`
**노력**: S (30분)
**의존성**: 없음

---

### H-4. API 서버 로거 — POST 페이로드 평문 로깅 (api-server.ts)

**파일**: `src/server/api-server.ts:114-116`

**현상**: 모든 POST 요청 바디의 처음 200자를 로그에 출력한다.
```typescript
console.log(`  Payload: ${JSON.stringify(body).substring(0, 200)}`);
```
`qualified_name`, `query` 등 코드 심볼명·경로 정보가 구조화되지 않은 로그로 유출된다.

**영향**: `--bind 0.0.0.0` 환경에서 로그 집계 시스템에 코드 아키텍처 정보 노출. 기밀 코드베이스의 심볼명은 민감 정보.

**해결책**: 페이로드 로깅을 환경변수 플래그로 조건부 처리:
```typescript
if (process.env.CYNAPX_LOG_PAYLOADS === '1') {
    console.error(`  Payload: ${JSON.stringify(body).substring(0, 200)}`);
}
```
`console.log` → `console.error` 변경(MCP 모드 일관성).

**수정 파일**: `src/server/api-server.ts`
**노력**: S (15분)
**의존성**: 없음

---

## 4. MEDIUM — 구조적 품질

---

### M-1. `searchSymbols('')` — 빈 쿼리 조기 반환으로 `export_graph` 항상 빈 결과 (node-repository.ts, graph-engine.ts)

**파일**: `src/db/node-repository.ts:133`, `src/graph/graph-engine.ts:359, 410`

**현상**: `searchSymbols`는 빈 쿼리 시 즉시 `[]`을 반환한다. `getGraphData()`/`exportToMermaid()`의 "전체 그래프" 경로는 `searchSymbols('', 10)`으로 파일 노드를 찾는데, 항상 빈 배열을 반환한다.
```typescript
// node-repository.ts:133
if (!sanitizedQuery) return [];  // 빈 쿼리 차단

// graph-engine.ts:359
const allFiles = this.nodeRepo.searchSymbols('', 10).filter(...);  // 항상 []
```

**영향**: `export_graph` (root 미지정) 및 `exportToMermaid` 항상 빈 결과 반환.

**해결책**: `getGraphData()` / `exportToMermaid()`에서 root 미지정 시 `nodeRepo.getAllNodes()`의 파일 타입 필터 직접 사용:
```typescript
const allFiles = rootQName
    ? this.nodeRepo.searchSymbols(rootQName, 10).filter(...)
    : this.nodeRepo.getAllNodes().filter(n => n.symbol_type === 'file').slice(0, 10);
```

**수정 파일**: `src/graph/graph-engine.ts`
**노력**: S (30분)
**의존성**: 없음

---

### M-2. 노드 삭제 시 고아 엣지 잔류 (edge-repository.ts, update-pipeline.ts)

**파일**: `src/indexer/update-pipeline.ts` (applyDelta), `src/db/edge-repository.ts`

**현상**: `applyDelta()`에서 `nodeRepo.deleteNodesByFilePath(filePath)`를 호출하지만 해당 노드와 연결된 엣지를 삭제하지 않는다. 고아 엣지가 잔류한다.

**영향**: `fan_in`/`fan_out` 재계산 쿼리가 실제보다 높은 값 반환. `analyze_impact`, `get_callers` 결과에 삭제된 노드 참조 포함 가능.

**해결책**: `deleteNodesByFilePath()` 실행 전 관련 엣지를 명시적으로 삭제:
```typescript
// update-pipeline.ts의 applyDelta
const nodeIds = this.nodeRepo.getNodeIdsByFilePath(filePath);
for (const id of nodeIds) {
    this.edgeRepo.deleteEdgesByNodeId(id);  // 엣지 먼저 삭제
}
this.nodeRepo.deleteNodesByFilePath(filePath);
```
또는 DB 스키마에 `ON DELETE CASCADE` 추가 (스키마 마이그레이션 필요).

**수정 파일**: `src/indexer/update-pipeline.ts`, `src/db/node-repository.ts`
**노력**: M (1시간)
**의존성**: 없음

---

### M-3. `persistClusters()` — 단일 항목 클러스터 `NaN` avg_complexity DB 삽입 (graph-engine.ts)

**파일**: `src/graph/graph-engine.ts:239-242, 269-280`

**현상**: 클러스터의 노드 중 `nodeMap`에 없는 경우(DB-메모리 불일치) `node?.cyclomatic`이 `undefined`가 되어 `totalComplexity / clusterNodes.length`가 `NaN`이 되고 DB에 삽입된다.

**영향**: `avg_complexity` 컬럼에 `NaN` 저장. 이후 이 값을 사용하는 조회에서 예상치 못한 동작.

**해결책**: avg_complexity 계산에 NaN 가드 추가:
```typescript
const totalComplexity = clusterNodes.reduce((sum, id) => {
    return sum + (nodeMap.get(id)?.cyclomatic ?? 0);
}, 0);
const avgComplexity = clusterNodes.length > 0
    ? totalComplexity / clusterNodes.length
    : 0;
```

**수정 파일**: `src/graph/graph-engine.ts`
**노력**: S (15분)
**의존성**: H-2와 동일 파일 — **같은 체인에서 순차 작업**

---

### M-4. `SIGTERM` 핸들러 누락 — 컨테이너 종료 시 lock 파일 잔류 (bootstrap.ts)

**파일**: `src/bootstrap.ts:247`

**현상**: `SIGINT` 핸들러만 등록되어 있고 `SIGTERM`이 없다. Docker/Kubernetes의 graceful shutdown은 `SIGTERM`으로 전달된다.

**영향**: 컨테이너 재시작 시 `.lock` 파일 잔류. 다음 시작 시 stale lock 감지 로직이 WAL 파일까지 삭제하는 부작용.

**해결책**: `SIGINT` 핸들러와 동일한 로직을 `SIGTERM`에도 등록:
```typescript
const shutdown = async () => { ... };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

**수정 파일**: `src/bootstrap.ts`
**노력**: S (10분)
**의존성**: 없음

---

### M-5. `mapHistoryToProject()` — 파일당 N번 git 호출 (update-pipeline.ts)

**파일**: `src/indexer/update-pipeline.ts:101-127`

**현상**: 모든 파일에 대해 `await this.gitService.getHistoryForFile(filePath)`를 순차 호출한다. N개 파일 = N번의 `git log` 프로세스가 직렬 실행된다. SQLite 트랜잭션이 열려 있는 동안 다른 쓰기 작업이 차단된다.

**영향**: 수천 파일 코드베이스에서 `backfill_history` 호출 시 분 단위 지연.

**해결책**: git 호출을 트랜잭션 외부에서 병렬 처리 후 단일 배치 트랜잭션으로 저장:
```typescript
// 1. 트랜잭션 밖에서 병렬 수집
const CHUNK = 20;
const results: Array<{ filePath: string; history: CommitInfo[] }> = [];
for (let i = 0; i < filePaths.length; i += CHUNK) {
    const chunk = filePaths.slice(i, i + CHUNK);
    const histories = await Promise.all(
        chunk.map(fp => this.gitService.getHistoryForFile(fp)
            .then(h => ({ filePath: fp, history: h }))
            .catch(() => ({ filePath: fp, history: [] }))
        )
    );
    results.push(...histories);
}
// 2. 단일 트랜잭션으로 배치 업데이트
this.db.transaction(() => {
    for (const { filePath, history } of results) { ... }
})();
```

**수정 파일**: `src/indexer/update-pipeline.ts`
**노력**: M (1시간)
**의존성**: 없음

---

## 5. LOW — 장기 개선

| ID | 파일 | 내용 | 해결책 요약 | 노력 |
|----|------|------|-------------|------|
| L-1 | graph-engine.ts:181 | LPA `Math.random()` 셔플 — 비결정적 클러스터 결과 | 노드 ID 기반 결정론적 셔플 또는 문서화 | S |
| L-2 | tests/ | Phase 4 신규 코드(tool-dispatcher, LPA, enqueuedBatch) 테스트 전무 | `tool-dispatcher.test.ts`, `clustering.test.ts`, `embedding-queue.test.ts` 추가 | L |
| L-3 | graph-engine.ts:326 | DFS 미사용 `depth`/`path` 파라미터 — dead code | `dfs()` 시그니처에서 제거, 내부에서 `0`, `[]`로 초기화 | S |
| L-4 | api-server.ts:122-124 | MCP GET `/mcp` 인증 우회 — SSE 스트림 무인증 접근 | GET `/mcp`에도 세션 ID 기반 검증 추가 | M |
| L-5 | health-monitor.ts:21-44 | `isChecking` 예외 시 `false` 복구 누락 — 헬스체크 영구 중단 | `try { ... } finally { this.isChecking = false; }` | S |

---

## 6. Wave 설계

### 파일 충돌 분석

| 파일 | 관련 항목 |
|------|-----------|
| `tool-dispatcher.ts` | C-1 |
| `embedding-manager.ts` | C-2 |
| `architecture-engine.ts` | H-1 |
| `mcp-server.ts` | H-3 |
| `api-server.ts` | H-4, L-4 |
| `bootstrap.ts` | M-4 |
| `health-monitor.ts` | L-5 |
| `graph-engine.ts` | H-2, M-1(일부), M-3, L-1, L-3 |
| `node-repository.ts` | H-2(일부), M-2(일부) |
| `update-pipeline.ts` | M-2, M-5 |
| `tests/` (신규) | L-2 |

### Wave 1 — CRITICAL + 단순 독립 항목 (7 병렬 체인)

| Chain | 항목 | 파일 | 노력 |
|-------|------|------|------|
| A | C-1 | tool-dispatcher.ts | S |
| B | C-2 | embedding-manager.ts | S |
| C | H-1 | architecture-engine.ts | M |
| D | H-3 | mcp-server.ts | S |
| E | H-4 + L-4 | api-server.ts | S+M |
| F | M-4 | bootstrap.ts | S |
| G | L-5 | health-monitor.ts | S |

### Wave 2 — 복합 파일 체인 (3 병렬 체인)

| Chain | 항목 | 파일 | 노력 |
|-------|------|------|------|
| A | H-2 + M-1(graph) + M-3 + L-1 + L-3 | graph-engine.ts + node-repository.ts | M |
| B | M-2 + M-5 | update-pipeline.ts + node-repository.ts(일부) | M |
| C | L-2 | tests/ (신규 3개 파일) | L |

> Wave 2 Chain A와 B 모두 `node-repository.ts`를 수정하므로 주의: A는 `getDb()` 메서드 추가, B는 `getNodeIdsByFilePath()` 메서드 추가. 서로 다른 메서드이므로 충돌 없이 병렬 진행 가능 (단, merge 시 주의).
