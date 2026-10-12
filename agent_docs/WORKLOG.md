# Cynapx Work Log

One entry per agent session, newest first: what changed, what was decided, what is left.
This replaces the diagnostic-vN / phaseN-plan cycle (retired by HANDOVER D5). Routine
drift detection now runs in CI (`.github/workflows/scheduled-maintenance.yml`).

---

## 2026-10-12 (latest) — 4.1.0: call-edge gold set and resolution (HANDOVER WP-3 item 3)

- **v4.0.0**: merged to master (PR #23, CI green). The tag is **not** pushed: GitHub refuses non-branch
  refs from agent sessions (`only branch updates are permitted`; HANDOVER gotcha 14). Owner creates it.
- **Gold set**: 5 languages, 36 hand-verified call edges, keyed by definition site. Ratchet test +
  `npm run goldset` report. Baseline at start: precision 96%, recall 61%.
- **Root causes found and fixed**, in order of impact:
  1. Tree-sitter named members `file#member`, so a method and a same-named function collapsed into one
     node (and every `fold` method in a file became one node). Now `file#Type.member`.
  2. The pipeline resolved any unmatched name to the first symbol in the DB with that name — the source
     of the Java false positive. Now scoped: caller's file → its imports → its directory → unique.
  3. Qualified calls were dropped: Go `util.Format`, Rust `util::log` (the `:` type-hint split mangled
     it), Java `Util.log` (captured bare). Now resolved via imports (module) or type members.
  4. `self`/`this`/Go receiver calls, and calls through typed parameters, now resolve to the type.
  5. TypeScript: imported identifiers resolved to the import alias in the caller's file.
- **Result**: precision 100%, recall 100% on the gold set. **Cross-check on unseen code** (Python stdlib
  `email`, old vs new resolver, compared by definition site): +153 edges (sample of 25 all correct),
  −16 (every one a collapsed-node artifact now at the right definition, or a wrong guess such as
  `utils.decode_params → _header_value_parser.quote` when utils imports `quote` from `_parseaddr`).
- **Annotations**: keyed by qname, so the rename would orphan them. The automatic re-index (minor
  version change) moves them when unambiguous.
- **Decisions**: D10 precision over recall for ambiguous calls; D11 release as 4.1.0.
- **Open follow-ups** (HANDOVER §5 item 6): assignment-inferred receivers, inherited/`super()` calls,
  Python absolute self-package imports. Also noticed: `purge_index` deletes annotations with the DB, and
  the 4.0.0 upgrade notes recommend it — 4.1.0's automatic re-index avoids that path, but `purge_index`
  itself still discards cross-session memory.

---

## 2026-10-12 (later) — v4.0.0 release blockers found after the PR went up

- The repo's own MCP server still failed to connect after the source-runner fix: a cold
  start took 32.6 s to answer `initialize`, over Claude Code's 30 s connect timeout.
- Root cause: the "No parser found" noise was not harmless. Unparseable tracked files counted
  as batch failures, so `lastIndexedCommit` never advanced and every start re-indexed all
  286 files. Fixed by skipping them; one shared parser factory for workers and main thread
  (the main thread's set lacked `DependencyParser`). Cold start now 1.8 s.
- Also fixed the ordering: the stdio transport now connects before the initial sync, with
  tools gated on readiness, so a first index of a large repo stays inside the timeout.
- CI: native builds had been skipped on master since June; once they ran, `windows-latest`
  (VS 2026 vs node-gyp) and the retired `macos-13` broke them. Runners pinned.

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
- **Open follow-ups**: ~~the indexer logs "No parser found" for unparseable files (noise,
  harmless)~~ — wrong, see the entry above; `ProjectProfile.embedding` is loaded
  but never read (kept per the no-deletion rule; docs no longer claim it works); the
  scheduled workflow only starts firing once it is on master.
