# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - 2026-06-22

A post-release refinement of the v3.0.0 Vision Arc: documentation corrected against source, the in-protocol agent guidance refreshed with new prompts and a repo playbook, and a security-hygiene fix to the Docker smoke script. **No breaking changes, no schema change, no re-index required.** See [RELEASE_NOTES_v3.1.0.md](./RELEASE_NOTES_v3.1.0.md).

### Added
- **Three new MCP prompts** (additive, backward-compatible) — `onboard-codebase` (guided first-contact workflow for an unfamiliar repo), `find-similar` (drives the semantic `find_similar_symbols` K-NN flow), and `trace-history` (walks temporal context via `get_recent_changes` / `get_symbol_history`)
- **Repo-root `AGENTS.md`** — concise playbook codifying conventions and the development protocol for agents working on the Cynapx repository itself

### Changed
- **Version bump to 3.1.0** — additive, backward-compatible agent-facing capability refresh (new MCP prompts) warrants a minor bump
- **Rewritten in-protocol operator manual** — `buildCynapxInstructions()` emits a clearer, version-stamped operator manual in the MCP `initialize` response, reaching any connecting model automatically
- **Refreshed `refactor-safety` prompt** — updated to the current toolset and reasoning flow
- **Documentation accuracy** — README/README_KR/GUIDE_EN/GUIDE_KR corrected against actual source for MCP tool params, CLI flags, REST endpoints/auth, and admin/ops behavior; `get_recent_changes` example made commit-keyed to match its description

### Security
- **No literal API token in the Docker smoke script** — `scripts/docker-smoke.sh` now generates `KNOWLEDGE_TOOL_TOKEN` per run (env override, else `openssl rand -hex 16`, with a non-`openssl` fallback) instead of hardcoding `smoke-test-token`; no literal token value remains in source. No behavioral change to the smoke test.

## [3.0.0] - 2026-06-20

The **Vision Arc (P1–P9)** release — making Cynapx a true AI-driven knowledge base with model-agnostic semantic search and polyglot cross-language enrichment. See [RELEASE_NOTES_v3.0.0.md](./RELEASE_NOTES_v3.0.0.md) for the full narrative.

### Added
- **Model-agnostic embedding providers** (P9-0) — pluggable factory (`createEmbeddingProviderFromEnv()`) selecting OpenAI-compatible, Ollama, Jina sidecar, or Null providers at runtime via `CYNAPX_EMBED_*` env vars or per-project `ProjectProfile.embedding`
- **`find_similar_symbols` tool** (P9-3) — K-NN semantic similarity over stored embeddings via `VectorRepository.getEmbedding()`, score normalized as `1 / (1 + distance)`
- **Query-time embedding pass-through** (P9-2) — `search_symbols` accepts a pre-computed `query_embedding`, keeping queries in the agent's own model space; enables semantic search even without `semantic: true`
- **Rich structured search output** (P9-5) — results now return `{ qname, type, file, signature, docstring_snippet, tags, fan_in, score }`
- **Confidence scoring** (P9-4) — `mergeResultsRRF` exposes RRF/positional relevance scores on every result
- **Code body in embedding snippets** (P9-1) — `createSnippet()` includes the on-disk source body (start/end line slice, 1000-char cap) for sharper semantic discrimination
- **`get_project_overview` tool** (P3) — token-efficient whole-project briefing
- **`get_recent_changes` / `get_symbol_history` tools** (P4) — temporal context from Git history
- **`add_annotation` / `get_annotations` tools** (P5) — agent write-back of `decision` / `gotcha` / `todo` / `rationale` notes
- **`get_architecture` tool** (P6) — architecture intent model from `cynapx.architecture.json` with drift detection
- **Docstring/intent capture** (P1) and meaningful embedding snippets (P2)
- **Polyglot test-spec extraction** (P8-1) — pytest/unittest (Python), `func Test*`/`t.Run` (Go), `#[test]` (Rust), `@Test` (Java) via `LanguageDescriptor.extractTestSpecs` hook
- **Cross-file local import resolution** (P8-3) — Python relative imports and Rust `mod foo;` resolve to real file nodes
- **Per-language docstring normalization** (P8-4) — Rust (`///`/`//!`), C# (XML tags), Go (`//`), GDScript (`##`) via `normalizeDocstring` hook
- **Intra-file call resolution** (P8-2) — `calls` edges resolve to same-file FQNs

