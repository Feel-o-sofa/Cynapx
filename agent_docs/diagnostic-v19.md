# Cynapx 정밀 진단 보고서 v19

- **기준 커밋**: `776afca` (Phase 21 + Phase 21-1 + Phase 21-2 완료, 브랜치 `claude/latest-commit-query-9askn1`)
- **진단 일자**: 2026-06-15
- **진단 범위**: src/ 전체(server, db, indexer, graph, watcher, utils, cli, bootstrap), schema/, scripts/, tests/ 전체, src-native/, Dockerfile, `.github/workflows/ci.yml`, `.claude/launch.json`, package.json/lockfile, README.md/GUIDE + 외부 컨텍스트(CVE/advisory, 공급망 캠페인, MCP 생태계, 경쟁 도구)
- **진단 방법**: 단일 에이전트 오케스트레이션 + 회의적 전수 코드 리뷰 + 로컬 직접 검증(`npx vitest run`[시간 측정 포함], `npx tsc --noEmit`, `npm audit`[dev 포함] 및 `npm audit --omit=dev`, `npm ls`로 전이 의존 버전 확인, `npm view`로 registry `latest`/dist-tag 확인) + **신규 각도: v18이 "5연속 테스트-격차 수확 소진 → 각도 전환(dev 공급망 + 문서)"으로 무위험 actionable 2건(postcss override·README 동기화)을 처리한 직후이므로, v19는 (a) prod 코드가 진짜 steady-state인지 회의적 재확인 + (b) v18이 "prod 코드 변경 수반 → 무위험 사이클 부적합"으로 L-9에 비-actionable 추적만 했던 코드 클린업 후보 3건(architecture-engine.ts:179 O(E) `edges.find`, update-pipeline `withWriteTransaction` 추출, progress `log.error` 오분류 + 빈 catch 2건)을 *실제 코드를 읽고* "작고·잘-테스트되고·저위험인 한 건"이 actionable한지 정직하게 재판정** — v14/Phase17(content-light 사이클) 이후 처음으로 "할 일 없음" 가능성과 "작은 안전한 한 건" 가능성을 둘 다 진지하게 저울질했다.
- **현재 상태(직접 검증)**: `npx vitest run` **593/593**(43 파일, **6.87s** — 빠름·추세 무문제), `npx tsc --noEmit` 그린, **`npm audit`(dev 포함) = 0 vulnerabilities**(postcss dev override가 Phase 21-1로 안착 — `npm ls postcss` = `8.5.15 overridden` 확인), **`npm audit --omit=dev`(prod) = 0 vulnerabilities**(Phase 14-1 baseline 유지). diagnostic-v18 전 항목 처리 완료(M-1 v18 [DONE — P21-1], L-9 docs [DONE — P21-2]), LOW 7건(L-2~L-8) 추적/이연 승계 + L-9 코드 클린업 잔여.

> **요약**: **v18은 5연속 테스트-격차 수확 소진을 인정하고 각도를 dev 공급망(postcss override)·문서(README)로 전환해 무위험 actionable 2건을 처리했다(둘 다 [DONE] — P21-1/P21-2). v19는 그 두 actionable이 소진된 지점에서 두 가능성을 정직하게 저울질했다: (a) prod 코드 진짜 steady-state인가, (b) v18이 "prod 코드 변경 수반 → 비-actionable"로 추적만 한 L-9 코드 클린업 3건 중 *작고·테스트 가능하고·저위험인 한 건*이 실제로 actionable한가.** **결론: (a)는 재확인됐다 — CRITICAL/HIGH 0, prod·dev audit 둘 다 0 vulnerabilities, `src/` TODO/FIXME 0건, god-module/순환 의존 0, Miasma 도달 0건 불변, 신규 prod-도달 CVE 0건. 그러나 (b)에서 *한 건이 진짜로 actionable*하다.** **신규 발견 M-1 v19: `architecture-engine.ts:179`의 사이클-당 `edges.find(...)` O(E) 선형 스캔(v18이 L-9 (a)로 "비-긴급·추적만" 분류)은 — 실제 코드를 읽은 결과 — (1) `edges`가 이미 `checkViolations()` 진입부(line 87)에서 한 번 fetch돼 있어 `Map<"from:to", edge>`를 한 번만 구축하면 O(1) 룩업으로 바꿀 수 있는 *국소·~5줄·시그니처 무변경* 변경이고, (2) 더 결정적으로 — 이 `edges.find`가 사는 circular-dependency 분기(line 165-185)는 *현 vitest 게이트에 전혀 커버되지 않는다*(`tests/architecture-engine.test.ts`는 custom-rule 분기만 stub edge로 검증, `getOutgoingEdges`가 빈 배열이라 `detectCycles()`가 cycle 0개 반환 → line 179 미실행). 즉 이 클린업은 "회귀 테스트 없이 prod 코드를 만지는" 무위험-위반이 아니라, *오히려 미커버 분기에 회귀 테스트를 새로 깔면서 동시에 O(E)→O(1)로 최적화하는* — Phase 18~20의 "게이트 격차 메우기" 패턴과 동형의 actionable 항목이다.** **나머지 L-9 클린업(update-pipeline `withWriteTransaction` ~40줄 추출, progress `log.error` 오분류 7곳 일괄 재분류, 빈 catch 2건[embedding-manager.ts:184·api-server.ts:625]에 `log.debug`)은 — (b)의 잣대로 재판정한 결과 — 여전히 비-actionable로 추적만 한다: `withWriteTransaction`은 트랜잭션 보일러플레이트 5곳 재작성이라 회귀 표면이 넓고, `log.error` 재분류는 동작 변경(레벨 게이팅 영향)을 수반하며 잘-스코프된 회귀 테스트를 깔기 애매하고, 빈 catch는 silent-drop이 의도적 방어라 `log.debug` 추가가 본질을 안 바꾼다.** **외부는 신선 재조사: postcss는 Phase 21-1로 dev 트리 clean(audit 0/0), MCP SDK v2 여전히 npm 미배포(latest 1.29.0, stable Q3 2026 ~7-28 불변), node-tree-sitter#268 여전히 open·미해결(CVE-2026 없음, C++20 빌드 fragility 불변), Miasma 캠페인 계속 진행 중이나 Cynapx 트리·in-tree 설정 도달 0건 불변(`.claude/launch.json` 양성, `.cursor`/`.gemini` 부재 직접 재확인).** **CRITICAL 0, HIGH 0, MEDIUM 1(M-1 v19, 신규 — architecture-engine O(E)→O(1) + 미커버 circular-dependency 분기 회귀 게이트, 작고·테스트 동반·저위험 actionable), LOW 7(L-2~L-8 v18 승계 추적/이연 + L-9 잔여 클린업은 비-actionable 추적으로 강등 유지).**

