# Phase 21 작업 계획 — diagnostic-v18 대응

> **작성**: 2026-06-15 / **기준 문서**: `agent_docs/diagnostic-v18.md` (기준 커밋 `e0e66ef`, Phase 20 + Phase 20-1 완료)
> **목표**: diagnostic-v18가 발견한 **무위험 actionable 2건** 을 해소한다. **(1) M-1 v18 — postcss `< 8.5.10` moderate XSS(GHSA-qx2v-qp2m-jg93)가 vitest→vite@8.0.8→postcss@8.5.8 전이 *dev* 의존으로 트리에 진입**(prod `npm audit --omit=dev`는 여전히 0이나 dev 트리 `npm audit`에서 moderate 1건; Cynapx는 CSS/HTML 미처리라 런타임 도달 0). **(2) L-9(docs) — README.md ↔ 실제 피처셋 3곳 격차**(Node ≥20 vs `engines: ">=22"`, `export_graph` 설명이 graphml/dot 누락, REST API 8 라우트 전면 미문서화). 둘 다 prod 코드 동작을 한 줄도 바꾸지 않는다 — (1)은 dev 트리 `overrides` 패치-floor(v17 fast-uri/qs/hono 패턴 동형), (2)는 docs-only다. 계속 보류/이연/추적 항목(L-2~L-8 + L-9 코드 클린업 3건)은 본 계획에서 추적만 갱신하거나 제외하고 기록을 유지한다(4장).
>
> **맥락**: **v15→Phase18(MCP 도구 디스패처 20/20)·v16→Phase19(REST 핸들러 8 분기)·v17→Phase20(FileWatcher 대용량-배치/복구)은 "레지스트리↔테스트↔CI 게이트" 3중 대조를 세 등록 표면으로 확장하며 매 사이클 테스트 격차 1건을 해소했다.** v18은 그 무위험 수확이 L-7(admin CLI)·L-8(worker-pool/migration)에서 소진됐다고 정직하게 판단하고 **진단 각도를 코드 품질·성능·문서·dev 공급망으로 전환**했다 — 그 결과 prod 코드는 steady-state 확인(CRITICAL/HIGH 0, prod audit 0 vulnerabilities, `src/` TODO/FIXME 0건, 핫패스 O(n²)-over-nodes 0[count-first 가드+Fisher-Yates seeded PRNG 직접 재확인], god-module/순환 의존 0)이나, **각도 전환에서 dev 공급망 위생 1건(M-1 v18)과 문서 동기화 1건(L-9 docs)을 새로 포착**했다. 둘 다 무위험·additive다. 코드 클린업 3건(architecture-engine.ts:179 사이클-당 O(E) `edges.find`, update-pipeline `withWriteTransaction` 추출, update-pipeline progress용 `log.error` 오분류)은 prod 코드 변경 수반이라 본 무위험 사이클에 부적합 — L-9에 비-actionable로 추적만 한다. 따라서 Phase 21은 **override 1 서브 페이즈(P21-1) + docs 1 서브 페이즈(P21-2) + 추적 갱신**이며, 예상 **2~3커밋**(diagnostic-v18 + phase21-plan docs 커밋 1 + P21-1 override 커밋 1 + P21-2 docs 커밋 1, 운영 편의상 묶을 수 있음).

---

## 0. 작업 원칙

- 본 계획의 핵심 작업(P21-1·P21-2)은 **prod 코드 동작 무변경**이다 — P21-1은 `package.json` `overrides`(dev 트리 floor)만, P21-2는 `README.md`(docs)만 건드린다. `src/` 프로덕션 코드는 한 줄도 바꾸지 않는다.
- P21-1로 dev 트리 `npm audit` moderate를 0으로 내린다. **prod `npm audit --omit=dev` = 0 vulnerabilities는 본래 baseline이라 불변**(P14-1 audit 게이트 유효). 신규 의존 도입 0(override는 기존 전이 의존의 floor만 상향).
- Phase 종료 시 `npx vitest run` **593 그린**(불변 — override는 dev 빌드 도구 floor라 테스트 결과 무영향), `npx tsc --noEmit` 그린, `npm audit` moderate 0, `npm audit --omit=dev` 0 확인.
- Phase 종료 시 `agent_docs/diagnostic-v18.md`의 M-1 v18 + L-9 docs에 [DONE] 마킹.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.**

