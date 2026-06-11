/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { LanguageDescriptor } from './descriptor';
import { cDescriptor } from './c';
import { cppDescriptor } from './cpp';
import { csharpDescriptor } from './csharp';
import { gdscriptDescriptor } from './gdscript';
import { goDescriptor } from './go';
import { javaDescriptor } from './java';
import { javascriptDescriptor } from './javascript';
import { kotlinDescriptor } from './kotlin';
import { phpDescriptor } from './php';
import { pythonDescriptor } from './python';
import { rustDescriptor } from './rust';
import { typescriptDescriptor } from './typescript';

export type { LanguageDescriptor, CaptureMap } from './descriptor';
export { createLanguageProvider } from './descriptor';

/**
 * Single source of truth for all built-in languages. `LanguageRegistry`
 * iterates this array; adding a language is one descriptor entry here.
 */
export const LANGUAGE_DESCRIPTORS: readonly LanguageDescriptor[] = [
    cDescriptor,
    cppDescriptor,
    csharpDescriptor,
    gdscriptDescriptor,
    goDescriptor,
    javaDescriptor,
    javascriptDescriptor,
    kotlinDescriptor,
    phpDescriptor,
    pythonDescriptor,
    rustDescriptor,
    typescriptDescriptor
];
