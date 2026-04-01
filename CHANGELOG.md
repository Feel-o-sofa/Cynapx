# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `cynapx-dev` MCP entry for worktree rapid iteration
- Sub-agent orchestration workflow specification in `agent_docs/workflow.md`

### Changed
- `find_dead_code` tool now returns results split into HIGH/MEDIUM/LOW confidence tiers (E-1-B)
- Improvement plan consolidated with current completion status

### Fixed
- Dead code detection accuracy root cause fix (E-1)
- Cross-platform `build:copy` script; CI Node.js version matrix updated
- Analysis engine accuracy and runtime bugs (E-1 through E-6)
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

[Unreleased]: https://github.com/Feel-o-sofa/cynapx/compare/v1.0.6...HEAD
[1.0.6]: https://github.com/Feel-o-sofa/cynapx/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/Feel-o-sofa/cynapx/compare/v1.0.2...v1.0.5
[1.0.2]: https://github.com/Feel-o-sofa/cynapx/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/Feel-o-sofa/cynapx/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Feel-o-sofa/cynapx/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/Feel-o-sofa/cynapx/releases/tag/v0.1.0