---

## 1. CRITICAL — 즉시 수정 필요

**없음.** diagnostic-v10의 CRITICAL 3건(C-1 Docker 배포 전손, C-2 사이드카 spawn 크래시, C-3 IPC 인증 무력화)은 Phase 13에서, v11의 HIGH 1건(N-1 공급망)은 Phase 14-1에서, v12 MEDIUM 4건은 Phase 15에서, v13 MEDIUM 1건(fast-uri floor)은 Phase 16에서, v15 MEDIUM 1건(도구 디스패처 게이트)은 Phase 18-1에서, v16 MEDIUM 1건(REST 핸들러 게이트)은 Phase 19-1에서, v17 MEDIUM 1건(FileWatcher 대용량-배치/복구 게이트)은 Phase 20-1에서, v18 MEDIUM 1건(postcss dev override)은 Phase 21-1에서 해소됐고, 본 전수 재열람에서 새로운 CRITICAL/HIGH는 발견되지 않았다. IPC 핸드셰이크는 random challenge + `HMAC-SHA256(nonce, challenge)` + `timingSafeEqual`로 견고하고, API Bearer는 SHA-256 후 `timingSafeEqual`, 세션 맵은 TTL+cap+sweep(unref)로 보호된다(직접 재열람 확인).

---

## 2. HIGH — 안정성/보안/정합성 결함

**없음.** 코드·공급망 어디에서도 신규 HIGH는 발견되지 않았다. **prod `npm audit --omit=dev` = 0 + dev `npm audit` = 0 vulnerabilities**(직접 재검증, 6.1 참조 — Phase 21-1 postcss override가 dev 트리도 clean화). M-1 v19(architecture-engine 클린업)는 보안·안정성 결함이 아니라 *성능 미세 비효율 + 게이트 격차*이므로 MEDIUM이다(O(E) 스캔은 사이클 수가 작아 실무 무해 — 보안/크래시 아님). 외부 공급망 사건(Miasma, 6.3)도 Cynapx 의존 트리·in-tree 설정에 도달하지 않으므로 LOW(포스처 추적, L-2)로 다룬다.

---

## 3. MEDIUM — 아키텍처/정합성 개선 (M)

| # | 위치 | 내용 |
|---|------|------|
| **M-1 v19** *(신규, actionable — 작고·테스트 동반·저위험. v18 L-9 (a)에서 승격)* | `src/graph/architecture-engine.ts:179` (circular-dependency 분기 165-185), `tests/architecture-engine.test.ts` (circular-dependency 분기 미커버) | **`checkViolations()`의 사이클-당 `edges.find(...)` O(E) 선형 스캔을 O(1) Map 룩업으로 + 미커버 circular-dependency 분기 회귀 게이트 추가.** v18은 이 항목을 L-9 (a)("사이클-당 `edges.find` O(E) 스캔, 사이클 수 작아 실무 무해")로 *비-actionable 추적만* 했다. v19는 (b) 가능성을 정직하게 재판정하려고 **실제 코드를 읽었고**, 두 사실이 actionability를 바꾼다: **(1) 국소·~5줄·시그니처 무변경** — `edges`는 이미 `checkViolations()` 진입부(line 87, `const edges = this.graphEngine.getAllEdges()`)에서 한 번 fetch돼 있다. circular-dependency 루프 직전에 `const edgeByPair = new Map<string, CodeEdge>()`를 한 번 구축(`for (const e of edges) edgeByPair.set(\`${e.from_id}:${e.to_id}\`, e)`)하면 line 179의 `edges.find(...)`를 `edgeByPair.get(\`${cycle[0]}:${cycle[1]}\`)`로 바꿀 수 있다 — 동작 동일(첫 매칭 edge 반환), O(cycles × E) → O(E + cycles). prod 시그니처·public API·반환 형태 전부 무변경. **(2) 이 분기는 현 vitest 게이트에 전혀 커버되지 않는다(결정적)** — `tests/architecture-engine.test.ts`의 stub GraphEngine은 `getOutgoingEdges: () => []`라서 `detectCycles()`가 항상 cycle 0개를 반환하고, 따라서 circular-dependency 루프(165-185)와 line 179는 *한 번도 실행되지 않는다*(custom-rule 분기만 stub edge로 검증). 즉 이 변경은 "회귀 테스트 없이 prod 코드를 만지는" 무위험-위반이 아니라 — **미커버 분기에 회귀 테스트를 새로 깔면서(stub `getOutgoingEdges`로 사이클 A→B→A 구성 → circular-dependency 위반 + `.edge`가 올바른 edge로 채워지는지 단언) 동시에 O(E)→O(1)로 최적화하는, Phase 18~20의 "게이트 격차 메우기"와 동형의 actionable 항목**이다. **verdict: actionable — Phase 22-1.** 최적화 + 회귀 테스트를 한 커밋으로. 리스크 매우 낮음(국소 변경 + 새 테스트가 동작 동일성을 못 박음). (5장·6.1 상세) |

