# Cynapx Diagnostic v8

> **작성일**: 2026-04-17  
> **대상**: v1.0.6 (Phase 10 완료 기준)  
> **이전 진단**: diagnostic-v7.md (Phase 9 완료 기준, 164 테스트)

---

## 1. 현황 요약

Phase 10 전체 완료. 주요 변경사항:

| 항목 | 이전 (v7) | 현재 (v8) |
|------|-----------|-----------|
| 단위 테스트 | 164개 | **206개** (+42) |
| 통합 테스트 어서션 | 56개 | **~62개** (+backfill E2E) |
| `as any` 실 코드 | 2개 | **0개** |
| `executeTool` CC | 159 | **1** |
| `executeTool` LOC | 487 | **9** |
| 인덱싱 지원 형식 | TS/JS/Go/Py/Ruby | **+YAML/JSON/Markdown** |
| Admin CLI | 없음 | **8개 명령** |
| 감사 로그 | 없음 | **NDJSON audit.log** |
| 컨테이너 배포 | 불가 | **Dockerfile 제공** |
| 헬스체크 | 없음 | **/healthz 엔드포인트** |

---

## 2. Phase 10 완료 항목 상세

### 2-1. executeTool 리팩토링 (commit `53977ce`)

- **Before**: 730라인 단일 파일, switch/case 20개 케이스 인라인, CC=159, fan_out=48
- **After**: `src/server/tools/` 아래 23개 파일로 분리
  - `_types.ts` — ToolHandler / ToolResult 인터페이스
  - `_utils.ts` — RRF merge, XML/DOT escape 유틸
  - `_registry.ts` — Map<string, ToolHandler> 레지스트리
  - 20개 독립 핸들러 파일
- `executeTool` 본문 487LOC → **9LOC** (CC: 159→1, fan_out: 48→2)
- 함수 시그니처 유지로 mcp-server.ts, ipc-coordinator.ts 수정 없음
- `initializationInProgress` mutex → `initialize-project.ts` 소유로 이전

### 2-2. get_related_tests 개선 (commits in P10-M-2, M-4)

**P10-M-4 — basename fuzzy 매칭**:
- `resolveProductionFile`에 `walkForFileFuzzy` 추가
- `tests/parser.test.ts` → 기존: null (exact `parser.ts` 못 찾음)
- After: `src/indexer/typescript-parser.ts` 정상 매핑 (stem="parser" 포함)
- 우선순위: exact match 먼저, fuzzy는 fallback

**P10-M-2 — 함수 수준 정밀 매핑**:
- `describe('LockManager — basic tests')` 같은 복합 이름에서 선행 PascalCase 식별자 추출
- `LockManager — basic tests` 전체 엣지 + `LockManager` 정밀 엣지 **동시** 생성
- 기존 동작 유지(하위 호환) + 정밀도 향상

### 2-3. 비-TS 파일 인덱싱 (P10-M-1)

3개 신규 `CodeParser` 구현체:

| 파서 | 지원 확장자 | 추출 항목 |
|------|------------|----------|
| `YamlParser` | `.yml`, `.yaml` | 파일 노드 + 최상위 config_key + CI jobs → function 노드 |
| `MarkdownParser` | `.md`, `.mdx` | 파일 노드 + H1/H2 → section 노드 (slug 기반 qname) |
| `JsonConfigParser` | `.json`, `.jsonc` (package.json 제외) | 파일 노드 + 최상위 키 → config_key 노드, JSONC 주석 지원 |

`src/types/index.ts`의 `SymbolType`에 `'config_key' | 'section'` 추가.  
`index-worker.ts`, `bootstrap.ts`의 CompositeParser에 등록.

### 2-4. backfill_history E2E 검증 (P10-L-1)

`scripts/integration-test.js` Phase 21 추가:
- `backfill_history` 비-터미널 모드 실제 실행
- DB에서 `history IS NOT NULL AND history != '[]'` 조건으로 노드 조회
- 각 history 엔트리가 `hash`, `author`, `date` 필드를 가지는지 구조 검증
- 단일 커밋 프로젝트는 WARN으로 처리 (FAIL 아님)

### 2-5. /healthz 엔드포인트 + Dockerfile (P10-L-4)

**GET /healthz** (인증 불필요):
```json
{
  "status": "ok",         // "ok" | "pending"
  "version": "1.0.6",
  "indexed": true,
  "project": "/path/to/project",
  "uptime": 42,
  "timestamp": "2026-04-17T..."
}
```

**Dockerfile** (multi-stage):
- Stage 1 (builder): Node 20 + build toolchain → tsc compile
- Stage 2 (runtime): Node 20 slim + production deps only
- `HEALTHCHECK` CMD로 `/healthz` 폴링
- MCP stdio 모드(기본) / `--api` 플래그로 REST API 모드 전환

---

