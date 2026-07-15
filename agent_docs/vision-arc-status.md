# Cynapx Vision Arc — Status (P1–P9)

> **목표 (Vision)**: Cynapx를 *AI 주도 개발을 위한 진정한 강력한 지식 베이스*로 만든다 —
> AI 에이전트가 자신이 관여한 대상에 대해 **언제나 정확한 컨텍스트**를 얻을 수 있도록.
>
> **핵심 제약 (Model-agnostic)**: 시맨틱/임베딩 관련 기능은 *지금과 미래의 다양한 AI 에이전트 모델*을
> 모두 지원해야 한다 — Claude, ChatGPT Codex, 멀티-에이전트 오케스트레이션 시나리오의 로컬 LLM 포함.
> 임베딩/시맨틱 계층은 **모델 비종속·플러그형(pluggable)** 이어야 한다.

이 문서는 Phase 12~33의 유지보수/모니터링 사이클과는 별개로 진행된 **비전 추진 아크(P1–P9)** 의
완료 상태를 기록한다. 모든 항목은 브랜치 `claude/latest-commit-query-9askn1`에 커밋·푸시되었다.

---

## 완료 요약

| 항목 | 설명 | 커밋 |
|------|------|------|
| **P1** | Docstring 캡처 — JSDoc/docstring/주석 블록을 노드의 `docstring`(intent)으로 저장 | `32d50a7` |
| **P2** | 의미 있는 임베딩 스니펫 — Symbol/Type/Signature/Context(tags)/Description(docstring) | `32d50a7` |
| **P3** | `get_project_overview` 도구 — 토큰 효율적 프로젝트 브리핑 | `32d50a7` |
| **P4** | `get_recent_changes` / `get_symbol_history` — "최근 무엇이 바뀌었나 / 왜 존재하나" | `d853d26` |
| **P5** | 에이전트 어노테이션 write-back — `add_annotation` / `get_annotations` (decision/gotcha/todo/rationale) | `d853d26` |
| **P6** | 아키텍처 인텐트 모델 — `cynapx.architecture.json` → `architecture_intent` 테이블 → 드리프트 감지 | `d55bc6f` |
| **P7** | 풍부한 테스트 링키지 — `it()`/`test()` 블록과 `expect()` 단언을 `test_specs`로 캡처 (TS/JS) | `a52dd86` |
| **P9-0/5** | 플러그형 임베딩 제공자 레지스트리 + 풍부한 구조화 출력 | `790a43e` |
| **P9-2** | 쿼리 타임 임베딩 패스스루 — `search_symbols`의 `query_embedding` 파라미터 | `76c742d` |
| **P9-3** | `find_similar_symbols` 도구 — 저장된 임베딩 기반 K-NN 유사 심볼 탐색 | `61cb4da`, `016cac1` |
| **P9-1** | 임베딩 스니펫에 코드 본문 포함 (디스크에서 start/end line 슬라이스, 1000자 절단) | `86d10f0` |
| **P9-4** | 신뢰도 스코어링 — RRF 점수를 결과에 노출, 거리 정규화 | `2bda8f9` |
| **P8-2** | 파일 내 호출 해소 — tree-sitter `calls` 엣지를 동일 파일 심볼의 FQN으로 해소 | `370f24c` |
| **P8-4** | 언어별 docstring 정규화 — Rust/C#/Go/GDScript 전용 정규화 훅 | `3965ca4` |
| **P8-1** | tree-sitter 언어 테스트-스펙 추출 (Python pytest+unittest / Go / Rust / Java) — *플래그십* | `92ded6a` |
| **P8-3** | 파일 간 로컬 임포트 해소 — Python 상대 임포트 / Rust `mod foo;` → 실제 파일 노드 | `1e0e256` |

**최종 상태**: `npx vitest run` **839/839** (57 파일), `npx tsc --noEmit` 그린, `npm run build` 그린,
`npm audit --omit=dev` **0 vulnerabilities**.

---

## P9 — 시맨틱 검색 개선 (모델 비종속 설계)

사용자 핵심 피드백: *"those semantics related feature should afford varying AI agent models for now and future."*
이에 따라 P9는 **모델 비종속·플러그형** 으로 재설계되었다.