---

## 1. 의존성 맵 (작업 순서에 영향을 주는 관계)

```
P21-1 (postcss dev override — package.json overrides 패치-floor)   독립 — dev 트리 위생.
  └─ overrides에 "postcss": "^8.5.10" 추가 (fast-uri/qs/hono 패턴 동형)
        ← postcss 8.5.10+ published(최신 8.5.15), 8.5.x 패치 라인이라 vite@8 호환 안전
  └─ npm install로 lockfile 갱신 → npm audit moderate 0 검증
        ← npm audit --omit=dev는 본래 0(불변), npm audit(dev 포함)이 moderate 0으로 내려감
  └─ npx vitest run 593 그린 재확인 (override는 dev 빌드 도구 floor라 테스트 무영향)

P21-2 (README 동기화 — docs only)   독립 — 코드 무관.
  └─ Node ≥ 20 → ≥ 22 (engines와 일치, README Step 1)
  └─ export_graph 설명에 graphml/dot 포맷 추가 (export-graph.ts:20-58 일치)
  └─ REST API 8 라우트 섹션 신규 (api-server.ts:323-331 일치)
        ← MCP 20 도구·admin 9 명령은 이미 정확 — 변경 불요
```

```
L-2 (Miasma / Phantom Gyp — 캠페인 계속 진행)  ──추적만──→  [캠페인 지속·신규 wave 없음; 매 사이클 in-tree `.claude`/`.cursor`/`.gemini`에 SessionStart 훅/외부 스크립트 끼어듦 점검(현재 `.claude/launch.json` 양성) + binding.gyp 검토 + npm ci lockfile 고정 + npm ls 재대조; Cynapx 도달 0건 불변]
L-3 (MCP stateless/task 마이그레이션)  ──이연──→  [SDK v2 npm 정식 배포(Q3 2026 ~7-28 stable 예고)까지 — alpha는 있으나 npm latest 미배포]
L-4 (IPC MessagePack)                 ──계속 보류──
L-5 (클러스터 본격 파티셔닝)           ──계속 이연──→  [count-first 가드(200k)가 OOM 방어; 임계 초과 모노레포 실측 시]
L-6 (Node 24 tree-sitter 빌드)         ──추적만──→  [node-tree-sitter#268 해소 + Node 24 LTS 전환 시]
L-7 (admin CLI cmd* 게이트 공백)       ──추적만(비-actionable)──→  [admin.ts 핸들러 export 리팩터 시 함께 게이트화]
L-8 (worker-pool/embedding/migration 잔여 분기)  ──추적만(비-actionable)──→  [SCHEMA_VERSION 증분/worker-pool 리팩터 시 함께 게이트화]
L-9 코드 클린업 3건 (architecture-engine.ts:179 edges.find O(E); update-pipeline withWriteTransaction; progress log.error 오분류)  ──추적만(비-actionable)──→  [update-pipeline/architecture-engine 리팩터 시 함께 정리; prod 코드 변경 수반이라 무위험 사이클 부적합]
SCIP export                           ──전략 후보──→  [P18-1(MCP export) + P19-1(REST export) 디딤돌 마련 완료; protobuf 의존 부담으로 즉시 비권장]
```

---

## 2. Phase 21-1: postcss dev override — package.json 패치-floor (M-1 v18) — dev 위생·무위험 [DONE]

**목표**: dev 트리 `npm audit`의 신규 moderate(postcss `< 8.5.10` XSS, GHSA-qx2v-qp2m-jg93)를 v17 fast-uri/qs/hono와 동형의 `overrides` 패치-floor로 해소한다. **prod 코드·동작 무변경(dev 빌드 도구 트리 floor만).**

