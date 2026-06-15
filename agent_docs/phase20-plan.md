# Phase 20 작업 계획 — diagnostic-v17 대응

> **작성**: 2026-06-15 / **기준 문서**: `agent_docs/diagnostic-v17.md` (기준 커밋 `0e3e092`, Phase 19 + Phase 19-1 완료)
> **목표**: diagnostic-v17가 발견한 **유일한 actionable 항목 M-1 v17 — FileWatcher 대용량-배치 `syncWithGit()` 경로 + 에러-복구 상태머신의 게이트 공백** 을 해소한다. `start()`가 등록하는 chokidar 이벤트(`add`/`change`/`unlink`)는 `handleChange()`→`flush()`로 흘러드는데, `flush()`의 *대용량-배치 분기*(`currentQueue.length >= 50 || syncFailedCount > 0`, file-watcher.ts:138-154)와 그에 딸린 *복구 상태머신*(성공 시 `syncFailedCount=0` 리셋, catch→`syncFailedCount++` 재시도, `>= MAX_SYNC_RETRIES(3)` FATAL 강등, `syncFailedCount > 0` 후속 flush git-sync 락인)은 어느 게이트(vitest·e2e)에서도 검증되지 않는다. 현 `file-watcher.test.ts`는 H-2/H-3/H-1로 *소용량 `processBatch` 경로만* 행사하며 `makePipeline()`의 `syncWithGit` mock은 단 한 번도 호출되지 않는다. e2e(`integration-test.js:173`)도 `updatePipeline.syncWithGit()`을 *직접* 부를 뿐 watcher의 대용량-배치 라우팅을 행사하지 않는다. 이 분기들을 기존 `makePipeline()`/`(watcher as any).flush()` 직접 호출 하니스로 `tests/file-watcher.test.ts`에 추가해 CI vitest 게이트로 끌어올린다. 계속 보류/이연/추적 항목(L-2/L-3/L-4/L-5/L-6/L-7/L-8)은 본 계획에서 추적만 갱신하거나 제외하고 기록을 유지한다(4장).
>
> **맥락**: **v15→Phase18은 MCP 도구 디스패처(20/20), v16→Phase19는 REST `/api/*` 핸들러(8개 동작 분기)를 게이트화했다.** Phase 20은 그 3중 대조 방법론(등록 ↔ 테스트 케이스 ↔ CI 게이트)을 **세 번째 등록 표면인 이벤트 핸들러(chokidar)로 확장**한 데서 나온다 — file-watcher 이벤트·bootstrap 엔트리·worker-pool/embedding 에러-복구·DB 마이그레이션을 같은 격자로 재대조했고, **file-watcher 표면에서 실재하는 무위험 공백**(대용량-배치/복구)을 찾았다(bootstrap·worker-pool·migration 잔여 분기는 인접 분기 게이트 커버 + 테스트-only로 메우려면 프로덕션 리팩터/추가 인프라/타이밍-flaky 위험이라 L-8로 추적만, 의도적 비-actionable). 공급망·CVE·코드 결함은 여전히 clean(CRITICAL/HIGH 0, 신규 CVE 도달 0, Miasma 신규 변종도 Cynapx 트리·in-tree 설정 도달 0). M-1 v17은 **프로덕션 코드 동작을 한 줄도 바꾸지 않는 순수 additive 테스트 항목**이다 — 대용량-배치/복구 경로는 실제로 정상 동작하나, 그 동작 회귀(임계 라우팅 제거로 일괄 변경 폭주, 재시도 카운터 회귀로 무한 git-sync 루프, FATAL 강등 회귀로 무한 실패 침묵)가 어느 게이트도 통과 못 잡는다. 따라서 Phase 20은 **단일 테스트-only 서브 페이즈(P20-1) + 추적 상태 갱신**이며, 예상 **2커밋**(diagnostic-v17 + phase20-plan docs 커밋 1 + P20-1 테스트 커밋 1) 또는 운영 편의상 **1~2커밋**이다.

---

## 0. 작업 원칙

