# Cynapx v1.0.6 종합 진단서 (Phase 6 개선 계획)

> **작성일**: 2026-04-03 (10차 세션)
> **최종 업데이트**: 2026-04-04 (12차 세션) — Wave 1 (일반 개선) + Wave 2 (보안 수정) 구현 완료
> **진단 방법**: Phase 5 dist 빌드 후 실서버 엔드투엔드 검증 + 전체 소스 정밀 보안 코드 리뷰
> **진단 범위**: 기능 결함, 성능, 아키텍처, 보안 취약점 (OWASP 기준)

---

## Phase 6 구현 현황

| 항목 | 상태 | 커밋 |
|------|------|------|
| H-1 (MCP 다중 세션 크래시) | ✅ 완료 | PR #15 |
| H-2 (edgeRepo as any 캡슐화 파괴) | ✅ 완료 | PR #15 |
| M-1 (HealthMonitor 예외 묵살) | ✅ 완료 | PR #15 |
| M-2 (MCP 모드 console.log stdout 오염) | ✅ 완료 | PR #15 |
| M-3 (BEGIN/COMMIT vs db.transaction() 혼용) | ✅ 완료 | PR #15 |
| M-4 (mcpTransports 메모리 누수) | ✅ 완료 | PR #15 |
| L-1 (handleHotspots SELECT * 과다 노출) | ✅ 완료 | PR #15 |
| L-2 (workspace-manager/ipc/health 테스트 공백) | ✅ 완료 | PR #15 |
| SEC-C-1 (IPC 인증 없음) | ✅ 완료 | PR #15 |
| SEC-C-2 (initialize_project 임의 경로 쓰기) | ✅ 완료 | PR #15 |
| SEC-H-1 (GET /mcp sessionId 인증 우회) | ✅ 완료 | PR #15 |
| SEC-H-2 (get_symbol_details null 보안 체크) | ✅ 완료 | PR #15 |
| SEC-H-3 (IPC 메시지 크기 제한 없음) | ✅ 완료 | PR #15 |
| SEC-H-4 (LockManager 스탈 정리 경로 오류) | ✅ 완료 | PR #15 |
| SEC-M-1 (Rate Limiter X-Forwarded-For 스푸핑) | ✅ 완료 | PR #15 |
| SEC-M-2 (Swagger UI 인증 없이 노출) | ✅ 완료 | PR #15 |
| SEC-M-3 (.server-port 파일 정보 노출) | ✅ 완료 | PR #15 |

---

## 목차