| 항목 | 파일 | 작업 |
|------|------|------|
| postcss floor 추가 | `package.json` (`overrides`) | 기존 `overrides` 블록(`tree-sitter`/`fast-uri`/`qs`/`hono`)에 `"postcss": "^8.5.10"` 추가. postcss 8.5.10+ published(최신 8.5.15, `npm view` 확인) — 8.5.x 패치 라인이라 vite@8.0.8 peer 호환 안전. |
| lockfile 갱신 | `package-lock.json` | `npm install`로 lockfile 재생성 → 전이 postcss 8.5.8 → ≥8.5.10 승격 확인(`npm why postcss`). |
| audit 검증 | (검증) | `npm audit`(dev 포함) moderate **0**(postcss 해소), `npm audit --omit=dev` **0**(불변). |
| 베이스라인 재확인 | (검증) | `npx vitest run` = **593 그린**(불변 — override는 dev 빌드 도구 floor라 테스트 결과 무영향), `npx tsc --noEmit` 그린. |
| M-1 v18 마킹 | `agent_docs/diagnostic-v18.md` | M-1 v18에 [DONE] + override 추가·audit moderate 0 기록. |

**설계 메모(직접 확인)**:
- 전이 경로: `vitest@4.1.2 → @vitest/mocker/vite@8.0.8 → postcss@8.5.8`(`npm why postcss` — 전부 dev). prod 트리에 postcss 부재(`npm audit --omit=dev` 0).
- 도달성: postcss XSS는 *user-supplied CSS를 HTML `<style>`에 재직렬화*할 때만 트리거. Cynapx는 CSS/HTML 미처리 → **런타임 익스플로잇 경로 0**. 본 작업은 audit 게이트/dev 트리 위생 목적의 floor 못 박기(v13 fast-uri와 동일 본질).
- 패턴: 기존 `overrides`(fast-uri `^3.1.2` = Phase 16-1, qs `^6.15.2`, hono `^4.12.21`)와 정확히 동형. vite/vitest 메이저 업그레이드 불요(8.5.x 패치 floor로 충분 — 메이저 업그레이드는 회귀 표면이 더 큼).

**테스트**:
- `npm audit` moderate 0 + `npm audit --omit=dev` 0(불변)이 1차 검증 산출물.
- `npx vitest run` 593 불변 그린(override가 빌드 동작을 깨지 않음 확인), `npx tsc --noEmit` 그린.

**산출물**: 1개 커밋(`package.json` + `package-lock.json` + diagnostic-v18 [DONE]). **리스크: 매우 낮음**(dev 빌드 도구 트리 floor만, prod 코드·동작·설치본 불변. 최악의 경우 vite peer 충돌이나 8.5.x 패치 라인이라 비현실적).

---

## 3. Phase 21-2: README 동기화 — docs only (L-9 docs) — 무위험 [DONE]

**목표**: README.md ↔ 실제 피처셋의 3곳 격차를 동기화한다. **코드·동작 무변경(docs-only).**

| 항목 | 파일 | 작업 |
|------|------|------|
| Node 버전 정정 | `README.md` (Step 1, ~line 62) | "Prerequisites: Node.js ≥ 20" → "≥ 22"(`package.json engines: ">=22"`·Docker `node:22-bookworm-slim`와 일치). |
| export_graph 포맷 보강 | `README.md` (Refactoring & Export 표, ~line 139) | `export_graph` 설명에 `graphml`·`dot` 포맷 추가(현재 "Mermaid diagram + JSON"만 — 실제 `json`/`graphml`/`dot` 3포맷, export-graph.ts:20-58). 예: "Structural summary in `json`(embedded Mermaid), `graphml`, or `dot`(Graphviz) format". |
| REST API 섹션 신규 | `README.md` (Admin CLI 섹션 인근 신규) | REST API 8 라우트 표 추가(api-server.ts:323-331 일치): `POST /api/symbol/get`, `/api/graph/callers`, `/api/graph/callees`, `/api/analysis/impact`, `/api/analysis/hotspots`, `/api/analysis/tests`, `/api/search/symbols`, `/api/graph/export` + `GET /healthz`. Bearer 인증·rate-limit·OpenAPI(`openapi.ts`)·`--api`/`--api-port` 부트 플래그 언급. |
| MCP/admin 확인 | (검증) | MCP 20 도구(_registry.ts)·admin 9 명령은 README와 정확 일치 — 변경 불요(대조만). |
| L-9 docs 마킹 | `agent_docs/diagnostic-v18.md` | L-9 docs에 [DONE] 마킹(코드 클린업 3건은 추적 유지). |

