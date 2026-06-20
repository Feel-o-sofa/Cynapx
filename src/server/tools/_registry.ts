/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolHandler } from './_types.js';
import { getSetupContextHandler } from './get-setup-context.js';
import { initializeProjectHandler } from './initialize-project.js';
import { searchSymbolsHandler } from './search-symbols.js';
import { getSymbolDetailsHandler } from './get-symbol-details.js';
import { analyzeImpactHandler } from './analyze-impact.js';
import { getCallersHandler } from './get-callers.js';
import { getCalleesHandler } from './get-callees.js';
import { getRelatedTestsHandler } from './get-related-tests.js';
import { checkArchitectureViolationsHandler } from './check-architecture-violations.js';
import { getRemediationStrategyHandler } from './get-remediation-strategy.js';
import { proposeRefactorHandler } from './propose-refactor.js';
import { getRiskProfileHandler } from './get-risk-profile.js';
import { getHotspotsHandler } from './get-hotspots.js';
import { findDeadCodeHandler } from './find-dead-code.js';
import { exportGraphHandler } from './export-graph.js';
import { checkConsistencyHandler } from './check-consistency.js';
import { purgeIndexHandler } from './purge-index.js';
import { reTagProjectHandler } from './re-tag-project.js';
import { backfillHistoryHandler } from './backfill-history.js';
import { discoverLatentPoliciesHandler } from './discover-latent-policies.js';
import { getProjectOverviewHandler } from './get-project-overview.js';
import { getRecentChangesHandler } from './get-recent-changes.js';
import { getSymbolHistoryHandler } from './get-symbol-history.js';
import { addAnnotationHandler } from './add-annotation.js';
import { getAnnotationsHandler } from './get-annotations.js';
import { getArchitectureHandler } from './get-architecture.js';
import { findSimilarSymbolsHandler } from './find-similar-symbols.js';

export const toolRegistry = new Map<string, ToolHandler>([
    ['get_setup_context', getSetupContextHandler],
    ['get_project_overview', getProjectOverviewHandler],
    ['initialize_project', initializeProjectHandler],
    ['search_symbols', searchSymbolsHandler],
    ['find_similar_symbols', findSimilarSymbolsHandler],
    ['get_symbol_details', getSymbolDetailsHandler],
    ['analyze_impact', analyzeImpactHandler],
    ['get_callers', getCallersHandler],
    ['get_callees', getCalleesHandler],
    ['get_related_tests', getRelatedTestsHandler],
    ['check_architecture_violations', checkArchitectureViolationsHandler],
    ['get_remediation_strategy', getRemediationStrategyHandler],
    ['propose_refactor', proposeRefactorHandler],
    ['get_risk_profile', getRiskProfileHandler],
    ['get_hotspots', getHotspotsHandler],
    ['find_dead_code', findDeadCodeHandler],
    ['export_graph', exportGraphHandler],
    ['check_consistency', checkConsistencyHandler],
    ['purge_index', purgeIndexHandler],
    ['re_tag_project', reTagProjectHandler],
    ['backfill_history', backfillHistoryHandler],
    ['discover_latent_policies', discoverLatentPoliciesHandler],
    ['get_recent_changes', getRecentChangesHandler],
    ['get_symbol_history', getSymbolHistoryHandler],
    ['add_annotation', addAnnotationHandler],
    ['get_annotations', getAnnotationsHandler],
    ['get_architecture', getArchitectureHandler],
]);
