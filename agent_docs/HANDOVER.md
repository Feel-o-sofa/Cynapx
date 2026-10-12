# Cynapx 인수인계서 — 차기 에이전트 세션 실행 지침

> **작성**: 2026-10-12, Fable 5 세션 (진단 보고서 후속)
> **수신**: 이 리포지토리에서 작업할 차기 AI 에이전트 (Opus 5.5 상정)
> **성격**: 이 문서 하나로 외부 도움 없이 작업을 완수할 수 있도록 쓴 실행 지침서다.
> 모호한 부분이 있으면 §7의 위임 경계에 따라 스스로 판단하되, 판단 근거를 커밋 메시지나 WORKLOG에 남겨라.

---

## 0. 시작 절차 (세션 첫 10분)

```bash
# 1) 작업 브랜치 확보 — 이 문서 자체가 이 브랜치에 있다
git fetch origin claude/cynapx-status-goals-15uoop
git checkout claude/cynapx-status-goals-15uoop

# 2) 의존성 설치 + 베이스라인 확인 (아래 수치와 다르면 멈추고 원인 파악 먼저)
npm ci
npx vitest run        # 기대값: 882/882 (58파일) 통과
npx tsc --noEmit      # 기대값: 무출력(그린)
npm audit --omit=dev  # 기대값(WP-1 전): 12 vulnerabilities — 이걸 고치는 게 첫 작업이다
```

- 기준 커밋: `beaa8c8` (2026-07-16). master는 `c524ade`(v3.1.0, 2026-06-22)에서 동결.
- 이 브랜치는 master 대비 **12커밋 앞 / 0커밋 뒤** — 리베이스 불필요, 충돌 없음(2026-10-12 확인).
- 전면 진단의 상세 근거는 오너가 보관한 진단 보고서(2026-10-12)와 `agent_docs/diagnostic-v31.md`, `docs/availability-verification.md`에 있다. 이 문서는 그 결론의 실행본이다.

---

## 1. 대전제 — 오너가 확정한 개발 방향 (모든 판단의 상위 기준)

1. **정체성**: Cynapx는 "발전하는 AI 상황에서도 계속 의미 있을, **에이전트 약점 보완 도구**"다.
   에이전트가 스스로 못 하는 것 — ① 세션 간 구조화된 기억(annotations), ② 심볼 단위 시간 축(history),
   ③ 선언된 아키텍처 의도와의 기계적 대조, ④ 대규모 역방향 관계(callers/impact), ⑤ 결정론적 메트릭 —
   에 투자하고, 에이전트가 이미 잘하는 것(코드 탐색·독해·유사도 판단)과 경쟁하지 않는다.
2. **폐기 금지, 비활성화 원칙**: 이미 개발된 기능(시맨틱 검색, 임베딩 계층, find_similar_symbols,
   propose_refactor 등)은 **삭제하지 않는다**. 소형 로컬 모델에게는 여전히 유용하므로 코드와 테스트를 보존하되,
   대형 LLM 에이전트가 기본 사용자인 지금은 **기본 비활성화**하여 도구 복잡도를 낮춘다. (§4 WP-2)
3. **그 외 결정은 위임**: 위 두 가지에 상충하지 않는 범위에서 실행 에이전트가 판단한다. §6의 결정 로그를
   기본값으로 삼고, 뒤집을 때는 근거를 기록한다.

---

## 2. 현재 상태 스냅숏 (2026-10-12 실측)

| 항목 | 값 |
| --- | --- |
| 테스트 / 타입체크 | 882/882, tsc 그린 (코드는 건강) |
| prod 취약점 | **12건** (critical 3 / high 4 / moderate 5) — §3 WP-1에서 전량 해소 |
| MCP SDK | 핀 `^1.29.0` (설치 1.29.0), npm latest **1.32.1**. 1.29.0은 OAuth 취약 대역(1.12–1.30.1)에 포함 |
| MCP 스펙 | **2026-07-28 개정판 출시됨**: 기본 stateless, HTTP 표면 표준화, MRTR. TS SDK v2는 미출시(1.x가 latest) |
| express | 4.22.2 (within-pin 4.22.3 존재). Express 5 마이그레이션은 **보류** (§6 D3) |
| 주요 메이저 보류 | TypeScript 7, better-sqlite3 13, commander 15, vitest 5, js-yaml 5 — 전부 보류 (§6 D4) |
| 코드 규모 | src 16,284 LOC / tests 15,169 LOC / 도구 27종 / 언어 13종 |

취약점 상세 (prod, `npm audit --omit=dev --json` 기준):

