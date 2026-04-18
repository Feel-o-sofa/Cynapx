# 🧠 Cynapx v2.0.0
### 고성능 AI-Native 코드 지식 엔진

**Cynapx**는 코드베이스를 심볼과 관계로 이루어진 영속적이고 질의 가능한 지식 그래프로 변환합니다. 세션 경계, 컨텍스트 초기화, 모델 재시작이 일어나더라도 AI 에이전트가 코드 구조를 실질적으로 이해할 수 있도록 합니다.

---

[🌐 English](./README.md) | [📖 User Guide (EN)](./GUIDE_EN.md) | [📖 사용자 가이드 (KR)](./GUIDE_KR.md)

---

## 🤔 문제 정의: LLM은 대형 코드베이스를 '눈 감고' 다룬다

AI 에이전트가 대규모 코드베이스에 투입되면 근본적인 문제에 직면합니다. 파일을 한 번에 하나씩만 읽을 수 있고, 이미 읽은 내용을 기억하지 못하며, 다음과 같은 질문에 답할 수 없습니다.

- *이 함수를 호출하는 것은 무엇인가?*
- *이 클래스에 의존하는 모듈은 어디인가?*
- *이 인터페이스를 변경하면 무엇이 깨지는가?*
- *단순히 파일 길이가 아닌, 실제 복잡도 핫스팟은 어디인가?*

텍스트 검색과 임베딩 검색은 도움이 되지만, 이들은 **토큰**을 설명할 뿐 **구조**를 설명하지 않습니다. Cynapx는 Tree-sitter 파싱 결과를 바탕으로 **영속적인 SQLite 지식 그래프**를 구축하여 이 문제를 해결합니다. 실제 호출 엣지, 상속 체인, 임포트 관계, 포함 계층을 인코딩함으로써 에이전트가 텍스트를 추측하는 대신 구조를 직접 질의할 수 있게 합니다.

---

## ⚖️ 왜 기존 방법이 아닌가?

| 방법 | 제공하는 것 | 놓치는 것 |
|---|---|---|
| **grep / 텍스트 검색** | 문자열이 포함된 라인 | 관계, 호출자, 전이적 영향 |
| **임베딩 단독 사용** | 의미적으로 유사한 코드 | 구조 엣지 — 누가 무엇을 호출하는지, 순환 복잡도, 커플링 |
| **LSP** | 에디터 내 실시간 심볼 해석 | 영속 저장, 세션 간 기억, 배치 분석, AI 친화적 출력 |
| **Cynapx** | 영속적 구조 그래프 + AI-Native 도구 API | (이미 여기 있습니다) |

---

## 🌟 핵심 원칙

| 원칙 | 설명 |
|---|---|
| **관계 중심** | 심볼 이름만이 아닌, 호출·상속·구현·임포트·포함·오버라이드 엣지를 정밀하게 추출 |
| **Zero-Pollution** | 프로젝트 디렉토리에 아무것도 쓰지 않음. 모든 데이터는 `~/.cynapx/`에 격리 저장 |
| **신뢰도 구분 분석** | Dead code 결과를 HIGH / MEDIUM / LOW 3단계로 분류하여 오탐을 최소화 |
| **AI-Native** | 토큰 효율적 출력 포맷, 운영 지침 주입, LLM 소비를 위한 스마트 컨텍스트 프루닝 내장 |
| **확장 가능** | `LanguageProvider` 인터페이스를 구현하여 새 언어 지원 추가 가능 |

---

## 🚀 빠른 시작

### 1단계 — 클론 및 빌드

> Cynapx는 **GitHub 전용** 배포입니다 — npm에 게시되지 않습니다.

```bash
git clone https://github.com/Feel-o-sofa/cynapx.git
cd cynapx
npm install
npm run build
# 진입점: dist/bootstrap.js
```

**사전 요구사항:** Node.js ≥ 20, Git

### 2단계 — Claude Code에 등록

프로젝트 디렉토리에 `.mcp.json` 파일을 생성하거나 편집합니다:

