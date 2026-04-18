# Cynapx 서브에이전트 오케스트레이션 워크플로우

> **작성일**: 2026-03-31 (4차 세션) / **최종 갱신**: 2026-04-15 (Phase 8 완료)
> **적용 범위**: 이 프로젝트의 모든 구현 작업에 적용

---

## 1. 역할 분담

| 역할 | 모델 | 책임 |
|------|------|------|
| **Head Agent** | Opus or Sonnet | 설계, 계획, 의존성 분석, 병렬체인 구성, 오케스트레이션, Gate 실패 분석 |
| **Worker Agent** | Sonnet (서브에이전트) | 할당된 체인의 atomic task 순차 실행 + self-check |
| **Verifier Agent** | Sonnet (서브에이전트, 일회용) | Gate 검증 (체인 간 정합성, 통합 테스트) |

---

## 2. 작업 흐름

```
Head Agent (Opus)
  │
  │  1. 작업 분석 → atomic task 목록 작성
  │  2. 의존성 분석 → 순서 할당
  │  3. 파일 충돌 없는 task끼리 병렬체인(Wave) 구성
  │
  ├─── [Wave N] Worker Agent들 (Sonnet, 병렬)
  │      │
  │      │  각 Worker Agent:
  │      │    for each atomic task in chain:
  │      │      1. task 실행 (코드 수정)
  │      │      2. self-check: tsc --noEmit
  │      │      3. self-check 실패 시 자체 수정 후 재시도
  │      │    완료 후 결과 보고 (변경 파일, 라인, tsc 결과)
  │      │
  │      └─── 모든 Worker 완료 대기
  │
  ├─── [Gate N] Verifier Agent (Sonnet, 새로 생성, 일회용)
  │      │
  │      │  필수 검증 항목:
  │      │    1. tsc --noEmit → 0 errors
  │      │    2. npm test → 전체 통과
  │      │    3. 체인 간 정합성 (타입 호환, import 일관성)
  │      │    4. 기능별 스모크 테스트 (해당 시)
  │      │
  │      │  결과: PASS / FAIL (실패 항목 + 원인 명시)
  │      │  완료 후 즉시 해제
  │      │
  │      ├─ PASS → 다음 Wave 또는 Final 단계로 진행
  │      └─ FAIL → Head Agent가 원인 분석
  │                 → 해당 Worker Agent를 SendMessage로 재활성화
  │                 → 수정 지시 → 수정 완료 후
  │                 → 새 Verifier Agent로 Gate 재실행
  │
  └─── [Final] 커밋 & 푸시 (Head Agent 직접 수행)
```

---

## 3. 핵심 원칙

### 3.1 작업 환경

- 모든 서브에이전트는 **Head Agent와 동일한 워크트리**에서 작업
- `isolation: "worktree"` 사용하지 않음
- 따라서 **파일 충돌이 없는 체인만 병렬화** (같은 파일을 수정하는 task는 동일 체인에 배치)

### 3.2 검증 체계 (2단계)

| 단계 | 수행 주체 | 시점 | 범위 |
|------|-----------|------|------|
| **Self-check** | Worker Agent 자체 | 각 atomic task 완료 후 | 해당 체인의 tsc 컴파일 |
| **Gate (Cross-check)** | 독립 Verifier Agent | Wave 전체 완료 후 | 전체 프로젝트 tsc + test + 정합성 |

- Self-check: "자기 코드는 자기가 1차 검증"
- Gate: "남의 코드와의 정합성은 제3자가 검증"

### 3.3 실패 복구

1. **Self-check 실패**: Worker Agent가 자체적으로 수정 후 재시도 (최대 3회)
2. **Gate 실패**: Head Agent가 실패 원인 분석 → `SendMessage`로 해당 Worker 재활성화 → 수정 지시 → 새 Verifier로 Gate 재실행
3. **Gate 2회 연속 실패**: Head Agent가 직접 개입하여 수정

### 3.4 Agent 생명주기

| Agent 유형 | 생성 시점 | 해제 시점 |
|------------|-----------|-----------|
| Worker Agent | Wave 시작 시 | Gate 통과 후 (단, 실패 복구 대비 유지 가능) |
| Verifier Agent | Gate 시작 시 | Gate 결과 보고 즉시 |

---

## 4. 병렬체인 구성 규칙

1. **파일 단위 충돌 분석**: 같은 파일을 수정하는 task는 반드시 동일 체인에 배치
2. **의존성 순서 보장**: task B가 task A의 결과에 의존하면, A → B 순서로 동일 체인 내 직렬 배치
3. **Wave 간 의존성**: Wave N+1은 Wave N의 Gate 통과 후에만 시작
4. **최대 병렬도**: 파일 충돌이 없는 한 제한 없음