| 패키지 | 심각도 | 해소 경로 |
| --- | --- | --- |
| simple-git 3.36.0 | critical ×2 | **메이저 업그레이드 `^4.0.2`** — 유일한 메이저 작업 |
| proxy-addr (express 전이) | critical | `npm update` 후 잔존 시 package.json `overrides`로 고정 |
| @modelcontextprotocol/sdk 1.29.0 | high | 핀을 `^1.32.1`로 상향 |
| js-yaml 4.3.0 | high | within-pin (4.3.2+) — **실도달 경로 있음**(인덱서가 프로젝트 YAML 직접 파싱) |
| ip-address, fast-uri | high | 전이 — `npm update` + audit 재확인 |
| qs, body-parser, hono, @hono/node-server | moderate | qs/body-parser는 express 전이, hono 계열은 **MCP SDK 전이**(`npm ls hono`로 확인됨) — SDK 상향으로 해소 예상 |

---

## 3. WP-1 — 안정화 (최우선, 1세션 분량)

**목적**: ① 미머지 12커밋(보안·가용성 수정 포함)을 릴리스로 전달, ② CVE 12건 → 0, ③ 유지보수를 에이전트 세션 의존에서 CI로 이관.

### WP-1a. 의존성 수리 (머지 전에 이 브랜치에서 수행)

```bash
npm update                                  # within-pin 일괄 정렬
# package.json 편집: "@modelcontextprotocol/sdk": "^1.32.1", "simple-git": "^4.0.2"
npm install
npm audit --omit=dev && npm audit           # 목표: 둘 다 0
npx vitest run && npx tsc --noEmit && npm run build
```

- **simple-git 3→4**: 사용처는 `src/indexer/git-service.ts`(가 거의 전부다). 4.x 체인지로그에서 비호환
  변경을 확인하고, 깨지면 호출부를 수정하라. git-service는 vitest 게이트가 있으니 테스트가 안전망이다.
- **MCP SDK 1.29→1.32**: 마이너지만 서버/트랜스포트 API 사용처(`src/server/mcp-server.ts`,
  `src/server/api-server.ts`의 StreamableHTTP 세션 경로)를 컴파일·테스트로 검증하라. 1.32는 여전히 1.x
  스펙 호환이다. **v2 전환은 이번 범위가 아니다** (§5 WP-3).
- audit가 0이 안 되면: 남은 항목이 전이 의존성인지 `npm ls <pkg>`로 확인하고, 리포에 이미 전례가 있는
  `package.json`의 `overrides` 블록(70행 부근)에 패치 버전을 고정하라.
- 커밋 분리: `chore(deps): ...`(within-pin+overrides) / `feat(deps)!: simple-git 4`(비호환 가능성 명시) /
  `chore(deps): mcp sdk ^1.32.1` 식으로 논리 단위를 나눠라.

### WP-1b. CI 주기 점검 이관

새 워크플로 `.github/workflows/scheduled-maintenance.yml`을 추가하라 (주 1회 cron + 수동 트리거):
`npm ci` → `npm audit --omit=dev --audit-level=high`로 실패 게이트 → `npm outdated || true` 로그 →
`npx vitest run`. 목적은 "동결 상태에서도 경보가 울리는 것"이다.

- ⚠️ **`.github/workflows/cynapx-autonomous.yml`은 절대 건드리지 마라.** 이 파일은 리포 규약상 에이전트
  작업 범위 밖이다(과거 phase-plan들에 명문화). 새 파일만 추가하라.
- 기존 `ci.yml`(Node 22/24 매트릭스)은 그대로 둔다.

### WP-1c. v3.2.0 릴리스

1. `CHANGELOG.md`의 `[Unreleased]` → `[3.2.0] - <날짜>`로 확정하고 WP-1a 의존성 작업을 추가 기재.
2. `package.json` version `3.1.0` → `3.2.0`. 기존 스타일대로 `RELEASE_NOTES_v3.2.0.md` 작성
   (v3.1.0 노트가 템플릿: 요약 → 변경 → 보안 → 업그레이드 노트. AV-1/AV-2 가용성 수정과 CVE 해소가 헤드라인).
3. `chore(release): 3.2.0` 커밋 후 **master로의 머지는 PR을 만들어 오너 승인을 받아라.**
   오너가 세션 중 "직접 머지해도 좋다"고 말한 경우에만 직접 머지 + `v3.2.0` 태그를 수행한다.

**WP-1 완료 기준**: audit 0/0, vitest 전수 그린(개수는 882에서 늘었어도 됨), build 그린, PR 생성(또는 머지),
CI 신규 워크플로가 수동 트리거로 1회 성공.

---

## 4. WP-2 — 도구 프로파일 시스템 (핵심 신규 작업)

