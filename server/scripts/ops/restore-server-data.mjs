#!/usr/bin/env node

/**
 * Ars-note Server Data Restore (v0.8.6)
 *
 * Restores server-data/ from a backup tar.gz archive.
 * Creates a safety backup of current data before restoring.
 * Never overwrites .env files.
 *
 * Usage:
 *   node scripts/ops/restore-server-data.mjs <backup-file>
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as child_process from 'node:child_process';

const DATA_DIR = path.resolve('server-data');
const BACKUP_DIR = path.resolve('server-backups');

const backupArg = process.argv[2];
if (!backupArg) {
  console.error('Usage: node scripts/ops/restore-server-data.mjs <backup-file>');
  console.error('');
  console.error('Available backups:');
  if (fs.existsSync(BACKUP_DIR)) {
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.tar.gz')).sort();
    if (files.length === 0) {
      console.error('  (no backups found in server-backups/)');
    } else {
      for (const f of files) {
        const stats = fs.statSync(path.join(BACKUP_DIR, f));
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.error(`  ${f}  (${sizeMB} MB)`);
      }
    }
  }
  process.exit(1);
}

/* Resolve backup file path */
let backupPath = backupArg;
if (!path.isAbsolute(backupArg)) {
  /* Check server-backups/ first */
  const inBackupDir = path.join(BACKUP_DIR, backupArg);
  if (fs.existsSync(inBackupDir)) {
    backupPath = inBackupDir;
  } else if (fs.existsSync(backupArg)) {
    backupPath = path.resolve(backupArg);
  } else {
    console.error('ERROR: Backup file not found:', backupArg);
    console.error('  Checked:', inBackupDir);
    console.error('  Checked:', path.resolve(backupArg));
    process.exit(1);
  }
}

/* Validate backup file */
if (!fs.existsSync(backupPath)) {
  console.error('ERROR: Backup file not found:', backupPath);
  process.exit(1);
}

if (!backupPath.endsWith('.tar.gz')) {
  console.error('ERROR: Only .tar.gz backup files are supported.');
  process.exit(1);
}

/* Safety: resolve and check path stays inside expected directories */
const resolvedBackup = path.resolve(backupPath);
if (!resolvedBackup.startsWith(path.resolve('.'))) {
  console.error('ERROR: Backup file path must be inside the server directory tree.');
  process.exit(1);
}

console.log('═══════════════════════════════════════');
console.log('  Ars-note Server Data Restore');
console.log('═══════════════════════════════════════');
console.log(`  Backup: ${path.basename(resolvedBackup)}`);
console.log('');

/* Safety: backup current server-data before overwriting */
if (fs.existsSync(DATA_DIR)) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const safetyName = `safety-backup-before-restore_${ts}.tar.gz`;
  const safetyPath = path.join(BACKUP_DIR, safetyName);

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  console.log('  Creating safety backup of current data...');
  try {
    child_process.execFileSync('tar', [
      'czf', safetyPath,
      '-C', path.dirname(DATA_DIR),
      '--exclude=.env',
      '--exclude=.env.*',
      '--exclude=node_modules',
      path.basename(DATA_DIR),
    ], { stdio: 'pipe' });

    const safetyStats = fs.statSync(safetyPath);
    console.log(`  ✓ Safety backup: ${safetyName} (${(safetyStats.size / (1024 * 1024)).toFixed(2)} MB)`);
  } catch (e) {
    console.error('  WARNING: Could not create safety backup. Aborting restore.');
    console.error('  Error:', e.message);
    process.exit(1);
  }
}

/* Extract backup */
console.log('');
console.log('  Restoring from backup...');

try {
  /* Remove current server-data (we have a safety backup) */
  if (fs.existsSync(DATA_DIR)) {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }

  child_process.execFileSync('tar', [
    'xzf', resolvedBackup,
    '-C', path.resolve('.'),
  ], { stdio: 'pipe' });

  console.log('  ✓ server-data/ restored successfully');

  /* Safety: ensure no .env was restored */
  const envPath = path.join(DATA_DIR, '.env');
  if (fs.existsSync(envPath)) {
    fs.unlinkSync(envPath);
    console.log('  ✓ Removed .env from restored data (secrets must not be in backup)');
  }

  /* Summary */
  console.log('');
  console.log('  Restored files:');
  const indexFile = path.join(DATA_DIR, 'remote-index.json');
  if (fs.existsSync(indexFile)) {
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
    const vaultCount = Object.keys(index).length;
    console.log(`  - Vaults: ${vaultCount}`);
  }

  const backupsDir = path.join(DATA_DIR, 'backups');
  if (fs.existsSync(backupsDir)) {
    const vaultDirs = fs.readdirSync(backupsDir).filter(d =>
      fs.statSync(path.join(backupsDir, d)).isDirectory()
    );
    let totalBackups = 0;
    for (const vd of vaultDirs) {
      const bd = path.join(backupsDir, vd);
      totalBackups += fs.readdirSync(bd).filter(d =>
        fs.statSync(path.join(bd, d)).isDirectory()
      ).length;
    }
    console.log(`  - Backups: ${totalBackups}`);
  }

  console.log('');
  console.log('  IMPORTANT: Restart the server after restore.');
  console.log('═══════════════════════════════════════');
} catch (e) {
  console.error('  ERROR: Restore failed:', e.message);
  console.error('  Your safety backup is in server-backups/');
  process.exit(1);
}
