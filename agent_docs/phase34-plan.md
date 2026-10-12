# Phase 34 작업 계획 — diagnostic-v31 대응

> **작성**: 2026-07-16 / **기준 문서**: `agent_docs/diagnostic-v31.md` (기준 커밋 `e2edc63`, P8 후속 2차 사이클 완료)
> **목표**: diagnostic-v31이 확인한 두 발화 트리거를 해소한다 — **T-3**(신규 prod 코드 → `isReceiverQualifiedCall()` 직접 게이트 공백, M-1)과 **T-4**(within-pin lockfile 드리프트 5건).

---

## 0. 작업 원칙

- 한 사이클(1~2 항목) 제한 원칙: 본 사이클은 *테스트-게이트 1건 + lockfile 정렬 1건*.
- prod 코드 무변경(P34-1은 테스트-only, P34-2는 lockfile-only).
- Phase 종료 시 `npx vitest run` 그린, `npx tsc --noEmit` 그린, `npm audit`/`npm audit --omit=dev` 0 재확인.
- **주의: `.github/workflows/cynapx-autonomous.yml`은 본 계획 전 범위에서 건드리지 않는다.**

## 1. 시작 베이스라인

| 항목 | 값 |
|------|-----|
| 기준 커밋 | `e2edc63` |
| 테스트 | 875/875 (57 파일) |
| within-pin 드리프트 | 5건 (js-yaml·ignore·vite·vitest·@types/supertest) |
| audit (prod/dev) | 0 / 0 |
| MCP SDK | 1.29.0 (2.x dist-tag 부재, T-1 미발화) |

## 2. 구현 항목

### P34-1 — `isReceiverQualifiedCall()` 직접 게이트 (M-1 v31, T-3 대응) ✅

- **위치**: `tests/intra-file-calls.test.ts` 신규 describe `isReceiverQualifiedCall (direct gates)`.
- **게이트**(5 `it`): ① undefined/무-parent → false, ② 수신자 컨텍스트 6 타입 전수(selector_expression/member_access_expression/navigation_expression/attribute/field_expression/member_expression) → true, ③ Java `method_invocation` + object 필드 → true, ④ object 필드 부재 free call → false, ⑤ 비-수신자 부모(call_expression 등) → false.
- **결과**: vitest 875→880, prod 무변경.

### P34-2 — within-pin lockfile 정렬 (T-4 대응) ✅

- `npm update @types/supertest ignore js-yaml vite vitest` → 전 행 Current=Wanted 재달성.
- js-yaml(prod) 4.3.0 · ignore(prod) 7.0.6 · vite 8.1.5 · vitest 4.1.10 · @types/supertest 7.2.1.
- audit 0/0 유지, 전체 스위트 880/880 그린.

## 3. 종료 게이트 ✅

- `npx vitest run` **880/880**, `npx tsc --noEmit` 그린, `npm run build` 그린, `npm audit`/`--omit=dev` 0/0, `npm outdated` within-pin 드리프트 0.

## 4. 다음 사이클 트리거

1. **T-1 [★1순위]**: 2026-07-28 스펙 publish 전후 MCP SDK 2.x dist-tag/v2 stable 재확인.
2. **T-2/T-4**: 신규 CVE / 드리프트 재누적 시 즉시 정렬.
3. **L-22**: major 마이그레이션(express 5 / typescript major)은 별도 전용 페이즈 유지.
4. **L-23(신규 추적)**: go.mod 캐시 stale 가능성 — 실측 문제 발생 시 mtime 무효화 검토.
