# Phase 33 작업 계획 — diagnostic-v30 대응

> **작성**: 2026-06-16 / **기준 문서**: `agent_docs/diagnostic-v30.md` (기준 커밋 `9f4f5a1`, Phase 32-1 완료 — `tests/metrics-calculator.test.ts`에 `calculateCyclomaticComplexityTreeSitter()` null/undefined·빈-decisionPoints 방어 게이트 3 `it` 추가(M-1 v29 해소), 테스트-only·prod 무변경, vitest 678→681)
> **목표**: diagnostic-v30은 **actionable 구현 항목 0건**을 확인했다 — *0-의존 순수 함수 게이트 발굴 완전 소진(P32-1) + lockfile 위생 steady-state(P30-1) + 외부 트리거(T-1~T-7) 전부 미발화 + 신규 prod 코드 0 + audit 0/0 + within-pin 드리프트 0*. 따라서 **Phase 33은 순수 모니터링/추적 갱신 사이클이다 — 구현 커밋 없이 docs-only**.

---

## 0. 작업 원칙

- **Phase 33은 구현 항목 없음** — docs-only(diagnostic-v30 + phase33-plan 신규 문서 커밋 1건).
- 모니터링 사이클이므로 prod 코드·테스트 파일·lockfile은 *수정 금지*. `src/`·`tests/` 일체 불변.
- Phase 종료 시 `npx vitest run` **681/681** 그린(불변), `npx tsc --noEmit` 그린, `npm audit` 0·`npm audit --omit=dev` 0 재확인 후 docs 커밋·푸시.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.** (`.git/info/exclude` 등록 — `git status --short`는 항상 깨끗해야 한다.)
- 한 사이클(1~2 항목) 제한 원칙 적용: 본 사이클은 *docs-only 1건*이다. 외부 트리거 발화 없이 더 많은 항목을 처리하려 무리하지 않는다.

---

## 1. 현재 베이스라인 (Phase 33 시작 시점)

| 항목 | 값 | 비고 |
|------|-----|------|
| 기준 커밋 | `9f4f5a1` | P32-1 완료(metrics-calculator null-guard 게이트, M-1 v29) |
| 테스트 | **681/681**(47 파일, 11.51s) | `npx vitest run` 그린 |
| 타입체크 | 그린 | `npx tsc --noEmit` |
| prod audit | **0 vulnerabilities** | `npm audit --omit=dev` |
| dev audit | **0 vulnerabilities** | `npm audit` |
| `@modelcontextprotocol/sdk` | 1.29.0 (핀 `^1.29.0`) | npm `dist-tags.latest`·2.x dist-tag 부재·`time.modified` 2026-06-04(불변) |
| `better-sqlite3` | 12.11.1 | prod-dep, npm `latest`(P27-2) |
| `express` | 4.22.2 | prod-dep(P28-2) — 5.x Major 누적(L-22) |
| `zod` | 4.4.3 | prod-dep, within-pin 정렬(P30-1) — CVE-2026-6991 범위 밖(L-19) |
| `vite` | 8.0.16 | dev-dep(L-15) |
| `vitest` | 4.1.9 | dev-dep, within-pin 정렬(P30-1) — CVE-2026-47428/47429 범위 밖(L-21) |
| `tree-sitter` / `tree-sitter-c-sharp` | 0.25.0 / 0.23.1 | 0.23.5 ERR_REQUIRE_ASYNC_MODULE 미해소 → 0.23.1 핀 유지(L-6/T-6) |
| within-pin 드리프트 | **0** | `npm outdated` Current=Wanted 전 행(major 제외, P30-1) |
| 0-의존 순수 함수 게이트 | **완전 소진** | P32-1이 마지막 후보(metrics-calculator null-guard) 해소 |
| in-tree binding.gyp | **0개** | L-2 Miasma/Phantom Gyp 미도달 |

---

## 2. Phase 33 구현 항목 — 없음 (외부 트리거 전부 미발화)

diagnostic-v30의 외부 트리거 체크리스트(T-1~T-7)를 재스캔한 결과 *모두 미발화*이며 내부 게이트 후보도 0건이다:

