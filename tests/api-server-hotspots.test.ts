import { describe, it, expect } from 'vitest';

/**
 * Tests for the SQL injection fix in api-server.ts handleHotspots().
 *
 * The fix introduced an allowedMetrics whitelist to prevent arbitrary column
 * names being interpolated directly into the SQL query.
 *
 * We test the validation logic directly as a unit test, mirroring the exact
 * code in handleHotspots():
 *
 *   const allowedMetrics = ['loc', 'cyclomatic', 'fan_in', 'fan_out', 'fan_in_dynamic', 'fan_out_dynamic'];
 *   if (!metric || !allowedMetrics.includes(metric)) {
 *       return res.status(400).json({ ... });
 *   }
 */

const ALLOWED_METRICS = ['loc', 'cyclomatic', 'fan_in', 'fan_out', 'fan_in_dynamic', 'fan_out_dynamic'];

function validateMetric(metric: string | undefined | null): { valid: boolean; error?: string } {
    if (!metric || !ALLOWED_METRICS.includes(metric)) {
        return {
            valid: false,
            error: `Invalid metric. Allowed: ${ALLOWED_METRICS.join(', ')}`,
        };
    }
    return { valid: true };
}

describe('API Server - handleHotspots metric validation (SQL injection fix)', () => {
    describe('valid metrics', () => {
        it.each(ALLOWED_METRICS)('should accept valid metric "%s"', (metric) => {
            const result = validateMetric(metric);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });
    });

    describe('invalid / injection metrics', () => {
        it('should reject undefined metric', () => {
            expect(validateMetric(undefined).valid).toBe(false);
        });

        it('should reject null metric', () => {
            expect(validateMetric(null).valid).toBe(false);
        });

        it('should reject empty string', () => {
            expect(validateMetric('').valid).toBe(false);
        });

        it('should reject SQL injection attempt: "1 OR 1=1"', () => {
            expect(validateMetric('1 OR 1=1').valid).toBe(false);
        });

        it('should reject SQL injection attempt with DROP TABLE', () => {
            expect(validateMetric('loc; DROP TABLE nodes;--').valid).toBe(false);
        });

        it('should reject SQL injection with UNION SELECT', () => {
            expect(validateMetric('loc UNION SELECT * FROM nodes--').valid).toBe(false);
        });

        it('should reject a metric that looks like a column with comment', () => {
            expect(validateMetric('loc--').valid).toBe(false);
        });

        it('should reject an arbitrary unknown metric name', () => {
            expect(validateMetric('unknown_column').valid).toBe(false);
        });

        it('should reject metric with leading/trailing whitespace (exact match required)', () => {
            expect(validateMetric(' loc').valid).toBe(false);
            expect(validateMetric('loc ').valid).toBe(false);
        });

        it('should reject metric with different casing (exact match required)', () => {
            expect(validateMetric('LOC').valid).toBe(false);
            expect(validateMetric('Cyclomatic').valid).toBe(false);
        });
    });

    describe('error message content', () => {
        it('should include all allowed metrics in the error message', () => {
            const result = validateMetric('bad_metric');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('loc');
            expect(result.error).toContain('cyclomatic');
            expect(result.error).toContain('fan_in');
            expect(result.error).toContain('fan_out');
        });
    });
});
