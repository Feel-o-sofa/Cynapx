# Cynapx v1.0.6 종합 진단서 (Phase 2 개선 계획)

> **작성일**: 2026-04-02 (5차 세션)
> **최종 업데이트**: 2026-04-02 (6차 세션) — Phase 2 구현 완료, PR #12
> **진단 방법**: 전체 소스 2,941줄(핵심 11개 파일) 정밀 코드 리뷰 + 실측 검증
> **진단 범위**: 기능 결함, 보안, 성능, 아키텍처, 유지보수성

## Phase 2 구현 현황 (6차 세션)

| 항목 | 상태 | PR |
|------|------|-----|
| C-1~C-5 (CRITICAL 전체) | ✅ 완료 | #12 |
| H-1~H-6 (HIGH 전체) | ✅ 완료 | #12 |
| M-2, M-3, M-7 | ✅ 완료 | #12 |
| L-3, L-4, L-5, L-6, L-9 | ✅ 완료 | #12 |
| M-6 (cycle cache) | ✅ 완료 | #12 |
| L-1 (수렴 종료) | ✅ 이미 구현됨 (스킵) | — |
| **M-1** (McpServer God Object) | ⏳ 다음 세션 | Phase 3 |
| **M-4** (CrossProjectResolver) | ⏳ 다음 세션 | Phase 3 |
| **M-5** (EmbeddingManager 분리) | ⏳ 다음 세션 | Phase 3 |
| L-2 (Louvain 클러스터링) | ⏳ 다음 세션 | Phase 3 |
| L-7 (MCP session 정리) | ⏳ 다음 세션 | Phase 3 |
| L-8 (BFS/DFS 테스트) | ⏳ 다음 세션 | Phase 3 |
| L-10 (타입 가드 교체) | ⏳ 다음 세션 | Phase 3 |

**신규 발견 (자체 분석 도구)**: `worker-pool.ts` 내 순환 호출 (`processNext → replaceWorker → spawnWorker → processNext`) — Phase 3에서 처리

---

---

## 목차