| 트리거 | 상태 | 발화 시 조치 |
|--------|------|-------------|
| **T-1** MCP SDK 2.x dist-tag / v2 stable | **미발화** — `dist-tags.latest=1.29.0`, 2.x dist-tag 부재, `time.modified` 2026-06-04 | L-3 즉시 actionable화 — P15-3 설계 메모 기반 stateless core/Tasks/MCP Apps 마이그레이션 |
| **T-2** 신규 CVE Cynapx 실도달 | **미발화** — audit 0/0, L-14/L-19/L-21 미도달 불변 | `overrides`/floor bump 패치(L-15 vite `^8.0.16` 전례) |
| **T-3** 신규 prod 코드 추가 | **미발화** — `git log 9f4f5a1` = 테스트-게이트/docs만 | 신규 표면의 0-의존 순수 로직/인자 가드 vitest 게이트(P18-1→P32-1 부류 연장) |
| **T-4** within-pin lockfile 드리프트 누적 | **미발화** — Current=Wanted 전 행 | `npm update`(핀-내) 정렬(P30-1 전례) |
| **T-5** node-tree-sitter#268 해소 + Node 24 LTS 전환 | **미발화** — #268 open | Node 24 매트릭스 prebuild 재확인 + `engines`/Dockerfile 전환 검토 |
| **T-6** tree-sitter-c-sharp 0.23.6+ ERR_REQUIRE_ASYNC_MODULE 해소 | **미발화** — 0.23.5 미해소 | 핀 정렬(0.23.1→resolved 버전) |
| **T-7** Miasma/Phantom Gyp Cynapx 의존 트리 도달 | **미발화** — in-tree binding.gyp 0개 | 영향 패키지 제거/핀·`npm ci` 재검증·자격증명 회전 |

→ **따라서 Phase 33 구현 항목 = 없음.** 본 사이클은 **docs-only 커밋 1건**이 전부다.

---

## 3. L-item 추적 테이블 (diagnostic-v30 → Phase 33 verdict)

