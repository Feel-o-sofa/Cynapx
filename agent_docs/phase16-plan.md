# Phase 16 작업 계획 — diagnostic-v13 대응

> **작성**: 2026-06-14 / **기준 문서**: `agent_docs/diagnostic-v13.md` (기준 커밋 `758d466`, Phase 15 완료)
> **목표**: diagnostic-v13이 식별한 유일한 코드-변경 항목(M-1 v13: fast-uri override floor 명시성)을 처리하고, 추적/이연 항목(L-2 Miasma 공급망 포스처, L-3 MCP SDK v2 대기, L-6 Node 24 빌드)의 상태를 갱신한다. 계속 보류/이연 판정된 항목(L-4 IPC MessagePack, L-5 클러스터링 본격 파티셔닝, MCP 전면 stateless/task 마이그레이션)은 본 계획에서 제외하고 기록만 유지한다(5장).
>
> **맥락**: **15개 페이즈·~31 커밋의 하드닝 이후 코드베이스는 steady state(유지보수 모드)에 도달했다.** 코드·공급망 양쪽 모두 **CRITICAL/HIGH 신규 결함 0**, MEDIUM 1(M-1, 한 글자 override floor, 동작 무변경), LOW 5(전부 추적/이연). 이번 사이클의 외부 신호 두 가지(Miasma 공급망 웜, MCP SDK v2)는 **둘 다 즉시 코드 변경을 요구하지 않는다** — Miasma 컴프로마이즈 패키지는 Cynapx 의존 트리에 0건이고, SDK v2는 여전히 pre-alpha(npm 미배포)라 마이그레이션 착수 불가. 따라서 Phase 16은 **단일 소형 서브 페이즈(P16-1) + 유지보수 모드 포스처 선언**이며, 예상 **1커밋**이다. 이는 패딩이 아니라 프로젝트가 도달한 성숙도의 정직한 반영이다.

---

## 0. 작업 원칙

- 본 계획은 **docs/메타데이터 위생 수준의 단일 커밋**으로 끝난다(M-1은 `package.json` override 한 글자 + lockfile 재확인, 동작 무변경).
- 의존성 변경(M-1 override floor)은 `npm audit --omit=dev` **0 vulnerabilities 유지** + `npm ls fast-uri` ≥ 3.1.2 + transport 회귀 그린을 확인한 뒤에만 완료로 본다(P14-1 audit 게이트 baseline 불변).
- Phase 종료 시 `npx vitest run` + `npx tsc --noEmit` 그린 확인 후 커밋. 통합 스크립트(`scripts/integration-test.js`)는 native/transport 무영향이라 선택 확인.
- Phase 종료 시 `agent_docs/diagnostic-v13.md`에 [DONE] 마킹.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.**

---

## 1. 의존성 맵 (작업 순서에 영향을 주는 관계)

```
P16-1 (M-1 fast-uri override floor 명시성 + 추적 상태 갱신)   독립 — 유일한 작업 단위. package.json 한 글자 + 추적 메모.
```

```
L-2 (Miasma 공급망 포스처)        ──추적만──→  [의존 추가 시 binding.gyp 검토 + npm ci lockfile 고정 유지]
L-3 (MCP stateless/task 마이그레이션) ──이연──→  [SDK v2 stable release까지 — 여전히 pre-alpha, 착수 불가]
L-4 (IPC MessagePack)             ──계속 보류──
L-5 (클러스터 본격 파티셔닝)        ──계속 이연──
L-6 (Node 24 tree-sitter 빌드)     ──추적만──→  [node-tree-sitter#268 해소 + Node 24 LTS 전환 시]
```

---

## 2. Phase 16-1: fast-uri override floor 명시성 복원 + 추적 상태 갱신 (M-1 v13) — 동작 무변경·저위험 [DONE]

**목표**: diagnostic-v13의 유일한 코드-변경 항목을 처리한다. (a) `overrides.fast-uri`의 선언 floor `^3.1.1`을 `^3.1.2`로 올려 CVE-2026-6322(host confusion, ≤3.1.1 영향, 3.1.2 패치) 패치 버전에 못 박는다 — 실제 설치본은 이미 3.1.2라 **위험은 0이고, "override floor ≥ 알려진 패치 버전" 불변을 선언 수준에서 복원**하는 명시성 개선이다. (b) 추적 항목(Miasma 공급망 포스처, MCP SDK v2 대기, Node 24 빌드)의 현 상태를 진단 문서에 갱신해 다음 사이클 출발점을 명확히 한다.

