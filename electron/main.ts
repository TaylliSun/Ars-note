import { app, BrowserWindow, ipcMain, dialog, shell, Menu, safeStorage } from 'electron';
import type { MessageBoxOptions } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import { s3PutObject, s3GetObject, s3ListObjects, s3DeleteObject, testS3Connection } from './s3Client';
import * as FP from './fivePillars';
import { buildExcalidrawScene } from './wireframeBuilder';
import { sanitizeS3KeyPart, buildS3BackupPrefix, buildS3RemoteIndexKey } from './s3PathHelpers';
import {
  buildAITaskPolicy as buildAITaskContract,
  evaluateAIToolCall,
  isAIToolMutationName,
} from './aiTaskPolicy';
import { startLiveSync, stopLiveSync, getLiveSyncStatus, getLiveSyncHealthSnapshot, pushLiveFileContent, trustLocalSnapshotForInitialLiveSyncUpload, resumeLiveSyncAfterStaleBaselineReview, resumeLiveSyncAfterDeleteStormReview, resumeLiveSyncAfterDestructiveTruncationReview, publishLocalSnapshotAsServerAuthority, getLiveSyncSafeDeleteQueue, clearLiveSyncSafeDeleteQueue, applyLiveSyncSafeDeleteQueue, normalizeLiveSyncServerUrl, normalizeLiveSyncConnectionMode, isPreflightBaselineStaleAgainstRemote, shouldTriggerDeleteStormGuard, canSendLiveWriteAfterPreflight, shouldGuardDestructiveTruncation, shouldHoldMissingBaseQueuedWriteInJoin, shouldApplyServerAuthorityOverIncomingConflictInMode, getJoinSnapshotAuthorityDecision, isLiveSyncRecoveryArchivePath, isUserVisibleConflictArtifactPath } from './liveSync';
import type { LiveSyncConfig, LiveSyncConnectionMode } from './liveSync';

/**
 * Compute a deterministic hash from a manifest's file entries.
 * Based on relativePath + sha256 + size — ignores generatedAt and absolute paths.
 * (v0.6.0)
 */
function computeManifestHash(manifest: { files: any[] }): string {
  const parts = (manifest.files || [])
    .slice()
    .sort((a: any, b: any) => (a.relativePath || '').localeCompare(b.relativePath || ''))
    .map((f: any) => `${f.relativePath}:${f.sha256}:${f.size}`)
    .join('|');
  return crypto.createHash('sha256').update(parts).digest('hex');
}

/* ── Constants ── */
const ARS_NOTE_DIR = '.ars-note';
const BACKUP_DIR = 'backups';
const MANIFEST_FILE = 'manifest.json';
const SYNC_FILE = 'sync.json';
const LIVE_SYNC_STATE_FILE = 'live-sync-state.json';
const AI_SYNC_STATE_FILE = 'ai-sync-state.json';
const AI_MEMORY_DIR = '.ai-memory';
const TEAM_SCHEDULE_DIR = '.ars-team';
const TEAM_SCHEDULE_FILE = 'schedule.json';
const LIVE_HISTORY_DIR = 'live-history';
const SYNC_RECOVERY_DIR = 'sync-recovery';
const LEGACY_CONFLICT_ARCHIVE_DIR = 'conflict-archive';
const AI_TRASH_DIR = 'ai-trash';
const AI_OPS_DIR = 'ai-ops';
const AI_SERVER_DELETE_HOLD_FILE = 'ai-server-delete-holds.json';
const REMOTE_MOCK_DIR = 'remote-mock';
const REMOTE_INDEX_FILE = 'remote-index.json';
const DOWNLOADS_DIR = 'downloads';
const VAULT_CONFIG_FILE = 'vault.json';
const SETTINGS_FILE = 'settings.json';
const APP_VERSION = (() => {
  try { return app.getVersion() || '1.5.64'; } catch { return '1.5.64'; }
})();
const LIVE_SYNC_CONFIG_FILE = path.join(app.getPath('userData'), 'live-sync-configs.json');
const AI_RUNTIME_CONFIG_FILE = path.join(app.getPath('userData'), 'ai-runtime-configs.json');
const PROTECTED_SECRET_PREFIX = 'ars-note-safe:v1:';
const ARS_NOTE_VOLATILE_DIRS = new Set([BACKUP_DIR, DOWNLOADS_DIR, REMOTE_MOCK_DIR, LIVE_HISTORY_DIR, AI_TRASH_DIR, AI_OPS_DIR]);
const MAX_LIVE_HISTORY_VERSIONS = 20;

/* Directories to skip in file tree and search */
const SKIP_DIRS = new Set([
  ARS_NOTE_DIR,
  'node_modules',
  '.git',
  'dist',
  'out',
  '.cache',
  '__pycache__',
]);

/* Illegal characters for file/folder names (Windows) */
const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1f]/;
const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1','COM2','COM3','COM4','COM5','COM6','COM7','COM8','COM9',
  'LPT1','LPT2','LPT3','LPT4','LPT5','LPT6','LPT7','LPT8','LPT9',
]);

/* ── Globals ── */
let mainWindow: BrowserWindow | null = null;
const RECENT_FILE = path.join(app.getPath('userData'), 'recent-vaults.json');
const CLIENT_CRASH_DIR = path.join(app.getPath('userData'), 'crash-reports');
let handlingFatalMainError = false;
let handlingRendererCrash = false;

function describeCrashValue(value: unknown): Record<string, unknown> {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack || '' };
  }
  if (value && typeof value === 'object') {
    try { return JSON.parse(JSON.stringify(value)); } catch { /* fall through */ }
  }
  return { message: String(value) };
}

function recordClientCrash(kind: string, detail: unknown): string {
  try {
    fs.mkdirSync(CLIENT_CRASH_DIR, { recursive: true });
    const timestamp = new Date();
    const safeTimestamp = timestamp.toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(CLIENT_CRASH_DIR, `${safeTimestamp}-${kind}.json`);
    fs.writeFileSync(reportPath, JSON.stringify({
      kind,
      timestamp: timestamp.toISOString(),
      appVersion: APP_VERSION,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      detail: describeCrashValue(detail),
    }, null, 2), 'utf-8');

    const reports = fs.readdirSync(CLIENT_CRASH_DIR)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .reverse();
    for (const oldReport of reports.slice(20)) {
      try { fs.unlinkSync(path.join(CLIENT_CRASH_DIR, oldReport)); } catch { /* best effort */ }
    }
    return reportPath;
  } catch {
    return '';
  }
}

function recoverFromFatalMainError(error: unknown): void {
  const reportPath = recordClientCrash('main-process', error);
  console.error('Fatal main-process error:', error);
  if (handlingFatalMainError) return;
  handlingFatalMainError = true;

  const showRecovery = async () => {
    if (!app.isReady()) await app.whenReady();
    const response = await dialog.showMessageBox({
      type: 'error',
      title: 'Ars-note 需要重新启动',
      message: '主进程发生异常。工作区会话已保留，可以重新启动恢复。',
      detail: reportPath ? `崩溃报告：${reportPath}` : '崩溃报告写入失败。',
      buttons: ['重新启动', '关闭'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response.response === 0) app.relaunch();
    app.exit(1);
  };
  void showRecovery().catch(() => app.exit(1));
}

process.on('uncaughtException', recoverFromFatalMainError);
process.on('unhandledRejection', (reason) => {
  recordClientCrash('unhandled-rejection', reason);
  console.error('Unhandled promise rejection:', reason);
});

/* ── Vault config helpers ── */
function vaultConfigPath(vp: string): string {
  return path.join(vp, ARS_NOTE_DIR, VAULT_CONFIG_FILE);
}
function vaultSettingsPath(vp: string): string {
  return path.join(vp, ARS_NOTE_DIR, SETTINGS_FILE);
}
function isValidVault(dir: string): boolean {
  return fs.existsSync(vaultConfigPath(dir));
}

/** Check if a path is inside a parent directory */
function isInsidePath(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isSyncableHiddenDir(name: string): boolean {
  return name === ARS_NOTE_DIR || name === AI_MEMORY_DIR || name === TEAM_SCHEDULE_DIR;
}

function shouldSkipHiddenEntry(name: string): boolean {
  return name.startsWith('.') && !isSyncableHiddenDir(name);
}

function normalizeVaultRelativePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function resolveVaultRelativePath(vaultPath: string, relativePath: string, options: { allowRoot?: boolean } = {}): string {
  const raw = String(relativePath || '').trim();
  if (path.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw)) {
    throw new Error('Use a path relative to the vault root');
  }

  const normalized = normalizeVaultRelativePath(raw);
  const resolvedVault = path.resolve(vaultPath);
  if (!normalized) {
    if (options.allowRoot) return resolvedVault;
    throw new Error('Path is required');
  }

  const resolvedPath = path.resolve(resolvedVault, normalized);
  if (resolvedPath !== resolvedVault && !isInsidePath(resolvedPath, resolvedVault)) {
    throw new Error('Path must stay inside the vault');
  }
  return resolvedPath;
}

function normalizeAiMemoryRelativePath(value: string): string {
  const normalized = normalizeVaultRelativePath(value);
  if (normalized === AI_MEMORY_DIR) return '';
  if (normalized.startsWith(`${AI_MEMORY_DIR}/`)) return normalized.slice(AI_MEMORY_DIR.length + 1);
  return normalized;
}

function shouldSkipGeneratedAiMemoryArtifact(relativePath: string): boolean {
  const aiRelPath = normalizeAiMemoryRelativePath(relativePath);
  if (!aiRelPath) return false;
  return (
    aiRelPath === 'live-session.json' ||
    aiRelPath === 'history' ||
    aiRelPath.startsWith('history/') ||
    isConflictArtifactName(path.posix.basename(aiRelPath))
  );
}

function shouldSkipGeneratedVaultArtifact(relativePath: string): boolean {
  const normalized = normalizeVaultRelativePath(relativePath);
  return normalized.startsWith(`${AI_MEMORY_DIR}/`) && shouldSkipGeneratedAiMemoryArtifact(normalized);
}

function shouldSkipArsNoteInternalEntry(name: string, parentDirName: string): boolean {
  return parentDirName === ARS_NOTE_DIR && ARS_NOTE_VOLATILE_DIRS.has(name);
}

function isConflictArtifactName(name: string): boolean {
  return /\.conflict-\d+$/.test(name);
}

interface ConflictArtifactSummaryFile {
  path: string;
  relativePath: string;
  originalRelativePath?: string;
  reason?: string;
  hiddenRecoveryCopy?: boolean;
  size: number;
  modifiedAt: string;
}

function conflictArtifactSummary(
  vaultPath: string,
  options: { includeHiddenRecovery?: boolean } = {},
): { count: number; totalSize: number; files: ConflictArtifactSummaryFile[] } {
  const resolvedVault = path.resolve(vaultPath);
  const files: ConflictArtifactSummaryFile[] = [];
  const seen = new Set<string>();
  const SKIP = new Set(['node_modules', '.git', 'dist', 'out', '.cache', '__pycache__', ARS_NOTE_DIR]);

  function addConflictFile(fullPath: string, extra: Partial<ConflictArtifactSummaryFile> = {}): void {
    const resolvedFile = path.resolve(fullPath);
    if (seen.has(resolvedFile)) return;
    try {
      const stat = fs.statSync(resolvedFile);
      if (!stat.isFile()) return;
      seen.add(resolvedFile);
      files.push({
        path: resolvedFile,
        relativePath: path.relative(resolvedVault, resolvedFile).replace(/\\/g, '/'),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        ...extra,
      });
    } catch { /* skip unreadable */ }
  }

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile() || !isConflictArtifactName(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      addConflictFile(fullPath);
    }
  }

  function walkHiddenRecovery(dir: string, root: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.resolve(path.join(dir, entry.name));
      if (fullPath !== root && !isInsidePath(fullPath, root)) continue;
      if (entry.isDirectory()) {
        walkHiddenRecovery(fullPath, root);
        continue;
      }
      if (!entry.isFile() || !isConflictArtifactName(entry.name)) continue;
      const relativePath = path.relative(resolvedVault, fullPath).replace(/\\/g, '/');
      const originalRelativePath = originalPathFromProtectedLocalRecoveryRelativePath(relativePath);
      if (!originalRelativePath || isProtectedLocalRecoveryTargetPath(originalRelativePath)) continue;
      addConflictFile(fullPath, {
        relativePath,
        originalRelativePath,
        reason: protectedLocalRecoveryReasonFromRelativePath(relativePath),
        hiddenRecoveryCopy: true,
      });
    }
  }

  walk(resolvedVault);
  if (options.includeHiddenRecovery) {
    for (const relativeRoot of [
      `${ARS_NOTE_DIR}/${SYNC_RECOVERY_DIR}`,
      `${ARS_NOTE_DIR}/${LEGACY_CONFLICT_ARCHIVE_DIR}`,
    ]) {
      const root = path.resolve(path.join(resolvedVault, relativeRoot.replace(/\//g, path.sep)));
      if (fs.existsSync(root)) walkHiddenRecovery(root, root);
    }
  }
  return {
    count: files.length,
    totalSize: files.reduce((sum, file) => sum + file.size, 0),
    files,
  };
}

function archiveConflictArtifacts(vaultPath: string): { ok: true; archivedCount: number; archivedSize: number; archiveRelativePath: string; files: string[] } {
  const summary = conflictArtifactSummary(vaultPath);
  const resolvedVault = path.resolve(vaultPath);
  const archiveRelativePath = `${ARS_NOTE_DIR}/${SYNC_RECOVERY_DIR}/legacy-conflict-import-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const archiveRoot = path.resolve(path.join(resolvedVault, archiveRelativePath));
  if (!isInsidePath(archiveRoot, resolvedVault)) {
    throw new Error('Archive path escapes vault');
  }

  let archivedCount = 0;
  let archivedSize = 0;
  const files: string[] = [];

  for (const file of summary.files) {
    const fullPath = path.resolve(file.path);
    if (!isInsidePath(fullPath, resolvedVault) || !isConflictArtifactName(path.basename(fullPath))) continue;
    const relativePath = path.relative(resolvedVault, fullPath).replace(/\\/g, '/');
    if (!relativePath || relativePath.startsWith(`${ARS_NOTE_DIR}/`) || relativePath.split('/').includes('..')) continue;
    const dest = path.resolve(path.join(archiveRoot, relativePath.replace(/\//g, path.sep)));
    if (!isInsidePath(dest, archiveRoot)) continue;
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(fullPath, dest);
      archivedCount++;
      archivedSize += file.size;
      if (files.length < 30) files.push(relativePath);
    } catch {
      /* Skip locked or already moved conflict files. */
    }
  }

  return { ok: true, archivedCount, archivedSize, archiveRelativePath, files };
}

function originalPathFromAITrashRelativePath(recoveryRelativePath: string): string {
  const normalized = normalizeVaultRelativePath(recoveryRelativePath);
  const prefix = `${ARS_NOTE_DIR}/${AI_TRASH_DIR}/`;
  if (!normalized.startsWith(prefix)) return '';
  const parts = normalized.slice(prefix.length).split('/').filter(Boolean);
  return parts.length >= 2 ? parts.slice(1).join('/') : '';
}

function aiTrashSummary(vaultPath: string): { count: number; totalSize: number; files: Array<{ relativePath: string; originalRelativePath: string; size: number; modifiedAt: string }> } {
  const resolvedVault = path.resolve(vaultPath);
  const trashRoot = path.resolve(path.join(resolvedVault, ARS_NOTE_DIR, AI_TRASH_DIR));
  const files: Array<{ relativePath: string; originalRelativePath: string; size: number; modifiedAt: string }> = [];
  if (!fs.existsSync(trashRoot)) {
    return { count: 0, totalSize: 0, files };
  }

  const walk = (dir: string): void => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.resolve(path.join(dir, entry.name));
      if (fullPath !== trashRoot && !isInsidePath(fullPath, trashRoot)) continue;
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = fs.statSync(fullPath);
        const relativePath = path.relative(resolvedVault, fullPath).replace(/\\/g, '/');
        files.push({
          relativePath,
          originalRelativePath: originalPathFromAITrashRelativePath(relativePath),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch { /* skip unreadable file */ }
    }
  };

  walk(trashRoot);
  files.sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
  return {
    count: files.length,
    totalSize: files.reduce((sum, file) => sum + file.size, 0),
    files: files.slice(0, 30),
  };
}

function stripProtectedLocalRecoverySuffix(relativePath: string): string {
  return relativePath.replace(/\.(?:conflict|local-only)-\d+$/i, '');
}

function protectedLocalRecoveryReasonFromRelativePath(recoveryRelativePath: string): string {
  const normalized = normalizeVaultRelativePath(recoveryRelativePath);
  const syncRecoveryPrefix = `${ARS_NOTE_DIR}/${SYNC_RECOVERY_DIR}/`;
  const legacyConflictPrefix = `${ARS_NOTE_DIR}/${LEGACY_CONFLICT_ARCHIVE_DIR}/`;
  const prefix = normalized.startsWith(syncRecoveryPrefix)
    ? syncRecoveryPrefix
    : (normalized.startsWith(legacyConflictPrefix) ? legacyConflictPrefix : '');
  if (!prefix) return '';
  const archiveDir = normalized.slice(prefix.length).split('/').filter(Boolean)[0] || '';
  if (archiveDir.startsWith('server-authoritative-adoption')) return 'server-authoritative-adoption';
  if (archiveDir.startsWith('legacy-conflict-import') || archiveDir.startsWith('sync-blocker')) return 'legacy-conflict-import';
  return archiveDir;
}

function originalPathFromProtectedLocalRecoveryRelativePath(recoveryRelativePath: string): string {
  const normalized = normalizeVaultRelativePath(recoveryRelativePath);
  const syncRecoveryPrefix = `${ARS_NOTE_DIR}/${SYNC_RECOVERY_DIR}/`;
  const legacyConflictPrefix = `${ARS_NOTE_DIR}/${LEGACY_CONFLICT_ARCHIVE_DIR}/`;
  const prefix = normalized.startsWith(syncRecoveryPrefix)
    ? syncRecoveryPrefix
    : (normalized.startsWith(legacyConflictPrefix) ? legacyConflictPrefix : '');
  if (!prefix) return '';
  const parts = normalized.slice(prefix.length).split('/').filter(Boolean);
  if (parts.length < 2) return '';
  return stripProtectedLocalRecoverySuffix(parts.slice(1).join('/'));
}

function isProtectedLocalRecoveryTargetPath(relativePath: string): boolean {
  const normalized = normalizeVaultRelativePath(relativePath).toLowerCase();
  if (!normalized || normalized.split('/').some(part => part === '..')) return true;
  const firstPart = normalized.split('/')[0];
  return firstPart === ARS_NOTE_DIR
    || firstPart === '.git'
    || firstPart === 'node_modules';
}

function protectedLocalRecoverySummary(vaultPath: string): {
  count: number;
  totalSize: number;
  files: Array<{ relativePath: string; originalRelativePath: string; reason: string; size: number; modifiedAt: string }>;
} {
  const resolvedVault = path.resolve(vaultPath);
  const recoveryRoots = [
    path.resolve(path.join(resolvedVault, ARS_NOTE_DIR, SYNC_RECOVERY_DIR)),
    path.resolve(path.join(resolvedVault, ARS_NOTE_DIR, LEGACY_CONFLICT_ARCHIVE_DIR)),
  ];
  const files: Array<{ relativePath: string; originalRelativePath: string; reason: string; size: number; modifiedAt: string }> = [];
  const existingRoots = recoveryRoots.filter((root) => fs.existsSync(root));
  if (existingRoots.length === 0) {
    return { count: 0, totalSize: 0, files };
  }

  const walk = (dir: string, recoveryRoot: string): void => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.resolve(path.join(dir, entry.name));
      if (fullPath !== recoveryRoot && !isInsidePath(fullPath, recoveryRoot)) continue;
      if (entry.isDirectory()) {
        walk(fullPath, recoveryRoot);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isConflictArtifactName(entry.name)) continue;
      try {
        const stat = fs.statSync(fullPath);
        const relativePath = path.relative(resolvedVault, fullPath).replace(/\\/g, '/');
        const originalRelativePath = originalPathFromProtectedLocalRecoveryRelativePath(relativePath);
        if (!originalRelativePath) continue;
        files.push({
          relativePath,
          originalRelativePath,
          reason: protectedLocalRecoveryReasonFromRelativePath(relativePath),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch { /* skip unreadable recovery file */ }
    }
  };

  for (const recoveryRoot of existingRoots) {
    walk(recoveryRoot, recoveryRoot);
  }
  files.sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
  return {
    count: files.length,
    totalSize: files.reduce((sum, file) => sum + file.size, 0),
    files: files.slice(0, 30),
  };
}

function syncRecoveryOverview(vaultPath: string): any {
  const conflicts = conflictArtifactSummary(vaultPath, { includeHiddenRecovery: true });
  const history = listLiveHistory(vaultPath).slice(0, 100);
  const deletedRecent = history.filter(item => !!item.deletedSnapshot).slice(0, 20);
  const overwriteCount = history.filter(item => /overwrite|remote|stale|conflict|restore|backup/i.test(String(item.reason || ''))).length;
  const trash = aiTrashSummary(vaultPath);
  const protectedLocal = protectedLocalRecoverySummary(vaultPath);
  const recommendedActions: string[] = [];

  if (conflicts.count > 0) {
    recommendedActions.push(`Review ${conflicts.count} conflict copy/copies before cleaning them.`);
  }
  if (protectedLocal.count > 0) {
    recommendedActions.push(`Review ${protectedLocal.count} protected local difference(s) before you consider them resolved.`);
  }
  if (deletedRecent.length > 0) {
    recommendedActions.push(`${deletedRecent.length} recent delete snapshot(s) are kept for manual mistaken-delete recovery; automatic restore skips them.`);
  }
  if (overwriteCount > 0) {
    recommendedActions.push(`Inspect ${Math.min(overwriteCount, history.length)} overwrite/sync history entries if files look stale.`);
  }
  if (trash.count > 0) {
    recommendedActions.push(`AI delete recovery contains ${trash.count} file(s); keep until you confirm the delete was intended.`);
  }
  if (recommendedActions.length === 0) {
    recommendedActions.push('No obvious sync accident artifacts were found.');
  }

  const riskLevel = conflicts.count > 0
    ? 'danger'
    : (deletedRecent.length > 0 || protectedLocal.count > 0 || overwriteCount > 0 || trash.count > 0 ? 'watch' : 'ok');

  return {
    checkedAt: new Date().toISOString(),
    conflict: {
      count: conflicts.count,
      totalSize: conflicts.totalSize,
      files: conflicts.files.slice(0, 20),
    },
    history: {
      count: history.length,
      deletedCount: deletedRecent.length,
      overwriteCount,
      recent: history.slice(0, 20),
      deletedRecent,
    },
    protectedLocal,
    aiTrash: trash,
    riskLevel,
    recommendedActions,
  };
}

function localRecoveryReadinessSummary(vaultPath: string): any {
  const overview = syncRecoveryOverview(vaultPath);
  const visibleConflicts = conflictArtifactSummary(vaultPath);
  const hiddenConflictCount = Math.max(0, Number(overview.conflict?.count || 0) - visibleConflicts.count);
  const visibleConflictFiles = visibleConflicts.files.map((file: any) => file.relativePath).filter(Boolean).slice(0, 8);
  const riskLevel = visibleConflicts.count > 0
    ? 'danger'
    : (overview.riskLevel === 'danger' && hiddenConflictCount > 0 ? 'watch' : (overview.riskLevel || 'ok'));
  return {
    checkedAt: overview.checkedAt,
    riskLevel,
    conflictCount: visibleConflicts.count,
    conflictFiles: visibleConflictFiles,
    hiddenRecoveryConflictCount: hiddenConflictCount,
    deletedSnapshotCount: Number(overview.history?.deletedCount || 0),
    overwriteHistoryCount: Number(overview.history?.overwriteCount || 0),
    protectedLocalCount: Number(overview.protectedLocal?.count || 0),
    aiTrashCount: Number(overview.aiTrash?.count || 0),
    recommendedActions: Array.isArray(overview.recommendedActions)
      ? overview.recommendedActions.slice(0, 8)
      : [],
  };
}

function writePreflightSyncRecoveryReport(vaultPath: string, payload: {
  archivedConflicts?: any;
  recoveryRisk?: any;
  advisor?: any;
  advisorError?: string;
}): { reportPath: string; reportRelativePath: string } {
  const resolvedVault = path.resolve(vaultPath);
  const reportDir = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_RECOVERY_DIR, 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(reportDir, `live-sync-preflight-recovery-${stamp}.md`);
  const reportRelativePath = path.relative(resolvedVault, reportPath).replace(/\\/g, '/');
  const archived = payload.archivedConflicts || {};
  const risk = payload.recoveryRisk || {};
  const advisor = payload.advisor || null;
  const advisorItems = Array.isArray(advisor?.items) ? advisor.items.slice(0, 40) : [];
  const lines = [
    '# Ars-note Live Sync Preflight Recovery',
    '',
    `Created: ${new Date().toISOString()}`,
    '',
    '## Automatic Actions',
    `- Legacy conflict copies moved into Sync Recovery Center: ${Number(archived.archivedCount || 0)}`,
    archived.archiveRelativePath ? `- Archive folder: ${archived.archiveRelativePath}` : '- Archive folder: -',
    '- No document files were overwritten, restored, or deleted automatically.',
    '',
    '## Current Recovery Summary',
    `- Remaining conflict files in document folders: ${Number(risk.conflictCount || 0)}`,
    `- Protected local differences in Recovery Center: ${Number(risk.protectedLocalCount || 0)}`,
    `- Recent delete snapshots: ${Number(risk.deletedSnapshotCount || 0)}`,
    `- Recent overwrite/sync records: ${Number(risk.overwriteHistoryCount || 0)}`,
    `- AI trash recoverable files: ${Number(risk.aiTrashCount || 0)}`,
    '',
    '## Advisor',
  ];
  if (payload.advisorError) {
    lines.push(`- Advisor unavailable: ${payload.advisorError}`);
  } else if (advisor) {
    lines.push(
      `- Risk: ${advisor.riskLevel || '-'}`,
      `- Files reviewed: ${Number(advisor.summary?.totalFiles || 0)}`,
      `- Can apply from Recovery Center: ${Number(advisor.summary?.applyReadyCount || 0)}`,
      `- Needs review/merge: ${Number(advisor.summary?.reviewCount || 0)}`,
    );
    if (advisorItems.length > 0) {
      lines.push('', '## Top Recommendations');
      for (const item of advisorItems) {
        lines.push(
          `- ${item.relativePath}: ${item.recommendedLabel || item.recommendedAction || 'review'} (${item.confidence || 'unknown'})`,
        );
      }
    }
  } else {
    lines.push('- Advisor was not needed.');
  }
  lines.push('', '> Generated before Live Sync connection. Review in Sync Recovery Center if anything looks missing.');
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf-8');
  return { reportPath, reportRelativePath };
}

async function prepareLocalSyncRecoveryBeforeLiveSync(vaultPath: string): Promise<any> {
  const resolvedVault = path.resolve(vaultPath);
  const archivedConflicts = archiveConflictArtifacts(resolvedVault);
  const recoveryRisk = localRecoveryReadinessSummary(resolvedVault);
  const result: any = {
    ok: true,
    archivedConflicts,
    recoveryRisk,
  };

  const shouldWriteReport =
    Number(archivedConflicts.archivedCount || 0) > 0 ||
    Number(recoveryRisk.conflictCount || 0) > 0;

  if (!shouldWriteReport) {
    return result;
  }

  let advisor: any = null;
  let advisorError = '';
  try {
    advisor = await previewSyncRecoveryAdvisor(resolvedVault, {
      sinceHours: 720,
      limit: 120,
      includeAllReasons: true,
    });
  } catch (err: any) {
    advisorError = err?.message || String(err);
  }

  try {
    result.advisor = advisor;
    result.advisorError = advisorError;
    result.report = writePreflightSyncRecoveryReport(resolvedVault, {
      archivedConflicts,
      recoveryRisk,
      advisor,
      advisorError,
    });
  } catch (err: any) {
    result.reportError = err?.message || String(err);
  }

  return result;
}

function resolveConflictArtifact(vaultPath: string, conflictRelativePath: string): {
  vaultPath: string;
  conflictPath: string;
  conflictRelativePath: string;
  basePath: string;
  baseRelativePath: string;
} {
  const resolvedVault = path.resolve(vaultPath);
  const normalizedRelative = String(conflictRelativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const conflictPath = path.resolve(resolvedVault, normalizedRelative);
  if (!normalizedRelative || !isInsidePath(conflictPath, resolvedVault) || !isConflictArtifactName(path.basename(conflictPath))) {
    throw new Error('Invalid conflict file path');
  }

  const recoveryOriginalPath = originalPathFromProtectedLocalRecoveryRelativePath(normalizedRelative);
  const baseRelativePath = recoveryOriginalPath || normalizedRelative.replace(/\.conflict-\d+$/, '');
  if (baseRelativePath === normalizedRelative || !baseRelativePath) {
    throw new Error('Invalid conflict file name');
  }
  if (isProtectedLocalRecoveryTargetPath(baseRelativePath)) {
    throw new Error(`Refusing to use protected conflict target: ${baseRelativePath}`);
  }
  const basePath = path.resolve(resolvedVault, baseRelativePath);
  if (!isInsidePath(basePath, resolvedVault)) {
    throw new Error('Invalid base file path');
  }

  return {
    vaultPath: resolvedVault,
    conflictPath,
    conflictRelativePath: normalizedRelative,
    basePath,
    baseRelativePath,
  };
}

function readConflictPreviewText(filePath: string): { content: string; truncated: boolean } {
  if (!fs.existsSync(filePath)) return { content: '', truncated: false };
  return bufferPreviewText(fs.readFileSync(filePath));
}

function bufferPreviewText(buffer: Buffer): { content: string; truncated: boolean } {
  const maxBytes = 256 * 1024;
  const truncated = buffer.length > maxBytes;
  return {
    content: buffer.subarray(0, maxBytes).toString('utf-8'),
    truncated,
  };
}

function lineDiffSummary(baseContent: string, conflictContent: string): { baseLines: number; conflictLines: number; changedLines: number; firstChangedLine: number | null } {
  const baseLines = baseContent ? baseContent.split(/\r\n|\n|\r/).length : 0;
  const conflictLines = conflictContent ? conflictContent.split(/\r\n|\n|\r/).length : 0;
  const base = baseContent.split(/\r\n|\n|\r/);
  const conflict = conflictContent.split(/\r\n|\n|\r/);
  const max = Math.max(base.length, conflict.length);
  let changedLines = 0;
  let firstChangedLine: number | null = null;
  for (let index = 0; index < max; index++) {
    if ((base[index] ?? '') !== (conflict[index] ?? '')) {
      changedLines++;
      if (firstChangedLine === null) firstChangedLine = index + 1;
    }
  }
  return { baseLines, conflictLines, changedLines, firstChangedLine };
}

function splitTextLines(content: string): string[] {
  return String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

function normalizeMergeLine(line: string): string {
  return String(line || '').trim().replace(/\s+/g, ' ');
}

function isMarkdownTableLine(line: string): boolean {
  const trimmed = String(line || '').trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|');
}

function isMarkdownTableSeparator(line: string): boolean {
  const trimmed = String(line || '').trim();
  if (!isMarkdownTableLine(trimmed)) return false;
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed);
}

function mergeMarkdownTableBodies(baseLines: string[], conflictLines: string[]): { ok: boolean; lines: string[]; addedRows: number } {
  const baseNonBlank = baseLines.filter(line => line.trim());
  const conflictNonBlank = conflictLines.filter(line => line.trim());
  if (baseNonBlank.length < 2 || conflictNonBlank.length < 2) return { ok: false, lines: [], addedRows: 0 };
  if (!baseNonBlank.every(isMarkdownTableLine) || !conflictNonBlank.every(isMarkdownTableLine)) return { ok: false, lines: [], addedRows: 0 };
  const baseSepIndex = baseNonBlank.findIndex(isMarkdownTableSeparator);
  const conflictSepIndex = conflictNonBlank.findIndex(isMarkdownTableSeparator);
  if (baseSepIndex !== 1 || conflictSepIndex !== 1) return { ok: false, lines: [], addedRows: 0 };
  if (normalizeMergeLine(baseNonBlank[0]) !== normalizeMergeLine(conflictNonBlank[0])) return { ok: false, lines: [], addedRows: 0 };

  const merged = [baseNonBlank[0], baseNonBlank[1]];
  const seen = new Set<string>();
  for (const row of baseNonBlank.slice(2)) {
    const key = normalizeMergeLine(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }

  let addedRows = 0;
  for (const row of conflictNonBlank.slice(2)) {
    const key = normalizeMergeLine(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
    addedRows++;
  }
  return { ok: true, lines: merged, addedRows };
}

function mergeMarkdownSectionBodies(baseLines: string[], conflictLines: string[]): { lines: string[]; conflictOnlyLines: number; tableRowsAdded: number; needsReview: boolean } {
  const baseText = baseLines.join('\n').trim();
  const conflictText = conflictLines.join('\n').trim();
  if (baseText === conflictText) {
    return { lines: baseLines, conflictOnlyLines: 0, tableRowsAdded: 0, needsReview: false };
  }
  if (!baseText) {
    return { lines: conflictLines, conflictOnlyLines: conflictLines.filter(line => line.trim()).length, tableRowsAdded: 0, needsReview: false };
  }
  if (!conflictText) {
    return { lines: baseLines, conflictOnlyLines: 0, tableRowsAdded: 0, needsReview: false };
  }

  const tableMerge = mergeMarkdownTableBodies(baseLines, conflictLines);
  if (tableMerge.ok) {
    return {
      lines: tableMerge.lines,
      conflictOnlyLines: tableMerge.addedRows,
      tableRowsAdded: tableMerge.addedRows,
      needsReview: tableMerge.addedRows > 0,
    };
  }

  const seen = new Set(baseLines.map(normalizeMergeLine).filter(Boolean));
  const conflictOnly = conflictLines.filter(line => {
    const key = normalizeMergeLine(line);
    return key && !seen.has(key);
  });

  if (conflictOnly.length === 0) {
    return { lines: baseLines, conflictOnlyLines: 0, tableRowsAdded: 0, needsReview: false };
  }

  return {
    lines: [
      ...baseLines,
      '',
      '<!-- Ars-note smart merge: conflict-only content below. Review before saving. -->',
      ...conflictOnly,
      '<!-- /Ars-note smart merge -->',
    ],
    conflictOnlyLines: conflictOnly.length,
    tableRowsAdded: 0,
    needsReview: true,
  };
}

function parseMarkdownMergeSections(content: string): Array<{ key: string; heading: string; body: string[]; order: number }> {
  const lines = splitTextLines(content);
  const sections: Array<{ key: string; heading: string; body: string[]; order: number }> = [];
  let current = { key: '__preamble__', heading: '', body: [] as string[], order: 0 };

  const pushCurrent = () => {
    if (current.heading || current.body.some(line => line.trim())) {
      sections.push(current);
    }
  };

  for (const line of lines) {
    if (/^#{1,6}\s+\S/.test(line)) {
      pushCurrent();
      current = {
        key: normalizeMergeLine(line).toLowerCase(),
        heading: line,
        body: [],
        order: sections.length,
      };
    } else {
      current.body.push(line);
    }
  }
  pushCurrent();
  return sections;
}

function createSmartConflictMergeContent(baseContent: string, conflictContent: string, relativePath: string): {
  mergedContent: string;
  report: string[];
  stats: { sectionsMerged: number; conflictOnlyLines: number; tableRowsAdded: number; needsReview: boolean };
} {
  const base = String(baseContent || '');
  const conflict = String(conflictContent || '');
  if (base === conflict) {
    return {
      mergedContent: base,
      report: ['Current file and conflict copy are identical.'],
      stats: { sectionsMerged: 0, conflictOnlyLines: 0, tableRowsAdded: 0, needsReview: false },
    };
  }
  if (!base.trim()) {
    return {
      mergedContent: conflict,
      report: ['Current file is empty or missing; conflict copy is used as the proposed merge.'],
      stats: { sectionsMerged: 1, conflictOnlyLines: splitTextLines(conflict).filter(line => line.trim()).length, tableRowsAdded: 0, needsReview: false },
    };
  }
  if (!conflict.trim()) {
    return {
      mergedContent: base,
      report: ['Conflict copy is empty; current file is kept as the proposed merge.'],
      stats: { sectionsMerged: 0, conflictOnlyLines: 0, tableRowsAdded: 0, needsReview: false },
    };
  }

  const baseSections = parseMarkdownMergeSections(base);
  const conflictSections = parseMarkdownMergeSections(conflict);
  const conflictByKey = new Map<string, Array<typeof conflictSections[number]>>();
  for (const section of conflictSections) {
    const rows = conflictByKey.get(section.key) || [];
    rows.push(section);
    conflictByKey.set(section.key, rows);
  }

  const mergedLines: string[] = [];
  const report: string[] = [`Smart merge draft for ${relativePath}`];
  let sectionsMerged = 0;
  let conflictOnlyLines = 0;
  let tableRowsAdded = 0;
  let needsReview = false;
  const usedConflictSections = new Set<number>();

  for (const baseSection of baseSections) {
    const conflictRows = conflictByKey.get(baseSection.key) || [];
    const conflictSection = conflictRows.find(section => !usedConflictSections.has(section.order));
    if (!conflictSection) {
      if (baseSection.heading) mergedLines.push(baseSection.heading);
      mergedLines.push(...baseSection.body);
      continue;
    }
    usedConflictSections.add(conflictSection.order);
    if (baseSection.heading) mergedLines.push(baseSection.heading);
    const bodyMerge = mergeMarkdownSectionBodies(baseSection.body, conflictSection.body);
    mergedLines.push(...bodyMerge.lines);
    sectionsMerged++;
    conflictOnlyLines += bodyMerge.conflictOnlyLines;
    tableRowsAdded += bodyMerge.tableRowsAdded;
    needsReview = needsReview || bodyMerge.needsReview;
    if (bodyMerge.tableRowsAdded > 0) {
      report.push(`Merged ${bodyMerge.tableRowsAdded} table row(s) in section "${baseSection.heading || 'preamble'}".`);
    } else if (bodyMerge.conflictOnlyLines > 0) {
      report.push(`Appended ${bodyMerge.conflictOnlyLines} conflict-only line(s) in section "${baseSection.heading || 'preamble'}".`);
    }
  }

  const newConflictSections = conflictSections.filter(section => !usedConflictSections.has(section.order));
  for (const section of newConflictSections) {
    mergedLines.push('', '<!-- Ars-note smart merge: section only found in conflict copy. Review before saving. -->');
    if (section.heading) mergedLines.push(section.heading);
    mergedLines.push(...section.body);
    mergedLines.push('<!-- /Ars-note smart merge -->');
    conflictOnlyLines += section.body.filter(line => line.trim()).length + (section.heading ? 1 : 0);
    needsReview = true;
    report.push(`Added conflict-only section "${section.heading || 'preamble'}".`);
  }

  const mergedContent = mergedLines.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n';
  if (report.length === 1) report.push('No conflict-only content was found beyond existing current file lines.');
  return {
    mergedContent,
    report,
    stats: { sectionsMerged, conflictOnlyLines, tableRowsAdded, needsReview },
  };
}

function existingConflictMergeDraft(
  resolvedVault: string,
  basePath: string,
  baseRelativePath: string,
  conflictRelativePath: string,
): { draftPath: string; draftRelativePath: string } | null {
  const ext = path.extname(basePath) || '.md';
  const stem = path.basename(basePath, path.extname(basePath));
  const dir = path.dirname(basePath);
  try {
    if (!fs.existsSync(dir)) return null;
    const drafts = fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.startsWith(`${stem}.merge-`) && entry.name.endsWith(ext))
      .map(entry => {
        const draftPath = path.join(dir, entry.name);
        const stat = fs.statSync(draftPath);
        return { draftPath, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const draft of drafts) {
      if (!isInsidePath(path.resolve(draft.draftPath), resolvedVault)) continue;
      const preview = fs.readFileSync(draft.draftPath, 'utf-8').slice(0, 4096);
      if (
        preview.includes(`Current file: ${baseRelativePath}`)
        && preview.includes(`Conflict copy: ${conflictRelativePath}`)
      ) {
        return {
          draftPath: draft.draftPath,
          draftRelativePath: path.relative(resolvedVault, draft.draftPath).replace(/\\/g, '/'),
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function createConflictMergeDraftResult(vaultPath: string, conflictRelativePath: string, options?: { reuseExisting?: boolean }): any {
  const resolved = resolveConflictArtifact(vaultPath, conflictRelativePath);
  if (!fs.existsSync(resolved.conflictPath)) {
    throw new Error('Conflict file not found');
  }

  const resolvedVault = path.resolve(vaultPath);
  if (options?.reuseExisting) {
    const existing = existingConflictMergeDraft(
      resolvedVault,
      resolved.basePath,
      resolved.baseRelativePath,
      resolved.conflictRelativePath,
    );
    if (existing) {
      return {
        ok: true,
        action: 'merge-conflict-draft-existing',
        reused: true,
        draftPath: existing.draftPath,
        draftRelativePath: existing.draftRelativePath,
        baseRelativePath: resolved.baseRelativePath,
        conflictRelativePath: resolved.conflictRelativePath,
      };
    }
  }

  const ext = path.extname(resolved.basePath) || '.md';
  const stem = path.basename(resolved.basePath, path.extname(resolved.basePath));
  const draftPath = path.join(path.dirname(resolved.basePath), `${stem}.merge-${Date.now()}${ext}`);
  if (!isInsidePath(path.resolve(draftPath), resolvedVault)) {
    throw new Error('Refusing to create merge draft outside vault');
  }

  const baseContent = fs.existsSync(resolved.basePath) ? fs.readFileSync(resolved.basePath, 'utf-8') : '';
  const conflictContent = fs.readFileSync(resolved.conflictPath, 'utf-8');
  const smartMerge = createSmartConflictMergeContent(baseContent, conflictContent, resolved.baseRelativePath);
  const draftContent = [
    `# Smart merge draft: ${resolved.baseRelativePath}`,
    '',
    `Created: ${new Date().toISOString()}`,
    `Current file: ${resolved.baseRelativePath}`,
    `Conflict copy: ${resolved.conflictRelativePath}`,
    '',
    '> Review the proposed merged content first. If it looks correct, copy/apply it as the final merge. Conflict-only sections are marked with HTML comments.',
    '',
    '## Proposed merged content',
    '',
    '```markdown',
    smartMerge.mergedContent,
    '```',
    '',
    '## Merge report',
    '',
    ...smartMerge.report.map(item => `- ${item}`),
    '',
    `- Sections merged: ${smartMerge.stats.sectionsMerged}`,
    `- Conflict-only lines added: ${smartMerge.stats.conflictOnlyLines}`,
    `- Table rows added: ${smartMerge.stats.tableRowsAdded}`,
    `- Needs review: ${smartMerge.stats.needsReview ? 'yes' : 'no'}`,
    '',
    '## Current file',
    '',
    '```markdown',
    baseContent,
    '```',
    '',
    '## Conflict copy',
    '',
    '```markdown',
    conflictContent,
    '```',
    '',
  ].join('\n');

  fs.writeFileSync(draftPath, draftContent, 'utf-8');
  return {
    ok: true,
    action: 'merge-conflict-draft',
    draftPath,
    draftRelativePath: path.relative(resolvedVault, draftPath).replace(/\\/g, '/'),
    baseRelativePath: resolved.baseRelativePath,
    conflictRelativePath: resolved.conflictRelativePath,
    mergedContent: smartMerge.mergedContent,
    report: smartMerge.report,
    stats: smartMerge.stats,
  };
}

function resolveConflictByLatestResult(vaultPath: string, conflictRelativePath: string): any {
  const resolved = resolveConflictArtifact(vaultPath, conflictRelativePath);
  if (!fs.existsSync(resolved.conflictPath)) {
    throw new Error('Conflict file not found');
  }

  const conflictStat = fs.statSync(resolved.conflictPath);
  if (!conflictStat.isFile()) throw new Error('Conflict target is not a file');
  const baseExists = fs.existsSync(resolved.basePath) && fs.statSync(resolved.basePath).isFile();
  const baseStat = baseExists ? fs.statSync(resolved.basePath) : null;
  const conflictModifiedAt = conflictStat.mtime.toISOString();
  const baseModifiedAt = baseStat?.mtime.toISOString() || null;
  const chosen: 'current' | 'conflict' = !baseExists || conflictStat.mtimeMs > (baseStat?.mtimeMs || 0)
    ? 'conflict'
    : 'current';

  if (chosen === 'conflict') {
    const conflictBuffer = fs.readFileSync(resolved.conflictPath);
    fs.mkdirSync(path.dirname(resolved.basePath), { recursive: true });
    saveLiveHistoryBeforeOverwrite(resolved.basePath, conflictBuffer, 'before-conflict-latest-wins');
    fs.writeFileSync(resolved.basePath, conflictBuffer);
    fs.unlinkSync(resolved.conflictPath);
    return {
      ok: true,
      action: 'use-latest-conflict',
      chosen,
      restoredPath: resolved.baseRelativePath,
      deletedConflict: resolved.conflictRelativePath,
      baseRelativePath: resolved.baseRelativePath,
      conflictRelativePath: resolved.conflictRelativePath,
      baseModifiedAt,
      conflictModifiedAt,
      sha256: crypto.createHash('sha256').update(conflictBuffer).digest('hex'),
      size: conflictBuffer.length,
    };
  }

  fs.unlinkSync(resolved.conflictPath);
  return {
    ok: true,
    action: 'keep-latest-current',
    chosen,
    restoredPath: resolved.baseRelativePath,
    deletedConflict: resolved.conflictRelativePath,
    baseRelativePath: resolved.baseRelativePath,
    conflictRelativePath: resolved.conflictRelativePath,
    baseModifiedAt,
    conflictModifiedAt,
    sha256: baseExists ? fileSha256(resolved.basePath) : '',
    size: baseStat?.size || 0,
  };
}

function liveHistoryRoot(vaultPath: string): string {
  return path.join(path.resolve(vaultPath), ARS_NOTE_DIR, LIVE_HISTORY_DIR);
}

function safeHistoryPathPart(value: string): string {
  return value.replace(/\\/g, '/').split('/').map(part => encodeURIComponent(part)).join('/');
}

function decodeHistoryRelativePath(encodedPath: string): string {
  return encodedPath.split(/[\\/]/).map(part => decodeURIComponent(part)).join('/');
}

function findVaultRootForPath(filePath: string): string | null {
  let dir = fs.statSync(filePath).isDirectory() ? filePath : path.dirname(filePath);
  while (true) {
    if (isValidVault(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function pruneLiveHistoryVersions(historyFileDir: string): void {
  try {
    const versions = fs.readdirSync(historyFileDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => entry.name)
      .sort();
    if (versions.length <= MAX_LIVE_HISTORY_VERSIONS) return;
    for (const name of versions.slice(0, versions.length - MAX_LIVE_HISTORY_VERSIONS)) {
      fs.unlinkSync(path.join(historyFileDir, name));
    }
  } catch { /* best effort */ }
}

function latestLiveHistorySha(historyFileDir: string): string {
  try {
    const latest = fs.readdirSync(historyFileDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => entry.name)
      .sort()
      .pop();
    if (!latest) return '';
    const record = readJsonSafe<any>(path.join(historyFileDir, latest), null);
    return record?.sha256 || '';
  } catch {
    return '';
  }
}

function fileSha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function saveLiveHistoryBeforeOverwrite(filePath: string, nextContent?: string | Buffer, reason = 'local-save'): void {
  try {
    const resolvedFile = path.resolve(filePath);
    if (!fs.existsSync(resolvedFile) || !fs.statSync(resolvedFile).isFile()) return;
    if (isConflictArtifactName(path.basename(resolvedFile))) return;

    const vaultRoot = findVaultRootForPath(resolvedFile);
    if (!vaultRoot) return;

    const relPath = path.relative(vaultRoot, resolvedFile).replace(/\\/g, '/');
    if (!relPath || relPath.startsWith(`${ARS_NOTE_DIR}/`)) return;
    if (shouldSkipGeneratedVaultArtifact(relPath)) return;

    const content = fs.readFileSync(resolvedFile);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const deletedSnapshot = /delete|remove|trash|unlink|删除|移除/i.test(reason);
    if (nextContent !== undefined) {
      const nextBuffer = Buffer.isBuffer(nextContent) ? nextContent : Buffer.from(nextContent, 'utf-8');
      const nextSha = crypto.createHash('sha256').update(nextBuffer).digest('hex');
      if (nextSha === sha256) return;
    }

    const historyFileDir = path.join(vaultRoot, ARS_NOTE_DIR, LIVE_HISTORY_DIR, safeHistoryPathPart(relPath));
    fs.mkdirSync(historyFileDir, { recursive: true });
    if (!deletedSnapshot && latestLiveHistorySha(historyFileDir) === sha256) return;

    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const record = {
      versionId: stamp,
      relativePath: relPath,
      savedAt: now.toISOString(),
      reason,
      deletedSnapshot,
      size: content.length,
      sha256,
      contentBase64: content.toString('base64'),
    };
    fs.writeFileSync(path.join(historyFileDir, `${stamp}.json`), JSON.stringify(record, null, 2), 'utf-8');
    pruneLiveHistoryVersions(historyFileDir);
  } catch (err: any) {
    console.error('[History] Failed to save file version:', filePath, err.message);
  }
}

function saveLiveHistoryBeforeDelete(itemPath: string, vaultPath: string, reason = 'local-delete'): number {
  const resolvedItem = path.resolve(itemPath);
  const resolvedVault = path.resolve(vaultPath);
  if (!fs.existsSync(resolvedItem)) return 0;
  if (!isInsidePath(resolvedItem, resolvedVault) || resolvedItem === resolvedVault) return 0;

  let savedCount = 0;
  const visit = (targetPath: string) => {
    let stat: fs.Stats;
    try { stat = fs.statSync(targetPath); } catch { return; }
    if (stat.isDirectory()) {
      const base = path.basename(targetPath);
      if (base === ARS_NOTE_DIR || base === '.git' || base === 'node_modules') return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(targetPath, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) visit(path.join(targetPath, entry.name));
      return;
    }
    if (!stat.isFile()) return;
    saveLiveHistoryBeforeOverwrite(targetPath, undefined, reason);
    savedCount += 1;
  };

  visit(resolvedItem);
  return savedCount;
}

function countVisualDocumentItems(filePath: string, raw: string): number {
  const lower = filePath.toLowerCase();
  if (!raw.trim()) return 0;
  try {
    const parsed = JSON.parse(raw);
    if (lower.endsWith('.canvas')) {
      return Array.isArray(parsed.nodes) ? parsed.nodes.length : 0;
    }
    if (lower.endsWith('.excalidraw')) {
      const elements = Array.isArray(parsed.elements) ? parsed.elements : [];
      return elements.filter((el: any) => !el?.isDeleted).length;
    }
  } catch {
    return -1;
  }
  return -1;
}

interface VisualDocumentWriteSafetyOptions {
  blockLargeShrink?: boolean;
  requireValidNonEmpty?: boolean;
}

function isVisualDocumentSafetyError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('Refusing to ');
}

function assertSafeVisualDocumentWrite(
  filePath: string,
  nextContent: string,
  options: VisualDocumentWriteSafetyOptions = {},
): void {
  const lower = filePath.toLowerCase();
  if (!lower.endsWith('.canvas') && !lower.endsWith('.excalidraw')) return;

  const nextItems = countVisualDocumentItems(filePath, nextContent);
  const requireValidNonEmpty = options.requireValidNonEmpty ?? options.blockLargeShrink ?? false;
  if (nextItems < 0) {
    if (!requireValidNonEmpty) return;
    throw new Error(`Refusing to write invalid visual document JSON: ${path.basename(filePath)}`);
  }
  if (nextItems === 0) {
    if (!requireValidNonEmpty) return;
    throw new Error(`Refusing to write empty visual document: ${path.basename(filePath)}`);
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return;

  const previous = fs.readFileSync(filePath, 'utf-8');
  if (!previous.trim()) return;

  const previousItems = countVisualDocumentItems(filePath, previous);
  if (previousItems > 0 && nextContent.length < previous.length * 0.16 && options.blockLargeShrink) {
    throw new Error(
      `Refusing to overwrite visual document with a much smaller file: ${path.basename(filePath)} (${previous.length} bytes -> ${nextContent.length} bytes). Read the existing file and ask the user to confirm replacement first.`,
    );
  }
  if (options.blockLargeShrink && previousItems >= 3 && nextItems > 0) {
    const minimumExpectedItems = Math.max(2, Math.ceil(previousItems * 0.35));
    if (nextItems < minimumExpectedItems) {
      throw new Error(
        `Refusing to overwrite visual document with a much smaller version: ${path.basename(filePath)} (${previousItems} items -> ${nextItems} items). Read the existing file and ask the user to confirm replacement first.`,
      );
    }
  }
}

function listLiveHistory(vaultPath: string, relativePath?: string): any[] {
  const root = liveHistoryRoot(vaultPath);
  if (!fs.existsSync(root)) return [];
  const rows: any[] = [];

  function readVersions(dir: string, encodedRel: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        readVersions(fullPath, encodedRel ? `${encodedRel}/${entry.name}` : entry.name);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const record = readJsonSafe<any>(fullPath, null);
          if (!record) continue;
          const rel = record.relativePath || decodeHistoryRelativePath(encodedRel);
          if (relativePath && rel !== relativePath.replace(/\\/g, '/')) continue;
          rows.push({
            versionId: record.versionId || entry.name.replace(/\.json$/, ''),
            relativePath: rel,
            savedAt: record.savedAt || '',
            reason: record.reason || '',
            deletedSnapshot: !!record.deletedSnapshot,
            size: record.size || 0,
            sha256: record.sha256 || '',
          });
        } catch { /* skip bad record */ }
      }
    }
  }

  readVersions(root, '');
  rows.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  return rows;
}

function findLiveHistoryRecord(vaultPath: string, relativePath: string, versionId: string): { record: any; recordPath: string } {
  const resolvedVault = path.resolve(vaultPath);
  const wantedRel = relativePath.replace(/\\/g, '/');
  const root = liveHistoryRoot(resolvedVault);
  let found: { record: any; recordPath: string } | null = null;

  function findRecord(dir: string): void {
    if (found) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        findRecord(fullPath);
      } else if (entry.isFile() && entry.name === `${versionId}.json`) {
        const record = readJsonSafe<any>(fullPath, null);
        if (record?.relativePath === wantedRel) {
          found = { record, recordPath: fullPath };
          return;
        }
      }
    }
  }

  findRecord(root);
  if (!found) throw new Error('Version record not found');
  return found;
}

function previewLiveHistory(vaultPath: string, relativePath: string, versionId: string): any {
  const resolvedVault = path.resolve(vaultPath);
  const wantedRel = relativePath.replace(/\\/g, '/');
  const { record } = findLiveHistoryRecord(resolvedVault, wantedRel, versionId);
  if (!record?.contentBase64) throw new Error('Version content missing');

  const targetPath = path.resolve(path.join(resolvedVault, wantedRel.replace(/\//g, path.sep)));
  if (!isInsidePath(targetPath, resolvedVault)) throw new Error('Refusing to read outside vault');

  const historyBuffer = Buffer.from(record.contentBase64, 'base64');
  const historyPreview = bufferPreviewText(historyBuffer);
  const currentExists = fs.existsSync(targetPath) && fs.statSync(targetPath).isFile();
  const currentStat = currentExists ? fs.statSync(targetPath) : null;
  const currentPreview = currentExists ? readConflictPreviewText(targetPath) : { content: '', truncated: false };

  return {
    versionId: record.versionId || versionId,
    relativePath: wantedRel,
    savedAt: record.savedAt || '',
    reason: record.reason || '',
    deletedSnapshot: !!record.deletedSnapshot,
    size: record.size || historyBuffer.length,
    sha256: record.sha256 || crypto.createHash('sha256').update(historyBuffer).digest('hex'),
    content: historyPreview.content,
    contentTruncated: historyPreview.truncated,
    currentExists,
    currentSize: currentStat?.size || 0,
    currentModifiedAt: currentStat?.mtime.toISOString() || null,
    currentContent: currentPreview.content,
    currentTruncated: currentPreview.truncated,
    diff: lineDiffSummary(currentPreview.content, historyPreview.content),
  };
}

function restoreLiveHistory(vaultPath: string, relativePath: string, versionId: string): { ok: boolean; restoredPath: string } {
  const resolvedVault = path.resolve(vaultPath);
  const wantedRel = relativePath.replace(/\\/g, '/');
  const candidates = listLiveHistory(resolvedVault, wantedRel).filter(v => v.versionId === versionId);
  if (candidates.length === 0) throw new Error('Version not found');

  const { record } = findLiveHistoryRecord(resolvedVault, wantedRel, versionId);
  if (!record?.contentBase64) throw new Error('Version content missing');
  const targetPath = path.resolve(path.join(resolvedVault, wantedRel.replace(/\//g, path.sep)));
  if (!isInsidePath(targetPath, resolvedVault)) throw new Error('Refusing to restore outside vault');
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  saveLiveHistoryBeforeOverwrite(targetPath, undefined, 'before-history-restore');
  fs.writeFileSync(targetPath, Buffer.from(record.contentBase64, 'base64'));
  return { ok: true, restoredPath: targetPath };
}

function listLiveHistoryRecords(vaultPath: string): Array<{ record: any; recordPath: string }> {
  const root = liveHistoryRoot(vaultPath);
  if (!fs.existsSync(root)) return [];
  const rows: Array<{ record: any; recordPath: string }> = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        const record = readJsonSafe<any>(fullPath, null);
        if (record?.relativePath && record?.versionId) {
          rows.push({ record, recordPath: fullPath });
        }
      }
    }
  }

  walk(root);
  return rows;
}

function isAccidentRecoveryHistoryReason(record: any): boolean {
  const reason = String(record?.reason || '');
  if (record?.deletedSnapshot) return true;
  return /remote|overwrite|delete|trash|stale|conflict|rejected|restore|preflight|server|base|missing|ai/i.test(reason);
}

function normalizeBatchRestoreOptions(options?: any): { sinceHours: number; includeAllReasons: boolean; limit: number } {
  const sinceHoursRaw = Number(options?.sinceHours ?? 48);
  const limitRaw = Number(options?.limit ?? 100);
  return {
    sinceHours: Math.max(1, Math.min(720, Number.isFinite(sinceHoursRaw) ? Math.floor(sinceHoursRaw) : 48)),
    includeAllReasons: !!options?.includeAllReasons,
    limit: Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 100)),
  };
}

function previewLiveHistoryBatchRestore(vaultPath: string, options?: any): any {
  const resolvedVault = path.resolve(vaultPath);
  const opts = normalizeBatchRestoreOptions(options);
  const checkedAt = new Date().toISOString();
  const sinceMs = Date.now() - opts.sinceHours * 60 * 60 * 1000;
  const warnings: string[] = [];

  const candidates = listLiveHistoryRecords(resolvedVault)
    .map(({ record, recordPath }) => ({ record, recordPath, savedMs: Date.parse(record.savedAt || '') }))
    .filter(item => Number.isFinite(item.savedMs) && item.savedMs >= sinceMs)
    .filter(item => !!item.record.contentBase64)
    .filter(item => opts.includeAllReasons || isAccidentRecoveryHistoryReason(item.record))
    .sort((a, b) => b.savedMs - a.savedMs);

  const latestByPath = new Map<string, { record: any; recordPath: string; savedMs: number }>();
  for (const item of candidates) {
    const rel = String(item.record.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel || latestByPath.has(rel)) continue;
    latestByPath.set(rel, item);
  }

  const selected = Array.from(latestByPath.values());
  if (selected.length > opts.limit) {
    warnings.push(`Only the newest ${opts.limit} recoverable files are included. ${selected.length - opts.limit} older file(s) are not shown.`);
  }

  const items = selected.slice(0, opts.limit).map(({ record }) => {
    const rel = String(record.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const targetPath = path.resolve(path.join(resolvedVault, rel.replace(/\//g, path.sep)));
    let action: 'restore' | 'skip' = 'restore';
    let skipReason = '';
    let currentExists = false;
    let currentSize = 0;
    let currentModifiedAt: string | null = null;
    let currentSha256 = '';
    const historyBuffer = Buffer.from(String(record.contentBase64 || ''), 'base64');
    const historySha = record.sha256 || crypto.createHash('sha256').update(historyBuffer).digest('hex');

    try {
      if (!rel || !isInsidePath(targetPath, resolvedVault)) {
        action = 'skip';
        skipReason = 'outside-vault';
      } else if (record.deletedSnapshot) {
        action = 'skip';
        skipReason = 'deleted-snapshot-manual-only';
      } else if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        action = 'skip';
        skipReason = 'target-is-directory';
      } else if (fs.existsSync(targetPath)) {
        const stat = fs.statSync(targetPath);
        currentExists = stat.isFile();
        currentSize = currentExists ? stat.size : 0;
        currentModifiedAt = currentExists ? stat.mtime.toISOString() : null;
        if (currentExists) {
          currentSha256 = fileSha256(targetPath);
          if (currentSha256 === historySha) {
            action = 'skip';
            skipReason = 'same-content';
          }
        }
      }
    } catch (err: any) {
      action = 'skip';
      skipReason = err?.message || 'inspect-failed';
    }

    return {
      versionId: record.versionId || '',
      relativePath: rel,
      savedAt: record.savedAt || '',
      reason: record.reason || '',
      deletedSnapshot: !!record.deletedSnapshot,
      size: record.size || historyBuffer.length,
      sha256: historySha,
      currentExists,
      currentSize,
      currentModifiedAt,
      currentSha256,
      action,
      skipReason,
    };
  });

  const restoreCount = items.filter(item => item.action === 'restore').length;
  const skippedCount = items.length - restoreCount;

  return {
    checkedAt,
    sinceHours: opts.sinceHours,
    includeAllReasons: opts.includeAllReasons,
    limit: opts.limit,
    totalCandidates: selected.length,
    restoreCount,
    skippedCount,
    items,
    warnings,
  };
}

function restoreLiveHistoryBatch(vaultPath: string, options?: any): any {
  const resolvedVault = path.resolve(vaultPath);
  const plan = previewLiveHistoryBatchRestore(resolvedVault, options);
  const restoredFiles: string[] = [];
  const failed: Array<{ relativePath: string; error: string }> = [];

  for (const item of plan.items) {
    if (item.action !== 'restore') continue;
    try {
      const { record } = findLiveHistoryRecord(resolvedVault, item.relativePath, item.versionId);
      if (!record?.contentBase64) throw new Error('Version content missing');
      const targetPath = path.resolve(path.join(resolvedVault, item.relativePath.replace(/\//g, path.sep)));
      if (!isInsidePath(targetPath, resolvedVault)) throw new Error('Refusing to restore outside vault');
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        throw new Error('Target path is a directory');
      }
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      saveLiveHistoryBeforeOverwrite(targetPath, undefined, 'before-batch-history-restore');
      fs.writeFileSync(targetPath, Buffer.from(record.contentBase64, 'base64'));
      restoredFiles.push(item.relativePath);
    } catch (err: any) {
      failed.push({ relativePath: item.relativePath, error: err?.message || 'restore failed' });
    }
  }

  return {
    ok: failed.length === 0,
    restoredCount: restoredFiles.length,
    failedCount: failed.length,
    skippedCount: plan.skippedCount,
    restoredFiles,
    failed,
    plan,
  };
}

/** Validate a file/folder name */
function validateName(name: string): string | null {
  if (!name || !name.trim()) return 'Name cannot be empty';
  const trimmed = name.trim();
  if (ILLEGAL_CHARS.test(trimmed)) return `Name contains illegal characters: <>:"/\\|?*`;
  if (trimmed.endsWith('.')) return 'Name cannot end with a dot';
  if (RESERVED_NAMES.has(trimmed.toUpperCase())) return `"${trimmed}" is a reserved system name`;
  return null;
}

function normalizeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096) return null;
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol.toLowerCase())) return null;
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && (parsed.username || parsed.password)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function protectSecretForDisk(value: unknown): string {
  const secret = typeof value === 'string' ? value : '';
  if (!secret) return '';
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('OS credential encryption is unavailable; the secret will remain memory-only.');
    return '';
  }
  return PROTECTED_SECRET_PREFIX + safeStorage.encryptString(secret).toString('base64');
}

function revealSecretFromDisk(value: unknown): { secret: string; legacyPlaintext: boolean } {
  const stored = typeof value === 'string' ? value : '';
  if (!stored) return { secret: '', legacyPlaintext: false };
  if (!stored.startsWith(PROTECTED_SECRET_PREFIX)) {
    return { secret: stored, legacyPlaintext: true };
  }
  if (!safeStorage.isEncryptionAvailable()) return { secret: '', legacyPlaintext: false };
  try {
    const encrypted = Buffer.from(stored.slice(PROTECTED_SECRET_PREFIX.length), 'base64');
    return { secret: safeStorage.decryptString(encrypted), legacyPlaintext: false };
  } catch (err) {
    console.error('Failed to decrypt a stored credential:', err);
    return { secret: '', legacyPlaintext: false };
  }
}

/* ── Window creation ── */
function createWindow(): void {
  const windowIconPath = path.join(__dirname, '..', 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Ars-note',
    backgroundColor: '#1b2027',
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    ...(fs.existsSync(windowIconPath) ? { icon: windowIconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);

  const emitWindowMaximizedChanged = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('window:maximized-changed', {
      maximized: mainWindow.isMaximized(),
    });
  };
  mainWindow.on('maximize', emitWindowMaximizedChanged);
  mainWindow.on('unmaximize', emitWindowMaximizedChanged);
  mainWindow.on('restore', emitWindowMaximizedChanged);
  mainWindow.on('unresponsive', () => {
    recordClientCrash('window-unresponsive', { url: mainWindow?.webContents.getURL() || '' });
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || handlingRendererCrash) return;
    handlingRendererCrash = true;
    const reportPath = recordClientCrash('renderer-process', details);
    const crashDialogOptions: MessageBoxOptions = {
      type: 'error',
      title: 'Ars-note 页面已停止运行',
      message: '编辑界面发生异常。已保存的工作区会在重新启动后恢复。',
      detail: reportPath ? `崩溃报告：${reportPath}` : `原因：${details.reason}`,
      buttons: ['重新启动', '关闭'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
    const crashDialog = mainWindow
      ? dialog.showMessageBox(mainWindow, crashDialogOptions)
      : dialog.showMessageBox(crashDialogOptions);
    void crashDialog.then((response) => {
      if (response.response === 0) app.relaunch();
      app.exit(0);
    }).catch(() => app.exit(1));
  });

  const isDev = process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const safeUrl = normalizeExternalUrl(url);
    if (safeUrl) void shell.openExternal(safeUrl).catch(() => {});
    return { action: 'deny' };
  });
}

/* ── App lifecycle ── */
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { app.quit(); });
app.on('activate', () => { if (!mainWindow) createWindow(); });

/* ────────────────────── IPC Handlers ────────────────────── */

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { /* ignore */ }
  return fallback;
}

function writeJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

type TeamScheduleTaskStatus = 'todo' | 'doing' | 'review' | 'blocked' | 'done';
type TeamScheduleTaskPriority = 'high' | 'medium' | 'low';
type TeamReviewResult = 'approved' | 'changes' | 'note';
type TeamMemberLoadLevel = 'danger' | 'warning' | 'ok';
type ProductionQAItemType = 'bug' | 'playtest' | 'feedback';
type ProductionNarrativeStage = 'worldbuilding' | 'story' | 'quest' | 'dialogue' | 'performance' | 'taskTable';
type TeamChangeImpactStage = ProductionNarrativeStage | 'qa' | 'ui' | 'art' | 'code' | 'audio' | 'production' | 'generic';

interface TeamAssignmentLoadState {
  member: string;
  active: number;
  remainingMinutes: number;
  high: number;
  blocked: number;
  overdue: number;
  assignedDrafts: number;
  level: TeamMemberLoadLevel;
}

interface TeamAssignmentReassignment {
  title: string;
  fromOwner: string;
  toOwner: string;
  reason: string;
  projectedLoad: string;
}

interface TeamAssignmentReview {
  ok: boolean;
  candidateCount: number;
  reassignedCount: number;
  reassignments: TeamAssignmentReassignment[];
  warnings: string[];
}

interface TeamScheduleUpsertOptions {
  balanceAssignments?: boolean;
}

interface TeamScheduleUpsertResult {
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  schedulePath: string;
  content: string;
  assignmentReview?: TeamAssignmentReview;
}

function nowIso(): string {
  return new Date().toISOString();
}

function teamSchedulePath(vaultPath: string): string {
  return path.join(path.resolve(vaultPath), TEAM_SCHEDULE_DIR, TEAM_SCHEDULE_FILE);
}

function normalizeTeamScheduleText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeTeamSchedulePath(value: unknown): string {
  return normalizeTeamScheduleText(value).replace(/\\/g, '/').replace(/^\/+/, '');
}

function normalizeTeamTaskStatus(value: unknown): TeamScheduleTaskStatus {
  if (value === 'todo' || value === 'doing' || value === 'review' || value === 'blocked' || value === 'done') return value;
  if (value === 'wip') return 'doing';
  return 'todo';
}

function normalizeTeamTaskPriority(value: unknown): TeamScheduleTaskPriority {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  const raw = normalizeTeamScheduleText(value).toLowerCase();
  if (/p0|p1|urgent|critical|high|高|紧急/.test(raw)) return 'high';
  if (/p3|low|低|以后/.test(raw)) return 'low';
  return 'medium';
}

function normalizeTeamReviewResult(value: unknown): TeamReviewResult {
  if (value === 'approved' || value === 'changes' || value === 'note') return value;
  const raw = normalizeTeamScheduleText(value).toLowerCase();
  if (/pass|approve|done|通过|完成/.test(raw)) return 'approved';
  if (/change|reject|fail|return|退回|修改|不通过/.test(raw)) return 'changes';
  return 'note';
}

function normalizeTeamScheduleDate(value: unknown): string {
  const raw = normalizeTeamScheduleText(value);
  const match = raw.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!match) return '';
  return [match[1], match[2].padStart(2, '0'), match[3].padStart(2, '0')].join('-');
}

function parseTeamScheduleMinutes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function teamTaskKey(task: { title?: unknown; owner?: unknown; linkedDoc?: unknown }): string {
  return [
    normalizeTeamScheduleText(task.title).toLowerCase(),
    normalizeTeamScheduleText(task.owner).toLowerCase(),
    normalizeTeamSchedulePath(task.linkedDoc).toLowerCase(),
  ].join('|');
}

function normalizeTeamScheduleData(raw: any): any {
  const schedule = raw && typeof raw === 'object' ? raw : {};
  const tasks = Array.isArray(schedule.tasks)
    ? schedule.tasks
      .filter((task: any) => task && typeof task === 'object')
      .map((task: any) => ({
        ...task,
        logs: Array.isArray(task.logs) ? task.logs : [],
        reviewLogs: Array.isArray(task.reviewLogs) ? task.reviewLogs : [],
      }))
    : [];
  const members = new Set<string>();
  for (const member of Array.isArray(schedule.members) ? schedule.members : []) {
    const clean = normalizeTeamScheduleText(member);
    if (clean) members.add(clean);
  }
  for (const task of tasks) {
    const owner = normalizeTeamScheduleText(task.owner);
    if (owner && owner !== '未分配') members.add(owner);
    for (const review of Array.isArray(task.reviewLogs) ? task.reviewLogs : []) {
      const reviewer = normalizeTeamScheduleText(review?.reviewer || review?.member);
      if (reviewer && reviewer !== '未分配') members.add(reviewer);
    }
  }
  return {
    version: 1,
    updatedAt: typeof schedule.updatedAt === 'string' ? schedule.updatedAt : nowIso(),
    members: Array.from(members).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    tasks,
    deletedTaskIds: Array.isArray(schedule.deletedTaskIds) ? schedule.deletedTaskIds.filter((id: unknown) => typeof id === 'string') : [],
  };
}

function readTeamScheduleData(vaultPath: string): any {
  return normalizeTeamScheduleData(readJsonSafe<any>(teamSchedulePath(vaultPath), null));
}

function summarizeTeamSchedule(schedule: any): any {
  const today = new Date().toISOString().slice(0, 10);
  let totalMinutes = 0;
  const stats = {
    total: 0,
    active: 0,
    done: 0,
    blocked: 0,
    overdue: 0,
    missingOwner: 0,
    missingDueDate: 0,
    totalMinutes: 0,
  };
  for (const task of schedule.tasks || []) {
    const status = normalizeTeamTaskStatus(task.status);
    const dueDate = normalizeTeamScheduleDate(task.dueDate);
    const owner = normalizeTeamScheduleText(task.owner);
    const logs = Array.isArray(task.logs) ? task.logs : [];
    const spent = logs.reduce((sum: number, log: any) => sum + parseTeamScheduleMinutes(log?.minutes), 0);
    totalMinutes += spent;
    stats.total += 1;
    if (status === 'done') stats.done += 1;
    else stats.active += 1;
    if (status === 'blocked') stats.blocked += 1;
    if (status !== 'done' && dueDate && dueDate < today) stats.overdue += 1;
    if (status !== 'done' && (!owner || owner === '未分配')) stats.missingOwner += 1;
    if (status !== 'done' && !dueDate) stats.missingDueDate += 1;
  }
  stats.totalMinutes = totalMinutes;
  return stats;
}

function addDaysIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function taskSpentMinutesForBrief(task: any): number {
  return (Array.isArray(task?.logs) ? task.logs : [])
    .reduce((sum: number, log: any) => sum + parseTeamScheduleMinutes(log?.minutes), 0);
}

function latestTeamReviewLog(task: any): any | null {
  const reviews = Array.isArray(task?.reviewLogs) ? task.reviewLogs : [];
  return reviews
    .filter((log: any) => log && typeof log === 'object')
    .slice()
    .sort((a: any, b: any) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')))[0] || null;
}

function teamReviewLogSummary(log: any): string {
  const result = normalizeTeamReviewResult(log?.result || log?.status || log?.conclusion);
  const label = result === 'approved' ? '通过' : result === 'changes' ? '退回' : '复查';
  const reviewer = normalizeTeamScheduleText(log?.reviewer || log?.member) || '未分配';
  const date = normalizeTeamScheduleDate(log?.date) || '-';
  const note = normalizeTeamScheduleText(log?.note);
  return `${label} · ${reviewer} · ${date}${note ? ` · ${note}` : ''}`;
}

function teamTaskBrief(task: any): any {
  const logs = Array.isArray(task?.logs) ? task.logs : [];
  const latestReview = latestTeamReviewLog(task);
  const latestLog = logs
    .slice()
    .sort((a: any, b: any) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')))[0];
  return {
    id: typeof task?.id === 'string' ? task.id : '',
    title: normalizeTeamScheduleText(task?.title),
    owner: normalizeTeamScheduleText(task?.owner),
    status: normalizeTeamTaskStatus(task?.status),
    priority: normalizeTeamTaskPriority(task?.priority),
    dueDate: normalizeTeamScheduleDate(task?.dueDate),
    linkedDoc: normalizeTeamSchedulePath(task?.linkedDoc),
    deliverable: normalizeTeamScheduleText(task?.deliverable),
    dependency: normalizeTeamScheduleText(task?.dependency),
    blocker: normalizeTeamScheduleText(task?.blocker),
    acceptance: normalizeTeamScheduleText(task?.acceptance),
    spentMinutes: taskSpentMinutesForBrief(task),
    estimateMinutes: parseTeamScheduleMinutes(task?.estimateMinutes),
    updatedAt: typeof task?.updatedAt === 'string' ? task.updatedAt : '',
    latestLog: latestLog ? {
      member: normalizeTeamScheduleText(latestLog.member),
      date: normalizeTeamScheduleDate(latestLog.date),
      minutes: parseTeamScheduleMinutes(latestLog.minutes),
      note: normalizeTeamScheduleText(latestLog.note).slice(0, 240),
    } : null,
    latestReview: latestReview ? {
      reviewer: normalizeTeamScheduleText(latestReview.reviewer || latestReview.member),
      date: normalizeTeamScheduleDate(latestReview.date),
      result: normalizeTeamReviewResult(latestReview.result || latestReview.status || latestReview.conclusion),
      note: normalizeTeamScheduleText(latestReview.note).slice(0, 240),
    } : null,
  };
}

function linkedTeamDocExists(vaultPath: string, linkedDoc: unknown): boolean {
  const relativePath = normalizeTeamSchedulePath(linkedDoc);
  if (!relativePath || !relativePath.toLowerCase().endsWith('.md')) return false;
  const fullPath = path.resolve(vaultPath, relativePath);
  const root = path.resolve(vaultPath);
  if (fullPath !== root && !fullPath.startsWith(root + path.sep)) return false;
  return fs.existsSync(fullPath);
}

function safeTeamTaskFileName(value: unknown): string {
  const clean = normalizeTeamScheduleText(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 80);
  return clean || 'Task';
}

function normalizeTeamTaskWorkDocPath(task: any, usedPaths: Set<string>): string {
  let relativePath = normalizeTeamSchedulePath(task?.linkedDoc);
  if (!relativePath || !relativePath.toLowerCase().endsWith('.md')) {
    relativePath = `07_Unity_Tasks/${safeTeamTaskFileName(task?.title || task?.id)}.md`;
  }
  const parts = relativePath
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..');
  relativePath = parts.join('/');
  if (!relativePath.toLowerCase().endsWith('.md')) relativePath += '.md';
  if (!relativePath) relativePath = `07_Unity_Tasks/${safeTeamTaskFileName(task?.title || task?.id)}.md`;

  const parsed = path.posix.parse(relativePath);
  const base = path.posix.join(parsed.dir, parsed.name);
  let candidate = `${base}${parsed.ext || '.md'}`;
  let index = 2;
  while (usedPaths.has(candidate.toLowerCase())) {
    candidate = `${base}-${index}${parsed.ext || '.md'}`;
    index += 1;
  }
  usedPaths.add(candidate.toLowerCase());
  return candidate;
}

function inferTeamTaskDiscipline(task: any): string {
  const haystack = [
    task?.title,
    task?.owner,
    task?.linkedDoc,
    task?.deliverable,
    task?.dependency,
    task?.notes,
  ].join(' ').toLowerCase();
  if (/(qa|bug|test|verify|retest|playtest|feedback|测试|验收|复测|缺陷|问题|试玩|反馈)/i.test(haystack)) return 'qa';
  if (/(dialogue|voice|subtitle|台词|对白|语音|配音)/i.test(haystack)) return 'dialogue';
  if (/(performance|cutscene|cinematic|camera|animation|vfx|演出|镜头|动画|分镜|过场)/i.test(haystack)) return 'performance';
  if (/(quest|level|mission|任务|关卡|玩法)/i.test(haystack)) return 'quest';
  if (/(world|lore|story|narrative|character|世界观|剧情|叙事|角色)/i.test(haystack)) return 'narrative';
  if (/(ui|ux|hud|prototype|wireframe|界面|按钮|菜单|交互|原型)/i.test(haystack)) return 'ui';
  if (/(art|asset|spine|vfx|icon|美术|贴图|模型|特效|立绘|场景)/i.test(haystack)) return 'art';
  if (/(audio|sfx|bgm|音乐|音效|声音)/i.test(haystack)) return 'audio';
  if (/(unity|code|script|prefab|program|工程|程序|开发|实现|接口|数据)/i.test(haystack)) return 'code';
  if (/(producer|production|schedule|milestone|排期|里程碑|协调|制片)/i.test(haystack)) return 'production';
  return 'generic';
}

function buildTeamTaskAcceptanceChecklist(task: any): string {
  const title = normalizeTeamScheduleText(task?.title) || 'Task';
  const linkedDoc = normalizeTeamSchedulePath(task?.linkedDoc);
  const base = [
    `- [ ] Deliverable matches the scope of "${title}".`,
    linkedDoc
      ? `- [ ] Linked work document \`${linkedDoc}\` is updated and can be opened from the team schedule.`
      : '- [ ] A concrete linked work document or delivery location is recorded.',
  ];
  const templates: Record<string, string[]> = {
    narrative: [
      '- [ ] World rules, character motivation, story causality, and existing canon do not conflict.',
      '- [ ] Upstream sources, downstream impact, open questions, and at least 2 valid wiki links are recorded.',
      '- [ ] Status, owner, priority, dependency, and acceptance criteria are clear enough for AI narrative takeover.',
    ],
    quest: [
      '- [ ] Player goal, trigger, completion, failure, interruption, reward, and state changes are specified.',
      '- [ ] Related dialogue, performance, level, and implementation dependencies are linked.',
      '- [ ] QA can follow a clear test path in-game or in Unity.',
    ],
    dialogue: [
      '- [ ] Each line fits the speaker, emotion, scene beat, and narrative state.',
      '- [ ] Trigger, speaker, tone, performance cue, branch condition, and localization needs are recorded.',
      '- [ ] Voice/subtitle/UI follow-up is marked where needed.',
    ],
    performance: [
      '- [ ] Beat list covers camera, blocking, animation, VFX, SFX/BGM, UI prompt, and trigger.',
      '- [ ] Skip, interrupt, replay, and failure states are described.',
      '- [ ] Required dialogue, character, scene, and asset dependencies are linked.',
    ],
    ui: [
      '- [ ] Default, hover, pressed, disabled, loading, error, and empty states are covered.',
      '- [ ] Layout, hierarchy, feedback, keyboard/controller input, and implementation notes are clear.',
      '- [ ] Prototype or screenshot references are linked.',
    ],
    art: [
      '- [ ] Asset list, naming, size, export format, source file, and Unity import target are recorded.',
      '- [ ] Visual style matches worldbuilding, character, and scene requirements.',
      '- [ ] Animation/VFX states or variants are marked where needed.',
    ],
    audio: [
      '- [ ] Usage, trigger, loop, fade, priority, and mix notes are clear.',
      '- [ ] File spec, naming, loudness, format, and Unity import location are recorded.',
      '- [ ] Sync points with animation, performance, UI, or gameplay events are listed.',
    ],
    code: [
      '- [ ] Entry points, data fields, edge cases, and error handling are described.',
      '- [ ] Related prefab, script, config, scene, or data paths are recorded.',
      '- [ ] Local run or retest steps are included.',
    ],
    qa: [
      '- [ ] Repro steps, expected result, actual result, environment, and severity are recorded.',
      '- [ ] Retest result and remaining risk are written after the fix.',
      '- [ ] Related task, document, screenshot, recording, or log is linked.',
    ],
    production: [
      '- [ ] Owner, due date, dependency, blocker, and next action are clear.',
      '- [ ] Work can be tracked from member pages, daily workpacks, and the command center.',
      '- [ ] Risks have a responsible person and review time.',
    ],
    generic: [
      '- [ ] Dependencies, risks, and unresolved questions are written down.',
      '- [ ] Actual time spent and completion notes are recorded.',
      '- [ ] Producer or owner confirms it can move to the next stage.',
    ],
  };
  return [...base, ...(templates[inferTeamTaskDiscipline(task)] || templates.generic)].join('\n');
}

function buildTeamTaskWorkDoc(task: any, relativePath: string): string {
  const acceptance = normalizeTeamScheduleText(task?.acceptance) || buildTeamTaskAcceptanceChecklist({ ...task, linkedDoc: relativePath });
  const status = normalizeTeamTaskStatus(task?.status);
  const priority = normalizeTeamTaskPriority(task?.priority);
  const estimateMinutes = parseTeamScheduleMinutes(task?.estimateMinutes);
  const title = normalizeTeamScheduleText(task?.title) || 'Task Work Document';
  const owner = normalizeTeamScheduleText(task?.owner) || 'Unassigned';
  const discipline = inferTeamTaskDiscipline(task);
  const dateKey = teamTodayString().replace(/-/g, '');
  const lines: string[] = [];
  lines.push('---');
  lines.push('type: ars-task-workdoc');
  lines.push(`title: ${JSON.stringify(title)}`);
  lines.push(`taskId: ${JSON.stringify(normalizeTeamScheduleText(task?.id))}`);
  lines.push(`owner: ${JSON.stringify(owner)}`);
  lines.push(`status: ${JSON.stringify(status)}`);
  lines.push(`priority: ${JSON.stringify(priority)}`);
  lines.push(`discipline: ${JSON.stringify(discipline)}`);
  lines.push(`linkedDoc: ${JSON.stringify(relativePath)}`);
  lines.push(`startDate: ${JSON.stringify(normalizeTeamScheduleDate(task?.startDate))}`);
  lines.push(`dueDate: ${JSON.stringify(normalizeTeamScheduleDate(task?.dueDate))}`);
  lines.push(`estimateMinutes: ${JSON.stringify(estimateMinutes)}`);
  lines.push(`dependency: ${JSON.stringify(normalizeTeamScheduleText(task?.dependency))}`);
  lines.push(`blocker: ${JSON.stringify(normalizeTeamScheduleText(task?.blocker))}`);
  lines.push(`acceptance: ${JSON.stringify(acceptance)}`);
  lines.push(`schedule: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`)}`);
  lines.push(`teamDashboard: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/team-dashboard.md`)}`);
  lines.push(`obsidianCommandCenter: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/${teamObsidianCommandCenterFileName()}`)}`);
  lines.push(`aiHandoff: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/ai-handoff.md`)}`);
  lines.push(`linkHealth: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/${teamLinkHealthFileName()}`)}`);
  lines.push(`generatedAt: ${JSON.stringify(new Date().toISOString())}`);
  lines.push('aliases:');
  lines.push(`  - ${JSON.stringify(title)}`);
  lines.push('tags:');
  lines.push('  - ars-task');
  lines.push('  - game-dev');
  lines.push('  - team-production');
  lines.push(`  - discipline-${discipline}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`> Generated from the team schedule. Vault path: \`${relativePath}\`.`);
  lines.push('');
  lines.push('## Obsidian Workflow');
  lines.push(`- Team dashboard: [[${TEAM_SCHEDULE_DIR}/team-dashboard|team-dashboard]]`);
  lines.push(`- Obsidian command center: [[${TEAM_SCHEDULE_DIR}/${teamObsidianCommandCenterFileName().replace(/\.md$/i, '')}|${teamObsidianCommandCenterFileName().replace(/\.md$/i, '')}]]`);
  lines.push(`- AI handoff: [[${TEAM_SCHEDULE_DIR}/ai-handoff|ai-handoff]]`);
  lines.push(`- Link health: [[${TEAM_SCHEDULE_DIR}/${teamLinkHealthFileName().replace(/\.md$/i, '')}|${teamLinkHealthFileName().replace(/\.md$/i, '')}]]`);
  lines.push(`- Daily workpack: [[${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${dateKey}|daily-workpack-${dateKey}]]`);
  lines.push(`- Personal page: [[${TEAM_SCHEDULE_DIR}/members/${safeTeamMemberFileName(owner)}|${owner}]]`);
  lines.push('- Edit status, owner, priority, dueDate, dependency, blocker, or acceptance in frontmatter, then run `sync_team_task_docs` or click "sync task docs" in the team schedule.');
  lines.push('- Checking acceptance boxes can move a task to review; review logs can move it to done or doing.');
  lines.push('');
  lines.push('## Task Summary');
  lines.push(`- Owner: ${owner}`);
  lines.push(`- Status: ${status}`);
  lines.push(`- Priority: ${priority}`);
  lines.push(`- Discipline: ${discipline}`);
  lines.push(`- Start: ${normalizeTeamScheduleDate(task?.startDate) || '-'}`);
  lines.push(`- Due: ${normalizeTeamScheduleDate(task?.dueDate) || '-'}`);
  lines.push(`- Estimate: ${estimateMinutes ? formatTeamMinutes(estimateMinutes) : 'Not estimated'}`);
  lines.push('');
  lines.push('## Deliverable');
  lines.push(normalizeTeamScheduleText(task?.deliverable) || '- Fill in the concrete output.');
  lines.push('');
  lines.push('## Dependencies And Blockers');
  lines.push(`- Dependency: ${normalizeTeamScheduleText(task?.dependency) || 'None or not yet recorded.'}`);
  lines.push(`- Blocker: ${normalizeTeamScheduleText(task?.blocker) || 'None.'}`);
  lines.push('');
  lines.push('## Acceptance Criteria');
  lines.push(acceptance);
  lines.push('');
  lines.push('## Execution Checklist');
  lines.push('- [ ] Read related GDD, worldbuilding, quest, UI, art, code, or QA documents.');
  lines.push('- [ ] Produce the first deliverable.');
  lines.push('- [ ] Self-check dependencies, risks, and acceptance criteria.');
  lines.push('- [ ] Ask the owner or producer for review.');
  lines.push('');
  lines.push('## Implementation Notes');
  lines.push(normalizeTeamScheduleText(task?.notes) ? `- Initial note: ${normalizeTeamScheduleText(task?.notes)}` : '- Record decisions, changed files, asset paths, and issues here.');
  lines.push('');
  lines.push('## Related Files And Links');
  lines.push('- Upstream docs:');
  lines.push('- Downstream implementation files:');
  lines.push('- Screenshots, recordings, assets, or Unity paths:');
  lines.push('');
  lines.push('## Time Log');
  lines.push('> Use this format, then run "sync task docs" from the team schedule:');
  lines.push('- YYYY-MM-DD | Member | 45m | What was done');
  lines.push('- 45m | What was done');
  lines.push('');
  lines.push('## Review Log');
  lines.push('> Use this format, then run "sync task docs"; result can be approved / changes / note.');
  lines.push('- YYYY-MM-DD | Reviewer | approved | Review note');
  lines.push('- approved | Review note');
  lines.push('');
  lines.push('## Dataview');
  lines.push('```dataview');
  lines.push('TABLE owner, status, priority, dueDate, estimateMinutes');
  lines.push('FROM #ars-task');
  lines.push('WHERE taskId = this.taskId');
  lines.push('```');
  const reviewLogs = Array.isArray(task?.reviewLogs) ? task.reviewLogs : [];
  if (reviewLogs.length > 0) {
    lines.push('');
    lines.push('### Synced Review History');
    for (const log of reviewLogs.slice(0, 8)) {
      lines.push(`- ${normalizeTeamScheduleDate(log?.date) || teamTodayString()} | ${normalizeTeamScheduleText(log?.reviewer || log?.member) || 'Unassigned'} | ${normalizeTeamReviewResult(log?.result || log?.status || log?.conclusion)} | ${normalizeTeamScheduleText(log?.note) || '-'}`);
    }
  }
  return lines.join('\n');
}

function buildTeamTaskWorkDocMetadata(task: any, relativePath: string): {
  scalars: Record<string, string>;
  aliases: string[];
  tags: string[];
} {
  const acceptance = normalizeTeamScheduleText(task?.acceptance) || buildTeamTaskAcceptanceChecklist({ ...task, linkedDoc: relativePath });
  const status = normalizeTeamTaskStatus(task?.status);
  const priority = normalizeTeamTaskPriority(task?.priority);
  const estimateMinutes = parseTeamScheduleMinutes(task?.estimateMinutes);
  const title = normalizeTeamScheduleText(task?.title) || 'Task Work Document';
  const owner = normalizeTeamScheduleText(task?.owner) || 'Unassigned';
  const discipline = inferTeamTaskDiscipline(task);
  return {
    scalars: {
      type: 'ars-task-workdoc',
      title,
      taskId: normalizeTeamScheduleText(task?.id),
      owner,
      status,
      priority,
      discipline,
      linkedDoc: relativePath,
      startDate: normalizeTeamScheduleDate(task?.startDate),
      dueDate: normalizeTeamScheduleDate(task?.dueDate),
      estimateMinutes: String(estimateMinutes),
      dependency: normalizeTeamScheduleText(task?.dependency),
      blocker: normalizeTeamScheduleText(task?.blocker),
      acceptance,
      schedule: `${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`,
      teamDashboard: `${TEAM_SCHEDULE_DIR}/team-dashboard.md`,
      aiHandoff: `${TEAM_SCHEDULE_DIR}/ai-handoff.md`,
      obsidianCommandCenter: `${TEAM_SCHEDULE_DIR}/${teamObsidianCommandCenterFileName()}`,
      linkHealth: `${TEAM_SCHEDULE_DIR}/${teamLinkHealthFileName()}`,
      generatedAt: new Date().toISOString(),
    },
    aliases: [title],
    tags: ['ars-task', 'game-dev', 'team-production', `discipline-${discipline}`],
  };
}

function yamlScalarLine(key: string, value: string): string {
  return `${key}: ${JSON.stringify(value || '')}`;
}

function upsertTeamTaskYamlList(lines: string[], key: string, values: string[]): boolean {
  const keyRe = new RegExp(`^\\s*${key}\\s*:\\s*(.*)$`, 'i');
  const index = lines.findIndex((line) => keyRe.test(line));
  if (index < 0) {
    lines.push(`${key}:`);
    for (const value of values) lines.push(`  - ${JSON.stringify(value)}`);
    return values.length > 0;
  }

  const existing = new Set<string>();
  const inline = lines[index].match(keyRe)?.[1]?.trim() || '';
  if (inline) {
    for (const item of inline.replace(/^\[|\]$/g, '').split(',')) {
      const clean = item.trim().replace(/^['"]|['"]$/g, '');
      if (clean) existing.add(clean);
    }
  }

  let insertAt = index + 1;
  while (insertAt < lines.length && /^\s+-\s+/.test(lines[insertAt])) {
    const clean = lines[insertAt].replace(/^\s+-\s+/, '').trim().replace(/^['"]|['"]$/g, '');
    if (clean) existing.add(clean);
    insertAt += 1;
  }

  const missing = values.filter((value) => value && !existing.has(value));
  if (missing.length === 0) return false;
  if (inline) {
    lines[index] = `${key}:`;
    const inlineValues = Array.from(existing).filter(Boolean);
    lines.splice(index + 1, 0, ...inlineValues.map((value) => `  - ${JSON.stringify(value)}`));
    insertAt = index + 1 + inlineValues.length;
  }
  lines.splice(insertAt, 0, ...missing.map((value) => `  - ${JSON.stringify(value)}`));
  return true;
}

function upgradeTeamTaskWorkDocContent(content: string, task: any, relativePath: string): { content: string; changed: boolean } {
  const metadata = buildTeamTaskWorkDocMetadata(task, relativePath);
  const raw = String(content || '');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  let body = raw;
  let lines: string[] = [];
  let changed = false;

  if (match) {
    body = raw.slice(match[0].length);
    lines = match[1].split(/\r?\n/);
  } else {
    changed = true;
  }

  const hasKey = (key: string): boolean => lines.some((line) => new RegExp(`^\\s*${key}\\s*:`, 'i').test(line));
  for (const [key, value] of Object.entries(metadata.scalars)) {
    if (!hasKey(key)) {
      lines.push(yamlScalarLine(key, value));
      changed = true;
    }
  }
  if (upsertTeamTaskYamlList(lines, 'aliases', metadata.aliases)) changed = true;
  if (upsertTeamTaskYamlList(lines, 'tags', metadata.tags)) changed = true;

  const sectionExists = (title: string): boolean => new RegExp(`(^|\\n)#{1,6}\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(\\n|$)`, 'i').test(body);
  const dateKey = teamTodayString().replace(/-/g, '');
  const owner = normalizeTeamScheduleText(task?.owner) || 'Unassigned';
  const sections: string[] = [];

  if (!sectionExists('Obsidian Workflow')) {
    sections.push([
      '## Obsidian Workflow',
      `- Team dashboard: [[${TEAM_SCHEDULE_DIR}/team-dashboard|team-dashboard]]`,
      `- Obsidian command center: [[${TEAM_SCHEDULE_DIR}/${teamObsidianCommandCenterFileName().replace(/\.md$/i, '')}|${teamObsidianCommandCenterFileName().replace(/\.md$/i, '')}]]`,
      `- AI handoff: [[${TEAM_SCHEDULE_DIR}/ai-handoff|ai-handoff]]`,
      `- Link health: [[${TEAM_SCHEDULE_DIR}/${teamLinkHealthFileName().replace(/\.md$/i, '')}|${teamLinkHealthFileName().replace(/\.md$/i, '')}]]`,
      `- Daily workpack: [[${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${dateKey}|daily-workpack-${dateKey}]]`,
      `- Personal page: [[${TEAM_SCHEDULE_DIR}/members/${safeTeamMemberFileName(owner)}|${owner}]]`,
      '- Edit status, owner, priority, dueDate, dependency, blocker, or acceptance in frontmatter, then run `sync_team_task_docs` or click "sync task docs" in the team schedule.',
      '- Checking acceptance boxes can move a task to review; review logs can move it to done or doing.',
    ].join('\n'));
  }
  if (!sectionExists('Related Files And Links')) {
    sections.push([
      '## Related Files And Links',
      '- Upstream docs:',
      '- Downstream implementation files:',
      '- Screenshots, recordings, assets, or Unity paths:',
    ].join('\n'));
  }
  if (!sectionExists('Work Log') && !sectionExists('Time Log')) {
    sections.push([
      '## Work Log',
      '> Use this format, then run "sync task docs" from the team schedule:',
      '- YYYY-MM-DD | Member | 45m | What was done',
      '- 45m | What was done',
    ].join('\n'));
  }
  if (!sectionExists('Review Log') && !sectionExists('Review Result')) {
    sections.push([
      '## Review Log',
      '> Use this format, then run "sync task docs"; result can be approved / changes / note.',
      '- YYYY-MM-DD | Reviewer | approved | Review note',
      '- approved | Review note',
    ].join('\n'));
  }
  if (!sectionExists('Dataview')) {
    sections.push([
      '## Dataview',
      '```dataview',
      'TABLE owner, status, priority, dueDate, estimateMinutes',
      'FROM #ars-task',
      'WHERE taskId = this.taskId',
      '```',
    ].join('\n'));
  }
  if (sections.length > 0) {
    body = `${body.trimEnd()}\n\n${sections.join('\n\n')}\n`;
    changed = true;
  }

  if (!changed) return { content: raw, changed: false };
  return {
    content: `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\s+/, '')}`,
    changed: true,
  };
}

function ensureTeamTaskWorkDocs(vaultPath: string, options: { limit?: number } = {}): { createdCount: number; linkedCount: number; alreadyExistsCount: number; upgradedCount: number; skippedCount: number; checkedCount: number; paths: string[]; schedulePath: string; content: string } {
  const resolvedVault = path.resolve(vaultPath);
  const scheduleFile = teamSchedulePath(resolvedVault);
  const schedule = readTeamScheduleData(resolvedVault);
  const tasks = Array.isArray(schedule.tasks) ? schedule.tasks : [];
  const limit = Math.max(1, Math.min(500, Math.floor(Number(options.limit) || 500)));
  const usedPaths = new Set<string>();
  for (const task of tasks) {
    const rel = normalizeTeamSchedulePath(task?.linkedDoc);
    if (rel && linkedTeamDocExists(resolvedVault, rel)) usedPaths.add(rel.toLowerCase());
  }

  const nextTasks: any[] = [];
  const paths: string[] = [];
  let createdCount = 0;
  let linkedCount = 0;
  let alreadyExistsCount = 0;
  let upgradedCount = 0;
  let skippedCount = 0;
  let checkedCount = 0;

  for (const task of tasks) {
    const status = normalizeTeamTaskStatus(task?.status);
    if (status === 'done' || checkedCount >= limit) {
      nextTasks.push(task);
      continue;
    }
    checkedCount += 1;

    const existingRel = normalizeTeamSchedulePath(task?.linkedDoc);
    const existingDoc = existingRel && existingRel.toLowerCase().endsWith('.md') && linkedTeamDocExists(resolvedVault, existingRel);
    if (existingDoc) {
      try {
        const existingPath = path.resolve(resolvedVault, existingRel);
        const existingContent = fs.readFileSync(existingPath, 'utf-8');
        const upgraded = upgradeTeamTaskWorkDocContent(existingContent, task, existingRel);
        if (upgraded.changed) {
          saveLiveHistoryBeforeOverwrite(existingPath, upgraded.content, 'ai-team-task-workdoc-upgrade');
          fs.writeFileSync(existingPath, upgraded.content, 'utf-8');
          upgradedCount += 1;
          paths.push(existingRel);
        }
      } catch {
        skippedCount += 1;
      }
      nextTasks.push(task);
      continue;
    }

    const relativePath = normalizeTeamTaskWorkDocPath(task, usedPaths);
    const fullPath = path.resolve(resolvedVault, relativePath);
    if (fullPath === resolvedVault || !fullPath.startsWith(resolvedVault + path.sep)) {
      skippedCount += 1;
      nextTasks.push(task);
      continue;
    }

    const nextTask = task?.linkedDoc === relativePath
      ? task
      : { ...task, linkedDoc: relativePath, updatedAt: nowIso() };
    if (nextTask !== task) linkedCount += 1;

    if (fs.existsSync(fullPath)) {
      alreadyExistsCount += 1;
      try {
        const existingContent = fs.readFileSync(fullPath, 'utf-8');
        const upgraded = upgradeTeamTaskWorkDocContent(existingContent, nextTask, relativePath);
        if (upgraded.changed) {
          saveLiveHistoryBeforeOverwrite(fullPath, upgraded.content, 'ai-team-task-workdoc-upgrade');
          fs.writeFileSync(fullPath, upgraded.content, 'utf-8');
          upgradedCount += 1;
          paths.push(relativePath);
        }
      } catch {
        skippedCount += 1;
      }
    } else {
      const content = buildTeamTaskWorkDoc(nextTask, relativePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      saveLiveHistoryBeforeOverwrite(fullPath, content, 'ai-team-task-workdoc');
      fs.writeFileSync(fullPath, content, 'utf-8');
      paths.push(relativePath);
      createdCount += 1;
    }
    nextTasks.push(nextTask);
  }

  const untouched = tasks.slice(nextTasks.length);
  const nextSchedule = {
    ...schedule,
    version: 1,
    updatedAt: linkedCount > 0 ? nowIso() : schedule.updatedAt,
    tasks: [...nextTasks, ...untouched],
    deletedTaskIds: Array.isArray(schedule.deletedTaskIds) ? schedule.deletedTaskIds : [],
  };
  const content = JSON.stringify(nextSchedule, null, 2);
  if (linkedCount > 0) {
    fs.mkdirSync(path.dirname(scheduleFile), { recursive: true });
    saveLiveHistoryBeforeOverwrite(scheduleFile, content, 'ai-team-task-workdoc-links');
    fs.writeFileSync(scheduleFile, content, 'utf-8');
  }

  return {
    createdCount,
    linkedCount,
    alreadyExistsCount,
    upgradedCount,
    skippedCount,
    checkedCount,
    paths,
    schedulePath: `${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`,
    content,
  };
}

function teamDateOffset(date: string, days: number): string {
  const base = new Date(`${normalizeTeamScheduleDate(date) || teamTodayString()}T00:00:00`);
  if (Number.isNaN(base.getTime())) return teamTodayString();
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}

function teamWeekStartString(date = teamTodayString()): string {
  const base = new Date(`${normalizeTeamScheduleDate(date) || teamTodayString()}T00:00:00`);
  if (Number.isNaN(base.getTime())) return teamTodayString();
  const mondayOffset = (base.getDay() + 6) % 7;
  base.setDate(base.getDate() - mondayOffset);
  return base.toISOString().slice(0, 10);
}

function teamWeekEndString(date = teamTodayString()): string {
  return teamDateOffset(teamWeekStartString(date), 6);
}

function teamSprintPlanFileName(date = teamTodayString()): string {
  return `sprint-plan-${teamWeekStartString(date).replace(/-/g, '')}.md`;
}

function teamChangeImpactFileName(date = teamTodayString()): string {
  return `change-impact-${date.replace(/-/g, '')}.md`;
}

function teamMilestoneRoadmapFileName(date = teamTodayString()): string {
  return `milestone-roadmap-${date.replace(/-/g, '')}.md`;
}

function teamDecisionLogFileName(date = teamTodayString()): string {
  return `decision-log-${date.replace(/-/g, '')}.md`;
}

function teamAiMemoryIndexFileName(): string {
  return 'ai-memory-index.md';
}

function teamLinkHealthFileName(): string {
  return 'link-health.md';
}

function teamProductionHealthFileName(): string {
  return 'production-health.md';
}

function teamAITakeoverPlanFileName(date = teamTodayString()): string {
  return `ai-takeover-plan-${date.replace(/-/g, '')}.md`;
}

function teamObsidianCommandCenterFileName(): string {
  return 'obsidian-command-center.md';
}

function teamDueWithinDays(dueDate: unknown, days: number, date = teamTodayString()): boolean {
  const cleanDue = normalizeTeamScheduleDate(dueDate);
  if (!cleanDue) return false;
  return cleanDue >= date && cleanDue <= teamDateOffset(date, days);
}

function teamMemberLoadLabel(level: TeamMemberLoadLevel): string {
  if (level === 'danger') return '需处理';
  if (level === 'warning') return '需关注';
  return '正常';
}

function buildTeamMemberLoadRows(vaultPath: string, schedule: any, date = teamTodayString()): any[] {
  const tasks = Array.isArray(schedule?.tasks) ? schedule.tasks : [];
  const activeTasks = tasks.filter((task: any) => normalizeTeamTaskStatus(task.status) !== 'done');
  const members = new Set<string>();
  for (const member of Array.isArray(schedule?.members) ? schedule.members : []) {
    const clean = normalizeTeamScheduleText(member);
    if (clean && clean !== '未分配') members.add(clean);
  }
  for (const task of tasks) {
    const owner = normalizeTeamScheduleText(task.owner);
    if (owner && owner !== '未分配') members.add(owner);
    for (const log of Array.isArray(task.logs) ? task.logs : []) {
      const member = normalizeTeamScheduleText(log?.member);
      if (member && member !== '未分配') members.add(member);
    }
    for (const review of Array.isArray(task.reviewLogs) ? task.reviewLogs : []) {
      const reviewer = normalizeTeamScheduleText(review?.reviewer || review?.member);
      if (reviewer && reviewer !== '未分配') members.add(reviewer);
    }
  }

  const loadWeight = (level: TeamMemberLoadLevel) => (level === 'danger' ? 3 : level === 'warning' ? 2 : 1);
  return Array.from(members).map((member) => {
    const owned = activeTasks.filter((task: any) => normalizeTeamScheduleText(task.owner) === member);
    const nextTask = teamReportTaskSort(owned)[0] || null;
    const blocked = owned.filter((task: any) => normalizeTeamTaskStatus(task.status) === 'blocked' || normalizeTeamScheduleText(task.blocker));
    const overdue = owned.filter((task: any) => {
      const dueDate = normalizeTeamScheduleDate(task.dueDate);
      return dueDate && dueDate < date;
    });
    const dueToday = owned.filter((task: any) => normalizeTeamScheduleDate(task.dueDate) === date);
    const dueSoon = owned.filter((task: any) => teamDueWithinDays(task.dueDate, 7, date));
    const high = owned.filter((task: any) => normalizeTeamTaskPriority(task.priority) === 'high');
    const missingDocs = owned.filter((task: any) => !normalizeTeamSchedulePath(task.linkedDoc) || !linkedTeamDocExists(vaultPath, task.linkedDoc));
    const missingAcceptance = owned.filter((task: any) => !normalizeTeamScheduleText(task.acceptance));
    const totalMinutes = tasks.reduce((sum: number, task: any) => (
      sum + (Array.isArray(task.logs) ? task.logs : [])
        .filter((log: any) => normalizeTeamScheduleText(log.member) === member)
        .reduce((logSum: number, log: any) => logSum + parseTeamScheduleMinutes(log.minutes), 0)
    ), 0);
    const todayMinutes = tasks.reduce((sum: number, task: any) => (
      sum + (Array.isArray(task.logs) ? task.logs : [])
        .filter((log: any) => normalizeTeamScheduleText(log.member) === member && normalizeTeamScheduleDate(log.date) === date)
        .reduce((logSum: number, log: any) => logSum + parseTeamScheduleMinutes(log.minutes), 0)
    ), 0);
    const remainingMinutes = owned.reduce((sum: number, task: any) => (
      sum + Math.max(parseTeamScheduleMinutes(task.estimateMinutes) - taskSpentMinutesForBrief(task), 0)
    ), 0);
    const level: TeamMemberLoadLevel = blocked.length > 0 || overdue.length > 0
      ? 'danger'
      : dueToday.length > 0 || dueSoon.length >= 3 || high.length >= 3 || missingDocs.length > 0 || remainingMinutes >= 16 * 60
        ? 'warning'
        : 'ok';
    const reasons = [
      blocked.length > 0 ? `阻塞 ${blocked.length}` : '',
      overdue.length > 0 ? `逾期 ${overdue.length}` : '',
      dueToday.length > 0 ? `今天到期 ${dueToday.length}` : '',
      dueSoon.length > 0 ? `7天内 ${dueSoon.length}` : '',
      high.length > 0 ? `高优 ${high.length}` : '',
      missingDocs.length > 0 ? `缺文档 ${missingDocs.length}` : '',
      remainingMinutes > 0 ? `剩余 ${formatTeamMinutes(remainingMinutes)}` : '',
    ].filter(Boolean);
    const recommendation = blocked.length > 0
      ? '先解除阻塞，明确谁能提供资源、决策或前置交付'
      : overdue.length > 0
        ? '重新拆分逾期任务，确认今天可交付的最小结果'
        : missingDocs.length > 0
          ? '先补任务文档，确保成员能直接进入执行入口'
          : dueToday.length > 0
            ? '今天优先收尾并写入验收结果'
            : dueSoon.length >= 3 || remainingMinutes >= 16 * 60
              ? '检查是否需要转派或压缩范围，避免本周堆积'
              : '保持推进，结束前补充工时和产出说明';
    return {
      member,
      level,
      label: teamMemberLoadLabel(level),
      active: owned.length,
      blocked: blocked.length,
      overdue: overdue.length,
      dueToday: dueToday.length,
      dueSoon: dueSoon.length,
      high: high.length,
      missingDocs: missingDocs.length,
      missingAcceptance: missingAcceptance.length,
      todayMinutes,
      totalMinutes,
      remainingMinutes,
      nextTask: nextTask ? teamTaskBrief(nextTask) : null,
      reasons,
      recommendation,
      score: blocked.length * 100
        + overdue.length * 90
        + dueToday.length * 60
        + dueSoon.length * 25
        + high.length * 15
        + missingDocs.length * 20
        + missingAcceptance.length * 8
        + Math.min(50, Math.floor(remainingMinutes / 120)),
    };
  }).sort((a, b) => loadWeight(b.level) - loadWeight(a.level)
    || b.score - a.score
    || b.active - a.active
    || b.remainingMinutes - a.remainingMinutes
    || a.member.localeCompare(b.member, 'zh-CN'));
}

function isTeamUnassignedOwner(value: unknown): boolean {
  const clean = normalizeTeamScheduleText(value);
  if (!clean) return true;
  const lower = clean.toLowerCase();
  if (['unassigned', 'none', 'n/a', 'na', 'null', 'todo', 'tbd', '-', '--'].includes(lower)) return true;
  return /(\u672a\u5206\u914d|\u5f85\u5206\u914d|\u65e0\u4eba|\u6682\u672a|\u5f85\u5b9a)/u.test(clean);
}

function teamAssignmentEstimateMinutes(task: any): number {
  const explicit = parseTeamScheduleMinutes(task?.estimateMinutes || task?.estimate || task?.estimatedMinutes);
  if (explicit > 0) return explicit;
  const priority = normalizeTeamTaskPriority(task?.priority);
  if (priority === 'high') return 120;
  if (priority === 'low') return 45;
  return 60;
}

function teamAssignmentLoadScore(load: TeamAssignmentLoadState): number {
  return load.blocked * 140
    + load.overdue * 120
    + load.high * 35
    + load.active * 20
    + load.assignedDrafts * 30
    + Math.min(120, Math.floor(load.remainingMinutes / 30));
}

function formatTeamAssignmentProjectedLoad(load: TeamAssignmentLoadState): string {
  return `${load.member}: active ${load.active}, high ${load.high}, blocked ${load.blocked}, overdue ${load.overdue}, remaining ${formatTeamMinutes(load.remainingMinutes)}`;
}

function summarizeTeamAssignmentReview(review?: TeamAssignmentReview): string[] {
  if (!review) return [];
  const lines: string[] = [];
  lines.push(`Assignment guard: candidates=${review.candidateCount}, reassigned=${review.reassignedCount}.`);
  for (const item of review.reassignments.slice(0, 8)) {
    lines.push(`- ${item.title}: ${item.fromOwner || 'Unassigned'} -> ${item.toOwner}; ${item.reason}; ${item.projectedLoad}`);
  }
  if (review.reassignments.length > 8) {
    lines.push(`- ${review.reassignments.length - 8} more reassignment(s) not shown.`);
  }
  for (const warning of review.warnings.slice(0, 6)) {
    lines.push(`Warning: ${warning}`);
  }
  return lines;
}

function balanceTeamTaskAssignmentsForAI(vaultPath: string, schedule: any, rawTasks: any[]): { tasks: any[]; review: TeamAssignmentReview } {
  const tasks = Array.isArray(rawTasks)
    ? rawTasks.map((task) => (task && typeof task === 'object' ? { ...task } : task))
    : [];
  const review: TeamAssignmentReview = {
    ok: true,
    candidateCount: 0,
    reassignedCount: 0,
    reassignments: [],
    warnings: [],
  };

  const candidateNames = new Set<string>();
  for (const member of Array.isArray(schedule?.members) ? schedule.members : []) {
    const clean = normalizeTeamScheduleText(member);
    if (!isTeamUnassignedOwner(clean)) candidateNames.add(clean);
  }
  for (const task of Array.isArray(schedule?.tasks) ? schedule.tasks : []) {
    const owner = normalizeTeamScheduleText(task?.owner);
    if (!isTeamUnassignedOwner(owner)) candidateNames.add(owner);
  }

  const loadRows = buildTeamMemberLoadRows(vaultPath, schedule);
  for (const row of loadRows) {
    const member = normalizeTeamScheduleText(row?.member);
    if (!isTeamUnassignedOwner(member)) candidateNames.add(member);
  }

  if (candidateNames.size === 0) {
    review.warnings.push('No named team members were found, so AI assignment balancing was skipped.');
    return { tasks, review };
  }
  review.candidateCount = candidateNames.size;

  const loadByMember = new Map<string, TeamAssignmentLoadState>();
  const ensureLoad = (member: string): TeamAssignmentLoadState => {
    const clean = normalizeTeamScheduleText(member);
    const existing = loadByMember.get(clean);
    if (existing) return existing;
    const created: TeamAssignmentLoadState = {
      member: clean,
      active: 0,
      remainingMinutes: 0,
      high: 0,
      blocked: 0,
      overdue: 0,
      assignedDrafts: 0,
      level: 'ok',
    };
    loadByMember.set(clean, created);
    return created;
  };

  for (const member of candidateNames) ensureLoad(member);
  for (const row of loadRows) {
    const member = normalizeTeamScheduleText(row?.member);
    if (!candidateNames.has(member)) continue;
    const target = ensureLoad(member);
    target.active = Math.max(target.active, Number(row?.active || 0));
    target.remainingMinutes = Math.max(target.remainingMinutes, Number(row?.remainingMinutes || 0));
    target.high = Math.max(target.high, Number(row?.high || 0));
    target.blocked = Math.max(target.blocked, Number(row?.blocked || 0));
    target.overdue = Math.max(target.overdue, Number(row?.overdue || 0));
    target.level = row?.level === 'danger' || row?.level === 'warning' ? row.level : target.level;
  }

  const sortedLoads = () => Array.from(loadByMember.values()).sort((a, b) => (
    teamAssignmentLoadScore(a) - teamAssignmentLoadScore(b)
    || a.member.localeCompare(b.member, 'zh-CN')
  ));

  for (const task of tasks) {
    if (!task || typeof task !== 'object') continue;
    if (normalizeTeamTaskStatus(task.status) === 'done') continue;

    const originalOwner = normalizeTeamScheduleText(task.owner || task.assignee || '');
    const best = sortedLoads()[0];
    if (!best) continue;

    const current = loadByMember.get(originalOwner);
    const currentScore = current ? teamAssignmentLoadScore(current) : Number.POSITIVE_INFINITY;
    const bestScore = teamAssignmentLoadScore(best);
    const currentIsDanger = !!current && (
      current.level === 'danger'
      || current.blocked > 0
      || current.overdue > 0
      || current.high >= 3
      || current.active >= 6
      || current.remainingMinutes >= 16 * 60
    );
    const bestIsMeaningfullySafer = !!current
      && best.member !== originalOwner
      && best.blocked === 0
      && best.overdue === 0
      && bestScore + 50 < currentScore;

    let targetOwner = originalOwner;
    let reason = '';
    if (isTeamUnassignedOwner(originalOwner)) {
      targetOwner = best.member;
      reason = 'task had no reliable owner';
    } else if (!current) {
      targetOwner = best.member;
      reason = 'owner is not in the current team member list';
    } else if (currentIsDanger && bestIsMeaningfullySafer) {
      targetOwner = best.member;
      reason = 'original owner is overloaded or blocked';
    }

    const targetLoad = loadByMember.get(targetOwner) || best;
    const estimateMinutes = teamAssignmentEstimateMinutes(task);
    if (targetOwner !== originalOwner) {
      task.owner = targetOwner;
      const existingNotes = normalizeTeamScheduleText(task.notes);
      const guardNote = `[Load guard] ${originalOwner || 'Unassigned'} -> ${targetOwner}: ${reason}.`;
      task.notes = existingNotes ? `${existingNotes}\n${guardNote}` : guardNote;
      const projectedLoad = {
        ...targetLoad,
        active: targetLoad.active + 1,
        remainingMinutes: targetLoad.remainingMinutes + estimateMinutes,
        high: targetLoad.high + (normalizeTeamTaskPriority(task.priority) === 'high' ? 1 : 0),
      };
      review.reassignments.push({
        title: normalizeTeamScheduleText(task.title || task.task || task.deliverable) || 'Untitled task',
        fromOwner: originalOwner || 'Unassigned',
        toOwner: targetOwner,
        reason,
        projectedLoad: formatTeamAssignmentProjectedLoad(projectedLoad),
      });
    }

    targetLoad.active += 1;
    targetLoad.remainingMinutes += estimateMinutes;
    targetLoad.assignedDrafts += 1;
    if (normalizeTeamTaskPriority(task.priority) === 'high') targetLoad.high += 1;
  }

  review.reassignedCount = review.reassignments.length;
  return { tasks, review };
}

function stripProductionMarkdown(value: unknown): string {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/\[\[([^|\]]+)\|([^\]]+)]]/g, '$2')
    .replace(/\[\[([^\]]+)]]/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractProductionField(content: string, labels: string[]): string {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bold = content.match(new RegExp(`^\\s*-?\\s*\\*\\*\\s*${escaped}\\s*\\*\\*\\s*[:：]?\\s*(.+?)\\s*$`, 'im'));
    if (bold?.[1]) return stripProductionMarkdown(bold[1]);
    const plain = content.match(new RegExp(`^\\s*-?\\s*${escaped}\\s*[:：]\\s*(.+?)\\s*$`, 'im'));
    if (plain?.[1]) return stripProductionMarkdown(plain[1]);
  }
  return '';
}

function normalizeProductionQAStatus(value: string): string {
  const raw = stripProductionMarkdown(value).toLowerCase().trim();
  if (/(fixed|done|closed|resolved|verified|pass|通过|已修复|已关闭|已解决|完成|验证通过)/i.test(raw)) return 'closed';
  if (/(in progress|doing|wip|处理中|修复中|进行中)/i.test(raw)) return 'doing';
  if (/(review|verify|待验证|待验收|待确认|复测)/i.test(raw)) return 'review';
  if (/(open|todo|new|fail|失败|打开|未解决|待处理)/i.test(raw)) return 'open';
  return raw || 'open';
}

function productionQASeverity(text: string): TeamScheduleTaskPriority {
  if (/(critical|blocker|fatal|crash|p0|p1|严重|崩溃|卡死|阻塞|无法继续|主流程断)/i.test(text)) return 'high';
  if (/(major|p2|中等|明显|影响体验|性能|卡顿|错误|异常|bug)/i.test(text)) return 'medium';
  return 'low';
}

function productionQAType(relativePath: string, content: string): ProductionQAItemType {
  const head = `${relativePath}\n${content.slice(0, 700)}`;
  if (/(bug|缺陷|错误报告|Bug 报告|Bug报告)/i.test(head)) return 'bug';
  if (/(playtest|测试报告|试玩|反馈)/i.test(head)) return 'playtest';
  return 'feedback';
}

function isProductionQADoc(relativePath: string, content: string): boolean {
  return /(bug|缺陷|错误报告|Bug 报告|Bug报告|playtest|测试报告|试玩|反馈|复现步骤|实际行为|预期行为)/i
    .test(`${relativePath}\n${content.slice(0, 1600)}`);
}

function extractProductionSectionPreview(lines: string[], headings: string[]): string {
  const headingRe = new RegExp(`^#{1,6}\\s*(?:${headings.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*$`, 'i');
  const start = lines.findIndex((line) => headingRe.test(line.trim()));
  if (start < 0) return '';
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,6}\s+/.test(lines[i])) break;
    const clean = stripProductionMarkdown(lines[i].replace(/^[-*+]\s+/, ''));
    if (clean) body.push(clean);
    if (body.length >= 2) break;
  }
  return body.join('；').slice(0, 220);
}

function collectProductionMarkdownFiles(vaultPath: string, maxFiles = 500): string[] {
  const root = path.resolve(vaultPath);
  const files: string[] = [];
  const skip = new Set(['.ars-note', '.ars-team', '.ars-live', '.ars-backups', '.ai-memory', 'node_modules', '.git', 'dist', 'out']);
  function walk(dir: string) {
    if (files.length >= maxFiles) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      if (entry.name.startsWith('.') && skip.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        walk(fullPath);
      } else if (/\.md$/i.test(entry.name)) {
        const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
        files.push(relativePath);
      }
    }
  }
  walk(root);
  return files;
}

const PRODUCTION_NARRATIVE_STAGE_LABELS: Record<ProductionNarrativeStage, string> = {
  worldbuilding: '世界观',
  story: '剧情',
  quest: '任务',
  dialogue: '台词',
  performance: '演出',
  taskTable: '任务表',
};

const TEAM_CHANGE_IMPACT_STAGE_LABELS: Record<TeamChangeImpactStage, string> = {
  worldbuilding: '世界观',
  story: '剧情',
  quest: '任务',
  dialogue: '台词',
  performance: '演出',
  taskTable: '任务表',
  qa: 'QA/验收',
  ui: 'UI',
  art: '美术',
  code: '代码',
  audio: '音频',
  production: '制作管理',
  generic: '未分类',
};

const TEAM_CHANGE_IMPACT_DOWNSTREAM: Record<TeamChangeImpactStage, TeamChangeImpactStage[]> = {
  worldbuilding: ['story', 'quest', 'dialogue', 'performance', 'taskTable', 'qa'],
  story: ['quest', 'dialogue', 'performance', 'taskTable', 'qa'],
  quest: ['dialogue', 'performance', 'taskTable', 'code', 'qa'],
  dialogue: ['performance', 'audio', 'taskTable', 'qa'],
  performance: ['art', 'audio', 'code', 'taskTable', 'qa'],
  taskTable: ['production', 'code', 'qa'],
  qa: ['taskTable', 'production'],
  ui: ['code', 'art', 'qa'],
  art: ['performance', 'code', 'qa'],
  code: ['qa', 'production'],
  audio: ['performance', 'code', 'qa'],
  production: ['taskTable', 'qa'],
  generic: ['taskTable', 'production'],
};

function inferTeamChangeImpactStageFromText(value: unknown): TeamChangeImpactStage {
  const raw = normalizeTeamSchedulePath(value).toLowerCase();
  if (/(qa|bug|test|playtest|feedback|review|acceptance|验收|测试|试玩|反馈|复查|缺陷)/i.test(raw)) return 'qa';
  if (/(narrativetasktable|tasktable|task table|07_unity_tasks|unity_tasks|production task|implementation task|任务表|任务清单|开发任务)/i.test(raw)) return 'taskTable';
  if (/(dialogue|dialog|line|banter|voice|台词|对白|对话|旁白|配音)/i.test(raw)) return 'dialogue';
  if (/(performance|cutscene|cinematic|storyboard|camera|animation|vfx|演出|分镜|镜头|过场|动画)/i.test(raw)) return 'performance';
  if (/(quest|06_quests|mission|objective|reward|任务|主线|支线)/i.test(raw)) return 'quest';
  if (/(story|plot|narrative|chapter|beat|剧情|叙事|章节|桥段)/i.test(raw)) return 'story';
  if (/(world|lore|worldbuilding|world_bible|location|faction|timeline|世界观|设定|地点|派系|时间线)/i.test(raw)) return 'worldbuilding';
  if (/(ui|ux|hud|menu|panel|button|界面|按钮|菜单|交互)/i.test(raw)) return 'ui';
  if (/(art|concept|character|map|model|texture|sprite|美术|原画|角色|地图|模型|贴图|资源)/i.test(raw)) return 'art';
  if (/(audio|sfx|music|sound|voice|音频|音乐|音效|配音)/i.test(raw)) return 'audio';
  if (/(code|script|unity|prefab|scene|system|logic|代码|脚本|实现|系统|玩法)/i.test(raw)) return 'code';
  if (/(schedule|sprint|milestone|owner|producer|production|排期|周计划|里程碑|负责人|制作)/i.test(raw)) return 'production';
  return 'generic';
}

function inferTeamTaskImpactStage(task: any): TeamChangeImpactStage {
  return inferTeamChangeImpactStageFromText([
    task?.linkedDoc,
    task?.title,
    task?.deliverable,
    task?.dependency,
    task?.blocker,
    task?.acceptance,
    task?.notes,
  ].filter(Boolean).join('\n'));
}

function isTeamProductionDocPath(relativePath: string): boolean {
  const clean = normalizeTeamSchedulePath(relativePath).toLowerCase();
  if (/^(01_gdd|02_worldbuilding|03_characters|04_maps|05_mechanics|06_quests|07_unity_tasks|08_art|09_audio|10_ui|art|audio|ui|quests|worldbuilding|gdd)\//i.test(clean)) return true;
  return inferTeamChangeImpactStageFromText(clean) !== 'generic';
}

function normalizeProductionNarrativeKey(value: string): string {
  return normalizeTeamSchedulePath(value)
    .replace(/\.md$/i, '')
    .split('/')
    .pop()
    ?.toLowerCase()
    .trim() || '';
}

function parseProductionWikiLinks(content: string): string[] {
  const links = new Set<string>();
  const wikiRegex = /\[\[([^\]|]+?)(?:\|[^\]]+?)?]]/g;
  let inCodeBlock = false;
  for (const line of String(content || '').split(/\r?\n/)) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const stripped = line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
    wikiRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = wikiRegex.exec(stripped)) !== null) {
      const target = match[1].split('#')[0].trim();
      if (target) links.add(target);
    }
  }
  return Array.from(links);
}

function productionMarkdownTitle(relativePath: string, content: string): string {
  const h1 = String(content || '').split(/\r?\n/).find((line) => /^#\s+/.test(line));
  return stripProductionMarkdown((h1 || '').replace(/^#\s+/, '')) || path.basename(relativePath, '.md');
}

function classifyProductionNarrativeStage(relativePath: string, content: string): ProductionNarrativeStage | null {
  const head = `${relativePath}\n${content.slice(0, 1800)}`.toLowerCase();
  if (/(narrativetasktable|tasktable|task table|production task|implementation task|07_unity_tasks|07_unity|07_unitytasks|任务表|任务清单|开发任务表)/i.test(head)) return 'taskTable';
  if (/(dialoguescript|dialoguescene|dialogue profile|dialogue script|dialogue scene|banter|台词|对白|对话|闲聊)/i.test(head)) return 'dialogue';
  if (/(performancesheet|performance sheet|cutscene|storyboard|cinematic|分镜|演出|过场|过场动画)/i.test(head)) return 'performance';
  if (/(plotoutline|storyarc|plot outline|story arc|剧情|故事线|剧情大纲|story|plot)/i.test(head)) return 'story';
  if (/^(06_quests\/|06_quests)/i.test(relativePath) || /(quest|任务设计|主线任务|支线任务)/i.test(head)) return 'quest';
  if (/^(02_worldbuilding\/|02_worldbuilding|02_Worldbuilding\/)/i.test(relativePath) || /(worldbible|worldbuilding|world overview|location|faction|race|species|timeline|lore|世界观|地点|派系|时间线)/i.test(head)) return 'worldbuilding';
  return null;
}

function scanNarrativeProductionChain(vaultPath: string, limit = 12): any {
  const files = collectProductionMarkdownFiles(vaultPath);
  const docs: Array<{
    type: ProductionNarrativeStage;
    title: string;
    relativePath: string;
    status: string;
    owner: string;
    priority: string;
    links: string[];
    narrativeLinkCount: number;
  }> = [];
  const targetToStage = new Map<string, ProductionNarrativeStage>();

  for (const relativePath of files) {
    try {
      const content = fs.readFileSync(path.resolve(vaultPath, relativePath), 'utf-8');
      const type = classifyProductionNarrativeStage(relativePath, content);
      if (!type) continue;
      const title = productionMarkdownTitle(relativePath, content);
      const links = parseProductionWikiLinks(content);
      docs.push({
        type,
        title,
        relativePath,
        status: extractProductionField(content, ['Status', '状态']),
        owner: extractProductionField(content, ['Owner', 'Assignee', '负责人']),
        priority: extractProductionField(content, ['Priority', '优先级']),
        links,
        narrativeLinkCount: 0,
      });
      const base = path.basename(relativePath, '.md');
      for (const key of [normalizeProductionNarrativeKey(title), normalizeProductionNarrativeKey(base), normalizeProductionNarrativeKey(relativePath)]) {
        if (key) targetToStage.set(key, type);
      }
    } catch { /* skip unreadable docs */ }
  }

  const counts: Record<ProductionNarrativeStage, number> = {
    worldbuilding: 0,
    story: 0,
    quest: 0,
    dialogue: 0,
    performance: 0,
    taskTable: 0,
  };
  const linkedPairs = new Set<string>();
  for (const doc of docs) {
    counts[doc.type] += 1;
    const narrativeTargets = new Set<ProductionNarrativeStage>();
    for (const link of doc.links) {
      const targetStage = targetToStage.get(normalizeProductionNarrativeKey(link));
      if (!targetStage) continue;
      narrativeTargets.add(targetStage);
      linkedPairs.add(`${doc.type}->${targetStage}`);
    }
    doc.narrativeLinkCount = narrativeTargets.size;
  }

  const requiredStages: ProductionNarrativeStage[] = ['worldbuilding', 'story', 'quest', 'dialogue', 'performance', 'taskTable'];
  const missingStages = requiredStages.filter((stage) => counts[stage] === 0);
  const weakLinks: string[] = [];
  const expectPair = (from: ProductionNarrativeStage, to: ProductionNarrativeStage, text: string) => {
    if (counts[from] > 0 && counts[to] > 0 && !linkedPairs.has(`${from}->${to}`) && !linkedPairs.has(`${to}->${from}`)) {
      weakLinks.push(text);
    }
  };
  expectPair('worldbuilding', 'story', '世界观和剧情之间缺少明确链接');
  expectPair('story', 'quest', '剧情和任务之间缺少明确链接');
  expectPair('quest', 'dialogue', '任务和台词之间缺少明确链接');
  expectPair('dialogue', 'performance', '台词和演出表之间缺少明确链接');
  expectPair('performance', 'taskTable', '演出表和实现任务表之间缺少明确链接');

  const pipeline = docs.filter((doc) => /narrativepipeline/i.test(doc.relativePath) || /叙事制作管线|narrative pipeline/i.test(doc.title)).length;
  if (pipeline === 0 && docs.length > 0) weakLinks.unshift('缺少 NarrativePipeline 作为叙事制作总入口');

  return {
    scannedDocs: files.length,
    ...counts,
    pipeline,
    missingStages: missingStages.map((stage) => ({ stage, label: PRODUCTION_NARRATIVE_STAGE_LABELS[stage] })),
    weakLinks: weakLinks.slice(0, limit),
    docsWithoutNarrativeLinks: docs
      .filter((doc) => doc.narrativeLinkCount === 0)
      .sort((a, b) => a.type.localeCompare(b.type) || a.relativePath.localeCompare(b.relativePath, 'zh-CN'))
      .slice(0, limit)
      .map((doc) => ({
        type: doc.type,
        label: PRODUCTION_NARRATIVE_STAGE_LABELS[doc.type],
        title: doc.title,
        relativePath: doc.relativePath,
        status: doc.status,
        owner: doc.owner,
        priority: doc.priority,
        linkCount: doc.links.length,
        narrativeLinkCount: doc.narrativeLinkCount,
      })),
    recentDocs: docs
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-CN'))
      .slice(0, limit)
      .map((doc) => ({
        type: doc.type,
        label: PRODUCTION_NARRATIVE_STAGE_LABELS[doc.type],
        title: doc.title,
        relativePath: doc.relativePath,
        status: doc.status,
        owner: doc.owner,
        priority: doc.priority,
        linkCount: doc.links.length,
        narrativeLinkCount: doc.narrativeLinkCount,
      })),
  };
}

function parseProductionQAItemsFromMarkdown(relativePath: string, content: string): any[] {
  if (!isProductionQADoc(relativePath, content)) return [];
  const lines = content.split(/\r?\n/);
  const itemType = productionQAType(relativePath, content);
  const docStatus = normalizeProductionQAStatus(extractProductionField(content, ['Status', '状态', '狀態']));
  const owner = extractProductionField(content, ['Assignee', 'Owner', '负责人', '負責人', '测试者', '測試者']);
  const buildVersion = extractProductionField(content, ['Build Version', '构建版本', '構建版本', '版本']);
  const severityText = extractProductionField(content, ['Severity', '严重程度', '嚴重程度', 'Priority', '优先级', '優先級']);
  const title = stripProductionMarkdown((lines.find((line) => /^#\s+/.test(line)) || '').replace(/^#\s+/, '')) || relativePath.replace(/\.md$/i, '');
  const items: any[] = [];

  if (itemType === 'bug' && docStatus !== 'closed') {
    const expected = extractProductionSectionPreview(lines, ['Expected Behavior', '预期行为', '預期行為']);
    const actual = extractProductionSectionPreview(lines, ['Actual Behavior', '实际行为', '實際行為']);
    items.push({
      id: `${relativePath}:doc-bug`,
      title,
      relativePath,
      line: 1,
      severity: productionQASeverity(`${severityText} ${title} ${actual}`),
      status: docStatus,
      owner,
      buildVersion,
      type: itemType,
      details: [actual ? `实际：${actual}` : '', expected ? `预期：${expected}` : ''].filter(Boolean).join('；'),
    });
  }

  let qaSectionDepth = 0;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const lineNo = index + 1;
    if (/^#{1,6}\s*(反馈|问题|Bug|缺陷|异常|测试结论|Playtest Feedback|Feedback|Issues?|Bugs?)/i.test(trimmed)) {
      qaSectionDepth = 20;
      return;
    }
    if (!trimmed) {
      if (qaSectionDepth > 0) qaSectionDepth -= 1;
      return;
    }
    const bullet = trimmed.match(/^[-*+]\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/);
    const direct = /(bug|缺陷|异常|崩溃|卡死|反馈|问题|不舒服|不好用|卡顿|穿模|丢失|错误)/i.test(trimmed);
    if ((qaSectionDepth > 0 && bullet) || direct) {
      const text = stripProductionMarkdown((bullet?.[1] || trimmed).replace(/^反馈[:：]\s*/i, ''));
      const status = normalizeProductionQAStatus(text);
      if (text && status !== 'closed') {
        items.push({
          id: `${relativePath}:${lineNo}:qa`,
          title: text,
          relativePath,
          line: lineNo,
          severity: productionQASeverity(text),
          status: status === text.toLowerCase() ? 'open' : status,
          owner,
          buildVersion,
          type: itemType === 'bug' ? 'bug' : 'feedback',
          details: '',
        });
      }
    }
    if (qaSectionDepth > 0) qaSectionDepth -= 1;
  });

  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.relativePath}:${item.line}:${item.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scanProductionQAItems(vaultPath: string, limit = 12): any {
  const files = collectProductionMarkdownFiles(vaultPath);
  const items: any[] = [];
  for (const relativePath of files) {
    const fullPath = path.resolve(vaultPath, relativePath);
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      items.push(...parseProductionQAItemsFromMarkdown(relativePath, content));
    } catch { /* skip unreadable docs */ }
  }
  const priorityWeight: Record<TeamScheduleTaskPriority, number> = { high: 3, medium: 2, low: 1 };
  const sorted = items
    .filter((item) => item.status !== 'closed')
    .sort((a, b) => priorityWeight[b.severity as TeamScheduleTaskPriority] - priorityWeight[a.severity as TeamScheduleTaskPriority]
      || String(a.relativePath).localeCompare(String(b.relativePath), 'zh-CN')
      || Number(a.line || 0) - Number(b.line || 0));
  return {
    scannedDocs: files.length,
    total: sorted.length,
    high: sorted.filter((item) => item.severity === 'high').length,
    open: sorted.filter((item) => item.status === 'open').length,
    review: sorted.filter((item) => item.status === 'review').length,
    doing: sorted.filter((item) => item.status === 'doing').length,
    items: sorted.slice(0, limit),
  };
}

function buildTeamProductionHealth(vaultPath: string, limit = 12): any {
  const schedule = readTeamScheduleData(vaultPath);
  const today = new Date().toISOString().slice(0, 10);
  const soon = addDaysIso(7);
  const qa = scanProductionQAItems(vaultPath, limit);
  const narrative = scanNarrativeProductionChain(vaultPath, limit);
  const tasks = Array.isArray(schedule.tasks) ? schedule.tasks : [];
  const active = tasks.filter((task: any) => normalizeTeamTaskStatus(task.status) !== 'done');
  const byDuePriority = (left: any, right: any) => {
    const leftDue = normalizeTeamScheduleDate(left.dueDate) || '9999-12-31';
    const rightDue = normalizeTeamScheduleDate(right.dueDate) || '9999-12-31';
    const priorityWeight: Record<TeamScheduleTaskPriority, number> = { high: 3, medium: 2, low: 1 };
    return leftDue.localeCompare(rightDue)
      || priorityWeight[normalizeTeamTaskPriority(right.priority)] - priorityWeight[normalizeTeamTaskPriority(left.priority)]
      || normalizeTeamScheduleText(left.title).localeCompare(normalizeTeamScheduleText(right.title), 'zh-CN');
  };
  const overdue = active
    .filter((task: any) => {
      const dueDate = normalizeTeamScheduleDate(task.dueDate);
      return dueDate && dueDate < today;
    })
    .sort(byDuePriority);
  const dueSoon = active
    .filter((task: any) => {
      const dueDate = normalizeTeamScheduleDate(task.dueDate);
      return dueDate && dueDate >= today && dueDate <= soon;
    })
    .sort(byDuePriority);
  const blocked = active
    .filter((task: any) => normalizeTeamTaskStatus(task.status) === 'blocked' || normalizeTeamScheduleText(task.blocker))
    .sort(byDuePriority);
  const missingOwner = active
    .filter((task: any) => {
      const owner = normalizeTeamScheduleText(task.owner);
      return !owner || owner === '未分配';
    })
    .sort(byDuePriority);
  const missingDueDate = active
    .filter((task: any) => !normalizeTeamScheduleDate(task.dueDate))
    .sort(byDuePriority);
  const missingDocs = active
    .filter((task: any) => !normalizeTeamSchedulePath(task.linkedDoc) || !linkedTeamDocExists(vaultPath, task.linkedDoc))
    .sort(byDuePriority);
  const recentLogs = tasks
    .flatMap((task: any) => (Array.isArray(task.logs) ? task.logs : []).map((log: any) => ({
      taskId: typeof task.id === 'string' ? task.id : '',
      taskTitle: normalizeTeamScheduleText(task.title),
      linkedDoc: normalizeTeamSchedulePath(task.linkedDoc),
      owner: normalizeTeamScheduleText(task.owner),
      member: normalizeTeamScheduleText(log.member),
      date: normalizeTeamScheduleDate(log.date),
      minutes: parseTeamScheduleMinutes(log.minutes),
      note: normalizeTeamScheduleText(log.note).slice(0, 240),
      createdAt: typeof log.createdAt === 'string' ? log.createdAt : '',
    })))
    .sort((a: any, b: any) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)))
    .slice(0, limit);
  const memberLoad = buildTeamMemberLoadRows(vaultPath, schedule, today);
  const dangerMembers = memberLoad.filter((row: any) => row.level === 'danger');
  const warningMembers = memberLoad.filter((row: any) => row.level === 'warning');
  const recommendations: string[] = [];
  if (qa.high > 0) recommendations.push(`安排 ${qa.high} 个高严重度 QA/Bug/试玩反馈项的复现、修复负责人和复测标准。`);
  if (qa.total > 0 && qa.high === 0) recommendations.push(`把 ${qa.total} 个未关闭 QA/Bug/试玩反馈项纳入本周修复和验证队列。`);
  if (narrative.missingStages.length > 0) recommendations.push(`叙事链路缺少 ${narrative.missingStages.map((item: any) => item.label).join('、')}，AI 接管叙事前建议先补齐核心文档。`);
  if (narrative.weakLinks.length > 0) recommendations.push(`叙事链路有 ${narrative.weakLinks.length} 个弱链接，建议把世界观、剧情、任务、台词、演出和任务表用 [[wiki-link]] 串起来。`);
  if (dangerMembers.length > 0) recommendations.push(`成员负载有 ${dangerMembers.length} 人需要处理：${dangerMembers.slice(0, 4).map((row: any) => `${row.member}（${row.reasons.slice(0, 3).join(' / ')}）`).join('、')}。`);
  if (dangerMembers.length === 0 && warningMembers.length > 0) recommendations.push(`成员负载有 ${warningMembers.length} 人需要关注，优先检查是否要转派、补文档或缩小范围。`);
  if (blocked.length > 0) recommendations.push(`先清理 ${blocked.length} 个阻塞任务，明确缺资源、缺决策还是缺实现。`);
  if (overdue.length > 0) recommendations.push(`复盘 ${overdue.length} 个逾期任务，重新拆分范围或调整截止日期。`);
  if (missingOwner.length > 0) recommendations.push(`给 ${missingOwner.length} 个活跃任务指派负责人。`);
  if (missingDueDate.length > 0) recommendations.push(`给 ${missingDueDate.length} 个活跃任务补截止日期，方便成员页和日报排序。`);
  if (missingDocs.length > 0) recommendations.push(`给 ${missingDocs.length} 个任务补齐可打开的关联文档。`);
  if (recentLogs.length === 0 && active.length > 0) recommendations.push('还没有近期工时记录，提醒成员记录今天实际做了什么。');
  if (recommendations.length === 0) recommendations.push('当前没有明显制作风险，优先推进高优先级和 7 天内到期任务。');

  return {
    ok: true,
    path: `${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`,
    generatedAt: new Date().toISOString(),
    updatedAt: schedule.updatedAt || '',
    stats: {
      ...summarizeTeamSchedule(schedule),
      dueSoon: dueSoon.length,
      missingDocs: missingDocs.length,
      memberLoadDanger: dangerMembers.length,
      memberLoadWarning: warningMembers.length,
      recentLogCount: recentLogs.length,
      qaOpen: qa.total,
      qaHigh: qa.high,
      narrativeMissingStages: narrative.missingStages.length,
      narrativeWeakLinks: narrative.weakLinks.length,
    },
    focus: {
      blocked: blocked.slice(0, limit).map(teamTaskBrief),
      overdue: overdue.slice(0, limit).map(teamTaskBrief),
      dueSoon: dueSoon.slice(0, limit).map(teamTaskBrief),
      missingOwner: missingOwner.slice(0, limit).map(teamTaskBrief),
      missingDueDate: missingDueDate.slice(0, limit).map(teamTaskBrief),
      missingDocs: missingDocs.slice(0, limit).map(teamTaskBrief),
      memberLoad: memberLoad.slice(0, limit),
      qa: qa.items,
      narrativeGaps: {
        missingStages: narrative.missingStages,
        weakLinks: narrative.weakLinks,
        docsWithoutNarrativeLinks: narrative.docsWithoutNarrativeLinks,
      },
    },
    qa: {
      scannedDocs: qa.scannedDocs,
      total: qa.total,
      high: qa.high,
      open: qa.open,
      review: qa.review,
      doing: qa.doing,
    },
    narrative,
    memberLoad,
    recentLogs,
    recommendations,
  };
}

function narrativeStageDefaultDoc(stage: ProductionNarrativeStage): string {
  switch (stage) {
    case 'worldbuilding': return '02_Worldbuilding/WorldBible.md';
    case 'story': return '02_Worldbuilding/NarrativePipeline.md';
    case 'quest': return '06_Quests/NarrativeQuestMap.md';
    case 'dialogue': return '02_Worldbuilding/DialoguePlan.md';
    case 'performance': return '02_Worldbuilding/PerformancePlan.md';
    case 'taskTable': return '07_Unity_Tasks/NarrativeTaskTable.md';
    default: return '02_Worldbuilding/NarrativePipeline.md';
  }
}

function narrativeStageDiscipline(stage: ProductionNarrativeStage): string {
  switch (stage) {
    case 'worldbuilding': return '世界观策划';
    case 'story': return '叙事策划';
    case 'quest': return '任务策划';
    case 'dialogue': return '台词/本地化';
    case 'performance': return '演出/动画';
    case 'taskTable': return '制作统筹';
    default: return '叙事策划';
  }
}

function buildNarrativeTakeoverTaskDrafts(vaultPath: string, options: { limit?: number; includeQa?: boolean } = {}): { tasks: any[]; health: any; summary: any } {
  const limit = Math.max(1, Math.min(80, Math.floor(Number(options.limit) || 24)));
  const includeQa = options.includeQa !== false;
  const health = buildTeamProductionHealth(vaultPath, Math.max(16, limit));
  const narrative = health?.narrative || {};
  const gaps = health?.focus?.narrativeGaps || {};
  const missingStages = Array.isArray(narrative.missingStages) ? narrative.missingStages : (Array.isArray(gaps.missingStages) ? gaps.missingStages : []);
  const weakLinks = Array.isArray(narrative.weakLinks) ? narrative.weakLinks : (Array.isArray(gaps.weakLinks) ? gaps.weakLinks : []);
  const docsWithoutLinks = Array.isArray(narrative.docsWithoutNarrativeLinks) ? narrative.docsWithoutNarrativeLinks : (Array.isArray(gaps.docsWithoutNarrativeLinks) ? gaps.docsWithoutNarrativeLinks : []);
  const qaItems = includeQa && Array.isArray(health?.focus?.qa) ? health.focus.qa : [];
  const today = teamTodayString();
  const tasks: any[] = [];
  const seen = new Set<string>();

  const pushTask = (task: any) => {
    if (tasks.length >= limit) return;
    const title = normalizeTeamScheduleText(task.title || task.deliverable);
    if (!title) return;
    const linkedDoc = normalizeTeamSchedulePath(task.linkedDoc);
    const owner = normalizeTeamScheduleText(task.owner) || '未分配';
    const key = [title.toLowerCase(), owner.toLowerCase(), linkedDoc.toLowerCase()].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    tasks.push({
      title,
      owner,
      status: normalizeTeamTaskStatus(task.status || 'todo'),
      priority: normalizeTeamTaskPriority(task.priority || 'medium'),
      dueDate: normalizeTeamScheduleDate(task.dueDate) || teamDateOffset(today, 3),
      estimateMinutes: parseTeamScheduleMinutes(task.estimateMinutes) || 120,
      linkedDoc,
      deliverable: normalizeTeamScheduleText(task.deliverable) || title,
      dependency: normalizeTeamScheduleText(task.dependency),
      blocker: normalizeTeamScheduleText(task.blocker),
      acceptance: normalizeTeamScheduleText(task.acceptance),
      notes: normalizeTeamScheduleText(task.notes),
    });
  };

  for (const item of missingStages) {
    const stage = item?.stage as ProductionNarrativeStage;
    if (!stage || !PRODUCTION_NARRATIVE_STAGE_LABELS[stage]) continue;
    const label = item?.label || PRODUCTION_NARRATIVE_STAGE_LABELS[stage];
    const doc = narrativeStageDefaultDoc(stage);
    pushTask({
      title: `补齐叙事阶段：${label}`,
      owner: '未分配',
      priority: stage === 'worldbuilding' || stage === 'story' || stage === 'taskTable' ? 'high' : 'medium',
      dueDate: teamDateOffset(today, 2),
      estimateMinutes: 180,
      linkedDoc: doc,
      deliverable: `创建或补齐 ${label} 核心文档，并把它接入 NarrativePipeline 与 NarrativeTaskTable。`,
      dependency: `需要先检查 01_GDD、02_Worldbuilding、03_Characters、06_Quests、07_Unity_Tasks 中已有设定。`,
      acceptance: `文档存在且包含状态、负责人、上下游 [[wiki-link]]、验收口径；能回答它如何影响世界观、剧情、任务、台词、演出或实现任务表。`,
      notes: `建议岗位：${narrativeStageDiscipline(stage)}；来源：AI 叙事接管草案 / missing stage ${stage}`,
    });
  }

  for (const text of weakLinks.slice(0, limit)) {
    pushTask({
      title: `串联叙事弱链接：${compactTeamReportText(text, 80)}`,
      owner: '未分配',
      priority: 'medium',
      dueDate: teamDateOffset(today, 3),
      estimateMinutes: 90,
      linkedDoc: '02_Worldbuilding/NarrativePipeline.md',
      deliverable: `把弱链接写成明确的上游依据、下游影响和 [[wiki-link]]。`,
      dependency: String(text || ''),
      acceptance: `NarrativePipeline 中能追踪该链接；相关文档至少互相链接一次；如果会产生实现工作，已同步到 NarrativeTaskTable 或团队时间表。`,
      notes: '来源：AI 叙事接管草案 / weak narrative link',
    });
  }

  for (const doc of docsWithoutLinks.slice(0, limit)) {
    const relPath = normalizeTeamSchedulePath(doc?.relativePath);
    if (!relPath) continue;
    pushTask({
      title: `补齐叙事文档链接：${compactTeamReportText(doc?.title || relPath, 80)}`,
      owner: normalizeTeamScheduleText(doc?.owner) || '未分配',
      priority: normalizeTeamTaskPriority(doc?.priority || 'medium'),
      dueDate: teamDateOffset(today, 3),
      estimateMinutes: 60,
      linkedDoc: relPath,
      deliverable: `给该文档补齐它与世界观、剧情、任务、台词、演出或任务表的上下游关系。`,
      dependency: `${doc?.label || doc?.type || '叙事文档'} 当前缺少可识别的叙事链路链接。`,
      acceptance: `文档中至少加入 2 个有效 [[wiki-link]]；说明上游依据、下游影响、未决问题和需要落入任务表的事项。`,
      notes: '来源：AI 叙事接管草案 / docs without narrative links',
    });
  }

  for (const qa of qaItems.slice(0, limit)) {
    const relPath = normalizeTeamSchedulePath(qa?.relativePath);
    pushTask({
      title: `叙事影响复查：${compactTeamReportText(qa?.title || 'QA/试玩反馈', 80)}`,
      owner: normalizeTeamScheduleText(qa?.owner) || '未分配',
      priority: normalizeTeamTaskPriority(qa?.severity || 'medium'),
      dueDate: teamDateOffset(today, 2),
      estimateMinutes: 75,
      linkedDoc: relPath,
      deliverable: `确认该 QA/Bug/试玩反馈是否影响世界观、剧情、任务、台词、演出或任务表，并拆出修复/复测动作。`,
      dependency: normalizeTeamScheduleText(qa?.details || qa?.title),
      acceptance: `写明影响范围、修复方案、复测方法；如果影响叙事链，已更新对应文档和 NarrativeTaskTable。`,
      notes: '来源：AI 叙事接管草案 / QA narrative impact',
    });
  }

  return {
    tasks,
    health,
    summary: {
      generatedAt: new Date().toISOString(),
      narrativeMissingStages: missingStages.length,
      narrativeWeakLinks: weakLinks.length,
      docsWithoutNarrativeLinks: docsWithoutLinks.length,
      qaItems: qaItems.length,
      draftedTasks: tasks.length,
    },
  };
}

function firstExistingTeamMarkdown(vaultPath: string, candidates: string[]): string {
  const root = path.resolve(vaultPath);
  for (const candidate of candidates) {
    const normalized = normalizeTeamSchedulePath(candidate);
    if (!normalized) continue;
    const fullPath = path.resolve(root, normalized);
    if (fullPath !== root && isInsidePath(fullPath, root) && fs.existsSync(fullPath)) return normalized;
  }

  for (const candidate of candidates) {
    const normalized = normalizeTeamSchedulePath(candidate);
    if (!normalized) continue;
    const folder = normalized.endsWith('.md') ? path.posix.dirname(normalized) : normalized;
    const fullFolder = path.resolve(root, folder);
    if (fullFolder === root || !isInsidePath(fullFolder, root) || !fs.existsSync(fullFolder)) continue;
    try {
      const found = fs.readdirSync(fullFolder, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
        .map((entry) => path.posix.join(folder, entry.name))
        .sort((a, b) => a.localeCompare(b, 'zh-CN'))[0];
      if (found) return found;
    } catch { /* skip unreadable folders */ }
  }

  return normalizeTeamSchedulePath(candidates[0] || '07_Unity_Tasks/TeamProductionBootstrap.md');
}

function buildTeamWorkspaceBootstrapTasks(vaultPath: string, options: { currentMember?: string; limit?: number } = {}): any[] {
  const limit = Math.max(8, Math.min(80, Math.floor(Number(options.limit) || 48)));
  const owner = normalizeTeamScheduleText(options.currentMember) || '未分配';
  const today = teamTodayString();
  const commandCenterReady = fs.existsSync(path.join(path.resolve(vaultPath), TEAM_SCHEDULE_DIR, teamObsidianCommandCenterFileName()));
  const tasks: any[] = [];
  const seen = new Set<string>();

  const pushTask = (task: any) => {
    if (tasks.length >= limit) return;
    const title = normalizeTeamScheduleText(task.title || task.deliverable);
    if (!title) return;
    const linkedDoc = normalizeTeamSchedulePath(task.linkedDoc || '07_Unity_Tasks/TeamProductionBootstrap.md');
    const next = {
      title,
      owner: normalizeTeamScheduleText(task.owner) || owner,
      status: normalizeTeamTaskStatus(task.status || 'todo'),
      priority: normalizeTeamTaskPriority(task.priority || 'medium'),
      dueDate: normalizeTeamScheduleDate(task.dueDate) || teamDateOffset(today, 3),
      estimateMinutes: parseTeamScheduleMinutes(task.estimateMinutes) || 90,
      linkedDoc,
      deliverable: normalizeTeamScheduleText(task.deliverable) || title,
      dependency: normalizeTeamScheduleText(task.dependency),
      blocker: normalizeTeamScheduleText(task.blocker),
      acceptance: normalizeTeamScheduleText(task.acceptance),
      notes: normalizeTeamScheduleText(task.notes),
    };
    if (next.owner === '未分配' && owner !== '未分配') next.owner = owner;
    const key = teamTaskKey(next);
    if (seen.has(key)) return;
    seen.add(key);
    tasks.push(next);
  };

  pushTask({
    title: '初始化 Ars-note 团队制作控制台',
    owner,
    status: commandCenterReady ? 'done' : 'todo',
    priority: commandCenterReady ? 'low' : 'high',
    dueDate: commandCenterReady ? today : teamDateOffset(today, 1),
    estimateMinutes: 60,
    linkedDoc: '07_Unity_Tasks/TeamProductionBootstrap.md',
    deliverable: '生成并检查 .ars-team/obsidian-command-center.md、team-dashboard、production-health、成员页、今日工作包、工时表和 AI 交接入口。',
    acceptance: '团队成员能从控制台进入自己的任务页；AI 能从 ai-handoff、production-health 和 ai-memory-index 接管；任务文档能记录 Work Log 与验收记录。',
    notes: commandCenterReady
      ? '团队工作区初始化自动任务。已检测到 Ars-note 团队控制台文档，自动视为完成。'
      : '团队工作区初始化自动任务。完成后点击“一键生产刷新”。',
  });

  const focusAreas = [
    {
      title: '梳理项目总入口与制作目标',
      priority: 'high',
      dueIn: 1,
      estimate: 90,
      candidates: ['00_Index.md', '01_GDD/README.md', '01_GDD/GDD.md', '01_GDD/GameOverview.md', '01_GDD/DesignBrief.md', '01_GDD'],
      deliverable: '把当前游戏目标、核心循环、制作阶段、目录入口和未决问题整理成团队可读的项目总览。',
      acceptance: '00_Index 或 GDD 入口能链接到世界观、角色、地图、任务、台词/演出和 Unity 任务表；新成员打开后知道今天从哪里开始。',
    },
    {
      title: '补齐世界观 Bible 与术语规则',
      priority: 'high',
      dueIn: 2,
      estimate: 180,
      candidates: ['02_Worldbuilding/WorldBible.md', '02_Worldbuilding/NarrativePipeline.md', '02_Worldbuilding/README.md', '02_Worldbuilding'],
      deliverable: '整理世界规则、势力、地理、术语、禁忌、资源和剧情约束，给剧情/任务/台词提供统一依据。',
      acceptance: '世界观文档至少包含上游来源、下游影响、未决问题和 3 个有效 [[wiki-link]]；能支撑任务与台词设计。',
    },
    {
      title: '建立角色动机与对白语气表',
      priority: 'medium',
      dueIn: 3,
      estimate: 150,
      candidates: ['03_Characters/README.md', '03_Characters/CharacterBible.md', '03_Characters'],
      deliverable: '整理主要角色的目标、关系、冲突、说话方式、关键台词限制和演出需求。',
      acceptance: '角色页能回答“为什么行动、怎么说话、和谁冲突、在哪些任务里出现”；关联到世界观和剧情文档。',
    },
    {
      title: '把地图文档接入任务和演出需求',
      priority: 'medium',
      dueIn: 3,
      estimate: 120,
      candidates: ['04_Maps/README.md', '04_Maps/LotusPondIsland.md', '04_Maps'],
      deliverable: '把地图/场景文档里的区域、入口、怪物、交互点、镜头和剧情触发整理成可执行任务。',
      acceptance: '地图文档有场景目标、玩家路径、交互点、演出/音效/特效需求和实现任务链接。',
    },
    {
      title: '建立任务/剧情/台词/演出任务表',
      priority: 'high',
      dueIn: 2,
      estimate: 180,
      candidates: ['07_Unity_Tasks/NarrativeTaskTable.md', '06_Quests/NarrativeQuestMap.md', '02_Worldbuilding/NarrativePipeline.md', '07_Unity_Tasks'],
      deliverable: '把世界观、剧情 beat、任务目标、台词、演出和 Unity 实现拆成一张可分配任务表。',
      acceptance: '每个关键剧情/任务节点都有 owner、linkedDoc、验收标准、依赖和下游影响；AI 接管时可直接继续拆任务。',
    },
    {
      title: '建立团队工时和验收节奏',
      priority: 'medium',
      dueIn: 4,
      estimate: 90,
      candidates: ['09_Planning/README.md', '09_Planning', '07_Unity_Tasks/TeamProductionBootstrap.md'],
      deliverable: '约定成员如何记录 Work Log、如何提交验收、制作人何时看 review queue 和 blocker handoff。',
      acceptance: '每个成员知道自己的任务页在哪里；完成一段工作后能写 `- 45m | 做了什么`；验收通过/退回会写回任务文档。',
    },
  ];

  for (const area of focusAreas) {
    pushTask({
      title: area.title,
      owner,
      priority: area.priority,
      dueDate: teamDateOffset(today, area.dueIn),
      estimateMinutes: area.estimate,
      linkedDoc: firstExistingTeamMarkdown(vaultPath, area.candidates),
      deliverable: area.deliverable,
      acceptance: area.acceptance,
      dependency: '需要先阅读现有 Ars-note Markdown 文档，并在相关页面补齐 wiki-link。',
      notes: '团队工作区初始化自动任务。',
    });
  }

  const narrativeDraft = buildNarrativeTakeoverTaskDrafts(vaultPath, {
    limit: Math.max(12, limit - tasks.length),
    includeQa: true,
  });
  for (const task of narrativeDraft.tasks) {
    pushTask({
      ...task,
      owner: normalizeTeamScheduleText(task.owner) && normalizeTeamScheduleText(task.owner) !== '未分配'
        ? task.owner
        : owner,
      notes: [normalizeTeamScheduleText(task.notes), '团队工作区初始化从叙事健康扫描生成。'].filter(Boolean).join(' / '),
    });
  }

  return tasks.slice(0, limit);
}

function bootstrapTeamWorkspace(vaultPath: string, options: { currentMember?: string; limit?: number } = {}): { ok: true; createdAt: string; taskCount: number; schedulePath: string; content: string; upsert: ReturnType<typeof upsertTeamScheduleTasks>; productionDocs: ReturnType<typeof generateTeamProductionDocs>; health: any } {
  const resolvedVault = path.resolve(vaultPath);
  const tasks = buildTeamWorkspaceBootstrapTasks(resolvedVault, options);
  const upsert = upsertTeamScheduleTasks(resolvedVault, tasks, '团队工作区初始化');
  const productionDocs = generateTeamProductionDocs(resolvedVault, {
    includeDashboard: true,
    includeObsidianCommandCenter: true,
    includeProductionHealth: true,
    includeDependencyMap: true,
    includeHandoff: true,
    includeAiMemoryIndex: true,
    includeLinkHealth: true,
    includeBlockerHandoff: true,
    includeReviewQueue: true,
    includeWorkpack: true,
    includeDailyStandup: true,
    includeTimesheet: true,
    includeRoadmap: true,
    includeDecisionLog: true,
    includeChangeImpact: true,
    includeNarrativeDirector: true,
    includeSprintPlan: true,
    includeMemberPages: true,
    includeTaskDocs: true,
    includeTakeoverPlan: true,
  });
  const schedule = readTeamScheduleData(resolvedVault);
  return {
    ok: true,
    createdAt: new Date().toISOString(),
    taskCount: tasks.length,
    schedulePath: `${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`,
    content: JSON.stringify(schedule, null, 2),
    upsert,
    productionDocs,
    health: buildTeamProductionHealth(resolvedVault, 16),
  };
}

function stripTeamDocInline(value: unknown): string {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/\[\[([^|\]]+)\|([^\]]+)]]/g, '$2')
    .replace(/\[\[([^\]]+)]]/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableTeamDocHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function readTeamTaskDocFrontmatter(content: string): Record<string, string> {
  const match = String(content || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const row = line.match(/^\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/);
    if (!row) continue;
    const rawValue = row[2].trim();
    if (!rawValue || rawValue === '[]' || rawValue === '{}') continue;
    result[row[1].toLowerCase()] = rawValue.replace(/^['"]|['"]$/g, '').trim();
  }
  return result;
}

function parseTeamDocStatus(value: unknown): TeamScheduleTaskStatus | '' {
  const raw = stripTeamDocInline(value).toLowerCase().replace(/[_-]/g, ' ');
  if (!raw) return '';
  if (/^(todo|open|pending)$/.test(raw) || /(待开始|待办|未开始)/i.test(raw)) return 'todo';
  if (/^(doing|wip|in progress)$/.test(raw) || /(进行中|制作中|开发中|处理中)/i.test(raw)) return 'doing';
  if (/^(review|qa|checking)$/.test(raw) || /(待检查|待确认|待验收|检查|验收)/i.test(raw)) return 'review';
  if (/^(blocked|blocker|stuck)$/.test(raw) || /(阻塞|卡住|卡点)/i.test(raw)) return 'blocked';
  if (/^(done|complete|completed|closed|finished)$/.test(raw) || /(完成|已完成|通过|关闭)/i.test(raw)) return 'done';
  return '';
}

function parseTeamDocPriority(value: unknown): TeamScheduleTaskPriority | '' {
  const raw = stripTeamDocInline(value).toLowerCase();
  if (!raw) return '';
  if (/^(high|p0|p1)$/.test(raw) || /(高|紧急|必须)/i.test(raw)) return 'high';
  if (/^(low|p3)$/.test(raw) || /(低|以后|可延后)/i.test(raw)) return 'low';
  if (/^(medium|normal|p2)$/.test(raw) || /(中|普通|正常)/i.test(raw)) return 'medium';
  return '';
}

function parseTeamDocDurationMinutes(value: unknown): number {
  const raw = String(value || '').toLowerCase();
  let minutes = 0;
  const hourMatches = raw.matchAll(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours|小时|小時)/gi);
  for (const match of hourMatches) minutes += Number(match[1]) * 60;
  const minuteMatches = raw.matchAll(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes|分钟|分鐘)/gi);
  for (const match of minuteMatches) minutes += Number(match[1]);
  if (!minutes) {
    const explicit = raw.match(/(?:estimate|estimated|minutes|用时|工时|耗时)\s*[:：]?\s*(\d+(?:\.\d+)?)/i);
    if (explicit) minutes = Number(explicit[1]);
  }
  if (!minutes && /^\d+(?:\.\d+)?$/.test(raw.trim())) minutes = Number(raw.trim());
  return Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
}

function readTeamTaskDocField(content: string, keys: string[]): string {
  const escaped = keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const match = String(content || '').match(new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:${escaped})\\s*[:：]\\s*([^\\n]+)`, 'i'));
  return match ? stripTeamDocInline(match[1]).slice(0, 500) : '';
}

function readTeamTaskDocCheckboxProgress(content: string): {
  total: number;
  checked: number;
  acceptanceTotal: number;
  acceptanceChecked: number;
} {
  let total = 0;
  let checked = 0;
  let acceptanceTotal = 0;
  let acceptanceChecked = 0;
  let inAcceptanceSection = false;

  for (const line of String(content || '').split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      const label = stripTeamDocInline(heading[1]).toLowerCase();
      inAcceptanceSection = /(acceptance criteria|acceptance|criteria|验收标准|验收条件|验收清单|验收)/i.test(label);
      continue;
    }

    const checkbox = line.match(/^\s*(?:[-*+]\s*)?\[([ xX])\]\s+(.+)$/);
    if (!checkbox) continue;
    total += 1;
    const isChecked = checkbox[1].toLowerCase() === 'x';
    if (isChecked) checked += 1;
    if (inAcceptanceSection) {
      acceptanceTotal += 1;
      if (isChecked) acceptanceChecked += 1;
    }
  }

  return { total, checked, acceptanceTotal, acceptanceChecked };
}

function hasTeamReviewResultSignal(value: unknown): boolean {
  const raw = stripTeamDocInline(value).toLowerCase();
  if (!raw) return false;
  return /(approved|approve|pass|passed|done|complete|completed|changes|change|reject|rejected|fail|failed|return|returned|note|comment|通过|验收通过|完成|已完成|退回|修改|不通过|失败|备注|说明)/i.test(raw);
}

function parseTeamTaskDocReviewResultFields(content: string, task: any, relativePath: string, fallbackMember: string): any[] {
  let inReviewSection = false;
  const fields: Record<string, string> = {};

  for (const line of String(content || '').split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      const label = stripTeamDocInline(heading[1]).toLowerCase();
      inReviewSection = /(review result|qa result|acceptance result|验收结果|复查结果|评审结果)/i.test(label);
      continue;
    }
    if (!inReviewSection) continue;

    const field = stripTeamDocInline(line).match(/^(?:[-*+]\s*)?(日期|date|验收人|reviewer|owner|结论|result|status|状态|备注|note|comment)\s*[:：]\s*(.+)$/i);
    if (!field) continue;
    const key = field[1].toLowerCase();
    fields[key] = stripTeamDocInline(field[2]);
  }

  const resultText = fields.result || fields.status || fields['结论'] || fields['状态'] || '';
  if (!hasTeamReviewResultSignal(resultText)) return [];
  const date = normalizeTeamScheduleDate(fields.date || fields['日期']) || teamTodayString();
  const reviewer = fields.reviewer || fields.owner || fields['验收人'] || '';
  const note = fields.note || fields.comment || fields['备注'] || resultText;
  const raw = [date, reviewer, resultText, note].join('|');
  return [{
    id: `docreview-${normalizeTeamScheduleText(task.id)}-${stableTeamDocHash(`${relativePath}|fields|${raw}`)}`,
    reviewer: normalizeTeamMemberName(reviewer || fallbackMember || task.owner),
    date,
    result: normalizeTeamReviewResult(resultText),
    note: note || `Synced from ${relativePath}`,
    createdAt: teamTaskDocLogCreatedAt(date),
  }];
}

function normalizeTeamMemberName(value: unknown): string {
  return normalizeTeamScheduleText(value) || '未分配';
}

function teamTaskDocLogCreatedAt(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? nowIso() : parsed.toISOString();
}

function resolveTeamTaskDocPath(vaultPath: string, linkedDoc: unknown): { relativePath: string; fullPath: string } | null {
  const relativePath = normalizeTeamSchedulePath(linkedDoc);
  if (!relativePath || !relativePath.toLowerCase().endsWith('.md')) return null;
  const root = path.resolve(vaultPath);
  const fullPath = path.resolve(root, relativePath);
  if (fullPath !== root && !fullPath.startsWith(root + path.sep)) return null;
  return { relativePath, fullPath };
}

function parseTeamTaskDocLogs(content: string, task: any, relativePath: string, fallbackMember: string): any[] {
  const logs: any[] = [];
  let inLogSection = false;
  for (const line of String(content || '').split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      const label = stripTeamDocInline(heading[1]).toLowerCase();
      inLogSection = /(工时|用时|耗时|时间记录|time log|work log|timesheet|implementation log|实现记录|进度记录)/i.test(label);
      continue;
    }
    if (!inLogSection) continue;
    const bullet = line.match(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)(.+)$/);
    if (!bullet) continue;
    const raw = stripTeamDocInline(bullet[1]);
    const date = normalizeTeamScheduleDate(raw) || teamTodayString();
    const minutes = parseTeamDocDurationMinutes(raw);
    if (minutes <= 0) continue;
    const cells = raw.split('|').map((cell) => stripTeamDocInline(cell)).filter(Boolean);
    let member = '';
    let note = raw;
    if (cells.length >= 4 && normalizeTeamScheduleDate(cells[0])) {
      member = cells[1] || '';
      note = cells.slice(3).join(' | ');
    } else if (cells.length >= 3 && normalizeTeamScheduleDate(cells[0]) && parseTeamDocDurationMinutes(cells[1]) > 0) {
      note = cells.slice(2).join(' | ');
    } else if (cells.length >= 3 && parseTeamDocDurationMinutes(cells[1]) > 0) {
      member = cells[0] || '';
      note = cells.slice(2).join(' | ');
    } else if (cells.length >= 2 && parseTeamDocDurationMinutes(cells[0]) > 0) {
      note = cells.slice(1).join(' | ');
    } else if (cells.length >= 2 && parseTeamDocDurationMinutes(cells[1]) > 0) {
      member = cells[0] || '';
      note = cells.slice(2).join(' | ') || cells[0];
    } else {
      const mention = raw.match(/@([^\s,，。；;]+)/);
      member = mention ? stripTeamDocInline(mention[1]) : '';
      note = raw
        .replace(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/, '')
        .replace(/@([^\s,，。；;]+)/, '')
        .replace(/\d+(?:\.\d+)?\s*(?:h|hr|hrs|hour|hours|小时|小時|m|min|mins|minute|minutes|分钟|分鐘)/gi, '')
        .replace(/^[\s|:：,，。；;-]+/, '')
        .trim();
    }
    logs.push({
      id: `doclog-${normalizeTeamScheduleText(task.id)}-${stableTeamDocHash(`${relativePath}|${raw}`)}`,
      member: normalizeTeamMemberName(member || fallbackMember || task.owner),
      date,
      minutes,
      note: note || `Synced from ${relativePath}`,
      createdAt: teamTaskDocLogCreatedAt(date),
    });
  }
  return logs;
}

function parseTeamTaskDocReviewLogs(content: string, task: any, relativePath: string, fallbackMember: string): any[] {
  const logs: any[] = [];
  let inReviewSection = false;
  for (const line of String(content || '').split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      const label = stripTeamDocInline(heading[1]).toLowerCase();
      inReviewSection = /(review result|review log|qa result|acceptance result|验收结果|验收记录|复查记录|评审记录)/i.test(label);
      continue;
    }
    if (!inReviewSection) continue;
    const bullet = line.match(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)(.+)$/);
    if (!bullet) continue;
    const raw = stripTeamDocInline(bullet[1]);
    const explicitDate = normalizeTeamScheduleDate(raw);
    const cells = raw.split('|').map((cell) => stripTeamDocInline(cell)).filter(Boolean);
    let reviewer = '';
    let resultText = '';
    let note = raw;
    if (cells.length >= 4 && normalizeTeamScheduleDate(cells[0])) {
      reviewer = cells[1] || '';
      resultText = cells[2] || '';
      note = cells.slice(3).join(' | ') || resultText;
    } else if (cells.length >= 2 && normalizeTeamScheduleDate(cells[0]) && hasTeamReviewResultSignal(cells[1])) {
      resultText = cells[1] || '';
      note = cells.slice(2).join(' | ') || resultText;
    } else if (cells.length >= 3 && normalizeTeamScheduleDate(cells[0])) {
      reviewer = cells[1] || '';
      resultText = cells[2] || '';
      note = cells.slice(3).join(' | ') || resultText;
    } else if (cells.length >= 3 && hasTeamReviewResultSignal(cells[1])) {
      reviewer = cells[0] || '';
      resultText = cells[1] || '';
      note = cells.slice(2).join(' | ') || resultText;
    } else if (cells.length >= 2 && hasTeamReviewResultSignal(cells[0])) {
      resultText = cells[0] || '';
      note = cells.slice(1).join(' | ') || resultText;
    } else {
      resultText = raw;
    }
    if (!hasTeamReviewResultSignal(resultText)) continue;
    const date = explicitDate || teamTodayString();
    logs.push({
      id: `docreview-${normalizeTeamScheduleText(task.id)}-${stableTeamDocHash(`${relativePath}|${raw}`)}`,
      reviewer: normalizeTeamMemberName(reviewer || fallbackMember || task.owner),
      date,
      result: normalizeTeamReviewResult(resultText),
      note: note || `Synced from ${relativePath}`,
      createdAt: teamTaskDocLogCreatedAt(date),
    });
  }
  return logs;
}

function syncTeamTaskFromDocContent(task: any, content: string, relativePath: string, fallbackMember: string): {
  changed: boolean;
  addedLogs: number;
  addedReviews: number;
  inferredStatus: boolean;
  task: any;
} {
  const frontmatter = readTeamTaskDocFrontmatter(content);
  const logs = Array.isArray(task.logs) ? task.logs : [];
  const reviewLogs = Array.isArray(task.reviewLogs) ? task.reviewLogs : [];
  const normalizedTask = {
    ...task,
    id: typeof task.id === 'string' ? task.id : `task-${crypto.randomUUID()}`,
    logs,
    reviewLogs,
  };
  const patch: Record<string, unknown> = {};
  let inferredStatus = false;
  let statusPatchedFromDocField = false;
  const initialStatus = normalizeTeamTaskStatus(normalizedTask.status);
  const frontmatterStatus = parseTeamDocStatus(frontmatter.status || frontmatter.state);
  const bodyStatus = parseTeamDocStatus(readTeamTaskDocField(content, ['status', 'state', '状态', '进度']));
  const status = frontmatterStatus || bodyStatus;
  const priority = parseTeamDocPriority(frontmatter.priority);
  const owner = stripTeamDocInline(frontmatter.owner || frontmatter.assignee || frontmatter.member || '');
  const dueDate = normalizeTeamScheduleDate(frontmatter.duedate || frontmatter.due || frontmatter.deadline);
  const startDate = normalizeTeamScheduleDate(frontmatter.startdate || frontmatter.start);
  const estimateMinutes = parseTeamDocDurationMinutes(frontmatter.estimateminutes || frontmatter.estimate || frontmatter.estimated);
  const blocker = stripTeamDocInline(frontmatter.blocker || frontmatter.blockedreason || '') || readTeamTaskDocField(content, ['blocker', 'blockedReason', '阻塞', '卡点', '卡住原因']);
  const dependency = stripTeamDocInline(frontmatter.dependency || frontmatter.dependencies || '') || readTeamTaskDocField(content, ['dependency', 'dependencies', 'depends', '依赖', '前置']);
  const acceptance = stripTeamDocInline(frontmatter.acceptance || frontmatter.acceptancecriteria || '') || readTeamTaskDocField(content, ['acceptance', 'criteria', 'test', '验收', '验收标准', '测试']);
  const statusRank: Record<TeamScheduleTaskStatus, number> = { todo: 0, doing: 1, review: 2, blocked: 2, done: 3 };
  const canApplyDocStatus = !status || status === 'blocked' || statusRank[status] >= statusRank[initialStatus];

  if (status && status !== initialStatus && canApplyDocStatus) {
    patch.status = status;
    statusPatchedFromDocField = true;
  }
  if (priority && priority !== normalizeTeamTaskPriority(normalizedTask.priority)) patch.priority = priority;
  if (owner && owner !== normalizeTeamScheduleText(normalizedTask.owner)) patch.owner = owner;
  if (dueDate && dueDate !== normalizeTeamScheduleDate(normalizedTask.dueDate)) patch.dueDate = dueDate;
  if (startDate && startDate !== normalizeTeamScheduleDate(normalizedTask.startDate)) patch.startDate = startDate;
  if (estimateMinutes > 0 && estimateMinutes !== parseTeamScheduleMinutes(normalizedTask.estimateMinutes)) patch.estimateMinutes = estimateMinutes;
  if (blocker && blocker !== normalizeTeamScheduleText(normalizedTask.blocker)) {
    patch.blocker = blocker;
    if (!status && normalizeTeamTaskStatus(normalizedTask.status) !== 'done') {
      patch.status = 'blocked';
      inferredStatus = true;
    }
  }
  if (dependency && dependency !== normalizeTeamScheduleText(normalizedTask.dependency)) patch.dependency = dependency;
  if (acceptance && acceptance !== normalizeTeamScheduleText(normalizedTask.acceptance)) patch.acceptance = acceptance;

  const existingLogIds = new Set(logs.map((log: any) => normalizeTeamScheduleText(log?.id)));
  const docLogs = parseTeamTaskDocLogs(content, normalizedTask, relativePath, fallbackMember)
    .filter((log: any) => !existingLogIds.has(log.id));
  const existingReviewIds = new Set(reviewLogs.map((log: any) => normalizeTeamScheduleText(log?.id)));
  const docReviews = [
    ...parseTeamTaskDocReviewLogs(content, normalizedTask, relativePath, fallbackMember),
    ...parseTeamTaskDocReviewResultFields(content, normalizedTask, relativePath, fallbackMember),
  ]
    .filter((log: any) => !existingReviewIds.has(log.id));
  const checkboxProgress = readTeamTaskDocCheckboxProgress(content);
  const canInferOverCurrentStatus = (): boolean => !patch.status
    || (statusPatchedFromDocField && (patch.status === 'todo' || patch.status === 'doing' || patch.status === 'review'));
  if (docLogs.length > 0 && canInferOverCurrentStatus() && (initialStatus === 'todo' || patch.status === 'todo')) {
    patch.status = 'doing';
    inferredStatus = true;
  }
  const latestDocReview = docReviews
    .slice()
    .sort((a: any, b: any) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')))[0];
  if (latestDocReview && canInferOverCurrentStatus()) {
    if (normalizeTeamReviewResult(latestDocReview.result) === 'approved') {
      patch.status = 'done';
      inferredStatus = true;
    }
    if (normalizeTeamReviewResult(latestDocReview.result) === 'changes') {
      patch.status = 'doing';
      inferredStatus = true;
    }
  }
  const currentStatus = normalizeTeamTaskStatus(normalizedTask.status);
  if (canInferOverCurrentStatus() && currentStatus !== 'done' && currentStatus !== 'blocked') {
    if (checkboxProgress.acceptanceTotal > 0 && checkboxProgress.acceptanceChecked === checkboxProgress.acceptanceTotal) {
      patch.status = 'review';
      inferredStatus = true;
    } else if (checkboxProgress.checked > 0 && normalizeTeamTaskStatus(normalizedTask.status) === 'todo') {
      patch.status = 'doing';
      inferredStatus = true;
    }
  }
  const changed = Object.keys(patch).length > 0 || docLogs.length > 0 || docReviews.length > 0;
  return {
    changed,
    addedLogs: docLogs.length,
    addedReviews: docReviews.length,
    inferredStatus: Boolean(inferredStatus && patch.status),
    task: changed
      ? { ...normalizedTask, ...patch, logs: [...docLogs, ...logs], reviewLogs: [...docReviews, ...reviewLogs], updatedAt: nowIso() }
      : normalizedTask,
  };
}

function syncTeamTaskDocsToSchedule(vaultPath: string, fallbackMember = ''): {
  scannedCount: number;
  changedCount: number;
  addedLogCount: number;
  addedReviewCount: number;
  inferredStatusCount: number;
  missingCount: number;
  skippedCount: number;
  schedulePath: string;
  content: string;
} {
  const resolvedVault = path.resolve(vaultPath);
  const scheduleFile = teamSchedulePath(resolvedVault);
  const schedule = readTeamScheduleData(resolvedVault);
  let scannedCount = 0;
  let changedCount = 0;
  let addedLogCount = 0;
  let addedReviewCount = 0;
  let inferredStatusCount = 0;
  let missingCount = 0;
  let skippedCount = 0;
  const nextTasks: any[] = [];

  for (const task of Array.isArray(schedule.tasks) ? schedule.tasks : []) {
    const docPath = resolveTeamTaskDocPath(resolvedVault, task.linkedDoc);
    if (!docPath) {
      skippedCount += 1;
      nextTasks.push(task);
      continue;
    }
    if (!fs.existsSync(docPath.fullPath)) {
      missingCount += 1;
      nextTasks.push(task);
      continue;
    }
    try {
      const content = fs.readFileSync(docPath.fullPath, 'utf-8');
      scannedCount += 1;
      const result = syncTeamTaskFromDocContent(task, content, docPath.relativePath, fallbackMember);
      if (result.changed) changedCount += 1;
      addedLogCount += result.addedLogs;
      addedReviewCount += result.addedReviews;
      if (result.inferredStatus) inferredStatusCount += 1;
      nextTasks.push(result.task);
    } catch {
      skippedCount += 1;
      nextTasks.push(task);
    }
  }

  const members = new Set<string>();
  for (const member of Array.isArray(schedule.members) ? schedule.members : []) {
    const clean = normalizeTeamScheduleText(member);
    if (clean && clean !== '未分配') members.add(clean);
  }
  for (const task of nextTasks) {
    const owner = normalizeTeamScheduleText(task.owner);
    if (owner && owner !== '未分配') members.add(owner);
    for (const log of Array.isArray(task.logs) ? task.logs : []) {
      const member = normalizeTeamScheduleText(log?.member);
      if (member && member !== '未分配') members.add(member);
    }
    for (const review of Array.isArray(task.reviewLogs) ? task.reviewLogs : []) {
      const reviewer = normalizeTeamScheduleText(review?.reviewer || review?.member);
      if (reviewer && reviewer !== '未分配') members.add(reviewer);
    }
  }

  const next = {
    version: 1,
    updatedAt: nowIso(),
    members: Array.from(members).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    tasks: nextTasks.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))),
    deletedTaskIds: Array.isArray(schedule.deletedTaskIds) ? schedule.deletedTaskIds : [],
  };
  const content = JSON.stringify(next, null, 2);
  if (changedCount > 0 || addedLogCount > 0 || addedReviewCount > 0) {
    if (!fs.existsSync(path.dirname(scheduleFile))) fs.mkdirSync(path.dirname(scheduleFile), { recursive: true });
    saveLiveHistoryBeforeOverwrite(scheduleFile, content, 'ai-team-task-doc-sync');
    fs.writeFileSync(scheduleFile, content, 'utf-8');
  }
  return {
    scannedCount,
    changedCount,
    addedLogCount,
    addedReviewCount,
    inferredStatusCount,
    missingCount,
    skippedCount,
    schedulePath: `${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`,
    content,
  };
}

function upsertTeamScheduleTasks(vaultPath: string, rawTasks: any[], sourceLabel = 'AI', options: TeamScheduleUpsertOptions = {}): TeamScheduleUpsertResult {
  const resolvedVault = path.resolve(vaultPath);
  const scheduleFile = teamSchedulePath(resolvedVault);
  const schedule = readTeamScheduleData(resolvedVault);
  const assignment = options.balanceAssignments
    ? balanceTeamTaskAssignmentsForAI(resolvedVault, schedule, rawTasks)
    : { tasks: Array.isArray(rawTasks) ? rawTasks : [], review: undefined };
  const existingByKey = new Map<string, any>();
  for (const task of schedule.tasks) existingByKey.set(teamTaskKey(task), task);

  const now = nowIso();
  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const rawTask of assignment.tasks) {
    if (!rawTask || typeof rawTask !== 'object') {
      skippedCount += 1;
      continue;
    }
    const title = normalizeTeamScheduleText(rawTask.title || rawTask.task || rawTask.deliverable);
    if (!title) {
      skippedCount += 1;
      continue;
    }
    const owner = normalizeTeamScheduleText(rawTask.owner || rawTask.assignee || rawTask.discipline) || '未分配';
    const linkedDoc = normalizeTeamSchedulePath(rawTask.linkedDoc || rawTask.doc || rawTask.path || rawTask.sourceDoc);
    const key = teamTaskKey({ title, owner, linkedDoc });
    const notes = normalizeTeamScheduleText(rawTask.notes);
    const nextPatch = {
      title,
      owner,
      status: normalizeTeamTaskStatus(rawTask.status),
      priority: normalizeTeamTaskPriority(rawTask.priority),
      startDate: normalizeTeamScheduleDate(rawTask.startDate),
      dueDate: normalizeTeamScheduleDate(rawTask.dueDate || rawTask.deadline),
      estimateMinutes: parseTeamScheduleMinutes(rawTask.estimateMinutes || rawTask.estimate || rawTask.estimatedMinutes),
      linkedDoc,
      deliverable: normalizeTeamScheduleText(rawTask.deliverable) || title,
      dependency: normalizeTeamScheduleText(rawTask.dependency || rawTask.dependencies),
      blocker: normalizeTeamScheduleText(rawTask.blocker || rawTask.blockedReason),
      acceptance: normalizeTeamScheduleText(rawTask.acceptance || rawTask.acceptanceCriteria || rawTask.test),
      notes: notes ? `${sourceLabel}: ${notes}` : sourceLabel,
      updatedAt: now,
    };

    const existing = existingByKey.get(key);
    if (existing) {
      Object.assign(existing, {
        ...existing,
        ...nextPatch,
        id: typeof existing.id === 'string' ? existing.id : crypto.randomUUID(),
        createdAt: typeof existing.createdAt === 'string' ? existing.createdAt : now,
        logs: Array.isArray(existing.logs) ? existing.logs : [],
        reviewLogs: Array.isArray(existing.reviewLogs) ? existing.reviewLogs : [],
      });
      updatedCount += 1;
      continue;
    }

    const newTask = {
      id: `task-${crypto.randomUUID()}`,
      ...nextPatch,
      createdAt: now,
      logs: [],
      reviewLogs: [],
    };
    schedule.tasks.push(newTask);
    existingByKey.set(key, newTask);
    importedCount += 1;
  }

  const members = new Set<string>();
  for (const member of Array.isArray(schedule.members) ? schedule.members : []) {
    const clean = normalizeTeamScheduleText(member);
    if (clean) members.add(clean);
  }
  for (const task of schedule.tasks) {
    const owner = normalizeTeamScheduleText(task.owner);
    if (owner && owner !== '未分配') members.add(owner);
    for (const review of Array.isArray(task.reviewLogs) ? task.reviewLogs : []) {
      const reviewer = normalizeTeamScheduleText(review?.reviewer || review?.member);
      if (reviewer && reviewer !== '未分配') members.add(reviewer);
    }
  }
  const next = {
    ...schedule,
    version: 1,
    updatedAt: now,
    members: Array.from(members).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    deletedTaskIds: Array.isArray(schedule.deletedTaskIds) ? schedule.deletedTaskIds : [],
  };
  const content = JSON.stringify(next, null, 2);
  fs.mkdirSync(path.dirname(scheduleFile), { recursive: true });
  saveLiveHistoryBeforeOverwrite(scheduleFile, content, 'ai-team-schedule-upsert');
  fs.writeFileSync(scheduleFile, content, 'utf-8');
  return { importedCount, updatedCount, skippedCount, schedulePath: `${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`, content, assignmentReview: assignment.review };
}

function teamTodayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatTeamMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes || 0));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

function formatTeamBytes(bytes: number): string {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${Math.round(value)} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
}

function teamMarkdownCell(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function compactTeamReportText(value: unknown, maxLength = 120): string {
  const clean = stripTeamDocInline(value).replace(/\s+/g, ' ').trim();
  return clean.length > maxLength ? clean.slice(0, Math.max(0, maxLength - 1)) + '…' : clean;
}

function teamDocWikiLink(value: unknown): string {
  const clean = normalizeTeamSchedulePath(value);
  if (!clean) return '-';
  return `[[${clean.replace(/\.md$/i, '')}]]`;
}

function teamReportTaskSort(tasks: any[]): any[] {
  const priorityWeight: Record<TeamScheduleTaskPriority, number> = { high: 3, medium: 2, low: 1 };
  const statusWeight: Record<TeamScheduleTaskStatus, number> = { blocked: 0, review: 1, doing: 2, todo: 3, done: 4 };
  return tasks.slice().sort((a, b) => {
    const aStatus = normalizeTeamTaskStatus(a.status);
    const bStatus = normalizeTeamTaskStatus(b.status);
    const aDue = normalizeTeamScheduleDate(a.dueDate);
    const bDue = normalizeTeamScheduleDate(b.dueDate);
    return statusWeight[aStatus] - statusWeight[bStatus]
      || (bDue ? 0 : 1) - (aDue ? 0 : 1)
      || aDue.localeCompare(bDue)
      || priorityWeight[normalizeTeamTaskPriority(b.priority)] - priorityWeight[normalizeTeamTaskPriority(a.priority)]
      || normalizeTeamScheduleText(a.title).localeCompare(normalizeTeamScheduleText(b.title), 'zh-CN');
  });
}

function normalizeTeamReportMatchText(value: unknown): string {
  return stripTeamDocInline(value).toLowerCase().replace(/\.md\b/g, '').replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
}

function findTeamDependencyMatches(task: any, tasks: any[]): any[] {
  const source = normalizeTeamReportMatchText([
    task?.dependency,
    task?.blocker,
    task?.notes,
  ].filter(Boolean).join(' '));
  if (!source) return [];
  const matches: any[] = [];
  for (const candidate of tasks) {
    if (candidate === task || normalizeTeamScheduleText(candidate?.id) === normalizeTeamScheduleText(task?.id)) continue;
    const titleKey = normalizeTeamReportMatchText(candidate?.title);
    const docKey = normalizeTeamReportMatchText(candidate?.linkedDoc);
    const docNameKey = normalizeTeamReportMatchText(path.basename(normalizeTeamSchedulePath(candidate?.linkedDoc), '.md'));
    if ((titleKey.length >= 4 && source.includes(titleKey))
      || (docKey.length >= 4 && source.includes(docKey))
      || (docNameKey.length >= 4 && source.includes(docNameKey))) {
      matches.push(candidate);
    }
    if (matches.length >= 5) break;
  }
  return matches;
}

function mermaidTeamLabel(value: unknown, maxLength = 44): string {
  return compactTeamReportText(value, maxLength).replace(/"/g, '\\"').replace(/\|/g, '/');
}

function buildTeamAIHandoffPage(vaultPath: string, schedule: any, health: any, date = teamTodayString()): string {
  const stats = summarizeTeamSchedule(schedule);
  const activeTasks = teamReportTaskSort((schedule.tasks || []).filter((task: any) => normalizeTeamTaskStatus(task.status) !== 'done'));
  const recommendations = Array.isArray(health?.recommendations) ? health.recommendations : [];
  const focus = health?.focus || {};
  const narrative = health?.narrative || {};
  const qa = health?.qa || {};
  const memberLoad = Array.isArray(health?.memberLoad) ? health.memberLoad : buildTeamMemberLoadRows(vaultPath, schedule, date);
  const aiMemoryOverview = buildAiMemorySyncOverview(vaultPath);
  const lines: string[] = [];
  lines.push('---');
  lines.push('type: ars-ai-production-handoff');
  lines.push(`date: ${JSON.stringify(date)}`);
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push(`scheduleUpdatedAt: ${JSON.stringify(schedule.updatedAt || '')}`);
  lines.push('---');
  lines.push('');
  lines.push('# AI 制作交接简报');
  lines.push('');
  lines.push(`> 自动从 \`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}\` 和制作健康扫描生成。用于 AI 接管叙事、任务、QA 和团队执行流程前先读。`);
  lines.push('');
  lines.push('## 当前状态');
  lines.push('| 指标 | 数量 |');
  lines.push('| --- | ---: |');
  lines.push(`| 总任务 | ${stats.total} |`);
  lines.push(`| 活跃任务 | ${stats.active} |`);
  lines.push(`| 已完成 | ${stats.done} |`);
  lines.push(`| 阻塞 | ${stats.blocked} |`);
  lines.push(`| 逾期 | ${stats.overdue} |`);
  lines.push(`| 缺负责人 | ${stats.missingOwner} |`);
  lines.push(`| 缺截止日期 | ${stats.missingDueDate} |`);
  lines.push(`| 缺关联文档 | ${health?.stats?.missingDocs || 0} |`);
  lines.push(`| 未关闭 QA/Bug/试玩反馈 | ${qa.total || 0} |`);
  lines.push(`| 叙事缺阶段 | ${health?.stats?.narrativeMissingStages || 0} |`);
  lines.push(`| 叙事弱链接 | ${health?.stats?.narrativeWeakLinks || 0} |`);
  lines.push(`| 成员需处理 | ${health?.stats?.memberLoadDanger || 0} |`);
  lines.push(`| 成员需关注 | ${health?.stats?.memberLoadWarning || 0} |`);
  lines.push(`| 累计记录用时 | ${formatTeamMinutes(stats.totalMinutes)} |`);
  lines.push('');
  lines.push('## AI 记忆与 Skill 同步');
  lines.push(`- 索引页：[[${TEAM_SCHEDULE_DIR}/${teamAiMemoryIndexFileName().replace(/\.md$/i, '')}|${teamAiMemoryIndexFileName().replace(/\.md$/i, '')}]]`);
  lines.push(`- 核心记忆：${aiMemoryOverview.coreFiles.length}/3；Skills：${aiMemoryOverview.coverage.skills}；Evolution：${aiMemoryOverview.coverage.evolutions}；同步文件：${aiMemoryOverview.syncedCount}`);
  lines.push('- live-session.json 和 history/ 是本地临时会话，不会同步；长期判断请写入 MEMORY.md，可复用方法请写入 skills/*.md。');
  lines.push('');

  lines.push('## AI 接管顺序');
  if (recommendations.length === 0) {
    lines.push('- 暂无自动建议，先读取团队时间表和当前文档。');
  } else {
    for (const item of recommendations.slice(0, 10)) lines.push(`- ${item}`);
  }
  lines.push('');

  lines.push('## 成员调度风险');
  if (memberLoad.length === 0) {
    lines.push('- 暂无成员负载数据。');
  } else {
    lines.push('| 状态 | 成员 | 活跃 | 风险 | 剩余 | 下一项 | 建议动作 |');
    lines.push('| --- | --- | ---: | --- | ---: | --- | --- |');
    for (const row of memberLoad.slice(0, 12)) {
      lines.push([
        teamMemberLoadLabel(row.level),
        teamMarkdownCell(row.member),
        row.active || 0,
        teamMarkdownCell(Array.isArray(row.reasons) && row.reasons.length ? row.reasons.slice(0, 4).join(' / ') : '节奏正常'),
        formatTeamMinutes(row.remainingMinutes || 0),
        teamMarkdownCell(row.nextTask?.title || '-'),
        teamMarkdownCell(row.recommendation || '-'),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');

  lines.push('## 最高优先级任务');
  const priorityTasks = teamReportTaskSort(Array.from(new Map([
    ...((focus.blocked || []) as any[]),
    ...((focus.overdue || []) as any[]),
    ...((focus.dueSoon || []) as any[]),
    ...activeTasks.filter((task: any) => normalizeTeamTaskPriority(task.priority) === 'high').map(teamTaskBrief),
    ...activeTasks.map(teamTaskBrief),
  ].map((task: any) => [task.id || teamTaskKey(task), task] as const)).values())).slice(0, 18);
  if (priorityTasks.length === 0) {
    lines.push('- 暂无活跃任务。');
  } else {
    for (const task of priorityTasks) {
      const status = normalizeTeamTaskStatus(task.status);
      const flags = [
        status === 'blocked' ? '阻塞' : '',
        normalizeTeamScheduleDate(task.dueDate) && normalizeTeamScheduleDate(task.dueDate) < date ? '逾期' : '',
        normalizeTeamTaskPriority(task.priority) === 'high' ? '高优先级' : '',
      ].filter(Boolean);
      lines.push(`- **${normalizeTeamScheduleText(task.title)}**${flags.length ? ` _${flags.join(' / ')}_` : ''}`);
      lines.push(`  - 负责人：${normalizeTeamScheduleText(task.owner) || '未分配'}；状态：${status}；优先级：${normalizeTeamTaskPriority(task.priority)}；截止：${normalizeTeamScheduleDate(task.dueDate) || '-'}；文档：${teamDocWikiLink(task.linkedDoc)}`);
      if (task.deliverable) lines.push(`  - 交付：${compactTeamReportText(task.deliverable, 180)}`);
      if (task.dependency) lines.push(`  - 依赖：${compactTeamReportText(task.dependency, 180)}`);
      if (task.blocker) lines.push(`  - 阻塞：${compactTeamReportText(task.blocker, 180)}`);
      if (task.acceptance) lines.push(`  - 验收：${compactTeamReportText(task.acceptance, 220)}`);
    }
  }
  lines.push('');

  lines.push('## QA / Bug / 试玩反馈');
  const qaItems = Array.isArray(focus.qa) ? focus.qa : [];
  if (qaItems.length === 0) {
    lines.push('- 暂无未关闭 QA/Bug/试玩反馈。');
  } else {
    for (const item of qaItems.slice(0, 12)) {
      lines.push(`- [${item.priority || 'medium'}] ${compactTeamReportText(item.title || item.text || 'QA item', 140)}（${item.relativePath ? teamDocWikiLink(item.relativePath) : '-'}）`);
      if (item.repro) lines.push(`  - 复现：${compactTeamReportText(item.repro, 180)}`);
      if (item.expected || item.actual) lines.push(`  - 期望/实际：${compactTeamReportText([item.expected, item.actual].filter(Boolean).join(' / '), 180)}`);
    }
  }
  lines.push('');

  lines.push('## 叙事链路缺口');
  const missingStages = Array.isArray(narrative.missingStages) ? narrative.missingStages : [];
  const weakLinks = Array.isArray(narrative.weakLinks) ? narrative.weakLinks : [];
  if (missingStages.length === 0 && weakLinks.length === 0) {
    lines.push('- 叙事链路暂无明显阶段缺口。');
  } else {
    for (const stage of missingStages) lines.push(`- 缺阶段：${stage.label || stage.stage}`);
    for (const link of weakLinks.slice(0, 8)) lines.push(`- 弱链接：${link}`);
  }
  lines.push('');

  lines.push('## AI 操作约定');
  lines.push('- 先调用 `sync_team_task_docs`，再读取 `read_production_health`。');
  lines.push('- 新增任务必须写 owner / priority / linkedDoc / dependency / acceptance。');
  lines.push('- 不要跳过 QA、Bug、试玩反馈；这些也是真实制作任务。');
  lines.push('- 修改叙事时同时维护 NarrativePipeline 和 NarrativeTaskTable。');
  lines.push('- 完成整理后调用 `generate_team_production_docs` 刷新本文件、叙事导演台、周计划、里程碑路线图、变更影响表、依赖图、阻塞交接清单、验收队列、今日工作包和成员任务页。');

  return lines.join('\n');
}

function buildTeamAiMemoryIndexPage(vaultPath: string, date = teamTodayString()): string {
  const overview = buildAiMemorySyncOverview(vaultPath);
  const resolvedVault = path.resolve(vaultPath);
  const aiDirPath = path.join(resolvedVault, AI_MEMORY_DIR);
  const dateKey = date.replace(/-/g, '');
  const fileMeta = (relPath: string): { size: number; mtime: string; title: string } => {
    const fullPath = path.resolve(path.join(aiDirPath, relPath));
    if (!isInsidePath(fullPath, aiDirPath) || !fs.existsSync(fullPath)) return { size: 0, mtime: '-', title: '-' };
    const stat = fs.statSync(fullPath);
    let title = path.basename(relPath);
    if (/\.md$/i.test(relPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const heading = content.match(/^\s*#\s+(.+)$/m);
        if (heading) title = compactTeamReportText(heading[1], 80);
      } catch { /* best-effort title extraction */ }
    }
    return {
      size: stat.size,
      mtime: stat.mtime.toISOString().slice(0, 19).replace('T', ' '),
      title,
    };
  };
  const linked = (relPath: string): string => {
    if (/\.md$/i.test(relPath)) return `[[${AI_MEMORY_DIR}/${relPath.replace(/\.md$/i, '')}]]`;
    return `\`${AI_MEMORY_DIR}/${relPath}\``;
  };
  const totalSize = overview.syncedFiles.reduce((sum, relPath) => sum + fileMeta(relPath).size, 0);
  const lines: string[] = [];

  lines.push('---');
  lines.push('type: ars-ai-memory-index');
  lines.push(`date: ${JSON.stringify(date)}`);
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push(`aiMemoryDir: ${JSON.stringify(AI_MEMORY_DIR)}`);
  lines.push('tags:');
  lines.push('  - ai-memory');
  lines.push('  - production');
  lines.push('  - game-dev');
  lines.push('---');
  lines.push('');
  lines.push(`# AI 记忆与 Skill 同步索引 - ${date}`);
  lines.push('');
  lines.push('> 这是给团队和 AI 接管流程看的索引页。长期记忆、用户偏好、AI 行为设定、AI 自己提炼的 skill、crons 和 evolution 会作为可携带资产同步到其他电脑；临时会话和聊天历史不会同步。');
  lines.push('');
  lines.push('## 入口');
  lines.push(`- AI 交接简报：[[${TEAM_SCHEDULE_DIR}/ai-handoff|ai-handoff]]`);
  lines.push(`- 团队首页：[[${TEAM_SCHEDULE_DIR}/team-dashboard|team-dashboard]]`);
  lines.push(`- 今日工作包：[[${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${dateKey}|daily-workpack-${dateKey}]]`);
  lines.push(`- 决策日志：[[${TEAM_SCHEDULE_DIR}/decisions/${teamDecisionLogFileName(date).replace(/\.md$/i, '')}|${teamDecisionLogFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push('');
  lines.push('## 同步覆盖');
  lines.push('| 项目 | 状态 | 说明 |');
  lines.push('| --- | --- | --- |');
  lines.push(`| MEMORY.md | ${overview.coverage.memory ? '已纳入' : '缺失'} | 长期项目记忆、稳定事实、重要制作判断 |`);
  lines.push(`| USER.md | ${overview.coverage.user ? '已纳入' : '缺失'} | 用户偏好、沟通习惯、团队习惯 |`);
  lines.push(`| SOUL.md | ${overview.coverage.soul ? '已纳入' : '缺失'} | AI 行为设定、工作方式 |`);
  lines.push(`| crons.json | ${overview.coverage.crons ? '已纳入' : '未配置'} | AI 定时/周期性习惯 |`);
  lines.push(`| skills/*.md | ${overview.coverage.skills} 个 | AI 自己沉淀的可复用方法 |`);
  lines.push(`| evolution/*.evo.json | ${overview.coverage.evolutions} 个 | skill 进化记录 |`);
  lines.push(`| 总同步文件 | ${overview.syncedCount} 个 | ${formatTeamBytes(totalSize)} |`);
  lines.push('');
  lines.push('## 核心记忆文件');
  if (overview.coreFiles.length === 0 && overview.cronFiles.length === 0) {
    lines.push('- 暂无核心记忆文件。打开 AI 记忆面板初始化后会生成。');
  } else {
    lines.push('| 文件 | 标题 | 大小 | 修改时间 |');
    lines.push('| --- | --- | ---: | --- |');
    for (const relPath of [...overview.coreFiles, ...overview.cronFiles]) {
      const meta = fileMeta(relPath);
      lines.push([linked(relPath), meta.title, formatTeamBytes(meta.size), meta.mtime].map(teamMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  lines.push('## AI Skills');
  if (overview.skillFiles.length === 0) {
    lines.push('- 暂无 AI skill。AI 在反复执行某类任务后可以把方法沉淀到 `.ai-memory/skills/*.md`。');
  } else {
    lines.push('| Skill | 标题 | 大小 | 修改时间 |');
    lines.push('| --- | --- | ---: | --- |');
    for (const relPath of overview.skillFiles.slice(0, 80)) {
      const meta = fileMeta(relPath);
      lines.push([linked(relPath), meta.title, formatTeamBytes(meta.size), meta.mtime].map(teamMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
    if (overview.skillFiles.length > 80) lines.push(`- 还有 ${overview.skillFiles.length - 80} 个 skill 未在表格中展开。`);
  }
  lines.push('');
  lines.push('## Evolution 记录');
  if (overview.evolutionFiles.length === 0) {
    lines.push('- 暂无 evolution 记录。');
  } else {
    lines.push('| 文件 | 大小 | 修改时间 |');
    lines.push('| --- | ---: | --- |');
    for (const relPath of overview.evolutionFiles.slice(0, 80)) {
      const meta = fileMeta(relPath);
      lines.push([linked(relPath), formatTeamBytes(meta.size), meta.mtime].map(teamMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  lines.push('## 不同步的本地文件');
  for (const rule of overview.excludedRules) {
    lines.push(`- \`${AI_MEMORY_DIR}/${rule}\`：本地临时会话、历史或冲突快照，不作为团队长期资产同步。`);
  }
  lines.push('');
  lines.push('## 团队使用规则');
  lines.push('- [ ] 新的稳定项目事实、叙事设定、制作判断，写入 `.ai-memory/MEMORY.md`。');
  lines.push('- [ ] 用户或团队偏好，写入 `.ai-memory/USER.md`。');
  lines.push('- [ ] AI 行为方式、长期角色设定，写入 `.ai-memory/SOUL.md`。');
  lines.push('- [ ] 可以复用的工作方法、检查清单、提示流程，写入 `.ai-memory/skills/*.md`。');
  lines.push('- [ ] 只属于当前聊天窗口的过程，不要写进长期记忆。');
  lines.push('- [ ] 另一台电脑没有拿到 skill 时，先确认远端 Vault ID 一致，再执行 AI 记忆同步。');
  return lines.join('\n');
}

interface TeamLinkHealthNote {
  relativePath: string;
  fileName: string;
  title: string;
  wikiLinks: Array<{ target: string; line: number }>;
}

interface TeamResolvedWikiLink {
  source: string;
  target: string;
  line: number;
  status: 'resolved' | 'missing' | 'ambiguous';
  resolvedPath?: string;
  candidates: string[];
}

function collectTeamLinkHealthNotes(vaultPath: string, maxFiles = 2500): TeamLinkHealthNote[] {
  const root = path.resolve(vaultPath);
  const notes: TeamLinkHealthNote[] = [];
  const skipDirs = new Set([ARS_NOTE_DIR, '.ars-live', '.ars-backups', 'node_modules', '.git', 'dist', 'out', '.cache', '__pycache__']);
  const assetExt = /\.(png|jpe?g|gif|svg|webp|bmp|pdf|mp3|wav|ogg|mp4|mov|avi|zip|7z|rar)$/i;

  function parseLinks(content: string): Array<{ target: string; line: number }> {
    const links: Array<{ target: string; line: number }> = [];
    const lines = content.split(/\r?\n/);
    const wikiRegex = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g;
    let inCodeBlock = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.trimStart().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;
      const stripped = line.replace(/`[^`]*`/g, (match) => ' '.repeat(match.length));
      wikiRegex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = wikiRegex.exec(stripped)) !== null) {
        let target = normalizeTeamSchedulePath(match[1]);
        const hashIndex = target.indexOf('#');
        if (hashIndex >= 0) target = target.slice(0, hashIndex).trim();
        if (!target || assetExt.test(target)) continue;
        links.push({ target, line: i + 1 });
      }
    }
    return links;
  }

  function walk(dir: string): void {
    if (notes.length >= maxFiles) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (notes.length >= maxFiles) return;
      if (isConflictArtifactName(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.name !== TEAM_SCHEDULE_DIR && entry.name !== AI_MEMORY_DIR) continue;
        if (relativePath === `${AI_MEMORY_DIR}/history` || relativePath.startsWith(`${AI_MEMORY_DIR}/history/`)) continue;
        walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const h1 = content.match(/^\s*#\s+(.+)$/m);
        notes.push({
          relativePath,
          fileName: entry.name,
          title: h1 ? compactTeamReportText(h1[1], 100) : entry.name.replace(/\.md$/i, ''),
          wikiLinks: parseLinks(content),
        });
      } catch { /* skip unreadable note */ }
    }
  }

  walk(root);
  return notes.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-CN'));
}

function buildTeamLinkHealthPage(vaultPath: string, schedule: any, health: any, date = teamTodayString()): string {
  const notes = collectTeamLinkHealthNotes(vaultPath);
  const byRel = new Map<string, TeamLinkHealthNote>();
  const byBase = new Map<string, TeamLinkHealthNote[]>();
  const byTitle = new Map<string, TeamLinkHealthNote[]>();
  const put = (map: Map<string, TeamLinkHealthNote[]>, key: string, note: TeamLinkHealthNote): void => {
    const clean = key.trim().toLowerCase();
    if (!clean) return;
    map.set(clean, [...(map.get(clean) || []), note]);
  };

  for (const note of notes) {
    const relNoExt = normalizeTeamSchedulePath(note.relativePath).replace(/\.md$/i, '').toLowerCase();
    byRel.set(relNoExt, note);
    put(byBase, path.posix.basename(note.relativePath, '.md'), note);
    put(byTitle, note.title, note);
  }

  const resolveLink = (source: string, target: string, line: number): TeamResolvedWikiLink => {
    const clean = normalizeTeamSchedulePath(target).replace(/\.md$/i, '').toLowerCase();
    if (!clean) return { source, target, line, status: 'missing', candidates: [] };
    const exact = byRel.get(clean);
    if (exact) return { source, target, line, status: 'resolved', resolvedPath: exact.relativePath, candidates: [exact.relativePath] };
    const candidates = new Map<string, TeamLinkHealthNote>();
    for (const note of byBase.get(clean) || []) candidates.set(note.relativePath, note);
    for (const note of byTitle.get(clean) || []) candidates.set(note.relativePath, note);
    const list = Array.from(candidates.values());
    if (list.length === 1) return { source, target, line, status: 'resolved', resolvedPath: list[0].relativePath, candidates: [list[0].relativePath] };
    if (list.length > 1) return { source, target, line, status: 'ambiguous', candidates: list.map((note) => note.relativePath).slice(0, 8) };
    return { source, target, line, status: 'missing', candidates: [] };
  };

  const resolvedLinks = notes.flatMap((note) => note.wikiLinks.map((link) => resolveLink(note.relativePath, link.target, link.line)));
  const allBrokenLinks = resolvedLinks.filter((link) => link.status === 'missing');
  const allAmbiguousLinks = resolvedLinks.filter((link) => link.status === 'ambiguous');
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const link of resolvedLinks) {
    outgoing.set(link.source, (outgoing.get(link.source) || 0) + 1);
    if (link.status === 'resolved' && link.resolvedPath) incoming.set(link.resolvedPath, (incoming.get(link.resolvedPath) || 0) + 1);
  }

  const productionNotes = notes.filter((note) => (
    !note.relativePath.startsWith(`${TEAM_SCHEDULE_DIR}/`) &&
    !note.relativePath.startsWith(`${AI_MEMORY_DIR}/`) &&
    isTeamProductionDocPath(note.relativePath)
  ));
  const allOrphanDocs = productionNotes.filter((note) => !(incoming.get(note.relativePath) || 0) && !(outgoing.get(note.relativePath) || 0));
  const linkedDocSet = new Set((Array.isArray(schedule?.tasks) ? schedule.tasks : [])
    .map((task: any) => normalizeTeamSchedulePath(task?.linkedDoc).replace(/\.md$/i, '').toLowerCase())
    .filter(Boolean));
  const allUnmappedProductionDocs = productionNotes
    .filter((note) => !linkedDocSet.has(normalizeTeamSchedulePath(note.relativePath).replace(/\.md$/i, '').toLowerCase()));
  const documentPathSet = new Set<string>();
  for (const note of notes) {
    const lower = normalizeTeamSchedulePath(note.relativePath).toLowerCase();
    documentPathSet.add(lower);
    documentPathSet.add(lower.replace(/\.md$/i, ''));
  }
  const allMissingTaskDocs = (Array.isArray(schedule?.tasks) ? schedule.tasks : [])
    .filter((task: any) => normalizeTeamTaskStatus(task?.status) !== 'done' && teamTaskDocumentStatus(task, documentPathSet) !== 'linked');
  const dateKey = date.replace(/-/g, '');
  const linkToDoc = (relativePath: string): string => teamDocWikiLink(relativePath);
  const tableRow = (items: unknown[]): string => `| ${items.map(teamMarkdownCell).join(' | ')} |`;
  const lines: string[] = [];

  lines.push('---');
  lines.push('type: ars-team-link-health');
  lines.push(`date: ${JSON.stringify(date)}`);
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push('tags:');
  lines.push('  - link-health');
  lines.push('  - production');
  lines.push('  - game-dev');
  lines.push('---');
  lines.push('');
  lines.push(`# Ars-note 链接健康报告 - ${date}`);
  lines.push('');
  lines.push('> 自动检查 Vault 里的 [[wiki-link]]、任务文档映射和生产文档孤岛。目标是让团队文档真的连起来，让 AI 接管叙事和任务流时有可靠上下文。');
  lines.push('');
  lines.push('## 入口');
  lines.push(`- 团队首页：[[${TEAM_SCHEDULE_DIR}/team-dashboard|team-dashboard]]`);
  lines.push(`- AI 交接简报：[[${TEAM_SCHEDULE_DIR}/ai-handoff|ai-handoff]]`);
  lines.push(`- 今日工作包：[[${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${dateKey}|daily-workpack-${dateKey}]]`);
  lines.push(`- AI 记忆与 Skill 索引：[[${TEAM_SCHEDULE_DIR}/${teamAiMemoryIndexFileName().replace(/\.md$/i, '')}|${teamAiMemoryIndexFileName().replace(/\.md$/i, '')}]]`);
  lines.push(`- 决策日志：[[${TEAM_SCHEDULE_DIR}/decisions/${teamDecisionLogFileName(date).replace(/\.md$/i, '')}|${teamDecisionLogFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push('');
  lines.push('## 总览');
  lines.push('| 指标 | 数量 |');
  lines.push('| --- | ---: |');
  lines.push(`| Markdown 文档 | ${notes.length} |`);
  lines.push(`| Wiki-links | ${resolvedLinks.length} |`);
  lines.push(`| 断链 | ${allBrokenLinks.length} |`);
  lines.push(`| 歧义链接 | ${allAmbiguousLinks.length} |`);
  lines.push(`| 生产文档孤岛 | ${allOrphanDocs.length} |`);
  lines.push(`| 未映射到任务表的生产文档 | ${allUnmappedProductionDocs.length} |`);
  lines.push(`| 活跃任务缺任务文档 | ${allMissingTaskDocs.length} |`);
  lines.push(`| 健康扫描建议 | ${Array.isArray(health?.recommendations) ? health.recommendations.length : 0} |`);
  lines.push('');

  lines.push('## 断链 Wiki-links');
  if (allBrokenLinks.length === 0) {
    lines.push('- 暂无明显断链。');
  } else {
    lines.push('| 来源 | 行 | 目标 | 建议 |');
    lines.push('| --- | ---: | --- | --- |');
    for (const link of allBrokenLinks.slice(0, 120)) {
      lines.push(tableRow([linkToDoc(link.source), link.line, `[[${link.target}]]`, '确认文件名，或新建对应文档']));
    }
    if (allBrokenLinks.length > 120) lines.push(`- 还有 ${allBrokenLinks.length - 120} 条断链未展开。`);
  }
  lines.push('');

  lines.push('## 歧义 Wiki-links');
  if (allAmbiguousLinks.length === 0) {
    lines.push('- 暂无明显歧义链接。');
  } else {
    lines.push('| 来源 | 行 | 目标 | 可能指向 | 建议 |');
    lines.push('| --- | ---: | --- | --- | --- |');
    for (const link of allAmbiguousLinks.slice(0, 80)) {
      lines.push(tableRow([
        linkToDoc(link.source),
        link.line,
        `[[${link.target}]]`,
        link.candidates.map((item) => linkToDoc(item)).join('<br>'),
        '改成带路径的精确 wiki-link',
      ]));
    }
    if (allAmbiguousLinks.length > 80) lines.push(`- 还有 ${allAmbiguousLinks.length - 80} 条歧义链接未展开。`);
  }
  lines.push('');

  lines.push('## 生产文档孤岛');
  if (allOrphanDocs.length === 0) {
    lines.push('- 暂无明显孤岛生产文档。');
  } else {
    for (const note of allOrphanDocs.slice(0, 80)) {
      lines.push(`- ${linkToDoc(note.relativePath)}：没有入链，也没有出链。建议补上上游依据、下游任务或相关角色/任务链接。`);
    }
    if (allOrphanDocs.length > 80) lines.push(`- 还有 ${allOrphanDocs.length - 80} 个孤岛文档未展开。`);
  }
  lines.push('');

  lines.push('## 未映射到任务表的生产文档');
  if (allUnmappedProductionDocs.length === 0) {
    lines.push('- 识别到的生产文档都已映射到团队任务表。');
  } else {
    for (const note of allUnmappedProductionDocs.slice(0, 100)) {
      lines.push(`- [ ] ${linkToDoc(note.relativePath)} -> 如果需要执行，请补入 \`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}\` 或 NarrativeTaskTable。`);
    }
    if (allUnmappedProductionDocs.length > 100) lines.push(`- 还有 ${allUnmappedProductionDocs.length - 100} 个未映射生产文档未展开。`);
  }
  lines.push('');

  lines.push('## 活跃任务缺任务文档');
  if (allMissingTaskDocs.length === 0) {
    lines.push('- 活跃任务都有可解析的 linkedDoc。');
  } else {
    lines.push('| 负责人 | 状态 | 截止 | 任务 | linkedDoc | 建议 |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const task of allMissingTaskDocs.slice(0, 80)) {
      lines.push(tableRow([
        normalizeTeamScheduleText(task?.owner) || '未分配',
        normalizeTeamTaskStatus(task?.status),
        normalizeTeamScheduleDate(task?.dueDate) || '-',
        normalizeTeamScheduleText(task?.title) || '-',
        normalizeTeamSchedulePath(task?.linkedDoc) || '-',
        '生成任务文档或修正 linkedDoc',
      ]));
    }
    if (allMissingTaskDocs.length > 80) lines.push(`- 还有 ${allMissingTaskDocs.length - 80} 个缺任务文档的活跃任务未展开。`);
  }
  lines.push('');

  lines.push('## 修复规则');
  lines.push('- [ ] wiki-link 目标优先使用真实文件名，不要只写显示名。');
  lines.push('- [ ] 同名文件超过一个时，改用 `[[folder/FileName]]` 形式。');
  lines.push('- [ ] 世界观、剧情、任务、台词、演出、实现文档至少链接一个上游依据和一个下游执行项。');
  lines.push('- [ ] 新增生产文档后，确认它是否需要进入团队任务表、变更影响表或决策日志。');
  lines.push('- [ ] AI 生成新文档后必须调用 `generate_team_production_docs` 刷新本报告。');
  return lines.join('\n');
}

function buildTeamProductionHealthPage(vaultPath: string, schedule: any, health: any, date = teamTodayString()): string {
  const stats = health?.stats || summarizeTeamSchedule(schedule);
  const focus = health?.focus || {};
  const memberLoad = Array.isArray(health?.memberLoad) ? health.memberLoad : buildTeamMemberLoadRows(vaultPath, schedule, date);
  const recommendations = Array.isArray(health?.recommendations) ? health.recommendations : [];
  const activeTasks = (Array.isArray(schedule?.tasks) ? schedule.tasks : [])
    .filter((task: any) => normalizeTeamTaskStatus(task?.status) !== 'done');
  const missingAcceptance = activeTasks.filter((task: any) => !normalizeTeamScheduleText(task?.acceptance));
  const dateKey = date.replace(/-/g, '');
  const dangerScore =
    (stats.blocked || 0) * 3
    + (stats.overdue || 0) * 3
    + (stats.qaHigh || 0) * 3
    + (stats.memberLoadDanger || 0) * 3
    + (stats.missingOwner || 0) * 2
    + (stats.missingDueDate || 0)
    + (stats.missingDocs || 0)
    + Math.min(6, stats.narrativeMissingStages || 0);
  const healthLevel = dangerScore >= 12 ? '需立即处理' : dangerScore >= 5 ? '需关注' : '节奏正常';
  const healthAction = dangerScore >= 12
    ? '先处理阻塞、逾期、高严重 QA 和超载成员，再安排新工作。'
    : dangerScore >= 5
      ? '先把缺负责人、缺文档、缺截止日期和叙事链路补齐，再推进交付。'
      : '保持当前节奏，优先推进高优先级和 7 天内到期任务。';
  const taskSections: Array<{ label: string; reason: string; tasks: any[] }> = [
    { label: '阻塞', reason: '解除卡点', tasks: Array.isArray(focus.blocked) ? focus.blocked : [] },
    { label: '逾期', reason: '重新拆分或改期', tasks: Array.isArray(focus.overdue) ? focus.overdue : [] },
    { label: '7 天内到期', reason: '确认交付口径', tasks: Array.isArray(focus.dueSoon) ? focus.dueSoon : [] },
    { label: '缺负责人', reason: '指派 owner', tasks: Array.isArray(focus.missingOwner) ? focus.missingOwner : [] },
    { label: '缺截止日期', reason: '补 dueDate', tasks: Array.isArray(focus.missingDueDate) ? focus.missingDueDate : [] },
    { label: '缺任务文档', reason: '生成或修正 linkedDoc', tasks: Array.isArray(focus.missingDocs) ? focus.missingDocs : [] },
  ];
  const triageTasks = Array.from(new Map(taskSections.flatMap((section) => (
    section.tasks.map((task: any) => {
      const key = normalizeTeamScheduleText(task?.id) || teamTaskKey(task);
      return [key, { ...task, triageLabel: section.label, triageReason: section.reason }] as const;
    })
  ))).values()).slice(0, 40);
  const qaItems = Array.isArray(focus.qa) ? focus.qa : [];
  const narrativeGaps = focus.narrativeGaps || {};
  const missingStages = Array.isArray(narrativeGaps.missingStages) ? narrativeGaps.missingStages : [];
  const weakLinks = Array.isArray(narrativeGaps.weakLinks) ? narrativeGaps.weakLinks : [];
  const docsWithoutLinks = Array.isArray(narrativeGaps.docsWithoutNarrativeLinks) ? narrativeGaps.docsWithoutNarrativeLinks : [];
  const recentLogs = Array.isArray(health?.recentLogs) ? health.recentLogs : [];
  const tableRow = (items: unknown[]): string => `| ${items.map(teamMarkdownCell).join(' | ')} |`;
  const taskLink = (task: any): string => teamDocWikiLink(task?.linkedDoc);
  const lines: string[] = [];

  lines.push('---');
  lines.push('type: ars-team-production-health');
  lines.push(`date: ${JSON.stringify(date)}`);
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push(`scheduleUpdatedAt: ${JSON.stringify(schedule.updatedAt || '')}`);
  lines.push(`schedule: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`)}`);
  lines.push('tags:');
  lines.push('  - production-health');
  lines.push('  - team-production');
  lines.push('  - game-dev');
  lines.push('  - ai-takeover');
  lines.push('---');
  lines.push('');
  lines.push(`# 团队生产健康报告 - ${date}`);
  lines.push('');
  lines.push(`> 每天开工前先看这页。它把任务风险、成员负载、QA、叙事链路和工时记录合成一个“今天先处理什么”的判断页。源文件：\`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}\`。`);
  lines.push('');
  lines.push('## 入口');
  lines.push(`- Obsidian 控制台：[[${TEAM_SCHEDULE_DIR}/${teamObsidianCommandCenterFileName().replace(/\.md$/i, '')}|${teamObsidianCommandCenterFileName().replace(/\.md$/i, '')}]]`);
  lines.push(`- 团队首页：[[${TEAM_SCHEDULE_DIR}/team-dashboard|team-dashboard]]`);
  lines.push(`- 今日工作包：[[${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${dateKey}|daily-workpack-${dateKey}]]`);
  lines.push(`- 阻塞交接：[[${TEAM_SCHEDULE_DIR}/handoffs/blocker-handoff-${dateKey}|blocker-handoff-${dateKey}]]`);
  lines.push(`- 验收队列：[[${TEAM_SCHEDULE_DIR}/reviews/review-queue-${dateKey}|review-queue-${dateKey}]]`);
  lines.push(`- 今日工时表：[[${TEAM_SCHEDULE_DIR}/timesheets/timesheet-${dateKey}|timesheet-${dateKey}]]`);
  lines.push(`- 链接健康：[[${TEAM_SCHEDULE_DIR}/${teamLinkHealthFileName().replace(/\.md$/i, '')}|${teamLinkHealthFileName().replace(/\.md$/i, '')}]]`);
  lines.push(`- 叙事导演台：[[${TEAM_SCHEDULE_DIR}/narrative-director|narrative-director]]`);
  lines.push(`- AI 交接简报：[[${TEAM_SCHEDULE_DIR}/ai-handoff|ai-handoff]]`);
  lines.push('');
  lines.push('## 健康判断');
  lines.push(`- 当前状态：**${healthLevel}**。`);
  lines.push(`- 建议动作：${healthAction}`);
  lines.push(`- 风险分：${dangerScore}。分数越高，越应该先清风险再加新任务。`);
  lines.push('');
  lines.push('| 指标 | 数量 | 制作动作 |');
  lines.push('| --- | ---: | --- |');
  lines.push(tableRow(['总任务', stats.total || 0, '看活跃/完成比例']));
  lines.push(tableRow(['活跃任务', stats.active || 0, '拆到成员页和今日工作包']));
  lines.push(tableRow(['已完成', stats.done || 0, '确认验收记录']));
  lines.push(tableRow(['阻塞', stats.blocked || 0, '先看阻塞交接']));
  lines.push(tableRow(['逾期', stats.overdue || 0, '改期、拆分或降范围']));
  lines.push(tableRow(['7 天内到期', stats.dueSoon || 0, '锁交付口径']));
  lines.push(tableRow(['缺负责人', stats.missingOwner || 0, '指派 owner']));
  lines.push(tableRow(['缺截止日期', stats.missingDueDate || 0, '补 dueDate']));
  lines.push(tableRow(['缺任务文档', stats.missingDocs || 0, '生成 linkedDoc']));
  lines.push(tableRow(['缺验收标准', missingAcceptance.length, '补 acceptance']));
  lines.push(tableRow(['高严重 QA', stats.qaHigh || 0, '安排修复和复测']));
  lines.push(tableRow(['叙事缺阶段', stats.narrativeMissingStages || 0, '补世界观/剧情/任务/台词/演出/任务表链路']));
  lines.push(tableRow(['叙事弱链接', stats.narrativeWeakLinks || 0, '补 wiki-link 和下游任务']));
  lines.push(tableRow(['成员需处理', stats.memberLoadDanger || 0, '转派、拆分或先解阻塞']));
  lines.push(tableRow(['成员需关注', stats.memberLoadWarning || 0, '看是否需要缩范围']));
  lines.push(tableRow(['累计工时', formatTeamMinutes(stats.totalMinutes || 0), '对照预估和产出']));
  lines.push('');
  lines.push('## 制作人优先处理');
  if (recommendations.length === 0) {
    lines.push('- 暂无系统建议。');
  } else {
    for (const item of recommendations.slice(0, 12)) lines.push(`- ${compactTeamReportText(item, 220)}`);
  }
  lines.push('');
  lines.push('## 风险任务队列');
  if (triageTasks.length === 0) {
    lines.push('- 暂无需要优先处理的风险任务。');
  } else {
    lines.push('| 类型 | 负责人 | 状态 | 优先级 | 截止 | 任务 | 文档 | 处理动作 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const task of triageTasks) {
      lines.push(tableRow([
        task.triageLabel || '风险',
        normalizeTeamScheduleText(task.owner) || '未分配',
        normalizeTeamTaskStatus(task.status),
        normalizeTeamTaskPriority(task.priority),
        normalizeTeamScheduleDate(task.dueDate) || '-',
        compactTeamReportText(task.title, 90),
        taskLink(task),
        task.triageReason || teamWorkpackNextAction(task, vaultPath, date),
      ]));
    }
  }
  lines.push('');
  lines.push('## 成员负载');
  if (memberLoad.length === 0) {
    lines.push('- 暂无成员负载数据。');
  } else {
    lines.push('| 状态 | 成员 | 活跃 | 阻塞 | 逾期 | 今日工时 | 剩余预估 | 建议 |');
    lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |');
    for (const row of memberLoad.slice(0, 40)) {
      lines.push(tableRow([
        teamMemberLoadLabel(row.level),
        teamMemberPageLink(row.member),
        row.active || 0,
        row.blocked || 0,
        row.overdue || 0,
        formatTeamMinutes(row.todayMinutes || 0),
        formatTeamMinutes(row.remainingMinutes || 0),
        row.recommendation || '-',
      ]));
    }
  }
  lines.push('');
  lines.push('## QA / 试玩反馈');
  if (qaItems.length === 0) {
    lines.push('- 暂无未关闭 QA/Bug/试玩反馈项。');
  } else {
    lines.push('| 严重度 | 状态 | 来源 | 行 | 问题 | 建议 |');
    lines.push('| --- | --- | --- | ---: | --- | --- |');
    for (const item of qaItems.slice(0, 24)) {
      lines.push(tableRow([
        item.severity || '-',
        item.status || '-',
        teamDocWikiLink(item.relativePath),
        item.line || '-',
        compactTeamReportText(item.title || item.text, 120),
        item.suggestedAction || '建立修复/复测任务',
      ]));
    }
  }
  lines.push('');
  lines.push('## 叙事链路');
  if (missingStages.length === 0 && weakLinks.length === 0 && docsWithoutLinks.length === 0) {
    lines.push('- 世界观、剧情、任务、台词、演出和任务表暂未发现明显链路缺口。');
  } else {
    if (missingStages.length > 0) {
      lines.push('### 缺阶段');
      for (const item of missingStages) {
        lines.push(`- ${item.label || item.stage || '未命名阶段'}：${item.reason || '需要补齐核心文档和上下游链接。'}`);
      }
      lines.push('');
    }
    if (weakLinks.length > 0) {
      lines.push('### 弱链接');
      for (const item of weakLinks.slice(0, 18)) lines.push(`- ${compactTeamReportText(item, 220)}`);
      lines.push('');
    }
    if (docsWithoutLinks.length > 0) {
      lines.push('### 未串联文档');
      for (const item of docsWithoutLinks.slice(0, 18)) {
        lines.push(`- ${teamDocWikiLink(item.relativePath)}：补上上游依据、下游任务、owner 和验收口径。`);
      }
      lines.push('');
    }
  }
  lines.push('## 最近工时');
  if (recentLogs.length === 0) {
    lines.push('- 暂无近期工时记录。提醒成员在任务文档 `Work Log` 写 `- 45m | 做了什么`。');
  } else {
    for (const log of recentLogs.slice(0, 20)) {
      lines.push(`- ${normalizeTeamScheduleDate(log.date) || '-'} · ${normalizeTeamScheduleText(log.member) || '未分配'} · ${formatTeamMinutes(log.minutes || 0)} · ${teamDocWikiLink(log.linkedDoc)} · ${compactTeamReportText(log.taskTitle || '-', 80)}${log.note ? `：${compactTeamReportText(log.note, 140)}` : ''}`);
    }
  }
  lines.push('');
  lines.push('## AI 接管下一步');
  lines.push('- [ ] 先调用或点击“同步任务文档”，读取成员写在任务文档里的 Work Log / Review Log / blocker。');
  lines.push('- [ ] 按本页“风险任务队列”处理阻塞、逾期、缺负责人、缺日期、缺任务文档。');
  lines.push('- [ ] QA 项必须进入修复任务或复测队列，不要停留在零散文档里。');
  lines.push('- [ ] 叙事缺口先写入 NarrativePipeline / NarrativeTaskTable，再拆成团队任务。');
  lines.push('- [ ] 如果今天形成新的制作规则，把长期判断写入 `.ai-memory/MEMORY.md`，可复用方法写入 `.ai-memory/skills/*.md`，它们会跟随 Vault 同步。');
  lines.push('- [ ] 最后运行 `generate_team_production_docs` 或点击“一键生产刷新”，让另一台电脑和其他成员看到最新状态。');

  return lines.join('\n');
}

function buildTeamDependencyMapPage(schedule: any, health: any, date = teamTodayString()): string {
  const activeTasks = teamReportTaskSort((schedule.tasks || []).filter((task: any) => normalizeTeamTaskStatus(task.status) !== 'done'));
  const graphTasks = teamReportTaskSort(Array.from(new Map([
    ...activeTasks.filter((task: any) => normalizeTeamTaskStatus(task.status) === 'blocked'),
    ...activeTasks.filter((task: any) => normalizeTeamScheduleDate(task.dueDate) && normalizeTeamScheduleDate(task.dueDate) < date),
    ...activeTasks.filter((task: any) => normalizeTeamScheduleText(task.dependency) || normalizeTeamScheduleText(task.blocker)),
    ...activeTasks.filter((task: any) => normalizeTeamTaskPriority(task.priority) === 'high'),
    ...activeTasks,
  ].map((task: any) => [normalizeTeamScheduleText(task.id) || teamTaskKey(task), task] as const)).values()).slice(0, 28));
  const nodeIds = new Map(graphTasks.map((task: any, index: number) => [normalizeTeamScheduleText(task.id) || teamTaskKey(task), `T${index + 1}`] as const));
  const externalDeps: Array<{ id: string; label: string; targetId: string }> = [];
  const edges: Array<{ from: string; to: string; label: string }> = [];

  for (const task of graphTasks) {
    if (!normalizeTeamScheduleText(task.dependency) && !normalizeTeamScheduleText(task.blocker)) continue;
    const targetId = nodeIds.get(normalizeTeamScheduleText(task.id) || teamTaskKey(task));
    if (!targetId) continue;
    const matches = findTeamDependencyMatches(task, schedule.tasks || []);
    if (matches.length > 0) {
      for (const match of matches) {
        const from = nodeIds.get(normalizeTeamScheduleText(match.id) || teamTaskKey(match));
        if (from) edges.push({ from, to: targetId, label: normalizeTeamScheduleText(task.blocker) ? '阻塞' : '依赖' });
      }
    } else {
      externalDeps.push({
        id: `D${externalDeps.length + 1}`,
        label: compactTeamReportText([task.dependency, task.blocker].filter(Boolean).join(' / '), 80) || '外部依赖待确认',
        targetId,
      });
    }
  }

  const lines: string[] = [];
  lines.push('---');
  lines.push('type: ars-team-dependency-map');
  lines.push(`date: ${JSON.stringify(date)}`);
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push(`scheduleUpdatedAt: ${JSON.stringify(schedule.updatedAt || '')}`);
  lines.push('---');
  lines.push('');
  lines.push('# 团队任务依赖与交接地图');
  lines.push('');
  lines.push(`> 自动从 \`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}\` 生成。用于看清谁被谁卡住、哪些前置交付需要先处理。`);
  lines.push('');
  lines.push('## 风险概览');
  lines.push('| 指标 | 数量 |');
  lines.push('| --- | ---: |');
  lines.push(`| 活跃任务 | ${activeTasks.length} |`);
  lines.push(`| 阻塞任务 | ${health?.stats?.blocked || 0} |`);
  lines.push(`| 逾期任务 | ${health?.stats?.overdue || 0} |`);
  lines.push(`| 缺关联文档 | ${health?.stats?.missingDocs || 0} |`);
  lines.push(`| 未关闭 QA/Bug/试玩反馈 | ${health?.stats?.qaOpen || 0} |`);
  lines.push('');

  lines.push('## Mermaid 依赖图');
  if (graphTasks.length === 0) {
    lines.push('- 暂无活跃任务。');
  } else {
    lines.push('```mermaid');
    lines.push('flowchart LR');
    for (const task of graphTasks) {
      const key = normalizeTeamScheduleText(task.id) || teamTaskKey(task);
      const id = nodeIds.get(key);
      const meta = [normalizeTeamScheduleText(task.owner) || '未分配', normalizeTeamTaskStatus(task.status), normalizeTeamScheduleDate(task.dueDate) || '无截止'].join(' · ');
      lines.push(`  ${id}["${mermaidTeamLabel(task.title)}<br/>${mermaidTeamLabel(meta, 58)}"]`);
    }
    for (const dep of externalDeps) {
      lines.push(`  ${dep.id}(["${mermaidTeamLabel(dep.label, 52)}"])`);
      lines.push(`  ${dep.id} -->|外部依赖| ${dep.targetId}`);
    }
    for (const edge of edges) lines.push(`  ${edge.from} -->|${edge.label}| ${edge.to}`);
    const blockedIds = graphTasks
      .filter((task: any) => normalizeTeamTaskStatus(task.status) === 'blocked')
      .map((task: any) => nodeIds.get(normalizeTeamScheduleText(task.id) || teamTaskKey(task)))
      .filter(Boolean);
    const overdueIds = graphTasks
      .filter((task: any) => {
        const due = normalizeTeamScheduleDate(task.dueDate);
        return due && due < date;
      })
      .map((task: any) => nodeIds.get(normalizeTeamScheduleText(task.id) || teamTaskKey(task)))
      .filter(Boolean);
    lines.push('  classDef blocked fill:#7f1d1d,stroke:#fca5a5,color:#fff');
    lines.push('  classDef overdue fill:#78350f,stroke:#fbbf24,color:#fff');
    if (blockedIds.length > 0) lines.push(`  class ${blockedIds.join(',')} blocked`);
    if (overdueIds.length > 0) lines.push(`  class ${overdueIds.join(',')} overdue`);
    lines.push('```');
  }
  lines.push('');

  lines.push('## 交接队列');
  const handoffTasks = activeTasks.filter((task: any) => normalizeTeamScheduleText(task.dependency) || normalizeTeamScheduleText(task.blocker));
  if (handoffTasks.length === 0) {
    lines.push('- 暂无明确依赖或阻塞说明。');
  } else {
    lines.push('| 状态 | 优先级 | 负责人 | 任务 | 等待/依赖 | 文档 | 下一步 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const task of handoffTasks.slice(0, 40)) {
      const matches = findTeamDependencyMatches(task, schedule.tasks || []);
      const waitingFor = matches.length > 0
        ? matches.map((item: any) => `${normalizeTeamScheduleText(item.title)}${normalizeTeamScheduleText(item.owner) ? `（${normalizeTeamScheduleText(item.owner)}）` : ''}`).join('<br>')
        : compactTeamReportText([task.dependency, task.blocker].filter(Boolean).join('；'), 180);
      const nextStep = normalizeTeamTaskStatus(task.status) === 'blocked'
        ? '制作人确认解阻人、日期和替代方案'
        : matches.length > 0
          ? '找前置任务负责人确认交付时间'
          : '把依赖拆成具体任务或补充责任人';
      lines.push([
        normalizeTeamTaskStatus(task.status),
        normalizeTeamTaskPriority(task.priority),
        normalizeTeamScheduleText(task.owner) || '未分配',
        teamMarkdownCell(task.title),
        teamMarkdownCell(waitingFor || '待确认'),
        teamMarkdownCell(teamDocWikiLink(task.linkedDoc)),
        teamMarkdownCell(nextStep),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }

  return lines.join('\n');
}

function buildTeamBlockerHandoffPage(vaultPath: string, schedule: any, health: any, date = teamTodayString()): string {
  const activeTasks = teamReportTaskSort((schedule.tasks || []).filter((task: any) => normalizeTeamTaskStatus(task.status) !== 'done'));
  const blockedTasks = activeTasks.filter((task: any) => normalizeTeamTaskStatus(task.status) === 'blocked' || normalizeTeamScheduleText(task.blocker));
  const overdueTasks = activeTasks.filter((task: any) => {
    const due = normalizeTeamScheduleDate(task.dueDate);
    return due && due < date;
  });
  const dependencyTasks = activeTasks.filter((task: any) => normalizeTeamScheduleText(task.dependency) || normalizeTeamScheduleText(task.blocker));
  const handoffTasks = teamReportTaskSort(Array.from(new Map([
    ...blockedTasks,
    ...overdueTasks,
    ...dependencyTasks,
    ...(((health?.focus?.dueSoon || []) as any[]).map((task: any) => ({ ...task, id: normalizeTeamScheduleText(task.id) || teamTaskKey(task) }))),
  ].map((task: any) => [normalizeTeamScheduleText(task.id) || teamTaskKey(task), task] as const)).values())).slice(0, 40);
  const dateKey = date.replace(/-/g, '');
  const lines: string[] = [];

  lines.push('---');
  lines.push('type: ars-team-blocker-handoff');
  lines.push(`date: ${JSON.stringify(date)}`);
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push(`scheduleUpdatedAt: ${JSON.stringify(schedule.updatedAt || '')}`);
  lines.push('tags:');
  lines.push('  - team-handoff');
  lines.push('  - blocker-review');
  lines.push('  - production');
  lines.push('---');
  lines.push('');
  lines.push(`# 阻塞交接清单 - ${date}`);
  lines.push('');
  lines.push(`> 自动从 \`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}\` 和制作健康扫描生成。用途：制作人开会前 10 分钟先看，明确“谁卡住、等谁、今天怎么解”。`);
  lines.push('');
  lines.push('## 入口');
  lines.push(`- 今日工作包：[[${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${dateKey}|daily-workpack-${dateKey}]]`);
  lines.push(`- 依赖图：[[${TEAM_SCHEDULE_DIR}/dependency-map|dependency-map]]`);
  lines.push(`- 里程碑路线图：[[${TEAM_SCHEDULE_DIR}/roadmaps/${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}|${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 变更影响表：[[${TEAM_SCHEDULE_DIR}/changes/${teamChangeImpactFileName(date).replace(/\.md$/i, '')}|${teamChangeImpactFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- AI 交接简报：[[${TEAM_SCHEDULE_DIR}/ai-handoff|ai-handoff]]`);
  lines.push(`- 团队首页：[[${TEAM_SCHEDULE_DIR}/team-dashboard|team-dashboard]]`);
  lines.push('');
  lines.push('## 今日解阻概览');
  lines.push('| 指标 | 数量 |');
  lines.push('| --- | ---: |');
  lines.push(`| 阻塞任务 | ${blockedTasks.length} |`);
  lines.push(`| 逾期任务 | ${overdueTasks.length} |`);
  lines.push(`| 有依赖/交接说明 | ${dependencyTasks.length} |`);
  lines.push(`| 今日需确认交接 | ${handoffTasks.length} |`);
  lines.push(`| QA/Bug/试玩反馈 | ${health?.stats?.qaOpen || 0} |`);
  lines.push('');
  lines.push('## 交接执行表');
  if (handoffTasks.length === 0) {
    lines.push('- 暂无需要交接的阻塞或依赖任务。');
  } else {
    lines.push('| 确认 | 优先级 | 状态 | 卡住任务 | 当前负责人 | 等待谁/前置项 | 交接内容 | 文档 | 今天动作 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const task of handoffTasks) {
      const matches = findTeamDependencyMatches(task, schedule.tasks || []);
      const waitingFor = matches.length > 0
        ? matches.map((item: any) => `${normalizeTeamScheduleText(item.title)}${normalizeTeamScheduleText(item.owner) ? `（${normalizeTeamScheduleText(item.owner)}）` : ''}`).join('<br>')
        : compactTeamReportText([task.dependency, task.blocker].filter(Boolean).join('；'), 180) || '制作人确认';
      const handoffText = compactTeamReportText(task.blocker || task.dependency || task.deliverable || task.notes || '补充交接说明', 180);
      const due = normalizeTeamScheduleDate(task.dueDate);
      const todayAction = normalizeTeamTaskStatus(task.status) === 'blocked' || normalizeTeamScheduleText(task.blocker)
        ? '约定解阻人、解阻时间和替代方案'
        : due && due < date
          ? '重新拆分范围或确认今天最小交付'
          : matches.length > 0
            ? '找前置任务负责人确认交付时间'
            : '把模糊依赖拆成具体任务';
      const linkedDoc = normalizeTeamSchedulePath(task.linkedDoc);
      const docText = `${teamDocWikiLink(linkedDoc)}${linkedDoc && !linkedTeamDocExists(vaultPath, linkedDoc) ? '（缺失）' : !linkedDoc ? '（未指定）' : ''}`;
      lines.push([
        '- [ ]',
        normalizeTeamTaskPriority(task.priority),
        normalizeTeamTaskStatus(task.status),
        teamMarkdownCell(task.title),
        normalizeTeamScheduleText(task.owner) || '未分配',
        teamMarkdownCell(waitingFor),
        teamMarkdownCell(handoffText),
        teamMarkdownCell(docText),
        teamMarkdownCell(todayAction),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  lines.push('## 会前提问');
  lines.push('- [ ] 每个阻塞是否有明确“解阻人”，不是只写一个原因。');
  lines.push('- [ ] 等待的前置交付是否已经变成可追踪任务或文档。');
  lines.push('- [ ] 逾期任务是否拆出今天可以完成的最小交付。');
  lines.push('- [ ] 缺文档的任务是否先生成任务文档，避免成员找不到入口。');
  lines.push('');
  lines.push('## 收工确认');
  lines.push('- [ ] 已解阻的任务改回进行中/待检查，并记录今天处理结果。');
  lines.push('- [ ] 仍卡住的任务补充 blocker / dependency / owner / dueDate。');
  lines.push('- [ ] 需要转派的任务已在时间表里改负责人，并同步成员任务页。');

  return lines.join('\n');
}

function buildTeamReviewQueuePage(vaultPath: string, schedule: any, health: any, date = teamTodayString()): string {
  const tasks = Array.isArray(schedule.tasks) ? schedule.tasks : [];
  const activeTasks = teamReportTaskSort(tasks.filter((task: any) => normalizeTeamTaskStatus(task.status) !== 'done'));
  const reviewTasks = activeTasks.filter((task: any) => normalizeTeamTaskStatus(task.status) === 'review');
  const missingAcceptance = activeTasks.filter((task: any) => !normalizeTeamScheduleText(task.acceptance));
  const dueToday = activeTasks.filter((task: any) => normalizeTeamScheduleDate(task.dueDate) === date);
  const overdue = activeTasks.filter((task: any) => {
    const due = normalizeTeamScheduleDate(task.dueDate);
    return due && due < date;
  });
  const highRisk = activeTasks.filter((task: any) => normalizeTeamTaskPriority(task.priority) === 'high' && (normalizeTeamTaskStatus(task.status) === 'doing' || teamDueWithinDays(task.dueDate, 3, date)));
  const doneToday = teamReportTaskSort(tasks.filter((task: any) => (
    normalizeTeamTaskStatus(task.status) === 'done'
    && (String(task.updatedAt || '').slice(0, 10) === date
      || (Array.isArray(task.logs) ? task.logs : []).some((log: any) => normalizeTeamScheduleDate(log.date) === date)
      || (Array.isArray(task.reviewLogs) ? task.reviewLogs : []).some((log: any) => normalizeTeamScheduleDate(log.date) === date))
  )));
  const qaItems = Array.isArray(health?.focus?.qa) ? health.focus.qa : [];
  const queueTasks = teamReportTaskSort(Array.from(new Map([
    ...reviewTasks,
    ...doneToday,
    ...dueToday,
    ...overdue,
    ...missingAcceptance,
    ...highRisk,
  ].map((task: any) => [normalizeTeamScheduleText(task.id) || teamTaskKey(task), task] as const)).values())).slice(0, 60);
  const dateKey = date.replace(/-/g, '');
  const reviewKind = (task: any) => {
    if (!normalizeTeamScheduleText(task.acceptance)) return '缺验收';
    if (normalizeTeamTaskStatus(task.status) === 'review') return '待验收';
    if (normalizeTeamTaskStatus(task.status) === 'done') return '完成抽查';
    const due = normalizeTeamScheduleDate(task.dueDate);
    if (due && due < date) return '逾期复查';
    if (due === date) return '今日验收';
    if (normalizeTeamTaskPriority(task.priority) === 'high') return '高风险检查';
    return '常规复查';
  };
  const reviewAction = (task: any) => {
    const linkedDoc = normalizeTeamSchedulePath(task.linkedDoc);
    if (!normalizeTeamScheduleText(task.acceptance)) return '先补齐验收标准，再进入验收';
    if (!linkedDoc || !linkedTeamDocExists(vaultPath, linkedDoc)) return '先修复或生成任务文档，保留验收入口';
    if (normalizeTeamTaskStatus(task.status) === 'review') return '按验收标准检查：通过则完成，不通过退回进行中并写原因';
    if (normalizeTeamTaskStatus(task.status) === 'done') return '抽查交付物、截图/录屏/实现记录，确认没有回归风险';
    const due = normalizeTeamScheduleDate(task.dueDate);
    if (due && due < date) return '确认延期原因、最小可交付范围和复测路径';
    if (due === date) return '今天收尾验收，并记录验收结果';
    return '检查交付物、依赖和验收口径是否足够明确';
  };
  const lines: string[] = [];

  lines.push('---');
  lines.push('type: ars-team-review-queue');
  lines.push(`date: ${JSON.stringify(date)}`);
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push(`scheduleUpdatedAt: ${JSON.stringify(schedule.updatedAt || '')}`);
  lines.push('tags:');
  lines.push('  - team-review');
  lines.push('  - qa');
  lines.push('  - production');
  lines.push('---');
  lines.push('');
  lines.push(`# 验收复查队列 - ${date}`);
  lines.push('');
  lines.push(`> 自动从 \`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}\` 和制作健康扫描生成。用途：每天收工前看一次，确认“哪些能算完成、哪些要退回、哪些缺验收口径”。`);
  lines.push('');
  lines.push('## 入口');
  lines.push(`- 今日工作包：[[${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${dateKey}|daily-workpack-${dateKey}]]`);
  lines.push(`- 阻塞交接清单：[[${TEAM_SCHEDULE_DIR}/handoffs/blocker-handoff-${dateKey}|blocker-handoff-${dateKey}]]`);
  lines.push(`- 里程碑路线图：[[${TEAM_SCHEDULE_DIR}/roadmaps/${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}|${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 变更影响表：[[${TEAM_SCHEDULE_DIR}/changes/${teamChangeImpactFileName(date).replace(/\.md$/i, '')}|${teamChangeImpactFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- AI 交接简报：[[${TEAM_SCHEDULE_DIR}/ai-handoff|ai-handoff]]`);
  lines.push(`- 团队首页：[[${TEAM_SCHEDULE_DIR}/team-dashboard|team-dashboard]]`);
  lines.push('');
  lines.push('## 今日验收概览');
  lines.push('| 指标 | 数量 |');
  lines.push('| --- | ---: |');
  lines.push(`| 待验收 | ${reviewTasks.length} |`);
  lines.push(`| 今日完成抽查 | ${doneToday.length} |`);
  lines.push(`| 今天到期 | ${dueToday.length} |`);
  lines.push(`| 逾期需复查 | ${overdue.length} |`);
  lines.push(`| 缺验收标准 | ${missingAcceptance.length} |`);
  lines.push(`| QA/Bug/试玩反馈 | ${qaItems.length} |`);
  lines.push('');
  lines.push('## 验收执行表');
  if (queueTasks.length === 0) {
    lines.push('- 暂无需要验收或复查的任务。');
  } else {
    lines.push('| 确认 | 类型 | 优先级 | 负责人 | 任务 | 文档 | 验收标准 | 最近结论 | 复查动作 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const task of queueTasks) {
      const linkedDoc = normalizeTeamSchedulePath(task.linkedDoc);
      const docText = `${teamDocWikiLink(linkedDoc)}${linkedDoc && !linkedTeamDocExists(vaultPath, linkedDoc) ? '（缺失）' : !linkedDoc ? '（未指定）' : ''}`;
      const latestReview = latestTeamReviewLog(task);
      lines.push([
        '- [ ]',
        reviewKind(task),
        normalizeTeamTaskPriority(task.priority),
        normalizeTeamScheduleText(task.owner) || '未分配',
        teamMarkdownCell(task.title),
        teamMarkdownCell(docText),
        teamMarkdownCell(compactTeamReportText(task.acceptance || '缺验收标准', 180)),
        teamMarkdownCell(latestReview ? teamReviewLogSummary(latestReview) : '-'),
        teamMarkdownCell(reviewAction(task)),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  lines.push('## QA / Bug / 试玩复测');
  if (qaItems.length === 0) {
    lines.push('- 暂无未关闭 QA/Bug/试玩反馈。');
  } else {
    for (const item of qaItems.slice(0, 12)) {
      lines.push(`- [ ] [${item.severity || item.priority || 'medium'}] ${compactTeamReportText(item.title || item.text || 'QA item', 150)}（${item.relativePath ? teamDocWikiLink(item.relativePath) : '-'}）`);
      if (item.repro) lines.push(`  - 复现：${compactTeamReportText(item.repro, 180)}`);
    }
  }
  lines.push('');
  lines.push('## 验收口径');
  lines.push('- [ ] 交付物和任务描述一致，不只是“做了一部分”。');
  lines.push('- [ ] 关联文档、截图/录屏、实现路径或资源路径可以追溯。');
  lines.push('- [ ] QA/Bug/试玩反馈有复测结果，失败项退回任务表。');
  lines.push('- [ ] 通过验收的任务记录工时和验收结论，再改为完成。');
  lines.push('');
  lines.push('## 退回规则');
  lines.push('- 缺文档、缺验收、缺负责人或无法复现的任务不要标完成。');
  lines.push('- 发现范围变大时拆新任务，不把大坑藏在一个“已完成”里。');
  lines.push('- 影响剧情、台词、演出、任务表的变更要同步对应文档和团队时间表。');

  return lines.join('\n');
}

function buildTeamNarrativeDirectorPage(vaultPath: string, schedule: any, health: any, date = teamTodayString()): string {
  const narrative = health?.narrative || scanNarrativeProductionChain(vaultPath, 16);
  const focus = health?.focus || {};
  const activeTasks = teamReportTaskSort((schedule.tasks || []).filter((task: any) => normalizeTeamTaskStatus(task.status) !== 'done'));
  const narrativePattern = /(narrative|story|plot|quest|dialogue|performance|cutscene|cinematic|world|lore|worldbuilding|tasktable|剧情|叙事|世界观|任务|台词|对白|演出|过场|分镜|任务表)/i;
  const narrativeTasks = teamReportTaskSort(activeTasks.filter((task: any) => narrativePattern.test([
    task.title,
    task.linkedDoc,
    task.deliverable,
    task.dependency,
    task.blocker,
    task.acceptance,
    task.notes,
  ].map((item) => normalizeTeamScheduleText(item)).join('\n')))).slice(0, 36);
  const missingStages = Array.isArray(narrative?.missingStages) ? narrative.missingStages : [];
  const weakLinks = Array.isArray(narrative?.weakLinks) ? narrative.weakLinks : [];
  const docsWithoutLinks = Array.isArray(narrative?.docsWithoutNarrativeLinks) ? narrative.docsWithoutNarrativeLinks : [];
  const recentDocs = Array.isArray(narrative?.recentDocs) ? narrative.recentDocs : [];
  const qaItems = Array.isArray(focus?.qa) ? focus.qa : [];
  const dateKey = date.replace(/-/g, '');
  const stageOrder: ProductionNarrativeStage[] = ['worldbuilding', 'story', 'quest', 'dialogue', 'performance', 'taskTable'];
  const stageAction: Record<ProductionNarrativeStage, string> = {
    worldbuilding: '补硬规则、禁忌、代价、地点/派系约束，让剧情和任务有边界',
    story: '补主线/章节/情绪曲线，把世界规则落成冲突和转折',
    quest: '把剧情节拍拆成可玩的任务目标、触发条件、奖励和状态变化',
    dialogue: '补角色意图、分支台词、条件、任务状态迁移和本地化备注',
    performance: '补镜头、走位、动画、VFX/SFX、跳过/中断和验收口径',
    taskTable: '把上游叙事产物拆成 owner、优先级、依赖、验收和复测任务',
  };

  const lines: string[] = [];
  lines.push('---');
  lines.push('type: ars-team-narrative-director');
  lines.push(`date: ${JSON.stringify(date)}`);
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push(`scheduleUpdatedAt: ${JSON.stringify(schedule.updatedAt || '')}`);
  lines.push('tags:');
  lines.push('  - narrative-director');
  lines.push('  - production');
  lines.push('  - game-dev');
  lines.push('---');
  lines.push('');
  lines.push(`# 叙事导演台 - ${date}`);
  lines.push('');
  lines.push(`> 自动从 \`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}\`、制作健康扫描和叙事链路扫描生成。用途：让 AI 或制作人接管“世界观 -> 剧情 -> 任务 -> 台词 -> 演出 -> 任务表 -> QA”的每日推进。`);
  lines.push('');
  lines.push('## 入口');
  lines.push(`- 今日工作包：[[${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${dateKey}|daily-workpack-${dateKey}]]`);
  lines.push(`- AI 接管计划：[[${TEAM_SCHEDULE_DIR}/plans/${teamAITakeoverPlanFileName(date).replace(/\.md$/i, '')}|${teamAITakeoverPlanFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- AI 交接简报：[[${TEAM_SCHEDULE_DIR}/ai-handoff|ai-handoff]]`);
  lines.push(`- 里程碑路线图：[[${TEAM_SCHEDULE_DIR}/roadmaps/${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}|${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 周计划：[[${TEAM_SCHEDULE_DIR}/sprints/${teamSprintPlanFileName(date).replace(/\.md$/i, '')}|${teamSprintPlanFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 阻塞交接清单：[[${TEAM_SCHEDULE_DIR}/handoffs/blocker-handoff-${dateKey}|blocker-handoff-${dateKey}]]`);
  lines.push(`- 验收复查队列：[[${TEAM_SCHEDULE_DIR}/reviews/review-queue-${dateKey}|review-queue-${dateKey}]]`);
  lines.push(`- 变更影响表：[[${TEAM_SCHEDULE_DIR}/changes/${teamChangeImpactFileName(date).replace(/\.md$/i, '')}|${teamChangeImpactFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 团队首页：[[${TEAM_SCHEDULE_DIR}/team-dashboard|team-dashboard]]`);
  lines.push(`- 依赖图：[[${TEAM_SCHEDULE_DIR}/dependency-map|dependency-map]]`);
  lines.push('');

  lines.push('## 叙事链路状态');
  lines.push('| 阶段 | 文档数 | 状态 | 今天动作 |');
  lines.push('| --- | ---: | --- | --- |');
  for (const stage of stageOrder) {
    const count = Number(narrative?.[stage] || 0);
    const missing = missingStages.some((item: any) => item.stage === stage);
    lines.push([
      PRODUCTION_NARRATIVE_STAGE_LABELS[stage],
      String(count),
      missing ? '缺口' : count > 0 ? '已有' : '待确认',
      stageAction[stage],
    ].map(teamMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  lines.push('');
  lines.push(`- 已扫描文档：${narrative?.scannedDocs || 0}；NarrativePipeline：${narrative?.pipeline || 0}；弱链接：${weakLinks.length}；缺阶段：${missingStages.length}。`);
  lines.push('');

  lines.push('## AI 接管顺序');
  lines.push('- [ ] 先读 `read_production_health`，确认叙事缺阶段、弱链接、QA/Bug/试玩反馈和成员负载。');
  lines.push('- [ ] 检查或创建 `02_Worldbuilding/NarrativePipeline.md`，把世界规则、剧情节拍、任务、台词、演出和任务表串起来。');
  lines.push('- [ ] 检查或创建 `07_Unity_Tasks/NarrativeTaskTable.md`，把每个叙事缺口拆成 owner / priority / dependency / linkedDoc / acceptance。');
  lines.push('- [ ] 用 `upsert_team_tasks` 把具体执行项写入团队时间表，避免只留下长文档没有负责人。');
  lines.push('- [ ] 最后调用 `generate_team_production_docs` 刷新本导演台、工作包、周计划、里程碑路线图、变更影响表、阻塞交接、验收队列、依赖图、成员任务页和团队首页。');
  lines.push('');

  lines.push('## 缺口与弱链接');
  if (missingStages.length === 0 && weakLinks.length === 0 && docsWithoutLinks.length === 0) {
    lines.push('- 暂无明显叙事链路缺口。继续保持文档之间的 [[wiki-link]] 和任务表映射。');
  } else {
    for (const stage of missingStages) lines.push(`- 缺阶段：${stage.label || stage.stage}，动作：${stageAction[stage.stage as ProductionNarrativeStage] || '补齐核心文档和任务映射'}`);
    for (const link of weakLinks.slice(0, 12)) lines.push(`- 弱链接：${link}`);
    for (const doc of docsWithoutLinks.slice(0, 10)) {
      lines.push(`- 未串联文档：${doc.label || doc.type} / ${teamDocWikiLink(doc.relativePath)} / ${teamMarkdownCell(doc.title || '-')}`);
    }
  }
  lines.push('');

  lines.push('## 叙事相关任务队列');
  if (narrativeTasks.length === 0) {
    lines.push('- 当前团队时间表里没有识别到明显叙事相关任务。AI 接管时应先从缺口生成 NarrativePipeline 和 NarrativeTaskTable，再导入任务。');
  } else {
    lines.push('| 标记 | 负责人 | 状态 | 截止 | 任务 | 文档 | 下一步 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const task of narrativeTasks) {
      lines.push([
        teamWorkpackTaskFlags(task, date),
        normalizeTeamScheduleText(task.owner) || '未分配',
        normalizeTeamTaskStatus(task.status),
        normalizeTeamScheduleDate(task.dueDate) || '-',
        normalizeTeamScheduleText(task.title),
        teamDocWikiLink(task.linkedDoc),
        teamWorkpackNextAction(task, vaultPath, date),
      ].map(teamMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');

  lines.push('## 叙事文档入口');
  if (recentDocs.length === 0) {
    lines.push('- 暂未扫描到世界观/剧情/任务/台词/演出/任务表文档。');
  } else {
    lines.push('| 阶段 | 文档 | 状态 | 负责人 | 链接数 |');
    lines.push('| --- | --- | --- | --- | ---: |');
    for (const doc of recentDocs.slice(0, 30)) {
      lines.push([
        doc.label || doc.type || '-',
        `${teamDocWikiLink(doc.relativePath)}${doc.title ? ` (${teamMarkdownCell(doc.title)})` : ''}`,
        doc.status || '-',
        doc.owner || '-',
        String(doc.narrativeLinkCount || doc.linkCount || 0),
      ].map(teamMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');

  lines.push('## QA / 试玩反馈对叙事的影响');
  if (qaItems.length === 0) {
    lines.push('- 暂无未关闭 QA/Bug/试玩反馈。');
  } else {
    for (const item of qaItems.slice(0, 10)) {
      lines.push(`- [ ] [${item.severity || item.priority || 'medium'}] ${compactTeamReportText(item.title || item.text || 'QA item', 150)}：${item.relativePath ? teamDocWikiLink(item.relativePath) : '-'}`);
      if (item.details) lines.push(`  - 影响：${compactTeamReportText(item.details, 180)}`);
    }
  }
  lines.push('');

  lines.push('## 收工复查');
  lines.push('- [ ] 今天新增或修改的世界观是否影响已有剧情/任务/台词/演出？');
  lines.push('- [ ] 每个剧情节拍是否至少能追到一个任务、台词或演出表？');
  lines.push('- [ ] 每个任务/台词/演出变更是否已经落到 `NarrativeTaskTable` 和团队时间表？');
  lines.push('- [ ] QA/试玩反馈如果影响叙事，是否已经拆成修复与复测任务？');

  return lines.join('\n');
}

function teamWorkpackTaskFlags(task: any, date = teamTodayString()): string {
  const flags = [
    normalizeTeamTaskStatus(task.status) === 'blocked' || normalizeTeamScheduleText(task.blocker) ? '阻塞' : '',
    normalizeTeamScheduleDate(task.dueDate) && normalizeTeamScheduleDate(task.dueDate) < date ? '逾期' : '',
    normalizeTeamScheduleDate(task.dueDate) === date ? '今天到期' : '',
    normalizeTeamTaskPriority(task.priority) === 'high' ? '高优先级' : '',
    normalizeTeamSchedulePath(task.linkedDoc) ? '' : '未关联文档',
    normalizeTeamScheduleText(task.acceptance) ? '' : '缺验收',
  ].filter(Boolean);
  return flags.length > 0 ? flags.join(' / ') : normalizeTeamTaskStatus(task.status);
}

function teamWorkpackNextAction(task: any, vaultPath: string, date = teamTodayString()): string {
  if (normalizeTeamTaskStatus(task.status) === 'blocked' || normalizeTeamScheduleText(task.blocker)) return '先解除卡点，明确需要谁提供资源/决策/实现支持';
  const linkedDoc = normalizeTeamSchedulePath(task.linkedDoc);
  if (!linkedDoc || !linkedTeamDocExists(vaultPath, linkedDoc)) return '先生成或修复任务文档，让成员能直接进入工作页';
  if (!normalizeTeamScheduleText(task.acceptance)) return '补齐验收标准，避免完成口径不一致';
  const dueDate = normalizeTeamScheduleDate(task.dueDate);
  if (dueDate && dueDate < date) return '重新拆分或改期，并确认今天能交付的最小结果';
  if (dueDate === date) return '今天收尾并记录验收结果';
  if (normalizeTeamTaskStatus(task.status) === 'doing') return '继续推进，并在结束前记录工时和产出';
  return '开始推进前先确认依赖、交付物和验收口径';
}

function teamScheduleMembers(schedule: any): string[] {
  const members = new Set<string>();
  for (const member of Array.isArray(schedule?.members) ? schedule.members : []) {
    const clean = normalizeTeamScheduleText(member);
    if (clean && clean !== '未分配') members.add(clean);
  }
  for (const task of Array.isArray(schedule?.tasks) ? schedule.tasks : []) {
    const owner = normalizeTeamScheduleText(task?.owner);
    if (owner && owner !== '未分配') members.add(owner);
    for (const log of Array.isArray(task?.logs) ? task.logs : []) {
      const logMember = normalizeTeamScheduleText(log?.member);
      if (logMember && logMember !== '未分配') members.add(logMember);
    }
    for (const review of Array.isArray(task?.reviewLogs) ? task.reviewLogs : []) {
      const reviewer = normalizeTeamScheduleText(review?.reviewer || review?.member);
      if (reviewer && reviewer !== '未分配') members.add(reviewer);
    }
  }
  return Array.from(members).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function safeTeamMemberFileName(member: string): string {
  const clean = normalizeTeamMemberName(member)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || 'member';
}

function teamMemberPageLink(member: string): string {
  const fileName = safeTeamMemberFileName(member);
  return `[[${TEAM_SCHEDULE_DIR}/members/${fileName}|${normalizeTeamMemberName(member)}]]`;
}

function buildTeamMemberTaskPage(vaultPath: string, schedule: any, member: string, health: any, date = teamTodayString()): string {
  const cleanMember = normalizeTeamMemberName(member);
  const tasks = Array.isArray(schedule?.tasks) ? schedule.tasks : [];
  const activeTasks = tasks.filter((task: any) => normalizeTeamTaskStatus(task.status) !== 'done');
  const owned = teamReportTaskSort(activeTasks.filter((task: any) => normalizeTeamScheduleText(task.owner) === cleanMember));
  const assisting = teamReportTaskSort(activeTasks.filter((task: any) => (
    normalizeTeamScheduleText(task.owner) !== cleanMember
    && (
      (Array.isArray(task.logs) ? task.logs : []).some((log: any) => normalizeTeamScheduleText(log.member) === cleanMember)
      || (Array.isArray(task.reviewLogs) ? task.reviewLogs : []).some((log: any) => normalizeTeamScheduleText(log.reviewer || log.member) === cleanMember)
    )
  )));
  const logs = tasks.flatMap((task: any) => (
    (Array.isArray(task.logs) ? task.logs : [])
      .filter((log: any) => normalizeTeamScheduleText(log.member) === cleanMember)
      .map((log: any) => ({
        task,
        date: normalizeTeamScheduleDate(log.date),
        minutes: parseTeamScheduleMinutes(log.minutes),
        note: normalizeTeamScheduleText(log.note),
        createdAt: normalizeTeamScheduleText(log.createdAt),
      }))
  )).sort((a: any, b: any) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
  const todayLogs = logs.filter((log: any) => log.date === date);
  const memberLoad = (Array.isArray(health?.memberLoad) ? health.memberLoad : buildTeamMemberLoadRows(vaultPath, schedule, date))
    .find((row: any) => normalizeTeamScheduleText(row.member) === cleanMember);
  const blocked = owned.filter((task: any) => normalizeTeamTaskStatus(task.status) === 'blocked' || normalizeTeamScheduleText(task.blocker));
  const overdue = owned.filter((task: any) => {
    const due = normalizeTeamScheduleDate(task.dueDate);
    return due && due < date;
  });
  const dueToday = owned.filter((task: any) => normalizeTeamScheduleDate(task.dueDate) === date);
  const dueSoon = owned.filter((task: any) => teamDueWithinDays(task.dueDate, 7, date));
  const missingDocs = owned.filter((task: any) => !normalizeTeamSchedulePath(task.linkedDoc) || !linkedTeamDocExists(vaultPath, task.linkedDoc));
  const missingAcceptance = owned.filter((task: any) => !normalizeTeamScheduleText(task.acceptance));
  const totalMinutes = logs.reduce((sum: number, log: any) => sum + parseTeamScheduleMinutes(log.minutes), 0);
  const todayMinutes = todayLogs.reduce((sum: number, log: any) => sum + parseTeamScheduleMinutes(log.minutes), 0);
  const dateKey = date.replace(/-/g, '');
  const focusTasks = teamReportTaskSort(Array.from(new Map([
    ...blocked,
    ...overdue,
    ...dueToday,
    ...dueSoon,
    ...owned.filter((task: any) => normalizeTeamTaskPriority(task.priority) === 'high'),
    ...owned,
  ].map((task: any) => [normalizeTeamScheduleText(task.id) || teamTaskKey(task), task] as const)).values())).slice(0, 18);
  const lines: string[] = [];

  lines.push('---');
  lines.push('type: ars-team-member-page');
  lines.push(`member: ${JSON.stringify(cleanMember)}`);
  lines.push(`date: ${JSON.stringify(date)}`);
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push(`scheduleUpdatedAt: ${JSON.stringify(schedule.updatedAt || '')}`);
  lines.push(`schedule: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`)}`);
  lines.push('tags:');
  lines.push('  - team-member');
  lines.push('  - production');
  lines.push('  - game-dev');
  lines.push('---');
  lines.push('');
  lines.push(`# ${cleanMember} 的任务页 - ${date}`);
  lines.push('');
  lines.push('> 自动从团队时间表生成。用途：成员每天打开这一页，先看优先级和风险，再进入对应任务文档开工，结束前记录实际用时。');
  lines.push('');
  lines.push('## 入口');
  lines.push(`- Obsidian 控制台：[[${TEAM_SCHEDULE_DIR}/${teamObsidianCommandCenterFileName().replace(/\.md$/i, '')}|${teamObsidianCommandCenterFileName().replace(/\.md$/i, '')}]]`);
  lines.push(`- 今日团队工作包：[[${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${dateKey}|daily-workpack-${dateKey}]]`);
  lines.push(`- 团队首页：[[${TEAM_SCHEDULE_DIR}/team-dashboard|team-dashboard]]`);
  lines.push(`- 里程碑路线图：[[${TEAM_SCHEDULE_DIR}/roadmaps/${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}|${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 周计划：[[${TEAM_SCHEDULE_DIR}/sprints/${teamSprintPlanFileName(date).replace(/\.md$/i, '')}|${teamSprintPlanFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 阻塞交接清单：[[${TEAM_SCHEDULE_DIR}/handoffs/blocker-handoff-${dateKey}|blocker-handoff-${dateKey}]]`);
  lines.push(`- 验收复查队列：[[${TEAM_SCHEDULE_DIR}/reviews/review-queue-${dateKey}|review-queue-${dateKey}]]`);
  lines.push(`- 变更影响表：[[${TEAM_SCHEDULE_DIR}/changes/${teamChangeImpactFileName(date).replace(/\.md$/i, '')}|${teamChangeImpactFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 时间表数据：\`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}\``);
  lines.push('');
  lines.push('## 今日摘要');
  lines.push(`- 活跃任务：${owned.length}；阻塞：${blocked.length}；逾期：${overdue.length}；今天到期：${dueToday.length}；7 天内到期：${dueSoon.length}。`);
  lines.push(`- 缺任务文档：${missingDocs.length}；缺验收标准：${missingAcceptance.length}；协助过的活跃任务：${assisting.length}。`);
  lines.push(`- 今日已记录：${formatTeamMinutes(todayMinutes)}；累计记录：${formatTeamMinutes(totalMinutes)}；预估剩余：${formatTeamMinutes(memberLoad?.remainingMinutes || 0)}。`);
  if (memberLoad) {
    const risks = Array.isArray(memberLoad.reasons) && memberLoad.reasons.length ? memberLoad.reasons.slice(0, 5).join(' / ') : '节奏正常';
    lines.push(`- 负载判断：${teamMemberLoadLabel(memberLoad.level)}；风险：${risks}；建议：${memberLoad.recommendation || '-'}`);
  }
  lines.push('');
  lines.push('## 开工方式');
  lines.push('- 先打开“今天先做”里的第一个任务文档，确认交付物、依赖、阻塞和验收标准。');
  lines.push('- 做完一段工作后，在任务文档 `Work Log` 写 `- 45m | 做了什么`。缺日期和成员时，软件会用今天和当前成员补齐。');
  lines.push('- 如果已经可以验收，在任务文档 `Review Log` 写 `- approved | 通过说明`；需要返工则写 `- changes | 退回原因`。');
  lines.push('- 收工前回到团队时间表点“一键生产刷新”，让另一台电脑、AI 交接和制作人页面都看到最新状态。');
  lines.push('');
  lines.push('## 今天先做');
  if (focusTasks.length === 0) {
    lines.push('- 暂无分配给你的活跃任务。');
  } else {
    lines.push('| 标记 | 优先级 | 状态 | 截止 | 任务 | 文档 | 下一步 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const task of focusTasks) {
      lines.push([
        teamWorkpackTaskFlags(task, date),
        normalizeTeamTaskPriority(task.priority),
        normalizeTeamTaskStatus(task.status),
        normalizeTeamScheduleDate(task.dueDate) || '-',
        normalizeTeamScheduleText(task.title),
        teamDocWikiLink(task.linkedDoc),
        teamWorkpackNextAction(task, vaultPath, date),
      ].map(teamMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  lines.push('## 任务详情');
  if (owned.length === 0) {
    lines.push('- 当前没有分配给你的活跃任务。');
  } else {
    for (const task of owned.slice(0, 40)) {
      const linkedDoc = normalizeTeamSchedulePath(task.linkedDoc);
      lines.push(`### ${normalizeTeamScheduleText(task.title)}`);
      lines.push(`- 状态：${normalizeTeamTaskStatus(task.status)}；优先级：${normalizeTeamTaskPriority(task.priority)}；截止：${normalizeTeamScheduleDate(task.dueDate) || '-'}；文档：${teamDocWikiLink(linkedDoc)}${linkedDoc && !linkedTeamDocExists(vaultPath, linkedDoc) ? '（缺失）' : ''}`);
      if (normalizeTeamScheduleText(task.deliverable)) lines.push(`- 交付物：${normalizeTeamScheduleText(task.deliverable)}`);
      if (normalizeTeamScheduleText(task.dependency)) lines.push(`- 依赖：${normalizeTeamScheduleText(task.dependency)}`);
      if (normalizeTeamScheduleText(task.blocker)) lines.push(`- 阻塞：${normalizeTeamScheduleText(task.blocker)}`);
      lines.push(`- 下一步：${teamWorkpackNextAction(task, vaultPath, date)}`);
      if (normalizeTeamScheduleText(task.acceptance)) lines.push(`- 验收：${normalizeTeamScheduleText(task.acceptance)}`);
      else lines.push('- 验收：缺验收标准，开工前先补齐。');
      lines.push('');
    }
  }
  lines.push('## 我参与过的其他任务');
  if (assisting.length === 0) {
    lines.push('- 暂无。');
  } else {
    for (const task of assisting.slice(0, 12)) {
      lines.push(`- ${normalizeTeamScheduleText(task.title)}（负责人：${normalizeTeamScheduleText(task.owner) || '未分配'}；文档：${teamDocWikiLink(task.linkedDoc)}）`);
    }
  }
  lines.push('');
  lines.push('## 最近工时记录');
  if (logs.length === 0) {
    lines.push('- 暂无工时记录。');
  } else {
    for (const log of logs.slice(0, 14)) {
      lines.push(`- ${log.date || '-'} · ${formatTeamMinutes(log.minutes)} · ${normalizeTeamScheduleText(log.task?.title)}${log.note ? `：${log.note}` : ''}`);
    }
  }
  lines.push('');
  lines.push('## 收工检查');
  lines.push('- [ ] 今天做了什么已经记录到任务工时里。');
  lines.push('- [ ] 有产出的任务文档已经更新，截图/录屏/资源路径能追溯。');
  lines.push('- [ ] 阻塞或依赖变化已经写回任务表，方便制作人明天接手。');
  lines.push('- [ ] 待验收任务有明确验收标准和复测方式。');
  lines.push('- [ ] 已经点过“一键生产刷新”，确认成员页、今日工作包和 AI 交接都更新。');

  return lines.join('\n');
}

function buildTeamDailyWorkpackPage(vaultPath: string, schedule: any, health: any, date = teamTodayString()): string {
  const activeTasks = teamReportTaskSort((schedule.tasks || []).filter((task: any) => normalizeTeamTaskStatus(task.status) !== 'done'));
  const focus = health?.focus || {};
  const todayLogs = (schedule.tasks || []).flatMap((task: any) => (
    (Array.isArray(task.logs) ? task.logs : [])
      .filter((log: any) => normalizeTeamScheduleDate(log?.date) === date)
      .map((log: any) => ({
        task,
        member: normalizeTeamScheduleText(log?.member),
        minutes: parseTeamScheduleMinutes(log?.minutes),
        note: normalizeTeamScheduleText(log?.note),
      }))
  ));
  const members = Array.from(new Set([
    ...(Array.isArray(schedule.members) ? schedule.members : []),
    ...activeTasks.map((task: any) => normalizeTeamScheduleText(task.owner)),
    ...todayLogs.map((log: any) => normalizeTeamScheduleText(log.member)),
  ].map((item) => normalizeTeamScheduleText(item)).filter((item) => item && item !== '未分配')))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const focusTasks = teamReportTaskSort(Array.from(new Map([
    ...((focus.blocked || []) as any[]),
    ...((focus.overdue || []) as any[]),
    ...((focus.dueSoon || []) as any[]),
    ...activeTasks.filter((task: any) => normalizeTeamTaskPriority(task.priority) === 'high').map(teamTaskBrief),
    ...activeTasks.filter((task: any) => normalizeTeamTaskStatus(task.status) === 'doing').map(teamTaskBrief),
    ...activeTasks.map(teamTaskBrief),
  ].map((task: any) => [normalizeTeamScheduleText(task.id) || teamTaskKey(task), task] as const)).values())).slice(0, 16);
  const missingAcceptance = activeTasks.filter((task: any) => !normalizeTeamScheduleText(task.acceptance));
  const totalTodayMinutes = todayLogs.reduce((sum: number, log: any) => sum + parseTeamScheduleMinutes(log.minutes), 0);
  const memberLoad = buildTeamMemberLoadRows(vaultPath, schedule, date);
  const dateKey = date.replace(/-/g, '');
  const tableRow = (items: unknown[]): string => `| ${items.map(teamMarkdownCell).join(' | ')} |`;
  const lines: string[] = [];

  lines.push('---');
  lines.push('type: ars-team-daily-workpack');
  lines.push(`date: ${JSON.stringify(date)}`);
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push(`scheduleUpdatedAt: ${JSON.stringify(schedule.updatedAt || '')}`);
  lines.push(`schedule: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`)}`);
  lines.push('tags:');
  lines.push('  - team-workpack');
  lines.push('  - production');
  lines.push('  - game-dev');
  lines.push('---');
  lines.push('');
  lines.push(`# 今日团队工作包 - ${date}`);
  lines.push('');
  lines.push(`> 自动从 \`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}\` 和制作健康扫描生成。用途：每天开工先看这一页，成员从自己的入口进入任务文档，制作人从风险队列处理阻塞。`);
  lines.push('');

  lines.push('## 开工入口');
  lines.push(`- 团队首页：[[${TEAM_SCHEDULE_DIR}/team-dashboard|team-dashboard]]`);
  lines.push(`- AI 交接简报：[[${TEAM_SCHEDULE_DIR}/ai-handoff|ai-handoff]]`);
  lines.push(`- 里程碑路线图：[[${TEAM_SCHEDULE_DIR}/roadmaps/${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}|${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 叙事导演台：[[${TEAM_SCHEDULE_DIR}/narrative-director|narrative-director]]`);
  lines.push(`- 周计划：[[${TEAM_SCHEDULE_DIR}/sprints/${teamSprintPlanFileName(date).replace(/\.md$/i, '')}|${teamSprintPlanFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 阻塞交接清单：[[${TEAM_SCHEDULE_DIR}/handoffs/blocker-handoff-${dateKey}|blocker-handoff-${dateKey}]]`);
  lines.push(`- 验收复查队列：[[${TEAM_SCHEDULE_DIR}/reviews/review-queue-${dateKey}|review-queue-${dateKey}]]`);
  lines.push(`- 今日工时表：[[${TEAM_SCHEDULE_DIR}/timesheets/timesheet-${dateKey}|timesheet-${dateKey}]]`);
  lines.push(`- 变更影响表：[[${TEAM_SCHEDULE_DIR}/changes/${teamChangeImpactFileName(date).replace(/\.md$/i, '')}|${teamChangeImpactFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 依赖图：[[${TEAM_SCHEDULE_DIR}/dependency-map|dependency-map]]`);
  lines.push(`- 今日日报：[[${TEAM_SCHEDULE_DIR}/reports/daily-standup-${dateKey}|daily-standup-${dateKey}]]`);
  if (members.length > 0) {
    lines.push(`- 成员任务页：${members.map((member) => teamMemberPageLink(member)).join(' · ')}`);
  }
  lines.push(`- 时间表数据：\`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}\``);
  lines.push('');

  lines.push('## 今日判断');
  lines.push(`- 活跃任务：${health?.stats?.active || activeTasks.length}；阻塞：${health?.stats?.blocked || 0}；逾期：${health?.stats?.overdue || 0}；7 天内到期：${health?.stats?.dueSoon || 0}。`);
  lines.push(`- 缺负责人：${health?.stats?.missingOwner || 0}；缺截止日期：${health?.stats?.missingDueDate || 0}；缺任务文档：${health?.stats?.missingDocs || 0}；缺验收标准：${missingAcceptance.length}。`);
  lines.push(`- QA/Bug/试玩反馈：${health?.stats?.qaOpen || 0}；叙事缺阶段：${health?.stats?.narrativeMissingStages || 0}；叙事弱链接：${health?.stats?.narrativeWeakLinks || 0}。`);
  lines.push(`- 今日已记录：${formatTeamMinutes(totalTodayMinutes)}。`);
  lines.push('');

  lines.push('## 成员调度建议');
  if (memberLoad.length === 0) {
    lines.push('- 暂无成员负载数据。');
  } else {
    lines.push('| 状态 | 成员 | 活跃 | 风险 | 剩余 | 下一项 | 建议动作 |');
    lines.push('| --- | --- | ---: | --- | ---: | --- | --- |');
    for (const row of memberLoad.slice(0, 12)) {
      lines.push([
        teamMemberLoadLabel(row.level),
        teamMarkdownCell(row.member),
        row.active || 0,
        teamMarkdownCell(Array.isArray(row.reasons) && row.reasons.length ? row.reasons.slice(0, 4).join(' / ') : '节奏正常'),
        formatTeamMinutes(row.remainingMinutes || 0),
        teamMarkdownCell(row.nextTask?.title || '-'),
        teamMarkdownCell(row.recommendation || '-'),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');

  lines.push('## 今日焦点队列');
  if (focusTasks.length === 0) {
    lines.push('- 暂无需要优先处理的活跃任务。');
  } else {
    lines.push('| 标记 | 负责人 | 状态 | 截止 | 任务 | 文档 | 下一步 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const task of focusTasks) {
      lines.push([
        teamWorkpackTaskFlags(task, date),
        normalizeTeamScheduleText(task.owner) || '未分配',
        normalizeTeamTaskStatus(task.status),
        normalizeTeamScheduleDate(task.dueDate) || '-',
        normalizeTeamScheduleText(task.title),
        teamDocWikiLink(task.linkedDoc),
        teamWorkpackNextAction(task, vaultPath, date),
      ].map(teamMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');

  lines.push('## 按成员开工');
  if (members.length === 0) {
    lines.push('- 暂无成员。');
  } else {
    for (const member of members.slice(0, 18)) {
      const owned = activeTasks
        .filter((task: any) => normalizeTeamScheduleText(task.owner) === member)
        .slice(0, 6);
      const memberMinutes = todayLogs
        .filter((log: any) => normalizeTeamScheduleText(log.member) === member)
        .reduce((sum: number, log: any) => sum + parseTeamScheduleMinutes(log.minutes), 0);
      const load = memberLoad.find((row: any) => normalizeTeamScheduleText(row.member) === member);
      lines.push(`### ${member}`);
      lines.push(`- 今日已记录：${formatTeamMinutes(memberMinutes)}；任务页：${teamMemberPageLink(member)}。`);
      if (load) {
        const riskText = Array.isArray(load.reasons) && load.reasons.length ? load.reasons.slice(0, 4).join(' / ') : '节奏正常';
        lines.push(`- 负载：${teamMemberLoadLabel(load.level)}；风险：${riskText}；剩余：${formatTeamMinutes(load.remainingMinutes || 0)}；建议：${load.recommendation || '-'}`);
      }
      if (owned.length === 0) {
        lines.push('- 暂无活跃任务。');
      } else {
        for (const task of owned) {
          lines.push(`- [ ] ${normalizeTeamScheduleText(task.title)}（${teamWorkpackTaskFlags(task, date)}）`);
          lines.push(`  - 入口：${teamDocWikiLink(task.linkedDoc)}；截止：${normalizeTeamScheduleDate(task.dueDate) || '-'}；下一步：${teamWorkpackNextAction(task, vaultPath, date)}`);
          if (task.dependency) lines.push(`  - 依赖：${compactTeamReportText(task.dependency, 180)}`);
          if (task.blocker) lines.push(`  - 卡点：${compactTeamReportText(task.blocker, 180)}`);
        }
      }
      lines.push('');
    }
  }

  lines.push('## 风险队列');
  const riskTasks = teamReportTaskSort(Array.from(new Map([
    ...((focus.blocked || []) as any[]),
    ...((focus.overdue || []) as any[]),
    ...((focus.missingDocs || []) as any[]),
    ...missingAcceptance.map(teamTaskBrief),
  ].map((task: any) => [normalizeTeamScheduleText(task.id) || teamTaskKey(task), task] as const)).values())).slice(0, 18);
  if (riskTasks.length === 0) {
    lines.push('- 暂无明显风险。');
  } else {
    for (const task of riskTasks) {
      lines.push(`- ${teamWorkpackTaskFlags(task, date)}：${normalizeTeamScheduleText(task.title)}（${normalizeTeamScheduleText(task.owner) || '未分配'}）`);
      lines.push(`  - 入口：${teamDocWikiLink(task.linkedDoc)}；动作：${teamWorkpackNextAction(task, vaultPath, date)}`);
    }
  }
  lines.push('');

  lines.push('## 收工复查');
  lines.push('- [ ] 今日焦点里的阻塞/逾期任务是否已有明确处理结果。');
  lines.push('- [ ] 每个成员是否记录了实际投入或说明没有推进的原因。');
  lines.push('- [ ] 新增任务是否都有负责人、截止日期、关联文档和验收标准。');
  lines.push('- [ ] 依赖图里仍卡住的交接项是否已经通知对应成员。');
  lines.push('- [ ] 今日产生的剧情/台词/演出/任务表变更是否同步到团队时间表。');
  return lines.join('\n');
}

function buildTeamDailyStandupPage(vaultPath: string, schedule: any, health: any, date = teamTodayString()): string {
  const tasks = Array.isArray(schedule?.tasks) ? schedule.tasks : [];
  const activeTasks = teamReportTaskSort(tasks.filter((task: any) => normalizeTeamTaskStatus(task.status) !== 'done'));
  const todayLogs = tasks.flatMap((task: any) => (
    (Array.isArray(task.logs) ? task.logs : [])
      .filter((log: any) => normalizeTeamScheduleDate(log?.date) === date)
      .map((log: any) => ({
        task,
        member: normalizeTeamScheduleText(log?.member),
        minutes: parseTeamScheduleMinutes(log?.minutes),
        note: normalizeTeamScheduleText(log?.note),
      }))
  ));
  const totalTodayMinutes = todayLogs.reduce((sum: number, log: any) => sum + log.minutes, 0);
  const focus = health?.focus || {};
  const focusTasks = teamReportTaskSort(Array.from(new Map([
    ...((focus.blocked || []) as any[]),
    ...((focus.overdue || []) as any[]),
    ...((focus.dueSoon || []) as any[]),
    ...activeTasks.filter((task: any) => normalizeTeamTaskPriority(task.priority) === 'high').map(teamTaskBrief),
    ...activeTasks.filter((task: any) => normalizeTeamTaskStatus(task.status) === 'doing').map(teamTaskBrief),
  ].map((task: any) => [normalizeTeamScheduleText(task.id) || teamTaskKey(task), task] as const)).values())).slice(0, 18);
  const members = teamScheduleMembers(schedule);
  const memberLoad = buildTeamMemberLoadRows(vaultPath, schedule, date);
  const dateKey = date.replace(/-/g, '');
  const tableRow = (items: unknown[]): string => `| ${items.map(teamMarkdownCell).join(' | ')} |`;
  const lines: string[] = [];

  lines.push('---');
  lines.push('type: ars-team-daily-standup');
  lines.push(`date: ${JSON.stringify(date)}`);
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push(`scheduleUpdatedAt: ${JSON.stringify(schedule.updatedAt || '')}`);
  lines.push(`schedule: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`)}`);
  lines.push('tags:');
  lines.push('  - team-standup');
  lines.push('  - production');
  lines.push('  - game-dev');
  lines.push('---');
  lines.push('');
  lines.push(`# 团队制作日报 - ${date}`);
  lines.push('');
  lines.push(`> 自动从 \`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}\`、任务文档和制作健康扫描生成。用途：开会前快速看到今天谁做了什么、哪里卡住、下一步怎么分配。`);
  lines.push('');
  lines.push('## 今日入口');
  lines.push(`- 今日工作包：[[${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${dateKey}|daily-workpack-${dateKey}]]`);
  lines.push(`- 团队首页：[[${TEAM_SCHEDULE_DIR}/team-dashboard|team-dashboard]]`);
  lines.push(`- Obsidian 控制台：[[${TEAM_SCHEDULE_DIR}/${teamObsidianCommandCenterFileName().replace(/\.md$/i, '')}|${teamObsidianCommandCenterFileName().replace(/\.md$/i, '')}]]`);
  lines.push(`- 工时表：[[${TEAM_SCHEDULE_DIR}/timesheets/timesheet-${dateKey}|timesheet-${dateKey}]]`);
  lines.push(`- 生产健康：[[${TEAM_SCHEDULE_DIR}/${teamProductionHealthFileName().replace(/\.md$/i, '')}|${teamProductionHealthFileName().replace(/\.md$/i, '')}]]`);
  lines.push('');
  lines.push('## 关键指标');
  lines.push('| 指标 | 数量 |');
  lines.push('| --- | ---: |');
  lines.push(`| 活跃任务 | ${health?.stats?.active || activeTasks.length} |`);
  lines.push(`| 进行中 | ${health?.stats?.doing || activeTasks.filter((task: any) => normalizeTeamTaskStatus(task.status) === 'doing').length} |`);
  lines.push(`| 阻塞 | ${health?.stats?.blocked || 0} |`);
  lines.push(`| 逾期 | ${health?.stats?.overdue || 0} |`);
  lines.push(`| 7 天内到期 | ${health?.stats?.dueSoon || 0} |`);
  lines.push(`| 缺任务文档 | ${health?.stats?.missingDocs || 0} |`);
  lines.push(`| 今日记录工时 | ${formatTeamMinutes(totalTodayMinutes)} |`);
  lines.push(`| 今日工时记录 | ${todayLogs.length} |`);
  lines.push('');
  lines.push('## 昨天/今天的实际记录');
  if (todayLogs.length === 0) {
    lines.push('- 今天还没有成员记录工时。提醒成员在任务文档 `Work Log` 写 `- 45m | 做了什么`。');
  } else {
    for (const log of todayLogs.slice(0, 32)) {
      lines.push(`- ${normalizeTeamScheduleText(log.member) || '未分配'} · ${formatTeamMinutes(log.minutes)} · ${teamDocWikiLink(log.task?.linkedDoc)} · ${compactTeamReportText(log.task?.title || '-', 90)}${log.note ? `：${compactTeamReportText(log.note, 160)}` : ''}`);
    }
  }
  lines.push('');
  lines.push('## 今日焦点');
  if (focusTasks.length === 0) {
    lines.push('- 暂无需要特别推进的焦点任务。');
  } else {
    lines.push('| 标记 | 负责人 | 状态 | 截止 | 任务 | 文档 | 今天动作 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const task of focusTasks) {
      lines.push(tableRow([
        teamWorkpackTaskFlags(task, date),
        normalizeTeamScheduleText(task.owner) || '未分配',
        normalizeTeamTaskStatus(task.status),
        normalizeTeamScheduleDate(task.dueDate) || '-',
        compactTeamReportText(task.title, 90),
        teamDocWikiLink(task.linkedDoc),
        teamWorkpackNextAction(task, vaultPath, date),
      ]));
    }
  }
  lines.push('');
  lines.push('## 成员状态');
  if (members.length === 0) {
    lines.push('- 暂无成员。');
  } else {
    lines.push('| 成员 | 今日工时 | 活跃 | 风险 | 下一项 | 建议 |');
    lines.push('| --- | ---: | ---: | --- | --- | --- |');
    for (const member of members.slice(0, 32)) {
      const todayMinutes = todayLogs
        .filter((log: any) => normalizeTeamScheduleText(log.member) === member)
        .reduce((sum: number, log: any) => sum + log.minutes, 0);
      const load = memberLoad.find((row: any) => normalizeTeamScheduleText(row.member) === member);
      lines.push(tableRow([
        teamMemberPageLink(member),
        formatTeamMinutes(todayMinutes),
        load?.active || activeTasks.filter((task: any) => normalizeTeamScheduleText(task.owner) === member).length,
        load ? teamMemberLoadLabel(load.level) : '-',
        load?.nextTask?.title || '-',
        load?.recommendation || (todayMinutes > 0 ? '收工前补产出链接和验收状态' : '确认今天是否有推进或需要转派'),
      ]));
    }
  }
  lines.push('');
  lines.push('## 会议结论');
  lines.push('- [ ] 阻塞任务是否有解阻人和时间。');
  lines.push('- [ ] 逾期任务是否拆小、改期或降范围。');
  lines.push('- [ ] 今天新增/变更的剧情、台词、演出、任务表是否同步到团队时间表。');
  lines.push('- [ ] 成员收工前是否会记录实际用时和产出位置。');
  return lines.join('\n');
}

function buildTeamTimesheetPage(vaultPath: string, schedule: any, health: any, date = teamTodayString()): string {
  const tasks = Array.isArray(schedule?.tasks) ? schedule.tasks : [];
  const activeTasks = teamReportTaskSort(tasks.filter((task: any) => normalizeTeamTaskStatus(task.status) !== 'done'));
  const todayLogs = tasks.flatMap((task: any) => (
    (Array.isArray(task.logs) ? task.logs : [])
      .filter((log: any) => normalizeTeamScheduleDate(log?.date) === date)
      .map((log: any) => ({
        task,
        member: normalizeTeamScheduleText(log?.member) || normalizeTeamScheduleText(task?.owner) || '未分配',
        date: normalizeTeamScheduleDate(log?.date),
        minutes: parseTeamScheduleMinutes(log?.minutes),
        note: normalizeTeamScheduleText(log?.note),
        createdAt: normalizeTeamScheduleText(log?.createdAt),
      }))
  )).filter((log: any) => log.minutes > 0);
  const members = teamScheduleMembers(schedule);
  const memberRows = members.map((member) => {
    const owned = activeTasks.filter((task: any) => normalizeTeamScheduleText(task.owner) === member);
    const memberTodayLogs = todayLogs.filter((log: any) => normalizeTeamScheduleText(log.member) === member);
    const todayMinutes = memberTodayLogs.reduce((sum: number, log: any) => sum + parseTeamScheduleMinutes(log.minutes), 0);
    const totalMinutes = tasks.reduce((sum: number, task: any) => (
      sum + (Array.isArray(task.logs) ? task.logs : [])
        .filter((log: any) => normalizeTeamScheduleText(log?.member) === member)
        .reduce((logSum: number, log: any) => logSum + parseTeamScheduleMinutes(log?.minutes), 0)
    ), 0);
    const remainingMinutes = owned.reduce((sum: number, task: any) => (
      sum + Math.max(parseTeamScheduleMinutes(task.estimateMinutes) - taskSpentMinutesForBrief(task), 0)
    ), 0);
    const sortedLogs = memberTodayLogs.slice().sort((a: any, b: any) => normalizeTeamScheduleText(a.createdAt).localeCompare(normalizeTeamScheduleText(b.createdAt)));
    const firstLog = normalizeTeamScheduleText(sortedLogs[0]?.createdAt).slice(11, 16) || '-';
    const lastLog = normalizeTeamScheduleText(sortedLogs[sortedLogs.length - 1]?.createdAt).slice(11, 16) || '-';
    return {
      member,
      active: owned.length,
      todayMinutes,
      totalMinutes,
      remainingMinutes,
      logCount: memberTodayLogs.length,
      firstLog,
      lastLog,
      currentFocus: normalizeTeamScheduleText(teamReportTaskSort(owned)[0]?.title) || '-',
    };
  }).sort((a, b) => b.todayMinutes - a.todayMinutes || b.active - a.active || b.remainingMinutes - a.remainingMinutes || a.member.localeCompare(b.member, 'zh-CN'));
  const unloggedActive = memberRows.filter((row) => row.active > 0 && row.todayMinutes <= 0);
  const taskRows = activeTasks.map((task: any) => {
    const taskTodayLogs = todayLogs.filter((log: any) => normalizeTeamScheduleText(log.task?.id) === normalizeTeamScheduleText(task.id));
    const todayMinutes = taskTodayLogs.reduce((sum: number, log: any) => sum + parseTeamScheduleMinutes(log.minutes), 0);
    const spentMinutes = taskSpentMinutesForBrief(task);
    const linkedDoc = normalizeTeamSchedulePath(task.linkedDoc);
    const docStatus = !linkedDoc ? 'none' : linkedTeamDocExists(vaultPath, linkedDoc) ? 'linked' : 'missing';
    return {
      task,
      todayMinutes,
      spentMinutes,
      remainingMinutes: Math.max(parseTeamScheduleMinutes(task.estimateMinutes) - spentMinutes, 0),
      docStatus,
    };
  }).filter((row: any) => row.todayMinutes > 0 || row.remainingMinutes > 0 || normalizeTeamTaskStatus(row.task.status) === 'doing' || normalizeTeamTaskStatus(row.task.status) === 'review' || normalizeTeamTaskStatus(row.task.status) === 'blocked')
    .sort((a: any, b: any) => b.todayMinutes - a.todayMinutes || b.remainingMinutes - a.remainingMinutes || normalizeTeamScheduleDate(a.task.dueDate).localeCompare(normalizeTeamScheduleDate(b.task.dueDate)) || normalizeTeamScheduleText(a.task.title).localeCompare(normalizeTeamScheduleText(b.task.title), 'zh-CN'));
  const dateKey = date.replace(/-/g, '');
  const totalTodayMinutes = todayLogs.reduce((sum: number, log: any) => sum + parseTeamScheduleMinutes(log.minutes), 0);
  const totalRemainingMinutes = activeTasks.reduce((sum: number, task: any) => (
    sum + Math.max(parseTeamScheduleMinutes(task.estimateMinutes) - taskSpentMinutesForBrief(task), 0)
  ), 0);
  const lines: string[] = [];

  lines.push('---');
  lines.push('type: ars-team-timesheet');
  lines.push(`date: ${JSON.stringify(date)}`);
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push(`scheduleUpdatedAt: ${JSON.stringify(schedule.updatedAt || '')}`);
  lines.push(`schedule: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`)}`);
  lines.push('tags:');
  lines.push('  - team-timesheet');
  lines.push('  - production');
  lines.push('  - game-dev');
  lines.push('---');
  lines.push('');
  lines.push(`# 每日工时表 - ${date}`);
  lines.push('');
  lines.push(`> 自动从 \`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}\` 生成。它记录成员实际做了什么、用了多久、产出在哪个任务文档，方便制作人复盘，也方便 AI 接管后判断真实进度。`);
  lines.push('');
  lines.push('## 快速入口');
  lines.push(`- 今日工作包：[[${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${dateKey}|daily-workpack-${dateKey}]]`);
  lines.push(`- 今日日报：[[${TEAM_SCHEDULE_DIR}/reports/daily-standup-${dateKey}|daily-standup-${dateKey}]]`);
  lines.push(`- 团队首页：[[${TEAM_SCHEDULE_DIR}/team-dashboard|team-dashboard]]`);
  lines.push(`- 里程碑路线图：[[${TEAM_SCHEDULE_DIR}/roadmaps/${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}|${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 变更影响表：[[${TEAM_SCHEDULE_DIR}/changes/${teamChangeImpactFileName(date).replace(/\.md$/i, '')}|${teamChangeImpactFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 原始时间表：\`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}\``);
  lines.push('');
  lines.push('## 今日汇总');
  lines.push(`- 今日记录用时：${formatTeamMinutes(totalTodayMinutes)}；记录条数：${todayLogs.length}；有记录成员：${memberRows.filter((row) => row.todayMinutes > 0).length}/${members.length}。`);
  lines.push(`- 活跃任务：${health?.stats?.active || activeTasks.length}；剩余预估：${formatTeamMinutes(totalRemainingMinutes)}；有任务但今天未记录成员：${unloggedActive.length}。`);
  lines.push('');
  lines.push('## 成员工时');
  if (memberRows.length === 0) {
    lines.push('- 暂无成员。');
  } else {
    lines.push('| 成员 | 今日 | 记录数 | 首次 | 最后 | 活跃任务 | 剩余预估 | 当前焦点 | 成员页 |');
    lines.push('| --- | ---: | ---: | --- | --- | ---: | ---: | --- | --- |');
    for (const row of memberRows) {
      lines.push([
        teamMarkdownCell(row.member),
        formatTeamMinutes(row.todayMinutes),
        row.logCount,
        row.firstLog,
        row.lastLog,
        row.active,
        formatTeamMinutes(row.remainingMinutes),
        teamMarkdownCell(row.currentFocus),
        teamMemberPageLink(row.member),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  lines.push('## 今日明细');
  if (todayLogs.length === 0) {
    lines.push('- 暂无今日工时记录。');
  } else {
    lines.push('| 时间 | 成员 | 用时 | 任务 | 状态 | 文档 | 说明 |');
    lines.push('| --- | --- | ---: | --- | --- | --- | --- |');
    for (const log of todayLogs.slice().sort((a: any, b: any) => normalizeTeamScheduleText(b.createdAt).localeCompare(normalizeTeamScheduleText(a.createdAt)))) {
      const linkedDoc = normalizeTeamSchedulePath(log.task?.linkedDoc);
      const docStatus = !linkedDoc ? 'none' : linkedTeamDocExists(vaultPath, linkedDoc) ? 'linked' : 'missing';
      lines.push([
        normalizeTeamScheduleText(log.createdAt).slice(11, 16) || '-',
        teamMarkdownCell(log.member),
        formatTeamMinutes(log.minutes),
        teamMarkdownCell(normalizeTeamScheduleText(log.task?.title)),
        normalizeTeamTaskStatus(log.task?.status),
        `${teamDocWikiLink(linkedDoc)}${docStatus === 'missing' ? '（缺失）' : docStatus === 'none' ? '（未指定）' : ''}`,
        teamMarkdownCell(log.note || '-'),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  lines.push('## 任务投入');
  if (taskRows.length === 0) {
    lines.push('- 暂无需要汇总的活跃任务。');
  } else {
    lines.push('| 任务 | 负责人 | 状态 | 今日 | 累计 | 预估剩余 | 截止 | 文档 | 下一步 |');
    lines.push('| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |');
    for (const row of taskRows.slice(0, 40)) {
      const linkedDoc = normalizeTeamSchedulePath(row.task.linkedDoc);
      lines.push([
        teamMarkdownCell(normalizeTeamScheduleText(row.task.title)),
        teamMarkdownCell(normalizeTeamScheduleText(row.task.owner) || '未分配'),
        normalizeTeamTaskStatus(row.task.status),
        formatTeamMinutes(row.todayMinutes),
        formatTeamMinutes(row.spentMinutes),
        formatTeamMinutes(row.remainingMinutes),
        normalizeTeamScheduleDate(row.task.dueDate) || '-',
        `${teamDocWikiLink(linkedDoc)}${row.docStatus === 'missing' ? '（缺失）' : row.docStatus === 'none' ? '（未指定）' : ''}`,
        teamMarkdownCell(teamWorkpackNextAction(row.task, vaultPath, date)),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  lines.push('## 未记录提醒');
  if (unloggedActive.length === 0) {
    lines.push('- 有活跃任务的成员今天都已经有工时记录。');
  } else {
    for (const row of unloggedActive) {
      lines.push(`- ${row.member}：${row.active} 个活跃任务，剩余预估 ${formatTeamMinutes(row.remainingMinutes)}，建议收工前补一条“做了什么 + 产出位置”。`);
    }
  }
  lines.push('');
  lines.push('## 制作人检查');
  lines.push('- [ ] 今日用时为 0 但有活跃任务的成员，是否只是忘记记录？');
  lines.push('- [ ] 单个任务累计用时超过预估后，是否需要拆分、改期或降低范围？');
  lines.push('- [ ] 今日记录里的产出是否已经写回对应任务文档？');
  lines.push('- [ ] 卡住、逾期、待验收任务是否已经进入明天的工作包或交接清单？');

  return lines.join('\n');
}

function teamTaskDocumentStatus(task: any, documentPathSet: Set<string>): 'none' | 'linked' | 'missing' {
  const clean = normalizeTeamSchedulePath(task?.linkedDoc);
  if (!clean) return 'none';
  const lower = clean.toLowerCase();
  const noExt = lower.replace(/\.md$/i, '');
  if (documentPathSet.has(lower) || documentPathSet.has(`${noExt}.md`) || documentPathSet.has(noExt)) return 'linked';
  return 'missing';
}

function buildTeamChangeImpactPage(vaultPath: string, schedule: any, health: any, date = teamTodayString()): string {
  const tasks = Array.isArray(schedule?.tasks) ? schedule.tasks : [];
  const activeTasks = teamReportTaskSort(tasks.filter((task: any) => normalizeTeamTaskStatus(task.status) !== 'done'));
  const documentPaths = collectProductionMarkdownFiles(vaultPath, 1200);
  const documentPathSet = new Set<string>();
  for (const doc of documentPaths) {
    const lower = normalizeTeamSchedulePath(doc).toLowerCase();
    documentPathSet.add(lower);
    documentPathSet.add(lower.replace(/\.md$/i, ''));
  }
  const productionDocs = documentPaths.filter(isTeamProductionDocPath);
  const linkedDocSet = new Set(tasks
    .map((task: any) => normalizeTeamSchedulePath(task?.linkedDoc).replace(/\.md$/i, '').toLowerCase())
    .filter(Boolean));
  const unmappedDocs = productionDocs
    .filter((doc) => !linkedDocSet.has(normalizeTeamSchedulePath(doc).replace(/\.md$/i, '').toLowerCase()))
    .slice(0, 60);
  const missingDocTasks = activeTasks.filter((task: any) => teamTaskDocumentStatus(task, documentPathSet) !== 'linked');
  const missingAcceptanceTasks = activeTasks.filter((task: any) => !normalizeTeamScheduleText(task?.acceptance));
  const returnedTasks = activeTasks.filter((task: any) => {
    const latest = latestTeamReviewLog(task);
    return latest && normalizeTeamReviewResult(latest?.result || latest?.status || latest?.conclusion) === 'changes';
  });
  const impactQueue = teamReportTaskSort(Array.from(new Map([
    ...activeTasks.filter((task: any) => inferTeamTaskImpactStage(task) !== 'generic'),
    ...missingDocTasks,
    ...missingAcceptanceTasks,
    ...returnedTasks,
  ].map((task: any) => [normalizeTeamScheduleText(task?.id) || teamTaskKey(task), task])).values())).slice(0, 80);
  const stages: TeamChangeImpactStage[] = ['worldbuilding', 'story', 'quest', 'dialogue', 'performance', 'taskTable', 'ui', 'art', 'audio', 'code', 'qa', 'production'];
  const dateKey = date.replace(/-/g, '');

  const lines: string[] = [];
  lines.push('---');
  lines.push('type: ars-team-change-impact');
  lines.push(`date: ${JSON.stringify(date)}`);
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push(`scheduleUpdatedAt: ${JSON.stringify(schedule.updatedAt || '')}`);
  lines.push(`schedule: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`)}`);
  lines.push('tags:');
  lines.push('  - change-impact');
  lines.push('  - production');
  lines.push('  - game-dev');
  lines.push('---');
  lines.push('');
  lines.push(`# 变更影响表 - ${date}`);
  lines.push('');
  lines.push('> 当世界观、剧情、任务、台词、演出、UI、资源或实现发生变化时，先看这一页，确认影响有没有同步到任务表、成员任务页和验收队列。');
  lines.push('');
  lines.push('## 入口');
  lines.push(`- 今日工作包：[[${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${dateKey}|daily-workpack-${dateKey}]]`);
  lines.push(`- AI 交接简报：[[${TEAM_SCHEDULE_DIR}/ai-handoff|ai-handoff]]`);
  lines.push(`- 里程碑路线图：[[${TEAM_SCHEDULE_DIR}/roadmaps/${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}|${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 叙事导演台：[[${TEAM_SCHEDULE_DIR}/narrative-director|narrative-director]]`);
  lines.push(`- 周计划：[[${TEAM_SCHEDULE_DIR}/sprints/${teamSprintPlanFileName(date).replace(/\.md$/i, '')}|${teamSprintPlanFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 验收复查队列：[[${TEAM_SCHEDULE_DIR}/reviews/review-queue-${dateKey}|review-queue-${dateKey}]]`);
  lines.push(`- 团队首页：[[${TEAM_SCHEDULE_DIR}/team-dashboard|team-dashboard]]`);
  lines.push('');
  lines.push('## 影响面总览');
  lines.push('| 领域 | 文档 | 活跃任务 | 未映射文档 | 下游必须复查 |');
  lines.push('| --- | ---: | ---: | ---: | --- |');
  for (const stage of stages) {
    const stageDocs = productionDocs.filter((doc) => inferTeamChangeImpactStageFromText(doc) === stage);
    const stageTasks = activeTasks.filter((task: any) => inferTeamTaskImpactStage(task) === stage);
    const unmappedCount = stageDocs.filter((doc) => !linkedDocSet.has(normalizeTeamSchedulePath(doc).replace(/\.md$/i, '').toLowerCase())).length;
    const downstream = TEAM_CHANGE_IMPACT_DOWNSTREAM[stage].map((item) => TEAM_CHANGE_IMPACT_STAGE_LABELS[item]).join(' -> ');
    lines.push([
      TEAM_CHANGE_IMPACT_STAGE_LABELS[stage],
      stageDocs.length,
      stageTasks.length,
      unmappedCount,
      downstream || '-',
    ].map(teamMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  lines.push('');
  lines.push('## 今日必须处理');
  lines.push(`- 缺任务文档：${missingDocTasks.length}；缺验收标准：${missingAcceptanceTasks.length}；最近被退回：${returnedTasks.length}；未映射生产文档：${unmappedDocs.length}。`);
  if (Array.isArray(health?.recommendations) && health.recommendations.length > 0) {
    for (const item of health.recommendations.slice(0, 5)) lines.push(`- 健康扫描：${compactTeamReportText(item, 180)}`);
  }
  lines.push('');
  lines.push('## 任务影响队列');
  if (impactQueue.length === 0) {
    lines.push('- 暂无需要追踪的活跃影响项。');
  } else {
    lines.push('| 领域 | 负责人 | 状态 | 截止 | 任务 | 文档 | 最近验收 | 必须同步 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const task of impactQueue) {
      const stage = inferTeamTaskImpactStage(task);
      const latestReview = latestTeamReviewLog(task);
      const docStatus = teamTaskDocumentStatus(task, documentPathSet);
      const checks = [
        docStatus !== 'linked' ? '补任务文档/链接' : '',
        !normalizeTeamScheduleText(task?.acceptance) ? '补验收标准' : '',
        latestReview && normalizeTeamReviewResult(latestReview?.result || latestReview?.status || latestReview?.conclusion) === 'changes' ? '先处理退回意见' : '',
        `复查：${TEAM_CHANGE_IMPACT_DOWNSTREAM[stage].slice(0, 4).map((item) => TEAM_CHANGE_IMPACT_STAGE_LABELS[item]).join(' / ')}`,
      ].filter(Boolean);
      lines.push([
        TEAM_CHANGE_IMPACT_STAGE_LABELS[stage],
        normalizeTeamScheduleText(task?.owner) || '未分配',
        normalizeTeamTaskStatus(task?.status),
        normalizeTeamScheduleDate(task?.dueDate) || '-',
        normalizeTeamScheduleText(task?.title) || '-',
        teamDocWikiLink(task?.linkedDoc),
        latestReview ? teamReviewLogSummary(latestReview) : '-',
        checks.join('；'),
      ].map(teamMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  lines.push('## 未映射生产文档');
  if (unmappedDocs.length === 0) {
    lines.push('- 所有识别到的生产文档都已经和任务表有显式映射，继续保持。');
  } else {
    for (const doc of unmappedDocs.slice(0, 40)) {
      const stage = inferTeamChangeImpactStageFromText(doc);
      lines.push(`- ${TEAM_CHANGE_IMPACT_STAGE_LABELS[stage]}：${teamDocWikiLink(doc)} -> 需要确认是否补入 NarrativeTaskTable 或团队时间表。`);
    }
  }
  lines.push('');
  lines.push('## AI 接管检查清单');
  lines.push('- [ ] 读最新世界观/剧情/任务/台词/演出改动，确认下游影响。');
  lines.push('- [ ] 把会影响制作的改动写进 NarrativeTaskTable 或团队时间表。');
  lines.push('- [ ] 给受影响成员生成/刷新成员任务页，并补齐 linkedDoc、deliverable、acceptance。');
  lines.push('- [ ] 被退回或缺验收的任务不要标完成，先写清复查口径。');
  lines.push('- [ ] 涉及 AI 记忆或 AI skill 的沉淀，写进 `.ai-memory/MEMORY.md` 或 `.ai-memory/skills/*.md`，这些文件会跟随 Vault 同步到其他电脑。');
  return lines.join('\n');
}

function buildTeamDecisionLogPage(vaultPath: string, schedule: any, health: any, date = teamTodayString()): string {
  const tasks = Array.isArray(schedule?.tasks) ? schedule.tasks : [];
  const activeTasks = teamReportTaskSort(tasks.filter((task: any) => normalizeTeamTaskStatus(task?.status) !== 'done'));
  const documentPaths = collectProductionMarkdownFiles(vaultPath, 1200);
  const documentPathSet = new Set<string>();
  for (const doc of documentPaths) {
    const lower = normalizeTeamSchedulePath(doc).toLowerCase();
    documentPathSet.add(lower);
    documentPathSet.add(lower.replace(/\.md$/i, ''));
  }
  const ownerMissing = (task: any) => {
    const owner = normalizeTeamScheduleText(task?.owner);
    return !owner || /未分配|unassigned/i.test(owner);
  };
  const isPastDue = (task: any) => {
    const due = normalizeTeamScheduleDate(task?.dueDate);
    return Boolean(due && normalizeTeamTaskStatus(task?.status) !== 'done' && due < date);
  };
  const returnedTasks = activeTasks.filter((task: any) => {
    const latest = latestTeamReviewLog(task);
    return latest && normalizeTeamReviewResult(latest?.result || latest?.status || latest?.conclusion) === 'changes';
  });
  const blockedTasks = activeTasks.filter((task: any) => normalizeTeamTaskStatus(task?.status) === 'blocked' || normalizeTeamScheduleText(task?.blocker));
  const overdueTasks = activeTasks.filter(isPastDue);
  const missingOwnerTasks = activeTasks.filter(ownerMissing);
  const missingDueTasks = activeTasks.filter((task: any) => !normalizeTeamScheduleDate(task?.dueDate));
  const missingDocTasks = activeTasks.filter((task: any) => teamTaskDocumentStatus(task, documentPathSet) !== 'linked');
  const missingAcceptanceTasks = activeTasks.filter((task: any) => !normalizeTeamScheduleText(task?.acceptance));
  const dependencyTasks = activeTasks.filter((task: any) => normalizeTeamScheduleText(task?.dependency));
  const reviewTasks = activeTasks.filter((task: any) => normalizeTeamTaskStatus(task?.status) === 'review');
  const decisionTasks = teamReportTaskSort(Array.from(new Map([
    ...returnedTasks,
    ...blockedTasks,
    ...overdueTasks,
    ...missingOwnerTasks,
    ...missingDueTasks,
    ...missingDocTasks,
    ...missingAcceptanceTasks,
    ...dependencyTasks,
    ...reviewTasks,
  ].map((task: any) => [normalizeTeamScheduleText(task?.id) || teamTaskKey(task), task])).values())).slice(0, 100);
  const dateKey = date.replace(/-/g, '');

  const decisionType = (task: any): string => {
    const latest = latestTeamReviewLog(task);
    const reviewResult = latest ? normalizeTeamReviewResult(latest?.result || latest?.status || latest?.conclusion) : '';
    if (reviewResult === 'changes') return '返工决策';
    if (normalizeTeamTaskStatus(task?.status) === 'blocked' || normalizeTeamScheduleText(task?.blocker)) return '阻塞决策';
    if (isPastDue(task)) return '延期/拆分决策';
    if (ownerMissing(task)) return '负责人决策';
    if (!normalizeTeamScheduleDate(task?.dueDate)) return '排期决策';
    if (teamTaskDocumentStatus(task, documentPathSet) !== 'linked') return '文档决策';
    if (!normalizeTeamScheduleText(task?.acceptance)) return '验收决策';
    if (normalizeTeamTaskStatus(task?.status) === 'review') return '验收通过决策';
    if (normalizeTeamScheduleText(task?.dependency)) return '依赖决策';
    return '制作决策';
  };

  const decisionEvidence = (task: any): string => {
    const latest = latestTeamReviewLog(task);
    const docStatus = teamTaskDocumentStatus(task, documentPathSet);
    const due = normalizeTeamScheduleDate(task?.dueDate);
    const evidence = [
      normalizeTeamScheduleText(task?.blocker) ? `阻塞：${compactTeamReportText(task?.blocker, 80)}` : '',
      normalizeTeamScheduleText(task?.dependency) ? `依赖：${compactTeamReportText(task?.dependency, 80)}` : '',
      latest ? `验收：${compactTeamReportText(teamReviewLogSummary(latest), 90)}` : '',
      due && due < date ? `已逾期：${due}` : '',
      ownerMissing(task) ? '缺负责人' : '',
      !due ? '缺截止日期' : '',
      docStatus !== 'linked' ? `文档：${docStatus}` : '',
      !normalizeTeamScheduleText(task?.acceptance) ? '缺验收标准' : '',
    ].filter(Boolean);
    return evidence.join('；') || '需要制作人确认下一步';
  };

  const suggestedDecision = (task: any): string => {
    const latest = latestTeamReviewLog(task);
    const reviewResult = latest ? normalizeTeamReviewResult(latest?.result || latest?.status || latest?.conclusion) : '';
    if (reviewResult === 'changes') return '决定返工范围、复查人、复查日期，并写回任务文档';
    if (normalizeTeamTaskStatus(task?.status) === 'blocked' || normalizeTeamScheduleText(task?.blocker)) return '决定解除阻塞的人、资源和最晚处理时间';
    if (isPastDue(task)) return '决定延期、拆分、降级，或只保留最小可交付范围';
    if (ownerMissing(task)) return '指定负责人，并生成成员任务页';
    if (!normalizeTeamScheduleDate(task?.dueDate)) return '排进本周、下周、搁置或归档';
    if (teamTaskDocumentStatus(task, documentPathSet) !== 'linked') return '生成或修复 linkedDoc，让成员能直接打开工作页';
    if (!normalizeTeamScheduleText(task?.acceptance)) return '补验收标准，避免完成口径不一致';
    if (normalizeTeamTaskStatus(task?.status) === 'review') return '决定通过、退回或补测，并记录验收日志';
    if (normalizeTeamScheduleText(task?.dependency)) return '确认依赖上游是否已经可用，不可用则拆分等待项';
    return '确认下一步负责人、截止和验收方式';
  };

  const lines: string[] = [];
  lines.push('---');
  lines.push('type: ars-team-decision-log');
  lines.push(`date: ${JSON.stringify(date)}`);
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push(`scheduleUpdatedAt: ${JSON.stringify(schedule.updatedAt || '')}`);
  lines.push(`schedule: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`)}`);
  lines.push('tags:');
  lines.push('  - decision-log');
  lines.push('  - production');
  lines.push('  - game-dev');
  lines.push('---');
  lines.push('');
  lines.push(`# 制作决策日志 - ${date}`);
  lines.push('');
  lines.push('> 这里集中处理需要制作人或 AI 拍板的事项：阻塞、逾期、返工、缺负责人、缺排期、缺文档、缺验收。每天先清这里，再让成员开始执行。');
  lines.push('');
  lines.push('## 入口');
  lines.push(`- AI 交接简报：[[${TEAM_SCHEDULE_DIR}/ai-handoff|ai-handoff]]`);
  lines.push(`- 团队首页：[[${TEAM_SCHEDULE_DIR}/team-dashboard|team-dashboard]]`);
  lines.push(`- 今日工作包：[[${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${dateKey}|daily-workpack-${dateKey}]]`);
  lines.push(`- 里程碑路线图：[[${TEAM_SCHEDULE_DIR}/roadmaps/${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}|${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 变更影响表：[[${TEAM_SCHEDULE_DIR}/changes/${teamChangeImpactFileName(date).replace(/\.md$/i, '')}|${teamChangeImpactFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 阻塞交接：[[${TEAM_SCHEDULE_DIR}/handoffs/blocker-handoff-${dateKey}|blocker-handoff-${dateKey}]]`);
  lines.push(`- 验收队列：[[${TEAM_SCHEDULE_DIR}/reviews/review-queue-${dateKey}|review-queue-${dateKey}]]`);
  lines.push(`- 周计划：[[${TEAM_SCHEDULE_DIR}/sprints/${teamSprintPlanFileName(date).replace(/\.md$/i, '')}|${teamSprintPlanFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push('');
  lines.push('## 决策总览');
  lines.push('| 指标 | 数量 |');
  lines.push('| --- | ---: |');
  lines.push(`| 需要决策 | ${decisionTasks.length} |`);
  lines.push(`| 阻塞 | ${blockedTasks.length} |`);
  lines.push(`| 逾期 | ${overdueTasks.length} |`);
  lines.push(`| 返工/退回 | ${returnedTasks.length} |`);
  lines.push(`| 缺负责人 | ${missingOwnerTasks.length} |`);
  lines.push(`| 缺排期 | ${missingDueTasks.length} |`);
  lines.push(`| 缺任务文档 | ${missingDocTasks.length} |`);
  lines.push(`| 缺验收标准 | ${missingAcceptanceTasks.length} |`);
  lines.push('');
  if (Array.isArray(health?.recommendations) && health.recommendations.length > 0) {
    lines.push('## 健康扫描提醒');
    for (const item of health.recommendations.slice(0, 6)) lines.push(`- ${compactTeamReportText(item, 180)}`);
    lines.push('');
  }
  lines.push('## 今日决策队列');
  if (decisionTasks.length === 0) {
    lines.push('- 暂无需要拍板的制作事项。');
  } else {
    lines.push('| 决策类型 | 负责人 | 优先级 | 状态 | 截止 | 任务 | 文档 | 证据 | 建议决定 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const task of decisionTasks) {
      lines.push([
        decisionType(task),
        normalizeTeamScheduleText(task?.owner) || '未分配',
        normalizeTeamTaskPriority(task?.priority),
        normalizeTeamTaskStatus(task?.status),
        normalizeTeamScheduleDate(task?.dueDate) || '-',
        normalizeTeamScheduleText(task?.title) || '-',
        teamDocWikiLink(task?.linkedDoc),
        decisionEvidence(task),
        suggestedDecision(task),
      ].map(teamMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  lines.push('## 返工与验收');
  if (returnedTasks.length === 0 && reviewTasks.length === 0) {
    lines.push('- 暂无退回或等待验收的任务。');
  } else {
    for (const task of teamReportTaskSort(Array.from(new Map([...returnedTasks, ...reviewTasks].map((item: any) => [normalizeTeamScheduleText(item?.id) || teamTaskKey(item), item])).values())).slice(0, 32)) {
      const latest = latestTeamReviewLog(task);
      lines.push(`- [ ] ${normalizeTeamScheduleText(task?.title) || '-'}：${latest ? teamReviewLogSummary(latest) : '等待验收'}；决定：通过 / 退回 / 补测 / 延期`);
    }
  }
  lines.push('');
  lines.push('## 会议记录模板');
  lines.push('- [ ] 决定：');
  lines.push('- [ ] 原因/证据：');
  lines.push('- [ ] 负责人：');
  lines.push('- [ ] 截止时间：');
  lines.push('- [ ] 写回位置：任务表 / 成员页 / 任务文档 / 变更影响表 / AI 记忆或 skill');
  lines.push('');
  lines.push('## AI 接管规则');
  lines.push('- [ ] 如果决策影响世界观、剧情、任务、台词、演出或实现，刷新变更影响表和叙事导演台。');
  lines.push('- [ ] 如果决策会改变长期判断，写入 `.ai-memory/MEMORY.md`；如果沉淀成可复用方法，写入 `.ai-memory/skills/*.md`，这些文件会随 Vault 同步到其他电脑。');
  lines.push('- [ ] 决策后必须刷新成员任务页、今日工作包、路线图和团队首页，避免其他电脑看到旧流程。');
  return lines.join('\n');
}

function buildTeamMilestoneRoadmapPage(vaultPath: string, schedule: any, health: any, date = teamTodayString()): string {
  const tasks = Array.isArray(schedule?.tasks) ? schedule.tasks : [];
  const activeTasks = teamReportTaskSort(tasks.filter((task: any) => normalizeTeamTaskStatus(task.status) !== 'done'));
  const doneTasks = tasks.filter((task: any) => normalizeTeamTaskStatus(task.status) === 'done');
  const documentPaths = collectProductionMarkdownFiles(vaultPath, 1200);
  const documentPathSet = new Set<string>();
  for (const doc of documentPaths) {
    const lower = normalizeTeamSchedulePath(doc).toLowerCase();
    documentPathSet.add(lower);
    documentPathSet.add(lower.replace(/\.md$/i, ''));
  }
  const weekStart = teamWeekStartString(date);
  const weekEnd = teamWeekEndString(date);
  const nextWeekStart = teamDateOffset(weekEnd, 1);
  const nextWeekEnd = teamDateOffset(weekEnd, 7);
  const fourWeekEnd = teamDateOffset(date, 28);
  const dateKey = date.replace(/-/g, '');
  const remainingMinutes = (task: any) => Math.max(parseTeamScheduleMinutes(task?.estimateMinutes) - taskSpentMinutesForBrief(task), 0);
  const bucketRows: Array<{ title: string; window: string; tasks: any[]; action: string }> = [
    { title: '逾期', window: `早于 ${date}`, tasks: activeTasks.filter((task: any) => normalizeTeamScheduleDate(task?.dueDate) && normalizeTeamScheduleDate(task?.dueDate) < date), action: '先确认延期、最小可交付范围和是否需要拆分。' },
    { title: '本周', window: `${weekStart} 至 ${weekEnd}`, tasks: activeTasks.filter((task: any) => normalizeTeamScheduleDate(task?.dueDate) >= weekStart && normalizeTeamScheduleDate(task?.dueDate) <= weekEnd), action: '锁定本周完成口径，阻塞当天处理。' },
    { title: '下周', window: `${nextWeekStart} 至 ${nextWeekEnd}`, tasks: activeTasks.filter((task: any) => normalizeTeamScheduleDate(task?.dueDate) >= nextWeekStart && normalizeTeamScheduleDate(task?.dueDate) <= nextWeekEnd), action: '提前补文档、验收和依赖，避免下周开工才发现缺口。' },
    { title: '四周内', window: `${date} 至 ${fourWeekEnd}`, tasks: activeTasks.filter((task: any) => normalizeTeamScheduleDate(task?.dueDate) > nextWeekEnd && normalizeTeamScheduleDate(task?.dueDate) <= fourWeekEnd), action: '检查里程碑容量，确认高优先级任务是否有负责人和排期。' },
    { title: '未来', window: `晚于 ${fourWeekEnd}`, tasks: activeTasks.filter((task: any) => normalizeTeamScheduleDate(task?.dueDate) > fourWeekEnd), action: '保留方向，等前置文档和风险更清晰后再细排。' },
    { title: '未排期', window: '无截止日期', tasks: activeTasks.filter((task: any) => !normalizeTeamScheduleDate(task?.dueDate)), action: '决定是排期、搁置、拆分，还是归档。' },
  ];
  const members = teamScheduleMembers(schedule);
  const memberRows = members.map((member: string) => {
    const owned = activeTasks.filter((task: any) => normalizeTeamScheduleText(task?.owner) === member);
    return {
      member,
      active: owned.length,
      overdue: owned.filter((task: any) => normalizeTeamScheduleDate(task?.dueDate) && normalizeTeamScheduleDate(task?.dueDate) < date).length,
      blocked: owned.filter((task: any) => normalizeTeamTaskStatus(task?.status) === 'blocked').length,
      thisWeek: owned.filter((task: any) => normalizeTeamScheduleDate(task?.dueDate) >= weekStart && normalizeTeamScheduleDate(task?.dueDate) <= weekEnd).length,
      remaining: owned.reduce((sum: number, task: any) => sum + remainingMinutes(task), 0),
      missingDoc: owned.filter((task: any) => teamTaskDocumentStatus(task, documentPathSet) !== 'linked').length,
      missingAcceptance: owned.filter((task: any) => !normalizeTeamScheduleText(task?.acceptance)).length,
    };
  }).sort((a: any, b: any) => b.overdue - a.overdue || b.blocked - a.blocked || b.thisWeek - a.thisWeek || b.remaining - a.remaining || a.member.localeCompare(b.member, 'zh-CN'));
  const missingOwnerTasks = activeTasks.filter((task: any) => !normalizeTeamScheduleText(task?.owner) || normalizeTeamScheduleText(task?.owner) === '未分配');
  const missingDocTasks = activeTasks.filter((task: any) => teamTaskDocumentStatus(task, documentPathSet) !== 'linked');
  const missingAcceptanceTasks = activeTasks.filter((task: any) => !normalizeTeamScheduleText(task?.acceptance));
  const noEstimateTasks = activeTasks.filter((task: any) => !parseTeamScheduleMinutes(task?.estimateMinutes));
  const totalRemaining = activeTasks.reduce((sum: number, task: any) => sum + remainingMinutes(task), 0);

  const lines: string[] = [];
  lines.push('---');
  lines.push('type: ars-team-milestone-roadmap');
  lines.push(`date: ${JSON.stringify(date)}`);
  lines.push(`weekStart: ${JSON.stringify(weekStart)}`);
  lines.push(`weekEnd: ${JSON.stringify(weekEnd)}`);
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push(`scheduleUpdatedAt: ${JSON.stringify(schedule.updatedAt || '')}`);
  lines.push(`schedule: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`)}`);
  lines.push('tags:');
  lines.push('  - milestone-roadmap');
  lines.push('  - production');
  lines.push('  - game-dev');
  lines.push('---');
  lines.push('');
  lines.push(`# 里程碑路线图 - ${date}`);
  lines.push('');
  lines.push(`> 自动从 \`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}\` 和制作健康扫描生成。用途：制作人和 AI 用它判断今天、本周、下周和四周内的交付压力，避免团队只看单日任务而看不到里程碑风险。`);
  lines.push('');
  lines.push('## 入口');
  lines.push(`- 团队首页：[[${TEAM_SCHEDULE_DIR}/team-dashboard|team-dashboard]]`);
  lines.push(`- 今日工作包：[[${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${dateKey}|daily-workpack-${dateKey}]]`);
  lines.push(`- 周计划：[[${TEAM_SCHEDULE_DIR}/sprints/${teamSprintPlanFileName(date).replace(/\.md$/i, '')}|${teamSprintPlanFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 变更影响表：[[${TEAM_SCHEDULE_DIR}/changes/${teamChangeImpactFileName(date).replace(/\.md$/i, '')}|${teamChangeImpactFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 验收复查队列：[[${TEAM_SCHEDULE_DIR}/reviews/review-queue-${dateKey}|review-queue-${dateKey}]]`);
  lines.push(`- 依赖图：[[${TEAM_SCHEDULE_DIR}/dependency-map|dependency-map]]`);
  lines.push('');
  lines.push('## 总览');
  lines.push('| 指标 | 数量 |');
  lines.push('| --- | ---: |');
  lines.push(`| 活跃任务 | ${activeTasks.length} |`);
  lines.push(`| 已完成任务 | ${doneTasks.length} |`);
  lines.push(`| 逾期 | ${bucketRows[0].tasks.length} |`);
  lines.push(`| 本周到期 | ${bucketRows[1].tasks.length} |`);
  lines.push(`| 下周到期 | ${bucketRows[2].tasks.length} |`);
  lines.push(`| 未排期 | ${bucketRows[5].tasks.length} |`);
  lines.push(`| 剩余预估 | ${formatTeamMinutes(totalRemaining)} |`);
  lines.push(`| 缺负责人 | ${missingOwnerTasks.length} |`);
  lines.push(`| 缺任务文档 | ${missingDocTasks.length} |`);
  lines.push(`| 缺验收标准 | ${missingAcceptanceTasks.length} |`);
  lines.push(`| 未估时 | ${noEstimateTasks.length} |`);
  lines.push('');
  if (Array.isArray(health?.recommendations) && health.recommendations.length > 0) {
    lines.push('## 健康扫描建议');
    for (const item of health.recommendations.slice(0, 6)) lines.push(`- ${compactTeamReportText(item, 180)}`);
    lines.push('');
  }
  lines.push('## 里程碑分组');
  lines.push('| 阶段 | 时间窗口 | 任务 | 高优先级 | 阻塞 | 剩余工时 | 制作动作 |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | --- |');
  for (const row of bucketRows) {
    lines.push([
      row.title,
      row.window,
      row.tasks.length,
      row.tasks.filter((task) => normalizeTeamTaskPriority(task?.priority) === 'high').length,
      row.tasks.filter((task) => normalizeTeamTaskStatus(task?.status) === 'blocked').length,
      formatTeamMinutes(row.tasks.reduce((sum, task) => sum + remainingMinutes(task), 0)),
      row.action,
    ].map(teamMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }
  lines.push('');
  for (const row of bucketRows.filter((bucket) => bucket.tasks.length > 0)) {
    lines.push(`## ${row.title}任务`);
    lines.push('| 负责人 | 状态 | 优先级 | 截止 | 任务 | 文档 | 风险 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const task of teamReportTaskSort(row.tasks).slice(0, 24)) {
      const due = normalizeTeamScheduleDate(task?.dueDate);
      const risks = [
        due && due < date ? '逾期' : '',
        normalizeTeamTaskStatus(task?.status) === 'blocked' ? '阻塞' : '',
        !normalizeTeamScheduleText(task?.owner) || normalizeTeamScheduleText(task?.owner) === '未分配' ? '缺负责人' : '',
        teamTaskDocumentStatus(task, documentPathSet) !== 'linked' ? '缺文档' : '',
        !normalizeTeamScheduleText(task?.acceptance) ? '缺验收' : '',
        !parseTeamScheduleMinutes(task?.estimateMinutes) ? '未估时' : '',
      ].filter(Boolean).join(' / ') || '正常';
      lines.push([
        normalizeTeamScheduleText(task?.owner) || '未分配',
        normalizeTeamTaskStatus(task?.status),
        normalizeTeamTaskPriority(task?.priority),
        due || '-',
        normalizeTeamScheduleText(task?.title) || '-',
        teamDocWikiLink(task?.linkedDoc),
        risks,
      ].map(teamMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
    lines.push('');
  }
  lines.push('## 成员容量');
  if (memberRows.length === 0) {
    lines.push('- 暂无成员任务。');
  } else {
    lines.push('| 成员 | 活跃 | 本周 | 逾期 | 阻塞 | 剩余 | 缺文档 | 缺验收 | 成员页 |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
    for (const row of memberRows) {
      lines.push([
        row.member,
        row.active,
        row.thisWeek,
        row.overdue,
        row.blocked,
        formatTeamMinutes(row.remaining),
        row.missingDoc,
        row.missingAcceptance,
        teamMemberPageLink(row.member),
      ].map(teamMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  lines.push('## AI 接管路线');
  lines.push('- [ ] 先处理逾期和阻塞，明确延期原因、最小可交付范围和负责人。');
  lines.push('- [ ] 本周任务必须有 linkedDoc、acceptance、estimateMinutes，缺一项就补齐。');
  lines.push('- [ ] 下周任务提前补依赖、文档和验收，避免临近时临时拆需求。');
  lines.push('- [ ] 未排期任务要决定：排进本周/下周、拆小、降级或归档。');
  lines.push('- [ ] 每次批量变更世界观、剧情、任务、台词、演出或实现后，刷新变更影响表。');
  return lines.join('\n');
}

function buildTeamSprintPlanPage(vaultPath: string, schedule: any, health: any, date = teamTodayString()): string {
  const activeTasks = teamReportTaskSort((schedule.tasks || []).filter((task: any) => normalizeTeamTaskStatus(task.status) !== 'done'));
  const weekStart = teamWeekStartString(date);
  const weekEnd = teamWeekEndString(date);
  const sprintName = teamSprintPlanFileName(date);
  const dateKey = date.replace(/-/g, '');
  const focus = health?.focus || {};
  const memberLoad = Array.isArray(health?.memberLoad) ? health.memberLoad : buildTeamMemberLoadRows(vaultPath, schedule, date);
  const qaItems = Array.isArray(focus?.qa) ? focus.qa : [];
  const narrativeGaps = health?.focus?.narrativeGaps || {};
  const blockedTasks = activeTasks.filter((task: any) => normalizeTeamTaskStatus(task.status) === 'blocked' || normalizeTeamScheduleText(task.blocker));
  const overdueTasks = activeTasks.filter((task: any) => {
    const due = normalizeTeamScheduleDate(task.dueDate);
    return due && due < date;
  });
  const dueThisWeek = activeTasks.filter((task: any) => {
    const due = normalizeTeamScheduleDate(task.dueDate);
    return due && due >= weekStart && due <= weekEnd;
  });
  const reviewTasks = activeTasks.filter((task: any) => normalizeTeamTaskStatus(task.status) === 'review');
  const highPriority = activeTasks.filter((task: any) => normalizeTeamTaskPriority(task.priority) === 'high');
  const missingDocs = activeTasks.filter((task: any) => !normalizeTeamSchedulePath(task.linkedDoc) || !linkedTeamDocExists(vaultPath, task.linkedDoc));
  const missingAcceptance = activeTasks.filter((task: any) => !normalizeTeamScheduleText(task.acceptance));
  const sprintTasks = teamReportTaskSort(Array.from(new Map([
    ...blockedTasks,
    ...overdueTasks,
    ...dueThisWeek,
    ...reviewTasks,
    ...highPriority.filter((task: any) => !normalizeTeamScheduleDate(task.dueDate) || teamDueWithinDays(task.dueDate, 14, date)),
    ...activeTasks.filter((task: any) => normalizeTeamTaskStatus(task.status) === 'doing'),
  ].map((task: any) => [normalizeTeamScheduleText(task.id) || teamTaskKey(task), task] as const)).values())).slice(0, 70);
  const plannedRemainingMinutes = sprintTasks.reduce((sum: number, task: any) => (
    sum + Math.max(parseTeamScheduleMinutes(task.estimateMinutes) - taskSpentMinutesForBrief(task), 0)
  ), 0);
  const plannedSpentMinutes = sprintTasks.reduce((sum: number, task: any) => sum + taskSpentMinutesForBrief(task), 0);

  const sprintReason = (task: any): string => {
    const due = normalizeTeamScheduleDate(task.dueDate);
    const flags = [
      normalizeTeamTaskStatus(task.status) === 'blocked' || normalizeTeamScheduleText(task.blocker) ? '阻塞' : '',
      due && due < date ? '逾期' : '',
      due && due >= weekStart && due <= weekEnd ? '本周到期' : '',
      normalizeTeamTaskStatus(task.status) === 'review' ? '待验收' : '',
      normalizeTeamTaskPriority(task.priority) === 'high' ? '高优先级' : '',
      normalizeTeamSchedulePath(task.linkedDoc) && linkedTeamDocExists(vaultPath, task.linkedDoc) ? '' : '缺文档',
      normalizeTeamScheduleText(task.acceptance) ? '' : '缺验收',
    ].filter(Boolean);
    return flags.length ? flags.join(' / ') : normalizeTeamTaskStatus(task.status);
  };

  const lines: string[] = [];
  lines.push('---');
  lines.push('type: ars-team-sprint-plan');
  lines.push(`date: ${JSON.stringify(date)}`);
  lines.push(`weekStart: ${JSON.stringify(weekStart)}`);
  lines.push(`weekEnd: ${JSON.stringify(weekEnd)}`);
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push(`scheduleUpdatedAt: ${JSON.stringify(schedule.updatedAt || '')}`);
  lines.push('tags:');
  lines.push('  - sprint-plan');
  lines.push('  - production');
  lines.push('  - game-dev');
  lines.push('---');
  lines.push('');
  lines.push(`# 周计划 / Sprint 计划 - ${weekStart} 至 ${weekEnd}`);
  lines.push('');
  lines.push(`> 自动从 \`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}\` 和制作健康扫描生成。用途：每周开工前确定本周范围、成员分工、风险处理和验收口径。`);
  lines.push('');
  lines.push('## 入口');
  lines.push(`- 今日工作包：[[${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${dateKey}|daily-workpack-${dateKey}]]`);
  lines.push(`- 今日工时表：[[${TEAM_SCHEDULE_DIR}/timesheets/timesheet-${dateKey}|timesheet-${dateKey}]]`);
  lines.push(`- AI 交接简报：[[${TEAM_SCHEDULE_DIR}/ai-handoff|ai-handoff]]`);
  lines.push(`- 里程碑路线图：[[${TEAM_SCHEDULE_DIR}/roadmaps/${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}|${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 叙事导演台：[[${TEAM_SCHEDULE_DIR}/narrative-director|narrative-director]]`);
  lines.push(`- 阻塞交接清单：[[${TEAM_SCHEDULE_DIR}/handoffs/blocker-handoff-${dateKey}|blocker-handoff-${dateKey}]]`);
  lines.push(`- 验收复查队列：[[${TEAM_SCHEDULE_DIR}/reviews/review-queue-${dateKey}|review-queue-${dateKey}]]`);
  lines.push(`- 变更影响表：[[${TEAM_SCHEDULE_DIR}/changes/${teamChangeImpactFileName(date).replace(/\.md$/i, '')}|${teamChangeImpactFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 依赖图：[[${TEAM_SCHEDULE_DIR}/dependency-map|dependency-map]]`);
  lines.push(`- 本周计划文件：[[${TEAM_SCHEDULE_DIR}/sprints/${sprintName}|${sprintName.replace(/\.md$/i, '')}]]`);
  lines.push('');
  lines.push('## 本周判断');
  lines.push('| 指标 | 数量 |');
  lines.push('| --- | ---: |');
  lines.push(`| 本周纳入任务 | ${sprintTasks.length} |`);
  lines.push(`| 本周到期 | ${dueThisWeek.length} |`);
  lines.push(`| 阻塞 | ${blockedTasks.length} |`);
  lines.push(`| 逾期 | ${overdueTasks.length} |`);
  lines.push(`| 待验收 | ${reviewTasks.length} |`);
  lines.push(`| 缺文档 | ${missingDocs.length} |`);
  lines.push(`| 缺验收 | ${missingAcceptance.length} |`);
  lines.push(`| QA/Bug/试玩反馈 | ${health?.stats?.qaOpen || 0} |`);
  lines.push(`| 叙事缺阶段 | ${health?.stats?.narrativeMissingStages || 0} |`);
  lines.push(`| 计划剩余工时 | ${formatTeamMinutes(plannedRemainingMinutes)} |`);
  lines.push(`| 已记录工时 | ${formatTeamMinutes(plannedSpentMinutes)} |`);
  lines.push('');
  lines.push('## 本周目标草案');
  lines.push('- [ ] 先清掉阻塞和逾期任务，避免团队继续等人或等文档。');
  lines.push('- [ ] 本周到期任务必须有负责人、文档入口、验收标准和复查方式。');
  lines.push('- [ ] 待验收任务进入验收队列，失败项退回进行中并写清原因。');
  lines.push('- [ ] QA/Bug/试玩反馈纳入本周修复或复测，不作为“额外事项”遗忘。');
  lines.push('- [ ] 如果叙事链路有缺口，先补 `NarrativePipeline` / `NarrativeTaskTable` 再继续堆内容。');
  lines.push('');
  lines.push('## 本周任务范围');
  if (sprintTasks.length === 0) {
    lines.push('- 当前没有自动纳入本周计划的活跃任务。');
  } else {
    lines.push('| 纳入原因 | 负责人 | 状态 | 优先级 | 截止 | 任务 | 文档 | 本周动作 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const task of sprintTasks) {
      lines.push([
        sprintReason(task),
        normalizeTeamScheduleText(task.owner) || '未分配',
        normalizeTeamTaskStatus(task.status),
        normalizeTeamTaskPriority(task.priority),
        normalizeTeamScheduleDate(task.dueDate) || '-',
        normalizeTeamScheduleText(task.title),
        teamDocWikiLink(task.linkedDoc),
        teamWorkpackNextAction(task, vaultPath, date),
      ].map(teamMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  lines.push('## 按成员分工');
  if (memberLoad.length === 0) {
    lines.push('- 暂无成员负载数据。');
  } else {
    for (const row of memberLoad.slice(0, 18)) {
      const owned = sprintTasks.filter((task: any) => normalizeTeamScheduleText(task.owner) === normalizeTeamScheduleText(row.member));
      lines.push(`### ${normalizeTeamScheduleText(row.member)}`);
      lines.push(`- 负载：${row.label || teamMemberLoadLabel(row.level)}；剩余：${formatTeamMinutes(row.remainingMinutes || 0)}；建议：${row.recommendation || '-'}`);
      if (Array.isArray(row.reasons) && row.reasons.length) lines.push(`- 风险：${row.reasons.slice(0, 5).join(' / ')}`);
      if (owned.length === 0) {
        lines.push('- 本周计划中暂无明确任务。');
      } else {
        for (const task of owned.slice(0, 10)) {
          lines.push(`- [ ] ${normalizeTeamScheduleText(task.title)}（${sprintReason(task)}）`);
          lines.push(`  - 入口：${teamDocWikiLink(task.linkedDoc)}；截止：${normalizeTeamScheduleDate(task.dueDate) || '-'}；动作：${teamWorkpackNextAction(task, vaultPath, date)}`);
        }
      }
      lines.push('');
    }
  }
  lines.push('## 风险处理');
  const riskTasks = teamReportTaskSort(Array.from(new Map([
    ...blockedTasks,
    ...overdueTasks,
    ...missingDocs,
    ...missingAcceptance,
  ].map((task: any) => [normalizeTeamScheduleText(task.id) || teamTaskKey(task), task] as const)).values())).slice(0, 24);
  if (riskTasks.length === 0) {
    lines.push('- 暂无明显计划风险。');
  } else {
    for (const task of riskTasks) {
      lines.push(`- ${sprintReason(task)}：${normalizeTeamScheduleText(task.title)}（${normalizeTeamScheduleText(task.owner) || '未分配'}）`);
      lines.push(`  - 处理：${teamWorkpackNextAction(task, vaultPath, date)}；文档：${teamDocWikiLink(task.linkedDoc)}`);
    }
  }
  lines.push('');
  lines.push('## QA / 叙事专项');
  if (qaItems.length === 0 && (!Array.isArray(narrativeGaps?.missingStages) || narrativeGaps.missingStages.length === 0) && (!Array.isArray(narrativeGaps?.weakLinks) || narrativeGaps.weakLinks.length === 0)) {
    lines.push('- 暂无需要单独拉出来的 QA 或叙事链路事项。');
  } else {
    for (const item of qaItems.slice(0, 8)) {
      lines.push(`- QA：${compactTeamReportText(item.title || item.text || 'QA item', 150)}；入口：${item.relativePath ? teamDocWikiLink(item.relativePath) : '-'}`);
    }
    for (const stage of (Array.isArray(narrativeGaps?.missingStages) ? narrativeGaps.missingStages : []).slice(0, 6)) {
      lines.push(`- 叙事缺阶段：${stage.label || stage.stage}`);
    }
    for (const link of (Array.isArray(narrativeGaps?.weakLinks) ? narrativeGaps.weakLinks : []).slice(0, 6)) {
      lines.push(`- 叙事弱链接：${link}`);
    }
  }
  lines.push('');
  lines.push('## 周末验收口径');
  lines.push('- [ ] 本周计划任务是否都有可打开文档、负责人、截止时间和验收标准？');
  lines.push('- [ ] 阻塞和逾期是否已经解除、改期、缩范围或拆出新任务？');
  lines.push('- [ ] 已完成任务是否进入验收队列并记录通过/退回结论？');
  lines.push('- [ ] 成员实际用时是否已经写回时间表，方便下周估算更准？');
  lines.push('- [ ] 影响剧情/台词/演出的变更是否同步到叙事导演台和任务表？');

  return lines.join('\n');
}

function buildTeamDashboardPage(vaultPath: string, schedule: any, health: any, date = teamTodayString()): string {
  const members = teamScheduleMembers(schedule);
  const memberLoad = Array.isArray(health?.memberLoad) ? health.memberLoad : buildTeamMemberLoadRows(vaultPath, schedule, date);
  const activeTasks = teamReportTaskSort((Array.isArray(schedule.tasks) ? schedule.tasks : [])
    .filter((task: any) => normalizeTeamTaskStatus(task.status) !== 'done'));
  const focusTasks = teamReportTaskSort(Array.from(new Map([
    ...((health?.focus?.blocked || []) as any[]),
    ...((health?.focus?.overdue || []) as any[]),
    ...((health?.focus?.dueSoon || []) as any[]),
    ...activeTasks.filter((task: any) => normalizeTeamTaskPriority(task.priority) === 'high').map(teamTaskBrief),
    ...activeTasks.slice(0, 20).map(teamTaskBrief),
  ].map((task: any) => [normalizeTeamScheduleText(task.id) || teamTaskKey(task), task] as const)).values())).slice(0, 16);
  const dateKey = date.replace(/-/g, '');
  const lines: string[] = [];

  lines.push('---');
  lines.push('type: ars-team-dashboard');
  lines.push(`date: ${JSON.stringify(date)}`);
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push(`scheduleUpdatedAt: ${JSON.stringify(schedule.updatedAt || '')}`);
  lines.push(`schedule: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`)}`);
  lines.push('tags:');
  lines.push('  - team-dashboard');
  lines.push('  - production');
  lines.push('  - game-dev');
  lines.push('---');
  lines.push('');
  lines.push('# 团队制作首页');
  lines.push('');
  lines.push('> 团队每天的 Ars-note 入口：制作人看风险和交接，成员点自己的任务页开工，AI 接管时从这里和 ai-handoff 继续。');
  lines.push('');
  lines.push('## 今日入口');
  lines.push(`- Obsidian 控制台：[[${TEAM_SCHEDULE_DIR}/${teamObsidianCommandCenterFileName().replace(/\.md$/i, '')}|${teamObsidianCommandCenterFileName().replace(/\.md$/i, '')}]]`);
  lines.push(`- 生产健康报告：[[${TEAM_SCHEDULE_DIR}/${teamProductionHealthFileName().replace(/\.md$/i, '')}|${teamProductionHealthFileName().replace(/\.md$/i, '')}]]`);
  lines.push(`- 今日工作包：[[${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${dateKey}|daily-workpack-${dateKey}]]`);
  lines.push(`- AI 交接简报：[[${TEAM_SCHEDULE_DIR}/ai-handoff|ai-handoff]]`);
  lines.push(`- AI 记忆与 Skill：[[${TEAM_SCHEDULE_DIR}/${teamAiMemoryIndexFileName().replace(/\.md$/i, '')}|${teamAiMemoryIndexFileName().replace(/\.md$/i, '')}]]`);
  lines.push(`- 链接健康：[[${TEAM_SCHEDULE_DIR}/${teamLinkHealthFileName().replace(/\.md$/i, '')}|${teamLinkHealthFileName().replace(/\.md$/i, '')}]]`);
  lines.push(`- 里程碑路线图：[[${TEAM_SCHEDULE_DIR}/roadmaps/${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}|${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 叙事导演台：[[${TEAM_SCHEDULE_DIR}/narrative-director|narrative-director]]`);
  lines.push(`- 周计划：[[${TEAM_SCHEDULE_DIR}/sprints/${teamSprintPlanFileName(date).replace(/\.md$/i, '')}|${teamSprintPlanFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 阻塞交接清单：[[${TEAM_SCHEDULE_DIR}/handoffs/blocker-handoff-${dateKey}|blocker-handoff-${dateKey}]]`);
  lines.push(`- 验收复查队列：[[${TEAM_SCHEDULE_DIR}/reviews/review-queue-${dateKey}|review-queue-${dateKey}]]`);
  lines.push(`- 变更影响表：[[${TEAM_SCHEDULE_DIR}/changes/${teamChangeImpactFileName(date).replace(/\.md$/i, '')}|${teamChangeImpactFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 依赖与交接地图：[[${TEAM_SCHEDULE_DIR}/dependency-map|dependency-map]]`);
  if (members.length > 0) {
    lines.push(`- 成员任务页：${members.map((member) => teamMemberPageLink(member)).join(' · ')}`);
  }
  lines.push(`- 时间表数据：\`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}\``);
  lines.push('');
  lines.push('## 制作健康建议');
  const recommendations = Array.isArray(health?.recommendations) ? health.recommendations : [];
  if (recommendations.length === 0) {
    lines.push('- 暂无明显建议。');
  } else {
    for (const item of recommendations.slice(0, 10)) lines.push(`- ${item}`);
  }
  lines.push('');
  lines.push('## 关键指标');
  lines.push('| 指标 | 数量 |');
  lines.push('| --- | ---: |');
  lines.push(`| 活跃任务 | ${health?.stats?.active || 0} |`);
  lines.push(`| 阻塞 | ${health?.stats?.blocked || 0} |`);
  lines.push(`| 逾期 | ${health?.stats?.overdue || 0} |`);
  lines.push(`| 7 天内到期 | ${health?.stats?.dueSoon || 0} |`);
  lines.push(`| 缺负责人 | ${health?.stats?.missingOwner || 0} |`);
  lines.push(`| 缺截止日期 | ${health?.stats?.missingDueDate || 0} |`);
  lines.push(`| 缺文档 | ${health?.stats?.missingDocs || 0} |`);
  lines.push(`| QA/Bug/试玩反馈 | ${health?.stats?.qaOpen || 0} |`);
  lines.push(`| 叙事缺阶段 | ${health?.stats?.narrativeMissingStages || 0} |`);
  lines.push(`| 叙事弱链接 | ${health?.stats?.narrativeWeakLinks || 0} |`);
  lines.push('');
  lines.push('## 成员任务入口');
  if (memberLoad.length === 0) {
    lines.push('- 暂无成员负载数据。');
  } else {
    lines.push('| 状态 | 成员 | 活跃 | 阻塞 | 逾期 | 7天内 | 缺文档 | 今日工时 | 剩余预估 | 任务页 | 建议 |');
    lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |');
    for (const row of memberLoad.slice(0, 24)) {
      lines.push([
        teamMemberLoadLabel(row.level),
        teamMarkdownCell(row.member),
        row.active || 0,
        row.blocked || 0,
        row.overdue || 0,
        row.dueSoon || 0,
        row.missingDocs || 0,
        formatTeamMinutes(row.todayMinutes || 0),
        formatTeamMinutes(row.remainingMinutes || 0),
        teamMemberPageLink(row.member),
        teamMarkdownCell(row.recommendation || '-'),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  lines.push('## 今日焦点任务');
  if (focusTasks.length === 0) {
    lines.push('- 暂无焦点任务。');
  } else {
    lines.push('| 标记 | 负责人 | 状态 | 截止 | 任务 | 文档 | 下一步 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const task of focusTasks) {
      lines.push([
        teamWorkpackTaskFlags(task, date),
        normalizeTeamScheduleText(task.owner) || '未分配',
        normalizeTeamTaskStatus(task.status),
        normalizeTeamScheduleDate(task.dueDate) || '-',
        normalizeTeamScheduleText(task.title),
        teamDocWikiLink(task.linkedDoc),
        teamWorkpackNextAction(task, vaultPath, date),
      ].map(teamMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  lines.push('## 每日节奏');
  lines.push('- [ ] 开工：成员先打开自己的任务页，确认今天先做哪一项。');
  lines.push('- [ ] 中途：制作人看阻塞交接清单，处理卡住和逾期。');
  lines.push('- [ ] 收工：成员记录工时和产出；制作人看验收复查队列。');
  lines.push('- [ ] AI 接管：先读 AI 交接简报和叙事导演台，再更新任务表和生产文档。');

  return lines.join('\n');
}

function buildTeamObsidianCommandCenterPage(vaultPath: string, schedule: any, health: any, date = teamTodayString()): string {
  const members = teamScheduleMembers(schedule);
  const memberLoad = Array.isArray(health?.memberLoad) ? health.memberLoad : buildTeamMemberLoadRows(vaultPath, schedule, date);
  const activeTasks = teamReportTaskSort((Array.isArray(schedule.tasks) ? schedule.tasks : [])
    .filter((task: any) => normalizeTeamTaskStatus(task.status) !== 'done'));
  const focusTasks = teamReportTaskSort(Array.from(new Map([
    ...((health?.focus?.blocked || []) as any[]),
    ...((health?.focus?.overdue || []) as any[]),
    ...((health?.focus?.dueSoon || []) as any[]),
    ...activeTasks.filter((task: any) => normalizeTeamTaskPriority(task.priority) === 'high').map(teamTaskBrief),
    ...activeTasks.filter((task: any) => normalizeTeamTaskStatus(task.status) === 'doing').map(teamTaskBrief),
    ...activeTasks.slice(0, 24).map(teamTaskBrief),
  ].map((task: any) => [normalizeTeamScheduleText(task.id) || teamTaskKey(task), task] as const)).values())).slice(0, 18);
  const dateKey = date.replace(/-/g, '');
  const weekStart = teamWeekStartString(date);
  const weekEnd = teamWeekEndString(date);
  const recommendations = Array.isArray(health?.recommendations) ? health.recommendations : [];
  const narrative = health?.narrative || scanNarrativeProductionChain(vaultPath, 16);
  const qaItems = Array.isArray(health?.qaItems) ? health.qaItems : [];
  const commandCenterName = teamObsidianCommandCenterFileName();
  const lines: string[] = [];

  lines.push('---');
  lines.push('type: ars-team-obsidian-command-center');
  lines.push(`date: ${JSON.stringify(date)}`);
  lines.push(`weekStart: ${JSON.stringify(weekStart)}`);
  lines.push(`weekEnd: ${JSON.stringify(weekEnd)}`);
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push(`scheduleUpdatedAt: ${JSON.stringify(schedule.updatedAt || '')}`);
  lines.push(`schedule: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`)}`);
  lines.push(`dashboard: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/team-dashboard.md`)}`);
  lines.push(`aiHandoff: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/ai-handoff.md`)}`);
  lines.push(`productionHealth: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/${teamProductionHealthFileName()}`)}`);
  lines.push(`linkHealth: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/${teamLinkHealthFileName()}`)}`);
  lines.push(`aiMemoryIndex: ${JSON.stringify(`${TEAM_SCHEDULE_DIR}/${teamAiMemoryIndexFileName()}`)}`);
  lines.push('tags:');
  lines.push('  - obsidian-command-center');
  lines.push('  - team-production');
  lines.push('  - game-dev');
  lines.push('  - ai-takeover');
  lines.push('---');
  lines.push('');
  lines.push('# Ars-note 团队控制台');
  lines.push('');
  lines.push(`> 团队打开 Ars-note Vault 后先看这一页。它把任务、工时、叙事流程、链接健康、AI 记忆和成员入口串成一个 Ars-note 工作台。源文件：\`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}\`。`);
  lines.push('');
  lines.push('## 开工入口');
  lines.push(`- 控制台：[[${TEAM_SCHEDULE_DIR}/${commandCenterName.replace(/\.md$/i, '')}|obsidian-command-center]]`);
  lines.push(`- 团队首页：[[${TEAM_SCHEDULE_DIR}/team-dashboard|team-dashboard]]`);
  lines.push(`- 今日工作包：[[${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${dateKey}|daily-workpack-${dateKey}]]`);
  lines.push(`- AI 接管计划：[[${TEAM_SCHEDULE_DIR}/plans/${teamAITakeoverPlanFileName(date).replace(/\.md$/i, '')}|${teamAITakeoverPlanFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 生产健康报告：[[${TEAM_SCHEDULE_DIR}/${teamProductionHealthFileName().replace(/\.md$/i, '')}|${teamProductionHealthFileName().replace(/\.md$/i, '')}]]`);
  lines.push(`- 今日工时表：[[${TEAM_SCHEDULE_DIR}/timesheets/timesheet-${dateKey}|timesheet-${dateKey}]]`);
  lines.push(`- AI 交接简报：[[${TEAM_SCHEDULE_DIR}/ai-handoff|ai-handoff]]`);
  lines.push(`- AI 记忆与 Skill：[[${TEAM_SCHEDULE_DIR}/${teamAiMemoryIndexFileName().replace(/\.md$/i, '')}|${teamAiMemoryIndexFileName().replace(/\.md$/i, '')}]]`);
  lines.push(`- 链接健康：[[${TEAM_SCHEDULE_DIR}/${teamLinkHealthFileName().replace(/\.md$/i, '')}|${teamLinkHealthFileName().replace(/\.md$/i, '')}]]`);
  lines.push(`- 叙事导演台：[[${TEAM_SCHEDULE_DIR}/narrative-director|narrative-director]]`);
  lines.push(`- 本周计划：[[${TEAM_SCHEDULE_DIR}/sprints/${teamSprintPlanFileName(date).replace(/\.md$/i, '')}|${teamSprintPlanFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 里程碑路线图：[[${TEAM_SCHEDULE_DIR}/roadmaps/${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}|${teamMilestoneRoadmapFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 阻塞交接：[[${TEAM_SCHEDULE_DIR}/handoffs/blocker-handoff-${dateKey}|blocker-handoff-${dateKey}]]`);
  lines.push(`- 验收队列：[[${TEAM_SCHEDULE_DIR}/reviews/review-queue-${dateKey}|review-queue-${dateKey}]]`);
  lines.push(`- 变更影响表：[[${TEAM_SCHEDULE_DIR}/changes/${teamChangeImpactFileName(date).replace(/\.md$/i, '')}|${teamChangeImpactFileName(date).replace(/\.md$/i, '')}]]`);
  lines.push(`- 依赖地图：[[${TEAM_SCHEDULE_DIR}/dependency-map|dependency-map]]`);
  if (members.length > 0) {
    lines.push(`- 成员任务页：${members.map((member) => teamMemberPageLink(member)).join(' · ')}`);
  }
  lines.push('');
  lines.push('## 今日总览');
  lines.push('| 指标 | 数量 | 动作 |');
  lines.push('| --- | ---: | --- |');
  lines.push(`| 活跃任务 | ${health?.stats?.active || activeTasks.length} | 看今日工作包和成员任务页 |`);
  lines.push(`| 阻塞 | ${health?.stats?.blocked || 0} | 先处理阻塞交接 |`);
  lines.push(`| 逾期 | ${health?.stats?.overdue || 0} | 决定延期、拆分或降范围 |`);
  lines.push(`| 7 天内到期 | ${health?.stats?.dueSoon || 0} | 锁定交付口径 |`);
  lines.push(`| 缺负责人 | ${health?.stats?.missingOwner || 0} | 指派成员并生成任务页 |`);
  lines.push(`| 缺任务文档 | ${health?.stats?.missingDocs || 0} | 生成或修复 linkedDoc |`);
  lines.push(`| QA/Bug/试玩反馈 | ${health?.stats?.qaOpen || qaItems.length || 0} | 建 reproduction / fix / retest 任务 |`);
  lines.push(`| 叙事缺阶段 | ${health?.stats?.narrativeMissingStages || 0} | 用叙事导演台补世界观、剧情、任务、台词、演出链路 |`);
  lines.push(`| 叙事弱链接 | ${health?.stats?.narrativeWeakLinks || 0} | 补 wiki-link 和任务表映射 |`);
  lines.push('');
  if (recommendations.length > 0) {
    lines.push('## 制作人先看');
    for (const item of recommendations.slice(0, 8)) lines.push(`- ${compactTeamReportText(item, 180)}`);
    lines.push('');
  }
  lines.push('## 成员入口');
  if (memberLoad.length === 0) {
    lines.push('- 暂无成员负载数据。先在团队时间表里添加成员或任务负责人。');
  } else {
    lines.push('| 状态 | 成员 | 活跃 | 阻塞 | 逾期 | 今日工时 | 剩余预估 | 入口 | 下一步 |');
    lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |');
    for (const row of memberLoad.slice(0, 32)) {
      lines.push([
        teamMemberLoadLabel(row.level),
        teamMarkdownCell(row.member),
        row.active || 0,
        row.blocked || 0,
        row.overdue || 0,
        formatTeamMinutes(row.todayMinutes || 0),
        formatTeamMinutes(row.remainingMinutes || 0),
        teamMemberPageLink(row.member),
        teamMarkdownCell(row.recommendation || '-'),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  lines.push('## 今日焦点');
  if (focusTasks.length === 0) {
    lines.push('- 暂无焦点任务。');
  } else {
    lines.push('| 标记 | 负责人 | 状态 | 截止 | 任务 | 文档 | 下一步 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const task of focusTasks) {
      lines.push([
        teamWorkpackTaskFlags(task, date),
        normalizeTeamScheduleText(task.owner) || '未分配',
        normalizeTeamTaskStatus(task.status),
        normalizeTeamScheduleDate(task.dueDate) || '-',
        normalizeTeamScheduleText(task.title),
        teamDocWikiLink(task.linkedDoc),
        teamWorkpackNextAction(task, vaultPath, date),
      ].map(teamMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  lines.push('## 叙事生产链');
  lines.push('| 环节 | 入口 | AI 接管时要检查 |');
  lines.push('| --- | --- | --- |');
  lines.push(`| 世界观 | [[02_Worldbuilding/NarrativePipeline|NarrativePipeline]] | 规则、势力、地理、术语是否能支撑任务和台词 |`);
  lines.push(`| 角色 | [[03_Characters/README|Characters]] | 角色动机、关系、语气是否能进入对话和演出 |`);
  lines.push(`| 任务 | [[06_Quests/README|Quests]] | quest beat 是否映射到 Unity 任务 |`);
  lines.push(`| 台词 | [[07_Unity_Tasks/NarrativeTaskTable|NarrativeTaskTable]] | 对话需求是否有 owner、linkedDoc、验收标准 |`);
  lines.push(`| 演出 | [[${TEAM_SCHEDULE_DIR}/narrative-director|narrative-director]] | 镜头、动画、音效、触发条件是否拆成任务 |`);
  lines.push(`| QA | [[${TEAM_SCHEDULE_DIR}/reviews/review-queue-${dateKey}|review-queue-${dateKey}]] | bug / playtest feedback 是否有复测任务 |`);
  lines.push('');
  lines.push(`- 已扫描叙事文档：${narrative?.scannedDocs || 0}；NarrativePipeline：${narrative?.pipeline || 0}；弱链接：${Array.isArray(narrative?.weakLinks) ? narrative.weakLinks.length : 0}。`);
  lines.push('');
  lines.push('## Dataview 查询片段');
  lines.push('把下面片段复制到任意 Ars-note Markdown 页面，可以快速做个人工作台或制作人视图。');
  lines.push('');
  lines.push('### 我的未完成任务');
  lines.push('```dataview');
  lines.push('TABLE status AS 状态, priority AS 优先级, dueDate AS 截止, linkedDoc AS 文档, estimateMinutes AS 预估');
  lines.push('FROM "07_Unity_Tasks" OR #ars-task');
  lines.push('WHERE owner = this.owner AND status != "done"');
  lines.push('SORT dueDate ASC, priority DESC');
  lines.push('```');
  lines.push('');
  lines.push('### 阻塞和逾期');
  lines.push('```dataview');
  lines.push('TABLE owner AS 负责人, status AS 状态, dueDate AS 截止, blocker AS 卡点, linkedDoc AS 文档');
  lines.push('FROM "07_Unity_Tasks" OR #ars-task');
  lines.push('WHERE status = "blocked" OR dueDate < date(today)');
  lines.push('SORT dueDate ASC');
  lines.push('```');
  lines.push('');
  lines.push('### 最近更新的任务文档');
  lines.push('```dataview');
  lines.push('TABLE owner AS 负责人, status AS 状态, file.mtime AS 最近修改, linkedDoc AS 文档');
  lines.push('FROM "07_Unity_Tasks" OR #ars-task');
  lines.push('SORT file.mtime DESC');
  lines.push('LIMIT 20');
  lines.push('```');
  lines.push('');
  lines.push('## AI 接管流程');
  lines.push('- [ ] 先运行“同步任务文档”，把成员在任务文档里写的进度、工时、阻塞同步回时间表。');
  lines.push('- [ ] 阅读生产健康报告、AI 交接简报、链接健康、今日工作包和叙事导演台。');
  lines.push('- [ ] 对缺负责人、缺文档、缺验收、阻塞、逾期、QA 反馈建立或更新团队任务。');
  lines.push('- [ ] 如果涉及世界观、剧情、任务、台词、演出或任务表，先更新 NarrativePipeline / NarrativeTaskTable，再刷新团队生产文档。');
  lines.push('- [ ] 如果沉淀出长期判断，写入 `.ai-memory/MEMORY.md`；如果沉淀出可复用方法，写入 `.ai-memory/skills/*.md`。这些会同步到其他电脑。');
  lines.push('- [ ] 最后刷新 Ars-note 团队控制台、团队首页、今日工作包、成员页、工时表、链接健康和 AI 记忆索引。');
  lines.push('');
  lines.push('## 收工检查');
  lines.push('- [ ] 每个成员是否至少有一个可打开的任务入口？');
  lines.push('- [ ] 今日工时是否记录到任务里，而不是只写在聊天里？');
  lines.push('- [ ] 已完成任务是否有验收结论和复测记录？');
  lines.push('- [ ] 新增世界观/剧情/任务/台词/演出变更是否映射到任务表？');
  lines.push('- [ ] 影响团队协作的方法是否沉淀进 AI memory 或 skill？');

  return lines.join('\n');
}

function buildTeamAITakeoverPlanPage(vaultPath: string, schedule: any, health: any, date = teamTodayString()): string {
  const dateKey = date.replace(/-/g, '');
  const stats = summarizeTeamSchedule(schedule);
  const focus = health?.focus || {};
  const narrative = health?.narrative || {};
  const memberLoad = Array.isArray(health?.memberLoad) ? health.memberLoad : buildTeamMemberLoadRows(vaultPath, schedule, date);
  const recommendations = Array.isArray(health?.recommendations) ? health.recommendations : [];
  const activeTasks = teamReportTaskSort((schedule.tasks || []).filter((task: any) => normalizeTeamTaskStatus(task.status) !== 'done'));
  const priorityTasks = teamReportTaskSort(Array.from(new Map([
    ...((focus.blocked || []) as any[]),
    ...((focus.overdue || []) as any[]),
    ...((focus.dueSoon || []) as any[]),
    ...activeTasks.filter((task: any) => normalizeTeamTaskPriority(task.priority) === 'high').map(teamTaskBrief),
    ...activeTasks.map(teamTaskBrief),
  ].map((task: any) => [task.id || teamTaskKey(task), task] as const)).values())).slice(0, 12);
  const qaItems = Array.isArray(focus.qa) ? focus.qa : [];
  const missingStages = Array.isArray(narrative?.missingStages) ? narrative.missingStages : [];
  const weakLinks = Array.isArray(narrative?.weakLinks) ? narrative.weakLinks : [];
  const aiMemoryOverview = buildAiMemorySyncOverview(vaultPath);
  const lines: string[] = [];

  lines.push('---');
  lines.push('type: ars-team-ai-takeover-plan');
  lines.push(`date: ${JSON.stringify(date)}`);
  lines.push(`generated: ${JSON.stringify(new Date().toISOString())}`);
  lines.push(`scheduleUpdatedAt: ${JSON.stringify(schedule.updatedAt || '')}`);
  lines.push('tags:');
  lines.push('  - ars-team');
  lines.push('  - ai-takeover');
  lines.push('  - production-plan');
  lines.push('---');
  lines.push('');
  lines.push(`# AI 接管执行计划 - ${date}`);
  lines.push('');
  lines.push('> 这是给 AI 或制作人当天接管团队制作流程用的执行剧本。按顺序读、分派、推进、记录、刷新，避免只聊想法不落任务。');
  lines.push('');
  lines.push('## 入口');
  lines.push(`- Obsidian 控制台：[[${TEAM_SCHEDULE_DIR}/${teamObsidianCommandCenterFileName().replace(/\.md$/i, '')}|${teamObsidianCommandCenterFileName().replace(/\.md$/i, '')}]]`);
  lines.push(`- 制作健康报告：[[${TEAM_SCHEDULE_DIR}/${teamProductionHealthFileName().replace(/\.md$/i, '')}|${teamProductionHealthFileName().replace(/\.md$/i, '')}]]`);
  lines.push(`- AI 交接简报：[[${TEAM_SCHEDULE_DIR}/ai-handoff|ai-handoff]]`);
  lines.push(`- 叙事导演台：[[${TEAM_SCHEDULE_DIR}/narrative-director|narrative-director]]`);
  lines.push(`- 今日工作包：[[${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${dateKey}|daily-workpack-${dateKey}]]`);
  lines.push(`- 验收队列：[[${TEAM_SCHEDULE_DIR}/reviews/review-queue-${dateKey}|review-queue-${dateKey}]]`);
  lines.push('');
  lines.push('## 今日总览');
  lines.push('| 指标 | 数量 |');
  lines.push('| --- | ---: |');
  lines.push(`| 活跃任务 | ${stats.active} |`);
  lines.push(`| 阻塞 | ${stats.blocked} |`);
  lines.push(`| 逾期 | ${stats.overdue} |`);
  lines.push(`| 缺负责人 | ${stats.missingOwner} |`);
  lines.push(`| 缺截止日期 | ${stats.missingDueDate} |`);
  lines.push(`| 缺文档 | ${health?.stats?.missingDocs || 0} |`);
  lines.push(`| QA/Bug/试玩反馈 | ${health?.stats?.qaOpen || 0} |`);
  lines.push(`| 叙事缺阶段 | ${health?.stats?.narrativeMissingStages || 0} |`);
  lines.push(`| 叙事弱链接 | ${health?.stats?.narrativeWeakLinks || 0} |`);
  lines.push(`| 今日/近期工时记录 | ${health?.stats?.recentLogCount || 0} |`);
  lines.push(`| AI Skill | ${aiMemoryOverview.coverage.skills} |`);
  lines.push('');
  lines.push('## 接管顺序');
  lines.push('- [ ] 1. 先同步任务文档：把成员写在 `07_Unity_Tasks/*.md` 里的 Work Log、阻塞、验收结果同步回 `.ars-team/schedule.json`。');
  lines.push('- [ ] 2. 清理硬风险：阻塞、逾期、缺负责人、缺文档、缺验收。');
  lines.push('- [ ] 3. 接管叙事链：世界观 -> 剧情 -> 任务 -> 台词 -> 演出 -> 任务表 -> QA，缺哪一段就先建任务。');
  lines.push('- [ ] 4. 给每个成员指定下一项：优先可打开任务文档、可记录工时、可验收的任务。');
  lines.push('- [ ] 5. 处理 QA/Bug/试玩反馈：每条反馈必须有负责人、复现/验收口径和 linkedDoc。');
  lines.push('- [ ] 6. 把稳定规则写入 `.ai-memory/MEMORY.md`，把可复用流程沉淀进 `.ai-memory/skills/*.md`。');
  lines.push('- [ ] 7. 最后刷新团队生产文档，并让成员从“我的开工页”或“开始下一项”进入工作。');
  lines.push('');
  lines.push('## 自动建议');
  if (recommendations.length === 0) {
    lines.push('- 暂无自动建议，按高优先级和最近截止任务推进。');
  } else {
    for (const item of recommendations.slice(0, 10)) lines.push(`- ${compactTeamReportText(item, 220)}`);
  }
  lines.push('');
  lines.push('## 成员下一项');
  if (memberLoad.length === 0) {
    lines.push('- 还没有成员任务。先导入当前文档任务或初始化团队工作区。');
  } else {
    lines.push('| 成员 | 状态 | 下一项 | 文档 | 风险 | 建议 |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const row of memberLoad.slice(0, 16)) {
      const next = row.nextTask || {};
      lines.push([
        teamMarkdownCell(row.member),
        teamMarkdownCell(row.label || teamMemberLoadLabel(row.level)),
        teamMarkdownCell(next.title || '-'),
        teamDocWikiLink(next.linkedDoc),
        teamMarkdownCell(Array.isArray(row.reasons) && row.reasons.length ? row.reasons.slice(0, 4).join(' / ') : '节奏正常'),
        teamMarkdownCell(row.recommendation || '-'),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');
  lines.push('## 优先任务队列');
  if (priorityTasks.length === 0) {
    lines.push('- 暂无活跃任务。');
  } else {
    for (const task of priorityTasks) {
      const status = normalizeTeamTaskStatus(task.status);
      const hasDue = normalizeTeamScheduleDate(task.dueDate);
      const action = status === 'blocked'
        ? '先解除阻塞'
        : hasDue && hasDue < date
          ? '拆分逾期范围'
          : !normalizeTeamSchedulePath(task.linkedDoc)
            ? '补任务文档'
            : !normalizeTeamScheduleText(task.acceptance)
              ? '补验收标准'
              : '推进并记录工时';
      lines.push(`- [ ] **${normalizeTeamScheduleText(task.title)}**`);
      lines.push(`  - 动作：${action}`);
      lines.push(`  - 负责人：${normalizeTeamScheduleText(task.owner) || '未分配'}；状态：${status}；优先级：${normalizeTeamTaskPriority(task.priority)}；截止：${hasDue || '-'}；文档：${teamDocWikiLink(task.linkedDoc)}`);
      if (task.blocker) lines.push(`  - 阻塞：${compactTeamReportText(task.blocker, 180)}`);
      if (task.dependency) lines.push(`  - 依赖：${compactTeamReportText(task.dependency, 180)}`);
      if (task.acceptance) lines.push(`  - 验收：${compactTeamReportText(task.acceptance, 200)}`);
    }
  }
  lines.push('');
  lines.push('## 叙事接管');
  if (missingStages.length === 0 && weakLinks.length === 0) {
    lines.push('- 当前叙事生产链没有明显阶段缺口。继续检查任务、台词、演出和 QA 是否已经回写到任务表。');
  } else {
    for (const stage of missingStages.slice(0, 8)) {
      const stageKey = stage?.stage as ProductionNarrativeStage;
      lines.push(`- [ ] 补齐阶段：${stage?.label || stageKey} -> ${teamDocWikiLink(narrativeStageDefaultDoc(stageKey))}`);
    }
    for (const link of weakLinks.slice(0, 8)) {
      lines.push(`- [ ] 串联弱链接：${compactTeamReportText(link, 180)}`);
    }
  }
  lines.push('');
  lines.push('## QA / 反馈接管');
  if (qaItems.length === 0) {
    lines.push('- 暂无未关闭 QA/Bug/试玩反馈。');
  } else {
    for (const item of qaItems.slice(0, 10)) {
      lines.push(`- [ ] ${compactTeamReportText(item.title || item.text || 'QA item', 140)}（${item.relativePath ? teamDocWikiLink(item.relativePath) : '-'}）`);
      if (item.details) lines.push(`  - 说明：${compactTeamReportText(item.details, 180)}`);
    }
  }
  lines.push('');
  lines.push('## 收工写回');
  lines.push('- [ ] 每个推进过的任务都有 Work Log：`日期 | 成员 | 分钟 | 做了什么`。');
  lines.push('- [ ] 完成或退回的任务有 Review Log 和验收结论。');
  lines.push('- [ ] 新增世界观/剧情/任务/台词/演出变更已更新 NarrativePipeline / NarrativeTaskTable。');
  lines.push('- [ ] 新增可复用方法已写入 `.ai-memory/skills/*.md`，长期项目事实已写入 `.ai-memory/MEMORY.md`。');
  lines.push('- [ ] 已运行一键生产刷新，更新控制台、成员页、今日工作包、工时表、AI 交接、链接健康和本接管计划。');

  return lines.join('\n');
}

function generateTeamProductionDocs(vaultPath: string, options: { includeDashboard?: boolean; includeObsidianCommandCenter?: boolean; includeProductionHealth?: boolean; includeDependencyMap?: boolean; includeHandoff?: boolean; includeAiMemoryIndex?: boolean; includeLinkHealth?: boolean; includeBlockerHandoff?: boolean; includeReviewQueue?: boolean; includeWorkpack?: boolean; includeDailyStandup?: boolean; includeTimesheet?: boolean; includeRoadmap?: boolean; includeDecisionLog?: boolean; includeChangeImpact?: boolean; includeNarrativeDirector?: boolean; includeSprintPlan?: boolean; includeMemberPages?: boolean; includeTaskDocs?: boolean; includeTakeoverPlan?: boolean } = {}): { paths: string[]; summary: any } {
  const resolvedVault = path.resolve(vaultPath);
  const hasExplicitOptions = Object.keys(options || {}).length > 0;
  const includeDashboard = options.includeDashboard !== false;
  const includeObsidianCommandCenter = options.includeObsidianCommandCenter !== false;
  const includeProductionHealth = options.includeProductionHealth !== false;
  const includeDependencyMap = options.includeDependencyMap !== false;
  const includeHandoff = options.includeHandoff !== false;
  const includeAiMemoryIndex = options.includeAiMemoryIndex !== false;
  const includeLinkHealth = options.includeLinkHealth !== false;
  const includeBlockerHandoff = options.includeBlockerHandoff !== false;
  const includeReviewQueue = options.includeReviewQueue !== false;
  const includeWorkpack = options.includeWorkpack !== false;
  const includeDailyStandup = hasExplicitOptions ? options.includeDailyStandup === true : true;
  const includeTimesheet = options.includeTimesheet !== false;
  const includeRoadmap = options.includeRoadmap !== false;
  const includeDecisionLog = options.includeDecisionLog !== false;
  const includeChangeImpact = options.includeChangeImpact !== false;
  const includeNarrativeDirector = options.includeNarrativeDirector !== false;
  const includeSprintPlan = options.includeSprintPlan !== false;
  const includeMemberPages = options.includeMemberPages !== false;
  const includeTaskDocs = options.includeTaskDocs !== false;
  const includeTakeoverPlan = hasExplicitOptions ? options.includeTakeoverPlan === true : true;
  const taskDocs = includeTaskDocs
    ? ensureTeamTaskWorkDocs(resolvedVault)
    : { createdCount: 0, linkedCount: 0, alreadyExistsCount: 0, upgradedCount: 0, skippedCount: 0, checkedCount: 0, paths: [], schedulePath: `${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`, content: '' };
  const schedule = readTeamScheduleData(resolvedVault);
  const health = buildTeamProductionHealth(resolvedVault, 16);
  const date = teamTodayString();
  const outputDir = path.join(resolvedVault, TEAM_SCHEDULE_DIR);
  fs.mkdirSync(outputDir, { recursive: true });

  const writes: Array<{ relPath: string; content: string; reason: string }> = [];
  if (includeHandoff) writes.push({
    relPath: `${TEAM_SCHEDULE_DIR}/ai-handoff.md`,
    content: buildTeamAIHandoffPage(resolvedVault, schedule, health, date),
    reason: 'ai-team-handoff',
  });
  if (includeAiMemoryIndex) writes.push({
    relPath: `${TEAM_SCHEDULE_DIR}/${teamAiMemoryIndexFileName()}`,
    content: buildTeamAiMemoryIndexPage(resolvedVault, date),
    reason: 'ai-memory-index',
  });
  if (includeLinkHealth) writes.push({
    relPath: `${TEAM_SCHEDULE_DIR}/${teamLinkHealthFileName()}`,
    content: buildTeamLinkHealthPage(resolvedVault, schedule, health, date),
    reason: 'ai-team-link-health',
  });
  if (includeProductionHealth) writes.push({
    relPath: `${TEAM_SCHEDULE_DIR}/${teamProductionHealthFileName()}`,
    content: buildTeamProductionHealthPage(resolvedVault, schedule, health, date),
    reason: 'ai-team-production-health',
  });
  if (includeDependencyMap) writes.push({
    relPath: `${TEAM_SCHEDULE_DIR}/dependency-map.md`,
    content: buildTeamDependencyMapPage(schedule, health, date),
    reason: 'ai-team-dependency-map',
  });
  if (includeBlockerHandoff) writes.push({
    relPath: `${TEAM_SCHEDULE_DIR}/handoffs/blocker-handoff-${date.replace(/-/g, '')}.md`,
    content: buildTeamBlockerHandoffPage(resolvedVault, schedule, health, date),
    reason: 'ai-team-blocker-handoff',
  });
  if (includeReviewQueue) writes.push({
    relPath: `${TEAM_SCHEDULE_DIR}/reviews/review-queue-${date.replace(/-/g, '')}.md`,
    content: buildTeamReviewQueuePage(resolvedVault, schedule, health, date),
    reason: 'ai-team-review-queue',
  });
  if (includeWorkpack) writes.push({
    relPath: `${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${date.replace(/-/g, '')}.md`,
    content: buildTeamDailyWorkpackPage(resolvedVault, schedule, health, date),
    reason: 'ai-team-daily-workpack',
  });
  if (includeDailyStandup) writes.push({
    relPath: `${TEAM_SCHEDULE_DIR}/reports/daily-standup-${date.replace(/-/g, '')}.md`,
    content: buildTeamDailyStandupPage(resolvedVault, schedule, health, date),
    reason: 'ai-team-daily-standup',
  });
  if (includeTimesheet) writes.push({
    relPath: `${TEAM_SCHEDULE_DIR}/timesheets/timesheet-${date.replace(/-/g, '')}.md`,
    content: buildTeamTimesheetPage(resolvedVault, schedule, health, date),
    reason: 'ai-team-timesheet',
  });
  if (includeRoadmap) writes.push({
    relPath: `${TEAM_SCHEDULE_DIR}/roadmaps/${teamMilestoneRoadmapFileName(date)}`,
    content: buildTeamMilestoneRoadmapPage(resolvedVault, schedule, health, date),
    reason: 'ai-team-roadmap',
  });
  if (includeDecisionLog) writes.push({
    relPath: `${TEAM_SCHEDULE_DIR}/decisions/${teamDecisionLogFileName(date)}`,
    content: buildTeamDecisionLogPage(resolvedVault, schedule, health, date),
    reason: 'ai-team-decision-log',
  });
  if (includeChangeImpact) writes.push({
    relPath: `${TEAM_SCHEDULE_DIR}/changes/${teamChangeImpactFileName(date)}`,
    content: buildTeamChangeImpactPage(resolvedVault, schedule, health, date),
    reason: 'ai-team-change-impact',
  });
  if (includeNarrativeDirector) writes.push({
    relPath: `${TEAM_SCHEDULE_DIR}/narrative-director.md`,
    content: buildTeamNarrativeDirectorPage(resolvedVault, schedule, health, date),
    reason: 'ai-team-narrative-director',
  });
  if (includeTakeoverPlan) writes.push({
    relPath: `${TEAM_SCHEDULE_DIR}/plans/${teamAITakeoverPlanFileName(date)}`,
    content: buildTeamAITakeoverPlanPage(resolvedVault, schedule, health, date),
    reason: 'ai-team-takeover-plan',
  });
  if (includeSprintPlan) writes.push({
    relPath: `${TEAM_SCHEDULE_DIR}/sprints/${teamSprintPlanFileName(date)}`,
    content: buildTeamSprintPlanPage(resolvedVault, schedule, health, date),
    reason: 'ai-team-sprint-plan',
  });
  if (includeMemberPages) {
    for (const member of teamScheduleMembers(schedule)) {
      writes.push({
        relPath: `${TEAM_SCHEDULE_DIR}/members/${safeTeamMemberFileName(member)}.md`,
        content: buildTeamMemberTaskPage(resolvedVault, schedule, member, health, date),
        reason: 'ai-team-member-page',
      });
    }
  }
  if (includeObsidianCommandCenter) writes.push({
    relPath: `${TEAM_SCHEDULE_DIR}/${teamObsidianCommandCenterFileName()}`,
    content: buildTeamObsidianCommandCenterPage(resolvedVault, schedule, health, date),
    reason: 'ai-team-obsidian-command-center',
  });
  if (includeDashboard) writes.push({
    relPath: `${TEAM_SCHEDULE_DIR}/team-dashboard.md`,
    content: buildTeamDashboardPage(resolvedVault, schedule, health, date),
    reason: 'ai-team-dashboard',
  });

  const paths: string[] = [...taskDocs.paths];
  if (taskDocs.linkedCount > 0) paths.push(taskDocs.schedulePath);
  for (const item of writes) {
    const fullPath = path.join(resolvedVault, item.relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    saveLiveHistoryBeforeOverwrite(fullPath, item.content, item.reason);
    fs.writeFileSync(fullPath, item.content, 'utf-8');
    paths.push(item.relPath);
  }

  return {
    paths,
    summary: {
      updatedAt: schedule.updatedAt || '',
      generatedAt: new Date().toISOString(),
      stats: health.stats || summarizeTeamSchedule(schedule),
      recommendations: (health.recommendations || []).slice(0, 8),
      taskDocs,
    },
  };
}

function parseAIToolBooleanArg(value: unknown, defaultValue = true): boolean {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (!text) return defaultValue;
  return !['false', '0', 'no', 'off'].includes(text);
}

ipcMain.handle('team:draftNarrativeTasks', async (_e, vaultPath: string, options?: {
  limit?: number;
  includeQa?: boolean;
  upsert?: boolean;
  sourceLabel?: string;
}) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  const resolvedVault = path.resolve(vaultPath);
  const limit = Math.max(1, Math.min(80, Math.floor(Number(options?.limit) || 24)));
  const draft = buildNarrativeTakeoverTaskDrafts(resolvedVault, {
    limit,
    includeQa: options?.includeQa !== false,
  });
  let upsert: ReturnType<typeof upsertTeamScheduleTasks> | undefined;
  if (options?.upsert) {
    upsert = upsertTeamScheduleTasks(resolvedVault, draft.tasks, normalizeTeamScheduleText(options.sourceLabel) || 'AI narrative takeover', {
      balanceAssignments: true,
    });
  }
  return {
    ok: true,
    ...draft,
    upsert,
  };
});

ipcMain.handle('team:upsertTasks', async (_e, vaultPath: string, tasks: any[], sourceLabel?: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  if (!Array.isArray(tasks)) {
    throw new Error('Tasks must be an array');
  }
  const cleanSourceLabel = normalizeTeamScheduleText(sourceLabel) || 'Team task import';
  return upsertTeamScheduleTasks(path.resolve(vaultPath), tasks, cleanSourceLabel, {
    balanceAssignments: /\b(ai|narrative|takeover|director)\b/i.test(cleanSourceLabel),
  });
});

ipcMain.handle('team:bootstrapWorkspace', async (_e, vaultPath: string, options?: {
  currentMember?: string;
  limit?: number;
}) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return bootstrapTeamWorkspace(path.resolve(vaultPath), {
    currentMember: normalizeTeamScheduleText(options?.currentMember),
    limit: options?.limit,
  });
});

ipcMain.handle('team:syncTaskDocs', async (_e, vaultPath: string, fallbackMember?: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return syncTeamTaskDocsToSchedule(path.resolve(vaultPath), normalizeTeamScheduleText(fallbackMember));
});

ipcMain.handle('team:generateProductionDocs', async (_e, vaultPath: string, options?: {
  includeDashboard?: boolean;
  includeObsidianCommandCenter?: boolean;
  includeProductionHealth?: boolean;
  includeDependencyMap?: boolean;
  includeHandoff?: boolean;
  includeAiMemoryIndex?: boolean;
  includeLinkHealth?: boolean;
  includeBlockerHandoff?: boolean;
  includeReviewQueue?: boolean;
  includeWorkpack?: boolean;
  includeDailyStandup?: boolean;
  includeTimesheet?: boolean;
  includeRoadmap?: boolean;
  includeDecisionLog?: boolean;
  includeChangeImpact?: boolean;
  includeNarrativeDirector?: boolean;
  includeSprintPlan?: boolean;
  includeMemberPages?: boolean;
  includeTaskDocs?: boolean;
  includeTakeoverPlan?: boolean;
}) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return generateTeamProductionDocs(vaultPath, options || {});
});

function formatTeamServerFetchError(endpoint: string, error: any, action: string): string {
  const code = error?.cause?.code || error?.code || '';
  const message = String(error?.message || error || '').trim();
  const detail = [code, message].filter(Boolean).join(' / ');
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|network|timeout/i.test(detail)) {
    return `${action}失败：服务器不可达（${endpoint}）。请确认节点小宝/Tailscale/局域网连接已开启，服务器地址和端口可访问。`;
  }
  return `${action}失败：${message || '服务器状态不可用'}`;
}

async function fetchTeamServerProductionStatus(vaultPath: string, options?: { limit?: number }): Promise<any> {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }

  const resolvedVault = path.resolve(vaultPath);
  const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
  const syncCfg = readJsonSafe<any>(syncPath, {});
  const liveCfg = loadLiveSyncConfig(resolvedVault);
  const endpointRaw = syncCfg.endpoint || liveCfg?.serverUrl || '';
  if (!endpointRaw) {
    throw new Error('Self-hosted sync server is not configured');
  }

  const identity = getVaultRemoteIdentity(resolvedVault, syncCfg);
  const endpoint = liveSyncEndpointFromUrl(endpointRaw);
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options?.limit) || 24)));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(
      endpoint + '/api/team/production-status?vaultId=' + encodeURIComponent(identity.vaultId) + '&limit=' + encodeURIComponent(String(limit)),
      {
        headers: { ...selfHostedAuthHeaders(resolvedVault) },
        signal: controller.signal,
      },
    );
    const data = await response.json() as any;
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || `Team production status failed: HTTP ${response.status}`);
    }
    return {
      ...data,
      endpoint,
      expectedVaultId: identity.vaultId,
      expectedVaultName: identity.vaultName,
      requestedLimit: limit,
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error('Team production status timeout');
    throw new Error(formatTeamServerFetchError(endpoint, err, '读取团队服务器状态'));
  } finally {
    clearTimeout(timeout);
  }
}

ipcMain.handle('team:getServerProductionStatus', async (_e, vaultPath: string, options?: { limit?: number }) => {
  return fetchTeamServerProductionStatus(vaultPath, options);
});

async function fetchTeamServerMemberWork(vaultPath: string, options?: { member?: string; limit?: number }): Promise<any> {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }

  const resolvedVault = path.resolve(vaultPath);
  const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
  const syncCfg = readJsonSafe<any>(syncPath, {});
  const liveCfg = loadLiveSyncConfig(resolvedVault);
  const endpointRaw = syncCfg.endpoint || liveCfg?.serverUrl || '';
  if (!endpointRaw) {
    throw new Error('Self-hosted sync server is not configured');
  }

  const identity = getVaultRemoteIdentity(resolvedVault, syncCfg);
  const endpoint = liveSyncEndpointFromUrl(endpointRaw);
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options?.limit) || 40)));
  const member = normalizeTeamScheduleText(options?.member || '');
  const params = new URLSearchParams({
    vaultId: identity.vaultId,
    limit: String(limit),
  });
  if (member) params.set('member', member);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(endpoint + '/api/team/member-work?' + params.toString(), {
      headers: { ...selfHostedAuthHeaders(resolvedVault) },
      signal: controller.signal,
    });
    const data = await response.json() as any;
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || `Team member work failed: HTTP ${response.status}`);
    }
    return {
      ...data,
      endpoint,
      expectedVaultId: identity.vaultId,
      expectedVaultName: identity.vaultName,
      requestedMember: member,
      requestedLimit: limit,
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error('Team member work timeout');
    throw new Error(formatTeamServerFetchError(endpoint, err, '读取成员工作视图'));
  } finally {
    clearTimeout(timeout);
  }
}

ipcMain.handle('team:getServerMemberWork', async (_e, vaultPath: string, options?: { member?: string; limit?: number }) => {
  return fetchTeamServerMemberWork(vaultPath, options);
});

function buildAITeamServerStatusSummary(status: any): any {
  const team = status?.team || {};
  const onlineClients = Array.isArray(status?.onlineClients) ? status.onlineClients : [];
  const warnings = Array.isArray(team.warnings) ? [...team.warnings] : [];
  if (status?.expectedVaultId && status?.serverVaultId && String(status.expectedVaultId) !== String(status.serverVaultId)) {
    warnings.unshift(`Client expected vaultId ${status.expectedVaultId}, but server reports ${status.serverVaultId}.`);
  }

  const coordinationAdvice: string[] = [];
  if (onlineClients.length === 0) {
    coordinationAdvice.push('No online clients are visible on the server. Do not assume other teammates received the latest task changes.');
  }
  if (team.scheduleSynced === false) {
    coordinationAdvice.push('The team schedule is not synced to the server yet. Run sync/generate production docs before assigning cross-device work.');
  }
  if ((team.missingCoreDocs || 0) > 0) {
    coordinationAdvice.push('Some core Ars-note team workspace docs are missing on the server. Refresh/generate team production docs and wait for live sync before asking teammates to use the command center.');
  }
  if ((team.aiMemoryFiles || 0) === 0 || team.aiMemoryManifestSynced === false) {
    coordinationAdvice.push('AI memory sync coverage is incomplete. Avoid relying on remote AI context until .ai-memory is synced.');
  }
  if ((team.missingAiMemoryCoreFiles || 0) > 0) {
    coordinationAdvice.push('Some core AI memory files are missing on the server. Sync .ai-memory/MEMORY.md, USER.md, SOUL.md, and crons.json before expecting another computer to inherit long-term AI context.');
  }
  if ((team.aiSkills || 0) === 0) {
    coordinationAdvice.push('No AI skills are visible on the server. Re-sync .ai-memory/skills before expecting another computer to inherit AI workflows.');
  }
  if ((team.blockedTasks || 0) > 0 || (team.overdueTasks || 0) > 0 || (team.missingDocTasks || 0) > 0) {
    coordinationAdvice.push('Prioritize blocked, overdue, and missing-document tasks before adding new narrative or implementation scope.');
  }
  if (warnings.length > 0) {
    coordinationAdvice.push('Resolve server warnings before treating this as the single source of truth for the whole team.');
  }
  if (coordinationAdvice.length === 0) {
    coordinationAdvice.push('Server sync looks usable for team coordination. Use this as remote truth, then compare with local production health.');
  }

  return {
    ok: !!status?.ok,
    endpoint: status?.endpoint || '',
    checkedAt: status?.checkedAt || new Date().toISOString(),
    vault: {
      clientExpectedId: status?.expectedVaultId || '',
      clientExpectedName: status?.expectedVaultName || '',
      requestedId: status?.vaultId || '',
      serverId: status?.serverVaultId || '',
      serverName: status?.vaultName || '',
    },
    onlineDevices: onlineClients.slice(0, 12).map((client: any) => ({
      clientId: client?.clientId || '',
      deviceId: client?.deviceId || '',
      deviceName: client?.deviceName || '',
      platform: client?.platform || '',
      appVersion: client?.appVersion || '',
      lastSeenAt: client?.lastSeenAt || '',
      receivedCount: Number(client?.receivedCount || 0),
    })),
    production: {
      scheduleSynced: !!team.scheduleSynced,
      scheduleUpdatedAt: team.scheduleUpdatedAt || null,
      totalTasks: Number(team.totalTasks || 0),
      activeTasks: Number(team.activeTasks || 0),
      doneTasks: Number(team.doneTasks || 0),
      blockedTasks: Number(team.blockedTasks || 0),
      overdueTasks: Number(team.overdueTasks || 0),
      dueSoonTasks: Number(team.dueSoonTasks || 0),
      missingOwnerTasks: Number(team.missingOwnerTasks || 0),
      missingDueDateTasks: Number(team.missingDueDateTasks || 0),
      missingDocTasks: Number(team.missingDocTasks || 0),
      recentLogCount: Number(team.recentLogCount || 0),
      loggedMinutes: Number(team.loggedMinutes || 0),
    },
    syncCoverage: {
      liveFileCount: Number(status?.liveFileCount || 0),
      teamDocs: Number(team.teamDocs || 0),
      taskDocs: Number(team.taskDocs || 0),
      aiMemoryFiles: Number(team.aiMemoryFiles || 0),
      aiSkills: Number(team.aiSkills || 0),
      aiMemoryManifestSynced: !!team.aiMemoryManifestSynced,
      aiMemoryCoreFiles: Array.isArray(team.aiMemoryCoreFiles)
        ? team.aiMemoryCoreFiles.map((file: any) => ({
            key: file?.key || '',
            label: file?.label || '',
            path: file?.relativePath || '',
            synced: !!file?.synced,
            inManifest: !!file?.inManifest,
            updatedAt: file?.updatedAt || null,
            size: Number(file?.size || 0),
          }))
        : [],
      missingAiMemoryCoreFiles: Number(team.missingAiMemoryCoreFiles || 0),
      coreDocs: Array.isArray(team.coreDocs)
        ? team.coreDocs.map((doc: any) => ({
            key: doc?.key || '',
            label: doc?.label || '',
            path: doc?.relativePath || '',
            synced: !!doc?.synced,
            updatedAt: doc?.updatedAt || null,
            size: Number(doc?.size || 0),
          }))
        : [],
      missingCoreDocs: Number(team.missingCoreDocs || 0),
      lastTeamFileAt: team.lastTeamFileAt || null,
    },
    recentTeamFiles: Array.isArray(status?.recentTeamFiles)
      ? status.recentTeamFiles.slice(0, 12).map((file: any) => ({
          path: file?.relativePath || '',
          size: Number(file?.size || 0),
          updatedAt: file?.updatedAt || '',
          deleted: !!file?.deleted,
        }))
      : [],
    warnings,
    coordinationAdvice,
    instruction: 'Use this server-side status as remote sync evidence before assigning cross-computer work. If ok=false or warnings are present, tell the user what must be fixed and continue with local schedule data only as a fallback.',
  };
}

function buildAITeamMemberWorkSummary(data: any): any {
  const summary = data?.summary || null;
  const members = Array.isArray(data?.members) ? data.members : [];
  const memberWork = Array.isArray(data?.memberWork) ? data.memberWork : [];
  const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  const recentLogs = Array.isArray(data?.recentLogs) ? data.recentLogs : [];
  const coordinationAdvice: string[] = [];
  if (!data?.sourceFiles?.schedule) {
    coordinationAdvice.push('The server has no .ars-team/schedule.json snapshot yet. Run/generate team production docs and wait for live sync before using server member work as shared truth.');
  }
  if (data?.requestedMember && !summary) {
    coordinationAdvice.push(`No member summary was found for ${data.requestedMember}. Check exact member spelling or sync the latest schedule.`);
  }
  if (summary?.blockedTasks > 0 || summary?.overdueTasks > 0 || summary?.missingDocTasks > 0) {
    coordinationAdvice.push('Resolve this member’s blocked, overdue, or missing-document tasks before adding more high-priority work.');
  }
  if (tasks.some((task: any) => task?.linkedDoc && !task?.linkedDocSynced)) {
    coordinationAdvice.push('Some member tasks reference linked docs that are not synced on the server. Generate missing task docs or wait for sync before asking teammates to open them.');
  }
  if (coordinationAdvice.length === 0) {
    coordinationAdvice.push('Member work looks usable for cross-device assignment. Use it alongside local production health before changing owners or due dates.');
  }

  return {
    ok: !!data?.ok,
    endpoint: data?.endpoint || '',
    checkedAt: data?.checkedAt || new Date().toISOString(),
    vault: {
      clientExpectedId: data?.expectedVaultId || '',
      clientExpectedName: data?.expectedVaultName || '',
      requestedId: data?.vaultId || '',
      serverId: data?.serverVaultId || '',
      serverName: data?.vaultName || '',
    },
    member: data?.member || data?.requestedMember || '',
    members: members.slice(0, 40),
    memberWork: memberWork.slice(0, 24).map((row: any) => ({
      member: row?.member || '',
      totalTasks: Number(row?.totalTasks || 0),
      activeTasks: Number(row?.activeTasks || 0),
      doneTasks: Number(row?.doneTasks || 0),
      blockedTasks: Number(row?.blockedTasks || 0),
      overdueTasks: Number(row?.overdueTasks || 0),
      dueSoonTasks: Number(row?.dueSoonTasks || 0),
      missingDocTasks: Number(row?.missingDocTasks || 0),
      spentMinutes: Number(row?.spentMinutes || 0),
      todayMinutes: Number(row?.todayMinutes || 0),
      todayLogCount: Number(row?.todayLogCount || 0),
    })),
    summary: summary ? {
      member: summary.member || '',
      totalTasks: Number(summary.totalTasks || 0),
      activeTasks: Number(summary.activeTasks || 0),
      doneTasks: Number(summary.doneTasks || 0),
      blockedTasks: Number(summary.blockedTasks || 0),
      overdueTasks: Number(summary.overdueTasks || 0),
      dueSoonTasks: Number(summary.dueSoonTasks || 0),
      missingDocTasks: Number(summary.missingDocTasks || 0),
      spentMinutes: Number(summary.spentMinutes || 0),
      todayMinutes: Number(summary.todayMinutes || 0),
      todayLogCount: Number(summary.todayLogCount || 0),
      recentLogCount: Number(summary.recentLogCount || 0),
    } : null,
    tasks: tasks.slice(0, 40).map((task: any) => ({
      id: task?.id || '',
      title: task?.title || '',
      owner: task?.owner || '',
      status: task?.status || '',
      priority: task?.priority || '',
      dueDate: task?.dueDate || '',
      linkedDoc: task?.linkedDoc || '',
      linkedDocSynced: !!task?.linkedDocSynced,
      deliverable: task?.deliverable || '',
      dependency: task?.dependency || '',
      blocker: task?.blocker || '',
      acceptance: task?.acceptance || '',
      estimateMinutes: Number(task?.estimateMinutes || 0),
      spentMinutes: Number(task?.spentMinutes || 0),
      memberSpentMinutes: Number(task?.memberSpentMinutes || 0),
      updatedAt: task?.updatedAt || '',
      latestLog: task?.latestLog || null,
    })),
    recentLogs: recentLogs.slice(0, 20).map((log: any) => ({
      taskId: log?.taskId || '',
      taskTitle: log?.taskTitle || '',
      member: log?.member || '',
      date: log?.date || '',
      minutes: Number(log?.minutes || 0),
      note: log?.note || '',
    })),
    sourceFiles: data?.sourceFiles || {},
    coordinationAdvice,
    instruction: 'Use this member-level server snapshot before assigning or reassigning work to a named teammate. If unavailable, fall back to read_team_schedule/read_production_health and clearly say remote member evidence is missing.',
  };
}

function sanitizeRemoteVaultId(value: string): string {
  const trimmed = (value || '').trim();
  const cleaned = trimmed
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
  if (cleaned && /[a-zA-Z0-9]/.test(cleaned)) return cleaned;
  return 'vault_' + crypto.createHash('sha1').update(trimmed || 'vault').digest('hex').slice(0, 16);
}

function getVaultRemoteIdentity(vaultPath: string, syncCfg?: any): { vaultId: string; vaultName: string } {
  const resolvedVault = path.resolve(vaultPath);
  const vc = readJsonSafe<any>(vaultConfigPath(resolvedVault), {});
  const rawVaultId =
    (typeof syncCfg?.remoteVaultId === 'string' && syncCfg.remoteVaultId) ||
    (typeof vc.vaultId === 'string' && vc.vaultId) ||
    path.basename(resolvedVault);

  return {
    vaultId: sanitizeRemoteVaultId(rawVaultId),
    vaultName: (typeof vc.name === 'string' && vc.name.trim()) || path.basename(resolvedVault),
  };
}

function liveSyncConfigKey(vaultPath: string): string {
  const resolvedVault = path.resolve(vaultPath);
  const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
  const syncCfg = readJsonSafe<any>(syncPath, {});
  const identity = getVaultRemoteIdentity(resolvedVault, syncCfg);
  return identity.vaultId || crypto.createHash('sha1').update(resolvedVault).digest('hex');
}

function readLiveSyncConfigs(): Record<string, any> {
  return readJsonSafe<Record<string, any>>(LIVE_SYNC_CONFIG_FILE, {});
}

function writeLiveSyncConfigs(configs: Record<string, any>): void {
  writeJson(LIVE_SYNC_CONFIG_FILE, configs);
}

function saveLiveSyncConfig(vaultPath: string, config: LiveSyncConfig): any {
  const key = liveSyncConfigKey(vaultPath);
  const configs = readLiveSyncConfigs();
  const saved = {
    enabled: !!config.enabled,
    serverUrl: (config.serverUrl || '').trim(),
    apiKey: config.apiKey || '',
    vaultId: config.vaultId || key,
    connectionMode: normalizeLiveSyncConnectionMode(config.connectionMode),
    updatedAt: new Date().toISOString(),
  };
  configs[key] = {
    ...saved,
    apiKey: protectSecretForDisk(saved.apiKey),
  };
  writeLiveSyncConfigs(configs);
  return saved;
}

function loadLiveSyncConfig(vaultPath: string): any | null {
  const key = liveSyncConfigKey(vaultPath);
  const configs = readLiveSyncConfigs();
  const stored = configs[key] || null;
  if (!stored) return null;
  const revealed = revealSecretFromDisk(stored.apiKey);
  if (revealed.legacyPlaintext) {
    configs[key] = {
      ...stored,
      apiKey: protectSecretForDisk(revealed.secret),
      migratedAt: new Date().toISOString(),
    };
    writeLiveSyncConfigs(configs);
  }
  return {
    ...stored,
    apiKey: revealed.secret,
  };
}

function clearLiveSyncConfig(vaultPath: string): void {
  const key = liveSyncConfigKey(vaultPath);
  const configs = readLiveSyncConfigs();
  delete configs[key];
  writeLiveSyncConfigs(configs);
}

function encodeSelfHostedRemoteId(vaultId: string, backupId: string): string {
  return `selfhosted:${encodeURIComponent(vaultId)}:${encodeURIComponent(backupId)}`;
}

function decodeSelfHostedRemoteId(remoteId: string): { vaultId?: string; backupId: string } {
  if (!remoteId.startsWith('selfhosted:')) return { backupId: remoteId };
  const parts = remoteId.split(':');
  if (parts.length < 3) return { backupId: remoteId };
  return {
    vaultId: decodeURIComponent(parts[1]),
    backupId: decodeURIComponent(parts.slice(2).join(':')),
  };
}

async function registerSelfHostedVault(endpoint: string, vaultPath: string, identity: { vaultId: string; vaultName: string }): Promise<void> {
  const res = await fetch(endpoint.replace(/\/+$/, '') + '/api/vaults/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...selfHostedAuthHeaders(vaultPath) },
    body: JSON.stringify({ vaultId: identity.vaultId, vaultName: identity.vaultName }),
  });
  const data = await res.json() as any;
  if (!data.ok) throw new Error(data.error || 'Vault registration failed');
}

/* ── Vault: Create ── */
ipcMain.handle('vault:create', async (_e, dir: string, name: string) => {
  const nameErr = validateName(name);
  if (nameErr) throw new Error(nameErr);

  const vaultPath = path.join(dir, name.trim());
  if (fs.existsSync(vaultPath)) {
    throw new Error(`Folder already exists: ${vaultPath}`);
  }

  const dirs = [
    '01_GDD', '02_Worldbuilding', '03_Characters', '04_Maps',
    '05_Items', '06_Quests', '07_Unity_Tasks', '08_Devlog',
    'assets', ARS_NOTE_DIR,
  ];
  for (const d of dirs) fs.mkdirSync(path.join(vaultPath, d), { recursive: true });

  const now = new Date().toISOString();
  const vaultConfig = {
    appName: 'Ars-note',
    vaultId: crypto.randomUUID(),
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    appVersion: APP_VERSION,
  };
  writeJson(vaultConfigPath(vaultPath), vaultConfig);
  writeJson(vaultSettingsPath(vaultPath), {
    theme: 'dark', fontSize: 14, autoSave: true, autoSaveDelay: 1000,
  });

  fs.writeFileSync(path.join(vaultPath, '00_Index.md'),
    `# ${name.trim()}\n\nWelcome to your game development vault.\n\n## Quick Links\n- [GDD](01_GDD/GDD.md)\n- [World Overview](02_Worldbuilding/WorldOverview.md)\n\n---\n*Created with Ars-note v${APP_VERSION}*\n`, 'utf-8');
  fs.writeFileSync(path.join(vaultPath, '01_GDD', 'GDD.md'),
    `# Game Design Document\n\n## Overview\n- **Game Title**:\n- **Genre**:\n- **Platform**:\n\n---\n*Created with Ars-note v${APP_VERSION}*\n`, 'utf-8');
  fs.writeFileSync(path.join(vaultPath, '02_Worldbuilding', 'WorldOverview.md'),
    `# World Overview\n\n## Setting\n\n## Regions\n\n## History\n\n---\n*Created with Ars-note v${APP_VERSION}*\n`, 'utf-8');

  await addRecentVault(vaultPath);
  return { path: vaultPath, name: name.trim(), config: vaultConfig };
});

/* ── Vault: Open ── */
ipcMain.handle('vault:open', async (_e, dir: string) => {
  if (isValidVault(dir)) {
    const config = readJsonSafe<any>(vaultConfigPath(dir), null);
    if (config) {
      await addRecentVault(dir);
      return { path: dir, name: config.name || path.basename(dir), config };
    }
  }
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const vaultDirs = entries.filter(
      (e) => e.isDirectory() && !e.name.startsWith('.') && isValidVault(path.join(dir, e.name))
    );
    if (vaultDirs.length === 1) {
      const vp = path.join(dir, vaultDirs[0].name);
      const config = readJsonSafe<any>(vaultConfigPath(vp), null);
      if (config) { await addRecentVault(vp); return { path: vp, name: config.name || vaultDirs[0].name, config }; }
    }
    if (vaultDirs.length > 1) return null;
  } catch { /* readdir failed */ }
  return null;
});

/* ── Recent vaults ── */
async function addRecentVault(vp: string): Promise<void> {
  const recent = readJsonSafe<string[]>(RECENT_FILE, []);
  const filtered = recent.filter((p) => p !== vp);
  filtered.unshift(vp);
  writeJson(RECENT_FILE, filtered.slice(0, 10));
}

ipcMain.handle('vault:getRecent', async () => {
  const recent = readJsonSafe<string[]>(RECENT_FILE, []);
  return recent.filter((p) => isValidVault(p));
});

ipcMain.handle('vault:addRecent', async (_e, vp: string) => { await addRecentVault(vp); });

/* ── Vault: check if recent path still exists (for UI prompt) ── */
ipcMain.handle('vault:recentExists', async (_e, vp: string) => {
  return isValidVault(vp);
});

/* ── File Tree ── */
ipcMain.handle('fs:readFileTree', async (_e, vaultPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath)) return [];
  function readDir(dir: string): any[] {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const result: any[] = [];
      const sorted = entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });
      for (const entry of sorted) {
        if (isConflictArtifactName(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        const node: any = {
          name: entry.name,
          path: fullPath,
          isDir: entry.isDirectory(),
          children: [],
        };
        if (entry.isDirectory()) node.children = readDir(fullPath);
        result.push(node);
      }
      return result;
    } catch { return []; }
  }
  return readDir(vaultPath);
});

/* ── File read / write ── */
ipcMain.handle('fs:readFile', async (_e, filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf-8');
  } catch { return ''; }
});

ipcMain.handle('fs:writeFile', async (_e, filePath: string, content: string) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  assertSafeVisualDocumentWrite(filePath, content || '');
  saveLiveHistoryBeforeOverwrite(filePath, content, 'local-save');
  fs.writeFileSync(filePath, content, 'utf-8');
});

/* ── Create file ── */
ipcMain.handle('fs:saveImageToVault', async (_e, vaultPath: string, relPath: string, data: number[]) => {
  const full = path.join(vaultPath, relPath);
  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(full, Buffer.from(data));
  return full;
});

ipcMain.handle('fs:createFile', async (_e, filePath: string, content?: string) => {
  const base = path.basename(filePath);
  const nameErr = validateName(base.replace(/\.md$/, ''));
  if (nameErr) throw new Error(nameErr);
  if (fs.existsSync(filePath)) throw new Error(`File already exists: ${base}`);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content ?? '', 'utf-8');
});

/* ── Create folder ── */
ipcMain.handle('fs:createFolder', async (_e, folderPath: string) => {
  const base = path.basename(folderPath);
  const nameErr = validateName(base);
  if (nameErr) throw new Error(nameErr);
  if (fs.existsSync(folderPath)) throw new Error(`Folder already exists: ${base}`);
  fs.mkdirSync(folderPath, { recursive: true });
});

/* ── Delete item (with vault-safety checks) ── */
ipcMain.handle('fs:deleteItem', async (_e, itemPath: string, vaultPath: string) => {
  if (!itemPath || !fs.existsSync(itemPath)) throw new Error('Item not found');

  /* Safety: cannot delete vault root */
  const resolvedItem = path.resolve(itemPath);
  const resolvedVault = path.resolve(vaultPath);
  if (resolvedItem === resolvedVault) {
    throw new Error('Cannot delete the vault root directory');
  }
  /* Safety: cannot delete .ars-note */
  if (path.basename(resolvedItem) === ARS_NOTE_DIR && path.dirname(resolvedItem) === resolvedVault) {
    throw new Error('Cannot delete the vault configuration folder');
  }
  /* Safety: must be inside vault */
  if (!isInsidePath(resolvedItem, resolvedVault)) {
    throw new Error('Cannot delete items outside the vault');
  }

  const stat = fs.statSync(itemPath);
  saveLiveHistoryBeforeDelete(resolvedItem, resolvedVault, stat.isDirectory() ? 'local-delete-folder' : 'local-delete-file');
  if (stat.isDirectory()) {
    fs.rmSync(itemPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(itemPath);
  }
});

/* ── Rename ── */
ipcMain.handle('fs:renameItem', async (_e, oldPath: string, newName: string) => {
  const nameErr = validateName(newName);
  if (nameErr) throw new Error(nameErr);
  const dir = path.dirname(oldPath);
  const newPath = path.join(dir, newName);
  if (oldPath === newPath) return newPath;
  if (fs.existsSync(newPath)) throw new Error(`"${newName}" already exists`);
  fs.renameSync(oldPath, newPath);
  return newPath;
});

ipcMain.handle('fs:moveItem', async (_e, srcPath: string, destDir: string) => {
  if (!srcPath || !destDir) throw new Error('Invalid paths');
  const baseName = path.basename(srcPath);
  const newPath = path.join(destDir, baseName);
  if (srcPath === newPath) return newPath;
  if (fs.existsSync(newPath)) throw new Error(`"${baseName}" already exists in destination`);
  fs.renameSync(srcPath, newPath);
  return newPath;
});

/* ── Search (skip dot-dirs, node_modules, etc.) ── */
ipcMain.handle('search:files', async (_e, vaultPath: string, query: string) => {
  if (!query || !query.trim()) return [];
  const results: any[] = [];
  const lower = query.toLowerCase().trim();

  function walk(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (isConflictArtifactName(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.name.endsWith('.md')) {
          const relPath = path.relative(vaultPath, fullPath);
          if (entry.name.toLowerCase().includes(lower)) {
            results.push({ filePath: fullPath, relativePath: relPath, fileName: entry.name, line: 0, snippet: '' });
          }
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(lower)) {
                results.push({ filePath: fullPath, relativePath: relPath, fileName: entry.name, line: i + 1, snippet: lines[i].trim().substring(0, 120) });
              }
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  try { walk(vaultPath); } catch { /* vault dir gone */ }
  return results.slice(0, 100);
});

/* ── Vault Index: scan all .md files for tags and wiki-links ── */
ipcMain.handle('vault:scanIndex', async (_e, vaultPath: string) => {
  const notes: Record<string, any> = {};

  function walk(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (isConflictArtifactName(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.name.endsWith('.md')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const relPath = path.relative(vaultPath, fullPath).replace(/\\/g, '/');
            const lines = content.split('\n');

            /* Extract title from first H1 */
            let title = entry.name.replace(/\.md$/i, '');
            for (const line of lines) {
              const h1 = line.match(/^#\s+(.+)$/);
              if (h1) { title = h1[1].trim(); break; }
            }

            /* Parse tags — skip headings, code blocks, inline code */
            const tags = new Set<string>();
            let inCodeBlock = false;
            const tagRegex = /(?:^|\s)#([a-zA-Z0-9_\-\/]+)/g;

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (line.trimStart().startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
              if (inCodeBlock) continue;
              if (/^\s{0,3}#{1,6}\s/.test(line)) continue;

              /* Strip inline code */
              const stripped = line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
              tagRegex.lastIndex = 0;
              let m: RegExpExecArray | null;
              while ((m = tagRegex.exec(stripped)) !== null) {
                if (m[1].length > 0) tags.add(m[1].toLowerCase());
              }
            }

            /* Parse wiki-links — skip code blocks */
            const wikiLinks = new Set<string>();
            const wikiRegex = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g;
            inCodeBlock = false;
            for (const line of lines) {
              if (line.trimStart().startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
              if (inCodeBlock) continue;
              const stripped = line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
              wikiRegex.lastIndex = 0;
              let wm: RegExpExecArray | null;
              while ((wm = wikiRegex.exec(stripped)) !== null) {
                let target = wm[1].trim();
                /* Strip heading anchor */
                const hashIdx = target.indexOf('#');
                if (hashIdx > 0) target = target.substring(0, hashIdx).trim();
                if (target.length > 0) wikiLinks.add(target);
              }
            }

            /* Extract metadata from markdown lines (v0.9.2) */
            const metadata: Record<string, string> = {};
            const metaPatterns: [RegExp, string][] = [
              [/^- \*\*Status\*\*:\s*(.+)$/mi, 'status'],
              [/^- \*\*Priority\*\*:\s*(.+)$/mi, 'priority'],
              [/^- \*\*Owner\*\*:\s*(.+)$/mi, 'owner'],
              [/^- \*\*Assignee\*\*:\s*(.+)$/mi, 'owner'],
              [/^- \*\*Updated\*\*:\s*(.+)$/mi, 'updatedAt'],
              [/^- \*\*Updated\*\*：\s*(.+)$/m, 'updatedAt'],
              [/^- \*\*Summary\*\*:\s*(.+)$/mi, 'summary'],
              [/^Status:\s*(.+)$/mi, 'status'],
              [/^Priority:\s*(.+)$/mi, 'priority'],
              [/^Owner:\s*(.+)$/mi, 'owner'],
              [/^Updated:\s*(.+)$/mi, 'updatedAt'],
              [/^Summary:\s*(.+)$/mi, 'summary'],
              [/^状态[：:]\s*(.+)$/m, 'status'],
              [/^优先级[：:]\s*(.+)$/m, 'priority'],
              [/^负责人[：:]\s*(.+)$/m, 'owner'],
              [/^更新[：:]\s*(.+)$/m, 'updatedAt'],
              [/^摘要[：:]\s*(.+)$/m, 'summary'],
            ];
            for (const line of lines) {
              for (const [regex, key] of metaPatterns) {
                const m = line.match(regex);
                if (m && m[1] && !metadata[key]) {
                  metadata[key] = m[1].trim();
                }
              }
            }

            notes[relPath] = {
              filePath: fullPath,
              relativePath: relPath,
              fileName: entry.name,
              title,
              tags: [...tags],
              wikiLinks: [...wikiLinks],
              metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
            };
          } catch { /* skip unreadable */ }
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  try { walk(vaultPath); } catch { /* vault dir gone */ }
  return { notes, updatedAt: new Date().toISOString() };
});


/* ── Shared: scan vault and build manifest ── */
function generateManifestData(vaultPath: string) {
  const resolvedVault = path.resolve(vaultPath);
  const files: any[] = [];
  let totalSize = 0;
  const MANIFEST_SKIP = new Set(['node_modules', '.git', 'dist', 'out', '.cache', '__pycache__']);

  function walkM(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (isConflictArtifactName(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(resolvedVault, fullPath).replace(/\\/g, '/');
        if (shouldSkipGeneratedVaultArtifact(relPath)) continue;
        if (shouldSkipArsNoteInternalEntry(entry.name, path.basename(dir))) continue;
        if (shouldSkipHiddenEntry(entry.name)) continue;
        if (MANIFEST_SKIP.has(entry.name)) continue;
        if (entry.isDirectory()) { walkM(fullPath); }
        else {
          try {
            const stat = fs.statSync(fullPath);
            const buf = fs.readFileSync(fullPath);
            const hash = crypto.createHash('sha256').update(buf).digest('hex');
            const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
            let fileType = 'other';
            if (entry.name.endsWith('.md')) fileType = 'markdown';
            else if (relPath.startsWith(ARS_NOTE_DIR + '/') || relPath.startsWith(AI_MEMORY_DIR + '/')) fileType = 'config';
            else if (['png','jpg','jpeg','gif','svg','webp','bmp','mp3','wav','ogg','flac','mp4','webm','ttf','otf','woff','woff2','json','yaml','yml','xml'].includes(ext)) fileType = 'asset';
            files.push({ id: crypto.randomUUID(), relativePath: relPath, type: fileType, size: stat.size, sha256: hash, updatedAt: stat.mtime.toISOString(), deleted: false });
            totalSize += stat.size;
          } catch { /* skip unreadable files */ }
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  walkM(resolvedVault);
  const vc = readJsonSafe<any>(vaultConfigPath(vaultPath), {});
  return {
    vaultId: vc.vaultId || '',
    vaultName: vc.name || path.basename(resolvedVault),
    appVersion: APP_VERSION,
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    totalSize,
    files,
  };
}

/* ── Manifest: Generate vault file manifest ── */
ipcMain.handle('vault:generateManifest', async (_e, vaultPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }

  const manifest = generateManifestData(vaultPath);

  /* Write manifest to .ars-note/manifest.json */
  const manifestPath = path.join(path.resolve(vaultPath), ARS_NOTE_DIR, MANIFEST_FILE);
  writeJson(manifestPath, manifest);

  return manifest;
});

/* ── Backup: Export vault backup ── */
type BackupExportOptions = {
  skipIfUnchanged?: boolean;
  keepLatest?: number;
};

type StorageSizeSummary = { size: number; fileCount: number };
type VaultStorageCleanupAction = 'prune-backups' | 'clean-generated-history' | 'prune-ai-conversations';

type VaultStorageBucket = {
  id: string;
  label: string;
  path: string;
  size: number;
  fileCount: number;
  cleanupAction?: VaultStorageCleanupAction | 'manual';
  safeToClean: boolean;
  description: string;
};

type VaultStorageReport = {
  vaultPath: string;
  checkedAt: string;
  totalSize: number;
  totalFileCount: number;
  backupPayloadSize: number;
  teamProductionSize: number;
  portableAiMemorySize: number;
  suggestedReclaimableSize: number;
  backupKeepLatest: number;
  buckets: VaultStorageBucket[];
  warnings: string[];
};

function getBackupsDir(vaultPath: string): string {
  return path.join(path.resolve(vaultPath), ARS_NOTE_DIR, BACKUP_DIR);
}

function getPathSizeSummary(targetPath: string): StorageSizeSummary {
  const summary: StorageSizeSummary = { size: 0, fileCount: 0 };
  if (!targetPath || !fs.existsSync(targetPath)) return summary;

  function walk(currentPath: string): void {
    let stat: fs.Stats;
    try { stat = fs.lstatSync(currentPath); } catch { return; }
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      summary.size += stat.size;
      summary.fileCount++;
      return;
    }
    if (!stat.isDirectory()) return;
    let entries: string[];
    try { entries = fs.readdirSync(currentPath); } catch { return; }
    for (const entry of entries) walk(path.join(currentPath, entry));
  }

  walk(targetPath);
  return summary;
}

function getVaultSizeSummary(vaultPath: string, options?: { skipGenerated?: boolean; aiPortableOnly?: boolean }): StorageSizeSummary {
  const resolvedVault = path.resolve(vaultPath);
  const summary: StorageSizeSummary = { size: 0, fileCount: 0 };

  function walk(currentPath: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(currentPath, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(currentPath, entry.name);
      const relPath = path.relative(resolvedVault, fullPath).replace(/\\/g, '/');
      if (options?.skipGenerated) {
        if (shouldSkipArsNoteInternalEntry(entry.name, path.basename(currentPath))) continue;
        if (shouldSkipHiddenEntry(entry.name)) continue;
        if (shouldSkipGeneratedVaultArtifact(relPath)) continue;
      }
      if (options?.aiPortableOnly) {
        if (relPath !== AI_MEMORY_DIR && !relPath.startsWith(`${AI_MEMORY_DIR}/`)) continue;
        if (shouldSkipGeneratedVaultArtifact(relPath)) continue;
      }
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = fs.statSync(fullPath);
        summary.size += stat.size;
        summary.fileCount++;
      } catch { /* skip unreadable files */ }
    }
  }

  walk(resolvedVault);
  return summary;
}

function getOldBackupSizeSummary(vaultPath: string, keepLatest: number): StorageSizeSummary {
  const safeKeepLatest = Math.max(1, Math.min(200, Math.floor(Number(keepLatest) || 20)));
  const oldBackups = listLocalBackupEntries(vaultPath).slice(safeKeepLatest);
  return oldBackups.reduce<StorageSizeSummary>((summary, backup) => {
    const actual = getPathSizeSummary(backup.backupPath);
    summary.size += actual.size || Number(backup.totalSize) || 0;
    summary.fileCount += actual.fileCount;
    return summary;
  }, { size: 0, fileCount: 0 });
}

function isLegacyGeneratedBackupArtifact(relativePath: string): boolean {
  const normalized = normalizeVaultRelativePath(relativePath);
  return (
    shouldSkipGeneratedVaultArtifact(normalized) ||
    normalized === `${ARS_NOTE_DIR}/${LIVE_HISTORY_DIR}` ||
    normalized.startsWith(`${ARS_NOTE_DIR}/${LIVE_HISTORY_DIR}/`)
  );
}

function getLegacyGeneratedBackupArtifactSummary(vaultPath: string): StorageSizeSummary {
  const backupsDir = getBackupsDir(vaultPath);
  const summary: StorageSizeSummary = { size: 0, fileCount: 0 };
  if (!fs.existsSync(backupsDir)) return summary;

  function walk(backupRoot: string, currentPath: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(currentPath, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(currentPath, entry.name);
      const relPath = path.relative(backupRoot, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (isLegacyGeneratedBackupArtifact(relPath)) {
          const dirSummary = getPathSizeSummary(fullPath);
          summary.size += dirSummary.size;
          summary.fileCount += dirSummary.fileCount;
          continue;
        }
        walk(backupRoot, fullPath);
        continue;
      }
      if (!entry.isFile() || !isLegacyGeneratedBackupArtifact(relPath)) continue;
      try {
        const stat = fs.statSync(fullPath);
        summary.size += stat.size;
        summary.fileCount++;
      } catch { /* skip unreadable files */ }
    }
  }

  try {
    for (const entry of fs.readdirSync(backupsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('backup_')) continue;
      const backupRoot = path.join(backupsDir, entry.name);
      walk(backupRoot, backupRoot);
    }
  } catch { /* best effort */ }

  return summary;
}

function getAiConversationPruneCandidates(vaultPath: string, keepLatest: number): Array<{ path: string; size: number }> {
  const historyDir = path.join(path.resolve(vaultPath), AI_MEMORY_DIR, 'history');
  if (!fs.existsSync(historyDir)) return [];
  const safeKeepLatest = Math.max(1, Math.min(50, Math.floor(Number(keepLatest) || 12)));
  const resolvedHistoryDir = path.resolve(historyDir);

  const candidates: Array<{ path: string; mtimeMs: number; size: number }> = [];
  try {
    for (const entry of fs.readdirSync(historyDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name === 'current-session.json') continue;
      const fullPath = path.resolve(path.join(historyDir, entry.name));
      if (!isInsidePath(fullPath, resolvedHistoryDir)) continue;
      try {
        const stat = fs.statSync(fullPath);
        candidates.push({ path: fullPath, mtimeMs: stat.mtimeMs, size: stat.size });
      } catch { /* skip unreadable */ }
    }
  } catch {
    return [];
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.path.localeCompare(a.path));
  return candidates.slice(safeKeepLatest).map(({ path: filePath, size }) => ({ path: filePath, size }));
}

function analyzeVaultStorage(vaultPath: string, keepLatestBackups = 2): VaultStorageReport {
  const resolvedVault = path.resolve(vaultPath);
  const safeKeepLatest = Math.max(1, Math.min(200, Math.floor(Number(keepLatestBackups) || 2)));
  const total = getPathSizeSummary(resolvedVault);
  const backupPayload = getVaultSizeSummary(resolvedVault, { skipGenerated: true });
  const portableAiMemory = getVaultSizeSummary(resolvedVault, { aiPortableOnly: true });
  const teamProductionPath = path.join(resolvedVault, TEAM_SCHEDULE_DIR);
  const backupsPath = path.join(resolvedVault, ARS_NOTE_DIR, BACKUP_DIR);
  const liveHistoryPath = path.join(resolvedVault, ARS_NOTE_DIR, LIVE_HISTORY_DIR);
  const generatedAiLiveHistoryPath = path.join(liveHistoryPath, AI_MEMORY_DIR);
  const downloadsPath = path.join(resolvedVault, ARS_NOTE_DIR, DOWNLOADS_DIR);
  const aiHistoryPath = path.join(resolvedVault, AI_MEMORY_DIR, 'history');
  const aiLiveSessionPath = path.join(resolvedVault, AI_MEMORY_DIR, 'live-session.json');
  const oldBackups = getOldBackupSizeSummary(resolvedVault, safeKeepLatest);
  const legacyGeneratedBackupArtifacts = getLegacyGeneratedBackupArtifactSummary(resolvedVault);
  const aiConversationCandidates = getAiConversationPruneCandidates(resolvedVault, 12);
  const aiConversationReclaimable = aiConversationCandidates.reduce<StorageSizeSummary>((summary, item) => {
    summary.size += item.size;
    summary.fileCount++;
    return summary;
  }, { size: 0, fileCount: 0 });

  const backups = getPathSizeSummary(backupsPath);
  const teamProduction = getPathSizeSummary(teamProductionPath);
  const liveHistory = getPathSizeSummary(liveHistoryPath);
  const generatedAiLiveHistory = getPathSizeSummary(generatedAiLiveHistoryPath);
  const downloads = getPathSizeSummary(downloadsPath);
  const aiHistory = getPathSizeSummary(aiHistoryPath);
  const aiLiveSession = getPathSizeSummary(aiLiveSessionPath);

  const buckets: VaultStorageBucket[] = [
    {
      id: 'backup-payload',
      label: 'Current backup payload',
      path: resolvedVault,
      size: backupPayload.size,
      fileCount: backupPayload.fileCount,
      safeToClean: false,
      description: 'User documents plus portable AI memory that should be kept and backed up.',
    },
    {
      id: 'team-production',
      label: 'Team production data',
      path: teamProductionPath,
      size: teamProduction.size,
      fileCount: teamProduction.fileCount,
      safeToClean: false,
      description: 'Team schedule, member tasks, workpacks, sprint plans, and AI production docs. Keep and sync this.',
    },
    {
      id: 'portable-ai-memory',
      label: 'Portable AI memory and skills',
      path: path.join(resolvedVault, AI_MEMORY_DIR),
      size: portableAiMemory.size,
      fileCount: portableAiMemory.fileCount,
      safeToClean: false,
      description: 'MEMORY.md, USER.md, SOUL.md, skills, crons, and evolution records.',
    },
    {
      id: 'local-backups',
      label: 'Local backup archive',
      path: backupsPath,
      size: backups.size,
      fileCount: backups.fileCount,
      cleanupAction: 'prune-backups',
      safeToClean: oldBackups.size > 0,
      description: `Old local backup folders. Cleanup keeps the newest ${safeKeepLatest}.`,
    },
    {
      id: 'legacy-generated-backup-artifacts',
      label: 'Legacy generated data inside backups',
      path: backupsPath,
      size: legacyGeneratedBackupArtifacts.size,
      fileCount: legacyGeneratedBackupArtifacts.fileCount,
      cleanupAction: 'prune-backups',
      safeToClean: false,
      description: 'AI chat/session files inside older backup folders. Create a fresh backup and prune older backups after confirming restore points are no longer needed.',
    },
    {
      id: 'live-history',
      label: 'Live history',
      path: liveHistoryPath,
      size: liveHistory.size,
      fileCount: liveHistory.fileCount,
      cleanupAction: 'clean-generated-history',
      safeToClean: generatedAiLiveHistory.size > 0,
      description: 'File version history. Generated AI session snapshots can be safely removed.',
    },
    {
      id: 'ai-conversations',
      label: 'AI conversation history',
      path: aiHistoryPath,
      size: aiHistory.size,
      fileCount: aiHistory.fileCount,
      cleanupAction: 'prune-ai-conversations',
      safeToClean: aiConversationReclaimable.size > 0,
      description: 'Local chat transcript JSON files. Long-term AI memory and skills are not stored here.',
    },
    {
      id: 'ai-live-session',
      label: 'AI live session',
      path: aiLiveSessionPath,
      size: aiLiveSession.size,
      fileCount: aiLiveSession.fileCount,
      safeToClean: false,
      description: 'Current AI chat mirror used for live cross-device handoff.',
    },
    {
      id: 'downloaded-backups',
      label: 'Downloaded backups',
      path: downloadsPath,
      size: downloads.size,
      fileCount: downloads.fileCount,
      cleanupAction: 'manual',
      safeToClean: false,
      description: 'Downloaded remote backups. Remove manually after confirming they are no longer needed.',
    },
  ];

  const suggestedReclaimableSize = oldBackups.size + generatedAiLiveHistory.size + aiConversationReclaimable.size;
  const warnings: string[] = [];
  if (backups.size > backupPayload.size * 10 && backups.size > 50 * 1024 * 1024) {
    warnings.push('Local backups are much larger than the active vault payload.');
  }
  if (legacyGeneratedBackupArtifacts.size > 0) {
    warnings.push('Some local backup folders still contain legacy AI chat/session files. They are not portable AI memory or skills; export a fresh backup, then prune older backups when safe.');
  }
  if (generatedAiLiveHistory.size > 10 * 1024 * 1024) {
    warnings.push('Generated AI live-session history is taking significant space.');
  }
  if (aiHistory.size > portableAiMemory.size * 20 && aiHistory.size > 10 * 1024 * 1024) {
    warnings.push('AI chat history is much larger than portable AI memory/skills.');
  }
  if (teamProduction.size > 50 * 1024 * 1024) {
    warnings.push('Team production data is large. Archive old generated workpacks before deleting anything.');
  }

  return {
    vaultPath: resolvedVault,
    checkedAt: new Date().toISOString(),
    totalSize: total.size,
    totalFileCount: total.fileCount,
    backupPayloadSize: backupPayload.size,
    teamProductionSize: teamProduction.size,
    portableAiMemorySize: portableAiMemory.size,
    suggestedReclaimableSize,
    backupKeepLatest: safeKeepLatest,
    buckets,
    warnings,
  };
}

function removeVaultPathIfSafe(targetPath: string, vaultPath: string): StorageSizeSummary {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedTarget = path.resolve(targetPath);
  if (!fs.existsSync(resolvedTarget) || resolvedTarget === resolvedVault || !isInsidePath(resolvedTarget, resolvedVault)) {
    return { size: 0, fileCount: 0 };
  }
  const summary = getPathSizeSummary(resolvedTarget);
  fs.rmSync(resolvedTarget, { recursive: true, force: true });
  return summary;
}

function cleanupGeneratedStorage(vaultPath: string): StorageSizeSummary {
  const resolvedVault = path.resolve(vaultPath);
  let deleted: StorageSizeSummary = { size: 0, fileCount: 0 };
  const targets = [
    path.join(resolvedVault, ARS_NOTE_DIR, LIVE_HISTORY_DIR, AI_MEMORY_DIR),
  ];

  for (const target of targets) {
    const summary = removeVaultPathIfSafe(target, resolvedVault);
    deleted.size += summary.size;
    deleted.fileCount += summary.fileCount;
  }

  const aiDir = path.join(resolvedVault, AI_MEMORY_DIR);
  if (fs.existsSync(aiDir)) {
    try {
      for (const entry of fs.readdirSync(aiDir, { withFileTypes: true })) {
        if (!entry.isFile() || !isConflictArtifactName(entry.name)) continue;
        const target = path.join(aiDir, entry.name);
        const summary = removeVaultPathIfSafe(target, resolvedVault);
        deleted.size += summary.size;
        deleted.fileCount += summary.fileCount;
      }
    } catch { /* keep best effort */ }
  }

  return deleted;
}

function pruneAiConversationHistory(vaultPath: string, keepLatest = 12): StorageSizeSummary {
  const deleted: StorageSizeSummary = { size: 0, fileCount: 0 };
  for (const item of getAiConversationPruneCandidates(vaultPath, keepLatest)) {
    const resolvedFile = path.resolve(item.path);
    const historyRoot = path.resolve(path.join(path.resolve(vaultPath), AI_MEMORY_DIR, 'history'));
    if (!isInsidePath(resolvedFile, historyRoot) || path.basename(resolvedFile) === 'current-session.json') continue;
    try {
      fs.unlinkSync(resolvedFile);
      deleted.size += item.size;
      deleted.fileCount++;
    } catch { /* skip locked or already removed files */ }
  }
  return deleted;
}

function readBackupManifest(backupDir: string): any | null {
  const manifestPath = path.join(backupDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

function resolveLocalBackupDir(vaultPath: string, backupPath: string): { resolvedVault: string; resolvedBackup: string; backupId: string; manifest: any } {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  if (!backupPath || !fs.existsSync(backupPath)) {
    throw new Error('Backup path not found');
  }

  const resolvedVault = path.resolve(vaultPath);
  const backupsDir = path.resolve(getBackupsDir(vaultPath));
  const resolvedBackup = path.resolve(backupPath);
  const backupId = path.basename(resolvedBackup);

  if (resolvedBackup === backupsDir || !isInsidePath(resolvedBackup, backupsDir)) {
    throw new Error('Backup must be inside current vault backups');
  }
  if (!backupId.startsWith('backup_')) {
    throw new Error('Only exported backup folders can be used');
  }
  if (!fs.statSync(resolvedBackup).isDirectory()) {
    throw new Error('Backup path is not a folder');
  }

  const manifest = readBackupManifest(resolvedBackup);
  if (!manifest) {
    throw new Error('Backup manifest not found');
  }

  return { resolvedVault, resolvedBackup, backupId, manifest };
}

function normalizeBackupFileRelativePath(relativePath: string): string {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalized || normalized.split('/').some(part => part === '..' || part === '')) {
    throw new Error('Invalid backup file path');
  }
  if (normalized.startsWith(`${ARS_NOTE_DIR}/`)) {
    throw new Error('Internal Ars-note files cannot be restored individually');
  }
  return normalized;
}

function listLocalBackupEntries(vaultPath: string): any[] {
  const backupsDir = getBackupsDir(vaultPath);
  if (!fs.existsSync(backupsDir)) return [];

  try {
    const entries = fs.readdirSync(backupsDir, { withFileTypes: true });
    const backups: any[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('backup_')) continue;

      const backupDir = path.join(backupsDir, entry.name);
      const manifestPath = path.join(backupDir, MANIFEST_FILE);
      const manifest = readBackupManifest(backupDir);
      if (!manifest) continue;

      backups.push({
        backupId: entry.name,
        backupPath: backupDir,
        generatedAt: manifest.generatedAt || '',
        fileCount: manifest.fileCount || 0,
        totalSize: manifest.totalSize || 0,
        manifestPath,
        manifest,
      });
    }

    backups.sort((a: any, b: any) => b.generatedAt.localeCompare(a.generatedAt));
    return backups;
  } catch {
    return [];
  }
}

function pruneLocalBackups(vaultPath: string, keepLatest: number): { keepLatest: number; deletedCount: number; deletedSize: number; deletedBackups: any[] } {
  const safeKeepLatest = Math.max(1, Math.min(200, Math.floor(Number(keepLatest) || 20)));
  const backups = listLocalBackupEntries(vaultPath);
  const toDelete = backups.slice(safeKeepLatest);
  const deletedBackups: any[] = [];
  let deletedSize = 0;

  for (const backup of toDelete) {
    const resolvedBackup = path.resolve(backup.backupPath);
    const backupsDir = path.resolve(getBackupsDir(vaultPath));
    if (resolvedBackup === backupsDir || !isInsidePath(resolvedBackup, backupsDir)) continue;
    if (!backup.backupId.startsWith('backup_')) continue;

    try {
      const actual = getPathSizeSummary(resolvedBackup);
      const totalSize = actual.size || Number(backup.totalSize) || 0;
      fs.rmSync(resolvedBackup, { recursive: true, force: false });
      deletedSize += totalSize;
      deletedBackups.push({ backupId: backup.backupId, backupPath: resolvedBackup, totalSize });
    } catch { /* keep going; the list can be refreshed afterward */ }
  }

  return {
    keepLatest: safeKeepLatest,
    deletedCount: deletedBackups.length,
    deletedSize,
    deletedBackups,
  };
}

ipcMain.handle('vault:exportBackup', async (_e, vaultPath: string, options?: BackupExportOptions) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }

  const resolvedVault = path.resolve(vaultPath);

  /* Generate manifest */
  const manifest = generateManifestData(vaultPath);

  if (options?.skipIfUnchanged) {
    const latestBackup = listLocalBackupEntries(vaultPath)[0];
    if (latestBackup?.manifest && computeManifestHash(latestBackup.manifest) === computeManifestHash(manifest)) {
      const prunedBackups = typeof options.keepLatest === 'number'
        ? pruneLocalBackups(vaultPath, options.keepLatest)
        : undefined;
      return {
        backupId: latestBackup.backupId,
        vaultName: manifest.vaultName,
        generatedAt: latestBackup.generatedAt || manifest.generatedAt,
        fileCount: manifest.fileCount,
        totalSize: manifest.totalSize,
        manifestPath: latestBackup.manifestPath,
        backupPath: latestBackup.backupPath,
        skipped: true,
        reason: 'unchanged',
        prunedBackups,
      };
    }
  }

  /* Create backup folder */
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const backupId = `backup_${timestamp}`;
  const backupDir = path.join(resolvedVault, ARS_NOTE_DIR, BACKUP_DIR, backupId);

  if (fs.existsSync(backupDir)) {
    throw new Error('Backup already exists at: ' + backupId);
  }
  fs.mkdirSync(backupDir, { recursive: true });

  /* Copy vault files — skip backups dir to prevent recursive copy */
  const BACKUP_SKIP = new Set(['node_modules', '.git', 'dist', 'out', '.cache', '__pycache__']);

  function copyVault(srcDir: string, destDir: string): void {
    try {
      const entries = fs.readdirSync(srcDir, { withFileTypes: true });
      for (const entry of entries) {
        if (isConflictArtifactName(entry.name)) continue;
        const srcPath = path.join(srcDir, entry.name);
        const relPath = path.relative(resolvedVault, srcPath).replace(/\\/g, '/');
        if (shouldSkipGeneratedVaultArtifact(relPath)) continue;

        if (shouldSkipArsNoteInternalEntry(entry.name, path.basename(srcDir))) continue;

        /* Skip hidden dirs (except .ars-note) and known dirs */
        if (isConflictArtifactName(entry.name)) continue;
        if (shouldSkipHiddenEntry(entry.name)) continue;
        if (BACKUP_SKIP.has(entry.name)) continue;

        const destPath = path.join(destDir, entry.name);

        if (entry.isDirectory()) {
          fs.mkdirSync(destPath, { recursive: true });
          copyVault(srcPath, destPath);
        } else {
          try {
            fs.copyFileSync(srcPath, destPath);
          } catch { /* skip unreadable */ }
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  copyVault(resolvedVault, backupDir);

  /* Write manifest at backup root */
  writeJson(path.join(backupDir, MANIFEST_FILE), manifest);

  const prunedBackups = typeof options?.keepLatest === 'number'
    ? pruneLocalBackups(vaultPath, options.keepLatest)
    : undefined;

  return {
    backupId,
    vaultName: manifest.vaultName,
    generatedAt: manifest.generatedAt,
    fileCount: manifest.fileCount,
    totalSize: manifest.totalSize,
    manifestPath: path.join(backupDir, MANIFEST_FILE),
    backupPath: backupDir,
    prunedBackups,
  };
});


/* ── Backup: List vault backups ── */
ipcMain.handle('vault:listBackups', async (_e, vaultPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }

  return listLocalBackupEntries(vaultPath).map(({ manifest, ...backup }) => backup);
});

ipcMain.handle('vault:analyzeStorage', async (_e, vaultPath: string, keepLatestBackups?: number) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return analyzeVaultStorage(vaultPath, keepLatestBackups);
});

ipcMain.handle('vault:cleanupStorage', async (_e, vaultPath: string, options?: {
  keepLatestBackups?: number;
  pruneBackups?: boolean;
  cleanGeneratedHistory?: boolean;
  pruneAiConversations?: boolean;
  keepAiConversations?: number;
}) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  const resolvedVault = path.resolve(vaultPath);
  const actions: Array<{ action: VaultStorageCleanupAction; deletedCount: number; deletedSize: number; detail: string }> = [];
  let deletedCount = 0;
  let deletedSize = 0;

  if (options?.pruneBackups) {
    const keepLatest = Math.max(1, Math.min(200, Math.floor(Number(options.keepLatestBackups) || 2)));
    const result = pruneLocalBackups(resolvedVault, keepLatest);
    const count = result.deletedCount || 0;
    const size = result.deletedBackups.reduce((sum, backup) => sum + (Number(backup.totalSize) || 0), 0) || result.deletedSize || 0;
    deletedCount += count;
    deletedSize += size;
    actions.push({
      action: 'prune-backups',
      deletedCount: count,
      deletedSize: size,
      detail: `Kept latest ${keepLatest} backup folders.`,
    });
  }

  if (options?.cleanGeneratedHistory) {
    const result = cleanupGeneratedStorage(resolvedVault);
    deletedCount += result.fileCount;
    deletedSize += result.size;
    actions.push({
      action: 'clean-generated-history',
      deletedCount: result.fileCount,
      deletedSize: result.size,
      detail: 'Removed generated AI live-session history and AI conflict snapshots.',
    });
  }

  if (options?.pruneAiConversations) {
    const keepLatest = Math.max(1, Math.min(50, Math.floor(Number(options.keepAiConversations) || 12)));
    const result = pruneAiConversationHistory(resolvedVault, keepLatest);
    deletedCount += result.fileCount;
    deletedSize += result.size;
    actions.push({
      action: 'prune-ai-conversations',
      deletedCount: result.fileCount,
      deletedSize: result.size,
      detail: `Kept latest ${keepLatest} AI conversation history files plus current-session.json.`,
    });
  }

  return {
    ok: true,
    cleanedAt: new Date().toISOString(),
    deletedCount,
    deletedSize,
    actions,
    report: analyzeVaultStorage(resolvedVault, options?.keepLatestBackups || 2),
  };
});

/* ── Backup: Restore vault from backup ── */
ipcMain.handle('vault:listBackupFiles', async (_e, vaultPath: string, backupPath: string) => {
  const { resolvedBackup, backupId, manifest } = resolveLocalBackupDir(vaultPath, backupPath);
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const visibleFiles = files
    .filter((file: any) => file && !file.deleted && typeof file.relativePath === 'string')
    .filter((file: any) => !String(file.relativePath).replace(/\\/g, '/').startsWith(`${ARS_NOTE_DIR}/`))
    .map((file: any) => {
      const relativePath = String(file.relativePath).replace(/\\/g, '/');
      const filePath = path.resolve(resolvedBackup, relativePath);
      const exists = isInsidePath(filePath, resolvedBackup) && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
      return {
        relativePath,
        type: file.type || 'other',
        size: Number(file.size) || 0,
        sha256: file.sha256 || '',
        updatedAt: file.updatedAt || '',
        exists,
      };
    })
    .sort((a: any, b: any) => a.relativePath.localeCompare(b.relativePath));

  return {
    backupId,
    backupPath: resolvedBackup,
    generatedAt: manifest.generatedAt || '',
    fileCount: visibleFiles.length,
    totalSize: visibleFiles.reduce((sum: number, file: any) => sum + (Number(file.size) || 0), 0),
    files: visibleFiles,
  };
});

ipcMain.handle('vault:restoreBackupFile', async (_e, vaultPath: string, backupPath: string, relativePath: string) => {
  const { resolvedVault, resolvedBackup, backupId } = resolveLocalBackupDir(vaultPath, backupPath);
  const safeRelativePath = normalizeBackupFileRelativePath(relativePath);
  const sourcePath = path.resolve(resolvedBackup, safeRelativePath);
  const targetPath = path.resolve(resolvedVault, safeRelativePath);

  if (!isInsidePath(sourcePath, resolvedBackup) || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error('Backup file not found');
  }
  if (!isInsidePath(targetPath, resolvedVault)) {
    throw new Error('Refusing to restore outside vault');
  }

  const nextContent = fs.readFileSync(sourcePath);
  if (fs.existsSync(targetPath)) {
    saveLiveHistoryBeforeOverwrite(targetPath, nextContent, 'before-backup-file-restore');
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, nextContent);

  return {
    ok: true,
    backupId,
    relativePath: safeRelativePath,
    restoredPath: targetPath,
    restoredAt: new Date().toISOString(),
    size: nextContent.length,
  };
});

ipcMain.handle('vault:pruneBackups', async (_e, vaultPath: string, keepLatest: number) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }

  return pruneLocalBackups(vaultPath, keepLatest);
});

/* Delete a local backup folder from .ars-note/backups. */
ipcMain.handle('vault:deleteBackup', async (_e, vaultPath: string, backupPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  if (!backupPath || !fs.existsSync(backupPath)) {
    throw new Error('Backup path not found');
  }

  const resolvedVault = path.resolve(vaultPath);
  const backupsDir = path.resolve(path.join(resolvedVault, ARS_NOTE_DIR, BACKUP_DIR));
  const resolvedBackup = path.resolve(backupPath);
  const backupId = path.basename(resolvedBackup);

  if (resolvedBackup === backupsDir || !isInsidePath(resolvedBackup, backupsDir)) {
    throw new Error('Cannot delete backup outside current vault');
  }
  if (!backupId.startsWith('backup_')) {
    throw new Error('Only exported backup folders can be deleted');
  }

  const stat = fs.statSync(resolvedBackup);
  if (!stat.isDirectory()) {
    throw new Error('Backup path is not a folder');
  }

  fs.rmSync(resolvedBackup, { recursive: true, force: false });

  return {
    backupId,
    backupPath: resolvedBackup,
    deletedAt: new Date().toISOString(),
  };
});

ipcMain.handle('vault:restoreBackup', async (_e, vaultPath: string, backupPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  if (!backupPath || !fs.existsSync(backupPath)) {
    throw new Error('Backup path not found');
  }

  const resolvedVault = path.resolve(vaultPath);
  const resolvedBackup = path.resolve(backupPath);

  /* Safety: backup must be inside .ars-note/backups */
  const backupsDir = path.join(resolvedVault, ARS_NOTE_DIR, BACKUP_DIR);
  if (!isInsidePath(resolvedBackup, backupsDir)) {
    throw new Error('Cannot restore to current vault');
  }

  /* Safety: cannot restore to the vault root itself */
  if (resolvedBackup === resolvedVault) {
    throw new Error('Cannot restore to current vault');
  }

  /* Read backup manifest for metadata */
  const manifestPath = path.join(resolvedBackup, MANIFEST_FILE);
  const manifest = readJsonSafe<any>(manifestPath, {});

  /* Create restore target: restored_vault_YYYYMMDD_HHmmss */
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const restoreDirName = `restored_vault_${timestamp}`;

  /* Place the restored vault as a sibling of the current vault */
  const vaultParent = path.dirname(resolvedVault);
  const restoreDir = path.join(vaultParent, restoreDirName);

  if (fs.existsSync(restoreDir)) {
    throw new Error('Restore target already exists: ' + restoreDirName);
  }
  fs.mkdirSync(restoreDir, { recursive: true });

  /* Skip list during restore copy */
  const RESTORE_SKIP = new Set(['node_modules', '.git', 'dist', 'out', '.cache', '__pycache__']);

  function copyBackupToRestore(srcDir: string, destDir: string): void {
    try {
      const entries = fs.readdirSync(srcDir, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);

        if (shouldSkipArsNoteInternalEntry(entry.name, path.basename(srcDir))) continue;

        /* Skip hidden dirs (except .ars-note) and known dirs */
        if (shouldSkipHiddenEntry(entry.name)) continue;
        if (RESTORE_SKIP.has(entry.name)) continue;

        const destPath = path.join(destDir, entry.name);

        if (entry.isDirectory()) {
          fs.mkdirSync(destPath, { recursive: true });
          copyBackupToRestore(srcPath, destPath);
        } else {
          try {
            fs.copyFileSync(srcPath, destPath);
          } catch { /* skip unreadable */ }
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  copyBackupToRestore(resolvedBackup, restoreDir);

  return {
    backupId: path.basename(resolvedBackup),
    restoredTo: restoreDir,
    restoredAt: new Date().toISOString(),
    fileCount: manifest.fileCount || 0,
    totalSize: manifest.totalSize || 0,
  };
});


/* ── Backup: Verify backup integrity ── */
ipcMain.handle('vault:verifyBackup', async (_e, vaultPath: string, backupPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  if (!backupPath || !fs.existsSync(backupPath)) {
    throw new Error('Backup path not found');
  }

  const resolvedBackup = path.resolve(backupPath);

  /* Read manifest from backup */
  const manifestPath = path.join(resolvedBackup, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Backup manifest not found');
  }

  let manifest: any;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    throw new Error('Failed to read backup manifest');
  }

  const files: any[] = manifest.files || [];
  const missingFiles: string[] = [];
  const hashMismatchFiles: string[] = [];
  const errors: string[] = [];
  let checkedFileCount = 0;

  for (const fileEntry of files) {
    const filePath = path.join(resolvedBackup, fileEntry.relativePath);

    /* Check if file exists */
    if (!fs.existsSync(filePath)) {
      missingFiles.push(fileEntry.relativePath);
      continue;
    }

    /* Compute SHA256 and compare */
    try {
      const buffer = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      checkedFileCount++;

      if (hash !== fileEntry.sha256) {
        hashMismatchFiles.push(fileEntry.relativePath);
      }
    } catch (err: any) {
      errors.push(`Failed to hash ${fileEntry.relativePath}: ${err.message}`);
    }
  }

  const valid = missingFiles.length === 0 && hashMismatchFiles.length === 0 && errors.length === 0;

  return {
    backupId: path.basename(resolvedBackup),
    checkedAt: new Date().toISOString(),
    valid,
    fileCount: files.length,
    checkedFileCount,
    missingFiles,
    hashMismatchFiles,
    totalSize: manifest.totalSize || 0,
    errors,
  };
});


/* ── Sync Config: Load ── */
ipcMain.handle('sync:loadConfig', async (_e, vaultPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }

  const resolvedVault = path.resolve(vaultPath);
  const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);

  /* Default config when file does not exist */
  const defaultConfig = {
    enabled: false,
    provider: 'local' as const,
    status: 'localOnly' as const,
  };

  if (!fs.existsSync(syncPath)) return defaultConfig;

  try {
    const raw = JSON.parse(fs.readFileSync(syncPath, 'utf-8'));
    /* Only keep non-sensitive fields */
    return {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : false,
      provider: ['local', 'supabase', 's3', 'self-hosted', 'custom'].includes(raw.provider) ? raw.provider : 'local',
      status: ['localOnly', 'notConfigured', 'configured', 'syncing', 'synced', 'error'].includes(raw.status) ? raw.status : 'localOnly',
      remoteVaultId: typeof raw.remoteVaultId === 'string' ? raw.remoteVaultId : undefined,
      lastSyncAt: typeof raw.lastSyncAt === 'string' ? raw.lastSyncAt : undefined,
      lastError: typeof raw.lastError === 'string' ? raw.lastError : undefined,
      endpoint: typeof raw.endpoint === 'string' ? raw.endpoint : undefined,
      bucket: typeof raw.bucket === 'string' ? raw.bucket : undefined,
    };
  } catch {
    return defaultConfig;
  }
});

/* ── Sync Config: Save ── */
ipcMain.handle('sync:saveConfig', async (_e, vaultPath: string, config: any) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }

  const resolvedVault = path.resolve(vaultPath);

  /* Blocklist of sensitive field names — never persist these */
  const SENSITIVE_KEYS = new Set([
    'apiKey', 'api_key', 'secretKey', 'secret_key', 'password', 'token',
    'accessToken', 'access_token', 'refreshToken', 'refresh_token',
    'secret', 'privateKey', 'private_key', 'credentials',
  ]);

  /* Filter out any sensitive keys that might have been injected */
  const safe: any = {};
  for (const [key, value] of Object.entries(config)) {
    /* Skip sensitive keys (case-insensitive) */
    const lowerKey = key.toLowerCase();
    let isSensitive = false;
    for (const sk of SENSITIVE_KEYS) {
      if (lowerKey.includes(sk.toLowerCase())) {
        isSensitive = true;
        break;
      }
    }
    if (isSensitive) continue;
    safe[key] = value;
  }

  const rawRemoteVaultId = typeof safe.remoteVaultId === 'string' ? safe.remoteVaultId.trim() : '';
  const normalizedRemoteVaultId = rawRemoteVaultId ? sanitizeRemoteVaultId(rawRemoteVaultId) : undefined;
  const provider = ['local', 'supabase', 's3', 'self-hosted', 'custom'].includes(safe.provider) ? safe.provider : 'local';
  if (rawRemoteVaultId && provider === 'self-hosted' && normalizedRemoteVaultId !== rawRemoteVaultId) {
    throw new Error(
      'Invalid Remote Vault ID. Use the exact Vault ID from the server admin page. ' +
      'Only letters, numbers, underscores, and dashes are allowed; do not enter the display name.',
    );
  }

  /* Validate and set defaults */
  const saved = {
    enabled: typeof safe.enabled === 'boolean' ? safe.enabled : false,
    provider,
    status: ['localOnly', 'notConfigured', 'configured', 'syncing', 'synced', 'error'].includes(safe.status) ? safe.status : 'localOnly',
    remoteVaultId: normalizedRemoteVaultId,
    lastSyncAt: typeof safe.lastSyncAt === 'string' ? safe.lastSyncAt : undefined,
    lastError: typeof safe.lastError === 'string' ? safe.lastError : undefined,
    endpoint: typeof safe.endpoint === 'string' ? safe.endpoint : undefined,
    bucket: typeof safe.bucket === 'string' ? safe.bucket : undefined,
  };

  /* Update status based on config */
  if (!saved.enabled) {
    saved.status = 'localOnly';
  } else if (saved.provider === 'local') {
    saved.status = 'localOnly';
  } else if (!saved.endpoint && saved.provider !== 'supabase') {
    saved.status = 'notConfigured';
  } else {
    saved.status = 'configured';
  }

  if (saved.enabled && saved.provider === 'self-hosted' && !saved.remoteVaultId) {
    saved.remoteVaultId = getVaultRemoteIdentity(resolvedVault, saved).vaultId;
  }

  const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
  writeJson(syncPath, saved);

  return saved;
});


/* ── Cloud Backup: Upload to Remote (Local Mock) ── */
/* ── S3 Runtime Credentials (v0.5.3) ── */
interface S3Creds {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  lastSetAt?: string;
}

const s3CredentialsMap = new Map<string, S3Creds>();

function getS3Creds(vaultPath: string): S3Creds | undefined {
  const resolved = path.resolve(vaultPath);
  return s3CredentialsMap.get(resolved);
}

/* ── Self-hosted runtime credentials (v0.8.2, memory-only) ── */
interface SelfHostedCreds {
  endpoint: string;
  apiKey: string;
  lastSetAt: string;
}

const selfHostedCredentialsMap = new Map<string, SelfHostedCreds>();

function getSelfHostedCreds(vaultPath: string): SelfHostedCreds | undefined {
  const resolved = path.resolve(vaultPath);
  return selfHostedCredentialsMap.get(resolved);
}

/** Build auth headers for self-hosted server requests (v0.8.2) */
function selfHostedAuthHeaders(vaultPath: string): Record<string, string> {
  const creds = getSelfHostedCreds(vaultPath);
  if (creds && creds.apiKey) {
    return { 'Authorization': 'Bearer ' + creds.apiKey };
  }
  const liveCfg = loadLiveSyncConfig(vaultPath);
  if (liveCfg?.apiKey) {
    return { 'Authorization': 'Bearer ' + liveCfg.apiKey };
  }
  return {};
}

/* ── Resolve active cloud provider from sync.json (v0.5.2) ── */
function resolveCloudProvider(vaultPath: string): { providerId: string; implemented: boolean } {
  const resolvedVault = path.resolve(vaultPath);
  const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
  let providerId = 'local-mock';

  if (fs.existsSync(syncPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(syncPath, 'utf-8'));
      const sp = raw.provider || 'local';
      /* Map legacy 'local' → 'local-mock' */
      providerId = sp === 'local' ? 'local-mock' : sp;
    } catch { /* keep default */ }
  }

  const IMPLEMENTED_PROVIDERS = new Set(['local-mock', 's3', 'self-hosted']);
  return { providerId, implemented: IMPLEMENTED_PROVIDERS.has(providerId) };
}

ipcMain.handle('cloud:uploadBackup', async (_e, vaultPath: string, backupPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  if (!backupPath || !fs.existsSync(backupPath)) {
    throw new Error('Backup path not found');
  }

  /* Provider gating (v0.5.3): route to correct provider */
  const { providerId: uploadProviderId } = resolveCloudProvider(vaultPath);
  if (uploadProviderId !== 'local-mock' && uploadProviderId !== 's3' && uploadProviderId !== 'self-hosted') {
    throw new Error('ProviderNotImplemented');
  }

  const resolvedVault = path.resolve(vaultPath);
  const resolvedBackup = path.resolve(backupPath);

  /* Safety: backup must be inside .ars-note/backups */
  const backupsDir = path.join(resolvedVault, ARS_NOTE_DIR, BACKUP_DIR);
  if (!isInsidePath(resolvedBackup, backupsDir)) {
    throw new Error('Backup must be a local vault backup');
  }

  /* Read manifest from backup */
  const manifestPath = path.join(resolvedBackup, MANIFEST_FILE);
  const manifest = readJsonSafe<any>(manifestPath, {});

  /* ── S3 Upload Branch (v0.5.3) ── */
  if (uploadProviderId === 's3') {
    const s3Creds = getS3Creds(vaultPath);
    if (!s3Creds) throw new Error('MissingS3Credentials');

    const remoteVaultId = sanitizeS3KeyPart(path.basename(resolvedVault));
    const backupId = sanitizeS3KeyPart(path.basename(resolvedBackup));
    const s3Prefix = buildS3BackupPrefix(remoteVaultId, backupId);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const remoteId = `s3_${timestamp}`;

    /* Collect files to upload */
    const COPY_SKIP = new Set(['node_modules', '.git', 'dist', 'out', '.cache', '__pycache__']);
    const filesToUpload: { relativePath: string; absPath: string }[] = [];
    function collectFiles(dir: string, base: string): void {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (shouldSkipArsNoteInternalEntry(entry.name, path.basename(dir))) continue;
          if (isConflictArtifactName(entry.name)) continue;
          if (shouldSkipHiddenEntry(entry.name)) continue;
          if (COPY_SKIP.has(entry.name)) continue;
          const fullPath = path.join(dir, entry.name);
          const rel = base ? `${base}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            collectFiles(fullPath, rel);
          } else {
            filesToUpload.push({ relativePath: rel, absPath: fullPath });
          }
        }
      } catch { /* skip */ }
    }
    collectFiles(resolvedBackup, '');

    let totalUploadedSize = 0;
    for (const file of filesToUpload) {
      const fileBuffer = fs.readFileSync(file.absPath);
      totalUploadedSize += fileBuffer.length;
      await s3PutObject(s3Creds, `${s3Prefix}/${file.relativePath}`, fileBuffer);
    }

    /* Upload manifest */
    const manifestBuffer = fs.readFileSync(manifestPath);
    await s3PutObject(s3Creds, `${s3Prefix}/${MANIFEST_FILE}`, manifestBuffer, 'application/json');

    /* Compute manifest hash */
    const manifestHash = crypto.createHash('sha256').update(manifestBuffer).digest('hex');

    /* Upload/update remote-index.json */
    const indexKey = buildS3RemoteIndexKey(remoteVaultId);
    let remoteIndex: any[] = [];
    try {
      const indexBuffer = await s3GetObject(s3Creds, indexKey);
      remoteIndex = JSON.parse(indexBuffer.toString('utf-8'));
    } catch { /* index doesn't exist yet */ }

    const indexEntry = {
      remoteId,
      backupId,
      provider: 's3',
      vaultName: manifest.vaultName || path.basename(resolvedVault),
      uploadedAt: now.toISOString(),
      fileCount: manifest.fileCount || filesToUpload.length,
      totalSize: manifest.totalSize || totalUploadedSize,
      manifestHash,
      s3Prefix,
    };
    remoteIndex.unshift(indexEntry);
    await s3PutObject(s3Creds, indexKey, Buffer.from(JSON.stringify(remoteIndex, null, 2)), 'application/json');

    return {
      remoteId: indexEntry.remoteId,
      backupId: indexEntry.backupId,
      provider: 's3',
      uploadedAt: indexEntry.uploadedAt,
      fileCount: indexEntry.fileCount,
      totalSize: indexEntry.totalSize,
      remotePath: s3Prefix,
    };
  }

  /* ── Self-hosted Upload Branch (v0.8.1) ── */
  if (uploadProviderId === 'self-hosted') {
    const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
    const syncCfg = readJsonSafe<any>(syncPath, {});
    const endpoint = syncCfg.endpoint;
    if (!endpoint) throw new Error('SelfHostedMissingEndpoint');

    /* Validate endpoint */
    if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      throw new Error('SelfHostedInvalidEndpoint');
    }

    const identity = getVaultRemoteIdentity(resolvedVault, syncCfg);
    const vaultId = identity.vaultId;
    const backupId = path.basename(resolvedBackup);
    const vaultName = manifest.vaultName || identity.vaultName || vaultId;

    if (syncCfg.remoteVaultId !== vaultId) {
      writeJson(syncPath, { ...syncCfg, remoteVaultId: vaultId });
    }

    /* 1. Register vault */
    try {
      await registerSelfHostedVault(endpoint, resolvedVault, { vaultId, vaultName });
    } catch (err: any) {
      throw new Error('SelfHostedConnectionFailed: ' + err.message);
    }

    /* 2. Upload metadata */
    const manifestBuffer = fs.readFileSync(manifestPath);
    const manifestHash = crypto.createHash('sha256').update(manifestBuffer).digest('hex');

    const metaRes = await fetch(endpoint.replace(/\/+$/, '') + '/api/backups/upload-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...selfHostedAuthHeaders(resolvedVault) },
      body: JSON.stringify({
        vaultId,
        backupId,
        manifest,
        manifestHash,
        fileCount: manifest.fileCount || 0,
        totalSize: manifest.totalSize || 0,
      }),
    });
    const metaData = await metaRes.json() as any;
    if (!metaData.ok) throw new Error('SelfHostedUploadMetaFailed: ' + (metaData.error || ''));

    /* 3. Collect and upload files */
    const COPY_SKIP = new Set(['node_modules', '.git', 'dist', 'out', '.cache', '__pycache__']);
    const filesToUpload: { relativePath: string; absPath: string }[] = [];
    function collectSelfHostedFiles(dir: string, base: string): void {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (shouldSkipArsNoteInternalEntry(entry.name, path.basename(dir))) continue;
          if (isConflictArtifactName(entry.name)) continue;
          if (shouldSkipHiddenEntry(entry.name)) continue;
          if (COPY_SKIP.has(entry.name)) continue;
          const fullPath = path.join(dir, entry.name);
          const rel = base ? base + '/' + entry.name : entry.name;
          if (entry.isDirectory()) {
            collectSelfHostedFiles(fullPath, rel);
          } else {
            filesToUpload.push({ relativePath: rel, absPath: fullPath });
          }
        }
      } catch { /* skip */ }
    }
    collectSelfHostedFiles(resolvedBackup, '');

    let totalUploadedSize = 0;
    for (const file of filesToUpload) {
      const fileBuffer = fs.readFileSync(file.absPath);
      const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      totalUploadedSize += fileBuffer.length;

      const fileRes = await fetch(endpoint.replace(/\/+$/, '') + '/api/backups/upload-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...selfHostedAuthHeaders(resolvedVault) },
        body: JSON.stringify({
          vaultId,
          backupId,
          relativePath: file.relativePath,
          contentBase64: fileBuffer.toString('base64'),
          sha256,
          size: fileBuffer.length,
        }),
      });
      const fileData = await fileRes.json() as any;
      if (!fileData.ok) {
        throw new Error('SelfHostedUploadFileFailed: ' + file.relativePath + ' - ' + (fileData.error || ''));
      }
    }

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) + '_' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    const remoteId = encodeSelfHostedRemoteId(vaultId, backupId);

    return {
      remoteId,
      backupId,
      provider: 'self-hosted',
      uploadedAt: now.toISOString(),
      fileCount: manifest.fileCount || filesToUpload.length,
      totalSize: manifest.totalSize || totalUploadedSize,
      remotePath: endpoint,
    };
  }

  /* ── Local Mock Upload Branch ── */

  /* Create remote mock directory */
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const remoteId = `remote_${timestamp}`;
  const remoteMockBase = path.join(resolvedVault, ARS_NOTE_DIR, REMOTE_MOCK_DIR);
  const remoteDir = path.join(remoteMockBase, remoteId);

  if (fs.existsSync(remoteDir)) {
    throw new Error('Remote backup already exists: ' + remoteId);
  }
  fs.mkdirSync(remoteDir, { recursive: true });

  /* Copy backup to remote mock */
  const COPY_SKIP = new Set(['node_modules', '.git', 'dist', 'out', '.cache', '__pycache__']);
  function copyToRemote(srcDir: string, destDir: string): void {
    try {
      const entries = fs.readdirSync(srcDir, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        if (shouldSkipArsNoteInternalEntry(entry.name, path.basename(srcDir))) continue;
        if (isConflictArtifactName(entry.name)) continue;
        if (shouldSkipHiddenEntry(entry.name)) continue;
        if (COPY_SKIP.has(entry.name)) continue;
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
          fs.mkdirSync(destPath, { recursive: true });
          copyToRemote(srcPath, destPath);
        } else {
          try { fs.copyFileSync(srcPath, destPath); } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }
  }

  copyToRemote(resolvedBackup, remoteDir);

  /* Compute manifest hash */
  const manifestContent = fs.readFileSync(path.join(remoteDir, MANIFEST_FILE), 'utf-8');
  const manifestHash = crypto.createHash('sha256').update(manifestContent).digest('hex');

  /* Update remote index */
  const indexPath = path.join(remoteMockBase, REMOTE_INDEX_FILE);
  const index = readJsonSafe<any[]>(indexPath, []);
  const entry = {
    remoteId,
    backupId: path.basename(resolvedBackup),
    provider: 'local-mock',
    vaultName: manifest.vaultName || path.basename(resolvedVault),
    uploadedAt: now.toISOString(),
    fileCount: manifest.fileCount || 0,
    totalSize: manifest.totalSize || 0,
    manifestHash,
    remotePath: remoteDir,
  };
  index.unshift(entry);
  writeJson(indexPath, index);

  return {
    remoteId: entry.remoteId,
    backupId: entry.backupId,
    provider: entry.provider,
    uploadedAt: entry.uploadedAt,
    fileCount: entry.fileCount,
    totalSize: entry.totalSize,
    remotePath: entry.remotePath,
  };
});

/* ── Cloud Backup: List Remote Backups ── */
ipcMain.handle('cloud:listRemote', async (_e, vaultPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }

  /* Provider routing (v0.5.3) */
  const { providerId: listProviderId } = resolveCloudProvider(vaultPath);
  if (listProviderId !== 'local-mock' && listProviderId !== 's3' && listProviderId !== 'self-hosted') {
    throw new Error('ProviderNotImplemented');
  }

  const resolvedVault = path.resolve(vaultPath);

  /* ── S3 List Branch ── */
  if (listProviderId === 's3') {
    const s3Creds = getS3Creds(vaultPath);
    if (!s3Creds) throw new Error('MissingS3Credentials');
    const remoteVaultId = sanitizeS3KeyPart(path.basename(resolvedVault));
    const indexKey = buildS3RemoteIndexKey(remoteVaultId);
    try {
      const indexBuffer = await s3GetObject(s3Creds, indexKey);
      const index = JSON.parse(indexBuffer.toString('utf-8'));
      return index.map((entry: any) => ({
        remoteId: entry.remoteId,
        backupId: entry.backupId,
        provider: entry.provider || 's3',
        vaultName: entry.vaultName,
        uploadedAt: entry.uploadedAt,
        fileCount: entry.fileCount,
        totalSize: entry.totalSize,
        manifestHash: entry.manifestHash || '',
        remotePath: entry.s3Prefix || entry.remotePath,
      }));
    } catch { return []; }
  }

  /* ── Self-hosted List Branch (v0.8.1) ── */
  if (listProviderId === 'self-hosted') {
    const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
    const syncCfg = readJsonSafe<any>(syncPath, {});
    const endpoint = syncCfg.endpoint;
    if (!endpoint) return [];

    const identity = getVaultRemoteIdentity(resolvedVault, syncCfg);
    const vaultId = identity.vaultId;
    const ep = endpoint.replace(/\/+$/, '');

    try {
      const shHeaders = selfHostedAuthHeaders(resolvedVault);
      await registerSelfHostedVault(ep, resolvedVault, identity);

      const res = await fetch(ep + '/api/backups/list?vaultId=' + encodeURIComponent(vaultId), {
        headers: Object.keys(shHeaders).length > 0 ? shHeaders : undefined,
      });
      const data = await res.json() as any;
      const exactBackups = data.ok && data.backups ? data.backups : [];
      if (exactBackups.length > 0) {
        return exactBackups.map((b: any) => ({
          remoteId: encodeSelfHostedRemoteId(vaultId, b.backupId),
          backupId: b.backupId,
          provider: 'self-hosted',
          vaultName: identity.vaultName,
          uploadedAt: b.uploadedAt,
          fileCount: b.fileCount,
          totalSize: b.totalSize,
          manifestHash: b.manifestHash || '',
          remotePath: endpoint,
        }));
      }

      const allRes = await fetch(ep + '/api/backups/list-all', {
        headers: Object.keys(shHeaders).length > 0 ? shHeaders : undefined,
      });
      const allData = await allRes.json() as any;
      if (!allData.ok || !allData.backups) return [];

      return allData.backups.map((b: any) => ({
        remoteId: encodeSelfHostedRemoteId(b.vaultId || vaultId, b.backupId),
        backupId: b.backupId,
        provider: 'self-hosted',
        vaultName: b.vaultName || '',
        uploadedAt: b.uploadedAt,
        fileCount: b.fileCount,
        totalSize: b.totalSize,
        manifestHash: b.manifestHash || '',
        remotePath: endpoint,
      }));
    } catch { return []; }
  }

  /* ── Local Mock List Branch ── */
  const indexPath = path.join(resolvedVault, ARS_NOTE_DIR, REMOTE_MOCK_DIR, REMOTE_INDEX_FILE);

  if (!fs.existsSync(indexPath)) return [];

  try {
    const index = readJsonSafe<any[]>(indexPath, []);
    /* Validate entries still exist on disk */
    return index.filter((entry: any) => entry.remotePath && fs.existsSync(entry.remotePath));
  } catch { return []; }
});

/* ── Cloud Backup: Download Remote Backup ── */
ipcMain.handle('cloud:deleteRemoteBackup', async (_e, vaultPath: string, remoteId: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  if (!remoteId) throw new Error('Remote ID is required');

  const { providerId } = resolveCloudProvider(vaultPath);
  if (providerId !== 'local-mock' && providerId !== 's3' && providerId !== 'self-hosted') {
    throw new Error('ProviderNotImplemented');
  }

  const resolvedVault = path.resolve(vaultPath);

  if (providerId === 's3') {
    const s3Creds = getS3Creds(vaultPath);
    if (!s3Creds) throw new Error('MissingS3Credentials');

    const remoteVaultId = sanitizeS3KeyPart(path.basename(resolvedVault));
    const indexKey = buildS3RemoteIndexKey(remoteVaultId);
    let remoteIndex: any[] = [];
    try {
      const indexBuffer = await s3GetObject(s3Creds, indexKey);
      remoteIndex = JSON.parse(indexBuffer.toString('utf-8'));
    } catch {
      throw new Error('Remote index not found on S3');
    }

    const entry = remoteIndex.find((item: any) => item.remoteId === remoteId);
    if (!entry) throw new Error('Remote backup not found: ' + remoteId);

    const s3Prefix = entry.s3Prefix || entry.remotePath;
    const objectKeys = await s3ListObjects(s3Creds, s3Prefix);
    for (const key of objectKeys) {
      await s3DeleteObject(s3Creds, key);
    }

    remoteIndex = remoteIndex.filter((item: any) => item.remoteId !== remoteId);
    await s3PutObject(s3Creds, indexKey, Buffer.from(JSON.stringify(remoteIndex, null, 2)), 'application/json');

    return {
      remoteId,
      backupId: entry.backupId || '',
      provider: 's3',
      deletedAt: new Date().toISOString(),
      deletedFiles: objectKeys.length,
    };
  }

  if (providerId === 'self-hosted') {
    const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
    const syncCfg = readJsonSafe<any>(syncPath, {});
    const endpoint = syncCfg.endpoint;
    if (!endpoint) throw new Error('SelfHostedMissingEndpoint');

    const identity = getVaultRemoteIdentity(resolvedVault, syncCfg);
    const decoded = decodeSelfHostedRemoteId(remoteId);
    const vaultId = decoded.vaultId || identity.vaultId;
    const backupId = decoded.backupId;
    const ep = endpoint.replace(/\/+$/, '');

    await registerSelfHostedVault(ep, resolvedVault, { vaultId, vaultName: identity.vaultName });
    const res = await fetch(ep + '/api/backups/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...selfHostedAuthHeaders(resolvedVault) },
      body: JSON.stringify({ vaultId, backupId }),
    });
    const data = await res.json() as any;
    if (!data.ok) throw new Error('SelfHostedDeleteFailed: ' + (data.error || ''));

    return {
      remoteId,
      backupId,
      provider: 'self-hosted',
      deletedAt: data.deletedAt || new Date().toISOString(),
      deleted: data.deleted,
    };
  }

  const remoteMockBase = path.join(resolvedVault, ARS_NOTE_DIR, REMOTE_MOCK_DIR);
  const indexPath = path.join(remoteMockBase, REMOTE_INDEX_FILE);
  const index = readJsonSafe<any[]>(indexPath, []);
  const entry = index.find((item: any) => item.remoteId === remoteId);
  if (!entry) throw new Error('Remote backup not found: ' + remoteId);

  const remotePath = path.resolve(entry.remotePath || path.join(remoteMockBase, remoteId));
  const resolvedRemoteBase = path.resolve(remoteMockBase);
  if (remotePath !== resolvedRemoteBase && isInsidePath(remotePath, resolvedRemoteBase) && fs.existsSync(remotePath)) {
    fs.rmSync(remotePath, { recursive: true, force: true });
  }

  writeJson(indexPath, index.filter((item: any) => item.remoteId !== remoteId));

  return {
    remoteId,
    backupId: entry.backupId || '',
    provider: 'local-mock',
    deletedAt: new Date().toISOString(),
  };
});

ipcMain.handle('cloud:downloadBackup', async (_e, vaultPath: string, remoteId: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  if (!remoteId) throw new Error('Remote ID is required');

  /* Provider routing (v0.5.3) */
  const { providerId: downloadProviderId } = resolveCloudProvider(vaultPath);
  if (downloadProviderId !== 'local-mock' && downloadProviderId !== 's3' && downloadProviderId !== 'self-hosted') {
    throw new Error('ProviderNotImplemented');
  }

  const resolvedVault = path.resolve(vaultPath);

  /* ── S3 Download Branch ── */
  if (downloadProviderId === 's3') {
    const s3Creds = getS3Creds(vaultPath);
    if (!s3Creds) throw new Error('MissingS3Credentials');

    const remoteVaultId = sanitizeS3KeyPart(path.basename(resolvedVault));
    const indexKey = buildS3RemoteIndexKey(remoteVaultId);

    /* Find remote entry in S3 index */
    let remoteIndex: any[] = [];
    try {
      const indexBuffer = await s3GetObject(s3Creds, indexKey);
      remoteIndex = JSON.parse(indexBuffer.toString('utf-8'));
    } catch { throw new Error('Remote index not found on S3'); }

    const entry = remoteIndex.find((e: any) => e.remoteId === remoteId);
    if (!entry) throw new Error('Remote backup not found: ' + remoteId);

    /* List objects under s3Prefix */
    const s3Prefix = entry.s3Prefix || entry.remotePath;
    const objectKeys = await s3ListObjects(s3Creds, s3Prefix);

    /* Create download directory */
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const downloadDirName = `s3_${timestamp}`;
    const downloadsBase = path.join(resolvedVault, ARS_NOTE_DIR, DOWNLOADS_DIR);
    const downloadDir = path.join(downloadsBase, downloadDirName);

    if (fs.existsSync(downloadDir)) {
      throw new Error('Download target already exists: ' + downloadDirName);
    }
    fs.mkdirSync(downloadDir, { recursive: true });

    /* Download each object */
    let totalDownloadSize = 0;
    for (const key of objectKeys) {
      const relPath = key.substring(s3Prefix.length + 1);
      if (!relPath) continue;
      const destPath = path.join(downloadDir, relPath);
      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      try {
        const buffer = await s3GetObject(s3Creds, key);
        totalDownloadSize += buffer.length;
        fs.writeFileSync(destPath, buffer);
      } catch { /* skip individual file errors */ }
    }

    /* Read downloaded manifest for file count */
    const dlManifest = readJsonSafe<any>(path.join(downloadDir, MANIFEST_FILE), {});

    return {
      remoteId,
      downloadedTo: downloadDir,
      downloadedAt: new Date().toISOString(),
      fileCount: dlManifest.fileCount || entry.fileCount || 0,
      totalSize: dlManifest.totalSize || totalDownloadSize,
    };
  }

  /* ── Self-hosted Download Branch (v0.8.1) ── */
  if (downloadProviderId === 'self-hosted') {
    const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
    const syncCfg = readJsonSafe<any>(syncPath, {});
    const endpoint = syncCfg.endpoint;
    if (!endpoint) throw new Error('SelfHostedMissingEndpoint');

    const identity = getVaultRemoteIdentity(resolvedVault, syncCfg);
    const decodedRemote = decodeSelfHostedRemoteId(remoteId);
    const vaultId = decodedRemote.vaultId || identity.vaultId;
    const ep = endpoint.replace(/\/+$/, '');
    const backupId = decodedRemote.backupId;
    await registerSelfHostedVault(ep, resolvedVault, identity);

    /* 1. Get manifest */
    const dlHeaders = selfHostedAuthHeaders(resolvedVault);
    const manifestRes = await fetch(ep + '/api/backups/manifest?vaultId=' + encodeURIComponent(vaultId) + '&backupId=' + encodeURIComponent(backupId), {
      headers: Object.keys(dlHeaders).length > 0 ? dlHeaders : undefined,
    });
    const manifestData = await manifestRes.json() as any;
    if (!manifestData.ok) throw new Error('SelfHostedManifestNotFound: ' + (manifestData.error || ''));

    const manifest = manifestData.manifest || {};

    /* 2. Create download directory */
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) + '_' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    const downloadDirName = 'selfhosted_' + timestamp;
    const downloadsBase = path.join(resolvedVault, ARS_NOTE_DIR, DOWNLOADS_DIR);
    const downloadDir = path.join(downloadsBase, downloadDirName);

    if (fs.existsSync(downloadDir)) {
      throw new Error('Download target already exists: ' + downloadDirName);
    }
    fs.mkdirSync(downloadDir, { recursive: true });

    /* 3. Download each file from manifest */
    const files = manifest.files || [];
    let totalDownloadSize = 0;
    for (const fileEntry of files) {
      const relPath = fileEntry.relativePath || fileEntry.path || '';
      if (!relPath) continue;

      try {
        const fileRes = await fetch(ep + '/api/backups/download-file?vaultId=' + encodeURIComponent(vaultId) + '&backupId=' + encodeURIComponent(backupId) + '&relativePath=' + encodeURIComponent(relPath), {
          headers: Object.keys(dlHeaders).length > 0 ? dlHeaders : undefined,
        });
        const fileData = await fileRes.json() as any;
        if (!fileData.ok || !fileData.contentBase64) continue;

        const fileBuffer = Buffer.from(fileData.contentBase64, 'base64');
        totalDownloadSize += fileBuffer.length;

        /* Safety: write file inside download directory only */
        const destPath = path.join(downloadDir, relPath);
        const destDir = path.dirname(destPath);
        const resolvedDest = path.resolve(destPath);
        const resolvedDlDir = path.resolve(downloadDir);
        if (!resolvedDest.startsWith(resolvedDlDir + path.sep) && resolvedDest !== resolvedDlDir) {
          continue; /* skip path escape */
        }
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(destPath, fileBuffer);
      } catch { /* skip individual file errors */ }
    }

    /* Also save manifest */
    const manifestOut = path.join(downloadDir, MANIFEST_FILE);
    fs.writeFileSync(manifestOut, JSON.stringify({
      ...manifest,
      remoteId,
      backupId,
      downloadedAt: new Date().toISOString(),
      fileCount: files.length,
      totalSize: totalDownloadSize,
    }, null, 2));

    return {
      remoteId,
      downloadedTo: downloadDir,
      downloadedAt: new Date().toISOString(),
      fileCount: files.length,
      totalSize: totalDownloadSize,
    };
  }

  /* ── Local Mock Download Branch ── */

  /* Find the remote entry in index */
  const indexPath = path.join(resolvedVault, ARS_NOTE_DIR, REMOTE_MOCK_DIR, REMOTE_INDEX_FILE);
  const index = readJsonSafe<any[]>(indexPath, []);
  const entry = index.find((e: any) => e.remoteId === remoteId);
  if (!entry || !entry.remotePath || !fs.existsSync(entry.remotePath)) {
    throw new Error('Remote backup not found: ' + remoteId);
  }

  /* Safety: remote path must be inside .ars-note/remote-mock */
  const remoteMockBase = path.join(resolvedVault, ARS_NOTE_DIR, REMOTE_MOCK_DIR);
  const resolvedRemote = path.resolve(entry.remotePath);
  if (!isInsidePath(resolvedRemote, remoteMockBase)) {
    throw new Error('Cannot download from outside remote-mock folder');
  }

  /* Create download directory */
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const downloadDirName = `remote_${timestamp}`;
  const downloadsBase = path.join(resolvedVault, ARS_NOTE_DIR, DOWNLOADS_DIR);
  const downloadDir = path.join(downloadsBase, downloadDirName);

  if (fs.existsSync(downloadDir)) {
    throw new Error('Download target already exists: ' + downloadDirName);
  }
  fs.mkdirSync(downloadDir, { recursive: true });

  /* Copy remote backup to downloads */
  const COPY_SKIP = new Set(['node_modules', '.git', 'dist', 'out', '.cache', '__pycache__']);
  function copyToDownload(srcDir: string, destDir: string): void {
    try {
      const entries = fs.readdirSync(srcDir, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        if (shouldSkipArsNoteInternalEntry(entry.name, path.basename(srcDir))) continue;
        if (isConflictArtifactName(entry.name)) continue;
        if (shouldSkipHiddenEntry(entry.name)) continue;
        if (COPY_SKIP.has(entry.name)) continue;
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
          fs.mkdirSync(destPath, { recursive: true });
          copyToDownload(srcPath, destPath);
        } else {
          try { fs.copyFileSync(srcPath, destPath); } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }
  }

  copyToDownload(resolvedRemote, downloadDir);

  /* Read manifest for file count/size */
  const dlManifest = readJsonSafe<any>(path.join(downloadDir, MANIFEST_FILE), {});

  return {
    remoteId,
    downloadedTo: downloadDir,
    downloadedAt: new Date().toISOString(),
    fileCount: dlManifest.fileCount || entry.fileCount || 0,
    totalSize: dlManifest.totalSize || entry.totalSize || 0,
  };
});


/* ── Shared: verify any backup folder by manifest ── */
function verifyBackupFolder(backupDir: string): any {
  const manifestPath = path.join(backupDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Backup manifest not found');
  }

  let manifest: any;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    throw new Error('Failed to read backup manifest');
  }

  const files: any[] = manifest.files || [];
  const missingFiles: string[] = [];
  const hashMismatchFiles: string[] = [];
  const errors: string[] = [];
  let checkedFileCount = 0;

  for (const fileEntry of files) {
    const filePath = path.join(backupDir, fileEntry.relativePath);
    if (!fs.existsSync(filePath)) {
      missingFiles.push(fileEntry.relativePath);
      continue;
    }
    try {
      const buffer = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      checkedFileCount++;
      if (hash !== fileEntry.sha256) {
        hashMismatchFiles.push(fileEntry.relativePath);
      }
    } catch (err: any) {
      errors.push(`Failed to hash ${fileEntry.relativePath}: ${err.message}`);
    }
  }

  const valid = missingFiles.length === 0 && hashMismatchFiles.length === 0 && errors.length === 0;

  return {
    backupId: path.basename(backupDir),
    checkedAt: new Date().toISOString(),
    valid,
    fileCount: files.length,
    checkedFileCount,
    missingFiles,
    hashMismatchFiles,
    totalSize: manifest.totalSize || 0,
    errors,
  };
}

/* ── Shared: restore any backup folder to a sibling directory ── */
function restoreBackupFolder(sourceDir: string, vaultPath: string, prefix: string): any {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedSource = path.resolve(sourceDir);

  /* Safety: source must be inside .ars-note */
  const arsNoteDir = path.join(resolvedVault, ARS_NOTE_DIR);
  if (!isInsidePath(resolvedSource, arsNoteDir)) {
    throw new Error('Cannot restore from outside vault .ars-note directory');
  }

  /* Read manifest */
  const manifest = readJsonSafe<any>(path.join(resolvedSource, MANIFEST_FILE), {});

  /* Create restore target as sibling of current vault */
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const restoreDirName = `${prefix}_${timestamp}`;
  const vaultParent = path.dirname(resolvedVault);
  const restoreDir = path.join(vaultParent, restoreDirName);

  if (fs.existsSync(restoreDir)) {
    throw new Error('Restore target already exists: ' + restoreDirName);
  }
  fs.mkdirSync(restoreDir, { recursive: true });

  const RESTORE_SKIP = new Set(['node_modules', '.git', 'dist', 'out', '.cache', '__pycache__']);

  let copiedFiles = 0;

  function copyRestore(srcDir: string, destDir: string): void {
    try {
      const entries = fs.readdirSync(srcDir, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        /* Skip nested backups/remote-mock/downloads inside .ars-note */
        if (shouldSkipArsNoteInternalEntry(entry.name, path.basename(srcDir))) continue;
        if (isConflictArtifactName(entry.name)) continue;
        if (shouldSkipHiddenEntry(entry.name)) continue;
        if (RESTORE_SKIP.has(entry.name)) continue;
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
          fs.mkdirSync(destPath, { recursive: true });
          copyRestore(srcPath, destPath);
        } else {
          try {
            fs.copyFileSync(srcPath, destPath);
            copiedFiles++;
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }
  }

  copyRestore(resolvedSource, restoreDir);

  if (copiedFiles === 0) {
    fs.rmSync(restoreDir, { recursive: true, force: true });
    throw new Error('Restore failed: no files were copied from the backup');
  }
  if (!isValidVault(restoreDir)) {
    fs.rmSync(restoreDir, { recursive: true, force: true });
    throw new Error('Restore failed: restored folder is missing vault metadata');
  }

  return {
    backupId: path.basename(resolvedSource),
    restoredTo: restoreDir,
    restoredAt: new Date().toISOString(),
    fileCount: manifest.fileCount || 0,
    totalSize: manifest.totalSize || 0,
  };
}

/* ── Cloud: List downloaded backups ── */
/* ── S3 Runtime Credentials IPC (v0.5.3) ── */
function makeBackupTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function shouldSkipRestoreEntry(entryName: string, parentDirName: string, options?: { skipManifestRoot?: boolean; sourceRootName?: string }): boolean {
  const RESTORE_SKIP = new Set(['node_modules', '.git', 'dist', 'out', '.cache', '__pycache__']);
  if (isConflictArtifactName(entryName)) return true;
  if (options?.skipManifestRoot && parentDirName === options.sourceRootName && entryName === MANIFEST_FILE) return true;
  if (shouldSkipArsNoteInternalEntry(entryName, parentDirName)) return true;
  if (shouldSkipHiddenEntry(entryName)) return true;
  return RESTORE_SKIP.has(entryName);
}

function copyVaultTreeForRestore(srcDir: string, destDir: string, sourceRoot: string): { fileCount: number; totalSize: number } {
  const resolvedSourceRoot = path.resolve(sourceRoot);
  let fileCount = 0;
  let totalSize = 0;

  function copyTree(currentSrc: string, currentDest: string): void {
    const entries = fs.readdirSync(currentSrc, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const parentDirName = path.basename(currentSrc);
      const srcPath = path.join(currentSrc, entry.name);
      const relPath = path.relative(resolvedSourceRoot, srcPath).replace(/\\/g, '/');
      if (shouldSkipGeneratedVaultArtifact(relPath)) continue;
      if (shouldSkipRestoreEntry(entry.name, parentDirName, {
        skipManifestRoot: path.resolve(currentSrc) === resolvedSourceRoot,
        sourceRootName: path.basename(resolvedSourceRoot),
      })) continue;

      const destPath = path.join(currentDest, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        copyTree(srcPath, destPath);
      } else if (entry.isFile()) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
        const stat = fs.statSync(destPath);
        fileCount++;
        totalSize += stat.size;
      }
    }
  }

  copyTree(srcDir, destDir);
  return { fileCount, totalSize };
}

function createSafetyBackupBeforeApply(vaultPath: string): { backupId: string; backupPath: string; fileCount: number; totalSize: number } {
  const resolvedVault = path.resolve(vaultPath);
  const backupId = `safety_before_restore_${makeBackupTimestamp()}`;
  const backupPath = path.join(resolvedVault, ARS_NOTE_DIR, BACKUP_DIR, backupId);

  if (fs.existsSync(backupPath)) {
    throw new Error('Safety backup already exists: ' + backupId);
  }

  fs.mkdirSync(backupPath, { recursive: true });
  const copied = copyVaultTreeForRestore(resolvedVault, backupPath, resolvedVault);
  writeJson(path.join(backupPath, MANIFEST_FILE), generateManifestData(resolvedVault));

  return {
    backupId,
    backupPath,
    fileCount: copied.fileCount,
    totalSize: copied.totalSize,
  };
}

function removeVaultChild(targetPath: string, vaultPath: string): void {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedVault = path.resolve(vaultPath);
  if (resolvedTarget === resolvedVault || !isInsidePath(resolvedTarget, resolvedVault)) {
    throw new Error('Refusing to remove path outside current vault');
  }
  fs.rmSync(resolvedTarget, { recursive: true, force: true });
}

function clearCurrentVaultForApply(vaultPath: string): void {
  const resolvedVault = path.resolve(vaultPath);
  const entries = fs.readdirSync(resolvedVault, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ARS_NOTE_DIR && entry.isDirectory()) {
      const arsNotePath = path.join(resolvedVault, ARS_NOTE_DIR);
      const metaEntries = fs.readdirSync(arsNotePath, { withFileTypes: true });
      for (const metaEntry of metaEntries) {
        if (shouldSkipArsNoteInternalEntry(metaEntry.name, ARS_NOTE_DIR)) continue;
        removeVaultChild(path.join(arsNotePath, metaEntry.name), resolvedVault);
      }
      continue;
    }

    if ((entry.name.startsWith('.') && entry.name !== AI_MEMORY_DIR) || shouldSkipRestoreEntry(entry.name, path.basename(resolvedVault))) continue;
    removeVaultChild(path.join(resolvedVault, entry.name), resolvedVault);
  }
}

function applyBackupFolderToCurrentVault(sourceDir: string, vaultPath: string): any {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedSource = path.resolve(sourceDir);
  const downloadsDir = path.join(resolvedVault, ARS_NOTE_DIR, DOWNLOADS_DIR);

  if (!isInsidePath(resolvedSource, downloadsDir)) {
    throw new Error('Cannot apply backup from outside downloads folder');
  }
  if (!isValidVault(resolvedSource)) {
    throw new Error('Downloaded backup is missing vault metadata');
  }

  const manifest = readJsonSafe<any>(path.join(resolvedSource, MANIFEST_FILE), {});
  const currentSyncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
  const currentSyncConfig = fs.existsSync(currentSyncPath) ? fs.readFileSync(currentSyncPath, 'utf-8') : null;
  const sourceSyncPath = path.join(resolvedSource, ARS_NOTE_DIR, SYNC_FILE);
  const safetyBackup = createSafetyBackupBeforeApply(resolvedVault);

  try {
    clearCurrentVaultForApply(resolvedVault);
    const copied = copyVaultTreeForRestore(resolvedSource, resolvedVault, resolvedSource);

    if (!fs.existsSync(sourceSyncPath) && currentSyncConfig) {
      fs.mkdirSync(path.dirname(currentSyncPath), { recursive: true });
      fs.writeFileSync(currentSyncPath, currentSyncConfig, 'utf-8');
    }

    if (copied.fileCount === 0) {
      throw new Error('Restore failed: no files were copied from the downloaded backup');
    }
    if (!isValidVault(resolvedVault)) {
      throw new Error('Restore failed: current vault is missing metadata after apply');
    }

    return {
      backupId: path.basename(resolvedSource),
      restoredTo: resolvedVault,
      restoredAt: new Date().toISOString(),
      fileCount: manifest.fileCount || copied.fileCount,
      totalSize: manifest.totalSize || copied.totalSize,
      appliedToCurrentVault: true,
      safetyBackupPath: safetyBackup.backupPath,
    };
  } catch (err) {
    try {
      clearCurrentVaultForApply(resolvedVault);
      copyVaultTreeForRestore(safetyBackup.backupPath, resolvedVault, safetyBackup.backupPath);
    } catch { /* keep original restore error */ }
    throw err;
  }
}

ipcMain.handle('s3:setCredentials', async (_e, vaultPath: string, credentials: any) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  const resolvedVault = path.resolve(vaultPath);
  const now = new Date().toISOString();
  s3CredentialsMap.set(resolvedVault, {
    endpoint: credentials.endpoint || '',
    region: credentials.region || 'us-east-1',
    bucket: credentials.bucket || '',
    accessKeyId: credentials.accessKeyId || '',
    secretAccessKey: credentials.secretAccessKey || '',
    forcePathStyle: !!credentials.forcePathStyle,
    lastSetAt: now,
  });
  const stored = s3CredentialsMap.get(resolvedVault)!;
  return {
    hasCredentials: true,
    endpoint: stored.endpoint,
    bucket: stored.bucket,
    region: stored.region,
    forcePathStyle: stored.forcePathStyle,
    lastSetAt: stored.lastSetAt,
  };
});

ipcMain.handle('s3:clearCredentials', async (_e, vaultPath: string) => {
  if (!vaultPath) return;
  const resolvedVault = path.resolve(vaultPath);
  s3CredentialsMap.delete(resolvedVault);
});

ipcMain.handle('s3:getCredentialStatus', async (_e, vaultPath: string) => {
  if (!vaultPath) return { hasCredentials: false };
  const resolvedVault = path.resolve(vaultPath);
  const creds = s3CredentialsMap.get(resolvedVault);
  if (!creds) return { hasCredentials: false };
  return {
    hasCredentials: true,
    endpoint: creds.endpoint,
    bucket: creds.bucket,
    region: creds.region,
    forcePathStyle: creds.forcePathStyle,
    lastSetAt: creds.lastSetAt,
  };
});

/* ── Self-hosted Credentials IPC (v0.8.2) ── */
ipcMain.handle('selfhosted:setCredentials', async (_e, vaultPath: string, credentials: any) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  const resolvedVault = path.resolve(vaultPath);
  const now = new Date().toISOString();
  selfHostedCredentialsMap.set(resolvedVault, {
    endpoint: (credentials.endpoint || '').replace(/\/+$/, ''),
    apiKey: credentials.apiKey || '',
    lastSetAt: now,
  });
  const stored = selfHostedCredentialsMap.get(resolvedVault)!;
  return {
    hasCredentials: true,
    endpoint: stored.endpoint,
    lastSetAt: stored.lastSetAt,
  };
});

ipcMain.handle('selfhosted:clearCredentials', async (_e, vaultPath: string) => {
  if (!vaultPath) return;
  const resolvedVault = path.resolve(vaultPath);
  selfHostedCredentialsMap.delete(resolvedVault);
});

ipcMain.handle('selfhosted:getCredentialStatus', async (_e, vaultPath: string) => {
  if (!vaultPath) return { hasCredentials: false };
  const resolvedVault = path.resolve(vaultPath);
  const creds = selfHostedCredentialsMap.get(resolvedVault);
  if (!creds) return { hasCredentials: false };
  return {
    hasCredentials: true,
    endpoint: creds.endpoint,
    lastSetAt: creds.lastSetAt,
  };
});

/* ── S3 Connection Test (v0.5.4) ── */
ipcMain.handle('s3:testConnection', async (_e, vaultPath: string) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  let canListBucket = false;
  let canReadIndex = false;
  let canWriteTestObject = false;
  let canDeleteTestObject = false;

  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    return { checkedAt: new Date().toISOString(), ok: false, provider: 's3' as const, canListBucket, canReadIndex, canWriteTestObject, canDeleteTestObject, errors: ['InvalidVault'], warnings };
  }

  const creds = getS3Creds(vaultPath);
  if (!creds) {
    return { checkedAt: new Date().toISOString(), ok: false, provider: 's3' as const, canListBucket, canReadIndex, canWriteTestObject, canDeleteTestObject, errors: ['MissingS3Credentials'], warnings };
  }

  const resolvedVault = path.resolve(vaultPath);
  const remoteVaultId = sanitizeS3KeyPart(path.basename(resolvedVault));
  const testPrefix = `vaults/${remoteVaultId}/_connection_test`;

  /* 1. List bucket */
  try {
    const canList = await testS3Connection(creds);
    canListBucket = canList;
    if (!canList) errors.push('CannotListBucket');
  } catch (err: any) {
    errors.push(`ListBucketError: ${err.message}`);
  }

  /* 2. Read remote-index.json */
  try {
    const indexKey = buildS3RemoteIndexKey(remoteVaultId);
    await s3GetObject(creds, indexKey);
    canReadIndex = true;
  } catch {
    /* Index not existing is not fatal */
    canReadIndex = false;
  }

  /* 3. Write test object */
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const testKey = `${testPrefix}/test_${timestamp}.txt`;
  const testContent = `Ars-note S3 connection test at ${now.toISOString()}. This file should be automatically deleted.`;

  try {
    await s3PutObject(creds, testKey, Buffer.from(testContent, 'utf-8'), 'text/plain');
    canWriteTestObject = true;
  } catch (err: any) {
    errors.push(`WriteTestError: ${err.message}`);
  }

  /* 4. Delete test object */
  if (canWriteTestObject) {
    try {
      await s3DeleteObject(creds, testKey);
      canDeleteTestObject = true;
    } catch (err: any) {
      warnings.push(`DeleteTestWarning: ${err.message}`);
    }
  }

  const ok = canListBucket && canWriteTestObject;

  return {
    checkedAt: now.toISOString(),
    ok,
    provider: 's3' as const,
    endpoint: creds.endpoint,
    bucket: creds.bucket,
    region: creds.region,
    canListBucket,
    canReadIndex,
    canWriteTestObject,
    canDeleteTestObject,
    errors,
    warnings,
  };
});

/* ── Compare Local vs Remote State (v0.6.0) ── */
ipcMain.handle('sync:compareLocalRemote', async (_e, vaultPath: string) => {
  const warnings: string[] = [];
  let localSnapshot: any = undefined;
  let remoteSnapshot: any = undefined;
  let status: string = 'unknown';
  let recommendedAction: string = 'none';

  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    return { comparedAt: new Date().toISOString(), localSnapshot: undefined, remoteSnapshot: undefined, status: 'unknown', warnings: ['InvalidVault'], recommendedAction: 'none' };
  }

  const resolvedVault = path.resolve(vaultPath);
  const remoteVaultId = sanitizeS3KeyPart(path.basename(resolvedVault));
  const { providerId } = resolveCloudProvider(vaultPath);

  /* 1. Build local snapshot from manifest */
  try {
    const manifest = generateManifestData(vaultPath);
    const manifestHash = computeManifestHash(manifest);
    localSnapshot = {
      snapshotId: `local_${Date.now()}`,
      vaultId: manifest.vaultId || remoteVaultId,
      vaultName: manifest.vaultName || path.basename(resolvedVault),
      provider: providerId,
      generatedAt: manifest.generatedAt,
      manifestHash,
      fileCount: manifest.fileCount,
      totalSize: manifest.totalSize,
      source: 'local',
    };
  } catch (err: any) {
    warnings.push(`Local manifest error: ${err.message}`);
  }

  /* 2. Build remote snapshot from remote-index */
  try {
    let remoteIndex: any[] = [];

    if (providerId === 'local-mock') {
      const indexPath = path.join(resolvedVault, ARS_NOTE_DIR, REMOTE_MOCK_DIR, REMOTE_INDEX_FILE);
      if (fs.existsSync(indexPath)) {
        remoteIndex = readJsonSafe<any[]>(indexPath, []);
      }
    } else if (providerId === 's3') {
      const s3Creds = getS3Creds(vaultPath);
      if (s3Creds) {
        try {
          const indexKey = buildS3RemoteIndexKey(remoteVaultId);
          const indexBuffer = await s3GetObject(s3Creds, indexKey);
          remoteIndex = JSON.parse(indexBuffer.toString('utf-8'));
        } catch { /* no remote index */ }
      } else {
        warnings.push('MissingS3Credentials');
      }
    }

    if (remoteIndex.length > 0) {
      const latest = remoteIndex[0]; // already sorted newest first
      remoteSnapshot = {
        snapshotId: latest.remoteId,
        vaultId: remoteVaultId,
        vaultName: latest.vaultName || '',
        provider: latest.provider || providerId,
        generatedAt: latest.uploadedAt,
        manifestHash: latest.manifestHash || '',
        fileCount: latest.fileCount || 0,
        totalSize: latest.totalSize || 0,
        source: 'remote',
      };
    }
  } catch (err: any) {
    warnings.push(`Remote index error: ${err.message}`);
  }

  /* 3. Compare */
  if (localSnapshot && !remoteSnapshot) {
    status = 'localOnly';
    recommendedAction = 'uploadBackup';
  } else if (!localSnapshot && remoteSnapshot) {
    status = 'remoteOnly';
    recommendedAction = 'downloadRemote';
  } else if (localSnapshot && remoteSnapshot) {
    if (localSnapshot.manifestHash === remoteSnapshot.manifestHash) {
      status = 'same';
      recommendedAction = 'none';
    } else {
      /* Both exist but different — determine who is newer */
      const localTime = new Date(localSnapshot.generatedAt).getTime();
      const remoteTime = new Date(remoteSnapshot.generatedAt).getTime();
      if (localTime > remoteTime) {
        status = 'localNewer';
        recommendedAction = 'uploadBackup';
      } else if (remoteTime > localTime) {
        status = 'remoteNewer';
        recommendedAction = 'downloadRemote';
      } else {
        status = 'diverged';
        recommendedAction = 'manualReview';
      }
    }
  } else {
    status = 'unknown';
    recommendedAction = 'exportBackup';
  }

  return {
    comparedAt: new Date().toISOString(),
    localSnapshot,
    remoteSnapshot,
    status,
    warnings,
    recommendedAction,
  };
});

/* ── Sync: Compare Local with Specific Remote Backup (v0.6.1) ── */
ipcMain.handle('sync:compareWithRemote', async (_e, vaultPath: string, remoteId: string) => {
  const warnings: string[] = [];
  let localSnapshot: any = undefined;
  let remoteSnapshot: any = undefined;
  let status: string = 'unknown';
  let recommendedAction: string = 'none';

  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    return { comparedAt: new Date().toISOString(), localSnapshot: undefined, remoteSnapshot: undefined, status: 'unknown', warnings: ['InvalidVault'], recommendedAction: 'none' };
  }

  const resolvedVault = path.resolve(vaultPath);
  const remoteVaultId = sanitizeS3KeyPart(path.basename(resolvedVault));
  const { providerId } = resolveCloudProvider(vaultPath);

  /* 1. Build local snapshot from manifest */
  try {
    const manifest = generateManifestData(vaultPath);
    const manifestHash = computeManifestHash(manifest);
    localSnapshot = {
      snapshotId: 'local_' + Date.now(),
      vaultId: manifest.vaultId || remoteVaultId,
      vaultName: manifest.vaultName || path.basename(resolvedVault),
      provider: providerId,
      generatedAt: manifest.generatedAt,
      manifestHash,
      fileCount: manifest.fileCount,
      totalSize: manifest.totalSize,
      source: 'local',
    };
  } catch (err: any) {
    warnings.push('Local manifest error: ' + err.message);
  }

  /* 2. Find the specific remote backup by remoteId from remote-index */
  try {
    let remoteIndex: any[] = [];

    if (providerId === 'local-mock') {
      const indexPath = path.join(resolvedVault, ARS_NOTE_DIR, REMOTE_MOCK_DIR, REMOTE_INDEX_FILE);
      if (fs.existsSync(indexPath)) {
        remoteIndex = readJsonSafe<any[]>(indexPath, []);
      }
    } else if (providerId === 's3') {
      const s3Creds = getS3Creds(vaultPath);
      if (s3Creds) {
        try {
          const indexKey = buildS3RemoteIndexKey(remoteVaultId);
          const indexBuffer = await s3GetObject(s3Creds, indexKey);
          remoteIndex = JSON.parse(indexBuffer.toString('utf-8'));
        } catch { /* no remote index */ }
      } else {
        warnings.push('MissingS3Credentials');
      }
    }

    /* Find the specific remote by remoteId */
    const selected = remoteIndex.find((entry: any) => entry.remoteId === remoteId);
    if (selected) {
      remoteSnapshot = {
        snapshotId: selected.remoteId,
        vaultId: remoteVaultId,
        vaultName: selected.vaultName || '',
        provider: selected.provider || providerId,
        generatedAt: selected.uploadedAt,
        manifestHash: selected.manifestHash || '',
        fileCount: selected.fileCount || 0,
        totalSize: selected.totalSize || 0,
        source: 'remote',
      };
    } else {
      warnings.push('Remote backup not found: ' + remoteId);
    }
  } catch (err: any) {
    warnings.push('Remote index error: ' + err.message);
  }

  /* 3. Compare (same logic as sync:compareLocalRemote) */
  if (localSnapshot && !remoteSnapshot) {
    status = 'localOnly';
    recommendedAction = 'uploadBackup';
  } else if (!localSnapshot && remoteSnapshot) {
    status = 'remoteOnly';
    recommendedAction = 'downloadRemote';
  } else if (localSnapshot && remoteSnapshot) {
    if (localSnapshot.manifestHash === remoteSnapshot.manifestHash) {
      status = 'same';
      recommendedAction = 'none';
    } else {
      const localTime = new Date(localSnapshot.generatedAt).getTime();
      const remoteTime = new Date(remoteSnapshot.generatedAt).getTime();
      if (localTime > remoteTime) {
        status = 'localNewer';
        recommendedAction = 'uploadBackup';
      } else if (remoteTime > localTime) {
        status = 'remoteNewer';
        recommendedAction = 'downloadRemote';
      } else {
        status = 'diverged';
        recommendedAction = 'manualReview';
      }
    }
  } else {
    status = 'unknown';
    recommendedAction = 'exportBackup';
  }

  return {
    comparedAt: new Date().toISOString(),
    localSnapshot,
    remoteSnapshot,
    status,
    warnings,
    recommendedAction,
  };
});

/* ── Sync: Preview File-level Diff (v0.6.2) ── */
ipcMain.handle('sync:previewDiff', async (_e, vaultPath: string, remoteId: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    return {
      generatedAt: new Date().toISOString(),
      localFileCount: 0, remoteFileCount: 0,
      localOnlyCount: 0, remoteOnlyCount: 0, modifiedCount: 0, unchangedCount: 0,
      diffs: [],
    };
  }

  const resolvedVault = path.resolve(vaultPath);
  const remoteVaultId = sanitizeS3KeyPart(path.basename(resolvedVault));
  const { providerId } = resolveCloudProvider(vaultPath);

  /* 1. Generate local manifest */
  const localManifest = generateManifestData(vaultPath);

  /* 2. Read remote manifest from the specific backup */
  let remoteManifest: any = { files: [] };
  let remoteIndex: any[] = [];

  /* Read remote index to find the backup */
  if (providerId === 'local-mock') {
    const indexPath = path.join(resolvedVault, ARS_NOTE_DIR, REMOTE_MOCK_DIR, REMOTE_INDEX_FILE);
    if (fs.existsSync(indexPath)) {
      remoteIndex = readJsonSafe<any[]>(indexPath, []);
    }
  } else if (providerId === 's3') {
    const s3Creds = getS3Creds(vaultPath);
    if (s3Creds) {
      try {
        const indexKey = buildS3RemoteIndexKey(remoteVaultId);
        const indexBuffer = await s3GetObject(s3Creds, indexKey);
        remoteIndex = JSON.parse(indexBuffer.toString('utf-8'));
      } catch { /* no remote index */ }
    }
  }

  /* Find the specific remote entry */
  const selectedEntry = remoteIndex.find((entry: any) => entry.remoteId === remoteId);
  if (!selectedEntry) {
    return {
      generatedAt: new Date().toISOString(),
      localFileCount: localManifest.files.length, remoteFileCount: 0,
      localOnlyCount: localManifest.files.length, remoteOnlyCount: 0, modifiedCount: 0, unchangedCount: 0,
      diffs: [],
    };
  }

  /* Read the remote backup manifest */
  if (providerId === 'local-mock') {
    /* Local mock: manifest is at .ars-note/remote-mock/{remoteId}/manifest.json */
    const remoteManifestPath = path.join(selectedEntry.remotePath, MANIFEST_FILE);
    if (fs.existsSync(remoteManifestPath)) {
      remoteManifest = readJsonSafe<any>(remoteManifestPath, { files: [] });
    }
  } else if (providerId === 's3') {
    /* S3: manifest is at vaults/{vaultId}/backups/{backupId}/manifest.json */
    const s3Creds = getS3Creds(vaultPath);
    if (s3Creds && selectedEntry.s3Prefix) {
      try {
        const manifestKey = selectedEntry.s3Prefix + '/' + MANIFEST_FILE;
        const buf = await s3GetObject(s3Creds, manifestKey);
        remoteManifest = JSON.parse(buf.toString('utf-8'));
      } catch { /* no remote manifest */ }
    }
  }

  /* 3. Build file maps by relativePath */
  const localMap = new Map<string, any>();
  for (const f of (localManifest.files || [])) {
    localMap.set(f.relativePath, f);
  }
  const remoteMap = new Map<string, any>();
  for (const f of (remoteManifest.files || [])) {
    remoteMap.set(f.relativePath, f);
  }

  /* 4. Compute diffs */
  const diffs: any[] = [];
  const allPaths = new Set<string>([...localMap.keys(), ...remoteMap.keys()]);
  const sortedPaths = Array.from(allPaths).sort();

  let localOnlyCount = 0;
  let remoteOnlyCount = 0;
  let modifiedCount = 0;
  let unchangedCount = 0;

  for (const relPath of sortedPaths) {
    const local = localMap.get(relPath);
    const remote = remoteMap.get(relPath);

    if (local && !remote) {
      localOnlyCount++;
      diffs.push({
        relativePath: relPath,
        status: 'localOnly',
        localSha256: local.sha256,
        localSize: local.size,
      });
    } else if (!local && remote) {
      remoteOnlyCount++;
      diffs.push({
        relativePath: relPath,
        status: 'remoteOnly',
        remoteSha256: remote.sha256,
        remoteSize: remote.size,
      });
    } else if (local && remote) {
      if (local.sha256 === remote.sha256 && local.size === remote.size) {
        unchangedCount++;
        diffs.push({
          relativePath: relPath,
          status: 'unchanged',
          localSha256: local.sha256,
          remoteSha256: remote.sha256,
          localSize: local.size,
          remoteSize: remote.size,
        });
      } else {
        modifiedCount++;
        diffs.push({
          relativePath: relPath,
          status: 'modified',
          localSha256: local.sha256,
          remoteSha256: remote.sha256,
          localSize: local.size,
          remoteSize: remote.size,
        });
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    localFileCount: localManifest.files.length,
    remoteFileCount: (remoteManifest.files || []).length,
    localOnlyCount,
    remoteOnlyCount,
    modifiedCount,
    unchangedCount,
    diffs,
  };
});

/* ── AI Memory Sync IPC handlers (v0.9.5) ── */

interface AiMemorySyncState {
  lastRemoteSyncedAt?: string;
  lastLocalSignature?: string;
  lastSyncedAt?: string;
  lastSyncedFiles?: Record<string, string>;
}

interface AiMemorySignature {
  signature: string;
  hashes: Record<string, string>;
  fileCount: number;
}

function getAiSyncVaultId(vaultPath: string): string {
  const resolvedVault = path.resolve(vaultPath);
  const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
  const syncCfg = readJsonSafe<any>(syncPath, {});
  return getVaultRemoteIdentity(resolvedVault, syncCfg).vaultId;
}

function aiMemorySyncStatePath(vaultPath: string): string {
  return path.join(path.resolve(vaultPath), ARS_NOTE_DIR, AI_SYNC_STATE_FILE);
}

function readAiMemorySyncState(vaultPath: string): AiMemorySyncState {
  return readJsonSafe<AiMemorySyncState>(aiMemorySyncStatePath(vaultPath), {});
}

function writeAiMemorySyncState(vaultPath: string, state: AiMemorySyncState): void {
  writeJson(aiMemorySyncStatePath(vaultPath), state);
}

function isValidAiMemorySyncFilePath(relPath: string): boolean {
  return !!relPath &&
    relPath !== '__manifest.json' &&
    !relPath.includes('..') &&
    !relPath.startsWith('/') &&
    !relPath.includes('\\') &&
    !shouldSkipGeneratedAiMemoryArtifact(relPath);
}

function aiMemoryManifestAllowList(files: Record<string, string>): Set<string> | null {
  const manifestRaw = files['__manifest.json'];
  if (!manifestRaw) return null;
  try {
    const manifest = JSON.parse(Buffer.from(manifestRaw, 'base64').toString('utf-8'));
    if (!Array.isArray(manifest)) return null;
    return new Set(
      manifest
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.replace(/\\/g, '/'))
        .filter(isValidAiMemorySyncFilePath),
    );
  } catch {
    return null;
  }
}

function computeAiMemorySignature(files: Record<string, string>): AiMemorySignature {
  const allowedFiles = aiMemoryManifestAllowList(files);
  const hashes: Record<string, string> = {};

  for (const [rawRelPath, contentBase64] of Object.entries(files || {})) {
    const relPath = String(rawRelPath || '').replace(/\\/g, '/');
    if (!isValidAiMemorySyncFilePath(relPath)) continue;
    if (allowedFiles && !allowedFiles.has(relPath)) continue;
    try {
      const buffer = Buffer.from(contentBase64, 'base64');
      hashes[relPath] = crypto.createHash('sha256').update(buffer).digest('hex');
    } catch { /* skip invalid base64 */ }
  }

  const parts = Object.entries(hashes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([relPath, sha]) => `${relPath}:${sha}`)
    .join('|');

  return {
    signature: parts ? crypto.createHash('sha256').update(parts).digest('hex') : '',
    hashes,
    fileCount: Object.keys(hashes).length,
  };
}

function createAiMemoryPullConflicts(
  vaultPath: string,
  remoteFiles: Record<string, string>,
  baselineHashes: Record<string, string> = {},
): string[] {
  const resolvedVault = path.resolve(vaultPath);
  const aiDir = path.join(resolvedVault, AI_MEMORY_DIR);
  const remoteSignature = computeAiMemorySignature(remoteFiles);
  const conflicts: string[] = [];
  const stamp = Date.now();

  for (const [relPath, remoteHash] of Object.entries(remoteSignature.hashes)) {
    const localPath = path.resolve(path.join(aiDir, relPath));
    if (!isInsidePath(localPath, aiDir) || !fs.existsSync(localPath)) continue;

    try {
      const localBuffer = fs.readFileSync(localPath);
      const localHash = crypto.createHash('sha256').update(localBuffer).digest('hex');
      if (localHash === remoteHash) continue;

      const baselineHash = baselineHashes[relPath] || '';
      if (baselineHash && localHash === baselineHash) continue;

      const conflictPath = path.resolve(path.join(aiDir, `${relPath}.conflict-${stamp}`));
      if (!isInsidePath(conflictPath, aiDir)) continue;
      fs.mkdirSync(path.dirname(conflictPath), { recursive: true });
      fs.copyFileSync(localPath, conflictPath);
      conflicts.push(path.relative(resolvedVault, conflictPath).replace(/\\/g, '/'));
    } catch { /* best-effort conflict copy */ }
  }

  return conflicts;
}

function collectAiMemoryFiles(vaultPath: string): Record<string, string> {
  const resolvedVault = path.resolve(vaultPath);
  const aiDir = path.join(resolvedVault, AI_MEMORY_DIR);
  const files: Record<string, string> = {};
  const manifest: string[] = [];

  if (!fs.existsSync(aiDir)) return files;

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relPath = path.relative(aiDir, fullPath).replace(/\\/g, '/');
      if (!relPath || relPath === '__manifest.json') continue;
      if (shouldSkipGeneratedAiMemoryArtifact(relPath)) continue;
      files[relPath] = fs.readFileSync(fullPath).toString('base64');
      manifest.push(relPath);
    }
  }

  walk(aiDir);
  files['__manifest.json'] = Buffer.from(JSON.stringify(manifest.sort(), null, 2), 'utf-8').toString('base64');
  return files;
}

function writeAiMemoryLiveManifestFile(vaultPath: string): { fileCount: number; manifestPath: string } | null {
  const resolvedVault = path.resolve(vaultPath);
  const aiDir = path.join(resolvedVault, AI_MEMORY_DIR);
  if (!fs.existsSync(aiDir)) return null;

  const files = Object.keys(collectAiMemoryFiles(resolvedVault))
    .filter((item) => item !== '__manifest.json')
    .sort((a, b) => a.localeCompare(b));
  const manifestPath = path.join(aiDir, '__manifest.json');
  const content = `${JSON.stringify({
    version: 1,
    scope: AI_MEMORY_DIR,
    files,
  }, null, 2)}\n`;

  fs.mkdirSync(aiDir, { recursive: true });
  if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, 'utf-8') !== content) {
    fs.writeFileSync(manifestPath, content, 'utf-8');
  }

  return { fileCount: files.length, manifestPath };
}

function buildAiMemorySyncOverview(vaultPath: string): {
  syncedFiles: string[];
  syncedCount: number;
  coreFiles: string[];
  skillFiles: string[];
  evolutionFiles: string[];
  cronFiles: string[];
  excludedRules: string[];
  coverage: {
    memory: boolean;
    user: boolean;
    soul: boolean;
    crons: boolean;
    skills: number;
    evolutions: number;
  };
} {
  const files = collectAiMemoryFiles(vaultPath);
  const syncedFiles = Object.keys(files)
    .filter((item) => item !== '__manifest.json')
    .sort((a, b) => a.localeCompare(b));
  const coreFiles = syncedFiles.filter((item) => item === 'MEMORY.md' || item === 'USER.md' || item === 'SOUL.md');
  const skillFiles = syncedFiles.filter((item) => item.startsWith('skills/') && item.endsWith('.md'));
  const evolutionFiles = syncedFiles.filter((item) => item.startsWith('evolution/') && item.endsWith('.evo.json'));
  const cronFiles = syncedFiles.filter((item) => item === 'crons.json');

  return {
    syncedFiles,
    syncedCount: syncedFiles.length,
    coreFiles,
    skillFiles,
    evolutionFiles,
    cronFiles,
    excludedRules: [
      'live-session.json',
      'history/',
      '*.conflict-*',
    ],
    coverage: {
      memory: syncedFiles.includes('MEMORY.md'),
      user: syncedFiles.includes('USER.md'),
      soul: syncedFiles.includes('SOUL.md'),
      crons: syncedFiles.includes('crons.json'),
      skills: skillFiles.length,
      evolutions: evolutionFiles.length,
    },
  };
}

function writeAiMemoryFiles(vaultPath: string, files: Record<string, string>): number {
  const resolvedVault = path.resolve(vaultPath);
  const aiDir = path.join(resolvedVault, AI_MEMORY_DIR);
  fs.mkdirSync(aiDir, { recursive: true });

  const allowedFiles = aiMemoryManifestAllowList(files);

  let fileCount = 0;
  for (const [rawRelPath, contentBase64] of Object.entries(files || {})) {
    const relPath = String(rawRelPath || '').replace(/\\/g, '/');
    if (allowedFiles && !allowedFiles.has(relPath)) continue;
    if (!isValidAiMemorySyncFilePath(relPath)) continue;

    const fp = path.join(aiDir, relPath);
    const resolvedFile = path.resolve(fp);
    if (!isInsidePath(resolvedFile, aiDir)) continue;

    const dir = path.dirname(resolvedFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resolvedFile, Buffer.from(contentBase64, 'base64'));
    fileCount++;
  }

  return fileCount;
}

async function pushAiMemoryNow(vaultPath: string, requireEnabled = true): Promise<any | null> {
  const resolvedVault = path.resolve(vaultPath);
  const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
  if (!fs.existsSync(syncPath)) return null;

  const syncCfg = readJsonSafe<any>(syncPath, {});
  if ((requireEnabled && !syncCfg.enabled) || syncCfg.provider !== 'self-hosted' || !syncCfg.endpoint) return null;

  const aiDir = path.join(resolvedVault, AI_MEMORY_DIR);
  if (!fs.existsSync(aiDir)) return null;

  const files = collectAiMemoryFiles(resolvedVault);
  const signature = computeAiMemorySignature(files);
  if (signature.fileCount === 0) return null;

  const resp = await fetch(syncCfg.endpoint.replace(/\/+$/, '') + '/api/ai/sync-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...selfHostedAuthHeaders(resolvedVault) },
    body: JSON.stringify({ vaultId: getAiSyncVaultId(resolvedVault), files }),
  });
  const data = await resp.json() as any;
  if (!data.ok) throw new Error(data.error || 'Push failed');
  const syncedAt = data.syncedAt || new Date().toISOString();
  writeAiMemorySyncState(resolvedVault, {
    ...readAiMemorySyncState(resolvedVault),
    lastRemoteSyncedAt: syncedAt,
    lastLocalSignature: signature.signature,
    lastSyncedFiles: signature.hashes,
    lastSyncedAt: syncedAt,
  });
  return data;
}

async function fetchAiMemoryRemoteStatus(vaultPath: string, requireEnabled = true): Promise<any | null> {
  const resolvedVault = path.resolve(vaultPath);
  const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
  if (!fs.existsSync(syncPath)) return null;

  const syncCfg = readJsonSafe<any>(syncPath, {});
  if ((requireEnabled && !syncCfg.enabled) || syncCfg.provider !== 'self-hosted' || !syncCfg.endpoint) return null;

  const vaultId = getAiSyncVaultId(resolvedVault);
  const resp = await fetch(syncCfg.endpoint.replace(/\/+$/, '') + '/api/ai/sync-status?vaultId=' + encodeURIComponent(vaultId), {
    headers: { ...selfHostedAuthHeaders(resolvedVault) },
  });
  const data = await resp.json() as any;
  if (!data.ok) throw new Error(data.error || 'Status failed');
  return data;
}

async function pullAiMemoryNow(vaultPath: string, requireEnabled = true): Promise<any | null> {
  const resolvedVault = path.resolve(vaultPath);
  const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
  if (!fs.existsSync(syncPath)) return null;

  const syncCfg = readJsonSafe<any>(syncPath, {});
  if ((requireEnabled && !syncCfg.enabled) || syncCfg.provider !== 'self-hosted' || !syncCfg.endpoint) return null;

  const vaultId = getAiSyncVaultId(resolvedVault);
  const stateBeforePull = readAiMemorySyncState(resolvedVault);

  const resp = await fetch(syncCfg.endpoint.replace(/\/+$/, '') + '/api/ai/sync-pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...selfHostedAuthHeaders(resolvedVault) },
    body: JSON.stringify({ vaultId }),
  });
  const data = await resp.json() as any;
  if (!data.ok) throw new Error(data.error || 'Pull failed');

  const remoteFiles = data.files || {};
  const conflicts = createAiMemoryPullConflicts(resolvedVault, remoteFiles, stateBeforePull.lastSyncedFiles || {});
  const fileCount = writeAiMemoryFiles(resolvedVault, remoteFiles);
  writeAiMemoryLiveManifestFile(resolvedVault);
  const signature = computeAiMemorySignature(remoteFiles);
  const syncedAt = data.syncedAt || new Date().toISOString();

  writeAiMemorySyncState(resolvedVault, {
    ...stateBeforePull,
    lastRemoteSyncedAt: syncedAt,
    lastLocalSignature: signature.signature,
    lastSyncedFiles: signature.hashes,
    lastSyncedAt: new Date().toISOString(),
  });

  return { ok: true, fileCount, syncedAt, conflictCount: conflicts.length, conflictFiles: conflicts };
}

async function syncAiMemoryBidirectional(vaultPath: string, requireEnabled = true): Promise<{ ok: true; pulled: any | null; pushed: any | null; status: any | null }> {
  const resolvedVault = path.resolve(vaultPath);
  const status = await fetchAiMemoryRemoteStatus(resolvedVault, requireEnabled);
  let pulled: any | null = null;
  let pushed: any | null = null;

  if (status?.hasData && status.syncedAt) {
    const state = readAiMemorySyncState(resolvedVault);
    if (status.syncedAt !== state.lastRemoteSyncedAt) {
      pulled = await pullAiMemoryNow(resolvedVault, requireEnabled);
    }
  }

  const localSignature = computeAiMemorySignature(collectAiMemoryFiles(resolvedVault));
  const latestState = readAiMemorySyncState(resolvedVault);
  if (localSignature.fileCount > 0 && (!status?.hasData || localSignature.signature !== latestState.lastLocalSignature)) {
    pushed = await pushAiMemoryNow(resolvedVault, requireEnabled);
  }

  const latestStatus = await fetchAiMemoryRemoteStatus(resolvedVault, requireEnabled).catch(() => status);
  return { ok: true, pulled, pushed, status: latestStatus };
}

const aiMemorySyncTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleAiMemorySync(vaultPath: string, delayMs = 1500): void {
  const resolvedVault = path.resolve(vaultPath);
  try {
    writeAiMemoryLiveManifestFile(resolvedVault);
  } catch (err: any) {
    console.error('[AI Sync] Failed to refresh AI memory live manifest:', err.message);
  }
  const existing = aiMemorySyncTimers.get(resolvedVault);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    aiMemorySyncTimers.delete(resolvedVault);
    syncAiMemoryBidirectional(resolvedVault).catch((err) => {
      console.error('[AI Sync] Background sync failed:', (err as Error).message);
    });
  }, delayMs);
  aiMemorySyncTimers.set(resolvedVault, timer);
}

ipcMain.handle('ai:syncPush', async (_e, vaultPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }

  const resolvedVault = path.resolve(vaultPath);
  const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
  if (!fs.existsSync(syncPath)) throw new Error('Sync not configured');

  const syncCfg = readJsonSafe<any>(syncPath, {});
  const endpoint = syncCfg.endpoint;
  if (!endpoint) throw new Error('SelfHostedMissingEndpoint');

  const aiDir = path.join(resolvedVault, AI_MEMORY_DIR);
  if (!fs.existsSync(aiDir)) throw new Error('AI memory not initialized');

  const data = await pushAiMemoryNow(resolvedVault, false);
  if (!data?.ok) throw new Error('Push failed');
  return data;
});

ipcMain.handle('ai:syncPull', async (_e, vaultPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }

  const resolvedVault = path.resolve(vaultPath);
  const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
  if (!fs.existsSync(syncPath)) throw new Error('Sync not configured');

  const syncCfg = readJsonSafe<any>(syncPath, {});
  const endpoint = syncCfg.endpoint;
  if (!endpoint) throw new Error('SelfHostedMissingEndpoint');

  const data = await pullAiMemoryNow(resolvedVault, false);
  if (!data?.ok) throw new Error('Pull failed');

    /* Skip manifest files — they're metadata for the server */

  return data;
});

ipcMain.handle('ai:syncStatus', async (_e, vaultPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    return { ok: true, hasData: false, syncedAt: '', fileCount: 0, files: [] };
  }

  const resolvedVault = path.resolve(vaultPath);
  const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
  if (!fs.existsSync(syncPath)) {
    return { ok: true, hasData: false, syncedAt: '', fileCount: 0, files: [] };
  }

  const syncCfg = readJsonSafe<any>(syncPath, {});
  const endpoint = syncCfg.endpoint;
  if (!endpoint) {
    return { ok: true, hasData: false, syncedAt: '', fileCount: 0, files: [] };
  }

  return await fetchAiMemoryRemoteStatus(resolvedVault, false);
});

ipcMain.handle('ai:syncNow', async (_e, vaultPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }

  const resolvedVault = path.resolve(vaultPath);
  const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
  if (!fs.existsSync(syncPath)) throw new Error('Sync not configured');

  const syncCfg = readJsonSafe<any>(syncPath, {});
  if (syncCfg.provider !== 'self-hosted' || !syncCfg.endpoint) {
    throw new Error('Self-hosted sync server is not configured');
  }

  const result = await syncAiMemoryBidirectional(resolvedVault, false);
  return {
    ...result,
    pulledFileCount: result.pulled?.fileCount || 0,
    pushedFileCount: result.pushed?.fileCount || 0,
    conflictCount: result.pulled?.conflictCount || 0,
    conflictFiles: result.pulled?.conflictFiles || [],
    syncedAt: result.status?.syncedAt || result.pushed?.syncedAt || result.pulled?.syncedAt || new Date().toISOString(),
  };
});

/* ── AI Memory Auto-sync (v0.9.6) ── */
/* Periodically performs safe two-way portable AI memory sync, with a quick first sync */
let autoSyncTimer: ReturnType<typeof setInterval> | null = null;
const AUTO_SYNC_INTERVAL = 2 * 60 * 1000; /* 2 minutes */

function startAutoSync(vaultPath: string): void {
  stopAutoSync();
  const doSync = async () => {
    try {
      const resolved = path.resolve(vaultPath);
      const syncPath = path.join(resolved, ARS_NOTE_DIR, SYNC_FILE);
      if (!fs.existsSync(syncPath)) return;
      const syncCfg = readJsonSafe<any>(syncPath, {});
      if (!syncCfg.enabled || syncCfg.provider !== 'self-hosted' || !syncCfg.endpoint) return;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai:tool-progress', { name: 'auto-sync', args: {}, status: 'running' });
      }
      const data = await syncAiMemoryBidirectional(resolved);
      if (data.ok) {
        console.log('[AutoSync] AI memory sync', {
          pulled: data.pulled?.fileCount || 0,
          pushed: data.pushed?.fileCount || 0,
          conflicts: data.pulled?.conflictCount || 0,
          at: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('[AutoSync] Failed:', (err as Error).message);
    }
  };
  setTimeout(doSync, 2500);
  autoSyncTimer = setInterval(doSync, AUTO_SYNC_INTERVAL);
  console.log('[AutoSync] Started for', vaultPath);
}

function stopAutoSync(): void {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
}

ipcMain.handle('ai:startAutoSync', async (_e, vaultPath: string) => {
  if (vaultPath) startAutoSync(vaultPath);
});
ipcMain.handle('ai:stopAutoSync', async () => { stopAutoSync(); });

/* ── Cloud: Validate Provider Config (v0.5.2) ── */
ipcMain.handle('cloud:validateProvider', async (_e, vaultPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    return { valid: false, errors: ['InvalidVault'], warnings: [] };
  }

  const { providerId, implemented } = resolveCloudProvider(vaultPath);

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!implemented) {
    errors.push('ProviderNotImplemented');
    return { valid: false, errors, warnings };
  }

  /* Check S3 runtime credentials when provider is s3 */
  if (providerId === 's3') {
    const s3Creds = getS3Creds(vaultPath);
    if (!s3Creds) {
      errors.push('MissingS3Credentials');
      return { valid: false, errors, warnings };
    }
  }

  /* Check sync config for warnings */
  const resolvedVault = path.resolve(vaultPath);
  const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
  if (fs.existsSync(syncPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(syncPath, 'utf-8'));
      if (providerId === 'supabase' || providerId === 's3') {
        if (!raw.endpoint) warnings.push('EndpointRequired');
        if (!raw.bucket) warnings.push('BucketRequired');
      }
    } catch { /* no warnings */ }
  }

  return { valid: true, errors, warnings };
});


/* ── Self-hosted Health Check (v0.8.6) ── */
ipcMain.handle('selfhosted:healthCheck', async (_e, endpoint: string) => {
  try {
    if (!endpoint || (!endpoint.startsWith('http://') && !endpoint.startsWith('https://'))) {
      return { ok: false, error: 'Invalid endpoint URL' };
    }
    const resp = await fetch(endpoint.replace(/\/+$/, '') + '/health');
    const data = await resp.json() as any;
    return { ok: data.ok === true, info: data };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Connection failed' };
  }
});

ipcMain.handle('cloud:listDownloaded', async (_e, vaultPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }

  const resolvedVault = path.resolve(vaultPath);
  const downloadsDir = path.join(resolvedVault, ARS_NOTE_DIR, DOWNLOADS_DIR);

  if (!fs.existsSync(downloadsDir)) return [];

  try {
    const entries = fs.readdirSync(downloadsDir, { withFileTypes: true });
    const items: any[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const isDownloadedBackup =
        entry.name.startsWith('remote_') ||
        entry.name.startsWith('s3_') ||
        entry.name.startsWith('selfhosted_');
      if (!isDownloadedBackup) continue;

      const dlDir = path.join(downloadsDir, entry.name);
      const manifestPath = path.join(dlDir, MANIFEST_FILE);
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        items.push({
          downloadId: entry.name,
          remoteId: manifest.remoteId || '',
          backupId: manifest.backupId || entry.name,
          downloadedAt: manifest.downloadedAt || '',
          downloadedPath: dlDir,
          fileCount: manifest.fileCount || 0,
          totalSize: manifest.totalSize || 0,
          manifestPath: manifestPath,
        });
      } catch { /* skip unreadable */ }
    }

    items.sort((a: any, b: any) => b.downloadedAt.localeCompare(a.downloadedAt));
    return items;
  } catch { return []; }
});

/* ── Cloud: Verify downloaded backup ── */
ipcMain.handle('cloud:verifyDownloaded', async (_e, vaultPath: string, downloadedPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  if (!downloadedPath || !fs.existsSync(downloadedPath)) {
    throw new Error('Downloaded backup path not found');
  }

  const resolvedVault = path.resolve(vaultPath);
  const resolvedPath = path.resolve(downloadedPath);
  const downloadsDir = path.join(resolvedVault, ARS_NOTE_DIR, DOWNLOADS_DIR);

  if (!isInsidePath(resolvedPath, downloadsDir)) {
    throw new Error('Path is not inside downloads folder');
  }

  return verifyBackupFolder(resolvedPath);
});

/* ── Cloud: Restore downloaded backup ── */
ipcMain.handle('cloud:restoreDownloaded', async (_e, vaultPath: string, downloadedPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  if (!downloadedPath || !fs.existsSync(downloadedPath)) {
    throw new Error('Downloaded backup path not found');
  }

  const resolvedVault = path.resolve(vaultPath);
  const resolvedPath = path.resolve(downloadedPath);
  const downloadsDir = path.join(resolvedVault, ARS_NOTE_DIR, DOWNLOADS_DIR);

  /* Safety: must be inside downloads */
  if (!isInsidePath(resolvedPath, downloadsDir)) {
    throw new Error('Cannot restore from outside downloads folder');
  }

  /* Safety: cannot be the vault itself */
  if (resolvedPath === resolvedVault) {
    throw new Error('Cannot restore to current vault');
  }

  return applyBackupFolderToCurrentVault(resolvedPath, vaultPath);
});

/* ── Refactored: Verify backup (local) ── */
/* Replace the inline verify logic with shared function */

/* ── Refactored: Restore backup (local) ── */
/* Replace the inline restore logic with shared function */

/* ── Dialogs ── */
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select Vault Folder',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:save', async (_e, defaultPath?: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, { defaultPath, title: 'Save File' });
  if (result.canceled) return null;
  return result.filePath ?? null;
});

/* ── Path utils ── */
ipcMain.handle('path:join', async (_e, ...segments: string[]) => path.join(...segments));
ipcMain.handle('path:basename', async (_e, fp: string) => path.basename(fp));
ipcMain.handle('path:dirname', async (_e, fp: string) => path.dirname(fp));
ipcMain.handle('app:version', async () => app.getVersion());

ipcMain.handle('window:minimize', async () => {
  mainWindow?.minimize();
  return { ok: true };
});

ipcMain.handle('window:maximize', async () => {
  if (!mainWindow) return { ok: false, maximized: false };
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
  return { ok: true, maximized: mainWindow.isMaximized() };
});

ipcMain.handle('window:close', async () => {
  mainWindow?.close();
  return { ok: true };
});

ipcMain.handle('window:isMaximized', async () => ({
  ok: true,
  maximized: !!mainWindow?.isMaximized(),
}));

/* ── Shell: Open external URL safely (v0.6.2 hotfix) ── */
ipcMain.handle('shell:openExternal', async (_e, url: string) => {
  const safeUrl = normalizeExternalUrl(url);
  if (!safeUrl) return;
  await shell.openExternal(safeUrl);
});

/* ── AI 5-Pillar System (v1.2.0) ── */

ipcMain.handle('ai:initMemory', async (_e, vp: string) => {
  FP.initMemorySystem(vp);
  scheduleAiMemorySync(vp);
});
ipcMain.handle('ai:getMemoryStatus', async (_e, vp: string) => FP.getMemoryStatus(vp));
ipcMain.handle('ai:getMemoryOverview', async (_e, vp: string) => {
  const status = FP.getMemoryStatus(vp);
  const memory = FP.readMemory(vp);
  const user = FP.readUser(vp);
  const soul = FP.readSoul(vp);
  const skills = FP.listSkills(vp);
  const crons = FP.listCrons(vp);
  const evolutions = FP.listEvolutions(vp);
  const conversations = FP.listConversations(vp);
  const memoryEntries = FP.listMemoryEntries(vp);
  const syncOverview = buildAiMemorySyncOverview(vp);
  return {
    status,
    memoryPreview: memory.slice(-1600),
    memoryEntries,
    userPreview: user.slice(0, 1600),
    soulPreview: soul.slice(0, 1600),
    skills,
    crons,
    evolutions,
    conversations,
    syncFiles: syncOverview.syncedFiles,
    syncOverview,
  };
});
ipcMain.handle('ai:readMemory', async (_e, vp: string) => FP.readMemory(vp));
ipcMain.handle('ai:appendMemory', async (_e, vp: string, entry: string) => {
  FP.appendMemory(vp, entry);
  scheduleAiMemorySync(vp);
});
ipcMain.handle('ai:deleteMemoryEntry', async (_e, vp: string, lineIndex: number) => {
  const ok = FP.deleteMemoryEntry(vp, lineIndex);
  if (ok) scheduleAiMemorySync(vp);
  return { ok };
});
ipcMain.handle('ai:setMemoryEntryLocked', async (_e, vp: string, lineIndex: number, locked: boolean) => {
  const ok = FP.setMemoryEntryLocked(vp, lineIndex, locked);
  if (ok) scheduleAiMemorySync(vp);
  return { ok };
});
ipcMain.handle('ai:consolidateMemory', async (_e, vp: string) => {
  const result = FP.consolidateMemory(vp);
  scheduleAiMemorySync(vp);
  return result;
});
ipcMain.handle('ai:readSoul', async (_e, vp: string) => FP.readSoul(vp));
ipcMain.handle('ai:writeSoul', async (_e, vp: string, content: string) => {
  FP.writeSoul(vp, content);
  scheduleAiMemorySync(vp);
});
ipcMain.handle('ai:readUser', async (_e, vp: string) => FP.readUser(vp));
ipcMain.handle('ai:writeUser', async (_e, vp: string, content: string) => {
  FP.writeUser(vp, content);
  scheduleAiMemorySync(vp);
});
ipcMain.handle('ai:saveConversation', async (_e, vp: string, messages: any[]) => {
  FP.saveConversation(vp, messages);
  scheduleAiMemorySync(vp);
});
ipcMain.handle('ai:listConversations', async (_e, vp: string) => FP.listConversations(vp));
ipcMain.handle('ai:loadConversation', async (_e, vp: string, file: string) => FP.loadConversation(vp, file));
ipcMain.handle('ai:loadLatestConversation', async (_e, vp: string) => FP.loadLatestConversation(vp));
ipcMain.handle('ai:deleteConversation', async (_e, vp: string, file: string) => {
  const resolvedVault = path.resolve(vp);
  const historyRoot = path.resolve(path.join(resolvedVault, AI_MEMORY_DIR, 'history'));
  const target = path.resolve(path.join(historyRoot, file));
  if (!isInsidePath(target, historyRoot) || !target.endsWith('.json')) {
    throw new Error('Invalid conversation file');
  }
  if (fs.existsSync(target)) fs.unlinkSync(target);
  scheduleAiMemorySync(resolvedVault);
  return { ok: true };
});
ipcMain.handle('ai:listSkills', async (_e, vp: string) => FP.listSkills(vp));
ipcMain.handle('ai:createSkill', async (_e, vp: string, skill: any) => {
  const result = FP.createSkill(vp, skill);
  scheduleAiMemorySync(vp);
  return result;
});
ipcMain.handle('ai:readSkill', async (_e, vp: string, id: string) => FP.readSkill(vp, id));
ipcMain.handle('ai:deleteSkill', async (_e, vp: string, id: string) => {
  FP.deleteSkill(vp, id);
  scheduleAiMemorySync(vp);
});
ipcMain.handle('ai:updateSkillUsage', async (_e, vp: string, id: string, success: boolean) => {
  FP.updateSkillUsage(vp, id, success);
  scheduleAiMemorySync(vp);
});
ipcMain.handle('ai:getRelevantSkills', async (_e, vp: string, query: string) => FP.getRelevantSkills(vp, query));
ipcMain.handle('ai:listCrons', async (_e, vp: string) => FP.listCrons(vp));
ipcMain.handle('ai:createCron', async (_e, vp: string, cron: any) => {
  const result = FP.createCron(vp, cron);
  scheduleAiMemorySync(vp);
  return result;
});
ipcMain.handle('ai:updateCron', async (_e, vp: string, id: string, updates: any) => {
  FP.updateCron(vp, id, updates);
  scheduleAiMemorySync(vp);
});
ipcMain.handle('ai:deleteCron', async (_e, vp: string, id: string) => {
  FP.deleteCron(vp, id);
  scheduleAiMemorySync(vp);
});
ipcMain.handle('ai:listEvolutions', async (_e, vp: string) => FP.listEvolutions(vp));
ipcMain.handle('ai:getFivePillarContext', async (_e, vp: string) => FP.buildFivePillarContext(vp));
ipcMain.handle('ai:evolveSkill', async (_e, vp: string, skillId: string) => {
  const resolved = path.resolve(vp);
  const cfg = aiCredentialsMap.get(resolved);
  if (!cfg || !cfg.baseUrl) return { skillId, improved: false, error: 'AI not configured' };
  const caller = async (prompt: string): Promise<string> => {
    const url = cfg.provider === 'ollama' ? `${cfg.baseUrl}/api/chat` : `${cfg.baseUrl}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    const msgs = [{ role: 'user', content: prompt }];
    const body = cfg.provider === 'ollama'
      ? JSON.stringify({ model: cfg.model, messages: msgs, stream: false })
      : JSON.stringify({ model: cfg.model, messages: msgs, max_tokens: 2048, temperature: 0.8 });
    const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error('LLM call failed');
    const raw = await res.json();
    return cfg.provider === 'ollama' ? (raw as any).message?.content || '' : (raw as any).choices?.[0]?.message?.content || '';
  };
  const result = await FP.evolveSkill(resolved, skillId, caller);
  scheduleAiMemorySync(resolved);
  return result;
});

// Start cron scheduler for the current vault when it's opened
ipcMain.handle('ai:startCronScheduler', async (_e, vp: string) => {
  const resolved = path.resolve(vp);
  const cfg = aiCredentialsMap.get(resolved);
  if (!cfg || !cfg.baseUrl) return { started: false, reason: 'AI not configured' };
  FP.startCronScheduler(resolved, async (vaultPath: string, prompt: string) => {
    // Re-check credentials each tick (user may have cleared config while cron runs)
    const liveCfg = aiCredentialsMap.get(vaultPath);
    if (!liveCfg || !liveCfg.baseUrl) throw new Error('AI not configured — please set up AI credentials to enable scheduled tasks');
    const url = liveCfg.provider === 'ollama' ? `${liveCfg.baseUrl}/api/chat` : `${liveCfg.baseUrl}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (liveCfg.apiKey) headers['Authorization'] = `Bearer ${liveCfg.apiKey}`;
    const body = liveCfg.provider === 'ollama'
      ? JSON.stringify({ model: liveCfg.model, messages: [{ role: 'user', content: prompt }], stream: false })
      : JSON.stringify({ model: liveCfg.model, messages: [{ role: 'user', content: prompt }], max_tokens: 4096 });
    const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(300000) });
    if (!res.ok) throw new Error('Cron AI call failed: HTTP ' + res.status);
    const raw = await res.json();
    return liveCfg.provider === 'ollama' ? (raw as any).message?.content || '' : (raw as any).choices?.[0]?.message?.content || '';
  });
  return { started: true };
});
ipcMain.handle('ai:stopCronScheduler', async () => { FP.stopCronScheduler(); });

/* ── AI Runtime Credentials (v1.1.0) ── */
interface AIRuntimeCreds {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  lastTestAt?: string;
  lastError?: string;
}

const aiCredentialsMap = new Map<string, AIRuntimeCreds>();
const LEGACY_AI_CONFIG_FILE = '.ai-config.json';

function aiRuntimeConfigKey(vaultPath: string): string {
  return crypto.createHash('sha256').update(path.resolve(vaultPath)).digest('hex');
}

function readAIRuntimeConfigs(): Record<string, any> {
  return readJsonSafe<Record<string, any>>(AI_RUNTIME_CONFIG_FILE, {});
}

function removeLegacyAIConfig(vaultPath: string): void {
  try {
    const legacyPath = path.join(vaultPath, LEGACY_AI_CONFIG_FILE);
    if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
  } catch (err) {
    console.warn('Failed to remove legacy plaintext AI config:', err);
  }
}

function saveAIConfigToDisk(vaultPath: string) {
  const cfg = aiCredentialsMap.get(vaultPath);
  if (!cfg) return;
  try {
    const configs = readAIRuntimeConfigs();
    configs[aiRuntimeConfigKey(vaultPath)] = {
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      apiKey: protectSecretForDisk(cfg.apiKey),
      updatedAt: new Date().toISOString(),
    };
    writeJson(AI_RUNTIME_CONFIG_FILE, configs);
    removeLegacyAIConfig(vaultPath);
  } catch (err) { console.error('Failed to save AI config:', err); }
}

function loadAIConfigFromDisk(vaultPath: string): AIRuntimeCreds | null {
  try {
    const key = aiRuntimeConfigKey(vaultPath);
    const configs = readAIRuntimeConfigs();
    const stored = configs[key];
    if (stored) {
      const revealed = revealSecretFromDisk(stored.apiKey);
      if (revealed.legacyPlaintext) {
        configs[key] = {
          ...stored,
          apiKey: protectSecretForDisk(revealed.secret),
          migratedAt: new Date().toISOString(),
        };
        writeJson(AI_RUNTIME_CONFIG_FILE, configs);
      }
      removeLegacyAIConfig(vaultPath);
      return {
        provider: stored.provider || 'openai-compatible',
        baseUrl: stored.baseUrl || '',
        model: stored.model || '',
        apiKey: revealed.secret,
      };
    }

    const legacyPath = path.join(vaultPath, LEGACY_AI_CONFIG_FILE);
    if (fs.existsSync(legacyPath)) {
      const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
      const migrated: AIRuntimeCreds = {
        provider: legacy.provider || 'openai-compatible',
        baseUrl: legacy.baseUrl || '',
        model: legacy.model || '',
        apiKey: legacy.apiKey || '',
      };
      configs[key] = {
        provider: migrated.provider,
        baseUrl: migrated.baseUrl,
        model: migrated.model,
        apiKey: protectSecretForDisk(migrated.apiKey),
        migratedAt: new Date().toISOString(),
      };
      writeJson(AI_RUNTIME_CONFIG_FILE, configs);
      removeLegacyAIConfig(vaultPath);
      return migrated;
    }
  } catch (err) { console.error('Failed to load AI config:', err); }
  return null;
}

ipcMain.handle('ai:setRuntimeConfig', async (_e, vaultPath: string, config: { provider: string; baseUrl: string; model: string; apiKey: string }) => {
  const resolved = path.resolve(vaultPath);
  aiCredentialsMap.set(resolved, {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
  });
  saveAIConfigToDisk(resolved);
});

ipcMain.handle('ai:clearRuntimeConfig', async (_e, vaultPath: string) => {
  const resolved = path.resolve(vaultPath);
  aiCredentialsMap.delete(resolved);
  try {
    const configs = readAIRuntimeConfigs();
    delete configs[aiRuntimeConfigKey(resolved)];
    writeJson(AI_RUNTIME_CONFIG_FILE, configs);
  } catch {}
  removeLegacyAIConfig(resolved);
});

ipcMain.handle('ai:getRuntimeStatus', async (_e, vaultPath: string) => {
  const resolved = path.resolve(vaultPath);
  let cfg = aiCredentialsMap.get(resolved) || null;
  /* Auto-load from disk if not in memory (survives app restart) */
  if (!cfg) {
    cfg = loadAIConfigFromDisk(resolved);
    if (cfg) aiCredentialsMap.set(resolved, cfg);
  }
  if (!cfg) {
    return {
      hasConfig: false,
      provider: 'openai-compatible' as const,
      baseUrl: '',
      model: '',
      hasApiKey: false,
    };
  }
  return {
    hasConfig: true,
    provider: cfg.provider as string,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    hasApiKey: !!cfg.apiKey,
    lastTestAt: cfg.lastTestAt,
    lastError: cfg.lastError,
  };
});

ipcMain.handle('ai:testConnection', async (_e, vaultPath: string) => {
  const resolved = path.resolve(vaultPath);
  const cfg = aiCredentialsMap.get(resolved);
  if (!cfg || !cfg.baseUrl) {
    return { ok: false, error: 'AI not configured', testedAt: new Date().toISOString() };
  }
  try {
    const url = cfg.provider === 'ollama'
      ? `${cfg.baseUrl}/api/chat`
      : `${cfg.baseUrl}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    const body = cfg.provider === 'ollama'
      ? JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: 'Hi' }], stream: false })
      : JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 16 });
    const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const safeErr = errText.replace(/Bearer\s+\S+/gi, 'Bearer ***').slice(0, 200);
      cfg.lastError = `HTTP ${res.status}: ${safeErr}`;
      cfg.lastTestAt = new Date().toISOString();
      return { ok: false, error: cfg.lastError, testedAt: cfg.lastTestAt };
    }
    const raw = await res.json();
    let respModel = cfg.model;
    if (cfg.provider === 'ollama') {
      respModel = (raw as any).model || cfg.model;
    } else {
      respModel = (raw as any).model || cfg.model;
    }
    cfg.lastTestAt = new Date().toISOString();
    cfg.lastError = undefined;
    return { ok: true, model: respModel, testedAt: cfg.lastTestAt };
  } catch (err: any) {
    const safeMsg = (err.message || 'Connection failed').replace(/Bearer\s+\S+/gi, 'Bearer ***');
    cfg.lastError = safeMsg;
    cfg.lastTestAt = new Date().toISOString();
    return { ok: false, error: safeMsg, testedAt: cfg.lastTestAt };
  }
});

/* ── AI response type helpers ── */
interface AIModelsResponse { data?: Array<{ id?: string }>; models?: Array<{ name?: string; model?: string }> }
interface AIChatOllamaResponse { message?: { content?: string; tool_calls?: any[] }; model?: string }
interface AIChatOpenAIResponse { choices?: Array<{ message?: { content?: string | null; tool_calls?: any[] } }>; model?: string }

interface AIArtifactSummary {
  path: string;
  type: 'markdown' | 'canvas' | 'wireframe' | 'image' | 'other';
  action: 'created' | 'updated' | 'copied' | 'checked' | 'deleted';
  qualityStatus: 'not_applicable' | 'checked' | 'auto_fixed';
  notes: string[];
}

interface AIToolCallLog {
  name: string;
  args: Record<string, string>;
  result: string;
  artifacts?: AIArtifactSummary[];
}

interface AIToolSafetyContext {
  lastUserText: string;
  confirmedTokens: Set<string>;
  controlMode: AIControlMode;
}

type AIControlMode = 'readonly' | 'member' | 'producer';

interface AIPendingOperationRecord {
  version: number;
  token: string;
  requestHash: string;
  toolName: string;
  args: Record<string, string>;
  preview: string;
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'applied' | 'cancelled';
  requestedBy: 'ai';
  appliedAt?: string;
  cancelledAt?: string;
}

interface AIRollbackRootCandidate {
  relativePath: string;
  includeMissingFile?: boolean;
  cleanupIfCreated?: boolean;
}

interface AIRollbackRootState {
  relativePath: string;
  exists: boolean;
  type: 'file' | 'directory' | 'missing' | 'other';
}

interface AIRollbackFileSnapshot {
  relativePath: string;
  exists: boolean;
  size?: number;
  sha256?: string;
  contentBase64?: string;
  skippedReason?: string;
}

interface AIRollbackSnapshotFile {
  version: 1;
  token: string;
  toolName: string;
  requestHash: string;
  createdAt: string;
  finalizedAt?: string;
  status: 'captured' | 'available' | 'rolled_back' | 'partial';
  roots: AIRollbackRootCandidate[];
  beforeRoots: AIRollbackRootState[];
  afterRoots?: AIRollbackRootState[];
  before: AIRollbackFileSnapshot[];
  after?: AIRollbackFileSnapshot[];
  warnings: string[];
  rolledBackAt?: string;
}

interface AISafetySelfTestStep {
  name: string;
  ok: boolean;
  detail: string;
  durationMs?: number;
}

/* ── AI file tools ── */
const AI_FILE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the content of a file in the vault. Returns the file content as text.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path within the vault (e.g. "notes/character.md")' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file in the vault immediately when the user asked for it. The app saves live-history and an AI rollback snapshot before applying the change.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path within the vault (e.g. "notes/new-character.md")' },
          content: { type: 'string', description: 'The full file content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Safely delete a specific local file in the vault immediately when the user asked for it. Deletion creates live-history, an .ars-note/ai-trash recovery copy, an AI rollback snapshot, and a normal Live Sync delete record so connected computers receive the deletion automatically. Cannot delete folders or protected internal folders.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path within the vault to delete (e.g. "notes/old-draft.md")' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_files',
      description: 'Safely delete multiple local files in the vault immediately when the user asked for it. Each file gets live-history, an .ars-note/ai-trash recovery copy, an AI rollback snapshot, and a normal Live Sync delete record so connected computers receive the deletions automatically. Cannot delete folders or protected internal folders.',
      parameters: {
        type: 'object',
        properties: {
          paths: { type: 'string', description: 'JSON array, comma-separated list, or newline-separated list of vault-relative file paths to delete.' },
        },
        required: ['paths'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List all files and folders in a directory within the vault. Returns file names and types.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative directory path within the vault. Use "" or "/" for root.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_folder',
      description: 'Create a new folder in the vault immediately when the user asked for it. The app records an AI rollback snapshot for the created path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative folder path within the vault (e.g. "characters/heroes")' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'append_file',
      description: 'Append content to an existing file in the vault immediately when the user asked for it. The app saves live-history and an AI rollback snapshot before applying the change.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path within the vault' },
          content: { type: 'string', description: 'Content to append to the file' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_ai_pending_operations',
      description: 'List legacy pending AI operations that were created by older preview-token versions. New file changes apply directly in execution modes.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_ai_operation',
      description: 'Apply one legacy pending AI operation from older preview-token versions. New file changes apply directly in execution modes.',
      parameters: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'The confirmation token shown in the AI operation preview, e.g. AI-1234ABCD. The latest user message must contain this exact token.' },
        },
        required: ['token'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_ai_operation',
      description: 'Cancel one legacy pending AI operation from older preview-token versions.',
      parameters: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'The confirmation token to cancel, e.g. AI-1234ABCD.' },
        },
        required: ['token'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_team_schedule',
      description: 'Read the team production schedule from .ars-team/schedule.json. Use this before assigning work, estimating next steps, or taking over production flow.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of active tasks to return. Default 40.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_team_server_status',
      description: 'Read the self-hosted sync server production status for the current vault: online clients, server vault identity, synced team schedule/docs, AI memory files, AI skills, recent synced team files, warnings, and coordination advice. Use this before cross-computer task assignment, AI takeover, or diagnosing team sync reliability.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of recent synced team files to return. Default 24.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_team_member_work',
      description: 'Read server-side member work for the current vault: per-member active/blocked/overdue tasks, today and total logged time, recent logs, task linked-doc sync status, and coordination advice. Use this before assigning work to a named teammate or when the user asks what someone should do next.',
      parameters: {
        type: 'object',
        properties: {
          member: { type: 'string', description: 'Exact team member name. Leave empty to return all member workload rows without task details.' },
          limit: { type: 'number', description: 'Maximum tasks/logs to return. Default 40.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_production_health',
      description: 'Read a producer-focused health report for the team schedule, QA flow, and narrative production chain: blocked tasks, overdue tasks, due-soon tasks, missing owners, missing dates, missing linked documents, recent time logs, unresolved QA/Bug/playtest feedback, worldbuilding/story/quest/dialogue/performance/task-table gaps, weak narrative links, and recommended next actions.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of tasks/logs per focus section. Default 12.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_sync_recovery_advisor',
      description: 'Read the Sync Recovery Advisor plan for the current vault. Shows server versions, local versions, protected conflict/recovery copies, AI trash, recommended action, confidence, and whether the item can be batch-applied. Safe read-only tool for diagnosing old data, conflicts, missing GDD/worldbuilding files, and stale overwrites before syncing.',
      parameters: {
        type: 'object',
        properties: {
          since_hours: { type: 'number', description: 'How far back to inspect local/server recovery history. Default 720 hours.' },
          include_all_reasons: { type: 'boolean', description: 'Include all history reasons instead of only accident/sync-safety reasons. Default true.' },
          limit: { type: 'number', description: 'Maximum recommendation rows to return. Default 80.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_sync_recovery_advisor_plan',
      description: 'Apply the Sync Recovery Advisor high-confidence safe actions immediately when the user asked for repair. It may restore server/local/protected recovery versions or resolve obvious latest-version conflicts, writes a recovery report, and saves rollback history. It never deletes server files and does not bypass guarded recovery cleanup.',
      parameters: {
        type: 'object',
        properties: {
          since_hours: { type: 'number', description: 'How far back to inspect local/server recovery history. Default 720 hours.' },
          include_all_reasons: { type: 'boolean', description: 'Include all history reasons instead of only accident/sync-safety reasons. Default true.' },
          include_medium: { type: 'boolean', description: 'Also apply medium-confidence items. Default false; keep false unless the user explicitly asks.' },
          apply_limit: { type: 'number', description: 'Maximum number of recommendations to apply. Default 80.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bootstrap_team_workspace',
      description: 'Initialize or repair the Ars-note team production workspace when .ars-team is missing, empty, or too thin. Applies immediately in Producer takeover mode and saves rollback history before writing schedule/task docs/production docs.',
      parameters: {
        type: 'object',
        properties: {
          current_member: { type: 'string', description: 'Optional member name to assign bootstrap tasks to instead of leaving them unassigned.' },
          limit: { type: 'number', description: 'Maximum number of starter tasks to create/update. Default 48.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draft_narrative_tasks',
      description: 'Turn narrative production gaps into concrete team-schedule task drafts. Draft-only is read-only. If upsert=true, write the tasks immediately in Producer takeover mode and save rollback history before changing .ars-team/schedule.json.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of draft tasks to return. Default 24.' },
          include_qa: { type: 'boolean', description: 'Include QA/Bug/playtest narrative-impact tasks. Default true.' },
          upsert: { type: 'boolean', description: 'If true, create/update these tasks in the team schedule. Default false.' },
          source_label: { type: 'string', description: 'Short source label for upserted task notes, e.g. "AI narrative takeover".' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sync_team_task_docs',
      description: 'Synchronize linked task Markdown documents back into .ars-team/schedule.json immediately in Producer takeover mode, saving rollback history before writing.',
      parameters: {
        type: 'object',
        properties: {
          fallback_member: { type: 'string', description: 'Member name to use when a work-log line does not name a member.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'upsert_team_tasks',
      description: 'Create or update production tasks in the team schedule immediately in Producer takeover mode, saving rollback history before writing. Existing tasks with the same title + owner + linkedDoc are updated instead of duplicated. The tool automatically checks member load and may reassign unowned, unknown-owner, or overloaded-owner tasks before writing; report any Assignment guard lines to the user.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'string',
            description: 'JSON array of tasks. Each task may include: title, owner, status(todo|doing|review|blocked|done), priority(high|medium|low), dueDate(YYYY-MM-DD), estimateMinutes, linkedDoc, deliverable, dependency, blocker, acceptance, notes.',
          },
          source_label: { type: 'string', description: 'Short label explaining where these tasks came from, e.g. "AI narrative director".' },
        },
        required: ['tasks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_team_production_docs',
      description: 'Generate or refresh team production Markdown docs from the schedule and production-health report immediately in Producer takeover mode, saving rollback history before writing .ars-team docs or 07_Unity_Tasks docs.',
      parameters: {
        type: 'object',
        properties: {
          include_handoff: { type: 'boolean', description: 'Generate .ars-team/ai-handoff.md. Default true.' },
          include_ai_memory_index: { type: 'boolean', description: 'Generate .ars-team/ai-memory-index.md listing portable .ai-memory/MEMORY.md, USER.md, SOUL.md, skills, crons, and evolution sync coverage. Default true.' },
          include_link_health: { type: 'boolean', description: 'Generate .ars-team/link-health.md checking broken wiki-links, ambiguous links, orphan production docs, and task-doc mappings. Default true.' },
          include_dependency_map: { type: 'boolean', description: 'Generate .ars-team/dependency-map.md. Default true.' },
          include_blocker_handoff: { type: 'boolean', description: 'Generate .ars-team/handoffs/blocker-handoff-YYYYMMDD.md. Default true.' },
          include_review_queue: { type: 'boolean', description: 'Generate .ars-team/reviews/review-queue-YYYYMMDD.md. Default true.' },
          include_workpack: { type: 'boolean', description: 'Generate .ars-team/workpacks/daily-workpack-YYYYMMDD.md. Default true.' },
          include_daily_standup: { type: 'boolean', description: 'Generate .ars-team/reports/daily-standup-YYYYMMDD.md for daily production meeting notes and logged work. Default true.' },
          include_timesheet: { type: 'boolean', description: 'Generate .ars-team/timesheets/timesheet-YYYYMMDD.md with per-member daily time logs, task effort, and unlogged reminders. Default true.' },
          include_roadmap: { type: 'boolean', description: 'Generate .ars-team/roadmaps/milestone-roadmap-YYYYMMDD.md for overdue/this-week/next-week/four-week milestone capacity and risk review. Default true.' },
          include_decision_log: { type: 'boolean', description: 'Generate .ars-team/decisions/decision-log-YYYYMMDD.md for blocked/overdue/returned/missing-owner/missing-doc/missing-acceptance production decisions. Default true.' },
          include_change_impact: { type: 'boolean', description: 'Generate .ars-team/changes/change-impact-YYYYMMDD.md for worldbuilding/story/quest/dialogue/performance/UI/art/code/QA downstream impact review. Default true.' },
          include_narrative_director: { type: 'boolean', description: 'Generate .ars-team/narrative-director.md for worldbuilding/story/quest/dialogue/performance/task-table control. Default true.' },
          include_takeover_plan: { type: 'boolean', description: 'Generate .ars-team/plans/ai-takeover-plan-YYYYMMDD.md as the daily AI/producer execution script. Default true.' },
          include_sprint_plan: { type: 'boolean', description: 'Generate .ars-team/sprints/sprint-plan-YYYYMMDD.md for weekly planning. Default true.' },
          include_member_pages: { type: 'boolean', description: 'Generate .ars-team/members/MEMBER.md personal task pages so each teammate can open their own work queue. Default true.' },
          include_task_docs: { type: 'boolean', description: 'Create missing 07_Unity_Tasks/*.md task work docs and link them from the schedule. Default true.' },
          include_obsidian_command_center: { type: 'boolean', description: 'Generate the Ars-note team command center at the legacy-compatible path .ars-team/obsidian-command-center.md, with wiki-links, member entry points, and an AI takeover checklist. Default true.' },
          include_production_health: { type: 'boolean', description: 'Generate .ars-team/production-health.md with blocked/overdue/missing-doc/member-load/QA/narrative risk triage and AI takeover next actions. Default true.' },
          include_dashboard: { type: 'boolean', description: 'Generate .ars-team/team-dashboard.md. Default true.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_images',
      description: 'List image files in a directory (vault or external path). Supports png, jpg, jpeg, gif, svg, webp, bmp. Returns file paths and sizes.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to scan. Use relative path for vault (e.g. "assets/images") or absolute path for external folders (e.g. "C:/Users/Pictures"). Use "" for vault root.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'copy_image',
      description: 'Copy an image file into the vault immediately when the user asked for it and return a markdown image reference. The app records rollback history for the destination.',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Source image path. Can be relative to vault (e.g. "screenshots/ui.png") or absolute (e.g. "C:/Users/Pictures/photo.png")' },
          dest_folder: { type: 'string', description: 'Target folder within the vault (default: "assets"). E.g. "assets/images" or "01_GDD/images"' },
        },
        required: ['source'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_wireframe',
      description: 'Create a professional UI wireframe prototype as an .excalidraw file immediately when the user asked for it. Use only for visual UI/HUD/menu mockups; the app saves live-history and rollback history before writing.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path for the wireframe (must end in .excalidraw). E.g. "wireframes/LoginScreen.excalidraw"' },
          elements: { type: 'string', description: 'JSON array of UI elements. Each element: {role, x, y, w, h, label, ...}. Roles: screen, container, panel, card, sidebar, nav, statusbar, input, button, heading, text, divider, image, avatar, icon, arrow, checkbox, tab, list, table, progress, badge, chip, metric, callout. Use desktop 1366x768/1440x900 or mobile 390x844 frames, 24px page padding, 16px panel padding, 8-12px gaps, and short commercial labels. Recommended recipe: screen frame -> top nav/status -> left sidebar/rail -> main content panel -> secondary state/modal -> concise annotations. For dense blocks, use card/container/panel with an items array so the builder can auto-fit and auto-push same-column cards downward; do not overlay many separate text elements inside one small box. Tables may include rows as arrays/objects. Put production details in Markdown, not inside tiny wireframe boxes.' },
        },
        required: ['path', 'elements'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_canvas',
      description: 'Create a professional visual canvas board (.canvas file) immediately when the user explicitly asks for canvas, flowchart, mind map, kanban, relationship map, pipeline, or another visual board. The app saves live-history and rollback history before writing.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path ending in .canvas. E.g. "01_GDD/StoryArc.canvas"' },
          nodes: { type: 'string', description: 'JSON array of canvas nodes. Each node: {id, type:"text"|"file"|"group", x, y, width, height, text?, file?, color?}. Colors: "1"(red),"2"(orange),"3"(yellow),"4"(green),"5"(blue),"6"(purple). Professional boards should include a title card, legend/status card, 3-6 group/lane nodes, and 8-18 substantial cards with aligned coordinates and 60-100px spacing. Default substantial card size: 340×150 to 420×220. Use recipes such as Discovery→Design→Art/UX→Engineering→QA→Release, or Art Direction→Characters→Environment→UI/HUD→VFX→Acceptance. Do not rely on card scrolling: split dense sections into multiple connected cards.' },
          edges: { type: 'string', description: 'JSON array of canvas edges. Each edge: {id, fromNode, fromSide:"top"|"right"|"bottom"|"left", toNode, toSide}. Flowcharts must connect start -> stages -> decisions -> acceptance/end with clear dependencies.' },
        },
        required: ['path', 'nodes', 'edges'],
      },
    },
  },
];

/* ── Markdown → Canvas Auto-Converter ── */
/* When AI uses write_file instead of create_canvas, this converts markdown to canvas format */
function markdownToCanvas(markdown: string): { nodes: any[]; edges: any[] } {
  const nodes: any[] = [];
  const edges: any[] = [];
  let nodeId = 0;
  const nextId = (prefix = 'n') => `${prefix}${++nodeId}`;

  const blocks = markdown
    .split(/\n(?=#{1,3}\s)|\n\n+/)
    .map(block => block.trim())
    .filter(Boolean)
    .slice(0, 18);

  const cleanTitle = (blocks[0] || 'Visual Planning Board')
    .replace(/^#{1,6}\s*/, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80);

  nodes.push({
    id: 'title',
    type: 'text',
    x: 0,
    y: 0,
    width: 560,
    height: 120,
    text: `# ${cleanTitle}\n\nPurpose, scope, dependencies, and delivery checkpoints.`,
    color: '6',
  });
  nodes.push({
    id: 'legend',
    type: 'text',
    x: 620,
    y: 0,
    width: 380,
    height: 120,
    text: '**Legend**\n- Purple: strategy / goal\n- Blue: production step\n- Orange: risk / dependency\n- Green: acceptance / done',
    color: '5',
  });

  const laneNames = ['Brief', 'Design', 'Production', 'Validation'];
  const baseY = 180;
  const laneW = 420;
  const laneH = Math.max(430, Math.ceil(Math.max(blocks.length, 1) / laneNames.length) * 210 + 120);
  const gapX = 60;

  laneNames.forEach((name, index) => {
    const x = index * (laneW + gapX);
    nodes.push({
      id: `lane_${index + 1}`,
      type: 'group',
      x,
      y: baseY,
      width: laneW,
      height: laneH,
      color: index === 0 ? '6' : index === 1 ? '5' : index === 2 ? '2' : '4',
    });
    nodes.push({
      id: `lane_${index + 1}_label`,
      type: 'text',
      x: x + 24,
      y: baseY + 18,
      width: laneW - 48,
      height: 54,
      text: `## ${index + 1}. ${name}`,
      color: index === 0 ? '6' : index === 1 ? '5' : index === 2 ? '2' : '4',
    });
  });

  const cardW = 340;
  const cardBaseH = 150;
  const laneCardCounts = [0, 0, 0, 0];
  let prevCardId: string | null = null;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const lane = Math.min(laneNames.length - 1, Math.floor(i / Math.max(1, Math.ceil(blocks.length / laneNames.length))));
    const laneX = lane * (laneW + gapX);
    const laneRow = laneCardCounts[lane]++;
    const id = nextId('card_');
    const lineCount = block.split('\n').length;
    const estHeight = Math.max(cardBaseH, Math.min(260, lineCount * 24 + 56));
    const color = lane === 0 ? '6' : lane === 1 ? '5' : lane === 2 ? '2' : '4';

    nodes.push({
      id,
      type: 'text',
      x: laneX + 40,
      y: baseY + 94 + laneRow * 205,
      width: cardW,
      height: estHeight,
      text: block,
      color,
    });

    if (prevCardId) {
      edges.push({
        id: `edge_${edges.length + 1}`,
        fromNode: prevCardId,
        fromSide: 'right',
        toNode: id,
        toSide: 'left',
      });
    } else {
      edges.push({
        id: 'edge_title_1',
        fromNode: 'title',
        fromSide: 'bottom',
        toNode: id,
        toSide: 'top',
      });
    }
    prevCardId = id;
  }

  nodes.push({
    id: 'acceptance',
    type: 'text',
    x: laneNames.length * (laneW + gapX),
    y: baseY,
    width: 360,
    height: 190,
    text: '## Acceptance Gate\n- Output is complete and usable\n- Dependencies are identified\n- Owner and next action are clear\n- Risks are visible',
    color: '4',
  });
  if (prevCardId) {
    edges.push({
      id: `edge_${edges.length + 1}`,
      fromNode: prevCardId,
      fromSide: 'right',
      toNode: 'acceptance',
      toSide: 'left',
    });
  }

  return { nodes, edges };
}

function canvasCharUnits(ch: string): number {
  if (/[\u4e00-\u9fff]/.test(ch)) return 1.08;
  if (/\s/.test(ch)) return 0.35;
  if (/[A-Z0-9]/.test(ch)) return 0.68;
  return 0.58;
}

const AI_CANVAS_MAX_LINES_PER_CARD = 10;
const AI_CANVAS_MAX_CARD_HEIGHT = 360;
const AI_CANVAS_GRID = 20;
const AI_CANVAS_START_X = 80;
const AI_CANVAS_START_Y = 80;
const AI_CANVAS_MAX_COLUMNS = 3;
const AI_CANVAS_COLUMN_GAP = 84;
const AI_CANVAS_ROW_GAP = 34;
const AI_CANVAS_GROUP_WIDTH = 560;
const AI_CANVAS_GROUP_HEADER = 92;
const AI_CANVAS_GROUP_PADDING = 36;
const AI_CANVAS_GROUP_ASSIGN_SLACK_Y = 120;

function snapAICanvas(value: number): number {
  return Math.round(value / AI_CANVAS_GRID) * AI_CANVAS_GRID;
}

function estimateCanvasTextLines(text: string, width: number): number {
  const maxUnits = Math.max(12, Math.floor(Math.max(120, width - 28) / 7.4));
  let lines = 0;
  for (const rawLine of String(text || '').split('\n')) {
    if (!rawLine.trim()) {
      lines++;
      continue;
    }
    let units = 0;
    let lineCount = 1;
    for (const ch of rawLine) {
      const nextUnits = canvasCharUnits(ch);
      if (units + nextUnits > maxUnits && units > 0) {
        lineCount++;
        units = nextUnits;
      } else {
        units += nextUnits;
      }
    }
    lines += lineCount;
  }
  return Math.max(1, lines);
}

function splitLongCanvasLine(rawLine: string, width: number, maxLines: number): string[] {
  const maxUnits = Math.max(24, Math.floor(Math.max(120, width - 28) / 7.4) * maxLines);
  const parts: string[] = [];
  let current = '';
  let units = 0;

  for (const ch of String(rawLine || '')) {
    const nextUnits = canvasCharUnits(ch);
    if (units + nextUnits > maxUnits && current.trim()) {
      parts.push(current.trimEnd());
      current = ch.trimStart();
      units = canvasCharUnits(current);
    } else {
      current += ch;
      units += nextUnits;
    }
  }
  if (current.trim()) parts.push(current.trimEnd());
  return parts.length > 0 ? parts : [rawLine];
}

function splitCanvasTextIntoChunks(text: string, width: number, maxLines = AI_CANVAS_MAX_LINES_PER_CARD): string[] {
  const source = String(text || '').trim();
  if (!source) return [''];
  if (estimateCanvasTextLines(source, width) <= maxLines) return [source];

  const chunks: string[] = [];
  let current: string[] = [];

  for (const rawLine of source.split('\n')) {
    const lineParts = estimateCanvasTextLines(rawLine, width) > maxLines
      ? splitLongCanvasLine(rawLine, width, maxLines)
      : [rawLine];

    for (const linePart of lineParts) {
      const candidate = [...current, linePart].join('\n').trim();
      if (current.length > 0 && estimateCanvasTextLines(candidate, width) > maxLines) {
        chunks.push(current.join('\n').trimEnd());
        current = [];
      }
      current.push(linePart);
    }
  }

  if (current.length > 0) chunks.push(current.join('\n').trimEnd());
  return chunks.filter(chunk => chunk.trim()).slice(0, 24);
}

function isCanvasTextLabel(node: any): boolean {
  const id = String(node?.id || '').toLowerCase();
  const text = String(node?.text || '').trim();
  return id.includes('label') || (/^#{1,3}\s+/.test(text) && !text.includes('\n') && text.length <= 90);
}

function findContainingCanvasGroup(node: any, groups: any[]): any | null {
  const x = Number(node?.x) || 0;
  const y = Number(node?.y) || 0;
  const w = Number(node?.width) || 0;
  const h = Number(node?.height) || 0;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const nodeArea = Math.max(1, w * h);
  let best: any | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const group of groups) {
    const gx = Number(group?.x) || 0;
    const gy = Number(group?.y) || 0;
    const gw = Number(group?.width) || 0;
    const gh = Number(group?.height) || 0;

    const overlapX = Math.max(0, Math.min(x + w, gx + gw) - Math.max(x, gx));
    const overlapY = Math.max(0, Math.min(y + h, gy + gh + AI_CANVAS_GROUP_ASSIGN_SLACK_Y) - Math.max(y, gy));
    const overlapRatio = (overlapX * overlapY) / nodeArea;
    const centerInside = cx >= gx + 12
      && cx <= gx + gw - 12
      && cy >= gy + AI_CANVAS_GROUP_HEADER * 0.45
      && cy <= gy + gh + AI_CANVAS_GROUP_ASSIGN_SLACK_Y;
    const visuallyInside = centerInside || overlapRatio >= 0.28;

    if (!visuallyInside) continue;

    const headerPenalty = y < gy + AI_CANVAS_GROUP_HEADER * 0.4 ? 400 : 0;
    const distanceFromCenter = Math.abs(cx - (gx + gw / 2)) + Math.abs(cy - (gy + gh / 2));
    const score = distanceFromCenter + headerPenalty - overlapRatio * 140;
    if (score < bestScore) {
      best = group;
      bestScore = score;
    }
  }

  return best;
}

function fitAICanvasNodeForReadableLayout(node: any, preferredWidth?: number): any {
  if (!node || typeof node !== 'object') return node;

  if (node.type === 'group') {
    return {
      ...node,
      width: Math.max(420, Math.min(720, Number(node.width) || AI_CANVAS_GROUP_WIDTH)),
      height: Math.max(180, Number(node.height) || 260),
    };
  }

  if (node.type === 'file') {
    return {
      ...node,
      width: Math.max(260, Math.min(420, preferredWidth || Number(node.width) || 300)),
      height: Math.max(96, Math.min(140, Number(node.height) || 104)),
    };
  }

  if (node.type !== 'text') return node;

  const text = String(node.text || '');
  const labelLike = isCanvasTextLabel(node);
  const width = labelLike
    ? Math.max(260, Math.min(560, preferredWidth || Number(node.width) || 320))
    : Math.max(340, Math.min(560, preferredWidth || Number(node.width) || 380));
  const lines = estimateCanvasTextLines(text, width);
  const neededHeight = Math.ceil(lines * 19 + 46);
  const minHeight = labelLike ? 56 : 120;
  const maxHeight = labelLike ? 96 : AI_CANVAS_MAX_CARD_HEIGHT;

  return {
    ...node,
    width,
    height: Math.max(minHeight, Math.min(maxHeight, neededHeight)),
  };
}

function packLooseAICanvasNodes(items: any[], options: { startX: number; startY: number; columns?: number; cardWidth?: number }): void {
  if (items.length === 0) return;
  const sorted = [...items].sort((a: any, b: any) => (Number(a?.x) || 0) - (Number(b?.x) || 0) || (Number(a?.y) || 0) - (Number(b?.y) || 0));
  const columns = Math.max(1, Math.min(options.columns || AI_CANVAS_MAX_COLUMNS, items.length));
  const columnWidth = Math.max(360, options.cardWidth || 380);
  const columnY = Array.from({ length: columns }, () => options.startY);

  sorted.forEach((node: any, index: number) => {
    const col = columns === 1 ? 0 : index % columns;
    Object.assign(node, fitAICanvasNodeForReadableLayout(node, columnWidth));
    node.x = snapAICanvas(options.startX + col * (columnWidth + AI_CANVAS_COLUMN_GAP));
    node.y = snapAICanvas(columnY[col]);
    columnY[col] += (Number(node.height) || 120) + AI_CANVAS_ROW_GAP;
  });
}

function resolveAICanvasNonGroupOverlaps(nodes: any[]): void {
  const cards = nodes
    .filter((node: any) => node && node.type !== 'group')
    .sort((a: any, b: any) => (Number(a?.y) || 0) - (Number(b?.y) || 0) || (Number(a?.x) || 0) - (Number(b?.x) || 0));

  const placed: any[] = [];
  for (const node of cards) {
    let guard = 0;
    while (guard < 60 && placed.some((other: any) => canvasNodeRectsOverlap(node, other, 18))) {
      const blockers = placed.filter((other: any) => canvasNodeRectsOverlap(node, other, 18));
      const nextY = Math.max(
        Number(node.y) || 0,
        ...blockers.map((other: any) => (Number(other.y) || 0) + (Number(other.height) || 120) + AI_CANVAS_ROW_GAP),
      );
      node.y = snapAICanvas(nextY);
      guard++;
    }
    placed.push(node);
  }
}

function expandAICanvasGroupsToFitChildren(nodes: any[]): void {
  const groups = nodes.filter((node: any) => node?.type === 'group');
  const cards = nodes.filter((node: any) => node && node.type !== 'group');
  for (const group of groups) {
    const gx = Number(group.x) || 0;
    const gy = Number(group.y) || 0;
    const gw = Number(group.width) || AI_CANVAS_GROUP_WIDTH;
    let bottom = gy + Math.max(180, Number(group.height) || 0);

    for (const node of cards) {
      const x = Number(node.x) || 0;
      const y = Number(node.y) || 0;
      const w = Number(node.width) || 0;
      const h = Number(node.height) || 0;
      const cx = x + w / 2;
      const belongsHorizontally = cx >= gx + AI_CANVAS_GROUP_PADDING * 0.5 && cx <= gx + gw - AI_CANVAS_GROUP_PADDING * 0.5;
      const belongsVertically = y >= gy + AI_CANVAS_GROUP_HEADER * 0.6 && y <= bottom + AI_CANVAS_GROUP_ASSIGN_SLACK_Y;
      if (belongsHorizontally && belongsVertically) {
        bottom = Math.max(bottom, y + h + AI_CANVAS_GROUP_PADDING);
      }
    }

    group.height = snapAICanvas(Math.max(Number(group.height) || 0, bottom - gy));
  }
}

function reflowAICanvasNodes(inputNodes: any[]): any[] {
  const nodes = inputNodes.map((node: any) => node && typeof node === 'object' ? { ...node } : node);
  const groups = nodes.filter((node: any) => node?.type === 'group');
  const labels = nodes.filter((node: any) => node && node.type !== 'group' && isCanvasTextLabel(node));
  const nonGroups = nodes.filter((node: any) => node && node.type !== 'group' && !isCanvasTextLabel(node));
  const groupedItems = new Map<string, any[]>();
  const looseItems: any[] = [];

  for (const node of nonGroups) {
    const group = findContainingCanvasGroup(node, groups);
    if (!group) {
      looseItems.push(node);
      continue;
    }
    const key = String(group.id);
    const items = groupedItems.get(key) || [];
    items.push(node);
    groupedItems.set(key, items);
  }

  if (labels.length > 0) {
    let labelX = AI_CANVAS_START_X;
    let labelY = 24;
    const labelMaxX = AI_CANVAS_START_X + AI_CANVAS_MAX_COLUMNS * (AI_CANVAS_GROUP_WIDTH + AI_CANVAS_COLUMN_GAP);
    labels
      .sort((a: any, b: any) => (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0))
      .forEach((node: any) => {
        Object.assign(node, fitAICanvasNodeForReadableLayout(node));
        if (labelX + (Number(node.width) || 320) > labelMaxX) {
          labelX = AI_CANVAS_START_X;
          labelY += 104;
        }
        node.x = snapAICanvas(labelX);
        node.y = snapAICanvas(labelY);
        labelX += (Number(node.width) || 320) + 28;
      });
  }

  if (groups.length > 0) {
    const startY: number = labels.length > 0 ? 140 : AI_CANVAS_START_Y;
    const columns = Math.max(1, Math.min(AI_CANVAS_MAX_COLUMNS, groups.length));
    const columnY: number[] = Array.from({ length: columns }, () => startY);

    groups
      .sort((a: any, b: any) => (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0))
      .forEach((group: any) => {
        const col = columnY.indexOf(Math.min(...columnY));
        group.x = snapAICanvas(AI_CANVAS_START_X + col * (AI_CANVAS_GROUP_WIDTH + AI_CANVAS_COLUMN_GAP));
        group.y = snapAICanvas(columnY[col]);
        group.width = Math.max(AI_CANVAS_GROUP_WIDTH, Math.min(720, Number(group.width) || AI_CANVAS_GROUP_WIDTH));

        const items = (groupedItems.get(String(group.id)) || [])
          .sort((a: any, b: any) => (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0));
        let cursor = group.y + AI_CANVAS_GROUP_HEADER;
        for (const node of items) {
          const innerWidth = Math.max(260, group.width - AI_CANVAS_GROUP_PADDING * 2);
          Object.assign(node, fitAICanvasNodeForReadableLayout(node, innerWidth));
          node.x = snapAICanvas(group.x + AI_CANVAS_GROUP_PADDING);
          node.y = snapAICanvas(cursor);
          node.width = innerWidth;
          cursor = node.y + (Number(node.height) || 120) + 28;
        }

        group.height = Math.max(220, cursor - group.y + AI_CANVAS_GROUP_PADDING);
        columnY[col] = group.y + group.height + 62;
      });

    const looseStartY = Math.max(...columnY, startY) + (looseItems.length > 0 ? 24 : 0);
    packLooseAICanvasNodes(looseItems, {
      startX: AI_CANVAS_START_X,
      startY: looseStartY,
      columns: Math.min(AI_CANVAS_MAX_COLUMNS, Math.max(1, looseItems.length)),
      cardWidth: 380,
    });
  } else {
    packLooseAICanvasNodes(nonGroups, {
      startX: AI_CANVAS_START_X,
      startY: labels.length > 0 ? 140 : AI_CANVAS_START_Y,
      columns: Math.min(AI_CANVAS_MAX_COLUMNS, Math.max(1, nonGroups.length)),
      cardWidth: 380,
    });
  }

  resolveAICanvasNonGroupOverlaps(nodes);
  expandAICanvasGroupsToFitChildren(nodes);
  return nodes;
}

function normalizeAICanvasData(canvasData: { nodes: any[]; edges: any[] }): { nodes: any[]; edges: any[] } {
  const sourceNodes = Array.isArray(canvasData.nodes) ? canvasData.nodes : [];
  const nodes: any[] = [];
  const continuationEdges: any[] = [];
  const firstSplitNodeById = new Map<string, string>();
  const lastSplitNodeById = new Map<string, string>();

  sourceNodes.forEach((node: any, nodeIndex: number) => {
    if (!node || node.type !== 'text') {
      nodes.push(node);
      return;
    }

    const baseId = String(node.id || `node_${nodeIndex + 1}`);
    const text = String(node.text || '');
    const originalWidth = Number(node.width) || 360;
    const width = Math.max(text.length > 520 ? 380 : 320, Math.min(620, originalWidth));
    const chunks = splitCanvasTextIntoChunks(text, width);
    const originalY = Number(node.y) || 0;
    let y = originalY;
    let previousPartId = '';

    chunks.forEach((chunk, partIndex) => {
      const partId = partIndex === 0 ? baseId : `${baseId}_part_${partIndex + 1}`;
      const lines = estimateCanvasTextLines(chunk, width);
      const neededHeight = Math.ceil(lines * 19 + 44);
      const labelLike = isCanvasTextLabel({ ...node, text: chunk, id: partId });
      const minHeight = labelLike ? 56 : 120;
      const maxHeight = labelLike ? 96 : AI_CANVAS_MAX_CARD_HEIGHT;
      const height = Math.max(partIndex === 0 ? Number(node.height) || 0 : 0, Math.max(minHeight, Math.min(maxHeight, neededHeight)));

      nodes.push({
        ...node,
        id: partId,
        width,
        height,
        y,
        text: chunk,
      });

      if (partIndex === 0) {
        firstSplitNodeById.set(baseId, partId);
      } else {
        continuationEdges.push({
          id: `edge_${baseId}_part_${partIndex}`,
          fromNode: previousPartId,
          fromSide: 'bottom',
          toNode: partId,
          toSide: 'top',
        });
      }

      previousPartId = partId;
      y += height + 28;
    });

    lastSplitNodeById.set(baseId, previousPartId || baseId);
  });

  const edges = (Array.isArray(canvasData.edges) ? canvasData.edges : []).map((edge: any) => ({
    ...edge,
    fromNode: lastSplitNodeById.get(String(edge?.fromNode || '')) || edge?.fromNode,
    toNode: firstSplitNodeById.get(String(edge?.toNode || '')) || edge?.toNode,
  }));

  return { nodes: reflowAICanvasNodes(nodes), edges: [...edges, ...continuationEdges] };
}

function visualCompanionPath(relPath: string): string {
  return relPath.replace(/\.(canvas|excalidraw)$/i, '.visual.md');
}

function compactVisualText(value: unknown, maxLength = 160): string {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_~`>|[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function firstVisualLine(value: unknown, fallback = 'Untitled'): string {
  const lines = String(value || '').split('\n').map(line => compactVisualText(line, 96)).filter(Boolean);
  return lines[0] || fallback;
}

interface CanvasQualityReport {
  score: number;
  strengths: string[];
  warnings: string[];
  nextActions: string[];
  overlapCount: number;
  longCardCount: number;
  fileCardCount: number;
}

function canvasNodeRectsOverlap(a: any, b: any, gap = 8): boolean {
  const ax = Number(a?.x) || 0;
  const ay = Number(a?.y) || 0;
  const aw = Number(a?.width) || 0;
  const ah = Number(a?.height) || 0;
  const bx = Number(b?.x) || 0;
  const by = Number(b?.y) || 0;
  const bw = Number(b?.width) || 0;
  const bh = Number(b?.height) || 0;
  return ax < bx + bw + gap
    && ax + aw + gap > bx
    && ay < by + bh + gap
    && ay + ah + gap > by;
}

function analyzeCanvasQuality(canvasData: { nodes: any[]; edges: any[] }): CanvasQualityReport {
  const nodes = Array.isArray(canvasData.nodes) ? canvasData.nodes : [];
  const edges = Array.isArray(canvasData.edges) ? canvasData.edges : [];
  const textCards = nodes.filter((node: any) => node?.type === 'text');
  const fileCards = nodes.filter((node: any) => node?.type === 'file');
  const groups = nodes.filter((node: any) => node?.type === 'group');
  const nonGroups = nodes.filter((node: any) => node && node.type !== 'group');
  const textBlob = textCards.map((node: any) => String(node?.text || '')).join('\n').toLowerCase();
  const hasTitle = textCards.some((node: any) => /^#{1,2}\s+/.test(String(node?.text || '').trim()))
    || /title|overview|总览|标题/.test(textBlob);
  const hasLegend = /legend|status|priority|p0|p1|p2|图例|状态|优先级/.test(textBlob);
  const uniqueConnectedNodes = new Set<string>();
  for (const edge of edges) {
    if (edge?.fromNode) uniqueConnectedNodes.add(String(edge.fromNode));
    if (edge?.toNode) uniqueConnectedNodes.add(String(edge.toNode));
  }

  let overlapCount = 0;
  for (let i = 0; i < nonGroups.length; i++) {
    for (let j = i + 1; j < nonGroups.length; j++) {
      if (canvasNodeRectsOverlap(nonGroups[i], nonGroups[j], 12)) overlapCount++;
    }
  }

  const longCardCount = textCards.filter((node: any) => {
    const lines = estimateCanvasTextLines(String(node?.text || ''), Number(node?.width) || 380);
    return lines > AI_CANVAS_MAX_LINES_PER_CARD || String(node?.text || '').length > 900;
  }).length;

  const strengths: string[] = [];
  const warnings: string[] = [];
  const nextActions: string[] = [];
  let score = 100;

  if (hasTitle) strengths.push('Has a clear title / overview card.');
  else { score -= 10; warnings.push('Missing a clear title card.'); nextActions.push('Add a title card explaining the board purpose.'); }

  if (hasLegend) strengths.push('Has status or priority legend information.');
  else { score -= 8; warnings.push('Missing legend/status explanation.'); nextActions.push('Add a small legend for priority, status, or color meaning.'); }

  if (groups.length >= 2) strengths.push(`Uses ${groups.length} groups / lanes for structure.`);
  else { score -= 14; warnings.push('Not enough groups/lanes for a professional board.'); nextActions.push('Use 3-6 lanes such as Direction, Assets, Implementation, Risks, Acceptance.'); }

  if (textCards.length >= 6 && textCards.length <= 24) strengths.push(`Card count is readable (${textCards.length} text cards).`);
  else if (textCards.length < 6) { score -= 10; warnings.push('Too few text cards to express a useful plan.'); }
  else { score -= 12; warnings.push('Too many cards; consider splitting into multiple boards or a Markdown spec.'); }

  if (edges.length >= Math.max(1, Math.floor(textCards.length / 3))) strengths.push(`Connections are present (${edges.length}).`);
  else { score -= 12; warnings.push('Too few explicit connections/dependencies.'); nextActions.push('Connect stage cards and dependency cards with arrows.'); }

  if (uniqueConnectedNodes.size > 0 && uniqueConnectedNodes.size < Math.ceil(textCards.length * 0.35)) {
    score -= 6;
    warnings.push('Only a small portion of cards participate in the flow.');
  }

  if (fileCards.length > 0) strengths.push(`Links ${fileCards.length} existing file card(s).`);
  if (overlapCount > 0) {
    score -= Math.min(30, overlapCount * 5);
    warnings.push(`Detected ${overlapCount} possible overlapping card pair(s).`);
    nextActions.push('Use Auto layout in Canvas if anything still appears cramped.');
  }
  if (longCardCount > 0) {
    score -= Math.min(20, longCardCount * 5);
    warnings.push(`${longCardCount} card(s) may still be too dense.`);
    nextActions.push('Split dense cards or move detailed production text into Markdown.');
  }

  if (nextActions.length === 0) {
    nextActions.push('Review ownership, priority, dependencies, and acceptance criteria before production use.');
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    strengths,
    warnings,
    nextActions: Array.from(new Set(nextActions)).slice(0, 6),
    overlapCount,
    longCardCount,
    fileCardCount: fileCards.length,
  };
}

function buildCanvasCompanionMarkdown(relPath: string, canvasData: { nodes: any[]; edges: any[] }): string {
  const nodes = Array.isArray(canvasData.nodes) ? canvasData.nodes : [];
  const edges = Array.isArray(canvasData.edges) ? canvasData.edges : [];
  const textCards = nodes.filter((node: any) => node?.type === 'text');
  const groups = nodes.filter((node: any) => node?.type === 'group');
  const quality = analyzeCanvasQuality(canvasData);
  const title = textCards.length > 0
    ? firstVisualLine(textCards[0]?.text, path.basename(relPath, path.extname(relPath)))
    : path.basename(relPath, path.extname(relPath));
  const nodeTitle = new Map<string, string>();
  for (const node of nodes) {
    nodeTitle.set(String(node?.id || ''), node?.type === 'text'
      ? firstVisualLine(node.text, String(node?.id || 'node'))
      : String(node?.label || node?.id || node?.type || 'node'));
  }

  const cards = textCards
    .slice(0, 20)
    .map((node: any, index: number) => {
      const text = String(node?.text || '');
      const [first, ...rest] = text.split('\n');
      const name = compactVisualText(first, 92) || `Card ${index + 1}`;
      const summary = compactVisualText(rest.join(' '), 180);
      return `- **${name}**${summary ? ` - ${summary}` : ''}`;
    });

  const connections = edges
    .slice(0, 16)
    .map((edge: any) => {
      const from = nodeTitle.get(String(edge?.fromNode || '')) || String(edge?.fromNode || 'Start');
      const to = nodeTitle.get(String(edge?.toNode || '')) || String(edge?.toNode || 'Next');
      return `- ${from} -> ${to}`;
    });

  return [
    `# ${title}`,
    '',
    `Source visual: \`${relPath}\``,
    '',
    '## Board Summary',
    `- Cards: ${textCards.length}`,
    `- Groups / lanes: ${groups.length}`,
    `- Connections: ${edges.length}`,
    `- File cards: ${quality.fileCardCount}`,
    '',
    '## Board Quality',
    `- Score: ${quality.score}/100`,
    `- Overlap risk: ${quality.overlapCount === 0 ? 'none detected' : `${quality.overlapCount} possible pair(s)`}`,
    `- Dense cards: ${quality.longCardCount}`,
    '',
    '### Strengths',
    ...(quality.strengths.length ? quality.strengths.map(item => `- ${item}`) : ['- No major strengths detected yet.']),
    '',
    '### Warnings',
    ...(quality.warnings.length ? quality.warnings.map(item => `- ${item}`) : ['- No obvious layout warnings detected.']),
    '',
    '## Main Cards',
    ...(cards.length ? cards : ['- No readable text cards were detected.']),
    '',
    '## Flow / Dependencies',
    ...(connections.length ? connections : ['- No explicit connections were detected.']),
    '',
    '## Review Checklist',
    '- Confirm every card has one clear owner or next action.',
    '- Move detailed production requirements into Markdown sections instead of oversized cards.',
    '- Keep the visual board focused on structure, dependency, priority, and status.',
    '',
    '## Recommended Next Actions',
    ...quality.nextActions.map(item => `- ${item}`),
    '',
    '> Auto-generated by Ars-note AI visual companion. Safe to edit.',
    '',
  ].join('\n');
}

function summarizeWireframeElement(el: any, index: number): string {
  const role = String(el?.role || el?.type || 'element');
  const label = compactVisualText(el?.label || el?.title || el?.text || el?.placeholder || '', 110);
  const items = Array.isArray(el?.items)
    ? el.items.map((item: any) => compactVisualText(typeof item === 'object' ? item.label || item.text : item, 44)).filter(Boolean).slice(0, 4)
    : [];
  const detail = items.length ? ` (${items.join(', ')})` : '';
  return `- **${role} ${index + 1}**${label ? ` - ${label}` : ''}${detail}`;
}

function buildWireframeCompanionMarkdown(relPath: string, elements: any[], scene: any): string {
  const sourceElements = Array.isArray(elements) ? elements : [];
  const sceneElements = Array.isArray(scene?.elements) ? scene.elements : [];
  const titleElement = sourceElements.find((el: any) => /^(screen|frame|heading|nav|navbar)$/i.test(String(el?.role || el?.type || '')) && (el?.label || el?.text));
  const title = firstVisualLine(titleElement?.label || titleElement?.text, path.basename(relPath, path.extname(relPath)));
  const roleCounts = sourceElements.reduce((acc: Record<string, number>, el: any) => {
    const role = String(el?.role || el?.type || 'element').toLowerCase();
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {});
  const roleSummary = Object.entries(roleCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([role, count]) => `- ${role}: ${count}`);
  const modules = sourceElements
    .filter((el: any) => /^(screen|frame|container|panel|card|sidebar|nav|navbar|toolbar|table|list|callout|metric|button)$/i.test(String(el?.role || el?.type || '')))
    .slice(0, 22)
    .map(summarizeWireframeElement);

  return [
    `# ${title}`,
    '',
    `Source wireframe: \`${relPath}\``,
    '',
    '## Wireframe Summary',
    `- Input elements: ${sourceElements.length}`,
    `- Rendered Excalidraw elements: ${sceneElements.length}`,
    '',
    '## Element Mix',
    ...(roleSummary.length ? roleSummary : ['- No role metadata was detected.']),
    '',
    '## Main UI Modules',
    ...(modules.length ? modules : ['- No major UI modules were detected.']),
    '',
    '## Production Notes',
    '- Keep wireframe labels short; place detailed copy and implementation notes in this Markdown file.',
    '- Check desktop/mobile breakpoints, empty states, hover/active states, loading states, and error states.',
    '- Convert accepted modules into art requirements, UI component requirements, and technical acceptance criteria.',
    '',
    '> Auto-generated by Ars-note AI visual companion. Safe to edit.',
    '',
  ].join('\n');
}

function writeAIVisualCompanion(vaultPath: string, relPath: string, markdown: string): string {
  const companionRelPath = visualCompanionPath(relPath);
  const fullPath = path.join(vaultPath, companionRelPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  saveLiveHistoryBeforeOverwrite(fullPath, markdown, 'ai-visual-companion');
  fs.writeFileSync(fullPath, markdown, 'utf-8');
  return companionRelPath;
}

function isProtectedAIFileDeletePath(relativePath: string): boolean {
  const normalized = normalizeVaultRelativePath(relativePath).toLowerCase();
  if (!normalized) return true;
  const firstPart = normalized.split('/')[0];
  return firstPart === ARS_NOTE_DIR
    || firstPart === AI_MEMORY_DIR
    || firstPart === TEAM_SCHEDULE_DIR
    || firstPart.startsWith('.')
    || firstPart === '.git'
    || firstPart === 'node_modules';
}

function saveAIFileDeleteRecoveryCopy(vaultPath: string, relativePath: string, fullPath: string): string {
  const resolvedVault = path.resolve(vaultPath);
  const normalized = normalizeVaultRelativePath(relativePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const recoveryRoot = path.resolve(resolvedVault, ARS_NOTE_DIR, AI_TRASH_DIR, stamp);
  const recoveryPath = path.resolve(recoveryRoot, normalized);
  if (recoveryPath !== recoveryRoot && !isInsidePath(recoveryPath, recoveryRoot)) {
    throw new Error('Invalid recovery path');
  }
  fs.mkdirSync(path.dirname(recoveryPath), { recursive: true });
  fs.copyFileSync(fullPath, recoveryPath);
  return path.relative(resolvedVault, recoveryPath).replace(/\\/g, '/');
}

function aiServerDeleteHoldFilePath(vaultPath: string): string {
  return path.join(path.resolve(vaultPath), ARS_NOTE_DIR, AI_SERVER_DELETE_HOLD_FILE);
}

function writeAIServerDeleteHold(vaultPath: string, relativePath: string, fullPath: string, recoveryPath: string): string {
  const resolvedVault = path.resolve(vaultPath);
  const normalized = normalizeVaultRelativePath(relativePath);
  const holdPath = aiServerDeleteHoldFilePath(resolvedVault);
  const current = readJsonSafe<any>(holdPath, { version: 1, items: [] });
  const items = Array.isArray(current?.items) ? current.items : [];
  const stat = fs.statSync(fullPath);
  const item = {
    relativePath: normalized,
    sha256: fileSha256(fullPath),
    size: stat.size,
    updatedAt: new Date(stat.mtimeMs).toISOString(),
    deletedAt: new Date().toISOString(),
    recoveryPath,
    source: 'ai-delete',
    reason: 'AI delete confirmed by user. Live Sync may publish the server delete automatically.',
  };
  const nextItems = items
    .filter((entry: any) => normalizeVaultRelativePath(String(entry?.relativePath || '')) !== normalized)
    .concat(item);
  writeJson(holdPath, {
    version: 1,
    updatedAt: new Date().toISOString(),
    items: nextItems,
  });
  return path.relative(resolvedVault, holdPath).replace(/\\/g, '/');
}

function clearAIServerDeleteHold(vaultPath: string, relativePath: string): void {
  const normalized = normalizeVaultRelativePath(relativePath);
  if (!normalized) return;
  const holdPath = aiServerDeleteHoldFilePath(vaultPath);
  const current = readJsonSafe<any>(holdPath, { version: 1, items: [] });
  const items = Array.isArray(current?.items) ? current.items : [];
  const nextItems = items.filter((entry: any) => normalizeVaultRelativePath(String(entry?.relativePath || '')) !== normalized);
  if (nextItems.length === items.length) return;
  writeJson(holdPath, {
    version: 1,
    updatedAt: new Date().toISOString(),
    items: nextItems,
  });
}

function resolveAITrashRecoveryCopy(vaultPath: string, recoveryRelativePath: string): {
  resolvedVault: string;
  recoveryRelativePath: string;
  recoveryPath: string;
  originalRelativePath: string;
  targetPath: string;
} {
  const resolvedVault = path.resolve(vaultPath);
  const trashRoot = path.resolve(path.join(resolvedVault, ARS_NOTE_DIR, AI_TRASH_DIR));
  const normalized = normalizeVaultRelativePath(recoveryRelativePath);
  const prefix = `${ARS_NOTE_DIR}/${AI_TRASH_DIR}/`;
  if (!normalized.startsWith(prefix)) {
    throw new Error('Recovery file is not inside AI trash');
  }

  const recoveryPath = path.resolve(path.join(resolvedVault, normalized.replace(/\//g, path.sep)));
  if (recoveryPath === trashRoot || !isInsidePath(recoveryPath, trashRoot)) {
    throw new Error('Refusing to read AI trash file outside recovery folder');
  }
  if (!fs.existsSync(recoveryPath) || !fs.statSync(recoveryPath).isFile()) {
    throw new Error('AI trash recovery file not found');
  }

  const originalRelativePath = originalPathFromAITrashRelativePath(normalized);
  if (!originalRelativePath) {
    throw new Error('AI trash recovery file does not include an original path');
  }
  if (isProtectedAIFileDeletePath(originalRelativePath)) {
    throw new Error(`Refusing to restore protected path: ${originalRelativePath}`);
  }

  const targetPath = path.resolve(path.join(resolvedVault, originalRelativePath.replace(/\//g, path.sep)));
  if (!isInsidePath(targetPath, resolvedVault)) {
    throw new Error('Refusing to restore outside vault');
  }
  if (fs.existsSync(targetPath) && !fs.statSync(targetPath).isFile()) {
    throw new Error('Restore target exists but is not a file');
  }

  return {
    resolvedVault,
    recoveryRelativePath: normalized,
    recoveryPath,
    originalRelativePath,
    targetPath,
  };
}

function previewAITrashRecoveryCopy(vaultPath: string, recoveryRelativePath: string): any {
  const resolved = resolveAITrashRecoveryCopy(vaultPath, recoveryRelativePath);
  const recoveryStat = fs.statSync(resolved.recoveryPath);
  const recoveryPreview = bufferPreviewText(fs.readFileSync(resolved.recoveryPath));
  const targetExists = fs.existsSync(resolved.targetPath);
  const targetStat = targetExists ? fs.statSync(resolved.targetPath) : null;
  const targetPreview = targetExists && targetStat?.isFile()
    ? bufferPreviewText(fs.readFileSync(resolved.targetPath))
    : { content: '', truncated: false };
  return {
    recoveryRelativePath: resolved.recoveryRelativePath,
    originalRelativePath: resolved.originalRelativePath,
    size: recoveryStat.size,
    modifiedAt: recoveryStat.mtime.toISOString(),
    content: recoveryPreview.content,
    contentTruncated: recoveryPreview.truncated,
    targetExists,
    targetSize: targetStat?.size || 0,
    targetModifiedAt: targetStat?.mtime.toISOString() || null,
    targetContent: targetPreview.content,
    targetTruncated: targetPreview.truncated,
    diff: lineDiffSummary(targetPreview.content, recoveryPreview.content),
  };
}

function restoreAITrashRecoveryCopy(vaultPath: string, recoveryRelativePath: string): any {
  const resolved = resolveAITrashRecoveryCopy(vaultPath, recoveryRelativePath);
  const content = fs.readFileSync(resolved.recoveryPath);
  fs.mkdirSync(path.dirname(resolved.targetPath), { recursive: true });
  saveLiveHistoryBeforeOverwrite(resolved.targetPath, content, 'before-ai-trash-restore');
  fs.writeFileSync(resolved.targetPath, content);
  return {
    ok: true,
    restoredPath: resolved.originalRelativePath,
    recoveryPath: resolved.recoveryRelativePath,
    restoredAt: new Date().toISOString(),
  };
}

function resolveProtectedLocalRecoveryCopy(vaultPath: string, recoveryRelativePath: string): {
  resolvedVault: string;
  recoveryRelativePath: string;
  recoveryPath: string;
  originalRelativePath: string;
  targetPath: string;
} {
  const resolvedVault = path.resolve(vaultPath);
  const recoveryRoot = path.resolve(path.join(resolvedVault, ARS_NOTE_DIR, SYNC_RECOVERY_DIR));
  const normalized = normalizeVaultRelativePath(recoveryRelativePath);
  const prefix = `${ARS_NOTE_DIR}/${SYNC_RECOVERY_DIR}/`;
  if (!normalized.startsWith(prefix)) {
    throw new Error('Recovery file is not inside protected sync recovery');
  }

  const recoveryPath = path.resolve(path.join(resolvedVault, normalized.replace(/\//g, path.sep)));
  if (recoveryPath === recoveryRoot || !isInsidePath(recoveryPath, recoveryRoot)) {
    throw new Error('Refusing to read protected recovery file outside recovery folder');
  }
  if (!fs.existsSync(recoveryPath) || !fs.statSync(recoveryPath).isFile()) {
    throw new Error('Protected local recovery file not found');
  }

  const originalRelativePath = originalPathFromProtectedLocalRecoveryRelativePath(normalized);
  if (!originalRelativePath) {
    throw new Error('Protected recovery file does not include an original path');
  }
  if (isProtectedLocalRecoveryTargetPath(originalRelativePath)) {
    throw new Error(`Refusing to restore protected path: ${originalRelativePath}`);
  }

  const targetPath = path.resolve(path.join(resolvedVault, originalRelativePath.replace(/\//g, path.sep)));
  if (!isInsidePath(targetPath, resolvedVault)) {
    throw new Error('Refusing to restore outside vault');
  }
  if (fs.existsSync(targetPath) && !fs.statSync(targetPath).isFile()) {
    throw new Error('Restore target exists but is not a file');
  }

  return {
    resolvedVault,
    recoveryRelativePath: normalized,
    recoveryPath,
    originalRelativePath,
    targetPath,
  };
}

function previewProtectedLocalRecoveryCopy(vaultPath: string, recoveryRelativePath: string): any {
  const resolved = resolveProtectedLocalRecoveryCopy(vaultPath, recoveryRelativePath);
  const recoveryStat = fs.statSync(resolved.recoveryPath);
  const recoveryPreview = bufferPreviewText(fs.readFileSync(resolved.recoveryPath));
  const targetExists = fs.existsSync(resolved.targetPath);
  const targetStat = targetExists ? fs.statSync(resolved.targetPath) : null;
  const targetPreview = targetExists && targetStat?.isFile()
    ? bufferPreviewText(fs.readFileSync(resolved.targetPath))
    : { content: '', truncated: false };
  return {
    recoveryRelativePath: resolved.recoveryRelativePath,
    originalRelativePath: resolved.originalRelativePath,
    reason: protectedLocalRecoveryReasonFromRelativePath(resolved.recoveryRelativePath),
    size: recoveryStat.size,
    modifiedAt: recoveryStat.mtime.toISOString(),
    content: recoveryPreview.content,
    contentTruncated: recoveryPreview.truncated,
    targetExists,
    targetSize: targetStat?.size || 0,
    targetModifiedAt: targetStat?.mtime.toISOString() || null,
    targetContent: targetPreview.content,
    targetTruncated: targetPreview.truncated,
    diff: lineDiffSummary(targetPreview.content, recoveryPreview.content),
  };
}

function restoreProtectedLocalRecoveryCopy(vaultPath: string, recoveryRelativePath: string): any {
  const resolved = resolveProtectedLocalRecoveryCopy(vaultPath, recoveryRelativePath);
  const content = fs.readFileSync(resolved.recoveryPath);
  fs.mkdirSync(path.dirname(resolved.targetPath), { recursive: true });
  saveLiveHistoryBeforeOverwrite(resolved.targetPath, content, 'before-protected-local-recovery-restore');
  fs.writeFileSync(resolved.targetPath, content);
  return {
    ok: true,
    restoredPath: resolved.originalRelativePath,
    recoveryPath: resolved.recoveryRelativePath,
    restoredAt: new Date().toISOString(),
  };
}

const AI_CONFIRM_TOKEN_RE = /\bAI-[A-Z0-9]{8}\b/gi;
const AI_PENDING_OPERATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AI_MUTATING_TOOLS = new Set([
  'write_file',
  'append_file',
  'delete_file',
  'delete_files',
  'create_folder',
  'copy_image',
  'create_canvas',
  'create_wireframe',
  'bootstrap_team_workspace',
  'sync_team_task_docs',
  'upsert_team_tasks',
  'generate_team_production_docs',
  'apply_sync_recovery_advisor_plan',
]);

const AI_READONLY_TOOLS = new Set([
  'read_file',
  'list_files',
  'list_images',
  'read_team_schedule',
  'read_team_server_status',
  'read_team_member_work',
  'read_production_health',
  'read_sync_recovery_advisor',
  'list_ai_pending_operations',
  'cancel_ai_operation',
]);

const AI_MEMBER_TOOLS = new Set([
  ...AI_READONLY_TOOLS,
  'write_file',
  'append_file',
  'delete_file',
  'delete_files',
  'create_folder',
  'copy_image',
  'create_canvas',
  'create_wireframe',
  'apply_sync_recovery_advisor_plan',
  'apply_ai_operation',
]);

const AI_PRODUCER_TOOLS = new Set([
  ...AI_MEMBER_TOOLS,
  'bootstrap_team_workspace',
  'draft_narrative_tasks',
  'sync_team_task_docs',
  'upsert_team_tasks',
  'generate_team_production_docs',
]);

function normalizeAIControlMode(value: unknown): AIControlMode {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'readonly' || mode === 'member' || mode === 'producer') return mode;
  return 'readonly';
}

function aiControlModeLabel(mode: AIControlMode): string {
  if (mode === 'producer') return 'Producer takeover';
  if (mode === 'member') return 'Member execution';
  return 'Read-only analysis';
}

function isAIToolAllowedInMode(toolName: string, mode: AIControlMode): boolean {
  if (mode === 'producer') return AI_PRODUCER_TOOLS.has(toolName);
  if (mode === 'member') return AI_MEMBER_TOOLS.has(toolName);
  return AI_READONLY_TOOLS.has(toolName);
}

function normalizeAIConfirmToken(value: unknown): string {
  const raw = String(value || '').trim().toUpperCase();
  const match = raw.match(/\bAI-[A-Z0-9]{8}\b/);
  return match ? match[0] : '';
}

function extractAIConfirmedTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  const matches = String(text || '').match(AI_CONFIRM_TOKEN_RE) || [];
  for (const match of matches) {
    const token = normalizeAIConfirmToken(match);
    if (token) tokens.add(token);
  }
  return tokens;
}

function aiOpsDir(vaultPath: string): string {
  return path.join(path.resolve(vaultPath), ARS_NOTE_DIR, AI_OPS_DIR);
}

function aiPendingOpsDir(vaultPath: string): string {
  return path.join(aiOpsDir(vaultPath), 'pending');
}

function aiAuditOpsDir(vaultPath: string): string {
  return path.join(aiOpsDir(vaultPath), 'audit');
}

function aiPendingOperationPath(vaultPath: string, token: string): string {
  const cleanToken = normalizeAIConfirmToken(token);
  if (!cleanToken) throw new Error('Invalid AI operation token');
  const pendingDir = path.resolve(aiPendingOpsDir(vaultPath));
  const filePath = path.resolve(pendingDir, `${cleanToken}.json`);
  if (!isInsidePath(filePath, pendingDir)) throw new Error('Invalid AI operation path');
  return filePath;
}

function stableAIToolArgs(args: Record<string, string>): Record<string, string> {
  const copy: Record<string, string> = {};
  for (const key of Object.keys(args || {}).sort()) {
    if (key === 'confirm_token') continue;
    if (key === '__ai_apply_internal') continue;
    if (key === '__ai_direct_apply_internal') continue;
    if (key === '__ai_preview_internal') continue;
    if (key === 'preview_only') continue;
    copy[key] = String((args as any)[key] ?? '');
  }
  return copy;
}

function aiToolRequestHash(toolName: string, args: Record<string, string>): string {
  const body = JSON.stringify({ toolName, args: stableAIToolArgs(args) });
  return crypto.createHash('sha256').update(body).digest('hex');
}

function summarizeAIToolArgs(args: Record<string, string>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args || {})) {
    if (key === 'content' || key === 'tasks' || key === 'elements' || key === 'nodes' || key === 'edges') {
      const text = String(value || '');
      summary[key] = {
        chars: text.length,
        sha256: crypto.createHash('sha256').update(text).digest('hex'),
        preview: text.slice(0, 240),
      };
    } else if (
      key !== 'confirm_token'
      && key !== '__ai_apply_internal'
      && key !== '__ai_direct_apply_internal'
      && key !== '__ai_preview_internal'
      && key !== 'preview_only'
    ) {
      summary[key] = value;
    }
  }
  return summary;
}

function parseAIDeleteFilePaths(args: Record<string, string>, limit = 200): string[] {
  const raw = String((args as any).paths || (args as any).files || (args as any).path || '').trim();
  if (!raw) return [];

  let values: string[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      values = parsed.map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          return String((item as any).path || (item as any).relativePath || '');
        }
        return String(item || '');
      });
    }
  } catch { /* fall back to plain text list */ }

  if (values.length === 0) {
    values = raw.split(/\r?\n|,/).map((item) => item.trim());
  }

  const seen = new Set<string>();
  const paths: string[] = [];
  for (const value of values) {
    const relPath = normalizeVaultRelativePath(String(value || ''));
    if (!relPath || relPath === ARS_NOTE_DIR || relPath.startsWith(`${ARS_NOTE_DIR}/`)) continue;
    const key = relPath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(relPath);
    if (paths.length >= limit) break;
  }
  return paths;
}

function appendAIOperationAudit(vaultPath: string, event: string, data: Record<string, unknown>): void {
  try {
    const now = new Date();
    const dir = aiAuditOpsDir(vaultPath);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${now.toISOString().slice(0, 7)}.jsonl`);
    const record = {
      version: 1,
      event,
      at: now.toISOString(),
      ...data,
    };
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
  } catch { /* audit is best effort */ }
}

const AI_ROLLBACK_MAX_FILE_BYTES = 5 * 1024 * 1024;
const AI_ROLLBACK_MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const AI_ROLLBACK_MAX_FILES = 800;

function aiRollbackOpsDir(vaultPath: string): string {
  return path.join(aiOpsDir(vaultPath), 'rollback');
}

function aiRollbackOperationPath(vaultPath: string, token: string): string {
  const cleanToken = normalizeAIConfirmToken(token);
  if (!cleanToken) throw new Error('Invalid AI operation token');
  const rollbackDir = path.resolve(aiRollbackOpsDir(vaultPath));
  const filePath = path.resolve(rollbackDir, `${cleanToken}.json`);
  if (!isInsidePath(filePath, rollbackDir)) throw new Error('Invalid AI rollback path');
  return filePath;
}

function uniqueAIRollbackRoots(roots: AIRollbackRootCandidate[]): AIRollbackRootCandidate[] {
  const seen = new Set<string>();
  const result: AIRollbackRootCandidate[] = [];
  for (const root of roots) {
    const relativePath = normalizeVaultRelativePath(root.relativePath).replace(/\/+$/, '');
    if (!relativePath || relativePath.startsWith(`${ARS_NOTE_DIR}/`) || relativePath === ARS_NOTE_DIR) continue;
    const key = relativePath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      relativePath,
      includeMissingFile: !!root.includeMissingFile,
      cleanupIfCreated: !!root.cleanupIfCreated,
    });
  }
  return result;
}

function aiRollbackRootsForOperation(toolName: string, args: Record<string, string>): AIRollbackRootCandidate[] {
  const rawPath = String(args.path || '').trim();
  switch (toolName) {
    case 'write_file':
    case 'append_file':
    case 'delete_file':
    case 'create_canvas':
    case 'create_wireframe':
      return uniqueAIRollbackRoots([{ relativePath: rawPath, includeMissingFile: true }]);
    case 'delete_files':
      return uniqueAIRollbackRoots(parseAIDeleteFilePaths(args).map((relativePath) => ({
        relativePath,
        includeMissingFile: true,
      })));
    case 'create_folder':
      return uniqueAIRollbackRoots([{ relativePath: rawPath, cleanupIfCreated: true }]);
    case 'copy_image':
      return uniqueAIRollbackRoots([{ relativePath: String(args.dest_folder || 'assets'), cleanupIfCreated: true }]);
    case 'bootstrap_team_workspace':
    case 'sync_team_task_docs':
    case 'upsert_team_tasks':
    case 'generate_team_production_docs':
      return uniqueAIRollbackRoots([
        { relativePath: TEAM_SCHEDULE_DIR, cleanupIfCreated: true },
        { relativePath: '07_Unity_Tasks', cleanupIfCreated: true },
      ]);
    case 'draft_narrative_tasks':
      return parseAIToolBooleanArg((args as any).upsert, false)
        ? uniqueAIRollbackRoots([
          { relativePath: TEAM_SCHEDULE_DIR, cleanupIfCreated: true },
          { relativePath: '07_Unity_Tasks', cleanupIfCreated: true },
        ])
        : [];
    default:
      return [];
  }
}

function readAIAnyOperation(vaultPath: string, token: string): AIPendingOperationRecord | null {
  try {
    const record = readJsonSafe<AIPendingOperationRecord | null>(aiPendingOperationPath(vaultPath, token), null);
    if (!record || record.token !== normalizeAIConfirmToken(token)) return null;
    return record;
  } catch {
    return null;
  }
}

function snapshotAIRollbackRootState(vaultPath: string, root: AIRollbackRootCandidate): AIRollbackRootState {
  const relativePath = normalizeVaultRelativePath(root.relativePath).replace(/\/+$/, '');
  try {
    const fullPath = resolveVaultRelativePath(vaultPath, relativePath);
    if (!fs.existsSync(fullPath)) return { relativePath, exists: false, type: 'missing' };
    const stat = fs.statSync(fullPath);
    return {
      relativePath,
      exists: true,
      type: stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other',
    };
  } catch {
    return { relativePath, exists: false, type: 'missing' };
  }
}

function snapshotAIRollbackFile(
  vaultPath: string,
  relativePath: string,
  budget: { fileCount: number; totalBytes: number; warnings: string[] },
): AIRollbackFileSnapshot {
  const normalized = normalizeVaultRelativePath(relativePath);
  const fullPath = resolveVaultRelativePath(vaultPath, normalized);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    return { relativePath: normalized, exists: false };
  }

  budget.fileCount += 1;
  const stat = fs.statSync(fullPath);
  const base: AIRollbackFileSnapshot = {
    relativePath: normalized,
    exists: true,
    size: stat.size,
    sha256: fileSha256(fullPath),
  };

  if (budget.fileCount > AI_ROLLBACK_MAX_FILES) {
    base.skippedReason = 'file-count-limit';
    return base;
  }
  if (stat.size > AI_ROLLBACK_MAX_FILE_BYTES) {
    base.skippedReason = 'file-too-large';
    budget.warnings.push(`Rollback content skipped for ${normalized}: file is larger than ${AI_ROLLBACK_MAX_FILE_BYTES} bytes.`);
    return base;
  }
  if (budget.totalBytes + stat.size > AI_ROLLBACK_MAX_TOTAL_BYTES) {
    base.skippedReason = 'total-size-limit';
    budget.warnings.push(`Rollback content skipped for ${normalized}: rollback snapshot reached size limit.`);
    return base;
  }

  const content = fs.readFileSync(fullPath);
  budget.totalBytes += content.length;
  base.contentBase64 = content.toString('base64');
  return base;
}

function snapshotAIRollbackFiles(vaultPath: string, roots: AIRollbackRootCandidate[]): { rootStates: AIRollbackRootState[]; files: AIRollbackFileSnapshot[]; warnings: string[] } {
  const resolvedVault = path.resolve(vaultPath);
  const rootStates = roots.map(root => snapshotAIRollbackRootState(resolvedVault, root));
  const files = new Map<string, AIRollbackFileSnapshot>();
  const budget = { fileCount: 0, totalBytes: 0, warnings: [] as string[] };

  const addSnapshot = (snapshot: AIRollbackFileSnapshot) => {
    const key = snapshot.relativePath.toLowerCase();
    if (!files.has(key)) files.set(key, snapshot);
  };

  const walk = (dir: string): void => {
    if (budget.fileCount > AI_ROLLBACK_MAX_FILES) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (budget.fileCount > AI_ROLLBACK_MAX_FILES) return;
      if (entry.name === ARS_NOTE_DIR || entry.name === '.git' || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relPath = path.relative(resolvedVault, fullPath).replace(/\\/g, '/');
      if (!relPath || relPath.startsWith(`${ARS_NOTE_DIR}/`)) continue;
      addSnapshot(snapshotAIRollbackFile(resolvedVault, relPath, budget));
    }
  };

  for (const root of roots) {
    const relativePath = normalizeVaultRelativePath(root.relativePath).replace(/\/+$/, '');
    let fullPath = '';
    try { fullPath = resolveVaultRelativePath(resolvedVault, relativePath); } catch { continue; }
    if (!fs.existsSync(fullPath)) {
      if (root.includeMissingFile) addSnapshot({ relativePath, exists: false });
      continue;
    }
    const stat = fs.statSync(fullPath);
    if (stat.isFile()) {
      addSnapshot(snapshotAIRollbackFile(resolvedVault, relativePath, budget));
    } else if (stat.isDirectory()) {
      walk(fullPath);
    }
  }

  if (budget.fileCount > AI_ROLLBACK_MAX_FILES) {
    budget.warnings.push(`Rollback snapshot reached ${AI_ROLLBACK_MAX_FILES} files; extra files were not captured.`);
  }

  return {
    rootStates,
    files: Array.from(files.values()).sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    warnings: budget.warnings,
  };
}

function beginAIOperationRollbackSnapshot(vaultPath: string, record: AIPendingOperationRecord): AIRollbackSnapshotFile | null {
  const roots = aiRollbackRootsForOperation(record.toolName, record.args);
  if (!roots.length) return null;
  try {
    const before = snapshotAIRollbackFiles(vaultPath, roots);
    const snapshot: AIRollbackSnapshotFile = {
      version: 1,
      token: record.token,
      toolName: record.toolName,
      requestHash: record.requestHash,
      createdAt: new Date().toISOString(),
      status: 'captured',
      roots,
      beforeRoots: before.rootStates,
      before: before.files,
      warnings: before.warnings,
    };
    fs.mkdirSync(aiRollbackOpsDir(vaultPath), { recursive: true });
    writeJson(aiRollbackOperationPath(vaultPath, record.token), snapshot);
    return snapshot;
  } catch (err: any) {
    appendAIOperationAudit(vaultPath, 'rollback_capture_failed', {
      token: record.token,
      toolName: record.toolName,
      error: err?.message || 'Rollback capture failed',
    });
    return null;
  }
}

function finalizeAIOperationRollbackSnapshot(vaultPath: string, token: string): AIRollbackSnapshotFile | null {
  try {
    const filePath = aiRollbackOperationPath(vaultPath, token);
    const snapshot = readJsonSafe<AIRollbackSnapshotFile | null>(filePath, null);
    if (!snapshot || !Array.isArray(snapshot.roots)) return null;
    const after = snapshotAIRollbackFiles(vaultPath, snapshot.roots);
    const next: AIRollbackSnapshotFile = {
      ...snapshot,
      status: 'available',
      finalizedAt: new Date().toISOString(),
      afterRoots: after.rootStates,
      after: after.files,
      warnings: [...(snapshot.warnings || []), ...after.warnings],
    };
    writeJson(filePath, next);
    return next;
  } catch {
    return null;
  }
}

function readAIOperationRollbackSnapshot(vaultPath: string, token: string): AIRollbackSnapshotFile {
  const snapshot = readJsonSafe<AIRollbackSnapshotFile | null>(aiRollbackOperationPath(vaultPath, token), null);
  if (!snapshot) throw new Error(`AI rollback snapshot not found: ${normalizeAIConfirmToken(token)}`);
  return snapshot;
}

function currentAIRollbackFileState(vaultPath: string, relativePath: string): { exists: boolean; isFile: boolean; sha256?: string; size?: number } {
  const fullPath = resolveVaultRelativePath(vaultPath, relativePath);
  if (!fs.existsSync(fullPath)) return { exists: false, isFile: false };
  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) return { exists: true, isFile: false };
  return { exists: true, isFile: true, sha256: fileSha256(fullPath), size: stat.size };
}

function previewAIOperationRollback(vaultPath: string, token: string): any {
  const cleanToken = normalizeAIConfirmToken(token);
  if (!cleanToken) throw new Error('Invalid AI operation token');
  const record = readAIAnyOperation(vaultPath, cleanToken);
  const snapshot = readAIOperationRollbackSnapshot(vaultPath, cleanToken);
  const beforeByPath = new Map((snapshot.before || []).map(item => [item.relativePath.toLowerCase(), item]));
  const afterByPath = new Map((snapshot.after || []).map(item => [item.relativePath.toLowerCase(), item]));
  const allKeys = new Set<string>([...beforeByPath.keys(), ...afterByPath.keys()]);
  const items: any[] = [];
  const warnings = [...(snapshot.warnings || [])];

  for (const key of Array.from(allKeys).sort()) {
    const before = beforeByPath.get(key) || { relativePath: afterByPath.get(key)?.relativePath || key, exists: false };
    const after = afterByPath.get(key) || { relativePath: before.relativePath, exists: false };
    const relativePath = before.relativePath || after.relativePath;
    let action: 'restore' | 'delete_created' | 'skip' = 'skip';
    let skipReason = '';
    let current: any = null;
    try {
      current = currentAIRollbackFileState(vaultPath, relativePath);
      if (before.exists) {
        if (!before.contentBase64) {
          skipReason = before.skippedReason || 'missing-before-content';
        } else if (current.exists && !current.isFile) {
          skipReason = 'current-path-is-not-file';
        } else if (current.exists && current.sha256 === before.sha256) {
          skipReason = 'already-restored';
        } else if (current.exists && after.exists && after.sha256 && current.sha256 !== after.sha256) {
          skipReason = 'changed-after-ai';
        } else {
          action = 'restore';
        }
      } else if (after.exists) {
        if (!current.exists) {
          skipReason = 'already-removed';
        } else if (!current.isFile) {
          skipReason = 'current-path-is-not-file';
        } else if (after.sha256 && current.sha256 !== after.sha256) {
          skipReason = 'changed-after-ai';
        } else {
          action = 'delete_created';
        }
      } else {
        skipReason = 'no-file-change';
      }
    } catch (err: any) {
      skipReason = err?.message || 'inspect-failed';
    }

    items.push({
      relativePath,
      action,
      skipReason,
      before: {
        exists: before.exists,
        sha256: before.sha256,
        size: before.size,
        hasContent: !!before.contentBase64,
      },
      after: {
        exists: after.exists,
        sha256: after.sha256,
        size: after.size,
      },
      current,
    });
  }

  for (const root of snapshot.roots || []) {
    if (!root.cleanupIfCreated) continue;
    const beforeRoot = (snapshot.beforeRoots || []).find(item => item.relativePath === root.relativePath);
    const afterRoot = (snapshot.afterRoots || []).find(item => item.relativePath === root.relativePath);
    if (beforeRoot?.exists || afterRoot?.type !== 'directory') continue;
    try {
      const fullPath = resolveVaultRelativePath(vaultPath, root.relativePath);
      const canRemove = fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory() && fs.readdirSync(fullPath).length === 0;
      items.push({
        relativePath: root.relativePath,
        action: canRemove ? 'remove_directory' : 'skip',
        skipReason: canRemove ? '' : 'directory-not-empty-or-missing',
        directory: true,
      });
    } catch (err: any) {
      items.push({
        relativePath: root.relativePath,
        action: 'skip',
        skipReason: err?.message || 'inspect-directory-failed',
        directory: true,
      });
    }
  }

  const restorableCount = items.filter(item => item.action === 'restore' || item.action === 'delete_created' || item.action === 'remove_directory').length;
  const skippedCount = items.length - restorableCount;
  return {
    ok: true,
    token: cleanToken,
    toolName: snapshot.toolName,
    requestHash: snapshot.requestHash,
    operationStatus: record?.status || 'unknown',
    rollbackStatus: snapshot.status,
    createdAt: snapshot.createdAt,
    finalizedAt: snapshot.finalizedAt || '',
    restorableCount,
    skippedCount,
    warnings,
    items,
  };
}

function rollbackAIOperation(vaultPath: string, token: string): any {
  const cleanToken = normalizeAIConfirmToken(token);
  if (!cleanToken) throw new Error('Invalid AI operation token');
  const snapshot = readAIOperationRollbackSnapshot(vaultPath, cleanToken);
  if (snapshot.status === 'rolled_back') {
    return {
      ok: true,
      token: cleanToken,
      restoredCount: 0,
      deletedCount: 0,
      removedDirectoryCount: 0,
      skippedCount: 0,
      failedCount: 0,
      message: 'AI operation has already been rolled back.',
      plan: previewAIOperationRollback(vaultPath, cleanToken),
    };
  }

  const plan = previewAIOperationRollback(vaultPath, cleanToken);
  const beforeByPath = new Map((snapshot.before || []).map(item => [item.relativePath.toLowerCase(), item]));
  const afterByPath = new Map((snapshot.after || []).map(item => [item.relativePath.toLowerCase(), item]));
  const restored: string[] = [];
  const deleted: string[] = [];
  const removedDirectories: string[] = [];
  const skipped: Array<{ relativePath: string; reason: string }> = [];
  const failed: Array<{ relativePath: string; error: string }> = [];

  for (const item of plan.items || []) {
    if (item.action === 'skip') {
      skipped.push({ relativePath: item.relativePath, reason: item.skipReason || 'skipped' });
      continue;
    }

    try {
      const relativePath = normalizeVaultRelativePath(item.relativePath);
      const targetPath = resolveVaultRelativePath(vaultPath, relativePath);
      if (item.action === 'restore') {
        const before = beforeByPath.get(relativePath.toLowerCase());
        const after = afterByPath.get(relativePath.toLowerCase());
        if (!before?.contentBase64) throw new Error('Missing rollback content');
        const current = currentAIRollbackFileState(vaultPath, relativePath);
        if (current.exists && after?.exists && after.sha256 && current.sha256 !== after.sha256) {
          skipped.push({ relativePath, reason: 'changed-after-ai' });
          continue;
        }
        const buffer = Buffer.from(before.contentBase64, 'base64');
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        saveLiveHistoryBeforeOverwrite(targetPath, buffer, 'before-ai-operation-rollback');
        fs.writeFileSync(targetPath, buffer);
        restored.push(relativePath);
      } else if (item.action === 'delete_created') {
        const after = afterByPath.get(relativePath.toLowerCase());
        const current = currentAIRollbackFileState(vaultPath, relativePath);
        if (!current.exists) {
          skipped.push({ relativePath, reason: 'already-removed' });
          continue;
        }
        if (!current.isFile) {
          skipped.push({ relativePath, reason: 'current-path-is-not-file' });
          continue;
        }
        if (after?.sha256 && current.sha256 !== after.sha256) {
          skipped.push({ relativePath, reason: 'changed-after-ai' });
          continue;
        }
        saveLiveHistoryBeforeOverwrite(targetPath, undefined, 'ai-operation-rollback-delete-created');
        fs.unlinkSync(targetPath);
        cleanupEmptyDirectoryChain(path.dirname(targetPath), path.resolve(vaultPath));
        deleted.push(relativePath);
      } else if (item.action === 'remove_directory') {
        if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory() && fs.readdirSync(targetPath).length === 0) {
          fs.rmdirSync(targetPath);
          removedDirectories.push(relativePath);
        } else {
          skipped.push({ relativePath, reason: 'directory-not-empty-or-missing' });
        }
      }
    } catch (err: any) {
      failed.push({ relativePath: item.relativePath, error: err?.message || 'rollback failed' });
    }
  }

  const next: AIRollbackSnapshotFile = {
    ...snapshot,
    status: failed.length > 0 ? 'partial' : 'rolled_back',
    rolledBackAt: new Date().toISOString(),
  };
  writeJson(aiRollbackOperationPath(vaultPath, cleanToken), next);
  appendAIOperationAudit(vaultPath, failed.length > 0 ? 'rollback_partial' : 'rollback_applied', {
    token: cleanToken,
    toolName: snapshot.toolName,
    restoredCount: restored.length,
    deletedCount: deleted.length,
    removedDirectoryCount: removedDirectories.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
  });

  return {
    ok: failed.length === 0,
    token: cleanToken,
    restoredCount: restored.length,
    deletedCount: deleted.length,
    removedDirectoryCount: removedDirectories.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    restored,
    deleted,
    removedDirectories,
    skipped,
    failed,
    plan,
  };
}

function readAIPendingOperation(vaultPath: string, token: string): AIPendingOperationRecord | null {
  try {
    const record = readJsonSafe<AIPendingOperationRecord | null>(aiPendingOperationPath(vaultPath, token), null);
    if (!record || record.status !== 'pending') return null;
    if (record.token !== normalizeAIConfirmToken(token)) return null;
    if (Date.parse(record.expiresAt || '') <= Date.now()) return null;
    return record;
  } catch {
    return null;
  }
}

function findExistingAIPendingOperation(vaultPath: string, requestHash: string): AIPendingOperationRecord | null {
  const dir = aiPendingOpsDir(vaultPath);
  if (!fs.existsSync(dir)) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const record = readJsonSafe<AIPendingOperationRecord | null>(path.join(dir, entry.name), null);
      if (!record || record.status !== 'pending') continue;
      if (record.requestHash !== requestHash) continue;
      if (Date.parse(record.expiresAt || '') <= Date.now()) continue;
      return record;
    }
  } catch { /* ignore unreadable pending dir */ }
  return null;
}

function makeAIConfirmToken(): string {
  return `AI-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function aiToolRequiresConfirmation(toolName: string, args: Record<string, string>): boolean {
  if (toolName === 'draft_narrative_tasks') {
    return parseAIToolBooleanArg((args as any).upsert, false);
  }
  return AI_MUTATING_TOOLS.has(toolName);
}

function aiToolPreviewConfirmationRequested(args: Record<string, string>): boolean {
  return (args as any).__ai_preview_internal === '1'
    || parseAIToolBooleanArg((args as any).preview_only, false);
}

const AI_MUTATION_PREVIEW_HASH_LIMIT_BYTES = 20 * 1024 * 1024;
const AI_MUTATION_PREVIEW_TEXT_LIMIT_BYTES = 2 * 1024 * 1024;

function formatAIByteSize(bytes: number): string {
  const safeBytes = Math.max(0, Number.isFinite(bytes) ? Math.floor(bytes) : 0);
  if (safeBytes < 1024) return `${safeBytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = safeBytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function countAITextLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r\n|\r|\n/).length;
}

function sha256Text(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function summarizeAITextSample(text: string, limit = 500): string {
  const clean = String(text || '').replace(/\r/g, '');
  if (!clean) return '(empty)';
  return clean.length > limit ? `${clean.slice(0, limit)}...` : clean;
}

function inspectAIPathForPreview(fullPath: string): {
  exists: boolean;
  kind: 'missing' | 'file' | 'directory' | 'other';
  size?: number;
  sha256?: string;
  hashSkipped?: boolean;
  modifiedAt?: string;
  lineCount?: number;
  error?: string;
} {
  try {
    if (!fs.existsSync(fullPath)) return { exists: false, kind: 'missing' };
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      return { exists: true, kind: 'directory', modifiedAt: stat.mtime.toISOString() };
    }
    if (!stat.isFile()) {
      return { exists: true, kind: 'other', size: stat.size, modifiedAt: stat.mtime.toISOString() };
    }
    const state: ReturnType<typeof inspectAIPathForPreview> = {
      exists: true,
      kind: 'file',
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    };
    if (stat.size <= AI_MUTATION_PREVIEW_HASH_LIMIT_BYTES) {
      const data = fs.readFileSync(fullPath);
      state.sha256 = crypto.createHash('sha256').update(data).digest('hex');
      if (stat.size <= AI_MUTATION_PREVIEW_TEXT_LIMIT_BYTES) {
        state.lineCount = countAITextLines(data.toString('utf-8'));
      }
    } else {
      state.hashSkipped = true;
    }
    return state;
  } catch (err: any) {
    return { exists: false, kind: 'missing', error: err?.message || 'Unable to inspect path' };
  }
}

function describeAIPathState(label: string, state: ReturnType<typeof inspectAIPathForPreview>): string[] {
  if (state.error) return [`${label}: unable to inspect (${state.error}).`];
  if (!state.exists || state.kind === 'missing') return [`${label}: missing/new.`];
  if (state.kind === 'directory') return [`${label}: directory, modified ${state.modifiedAt || '-'}.`];
  if (state.kind !== 'file') return [`${label}: ${state.kind}, ${formatAIByteSize(state.size || 0)}, modified ${state.modifiedAt || '-'}.`];
  const details = [
    'file',
    formatAIByteSize(state.size || 0),
    typeof state.lineCount === 'number' ? `${state.lineCount} lines` : '',
    `modified ${state.modifiedAt || '-'}`,
  ].filter(Boolean).join(', ');
  const lines = [`${label}: ${details}.`];
  if (state.sha256) lines.push(`${label} SHA256: ${state.sha256}`);
  if (state.hashSkipped) lines.push(`${label} SHA256: skipped because file is larger than ${formatAIByteSize(AI_MUTATION_PREVIEW_HASH_LIMIT_BYTES)}.`);
  return lines;
}

function teamProductionDocOptionsFromAIArgs(args: Record<string, string>): {
  includeDashboard?: boolean;
  includeObsidianCommandCenter?: boolean;
  includeProductionHealth?: boolean;
  includeDependencyMap?: boolean;
  includeHandoff?: boolean;
  includeAiMemoryIndex?: boolean;
  includeLinkHealth?: boolean;
  includeBlockerHandoff?: boolean;
  includeReviewQueue?: boolean;
  includeWorkpack?: boolean;
  includeDailyStandup?: boolean;
  includeTimesheet?: boolean;
  includeRoadmap?: boolean;
  includeDecisionLog?: boolean;
  includeChangeImpact?: boolean;
  includeNarrativeDirector?: boolean;
  includeSprintPlan?: boolean;
  includeMemberPages?: boolean;
  includeTaskDocs?: boolean;
  includeTakeoverPlan?: boolean;
} {
  return {
    includeHandoff: parseAIToolBooleanArg((args as any).include_handoff, true),
    includeAiMemoryIndex: parseAIToolBooleanArg((args as any).include_ai_memory_index, true),
    includeLinkHealth: parseAIToolBooleanArg((args as any).include_link_health, true),
    includeDependencyMap: parseAIToolBooleanArg((args as any).include_dependency_map, true),
    includeBlockerHandoff: parseAIToolBooleanArg((args as any).include_blocker_handoff, true),
    includeReviewQueue: parseAIToolBooleanArg((args as any).include_review_queue, true),
    includeWorkpack: parseAIToolBooleanArg((args as any).include_workpack, true),
    includeDailyStandup: parseAIToolBooleanArg((args as any).include_daily_standup, true),
    includeTimesheet: parseAIToolBooleanArg((args as any).include_timesheet, true),
    includeRoadmap: parseAIToolBooleanArg((args as any).include_roadmap, true),
    includeDecisionLog: parseAIToolBooleanArg((args as any).include_decision_log, true),
    includeChangeImpact: parseAIToolBooleanArg((args as any).include_change_impact, true),
    includeNarrativeDirector: parseAIToolBooleanArg((args as any).include_narrative_director, true),
    includeTakeoverPlan: parseAIToolBooleanArg((args as any).include_takeover_plan, true),
    includeSprintPlan: parseAIToolBooleanArg((args as any).include_sprint_plan, true),
    includeMemberPages: parseAIToolBooleanArg((args as any).include_member_pages, true),
    includeTaskDocs: parseAIToolBooleanArg((args as any).include_task_docs, true),
    includeObsidianCommandCenter: parseAIToolBooleanArg((args as any).include_obsidian_command_center, true),
    includeProductionHealth: parseAIToolBooleanArg((args as any).include_production_health, true),
    includeDashboard: parseAIToolBooleanArg((args as any).include_dashboard, true),
  };
}

function buildTeamProductionDocPreviewLines(vaultPath: string, args: Record<string, string>): string[] {
  const options = teamProductionDocOptionsFromAIArgs(args);
  const date = teamTodayString();
  const dateKey = date.replace(/-/g, '');
  const schedule = readTeamScheduleData(vaultPath);
  const stats = summarizeTeamSchedule(schedule);
  const members = teamScheduleMembers(schedule);
  const tasks = Array.isArray(schedule.tasks) ? schedule.tasks : [];
  const paths: string[] = [];
  const add = (enabled: unknown, relPath: string) => {
    if (enabled !== false) paths.push(relPath);
  };

  add(options.includeHandoff, `${TEAM_SCHEDULE_DIR}/ai-handoff.md`);
  add(options.includeAiMemoryIndex, `${TEAM_SCHEDULE_DIR}/${teamAiMemoryIndexFileName()}`);
  add(options.includeLinkHealth, `${TEAM_SCHEDULE_DIR}/${teamLinkHealthFileName()}`);
  add(options.includeProductionHealth, `${TEAM_SCHEDULE_DIR}/${teamProductionHealthFileName()}`);
  add(options.includeDependencyMap, `${TEAM_SCHEDULE_DIR}/dependency-map.md`);
  add(options.includeBlockerHandoff, `${TEAM_SCHEDULE_DIR}/handoffs/blocker-handoff-${dateKey}.md`);
  add(options.includeReviewQueue, `${TEAM_SCHEDULE_DIR}/reviews/review-queue-${dateKey}.md`);
  add(options.includeWorkpack, `${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${dateKey}.md`);
  add(options.includeDailyStandup, `${TEAM_SCHEDULE_DIR}/reports/daily-standup-${dateKey}.md`);
  add(options.includeTimesheet, `${TEAM_SCHEDULE_DIR}/timesheets/timesheet-${dateKey}.md`);
  add(options.includeRoadmap, `${TEAM_SCHEDULE_DIR}/roadmaps/${teamMilestoneRoadmapFileName(date)}`);
  add(options.includeDecisionLog, `${TEAM_SCHEDULE_DIR}/decisions/${teamDecisionLogFileName(date)}`);
  add(options.includeChangeImpact, `${TEAM_SCHEDULE_DIR}/changes/${teamChangeImpactFileName(date)}`);
  add(options.includeNarrativeDirector, `${TEAM_SCHEDULE_DIR}/narrative-director.md`);
  add(options.includeTakeoverPlan, `${TEAM_SCHEDULE_DIR}/plans/${teamAITakeoverPlanFileName(date)}`);
  add(options.includeSprintPlan, `${TEAM_SCHEDULE_DIR}/sprints/${teamSprintPlanFileName(date)}`);
  if (options.includeMemberPages !== false) {
    for (const member of members) {
      paths.push(`${TEAM_SCHEDULE_DIR}/members/${safeTeamMemberFileName(member)}.md`);
    }
  }
  add(options.includeObsidianCommandCenter, `${TEAM_SCHEDULE_DIR}/${teamObsidianCommandCenterFileName()}`);
  add(options.includeDashboard, `${TEAM_SCHEDULE_DIR}/team-dashboard.md`);

  const linkedDocs: string[] = Array.from(new Set<string>(tasks
    .map((task: any) => normalizeTeamSchedulePath(task?.linkedDoc))
    .filter((relPath: string): relPath is string => !!relPath)));
  const existingLinkedDocs = linkedDocs.filter((relPath) => {
    try {
      return fs.existsSync(resolveVaultRelativePath(vaultPath, relPath));
    } catch {
      return false;
    }
  }).length;
  if (options.includeTaskDocs !== false) {
    paths.push(...linkedDocs.slice(0, 20));
  }

  const uniquePaths = Array.from(new Set(paths));
  const lines = [
    `Will refresh ${uniquePaths.length} named team production file(s) for ${date}.`,
    `Schedule state: ${tasks.length} task(s), ${members.length} member(s), active=${stats.active || 0}, blocked=${stats.blocked || 0}, overdue=${stats.overdue || 0}, missingDocs=${stats.missingDocs || 0}, qaOpen=${stats.qaOpen || 0}.`,
  ];
  if (options.includeTaskDocs !== false) {
    lines.push(`Task docs: will inspect/create/update work docs for scheduled tasks; currently ${existingLinkedDocs}/${linkedDocs.length} linked doc(s) already exist.`);
  }
  if (uniquePaths.length > 0) {
    lines.push('Expected writes:');
    for (const relPath of uniquePaths.slice(0, 32)) lines.push(`- ${relPath}`);
    if (uniquePaths.length > 32) lines.push(`- ... ${uniquePaths.length - 32} more file(s).`);
  }
  return lines;
}

function syncRecoveryAdvisorOptionsFromAIArgs(args: Record<string, string>): any {
  const sinceHoursRaw = Number((args as any).since_hours ?? (args as any).sinceHours ?? 720);
  const limitRaw = Number((args as any).limit ?? (args as any).apply_limit ?? (args as any).applyLimit ?? 80);
  return {
    sinceHours: Math.max(1, Math.min(720, Number.isFinite(sinceHoursRaw) ? Math.floor(sinceHoursRaw) : 720)),
    includeAllReasons: parseAIToolBooleanArg((args as any).include_all_reasons ?? (args as any).includeAllReasons, true),
    includeMedium: parseAIToolBooleanArg((args as any).include_medium ?? (args as any).includeMedium, false),
    applyLimit: Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 80)),
    limit: Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 80)),
  };
}

function summarizeSyncRecoveryAdvisorForAI(plan: any, maxItems = 30): any {
  const items = Array.isArray(plan?.items) ? plan.items : [];
  return {
    ok: true,
    checkedAt: plan?.checkedAt || '',
    riskLevel: plan?.riskLevel || 'ok',
    sinceHours: plan?.sinceHours || 0,
    summary: plan?.summary || {},
    serverError: plan?.serverError || '',
    warnings: Array.isArray(plan?.warnings) ? plan.warnings.slice(0, 12) : [],
    recommendations: items.slice(0, maxItems).map((item: any) => ({
      relativePath: item.relativePath,
      recommendedAction: item.recommendedAction,
      recommendedLabel: item.recommendedLabel,
      confidence: item.confidence,
      canApply: !!item.canApply,
      reason: item.reason,
      candidates: Array.isArray(item.candidates)
        ? item.candidates.slice(0, 5).map((candidate: any) => ({
          source: candidate.source,
          sourceRole: candidate.sourceRole,
          label: candidate.label,
          revisionId: candidate.revisionId || candidate.versionId || '',
          serverRevision: candidate.serverRevision || '',
          deviceName: candidate.deviceName || '',
          clientId: candidate.clientId || '',
          savedAt: candidate.savedAt || candidate.modifiedAt || candidate.updatedAt || '',
          sha256: candidate.sha256 || '',
          size: candidate.size || 0,
          deletedSnapshot: !!candidate.deletedSnapshot,
          recoveryRelativePath: candidate.recoveryRelativePath || '',
        }))
        : [],
    })),
  };
}

function buildSyncRecoveryAdvisorApplyPreviewLines(vaultPath: string, args: Record<string, string>): string[] {
  const options = syncRecoveryAdvisorOptionsFromAIArgs(args);
  const lines: string[] = [];
  try {
    const overview = syncRecoveryOverview(vaultPath);
    lines.push(`Mode: ${options.includeMedium ? 'high-and-medium-confidence' : 'high-confidence-only'}; lookback=${options.sinceHours}h; limit=${options.applyLimit}.`);
    lines.push(`Local recovery overview: conflict=${overview.conflict?.count || 0}, protectedLocal=${overview.protectedLocal?.count || 0}, deleteSnapshots=${overview.history?.deletedCount || 0}, overwriteHistory=${overview.history?.overwriteCount || 0}, aiTrash=${overview.aiTrash?.count || 0}.`);
    const examples = [
      ...(overview.conflict?.files || []).map((file: any) => file.relativePath),
      ...(overview.protectedLocal?.files || []).map((file: any) => file.originalRelativePath || file.relativePath),
      ...(overview.history?.deletedRecent || []).map((file: any) => file.relativePath),
    ].filter(Boolean).slice(0, 16);
    if (examples.length > 0) {
      lines.push('Example files the advisor will inspect:');
      for (const relPath of examples) lines.push(`- ${relPath}`);
    }
    if (Array.isArray(overview.recommendedActions) && overview.recommendedActions.length > 0) {
      lines.push('Current recovery-center notes:');
      for (const action of overview.recommendedActions.slice(0, 6)) lines.push(`- ${action}`);
    }
  } catch (err: any) {
    lines.push(`Recovery advisor preview failed: ${err?.message || String(err)}`);
  }
  lines.push('When applied, Ars-note will build the full Sync Recovery Advisor plan, including server history if available, then apply only eligible recommendations.');
  lines.push('Safety: applying never deletes server files, never bypasses Safe Delete Queue, and writes a recovery report. Restores/overwrites save live-history first.');
  return lines;
}

function addAITaskListPreviewLines(lines: string[], tasks: any[], maxItems = 8): void {
  for (const task of tasks.slice(0, maxItems)) {
    const title = normalizeTeamScheduleText(task?.title || task?.text || 'Untitled task');
    const owner = normalizeTeamScheduleText(task?.owner || task?.assignee || '');
    const priority = normalizeTeamTaskPriority(task?.priority);
    const status = normalizeTeamTaskStatus(task?.status);
    const linkedDoc = normalizeTeamSchedulePath(task?.linkedDoc || task?.doc || '');
    lines.push(`- ${title}${owner ? ` -> ${owner}` : ' -> auto-balanced'} [${priority}/${status}]${linkedDoc ? ` doc=${linkedDoc}` : ''}`);
  }
  if (tasks.length > maxItems) lines.push(`- ... ${tasks.length - maxItems} more task(s).`);
}

function buildAIToolMutationPreview(vaultPath: string, toolName: string, args: Record<string, string>): string {
  const lines: string[] = [];
  const rawPath = String(args.path || args.dest_folder || '');
  lines.push(`Tool: ${toolName}`);

  if (rawPath) {
    try {
      const relPath = normalizeVaultRelativePath(rawPath);
      const fullPath = resolveVaultRelativePath(vaultPath, rawPath, { allowRoot: toolName === 'list_files' });
      lines.push(`Path: ${relPath || '/'}`);
      lines.push(...describeAIPathState('Current target', inspectAIPathForPreview(fullPath)));
    } catch (err: any) {
      lines.push(`Path check: ${err.message}`);
    }
  }

  if (toolName === 'write_file') {
    const content = String(args.content || '');
    const newBytes = Buffer.byteLength(content, 'utf-8');
    const newSha = sha256Text(content);
    lines.push(`Will write/overwrite ${formatAIByteSize(newBytes)} (${content.length} chars, ${countAITextLines(content)} lines).`);
    lines.push(`New content SHA256: ${newSha}`);
    try {
      const fullPath = resolveVaultRelativePath(vaultPath, rawPath);
      const current = inspectAIPathForPreview(fullPath);
      if (current.kind === 'file' && typeof current.size === 'number') {
        const shrinkRatio = current.size > 0 ? newBytes / current.size : 1;
        if (current.sha256 && current.sha256 === newSha) lines.push('Change check: new content is identical to the current file.');
        if (current.size >= 1024 && shrinkRatio < 0.25) lines.push(`Risk warning: this write is a large shrink (${formatAIByteSize(current.size)} -> ${formatAIByteSize(newBytes)}).`);
        if (newBytes === 0) lines.push('Risk warning: this would write an empty file.');
      }
    } catch { /* path errors already reported above */ }
    lines.push('Safety: applying will save live-history before overwrite and create an AI rollback snapshot.');
    lines.push(`Preview: ${summarizeAITextSample(content)}`);
  } else if (toolName === 'append_file') {
    const content = String(args.content || '');
    const appendBytes = Buffer.byteLength(content, 'utf-8');
    lines.push(`Will append ${formatAIByteSize(appendBytes)} (${content.length} chars, ${countAITextLines(content)} lines).`);
    try {
      const fullPath = resolveVaultRelativePath(vaultPath, rawPath);
      const current = inspectAIPathForPreview(fullPath);
      if (current.kind === 'file') {
        lines.push(`Projected size after append: ${formatAIByteSize((current.size || 0) + appendBytes)}.`);
      }
    } catch { /* path errors already reported above */ }
    lines.push('Safety: applying will save live-history before append and create an AI rollback snapshot.');
    lines.push(`Append preview: ${summarizeAITextSample(content)}`);
  } else if (toolName === 'delete_file') {
    const relPath = normalizeVaultRelativePath(rawPath);
    lines.push(`Protected path check: ${isProtectedAIFileDeletePath(relPath) ? 'blocked' : 'allowed file path'}.`);
    lines.push('Will delete one local file only after saving live-history, an .ars-note/ai-trash recovery copy, and an AI rollback snapshot.');
    lines.push('Live Sync: after confirmation, this AI-origin delete is published as a normal server delete record.');
  } else if (toolName === 'delete_files') {
    const paths = parseAIDeleteFilePaths(args);
    lines.push(`Will safely delete ${paths.length} local file(s) after confirmation.`);
    if (paths.length === 0) {
      lines.push('No valid file paths were provided.');
    }
    let deletableCount = 0;
    let missingCount = 0;
    let protectedCount = 0;
    let notFileCount = 0;
    let inspectFailedCount = 0;
    for (const relPath of paths.slice(0, 40)) {
      try {
        if (isProtectedAIFileDeletePath(relPath)) {
          protectedCount += 1;
          lines.push(`- BLOCKED ${relPath}: protected internal path`);
          continue;
        }
        const fullPath = resolveVaultRelativePath(vaultPath, relPath);
        if (!fs.existsSync(fullPath)) {
          missingCount += 1;
          lines.push(`- SKIP ${relPath}: missing`);
          continue;
        }
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) {
          notFileCount += 1;
          lines.push(`- SKIP ${relPath}: not a file`);
          continue;
        }
        deletableCount += 1;
        lines.push(`- DELETE ${relPath}: ${formatAIByteSize(stat.size)}, modified ${stat.mtime.toISOString()}`);
      } catch (err: any) {
        inspectFailedCount += 1;
        lines.push(`- SKIP ${relPath}: ${err?.message || 'inspect failed'}`);
      }
    }
    if (paths.length > 40) lines.push(`- ... ${paths.length - 40} more path(s) hidden from preview.`);
    lines.push(`Summary: delete=${deletableCount}, missing=${missingCount}, protected=${protectedCount}, notFile=${notFileCount}, inspectFailed=${inspectFailedCount}.`);
    lines.push('Safety: each deleted file saves live-history, an .ars-note/ai-trash recovery copy, and an AI rollback snapshot.');
    lines.push('Live Sync: after confirmation, deleted files publish normal server delete records so other computers follow the deletion.');
  } else if (toolName === 'upsert_team_tasks') {
    let count = 0;
    let parsedTasks: any[] = [];
    let previewLines: string[] = [];
    try {
      const parsed = JSON.parse(String(args.tasks || '[]'));
      count = Array.isArray(parsed) ? parsed.length : 0;
      if (Array.isArray(parsed)) {
        parsedTasks = parsed;
        const schedule = readTeamScheduleData(vaultPath);
        const assignment = balanceTeamTaskAssignmentsForAI(vaultPath, schedule, parsed);
        previewLines = summarizeTeamAssignmentReview(assignment.review);
      }
    } catch { /* keep count 0 */ }
    lines.push(`Will create/update ${count} team schedule task(s).`);
    addAITaskListPreviewLines(lines, parsedTasks);
    lines.push(...previewLines);
  } else if (toolName === 'draft_narrative_tasks') {
    const willUpsert = parseAIToolBooleanArg((args as any).upsert, false);
    if (willUpsert) {
      const limit = Math.max(1, Math.min(80, Number(args.limit || 24) || 24));
      const includeQa = parseAIToolBooleanArg((args as any).include_qa, true);
      const draft = buildNarrativeTakeoverTaskDrafts(vaultPath, { limit, includeQa });
      const assignment = balanceTeamTaskAssignmentsForAI(vaultPath, readTeamScheduleData(vaultPath), draft.tasks);
      lines.push(`Will draft ${draft.tasks.length} narrative task(s) and upsert them into .ars-team/schedule.json.`);
      addAITaskListPreviewLines(lines, draft.tasks);
      lines.push(...summarizeTeamAssignmentReview(assignment.review));
    } else {
      lines.push('Will draft narrative tasks without writing .ars-team/schedule.json.');
    }
  } else if (toolName === 'generate_team_production_docs') {
    lines.push(...buildTeamProductionDocPreviewLines(vaultPath, args));
  } else if (toolName === 'apply_sync_recovery_advisor_plan') {
    lines.push(...buildSyncRecoveryAdvisorApplyPreviewLines(vaultPath, args));
  } else if (toolName === 'bootstrap_team_workspace') {
    const limit = Math.max(8, Math.min(80, Number(args.limit || 48) || 48));
    const currentMember = normalizeTeamScheduleText((args as any).current_member);
    const draft = buildNarrativeTakeoverTaskDrafts(vaultPath, { limit, includeQa: true });
    lines.push(`Will initialize or repair .ars-team schedule, task docs, and production command documents.`);
    lines.push(`Bootstrap scope: currentMember=${currentMember || '(not set)'}, narrative/task candidates=${draft.tasks.length}, limit=${limit}.`);
    lines.push(...buildTeamProductionDocPreviewLines(vaultPath, {}));
  } else if (toolName === 'sync_team_task_docs') {
    const schedule = readTeamScheduleData(vaultPath);
    const tasks = Array.isArray(schedule.tasks) ? schedule.tasks : [];
    const linkedDocs: string[] = Array.from(new Set<string>(tasks
      .map((task: any) => normalizeTeamSchedulePath(task?.linkedDoc))
      .filter((relPath: string): relPath is string => !!relPath)));
    const existingCount = linkedDocs.filter((relPath) => {
      try { return fs.existsSync(resolveVaultRelativePath(vaultPath, relPath)); } catch { return false; }
    }).length;
    lines.push(`Will read ${linkedDocs.length} linked task doc(s), ${existingCount} currently present, and write inferred logs/status/reviews back to .ars-team/schedule.json.`);
    for (const relPath of linkedDocs.slice(0, 12)) lines.push(`- ${relPath}`);
    if (linkedDocs.length > 12) lines.push(`- ... ${linkedDocs.length - 12} more linked doc(s).`);
  } else if (toolName === 'create_canvas' || toolName === 'create_wireframe') {
    if (toolName === 'create_canvas') {
      try {
        const nodes = JSON.parse(String(args.nodes || '[]'));
        const edges = JSON.parse(String(args.edges || '[]'));
        const canvas = normalizeAICanvasData({ nodes: Array.isArray(nodes) ? nodes : [], edges: Array.isArray(edges) ? edges : [] });
        const nextContent = JSON.stringify(canvas, null, 2);
        lines.push(`Will create/update a canvas with ${canvas.nodes.length} card(s), ${canvas.edges.length} connection(s).`);
        lines.push(`Output SHA256: ${sha256Text(nextContent)}`);
      } catch (err: any) {
        lines.push(`Canvas payload check: ${err?.message || 'invalid JSON'}`);
      }
    } else {
      try {
        const elements = JSON.parse(String(args.elements || '[]'));
        const scene = buildExcalidrawScene(Array.isArray(elements) ? elements : []);
        const nextContent = JSON.stringify(scene);
        lines.push(`Will create/update a wireframe with ${(scene as any).elements?.length || 0} element(s).`);
        lines.push(`Output SHA256: ${sha256Text(nextContent)}`);
      } catch (err: any) {
        lines.push(`Wireframe payload check: ${err?.message || 'invalid JSON'}`);
      }
    }
    lines.push('Safety: applying will save live-history and create/update a companion brief when applicable.');
  } else if (toolName === 'copy_image') {
    try {
      let srcPath = '';
      if (path.isAbsolute(args.source || '')) {
        srcPath = args.source;
      } else {
        srcPath = resolveVaultRelativePath(vaultPath, args.source || '');
      }
      const sourceState = inspectAIPathForPreview(srcPath);
      lines.push(`Source: ${srcPath}`);
      lines.push(...describeAIPathState('Source image', sourceState));
      const ext = path.extname(srcPath).toLowerCase();
      const destFolder = normalizeVaultRelativePath(args.dest_folder || 'assets');
      const destDir = resolveVaultRelativePath(vaultPath, destFolder);
      const fileName = path.basename(srcPath);
      let finalName = fileName;
      let finalPath = path.join(destDir, finalName);
      let counter = 1;
      while (fs.existsSync(finalPath) && finalPath !== srcPath) {
        finalName = `${path.parse(fileName).name}_${counter}${ext}`;
        finalPath = path.join(destDir, finalName);
        counter += 1;
      }
      lines.push(`Destination folder: ${destFolder} (${fs.existsSync(destDir) ? 'exists' : 'will be created'}).`);
      lines.push(`Final image path: ${destFolder}/${finalName}${finalName !== fileName ? ' (renamed to avoid overwrite)' : ''}.`);
    } catch (err: any) {
      lines.push(`Image copy check: ${err?.message || 'unable to inspect image copy'}`);
    }
  } else if (toolName === 'create_folder') {
    lines.push('Will create a folder if it does not already exist.');
  }

  return lines.join('\n');
}

function requestAIOperationConfirmation(vaultPath: string, toolName: string, args: Record<string, string>): string {
  const requestHash = aiToolRequestHash(toolName, args);
  let record = findExistingAIPendingOperation(vaultPath, requestHash);
  if (!record) {
    const now = new Date();
    const token = makeAIConfirmToken();
    record = {
      version: 1,
      token,
      requestHash,
      toolName,
      args: stableAIToolArgs(args),
      preview: buildAIToolMutationPreview(vaultPath, toolName, args),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + AI_PENDING_OPERATION_TTL_MS).toISOString(),
      status: 'pending',
      requestedBy: 'ai',
    };
    fs.mkdirSync(aiPendingOpsDir(vaultPath), { recursive: true });
    writeJson(aiPendingOperationPath(vaultPath, token), record);
    appendAIOperationAudit(vaultPath, 'preview_requested', {
      token,
      toolName,
      requestHash,
      args: summarizeAIToolArgs(args),
    });
  }

  return [
    'AI operation preview only. Nothing was changed.',
    '',
    record.preview,
    '',
    `Confirmation token: ${record.token}`,
    `Expires: ${record.expiresAt}`,
    '',
    `To apply it, send a new message containing exactly this token: ${record.token}`,
    'The AI is not allowed to apply this token unless it appears in the latest user message.',
  ].join('\n');
}

function markAIPendingOperation(vaultPath: string, token: string, status: 'applied' | 'cancelled'): void {
  const recordPath = aiPendingOperationPath(vaultPath, token);
  const record = readJsonSafe<AIPendingOperationRecord | null>(recordPath, null);
  if (!record) return;
  const now = new Date().toISOString();
  const next: AIPendingOperationRecord = {
    ...record,
    status,
    appliedAt: status === 'applied' ? now : record.appliedAt,
    cancelledAt: status === 'cancelled' ? now : record.cancelledAt,
  };
  writeJson(recordPath, next);
}

async function executeAIDirectMutation(vaultPath: string, toolName: string, args: Record<string, string>, safety: AIToolSafetyContext): Promise<string> {
  const now = new Date();
  const requestHash = aiToolRequestHash(toolName, args);
  const token = makeAIConfirmToken();
  const record: AIPendingOperationRecord = {
    version: 1,
    token,
    requestHash,
    toolName,
    args: stableAIToolArgs(args),
    preview: buildAIToolMutationPreview(vaultPath, toolName, args),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + AI_PENDING_OPERATION_TTL_MS).toISOString(),
    status: 'pending',
    requestedBy: 'ai',
  };

  const rollbackSeed = beginAIOperationRollbackSnapshot(vaultPath, record);
  appendAIOperationAudit(vaultPath, 'direct_apply_started', {
    token,
    toolName,
    requestHash,
    args: summarizeAIToolArgs(args),
  });

  const result = await executeAITool(vaultPath, toolName, {
    ...args,
    __ai_direct_apply_internal: '1',
  }, safety);

  if (!/^Error:/i.test(result)) {
    const rollbackSnapshot = rollbackSeed ? finalizeAIOperationRollbackSnapshot(vaultPath, token) : null;
    appendAIOperationAudit(vaultPath, 'direct_applied', {
      token,
      toolName,
      requestHash,
      rollbackAvailable: !!rollbackSnapshot,
      rollbackFileCount: rollbackSnapshot ? (rollbackSnapshot.before.length + (rollbackSnapshot.after?.length || 0)) : 0,
      result: result.slice(0, 1200),
    });
  } else if (rollbackSeed) {
    try { fs.unlinkSync(aiRollbackOperationPath(vaultPath, token)); } catch { /* best-effort cleanup for failed direct apply */ }
    appendAIOperationAudit(vaultPath, 'direct_apply_failed', {
      token,
      toolName,
      requestHash,
      result: result.slice(0, 1200),
    });
  }

  return result;
}

async function executeAITool(vaultPath: string, toolName: string, args: Record<string, string>, safety: AIToolSafetyContext = { lastUserText: '', confirmedTokens: new Set(), controlMode: 'readonly' }): Promise<string> {
  if (!isAIToolAllowedInMode(toolName, safety.controlMode)) {
    return `Error: Tool "${toolName}" is not allowed in ${aiControlModeLabel(safety.controlMode)} mode. Switch to Producer takeover mode for team-wide schedule/production changes, or Member execution mode for ordinary confirmed file changes.`;
  }
  if (toolName === 'create_canvas' && !shouldAutoCreateCanvasFromPrompt(safety.lastUserText)) {
    return 'Error: Canvas creation blocked. The current user request did not explicitly ask for a canvas, flowchart, mind map, kanban board, or visual board. For Markdown/table repair, read and write the target .md file only.';
  }
  if (toolName === 'create_wireframe' && !hasStrictWireframeCreationIntent(safety.lastUserText)) {
    return 'Error: Wireframe creation blocked. The current user request did not explicitly ask to create a UI wireframe/prototype. For Markdown/table repair, read and write the target .md file only.';
  }

  if (toolName === 'list_ai_pending_operations') {
    const dir = aiPendingOpsDir(vaultPath);
    const records: AIPendingOperationRecord[] = [];
    if (fs.existsSync(dir)) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const record = readJsonSafe<AIPendingOperationRecord | null>(path.join(dir, entry.name), null);
        if (record && record.status === 'pending' && Date.parse(record.expiresAt || '') > Date.now()) {
          records.push({ ...record, args: summarizeAIToolArgs(record.args) as Record<string, string> });
        }
      }
    }
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return JSON.stringify({ ok: true, pending: records.slice(0, 30) }, null, 2);
  }

  if (toolName === 'cancel_ai_operation') {
    const token = normalizeAIConfirmToken((args as any).token || (args as any).confirm_token);
    if (!token) return 'Error: token is required.';
    const record = readAIPendingOperation(vaultPath, token);
    if (!record) return `Error: Pending AI operation not found or expired: ${token}`;
    markAIPendingOperation(vaultPath, token, 'cancelled');
    appendAIOperationAudit(vaultPath, 'cancelled', { token, toolName: record.toolName, requestHash: record.requestHash });
    return `Pending AI operation cancelled: ${token}`;
  }

  if (toolName === 'apply_ai_operation') {
    const token = normalizeAIConfirmToken((args as any).token || (args as any).confirm_token);
    if (!token) return 'Error: token is required.';
    if (!safety.confirmedTokens.has(token)) {
      return `Error: User confirmation missing. The latest user message must contain ${token}.`;
    }
    const record = readAIPendingOperation(vaultPath, token);
    if (!record) return `Error: Pending AI operation not found or expired: ${token}`;
    const rollbackSeed = beginAIOperationRollbackSnapshot(vaultPath, record);
    const result = await executeAITool(vaultPath, record.toolName, { ...record.args, confirm_token: token, __ai_apply_internal: '1' }, safety);
    if (!result.startsWith('Error:')) {
      const rollbackSnapshot = rollbackSeed ? finalizeAIOperationRollbackSnapshot(vaultPath, token) : null;
      markAIPendingOperation(vaultPath, token, 'applied');
      appendAIOperationAudit(vaultPath, 'applied', {
        token,
        toolName: record.toolName,
        requestHash: record.requestHash,
        rollbackAvailable: !!rollbackSnapshot,
        rollbackFileCount: rollbackSnapshot ? (rollbackSnapshot.before.length + (rollbackSnapshot.after?.length || 0)) : 0,
        result: result.slice(0, 1200),
      });
    } else if (rollbackSeed) {
      try { fs.unlinkSync(aiRollbackOperationPath(vaultPath, token)); } catch { /* best-effort cleanup for failed apply */ }
    }
    return result;
  }

  const directApplyInternal = (args as any).__ai_direct_apply_internal === '1';
  if (aiToolRequiresConfirmation(toolName, args) && !directApplyInternal) {
    const token = normalizeAIConfirmToken((args as any).confirm_token);
    if (aiToolPreviewConfirmationRequested(args) && (!token || !safety.confirmedTokens.has(token))) {
      return requestAIOperationConfirmation(vaultPath, toolName, args);
    }
    if (token && safety.confirmedTokens.has(token)) {
      const record = readAIPendingOperation(vaultPath, token);
      const requestHash = aiToolRequestHash(toolName, args);
      if (!record) return `Error: Pending AI operation not found or expired: ${token}`;
      if (record.toolName !== toolName || record.requestHash !== requestHash) {
        return `Error: Confirmation token ${token} does not match this tool operation.`;
      }
      if ((args as any).__ai_apply_internal !== '1') {
        return executeAITool(vaultPath, 'apply_ai_operation', { token }, safety);
      }
    }
    if ((args as any).__ai_apply_internal !== '1') {
      return executeAIDirectMutation(vaultPath, toolName, args, safety);
    }
  }

  const rawPath = args.path || '';

  const resolveToolPath = (value: string, options: { allowRoot?: boolean } = {}) => {
    const safeRelPath = normalizeVaultRelativePath(String(value || '').trim());
    return {
      relPath: safeRelPath,
      fullPath: resolveVaultRelativePath(vaultPath, value, options),
    };
  };

  switch (toolName) {
    case 'read_file': {
      let target;
      try { target = resolveToolPath(rawPath); } catch (err: any) { return `Error: ${err.message}`; }
      if (!fs.existsSync(target.fullPath)) return `Error: File not found: ${target.relPath}`;
      if (fs.statSync(target.fullPath).isDirectory()) return `Error: Path is a directory, not a file: ${target.relPath}`;
      const content = fs.readFileSync(target.fullPath, 'utf-8');
      if (content.length > 50000) return content.slice(0, 50000) + '\n\n... (truncated, file is too large)';
      return content;
    }
    case 'write_file': {
      let target;
      try { target = resolveToolPath(rawPath); } catch (err: any) { return `Error: ${err.message}`; }
      const { relPath, fullPath } = target;
      const dir = path.dirname(fullPath);
      fs.mkdirSync(dir, { recursive: true });
      if (
        (hasMarkdownRepairIntent(safety.lastUserText) || hasHumanizerIntent(safety.lastUserText))
        && (relPath.endsWith('.visual.md') || /(?:GameWorkspaceSummary|WorkspaceSummary|Currentnote|ArshisGameContext)/i.test(relPath))
        && !safety.lastUserText.replace(/\\/g, '/').toLowerCase().includes(relPath.replace(/\\/g, '/').toLowerCase())
      ) {
        return `Error: Visual summary write blocked during Markdown writing cleanup. The user asked to repair or humanize text, so write only the target .md file, not ${relPath}.`;
      }
      /* Smart fallback: if AI uses write_file for a .canvas file, auto-convert */
      if (relPath.endsWith('.canvas')) {
        if (!shouldAutoCreateCanvasFromPrompt(safety.lastUserText)) {
          return 'Error: Canvas creation blocked. The user did not explicitly ask for a canvas, flowchart, mind map, kanban board, or visual board. Write a Markdown document instead unless the user asks for a visual board.';
        }
        const content = args.content || '';
        try {
          /* Check if content is already valid canvas JSON */
          const parsed = JSON.parse(content);
          if (parsed.nodes && Array.isArray(parsed.nodes)) {
            const fittedCanvas = normalizeAICanvasData({ nodes: parsed.nodes, edges: parsed.edges || [] });
            const nextContent = JSON.stringify(fittedCanvas, null, 2);
            try {
              assertSafeVisualDocumentWrite(fullPath, nextContent, { blockLargeShrink: true });
            } catch (err: any) {
              if (isVisualDocumentSafetyError(err)) return `Error: ${err.message}`;
              throw err;
            }
            saveLiveHistoryBeforeOverwrite(fullPath, nextContent, 'ai-write-canvas');
            fs.writeFileSync(fullPath, nextContent, 'utf-8');
            const quality = analyzeCanvasQuality(fittedCanvas);
            const companionPath = writeAIVisualCompanion(vaultPath, relPath, buildCanvasCompanionMarkdown(relPath, fittedCanvas));
            return `Canvas file written: ${relPath} (${fittedCanvas.nodes.length} cards, quality ${quality.score}/100). Companion brief: \`${companionPath}\``;
          }
        } catch { /* not JSON — treat as markdown to auto-convert */ }

        /* Markdown → Canvas auto-conversion */
        const autoCanvas = normalizeAICanvasData(markdownToCanvas(content));
        const nextContent = JSON.stringify(autoCanvas, null, 2);
        assertSafeVisualDocumentWrite(fullPath, nextContent, { blockLargeShrink: true });
        saveLiveHistoryBeforeOverwrite(fullPath, nextContent, 'ai-write-canvas');
        fs.writeFileSync(fullPath, nextContent, 'utf-8');
        const quality = analyzeCanvasQuality(autoCanvas);
        const companionPath = writeAIVisualCompanion(vaultPath, relPath, buildCanvasCompanionMarkdown(relPath, autoCanvas));
        return `Canvas created (auto-converted from markdown): ${relPath} (${autoCanvas.nodes.length} cards, ${autoCanvas.edges.length} connections, quality ${quality.score}/100). Companion brief: \`${companionPath}\`. User can open it in the canvas editor to view and edit.`;
      }

      /* Smart fallback: if AI uses write_file for a .excalidraw file, auto-convert */
      if (relPath.endsWith('.excalidraw')) {
        if (!hasStrictWireframeCreationIntent(safety.lastUserText)) {
          return 'Error: Wireframe creation blocked. The user did not explicitly ask to create a UI wireframe/prototype. Write or repair Markdown instead unless the user asks for a visual prototype.';
        }
        const content = args.content || '';
        try {
          const parsed = JSON.parse(content);
          if (parsed.elements && Array.isArray(parsed.elements)) {
            const nextContent = JSON.stringify(parsed);
            assertSafeVisualDocumentWrite(fullPath, nextContent, { blockLargeShrink: true });
            saveLiveHistoryBeforeOverwrite(fullPath, nextContent, 'ai-write-excalidraw');
            fs.writeFileSync(fullPath, nextContent, 'utf-8');
            const companionPath = writeAIVisualCompanion(vaultPath, relPath, buildWireframeCompanionMarkdown(relPath, parsed.elements, parsed));
            return `Wireframe file written: ${relPath} (${parsed.elements.length} elements). Companion brief: \`${companionPath}\``;
          }
        } catch (err) {
          if (isVisualDocumentSafetyError(err)) throw err;
          /* not valid JSON */
        }

        /* Try parsing as wireframe role-based JSON */
        try {
          const elements = JSON.parse(content);
          if (Array.isArray(elements) && elements.length > 0 && elements[0].role) {
            const scene = buildExcalidrawScene(elements);
            const nextContent = JSON.stringify(scene);
            assertSafeVisualDocumentWrite(fullPath, nextContent, { blockLargeShrink: true });
            saveLiveHistoryBeforeOverwrite(fullPath, nextContent, 'ai-write-excalidraw');
            fs.writeFileSync(fullPath, nextContent, 'utf-8');
            const companionPath = writeAIVisualCompanion(vaultPath, relPath, buildWireframeCompanionMarkdown(relPath, elements, scene));
            return `Wireframe created (auto-converted from role elements): ${relPath} (${(scene as any).elements.length} elements). Companion brief: \`${companionPath}\``;
          }
        } catch (err) {
          if (isVisualDocumentSafetyError(err)) throw err;
          /* not role-based either */
        }
      }

      let nextFileContent = args.content || '';
      const humanized = shouldAutoHumanizeMarkdownWrite(relPath, nextFileContent, safety.lastUserText)
        ? autoHumanizeMarkdownContent(nextFileContent)
        : { content: nextFileContent, changed: false, count: 0 };
      nextFileContent = humanized.content;
      assertSafeVisualDocumentWrite(fullPath, nextFileContent, { requireValidNonEmpty: true });
      saveLiveHistoryBeforeOverwrite(fullPath, nextFileContent, 'ai-write-file');
      fs.writeFileSync(fullPath, nextFileContent, 'utf-8');
      return humanized.changed
        ? `File written successfully: ${relPath}. Auto-humanized Markdown cleanup: ${humanized.count} change(s).`
        : `File written successfully: ${relPath}`;
    }
    case 'delete_file': {
      let target;
      try { target = resolveToolPath(rawPath); } catch (err: any) { return `Error: ${err.message}`; }
      const { relPath, fullPath } = target;
      if (isProtectedAIFileDeletePath(relPath)) {
        return `Error: Refusing to delete protected internal path: ${relPath}`;
      }
      if (!fs.existsSync(fullPath)) return `Error: File not found: ${relPath}`;
      if (!fs.statSync(fullPath).isFile()) return `Error: delete_file only deletes files, not folders: ${relPath}`;
      saveLiveHistoryBeforeOverwrite(fullPath, undefined, 'ai-delete-file');
      const recoveryPath = saveAIFileDeleteRecoveryCopy(vaultPath, relPath, fullPath);
      const holdPath = writeAIServerDeleteHold(vaultPath, relPath, fullPath, recoveryPath);
      fs.unlinkSync(fullPath);
      return `File deleted locally: ${relPath}. Recovery copy: \`${recoveryPath}\`. Live Sync will publish the server delete automatically. Delete marker: \`${holdPath}\``;
    }
    case 'delete_files': {
      const paths = parseAIDeleteFilePaths(args);
      if (paths.length === 0) return 'Error: No file paths provided for delete_files.';
      const deleted: Array<{ relativePath: string; recoveryPath: string; deleteMarkerPath: string }> = [];
      const skipped: Array<{ relativePath: string; reason: string }> = [];
      const failed: Array<{ relativePath: string; error: string }> = [];

      for (const relPath of paths) {
        try {
          if (isProtectedAIFileDeletePath(relPath)) {
            skipped.push({ relativePath: relPath, reason: 'protected-path' });
            continue;
          }
          const fullPath = resolveVaultRelativePath(vaultPath, relPath);
          if (!fs.existsSync(fullPath)) {
            skipped.push({ relativePath: relPath, reason: 'missing' });
            continue;
          }
          if (!fs.statSync(fullPath).isFile()) {
            skipped.push({ relativePath: relPath, reason: 'not-a-file' });
            continue;
          }
          saveLiveHistoryBeforeOverwrite(fullPath, undefined, 'ai-delete-file');
          const recoveryPath = saveAIFileDeleteRecoveryCopy(vaultPath, relPath, fullPath);
          const holdPath = writeAIServerDeleteHold(vaultPath, relPath, fullPath, recoveryPath);
          fs.unlinkSync(fullPath);
          cleanupEmptyDirectoryChain(path.dirname(fullPath), path.resolve(vaultPath));
          deleted.push({ relativePath: relPath, recoveryPath, deleteMarkerPath: holdPath });
        } catch (err: any) {
          failed.push({ relativePath: relPath, error: err?.message || 'delete failed' });
        }
      }

      return JSON.stringify({
        ok: failed.length === 0,
        deletedCount: deleted.length,
        skippedCount: skipped.length,
        failedCount: failed.length,
        deleted,
        skipped,
        failed,
      }, null, 2);
    }
    case 'append_file': {
      let target;
      try { target = resolveToolPath(rawPath); } catch (err: any) { return `Error: ${err.message}`; }
      if (!fs.existsSync(target.fullPath)) return `Error: File not found: ${target.relPath}`;
      saveLiveHistoryBeforeOverwrite(target.fullPath, undefined, 'ai-append-file');
      fs.appendFileSync(target.fullPath, args.content || '', 'utf-8');
      return `Content appended to: ${target.relPath}`;
    }
    case 'read_team_schedule': {
      const limit = Math.max(1, Math.min(200, Number(args.limit || 40) || 40));
      const schedule = readTeamScheduleData(vaultPath);
      const stats = summarizeTeamSchedule(schedule);
      const memberLoad = buildTeamMemberLoadRows(vaultPath, schedule).slice(0, Math.min(limit, 50));
      const activeTasks = (schedule.tasks || [])
        .filter((task: any) => normalizeTeamTaskStatus(task.status) !== 'done')
        .map((task: any) => ({
          id: task.id,
          title: normalizeTeamScheduleText(task.title),
          owner: normalizeTeamScheduleText(task.owner),
          status: normalizeTeamTaskStatus(task.status),
          priority: normalizeTeamTaskPriority(task.priority),
          dueDate: normalizeTeamScheduleDate(task.dueDate),
          linkedDoc: normalizeTeamSchedulePath(task.linkedDoc),
          deliverable: normalizeTeamScheduleText(task.deliverable),
          dependency: normalizeTeamScheduleText(task.dependency),
          blocker: normalizeTeamScheduleText(task.blocker),
          acceptance: normalizeTeamScheduleText(task.acceptance),
          notes: normalizeTeamScheduleText(task.notes).slice(0, 500),
          updatedAt: typeof task.updatedAt === 'string' ? task.updatedAt : '',
        }))
        .slice(0, limit);
      return JSON.stringify({
        ok: true,
        path: `${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`,
        updatedAt: schedule.updatedAt || '',
        members: schedule.members || [],
        stats,
        memberLoad,
        activeTasks,
      }, null, 2);
    }
    case 'read_team_server_status': {
      const limit = Math.max(1, Math.min(100, Number(args.limit || 24) || 24));
      try {
        const status = await fetchTeamServerProductionStatus(vaultPath, { limit });
        return JSON.stringify(buildAITeamServerStatusSummary(status), null, 2);
      } catch (err: any) {
        return JSON.stringify({
          ok: false,
          error: err?.message || 'Unable to read team server production status',
          coordinationAdvice: [
            'Server production status is unavailable. Continue with local read_team_schedule/read_production_health data, but clearly tell the user that cross-device sync evidence is missing.',
            'For cross-computer work, ask the user to verify self-hosted sync server URL, API key, WebSocket connectivity, and NAS deployment before treating task assignments as shared.',
          ],
        }, null, 2);
      }
    }
    case 'read_team_member_work': {
      const limit = Math.max(1, Math.min(100, Number(args.limit || 40) || 40));
      const member = normalizeTeamScheduleText((args as any).member || '');
      try {
        const data = await fetchTeamServerMemberWork(vaultPath, { member, limit });
        return JSON.stringify(buildAITeamMemberWorkSummary(data), null, 2);
      } catch (err: any) {
        return JSON.stringify({
          ok: false,
          member,
          error: err?.message || 'Unable to read team member work from server',
          coordinationAdvice: [
            'Server member work is unavailable. Continue with local read_team_schedule/read_production_health data, but clearly tell the user that remote member evidence is missing.',
            'If this is a cross-computer assignment, verify the self-hosted server is updated to a version that includes /api/team/member-work and that .ars-team/schedule.json is live-synced.',
          ],
        }, null, 2);
      }
    }
    case 'read_production_health': {
      const limit = Math.max(1, Math.min(50, Number(args.limit || 12) || 12));
      return JSON.stringify(buildTeamProductionHealth(vaultPath, limit), null, 2);
    }
    case 'read_sync_recovery_advisor': {
      const options = syncRecoveryAdvisorOptionsFromAIArgs(args);
      try {
        const plan = await previewSyncRecoveryAdvisor(vaultPath, {
          sinceHours: options.sinceHours,
          includeAllReasons: options.includeAllReasons,
          limit: options.limit,
        });
        return JSON.stringify(summarizeSyncRecoveryAdvisorForAI(plan, Math.min(options.limit, 80)), null, 2);
      } catch (err: any) {
        return JSON.stringify({
          ok: false,
          error: err?.message || 'Unable to read Sync Recovery Advisor',
          safetyAdvice: [
            'Do not resume uploads or apply recovery until the recovery advisor can inspect local and server history.',
            'If server history is unavailable, check the NAS server URL/API key and whether the latest server folder is deployed.',
          ],
        }, null, 2);
      }
    }
    case 'apply_sync_recovery_advisor_plan': {
      const options = syncRecoveryAdvisorOptionsFromAIArgs(args);
      const result = await applySyncRecoveryAdvisorPlan(vaultPath, {
        sinceHours: options.sinceHours,
        includeAllReasons: options.includeAllReasons,
        includeMedium: options.includeMedium,
        applyLimit: options.applyLimit,
        limit: Math.max(options.applyLimit, options.limit),
      });
      return JSON.stringify({
        ok: !!result.ok,
        mode: result.mode,
        appliedCount: result.appliedCount,
        failedCount: result.failedCount,
        skippedCount: result.skippedCount,
        reportRelativePath: result.reportRelativePath,
        planSummary: result.planSummary,
        nextSummary: result.nextSummary,
        applied: Array.isArray(result.applied) ? result.applied.slice(0, 30) : [],
        failed: Array.isArray(result.failed) ? result.failed.slice(0, 30) : [],
        skipped: Array.isArray(result.skipped) ? result.skipped.slice(0, 30) : [],
        safety: [
          'Server files were not deleted.',
          'Safe Delete Queue was not bypassed.',
          'Overwrites/restores saved live-history before changing local files.',
        ],
      }, null, 2);
    }
    case 'bootstrap_team_workspace': {
      const limit = Math.max(8, Math.min(80, Number(args.limit || 48) || 48));
      const result = bootstrapTeamWorkspace(vaultPath, {
        currentMember: normalizeTeamScheduleText((args as any).current_member),
        limit,
      });
      const stats = result.health?.stats || {};
      const taskDocs = result.productionDocs?.summary?.taskDocs || {};
      return [
        `Team workspace bootstrapped: \`${result.schedulePath}\`.`,
        `Starter tasks considered=${result.taskCount}, created=${result.upsert.importedCount}, updated=${result.upsert.updatedCount}, skipped=${result.upsert.skippedCount}.`,
        `Production docs generated=${result.productionDocs.paths.length}; task docs created=${taskDocs.createdCount || 0}, linked=${taskDocs.linkedCount || 0}, upgraded=${taskDocs.upgradedCount || 0}.`,
        `Health: active=${stats.active || 0}, blocked=${stats.blocked || 0}, overdue=${stats.overdue || 0}, missingDocs=${stats.missingDocs || 0}, qaOpen=${stats.qaOpen || 0}, narrativeMissingStages=${stats.narrativeMissingStages || 0}.`,
        'Open the Ars-note team command center at `.ars-team/obsidian-command-center.md`, then run `read_production_health` and continue from the highest-risk tasks.',
      ].join('\n');
    }
    case 'draft_narrative_tasks': {
      const limit = Math.max(1, Math.min(80, Number(args.limit || 24) || 24));
      const includeQa = parseAIToolBooleanArg((args as any).include_qa, true);
      const draft = buildNarrativeTakeoverTaskDrafts(vaultPath, { limit, includeQa });
      const upsert = parseAIToolBooleanArg((args as any).upsert, false);
      const sourceLabel = normalizeTeamScheduleText(args.source_label) || 'AI narrative takeover';
      const payload: any = {
        ok: true,
        summary: draft.summary,
        tasks: draft.tasks,
        instruction: upsert
          ? 'Tasks were upserted into the team schedule. Call generate_team_production_docs next.'
          : 'Review these drafts, then call upsert_team_tasks with tasks if the user wants them added to the team schedule.',
      };
      if (upsert) {
        payload.upsert = upsertTeamScheduleTasks(vaultPath, draft.tasks, sourceLabel, {
          balanceAssignments: true,
        });
      }
      return JSON.stringify(payload, null, 2);
    }
    case 'sync_team_task_docs': {
      const result = syncTeamTaskDocsToSchedule(vaultPath, normalizeTeamScheduleText(args.fallback_member));
      return `Team task docs synced: \`${result.schedulePath}\` (${result.scannedCount} scanned, ${result.changedCount} tasks updated, ${result.addedLogCount} logs added, ${result.addedReviewCount} reviews added, ${result.inferredStatusCount} statuses inferred, ${result.missingCount} missing docs, ${result.skippedCount} skipped).`;
    }
    case 'upsert_team_tasks': {
      let tasks: any[] = [];
      try {
        const parsed = JSON.parse(args.tasks || '[]');
        if (!Array.isArray(parsed)) return 'Error: tasks must be a JSON array';
        tasks = parsed;
      } catch {
        return 'Error: Invalid JSON in tasks parameter';
      }
      const sourceLabel = normalizeTeamScheduleText(args.source_label) || 'AI';
      const result = upsertTeamScheduleTasks(vaultPath, tasks, sourceLabel, {
        balanceAssignments: true,
      });
      const assignmentLines = summarizeTeamAssignmentReview(result.assignmentReview);
      return [
        `Team schedule updated: \`${result.schedulePath}\` (${result.importedCount} created, ${result.updatedCount} updated, ${result.skippedCount} skipped).`,
        ...assignmentLines,
      ].join('\n');
    }
    case 'generate_team_production_docs': {
      const result = generateTeamProductionDocs(vaultPath, teamProductionDocOptionsFromAIArgs(args));
      const stats = result.summary?.stats || {};
      const taskDocs = result.summary?.taskDocs || {};
      const recommendations = Array.isArray(result.summary?.recommendations)
        ? result.summary.recommendations.slice(0, 5)
        : [];
      return [
        `Team production docs generated: ${result.paths.map((item) => `\`${item}\``).join(', ')}.`,
        `Task work docs: created=${taskDocs.createdCount || 0}, linked=${taskDocs.linkedCount || 0}, upgraded=${taskDocs.upgradedCount || 0}, skipped=${taskDocs.skippedCount || 0}.`,
        `Stats: active=${stats.active || 0}, blocked=${stats.blocked || 0}, overdue=${stats.overdue || 0}, missingDocs=${stats.missingDocs || 0}, qaOpen=${stats.qaOpen || 0}.`,
        recommendations.length ? `Recommendations: ${recommendations.join(' | ')}` : '',
      ].filter(Boolean).join('\n');
    }
    case 'list_files': {
      let target;
      try { target = resolveToolPath(rawPath, { allowRoot: true }); } catch (err: any) { return `Error: ${err.message}`; }
      const targetDir = target.fullPath;
      if (!fs.existsSync(targetDir)) return `Error: Directory not found: ${target.relPath || '/'}`;
      if (!fs.statSync(targetDir).isDirectory()) return `Error: Not a directory: ${target.relPath}`;
      const entries = fs.readdirSync(targetDir, { withFileTypes: true });
      const result = entries
        .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
        .map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`)
        .join('\n');
      return result || '(empty directory)';
    }
    case 'create_folder': {
      let target;
      try { target = resolveToolPath(rawPath); } catch (err: any) { return `Error: ${err.message}`; }
      fs.mkdirSync(target.fullPath, { recursive: true });
      return `Folder created: ${target.relPath}`;
    }
    case 'list_images': {
      const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp']);
      let scanPath = '';
      if (path.isAbsolute(args.path || '')) {
        scanPath = args.path;
      } else {
        try { scanPath = resolveToolPath(args.path || '', { allowRoot: true }).fullPath; } catch (err: any) { return `Error: ${err.message}`; }
      }
      if (!fs.existsSync(scanPath)) return `Error: Directory not found: ${args.path || '/'}`;
      if (!fs.statSync(scanPath).isDirectory()) return `Error: Not a directory: ${args.path}`;
      const results: string[] = [];
      function scan(dir: string, prefix: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith('.') || e.name === 'node_modules') continue;
          if (e.isDirectory()) {
            try { scan(path.join(dir, e.name), prefix + e.name + '/'); } catch { /* skip */ }
          } else {
            const ext = path.extname(e.name).toLowerCase();
            if (IMG_EXTS.has(ext)) {
              const stat = fs.statSync(path.join(dir, e.name));
              const sizeKB = Math.round(stat.size / 1024);
              results.push(`${prefix}${e.name} (${sizeKB}KB)`);
            }
          }
        }
      }
      try { scan(scanPath, ''); } catch (err: any) { return `Error: ${err.message}`; }
      return results.length > 0 ? `Found ${results.length} image(s):\n` + results.join('\n') : 'No images found.';
    }
    case 'copy_image': {
      const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp']);
      let srcPath = '';
      if (path.isAbsolute(args.source || '')) {
        srcPath = args.source;
      } else {
        try { srcPath = resolveToolPath(args.source || '').fullPath; } catch (err: any) { return `Error: ${err.message}`; }
      }
      if (!fs.existsSync(srcPath)) return `Error: Image not found: ${args.source}`;
      const ext = path.extname(srcPath).toLowerCase();
      if (!IMG_EXTS.has(ext)) return `Error: Not an image file: ${ext}`;
      const destFolder = normalizeVaultRelativePath(args.dest_folder || 'assets');
      let destDir = '';
      try { destDir = resolveVaultRelativePath(vaultPath, destFolder); } catch (err: any) { return `Error: ${err.message}`; }
      fs.mkdirSync(destDir, { recursive: true });
      const fileName = path.basename(srcPath);
      const destPath = path.join(destDir, fileName);
      // Avoid overwriting: append number if exists
      let finalName = fileName;
      let finalPath = destPath;
      let counter = 1;
      while (fs.existsSync(finalPath) && finalPath !== srcPath) {
        finalName = path.parse(fileName).name + '_' + counter + ext;
        finalPath = path.join(destDir, finalName);
        counter++;
      }
      if (finalPath !== srcPath) {
        fs.copyFileSync(srcPath, finalPath);
      }
      const mdRef = `![](${destFolder}/${finalName})`;
      const sizeKB = Math.round(fs.statSync(finalPath).size / 1024);
      return `Image copied to vault.\nMarkdown reference: ${mdRef}\nFile: ${destFolder}/${finalName} (${sizeKB}KB)`;
    }
    case 'create_wireframe': {
      const wfPath = normalizeVaultRelativePath(args.path || '');
      if (!wfPath.endsWith('.excalidraw')) return 'Error: File path must end with .excalidraw';
      let elements: any[];
      try { elements = JSON.parse(args.elements || '[]'); } catch { return 'Error: Invalid JSON in elements parameter'; }
      if (!Array.isArray(elements) || elements.length === 0) return 'Error: elements must be a non-empty JSON array';
      let wfFullPath = '';
      try { wfFullPath = resolveVaultRelativePath(vaultPath, wfPath); } catch (err: any) { return `Error: ${err.message}`; }
      fs.mkdirSync(path.dirname(wfFullPath), { recursive: true });
      const scene = buildExcalidrawScene(elements);
      const nextContent = JSON.stringify(scene);
      assertSafeVisualDocumentWrite(wfFullPath, nextContent, { blockLargeShrink: true });
      saveLiveHistoryBeforeOverwrite(wfFullPath, nextContent, 'ai-create-wireframe');
      fs.writeFileSync(wfFullPath, nextContent, 'utf-8');
      const elCount = (scene as any).elements.length;
      const companionPath = writeAIVisualCompanion(vaultPath, wfPath, buildWireframeCompanionMarkdown(wfPath, elements, scene));
      return `Wireframe created: ${wfPath} (${elCount} elements). Companion brief: \`${companionPath}\`. User can open it in the wireframe editor to view and edit.`;
    }
    case 'create_canvas': {
      const cvPath = normalizeVaultRelativePath(args.path || '');
      if (!cvPath.endsWith('.canvas')) return 'Error: File path must end with .canvas';
      if (!shouldAutoCreateCanvasFromPrompt(safety.lastUserText)) {
        return 'Error: Canvas creation blocked. The user did not explicitly ask for a canvas, flowchart, mind map, kanban board, or visual board. Write a Markdown document instead unless the user asks for a visual board.';
      }
      let canvasNodes: any[];
      let canvasEdges: any[];
      try { canvasNodes = JSON.parse(args.nodes || '[]'); } catch { return 'Error: Invalid JSON in nodes parameter'; }
      try { canvasEdges = JSON.parse(args.edges || '[]'); } catch { return 'Error: Invalid JSON in edges parameter'; }
      if (!Array.isArray(canvasNodes) || canvasNodes.length === 0) return 'Error: nodes must be a non-empty JSON array';
      let cvFullPath = '';
      try { cvFullPath = resolveVaultRelativePath(vaultPath, cvPath); } catch (err: any) { return `Error: ${err.message}`; }
      fs.mkdirSync(path.dirname(cvFullPath), { recursive: true });
      const canvasData = normalizeAICanvasData({ nodes: canvasNodes, edges: canvasEdges });
      const nextContent = JSON.stringify(canvasData, null, 2);
      assertSafeVisualDocumentWrite(cvFullPath, nextContent, { blockLargeShrink: true });
      saveLiveHistoryBeforeOverwrite(cvFullPath, nextContent, 'ai-create-canvas');
      fs.writeFileSync(cvFullPath, nextContent, 'utf-8');
      const quality = analyzeCanvasQuality(canvasData);
      const companionPath = writeAIVisualCompanion(vaultPath, cvPath, buildCanvasCompanionMarkdown(cvPath, canvasData));
      return `Canvas created: ${cvPath} (${canvasData.nodes.length} cards, ${canvasData.edges.length} connections, quality ${quality.score}/100). Companion brief: \`${companionPath}\`. User can open it in the canvas editor to view and edit.`;
    }
    default:
      return `Unknown tool: ${toolName}`;
  }
}

function listAIOperationAudit(vaultPath: string, limit = 100): any[] {
  const resolvedVault = path.resolve(vaultPath);
  const dir = aiAuditOpsDir(resolvedVault);
  if (!fs.existsSync(dir)) return [];
  const max = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
  const rows: any[] = [];

  try {
    const files = fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map(entry => entry.name)
      .sort()
      .reverse();

    for (const name of files) {
      if (rows.length >= max * 2) break;
      const filePath = path.join(dir, name);
      const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
      for (let index = lines.length - 1; index >= 0; index--) {
        try {
          const parsed = JSON.parse(lines[index]);
          rows.push(parsed);
        } catch {
          /* skip malformed audit line */
        }
        if (rows.length >= max * 2) break;
      }
    }
  } catch {
    return rows.slice(0, max);
  }

  rows.sort((a, b) => String(b?.at || '').localeCompare(String(a?.at || '')));
  return rows.slice(0, max);
}

function findAITrashRecoveryCopy(vaultPath: string, relativePath: string, expectedSha256 = ''): any | null {
  const resolvedVault = path.resolve(vaultPath);
  const trashRoot = path.resolve(path.join(resolvedVault, ARS_NOTE_DIR, AI_TRASH_DIR));
  const normalizedRel = normalizeVaultRelativePath(relativePath);
  if (!normalizedRel || !fs.existsSync(trashRoot)) return null;

  let found: any | null = null;
  const walk = (dir: string): void => {
    if (found) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (found) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relToTrash = path.relative(trashRoot, fullPath).replace(/\\/g, '/');
      const originalRel = relToTrash.split('/').slice(1).join('/');
      if (originalRel !== normalizedRel) continue;
      const content = fs.readFileSync(fullPath);
      const sha256 = crypto.createHash('sha256').update(content).digest('hex');
      if (expectedSha256 && sha256 !== expectedSha256) continue;
      const stat = fs.statSync(fullPath);
      found = {
        path: fullPath,
        relativePath: path.relative(resolvedVault, fullPath).replace(/\\/g, '/'),
        originalRelativePath: normalizedRel,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        sha256,
      };
      return;
    }
  };

  walk(trashRoot);
  return found;
}

function cleanupAITrashRecoveryCopy(vaultPath: string, recoveryRelativePath: string): void {
  try {
    const resolvedVault = path.resolve(vaultPath);
    const trashRoot = path.resolve(path.join(resolvedVault, ARS_NOTE_DIR, AI_TRASH_DIR));
    const normalizedRel = normalizeVaultRelativePath(recoveryRelativePath);
    const target = path.resolve(path.join(resolvedVault, normalizedRel.replace(/\//g, path.sep)));
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return;
    if (target === trashRoot || !isInsidePath(target, trashRoot)) return;

    fs.unlinkSync(target);
    let dir = path.dirname(target);
    while (dir !== trashRoot && isInsidePath(dir, trashRoot)) {
      try {
        if (fs.readdirSync(dir).length > 0) break;
        fs.rmdirSync(dir);
      } catch {
        break;
      }
      dir = path.dirname(dir);
    }
  } catch {
    /* best-effort self-test cleanup */
  }
}

function cleanupEmptyDirectoryChain(targetDir: string, stopDir: string): void {
  try {
    const stop = path.resolve(stopDir);
    let dir = path.resolve(targetDir);
    while (dir !== stop && isInsidePath(dir, stop)) {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) break;
      if (fs.readdirSync(dir).length > 0) break;
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    }
  } catch {
    /* best-effort cleanup */
  }
}

async function runAISafetySelfTest(vaultPath: string): Promise<{
  ok: boolean;
  checkedAt: string;
  durationMs: number;
  testFile?: string;
  token?: string;
  recoveryPath?: string;
  auditEventCount?: number;
  steps: AISafetySelfTestStep[];
}> {
  const startedAt = Date.now();
  const steps: AISafetySelfTestStep[] = [];
  const addStep = (name: string, ok: boolean, detail: string, stepStartedAt?: number) => {
    steps.push({
      name,
      ok,
      detail,
      durationMs: stepStartedAt ? Date.now() - stepStartedAt : undefined,
    });
  };

  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      steps: [{ name: 'vault', ok: false, detail: 'Invalid vault path' }],
    };
  }

  const resolvedVault = path.resolve(vaultPath);
  const testDirRel = '__ars_note_ai_safety_test__';
  const testName = `ai_delete_self_test_${Date.now()}.md`;
  const relativePath = `${testDirRel}/${testName}`;
  const testDir = path.join(resolvedVault, testDirRel);
  const filePath = path.join(testDir, testName);
  const content = [
    '# Ars-note AI Delete Safety Self Test',
    '',
    'This file is temporary and is used to verify direct AI execution, live-history capture, AI trash recovery, and rollback.',
    new Date().toISOString(),
    '',
  ].join('\n');
  const sha256 = crypto.createHash('sha256').update(Buffer.from(content, 'utf-8')).digest('hex');
  let token = '';
  let recoveryPath = '';
  let writeDirectPath = '';

  try {
    const setupAt = Date.now();
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    addStep('setup', fs.existsSync(filePath), `created temporary file ${relativePath}`, setupAt);

    const readonlyAt = Date.now();
    const readonlyResult = await executeAITool(resolvedVault, 'delete_file', { path: relativePath }, {
      lastUserText: '',
      confirmedTokens: new Set(),
      controlMode: 'readonly',
    });
    addStep(
      'readonlyBlocksDelete',
      /^Error: Tool "delete_file" is not allowed/i.test(readonlyResult) && fs.existsSync(filePath),
      fs.existsSync(filePath) ? readonlyResult : `${readonlyResult}; file was unexpectedly removed`,
      readonlyAt,
    );

    const directDeleteAt = Date.now();
    const directDeleteResult = await executeAITool(resolvedVault, 'delete_file', { path: relativePath }, {
      lastUserText: '',
      confirmedTokens: new Set(),
      controlMode: 'member',
    });
    addStep(
      'directDeleteApplies',
      !/^Error:/i.test(directDeleteResult) && !fs.existsSync(filePath),
      `${directDeleteResult}; file exists=${fs.existsSync(filePath) ? 'yes' : 'no'}`,
      directDeleteAt,
    );

    const writeDirectAt = Date.now();
    const writeDirectRelPath = `${testDirRel}/ai_write_direct_self_test_${Date.now()}.md`;
    writeDirectPath = path.join(resolvedVault, writeDirectRelPath);
    const writeDirectContent = [
      '# Ars-note AI Write Direct Self Test',
      '',
      'This content should be written immediately in member execution mode.',
      new Date().toISOString(),
      '',
    ].join('\n');
    const writeDirectResult = await executeAITool(resolvedVault, 'write_file', {
      path: writeDirectRelPath,
      content: writeDirectContent,
    }, {
      lastUserText: '',
      confirmedTokens: new Set(),
      controlMode: 'member',
    });
    addStep(
      'directWriteApplies',
      !/^Error:/i.test(writeDirectResult)
        && fs.existsSync(writeDirectPath)
        && fs.readFileSync(writeDirectPath, 'utf-8') === writeDirectContent,
      `${writeDirectResult}; file written=${fs.existsSync(writeDirectPath) ? 'yes' : 'no'}`,
      writeDirectAt,
    );

    const recoveryAdvisorReadAt = Date.now();
    const recoveryAdvisorRead = await executeAITool(resolvedVault, 'read_sync_recovery_advisor', {
      since_hours: '720',
      limit: '20',
    }, {
      lastUserText: '',
      confirmedTokens: new Set(),
      controlMode: 'readonly',
    });
    addStep(
      'syncRecoveryAdvisorRead',
      recoveryAdvisorRead.includes('"ok": true') && recoveryAdvisorRead.includes('"recommendations"'),
      recoveryAdvisorRead.slice(0, 500),
      recoveryAdvisorReadAt,
    );

    const legacyPreviewAt = Date.now();
    const legacyPreview = await executeAITool(resolvedVault, 'apply_sync_recovery_advisor_plan', {
      since_hours: '720',
      include_medium: 'false',
      apply_limit: '20',
      __ai_preview_internal: '1',
    }, {
      lastUserText: '',
      confirmedTokens: new Set(),
      controlMode: 'member',
    });
    const legacyPreviewToken = normalizeAIConfirmToken(legacyPreview);
    addStep(
      'legacyPreviewAvailable',
      legacyPreview.includes('AI operation preview only') && !!legacyPreviewToken,
      legacyPreviewToken
        ? `legacy preview created ${legacyPreviewToken}`
        : legacyPreview.slice(0, 500),
      legacyPreviewAt,
    );
    if (legacyPreviewToken) {
      await executeAITool(resolvedVault, 'cancel_ai_operation', { token: legacyPreviewToken }, {
        lastUserText: '',
        confirmedTokens: new Set(),
        controlMode: 'readonly',
      });
    }

    const aiServerDeleteHoldAt = Date.now();
    const holdManifest = readJsonSafe<any>(aiServerDeleteHoldFilePath(resolvedVault), { items: [] });
    const holdExists = Array.isArray(holdManifest?.items)
      && holdManifest.items.some((item: any) => normalizeVaultRelativePath(String(item?.relativePath || '')) === relativePath);
    addStep(
      'aiServerDeletePublishes',
      holdExists || !fs.existsSync(filePath),
      holdExists
        ? `AI delete marker is ready for Live Sync: ${relativePath}`
        : 'AI delete uses the normal Live Sync delete path after direct execution',
      aiServerDeleteHoldAt,
    );

    const recoveryAt = Date.now();
    const recovery = findAITrashRecoveryCopy(resolvedVault, relativePath, sha256);
    recoveryPath = recovery?.relativePath || '';
    addStep(
      'aiTrashRecoveryCopy',
      !!recovery && recovery.sha256 === sha256,
      recovery ? `recovery copy saved at ${recovery.relativePath}` : 'AI trash recovery copy was not found',
      recoveryAt,
    );

    const historyAt = Date.now();
    const historyRecord = listLiveHistory(resolvedVault, relativePath)
      .find(row => row.deletedSnapshot && row.sha256 === sha256);
    addStep(
      'liveHistoryBeforeDelete',
      !!historyRecord,
      historyRecord ? `live-history snapshot ${historyRecord.versionId}` : 'deleted file content was not found in live-history',
      historyAt,
    );

    const auditAt = Date.now();
    const deleteRequestHash = aiToolRequestHash('delete_file', { path: relativePath });
    const auditEvents = listAIOperationAudit(resolvedVault, 200)
      .filter(item => item?.requestHash === deleteRequestHash || item?.args?.path === relativePath);
    const directAppliedAudit = auditEvents.find(item => item?.event === 'direct_applied' && item?.token);
    token = String(directAppliedAudit?.token || auditEvents.find(item => item?.token)?.token || '');
    const hasStartedAudit = auditEvents.some(item => item?.event === 'direct_apply_started');
    const hasAppliedAudit = auditEvents.some(item => item?.event === 'direct_applied');
    addStep(
      'operationAuditTrail',
      hasStartedAudit && hasAppliedAudit && !!token,
      `audit events for ${token || '-'}: ${auditEvents.map(item => item.event).join(', ') || 'none'}`,
      auditAt,
    );

    const rollbackPreviewAt = Date.now();
    const rollbackPreview = token ? previewAIOperationRollback(resolvedVault, token) : null;
    addStep(
      'operationRollbackPreview',
      !!rollbackPreview && rollbackPreview.restorableCount > 0,
      rollbackPreview
        ? `rollback preview: restorable=${rollbackPreview.restorableCount}, skipped=${rollbackPreview.skippedCount}`
        : 'rollback preview unavailable',
      rollbackPreviewAt,
    );

    const rollbackAt = Date.now();
    const rollbackResult = token ? rollbackAIOperation(resolvedVault, token) : null;
    const restoredSha = fs.existsSync(filePath) ? fileSha256(filePath) : '';
    addStep(
      'operationRollbackRestore',
      !!rollbackResult && rollbackResult.restoredCount > 0 && fs.existsSync(filePath) && restoredSha === sha256,
      rollbackResult
        ? `rollback restored=${rollbackResult.restoredCount}, deleted=${rollbackResult.deletedCount}, failed=${rollbackResult.failedCount}`
        : 'rollback did not run',
      rollbackAt,
    );

    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (writeDirectPath && fs.existsSync(writeDirectPath)) fs.unlinkSync(writeDirectPath);
    } catch { /* best-effort cleanup */ }
    clearAIServerDeleteHold(resolvedVault, relativePath);
    if (recoveryPath) cleanupAITrashRecoveryCopy(resolvedVault, recoveryPath);
    cleanupEmptyDirectoryChain(testDir, resolvedVault);

    return {
      ok: steps.every(step => step.ok),
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      testFile: relativePath,
      token,
      recoveryPath,
      auditEventCount: auditEvents.length,
      steps,
    };
  } catch (err: any) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (writeDirectPath && fs.existsSync(writeDirectPath)) fs.unlinkSync(writeDirectPath);
      clearAIServerDeleteHold(resolvedVault, relativePath);
      cleanupEmptyDirectoryChain(testDir, resolvedVault);
    } catch {
      /* best-effort cleanup */
    }
    addStep('error', false, err.message || 'AI safety self-test failed');
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      testFile: relativePath,
      token,
      recoveryPath,
      steps,
    };
  }
}

ipcMain.handle('ai:safetySelfTest', async (_e, vaultPath: string) => {
  return runAISafetySelfTest(vaultPath);
});

ipcMain.handle('ai:listOperationAudit', async (_e, vaultPath: string, limit?: number) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return listAIOperationAudit(vaultPath, limit || 100);
});

ipcMain.handle('ai:previewOperationRollback', async (_e, vaultPath: string, token: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return previewAIOperationRollback(vaultPath, token);
});

ipcMain.handle('ai:rollbackOperation', async (_e, vaultPath: string, token: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return rollbackAIOperation(vaultPath, token);
});

function inferAIArtifactsFromTool(toolName: string, args: Record<string, string>, result: string): AIArtifactSummary[] {
  if (!result || /^Error:/i.test(result)) return [];

  if (toolName === 'apply_sync_recovery_advisor_plan') {
    try {
      const parsed = JSON.parse(result);
      const reportRelativePath = normalizeVaultRelativePath(String(parsed?.reportRelativePath || ''));
      const appliedCount = Number(parsed?.appliedCount || 0);
      const failedCount = Number(parsed?.failedCount || 0);
      const notes = [
        `Sync Recovery Advisor applied ${Number.isFinite(appliedCount) ? appliedCount : 0} item(s).`,
        failedCount > 0
          ? `${failedCount} item(s) still need manual review.`
          : 'No failed recovery item was reported.',
        'Server files were not deleted and Safe Delete Queue was not bypassed.',
      ];
      return reportRelativePath ? [{
        path: reportRelativePath,
        type: 'markdown',
        action: 'created',
        qualityStatus: 'checked',
        notes,
      }] : [];
    } catch {
      return [];
    }
  }

  if (toolName === 'generate_team_production_docs' || toolName === 'bootstrap_team_workspace') {
    const matches = Array.from(result.matchAll(/`([^`]+?\.md)`/gi))
      .map((match) => String(match[1]).replace(/\\/g, '/').replace(/^\//, ''));
    const paths = matches.length
      ? Array.from(new Set(matches))
      : [
        `${TEAM_SCHEDULE_DIR}/ai-handoff.md`,
        `${TEAM_SCHEDULE_DIR}/${teamAiMemoryIndexFileName()}`,
        `${TEAM_SCHEDULE_DIR}/${teamLinkHealthFileName()}`,
        `${TEAM_SCHEDULE_DIR}/narrative-director.md`,
        `${TEAM_SCHEDULE_DIR}/dependency-map.md`,
        `${TEAM_SCHEDULE_DIR}/handoffs/blocker-handoff-${teamTodayString().replace(/-/g, '')}.md`,
        `${TEAM_SCHEDULE_DIR}/reviews/review-queue-${teamTodayString().replace(/-/g, '')}.md`,
        `${TEAM_SCHEDULE_DIR}/workpacks/daily-workpack-${teamTodayString().replace(/-/g, '')}.md`,
        `${TEAM_SCHEDULE_DIR}/timesheets/timesheet-${teamTodayString().replace(/-/g, '')}.md`,
        `${TEAM_SCHEDULE_DIR}/roadmaps/${teamMilestoneRoadmapFileName(teamTodayString())}`,
        `${TEAM_SCHEDULE_DIR}/decisions/${teamDecisionLogFileName(teamTodayString())}`,
        `${TEAM_SCHEDULE_DIR}/changes/${teamChangeImpactFileName(teamTodayString())}`,
        `${TEAM_SCHEDULE_DIR}/plans/${teamAITakeoverPlanFileName(teamTodayString())}`,
        `${TEAM_SCHEDULE_DIR}/sprints/${teamSprintPlanFileName(teamTodayString())}`,
        `${TEAM_SCHEDULE_DIR}/${teamObsidianCommandCenterFileName()}`,
        `${TEAM_SCHEDULE_DIR}/team-dashboard.md`,
      ];
    if (toolName === 'bootstrap_team_workspace') {
      paths.unshift(`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`);
    }
    return paths.map((item) => ({
      path: item,
      type: item.endsWith('.json') ? 'other' : 'markdown',
      action: 'updated',
      qualityStatus: 'not_applicable',
      notes: [toolName === 'bootstrap_team_workspace'
        ? 'Initialized the Ars-note team workspace and production schedule.'
        : 'Generated team production control document for AI handoff, dependency review, or dashboard tracking.'],
    }));
  }

  if (toolName === 'delete_files') {
    const paths = parseAIDeleteFilePaths(args, 50);
    if (/AI operation preview only/i.test(result)) {
      return paths.map((relPath) => ({
        path: relPath,
        type: relPath.toLowerCase().endsWith('.md') ? 'markdown' : 'other',
        action: 'checked',
        qualityStatus: 'checked',
        notes: ['Legacy preview only. No file was deleted.'],
      }));
    }
    try {
      const parsed = JSON.parse(result);
      const deleted = Array.isArray(parsed?.deleted) ? parsed.deleted : [];
      return deleted.slice(0, 50).map((item: any) => {
        const relPath = normalizeVaultRelativePath(String(item?.relativePath || ''));
        return {
          path: relPath,
          type: relPath.toLowerCase().endsWith('.md') ? 'markdown' : 'other',
          action: 'deleted',
          qualityStatus: 'checked',
          notes: [`Deleted by AI batch delete. Recovery copy: ${String(item?.recoveryPath || '')}`],
        } as AIArtifactSummary;
      }).filter((item: AIArtifactSummary) => !!item.path);
    } catch {
      return paths.map((relPath) => ({
        path: relPath,
        type: relPath.toLowerCase().endsWith('.md') ? 'markdown' : 'other',
        action: 'deleted',
        qualityStatus: 'checked',
        notes: ['Deleted by AI batch delete. A local recovery snapshot was saved before deletion.'],
      }));
    }
  }

  const rawPath = (args.path || '').replace(/\\/g, '/').replace(/^\//, '');
  const resultPathMatch = result.match(/`([^`]+\.(?:md|json|canvas|excalidraw|png|jpg|jpeg|webp|gif|svg))`/i)
    || result.match(/(?:Canvas|Wireframe|File|Team schedule).*?:\s*([^\s]+?\.(?:md|json|canvas|excalidraw|png|jpg|jpeg|webp|gif|svg))/i);
  const relPath = rawPath || (resultPathMatch ? String(resultPathMatch[1]).replace(/\\/g, '/').replace(/^\//, '') : '');
  if (!relPath) return [];

  const lower = relPath.toLowerCase();
  if (/AI operation preview only/i.test(result)) {
    const artifactType: AIArtifactSummary['type'] = lower.endsWith('.md')
      ? 'markdown'
      : lower.endsWith('.canvas')
        ? 'canvas'
        : lower.endsWith('.excalidraw')
          ? 'wireframe'
          : /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(lower)
            ? 'image'
            : 'other';
    return [{
      path: relPath,
      type: artifactType,
      action: 'checked',
      qualityStatus: 'checked',
      notes: ['Legacy preview only. No file or task was changed.'],
    }];
  }

  const action: AIArtifactSummary['action'] = toolName === 'copy_image'
    ? 'copied'
    : toolName === 'delete_file'
      ? 'deleted'
    : /written|updated|overwrit/i.test(result)
      ? 'updated'
      : 'created';
  const companionMatch = result.match(/Companion brief:\s*`([^`]+?\.md)`/i)
    || result.match(/Companion brief:\s*(.+?\.md)(?:[.]\s|$)/i);
  const companionArtifact: AIArtifactSummary[] = companionMatch ? [{
    path: String(companionMatch[1]).replace(/\\/g, '/').replace(/^\//, ''),
    type: 'markdown',
    action: 'created',
    qualityStatus: 'checked',
    notes: ['Auto-generated companion brief for reviewing and editing the visual artifact.'],
  }] : [];

  if (toolName === 'delete_file') {
    const recoveryMatch = result.match(/Recovery copy:\s*`([^`]+)`/i);
    const artifactType: AIArtifactSummary['type'] = lower.endsWith('.md')
      ? 'markdown'
      : lower.endsWith('.canvas')
        ? 'canvas'
        : lower.endsWith('.excalidraw')
          ? 'wireframe'
          : /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(lower)
            ? 'image'
            : 'other';
    return [{
      path: relPath,
      type: artifactType,
      action: 'deleted',
      qualityStatus: 'checked',
      notes: [recoveryMatch
        ? `Deleted by AI. Recovery copy: ${recoveryMatch[1]}`
        : 'Deleted by AI. A local recovery snapshot was saved before deletion.'],
    }];
  }

  if (lower.endsWith('.canvas')) {
    return [{
      path: relPath,
      type: 'canvas',
      action,
      qualityStatus: 'auto_fixed',
      notes: [
        '已套用 Canvas 质量修复：长内容拆卡、卡片高度适配、节点避让、分组高度撑开。',
        '适合流程图、任务看板、美术/技术需求板；不再依赖卡片内滚动条阅读。',
      ],
    }, ...companionArtifact];
  }

  if (lower.endsWith('.excalidraw')) {
    return [{
      path: relPath,
      type: 'wireframe',
      action,
      qualityStatus: 'auto_fixed',
      notes: [
        '已套用 Excalidraw 质量修复：文本自动换行、超框扩容、重叠文字避让。',
        '更适合 UI 原型/HUD/界面草图，长需求应拆到 Markdown 文档。',
      ],
    }, ...companionArtifact];
  }

  if (lower.endsWith('.md')) {
    return [{
      path: relPath,
      type: 'markdown',
      action,
      qualityStatus: 'not_applicable',
      notes: ['Markdown 文档已写入，适合承载完整需求、验收标准和制作说明。'],
    }];
  }

  if (/\.(png|jpg|jpeg|webp|gif|svg)$/i.test(lower)) {
    return [{
      path: relPath,
      type: 'image',
      action,
      qualityStatus: 'checked',
      notes: ['图片资源已复制/引用，可在 Markdown 或素材目录中使用。'],
    }];
  }

  return [{
    path: relPath,
    type: 'other',
    action,
    qualityStatus: 'checked',
    notes: ['文件操作已完成。'],
  }];
}

/* ── Vault Scanner for AI Context (v0.9.6) ── */
/* Scans all .md files once, produces both compact index text and full file entries
   for reuse by vault index injection + smart relevance (Layer 2) */

interface VaultFileEntry {
  relPath: string;
  fullPath: string;
  title: string;
  tags: string[];
  content: string;
}

interface VaultScanResult {
  indexText: string;
  fileEntries: VaultFileEntry[];
}

function scanAndIndexVault(vp: string): VaultScanResult {
  const resolved = path.resolve(vp);
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache', '__pycache__', '.ars-note', '.ai-memory']);
  const indexLines: string[] = [];
  const fileEntries: VaultFileEntry[] = [];

  function walk(dir: string, prefix: string): void {
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const item of items) {
      if (SKIP_DIRS.has(item.name) || (item.name.startsWith('.') && item.name !== '.ars-note')) continue;
      const full = path.join(dir, item.name);
      const rel = prefix ? prefix + '/' + item.name : item.name;
      if (item.isDirectory()) {
        walk(full, rel);
      } else if (item.name.endsWith('.md')) {
        try {
          const raw = fs.readFileSync(full, 'utf-8');
          const h1Match = raw.match(/^#\s+(.+)$/m);
          const title = h1Match ? h1Match[1].trim() : item.name.replace('.md', '');
          const tags = [...new Set(raw.match(/(?:^|\s)#[a-zA-Z0-9_\u4e00-\u9fff][\w\u4e00-\u9fff-]*/g) || [])].map(t => t.trim()).slice(0, 5);
          const tagStr = tags.length > 0 ? ' ' + tags.join(' ') : '';
          indexLines.push(rel + ' \u2014 "' + title.slice(0, 60) + '"' + tagStr);
          fileEntries.push({ relPath: rel, fullPath: full, title, tags, content: raw });
        } catch { /* skip unreadable */ }
      }
    }
  }
  walk(resolved, '');

  let indexText = '';
  if (indexLines.length > 0) {
    const capped = indexLines.slice(0, 200);
    indexText = '=== VAULT FILE INDEX (' + capped.length + ' files) ===\n';
    indexText += 'Use read_file(path) to read any file listed below.\n';
    indexText += capped.join('\n');
    if (indexLines.length > 200) indexText += '\n... and ' + (indexLines.length - 200) + ' more files';
  }
  return { indexText, fileEntries };
}


/* ── Smart File Relevance (Layer 2, v0.9.6) ── */
/* Analyzes user query and auto-injects relevant file contents into context.
   This makes AI responses more accurate without requiring explicit read_file calls. */



function findRelevantFiles(entries: VaultFileEntry[], query: string, limit: number): string {
  if (!query || query.length < 4) return '';
  const files = entries;
  if (files.length === 0) return '';

  /* Extract meaningful words from query (skip common stop words) */
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'this',
    'that', 'these', 'those', 'it', 'its', 'and', 'or', 'but', 'not',
    'what', 'which', 'who', 'when', 'where', 'how', 'why', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'because',
    'if', 'then', 'else', 'also', 'there', 'here', 'me', 'my', 'we', 'our',
    'you', 'your', 'he', 'she', 'they', 'them', 'him', 'her', 'his',
    /* Chinese stop words */
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
    '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
    '没有', '看', '好', '自己', '这', '他', '她', '它', '吗', '吧', '呢',
    '什么', '怎么', '哪', '那个', '这个', '能', '让', '把', '被', '从',
    '对', '给', '可以', '还是', '或者', '但是', '因为', '所以', '然后',
    '如果', '关于', '帮我', '帮', '写', '做', '创建', '生成', '一下',
  ]);

  /* Tokenize: split by spaces and also by CJK characters for mixed-language queries */
  const tokens: string[] = [];
  /* Split on whitespace and punctuation */
  const parts = query.toLowerCase().split(/[\s,，。.!！?？、；;：:""''（）()\[\]【】]+/);
  for (const part of parts) {
    if (part.length >= 2 && !stopWords.has(part)) {
      tokens.push(part);
    }
    /* Also extract CJK character sequences (2+ chars) */
    const cjkMatches = part.match(/[\u4e00-\u9fff\u3400-\u4dbf]{2,}/g);
    if (cjkMatches) {
      for (const cjk of cjkMatches) {
        if (!stopWords.has(cjk)) tokens.push(cjk);
      }
    }
  }

  if (tokens.length === 0) return '';

  /* Score each file */
  const scored = files.map(file => {
    let score = 0;
    const fileName = file.relPath.replace('.md', '').toLowerCase();
    const titleLower = file.title.toLowerCase();

    for (const token of tokens) {
      /* File name match (highest relevance) */
      if (fileName.includes(token)) score += 10;
      /* Title match */
      if (titleLower.includes(token)) score += 8;
      /* Tag match */
      for (const tag of file.tags) {
        if (tag.toLowerCase().includes(token)) score += 6;
      }
      /* Content mention (weighted less) */
      const contentLower = file.content.toLowerCase();
      /* Count occurrences but cap at 5 for scoring */
      let count = 0;
      let idx = 0;
      while (count < 5) {
        idx = contentLower.indexOf(token, idx);
        if (idx === -1) break;
        count++;
        idx += token.length;
      }
      score += count * 2;
    }

    return { file, score };
  });

  /* Sort by score and take top matches */
  scored.sort((a, b) => b.score - a.score);
  const relevant = scored.filter(s => s.score >= 6).slice(0, limit);

  if (relevant.length === 0) return '';

  /* Build the context injection */
  const sections: string[] = [];
  sections.push('=== RELEVANT VAULT FILES (auto-loaded for context) ===');
  for (const { file } of relevant) {
    const truncated = file.content.length > 3000
      ? file.content.slice(0, 3000) + '\n...(truncated)'
      : file.content;
    sections.push('--- FILE: ' + file.relPath + ' ---');
    sections.push(truncated);
    sections.push('');
  }

  return sections.join('\n');
}


/* ── Context Window Manager (v0.9.5) ── */
/* For 128K-1M context models: generous limit, only compress when truly needed */
const CTX_CHAR_LIMIT = 500000; /* ~125K tokens — safe for 128K+ context models */

function manageContextWindow(msgs: Array<{ role: string; content: string; tool_calls?: any; tool_call_id?: string }>): Array<{ role: string; content: string; tool_calls?: any; tool_call_id?: string }> {
  /* Calculate total size */
  const totalChars = msgs.reduce((sum, m) => sum + (m.content || '').length, 0);
  if (totalChars <= CTX_CHAR_LIMIT) return msgs;

  /* Split: system (keep) + history (compress) + recent (keep) */
  const system = msgs.filter(m => m.role === 'system');
  const nonSystem = msgs.filter(m => m.role !== 'system');

  /* Keep last 10 messages (5 rounds) fully intact */
  const keepRecent = 10;
  const recent = nonSystem.slice(-keepRecent);
  const older = nonSystem.slice(0, -keepRecent);

  /* Compress older messages: keep first 800 chars per message (preserves most detail) */
  const compressed = older.map(m => {
    const content = m.content || '';
    const shortened = content.length > 800 ? content.slice(0, 800) + '...(compressed)' : content;
    return { ...m, content: shortened };
  });

  return [...system, ...compressed, ...recent];
}

const CANVAS_KEYWORD_RE = /(?:canvas|canva|\u753b\u5e03|\u767d\u677f|\u6d41\u7a0b\u56fe|\u601d\u7ef4\u5bfc\u56fe|\u8111\u56fe|\u770b\u677f|\u5173\u7cfb\u56fe|\u62d3\u6251\u56fe|pipeline|flow\s*chart|flowchart|mind\s*map|kanban|visual\s*board)/i;
const CANVAS_CREATE_INTENT_RE = /(?:\u505a\u6210|\u6574\u7406\u6210|\u8f6c\u6210|\u8f49\u6210|\u751f\u6210|\u521b\u5efa|\u5275\u5efa|\u65b0\u5efa|\u753b(?:\u4e00\u4e2a)?|\u505a\u4e00\u4e2a|\u7528.*(?:\u505a|\u751f\u6210|\u521b\u5efa)|make|create|draw|build|turn\s+.*\s+into)/i;
const WIREFRAME_KEYWORD_RE = /(?:wireframe|mockup|prototype|\bui\b|hud|\u754c\u9762|\u539f\u578b|\u7ebf\u6846\u56fe|\u83dc\u5355|\u4ea4\u4e92|\u6309\u94ae)/i;

function hasStrictCanvasCreationIntent(prompt: string): boolean {
  const text = prompt || '';
  return CANVAS_KEYWORD_RE.test(text) && CANVAS_CREATE_INTENT_RE.test(text);
}

function hasStrictWireframeCreationIntent(prompt: string): boolean {
  const text = prompt || '';
  return WIREFRAME_KEYWORD_RE.test(text) && CANVAS_CREATE_INTENT_RE.test(text);
}

function hasMarkdownRepairIntent(text: string): boolean {
  const prompt = text || '';
  const repairIntent = /(?:\u68c0\u67e5|\u4fee\u590d|\u4fee\u6b63|\u6821\u5bf9|\u89c4\u8303|\u683c\u5f0f\u5316|\u683c\u5f0f|\u6574\u7406|check|fix|repair|format|lint|normalize)/i.test(prompt);
  const markdownTarget = /(?:markdown|\.md\b|\bmd\b|\u6587\u6863|\u6587\u4ef6|\u8868\u683c|\u683c\u5f0f|table|tables|\|---|\|--|\|:-)/i.test(prompt);
  return repairIntent && markdownTarget;
}

function hasHumanizerIntent(text: string): boolean {
  const prompt = text || '';
  return /(?:humanize|de-?ai|ai[-\s]*sounding|robotic|natural(?:ly)?|human(?:\s+voice|\s+written)?|\u53bb\s*AI\s*\u5473|\u53bbai\u5473|\u4e0d\u50cfAI|\u50cf\u4eba\u5199|\u66f4\u81ea\u7136|\u81ea\u7136\u4e00\u70b9|\u6da6\u8272|\u6539\u5199|\u91cd\u5199|\u4eba\u8bdd|\u522b\u592aAI|\u673a\u5668\u5473|\u6587\u98ce)/i.test(prompt);
}

function shouldAutoHumanizeMarkdownWrite(relPath: string, content: string, userText: string): boolean {
  const normalized = normalizeVaultRelativePath(relPath || '').toLowerCase();
  if (!normalized.endsWith('.md')) return false;
  if (normalized.endsWith('.visual.md')) return false;
  if (normalized.startsWith('.ars-note/') || normalized.includes('/.ars-note/')) return false;
  if (!content || !content.trim()) return false;
  if (hasMarkdownRepairIntent(userText)) return false;
  if (/(?:\u4e0d\u8981.*(?:\u6da6\u8272|\u6539\u5199|\u81ea\u7136\u5316)|\u4fdd\u6301\u539f\u6587|\u539f\u6837|verbatim|exact text|do not rewrite|do not humanize)/i.test(userText || '')) return false;
  return true;
}

function autoHumanizeMarkdownContent(content: string): { content: string; changed: boolean; count: number } {
  const lines = String(content || '').split(/\r?\n/);
  let count = 0;
  let inFence = false;
  let fenceMarker = '';
  let inFrontmatter = lines[0]?.trim() === '---';
  let frontmatterClosed = !inFrontmatter;

  const protectSegments = (line: string) => {
    const protectedSegments: string[] = [];
    const text = line.replace(/(`[^`]*`|\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\))/g, (match) => {
      const token = `@@ARSNOTE_PROTECTED_${protectedSegments.length}@@`;
      protectedSegments.push(match);
      return token;
    });
    return {
      text,
      restore: (value: string) => value.replace(/@@ARSNOTE_PROTECTED_(\d+)@@/g, (_m, idx) => protectedSegments[Number(idx)] || _m),
    };
  };

  const replaceTracked = (value: string, pattern: RegExp, replacement: string | ((match: string, ...args: any[]) => string)) => {
    return value.replace(pattern, (...args) => {
      count += 1;
      const match = args[0];
      return typeof replacement === 'function' ? replacement(match, ...args.slice(1)) : replacement;
    });
  };

  const cleanupLine = (line: string) => {
    const protectedLine = protectSegments(line);
    let next = protectedLine.text;
    next = replaceTracked(next, /\bGreat question!?\s*/gi, '');
    next = replaceTracked(next, /\bI hope this helps!?\s*/gi, '');
    next = replaceTracked(next, /\bLet me know if[^.。!！?？]*(?:[.。!！?？]|$)/gi, '');
    next = replaceTracked(next, /\bAs an AI(?: language model)?[,，]?\s*/gi, '');
    next = replaceTracked(next, /\bIt is important to note that\s*/gi, '');
    next = replaceTracked(next, /\bIt'?s important to note that\s*/gi, '');
    next = replaceTracked(next, /\bIt is worth noting that\s*/gi, '');
    next = replaceTracked(next, /\bIn order to\b/gi, 'To');
    next = replaceTracked(next, /\bdue to the fact that\b/gi, 'because');
    next = replaceTracked(next, /\bat this point in time\b/gi, 'now');
    next = replaceTracked(next, /\bserves as an?\b/gi, (match) => /\ban\b/i.test(match) ? 'is an' : 'is a');
    next = replaceTracked(next, /\bserves as\b/gi, 'is');
    next = replaceTracked(next, /\bstands as an?\b/gi, (match) => /\ban\b/i.test(match) ? 'is an' : 'is a');
    next = replaceTracked(next, /\bfunctions as\b/gi, 'is');
    next = replaceTracked(next, /\bacts as an?\b/gi, (match) => /\ban\b/i.test(match) ? 'is an' : 'is a');
    next = replaceTracked(next, /\bboasts\b/gi, 'has');
    next = replaceTracked(next, /\butili[sz]e\b/gi, 'use');
    next = replaceTracked(next, /\bleverage\b/gi, 'use');
    next = replaceTracked(next, /\bdelve into\b/gi, 'look at');
    next = replaceTracked(next, /\bin the realm of\b/gi, 'in');
    next = replaceTracked(next, /\bplays a crucial role in\b/gi, 'helps');
    next = replaceTracked(next, /\bcrucial\b/gi, 'important');
    next = replaceTracked(next, /\brobust\b/gi, 'solid');
    next = replaceTracked(next, /\bseamless\b/gi, 'smooth');
    next = replaceTracked(next, /\bcomprehensive\b/gi, 'complete');
    next = replaceTracked(next, /\bmeticulous\b/gi, 'careful');
    next = replaceTracked(next, /\bvibrant\b/gi, 'lively');
    next = replaceTracked(next, /\bgroundbreaking\b/gi, 'new');
    next = replaceTracked(next, /\btransformative\b/gi, 'major');
    next = replaceTracked(next, /\bparamount\b/gi, 'important');
    next = replaceTracked(next, /\bthe future looks bright\b[.!]?/gi, '');
    next = replaceTracked(next, /\bexciting times lie ahead\b[.!]?/gi, '');
    next = next.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.!?;:，。！？；：])/g, '$1');
    return protectedLine.restore(next);
  };

  const nextLines = lines.map((line, index) => {
    const trimmed = line.trim();
    if (inFrontmatter) {
      if (index > 0 && trimmed === '---') {
        inFrontmatter = false;
        frontmatterClosed = true;
      }
      return line;
    }
    if (!frontmatterClosed && trimmed === '---') {
      inFrontmatter = true;
      return line;
    }
    const fenceStart = trimmed.match(/^(```+|~~~+)/);
    if (fenceStart) {
      const marker = fenceStart[1].slice(0, 3);
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      return line;
    }
    if (inFence) return line;
    if (!trimmed) return line;
    if (trimmed.includes('|')) return line;
    if (/^\s{0,3}(#{1,6}\s*)?$/.test(line)) return line;
    return cleanupLine(line);
  });

  const nextContent = nextLines.join(content.includes('\r\n') ? '\r\n' : '\n');
  return { content: nextContent, changed: nextContent !== content, count };
}

function shouldAutoCreateCanvasFromPrompt(prompt: string): boolean {
  return !hasMarkdownRepairIntent(prompt) && !hasHumanizerIntent(prompt) && hasStrictCanvasCreationIntent(prompt);
}

type AITaskPrimary = 'markdown-spec' | 'markdown-repair' | 'humanize' | 'canvas' | 'wireframe' | 'file-operation' | 'team-operation' | 'direct-answer';

interface AITaskPolicy {
  primary: AITaskPrimary;
  allowCanvas: boolean;
  allowWireframe: boolean;
  allowTeamTools?: boolean;
  allowMutations?: boolean;
  requestedPaths?: string[];
  systemHint: string;
}

function hasWrittenSpecIntent(text: string): boolean {
  return /(?:\u5199|\u6574\u7406|\u6587\u6863|\u8bf4\u660e|\u9700\u6c42|\u7b56\u5212|\u73a9\u6cd5|\u673a\u5236|\u89c4\u5219|\u6570\u503c|\u7ecf\u6d4e|\u6210\u957f|\u8fdb\u5ea6|\u5faa\u73af|\u624b\u611f|\u5173\u5361|\u7cfb\u7edf\u8bbe\u8ba1|\u7f8e\u672f\u9700\u6c42|\u7f8e\u5de5\u9700\u6c42|\u6280\u672f\u9700\u6c42|\u5f00\u53d1\u9700\u6c42|\u89c4\u683c|\u5b8c\u6574\u70b9|\u65b9\u4fbf\u6211\u770b|spec|requirements|requirement\s+doc|production\s+spec|gdd|prd|game\s*design|system\s*design|gameplay|mechanic|economy|progression|balance|balancing|level\s*design)/i.test(text);
}

function hasVisualBoardIntent(text: string): boolean {
  return CANVAS_KEYWORD_RE.test(text);
}

function hasWireframeIntent(text: string): boolean {
  return /(?:wireframe|mockup|prototype|\bui\b|hud|\u754c\u9762|\u539f\u578b|\u83dc\u5355|\u4ea4\u4e92|\u6309\u94ae)/i.test(text);
}

function explicitlyRequestsVisualArtifact(text: string): boolean {
  return /(?:\u505a\u6210|\u751f\u6210|\u753b|\u505a\u4e00\u4e2a|\u521b\u5efa|\u7528.*(?:canvas|canva|\u753b\u5e03|\u6d41\u7a0b\u56fe|\u770b\u677f|\u601d\u7ef4\u5bfc\u56fe)|make\s+(?:a\s+)?(?:canvas|flowchart|wireframe|mockup|kanban|mind\s*map)|create\s+(?:a\s+)?(?:canvas|flowchart|wireframe|mockup|kanban|mind\s*map))/i.test(text);
}

function buildAITaskPolicy(prompt: string, controlMode: AIControlMode = 'readonly'): AITaskPolicy {
  const text = prompt || '';
  const wantsMarkdownRepair = hasMarkdownRepairIntent(text);
  const wantsHumanizer = hasHumanizerIntent(text);
  const wantsSpec = hasWrittenSpecIntent(text);
  const wantsCanvas = hasVisualBoardIntent(text);
  const wantsWireframe = hasWireframeIntent(text);
  const explicitVisual = explicitlyRequestsVisualArtifact(text);
  const explicitCanvas = wantsCanvas && hasStrictCanvasCreationIntent(text);

  let primary: AITaskPrimary = 'direct-answer';
  if (wantsMarkdownRepair && !explicitCanvas) {
    primary = 'markdown-repair';
  } else if (wantsHumanizer && !explicitCanvas) {
    primary = 'humanize';
  } else if (wantsSpec && !explicitCanvas) {
    primary = 'markdown-spec';
  } else if (explicitCanvas) {
    primary = 'canvas';
  } else if (wantsWireframe && explicitVisual && !wantsSpec) {
    primary = 'wireframe';
  }

  const allowCanvas = primary === 'canvas';
  const allowWireframe = primary === 'wireframe';
  const lines = [
    '=== Ars-note AI Task Policy ===',
    `Primary deliverable: ${primary}`,
    `Canvas tool allowed: ${allowCanvas ? 'yes' : 'no'}`,
    `Wireframe tool allowed: ${allowWireframe ? 'yes' : 'no'}`,
    `AI control mode: ${aiControlModeLabel(controlMode)} (${controlMode})`,
    controlMode === 'readonly'
      ? 'Mode rule: only analyze and read. Do not attempt to write, delete, create, apply confirmations, or update team schedules.'
    : controlMode === 'member'
        ? 'Mode rule: ordinary file changes are allowed immediately when the user asks, but team-wide production schedule/bootstrap/doc-refresh tools are not available.'
        : 'Mode rule: producer-level team schedule and production-flow tools are available immediately when the user asks.',
    'Safety mode: read tools may run immediately; write/delete/create/task-update tools also run immediately in execution modes. The app records live-history, AI trash, and rollback snapshots automatically.',
    'Sync recovery rule: when the user asks to repair old sync data, missing GDD/worldbuilding files, conflict copies, or stale overwrites, call read_sync_recovery_advisor first, then apply_sync_recovery_advisor_plan when they ask you to repair/apply it.',
    'Do not ask the user to copy a confirmation token. If the user clearly asks you to write, delete, create, repair, or take over production flow, use the appropriate tool directly.',
  ];

  if (primary === 'markdown-repair') {
    lines.push(
      'The user is asking to inspect or repair an existing Markdown document. Use read_file on the target .md file, fix only the requested Markdown/table formatting, then write_file back to the same Markdown file.',
      'Do not create Canvas, Excalidraw, workspace summaries, visual briefs, companion .visual.md files, or team production docs for Markdown/table repair tasks.',
      'For table-format repair, keep content unchanged except row breaks, separator rows, alignment markers, escaped pipes, and malformed compressed table layout.'
    );
  } else if (primary === 'humanize') {
    lines.push(
      'The user is asking to humanize, polish, rewrite, or remove AI-sounding patterns from text. Use selected text first if provided; otherwise use the current note or referenced .md file.',
      'Preserve meaning, facts, canon, Markdown structure, frontmatter, wiki-links, tables, code blocks, task IDs, acceptance criteria, and production details.',
      'If applying changes to a file, use read_file on the target .md file and write_file back to the same Markdown file. Do not create Canvas, Excalidraw, workspace summaries, visual briefs, companion .visual.md files, or team production docs.'
    );
  } else if (primary === 'markdown-spec') {
    lines.push(
      'The user is asking for a written production document. Use polished Markdown and do not create Canvas or Excalidraw artifacts.',
      'For game/UI/art/technical requirements, include: design intent, player fantasy, goals/non-goals, core loop, mechanic rules, progression/economy, balance knobs, art requirements, technical requirements, data/config fields, interaction states, QA/telemetry, acceptance criteria, risks, open questions, and next actions.',
      'If the user references an existing UI prototype, canvas, or current file, read the relevant file first and extract requirements from it.'
    );
  } else if (primary === 'canvas') {
    lines.push(
      'The user explicitly wants a visual planning board. Use create_canvas with a title card, legend, grouped lanes, readable cards, and connected dependencies.',
      'Never put dense paragraphs in one card. Split long content into multiple connected cards.',
      'Treat the canvas as a high-level map. Put production details, acceptance criteria, and implementation notes in Markdown.'
    );
  } else if (primary === 'wireframe') {
    lines.push(
      'The user explicitly wants a UI prototype/wireframe. Use create_wireframe with 1-3 focused screens and short labels that fit inside boxes.',
      'Put detailed requirements in Markdown, not inside tiny wireframe labels.',
      'Prefer realistic layout regions, states, and component names over dense explanatory text.'
    );
  } else {
    lines.push('Answer directly unless the user explicitly asks you to create or edit a file.');
  }

  return {
    primary,
    allowCanvas,
    allowWireframe,
    systemHint: lines.join('\n'),
  };
}

function getAIFileToolsForPolicy(policy: AITaskPolicy, controlMode: AIControlMode): typeof AI_FILE_TOOLS {
  return AI_FILE_TOOLS.filter((tool: any) => {
    const name = tool?.function?.name;
    if (!isAIToolAllowedInMode(name, controlMode)) return false;
    if (policy.primary === 'direct-answer' && isAIToolMutationName(name)) return false;
    if (['bootstrap_team_workspace', 'draft_narrative_tasks', 'sync_team_task_docs', 'upsert_team_tasks', 'generate_team_production_docs'].includes(name) && !policy.allowTeamTools) return false;
    if (policy.primary === 'markdown-repair' || policy.primary === 'humanize') {
      return name === 'read_file' || name === 'write_file' || name === 'list_files';
    }
    if (name === 'create_canvas') return policy.allowCanvas;
    if (name === 'create_wireframe') return policy.allowWireframe;
    return true;
  });
}

function appendAIAutomatedVerification(
  vaultPath: string,
  toolName: string,
  args: Record<string, string>,
  result: string,
): string {
  if (!result || /^Error:/i.test(result)) return result;

  const checks: string[] = [];
  const inspectPath = (relativePath: string, expected: 'present' | 'deleted') => {
    const normalized = normalizeVaultRelativePath(relativePath || '');
    if (!normalized) return;
    try {
      const absolutePath = resolveVaultRelativePath(vaultPath, normalized);
      const exists = fs.existsSync(absolutePath);
      if (expected === 'deleted') {
        checks.push(`${normalized}: ${exists ? 'FAILED (still exists)' : 'verified deleted'}`);
        return;
      }
      if (!exists) {
        checks.push(`${normalized}: FAILED (missing after operation)`);
        return;
      }
      const stat = fs.statSync(absolutePath);
      if (stat.isFile()) {
        const digest = crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex').slice(0, 12);
        checks.push(`${normalized}: verified file, ${stat.size} bytes, sha256 ${digest}`);
      } else {
        checks.push(`${normalized}: verified folder`);
      }
    } catch (err: any) {
      checks.push(`${normalized}: verification failed (${err?.message || 'unknown error'})`);
    }
  };

  if (['write_file', 'append_file', 'create_canvas', 'create_wireframe', 'create_folder'].includes(toolName)) {
    inspectPath(String(args.path || ''), 'present');
  } else if (toolName === 'delete_file') {
    inspectPath(String(args.path || ''), 'deleted');
  } else if (toolName === 'delete_files') {
    for (const relativePath of parseAIDeleteFilePaths(args, 50)) inspectPath(relativePath, 'deleted');
  } else if (['bootstrap_team_workspace', 'draft_narrative_tasks', 'sync_team_task_docs', 'upsert_team_tasks', 'generate_team_production_docs'].includes(toolName)) {
    inspectPath(`${TEAM_SCHEDULE_DIR}/${TEAM_SCHEDULE_FILE}`, 'present');
  }

  if (checks.length === 0) return result;
  return `${result}\n\n[Automatic verification]\n${checks.map(check => `- ${check}`).join('\n')}`;
}

async function handleDirectAIOperationCommand(vaultPath: string, text: string, safety: AIToolSafetyContext): Promise<any | null> {
  const tokens = Array.from(safety.confirmedTokens);
  if (tokens.length === 0) return null;

  const wantsCancel = /(cancel|reject|discard|取消|拒绝|不要|作废)/i.test(text);
  let wantsApply = /(confirm|apply|execute|run|approve|确认|执行|应用|同意|批准)/i.test(text);
  if (!wantsCancel && !wantsApply) wantsApply = true;

  const toolCalls: AIToolCallLog[] = [];
  const lines: string[] = [];
  for (const token of tokens) {
    const record = readAIPendingOperation(vaultPath, token);
    if (!record) {
      const result = `Error: Pending AI operation not found or expired: ${token}`;
      lines.push(result);
      toolCalls.push({ name: wantsCancel ? 'cancel_ai_operation' : 'apply_ai_operation', args: { token }, result });
      continue;
    }

    if (wantsCancel && !wantsApply) {
      const result = await executeAITool(vaultPath, 'cancel_ai_operation', { token }, safety);
      lines.push(result);
      toolCalls.push({ name: 'cancel_ai_operation', args: { token }, result });
      continue;
    }

    const result = await executeAITool(vaultPath, 'apply_ai_operation', { token }, safety);
    lines.push(`Applied ${token} (${record.toolName}):\n${result}`);
    toolCalls.push({
      name: 'apply_ai_operation',
      args: { token },
      result,
      artifacts: inferAIArtifactsFromTool(record.toolName, record.args, result),
    });
  }

  return {
    ok: true,
    content: lines.join('\n\n'),
    toolCalls,
    createdAt: new Date().toISOString(),
  };
}

ipcMain.handle('ai:sendChat', async (_e, vaultPath: string, messages: Array<{ role: string; content: string }>, options?: { controlMode?: string }) => {
  const resolved = path.resolve(vaultPath);
  const cfg = aiCredentialsMap.get(resolved);
  if (!cfg || !cfg.baseUrl) return { ok: false, error: 'AI not configured', createdAt: new Date().toISOString() };
  try { FP.initMemorySystem(resolved); } catch {}
  const fpc = FP.buildFivePillarContext(resolved);

  /* Scan vault once: produces both index text and file entries (v0.9.6) */
  const vaultScan = scanAndIndexVault(resolved);

  /* Smart file relevance (Layer 2, v0.9.6) — find files matching user's query */
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const controlMode = normalizeAIControlMode(options?.controlMode);
  const taskPolicy = buildAITaskContract(lastUserMsg?.content || '', controlMode);
  const policyTools = getAIFileToolsForPolicy(taskPolicy, controlMode);
  const relevantCtx = lastUserMsg ? findRelevantFiles(vaultScan.fileEntries, lastUserMsg.content, 3) : '';
  const aiToolSafety: AIToolSafetyContext = {
    lastUserText: lastUserMsg?.content || '',
    confirmedTokens: extractAIConfirmedTokens(lastUserMsg?.content || ''),
    controlMode,
  };
  const directAiOperation = await handleDirectAIOperationCommand(resolved, lastUserMsg?.content || '', aiToolSafety);
  if (directAiOperation) return directAiOperation;

  /* Inject into system prompt: Five Pillar context + Vault Index + Relevant Files */
  if (messages.length > 0 && messages[0].role === 'system') {
    let sysContent = messages[0].content;
    if (fpc) sysContent += '\n\n' + fpc;
    if (vaultScan.indexText) sysContent += '\n\n' + vaultScan.indexText;
    if (relevantCtx) sysContent += '\n\n' + relevantCtx;
    // Keep the task contract and Ars-note identity after all retrieved context.
    sysContent += '\n\n' + taskPolicy.systemHint;
    messages = [{ ...messages[0], content: sysContent }, ...messages.slice(1)];
  }

  try { FP.consolidateMemory(resolved); } catch {}
  const toolCallsLog: AIToolCallLog[] = [];
  let cur = [...messages]; let ts = true;
  try {
    for (let r = 0; r <= 8; r++) {
      const url = cfg.provider === 'ollama' ? cfg.baseUrl + '/api/chat' : cfg.baseUrl + '/chat/completions';
      const h: Record<string, string> = { 'Content-Type': 'application/json' };
      if (cfg.apiKey) h['Authorization'] = 'Bearer ' + cfg.apiKey;
      /* Apply context window management before sending (v0.9.5) */
      const managedCur = manageContextWindow(cur);
      const b = cfg.provider === 'ollama'
        ? JSON.stringify({ model: cfg.model, messages: managedCur, stream: false, ...(ts ? { tools: policyTools } : {}) })
        : JSON.stringify({ model: cfg.model, messages: managedCur, max_tokens: 8192, temperature: 0.55, ...(ts ? { tools: policyTools } : {}) });
      let res: Response;
      try { res = await fetch(url, { method: 'POST', headers: h, body: b, signal: AbortSignal.timeout(300000) }); }
      catch (fe: any) {
        if (ts && r === 0) { ts = false; const pb = cfg.provider === 'ollama' ? JSON.stringify({ model: cfg.model, messages: cur, stream: false }) : JSON.stringify({ model: cfg.model, messages: cur, max_tokens: 8192, temperature: 0.55 }); res = await fetch(url, { method: 'POST', headers: h, body: pb, signal: AbortSignal.timeout(300000) }); } else throw fe;
      }
      if (!res.ok) { const et = await res.text().catch(() => ''); const se = et.replace(/Bearer\s+\S+/gi, 'Bearer ***'); return { ok: false, error: 'HTTP ' + res.status + ': ' + se.slice(0, 300), toolCalls: toolCallsLog, createdAt: new Date().toISOString() }; }
      const raw = await res.json(); let ct = ''; let rm = cfg.model; let tc: any[] = [];
      if (cfg.provider === 'ollama') { ct = (raw as AIChatOllamaResponse).message?.content || ''; rm = (raw as AIChatOllamaResponse).model || cfg.model; tc = (raw as AIChatOllamaResponse).message?.tool_calls || []; }
      else {
        const rawMsg = (raw as any).choices?.[0]?.message || {};
        ct = rawMsg.content || ''; rm = (raw as AIChatOpenAIResponse).model || cfg.model; tc = rawMsg.tool_calls || [];
        /* DeepSeek thinking mode: preserve reasoning_content for subsequent turns */
        if (rawMsg.reasoning_content) {
          cur.push({ role: 'assistant', content: ct || '', reasoning_content: rawMsg.reasoning_content, tool_calls: tc.length > 0 ? tc : undefined } as any);
        }
      }
      if (!tc || tc.length === 0) {
        /* No tool calls — final response. Push assistant msg if not already pushed (non-DeepSeek case) */
        const rawMsg = (raw as any).choices?.[0]?.message;
        if (!rawMsg?.reasoning_content) {
          cur.push({ role: 'assistant', content: ct || '' });
        }

        /* ── Auto-detect canvas-worthy responses ── */
        /* If user asked for visual content (流程图/思维导图/看板 etc.) but AI just returned text,
           auto-convert the text response into a .canvas file as a bonus */
        if (lastUserMsg && ct && toolCallsLog.length === 0) {
          if (taskPolicy.primary === 'canvas' && taskPolicy.allowCanvas && shouldAutoCreateCanvasFromPrompt(lastUserMsg.content)) {
            try {
              const autoCanvas = normalizeAICanvasData(markdownToCanvas(ct));
              if (autoCanvas.nodes.length >= 2) {
                /* Generate a meaningful file name from user message */
                const nameHint = lastUserMsg.content.slice(0, 30).replace(/[^\w\u4e00-\u9fff-]/g, '').slice(0, 20) || 'AutoCanvas';
                const cvPath = `01_GDD/${nameHint}.canvas`;
                const nextContent = JSON.stringify(autoCanvas, null, 2);
                const quality = analyzeCanvasQuality(autoCanvas);
                const autoResult = controlMode === 'readonly'
                  ? 'Skipped writing canvas because AI is in read-only analysis mode.'
                  : await executeAITool(resolved, 'write_file', { path: cvPath, content: nextContent }, aiToolSafety);
                toolCallsLog.push({
                  name: controlMode === 'readonly' ? 'auto_create_canvas_skipped' : 'auto_create_canvas',
                  args: { path: cvPath },
                  result: autoResult,
                });

                /* Append canvas preview info to the response */
                ct += controlMode === 'readonly'
                  ? `\n\n---\nI prepared a canvas plan for \`${cvPath}\` (${autoCanvas.nodes.length} cards, ${autoCanvas.edges.length} connections, quality ${quality.score}/100), but did not write it because AI is in read-only mode.\n\n${autoResult}`
                  : `\n\n---\nCanvas file created: \`${cvPath}\` (${autoCanvas.nodes.length} cards, ${autoCanvas.edges.length} connections, quality ${quality.score}/100).\n\n${autoResult}`;
              }
            } catch { /* auto-conversion failed, just return the text */ }
          }
        }

        return { ok: true, content: ct, model: rm, toolCalls: toolCallsLog, createdAt: new Date().toISOString() };
      }
      /* Only push tool-calling assistant msg if not already pushed above (DeepSeek reasoning case) */
      if (!(raw as any).choices?.[0]?.message?.reasoning_content) {
        cur.push({ role: 'assistant', content: ct || "", tool_calls: tc } as any);
      }
      for (const t of tc) {
        const fn = t.function?.name; let fa: Record<string, string>;
        try { const a = t.function?.arguments || '{}'; fa = typeof a === 'string' ? JSON.parse(a) : a; } catch { fa = {}; }
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('ai:tool-progress', { name: fn, args: fa, status: 'running' });
        let result: string;
        const policyDecision = evaluateAIToolCall(taskPolicy, fn, fa, toolCallsLog);
        if (!policyDecision.allowed) {
          result = `Error: Tool blocked by task contract: ${policyDecision.reason || 'unrelated to the user request'}`;
        } else {
          try {
            result = await executeAITool(vaultPath, fn, fa, aiToolSafety);
          } catch (err: any) {
            result = `Error: ${err?.message || 'Tool execution failed'}`;
          }
        }
        result = appendAIAutomatedVerification(vaultPath, fn, fa, result);
        toolCallsLog.push({ name: fn, args: fa, result, artifacts: inferAIArtifactsFromTool(fn, fa, result) });
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('ai:tool-progress', { name: fn, args: fa, status: 'done' });
        const tm: any = { role: 'tool', content: result }; if (t.id) tm.tool_call_id = t.id; cur.push(tm);
      }
    }
    return { ok: true, content: 'Tool execution completed.', toolCalls: toolCallsLog, createdAt: new Date().toISOString() };
  } catch (err: any) {
    return { ok: false, error: (err.message || 'Request failed').replace(/Bearer\s+\S+/gi, 'Bearer ***'), toolCalls: toolCallsLog, createdAt: new Date().toISOString() };
  } finally {
    try { FP.saveConversation(resolved, cur); } catch {}
    if (toolCallsLog.length > 0) try {
      const um = messages.find((m: any) => m.role === 'user');
      if (um) {
        FP.createSkill(resolved, { name: 'auto-' + Date.now().toString(36), trigger: um.content.slice(0, 100), description: 'Auto: ' + um.content.slice(0, 60), steps: 'Tools: ' + toolCallsLog.map(tc => tc.name).join(', ') + '\n' + toolCallsLog.map(tc => '- ' + tc.name + ': ' + tc.result.slice(0, 100)).join('\n') });
        scheduleAiMemorySync(resolved);
      }
    } catch {}
  }
});

/* ═══════════════════════════════════════════════════
   Live Sync — Real-time WebSocket vault sync (v1.0.0)
   ═══════════════════════════════════════════════════ */

const REQUIRED_LIVE_SYNC_SERVER_CAPABILITIES = [
  { key: 'livePersistence', label: 'server live-file snapshots', critical: true },
  { key: 'liveHistory', label: 'server live-history restore', critical: true },
  { key: 'serverSnapshotProofProtection', label: 'server snapshot write-proof protection', critical: true },
  { key: 'rebuildPreWriteSnapshots', label: 'server rebuild pre-write snapshots', critical: true },
  { key: 'serverRestoreMetadataBroadcast', label: 'server restore metadata broadcast', critical: true },
  { key: 'staleWriteProtection', label: 'stale-write protection', critical: true },
  { key: 'missingBaseProtection', label: 'missing-base protection', critical: true },
  { key: 'deletedTombstoneProtection', label: 'deleted-tombstone protection', critical: true },
  { key: 'tombstoneRetention30Days', label: '30-day tombstone retention', critical: true },
  { key: 'prunedTombstoneHistoryProtection', label: 'pruned-tombstone history protection', critical: true },
  { key: 'deleteStormProtection', label: 'delete-storm protection', critical: true },
  { key: 'destructiveTruncationProtection', label: 'destructive-truncation protection', critical: true },
  { key: 'vaultIdentityAutoResolve', label: 'vault identity auto-resolve', critical: true },
  { key: 'atomicLivePersistence', label: 'atomic live-file persistence', critical: true },
  { key: 'crashRecoveryJournal', label: 'crash-recovery transaction journal', critical: true },
  { key: 'serializedVaultWrites', label: 'serialized per-Vault writes', critical: true },
  { key: 'startupStorageReadiness', label: 'storage-ready startup gate', critical: true },
  { key: 'metadataOnlySnapshots', label: 'metadata-only reconnect snapshots', critical: true },
  { key: 'serverDataSnapshots', label: 'server full snapshots', critical: false },
  { key: 'serverSnapshotFileRestore', label: 'server snapshot file restore', critical: false },
  { key: 'liveSyncClientHistory', label: 'live-sync client history', critical: false },
  { key: 'liveSyncClientEvents', label: 'live-sync accident event log', critical: false },
  { key: 'aiMemorySync', label: 'AI memory sync', critical: false },
  { key: 'teamProductionStatus', label: 'team production status', critical: false },
] as const;

function getLiveSyncServerSafetyCompatibility(server: any): {
  ok: boolean;
  reported: boolean;
  missing: string[];
  missingCritical: string[];
  required: string[];
  labels: Record<string, string>;
} {
  const capabilities = server?.capabilities;
  const reported = !!capabilities && typeof capabilities === 'object';
  const labels = Object.fromEntries(REQUIRED_LIVE_SYNC_SERVER_CAPABILITIES.map((item) => [item.key, item.label]));
  const missing = REQUIRED_LIVE_SYNC_SERVER_CAPABILITIES
    .filter((item) => !reported || capabilities[item.key] !== true)
    .map((item) => item.key);
  const missingCritical = REQUIRED_LIVE_SYNC_SERVER_CAPABILITIES
    .filter((item) => item.critical && (!reported || capabilities[item.key] !== true))
    .map((item) => item.key);

  return {
    ok: reported && missingCritical.length === 0,
    reported,
    missing,
    missingCritical,
    required: REQUIRED_LIVE_SYNC_SERVER_CAPABILITIES.map((item) => item.key),
    labels,
  };
}

function liveSyncAuthHeadersForConfig(vaultPath: string, apiKey?: string): Record<string, string> {
  const key = String(apiKey || '').trim();
  return key ? { Authorization: 'Bearer ' + key } : selfHostedAuthHeaders(vaultPath);
}

async function fetchLiveSyncServerSafetyCompatibility(vaultPath: string, serverUrl: string, vaultId: string, apiKey?: string): Promise<{
  ok: boolean;
  detail: string;
  serverVersion?: string;
  status?: any;
  compatibility?: ReturnType<typeof getLiveSyncServerSafetyCompatibility>;
}> {
  const endpoint = liveSyncEndpointFromUrl(serverUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response: any;
  let data: any;
  try {
    response = await fetch(endpoint + '/api/live-sync/status?vaultId=' + encodeURIComponent(vaultId) + '&summary=0', {
      headers: vaultPath ? liveSyncAuthHeadersForConfig(vaultPath, apiKey) : {},
      signal: controller.signal,
    });
    data = await response.json() as any;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok || !data?.ok) {
    return { ok: false, detail: data?.error || `server status failed: HTTP ${response.status}` };
  }
  const compatibility = getLiveSyncServerSafetyCompatibility(data);
  const missingLabels = compatibility.missing.map((key) => compatibility.labels[key] || key);
  return {
    ok: compatibility.ok,
    serverVersion: data.serverVersion || data.version || '',
    status: data,
    compatibility,
    detail: compatibility.ok
      ? `server v${data.serverVersion || data.version || '-'} reports required safety capabilities`
      : compatibility.reported
        ? `server v${data.serverVersion || data.version || '-'} is missing: ${missingLabels.join(', ')}`
      : `server v${data.serverVersion || data.version || '-'} does not report safety capabilities; update the NAS server folder`,
  };
}

async function requireLiveSyncServerSafetyBeforeStart(vaultPath: string, config: LiveSyncConfig): Promise<{
  ok: boolean;
  error?: string;
  safety?: Awaited<ReturnType<typeof fetchLiveSyncServerSafetyCompatibility>>;
}> {
  if (!config.enabled || !config.serverUrl) return { ok: true };
  if (process.env.ARS_NOTE_ALLOW_UNSAFE_LIVE_SYNC === '1') {
    return { ok: true };
  }
  try {
    const safety = await fetchLiveSyncServerSafetyCompatibility(vaultPath, config.serverUrl, config.vaultId || '', config.apiKey);
    if (safety.ok) return { ok: true, safety };
    return {
      ok: false,
      safety,
      error: [
        '实时同步已被安全检查拦截：服务器缺少关键防事故能力。',
        safety.detail,
        '请把最新 server 文件夹覆盖到 NAS 容器并重启后再连接，避免旧电脑覆盖新文件。',
      ].filter(Boolean).join(' '),
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `实时同步启动前无法完成服务器安全检查：${err?.message || err || 'unknown error'}。为避免旧数据覆盖，已拒绝连接。`,
    };
  }
}

function compareRuntimeVersions(left: unknown, right: unknown): number | null {
  const parse = (value: unknown): number[] | null => {
    const clean = String(value || '').trim().replace(/^v/i, '');
    const match = clean.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) return null;
    return [match[1], match[2] || '0', match[3] || '0'].map((part) => Number(part));
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

function buildLiveSyncLaunchReadiness(
  local: any,
  server: any,
  serverError = '',
  diagnosticWarning = '',
  options: { preConnect?: boolean } = {},
): any {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const actions: string[] = [];
  const clients = Array.isArray(server?.clientHistory) && server.clientHistory.length > 0
    ? server.clientHistory
    : (Array.isArray(server?.clients) ? server.clients : []);
  const onlineClients = clients.filter((client: any) => String(client?.webSocketStatus || 'online') !== 'offline');
  const onlineClientCount = typeof server?.vaultClients === 'number'
    ? server.vaultClients
    : onlineClients.length;
  const serverVersion = String(server?.serverVersion || server?.version || '');
  /* Desktop and server releases are compatible by protocol/capabilities, not matching SemVer. */
  const versionCompare: number | null = serverVersion ? 0 : null;
  const connectionMode = normalizeLiveSyncConnectionMode(local?.connectionMode || server?.connectionMode || 'join');

  if (!local?.serverUrl) {
    blockers.push('Live Sync server URL is not configured.');
    actions.push('填写 NAS/Tailscale 的同步服务器地址后再连接。');
  }
  if (serverError) {
    blockers.push(`Server HTTP health check failed: ${serverError}`);
    actions.push('先确认 NAS 容器正在运行，并且当前网络能访问同步服务器 HTTP/API。');
  }
  if (local?.serverUrl && !local?.connected && !options.preConnect) {
    warnings.push('Live Sync is not connected on this computer yet. Click Connect; if it keeps reconnecting, check the WebSocket route.');
    actions.push('先点“连接”，并确认 /ws/live-sync 没有被节点/反代拦截。');
  } else if (local?.serverUrl && !local?.connected && options.preConnect) {
    warnings.push('WebSocket will be verified immediately after connecting.');
  }
  if (local?.lastError) {
    warnings.push(`Previous local Live Sync error: ${local.lastError}`);
  }
  if (local?.uploadFrozen) {
    warnings.push(`Unsafe local uploads are paused in the background: ${local.uploadFrozenReason || 'waiting for server snapshot'}. Server/current files can still sync.`);
    actions.push('Ars-note keeps old local writes in recovery instead of uploading them over the server timeline.');
  }
  if (Number(local?.preflightBlockedUploadCount || 0) > 0) {
    warnings.push(`Safety preflight protected ${local.preflightBlockedUploadCount} local-only upload(s) without a server baseline.`);
    actions.push('Protected local-only files stay in Sync Recovery Center; they do not block joining the server.');
  }
  const recoveryRisk = local?.recoveryRisk;
  const localConflictCount = Number(recoveryRisk?.conflictCount || 0);
  const localDeletedSnapshotCount = Number(recoveryRisk?.deletedSnapshotCount || 0);
  const localOverwriteHistoryCount = Number(recoveryRisk?.overwriteHistoryCount || 0);
  const localAiTrashCount = Number(recoveryRisk?.aiTrashCount || 0);
  const autoArchivedConflictCount = Number(local?.autoArchivedConflicts?.archivedCount || 0);
  const autoRecoveryReportPath = String(local?.autoRecoveryReport?.reportRelativePath || '');
  if (recoveryRisk?.error) {
    warnings.push(`Local sync recovery scan failed: ${recoveryRisk.error}`);
    actions.push('Open Sync Recovery Center and run a manual recovery scan before trusting multi-computer sync.');
  }
  if (autoArchivedConflictCount > 0) {
    warnings.push(`Ars-note moved ${autoArchivedConflictCount} legacy conflict copy/copies into Sync Recovery Center before connecting.`);
    actions.push(autoRecoveryReportPath
      ? `Review the preflight recovery report if anything looks missing: ${autoRecoveryReportPath}.`
      : 'Open Sync Recovery Center if anything looks missing; no document file was overwritten automatically.');
  }
  if (localConflictCount > 0) {
    const files = Array.isArray(recoveryRisk?.conflictFiles) ? recoveryRisk.conflictFiles.slice(0, 4).join(', ') : '';
    warnings.push(`Local vault has ${localConflictCount} conflict recovery copy/copies${files ? `: ${files}` : ''}.`);
    actions.push('Conflict copies are kept for manual review in Sync Recovery Center and no longer block Live Sync.');
  }
  if (Number(recoveryRisk?.hiddenRecoveryConflictCount || 0) > 0) {
    warnings.push(`Sync Recovery Center contains ${Number(recoveryRisk.hiddenRecoveryConflictCount)} protected conflict backup(s). They are kept for restore and do not block Live Sync.`);
  }
  if (localDeletedSnapshotCount > 0) {
    warnings.push(`Local live-history has ${localDeletedSnapshotCount} recent delete snapshot(s) that may need review.`);
    actions.push('Review recent delete snapshots in Sync Recovery Center if any file looks missing.');
  }
  if (localOverwriteHistoryCount > 0) {
    warnings.push(`Local live-history has ${localOverwriteHistoryCount} recent overwrite/sync recovery record(s).`);
  }
  if (localAiTrashCount > 0) {
    warnings.push(`AI trash has ${localAiTrashCount} recoverable file(s).`);
  }
  if (server?.vaultIdentity?.ok && server.vaultIdentity.exactMatch === false) {
    blockers.push(`Server does not contain the current Vault ID: ${server.vaultIdentity?.query?.vaultId || local?.vaultId || '-'}.`);
    actions.push('从服务器 /admin 复制正确 Vault ID，不要只输入显示名称。');
  }
  if (
    server?.vaultIdentity?.ok
    && server.vaultIdentity.exactMatch === true
    && server.vaultIdentity.duplicateNameRisk
    && server.vaultIdentity.currentIsRecommended === false
  ) {
    const recommendedVaultId = server.vaultIdentity.recommendedVaultId || '-';
    const reason = server.vaultIdentity.recommendedReason || 'more complete server timeline';
    blockers.push(`Current Vault ID is a same-name duplicate and is not the recommended main Vault. Use Vault ID ${recommendedVaultId}.`);
    actions.push(`Switch this computer to the recommended Vault ID ${recommendedVaultId} (${reason}) before joining Live Sync.`);
  }
  if (server?.safetyCompatibility && !server.safetyCompatibility.ok) {
    const compatibility = server.safetyCompatibility;
    const missing = (Array.isArray(compatibility.missingCritical) && compatibility.missingCritical.length > 0
      ? compatibility.missingCritical
      : compatibility.missing || [])
      .map((key: string) => compatibility.labels?.[key] || key)
      .slice(0, 6)
      .join(', ');
    blockers.push(`Server is missing required sync safety capabilities: ${missing || '-'}.`);
    actions.push('覆盖上传最新 server 文件夹到 NAS，并重启 Docker 容器。');
  }

  if (server?.vaultIdentity?.duplicateNameRisk) {
    warnings.push('Server has duplicate or same-name Vault candidates. Use exact Vault ID only.');
  }
  if (serverVersion && versionCompare !== null && versionCompare !== 0) {
    warnings.push(`Desktop v${APP_VERSION} and server v${serverVersion} are different.`);
    actions.push('尽量让两台电脑客户端和 NAS server 使用同一版本。');
  } else if (!serverVersion && server?.ok) {
    warnings.push('Server version is unknown.');
  }
  if (onlineClientCount < 2) {
    warnings.push(`Only ${onlineClientCount || 0} online client(s) are visible for this Vault. Two-computer real-time verification is not complete.`);
    actions.push('让另一台电脑连接同一个 Vault ID 后重新刷新健康检查。');
  }
  const latencyMs = Number(local?.latencyMs);
  if (Number.isFinite(latencyMs) && latencyMs > 10000) {
    warnings.push(`Live Sync latency is high (${Math.round(latencyMs)} ms). Real-time sync may feel unstable.`);
    actions.push('优先使用 Tailscale/内网地址，少用不稳定的中转链接。');
  } else if (Number.isFinite(latencyMs) && latencyMs > 3000) {
    warnings.push(`Live Sync latency is elevated (${Math.round(latencyMs)} ms).`);
  }
  if (diagnosticWarning) {
    warnings.push(diagnosticWarning);
  }

  const riskyOnlineClients = onlineClients.filter((client: any) =>
    client?.safetyLevel === 'danger'
    || client?.versionStatus === 'old'
    || client?.protocolStatus === 'old'
    || !!client?.lastRejectedReason
  );
  const warningOnlineClients = onlineClients.filter((client: any) =>
    !riskyOnlineClients.includes(client)
    && (client?.safetyLevel === 'warning' || client?.versionStatus === 'unknown' || client?.protocolStatus === 'unknown')
  );
  if (riskyOnlineClients.length > 0) {
    const labels = riskyOnlineClients
      .map((client: any) => `${client.deviceName || client.deviceId || client.clientId || 'unknown'}${client.appVersion ? ` v${client.appVersion}` : ''}`)
      .slice(0, 4)
      .join(', ');
    warnings.push(`Older or protected client(s) are online: ${labels}. Server-side protection will reject unsafe old writes, but Live Sync can continue.`);
    actions.push('先升级/重连这些设备，确认没有旧客户端在线写入。');
  }
  if (warningOnlineClients.length > 0) {
    const labels = warningOnlineClients
      .map((client: any) => `${client.deviceName || client.deviceId || client.clientId || 'unknown'}${client.appVersion ? ` v${client.appVersion}` : ''}`)
      .slice(0, 4)
      .join(', ');
    warnings.push(`Some online client(s) need attention: ${labels}.`);
  }

  const recentRejected = Array.isArray(server?.clientEvents)
    ? server.clientEvents.filter((event: any) => event?.eventType === 'file-rejected').slice(0, 5)
    : [];
  if (recentRejected.length > 0) {
    warnings.push(`Server recently rejected ${recentRejected.length} unsafe write(s).`);
  }

  const status = blockers.length > 0
    ? 'blocked'
    : (warnings.length > 0 && connectionMode === 'rebuild' ? 'warning' : 'ready');
  const summary = status === 'ready'
    ? '可以同步：服务器安全能力和 Vault ID 已通过；旧本地差异会留在恢复中心，不会自动覆盖服务器。'
    : status === 'warning'
      ? '可以谨慎同步，但上线前建议处理这些警告。'
      : '先不要开始/继续同步：存在可能导致旧数据覆盖或连接不完整的风险。';

  return {
    status,
    summary,
    clientVersion: APP_VERSION,
    serverVersion,
    onlineClientCount,
    checkedAt: new Date().toISOString(),
    blockers,
    warnings: Array.from(new Set(warnings)).slice(0, 12),
    actions: Array.from(new Set(actions)).slice(0, 12),
    riskyClients: riskyOnlineClients.slice(0, 8),
    warningClients: warningOnlineClients.slice(0, 8),
  };
}

function buildLiveSyncPreflightGuidance(input: {
  readiness: any;
  local: any;
  server: any;
  serverError?: string;
}): any {
  const readiness = input.readiness || {};
  const local = input.local || {};
  const server = input.server || {};
  const serverError = String(input.serverError || '');
  const status = String(readiness.status || 'blocked');
  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers : [];
  const warnings = Array.isArray(readiness.warnings) ? readiness.warnings : [];
  const actions = Array.isArray(readiness.actions) ? readiness.actions : [];
  const archivedCount = Number(local.autoArchivedConflicts?.archivedCount || 0);
  const reportPath = String(local.autoRecoveryReport?.reportRelativePath || '');
  const missingSafety = !!(server?.safetyCompatibility && !server.safetyCompatibility.ok);
  const conflictCount = Number(local.recoveryRisk?.conflictCount || 0);
  const recoveryRiskLevel = String(local.recoveryRisk?.riskLevel || 'ok');
  const firstBlocker = blockers[0] || '';
  const firstWarning = warnings[0] || '';

  if (missingSafety) {
    return {
      status: 'needs_action',
      tone: 'error',
      title: '需要先更新 NAS 服务器',
      detail: '当前服务器缺少安全同步能力。为避免旧电脑覆盖新数据，Ars-note 已阻止连接。覆盖上传最新 server 文件夹并重启 Docker 后再试。',
      primaryAction: 'admin',
      primaryLabel: '打开服务器管理台',
      secondaryAction: 'copyDiagnostics',
      secondaryLabel: '复制诊断',
      blockers,
      warnings,
      actions,
    };
  }

  if (serverError) {
    return {
      status: 'needs_action',
      tone: 'error',
      title: '服务器连接需要检查',
      detail: serverError === 'Live Sync server not configured'
        ? '先填写服务器地址和密钥。普通成员默认使用“加入现有 Vault”，本机旧文件不会直接上传覆盖服务器。'
        : `HTTP/API 检查没有通过：${serverError}。请确认 NAS 容器运行、端口可访问，且服务器地址不要带 /admin。`,
      primaryAction: 'retry',
      primaryLabel: '重新检查',
      secondaryAction: 'copyDiagnostics',
      secondaryLabel: '复制诊断',
      blockers,
      warnings,
      actions,
    };
  }

  if (status === 'blocked' && conflictCount > 0) {
    return {
      status: 'needs_action',
      tone: 'error',
      title: '需要先安全整理同步恢复项',
      detail: archivedCount > 0
        ? `已自动把 ${archivedCount} 个旧冲突副本移入同步恢复中心，但仍有 ${conflictCount} 个恢复项需要确认。${reportPath ? `报告：${reportPath}` : ''}`
        : `检测到 ${conflictCount} 个未处理冲突/恢复项。Ars-note 可以先自动判断版本，只处理高置信、可撤回的修复。`,
      primaryAction: 'autopilot',
      primaryLabel: '一键安全整理',
      secondaryAction: 'retry',
      secondaryLabel: '处理后重试',
      blockers,
      warnings,
      actions,
    };
  }

  if (status === 'blocked') {
    const recoveryActionAvailable = actions.some((item: string) => item.includes('Recovery') || item.includes('恢复') || item.includes('冲突'));
    return {
      status: 'needs_action',
      tone: 'error',
      title: '暂时不能开始同步',
      detail: String(readiness.summary || firstBlocker || '上线前检查发现风险。Ars-note 已阻止连接，避免旧数据覆盖服务器。'),
      primaryAction: recoveryActionAvailable ? 'autopilot' : 'retry',
      primaryLabel: recoveryActionAvailable ? '一键安全整理' : '重新检查',
      secondaryAction: 'copyDiagnostics',
      secondaryLabel: '复制诊断',
      blockers,
      warnings,
      actions,
    };
  }

  if (archivedCount > 0) {
    return {
      status: 'protected_paused',
      tone: 'paused',
      title: '已自动整理旧冲突副本',
      detail: `Ars-note 已把 ${archivedCount} 个可见 .conflict-* 副本移入同步恢复中心，没有覆盖或删除正常文档。${reportPath ? `报告：${reportPath}` : ''}`,
      primaryAction: 'continue',
      primaryLabel: '继续加入 Vault',
      secondaryAction: 'recovery',
      secondaryLabel: '查看恢复中心',
      blockers,
      warnings,
      actions,
    };
  }

  if (status === 'warning' || recoveryRiskLevel === 'watch' || warnings.length > 0) {
    return {
      status: 'needs_attention',
      tone: 'warning',
      title: '可以加入，但建议留意',
      detail: String(readiness.summary || firstWarning || '服务器安全能力完整，但有历史恢复记录、单设备在线或链路提示。连接后可运行同步自检。'),
      primaryAction: 'continue',
      primaryLabel: '继续加入 Vault',
      secondaryAction: 'recovery',
      secondaryLabel: '查看建议',
      blockers,
      warnings,
      actions,
    };
  }

  return {
    status: 'ready',
    tone: 'ok',
    title: '可以安全加入 Vault',
    detail: '服务器将作为权威时间线。本机没有服务器基线的旧文件不会直接上传覆盖；删除、冲突和危险写入会进入保护流程。',
    primaryAction: 'continue',
    primaryLabel: '继续加入 Vault',
    secondaryAction: 'none',
    secondaryLabel: '',
    blockers,
    warnings,
    actions,
  };
}

function liveSyncVaultSummaryFileCount(vault: any): number {
  return Math.max(0, Math.floor(Number(vault?.live?.fileCount || vault?.liveFileCount || 0) || 0));
}

function liveSyncVaultSummaryActivityMs(vault: any): number {
  return Date.parse(String(vault?.lastActivityAt || vault?.registeredAt || '')) || 0;
}

function findLiveSyncVaultSummary(identityData: any, vaultId: string): any | null {
  const wanted = String(vaultId || '').trim();
  if (!wanted) return null;
  const candidates = [
    identityData?.exactVault,
    ...(Array.isArray(identityData?.nameMatches) ? identityData.nameMatches : []),
  ].filter(Boolean);
  return candidates.find((vault: any) => (
    String(vault?.vaultId || '').trim() === wanted
    || String(vault?.serverVaultId || '').trim() === wanted
  )) || null;
}

function chooseLiveSyncVaultAutoResolution(identityData: any, currentVaultId: string, connectionMode: LiveSyncConnectionMode | string): { vaultId: string; reason: string } | null {
  if (!identityData?.ok || normalizeLiveSyncConnectionMode(connectionMode) !== 'join') return null;
  const current = String(currentVaultId || '').trim();
  const matches = Array.isArray(identityData.nameMatches) ? identityData.nameMatches : [];

  if (!identityData.exactMatch && matches.length === 1) {
    const onlyMatch = matches[0];
    const vaultId = String(onlyMatch?.vaultId || onlyMatch?.serverVaultId || '').trim();
    if (/^[a-zA-Z0-9_-]{1,128}$/.test(vaultId)) {
      return { vaultId, reason: 'unique-name-match' };
    }
  }

  const recommendedVaultId = String(identityData.recommendedVaultId || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(recommendedVaultId) || recommendedVaultId === current) {
    return null;
  }

  const recommended = findLiveSyncVaultSummary(identityData, recommendedVaultId);
  const currentSummary = findLiveSyncVaultSummary(identityData, current);
  const recommendedFiles = liveSyncVaultSummaryFileCount(recommended);
  const currentFiles = liveSyncVaultSummaryFileCount(currentSummary);
  const recommendedActivity = liveSyncVaultSummaryActivityMs(recommended);
  const currentActivity = liveSyncVaultSummaryActivityMs(currentSummary);

  if (!identityData.exactMatch && matches.length > 0 && recommendedFiles > 0) {
    return { vaultId: recommendedVaultId, reason: 'recommended-name-match' };
  }

  if (identityData.exactMatch && identityData.currentIsRecommended === false) {
    const clearlyRicher = recommendedFiles >= currentFiles + 20 || (currentFiles > 0 && recommendedFiles >= currentFiles * 3);
    const currentLooksEmpty = currentFiles === 0 && recommendedFiles > 0;
    const clearlyNewer = recommendedActivity > currentActivity + 60 * 60 * 1000 && recommendedFiles >= currentFiles;
    if (currentLooksEmpty || clearlyRicher || clearlyNewer) {
      return { vaultId: recommendedVaultId, reason: 'recommended-duplicate-keeper' };
    }
  }

  return null;
}

async function fetchLiveSyncVaultIdentityDiagnostics(
  endpoint: string,
  resolvedVault: string,
  config: LiveSyncConfig,
  vaultName: string,
): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(
      endpoint +
        '/api/admin/vaults/identity?vaultId=' + encodeURIComponent(config.vaultId || '') +
        '&vaultName=' + encodeURIComponent(vaultName || ''),
      {
        headers: liveSyncAuthHeadersForConfig(resolvedVault, config.apiKey),
        signal: controller.signal,
      },
    );
    const data = await response.json() as any;
    if (data?.ok) return data;
    return { ok: false, error: data?.error || `HTTP ${response.status}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function preflightLiveSyncStart(vaultPath: string, config: LiveSyncConfig): Promise<any> {
  const startedAt = Date.now();
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    return {
      ok: false,
      error: 'Invalid vault path',
      guidance: {
        status: 'needs_action',
        tone: 'error',
        title: 'Vault 路径无效',
        detail: '请重新选择正确的 Ars-note Vault 文件夹，再加入同步。',
        primaryAction: 'retry',
        primaryLabel: '重新检查',
        secondaryAction: 'none',
        secondaryLabel: '',
        blockers: ['Invalid vault path'],
        warnings: [],
        actions: ['重新选择正确的 Vault 文件夹。'],
      },
      readiness: {
        status: 'blocked',
        summary: '先不要开始同步：Vault 路径无效。',
        blockers: ['Invalid vault path'],
        warnings: [],
        actions: ['重新选择正确的 Vault 文件夹。'],
      },
    };
  }

  const selfHostedCreds = getSelfHostedCreds(vaultPath);
  const resolvedVault = path.resolve(vaultPath);
  const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
  const syncCfg = readJsonSafe<any>(syncPath, {});
  const savedLiveConfig = loadLiveSyncConfig(resolvedVault) || {};
  const identity = getVaultRemoteIdentity(resolvedVault, syncCfg);
  let effectiveConfig: LiveSyncConfig = {
    ...config,
    serverUrl: normalizeLiveSyncServerUrl(config.serverUrl || savedLiveConfig.serverUrl || selfHostedCreds?.endpoint || syncCfg.endpoint || ''),
    apiKey: config.apiKey || savedLiveConfig.apiKey || selfHostedCreds?.apiKey,
    vaultId: config.vaultId || syncCfg.remoteVaultId || identity.vaultId,
    connectionMode: normalizeLiveSyncConnectionMode(config.connectionMode || savedLiveConfig.connectionMode),
  };

  const local = {
    connected: false,
    clientId: '',
    vaultId: effectiveConfig.vaultId || '',
    serverUrl: effectiveConfig.serverUrl || '',
    connectionMode: normalizeLiveSyncConnectionMode(effectiveConfig.connectionMode),
    connectedAt: null,
    lastActivity: null,
    lastRejectedWrite: null,
    lastError: '',
    latencyMs: null,
    lastPongAt: null,
    preflightComplete: false,
    receivedRemoteSnapshot: false,
    uploadFrozen: false,
    uploadFrozenReason: '',
    preflightBlockedUploadCount: 0,
    preflightBlockedUploadFiles: [],
    deleteStormBlockedCount: 0,
    deleteStormBlockedFiles: [],
    queuedFileCount: 0,
    pendingRemoteApplyCount: 0,
  };
  try {
    const recoveryPrep = await prepareLocalSyncRecoveryBeforeLiveSync(resolvedVault);
    (local as any).recoveryRisk = recoveryPrep.recoveryRisk;
    if (Number(recoveryPrep.archivedConflicts?.archivedCount || 0) > 0) {
      (local as any).autoArchivedConflicts = recoveryPrep.archivedConflicts;
    }
    if (recoveryPrep.report) {
      (local as any).autoRecoveryReport = recoveryPrep.report;
    }
    if (recoveryPrep.advisorError) {
      (local as any).autoRecoveryAdvisorError = recoveryPrep.advisorError;
    }
  } catch (err: any) {
    (local as any).recoveryRisk = {
      riskLevel: 'unknown',
      error: err?.message || 'local recovery scan failed',
    };
  }
  let server: any = null;
  let serverError = '';
  let diagnosticWarning = '';

  try {
    if (!effectiveConfig.serverUrl) {
      serverError = 'Live Sync server not configured';
    } else {
      const safety = await fetchLiveSyncServerSafetyCompatibility(
        resolvedVault,
        effectiveConfig.serverUrl,
        effectiveConfig.vaultId || '',
        effectiveConfig.apiKey,
      );
      server = safety.status || null;
      if (server) {
        server.safetyCompatibility = safety.compatibility;
        const endpoint = liveSyncEndpointFromUrl(effectiveConfig.serverUrl);
        try {
          let identityData = await fetchLiveSyncVaultIdentityDiagnostics(
            endpoint,
            resolvedVault,
            effectiveConfig,
            identity.vaultName || '',
          );
          const autoResolution = chooseLiveSyncVaultAutoResolution(
            identityData,
            effectiveConfig.vaultId || '',
            effectiveConfig.connectionMode || 'join',
          );
          if (autoResolution && autoResolution.vaultId !== effectiveConfig.vaultId) {
            const previousVaultId = effectiveConfig.vaultId || '';
            effectiveConfig = { ...effectiveConfig, vaultId: autoResolution.vaultId };
            local.vaultId = effectiveConfig.vaultId || '';
            (local as any).vaultIdAutoResolved = {
              previousVaultId,
              vaultId: autoResolution.vaultId,
              reason: autoResolution.reason,
            };
            const refreshedSafety = await fetchLiveSyncServerSafetyCompatibility(
              resolvedVault,
              effectiveConfig.serverUrl || '',
              effectiveConfig.vaultId || '',
              effectiveConfig.apiKey,
            );
            server = refreshedSafety.status || server;
            if (server) {
              server.safetyCompatibility = refreshedSafety.compatibility;
              server.vaultIdAutoResolved = (local as any).vaultIdAutoResolved;
            }
            identityData = await fetchLiveSyncVaultIdentityDiagnostics(
              endpoint,
              resolvedVault,
              effectiveConfig,
              identity.vaultName || '',
            );
            if (identityData?.ok) {
              identityData.autoResolvedFrom = (local as any).vaultIdAutoResolved;
            }
          }
          if (identityData?.ok) server.vaultIdentity = identityData;
          else server.vaultIdentityError = identityData?.error || 'Vault identity check failed';
        } catch (identityErr: any) {
          server.vaultIdentityError = identityErr?.name === 'AbortError'
            ? 'Vault identity check timeout'
            : (identityErr?.message || 'Vault identity check unavailable');
        }
      } else if (!safety.ok) {
        serverError = safety.detail || 'Server safety check failed';
      }
    }
  } catch (err: any) {
    serverError = err?.name === 'AbortError'
      ? 'Preflight health check timeout'
      : (err?.message || 'Preflight server status unavailable');
  }

  if (server?.vaultIdentityError) {
    diagnosticWarning = server.vaultIdentityError;
  }

  const readiness = buildLiveSyncLaunchReadiness(local, server, serverError, diagnosticWarning, { preConnect: true });
  const guidance = buildLiveSyncPreflightGuidance({
    readiness,
    local,
    server,
    serverError,
  });
  const health = {
    ok: !serverError,
    degraded: readiness.status === 'warning',
    status: readiness.status === 'blocked' ? 'error' : readiness.status === 'warning' ? 'degraded' : 'ok',
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    local,
    server,
    serverError,
    diagnosticWarning,
    launchReadiness: readiness,
  };

  return {
    ok: readiness.status !== 'blocked',
    blocked: readiness.status === 'blocked',
    warning: readiness.status === 'warning',
    config: effectiveConfig,
    guidance,
    readiness,
    health,
    error: readiness.status === 'blocked' ? readiness.summary : undefined,
  };
}

ipcMain.handle('live-sync:preflight-start', async (_e, vaultPath: string, config: LiveSyncConfig) => {
  return preflightLiveSyncStart(vaultPath, config);
});

ipcMain.handle('live-sync:start', async (_e, vaultPath: string, config: LiveSyncConfig) => {
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    return { ok: false, error: 'Invalid vault path' };
  }
  const sendToRenderer = (channel: string, data: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };
  try {
    const selfHostedCreds = getSelfHostedCreds(vaultPath);
    const resolvedVault = path.resolve(vaultPath);
    const syncPath = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE);
    const syncCfg = readJsonSafe<any>(syncPath, {});
    const savedLiveConfig = loadLiveSyncConfig(resolvedVault) || {};
    const identity = getVaultRemoteIdentity(resolvedVault, syncCfg);
    let effectiveConfig: LiveSyncConfig = {
      ...config,
      serverUrl: normalizeLiveSyncServerUrl(config.serverUrl || savedLiveConfig.serverUrl || selfHostedCreds?.endpoint || syncCfg.endpoint || ''),
      apiKey: config.apiKey || savedLiveConfig.apiKey || selfHostedCreds?.apiKey,
      vaultId: config.vaultId || syncCfg.remoteVaultId || identity.vaultId,
      connectionMode: normalizeLiveSyncConnectionMode(config.connectionMode || savedLiveConfig.connectionMode),
    };
    const preflight = await preflightLiveSyncStart(resolvedVault, effectiveConfig);
    if (preflight?.config) {
      effectiveConfig = {
        ...effectiveConfig,
        ...preflight.config,
        serverUrl: normalizeLiveSyncServerUrl(preflight.config.serverUrl || effectiveConfig.serverUrl || ''),
        connectionMode: normalizeLiveSyncConnectionMode(preflight.config.connectionMode || effectiveConfig.connectionMode),
      };
    }
    if (preflight?.blocked) {
      return {
        ok: false,
        error: [
          preflight.readiness?.summary || 'Live Sync preflight blocked the connection.',
          ...(Array.isArray(preflight.readiness?.blockers) ? preflight.readiness.blockers.slice(0, 4) : []),
        ].filter(Boolean).join(' '),
        config: effectiveConfig,
        preflight,
      };
    }
    if (syncCfg.provider === 'self-hosted' && effectiveConfig.vaultId && syncCfg.remoteVaultId !== effectiveConfig.vaultId) {
      writeJson(syncPath, { ...syncCfg, remoteVaultId: effectiveConfig.vaultId });
    }
    if (effectiveConfig.enabled && effectiveConfig.serverUrl) {
      saveLiveSyncConfig(vaultPath, effectiveConfig);
    }
    startLiveSync(vaultPath, effectiveConfig, sendToRenderer, { serverSafetyVerified: true });
    if (effectiveConfig.enabled && effectiveConfig.serverUrl && syncCfg.provider === 'self-hosted') {
      scheduleAiMemorySync(resolvedVault, 500);
      startAutoSync(resolvedVault);
    }

    /* Auto-refresh tree when remote file changes arrive */
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.on('live-sync:file-updated' as any, () => { /* handled by renderer */ });
    }
    return { ok: true, config: effectiveConfig, preflight };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('live-sync:load-config', async (_e, vaultPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    return null;
  }
  return loadLiveSyncConfig(vaultPath);
});

ipcMain.handle('live-sync:save-config', async (_e, vaultPath: string, config: LiveSyncConfig) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    return null;
  }
  return saveLiveSyncConfig(vaultPath, config);
});

ipcMain.handle('live-sync:clear-config', async (_e, vaultPath: string) => {
  if (vaultPath && fs.existsSync(vaultPath) && isValidVault(vaultPath)) {
    clearLiveSyncConfig(vaultPath);
  }
  return { ok: true };
});

ipcMain.handle('live-sync:push-file', async (_e, filePath: string, content: string) => {
  const sendToRenderer = (channel: string, data: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };
  try {
    return pushLiveFileContent(filePath, content, sendToRenderer);
  } catch (err: any) {
    return { ok: false, error: err.message || 'Live sync push failed' };
  }
});

ipcMain.handle('live-sync:trust-local-initial-upload', async (_e, vaultPath?: string) => {
  const sendToRenderer = (channel: string, data: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    return {
      ok: false,
      error: 'Initial server publish requires the current Vault path so Ars-note can create a server safety snapshot first.',
    };
  }
  const status = getLiveSyncStatus();
  if (normalizeLiveSyncConnectionMode(status?.connectionMode) !== 'rebuild') {
    return {
      ok: false,
      error: 'Initial server publish is blocked in join mode. Switch to "rebuild server from this computer" and reconnect before publishing local data.',
    };
  }

  let preOperationSnapshot: any = null;
  try {
    const snapshotResult = await createServerDataSnapshot(vaultPath, {
      reason: 'before-trusted-initial-local-upload',
      keepLatest: 30,
    });
    preOperationSnapshot = snapshotResult?.snapshot || null;
  } catch (err: any) {
    return {
      ok: false,
      error: `Server safety snapshot failed; initial local upload was cancelled: ${err?.message || String(err)}`,
    };
  }

  const result = trustLocalSnapshotForInitialLiveSyncUpload(sendToRenderer);
  return {
    ...result,
    preOperationSnapshot,
  };
});

ipcMain.handle('live-sync:resume-after-stale-baseline-review', async () => {
  const sendToRenderer = (channel: string, data: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };
  return resumeLiveSyncAfterStaleBaselineReview(sendToRenderer);
});

ipcMain.handle('live-sync:publish-local-authority', async (_e, vaultPathOrOptions?: any, maybeOptions?: any) => {
  const sendToRenderer = (channel: string, data: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };
  const vaultPath = typeof vaultPathOrOptions === 'string' ? vaultPathOrOptions : '';
  const options = typeof vaultPathOrOptions === 'string' ? (maybeOptions || {}) : (vaultPathOrOptions || {});

  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    return {
      ok: false,
      error: 'Publishing local authority requires the current Vault path so Ars-note can create a server safety snapshot first.',
    };
  }
  const status = getLiveSyncStatus();
  if (normalizeLiveSyncConnectionMode(status?.connectionMode) !== 'rebuild') {
    return {
      ok: false,
      error: 'Publishing local authority is blocked in join mode. Switch to "rebuild server from this computer" and reconnect before this dangerous operation.',
    };
  }

  let preOperationSnapshot: any = null;
  try {
    const snapshotResult = await createServerDataSnapshot(vaultPath, {
      reason: 'before-local-authority-publish',
      keepLatest: 30,
    });
    preOperationSnapshot = snapshotResult?.snapshot || null;
  } catch (err: any) {
    return {
      ok: false,
      error: `Server safety snapshot failed; local authority publish was cancelled: ${err?.message || String(err)}`,
    };
  }

  const result = publishLocalSnapshotAsServerAuthority(sendToRenderer, options || {});
  let deleteApplyResult: any = null;
  if (result?.ok && options?.applyDeletes) {
    const queue = getLiveSyncSafeDeleteQueue();
    if (queue.ok && queue.count > 0) {
      deleteApplyResult = applyLiveSyncSafeDeleteQueue(sendToRenderer, options || {});
    }
  }
  return {
    ...result,
    deleteApplyResult,
    appliedDeleteCount: deleteApplyResult?.appliedCount || 0,
    skippedDeleteCount: deleteApplyResult?.skippedCount || 0,
    staleDeleteCount: deleteApplyResult?.staleCount || 0,
    remainingDeleteCount: deleteApplyResult?.remainingCount ?? result?.queuedDeleteCount ?? 0,
    preOperationSnapshot,
  };
});

ipcMain.handle('live-sync:safe-delete-queue', async () => {
  return getLiveSyncSafeDeleteQueue();
});

ipcMain.handle('live-sync:clear-safe-delete-queue', async (_e, ids?: string[]) => {
  return clearLiveSyncSafeDeleteQueue(ids);
});

ipcMain.handle('live-sync:apply-safe-delete-queue', async (_e, vaultPath: string, options?: any) => {
  const sendToRenderer = (channel: string, data: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    return {
      ok: false,
      error: 'Applying the safe delete queue requires the current Vault path so Ars-note can create a server safety snapshot first.',
    };
  }
  let preOperationSnapshot: any = null;
  try {
    const snapshotResult = await createServerDataSnapshot(vaultPath, {
      reason: 'before-safe-delete-queue-apply',
      keepLatest: 30,
    });
    preOperationSnapshot = snapshotResult?.snapshot || null;
  } catch (err: any) {
    return {
      ok: false,
      error: `Server safety snapshot failed; safe delete queue was not applied: ${err?.message || String(err)}`,
    };
  }

  const result = applyLiveSyncSafeDeleteQueue(sendToRenderer, options || {});
  return {
    ...result,
    preOperationSnapshot,
  };
});

ipcMain.handle('live-sync:resume-after-delete-storm-review', async () => {
  const sendToRenderer = (channel: string, data: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };
  return resumeLiveSyncAfterDeleteStormReview(sendToRenderer);
});

ipcMain.handle('live-sync:resume-after-destructive-truncation-review', async () => {
  const sendToRenderer = (channel: string, data: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };
  return resumeLiveSyncAfterDestructiveTruncationReview(sendToRenderer);
});

ipcMain.handle('live-sync:stop', async () => {
  stopLiveSync();
  return { ok: true };
});

ipcMain.handle('live-sync:status', async () => {
  return getLiveSyncStatus();
});

ipcMain.handle('live-sync:health', async (_e, vaultPath: string) => {
  const startedAt = Date.now();
  const fallbackConfig = vaultPath ? loadLiveSyncConfig(vaultPath) : null;
  const local = getLiveSyncHealthSnapshot() || (fallbackConfig ? {
    connected: false,
    clientId: '',
    vaultId: fallbackConfig.vaultId || '',
    serverUrl: fallbackConfig.serverUrl || '',
    connectionMode: normalizeLiveSyncConnectionMode(fallbackConfig.connectionMode),
    connectedAt: null,
    lastActivity: null,
    lastRejectedWrite: null,
    lastError: '',
    latencyMs: null,
    lastPongAt: null,
    preflightComplete: false,
    receivedRemoteSnapshot: false,
    uploadFrozen: false,
    uploadFrozenReason: '',
    preflightBlockedUploadCount: 0,
    preflightBlockedUploadFiles: [],
    deleteStormBlockedCount: 0,
    deleteStormBlockedFiles: [],
    queuedFileCount: 0,
    pendingRemoteApplyCount: 0,
  } : null);
  if (local && vaultPath && fs.existsSync(vaultPath)) {
    try {
      const recoveryPrep = await prepareLocalSyncRecoveryBeforeLiveSync(path.resolve(vaultPath));
      (local as any).recoveryRisk = recoveryPrep.recoveryRisk;
      if (Number(recoveryPrep.archivedConflicts?.archivedCount || 0) > 0) {
        (local as any).autoArchivedConflicts = recoveryPrep.archivedConflicts;
      }
      if (recoveryPrep.report) {
        (local as any).autoRecoveryReport = recoveryPrep.report;
      }
      if (recoveryPrep.advisorError) {
        (local as any).autoRecoveryAdvisorError = recoveryPrep.advisorError;
      }
    } catch (err: any) {
      (local as any).recoveryRisk = {
        riskLevel: 'unknown',
        error: err?.message || 'local recovery scan failed',
      };
    }
  }
  let server: any = null;
  let serverError = '';
  let diagnosticWarning = '';
  let degraded = false;

  try {
    const serverUrl = local?.serverUrl || fallbackConfig?.serverUrl || '';
    const vaultId = local?.vaultId || fallbackConfig?.vaultId || '';
    if (serverUrl) {
      const endpoint = liveSyncEndpointFromUrl(serverUrl);
      const syncCfg = vaultPath && fs.existsSync(vaultPath)
        ? readJsonSafe<any>(path.join(path.resolve(vaultPath), ARS_NOTE_DIR, SYNC_FILE), {})
        : {};
      const expectedIdentity = vaultPath && fs.existsSync(vaultPath)
        ? getVaultRemoteIdentity(path.resolve(vaultPath), { ...syncCfg, remoteVaultId: vaultId || syncCfg.remoteVaultId })
        : { vaultId, vaultName: '' };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(endpoint + '/api/live-sync/status?vaultId=' + encodeURIComponent(vaultId) + '&summary=0', {
          headers: vaultPath ? selfHostedAuthHeaders(vaultPath) : {},
          signal: controller.signal,
        });
        const data = await response.json() as any;
        if (data?.ok) {
          server = data;
          server.safetyCompatibility = getLiveSyncServerSafetyCompatibility(data);
        }
        else serverError = data?.error || `HTTP ${response.status}`;
        if (server) {
          try {
            const identityResponse = await fetch(
              endpoint +
                '/api/admin/vaults/identity?vaultId=' + encodeURIComponent(vaultId) +
                '&vaultName=' + encodeURIComponent(expectedIdentity.vaultName || ''),
              {
                headers: vaultPath ? selfHostedAuthHeaders(vaultPath) : {},
                signal: controller.signal,
              },
            );
            const identityData = await identityResponse.json() as any;
            if (identityData?.ok) server.vaultIdentity = identityData;
            else server.vaultIdentityError = identityData?.error || `HTTP ${identityResponse.status}`;
          } catch (identityErr: any) {
            server.vaultIdentityError = identityErr?.name === 'AbortError'
              ? 'Vault identity check timeout'
              : (identityErr?.message || 'Vault identity check unavailable');
          }
        }
      } finally {
        clearTimeout(timeout);
      }
    } else {
      serverError = 'Live Sync server not configured';
    }
  } catch (err: any) {
    serverError = err.name === 'AbortError' ? 'Health check timeout' : (err.message || 'Server status unavailable');
  }

  if (serverError && local?.connected && !local?.lastError) {
    degraded = true;
    diagnosticWarning = serverError === 'Health check timeout'
      ? 'HTTP 健康检查超过 30 秒，但 WebSocket 仍在线，实时同步可继续。若频繁出现，优先检查中转/反代长连接稳定性，或改用内网/Tailscale 地址。'
      : `HTTP 健康检查异常：${serverError}。WebSocket 仍在线，实时同步可继续；请在空闲时检查服务器 HTTP/API。`;
    serverError = '';
  }
  if (!serverError && server?.vaultIdentity?.ok) {
    const identity = server.vaultIdentity;
    const identityWarnings: string[] = [];
    if (!identity.exactMatch) {
      identityWarnings.push(`服务器上没有找到当前 Vault ID：${identity.query?.vaultId || '-'}`);
    }
    if (identity.duplicateNameRisk) {
      const matches = Array.isArray(identity.nameMatches)
        ? identity.nameMatches.map((item: any) => `${item.vaultName}=${item.vaultId}`).slice(0, 4).join(', ')
        : '';
      identityWarnings.push(`服务器存在同名/疑似同名 Vault，请复制正确 Vault ID，不要只填显示名称。${matches ? `候选：${matches}` : ''}`);
    }
    if (identityWarnings.length > 0) {
      degraded = true;
      diagnosticWarning = [diagnosticWarning, ...identityWarnings].filter(Boolean).join(' ');
    }
  }
  if (!serverError && server?.safetyCompatibility && !server.safetyCompatibility.ok) {
    const compatibility = server.safetyCompatibility;
    const missing = (Array.isArray(compatibility.missingCritical) && compatibility.missingCritical.length > 0
      ? compatibility.missingCritical
      : compatibility.missing || [])
      .map((key: string) => compatibility.labels?.[key] || key)
      .slice(0, 8)
      .join(', ');
    degraded = true;
    diagnosticWarning = [
      diagnosticWarning,
      compatibility.reported
        ? `Server is missing required sync safety capabilities: ${missing || '-'}. Upload the latest server folder to the NAS and recreate the container.`
        : 'Server does not report sync safety capabilities. Upload the latest server folder to the NAS and recreate the container before trusting multi-computer sync.',
    ].filter(Boolean).join(' ');
  }
  if (!serverError && server?.ok && local?.serverUrl && !local.connected) {
    const wsPath = server?.webSocket?.path || '/ws/live-sync';
    const wsUrl = server?.webSocket?.url || '';
    const hints = Array.isArray(server?.diagnostics?.proxyHints)
      ? server.diagnostics.proxyHints.slice(0, 3).join(' ')
      : `Check reverse proxy or tunnel WebSocket Upgrade for ${wsPath}.`;
    diagnosticWarning = [
      `服务器 HTTP 可达，但本机 WebSocket 未连接。请检查 ${wsPath} 是否允许 Upgrade/Connection 长连接。`,
      wsUrl ? `服务器期望 WebSocket：${wsUrl}` : '',
      hints,
    ].filter(Boolean).join(' ');
  }
  if (!serverError && local?.uploadFrozen) {
    degraded = true;
    diagnosticWarning = [
      diagnosticWarning,
      `同步前校验已暂停上传：${local.uploadFrozenReason || '等待服务器快照'}。本机改动会先留在队列里，不会直接覆盖服务器。`,
    ].filter(Boolean).join(' ');
  }
  if (!serverError && Number(local?.preflightBlockedUploadCount || 0) > 0) {
    degraded = true;
    const files = Array.isArray(local?.preflightBlockedUploadFiles)
      ? local.preflightBlockedUploadFiles.slice(0, 5).join(', ')
      : '';
    diagnosticWarning = [
      diagnosticWarning,
      `同步前校验已阻止 ${local.preflightBlockedUploadCount} 个没有服务器基线的本地文件自动上传。${files ? `示例：${files}` : ''}`,
    ].filter(Boolean).join(' ');
  }
  if (!serverError && local?.lastRejectedWrite) {
    const rejectedAtMs = Date.parse(local.lastRejectedWrite.rejectedAt || '');
    const isRecentRejectedWrite = Number.isFinite(rejectedAtMs) && Date.now() - rejectedAtMs < 30 * 60 * 1000;
    if (isRecentRejectedWrite) {
      degraded = true;
      diagnosticWarning = [
        diagnosticWarning,
        `${local.lastRejectedWrite.message || 'Server rejected a stale write for safety.'} File: ${local.lastRejectedWrite.relativePath || '-'}; reason: ${local.lastRejectedWrite.reason || '-'}.`,
      ].filter(Boolean).join(' ');
    }
  }

  const hasBlockingError = !!serverError || !!local?.lastError || (!!local?.serverUrl && !local?.connected);
  const ok = !hasBlockingError;
  const hasDiagnosticWarning = !!diagnosticWarning;
  const launchReadiness = buildLiveSyncLaunchReadiness(local, server, serverError, diagnosticWarning);

  return {
    ok,
    degraded: ok && (degraded || hasDiagnosticWarning),
    status: ok ? (degraded || hasDiagnosticWarning ? 'degraded' : 'ok') : 'error',
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    local,
    server,
    serverError,
    diagnosticWarning,
    launchReadiness,
  };
});

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

function liveSyncEndpointFromUrl(serverUrl: string): string {
  return normalizeLiveSyncServerUrl(serverUrl);
}

async function fetchLiveSyncFiles(vaultPath: string, serverUrl: string, vaultId: string): Promise<any[]> {
  const endpoint = liveSyncEndpointFromUrl(serverUrl);
  const response = await fetch(endpoint + '/api/live-sync/files?vaultId=' + encodeURIComponent(vaultId), {
    headers: vaultPath ? selfHostedAuthHeaders(vaultPath) : {},
  });
  const data = await response.json() as any;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Live file API failed: HTTP ${response.status}`);
  }
  return Array.isArray(data.files) ? data.files : [];
}

function buildSelfTestWebSocketKey(): string {
  return crypto.randomBytes(16).toString('base64');
}

function createMaskedSelfTestWebSocketFrame(payload: string): Buffer {
  const payloadBuf = Buffer.from(payload, 'utf-8');
  const length = payloadBuf.length;
  const maskKey = crypto.randomBytes(4);
  const headerLength = length < 126 ? 2 : length < 65536 ? 4 : 10;
  const frame = Buffer.alloc(headerLength + 4 + length);

  if (length < 126) {
    frame[0] = 0x81;
    frame[1] = 0x80 | length;
  } else if (length < 65536) {
    frame[0] = 0x81;
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(length, 2);
  } else {
    frame[0] = 0x81;
    frame[1] = 0x80 | 127;
    frame.writeBigUInt64BE(BigInt(length), 2);
  }

  maskKey.copy(frame, headerLength);
  for (let i = 0; i < payloadBuf.length; i++) {
    frame[headerLength + 4 + i] = payloadBuf[i] ^ maskKey[i % 4];
  }
  return frame;
}

function parseSelfTestWebSocketFrame(data: Buffer): { opcode: number; payload: string; frameSize: number } | null {
  if (data.length < 2) return null;
  const secondByte = data[1];
  const isMasked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7F;
  let offset = 2;

  if (payloadLength === 126) {
    if (data.length < 4) return null;
    payloadLength = data.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (data.length < 10) return null;
    payloadLength = Number(data.readBigUInt64BE(2));
    offset = 10;
  }

  const maskOffset = offset;
  if (isMasked) offset += 4;
  if (data.length < offset + payloadLength) return null;

  let payload: Buffer;
  if (isMasked) {
    const maskKey = data.slice(maskOffset, maskOffset + 4);
    payload = Buffer.alloc(payloadLength);
    for (let i = 0; i < payloadLength; i++) {
      payload[i] = data[offset + i] ^ maskKey[i % 4];
    }
  } else {
    payload = data.slice(offset, offset + payloadLength);
  }

  return {
    opcode: data[0] & 0x0F,
    payload: payload.toString('utf-8'),
    frameSize: offset + payloadLength,
  };
}

function liveSyncSelfTestApiKey(vaultPath: string): string {
  const resolvedVault = path.resolve(vaultPath);
  const liveCfg = loadLiveSyncConfig(resolvedVault);
  const creds = getSelfHostedCreds(resolvedVault);
  return String(liveCfg?.apiKey || creds?.apiKey || '').trim();
}

const LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION = 3;

function shouldAttachSelfTestSnapshotProof(message: any): boolean {
  return message?.type === 'file-change'
    && message.clientHasServerSnapshot !== false
    && message.clientPreflightComplete !== false;
}

function withSelfTestSnapshotProof(message: any, snapshot: any): any {
  if (!shouldAttachSelfTestSnapshotProof(message)) return message;
  const receivedAt = new Date().toISOString();
  const hasKnownNonDeletedBase = message.baseDeleted !== true && (String(message.baseSha256 || '').trim() || String(message.baseUpdatedAt || '').trim());
  const shouldRefreshNoBaseCreateTime = !message.preserveUpdatedAtForSelfTest
    && message.action !== 'delete'
    && !hasKnownNonDeletedBase;
  return {
    ...message,
    protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
    updatedAt: shouldRefreshNoBaseCreateTime ? receivedAt : message.updatedAt,
    clientHasServerSnapshot: true,
    clientPreflightComplete: true,
    clientSnapshotReceivedAt: message.clientSnapshotReceivedAt || receivedAt,
    clientSnapshotFileCount: Array.isArray(snapshot?.files) ? snapshot.files.length : 0,
    clientBaselineUpdatedAt: message.clientBaselineUpdatedAt || message.baseUpdatedAt || receivedAt,
    clientConnectionMode: message.clientConnectionMode || 'join',
  };
}

function sendLiveSyncSelfTestMessage(
  vaultPath: string,
  serverUrl: string,
  vaultId: string,
  message: any,
  predicate: (msg: any) => boolean,
  timeoutMs = 9000,
): Promise<any | null> {
  return new Promise((resolve, reject) => {
    let done = false;
    let socketRef: any = null;
    let buffer = Buffer.alloc(0);
    let sentPayload = false;
    const waitForSnapshotBeforeSend = shouldAttachSelfTestSnapshotProof(message);

    const finish = (err: Error | null, msg: any | null = null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socketRef?.end(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve(msg);
    };

    const timer = setTimeout(() => finish(null, null), timeoutMs);

    try {
      const wsUrl = new URL(normalizeLiveSyncServerUrl(serverUrl));
      const transport = wsUrl.protocol === 'https:' ? https : http;
      const host = wsUrl.hostname;
      const port = wsUrl.port || (wsUrl.protocol === 'https:' ? '443' : '80');
      const basePath = wsUrl.pathname && wsUrl.pathname !== '/' ? wsUrl.pathname.replace(/\/+$/, '') : '';
      const apiKey = liveSyncSelfTestApiKey(vaultPath);
      const query = new URLSearchParams({
        vaultId,
        deviceId: 'self-test-' + crypto.randomBytes(4).toString('hex'),
        deviceName: `${os.hostname()} self-test`,
        platform: `${os.platform()}-self-test`,
        appVersion: app.getVersion?.() || APP_VERSION,
        protocolVersion: String(LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION),
      });
      if (apiKey) query.set('apiKey', apiKey);

      const wsKey = buildSelfTestWebSocketKey();
      const headers: Record<string, string> = {
        Host: `${host}:${port}`,
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': wsKey,
        'Sec-WebSocket-Version': '13',
      };
      if (apiKey) headers['x-ars-note-api-key'] = apiKey;

      const req = transport.request({
        hostname: host,
        port: parseInt(port, 10),
        path: `${basePath}/ws/live-sync?${query.toString()}`,
        method: 'GET',
        headers,
      });

      req.on('upgrade', (_res, socket, head) => {
        socketRef = socket;
        if (head && head.length) buffer = Buffer.concat([buffer, head]);
        if (!waitForSnapshotBeforeSend) {
          sentPayload = true;
          socket.write(createMaskedSelfTestWebSocketFrame(JSON.stringify({
            ...message,
            protocolVersion: message?.protocolVersion || LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
          })));
        }

        socket.on('data', (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk]);
          while (buffer.length >= 2) {
            const frame = parseSelfTestWebSocketFrame(buffer);
            if (!frame) break;
            buffer = buffer.slice(frame.frameSize);
            if (frame.opcode === 0x8) {
              finish(null, null);
              return;
            }
            if (frame.opcode !== 0x1 || !frame.payload) continue;
            try {
              const parsed = JSON.parse(frame.payload);
              if (!sentPayload && waitForSnapshotBeforeSend && parsed?.type === 'live-snapshot') {
                sentPayload = true;
                socket.write(createMaskedSelfTestWebSocketFrame(JSON.stringify(withSelfTestSnapshotProof(message, parsed))));
                continue;
              }
              if (predicate(parsed)) {
                finish(null, parsed);
                return;
              }
            } catch {
              /* ignore malformed self-test frame */
            }
          }
        });
        socket.on('error', (err: any) => finish(err instanceof Error ? err : new Error(String(err || 'WebSocket socket error'))));
        socket.on('close', () => finish(null, null));
      });

      req.on('response', (res: any) => {
        const statusCode = res.statusCode || 0;
        try { res.resume(); } catch { /* ignore */ }
        finish(new Error(`WebSocket upgrade failed during safety self-test: HTTP ${statusCode}`));
      });
      req.on('error', (err: any) => finish(err instanceof Error ? err : new Error(String(err || 'WebSocket self-test failed'))));
      req.end();
    } catch (err: any) {
      finish(err instanceof Error ? err : new Error(String(err || 'WebSocket self-test failed')));
    }
  });
}

function openLiveSyncSelfTestObserver(
  vaultPath: string,
  serverUrl: string,
  vaultId: string,
  predicate: (msg: any) => boolean,
  timeoutMs = 9000,
): { ready: Promise<void>; received: Promise<any | null>; close: () => void } {
  let socketRef: any = null;
  let requestRef: any = null;
  let buffer = Buffer.alloc(0);
  let readySettled = false;
  let receivedSettled = false;
  let closed = false;
  let resolveReady!: () => void;
  let rejectReady!: (err: Error) => void;
  let resolveReceived!: (msg: any | null) => void;

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const received = new Promise<any | null>((resolve) => {
    resolveReceived = resolve;
  });

  const settleReady = (err?: Error) => {
    if (readySettled) return;
    readySettled = true;
    if (err) rejectReady(err);
    else resolveReady();
  };

  const settleReceived = (msg: any | null) => {
    if (receivedSettled) return;
    receivedSettled = true;
    clearTimeout(timer);
    resolveReceived(msg);
  };

  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    try { requestRef?.destroy?.(); } catch { /* ignore */ }
    try { socketRef?.end?.(); } catch { /* ignore */ }
    try { socketRef?.destroy?.(); } catch { /* ignore */ }
    if (!readySettled) settleReady(new Error('observer WebSocket closed before snapshot'));
    settleReceived(null);
  };

  const fail = (err: Error) => {
    if (!readySettled) settleReady(err);
    settleReceived(null);
    try { socketRef?.end?.(); } catch { /* ignore */ }
    try { socketRef?.destroy?.(); } catch { /* ignore */ }
  };

  const timer = setTimeout(() => {
    if (!readySettled) settleReady(new Error('observer WebSocket did not receive server snapshot before timeout'));
    settleReceived(null);
    try { socketRef?.end?.(); } catch { /* ignore */ }
  }, timeoutMs);

  try {
    const wsUrl = new URL(normalizeLiveSyncServerUrl(serverUrl));
    const transport = wsUrl.protocol === 'https:' ? https : http;
    const host = wsUrl.hostname;
    const port = wsUrl.port || (wsUrl.protocol === 'https:' ? '443' : '80');
    const basePath = wsUrl.pathname && wsUrl.pathname !== '/' ? wsUrl.pathname.replace(/\/+$/, '') : '';
    const apiKey = liveSyncSelfTestApiKey(vaultPath);
    const query = new URLSearchParams({
      vaultId,
      deviceId: 'self-test-observer-' + crypto.randomBytes(4).toString('hex'),
      deviceName: `${os.hostname()} self-test observer`,
      platform: `${os.platform()}-self-test`,
      appVersion: app.getVersion?.() || APP_VERSION,
      protocolVersion: String(LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION),
    });
    if (apiKey) query.set('apiKey', apiKey);

    const wsKey = buildSelfTestWebSocketKey();
    const headers: Record<string, string> = {
      Host: `${host}:${port}`,
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Key': wsKey,
      'Sec-WebSocket-Version': '13',
    };
    if (apiKey) headers['x-ars-note-api-key'] = apiKey;

    const req = transport.request({
      hostname: host,
      port: parseInt(port, 10),
      path: `${basePath}/ws/live-sync?${query.toString()}`,
      method: 'GET',
      headers,
    });
    requestRef = req;

    req.on('upgrade', (_res, socket, head) => {
      socketRef = socket;
      if (head && head.length) buffer = Buffer.concat([buffer, head]);

      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
          const frame = parseSelfTestWebSocketFrame(buffer);
          if (!frame) break;
          buffer = buffer.slice(frame.frameSize);
          if (frame.opcode === 0x8) {
            close();
            return;
          }
          if (frame.opcode !== 0x1 || !frame.payload) continue;
          try {
            const parsed = JSON.parse(frame.payload);
            if (!readySettled && (parsed?.type === 'live-snapshot' || parsed?.type === 'welcome')) {
              settleReady();
            }
            if (predicate(parsed)) {
              settleReceived(parsed);
              try { socket.end(); } catch { /* ignore */ }
              return;
            }
          } catch {
            /* ignore malformed observer frame */
          }
        }
      });
      socket.on('error', (err: any) => fail(err instanceof Error ? err : new Error(String(err || 'observer WebSocket socket error'))));
      socket.on('close', () => {
        if (!readySettled) settleReady(new Error('observer WebSocket closed before snapshot'));
        settleReceived(null);
      });
    });

    req.on('response', (res: any) => {
      const statusCode = res.statusCode || 0;
      try { res.resume(); } catch { /* ignore */ }
      fail(new Error(`observer WebSocket upgrade failed: HTTP ${statusCode}`));
    });
    req.on('error', (err: any) => fail(err instanceof Error ? err : new Error(String(err || 'observer WebSocket failed'))));
    req.end();
  } catch (err: any) {
    fail(err instanceof Error ? err : new Error(String(err || 'observer WebSocket failed')));
  }

  return { ready, received, close };
}

async function runLiveSyncPeerBroadcastSelfTest(
  vaultPath: string,
  serverUrl: string,
  vaultId: string,
  relativePath: string,
): Promise<{ received: boolean; reason: string; writerResponse: any | null; peerResponse: any | null }> {
  const content = `# Ars-note peer broadcast safety probe\n\nAnother WebSocket client must receive this file-change broadcast.\n${new Date().toISOString()}\n`;
  const buffer = Buffer.from(content, 'utf-8');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const updatedAt = new Date().toISOString();
  const observer = openLiveSyncSelfTestObserver(
    vaultPath,
    serverUrl,
    vaultId,
    (msg) => msg?.type === 'file-change'
      && msg.relativePath === relativePath
      && msg.action !== 'delete'
      && msg.sha256 === sha256,
    12000,
  );

  let writerResponse: any | null = null;
  let peerResponse: any | null = null;
  try {
    await observer.ready;
    writerResponse = await sendLiveSyncSelfTestMessage(vaultPath, serverUrl, vaultId, {
      type: 'file-change',
      protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
      relativePath,
      action: 'create',
      contentBase64: buffer.toString('base64'),
      sha256,
      updatedAt,
      baseSha256: '',
      baseDeleted: true,
      baseUpdatedAt: '',
    }, (msg) => msg?.type === 'file-rejected' || msg?.type === 'file-accepted', 9000);

    if (writerResponse?.type !== 'file-accepted') {
      return {
        received: false,
        reason: `writer did not get file-accepted: ${writerResponse?.reason || writerResponse?.type || 'timeout'}`,
        writerResponse,
        peerResponse: null,
      };
    }

    peerResponse = await observer.received;
    return {
      received: !!peerResponse,
      reason: peerResponse
        ? 'a second WebSocket client received the live file-change broadcast'
        : 'the observer WebSocket did not receive the live file-change broadcast before timeout',
      writerResponse,
      peerResponse,
    };
  } catch (err: any) {
    return {
      received: false,
      reason: err?.message || String(err || 'peer broadcast self-test failed'),
      writerResponse,
      peerResponse,
    };
  } finally {
    observer.close();
    if (writerResponse?.type === 'file-accepted') {
      await sendLiveSyncSelfTestMessage(vaultPath, serverUrl, vaultId, {
        type: 'file-change',
        protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
        relativePath,
        action: 'delete',
        contentBase64: '',
        sha256: '',
        updatedAt: new Date().toISOString(),
        baseSha256: sha256,
        baseDeleted: false,
        baseUpdatedAt: writerResponse.updatedAt || updatedAt,
        baseServerRevision: writerResponse.serverRevision,
        baseRevisionId: writerResponse.revisionId || '',
      }, (msg) => msg?.type === 'file-rejected' || msg?.type === 'file-accepted', 5000).catch(() => null);
    }
  }
}

async function runLiveSyncStaleWriteProtectionSelfTest(
  vaultPath: string,
  serverUrl: string,
  vaultId: string,
  relativePath: string,
  staleBaseSha256: string,
  staleBaseUpdatedAt: string,
  currentSha256: string,
): Promise<{ rejected: boolean; reason: string; currentSha256: string; response: any | null }> {
  const staleContent = `# Ars-note stale write safety probe\n\nThis content must be rejected.\n${new Date().toISOString()}\n`;
  const staleBuffer = Buffer.from(staleContent, 'utf-8');
  const staleSha = crypto.createHash('sha256').update(staleBuffer).digest('hex');
  const response = await sendLiveSyncSelfTestMessage(vaultPath, serverUrl, vaultId, {
    type: 'file-change',
    protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
    relativePath,
    action: 'update',
    contentBase64: staleBuffer.toString('base64'),
    sha256: staleSha,
    updatedAt: new Date().toISOString(),
    baseSha256: staleBaseSha256,
    baseDeleted: false,
    baseUpdatedAt: staleBaseUpdatedAt || '',
  }, (msg) => msg?.type === 'file-rejected' && msg.relativePath === relativePath, 9000);

  return {
    rejected: !!response,
    reason: String(response?.reason || ''),
    currentSha256: String(response?.current?.sha256 || currentSha256 || ''),
    response,
  };
}

async function runLiveSyncRevisionBaseProtectionSelfTest(
  vaultPath: string,
  serverUrl: string,
  vaultId: string,
  relativePath: string,
  currentSha256: string,
  currentUpdatedAt: string,
  staleServerRevision?: number,
  staleRevisionId?: string,
): Promise<{ rejected: boolean; reason: string; response: any | null }> {
  const revisionContent = `# Ars-note revision base safety probe\n\nThis content must be rejected because it names an old server revision.\n${new Date().toISOString()}\n`;
  const revisionBuffer = Buffer.from(revisionContent, 'utf-8');
  const revisionSha = crypto.createHash('sha256').update(revisionBuffer).digest('hex');
  const response = await sendLiveSyncSelfTestMessage(vaultPath, serverUrl, vaultId, {
    type: 'file-change',
    protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
    relativePath,
    action: 'update',
    contentBase64: revisionBuffer.toString('base64'),
    sha256: revisionSha,
    updatedAt: new Date().toISOString(),
    baseSha256: currentSha256,
    baseDeleted: false,
    baseUpdatedAt: currentUpdatedAt || '',
    baseServerRevision: staleServerRevision,
    baseRevisionId: staleRevisionId || '',
  }, (msg) => msg?.type === 'file-rejected' && msg.relativePath === relativePath, 9000);

  return {
    rejected: !!response,
    reason: String(response?.reason || ''),
    response,
  };
}

async function runLiveSyncMissingBaseProtectionSelfTest(
  vaultPath: string,
  serverUrl: string,
  vaultId: string,
  relativePath: string,
): Promise<{ rejected: boolean; reason: string; accepted: boolean; response: any | null; expectedDeviceId: string }> {
  const probeContent = `# Ars-note missing base safety probe\n\nThis content must be rejected if the server has no current base file.\n${new Date().toISOString()}\n`;
  const probeBuffer = Buffer.from(probeContent, 'utf-8');
  const probeSha = crypto.createHash('sha256').update(probeBuffer).digest('hex');
  const fakeBaseSha = crypto.createHash('sha256').update(`missing-base-${relativePath}`).digest('hex');
  const expectedDeviceId = `self-test-rejected-history-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const response = await sendLiveSyncSelfTestMessage(vaultPath, serverUrl, vaultId, {
    type: 'file-change',
    protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
    deviceId: expectedDeviceId,
    relativePath,
    action: 'update',
    contentBase64: probeBuffer.toString('base64'),
    sha256: probeSha,
    updatedAt: new Date().toISOString(),
    baseSha256: fakeBaseSha,
    baseDeleted: false,
    baseUpdatedAt: new Date(Date.now() - 60_000).toISOString(),
  }, (msg) => msg?.type === 'file-rejected' || msg?.type === 'file-accepted', 9000);

  const accepted = response?.type === 'file-accepted';
  if (accepted) {
    await sendLiveSyncSelfTestMessage(vaultPath, serverUrl, vaultId, {
      type: 'file-change',
      protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
      relativePath,
      action: 'delete',
      contentBase64: '',
      sha256: '',
      updatedAt: new Date().toISOString(),
      baseSha256: probeSha,
      baseDeleted: false,
      baseUpdatedAt: response.updatedAt || new Date().toISOString(),
    }, (msg) => msg?.type === 'file-rejected' || msg?.type === 'file-accepted', 5000).catch(() => null);
  }

  return {
    rejected: response?.type === 'file-rejected',
    reason: String(response?.reason || ''),
    accepted,
    response,
    expectedDeviceId,
  };
}

async function runLiveSyncSnapshotProofProtectionSelfTest(
  vaultPath: string,
  serverUrl: string,
  vaultId: string,
  relativePath: string,
): Promise<{ rejected: boolean; reason: string; accepted: boolean; response: any | null }> {
  const probeContent = `# Ars-note snapshot proof safety probe\n\nThis write must be rejected before the client proves it received the server snapshot.\n${new Date().toISOString()}\n`;
  const probeBuffer = Buffer.from(probeContent, 'utf-8');
  const probeSha = crypto.createHash('sha256').update(probeBuffer).digest('hex');
  const response = await sendLiveSyncSelfTestMessage(vaultPath, serverUrl, vaultId, {
    type: 'file-change',
    protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
    relativePath,
    action: 'create',
    contentBase64: probeBuffer.toString('base64'),
    sha256: probeSha,
    updatedAt: new Date().toISOString(),
    baseSha256: '',
    baseDeleted: true,
    baseUpdatedAt: '',
    clientHasServerSnapshot: false,
    clientPreflightComplete: false,
    clientSnapshotReceivedAt: '',
    clientBaselineUpdatedAt: '',
  }, (msg) => msg?.type === 'file-rejected' || msg?.type === 'file-accepted', 9000);

  const accepted = response?.type === 'file-accepted';
  if (accepted) {
    await sendLiveSyncSelfTestMessage(vaultPath, serverUrl, vaultId, {
      type: 'file-change',
      protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
      relativePath,
      action: 'delete',
      contentBase64: '',
      sha256: '',
      updatedAt: new Date().toISOString(),
      baseSha256: probeSha,
      baseDeleted: false,
      baseUpdatedAt: response.updatedAt || new Date().toISOString(),
    }, (msg) => msg?.type === 'file-rejected' || msg?.type === 'file-accepted', 5000).catch(() => null);
  }

  return {
    rejected: response?.type === 'file-rejected',
    reason: String(response?.reason || ''),
    accepted,
    response,
  };
}

async function runLiveSyncPreSnapshotLocalWriteProtectionSelfTest(
  vaultPath: string,
  serverUrl: string,
  vaultId: string,
  relativePath: string,
): Promise<{ rejected: boolean; reason: string; accepted: boolean; response: any | null }> {
  const probeContent = `# Ars-note pre-snapshot local write safety probe\n\nThis simulates an old local-only file that must not be uploaded as a new server file.\n${new Date().toISOString()}\n`;
  const probeBuffer = Buffer.from(probeContent, 'utf-8');
  const probeSha = crypto.createHash('sha256').update(probeBuffer).digest('hex');
  const oldUpdatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const response = await sendLiveSyncSelfTestMessage(vaultPath, serverUrl, vaultId, {
    type: 'file-change',
    protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
    relativePath,
    action: 'create',
    contentBase64: probeBuffer.toString('base64'),
    sha256: probeSha,
    updatedAt: oldUpdatedAt,
    preserveUpdatedAtForSelfTest: true,
    baseSha256: '',
    baseDeleted: true,
    baseUpdatedAt: '',
  }, (msg) => msg?.type === 'file-rejected' || msg?.type === 'file-accepted', 9000);

  const accepted = response?.type === 'file-accepted';
  if (accepted) {
    await sendLiveSyncSelfTestMessage(vaultPath, serverUrl, vaultId, {
      type: 'file-change',
      protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
      relativePath,
      action: 'delete',
      contentBase64: '',
      sha256: '',
      updatedAt: new Date().toISOString(),
      baseSha256: probeSha,
      baseDeleted: false,
      baseUpdatedAt: response.updatedAt || new Date().toISOString(),
    }, (msg) => msg?.type === 'file-rejected' || msg?.type === 'file-accepted', 5000).catch(() => null);
  }

  return {
    rejected: response?.type === 'file-rejected',
    reason: String(response?.reason || ''),
    accepted,
    response,
  };
}

async function runLiveSyncDeletedTombstoneProtectionSelfTest(
  vaultPath: string,
  serverUrl: string,
  vaultId: string,
  relativePath: string,
  tombstoneUpdatedAt: string,
): Promise<{ rejected: boolean; reason: string; accepted: boolean; response: any | null }> {
  const resurrectContent = `# Ars-note deleted tombstone safety probe\n\nThis content must not resurrect a deleted server tombstone.\n${new Date().toISOString()}\n`;
  const resurrectBuffer = Buffer.from(resurrectContent, 'utf-8');
  const resurrectSha = crypto.createHash('sha256').update(resurrectBuffer).digest('hex');
  const staleUpdatedAt = tombstoneUpdatedAt || new Date().toISOString();

  const response = await sendLiveSyncSelfTestMessage(vaultPath, serverUrl, vaultId, {
    type: 'file-change',
    protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
    relativePath,
    action: 'create',
    contentBase64: resurrectBuffer.toString('base64'),
    sha256: resurrectSha,
    updatedAt: staleUpdatedAt,
    baseSha256: '',
    baseDeleted: true,
    baseUpdatedAt: tombstoneUpdatedAt || '',
  }, (msg) => msg?.type === 'file-rejected' || msg?.type === 'file-accepted', 9000);

  const accepted = response?.type === 'file-accepted';
  if (accepted) {
    await sendLiveSyncSelfTestMessage(vaultPath, serverUrl, vaultId, {
      type: 'file-change',
      protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
      relativePath,
      action: 'delete',
      contentBase64: '',
      sha256: '',
      updatedAt: new Date().toISOString(),
      baseSha256: resurrectSha,
      baseDeleted: false,
      baseUpdatedAt: response.updatedAt || new Date().toISOString(),
    }, (msg) => msg?.type === 'file-rejected' || msg?.type === 'file-accepted', 5000).catch(() => null);
  }

  return {
    rejected: response?.type === 'file-rejected',
    reason: String(response?.reason || ''),
    accepted,
    response,
  };
}

async function runLiveSyncServerDestructiveTruncationSelfTest(
  vaultPath: string,
  serverUrl: string,
  vaultId: string,
  relativePath: string,
): Promise<{
  created: boolean;
  rejected: boolean;
  reason: string;
  preserved: boolean;
  accepted: boolean;
  createResponse: any | null;
  rejectResponse: any | null;
}> {
  const largeContent = [
    '# Ars-note destructive truncation safety probe',
    '',
    'This server-side content must survive an accidental empty rewrite.',
    '',
    'A'.repeat(70 * 1024),
    new Date().toISOString(),
    '',
  ].join('\n');
  const largeBuffer = Buffer.from(largeContent, 'utf-8');
  const largeSha = crypto.createHash('sha256').update(largeBuffer).digest('hex');
  const createdAt = new Date().toISOString();

  const createResponse = await sendLiveSyncSelfTestMessage(vaultPath, serverUrl, vaultId, {
    type: 'file-change',
    protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
    relativePath,
    action: 'create',
    contentBase64: largeBuffer.toString('base64'),
    sha256: largeSha,
    updatedAt: createdAt,
    baseSha256: '',
    baseDeleted: true,
    baseUpdatedAt: '',
  }, (msg) => msg?.type === 'file-rejected' || msg?.type === 'file-accepted', 9000);

  const created = createResponse?.type === 'file-accepted';
  if (!created) {
    return {
      created: false,
      rejected: createResponse?.type === 'file-rejected',
      reason: String(createResponse?.reason || ''),
      preserved: false,
      accepted: false,
      createResponse,
      rejectResponse: null,
    };
  }

  const remoteLarge = await waitForRemoteLiveFile(
    vaultPath,
    serverUrl,
    vaultId,
    relativePath,
    (file) => !!file && !file.deleted && file.sha256 === largeSha,
    9000,
  );
  const baseUpdatedAt = String(remoteLarge?.updatedAt || createResponse?.updatedAt || createdAt);
  const emptyBuffer = Buffer.alloc(0);
  const emptySha = crypto.createHash('sha256').update(emptyBuffer).digest('hex');

  const rejectResponse = await sendLiveSyncSelfTestMessage(vaultPath, serverUrl, vaultId, {
    type: 'file-change',
    protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
    relativePath,
    action: 'update',
    contentBase64: emptyBuffer.toString('base64'),
    sha256: emptySha,
    updatedAt: new Date().toISOString(),
    baseSha256: largeSha,
    baseDeleted: false,
    baseUpdatedAt,
  }, (msg) => msg?.type === 'file-rejected' || msg?.type === 'file-accepted', 9000);

  const preservedFile = await waitForRemoteLiveFile(
    vaultPath,
    serverUrl,
    vaultId,
    relativePath,
    (file) => !!file && !file.deleted && file.sha256 === largeSha,
    3000,
  );
  const accepted = rejectResponse?.type === 'file-accepted';
  const rejected = rejectResponse?.type === 'file-rejected';

  await sendLiveSyncSelfTestMessage(vaultPath, serverUrl, vaultId, {
    type: 'file-change',
    protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
    relativePath,
    action: 'delete',
    contentBase64: '',
    sha256: '',
    updatedAt: new Date().toISOString(),
    baseSha256: largeSha,
    baseDeleted: false,
    baseUpdatedAt: preservedFile?.updatedAt || baseUpdatedAt,
  }, (msg) => msg?.type === 'file-rejected' || msg?.type === 'file-accepted', 5000).catch(() => null);

  return {
    created,
    rejected,
    reason: String(rejectResponse?.reason || ''),
    preserved: !!preservedFile && preservedFile.sha256 === largeSha,
    accepted,
    createResponse,
    rejectResponse,
  };
}

async function postLiveSyncSelfTestAdminJson(vaultPath: string, serverUrl: string, routePath: string, body: any): Promise<any> {
  const endpoint = liveSyncEndpointFromUrl(serverUrl).replace(/\/+$/, '');
  const res = await fetch(endpoint + routePath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...selfHostedAuthHeaders(vaultPath) },
    body: JSON.stringify(body || {}),
  });
  let data: any = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `Admin request failed: HTTP ${res.status}`);
  }
  return data;
}

async function cleanupLiveSyncSelfTestVault(vaultPath: string, serverUrl: string, vaultId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) await sleep(1000);
      await postLiveSyncSelfTestAdminJson(vaultPath, serverUrl, '/api/admin/vaults/delete', { vaultId });
      return true;
    } catch {
      /* best-effort cleanup; retry because WebSocket unregister can lag a little */
    }
  }
  return false;
}

async function runLiveSyncPrunedTombstoneHistoryProtectionSelfTest(
  vaultPath: string,
  serverUrl: string,
): Promise<{
  registered: boolean;
  created: boolean;
  deleted: boolean;
  pruned: boolean;
  rejected: boolean;
  reason: string;
  accepted: boolean;
  response: any | null;
}> {
  const tempVaultId = `ars_note_self_test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const relativePath = `pruned_tombstone_guard/probe_${Date.now()}.md`;
  const endpoint = liveSyncEndpointFromUrl(serverUrl);

  try {
    await registerSelfHostedVault(endpoint, vaultPath, {
      vaultId: tempVaultId,
      vaultName: `Ars-note Self Test ${new Date().toISOString()}`,
    });

    const content = `# Ars-note pruned tombstone history safety probe\n\nThis old content must not return after its tombstone is pruned.\n${new Date().toISOString()}\n`;
    const buffer = Buffer.from(content, 'utf-8');
    const sha = crypto.createHash('sha256').update(buffer).digest('hex');
    const createResponse = await sendLiveSyncSelfTestMessage(vaultPath, serverUrl, tempVaultId, {
      type: 'file-change',
      protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
      relativePath,
      action: 'create',
      contentBase64: buffer.toString('base64'),
      sha256: sha,
      updatedAt: new Date().toISOString(),
      baseSha256: '',
      baseDeleted: true,
      baseUpdatedAt: '',
    }, (msg) => msg?.type === 'file-rejected' || msg?.type === 'file-accepted', 9000);

    const created = createResponse?.type === 'file-accepted';
    if (!created) {
      return {
        registered: true,
        created: false,
        deleted: false,
        pruned: false,
        rejected: createResponse?.type === 'file-rejected',
        reason: String(createResponse?.reason || 'create-not-accepted'),
        accepted: false,
        response: createResponse,
      };
    }

    const createdFile = await waitForRemoteLiveFile(
      vaultPath,
      serverUrl,
      tempVaultId,
      relativePath,
      (file) => !!file && !file.deleted && file.sha256 === sha,
      9000,
    );
    const baseUpdatedAt = String(createdFile?.updatedAt || createResponse?.updatedAt || new Date().toISOString());

    const deleteResponse = await sendLiveSyncSelfTestMessage(vaultPath, serverUrl, tempVaultId, {
      type: 'file-change',
      protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
      relativePath,
      action: 'delete',
      contentBase64: '',
      sha256: '',
      updatedAt: new Date().toISOString(),
      baseSha256: sha,
      baseDeleted: false,
      baseUpdatedAt,
    }, (msg) => msg?.type === 'file-rejected' || msg?.type === 'file-accepted', 9000);
    const deleted = deleteResponse?.type === 'file-accepted'
      && !!(await waitForRemoteLiveFile(vaultPath, serverUrl, tempVaultId, relativePath, (file) => !!file && !!file.deleted, 9000));

    if (!deleted) {
      return {
        registered: true,
        created,
        deleted: false,
        pruned: false,
        rejected: deleteResponse?.type === 'file-rejected',
        reason: String(deleteResponse?.reason || 'delete-not-accepted'),
        accepted: false,
        response: deleteResponse,
      };
    }

    const pruneResult = await postLiveSyncSelfTestAdminJson(vaultPath, serverUrl, '/api/admin/live/prune-tombstones', {
      vaultId: tempVaultId,
      olderThanDays: 1,
      force: true,
    });
    const pruned = Number(pruneResult?.removed || 0) > 0;

    const resurrectResponse = await sendLiveSyncSelfTestMessage(vaultPath, serverUrl, tempVaultId, {
      type: 'file-change',
      protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
      relativePath,
      action: 'create',
      contentBase64: buffer.toString('base64'),
      sha256: sha,
      updatedAt: new Date().toISOString(),
      baseSha256: '',
      baseDeleted: true,
      baseUpdatedAt: '',
    }, (msg) => msg?.type === 'file-rejected' || msg?.type === 'file-accepted', 9000);

    const accepted = resurrectResponse?.type === 'file-accepted';
    if (accepted) {
      await sendLiveSyncSelfTestMessage(vaultPath, serverUrl, tempVaultId, {
        type: 'file-change',
        protocolVersion: LIVE_SYNC_SELF_TEST_PROTOCOL_VERSION,
        relativePath,
        action: 'delete',
        contentBase64: '',
        sha256: '',
        updatedAt: new Date().toISOString(),
        baseSha256: sha,
        baseDeleted: false,
        baseUpdatedAt: resurrectResponse.updatedAt || new Date().toISOString(),
      }, (msg) => msg?.type === 'file-rejected' || msg?.type === 'file-accepted', 5000).catch(() => null);
    }

    return {
      registered: true,
      created,
      deleted,
      pruned,
      rejected: resurrectResponse?.type === 'file-rejected',
      reason: String(resurrectResponse?.reason || ''),
      accepted,
      response: resurrectResponse,
    };
  } finally {
    await sleep(500);
    await cleanupLiveSyncSelfTestVault(vaultPath, serverUrl, tempVaultId);
  }
}

function resolveLiveSyncServerContext(vaultPath: string): { resolvedVault: string; endpoint: string; vaultId: string; serverUrl: string } {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }

  const resolvedVault = path.resolve(vaultPath);
  const syncCfg = readJsonSafe<any>(path.join(resolvedVault, ARS_NOTE_DIR, SYNC_FILE), {});
  const liveCfg = loadLiveSyncConfig(resolvedVault) || {};
  const status = getLiveSyncStatus();
  const selfHostedCreds = getSelfHostedCreds(resolvedVault);
  const identity = getVaultRemoteIdentity(resolvedVault, {
    ...syncCfg,
    remoteVaultId: status?.vaultId || liveCfg.vaultId || syncCfg.remoteVaultId,
  });
  const serverUrl = normalizeLiveSyncServerUrl(
    status?.serverUrl || liveCfg.serverUrl || selfHostedCreds?.endpoint || syncCfg.endpoint || '',
  );
  const vaultId = status?.vaultId || liveCfg.vaultId || syncCfg.remoteVaultId || identity.vaultId;

  if (!serverUrl) throw new Error('Live Sync server is not configured');
  if (!vaultId) throw new Error('Live Sync vaultId is not configured');

  return {
    resolvedVault,
    endpoint: liveSyncEndpointFromUrl(serverUrl),
    vaultId,
    serverUrl,
  };
}

function normalizeServerHistoryItem(item: any): any {
  const action = String(item?.action || 'server-history');
  const reason = String(item?.reason || action);
  const serverRevision = Number(item?.serverRevision || 0);
  return {
    versionId: String(item?.revisionId || item?.versionId || ''),
    revisionId: String(item?.revisionId || item?.versionId || ''),
    relativePath: String(item?.relativePath || '').replace(/\\/g, '/'),
    savedAt: String(item?.recordedAt || item?.savedAt || item?.updatedAt || ''),
    reason: reason.startsWith('server-') ? reason : `server-${reason}`,
    deletedSnapshot: !!item?.deleted || action === 'delete',
    size: Number(item?.size || 0),
    sha256: String(item?.sha256 || ''),
    serverRevision: Number.isFinite(serverRevision) && serverRevision > 0 ? Math.floor(serverRevision) : undefined,
    clientId: String(item?.clientId || item?.updatedByClientId || '').trim(),
    deviceId: String(item?.deviceId || item?.updatedByDeviceId || '').trim(),
    tombstoneExpiresAt: String(item?.tombstoneExpiresAt || ''),
    serverAction: action,
    serverUpdatedAt: item?.updatedAt || '',
  };
}

function normalizeServerDataSnapshotItem(item: any): any {
  return {
    exportedAt: String(item?.exportedAt || item?.createdAt || ''),
    fileName: String(item?.fileName || ''),
    size: Number(item?.size || 0),
    sha256: String(item?.sha256 || ''),
    sourceVaultCount: Number(item?.sourceVaultCount || 0),
    vaultCount: Number(item?.vaultCount || 0),
    skippedCount: Number(item?.skippedCount || 0),
    skipped: Array.isArray(item?.skipped) ? item.skipped : [],
    reason: String(item?.reason || ''),
  };
}

function normalizeServerSnapshotFileCandidate(item: any): any {
  return {
    vaultId: String(item?.vaultId || ''),
    serverVaultId: String(item?.serverVaultId || ''),
    vaultName: String(item?.vaultName || ''),
    relativePath: String(item?.relativePath || '').replace(/\\/g, '/'),
    source: String(item?.source || 'live'),
    size: Number(item?.size || 0),
    sha256: String(item?.sha256 || ''),
    updatedAt: String(item?.updatedAt || ''),
    recordedAt: String(item?.recordedAt || ''),
    backupId: String(item?.backupId || ''),
    revisionId: String(item?.revisionId || ''),
    action: String(item?.action || ''),
    deleted: !!item?.deleted,
    contentAvailable: !!item?.contentAvailable,
  };
}

function serverSnapshotExportDir(vaultPath: string): string {
  return path.join(path.resolve(vaultPath), ARS_NOTE_DIR, 'server-exports');
}

function safeServerSnapshotFileName(value: unknown): string {
  const base = path.basename(String(value || '').trim() || `ars-note-server-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
  return base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').slice(0, 180) || 'ars-note-server-export.json';
}

async function fetchServerAdminJson(ctx: { resolvedVault: string; endpoint: string }, route: string, init?: RequestInit): Promise<any> {
  const response = await fetch(ctx.endpoint + route, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...selfHostedAuthHeaders(ctx.resolvedVault),
    } as Record<string, string>,
  });
  const data = await response.json() as any;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Server admin API failed: HTTP ${response.status}`);
  }
  return data;
}

async function listServerDataSnapshots(vaultPath: string, limit = 20): Promise<any> {
  const ctx = resolveLiveSyncServerContext(vaultPath);
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));
  const data = await fetchServerAdminJson(ctx, '/api/admin/server/snapshots?limit=' + encodeURIComponent(String(safeLimit)));
  return {
    ok: true,
    endpoint: ctx.endpoint,
    vaultId: ctx.vaultId,
    snapshots: Array.isArray(data.snapshots) ? data.snapshots.map(normalizeServerDataSnapshotItem).filter((item: any) => item.fileName) : [],
  };
}

async function createServerDataSnapshot(vaultPath: string, options?: { reason?: string; keepLatest?: number }): Promise<any> {
  const ctx = resolveLiveSyncServerContext(vaultPath);
  const data = await fetchServerAdminJson(ctx, '/api/admin/server/snapshots/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reason: String(options?.reason || 'desktop-recovery-center'),
      keepLatest: Math.max(1, Math.min(200, Math.floor(Number(options?.keepLatest) || 30))),
    }),
  });
  return {
    ok: true,
    endpoint: ctx.endpoint,
    vaultId: ctx.vaultId,
    snapshot: normalizeServerDataSnapshotItem(data),
  };
}

async function exportServerDataBackup(vaultPath: string): Promise<any> {
  const ctx = resolveLiveSyncServerContext(vaultPath);
  const data = await fetchServerAdminJson(ctx, '/api/admin/server/export');
  if (!data.contentBase64) throw new Error('Server export did not include backup content');
  const buffer = Buffer.from(String(data.contentBase64), 'base64');
  const fileName = safeServerSnapshotFileName(data.fileName);
  const outputDir = serverSnapshotExportDir(ctx.resolvedVault);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, fileName);
  fs.writeFileSync(outputPath, buffer);
  return {
    ok: true,
    endpoint: ctx.endpoint,
    vaultId: ctx.vaultId,
    savedPath: outputPath,
    relativePath: `${ARS_NOTE_DIR}/server-exports/${fileName}`,
    exportedAt: String(data.exportedAt || ''),
    fileName,
    size: Number(data.size || buffer.length),
    sha256: String(data.sha256 || crypto.createHash('sha256').update(buffer).digest('hex')),
    sourceVaultCount: Number(data.sourceVaultCount || 0),
    vaultCount: Number(data.vaultCount || 0),
    skippedCount: Number(data.skippedCount || 0),
    skipped: Array.isArray(data.skipped) ? data.skipped : [],
  };
}

async function listServerSnapshotFiles(vaultPath: string, options?: {
  fileName?: string;
  relativePath?: string;
  query?: string;
  source?: string;
  limit?: number;
}): Promise<any> {
  const ctx = resolveLiveSyncServerContext(vaultPath);
  let fileName = String(options?.fileName || '').trim();
  let snapshot: any | null = null;
  if (!fileName) {
    const list = await listServerDataSnapshots(ctx.resolvedVault, 1);
    snapshot = list.snapshots?.[0] || null;
    fileName = snapshot?.fileName || '';
  }
  if (!fileName) throw new Error('No server snapshot is available yet');

  const params = new URLSearchParams({
    fileName,
    vaultId: ctx.vaultId,
    limit: String(Math.max(1, Math.min(500, Math.floor(Number(options?.limit) || 120)))),
  });
  const rel = String(options?.relativePath || '').replace(/\\/g, '/').trim();
  const query = String(options?.query || '').trim();
  const source = String(options?.source || '').trim();
  if (rel) params.set('relativePath', rel);
  if (query) params.set('q', query);
  if (source === 'live' || source === 'live-history' || source === 'backup') params.set('source', source);

  const data = await fetchServerAdminJson(ctx, '/api/admin/server/snapshots/files?' + params.toString());
  return {
    ok: true,
    endpoint: ctx.endpoint,
    vaultId: ctx.vaultId,
    fileName,
    snapshot,
    files: Array.isArray(data.files) ? data.files.map(normalizeServerSnapshotFileCandidate).filter((item: any) => item.relativePath) : [],
  };
}

async function restoreServerSnapshotFile(vaultPath: string, fileName: string, candidate: any): Promise<any> {
  const ctx = resolveLiveSyncServerContext(vaultPath);
  const rel = String(candidate?.relativePath || '').replace(/\\/g, '/').trim();
  if (!fileName || !rel) throw new Error('Missing server snapshot restore target');
  const data = await fetchServerAdminJson(ctx, '/api/admin/server/snapshots/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName,
      vaultId: String(candidate?.vaultId || ctx.vaultId),
      relativePath: rel,
      source: String(candidate?.source || ''),
      backupId: String(candidate?.backupId || ''),
      revisionId: String(candidate?.revisionId || candidate?.versionId || ''),
    }),
  });

  const file = data.file || {};
  let restoredPath = '';
  if (file.contentBase64 && String(data.vaultId || file.vaultId || ctx.vaultId) === ctx.vaultId) {
    const targetRel = String(file.relativePath || rel).replace(/\\/g, '/');
    const targetPath = path.resolve(path.join(ctx.resolvedVault, targetRel.replace(/\//g, path.sep)));
    if (!isInsidePath(targetPath, ctx.resolvedVault)) throw new Error('Refusing to restore outside vault');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    saveLiveHistoryBeforeOverwrite(targetPath, undefined, 'before-server-snapshot-restore');
    fs.writeFileSync(targetPath, Buffer.from(file.contentBase64, 'base64'));
    restoredPath = targetPath;
  }

  return {
    ok: true,
    endpoint: ctx.endpoint,
    vaultId: data.vaultId || ctx.vaultId,
    fileName,
    restoredPath,
    restoredAt: String(data.restoredAt || file.updatedAt || ''),
    candidate: normalizeServerSnapshotFileCandidate(data.candidate || candidate),
    preOperationSnapshot: data.preOperationSnapshot ? normalizeServerDataSnapshotItem(data.preOperationSnapshot) : null,
  };
}

async function listServerLiveHistory(vaultPath: string, relativePath?: string, limit = 100): Promise<any[]> {
  const ctx = resolveLiveSyncServerContext(vaultPath);
  const params = new URLSearchParams({
    vaultId: ctx.vaultId,
    limit: String(Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)))),
  });
  const rel = String(relativePath || '').replace(/\\/g, '/').trim();
  if (rel) params.set('relativePath', rel);

  const response = await fetch(ctx.endpoint + '/api/admin/live/history?' + params.toString(), {
    headers: selfHostedAuthHeaders(ctx.resolvedVault),
  });
  const data = await response.json() as any;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Server live history failed: HTTP ${response.status}`);
  }

  return Array.isArray(data.history)
    ? data.history.map(normalizeServerHistoryItem).filter((item: any) => item.versionId && item.relativePath)
    : [];
}

async function waitForServerRejectedHistoryMetadata(
  vaultPath: string,
  relativePath: string,
  expectedReason: string,
  expectedDeviceId: string,
  timeoutMs = 6000,
): Promise<{ ok: boolean; reason: string; record: any | null }> {
  const startedAt = Date.now();
  let lastRecord: any | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    const rows = await listServerLiveHistory(vaultPath, relativePath, 20);
    lastRecord = rows.find((row: any) => (
      String(row.serverAction || '').startsWith('rejected-')
      && (!expectedReason || String(row.reason || '').includes(expectedReason))
    )) || rows.find((row: any) => String(row.serverAction || '').startsWith('rejected-')) || null;
    if (lastRecord) {
      const hasClient = !!String(lastRecord.clientId || '').trim();
      const deviceMatches = !expectedDeviceId || String(lastRecord.deviceId || '') === expectedDeviceId;
      if (hasClient && deviceMatches) {
        return {
          ok: true,
          reason: `server rejected history captured client=${lastRecord.clientId || '-'} device=${lastRecord.deviceId || '-'}`,
          record: lastRecord,
        };
      }
    }
    await sleep(500);
  }
  return {
    ok: false,
    reason: lastRecord
      ? `rejected history exists but source metadata is incomplete: client=${lastRecord.clientId || '-'} device=${lastRecord.deviceId || '-'}`
      : 'server rejected history record was not visible before timeout',
    record: lastRecord,
  };
}

async function fetchServerLiveSyncClientMap(vaultPath: string): Promise<Map<string, any>> {
  const ctx = resolveLiveSyncServerContext(vaultPath);
  const response = await fetch(ctx.endpoint + '/api/live-sync/status?vaultId=' + encodeURIComponent(ctx.vaultId) + '&summary=0', {
    headers: selfHostedAuthHeaders(ctx.resolvedVault),
  });
  const data = await response.json() as any;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Server client status failed: HTTP ${response.status}`);
  }
  const rows = Array.isArray(data.clientHistory) && data.clientHistory.length > 0
    ? data.clientHistory
    : (Array.isArray(data.clients) ? data.clients : []);
  const map = new Map<string, any>();
  for (const row of rows) {
    const keys = [
      row?.clientId,
      row?.clientKey,
      row?.deviceId,
    ].map((value) => String(value || '').trim()).filter(Boolean);
    for (const key of keys) {
      if (!map.has(key)) map.set(key, row);
    }
  }
  return map;
}

async function previewServerLiveHistory(vaultPath: string, relativePath: string, versionId: string): Promise<any> {
  const ctx = resolveLiveSyncServerContext(vaultPath);
  const rel = String(relativePath || '').replace(/\\/g, '/').trim();
  const revisionId = String(versionId || '').trim();
  if (!rel || !revisionId) throw new Error('Missing server history target');

  const params = new URLSearchParams({
    vaultId: ctx.vaultId,
    relativePath: rel,
    revisionId,
  });
  const response = await fetch(ctx.endpoint + '/api/admin/live/history/file?' + params.toString(), {
    headers: selfHostedAuthHeaders(ctx.resolvedVault),
  });
  const data = await response.json() as any;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Server history file failed: HTTP ${response.status}`);
  }
  if (!data.contentBase64) throw new Error('Server history content missing');

  const targetPath = path.resolve(path.join(ctx.resolvedVault, rel.replace(/\//g, path.sep)));
  if (!isInsidePath(targetPath, ctx.resolvedVault)) throw new Error('Refusing to preview outside vault');

  const historyBuffer = Buffer.from(data.contentBase64, 'base64');
  const historyPreview = bufferPreviewText(historyBuffer);
  const currentExists = fs.existsSync(targetPath) && fs.statSync(targetPath).isFile();
  const currentStat = currentExists ? fs.statSync(targetPath) : null;
  const currentPreview = currentExists ? readConflictPreviewText(targetPath) : { content: '', truncated: false };
  const base = normalizeServerHistoryItem(data);

  return {
    ...base,
    versionId: data.revisionId || revisionId,
    savedAt: data.recordedAt || data.updatedAt || base.savedAt,
    content: historyPreview.content,
    contentTruncated: historyPreview.truncated,
    currentExists,
    currentSize: currentStat?.size || 0,
    currentModifiedAt: currentStat?.mtime.toISOString() || null,
    currentContent: currentPreview.content,
    currentTruncated: currentPreview.truncated,
    diff: lineDiffSummary(currentPreview.content, historyPreview.content),
  };
}

async function restoreServerLiveHistory(vaultPath: string, relativePath: string, versionId: string): Promise<any> {
  const ctx = resolveLiveSyncServerContext(vaultPath);
  const rel = String(relativePath || '').replace(/\\/g, '/').trim();
  const revisionId = String(versionId || '').trim();
  if (!rel || !revisionId) throw new Error('Missing server history target');

  const response = await fetch(ctx.endpoint + '/api/admin/live/history/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...selfHostedAuthHeaders(ctx.resolvedVault) },
    body: JSON.stringify({ vaultId: ctx.vaultId, relativePath: rel, revisionId }),
  });
  const data = await response.json() as any;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Server history restore failed: HTTP ${response.status}`);
  }

  const file = data.file || {};
  if (!file.contentBase64) {
    return { ok: true, restoredPath: '', serverRestoredAt: data.restoredAt || file.updatedAt || '' };
  }

  const targetPath = path.resolve(path.join(ctx.resolvedVault, String(file.relativePath || rel).replace(/\//g, path.sep)));
  if (!isInsidePath(targetPath, ctx.resolvedVault)) throw new Error('Refusing to restore outside vault');
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  saveLiveHistoryBeforeOverwrite(targetPath, undefined, 'before-server-history-restore');
  fs.writeFileSync(targetPath, Buffer.from(file.contentBase64, 'base64'));

  return {
    ok: true,
    restoredPath: targetPath,
    serverRestoredAt: data.restoredAt || file.updatedAt || '',
  };
}

async function previewServerLiveHistoryBatchRestore(vaultPath: string, options?: any): Promise<any> {
  const ctx = resolveLiveSyncServerContext(vaultPath);
  const opts = normalizeBatchRestoreOptions(options);
  const checkedAt = new Date().toISOString();
  const sinceMs = Date.now() - opts.sinceHours * 60 * 60 * 1000;
  const warnings: string[] = [];

  const serverRows = await listServerLiveHistory(ctx.resolvedVault, undefined, Math.max(opts.limit * 4, 100));
  const candidates = serverRows
    .map((record) => ({ record, savedMs: Date.parse(record.savedAt || '') }))
    .filter(item => Number.isFinite(item.savedMs) && item.savedMs >= sinceMs)
    .filter(item => opts.includeAllReasons || isAccidentRecoveryHistoryReason(item.record))
    .sort((a, b) => b.savedMs - a.savedMs);

  const latestByPath = new Map<string, { record: any; savedMs: number }>();
  for (const item of candidates) {
    const rel = String(item.record.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel || latestByPath.has(rel)) continue;
    latestByPath.set(rel, item);
  }

  const selected = Array.from(latestByPath.values());
  if (selected.length > opts.limit) {
    warnings.push(`Only the newest ${opts.limit} server recoverable files are included. ${selected.length - opts.limit} older file(s) are not shown.`);
  }

  const items = selected.slice(0, opts.limit).map(({ record }) => {
    const rel = String(record.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const targetPath = path.resolve(path.join(ctx.resolvedVault, rel.replace(/\//g, path.sep)));
    let action: 'restore' | 'skip' = 'restore';
    let skipReason = '';
    let currentExists = false;
    let currentSize = 0;
    let currentModifiedAt: string | null = null;
    let currentSha256 = '';
    const historySha = String(record.sha256 || '');

    try {
      if (!rel || !isInsidePath(targetPath, ctx.resolvedVault)) {
        action = 'skip';
        skipReason = 'outside-vault';
      } else if (record.deletedSnapshot) {
        action = 'skip';
        skipReason = 'deleted-snapshot-manual-only';
      } else if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        action = 'skip';
        skipReason = 'target-is-directory';
      } else if (fs.existsSync(targetPath)) {
        const stat = fs.statSync(targetPath);
        currentExists = stat.isFile();
        currentSize = currentExists ? stat.size : 0;
        currentModifiedAt = currentExists ? stat.mtime.toISOString() : null;
        if (currentExists) {
          currentSha256 = fileSha256(targetPath);
          if (historySha && currentSha256 === historySha) {
            action = 'skip';
            skipReason = 'same-content';
          }
        }
      }
    } catch (err: any) {
      action = 'skip';
      skipReason = err?.message || 'inspect-failed';
    }

    return {
      ...record,
      source: 'server',
      currentExists,
      currentSize,
      currentModifiedAt,
      currentSha256,
      action,
      skipReason,
    };
  });

  const restoreCount = items.filter(item => item.action === 'restore').length;
  const skippedCount = items.length - restoreCount;

  return {
    checkedAt,
    source: 'server',
    sinceHours: opts.sinceHours,
    includeAllReasons: opts.includeAllReasons,
    limit: opts.limit,
    totalCandidates: selected.length,
    restoreCount,
    skippedCount,
    items,
    warnings,
  };
}

async function restoreServerLiveHistoryBatch(vaultPath: string, options?: any): Promise<any> {
  const ctx = resolveLiveSyncServerContext(vaultPath);
  const plan = await previewServerLiveHistoryBatchRestore(ctx.resolvedVault, options);
  const restoredFiles: string[] = [];
  const failed: Array<{ relativePath: string; error: string }> = [];

  for (const item of plan.items) {
    if (item.action !== 'restore') continue;
    try {
      const result = await restoreServerLiveHistory(ctx.resolvedVault, item.relativePath, item.versionId);
      if (!result?.restoredPath) throw new Error('Server history restore returned no file content');
      restoredFiles.push(item.relativePath);
    } catch (err: any) {
      failed.push({ relativePath: item.relativePath, error: err?.message || 'server restore failed' });
    }
  }

  return {
    ok: failed.length === 0,
    restoredCount: restoredFiles.length,
    failedCount: failed.length,
    skippedCount: plan.skippedCount,
    restoredFiles,
    failed,
    plan,
  };
}

function planFiles(items: any[] | undefined, limit = 8): string[] {
  return (items || [])
    .filter(item => item?.action !== 'skip')
    .map(item => String(item?.relativePath || '').replace(/\\/g, '/'))
    .filter(Boolean)
    .slice(0, limit);
}

async function previewSyncAccidentRecovery(vaultPath: string, options?: any): Promise<any> {
  const resolvedVault = path.resolve(vaultPath);
  const opts = normalizeBatchRestoreOptions(options);
  const overview = syncRecoveryOverview(resolvedVault);
  const localPlan = previewLiveHistoryBatchRestore(resolvedVault, opts);
  let serverPlan: any | null = null;
  let serverError = '';

  try {
    serverPlan = await previewServerLiveHistoryBatchRestore(resolvedVault, opts);
  } catch (err: any) {
    serverError = err?.message || String(err);
  }

  const serverRestoreCount = Number(serverPlan?.restoreCount || 0);
  const localRestoreCount = Number(localPlan?.restoreCount || 0);
  const conflictCount = Number(overview?.conflict?.count || 0);
  const aiTrashCount = Number(overview?.aiTrash?.count || 0);
  const actions: any[] = [];

  if (conflictCount > 0) {
    actions.push({
      priority: 10,
      source: 'conflict',
      title: '先处理冲突副本',
      detail: '同一文件两边都改过时，冲突副本可能包含被覆盖前的本地内容。先预览/合并，再决定是否批量恢复历史。',
      count: conflictCount,
      recommended: true,
      files: (overview.conflict.files || []).map((file: any) => file.relativePath).filter(Boolean).slice(0, 8),
    });
  }

  if (serverRestoreCount > 0) {
    actions.push({
      priority: 20,
      source: 'server-history',
      title: '优先检查服务器历史',
      detail: '服务器历史代表 NAS 端收到过的版本，适合处理旧电脑覆盖、误删传播、远端更新异常。',
      count: serverRestoreCount,
      recommended: conflictCount === 0,
      files: planFiles(serverPlan.items),
    });
  }

  if (localRestoreCount > 0) {
    actions.push({
      priority: 30,
      source: 'local-history',
      title: '检查本地 live-history',
      detail: '本机每次同步覆盖/删除前保存的版本，适合找回这台电脑上刚刚被覆盖的内容。',
      count: localRestoreCount,
      recommended: conflictCount === 0 && serverRestoreCount === 0,
      files: planFiles(localPlan.items),
    });
  }

  if (aiTrashCount > 0) {
    actions.push({
      priority: 40,
      source: 'ai-trash',
      title: '检查 AI 删除回收副本',
      detail: 'AI 删除文件前会保存回收副本。确认删除确实正确前，不建议清理这些副本。',
      count: aiTrashCount,
      recommended: conflictCount === 0 && serverRestoreCount === 0 && localRestoreCount === 0,
      files: (overview.aiTrash.files || []).map((file: any) => file.originalRelativePath || file.relativePath).filter(Boolean).slice(0, 8),
    });
  }

  if (actions.length === 0) {
    actions.push({
      priority: 90,
      source: 'manual',
      title: '未发现明显事故恢复项',
      detail: '没有找到近期冲突、误删快照、可恢复历史或 AI 回收副本。若仍然缺文件，请从服务器快照或完整备份中按文件名搜索。',
      count: 0,
      recommended: true,
      files: [],
    });
  }

  const recommendedSource = actions.find(action => action.recommended)?.source || 'none';
  const warnings = [
    ...(localPlan?.warnings || []),
    ...(serverPlan?.warnings || []),
  ];
  if (serverError) warnings.push(`Server history unavailable: ${serverError}`);

  const riskLevel = conflictCount > 0 || serverRestoreCount > 0 || localRestoreCount > 0
    ? 'danger'
    : (aiTrashCount > 0 || serverError ? 'watch' : 'ok');

  return {
    checkedAt: new Date().toISOString(),
    sinceHours: opts.sinceHours,
    riskLevel,
    recommendedSource: recommendedSource === 'manual' ? 'none' : recommendedSource,
    summary: {
      conflictCount,
      localRestoreCount,
      serverRestoreCount,
      aiTrashCount,
      localDeletedCount: Number(localPlan?.items?.filter((item: any) => item.deletedSnapshot && item.action !== 'skip').length || 0),
      serverDeletedCount: Number(serverPlan?.items?.filter((item: any) => item.deletedSnapshot && item.action !== 'skip').length || 0),
    },
    actions: actions.sort((a, b) => a.priority - b.priority),
    localPlan,
    serverPlan,
    serverError,
    warnings,
  };
}

function recoveryCandidateTimeMs(candidate: any): number {
  const raw = candidate?.savedAt || candidate?.modifiedAt || candidate?.updatedAt || candidate?.versionId || '';
  const parsed = Date.parse(String(raw || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeRecoveryCandidatePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function addRecoveryCandidate(groups: Map<string, any[]>, relativePath: string, candidate: any): void {
  const rel = normalizeRecoveryCandidatePath(relativePath);
  if (!rel || rel.startsWith(`${ARS_NOTE_DIR}/`)) return;
  const rows = groups.get(rel) || [];
  rows.push({
    ...candidate,
    relativePath: rel,
    timeMs: recoveryCandidateTimeMs(candidate),
  });
  groups.set(rel, rows);
}

function currentFileRecoveryCandidate(vaultPath: string, relativePath: string): any | null {
  const resolvedVault = path.resolve(vaultPath);
  const rel = normalizeRecoveryCandidatePath(relativePath);
  if (!rel) return null;
  const fullPath = path.resolve(path.join(resolvedVault, rel.replace(/\//g, path.sep)));
  if (!isInsidePath(fullPath, resolvedVault) || !fs.existsSync(fullPath)) return null;
  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) return null;
  return {
    source: 'current',
    sourceRole: 'current-local',
    relativePath: rel,
    label: '当前本机文件',
    sha256: fileSha256(fullPath),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    timeMs: stat.mtimeMs,
    restorable: false,
  };
}

function recoveryAdvisorActionForSource(source: string): string {
  if (source === 'server-history') return 'restore-server-history';
  if (source === 'local-history') return 'restore-local-history';
  if (source === 'protected-local') return 'restore-protected-local';
  if (source === 'ai-trash') return 'review-ai-trash';
  if (source === 'conflict') return 'merge-conflict';
  return 'keep-current';
}

function recoveryAdvisorActionLabel(action: string): string {
  if (action === 'restore-server-history') return '恢复服务器历史版本';
  if (action === 'restore-local-history') return '恢复本地历史版本';
  if (action === 'restore-protected-local') return '恢复受保护本地差异';
  if (action === 'review-ai-trash') return '检查 AI 删除回收副本';
  if (action === 'merge-conflict') return '预览并合并冲突';
  if (action === 'resolve-conflict-latest') return '以最新版本解决冲突';
  return '保留当前版本';
}

function canApplyRecoveryAdvisorAction(action: string): boolean {
  return action === 'resolve-conflict-latest'
    || action === 'merge-conflict'
    || action === 'restore-server-history'
    || action === 'restore-local-history'
    || action === 'restore-protected-local';
}

function isHiddenSyncRecoveryConflictCandidate(candidate: any): boolean {
  const recoveryRelativePath = normalizeRecoveryCandidatePath(candidate?.recoveryRelativePath || candidate?.relativePath || '');
  return !!candidate?.hiddenRecoveryCopy || isLiveSyncRecoveryArchivePath(recoveryRelativePath);
}

function selectRecoveryAdvisorRecommendation(relativePath: string, candidates: any[]): any {
  const current = candidates.find(item => item.source === 'current') || null;
  const conflict = candidates
    .filter(item => item.source === 'conflict')
    .sort((a, b) => b.timeMs - a.timeMs)[0] || null;
  if (conflict) {
    if (isHiddenSyncRecoveryConflictCandidate(conflict)) {
      return {
        relativePath,
        recommendedAction: 'merge-conflict',
        recommendedLabel: recoveryAdvisorActionLabel('merge-conflict'),
        confidence: 'medium',
        reason: 'This conflict copy is already protected inside Sync Recovery Center. Keep the server/current timeline live and create a merge draft instead of auto-overwriting by file time.',
        candidate: conflict,
        candidates,
        canApply: false,
      };
    }
    const latestDeltaMs = current ? Math.abs((conflict.timeMs || 0) - (current.timeMs || 0)) : Number.POSITIVE_INFINITY;
    if (!current || latestDeltaMs >= 30_000) {
      const conflictIsNewer = !current || (conflict.timeMs || 0) > (current.timeMs || 0);
      return {
        relativePath,
        recommendedAction: 'resolve-conflict-latest',
        recommendedLabel: recoveryAdvisorActionLabel('resolve-conflict-latest'),
        confidence: latestDeltaMs >= 5 * 60_000 || !current ? 'high' : 'medium',
        reason: conflictIsNewer
          ? '发现冲突副本且它明显更新；可自动采用较新的冲突副本，并保留被覆盖前的历史。'
          : '发现冲突副本但当前文件明显更新；可自动保留当前文件，并清理较旧的冲突副本。',
        candidate: conflict,
        candidates,
        canApply: true,
      };
    }
    return {
      relativePath,
      recommendedAction: 'merge-conflict',
      recommendedLabel: recoveryAdvisorActionLabel('merge-conflict'),
      confidence: 'medium',
      reason: '发现冲突副本，说明同一文件在不同设备上都有修改；应先预览两边内容再合并。',
      candidate: conflict,
      candidates,
      canApply: false,
    };
  }

  const recoverable = candidates
    .filter(item => item.source !== 'current')
    .sort((a, b) => b.timeMs - a.timeMs);
  const best = recoverable[0] || null;
  if (!best) {
    return {
      relativePath,
      recommendedAction: 'keep-current',
      recommendedLabel: recoveryAdvisorActionLabel('keep-current'),
      confidence: 'high',
      reason: '没有发现可恢复的冲突副本、历史版本或回收副本。',
      candidate: current,
      candidates,
      canApply: false,
    };
  }

  if (current?.sha256 && best?.sha256 && current.sha256 === best.sha256) {
    return {
      relativePath,
      recommendedAction: 'keep-current',
      recommendedLabel: recoveryAdvisorActionLabel('keep-current'),
      confidence: 'high',
      reason: '当前文件内容已经和推荐候选版本一致，不需要恢复。',
      candidate: current,
      candidates,
      canApply: false,
    };
  }

  if (current && current.timeMs >= best.timeMs && best.source !== 'protected-local' && best.source !== 'ai-trash') {
    return {
      relativePath,
      recommendedAction: 'keep-current',
      recommendedLabel: recoveryAdvisorActionLabel('keep-current'),
      confidence: 'medium',
      reason: '当前本机文件比可恢复候选版本更新；先保留当前版本，需要时再手动查看历史。',
      candidate: current,
      candidates,
      canApply: false,
    };
  }

  const action = recoveryAdvisorActionForSource(best.source);
  const reasonByAction: Record<string, string> = {
    'restore-server-history': '服务器历史版本最新或更可信，适合处理旧电脑覆盖、误删传播或远端更新异常。',
    'restore-local-history': '本地 live-history 中有更可疑的事故前版本，适合恢复这台电脑刚被覆盖或删除前的内容。',
    'restore-protected-local': '服务器接管时保护了本机差异；这通常是旧电脑未上传的本地版本，需要恢复到本机后再人工确认。',
    'review-ai-trash': 'AI 删除前留下了回收副本；恢复前应确认这不是一次有意删除。',
  };

  return {
    relativePath,
    recommendedAction: action,
    recommendedLabel: recoveryAdvisorActionLabel(action),
    confidence: best.source === 'server-history' ? 'high' : 'medium',
    reason: reasonByAction[action] || '发现可恢复候选版本，建议先检查后恢复。',
    candidate: best,
    candidates,
    canApply: canApplyRecoveryAdvisorAction(action),
  };
}

function recoveryAdvisorMarkdown(plan: any): string {
  const lines = [
    '# Ars-note Sync Recovery Advisor',
    '',
    `Checked at: ${plan.checkedAt}`,
    `Risk: ${plan.riskLevel}`,
    '',
    '## Summary',
    `- Files reviewed: ${plan.summary.totalFiles}`,
    `- Can apply now: ${plan.summary.applyReadyCount}`,
    `- Needs merge/review: ${plan.summary.reviewCount}`,
    `- Keep current: ${plan.summary.keepCurrentCount}`,
    '',
    '## Recommendations',
  ];
  for (const item of plan.items.slice(0, 80)) {
    const candidateSummary = item.candidates.map((candidate: any) => {
      const parts = [
        candidate.sourceRole || '',
        candidate.source,
        candidate.serverRevision ? `rev ${candidate.serverRevision}` : '',
        candidate.revisionId || candidate.versionId ? `id ${String(candidate.revisionId || candidate.versionId).slice(0, 24)}` : '',
        candidate.deviceName ? `device ${candidate.deviceName}` : '',
        candidate.clientId ? `client ${String(candidate.clientId).slice(0, 24)}` : '',
        candidate.appVersion ? `app ${candidate.appVersion}` : '',
        candidate.savedAt || candidate.modifiedAt ? `@ ${candidate.savedAt || candidate.modifiedAt}` : '',
      ].filter(Boolean);
      return parts.join(' ');
    }).join(', ');
    lines.push(
      '',
      `### ${item.relativePath}`,
      `- Recommendation: ${item.recommendedLabel}`,
      `- Confidence: ${item.confidence}`,
      `- Reason: ${item.reason}`,
      `- Candidates: ${candidateSummary}`,
    );
  }
  if (plan.warnings.length) {
    lines.push('', '## Warnings', ...plan.warnings.map((item: string) => `- ${item}`));
  }
  lines.push('', '> Generated by Ars-note Sync Recovery Advisor. Review before applying destructive changes.');
  return lines.join('\n');
}

function recoveryAdvisorBatchSkipReason(item: any, includeMedium: boolean): string {
  if (!item?.canApply) return '需要人工检查或只能生成合并草稿';
  const action = String(item?.recommendedAction || '');
  if (action === 'merge-conflict') return '两边修改时间太接近，先生成合并草稿再审核';
  if (action === 'review-ai-trash') return 'AI 删除回收副本需要人工确认';
  if (action === 'keep-current') return '当前版本已是建议结果';
  if (!includeMedium && item?.confidence !== 'high') return '置信度不是 high，未自动执行';
  return '';
}

function canBatchApplyRecoveryAdvisorItem(item: any, includeMedium: boolean): boolean {
  if (!item?.canApply) return false;
  const action = String(item?.recommendedAction || '');
  if (action === 'merge-conflict' || action === 'review-ai-trash' || action === 'keep-current') return false;
  if (!includeMedium && item?.confidence !== 'high') return false;
  return true;
}

function writeRecoveryAdvisorBatchReport(
  vaultPath: string,
  plan: any,
  result: {
    applied: any[];
    drafted: any[];
    failed: any[];
    skipped: any[];
    includeMedium: boolean;
  },
): { reportPath: string; reportRelativePath: string } {
  const resolvedVault = path.resolve(vaultPath);
  const reportDir = path.join(resolvedVault, ARS_NOTE_DIR, SYNC_RECOVERY_DIR, 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(reportDir, `sync-recovery-advisor-${stamp}.md`);
  const reportRelativePath = path.relative(resolvedVault, reportPath).replace(/\\/g, '/');
  const lines = [
    '# Ars-note Sync Recovery Batch Report',
    '',
    `Created: ${new Date().toISOString()}`,
    `Mode: ${result.includeMedium ? 'high-and-medium-confidence' : 'high-confidence-only'}`,
    `Applied: ${result.applied.length}`,
    `Merge drafts: ${result.drafted.length}`,
    `Failed: ${result.failed.length}`,
    `Skipped: ${result.skipped.length}`,
    '',
    '## Applied',
    ...(result.applied.length
      ? result.applied.map((item) => `- ${item.relativePath} — ${item.recommendedLabel || item.action || 'applied'}${item.result?.draftRelativePath ? `; draft=${item.result.draftRelativePath}` : ''}`)
      : ['- None']),
    '',
    '## Merge Drafts',
    ...(result.drafted.length
      ? result.drafted.map((item) => `- ${item.relativePath} - ${item.recommendedLabel || item.action || 'drafted'}; draft=${item.result?.draftRelativePath || '-'}`)
      : ['- None']),
    '',
    '## Failed',
    ...(result.failed.length
      ? result.failed.map((item) => `- ${item.relativePath} — ${item.recommendedLabel || item.action || 'failed'}: ${item.error}`)
      : ['- None']),
    '',
    '## Skipped',
    ...(result.skipped.length
      ? result.skipped.slice(0, 120).map((item) => `- ${item.relativePath} — ${item.recommendedLabel || item.action || 'skipped'}: ${item.reason}`)
      : ['- None']),
    '',
    '---',
    '',
    plan.reportMarkdown || recoveryAdvisorMarkdown(plan),
    '',
    '> Batch apply never deletes server files. AI delete_file/delete_files publish normal Live Sync delete records after user confirmation; broader recovery cleanup stays guarded.',
  ];
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf-8');
  return { reportPath, reportRelativePath };
}

async function previewSyncRecoveryAdvisor(vaultPath: string, options?: any): Promise<any> {
  const resolvedVault = path.resolve(vaultPath);
  const opts = normalizeBatchRestoreOptions(options);
  const overview = syncRecoveryOverview(resolvedVault);
  const groups = new Map<string, any[]>();
  const warnings: string[] = [];

  for (const file of overview.conflict?.files || []) {
    try {
      const resolved = resolveConflictArtifact(resolvedVault, file.relativePath);
      addRecoveryCandidate(groups, resolved.baseRelativePath, {
        source: 'conflict',
        sourceRole: 'conflict-copy',
        label: '冲突副本',
        recoveryRelativePath: file.relativePath,
        hiddenRecoveryCopy: !!file.hiddenRecoveryCopy,
        reason: file.reason,
        size: file.size,
        modifiedAt: file.modifiedAt,
        restorable: false,
      });
    } catch (err: any) {
      warnings.push(`Conflict candidate skipped: ${file.relativePath}: ${err?.message || err}`);
    }
  }

  for (const file of overview.protectedLocal?.files || []) {
    addRecoveryCandidate(groups, file.originalRelativePath, {
      source: 'protected-local',
      sourceRole: 'protected-local',
      label: '受保护本地差异',
      recoveryRelativePath: file.relativePath,
      reason: file.reason,
      size: file.size,
      modifiedAt: file.modifiedAt,
      restorable: true,
    });
  }

  for (const file of overview.aiTrash?.files || []) {
    const originalRelativePath = file.originalRelativePath || originalPathFromAITrashRelativePath(file.relativePath);
    addRecoveryCandidate(groups, originalRelativePath, {
      source: 'ai-trash',
      sourceRole: 'ai-trash',
      label: 'AI 删除回收副本',
      recoveryRelativePath: file.relativePath,
      size: file.size,
      modifiedAt: file.modifiedAt,
      restorable: true,
    });
  }

  const localPlan = previewLiveHistoryBatchRestore(resolvedVault, opts);
  for (const item of localPlan.items || []) {
    if (item.action === 'skip') continue;
    addRecoveryCandidate(groups, item.relativePath, {
      source: 'local-history',
      sourceRole: 'same-computer-history',
      label: '本地历史版本',
      versionId: item.versionId,
      savedAt: item.savedAt,
      reason: item.reason,
      deletedSnapshot: !!item.deletedSnapshot,
      sha256: item.sha256,
      size: item.size,
      restorable: true,
    });
  }

  let serverPlan: any | null = null;
  let serverError = '';
  let serverClientMap = new Map<string, any>();
  const liveStatus = getLiveSyncStatus();
  const currentLiveClientId = String(liveStatus?.clientId || '');
  try {
    serverPlan = await previewServerLiveHistoryBatchRestore(resolvedVault, opts);
    try {
      serverClientMap = await fetchServerLiveSyncClientMap(resolvedVault);
    } catch {
      serverClientMap = new Map<string, any>();
    }
    for (const item of serverPlan.items || []) {
      if (item.action === 'skip') continue;
      const clientInfo = serverClientMap.get(String(item.clientId || '')) || serverClientMap.get(String(item.deviceId || '')) || null;
      const sourceRole = currentLiveClientId && [item.clientId, item.deviceId, clientInfo?.clientId, clientInfo?.deviceId]
        .map((value) => String(value || ''))
        .some((value) => value && value === currentLiveClientId)
        ? 'same-computer-history'
        : 'other-computer-history';
      addRecoveryCandidate(groups, item.relativePath, {
        source: 'server-history',
        sourceRole,
        label: '服务器历史版本',
        versionId: item.versionId,
        revisionId: item.revisionId || item.versionId,
        serverRevision: item.serverRevision,
        clientId: item.clientId,
        deviceId: item.deviceId,
        deviceName: clientInfo?.deviceName || clientInfo?.deviceId || '',
        clientKey: clientInfo?.clientKey || '',
        appVersion: clientInfo?.appVersion || '',
        savedAt: item.savedAt,
        updatedAt: item.serverUpdatedAt,
        reason: item.reason,
        deletedSnapshot: !!item.deletedSnapshot,
        sha256: item.sha256,
        size: item.size,
        tombstoneExpiresAt: item.tombstoneExpiresAt,
        restorable: true,
      });
    }
  } catch (err: any) {
    serverError = err?.message || String(err);
    warnings.push(`Server history unavailable: ${serverError}`);
  }

  for (const relativePath of Array.from(groups.keys())) {
    const current = currentFileRecoveryCandidate(resolvedVault, relativePath);
    if (current) addRecoveryCandidate(groups, relativePath, current);
  }

  const items = Array.from(groups.entries())
    .map(([relativePath, candidates]) => selectRecoveryAdvisorRecommendation(relativePath, candidates.sort((a, b) => b.timeMs - a.timeMs)))
    .sort((a, b) => {
      const order: Record<string, number> = {
        'resolve-conflict-latest': 10,
        'merge-conflict': 20,
        'restore-server-history': 30,
        'restore-protected-local': 40,
        'restore-local-history': 50,
        'review-ai-trash': 60,
        'keep-current': 90,
      };
      return (order[a.recommendedAction] || 80) - (order[b.recommendedAction] || 80)
        || b.candidates[0]?.timeMs - a.candidates[0]?.timeMs;
    })
    .slice(0, opts.limit);

  const summary = {
    totalFiles: items.length,
    applyReadyCount: items.filter(item => item.canApply).length,
    reviewCount: items.filter(item => item.recommendedAction === 'merge-conflict' || item.recommendedAction === 'review-ai-trash').length,
    keepCurrentCount: items.filter(item => item.recommendedAction === 'keep-current').length,
    serverRecommendedCount: items.filter(item => item.recommendedAction === 'restore-server-history').length,
    localRecommendedCount: items.filter(item => item.recommendedAction === 'restore-local-history').length,
    protectedLocalRecommendedCount: items.filter(item => item.recommendedAction === 'restore-protected-local').length,
  };
  const riskLevel = summary.reviewCount > 0 || summary.applyReadyCount > 0
    ? 'danger'
    : (serverError ? 'watch' : 'ok');
  const plan: any = {
    checkedAt: new Date().toISOString(),
    sinceHours: opts.sinceHours,
    riskLevel,
    summary,
    items,
    localPlan,
    serverPlan,
    serverError,
    warnings,
    reportMarkdown: '',
  };
  plan.reportMarkdown = recoveryAdvisorMarkdown(plan);
  return plan;
}

async function applySyncRecoveryAdvisorItem(vaultPath: string, item: any): Promise<any> {
  const resolvedVault = path.resolve(vaultPath);
  const action = String(item?.recommendedAction || '');
  const candidate = item?.candidate || {};
  const rel = normalizeRecoveryCandidatePath(item?.relativePath || candidate.relativePath || '');
  if (!rel) throw new Error('Missing advisor recovery target');

  if (action === 'restore-server-history') {
    if (!candidate.versionId) throw new Error('Missing server history version');
    return restoreServerLiveHistory(resolvedVault, rel, candidate.versionId);
  }
  if (action === 'restore-local-history') {
    if (!candidate.versionId) throw new Error('Missing local history version');
    return restoreLiveHistory(resolvedVault, rel, candidate.versionId);
  }
  if (action === 'restore-protected-local') {
    if (!candidate.recoveryRelativePath) throw new Error('Missing protected local recovery file');
    return restoreProtectedLocalRecoveryCopy(resolvedVault, candidate.recoveryRelativePath);
  }
  if (action === 'merge-conflict') {
    const conflictRelativePath = normalizeRecoveryCandidatePath(candidate.recoveryRelativePath || candidate.relativePath || '');
    if (!conflictRelativePath) throw new Error('Missing conflict recovery file');
    return createConflictMergeDraftResult(resolvedVault, conflictRelativePath);
  }
  if (action === 'resolve-conflict-latest') {
    const conflictRelativePath = normalizeRecoveryCandidatePath(candidate.recoveryRelativePath || candidate.relativePath || '');
    if (!conflictRelativePath) throw new Error('Missing conflict recovery file');
    return resolveConflictByLatestResult(resolvedVault, conflictRelativePath);
  }
  throw new Error(`Advisor action requires manual review: ${action || 'unknown'}`);
}

async function applySyncRecoveryAdvisorPlan(vaultPath: string, options?: any): Promise<any> {
  const resolvedVault = path.resolve(vaultPath);
  const includeMedium = !!options?.includeMedium;
  const applyLimitRaw = Number(options?.applyLimit || options?.limit || 80);
  const applyLimit = Number.isFinite(applyLimitRaw)
    ? Math.max(1, Math.min(200, Math.floor(applyLimitRaw)))
    : 80;
  const plan = await previewSyncRecoveryAdvisor(resolvedVault, {
    ...options,
    limit: Math.max(applyLimit, Number(options?.limit || 120) || 120),
  });
  const applied: any[] = [];
  const drafted: any[] = [];
  const failed: any[] = [];
  const skipped: any[] = [];
  const eligible = plan.items.filter((item: any) => canBatchApplyRecoveryAdvisorItem(item, includeMedium)).slice(0, applyLimit);
  const eligibleKeys = new Set(eligible.map((item: any) => `${item.relativePath}\0${item.recommendedAction}`));
  const generateMergeDrafts = options?.generateMergeDrafts !== false;

  for (const item of plan.items) {
    const key = `${item.relativePath}\0${item.recommendedAction}`;
    if (eligibleKeys.has(key)) continue;
    if (generateMergeDrafts && item?.recommendedAction === 'merge-conflict') {
      try {
        const candidate = item?.candidate || {};
        const conflictRelativePath = normalizeRecoveryCandidatePath(candidate.recoveryRelativePath || candidate.relativePath || '');
        if (!conflictRelativePath) throw new Error('Missing conflict recovery file');
        const result = createConflictMergeDraftResult(resolvedVault, conflictRelativePath, { reuseExisting: true });
        drafted.push({
          relativePath: item.relativePath,
          recommendedAction: item.recommendedAction,
          recommendedLabel: item.recommendedLabel,
          confidence: item.confidence,
          result,
        });
        skipped.push({
          relativePath: item.relativePath,
          recommendedAction: item.recommendedAction,
          recommendedLabel: item.recommendedLabel,
          confidence: item.confidence,
          reason: result.reused
            ? `merge draft already exists: ${result.draftRelativePath || '-'}`
            : `merge draft created: ${result.draftRelativePath || '-'}`,
        });
        continue;
      } catch (err: any) {
        failed.push({
          relativePath: item.relativePath,
          recommendedAction: item.recommendedAction,
          recommendedLabel: item.recommendedLabel,
          confidence: item.confidence,
          error: err?.message || String(err),
        });
        continue;
      }
    }
    const reason = recoveryAdvisorBatchSkipReason(item, includeMedium);
    skipped.push({
      relativePath: item.relativePath,
      recommendedAction: item.recommendedAction,
      recommendedLabel: item.recommendedLabel,
      confidence: item.confidence,
      reason: reason || '超过本次批量处理上限',
    });
  }

  for (const item of eligible) {
    try {
      const result = await applySyncRecoveryAdvisorItem(resolvedVault, item);
      applied.push({
        relativePath: item.relativePath,
        recommendedAction: item.recommendedAction,
        recommendedLabel: item.recommendedLabel,
        confidence: item.confidence,
        result,
      });
    } catch (err: any) {
      failed.push({
        relativePath: item.relativePath,
        recommendedAction: item.recommendedAction,
        recommendedLabel: item.recommendedLabel,
        confidence: item.confidence,
        error: err?.message || String(err),
      });
    }
  }

  const report = writeRecoveryAdvisorBatchReport(resolvedVault, plan, {
    applied,
    drafted,
    failed,
    skipped,
    includeMedium,
  });
  const nextPlan = await previewSyncRecoveryAdvisor(resolvedVault, options);
  return {
    ok: failed.length === 0,
    checkedAt: new Date().toISOString(),
    mode: includeMedium ? 'high-and-medium-confidence' : 'high-confidence-only',
    appliedCount: applied.length,
    draftedCount: drafted.length,
    failedCount: failed.length,
    skippedCount: skipped.length,
    applied,
    drafted,
    failed,
    skipped: skipped.slice(0, 80),
    reportPath: report.reportPath,
    reportRelativePath: report.reportRelativePath,
    planSummary: plan.summary,
    nextSummary: nextPlan.summary,
    nextPlan,
  };
}

async function runSafeSyncRecoveryAutopilot(vaultPath: string, options?: any): Promise<any> {
  const resolvedVault = path.resolve(vaultPath);
  const defaults = {
    sinceHours: 720,
    includeAllReasons: false,
    limit: 160,
    applyLimit: 80,
    includeMedium: false,
    generateMergeDrafts: true,
  };
  const safeOptions = {
    ...defaults,
    ...(options || {}),
    includeMedium: !!options?.includeMedium,
  };
  const archived = archiveConflictArtifacts(resolvedVault);
  const result = await applySyncRecoveryAdvisorPlan(resolvedVault, safeOptions);
  const overview = syncRecoveryOverview(resolvedVault);
  return {
    ok: !!result.ok,
    checkedAt: new Date().toISOString(),
    mode: 'safe-high-confidence-autopilot',
    archivedConflicts: {
      archivedCount: archived.archivedCount,
      archivedSize: archived.archivedSize,
      archiveRelativePath: archived.archiveRelativePath,
    },
    appliedCount: result.appliedCount || 0,
    draftedCount: result.draftedCount || 0,
    failedCount: result.failedCount || 0,
    skippedCount: result.skippedCount || 0,
    reportRelativePath: result.reportRelativePath || '',
    planSummary: result.planSummary,
    nextSummary: result.nextSummary,
    nextPlan: result.nextPlan,
    overview,
    drafted: Array.isArray(result.drafted) ? result.drafted : [],
    failed: Array.isArray(result.failed) ? result.failed : [],
    skipped: Array.isArray(result.skipped) ? result.skipped : [],
  };
}

async function waitForRemoteLiveFile(
  vaultPath: string,
  serverUrl: string,
  vaultId: string,
  relativePath: string,
  predicate: (file: any | undefined) => boolean,
  timeoutMs = 9000,
): Promise<any | undefined> {
  const startedAt = Date.now();
  let lastFile: any | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    const files = await fetchLiveSyncFiles(vaultPath, serverUrl, vaultId);
    lastFile = files.find((file: any) => file.relativePath === relativePath);
    if (predicate(lastFile)) return lastFile;
    await sleep(500);
  }
  return lastFile;
}

function readLocalLiveSyncBaselineEntry(vaultPath: string, relativePath: string): any | undefined {
  const resolvedVault = path.resolve(vaultPath);
  const normalizedRel = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalizedRel) return undefined;
  const statePath = path.join(resolvedVault, ARS_NOTE_DIR, LIVE_SYNC_STATE_FILE);
  const baseline = readJsonSafe<any>(statePath, null);
  const files = baseline && typeof baseline === 'object' && baseline.files && typeof baseline.files === 'object'
    ? baseline.files
    : {};
  return files[normalizedRel];
}

async function waitForLocalLiveSyncBaselineEntry(
  vaultPath: string,
  relativePath: string,
  predicate: (entry: any | undefined) => boolean,
  timeoutMs = 5000,
): Promise<any | undefined> {
  const startedAt = Date.now();
  let lastEntry: any | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    lastEntry = readLocalLiveSyncBaselineEntry(vaultPath, relativePath);
    if (predicate(lastEntry)) return lastEntry;
    await sleep(250);
  }
  return lastEntry;
}

async function waitForLocalDeleteRecoveryHistory(
  vaultPath: string,
  relativePath: string,
  expectedSha256: string,
  timeoutMs = 5000,
): Promise<any | undefined> {
  const normalizedRel = relativePath.replace(/\\/g, '/');
  const startedAt = Date.now();
  let lastDeletedRecord: any | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    const rows = listLiveHistory(vaultPath, normalizedRel);
    const deletedRows = rows.filter(row => row.deletedSnapshot);
    const exactRecord = deletedRows.find(row => !expectedSha256 || row.sha256 === expectedSha256);
    lastDeletedRecord = exactRecord || deletedRows[0] || lastDeletedRecord;

    if (exactRecord) {
      try {
        const preview = previewLiveHistory(vaultPath, normalizedRel, exactRecord.versionId);
        if (!expectedSha256 || preview.sha256 === expectedSha256) return exactRecord;
      } catch {
        return exactRecord;
      }
    }

    await sleep(250);
  }

  return lastDeletedRecord;
}

async function waitForServerDeleteRecoveryHistory(
  vaultPath: string,
  relativePath: string,
  expectedSha256: string,
  timeoutMs = 8000,
): Promise<{ record?: any; preview?: any; error?: string } | undefined> {
  const normalizedRel = relativePath.replace(/\\/g, '/');
  const startedAt = Date.now();
  let lastResult: { record?: any; preview?: any; error?: string } | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const rows = await listServerLiveHistory(vaultPath, normalizedRel, 50);
      const deletedRows = rows.filter((row: any) => row?.deletedSnapshot);
      const exactRecord = deletedRows.find((row: any) => !expectedSha256 || row.sha256 === expectedSha256);
      const record = exactRecord || deletedRows[0];

      if (record) {
        lastResult = { record };
        if (exactRecord && record.versionId) {
          try {
            const preview = await previewServerLiveHistory(vaultPath, normalizedRel, record.versionId);
            lastResult = { record, preview };
            if (!expectedSha256 || preview.sha256 === expectedSha256) return lastResult;
          } catch (err: any) {
            lastResult = { record, error: err?.message || String(err) };
          }
        }
      }
    } catch (err: any) {
      lastResult = { error: err?.message || String(err) };
    }

    await sleep(500);
  }

  return lastResult;
}

ipcMain.handle('live-sync:self-test', async (_e, vaultPath: string) => {
  const startedAt = Date.now();
  const steps: Array<{ name: string; ok: boolean; detail: string; durationMs?: number }> = [];
  const addStep = (name: string, ok: boolean, detail: string, stepStartedAt?: number) => {
    steps.push({
      name,
      ok,
      detail,
      durationMs: stepStartedAt ? Date.now() - stepStartedAt : undefined,
    });
  };

  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      steps: [{ name: 'vault', ok: false, detail: 'Invalid vault path' }],
    };
  }

  const resolvedVault = path.resolve(vaultPath);
  const config = loadLiveSyncConfig(resolvedVault);
  const status = getLiveSyncStatus();
  const serverUrl = status?.serverUrl || config?.serverUrl || '';
  const vaultId = status?.vaultId || config?.vaultId || '';
  const testDir = path.join(resolvedVault, '__ars_note_sync_test__');
  const testName = 'self_test_' + Date.now() + '.md';
  const relativePath = ('__ars_note_sync_test__/' + testName).replace(/\\/g, '/');
  const filePath = path.join(testDir, testName);
  const cleanupFiles = new Set<string>([filePath]);
  const cleanupDirs = new Set<string>([testDir]);

  try {
    const configStepAt = Date.now();
    if (!serverUrl || !vaultId) {
      addStep('config', false, 'Live Sync is not configured', configStepAt);
      return {
        ok: false,
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        steps,
      };
    }
    addStep('config', true, `vaultId=${vaultId}`, configStepAt);

    const connectionStepAt = Date.now();
    if (!status?.connected) {
      addStep('connection', false, 'Live Sync is not connected. Connect first, then run the self-test.', connectionStepAt);
      return {
        ok: false,
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        steps,
      };
    }
    addStep('connection', true, `client=${status.clientId}`, connectionStepAt);

    const snapshotUploadGateStepAt = Date.now();
    const blocksBeforeSnapshot = !canSendLiveWriteAfterPreflight({
      connected: true,
      socketReady: true,
      receivedRemoteSnapshot: false,
      preflightComplete: true,
      uploadFrozen: false,
    });
    const allowsAfterSnapshot = canSendLiveWriteAfterPreflight({
      connected: true,
      socketReady: true,
      receivedRemoteSnapshot: true,
      preflightComplete: true,
      uploadFrozen: false,
    });
    const blocksWhenFrozen = !canSendLiveWriteAfterPreflight({
      connected: true,
      socketReady: true,
      receivedRemoteSnapshot: true,
      preflightComplete: true,
      uploadFrozen: true,
    });
    const snapshotUploadGateOk = blocksBeforeSnapshot && allowsAfterSnapshot && blocksWhenFrozen;
    addStep(
      'remoteSnapshotUploadGate',
      snapshotUploadGateOk,
      snapshotUploadGateOk
        ? 'client upload gate requires the server snapshot before any queued/local write can flush'
        : 'client upload gate can be opened without the server snapshot; old/empty local data could upload too early',
      snapshotUploadGateStepAt,
    );

    const missingBaseQueueGateStepAt = Date.now();
    const missingBaseQueueGateOk = shouldHoldMissingBaseQueuedWriteInJoin({
      connectionMode: 'join',
      hasFileBaseline: false,
      queuedAfterPreflight: false,
      action: 'create',
    }) && shouldHoldMissingBaseQueuedWriteInJoin({
      connectionMode: 'join',
      hasFileBaseline: false,
      queuedAfterPreflight: true,
      action: 'update',
    }) && !shouldHoldMissingBaseQueuedWriteInJoin({
      connectionMode: 'join',
      hasFileBaseline: false,
      queuedAfterPreflight: true,
      action: 'create',
    }) && !shouldHoldMissingBaseQueuedWriteInJoin({
      connectionMode: 'join',
      hasFileBaseline: true,
      queuedAfterPreflight: false,
      action: 'update',
    }) && !shouldHoldMissingBaseQueuedWriteInJoin({
      connectionMode: 'rebuild',
      hasFileBaseline: false,
      queuedAfterPreflight: false,
      action: 'create',
    });
    addStep(
      'joinMissingBaseQueuedWriteGate',
      missingBaseQueueGateOk,
      missingBaseQueueGateOk
        ? 'join mode holds missing-base writes queued before server adoption, while allowing post-preflight new files'
        : 'join mode missing-base queued write gate is not strict enough; old local files could flush after connect',
      missingBaseQueueGateStepAt,
    );

    const joinServerAuthorityStepAt = Date.now();
    const firstJoinDecision = getJoinSnapshotAuthorityDecision({
      connectionMode: 'join',
      baselineFileCount: 0,
      remoteFileCount: 5,
      baselineUpdatedAt: '',
      remoteMaxUpdatedAt: new Date().toISOString(),
      hasPreviousFileBaseline: false,
    });
    const staleJoinDecision = getJoinSnapshotAuthorityDecision({
      connectionMode: 'join',
      baselineFileCount: 8,
      remoteFileCount: 5,
      baselineUpdatedAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
      remoteMaxUpdatedAt: new Date().toISOString(),
      hasPreviousFileBaseline: true,
    });
    const freshJoinDecision = getJoinSnapshotAuthorityDecision({
      connectionMode: 'join',
      baselineFileCount: 8,
      remoteFileCount: 5,
      baselineUpdatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      remoteMaxUpdatedAt: new Date().toISOString(),
      hasPreviousFileBaseline: true,
    });
    const rebuildDecision = getJoinSnapshotAuthorityDecision({
      connectionMode: 'rebuild',
      baselineFileCount: 0,
      remoteFileCount: 5,
      baselineUpdatedAt: '',
      remoteMaxUpdatedAt: new Date().toISOString(),
      hasPreviousFileBaseline: false,
    });
    const joinServerAuthorityOk = firstJoinDecision.mode === 'first-connect-server-authority'
      && firstJoinDecision.serverAuthoritativeAdoption
      && firstJoinDecision.adoptLocalOnlyToRecovery
      && firstJoinDecision.blockAutomaticLocalOnlyUpload
      && staleJoinDecision.mode === 'normal-join'
      && staleJoinDecision.staleBaselineAgainstRemote
      && !staleJoinDecision.serverAuthoritativeAdoption
      && !staleJoinDecision.adoptLocalOnlyToRecovery
      && !staleJoinDecision.blockAutomaticLocalOnlyUpload
      && freshJoinDecision.mode === 'normal-join'
      && !freshJoinDecision.serverAuthoritativeAdoption
      && !freshJoinDecision.adoptLocalOnlyToRecovery
      && rebuildDecision.mode === 'rebuild-explicit-publish'
      && !rebuildDecision.serverAuthoritativeAdoption
      && rebuildDecision.blockAutomaticLocalOnlyUpload;
    addStep(
      'joinServerAuthorityAdoption',
      joinServerAuthorityOk,
      joinServerAuthorityOk
        ? 'first join adopts a populated server; existing devices reconcile stale baselines per file so unrelated offline edits still upload'
        : `join authority policy mismatch: first=${firstJoinDecision.mode}, stale=${staleJoinDecision.mode}, fresh=${freshJoinDecision.mode}, rebuild=${rebuildDecision.mode}`,
      joinServerAuthorityStepAt,
    );

    const incomingServerAuthorityStepAt = Date.now();
    const incomingServerAuthorityOk = shouldApplyServerAuthorityOverIncomingConflictInMode('join')
      && !shouldApplyServerAuthorityOverIncomingConflictInMode('rebuild')
      && shouldApplyServerAuthorityOverIncomingConflictInMode(undefined);
    addStep(
      'incomingServerAuthorityConflictHold',
      incomingServerAuthorityOk,
      incomingServerAuthorityOk
        ? 'join mode keeps the incoming server version as the live timeline and moves the local differing copy into Sync Recovery Center instead of auto-pushing it back'
        : 'join mode incoming conflict policy is unsafe; local copies could auto-push back over the server timeline',
      incomingServerAuthorityStepAt,
    );

    const hiddenConflictRecoveryStepAt = Date.now();
    const visibleLegacyConflictPath = '01_GDD/GDD.md.conflict-123456789';
    const hiddenRecoveryConflictPath = '.ars-note/sync-recovery/server-authoritative-adoption-2026-07-03T18-00-00/01_GDD/GDD.md.conflict-123456789';
    const hiddenAiConflictPath = '.ai-memory/skills/auto-plan.md.conflict-123456789';
    const hiddenRecoveryOriginalPath = originalPathFromProtectedLocalRecoveryRelativePath(hiddenRecoveryConflictPath);
    const hiddenRecoveryResolvedBasePath = (() => {
      try {
        return resolveConflictArtifact(resolvedVault, hiddenRecoveryConflictPath).baseRelativePath;
      } catch {
        return '';
      }
    })();
    const hiddenRecoveryAdvisorRecommendation = selectRecoveryAdvisorRecommendation('01_GDD/GDD.md', [
      {
        source: 'current',
        sourceRole: 'current-local',
        relativePath: '01_GDD/GDD.md',
        sha256: 'server-current',
        modifiedAt: '2026-07-03T18:00:00.000Z',
        timeMs: Date.parse('2026-07-03T18:00:00.000Z'),
      },
      {
        source: 'conflict',
        sourceRole: 'conflict-copy',
        relativePath: '01_GDD/GDD.md',
        recoveryRelativePath: hiddenRecoveryConflictPath,
        hiddenRecoveryCopy: true,
        sha256: 'old-local',
        modifiedAt: '2026-07-03T19:00:00.000Z',
        timeMs: Date.parse('2026-07-03T19:00:00.000Z'),
      },
    ]);
    const hiddenConflictRecoveryOk = isUserVisibleConflictArtifactPath(visibleLegacyConflictPath)
      && isLiveSyncRecoveryArchivePath(hiddenRecoveryConflictPath)
      && !isUserVisibleConflictArtifactPath(hiddenRecoveryConflictPath)
      && !isUserVisibleConflictArtifactPath(hiddenAiConflictPath)
      && hiddenRecoveryOriginalPath === '01_GDD/GDD.md'
      && hiddenRecoveryResolvedBasePath === '01_GDD/GDD.md'
      && hiddenRecoveryAdvisorRecommendation.recommendedAction === 'merge-conflict'
      && hiddenRecoveryAdvisorRecommendation.canApply === false;
    addStep(
      'hiddenConflictRecoveryRouting',
      hiddenConflictRecoveryOk,
      hiddenConflictRecoveryOk
        ? 'new conflict copies are hidden Sync Recovery Center records and resolve to merge drafts instead of automatic latest-wins overwrite'
        : 'conflict routing policy mismatch; hidden recovery conflicts may auto-overwrite or fail to resolve to their original document',
      hiddenConflictRecoveryStepAt,
    );

    const safetyCapabilitiesStepAt = Date.now();
    let safetyStatus: any = null;
    try {
      const safety = await fetchLiveSyncServerSafetyCompatibility(resolvedVault, serverUrl, vaultId);
      safetyStatus = safety.status || null;
      addStep(
        'serverSafetyCapabilities',
        safety.ok,
        safety.detail,
        safetyCapabilitiesStepAt,
      );
    } catch (err: any) {
      addStep(
        'serverSafetyCapabilities',
        false,
        err?.message || 'server safety capability check failed',
        safetyCapabilitiesStepAt,
      );
    }

    const tombstoneRetentionStepAt = Date.now();
    const retentionDays = Math.max(
      Number(safetyStatus?.tombstoneRetentionDays || 0),
      Number(safetyStatus?.safetyProfile?.tombstoneRetentionDays || 0),
    );
    const tombstoneRetentionOk = safetyStatus?.capabilities?.tombstoneRetention30Days === true
      && Number.isFinite(retentionDays)
      && retentionDays >= 30;
    addStep(
      'tombstoneRetention30Days',
      tombstoneRetentionOk,
      tombstoneRetentionOk
        ? `server keeps delete tombstones for ${retentionDays} days before cleanup`
        : 'server did not prove at least 30-day tombstone retention; update server/dist before syncing deletes',
      tombstoneRetentionStepAt,
    );

    const serverSnapshotProofStepAt = Date.now();
    const snapshotProofRelativePath = `__ars_note_sync_test__/snapshot_proof_${Date.now()}.md`;
    const snapshotProofResult = await runLiveSyncSnapshotProofProtectionSelfTest(
      resolvedVault,
      serverUrl,
      vaultId,
      snapshotProofRelativePath,
    );
    addStep(
      'serverSnapshotProofProtection',
      snapshotProofResult.rejected && snapshotProofResult.reason === 'missing-server-snapshot-proof',
      snapshotProofResult.rejected
        ? `server rejected write before snapshot proof: ${snapshotProofResult.reason || '-'}`
        : snapshotProofResult.accepted
          ? 'server accepted a write before the client proved it received the server snapshot; update server/dist'
          : 'server did not return a snapshot-proof protection response before timeout',
      serverSnapshotProofStepAt,
    );

    const preSnapshotLocalWriteStepAt = Date.now();
    const preSnapshotLocalWriteRelativePath = `__ars_note_sync_test__/pre_snapshot_local_${Date.now()}.md`;
    const preSnapshotLocalWriteResult = await runLiveSyncPreSnapshotLocalWriteProtectionSelfTest(
      resolvedVault,
      serverUrl,
      vaultId,
      preSnapshotLocalWriteRelativePath,
    );
    addStep(
      'serverPreSnapshotLocalWriteProtection',
      preSnapshotLocalWriteResult.rejected && (
        preSnapshotLocalWriteResult.reason === 'pre-snapshot-local-write'
        || preSnapshotLocalWriteResult.reason === 'stale-baseline-missing-base-write'
      ),
      preSnapshotLocalWriteResult.rejected
        ? `server rejected pre-snapshot local-only write: ${preSnapshotLocalWriteResult.reason || '-'}`
        : preSnapshotLocalWriteResult.accepted
          ? 'server accepted an old local-only file as a new server file; update server/dist'
          : 'server did not return a pre-snapshot local write protection response before timeout',
      preSnapshotLocalWriteStepAt,
    );

    const multiDeviceStepAt = Date.now();
    const serverClients = Array.isArray(safetyStatus?.clients) ? safetyStatus.clients : [];
    const onlineCount = typeof safetyStatus?.vaultClients === 'number'
      ? safetyStatus.vaultClients
      : serverClients.length;
    const onlineClientLabels = serverClients
      .map((client: any) => [client.deviceName || client.deviceId || client.clientId, client.appVersion ? `v${client.appVersion}` : ''].filter(Boolean).join(' '))
      .filter(Boolean)
      .slice(0, 5)
      .join(', ');
    addStep(
      'multiDevicePresence',
      true,
      onlineCount >= 2
        ? `server sees ${onlineCount} online clients for this vault: ${onlineClientLabels || 'details unavailable'}`
        : `server sees ${onlineCount || 0} online client for this vault. For final two-computer verification, connect the other computer to the same Vault ID and rerun this test.`,
      multiDeviceStepAt,
    );

    const staleBaselineStepAt = Date.now();
    const staleBaselineBlocked = isPreflightBaselineStaleAgainstRemote(
      new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
      new Date().toISOString(),
    );
    const recentBaselineAllowed = !isPreflightBaselineStaleAgainstRemote(
      new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      new Date().toISOString(),
    );
    addStep(
      'staleBaselinePreflight',
      staleBaselineBlocked && recentBaselineAllowed,
      staleBaselineBlocked && recentBaselineAllowed
        ? 'client preflight blocks uploads when this device baseline is far behind the server snapshot'
        : 'stale baseline guard did not classify old/recent baselines correctly',
      staleBaselineStepAt,
    );

    const deleteStormGuardStepAt = Date.now();
    const deleteStormNow = Date.now();
    const nineDeletes = Array.from({ length: 9 }, (_, idx) => deleteStormNow - idx * 500);
    const tenDeletes = Array.from({ length: 10 }, (_, idx) => deleteStormNow - idx * 500);
    const deleteStormOk = !shouldTriggerDeleteStormGuard(nineDeletes, deleteStormNow)
      && shouldTriggerDeleteStormGuard(tenDeletes, deleteStormNow);
    addStep(
      'deleteStormGuard',
      deleteStormOk,
      deleteStormOk
        ? 'client blocks delete upload bursts before they can propagate mass deletion'
        : 'delete storm guard threshold did not classify safe/risky delete bursts correctly',
      deleteStormGuardStepAt,
    );

    const destructiveTruncationStepAt = Date.now();
    const destructiveTruncationOk = shouldGuardDestructiveTruncation({
      action: 'update',
      relativePath: '01_GDD/GameDesignDocument.md',
      previousSize: 64 * 1024,
      newSize: 0,
    }) && shouldGuardDestructiveTruncation({
      action: 'update',
      relativePath: '01_GDD/GameDesignDocument.md',
      previousSize: 64 * 1024,
      newSize: 4 * 1024,
    }) && !shouldGuardDestructiveTruncation({
      action: 'update',
      relativePath: '01_GDD/GameDesignDocument.md',
      previousSize: 64 * 1024,
      newSize: 48 * 1024,
    }) && !shouldGuardDestructiveTruncation({
      action: 'create',
      relativePath: '01_GDD/NewDocument.md',
      previousSize: 0,
      newSize: 0,
    }) && !shouldGuardDestructiveTruncation({
      action: 'update',
      relativePath: 'Art/logo.png',
      previousSize: 64 * 1024,
      newSize: 0,
    });
    addStep(
      'destructiveTruncationGuard',
      destructiveTruncationOk,
      destructiveTruncationOk
        ? 'client holds sudden empty/tiny rewrites of existing large text documents before upload'
        : 'client did not classify destructive text-file truncation correctly',
      destructiveTruncationStepAt,
    );

    const localRecoveryGateStepAt = Date.now();
    const recoveryGateServer = {
      ok: true,
      vaultClients: 2,
      serverVersion: APP_VERSION,
      safetyCompatibility: { ok: true },
    };
    const recoveryBlockedReadiness = buildLiveSyncLaunchReadiness({
      serverUrl,
      connected: true,
      recoveryRisk: {
        riskLevel: 'danger',
        conflictCount: 1,
        conflictFiles: ['01_GDD/GDD.md.conflict-123'],
      },
    }, recoveryGateServer, '');
    const recoveryWarningReadiness = buildLiveSyncLaunchReadiness({
      serverUrl,
      connected: true,
      recoveryRisk: {
        riskLevel: 'watch',
        conflictCount: 0,
        deletedSnapshotCount: 1,
        overwriteHistoryCount: 1,
        aiTrashCount: 1,
      },
    }, recoveryGateServer, '');
    const localRecoveryGateOk = recoveryBlockedReadiness.status === 'blocked'
      && recoveryWarningReadiness.status === 'warning';
    addStep(
      'launchReadinessLocalRecoveryGate',
      localRecoveryGateOk,
      localRecoveryGateOk
        ? 'launch readiness blocks unresolved conflict copies and warns about recoverable local history'
        : 'launch readiness did not classify local recovery artifacts correctly',
      localRecoveryGateStepAt,
    );

    const missingBaseStepAt = Date.now();
    const missingBaseRelativePath = `__ars_note_sync_test__/missing_base_${Date.now()}.md`;
    const missingBaseResult = await runLiveSyncMissingBaseProtectionSelfTest(
      resolvedVault,
      serverUrl,
      vaultId,
      missingBaseRelativePath,
    );
    addStep(
      'serverMissingBaseProtection',
      missingBaseResult.rejected && missingBaseResult.reason === 'server-missing-base-file',
      missingBaseResult.rejected
        ? `server rejected missing-base write: ${missingBaseResult.reason || '-'}`
        : missingBaseResult.accepted
          ? 'server accepted a write whose claimed base file is missing; update server/dist'
          : 'server did not return a missing-base protection response before timeout',
      missingBaseStepAt,
    );

    const rejectedHistoryMetadataStepAt = Date.now();
    if (missingBaseResult.rejected) {
      const rejectedHistoryMetadata = await waitForServerRejectedHistoryMetadata(
        resolvedVault,
        missingBaseRelativePath,
        missingBaseResult.reason,
        missingBaseResult.expectedDeviceId,
      );
      addStep(
        'serverRejectedHistoryDeviceMetadata',
        rejectedHistoryMetadata.ok,
        rejectedHistoryMetadata.reason,
        rejectedHistoryMetadataStepAt,
      );
    } else {
      addStep(
        'serverRejectedHistoryDeviceMetadata',
        false,
        'skipped because missing-base rejection did not complete',
        rejectedHistoryMetadataStepAt,
      );
    }

    const apiStepAt = Date.now();
    await fetchLiveSyncFiles(resolvedVault, serverUrl, vaultId);
    addStep('serverLiveFilesApi', true, '/api/live-sync/files is available', apiStepAt);

    const peerBroadcastStepAt = Date.now();
    const peerBroadcastRelativePath = `__ars_note_sync_test__/peer_broadcast_${Date.now()}.md`;
    const peerBroadcastResult = await runLiveSyncPeerBroadcastSelfTest(
      resolvedVault,
      serverUrl,
      vaultId,
      peerBroadcastRelativePath,
    );
    addStep(
      'peerBroadcastDelivery',
      peerBroadcastResult.received,
      peerBroadcastResult.reason,
      peerBroadcastStepAt,
    );

    const serverDestructiveTruncationStepAt = Date.now();
    const serverDestructiveTruncationRelativePath = `__ars_note_sync_test__/destructive_truncation_${Date.now()}.md`;
    const serverDestructiveTruncationResult = await runLiveSyncServerDestructiveTruncationSelfTest(
      resolvedVault,
      serverUrl,
      vaultId,
      serverDestructiveTruncationRelativePath,
    );
    addStep(
      'serverDestructiveTruncationProtection',
      serverDestructiveTruncationResult.created
        && serverDestructiveTruncationResult.rejected
        && serverDestructiveTruncationResult.reason === 'destructive-truncation'
        && serverDestructiveTruncationResult.preserved,
      serverDestructiveTruncationResult.rejected
        ? `server rejected destructive truncation and preserved current file: ${serverDestructiveTruncationResult.reason || '-'}`
        : serverDestructiveTruncationResult.accepted
          ? 'server accepted an empty/tiny rewrite of an existing large text document; update server/dist'
          : serverDestructiveTruncationResult.created
            ? 'server did not return destructive-truncation rejection before timeout'
            : `server could not create destructive truncation probe: ${serverDestructiveTruncationResult.reason || 'no response'}`,
      serverDestructiveTruncationStepAt,
    );

    fs.mkdirSync(testDir, { recursive: true });

    const createStepAt = Date.now();
    const createContent = '# Ars-note Live Sync Self Test\n\ncreate ' + new Date().toISOString() + '\n';
    fs.writeFileSync(filePath, createContent, 'utf-8');
    const createSha = crypto.createHash('sha256').update(Buffer.from(createContent, 'utf-8')).digest('hex');
    const created = await waitForRemoteLiveFile(resolvedVault, serverUrl, vaultId, relativePath, (file) => !!file && !file.deleted && file.sha256 === createSha);
    addStep('createUpload', !!created, created ? 'server received created file' : 'server did not receive created file before timeout', createStepAt);

    const updateStepAt = Date.now();
    const updateContent = createContent + '\nupdate ' + new Date().toISOString() + '\n';
    fs.writeFileSync(filePath, updateContent, 'utf-8');
    const updateSha = crypto.createHash('sha256').update(Buffer.from(updateContent, 'utf-8')).digest('hex');
    const updated = await waitForRemoteLiveFile(resolvedVault, serverUrl, vaultId, relativePath, (file) => !!file && !file.deleted && file.sha256 === updateSha);
    addStep('updateUpload', !!updated, updated ? 'server received updated hash' : 'server did not receive updated hash before timeout', updateStepAt);

    const staleWriteStepAt = Date.now();
    if (created && updated) {
      const staleResult = await runLiveSyncStaleWriteProtectionSelfTest(
        resolvedVault,
        serverUrl,
        vaultId,
        relativePath,
        createSha,
        created.updatedAt || '',
        updateSha,
      );
      const protectedFile = await waitForRemoteLiveFile(
        resolvedVault,
        serverUrl,
        vaultId,
        relativePath,
        (file) => !!file && !file.deleted && file.sha256 === updateSha,
        3000,
      );
      const rejectedForBase = staleResult.rejected && staleResult.reason === 'base-version-mismatch';
      const preservedCurrent = !!protectedFile && protectedFile.sha256 === updateSha;
      addStep(
        'staleWriteProtection',
        rejectedForBase && preservedCurrent,
        rejectedForBase && preservedCurrent
          ? 'server rejected stale base-version write and preserved the newer file'
          : `expected base-version-mismatch and preserved hash; got reason=${staleResult.reason || 'no-rejection'}, preserved=${preservedCurrent ? 'yes' : 'no'}`,
        staleWriteStepAt,
      );
    } else {
      addStep('staleWriteProtection', false, 'skipped because create/update upload did not complete', staleWriteStepAt);
    }

    const revisionBaseStepAt = Date.now();
    if (created && updated && Number(created.serverRevision || 0) > 0 && created.revisionId && Number(updated.serverRevision || 0) > 0) {
      const revisionResult = await runLiveSyncRevisionBaseProtectionSelfTest(
        resolvedVault,
        serverUrl,
        vaultId,
        relativePath,
        updateSha,
        updated.updatedAt || '',
        created.serverRevision,
        created.revisionId,
      );
      const protectedFile = await waitForRemoteLiveFile(
        resolvedVault,
        serverUrl,
        vaultId,
        relativePath,
        (file) => !!file && !file.deleted && file.sha256 === updateSha && Number(file.serverRevision || 0) === Number(updated.serverRevision || 0),
        3000,
      );
      const rejectedForRevision = revisionResult.rejected && revisionResult.reason === 'base-revision-mismatch';
      addStep(
        'revisionBaseProtection',
        rejectedForRevision && !!protectedFile,
        rejectedForRevision && protectedFile
          ? 'server rejected a write whose base hash matched but server revision was stale'
          : `expected base-revision-mismatch with current revision preserved; got reason=${revisionResult.reason || 'no-rejection'}, preserved=${protectedFile ? 'yes' : 'no'}`,
        revisionBaseStepAt,
      );
    } else {
      addStep('revisionBaseProtection', false, 'skipped because create/update revision metadata was unavailable', revisionBaseStepAt);
    }

    const deleteStepAt = Date.now();
    fs.unlinkSync(filePath);
    const deleted = await waitForRemoteLiveFile(resolvedVault, serverUrl, vaultId, relativePath, (file) => !!file && !!file.deleted);
    addStep('deleteUpload', !!deleted, deleted ? 'server received delete tombstone' : 'server did not receive delete tombstone before timeout', deleteStepAt);

    const tombstoneProtectionStepAt = Date.now();
    if (deleted) {
      const tombstoneResult = await runLiveSyncDeletedTombstoneProtectionSelfTest(
        resolvedVault,
        serverUrl,
        vaultId,
        relativePath,
        deleted.updatedAt || '',
      );
      addStep(
        'deletedTombstoneProtection',
        tombstoneResult.rejected && tombstoneResult.reason === 'deleted-tombstone-resurrection',
        tombstoneResult.rejected
          ? `server rejected deleted tombstone resurrection: ${tombstoneResult.reason || '-'}`
          : tombstoneResult.accepted
            ? 'server accepted an old file resurrection after delete; update server/dist'
            : 'server did not return a deleted tombstone protection response before timeout',
        tombstoneProtectionStepAt,
      );
    } else {
      addStep('deletedTombstoneProtection', false, 'skipped because delete tombstone was not created on the server', tombstoneProtectionStepAt);
    }

    const prunedTombstoneHistoryStepAt = Date.now();
    try {
      const prunedTombstoneResult = await runLiveSyncPrunedTombstoneHistoryProtectionSelfTest(
        resolvedVault,
        serverUrl,
      );
      const prunedReasonOk = [
        'pruned-tombstone-content-resurrection',
        'pruned-tombstone-resurrection',
        'pruned-tombstone-stale-baseline',
      ].includes(prunedTombstoneResult.reason);
      addStep(
        'prunedTombstoneHistoryProtection',
        prunedTombstoneResult.registered
          && prunedTombstoneResult.created
          && prunedTombstoneResult.deleted
          && prunedTombstoneResult.pruned
          && prunedTombstoneResult.rejected
          && prunedReasonOk,
        prunedTombstoneResult.rejected
          ? `server rejected resurrection after tombstone pruning: ${prunedTombstoneResult.reason || '-'}`
          : prunedTombstoneResult.accepted
            ? 'server accepted old content after its tombstone was pruned; update server/dist'
            : `server did not prove pruned tombstone history protection: ${prunedTombstoneResult.reason || 'no response'}`,
        prunedTombstoneHistoryStepAt,
      );
    } catch (err: any) {
      addStep(
        'prunedTombstoneHistoryProtection',
        false,
        err?.message || 'pruned tombstone history protection self-test failed',
        prunedTombstoneHistoryStepAt,
      );
    }

    const deleteRecoveryStepAt = Date.now();
    const recoveryHistory = await waitForLocalDeleteRecoveryHistory(resolvedVault, relativePath, updateSha);
    const recoveryOk = !!recoveryHistory && recoveryHistory.sha256 === updateSha;
    addStep(
      'deleteRecoveryHistory',
      recoveryOk,
      recoveryOk
        ? 'local live-history contains the deleted file content'
        : recoveryHistory
          ? `local live-history deleted snapshot hash mismatch: expected=${updateSha}, found=${recoveryHistory.sha256 || '-'}`
          : 'local live-history did not contain deleted file content before timeout',
      deleteRecoveryStepAt,
    );

    const serverDeleteRecoveryStepAt = Date.now();
    let serverRecoveryHistory: any | undefined;
    let serverRecoveryOk = false;
    if (deleted) {
      serverRecoveryHistory = await waitForServerDeleteRecoveryHistory(resolvedVault, relativePath, updateSha);
      serverRecoveryOk = !!serverRecoveryHistory?.record
        && serverRecoveryHistory.record.sha256 === updateSha
        && !!serverRecoveryHistory.preview
        && serverRecoveryHistory.preview.sha256 === updateSha;
      addStep(
        'serverDeleteRecoveryHistory',
        serverRecoveryOk,
        serverRecoveryOk
          ? 'server live-history contains downloadable deleted file content'
          : serverRecoveryHistory?.record
            ? `server live-history deleted snapshot mismatch or content unavailable: expected=${updateSha}, found=${serverRecoveryHistory.record.sha256 || '-'}${serverRecoveryHistory.error ? `, error=${serverRecoveryHistory.error}` : ''}`
            : serverRecoveryHistory?.error
              ? `server live-history unavailable: ${serverRecoveryHistory.error}`
              : 'server live-history did not contain deleted file content before timeout',
        serverDeleteRecoveryStepAt,
      );
    } else {
      addStep('serverDeleteRecoveryHistory', false, 'skipped because delete tombstone was not created on the server', serverDeleteRecoveryStepAt);
    }

    const serverHistoryRestoreStepAt = Date.now();
    if (serverRecoveryOk && serverRecoveryHistory?.record?.versionId) {
      try {
        const restoreResult = await restoreServerLiveHistory(resolvedVault, relativePath, serverRecoveryHistory.record.versionId);
        const localRestoredSha = fs.existsSync(filePath) && fs.statSync(filePath).isFile()
          ? crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
          : '';
        const remoteRestored = await waitForRemoteLiveFile(
          resolvedVault,
          serverUrl,
          vaultId,
          relativePath,
          (file) => !!file && !file.deleted && file.sha256 === updateSha,
        );
        const restoreOk = !!restoreResult?.ok && localRestoredSha === updateSha && !!remoteRestored;
        addStep(
          'serverHistoryRestore',
          restoreOk,
          restoreOk
            ? 'server live-history restored the deleted file and the restored hash matches'
            : `server history restore did not preserve expected content: local=${localRestoredSha || '-'}, remote=${remoteRestored?.sha256 || '-'}`,
          serverHistoryRestoreStepAt,
        );

        const serverRestoreMetadataStepAt = Date.now();
        if (restoreOk) {
          const baselineEntry = await waitForLocalLiveSyncBaselineEntry(
            resolvedVault,
            relativePath,
            (entry) => !!entry
              && entry.sha256 === updateSha
              && !entry.deleted
              && Number(entry.serverRevision || 0) > 0
              && typeof entry.revisionId === 'string'
              && entry.revisionId.trim().length > 0,
            7000,
          );
          const remoteHasMetadata = Number(remoteRestored?.serverRevision || 0) > 0
            && typeof remoteRestored?.revisionId === 'string'
            && remoteRestored.revisionId.trim().length > 0;
          const baselineHasMetadata = !!baselineEntry
            && Number(baselineEntry.serverRevision || 0) > 0
            && typeof baselineEntry.revisionId === 'string'
            && baselineEntry.revisionId.trim().length > 0;
          const metadataOk = remoteHasMetadata && baselineHasMetadata;
          addStep(
            'serverRestoreMetadataBroadcast',
            metadataOk,
            metadataOk
              ? `server restore propagated revision metadata into local baseline: r${baselineEntry.serverRevision}`
              : `server restore metadata incomplete: remoteRevision=${remoteRestored?.serverRevision || '-'}, remoteRevisionId=${remoteRestored?.revisionId || '-'}, baselineRevision=${baselineEntry?.serverRevision || '-'}, baselineRevisionId=${baselineEntry?.revisionId || '-'}`,
            serverRestoreMetadataStepAt,
          );
        } else {
          addStep(
            'serverRestoreMetadataBroadcast',
            false,
            'skipped because server history restore did not pass',
            serverRestoreMetadataStepAt,
          );
        }

        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            await waitForRemoteLiveFile(resolvedVault, serverUrl, vaultId, relativePath, (file) => !!file && !!file.deleted, 5000);
          }
        } catch {
          /* cleanup is best effort; the restore assertion above is the important part */
        }
      } catch (err: any) {
        addStep('serverHistoryRestore', false, err?.message || 'server history restore failed', serverHistoryRestoreStepAt);
        addStep('serverRestoreMetadataBroadcast', false, 'skipped because server history restore threw before metadata could be checked', serverHistoryRestoreStepAt);
      }
    } else {
      addStep(
        'serverHistoryRestore',
        false,
        serverRecoveryHistory?.error
          ? `skipped because server delete recovery history is unavailable: ${serverRecoveryHistory.error}`
          : 'skipped because server delete recovery history did not pass',
        serverHistoryRestoreStepAt,
      );
      addStep(
        'serverRestoreMetadataBroadcast',
        false,
        'skipped because server history restore prerequisites did not pass',
        serverHistoryRestoreStepAt,
      );
    }

    const hiddenSyncTargets = [
      {
        step: 'teamScheduleHiddenDir',
        relPath: `${TEAM_SCHEDULE_DIR}/__sync_test__/team_${Date.now()}.md`,
        detail: '.ars-team production docs are live-syncable',
      },
      {
        step: 'aiMemoryPortableHiddenDir',
        relPath: `${AI_MEMORY_DIR}/__sync_test__/memory_${Date.now()}.md`,
        detail: '.ai-memory portable memory files are live-syncable',
      },
      {
        step: 'aiMemorySkillsHiddenDir',
        relPath: `${AI_MEMORY_DIR}/skills/self_test_${Date.now()}.md`,
        detail: '.ai-memory skills are live-syncable',
      },
    ];

    for (const target of hiddenSyncTargets) {
      const hiddenStepAt = Date.now();
      const normalizedRel = target.relPath.replace(/\\/g, '/');
      const hiddenPath = path.join(resolvedVault, ...normalizedRel.split('/').filter(Boolean));
      cleanupFiles.add(hiddenPath);
      if (normalizedRel.includes('/__sync_test__/')) cleanupDirs.add(path.dirname(hiddenPath));
      fs.mkdirSync(path.dirname(hiddenPath), { recursive: true });
      const content = `# Ars-note Hidden Live Sync Self Test\n\n${target.detail}\n${new Date().toISOString()}\n`;
      fs.writeFileSync(hiddenPath, content, 'utf-8');
      const sha = crypto.createHash('sha256').update(Buffer.from(content, 'utf-8')).digest('hex');
      const uploaded = await waitForRemoteLiveFile(resolvedVault, serverUrl, vaultId, normalizedRel, (file) => !!file && !file.deleted && file.sha256 === sha);
      addStep(target.step, !!uploaded, uploaded ? target.detail : `${target.detail} was not received before timeout`, hiddenStepAt);
      try {
        fs.unlinkSync(hiddenPath);
        await waitForRemoteLiveFile(resolvedVault, serverUrl, vaultId, normalizedRel, (file) => !!file && !!file.deleted);
      } catch {
        /* cleanup is best effort; the upload result is the important part of this step */
      }
    }

    try {
      for (const file of cleanupFiles) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      for (const dir of Array.from(cleanupDirs).sort((a, b) => b.length - a.length)) {
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
        }
      }
    } catch { /* keep test folder if it is not empty */ }

    const ok = steps.every(step => step.ok);
    return {
      ok,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      vaultId,
      serverUrl,
      testFile: relativePath,
      steps,
    };
  } catch (err: any) {
    try {
      for (const file of cleanupFiles) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      for (const dir of Array.from(cleanupDirs).sort((a, b) => b.length - a.length)) {
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
        }
      }
    } catch { /* best effort cleanup */ }
    addStep('error', false, err.message || 'Self-test failed');
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      vaultId,
      serverUrl,
      testFile: relativePath,
      steps,
    };
  }
});

ipcMain.handle('sync:scanConflicts', async (_e, vaultPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return conflictArtifactSummary(vaultPath, { includeHiddenRecovery: true });
});

ipcMain.handle('sync:cleanupConflicts', async (_e, vaultPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  const result = archiveConflictArtifacts(vaultPath);
  return {
    ok: true,
    deletedCount: result.archivedCount,
    deletedSize: result.archivedSize,
    archivedCount: result.archivedCount,
    archivedSize: result.archivedSize,
    archiveRelativePath: result.archiveRelativePath,
  };
});

ipcMain.handle('sync:recoveryOverview', async (_e, vaultPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return syncRecoveryOverview(vaultPath);
});

ipcMain.handle('sync:previewAccidentRecovery', async (_e, vaultPath: string, options?: any) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return previewSyncAccidentRecovery(vaultPath, options);
});

ipcMain.handle('sync:previewRecoveryAdvisor', async (_e, vaultPath: string, options?: any) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return previewSyncRecoveryAdvisor(vaultPath, options);
});

ipcMain.handle('sync:applyRecoveryAdvisorItem', async (_e, vaultPath: string, item: any) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return applySyncRecoveryAdvisorItem(vaultPath, item);
});

ipcMain.handle('sync:applyRecoveryAdvisorPlan', async (_e, vaultPath: string, options?: any) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return applySyncRecoveryAdvisorPlan(vaultPath, options);
});

ipcMain.handle('sync:runSafeRecoveryAutopilot', async (_e, vaultPath: string, options?: any) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return runSafeSyncRecoveryAutopilot(vaultPath, options);
});

ipcMain.handle('sync:listServerDataSnapshots', async (_e, vaultPath: string, limit?: number) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return listServerDataSnapshots(vaultPath, limit);
});

ipcMain.handle('sync:createServerDataSnapshot', async (_e, vaultPath: string, options?: any) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return createServerDataSnapshot(vaultPath, options);
});

ipcMain.handle('sync:exportServerDataBackup', async (_e, vaultPath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return exportServerDataBackup(vaultPath);
});

ipcMain.handle('sync:listServerSnapshotFiles', async (_e, vaultPath: string, options?: any) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return listServerSnapshotFiles(vaultPath, options);
});

ipcMain.handle('sync:restoreServerSnapshotFile', async (_e, vaultPath: string, fileName: string, candidate: any) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return restoreServerSnapshotFile(vaultPath, fileName, candidate);
});

ipcMain.handle('sync:previewAiTrashFile', async (_e, vaultPath: string, recoveryRelativePath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return previewAITrashRecoveryCopy(vaultPath, recoveryRelativePath);
});

ipcMain.handle('sync:restoreAiTrashFile', async (_e, vaultPath: string, recoveryRelativePath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return restoreAITrashRecoveryCopy(vaultPath, recoveryRelativePath);
});

ipcMain.handle('sync:previewProtectedLocalRecoveryFile', async (_e, vaultPath: string, recoveryRelativePath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return previewProtectedLocalRecoveryCopy(vaultPath, recoveryRelativePath);
});

ipcMain.handle('sync:restoreProtectedLocalRecoveryFile', async (_e, vaultPath: string, recoveryRelativePath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return restoreProtectedLocalRecoveryCopy(vaultPath, recoveryRelativePath);
});

ipcMain.handle('sync:previewConflict', async (_e, vaultPath: string, conflictRelativePath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  const resolved = resolveConflictArtifact(vaultPath, conflictRelativePath);
  if (!fs.existsSync(resolved.conflictPath)) {
    throw new Error('Conflict file not found');
  }
  const conflictStat = fs.statSync(resolved.conflictPath);
  const baseExists = fs.existsSync(resolved.basePath);
  const baseStat = baseExists ? fs.statSync(resolved.basePath) : null;
  const basePreview = baseExists ? readConflictPreviewText(resolved.basePath) : { content: '', truncated: false };
  const conflictPreview = readConflictPreviewText(resolved.conflictPath);

  return {
    conflictRelativePath: resolved.conflictRelativePath,
    baseRelativePath: resolved.baseRelativePath,
    baseExists,
    baseSize: baseStat?.size || 0,
    conflictSize: conflictStat.size,
    baseModifiedAt: baseStat?.mtime.toISOString() || null,
    conflictModifiedAt: conflictStat.mtime.toISOString(),
    baseContent: basePreview.content,
    conflictContent: conflictPreview.content,
    baseTruncated: basePreview.truncated,
    conflictTruncated: conflictPreview.truncated,
    diff: lineDiffSummary(basePreview.content, conflictPreview.content),
  };
});

ipcMain.handle('sync:applyConflict', async (_e, vaultPath: string, conflictRelativePath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  const resolved = resolveConflictArtifact(vaultPath, conflictRelativePath);
  if (!fs.existsSync(resolved.conflictPath)) {
    throw new Error('Conflict file not found');
  }
  const conflictBuffer = fs.readFileSync(resolved.conflictPath);
  fs.mkdirSync(path.dirname(resolved.basePath), { recursive: true });
  saveLiveHistoryBeforeOverwrite(resolved.basePath, conflictBuffer.toString('utf-8'), 'before-conflict-apply');
  fs.writeFileSync(resolved.basePath, conflictBuffer);
  fs.unlinkSync(resolved.conflictPath);
  return { ok: true, restoredPath: resolved.baseRelativePath, deletedConflict: resolved.conflictRelativePath };
});

ipcMain.handle('sync:resolveConflictLatest', async (_e, vaultPath: string, conflictRelativePath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return resolveConflictByLatestResult(vaultPath, conflictRelativePath);
});

ipcMain.handle('sync:createConflictMergeDraft', async (_e, vaultPath: string, conflictRelativePath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return createConflictMergeDraftResult(vaultPath, conflictRelativePath);
});

ipcMain.handle('sync:saveConflictMergeResult', async (_e, vaultPath: string, conflictRelativePath: string, mergedContent: string, deleteConflict = true) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  const resolved = resolveConflictArtifact(vaultPath, conflictRelativePath);
  if (!fs.existsSync(resolved.conflictPath)) {
    throw new Error('Conflict file not found');
  }
  if (typeof mergedContent !== 'string') {
    throw new Error('Merged content must be text');
  }

  fs.mkdirSync(path.dirname(resolved.basePath), { recursive: true });
  saveLiveHistoryBeforeOverwrite(resolved.basePath, mergedContent, 'before-conflict-merge');
  fs.writeFileSync(resolved.basePath, mergedContent, 'utf-8');

  let deletedConflict = '';
  if (deleteConflict && fs.existsSync(resolved.conflictPath)) {
    fs.unlinkSync(resolved.conflictPath);
    deletedConflict = resolved.conflictRelativePath;
  }

  return {
    ok: true,
    restoredPath: resolved.baseRelativePath,
    deletedConflict,
  };
});

ipcMain.handle('sync:deleteConflict', async (_e, vaultPath: string, conflictRelativePath: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  const resolved = resolveConflictArtifact(vaultPath, conflictRelativePath);
  if (!fs.existsSync(resolved.conflictPath)) {
    return { ok: true, deleted: false };
  }
  fs.unlinkSync(resolved.conflictPath);
  return { ok: true, deleted: true, deletedConflict: resolved.conflictRelativePath };
});

ipcMain.handle('sync:listLiveHistory', async (_e, vaultPath: string, relativePath?: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return listLiveHistory(vaultPath, relativePath).slice(0, 100);
});

ipcMain.handle('sync:previewLiveHistory', async (_e, vaultPath: string, relativePath: string, versionId: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return previewLiveHistory(vaultPath, relativePath, versionId);
});

ipcMain.handle('sync:restoreLiveHistory', async (_e, vaultPath: string, relativePath: string, versionId: string) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return restoreLiveHistory(vaultPath, relativePath, versionId);
});

ipcMain.handle('sync:previewLiveHistoryBatchRestore', async (_e, vaultPath: string, options?: any) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return previewLiveHistoryBatchRestore(vaultPath, options);
});

ipcMain.handle('sync:restoreLiveHistoryBatch', async (_e, vaultPath: string, options?: any) => {
  if (!vaultPath || !fs.existsSync(vaultPath) || !isValidVault(vaultPath)) {
    throw new Error('Invalid vault path');
  }
  return restoreLiveHistoryBatch(vaultPath, options);
});

/* ═══════════════════════════════════════════════════
   PDF Export — One-click PDF generation (v1.0.0)
   ═══════════════════════════════════════════════════ */

ipcMain.handle('sync:listServerLiveHistory', async (_e, vaultPath: string, relativePath?: string, limit?: number) => {
  return listServerLiveHistory(vaultPath, relativePath, limit);
});

ipcMain.handle('sync:previewServerLiveHistory', async (_e, vaultPath: string, relativePath: string, versionId: string) => {
  return previewServerLiveHistory(vaultPath, relativePath, versionId);
});

ipcMain.handle('sync:restoreServerLiveHistory', async (_e, vaultPath: string, relativePath: string, versionId: string) => {
  return restoreServerLiveHistory(vaultPath, relativePath, versionId);
});

ipcMain.handle('sync:previewServerLiveHistoryBatchRestore', async (_e, vaultPath: string, options?: any) => {
  return previewServerLiveHistoryBatchRestore(vaultPath, options);
});

ipcMain.handle('sync:restoreServerLiveHistoryBatch', async (_e, vaultPath: string, options?: any) => {
  return restoreServerLiveHistoryBatch(vaultPath, options);
});

ipcMain.handle('export:pdf', async (event, options: { html: string; fileName: string }) => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return { ok: false, error: 'No window' };

  try {
    /* Create a hidden window to render the HTML */
    const pdfWin = new BrowserWindow({
      width: 800,
      height: 1100,
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(options.html));

    /* Wait for content to render */
    await new Promise((resolve) => setTimeout(resolve, 500));

    const pdfData = await pdfWin.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { marginType: 'default' },
    });

    pdfWin.close();

    /* Ask user where to save */
    const defaultName = (options.fileName || 'document').replace(/\.md$/i, '') + '.pdf';
    const saveResult = await dialog.showSaveDialog(win, {
      title: 'Export PDF',
      defaultPath: defaultName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });

    if (saveResult.canceled) {
      return { ok: false, error: 'Cancelled' };
    }

    fs.writeFileSync(saveResult.filePath!, pdfData);
    return { ok: true, path: saveResult.filePath! };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});
