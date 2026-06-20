# Phase 30 작업 계획 — diagnostic-v27 대응

> **작성**: 2026-06-16 / **기준 문서**: `agent_docs/diagnostic-v27.md` (기준 커밋 `a71d916`, Phase 29 + Phase 29-1 완료 — `graph-engine.ts` 시딩/env-파싱 순수 함수 3종 직접 게이트(P29-1, vitest 657→672))
> **목표**: diagnostic-v27이 식별한 **무위험 actionable 1건(M-1 v27)** 을 해소한다. **M-1 v27**: `npm outdated`가 보고한 within-pin(semver-호환) lockfile 드리프트 3건 — `zod` 4.3.6→**4.4.3**(*prod-dep*, `^4.3.6` 핀-내 minor, `src/server/api-server.ts` 도달 + MCP SDK dedupe), `@types/node` 20.19.33→**20.19.43**(dev-dep, `^20.12.7` 핀-내 patch), `vitest` 4.1.2→**4.1.9**(dev-dep, `^4.1.2` 핀-내 patch) — 을 `npm update`로 lockfile 정렬한다(`package.json` 핀 무변경·lockfile-only). 이는 diagnostic-v26의 L-17(dev-dep within-pin lockfile 드리프트, "비-actionable 위생 추적 — 다음 dev 갱신 시 함께 정렬")을 *마지막 남은 경량 actionable로 승격*한 것이다 — *모든 다른 내부/외부 각도가 소진된 지금*(내부 순수 함수 게이트 발굴 소진 + 외부 트리거 모두 정적) lockfile within-pin 정렬이 *유일하게 남은 actionable*이기 때문이다. 계속 보류/이연/추적 항목(L-2~L-9, L-13, L-14, L-18)은 추적만 갱신하고 L-17은 M-1 v27 → P30-1로 승격 처리(추적 종료 예정), L-11(better-sqlite3)·L-15(vite)·L-16(express)는 이미 해소다(3장).
>
> **맥락**: v22는 graph/ 엔진 처방 5종 진입 로직을, v23은 핸들러 보조 핵심 순수 로직(`mergeResultsRRF`, P26-1)·`qualified_name` strict 가드(P26-2)를, v24는 `_utils.ts`의 나머지 export 순수 함수(`escapeXml`/`escapeDot`, P27-1)와 better-sqlite3 lockfile(P27-2)을, v25는 공통 유틸 정규화 프리미티브(`toCanonical`, P28-1)와 express lockfile(P28-2)을, v26은 graph 엔진 시딩/env-파싱 프리미티브(`mulberry32`·`parseClusterSeed`·`parseClusterMaxNodes`, P29-1)를 전수 게이트/정렬했다. 즉 **내부 순수 함수 게이트 발굴 사이클이 레이어별로 소진됐다**(graph 엔진 진입+시딩·핸들러 가드·핸들러 보조·공통 유틸 전수). v27은 *유지보수-모드 targeted 진단*으로 이를 실측 확인했다: **(1) 신규 prod 코드 0**(`git log ae69a8b..HEAD` = 테스트-게이트/lockfile/문서 커밋만 — 게이트할 신규 도구/엔드포인트/유틸 0건), **(2) 남은 내부 후보 비-actionable**(L-18 `getProvider` 엣지케이스는 결함 아닌 게이트 공백), **(3) 외부 트리거 모두 정적**(MCP SDK v2 *여전히 pre-alpha*·npm `latest` 1.29.0·2.x dist-tag 부재, CVE 0/0, Miasma/Phantom Gyp 미도달, node-tree-sitter#268 open). **따라서 유일한 actionable은 M-1 v27 lockfile within-pin 위생 정렬**이며 — phase29-plan §4-5가 예고한 *"외부-트리거 기반 유지보수 포스처로의 전환"이 실제로 도래*했다. Phase 30은 **lockfile within-pin 정렬(P30-1, `npm update`·핀 무변경) + 추적 갱신**의 *경량 단일-항목 유지보수 사이클*이며, 예상 **2커밋**(diagnostic-v27 + phase30-plan docs 커밋 1 + P30-1 커밋 1, 또는 합본).

---

## 0. 작업 원칙

- P30-1은 **`package.json` 핀 무변경**(lockfile-only) — `npm update`는 `package.json`의 semver 핀(`^4.3.6`/`^20.12.7`/`^4.1.2`)을 *변경하지 않고* `package-lock.json`을 핀-내 최신으로 정렬한다(major bump 아님). `zod`만 prod-dep(`api-server.ts` 도달 + MCP SDK dedupe)이나 드리프트가 *핀-내 minor*(`^4.3.6`이 4.4.3 허용)라 backward-compatible·동작 무변경이고, `@types/node`/`vitest`는 dev-only(prod 미도달).
- Phase 종료 시(P30-1) `npx vitest run` **672 그린**, `npx tsc --noEmit` 그린, `npm audit` 0, `npm audit --omit=dev` 0 + `npm outdated`에서 within-pin 드리프트(`zod`/`@types/node`/`vitest`) **0** 확인. major 드리프트(@types/express 5·express 5·commander 15·typescript 6·@types/node 25·tree-sitter-c-sharp 0.23.5)는 *건드리지 않는다*(핀 변경/ERR_REQUIRE_ASYNC_MODULE 미해소 — 즉시 비권장).
- Phase 종료 시 `agent_docs/diagnostic-v27.md`의 M-1 v27에 `[DONE]` 마킹.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.** (`.git/info/exclude`에 이미 등록 — `git status --short`는 항상 깨끗해야 한다.)
- 한 사이클(1~2 항목) 제한 원칙에 따라, 본 사이클은 **P30-1 단독**(lockfile-only)이다 — M-2(추가 actionable)가 없는 *경량 단일-항목* 사이클. 내부 게이트 발굴 소진 + 외부 정적이라 lockfile within-pin 정렬이 유일하게 남은 actionable이다.

---

## 1. 의존성 맵

```
P30-1 (lockfile within-pin 위생 정렬 — lockfile-only·핀 무변경)   독립.
  └─ npm update (package.json 핀 무변경, package-lock.json만 핀-내 정렬)
        ← zod 4.3.6 → 4.4.3        (prod-dep, ^4.3.6 핀-내 minor; api-server.ts 도달 + MCP SDK dedupe)
        ← @types/node 20.19.33 → 20.19.43   (dev-dep, ^20.12.7 핀-내 patch)
        ← vitest 4.1.2 → 4.1.9     (dev-dep, ^4.1.2 핀-내 patch)
        ← package.json 무변경 (semver 핀 그대로; major bump 아님)
        ← 검증: vitest 672 그린·tsc 그린·audit 0/0·npm outdated within-pin 드리프트 0
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
L-17 (dev-dep within-pin lockfile 드리프트)──승격(→ M-1 v27 → P30-1; prod-dep zod 포함)──→  [P30-1 완료 시 추적 종료]
L-18 (getProvider 확장자 엣지케이스 공백)  ──추적만(비-actionable)──→  [전부 정확 처리; 여유 사이클에 language-registry.test.ts로 묶어도 무방]
```

---

## 2. Phase 30-1: lockfile within-pin 위생 정렬 (M-1 v27) [DONE]

**목표**: `npm outdated`가 보고한 within-pin(semver-호환) lockfile 드리프트 3건을 `npm update`로 정렬한다. **`package.json` 핀 무변경**(lockfile-only). 이는 diagnostic-v26 L-17을 *마지막 남은 경량 actionable로 승격*한 것으로 — *모든 다른 내부/외부 각도가 소진된 지금* prod 동작 무변경(핀 무변경)으로 닫을 수 있는 유일한 항목이다.

| 패키지 (핀) | Current → Wanted | 분류 | 비고 |
|------------|------------------|------|------|
| `zod` (`^4.3.6`, deps) | 4.3.6 → **4.4.3** | prod-dep, 핀-내 minor | `src/server/api-server.ts` 도달 + MCP SDK의 zod와 dedupe. backward-compatible minor라 동작 무변경 |
| `@types/node` (`^20.12.7`, devDeps) | 20.19.33 → **20.19.43** | dev-dep, 핀-내 patch | 타입 전용·prod 미도달 |
| `vitest` (`^4.1.2`, devDeps) | 4.1.2 → **4.1.9** | dev-dep, 핀-내 patch | 테스트 러너·prod 미도달 |

**제외(건드리지 않음)**: major 드리프트 `@types/express` 5·`express` 5·`commander` 15·`typescript` 6·`@types/node` 25(*핀 변경 수반·즉시 비권장*), `tree-sitter-c-sharp` 0.23.5(*ERR_REQUIRE_ASYNC_MODULE 미해소 → 0.23.1 핀 유지가 옳음*).

| 항목 | 파일 | 작업 |
|------|------|------|
| within-pin 정렬 | `package-lock.json` | `npm update zod @types/node vitest`(또는 `npm update`로 within-pin 일괄) — `package.json` 핀 무변경 확인 |
| 핀 무변경 검증 | `package.json` | `git diff package.json` = 빈 출력(핀 `^4.3.6`/`^20.12.7`/`^4.1.2` 그대로) 확인 |
| 베이스라인 재확인 | (검증) | `npx vitest run` 672 그린, `npx tsc --noEmit` 그린, `npm audit` 0·`npm audit --omit=dev` 0, `npm outdated`에서 `zod`/`@types/node`/`vitest` within-pin 드리프트 0 |
| M-1 v27 마킹 | `agent_docs/diagnostic-v27.md` | M-1 v27에 `[DONE]` + 정렬 결과(zod 4.4.3·@types/node 20.19.43·vitest 4.1.9) 기록. L-17 추적 종료 마킹 |

**설계 메모**:
- **`npm update`는 핀-내 정렬만 수행**: `package.json`의 caret 핀(`^4.3.6` 등)을 *해석*해 그 범위 내 최신을 `package-lock.json`에 고정한다 — 핀 자체(major)는 변경하지 않으므로 *회귀 표면이 최소*다. major bump(예: zod 5·express 5)는 *별도 핀 변경 + 호환성 검토*가 필요하므로 본 사이클 범위 밖.
- **`zod`가 prod-dep이나 동작 무변경**: `zod`는 `src/server/api-server.ts`(REST 입력 검증)에서 도달하고 MCP SDK의 zod와 dedupe된다. 4.3.6→4.4.3은 *backward-compatible minor*(API 호환)라 — `npx vitest run` 672(api-server supertest 게이트 P19-1 포함)·`npx tsc --noEmit` 그린으로 *회귀 부재*를 검증한다. audit 0/0 불변(신규 advisory 없음).
- **dedupe 일관성**: `npm ls zod` 결과 `zod@4.3.6`이 top-level·`@modelcontextprotocol/sdk`·`zod-to-json-schema`에서 deduped — `npm update`는 이를 4.4.3으로 일괄 정렬(트리 분기 없음).
- **M-2 v24/v25(prod-dep lockfile bump)와의 부류 차이**: M-2 v24(better-sqlite3 12.x)·M-2 v25(express 4.22.x)는 *특정 prod-dep을 latest로 정렬*(누적 메이저-내 정렬)했으나 — M-1 v27은 *누적된 within-pin 드리프트의 일괄 위생 정렬*이고 일부(2/3)는 dev-only다. *advisory-구동이 아닌 위생*이라 긴급도는 낮으나, 다른 모든 actionable이 소진된 지금 *유일하게 남은 경량 항목*이다.

**테스트**: `npx vitest run` 672 그린이 1차 검증 산출물(특히 api-server supertest로 zod 검증 경로 회귀 부재 확인). `npx tsc --noEmit` 그린, `npm audit` 0/0, `npm outdated` within-pin 드리프트 0.

**산출물**: `package-lock.json`(within-pin 정렬) + diagnostic-v27 M-1 `[DONE]`. **리스크: 매우 낮음**(lockfile-only, `package.json` 핀 무변경, within-pin backward-compatible patch/minor, 회귀 검증 672 테스트 + tsc + audit). **이로써 prod-dep within-pin 드리프트까지 0이 되어 — *lockfile 위생도 steady-state에 도달*한다(L-17 종료).**

---

## 3. 보류/이연 항목 판정 (diagnostic-v27 → Phase 30 verdict)

| 항목 | diagnostic-v27 판정 | Phase 30 처리 |
|------|--------------------|---------------|
| **M-1 v27 lockfile within-pin 위생 정렬** | within-pin 드리프트 3건(`zod` prod-dep 포함), 핀 무변경·audit 0/0 불변 (**verdict: actionable, lockfile-only**) | **P30-1에서 해소** |
| **L-2 Miasma / Phantom Gyp / Node-gyp 포스처** | 캠페인 여전히 활발, Cynapx 도달 0건 재대조(binding.gyp 0개) (**verdict: 추적만**) | 추적 상태만 갱신 — `npm ls` + in-tree binding.gyp/설정 재점검 |
| **L-3 MCP stateless/task 마이그레이션** | SDK v2 *여전히 pre-alpha*, npm `latest` 1.29.0·2.x dist-tag 부재, stable Q3 2026[7-28 spec publish] 예정 (**verdict: 계속 이연**) | 범위 제외 — 2026-07-28 전후 2.x dist-tag/v2 stable 재확인이 다음 사이클 1순위 외부 트리거 |
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
| **L-17 dev-dep within-pin lockfile 드리프트** | 모든 다른 각도 소진 → *마지막 남은 actionable*로 승격(prod-dep `zod` 포함) (**verdict: M-1 v27로 승격**) | **P30-1에서 처리 → 추적 종료** |
| **L-18 getProvider 확장자 엣지케이스 공백** | 무-확장자/미지/dotfile/trailing-dot/multi-dot 전부 정확 처리되나 직접 단언 0 (**verdict: 추적만, 비-actionable**) | 범위 제외 — 여유 사이클에 `language-registry.test.ts`로 묶어도 무방 |

---

## 4. 유지보수 모드 포스처 (외부-트리거-only 전환 도래)

1. **공급망 위생(매 사이클)**: prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0 유지. 신규 advisory 시 `overrides`/devDependency floor bump로 패치(L-15 vite `^8.0.16` 전례). 의존 추가 시 binding.gyp 검토 + `npm ci` + 매 사이클 `npm ls`/in-tree binding.gyp(현재 0개)·`.claude`/`.cursor`/`.gemini` 설정 재대조(현재 `.claude/launch.json` 양성, 0건 — L-2 Miasma/Phantom Gyp 미도달). **lockfile 드리프트 정기 정렬 — *prod-dep*: better-sqlite3(P27-2 12.11.1)·express(P28-2 4.22.2) 정렬 완료. *within-pin 드리프트*(`zod`/`@types/node`/`vitest`)는 **M-1 v27 → P30-1로 정렬**(prod-dep `zod` 포함) — 정렬 후 prod-dep·within-pin 드리프트 모두 0.** 매 사이클 `npm outdated`로 native/핵심 prod 의존 드리프트 누적 모니터링.
2. **MCP SDK v2 stable 배포 모니터링(다음 사이클 1순위 외부 트리거)**: `npm view @modelcontextprotocol/sdk version dist-tags`가 *여전히 1.29.0·`{ latest: '1.29.0' }`·2.x dist-tag 부재*(v2 pre-alpha, stable Q3 2026[**스펙 publish 2026-07-28 — 다음 사이클 시점과 맞물림**]). 2.x dist-tag 출현 또는 v2 stable 시 L-3 즉시 actionable화(P15-3 `handleMcp()` 설계 메모 출발점). 그 전까지 핀 `^1.29.0` 유지.
3. **런타임 수명주기**: Node 22 LTS·tree-sitter 신버전·tree-sitter-c-sharp 0.23.6+ 출현 시 정렬. Node 24 LTS 전환은 node-tree-sitter#268(L-6) 해소 후. 문서 Node 버전(L-12, P24-2 해소)은 코드와 동기화 유지.
4. **회귀 안전망·핸들러 위생**: 새 도구/REST 라우트/이벤트 핸들러/엔진 비즈니스 로직/핸들러 보조 순수 로직/공통 유틸 순수 함수/엔진 시딩·env-파싱 순수 함수/핸들러 인자 검증의 미커버·불일치 발견 시 vitest 케이스 추가(P18-1→P19-1→P20-1→P22-1→P23-1/2/3→P24-1→P25-1/2→P26-1/2→P27-1→P28-1→P29-1 확장 완료). **내부 순수 함수 게이트 발굴은 소진** — graph/ 엔진 5종 진입 + 시딩/env-파싱 순수 함수 4종 + `qualified_name` 10개 핸들러 strict 가드(M-2 v22+v23) + `server/tools/_utils.ts` 순수 함수 3개(P26-1/P27-1) + `src/utils/paths.ts` 순수 함수 4종(P28-1 포함)이 *모두* 직접 게이트됐다. **이후 신규 도구/엔진/핸들러/유틸 추가 시에만 확장**(현재 신규 prod 코드 0 — `git log ae69a8b..HEAD`).
5. **외부-트리거-only 포스처 도래(전환 완료)**: Phase 26~29가 *내부 순수 함수 게이트 발굴 사이클*을 레이어별로 소진했고, *prod-dep lockfile 정렬*도 P28-2(express)로, *within-pin 드리프트*도 P30-1(M-1 v27)로 닫힌다. 따라서 **Phase 30 이후 사이클은 *전적으로 외부-트리거 기반*으로 전환된다** — 즉 (a) 새 도구/엔진/핸들러/유틸이 *추가될 때만* 신규 게이트, (b) `npm audit`(prod)·prod-dep lockfile 드리프트 정기 재스캔, (c) **MCP SDK v2 stable 전환(L-3, 2026-07-28 스펙 publish 전후 — 다음 사이클의 1순위)**·node-tree-sitter#268 해소(L-6)·tree-sitter-c-sharp 0.23.6+ 같은 *외부 상태 변화* 트리거. **이에 따라 향후 사이클을 *더 긴 간격*(예: 격주/월간 외부 CVE·SDK·공급망 재스캔 위주)으로 옮기거나, 코드 변경이 없는 사이클은 *외부 컨텍스트 재조사 + 추적 갱신만의 경량 doc-only 사이클*로 운영하는 것을 권장한다.** 단 매 사이클 (b)(c)의 외부 재스캔은 계속 유지한다(공급망/CVE는 시간 의존적). **특히 다음 사이클은 2026-07-28 MCP v2 스펙 publish와 맞물려 — v2 stable/2.x dist-tag 재확인이 1순위다.**

---

## 5. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 30-(docs) | diagnostic-v27 + phase30-plan 신규 docs | 1 | 없음 (docs-only) |
| 30-1 [DONE] | M-1 v27: `npm update`로 within-pin lockfile 정렬(`zod` 4.3.6→4.4.3[prod-dep, 핀-내 minor]·`@types/node` 20.19.33→20.19.43·`vitest` 4.1.2→4.1.9[dev-dep, 핀-내 patch]) — `package.json` 핀 무변경, **vitest 672 그린**·tsc 그린·audit 0/0·npm outdated within-pin 드리프트 0 | 1 (30-(docs)와 합본 가능) | 매우 낮음 |

**총 2개 커밋(P30-1 단독 + docs, 또는 합본).** 본 사이클은 *M-2(추가 actionable)가 없는 경량 단일-항목* 사이클이다 — 내부 게이트 발굴 소진 + 외부 정적이라 lockfile within-pin 정렬이 유일하게 남은 actionable이다.

> **깊은 steady-state 안내**: Phase 26~29가 핸들러 보조·공통 유틸·graph 엔진 시딩 순수 함수 레이어 게이트를 마무리했고 — *내부 순수 함수 게이트 발굴 사이클이 소진*됐다. **Phase 30은 *마지막 남은 경량 actionable인 lockfile within-pin 정렬*(M-1 v27 → P30-1)을 처리해 prod-dep within-pin 드리프트까지 0으로 만든다.** 따라서 Phase 30 이후는 *전적으로 외부-트리거 기반*(새 코드 추가 시 게이트·외부 CVE/SDK/공급망 재스캔)으로 전환되는 *깊은 steady-state*이며 — 4장 5절의 *외부-트리거-only 포스처*(더 긴 간격·외부 재스캔 위주·doc-only 경량 사이클)가 그 운영 지침이다. **다음 사이클의 1순위 외부 트리거는 2026-07-28 MCP SDK v2 스펙 publish 전후의 v2 stable/2.x dist-tag 출현 재확인(L-3)이다.**

---

## 6. 향후 후보 (Phase 30 범위 밖 — 기록 유지)

- **MCP transport v2 마이그레이션(L-3, 다음 사이클 1순위)**: SDK v2 여전히 pre-alpha(npm `latest` 1.29.0·2.x dist-tag 부재). `@modelcontextprotocol/sdk`가 2.x로 전환되거나 v2 stable(Q3 2026, **스펙 publish 2026-07-28 — 다음 사이클 시점**) 시 P15-3 설계 메모 기반 착수. **2026-07-28 전후 dist-tag 재확인이 핵심 트리거.**
- **사이클 포커스 전환(4장 5절)**: 내부 순수 함수 게이트 소진 + prod-dep/within-pin lockfile 정렬 소진(P30-1)에 따라 향후 사이클을 *전적으로 외부-트리거 기반*(새 코드 추가 시 게이트·prod audit/lockfile 정기 재스캔·MCP SDK v2 stable·node-tree-sitter#268 해소)으로 전환 — 더 긴 간격 또는 doc-only 경량 사이클 운영 권장.
- **getProvider 확장자 엣지케이스 게이트(L-18)**: 무-확장자/미지/dotfile/trailing-dot/multi-dot 직접 단언 — 전부 정확 처리되므로 비-긴급(여유 사이클에 `language-registry.test.ts`로 묶어도 무방). *결함 아닌 게이트 공백이라 강제하지 않음.*
- **lockfile 드리프트 정기 모니터링(L-11/L-16/L-17 후속)**: P27-2(better-sqlite3)·P28-2(express) prod-dep 정렬 + P30-1 within-pin 정렬 후 드리프트 0. 매 사이클 `npm outdated`로 native/핵심 prod 의존 드리프트 누적 추적 — 다음 누적 시 재정렬.
- **SCIP export**: P18-1 + P19-1 디딤돌 마련 완료, protobuf 의존 부담으로 즉시 비권장. CodeGraph/Serena 생태계 상호운용 신호 시 재검토.
- **L-9 잔여 클린업**: update-pipeline `withWriteTransaction()` 추출, progress `log.error` 재분류, 빈 catch 2건 — update-pipeline 리팩터 페이즈로.
- **admin CLI 게이트화(L-7)** / **worker-pool/embedding/migration 게이트화(L-8)**: 각각 핸들러 export 리팩터 / SCHEMA_VERSION 증분 시 함께.
- **L-4 IPC MessagePack** / **L-5 클러스터링 파티셔닝**: 실측 트리거 시.
- **Node 24 LTS 전환** / **tree-sitter-c-sharp 0.23.6+ 정렬**: 신버전·환경 확정 후(node-tree-sitter#268 해소 후).
- **analyze-impact `use_cache` 스키마-default 강제(L-13)**: 핸들러에서 `args.use_cache ?? true`로 스키마-default를 명시 강제하는 미세 개선 — 무해라 우선순위 낮음.
- **L-14 CVE-2026-25727 모니터링**: tree-sitter Rust 생태계 신호 — Cynapx 미도달이나 tree-sitter 코어/그래머 업데이트 시 재확인.
- **major 의존성 bump 검토**: @types/express 5·express 5·commander 15·typescript 6·@types/node 25 — 핀 변경 + 호환성 검토 수반이라 *별도 사이클*에서 신중히(즉시 비권장). zod 5도 출현 시 별도 검토.
