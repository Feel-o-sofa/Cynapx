# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[2.0.0]: https://github.com/Feel-o-sofa/cynapx/compare/v1.0.6...v2.0.0
[1.0.6]: https://github.com/Feel-o-sofa/cynapx/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/Feel-o-sofa/cynapx/compare/v1.0.2...v1.0.5
[1.0.2]: https://github.com/Feel-o-sofa/cynapx/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/Feel-o-sofa/cynapx/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Feel-o-sofa/cynapx/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/Feel-o-sofa/cynapx/releases/tag/v0.1.0
