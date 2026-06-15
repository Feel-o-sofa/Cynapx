# Phase 29 작업 계획 — diagnostic-v26 대응

> **작성**: 2026-06-15 / **기준 문서**: `agent_docs/diagnostic-v26.md` (기준 커밋 `5a77e9b`, Phase 28 + Phase 28-1/28-2 완료 — `toCanonical()` 변환-동작 게이트 + express lockfile 4.22.2 정렬)
> **목표**: diagnostic-v26이 발견한 **무위험 actionable 1건(M-1 v26)** 을 해소한다. **M-1 v26**: `src/graph/graph-engine.ts`의 export 순수 함수 3종 — `mulberry32(seed)`(35-48줄, 결정적 시드 PRNG)·`parseClusterSeed(raw)`(17-24줄, `CYNAPX_CLUSTER_SEED`→seed 파서)·`parseClusterMaxNodes(raw)`(26-32줄, `CYNAPX_CLUSTER_MAX_NODES`→캡 파서) — 은 *클러스터링 결정성(A-5/A-2)의 핵심 시딩·설정 프리미티브*이나 *변환/결정성 동작 자체에 대한 직접 단위 테스트가 0건*이다. `tests/clustering.test.ts`는 *형제* 순수 함수 `fisherYatesShuffle`를 *직접* 게이트(determinism·집합 보존·empty/single, 141-160줄)하면서 — 그 결정성을 *공급하는* `mulberry32`는 *`fisherYatesShuffle([...], mulberry32(123))` 인자로만*(151-152줄) 쓰여 *자체 출력 시퀀스를 한 번도 직접 단언하지 않고*, `parseClusterSeed`/`parseClusterMaxNodes`는 *import조차 안 됨*(env 분기는 `performClustering()` 통합 테스트 214줄로 *간접*으로만 닿음). → `tests/clustering.test.ts`(이미 `mulberry32` import 보유, 13줄)의 `fisherYatesShuffle` describe 옆에 3개 describe 추가(테스트-only, prod 코드 무변경; `parseClusterSeed`/`parseClusterMaxNodes`만 import 추가). 계속 보류/이연/추적 항목(L-2~L-9, L-13, L-14, L-17, L-18)은 추적만 갱신하고 L-11(better-sqlite3)·L-15(vite)·L-16(express)는 이미 해소다(4장).
>
> **맥락**: v22는 graph/ 엔진 처방 5종 진입 로직을, v23은 핸들러 보조 핵심 순수 로직(`mergeResultsRRF`, P26-1)·`qualified_name` strict 가드(P26-2)를, v24는 `_utils.ts`의 나머지 export 순수 함수(`escapeXml`/`escapeDot`, P27-1)와 better-sqlite3 lockfile(P27-2)을, v25는 공통 유틸 정규화 프리미티브(`toCanonical`, P28-1)와 express lockfile(P28-2)을 전수 게이트/정렬했다. 즉 *순수 함수 게이트 각도가 레이어별로 소진*됐다(핸들러 보조·공통 유틸). v26은 *구조적으로 다른 5개 각도(A glob/regex/path-traversal 위험, B indexer 확장자 매핑, C graph 엔진 시딩/env-파싱, D tool 스키마 불변식, E MCP resource/prompt)*를 시도했고 — 그 중 *(C)*에서 진짜 새 미커버 후보를 찾았다(M-1 v26): graph 엔진의 *시딩 PRNG(`mulberry32`)와 env 파서 2종*이 *형제 `fisherYatesShuffle`는 직접 게이트되는데 시딩 원천은 간접뿐*인 비대칭. 나머지 각도는 음성(A 표면 0·D 이미 무결+독립 export 부재·E 커버 존재) 또는 비-actionable 게이트 공백(B getProvider 엣지케이스 → L-18). **그리고 이번 사이클은 *M-2(actionable 의존성 정렬)가 없다* — express prod 드리프트를 P28-2가 닫았고 잔여는 전부 dev-dep within-pin(L-17)이다.** 따라서 Phase 29는 **graph 엔진 시딩/env-파싱 순수 함수 게이트(P29-1, 테스트-only) + 추적 갱신**의 *경량 단일-항목 유지보수 사이클*이며, 예상 **2커밋**(diagnostic-v26 + phase29-plan docs 커밋 1 + P29-1 커밋 1, 또는 합본).

