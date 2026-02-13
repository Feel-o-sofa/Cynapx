# Agent Rules for Cynapx Project

This project is integrated with the **Cynapx MCP Server**, a high-performance code knowledge graph. All AI agents MUST adhere to these rules as their primary operating system.

## 0. Session Initialization & Core Mandate

- **Mandatory Synchronization**: On startup or `/sync`, the agent MUST read all markdown documents in `agent_docs/`.
- **Protocol Internalization**: The agent MUST internalize the **Cynapx Development Protocol** (Investigation-Design-Implementation-Verification-Regression) as the only valid workflow. 
- **Self-Reminder**: Before starting ANY task, the agent must mentally (or via internal reasoning) verify that it is following the 5-step protocol. Silence or skipping steps is a violation of these rules.

## 1. Cynapx Development Protocol (The 5-Step Workflow)

Every individual task, regardless of size, MUST follow this sequence:

### Step 1: Mastery (Investigation & Research)
- **Tooling**: Use `cynapx` MCP tools (`search_symbols`, `analyze_impact`) to build an architectural map.
- **Research**: Use `context7` to understand external libraries or language-specific nuances.
- **Goal**: Zero assumptions. Complete understanding of the "As-Is" state.

### Step 2: Strategic Architectural Design
- **Skill Activation**: You MUST activate the `cynapx-architect` skill.
- **Planning**: Create a detailed plan including dependencies, schema changes, and risk mitigation.
- **Verification Plan**: You MUST activate the `test-scenario-designer` skill to design both "Normal" and "Abnormal" test cases *before* writing a single line of implementation code.

### Step 3: Precise Implementation
- **Adherence**: Follow project conventions, types, and architectural patterns.
- **Sub-Agent Delegation**: When delegating to sub-agents (e.g., `codebase_investigator`):
    - You MUST explicitly instruct them to activate relevant **Skills** and use **MCP Tools** (Cynapx, Context7).
    - Instruct them to prioritize graph-based analysis over text-based `grep`.

### Step 4: Zero-Defect Verification
- **Execution**: Run the test scenarios designed in Step 2.
- **Checklist**: (1) Build Check, (2) Integration Scripts (`scripts/verify_*.ts`), (3) Schema Alignment, (4) Artifact Cleanup.
- **Mandatory Success**: A task is NOT complete until all verification steps pass with zero defects.

### Step 5: Recursive Regression (Depth-In/Depth-Out)
- **Recursive Fix (Depth-In)**: If verification fails, do NOT just patch the code. You MUST "Depth-In" by restarting from **Step 1 (Investigation)** for the specific issue. Analyze the root cause using Cynapx tools again.
- **Re-Integration (Depth-Out)**: Once the specific fix is verified, "Depth-Out" to perform a full integration-level verification of the original task scope to ensure no regressions.
- **Iteration**: Repeat this cycle until the entire scope is flawlessly verified.

## 2. Sub-Agent & Tooling Mandates

- **Skill Mastery**: Always prioritize using a specialized **Skill** (via `activate_skill`) if one exists for the task (Architecting, Testing, Onboarding).
- **Tool Proactivity**: Do not wait for user permission to use MCP tools; use them proactively to ensure accuracy.
- **Evidence-Based Reporting**: All reports must be based on objective evidence from `cynapx` metrics or tool outputs, not intuition.

## 3. Cynapx Core Invariants

- **Zero-Pollution**: Maintain the central registry; no local `.cynapx-config` unless explicitly asked.
- **Integrity Conservation**: Respect the `fan_in/out` balance and Global Ledger rules.
- **Architecture Scalability**: Follow the LanguageProvider/Lazy-Loading patterns.

## 4. Windows/PowerShell Compatibility & Path Handling

- **PowerShell Syntax**: All commands executed via `run_shell_command` MUST follow Windows PowerShell syntax. 
    - Use `;` instead of `&&` to chain multiple commands.
    - Ensure proper quoting for paths containing spaces.
- **Path Escaping in Code**: When writing code (TypeScript, Python, etc.) that involves file paths:
    - **NEVER** use a single backslash `\` in string literals as it triggers unintended escape sequences (e.g., `\n`, `\t`).
    - **ALWAYS** use double backslashes `\\` or forward slashes `/` (e.g., `C:/Path/To/File` or `C:\\Path\\To\\File`).
    - Prefer using platform-agnostic path utilities (e.g., Node's `path.join()`) where possible.

---
*Failure to follow the Investigation-Design-Implementation-Verification-Regression protocol is considered a system-level error.*


---
*These rules are binding for all AI agents working on the Cynapx(ProjectAnalyzer) codebase.*
