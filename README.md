# Cynapx (시냅스엑스)

**Cynapx**는 AI 에이전트와 개발자를 위한 고성능 격리형 코드 지식 엔진입니다. 프로젝트의 구조를 분석하여 지식 그래프를 구축하고, AI 에이전트가 코드를 직접 전수 조사하지 않고도 프로젝트를 깊이 있게 이해할 수 있도록 돕습니다.

## 주요 특징

- **AI 에이전트 최적화**: MCP(Model Context Protocol) 서버를 내장하여 AI 도구와 즉시 연동 가능.
- **격리형 저장소 (Zero-Pollution)**: 분석 대상 프로젝트 폴더를 오염시키지 않고 중앙 격리 디렉터리(`~/.cynapx/`)에 인덱스 저장.
- **실시간 증분 업데이트**: 파일 시스템 감시와 Git 이력 동기화를 통해 항상 최신 인덱스 유지.
- **다국어 지원**: TypeScript, JavaScript, Python 코드의 정밀 분석 및 의존성 추적.
- **정합성 보장**: 자가 진단 엔진을 통해 실제 파일과 인덱스 간의 일관성 유지.
- **시각화 지원**: Mermaid 형식을 통한 코드 호출 그래프 익스포트.

## 설치 방법

```bash
# 로컬 패키지 파일로 설치하는 경우
npm install ./cynapx-0.1.0.tgz
```

## 사용 방법

### CLI 실행 (HTTP API 서버)

```bash
npx cynapx --path "/path/to/your/project"
```

기본적으로 `http://localhost:3000`에서 API 서버가 시작됩니다.

### MCP 모드 실행 (AI 에이전트 연동용)

**Windows (PowerShell):**
```powershell
$env:MCP_MODE="true"; npx cynapx --path "C:\your\project\path"
```

**Linux / macOS:**
```bash
MCP_MODE=true npx cynapx --path "/your/project/path"
```

Claude Desktop 등 MCP 호환 도구의 설정(config)에 위 명령어를 추가하여 연동할 수 있습니다.

### 주요 옵션

- `--path <dir>`: 분석할 프로젝트의 경로 (기본값: 현재 디렉터리)
- `--help`: 도움말 표시

## 제공 도구 (MCP Tools)

- `search_symbols`: 심볼 이름 기반 검색 (FTS5 활용)
- `get_symbol_details`: 특정 심볼의 정의 위치, 호출 수, 피호출 수 등 상세 정보 조회
- `analyze_impact`: 특정 심볼 변경 시 영향을 받는 상위 호출 체계 분석 (영향 범위 파악)
- `get_hotspots`: 복잡도(Cyclomatic)나 결합도(Fan-in)가 높은 코드 영역 탐지
- `export_graph`: 특정 심볼 중심의 관계를 Mermaid 다이어그램 코드로 추출 (시각화)
- `check_consistency`: 인덱스와 실제 소스 파일/Git 상태 간의 정합성 검사 및 자동 복구

## 라이선스

이 프로젝트는 내부용으로 개발되었습니다.