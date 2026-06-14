# Phase 17 작업 계획 — diagnostic-v14 대응

> **작성**: 2026-06-14 / **기준 문서**: `agent_docs/diagnostic-v14.md` (기준 커밋 `af196fe`, Phase 16 완료)
> **목표**: diagnostic-v14의 진단 결과 — **이번 사이클 코드 변경 항목 0건** — 을 반영해, 추적/이연 항목(L-2 Miasma 공급망 포스처, L-3 MCP SDK v2 대기, L-6 Node 24 빌드)의 상태를 다음 사이클 출발점으로 고정하고 유지보수 모드 포스처를 재선언한다. 계속 보류/이연 판정된 항목(L-4 IPC MessagePack, L-5 클러스터링 본격 파티셔닝, MCP 전면 stateless/task 마이그레이션)은 본 계획에서 제외하고 기록만 유지한다(4장).
>
> **맥락**: **16개 페이즈·~33 커밋의 하드닝 이후 코드베이스는 steady state(유지보수 모드)를 유지한다.** 코드·공급망 양쪽 모두 **CRITICAL/HIGH/MEDIUM 신규 결함 0**, LOW 5(전부 추적/이연, v13 승계, 신규 0). diagnostic-v13의 유일한 코드-변경 항목(M-1 v13 fast-uri override floor)은 Phase 16-1에서 처리·커밋 완료됐다. **이번 사이클에는 코드 변경을 요구하는 결함이 단 한 건도 없다** — 신규 CVE 중 Cynapx 도달 가능 0건, 추적 중인 외부 신호 두 가지(Miasma 공급망 웜, MCP SDK v2)는 v13에서 식별된 그대로이며 둘 다 즉시 코드 변경을 요구하지 않는다(Miasma 컴프로마이즈 패키지는 Cynapx 의존 트리에 0건, SDK v2는 여전히 pre-alpha·npm 미배포라 마이그레이션 착수 불가). 따라서 Phase 17은 **단일 docs-only 서브 페이즈(P17-1) + 유지보수 모드 포스처 재선언**이며, 예상 **1커밋**(diagnostic-v14 + phase17-plan 신규 docs 자체가 산출물)이다. 이는 패딩이 아니라 프로젝트가 도달한 성숙도의 정직한 반영이다 — Phase 16(코드 한 글자)보다도 작다.

---

## 0. 작업 원칙

- 본 계획은 **docs/메타데이터 위생 수준의 단일 커밋**으로 끝난다(코드 변경 0 — 추적 상태 갱신 + 유지보수 포스처 재선언만).
- 본 사이클에 의존성 변경은 없다. `npm audit --omit=dev` **0 vulnerabilities** 유지가 baseline 불변(P14-1 audit 게이트 그대로 유효).
- Phase 종료 시 `npx vitest run` **563/563** + `npx tsc --noEmit` 그린 확인(코드 무변경이라 불변). 통합 스크립트(`scripts/integration-test.js`)는 native/transport 무영향이라 선택 확인.
- Phase 종료 시 `agent_docs/diagnostic-v14.md`에 [DONE] 마킹.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.**

---

## 1. 의존성 맵 (작업 순서에 영향을 주는 관계)

```
P17-1 (추적 상태 갱신 + 유지보수 포스처 재선언)   독립 — 유일한 작업 단위. docs-only, 코드 무변경.
```

```
L-2 (Miasma 공급망 포스처)        ──추적만──→  [의존 추가 시 binding.gyp 검토 + npm ci lockfile 고정 유지]
L-3 (MCP stateless/task 마이그레이션) ──이연──→  [SDK v2 npm 배포까지 — 여전히 pre-alpha·미배포, 착수 불가]
L-4 (IPC MessagePack)             ──계속 보류──
L-5 (클러스터 본격 파티셔닝)        ──계속 이연──
L-6 (Node 24 tree-sitter 빌드)     ──추적만──→  [node-tree-sitter#268 해소 + Node 24 LTS 전환 시]
```

---

## 2. Phase 17-1: 추적 상태 갱신 + 유지보수 모드 포스처 재선언 — docs-only·무위험 [DONE]