### Changed
- **Version bump to 3.0.0** — major version reflecting the completed Vision Arc and the new model-agnostic semantic layer
- `mcp-server.ts` replaced hardcoded `PythonEmbeddingProvider` with `createEmbeddingProviderFromEnv()`
- MCP tool count grew from 20 to **27**
- `LanguageDescriptor` gained three optional hooks (`resolveImport`, `normalizeDocstring`, `extractTestSpecs`); `resolveImport` extended with optional `absFilePath` parameter (backward-compatible)

### Quality
- 839/839 tests passing across 57 files; `tsc --noEmit` clean; `npm audit --omit=dev` 0 vulnerabilities

## [2.0.0] - 2026-04-18

### Added
- **Strategy Pattern for sync pipeline** — `SyncStrategy` interface with `FullScanStrategy` and `IncrementalSyncStrategy` extracted from `UpdatePipeline.syncWithGit`, reducing cyclomatic complexity from 18 to 3 and enabling independent unit testing
- **Disk usage monitoring** — `get_setup_context` now returns `disk_usage_mb` and a `disk_warning` when central storage exceeds 1 GB threshold (`DISK_THRESHOLD_MB`)
- **Backup / Restore CLI** — `cynapx-admin backup` and `cynapx-admin restore` commands for point-in-time snapshots of the project DB to `~/.cynapx/backups/`
- **System path guard** — `isSystemPath()` helper in `src/utils/paths.ts` blocks registration and traversal of OS-level directories (Windows: `C:\Windows`, `C:\Program Files`; Unix/macOS: `/usr`, `/bin`, `/etc`, `/System`, etc.)
- **Sub-agent orchestration workflow** — `agent_docs/workflow.md` specifying Wave/Gate patterns, mandatory integration tests for every new feature, and 3-tier Gate policy
- **Integration test suite** — `scripts/integration-test.js` covering 65 assertions across Phases 0–23, including real DB/git/filesystem validation
- **Unit tests for sync strategies** — `tests/sync-strategies.test.ts` with 5 vitest tests covering FullScanStrategy and IncrementalSyncStrategy edge cases
- `cynapx-dev` MCP entry for worktree rapid iteration

### Changed
- **Version bump to 2.0.0** — major version reflecting the accumulated architectural improvements since v1.0.x
- **`find_dead_code`** — results now split into HIGH / MEDIUM / LOW confidence tiers (E-1-B)
- **`mapHistoryToProject`** — raw `BEGIN/COMMIT` SQL replaced with `db.transaction()()` (better-sqlite3 native transactions)
- **`processBatch` and `applyDelta`** — deduplicated `fan_in`/`fan_out` recomputation into private `recomputeFanMetrics()` method
- Improvement plan consolidated with current completion status

### Fixed
- `findProjectAnchor` now short-circuits on system paths, preventing accidental indexing of OS directories
- `addToRegistry` throws `Error` instead of silently registering system paths
- Dead code detection accuracy root cause (E-1 through E-6)
- Cross-platform `build:copy` script; CI Node.js version matrix updated
- Critical security vulnerabilities resolved; test infrastructure established

## [1.0.6] - 2026-03-29

### Added
- H-1 through H-4, M-1, M-3, M-4 stability and security improvements

## [1.0.5] - 2026-02-15

