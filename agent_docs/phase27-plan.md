# Phase 27 작업 계획 — diagnostic-v24 대응

> **작성**: 2026-06-15 / **기준 문서**: `agent_docs/diagnostic-v24.md` (기준 커밋 `473acf8`, Phase 26 + Phase 26-1/26-2 완료 + vite `^8.0.16` dev-bump)
> **목표**: diagnostic-v24가 발견한 **무위험 actionable 2건(M-1 v24, M-2 v24)** 을 해소한다. **M-1 v24**: `src/server/tools/_utils.ts`의 순수 함수 `escapeXml`(51-53줄)·`escapeDot`(55-57줄)은 라이브 MCP 도구 `export_graph`의 graphml/dot 포맷 뒤에서 노드/엣지 식별자를 이스케이프하나 *escape 동작 자체에 대한 단위 테스트가 0건*(`export_graph` 디스패처 테스트는 구조 토큰만 단언, 특수문자 픽스처 부재) → P26-1이 신설한 `tests/_utils.test.ts`에 `import { escapeXml, escapeDot }` 후 결정적 게이트 추가(테스트-only, prod 코드 무변경). 이로써 `_utils.ts`의 3개 export 순수 함수(mergeResultsRRF·escapeXml·escapeDot) 100% 커버. **M-2 v24**: `better-sqlite3` lockfile이 `12.10.0`인데 `npm outdated` Wanted/Latest가 v23 시점 `12.10.1`(patch)에서 본 사이클 `12.11.1`(minor)로 드리프트 확대 → clean한 minor bump(직접 CVE 0, 기능-only, semver-호환 핀 `^12.0.0` 무변경)이므로 lockfile-only 정렬. 두 건은 *서로 독립*(다른 부류 — 테스트 게이트 vs 의존성 위생)이나 둘 다 작고(M-1 테스트-only, M-2 lockfile-only) 리스크가 매우 낮아 한 사이클에 함께 처리 가능하다. 계속 보류/이연/추적 항목(L-2~L-9, L-13, L-14)은 추적만 갱신하고 L-15(vite)는 이미 해소다(4장).
>
> **맥락**: v22는 graph/ 엔진 처방 5종 진입 로직을, v23은 핸들러 보조 핵심 순수 로직(`mergeResultsRRF`, P26-1)과 `qualified_name` 10개 핸들러 strict 가드(P26-2)를 전수 게이트/정렬했다. v24는 *그 마지막 잔여*를 두 각도로 찾았다 — (1) `_utils.ts`에 남은 마지막 export 순수 함수 `escapeXml`/`escapeDot`(v23이 "단순 치환, 추적만"으로 남겼으나 escapeXml의 `&`-우선 순서는 *이중-이스케이프 회피 정합성 속성*이고 `export_graph` 디스패처 테스트가 특수문자를 전혀 투입하지 않아 escape 동작 0% 커버)이고, P26-1이 *같은 파일에 `tests/_utils.test.ts`를 이미 신설*한 지금 그 파일에 import만 추가하면 가장 가벼운 게이트(M-1 v24); (2) v23이 "다음 의존성 정렬 사이클 actionable 후보"로 예고한 L-11(better-sqlite3 lockfile)이 본 사이클 드리프트가 minor로 확대돼 lockfile-only 정렬로 승격(M-2 v24). 둘 다 prod 코드 0줄 변경(M-1 테스트-only, M-2 lockfile-only)이라 리스크가 매우 낮다. 따라서 Phase 27은 **escapeXml/escapeDot 게이트(P27-1) + better-sqlite3 lockfile 정렬(P27-2) + 추적 갱신**이며, 예상 **2~3커밋**(diagnostic-v24 + phase27-plan docs 커밋 1 + P27-1 커밋 1 + P27-2 커밋 1, 또는 합본).

---

## 0. 작업 원칙