---

## 0. 작업 원칙

- P29-1은 **prod 코드 무변경**(테스트-only) — `mulberry32`/`parseClusterSeed`/`parseClusterMaxNodes`는 `src/graph/graph-engine.ts`에서 export된 순수 함수로, *문자열·숫자 in → 함수/숫자 out*·DB·async·side-effect 의존 0. `tests/clustering.test.ts`는 이미 `import { GraphEngine, fisherYatesShuffle, mulberry32 } from '../src/graph/graph-engine'`(13줄)를 보유하므로 `fisherYatesShuffle` describe 옆에 3개 describe만 추가하면 된다(`parseClusterSeed`/`parseClusterMaxNodes` 2개만 import에 추가).
- Phase 종료 시(P29-1) `npx vitest run` **657 + 신규 케이스 그린**, `npx tsc --noEmit` 그린, `npm audit` 0, `npm audit --omit=dev` 0 확인.
- Phase 종료 시 `agent_docs/diagnostic-v26.md`의 M-1 v26에 `[DONE]` 마킹.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.** (`.git/info/exclude`에 이미 등록 — `git status --short`는 항상 깨끗해야 한다.)
- 한 사이클(1~2 항목) 제한 원칙에 따라, 본 사이클은 **P29-1 단독**(테스트-only)이다 — M-2(의존성 정렬)가 없는 *경량 단일-항목* 사이클. 의존성 위생은 prod-dep 드리프트 0(express P28-2 정렬 완료)이라 정렬 항목이 비었고, 잔여 dev-dep within-pin 드리프트(L-17)는 비-actionable 추적이다.

---

## 1. 의존성 맵

```
P29-1 (graph 엔진 시딩/env-파싱 순수 함수 게이트 — 테스트-only)   독립.
  └─ tests/clustering.test.ts (fisherYatesShuffle describe 옆에 3개 describe 추가)
        ← import { mulberry32 } 이미 보유 (line 13)
        ← parseClusterSeed / parseClusterMaxNodes 만 import에 추가
        ← 숫자/문자열 리터럴만으로 결정적 단언
           (mulberry32: 결정성·[0,1) 범위·시드 민감도·고정 첫-N 시퀀스;
            parseClusterSeed: unset/empty/whitespace/non-finite→undefined·Math.trunc·정상 시드;
            parseClusterMaxNodes: unset/empty/≤0/non-finite→default(200000)·Math.trunc·정상값)
        ← prod 코드 무변경
```

```
L-2 (Miasma / Phantom Gyp / Node-gyp)    ──추적만──→  [`npm ls` + in-tree binding.gyp/에이전트 설정 무결성 재대조; 도달 0건 불변]
L-3 (MCP stateless/task 마이그레이션)     ──이연──→  [SDK v2 여전히 pre-alpha; sdk 1.29.0 불변; stable Q3 2026 전환까지]
L-4 (IPC MessagePack)                     ──계속 보류──
L-5 (클러스터 본격 파티셔닝)               ──계속 이연──→  [100k+ 노드 실측 시; M-1 v26이 시딩/캡 프리미티브 동작만 게이트]
L-6 (Node 24 tree-sitter 빌드)            ──추적만──→  [node-tree-sitter#268 해소 + Node 24 LTS 전환 시]
L-7 (admin CLI cmd* 게이트 공백)           ──추적만(비-actionable)──
L-8 (worker-pool/embedding/migration 잔여)──추적만(비-actionable)──
L-9 (update-pipeline 클린업 잔여)          ──추적만(비-actionable)──
L-11 (better-sqlite3 lockfile)            ──해소(P27-2 12.11.1 정렬)──
L-13 (analyze-impact use_cache 무해)       ──추적만(비-actionable)──
L-14 (CVE-2026-25727 time 크레이트, 미도달)──추적만(비-actionable)──
L-15 (vite dev advisory)                  ──해소(473acf8 ^8.0.16 bump)──
L-16 (express lockfile)                   ──해소(P28-2 4.22.2 정렬)──
L-17 (dev-dep within-pin lockfile 드리프트)──추적만(비-actionable)──→  [@types/node·vitest·zod; 다음 dev 갱신 시 npm update로 정렬]
L-18 (getProvider 확장자 엣지케이스 공백)  ──추적만(비-actionable)──→  [전부 정확 처리; M-1 v26 처리 후 여유 사이클에 묶어도 무방]
```