- 본 계획의 핵심 작업(P20-1)은 **테스트-only**다 — `src/` 프로덕션 코드는 한 줄도 바꾸지 않는다(경로는 정상). 신규 케이스는 `tests/file-watcher.test.ts`에 추가한다(기존 `makePipeline()`/`flush()` 직접 호출 하니스 재사용).
- 본 사이클에 의존성 변경은 없다. `npm audit --omit=dev` **0 vulnerabilities** 유지가 baseline 불변(P14-1 audit 게이트 그대로 유효). 신규 의존 도입 0.
- Phase 종료 시 `npx vitest run`이 **588 + 신규 케이스**로 그린, `npx tsc --noEmit` 그린 확인. e2e 스크립트(`integration-test.js`/`ipc-e2e-test.js`)는 watcher 대용량-배치 경로 무접촉이라 영향 없음(선택 확인 불요).
- Phase 종료 시 `agent_docs/diagnostic-v17.md`의 M-1 v17에 [DONE] 마킹.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.**

---

## 1. 의존성 맵 (작업 순서에 영향을 주는 관계)

```
P20-1 (FileWatcher 대용량-배치 + 복구 상태머신 vitest 테스트 추가)   독립 — 유일한 코드(테스트) 작업 단위.
  └─ 대용량 트리거 → syncWithGit 호출 + 성공 리셋   ← 우선순위 1 (분기 명확, mock 최소, queue ≥ 50 또는 직접 flush)
  └─ 실패 catch → syncFailedCount++ 재시도 (1회 실패 → retriable 로그)
        ← syncWithGit reject mock; syncFailedCount 검증
  └─ syncFailedCount ≥ MAX_SYNC_RETRIES(3) → FATAL 강등 분기
        ← syncWithGit 연속 reject 3회; FATAL 로그/카운터 검증
  └─ syncFailedCount > 0 → 후속 flush git-sync 락인 (소용량이어도 syncWithGit 경로)
        ← 1회 실패 후 소용량 변경이 processBatch가 아니라 syncWithGit로 라우팅됨 검증
```

```
L-2 (Miasma 신규 변종 — GitHub 저장소 침투형 AI-에이전트 설정 주입)  ──추적만──→  [npm wave 재발 없음 + GitHub-저장소/`.claude`·`.cursor`·`.gemini` 설정 주입 변종 인지; 매 사이클 in-tree 에이전트 설정에 SessionStart 훅/외부 스크립트 끼어듦 점검(현재 `.claude/launch.json` 양성) + binding.gyp 검토 + npm ci lockfile 고정 + npm ls 재대조; Cynapx 도달 0건 불변]
L-3 (MCP stateless/task 마이그레이션)  ──이연──→  [SDK v2 npm 정식 배포(7/28 stable 예고)까지 — alpha는 있으나 npm latest 미배포, 착수 불가]
L-4 (IPC MessagePack)                 ──계속 보류──
L-5 (클러스터 본격 파티셔닝)           ──계속 이연──
L-6 (Node 24 tree-sitter 빌드)         ──추적만──→  [node-tree-sitter#268 해소 + Node 24 LTS 전환 시]
L-7 (admin CLI cmd* 게이트 공백)       ──추적만(비-actionable)──→  [admin.ts 핸들러 export 리팩터 시 함께 게이트화]
L-8 (worker-pool/embedding/migration 잔여 분기)  ──추적만(비-actionable)──→  [인접 분기 게이트 커버 + 마이그레이션 롤백 픽스처(추가 인프라)/A-7 타이밍-flaky 위험; SCHEMA_VERSION 증분 또는 worker-pool 리팩터 시 함께 게이트화]
SCIP export                           ──전략 후보──→  [P18-1(MCP export) + P19-1(REST export) 디딤돌 마련 완료; protobuf 의존 부담으로 즉시 착수 비권장]
```

---

## 2. Phase 20-1: FileWatcher 대용량-배치 + 복구 상태머신 vitest 테스트 추가 (M-1 v17) — 테스트-only·무위험