**설계 메모**:
- README_KR.md/GUIDE_EN.md/GUIDE_KR.md도 동일 격차가 있으면 함께 정정 가능하나, **본 사이클은 README.md(영문 진입점) 정정을 핵심으로 한다** — 다른 docs 정정은 선택(가성비상 README 우선).
- REST API는 진단 일자 기준 8 라우트 + healthz가 등록돼 있고(api-server.ts:323-331 직접 확인) Bearer/rate-limit/OpenAPI가 이미 구현됐으나 README에 전면 부재 — 사용자 노출 가치 있는 피처라 문서화.

**테스트**:
- docs-only라 코드 테스트 무영향. `npx vitest run` 593 불변·`npx tsc --noEmit` 그린(부수 확인).
- README 주장 ↔ 코드 대조가 검증 산출물(Node 버전·export 포맷·REST 라우트 일치).

**산출물**: 1개 커밋(`README.md` + diagnostic-v18 [DONE]). **리스크: 없음**(docs-only).

---

## 4. 보류/이연 항목 판정 (diagnostic-v18 → Phase 21 verdict)

| 항목 | diagnostic-v18 판정 | Phase 21 처리 |
|------|--------------------|---------------|
| **M-1 v18 postcss dev 공급망 위생** | postcss `< 8.5.10` XSS가 vitest 전이 dev 의존 진입, prod 미도달·런타임 도달 0이나 dev 트리 audit 격차 (**verdict: actionable, 무위험 override**) | **P21-1에서 해소** — `overrides "postcss": "^8.5.10"` 추가 |
| **L-9(docs) README 동기화** | Node ≥20 vs ≥22, export_graph graphml/dot 누락, REST API 미문서화 (**verdict: actionable docs, 무위험**) | **P21-2에서 해소** — README 3곳 동기화 |
| **L-9(코드 클린업 3건)** | architecture-engine.ts:179 O(E) `edges.find`, update-pipeline `withWriteTransaction` dedup, progress `log.error` 오분류 — 전부 prod 코드 변경 수반 (**verdict: 비-actionable, 추적만**) | 범위 제외 — update-pipeline/architecture-engine 리팩터 시 함께 정리 후보로 기록 |
| **L-2(v18) Miasma / Phantom Gyp 포스처** | 캠페인 계속 진행 중·신규 wave 없음, Cynapx 트리·in-tree 설정 0건 재대조 (**verdict: 추적만, 도달 0건 불변**) | 추적 상태만 갱신(5장) + binding.gyp 검토·lockfile 고정·`npm ls` + in-tree 에이전트 설정 무결성 점검 |
| **L-3(v18) MCP stateless/task 마이그레이션** | SDK v2 alpha 존재하나 npm 정식 미배포(Q3 ~7-28 stable 예고) (**verdict: 계속 이연, 상태 불변**) | 범위 제외 — SDK v2 npm 배포까지 이연. P15-3 설계 메모가 출발점 |
| **L-4(v18) IPC MessagePack 직렬화** | 성능 문제 미관측 (**verdict: 계속 보류**) | 범위 제외 — 기록만 유지 |
| **L-5(v18) 클러스터링 본격 파티셔닝** | 현실 규모 무해, count-first 가드(200k)가 OOM 방어 (**verdict: 계속 이연**) | 범위 제외 — 100k+ 노드 실측 시 |
| **L-6(v18) Node 24 + tree-sitter 빌드** | node-tree-sitter#268 여전히 open·미해결, Node 24 CI 그린 (**verdict: 추적, 상태 불변**) | 추적 상태만 갱신, 본격 대응은 Node 24 LTS 전환 시 |
| **L-7(v18) admin CLI cmd* 게이트 공백** | `cmd*` 미-export, 프로덕션 리팩터 수반 (**verdict: 추적만, 비-actionable**) | 범위 제외 — admin.ts 핸들러 export 리팩터 시 함께 게이트화 |
| **L-8(v18) worker-pool/embedding/migration 잔여 분기** | 인접 분기 게이트 커버 + 롤백 픽스처/타이밍-flaky 위험 (**verdict: 추적만, 비-actionable**) | 범위 제외 — SCHEMA_VERSION 증분/worker-pool 리팩터 시 함께 게이트화 |
| **SCIP export(전략 후보)** | MCP `export_graph`(P18-1) + REST `/api/graph/export`(P19-1) 디딤돌 마련 완료 (**verdict: 전략 후보, 즉시 비권장**) | 범위 제외 — protobuf 의존 부담으로 즉시 착수 비권장 |

