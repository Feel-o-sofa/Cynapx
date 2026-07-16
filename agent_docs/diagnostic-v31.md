# Cynapx 정밀 진단 보고서 v31

- **기준 커밋**: `e2edc63` (P8 후속 2차 사이클 완료 — C# 테스트-스펙 추출, go.mod 모듈 임포트 해소, 테스트-스펙 `targetQname` 베스트-에포트 해소. 브랜치 `claude/cynapx-status-goals-15uoop`, vitest 875/875)
- **진단 일자**: 2026-07-16
- **진단 범위**: **P8 후속 1·2차 사이클(dcd82ca~e2edc63)이 diagnostic-v30 이후 첫 신규 prod 코드를 추가했다 — T-3 발화.** 본 사이클은 그 신규 표면의 0-의존 순수 함수 게이트 공백 스캔 + 외부 트리거 체크리스트(T-1~T-7) 재스캔 + audit/lockfile 드리프트 재대조를 수행한다.
- **진단 방법**: `git log c524ade..e2edc63 --oneline`(신규 prod 코드 실측) + `npx vitest run` + `npx tsc --noEmit` + `npm audit --omit=dev` / `npm audit` + `npm outdated`(within-pin 드리프트) + `npm view @modelcontextprotocol/sdk dist-tags time.modified`(T-1 재확인).
- **현재 상태(직접 검증, Phase 34 반영 후)**: `npx vitest run` **880/880**(57 파일), `npx tsc --noEmit` 그린, `npm run build` 그린, **`npm audit`(dev 포함) = 0 vulnerabilities**, **`npm audit --omit=dev`(prod) = 0 vulnerabilities**, within-pin 드리프트 **0**(P34-2 정렬 완료).

> **요약**: **v30 이후 두 개의 내부/유지보수 트리거가 발화했고(T-3 신규 prod 코드, T-4 within-pin 드리프트), 본 사이클(Phase 34)에서 둘 다 즉시 해소했다.** **(1) T-3**: P8 후속 1·2차 사이클이 신규 prod 표면 7커밋을 추가 — 그중 export된 0-의존 순수 함수 2종을 점검: `inferProdFilePath()`는 도입 커밋에서 직접 게이트 동반(공백 없음), **`isReceiverQualifiedCall()`은 parse 경유 간접 게이트만 존재(M-1)** → **P34-1에서 직접 게이트 5 `it` 추가(875→880)**. 나머지 신규 로직(go.mod 캐시 2종·언어별 테스트-스펙 헬퍼)은 모듈-private이며 parse 픽스처로 전수 커버. **(2) T-4**: within-pin 드리프트 5건(js-yaml 4.2.0→4.3.0·ignore 7.0.5→7.0.6·vite 8.0.16→8.1.5·vitest 4.1.9→4.1.10·@types/supertest 7.2.0→7.2.1) → **P34-2 `npm update` 정렬, 드리프트 0 재달성**. **(3) T-1 미발화**: `dist-tags = { latest: '1.29.0' }`·`time.modified` 2026-06-04 불변 — 2.x dist-tag 부재. **스펙 publish 예정일 2026-07-28이 12일 앞** — 다음 사이클 재확인이 ★1순위. **(4) T-2 미발화**: prod·dev audit 0/0. **CRITICAL 0, HIGH 0, MEDIUM 0(M-1 → P34-1 즉시 해소), LOW(v30 승계 + L-22 불변).**

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** 신규 prod 코드(P8 후속 1·2차)는 전부 인덱서 파서/디스크립터 레이어의 추출·해소 로직으로, 보안 표면(IPC/API 인증·세션 관리) 무변경. prod·dev audit 0/0.

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** go.mod 해소의 fs 접근은 read-only(`existsSync`/`readFileSync`/`readdirSync`)이며 try/catch로 감싸 unreadable 경로에서 조용히 폴백. 캐시는 무-TTL Map이나 모듈 경로 변경은 프로세스 수명 내 사실상 발생하지 않음(grammar lazy-cache와 동일 수명 모델 — 주석으로 명시됨).

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

| # | 위치 | 내용 | 처리 |
|---|------|------|------|
| M-1(v31) | `src/indexer/tree-sitter-parser.ts` `isReceiverQualifiedCall()` | export된 0-의존 순수 함수(노드 shape 판정)인데 parse 경유 간접 게이트만 존재 — 6개 수신자 컨텍스트 타입·Java `method_invocation` object 필드 분기·무-parent 경계가 직접 게이트되지 않음 | **[DONE — P34-1]** 직접 게이트 5 `it` 추가 (undefined/무-parent, 6 컨텍스트 타입 전수, Java object 유/무, 비-수신자 컨텍스트) |

신규 표면 중 게이트 공백이 없는 항목(직접 확인):
- `inferProdFilePath()` — 도입 커밋(51da6ce)에서 직접 게이트 3 `it` 동반.
- Kotlin/PHP `normalizeDocstring` — docstring-normalization.test.ts 직접 게이트 동반.
- `findGoModule`/`listGoPackageFiles` — fs-의존 비-순수·모듈-private(L-20 잣대와 동일) — parse 픽스처 5 `it`로 동작 커버, 추적만.
- 언어별 테스트-스펙 헬퍼(hasTestAttribute/isTestClass/readGtestMacro 등) — 모듈-private, parse 픽스처 전수 커버.

## 4. 최적화 (LOW) — 추적/이연

v30 목록(L-2~L-9·L-13·L-14·L-19~L-22) 전부 승계·불변. 변동 사항만 기록:

| # | 변동 |
|---|------|
| L-3/T-1 | **스펙 publish 예정일 2026-07-28이 12일 앞** — `dist-tags` 여전히 `{ latest: '1.29.0' }`(2026-06-04 불변). 다음 사이클 재확인 ★1순위. |
| L-17류/T-4 | within-pin 드리프트 5건 발생 → **P34-2 정렬 완료(드리프트 0)**. js-yaml(prod) 4.3.0·ignore(prod) 7.0.6·vite 8.1.5·vitest 4.1.10·@types/supertest 7.2.1. audit 0/0 유지. |
| L-22 | major 누적 불변(express 5.2.1·typescript 최신 major·commander 15 등) — 비-actionable 추적 유지. |
| 신규 L-23(v31) | `src/indexer/languages/go.ts` go.mod/패키지-디렉터리 캐시 — 무-TTL Map(프로세스 수명). go.mod의 module 경로가 프로세스 실행 중 변경되면 stale 후보를 방출할 수 있으나, 미인덱스 후보는 파이프라인이 드롭하므로 실피해는 낮음. **비-actionable 추적**(장수 워커에서 문제 실측 시 mtime 기반 무효화 검토). |

## 5. 외부 트리거 체크리스트 (2026-07-16)

| # | 트리거 | 상태 |
|---|--------|------|
| T-1 | MCP SDK 2.x dist-tag / v2 stable | **미발화** — 스펙 publish 예정 2026-07-28(12일 앞), 다음 사이클 ★1순위 |
| T-2 | 신규 CVE Cynapx 도달 | **미발화** — audit 0/0 |
| T-3 | 신규 prod 코드 | **발화 → P34-1 해소** (M-1 직접 게이트) |
| T-4 | within-pin 드리프트 | **발화 → P34-2 해소** (5건 정렬, 드리프트 0) |
| T-5/T-6 | node-tree-sitter#268 / tree-sitter-c-sharp 0.23.6+ | 미확인 변동 없음 — 0.23.1 핀 유지 |
| T-7 | Miasma/Phantom Gyp 도달 | **미발화** — in-tree binding.gyp 0개 불변 |

## 6. 권장 수정 순서 (Phase 34 — 본 사이클에서 완료)

1. **P34-1 [DONE]**: `isReceiverQualifiedCall()` 직접 게이트 (M-1 v31).
2. **P34-2 [DONE]**: within-pin `npm update` 정렬 (T-4).
3. **다음 사이클**: T-1 재확인(2026-07-28 전후) — 2.x dist-tag/v2 stable 출현 시 L-3 actionable화.

**CRITICAL 0, HIGH 0, MEDIUM 0(M-1 → P34-1 해소), LOW(v30 승계 + L-23 신규 추적). 종료 상태: vitest 880/880, tsc 그린, build 그린, audit 0/0, within-pin 드리프트 0.**