---

## 2. Phase 29-1: graph 엔진 시딩/env-파싱 순수 함수 게이트 (M-1 v26) [예정]

**목표**: `src/graph/graph-engine.ts`의 export 순수 함수 3종(`mulberry32`·`parseClusterSeed`·`parseClusterMaxNodes`)은 *클러스터링 결정성(A-5/A-2)의 핵심 시딩·설정 프리미티브*이나 *변환/결정성 동작 자체에 대한 직접 단위 테스트가 0건*이다(`tests/clustering.test.ts`는 *형제* `fisherYatesShuffle`만 직접 게이트하고, `mulberry32`는 *인자로만* 쓰여 자체 출력 미단언, env 파서 2종은 import조차 없이 `performClustering()` 통합 테스트로 *간접*으로만 닿음). `fisherYatesShuffle` describe 옆에 결정적 단위 게이트를 추가한다. **prod 코드 무변경**(테스트-only).

| 미커버 로직 (소스 라인) | 내용 | 게이트 케이스 (직접 `npx tsx` 실행으로 확정한 결정적 출력) |
|------------------------|------|---------------|
| `mulberry32()` (39-48) 결정성 | 같은 시드 → 동일 시퀀스 | `mulberry32(42)` 두 인스턴스의 첫 3개 출력이 동일: `[0.6011037519201636, 0.44829055899754167, 0.8524657934904099]` (고정-시퀀스 단언으로 알고리즘 회귀 — `Math.imul` 상수/시프트 오타 — 결정적 검출) |
| `mulberry32()` 출력 범위 | 모든 출력 `[0, 1)` | 10k draw 전부 `>=0 && <1` (min 0.00025·max 0.99996 관측 — 범위 불변식) |
| `mulberry32()` 시드 민감도 | 다른 시드 → 다른 시퀀스 | `mulberry32(0)()` ≠ `mulberry32(1)()` (첫 출력 상이) |
| `parseClusterSeed()` (18-24) | unset/empty/whitespace/non-finite → undefined; 정상 → Math.trunc | `undefined`/`''`/`'   '`/`'abc'`/`'Infinity'` → `undefined`; `'3.9'` → `3`; `'-5.7'` → `-5`; `'42'` → `42` |
| `parseClusterMaxNodes()` (27-32) | unset/empty/≤0/non-finite → default(200000); 정상 → Math.trunc | `undefined`/`''`/`'0'`/`'-100'`/`'abc'` → `200000`; `'1000.9'` → `1000` |

| 항목 | 파일 | 작업 |
|------|------|------|
| 시딩/env-파싱 describe 추가 | `tests/clustering.test.ts` (기존 `fisherYatesShuffle` describe `141-160줄` 옆에 `mulberry32`·`parseClusterSeed`·`parseClusterMaxNodes` describe 추가) | `import { ... mulberry32 }`(13줄)에 `parseClusterSeed`, `parseClusterMaxNodes` 추가. 숫자/문자열 리터럴 in → 숫자/시퀀스 out 결정적 단언. |
| 변환 케이스 | (위 파일) | `mulberry32`: 결정성·`[0,1)` 범위·시드 민감도·고정 첫-3 시퀀스; `parseClusterSeed`: unset/empty/whitespace/non-finite→undefined·trunc(양·음수)·정상 시드; `parseClusterMaxNodes`: unset/empty/≤0/non-finite→default·trunc·정상값. (>=10 케이스) |
| 베이스라인 재확인 | (검증) | `npx vitest run` 657 + 신규 그린, `npx tsc --noEmit` 그린, `npm audit` 0·`npm audit --omit=dev` 0. |
| M-1 v26 마킹 | `agent_docs/diagnostic-v26.md` | M-1 v26에 `[DONE]` + 신규 케이스 수 기록. |

