# Phase 32 작업 계획 — diagnostic-v29 대응

> **작성**: 2026-06-16 / **기준 문서**: `agent_docs/diagnostic-v29.md` (기준 커밋 `dfb9dd5`, Phase 31 + Phase 31-1 완료 — `tests/language-registry.test.ts`에 `getProvider()` 확장자 엣지케이스 6 `it` 추가로 M-1 v28(L-18 승격) 해소, 테스트-only·prod 무변경, vitest 672→678)
> **목표**: diagnostic-v29가 식별한 **무위험 actionable 1건(M-1 v29)** 을 해소한다. **M-1 v29**: `src/indexer/metrics-calculator.ts`의 `MetricsCalculator.calculateCyclomaticComplexityTreeSitter()` — *모든 비-TS 언어(12종)의 함수/메서드 인덱싱마다 호출되는* 사이클로매틱 복잡도(CC) 측정 핫패스의 *null/undefined 가드*(97줄 `if (!node) return 1`)와 *빈 decisionPoints 경계*가 직접 단언되지 않는 게이트 공백을 `tests/metrics-calculator.test.ts`에 케이스 추가로 닫는다(테스트-only·prod 코드 무변경). 이는 phase32-task가 명시적으로 지목한 *세 후보*(① `paths.ts` 형제, ② `metrics-calculator`, ③ 그 외 부분 커버)를 회의적으로 재검토한 결과 — *후보 ①은 이미 전수 게이트(`getDirSizeMB`만 fs-의존 비-순수 L-20), 후보 ③은 기존 추적 항목 외 신규 0, 후보 ② metrics-calculator의 null-guard만이 마지막 0-의존 순수 함수 후보*로 남아 있었기 때문이다. 계속 보류/이연/추적 항목(L-2~L-9, L-13, L-14, L-19, L-20, L-21)은 추적만 갱신하고 M-1 v29 → P32-1로 처리한다. L-18(getProvider)은 P31-1에서·L-17(within-pin)은 P30-1에서·L-16(express)은 P28-2에서·L-11(better-sqlite3)·L-15(vite)는 이전 사이클에서 이미 해소다(3장).
>
> **맥락**: v22~v28이 graph/ 엔진 진입(P22-25)·핸들러 보조 순수 로직(`mergeResultsRRF` P26-1)·`qualified_name` strict 가드(P26-2)·`_utils.ts`(`escapeXml`/`escapeDot` P27-1)·공통 유틸 정규화(`toCanonical` P28-1 + `isPathInside`/`isSystemPath`/`getProjectHash` 기존)·graph 엔진 시딩/env-파싱(`mulberry32`·`parseClusterSeed`·`parseClusterMaxNodes` P29-1)·indexer 확장자 매핑(`getProvider` 엣지케이스 P31-1)을 전수 게이트했고, lockfile 위생(prod-dep P27-2/P28-2 + within-pin P30-1)도 닫혔다. v29는 *외부-트리거-only 포스처 두 번째 사이클*로 phase32-task가 지목한 세 후보를 정직하게 재검토했다: **(1) 신규 prod 코드 0**(`git log dfb9dd5` = 테스트-게이트/lockfile/문서 커밋만), **(2) paths.ts 형제는 이미 전수 게이트**(후보 ① 소거), **(3) metrics-calculator null-guard가 마지막 0-의존 순수 함수 후보**(후보 ② — M-1 v29), **(4) 외부 트리거 모두 정적**(MCP SDK v2 *여전히 pre-alpha*·`dist-tags.latest` 1.29.0·`time.modified` 2026-06-04 불변, 신규 vitest CVE 2건[CVE-2026-47428/47429]은 *버전(4.1.9 > fix 4.1.6/4.1.0)·기능(browser/UI 미사용)·플랫폼(47429 Windows 전용) 삼중 미도달*, audit 0/0, Miasma/Phantom Gyp 미도달, node-tree-sitter#268 open). **따라서 유일한 actionable은 M-1 v29(metrics-calculator null-guard)**이다. Phase 32는 **CC 측정 null-guard 게이트(P32-1, 테스트-only) + 추적 갱신**의 *경량 단일-항목 유지보수 사이클*이며, 예상 **2커밋**(diagnostic-v29 + phase32-plan docs + P32-1, 또는 합본).

---

## 0. 작업 원칙

- P32-1은 **prod 코드 무변경**(테스트-only) — `src/indexer/metrics-calculator.ts`는 *읽기만* 하고 `tests/metrics-calculator.test.ts`에 null-guard 케이스만 추가한다. `calculateCyclomaticComplexityTreeSitter()`는 *노드(또는 null) in → number out*의 0-의존 순수 결정 로직이라 그래머/파서/픽스처 불필요(null/undefined/빈-dp 입력은 즉시 `1` 반환).
- 케이스는 *진단 일자 `npx tsx` 실측값*에 고정한다: `calculateCyclomaticComplexityTreeSitter(null, ['if_statement'])`→1, `(undefined, ['if_statement'])`→1, `(유효노드, [])`(빈 decisionPoints)→1.
- Phase 종료 시(P32-1) `npx vitest run` **그린**(678 → 대략 +2~3 케이스), `npx tsc --noEmit` 그린, `npm audit` 0, `npm audit --omit=dev` 0 확인.
- Phase 종료 시 `agent_docs/diagnostic-v29.md`의 M-1 v29에 `[DONE]` 마킹.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.** (`.git/info/exclude`에 등록 — `git status --short`는 항상 깨끗해야 한다.)
- 한 사이클(1~2 항목) 제한 원칙에 따라, 본 사이클은 **P32-1 단독**(테스트-only)이다 — M-2(추가 actionable)가 없는 *경량 단일-항목* 사이클. 내부 0-의존 게이트 발굴 소진(metrics-calculator null-guard가 마지막 후보) + 외부 정적이라 이 게이트가 유일하게 남은 actionable이다.

---

## 1. 현재 베이스라인 (Phase 32 시작 시점)

| 항목 | 값 | 비고 |
|------|-----|------|
| 기준 커밋 | `dfb9dd5` | P31-1 완료(getProvider 엣지케이스 게이트, M-1 v28) |
| 테스트 | **678/678**(47 파일, 5.91s) | `npx vitest run` 그린 |
| 타입체크 | 그린 | `npx tsc --noEmit` |
| prod audit | **0 vulnerabilities** | `npm audit --omit=dev` |
| dev audit | **0 vulnerabilities** | `npm audit` |
| `@modelcontextprotocol/sdk` | 1.29.0 (핀 `^1.29.0`) | npm `dist-tags.latest`·2.x dist-tag 부재·`time.modified` 2026-06-04(불변) |
| `better-sqlite3` | 12.11.1 | prod-dep, npm `latest`(P27-2) |
| `express` | 4.22.2 | prod-dep(P28-2) |
| `zod` | 4.4.3 | prod-dep, within-pin 정렬(P30-1) — CVE-2026-6991 범위 밖(L-19) |
| `vite` | 8.0.16 | dev-dep(L-15) |
| `vitest` | 4.1.9 | dev-dep, within-pin 정렬(P30-1) — CVE-2026-47428/47429 범위 밖(L-21) |
| `tree-sitter` / `tree-sitter-c-sharp` | 0.25.0 / 0.23.1 | 0.23.5 ERR_REQUIRE_ASYNC_MODULE 미해소 → 0.23.1 핀 유지 |
| within-pin 드리프트 | **0** | `npm outdated` Current=Wanted 전 행(P30-1) |
| in-tree binding.gyp | **0개** | L-2 Miasma/Phantom Gyp 미도달 |

---

## 2. Phase 32-1: metrics-calculator null-guard 게이트 (M-1 v29) [예정]

**목표**: `src/indexer/metrics-calculator.ts`의 `MetricsCalculator.calculateCyclomaticComplexityTreeSitter()` — *모든 비-TS 언어(12종)의 함수/메서드 인덱싱마다 호출되는* CC 측정 핫패스의 *null/undefined 가드·빈 decisionPoints 경계*에 회귀 게이트 추가. **prod 코드 무변경**(테스트-only). 이는 *0-의존 순수 함수 게이트 발굴 사이클의 마지막 후보*다 — paths.ts 형제(후보 ①)는 이미 전수 게이트되고, 본 함수의 본체(operator 디스앰비규에이션·`switch_label` 가드·strings/comments 미카운트·TS-AST 경로)도 *Rust/Go/Java/Python/TS 실파스 12 `it`로 전수 게이트*되나 — null-guard·빈-dp 경계만 누락이다.

| 입력 | 기대 결과 | 분류 | 코드 경로 |
|------|-----------|------|-----------|
| `(null, ['if_statement'])` | `1` | null 가드 | `if (!node) return 1`(97줄) |
| `(undefined, ['if_statement'])` | `1` | undefined 가드 | `if (!node) return 1`(97줄) |
| `(유효노드, [])`(빈 decisionPoints) | `1` | 빈-dp 경계 | `points` 빈 Set → 모든 노드 미스 → CC 증분 0 → `1` 반환(98-133줄) |

**제외(엣지케이스 외)**: 본체 분기(operator `&&`/`||`/`??`/`and`/`or` 디스앰비규에이션[108-115줄]·`switch_label` `namedChildCount` 가드[116-120줄]·반복 DFS·strings/comments 미카운트)와 TS-AST 경로(`calculateCyclomaticComplexity`)는 *재게이트하지 않는다*(metrics-calculator.test.ts 12 `it`로 이미 커버 — M-1 v29는 *null-guard·빈-dp 공백*만 보강).

| 항목 | 파일 | 작업 |
|------|------|------|
| null-guard 케이스 추가 | `tests/metrics-calculator.test.ts` | 신규 describe `CC (tree-sitter) — defensive guards` 추가: `it('returns 1 for a null/undefined node', ...)`(null·undefined→1) + `it('returns 1 when decisionPoints is empty', ...)`(빈-dp→1, 유효 미니 노드 스텁 또는 실파스 함수 노드 + 빈 배열) |
| prod 무변경 검증 | `src/indexer/metrics-calculator.ts` | `git diff src/indexer/metrics-calculator.ts` = 빈 출력(읽기만) 확인 |
| 베이스라인 재확인 | (검증) | `npx vitest run` 그린(678 → 대략 +2~3), `npx tsc --noEmit` 그린, `npm audit` 0·`npm audit --omit=dev` 0 |
| M-1 v29 마킹 | `agent_docs/diagnostic-v29.md` | M-1 v29에 `[DONE]` + 케이스 수 기록 |

**설계 메모**:
- **0-의존 순수 결정 로직**: `calculateCyclomaticComplexityTreeSitter(node, decisionPoints)`는 *노드(또는 null) in → number out*이다. null/undefined 케이스는 *동기·side-effect-free*(`if (!node) return 1` 즉시 반환 — 스택 워크 미도달). 빈-dp 케이스는 `points` 빈 Set → 어떤 노드 타입도 매치 안 됨 → complexity 증분 0 → `1` 반환(유효 노드 스텁이든 실파스 노드든 동일). 셋 다 그래머 로드/파서 불필요(null/undefined는 노드 자체가 없고, 빈-dp는 미니 스텁 노드 `{type, childCount:0, child:()=>null}`로 충분).
- **회귀 안전망 의미**: null-guard 회귀(예: `if (!node)` 제거 → 다음 줄 `points.has(current.type)`/`current.childCount` 접근에서 `null` deref TypeError로 *전체 비-TS 인덱싱 크래시*)는 *유효-노드 테스트를 우회로* 슬립할 수 있다(정상 12 `it`는 *항상 유효 노드만* 전달). null/undefined 고정값(`1`) 단언은 그 회귀를 결정적으로 잡는다. 빈-dp 단언은 *decisionPoints 미전달/빈 배열 시 안전 degrade(CC=1)*를 고정한다.
- **M-1 v23~v28과의 부류 관계**: M-1 v23(`mergeResultsRRF`)·M-1 v25(`toCanonical`)·M-1 v26(`mulberry32`)·M-1 v28(`getProvider`)과 *동형의 "라이브 핫패스 뒤 0-의존 순수 함수 미커버 게이트"*이되 — *indexer 메트릭 계산 레이어*를 덮는다. **이 게이트로 0-의존 순수 함수 게이트 발굴이 완전 소진된다.**
- **정직성**: M-1 v29는 *결함이 아니라 게이트 공백*이다(null-guard 정확 동작). phase32-task가 metrics-calculator를 명시 지목했고 — 회의적 재검토 결과 *본체는 커버·null-guard만 누락*임을 확인해 (b) 잣대(작고·저위험·테스트-only)를 충족하는 마지막 내부 후보로 처리하는 것이 정직하다.

**테스트**: `npx vitest run` 그린이 1차 검증 산출물. `npx tsc --noEmit` 그린, `npm audit` 0/0.

**산출물**: `tests/metrics-calculator.test.ts`(null-guard 케이스 추가) + diagnostic-v29 M-1 `[DONE]`. **리스크: 매우 낮음**(테스트-only, prod 코드 무변경, 0-의존 결정적 케이스, 회귀 검증 vitest + tsc + audit). **이로써 *모든 비-TS 함수 인덱싱이 의존하는* CC 측정 함수의 방어적 null-guard까지 게이트되어 — 0-의존 순수 함수 게이트 발굴이 완전 소진된다.**

---

## 3. L-item 추적 테이블 (diagnostic-v29 → Phase 32 verdict)

| 항목 | diagnostic-v29 판정 | Phase 32 처리 |
|------|--------------------|---------------|
| **M-1 v29 metrics-calculator null-guard 게이트** | 마지막 남은 0-의존 순수 함수 후보, 테스트-only·prod 무변경 (**verdict: actionable**) | **P32-1에서 해소** |
| **L-2 Miasma / Phantom Gyp / Node-gyp 포스처** | 캠페인 여전히 활발(wave2 이후 신규 wave 없음), Cynapx 도달 0건(binding.gyp 0개) (**verdict: 추적만**) | 추적 상태만 갱신 — `npm ls` + in-tree binding.gyp/설정 재점검 |
| **L-3 MCP stateless/task 마이그레이션** | SDK v2 *여전히 pre-alpha*, `dist-tags.latest` 1.29.0·2.x dist-tag 부재·`time.modified` 2026-06-04 불변, stable Q3 2026[7-28 spec publish] (**verdict: 계속 이연**) | 범위 제외 — 2026-07-28 전후 2.x dist-tag/v2 stable 재확인이 다음 사이클 1순위 외부 트리거 |
| **L-4 IPC MessagePack** | 성능 문제 미관측 (**verdict: 계속 보류**) | 범위 제외 |
| **L-5 클러스터링 본격 파티셔닝** | count-first 가드(200k) OOM 방어, 시딩/캡 프리미티브 P29-1 게이트 (**verdict: 계속 이연**) | 범위 제외 |
| **L-6 Node 24 tree-sitter 빌드** | node-tree-sitter#268 여전히 open (**verdict: 추적**) | 추적 상태만 갱신 |
| **L-7 admin CLI cmd* 게이트 공백** | 모듈-private, 리팩터 수반 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-8 worker-pool/embedding/migration 잔여** | 인접 분기 커버 + flaky 위험 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-9 update-pipeline 클린업 잔여** | (b) 잣대 미충족 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-11 better-sqlite3 lockfile** | P27-2에서 12.11.1 정렬 (**verdict: 해소**) | 추적 종료 |
| **L-13 analyze-impact use_cache 무해** | 캐시 비활성=느려질 뿐 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-14 CVE-2026-25727 time 크레이트 (미도달)** | Rust `time` 크레이트 결함, Cynapx prod 트리 미도달 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-15 vite dev advisory** | `473acf8` `^8.0.16` bump 해소 (**verdict: 해소**) | 추적 종료 |
| **L-16 express lockfile** | P28-2에서 4.22.2 정렬 (**verdict: 해소**) | 추적 종료 |
| **L-17 within-pin lockfile 드리프트** | P30-1에서 zod/@types-node/vitest 정렬 (**verdict: 해소**) | 추적 종료 |
| **L-18 getProvider 확장자 엣지케이스 공백** | P31-1에서 처리(672→678) (**verdict: 해소**) | 추적 종료 |
| **L-19 CVE-2026-6991 zod CUID (미도달)** | zod 4.4.3 + `.cuid()` 미사용 + parameterized binding 삼중 미도달 (**verdict: 추적만, 비-actionable**) | 범위 제외 — zod 생태계 모니터링 신호 |
| **L-20 getDirSizeMB fs-의존 비-순수 (신규)** | paths.ts 형제 중 유일 미커버이나 fs 재귀 walker라 (b) 미충족(픽스처 필요) (**verdict: 추적만, 비-actionable**) | 범위 제외 — get-setup-context fixture 테스트 페이즈 후보 |
| **L-21 CVE-2026-47428/47429 vitest (미도달, 신규)** | vitest 4.1.9(fix 4.1.6/4.1.0 초과) + browser/UI 미사용 + 47429 Windows 전용 삼중 미도달 (**verdict: 추적만, 비-actionable**) | 범위 제외 — vitest 생태계 모니터링 신호 |

---

## 4. 외부 트리거 체크리스트 (이것이 발화하면 본 포스처가 actionable로 전환)

> Phase 32 이후 Cynapx는 *0-의존 순수 함수 게이트 발굴 완전 소진 + lockfile 위생 steady-state*이므로 — **다음 사이클의 actionable 여부는 전적으로 아래 외부 트리거에 달려 있다.** 매 사이클 이 체크리스트를 재스캔한다.

| # | 트리거 | 현재 상태(2026-06-16) | 발화 시 조치 | 1순위? |
|---|--------|----------------------|-------------|--------|
| T-1 | **MCP SDK 2.x dist-tag / v2 stable 출현** | 미발화 — `dist-tags = { latest: '1.29.0' }`, 2.x dist-tag 부재, `time.modified` 2026-06-04(불변). stable Q3 2026·**스펙 publish 2026-07-28**(6주여 앞) | L-3 즉시 actionable화 — P15-3 `handleMcp()` 설계 메모 기반 stateless core(SEP-2567)/Tasks/MCP Apps 마이그레이션 착수 | **★ 1순위 (2026-07-28 임박)** |
| T-2 | **신규 CVE가 Cynapx 도달**(버전·기능·플랫폼/바인딩 삼축 *전부* 도달) | 미발화 — 거론된 신규 CVE 전부 미도달: CVE-2026-6991(zod, L-19)·CVE-2026-47428/47429(vitest, L-21)·CVE-2026-25727(time, L-14) | `overrides`/floor bump 또는 핀 정렬로 패치(L-15 vite 전례). audit 게이트 그린 회복 | — |
| T-3 | **신규 prod 코드 추가**(새 MCP 도구·REST 엔드포인트·엔진·유틸) | 미발화 — `git log dfb9dd5` = 테스트-게이트/lockfile/문서 커밋만(신규 prod 표면 0) | 신규 표면의 0-의존 순수 로직/인자 가드/스키마 불변식에 vitest 게이트 추가(P18-1→…→P32-1 부류 연장) | — |
| T-4 | **within-pin lockfile 드리프트 누적** | 미발화 — `npm outdated` Current=Wanted 전 행(P30-1로 0) | `npm update`(핀-내) lockfile 정렬(P30-1 전례) | — |
| T-5 | **node-tree-sitter#268 해소 + Node 24 LTS 전환** | 미발화 — #268 여전히 open(C++20/C++17 빌드 모순) | Node 24 매트릭스 prebuild 재확인 후 `engines`/Dockerfile 전환 검토(L-6) | — |
| T-6 | **tree-sitter-c-sharp 0.23.6+ ERR_REQUIRE_ASYNC_MODULE 해소** | 미발화 — 0.23.1 핀 롤백 유지(0.23.5 미해소) | 핀 정렬(L-6 인접) | — |
| T-7 | **Miasma/Phantom Gyp 캠페인이 Cynapx 의존 트리 도달** | 미발화 — in-tree binding.gyp 0개·컴프로마이즈 패키지 not in tree·`.claude/launch.json` 양성 | 영향 패키지 제거/핀·`npm ci` 재검증·자격증명 회전(L-2) | — |

---

## 5. 유지보수 포스처 (외부-트리거-only — 0-의존 게이트 완전 소진 후)

1. **공급망 위생(매 사이클)**: prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0 유지. 신규 advisory 시 `overrides`/floor bump로 패치(L-15 vite `^8.0.16` 전례). 의존 추가 시 binding.gyp 검토 + `npm ci` + 매 사이클 `npm ls`/in-tree binding.gyp(현재 0개)·`.claude`/`.cursor`/`.gemini` 설정 재대조(현재 `.claude/launch.json` 양성, 0건 — L-2 미도달). **lockfile 드리프트 정기 정렬**: *prod-dep*(better-sqlite3 P27-2·express P28-2·zod P30-1)·*within-pin*(P30-1) 모두 0 — 매 사이클 `npm outdated`로 누적 모니터링(T-4). **신규 CVE 도달성 삼축 판정**: 거론된 CVE마다 *버전(영향 범위 vs lockfile)·기능(취약 API 사용 여부)·플랫폼/바인딩(2차 방어)* 삼축으로 도달성을 판정한다 — CVE-2026-47428/47429(vitest)가 *버전(4.1.9 > fix)·기능(browser/UI 미사용)·플랫폼(47429 Windows 전용) 삼중 미도달*인 전례(L-21), CVE-2026-6991(zod)이 *버전·기능·바인딩 삼중 미도달*인 전례(L-19).
2. **MCP SDK v2 stable 배포 모니터링(다음 사이클 1순위 외부 트리거 — T-1)**: `npm view @modelcontextprotocol/sdk dist-tags time.modified`가 *여전히 `{ latest: '1.29.0' }`·2.x dist-tag 부재·`time.modified` 2026-06-04*(v2 pre-alpha). 2.x dist-tag(`next`/`latest`) 출현 또는 v2 stable 시 L-3 즉시 actionable화(P15-3 `handleMcp()` 설계 메모 출발점). 그 전까지 핀 `^1.29.0` 유지. **다음 사이클은 2026-07-28 스펙 publish와 정면으로 맞물린다.**
3. **런타임 수명주기**: Node 22 LTS·tree-sitter 신버전·tree-sitter-c-sharp 0.23.6+(T-6) 출현 시 정렬. Node 24 LTS 전환은 node-tree-sitter#268(L-6, T-5) 해소 후. 문서 Node 버전(L-12, P24-2 해소)은 코드와 동기화 유지.
4. **회귀 안전망·핸들러 위생**: 새 도구/REST 라우트/이벤트 핸들러/엔진 비즈니스 로직/핸들러 보조 순수 로직/공통 유틸 순수 함수/엔진 시딩·env-파싱 순수 함수/핸들러 인자 검증/indexer 확장자 매핑/**indexer 메트릭 계산 null-guard**의 미커버·불일치 발견 시 vitest 케이스 추가(P18-1→…→P31-1→**P32-1** 확장 완료). **0-의존 순수 함수 게이트 발굴은 P32-1로 완전 소진** — graph/ 엔진 5종 진입 + 시딩/env-파싱 4종 + `qualified_name` 10개 strict 가드 + `_utils.ts` 3개 + `paths.ts` 순수 함수 4종 + `getProvider` 엣지케이스(P31-1) + **metrics-calculator null-guard(P32-1)**가 *모두* 직접 게이트된다. **이후 신규 도구/엔진/핸들러/유틸 추가 시에만 확장**(현재 신규 prod 코드 0 — `git log dfb9dd5`; T-3).
5. **외부-트리거-only 포스처(전환 완료)**: Phase 26~31이 *0-의존 순수 함수 게이트 발굴 사이클*을 레이어별로 소진했고 *lockfile 위생*(prod-dep·within-pin)도 닫혔으며 — **Phase 32가 *마지막 후보 metrics-calculator null-guard*를 처리**한다. 따라서 **Phase 32 이후 사이클은 *전적으로 외부-트리거 기반*으로 전환된다** — 즉 (a) 새 도구/엔진/핸들러/유틸이 *추가될 때만* 신규 게이트(T-3), (b) `npm audit`(prod)·lockfile 드리프트 정기 재스캔 + 신규 CVE 도달성 삼축 판정(T-2/T-4), (c) **MCP SDK v2 stable 전환(T-1, 2026-07-28 스펙 publish 전후 — 다음 사이클의 1순위)**·node-tree-sitter#268 해소(T-5)·tree-sitter-c-sharp 0.23.6+(T-6)·Miasma 도달(T-7) 같은 *외부 상태 변화* 트리거. **이에 따라 향후 사이클을 *더 긴 간격*(격주/월간 외부 CVE·SDK·공급망 재스캔 위주)으로 옮기거나, 코드 변경이 없는 사이클은 *외부 컨텍스트 재조사 + 추적 갱신만의 경량 doc-only 사이클*로 운영하는 것을 권장한다.** 단 매 사이클 (b)(c)의 외부 재스캔은 계속 유지한다(공급망/CVE는 시간 의존적). **특히 다음 사이클은 2026-07-28 MCP v2 스펙 publish와 정면으로 맞물려 — v2 stable/2.x dist-tag 재확인이 1순위(T-1)다.**

---

## 6. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 | 테스트 |
|-------|-----------|---------|--------|--------|
| 32-(docs) | diagnostic-v29 + phase32-plan 신규 docs | 1 | 없음 (docs-only) | 베이스라인 678 (불변) |
| 32-1 [예정] | M-1 v29: metrics-calculator null-guard 게이트(`tests/metrics-calculator.test.ts`에 null/undefined→1·빈-dp→1 추가) — prod 코드 무변경, **vitest 그린**·tsc 그린·audit 0/0 | 1 (32-(docs)와 합본 가능) | 매우 낮음 | **678 → 대략 +2~3 (전량 그린)** |

**총 2개 커밋(P32-1 단독 + docs, 또는 합본).** 본 사이클은 *M-2(추가 actionable)가 없는 경량 단일-항목* 사이클이다 — 0-의존 게이트 발굴 소진(metrics-calculator null-guard가 마지막 후보) + 외부 정적이라 이 게이트가 유일하게 남은 actionable이다.

> **베이스라인/타깃 테스트 수**: 현재 **678**(47 파일). P32-1은 null-guard 케이스 추가로 **대략 +2~3**(null/undefined 묶음 1 `it` + 빈-dp 1 `it`, 또는 null·undefined 분리 시 +3)이며, **타깃 ≈ 680~681**(묶음 방식에 따라 ±). docs-only 커밋(32-(docs))은 678 불변.

> **깊은 steady-state 안내**: Phase 26~31이 핸들러 보조·공통 유틸·graph 엔진 시딩·indexer 확장자 매핑 순수 함수 레이어 + lockfile 위생을 마무리했고 — **Phase 32는 *0-의존 순수 함수 게이트 발굴 사이클의 마지막 후보인 metrics-calculator null-guard*를 처리해 *모든 비-TS 함수 인덱싱이 의존하는 CC 측정 함수의 방어적 null-guard*까지 게이트한다.** 따라서 Phase 32 이후는 *전적으로 외부-트리거 기반*(4장 외부 트리거 체크리스트 + 5장 유지보수 포스처)으로 전환되는 *깊은 steady-state*다. **다음 사이클의 1순위 외부 트리거는 2026-07-28 MCP SDK v2 스펙 publish 전후의 v2 stable/2.x dist-tag 출현 재확인(T-1/L-3)이다.**

---

## 7. 향후 후보 (Phase 32 범위 밖 — 기록 유지)

- **MCP transport v2 마이그레이션(L-3, 다음 사이클 1순위 — T-1)**: SDK v2 여전히 pre-alpha(`dist-tags.latest` 1.29.0·2.x dist-tag 부재). 2.x dist-tag 전환 또는 v2 stable(Q3 2026, **스펙 publish 2026-07-28**) 시 P15-3 설계 메모 기반 착수.
- **사이클 포커스 전환(5장)**: 0-의존 순수 함수 게이트 완전 소진(P32-1) + lockfile 정렬 소진(P30-1)에 따라 향후 사이클을 *전적으로 외부-트리거 기반*으로 전환 — 더 긴 간격 또는 doc-only 경량 사이클 운영 권장.
- **get-setup-context fixture 테스트(L-20 후속)**: `getDirSizeMB`는 fs-의존 비-순수라 0-의존 게이트 부류가 아니다 — tmpdir 실파일 트리 fixture로 바이트 합산을 단언하는 *통합 테스트 페이즈*로 별도 묶을 때 함께 후보(우선순위 낮음).
- **lockfile 드리프트 정기 모니터링(T-4)**: P27-2/P28-2(prod-dep) + P30-1(within-pin) 정렬 후 드리프트 0. 매 사이클 `npm outdated`로 누적 추적.
- **신규 CVE 도달성 삼축 판정(L-14/L-19/L-21 후속 — T-2)**: tree-sitter/zod/vitest/SQLite 등 의존 생태계의 신규 CVE는 *버전·기능·플랫폼/바인딩* 삼축으로 도달성 판정. 미도달이라도 모니터링 신호로 기록.
- **SCIP export**: P18-1 + P19-1 디딤돌 마련 완료, protobuf 의존 부담으로 즉시 비권장. CodeGraph/Serena 생태계 상호운용 신호 시 재검토.
- **L-9 잔여 클린업**: update-pipeline `withWriteTransaction()` 추출, progress `log.error` 재분류, 빈 catch 2건 — update-pipeline 리팩터 페이즈로.
- **admin CLI 게이트화(L-7)** / **worker-pool/embedding/migration 게이트화(L-8)**: 각각 핸들러 export 리팩터 / SCHEMA_VERSION 증분 시 함께.
- **L-4 IPC MessagePack** / **L-5 클러스터링 파티셔닝**: 실측 트리거 시.
- **Node 24 LTS 전환(T-5)** / **tree-sitter-c-sharp 0.23.6+ 정렬(T-6)**: 신버전·환경 확정 후(node-tree-sitter#268 해소 후).
- **analyze-impact `use_cache` 스키마-default 강제(L-13)**: `args.use_cache ?? true` 미세 개선 — 무해라 우선순위 낮음.
- **major 의존성 bump 검토**: express 5·typescript 6·@types/node 25·commander 15 — 핀 변경 + 호환성 검토 수반이라 *별도 사이클*에서 신중히(즉시 비권장).
