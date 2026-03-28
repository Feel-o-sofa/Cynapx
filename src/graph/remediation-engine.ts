/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ArchitectureViolation } from './architecture-engine';
import { RemediationRecipe } from '../types';

/**
 * RemediationEngine provides structural refactoring strategies for architectural violations.
 */
export class RemediationEngine {
    /**
     * Generates a remediation recipe for a specific violation.
     */
    public getRemediationStrategy(violation: ArchitectureViolation): RemediationRecipe {
        if (!violation.source || !violation.target) {
            return {
                strategy: 'Insufficient Violation Data',
                rationale: 'The violation object is missing source or target node information.',
                steps: [
                    '1. Ensure the violation was produced by check_architecture_violations.',
                    '2. Verify that both source and target symbols exist in the knowledge graph.',
                    '3. Re-run check_architecture_violations and pass one of the returned violation objects directly.'
                ]
            };
        }

        const fromTags = violation.source?.tags || [];
        const toTags = violation.target?.tags || [];

        // 1. Circular Dependency
        if (violation.policyId === 'circular-dependency') {
            return {
                strategy: 'Dependency Decoupling (Abstractions or Events)',
                rationale: 'Circular dependencies make the system rigid, hard to test, and prone to memory leaks.',
                steps: [
                    '1. Identify the common functionality causing the cycle.',
                    '2. Extract that shared logic into a new, independent module/helper.',
                    '3. If extraction is not possible, use the Dependency Inversion Principle (DIP): Introduce an interface that one side implements and the other depends on.',
                    '4. Alternatively, use an Event-driven approach: Replace direct calls with an Event Emitter/Listener.'
                ]
            };
        }

        // 2. Bottom-Up Violation (Data/Core -> API)
        if (toTags.includes('layer:api') && (fromTags.includes('layer:core') || fromTags.includes('layer:data'))) {
            return {
                strategy: 'Dependency Inversion via Interface/DTO',
                rationale: 'Lower layers should not have knowledge of high-level API or Presentation layers.',
                steps: [
                    '1. Extract an interface for the required functionality in the Domain/Core layer.',
                    '2. Have the API layer implement this interface.',
                    '3. Use Dependency Injection to provide the implementation to the lower layer.',
                    '4. If transferring data, use simple Data Transfer Objects (DTO) defined in a common layer.'
                ]
            };
        }

        // 3. Utility Logic Violation (Utility -> Service/Repo)
        if (fromTags.includes('role:utility') && (toTags.includes('role:service') || toTags.includes('role:repository'))) {
            return {
                strategy: 'Stateless Helper Extraction',
                rationale: 'Utility components must be stateless and cross-cutting. Depending on business services violates SRP.',
                steps: [
                    '1. Identify if the utility actually needs the service logic.',
                    '2. Move the business logic out of the utility and into a Service.',
                    '3. Pass the required data as arguments to the utility method instead of having the utility fetch it.',
                    '4. Ensure the utility is pure (stateless) and only operates on input arguments.'
                ]
            };
        }

        // 4. Domain Isolation Violation (Repo -> Repo)
        if (fromTags.includes('role:repository') && toTags.includes('role:repository')) {
            return {
                strategy: 'Service-Layer Orchestration',
                rationale: 'Repositories should be isolated to their own domain. Cross-domain coordination belongs in the Service layer.',
                steps: [
                    '1. Remove the direct call between repositories.',
                    '2. Create a Service that coordinates the calls to both repositories.',
                    '3. Ensure transactional integrity is managed at the Service level.'
                ]
            };
        }

        // 5. Fat Component / High Complexity (God Object)
        if ((violation.source?.cyclomatic || 0) > 30 || (violation.source?.loc || 0) > 500) {
            return {
                strategy: 'Single Responsibility Principle (SRP) Decomposition',
                rationale: 'The component is too large and handles too many responsibilities (God Object).',
                steps: [
                    '1. Group related methods and fields into logical sub-modules.',
                    '2. Use the "Extract Class" or "Extract Function" refactoring pattern.',
                    '3. Delegate specialized tasks to new, smaller components.',
                    '4. Use composition over inheritance to rebuild the original functionality.'
                ]
            };
        }

        // Default strategy
        return {
            strategy: 'Architectural Decoupling',
            rationale: `Illegal relationship detected: ${violation.description}.`,
            steps: [
                `1. Analyze the intent of the relationship between '${violation.source?.qualified_name}' and '${violation.target?.qualified_name}'.`,
                `2. Identify if the dependency can be reversed using DIP.`,
                `3. Check if the logic can be moved to a more appropriate layer/module.`,
                `4. If the relationship is notification-based, use an Observer or Pub/Sub pattern.`
            ]
        };
    }
}