**설계 메모**:
- 3개 함수 모두 *문자열·숫자 in → 함수/숫자 out* 시그니처라 테스트 입력은 리터럴로 충분 — 하니스·픽스처·DB·env-mutation 불필요(P26-1 mergeResultsRRF·P27-1 escapeXml/escapeDot·P28-1 toCanonical과 동형, env-mutation조차 없어 더 가볍다 — `performClustering` 통합 테스트의 `process.env` save/restore 보일러플레이트가 필요 없다).
- **`mulberry32` 고정-시퀀스 단언이 핵심 회귀 가치**: 형제 `fisherYatesShuffle` 직접 테스트는 *seed-내 재현성*(`a===b`)만 단언하고 *절대 시퀀스 값*은 단언하지 않으며, `performClustering` 통합 테스트도 *같은 seed → 같은 클러스터*만 단언한다 — 둘 다 `mulberry32` 내부 알고리즘이 *결정적으로 바뀌어도*(예: `Math.imul(a ^ (a >>> 15), 1 | a)`의 상수 오타) *재현성은 유지되므로 슬립*한다. `mulberry32(42)`의 첫 N개 출력을 *고정값*으로 단언하면 이 우회로를 결정적으로 막는다. 단 고정값은 *현재 알고리즘의 산출물*이므로 — 의도적 알고리즘 변경 시 함께 갱신해야 한다(테스트가 *알고리즘 계약*을 명문화하는 의미).
- **플랫폼 무관**: `mulberry32`는 `>>>`/`Math.imul`/`|0` 기반 32-bit 정수 연산이라 POSIX/win32 무관 결정적이고, `parseClusterSeed`/`parseClusterMaxNodes`는 `Number()`/`Math.trunc`/`Number.isFinite` 기반이라 플랫폼 무관이다(CI Node 22/24 매트릭스 그린 보장).
- 같은 파일의 형제 순수 함수 `fisherYatesShuffle`는 이미 직접 게이트됐으므로(141-160줄), 3개 시딩/env-파싱 함수 게이트는 *`graph-engine.ts` export 순수 함수 게이트 일관성*을 맞추는 의미도 있다(이제 `fisherYatesShuffle`+`mulberry32`+`parseClusterSeed`+`parseClusterMaxNodes` 전부 직접 게이트).

**테스트**: `npx vitest run` 657 + 신규(>=10) 그린이 1차 검증 산출물. `npx tsc --noEmit` 그린, `npm audit` 0/0.

**산출물**: `tests/clustering.test.ts`(시딩/env-파싱 describe 추가) + diagnostic-v26 M-1 `[DONE]`. **리스크: 매우 낮음**(테스트-only, prod 코드 0줄, 의존 0 순수 함수). **이로써 `src/graph/graph-engine.ts`의 시딩 PRNG·env 파서까지 직접 게이트가 확장돼 클러스터링 결정성 정합성(같은 `CYNAPX_CLUSTER_SEED` → 같은 `mulberry32` 시퀀스 → 같은 `fisherYatesShuffle` 순열 → 같은 클러스터 — 재현성 핵심 사슬)에 *시딩 프리미티브 단* 회귀 안전망을 친다.**

---

## 3. 보류/이연 항목 판정 (diagnostic-v26 → Phase 29 verdict)

