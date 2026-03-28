import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { calculateChecksum, calculateFileChecksum } from '../src/utils/checksum';

describe('checksum utilities', () => {
    describe('calculateChecksum', () => {
        it('should return a non-empty hex string', () => {
            const result = calculateChecksum('hello');
            expect(result).toMatch(/^[a-f0-9]+$/);
        });

        it('should compute the correct SHA-1 hash for "hello"', () => {
            // SHA-1 of "hello" is aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d
            expect(calculateChecksum('hello')).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
        });

        it('should compute the correct SHA-1 hash for an empty string', () => {
            // SHA-1 of "" is da39a3ee5e6b4b0d3255bfef95601890afd80709
            expect(calculateChecksum('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
        });

        it('should produce consistent results for the same input', () => {
            const input = 'consistency check input';
            expect(calculateChecksum(input)).toBe(calculateChecksum(input));
        });

        it('should produce different hashes for different inputs', () => {
            expect(calculateChecksum('input-a')).not.toBe(calculateChecksum('input-b'));
        });

        it('should produce a 40-character hex string (SHA-1 length)', () => {
            const result = calculateChecksum('test string for length check');
            expect(result).toHaveLength(40);
        });

        it('should handle longer inputs correctly', () => {
            const longInput = 'a'.repeat(10000);
            const result = calculateChecksum(longInput);
            expect(result).toHaveLength(40);
            expect(result).toMatch(/^[a-f0-9]+$/);
        });

        it('should be case-sensitive in input', () => {
            expect(calculateChecksum('Hello')).not.toBe(calculateChecksum('hello'));
        });
    });

    describe('calculateFileChecksum', () => {
        const tmpDir = os.tmpdir();
        const testFilePath = path.join(tmpDir, `cynapx-checksum-test-${process.pid}.txt`);

        afterEach(() => {
            if (fs.existsSync(testFilePath)) {
                fs.unlinkSync(testFilePath);
            }
        });

        it('should return empty string for a non-existent file', () => {
            const nonExistent = path.join(tmpDir, 'this-file-does-not-exist-cynapx.txt');
            expect(calculateFileChecksum(nonExistent)).toBe('');
        });

        it('should return the same checksum as calculateChecksum for the file contents', () => {
            const content = 'test file content for checksum';
            fs.writeFileSync(testFilePath, content, 'utf8');

            const fileChecksum = calculateFileChecksum(testFilePath);
            const stringChecksum = calculateChecksum(content);

            expect(fileChecksum).toBe(stringChecksum);
        });

        it('should return a 40-character hex string for a valid file', () => {
            fs.writeFileSync(testFilePath, 'some content', 'utf8');
            const result = calculateFileChecksum(testFilePath);
            expect(result).toHaveLength(40);
            expect(result).toMatch(/^[a-f0-9]+$/);
        });

        it('should be consistent across multiple calls for the same file', () => {
            fs.writeFileSync(testFilePath, 'stable content', 'utf8');
            const first = calculateFileChecksum(testFilePath);
            const second = calculateFileChecksum(testFilePath);
            expect(first).toBe(second);
        });

        it('should return a different checksum when file content changes', () => {
            fs.writeFileSync(testFilePath, 'original content', 'utf8');
            const original = calculateFileChecksum(testFilePath);

            fs.writeFileSync(testFilePath, 'modified content', 'utf8');
            const modified = calculateFileChecksum(testFilePath);

            expect(original).not.toBe(modified);
        });

        it('should handle an empty file', () => {
            fs.writeFileSync(testFilePath, '', 'utf8');
            const result = calculateFileChecksum(testFilePath);
            // Empty string SHA-1
            expect(result).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
        });
    });
});