## 3. 정적 분석 결과 (v8 기준)

### 3-1. 주요 복잡도 지표

| 심볼 | CC | fan_out | LOC | 변화 |
|------|----|---------|-----|------|
| `executeTool` | **1** | **2** | **9** | ↓↓↓ (Phase 10 이전: 159/48/487) |
| `WorkspaceManager.initializeEngine` | 12 | 18 | ~80 | 변화 없음 (허용 범위) |
| `TypeScriptParser.emitTestEdges` | 8 | 6 | ~60 | ↓ (P10-M-2/M-4 후 소폭 증가) |
| `UpdatePipeline.syncWithGit` | 18 | 22 | ~120 | 변화 없음 |

### 3-2. 남은 기술 부채

| 항목 | 심각도 | 상세 |
|------|--------|------|
| `UpdatePipeline.syncWithGit` CC=18 | MEDIUM | 다음 Phase에서 전략 패턴 적용 고려 |
| `ApiServer.setupRoutes` CC=8 | LOW | 라우터 모듈 분리 가능 |
| `YamlParser` 라이브러리 없음 | LOW | `js-yaml` 도입 시 정확도 향상 가능 |
| IPC 채널 평문 직렬화 | LOW | MessagePack 등으로 교체 고려 |

### 3-3. 아키텍처 구조 (v8 기준)

```
src/server/
├── tool-dispatcher.ts          — 9LOC dispatcher (ToolDeps, registerToolHandlers)
├── tools/                      — NEW: 핸들러 레이어
│   ├── _types.ts               — ToolHandler / ToolResult
│   ├── _utils.ts               — 유틸 함수
│   ├── _registry.ts            — Map<string, ToolHandler>
│   └── {20 handlers}.ts        — 각 MCP tool 독립 구현
src/indexer/
├── yaml-parser.ts              — NEW: YAML 인덱싱
├── markdown-parser.ts          — NEW: Markdown 인덱싱
├── json-config-parser.ts       — NEW: JSON config 인덱싱
src/utils/
├── audit-logger.ts             — NEW: NDJSON 감사 로그
├── profile.ts                  — NEW: 프로젝트 프로파일
src/cli/
└── admin.ts                    — NEW: cynapx-admin 8개 명령
Dockerfile                      — NEW: 멀티 스테이지 컨테이너 이미지
```

---

## 4. 20개 MCP Tool 기능 평가 (Phase 10 기준)

| Tool | 상태 | 비고 |
|------|------|------|
| `get_setup_context` | ✅ | embedding 상태 포함 |
| `initialize_project` | ✅ | current/existing/custom 3모드 |
| `search_symbols` | ✅ | RRF 멀티 컨텍스트 + semantic |
| `get_symbol_details` | ✅ | source pruning 포함 |
| `analyze_impact` | ✅ | BFS, max_depth 20 상한 |
| `get_callers` | ✅ | JOIN 최적화 |
| `get_callees` | ✅ | JOIN 최적화 |
| `get_related_tests` | ✅ | 파일+함수 수준 + fuzzy basename |
| `check_architecture_violations` | ✅ | arch-rules.json 외부 설정 |
| `get_remediation_strategy` | ✅ | |
| `propose_refactor` | ✅ | Risk score 기반 |
| `get_risk_profile` | ✅ | CC+churn+coupling |
| `get_hotspots` | ✅ | SQL allowlist 방어 |
| `find_dead_code` | ✅ | 3단계 신뢰도 |
| `export_graph` | ✅ | JSON/GraphML/DOT |
| `check_consistency` | ✅ | repair 모드 |
| `purge_index` | ✅ | audit log 연동 |
| `re_tag_project` | ✅ | Terminal 모드 guard |
| `backfill_history` | ✅ | E2E 검증 추가 |
| `discover_latent_policies` | ✅ | threshold/min_count 검증 |

**전체 20/20 기능 정상**

---

## 5. 다음 Phase 후보 과제

Phase 10 완료로 대부분의 기술 부채가 해소되었습니다. 향후 과제:

| 우선순위 | 항목 | 상세 |
|---------|------|------|
| MEDIUM | A-4: 디스크 임계값 알림 | `~/.cynapx/` 총 사용량 초과 시 경고 |
| MEDIUM | A-5: 백업/복원 지원 | `cynapx-admin backup/restore` |
| MEDIUM | `UpdatePipeline.syncWithGit` 리팩토링 | CC=18, 전략 패턴 적용 |
| LOW | A-6: 웹훅 이벤트 발행 | 인덱싱 완료 시 POST |
| LOW | A-7: 멀티 머신 공유 인덱스 | 분산 잠금 전략 필요 |
| LOW | P10-L-3: 구조화 로그 | pino/winston 도입 |
| LOW | YamlParser → js-yaml 라이브러리화 | 더 정확한 YAML 파싱 |
