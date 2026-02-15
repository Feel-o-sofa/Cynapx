# 🧠 Cynapx 완벽 가이드 (The Definitive Guide) v1.0.5
### "코드의 신경망을 잇는 지능형 아키텍처 분석 엔진"

Cynapx(시냅스엑스)는 AI 에이전트와 엔지니어가 대규모 코드베이스를 인간처럼 이해하고, 아키텍트처럼 설계할 수 있도록 돕는 **고성능 지식 그래프 엔진**입니다.

---

## 📋 목차
1. [Cynapx 소개: 코드 그 이상의 지능](#1-cynapx-소개-코드-그-이상의-지능)
2. [시작하기: 설치 및 에이전트 등록](#2-시작하기-설치-및-에이전트-등록)
3. [AI 에이전트를 위한 지능형 도구 (Phase 12-14)](#3-ai-에이전트를-위한-지능형-도구-phase-12-14)
4. [운영 모드: Stdio, HTTP 및 One-shot CLI](#4-운영-모드-stdio-http-및-one-shot-cli)
5. [핵심 기술: 정합성 보존 및 AI Native 최적화](#5-핵심-기술-정합성-보존-및-ai-native-최적화)
6. [문제 해결 (Troubleshooting)](#6-문제-해결-troubleshooting)

---

## 1. Cynapx 소개: 코드 그 이상의 지능

단순한 텍스트 검색(`grep`)은 코드가 가진 **"설계적 의도"**를 읽지 못합니다. Cynapx는 코드를 **살아있는 지식 그래프**로 변환하여 단순한 정보 조회를 넘어선 고차원적 통찰을 제공합니다.

*   **Relationship-First (관계 중심)**: 상속, 구현, 정적/동적 호출 관계를 전역적으로 추적합니다.
*   **Architecture-Aware (설계 인식)**: 심볼의 가시성(Public/Private)과 맥락을 이해하여 실제 설계 결함을 식별합니다.
*   **Zero-Pollution (무결성)**: 프로젝트 디렉터리에 어떠한 설정 파일도 생성하지 않으며, 모든 데이터는 중앙 격리 저장소에서 안전하게 관리됩니다.
*   **Global Ledger (전역 장부)**: 모든 호출 관계를 장부(Ledger) 형태로 기록하여 데이터 정합성을 100% 스스로 검증합니다.

---

## 2. 시작하기: 설치 및 에이전트 등록

### 2.1 필수 의존성
Cynapx는 고성능 파싱을 위해 `tree-sitter` 네이티브 바인딩을 사용합니다. 각 OS에 맞는 빌드 도구가 필요합니다.
*   **Windows**: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (C++ 데스크톱 개발 워크로드)
*   **macOS/Linux**: `xcode-select --install` 또는 `build-essential`

### 2.2 설치 방법
```bash
# NPM을 통해 전역 설치
npm install -g cynapx
```

### 2.3 에이전트 등록 (Gemini CLI 예시)
Cynapx는 **Model Context Protocol (MCP)** 표준을 완벽히 지원합니다.
```powershell
# Windows PowerShell
gemini mcp add cynapx "npx" "--" "cynapx" "--path" "$PWD"
```

---

## 3. AI 에이전트를 위한 지능형 도구 (Phase 12-14)

Cynapx v1.0.5는 에이전트의 의사결정을 지원하는 강력한 도구 세트를 포함합니다.

### 🛡️ 아키텍처 진단 및 처방
*   **check_architecture_violations**: 레이어 계층 위반, 도메인 격리 위반, **순환 의존성(Circular Dependency)**을 자동으로 탐지합니다.
*   **get_remediation_strategy**: 탐지된 위반 사항에 대해 **DIP(의존성 역전)**, 인터페이스 추출 등 전문적인 리팩토링 전략을 3단계 가이드로 제시합니다.

### ⚠️ 위험 분석 및 정책 발견
*   **get_risk_profile**: Git 수정 이력(Churn), 복잡도, 결합도를 결합하여 특정 심볼을 수정할 때의 **위험 점수(Danger Score)**를 산출합니다.
*   **discover_latent_policies**: 코드베이스 내에 명시되지 않았으나 통계적으로 지켜지고 있는 **잠재적 아키텍처 규칙**을 찾아내어 제안합니다.

### 📊 지능형 시각화
*   **export_graph**: 복잡한 관계를 Mermaid 다이어그램으로 시각화함과 동시에, 에이전트가 직접 파싱할 수 있는 **JSON 데이터 요약**을 함께 반환합니다.

---

## 4. 운영 모드: Stdio, HTTP 및 One-shot CLI

### 4.1 Stdio 모드 (에이전트 기본값)
에이전트와 Cynapx가 직접 파이프로 통신합니다. 가장 보안이 강력하고 지연 시간이 적습니다.

### 4.2 One-shot CLI 모드 (신규)
MCP 서버를 띄우지 않고도 터미널에서 즉시 분석 명령을 내릴 수 있습니다.
```bash
# 아키텍처 위반 즉시 점검
npx cynapx check_architecture_violations

# 특정 심볼 리스크 분석
npx cynapx get_risk_profile --qualified_name "src/main.ts#Main"
```

---

## 5. 핵심 기술: 정합성 보존 및 AI Native 최적화

### ⚡ AI Native Token Optimization
*   **Smart Context Pruning**: 100라인 이상의 긴 소스 코드는 에이전트의 컨텍스트 윈도우를 고려하여 지능적으로 요약 반환합니다.
*   **Instruction Injection**: 에이전트가 접속 시, 서버가 **'Cynapx 운영 매뉴얼'**을 주입하여 에이전트가 도구를 가장 효율적으로 사용하도록 유도합니다.

### 🔍 정밀 태깅 시스템 (Precision Tagging)
*   **가시성 인식**: Private/Protected 메서드를 `trait:internal`로 식별하여 불필요한 태그 전파와 오탐(False Positive)을 원천 차단합니다.
*   **맥락적 필터링**: 동일 클래스/파일 내의 호출은 '자가 호출'로 인식하여 아키텍처 위반 보고에서 제외합니다.

---

## 6. 문제 해결 (Troubleshooting)

### Q1. 심볼 검색 결과가 실제 코드와 다릅니다.
*   **해결**: `npx cynapx check_consistency --repair`를 실행하여 파일 시스템과 인덱스를 동기화하세요.

### Q2. 아키텍처 위반이 너무 많이 나옵니다.
*   **해결**: `npx cynapx re_tag_project`를 실행하여 최신 정밀 태깅 규칙을 적용하세요. 대부분의 '자가 호출' 노이즈가 제거됩니다.

---

**Cynapx와 함께 단순한 코딩을 넘어선 '설계하는 개발'을 경험해 보세요!**
