# Cynapx 프로젝트 진단 및 개선 계획

> **작성일**: 2026-03-28
> **대상 버전**: v1.0.6 (package.json: 1.0.0, bootstrap: 1.0.5 — 버전 불일치 존재)
> **총 소스 파일**: 52개 TypeScript, 1개 Rust (napi-rs), 12개 Tree-sitter .scm 쿼리

---

## 1. 프로젝트 현황

Cynapx(시냅스엑스)는 AI 에이전트를 위한 고성능 격리형 코드 분석 엔진이다. Tree-sitter 기반 12개 언어 파싱, SQLite 지식 그래프, MCP/REST/CLI 인터페이스, Jina AI 임베딩 기반 시맨틱 검색을 지원한다. 17+ Phase를 완료하여 핵심 기능은 모두 구현되었으나, 아래와 같은 보안/안정성/품질 이슈가 방치되어 있다.

### 아키텍처 요약

```
src/
├── db/          (5 files, 489 lines)   — SQLite 데이터베이스 추상화 계층
├── indexer/     (14 files, 1,828 lines) — Tree-sitter 파싱 및 인덱싱 파이프라인
├── graph/       (6 files, 1,218 lines)  — 그래프 알고리즘, 아키텍처 분석
├── server/      (5 files, 1,278 lines)  — MCP, REST API, IPC, REPL 서버
├── utils/       (7 files, 449 lines)    — 보안, 잠금, 인증서, 경로 관리
├── watcher/     (1 file, 102 lines)     — 파일 변경 감시
├── types/       (1 file, 133 lines)     — 핵심 타입 정의
└── bootstrap.ts (1 file)               — CLI 진입점 및 서비스 오케스트레이션
```

---

## 2. 진단 요약

| 영역 | 상태 | 심각도 |
|------|------|--------|
| SQL Injection | `handleHotspots()`에서 사용자 입력 직접 SQL 삽입 | **CRITICAL** |
| 인증 토큰 | 하드코딩된 기본 토큰 `dev-token-1234` | **CRITICAL** |
| 테스트 인프라 | 테스트 프레임워크 미설치, 테스트 파일 0개 | **CRITICAL** |
| CI/CD | 파이프라인 없음 | HIGH |
| Rate Limiting | REST API 미적용 | HIGH |
| Python Sidecar | 동시성 미지원, 오류 무시 | HIGH |
| 메모리 관리 | GraphEngine 캐시 eviction 없음 | HIGH |
| 버전 관리 | 3곳에서 버전 불일치 (package.json / bootstrap.ts / 문서) | MEDIUM |
| Worker Pool | Timeout / 복구 미구현 | MEDIUM |
| Cross-Platform | Windows x64 전용 native 모듈 | MEDIUM |
| IPC Request ID | `Math.random()` 충돌 위험 | MEDIUM |
| Lock Manager | Windows 경로 하드코딩 | MEDIUM |
| 문서화 | CHANGELOG, 기여 가이드 미존재 | LOW |

---

## 3. 우선순위별 개선 항목

### CRITICAL (즉시 조치)

#### C-1. SQL Injection 취약점 제거
- **파일**: `src/server/api-server.ts` (line 212-213)
- **문제**: `handleHotspots()`에서 `metric`과 `symbol_type` 파라미터가 SQL 쿼리에 직접 문자열 결합됨
- **미조치 시 영향**: 악의적 입력으로 전체 DB 접근/수정/삭제 가능
- **해결 방안**:
  - `metric` 값을 허용된 컬럼명 whitelist (`loc`, `cyclomatic`, `fan_in`, `fan_out`, `fan_in_dynamic`, `fan_out_dynamic`)로 검증
  - `symbol_type`은 parameterized query (`?` placeholder) 사용
  - Zod schema 활용한 입력 검증 레이어 추가
- **노력 수준**: S
- **의존성**: 없음

#### C-2. 인증 토큰 보안 강화
- **파일**: `src/server/api-server.ts` (line 31)
- **문제**: `'dev-token-1234'` 기본 토큰이 프로덕션에서도 사용 가능
- **미조치 시 영향**: 토큰 미설정 시 누구나 API 접근 가능
- **해결 방안**:
  - 환경변수 미설정 시 `crypto.randomBytes(32)`로 랜덤 토큰 자동 생성
  - 시작 시 생성된 토큰을 stderr로 1회 출력
  - `--no-auth` 플래그로 명시적 비활성화 옵션 추가
