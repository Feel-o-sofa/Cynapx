# Agent Rules for Cynapx Project

This project is integrated with the **Cynapx MCP Server**, a high-performance code knowledge graph. All AI agents MUST adhere to these rules to ensure architectural integrity and zero-defect delivery.

## 0. Session Initialization Protocol (Mandatory)

- **On Startup**: The agent MUST immediately read all markdown documents in `agent_docs/` (excluding the root `reports/` directory) to synchronize with the project's goals, current status, and working guidelines.
- **Briefing**: After reading, the agent must provide a concise "ready" message to the user, indicating that the context is fully synchronized.
- **Scope**: This protocol applies to every new session or when requested via the `/sync` command.

## 1. Knowledge-Driven Analysis (Cynapx First)

Before performing any code modification or structural analysis, you MUST use the `cynapx` MCP tools(if available) to eliminate hallucinations:
- **Structural Discovery**: Use `cynapx.search_symbols` to locate classes and methods.
- **Dependency Mapping**: Use `cynapx.analyze_impact` and `cynapx.export_graph` to understand the ripple effect of any change.
- **Metric-Driven Review**: Use `cynapx.get_hotspots` to identify complex areas (Cyclomatic Complexity > 20) before refactoring.
- **Context Gathering**: Use `cynapx.get_symbol_details` to read source code within its architectural context.
- **Semantic Evidence**: When providing architectural guidance or warnings, always use **Logical Clusters (graph://clusters)** and **Metrics (Complexity, Fan-out)** as the objective basis for judgment.

## 2. Cynapx Development Protocol (Advanced Iteration)

Follow this rigorous, iterative workflow for every task:

1. **Mastery (Investigation)**: 
   - **Step-by-Step Decomposition**: Break down complex tasks (especially architectural refactors like Task 23.5) into smaller, manageable sub-tasks.
   - **Architectural Discovery**: Activate the `cynapx-architect` skill before coding.
   - **Token Efficiency**: When delegating to sub-agents (e.g., `codebase_investigator`), explicitly instruct them to use **`cynapx` tools** instead of broad text searches to minimize context usage.
   - **Multilingual Research**: Use **`context7`** to research and understand new language grammars, Tree-sitter S-queries, or engine-specific structures (e.g., GDScript Signals) before implementation.

2. **Strategic Planning**: 
   - Identify all prerequisites (dependencies, schema changes, types).
   - **Architectural Design (Mandatory)**: Use the `cynapx-architect` guidelines to plan refactors or new features, ensuring they align with system invariants and graph-based metrics.
   - **Test Scenario Design (Mandatory)**: Activate the `test-scenario-designer` skill to design comprehensive test scenarios (Normal & Abnormal) before implementation.
   - Integrate these scenarios into a step-by-step implementation and verification plan.

3. **Sub-Agent Delegation**:
   To prevent sub-agents (e.g., `codebase_investigator`) from providing incomplete or inaccurate summaries due to exploration limits:
   - **Mandatory Tool Utilization**: The primary agent MUST explicitly instruct sub-agents to proactively activate and utilize any relevant **Skills** (e.g., `cynapx-architect`, `test-scenario-designer`, etc.) and **MCP Tools** (e.g., `context7`, `cynapx`, etc.) available in the project context.
   - **Cynapx-Centric**: Sub-agents MUST prioritize `cynapx` MCP tools (`search_symbols`, `analyze_impact`, etc.) over broad text-based searches (`grep`) to minimize noise and build an accurate architectural map efficiently.
   - **Micro-Delegation**: Do not delegate complex analysis in a single turn. Break investigations into iterative stages: 'High-level Structure -> Component Deep-Dive -> Transitive Impact Assessment'.
   - **Evidence-Based Reporting**: Sub-agents MUST list the specific files and symbols they have directly inspected using `get_symbol_details` or `read_file`. They must explicitly label any related areas that were NOT reached due to exploration limits as **"Unverified"**.
   - **Prohibition of Premature Negative Conclusions**: A sub-agent MUST NOT conclude that a feature or logic is "not found" or "does not exist" unless it has attempted at least three different keyword combinations via `search_symbols` and verified the results through the `cynapx` graph. "I don't know" or "Needs further investigation" is preferred over a false "Not found".

4. **Zero-Defect Verification (Iterative Cycles)**:
   - **Build Check**: Always run `npm run build` after any modification.
   - **Integration Script**: Create dedicated `scripts/verify_*.ts` covering both "Normal" and "Abnormal" scenarios.
   - **Schema Alignment**: Manually verify and migrate the local database if `schema.sql` changes are not automatically applied.
   - **Repeat**: If a test fails, repeat the cycle (Investigate -> Fix -> Verify) until zero defects are confirmed.

5. **Automated Reporting**: 
   - Archive a final report in `reports/` summarizing the **Before/Plan/After** state and verification logs.

## 3. Cynapx Core Mandates

- **Zero-Pollution (Strict)**: Never create permanent files in the project directory. The central registry is the primary source for project identification. **Always prefer operating without an anchor file if possible.**
- **Integrity Conservation**: Respect the "Conservation Law" (fan-in/out balance) when modifying graph logic.
- **Architecture Scalability**: Ensure all new parser logic follows the **LanguageProvider/Lazy-Loading** architecture to prevent dependency bloat.

---
*These rules are binding for all AI agents working on the Cynapx(ProjectAnalyzer) codebase.*
