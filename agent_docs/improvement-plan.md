# Cynapx 프로젝트 개선 계획

> **최초 작성**: 2026-03-28 / **최종 갱신**: 2026-04-15 (Phase 9 핫픽스 + Phase 10 계획 수립)
> **대상 버전**: v1.0.6

---

## 1. 아키텍처 요약

```
src/
├── db/          — SQLite 데이터베이스 추상화 계층
├── indexer/     — Tree-sitter 파싱 + 인덱싱 파이프라인 + 임베딩
├── graph/       — 그래프 알고리즘, 클러스터링, 아키텍처 분석
├── server/      — MCP, REST API, IPC, REPL 서버, 도구 디스패처
├── utils/       — 보안, 잠금, 인증서, 경로 관리
├── watcher/     — 파일 변경 감시
├── types/       — 핵심 타입 정의
└── bootstrap.ts — CLI 진입점 및 서비스 오케스트레이션
```

**테스트 커버리지**: 146개 (10개 파일) — Phase 8 완료 기준

---

## 2. Phase별 완료 현황

### Phase 1 — 초기 안정화 (1~5차 세션, PR #1~#8)

모두 완료. 상세 내역은 하위 표 참조.

#### 보안 (CRITICAL)

| ID | 내용 | PR |
|----|------|----|
| C-1 | `handleHotspots()` whitelist + parameterized query (SQL injection) | #2 |
| C-2 | `crypto.randomBytes(32)` 인증 토큰 자동 생성 | #2 |
| C-3 | Vitest 설치, 58개 초기 테스트 구축 | #2 |

#### 안정성/보안 (HIGH)

| ID | 내용 | PR |
|----|------|----|
| H-1 | `express-rate-limit` 전역 100/min, 분석 엔드포인트 10/min; `--bind` 옵션 | #4 |
| H-2 | Python Sidecar 요청 큐잉 + 3회 자동 재시작(지수 백오프) + FTS5 fallback | #4 |
| H-3 | GraphEngine `nodeCache`/`qnameCache` LRU max 10,000; `impactCache` max 5,000 | #4 |
| H-4 | `ci.yml` (Node 20/22 matrix) + `release.yml` (npm publish on v\*) | #4 |
| H-5 | IPC Request ID: `Math.random()` → `crypto.randomUUID()` | #3 |

#### 개선 (MEDIUM)

| ID | 내용 | PR |
|----|------|----|
| M-1 | Worker Pool 30초 타임아웃 + 자동 재시작 + 큐 백프레셔 (max 100) | #4 |
| M-2 | `bootstrap.ts`에서 `package.json` version 동적 로드 | #3 |
| M-3 | CI matrix win-x64/linux-x64/darwin-x64/darwin-arm64 빌드 추가 | #4 |
| M-4 | 모든 REST 엔드포인트 Zod 스키마 8개 적용, 400 에러 표준화 | #4 |
| M-5 | Lock Manager `'locks\\'` 하드코딩 → `path.join()` / `path.sep` | #3 |

#### 엔진 정확도 (ENGINE)

| ID | 내용 | PR |
|----|------|----|
| E-1-B | `find_dead_code` HIGH/MEDIUM/LOW 3단계 신뢰도 분리 | #5 |
| E-2 | CC 계산 `??` 연산자 native + JS 양 경로 모두 추가 | #3 |
| E-3 | `purge_index` EBUSY: `dbManager?.dispose()` 후 파일 삭제; `_closed` 플래그 | #3 |
| E-4 | `remediation` 크래시: `violation.source?.tags`, `violation.target?.tags` optional chaining | #3 |
| E-5 | Worktree 중복 인덱싱: `toCanonical()` 기반 경로 비교 | #3 |
| E-6 | TypeScript 파서 `contains`(class→method), `overrides`(method→parent) 엣지 추가 | #3 |
| E-1 (partial) | `update-pipeline.ts` Pass 3: 엣지 기반 fan_in/fan_out 전체 재계산 | #4 |

#### 기타 (LOW)

| ID | 내용 | PR |
|----|------|----|
| L-1 | `CHANGELOG.md`, `CONTRIBUTING.md` 생성 | #7 |
| L-2 | OpenAPI 3.0.3 스펙 + `swagger-ui-express` (`/api/docs`) | #7 |
| L-3 | TS/PY/JS/Go 파서 golden/snapshot 테스트 81개 | #8 |
| L-4 | 언어 provider 확장 문서 + Ruby 예제 (`docs/`, `examples/`) | #8 |
| L-5 | Vitest 벤치마크 3 suite (parsing/DB/tagging) | #8 |

---

### Phase 2+3 — 심층 안정화 (8차 세션, PR #12)

25개 항목 완료. 상세 내역: [`diagnostic-v2.md`](./diagnostic-v2.md)

