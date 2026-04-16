# executeTool 리팩토링 계획

> 작성일: 2026-04-16  
> 대상 파일: `src/server/tool-dispatcher.ts`  
> Cynapx 분석 기반 + 코드 직접 검증 완료

---

## 1. 현황 진단

### 문제 함수

```
src/server/tool-dispatcher.ts#executeTool
  Lines     : 219–705 (487 라인)
  CC        : 159   (임계값 10 초과, CRITICAL)
  fan_out   : 48    (임계값 15 초과, CRITICAL)
  LOC       : 730   (파일 전체)
  구조      : 단일 switch/case — 20개 케이스 직접 인라인
```

Cynapx `propose_refactor` 분석 결과 위험 등급 **CRITICAL**, 권장 전략 **Branch by Abstraction**.

### 현재 파일 구조

```
tool-dispatcher.ts (730 lines)
├── imports + ToolDeps interface          (1–37)
├── registerToolHandlers()               (39–213)
│   ├── ListToolsRequestSchema handler   (40–208)  — 20개 tool 스키마 정의
│   └── CallToolRequestSchema handler    (211–213) — executeTool 호출
├── initializationInProgress mutex       (217)
├── executeTool()                        (219–705) — 20개 case 인라인
└── 유틸 함수 3개                         (707–729)
    ├── mergeResultsRRF()
    ├── escapeXml()
    └── escapeDot()
```

---

## 2. 영향 전파 범위 (Impact Scope)

### 2-A. 직접 호출자 (fan_in)

| 호출 위치 | 파일 | 라인 | 역할 |
|-----------|------|------|------|
| `registerToolHandlers` 내부 | `tool-dispatcher.ts` | 212 | MCP SDK CallTool 핸들러 |
| `McpServer.executeTool()` | `mcp-server.ts` | 186 | One-shot CLI / 테스트용 래퍼 |
| (IPC 경유) | `ipc-coordinator.ts` | — | Terminal 모드에서 Host로 IPC 포워딩 |

> **핵심**: `executeTool`의 프로덕션 호출 경로는 `mcp-server.ts` 단 1개.  
> 함수 시그니처 `(name, args, deps)` 를 유지하면 **mcp-server.ts와 ipc-coordinator.ts는 수정 불필요**.

### 2-B. 간접 영향 (인라인된 구현들)

20개 tool 케이스가 현재 `executeTool` 내부에 직접 작성되어 있음.  
리팩토링 후 각각 독립 핸들러 파일로 이전됨.

의존하는 모듈:
- `ctx.graphEngine`, `ctx.dbManager`, `ctx.archEngine`, `ctx.refactorEngine`, `ctx.optEngine`, `ctx.policyDiscoverer`
- `deps.workspaceManager`, `deps.embeddingProvider`, `deps.remediationEngine`
- `paths.ts` (`readRegistry`, `addToRegistry`, `removeFromRegistry`, `getDatabasePath` 등)
- `audit-logger.ts`, `consistency-checker.ts`

이들은 **임포트 경로만 조정**하면 그대로 재사용 가능.

### 2-C. 테스트 파일

| 파일 | 영향 |
|------|------|
| `tests/tool-dispatcher.test.ts` | `executeTool` 직접 임포트 — 시그니처 유지 시 수정 없음 |

> `executeTool`을 얇은 dispatcher로 남기면 기존 테스트 그대로 통과.  
> 추가로 각 핸들러별 단위 테스트를 독립적으로 작성 가능해짐.

### 2-D. 수정/생성 파일 목록