### P9-0/5 — 플러그형 임베딩 제공자 + 구조화 출력 (`790a43e`)
- **`EmbeddingProvider` 인터페이스** (`generate`/`generateBatch`/`getDimensions`/`getModelName`/`dispose?`)를
  단일 추상화로 삼고, 구현체를 확장:
  - `PythonEmbeddingProvider` (기존, Jina-code-embeddings 사이드카, 896 dims) — 기본값
  - `OpenAIEmbeddingProvider` — 네이티브 `fetch`, `/v1/embeddings` (OpenAI/Azure/vLLM/LM Studio 등 호환)
  - `OllamaEmbeddingProvider` — 네이티브 `fetch`, `localhost:11434/api/embed`
  - `NullEmbeddingProvider` — no-op 폴백
- **팩토리**: `src/indexer/embedding-providers/index.ts` — `createEmbeddingProvider(config?)` /
  `createEmbeddingProviderFromEnv()`. 환경변수: `CYNAPX_EMBED_PROVIDER`/`_MODEL`/`_API_KEY`/`_ENDPOINT`/`_DIMENSIONS`.
- **`ProjectProfile.embedding?`** — 프로파일이 제공자 선택을 구동(undefined = jina-sidecar 기본).
- `mcp-server.ts`의 하드코딩 `new PythonEmbeddingProvider()` → `createEmbeddingProviderFromEnv()`로 교체.
- **`toStructuredResult()`** (`_utils.ts`) — `{ qname, type, file, signature, docstring_snippet, tags, fan_in, score }`
  풍부한 출력. 어떤 모델이든 결과를 추론할 수 있도록.

### P9-2 — 쿼리 타임 임베딩 패스스루 (`76c742d`)
- `search_symbols`에 `query_embedding` 파라미터 추가. 에이전트가 *자체 모델로 이미 계산한* 벡터를
  직접 전달 → 서버측 재임베딩 생략(모델 불일치 방지). 벡터 제공 시 `semantic:true` 없이도 시맨틱 검색 발동.

### P9-3 — `find_similar_symbols` (`61cb4da`, `016cac1`)
- 심볼의 저장된 임베딩을 가져와 K-NN으로 의미적으로 유사한 심볼 탐색. 중복 탐지·패턴 발견·리팩터링에 유용.
- `VectorRepository.getEmbedding(nodeId)` 추가. 쿼리 노드 자기 자신 제외, `score = 1/(1+distance)` 정규화.

### P9-1 — 코드 본문 임베딩 (`86d10f0`)
- `createSnippet()`이 디스크에서 `start_line`~`end_line` 본문을 읽어 1000자 절단 후 스니펫에 포함.
  file/module/package 노드는 제외. 동명이지만 구현이 다른 함수의 임베딩 구분도를 크게 향상.

### P9-4 — 신뢰도 스코어링 (`2bda8f9`)
- `mergeResultsRRF`가 `{node, score}` 페어 반환. 시맨틱 경로는 RRF 점수, 키워드 전용 경로는 위치 기반
  `1/(1+rank)`. 에이전트가 결과 관련도를 판단·필터링 가능.

---

## P8 — 교차 언어 보강 (모델 비종속 그래프 데이터)

그래프 엣지/구조 데이터는 본질적으로 모델 비종속이며 모든 에이전트에 가치를 준다.

### P8-2 — 파일 내 호출 해소 (`370f24c`)
- tree-sitter 2차 패스에서 `calls` 엣지의 `to_qname`을 동일 파일 정의 심볼의 FQN으로 해소
  (`dynamic:false`). 점(.) 포함 메서드 호출/외부 호출은 bare name 유지(`dynamic:true`).

### P8-4 — 언어별 docstring 정규화 (`3965ca4`)
- `LanguageDescriptor.normalizeDocstring?` 훅 추가. Rust(`///`/`//!`), C#(XML 태그), Go(`//`),
  GDScript(`##`) 전용 정규화. 나머지 언어는 제네릭 정규식 폴백.