| 항목 | diagnostic-v26 판정 | Phase 29 처리 |
|------|--------------------|---------------|
| **M-1 v26 graph 엔진 시딩/env-파싱 게이트** | `graph-engine.ts` 핵심 시딩/설정 순수 함수, 직접 테스트 0건, 의존 0 (**verdict: actionable, 테스트-only**) | **P29-1에서 해소** |
| **L-2 Miasma / Phantom Gyp / Node-gyp 포스처** | 캠페인 진행 중, Cynapx 도달 0건 재대조(binding.gyp 0개) (**verdict: 추적만**) | 추적 상태만 갱신 — `npm ls` + in-tree binding.gyp/설정 재점검 |
| **L-3 MCP stateless/task 마이그레이션** | SDK v2 *여전히 pre-alpha*, sdk 1.29.0 불변, stable Q3 2026 예정 (**verdict: 계속 이연**) | 범위 제외 — v2 stable 전환 시 |
| **L-4 IPC MessagePack** | 성능 문제 미관측 (**verdict: 계속 보류**) | 범위 제외 |
| **L-5 클러스터링 본격 파티셔닝** | count-first 가드(200k) OOM 방어 (**verdict: 계속 이연**) | 범위 제외 — M-1 v26이 시딩/캡 *순수 함수 동작*만 게이트(파티셔닝 자체는 이연) |
| **L-6 Node 24 tree-sitter 빌드** | node-tree-sitter#268·C++20 fragility 여전히 open (**verdict: 추적**) | 추적 상태만 갱신 |
| **L-7 admin CLI cmd* 게이트 공백** | 모듈-private, 리팩터 수반 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-8 worker-pool/embedding/migration 잔여** | 인접 분기 커버 + flaky 위험 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-9 update-pipeline 클린업 잔여** | (b) 잣대 미충족 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-11 better-sqlite3 lockfile** | P27-2에서 12.11.1 정렬 (**verdict: 해소**) | 추적 종료 |
| **L-13 analyze-impact use_cache 무해** | 스키마-default 핸들러 미강제, 캐시 비활성=느려질 뿐 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-14 CVE-2026-25727 time 크레이트 (미도달)** | 실제 Rust `time` 크레이트 결함, Cynapx prod 트리 미도달 (**verdict: 추적만, 비-actionable**) | 범위 제외 — tree-sitter Rust 생태계 모니터링 신호로만 추적 |
| **L-15 vite dev advisory** | `473acf8` vite `^8.0.16` bump로 해소 (**verdict: 해소**) | 추적 종료 |
| **L-16 express lockfile** | P28-2에서 4.22.2 정렬 (**verdict: 해소**) | 추적 종료 |
| **L-17 dev-dep within-pin lockfile 드리프트** | `@types/node`/`vitest`/`zod` dev patch/minor, prod 미도달·audit 0/0 불변 (**verdict: 추적만, 비-actionable**) | 범위 제외 — 다음 dev 갱신 시 `npm update`로 정렬 |
| **L-18 getProvider 확장자 엣지케이스 공백** | 무-확장자/미지/dotfile/trailing-dot/multi-dot 전부 정확 처리되나 직접 단언 0 (**verdict: 추적만, 비-actionable**) | 범위 제외 — M-1 v26 처리 후 여유 사이클에 묶어도 무방 |

---

## 4. 유지보수 모드 포스처 ("정기 점검" 이월 + 사이클 전환 제안)