| 항목 | diagnostic-v30 판정 | Phase 33 처리 |
|------|--------------------|---------------|
| **M-1 v29 metrics-calculator null-guard 게이트** | [DONE — P32-1] | 추적 종료 |
| **L-2 Miasma / Phantom Gyp / Node-gyp 포스처** | 도달 0건 불변(in-tree binding.gyp 0개) (**verdict: 추적만**) | 다음 사이클 재스캔 |
| **L-3 MCP stateless/task 마이그레이션** | SDK v2 여전히 pre-alpha, 2.x dist-tag 부재, stable Q3 2026(★T-1 1순위) (**verdict: 이연**) | **T-1 발화 대기 — 2026-07-28 스펙 publish 전후 2.x dist-tag 재확인이 핵심** |
| **L-4 IPC MessagePack** | 성능 문제 미관측 (**verdict: 보류**) | 범위 제외 |
| **L-5 클러스터링 본격 파티셔닝** | count-first 가드 OOM 방어, P29-1 게이트 (**verdict: 이연**) | 범위 제외 |
| **L-6 Node 24 tree-sitter 빌드** | #268 open, c-sharp 0.23.5 미해소(0.23.1 핀 유지) (**verdict: 추적**) | T-5/T-6 발화 대기 |
| **L-7 admin CLI cmd* 게이트 공백** | 모듈-private (**verdict: 비-actionable 추적**) | 범위 제외 |
| **L-8 worker-pool/embedding/migration 잔여** | flaky 위험 (**verdict: 비-actionable 추적**) | 범위 제외 |
| **L-9 update-pipeline 클린업 잔여** | (b) 잣대 미충족 (**verdict: 비-actionable 추적**) | 범위 제외 |
| **L-13 analyze-impact use_cache 무해** | 무해 (**verdict: 비-actionable 추적**) | 범위 제외 |
| **L-14 CVE-2026-25727 time 크레이트 (미도달)** | npm 바인딩 미도달 (**verdict: 비-actionable 추적**) | 범위 제외 |
| **L-19 CVE-2026-6991 zod CUID (미도달)** | 버전·기능·바인딩 삼중 미도달 (**verdict: 비-actionable 추적**) | T-2 모니터링 신호 |
| **L-20 getDirSizeMB fs-의존 비-순수** | (b) 잣대 미충족 (**verdict: 비-actionable 추적**) | 범위 제외 |
| **L-21 CVE-2026-47428/47429 vitest (미도달)** | 버전·기능·플랫폼 삼중 미도달 (**verdict: 비-actionable 추적**) | T-2 모니터링 신호 |
| **L-22 major 의존성 누적(신규)** | express 5·typescript 6·@types/* major 누적, 핀 변경·호환성 검토 수반 (**verdict: 비-actionable 추적, 별도 major 마이그레이션 페이즈 후보**) | 별도 전용 페이즈에서 신중히 — 즉시 비권장(회귀 위험 높음) |

---

## 4. 외부 트리거 체크리스트 (상세 — 이것이 발화하면 next actionable)

> Phase 33 이후 Cynapx는 *0-의존 순수 함수 게이트 발굴 완전 소진 + lockfile 위생 steady-state*이므로 — **다음 actionable 여부는 전적으로 아래 외부 트리거에 달려 있다.** 매 사이클 이 체크리스트를 재스캔한다.

| # | 트리거 | 현재 상태(2026-06-16) | 발화 시 조치 | 우선순위 |
|---|--------|----------------------|-------------|---------|
| T-1 | **MCP SDK 2.x dist-tag / v2 stable 출현** | 미발화 — `dist-tags = { latest: '1.29.0' }`, 2.x dist-tag 부재, `time.modified` 2026-06-04(불변). stable Q3 2026·**스펙 publish 2026-07-28**(~6주 앞) | L-3 즉시 actionable화 — P15-3 `handleMcp()` 설계 메모 기반 stateless core(SEP-2567)/Tasks/MCP Apps 마이그레이션 착수 | **★ 1순위 (2026-07-28 임박)** |
| T-2 | **신규 CVE가 Cynapx 도달**(버전·기능·플랫폼/바인딩 삼축 *전부* 도달) | 미발화 — audit 0/0; L-19(zod)·L-21(vitest)·L-14(time) 미도달 불변 | `overrides`/floor bump 또는 핀 정렬로 패치(L-15 vite `^8.0.16` 전례). audit 게이트 그린 회복 | 높음 |
| T-3 | **신규 prod 코드 추가**(새 MCP 도구·REST 엔드포인트·엔진·유틸) | 미발화 — `git log 9f4f5a1` = 테스트-게이트/docs 커밋만(신규 prod 표면 0) | 신규 표면의 0-의존 순수 로직/인자 가드/스키마 불변식에 vitest 게이트 추가(P18-1→P32-1 부류 연장) | 높음 |
| T-4 | **within-pin lockfile 드리프트 누적** | 미발화 — `npm outdated` Current=Wanted 전 행(P30-1 완료, major 제외) | `npm update`(핀-내) lockfile 정렬(P30-1 전례) | 중간 |
| T-5 | **node-tree-sitter#268 해소 + Node 24 LTS 전환** | 미발화 — #268 여전히 open(C++20/C++17 빌드 모순) | Node 24 매트릭스 prebuild 재확인 후 `engines`/Dockerfile 전환 검토(L-6) | 중간 |
| T-6 | **tree-sitter-c-sharp 0.23.6+ ERR_REQUIRE_ASYNC_MODULE 해소** | 미발화 — 0.23.5 미해소, 0.23.1 핀 유지 | 핀 정렬(0.23.1→resolved 버전) | 중간 |
| T-7 | **Miasma/Phantom Gyp 캠페인이 Cynapx 의존 트리 도달** | 미발화 — in-tree binding.gyp 0개·컴프로마이즈 패키지 not in tree | 영향 패키지 제거/핀·`npm ci` 재검증·자격증명 회전(L-2) | 높음(즉시) |

---

## 5. 유지보수 포스처 (외부-트리거-only — Phase 33~)

1. **공급망 위생(매 사이클)**: prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0 유지. 신규 advisory 시 `overrides`/floor bump(L-15 vite `^8.0.16` 전례). **lockfile 드리프트 정기 정렬**: within-pin 드리프트 0(P30-1), prod-dep 정렬 완료 — 매 사이클 `npm outdated`로 누적 추적(T-4). **신규 CVE 도달성 삼축 판정**: *버전·기능·플랫폼/바인딩* 삼축으로 도달성 판정(CVE-2026-47428/47429·CVE-2026-6991 전례).
2. **MCP SDK v2 stable 배포 모니터링(★T-1, 2026-07-28 전후)**: `npm view @modelcontextprotocol/sdk dist-tags time.modified`가 *여전히 `{ latest: '1.29.0' }`·2.x dist-tag 부재*. **2.x dist-tag(`next`/`latest`) 출현 또는 v2 stable 시 L-3 즉시 actionable화(P15-3 `handleMcp()` 설계 메모 출발점).** 그 전까지 핀 `^1.29.0` 유지.
3. **런타임 수명주기**: Node 22 LTS·tree-sitter 신버전·tree-sitter-c-sharp 0.23.6+(T-6) 출현 시 정렬. Node 24 LTS 전환은 node-tree-sitter#268(T-5) 해소 후.
4. **회귀 안전망·핸들러 위생**: 새 도구/REST 라우트/이벤트 핸들러/엔진 비즈니스 로직/핸들러 보조 순수 로직/공통 유틸 순수 함수/엔진 시딩·env-파싱 순수 함수/핸들러 인자 검증/indexer 확장자 매핑/indexer 메트릭 계산 null-guard에 신규 미커버·불일치 발견 시 vitest 케이스 추가(P18-1→P32-1 확장 완료, T-3 발화 시에만 연장).
5. **major 의존성 마이그레이션(L-22, 별도 전용 페이즈)**: express 5·typescript 6·@types/node 25·@types/express 5·commander 15 — 핀 변경 + 호환성 검토 + 대규모 회귀 테스트 수반이라 *별도 major 마이그레이션 페이즈*에서 신중히 처리. 즉시 비권장(회귀 위험 높음). 특히 **express 5**: Router/middleware 시그니처 변경·error-handler 4-arg 변경·express-rate-limit/swagger-ui-express 호환성 전면 검토 필요. **typescript 6**: strictness 강화로 타입 에러 발생 가능 — 별도 페이즈에서 tsc clean 재확인 필수.
6. **external-trigger-only 포스처 유지**: Phase 33은 *0-의존 순수 함수 게이트 발굴 완전 소진(P32-1)*·*lockfile 위생 steady-state(P30-1)*이후 두 번째 모니터링 사이클이다. **향후 사이클은 외부 트리거가 발화할 때만 actionable 구현으로 전환된다 — 트리거 미발화 시에는 외부 컨텍스트 재조사(CVE·SDK·공급망) + 추적 갱신만의 경량 doc-only 사이클로 운영한다.**

---

## 6. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 | 테스트 |
|-------|-----------|---------|--------|--------|
| 33-(docs) | diagnostic-v30 + phase33-plan 신규 docs | 1 | 없음 (docs-only) | 681/681 불변 |

**총 1개 커밋(docs-only).** 구현 항목 없음 — 외부 트리거 미발화에 따른 순수 모니터링 사이클.

> **steady-state 안내**: Phase 32-1이 *0-의존 순수 함수 게이트 발굴의 마지막 후보(metrics-calculator null-guard)*를 처리해 graph/ 엔진(5종 진입+4종 시딩)·핸들러 보조·공통 유틸·indexer 확장자 매핑·indexer 메트릭 계산 *모든 레이어*의 게이트 발굴이 완전 소진됐다. **Phase 33~는 전적으로 외부 트리거 기반**이며 — T-1(MCP SDK v2 stable, 2026-07-28 스펙 publish 전후)이 ★1순위 외부 트리거다.

---

## 7. 향후 후보 (Phase 33 범위 밖 — 기록 유지)

- **MCP transport v2 마이그레이션(L-3, ★T-1 1순위)**: SDK v2 여전히 pre-alpha. 2.x dist-tag 출현 또는 v2 stable(Q3 2026, **스펙 publish 2026-07-28**) 시 P15-3 설계 메모 기반 착수.
- **major 의존성 마이그레이션(L-22, 별도 전용 페이즈)**: express 5·typescript 6·@types/node 25 등 — 대규모 호환성 검토 수반, 전용 major 마이그레이션 페이즈에서 신중히.
- **get-setup-context fixture 테스트(L-20 후속)**: `getDirSizeMB` fs-의존 비-순수 → tmpdir 실파일 트리 fixture 통합 테스트, 우선순위 낮음.
- **lockfile 드리프트 정기 모니터링(T-4)**: within-pin 드리프트 0(P30-1). 매 사이클 `npm outdated` 추적.
- **신규 CVE 도달성 삼축 판정(T-2)**: tree-sitter/zod/vitest/SQLite 등 의존 생태계의 신규 CVE는 *버전·기능·플랫폼/바인딩* 삼축으로 도달성 판정.
- **SCIP export**: protobuf 의존 부담으로 즉시 비권장. 생태계 상호운용 신호 시 재검토.
- **Node 24 LTS 전환(T-5)** / **tree-sitter-c-sharp 0.23.6+ 정렬(T-6)**: 신버전·환경 확정 후.
- **analyze-impact `use_cache` 스키마-default 강제(L-13)**: 무해, 우선순위 낮음.
- **L-9 잔여 클린업**: update-pipeline 리팩터 페이즈로.
- **admin CLI 게이트화(L-7)** / **worker-pool/embedding/migration 게이트화(L-8)**: 각각 핸들러 export 리팩터 / SCHEMA_VERSION 증분 시 함께.
- **L-4 IPC MessagePack** / **L-5 클러스터링 파티셔닝**: 실측 트리거 시.