| 분류 | 항목 | 내용 |
|------|------|------|
| 🔴 C-1 | TypeScript Parser null 역참조 크래시 | `getSymbolAtLocation()` undefined 가드 |
| 🔴 C-2 | Remote DB 연결 리소스 누수 | `update-pipeline.ts` DB close 보장 |
| 🔴 C-3 | Worker pool 크래시 시 unhandled rejection | `try/catch` + reject 전파 |
| 🔴 C-4 | 원자적 파일 쓰기 누락 | TOCTOU nonce 패턴 적용 |
| 🔴 C-5 | DB 스키마 마이그레이션 누락 | 버전 감지 + ALTER TABLE |
| 🟠 H-1 | BFS 부모 포인터 누락 — 순환 그래프 무한루프 | BFS 방문 맵 + 부모 포인터 |
| 🟠 H-2 | GraphEngine 메모리 폭발 (대형 코드베이스) | LRU cache hit rate 로깅 |
| 🟠 H-3 | HealthMonitor 이중 초기화 | `_started` 플래그 가드 |
| 🟠 H-4 | IPC 포트 충돌 — 고정 포트 | 동적 포트 할당 |
| 🟠 H-5 | `check_consistency` 데이터 손상 | 트랜잭션 롤백 보장 |
| 🟠 H-6 | Worker pool 순환 호출 | `setImmediate` 적용 |
| 🟡 M-2 | `EngineContext` 타입 `as any` 완전 제거 | 명시적 타입 정의 |
| 🟡 M-3 | 구조화된 로거 `src/utils/logger.ts` | console.log → logger |
| 🟡 M-4 | `CrossProjectResolver` 추출 | graph-engine에서 분리 |
| 🟡 M-6 | 사이클 캐시 | `detectCycles()` memoization |
| 🟡 M-7 | `calculateCC` 데드코드 삭제 | private 메서드 제거 |
| 🟢 L-3 | dead code 생성자 false positive | `NOT LIKE '%#constructor'` |
| 🟢 L-4 | Windows `HOME` 환경변수 | `USERPROFILE \|\| HOME` |
| 🟢 L-5 | Git rename 추적 (R100 파싱) | `git log --follow` 파싱 개선 |
| 🟢 L-6 | `EdgeRepository` prepared statement 캐싱 | 반복 prepare 제거 |
| 🟢 L-7 | MCP 세션 정리 `HealthMonitor.stop()` | transport close 연동 |
| 🟢 L-8 | BFS/DFS 유닛 테스트 17개 | `tests/graph.test.ts` 신규 |
| 🟢 L-9 | 아키텍처 태그 대소문자 | `toLowerCase()` 정규화 |
| 🟢 L-10 | 타입 가드 교체 | `as any` → `instanceof` |
| — | L-1 수렴 종료 | 이미 구현됨 (스킵) |

---

### Phase 4 — 아키텍처 리팩터링 (9차 세션, PR #13)

3개 항목 완료 (diagnostic-v2.md M-1·M-5·L-2). 상세 내역: [`diagnostic-v2.md`](./diagnostic-v2.md)

| ID | 내용 |
|----|------|
| M-1 | `tool-dispatcher.ts` 추출: `mcp-server.ts` 578 → 168줄. `ToolDeps` 콜백 패턴으로 도구 로직 분리 |
| M-5 | `EmbeddingManager` 큐 분리: `queueTail` promise chain 직렬화, 배치당 2분 타임아웃 |
| L-2 | Label Propagation 클러스터링: O(V²) seed-BFS → O(V+E)/iteration LPA, max 20 iterations |

---

### Phase 5 — 보안·안정성·품질 (9차 세션, PR #14)

16개 항목 완료. 상세 내역: [`diagnostic-v3.md`](./diagnostic-v3.md)

| ID | 내용 | Wave |
|----|------|------|
| 🔴 C-1 | `get_hotspots` MCP 경로 SQL 인젝션: `ALLOWED_METRICS` whitelist | Wave 1 |
| 🔴 C-2 | `EmbeddingManager.refreshAll()` null 역참조: `enqueuedBatch` null 가드 | Wave 1 |
| 🟠 H-1 | `detectCycles()` 재귀 DFS → 명시적 스택 반복 DFS (스택 오버플로우 방지) | Wave 1 |
| 🟠 H-2 | `persistClusters()` `as any` 캡슐화 파괴 → `getDb()` 공개 메서드 + 단일 트랜잭션 | Wave 2 |
| 🟠 H-3 | `readyPromise` purge 후 재사용 불가 → `markReady(false)` 시 promise 재생성 | Wave 1 |
| 🟠 H-4 | API 서버 POST 페이로드 평문 로깅 → `CYNAPX_LOG_PAYLOADS=1` 환경변수 게이트 | Wave 1 |
| 🟡 M-1 | `searchSymbols('')` 조기 반환으로 `export_graph` 항상 빈 결과 → `getAllNodes().filter` | Wave 2 |
| 🟡 M-2 | 노드 삭제 시 고아 엣지 잔류 → 3개 호출 지점에서 엣지 먼저 삭제 | Wave 2 |
| 🟡 M-3 | `persistClusters()` NaN `avg_complexity` DB 삽입 → `length > 0` 가드 | Wave 2 |
| 🟡 M-4 | `SIGTERM` 핸들러 누락 → `SIGINT`와 동일 핸들러 등록 | Wave 1 |
| 🟡 M-5 | `mapHistoryToProject()` N+1 git 호출 → chunk 20 병렬 + 단일 쓰기 트랜잭션 | Wave 2 |
| 🟢 L-1 | LPA `Math.random()` 셔플 비결정성 → 인라인 주석으로 의도 문서화 | Wave 2 |
| 🟢 L-2 | Phase 4 테스트 공백 → 19개 신규 테스트 (3개 파일: tool-dispatcher, clustering, embedding-queue) | Wave 2 |
| 🟢 L-3 | `dfs()` dead `depth`/`path` 파라미터 → 시그니처에서 제거 | Wave 2 |
| 🟢 L-4 | MCP GET `/mcp` 인증 우회 → `!AUTH_TOKEN \|\| sessionId` 조건 검증 | Wave 1 |
| 🟢 L-5 | `isChecking` 예외 시 `false` 복구 누락 → `finally` 블록으로 이동 | Wave 1 |