**목표**: diagnostic-v14가 확인한 steady state를 다음 사이클로 깔끔히 이월한다. 본 사이클에는 코드-변경 항목이 없으므로, Phase 17의 산출물은 (a) 추적/이연 항목의 현 상태를 진단 문서에 고정하고(다음 사이클 출발점 명확화), (b) 유지보수 모드 포스처를 재선언하는 것이다. **코드는 전혀 건드리지 않는다.**

| 항목 | 파일 | 작업 |
|------|------|------|
| 추적 상태 고정 | `agent_docs/diagnostic-v14.md` (본 사이클 산출물) | L-2(Miasma: Cynapx 의존 트리 0건 재대조, `npm ci`+audit 게이트 1차 방어, 추적만)·L-3(SDK v2 여전히 pre-alpha·npm 미배포, 착수 불가, 계속 이연)·L-6(node-tree-sitter#268 여전히 open, Node 24 CI 그린, 추적만) 상태를 명시(diagnostic-v14 4장·6장에 반영 완료). |
| audit/baseline 재확인 | (검증) | `npm audit --omit=dev` **0 vulnerabilities** + `npm ls fast-uri`=`3.1.2 overridden` + `npx tsc --noEmit` clean + `npx vitest run` **563/563**(전부 직접 확인 완료, 불변). |
| 유지보수 포스처 재선언 | `agent_docs/phase17-plan.md` (3장) | 정기 점검 리듬(공급망 위생·MCP SDK v2 모니터링·런타임 수명주기)을 다음 사이클로 이월. |

**테스트**:
- 코드 동작 무변경(docs-only) — 기존 전체 스위트 그린.
- `npx tsc --noEmit` 그린, `npx vitest run` **563/563**(불변, 본 사이클 직접 확인).
- `npm audit --omit=dev` **0 vulnerabilities**(불변).

**산출물**: 1개 커밋(diagnostic-v14 + phase17-plan 신규 docs). **리스크: 없음** (docs-only, 코드·설치본·동작 전부 불변, 회귀 위험 0).

---

## 3. 유지보수 모드 포스처 (Phase 17 본질 — "정기 점검" 이월)

16 페이즈 이후 코드베이스가 steady state를 유지하므로, Phase 17의 진짜 산출물은 **단발 수정이 아니라 유지보수 리듬의 이월**이다. 다음을 정기 점검 항목으로 둔다(v16 계획에서 이월·갱신):

1. **공급망 위생(매 사이클)**: `npm audit --omit=dev` = 0 vulnerabilities 유지. 신규 advisory 발생 시 `overrides`로 패치 floor에 못 박기(fast-uri/qs/hono 패턴 — Phase 16-1의 fast-uri `^3.1.2`가 최근 사례). **의존 추가 시 binding.gyp 검토**(Miasma/Phantom Gyp류 install-time 웜 대비) + CI는 `npm ci`(lockfile 고정)만 사용·`npm install` 자동화 금지. Miasma 컴프로마이즈 패키지 패밀리가 Cynapx 트리에 진입했는지 매 사이클 `npm ls` 재대조(현재 0건).
2. **MCP SDK v2 npm 배포 모니터링**: npm `latest`가 2.x로 넘어가면(현재 1.29.0, v2.x dist-tag 미배포) L-3(stateless transport + task extension 마이그레이션)이 비로소 actionable — P15-3의 `handleMcp()`/`_progress.ts`/`tool-dispatcher.ts`/`ipc-coordinator.ts` 설계 메모가 출발점. 그 전까지는 1.29.0 유지가 정답(v1.x는 v2 출시 후 6개월+ 보안 픽스 유지). v2 alpha/beta 마일스톤이 npm 정식 배포로 이어지는지가 트리거.
3. **런타임 수명주기**: Node 22 LTS(2027-04 종료)·tree-sitter 코어/grammar 신버전·tree-sitter-c-sharp 0.23.6+(ERR_REQUIRE_ASYNC_MODULE 해소 버전) 출현 시 정렬 재검토. Node 24 LTS 전환은 node-tree-sitter#268(C++20/prebuild) 해소 후.

---

## 4. 보류/이연 항목 판정 (diagnostic-v14 → Phase 17 verdict)

| 항목 | diagnostic-v14 판정 | Phase 17 처리 |
|------|--------------------|---------------|
| **L-2(v14) Miasma / Phantom Gyp 공급망 포스처** | 컴프로마이즈 57패키지+@redhat-cloud-services+@vapi-ai Cynapx 의존 트리 0건(재대조), `npm ci`+audit 1차 방어 (**verdict: 추적만, 상태 불변**) | **추적 상태만 P17-1**에 갱신 + 유지보수 포스처(3장)에 binding.gyp 검토·lockfile 고정·매 사이클 `npm ls` 재대조 명시 |
| **L-3(v14) MCP stateless transport + task extension 마이그레이션** | SDK v2 여전히 pre-alpha(npm 미배포), 착수 불가 (**verdict: 계속 이연, 상태 불변**) | 범위 제외 — SDK v2 npm 배포까지 이연. P15-3 설계 메모가 출발점 |
| **L-4(v14) IPC MessagePack 직렬화** | 성능 문제 미관측, 메시지 작고 round-trip 드묾 (**verdict: 계속 보류**) | 범위 제외 — 기록만 유지 |
| **L-5(v14) 클러스터링 본격 서브그래프 파티셔닝** | 현실 규모 무해, 100k+ 노드 실측 시 재검토 (**verdict: 계속 이연**) | 범위 제외 — M-4(v12) count-first 가드가 OOM 방어 |
| **L-6(v14) Node 24 + tree-sitter 빌드 fragility** | node-tree-sitter#268 여전히 open, Node 24 CI 그린 (**verdict: 추적, 상태 불변**) | **추적 상태만 P17-1**에 갱신, 본격 대응은 Node 24 LTS 전환 시 |

---

## 5. 전체 순서 요약

| Phase | 핵심 항목 | 커밋 수 | 리스크 |
|-------|-----------|---------|--------|
| 17-1 | L-2/L-3/L-6 추적 상태 갱신 + 유지보수 모드 포스처 재선언 (diagnostic-v14 + phase17-plan docs) [DONE] | 1 | 없음 (docs-only, 코드·설치본·동작 전부 불변) |

**총 1개 커밋.** Phase 17 전체 완료 — 다음 사이클은 신규 진단(diagnostic-v15.md) + phase18-plan.md 수립. Phase 16 대비도 **더 작다** — Phase 16은 코드 한 글자(override floor) 변경이 있었으나 Phase 17은 코드 변경이 전혀 없다. **이번 사이클의 본질은 코드 결함 수정이 아니라 (1) steady state 정직한 확인 + (2) 추적 상태 고정 + (3) 유지보수 모드 포스처 이월**이다. Phase 17 종료 시 `agent_docs/diagnostic-v14.md`에 [DONE] 마킹.

---

## 6. 향후 후보 (Phase 17 범위 밖 — 기록 유지)

- **MCP transport v2 마이그레이션**: SDK v2 stable(Q3 2026 예고, 현재 pre-alpha·npm 미배포) + 2026-07-28 spec final 후 — stateless transport(`Mcp-Method`/`Mcp-Name` 라우팅, session-id 제거) + task extension(server-directed handle, `tasks/get`/`update`/`cancel`) 전면 채택. L-3 + P15-3 설계 메모가 출발점. **트리거: npm `latest`가 2.x로 전환.**
- **L-4 IPC MessagePack**: 성능 실측에서 IPC 직렬화가 병목으로 드러날 때 재검토(현재 미관측).
- **L-5 클러스터링 서브그래프 파티셔닝**: 100k+ 노드 모노레포 실측 시 — 파일/디렉터리 경계 기반 파티셔닝(클러스터 품질 트레이드오프 동반). M-4의 count-first 가드가 그때까지 OOM 방어.
- **SCIP export**: `export_graph`에 SCIP 포맷 추가 — Sourcegraph/SCIP 생태계 상호운용(전략 후보).
- **Node 24 LTS 전환**: tree-sitter 0.25.x prebuild 가용성 + C++20 빌드 환경 확정 후(node-tree-sitter#268 해소 추적).
- **tree-sitter-c-sharp 0.23.6+ 정렬**: ERR_REQUIRE_ASYNC_MODULE(ESM/TLA 바인딩) 회귀를 해소하는 신버전 출현 시 0.23.1 정확 핀 롤백 해제 검토(현재 npm 최신 0.23.5도 미해소).