---

## 5. 개발 중 MCP 빠른 검증

워크트리에서 소스 수정 후 commit/PR/merge/세션 재시작 없이 즉시 MCP를 테스트할 수 있다.

### 5.1 구조

| MCP 서버명 | 소스 | 용도 |
|------------|------|------|
| `cynapx` | 메인 프로젝트 `src/` | 안정 버전 (merged) |
| `cynapx-dev` | 현재 워크트리 `src/` | 개발 버전 (작업 중) |

- `cynapx-dev`는 워크트리의 `.mcp.json`에만 정의되며, `cwd`가 해당 워크트리로 고정됨
- `ts-node`로 실행하므로 빌드 불필요

### 5.2 소스 변경 후 반영 절차

1. 워크트리에서 소스 수정
2. Claude Code에서 `/mcp` 명령 → `cynapx-dev` reconnect
3. `mcp__cynapx-dev__*` 도구로 즉시 검증

### 5.3 새 워크트리 생성 시 설정

새 워크트리의 `.mcp.json`에서 `cynapx-dev.cwd`를 해당 워크트리 경로로 업데이트:

```json
{
  "mcpServers": {
    "cynapx": {
      "command": "npx",
      "args": ["ts-node", "src/bootstrap.ts", "--path", "."]
    },
    "cynapx-dev": {
      "command": "npx",
      "args": ["ts-node", "src/bootstrap.ts", "--path", "."],
      "cwd": "C:/Workspace/ProjectAnalyzer/.claude/worktrees/<worktree-name>"
    }
  }
}
```

---

## 6. 통합 테스트 (실제 프로젝트 검증)

MCP 도구들의 실제 동작을 실 프로젝트 인덱싱 후 검증하는 방법.

### 6.1 통합 테스트 스크립트

`scripts/integration-test.js` — 빌드된 dist/ 바이너리를 직접 임포트하여 HTTP 프로토콜 없이 `executeTool()`을 호출.

```bash
# 1. 빌드
npm run build

# 2. 실행 (실제 인덱싱 포함, 1~2분 소요)
node scripts/integration-test.js
```

### 6.2 테스트 범위

- **Phase 0**: 10개 도구의 pre-init null guard 검증
- **Phase 1**: 인수 유효성 검사 (NaN, SQL injection, 잘못된 mode, 경계 밖 경로)
- **Phase 2**: `initialize_project` 실제 인덱싱 (syncWithGit → git ls-files → 파일 파싱)
- **Phase 3–20**: 20개 MCP 도구 전체 실 데이터 검증

### 6.3 주의사항

- `scripts/` 디렉토리는 `.gitignore`에 포함되어 있어 `git add -f` 로 강제 추가 필요
- `onInitialize` 콜백에서 `UpdatePipeline` + `GitService` + `WorkerPool` 전체를 직접 설정해야 실제 인덱싱이 수행됨
- `syncWithGit()`은 `lastCommit === null`(신규 DB)일 때 `getAllTrackedFiles()`(git ls-files)로 전체 파일을 스캔함 (PR #18에서 수정)

### 6.4 Gate 정책 (Phase 8~)

모든 Phase의 마지막은 반드시 3단계 Gate를 모두 통과해야 한다.

| 단계 | 명령 | 통과 기준 | 필수 여부 |
|------|------|-----------|-----------|
| Gate 1 | `npx tsc --noEmit` | 0 errors | **필수** |
| Gate 2 | `npx vitest run` | 전체 통과 | **필수** |
| Gate 3 | `node scripts/integration-test.js` | 0 FAIL | **필수** |

#### Gate 3 운영 규칙

- **새 기능을 추가하면 반드시 통합 테스트 Phase를 추가**한다. 단위 테스트만으로는 실제 동작을 보장할 수 없다.
- 통합 테스트는 `scripts/integration-test.js` 파일에 순번 Phase로 추가하며, 커밋 전에 실행해 전체 통과를 확인한다.
- `WARN` 상태는 통과로 간주하되, `FAIL` / `CRASH`가 1개라도 있으면 커밋하지 않는다.
- 통합 테스트는 실제 DB·git·파일시스템을 사용하므로 `npm run build` 후 실행한다.

---

## 7. 커밋 규칙

- 커밋은 **Head Agent만** 수행 (서브에이전트는 커밋하지 않음)
- Gate 통과 후 Wave 단위로 커밋
- 커밋 메시지에 변경된 항목 ID 명시 (예: `feat(E-1-B): ...`)