---

### Phase 6 — 기능·안정성·보안 (12차 세션, PR #15)

17개 항목 완료. 상세 내역: [`diagnostic-v4.md`](./diagnostic-v4.md)

| ID | 분류 | 내용 |
|----|------|------|
| H-1 | 🟠 일반 | MCP StreamableHTTP 다중 세션 크래시 — 세션별 SdkMcpServer 인스턴스 생성 |
| H-2 | 🟠 일반 | `edgeRepo as any` 캡슐화 파괴 → `public get edgeRepo()` getter 추가 |
| M-1 | 🟡 일반 | HealthMonitor `catch {}` 예외 묵살 → `console.error` 로깅 |
| M-2 | 🟡 일반 | MCP 모드 `console.log` stdout 오염 → `console.error` 교체 |
| M-3 | 🟡 일반 | `BEGIN/COMMIT` raw SQL → `db.transaction()` 패턴 통일 |
| M-4 | 🟡 일반 | mcpTransports 메모리 누수 → 세션 종료 시 SdkMcpServer까지 정리 |
| L-1 | 🟢 일반 | `handleHotspots SELECT *` → 명시적 컬럼 선택 |
| L-2 | 🟢 일반 | 인프라 테스트 29개 신규 (WorkspaceManager/IpcCoordinator/HealthMonitor) |
| SEC-C-1 | 🔴 보안 | IPC 채널 인증 없음 → nonce 챌린지-응답 방식 추가 |
| SEC-C-2 | 🔴 보안 | `initialize_project` 임의 경로 쓰기 → 홈/cwd 범위 검증 |
| SEC-H-1 | 🟠 보안 | GET /mcp sessionId 인증 우회 → mcpSessions 맵 존재 검증 |
| SEC-H-2 | 🟠 보안 | `get_symbol_details` null securityProvider → 파일 읽기 차단 |
| SEC-H-3 | 🟠 보안 | IPC 메시지 크기 제한 없음 → 1MB 초과 시 연결 종료 |
| SEC-H-4 | 🟠 보안 | LockManager DB 경로 계산 오류 → `getCentralStorageDir()` 사용 |
| SEC-M-1 | 🟡 보안 | Rate Limiter X-Forwarded-For 스푸핑 → `socket.remoteAddress` keyGenerator |
| SEC-M-2 | 🟡 보안 | Swagger UI 인증 없이 노출 → `NODE_ENV !== production` 조건부 등록 |
| SEC-M-3 | 🟡 보안 | .server-port CWD 노출 → `~/.cynapx/api-server.port`로 이동 |

---

### Phase 7 — 동시성·에러 처리·타입 안전성 (PR #16, 2026-04-04)

13개 항목 완료. 상세 내역: [`diagnostic-v5.md`](./diagnostic-v5.md)

| ID | 분류 | 내용 |
|----|------|------|
| C-1 | 🔴 | getContext() null 역참조 — 10개 MCP 도구 null guard 추가 (1차) |
| H-1 | 🟠 | EmbeddingManager Python sidecar 레이스 컨디션 — PendingRequest 원자적 처리 |
| H-2 | 🟠 | search_symbols Promise.all 실패 전파 → Promise.allSettled() + partial 결과 반환 |
| H-3 | 🟠 | reTagAllNodes 이벤트 루프 블로킹 → setImmediate() 비동기 분할 (후속 C-2로 재수정) |
| H-4 | 🟠 | bootstrap 예외 시 타이머/리소스 미정리 → lifecycle.track() 적용 |
| M-1 | 🟡 | IPC timeout handler pendingRequests 누수 → timeout 핸들러에서 Map.delete() |
| M-2 | 🟡 | file-watcher syncWithGit 실패 복구 없음 → syncFailedCount + 재시도 로직 |
| M-3 | 🟡 | get_callers/callees N+1 쿼리 → EdgeRepository JOIN 메서드로 단일 쿼리 |
| M-4 | 🟡 | MCP 도구 인수 런타임 검증 부재 → metric whitelist, threshold 타입 검사 등 |
| M-5 | 🟡 | processBatch 파싱 실패 시 에러 메시지 미저장 → BatchResult discriminated union |
| M-6 | 🟡 | get_symbol_details node 타입 가드 불완전 → 명시적 타입 체크 |
| L-1 | 🟢 | readFileSync ENOENT/EACCES 구분 없음 → 에러 코드별 메시지 분기 |
| L-2 | 🟢 | Array.isArray(node.tags) 불필요한 이중 체크 제거 |

---

### Phase 8 — MCP Tool 기능 평가 + 정적 분석 전체 수정 (PR #17, 2026-04-14)

20개 항목 완료. 상세 내역: [`diagnostic-v6.md`](./diagnostic-v6.md)

#### Wave 1 — Critical 수정