- P27-1은 **prod 코드 무변경**(테스트-only) — `escapeXml`/`escapeDot`은 `src/server/tools/_utils.ts:51-57`에서 export된 순수 함수로, 문자열 in → 문자열 out·DB·async·side-effect 의존 0. P26-1이 신설한 `tests/_utils.test.ts`에 `import { escapeXml, escapeDot } from '../src/server/tools/_utils.js'` 후 문자열 리터럴만 넣어 결정적 단언 가능.
- P27-2는 **prod 코드·`package.json` 무변경**(lockfile-only) — `npm i better-sqlite3@12.11.1`(또는 `npm update better-sqlite3`)로 `package-lock.json`의 better-sqlite3 엔트리만 12.10.0→12.11.1 갱신. 핀은 이미 `^12.0.0`(semver-호환)이라 `package.json`은 건드리지 않는다. better-sqlite3는 native 모듈이므로 prebuild 재설치 후 `npm rebuild` 또는 `npm ci`-동등 상태로 642 그린·tsc 그린·audit 0/0 재확인.
- Phase 종료 시(P27-1·P27-2) `npx vitest run` **642 + 신규 케이스 그린**, `npx tsc --noEmit` 그린, `npm audit` 0, `npm audit --omit=dev` 0 확인.
- Phase 종료 시 `agent_docs/diagnostic-v24.md`의 M-1 v24·M-2 v24에 `[DONE]` 마킹.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.** (`.git/info/exclude`에 이미 등록 — `git status --short`는 항상 깨끗해야 한다.)
- 한 사이클(1~2 항목) 제한 원칙에 따라, **P27-1·P27-2는 둘 다 작고(테스트-only / lockfile-only) 리스크가 낮아 한 작업 단위로 묶거나 2커밋으로 나눠도 무방**. 둘은 서로 독립(다른 부류)이라 순서 무관.

---

## 1. 의존성 맵

```
P27-1 (escapeXml/escapeDot escape 동작 게이트 — 테스트-only)   독립.
  └─ tests/_utils.test.ts (P26-1 신설 파일에 describe 블록 추가)
        ← import { escapeXml, escapeDot } from '../src/server/tools/_utils.js'
        ← 문자열 리터럴만으로 결정적 단언(특수문자 치환·`&`-우선 순서·전역 치환·무특수문자 무변경)
        ← prod 코드 무변경

P27-2 (better-sqlite3 lockfile 12.10.0 → 12.11.1 정렬 — lockfile-only)   독립.
  └─ npm i better-sqlite3@12.11.1 (또는 npm update better-sqlite3)
  └─ package-lock.json better-sqlite3 엔트리만 갱신 (package.json 핀 ^12.0.0 무변경)
  └─ 재빌드 + npx vitest run 642 그린 + tsc 그린 + npm audit 0/0 재확인
```

```
L-2 (Miasma / Phantom Gyp / Node-gyp)    ──추적만──→  [`npm ls` + in-tree 에이전트 설정 무결성 재대조; 도달 0건 불변]
L-3 (MCP stateless/task 마이그레이션)     ──이연──→  [SDK v2 여전히 pre-alpha; sdk 1.29.0 불변; stable Q3 2026 전환까지]
L-4 (IPC MessagePack)                     ──계속 보류──
L-5 (클러스터 본격 파티셔닝)               ──계속 이연──→  [100k+ 노드 실측 시]
L-6 (Node 24 tree-sitter 빌드)            ──추적만──→  [node-tree-sitter#268 해소 + Node 24 LTS 전환 시]
L-7 (admin CLI cmd* 게이트 공백)           ──추적만(비-actionable)──
L-8 (worker-pool/embedding/migration 잔여)──추적만(비-actionable)──
L-9 (update-pipeline 클린업 잔여)          ──추적만(비-actionable)──
L-11 (better-sqlite3 lockfile)            ──해소-승격 → M-2 v24 (P27-2)──
L-13 (analyze-impact use_cache 무해)       ──추적만(비-actionable)──
L-14 (CVE-2026-25727 time 크레이트, 미도달)──추적만(비-actionable)──
L-15 (vite dev advisory)                  ──해소(473acf8 ^8.0.16 bump)──
```

---

## 2. Phase 27-1: escapeXml/escapeDot escape 동작 게이트 (M-1 v24) [DONE]

**목표**: `src/server/tools/_utils.ts`의 `escapeXml(s)`(51-53줄)·`escapeDot(s)`(55-57줄)는 라이브 MCP 도구 `export_graph`의 graphml(`export-graph.ts:34,39`)·dot(`export-graph.ts:50,55`) 포맷 뒤에서 노드/엣지 식별자를 이스케이프하나 *escape 동작 자체에 대한 단위 테스트가 0건*이다(`tests/tool-dispatcher.test.ts`의 `export_graph` 테스트는 `<graphml`·`<node`·`digraph G {`·`->` 같은 구조 토큰 존재만 단언하고 특수문자 없는 평범한 qualified_name 픽스처를 씀). P26-1이 신설한 `tests/_utils.test.ts`에 결정적 게이트를 추가한다. **prod 코드 무변경**(테스트-only).

