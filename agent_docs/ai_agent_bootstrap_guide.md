# AI Agent Bootstrap Guide
## Node.js + SQLite (better-sqlite3) + In-process Graph Engine

본 문서는 **사람이 아니라 AI 에이전트가 읽고 그대로 실행·구현하기 위한 부트스트랩 지침서**이다.

이 문서는 설계 토론용이 아니며, **행동 지침(Actionable Specification)** 이다.
AI 에이전트는 본 문서의 내용을 *의심하거나 재설계하지 말고*, 그대로 구현을 시작해야 한다.

---

## 0. 절대 전제 (Non-Negotiable Constraints)

1. 본 도구의 **주 사용자(primary user)는 AI 에이전트**이다.
2. 인간 사용자는 이 도구의 내부 구조를 이해할 필요가 없다.
3. AI는 **소스 코드를 직접 스캔·탐색하지 않는다**.
4. AI는 **반드시 Query API를 통해서만 코드 정보를 획득**해야 한다.
5. SQLite는 저장소일 뿐이며, **그래프 의미 해석은 전부 서비스 계층에서 수행**한다.

이 전제를 위반하는 구현은 실패로 간주한다.

---

## 1. 목표 시스템 요약

구현해야 할 시스템은 다음과 같은 역할을 수행한다.

- 로컬 코드베이스를 분석하여
- Code Knowledge Graph를 구축·유지하고
- 파일 변경 시 증분 갱신을 수행하며
- AI 에이전트가 질의 가능한 HTTP API를 제공한다.

이 시스템은 **IDE 인덱서의 외부 서비스 버전**에 해당한다.

---

## 2. 고정 기술 스택 (MUST USE)

AI 에이전트는 아래 기술 스택을 변경·대체해서는 안 된다.

- Runtime: **Node.js >= 20**
- Language: **TypeScript (strict mode)**
- Database: **SQLite (better-sqlite3)**
- Architecture: **In-process Graph Engine**
- API Style: **HTTP + JSON (REST)**

외부 DB 서버, ORM, Graph DB, LLM 연동은 금지된다.

---

## 3. 필수 입력 문서 (Authoritative Sources)

아래 문서들은 이미 확정된 계약이며, 구현 중 해석의 여지가 없다.

1. `requisites.md`
2. `api_specification.md`
3. `incremental_updating_rules.md`
4. `logical_scheme_and_indexing_strat.md`

충돌 발생 시 우선순위:

```
requisites.md
> incremental_updating_rules.md
> logical_scheme_and_indexing_strat.md
> api_specification.md
```

---

## 4. 프로젝트 디렉터리 구조 (MUST FOLLOW)

```text
code-knowledge-tool/
├─ src/
│  ├─ server/            # HTTP API
│  ├─ indexer/           # File analysis & parsing
│  ├─ graph/             # In-process graph engine
│  ├─ db/                # SQLite access layer
│  ├─ watcher/           # File / Git change detection
│  ├─ types/             # Shared type definitions
│  └─ bootstrap.ts       # Startup entry
├─ schema/
│  └─ schema.sql         # SQLite DDL (single source of truth)
├─ docs/                 # Provided design documents
├─ package.json
└─ tsconfig.json
```

---

## 5. SQLite 설계 원칙

### 5.1 역할 정의

SQLite는 다음 책임만 가진다.

- Node / Edge의 영속 저장
- 인덱스를 통한 빠른 조회
- 트랜잭션 보장

그래프 탐색, 의미 해석, 정책 판단은 **절대 DB에서 수행하지 않는다**.

---

### 5.2 필수 테이블

AI 에이전트는 반드시 아래 두 테이블만 사용해야 한다.

```sql
nodes(
  id INTEGER PRIMARY KEY,
  qualified_name TEXT UNIQUE,
  symbol_type TEXT,
  file_path TEXT,
  start_line INTEGER,
  end_line INTEGER,
  visibility TEXT,
  language TEXT,
  version INTEGER,
  last_updated_commit TEXT
);

edges(
  from_id INTEGER,
  to_id INTEGER,
  edge_type TEXT,
  dynamic INTEGER,
  call_site_line INTEGER
);
```

추가 테이블 생성은 금지된다.

---

## 6. In-process Graph Engine 책임

Graph Engine은 DB 위에 존재하는 **논리 계층**이다.

반드시 다음 API를 제공해야 한다.

- `getNodeByQualifiedName`
- `getOutgoingEdges(nodeId, edgeType?)`
- `getIncomingEdges(nodeId, edgeType?)`
- `traverse(startNodeId, strategy)`

DFS/BFS 구현은 허용되나, 재귀 깊이 제한을 반드시 둔다.

---

## 7. Indexing & Incremental Update Pipeline

### 7.1 이벤트 입력 형식

모든 변경 이벤트는 아래 형식으로 정규화된다.

```json
{
  "event": "ADD | MODIFY | DELETE",
  "file_path": "string",
  "commit": "string"
}
```

---

### 7.2 처리 규칙 (요약)

- MODIFY = DELETE + ADD
- File 단위 트랜잭션
- 실패 시 전체 롤백
- 중간 상태 외부 노출 금지

세부 규칙은 `incremental_updating_rules.md`를 그대로 따른다.

---

## 8. HTTP API 구현 규칙

- 모든 응답은 JSON
- 상태 저장 금지 (Stateless)
- DB 직접 접근 API 제공 금지

API 엔드포인트는 `api_specification.md`와 **완전히 일치**해야 한다.

---

## 9. AI 에이전트 행동 규칙 (중요)

AI 에이전트는 다음을 준수해야 한다.

1. 모호한 경우 **Graph Query API부터 호출**한다.
2. DB 구조를 추측하지 않는다.
3. 소스 파일을 직접 읽지 않는다.
4. 성능보다 **정합성**을 우선한다.

이 규칙을 위반한 추론은 무효다.

---

## 10. 구현 순서 (MANDATORY ORDER)

AI 에이전트는 반드시 아래 순서로 작업을 진행한다.

1. SQLite schema.sql 작성
2. DB access layer 구현
3. Graph Engine 구현
4. Incremental update pipeline 구현
5. HTTP Query API 구현
6. File watcher 연동

순서를 바꾸지 않는다.

---

## 11. 완료 기준 (Definition of Done)

다음 조건을 모두 만족해야 구현 완료로 간주한다.

- 파일 수정 시 Graph가 자동 갱신됨
- 모든 Query API가 결정론적 결과 반환
- DB 파일 삭제 후 재생성 가능
- AI 에이전트가 코드 구조를 설명받지 않고 질의 가능

---

## 12. 최종 선언

본 도구는 **사람을 위한 개발 도구가 아니다**.

이는 AI 에이전트에게 **코드를 이해하기 위한 외부 기억 장치**를 제공하는 시스템이다.

AI 에이전트는 이 문서를 마지막으로 추가 질문 없이 구현을 시작해야 한다.

