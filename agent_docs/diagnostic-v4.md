# Cynapx v1.0.6 종합 진단서 (Phase 6 개선 계획)

> **작성일**: 2026-04-03 (10차 세션)
> **최종 업데이트**: 2026-04-03 (10차 세션) — Phase 5 완료 후 실증 검증 중 발굴
> **진단 방법**: Phase 5 dist 빌드 후 실서버 기동 + REST API / MCP 프로토콜 엔드투엔드 검증
> **진단 범위**: MCP 전송 계층, 서버 안정성

---

## 목차

1. [진단 요약](#1-진단-요약)
2. [HIGH — 안정성/보안](#2-high--안정성보안)
3. [Wave 설계](#3-wave-설계)

---

## 1. 진단 요약

| 우선순위 | 항목 수 | 완료 | 잔여 | 핵심 위험 |
|----------|---------|------|------|-----------|
| 🟠 HIGH | 1 | 0 | 1 | MCP 다중 세션 크래시 |
| **합계** | **1** | **0** | **1** | |

---

## 2. HIGH — 안정성/보안

---

### H-1: MCP StreamableHTTP 다중 세션 크래시

**우선순위**: 🟠 HIGH
**발견 경위**: Phase 5 실증 검증 세션 — 두 번째 MCP HTTP 요청 시 서버 즉시 크래시 확인

#### 증상

두 번째 클라이언트가 `/mcp` 엔드포인트에 연결을 시도하면 다음 에러와 함께 서버가 exit(1):

```
Error: Already connected to a transport. Call close() before connecting to a new transport,
or use a separate Protocol instance per connection.
    at Server.connect (node_modules/@modelcontextprotocol/sdk/...protocol.js:221)
    at McpServer.connectTransport (dist/server/mcp-server.js:158)
    at ApiServer.handleMcp (dist/server/api-server.js:199)
```

#### 근본 원인

`McpServer`는 내부에 `SdkMcpServer` 싱글톤 인스턴스를 보유합니다. MCP SDK의 `Server.connect(transport)`는 **인스턴스당 한 번만** 호출 가능하며, 두 번째 호출 시 예외를 throw합니다.

`ApiServer.handleMcp()`는 새 HTTP 세션마다 `connectTransport()`를 호출하므로, 첫 번째 세션 이후 모든 추가 연결이 서버를 다운시킵니다.

**충돌 경로** (`src/server/api-server.ts`):

```typescript
// handleMcp — 매 새 세션마다 실행됨
const transport = new StreamableHTTPServerTransport({ ... });
this.mcpTransports.set(sessionId, transport);
await this.mcpServer.connectTransport(transport);  // ← 2번째 호출 시 throw
```

**충돌 경로** (`src/server/mcp-server.ts`):

```typescript
public async connectTransport(transport: any) {
    await this.sdkServer.connect(transport);  // ← SdkMcpServer 싱글톤에 재연결 불가
}
```

#### 영향

- MCP over HTTP(StreamableHTTP)를 사용하는 클라이언트 2개 이상 → 서버 프로세스 즉시 종료
- stdio MCP 모드(`start()`)는 영향 없음 — 단일 transport
- REST API(`/api/*`)는 영향 없음 — MCP 코드 경로와 무관

#### 수정 방향

MCP SDK의 올바른 StreamableHTTP 패턴은 **세션(연결)당 새 `Server` 인스턴스**를 생성하는 것입니다.

**옵션 A — 세션별 SdkMcpServer 생성 (권장)**

`McpServer.connectTransport()` 대신, `handleMcp()`에서 새 `SdkMcpServer`를 생성하고 핸들러를 등록:

```typescript
// api-server.ts
private async handleMcp(req: Request, res: Response) {
    ...
    // 세션마다 새 SDK 서버 인스턴스
    const sessionServer = new SdkMcpServer({ name: 'cynapx', version });
    registerToolHandlers(sessionServer, toolDeps);
    const transport = new StreamableHTTPServerTransport({ ... });
    await sessionServer.connect(transport);
    ...
}
```

**옵션 B — 기존 transport close 후 재연결**

싱글톤 구조를 유지하되, 새 세션 연결 전 기존 transport를 닫는 방식. 동시 다중 세션을 지원하지 않으므로 권장하지 않음.

#### 관련 파일

- `src/server/api-server.ts` — `handleMcp()` 메서드 (~line 168)
- `src/server/mcp-server.ts` — `connectTransport()`, `sdkServer` 필드
- `src/server/tool-dispatcher.ts` — `registerToolHandlers()` 재사용 가능

---

## 3. Wave 설계

항목이 1개이므로 단일 Chain으로 구성합니다.

### Wave 1 — Chain A (단독)

| 작업 | 파일 |
|------|------|
| H-1: handleMcp 세션별 SdkMcpServer 생성 | `src/server/api-server.ts`, `src/server/mcp-server.ts` |
| H-1: 회귀 테스트 — MCP 다중 세션 동시 연결 | `tests/mcp-transport.test.ts` (신규) |

**Gate 조건**: `npx tsc --noEmit` 0 errors + `npx vitest run` 전체 통과 + `/mcp` 엔드포인트 2개 동시 세션 연결 시 크래시 없음
