#!/usr/bin/env node

/**
 * Ars-note Server Data Backup (v0.8.6)
 *
 * Backs up server-data/ to server-backups/ as a tar.gz archive.
 * Never includes .env, node_modules, or secrets.
 *
 * Usage:
 *   node scripts/ops/backup-server-data.mjs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';

const DATA_DIR = path.resolve('server-data');
const BACKUP_DIR = path.resolve('server-backups');

/* Safety: ensure data directory exists */
if (!fs.existsSync(DATA_DIR)) {
  console.error('ERROR: server-data/ directory not found.');
  console.error('  Expected: ' + DATA_DIR);
  console.error('  Run this script from the server/ directory.');
  process.exit(1);
}

/* Create backup directory */
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/* Generate timestamp filename */
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const filename = `ars-note-server-backup_${ts}.tar.gz`;
const outputPath = path.join(BACKUP_DIR, filename);

/* Build tar command — exclude sensitive files */
const tarArgs = [
  'czf', outputPath,
  '-C', path.dirname(DATA_DIR),
  '--exclude=.env',
  '--exclude=.env.*',
  '--exclude=node_modules',
  '--exclude=*.log',
  path.basename(DATA_DIR),
];

console.log('═══════════════════════════════════════');
console.log('  Ars-note Server Data Backup');
console.log('═══════════════════════════════════════');
console.log(`  Source: ${DATA_DIR}`);
console.log(`  Output: ${outputPath}`);
console.log('');

try {
  child_process.execFileSync('tar', tarArgs, { stdio: 'pipe' });

  const stats = fs.statSync(outputPath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  console.log(`  ✓ Backup created successfully`);
  console.log(`  File: ${filename}`);
  console.log(`  Size: ${sizeMB} MB`);
  console.log(`  Path: ${outputPath}`);
  console.log('');

  /* List existing backups */
  const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.tar.gz')).sort();
  console.log(`  Total backups: ${backups.length}`);

  console.log('═══════════════════════════════════════');
} catch (e) {
  if (e.code === 'ENOENT' && e.path === 'tar') {
    console.error('ERROR: tar command not found. Install tar or use a system with it available.');
  } else {
    console.error('ERROR: Backup failed:', e.message);
  }
  process.exit(1);
}