| 항목 | 파일 | 작업 |
|------|------|------|
| M-1(1) fast-uri floor 못 박기 | `package.json:71` (`overrides.fast-uri`) | `"fast-uri": "^3.1.1"` → `"^3.1.2"`. lockfile은 이미 3.1.2라 `npm install` 시 재해석 무변경(idempotent). qs(`^6.15.2`)·hono(`^4.12.21`)·tree-sitter(`^0.25.0`) floor는 각자 패치/최신을 이미 만족하므로 변경 없음. |
| M-1(2) audit 게이트 baseline 재확인 | (검증) | override 변경 후 `npm audit --omit=dev` **0 vulnerabilities 유지** + `npm ls fast-uri` = `3.1.2 overridden` 확인. P14-1 CI 게이트(`.github/workflows/ci.yml`)는 코드 변경 없이 그대로 유효(베이스라인 불변). |
| M-1(3) 추적 상태 갱신 | `agent_docs/diagnostic-v13.md` (또는 본 계획 참조) | L-2(Miasma: Cynapx 의존 트리 0건, `npm ci`+audit 게이트 1차 방어, 추적만)·L-3(SDK v2 여전히 pre-alpha, 착수 불가, 계속 이연)·L-6(node-tree-sitter#268 여전히 open, Node 24 CI 그린, 추적만) 상태를 명시해 다음 사이클 출발점 고정. |

**테스트**:
- 코드 동작 무변경(override floor는 선언적 메타데이터, 설치본 불변) — 기존 `tests/api-server-http.test.ts`·`tests/mcp-server.test.ts`(SDK transport 경유 fast-uri reachable 경로) 전체 그린.
- `npx tsc --noEmit` 그린, `npx vitest run` **563/563**(불변).
- `npm audit --omit=dev` **0 vulnerabilities**, `npm ls fast-uri` ≥ 3.1.2 확인.

**산출물**: 1개 커밋(diagnostic-v13 + phase16-plan 신규 docs 포함). **리스크: 매우 낮음** (override 한 글자, 설치본 불변, 동작 무변경, 회귀 위험 사실상 0).

---

## 3. 유지보수 모드 포스처 (Phase 16 본질 — "정기 점검" 권장)

15 페이즈 이후 코드베이스가 steady state에 도달했으므로, Phase 16의 진짜 산출물은 **단발 수정이 아니라 유지보수 리듬의 확립**이다. 다음을 정기 점검 항목으로 둔다:

1. **공급망 위생(매 사이클)**: `npm audit --omit=dev` = 0 vulnerabilities 유지. 신규 advisory 발생 시 `overrides`로 패치 floor에 못 박기(fast-uri/qs/hono 패턴). **의존 추가 시 binding.gyp 검토**(Miasma/Phantom Gyp류 install-time 웜 대비) + CI는 `npm ci`(lockfile 고정)만 사용·`npm install` 자동화 금지.
2. **MCP SDK v2 출시 모니터링**: npm `latest`가 2.x로 넘어가면 L-3(stateless transport + task extension 마이그레이션)이 비로소 actionable — P15-3의 `handleMcp()`/`_progress.ts`/`tool-dispatcher.ts`/`ipc-coordinator.ts` 설계 메모가 출발점. 그 전까지는 1.29.0 유지가 정답(v1.x는 v2 출시 후 6개월+ 보안 픽스 유지).
3. **런타임 수명주기**: Node 22 LTS(2027-04 종료)·tree-sitter 코어/grammar 신버전·tree-sitter-c-sharp 0.23.6+(ERR_REQUIRE_ASYNC_MODULE 해소 버전) 출현 시 정렬 재검토. Node 24 LTS 전환은 node-tree-sitter#268(C++20/prebuild) 해소 후.

---

## 4. 보류/이연 항목 판정 (diagnostic-v13 → Phase 16 verdict)

| 항목 | diagnostic-v13 판정 | Phase 16 처리 |
|------|--------------------|---------------|
| **L-2(v13) Miasma / Phantom Gyp 공급망 포스처** | 컴프로마이즈 57패키지 Cynapx 의존 트리 0건, `npm ci`+audit 1차 방어 (**verdict: 추적만**) | **추적 상태만 P16-1**에 갱신 + 유지보수 포스처(3장)에 binding.gyp 검토·lockfile 고정 명시 |
| **L-3(v13) MCP stateless transport + task extension 마이그레이션** | SDK v2 여전히 pre-alpha(npm 미배포), 착수 불가 (**verdict: 계속 이연**) | 범위 제외 — SDK v2 stable 출시까지 이연. P15-3 설계 메모가 출발점 |
| **L-4(v13) IPC MessagePack 직렬화** | 성능 문제 미관측, 메시지 작고 round-trip 드묾 (**verdict: 계속 보류**) | 범위 제외 — 기록만 유지 |
| **L-5(v13) 클러스터링 본격 서브그래프 파티셔닝** | 현실 규모 무해, 100k+ 노드 실측 시 재검토 (**verdict: 계속 이연**) | 범위 제외 — M-4(v12) count-first 가드가 OOM 방어 |
| **L-6(v13) Node 24 + tree-sitter 빌드 fragility** | node-tree-sitter#268 여전히 open, Node 24 CI 그린 (**verdict: 추적**) | **추적 상태만 P16-1**에 갱신, 본격 대응은 Node 24 LTS 전환 시 |

---

## 5. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 16-1 | M-1 fast-uri override floor `^3.1.1`→`^3.1.2`(CVE-2026-6322 패치 못 박기) + L-2/L-3/L-6 추적 상태 갱신 [DONE] | 1 | 매우 낮음 (override 한 글자, 설치본·동작 불변) |

**총 1개 커밋.** Phase 16 전체 완료 — 다음 사이클은 신규 진단(diagnostic-v14.md) + phase17-plan.md 수립. Phase 15 대비도 **더 작다** — 코드 변경이 필요한 항목이 M-1 한 건(동작 무변경)뿐이고 나머지는 전부 추적/이연이다. **이번 사이클의 본질은 코드 결함 수정이 아니라 (1) 공급망 위생 명시성 한 칸 복원 + (2) 유지보수 모드 포스처 선언 + (3) 두 외부 신호(Miasma, MCP SDK v2)의 추적 상태 고정**이다. Phase 16 종료 시 `agent_docs/diagnostic-v13.md`에 [DONE] 마킹.

---

## 6. 향후 후보 (Phase 16 범위 밖 — 기록 유지)

- **MCP transport v2 마이그레이션**: SDK v2 stable(Q3 2026 예고, 현재 pre-alpha·npm 미배포) + 2026-07-28 spec final 후 — stateless transport(`Mcp-Method`/`Mcp-Name` 라우팅, session-id 제거) + task extension(server-directed handle, `tasks/get`/`update`/`cancel`) 전면 채택. L-3 + P15-3 설계 메모가 출발점.
- **L-4 IPC MessagePack**: 성능 실측에서 IPC 직렬화가 병목으로 드러날 때 재검토(현재 미관측).
- **L-5 클러스터링 서브그래프 파티셔닝**: 100k+ 노드 모노레포 실측 시 — 파일/디렉터리 경계 기반 파티셔닝(클러스터 품질 트레이드오프 동반). M-4의 count-first 가드가 그때까지 OOM 방어.
- **SCIP export**: `export_graph`에 SCIP 포맷 추가 — Sourcegraph/SCIP 생태계 상호운용(전략 후보).
- **Node 24 LTS 전환**: tree-sitter 0.25.x prebuild 가용성 + C++20 빌드 환경 확정 후(node-tree-sitter#268 해소 추적).
- **tree-sitter-c-sharp 0.23.6+ 정렬**: ERR_REQUIRE_ASYNC_MODULE(ESM/TLA 바인딩) 회귀를 해소하는 신버전 출현 시 0.23.1 정확 핀 롤백 해제 검토(현재 npm 최신 0.23.5도 미해소).
