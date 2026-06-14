# Phase 14 작업 계획 — diagnostic-v11 대응

> **작성**: 2026-06-14 / **기준 문서**: `agent_docs/diagnostic-v11.md` (기준 커밋 `b489199`, Phase 13 완료)
> **목표**: diagnostic-v11이 식별한 HIGH 1건(N-1 공급망 취약점), MEDIUM 5건(A-1~A-5 v11), LOW 6건(O-1~O-6 v11)을 의존성·리스크 기준으로 P14-1 ~ P14-5의 5개 서브 Phase로 순서화하여 해소한다. 계속 보류 판정된 항목(O-3 IPC MessagePack, O-5 클러스터링 본격 파티셔닝)은 본 계획에서 제외하고 기록만 유지한다(7장).
>
> **맥락**: 13개 페이즈의 하드닝 이후 **코드 자체의 CRITICAL/HIGH 신규 결함은 0**이다. 이번 사이클의 최상위 항목은 외부에서 유입된 **공급망 취약점**(MCP SDK 전이 의존의 fast-uri HIGH 등)이며, 그 다음이 이전에 의도적으로 보류된 항목들의 단계적 정리다. 따라서 전체 리스크 프로파일은 Phase 13보다 현저히 낮고, 작업량도 작다(예상 5~8 커밋).

---

## 0. 작업 원칙

- 각 서브 Phase는 **독립적으로 커밋 가능한 단위**로 쪼갠다 (한 Phase = 1~2개 PR급 커밋).
- 보안/공급망 항목(N-1)은 **`npm audit --omit=dev` 결과 + `npm ls`로 해소를 객관 검증**한 뒤에만 완료로 본다.
- 동작 변경(파서 교체·클러스터링 결정성)은 **출력 동등성 또는 명시적 기대값 회귀 테스트**를 동반하지 않으면 완료로 보지 않는다.
- 파일/모듈이 겹치는 항목은 같은 Phase에 묶는다(A-2/A-5는 graph-engine.ts 공유 → 동거).
- 매 Phase 종료 시 `npm test` + `npx tsc --noEmit` 그린 확인 후 커밋. 통합 스크립트(`scripts/integration-test.js`)는 P14-2(원격 해석)·P14-5(progress) 종료 시 추가 확인.
- 매 Phase 종료 시 `agent_docs/diagnostic-v11.md`에 [DONE] 마킹.

---

## 1. 의존성 맵 (작업 순서에 영향을 주는 관계)

```
P14-1 (overrides / dep 업그레이드)  ──→  P14-5 (MCP progress)   SDK 전이 의존 정리가 끝난 뒤 SDK 신기능을 건드리는 게 안전
N-1 (npm audit 게이트)              독립 — 가장 먼저(저위험·고가치, 다른 작업의 회귀 안전망이 됨)
A-3 (CrossProjectResolver)          독립 (cross-project-resolver.ts 단일 파일)
A-1 (YamlParser → js-yaml)          독립 (yaml-parser.ts + 신규 의존 js-yaml) — P14-1의 audit 게이트 통과 필요(신규 의존 추가)
A-2/A-5 (클러스터링 가드+결정성)    같은 파일(graph-engine.ts) 동거 — 1 Phase
A-4 (MCP progress)                  P14-1 이후 (SDK 전이 의존 안정화 후), 가장 큰 미지수 → 마지막
```

순서 유연성: P14-2(A-3)·P14-3(A-1)·P14-4(A-2/A-5)는 서로 독립이라 순서 교환 가능. 단 **P14-1은 반드시 선행**(신규 의존 추가 시 audit 기준선이 필요하고, 다른 Phase의 빌드/테스트가 깨끗한 audit 위에서 돌아야 함).

---

## 2. Phase 14-1: 공급망 취약점 해소 + npm audit CI 게이트 (N-1) — 보안 최우선 **[DONE]**

**목표**: `@modelcontextprotocol/sdk@1.29.0` 전이 의존이 끌어오는 fast-uri HIGH(CVE-2026-6321) 외 6건의 audit 경고를 `overrides` + 직접 의존 마이너 업그레이드로 해소하고, 회귀 방지용 CI audit 게이트를 도입한다. 변경 대상이 메타 파일(package.json/lockfile)과 CI라 런타임 코드 리스크가 가장 낮고 가치가 가장 크다.