- **노력 수준**: S
- **의존성**: 없음

#### C-3. 테스트 인프라 구축
- **문제**: 52개 소스 파일에 테스트 0개, 테스트 프레임워크 미설치
- **미조치 시 영향**: 리팩토링/변경 시 회귀 버그 감지 불가
- **해결 방안**:
  - Phase 1: Vitest 설치 (ESM 지원, TypeScript 네이티브, 빠른 실행)
  - Phase 2: 핵심 모듈 단위 테스트 (우선순위 순):
    1. `SecurityProvider` — path traversal 검증
    2. `NodeRepository` / `EdgeRepository` — CRUD 정합성
    3. `GraphEngine` — traversal 알고리즘
    4. `WorkerPool` — 동시성
    5. `LockManager` — lock lifecycle
  - Phase 3: API 통합 테스트 (supertest 활용)
  - Phase 4: 각 언어 파서 검증 테스트 (12개 .scm 파일)
- **노력 수준**: XL
- **의존성**: 없음

---

### HIGH (1-2주 내 조치)

#### H-1. REST API Rate Limiting 추가
- **파일**: `src/server/api-server.ts`
- **문제**: API 엔드포인트에 요청 제한 없음, `0.0.0.0` 바인딩
- **미조치 시 영향**: DoS 공격에 취약, 리소스 고갈 가능
- **해결 방안**:
  - `express-rate-limit` 추가 (IP 당 분당 100회)
  - 바인드 주소 `--bind` 옵션 추가 (기본값 `127.0.0.1`)
  - 입력 크기 제한 (`express.json({ limit: '1mb' })`)
- **노력 수준**: S
- **의존성**: 없음

#### H-2. Python Sidecar 안정성 강화
- **파일**: `src/indexer/embedding-manager.ts`
- **문제점**:
  - 단일 `pending` 변수로 동시 요청 불가 (line 27-28)
  - JSON parse 오류 무시 (line 59)
  - Python/Jina 미설치 시 300초 대기 후 타임아웃
  - Sidecar 크래시 후 자동 재시작 없음
- **미조치 시 영향**: 동시 embedding 요청 시 데이터 손실, 무한 대기 가능
- **해결 방안**:
  - Request ID 기반 다중 요청 처리 (`Map<id, Promise>`)
  - Python 가용성 사전 체크 (`which python` / `where python`)
  - 자동 재시작 (최대 3회) + exponential backoff
  - Graceful degradation: embedding 불가 시 FTS5 keyword 검색으로 fallback
- **노력 수준**: M
- **의존성**: 없음

#### H-3. GraphEngine 메모리 관리
- **파일**: `src/graph/graph-engine.ts`
- **문제**: `nodeCache`, `qnameCache`, `impactCache`에 eviction 정책 없음
- **미조치 시 영향**: 대규모 프로젝트에서 메모리 무한 증가
- **해결 방안**:
  - LRU 캐시 구현 (최대 10,000 항목)
  - `impactCache`에 TTL 적용 (5분)
  - 캐시 통계 메서드 추가 (hit/miss ratio)
- **노력 수준**: M
- **의존성**: 없음

#### H-4. CI/CD 파이프라인 구축
- **문제**: 자동화된 빌드/테스트/검증 없음
- **미조치 시 영향**: 빌드 실패 감지 지연, 품질 관리 불가
- **해결 방안**:
  - GitHub Actions workflow:
    - `ci.yml`: build, lint, test (Windows/Linux matrix)
    - `release.yml`: 태깅 시 자동 npm publish
  - ESLint + Prettier 설정 추가
- **노력 수준**: M
- **의존성**: C-3 (테스트 인프라)

#### H-5. IPC Request ID 충돌 방지
- **파일**: `src/server/ipc-coordinator.ts` (line 135)
- **문제**: `Math.random().toString(36).substring(7)` 사용 — 충돌 가능
- **해결 방안**: `crypto.randomUUID()` 사용
- **노력 수준**: S
- **의존성**: 없음

---

### MEDIUM (1개월 내 조치)