| ID | 분류 | 내용 |
|----|------|------|
| C-1 | 🔴 | 10개 MCP Tool getContext() null guard 완전 적용 (get_related_tests 등 누락분 전체) |
| C-2 | 🔴 | reTagAllNodes 5-pass → 단일 db.transaction() 원자적 실행 (setImmediate 레이스 수정) |
| C-3 | 🔴 | export_graph format 파라미터 구현 — json/graphml/dot 실제 직렬화 |
| H-2 | 🟠 | find_dead_code MEDIUM SQL 버그 — NOT IN + trait:internal 논리 불가능 조합 제거 |
| H-3 | 🟠 | get_hotspots NaN threshold 거부 (Number.isNaN() 추가) |
| H-4 | 🟠 | propose_refactor + get_risk_profile 인수 유효성 검사 추가 |
| M-2 | 🟡 | discover_latent_policies NaN/음수 파라미터 검증 |
| M-4 | 🟡 | analyze_impact max_depth 상한 20 적용 |
| M-5 | 🟡 | get_callers/get_callees null qualified_name 가드 |

#### Wave 2 — High/Medium 수정

| ID | 분류 | 내용 |
|----|------|------|
| H-1 | 🟠 | initialize_project mode 파라미터 완전 구현 (current/existing/custom 3종) |
| H-5 | 🟠 | initialize_project fs.realpathSync() 추가 — 심볼릭 링크 경계 우회 방어 |
| H-6 | 🟠 | onInitialize 동시 호출 뮤텍스 — initializationInProgress 모듈 레벨 플래그 |
| M-1 | 🟡 | lock 파일 + port 파일 권한 0o600 강화 (기존 0o644) |
| M-3 | 🟡 | optimization-engine.ts (as any).db → nodeRepo.getDb() 캡슐화 복구 |
| M-6 | 🟡 | node-repository.ts safeJsonParse\<T\>() 헬퍼 — tags/history/modifiers JSON.parse 보호 |
| M-7 | 🟡 | embedding-manager.ts readline 인터페이스 재시작/dispose 시 close() |
| M-8 | 🟡 | file-watcher.ts dispose() 플러시 타이머 정리 |
| M-9 | 🟡 | mcp-server.ts CYNAPX_INSTRUCTIONS "Phase 14" → "v1.0.6" |
| L-3 | 🟢 | re_tag_project + backfill_history Terminal 모드 명시적 에러 반환 |

### 통합 테스트 + syncWithGit 버그 수정 (PR #18, 2026-04-15)

실제 프로젝트를 대상으로 20개 MCP Tool 통합 테스트 수행 중 발견·수정.

| 항목 | 내용 |
|------|------|
| 🔴 syncWithGit 신규 DB 버그 | `lastCommit === null` 시 조기 반환 → 신규 프로젝트 인덱싱 불가. `getAllTrackedFiles()` (git ls-files) 사용으로 전체 스캔 경로 추가 |
| 🟢 통합 테스트 | `scripts/integration-test.js` — 20개 도구 × 56개 어서션, 실제 인덱싱(64 노드, 116 엣지) 후 전체 통과 |

## 3. 미완료 항목

없음. 모든 Phase 1–8 항목 완료. PR #18(통합 테스트 + syncWithGit) 포함.

---

## 4. 알려진 미해결 이슈

| 이슈 | 원인 | 권장 대응 |
|------|------|-----------|
| 워크트리 인덱스 중복 | `initialize_project` 시 main + worktree 동시 인덱싱 | 세션 시작 시 `purge_index` 후 main만 초기화 |
| `this.field.method()` call resolution 실패 | TypeScript 파서 타입 추론 한계 | E-1-B 신뢰도 레벨로 보완 |

---

## 5. Phase 9 개선 과제 (2026-04-15 기준 미구현)

Phase 8 완료 + 통합 테스트(56/56) 결과를 바탕으로 도출한 차기 개선 항목.  
통합 테스트 중 발견된 기능 공백(★), 코드 정적 분석 결과(☆)로 구분한다.

### 🔴 HIGH — 실제 기능 공백

| ID | 항목 | 파일 | 발견 경위 | 상세 |
|----|------|------|-----------|------|
| P9-H-1 | **`get_related_tests` 항상 빈 배열 반환** ★ | `src/server/tool-dispatcher.ts:452`, `src/indexer/typescript-parser.ts` | 통합 테스트 — 모든 심볼에 대해 `[]` 반환 | 도구 코드는 `edge_type === 'tests'` 엣지를 조회하지만 TypeScript 파서가 이 엣지 타입을 **한 번도 생성하지 않는다**. `*.test.ts`/`*.spec.ts` 파일 내 `describe()`/`it()` 호출을 분석해 대응 프로덕션 심볼에 `tests` 엣지를 연결하는 로직 자체가 없음. **해결**: (a) 파서에 테스트 파일 전용 분석 패스 추가 후 `tests` 엣지 생성, 또는 (b) 파일명 컨벤션(`foo.ts` ↔ `foo.test.ts`) 기반 링킹 레이어 구현. |
| P9-H-2 | **WorkerPool `maxQueueSize=100` 고정 — 100개 초과 파일 무음 누락** ★ | `src/indexer/worker-pool.ts:40,122` | 통합 테스트 — 120개 파일 프로젝트에서 20개 파일 `"queue is full"` 오류로 누락 | 생성자 옵션으로 설정 가능하지만 `bootstrap.ts`가 기본값(100)을 그대로 사용. 101번째 이후 파일은 오류를 로깅하고 조용히 건너뜀 — `processBatch()` 호출자도 이 실패를 집계하지 않아 누락 여부를 알 수 없음. **해결**: `processBatch()` 전에 프로젝트 파일 수를 카운트해 `maxQueueSize`를 동적으로 설정, 또는 파일 목록을 100개 청크로 나눠 순차 `processBatch()` 호출. |