**목표**: CI vitest 게이트의 FileWatcher 대용량-배치/복구 동작 테스트 공백을 메운다. `flush()`의 대용량-배치 분기와 에러-복구 상태머신을 `tests/file-watcher.test.ts`에 vitest 케이스로 추가한다. **프로덕션 코드는 건드리지 않는다(경로 정상).**

| 항목 | 파일 | 작업 |
|------|------|------|
| 대용량 트리거 → syncWithGit (우선순위 1) | `tests/file-watcher.test.ts` | 50개 이상 변경을 큐에 쌓거나(`handleChange` 50회 → 임계 트립) `(watcher as any).flush()`를 직접 호출하는 셋업으로 **대용량-배치 분기 진입 → `pipeline.syncWithGit('/mock/project')` 1회 호출 + `processBatch` 미호출** 검증. 성공 mock(`mockResolvedValue(undefined)`) → 이후 `(watcher as any).syncFailedCount === 0` 리셋 검증. |
| 실패 catch → 재시도(retriable) | `tests/file-watcher.test.ts` | `syncWithGit` `mockRejectedValueOnce` → 대용량 flush 1회 → `(watcher as any).syncFailedCount === 1` 검증(retriable 분기, FATAL 미진입). 프로덕션 코드 무변경(`log.error` 호출 여부는 logger spy로 선택 검증). |
| FATAL 강등(≥ MAX_SYNC_RETRIES) | `tests/file-watcher.test.ts` | `syncWithGit` 연속 reject → 대용량 flush 3회 반복 → `(watcher as any).syncFailedCount === 3` + FATAL 분기 진입 검증(`MAX_SYNC_RETRIES=3`). logger spy로 FATAL 메시지 1회 선택 검증. |
| 실패 후 git-sync 락인 | `tests/file-watcher.test.ts` | 1회 실패(`syncFailedCount=1`)로 만든 뒤 **소용량 변경(queue < 50) flush가 `processBatch`가 아니라 `syncWithGit`로 라우팅**됨을 검증(line 138 `syncFailedCount > 0` 분기). 이후 `syncWithGit` 성공 → 락인 해제(`syncFailedCount=0`, 다음 소용량은 `processBatch`로 복귀) 검증. |
| 베이스라인 재확인 | (검증) | `npx vitest run` = 588 + 신규 케이스 그린, `npx tsc --noEmit` 그린, `npm audit --omit=dev` 0 vulnerabilities(불변). |
| M-1 v17 마킹 | `agent_docs/diagnostic-v17.md` | M-1 v17에 [DONE] + 게이트로 끌어올린 분기 목록·신규 케이스 수 기록. |

**설계 메모(핸들러 동작 — 직접 확인)**:
- 이벤트 등록: `start()`(file-watcher.ts:79-82) — `.on('add')`→ADD, `.on('change')`→MODIFY, `.on('unlink')`→DELETE 전부 `handleChange()`로. (chokidar 자체 통합은 라이브러리 경계라 테스트-only 단위 대상 아님 — 우리 코드 `flush` 분기에 집중.)
- `flush()` 대용량 트리거: `currentQueue.length >= BATCH_THRESHOLD(50) || this.syncFailedCount > 0`(file-watcher.ts:138). 성공 → `syncFailedCount = 0`(line 146); catch → `syncFailedCount++`(line 148); `>= MAX_SYNC_RETRIES(3)` → FATAL 로그(line 149-150) vs 미만 → retriable 로그(line 151-152).
- 소용량 경로: queue < 50 AND syncFailedCount === 0 → `processBatch`(line 155-163). **즉 1회 실패 후엔 소용량이어도 대용량 분기로 라우팅됨(복구 락인) — 본 항목 핵심.**
- 하니스: `makePipeline({ syncWithGit: vi.fn().mockRejectedValueOnce(...) })` + `(watcher as any).flush()` 직접 호출(이미 H-3에서 `(watcher as any).flush()`/`(watcher as any).queue`/`(watcher as any).syncFailedCount` 접근 패턴 사용 중). logger 메시지 단정이 필요하면 `vi.spyOn(Logger.prototype, 'error')` 사용(선택). 임계 트립 케이스는 `for (let i=0;i<50;i++) handleChange(...)` 패턴(이미 H-3 "clears pending timer" 케이스에 존재) 재사용.

