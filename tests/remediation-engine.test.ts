/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * M-1 v20 (Phase 23-1): table-driven regression gate for the 7 pure branches of
 * RemediationEngine.getRemediationStrategy(). The engine has no constructor
 * dependencies (pure function, no DB/async), so it is instantiated directly.
 * Branch evaluation order matters — each fixture avoids triggering an earlier branch.
 */
import { describe, it, expect } from 'vitest';
import { RemediationEngine } from '../src/graph/remediation-engine';
import { ArchitectureViolation } from '../src/graph/architecture-engine';
import { CodeNode, CodeEdge } from '../src/types';

function makeNode(overrides: Partial<CodeNode> & { qualified_name: string }): CodeNode {
    return {
        qualified_name: overrides.qualified_name,
        symbol_type: 'method',
        language: 'typescript',
        file_path: 'test.ts',
        start_line: 1,
        end_line: 10,
        visibility: 'private',
        is_generated: false,
        last_updated_commit: 'abc',
        version: 1,
        ...overrides,
    };
}

const dummyEdge: CodeEdge = {
    from_id: 1,
    to_id: 2,
    edge_type: 'depends_on',
    dynamic: false,
};

function makeViolation(overrides: Partial<ArchitectureViolation>): ArchitectureViolation {
    return {
        source: makeNode({ qualified_name: 'src/a.ts#Source' }),
        target: makeNode({ qualified_name: 'src/b.ts#Target' }),
        edge: dummyEdge,
        policyId: 'other-policy',
        description: 'an illegal dependency',
        ...overrides,
    };
}

describe('RemediationEngine.getRemediationStrategy() — M-1 v20 7-branch gate', () => {
    const engine = new RemediationEngine();

    it('branch 1: missing source/target → Insufficient Violation Data', () => {
        const violation = {
            source: undefined,
            target: undefined,
            edge: dummyEdge,
            policyId: 'other-policy',
            description: 'x',
        } as unknown as ArchitectureViolation;

        const result = engine.getRemediationStrategy(violation);
        expect(result.strategy).toBe('Insufficient Violation Data');
        expect(result.steps.length).toBeGreaterThan(0);
        expect(result.steps[0]).toBeTruthy();
        expect(typeof result.rationale).toBe('string');
    });

    it('branch 2: circular-dependency policy → Dependency Decoupling (Abstractions or Events)', () => {
        const violation = makeViolation({
            policyId: 'circular-dependency',
            source: makeNode({ qualified_name: 'src/a.ts#A', tags: [] }),
            target: makeNode({ qualified_name: 'src/b.ts#B', tags: [] }),
        });

        const result = engine.getRemediationStrategy(violation);
        expect(result.strategy).toBe('Dependency Decoupling (Abstractions or Events)');
    });

    it('branch 3: core/data → api → Dependency Inversion via Interface/DTO', () => {
        const violation = makeViolation({
            policyId: 'layered-architecture',
            source: makeNode({ qualified_name: 'src/core/a.ts#A', tags: ['layer:core'] }),
            target: makeNode({ qualified_name: 'src/api/b.ts#B', tags: ['layer:api'] }),
        });

        const result = engine.getRemediationStrategy(violation);
        expect(result.strategy).toBe('Dependency Inversion via Interface/DTO');
    });

    it('branch 4: utility → service/repository → Stateless Helper Extraction', () => {
        const violation = makeViolation({
            policyId: 'utility-isolation',
            source: makeNode({ qualified_name: 'src/util/a.ts#A', tags: ['role:utility'] }),
            target: makeNode({ qualified_name: 'src/svc/b.ts#B', tags: ['role:service'] }),
        });

        const result = engine.getRemediationStrategy(violation);
        expect(result.strategy).toBe('Stateless Helper Extraction');
    });

    it('branch 5: repository → repository → Service-Layer Orchestration', () => {
        const violation = makeViolation({
            policyId: 'domain-isolation',
            source: makeNode({ qualified_name: 'src/repo/a.ts#A', tags: ['role:repository'] }),
            target: makeNode({ qualified_name: 'src/repo/b.ts#B', tags: ['role:repository'] }),
        });

        const result = engine.getRemediationStrategy(violation);
        expect(result.strategy).toBe('Service-Layer Orchestration');
    });

    it('branch 6: high cyclomatic/loc → SRP Decomposition', () => {
        const violation = makeViolation({
            policyId: 'complexity-budget',
            source: makeNode({ qualified_name: 'src/a.ts#God', tags: [], cyclomatic: 31 }),
            target: makeNode({ qualified_name: 'src/b.ts#B', tags: [] }),
        });

        const result = engine.getRemediationStrategy(violation);
        expect(result.strategy).toBe('Single Responsibility Principle (SRP) Decomposition');
        expect(result.steps.length).toBeGreaterThan(0);
        expect(result.steps[0]).toBeTruthy();
    });

    it('branch 6 (loc variant): high loc → SRP Decomposition', () => {
        const violation = makeViolation({
            policyId: 'complexity-budget',
            source: makeNode({ qualified_name: 'src/a.ts#Fat', tags: [], cyclomatic: 0, loc: 501 }),
            target: makeNode({ qualified_name: 'src/b.ts#B', tags: [] }),
        });

        const result = engine.getRemediationStrategy(violation);
        expect(result.strategy).toBe('Single Responsibility Principle (SRP) Decomposition');
    });

    it('branch 7: default → Architectural Decoupling, rationale includes description', () => {
        const violation = makeViolation({
            policyId: 'other-policy',
            description: 'a totally unrelated illegal edge',
            source: makeNode({ qualified_name: 'src/a.ts#A', tags: [], cyclomatic: 0, loc: 0 }),
            target: makeNode({ qualified_name: 'src/b.ts#B', tags: [] }),
        });

        const result = engine.getRemediationStrategy(violation);
        expect(result.strategy).toBe('Architectural Decoupling');
        expect(result.rationale).toContain('a totally unrelated illegal edge');
    });
});