---

### 🟡 MEDIUM — 기능 있지만 제한적

| ID | 항목 | 파일 | 발견 경위 | 상세 |
|----|------|------|-----------|------|
| P9-M-1 | **`check_architecture_violations` — 레이어 규칙 하드코딩** ★ | `src/graph/architecture-engine.ts` | 통합 테스트 — 반환 결과가 엔진 내부 고정 규칙에만 의존 | `ArchitectureEngine.checkViolations()`는 실행되지만 프로젝트별 레이어 정의(예: `server → graph → db` 단방향)를 외부에서 주입할 방법이 없다. 모든 프로젝트가 동일한 내장 규칙을 공유함. **해결**: `initialize_project`에 `archRulesPath` 옵션 추가, 또는 프로젝트 루트 `arch-rules.json`을 자동 탐색해 `ArchitectureEngine`에 주입. |
| P9-M-2 | **비-TypeScript 파일 인덱싱 없음** ★ | `src/indexer/update-pipeline.ts`, `src/indexer/worker-pool.ts` | 통합 테스트 — `YAML`/`JSON`/`.md`/`.gitignore` 등 조용히 건너뜀 | 인덱싱된 64개 노드는 TS 파일만 해당; CI/CD 워크플로우(`*.yml`), `package.json`, `tsconfig.json` 등 설정 파일은 `"No parser found"` 메시지와 함께 무시됨. 코드 분석 맥락에서 중요한 의존성 정보가 누락될 수 있음. **해결**: 경량 "metadata-only" 파서 추가 — JSON(name/version/dependencies), YAML(job steps), Markdown(링크/코드블록) 정도만 추출해 `file` 타입 노드로 등록. |
| P9-M-3 | **Embedding Manager Python sidecar 부재 시 상태 불투명** ☆ | `src/indexer/embedding-manager.ts` | 정적 분석 — sidecar 없을 때 `refreshAll()` 백그라운드 오류만 로깅 | Python sidecar(`cynapx-embed`)가 없으면 `refreshAll()`이 백그라운드 `catch`에서 오류를 출력하고 종료. `search_symbols`의 시맨틱 검색 경로가 **silently disabled** 되어 사용자/에이전트가 임베딩이 동작 중인지 아닌지 알 수 없음. `get_setup_context` 응답에도 임베딩 상태가 반영되지 않음. **해결**: `EmbeddingManager`에 `isAvailable(): boolean` 상태 메서드 추가, `get_setup_context` 도구 응답에 `"embeddings": "enabled"/"disabled"` 필드 포함. |
| P9-M-4 | **`scripts/integration-test.js` `.gitignore` 우회 필요** ★ | `.gitignore`, `scripts/integration-test.js` | 통합 테스트 운영 — 매 커밋마다 `git add -f` 필요 | 현재 `.gitignore`가 `scripts/*.js` 또는 유사 패턴을 차단해 `git add -f`로만 추적 가능. 통합 테스트 자산임에도 정식 버전 관리되지 않아 팀 협업 시 유실 위험이 있음. **해결**: `.gitignore`에 `!scripts/integration-test.js` 예외 추가, 또는 파일을 `tests/integration/` 디렉토리로 이동해 vitest `integration` 설정 suite로 통합. |

---

### 🟢 LOW — 기술 부채 정리

| ID | 항목 | 파일(수) | 발견 경위 | 상세 |
|----|------|----------|-----------|------|
| P9-L-1 | **`as any` 캐스트 34개 — 타입 안전성 부채** ☆ | 11개 파일 (`edge-repository.ts` 5, `typescript-parser.ts` 5, `node-repository.ts` 4, 기타) | 정적 분석 | Phase 7 diagnostic-v6 L-1/L-2 항목으로 지적됐으나 미해결. 대부분 DB 레이어와 파서에 집중돼 있어 런타임 오류 위험은 낮지만 타입 안전성 보장이 없음. `better-sqlite3` 반환 타입 명시(`RunResult`, `Statement<Params>`) + 파서 AST 타입 정의로 순차 제거 가능. |
| P9-L-2 | **`backfill_history` 실 git 데이터 정확도 미검증** ★ | `src/server/tool-dispatcher.ts:645`, `src/indexer/update-pipeline.ts:108` | 통합 테스트 — 도구 크래시 없음, 반환값 내용 미확인 | 통합 테스트에서 `backfill_history`가 오류 없이 완료됐음을 확인했지만, 실제 다중 커밋 히스토리가 있는 파일에서 반환되는 `history` 배열의 정확성(hash, author, date 필드)은 검증하지 않았다. **해결**: 통합 테스트에 커밋 히스토리 3개 이상인 파일을 대상으로 `backfill_history` 후 DB에서 직접 `history` 컬럼을 쿼리해 구조 검증하는 어서션 추가. |
| P9-L-3 | **`diagnostic-v7.md` 미작성 — 다음 진단 사이클 없음** ☆ | `agent_docs/` | 프로세스 | Phase 8 + PR #18 이후 상태를 반영한 새 진단 문서가 없다. 현재 `diagnostic-v6.md`에 통합 테스트 결과(Section 7)가 추가됐지만, `P9-H-1`(테스트 엣지 없음), `P9-H-2`(큐 오버플로우) 등 새로 발견된 이슈들이 공식 진단 문서에 기록되지 않음. **해결**: Phase 9 구현 착수 전 `diagnostic-v7.md` 작성 — 20개 도구 재평가 + 4관점 정적 분석 + P9 항목 우선순위 책정. |

