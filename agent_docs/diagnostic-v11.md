# Cynapx 정밀 진단 보고서 v11

- **기준 커밋**: `b489199` (Phase 13-9 + Phase 13 완료, 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-14
- **진단 범위**: src/ 전체 (server, db, indexer, graph, watcher, utils, bootstrap), schema/, scripts/, tests/, src-native/, Dockerfile, package.json/lockfile + 외부 컨텍스트(CVE/advisory, MCP 생태계, 경쟁 도구)
- **진단 방법**: 단일 에이전트 순차 전수 코드 리뷰 + 로컬 검증(`npx tsc --noEmit` 그린, `npm audit --omit=dev` 직접 실행, 번들 SQLite 버전 확인) + 웹 검색 기반 외부 조사
- **현재 상태(직접 검증)**: Phase 13 종료 시점 — `npm test` 525/525, `npx tsc --noEmit` 그린, `npm run build && node scripts/integration-test.js` 76/76(75 pass + 1 Docker SKIP). diagnostic-v10 전 항목 [DONE].

> **요약**: **13개 페이즈의 하드닝 이후 코드 자체에 CRITICAL/HIGH급 신규 결함은 없다.** 이번 사이클의 최상위 항목은 **외부에서 유입된 공급망 취약점**이다 — `@modelcontextprotocol/sdk@1.29.0`이 전이 의존으로 끌어오는 **fast-uri CVE-2026-6321(HIGH, path traversal)** 외 hono/express5/qs 다수가 `npm audit --omit=dev`에서 **7건(HIGH 1 + MODERATE 6)** 으로 잡힌다(진단 일자 기준 신규). 이 중 어느 것도 Cynapx의 실제 코드 경로로 **도달 가능(reachable)** 하지는 않지만(아래 N-1 분석), 공급망 위생·CI 게이트·문서화 관점에서 처리 대상이다. 그 외는 이전에 명시적으로 **보류**된 4개 항목(O-5 클러스터링 파티셔닝, IPC MessagePack, YamlParser→js-yaml, MCP 2025-11-25 task 워크플로)과 소수의 신규 MEDIUM/LOW다. **CRITICAL 0, HIGH 1(공급망), MEDIUM 5, LOW 6.**

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건(C-1 Docker 배포 전손, C-2 사이드카 spawn 크래시, C-3 IPC 인증 무력화)은 Phase 13-1/13-2에서 해소됐고, 전수 재열람에서 새로운 CRITICAL은 발견되지 않았다. IPC 핸드셰이크(`ipc-coordinator.ts:149-196`)는 random challenge + `HMAC-SHA256(nonce, challenge)` + `timingSafeEqual`로 견고하며, Docker 경로/사이드카 spawn error 처리/락 단일성은 모두 검증됐다.

---

## 2. HIGH — 안정성/보안/정합성 결함

### N-1. 공급망: `@modelcontextprotocol/sdk@1.29.0` 전이 의존에 fast-uri HIGH(CVE-2026-6321) 외 6건 — `npm audit` 게이트 부재 **[DONE — Phase 14-1]**
**`package.json:23` (간접), 잠재 라우트: `src/server/api-server.ts:14-15`**

`npm audit --omit=dev`(프로덕션 의존만)가 **7건**을 보고한다(진단 일자 직접 실행):

| 패키지 | 심각도 | Advisory | 경로 | 수정 |
|--------|--------|----------|------|------|
| **fast-uri** | **HIGH** | CVE-2026-6321 (percent-encoded dot-segment path traversal, host confusion) | `@modelcontextprotocol/sdk → ajv@8.18.0 → fast-uri@3.1.0` | fast-uri ≥ **3.1.1** |
| hono | MODERATE(다건) | CSS injection, JWT NumericDate, cache leak, bodyLimit bypass 등 | `@modelcontextprotocol/sdk → hono@4.12.14` (+ `@hono/node-server`) | hono 패치 버전 |
| qs | MODERATE | DoS (comma-format array stringify) | `express@4.22.1 → body-parser → qs@6.14.2`, SDK의 express@5.2.1 경유 | qs ≥ 6.14.x 패치 |
| express(4) | MODERATE | 취약 qs 의존 | 직접 의존 `express@4.22.1` | express 패치 또는 qs override |
| express-rate-limit | MODERATE | ip-address XSS(Address6 HTML 메서드) 전이 | `express-rate-limit@8.3.1 → ip-address@10.1.0` | express-rate-limit ≥ **8.5.x** |
| ip-address | MODERATE | XSS in Address6 HTML-emitting 메서드 | 위와 동일 | 상동 |

**도달 가능성(reachability) 분석 — 모두 실효 위험 낮음**:
- **fast-uri**(ajv 경유): MCP SDK 내부 JSON 스키마 검증에 ajv가 쓰이지만, Cynapx는 SDK의 URI 템플릿/리소스 라우팅을 fast-uri의 `normalize/equal` 공격 표면으로 노출하지 않는다(stdio + StreamableHTTP transport만 사용, 리소스 URI는 내부 생성). 그래도 SDK 업스트림이 ajv/fast-uri를 끌어오므로 audit가 계속 빨갛게 남는다.
- **hono / express@5**: SDK가 끌어오지만 **Cynapx는 자체 `express@4`로 HTTP 서버를 구성**한다(`api-server.ts:167`). SDK의 hono 기반 서버는 미사용 — 런타임에 로드되지 않는다.
- **express-rate-limit ip-address XSS**: Address6의 HTML-emitting 메서드는 Cynapx 경로에서 호출되지 않는다. 또한 keyGenerator를 `req.socket.remoteAddress`로 고정(`api-server.ts:118,123`)해 IPv4-mapped IPv6 bypass(별도 CVE-2026-30827)도 우회 — 단 라이브러리 자체 업그레이드(8.5.x)가 정석.
- **qs DoS**: Cynapx는 `qs.stringify(..., {encodeValuesOnly})`를 직접 호출하지 않으며 들어오는 쿼리스트링은 단순(`sessionId`)하다.

즉 **현재 익스플로잇 경로는 없다**고 판단되나, (1) `@modelcontextprotocol/sdk`는 이미 최신(1.29.0)이라 **상위 업그레이드로 해소 불가**, (2) audit가 항상 빨간 상태면 CI 보안 게이트를 운영할 수 없고 진짜 신규 취약점을 놓친다. 

**수정 권고**:
1. `package.json`에 **`overrides`** 추가로 전이 의존을 패치 버전으로 강제: `fast-uri ≥ 3.1.1`, `qs ≥ 6.14.x(패치)`, (가능하면) `ip-address` 패치. 이미 tree-sitter override 패턴이 존재하므로 동일 방식.
2. `express-rate-limit`을 직접 **8.5.x로 마이너 업그레이드**(ip-address 전이 해소).
3. SDK 업스트림 이슈(typescript-sdk#2042: "Transitive dependencies with known vulnerabilities in 1.29.0")를 추적 — SDK가 hono/ajv 정리하면 override 일부 제거 가능.
4. **`npm audit --omit=dev --audit-level=high` CI 게이트** 도입(또는 `audit-ci`). override 적용 후 HIGH 0을 기준선으로 고정.
5. **검증**: override 적용 후 `npm ls fast-uri`가 3.1.1+를 보이고 `npm audit --omit=dev`의 HIGH가 0인지, 네이티브 바인딩/transport가 정상 동작(기존 `tests/api-server-http.test.ts` 그린)하는지.

**해소 결과 [DONE — Phase 14-1]**:
- (1) **fast-uri** `[DONE]`: `overrides`에 `"fast-uri": "^3.1.1"` 추가 → `fast-uri@3.1.2` 강제(`npm ls fast-uri` = 3.1.2 overridden). HIGH 제거.
- (2) **qs DoS** `[DONE]`: `overrides`에 `"qs": "^6.15.2"` 추가(advisory 범위가 `6.11.1 - 6.15.1`이라 6.15.2 이상이어야 해소) → express@4/express@5/superagent 경유 전부 `qs@6.15.2`로 dedupe.
- (3) **ip-address XSS** `[DONE]`: `express-rate-limit` `^8.3.1 → ^8.5.2` 마이너 업그레이드 → 취약 `ip-address` 전이 제거. `keyGenerator`(`api-server.ts:118,123`, `req.socket.remoteAddress`)는 8.5.x에서 그대로 호환(테스트 그린).
- (4) **hono / express@5** `[DONE — 도달 불가 문서화 + override]`: `overrides`에 `"hono": "^4.12.21"` 추가(advisory `<=4.12.20`). 다만 Cynapx 런타임은 SDK의 hono/express@5 참조 서버를 import/로드하지 않고 자체 express@4를 사용 → 미도달. 근거 주석을 `src/server/api-server.ts` SDK transport import 위에 명시. 업스트림 추적: `modelcontextprotocol/typescript-sdk#2042`(검증됨: "Security: Transitive dependencies with known vulnerabilities in @modelcontextprotocol/sdk@1.29.0").
- (5) **CI audit 게이트** `[DONE]`: `.github/workflows/ci.yml` lint 잡에 `npm audit --omit=dev --audit-level=high` step 추가(기존 audit-ci 패턴 없음). **주의대로 `cynapx-autonomous.yml`은 미변경.**
- **최종 검증**: `npm audit --omit=dev` = **0 vulnerabilities (HIGH 0 / MODERATE 0)**. 남은 1건 MODERATE(`postcss`)는 `vitest → vite` 경유 **dev-only**라 `--omit=dev`에서 제외(런타임 미도달). `npx tsc --noEmit` clean, `vitest run` 525/525, `npm run build && node scripts/integration-test.js` 76/76(75 pass + Docker skip).

> 주의: CVE-2026-25536(SDK cross-client data leak via shared transport reuse, 1.26.0에서 수정)은 **해당 없음** — Cynapx는 세션마다 `{transport, sdkServer}` 페어를 1:1로 생성(`api-server.ts:126-131`)하므로 transport 재사용 패턴이 아니다. 1.29.0은 이미 1.26.0+이라 이중으로 안전.

---

## 3. MEDIUM — 아키텍처/정합성 개선 (A)

### A-1(v11). YamlParser 수제 라인 파싱 — 멀티라인/플로우/앵커 구조 누락, js-yaml 미전환 **[DONE — Phase 14-3]**
**`src/indexer/yaml-parser.ts:41-91`**

`YamlParser`는 정규식 라인 스캔으로 top-level key와 `jobs:` 직하 항목만 추출한다. 다음을 정확히 처리하지 못한다: 플로우 스타일(`jobs: {build: ...}`), 멀티라인 스칼라(`|`/`>`), 앵커/별칭(`&`/`*`), 리스트 항목으로 정의된 키, 들여쓰기가 탭인 파일. **현 용도(CI 워크플로의 top-level key + job 이름 노드화)에는 충분**하나, GitHub Actions의 reusable workflow(`jobs.<id>.uses`)나 Kubernetes/compose 매니페스트로 범위가 넓어지면 침묵 누락이 된다.

**판정**: diagnostic-v10 A-10 표의 "우선순위 낮음" 유지하되, **`js-yaml` 전환을 Phase 14에서 채택 후보로 승격** — 의존성은 가볍고(순수 JS, 알려진 취약점 없음 — 진단 시 확인 권고), 파서를 "라인 휴리스틱 → 실제 YAML 트리 순회"로 바꾸면 위 모든 케이스가 한 번에 해소되고 markdown/json-config 파서와 일관된 견고성을 얻는다. **테스트**: 멀티라인 스칼라/플로우 jobs/앵커 fixture에서 노드·에지 기대값.

**해소 결과 [DONE — Phase 14-3]** (`src/indexer/yaml-parser.ts`, `package.json`, `tests/metadata-parsers.test.ts`):
- **A-1(1) js-yaml 의존** `[DONE — Phase 14-3]`: `js-yaml`(prod dependency — 파서는 인덱싱 런타임에 동작) + `@types/js-yaml`(devDependency) 추가. 추가 직후 `npm audit --omit=dev` = **0 vulnerabilities**(P14-1 게이트 baseline 유지) — js-yaml은 순수 JS·전이 취약점 없음.
- **A-1(2) 파서 재작성** `[DONE — Phase 14-3]`: 수제 정규식 라인 스캔 → `yaml.load()` 트리 파싱 + 트리 순회로 교체. top-level mapping key → `config_key` 노드, `jobs.<id>` → `function` 노드, `contains` 에지(file→각 노드). 플로우 스타일(`jobs: {build: ...}`)·블록 스칼라(`|`/`>`)·앵커/별칭(`&`/`*`/`<<`)·리스트 키를 모두 견고 처리. **Graceful 강등**: `yaml.load()`가 YAMLException(malformed/탭 들여쓰기)을 던지면 catch해서 파일 노드만 반환(throw 전파 없음). **라인 번호**: js-yaml `listener` 옵션으로 각 scalar `close` 이벤트의 `state.line`(0-based)을 캡처 — top-level key/job id는 워크플로 내 고유 문자열이라 string→line 맵(first-occurrence-wins)으로 충분하며 구 라인 파서 위치를 정확히 재현(simple fixture: name=1/on=2/jobs=3/build=4/test=6). 한계: 플로우 스타일/alias-공유 scalar는 첫 텍스트 출현 줄로 근사(주석에 명시).
- **A-1(3) 범위 확장** `[DONE — Phase 14-3]`: `jobs.<id>.uses`(reusable workflow 참조)를 `calls` 에지(job 노드→대상 워크플로 경로)로 추가 — 기존 노드/에지 동등성은 그대로 유지(`uses` 없는 워크플로는 영향 없음).
- **테스트**(`tests/metadata-parsers.test.ts`, +8건): 동등성 회귀(simple workflow 노드/에지 + 라인 번호 불변), 블록 스칼라, 플로우 jobs, 앵커/별칭, reusable `uses` 에지, 탭 들여쓰기 graceful 강등, malformed YAML 파일 노드만, 빈/비-매핑 문서. `npx tsc --noEmit` clean, `npx vitest run` **538/538**(530 → +8), `npm audit --omit=dev` 0 vulnerabilities.

### A-2(v11). 클러스터링이 그래프 전체를 메모리에 적재 (O-5 승계) — 100k+ 노드 미보호 **[이월: v9 O-5 → v10 O-5, 계속 보류 판정]**
**`src/graph/graph-engine.ts:168-245`**

`performClustering()`는 `getAllNodes()` + `getAllEdges()`를 통째로 로드하고 인접 리스트·라벨 맵을 전부 메모리에 만든다. LPA 자체는 O(V+E)지만 V·E 전량 상주라 초대형 모노레포(수십만 심볼)에서 RSS 급증·GC 압박이 가능하다. `persistClusters` 트랜잭션화(v10 A-5)는 이미 완료돼 정합성은 안전하다.

**판정**: **계속 보류**가 합리적 — 현실 규모에서 무해하고, 파티셔닝(파일/디렉터리 경계 기반 서브그래프 클러스터링)은 클러스터 품질 트레이드오프를 동반한다. 단 **방어선 하나는 저렴하게 추가 가치 있음**: 노드 수가 임계치(예: 200k)를 넘으면 경고 로그 + clustering 스킵/샘플링하는 가드. Phase 14에서 "가드만" 채택, 본격 파티셔닝은 계속 이연.

### A-3(v11). CrossProjectResolver의 원격 DB 쿼리가 leading-wildcard LIKE 풀스캔 + 버전/신뢰 검사 부재 **[DONE — Phase 14-2]**
**`src/indexer/cross-project-resolver.ts:99-102`**

```sql
SELECT * FROM nodes WHERE qualified_name = ? COLLATE NOCASE OR qualified_name LIKE ? COLLATE NOCASE LIMIT 1
-- 두 번째 바인딩: `%#${symbolName}`  ← leading wildcard, 인덱스 불가
```

미해석 에지 1건마다 **등록된 모든 외부 프로젝트 DB**에 대해 leading-`%` LIKE 풀스캔이 발생한다. v10 A-4에서 로컬 `findNodesBySymbolName`은 `symbol_name` 인덱스 컬럼으로 해소했지만 **원격 경로는 동일 패턴이 남아 있다**(원격 DB에는 `symbol_name` 컬럼/인덱스가 스키마 버전에 따라 없을 수 있음). 또한 원격 DB는 `readRegistry()`가 가리키는 파일을 신뢰 검사 없이 `new SQLiteDatabase(dbPath, {readonly:true})`로 연다 — better-sqlite3 12.10.0(SQLite 3.53.1)으로 CVE-2025-7709는 패치됐으나, 향후 SQLite CVE 재발 시 "crafted DB file" 표면이 남는다.

**수정 권고**: (1) 원격 쿼리도 `symbol_name` indexed equality probe로 전환(원격 스키마에 컬럼 존재 시; 없으면 등가 LIKE 폴백 + 경고), (2) 원격 DB 오픈 직후 `sqlite_version()`/스키마 버전 sanity 체크 후 불일치 시 skip. **테스트**: 멀티 프로젝트 fixture에서 원격 심볼 해석 + 인덱스 사용(`EXPLAIN QUERY PLAN`에 SEARCH 확인).

**해소 결과 [DONE — Phase 14-2]** (`src/indexer/cross-project-resolver.ts`):
- **A-3(1) LIKE 풀스캔 → indexed probe** `[DONE]`: `openRemoteDb()` 직후 `isTrustedRemoteDb()`가 `PRAGMA table_info(nodes)`로 `symbol_name` 컬럼 + 스키마 버전(>= 3) 보유 여부를 1회 검사해 `symbolNameCapable`(connection 키 맵)에 캐싱. capable이면 로컬 `findNodesBySymbolName()`과 동일하게 `WHERE symbol_name = ? COLLATE NOCASE` 단일 indexed probe(`idx_nodes_symbol_name` NOCASE)를 사용 — `EXPLAIN QUERY PLAN`에 `SEARCH ... USING INDEX idx_nodes_symbol_name` 확인. (주의: `qualified_name = ? COLLATE NOCASE`를 OR로 묶으면 BINARY `qualified_name` 인덱스를 NOCASE 술어가 못 써 OR-by-union이 깨지고 풀스캔으로 강등 → 단일 술어로 probe하고 정확 canonical 매치는 JS에서 우선 선택.) `extractSymbolName()`로 `#` 접미부 추출, 글로벌 심볼(no `#`)은 `symbol_name == qualified_name`이라 동일 probe로 커버.
- **A-3(1) 폴백 + 1회 경고** `[DONE]`: 구버전 원격 스키마(< v3, `symbol_name` 없음)는 기존 `LIKE '%#name'` 폴백을 유지하되, `warnedLegacySchema`(db_path Set)로 **원격 DB당 정확히 1회만** WARN 로그(재인덱싱 권고). 다회 `resolve()` 호출에도 스팸되지 않음(테스트로 검증).
- **A-3(2) 원격 DB 신뢰 검사** `[DONE]`: `isTrustedRemoteDb()`가 오픈 직후 `PRAGMA user_version`이 정수·`[0, SCHEMA_VERSION+100]` 범위 내인지 + `nodes` 테이블이 `qualified_name` 컬럼과 함께 존재하는지 검사. 불일치(절대값 user_version / nodes 테이블 부재 = crafted file)면 connection을 닫고 해당 원격 DB만 skip(WARN) — 나머지 등록 프로젝트는 정상 해석. `symbolNameCapable` 맵은 `endBatch()`/per-call close/M1 broken-eviction 경로 모두에서 정리(핸들·맵 누수 방지).
- **테스트** (`tests/phase14-2-cross-project.test.ts`, 5건): (1) modern(v3) 원격 심볼 해석 + `EXPLAIN QUERY PLAN`에 SEARCH/`idx_nodes_symbol_name` 확인 + `SCAN nodes` 부재, (2) 글로벌 심볼 probe, (3) corrupt DB(nodes 테이블 부재, user_version=3 스푸핑) skip + good DB 정상 해석, (4) 절대값 user_version(999999999) crafted DB skip, (5) 구버전 폴백 1회 경고. 기존 `phase12-6-commit-b.test.ts`(O-3 배치 캐싱) 회귀 그린.
- **검증**: `npx tsc --noEmit` clean, `npx vitest run` **530/530**(525 → +5).

### A-4(v11). MCP 2025-11-25 task/progress 워크플로 미채택 — A-12 타임아웃은 keepalive로만 완화 **[이월: v10 A-12 후속, P13-8에서 후보 기록만]**
**`src/server/ipc-coordinator.ts:43-67`, `src/server/api-server.ts`(MCP transport)**

장기 작업(`initialize_project`, `backfill_history` 등)은 현재 (a) 도구별 IPC 타임아웃 테이블 + (b) Host→Terminal keepalive ping으로 "끊김"만 방지한다. **진행률/취소가 없다** — 사용자는 대형 리포 첫 인덱싱 중 진행 상황을 알 수 없고 중단도 못 한다. MCP 2025-11-25 stable이 도입한 **task 기반 워크플로(SEP-1686)** 가 이 문제의 표준 해법이다(streamed progress + cancellation). SDK는 이미 1.29.0(2025-11-25 스펙 지원)이라 **채택 기반은 갖춰져 있다**.

**판정**: Phase 14에서 **단계적 채택 검토** — 전면 마이그레이션은 범위가 크므로, 우선 `notifications/progress`(progress token) 송신만 장기 도구에 배선하는 최소 변경을 1차로. 본격 task lifecycle은 그 다음. **테스트**: 장기 도구가 progress 통지를 emit하는지(mock transport).

### A-5(v11). 클러스터링 라벨 전파가 `Math.random()` 비결정적 — 재현 불가·테스트 취약 **[NEW — LOW-MEDIUM]**
**`src/graph/graph-engine.ts:192-196`**

`const order = [...nodes].sort(() => Math.random() - 0.5)` — (1) `Array.sort`의 비교자로 `random()-0.5`를 쓰는 것은 **편향된 셔플**(Fisher-Yates 아님)이고, (2) 시드 없는 난수라 동일 그래프에 대해 매 실행 클러스터 결과가 달라진다. 주석에 "by design, acceptable for exploratory"라 명시돼 있어 의도적이지만, `get_hotspots`/`propose_refactor`가 클러스터를 참조하므로 **다운스트림 출력이 비결정적**이고 회귀 테스트가 스냅샷을 잡기 어렵다.

**수정 권고**: 선택적 시드 PRNG(`CYNAPX_CLUSTER_SEED` env 또는 인자)를 받아 결정성을 옵션화하고, 셔플은 Fisher-Yates로 교체. 기본 동작은 유지(비결정). **테스트**: 시드 고정 시 동일 입력→동일 클러스터.

---

## 4. 최적화 (LOW)

| # | 위치 | 내용 |
|---|------|------|
| O-1(v11) | `src/indexer/cross-project-resolver.ts:100` | A-3(v11)의 LIKE 풀스캔 — indexed probe 전환(A-3에 흡수) **[DONE — Phase 14-2]** |
| O-2(v11) | `package.json` overrides | tree-sitter-* 일부가 여전히 `^0.23/0.24` (tree-sitter-typescript 0.23.2, rust 0.24.0) — 코어 0.25.0과 메이저 정렬 점검. override로 0.25 강제 중이나 grammar 패키지 자체 마이너 업그레이드 여지(기능 변화 없으면 LOW) |
| O-3(v11) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환(v8→v10 이월). **성능 문제 미관측, verdict: 계속 보류.** 메시지가 작고(주로 메타데이터) round-trip이 빈번하지 않아 직렬화가 병목이 아님. 기록만 유지 |
| O-4(v11) | `src/graph/graph-engine.ts:196` | 편향 셔플(`sort(()=>random-0.5)`) → Fisher-Yates (A-5에 흡수) |
| O-5(v11) | `src/indexer/yaml-parser.ts` | js-yaml 전환(A-1에 흡수) — LOW 우선순위지만 견고성 이득 **[DONE — Phase 14-3]** |
| O-6(v11) | CI | `npm audit` 게이트 부재(N-1에 흡수) — 신규 취약점 조기 탐지 인프라 |

---

## 5. 테스트 공백

Phase 13-9에서 5장(v10) 전 공백이 마감됐다(525 테스트, 통합 76 케이스). 이번 사이클의 신규/잔존 공백은 좁다:

| 공백 | 검증해야 할 시나리오 | 관련 항목 | 우선순위 |
|------|---------------------|-----------|----------|
| **의존성 audit 게이트** | override 적용 후 `npm audit --omit=dev` HIGH=0, `npm ls fast-uri`=3.1.1+, transport/native 정상 | N-1 | 높음 |
| **CrossProjectResolver 멀티 프로젝트** | 등록된 외부 DB에서 원격 심볼 해석 + 인덱스 사용 + 손상 DB skip | A-3 | 중간 |
| **클러스터링 결정성** | 시드 고정 시 동일 입력 → 동일 클러스터 / 노드 수 임계 가드 | A-2, A-5 | 중간 |
| **YAML 견고성** | (js-yaml 전환 시) 멀티라인/플로우/앵커 fixture 노드·에지 기대값 | A-1 | 중간 |
| **MCP progress 통지** | (채택 시) 장기 도구가 progress notification emit | A-4 | 낮음 |

기존 테스트 스위트(`tests/`)는 lock 경합, IPC e2e, REST HTTP, 비-TS 메트릭, git 이력 재작성, purge 재초기화, 임베딩 프로토콜을 이미 커버한다 — 회귀 안전망이 두텁다.

---

## 6. 외부 컨텍스트 (웹 조사 — 출처 명시)

### 6.1 의존성 취약점 (신규 — 진단 일자 기준)

- **CVE-2026-6321 — fast-uri path traversal (HIGH)**: `normalize()`/`equal()`가 percent-encoded dot-segment(`%2E%2E`)·구분자(`%2F`)를 정규화 순서 오류로 실제 경로로 취급 → allowlist/prefix 우회. **영향 ≤ 3.1.0, 수정 3.1.1.** Cynapx는 `@modelcontextprotocol/sdk@1.29.0 → ajv@8.18.0 → fast-uri@3.1.0`으로 **간접 노출**(런타임 도달 경로는 없음 — N-1). 출처: [GHSA-q3j6-qgpj-74h6](https://github.com/advisories/GHSA-q3j6-qgpj-74h6), [SentinelOne CVE-2026-6321](https://www.sentinelone.com/vulnerability-database/cve-2026-6321/)
- **`@modelcontextprotocol/sdk@1.29.0` 전이 의존 취약점 묶음**: 업스트림 이슈 [typescript-sdk#2042](https://github.com/modelcontextprotocol/typescript-sdk/issues/2042)가 fast-uri·hono 등 전이 취약점을 추적 중. SDK 자체는 **이미 최신(1.29.0)** 이라 상위 업그레이드로 해소 불가 — `overrides` 또는 SDK 업스트림 패치 대기. 출처: 위 이슈, npm registry(1.29.0 = latest 직접 확인).
- **CVE-2026-25536 — SDK cross-client data leak (shared transport reuse)**: 1.10.0 ≤ v < 1.26.0 영향, 1.26.0 수정. Cynapx 1.29.0 + per-session transport 패턴 → **해당 없음.** 출처: [GLAD CVE-2026-25536](https://advisories.gitlab.com/npm/@modelcontextprotocol/sdk/CVE-2026-25536/)
- **CVE-2026-0621 — SDK UriTemplate ReDoS**: < 1.25.2 영향. Cynapx 1.29.0 → **해당 없음.** 출처: [GLAD CVE-2026-0621](https://advisories.gitlab.com/pkg/npm/@modelcontextprotocol/sdk/CVE-2026-0621/)
- **express-rate-limit**: 직접 의존 8.3.1. 8.5.x가 `ip-address` 전이 취약점 정리 + IPv4-mapped IPv6 rate-limit bypass(CVE-2026-30827, 8.3.0에서 1차 수정)를 반영. Cynapx는 keyGenerator를 `socket.remoteAddress`로 고정해 bypass는 우회하나 **8.5.x 마이너 업그레이드 권고**. 출처: [express-rate-limit v8.5.1 release](https://github.com/express-rate-limit/express-rate-limit/releases/tag/v8.5.1), [CVE-2026-30827](https://advisories.gitlab.com/pkg/npm/express-rate-limit/CVE-2026-30827/)
- **qs DoS (comma-format array stringify)**: `express@4.22.1 → body-parser → qs` 경유 MODERATE. Cynapx가 `qs.stringify({encodeValuesOnly})`를 호출하지 않아 트리거 불가지만 override로 패치 가능. 출처: [GHSA-q8mj-m7cp-5q26](https://github.com/advisories/GHSA-q8mj-m7cp-5q26)
- **better-sqlite3 12.10.0 / SQLite 3.53.1**: CVE-2025-7709(FTS5 OOB) 패치 완료 — 로컬 `sqlite_version()` = **3.53.1** 직접 확인. 신규 SQLite CVE 미발견. **clean.**
- **sqlite-vec 0.1.9**: alpha 탈피 완료(0.1.9 stable). 미해결 공개 취약점 미발견.

### 6.2 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"`(Phase 13-1) + Docker `node:22` 기반 — Node 20 EOL(2026-04-30) 이슈 해소됨. Node 22 LTS는 2027-04 유지보수 종료, Node 24 LTS 전환은 시간 여유 있음(현 시점 불필요). 출처: [endoflife.date/nodejs](https://endoflife.date/nodejs)
- **better-sqlite3 12.x**: Node 22+ prebuild만 — engines와 정합. clean.

### 6.3 MCP 생태계

- **MCP 2025-11-25 stable 채택 여력**: SDK 1.29.0이 이미 해당 스펙 지원. **task/progress 워크플로(SEP-1686)** 가 장기 인덱싱 작업의 정석 — A-4(v11)로 Phase 14 채택 검토. icons 메타데이터·sampling-with-tools 등은 Cynapx UX에 직접적 실익 적음(보류).
- **2026-07-28 차기 스펙 RC** 예고 — 추적만. 출처: [MCP 2025-11-25 changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog)

### 6.4 경쟁/인접 도구 동향

- **codegraph 류(tree-sitter + SQLite + FTS) 카테고리의 table-stakes화**(v10 6.4에서 식별)가 지속. Cynapx의 차별점은 (1) **멀티 언어 메트릭 정확성**(H-5 수정으로 확보), (2) **증분 동기화·lock 단일성의 견고함**(Phase 13으로 확보), (3) **멀티프로세스 보안 IPC**(C-3 수정). 이번 사이클의 경쟁 관점 함의: 기능 추가보다 **공급망 위생·MCP 최신 스펙(task/progress) 채택**이 신뢰성 차별화 축이다.
- **Sourcegraph MCP** 등 SCIP 정밀 인덱싱 상용 기준선은 유지 — Cynapx의 "100% 로컬·격리" 포지션과 직접 경쟁 아님. 출처: [sourcegraph.com/mcp](https://sourcegraph.com/mcp)

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 정밀 재열람에서 신규 결함이 없었다:

- `src/server/ipc-coordinator.ts` — challenge-response 인증·라인 단위 바이트 제한·per-tool 타임아웃·keepalive 모두 견고(C-3/H-8/A-12 수정 검증).
- `src/server/api-server.ts` — 세션 TTL/cap/sweep, timing-safe Bearer, sessionId 마스킹, per-session transport 페어(CVE-2026-25536 무관) 양호.
- `src/utils/lock-manager.ts` — atomic write/heartbeat staleness/nonce 자기 일치 release(H-1/H-2/A-11) 검증.
- `src/db/node-repository.ts`, `database.ts` — UPSERT + recursive_triggers + statement 캐싱 + symbol_name NOCASE 인덱스(A-1/A-4/A-5) 양호.
- `src/indexer/update-pipeline.ts` — BEGIN 이전 히스토리 프리페치(H-4) 검증.
- `src/indexer/embedding-manager.ts` — spawn error 처리·요청 id 상관관계(C-2/A-7) 양호.
- `src/indexer/cross-project-resolver.ts` — 핸들 누수/캐시 무효화 로직 건전(A-3는 *쿼리 효율/신뢰 검사*가 잔여, 핵심 로직은 안전).
- 언어 디스크립터·tree-sitter CC 계산(H-5)·metrics-calculator — 정확.

---

## 8. 권장 수정 순서 (Phase 14 제안 — 상세는 phase14-plan.md)

1. **P14-1**: N-1 공급망 취약점 — `overrides`(fast-uri/qs) + express-rate-limit 8.5.x 업그레이드 + `npm audit` CI 게이트. (보안 최우선, 저위험·고가치)
2. **P14-2**: A-3 CrossProjectResolver 효율·신뢰(indexed probe + 버전 sanity).
3. **P14-3**: A-1 YamlParser → js-yaml 전환(견고성).
4. **P14-4**: A-2/A-5 클러스터링 — 결정성 옵션(시드 PRNG + Fisher-Yates) + 대형 그래프 가드.
5. **P14-5**: A-4 MCP progress 통지 최소 배선(장기 도구) — task 워크플로 1차.

(O-3 MessagePack은 계속 보류, O-5 클러스터링 파티셔닝 본격화는 계속 이연.)
