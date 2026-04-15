#!/usr/bin/env node
/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 *
 * cynapx-admin — Organisation management CLI
 * Reads project registry and SQLite DBs directly; no server required.
 *
 * Usage:
 *   npx ts-node src/cli/admin.ts [command]
 *   node dist/cli/admin.js [command]
 *
 * Commands:
 *   status           Dashboard overview of all registered projects (default)
 *   list             Compact table of all projects
 *   inspect <name>   Detailed stats for one project
 *   doctor           Detect and report stale/broken registry entries
 *   reindex <name>   Trigger full reindex (starts server briefly)
 *   purge <name>     Delete index DB files for a project
 *   unregister <name> Remove a project from the registry
 *   compact          Run VACUUM on all project DBs to reclaim disk space
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Command } from 'commander';
import Database from 'better-sqlite3';
import {
    readRegistry,
    getRegistryPath,
    getDatabasePath,
    ProjectEntry
} from '../utils/paths';
import { AuditLogger, AuditEvent } from '../utils/audit-logger';

// ─── ANSI colour helpers ──────────────────────────────────────────────────────
const c = {
    reset: '\x1b[0m',
    bold:  '\x1b[1m',
    dim:   '\x1b[2m',
    red:   '\x1b[31m',
    green: '\x1b[32m',
    yellow:'\x1b[33m',
    cyan:  '\x1b[36m',
    white: '\x1b[37m',
};

function bold(s: string)   { return `${c.bold}${s}${c.reset}`; }
function dim(s: string)    { return `${c.dim}${s}${c.reset}`; }
function green(s: string)  { return `${c.green}${s}${c.reset}`; }
function yellow(s: string) { return `${c.yellow}${s}${c.reset}`; }
function red(s: string)    { return `${c.red}${s}${c.reset}`; }
function cyan(s: string)   { return `${c.cyan}${s}${c.reset}`; }

// ─── Helper utilities ─────────────────────────────────────────────────────────

function dbSizeMB(dbPath: string): string {
    try {
        const stat = fs.statSync(dbPath);
        return (stat.size / (1024 * 1024)).toFixed(1) + ' MB';
    } catch {
        return '—';
    }
}

function isStale(entry: ProjectEntry): boolean {
    if (!fs.existsSync(entry.path)) return true;
    if (!fs.existsSync(entry.db_path)) return true;
    return false;
}

function statusBadge(entry: ProjectEntry): string {
    return isStale(entry) ? red('STALE') : green('OK');
}