---

### Phase 9 완료 현황 (PR #19, 2026-04-15)

| ID | 항목 | 상태 |
|----|------|------|
| P9-H-1 | `get_related_tests` 테스트 엣지 실구현 | ✅ 완료 |
| P9-H-2 | WorkerPool 큐 청킹 + maxQueueSize getter | ✅ 완료 |
| P9-M-1 | arch-rules.json 외부 설정 로딩 | ✅ 완료 |
| P9-M-3 | Embedding sidecar 상태 → get_setup_context | ✅ 완료 |
| P9-M-4 | .gitignore integration-test.js 예외 추가 | ✅ 완료 |
| P9-L-1 | `as any` 34→3개 제거 (타입 안전성) | ✅ 완료 |
| P9-L-2 | backfill_history 유닛 테스트 3개 추가 | ✅ 완료 |
| P9-L-3 | diagnostic-v7.md 작성 | ✅ 완료 |
| P9-M-2 | 비-TS 파일 인덱싱 (YAML/JSON/Markdown) | ⏭ Phase 10 이관 |

**결과**: 146 → 164 테스트, tsc 0 오류, `as any` 34→3개

---

## 6. Phase 10 개선 계획 (2026-04-15 수립)

> **배경**: Phase 9 핫픽스(commit `2d073ad`) 완료 후 프로덕션 배포 준비도 감사 결과,  
> 단 2가지 실제 위험(전역 에러 핸들러 누락, CI lint 게이트 미작동)과  
> 기능·품질 부채 4가지가 남아있음을 확인. 이를 Phase 10 과제로 정식 등록한다.

---

### 6-1. Phase 10 과제 목록

#### 🔴 HIGH — 프로덕션 배포 전 필수

| ID | 항목 | 파일 | 상세 |
|----|------|------|------|
| **P10-H-1** | **Express 전역 에러 핸들러 + 프로세스 레벨 크래시 가드** | `src/server/api-server.ts`, `src/bootstrap.ts` | async 라우트 핸들러에서 throw된 에러가 잡히지 않으면 Node.js 프로세스가 이유 없이 종료될 수 있다. (1) Express 4-arg 에러 미들웨어(`(err, req, res, next)`) 등록, (2) `process.on('unhandledRejection')` + `process.on('uncaughtException')` 핸들러로 crash 전 정리 로직 보장. 예상 작업: 30분, 유닛 테스트 2개 추가. |

---

#### 🟡 MEDIUM — Phase 10 핵심

| ID | 항목 | 파일 | 상세 |
|----|------|------|------|
| **P10-M-1** | **비-TypeScript 파일 인덱싱 (YAML/JSON/Markdown)** | `src/indexer/composite-parser.ts`, `src/indexer/languages/` | Phase 9에서 이관된 항목. `package.json`(dependencies), `*.yml`(CI/CD job 이름), `*.md`(링크/코드블록) 등 설정 파일이 `"No parser found"` 오류로 무시됨. 경량 메타데이터 파서 3종 구현 후 `CompositeParser`에 등록. |
| **P10-M-2** | **`get_related_tests` 함수 수준 정밀 매핑** | `src/indexer/typescript-parser.ts`, `src/server/tool-dispatcher.ts` | 현재 `tests` 엣지가 파일 수준(file→file)으로만 생성됨. `describe('LockManager')`처럼 클래스명과 동일한 describe 블록에 한해 심볼 수준 엣지를 정확히 생성하도록 개선. 단, `describe('TypeScriptParser — test edge detection')`처럼 extra context가 붙은 경우 첫 번째 토큰만 추출해 매칭하는 정규식 로직 추가. |
| **P10-M-3** | **CI lint 게이트 활성화** | `package.json`, `.github/workflows/ci.yml` | 현재 `ci.yml`의 lint job이 `continue-on-error: true` + `package.json`에 `"lint"` 스크립트 미정의로 사실상 무동작. `"lint": "tsc --noEmit"` 추가 후 `continue-on-error` 제거. 실제 타입 검사가 CI 블로킹 게이트로 작동하도록 수정. |
| **P10-M-4** | **`get_related_tests` basename 불일치 대응** | `src/indexer/typescript-parser.ts` | `resolveProductionFile` 현재 구현은 `tests/parser.test.ts → src/indexer/typescript-parser.ts` 처럼 basename이 다른 경우(`parser.ts` ≠ `typescript-parser.ts`)를 처리하지 못함. 파일명에 테스트 대상 basename이 포함(`*-parser.ts`)되는 패턴을 인식하는 fuzzy 매칭 추가, 또는 프로젝트 루트에 `test-map.json` 명시적 매핑 파일을 지원. |

---

#### 🟢 LOW — 기술 부채 및 품질 개선

