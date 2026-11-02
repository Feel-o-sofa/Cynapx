/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 *
 * Prints call-edge precision / recall per gold-set language, with every false
 * positive and false negative. Run with `npm run goldset`.
 */
import { goldsetLanguages, indexFixture, loadGold, score, GoldSet, IndexedFixture } from './harness';

const pct = (x: number) => `${(100 * x).toFixed(0)}%`.padStart(5);

function labelFor(gold: GoldSet, indexed: IndexedFixture, site: string): string {
    for (const edge of gold.edges) {
        for (const end of edge) {
            const [key, ...label] = end.split(' ');
            if (key.toLowerCase() === site) return `${site} ${label.join(' ')}`;
        }
    }
    const qnames = indexed.symbols.get(site);
    return qnames ? `${site} [${qnames.join(', ')}]` : site;
}

function describe(gold: GoldSet, indexed: IndexedFixture, edge: string): string {
    const [from, to] = edge.split(' -> ');
    return `${labelFor(gold, indexed, from)}  ->  ${labelFor(gold, indexed, to)}`;
}

(async () => {
    const rows: string[] = [];
    let tp = 0, predicted = 0, goldTotal = 0;
    const details: string[] = [];
    for (const language of goldsetLanguages()) {
        const gold = loadGold(language);
        const indexed = await indexFixture(language);
        const s = score(gold, indexed);
        tp += s.truePositives.length; predicted += s.predicted; goldTotal += s.gold;
        rows.push(`${language.padEnd(11)} ${pct(s.precision)} ${pct(s.recall)}   ${String(s.truePositives.length).padStart(2)}/${String(s.gold).padEnd(2)} gold, ${s.predicted} predicted`);
        if (s.falsePositives.length || s.falseNegatives.length) {
            details.push(`\n${language}`);
            for (const e of s.falsePositives) details.push(`  false positive  ${describe(gold, indexed, e)}`);
            for (const e of s.falseNegatives) details.push(`  missed          ${describe(gold, indexed, e)}`);
        }
    }
    const overallP = predicted === 0 ? 0 : tp / predicted;
    const overallR = goldTotal === 0 ? 0 : tp / goldTotal;
    console.log('language    prec. recall');
    for (const r of rows) console.log(r);
    console.log(`${'overall'.padEnd(11)} ${pct(overallP)} ${pct(overallR)}   ${String(tp).padStart(2)}/${goldTotal} gold, ${predicted} predicted`);
    console.log(details.join('\n'));
})();
