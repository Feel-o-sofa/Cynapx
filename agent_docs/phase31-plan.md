# Phase 31 작업 계획 — diagnostic-v28 대응

> **작성**: 2026-06-16 / **기준 문서**: `agent_docs/diagnostic-v28.md` (기준 커밋 `8b4d68f`, Phase 30 + Phase 30-1 완료 — `npm update`로 within-pin lockfile 드리프트 3건 정렬(P30-1, `zod` 4.3.6→4.4.3·`@types/node` 20.19.33→20.19.43·`vitest` 4.1.2→4.1.9, lockfile-only·핀 무변경))
> **목표**: diagnostic-v28이 식별한 **무위험 actionable 1건(M-1 v28)** 을 해소한다. **M-1 v28**: `src/indexer/language-registry.ts`의 `getProvider()` — *모든 파일 인덱싱 연산에서 호출되는 확장자→언어 매핑 함수*(라이브 핫패스)의 *확장자 추출 엣지케이스*(무-확장자·미지·dotfile·trailing-dot·multi-dot)가 직접 단언되지 않는 게이트 공백을 `tests/language-registry.test.ts`에 케이스 추가로 닫는다(테스트-only·prod 코드 무변경). 이는 diagnostic-v26 신규/v27 승계 **L-18(`getProvider` 확장자 엣지케이스, "비-actionable 추적")을 *마지막 남은 내부 actionable로 승격*한 것이다** — *모든 상위 내부 각도(graph 시딩 게이트 M-1 v26/P29-1·lockfile within-pin 정렬 M-1 v27/P30-1)가 소진된 지금* `getProvider` 엣지케이스 게이트가 *유일하게 남은 내부 actionable*이기 때문이다. v26/v27이 L-18을 비-actionable로 둔 이유는 *그 시점에 더 우선순위 높은 내부 항목이 존재*했기 때문이며 — 그 항목들이 모두 닫힌 지금 L-18은 *자연스러운 다음 후보*다(0-의존 pure-function 게이트). 계속 보류/이연/추적 항목(L-2~L-9, L-13, L-14, L-19)은 추적만 갱신하고 L-18은 M-1 v28 → P31-1로 승격 처리(추적 종료 예정), L-17(within-pin lockfile)은 P30-1에서·L-16(express)은 P28-2에서·L-11(better-sqlite3)·L-15(vite)는 이전 사이클에서 이미 해소다(3장).
>
> **맥락**: v22는 graph/ 엔진 처방 5종 진입 로직을, v23은 핸들러 보조 핵심 순수 로직(`mergeResultsRRF`, P26-1)·`qualified_name` strict 가드(P26-2)를, v24는 `_utils.ts`의 나머지 export 순수 함수(`escapeXml`/`escapeDot`, P27-1)와 better-sqlite3 lockfile(P27-2)을, v25는 공통 유틸 정규화 프리미티브(`toCanonical`, P28-1)와 express lockfile(P28-2)을, v26은 graph 엔진 시딩/env-파싱 프리미티브(`mulberry32`·`parseClusterSeed`·`parseClusterMaxNodes`, P29-1)를, v27은 within-pin lockfile 드리프트(P30-1)를 전수 게이트/정렬했다. 즉 **내부 순수 함수 게이트 발굴 사이클이 레이어별로 소진**됐고 **lockfile 위생(prod-dep·within-pin)도 steady-state**다. v28은 *외부-트리거-only 포스처 도래 후 첫 유지보수 사이클*로 이를 실측 확인했다: **(1) 신규 prod 코드 0**(`git log 8b4d68f` = 테스트-게이트/lockfile/문서 커밋만 — 게이트할 신규 도구/엔드포인트/유틸 0건), **(2) 마지막 남은 내부 후보 승격**(L-18 `getProvider` 엣지케이스 — 상위 내부 항목 전량 소진된 지금 *유일하게 남은 내부 actionable*), **(3) 외부 트리거 모두 정적**(MCP SDK v2 *여전히 pre-alpha*·npm `dist-tags.latest` 1.29.0·2.x dist-tag 부재, 신규 CVE-2026-6991 zod CUID는 *버전(4.4.3 > ≤4.3.6)·기능(`.cuid()` 미사용) 양면 미도달*, audit 0/0, Miasma/Phantom Gyp 미도달, node-tree-sitter#268 open). **따라서 유일한 actionable은 M-1 v28(L-18 승격)**이다. Phase 31은 **`getProvider` 확장자 엣지케이스 게이트(P31-1, 테스트-only) + 추적 갱신**의 *경량 단일-항목 유지보수 사이클*이며, 예상 **2커밋**(diagnostic-v28 + phase31-plan docs 커밋 1 + P31-1 커밋 1, 또는 합본).

---

## 0. 작업 원칙

- P31-1은 **prod 코드 무변경**(테스트-only) — `src/indexer/language-registry.ts`는 *읽기만* 하고 `tests/language-registry.test.ts`에 엣지케이스 케이스만 추가한다. `getProvider()`는 *파일경로 문자열 in → provider/undefined out*의 0-의존 순수 결정 로직이라 픽스처/DB/async 불필요.
- 케이스는 *진단 일자 `npx tsx` 실측값*에 고정한다: `Makefile`→undefined, `foo.xyz`→undefined, `.gitignore`→undefined, `foo.`→undefined, `a.b.py`→python, `Widget.PY`/`Main.TS`→python/typescript(case-insensitive 검증/보강).
- Phase 종료 시(P31-1) `npx vitest run` **그린**(672 → 대략 +5~6 케이스), `npx tsc --noEmit` 그린, `npm audit` 0, `npm audit --omit=dev` 0 확인.
- Phase 종료 시 `agent_docs/diagnostic-v28.md`의 M-1 v28에 `[DONE]` 마킹.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.** (`.git/info/exclude`에 이미 등록 — `git status --short`는 항상 깨끗해야 한다.)
- 한 사이클(1~2 항목) 제한 원칙에 따라, 본 사이클은 **P31-1 단독**(테스트-only)이다 — M-2(추가 actionable)가 없는 *경량 단일-항목* 사이클. 내부 게이트 발굴 소진(L-18 승격이 마지막 후보) + 외부 정적이라 `getProvider` 엣지케이스 게이트가 유일하게 남은 actionable이다.

---

## 1. 의존성 맵

```
P31-1 (getProvider 확장자 엣지케이스 게이트 — 테스트-only·prod 무변경)   독립.
  └─ tests/language-registry.test.ts (LanguageRegistry describe에 엣지케이스 케이스 추가)
        ← src/indexer/language-registry.ts:111-136 getProvider() (읽기만, 수정 없음)
        ← getProvider('Makefile')        → undefined  (무-확장자: pop()='makefile' 미지 ext)
        ← getProvider('foo.xyz')         → undefined  (미지 확장자)
        ← getProvider('.gitignore')      → undefined  (dotfile: pop()='gitignore' 미지 ext)
        ← getProvider('foo.')            → undefined  (trailing-dot: pop()='' → !ext early-return 113줄)
        ← getProvider('a.b.py')          → python     (multi-dot: 마지막 컴포넌트가 언어 결정)
        ← getProvider('Widget.PY')/('Main.TS') → python/typescript (case-insensitive — 이미 게이트, 검증/보강)
        ← 검증: vitest 그린(672 → +5~6)·tsc 그린·audit 0/0
```

```
L-2 (Miasma / Phantom Gyp / Node-gyp)    ──추적만──→  [`npm ls` + in-tree binding.gyp/에이전트 설정 무결성 재대조; 도달 0건 불변]
L-3 (MCP stateless/task 마이그레이션)     ──이연──→  [SDK v2 여전히 pre-alpha; sdk 1.29.0·2.x dist-tag 부재; 2026-07-28 스펙 publish 전후 재확인이 다음 사이클 1순위 외부 트리거]
L-4 (IPC MessagePack)                     ──계속 보류──
L-5 (클러스터 본격 파티셔닝)               ──계속 이연──→  [100k+ 노드 실측 시; 시딩/캡 프리미티브 동작은 P29-1로 게이트 완료]
L-6 (Node 24 tree-sitter 빌드)            ──추적만──→  [node-tree-sitter#268 해소 + Node 24 LTS 전환 시]
L-7 (admin CLI cmd* 게이트 공백)           ──추적만(비-actionable)──
L-8 (worker-pool/embedding/migration 잔여)──추적만(비-actionable)──
L-9 (update-pipeline 클린업 잔여)          ──추적만(비-actionable)──
L-11 (better-sqlite3 lockfile)            ──해소(P27-2 12.11.1 정렬; npm latest)──
L-13 (analyze-impact use_cache 무해)       ──추적만(비-actionable)──
L-14 (CVE-2026-25727 time 크레이트, 미도달)──추적만(비-actionable)──
L-15 (vite dev advisory)                  ──해소(473acf8 ^8.0.16 bump)──
L-16 (express lockfile)                   ──해소(P28-2 4.22.2 정렬)──
L-17 (within-pin lockfile 드리프트)        ──해소(P30-1 zod/@types-node/vitest 정렬)──
L-18 (getProvider 확장자 엣지케이스 공백)  ──승격(→ M-1 v28 → P31-1; 마지막 남은 내부 actionable)──→  [P31-1 완료 시 추적 종료]
L-19 (CVE-2026-6991 zod CUID, 미도달)      ──추적만(비-actionable)──→  [zod 4.4.3 영향 범위 밖 + `.cuid()` 미사용; zod 생태계 모니터링 신호]
```

---

## 2. Phase 31-1: getProvider 확장자 엣지케이스 게이트 (M-1 v28) [예정]

**목표**: `src/indexer/language-registry.ts`의 `getProvider()` — *모든 파일 인덱싱 연산에서 호출되는 확장자→언어 매핑 함수*(라이브 핫패스 — update-pipeline·worker-pool·file-watcher가 인덱싱할 파일마다 호출)의 *확장자 추출 엣지케이스*에 회귀 게이트 추가. **prod 코드 무변경**(테스트-only). 이는 L-18을 *마지막 남은 내부 actionable로 승격*한 것으로 — *모든 상위 내부 각도가 소진된 지금* 0-의존 pure-function 게이트로 닫을 수 있는 유일한 내부 항목이다.

| 입력 (filePath) | 기대 결과 | 분류 | 코드 경로 |
|----------------|-----------|------|-----------|
| `'Makefile'` | `undefined` | 무-확장자 | `split('.').pop()`=`'makefile'` → `extensionMap` 미스(120줄) → undefined(135줄) |
| `'foo.xyz'` | `undefined` | 미지 확장자 | `pop()`=`'xyz'` → `extensionMap` 미스 → undefined |
| `'.gitignore'` | `undefined` | dotfile | `pop()`=`'gitignore'` → `extensionMap` 미스 → undefined |
| `'foo.'` | `undefined` | trailing-dot | `pop()`=`''` → `if (!ext) return undefined`(113줄) |
| `'a.b.py'` | python descriptor | multi-dot | `pop()`=`'py'`(마지막 컴포넌트가 언어 결정) → python |
| `'Widget.PY'` / `'Main.TS'` | python / typescript | case-insensitive | `.toLowerCase()`(112줄) — *이미 111-115줄 게이트*, 검증/보강 |

**제외(엣지케이스 외)**: 정상 확장자 매핑(descriptor별, `language-registry.test.ts:90-100` 이미 커버)·`getAllExtensions()`(102-109줄 이미 커버)는 *재게이트하지 않는다*(M-1 v28은 *엣지케이스 공백*만 보강).

| 항목 | 파일 | 작업 |
|------|------|------|
| 엣지케이스 케이스 추가 | `tests/language-registry.test.ts` | `LanguageRegistry — descriptor-driven registration` describe에 `it('returns undefined for files with no resolvable extension', ...)`(Makefile·foo.xyz·.gitignore·foo.) + `it('resolves multi-dot filenames by the last component', ...)`(a.b.py→python) 추가. case-insensitive(Widget.PY/Main.TS)는 기존 `it('extension lookup is case-insensitive', ...)`(111-115줄)에 포함됐는지 확인 후 *Main.TS 보강*(현재 Main.PY/Widget.Hpp만) |
| prod 무변경 검증 | `src/indexer/language-registry.ts` | `git diff src/indexer/language-registry.ts` = 빈 출력(읽기만) 확인 |
| 베이스라인 재확인 | (검증) | `npx vitest run` 그린(672 → 대략 +5~6), `npx tsc --noEmit` 그린, `npm audit` 0·`npm audit --omit=dev` 0 |
| M-1 v28 마킹 | `agent_docs/diagnostic-v28.md` | M-1 v28에 `[DONE]` + 케이스 수 기록. L-18 추적 종료 마킹 |

**설계 메모**:
- **0-의존 순수 결정 로직**: `getProvider(filePath)`는 *파일경로 문자열 in → provider/undefined out*이다. undefined-반환 케이스(무-확장자·미지·dotfile·trailing-dot)는 *동기·side-effect-free*(grammar 로드 미도달 — `extensionMap` 미스 시 즉시 undefined). multi-dot(`a.b.py`)·case-insensitive(`Widget.PY`)는 *정상 매핑 경로*라 기존 정상-매핑 테스트와 동일하게 `provider.languageName`을 단언하면 된다(grammar 로드는 정상 경로에서 이미 일어나며 기존 90-100줄 테스트와 동형).
- **회귀 안전망 의미**: `split('.').pop()`/`!ext` 가드 회귀(예: trailing-dot 처리 오타·미지-ext fallthrough로 잘못된 provider 반환)는 *정상 매핑 직접 테스트를 우회로* 슬립할 수 있다(정상 테스트는 *유효 ext만* 단언). 엣지케이스 고정값(특히 `undefined` 반환)을 단언하면 그 회귀를 결정적으로 잡는다. `getProvider()`가 *모든 파일 인덱싱의 진입 결정*이라 — 잘못된 매핑은 *전체 인덱스 품질*에 영향(파일이 잘못된 파서로 처리되거나 누락).
- **M-1 v23~v26과의 부류 관계**: M-1 v23(`mergeResultsRRF`)·M-1 v25(`toCanonical`)·M-1 v26(`mulberry32`)과 *동형의 "라이브 핫패스 뒤 0-의존 순수 함수 미커버 게이트"*이되 — *indexer 확장자 매핑 레이어*를 덮는다(과거 게이트는 핸들러 보조·공통 유틸·graph 엔진 시딩에 집중, indexer 매핑은 게이트 발굴 대상이 아니었음). **이 게이트로 내부 순수 함수 게이트 발굴이 완전 소진된다.**
- **승격 정직성**: L-18은 *결함이 아니라 게이트 공백*이다(엣지케이스 전부 정확 처리). v26/v27이 비-actionable로 둔 것은 *틀린 판정이 아니라 우선순위 판정*이었고 — 상위 항목(graph 시딩·lockfile)이 모두 닫힌 지금 *(b) 잣대(작고·저위험·테스트-only)를 충족하는 마지막 내부 후보*로서 처리하는 것이 정직하다.

**테스트**: `npx vitest run` 그린이 1차 검증 산출물. `npx tsc --noEmit` 그린, `npm audit` 0/0.

**산출물**: `tests/language-registry.test.ts`(엣지케이스 케이스 추가) + diagnostic-v28 M-1 `[DONE]`. **리스크: 매우 낮음**(테스트-only, prod 코드 무변경, 0-의존 결정적 케이스, 회귀 검증 vitest + tsc + audit). **이로써 *모든 파일 인덱싱이 의존하는* 확장자→언어 매핑 함수까지 게이트되어 — 내부 순수 함수 게이트 발굴이 완전 소진된다(L-18 종료).**

---

## 3. 보류/이연 항목 판정 (diagnostic-v28 → Phase 31 verdict)

| 항목 | diagnostic-v28 판정 | Phase 31 처리 |
|------|--------------------|---------------|
| **M-1 v28 getProvider 확장자 엣지케이스 게이트** | L-18 승격 — 상위 내부 항목 전량 소진된 지금 마지막 남은 내부 actionable, 테스트-only·prod 무변경 (**verdict: actionable**) | **P31-1에서 해소** |
| **L-2 Miasma / Phantom Gyp / Node-gyp 포스처** | 캠페인 여전히 활발, Cynapx 도달 0건 재대조(binding.gyp 0개) (**verdict: 추적만**) | 추적 상태만 갱신 — `npm ls` + in-tree binding.gyp/설정 재점검 |
| **L-3 MCP stateless/task 마이그레이션** | SDK v2 *여전히 pre-alpha*, npm `dist-tags.latest` 1.29.0·2.x dist-tag 부재, stable Q3 2026[7-28 spec publish] 예정 (**verdict: 계속 이연**) | 범위 제외 — 2026-07-28 전후 2.x dist-tag/v2 stable 재확인이 다음 사이클 1순위 외부 트리거 |
| **L-4 IPC MessagePack** | 성능 문제 미관측 (**verdict: 계속 보류**) | 범위 제외 |
| **L-5 클러스터링 본격 파티셔닝** | count-first 가드(200k) OOM 방어, 시딩/캡 프리미티브 P29-1 게이트 (**verdict: 계속 이연**) | 범위 제외 |
| **L-6 Node 24 tree-sitter 빌드** | node-tree-sitter#268·C++20 fragility 여전히 open (**verdict: 추적**) | 추적 상태만 갱신 |
| **L-7 admin CLI cmd* 게이트 공백** | 모듈-private, 리팩터 수반 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-8 worker-pool/embedding/migration 잔여** | 인접 분기 커버 + flaky 위험 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-9 update-pipeline 클린업 잔여** | (b) 잣대 미충족 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-11 better-sqlite3 lockfile** | P27-2에서 12.11.1 정렬(npm `latest`) (**verdict: 해소**) | 추적 종료 |
| **L-13 analyze-impact use_cache 무해** | 스키마-default 핸들러 미강제, 캐시 비활성=느려질 뿐 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-14 CVE-2026-25727 time 크레이트 (미도달)** | 실제 Rust `time` 크레이트 결함, Cynapx prod 트리 미도달 (**verdict: 추적만, 비-actionable**) | 범위 제외 — tree-sitter Rust 생태계 모니터링 신호로만 추적 |
| **L-15 vite dev advisory** | `473acf8` vite `^8.0.16` bump로 해소 (**verdict: 해소**) | 추적 종료 |
| **L-16 express lockfile** | P28-2에서 4.22.2 정렬 (**verdict: 해소**) | 추적 종료 |
| **L-17 within-pin lockfile 드리프트** | P30-1에서 zod/@types-node/vitest 정렬 (**verdict: 해소**) | 추적 종료 |
| **L-18 getProvider 확장자 엣지케이스 공백** | 모든 상위 내부 각도 소진 → *마지막 남은 내부 actionable*로 승격 (**verdict: M-1 v28로 승격**) | **P31-1에서 처리 → 추적 종료** |
| **L-19 CVE-2026-6991 zod CUID (미도달)** | zod 4.4.3(영향 ≤4.3.6 밖) + `.cuid()` 미사용 + parameterized binding — 삼중 미도달 (**verdict: 추적만, 비-actionable**) | 범위 제외 — zod 생태계 모니터링 신호로만 추적 |

---

## 4. 유지보수 모드 포스처 (외부-트리거-only 전환 — 내부 게이트 마지막 후보 처리)

1. **공급망 위생(매 사이클)**: prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0 유지. 신규 advisory 시 `overrides`/devDependency floor bump로 패치(L-15 vite `^8.0.16` 전례). 의존 추가 시 binding.gyp 검토 + `npm ci` + 매 사이클 `npm ls`/in-tree binding.gyp(현재 0개)·`.claude`/`.cursor`/`.gemini` 설정 재대조(현재 `.claude/launch.json` 양성, 0건 — L-2 Miasma/Phantom Gyp 미도달). **lockfile 드리프트 정기 정렬 — *prod-dep*: better-sqlite3(P27-2 12.11.1)·express(P28-2 4.22.2)·zod(P30-1 4.4.3) 정렬 완료. *within-pin 드리프트*: P30-1로 0(매 사이클 `npm outdated`로 누적 모니터링).** **신규 CVE 도달성 정밀 판정(L-14/L-19 부류)**: 거론된 CVE마다 *버전(영향 범위 vs lockfile)·기능(취약 API 사용 여부)·바인딩(2차 방어)* 삼축으로 도달성을 판정한다 — CVE-2026-6991(zod CUID)이 zod 4.4.3·`.cuid()` 미사용·parameterized binding으로 *삼중 미도달*인 전례(L-19).
2. **MCP SDK v2 stable 배포 모니터링(다음 사이클 1순위 외부 트리거)**: `npm view @modelcontextprotocol/sdk dist-tags`가 *여전히 `{ latest: '1.29.0' }`·2.x dist-tag 부재*(v2 pre-alpha, `2.0.0-alpha.x`는 버전으로만 존재·dist-tag 미노출, stable Q3 2026[**스펙 publish 2026-07-28 — 다음 사이클 시점과 맞물림**]). 2.x dist-tag(`next`/`latest`) 출현 또는 v2 stable 시 L-3 즉시 actionable화(P15-3 `handleMcp()` 설계 메모 출발점). 그 전까지 핀 `^1.29.0` 유지.
3. **런타임 수명주기**: Node 22 LTS·tree-sitter 신버전·tree-sitter-c-sharp 0.23.6+ 출현 시 정렬. Node 24 LTS 전환은 node-tree-sitter#268(L-6) 해소 후. 문서 Node 버전(L-12, P24-2 해소)은 코드와 동기화 유지.
4. **회귀 안전망·핸들러 위생**: 새 도구/REST 라우트/이벤트 핸들러/엔진 비즈니스 로직/핸들러 보조 순수 로직/공통 유틸 순수 함수/엔진 시딩·env-파싱 순수 함수/핸들러 인자 검증/**indexer 확장자 매핑**의 미커버·불일치 발견 시 vitest 케이스 추가(P18-1→…→P29-1→**P31-1** 확장 완료). **내부 순수 함수 게이트 발굴은 P31-1로 완전 소진** — graph/ 엔진 5종 진입 + 시딩/env-파싱 4종 + `qualified_name` 10개 strict 가드 + `_utils.ts` 3개 + `paths.ts` 4종 + **`getProvider` 엣지케이스(P31-1)**가 *모두* 직접 게이트된다. **이후 신규 도구/엔진/핸들러/유틸 추가 시에만 확장**(현재 신규 prod 코드 0 — `git log 8b4d68f`).
5. **외부-트리거-only 포스처(전환 완료)**: Phase 26~30이 *내부 순수 함수 게이트 발굴 사이클*을 레이어별로 소진했고 *lockfile 위생*(prod-dep·within-pin)도 닫혔으며 — **Phase 31이 *마지막 남은 내부 후보 L-18(`getProvider` 엣지케이스)*를 처리**한다. 따라서 **Phase 31 이후 사이클은 *전적으로 외부-트리거 기반*으로 전환된다** — 즉 (a) 새 도구/엔진/핸들러/유틸이 *추가될 때만* 신규 게이트, (b) `npm audit`(prod)·lockfile 드리프트 정기 재스캔 + 신규 CVE 도달성 삼축 판정, (c) **MCP SDK v2 stable 전환(L-3, 2026-07-28 스펙 publish 전후 — 다음 사이클의 1순위)**·node-tree-sitter#268 해소(L-6)·tree-sitter-c-sharp 0.23.6+ 같은 *외부 상태 변화* 트리거. **이에 따라 향후 사이클을 *더 긴 간격*(예: 격주/월간 외부 CVE·SDK·공급망 재스캔 위주)으로 옮기거나, 코드 변경이 없는 사이클은 *외부 컨텍스트 재조사 + 추적 갱신만의 경량 doc-only 사이클*로 운영하는 것을 권장한다.** 단 매 사이클 (b)(c)의 외부 재스캔은 계속 유지한다(공급망/CVE는 시간 의존적). **특히 다음 사이클은 2026-07-28 MCP v2 스펙 publish와 정면으로 맞물려 — v2 stable/2.x dist-tag 재확인이 1순위다.**

---

## 5. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 | 테스트 |
|-------|-----------|---------|--------|--------|
| 31-(docs) | diagnostic-v28 + phase31-plan 신규 docs | 1 | 없음 (docs-only) | 베이스라인 672 (불변) |
| 31-1 [예정] | M-1 v28: `getProvider` 확장자 엣지케이스 게이트(`tests/language-registry.test.ts`에 무-확장자/미지/dotfile/trailing-dot→undefined·multi-dot→python·case-insensitive 보강) — prod 코드 무변경, **vitest 그린**·tsc 그린·audit 0/0 | 1 (31-(docs)와 합본 가능) | 매우 낮음 | **672 → 대략 +5~6 (≈677~678)** |

**총 2개 커밋(P31-1 단독 + docs, 또는 합본).** 본 사이클은 *M-2(추가 actionable)가 없는 경량 단일-항목* 사이클이다 — 내부 게이트 발굴 소진(L-18 승격이 마지막 후보) + 외부 정적이라 `getProvider` 엣지케이스 게이트가 유일하게 남은 actionable이다.

> **베이스라인/타깃 테스트 수**: 현재 **672**(47 파일). P31-1은 `getProvider` 엣지케이스 케이스 추가로 **대략 +5~6**(무-확장자·미지·dotfile·trailing-dot을 묶은 1~2 `it` + multi-dot 1 `it` + case-insensitive Main.TS 보강 — vitest는 `it` 단위로 카운트하므로 정확 증분은 구현 시 확정)이며, **타깃 ≈ 677~678**(머신 변동·묶음 방식에 따라 ±). docs-only 커밋(31-(docs))은 672 불변.

> **깊은 steady-state 안내**: Phase 26~30이 핸들러 보조·공통 유틸·graph 엔진 시딩 순수 함수 레이어 + lockfile 위생(prod-dep·within-pin)을 마무리했고 — **Phase 31은 *내부 순수 함수 게이트 발굴 사이클의 마지막 후보인 L-18(`getProvider` 엣지케이스)*를 처리해 *모든 파일 인덱싱이 의존하는 확장자→언어 매핑 함수*까지 게이트한다.** 따라서 Phase 31 이후는 *전적으로 외부-트리거 기반*(새 코드 추가 시 게이트·외부 CVE/SDK/공급망 재스캔)으로 전환되는 *깊은 steady-state*이며 — 4장 5절의 *외부-트리거-only 포스처*(더 긴 간격·외부 재스캔 위주·doc-only 경량 사이클)가 그 운영 지침이다. **다음 사이클의 1순위 외부 트리거는 2026-07-28 MCP SDK v2 스펙 publish 전후의 v2 stable/2.x dist-tag 출현 재확인(L-3)이다.**

---

## 6. 향후 후보 (Phase 31 범위 밖 — 기록 유지)

- **MCP transport v2 마이그레이션(L-3, 다음 사이클 1순위)**: SDK v2 여전히 pre-alpha(npm `dist-tags.latest` 1.29.0·2.x dist-tag 부재). `@modelcontextprotocol/sdk`가 2.x dist-tag로 전환되거나 v2 stable(Q3 2026, **스펙 publish 2026-07-28 — 다음 사이클 시점**) 시 P15-3 설계 메모 기반 착수. **2026-07-28 전후 dist-tag 재확인이 핵심 트리거.**
- **사이클 포커스 전환(4장 5절)**: 내부 순수 함수 게이트 완전 소진(P31-1) + lockfile 정렬 소진(P30-1)에 따라 향후 사이클을 *전적으로 외부-트리거 기반*(새 코드 추가 시 게이트·prod audit/lockfile 정기 재스캔·MCP SDK v2 stable·node-tree-sitter#268 해소)으로 전환 — 더 긴 간격 또는 doc-only 경량 사이클 운영 권장.
- **lockfile 드리프트 정기 모니터링(L-11/L-16/L-17 후속)**: P27-2(better-sqlite3)·P28-2(express) prod-dep + P30-1(within-pin) 정렬 후 드리프트 0. 매 사이클 `npm outdated`로 native/핵심 prod 의존 드리프트 누적 추적 — 다음 누적 시 재정렬.
- **신규 CVE 도달성 삼축 판정(L-14/L-19 후속)**: tree-sitter/zod/SQLite 등 의존 생태계의 신규 CVE는 *버전·기능·바인딩* 삼축으로 도달성 판정(CVE-2026-6991 zod CUID = 삼중 미도달 전례). 미도달이라도 모니터링 신호로 기록.
- **SCIP export**: P18-1 + P19-1 디딤돌 마련 완료, protobuf 의존 부담으로 즉시 비권장. CodeGraph/Serena 생태계 상호운용 신호 시 재검토.
- **L-9 잔여 클린업**: update-pipeline `withWriteTransaction()` 추출, progress `log.error` 재분류, 빈 catch 2건 — update-pipeline 리팩터 페이즈로.
- **admin CLI 게이트화(L-7)** / **worker-pool/embedding/migration 게이트화(L-8)**: 각각 핸들러 export 리팩터 / SCHEMA_VERSION 증분 시 함께.
- **L-4 IPC MessagePack** / **L-5 클러스터링 파티셔닝**: 실측 트리거 시.
- **Node 24 LTS 전환** / **tree-sitter-c-sharp 0.23.6+ 정렬**: 신버전·환경 확정 후(node-tree-sitter#268 해소 후).
- **analyze-impact `use_cache` 스키마-default 강제(L-13)**: 핸들러에서 `args.use_cache ?? true`로 스키마-default를 명시 강제하는 미세 개선 — 무해라 우선순위 낮음.
- **major 의존성 bump 검토**: @types/express 5·express 5·commander 15·typescript 6·@types/node 25 — 핀 변경 + 호환성 검토 수반이라 *별도 사이클*에서 신중히(즉시 비권장). zod 5도 출현 시 별도 검토.
