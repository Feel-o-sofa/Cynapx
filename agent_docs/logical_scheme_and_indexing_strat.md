# AI 에이전트용 Code Knowledge Graph DB 논리 스키마 & 인덱싱 전략

본 문서는 **Code Knowledge Index**의 영속 저장소로 사용되는 **Graph Database의 논리 스키마(Logical Schema)** 와 **인덱싱 전략(Indexing Strategy)** 을 정의한다.

대상 독자는 **본 시스템을 구현하는 AI 에이전트**이며, 본 문서는 DB 선택(Neo4j, JanusGraph 등)에 관계없이 **반드시 만족해야 하는 구조적 계약(Structural Contract)** 을 규정한다.

---

## 1. 설계 원칙

1. **Graph-First**
   - 코드 구조는 트리나 문서가 아니라 **그래프**로만 표현한다.

2. **Symbol-Centric Modeling**
   - 모든 핵심 노드는 `Symbol` 개념을 중심으로 정의한다.

3. **Query Determinism**
   - 동일 질의는 항상 동일한 결과 집합을 반환해야 한다.

4. **Incremental Update Friendly**
   - 삭제·삽입·갱신 연산이 국소적으로 수행 가능해야 한다.

---

## 2. 노드(Node) 타입 정의

### 2.1 공통 노드 속성 (All Nodes)

| 속성명 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `id` | string | Y | 내부 고유 ID (DB PK) |
| `qualified_name` | string | Y | 전역 유일 심볼 식별자 |
| `symbol_type` | enum | Y | file, module, class, interface, method, function, field, test |
| `language` | string | Y | 소스 언어 |
| `file_path` | string | Y | 정의된 파일 경로 |
| `start_line` | int | Y | 시작 라인 |
| `end_line` | int | Y | 종료 라인 |
| `visibility` | enum | Y | public, protected, internal, private |
| `is_generated` | boolean | Y | 자동 생성 코드 여부 |
| `last_updated_commit` | string | Y | 마지막 반영 커밋 |
| `version` | int | Y | 증분 갱신용 논리 버전 |

---|---|---|
| `id` | string | 내부 고유 ID (DB PK) |
| `qualified_name` | string | 전역 유일 심볼 식별자 |
| `symbol_type` | enum | file, module, class, interface, method, function, field, test |
| `language` | string | 소스 언어 |
| `file_path` | string | 정의된 파일 경로 |
| `start_line` | int | 시작 라인 |
| `end_line` | int | 종료 라인 |
| `last_updated_commit` | string | 마지막 반영 커밋 |

---

### 2.2 File Node

- `symbol_type = file`
- 파일 단위 증분 갱신의 기준 노드

추가 속성:
- `checksum` (string): 파일 내용 해시

---

### 2.3 Type Node (Class / Interface)

- `symbol_type = class | interface`

추가 속성:
- `modifiers` (array<string>)

---

### 2.4 Callable Node (Method / Function)

- `symbol_type = method | function`

추가 속성:
- `signature` (string)
- `return_type` (string)
- `modifiers` (array<string>)

---

### 2.5 Field Node

- `symbol_type = field`

추가 속성:
- `field_type` (string)

---

### 2.6 Test Node

- `symbol_type = test`

---

## 3. 엣지(Edge) 타입 정의

### 3.1 구조적 관계 엣지

| Edge Type | From → To | 필수 | 의미 |
|---|---|---|---|
| `DEFINES` | File → Symbol | Y | 파일이 심볼을 정의 |
| `CONTAINS` | Module/Type → Symbol | Y | 논리적 포함 관계 |
| `NAMESPACE_OF` | Module → Module | N | 네임스페이스 계층 |
| `INHERITS` | Class → Class | Y | 상속 |
| `IMPLEMENTS` | Class → Interface | Y | 구현 |

---

### 3.2 행위적 관계 엣지

| Edge Type | From → To | 필수 | 의미 |
|---|---|---|---|
| `CALLS` | Callable → Callable | Y | 호출 |
| `OVERRIDES` | Method → Method | N | 오버라이드 관계 |
| `READS` | Callable → Field | N | 필드 읽기 |
| `WRITES` | Callable → Field | N | 필드 쓰기 |

추가 속성:
- `dynamic` (boolean)
- `call_site_line` (int)

---|---|---|
| `DEFINES` | File → Symbol | 파일이 심볼을 정의 |
| `CONTAINS` | Type → Callable / Field | 타입 구성 |
| `INHERITS` | Class → Class | 상속 |
| `IMPLEMENTS` | Class → Interface | 구현 |

---

### 3.2 행위적 관계 엣지

