import * as ts from 'typescript';
import * as fs from 'fs';
import { CodeParser, DeltaGraph } from './types';
import { CodeNode, CodeEdge, SymbolType, Visibility } from '../types';
import { MetricsCalculator } from './metrics-calculator';

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
            allowJs: true
        });
        this.typeChecker = this.program.getTypeChecker();
    }

    public async parse(filePath: string, commit: string, version: number): Promise<DeltaGraph> {
        this.refreshProgram(filePath);
        const sourceFile = this.program!.getSourceFile(filePath);
        if (!sourceFile) throw new Error(`Source file not found: ${filePath}`);

        const nodes: CodeNode[] = [];
        const edges: CodeEdge[] = [];
        const sourceCode = sourceFile.getFullText();

        // 1. File Node
        const fileNode: CodeNode = {
            qualified_name: filePath,
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
            if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) && (node as any).name) {
                const symbol = this.typeChecker?.getSymbolAtLocation((node as any).name);
                if (symbol) {
                    const qname = this.getName(symbol);
                    const type = this.getSymbolType(node);
                    nodes.push(this.createNode(node, sourceFile, qname, type, filePath, commit, version));

                    // Edge: file -> symbol (defines)
                    edges.push({ from_qname: filePath, to_qname: qname, edge_type: 'defines', dynamic: false } as any);
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
                            from_qname: filePath,
                            to_qname: pkgNodeQName,
                            edge_type: 'depends_on',
                            dynamic: false
                        } as any);
                    }
                }
            }

            // 4. Resolve Calls (Edge Extraction)
            if (ts.isCallExpression(node)) {
                const centerNode = this.findParentSymbol(node);
                const fromQName = centerNode ? this.getName(centerNode) : filePath;
                this.resolveCall(node, sourceFile, fromQName, edges);
            }

            ts.forEachChild(node, visit);
        };

        visit(sourceFile);
        return { nodes, edges };
    }

    private getName(symbol: ts.Symbol): string {
        const parts: string[] = [];
        let current: ts.Symbol | undefined = symbol;
        while (current && current.getName() !== '__export' && current.getName() !== 'default' && !(current.flags & ts.SymbolFlags.Module)) {
            parts.unshift(current.getName());
            current = (current as any).parent;
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
        if (parent && (parent as any).name) {
            return this.typeChecker?.getSymbolAtLocation((parent as any).name);
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

    private resolveCall(node: ts.CallExpression, sourceFile: ts.SourceFile, fromQName: string, edges: CodeEdge[]) {
        const symbol = this.typeChecker?.getSymbolAtLocation(node.expression);
        if (symbol) {
            const declaration = symbol.valueDeclaration || symbol.declarations?.[0];
            if (declaration) {
                const targetFile = declaration.getSourceFile().fileName;
                const targetQName = this.getName(symbol);

                edges.push({
                    from_qname: fromQName,
                    to_qname: targetQName,
                    edge_type: 'calls',
                    dynamic: false,
                    call_site_line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
                    target_file_hint: targetFile
                } as any);
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
            cyclomatic: MetricsCalculator.calculateCyclomaticComplexity(node)
        };
    }

    private getVisibility(node: ts.Node): Visibility {
        const modifiers = ts.getModifiers(node as any);
        if (modifiers) {
            if (modifiers.some(m => m.kind === ts.SyntaxKind.PrivateKeyword)) return 'private';
            if (modifiers.some(m => m.kind === ts.SyntaxKind.ProtectedKeyword)) return 'protected';
        }
        return 'public';
    }

    private calculateChecksum(content: string): string {
        return content.length.toString();
    }
}