### P8-1 — tree-sitter 테스트-스펙 추출 *플래그십* (`92ded6a`)
- `LanguageDescriptor.extractTestSpecs?` 훅 추가 (P7의 TS 전용 기능을 폴리글랏으로 확장).
- **Python** (pytest `def test_*` + unittest `Test*`/`*TestCase` 메서드), **Go** (`func Test*`, `t.Run` 서브테스트),
  **Rust** (`#[test]`), **Java** (`@Test`). 공유 헬퍼 `test-spec-helpers.ts`.
- 영속화는 이미 언어 비종속(`update-pipeline.ts`가 `delta.testSpecs` 소비) — 파이프라인 변경 불필요.

### P8-3 — 파일 간 로컬 임포트 해소 (`1e0e256`)
- `resolveImport` 시그니처에 옵셔널 `absFilePath?` 추가(하위 호환).
- **Python 상대 임포트**: `from .utils import x` → `<dir>/utils.py`, `from ..common import y` → 상위 디렉터리,
  `from . import z` → 형제 모듈. `.py` + `__init__.py` 후보 모두 방출(미인덱스 엣지는 무해하게 드롭).
- **Rust `mod foo;`**: 외부 모듈 선언 → 형제 `foo.rs` / `foo/mod.rs`. 인라인 `mod bar { }`는 정의 노드 유지.

---

## 아키텍처 노트

- **임베딩 제공자 2개 인스턴스**: (1) `mcp-server.ts` 쿼리 타임, (2) `EmbeddingManager` 인덱스 타임.
  둘 다 동일 `EmbeddingProvider` 추상화 사용.
- **엣지 해소 안전성**: `update-pipeline.ts`는 `to_qname`이 실제 노드로 해소되지 않는 엣지를 조용히 드롭하므로,
  P8-2/P8-3의 best-effort 해소는 댕글링 엣지를 만들지 않는다.
- **디스크립터 훅 패턴**: 언어별 고유 로직은 `LanguageDescriptor`의 옵셔널 함수 훅
  (`resolveImport` / `normalizeDocstring` / `extractTestSpecs`)으로 표현 — 나머지는 전부 데이터.

---

## P8 후속 정밀화·확장 (2026-07-13 완료분)

v3.1.0 이후 "향후 후보 (미착수)" 목록 중 두 항목이 처리됐다 (브랜치 `claude/cynapx-status-goals-15uoop`,
vitest 839→860):