| 미커버 로직 (소스 라인) | 내용 | 게이트 케이스 |
|------------------------|------|---------------|
| escapeXml line 52 | `&`→`&amp;`·`<`→`&lt;`·`>`→`&gt;`·`"`→`&quot;` 각 치환 | 4개 특수문자를 포함한 입력 → 정확한 엔티티 출력 단언 |
| escapeXml line 52 (치환 순서) | **`&`-우선 치환(이중-이스케이프 회피)** | 입력 `'<a>'` → `'&lt;a&gt;'`(`&amp;lt;` 같은 이중-이스케이프가 *없음*을 단언). 입력 `'a&b<c'` → `'a&amp;b&lt;c'`(생성된 `&amp;`의 `&`가 재치환되지 않음을 단언 — 순서 회귀 가드) |
| escapeXml line 52 (전역 `/g`) | 한 문자열 내 다중 출현 전부 치환 | 입력 `'<<>>'` → `'&lt;&lt;&gt;&gt;'` (모든 출현 치환) |
| escapeDot line 56 | `\`→`\\`·`"`→`\"` | 입력 `'a"b\\c'`(백슬래시·따옴표 포함) → `'a\\"b\\\\c'` 단언 |
| escapeDot line 56 (전역 `/g`) | 다중 출현 치환 | 입력 `'""'` → `'\\"\\"'` |
| (무변경 경계) | 특수문자 없는 입력 | escapeXml/escapeDot 둘 다 평범한 식별자(`'foo.bar.baz'`)는 그대로 반환 단언(과-치환 없음) |

| 항목 | 파일 | 작업 |
|------|------|------|
| escape describe 블록 추가 | `tests/_utils.test.ts` (P26-1 신설 — 기존 `mergeResultsRRF` describe 옆에 `escapeXml`/`escapeDot` describe 추가) | `import { escapeXml, escapeDot } from '../src/server/tools/_utils.js'` 추가(기존 `mergeResultsRRF` import 줄에 합치거나 별도 줄). 문자열 리터럴 in → 문자열 out 결정적 단언. |
| escapeXml 케이스 | (위 파일) | 4개 엔티티 치환 + `&`-우선 순서(이중-이스케이프 회피) + 전역 치환 + 무변경. |
| escapeDot 케이스 | (위 파일) | `\`→`\\`·`"`→`\"` + 전역 치환 + 무변경. |
| 베이스라인 재확인 | (검증) | `npx vitest run` 642 + 신규 그린, `npx tsc --noEmit` 그린, `npm audit` 0·`npm audit --omit=dev` 0. |
| M-1 v24 마킹 | `agent_docs/diagnostic-v24.md` | M-1 v24에 `[DONE]` + 신규 케이스 수 기록. |