| ID | 항목 | 파일 | 상세 |
|----|------|------|------|
| **P10-L-1** | **`backfill_history` 멀티 커밋 정확도 E2E 검증** | `scripts/integration-test.js` | 통합 테스트에서 `backfill_history` 오류 없음을 확인했지만, 3개 이상 커밋 히스토리가 있는 파일의 `history` 배열(hash·author·date·message)을 실제로 검증하는 어서션 없음. 통합 테스트에 검증 블록 추가. |
| **P10-L-2** | **`as any` 잔여 2개 제거** | `src/indexer/embedding-manager.ts` | SQLite schema 동적 쿼리 반환 타입에 `as any` 2개 잔존. `{ sql?: string } \| undefined` 타입 별칭으로 교체. |
| **P10-L-3** | **구조화 로그 도입** | `src/utils/logger.ts` (신규), 전체 | 현재 `console.error()` 단순 텍스트 로깅. `pino` 또는 `winston` 기반 구조화 로거(`logger.info()`, `logger.error()`)로 교체 시 레벨 필터링·JSON 출력·운영 관측성이 크게 향상됨. Phase 2+3에서 `logger.ts` 틀이 만들어졌으나 전파 미완. |
| **P10-L-4** | **헬스체크 엔드포인트 + Docker 이미지** | `src/server/api-server.ts`, `Dockerfile` (신규) | REST API 서버에 `/healthz` (DB 연결, 인덱싱 상태 반환) 엔드포인트 추가. `Dockerfile` 작성으로 컨테이너 배포 경로 확보. |
| **P10-L-5** | **`diagnostic-v8.md` 작성** | `agent_docs/` | Phase 10 완료 후 20개 MCP 도구 재평가 + 정적 분석 결과를 기록하는 차기 진단 문서. |

---

### 6-2. 실행 우선순위 및 예상 일정

```
Week 1 (즉시)
  └── P10-H-1  전역 에러 핸들러        ← 30분, 프로덕션 blocking 해제
  └── P10-M-3  CI lint 게이트         ← 10분, CI 품질 게이트 복구

Week 1-2
  └── P10-M-2  tests 함수 수준 매핑   ← 반나절, P9-H-1 정밀도 향상
  └── P10-M-4  basename fuzzy 매칭   ← 1시간, resolveProductionFile 확장

Week 2-3
  └── P10-M-1  비-TS 파일 인덱싱     ← 1-2일, 독립 파서 3종 구현
  └── P10-L-1  backfill E2E 검증     ← 1시간, 통합 테스트 어서션 추가
  └── P10-L-2  as any 2개 제거       ← 30분

Week 3-4
  └── P10-L-3  구조화 로그            ← 반나절
  └── P10-L-4  /healthz + Docker     ← 반나절
  └── P10-L-5  diagnostic-v8.md      ← 문서 작업
```

---

### 6-3. Phase 10 완료 시 예상 수치

| 항목 | Phase 9 완료 | Phase 10 목표 |
|------|-------------|--------------|
| 단위 테스트 | 164개 | **~180개** (+16 예상) |
| 통합 테스트 어서션 | 56개 | **~62개** (+backfill E2E) |
| `as any` (실 코드) | 2개 | **0개** |
| 크래시 가드 | 없음 | **process-level 핸들러 2개** |
| CI 타입 체크 게이트 | 미작동 | **활성화** |
| 인덱싱 지원 언어 | TS/JS/Go/Py/Ruby | **+YAML/JSON/Markdown** |
| 컨테이너 배포 | 불가 | **Dockerfile 제공** |

---

## 7. 조직 배포·관리 계획 (2026-04-15 수립)

> **배경**: Cynapx v1.0.6은 기술적으로 프로덕션 수준에 도달했으나,  
> 조직 내 다수 개발자가 공유·관리하기 위한 **레지스트리 무결성, 버전 추적,  
> 관리자 CLI, 감사 로그** 등 운영 인프라가 부재하다.  
> 사용자 요구사항 4가지 + 부가 제안 7가지를 이 섹션에 통합 기록한다.

---

### 7-1. 요구사항 정의

#### 필수 요구사항 (Req 1~4) — 이번 Phase 구현 대상

| ID | 요구사항 | 상세 |
|----|---------|------|
| **Req-1** | **레지스트리 정합성** | `~/.cynapx/registry.json` 각 항목에 `node_count`, `edge_count`, `cynapx_version`, `last_indexed_at` 필드 추가. 인덱싱 완료 시 자동 갱신. |
| **Req-2** | **Stale 항목 감지** | DB 파일이 없거나 경로가 사라진 레지스트리 항목을 감지해 `status: "stale"` 마킹. `doctor` 명령으로 일괄 정리 가능. |
| **Req-3** | **버전 불일치 자동 재인덱싱** | DB 내부 `index_metadata` 테이블에 `cynapx_version` 키 저장. 서버 기동 시 현재 버전과 비교해 major/minor 변경 시 자동 purge + 전체 재인덱싱 트리거. `audit.log`에 이벤트 기록. |
| **Req-4** | **cynapx-admin CLI** | `src/cli/admin.ts` 신규. `npx cynapx-admin [command]` 형태로 서버 없이 직접 SQLite를 읽어 프로젝트 상태 출력. 명령: `status`(기본 대시보드), `list`, `inspect <name>`, `doctor`, `reindex <name>`, `purge <name>`, `unregister <name>`, `compact`. |

#### 부가 제안 (A1~A3) — 이번 Phase 구현 대상

