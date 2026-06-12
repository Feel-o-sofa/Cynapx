/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 *
 * build:copy — copies non-TS runtime assets into dist/ after tsc.
 *
 * P13-1 (v9 A-7 잔존): this replaces the former inline `node -e` script whose
 * blanket `try { ... } catch (e) {}` silently swallowed every copy failure.
 * Copy failures now fail the build. The only tolerated absence is the
 * optional native addon directory (src-native may legitimately be missing,
 * e.g. inside the Docker builder stage, or contain no built .node files).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// 1. tree-sitter query files — required at runtime by the language providers.
const queriesSrc = path.join(ROOT, 'src', 'indexer', 'languages', 'queries');
const queriesDst = path.join(ROOT, 'dist', 'indexer', 'languages', 'queries');
fs.cpSync(queriesSrc, queriesDst, { recursive: true });

// 2. optional native addon binaries (.node) — present only when src-native
//    has been built (npm run build:native). Missing directory is fine;
//    a failing copy of an existing file is not.
const nativeDir = path.join(ROOT, 'src-native');
let nativeCopied = 0;
if (fs.existsSync(nativeDir)) {
    for (const f of fs.readdirSync(nativeDir).filter((n) => n.endsWith('.node'))) {
        fs.copyFileSync(path.join(nativeDir, f), path.join(ROOT, 'dist', f));
        nativeCopied++;
    }
}

console.error(`[build:copy] queries copied, ${nativeCopied} native addon file(s) copied`);
