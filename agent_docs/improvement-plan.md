# Cynapx 프로젝트 개선 계획

> **최초 작성**: 2026-03-28 / **최종 갱신**: 2026-04-03 (10차 세션)
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

**테스트 커버리지**: 117개 (9개 파일) — Phase 5 완료 기준

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

## 3. 미완료 항목 (Phase 6)

1개 항목. 상세 내역: [`diagnostic-v4.md`](./diagnostic-v4.md)

| ID | 우선순위 | 내용 | 상태 |
|----|----------|------|------|
| H-1 | 🟠 HIGH | MCP StreamableHTTP 다중 세션 크래시 — `SdkMcpServer` 싱글톤에 `connect()` 재호출 불가, 두 번째 클라이언트 연결 시 서버 exit(1) | ⬜ 미착수 |

**수정 방향**: `handleMcp()`에서 세션마다 새 `SdkMcpServer` 인스턴스를 생성하고 `registerToolHandlers()`로 핸들러 재등록.
**관련 파일**: `src/server/api-server.ts` (handleMcp), `src/server/mcp-server.ts` (connectTransport)
**신규 테스트**: `tests/mcp-transport.test.ts` — 동시 2개 세션 연결 후 크래시 없음 검증

---

## 4. 알려진 미해결 이슈

| 이슈 | 원인 | 권장 대응 |
|------|------|-----------|
| 워크트리 인덱스 중복 | `initialize_project` 시 main + worktree 동시 인덱싱 | 세션 시작 시 `purge_index` 후 main만 초기화 |
| `this.field.method()` call resolution 실패 | TypeScript 파서 타입 추론 한계 | E-1-B 신뢰도 레벨로 보완 |

---

## 5. 분석 엔진 정확도 (Phase 5 완료 기준)

| 항목 | 초기 | 현재 |
|------|------|------|
| Dead code false positive | ~65% | HIGH <5% / MEDIUM ~30% / LOW >80% (E-1-B 3단계) |
| CC 정확도 | Native/JS 불일치 | `??` 추가, 양 경로 일관성 향상 |
| purge_index 성공률 | MCP 중 실패 | 항상 성공 |
| 엣지 타입 활용률 | 4/15 | 8/15 (`calls`, `contains`, `overrides`, `implements`, `inherits`, `defines`, `imports`, `file`) |
| 테스트 커버리지 | 0개 | **117개** (9개 파일) |
| API 문서 | 없음 | OpenAPI 3.0.3 (`/api/docs`) |
| 벤치마크 | 없음 | 3 suite 8개 (parsing/DB/tagging) |
