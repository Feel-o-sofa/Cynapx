# 🧠 Cynapx 사용자 가이드 v1.0.6
### 코드 지식 엔진 완전 레퍼런스

---

[🏠 README (EN)](./README.md) | [🏠 홈 (KR)](./README_KR.md) | [📖 User Guide (EN)](./GUIDE_EN.md)

---

## 목차

1. [아키텍처 개요](#1-아키텍처-개요)
2. [설정](#2-설정)
3. [프로젝트 라이프사이클](#3-프로젝트-라이프사이클)
4. [MCP 도구 레퍼런스](#4-mcp-도구-레퍼런스)
   - [4.1 설정 및 라이프사이클](#41-설정-및-라이프사이클)
   - [4.2 심볼 탐색](#42-심볼-탐색)
   - [4.3 아키텍처 분석](#43-아키텍처-분석)
   - [4.4 품질 및 위험도](#44-품질-및-위험도)
   - [4.5 리팩토링 및 내보내기](#45-리팩토링-및-내보내기)
5. [REST API](#5-rest-api)
6. [지원 언어](#6-지원-언어)
7. [Zero-Pollution 원칙](#7-zero-pollution-원칙)
8. [언어 지원 확장](#8-언어-지원-확장)

---

## 1. 아키텍처 개요

```
분석 대상 프로젝트 (모든 언어)
        │
        ▼
┌──────────────────────────────────────────────┐
│              인덱싱 파이프라인                │
│  Tree-sitter 파서 → 심볼 추출                 │
│  TypeScript Compiler API → 타입 엣지          │
│  Git Service → 커밋 이력 매핑                 │
│  구조적 태거 → 태그 전파 (5-pass fixpoint)    │
│  Python Sidecar → 벡터 임베딩 (선택)          │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
        SQLite 지식 그래프 (~/.cynapx/)
          nodes: 심볼, 메트릭, 태그
          edges: calls, contains, inherits,
                 implements, overrides, imports
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
     MCP 서버       REST API    그래프 엔진
     (stdio)        (:3001)   (BFS/DFS/LRU)
```

**핵심 개념:**

- **지식 그래프**: 모든 심볼(함수, 클래스, 메서드, 필드)이 노드로 저장되며 LOC, 순환 복잡도(CC), fan-in, fan-out 메트릭을 가집니다. 심볼 간 관계는 타입이 명시된 엣지로 표현됩니다.
- **Zero-Pollution**: 모든 데이터는 `~/.cynapx/`에 저장 — Cynapx는 분석 대상 프로젝트 디렉토리에 절대 파일을 쓰지 않습니다.
- **구조적 태그**: 각 노드는 `layer:api`, `role:repository`, `trait:internal` 같은 태그를 가지며, 이를 기반으로 아키텍처 규칙 검사가 이루어집니다.
- **신뢰도 구분 분석**: Dead code 결과를 HIGH / MEDIUM / LOW 3단계로 분류하여 오탐(false positive) 가능성을 명시적으로 전달합니다.

---

## 2. 설정

### 2.1 사전 요구사항

- Node.js >= 20
- Git (이력 백필용)
- Python 3.x (선택 — 벡터 임베딩 지원 시)

### 2.2 설치

저장소를 클론하고 의존성을 설치합니다:

```bash
git clone https://github.com/Feel-o-sofa/Cynapx.git
cd Cynapx
npm install
npm run build        # TypeScript → dist/ 컴파일
```

### 2.3 Claude Code 연결

프로젝트 디렉토리(또는 저장소 루트)에 `.mcp.json`을 배치합니다:

```json
{
  "mcpServers": {
    "cynapx": {
      "command": "npx",
      "args": ["ts-node", "src/bootstrap.ts", "--path", "."],
      "cwd": "/Cynapx의 절대경로"
    }
  }
}
```

**개발 워크플로우** — 소스 변경 후 commit/PR/merge 없이 즉시 테스트:

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
      "cwd": "/Cynapx의 절대경로/.claude/worktrees/<브랜치명>"
    }
  }
}
```

워크트리에서 소스를 수정한 후 Claude Code 세션을 재시작하면 `cynapx-dev`가 최신 소스를 즉시 반영합니다 (`ts-node`가 실시간 트랜스파일하므로 별도 빌드 불필요).

### 2.4 CLI 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--path <디렉토리>` | `cwd` | 분석할 프로젝트 경로 |
| `--port <번호>` | `3001` | REST API 포트 |
| `--bind <주소>` | `127.0.0.1` | 바인드 주소 (LAN 접근 시 `0.0.0.0`) |
| `--no-auth` | `false` | Bearer 토큰 인증 비활성화 |

인증 토큰은 실행 시마다 자동 생성되어 stderr에 출력됩니다. REST 요청 시 `Authorization: Bearer <token>` 헤더로 전달하세요.

---

## 3. 프로젝트 라이프사이클

신규 프로젝트의 일반적인 워크플로우:

```
1. initialize_project   →  심볼 인덱싱, 지식 그래프 구축
2. backfill_history     →  Git 커밋을 심볼에 매핑 (churn 메트릭 활성화)
3. re_tag_project       →  구조적 태깅 실행 (레이어, 역할, 특성)
        ┆
   [이후 — 파일 감시자가 저장 시마다 자동 증분 재인덱싱]
        ┆
4. purge_index          →  인덱스 삭제 (초기화 또는 프로젝트 전환 시)
```

파일 감시자가 변경 시마다 증분 재인덱싱을 트리거합니다. `initialize_project`는 프로젝트당 최초 1회(또는 `purge_index` 후)만 필요합니다.

---

## 4. MCP 도구 레퍼런스

### 4.1 설정 및 라이프사이클

---

#### `get_setup_context`
프로젝트 초기화 상태와 등록된 프로젝트 목록을 확인합니다.

**반환값:** `{ status, current_path, registered_projects[] }`

**사용 시점:** 새 세션 시작 시 엔진 준비 상태 확인.

---

#### `initialize_project`

프로젝트를 인덱싱하고 분석 엔진을 활성화합니다.

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `mode` | `"current"` \| `"existing"` \| `"custom"` | 필수 | `current`=현재 디렉토리, `existing`=기등록 경로 재사용, `custom`=`path` 직접 지정 |
| `path` | string | — | `mode: "custom"` 시 필수 |
| `zero_pollution` | boolean | `true` | `false`이면 프로젝트 디렉토리에 앵커 파일 생성 |

---

#### `purge_index`

현재 프로젝트의 로컬 SQLite 인덱스를 영구 삭제합니다.

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `confirm` | boolean | `true`여야 실행 — 안전 잠금 |
| `unregister` | boolean | 전역 레지스트리에서도 프로젝트 제거 |

> ⚠️ 되돌릴 수 없습니다. 재구축하려면 `initialize_project`를 다시 실행하세요.

---

#### `re_tag_project`

모든 인덱싱된 노드에 대해 5-pass 구조적 태깅 알고리즘을 재실행합니다. 태그를 수동으로 편집하거나 Cynapx를 업그레이드한 후 사용합니다.

---

#### `backfill_history`

Git 커밋 이력을 가져와 각 커밋이 수정한 심볼에 매핑합니다. `get_risk_profile`과 `get_hotspots`의 churn 기반 메트릭을 활성화합니다.

---

### 4.2 심볼 탐색

---

#### `search_symbols`

이름 또는 설명으로 심볼을 검색합니다.

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `query` | string | 필수 | 검색어 |
| `symbol_type` | string | — | 타입 필터: `class`, `method`, `function`, `field` 등 |
| `limit` | number | `10` | 최대 결과 수 |
| `semantic` | boolean | `false` | 벡터 유사도 검색 활성화 (Python sidecar 필요) |

**반환값:** `[{ qname, type, file, tags }]` 배열

---

#### `get_symbol_details`

심볼의 전체 정보(메트릭, 태그, 이력, 소스 스니펫)를 조회합니다.

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `qualified_name` | string | 필수 | 완전 한정 심볼 이름 |
| `include_source` | boolean | `true` | 소스 코드 스니펫 포함 (100줄 초과 시 자동 절삭) |
| `summary_only` | boolean | `false` | 메트릭만 반환, 소스 제외 |

**반환값:** 서명, 파일 위치, 구조적 태그, 최근 3개 Git 커밋, LOC/CC/fan-in/fan-out 메트릭, 소스 스니펫이 포함된 포맷된 텍스트.

---

#### `get_callers`

특정 심볼을 직접 호출하는 심볼 목록을 반환합니다.

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `qualified_name` | string | 대상 심볼 |

**반환값:** `[{ qname, line }]` — 호출자 이름과 호출 위치 라인 번호.

---

#### `get_callees`

특정 심볼이 호출하는 심볼 목록을 반환합니다.

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `qualified_name` | string | 소스 심볼 |

**반환값:** `[{ qname, line }]`

---

#### `get_related_tests`

`tests` 엣지로 연결된 테스트 심볼을 조회합니다.

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `qualified_name` | string | 조회할 프로덕션 심볼 |

**반환값:** 테스트 심볼 완전 한정 이름 배열.

---

### 4.3 아키텍처 분석

---

#### `check_architecture_violations`

인덱싱 중 할당된 구조적 태그를 이용해 레이어 순서 위반(예: `db`가 `api`를 호출)과 순환 의존성을 탐지합니다.

**반환값:** `[{ type, source, target, message }]` 위반 목록

**주요 위반 유형:**
- `layer_violation` — 하위 레이어가 상위 레이어에 의존
- `circular_dependency` — A → B → … → A 사이클

---

#### `get_remediation_strategy`

특정 위반에 대한 구체적인 3단계 리팩토링 계획을 제공합니다.

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `violation` | object | `check_architecture_violations`가 반환한 위반 객체 |

**반환값:** `{ strategy, steps[], effort, risk }`

---

#### `discover_latent_policies`

그래프를 분석하여 코드베이스에 암묵적으로 존재하는 아키텍처 패턴을 발굴합니다. 예: "모든 `layer:db` 노드는 `layer:api`에 직접 `calls` 엣지를 갖지 않는다."

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `threshold` | number | `0.8` | 패턴으로 보고할 최소 일관성 비율 (0~1) |
| `min_count` | number | `3` | 패턴으로 인정하기 위한 최소 발생 횟수 |

**반환값:** `[{ policy_id, description, confidence, examples[] }]`

---

### 4.4 품질 및 위험도

---

#### `find_dead_code`

`fan_in = 0`인 심볼(아무도 호출하지 않는 심볼)을 3단계 신뢰도로 분류합니다:

| 단계 | 조건 | 오탐 비율 | 권장 행동 |
|------|------|-----------|-----------|
| **HIGH** | `private` 가시성 + `fan_in = 0` | < 5% | 즉시 검토 |
| **MEDIUM** | `public` + `trait:internal` 태그 + `fan_in = 0` | ~30% | 맥락을 고려하여 검토 |
| **LOW** | `public` + `fan_in = 0` (`trait:internal` 없음) | > 80% | 개수만 확인 — 외부 API 표면일 가능성 높음 |

**파라미터:** 없음

**반환값:** 단계별 심볼 수 요약 + HIGH·MEDIUM 전체 목록 + LOW는 개수만 표시.

> **참고:** `this.field.method()` 패턴의 호출은 정적 분석으로 완전히 추적되지 않아 public 메서드가 실제 호출되더라도 MEDIUM/LOW에 나타날 수 있습니다. HIGH 단계(`private`)는 신뢰도가 높습니다.

---

#### `get_hotspots`

선택한 메트릭 기준으로 심볼을 순위별로 나열합니다.

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `metric` | string | 필수 | 컬럼명: `cyclomatic`, `fan_in`, `fan_out`, `loc` |
| `threshold` | number | `0` | 포함할 최솟값 |

**반환값:** 선택한 메트릭 기준 상위 20개 심볼.

---

#### `get_risk_profile`

순환 복잡도, Git churn 빈도, 구조적 커플링을 결합한 종합 위험 점수를 산출합니다.

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `qualified_name` | string | 프로파일링할 심볼 |

**반환값:** `{ risk_score, complexity, churn, coupling, recommendations[] }`

---

#### `analyze_impact`

주어진 심볼에 의존하는 모든 심볼을 BFS로 탐색합니다 — 해당 심볼을 변경할 때의 "파급 효과" 분석.

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `qualified_name` | string | 필수 | 분석할 심볼 |
| `max_depth` | number | `3` | BFS 깊이 제한 |
| `use_cache` | boolean | `true` | 캐시된 탐색 결과 활용 |

**반환값:** 거리순 정렬된 `[{ node, distance, impact_path }]`.

---

### 4.5 리팩토링 및 내보내기

---

#### `propose_refactor`

심볼의 복잡도, 커플링, 의존자(dependents)를 고려한 위험도 기반 리팩토링 제안을 생성합니다.

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| `qualified_name` | string | 리팩토링 대상 심볼 |

**반환값:** 제안된 분리 포인트, 예상 위험도, 순서별 작업 단계.

---

#### `export_graph`

서브그래프를 Mermaid 다이어그램과 JSON 구조 요약으로 내보냅니다.

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `root_qname` | string | — | 루트 심볼 (생략 시 전체 그래프) |
| `max_depth` | number | `2` | 루트에서 포함할 홉(hop) 수 |

**반환값:** Mermaid `graph LR` 다이어그램 + `{ nodes[], edges[] }` JSON.

---

#### `check_consistency`

지식 그래프가 현재 디스크 상태 및 Git과 동기화되어 있는지 검증합니다.

| 파라미터 | 타입 | 기본값 | 설명 |
|----------|------|--------|------|
| `repair` | boolean | `false` | 탐지된 불일치 자동 복구 |
| `force` | boolean | `false` | 체크섬이 일치해도 강제 전체 재스캔 |

**반환값:** 각 검사 항목의 통과/실패 + 복구된 항목 목록.

---

## 5. REST API

REST API는 MCP 서버와 같은 프로세스에서 실행됩니다 (기본 포트 `3001`).

### 인터랙티브 탐색기

```
GET /api/docs
```

Swagger UI를 엽니다 — 인증 불필요. 모든 엔드포인트의 요청/응답 스키마가 문서화되어 있습니다.

### Rate Limit

| 범위 | 제한 |
|------|------|
| 전체 | 100회 / 분 |
| 분석 엔드포인트 (`/api/analysis/*`) | 10회 / 분 |

제한 초과 시 `429 Too Many Requests` 반환.

### 인증

`GET /api/docs`를 제외한 모든 엔드포인트에 필요:
```
Authorization: Bearer <token>
```

토큰은 실행 시 stderr에 출력됩니다. 로컬 전용 사용 시 `--no-auth`로 비활성화 가능.

### 주요 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/health` | 서버 상태 확인 |
| `GET` | `/api/analysis/hotspots` | 핫스팟 분석 |
| `POST` | `/api/analysis/impact` | 파급 효과 분석 |
| `GET` | `/api/symbols/:id` | 심볼 상세 정보 |
| `GET` | `/api/symbols/:id/callers` | 심볼 호출자 |
| `GET` | `/api/symbols/:id/callees` | 심볼 피호출자 |
| `GET` | `/api/search` | 심볼 검색 |
| `GET` | `/api/tests/:symbolId` | 연관 테스트 |

---

## 6. 지원 언어

| 언어 | 확장자 | 비고 |
|------|--------|------|
| TypeScript | `.ts`, `.tsx` | TypeScript Compiler API를 활용한 타입 인식 엣지 추출 |
| JavaScript | `.js`, `.jsx` | AST 기반, 타입 추론 없음 |
| Python | `.py` | 상속 및 import 엣지 포함 |
| Go | `.go` | 구조체 메서드, 인터페이스 |
| Java | `.java` | 클래스, 인터페이스, 생성자 |
| C | `.c`, `.h` | 함수, 구조체, 열거형 |
| C++ | `.cpp`, `.hpp` | 클래스, 네임스페이스, 템플릿 |
| C# | `.cs` | 클래스, 인터페이스, 메서드 |
| Kotlin | `.kt` | 클래스, 인터페이스, 함수 |
| PHP | `.php` | 함수, 클래스, 메서드 |
| Rust | `.rs` | 함수, 구조체, 트레이트, impl |
| GDScript | `.gd` | 클래스, 함수 (Godot 엔진) |

---

## 7. Zero-Pollution 원칙

Cynapx는 분석 대상 프로젝트 디렉토리를 절대 수정하지 않습니다. 모든 영구 데이터는 `~/.cynapx/` 하위에 저장됩니다:

```
~/.cynapx/
├── registry.json          # 등록된 모든 프로젝트 경로 목록
├── locks/                 # 프로젝트별 프로세스 잠금 파일
├── certs/                 # TLS 인증서 (해당 시)
└── <프로젝트-해시>/
    └── index.db           # SQLite 지식 그래프 (노드 + 엣지)
```

`<프로젝트-해시>`는 절대 프로젝트 경로의 결정론적 해시로, 프로젝트 간 데이터가 완전히 격리됩니다.

특정 프로젝트의 Cynapx 데이터 전체 삭제:
```
purge_index  →  confirm: true, unregister: true
```

모든 데이터 삭제:
```bash
rm -rf ~/.cynapx/
```

---

## 8. 언어 지원 확장

Cynapx는 Language Provider 확장 포인트를 통해 새로운 언어 지원을 추가할 수 있습니다.

1. `LanguageProvider` 인터페이스를 구현합니다 ([`docs/extending-language-support.md`](./docs/extending-language-support.md) 참고)
2. 컴파일된 `.js` 파일(또는 `ts-node` 사용 시 `.ts`)을 `~/.cynapx/plugins/`에 배치합니다
3. Cynapx를 재시작하면 레지스트리가 자동으로 탐색·로드합니다

Ruby 예제가 주석과 함께 [`examples/ruby-language-provider.ts`](./examples/ruby-language-provider.ts)에 제공됩니다.

---

**Cynapx** — [Feel-o-sofa](https://github.com/Feel-o-sofa)가 개발·유지보수