| Edge Type | From → To | 의미 |
|---|---|---|
| `CALLS` | Callable → Callable | 호출 |
| `READS` | Callable → Field | 필드 읽기 |
| `WRITES` | Callable → Field | 필드 쓰기 |

추가 속성:
- `dynamic` (boolean)

---

### 3.3 품질·테스트 관계 엣지

| Edge Type | From → To | 의미 |
|---|---|---|
| `TESTS` | Test → Symbol | 테스트 대상 |
| `DEPENDS_ON` | Module / File → Module / File | 모듈/파일 의존 |

---

## 4. 무결성 제약 조건 (Schema Invariants)

1. 모든 Symbol 노드는 정확히 하나의 File 노드에 의해 `DEFINES` 된다.
2. 동일 `qualified_name` 을 가진 활성 Symbol 노드는 하나만 존재한다.
3. 동일 File 내에서 `(start_line, end_line)` 이 중복되는 Symbol 은 허용되지 않는다.
4. 모든 Edge는 존재하는 Node만을 참조해야 한다.
5. `CALLS`, `OVERRIDES` 엣지는 Callable → Callable 간에만 허용된다.
6. 상속 그래프(`INHERITS`)는 순환을 허용하지 않는다.
7. `OVERRIDES` 관계는 반드시 `INHERITS` 또는 `IMPLEMENTS` 경로 상에 존재해야 한다.
8. 삭제된 Symbol과 연결된 Edge는 트랜잭션 내에서 모두 제거되어야 한다.

---

## 5. 인덱싱 전략

### 5.1 필수 인덱스 (Mandatory)

| 대상 | 인덱스 | 제약 | 목적 |
|---|---|---|---|
| Node | `qualified_name` | UNIQUE | 심볼 직접 조회 |
| Node | `(symbol_type, qualified_name)` | UNIQUE | 타입+이름 탐색 |
| Node | `file_path` | NON-UNIQUE | 파일 단위 갱신 |
| Node | `version` | NON-UNIQUE | 증분 갱신 충돌 감지 |

---

### 5.2 그래프 탐색 최적화 인덱스

| 대상 | 인덱스 | 사용 시나리오 |
|---|---|---|
| Edge | `(edge_type)` | 관계 유형 필터 |
| Edge | `(edge_type, dynamic)` | 동적 호출 분석 |
| Node | `(symbol_type, language)` | 언어별 분석 |

---|---|---|
| Node | `qualified_name` (UNIQUE) | 심볼 직접 조회 |
| Node | `symbol_type` | 타입별 필터링 |
| Node | `file_path` | 파일 단위 갱신 |
| Node | `last_updated_commit` | 최신성 검증 |

---

### 5.2 고성능 쿼리 인덱스 (Recommended)

| 대상 | 인덱스 | 사용 시나리오 |
|---|---|---|
| Node | `(symbol_type, qualified_name)` | 심볼 검색 |
| Edge | `edge_type` | 관계 탐색 |
| Node | `language` | 언어별 분석 |

---

## 6. 증분 갱신을 위한 DB 연산 규칙

### 6.1 삭제 규칙

- File 노드 삭제 시:
  - 해당 File이 `DEFINES` 하는 모든 Symbol 노드를 삭제
  - 연결된 모든 Edge를 트랜잭션 내 제거

---

### 6.2 삽입 규칙

- 신규 Symbol 삽입 전:
  - 동일 `qualified_name` 존재 여부 검사
- 존재 시:
  - 반드시 기존 노드 삭제 후 재삽입

---

### 6.3 갱신 규칙

- Node 속성 변경은 허용
- Node 타입 변경은 **삭제 후 재생성**으로만 처리

---

## 7. 대표 쿼리 패턴 (논리 수준)

### 7.1 호출자 조회

- 입력: `qualified_name`
- 탐색: 역방향 `CALLS` 엣지

---

### 7.2 영향 범위 분석

- 입력: 변경된 Symbol
- 탐색: `CALLS`, `INHERITS`, `IMPLEMENTS`, `TESTS`

---

### 7.3 Hotspot 탐지

- 필터: `symbol_type = method`
- 정렬: 메트릭 속성 기준

---

## 8. DB 구현 독립성 규칙

- 물리적 PK, 내부 ID는 DB별 구현에 위임한다.
- 본 문서의 논리 스키마와 제약 조건은 DB 종류와 무관하게 유지되어야 한다.

---

## 9. 결론

본 Graph DB 논리 스키마는 **AI 에이전트의 구조적 추론을 위한 최소·충분 조건**을 정의한다.

이 스키마를 따르는 한, DB 교체·확장·샤딩이 이루어지더라도 Query API와 증분 갱신 알고리즘의 의미는 변하지 않는다.

