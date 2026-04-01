/**
 * Benchmark: StructuralTagger.tagNode() and mergeRoles() performance.
 *
 * Measures the time to tag 100 synthetic nodes and to propagate / merge
 * roles across parent→child relationships.
 */
import { bench, describe } from 'vitest';
import { StructuralTagger } from '../../src/indexer/structural-tagger';
import type { CodeNode } from '../../src/types';

/** Build a synthetic node that exercises multiple tag detection paths. */
function makeNode(i: number): CodeNode {
    const kinds = ['class', 'function', 'method', 'interface', 'field'] as const;
    const visibilities = ['public', 'private', 'protected', 'internal'] as const;
    const paths = [
        '/project/src/db/user-repository.ts',
        '/project/src/server/api-controller.ts',
        '/project/src/indexer/parser-engine.ts',
        '/project/src/utils/string-util.ts',
        '/project/src/types/domain-model.ts',
    ];

    return {
        qualified_name: `bench/Module#symbol_${i}`,
        symbol_type: kinds[i % kinds.length],
        language: 'typescript',
        file_path: paths[i % paths.length],
        start_line: (i * 5) + 1,
        end_line: (i * 5) + 4,
        visibility: visibilities[i % visibilities.length],
        is_generated: i % 7 === 0,
        last_updated_commit: 'deadbeef',
        version: 1,
        modifiers: i % 3 === 0 ? ['abstract'] : i % 5 === 0 ? ['static'] : [],
    };
}

const NODES_100 = Array.from({ length: 100 }, (_, i) => makeNode(i));

const PARENT_TAGS = ['role:repository', 'layer:data', 'trait:internal'];
const CHILD_TAGS = ['role:utility', 'layer:core'];

describe('StructuralTagger', () => {
    bench('tagNode — 100 nodes', () => {
        for (const node of NODES_100) {
            StructuralTagger.tagNode(node);
        }
    });

    bench('mergeRoles — 100 merge operations', () => {
        for (let i = 0; i < 100; i++) {
            StructuralTagger.mergeRoles(CHILD_TAGS, PARENT_TAGS);
        }
    });

    bench('tagNode + mergeRoles combined — 100 nodes', () => {
        for (const node of NODES_100) {
            const tags = StructuralTagger.tagNode(node);
            StructuralTagger.mergeRoles(tags, PARENT_TAGS);
        }
    });
});