| 파일 | 유형 | 변경 |
|------|------|------|
| `src/server/tool-dispatcher.ts` | 수정 | `executeTool` 본문 → 5라인 dispatcher로 교체 |
| `src/server/tools/_types.ts` | 신규 | `ToolHandler`, `ToolResult` 인터페이스 |
| `src/server/tools/_utils.ts` | 신규 | `mergeResultsRRF`, `escapeXml`, `escapeDot` 이전 |
| `src/server/tools/_registry.ts` | 신규 | `Map<string, ToolHandler>` 빌드 |
| `src/server/tools/get-setup-context.ts` | 신규 | 핸들러 |
| `src/server/tools/initialize-project.ts` | 신규 | 핸들러 (mutex 포함) |
| `src/server/tools/search-symbols.ts` | 신규 | 핸들러 |
| `src/server/tools/get-symbol-details.ts` | 신규 | 핸들러 |
| `src/server/tools/analyze-impact.ts` | 신규 | 핸들러 |
| `src/server/tools/get-callers.ts` | 신규 | 핸들러 |
| `src/server/tools/get-callees.ts` | 신규 | 핸들러 |
| `src/server/tools/get-related-tests.ts` | 신규 | 핸들러 |
| `src/server/tools/check-architecture-violations.ts` | 신규 | 핸들러 |
| `src/server/tools/get-remediation-strategy.ts` | 신규 | 핸들러 |
| `src/server/tools/propose-refactor.ts` | 신규 | 핸들러 |
| `src/server/tools/get-risk-profile.ts` | 신규 | 핸들러 |
| `src/server/tools/get-hotspots.ts` | 신규 | 핸들러 |
| `src/server/tools/find-dead-code.ts` | 신규 | 핸들러 |
| `src/server/tools/export-graph.ts` | 신규 | 핸들러 |
| `src/server/tools/check-consistency.ts` | 신규 | 핸들러 |
| `src/server/tools/purge-index.ts` | 신규 | 핸들러 |
| `src/server/tools/re-tag-project.ts` | 신규 | 핸들러 |
| `src/server/tools/backfill-history.ts` | 신규 | 핸들러 |
| `src/server/tools/discover-latent-policies.ts` | 신규 | 핸들러 |
| `mcp-server.ts` | 미변경 | — |
| `ipc-coordinator.ts` | 미변경 | — |
| `tests/tool-dispatcher.test.ts` | 미변경 | — |

**총계**: 신규 24개 파일, 수정 1개 파일, 미변경 2개 파일 + 테스트.

---

## 3. 목표 아키텍처

### 3-A. `ToolHandler` 인터페이스

```typescript
// src/server/tools/_types.ts

export interface ToolResult {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
}

export interface ToolHandler {
    execute(args: unknown, deps: ToolDeps): Promise<ToolResult>;
}
```

### 3-B. 핸들러 파일 표준 형식

```typescript
// src/server/tools/get-symbol-details.ts
import { ToolHandler, ToolResult } from './_types';
import { ToolDeps } from '../tool-dispatcher';

export const getSymbolDetailsHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        if (typeof args.qualified_name !== 'string' || args.qualified_name.trim() === '') {
            return { isError: true, content: [{ type: 'text', text: 'Invalid argument: qualified_name must be a non-empty string.' }] };
        }
        const ctx = deps.getContext();
        if (!ctx || !ctx.graphEngine) {
            return { isError: true, content: [{ type: 'text', text: 'No active project. Call initialize_project first.' }] };
        }
        // ... 기존 case 본문 그대로 이식 ...
    }
};
```

### 3-C. 레지스트리

```typescript
// src/server/tools/_registry.ts
import { ToolHandler } from './_types';
import { getSetupContextHandler }            from './get-setup-context';
import { initializeProjectHandler }          from './initialize-project';
import { searchSymbolsHandler }              from './search-symbols';
// ... (20개 import)

export const toolRegistry = new Map<string, ToolHandler>([
    ['get_setup_context',              getSetupContextHandler],
    ['initialize_project',             initializeProjectHandler],
    ['search_symbols',                 searchSymbolsHandler],
    // ... (20개 항목)
]);
```

### 3-D. 리팩토링 후 `executeTool`

```typescript
// src/server/tool-dispatcher.ts (리팩토링 후)

import { toolRegistry } from './tools/_registry';

export async function executeTool(name: string, args: any, deps: ToolDeps): Promise<any> {
    if (deps.isTerminal() && deps.getTerminalCoordinator()) {
        return deps.getTerminalCoordinator()!.forwardExecuteTool(name, args);
    }
    await deps.waitUntilReady();

    const handler = toolRegistry.get(name);
    if (!handler) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    return handler.execute(args, deps);
}
```

기존 487라인 → **9라인**으로 축소.

---

## 4. 구현 Wave 계획

### Wave 0 — 인프라 구축 (선행 조건)

1. `src/server/tools/` 디렉토리 생성
2. `_types.ts` 작성 (`ToolHandler`, `ToolResult`)
3. `_utils.ts` 작성 (`mergeResultsRRF`, `escapeXml`, `escapeDot`)
4. `_registry.ts` 빈 껍데기 작성 (빈 Map)
5. `tsc --noEmit` 통과 확인

### Wave 1 — 단순 핸들러 (컨텍스트 의존 낮음)

| 핸들러 | 특이사항 |
|--------|----------|
| `get-setup-context` | `readRegistry()` 직접 호출 |
| `get-callers` | N+1 쿼리 최적화 이미 적용됨 |
| `get-callees` | 동일 |
| `re-tag-project` | Terminal 모드 guard 포함 |
| `backfill-history` | Terminal 모드 guard 포함 |

