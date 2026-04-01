# 🧠 Cynapx v1.0.6
### 고성능 AI-Native 코드 지식 엔진

**Cynapx**는 AI 에이전트와 개발자를 위한 고성능 격리형 코드 분석 엔진입니다. 코드베이스를 다차원 지식 그래프로 변환하여 LLM이 복잡한 아키텍처와 심볼 간 관계를 즉각적으로 이해할 수 있게 합니다.

---

[🌐 English README](./README.md) | [📖 User Guide (EN)](./GUIDE_EN.md) | [📖 사용자 가이드 (KR)](./GUIDE_KR.md)

---

## 🌟 왜 Cynapx인가?

| 원칙 | 설명 |
|------|------|
| **관계 중심** | 상속, 구현, 호출, 포함(containment) 엣지를 정밀하게 추출 — 이름만이 아닌 구조를 파악 |
| **Zero-Pollution** | 프로젝트 디렉토리에 아무것도 쓰지 않음. 모든 데이터는 `~/.cynapx/`에 격리 저장 |
| **신뢰도 구분 분석** | Dead code 결과를 HIGH / MEDIUM / LOW 3단계로 분류하여 오탐을 최소화 |
| **AI 최적화** | 스마트 컨텍스트 프루닝, 운영 지침 주입, 토큰 효율적 출력 포맷 내장 |
| **확장 가능** | Language Provider 확장 포인트로 새 언어 지원 추가 가능 |

---

## 🚀 빠른 시작

### 1. 사전 요구사항

```bash
# Node.js >= 20 필요
node --version

# 프로젝트 루트에서 의존성 설치
npm install
```

### 2. Claude Code에 등록

프로젝트 디렉토리에 `.mcp.json` 파일을 생성하거나 편집합니다:

```json
{
  "mcpServers": {
    "cynapx": {
      "command": "npx",
      "args": ["ts-node", "src/bootstrap.ts", "--path", "."],
      "cwd": "/Cynapx의 절대경로"
    }
  }
}
```

> **개발 워크플로우**: 워크트리에서 소스를 수정한 뒤 commit/PR/merge 없이 즉시 테스트하려면 `cynapx-dev` 엔트리를 추가하세요. 자세한 내용은 [GUIDE_KR.md §2](./GUIDE_KR.md#2-설정)를 참고하세요.

### 3. 프로젝트 초기화

연결 후 `initialize_project`를 호출하여 대상 코드베이스를 인덱싱합니다:

```
initialize_project  →  mode: "current"              # cynapx가 시작된 디렉토리를 분석
initialize_project  →  mode: "custom", path: "경로"  # 임의 경로 분석
```

인덱싱은 백그라운드에서 실행됩니다. `get_setup_context`로 상태를 확인할 수 있습니다.

---

## 🛠️ MCP 도구 목록 (20개)

### 설정 및 라이프사이클
| 도구 | 설명 |
|------|------|
| `get_setup_context` | 초기화 상태와 등록된 프로젝트 목록 확인 |
| `initialize_project` | 프로젝트를 인덱싱하고 분석 엔진 활성화 |
| `purge_index` | 로컬 인덱스 삭제 (`confirm: true` 필요) |
| `re_tag_project` | 구조적 특성 태깅 재실행 |
| `backfill_history` | Git 커밋 이력을 인덱싱된 심볼에 매핑 |

### 심볼 탐색
| 도구 | 설명 |
|------|------|
| `search_symbols` | 키워드 + 선택적 시맨틱(벡터) 심볼 검색 |
| `get_symbol_details` | 전체 메트릭, 태그, 이력, 소스 코드 스니펫 조회 |
| `get_callers` | 특정 심볼을 직접 호출하는 심볼 목록 |
| `get_callees` | 특정 심볼이 호출하는 심볼 목록 |
| `get_related_tests` | 프로덕션 심볼에 연결된 테스트 심볼 조회 |

### 아키텍처 분석
| 도구 | 설명 |
|------|------|
| `check_architecture_violations` | 레이어/도메인 위반 및 순환 의존성 탐지 |
| `get_remediation_strategy` | 탐지된 위반에 대한 3단계 수정 가이드 |
| `discover_latent_policies` | 코드베이스에 암묵적으로 존재하는 아키텍처 패턴 발굴 |

### 품질 및 위험도
| 도구 | 설명 |
|------|------|
| `find_dead_code` | 미사용 심볼을 HIGH / MEDIUM / LOW 신뢰도로 분류 |
| `get_hotspots` | 선택한 메트릭 기준 기술 부채 핫스팟 |
| `get_risk_profile` | 순환 복잡도·Git churn·커플링 기반 위험 점수 |
| `analyze_impact` | 심볼 변경 시 파급 효과 BFS 분석 |

### 리팩토링 및 내보내기
| 도구 | 설명 |
|------|------|
| `propose_refactor` | 위험도 기반 리팩토링 제안 생성 |
| `export_graph` | Mermaid 다이어그램 + JSON 구조 요약 내보내기 |
| `check_consistency` | 그래프와 디스크·Git 간 정합성 검증 |

---

## 🌐 지원 언어

TypeScript · JavaScript · Python · Go · Java · C · C++ · C# · Kotlin · PHP · Rust · GDScript

> 새 언어를 추가하려면 `LanguageProvider` 인터페이스를 구현하고 `~/.cynapx/plugins/`에 파일을 배치하세요. [`docs/extending-language-support.md`](./docs/extending-language-support.md) 참고.

---

## 📡 REST API

실행 중에는 MCP 서버와 함께 REST API도 제공됩니다:

- **Swagger UI**: `GET /api/docs` — 인증 불필요, 인터랙티브 API 탐색기
- **Rate limit**: 전체 100회/분 · 분석 엔드포인트 10회/분
- **인증**: Bearer 토큰 자동 생성 (`--no-auth`로 비활성화 가능)

---

## ⚙️ CLI 옵션

```
npx ts-node src/bootstrap.ts [옵션]

  --path <디렉토리>   분석할 프로젝트 경로 (기본값: 현재 디렉토리)
  --port <번호>       REST API 포트 (기본값: 3001)
  --bind <주소>       바인드 주소 (기본값: 127.0.0.1)
  --no-auth           Bearer 토큰 인증 비활성화
```

---

## 📖 문서

- [**사용자 가이드 (KR)**](./GUIDE_KR.md) — 전체 도구 레퍼런스, 워크플로우, 설정
- [**User Guide (EN)**](./GUIDE_EN.md) — 영어 전체 가이드
- [**언어 지원 확장**](./docs/extending-language-support.md) — 새 언어 제공자 추가 방법
- [**기여 가이드**](./CONTRIBUTING.md) — 개발 환경 설정 및 PR 프로세스

---

## 🛡️ 보안

- **경로 탈출 방지**: 모든 파일 접근은 등록된 프로젝트 경로 내로 제한
- **격리 저장**: `~/.cynapx/` — 프로젝트 디렉토리에 절대 쓰지 않음
- **입력 검증**: 모든 REST 엔드포인트에 Zod 스키마 적용

---

**Cynapx** — [Feel-o-sofa](https://github.com/Feel-o-sofa)가 개발·유지보수
