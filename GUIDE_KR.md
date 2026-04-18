# 🧠 Cynapx v2.0.0 — 사용자 가이드

> AI-Native 코드 지식 엔진 완전 레퍼런스

---

[🏠 README (EN)](./README.md) | [🏠 홈 (KR)](./README_KR.md) | [📖 User Guide (EN)](./GUIDE_EN.md)

---

## 목차

1. [아키텍처 개요](#1-아키텍처-개요)
2. [설정](#2-설정)
   - [2.1 사전 요구사항](#21-사전-요구사항)
   - [2.2 설치](#22-설치)
   - [2.3 Claude Code 연결](#23-claude-code-연결)
   - [2.4 개발자 워크플로우 (소스 변경 즉시 반영)](#24-개발자-워크플로우-소스-변경-즉시-반영)
   - [2.5 CLI 옵션](#25-cli-옵션)
3. [프로젝트 라이프사이클](#3-프로젝트-라이프사이클)
4. [MCP 도구 레퍼런스](#4-mcp-도구-레퍼런스)
   - [4.1 설정 및 라이프사이클](#41-설정-및-라이프사이클)
   - [4.2 심볼 탐색](#42-심볼-탐색)
   - [4.3 아키텍처 분석](#43-아키텍처-분석)
   - [4.4 품질 및 위험도](#44-품질-및-위험도)
   - [4.5 리팩토링 및 내보내기](#45-리팩토링-및-내보내기)
5. [Admin CLI 레퍼런스](#5-admin-cli-레퍼런스)
6. [실전 워크플로우](#6-실전-워크플로우)
   - [6.1 낯선 코드베이스 파악하기](#61-낯선-코드베이스-파악하기)
   - [6.2 변경 전 영향 범위 분석](#62-변경-전-영향-범위-분석)
   - [6.3 기술 부채 스프린트](#63-기술-부채-스프린트)
7. [저장소 및 데이터 관리](#7-저장소-및-데이터-관리)
8. [지원 언어](#8-지원-언어)
9. [언어 지원 확장](#9-언어-지원-확장)

---

## 1. 아키텍처 개요

```
분석 대상 프로젝트 (12개 지원 언어 중 하나)
        │
        ▼
┌──────────────────────────────────────────────────────┐
│                   인덱싱 파이프라인                   │
│                                                      │
│  Tree-sitter 파서     →  심볼 추출                   │
│  TypeScript Compiler API  →  타입 인식 엣지 구성     │
│  Git Service          →  커밋 이력 매핑              │
│  구조적 태거          →  5-pass 태그 전파            │
│  Python Sidecar       →  벡터 임베딩 (선택)          │
└──────────────────────────┬───────────────────────────┘
                           │
                           ▼
              SQLite 지식 그래프
              ~/.cynapx/<project-hash>_v2.db 에 저장
              ┌────────────────────────────────────┐
              │  Nodes: 심볼 + 메트릭 + 태그       │
              │  Edges: calls · contains · inherits│
              │         implements · overrides     │
              │         imports                    │
              └────────────────────────────────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
       MCP 서버        REST API      그래프 엔진
       (stdio)         (:3001)    (BFS/DFS/LRU 캐시)
       20개 도구     Swagger UI     영향 분석 순회
```

### 핵심 개념

**노드 — 메트릭을 가진 심볼**

모든 함수, 메서드, 클래스, 필드, 인터페이스, 모듈이 노드입니다. 각 노드는 다음 메트릭을 가집니다:

| 메트릭 | 의미 |
|--------|------|
| `loc` | 코드 라인 수 |
| `cyclomatic` (CC) | McCabe 순환 복잡도 |
| `fan_in` | 호출자 수 (이것에 의존하는 것의 수) |
| `fan_out` | 피호출자 수 (이것이 의존하는 것의 수) |

**엣지 — 타입이 명시된 관계**

| 엣지 타입 | 의미 |
|-----------|------|
| `calls` | 직접 호출 |
| `contains` | 구조적 포함 (클래스 → 메서드) |
| `inherits` | 클래스 상속 |
| `implements` | 인터페이스 구현 |
| `overrides` | 메서드 오버라이드 |
| `imports` | 모듈 수준 임포트 |

**구조적 태그**

각 노드는 5-pass 태깅 단계에서 `layer:api`, `layer:db`, `role:repository`, `role:service`, `domain:auth`, `trait:internal` 같은 태그로 레이블됩니다. 이 태그들이 `check_architecture_violations`와 `discover_latent_policies`를 구동합니다.

**신뢰도 계층**

Dead code 분석과 영향 결과는 계층화된 신뢰도 모델을 사용합니다:

- **HIGH** — `fan_in = 0`인 private 심볼. 매우 신뢰할 수 있음. 즉시 조치.
- **MEDIUM** — `trait:internal` 태그 + `fan_in = 0`인 public 심볼. 약 30% 오탐률.
- **LOW** — `fan_in = 0`이고 `trait:internal`이 없는 public 심볼. 외부 API 표면일 가능성 높음. 수 확인만.

**Zero-Pollution**

Cynapx는 프로젝트 디렉토리에 절대 쓰지 않습니다. 모든 영속 데이터는 `~/.cynapx/`에 저장됩니다. 유일한 예외는 `initialize_project`를 `zero_pollution: false`로 호출할 때인데, 이 경우 프로젝트 루트에 `.cynapx-config` 앵커 파일이 작성됩니다.

---

## 2. 설정

### 2.1 사전 요구사항

| 요구사항 | 버전 | 비고 |
|----------|------|------|
| Node.js | >= 20 | 필수 |
| Git | 최신 버전 | `backfill_history` 및 churn 메트릭에 필요 |
| Python | 3.x | 선택 — `search_symbols`의 `semantic: true` 벡터 검색 활성화 |

> Cynapx는 **npm에 게시되지 않습니다**. `git clone`으로만 설치합니다.

### 2.2 설치

```bash
# 1. 저장소 클론
git clone https://github.com/Feel-o-sofa/Cynapx.git
cd Cynapx

# 2. 의존성 설치
npm install

# 3. TypeScript를 dist/로 컴파일
npm run build

# 빌드 확인
node dist/bootstrap.js --help
```

컴파일된 진입점은 `dist/bootstrap.js`입니다. Admin CLI 바이너리(`cynapx-admin`)는 빌드 후 `dist/cli/admin.js`에서도 사용 가능합니다.

### 2.3 Claude Code 연결

프로젝트 루트 디렉토리(또는 전역 등록을 위해 `~/.claude/`)에 `.mcp.json`을 생성하거나 편집합니다:

```json
{
  "mcpServers": {
    "cynapx": {
      "command": "node",
      "args": ["/Cynapx를/클론한/절대경로/dist/bootstrap.js", "--path", "."]
    }
  }
}
```

`/Cynapx를/클론한/절대경로`를 실제 클론 경로로 교체합니다.

**명시적 옵션을 사용하는 경우:**

```json
{
  "mcpServers": {
    "cynapx": {
      "command": "node",
      "args": [
        "/Cynapx를/클론한/절대경로/dist/bootstrap.js",
        "--path", "/분석할/프로젝트/절대경로",
        "--port", "3001",
        "--no-auth"
      ]
    }
  }
}
```

`.mcp.json` 저장 후 Claude Code를 재시작합니다. Cynapx가 MCP 도구 패널에 나타나고 20개 도구가 모두 사용 가능해집니다.

### 2.4 개발자 워크플로우 (소스 변경 즉시 반영)

Cynapx 자체를 개발하거나 워크트리에서 패치를 테스트할 때는 `ts-node`를 사용하여 빌드 단계를 건너뛰고 소스 변경을 즉시 반영할 수 있습니다:

```json
{
  "mcpServers": {
    "cynapx": {
      "command": "npx",
      "args": ["ts-node", "src/bootstrap.ts", "--path", "."],
      "cwd": "/Cynapx의/절대경로"
    },
    "cynapx-dev": {
      "command": "npx",
      "args": ["ts-node", "src/bootstrap.ts", "--path", "."],
      "cwd": "/Cynapx의/절대경로/.claude/worktrees/<브랜치명>"
    }
  }
}
```

`cynapx-dev`는 개발 중인 기능 브랜치의 워크트리를 가리킵니다. 워크트리에서 소스를 편집한 후 Claude Code 세션을 재시작하면 — `ts-node`가 즉시 트랜스파일하므로 `npm run build`가 필요 없습니다.

### 2.5 CLI 옵션

`node dist/bootstrap.js`(또는 `ts-node src/bootstrap.ts`)에 전달하는 옵션:

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--path <dir>` | `cwd` | 분석할 프로젝트 디렉토리의 절대/상대 경로 |
| `--port <n>` | `3001` | REST API 및 Swagger UI 포트 |
| `--bind <addr>` | `127.0.0.1` | 바인드 주소. LAN 접근을 위해 `0.0.0.0` 사용 |
| `--no-auth` | `false` (인증 활성화) | REST API Bearer 토큰 인증 비활성화 |

**인증:** 인증이 활성화된 경우, 매 시작 시 토큰이 자동 생성되어 `stderr`에 출력됩니다. REST 요청 시 `Authorization: Bearer <token>`으로 사용합니다. MCP 서버(stdio)는 토큰이 필요하지 않습니다.

---

## 3. 프로젝트 라이프사이클

```
┌─────────────────────────────────────────────────────────────────┐
│  프로젝트 최초 작업 시                                          │
│                                                                 │
│  1. initialize_project  →  파싱, 심볼 추출, 그래프 구성        │
│  2. backfill_history    →  Git 커밋을 심볼에 연결              │
│  3. re_tag_project      →  5-pass 구조적 태깅 실행             │
│                                                                 │
│  지속적 (자동)                                                  │
│                                                                 │
│  파일 감시기  →  저장 시마다 증분 재인덱싱                     │
│                                                                 │
│  유지보수                                                       │
│                                                                 │
│  4. check_consistency  →  드리프트 감지 및 선택적 복구         │
│  5. purge_index        →  인덱스 초기화, 새 시작               │
└─────────────────────────────────────────────────────────────────┘
```

**각 단계를 호출하는 시점:**

| 단계 | 시점 |
|------|------|
| `initialize_project` | 프로젝트 최초 작업 시, 또는 `purge_index` 이후 |
| `backfill_history` | 초기 인덱싱 후 — `get_risk_profile`과 `get_hotspots`의 churn 메트릭을 활성화 |
| `re_tag_project` | Cynapx 업그레이드 후, 또는 구조적 태그 규칙을 수동으로 편집한 후 |
| `check_consistency` | 주요 분석 세션 전. 드리프트가 감지되면 `repair: true` 사용 |
| `purge_index` | 깨끗한 상태를 원할 때 — 예: 대규모 이름 변경이나 구조 개편 후 |

**파일 감시기**는 `initialize_project` 이후 계속 실행됩니다. 프로젝트 디렉토리의 변경을 모니터링하고 자동으로 증분 재인덱싱을 트리거합니다. 매 세션 시작마다 `initialize_project`를 다시 호출할 필요가 없습니다 — Cynapx가 `~/.cynapx/`의 영속 SQLite 데이터베이스를 로드합니다.

---

## 4. MCP 도구 레퍼런스

> **세션 시작 시:** 항상 먼저 `get_setup_context`를 호출하여 프로젝트가 인덱싱되었는지 확인합니다. `status`가 `"NOT_INITIALIZED"`이면 다른 도구보다 먼저 `initialize_project`를 실행합니다.

---

### 4.1 설정 및 라이프사이클

---

#### `get_setup_context`

현재 프로젝트가 인덱싱되었는지 확인하고 레지스트리 개요를 가져옵니다.

**파라미터:** 없음

**반환값:**

| 필드 | 타입 | 설명 |
|------|------|------|
| `status` | string | `"ALREADY_INITIALIZED"` 또는 `"NOT_INITIALIZED"` |
| `current_path` | string | Cynapx가 가리키는 절대 경로 |
| `registered_projects` | array | 전역 레지스트리의 모든 프로젝트 |
| `disk_usage_mb` | number | `~/.cynapx/`의 총 사용량(MB) |
| `disk_warning` | string | `disk_usage_mb > 1024`일 때만 표시 |

**호출 예시:**

```
도구: get_setup_context
(파라미터 없음)
```

**출력 예시:**

```
Status: ALREADY_INITIALIZED
Current path: /home/user/my-project
Disk usage: 142 MB

Registered projects (3):
  • my-project       /home/user/my-project        nodes: 4821  edges: 18302
  • api-service      /home/user/api-service        nodes: 2104  edges: 7891
  • legacy-monolith  /home/user/legacy-monolith    nodes: 9340  edges: 41200
```

---

#### `initialize_project`

프로젝트를 파싱하고 SQLite 지식 그래프를 구성합니다. 이미 인덱싱된 프로젝트에 호출해도 안전합니다 — 전체 재구성이 아닌 증분 업데이트를 수행합니다.

**파라미터:**

| 이름 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `mode` | `"current"` \| `"existing"` \| `"custom"` | 필수 | `current` = Cynapx가 실행된 경로 사용; `existing` = 레지스트리의 기존 프로젝트 재인덱싱; `custom` = 임의 경로 지정 |
| `path` | string | — | `mode`가 `"custom"`일 때 필수인 절대 경로 |
| `zero_pollution` | boolean | `true` | `false`일 때 프로젝트 루트에 `.cynapx-config` 앵커 파일 작성 |

**반환값:** 총 노드 및 엣지 수가 포함된 성공 메시지.

**호출 예시:**

```
도구: initialize_project
mode: "custom"
path: "/home/user/my-project"
zero_pollution: true
```

**출력 예시:**

```
Project initialized: my-project
Path: /home/user/my-project
Nodes indexed: 4,821
Edges built:  18,302
Duration: 8.3s
```

---

#### `purge_index`

현재 프로젝트의 SQLite 지식 그래프를 영구 삭제합니다.

> **경고:** 되돌릴 수 없습니다. 재구성하려면 `initialize_project`를 다시 실행해야 합니다.

**파라미터:**

| 이름 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `confirm` | boolean | 필수 | 반드시 `true`여야 함 — 우발적 삭제를 방지하는 안전 게이트 |
| `unregister` | boolean | `false` | `registry.json`에서 프로젝트도 제거 |

**호출 예시:**

```
도구: purge_index
confirm: true
unregister: false
```

**출력 예시:**

```
Index purged for: my-project (/home/user/my-project)
Database file deleted: ~/.cynapx/a3f9e1d2_v2.db
Registry entry retained (unregister: false)
```

---

#### `re_tag_project`

인덱싱된 모든 노드에 대해 전체 5-pass 구조적 태깅 알고리즘을 재실행합니다. 현재 그래프 토폴로지로부터 모든 `layer:*`, `role:*`, `domain:*`, `trait:*` 태그를 재도출합니다.

**파라미터:** 없음

**반환값:** 재태깅된 노드 수.

**호출 예시:**

```
도구: re_tag_project
(파라미터 없음)
```

**출력 예시:**

```
Re-tagging complete.
Nodes re-tagged: 4,821
Pass breakdown:
  Pass 1 (layer inference):   2,341 nodes updated
  Pass 2 (role assignment):   1,204 nodes updated
  Pass 3 (domain grouping):     891 nodes updated
  Pass 4 (trait detection):     312 nodes updated
  Pass 5 (propagation):          73 nodes updated
Duration: 2.1s
```

---

#### `backfill_history`

인덱싱된 모든 파일의 Git 로그를 순회하고 각 커밋을 그것이 수정한 심볼에 매핑합니다. `get_risk_profile`과 `get_hotspots`에서 사용되는 `churn` 메트릭을 채웁니다.

**파라미터:** 없음

**반환값:** 추가된 이력 항목 수.

**호출 예시:**

```
도구: backfill_history
(파라미터 없음)
```

**출력 예시:**

```
Git history backfilled.
Commits scanned: 1,842
Symbol-commit mappings added: 23,409
Churn metrics now available for: 3,201 symbols
Duration: 14.7s
```

---

### 4.2 심볼 탐색

---

#### `search_symbols`

이름이나 설명으로 지식 그래프의 심볼을 검색합니다. 기본적으로 정확한 접두사 매칭을 지원하며, Python 사이드카가 실행 중일 때 벡터 유사도 검색도 가능합니다.

**파라미터:**

| 이름 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `query` | string | 필수 | 검색어 — 완전한정명과 설명에 대해 매칭 |
| `symbol_type` | string | — | 타입으로 필터: `class`, `method`, `function`, `field`, `interface`, `enum`, `module` |
| `limit` | number | `10` | 최대 결과 수 |
| `semantic` | boolean | `false` | 벡터 유사도 검색 활성화 (Python ML 사이드카 필요) |

**반환값:** `{ qname, type, file, line, tags }` 배열.

**호출 예시:**

```
도구: search_symbols
query: "authenticate"
symbol_type: "method"
limit: 5
semantic: false
```

**출력 예시:**

```
Found 3 results for "authenticate" (type: method):

1. UserService.authenticate
   Type: method | File: src/services/UserService.ts:42
   Tags: layer:service, role:auth, domain:identity

2. OAuthProvider.authenticate
   Type: method | File: src/auth/OAuthProvider.ts:88
   Tags: layer:service, domain:identity

3. BasicAuthMiddleware.authenticate
   Type: method | File: src/middleware/BasicAuth.ts:15
   Tags: layer:api, role:middleware
```

---

#### `get_symbol_details`

심볼의 전체 프로필을 조회합니다: 시그니처, 위치, 구조적 태그, 최근 Git 커밋, 복잡도 메트릭, 소스 코드 스니펫.

**파라미터:**

| 이름 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `qualified_name` | string | 필수 | 완전한정명 (예: `UserService.authenticate`) |
| `include_source` | boolean | `true` | 소스 코드 스니펫 포함 (100줄에서 잘림) |
| `summary_only` | boolean | `false` | 메트릭만 반환 — 소스와 커밋 이력 제외 |

**반환값:** 포맷된 텍스트 블록.

**호출 예시:**

```
도구: get_symbol_details
qualified_name: "UserService.authenticate"
include_source: true
summary_only: false
```

**출력 예시:**

```
Symbol: UserService.authenticate
Type:   method
File:   src/services/UserService.ts  (line 42)
Tags:   layer:service · role:auth · domain:identity · trait:internal

Metrics:
  LOC:         38
  Cyclomatic:   7
  Fan-in:       4  (callers)
  Fan-out:      6  (callees)

Recent commits (last 3):
  a1b2c3d  2026-04-10  "fix: token expiry edge case in authenticate"
  d4e5f6a  2026-03-28  "refactor: extract TokenValidator from authenticate"
  b7c8d9e  2026-03-01  "feat: add MFA support to authenticate"

Source (lines 42–80):
  async authenticate(credentials: Credentials): Promise<AuthResult> {
    const user = await this.userRepo.findByEmail(credentials.email);
    if (!user) throw new UnauthorizedError('User not found');
    ...
  }
```

---

#### `get_callers`

특정 심볼을 직접 호출하는 모든 심볼을 나열합니다 (들어오는 `calls` 엣지 1홉).

**파라미터:**

| 이름 | 타입 | 설명 |
|------|------|------|
| `qualified_name` | string | 호출자를 찾을 심볼 |

**반환값:** `{ qname, file, line }` 배열.

**호출 예시:**

```
도구: get_callers
qualified_name: "UserService.authenticate"
```

**출력 예시:**

```
Callers of UserService.authenticate (4):

1. AuthController.login          src/controllers/AuthController.ts:29
2. SessionMiddleware.validate    src/middleware/SessionMiddleware.ts:54
3. ApiGateway.handleRequest      src/gateway/ApiGateway.ts:103
4. TestHelper.authenticateUser   tests/helpers/TestHelper.ts:17
```

---

#### `get_callees`

특정 심볼이 직접 호출하는 모든 심볼을 나열합니다 (나가는 `calls` 엣지 1홉).

**파라미터:**

| 이름 | 타입 | 설명 |
|------|------|------|
| `qualified_name` | string | 피호출자를 찾을 심볼 |

**반환값:** `{ qname, file, line }` 배열.

**호출 예시:**

```
도구: get_callees
qualified_name: "UserService.authenticate"
```

**출력 예시:**

```
Callees of UserService.authenticate (6):

1. UserRepository.findByEmail     src/repositories/UserRepository.ts:18
2. PasswordHasher.verify          src/crypto/PasswordHasher.ts:35
3. TokenValidator.validate        src/auth/TokenValidator.ts:12
4. MfaService.check               src/auth/MfaService.ts:44
5. AuditLogger.logAuthAttempt     src/audit/AuditLogger.ts:67
6. EventBus.emit                  src/events/EventBus.ts:22
```

---

#### `get_related_tests`

지식 그래프의 `tests` 엣지를 사용하여 특정 프로덕션 심볼을 커버하는 테스트 심볼을 찾습니다.

**파라미터:**

| 이름 | 타입 | 설명 |
|------|------|------|
| `qualified_name` | string | 조회할 프로덕션 심볼 |

**반환값:** 테스트 심볼 완전한정명 배열.

**호출 예시:**

```
도구: get_related_tests
qualified_name: "UserService.authenticate"
```

**출력 예시:**

```
Related tests for UserService.authenticate (3):

1. UserService.spec.authenticate_success
   tests/unit/UserService.spec.ts:34

2. UserService.spec.authenticate_invalid_password
   tests/unit/UserService.spec.ts:58

3. AuthController.spec.login_calls_authenticate
   tests/integration/AuthController.spec.ts:112
```

---

### 4.3 아키텍처 분석

---

#### `check_architecture_violations`

인덱싱 중에 할당된 `layer:*`, `role:*`, `domain:*` 태그를 사용하여 프로젝트 전체의 구조적 규칙 위반을 탐지합니다.

**파라미터:** 없음

**반환값:** 위반 객체 배열.

| 필드 | 타입 | 설명 |
|------|------|------|
| `type` | string | `"layer_violation"`, `"circular_dependency"`, 또는 `"domain_violation"` |
| `source` | string | 위반하는 심볼의 완전한정명 |
| `target` | string | 위반당하는 심볼의 완전한정명 |
| `message` | string | 사람이 읽을 수 있는 설명 |

**호출 예시:**

```
도구: check_architecture_violations
(파라미터 없음)
```

**출력 예시:**

```
Architecture violations found: 3

[1] layer_violation
    Source: UserRepository.sendWelcomeEmail  (layer:db)
    Target: EmailService.send               (layer:service)
    Message: db 레이어 심볼이 service 레이어 심볼을 호출 — 하위 레이어는 상위 레이어에 의존하면 안 됨

[2] circular_dependency
    Source: OrderService.create             (layer:service)
    Path:   OrderService.create → InventoryService.reserve → OrderService.confirm → OrderService.create
    Message: 순환 의존성 사이클 감지 (길이 3)

[3] domain_violation
    Source: PaymentGateway.charge           (domain:billing)
    Target: UserService.getProfile          (domain:identity)
    Message: 반부패 레이어 없이 도메인 간 직접 호출
```

---

#### `get_remediation_strategy`

특정 아키텍처 위반을 해결하기 위한 구체적인 리팩토링 계획을 가져옵니다.

**파라미터:**

| 이름 | 타입 | 설명 |
|------|------|------|
| `violation` | object | `check_architecture_violations`가 반환한 위반 객체 |

**반환값:** `{ strategy, steps[], effort, risk }`

**호출 예시:**

```
도구: get_remediation_strategy
violation: {
  "type": "layer_violation",
  "source": "UserRepository.sendWelcomeEmail",
  "target": "EmailService.send",
  "message": "db layer symbol calls service layer symbol"
}
```

**출력 예시:**

```
Strategy: 도메인 이벤트를 통한 의존성 추출 및 역전

Steps:
  1. UserRepository.sendWelcomeEmail에서 EmailService.send 직접 호출 제거
  2. 대신 UserRepository에서 UserCreated 도메인 이벤트 발행
  3. service 레이어에 UserCreated를 구독하는 EmailNotificationHandler 생성
  4. EventBus에 EmailNotificationHandler 등록

Effort: Medium (예상 2~4시간)
Risk:   Low — 공개 API 변경 없음; 이벤트 기반 분리는 되돌릴 수 있음
```

---

#### `discover_latent_policies`

그래프를 분석하여 암묵적 아키텍처 관례를 발굴합니다 — 실제로는 존재하지만 공식적으로 선언된 적 없는 패턴.

**파라미터:**

| 이름 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `threshold` | number | `0.8` | 패턴을 보고하기 위한 최소 일관성 비율 (0.0~1.0) |
| `min_count` | number | `3` | 정책으로 간주하기 위한 최소 발생 횟수 |

**반환값:** `{ policy_id, description, confidence, examples[] }` 배열.

**호출 예시:**

```
도구: discover_latent_policies
threshold: 0.85
min_count: 5
```

**출력 예시:**

```
Latent policies discovered (2):

[POL-001] confidence: 0.94
  Description: layer:db 심볼이 외부 시스템을 호출할 때는 반드시 role:gateway로
               태깅된 심볼을 통해서만 호출 — db 레이어에서 직접 HTTP 호출 없음.
  Examples:
    • UserRepository → HttpGateway.get
    • OrderRepository → HttpGateway.post
    (+ 8개 더)

[POL-002] confidence: 0.88
  Description: domain:auth 심볼은 최대 1개의 public 메서드만 노출.
  Examples:
    • TokenValidator (public 메서드 1개: validate)
    • MfaService (public 메서드 1개: check)
    (+ 3개 더)
```

---

### 4.4 품질 및 위험도

---

#### `find_dead_code`

인덱싱된 코드베이스 내에서 아무도 호출하지 않는(`fan_in = 0`) 심볼을 신뢰도 계층으로 분류하여 식별합니다.

**파라미터:** 없음

**반환값:** 계층별 요약 수, HIGH와 MEDIUM의 전체 심볼 목록, LOW는 수만 표시.

| 계층 | 기준 | 오탐률 | 권장 조치 |
|------|------|--------|-----------|
| **HIGH** | `private` 가시성 + `fan_in = 0` | < 5% | 삭제하거나 존재 이유 문서화 |
| **MEDIUM** | `public` + `trait:internal` 태그 + `fan_in = 0` | ~30% | 컨텍스트와 함께 검토 후 삭제 |
| **LOW** | `public` + `fan_in = 0`, `trait:internal` 없음 | > 80% | 외부 API 표면일 가능성 — 수 확인만 |

> **참고:** 정적 분석은 모든 동적 호출 패턴(예: `this.registry[key]()`, 리플렉션)을 해석하지 못합니다. MEDIUM과 LOW 계층에는 항상 일부 오탐이 포함됩니다.

**호출 예시:**

```
도구: find_dead_code
(파라미터 없음)
```

**출력 예시:**

```
Dead code analysis complete.

HIGH confidence (11 symbols — 즉시 검토):
  • InternalCache._evictStale          src/cache/InternalCache.ts:204   [private]
  • UserRepository._legacyFindAll      src/repositories/UserRepository.ts:341  [private]
  • (+ 9개 더)

MEDIUM confidence (24 symbols — 컨텍스트와 함께 검토):
  • ReportBuilder.buildLegacyPdf       src/reports/ReportBuilder.ts:88  [public, trait:internal]
  • (+ 23개 더)

LOW confidence (103 symbols — 외부 API 표면 가능성, 수만 확인):
  fan_in=0이고 trait:internal 태그가 없는 public 심볼 103개.
  이것들은 아마 이 코드베이스 외부의 소비자가 호출하도록 의도된 것입니다.
```

---

#### `get_hotspots`

선택한 복잡도 또는 커플링 메트릭으로 상위 20개 심볼을 순위 매깁니다.

**파라미터:**

| 이름 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `metric` | string | 필수 | `cyclomatic`, `fan_in`, `fan_out`, `loc` 중 하나 |
| `threshold` | number | `0` | 이 임계값 이상의 심볼만 포함 |

**반환값:** 선택한 메트릭 기준 내림차순으로 정렬된 상위 20개 심볼.

**호출 예시:**

```
도구: get_hotspots
metric: "cyclomatic"
threshold: 10
```

**출력 예시:**

```
Top hotspots by cyclomatic complexity (threshold: 10):

Rank  Symbol                              CC   LOC  Fan-in  File
───────────────────────────────────────────────────────────────────────────
 1    OrderService.processCheckout        34   212     8    src/services/OrderService.ts:88
 2    ReportGenerator.buildSummary        28   178     3    src/reports/ReportGenerator.ts:44
 3    RulesEngine.evaluate                24   156    12    src/rules/RulesEngine.ts:201
 4    MigrationRunner.run                 19   134     1    src/db/MigrationRunner.ts:67
 5    PaymentGateway.charge               17    98     5    src/gateway/PaymentGateway.ts:33
(+ 임계값 10 초과 15개 더)
```

---

#### `get_risk_profile`

심볼의 복합 위험 점수를 계산합니다. 순환 복잡도, Git churn 빈도, 구조적 커플링을 결합합니다.

**파라미터:**

| 이름 | 타입 | 설명 |
|------|------|------|
| `qualified_name` | string | 프로파일링할 심볼 |

**반환값:** `{ risk_score, complexity, churn, coupling, recommendations[] }`

**호출 예시:**

```
도구: get_risk_profile
qualified_name: "OrderService.processCheckout"
```

**출력 예시:**

```
Risk Profile: OrderService.processCheckout

  Risk Score:  87 / 100  (HIGH)
  Complexity:  34 (cyclomatic)  — 코드베이스 상위 2%
  Churn:       최근 90일간 42회 커밋  — 매우 높음
  Coupling:    fan_in=8, fan_out=14  — 높은 커플링

Recommendations:
  1. processCheckout을 더 작은 단일 책임 메서드들로 분해
     (목표: 메서드당 CC < 10)
  2. fan_out 감소를 위해 CheckoutOrchestrator 도입
  3. 리팩토링 전 통합 테스트 추가 — 현재 관련 테스트: 2개
  4. 백로그: 반복적인 버그 패턴을 위한 최근 42개 커밋 검토
```

---

#### `analyze_impact`

들어오는 엣지를 BFS로 순회하여 특정 심볼에 직접 또는 전이적으로 의존하는 모든 심볼을 열거합니다 — 변경 시의 "파급 효과".

**파라미터:**

| 이름 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `qualified_name` | string | 필수 | 변경을 계획 중인 심볼 |
| `max_depth` | number | `3` | BFS 깊이 제한 (높을수록 더 넓지만 느림) |
| `use_cache` | boolean | `true` | 반복 쿼리에 캐시된 순회 결과 사용 |

**반환값:** 거리 오름차순으로 정렬된 `{ node, distance, impact_path }` 배열.

**호출 예시:**

```
도구: analyze_impact
qualified_name: "UserRepository.findByEmail"
max_depth: 3
use_cache: true
```

**출력 예시:**

```
Impact analysis for: UserRepository.findByEmail
BFS depth: 3 | Affected symbols: 9

Distance 1 (직접 호출자):
  • UserService.authenticate         src/services/UserService.ts:42
  • PasswordResetService.initiate    src/services/PasswordResetService.ts:28

Distance 2:
  • AuthController.login             src/controllers/AuthController.ts:29
  • SessionMiddleware.validate       src/middleware/SessionMiddleware.ts:54
  • PasswordResetController.request  src/controllers/PasswordResetController.ts:17

Distance 3:
  • ApiGateway.handleRequest         src/gateway/ApiGateway.ts:103
  • Router.dispatch                  src/Router.ts:55
  • IntegrationTest.loginFlow        tests/integration/AuthFlow.spec.ts:8
  • IntegrationTest.resetFlow        tests/integration/PasswordReset.spec.ts:22
```

---

### 4.5 리팩토링 및 내보내기

---

#### `propose_refactor`

심볼의 복잡도, 커플링, 의존 그래프를 고려하여 위험도 인식 단계별 리팩토링 제안을 생성합니다.

**파라미터:**

| 이름 | 타입 | 설명 |
|------|------|------|
| `qualified_name` | string | 리팩토링할 심볼 |

**반환값:** 제안된 분리 지점, 예상 위험도, 순서화된 단계가 포함된 제안.

**호출 예시:**

```
도구: propose_refactor
qualified_name: "OrderService.processCheckout"
```

**출력 예시:**

```
Refactoring Proposal: OrderService.processCheckout (CC=34, risk=87)

Suggested split points:
  1. Extract validateCart(cart: Cart): ValidationResult
     — Lines 90–118: 독립적인 7개 검증 분기
  2. Extract applyDiscounts(cart: Cart, user: User): Cart
     — Lines 119–154: 부작용 없는 할인 로직
  3. Extract reserveInventory(items: LineItem[]): Promise<ReservationResult>
     — Lines 155–189: InventoryService 호출 (비동기/큐 처리 가능)
  4. Extract chargePayment(total: Money, method: PaymentMethod): Promise<Receipt>
     — Lines 190–234: PaymentGateway에 전적으로 위임

Estimated risk: Medium
  — 8개의 호출자가 영향받음; 새 서브메서드로 위임하는
    파사드 메서드로 무변경 리팩토링 보장

Ordered steps:
  1. processCheckout 현재 동작을 커버하는 특성화 테스트 작성 (2개 누락)
  2. validateCart 추출 → 테스트 통과 확인
  3. applyDiscounts 추출 → 테스트 통과 확인
  4. reserveInventory 추출 → 테스트 통과 확인
  5. chargePayment 추출 → 테스트 통과 확인
  6. processCheckout → orchestrateCheckout 이름 변경 및 8개 호출자 업데이트
```

---

#### `export_graph`

서브그래프(또는 전체 프로젝트 그래프)를 Mermaid 다이어그램과 구조화된 JSON으로 내보냅니다.

**파라미터:**

| 이름 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `root_qname` | string | — | 루트 심볼. 전체 프로젝트 그래프를 내보내려면 생략 |
| `max_depth` | number | `2` | 루트에서 포함할 홉 수 |

**반환값:** Mermaid `graph LR` 다이어그램 + `{ nodes[], edges[] }` JSON.

**호출 예시:**

```
도구: export_graph
root_qname: "UserService.authenticate"
max_depth: 2
```

**출력 예시:**

```
Mermaid diagram:

graph LR
  A["UserService.authenticate\n(method)"]
  B["UserRepository.findByEmail\n(method)"]
  C["PasswordHasher.verify\n(method)"]
  D["AuthController.login\n(method)"]
  A --> B
  A --> C
  D --> A

JSON summary:
{
  "nodes": [
    { "qname": "UserService.authenticate", "type": "method", "tags": ["layer:service"] },
    ...
  ],
  "edges": [
    { "from": "UserService.authenticate", "to": "UserRepository.findByEmail", "type": "calls" },
    ...
  ]
}
```

---

#### `check_consistency`

지식 그래프가 디스크의 현재 파일 상태와 Git을 반영하는지 검증합니다. 삭제된 파일의 오래된 노드, 새로 추가된 파일의 누락 심볼, 체크섬 불일치를 감지합니다.

**파라미터:**

| 이름 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `repair` | boolean | `false` | 감지된 불일치를 자동으로 복구 |
| `force` | boolean | `false` | 파일 체크섬이 일치해도 전체 재스캔 강제 |

**반환값:** 각 검사의 통과/실패와 복구된 항목이 나열된 일관성 보고서.

**호출 예시:**

```
도구: check_consistency
repair: true
force: false
```

**출력 예시:**

```
Consistency check complete.

Checks:
  [PASS] Registry entry matches current path
  [PASS] SQLite schema version: v2
  [WARN] 3개의 오래된 노드 발견 (디스크에서 삭제된 파일)   → 복구됨
  [WARN] 마지막 인덱싱 이후 수정된 파일 1개              → 복구됨 (증분 재인덱싱)
  [PASS] Edge referential integrity
  [PASS] Git HEAD matches backfilled history tip

Repaired:
  - 삭제된 파일의 오래된 노드 3개 제거
  - 재인덱싱: src/services/NewFeature.ts (2026-04-17 수정됨)

Graph is now consistent.
```

---

## 5. Admin CLI 레퍼런스

`cynapx-admin` 바이너리(`node /Cynapx/경로/dist/cli/admin.js`로도 사용 가능)는 머신의 모든 등록된 프로젝트를 관리하는 커맨드라인 대시보드를 제공합니다.

### `status`

등록된 모든 프로젝트의 전체 대시보드 개요 (노드/엣지 수, DB 크기 포함).

```bash
cynapx-admin status
```

```
Cynapx Registry — 3 projects

  Project           Path                          Nodes   Edges   DB Size   Last Indexed
  ──────────────────────────────────────────────────────────────────────────────────────
  my-project        /home/user/my-project          4821   18302   48 MB     2026-04-17
  api-service       /home/user/api-service         2104    7891   21 MB     2026-04-16
  legacy-monolith   /home/user/legacy-monolith     9340   41200   98 MB     2026-04-10

Total disk usage: 167 MB  (~/.cynapx/)
```

### `list`

프로젝트당 한 줄의 컴팩트 표 (스크립팅에 유용).

```bash
cynapx-admin list
```

```
my-project       /home/user/my-project
api-service      /home/user/api-service
legacy-monolith  /home/user/legacy-monolith
```

### `inspect <name>`

단일 프로젝트의 상세 통계. 프로젝트 이름 또는 경로를 인수로 사용합니다.

```bash
cynapx-admin inspect my-project
```

```
Project: my-project
Path:    /home/user/my-project
DB:      ~/.cynapx/a3f9e1d2_v2.db  (48 MB)
Schema:  v2

Nodes:  4,821
  class:      142
  method:    2,104
  function:    891
  field:     1,684

Edges:  18,302
  calls:      9,841
  contains:   6,204
  imports:    1,891
  inherits:     248

Last indexed:  2026-04-17T14:32:11Z
Git HEAD:      a1b2c3d (2026-04-17 "feat: add MFA support")
History:       23,409 symbol-commit mappings
```

### `doctor`

오래된 또는 손상된 레지스트리 항목을 탐지합니다 (디스크에 더 이상 존재하지 않는 경로나 누락된 DB 파일).

```bash
cynapx-admin doctor
```

```
Registry doctor — scanning 3 entries...

  [OK]   my-project       /home/user/my-project
  [OK]   api-service      /home/user/api-service
  [WARN] legacy-monolith  /home/user/legacy-monolith  — 디스크에서 프로젝트 경로를 찾을 수 없음

1 issue detected. 정리하려면 `cynapx-admin unregister legacy-monolith` 실행.
```

### `purge <name>`

프로젝트의 SQLite DB 파일을 삭제합니다. `--yes`를 사용하면 확인 프롬프트를 건너뜁니다.

```bash
cynapx-admin purge my-project --yes
```

```
Purging index for: my-project
  DB file: ~/.cynapx/a3f9e1d2_v2.db (48 MB)
Deleted. Registry entry retained.
```

### `unregister <name>`

`registry.json`에서 프로젝트를 제거합니다. DB 파일은 디스크에 유지됩니다 (삭제하려면 `purge` 사용).

```bash
cynapx-admin unregister legacy-monolith --yes
```

```
Unregistered: legacy-monolith
Registry entry removed. DB files retained at ~/.cynapx/9f8c3b21_v2.db
```

### `compact`

모든 프로젝트 DB에 SQLite `VACUUM`을 실행하여 삭제된 행의 공간을 회수합니다.

```bash
cynapx-admin compact --yes
```

```
Compacting 3 databases...
  my-project:       48 MB → 41 MB  (7 MB 절약)
  api-service:      21 MB → 21 MB  (변화 없음)
  legacy-monolith:  98 MB → 79 MB  (19 MB 절약)

Total reclaimed: 26 MB
```

### `backup <name>`

프로젝트 DB의 타임스탬프 백업을 `~/.cynapx/backups/`에 생성합니다.

```bash
cynapx-admin backup my-project
```

```
Backup created:
  Source:  ~/.cynapx/a3f9e1d2_v2.db
  Target:  ~/.cynapx/backups/my-project-2026-04-18T06-43-39/
           ├── meta.json
           └── a3f9e1d2_v2.db

Backup size: 48 MB
```

### `restore <backup-path>`

백업 디렉토리에서 프로젝트 DB를 복원합니다. 현재 DB를 덮어씁니다.

```bash
cynapx-admin restore ~/.cynapx/backups/my-project-2026-04-18T06-43-39 --yes
```

```
Restoring from: ~/.cynapx/backups/my-project-2026-04-18T06-43-39/
  meta.json: project=my-project, backed-up=2026-04-18T06:43:39Z
  Overwriting: ~/.cynapx/a3f9e1d2_v2.db

Restore complete. 백업 이후 변경된 파일과 동기화하려면 initialize_project를 다시 실행하세요.
```

---

## 6. 실전 워크플로우

### 6.1 낯선 코드베이스 파악하기

새 프로젝트에 합류했거나 낯선 서비스를 빠르게 파악해야 합니다. 파일을 처음부터 끝까지 읽지 않고 Cynapx로 멘탈 맵을 구성합니다.

**1단계 — 프로젝트가 인덱싱되었는지 확인**

```
도구: get_setup_context
```

`status`가 `NOT_INITIALIZED`이면 `initialize_project` → `backfill_history` → `re_tag_project`를 먼저 실행합니다.

**2단계 — 관심 있는 진입점이나 개념 검색**

```
도구: search_symbols
query: "checkout"
symbol_type: "method"
limit: 10
```

결과를 검토하고 가장 관련성 높은 심볼을 선택합니다 (예: `OrderService.processCheckout`).

**3단계 — 심볼의 전체 프로필 조회**

```
도구: get_symbol_details
qualified_name: "OrderService.processCheckout"
include_source: true
summary_only: false
```

메트릭, 최근 커밋, 소스 스니펫을 읽어 무엇을 하는지, 어떻게 발전해왔는지 파악합니다.

**4단계 — 양방향으로 호출 그래프 탐색**

```
도구: get_callers
qualified_name: "OrderService.processCheckout"
```

```
도구: get_callees
qualified_name: "OrderService.processCheckout"
```

이를 통해 주변 아키텍처의 2홉 그림을 얻습니다: 체크아웃을 트리거하는 것(호출자)과 체크아웃이 의존하는 것(피호출자).

**5단계 — 서브그래프 시각화**

```
도구: export_graph
root_qname: "OrderService.processCheckout"
max_depth: 2
```

Mermaid 출력을 렌더러(예: GitHub, mermaid.live)에 붙여넣어 시각적 다이어그램을 얻습니다.

**결과:** 10분 이내에 심볼의 메트릭, 최근 변경 이력, 완전한 2홉 이웃, 시각적 다이어그램을 — 파일 하나도 처음부터 끝까지 읽지 않고 — 확보합니다.

---

### 6.2 변경 전 영향 범위 분석

`UserRepository.findByEmail`을 수정하기 전에, 무엇이 깨지는지와 변경이 안전한지 알아야 합니다.

**1단계 — 파급 효과 매핑**

```
도구: analyze_impact
qualified_name: "UserRepository.findByEmail"
max_depth: 3
use_cache: false
```

출력은 `findByEmail`에 전이적으로 의존하는 모든 심볼을 거리 순으로 나열합니다. 업데이트하거나 검증해야 할 호출 사이트가 얼마나 많은지 알 수 있습니다.

**2단계 — 심볼 자체의 위험도 평가**

```
도구: get_risk_profile
qualified_name: "UserRepository.findByEmail"
```

`risk_score`, `churn`, `coupling`을 확인합니다. 높은 churn은 이 심볼이 자주 변경되어 버그가 숨어 있을 수 있음을 의미하고, 높은 `fan_in`은 많은 것이 의존함을 의미합니다.

**3단계 — 커버하는 테스트 찾기**

```
도구: get_related_tests
qualified_name: "UserRepository.findByEmail"
```

목록을 검토합니다. 커버리지가 얇으면(호출자보다 테스트가 적으면) 변경 전에 특성화 테스트를 작성합니다.

**4단계 — 심볼이 복잡하면 리팩토링 제안을 먼저 확인**

```
도구: propose_refactor
qualified_name: "UserRepository.findByEmail"
```

오늘 리팩토링하지 않더라도, 제안은 자연스러운 분리 지점을 알려줍니다 — 변경을 최소하고 안전하게 유지하는 데 유용한 컨텍스트입니다.

**결과:** 변경이 영향을 미치는 심볼 수, 심볼의 위험도, 회귀를 잡을 테스트 존재 여부, 깔끔한 변경 경계를 알게 됩니다.

---

### 6.3 기술 부채 스프린트

기술 부채를 줄이기 위한 스프린트가 있습니다. Cynapx로 무엇을 수정할지 파악하고 우선순위를 정한 후 구체적인 계획을 받습니다.

**1단계 — 가장 복잡한 심볼 찾기**

```
도구: get_hotspots
metric: "cyclomatic"
threshold: 10
```

상위 20개 결과가 주요 리팩토링 후보입니다. `metric: "fan_out"`으로도 실행하여 과도한 의존성을 가진 심볼을 찾습니다.

**2단계 — 삭제할 미사용 코드 찾기**

```
도구: find_dead_code
```

HIGH 계층 결과에 먼저 집중합니다 — `fan_in = 0`인 private 심볼로 5% 미만의 오탐률. 즉시 삭제하면 유지보수 부담이 줄어듭니다.

**3단계 — 아키텍처 위반 확인**

```
도구: check_architecture_violations
```

각 위반은 구조적 부채 항목입니다. `type`과 영향받는 심볼을 기록합니다.

**4단계 — 위반별 수정 계획 수립**

3단계에서 반환된 각 위반에 대해:

```
도구: get_remediation_strategy
violation: { <3단계의 위반 객체 붙여넣기> }
```

응답에는 `effort`와 `risk` 추정치가 포함되어 있습니다 — 이것을 이용하여 이번 스프린트에서 처리할 위반과 백로그로 넘길 위반을 우선순위화합니다.

**5단계 — 형식화해야 할 숨겨진 관례 발견**

```
도구: discover_latent_policies
threshold: 0.85
min_count: 5
```

높은 신뢰도(> 0.9)의 정책은 Architecture Decision Records(ADR)나 린터 규칙으로 만들기 좋은 후보입니다 — 동일한 위반이 반복되는 것을 방지합니다.

**결과:** 각 항목에 구체적인 단계와 노력 추정치가 있는 우선순위화된 증거 기반 부채 백로그.

---

## 7. 저장소 및 데이터 관리

### 전체 `~/.cynapx/` 구조

```
~/.cynapx/
├── registry.json                         # 등록된 모든 프로젝트 경로 + 메타데이터
├── audit.log                             # 모든 도구 호출의 NDJSON 감사 추적
├── locks/                                # 프로젝트별 프로세스 잠금 파일
│   └── a3f9e1d2.lock
├── profiles/                             # 프로젝트별 설정 프로필
│   └── a3f9e1d2.profile.json
├── backups/                              # 타임스탬프 백업 디렉토리
│   └── my-project-2026-04-18T06-43-39/
│       ├── meta.json                     # 백업 메타데이터 (프로젝트명, 타임스탬프, 소스 해시)
│       └── a3f9e1d2_v2.db               # 백업 시점의 SQLite DB 복사본
└── a3f9e1d2_v2.db                        # "my-project"의 SQLite 지식 그래프
    (등록된 프로젝트당 하나의 _v2.db — 파일명은 프로젝트 절대 경로의 해시)
```

**`registry.json` 형식 (발췌):**

```json
{
  "projects": [
    {
      "name": "my-project",
      "path": "/home/user/my-project",
      "hash": "a3f9e1d2",
      "registeredAt": "2026-03-15T10:22:00Z",
      "lastIndexed": "2026-04-17T14:32:11Z"
    }
  ]
}
```

**`audit.log` 형식 (NDJSON, 한 줄에 하나의 항목):**

```json
{"ts":"2026-04-18T06:00:01Z","tool":"analyze_impact","args":{"qualified_name":"UserService.authenticate"},"durationMs":142}
```

### 백업 및 복원 워크플로우

**위험한 작업(대규모 리팩토링, Cynapx 업그레이드, purge) 전에 백업 생성:**

```bash
cynapx-admin backup my-project
```

**사용 가능한 백업 목록 확인:**

```bash
ls ~/.cynapx/backups/
# my-project-2026-04-18T06-43-39/
# my-project-2026-04-10T09-12-55/
```

**백업에서 복원:**

```bash
cynapx-admin restore ~/.cynapx/backups/my-project-2026-04-18T06-43-39 --yes
```

복원 후, 백업 이후에 발생한 파일 변경과 동기화하려면 `check_consistency repair: true`를 실행합니다.

### 제거 방법

**단일 프로젝트 데이터 제거:**

```bash
# MCP 도구를 통해 (Cynapx 실행 중일 때):
도구: purge_index
confirm: true
unregister: true

# 또는 Admin CLI를 통해:
cynapx-admin purge my-project --yes
cynapx-admin unregister my-project --yes
```

**모든 Cynapx 데이터 제거 (완전 제거):**

```bash
rm -rf ~/.cynapx/
```

그런 다음 `.mcp.json`에서 `cynapx` 항목을 제거하고 선택적으로 클론된 저장소를 삭제합니다:

```bash
rm -rf /Cynapx/경로
```

---

## 8. 지원 언어

| 언어 | 확장자 | 비고 |
|------|--------|------|
| TypeScript | `.ts`, `.tsx` | TypeScript Compiler API를 통한 완전한 타입 인식 엣지 추출. 가장 정확한 calls/inherits/implements 엣지. |
| JavaScript | `.js`, `.jsx` | Tree-sitter 기반 AST. 타입 추론 없음; 일부 동적 호출은 해석 불가. |
| Python | `.py` | 상속, 임포트, 데코레이터 엣지 포함. |
| Go | `.go` | 구조체 메서드, 인터페이스, 고루틴 호출. |
| Java | `.java` | 클래스, 인터페이스, 생성자, 어노테이션. |
| C | `.c`, `.h` | 함수, 구조체, 열거형, 매크로 정의. |
| C++ | `.cpp`, `.hpp` | 클래스, 네임스페이스, 템플릿, 연산자 오버로드. |
| C# | `.cs` | 클래스, 인터페이스, 프로퍼티, 확장 메서드. |
| Kotlin | `.kt` | 클래스, 인터페이스, 데이터 클래스, 확장 함수. |
| PHP | `.php` | 함수, 클래스, 트레이트, 메서드. |
| Rust | `.rs` | 함수, 구조체, 트레이트, 구현, 라이프타임(어노테이션). |
| GDScript | `.gd` | 클래스, 함수 (Godot Engine 4.x). |

TypeScript가 가장 완전한 기능을 제공합니다 — Tree-sitter만이 아닌 전체 컴파일러 API를 사용하므로, 인터페이스를 통한 메서드 호출을 구체적인 구현으로 해석하는 타입 해석 엣지가 TypeScript 프로젝트에서만 사용 가능합니다.

---

## 9. 언어 지원 확장

Cynapx는 `LanguageProvider` 확장 포인트를 통해 새 언어 추가를 지원합니다.

### 인터페이스

Cynapx 소스(`src/language/LanguageProvider.ts`)에 정의된 `LanguageProvider` 인터페이스를 구현합니다:

```typescript
interface LanguageProvider {
  // 이 제공자가 처리하는 파일 확장자 (예: ['.rb', '.rbw'])
  extensions: string[];

  // 파일을 파싱하고 심볼 + 엣지를 반환
  parse(filePath: string, source: string): Promise<ParseResult>;

  // 선택사항: 모든 파일 파싱 후 파일 간 타입 엣지 해석
  resolveTypes?(graph: MutableGraph): Promise<void>;
}

interface ParseResult {
  symbols: Symbol[];
  edges: Edge[];
}
```

### 설치

1. TypeScript(또는 `.js`로 컴파일)로 인터페이스 구현
2. 컴파일된 `.js` 파일을 `~/.cynapx/plugins/`에 배치
3. Cynapx 재시작 — 플러그인 레지스트리가 해당 디렉토리의 모든 제공자를 자동으로 발견하고 로드

### 참고사항

- 커스텀 제공자는 Cynapx와 같은 프로세스에서 실행 — 전체 Node.js API에 접근 가능
- 제공자는 알파벳 순으로 로드됨. 내장 제공자는 이미 처리하는 확장자에 우선권을 가짐
- 제공자가 `parse()` 중에 예외를 던지면 해당 파일은 건너뛰고 오류가 `audit.log`에 기록됨

---

**Cynapx** — [Feel-o-sofa](https://github.com/Feel-o-sofa)가 개발·유지보수