**설계 메모**:
- `escapeXml`/`escapeDot`은 `(s: string): string` 시그니처(51·55줄)라 테스트 입력은 문자열 리터럴로 충분 — 하니스·픽스처 불필요(graph/ 엔진 게이트들과 달리 DB 의존 0, P26-1 mergeResultsRRF보다도 가벼움).
- **`&`-우선 순서 케이스가 핵심**: escapeXml은 `.replace(/&/g, '&amp;')`를 *가장 먼저* 적용한다. 만약 `<`/`>`/`"`를 먼저 치환하면 그들이 생성한 `&lt;`/`&gt;`/`&quot;`의 `&`가 다시 `&amp;`로 치환돼 `&amp;lt;` 같은 *이중-이스케이프*가 발생한다. 현 코드는 `&`를 먼저 처리해 회피하나 미커버이므로 *순서 회귀를 잡지 못한다*. `'a&b<c'` → `'a&amp;b&lt;c'`(NOT `'a&amp;b&amp;lt;c'`)를 단언하면 이 정합성 속성을 결정적으로 게이트한다 — 이것이 "단순 정규식 치환이라 게이트 가치 낮음"(v23)을 넘어 게이트를 정당화하는 지점이다.
- `escapeDot`의 `\`→`\\` 케이스는 JS 문자열 리터럴 이스케이프에 주의: 입력 `'a\\c'`(실제 문자열 `a\c`)는 결과 `'a\\\\c'`(실제 `a\\c`)가 돼야 한다.

**테스트**: `npx vitest run` 642 + 신규(>=4) 그린이 1차 검증 산출물. `npx tsc --noEmit` 그린, `npm audit` 0/0.

**산출물**: `tests/_utils.test.ts`(escape describe 블록 추가) + diagnostic-v24 M-1 `[DONE]`. **리스크: 매우 낮음**(테스트-only, prod 코드 0줄, 의존 0 순수 함수). **이로써 `_utils.ts`의 3개 export 순수 함수(mergeResultsRRF·escapeXml·escapeDot) 100% 커버 — 핸들러 보조 순수 로직 미커버 공백 0.**

---

## 3. Phase 27-2: better-sqlite3 lockfile 12.10.0 → 12.11.1 정렬 (M-2 v24) [DONE]

**목표**: `better-sqlite3` lockfile이 `12.10.0`인데 `npm outdated` Wanted/Latest가 `12.11.1`로 드리프트(v23 시점 `12.10.1` patch → 본 사이클 `12.11.1` minor로 확대). 12.11.x는 clean한 minor bump(직접 CVE 0, 기능-only — Electron 빌드 타깃 추가 등, 보안·정확성 결함 무관)이고 `package.json` 핀이 `^12.0.0`(semver-호환)이라 *lockfile만* 갱신하면 정렬된다. v23이 "다음 의존성 정렬 사이클 actionable 후보"로 명시 예고한 항목이다.

| 항목 | 파일 | 작업 |
|------|------|------|
| lockfile 정렬 | `package-lock.json` (better-sqlite3 엔트리만) | `npm i better-sqlite3@12.11.1`(또는 `npm update better-sqlite3`) 실행 → `package-lock.json`의 better-sqlite3 `version`/`resolved`/`integrity` 및 transitive(있으면) 엔트리 갱신. **`package.json`은 무변경**(핀 `^12.0.0` semver-호환). |
| 재빌드 확인 | (검증) | better-sqlite3는 native 모듈 — `npm rebuild better-sqlite3` 또는 재설치로 prebuild가 정상 로드되는지 확인(import-time 크래시 없음). |
| 베이스라인 재확인 | (검증) | `npx vitest run` 642 그린(DB 경로 테스트 — database-migration/update-pipeline/workspace-manager 등 — 전부 그린), `npx tsc --noEmit` 그린, `npm audit` 0·`npm audit --omit=dev` 0, `npm ls better-sqlite3` = 12.11.1 확인. |
| M-2 v24 마킹 | `agent_docs/diagnostic-v24.md` | M-2 v24에 `[DONE]` + 정렬 버전 기록(12.10.0→12.11.1). |

**설계 메모**:
- **lockfile-only 변경 — prod/test 코드·`package.json` 0줄.** better-sqlite3 API는 12.x 내에서 안정적이고 minor bump는 빌드 타깃 추가/내부 개선이라 Cynapx의 DB 레이어(`src/db/*`)는 무변경으로 동작.
- 검증의 핵심은 *native 모듈 재빌드 + DB 경로 테스트 그린*이다 — better-sqlite3는 N-API prebuild를 쓰므로 버전 bump 후 import-time에 ABI 미스매치가 없는지(642 그린으로 확인) 본다. 만약 prebuild가 없으면 node-gyp 빌드로 폴백되며, 그 경우에도 CI Node 22/24 매트릭스가 그린이어야 한다.
- 만약 12.11.1 정렬 후 *예상치 못한 audit 신규 항목/빌드 실패*가 관측되면(가능성 낮음), 12.10.0 유지 + L-11 추적으로 롤백하고 사유를 diagnostic-v24에 기록한다(no-regression 원칙).

**테스트**: `npx vitest run` 642 그린(신규 케이스 없음 — lockfile 정렬은 회귀 미발생 확인이 산출물). `npx tsc --noEmit` 그린, `npm audit` 0/0, `npm ls better-sqlite3` = 12.11.1.

**산출물**: `package-lock.json`(better-sqlite3 엔트리 갱신) + diagnostic-v24 M-2 `[DONE]`. **리스크: 매우 낮음**(lockfile-only, semver-호환 minor bump, CVE 0, DB 경로 642 테스트로 회귀 게이트).

---

## 4. 보류/이연 항목 판정 (diagnostic-v24 → Phase 27 verdict)

| 항목 | diagnostic-v24 판정 | Phase 27 처리 |
|------|--------------------|---------------|
| **M-1 v24 escapeXml/escapeDot 게이트** | `_utils.ts` 마지막 미커버 순수 함수, escape 동작 0% 커버, 의존 0 (**verdict: actionable, 테스트-only**) | **P27-1에서 해소** |
| **M-2 v24 better-sqlite3 lockfile 12.10.0→12.11.1** | 드리프트가 minor로 확대, clean bump, v23 예고 (**verdict: actionable, lockfile-only**) | **P27-2에서 해소** |
| **L-2 Miasma / Phantom Gyp / Node-gyp 포스처** | 캠페인 진행 중, Cynapx 도달 0건 재대조 (**verdict: 추적만**) | 추적 상태만 갱신 — `npm ls` + in-tree 설정 재점검 |
| **L-3 MCP stateless/task 마이그레이션** | SDK v2 *여전히 pre-alpha*, sdk 1.29.0 불변, stable Q3 2026 예정 (**verdict: 계속 이연**) | 범위 제외 — v2 stable 전환 시 |
| **L-4 IPC MessagePack** | 성능 문제 미관측 (**verdict: 계속 보류**) | 범위 제외 |
| **L-5 클러스터링 본격 파티셔닝** | count-first 가드(200k) OOM 방어 (**verdict: 계속 이연**) | 범위 제외 |
| **L-6 Node 24 tree-sitter 빌드** | node-tree-sitter#268·C++20 fragility 여전히 open (**verdict: 추적**) | 추적 상태만 갱신 |
| **L-7 admin CLI cmd* 게이트 공백** | 모듈-private, 리팩터 수반 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-8 worker-pool/embedding/migration 잔여** | 인접 분기 커버 + flaky 위험 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-9 update-pipeline 클린업 잔여** | (b) 잣대 미충족 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-11 better-sqlite3 lockfile** | 드리프트 minor로 확대, clean bump (**verdict: 해소-승격 → M-2 v24**) | **P27-2에서 해소** |
| **L-13 analyze-impact use_cache 무해** | 스키마-default 핸들러 미강제, 캐시 비활성=느려질 뿐 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-14 CVE-2026-25727 time 크레이트 (미도달)** | 실제 Rust `time` 크레이트 결함, Cynapx prod 트리 미도달 (**verdict: 추적만, 비-actionable**) | 범위 제외 — tree-sitter Rust 생태계 모니터링 신호로만 추적 |
| **L-15 vite dev advisory** | `473acf8` vite `^8.0.16` bump로 해소, audit 0/0 재확인 (**verdict: 해소**) | 추적 종료 |

---

## 5. 유지보수 모드 포스처 ("정기 점검" 이월)

1. **공급망 위생(매 사이클)**: prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0 유지. 신규 advisory 시 `overrides`/devDependency floor bump로 패치(L-15 vite `^8.0.16` 전례 — 본 사이클 해소). 의존 추가 시 binding.gyp 검토 + `npm ci` + 매 사이클 `npm ls`/in-tree `.claude`/`.cursor`/`.gemini` 설정 재대조(현재 `.claude/launch.json` 양성, 0건). **lockfile 드리프트(L-11→M-2 v24, better-sqlite3 12.10.0→12.11.1) 정기 정렬 — P27-2에서 처리. 매 사이클 `npm outdated`로 드리프트 누적 모니터링.**
2. **MCP SDK v2 stable 배포 모니터링**: `@modelcontextprotocol/sdk` latest가 *여전히 1.29.0*(v2 pre-alpha, stable Q3 2026 예정). 2.x로 전환(또는 v2 stable)되면 L-3 actionable화. 그 전까지 핀 `^1.29.0` 유지.
3. **런타임 수명주기**: Node 22 LTS·tree-sitter 신버전·tree-sitter-c-sharp 0.23.6+ 출현 시 정렬. Node 24 LTS 전환은 node-tree-sitter#268 해소 후. 문서 Node 버전(L-12, P24-2 해소)은 코드와 동기화 유지.
4. **회귀 안전망·핸들러 위생**: 새 도구/REST 라우트/이벤트 핸들러/엔진 비즈니스 로직/**핸들러 보조 순수 로직**/핸들러 인자 검증의 미커버·불일치 발견 시 vitest 케이스 추가(P18-1→P19-1→P20-1→P22-1→P23-1/2/3→P24-1→P25-1/2→P26-1/2→**P27-1** 확장). **P27-1로 `_utils.ts`의 3개 export 순수 함수(mergeResultsRRF·escapeXml·escapeDot) 100% 커버 완성**(핸들러 보조 순수 로직 미커버 공백 0). graph/ 엔진 5종 + `qualified_name` 10개 핸들러 strict 가드(M-2 v22+v23) + `_utils.ts` 순수 함수 전수 — *회귀 안전망이 사실상 steady-state*에 도달. 이후 신규 도구/엔진/핸들러 추가 시에만 확장.