#### M-1. Worker Pool 강화
- **파일**: `src/indexer/worker-pool.ts`
- **문제**: 작업 타임아웃 없음, 죽은 worker 교체 미구현, 큐 크기 제한 없음
- **해결 방안**:
  - 작업 타임아웃 (기본 30초) + 자동 worker 재생성
  - 큐 크기 제한 + backpressure 메커니즘
  - Worker health check + 비정상 종료 시 작업 재시도
- **노력 수준**: M
- **의존성**: 없음

#### M-2. 버전 관리 일원화
- **문제**: `package.json` (1.0.0), `bootstrap.ts` (1.0.5), 프로젝트 문맥 (1.0.6) 불일치
- **해결 방안**:
  - `bootstrap.ts`에서 `package.json`의 version을 동적으로 읽어서 사용
  - `standard-version` 또는 `changesets`로 버전 자동화
- **노력 수준**: S
- **의존성**: 없음

#### M-3. Cross-Platform Native 모듈 빌드
- **파일**: `src-native/` (Cargo.toml, lib.rs)
- **문제**: Windows x64 전용 `.node` 파일만 존재
- **해결 방안**:
  - GitHub Actions matrix build (win-x64, linux-x64, darwin-x64, darwin-arm64)
  - `@napi-rs/cli`로 prebuild 자동화
  - Native 모듈 미존재 시 JS fallback 경로 검증
- **노력 수준**: L
- **의존성**: H-4 (CI/CD)

#### M-4. REST API 입력 검증 체계화
- **파일**: `src/server/api-server.ts` 전체
- **문제**: 각 핸들러에서 개별적 검증, 일관성 부족
- **해결 방안**:
  - Zod schema 기반 요청 검증 미들웨어
  - 모든 엔드포인트에 대한 스키마 정의
  - 검증 실패 시 표준화된 오류 응답
- **노력 수준**: M
- **의존성**: C-1 (SQL Injection 수정)

#### M-5. Lock Manager 크로스 플랫폼 호환
- **파일**: `src/utils/lock-manager.ts` (line 55)
- **문제**: `'locks\\'` 하드코딩된 Windows 경로 구분자
- **해결 방안**: `path.join()` / `path.sep` 일관 사용
- **노력 수준**: S
- **의존성**: 없음

---

### LOW (분기별 개선)

#### L-1. CHANGELOG 및 기여 가이드 작성
- **해결 방안**: `CHANGELOG.md`, `CONTRIBUTING.md` 생성
- **노력 수준**: S

#### L-2. API 문서 자동 생성
- **해결 방안**: OpenAPI/Swagger 스펙 작성 + `swagger-ui-express` 통합
- **노력 수준**: M
- **의존성**: M-4

#### L-3. 언어별 파서 품질 검증
- **해결 방안**: 각 `.scm` 쿼리에 대한 golden test 파일 + expected output
- **노력 수준**: L
- **의존성**: C-3

#### L-4. Plugin 시스템 문서화
- **해결 방안**: Plugin API 문서 + 예제 플러그인 작성
- **노력 수준**: M

#### L-5. 성능 벤치마크 스위트
- **해결 방안**: 다양한 크기의 프로젝트 대상 인덱싱 시간/메모리 측정
- **노력 수준**: M
- **의존성**: C-3

---

## 4. Quick Wins (즉시 적용 가능)

| # | 항목 | 파일 | 변경량 |
|---|------|------|--------|
| 1 | SQL Injection 수정 | `api-server.ts` | ~15줄 |
| 2 | 기본 인증 토큰 제거 | `api-server.ts` | ~10줄 |
| 3 | IPC request ID 수정 | `ipc-coordinator.ts` | 1줄 |
| 4 | 버전 통일 | `bootstrap.ts`, `package.json` | 2줄 |
| 5 | 바인드 주소 설정 | `api-server.ts`, `bootstrap.ts` | ~5줄 |
| 6 | Lock manager 경로 수정 | `lock-manager.ts` | 1줄 |
| 7 | `express.json` size limit | `api-server.ts` | 1줄 |

---

## 5. 권장 실행 순서

