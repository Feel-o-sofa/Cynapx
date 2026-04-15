/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import * as ts from 'typescript';
import * as fs from 'fs';
import { CodeParser, DeltaGraph, RawCodeEdge } from './types';

/** Augments ts.Symbol with the optional `parent` property used internally by the TS compiler */
interface SymbolWithParent extends ts.Symbol {
    parent?: ts.Symbol;
}
import { CodeNode, SymbolType, Visibility } from '../types';
import { MetricsCalculator } from './metrics-calculator';
import { calculateChecksum } from '../utils/checksum';
import { toCanonical } from '../utils/paths';

export class TypeScriptParser implements CodeParser {
    private program: ts.Program | null = null;
    private typeChecker: ts.TypeChecker | null = null;

    public supports(filePath: string): boolean {
        return filePath.endsWith('.ts') || filePath.endsWith('.js');
    }

    /**
     * Initializes a TypeScript program for the given file to enable semantic analysis.
     */
    private refreshProgram(filePath: string): void {
        this.program = ts.createProgram([filePath], {
            target: ts.ScriptTarget.Latest,
            module: ts.ModuleKind.CommonJS,
            esModuleInterop: true,
            allowJs: true,
            skipLibCheck: true,
            noEmit: true,
            types: [],
            lib: ['lib.esnext.d.ts']
        });
        this.typeChecker = this.program.getTypeChecker();
    }