---

## 5. 유지보수 모드 포스처 ("정기 점검" 이월)

P21-1/P21-2 외에는 20 페이즈 이후의 성숙도가 유지되므로, 다음을 정기 점검 항목으로 이월한다:

1. **공급망 위생(매 사이클)**: **prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0** 유지(P21-1로 postcss dev 격차 해소 후 dev 트리도 clean). 신규 advisory 시 `overrides`로 패치 floor 못 박기(fast-uri/qs/hono/**postcss** 패턴). **의존 추가 시 binding.gyp 검토**(Miasma/Phantom Gyp) + CI는 `npm ci`(lockfile 고정)만 + 매 사이클 `npm ls`로 컴프로마이즈 패밀리 트리 진입 재대조(현재 0건) + **매 사이클 in-tree `.claude`/`.cursor`/`.gemini` 설정에 SessionStart 훅/외부 `setup.mjs`/원격 스크립트 끼어듦 점검**(현재 `.claude/launch.json` 양성).
2. **MCP SDK v2 npm 배포 모니터링**: npm `latest`가 2.x로 넘어가면(현재 1.29.0, Q3 ~7-28 stable 예고) L-3(stateless transport + task extension 마이그레이션)이 비로소 actionable. 그 전까지 1.29.0 유지가 정답.
3. **런타임 수명주기**: Node 22 LTS(2027-04 종료)·tree-sitter 코어/grammar 신버전·tree-sitter-c-sharp 0.23.6+(ERR_REQUIRE_ASYNC_MODULE 해소) 출현 시 정렬 재검토. Node 24 LTS 전환은 node-tree-sitter#268 해소 후. better-sqlite3 12.10.1은 다음 정기 갱신 시 정렬(비-긴급).
4. **회귀 안전망·문서 위생**: 새 도구/REST 라우트/이벤트 핸들러/포맷 추가 시 디스패처-레벨 또는 supertest/단위-레벨 vitest 케이스를 함께 추가(P18-1→P19-1→P20-1 확장)해 CI 게이트 유지 + **README/GUIDE 동기화 동반**(P21-2 — 피처 추가 시 docs도 함께 갱신). admin CLI(L-7)·worker-pool/migration(L-8)·코드 클린업 3건(L-9)은 핸들러 export/SCHEMA_VERSION 증분/리팩터 시 함께 처리.

---

## 6. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 21-(docs) | diagnostic-v18 + phase21-plan 신규 docs | 1 | 없음 (docs-only) |
| 21-1 **[DONE]** | M-1 v18: `overrides "postcss": "^8.5.10"` 추가 → dev 트리 audit moderate 0 + diagnostic-v18 [DONE] — 593 그린(불변), tsc 그린, prod audit 0(불변) | 1 | 매우 낮음 (dev 빌드 도구 트리 floor만, prod 무변경) |
| 21-2 **[DONE]** | L-9 docs: README 3곳 동기화(Node ≥22, export_graph graphml/dot, REST API 8 라우트) + diagnostic-v18 [DONE] | 1 | 없음 (docs-only) |

**총 2~3개 커밋.** 본 사이클은 **v13~v17의 테스트-격차 각도가 L-7/L-8에서 소진된 지점에서 정직하게 각도를 코드 품질·성능·문서·dev 공급망으로 전환**한 데서 나온다 — prod 코드는 steady-state(CRITICAL/HIGH 0, prod audit 0, TODO 0, 핫패스 quadratic 0, god-module 0) 확인이 핵심 결론이며, 각도 전환에서 무위험 actionable 2건(dev 공급망 floor + README 동기화)을 포착했다. **이번 사이클의 본질은 (1) 5연속 발견 사이클의 무위험 수확 소진을 인정하고 각도 전환 + (2) dev 공급망 위생(postcss floor) + (3) 문서 위생(README 동기화) + (4) 추적 상태 고정(L-9 신규 + Miasma/SDK v2 포스처)**이다. Phase 21 종료 시 `agent_docs/diagnostic-v18.md`의 M-1 v18 + L-9 docs에 [DONE] 마킹.

---

## 7. 향후 후보 (Phase 21 범위 밖 — 기록 유지)

- **MCP transport v2 마이그레이션**: SDK v2 stable(Q3 2026 ~7-28 예고, alpha는 npm 정식 미배포) + spec final 후 — stateless transport(session-id 제거) + task extension 전면 채택. L-3 + P15-3 설계 메모가 출발점. **트리거: npm `latest`가 2.x로 전환.**
- **SCIP export**: `export_graph`(+ REST `/api/graph/export`)에 SCIP 포맷 추가 — Sourcegraph/SCIP 생태계 상호운용. **선행 조건: P18-1 + P19-1 디딤돌 마련 완료.** protobuf 빌드 의존 + install-time 공급망 표면 확대 우려로 즉시 비권장.
- **코드 클린업 3건(L-9)**: architecture-engine.ts:179 `edges.find` → `Map` O(1)화(~5줄), update-pipeline `withWriteTransaction()` 추출(~40줄 dedup), update-pipeline progress `log.error` → `info`/`debug` 재분류 + 빈 catch(embedding-manager.ts:184, api-server.ts:625)에 `log.debug` 추가. update-pipeline/architecture-engine 리팩터 페이즈로 묶어 처리(prod 코드 변경 수반이라 무위험 사이클 부적합).
- **bootstrap 엔트리 게이트화**: `process.exit`/시그널/IPC 광범위 모킹 또는 엔트리 분해 리팩터 수반 — 별도 리팩터 페이즈로(의존 프리미티브는 이미 게이트 커버).
- **admin CLI 게이트화(L-7)**: `admin.ts`의 `cmd*` 핸들러 export 분리 리팩터 동반 시 status/list/inspect/doctor 등 비-파괴 명령부터 vitest 게이트 추가.
- **worker-pool/embedding/migration 게이트화(L-8)**: SCHEMA_VERSION 증분(롤백 픽스처 인프라 동반) 또는 worker-pool 리팩터 시 함께. A-7은 fake-timer flaky 위험으로 신중히.
- **L-4 IPC MessagePack**: 성능 실측에서 IPC 직렬화가 병목으로 드러날 때 재검토(현재 미관측).
- **L-5 클러스터링 서브그래프 파티셔닝**: 100k+ 노드 모노레포 실측 시 — 파일/디렉터리 경계 기반. count-first 가드(200k)가 그때까지 OOM 방어.
- **Node 24 LTS 전환**: tree-sitter 0.25.x prebuild 가용성 + C++20 빌드 환경 확정 후(node-tree-sitter#268 해소 추적).
- **tree-sitter-c-sharp 0.23.6+ / better-sqlite3 정렬**: 신버전 출현·다음 정기 의존성 갱신 시.
- **README_KR/GUIDE 동기화**: P21-2가 README.md(영문 진입점)를 정정하면, 동일 격차가 있는 README_KR.md/GUIDE_EN.md/GUIDE_KR.md도 다음 docs 사이클에 정렬.