```
Week 1:  Quick Wins 전체 + C-3 Phase 1 (Vitest 설치)
Week 2:  H-1 (Rate Limit) + H-5 (IPC ID) + M-2 (버전 통일)
Week 3:  C-3 Phase 2 (핵심 단위 테스트)
Week 4:  H-2 (Sidecar) + H-3 (캐시 eviction)
Week 5:  M-4 (입력 검증) + M-1 (Worker Pool)
Week 6:  H-4 (CI/CD) + M-5 (Lock 크로스플랫폼)
Week 7+: C-3 Phase 3-4 + Medium/Low 항목 순차 진행
```

---

## 6. 기술 부채 요약

| 카테고리 | 항목 수 | 예상 총 노력 |
|----------|---------|-------------|
| CRITICAL | 3 | S + S + XL |
| HIGH | 5 | S + M + M + M + S |
| MEDIUM | 5 | M + S + L + M + S |
| LOW | 5 | S + M + L + M + M |

---

## 7. Cynapx 분석 엔진 개선 계획

> 2026-03-29 MCP 검증 테스트 결과 기반 추가

### 7.1 검증 테스트 결과 요약

Cynapx MCP 20개 도구 전체를 실행하여 분석 결과의 정확성을 검증한 결과:

| 검증 항목 | 평가 |
|-----------|------|
| McpServer.executeTool 메트릭 (LOC/라인/호출자) | **부분 정확** — CC 다소 과대 |
| GraphEngine 클래스 구조 분석 | **부분 정확** — impactCache TTL 미반영 |
| Dead Code 탐지 (224개 보고) | **부분 정확** — 60-70% false positive |
| Latent Policies (7개) | **정확** |
| Architecture Violations (0건) | **부분 정확** — 관대한 정책 반영 |
| CRITICAL 리스크 평가 | **정확** |

### 7.2 근본 원인 분석

#### E-1. Dead Code False Positive (CRITICAL)

**근본 원인**: `optimization-engine.ts`의 dead code 판정이 `fan_in = 0` 단일 조건에 의존

**영향받는 패턴 3가지**:

1. **인터페이스 디스패치 미추적** — `LanguageProvider` 인터페이스의 5개 메서드 × 12개 언어 = 60개 false positive
   - `implements` 엣지는 TypeScript 파서가 이미 생성하지만, dead code 판정 시 미활용
   - 클래스가 인터페이스를 `implements`하면 해당 메서드는 간접 호출 가능 → dead 아님

2. **Express `.bind(this)` 미추적** — `ApiServer`의 8개 핸들러 전부 false positive
   - `typescript-parser.ts`의 `resolveCall`이 `.bind()` 호출을 `Function.prototype.bind`로 해석
   - 원본 함수(`this.handleMcp` 등)에 대한 call 엣지 미생성

3. **`Disposable` 인터페이스 간접 호출** — `WorkerPool.dispose` 등 false positive
   - `LifecycleManager.disposeAll()`이 추적된 `Disposable` 객체들의 `.dispose()` 호출
   - 동적 인터페이스 디스패치이므로 정적 분석에서 미추적

**수정 대상 파일**:
- `src/graph/optimization-engine.ts` — `implements` 엣지가 존재하는 클래스의 메서드는 dead code에서 제외
- `src/indexer/typescript-parser.ts` — `.bind(this)` 패턴 인식, `contains` 엣지 발행

**수정 방안**:
```
optimization-engine.ts 변경:
  현재: fan_in = 0 AND (기본 제외 조건)
  변경: fan_in = 0
        AND (기본 제외 조건)
        AND NOT EXISTS (
          SELECT 1 FROM edges e
          JOIN nodes parent ON parent.id = e.from_id
          JOIN edges impl ON impl.from_id = parent.id AND impl.edge_type = 'implements'
          WHERE e.to_id = parent.id AND e.edge_type = 'defines'
          AND nodes.qualified_name LIKE parent.qualified_name || '.%'
        )

typescript-parser.ts 변경:
  resolveCall()에서 .bind() 패턴 감지:
  - node.expression이 PropertyAccessExpression이고 .name === 'bind'일 때
  - node.expression.expression (원본 함수)에서 심볼 해석
  - 원본 함수에 대한 'calls' 엣지 생성
```

**노력 수준**: M
**의존성**: 없음

---

#### E-2. CC (Cyclomatic Complexity) 과대 계산 (HIGH)

**근본 원인**: `metrics-calculator.ts`의 Native path와 JS path 결과 불일치