| 항목 | 파일 | 작업 |
|------|------|------|
| N-1(1) fast-uri HIGH | `package.json` overrides | `"fast-uri": "^3.1.1"` override 추가 (ajv 경유 전이를 패치 버전으로 강제). 기존 tree-sitter override 패턴과 동일 방식. |
| N-1(2) qs DoS | `package.json` overrides | `"qs"` 패치 버전 override (express 4 / SDK express 5 양쪽 경유 해소). |
| N-1(3) ip-address XSS | `package.json` 직접 의존 | `express-rate-limit` `^8.3.1` → **`^8.5.x`** 마이너 업그레이드 (ip-address 전이 정리 + IPv6 bypass 반영). keyGenerator(`api-server.ts:118,123`)는 그대로 유지. |
| N-1(4) hono / express5 (SDK 전이) | (조치 보류 + 문서화) | Cynapx 런타임 미사용(자체 express@4 사용). override로 강제 패치가 가능하면 적용, 불가/위험하면 **도달 불가 근거를 주석/문서로 명시**(SDK 업스트림 typescript-sdk#2042 추적 링크). |
| N-1(5) CI audit 게이트 | `.github/workflows/ci.yml` (또는 신규 step) | `npm audit --omit=dev --audit-level=high` 단계 추가(또는 `audit-ci`). override 적용 후 HIGH=0을 기준선으로 고정. **주의: `.github/workflows/cynapx-autonomous.yml`은 건드리지 않는다.** |

**테스트**:
- `npm ls fast-uri`가 **3.1.1+** 만 보이는지(이전 3.1.0 제거 확인).
- `npm audit --omit=dev`의 **HIGH = 0** (MODERATE는 도달 불가 근거와 함께 허용 가능, 가능한 한 0 목표).
- `npm test` 전체 그린 + 기존 `tests/api-server-http.test.ts`/`api-server-security.test.ts` 그린(rate-limit 8.5.x·transport 정상 동작 회귀).
- `npm run build && node scripts/integration-test.js` — native 바인딩·transport 정상.

**산출물**: 1~2개 커밋 (overrides+lockfile / CI 게이트). **리스크: 낮음** (메타·CI 변경. 단 lockfile 재생성 후 native 모듈 재빌드 확인 필요).

---

## 3. Phase 14-2: CrossProjectResolver 효율·신뢰 (A-3 v11) **[DONE]**

**목표**: 원격 프로젝트 DB 쿼리의 leading-wildcard LIKE 풀스캔을 indexed equality probe로 전환하고, 원격 DB 오픈 시 버전/스키마 sanity 체크를 추가한다.

| 항목 | 파일 | 작업 |
|------|------|------|
| A-3(1) LIKE 풀스캔 | `src/indexer/cross-project-resolver.ts:99-102` | 원격 쿼리를 `symbol_name` indexed equality probe로 전환. **원격 스키마에 `symbol_name` 컬럼이 있는지(스키마 버전 의존) 먼저 검사** — 있으면 indexed probe, 없으면 기존 LIKE 폴백 + 1회 경고 로그. (로컬 v10 A-4 패턴 재사용.) |
| A-3(2) 원격 DB 신뢰 | `src/indexer/cross-project-resolver.ts:66-77` | `openRemoteDb()` 직후 `PRAGMA user_version`/`sqlite_version()` sanity 체크 — 스키마 버전 불일치/예상 외 값이면 skip + 경고. (crafted DB file 표면 축소.) |

**테스트**:
- 멀티 프로젝트 fixture(`tests/fixtures/`)에 2개 이상 등록 프로젝트 DB 구성 → 원격 심볼 해석 성공 + `EXPLAIN QUERY PLAN`에 **SEARCH(인덱스 사용)** 확인.
- 손상/구버전 스키마 원격 DB가 skip되고 나머지는 정상 해석되는지.
- 기존 `tests/` 회귀 그린.

**산출물**: 1개 커밋. **리스크: 낮음** (단일 파일, 폴백 경로 보존).

**해소 결과 [DONE]**: `isTrustedRemoteDb()`(A-3(2): `user_version` 범위 + `nodes` 테이블 sanity, 불일치 시 skip+WARN) + `symbolNameCapable` 캐싱 후 capable이면 `symbol_name = ? COLLATE NOCASE` 단일 indexed probe(`idx_nodes_symbol_name`), 미보유 시 LIKE 폴백 + db_path당 1회 경고. 테스트 `tests/phase14-2-cross-project.test.ts`(5건, EXPLAIN QUERY PLAN SEARCH 확인/corrupt·crafted DB skip/1회 경고). `npx tsc --noEmit` clean, `npx vitest run` 530/530.

---

## 4. Phase 14-3: YamlParser → js-yaml 전환 (A-1 v11) **[DONE]**

**목표**: 수제 라인 파싱을 실제 YAML 트리 순회로 교체해 멀티라인/플로우/앵커/탭 들여쓰기 케이스를 견고하게 처리한다.

| 항목 | 파일 | 작업 |
|------|------|------|
| A-1(1) js-yaml 의존 | `package.json` | `js-yaml` + `@types/js-yaml` 추가(dev/prod 분류 주의 — 파서는 런타임이므로 prod). 추가 직후 `npm audit`로 신규 취약점 없음 확인(P14-1 게이트 통과). |
| A-1(2) 파서 재작성 | `src/indexer/yaml-parser.ts:17-94` | `yaml.load()`로 문서 파싱 → 트리 순회로 top-level key + `jobs.<id>` 노드/에지 추출. 파싱 실패(YAMLException)는 파일 노드만 생성하고 graceful 강등(현 동작과 동일하게 throw하지 않음). 라인 번호는 js-yaml의 `listener`/AST 또는 `JSON_SCHEMA` 매핑으로 보존(가능 범위 내). |
| A-1(3) 범위 확장(선택) | `src/indexer/yaml-parser.ts` | reusable workflow(`jobs.<id>.uses`) 에지 등 — 범위 넓히면 별도 작업, 최소 변경은 현 노드 셋 동등 유지. |

**테스트**:
- `tests/metadata-parsers.test.ts`(또는 신규)에 fixture 추가: 멀티라인 스칼라(`|`/`>`), 플로우 jobs(`jobs: {build: ...}`), 앵커/별칭, 탭 들여쓰기 → 기존 라인 파서가 놓치던 케이스의 노드·에지 기대값.
- **동등성 회귀**: 기존 단순 워크플로 fixture에서 노드/에지가 변경 전과 동일한지(회귀 방지).
- 파싱 실패 YAML이 throw 없이 파일 노드만 생성하는지.

**산출물**: 1개 커밋. **리스크: 낮음-중간** (출력 동등성 회귀로 다운스트림 영향 차단 필요).

**해소 결과 [DONE]**: `js-yaml`(prod) + `@types/js-yaml`(dev) 추가, `npm audit --omit=dev` 0 vulnerabilities 유지. `yaml.load()` 트리 파싱 + 순회로 재작성 — top-level key/`jobs.<id>` 노드·`contains` 에지 동등 유지, 플로우/블록 스칼라/앵커 견고 처리, YAMLException(탭 들여쓰기 포함) graceful 강등(파일 노드만). `listener`로 라인 번호 보존(simple fixture 라인 동등). A-1(3): `jobs.<id>.uses` → `calls` 에지 추가(동등성 무영향). 테스트 +8건(`tests/metadata-parsers.test.ts`), `npx tsc --noEmit` clean, `npx vitest run` **538/538**.

---

## 5. Phase 14-4: 클러스터링 가드 + 결정성 (A-2, A-5 v11) **[DONE]**

**목표**: 대형 그래프 방어 가드와 결정적(시드) 클러스터링 옵션을 추가한다. 두 항목 모두 `graph-engine.ts` 단일 파일이라 동거.

| 항목 | 파일 | 작업 |
|------|------|------|
| A-5(1) 편향 셔플 | `src/graph/graph-engine.ts:196` | `[...nodes].sort(() => Math.random() - 0.5)` → **Fisher-Yates 셔플**로 교체(편향 제거). |
| A-5(2) 결정성 옵션 | `src/graph/graph-engine.ts:189-196` | 선택적 시드 PRNG(예: `CYNAPX_CLUSTER_SEED` env 또는 메서드 인자) 도입 — 시드 제공 시 결정적, 미제공 시 기존 비결정 동작 유지. |
| A-2(1) 대형 그래프 가드 | `src/graph/graph-engine.ts:168-172` | 노드 수가 임계치(예: `CYNAPX_CLUSTER_MAX_NODES`, 기본 200k) 초과 시 경고 로그 + clustering skip(또는 샘플링) — RSS 폭증 방어. 본격 파티셔닝은 계속 이연(O-5). |

**테스트**:
- 시드 고정 시 동일 입력 그래프 → **동일 클러스터 결과**(`clusterCount` + 노드별 `cluster_id` 일치). `tests/clustering.test.ts` 확장.
- Fisher-Yates 셔플이 모든 원소를 보존하는지(길이/집합 불변).
- 임계 초과 그래프(소형으로 임계 env를 낮춰 시뮬레이션)에서 skip + 경고.
- 기존 클러스터링 테스트 그린(기본 동작 불변).

**산출물**: 1개 커밋. **리스크: 낮음** (단일 파일, 기본 동작 보존, 결정성은 opt-in).

**해소 결과 [DONE]** (`src/graph/graph-engine.ts`): A-5(1) 편향 셔플 → export된 `fisherYatesShuffle()`(in-place Knuth, `rng` 주입). A-5(2) `CYNAPX_CLUSTER_SEED` 설정 시 `mulberry32()` seeded PRNG로 결정적 클러스터링, 미설정 시 `Math.random`(기존 비결정 유지). A-2(1) `CYNAPX_CLUSTER_MAX_NODES`(기본 200k) 초과 시 `log.warn` + clustering skip(short-circuit) — 본격 파티셔닝 O-5 계속 이연. 테스트 +7건(`tests/clustering.test.ts`: 시드 결정성/셔플 집합 보존/대형 그래프 가드). `npx tsc --noEmit` clean, `npx vitest run` **545/545**.

---

## 6. Phase 14-5: MCP progress 통지 최소 배선 (A-4 v11) — task 워크플로 1차 **[DONE]**

**목표**: 장기 실행 도구(`initialize_project`, `backfill_history`, `re_tag_project`, `check_consistency`)가 MCP `notifications/progress`로 진행률을 emit하도록 최소 배선한다. 본격 task lifecycle(SEP-1686) 전면 마이그레이션은 범위가 크므로 후속 Phase 후보로 유지하고, 이번엔 progress token 송신만.

| 항목 | 파일 | 작업 |
|------|------|------|
| A-4(1) progress 송신 | `src/server/tool-dispatcher.ts`, `src/server/tools/initialize-project.ts` 외 장기 도구 | SDK 1.29.0의 progress notification API로 진행 단계(스캔/파싱/임베딩 등)별 `notifications/progress` emit. progress token이 요청에 포함된 경우에만 송신(스펙 준수). |
| A-4(2) IPC 경유 진행률(선택) | `src/server/ipc-coordinator.ts` | Terminal→Host IPC에서도 progress를 중계할지 검토 — 복잡도 높으면 이번 범위 제외(keepalive ping으로 충분, 후속 후보). |
| A-4(3) 문서/주석 | `src/server/ipc-coordinator.ts:43-46` | 기존 "future direction" 주석을 1차 progress 배선 완료로 갱신, task lifecycle 전면 채택은 후속 명시. |

**테스트**:
- mock transport로 장기 도구 실행 시 progress token 제공 시 `notifications/progress`가 emit되는지, 미제공 시 emit 안 되는지(스펙 준수).
- 기존 도구 출력(결과 payload)은 불변인지 회귀.
- 통합 스크립트에서 `initialize_project`가 정상 완료되는지(progress 배선이 결과를 깨지 않음).

**산출물**: 1~2개 커밋. **리스크: 중간** (SDK API 표면 의존 — 미지수가 가장 큼. 범위를 progress 송신으로 한정해 통제).

**해소 결과 [DONE]**:
- **A-4(1) progress 송신** `[DONE]`: SDK 1.29.0 확인 — progress는 요청 `params._meta.progressToken`(opt-in) + 핸들러 `extra.sendNotification`(`notifications/progress`) 구조. 신규 `src/server/tools/_progress.ts`(`createProgressReporter`/`NOOP_PROGRESS`/`ProgressReporter`)로 token 미존재 시 no-op(스펙 준수). `ToolHandler.execute(args, deps, progress?)` 옵셔널 주입(기존 핸들러 무영향). `tool-dispatcher.ts`의 `CallToolRequest` 핸들러가 `_meta.progressToken`을 도출해 reporter 생성, 4개 장기 도구(`initialize_project`/`backfill_history`/`re_tag_project`/`check_consistency`)가 단계 경계에서 coarse progress emit. **결과 payload 불변**.
- **A-4(2) IPC 경유 진행률** `[SKIP — 후속]`: Host↔Terminal IPC는 `id` 상관 request/response 프레이밍 → progress 라인 demux + back-correlation 필요. 보안 민감 계층 복잡도 과다로 이번 범위 제외, keepalive(A-12)로 충분. 후속 후보로 명시.
- **A-4(3) 문서/주석** `[DONE]`: `ipc-coordinator.ts:43-46` 주석을 1차 progress 배선 완료 + A-4(2) skip 사유 + SEP-1686 전면 task lifecycle/IPC relay 후속 명시로 갱신.
- **테스트** (`tests/phase14-5-progress.test.ts`, +13건): reporter 단위(no-op/emit/숫자 token/오류 swallow), `executeTool` 장기 도구 token 유/무 emit 분기, payload byte 동등, `initialize_project` 단조 progress(total=4), `CallToolRequest`→`_meta.progressToken`→`sendNotification` 라우팅.
- **검증**: `npx tsc --noEmit` clean, `npx vitest run` **558/558**(545 → +13), `npm run build && node scripts/integration-test.js` **76/76**(Docker skip).

---

## 7. 보류/이연 항목 판정 (diagnostic-v11 → Phase 14 verdict)

| 항목 | diagnostic-v11 판정 | Phase 14 처리 |
|------|--------------------|---------------|
| **O-3(v11) IPC MessagePack 직렬화** | 성능 문제 미관측, 메시지 작고 round-trip 드묾 (**verdict: 계속 보류**) | 범위 제외 — 기록만 유지 |
| **O-5(v11)/A-2 클러스터링 본격 파티셔닝** | 현실 규모 무해, 파티셔닝은 클러스터 품질 트레이드오프 (**verdict: 본격화 이연**) | **가드만 P14-4** 채택(임계 스킵), 파티셔닝은 100k+ 노드 실측 시 재검토 |
| **A-4 MCP task lifecycle 전면 마이그레이션** | progress 통지가 우선 실익 (**verdict: 단계 채택**) | **progress 송신만 P14-5**, 전면 task lifecycle은 후속 Phase 후보 |
| **A-1 YamlParser → js-yaml** | 견고성 이득, 의존 가벼움 (**verdict: 채택**) | **P14-3** |

---

## 8. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 14-1 | N-1 공급망(overrides+express-rate-limit 8.5.x) + npm audit CI 게이트 | 1~2 | 낮음 (메타/CI) |
| 14-2 | A-3 CrossProjectResolver indexed probe + 원격 DB sanity | 1 | 낮음 |
| 14-3 | A-1 YamlParser → js-yaml | 1 | 낮음-중간 (출력 동등성) |
| 14-4 | A-2/A-5 클러스터링 가드 + 결정성(시드 PRNG + Fisher-Yates) | 1 | 낮음 |
| 14-5 | A-4 MCP progress 통지 최소 배선 | 1~2 | 중간 (SDK API 표면) |

**총 5~7개 커밋**, P14-1 선행(공급망 안정화) 후 P14-2~P14-4는 순서 유연, P14-5는 마지막(SDK 의존 미지수). 각 Phase 종료 시 `agent_docs/diagnostic-v11.md`에 [DONE] 마킹. Phase 13 대비 **CRITICAL/HIGH 코드 결함 0** 이라 전체 리스크·작업량 모두 현저히 낮다 — 이번 사이클의 본질은 **공급망 위생 + 보류 부채 정리 + MCP 최신 스펙 1차 채택**이다.

---

## 8.5. Phase 14 전체 완료

**Phase 14-1 ~ 14-5 전부 [DONE]** — diagnostic-v11의 MEDIUM(A) 항목을 해소 완료했다:
- **P14-1 (N-1 공급망)**: `overrides`(fast-uri/qs 전이 취약점) + `express-rate-limit` 8.5.x 업그레이드 + `npm audit --omit=dev` CI 게이트 도입.
- **P14-2 (A-3 CrossProjectResolver)**: 원격 심볼 해석을 `symbol_name` indexed equality probe로 전환(구버전 스키마는 LIKE 폴백 + 원격 DB당 1회 경고), 원격 DB 오픈 시 버전/스키마 sanity 체크.
- **P14-3 (A-1 YamlParser → js-yaml)**: 자작 YAML 파서를 `js-yaml`로 교체(견고성·출력 동등성 검증).
- **P14-4 (A-2/A-5 클러스터링)**: 편향 셔플 → Fisher-Yates, `CYNAPX_CLUSTER_SEED` seeded PRNG로 결정성 옵션화, `CYNAPX_CLUSTER_MAX_NODES` 대형 그래프 가드.
- **P14-5 (A-4 MCP progress)**: 장기 도구 4종에 `notifications/progress` 최소 배선(progress token opt-in, 미제공 시 미송신). IPC 경유 relay(A-4(2))와 전면 task lifecycle(SEP-1686)은 후속 후보로 명시.

**최종 상태**: `npx vitest run` **558/558**, `npx tsc --noEmit` 그린, `npm audit --omit=dev` 0 취약점, `node scripts/integration-test.js` **76/76**(Docker 데몬 부재 시 graceful SKIP).

**잔여 이연 항목 (향후 후보)**: O-3 IPC MessagePack 직렬화(성능 문제 미관측, 계속 보류), O-5/A-2 클러스터링 본격 파티셔닝(100k+ 노드 실측 시 재검토), A-4 MCP 전면 task lifecycle(SEP-1686: streamed progress + cancellation/resumption) 및 Host↔Terminal IPC progress relay.
