# Cynapx Work Log

One entry per agent session, newest first: what changed, what was decided, what is left.
This replaces the diagnostic-vN / phaseN-plan cycle (retired by HANDOVER D5). Routine
drift detection now runs in CI (`.github/workflows/scheduled-maintenance.yml`).

---

## 2026-10-12 — v4.0.0: stabilization and tool profiles (HANDOVER WP-1, WP-2)

- **Shipped on the branch, released as 4.0.0** (PR to master pending owner merge + tag):
  advisories 12 → 0 (prod) and 0 (full tree); tool profiles `frontier` (default, 21 tools,
  embeddings off) / `full` (27); weekly maintenance workflow; tests 882 → 904.
- **Found and fixed beyond the plan**: source-run path broken since 2026-06-15 (root cause of
  the repo's own MCP server failing to connect); stdio server ignored stdin EOF and could be
  orphaned holding the lock; index-time embeddings ignored `CYNAPX_EMBED_*`; unknown tool
  names hung until indexing finished; npm 10.9.x cannot freshly resolve this manifest
  (lockfile regenerated with npm 11 — `npm ci` on npm 10 is fine).
- **Decisions added** (HANDOVER §6): D8 profile is per process, not per project; D9 release
  is 4.0.0, not 3.2.0.
- **Open follow-ups**: the indexer tries to parse the `.cynapx-config` anchor file and logs
  "No parser found" on every index (noise, harmless); `ProjectProfile.embedding` is loaded
  but never read (kept per the no-deletion rule; docs no longer claim it works); the
  scheduled workflow only starts firing once it is on master.
