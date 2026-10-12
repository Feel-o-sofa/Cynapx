/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 *
 * Call-edge accuracy ratchet. Each gold-set fixture is indexed end to end and
 * its `calls` edges are scored against hand-written ground truth
 * (tests/fixtures/goldset/<language>/gold.json). The counts may only improve:
 * fewer true positives or more false positives than the recorded baseline fail
 * the build. Run `npm run goldset` for the full report.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GOLDSET_DIR, goldsetLanguages, indexFixture, loadGold, score } from './goldset/harness';

const baseline: Record<string, { truePositives: number; falsePositives: number }> =
    JSON.parse(fs.readFileSync(path.join(GOLDSET_DIR, 'baseline.json'), 'utf8'));

describe('call-edge gold set', () => {
    it('has a baseline for every fixture language', () => {
        expect(goldsetLanguages().sort()).toEqual(Object.keys(baseline).filter(k => !k.startsWith('_')).sort());
    });

    for (const language of goldsetLanguages()) {
        it(`${language}: does not regress below the recorded baseline`, async () => {
            const s = score(loadGold(language), await indexFixture(language));
            const b = baseline[language];
            expect(s.truePositives.length, `true positives fell; missed: ${s.falseNegatives.join('; ')}`).toBeGreaterThanOrEqual(b.truePositives);
            expect(s.falsePositives.length, `false positives rose: ${s.falsePositives.join('; ')}`).toBeLessThanOrEqual(b.falsePositives);
        });
    }
});
