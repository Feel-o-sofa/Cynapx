/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */
import { Database } from 'better-sqlite3';

export class MetadataRepository {
    constructor(private db: Database) { }

    public getValue(key: string): string | undefined {
        const row = this.db.prepare('SELECT value FROM index_metadata WHERE key = ?').get(key) as { value: string } | undefined;
        return row?.value;
    }

    public setValue(key: string, value: string): void {
        this.db.prepare('INSERT OR REPLACE INTO index_metadata (key, value) VALUES (?, ?)').run(key, value);
    }

    public getLastIndexedCommit(): string | undefined {
        return this.getValue('last_indexed_commit');
    }

    public setLastIndexedCommit(commit: string): void {
        this.setValue('last_indexed_commit', commit);
    }

    public getTotalCallsCount(): number {
        const val = this.getValue('total_calls_count');
        return val ? parseInt(val, 10) : 0;
    }

    public getTotalDynamicCallsCount(): number {
        const val = this.getValue('total_dynamic_calls_count');
        return val ? parseInt(val, 10) : 0;
    }

    public getLedgerStats() {
        const metadata = {
            total_calls_count: this.getTotalCallsCount(),
            total_dynamic_calls_count: this.getTotalDynamicCallsCount()
        };

        const actual = this.db.prepare(`
            SELECT 
                SUM(fan_in) as sum_fan_in, 
                SUM(fan_out) as sum_fan_out,
                SUM(fan_in_dynamic) as sum_fan_in_dynamic,
                SUM(fan_out_dynamic) as sum_fan_out_dynamic
            FROM nodes
        `).get() as { 
            sum_fan_in: number, 
            sum_fan_out: number, 
            sum_fan_in_dynamic: number, 
            sum_fan_out_dynamic: number 
        };

        return {
            metadata,
            actual: {
                sum_fan_in: actual.sum_fan_in || 0,
                sum_fan_out: actual.sum_fan_out || 0,
                sum_fan_in_dynamic: actual.sum_fan_in_dynamic || 0,
                sum_fan_out_dynamic: actual.sum_fan_out_dynamic || 0
            }
        };
    }
}