1. [진단 요약](#1-진단-요약)
2. [CRITICAL — 즉시 수정](#2-critical--즉시-수정)
3. [HIGH — 안정성/보안](#3-high--안정성보안)
4. [MEDIUM — 구조적 품질](#4-medium--구조적-품질)
5. [LOW — 장기 개선](#5-low--장기-개선)
6. [의존성 그래프 및 실행 순서](#6-의존성-그래프-및-실행-순서)
7. [작업 Wave 설계](#7-작업-wave-설계)

---

## 1. 진단 요약

| 우선순위 | 항목 수 | 완료 | 잔여 | 핵심 위험 |
|----------|---------|------|------|-----------|
| 🔴 CRITICAL | 5 | **5** | 0 | 런타임 크래시, 리소스 누수, 메모리 폭발 |
| 🟠 HIGH | 6 | **6** | 0 | OOM, 보안, 캐시 불일치, 데이터 손상 |
| 🟡 MEDIUM | 7 | **3** | 4 | God object, 로깅 부재, 코드 중복 |
| 🟢 LOW | 10 | **7** | 3 (+ L-1 이미 구현) | 성능, 엣지케이스, 테스트 커버리지 |
| **합계** | **28** | **21** | **7** | |

---

## 2. CRITICAL — 즉시 수정

---

### C-1. TypeScript Parser null 역참조 크래시

**파일**: `src/indexer/typescript-parser.ts:289-290`

**현상**: `getSymbolAtLocation()`이 `undefined`를 반환할 수 있는데, 결과에 `!` (non-null assertion)을 사용하여 다음 줄에서 `getTypeOfSymbolAtLocation(tsSymbol!, ...)` 호출 시 크래시.

**재현 조건**: computed property name, 익명 함수 표현식, 또는 type-only import 심볼에서 발생.

**영향**: 해당 파일의 인덱싱이 중단되어 지식 그래프가 불완전해짐.

**해결책**:
```typescript
// Before
const tsSymbol = this.typeChecker.getSymbolAtLocation((node as any).name);
const tsType = this.typeChecker.getTypeOfSymbolAtLocation(tsSymbol!, (node as any).name);

// After
const nameNode = ts.isNamedDeclaration(node) ? node.name : undefined;
if (!nameNode) return { ...baseResult };
const tsSymbol = this.typeChecker.getSymbolAtLocation(nameNode);
if (!tsSymbol) return { ...baseResult };
const tsType = this.typeChecker.getTypeOfSymbolAtLocation(tsSymbol, nameNode);
```

**수정 파일**: `src/indexer/typescript-parser.ts`
**노력**: S (30분)
**의존성**: 없음

---

### C-2. Remote DB 연결 리소스 누수

**파일**: `src/indexer/update-pipeline.ts:349-353`

**현상**: `resolveNodeId()`에서 원격 프로젝트 DB를 열고 쿼리한 뒤 `remoteDb.close()`를 호출하지만, 쿼리가 예외를 throw하면 close에 도달하지 않아 파일 핸들이 누수됨.

**코드**:
```typescript
const remoteDb = new SQLiteDatabase(project.db_path, { readonly: true });
const remoteMatch = remoteStmt.get(...);  // 여기서 throw 가능
remoteDb.close();  // ← 도달 불가
```

**영향**: 장기 실행 시 OS 파일 핸들 한도 초과 → 이후 모든 DB 연산 실패.

**해결책**:
```typescript
const remoteDb = new SQLiteDatabase(project.db_path, { readonly: true });
try {
    const remoteStmt = remoteDb.prepare("...");
    const remoteMatch = remoteStmt.get(...) as any;
    if (remoteMatch) {
        // shadow node 생성 로직
        return shadowNodeId;
    }
} finally {
    remoteDb.close();
}
```

**수정 파일**: `src/indexer/update-pipeline.ts`
**노력**: S (15분)
**의존성**: 없음

---

### C-3. IPC 요청 무한 대기 (타임아웃 없음)

**파일**: `src/server/ipc-coordinator.ts:133-147`

**현상**: `forwardExecuteTool()`이 Promise를 생성하고 `pendingRequests` Map에 저장하지만, Host가 응답하지 않거나 연결이 끊기면 이 Promise가 영원히 resolve/reject되지 않음.

**코드**:
```typescript
return new Promise((resolve, reject) => {
    this.pendingRequests.set(id, { resolve, reject });
    this.client!.write(JSON.stringify(req) + '\n');
    // ← 타임아웃 없음, 연결 끊김 감지 없음
});
```

**영향**: Terminal 모드에서 MCP 도구 호출이 영구 행(hang). 클라이언트(Claude Code 등)가 무한 대기.

**해결책**:
```typescript
return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`IPC request '${name}' timed out after 30s`));
    }, 30_000);

    this.pendingRequests.set(id, {
        resolve: (v) => { clearTimeout(timeout); resolve(v); },
        reject: (e) => { clearTimeout(timeout); reject(e); }
    });
    this.client!.write(JSON.stringify(req) + '\n');
});
```

추가로 `client.on('close')` 이벤트에서 모든 pending 요청을 reject하는 정리 로직 필요.

**수정 파일**: `src/server/ipc-coordinator.ts`
**노력**: S (30분)
**의존성**: 없음

---

### C-4. BFS 경로 복사 메모리 폭발

**파일**: `src/graph/graph-engine.ts:496-500`

**현상**: BFS 탐색에서 각 큐 엔트리마다 전체 경로 배열을 spread 연산자로 복사.

**코드**:
```typescript
queue.push({
    id: nextId,
    depth: depth + 1,
    path: [...path, { nodeId: nextId, edge }]  // O(depth) 복사 × 매 엣지
});
```

**영향**: depth=D, 평균 분기도=B일 때 메모리 O(D² × B^D). depth=10, branch=50이면 경로 배열만으로 수 GB.

**해결책**: 부모 포인터 방식으로 전환.
```typescript
// 큐 엔트리에 parentIndex만 저장
interface BfsEntry { id: number; depth: number; parentIndex: number; edge?: CodeEdge; }
const entries: BfsEntry[] = [{ id: startId, depth: 0, parentIndex: -1 }];

// 최종 결과 반환 시에만 경로 재구성
function reconstructPath(idx: number): TraversalPathStep[] {
    const path: TraversalPathStep[] = [];
    while (idx >= 0) {
        path.unshift({ nodeId: entries[idx].id, edge: entries[idx].edge });
        idx = entries[idx].parentIndex;
    }
    return path;
}
```

**수정 파일**: `src/graph/graph-engine.ts` (bfs 메서드)
**노력**: M (1시간)
**의존성**: 없음

---

### C-5. DFS 재귀 스택 오버플로우

**파일**: `src/graph/graph-engine.ts:506-538`

**현상**: DFS가 재귀 호출로 구현되어 있으며, 동일한 경로 spread 복사 문제도 포함.

**코드**:
```typescript
private dfs(currentId, depth, path, ...) {
    // ...
    for (const edge of edges) {
        const nextPath = [...currentPath, { nodeId: nextId, edge }];
        this.dfs(nextId, depth + 1, nextPath, ...);  // 재귀
    }
}
```

**영향**: Node.js 기본 스택 ~15,000 프레임. 깊은 호출 체인 또는 대형 모듈 그래프에서 `RangeError: Maximum call stack size exceeded`.

**해결책**: 명시적 스택 + 부모 포인터 방식의 반복(iterative) DFS.
```typescript
private dfs(startId, direction, edgeType, maxDepth, results, visited): void {
    const stack: DfsEntry[] = [{ id: startId, depth: 0, parentIndex: -1 }];
    const entries: DfsEntry[] = [];

    while (stack.length > 0) {
        const entry = stack.pop()!;
        if (visited.has(entry.id) || entry.depth > maxDepth) continue;
        visited.add(entry.id);

        const entryIndex = entries.length;
        entries.push(entry);

        const node = this.getNodeById(entry.id);
        if (node) results.push({ node, distance: entry.depth, path: reconstructPath(entries, entryIndex) });

        if (entry.depth < maxDepth) {
            const edges = direction === 'outgoing' ? this.edgeRepo.getOutgoingEdges(entry.id, edgeType) : this.edgeRepo.getIncomingEdges(entry.id, edgeType);
            for (const edge of edges) {
                const nextId = direction === 'outgoing' ? edge.to_id : edge.from_id;
                stack.push({ id: nextId, depth: entry.depth + 1, parentIndex: entryIndex, edge });
            }
        }
    }
}
```

**수정 파일**: `src/graph/graph-engine.ts` (dfs 메서드)
**노력**: M (1시간)
**의존성**: C-4와 동일 파일 — **같은 체인에서 순차 작업**

---

## 3. HIGH — 안정성/보안

---

### H-1. SQLite pragma 과도한 메모리 할당

**파일**: `src/db/database.ts:36-37`

**현상**:
```typescript
this.db.pragma('cache_size = -2000000'); // ~2GB
this.db.pragma('mmap_size = 30000000000'); // 30GB
```

소규모 프로젝트(DB 수 MB)에서도 2GB 캐시 할당을 시도. 4GB RAM 머신에서 OOM.

**해결책**: DB 파일 크기 비례 동적 설정.
```typescript
const dbSizeMB = fs.existsSync(dbPath) ? fs.statSync(dbPath).size / (1024 * 1024) : 0;
const cacheSizeMB = Math.min(Math.max(dbSizeMB * 2, 64), 512);  // 64MB ~ 512MB
const mmapSizeMB = Math.min(dbSizeMB * 4, 2048);  // 최대 2GB

this.db.pragma(`cache_size = -${cacheSizeMB * 1024}`);  // KB 단위
this.db.pragma(`mmap_size = ${mmapSizeMB * 1024 * 1024}`);
```

**수정 파일**: `src/db/database.ts`
**노력**: S (30분)
**의존성**: 없음

---

### H-2. Python Sidecar 타임아웃 값 오류

**파일**: `src/indexer/embedding-manager.ts:138-145`

**현상**: 주석은 "300 seconds (5m)"이라고 적혀 있지만, 실제 `maxWait = 3000`은 루프 1회=100ms이므로 300초(5분)가 맞음. **그러나** 이 값이 과도하게 크다 — 사이드카가 실제로 죽었을 때 5분간 블로킹.

**해결책**: 30초 타임아웃(합리적 시작 시간) + 단계별 로그.
```typescript
const maxWait = 300;  // 300 × 100ms = 30초
```

**수정 파일**: `src/indexer/embedding-manager.ts`
**노력**: S (15분)
**의존성**: 없음

---

### H-3. Registry 파일 비원자적 쓰기

**파일**: `src/utils/paths.ts:82, 89`

**현상**: `fs.writeFileSync(registryPath, data)` — 쓰기 도중 프로세스 종료(전원 손실, SIGKILL 등) 시 registry.json이 부분 기록 상태로 손상. 다음 시작 시 `JSON.parse()` 실패 → 모든 프로젝트 등록 정보 소실.

**해결책**: 임시 파일 쓰기 → 원자적 rename.
```typescript
const tmpPath = registryPath + '.tmp';
fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2), 'utf8');
fs.renameSync(tmpPath, registryPath);  // POSIX에서 원자적
```

**수정 파일**: `src/utils/paths.ts`
**노력**: S (15분)
**의존성**: 없음

---

### H-4. SecurityProvider 심볼릭 링크 우회

**파일**: `src/utils/security.ts:25`

**현상**: `path.resolve()`는 심볼릭 링크를 해석하지 않음. 프로젝트 디렉토리 안에 `ln -s /etc/passwd ./data`를 만들면 `/etc/passwd`에 접근 가능.

**현재 코드**:
```typescript
const absoluteTargetPath = path.resolve(targetPath);  // symlink 미해석
```

**해결책**:
```typescript
const absoluteTargetPath = fs.realpathSync(path.resolve(targetPath));
const realProjectRoot = fs.realpathSync(this.projectRoot);
```

**주의**: `realpathSync`는 경로가 존재해야 함 → 존재하지 않는 경로에 대해 `resolve`로 fallback 필요.

**수정 파일**: `src/utils/security.ts`
**노력**: S (30분)
**의존성**: 없음

---

### H-5. Graph Engine 캐시 무효화 부재

**파일**: `src/graph/graph-engine.ts:79, 304-310`

**현상**: `impactCache`가 TTL(1분)로만 관리됨. 그래프 mutation(노드·엣지 추가·삭제) 시 캐시를 무효화하지 않아, 변경 직후에도 구 데이터가 반환됨.

**영향**: `analyze_impact` 호출 시 방금 추가한 엣지가 결과에 반영되지 않음 → 리팩토링 안전성 판단 오류.

**해결책**: mutation 메서드에 캐시 clear 훅 추가.
```typescript
// GraphEngine에 추가
public invalidateCache(): void {
    this.impactCache = new LRUCache(5_000);
    this.nodeCache = new LRUCache(10_000);
    this.qnameCache = new LRUCache(10_000);
}
```
`update-pipeline.ts`의 `processBatch()` 완료 시 `graphEngine.invalidateCache()` 호출.

**수정 파일**: `src/graph/graph-engine.ts`, `src/indexer/update-pipeline.ts`
**노력**: S (30분)
**의존성**: 없음

---

### H-6. Lock Manager TOCTOU 경합

**파일**: `src/utils/lock-manager.ts:44-68`

**현상**: stale lock 감지 시 "PID 생존 확인 → lock 파일 삭제" 사이에 시간차 존재. 그 사이에 동일 PID가 재사용되면 유효한 lock을 삭제할 수 있음.

**영향**: 극히 드물지만, 두 인스턴스가 동시에 같은 프로젝트의 DB를 쓸 수 있음 → DB 손상.

**해결책**: lock 파일에 생성 타임스탬프 + 랜덤 nonce 포함. 삭제 전 파일 내용을 re-read하여 nonce 일치 여부 확인.
```typescript
// lock 파일 내용: { pid, nonce, timestamp }
// 삭제 전: re-read하여 nonce가 동일하면 삭제, 다르면 다른 프로세스가 갱신한 것
```

**수정 파일**: `src/utils/lock-manager.ts`
**노력**: M (1시간)
**의존성**: 없음

---

## 4. MEDIUM — 구조적 품질

---

### M-1. MCP Server God Object (702줄)

**파일**: `src/server/mcp-server.ts`

**현상**: 서버 라이프사이클, 20개 도구 디스패치, 리소스 제공, 프롬프트 생성, 캐싱, 터미널 코디네이션, 헬스 모니터링을 단일 클래스가 담당.

**문제점**:
- 단일 변경이 전체 클래스에 영향
- 테스트 시 전체 MCP 서버 초기화 필요
- 새 도구 추가 시 switch문이 계속 확장

**해결책**: 역할별 분리.
```
src/server/
├── mcp-server.ts          ← 라이프사이클 + 라우팅만 (100줄 이하)
├── tool-dispatcher.ts     ← switch(name) 로직 + 도구별 핸들러 등록
├── resource-provider.ts   ← graph:// 리소스 제공
├── prompt-provider.ts     ← 프롬프트 템플릿
└── health-monitor.ts      ← 주기적 정합성 검사
```

**노력**: L (3~4시간)
**의존성**: 없음 (리팩토링이지만 동작 변경 없음)

---

### M-2. EngineContext 타입 안전성 부재

**파일**: `src/server/mcp-server.ts:150, 542, 666` 등 다수

**현상**: `(ctx as any).gitService`, `(ctx as any).securityProvider` 등의 캐스팅이 10곳 이상. `EngineContext` 인터페이스에 해당 속성이 없어서 발생.

**해결책**: `src/types/index.ts`의 `EngineContext`에 누락된 속성 추가.
```typescript
export interface EngineContext {
    projectPath: string;
    dbManager?: DatabaseManager;
    graphEngine?: GraphEngine;
    optEngine?: OptimizationEngine;
    archEngine?: ArchitectureEngine;
    refactorEngine?: RefactorEngine;
    policyDiscoverer?: PolicyDiscoverer;
    // ↓ 추가
    gitService?: GitService;
    updatePipeline?: UpdatePipeline;
    securityProvider?: SecurityProvider;
    vectorRepo?: VectorRepository;
}
```
이후 `as any` 캐스팅을 optional chaining(`ctx.securityProvider?.validatePath(...)`)으로 교체.

**수정 파일**: `src/types/index.ts`, `src/server/mcp-server.ts`, `src/bootstrap.ts`
**노력**: M (1시간)
**의존성**: 없음

---

### M-3. 구조화된 로깅 프레임워크 부재

**현상**: 전체 코드베이스가 `console.error()`만 사용. 로그 레벨, 구조화된 출력, 필터링 불가. MCP 모드에서는 `console.log`가 `console.error`로 리다이렉트되어 모든 출력이 stderr로 혼재.

**영향**: 프로덕션 이슈 디버깅 시 로그에서 error/warn/info를 구분할 수 없음.

**해결책**: 경량 커스텀 로거 도입 (외부 의존성 최소화).
```typescript
// src/utils/logger.ts
export enum LogLevel { DEBUG, INFO, WARN, ERROR }

export class Logger {
    constructor(private context: string, private level: LogLevel = LogLevel.INFO) {}

    debug(msg: string, data?: any) { if (this.level <= LogLevel.DEBUG) this.emit('DEBUG', msg, data); }
    info(msg: string, data?: any)  { if (this.level <= LogLevel.INFO) this.emit('INFO', msg, data); }
    warn(msg: string, data?: any)  { if (this.level <= LogLevel.WARN) this.emit('WARN', msg, data); }
    error(msg: string, data?: any) { this.emit('ERROR', msg, data); }

    private emit(level: string, msg: string, data?: any) {
        const entry = { ts: new Date().toISOString(), level, ctx: this.context, msg, ...(data && { data }) };
        console.error(JSON.stringify(entry));
    }
}
```
점진적으로 `console.error()` 호출을 `logger.error()` 등으로 교체.

**수정 파일**: 신규 `src/utils/logger.ts` + 기존 파일 점진 적용
**노력**: M (1~2시간, 초기 도입 + 주요 파일 3~4개 교체)
**의존성**: 없음

---

### M-4. updatePipeline.resolveNodeId 관심사 혼재

**파일**: `src/indexer/update-pipeline.ts:336-383`

**현상**: 엣지 해석 메서드가 레지스트리 읽기, 원격 DB 열기/쿼리, 섀도 노드 생성까지 직접 수행 (50줄짜리 메서드에 3가지 관심사).

**문제점**:
- 원격 DB 접근 로직을 테스트하려면 전체 UpdatePipeline 초기화 필요
- 원격 프로젝트 해석 전략 변경 시 UpdatePipeline을 수정해야 함
- C-2 (리소스 누수)의 근본 원인이기도 함

**해결책**: `CrossProjectResolver` 서비스 추출.
```typescript
// src/indexer/cross-project-resolver.ts
export class CrossProjectResolver {
    resolveRemote(symbolName: string, canonicalQName: string, nodeRepo: NodeRepository): number | undefined {
        const registry = readRegistry();
        for (const project of registry) {
            // try-finally로 DB 안전하게 열고 닫기
        }
    }
}
```

**수정 파일**: 신규 `src/indexer/cross-project-resolver.ts`, `src/indexer/update-pipeline.ts`
**노력**: M (1~2시간)
**의존성**: C-2를 포함 (분리하면서 자연스럽게 try-finally 적용)

---

### M-5. EmbeddingManager 단일 책임 위반

**파일**: `src/indexer/embedding-manager.ts` (254줄)

**현상**: Python 프로세스 관리, IPC 직렬화, 자동 재시작(지수 백오프), 요청 큐잉, fallback 모드를 한 클래스가 담당.

**해결책**: 3개 클래스로 분리.
```
EmbeddingProvider (인터페이스)
├── PythonSidecarProvider (프로세스 관리 + IPC)
└── NullEmbeddingProvider  (fallback: null 반환, 로깅)

EmbeddingManager (오케스트레이터)
└── 큐잉, 타임아웃, provider 전환 로직
```

**노력**: L (2~3시간)
**의존성**: H-2 (타임아웃 수정)와 같은 파일이므로 **같은 체인에서 순차 작업**

---

### M-6. 그래프 순환 의존성 탐지 캐시 미적용

**파일**: `src/graph/architecture-engine.ts:144-181`

**현상**: `detectCycles()`이 호출마다 전체 노드에서 DFS 수행. `check_architecture_violations`이 반복 호출되면 매번 O(V+E) 재연산.

**해결책**: 결과를 캐싱하고, 그래프 변경 시 무효화 (H-5의 캐시 무효화 인프라 활용).

**수정 파일**: `src/graph/architecture-engine.ts`
**노력**: S (30분)
**의존성**: H-5 (캐시 무효화 인프라) 완료 후 작업

---

### M-7. TreeSitterParser.calculateCC 데드코드

**파일**: `src/indexer/tree-sitter-parser.ts:178-191`

**현상**: `calculateCC()` private 메서드가 정의되어 있지만 어디에서도 호출되지 않음. 실제 CC 계산은 `MetricsCalculator.calculateCyclomaticComplexity()`를 사용. `find_dead_code` HIGH 결과에서도 검출됨.

**해결책**: 메서드 삭제.

**수정 파일**: `src/indexer/tree-sitter-parser.ts`
**노력**: S (5분)
**의존성**: 없음

---

## 5. LOW — 장기 개선

| ID | 항목 | 파일 | 해결책 요약 | 노력 |
|----|------|------|-------------|------|
| L-1 | reTagAllNodes 고정 5-pass | update-pipeline.ts:60-77 | 수렴 기반 종료 조건 (`changedCount === 0`이면 중단) | S |
| L-2 | 클러스터링 O(V²) | graph-engine.ts:149-201 | Louvain 알고리즘 또는 Union-Find 기반 교체 | L |
| L-3 | Dead code 생성자 FP | optimization-engine.ts:34 | `symbol_type NOT IN ('constructor')` 추가 또는 `trait:initializer` 태그 | S |
| L-4 | Windows HOME 변수 우선순위 | language-registry.ts:37 | `process.env.USERPROFILE \|\| process.env.HOME` 순서로 변경 | S |
| L-5 | Git rename 추적 불완전 | git-service.ts:64-74 | `R100 old new` 파싱 시 old/new 모두 처리 | S |
| L-6 | Prepared statement 미캐싱 | edge-repository.ts | 클래스 필드에 prepared statement 캐싱 | S |
| L-7 | MCP session 정리 미보장 | mcp-server.ts | disconnect 시 30초 타이머로 transport map 정리 | S |
| L-8 | 그래프 BFS/DFS 유닛 테스트 없음 | — | tests/graph-engine.test.ts 신규 작성 | M |
| L-9 | 아키텍처 태그 대소문자 불일치 | architecture-engine.ts:106 | 태그 비교 시 `.toLowerCase()` 적용 | S |
| L-10 | `(node as any).name` 타입 가드 교체 | typescript-parser.ts 전체 | `ts.isNamedDeclaration()` 가드로 교체 | M |

---

## 6. 의존성 그래프 및 실행 순서

```
독립 (병렬 가능)          의존 체인
─────────────────────    ─────────────────────
C-1 (ts-parser null)
C-2 (remote DB leak)  ←─┐
C-3 (IPC timeout)        │  M-4 (CrossProjectResolver 분리)는
                          │  C-2를 포함하므로 같은 체인
                          └──M-4
C-4 (BFS 메모리)     ──→ C-5 (DFS 스택오버플로우)
                          ↑ 같은 파일, 순차 작업

H-1 (pragma)
H-2 (sidecar timeout) ──→ M-5 (EmbeddingManager 분리)
H-3 (registry atomic)
H-4 (lock TOCTOU)
H-5 (cache invalidation) ──→ M-6 (cycle 캐시)
H-6 (symlink)

M-1 (MCP God object)
M-2 (EngineContext)
M-3 (Logger)
M-7 (dead code 삭제)
```

### 파일 충돌 분석 (병렬 안전성)

| 파일 | 수정 항목 | 병렬 제약 |
|------|-----------|-----------|
| `graph-engine.ts` | C-4, C-5, H-5 | **같은 체인** (순차) |
| `update-pipeline.ts` | C-2, M-4, H-5(호출부) | C-2+M-4 같은 체인; H-5 호출부는 M-4 후 |
| `embedding-manager.ts` | H-2, M-5 | **같은 체인** (순차) |
| `mcp-server.ts` | M-1, M-2 | M-2를 먼저 (M-1이 M-2의 타입 변경에 의존) |
| `typescript-parser.ts` | C-1, L-10 | **같은 체인** (순차) |
| `ipc-coordinator.ts` | C-3 | 단독 |
| `database.ts` | H-1 | 단독 |
| `security.ts` | H-6 | 단독 |
| `lock-manager.ts` | H-4 | 단독 |
| `paths.ts` | H-3 | 단독 |
| `types/index.ts` | M-2 | M-2의 선행 작업 |

---

## 7. 작업 Wave 설계

### Wave 1: CRITICAL 수정 (5개, 병렬 3체인)

```
Chain A: C-1 (typescript-parser.ts)
Chain B: C-2 (update-pipeline.ts) → [self-check]
Chain C: C-4 (graph-engine.ts BFS) → C-5 (graph-engine.ts DFS) → [self-check]
Chain D: C-3 (ipc-coordinator.ts)

Gate 1: tsc + npm test + 로직 검증
```

**예상 소요**: 2~3시간

### Wave 2: HIGH 수정 (6개, 병렬 6체인)

```
Chain A: H-1 (database.ts)
Chain B: H-2 (embedding-manager.ts)
Chain C: H-3 (paths.ts)
Chain D: H-4 (lock-manager.ts)
Chain E: H-5 (graph-engine.ts + update-pipeline.ts 호출부)
Chain F: H-6 (security.ts)

Gate 2: tsc + npm test + 보안 스모크 테스트
```

**예상 소요**: 2~3시간
**선행 조건**: Wave 1 Gate 통과

### Wave 3: MEDIUM 구조 개선 (7개, 병렬 4체인)

```
Chain A: M-2 (types/index.ts) → M-1 (mcp-server.ts 분리) → [self-check]
Chain B: M-4 (cross-project-resolver.ts 추출) → [self-check]
Chain C: M-5 (embedding-manager.ts 분리) → [self-check]
Chain D: M-3 (logger.ts 신규) + M-7 (dead code 삭제) → [self-check]

Gate 3: tsc + npm test + 아키텍처 정합성
```

**예상 소요**: 4~6시간
**선행 조건**: Wave 2 Gate 통과 (H-5 캐시 인프라 → M-6 활용)

### Wave 4: LOW + M-6 잔여 (선택적)

```
L-1 ~ L-10 + M-6: 독립적 소규모 수정
각각 별도 커밋, Gate는 Wave 종료 시 1회
```

**예상 소요**: 3~4시간
**선행 조건**: Wave 3 Gate 통과

---

### 전체 로드맵 요약

| Wave | 항목 | 체인 수 | 예상 시간 | 결과물 |
|------|------|---------|-----------|--------|
| 1 | C-1~C-5 | 4 | 2~3h | 런타임 안정성 확보 |
| 2 | H-1~H-6 | 6 | 2~3h | 보안·메모리·데이터 안전성 확보 |
| 3 | M-1~M-7 | 4 | 4~6h | 코드 품질·유지보수성 향상 |
| 4 | L-1~L-10, M-6 | 자유 | 3~4h | 엣지케이스·성능·테스트 |

> **권장**: Wave 1+2를 하나의 세션에서, Wave 3+4를 다음 세션에서 진행.
> Wave 1+2만으로도 모든 런타임 크래시, 리소스 누수, 보안 취약점이 해결됨.
