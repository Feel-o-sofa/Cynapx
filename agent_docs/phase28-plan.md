# Phase 28 작업 계획 — diagnostic-v25 대응

> **작성**: 2026-06-15 / **기준 문서**: `agent_docs/diagnostic-v25.md` (기준 커밋 `ae69a8b`, Phase 27 + Phase 27-1/27-2 완료 — escapeXml/escapeDot 게이트 + better-sqlite3 12.11.1 lockfile 정렬)
> **목표**: diagnostic-v25가 발견한 **무위험 actionable 2건(M-1 v25, M-2 v25)** 을 해소한다. **M-1 v25**: `src/utils/paths.ts`의 순수 함수 `toCanonical(s)`(285-295줄)는 *전 파서(tree-sitter/typescript/markdown/yaml/json-config)·cross-project-resolver·get-related-tests·update-pipeline*의 qualified-name *키 정규화 프리미티브*이나 *변환 동작 자체에 대한 단위 테스트가 0건*(유일한 테스트 O-2는 멱등성·symbolCache 키만 단언) → `tests/phase12-6-commit-b.test.ts`(이미 `toCanonical` import 보유)의 O-2 describe 옆에 변환-동작 describe 추가(테스트-only, prod 코드 무변경). **M-2 v25**: `express` lockfile이 `4.22.1`인데 `npm outdated` Wanted가 `4.22.2`(patch) → clean한 patch bump(4.22.0 erroneous breaking change revert, 직접 CVE 0, semver-호환 핀 `^4.19.2` 무변경)이므로 lockfile-only 정렬(M-2 v24의 better-sqlite3 정렬과 동형). 두 건은 *서로 독립*(다른 부류 — 테스트 게이트 vs 의존성 위생)이나 둘 다 작고(M-1 테스트-only, M-2 lockfile-only) 리스크가 매우 낮아 한 사이클에 함께 처리 가능하다. 계속 보류/이연/추적 항목(L-2~L-9, L-13, L-14)은 추적만 갱신하고 L-11(better-sqlite3)·L-15(vite)는 이미 해소다(4장).
>
> **맥락**: v22는 graph/ 엔진 처방 5종 진입 로직을, v23은 핸들러 보조 핵심 순수 로직(`mergeResultsRRF`, P26-1)·`qualified_name` strict 가드(P26-2)를, v24는 `_utils.ts`의 나머지 export 순수 함수(`escapeXml`/`escapeDot`, P27-1)와 better-sqlite3 lockfile(P27-2)을 전수 게이트/정렬했다. 즉 *"low-hanging fruit" 각도(graph/ 엔진·핸들러 가드·`server/tools/_utils.ts` 순수 함수)는 소진*됐다. v25는 그 *다음*을 *새 레이어(`src/utils/`)*에서 찾았다 — (1) `src/utils/paths.ts`의 핵심 순수 함수 `toCanonical`(전 파서·cross-project·get-related-tests의 키 정규화 프리미티브, 변환 동작 0% 커버 — 같은 파일의 형제 순수 함수 `isPathInside`/`isSystemPath`/`getProjectHash`는 이미 동작까지 게이트됨)이고, P26-1/P27-1과 동형의 0-의존 순수 함수 게이트(M-1 v25); (2) `npm outdated`로 잡힌 express lockfile patch 드리프트(M-2 v24의 better-sqlite3 정렬과 동형, M-2 v25). 둘 다 prod 코드 0줄 변경(M-1 테스트-only, M-2 lockfile-only)이라 리스크가 매우 낮다. 따라서 Phase 28은 **toCanonical 변환 동작 게이트(P28-1) + express lockfile 정렬(P28-2) + 추적 갱신**이며, 예상 **2~3커밋**(diagnostic-v25 + phase28-plan docs 커밋 1 + P28-1 커밋 1 + P28-2 커밋 1, 또는 합본).

---

## 0. 작업 원칙

