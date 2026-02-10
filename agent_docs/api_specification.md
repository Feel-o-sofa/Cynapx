# AI 에이전트용 Code Knowledge Query API 명세서

본 문서는 **AI 에이전트가 코드 지식 인덱스(Code Knowledge Graph / Query Model)를 질의하기 위해 사용하는 전용 API 명세**를 정의한다.

본 API는 **자연어 사용을 전제하지 않으며**, 모든 입력·출력은 **결정론적 JSON 스키마**를 따른다.

---

## 1. 설계 원칙 (API Contract Principles)

1. **Agent-Only API**
   - 사람 사용자(UI, 브라우저)는 고려 대상이 아니다.

2. **Deterministic Output**
   - 동일 요청 → 동일 응답 구조 보장

3. **Schema Stability**
   - 필드 추가는 가능하나, 기존 필드 삭제·의미 변경은 금지

4. **Zero Natural Language**
   - 설명 문장, 요약 텍스트, 자유 텍스트 금지

5. **Graph-Oriented Semantics**
   - 모든 응답은 노드(Node)와 엣지(Edge) 의미를 내포해야 한다.

---

## 2. 공통 데이터 타입 정의

### 2.1 SymbolIdentifier
```json
{
  "qualified_name": "string",
  "symbol_type": "file | module | class | interface | method | function | field | test"
}
```

---

### 2.2 SourceLocation
```json
{
  "file_path": "string",
  "start_line": 0,
  "end_line": 0
}
```

---

### 2.3 Metrics
```json
{
  "loc": 0,
  "cyclomatic": 0,
  "fan_in": 0,
  "fan_out": 0
}
```

---

### 2.4 GraphNode
```json
{
  "id": "string",
  "symbol": "SymbolIdentifier",
  "location": "SourceLocation",
  "metrics": "Metrics",
  "last_updated_commit": "string"
}
```

---

### 2.5 GraphEdge
```json
{
  "from": "string",
  "to": "string",
  "edge_type": "contains | calls | inherits | implements | tests | depends_on",
  "distance": 0,
  "dynamic": false
}
```

---

## 3. API 엔드포인트 정의

---

## 3.1 Symbol 조회 API

### Endpoint
```
POST /api/symbol/get
```

### Request
```json
{
  "qualified_name": "string"
}
```

### Response
```json
{
  "node": "GraphNode",
  "outgoing_edges": ["GraphEdge"],
  "incoming_edges": ["GraphEdge"]
}
```

---

## 3.2 호출자 조회 API (Callers)

### Endpoint
```
POST /api/graph/callers
```

### Request
```json
{
  "symbol": "SymbolIdentifier",
  "max_depth": 3,
  "include_tests": false
}
```

### Response
```json
{
  "root": "GraphNode",
  "callers": [
    {
      "node": "GraphNode",
      "distance": 1
    }
  ]
}
```

---

## 3.3 피호출자 조회 API (Callees)

### Endpoint
```
POST /api/graph/callees
```

### Request
```json
{
  "symbol": "SymbolIdentifier",
  "max_depth": 3
}
```

### Response
```json
{
  "root": "GraphNode",
  "callees": [
    {
      "node": "GraphNode",
      "distance": 1
    }
  ]
}
```

---

## 3.4 영향 범위 분석 API

### Endpoint
```
POST /api/analysis/impact
```

### Request
```json
{
  "changed_symbols": ["SymbolIdentifier"],
  "scope": "public | protected | internal | all",
  "max_depth": 5,
  "include_tests": true
}
```

### Response
```json
{
  "affected_nodes": [
    {
      "node": "GraphNode",
      "impact_path": ["string"],
      "distance": 0
    }
  ]
}
```

---

## 3.5 복잡도 Hotspot 조회 API

### Endpoint
```
POST /api/analysis/hotspots
```

### Request
```json
{
  "metric": "cyclomatic | fan_in | fan_out | loc",
  "threshold": 0,
  "symbol_type": "method | class"
}
```

### Response
```json
{
  "hotspots": [
    {
      "node": "GraphNode",
      "metric_value": 0
    }
  ]
}
```

---

## 3.6 테스트 커버리지 연계 조회 API

### Endpoint
```
POST /api/analysis/tests
```

### Request
```json
{
  "symbol": "SymbolIdentifier"
}
```

### Response
```json
{
  "production_node": "GraphNode",
  "tests": ["GraphNode"]
}
```

---

## 4. 오류 응답 규약

### Error Response Schema
```json
{
  "error_code": "string",
  "message": "string",
  "related_symbol": "string"
}
```

- 오류 메시지는 **AI 디버깅 목적의 구조 정보**만 포함한다.
- 자연어 설명, 해결 방법 제안 금지

---

## 5. 인증 및 접근 제어

- 모든 요청은 Bearer Token 기반 인증 필요
- 토큰은 읽기 전용 권한만 부여

---

## 6. 변경 감지 및 최신성 보장 규약 (API 관점)

- 모든 GraphNode는 `last_updated_commit` 필드를 포함해야 한다.
- API는 내부적으로 **최신 인덱스 상태만**을 반환해야 한다.
- 인덱스 갱신 중에는 마지막 정상 스냅샷을 유지한다.

---

## 7. 명시적 비범위 (Out of Scope)

- 자연어 질의 API
- 코드 원문 반환 API
- 사람 사용자용 UI

---

## 8. 성공 기준

- AI 에이전트가 본 API만으로 코드 구조를 재구성할 수 있을 것
- 동일 질의에 대해 항상 구조적으로 동일한 JSON 응답을 받을 것
- 변경 직후 질의 시 최신 구조가 반영될 것

---

## 9. 결론

본 API는 REST 서비스가 아니라 **AI 추론을 위한 구조 질의 엔진**이다. 모든 설계는 AI의 컨텍스트 효율성과 추론 안정성을 최우선 기준으로 한다.