> **참고**: v18은 5연속 테스트-격차 수확이 L-7/L-8에서 소진됐다고 보고 각도를 dev 공급망·문서로 전환해 actionable 2건(P21-1/P21-2)을 처리했다. v19는 그 두 actionable마저 소진된 뒤 — "할 일 없음"으로 직행하지 않고 — v18이 비-actionable로 분류한 L-9 코드 클린업 3건을 *실제 코드를 읽고* (b) 잣대로 재판정했다. 그 결과 architecture-engine.ts:179 한 건만이 "작고·테스트 동반·저위험" 조건을 동시에 만족함을 발견했다(미커버 분기라는 점이 결정적 — 최적화가 곧 게이트 격차 메우기가 됨). 나머지(withWriteTransaction·log.error·빈 catch)는 그 잣대를 못 넘어 비-actionable 추적을 유지한다(4장 L-9). 이는 "반사적으로 전부 이연"도, "억지로 prod 코드 변경"도 아닌 정직한 중간 판정이다.

---

## 4. 최적화 (LOW) — 추적/이연 (v18 승계 7건 + L-9 잔여 클린업 비-actionable)

| # | 위치 | 내용 |
|---|------|------|
| L-2(v19) | `package.json` (native deps), CI / Dockerfile, `.claude/`·`.cursor/`·`.gemini/` 설정 | **Miasma / Phantom Gyp 공급망 캠페인 포스처 추적 — 캠페인 계속 진행 중, Cynapx 도달 0건 불변.** 진단 일자 직접 재조사: Miasma는 Mini Shai-Hulud 공개 코드(5/12) 기반 자가전파 워름으로 6/1 @redhat-cloud-services 32패키지 → 6/3-4 binding.gyp 악용 wave(157바이트 binding.gyp로 install-time 코드 실행, @vapi-ai/server-sdk 등 57패키지/286+ 버전) → 6/5 Microsoft 73 저장소(Azure/Azure-Samples/Microsoft/MicrosoftDocs, GitHub 직접 침투 + `.claude/setup.mjs`·`.cursor/rules`·`.gemini` AI-에이전트 설정 주입 변종)로 48~72h마다 전달 메커니즘을 피벗하며 지속 중. **본 사이클 직접 재대조: (a) 컴프로마이즈 패키지 패밀리 전부 Cynapx 트리 "not in tree"(`npm ls` 확인), native 의존(better-sqlite3 12.10.1 + tree-sitter 0.25.0 코어 + 12 grammar) 무관·악성 버전 미발행, (b) Cynapx in-tree 에이전트 설정은 `.claude/launch.json` 1개뿐 — 직접 열람 결과 프로젝트 자체 `src/bootstrap.ts`를 띄우는 양성 launch 설정(SessionStart 훅·`setup.mjs`·원격 페이로드 없음), `.cursor/`·`.gemini/` 부재(직접 재확인).** CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지 1차 방어선 유지. **즉각 조치 불필요 — 추적만.** v18 대비 "캠페인 지속·신규 wave 없음, Cynapx 도달 0건 불변". 출처: [Wiz: Miasma RedHat](https://www.wiz.io/blog/miasma-supply-chain-attack-targeting-redhat-npm-packages), [StepSecurity: Phantom Gyp binding.gyp worm](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm), [Chainguard: Miasma Phantom Gyp 57 packages](https://www.chainguard.dev/unchained/chainguard-artifacts-safe-from-miasma-phantom-gyp-npm-attack) |
| L-3(v19) | `src/server/api-server.ts` (session-id StreamableHTTP) | MCP stateless transport 충돌 표면 — SDK v2 업그레이드 시 회귀 표면. **SDK v2 여전히 npm 미배포**(npm `latest`=**1.29.0** — `npm view dist-tags` 직접 확인, 2.x 0건) → **계속 이연**. v2는 stateless protocol core + Extensions/Tasks/MCP Apps를 별도 패키지(`@modelcontextprotocol/server`·`/client`)로 분해 중이며 main 브랜치 alpha pre-release로 존재, **stable은 Q3 2026(~7-28 예고, alpha ~3월·beta ~5월)**, v1.x는 v2 출시 후 6개월+ 유지(공식 README — production은 v1.x 권장). P15-3 `handleMcp()` 설계 메모가 출발점. **v18 대비 상태 불변 — 계속 이연** |
| L-4(v19) | `src/server/ipc-coordinator.ts` (전체) | IPC JSON 평문 직렬화 — MessagePack 미전환(v8→v19 이월). **성능 문제 미관측 — verdict: 계속 보류.** 메시지가 작고 round-trip이 드물어 직렬화가 병목 아님. 기록만 유지 |
| L-5(v19) | `src/graph/graph-engine.ts` | 클러스터링 본격 서브그래프 파티셔닝 — 100k+ 노드 실측 시 재검토(**verdict: 계속 이연**). 본 사이클 핫패스 전수: `performClustering()`는 LPA로 O(V+E)/반복·`MAX_ITER=20` 캡, count-first 가드(`countNodes()` COUNT(*) probe → `DEFAULT_CLUSTER_MAX_NODES=200000` 단락, graph-engine.ts:235-246)·Fisher-Yates seeded PRNG(`mulberry32`, 39-64) 직접 재확인 — OOM/편향 방어 정상. 본격 파티셔닝은 200k 임계 초과 모노레포 실측 시 |
| L-6(v19) | CI / Dockerfile | Node 24 + tree-sitter 0.25.x 빌드 fragility(C++20/prebuild 부재) — [node-tree-sitter#268]이 **진단 일자 여전히 open·미해결**(직접 웹 재확인 — 0.25.0 binding.gyp이 C++20 미지정 → Node 24 v8 헤더가 C++20 요구해 빌드 실패, prebuild 부재, 관련 이슈 무해결 종료). CVE는 아님(빌드 fragility). CI `build-and-test`가 Node 22/24 매트릭스에서 그린이나 Node 24 LTS 전환 전 prebuild 재확인 필요. **추적만.** v18 대비 상태 불변 |
| L-7(v19) | `src/cli/admin.ts` (cmd* 9개), `tests/admin-cli.test.ts` | **admin CLI 명령 동작의 vitest 게이트 공백 — 의도적 비-actionable로 추적만.** 등록 명령 9개의 `cmd*` 함수는 모듈-private(미-export)이라 vitest 직접 호출 불가, 현 테스트는 *기반 프리미티브*(LockManager·VACUUM INTO·AuditLogger)만 검증. `cmd*` 테스트는 광범위 모킹 또는 export 리팩터 수반 → **프로덕션 시그니처 변경**(무위험 원칙 위반). **verdict: 추적만 — admin.ts 리팩터(핸들러 export) 시 함께 게이트화 후보.** v18 대비 불변 |
| L-8(v19) | `src/indexer/worker-pool.ts`, `src/indexer/embedding-manager.ts`, `src/db/database.ts` | **에러-복구·마이그레이션 잔여 분기의 vitest 게이트 공백 — 의도적 비-actionable로 추적만.** worker `worker.on('error')`·queue backpressure 거부·embedding A-7 stale supersedence 레이스·DB migration 0→1/2→3는 직접 미검증이나 (a) 인접 분기(replaceWorker/double-settle/1→2 명시 커버)가 가장 위험한 로직 보호, (b) 마이그레이션은 구버전 롤백 픽스처(추가 인프라) 필요 + idempotent라 회귀 위험 낮음, (c) A-7은 타이밍-flaky 위험. **verdict: 추적만 — SCHEMA_VERSION 증분 또는 worker-pool 리팩터 시 함께 게이트화.** v18 대비 불변 |
| **L-9(v19)** *(v18 승계 — README docs는 [DONE — P21-2], 코드 클린업은 architecture-engine 1건이 M-1 v19로 승격, 잔여는 비-actionable 추적)* | `src/indexer/update-pipeline.ts` (트랜잭션 보일러플레이트·progress `log.error`), `src/indexer/embedding-manager.ts:184` / `src/server/api-server.ts:625` (빈 catch) | **L-9 코드 클린업 잔여 — (b) 잣대로 재판정 후에도 비-actionable 추적 유지.** v18은 L-9에 코드 클린업 3갈래를 묶었다. v19는 그중 **(a) architecture-engine.ts:179를 M-1 v19로 승격**(작고·테스트 동반·저위험 — 미커버 분기라 최적화가 곧 게이트 격차 메우기)했다. **잔여는 (b) 잣대를 못 넘어 비-actionable 추적을 유지**한다: **(b1) update-pipeline `withWriteTransaction()` 추출(~40줄 dedup)** — BEGIN/COMMIT/ROLLBACK+write-lock 댄스가 5곳에 반복되나, 추출은 그 5곳을 *전부 재작성*하는 넓은 회귀 표면(트랜잭션 경계는 데이터 무결성의 핵심)이라 "작은 변경" 조건 위반 → 추적만. **(b2) progress `log.error` 오분류(line 168/204/245/269/380/496/511)** — progress 메시지가 `log.error`로 나가 레벨 게이팅 시 progress까지 억제/에러 모니터링 오염 가능하나, `info`/`debug`로 재분류하는 것은 *관측 가능 동작 변경*(로그 레벨)이고 잘-스코프된 회귀 테스트를 깔기 애매(로그 출력 단언은 brittle) → 추적만. **(b3) 빈 catch 2건(embedding-manager.ts:184 사이드카 malformed 라인 silent drop, api-server.ts:625 `.port` 파일 쓰기 실패 silent)** — `log.debug` 추가가 가능하나 silent-drop이 *의도적 방어*(malformed 라인은 무시가 옳고, port 파일 실패는 비치명)라 본질을 안 바꾸고 회귀 테스트 가치 낮음 → 추적만. **세 건 모두 update-pipeline/사이드카 리팩터 페이즈로 묶어 처리 후보로 추적.** |

> **신규 LOW 부재 안내(prod 코드 변경 항목)**: 본 전수에서 prod 코드 동작 변경을 요하는 신규 LOW는 **0건**이다(M-1 v19는 MEDIUM으로 승격, L-9 잔여 3건은 비-actionable 추적 유지). better-sqlite3 12.10.1·tree-sitter 코어 0.25.0·tree-sitter-c-sharp 0.23.5 신버전 없음 → 0.23.1 정확 핀 롤백 유지가 여전히 옳다. 따라서 v19의 LOW는 L-2~L-9의 7건(L-2~L-8 + L-9 잔여)이며 **L-2~L-8은 v18 승계 추적/이연, L-9는 README docs [DONE]·architecture-engine은 M-1 v19로 승격·잔여 클린업만 비-actionable 추적**이다.

---

## 5. 코드 품질 / 성능 전수 (steady-state 재확인 + (b) 클린업 재판정)

v18은 "테스트-격차 각도 소진 → dev 공급망·문서 각도 전환"으로 actionable 2건을 처리했다. v19는 그마저 소진된 지점에서 **두 가능성을 정직하게 저울질**했다.

**(1) prod steady-state 재확인 — 신규 prod 코드 결함 0**

| 항목 | 판정 |
|------|------|
| god-module / 순환 import | 0 — `openapi.ts`(881, 정적 스키마 리터럴, 분해 비권장)·`update-pipeline.ts`(591, 단일 책임 응집)·`graph-engine.ts`(675, 응집) 불변. repos→engines→server/pipeline 단방향 |
| TODO/FIXME/XXX/HACK | **0건**(`src/` 전수 grep — 기술부채 코멘트 미축적) |
| 핫패스 O(n²)-over-nodes | 0 — 클러스터링 count-first 가드(200k)+Fisher-Yates seeded PRNG, BFS index-pointer 큐, 반복 DFS+60s 캐시 직접 재확인 |
| prod·dev audit | **0 / 0 vulnerabilities**(Phase 21-1 postcss override가 dev 트리도 clean화) |
| 테스트 시간 | `npx vitest run` **6.87s/593케이스/43파일**(직접 측정) — 추세 무문제 |

**(2) (b) 가능성 정직한 재판정 — L-9 코드 클린업 3건을 실제 코드를 읽고 저울질**

v18은 L-9 코드 클린업 3건을 "prod 코드 변경 수반 → 무위험 사이클 부적합 → 비-actionable 추적만"으로 일괄 처리했다. v19는 task의 (b) 지시("작고·잘-테스트되고·저위험인 한 건이 실제로 actionable한가 — 실제 코드를 읽고 판단")를 따라 **각 후보의 실제 코드를 읽고** 재판정했다:

- **architecture-engine.ts:179 `edges.find` O(E) → O(1) Map** → **actionable(M-1 v19로 승격) [DONE — Phase 22-1]**. 두 사실이 결정적: (i) `edges`가 이미 line 87에서 fetch돼 있어 Map 한 번 구축이 ~5줄·시그니처 무변경, (ii) 이 `edges.find`가 사는 circular-dependency 분기(165-185)가 *현 vitest에 미커버*(stub `getOutgoingEdges: () => []`라 `detectCycles()`가 cycle 0개) → 최적화가 곧 게이트 격차 메우기. → Phase 18~20 패턴과 동형. **해소(P22-1): circular-dependency 루프 직전에 `const edgeByPair = new Map<string, CodeEdge>()`를 한 번 구축(`if (!edgeByPair.has(k)) edgeByPair.set(k, e)`로 *첫* 매칭 보존 — `edges.find`의 first-match 의미를 정확히 유지)하고 사이클-당 `edges.find(...)`를 `edgeByPair.get(`${cycle[0]}:${cycle[1]}`)!`로 교체(O(cycles×E) → O(E+cycles), prod 동작·시그니처 무변경). 동시에 그동안 0% 커버였던 circular-dependency 분기에 회귀 테스트를 신규(`tests/architecture-engine.test.ts`): A→B→A 사이클을 stub으로 구성해 `policyId==='circular-dependency'` 위반이 emit되고 `.edge`가 Map 룩업으로 올바른 edge(edgeAB)로 채워짐을 단언 — Map 룩업이 `edges.find`와 동일 결과를 줌을 못 박음. `npx vitest run` 594 그린, `npx tsc --noEmit` 그린, audit 0/0 불변.**
- **update-pipeline `withWriteTransaction()` 추출(~40줄)** → **비-actionable 유지**. 트랜잭션 경계 5곳 *전부 재작성*이라 회귀 표면이 넓음(데이터 무결성 핵심) → "작은 변경" 조건 위반.
- **progress `log.error` 오분류 + 빈 catch 2건** → **비-actionable 유지**. 로그 레벨 재분류는 *관측 동작 변경*이고 brittle한 로그 단언 외 회귀 테스트 깔기 애매. 빈 catch silent-drop은 의도적 방어라 `log.debug` 추가가 본질 무변경.

**판정의 정직성**: "반사적 전부 이연"(v14/Phase17식 content-light)도 아니고 "억지로 prod 코드 변경"도 아니다. *한 건만* "작고·테스트 동반·저위험" 3조건을 동시에 만족한다(미커버 분기라는 점이 결정적). 나머지는 못 넘어 추적 유지.

**(3) 에러 핸들링 일관성 — 양호, 미세 항목은 L-9 잔여로 추적**

`Logger`(stderr-only, MCP stdio 안전)는 `normalizeData()`로 Error 객체 언랩. update-pipeline catch는 일관되게 log-and-rethrow + 트랜잭션 롤백 선행(원본 에러 보존). 미세 항목(progress log.error·빈 catch 2건)은 L-9 (b2)/(b3) 비-actionable 추적.

**(4) 그 외 — 공백 없음**

도구 디스패처 20/20(P18-1)·REST 핸들러(P19-1)·FileWatcher 대용량-배치/복구(P20-1)·lock 경합·IPC e2e+인증·git 이력 재작성·임베딩 프로토콜(A-7+M-2)·CrossProjectResolver·클러스터링 결정성+count-first·MCP progress·YAML 견고성이 이미 게이트 커버. **architecture-engine circular-dependency 분기만 신규 게이트 격차(M-1 v19로 메움).**

---

## 6. 외부 컨텍스트 (웹 조사 — 진단 일자 재실행, 출처 명시)

### 6.1 의존성 취약점 (진단 일자 직접 재검증 — prod·dev 둘 다 clean)

`npm audit`/`npm audit --omit=dev`/`npm ls`/`npm view`로 직접 재확인했다:

- **`npm audit`(dev 포함) = 0 vulnerabilities** + **`npm audit --omit=dev`(prod) = 0 vulnerabilities**(둘 다 직접 실행). v18의 신규 moderate(postcss `< 8.5.10` XSS, GHSA-qx2v-qp2m-jg93 / CVE-2026-41305)는 **Phase 21-1 override로 해소** — `npm ls postcss` = `vitest@4.1.2 → vite@8.0.8 → postcss@8.5.15 overridden`(전이 8.5.8 → 8.5.15 승격 확인). postcss는 prod 트리 부재 + Cynapx CSS/HTML 미처리라 런타임 도달은 본래 0이었고, 이제 dev 트리 audit 게이트도 clean. 출처: [GHSA-qx2v-qp2m-jg93 (CVE-2026-41305)](https://github.com/advisories/GHSA-qx2v-qp2m-jg93)
- **`overrides`**: `tree-sitter ^0.25.0` / `fast-uri ^3.1.2`(CVE-2026-6321/6322 해소, P16-1) / `qs ^6.15.2` / `hono ^4.12.21` / `postcss ^8.5.10`(P21-1) 전부 유효(`package.json` 직접 확인).
- **`@modelcontextprotocol/sdk`**: npm `latest`=**1.29.0**(`npm view dist-tags` 확인 — 2.x 0건). Cynapx `overrides`(fast-uri/qs/hono) 계속 정답.
- **better-sqlite3 12.10.1(SQLite 3.53.1) / sqlite-vec 0.1.9 / express 4.22.x·5.2.x / qs / hono / js-yaml 4.x / swagger-ui-express 5 / commander 14 / chokidar 5 / simple-git 3.36 / ignore 7 / zod 4.x / vite·vitest(dev) / supertest(dev)**: 미해결 공개 취약점 미발견.

### 6.2 런타임/의존성 수명주기

- **Node.js**: `engines: ">=22"` + Docker `node:22-bookworm-slim`. Node 22 LTS 유지 2027-04 종료 — 여유. CI Node 22/24 매트릭스 그린(593/593). Node 24 + tree-sitter 0.25.x는 [node-tree-sitter#268](https://github.com/tree-sitter/node-tree-sitter/issues/268)(여전히 open·미해결 — 0.25.0 binding.gyp이 C++20 미지정, Node 24 v8 헤더가 C++20 요구, prebuild 부재)의 fragility(L-6). README는 Phase 21-2로 "Node.js ≥ 22"와 일치(직접 확인).
- **tree-sitter 코어**: npm `latest`=**0.25.0**. 12 grammar 전부 dedupe/override. **tree-sitter-c-sharp**: npm 최신 **0.23.5**(0.23.6 미배포 — ERR_REQUIRE_ASYNC_MODULE 해소 신버전 없음) → **0.23.1 정확 핀 롤백 유지가 여전히 옳다**.

### 6.3 공급망 캠페인 — Miasma / Phantom Gyp (계속 진행 중, Cynapx 도달 0건 불변)

- 진단 일자 직접 재조사: Miasma는 Mini Shai-Hulud 공개 코드(5/12) 기반 자가전파 워름으로 6/1 @redhat-cloud-services 32패키지(preinstall 훅 페이로드) → 6/3-4 Phantom Gyp wave(157바이트 binding.gyp로 install-time 코드 실행, 57패키지/286+ 버전, preinstall/postinstall 모니터링 우회) → 6/5 Microsoft 73 저장소(Azure/Azure-Samples/Microsoft/MicrosoftDocs + `.claude/setup.mjs`·`.cursor/rules`·`.gemini` AI-에이전트 설정 주입 변종)로 48~72h마다 피벗하며 지속 중. **본 사이클 직접 재대조: (a) 컴프로마이즈 패밀리 전부 Cynapx 트리 "not in tree"(`npm ls` 확인), native 의존 무관·악성 버전 미발행, (b) Cynapx in-tree 설정은 `.claude/launch.json` 1개(프로젝트 자체 bootstrap 기동 양성, SessionStart 훅·`setup.mjs`·원격 페이로드 없음), `.cursor`/`.gemini` 부재(직접 재확인).** CI `npm ci`(lockfile 고정) + P14-1 audit 게이트 + Dockerfile 멀티스테이지 1차 방어선. **즉각 코드 변경 불필요, 포스처 추적.** 매 사이클 in-tree `.claude`/`.cursor`/`.gemini`에 SessionStart 훅/외부 스크립트 끼어듦 점검 + binding.gyp 검토 항목 유지. 출처: [Wiz: Miasma RedHat](https://www.wiz.io/blog/miasma-supply-chain-attack-targeting-redhat-npm-packages), [StepSecurity: Phantom Gyp binding.gyp worm](https://www.stepsecurity.io/blog/binding-gyp-npm-supply-chain-attack-spreads-like-worm), [Chainguard: Miasma Phantom Gyp 57 packages](https://www.chainguard.dev/unchained/chainguard-artifacts-safe-from-miasma-phantom-gyp-npm-attack)

### 6.4 MCP 생태계 — SDK v2 alpha 존재하나 npm 정식 미배포 (v18 승계, 상태 불변)

- **MCP TypeScript SDK v2 = npm 정식 미배포**(직접 확인): v2는 stateless protocol core + Extensions/Tasks/MCP Apps + authorization hardening를 담고 기능을 별도 패키지(`@modelcontextprotocol/server`·`/client`)로 분해하며 main 브랜치 alpha pre-release로 존재하나, **npm `latest`=1.29.0이고 2.x 버전/dist-tag는 0건**. v2 milestone: Alpha ~3월, Beta ~5월, **stable Q3 2026(~7-28 예고, 신스펙 동반)**. v1.x는 v2 출시 후 6개월+ 유지(공식 README — production은 v1.x 권장). → P15-3 stateless transport + task extension 마이그레이션은 여전히 착수 불가. progress-token opt-in(P14-5) 현행 정상. 출처: [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases), [MCP TS SDK v2 docs](https://ts.sdk.modelcontextprotocol.io/v2/)

### 6.5 경쟁/인접 도구 동향 (v18 승계 — 전략 추적)

- **로컬-퍼스트 코드 그래프 카테고리 성숙 지속**: Serena(LSP-over-MCP)·CodeGraph·GitNexus 등이 심볼-레벨 표준의 사실상 기본값. Cynapx의 "100% 로컬·격리·멀티프로세스 보안 IPC" 포지션이 차별점이며, 6.3의 AI-에이전트 설정 주입 변종은 격리·lockfile-고정·`npm ci`·in-tree 설정 무결성 포스처의 가치를 재확인한다.
- **SCIP가 LSIF를 대체하는 심볼 인덱스 표준으로 정착** — `export_graph`(json/graphml/dot)에 SCIP 추가는 미래 상호운용 후보. MCP `export_graph`는 P18-1, REST `/api/graph/export`는 P19-1로 게이트 커버(디딤돌 마련 완료). SCIP는 protobuf 의존 + install-time 표면 확대 우려로 즉시 비권장 — 전략 후보 유지.
- **함의**: v11~v18과 동일하게 (1) 공급망 위생 유지(+ in-tree 에이전트 설정 무결성 점검 + dev 트리 audit 위생[P21-1로 clean]), (2) 생태계 스펙 추적(MCP SDK v2 — Q3 stable까지 대기), (3) 회귀 안전망·문서 위생이 신뢰성 차별화 축이다.

---

## 7. 깨끗하게 확인된 영역

발견 부풀리기를 피하기 위해 명시한다 — 아래는 정밀 재열람에서 신규 prod 코드 결함이 없었다(M-1 v19는 미커버 분기 최적화+게이트로 actionable):

- `src/watcher/file-watcher.ts` — chokidar `ignored` 프레디킷·확장자 allowlist(H-2)·flush 동시성(H-3)·타이머 위생(H-1)·대용량-배치 git-sync 라우팅·재시도/FATAL 강등(P20-1 게이트 커버) 정상.
- `src/graph/graph-engine.ts` — P14-4 Fisher-Yates + seeded PRNG 결정성 + M-4 count-first 가드 + BFS index-pointer 큐·반복 DFS 모두 O(V+E), 핫패스 quadratic 없음(직접 재확인).
- `src/graph/architecture-engine.ts` — checkViolations O(E)·detectCycles 반복 DFS+60s 캐시 정상. **단 circular-dependency 분기 사이클-당 `edges.find` O(E) 스캔(line 179)이 M-1 v19로 O(1) Map화 + 미커버 분기 게이트 추가 대상**(나머지 분기는 양호).
- `src/indexer/update-pipeline.ts` — 단일 책임 응집·catch log-and-rethrow+롤백·원본 에러 보존 정상(트랜잭션 보일러플레이트 dedup·progress log.error 오분류만 L-9 (b1)/(b2) 비-actionable 추적).
- `src/server/openapi.ts` — 정적 OpenAPI 스키마 리터럴(로직 0), 분해 불요.
- `src/server/api-server.ts` — 세션 TTL/cap/sweep(unref)·timing-safe Bearer·8 REST 핸들러 supertest 게이트(P19-1)·rate-limit 양호(`.port` 빈 catch만 L-9 (b3) 미세).
- `src/server/ipc-coordinator.ts` — challenge-response 인증·1MB 바이트 제한·per-tool 타임아웃·keepalive(unref)·pending reject-on-close 견고.
- `src/server/tool-dispatcher.ts` — Terminal 포워딩·waitUntilReady·registry lookup·EngineNotReadyError 재시도 변환 견고. 20/20 게이트(P18-1).
- `src/indexer/worker-pool.ts` / `embedding-manager.ts` / `database.ts` — double-settle 가드·A-7 discipline·1→2 마이그레이션 명시 커버 견고(잔여 분기만 L-8 추적, `embedding-manager.ts:184` 빈 catch만 L-9 (b3) 미세).
- `package.json` overrides — tree-sitter `^0.25.0`·fast-uri `^3.1.2`·qs `^6.15.2`·hono `^4.12.21`·postcss `^8.5.10`(P21-1) 충족, dev·prod audit 0/0.
- `README.md` — Phase 21-2로 Node ≥ 22·export_graph(json/graphml/dot)·REST API 8 라우트 섹션 동기화 완료(직접 재확인).
- `.claude/launch.json` — 프로젝트 자체 `src/bootstrap.ts` 기동용 양성 launch(SessionStart 훅·외부 `setup.mjs`·원격 페이로드 없음 — 6.3 Miasma 직접 대조 무해), `.cursor`/`.gemini` 부재.
- `.github/workflows/ci.yml` — Node 22/24 매트릭스 + `npm audit --omit=dev --audit-level=high` 게이트(P14-1) + `npm ci` 양호. (cynapx-autonomous.yml은 본 진단 범위 외 — 미변경.)
- TODO/FIXME/XXX/HACK 코멘트 = 0건(`src/` 전수).

---

## 8. 권장 수정 순서 (Phase 22 제안 — 상세는 phase22-plan.md)

**21개 페이즈 이후 prod 코드는 steady-state(CRITICAL/HIGH 0, prod·dev audit 0/0, TODO 0, god-module 0, 핫패스 quadratic 0)이나, v18이 비-actionable로 추적만 한 L-9 코드 클린업 3건을 (b) 잣대로 *실제 코드를 읽고* 재판정한 결과 — 그중 한 건(architecture-engine.ts:179)이 "작고·테스트 동반·저위험" 3조건을 동시에 만족함을 발견했다(미커버 circular-dependency 분기라 최적화가 곧 게이트 격차 메우기).** CRITICAL/HIGH 0, MEDIUM 1(M-1 v19 — architecture-engine O(E)→O(1) + 미커버 분기 회귀 게이트, 작고·테스트 동반·저위험), LOW 7(L-2~L-8 v18 승계 + L-9 잔여 클린업 비-actionable 추적). 신규 prod-도달 CVE 0건, Miasma도 Cynapx 도달 0건. 따라서 Phase 22는 **최적화+회귀 게이트 1 서브 페이즈(P22-1) + 추적 갱신**이 합리적이다.

1. **P22-1**: M-1 v19 해소 — `architecture-engine.ts`의 circular-dependency 루프 직전에 `Map<"from:to", edge>`를 한 번 구축해 line 179 `edges.find(...)` O(E) 스캔을 O(1) 룩업으로 + `tests/architecture-engine.test.ts`에 미커버 circular-dependency 분기 회귀 테스트(stub `getOutgoingEdges`로 A→B→A 사이클 구성 → circular-dependency 위반 emit + `.edge`가 올바른 edge로 채워짐 단언) 추가. **국소·시그니처 무변경·동작 동일 + 새 게이트가 동작 동일성을 못 박음.** `npx vitest run` 593+신규 그린, `npx tsc --noEmit` 그린, `npm audit` 0/0(불변) 확인.
2. **추적 상태 갱신**: L-2(Miasma 캠페인 지속·Cynapx 도달 0 불변), L-3(SDK v2 npm 미배포 — Q3 stable까지 이연), L-6(node-tree-sitter#268 여전히 open), L-7/L-8(게이트 공백 비-actionable), L-9 잔여 클린업(withWriteTransaction·log.error·빈 catch 비-actionable) 현 상태를 다음 사이클 출발점으로 고정.

(L-4 IPC MessagePack 계속 보류, L-5 클러스터링 본격 파티셔닝 계속 이연, MCP 전면 stateless/task 마이그레이션은 SDK v2 npm 배포까지 이연, SCIP export는 디딤돌 마련 완료된 전략 후보로 계속 기록만.)