**테스트**:
- 신규 케이스 자체가 검증 산출물. 기존 588 케이스 불변 그린 + 신규 케이스 그린.
- `npx tsc --noEmit` 그린(테스트 타입 정합), `npm audit --omit=dev` 0 vulnerabilities(불변).
- e2e 스크립트는 watcher 대용량-배치 경로 무접촉이라 무영향(선택 확인 불요).

**산출물**: 1개 커밋(`tests/file-watcher.test.ts` 신규 케이스 + diagnostic-v17 [DONE] 마킹). **리스크: 매우 낮음** (테스트-only, 프로덕션 코드·설치본·동작 전부 불변. 최악의 경우 mock/타이밍 결합으로 인한 테스트 취약성뿐이며, 핵심 분기·최소 mock·fake-timer 불요(flush 직접 호출) 원칙으로 완화).

---

## 3. 유지보수 모드 포스처 ("정기 점검" 이월)

P20-1 외에는 19 페이즈 이후의 성숙도가 유지되므로, 다음을 정기 점검 항목으로 이월한다:

1. **공급망 위생(매 사이클)**: `npm audit --omit=dev` = 0 vulnerabilities 유지. 신규 advisory 시 `overrides`로 패치 floor 못 박기(fast-uri/qs/hono 패턴). **의존 추가 시 binding.gyp 검토**(Miasma/Phantom Gyp) + CI는 `npm ci`(lockfile 고정)만 사용 + 매 사이클 `npm ls`로 컴프로마이즈 패키지 패밀리 트리 진입 재대조(현재 0건). **신규: Miasma의 GitHub-저장소 침투/AI-에이전트 설정 주입 변종 인지 — 매 사이클 in-tree `.claude/`·`.cursor/`·`.gemini/` 설정에 SessionStart 훅/외부 `setup.mjs`/원격 스크립트가 끼어들지 않았는지 점검**(현재 `.claude/launch.json`은 프로젝트 자체 bootstrap 기동 양성).
2. **MCP SDK v2 npm 배포 모니터링**: npm `latest`가 2.x로 넘어가면(현재 1.29.0, 7/28 stable 예고, alpha는 npm 정식 미배포) L-3(stateless transport + task extension 마이그레이션)이 비로소 actionable — P15-3 설계 메모가 출발점. 그 전까지 1.29.0 유지가 정답.
3. **런타임 수명주기**: Node 22 LTS(2027-04 종료)·tree-sitter 코어/grammar 신버전·tree-sitter-c-sharp 0.23.6+(ERR_REQUIRE_ASYNC_MODULE 해소) 출현 시 정렬 재검토. Node 24 LTS 전환은 node-tree-sitter#268(C++20/prebuild) 해소 후. better-sqlite3 12.10.1(Electron 전용 no-op 갱신)은 다음 정기 의존성 갱신 시 정렬 가능(비-긴급).
4. **회귀 안전망 위생(P18-1 MCP 도구 → P19-1 REST 핸들러 → P20-1 이벤트 핸들러로 확장)**: 새 도구/REST 라우트/이벤트 핸들러/포맷 추가 시 디스패처-레벨 또는 supertest/단위-레벨 vitest 케이스를 함께 추가해 CI 게이트 커버리지 유지(integration-test.js/ipc-e2e-test.js는 CI 밖이고 watcher 대용량-배치는 e2e조차 안 침 — vitest 게이트가 1차 방어). admin CLI(L-7)·worker-pool/migration 잔여 분기(L-8)는 핸들러 export/SCHEMA_VERSION 증분/리팩터 시 함께 게이트화.

---

## 4. 보류/이연 항목 판정 (diagnostic-v17 → Phase 20 verdict)

