import { CodeParser, DeltaGraph } from './types';

/**
 * CompositeParser delegates to the first parser that supports the given file.
 */
export class CompositeParser implements CodeParser {
    constructor(private parsers: CodeParser[]) { }

    public supports(filePath: string): boolean {
        return this.parsers.some(p => p.supports(filePath));
    }

    public async parse(filePath: string, commit: string, version: number): Promise<DeltaGraph> {
        const parser = this.parsers.find(p => p.supports(filePath));
        if (!parser) throw new Error(`No parser found for: ${filePath}`);
        return parser.parse(filePath, commit, version);
    }
}