```json
{
  "mcpServers": {
    "cynapx": {
      "command": "node",
      "args": ["/absolute/path/to/cynapx/dist/bootstrap.js", "--path", "."]
    }
  }
}
```

`/absolute/path/to/cynapx`를 저장소를 클론한 디렉토리의 절대 경로로 교체하세요. 저장 후 Claude Code를 재시작합니다.

### 3단계 — 프로젝트 초기화

연결 후 Claude Code 내에서 `initialize_project`를 호출합니다:

```
initialize_project  →  mode: "current"             # cynapx가 시작된 디렉토리를 인덱싱
initialize_project  →  mode: "existing"             # 이전에 등록된 프로젝트 재인덱싱
initialize_project  →  mode: "custom", path: "/your/project"   # 디스크의 임의 경로 인덱싱
```

인덱싱이 완료되면 20개의 도구가 모두 활성화됩니다. `get_setup_context`를 언제든지 호출하여 상태와 디스크 사용량을 확인할 수 있습니다.

---

## 🛠️ MCP 도구 목록 — 총 20개

### 설정 및 라이프사이클

| 도구 | 설명 |
|---|---|
| `get_setup_context` | 초기화 상태, `disk_usage_mb`, 등록된 프로젝트 확인 |
| `initialize_project` | 프로젝트를 지식 그래프에 인덱싱 (`mode`: `"current"` \| `"existing"` \| `"custom"`) |
| `purge_index` | 로컬 인덱스를 영구 삭제 — `confirm: true` 필요 |
| `re_tag_project` | 전체 재인덱싱 없이 구조적 특성 태깅만 재실행 |
| `backfill_history` | Git 커밋 이력을 역추적하여 인덱싱된 심볼에 커밋을 매핑 |

### 심볼 탐색

| 도구 | 설명 |
|---|---|
| `search_symbols` | 선택적 시맨틱(벡터) 모드를 포함한 키워드 검색 |
| `get_symbol_details` | 심볼의 전체 메트릭, 구조 태그, 변경 이력, 소스 스니펫 조회 |
| `get_callers` | 특정 심볼을 직접 호출하는 모든 심볼 목록 |
| `get_callees` | 특정 심볼이 호출하는 모든 심볼 목록 |
| `get_related_tests` | 호출 또는 임포트 엣지로 연결된 프로덕션 심볼의 테스트 파일 심볼 조회 |

### 아키텍처 분석

| 도구 | 설명 |
|---|---|
| `check_architecture_violations` | 레이어/도메인 간 불법 교차 및 순환 의존성 탐지 |
| `get_remediation_strategy` | 탐지된 위반에 대한 3단계 우선순위 수정 계획 생성 |
| `discover_latent_policies` | 그래프에 암묵적으로 인코딩된 아키텍처 패턴 발굴 |

### 품질 및 위험도

| 도구 | 설명 |
|---|---|
| `find_dead_code` | 미사용 심볼을 HIGH / MEDIUM / LOW 신뢰도로 분류하여 탐지 |
| `get_hotspots` | `cyclomatic`, `fan_in`, `fan_out`, `loc` 기준으로 상위 심볼 순위 |
| `get_risk_profile` | 순환 복잡도, 변경 빈도(churn rate), 커플링을 결합한 복합 위험 점수 |
| `analyze_impact` | 심볼 변경 시 전이적 영향을 받는 심볼을 BFS로 분석 |

### 리팩토링 및 내보내기

| 도구 | 설명 |
|---|---|
| `propose_refactor` | 심볼의 실제 그래프 위치에 기반한 위험도 인식 리팩토링 제안 |
| `export_graph` | 지식 그래프의 Mermaid 다이어그램 + JSON 구조 요약 내보내기 |
| `check_consistency` | 그래프 무결성을 디스크 상태 및 Git HEAD와 대조 검증 |

---

## 💻 관리자 CLI — `cynapx-admin`

`cynapx-admin` 바이너리는 등록된 모든 프로젝트와 저장 데이터에 대한 운영 제어 기능을 제공합니다.