### Added
- Phase 14: MCP Protocol Perfection and roadmap cleanup
- Phase 13: Precision Tagging and Advanced Violation Filtering
- Phase 12: Decision Support and Policy Evolution (Tasks 37-39)
- Phase 11: Architectural Reasoning and one-shot CLI
- Phase 10: Cross-project symbol resolution and graph finalization
  - Boundaryless Edge Discovery via Shadow Nodes (Task 31)
  - Structural Characteristic Tagging (Task 32)
  - Structural role propagation via inheritance (Task 32 Enhancement)
  - Historical Evidence Mapping (Task 33)
- Dynamic plugin loading and native module detection refinement
- Rust-native hybrid core and dynamic plugin system
- Migration to MCP Streamable HTTP standard
- Purely ephemeral HTTPS and request logging middleware
- Localized and standardized README and guides (EN/KR)

### Changed
- Repository optimized and distribution artifacts removed (GitHub-based installation)
- MIT license adopted

### Fixed
- tree-sitter v0.25.0 enforced across all sub-dependencies via overrides
- Low-severity vulnerability in `qs` package (`npm audit fix`)
- Missing `chokidar` type definitions added

## [1.0.2] - 2026-02-14

### Added
- AI-native token optimization and graph caching (release v1.0.2)

## [1.0.1] - 2026-02-14

### Added
- Build process refinements for asset inclusion

## [1.0.0] - 2026-02-15

### Added
- Initial official release with AI-native architecture reasoning and MCP perfection
- Phase 8: Multilingual Expansion — Python, JavaScript/TypeScript, Go, Rust, PHP, Java, Kotlin, C#
  - LanguageProvider architecture and Lazy Loading (Task 23.5)
  - Semantic Code Clustering and consistency logic improvements (Task 24)
  - Task 25 Wave 2: Java, Kotlin, C# relation extraction
  - Wave 3: PHP language support; inheritance extraction across all languages
  - Refactored relation extraction and standardized language registry naming
- Phase 7: Performance Optimization and AI Accessibility
  - SecurityProvider and Project Registry enhancements
  - LifecycleManager and structured error reporting
  - Rich content responses for `get_symbol_details` and `export_graph`
  - `graph://hotspots` resource and `/refactor-safety` prompt
  - Dynamic call analysis and `graph://ledger` MCP resource
  - Conservation of call edges via DB triggers and global ledger verification
  - FTS5 prefix matching and advanced symbol filtering
  - Task 22.5: AI accessibility enhancements and system integrity
  - Force re-indexing option added to consistency checker
- Phase 6: Consistency checking and Git-aware pipeline
- Comprehensive agent rules and Cynapx Development Protocol for AI agents
- Interactive project initialization and advanced index purging
- MCP server analysis tools and project README

### Fixed
- MCP discovery timeout (server starts early with improved protocol compliance)
- UNIQUE constraint failure during Git sync (stale data cleared for added files)

## [0.1.0] - 2026-02-10

### Added
- Phase 5 and 6: Git-based reliability, large change optimization, and visualization
- Phase 4: Project renamed to Cynapx; isolated per-project storage implemented
- Phase 3: Parallel indexing and MCP server implementation
- Phase 2: Dependency indexing and path-based impact analysis
- Core indexing logic enhancements and `.gitignore` updates
- Initial commit: Code Knowledge Tool core implementation

[3.1.0]: https://github.com/Feel-o-sofa/cynapx/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/Feel-o-sofa/cynapx/compare/v2.0.0...v3.0.0
[2.0.0]: https://github.com/Feel-o-sofa/cynapx/compare/v1.0.6...v2.0.0
[1.0.6]: https://github.com/Feel-o-sofa/cynapx/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/Feel-o-sofa/cynapx/compare/v1.0.2...v1.0.5
[1.0.2]: https://github.com/Feel-o-sofa/cynapx/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/Feel-o-sofa/cynapx/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Feel-o-sofa/cynapx/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/Feel-o-sofa/cynapx/releases/tag/v0.1.0
