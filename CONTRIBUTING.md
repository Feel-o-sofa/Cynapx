# Contributing to Cynapx

Thank you for your interest in contributing to Cynapx, a high-performance isolated code knowledge engine for AI agents.

---

## Table of Contents

1. [Development Setup](#development-setup)
2. [Worktree-Based Development Workflow](#worktree-based-development-workflow)
3. [Sub-Agent Orchestration Workflow](#sub-agent-orchestration-workflow)
4. [Commit Message Conventions](#commit-message-conventions)
5. [Pull Request Process](#pull-request-process)
6. [Running Tests](#running-tests)
7. [TypeScript Type Checking](#typescript-type-checking)

---

## Development Setup

### Prerequisites

- Node.js 18 or later
- npm 9 or later
- Git

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/Feel-o-sofa/cynapx.git
cd cynapx

# 2. Install dependencies
npm install

# 3. Build the project
npm run build

# 4. Run tests to verify the setup
npm test
```

After a successful build, the compiled output will be available in the `dist/` directory.

---

## Worktree-Based Development Workflow

Cynapx uses Git worktrees to enable parallel, isolated development — particularly for AI-agent-driven branches. Worktrees live under `.claude/worktrees/`.

### Creating a Worktree

```bash
# Create a new worktree for a feature branch
git worktree add .claude/worktrees/<branch-name> -b <branch-name>
```

### Working Inside a Worktree

Each worktree is a fully independent working directory sharing the same Git object store. You can build and test independently inside each worktree:

```bash
cd .claude/worktrees/<branch-name>
npm install
npm run build
npm test
```

### Listing and Removing Worktrees

```bash
# List all active worktrees
git worktree list

# Remove a worktree once the branch is merged
git worktree remove .claude/worktrees/<branch-name>
```

Worktrees are especially useful for running the cynapx-dev MCP server against the current working tree without affecting the main checkout.

---

## Sub-Agent Orchestration Workflow

Cynapx supports a sub-agent orchestration model where a planner agent delegates discrete tasks to worker agents, each operating in its own worktree. The full specification is documented in [`agent_docs/workflow.md`](agent_docs/workflow.md).

Key points:

- The **Orchestrator** agent reads the improvement plan, selects a task, and spawns a Worker agent in an isolated worktree.
- The **Worker** agent implements the task, runs `npx tsc --noEmit` and `npm test`, then opens a PR.
- The Orchestrator reviews the PR and merges it before proceeding to the next task.
- Agents follow the Cynapx Development Protocol defined in the agent rules (`.claude/`).

---

## Commit Message Conventions

Cynapx follows the [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Format

```
<type>(<scope>): <short summary>
```

### Types

| Type       | When to use                                          |
|------------|------------------------------------------------------|
| `feat`     | A new feature or capability                          |
| `fix`      | A bug fix                                            |
| `docs`     | Documentation-only changes                           |
| `chore`    | Maintenance tasks (build, dependencies, config)      |
| `refactor` | Code restructuring without behavior change           |
| `test`     | Adding or updating tests                             |
| `security` | Security-related fixes or hardening                  |
| `release`  | Version bump and release preparation                 |

### Scope

Use a short identifier for the area being changed, for example:

- `feat(E-1-B): split find_dead_code into confidence tiers`
- `fix(E-1): repair dead code detection accuracy`
- `docs(workflow): add sub-agent orchestration spec`
- `chore(deps): enforce tree-sitter v0.25.0 via overrides`

When the change is broad and does not fit a single scope, omit the scope:

```
feat: implement Phase 8 Multilingual Expansion
```

---

## Pull Request Process

1. **Branch** — Create a feature or fix branch from `release` (or use a worktree as described above).

   ```bash
   git checkout -b feat/my-feature release
   ```

2. **Develop** — Make your changes, following the commit conventions above.

3. **Type-check** — Run TypeScript type checking before pushing (see below).

4. **Test** — Ensure all tests pass with `npm test`.

5. **Push** — Push your branch to the remote.

   ```bash
   git push -u origin feat/my-feature
   ```

6. **Open a PR** — Open a pull request targeting the `release` branch. Provide a clear description of what changed and why.

7. **CI must pass** — All CI checks (build, type-check, tests) must pass before the PR can be merged. Do not merge a PR with failing checks.

8. **Review** — At least one reviewer (human or orchestrator agent) must approve the PR.

9. **Merge** — Merge to `release` (squash or merge commit as appropriate). Delete the source branch after merging.

---

## Running Tests

Cynapx uses [Vitest](https://vitest.dev/) as the test runner.

```bash
# Run the full test suite
npm test
```

Tests live in the `tests/` directory. When adding a new feature, include corresponding unit or integration tests.

---

## TypeScript Type Checking

Before pushing any TypeScript changes, verify there are no type errors:

```bash
npx tsc --noEmit
```

This runs the TypeScript compiler in check-only mode (no output files produced). Fix all reported errors before opening a PR. The CI pipeline runs the same check, so unresolved type errors will block the merge.