**목적**: 오너 지시 "폐기하지 말고 비활성화"의 구현. 대형 LLM용 기본 프로파일에서 도구 노출을 줄이고,
소형 로컬 모델용으로 전체를 보존한다.

### 설계 (확정)

- 환경변수 `CYNAPX_TOOL_PROFILE` = `frontier`(**기본값**) | `full`.
  프로젝트 설정(`.cynapx-config` → ProjectProfile)에 `tool_profile` 필드로 프로젝트별 오버라이드 허용
  (기존 `ProjectProfile.embedding` 필드가 같은 패턴의 전례다).
- **frontier에서 숨기는 도구 6종** (코드·테스트는 전부 보존):
  `find_similar_symbols`, `propose_refactor`, `discover_latent_policies`, `export_graph`,
  `re_tag_project`, `get_remediation_strategy`
  → 근거: 처방·유사도·발굴 계열은 대형 에이전트의 자체 추론이 더 정확하다(진단 보고서 4장 판정).
  나머지 21종이 frontier에 노출된다.
- **임베딩 기본 off (frontier)**: `CYNAPX_EMBED_PROVIDER` 미설정 시 frontier에서는
  `NullEmbeddingProvider`를 기본으로 한다(현행 기본은 Python 사이드카 — `full`에서는 현행 유지).
  `search_symbols`의 `semantic:true`/`query_embedding`은 임베딩 비활성 시 **키워드 폴백으로 동작하고
  결과에 폴백 사실을 한 줄 명시**한다. 파라미터 자체를 없애지 마라(후방 호환 + full 공유 스키마).
- REST API(`--api`)는 이미 opt-in 플래그다 — 변경 불필요. 문서에만 "기본 비권장, MCP HTTP 사용" 명시.

### 구현 지점 (탐색 힌트 — 행 번호는 믿지 말고 grep으로 확인)

- 도구 등록/디스패치: `src/server/tool-dispatcher.ts`, `src/server/mcp-server.ts` (`grep -rn "find_similar_symbols" src/`로 등록 지점 전부 찾기 — MCP tools 목록과 REST 핸들러 양쪽에 있을 수 있다)
- 접속 시 주입되는 지침: `buildCynapxInstructions()` — **프로파일별로 도구 목록 문구가 달라져야 한다**
- 임베딩 기본값: `src/indexer/embedding-providers/index.ts`의 `createEmbeddingProviderFromEnv()`
- 문서 동기화: `AGENTS.md`의 "Tool map (27 tools)" 표, `README.md`/`README_KR.md`/`GUIDE_EN.md`/`GUIDE_KR.md`

### 테스트 (필수 게이트)

- 프로파일별 노출 도구 목록 스냅숏 테스트 (frontier=21종, full=27종; 숨김 6종이 frontier 디스패치에서
  "unknown tool"이 아니라 **명시적 비활성 안내**로 응답하는지까지 — 과거 세션 대화에서 로컬 모델이 혼란하지 않도록)
- 임베딩 off 상태에서 `semantic:true` → 키워드 폴백 + 안내 문구 게이트
- 기존 882개 테스트는 `full` 환경을 가정하는 것이 있을 수 있다 — 테스트 셋업에서 `CYNAPX_TOOL_PROFILE=full`
  고정이 필요한 파일이 나오면 그렇게 처리하고 이유를 주석으로 남겨라.

**WP-2 완료 기준**: 기본 실행에서 노출 도구 21종, `CYNAPX_TOOL_PROFILE=full`로 27종 복원, 삭제된 코드 0,
전체 게이트 그린, 4개 가이드 문서 + AGENTS.md + in-protocol instructions 일치.

---

## 5. WP-3 — 후속 (WP-1·2 완료 후, 분량 남으면)

1. **유지보수 프로토콜 교체**: `agent_docs/`의 diagnostic-vN/phaseN-plan 반복 사이클은 **은퇴한다** (§6 D5).
   새 관성을 만들지 마라 — diagnostic-v32를 쓰지 말 것. 대신 이 HANDOVER.md 아래에
   `agent_docs/WORKLOG.md`를 만들어 세션별 3~5줄 요약만 누적하라.
2. **MCP TS SDK v2 감시**: 세션 시작 시 `npm view @modelcontextprotocol/sdk dist-tags` 1회.
   2.x dist-tag가 출현하면 → 별도 마이그레이션 페이즈(stateless 전환 + 그때 도구 통합 21→~14 동시 수행, §6 D6).
3. **엣지 정밀도 골드셋** (방향성): callers/impact의 가치는 해소 정밀도에 종속된다. 소규모 폴리글랏 골드셋
   리포를 만들어 호출 엣지 정확도(정답 대비 정밀/재현)를 측정 가능하게 하는 것이 "강화" 노선의 선행 조건이다.