- P28-1은 **prod 코드 무변경**(테스트-only) — `toCanonical`은 `src/utils/paths.ts:285`에서 export된 순수 함수로, 문자열 in → 문자열 out·DB·async·side-effect 의존 0. `tests/phase12-6-commit-b.test.ts`는 이미 `import { toCanonical } from '../src/utils/paths'`를 보유하므로 O-2 describe 옆에 변환-동작 describe만 추가하면 된다(추가 import 불필요).
- P28-2는 **prod 코드·`package.json` 무변경**(lockfile-only) — `npm i express@4.22.2`(또는 `npm update express`)로 `package-lock.json`의 express 엔트리만 4.22.1→4.22.2 갱신. 핀은 이미 `^4.19.2`(semver-호환)라 `package.json`은 건드리지 않는다. express는 native 모듈이 아니므로 재빌드 불필요 — `npx vitest run` 649 그린(api-server supertest 8 핸들러 — P19-1)·tsc 그린·audit 0/0 재확인.
- Phase 종료 시(P28-1·P28-2) `npx vitest run` **649 + 신규 케이스 그린**, `npx tsc --noEmit` 그린, `npm audit` 0, `npm audit --omit=dev` 0 확인.
- Phase 종료 시 `agent_docs/diagnostic-v25.md`의 M-1 v25·M-2 v25에 `[DONE]` 마킹.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.** (`.git/info/exclude`에 이미 등록 — `git status --short`는 항상 깨끗해야 한다.)
- 한 사이클(1~2 항목) 제한 원칙에 따라, **P28-1·P28-2는 둘 다 작고(테스트-only / lockfile-only) 리스크가 낮아 한 작업 단위로 묶거나 2커밋으로 나눠도 무방**. 둘은 서로 독립(다른 부류)이라 순서 무관. **M-2 v25는 긴급도가 낮으므로(express 4.22.1이 이미 4.22.0 breakage를 회피) 더 가벼운 사이클을 원하면 P28-2를 deferral하고 L-16 추적으로 남겨도 무방** — 그 경우 Phase 28은 P28-1 단독(테스트-only) + 추적 갱신의 *경량 유지보수 사이클*이 된다.

---

## 1. 의존성 맵

```
P28-1 (toCanonical 변환 동작 게이트 — 테스트-only)   독립.
  └─ tests/phase12-6-commit-b.test.ts (O-2 describe 옆에 변환-동작 describe 추가)
        ← import { toCanonical } 이미 보유 (line 18) — 추가 import 불필요
        ← 문자열 리터럴만으로 결정적 단언(역슬래시→슬래시·빈-문자열·drive-letter·
           상대→절대 prepend(+`//` 가드)·소문자·다중-슬래시 축약·trailing-slash 제거)
        ← prod 코드 무변경

P28-2 (express lockfile 4.22.1 → 4.22.2 정렬 — lockfile-only)   독립.
  └─ npm i express@4.22.2 (또는 npm update express)
  └─ package-lock.json express 엔트리만 갱신 (package.json 핀 ^4.19.2 무변경)
  └─ npx vitest run 649 그린(api-server supertest) + tsc 그린 + npm audit 0/0 재확인