| 항목 | diagnostic-v17 판정 | Phase 20 처리 |
|------|--------------------|---------------|
| **M-1 v17 FileWatcher 대용량-배치/복구 게이트 공백** | `flush()` 대용량-배치 분기 + 복구 상태머신(성공 리셋/재시도/FATAL/락인) 실 게이트 미검증, e2e조차 watcher 경로 미접촉 (**verdict: actionable, 무위험 additive**) | **P20-1에서 해소** — 대용량 트리거→syncWithGit 우선 + 재시도/FATAL/락인 vitest 테스트 추가 |
| **L-2(v17) Miasma / Phantom Gyp 공급망 포스처** | npm wave 재발 없음 + **GitHub-저장소 침투형 AI-에이전트 설정 주입 변종 신규 인지**(6/5 MS 73 repos, `.claude/setup.mjs`·`settings.json`·`.cursor/rules`·`.gemini`), Cynapx 트리·in-tree 설정 0건 재대조 (**verdict: 추적만, 도달 0건 불변**) | 추적 상태만 갱신(3장) + binding.gyp 검토·lockfile 고정·매 사이클 `npm ls` + **in-tree 에이전트 설정 무결성 점검** 추가 |
| **L-3(v17) MCP stateless transport + task extension 마이그레이션** | SDK v2 alpha 존재하나 npm 정식 미배포(7/28 stable 예고), 착수 불가 (**verdict: 계속 이연, 상태 불변**) | 범위 제외 — SDK v2 npm 배포까지 이연. P15-3 설계 메모가 출발점 |
| **L-4(v17) IPC MessagePack 직렬화** | 성능 문제 미관측 (**verdict: 계속 보류**) | 범위 제외 — 기록만 유지 |
| **L-5(v17) 클러스터링 본격 서브그래프 파티셔닝** | 현실 규모 무해, 100k+ 노드 실측 시 재검토 (**verdict: 계속 이연**) | 범위 제외 — M-4(v12) count-first 가드가 OOM 방어 |
| **L-6(v17) Node 24 + tree-sitter 빌드 fragility** | node-tree-sitter#268 여전히 open·미해결(후속 0), Node 24 CI 그린 (**verdict: 추적, 상태 불변**) | 추적 상태만 갱신, 본격 대응은 Node 24 LTS 전환 시 |
| **L-7(v17) admin CLI cmd* 게이트 공백** | `cmd*` 미-export라 테스트-only로 메울 수 없음(프로덕션 리팩터 수반), 기반 프리미티브는 이미 게이트 커버 (**verdict: 추적만, 비-actionable**) | 범위 제외 — admin.ts 핸들러 export 리팩터 시 함께 게이트화 후보로 기록 |
| **L-8(v17) worker-pool/embedding/migration 잔여 분기** | worker error 이벤트·backpressure·A-7 레이스·migration 0→1/2→3 미검증이나 인접 분기 게이트 커버 + 메우려면 추가 인프라(롤백 픽스처)/타이밍-flaky 위험 (**verdict: 추적만, 비-actionable**) | 범위 제외 — SCHEMA_VERSION 증분 또는 worker-pool 리팩터 시 함께 게이트화 후보로 기록 |
| **SCIP export(전략 후보)** | MCP `export_graph`(P18-1) + REST `/api/graph/export`(P19-1) 디딤돌 마련 완료 (**verdict: 전략 후보, 즉시 비권장**) | 범위 제외 — protobuf 의존 부담 + install-time 표면 확대 우려로 즉시 착수 비권장 |

---

## 5. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 20-(docs) | diagnostic-v17 + phase20-plan 신규 docs | 1 | 없음 (docs-only) |
| 20-1 | M-1 v17: FileWatcher 대용량-배치/복구 vitest 테스트 추가(대용량 트리거→syncWithGit 우선 + 재시도/FATAL 강등/git-sync 락인) + diagnostic-v17 [DONE] — 588 + 신규 케이스 그린, tsc 그린, audit 0 vulns | 1 | 매우 낮음 (테스트-only, 프로덕션 코드 무변경) |

