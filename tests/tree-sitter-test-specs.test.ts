/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * P8-1: Test-spec extraction for tree-sitter languages.
 *
 * The TypeScript parser already extracts TestSpec objects (it()/test() blocks,
 * their expect() assertions). P8-1 extends this to the tree-sitter languages via
 * an optional `extractTestSpecs` hook on each LanguageDescriptor. These tests
 * drive the real TreeSitterParser.parse() over temporary fixture files for
 * Python (pytest + unittest), Go, Rust, and Java, and confirm a language without
 * the hook (C) produces no testSpecs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TreeSitterParser } from '../src/indexer/tree-sitter-parser';
import type { TestSpec } from '../src/indexer/types';

let tmpDir: string;
const parser = new TreeSitterParser();

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cynapx-testspecs-'));
});

afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function parseFixture(name: string, content: string): Promise<TestSpec[]> {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, content);
    const delta = await parser.parse(filePath, 'testcommit', 1);
    return delta.testSpecs ?? [];
}

describe('P8-1 tree-sitter test-spec extraction', () => {
    describe('Python', () => {
        it('captures a pytest test_* function with its assert', async () => {
            const specs = await parseFixture('test_pytest.py', [
                'def test_foo():',
                '    x = 1',
                '    assert x == 1',
                '',
            ].join('\n'));

            const foo = specs.find(s => s.title === 'test_foo');
            expect(foo).toBeDefined();
            expect(foo!.assertions.join(' ')).toContain('assert x == 1');
            expect(foo!.startLine).toBe(1);
            expect(foo!.testQname).toContain('#test_foo');
        });

        it('captures a unittest TestCase method with self.assertEqual', async () => {
            const specs = await parseFixture('test_unittest.py', [
                'import unittest',
                '',
                'class TestThing(unittest.TestCase):',
                '    def test_bar(self):',
                '        self.assertEqual(add(1, 2), 3)',
                '',
            ].join('\n'));

            const bar = specs.find(s => s.title === 'test_bar');
            expect(bar).toBeDefined();
            expect(bar!.assertions.join(' ')).toContain('self.assertEqual(add(1, 2), 3)');
            expect(bar!.testQname).toContain('TestThing.test_bar');
        });

        it('does not capture a non-test helper function', async () => {
            const specs = await parseFixture('helpers.py', [
                'def helper():',
                '    return 1',
                '',
            ].join('\n'));

            expect(specs.find(s => s.title === 'helper')).toBeUndefined();
        });
    });

    describe('Go', () => {
        it('captures a Test* function with assertions and subtests', async () => {
            const specs = await parseFixture('add_test.go', [
                'package main',
                '',
                'import "testing"',
                '',
                'func TestAdd(t *testing.T) {',
                '    got := Add(1, 2)',
                '    if got != 3 {',
                '        t.Errorf("bad")',
                '    }',
                '    t.Run("sub", func(t *testing.T) {})',
                '}',
                '',
            ].join('\n'));

            const add = specs.find(s => s.title === 'TestAdd');
            expect(add).toBeDefined();
            const joined = add!.assertions.join(' | ');
            expect(joined).toContain('t.Errorf("bad")');
            expect(joined).toContain('if got != 3');

            const sub = specs.find(s => s.title === 'TestAdd/sub');
            expect(sub).toBeDefined();
            expect(sub!.testQname).toContain('#TestAdd/sub');
        });

        it('ignores a non-test function', async () => {
            const specs = await parseFixture('plain.go', [
                'package main',
                '',
                'func Helper(x int) int { return x }',
                '',
            ].join('\n'));
            expect(specs.length).toBe(0);
        });
    });

    describe('Rust', () => {
        it('captures a #[test] function with assert_eq!', async () => {
            const specs = await parseFixture('lib.rs', [
                '#[test]',
                'fn it_works() {',
                '    assert_eq!(2 + 2, 4);',
                '    assert!(true);',
                '}',
                '',
            ].join('\n'));

            const t = specs.find(s => s.title === 'it_works');
            expect(t).toBeDefined();
            const joined = t!.assertions.join(' | ');
            expect(joined).toContain('assert_eq!(2 + 2, 4)');
            expect(joined).toContain('assert!(true)');
        });

        it('ignores a non-test function', async () => {
            const specs = await parseFixture('plain.rs', [
                'fn helper() -> i32 { 1 }',
                '',
            ].join('\n'));
            expect(specs.length).toBe(0);
        });
    });

    describe('Java', () => {
        it('captures an @Test method with assertEquals', async () => {
            const specs = await parseFixture('FooTest.java', [
                'class FooTest {',
                '    @Test',
                '    public void testX() {',
                '        assertEquals(1, foo());',
                '    }',
                '}',
                '',
            ].join('\n'));

            const x = specs.find(s => s.title === 'testX');
            expect(x).toBeDefined();
            expect(x!.assertions.join(' ')).toContain('assertEquals(1, foo())');
        });

        it('ignores a method without @Test', async () => {
            const specs = await parseFixture('Plain.java', [
                'class Plain {',
                '    public void doThing() {',
                '        assertEquals(1, 1);',
                '    }',
                '}',
                '',
            ].join('\n'));
            expect(specs.length).toBe(0);
        });
    });

    describe('languages without the hook', () => {
        it('produces no testSpecs for a C file', async () => {
            const filePath = path.join(tmpDir, 'main.c');
            fs.writeFileSync(filePath, [
                'int add(int a, int b) { return a + b; }',
                '',
            ].join('\n'));
            const delta = await parser.parse(filePath, 'testcommit', 1);
            expect(delta.testSpecs).toBeUndefined();
        });
    });
});