4. `agent_docs/vision-arc-status.md`의 "향후 후보" 절을 이 문서 기준으로 갱신.

---

## 6. 결정 로그 (위임 범위에서 Fable이 확정 — 뒤집으려면 근거 기록)

| # | 결정 | 근거 |
| --- | --- | --- |
| D1 | 기능 폐기 금지 → 프로파일 비활성화 | 오너 지시 (소형 로컬 모델용 보존) |
| D2 | 기본 프로파일 = frontier, full은 opt-in | 현재 주 사용자가 대형 LLM 에이전트 |
| D3 | Express 5 마이그레이션 보류 | REST 표면이 비중심화됨 — 투자 가치 낮음. 4.x within-pin + overrides로 CVE만 관리 |
| D4 | TypeScript 7 등 메이저 일괄 보류 | 회귀 위험 > 이득. simple-git 4만 예외(critical CVE 강제) |
| D5 | diagnostic/phase 문서 사이클 은퇴 | 단일 장애 지점(에이전트 세션 지속)이 3개월 동결로 실증됨 → CI 경보로 대체 |
| D6 | 도구 통합(21→14) 보류 | 스키마 비호환 작업이므로 SDK v2 전환(어차피 비호환 시점)과 묶는 게 싸다 |
| D7 | simple-git 4 메이저는 WP-1 포함 | critical 2건이 강제 |

---

## 7. 위임 경계 — 스스로 결정해도 되는 것 / 안 되는 것

- **자유 재량**: 버그 수정, 테스트 추가, within-pin 업데이트, 문서 정비, WP 명세 내 구현 세부, 커밋 분할.
- **근거 기록 후 재량**: §6 결정 뒤집기, WP 범위의 소폭 조정(예: frontier 목록 ±2종).
- **오너 승인 필요**: master 머지·릴리스 태그, 기능 삭제(원칙적 금지), 새 외부 서비스/의존성 대형 추가,
  아키텍처 재설계(파서 스택 통합 등), npm 퍼블리시.

## 8. 함정 목록 (이전 세션들이 치른 수업료 — 읽고 시작하라)

1. `toCanonical()`은 **전부 소문자화**한다. qname을 키로 쓰는 맵/비교는 반드시 소문자 정규화 — 과거
   대문자 심볼의 호출 해소가 조용히 전멸했던 원인(P8-2 수정, `dcd82ca`).
2. tree-sitter 쿼리의 `@call.name` 캡처는 패턴에 따라 **바깥 노드 전체**에 붙는다(Go/C#은 셀렉터 전체
   텍스트가 잡힘). 파서를 만질 땐 추측 말고 `tests/intra-file-calls.test.ts`를 먼저 읽어라.
3. REST 레이트리미터(`globalLimiter`)는 **모듈 싱글턴 + IP 키**다. 버스트를 쏘는 테스트는 반드시 전용
   파일로 격리하라 (`tests/api-server-ratelimit-healthz.test.ts`가 전례이자 이유 설명을 담고 있다).
4. `.gitignore`가 `scripts/*`를 통째로 막고 allowlist(`!scripts/...`)로 푼다. scripts에 파일을 추가하면
   allowlist 줄도 추가해야 커밋된다.
5. 서버를 실기동 테스트하려면 대상 프로젝트 루트에 앵커 파일 `.cynapx-config`(내용 `{}`면 충분)가
   필요하고, `KNOWLEDGE_TOOL_TOKEN` env를 줘야 한다. `/tmp`는 시스템 경로 차단 목록에 **없다**(사용 가능).
6. stdio MCP 모드에서 stdout은 프로토콜 전용이다. `console.log` 금지 — bootstrap이 리다이렉트하지만
   새 코드가 우회 출력을 만들면 프로토콜이 깨진다. 로깅은 `Logger`(stderr)로.
7. tree-sitter-c-sharp는 **0.23.1 고정**이다. 0.23.5는 `ERR_REQUIRE_ASYNC_MODULE`로 실패 이력
   (diagnostic-v30 T-6). 올리려면 실빌드 검증 먼저.
8. Kotlin KDoc은 `multiline_comment` 노드 타입이다. docstring sibling 타입 목록은
   `extractTreeSitterDocstring()`에 하드코딩되어 있다.
9. 커밋 메시지·코드·PR에 **모델 식별자를 넣지 마라**(세션 어트리뷰션 라인은 하네스 규약을 따른다).
10. 모든 작업 후 전수 게이트: `npx vitest run` + `npx tsc --noEmit` + `npm run build` +
    `npm audit --omit=dev`. 이 리포는 테스트가 두터워서(소스와 1:1 규모) 게이트를 믿어도 된다.