1. **공급망 위생(매 사이클)**: prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0 유지. 신규 advisory 시 `overrides`/devDependency floor bump로 패치(L-15 vite `^8.0.16` 전례). 의존 추가 시 binding.gyp 검토 + `npm ci` + 매 사이클 `npm ls`/in-tree binding.gyp(현재 0개)·`.claude`/`.cursor`/`.gemini` 설정 재대조(현재 `.claude/launch.json` 양성, 0건 — L-2 Miasma/Phantom Gyp 미도달). **lockfile 드리프트 정기 정렬 — *prod-dep*: better-sqlite3(L-11→M-2 v24, P27-2 12.11.1)·express(L-16→M-2 v25, P28-2 4.22.2) 둘 다 정렬 완료, 현재 prod 드리프트 0. *dev-dep within-pin 드리프트*(L-17 `@types/node`/`vitest`/`zod`)는 비-actionable — 다음 dev 갱신 시 `npm update`로 함께 정렬.** 매 사이클 `npm outdated`로 native/핵심 prod 의존 드리프트 누적 모니터링.
2. **MCP SDK v2 stable 배포 모니터링**: `@modelcontextprotocol/sdk` latest가 *여전히 1.29.0*(v2 pre-alpha, stable Q3 2026[7-28 spec publish] 예정). 2.x로 전환(또는 v2 stable)되면 L-3 actionable화. 그 전까지 핀 `^1.29.0` 유지.
3. **런타임 수명주기**: Node 22 LTS·tree-sitter 신버전·tree-sitter-c-sharp 0.23.6+ 출현 시 정렬. Node 24 LTS 전환은 node-tree-sitter#268(L-6) 해소 후. 문서 Node 버전(L-12, P24-2 해소)은 코드와 동기화 유지.
4. **회귀 안전망·핸들러 위생**: 새 도구/REST 라우트/이벤트 핸들러/엔진 비즈니스 로직/**핸들러 보조 순수 로직**/**공통 유틸 순수 함수**/**엔진 시딩·env-파싱 순수 함수**/핸들러 인자 검증의 미커버·불일치 발견 시 vitest 케이스 추가(P18-1→P19-1→P20-1→P22-1→P23-1/2/3→P24-1→P25-1/2→P26-1/2→P27-1→P28-1→**P29-1** 확장). **P29-1로 `src/graph/graph-engine.ts`의 시딩 PRNG `mulberry32`·env 파서 2종까지 직접 게이트 확장**(같은 파일 형제 `fisherYatesShuffle`는 이미 게이트). graph/ 엔진 5종 진입 + **시딩/env-파싱 순수 함수 4종** + `qualified_name` 10개 핸들러 strict 가드(M-2 v22+v23) + `server/tools/_utils.ts` 순수 함수 3개(P26-1/P27-1) + `src/utils/paths.ts` 순수 함수 4종(P28-1 포함) — *회귀 안전망이 핸들러·엔진(진입+시딩)·유틸 레이어 전반에서 steady-state*에 도달. 이후 신규 도구/엔진/핸들러/유틸 추가 시에만 확장.
5. **사이클 간격/포커스 전환 제안(신규)**: Phase 26~29가 *내부 순수 함수 게이트 발굴 사이클*을 레이어별로(핸들러 보조→공통 유틸→graph 엔진 시딩) 사실상 소진했고, *연속되던 prod-dep lockfile 정렬 항목도 P28-2(express)로 비었다*(현 prod 드리프트 0). 따라서 **Phase 29 이후 사이클은 *내부 코드 게이트 발굴이 아니라 외부-트리거 기반*으로 전환**하는 것이 합리적이다 — 즉 (a) 새 도구/엔진/핸들러/유틸이 *추가될 때만* 신규 게이트, (b) `npm audit`(prod)·prod-dep lockfile 드리프트 정기 재스캔, (c) MCP SDK v2 stable 전환(L-3, Q3 2026)·node-tree-sitter#268 해소(L-6)·tree-sitter-c-sharp 0.23.6+ 같은 *외부 상태 변화* 트리거. **이에 따라 향후 사이클을 *더 긴 간격*(예: 격주/월간 외부 CVE·SDK·공급망 재스캔 위주)으로 옮기거나, 코드 변경이 없는 사이클은 *외부 컨텍스트 재조사 + 추적 갱신만의 경량 doc-only 사이클*로 운영하는 선택지를 제안한다.** 단 이는 *제안*이며, 매 사이클 (b)(c)의 외부 재스캔은 계속 유지한다(공급망/CVE는 시간 의존적).

---

## 5. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 29-(docs) | diagnostic-v26 + phase29-plan 신규 docs | 1 | 없음 (docs-only) |
| 29-1 [예정] | M-1 v26: `tests/clustering.test.ts`에 `mulberry32`·`parseClusterSeed`·`parseClusterMaxNodes` 직접 게이트(의존 0 순수 함수, 테스트-only) — PRNG 결정성·`[0,1)` 범위·시드 민감도·고정-시퀀스 + env 파서 unset/empty/non-finite/trunc/default (신규 >=10 케이스, vitest 657→대략 667~669) | 1 (29-(docs)와 합본 가능) | 매우 낮음 |

**총 2개 커밋(P29-1 단독 + docs, 또는 합본).** 본 사이클은 *M-2(의존성 정렬)가 없는 경량 단일-항목* 사이클이다(express prod 드리프트를 P28-2가 닫고, 잔여는 dev-dep within-pin뿐 — L-17 비-actionable).