→ 레지스트리에 등록, 기존 switch에서 해당 case 제거, 테스트 통과 확인.

### Wave 2 — 그래프 탐색 핸들러

| 핸들러 | 특이사항 |
|--------|----------|
| `search-symbols` | `mergeResultsRRF` 유틸 사용, `workspaceManager.getAllContexts()` 멀티 컨텍스트 |
| `analyze-impact` | BFS traversal |
| `get-related-tests` | `toCanonical` 임포트 필요 |
| `check-architecture-violations` | `archEngine` 의존 |
| `get-remediation-strategy` | `remediationEngine` 의존 |

### Wave 3 — 분석 핸들러

| 핸들러 | 특이사항 |
|--------|----------|
| `get-symbol-details` | 코드 pruning 로직 포함 |
| `propose-refactor` | `refactorEngine` 의존 |
| `get-risk-profile` | `refactorEngine` 의존 |
| `find-dead-code` | `optEngine` 의존, 긴 텍스트 포맷팅 |
| `discover-latent-policies` | 복합 유효성 검사 |

### Wave 4 — 복잡 핸들러

| 핸들러 | 특이사항 |
|--------|----------|
| `get-hotspots` | SQL allowlist 검증, 직접 DB 쿼리 |
| `export-graph` | JSON/GraphML/DOT 3개 포맷, `escapeXml`/`escapeDot` 사용 |
| `check-consistency` | `ConsistencyChecker` 인스턴스 생성 |
| `purge-index` | `auditLogger`, 파일 삭제, `unregister` 분기 |

### Wave 5 — initialize_project (가장 복잡)

- 모듈 수준 mutex `initializationInProgress`를 `initialize-project.ts` 내부로 이전
- 3가지 mode 분기 (`current`, `existing`, `custom`)
- 경계 검사, symlink 해석, `onInitialize` 콜백 등 포함
- **이 Wave가 완료되면 `executeTool` switch/case 전체 삭제 가능**

### Wave 6 — 정리 및 검증

1. `tool-dispatcher.ts`에서 모든 직접 임포트 제거 (더 이상 필요 없는 것들)
2. `executeTool` switch/case 블록 완전 삭제
3. `tsc --noEmit` 통과 확인
4. `vitest run` 전체 테스트 통과 확인
5. 목표 지표 측정:
   - `executeTool` CC: 159 → **1** (단일 분기 없음)
   - `executeTool` fan_out: 48 → **2** (registry + waitUntilReady)
   - `executeTool` LOC: 487 → **9**
   - 테스트 커버리지: 기존 유지 + 핸들러별 단위 테스트 추가 가능

---

## 5. 불변 조건 (Invariants)

리팩토링 과정에서 반드시 유지해야 할 조건:

1. **함수 시그니처 불변**: `executeTool(name: string, args: any, deps: ToolDeps): Promise<any>` — `mcp-server.ts`, `ipc-coordinator.ts` 수정 없음
2. **mutex 위치**: `initializationInProgress` flag는 `initialize-project.ts`의 모듈 수준으로 이전. 싱글톤 보장 유지.
3. **Terminal 모드 early return**: `executeTool` 상단의 `isTerminal()` 체크는 dispatcher에 유지. 각 핸들러는 이미 host임이 보장된 상태에서만 실행.
4. **`waitUntilReady()` 호출**: dispatcher에서 한 번만 호출. 각 핸들러 내부에서 중복 호출 안 함.
5. **기존 동작 동등성**: 모든 케이스의 리턴 값 형식(`{ content, isError? }`) 유지.

---

## 6. 측정 목표

| 지표 | Before | After |
|------|--------|-------|
| `executeTool` CC | 159 | 1 |
| `executeTool` fan_out | 48 | 2 |
| `executeTool` LOC | 487 | 9 |
| `tool-dispatcher.ts` 전체 LOC | 730 | ~220 (스키마 정의 + dispatcher) |
| 평균 핸들러 LOC | — | ~20 |
| 테스트 실패 | 0 | 0 |

---

## 7. 실행 순서 권장사항

Wave 0 → 1 → 2 → 3 → 4 → 5 → 6 순서로 진행.  
각 Wave 완료 후:
- `tsc --noEmit` 통과
- `vitest run` 전체 통과
- git commit (wave 단위로 독립적 이력)

Wave 5 이후 `agent_docs/improvement-plan.md`의 HIGH 항목 "executeTool CC=159" 상태를 **완료**로 업데이트.
