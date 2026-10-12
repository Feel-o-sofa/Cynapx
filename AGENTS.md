# AGENTS.md — Driving Cynapx as an AI Agent

Cynapx is a persistent **code knowledge graph** exposed over MCP. It exists so you
can get *exact* structural and historical context about a codebase instead of
guessing from raw text. Everything here is **model-agnostic** — it works the same
whether you are Claude, Codex, or a local model.

> If you are a human wiring this up: reference this file from your project's
> `CLAUDE.md` / `AGENTS.md` (e.g. "Use Cynapx for code navigation — see AGENTS.md")
> so your agent reaches for these tools first. The same guidance is also injected
> automatically via the MCP server's `instructions` at connect time.

## When to reach for Cynapx

Prefer Cynapx over grep/file-reading whenever you need **relationships, impact, or
history**, not just text matches:

- "What calls this / what does this call?" → `get_callers` / `get_callees`
- "If I change X, what breaks?" → `analyze_impact`
- "Where are the real complexity/coupling hotspots?" → `get_hotspots`, `get_project_overview`
- "Is there similar code already?" → `find_similar_symbols` *(full profile only)*
- "Why does this exist / what changed recently?" → `get_symbol_history` / `get_recent_changes`
- "Does this violate the intended architecture?" → `get_architecture`, `check_architecture_violations`

## Recommended workflow

1. **Orient.** On an unfamiliar codebase, call `get_project_overview` first — purpose,
   tech stack, architecture shape, entry points, hotspots. Read the `graph://summary`
   and `graph://hotspots` resources for a quick map.
2. **Locate.** `search_symbols` searches the keyword index. Under the `full` profile
   (or with an embedding provider configured) it also takes `semantic: true` or a
   pre-computed `query_embedding`, and `find_similar_symbols` surfaces duplicates.
3. **Understand.** `get_symbol_details`, `get_callers`, `get_callees`,
   `get_related_tests`. For intent and history, `get_symbol_history` and
   `get_recent_changes` (both require `backfill_history` to have run once).
4. **Investigate before editing.** ALWAYS run `analyze_impact` on a symbol before
   changing it, and read `get_symbol_details` for its complexity/coupling.
5. **Guard architecture.** After structural work, run `get_architecture` /
   `check_architecture_violations` (`get_remediation_strategy` suggests fixes under `full`).
6. **Write back.** Record decisions, gotchas, todos, and rationale with
   `add_annotation` so future sessions (and other agents/models) inherit your context.
   Retrieve them with `get_annotations`.

## Tool profiles

Cynapx serves one of two toolsets, chosen per server process with `CYNAPX_TOOL_PROFILE`:

- **`frontier`** (default) — 21 tools for frontier-class agents. Cynapx covers what an
  agent cannot do on its own: cross-session memory, symbol history, declared-architecture
  checks, reverse call relationships and deterministic metrics. Embeddings are off unless
  `CYNAPX_EMBED_PROVIDER` is set.
- **`full`** — all 27 tools, with the Python embedding sidecar as the default provider.
  Intended for smaller local models.

Tools marked † below are `full`-only. Calling one under `frontier` returns an error that
explains how to enable it. Nothing is removed — the profile only hides tools.

## Tool map (21 tools by default, 27 under `full`)

| Goal | Tools |
|------|-------|
| Setup & lifecycle | `get_setup_context`, `get_project_overview`, `initialize_project`, `purge_index`, `re_tag_project`†, `backfill_history` |
| Navigation & search | `search_symbols`, `find_similar_symbols`†, `get_symbol_details`, `get_callers`, `get_callees`, `get_related_tests` |
| Temporal context & memory | `get_recent_changes`, `get_symbol_history`, `add_annotation`, `get_annotations` |
| Architecture | `get_architecture`, `check_architecture_violations`, `get_remediation_strategy`†, `discover_latent_policies`† |
| Quality & risk | `find_dead_code`, `get_hotspots`, `get_risk_profile`, `analyze_impact` |
| Refactoring & export | `propose_refactor`†, `export_graph`†, `check_consistency` |

Full parameter reference: [GUIDE_EN.md](./GUIDE_EN.md) (한국어: [GUIDE_KR.md](./GUIDE_KR.md)).

## Prompts (reusable workflows)

The server exposes MCP prompts you can invoke directly: `onboard-codebase`,
`explain-impact`, `find-similar`†, `trace-history`, `check-health`, `refactor-safety`.

## Resources

`graph://summary` · `graph://hotspots` · `graph://clusters` · `graph://ledger`.

## Operating invariants

- **Investigation-first** — never modify code before `analyze_impact` + `get_symbol_details`.
- **Context efficiency** — `get_symbol_details` prunes large symbols; widen via its own
  params rather than re-reading whole files.
- **Temporal tools need history** — run `backfill_history` once to unlock
  `get_recent_changes` / `get_symbol_history` and churn-based risk metrics.
- **Zero-pollution** — Cynapx never writes to your project. Don't add local config unless asked.
- **Consistency** — if `graph://ledger` counts look off, run `check_consistency`
  (with `repair: true`).

## Model-agnostic semantics

The embedding layer is pluggable (OpenAI-compatible, Ollama, Jina sidecar, or none) via
`CYNAPX_EMBED_*` environment variables. It is off by default under the `frontier` profile;
`search_symbols` then answers semantic requests from the keyword index and says so.
When embeddings are on and your runtime already produces them, pass
them as `query_embedding` to `search_symbols` to avoid a server-side re-embed and any
cross-model mismatch. See [GUIDE_EN.md §2.6](./GUIDE_EN.md#26-model-agnostic-embeddings).