```

```
L-2 (Miasma / Phantom Gyp / Node-gyp)    ──추적만──→  [`npm ls` + in-tree binding.gyp/에이전트 설정 무결성 재대조; 도달 0건 불변]
L-3 (MCP stateless/task 마이그레이션)     ──이연──→  [SDK v2 여전히 pre-alpha; sdk 1.29.0 불변; stable Q3 2026 전환까지]
L-4 (IPC MessagePack)                     ──계속 보류──
L-5 (클러스터 본격 파티셔닝)               ──계속 이연──→  [100k+ 노드 실측 시]
L-6 (Node 24 tree-sitter 빌드)            ──추적만──→  [node-tree-sitter#268 해소 + Node 24 LTS 전환 시]
L-7 (admin CLI cmd* 게이트 공백)           ──추적만(비-actionable)──
L-8 (worker-pool/embedding/migration 잔여)──추적만(비-actionable)──
L-9 (update-pipeline 클린업 잔여)          ──추적만(비-actionable)──
L-11 (better-sqlite3 lockfile)            ──해소(P27-2 12.11.1 정렬)──
L-13 (analyze-impact use_cache 무해)       ──추적만(비-actionable)──
L-14 (CVE-2026-25727 time 크레이트, 미도달)──추적만(비-actionable)──
L-15 (vite dev advisory)                  ──해소(473acf8 ^8.0.16 bump)──
L-16 (express lockfile)                   ──해소-승격 → M-2 v25 (P28-2)──
```

---

## 2. Phase 28-1: toCanonical 변환 동작 게이트 (M-1 v25) [DONE]

**목표**: `src/utils/paths.ts`의 `toCanonical(s)`(285-295줄)는 *전 파서·cross-project-resolver·get-related-tests·update-pipeline*의 qualified-name *키 정규화 프리미티브*이나 *변환 동작 자체에 대한 단위 테스트가 0건*이다(`tests/phase12-6-commit-b.test.ts`의 유일한 O-2 테스트는 `toCanonical(toCanonical(x))===toCanonical(x)` 멱등성·symbolCache 키 round-trip만 단언하고, *어떤 입력이 무엇으로 정규화되는지*는 단언하지 않음). O-2 describe 옆에 결정적 변환-동작 게이트를 추가한다. **prod 코드 무변경**(테스트-only).

| 미커버 로직 (소스 라인) | 내용 | 게이트 케이스 (직접 `npx tsx` 실행으로 확정한 결정적 출력, POSIX) |
|------------------------|------|---------------|
| line 287 `replace(/\\/g, '/')` | 역슬래시 → 슬래시 정규화 | `'src\\windows\\path.ts'` → `'src/windows/path.ts'` |
| line 286 `if (!s) return ''` | 빈-문자열 early-return | `''` → `''` |
| line 288 `/^[a-zA-Z]:/` | 드라이브-레터 감지(prepend 생략) | `'C:\\Foo\\Bar'` → `'c:/foo/bar'` (드라이브-레터라 cwd prepend 안 함, 역슬래시→슬래시 + 소문자) |
| line 290-293 (상대→절대 prepend) | `startsWith('/') && !startsWith('//')`일 때만 cwd 루트 prepend; `//`(UNC-유사)는 prepend 생략 | `'/Abs/Path/File.TS'` → `'/abs/path/file.ts'`(POSIX 루트 `/` prepend는 no-op·소문자); `'//unc/share'` → `'/unc/share'`(prepend 생략 + 다중-슬래시 축약); `'rel/path/x.ts'` → `'rel/path/x.ts'`(leading-slash 없음 → prepend 안 함) |
| line 294 `.toLowerCase()` | 소문자화 | `'Already/Lower/'` → `'already/lower'` |
| line 294 `.replace(/\/+/g, '/')` | 다중-슬래시 축약 | `'a//b///c/'` → `'a/b/c'` (여러 `/`가 하나로) |
| line 294 `.replace(/\/$/, '')` | trailing-slash 제거 | `'Already/Lower/'` → `'already/lower'`(끝 `/` 제거); `'a//b///c/'` → `'a/b/c'` |

| 항목 | 파일 | 작업 |
|------|------|------|
| 변환-동작 describe 추가 | `tests/phase12-6-commit-b.test.ts` (기존 O-2 describe `22-39줄` 옆에 `toCanonical 변환 동작` describe 추가) | 기존 `import { toCanonical } from '../src/utils/paths'`(line 18) 재사용. 문자열 리터럴 in → 문자열 out 결정적 단언. |
| 변환 케이스 | (위 파일) | 역슬래시→슬래시·빈-문자열·drive-letter·상대→절대 prepend(+`//` 가드, 상대경로 무-prepend)·소문자·다중-슬래시 축약·trailing-slash 제거. (>=7 케이스) |
| 베이스라인 재확인 | (검증) | `npx vitest run` 649 + 신규 그린, `npx tsc --noEmit` 그린, `npm audit` 0·`npm audit --omit=dev` 0. |
| M-1 v25 마킹 | `agent_docs/diagnostic-v25.md` | M-1 v25에 `[DONE]` + 신규 케이스 수 기록. |

**설계 메모**:
- `toCanonical`은 `(s: string): string` 시그니처(285줄)라 테스트 입력은 문자열 리터럴로 충분 — 하니스·픽스처·DB 불필요(P26-1 mergeResultsRRF·P27-1 escapeXml/escapeDot과 동형, 더 가벼움).
- **상대→절대 prepend 분기가 핵심 정합성 속성**: line 290-293은 `res.startsWith('/') && !res.startsWith('//')`일 때만 `path.parse(process.cwd()).root`(POSIX `/`, win32 `C:\`)를 prepend한다. POSIX에서 루트가 `/`라 leading-slash 입력의 prepend는 멱등(no-op)이지만 — `//`(UNC-유사) 입력은 *prepend를 건너뛰고* 다중-슬래시 축약(`/\/+/g`)만 받아 `/unc/share`가 된다. 이 `//` 가드와 leading-slash 무-prepend(상대경로 `'rel/path'`)는 *플랫폼-인지 정규화 정합성*이라 회귀 가치가 명확 — `'rel/path/x.ts'`→`'rel/path/x.ts'`(NOT `/.../rel/path/x.ts`)·`'//unc/share'`→`'/unc/share'`를 단언하면 이 속성을 결정적으로 게이트한다.
- **POSIX 결정성**: 위 게이트 출력은 cwd 루트가 `/`인 POSIX(CI Node 22/24 매트릭스 + 본 진단 환경)에서 결정적이다. win32에서는 cwd 루트가 `C:\`라 leading-slash 입력의 prepend 결과가 달라질 수 있으므로 — 게이트 입력은 *드라이브-레터 입력*(`'C:\\Foo\\Bar'`, 플랫폼 무관)·*상대경로*(`'rel/path/x.ts'`, prepend 안 함)·*역슬래시 정규화/소문자/다중-슬래시/trailing-slash*(플랫폼 무관) 위주로 구성하고, leading-slash prepend 케이스는 POSIX-결정적 출력으로 한정한다(CI가 POSIX이므로 안전 — 단 win32-민감 케이스는 피하거나 `path.parse(process.cwd()).root` 기반 동적 기대값을 쓴다).
- 같은 파일의 형제 순수 함수(`isPathInside`/`isSystemPath`/`getProjectHash`)는 이미 *동작*까지 게이트됐으므로(security.test/initialize-project.test/phase13-8-b), `toCanonical` 변환 동작 게이트는 *`src/utils/paths.ts` 순수 함수 게이트 일관성*을 맞추는 의미도 있다.

**테스트**: `npx vitest run` 649 + 신규(>=7) 그린이 1차 검증 산출물. `npx tsc --noEmit` 그린, `npm audit` 0/0.

**산출물**: `tests/phase12-6-commit-b.test.ts`(변환-동작 describe 추가) + diagnostic-v25 M-1 `[DONE]`. **리스크: 매우 낮음**(테스트-only, prod 코드 0줄, 의존 0 순수 함수). **이로써 `src/utils/paths.ts`의 핵심 순수 함수 `toCanonical`까지 변환 동작 게이트가 확장돼 키 정규화 정합성(역슬래시/대소문자/trailing-slash 변형 → 동일 canonical 키 수렴)에 회귀 안전망을 친다.**

---

## 3. Phase 28-2: express lockfile 4.22.1 → 4.22.2 정렬 (M-2 v25) [DONE]

**목표**: `express` lockfile이 `4.22.1`인데 `npm outdated` Wanted가 `4.22.2`로 드리프트(patch). 4.22.2는 clean한 patch bump(4.22.0의 erroneous extended-query-parser breaking change를 완전 revert, 직접 CVE 0건 — CVE-2024-51999 rejected)이고 `package.json` 핀이 `^4.19.2`(semver-호환)라 *lockfile만* 갱신하면 정렬된다. M-2 v24(better-sqlite3 12.10.0→12.11.1 lockfile 정렬)와 동형의 lockfile-only 의존성 위생 항목이다. **긴급도 낮음**: 직접 express는 이미 4.22.1로 4.22.0 breakage를 회피한 상태라 4.22.2는 순수 유지보수 정렬(동작 변화·보안 결함 무관).

| 항목 | 파일 | 작업 |
|------|------|------|
| lockfile 정렬 | `package-lock.json` (express 엔트리만) | `npm i express@4.22.2`(또는 `npm update express`) 실행 → `package-lock.json`의 express `version`/`resolved`/`integrity` 및 transitive(있으면) 엔트리 갱신. **`package.json`은 무변경**(핀 `^4.19.2` semver-호환). |
| 베이스라인 재확인 | (검증) | `npx vitest run` 649 그린(api-server supertest — api-server-http/hotspots/security/healthz 8 핸들러 전부 그린), `npx tsc --noEmit` 그린, `npm audit` 0·`npm audit --omit=dev` 0, `npm ls express` = 4.22.2 확인. |
| M-2 v25 마킹 | `agent_docs/diagnostic-v25.md` | M-2 v25에 `[DONE]` + 정렬 버전 기록(4.22.1→4.22.2). |

**설계 메모**:
- **lockfile-only 변경 — prod/test 코드·`package.json` 0줄.** express는 native 모듈이 아니므로 재빌드 불필요. 4.22.2는 patch라 API 동작 동일(4.22.0 breakage revert이므로 4.22.1과 동작 동등).
- 검증의 핵심은 *api-server supertest 8 핸들러 그린*이다 — express 라우팅/미들웨어(json limit·rate-limit·Bearer·error handler)가 4.22.2에서도 동일하게 동작하는지 649 회귀 게이트로 확인.
- 만약 4.22.2 정렬 후 *예상치 못한 audit 신규 항목/테스트 실패*가 관측되면(가능성 매우 낮음), 4.22.1 유지 + L-16 추적으로 롤백하고 사유를 diagnostic-v25에 기록한다(no-regression 원칙).
- **deferral 옵션**: M-2 v25는 긴급도가 낮으므로(이미 breakage 회피) Phase 28을 *경량 유지보수 사이클*로 가져가려면 P28-2를 건너뛰고 L-16 추적으로 남겨도 된다 — 그 경우 다음 사이클 `npm outdated`에서 재평가.

**테스트**: `npx vitest run` 649 그린(신규 케이스 없음 — lockfile 정렬은 회귀 미발생 확인이 산출물). `npx tsc --noEmit` 그린, `npm audit` 0/0, `npm ls express` = 4.22.2.

**산출물**: `package-lock.json`(express 엔트리 갱신) + diagnostic-v25 M-2 `[DONE]`. **리스크: 매우 낮음**(lockfile-only, semver-호환 patch bump, CVE 0, api-server supertest 649 회귀 게이트).

---

## 4. 보류/이연 항목 판정 (diagnostic-v25 → Phase 28 verdict)

| 항목 | diagnostic-v25 판정 | Phase 28 처리 |
|------|--------------------|---------------|
| **M-1 v25 toCanonical 변환 동작 게이트** | `src/utils/` 핵심 순수 함수, 변환 동작 0% 커버, 의존 0 (**verdict: actionable, 테스트-only**) | **P28-1에서 해소** |
| **M-2 v25 express lockfile 4.22.1→4.22.2** | clean patch(4.22.0 breakage revert), semver-호환, 긴급도 낮음 (**verdict: actionable, lockfile-only**) | **P28-2에서 해소(또는 L-16 추적 deferral)** |
| **L-2 Miasma / Phantom Gyp / Node-gyp 포스처** | 캠페인 진행 중, Cynapx 도달 0건 재대조(binding.gyp 0개) (**verdict: 추적만**) | 추적 상태만 갱신 — `npm ls` + in-tree binding.gyp/설정 재점검 |
| **L-3 MCP stateless/task 마이그레이션** | SDK v2 *여전히 pre-alpha*, sdk 1.29.0 불변, stable Q3 2026 예정 (**verdict: 계속 이연**) | 범위 제외 — v2 stable 전환 시 |
| **L-4 IPC MessagePack** | 성능 문제 미관측 (**verdict: 계속 보류**) | 범위 제외 |
| **L-5 클러스터링 본격 파티셔닝** | count-first 가드(200k) OOM 방어 (**verdict: 계속 이연**) | 범위 제외 |
| **L-6 Node 24 tree-sitter 빌드** | node-tree-sitter#268·C++20 fragility 여전히 open (**verdict: 추적**) | 추적 상태만 갱신 |
| **L-7 admin CLI cmd* 게이트 공백** | 모듈-private, 리팩터 수반 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-8 worker-pool/embedding/migration 잔여** | 인접 분기 커버 + flaky 위험 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-9 update-pipeline 클린업 잔여** | (b) 잣대 미충족 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-11 better-sqlite3 lockfile** | P27-2에서 12.11.1 정렬 (**verdict: 해소**) | 추적 종료 |
| **L-13 analyze-impact use_cache 무해** | 스키마-default 핸들러 미강제, 캐시 비활성=느려질 뿐 (**verdict: 추적만, 비-actionable**) | 범위 제외 |
| **L-14 CVE-2026-25727 time 크레이트 (미도달)** | 실제 Rust `time` 크레이트 결함, Cynapx prod 트리 미도달 (**verdict: 추적만, 비-actionable**) | 범위 제외 — tree-sitter Rust 생태계 모니터링 신호로만 추적 |
| **L-15 vite dev advisory** | `473acf8` vite `^8.0.16` bump로 해소 (**verdict: 해소**) | 추적 종료 |
| **L-16 express lockfile** | 드리프트 patch, clean bump, 긴급도 낮음 (**verdict: 해소-승격 → M-2 v25**) | **P28-2에서 해소(또는 deferral)** |

---

## 5. 유지보수 모드 포스처 ("정기 점검" 이월)

1. **공급망 위생(매 사이클)**: prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0 유지. 신규 advisory 시 `overrides`/devDependency floor bump로 패치(L-15 vite `^8.0.16` 전례). 의존 추가 시 binding.gyp 검토 + `npm ci` + 매 사이클 `npm ls`/in-tree binding.gyp(현재 0개)·`.claude`/`.cursor`/`.gemini` 설정 재대조(현재 `.claude/launch.json` 양성, 0건 — L-2 Miasma/Phantom Gyp 미도달). **lockfile 드리프트 정기 정렬 — better-sqlite3(L-11→M-2 v24, P27-2 12.11.1)·express(L-16→M-2 v25, P28-2 4.22.2). 매 사이클 `npm outdated`로 native/핵심 의존 드리프트 누적 모니터링.**
2. **MCP SDK v2 stable 배포 모니터링**: `@modelcontextprotocol/sdk` latest가 *여전히 1.29.0*(v2 pre-alpha, stable Q3 2026 예정). 2.x로 전환(또는 v2 stable)되면 L-3 actionable화. 그 전까지 핀 `^1.29.0` 유지.
3. **런타임 수명주기**: Node 22 LTS·tree-sitter 신버전·tree-sitter-c-sharp 0.23.6+ 출현 시 정렬. Node 24 LTS 전환은 node-tree-sitter#268 해소 후. 문서 Node 버전(L-12, P24-2 해소)은 코드와 동기화 유지.
4. **회귀 안전망·핸들러 위생**: 새 도구/REST 라우트/이벤트 핸들러/엔진 비즈니스 로직/**핸들러 보조 순수 로직**/**공통 유틸 순수 함수**/핸들러 인자 검증의 미커버·불일치 발견 시 vitest 케이스 추가(P18-1→P19-1→P20-1→P22-1→P23-1/2/3→P24-1→P25-1/2→P26-1/2→P27-1→**P28-1** 확장). **P28-1로 `src/utils/paths.ts`의 핵심 순수 함수 `toCanonical`까지 변환 동작 게이트 확장**(같은 파일 형제 `isPathInside`/`isSystemPath`/`getProjectHash`는 이미 동작 게이트). graph/ 엔진 5종 + `qualified_name` 10개 핸들러 strict 가드(M-2 v22+v23) + `server/tools/_utils.ts` 순수 함수 3개(P26-1/P27-1) + `src/utils/paths.ts` 순수 함수 — *회귀 안전망이 핸들러·엔진·유틸 레이어 전반에서 steady-state*에 도달. 이후 신규 도구/엔진/핸들러/유틸 추가 시에만 확장.

---

## 6. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 28-(docs) | diagnostic-v25 + phase28-plan 신규 docs | 1 | 없음 (docs-only) |
| 28-1 [DONE] | M-1 v25: `tests/phase12-6-commit-b.test.ts`에 `toCanonical` 변환 동작 게이트(의존 0 순수 함수, 테스트-only) — 역슬래시→슬래시·빈-문자열·drive-letter·상대→절대 prepend(+`//` 가드)·소문자·다중-슬래시 축약·trailing-slash 제거 (신규 8 케이스, vitest 649→657) | 1 | 매우 낮음 |
| 28-2 [DONE] | M-2 v25: express lockfile 4.22.1→4.22.2 정렬(lockfile-only, `package.json` 무변경) + 657 그린(api-server supertest)·audit 0/0 재확인 | 1 (28-1과 합본 가능) | 매우 낮음 |

**총 2~3개 커밋(P28-1·P28-2 분리/합본).** 두 항목은 서로 독립(다른 부류 — 테스트 게이트 vs 의존성 위생)이라 순서 무관·합본 무방(둘 다 작고 리스크 낮음 — 1~2항목 제한 원칙 부합). **M-2 v25는 긴급도가 낮아 deferral(L-16 추적)도 합리적 선택** — 그 경우 Phase 28은 P28-1 단독의 경량 유지보수 사이클.

> **Steady-state 심화 안내**: Phase 27이 `server/tools/_utils.ts` 순수 함수 100% 커버 + better-sqlite3 lockfile 정렬로 *핸들러 보조 레이어*의 게이트 발굴을 마무리했고, Phase 28은 그 안전망을 *공통 유틸 레이어(`src/utils/paths.ts` toCanonical)*까지 확장한다. 이로써 graph/ 엔진·핸들러 가드·핸들러 보조 순수 로직·공통 유틸 순수 함수가 모두 게이트되어 — *내부 코드/테스트 게이트 발굴 사이클이 사실상 소진*된다. 이후 사이클은 (1) 새 도구/엔진/핸들러/유틸 추가 시의 신규 게이트, (2) 공급망 위생(audit·lockfile 드리프트) 정기 점검, (3) MCP SDK v2 stable 전환(L-3) 같은 *외부 트리거 기반* 항목으로 전환된다. 즉 Phase 28 이후는 유지보수 모드 포스처(5장)가 주도하는 *깊은 steady-state*다.

---

## 7. 향후 후보 (Phase 28 범위 밖 — 기록 유지)

- **MCP transport v2 마이그레이션(L-3)**: SDK v2 여전히 pre-alpha. `@modelcontextprotocol/sdk` latest가 2.x로 전환되거나 v2 stable(Q3 2026, 스펙 publish 7-28) 시 P15-3 설계 메모 기반 착수.
- **lockfile 드리프트 정기 모니터링(L-11/L-16 후속)**: P27-2(better-sqlite3 12.11.1)·P28-2(express 4.22.2) 정렬 후에도 매 사이클 `npm outdated`로 native/핵심 의존 드리프트 누적 추적 — 다음 누적 시 재정렬.
- **SCIP export**: P18-1 + P19-1 디딤돌 마련 완료, protobuf 의존 부담으로 즉시 비권장. CodeGraph/Serena 생태계 상호운용 신호 시 재검토.
- **L-9 잔여 클린업**: update-pipeline `withWriteTransaction()` 추출, progress `log.error` 재분류, 빈 catch 2건 — update-pipeline 리팩터 페이즈로.
- **admin CLI 게이트화(L-7)** / **worker-pool/embedding/migration 게이트화(L-8)**: 각각 핸들러 export 리팩터 / SCHEMA_VERSION 증분 시 함께.
- **L-4 IPC MessagePack** / **L-5 클러스터링 파티셔닝**: 실측 트리거 시.
- **Node 24 LTS 전환** / **tree-sitter-c-sharp 0.23.6+ 정렬**: 신버전·환경 확정 후(node-tree-sitter#268 해소 후).
- **analyze-impact `use_cache` 스키마-default 강제(L-13)**: 핸들러에서 `args.use_cache ?? true`로 스키마-default를 명시 강제하는 미세 개선 — 무해라 우선순위 낮음.
- **L-14 CVE-2026-25727 모니터링**: tree-sitter Rust 생태계 신호 — Cynapx 미도달이나 tree-sitter 코어/그래머 업데이트 시 재확인.
