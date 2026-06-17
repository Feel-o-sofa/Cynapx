/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { ToolDeps } from '../tool-dispatcher.js';
import { ToolHandler, ToolResult } from './_types.js';

export const getArchitectureHandler: ToolHandler = {
    async execute(args: any, deps: ToolDeps): Promise<ToolResult> {
        const ctx = deps.getContext();
        if (!ctx) {
            return { content: [{ type: 'text', text: 'Error: No active project. Run initialize_project first.' }], isError: true };
        }

        const archEngine = ctx.archEngine!;
        const intent = archEngine.getIntent();

        if (!intent) {
            const msg = [
                '# Architecture Intent',
                '',
                'No declared architecture intent found for this project.',
                '',
                'To declare your intended architecture, create a `cynapx.architecture.json` file at the project root with the following shape:',
                '',
                '```json',
                '{',
                '  "layers": [',
                '    { "name": "api", "pathPattern": "src/api/", "description": "HTTP entrypoints" },',
                '    { "name": "core", "pathPattern": "src/core/", "description": "Business logic" },',
                '    { "name": "data", "pathPattern": "src/data/", "description": "Persistence" }',
                '  ],',
                '  "rules": [',
                '    { "name": "data must not call api", "from": "data", "to": "api", "allowed": false, "rationale": "Keeps dependencies pointing inward." }',
                '  ],',
                '  "responsibilities": {',
                '    "api": "Handles transport and request validation.",',
                '    "core": "Owns domain rules.",',
                '    "data": "Talks to the database."',
                '  }',
                '}',
                '```',
                '',
                'It will be loaded automatically on the next project initialization.',
            ].join('\n');
            return { content: [{ type: 'text', text: msg }] };
        }

        const drift = await archEngine.compareIntentVsReality(ctx.policyDiscoverer);

        const lines: string[] = [];
        lines.push('# Architecture Intent');
        lines.push('');

        // Declared layers
        lines.push('## Declared Layers');
        lines.push('');
        if (intent.layers.length === 0) {
            lines.push('_No layers declared._');
        } else {
            const layerCounts = new Map(drift.declaredLayers.map(l => [l.name, l.nodeCount]));
            for (const layer of intent.layers) {
                const count = layerCounts.get(layer.name) ?? 0;
                const desc = layer.description ? ` — ${layer.description}` : '';
                lines.push(`- **${layer.name}** (\`${layer.pathPattern}\`): ${count} node(s)${desc}`);
            }
        }
        lines.push('');

        // Responsibilities
        lines.push('## Responsibilities');
        lines.push('');
        const respKeys = Object.keys(intent.responsibilities);
        if (respKeys.length === 0) {
            lines.push('_No responsibilities declared._');
        } else {
            for (const key of respKeys) {
                lines.push(`- **${key}**: ${intent.responsibilities[key]}`);
            }
        }
        lines.push('');

        // Rules (with rationale)
        lines.push('## Rules');
        lines.push('');
        if (intent.rules.length === 0) {
            lines.push('_No rules declared._');
        } else {
            for (const rule of intent.rules) {
                const verb = rule.allowed ? 'may depend on' : 'must NOT depend on';
                lines.push(`- **${rule.name}**: \`${rule.from}\` ${verb} \`${rule.to}\``);
                if (rule.rationale) {
                    lines.push(`  - _Rationale_: ${rule.rationale}`);
                }
            }
        }
        lines.push('');

        // Drift report
        lines.push('## Drift Report');
        lines.push('');

        lines.push('### Unmapped Layers');
        if (drift.unmappedLayers.length === 0) {
            lines.push('All declared layers map to at least one node. ✅');
        } else {
            lines.push('These layers are declared but have **no matching nodes** (possible naming/path drift):');
            for (const name of drift.unmappedLayers) {
                lines.push(`- ${name}`);
            }
        }
        lines.push('');

        lines.push('### Rule Health');
        if (drift.ruleHealth.length === 0) {
            lines.push('_No rules to evaluate._');
        } else {
            for (const rh of drift.ruleHealth) {
                const icon = rh.status === 'healthy' ? '✅' : '⚠️';
                lines.push(`- ${icon} **${rh.rule.name}** — ${rh.status} (${rh.violationCount} violation(s))`);
            }
        }
        lines.push('');

        lines.push('### Emergent Patterns');
        if (drift.emergentPatterns.length === 0) {
            lines.push('No undeclared emergent dependency patterns detected.');
        } else {
            lines.push('Statistically-observed dependency patterns that are **not declared** in the intent:');
            for (const p of drift.emergentPatterns) {
                lines.push(`- ${p.description}`);
            }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
};