---

## 6. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 27-(docs) | diagnostic-v24 + phase27-plan 신규 docs | 1 | 없음 (docs-only) |
| 27-1 [DONE] | M-1 v24: `tests/_utils.test.ts`에 `escapeXml`/`escapeDot` escape 동작 게이트(의존 0 순수 함수, 테스트-only) — 4개 엔티티 치환·`&`-우선 순서(이중-이스케이프 회피)·전역 치환·무변경·escapeDot `\`/`"` 치환 (신규 7 케이스, vitest 642→649) | 1 | 매우 낮음 |
| 27-2 [DONE] | M-2 v24: better-sqlite3 lockfile 12.10.0→12.11.1 정렬(lockfile-only, `package.json` 무변경) + 재빌드 + 649 그린·audit 0/0 재확인 | 1 (27-1과 합본 가능) | 매우 낮음 |

**총 2~3개 커밋(P27-1·P27-2 분리/합본).** 두 항목은 서로 독립(다른 부류 — 테스트 게이트 vs 의존성 위생)이라 순서 무관·합본 무방(둘 다 작고 리스크 낮음 — 1~2항목 제한 원칙 부합).

> **Steady-state 진입 안내**: Phase 27 완료 후 `_utils.ts` 순수 함수 100% 커버 + 의존성 위생 정렬이 끝나면, 남은 actionable 후보가 사실상 소진된다(graph/ 엔진·핸들러 보조 로직·핸들러 가드·검색 융합 전수 게이트, lockfile 정렬). 이후 사이클은 (1) 새 도구/엔진/핸들러 추가 시의 신규 게이트, (2) 공급망 위생(audit·lockfile 드리프트) 정기 점검, (3) MCP SDK v2 stable 전환(L-3) 같은 *외부 트리거 기반* 항목으로 전환된다. 즉 Phase 27은 *내부 코드/테스트 게이트 발굴 사이클의 사실상 마무리*에 가깝고, 이후는 유지보수 모드 포스처(5장)가 주도한다.