> **Steady-state 심화 안내**: Phase 26~28이 핸들러 보조·공통 유틸 순수 함수 레이어 게이트를 마무리했고, Phase 29는 그 안전망을 *graph 엔진의 시딩/env-파싱 프리미티브*까지 확장한다. 이로써 graph 엔진(진입+시딩)·핸들러 가드·핸들러 보조 순수 로직·공통 유틸 순수 함수가 모두 게이트되어 — *내부 순수 함수 게이트 발굴 사이클이 사실상 소진*된다. **동시에 연속되던 prod-dep lockfile 정렬 항목도 P28-2(express)로 비었다.** 따라서 Phase 29 이후는 *외부-트리거 기반*(새 코드 추가 시 게이트·외부 CVE/SDK/공급망 재스캔)으로 전환되는 *깊은 steady-state*이며 — 4장 5절의 *사이클 간격/포커스 전환 제안*(더 긴 간격·외부 재스캔 위주·doc-only 경량 사이클)이 그 운영 지침이다.

---

## 6. 향후 후보 (Phase 29 범위 밖 — 기록 유지)

- **사이클 포커스 전환(신규, 4장 5절)**: 내부 순수 함수 게이트 소진 + prod-dep lockfile 정렬 소진에 따라 향후 사이클을 *외부-트리거 기반*(새 코드 추가 시 게이트·prod audit/lockfile 정기 재스캔·MCP SDK v2 stable·node-tree-sitter#268 해소)으로 전환 — 더 긴 간격 또는 doc-only 경량 사이클 운영 검토.
- **MCP transport v2 마이그레이션(L-3)**: SDK v2 여전히 pre-alpha. `@modelcontextprotocol/sdk` latest가 2.x로 전환되거나 v2 stable(Q3 2026, 스펙 publish 7-28) 시 P15-3 설계 메모 기반 착수.
- **getProvider 확장자 엣지케이스 게이트(L-18)**: 무-확장자/미지/dotfile/trailing-dot/multi-dot 직접 단언 — 전부 정확 처리되므로 비-긴급(M-1 v26 처리 후 여유 사이클에 `language-registry.test.ts`로 묶어도 무방).
- **dev-dep lockfile 정렬(L-17)**: `@types/node`/`vitest`/`zod` within-pin 드리프트 — 다음 dev 갱신/리팩터 시 `npm update`로 함께 정렬.
- **lockfile 드리프트 정기 모니터링(L-11/L-16 후속)**: P27-2(better-sqlite3)·P28-2(express) 정렬 후 prod 드리프트 0. 매 사이클 `npm outdated`로 native/핵심 prod 의존 드리프트 누적 추적 — 다음 누적 시 재정렬.
- **SCIP export**: P18-1 + P19-1 디딤돌 마련 완료, protobuf 의존 부담으로 즉시 비권장. CodeGraph/Serena 생태계 상호운용 신호 시 재검토.
- **L-9 잔여 클린업**: update-pipeline `withWriteTransaction()` 추출, progress `log.error` 재분류, 빈 catch 2건 — update-pipeline 리팩터 페이즈로.
- **admin CLI 게이트화(L-7)** / **worker-pool/embedding/migration 게이트화(L-8)**: 각각 핸들러 export 리팩터 / SCHEMA_VERSION 증분 시 함께.
- **L-4 IPC MessagePack** / **L-5 클러스터링 파티셔닝**: 실측 트리거 시.
- **Node 24 LTS 전환** / **tree-sitter-c-sharp 0.23.6+ 정렬**: 신버전·환경 확정 후(node-tree-sitter#268 해소 후).
- **analyze-impact `use_cache` 스키마-default 강제(L-13)**: 핸들러에서 `args.use_cache ?? true`로 스키마-default를 명시 강제하는 미세 개선 — 무해라 우선순위 낮음.
- **L-14 CVE-2026-25727 모니터링**: tree-sitter Rust 생태계 신호 — Cynapx 미도달이나 tree-sitter 코어/그래머 업데이트 시 재확인.