    public async parse(filePath: string, commit: string, version: number): Promise<DeltaGraph> {
        this.refreshProgram(filePath);
        const sourceFile = this.program!.getSourceFile(filePath);
        if (!sourceFile) throw new Error(`Source file not found: ${filePath}`);

        const nodes: CodeNode[] = [];
        const edges: RawCodeEdge[] = [];
        const sourceCode = sourceFile.getFullText();
        const canonicalFilePath = toCanonical(filePath);

        // 1. File Node
        const fileNode: CodeNode = {
            qualified_name: canonicalFilePath,
            symbol_type: 'file',
            language: 'typescript',
            file_path: filePath,
            start_line: 1,
            end_line: sourceCode.split('\n').length,
            visibility: 'public',
            is_generated: false,
            last_updated_commit: commit,
            version: version,
            checksum: this.calculateChecksum(sourceCode),
            loc: sourceCode.split('\n').length
        };
        nodes.push(fileNode);

        const visit = (node: ts.Node) => {
            // 2. Define Symbols (Node Extraction)
            if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) && (node as ts.NamedDeclaration).name) {
                const symbol = this.typeChecker?.getSymbolAtLocation((node as ts.NamedDeclaration).name!);
                if (symbol) {
                    const qname = toCanonical(this.getName(symbol));
                    const type = this.getSymbolType(node);
                    nodes.push(this.createNode(node, sourceFile, qname, type, filePath, commit, version));

                    // Edge: file -> symbol (defines)
                    edges.push({
                        from_qname: canonicalFilePath,
                        to_qname: qname,
                        edge_type: 'defines',
                        dynamic: false
                    });

                    // Edge: class -> method/property (contains)
                    if (ts.isMethodDeclaration(node) &&
                        (ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent))) {
                        const parentClass = node.parent;
                        if (parentClass.name) {
                            const classSymbol = this.typeChecker?.getSymbolAtLocation(parentClass.name);
                            if (classSymbol) {
                                const classQName = toCanonical(this.getName(classSymbol));
                                edges.push({
                                    from_qname: classQName,
                                    to_qname: qname,
                                    edge_type: 'contains',
                                    dynamic: false
                                });
                            }
                        }

                        // Edge: method -> parent method (overrides)
                        const heritageClause = parentClass.heritageClauses?.find(
                            c => c.token === ts.SyntaxKind.ExtendsKeyword
                        );
                        if (heritageClause && heritageClause.types.length > 0) {
                            const methodName = (node.name as ts.Identifier).text;
                            const parentType = this.typeChecker?.getTypeAtLocation(heritageClause.types[0]);
                            const parentPropSymbol = parentType?.getProperty(methodName);
                            if (parentPropSymbol) {
                                const parentDecl = parentPropSymbol.valueDeclaration ?? parentPropSymbol.declarations?.[0];
                                if (parentDecl) {
                                    const parentFile = parentDecl.getSourceFile().fileName;
                                    const parentClassSymbol = parentType?.symbol;
                                    if (parentClassSymbol) {
                                        const parentClassQName = toCanonical(this.getName(parentClassSymbol));
                                        const parentMethodQName = `${parentClassQName}.${methodName}`;
                                        edges.push({
                                            from_qname: qname,
                                            to_qname: parentMethodQName,
                                            edge_type: 'overrides',
                                            dynamic: false,
                                            target_file_hint: parentFile
                                        });
                                    }
                                }
                            }
                        }
                    }

                    // OOP Relationships (inherits / implements)
                    if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
                        if (node.heritageClauses) {
                            for (const clause of node.heritageClauses) {
                                const edgeType = clause.token === ts.SyntaxKind.ExtendsKeyword ? 'inherits' : 'implements';
                                for (const typeNode of clause.types) {
                                    const typeSymbol = this.typeChecker?.getSymbolAtLocation(typeNode.expression);
                                    if (typeSymbol) {
                                        edges.push({
                                            from_qname: qname,
                                            to_qname: toCanonical(this.getName(typeSymbol)),
                                            edge_type: edgeType,
                                            dynamic: false
                                        });
                                    } else {
                                        // Fallback to text if symbol cannot be resolved (e.g. external)
                                        edges.push({
                                            from_qname: qname,
                                            to_qname: typeNode.expression.getText(),
                                            edge_type: edgeType,
                                            dynamic: false
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // 3. Resolve Imports (Dependency Extraction - Task 4)
            if (ts.isImportDeclaration(node)) {
                const moduleSpecifier = node.moduleSpecifier;
                if (ts.isStringLiteral(moduleSpecifier)) {
                    const pkgName = moduleSpecifier.text;
                    // Only link to external packages (not relative imports)
                    if (!pkgName.startsWith('.')) {
                        const pkgNodeQName = `package:${pkgName}`;
                        edges.push({
                            from_qname: canonicalFilePath,
                            to_qname: pkgNodeQName,
                            edge_type: 'depends_on',
                            dynamic: false
                        });
                    }
                }
            }

            // 4. Resolve Calls (Edge Extraction)
            if (ts.isCallExpression(node)) {
                const centerNode = this.findParentSymbol(node);
                const fromQName = centerNode ? toCanonical(this.getName(centerNode)) : canonicalFilePath;

                // Detect `something.method.bind(this)` pattern.
                // The outer call is to Function.prototype.bind; the actual callee is
                // the property access expression that precedes `.bind`.  We resolve
                // that inner expression instead so a proper `calls` edge is emitted.
                if (
                    ts.isPropertyAccessExpression(node.expression) &&
                    node.expression.name.text === 'bind' &&
                    ts.isPropertyAccessExpression(node.expression.expression)
                ) {
                    const actualCallee = node.expression.expression;
                    const symbol = this.typeChecker?.getSymbolAtLocation(actualCallee);
                    if (symbol) {
                        const declaration = symbol.valueDeclaration || symbol.declarations?.[0];
                        if (declaration) {
                            edges.push({
                                from_qname: fromQName,
                                to_qname: toCanonical(this.getName(symbol)),
                                edge_type: 'calls',
                                dynamic: false,
                                call_site_line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                                target_file_hint: declaration.getSourceFile().fileName
                            });
                        }
                    }
                } else {
                    this.resolveCall(node, sourceFile, fromQName, edges);
                }
            }

            ts.forEachChild(node, visit);
        };

        visit(sourceFile);

        if (this.isTestFile(filePath)) {
            this.emitTestEdges(sourceFile, filePath, canonicalFilePath, edges);
        }

        return { nodes, edges };
    }

    private isTestFile(filePath: string): boolean {
        // Match *.test.ts, *.test.js, *.spec.ts, *.spec.js and tsx/jsx variants
        if (/\.(test|spec)\.(ts|js|tsx|jsx)$/.test(filePath)) {
            return true;
        }
        // Match paths containing /__tests__/ or \__tests__\
        if (filePath.includes('/__tests__/') || filePath.includes('\\__tests__\\')) {
            return true;
        }
        return false;
    }

    private inferProductionFilePath(testFilePath: string): string | null {
        // foo.test.ts → foo.ts, foo.spec.tsx → foo.tsx, etc.
        const testSpecMatch = testFilePath.match(/^(.*)\.(test|spec)\.(ts|js|tsx|jsx)$/);
        if (testSpecMatch) {
            return `${testSpecMatch[1]}.${testSpecMatch[3]}`;
        }
        // path/__tests__/foo.ts → path/foo.ts
        const testsDir = testFilePath.replace('/__tests__/', '/').replace('\\__tests__\\', '\\');
        if (testsDir !== testFilePath) {
            return testsDir;
        }
        return null;
    }

    private emitTestEdges(sourceFile: ts.SourceFile, testFilePath: string, testFileQname: string, edges: RawCodeEdge[]): void {
        const prodFilePath = this.inferProductionFilePath(testFilePath);
        if (prodFilePath === null) return;

        const prodFileQname = toCanonical(prodFilePath);

        // Always emit a file-level tests edge
        edges.push({
            from_qname: testFileQname,
            to_qname: prodFileQname,
            edge_type: 'tests',
            dynamic: false
        });

        // Walk AST looking for describe(...) calls
        const walkForDescribe = (node: ts.Node) => {
            if (
                ts.isCallExpression(node) &&
                ts.isIdentifier(node.expression) &&
                node.expression.text === 'describe' &&
                node.arguments.length > 0 &&
                ts.isStringLiteral(node.arguments[0])
            ) {
                const describeName = (node.arguments[0] as ts.StringLiteral).text;
                edges.push({
                    from_qname: testFileQname,
                    to_qname: `${prodFileQname}#${describeName}`,
                    edge_type: 'tests',
                    dynamic: false,
                    target_file_hint: prodFilePath
                });
            }
            ts.forEachChild(node, walkForDescribe);
        };

        walkForDescribe(sourceFile);
    }

    private getName(symbol: ts.Symbol): string {
        const parts: string[] = [];
        let current: ts.Symbol | undefined = symbol;
        while (current && current.getName() !== '__export' && current.getName() !== 'default' && !(current.flags & ts.SymbolFlags.Module)) {
            parts.unshift(current.getName());
            current = (current as SymbolWithParent).parent;
        }

        const decl = symbol.valueDeclaration || symbol.declarations?.[0];
        const fileName = decl?.getSourceFile().fileName || '';
        return `${fileName}#${parts.join('.')}`;
    }

    private findParentSymbol(node: ts.Node): ts.Symbol | undefined {
        let parent = node.parent;
        while (parent && !ts.isClassDeclaration(parent) && !ts.isMethodDeclaration(parent) && !ts.isFunctionDeclaration(parent)) {
            parent = parent.parent;
        }
        if (parent && 'name' in parent && (parent as ts.NamedDeclaration).name) {
            return this.typeChecker?.getSymbolAtLocation((parent as ts.NamedDeclaration).name!);
        }
        return undefined;
    }

    private getSymbolType(node: ts.Node): SymbolType {
        if (ts.isClassDeclaration(node)) return 'class';
        if (ts.isInterfaceDeclaration(node)) return 'interface';
        if (ts.isMethodDeclaration(node)) return 'method';
        if (ts.isFunctionDeclaration(node)) return 'function';
        return 'field';
    }

    private resolveCall(node: ts.CallExpression, sourceFile: ts.SourceFile, fromQName: string, edges: RawCodeEdge[]) {
        const symbol = this.typeChecker?.getSymbolAtLocation(node.expression);
        if (symbol) {
            const declaration = symbol.valueDeclaration || symbol.declarations?.[0];
            if (declaration) {
                const targetFile = declaration.getSourceFile().fileName;
                const targetQName = toCanonical(this.getName(symbol));

                edges.push({
                    from_qname: fromQName,
                    to_qname: targetQName,
                    edge_type: 'calls',
                    dynamic: false,
                    call_site_line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                    target_file_hint: targetFile
                });
            }
        }
    }

    private createNode(
        node: ts.Node,
        sourceFile: ts.SourceFile,
        qname: string,
        type: SymbolType,
        filePath: string,
        commit: string,
        version: number
    ): CodeNode {
        const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

        let signature: string | undefined;
        let returnType: string | undefined;
        let fieldType: string | undefined;
        const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node)?.map(m => m.getText()) : undefined;

        if (this.typeChecker) {
            if (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isMethodSignature(node)) {
                const nameNode = (node as ts.NamedDeclaration).name;
                if (nameNode) {
                    const tsSymbol = this.typeChecker.getSymbolAtLocation(nameNode);
                    if (tsSymbol) {
                        const tsType = this.typeChecker.getTypeOfSymbolAtLocation(tsSymbol, nameNode);
                        const signatures = tsType.getCallSignatures();
                        if (signatures.length > 0) {
                            signature = this.typeChecker.signatureToString(signatures[0]);
                            returnType = this.typeChecker.typeToString(signatures[0].getReturnType());
                        }
                    }
                }
            } else if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) || ts.isVariableDeclaration(node)) {
                const tsType = this.typeChecker.getTypeAtLocation(node);
                fieldType = this.typeChecker.typeToString(tsType);
            }
        }

        return {
            qualified_name: qname,
            symbol_type: type,
            language: 'typescript',
            file_path: filePath,
            start_line: startLine + 1,
            end_line: endLine + 1,
            visibility: this.getVisibility(node),
            is_generated: false,
            last_updated_commit: commit,
            version: version,
            loc: endLine - startLine + 1,
            cyclomatic: MetricsCalculator.calculateCyclomaticComplexity(node),
            signature,
            return_type: returnType,
            field_type: fieldType,
            modifiers
        };
    }

    private getVisibility(node: ts.Node): Visibility {
        const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
        if (modifiers) {
            if (modifiers.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)) return 'private';
            if (modifiers.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)) return 'protected';
        }
        return 'public';
    }

    private calculateChecksum(content: string): string {
        return calculateChecksum(content);
    }
}