1. [진단 요약](#1-진단-요약)
2. [일반 개선](#2-일반-개선)
3. [보안 취약점](#3-보안-취약점)
4. [Wave 설계](#4-wave-설계)

---

## 1. 진단 요약

### 1-A. 일반 개선

| 우선순위 | 항목 수 | 완료 | 잔여 |
|----------|---------|------|------|
| 🟠 HIGH | 2 | 0 | 2 |
| 🟡 MEDIUM | 4 | 0 | 4 |
| 🟢 LOW | 2 | 0 | 2 |
| **합계** | **8** | **0** | **8** |

### 1-B. 보안 취약점

| 우선순위 | 항목 수 | 완료 | 잔여 |
|----------|---------|------|------|
| 🔴 CRITICAL | 2 | 0 | 2 |
| 🟠 HIGH | 4 | 0 | 4 |
| 🟡 MEDIUM | 3 | 0 | 3 |
| **합계** | **9** | **0** | **9** |

---

## 2. 일반 개선

---

### H-1: MCP StreamableHTTP 다중 세션 크래시

**파일**: `src/server/api-server.ts:168-184`, `src/server/mcp-server.ts:137-139`

**현상**: 두 번째 HTTP 세션이 연결되면 서버가 즉시 exit(1).

```
Error: Already connected to a transport. Call close() before connecting to a new transport,
or use a separate Protocol instance per connection.
    at McpServer.connectTransport (mcp-server.ts:138)
    at ApiServer.handleMcp (api-server.ts:181)
```

**원인**: `McpServer.sdkServer` (SdkMcpServer) 싱글톤에 `connect(transport)`를 세션마다 반복 호출. MCP SDK는 인스턴스당 1회만 허용.

**영향**: MCP over HTTP 클라이언트 2개 이상 → 프로세스 크래시. stdio, REST API 무관.

**수정 방향**: `handleMcp()`에서 세션마다 새 `SdkMcpServer` 인스턴스 생성 + `registerToolHandlers()` 재등록.

```typescript
// api-server.ts handleMcp
const sessionServer = new SdkMcpServer({ name: 'cynapx', version });
registerToolHandlers(sessionServer, this.mcpServer!.getToolDeps());
const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId });
await sessionServer.connect(transport);
```

**수정 파일**: `src/server/api-server.ts`, `src/server/mcp-server.ts`
**노력**: M (1시간)

---

### H-2: `bootstrap.ts` — `as any` edgeRepo 접근으로 캡슐화 파괴

**파일**: `src/bootstrap.ts:110`

**현상**:
```typescript
const updatePipeline = new UpdatePipeline(
    ctx.dbManager!.getDb(),
    ctx.graphEngine!.nodeRepo,
    (ctx.graphEngine! as any).edgeRepo,  // ← as any: 캡슐화 파괴
    ...
);
```

`GraphEngine`의 `edgeRepo`가 `public` 또는 accessor 없이 직접 `as any`로 접근됨. `GraphEngine` 내부 구조 변경 시 런타임 실패.

**수정 방향**: `GraphEngine`에 `public get edgeRepo(): EdgeRepository` getter 추가.

**수정 파일**: `src/graph/graph-engine.ts`, `src/bootstrap.ts`
**노력**: S (20분)

---

### M-1: `HealthMonitor.start()` — 예외 전체 묵살

**파일**: `src/server/health-monitor.ts:23-47`

**현상**:
```typescript
this.interval = setInterval(async () => {
    ...
    try {
        ...
        if (!isConsistent) {
            this.isChecking = true;
            try {
                await checker.validate(true, false);
            } finally {
                this.isChecking = false;
            }
        }
    } catch { }  // ← 모든 예외 묵살 (에러 로그조차 없음)
}, 5 * 60 * 1000);
```

ConsistencyChecker 예외, DB 연결 실패, null 참조 등 모든 오류가 로그 없이 사라짐. 자동 복구 실패를 사용자가 인지할 수 없음.

**수정 방향**: `catch (e) { console.error('[HealthMonitor] Check failed:', e); }`.

**수정 파일**: `src/server/health-monitor.ts`
**노력**: S (10분)

---

### M-2: `processChangeEvent` — MCP 모드에서 `console.log` stdout 오염

**파일**: `src/indexer/update-pipeline.ts:152, 176`

**현상**:
```typescript
public async processChangeEvent(...) {
    console.log(`Processing ${type} for ${file_path}`);  // ← stdout 출력
    ...
}
public async processBatch(...) {
    console.log(`Processing batch of ${events.length} files...`);  // ← stdout 출력
```

MCP 모드에서는 stdout이 JSON-RPC 채널로 사용된다. `console.log`가 stderr로 리디렉션되지 않으면 JSON-RPC 파싱이 깨진다. `bootstrap.ts`에서 `console.log = console.error`로 전역 패치하지만, 이 패치가 적용되기 전 또는 비-MCP 경로에서 해당 메서드가 호출될 위험이 있다.

**수정 방향**: `console.log` → `console.error`로 교체.

**수정 파일**: `src/indexer/update-pipeline.ts`
**노력**: S (5분)

---

### M-3: `reTagAllNodes` — raw `BEGIN/COMMIT` vs `db.transaction()` 혼용

**파일**: `src/indexer/update-pipeline.ts:55-92`

**현상**:
```typescript
this.db.prepare('BEGIN').run();
// ...
this.db.prepare('COMMIT').run();
// catch:
if (this.db.inTransaction) this.db.prepare('ROLLBACK').run();
```

`db.transaction()` 패턴은 예외 시 자동 롤백을 보장하지만, raw `BEGIN/COMMIT`은 예외 경로에서 `inTransaction` 체크를 직접 해야 한다. `mapHistoryToProject`는 이미 `db.transaction()` 패턴을 사용하므로 혼용.

**수정 방향**: `db.transaction(() => { ... })()` 패턴으로 통일.

**수정 파일**: `src/indexer/update-pipeline.ts`
**노력**: S (20분)

---

### M-4: `mcpTransports` — 세션 종료 시 메모리 누수

**파일**: `src/server/api-server.ts:83, 182`

**현상**:
```typescript
private mcpTransports: Map<string, StreamableHTTPServerTransport> = new Map();
// ...
this.mcpTransports.set(sessionId, transport);
await this.mcpServer.connectTransport(transport);
transport.onclose = () => this.mcpTransports.delete(sessionId);
```

`onclose`가 호출되지 않는 경우 (네트워크 단절, 클라이언트 강제 종료, 에러 발생 후 transport가 제대로 닫히지 않는 경우) Map에 transport가 영구 잔류. H-1 수정으로 세션별 `SdkMcpServer`를 생성하게 되면 이 누수도 자동으로 함께 해결되어야 함.

**수정 방향**: H-1 수정 시 세션 정리 로직 통합. 또는 `transport.on('close', ...)` + 명시적 cleanup.

**수정 파일**: `src/server/api-server.ts`
**노력**: S (15분) — H-1과 동일 파일, 같은 체인에서 처리

---

### L-1: `handleHotspots` REST API — `SELECT *`으로 내부 컬럼 전체 노출

**파일**: `src/server/api-server.ts:316`

**현상**:
```typescript
const hotspots = db.prepare(
    `SELECT * FROM nodes WHERE ${metric} >= ? ${typeFilter} ORDER BY ${metric} DESC LIMIT 100`
).all(...params);
```

`SELECT *`는 `checksum`, `tags`, `history`, `cluster_id` 등 내부 컬럼을 포함한 전체 스키마를 반환. `mapToGraphNode()`가 응답을 구조화하지만, 이 메서드는 원시 DB 행을 받지 않아 `ctx.graphEngine!.nodeRepo.mapRowToNode(h)`를 거쳐야 함.

**수정 방향**: `SELECT qualified_name, symbol_type, file_path, start_line, end_line, loc, cyclomatic, fan_in, fan_out, ${metric} FROM nodes ...`로 필요한 컬럼만 선택.

**수정 파일**: `src/server/api-server.ts`
**노력**: S (10분)

---

### L-2: workspace-manager / ipc-coordinator / health-monitor 테스트 전무

**현상**: Phase 5 이후 총 9개 테스트 파일이 있지만 핵심 인프라 3개 파일에 대한 테스트가 없음.

| 파일 | 테스트 파일 |
|------|-------------|
| `workspace-manager.ts` | 없음 |
| `ipc-coordinator.ts` | 없음 |
| `health-monitor.ts` | 없음 |

**테스트 대상**:
- `WorkspaceManager`: mountProject, initializeEngine, dispose
- `IpcCoordinator`: startHost, connectToHost, forwardExecuteTool 타임아웃
- `HealthMonitor`: start/stop, 인터벌 정리 보장

**수정 파일**: `tests/infrastructure.test.ts` (신규)
**노력**: L (2시간)

---

## 3. 보안 취약점

---

### SEC-C-1: IPC 채널 인증 없음 — 로컬 임의 프로세스가 MCP 도구 무제한 실행

**파일**: `src/server/ipc-coordinator.ts:61-74`
**우선순위**: 🔴 CRITICAL

**현상**: IPC 서버는 `127.0.0.1`에 바인딩되지만 **인증 메커니즘이 없다**. 로컬 포트를 알고 있는 임의의 프로세스가 연결하여 모든 MCP 도구를 실행 가능하다.

```typescript
rl.on('line', async (line) => {
    const req: IpcRequest = JSON.parse(line);
    if (req.method === 'executeTool' && this.mcpServer) {
        // ← 인증 없이 임의 도구 실행
        const result = await this.mcpServer.executeTool(req.params.name, req.params.args);
        socket.write(JSON.stringify({ id: req.id, result }) + '\n');
    }
});
```

**공격 시나리오**:
1. 공격자(로컬 악성 프로세스)가 `~/.cynapx/locks/<hash>.lock`의 `ipcPort`를 읽음 (파일 권한 없음)
2. 해당 포트로 TCP 연결
3. `{ "id": "x", "method": "executeTool", "params": { "name": "purge_index", "args": { "confirm": true } } }` 전송
4. 인덱스 DB 완전 삭제

또는 `initialize_project`로 임의 경로에 파일 생성.

**수정 방향**: IPC 연결 시 nonce 기반 챌린지-응답 또는 공유 비밀(lock file의 nonce) 검증:
```typescript
// Host: 연결 즉시 nonce 전송
socket.write(JSON.stringify({ challenge: this.sessionNonce }) + '\n');
// Client: 동일 nonce로 응답, Host가 검증
```

**수정 파일**: `src/server/ipc-coordinator.ts`, `src/utils/lock-manager.ts`
**노력**: M

---

### SEC-C-2: `initialize_project` — 임의 경로 디렉토리/파일 생성

**파일**: `src/server/tool-dispatcher.ts:224-231`
**우선순위**: 🔴 CRITICAL

**현상**:
```typescript
case 'initialize_project': {
    let target = args.path ? path.resolve(args.path) : process.cwd();
    if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });  // 임의 경로 디렉토리 생성
    if (!args.zero_pollution) fs.writeFileSync(
        path.join(target, ANCHOR_FILE),  // 임의 경로에 파일 쓰기
        JSON.stringify({ created_at: new Date().toISOString() })
    );
```

`args.path`에 대한 경로 검증이 없다. MCP를 통해 `args.path: "C:\\Windows\\System32\\malicious"` 또는 `args.path: "/etc/cynapx-config"` 전달 시 해당 경로에 디렉토리와 파일이 생성된다.

**공격 시나리오**: MCP 클라이언트(AI 에이전트)가 `initialize_project({ path: "/tmp/../../etc/attack" })` 호출 시 임의 시스템 경로에 파일 쓰기.

**수정 방향**: `SecurityProvider`를 사용하거나, `path.resolve(args.path)`가 안전한 화이트리스트 경로(홈 디렉토리 하위 등) 내에 있는지 검증.

```typescript
const resolved = path.resolve(args.path);
const homeDir = os.homedir();
if (!resolved.startsWith(homeDir) && !resolved.startsWith(process.cwd())) {
    return { isError: true, content: [{ type: 'text', text: 'Path outside allowed boundaries.' }] };
}
```

**수정 파일**: `src/server/tool-dispatcher.ts`
**노력**: S (30분)

---

### SEC-H-1: GET /mcp `?sessionId` — 인증 완전 우회

**파일**: `src/server/api-server.ts:126-132`
**우선순위**: 🟠 HIGH

**현상**:
```typescript
if (req.path === '/mcp' && req.method === 'GET') {
    const sessionId = req.query['sessionId'] as string | undefined;
    if (!AUTH_TOKEN || sessionId) return next();  // ← sessionId가 truthy이면 무조건 통과
```

`AUTH_TOKEN`이 설정되어 있어도 `?sessionId=anything`을 URL에 추가하면 인증을 우회한다. 세션 유효성을 `mcpTransports` 맵에서 검증하지 않는다.

**공격 시나리오**: `GET http://server:3737/mcp?sessionId=fake123` → 인증 없이 `/mcp` 엔드포인트 접근.

**수정 방향**: sessionId의 유효성을 `mcpTransports` 맵에서 검증:
```typescript
const sessionId = req.query['sessionId'] as string | undefined;
if (!AUTH_TOKEN || (sessionId && this.mcpTransports.has(sessionId))) return next();
```

**수정 파일**: `src/server/api-server.ts`
**노력**: S (15분)

---

### SEC-H-2: `get_symbol_details` — `securityProvider` null 시 임의 파일 읽기

**파일**: `src/server/tool-dispatcher.ts:275-277`
**우선순위**: 🟠 HIGH

**현상**:
```typescript
const security = ctx.securityProvider;
if (security) security.validatePath(node.file_path);  // ← null이면 검증 생략
const content = fs.readFileSync(node.file_path, 'utf8');
```

`securityProvider`가 null인 경우(Terminal 모드, 초기화 순서 문제, 테스트 환경 등) 경로 검증 없이 파일을 읽는다. `node.file_path`는 DB에 저장된 값으로, DB가 오염되었거나 `initialize_project`로 임의 경로의 심볼이 등록된 경우 `/etc/passwd` 등 민감 파일 읽기 가능.

**수정 방향**: `if (security)` 조건부가 아닌 보안 검증을 필수화. `securityProvider`가 없으면 소스 코드 제공 거부:
```typescript
if (!ctx.securityProvider) {
    text += '\n> [!WARNING] Source unavailable: Security provider not initialized.';
} else {
    ctx.securityProvider.validatePath(node.file_path);
    // ... 파일 읽기
}
```

**수정 파일**: `src/server/tool-dispatcher.ts`
**노력**: S (20분)

---

### SEC-H-3: IPC 채널 — 메시지 크기 제한 없음 (OOM)

**파일**: `src/server/ipc-coordinator.ts:57-75`
**우선순위**: 🟠 HIGH

**현상**: IPC는 `readline` 인터페이스를 사용하여 개행 기준으로 메시지를 파싱한다. 메시지 크기 제한이 없어 악의적 클라이언트가 개행 없는 수 GB 데이터를 전송하면 메모리 고갈.

```typescript
const rl = readline.createInterface({ input: socket });
rl.on('line', async (line) => {
    const req: IpcRequest = JSON.parse(line);  // line이 수 GB일 수 있음
```

**수정 방향**: 소켓 수신 바이트 수를 추적하여 제한 초과 시 연결 종료:
```typescript
socket.on('data', (chunk) => {
    totalBytes += chunk.length;
    if (totalBytes > MAX_MESSAGE_BYTES) {
        socket.destroy(new Error('IPC message size limit exceeded'));
    }
});
```
또는 readline 대신 커스텀 framing 프로토콜 사용.

**수정 파일**: `src/server/ipc-coordinator.ts`
**노력**: M (1시간)

---

### SEC-H-4: `LockManager` — 스탈 락 정리 시 DB 경로 계산 오류

**파일**: `src/utils/lock-manager.ts:66-74`
**우선순위**: 🟠 HIGH

**현상**:
```typescript
// this.lockPath = ~/.cynapx/locks/<hash>.lock
const dbFile = path.join(
    path.dirname(path.dirname(this.lockPath)),  // ~/.cynapx/..  = ~ (홈 디렉토리)
    `${path.basename(this.lockPath, '.lock')}.db`   // ~/<hash>.db
);
// 실제 DB 경로: ~/.cynapx/<hash>_v2.db  ← 전혀 다름
```

계산된 경로(`~/<hash>.db`)가 실제 DB 경로(`~/.cynapx/<hash>_v2.db`)와 다르다. 결과적으로 스탈 락 정리 시 WAL/SHM 파일이 삭제되지 않고, SQLite가 DB를 계속 잠근 상태로 인식하여 새 호스트가 DB를 열지 못할 수 있다.

**수정 방향**:
```typescript
import { getDatabasePath } from './paths';
const lockHash = path.basename(this.lockPath, '.lock');
// getDatabasePath를 사용하거나, 중앙 스토리지 디렉토리에서 직접 경로 계산
const dbFile = path.join(getCentralStorageDir(), `${lockHash}_v2.db`);
```

**수정 파일**: `src/utils/lock-manager.ts`
**노력**: S (20분)

---

### SEC-M-1: Rate Limiter — `X-Forwarded-For` 헤더로 IP 스푸핑

**파일**: `src/server/api-server.ts:77-78`
**우선순위**: 🟡 MEDIUM

**현상**: `express-rate-limit`은 기본적으로 `req.ip`를 사용하는데, Express는 `trust proxy` 설정이 있을 때 `X-Forwarded-For` 헤더를 `req.ip`로 채운다. 현재 코드에서 `trust proxy`가 명시되지 않았지만 프록시 환경에서는 공격자가 `X-Forwarded-For: 1.2.3.4`를 반복 변경하여 rate limit 우회 가능.

**수정 방향**: `keyGenerator`를 `req.socket.remoteAddress` 기반으로 고정:
```typescript
const globalLimiter = rateLimit({
    windowMs: 60_000,
    max: 100,
    keyGenerator: (req) => req.socket.remoteAddress || 'unknown',
});
```

**수정 파일**: `src/server/api-server.ts`
**노력**: S (10분)

---

### SEC-M-2: Swagger UI — 인증 없이 API 구조 전체 노출

**파일**: `src/server/api-server.ts:154`
**우선순위**: 🟡 MEDIUM

**현상**:
```typescript
// 인증 미들웨어보다 먼저 등록됨
this.app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
```

인증 없이 `/api/docs`에 접근하면 전체 API 스펙(엔드포인트, 파라미터, 스키마)이 노출됨. 공격자에게 공격 surface를 제공.

**수정 방향**: 개발 환경에서만 노출 (`NODE_ENV !== 'production'`), 또는 인증 미들웨어 통과 후 등록:
```typescript
if (process.env.NODE_ENV !== 'production') {
    this.app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
}
```

**수정 파일**: `src/server/api-server.ts`
**노력**: S (10분)

---

### SEC-M-3: `.server-port` 파일 — CWD에 서버 포트 정보 노출

**파일**: `src/server/api-server.ts:386`
**우선순위**: 🟡 MEDIUM

**현상**:
```typescript
server.listen(port, bindAddress, () => {
    ...
    try { fs.writeFileSync('.server-port', String(port)); } catch(e) {}
});
```

API 서버 포트를 현재 작업 디렉토리의 `.server-port` 파일에 쓴다. 이 파일이 소스 코드 디렉토리라면 git에 커밋될 수 있으며, 공유 디렉토리라면 다른 사용자에게 서버 포트가 노출된다.

**수정 방향**: 중앙 스토리지 디렉토리에 쓰거나, 완전히 제거:
```typescript
// 제거 또는 ~/.cynapx/ 하위로 이동
const portFile = path.join(getCentralStorageDir(), 'api-server.port');
fs.writeFileSync(portFile, String(port));
```

**수정 파일**: `src/server/api-server.ts`
**노력**: S (10분)

---

## 4. Wave 설계

### 파일 충돌 분석

| 파일 | 항목 |
|------|------|
| `src/server/api-server.ts` | H-1, M-4, L-1, SEC-H-1, SEC-M-1, SEC-M-2, SEC-M-3 |
| `src/server/mcp-server.ts` | H-1 |
| `src/server/tool-dispatcher.ts` | SEC-C-2, SEC-H-2 |
| `src/server/ipc-coordinator.ts` | SEC-C-1, SEC-H-3 |
| `src/graph/graph-engine.ts` | H-2 (getter 추가) |
| `src/bootstrap.ts` | H-2 (as any 제거) |
| `src/server/health-monitor.ts` | M-1 |
| `src/indexer/update-pipeline.ts` | M-2, M-3 |
| `src/utils/lock-manager.ts` | SEC-C-1(일부), SEC-H-4 |
| `tests/` | L-2 |

---

### Wave 1 — 일반 개선 (병렬 5체인)

> Gate 1: `npx tsc --noEmit` 0 errors + `npx vitest run` 전체 통과

| Chain | 항목 | 파일 | 노력 |
|-------|------|------|------|
| A | H-1 + M-4 | `api-server.ts`, `mcp-server.ts` | M |
| B | H-2 | `graph-engine.ts`, `bootstrap.ts` | S |
| C | M-1 | `health-monitor.ts` | S |
| D | M-2 + M-3 | `update-pipeline.ts` | S |
| E | L-1 | `api-server.ts`※ | S |

※ Chain E는 A와 같은 파일이므로 **Chain A에 통합** (A가 H-1+M-4+L-1 처리)

| Chain | 항목 | 파일 | 노력 |
|-------|------|------|------|
| A | H-1 + M-4 + L-1 | `api-server.ts`, `mcp-server.ts` | M |
| B | H-2 | `graph-engine.ts`, `bootstrap.ts` | S |
| C | M-1 | `health-monitor.ts` | S |
| D | M-2 + M-3 | `update-pipeline.ts` | S |
| E | L-2 | `tests/infrastructure.test.ts` (신규) | L |

---

### Wave 2 — 보안 수정 (병렬 3체인)

> Wave 1 Gate 통과 후 시작
> Gate 2: `npx tsc --noEmit` 0 errors + `npx vitest run` 전체 통과

| Chain | 항목 | 파일 | 노력 |
|-------|------|------|------|
| A | SEC-C-1 + SEC-H-3 | `ipc-coordinator.ts`, `lock-manager.ts` | M |
| B | SEC-C-2 + SEC-H-2 | `tool-dispatcher.ts` | S |
| C | SEC-H-1 + SEC-H-4 + SEC-M-1 + SEC-M-2 + SEC-M-3 | `api-server.ts`, `lock-manager.ts` | M |

> Chain A와 C 모두 `lock-manager.ts`를 수정: A는 nonce 인증 추가, C는 DB 경로 수정. 서로 다른 메서드이므로 병렬 가능하나 merge 시 주의.