- **P8-2 셀렉터 vs 식별자 정밀화 — [DONE]**: 조사 결과 실제 오해소 경로는 두 가지였다.
  1. **대소문자 버그(잠재)**: `localSymbolMap` 키는 canonical(소문자) qname에서 파생되는데 조회는
     원본 대소문자 `targetName`으로 수행 — *대문자가 포함된 심볼(Go/C#/Java/Rust 대부분)의 파일 내
     호출 해소가 조용히 실패*하고 있었다. 조회를 소문자 정규화(`lookupKey`)로 수정.
  2. **수신자-경유 호출 오해소**: Java `obj.configure()`는 bare `identifier`만 캡처되고, Kotlin 내비게이션
     호출은 수신자 `simple_identifier`가 캡처됨 — 동일 파일의 동명 자유함수로 잘못 정적 해소될 수 있었다.
     `isReceiverQualifiedCall()` 가드 추가: 수신자 컨텍스트(`selector_expression`/`navigation_expression`/
     `attribute`/`field_expression`/`member_expression`/`member_access_expression`, Java는
     `method_invocation`의 `object` 필드 존재)로 캡처된 이름은 bare name 유지 + `dynamic:true`.
  (참고: Go/C# 쿼리는 셀렉터 표현식 *전체 텍스트*를 캡처하므로 점(.) 포함 규칙으로 이미 안전했다.)
- **Kotlin KDoc 캡처 — [DONE]**: tree-sitter-kotlin은 KDoc을 `multiline_comment` 노드로 방출하는데
  `extractTreeSitterDocstring`의 sibling 타입 목록에 없어 *KDoc이 통째로 유실*되고 있었다. 타입 추가 +
  Kotlin `normalizeDocstring` 훅(KDoc 마커 스트립) 신설.
- **나머지 언어 docstring/테스트-스펙 확장 — [DONE (Kotlin/PHP/C++)]**:
  - **Kotlin**: `@Test` 어노테이션 함수(JUnit/kotlin.test, 정규화된 `@org.junit.jupiter.api.Test` 포함) +
    `assert*` 단언.
  - **PHP**: 테스트 클래스(`*Test`/`extends TestCase`) 내 PHPUnit `test*` 메서드·`#[Test]` 속성 메서드 +
    `$this->assert*`/`self::assert*`/`expect*` 단언. PHPDoc `normalizeDocstring` 훅 동반.
  - **C++**: GoogleTest `TEST`/`TEST_F`/`TEST_P`/`TYPED_TEST` 블록(`Suite.Name` 스펙) + `EXPECT_*`/`ASSERT_*` 단언.
  - **C**: 표준 테스트 프레임워크 부재(Unity/CUnit 등 비표준)로 의도적 제외 — 훅 없는 언어의 무-스펙
    동작은 기존 게이트로 커버됨.

---

## P8 후속 2차 사이클 (2026-07-15 완료분)

미착수 목록의 나머지 세 항목을 처리했다 (브랜치 `claude/cynapx-status-goals-15uoop`, vitest 860→875):

- **C# 테스트-스펙 추출 — [DONE]**: xUnit `[Fact]`/`[Theory]`, NUnit `[Test]`/`[TestCase]`/`[TestCaseSource]`,
  MSTest `[TestMethod]`/`[DataTestMethod]` 속성 메서드(정규화된 `[Xunit.Fact]` 포함) +
  `Assert.*`/`CollectionAssert.*`/`StringAssert.*` 단언.
- **P8 Go 모듈 임포트 해소 — [DONE]**: `resolveImport`가 파일 기준 가장 가까운 go.mod를 찾아(디렉터리별 캐시)
  모듈 경로 하위 임포트를 해당 패키지 디렉터리의 실제 `.go` 파일들(비-`_test.go`)로 해소해 file-to-file
  `depends_on` 엣지를 방출. 외부 임포트·미해소 경로는 기존 `package:` 형식 유지. 미인덱스 후보 엣지는
  파이프라인이 무해하게 드롭(P8-3과 동일 계약).
- **테스트-스펙 `targetQname` 베스트-에포트 해소 — [DONE]**: `target_qname`은 `get_related_tests`/
  `get_symbol_details`의 조회 키인데 tree-sitter 언어 스펙은 전부 undefined여서 *역참조가 불가능*했다.
  공유 헬퍼 `inferProdFilePath()`(테스트 파일명 규약 + Maven식 `src/test → src/main` 매핑) 기반으로:
  - **Go**: `foo_test.go`+`TestAdd` → `foo.go#add` 심볼-레벨(서브테스트는 부모 타깃 상속)
  - **Rust**: 같은 파일의 `#[cfg(test)]` 테스트 → 자기 파일 qname(파일-레벨 폴백에 즉시 매칭)
  - **Python/Java/Kotlin/C#/C++/PHP**: 파일-레벨 타깃(`test_x.py`/`XTest.java`/`x_test.cpp` 등)
  - 전부 canonical 형태로 방출(저장 노드 qname과 정확히 일치). 미해소 타깃은 조회에 안 걸릴 뿐 무해.

---

## 향후 후보 (미착수)

- **대형 의존성 메이저 업그레이드(Express 5 / TypeScript 6)**: 회귀 위험 높고 신규 역량 없음 — 의도적 후순위
  (diagnostic-v30 L-22 참조).
- **T-1 재확인 (★1순위 임박)**: MCP SDK 2.x dist-tag / v2 stable 출현(스펙 publish 예정 2026-07-28 전후).
  2026-07-15 기준 여전히 `latest: 1.29.0`(미발화).
- **테스트-스펙 심볼-레벨 정밀화 확대**: 현재 Go만 심볼-레벨(`TestAdd`→`#add`) — Java/Kotlin/C# 테스트
  메서드명 규약(`testAdd`/`addsTwoNumbers`)은 신뢰도가 낮아 파일-레벨로 보수적 유지. 실사용 피드백 후 재검토.