- **JS path**: TypeScript AST 노드 타입으로 구조적 분석 (정확)
- **Native path**: 키워드 문자열 매칭 (`'if'`, `'for'`, `'&&'` 등) → 문자열 리터럴/주석 내 키워드도 카운트 가능

**추가 문제**:
- `NullishCoalescing` (`??`), Optional Chaining (`?.`)이 decision point로 미카운트
- `SwitchCase`의 카운트 방식이 과도할 수 있음 (case문 자체 vs case 내 분기)

**수정 대상 파일**: `src/indexer/metrics-calculator.ts`

**수정 방안**:
- Native path 사용 시에도 AST 기반 decision point 리스트를 전달하도록 변경
- 또는 Native path를 제거하고 JS path만 사용 (일관성 우선)
- `??`와 `?.`를 decision point에 추가

**노력 수준**: M
**의존성**: 없음

---

#### E-3. `purge_index` EBUSY 오류 (HIGH)

**근본 원인**: MCP 서버가 DB 연결을 유지한 채 `fs.unlinkSync(dbPath)` 시도

**수정 대상 파일**: `src/server/mcp-server.ts` (purge_index case) + `src/db/database.ts`

**수정 방안**:
- purge 시 `DatabaseManager.dispose()` 호출하여 DB 연결 종료 후 파일 삭제
- `database.ts`에 `isOpen` 플래그 추가하여 이중 close 방지
- purge 후 필요 시 DB 재생성

**노력 수준**: S
**의존성**: 없음

---

#### E-4. `get_remediation_strategy` 크래시 (HIGH)

**근본 원인**: `violation.source` 또는 `violation.target`가 undefined일 때 `.tags` 접근

**수정 대상 파일**: `src/graph/remediation-engine.ts`

**수정 방안**:
- `violation.source?.tags || []` 및 `violation.target?.tags || []` 으로 optional chaining 적용
- `getRemediationStrategy` 진입부에서 source/target 유효성 검증 추가

**노력 수준**: S
**의존성**: 없음

---

#### E-5. Worktree 중복 인덱싱 (MEDIUM)

**근본 원인**: `update-pipeline.ts:325`에서 경로 비교 시 `toCanonical()` 미사용