---

## 7. 향후 후보 (Phase 27 범위 밖 — 기록 유지)

- **MCP transport v2 마이그레이션(L-3)**: SDK v2 여전히 pre-alpha. `@modelcontextprotocol/sdk` latest가 2.x로 전환되거나 v2 stable(Q3 2026) 시 P15-3 설계 메모 기반 착수.
- **lockfile 드리프트 정기 모니터링(L-11 후속)**: P27-2로 better-sqlite3 정렬 후에도 매 사이클 `npm outdated`로 native/핵심 의존 드리프트 누적 추적 — 다음 minor 누적 시 재정렬.
- **SCIP export**: P18-1 + P19-1 디딤돌 마련 완료, protobuf 의존 부담으로 즉시 비권장. CodeGraph/Serena 생태계 상호운용 신호 시 재검토(경쟁사 detect_changes/rename/generate_map 추세 모니터링).
- **L-9 잔여 클린업**: update-pipeline `withWriteTransaction()` 추출, progress `log.error` 재분류, 빈 catch 2건 — update-pipeline 리팩터 페이즈로.
- **admin CLI 게이트화(L-7)** / **worker-pool/embedding/migration 게이트화(L-8)**: 각각 핸들러 export 리팩터 / SCHEMA_VERSION 증분 시 함께.
- **L-4 IPC MessagePack** / **L-5 클러스터링 파티셔닝**: 실측 트리거 시.
- **Node 24 LTS 전환** / **tree-sitter-c-sharp 0.23.6+ 정렬**: 신버전·환경 확정 후(node-tree-sitter#268 해소 후).
- **analyze-impact `use_cache` 스키마-default 강제(L-13)**: 핸들러에서 `args.use_cache ?? true`로 스키마-default를 명시 강제하는 미세 개선 — 무해라 우선순위 낮음.
- **L-14 CVE-2026-25727 모니터링**: tree-sitter Rust 생태계 신호 — Cynapx 미도달이나 tree-sitter 코어/그래머 업데이트 시 재확인.
