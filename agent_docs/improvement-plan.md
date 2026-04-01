# Cynapx 프로젝트 개선 계획

> **최초 작성**: 2026-03-28 / **최종 갱신**: 2026-04-01 (5차 세션)
> **대상 버전**: v1.0.6
> **총 소스 파일**: 52개 TypeScript, 1개 Rust (napi-rs), 12개 Tree-sitter .scm 쿼리

---

## 1. 아키텍처 요약

```
src/
├── db/          (5 files)  — SQLite 데이터베이스 추상화 계층
├── indexer/     (14 files) — Tree-sitter 파싱 및 인덱싱 파이프라인
├── graph/       (6 files)  — 그래프 알고리즘, 아키텍처 분석
├── server/      (5 files)  — MCP, REST API, IPC, REPL 서버
├── utils/       (7 files)  — 보안, 잠금, 인증서, 경로 관리
├── watcher/     (1 file)   — 파일 변경 감시
├── types/       (1 file)   — 핵심 타입 정의
└── bootstrap.ts            — CLI 진입점 및 서비스 오케스트레이션
```

---

## 2. 완료된 항목

### 2.1 보안 (CRITICAL) — 모두 완료

| 항목 | 내용 | 완료 시점 |
|------|------|-----------|
| C-1 SQL Injection | `handleHotspots()` whitelist + parameterized query | 1차 세션 |
| C-2 인증 토큰 | `crypto.randomBytes(32)` 자동 생성, `--no-auth` 플래그 | 1차 세션 |
| C-3 테스트 인프라 | Vitest 설치, 58개 테스트 (`tests/` 4개 파일) | 1차 세션 |

### 2.2 안정성/보안 (HIGH) — 모두 완료

| 항목 | 내용 | 완료 시점 |
|------|------|-----------|
| H-1 Rate Limiting | `express-rate-limit` 100/min 전역, 분석 엔드포인트 10/min; `--bind` 옵션 | 3차 세션 |
| H-2 Python Sidecar | 요청 큐잉, 3회 자동 재시작 (지수 백오프), FTS5 fallback | 3차 세션 |
| H-3 GraphEngine LRU | `nodeCache`/`qnameCache` max 10,000; `impactCache` max 5,000 | 3차 세션 |
| H-4 CI/CD | `ci.yml` (Node 20/22 matrix) + `release.yml` (npm publish on v\*) | 3차 세션 |
| H-5 IPC Request ID | `Math.random()` → `crypto.randomUUID()` | 2차 세션 |

### 2.3 개선 (MEDIUM) — 모두 완료

| 항목 | 내용 | 완료 시점 |
|------|------|-----------|
| M-1 Worker Pool | 30초 타임아웃, worker 자동 재시작, 큐 백프레셔 (max 100) | 3차 세션 |
| M-2 버전 관리 | `bootstrap.ts`에서 `package.json` version 동적 로드 | 2차 세션 |
| M-3 Cross-Platform | CI matrix에 win-x64/linux-x64/darwin-x64/darwin-arm64 빌드 추가 | 3차 세션 |
| M-4 Zod 입력 검증 | 모든 REST 엔드포인트에 Zod 스키마 8개 적용, 400 에러 표준화 | 3차 세션 |
| M-5 Lock Manager | `'locks\\'` 하드코딩 → `path.join()` / `path.sep` | 2차 세션 |

### 2.4 엔진 정확도 (ENGINE) — 대부분 완료

| 항목 | 내용 | 완료 시점 |
|------|------|-----------|
| E-2 CC 계산 일관성 | `??` 연산자를 native path + JS AST path 모두에 추가 | 2차 세션 |
| E-3 purge_index EBUSY | `dbManager?.dispose()` 후 파일 삭제; `_closed` 플래그로 이중 close 방지 | 2차 세션 |
| E-4 remediation 크래시 | `violation.source?.tags`, `violation.target?.tags` optional chaining | 2차 세션 |
| E-5 Worktree 중복 인덱싱 | `toCanonical()` 기반 경로 비교로 교체 | 2차 세션 |
| E-6 미발행 엣지 타입 | TypeScript 파서: `contains`(class→method), `overrides`(method→parent) 엣지 추가 | 2차 세션 |
| E-1 (부분) fan_in 재계산 | `update-pipeline.ts`에 Pass 3 추가: 엣지 기반 fan_in/fan_out 전체 재계산 | 3차 세션 |
| E-1 (부분) NOT EXISTS 수정 | `optimization-engine.ts`: `defines`→`contains`, `inherits` 케이스 추가 | 3차 세션 |

### 2.5 기타

| 항목 | 내용 | 완료 시점 |
|------|------|-----------|
| CI build:copy 수정 | PowerShell → Node.js `fs.cpSync` (cross-platform) | 3차 세션 |
| `express.json` size limit | `limit: '1mb'` 추가 | 1차 세션 |

---

## 3. 미완료 항목

### 3.1 E-1-B: Dead Code 신뢰도 레벨 분리 ✅ 완료 (4차 세션, PR #5)

HIGH/MEDIUM/LOW 3단계 분리 구현 완료. `potentialDeadCode` 후방 호환 유지.
실측: HIGH 11개, MEDIUM 0개, LOW 265개 (총 276개).

---

### 3.2 알려진 미해결 이슈

| 이슈 | 원인 | 권장 대응 |
|------|------|-----------|
| 워크트리 인덱스 중복 | `initialize_project` 시 main+worktree 동시 인덱싱 | 세션 시작 시 `purge_index` 후 main만 초기화 |
| `this.field.method()` call resolution 실패 | TypeScript 파서 타입 추론 한계 | E-1-B 신뢰도 레벨로 보완 |
| `treesitterparser.calculatecc` private 메서드 | 실제 unused일 가능성 있음 | 수동 검토 후 제거 여부 결정 |

---

### 3.3 LOW 항목 (분기별 개선, 미착수)

| 항목 | 내용 | 노력 |
|------|------|------|
| L-1 | `CHANGELOG.md`, `CONTRIBUTING.md` 생성 | S |
| L-2 | OpenAPI/Swagger 스펙 + `swagger-ui-express` 통합 | M |
| L-3 | 각 `.scm` 쿼리에 대한 golden test 파일 + expected output | L |
| L-4 | Plugin API 문서 + 예제 플러그인 | M |
| L-5 | 다양한 크기 프로젝트 대상 인덱싱 성능 벤치마크 | M |

---

## 4. 현재 분석 엔진 정확도 (3차 세션 기준)

| 항목 | 이전 | 현재 | 목표 |
|------|------|------|------|
| Dead code false positive | ~65% (224개 중) | ~88% (246개 중, E-1-B 미적용) | HIGH 레벨 <5% |
| CC 정확도 | Native/JS 불일치 | `??` 추가, 단일 경로 일관성 향상 | ±5% 이내 |
| purge_index 성공률 | MCP 실행 중 실패 | 항상 성공 | — |
| 엣지 타입 활용률 | 4/15 | 8/15 (`contains`, `overrides`, `implements`, `inherits` 추가) | 10/15+ |
| 테스트 커버리지 | 0개 | 58개 (4개 파일) | 100+ |

> **다음 세션**: L-1 (CHANGELOG/CONTRIBUTING), L-2 (OpenAPI/Swagger) 진행 예정