**현재 코드**: `p.path.toLowerCase()` vs `this.projectPath.toLowerCase()`
**문제**: 경로 구분자(`\` vs `/`), trailing slash, 심볼릭 링크 등 미처리

**수정 대상 파일**: `src/indexer/update-pipeline.ts`

**수정 방안**:
- 경로 비교를 `toCanonical(p.path) === toCanonical(this.projectPath)` 로 변경
- `toCanonical()`이 이미 import되어 있으므로 1줄 수정

**노력 수준**: S
**의존성**: 없음

---

#### E-6. 미발행 엣지 타입 (MEDIUM)

**현황**: `types/index.ts`에 정의되었으나 파서가 발행하지 않는 엣지 타입:

| 엣지 타입 | 정의됨 | 발행됨 | 용도 |
|-----------|--------|--------|------|
| `contains` | O | X | class → method 포함 관계 |
| `overrides` | O | X | 메서드 오버라이드 |
| `dynamic_calls` | O | X (대신 `calls` + `dynamic:true`) | 동적 호출 |
| `implements_trait` | O | X | Rust/Go trait 구현 |

**수정 대상 파일**: `src/indexer/typescript-parser.ts`, `src/indexer/tree-sitter-parser.ts`

**수정 방안**:
- TypeScript 파서: class 내부 메서드 발견 시 `contains` 엣지 추가
- TypeScript 파서: 부모 클래스와 동일 이름의 메서드 발견 시 `overrides` 엣지 추가
- Tree-sitter 파서: 동적 호출 감지 시 `dynamic_calls` 타입 사용 (`calls` + `dynamic:true` 대신)

**노력 수준**: M
**의존성**: E-1과 병행 가능

---

### 7.3 엔진 개선 실행 순서

```
Phase 1 (Week 1 — Bug Fixes, 병렬):
  E-3: purge_index EBUSY 수정 (S)
  E-4: get_remediation_strategy null 가드 (S)
  E-5: Worktree 경로 정규화 (S)

Phase 2 (Week 2-3 — 핵심 정확도, 병렬):
  E-1: Dead code false positive 감소 (M)
    - optimization-engine.ts: implements 엣지 기반 제외
    - typescript-parser.ts: .bind(this) 패턴 + contains 엣지
  E-2: CC 계산 일관성 (M)
    - metrics-calculator.ts: native/JS path 통일

Phase 3 (Week 3-4 — 그래프 완성도):
  E-6: 미발행 엣지 타입 구현 (M)

Phase 4 (Week 4 — 재검증):
  MCP 전체 도구 재실행 → dead code false positive 비율 측정
  목표: false positive 비율 60-70% → 20% 이하
```

### 7.4 예상 효과

| 개선 항목 | 현재 | 목표 |
|-----------|------|------|
| Dead code false positive | ~60-70% | <20% |
| CC 정확도 | Native/JS 불일치 | 단일 경로, ±5% 이내 |
| purge_index 성공률 | MCP 실행 중 실패 | 항상 성공 |
| Worktree 중복 노드 | 2× 카운트 | 1× 카운트 |
| 엣지 타입 활용률 | 6/15 (40%) | 10/15 (67%) |

---

> 이 문서는 2026-03-28 시점의 진단 결과 + 2026-03-29 MCP 검증 테스트 결과를 반영합니다.
> 각 항목의 구현 완료 시 상태를 업데이트하세요.

---

## 8. E-1 후속 조사 결과 및 다음 단계 계획

> **작성일**: 2026-03-30 (3차 세션)

### 8.1 오늘 완료된 작업 (2026-03-30)

#### Wave 1+2 구현 완료 (PR #2, 커밋 `4b94808`)

| 항목 | 파일 | 상태 |
|------|------|------|
| H-1: Rate Limiting + --bind | `api-server.ts`, `bootstrap.ts` | ✅ 완료 |
| H-2: Python Sidecar 안정성 | `embedding-manager.ts` | ✅ 완료 |
| H-3: GraphEngine LRU 캐시 | `graph-engine.ts` | ✅ 완료 |
| H-4: GitHub Actions CI/CD | `.github/workflows/` | ✅ 완료 |
| M-1: Worker Pool 타임아웃/복구 | `worker-pool.ts` | ✅ 완료 |
| M-3: Cross-Platform Native 빌드 | `.github/workflows/ci.yml` | ✅ 완료 |
| M-4: Zod 입력 검증 | `api-server.ts` | ✅ 완료 |

#### E-1 근본 원인 수정 (PR #3, 커밋 `44ede7f`)

두 가지 아키텍처 버그를 수정함:

**버그 1**: `fan_in` 컬럼이 초기값 0에서 절대 업데이트되지 않음
- **수정**: `update-pipeline.ts`의 `processBatch()` · `applyDelta()` 트랜잭션 내부에 Pass 3 추가
- `UPDATE nodes SET fan_in = (SELECT COUNT(*) FROM edges WHERE to_id = nodes.id AND edge_type = 'calls')`
- **근거**: 트리거(`edges_ai_metrics`)가 있었으나 CASCADE DELETE 시 음수 drift 발생 → full recompute 필수

**버그 2**: `NOT EXISTS` 서브쿼리의 엣지 타입 오류
- **수정**: `defines`(file→symbol) → `contains`(class→method)로 교체, `inherits` 케이스 추가
- **근거**: `defines` 엣지의 from_id는 파일 노드이므로 `implements` 엣지를 가질 수 없어 서브쿼리가 항상 true였음

#### CI 파이프라인 수정 (커밋 `619fc23`)
- `build:copy` PowerShell → Node.js `fs.cpSync` (cross-platform)
- Node matrix: `[18, 20]` → `[20, 22]` (chokidar@5, commander@14 require Node >=20)

---

### 8.2 E-1 수정 후 검증 결과 (2026-03-30)

재인덱싱 후 `find_dead_code` 재실행 결과:

| 항목 | 이전 | 이후 |
|------|------|------|
| 총 dead symbols | 250 | 246 |
| Public methods | 222 | 235 |
| fan_in > 0인 dead code | 0 | 0 |

**부분 성공, 한계 존재**:
- `apiserver.handle*` private 메서드들 — `.bind(this)` 감지 + fan_in 재계산 조합으로 **일부 해결** (callers 확인됨)
- 그러나 `edgerepository.createEdge` 등 **인스턴스 필드 메서드 호출** (`this.field.method()`)은 TypeScript 파서의 타입 해석 실패로 여전히 fan_in=0

**근본적 한계**: TypeScript 파서가 `this.edgeRepo.createEdge()` 패턴에서 `edgeRepo`의 타입(`EdgeRepository`)을 해석하지 못하면 `calls` 엣지가 생성되지 않음. 완전한 해결은 TypeScript Language Server 수준의 타입 해석이 필요 — 의미론적으로 복잡한 영역.

**추가 발견**: 메인 프로젝트(141개)와 워크트리(105개)가 동시에 인덱스에 올라가 결과가 중복됨. 워크트리 인덱스는 인덱싱 품질이 낮아 false positive 비율이 더 높음.

---

### 8.3 다음 세션 작업 계획: E-1-B (신뢰도 레벨 분리)

#### 배경

`this.field.method()` 패턴의 call resolution은 TypeScript 파서 수준에서 완전히 해결하기 어렵다고 판단. 대신 **dead code 결과에 신뢰도 레벨을 부여**하여 실용적 정확도를 높인다.

#### 구현 대상: `src/graph/optimization-engine.ts`

현재 `findDeadCode()`가 단일 flat 리스트를 반환하는 구조를 **3단계 신뢰도**로 분리:

```typescript
interface DeadCodeReport {
  high: CodeNode[];    // private + fan_in=0 — 진짜 dead code 가능성 높음
  medium: CodeNode[];  // public + fan_in=0 + trait:internal — 내부 구현이나 외부 호출 불확실
  low: CodeNode[];     // public + fan_in=0 (trait:internal 없음) — 외부 API일 가능성
  summary: {
    totalSymbols: number;
    highConfidenceDead: number;
    mediumConfidenceDead: number;
    lowConfidenceDead: number;
    optimizationPotential: string;
  };
}
```

#### 분류 기준

| 레벨 | 조건 | 설명 |
|------|------|------|
| **HIGH** | `visibility = 'private'` AND `fan_in = 0` | 같은 클래스 내에서도 호출 안됨 → 진짜 dead code |
| **MEDIUM** | `visibility = 'public'` AND `fan_in = 0` AND tags LIKE `'%trait:internal%'` | 내부 구현용이지만 외부 호출 추적 불가 |
| **LOW** | `visibility = 'public'` AND `fan_in = 0` (trait:internal 없음) | 공개 API — 외부 호출 가능성 있음, 참고용 |

기존 NOT EXISTS 서브쿼리(`contains+implements`, `contains+inherits`)는 3단계 모두에 적용.

#### 반환 형식 변경

`mcp-server.ts`의 `find_dead_code` 응답도 함께 수정:
- 기존: `{ potentialDeadCode: [], summary: {} }`
- 변경: `{ high: [], medium: [], low: [], summary: {} }`
- 후방 호환성: `potentialDeadCode` 필드는 `high`와 동일하게 유지 (alias)

#### 예상 결과

| 레벨 | 예상 건수 | false positive 비율 |
|------|-----------|---------------------|
| HIGH | ~10~20개 | <5% |
| MEDIUM | ~30~50개 | ~30% |
| LOW | ~180개 | >80% (참고용) |

메인 사용 케이스에서 HIGH만 보면 실용적 dead code 목록 완성.

#### 수정 파일

1. `src/graph/optimization-engine.ts` — `findDeadCode()` 반환 타입 및 쿼리 분리
2. `src/server/mcp-server.ts` — `find_dead_code` 응답 포맷 업데이트 (후방 호환 유지)
3. `src/types/index.ts` — `DeadCodeReport` 인터페이스 추가

#### 노력 수준: M (1~2시간)

---

### 8.4 알려진 미해결 이슈

| 이슈 | 원인 | 대응 방향 |
|------|------|-----------|
| 워크트리 인덱스 중복 | `initialize_project` 호출 시 main+worktree 동시 인덱싱 | 세션 시작 시 `purge_index` 후 main만 초기화 |
| `this.field.method()` call resolution 실패 | TypeScript 파서 타입 추론 한계 | 신뢰도 레벨로 보완 (E-1-B) |
| `treesitterparser.calculatecc` private 메서드 dead code | 실제 unused일 가능성 있음 | 수동 검토 후 제거 여부 결정 |