**총 1~2개 커밋.** 본 사이클은 **v15→Phase18(MCP 도구)·v16→Phase19(REST 핸들러)의 회귀-안전망 위생 작업을 세 번째 등록 표면(이벤트 핸들러)으로 확장**한다 — 프로덕션 동작은 여전히 불변(테스트-only)이라 무위험이다. **이번 사이클의 본질은 (1) 3중 대조를 세 번째 등록 표면(file-watcher 이벤트 핸들러)으로 확장해 실재 공백 발견 + (2) CI 회귀 안전망 위생 + (3) 추적 상태 고정(L-8 신규 추적 + Miasma GitHub-침투 변종 포스처 포함) + 유지보수 포스처 이월**이다. Phase 20 종료 시 `agent_docs/diagnostic-v17.md`의 M-1 v17에 [DONE] 마킹.

---

## 6. 향후 후보 (Phase 20 범위 밖 — 기록 유지)

- **MCP transport v2 마이그레이션**: SDK v2 stable(2026-07-28 예고, alpha는 npm 정식 미배포) + spec final 후 — stateless transport(session-id 제거) + task extension(`tasks/get`/`update`/`cancel`) 전면 채택. L-3 + P15-3 설계 메모가 출발점. **트리거: npm `latest`가 2.x로 전환.**
- **SCIP export**: `export_graph`(+ REST `/api/graph/export`)에 SCIP 포맷 추가 — Sourcegraph/SCIP 생태계 상호운용. **선행 조건: P18-1(MCP export 디스패처 게이트) + P19-1(REST export 게이트) 완료(디딤돌 마련 완료)** — 기존 분기가 게이트로 보호된 뒤 신규 포맷 추가가 안전. protobuf 빌드 의존 추가 부담 + install-time 공급망 표면(Miasma류) 확대 우려로 즉시 착수 비권장.
- **bootstrap 엔트리 게이트화**: bootstrap의 acquireAndRun 락 상태머신·HTTPS 실패 exit·원샷 CLI·시그널 teardown을 통합 테스트하려면 `process.exit`/시그널/IPC 광범위 모킹 또는 엔트리 분해 리팩터 수반 — 무위험 사이클 부적합. 별도 리팩터 페이즈로(의존 프리미티브는 이미 게이트 커버).
- **admin CLI 게이트화(L-7)**: `admin.ts`의 `cmd*` 핸들러를 export로 분리하는 리팩터 동반 시 status/list/inspect/doctor 등 비-파괴 명령부터 vitest 게이트 추가. 프로덕션 시그니처 변경 수반이라 무위험 사이클 부적합.
- **worker-pool/embedding/migration 게이트화(L-8)**: worker error 이벤트·backpressure 거부·A-7 supersedence 레이스·migration 0→1/2→3 — SCHEMA_VERSION 증분(롤백 픽스처 인프라 동반) 또는 worker-pool 리팩터 시 함께. A-7은 fake-timer flaky 위험으로 신중히.
- **L-4 IPC MessagePack**: 성능 실측에서 IPC 직렬화가 병목으로 드러날 때 재검토(현재 미관측).
- **L-5 클러스터링 서브그래프 파티셔닝**: 100k+ 노드 모노레포 실측 시 — 파일/디렉터리 경계 기반 파티셔닝. M-4 count-first 가드가 그때까지 OOM 방어.
- **Node 24 LTS 전환**: tree-sitter 0.25.x prebuild 가용성 + C++20 빌드 환경 확정 후(node-tree-sitter#268 해소 추적).
- **tree-sitter-c-sharp 0.23.6+ 정렬**: ERR_REQUIRE_ASYNC_MODULE 해소 신버전 출현 시 0.23.1 정확 핀 롤백 해제 검토(현재 npm 최신 0.23.5도 미해소).
- **better-sqlite3 12.10.1 정렬**: Electron 전용 no-op 갱신이라 비-긴급 — 다음 정기 의존성 갱신 시 정렬.