function openDb(dbPath: string): Database.Database | null {
    try {
        return new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch {
        return null;
    }
}

function getDbStats(dbPath: string): { nodeCount: number; edgeCount: number; version: string; indexedAt: string } {
    const db = openDb(dbPath);
    if (!db) return { nodeCount: 0, edgeCount: 0, version: '—', indexedAt: '—' };
    try {
        const nodes = (db.prepare('SELECT COUNT(*) as c FROM nodes').get() as { c: number }).c;
        const edges = (db.prepare('SELECT COUNT(*) as c FROM edges').get() as { c: number }).c;
        const verRow = db.prepare("SELECT value FROM index_metadata WHERE key = 'cynapx_version'").get() as { value: string } | undefined;
        const atRow  = db.prepare("SELECT value FROM index_metadata WHERE key = 'indexed_at'").get() as { value: string } | undefined;
        return {
            nodeCount: nodes,
            edgeCount: edges,
            version: verRow?.value || '—',
            indexedAt: atRow?.value || '—'
        };
    } catch {
        return { nodeCount: 0, edgeCount: 0, version: '—', indexedAt: '—' };
    } finally {
        db.close();
    }
}

function padEnd(s: string, len: number): string {
    return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function hr(width = 72): string {
    return dim('─'.repeat(width));
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdStatus(): void {
    const registry = readRegistry();
    if (registry.length === 0) {
        console.log(yellow('No projects registered. Run `initialize_project` in an MCP session first.'));
        return;
    }

    console.log('');
    console.log(bold(`  Cynapx Admin  ${dim('— ' + registry.length + ' project(s) registered')}`));
    console.log(hr());

    for (const entry of registry) {
        const stale = isStale(entry);
        const stats = stale ? null : getDbStats(entry.db_path);
        const badge = stale ? red(' STALE ') : green('  OK   ');

        console.log(`  [${badge}]  ${bold(entry.name)}`);
        console.log(`           ${dim('Path:')}    ${entry.path}`);
        console.log(`           ${dim('DB:')}      ${entry.db_path}  ${dim('(' + dbSizeMB(entry.db_path) + ')')}`);
        if (stats) {
            console.log(`           ${dim('Index:')}   ${stats.nodeCount} nodes, ${stats.edgeCount} edges  ${dim('v' + stats.version)}`);
            console.log(`           ${dim('Indexed:')} ${stats.indexedAt || '—'}`);
        }
        console.log(`           ${dim('Accessed:')} ${entry.last_accessed_at}`);
        console.log('');
    }

    const staleCount = registry.filter(isStale).length;
    if (staleCount > 0) {
        console.log(yellow(`  ⚠  ${staleCount} stale entry(ies) detected. Run \`doctor\` to clean up.`));
    }
    console.log(dim(`  Registry: ${getRegistryPath()}`));
    console.log('');
}

function cmdList(): void {
    const registry = readRegistry();
    if (registry.length === 0) {
        console.log(yellow('No projects registered.'));
        return;
    }

    const nameW  = 20;
    const pathW  = 40;
    const nodeW  = 8;
    const verW   = 8;

    const header =
        padEnd('Name', nameW) + '  ' +
        padEnd('Path', pathW) + '  ' +
        padEnd('Nodes', nodeW) + '  ' +
        padEnd('Version', verW) + '  Status';
    console.log('');
    console.log(bold('  ' + header));
    console.log('  ' + hr(header.length));

    for (const entry of registry) {
        const stale = isStale(entry);
        const stats = stale ? null : getDbStats(entry.db_path);
        const name  = entry.name.slice(0, nameW - 1);
        const pth   = entry.path.slice(0, pathW - 1);
        const nodes = stats ? String(stats.nodeCount) : '—';
        const ver   = stats?.version ?? '—';
        const badge = stale ? red('STALE') : green('OK');

        console.log(
            '  ' + padEnd(name, nameW) + '  ' +
            padEnd(pth, pathW) + '  ' +
            padEnd(nodes, nodeW) + '  ' +
            padEnd(ver, verW) + '  ' +
            badge
        );
    }
    console.log('');
}

function cmdInspect(name: string): void {
    const registry = readRegistry();
    const entry = registry.find(e => e.name.toLowerCase() === name.toLowerCase() || e.path === name);
    if (!entry) {
        console.error(red(`Project '${name}' not found in registry.`));
        process.exit(1);
    }

    const stale = isStale(entry);
    const stats = stale ? null : getDbStats(entry.db_path);

    console.log('');
    console.log(bold(`  Project: ${entry.name}`));
    console.log(hr());
    console.log(`  ${dim('Status:')}      ${statusBadge(entry)}`);
    console.log(`  ${dim('Path:')}        ${entry.path}`);
    console.log(`  ${dim('DB Path:')}     ${entry.db_path}`);
    console.log(`  ${dim('DB Size:')}     ${dbSizeMB(entry.db_path)}`);

    if (stats) {
        console.log(`  ${dim('Nodes:')}       ${stats.nodeCount}`);
        console.log(`  ${dim('Edges:')}       ${stats.edgeCount}`);
        console.log(`  ${dim('Version:')}     ${stats.version}`);
        console.log(`  ${dim('Indexed At:')}  ${stats.indexedAt}`);
    } else {
        console.log(`  ${yellow('Index data unavailable (DB missing or project path gone).')}`);
    }

    console.log(`  ${dim('Last Access:')} ${entry.last_accessed_at}`);

    // Show recent audit events for this project
    const audit = new AuditLogger();
    const events: AuditEvent[] = audit.readRecent(500).filter(
        e => e.project === entry.path || e.projectPath === entry.path
    ).slice(-10);

    if (events.length > 0) {
        console.log('');
        console.log(`  ${bold('Recent audit events:')}`);
        for (const ev of events) {
            console.log(`    ${dim(ev.timestamp)}  ${cyan(ev.event)}`);
        }
    }
    console.log('');
}

function cmdDoctor(): void {
    const registry = readRegistry();
    if (registry.length === 0) {
        console.log(yellow('No projects registered.'));
        return;
    }

    const issues: string[] = [];
    console.log('');
    console.log(bold('  Cynapx Doctor'));
    console.log(hr());

    for (const entry of registry) {
        if (!fs.existsSync(entry.path)) {
            issues.push(`Project path not found: ${entry.path}`);
            console.log(`  ${red('✗')} ${entry.name}  ${dim(entry.path)}`);
            console.log(`      ${red('Project directory does not exist.')}`);
        } else if (!fs.existsSync(entry.db_path)) {
            issues.push(`DB file missing for: ${entry.name}`);
            console.log(`  ${yellow('!')} ${entry.name}  ${dim(entry.path)}`);
            console.log(`      ${yellow('DB file missing — run initialize_project to rebuild.')}`);
        } else {
            console.log(`  ${green('✓')} ${entry.name}`);
        }
    }

    console.log('');
    if (issues.length === 0) {
        console.log(green('  All projects are healthy.'));
    } else {
        console.log(red(`  ${issues.length} issue(s) found.`));
        console.log(dim('  Use `cynapx-admin unregister <name>` to remove stale entries.'));
    }
    console.log('');
}

function cmdPurge(name: string, opts: { yes?: boolean }): void {
    const registry = readRegistry();
    const entry = registry.find(e => e.name.toLowerCase() === name.toLowerCase() || e.path === name);
    if (!entry) {
        console.error(red(`Project '${name}' not found in registry.`));
        process.exit(1);
    }

    if (!opts.yes) {
        console.log(yellow(`This will DELETE the index database for '${entry.name}'.`));
        console.log(yellow(`Re-run with --yes to confirm.`));
        return;
    }

    const targets = [entry.db_path, `${entry.db_path}-wal`, `${entry.db_path}-shm`];
    let deleted = 0;
    for (const t of targets) {
        if (fs.existsSync(t)) {
            fs.unlinkSync(t);
            deleted++;
        }
    }

    new AuditLogger().log('purge', { project: entry.path });
    console.log(green(`✓ Purged ${deleted} file(s) for project '${entry.name}'.`));
}

function cmdUnregister(name: string, opts: { yes?: boolean }): void {
    const registry = readRegistry();
    const entry = registry.find(e => e.name.toLowerCase() === name.toLowerCase() || e.path === name);
    if (!entry) {
        console.error(red(`Project '${name}' not found in registry.`));
        process.exit(1);
    }

    if (!opts.yes) {
        console.log(yellow(`This will remove '${entry.name}' from the registry (DB files kept).`));
        console.log(yellow(`Re-run with --yes to confirm.`));
        return;
    }

    const newRegistry = registry.filter(e => e !== entry);
    const registryPath = getRegistryPath();
    const tmpPath = registryPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(newRegistry, null, 2), 'utf8');
    fs.renameSync(tmpPath, registryPath);

    new AuditLogger().log('unregister', { project: entry.path });
    console.log(green(`✓ Removed '${entry.name}' from registry.`));
}

function cmdCompact(opts: { yes?: boolean }): void {
    const registry = readRegistry();
    if (registry.length === 0) {
        console.log(yellow('No projects registered.'));
        return;
    }

    if (!opts.yes) {
        console.log(yellow('This will VACUUM all project databases (may take a while for large projects).'));
        console.log(yellow('Re-run with --yes to confirm.'));
        return;
    }

    let total = 0;
    for (const entry of registry) {
        if (!fs.existsSync(entry.db_path)) {
            console.log(dim(`  Skipping ${entry.name} (DB missing)`));
            continue;
        }
        try {
            const sizeBefore = fs.statSync(entry.db_path).size;
            const db = new Database(entry.db_path);
            db.pragma('wal_checkpoint(TRUNCATE)');
            db.exec('VACUUM');
            db.close();
            const sizeAfter = fs.statSync(entry.db_path).size;
            const savedMB = ((sizeBefore - sizeAfter) / (1024 * 1024)).toFixed(1);
            console.log(green(`  ✓ ${entry.name}`) + dim(`  saved ${savedMB} MB`));
            total += Math.max(0, sizeBefore - sizeAfter);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(red(`  ✗ ${entry.name}: ${msg}`));
        }
    }
    console.log('');
    console.log(bold(`  Total reclaimed: ${(total / (1024 * 1024)).toFixed(1)} MB`));
}

// ─── CLI setup ────────────────────────────────────────────────────────────────

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8')) as { version: string };

const program = new Command();

program
    .name('cynapx-admin')
    .description('Cynapx organisation management CLI — no server required')
    .version(pkg.version);

// Default command — status dashboard
program
    .command('status', { isDefault: true })
    .description('Show dashboard overview of all registered projects')
    .action(() => cmdStatus());

program
    .command('list')
    .description('Compact table of all registered projects')
    .action(() => cmdList());

program
    .command('inspect <name>')
    .description('Detailed stats for one project (name or path)')
    .action((name: string) => cmdInspect(name));

program
    .command('doctor')
    .description('Detect stale or broken registry entries')
    .action(() => cmdDoctor());

program
    .command('purge <name>')
    .description('Delete index database files for a project')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action((name: string, opts: { yes?: boolean }) => cmdPurge(name, opts));

program
    .command('unregister <name>')
    .description('Remove a project from the registry (DB files kept)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action((name: string, opts: { yes?: boolean }) => cmdUnregister(name, opts));

program
    .command('compact')
    .description('Run VACUUM on all project databases to reclaim disk space')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action((opts: { yes?: boolean }) => cmdCompact(opts));

program.parse(process.argv);