| ID | 제안 | 상세 |
|----|------|------|
| **A-1** | **스키마 마이그레이션 레이어** | `PRAGMA user_version` 기반 마이그레이션. `src/db/database.ts`에 `runMigrations()` 추가. 마이그레이션 0→1: `index_metadata` 테이블에 `cynapx_version`·`indexed_at` 기본값 삽입. |
| **A-2** | **프로젝트 프로파일 파일** | `~/.cynapx/profiles/{hash}.json` — `excludePatterns`, `maxFileSize`, `languageOverrides` 등 프로젝트별 인덱싱 옵션 저장. `workspace-manager.ts`에서 자동 로드해 파이프라인에 주입. |
| **A-3** | **감사 로그 (Audit Log)** | `~/.cynapx/audit.log` NDJSON 형식. 이벤트: `index_start`, `index_complete`, `index_error`, `version_mismatch`, `reindex_triggered`, `purge`, `unregister`. `src/utils/audit-logger.ts` 신규 파일. |

#### 부가 제안 (A4~A7) — 향후 Phase 이관 (문서화만)

| ID | 제안 | 이관 사유 |
|----|------|-----------|
| **A-4** | **디스크 임계값 알림** | `~/.cynapx/` 총 사용량이 설정값(기본 1GB) 초과 시 `get_setup_context` 응답에 경고 포함. `compact` 명령으로 WAL 플러시 + `VACUUM`. → 독립 모니터링 루프 필요, 별도 Phase. |
| **A-5** | **백업/복원 지원** | `cynapx-admin backup <name>` — DB 파일을 `~/.cynapx/backups/` 타임스탬프 디렉토리로 복사. `restore <backup-path>` — 백업 복원. → 파일 I/O 안전성(잠금 중 복사 방지) 보장 필요, 별도 Phase. |
| **A-6** | **웹훅 이벤트 발행** | 인덱싱 완료·오류 시 `POST <webhook_url>` JSON 페이로드 발송. 프로파일 파일에 `webhookUrl` 필드 추가. → 재시도 로직·타임아웃 정책 필요, 별도 Phase. |
| **A-7** | **멀티 머신 공유 인덱스** | 공유 네트워크 드라이브나 S3에 DB를 저장해 팀 간 인덱스 공유. → 동시성·잠금 전략이 근본적으로 다름(분산 잠금), 대형 스코프로 별도 Phase. |

---

### 7-2. 구현 계획 (Wave 1 + Wave 2)

#### Wave 1 — 코어 인프라

```
1. A-1: src/db/database.ts — runMigrations() (PRAGMA user_version 0→1)
2. Req-3: src/db/metadata-repository.ts — getCynapxVersion/setCynapxVersion/getIndexedAt/setIndexedAt
3. Req-3: src/server/workspace-manager.ts — 버전 비교 + 자동 재인덱싱 로직
4. A-3: src/utils/audit-logger.ts — NDJSON append 감사 로그
5. A-2: src/utils/profile.ts — ProjectProfile 로드/저장
6. Req-1+2: src/utils/paths.ts — registry 갱신 (node_count, edge_count, cynapx_version, last_indexed_at)
7. 연동: workspace-manager.ts, update-pipeline.ts 감사 로그 + 프로파일 통합
```

#### Wave 2 — Admin CLI

```
8. Req-4: src/cli/admin.ts — status/list/inspect/doctor/reindex/purge/unregister/compact
9. package.json — "admin": "ts-node src/cli/admin.ts" 스크립트 추가
10. 유닛 테스트 ≥ 10개 신규
```

---

### 7-3. Phase 완료 목표 수치

| 항목 | 현재 (Phase 10) | 목표 |
|------|----------------|------|
| 단위 테스트 | 168개 | **~180개** |
| 통합 테스트 | 56/56 | 56/56 (유지) |
| tsc 오류 | 0 | 0 |
| 레지스트리 메타데이터 | 부재 | node/edge count + 버전 추적 |
| 버전 불일치 대응 | 없음 | 자동 재인덱싱 |
| 감사 로그 | 없음 | NDJSON audit.log |
| 프로젝트 프로파일 | 없음 | JSON 프로파일 파일 |
| Admin CLI | 없음 | 8개 명령 |

---

## 8. 분석 엔진 정확도 (Phase 9 완료 기준)

| 항목 | 초기 | 현재 |
|------|------|------|
| Dead code false positive | ~65% | HIGH <5% / MEDIUM ~30% / LOW >80% (E-1-B 3단계) |
| CC 정확도 | Native/JS 불일치 | `??` 추가, 양 경로 일관성 향상 |
| purge_index 성공률 | MCP 중 실패 | 항상 성공 |
| 엣지 타입 활용률 | 4/15 | 8/15 (`calls`, `contains`, `overrides`, `implements`, `inherits`, `defines`, `imports`, `file`) |
| 테스트 커버리지 | 0개 | **164개** (11개 파일) + 통합 테스트 56개 어서션 |
| API 문서 | 없음 | OpenAPI 3.0.3 (`/api/docs`) |
| 벤치마크 | 없음 | 3 suite 8개 (parsing/DB/tagging) |
| IPC 보안 | 인증 없음 | nonce 챌린지-응답, 1MB 메시지 크기 제한 |
| 경로 보안 | 검증 없음 | initialize_project 홈/cwd 범위 검증, null securityProvider 차단 |
| `tests` 엣지 로컬 해소 | 항상 `[]` | resolveProductionFile() 도입 — 파일시스템 검색으로 로컬 노드 연결 (P9-H-1 핫픽스) |