| 명령 | 기능 |
|---|---|
| `status` | 현재 디스크 사용량 및 등록된 프로젝트 수 표시 |
| `list` | 등록된 모든 프로젝트의 경로와 인덱스 상태 목록 |
| `inspect <hash>` | 단일 프로젝트 인덱스의 상세 뷰 |
| `doctor` | 모든 인덱스에 대한 상태 검사 실행 및 불일치 탐지 |
| `purge <hash>` | 특정 프로젝트의 인덱스 삭제 |
| `unregister <hash>` | 인덱스를 삭제하지 않고 레지스트리에서 프로젝트 제거 |
| `compact <hash>` | SQLite VACUUM 실행으로 디스크 공간 회수 |
| `backup <hash>` | 프로젝트 인덱스의 타임스탬프 백업 생성 |
| `restore <hash> <backup>` | 백업 파일에서 프로젝트 인덱스 복원 |

---

## 🌐 지원 언어

| | | | |
|---|---|---|---|
| TypeScript | JavaScript | Python | Go |
| Java | C | C++ | C# |
| Kotlin | PHP | Rust | GDScript |

> 새 언어를 추가하려면 `LanguageProvider` 인터페이스를 구현하세요. 확장 포인트 API는 [GUIDE_EN.md](./GUIDE_EN.md)를 참고하세요.

---

## 📂 저장소 구조 (`~/.cynapx/`)

Cynapx는 프로젝트 디렉토리에 절대 쓰지 않습니다. 모든 영속 데이터는 `~/.cynapx/` 아래에 저장됩니다:

```
~/.cynapx/
├── registry.json          # 프로젝트 경로와 인덱스 해시 매핑
├── <hash>_v2.db           # 각 인덱싱된 프로젝트의 SQLite 지식 그래프
├── audit.log              # 모든 인덱스 변경 사항의 추가 전용 로그
├── backups/               # cynapx-admin backup으로 생성된 타임스탬프 .db 백업
├── locks/                 # 프로젝트별 쓰기 잠금 (동시 인덱싱 방지)
└── profiles/              # 프로젝트별 구조적 태그 프로파일 저장
```

`<hash>`는 인덱싱된 프로젝트의 정규 절대 경로에서 도출되어, 각 프로젝트가 안정적이고 충돌에 강한 저장 키를 갖도록 합니다.

---

## 🛡️ 보안

**경로 탈출 방지** — 모든 파일 접근은 등록된 프로젝트 루트에 대해 검증됩니다. 등록된 디렉토리 외부의 경로를 읽거나 인덱싱하려는 시도는 파일시스템에 도달하기 전에 차단됩니다.

**시스템 경로 방지** — OS 수준 디렉토리는 등록이 차단됩니다. `C:\Windows`, `C:\Program Files`, `/usr`, `/bin`, `/etc`, `/lib`, `/sys` 및 그 하위 디렉토리가 포함됩니다. `isSystemPath()` 가드는 경로가 어떻게 제공되더라도 시스템 파일의 우발적 인덱싱을 방지합니다.

**Zod 입력 검증** — 모든 MCP 도구 입력은 처리 전에 엄격한 Zod 스키마에 대해 검증됩니다. 잘못된 형식이나 예상치 못한 입력은 경계에서 구조화된 오류 응답으로 거부됩니다.

**요청 속도 제한** — 분석 엔드포인트는 자동화된 에이전트 루프에서의 자원 고갈을 방지하기 위해 분당 요청 횟수 제한을 적용합니다.

**격리 저장** — `~/.cynapx/` 디렉토리가 Cynapx가 쓰는 유일한 위치입니다. 프로젝트 디렉토리는 항상 읽기 전용으로 열립니다.

---

## 📖 문서

- [**User Guide (EN)**](./GUIDE_EN.md) — 전체 도구 레퍼런스, 에이전트 워크플로우, 설정 옵션
- [**사용자 가이드 (KR)**](./GUIDE_KR.md) — 전체 도구 레퍼런스 및 워크플로우 (한국어)

---

**Cynapx** — [Feel-o-sofa](https://github.com/Feel-o-sofa)가 개발·유지보수
