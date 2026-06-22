# Cynapx v3.1.0 — Sharper Docs, Smarter Agents

> **Vision:** Make Cynapx the *true* knowledge base for AI-driven development — so that AI agents can **always get exact context** on whatever they are involved in.

Cynapx is a high-performance, isolated **code knowledge engine** for AI agents: an MCP server + REST API backed by a tree-sitter multi-language parser and a SQLite (`better-sqlite3` + `sqlite-vec`) knowledge graph, with worker-thread indexing and git-based incremental sync.

v3.1.0 is a **post-release refinement** of the v3.0.0 Vision Arc. There is **no new engine surface** here — instead this release sharpens accuracy and the agent experience: documentation is corrected against the actual source, the in-protocol operator guidance every agent receives is rewritten, three new MCP prompts are added, a repo-root `AGENTS.md` playbook lands, and a security-hygiene fix removes a literal token from the Docker smoke script.

**No breaking changes. No migration needed. No schema change. No re-index required.**

---

## 📚 Documentation Accuracy

A pass over the user-facing docs to make every example and parameter match what master actually ships. These corrections were verified directly against source:

- **MCP tool parameters** — tool argument names, optionality, and shapes in README/guides now match the live tool schemas (e.g. `search_symbols` `query_embedding`, the `find_similar_symbols` signature, annotation kinds).
- **CLI** — `cynapx` / `cynapx-admin` command and flag documentation reconciled with the real argument parser.
- **REST API** — endpoint paths, auth header (`KNOWLEDGE_TOOL_TOKEN`), and the unauthenticated `/healthz` probe documented as implemented.
- **Admin / operations** — backup/restore and storage-management docs aligned with actual behavior.
- **Examples** — corrected illustrative examples (e.g. `get_recent_changes` now shown commit-keyed to match its description).
- Applied consistently across **README.md / README_KR.md / GUIDE_EN.md / GUIDE_KR.md**.

No behavioral change — these are factual corrections so agents and humans reading the docs get the truth.

---

## 🤖 Agent-Facing Improvements

The most impactful part of this release is additive and **reaches any model automatically** — no client configuration, no per-agent setup. Because this guidance is delivered *in-protocol* (via MCP `initialize` instructions and MCP prompts), Claude, ChatGPT Codex, local LLMs, and whatever comes next all receive it the moment they connect.

- **Rewritten in-protocol operator manual.** `buildCynapxInstructions()` now emits a clearer, version-stamped operator manual returned in the MCP `initialize` response, so every connecting agent is briefed on how to use Cynapx effectively without reading external docs.
- **Three new MCP prompts** (additive, backward-compatible):
  - **`onboard-codebase`** — a guided first-contact workflow for an agent landing in an unfamiliar repository.
  - **`find-similar`** — drives the semantic K-NN `find_similar_symbols` flow for duplicate detection, pattern discovery, and refactoring.
  - **`trace-history`** — walks an agent through temporal context (`get_recent_changes` / `get_symbol_history`) to answer "what changed and why".
- **Refreshed `refactor-safety` prompt** — updated to the current toolset and reasoning flow.
- **New repo-root `AGENTS.md`** — a concise playbook for agents working *on* the Cynapx repository itself, codifying conventions and the development protocol.

Because the new prompts and instructions are additive and backward-compatible, existing integrations keep working unchanged — this is why the release is a **minor** bump.

---

## 🔒 Security Hygiene

- **No literal API token in the Docker smoke script.** `scripts/docker-smoke.sh` previously hardcoded `KNOWLEDGE_TOOL_TOKEN=smoke-test-token`. That value was only ever consumed inside the throwaway test container (the smoke test itself only polls the unauthenticated `/healthz`), so it was never a real credential leak — but committing any literal token value is poor hygiene. The token is now **generated per run** (`KNOWLEDGE_TOOL_TOKEN` override, else `openssl rand -hex 16`, with a non-`openssl` fallback), so no literal token string lives in source. No behavioral change to the smoke test.

A fresh repo-wide secret scan confirms **no real hardcoded secrets** anywhere in source: all credential handling is env/config-sourced or runtime-generated (embedding API keys from `CYNAPX_EMBED_API_KEY`/config, REST token from `KNOWLEDGE_TOOL_TOKEN` or a `randomBytes(32)` token persisted at `0600`, IPC auth via HMAC keyed on a runtime nonce, ephemeral RSA cert generated at runtime).

---

## ✅ Quality Gates

- **839/839 tests passing**
- `tsc --noEmit` — clean
- `npm run build` — clean

---

## 📦 Upgrade Notes

- **No breaking changes.** All additions (the new prompts and the refreshed in-protocol instructions) are backward-compatible.
- **No migration and no re-index required** — there is no schema change in this release.
- Simply update to 3.1.0; agents will pick up the new in-protocol guidance and prompts automatically on their next connection.

---

**Full diff:** `v3.0.0...v3.1.0`
