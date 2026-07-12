/* ── Local file-system storage backend (v0.8.6) ── */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { LIVE_SYNC_TOMBSTONE_RETENTION_DAYS, SERVER_APP_NAME, SERVER_VERSION, type StoredVault, type StoredBackupMeta, type BackupListItem } from '../types';
import type { StorageBackend, BackupListItemWithVault, LiveFileEntry, LiveFileHistoryEntry, LiveFileSummary, LiveSyncClientEventEntry, LiveSyncClientHistoryEntry, ServerDataExportItem, ServerDataExportResult, ServerDataExportSkippedItem, ServerSnapshotFileCandidate, ServerSnapshotFileRestoreResult, ServerSnapshotFileSource, VaultDeleteResult, VaultExportResult, VaultMergeResult } from './storageTypes';

const DATA_DIR = 'server-data';
const VAULTS_DIR = path.join(DATA_DIR, 'vaults');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const LIVE_DIR = path.join(DATA_DIR, 'live');
const LIVE_HISTORY_DIR = path.join(DATA_DIR, 'live-history');
const LIVE_TRANSACTIONS_DIR = path.join(DATA_DIR, 'live-transactions');
const CLIENT_HISTORY_DIR = path.join(DATA_DIR, 'client-history');
const SERVER_EXPORTS_DIR = path.join(DATA_DIR, 'server-exports');
const SERVER_EXPORTS_INDEX_FILE = path.join(SERVER_EXPORTS_DIR, 'server-exports.json');
const INDEX_FILE = path.join(DATA_DIR, 'remote-index.json');
const MAX_LIVE_HISTORY_VERSIONS = 200;
const DEFAULT_SERVER_EXPORT_KEEP_LATEST = 7;
const DEFAULT_LIVE_TOMBSTONE_RETENTION_DAYS = LIVE_SYNC_TOMBSTONE_RETENTION_DAYS;

type ServerSnapshotFileCandidateWithContent = ServerSnapshotFileCandidate & {
  contentBase64?: string;
};

type ServerSnapshotFileListOptions = NonNullable<Parameters<NonNullable<StorageBackend['listServerSnapshotFiles']>>[1]>;
type ServerSnapshotFileRestoreOptions = Parameters<NonNullable<StorageBackend['restoreServerSnapshotFile']>>[1];
type LiveSyncClientEventListOptions = NonNullable<Parameters<NonNullable<StorageBackend['listLiveSyncClientEvents']>>[1]>;

interface LiveMutationTransaction {
  version: 1;
  transactionId: string;
  vaultId: string;
  relativePath: string;
  action: 'update' | 'delete';
  sha256: string;
  size: number;
  updatedAt: string;
  serverRevision: number;
  revisionId: string;
  clientId?: string;
  deviceId?: string;
  tombstoneExpiresAt?: string;
}

function isIgnoredLivePath(relativePath: string): boolean {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return (
    normalized.startsWith('.ars-note/') ||
    normalized === '.ai-config.json' ||
    normalized === '.ai-memory/live-session.json' ||
    normalized.startsWith('.ai-memory/history/') ||
    normalized.startsWith('__probe/')
  );
}

function normalizeLiveUpdatedAt(value?: string): string {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function addDaysIso(value: string, days: number): string {
  const base = Date.parse(value);
  const start = Number.isFinite(base) ? base : Date.now();
  return new Date(start + Math.max(1, Math.floor(days)) * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeTombstoneRetentionDays(value?: number): number {
  if (!Number.isFinite(Number(value))) return DEFAULT_LIVE_TOMBSTONE_RETENTION_DAYS;
  return Math.max(1, Math.min(3650, Math.floor(Number(value))));
}

function cleanLiveMetadataValue(value?: string): string | undefined {
  const text = String(value || '').trim();
  return text ? text.slice(0, 160) : undefined;
}

function safeHistoryPathPart(value: string): string {
  return value.replace(/\\/g, '/').split('/').map(part => encodeURIComponent(part)).join('/');
}

export class LocalStorageBackend implements StorageBackend {

  async initialize(): Promise<void> {
    fs.mkdirSync(VAULTS_DIR, { recursive: true });
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    fs.mkdirSync(LIVE_DIR, { recursive: true });
    fs.mkdirSync(LIVE_HISTORY_DIR, { recursive: true });
    fs.mkdirSync(LIVE_TRANSACTIONS_DIR, { recursive: true });
    fs.mkdirSync(CLIENT_HISTORY_DIR, { recursive: true });
    fs.mkdirSync(SERVER_EXPORTS_DIR, { recursive: true });
    if (!fs.existsSync(INDEX_FILE)) {
      this.writeIndex({});
    }
    if (!fs.existsSync(SERVER_EXPORTS_INDEX_FILE)) {
      this.writeServerExportsIndex([]);
    }
    this.validateCriticalIndexes();
    this.recoverLiveTransactions();
  }

  /* ── Vault operations ── */

  async registerVault(vaultId: string, vaultName: string, clientId?: string): Promise<StoredVault> {
    const index = this.readIndex();
    /* Check if vault already registered */
    const existing = Object.entries(index).find(
      ([, v]) => (v as StoredVault).vaultId === vaultId
    );
    if (existing) {
      /* Update name if changed */
      const stored = existing[1] as StoredVault;
      stored.vaultName = vaultName;
      if (clientId) stored.clientId = clientId;
      this.writeIndex(index);
      return stored;
    }

    /* Create new registration */
    const serverVaultId = 'sv_' + crypto.randomUUID().replace(/-/g, '').substring(0, 12);
    const entry: StoredVault = {
      serverVaultId,
      vaultId,
      vaultName,
      clientId,
      registeredAt: new Date().toISOString(),
    };

    /* Store vault data under serverVaultId key */
    (index as Record<string, StoredVault>)[serverVaultId] = entry;
    this.writeIndex(index);

    /* Create vault backup directory */
    const vaultBackupDir = path.join(BACKUPS_DIR, serverVaultId);
    fs.mkdirSync(vaultBackupDir, { recursive: true });

    return entry;
  }

  vaultExists(vaultId: string): boolean {
    const index = this.readIndex() as Record<string, StoredVault>;
    return Object.values(index).some(v => v.vaultId === vaultId);
  }

  async listVaults(): Promise<StoredVault[]> {
    const index = this.readIndex() as Record<string, StoredVault>;
    return Object.values(index).sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
  }

  async deleteVault(vaultId: string): Promise<VaultDeleteResult> {
    const index = this.readIndex() as Record<string, StoredVault>;
    const found = Object.entries(index).find(
      ([key, vault]) => key === vaultId || vault.vaultId === vaultId || vault.serverVaultId === vaultId
    );

    if (!found) {
      return {
        deleted: false,
        vaultId,
        serverVaultId: vaultId,
        backupsDeleted: false,
        liveDeleted: false,
        vaultRecordDeleted: false,
      };
    }

    const [indexKey, vault] = found;
    const backupDir = safeDirectChildPath(BACKUPS_DIR, vault.serverVaultId);
    const legacyBackupDir = safeDirectChildPath(BACKUPS_DIR, vault.vaultId);
    const liveDir = safeDirectChildPath(LIVE_DIR, vault.vaultId);
    const serverLiveDir = safeDirectChildPath(LIVE_DIR, vault.serverVaultId);
    const liveHistoryDir = safeDirectChildPath(LIVE_HISTORY_DIR, vault.vaultId);
    const serverLiveHistoryDir = safeDirectChildPath(LIVE_HISTORY_DIR, vault.serverVaultId);
    const liveTransactionsDir = safeDirectChildPath(LIVE_TRANSACTIONS_DIR, vault.vaultId);
    const serverLiveTransactionsDir = safeDirectChildPath(LIVE_TRANSACTIONS_DIR, vault.serverVaultId);
    const clientHistoryDir = safeDirectChildPath(CLIENT_HISTORY_DIR, vault.vaultId);
    const serverClientHistoryDir = safeDirectChildPath(CLIENT_HISTORY_DIR, vault.serverVaultId);
    const serverVaultDir = safeDirectChildPath(VAULTS_DIR, vault.serverVaultId);
    const legacyVaultDir = safeDirectChildPath(VAULTS_DIR, vault.vaultId);

    let backupsDeleted = removeDirectoryIfExists(backupDir);
    if (legacyBackupDir !== backupDir) backupsDeleted = removeDirectoryIfExists(legacyBackupDir) || backupsDeleted;
    let liveDeleted = removeDirectoryIfExists(liveDir);
    if (serverLiveDir !== liveDir) liveDeleted = removeDirectoryIfExists(serverLiveDir) || liveDeleted;
    removeDirectoryIfExists(liveHistoryDir);
    if (serverLiveHistoryDir !== liveHistoryDir) removeDirectoryIfExists(serverLiveHistoryDir);
    removeDirectoryIfExists(liveTransactionsDir);
    if (serverLiveTransactionsDir !== liveTransactionsDir) removeDirectoryIfExists(serverLiveTransactionsDir);
    removeDirectoryIfExists(clientHistoryDir);
    if (serverClientHistoryDir !== clientHistoryDir) removeDirectoryIfExists(serverClientHistoryDir);
    removeDirectoryIfExists(serverVaultDir);
    if (legacyVaultDir !== serverVaultDir) removeDirectoryIfExists(legacyVaultDir);

    delete index[indexKey];
    this.writeIndex(index);

    return {
      deleted: true,
      vaultId: vault.vaultId,
      serverVaultId: vault.serverVaultId,
      vaultName: vault.vaultName,
      backupsDeleted,
      liveDeleted,
      vaultRecordDeleted: true,
    };
  }

  /* ── Backup metadata ── */

  async renameVault(vaultId: string, newVaultName: string): Promise<StoredVault | null> {
    const cleanName = String(newVaultName || '').trim();
    if (!cleanName) {
      throw new Error('InvalidVaultName: new vault name is empty');
    }

    const index = this.readIndex() as Record<string, StoredVault>;
    const found = Object.entries(index).find(
      ([key, vault]) => key === vaultId || vault.vaultId === vaultId || vault.serverVaultId === vaultId
    );
    if (!found) return null;

    const [, vault] = found;
    vault.vaultName = cleanName;
    this.writeIndex(index);
    return vault;
  }

  async mergeVaults(sourceVaultId: string, targetVaultId: string, options: { deleteSource?: boolean } = {}): Promise<VaultMergeResult> {
    const index = this.readIndex() as Record<string, StoredVault>;
    const source = findVaultInIndex(index, sourceVaultId);
    const target = findVaultInIndex(index, targetVaultId);
    if (!source) throw new Error('Source vault not found');
    if (!target) throw new Error('Target vault not found');
    if (source.vault.vaultId === target.vault.vaultId || source.vault.serverVaultId === target.vault.serverVaultId) {
      throw new Error('Source and target vault are the same');
    }

    const warnings: string[] = [];
    let backupsCopied = 0;
    let liveFilesCopied = 0;
    let liveFilesSkipped = 0;
    let liveConflictsCopied = 0;
    let liveHistoryRecordsCopied = 0;

    for (const sourceBackupRoot of uniqueStrings([
      safeDirectChildPath(BACKUPS_DIR, source.vault.serverVaultId),
      safeDirectChildPath(BACKUPS_DIR, source.vault.vaultId),
    ])) {
      if (!fs.existsSync(sourceBackupRoot)) continue;
      const targetBackupRoot = safeDirectChildPath(BACKUPS_DIR, target.vault.serverVaultId);
      fs.mkdirSync(targetBackupRoot, { recursive: true });
      for (const entry of fs.readdirSync(sourceBackupRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const sourceBackupDir = safeDirectChildPath(sourceBackupRoot, entry.name);
        let targetBackupId = entry.name;
        let targetBackupDir = safeDirectChildPath(targetBackupRoot, targetBackupId);
        if (fs.existsSync(targetBackupDir)) {
          targetBackupId = uniqueBackupId(targetBackupRoot, `${source.vault.vaultId}_${entry.name}`);
          targetBackupDir = safeDirectChildPath(targetBackupRoot, targetBackupId);
        }
        copyDirectoryRecursive(sourceBackupDir, targetBackupDir);
        rewriteBackupMetaForMerge(targetBackupDir, target.vault.serverVaultId, targetBackupId);
        backupsCopied++;
      }
    }

    const conflictPrefix = `00_ServerMergeConflicts/${new Date().toISOString().replace(/[:.]/g, '-')}/${source.vault.vaultId}`;
    const sourceLiveFiles = await this.listLiveFiles(source.vault.vaultId);
    for (const sourceFile of sourceLiveFiles) {
      if (sourceFile.deleted || !sourceFile.contentBase64) {
        liveFilesSkipped++;
        continue;
      }

      const content = Buffer.from(sourceFile.contentBase64, 'base64');
      const targetFile = await this.getLiveFile(target.vault.vaultId, sourceFile.relativePath);
      if (!targetFile || targetFile.deleted) {
        await this.storeLiveFile(target.vault.vaultId, sourceFile.relativePath, content, sourceFile.sha256, sourceFile.updatedAt);
        liveFilesCopied++;
        continue;
      }
      if (targetFile.sha256 === sourceFile.sha256) {
        liveFilesSkipped++;
        continue;
      }

      const conflictPath = `${conflictPrefix}/${sourceFile.relativePath}`.replace(/\\/g, '/');
      await this.storeLiveFile(target.vault.vaultId, conflictPath, content, sourceFile.sha256, sourceFile.updatedAt);
      liveConflictsCopied++;
    }

    for (const sourceHistoryRoot of uniqueStrings([
      safeDirectChildPath(LIVE_HISTORY_DIR, source.vault.vaultId),
      safeDirectChildPath(LIVE_HISTORY_DIR, source.vault.serverVaultId),
    ])) {
      if (!fs.existsSync(sourceHistoryRoot)) continue;
      const targetHistoryRoot = safeDirectChildPath(LIVE_HISTORY_DIR, target.vault.vaultId);
      fs.mkdirSync(targetHistoryRoot, { recursive: true });
      liveHistoryRecordsCopied += copyDirectoryContentsNoOverwrite(sourceHistoryRoot, targetHistoryRoot, source.vault.vaultId);
    }

    let sourceDeleted = false;
    if (options.deleteSource) {
      const result = await this.deleteVault(source.vault.vaultId);
      sourceDeleted = !!result.deleted;
      if (!sourceDeleted) warnings.push('Source vault was merged but could not be deleted');
    }

    return {
      merged: true,
      sourceVaultId: source.vault.vaultId,
      sourceServerVaultId: source.vault.serverVaultId,
      targetVaultId: target.vault.vaultId,
      targetServerVaultId: target.vault.serverVaultId,
      backupsCopied,
      liveFilesCopied,
      liveFilesSkipped,
      liveConflictsCopied,
      liveHistoryRecordsCopied,
      sourceDeleted,
      conflictPrefix: liveConflictsCopied > 0 ? conflictPrefix : undefined,
      warnings,
    };
  }

  async exportVaultData(vaultId: string): Promise<VaultExportResult | null> {
    const index = this.readIndex() as Record<string, StoredVault>;
    const found = findVaultInIndex(index, vaultId);
    if (!found) return null;

    const vault = found.vault;
    const backups = [];
    for (const backup of await this.listBackups(vault.serverVaultId)) {
      const meta = await this.getBackupMeta(vault.serverVaultId, backup.backupId);
      if (!meta) continue;
      const files: Array<{ relativePath: string; size: number; sha256: string; contentBase64: string }> = [];
      for (const file of manifestFileEntries(meta.manifest)) {
        if (file.deleted) continue;
        const content = await this.readFile(vault.serverVaultId, backup.backupId, file.relativePath);
        if (!content) continue;
        files.push({
          relativePath: file.relativePath,
          size: content.length,
          sha256: crypto.createHash('sha256').update(content).digest('hex'),
          contentBase64: content.toString('base64'),
        });
      }
      backups.push({ meta, files });
    }

    const liveFiles = await this.listLiveFiles(vault.vaultId);
    const liveHistory = [];
    for (const item of await this.listLiveHistory(vault.vaultId, undefined, 1000)) {
      const record = await this.getLiveHistoryEntry(vault.vaultId, item.relativePath, item.revisionId);
      if (record) liveHistory.push(record);
    }
    const clientHistory = await this.listLiveSyncClientHistory(vault.vaultId, 500);
    const clientEvents = await this.listLiveSyncClientEvents(vault.vaultId, { limit: 2000 });

    const exportedAt = new Date().toISOString();
    const payload = {
      version: 1,
      app: 'Ars-note Sync Server',
      exportedAt,
      vault,
      backups,
      liveFiles,
      liveHistory,
      clientHistory,
      clientEvents,
    };
    const buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf-8');
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const safeName = safeExportName(vault.vaultName || vault.vaultId);
    return {
      vaultId: vault.vaultId,
      serverVaultId: vault.serverVaultId,
      vaultName: vault.vaultName,
      exportedAt,
      fileName: `ars-note-server-export-${safeName}-${exportedAt.slice(0, 19).replace(/[:T]/g, '-')}.json`,
      size: buffer.length,
      sha256,
      contentBase64: buffer.toString('base64'),
    };
  }

  async exportServerData(): Promise<ServerDataExportResult> {
    const { item, buffer } = await this.buildServerDataExport('manual-download');
    return {
      ...item,
      contentBase64: buffer.toString('base64'),
    };
  }

  async createServerDataSnapshot(options: { reason?: string; keepLatest?: number } = {}): Promise<ServerDataExportItem> {
    fs.mkdirSync(SERVER_EXPORTS_DIR, { recursive: true });
    const reason = String(options.reason || 'manual').trim().slice(0, 80) || 'manual';
    const { item, buffer } = await this.buildServerDataExport(reason);
    const compressed = zlib.gzipSync(buffer, { level: 6 });
    const storedFileName = item.fileName.endsWith('.gz') ? item.fileName : `${item.fileName}.gz`;
    const filePath = this.getServerExportFilePath(storedFileName);
    fs.writeFileSync(filePath, compressed);

    const storedItem: ServerDataExportItem = {
      ...item,
      fileName: storedFileName,
      size: compressed.length,
      sha256: crypto.createHash('sha256').update(compressed).digest('hex'),
      reason,
    };

    const index = this.readServerExportsIndex()
      .filter((entry) => entry.fileName !== storedItem.fileName);
    index.unshift(storedItem);
    this.writeServerExportsIndex(this.pruneServerExports(index, normalizeServerExportKeepLatest(options.keepLatest)));
    return storedItem;
  }

  async listServerDataSnapshots(limit = 50): Promise<ServerDataExportItem[]> {
    const max = Math.max(1, Math.min(500, Math.floor(Number(limit) || 50)));
    return this.readServerExportsIndex()
      .filter((item) => fs.existsSync(this.getServerExportFilePath(item.fileName)))
      .sort(compareServerExportsDesc)
      .slice(0, max);
  }

  async readServerDataSnapshot(fileName: string): Promise<ServerDataExportResult | null> {
    const cleanFileName = sanitizeServerExportFileName(fileName);
    const filePath = this.getServerExportFilePath(cleanFileName);
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath);
    const indexItem = this.readServerExportsIndex().find((item) => item.fileName === cleanFileName);
    return {
      exportedAt: indexItem?.exportedAt || fs.statSync(filePath).mtime.toISOString(),
      fileName: cleanFileName,
      size: content.length,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      sourceVaultCount: indexItem?.sourceVaultCount || 0,
      vaultCount: indexItem?.vaultCount || 0,
      skippedCount: indexItem?.skippedCount || 0,
      skipped: indexItem?.skipped || [],
      reason: indexItem?.reason,
      contentBase64: content.toString('base64'),
    };
  }

  async listServerSnapshotFiles(fileName: string, options: ServerSnapshotFileListOptions = {}): Promise<ServerSnapshotFileCandidate[]> {
    const bundle = this.readServerSnapshotBundle(fileName);
    if (!bundle) return [];
    return this.collectServerSnapshotFileCandidates(bundle, options, false).map(stripServerSnapshotContent);
  }

  async restoreServerSnapshotFile(fileName: string, options: ServerSnapshotFileRestoreOptions): Promise<ServerSnapshotFileRestoreResult | null> {
    const cleanFileName = sanitizeServerExportFileName(fileName);
    const requestedVaultId = String(options?.vaultId || '').trim();
    const requestedPath = sanitizeRelativePath(String(options?.relativePath || ''));
    if (!requestedVaultId) {
      throw new Error('MissingVaultId: vaultId is required');
    }

    const bundle = this.readServerSnapshotBundle(cleanFileName);
    if (!bundle) return null;

    const candidates = this.collectServerSnapshotFileCandidates(bundle, {
      vaultId: requestedVaultId,
      relativePath: requestedPath,
      source: options?.source,
      limit: 5000,
    }, true);
    const selected = candidates.find((item) => {
      if (item.relativePath !== requestedPath) return false;
      if (options?.source && item.source !== options.source) return false;
      if (options?.backupId && item.backupId !== options.backupId) return false;
      if (options?.revisionId && item.revisionId !== options.revisionId) return false;
      return item.contentAvailable && typeof item.contentBase64 === 'string';
    });
    if (!selected || typeof selected.contentBase64 !== 'string') return null;

    const content = Buffer.from(selected.contentBase64, 'base64');
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    if (selected.sha256 && selected.sha256 !== sha256) {
      throw new Error('SnapshotContentHashMismatch: selected file content does not match sha256');
    }

    const restoredAt = normalizeLiveUpdatedAt(options?.restoredAt);
    const live = this.getLivePaths(selected.vaultId, selected.relativePath);
    fs.mkdirSync(path.dirname(live.filePath), { recursive: true });
    fs.writeFileSync(live.filePath, content);

    const index = this.readLiveIndex(selected.vaultId);
    const serverRevision = this.nextLiveServerRevision(index);
    const history = this.writeLiveHistory(selected.vaultId, live.cleanPath, 'restore', {
      sha256,
      size: content.length,
      updatedAt: restoredAt,
      deleted: false,
      contentBase64: content.toString('base64'),
      reason: [
        'restored-from-server-snapshot',
        cleanFileName,
        selected.source,
        selected.revisionId || selected.backupId || 'live',
      ].join(':'),
      serverRevision,
      clientId: 'server-admin',
    });
    index[live.cleanPath] = {
      relativePath: live.cleanPath,
      sha256,
      size: content.length,
      updatedAt: restoredAt,
      deleted: false,
      serverRevision,
      revisionId: history.revisionId,
      updatedByClientId: 'server-admin',
    };
    this.writeLiveIndex(selected.vaultId, index);

    const file: LiveFileEntry = {
      relativePath: live.cleanPath,
      sha256,
      size: content.length,
      updatedAt: restoredAt,
      deleted: false,
      contentBase64: content.toString('base64'),
      serverRevision,
      revisionId: history.revisionId,
      updatedByClientId: 'server-admin',
    };

    return {
      restoredAt,
      file,
      candidate: stripServerSnapshotContent(selected),
    };
  }

  async storeBackupMeta(meta: StoredBackupMeta): Promise<void> {
    const metaDir = path.join(BACKUPS_DIR, meta.vaultId, meta.backupId);
    fs.mkdirSync(metaDir, { recursive: true });
    const metaPath = path.join(metaDir, 'backup-meta.json');
    writeJson(metaPath, meta);
  }

  async backupMetaExists(vaultId: string, backupId: string): Promise<boolean> {
    /* vaultId here is actually serverVaultId for storage */
    return fs.existsSync(path.join(BACKUPS_DIR, vaultId, backupId, 'backup-meta.json'));
  }

  async getBackupMeta(vaultId: string, backupId: string): Promise<StoredBackupMeta | null> {
    const metaPath = path.join(BACKUPS_DIR, vaultId, backupId, 'backup-meta.json');
    if (!fs.existsSync(metaPath)) return null;
    const result = readJsonSafe<StoredBackupMeta | null>(metaPath, null);
    return result;
  }

  async listBackups(vaultId: string): Promise<BackupListItem[]> {
    const vaultDir = path.join(BACKUPS_DIR, vaultId);
    if (!fs.existsSync(vaultDir)) return [];

    const results: BackupListItem[] = [];
    try {
      const entries = fs.readdirSync(vaultDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const metaPath = path.join(vaultDir, entry.name, 'backup-meta.json');
        if (!fs.existsSync(metaPath)) continue;
        const meta = readJsonSafe<StoredBackupMeta | null>(metaPath, null);
        if (!meta) continue;
        results.push({
          backupId: meta.backupId,
          uploadedAt: meta.uploadedAt,
          fileCount: meta.fileCount,
          totalSize: meta.totalSize,
          manifestHash: meta.manifestHash,
        });
      }
    } catch { /* ignore unreadable dirs */ }

    /* Sort newest first */
    results.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    return results;
  }

  async listAllBackups(): Promise<BackupListItemWithVault[]> {
    const index = this.readIndex() as Record<string, StoredVault>;
    const results: BackupListItemWithVault[] = [];

    for (const vault of Object.values(index)) {
      const backups = await this.listBackups(vault.serverVaultId);
      for (const backup of backups) {
        results.push({
          ...backup,
          vaultId: vault.vaultId,
          vaultName: vault.vaultName,
        });
      }
    }

    results.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    return results;
  }

  /* ── File operations ── */

  async deleteBackup(vaultId: string, backupId: string): Promise<boolean> {
    if (!/^[a-zA-Z0-9_-]+$/.test(backupId)) {
      throw new Error('Invalid backupId format');
    }

    const vaultDir = path.resolve(path.join(BACKUPS_DIR, vaultId));
    const backupDir = path.resolve(path.join(vaultDir, backupId));
    if (!backupDir.startsWith(vaultDir + path.sep) || backupDir === vaultDir) {
      throw new Error('PathEscape: backup path escapes vault directory');
    }
    if (!fs.existsSync(backupDir)) return false;

    fs.rmSync(backupDir, { recursive: true, force: true });
    return true;
  }

  async storeFile(vaultId: string, backupId: string, relativePath: string, content: Buffer): Promise<void> {
    const sanitized = sanitizeRelativePath(relativePath);
    const filePath = path.join(BACKUPS_DIR, vaultId, backupId, sanitized);

    /* Security: ensure the resolved path is inside the backup directory */
    const backupDir = path.resolve(path.join(BACKUPS_DIR, vaultId, backupId));
    const resolvedFilePath = path.resolve(filePath);
    if (!resolvedFilePath.startsWith(backupDir + path.sep) && resolvedFilePath !== backupDir) {
      throw new Error('PathEscape: resolved path escapes backup directory');
    }

    /* Ensure parent directory exists */
    const parentDir = path.dirname(resolvedFilePath);
    fs.mkdirSync(parentDir, { recursive: true });

    fs.writeFileSync(resolvedFilePath, content);
  }

  async readFile(vaultId: string, backupId: string, relativePath: string): Promise<Buffer | null> {
    const sanitized = sanitizeRelativePath(relativePath);
    const filePath = path.join(BACKUPS_DIR, vaultId, backupId, sanitized);

    /* Security: ensure the resolved path is inside the backup directory */
    const backupDir = path.resolve(path.join(BACKUPS_DIR, vaultId, backupId));
    const resolvedFilePath = path.resolve(filePath);
    if (!resolvedFilePath.startsWith(backupDir + path.sep) && resolvedFilePath !== backupDir) {
      throw new Error('PathEscape: resolved path escapes backup directory');
    }

    if (!fs.existsSync(resolvedFilePath)) return null;
    return fs.readFileSync(resolvedFilePath);
  }

  async fileExists(vaultId: string, backupId: string, relativePath: string): Promise<boolean> {
    const sanitized = sanitizeRelativePath(relativePath);
    const filePath = path.join(BACKUPS_DIR, vaultId, backupId, sanitized);

    const backupDir = path.resolve(path.join(BACKUPS_DIR, vaultId, backupId));
    const resolvedFilePath = path.resolve(filePath);
    if (!resolvedFilePath.startsWith(backupDir + path.sep) && resolvedFilePath !== backupDir) {
      return false;
    }

    return fs.existsSync(resolvedFilePath);
  }

  async storeLiveFile(
    vaultId: string,
    relativePath: string,
    content: Buffer,
    sha256: string,
    updatedAt?: string,
    metadata: { clientId?: string; deviceId?: string; reason?: string } = {},
  ): Promise<void> {
    const live = this.getLivePaths(vaultId, relativePath);
    const actualSha256 = crypto.createHash('sha256').update(content).digest('hex');
    if (actualSha256 !== String(sha256 || '').trim().toLowerCase()) {
      throw new Error(`LiveFileChecksumMismatch: ${live.cleanPath}`);
    }
    const liveUpdatedAt = normalizeLiveUpdatedAt(updatedAt);

    const index = this.readLiveIndex(vaultId);
    const serverRevision = this.nextLiveServerRevision(index);
    const history = this.writeLiveHistory(vaultId, live.cleanPath, 'update', {
      sha256,
      size: content.length,
      updatedAt: liveUpdatedAt,
      deleted: false,
      contentBase64: content.toString('base64'),
      reason: metadata.reason,
      serverRevision,
      clientId: metadata.clientId,
      deviceId: metadata.deviceId,
    });
    this.commitLiveMutation({
      version: 1,
      transactionId: this.createLiveTransactionId(serverRevision),
      vaultId,
      relativePath: live.cleanPath,
      action: 'update',
      sha256,
      size: content.length,
      updatedAt: liveUpdatedAt,
      serverRevision,
      revisionId: history.revisionId,
      clientId: cleanLiveMetadataValue(metadata.clientId),
      deviceId: cleanLiveMetadataValue(metadata.deviceId),
    });
  }

  async deleteLiveFile(
    vaultId: string,
    relativePath: string,
    updatedAt?: string,
    metadata: { clientId?: string; deviceId?: string; reason?: string } = {},
  ): Promise<void> {
    const live = this.getLivePaths(vaultId, relativePath);
    const previousContent = fs.existsSync(live.filePath) ? fs.readFileSync(live.filePath) : null;
    const previousSha256 = previousContent
      ? crypto.createHash('sha256').update(previousContent).digest('hex')
      : '';
    const liveUpdatedAt = normalizeLiveUpdatedAt(updatedAt);

    const index = this.readLiveIndex(vaultId);
    const serverRevision = this.nextLiveServerRevision(index);
    const tombstoneExpiresAt = addDaysIso(liveUpdatedAt, DEFAULT_LIVE_TOMBSTONE_RETENTION_DAYS);
    const history = this.writeLiveHistory(vaultId, live.cleanPath, 'delete', {
      sha256: previousSha256,
      size: previousContent?.length || 0,
      updatedAt: liveUpdatedAt,
      deleted: true,
      contentBase64: previousContent ? previousContent.toString('base64') : undefined,
      reason: metadata.reason,
      serverRevision,
      clientId: metadata.clientId,
      deviceId: metadata.deviceId,
      tombstoneExpiresAt,
    });
    this.commitLiveMutation({
      version: 1,
      transactionId: this.createLiveTransactionId(serverRevision),
      vaultId,
      relativePath: live.cleanPath,
      action: 'delete',
      sha256: '',
      size: 0,
      updatedAt: liveUpdatedAt,
      serverRevision,
      revisionId: history.revisionId,
      clientId: cleanLiveMetadataValue(metadata.clientId),
      deviceId: cleanLiveMetadataValue(metadata.deviceId),
      tombstoneExpiresAt,
    });
  }

  async getLiveFile(vaultId: string, relativePath: string): Promise<LiveFileEntry | null> {
    const live = this.getLivePaths(vaultId, relativePath);
    const index = this.readLiveIndex(vaultId);
    const item = index[live.cleanPath];
    if (!item || isIgnoredLivePath(item.relativePath)) return null;
    if (item.deleted) return { ...item, deleted: true };
    if (!fs.existsSync(live.filePath)) return null;
    const content = fs.readFileSync(live.filePath);
    return {
      ...item,
      size: content.length,
      contentBase64: content.toString('base64'),
    };
  }

  async recordRejectedLiveFile(
    vaultId: string,
    relativePath: string,
    action: 'create' | 'update' | 'delete',
    content: Buffer | null,
    sha256: string,
    updatedAt?: string,
    reason = 'rejected',
    metadata: { clientId?: string; deviceId?: string } = {},
  ): Promise<LiveFileHistoryEntry | null> {
    const live = this.getLivePaths(vaultId, relativePath);
    const liveUpdatedAt = normalizeLiveUpdatedAt(updatedAt);
    return this.writeLiveHistory(vaultId, live.cleanPath, `rejected-${action}`, {
      sha256,
      size: content?.length || 0,
      updatedAt: liveUpdatedAt,
      deleted: action === 'delete',
      contentBase64: content ? content.toString('base64') : undefined,
      reason,
      clientId: metadata.clientId,
      deviceId: metadata.deviceId,
    });
  }

  async listLiveHistory(vaultId: string, relativePath?: string, limit = 200): Promise<LiveFileHistoryEntry[]> {
    const safeVault = sanitizeVaultId(vaultId);
    const vaultHistoryDir = path.join(LIVE_HISTORY_DIR, safeVault);
    if (!fs.existsSync(vaultHistoryDir)) return [];

    const historyFiles: string[] = [];
    const maxResults = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 200)));

    if (relativePath && String(relativePath).trim()) {
      const cleanPath = sanitizeRelativePath(relativePath);
      const historyDir = this.getLiveHistoryDir(vaultId, cleanPath);
      if (fs.existsSync(historyDir)) {
        for (const entry of fs.readdirSync(historyDir, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith('.json')) {
            historyFiles.push(path.join(historyDir, entry.name));
          }
        }
      }
    } else {
      this.collectLiveHistoryFiles(vaultHistoryDir, historyFiles, maxResults * 4);
    }

    return historyFiles
      .map((filePath) => this.readLiveHistoryRecord(filePath, false))
      .filter((item): item is LiveFileHistoryEntry => !!item && !isIgnoredLivePath(item.relativePath))
      .sort(compareLiveHistoryDesc)
      .slice(0, maxResults);
  }

  async getLiveHistoryEntry(vaultId: string, relativePath: string, revisionId: string): Promise<LiveFileHistoryEntry | null> {
    const cleanPath = sanitizeRelativePath(relativePath);
    const cleanRevisionId = sanitizeRevisionId(revisionId);
    const historyDir = this.getLiveHistoryDir(vaultId, cleanPath);
    const recordPath = path.resolve(path.join(historyDir, `${cleanRevisionId}.json`));
    const resolvedHistoryDir = path.resolve(historyDir);
    if (!recordPath.startsWith(resolvedHistoryDir + path.sep)) {
      throw new Error('PathEscape: history record escapes history directory');
    }

    const record = this.readLiveHistoryRecord(recordPath, true);
    if (!record || record.relativePath !== cleanPath || record.revisionId !== cleanRevisionId) return null;
    if (isIgnoredLivePath(record.relativePath)) return null;
    return record;
  }

  async restoreLiveHistoryEntry(
    vaultId: string,
    relativePath: string,
    revisionId: string,
    restoredAt?: string,
    metadata: { clientId?: string; deviceId?: string; reason?: string } = {},
  ): Promise<LiveFileEntry | null> {
    const record = await this.getLiveHistoryEntry(vaultId, relativePath, revisionId);
    if (!record || !record.contentBase64) return null;

    const live = this.getLivePaths(vaultId, record.relativePath);
    const content = Buffer.from(record.contentBase64, 'base64');
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const liveUpdatedAt = normalizeLiveUpdatedAt(restoredAt);

    fs.mkdirSync(path.dirname(live.filePath), { recursive: true });
    fs.writeFileSync(live.filePath, content);

    const index = this.readLiveIndex(vaultId);
    const serverRevision = this.nextLiveServerRevision(index);
    const history = this.writeLiveHistory(vaultId, live.cleanPath, 'restore', {
      sha256,
      size: content.length,
      updatedAt: liveUpdatedAt,
      deleted: false,
      contentBase64: content.toString('base64'),
      reason: metadata.reason || `restored-from:${record.revisionId}`,
      serverRevision,
      clientId: metadata.clientId,
      deviceId: metadata.deviceId,
    });
    this.writeLiveIndex(vaultId, {
      ...index,
      [live.cleanPath]: {
        relativePath: live.cleanPath,
        sha256,
        size: content.length,
        updatedAt: liveUpdatedAt,
        deleted: false,
        serverRevision,
        revisionId: history.revisionId,
        updatedByClientId: cleanLiveMetadataValue(metadata.clientId),
        updatedByDeviceId: cleanLiveMetadataValue(metadata.deviceId),
      },
    });

    return {
      relativePath: live.cleanPath,
      sha256,
      size: content.length,
      updatedAt: liveUpdatedAt,
      deleted: false,
      contentBase64: content.toString('base64'),
      serverRevision,
      revisionId: history.revisionId,
      updatedByClientId: cleanLiveMetadataValue(metadata.clientId),
      updatedByDeviceId: cleanLiveMetadataValue(metadata.deviceId),
    };
  }

  async upsertLiveSyncClientHistory(vaultId: string, entry: LiveSyncClientHistoryEntry): Promise<void> {
    const cleanVaultId = sanitizeVaultId(vaultId);
    const index = this.readClientHistoryIndex(cleanVaultId);
    const clientKey = safeClientHistoryKey(entry.clientKey || entry.deviceId || entry.clientId);
    const existing = index[clientKey];
    const now = normalizeLiveUpdatedAt(entry.updatedAt);

    const normalized = normalizeClientHistoryEntry({
      ...existing,
      ...entry,
      vaultId: cleanVaultId,
      clientKey,
      firstSeenAt: existing?.firstSeenAt || entry.firstSeenAt || entry.connectedAt || now,
      updatedAt: now,
    });
    if (!normalized) return;
    index[clientKey] = normalized;

    this.writeClientHistoryIndex(cleanVaultId, pruneClientHistoryIndex(index));
  }

  async listLiveSyncClientHistory(vaultId: string, limit = 100): Promise<LiveSyncClientHistoryEntry[]> {
    const maxResults = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    return Object.values(this.readClientHistoryIndex(vaultId))
      .map((item) => normalizeClientHistoryEntry(item))
      .filter((item): item is LiveSyncClientHistoryEntry => !!item)
      .sort(compareClientHistoryDesc)
      .slice(0, maxResults);
  }

  async appendLiveSyncClientEvent(vaultId: string, event: LiveSyncClientEventEntry): Promise<void> {
    const cleanVaultId = sanitizeVaultId(vaultId);
    const normalized = normalizeClientEventEntry({
      ...event,
      vaultId: cleanVaultId,
    });
    if (!normalized) return;
    const events = this.readClientEventLog(cleanVaultId);
    events.unshift(normalized);
    this.writeClientEventLog(cleanVaultId, pruneClientEventLog(events));
  }

  async listLiveSyncClientEvents(vaultId: string, options: LiveSyncClientEventListOptions = {}): Promise<LiveSyncClientEventEntry[]> {
    const maxResults = Math.max(1, Math.min(2000, Math.floor(Number(options.limit) || 100)));
    const clientKey = options.clientKey ? safeClientHistoryKey(String(options.clientKey)) : '';
    const relativePath = options.relativePath
      ? String(options.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
      : '';
    const level = options.level;

    return this.readClientEventLog(vaultId)
      .filter((event) => !clientKey || event.clientKey === clientKey)
      .filter((event) => !level || event.level === level)
      .filter((event) => !relativePath || String(event.relativePath || '').toLowerCase() === relativePath)
      .sort(compareClientEventsDesc)
      .slice(0, maxResults);
  }

  async listLiveFiles(vaultId: string, options: { includeContent?: boolean } = {}): Promise<LiveFileEntry[]> {
    const index = this.readLiveIndex(vaultId);
    const entries: LiveFileEntry[] = [];
    const includeContent = options.includeContent !== false;

    for (const item of Object.values(index)) {
      if (isIgnoredLivePath(item.relativePath)) continue;
      if (item.deleted) {
        entries.push(item);
        continue;
      }

      const live = this.getLivePaths(vaultId, item.relativePath);
      if (!fs.existsSync(live.filePath)) continue;
      if (!includeContent) {
        entries.push(item);
        continue;
      }
      const content = fs.readFileSync(live.filePath);
      entries.push({
        ...item,
        size: content.length,
        contentBase64: content.toString('base64'),
      });
    }

    entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return entries;
  }

  async getLiveFileSummary(vaultId: string): Promise<LiveFileSummary> {
    const entries = Object.values(this.readLiveIndex(vaultId))
      .filter((item) => !isIgnoredLivePath(item.relativePath));
    const activeFiles = entries.filter((item) => !item.deleted);
    const deletedFiles = entries.filter((item) => item.deleted);
    const recentFiles = [...entries]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 8)
      .map((item) => ({
        relativePath: item.relativePath,
        size: item.size,
        updatedAt: item.updatedAt,
        deleted: item.deleted,
      }));

    return {
      fileCount: activeFiles.length,
      deletedCount: deletedFiles.length,
      totalSize: activeFiles.reduce((sum, item) => sum + (Number(item.size) || 0), 0),
      lastUpdatedAt: recentFiles[0]?.updatedAt || null,
      recentFiles,
    };
  }

  async pruneLiveTombstones(vaultId: string, options: { olderThanDays?: number; now?: string; force?: boolean } = {}): Promise<number> {
    const index = this.readLiveIndex(vaultId);
    const nowMs = Date.parse(options.now || '') || Date.now();
    const retentionDays = normalizeTombstoneRetentionDays(options.olderThanDays);
    let removed = 0;

    for (const [key, item] of Object.entries(index)) {
      if (!item.deleted) continue;
      const expiresAt = item.tombstoneExpiresAt || addDaysIso(item.updatedAt, retentionDays);
      const expiresMs = Date.parse(expiresAt);
      if (!options.force && (!Number.isFinite(expiresMs) || expiresMs > nowMs)) continue;
      delete index[key];
      removed++;
    }

    if (removed > 0) {
      this.writeLiveIndex(vaultId, index);
    }

    return removed;
  }

  /* ── Helpers ── */

  async pruneIgnoredLiveFiles(vaultId: string): Promise<number> {
    const index = this.readLiveIndex(vaultId);
    let removed = 0;

    for (const [key, item] of Object.entries(index)) {
      if (!isIgnoredLivePath(item.relativePath)) continue;
      const live = this.getLivePaths(vaultId, item.relativePath);
      try {
        if (fs.existsSync(live.filePath)) fs.rmSync(live.filePath, { recursive: true, force: true });
        const historyDir = this.getLiveHistoryDir(vaultId, item.relativePath);
        if (fs.existsSync(historyDir)) fs.rmSync(historyDir, { recursive: true, force: true });
      } catch { /* ignore cleanup errors */ }
      delete index[key];
      removed++;
    }

    if (removed > 0) {
      this.writeLiveIndex(vaultId, index);
    }

    return removed;
  }

  private async buildServerDataExport(reason = 'manual-download'): Promise<{ item: ServerDataExportItem; buffer: Buffer }> {
    const exportedAt = new Date().toISOString();
    const vaults = await this.listVaults();
    const vaultExports: any[] = [];
    const skipped: ServerDataExportSkippedItem[] = [];

    for (const vault of vaults) {
      try {
        const result = await this.exportVaultData(vault.vaultId);
        if (!result) {
          skipped.push({ vaultId: vault.vaultId, vaultName: vault.vaultName, error: 'Vault not found during export' });
          continue;
        }

        try {
          const payload = JSON.parse(Buffer.from(result.contentBase64, 'base64').toString('utf-8'));
          vaultExports.push({
            vaultId: result.vaultId,
            serverVaultId: result.serverVaultId,
            vaultName: result.vaultName,
            fileName: result.fileName,
            size: result.size,
            sha256: result.sha256,
            payload,
          });
        } catch (err: any) {
          skipped.push({
            vaultId: vault.vaultId,
            vaultName: vault.vaultName,
            error: err?.message || 'Unable to decode vault export payload',
          });
        }
      } catch (err: any) {
        skipped.push({
          vaultId: vault.vaultId,
          vaultName: vault.vaultName,
          error: err?.message || 'Vault export failed',
        });
      }
    }

    const bundle = {
      version: 1,
      app: SERVER_APP_NAME,
      serverVersion: SERVER_VERSION,
      storageBackend: 'local',
      exportType: 'full-server-data',
      exportedAt,
      reason,
      sourceVaultCount: vaults.length,
      vaultCount: vaultExports.length,
      skippedCount: skipped.length,
      skipped,
      vaultExports,
    };
    const buffer = Buffer.from(JSON.stringify(bundle, null, 2), 'utf-8');
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    return {
      item: {
        exportedAt,
        fileName: `ars-note-server-full-export-${exportedAt.slice(0, 19).replace(/[:T]/g, '-')}.json`,
        size: buffer.length,
        sha256,
        sourceVaultCount: vaults.length,
        vaultCount: vaultExports.length,
        skippedCount: skipped.length,
        skipped,
        reason,
      },
      buffer,
    };
  }

  private readServerExportsIndex(): ServerDataExportItem[] {
    const raw = readJsonSafe<any>(SERVER_EXPORTS_INDEX_FILE, { version: 1, items: [] });
    const items: any[] = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : []);
    return items
      .map(normalizeServerExportIndexItem)
      .filter((item): item is ServerDataExportItem => !!item)
      .sort(compareServerExportsDesc);
  }

  private writeServerExportsIndex(items: ServerDataExportItem[]): void {
    writeJson(SERVER_EXPORTS_INDEX_FILE, {
      version: 1,
      updatedAt: new Date().toISOString(),
      keepLatest: normalizeServerExportKeepLatest(),
      items: items.sort(compareServerExportsDesc),
    });
  }

  private pruneServerExports(items: ServerDataExportItem[], keepLatest: number): ServerDataExportItem[] {
    const sorted = items.sort(compareServerExportsDesc);
    const keep = sorted.slice(0, keepLatest);
    const remove = sorted.slice(keepLatest);
    for (const item of remove) {
      try {
        const filePath = this.getServerExportFilePath(item.fileName);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch { /* best effort */ }
    }
    return keep;
  }

  private getServerExportFilePath(fileName: string): string {
    const cleanFileName = sanitizeServerExportFileName(fileName);
    const filePath = path.resolve(path.join(SERVER_EXPORTS_DIR, cleanFileName));
    const root = path.resolve(SERVER_EXPORTS_DIR);
    if (!filePath.startsWith(root + path.sep) && filePath !== root) {
      throw new Error('PathEscape: server export path escapes export directory');
    }
    return filePath;
  }

  private readServerSnapshotBundle(fileName: string): any | null {
    const cleanFileName = sanitizeServerExportFileName(fileName);
    const filePath = this.getServerExportFilePath(cleanFileName);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath);
    const payload = cleanFileName.endsWith('.gz') ? zlib.gunzipSync(raw) : raw;
    const bundle = JSON.parse(payload.toString('utf-8'));
    if (!bundle || typeof bundle !== 'object' || !Array.isArray(bundle.vaultExports)) {
      throw new Error('InvalidServerSnapshot: missing vaultExports');
    }
    return bundle;
  }

  private collectServerSnapshotFileCandidates(
    bundle: any,
    options: ServerSnapshotFileListOptions = {},
    includeContent = false,
  ): ServerSnapshotFileCandidateWithContent[] {
    const requestedVaultId = String(options?.vaultId || '').trim();
    const requestedPath = options?.relativePath
      ? sanitizeRelativePath(String(options.relativePath || ''))
      : '';
    const query = String(options?.query || '').trim().replace(/\\/g, '/').toLowerCase();
    const sourceFilter = normalizeServerSnapshotFileSource(options?.source);
    const limit = Math.max(1, Math.min(5000, Math.floor(Number(options?.limit) || 200)));
    const exportedAt = normalizeSnapshotTimestamp(bundle?.exportedAt);
    const results: ServerSnapshotFileCandidateWithContent[] = [];

    const vaultExports = Array.isArray(bundle?.vaultExports) ? bundle.vaultExports : [];
    for (const vaultExport of vaultExports) {
      const payload = vaultExport?.payload && typeof vaultExport.payload === 'object' ? vaultExport.payload : {};
      const payloadVault = payload?.vault && typeof payload.vault === 'object' ? payload.vault : {};
      const vaultId = String(vaultExport?.vaultId || payloadVault?.vaultId || '').trim();
      if (!vaultId) continue;
      const serverVaultId = String(vaultExport?.serverVaultId || payloadVault?.serverVaultId || vaultId).trim();
      const vaultName = String(vaultExport?.vaultName || payloadVault?.vaultName || vaultId).trim() || vaultId;
      if (requestedVaultId && requestedVaultId !== vaultId && requestedVaultId !== serverVaultId) continue;

      const addCandidate = (candidate: ServerSnapshotFileCandidateWithContent): void => {
        if (sourceFilter && candidate.source !== sourceFilter) return;
        if (requestedPath && candidate.relativePath !== requestedPath) return;
        if (query && !candidate.relativePath.toLowerCase().includes(query)) return;
        if (isIgnoredLivePath(candidate.relativePath)) return;
        results.push(includeContent ? candidate : stripServerSnapshotContent(candidate));
      };

      if (!sourceFilter || sourceFilter === 'live') {
        for (const file of Array.isArray(payload?.liveFiles) ? payload.liveFiles : []) {
          const relativePath = normalizeSnapshotRelativePath(file?.relativePath);
          if (!relativePath) continue;
          const hasContent = typeof file?.contentBase64 === 'string';
          addCandidate({
            vaultId,
            serverVaultId,
            vaultName,
            relativePath,
            source: 'live',
            size: Math.max(0, Number(file?.size) || 0),
            sha256: String(file?.sha256 || ''),
            updatedAt: normalizeSnapshotTimestamp(file?.updatedAt, exportedAt),
            deleted: !!file?.deleted,
            contentAvailable: hasContent,
            contentBase64: includeContent && hasContent ? String(file.contentBase64) : undefined,
          });
        }
      }

      if (!sourceFilter || sourceFilter === 'live-history') {
        for (const record of Array.isArray(payload?.liveHistory) ? payload.liveHistory : []) {
          const relativePath = normalizeSnapshotRelativePath(record?.relativePath);
          if (!relativePath) continue;
          const hasContent = typeof record?.contentBase64 === 'string';
          addCandidate({
            vaultId,
            serverVaultId,
            vaultName,
            relativePath,
            source: 'live-history',
            size: Math.max(0, Number(record?.size) || 0),
            sha256: String(record?.sha256 || ''),
            updatedAt: normalizeSnapshotTimestamp(record?.updatedAt || record?.recordedAt, exportedAt),
            recordedAt: normalizeSnapshotTimestamp(record?.recordedAt, exportedAt),
            revisionId: String(record?.revisionId || ''),
            action: String(record?.action || 'unknown'),
            deleted: !!record?.deleted,
            contentAvailable: hasContent,
            contentBase64: includeContent && hasContent ? String(record.contentBase64) : undefined,
          });
        }
      }

      if (!sourceFilter || sourceFilter === 'backup') {
        for (const backup of Array.isArray(payload?.backups) ? payload.backups : []) {
          const meta = backup?.meta && typeof backup.meta === 'object' ? backup.meta : {};
          const backupId = String(meta?.backupId || '').trim();
          const backupTime = normalizeSnapshotTimestamp(meta?.uploadedAt || meta?.createdAt, exportedAt);
          for (const file of Array.isArray(backup?.files) ? backup.files : []) {
            const relativePath = normalizeSnapshotRelativePath(file?.relativePath);
            if (!relativePath) continue;
            const hasContent = typeof file?.contentBase64 === 'string';
            addCandidate({
              vaultId,
              serverVaultId,
              vaultName,
              relativePath,
              source: 'backup',
              size: Math.max(0, Number(file?.size) || 0),
              sha256: String(file?.sha256 || ''),
              updatedAt: backupTime,
              backupId,
              contentAvailable: hasContent,
              contentBase64: includeContent && hasContent ? String(file.contentBase64) : undefined,
            });
          }
        }
      }
    }

    return results
      .sort(compareServerSnapshotCandidatesDesc)
      .slice(0, limit);
  }

  private readIndex(): Record<string, unknown> {
    return readJsonWithBackupStrict<Record<string, unknown>>(INDEX_FILE, {});
  }

  private writeIndex(index: Record<string, unknown>): void {
    writeJsonWithBackup(INDEX_FILE, index);
  }

  private getLivePaths(vaultId: string, relativePath: string): { cleanPath: string; filePath: string; vaultDir: string } {
    const safeVault = sanitizeVaultId(vaultId);
    const cleanPath = sanitizeRelativePath(relativePath);
    const vaultDir = path.join(LIVE_DIR, safeVault);
    const filePath = path.join(vaultDir, 'files', cleanPath);
    const resolvedFilePath = path.resolve(filePath);
    const resolvedFilesDir = path.resolve(path.join(vaultDir, 'files'));
    if (!resolvedFilePath.startsWith(resolvedFilesDir + path.sep) && resolvedFilePath !== resolvedFilesDir) {
      throw new Error('PathEscape: live file path escapes vault directory');
    }
    return { cleanPath, filePath: resolvedFilePath, vaultDir };
  }

  private readLiveIndex(vaultId: string): Record<string, LiveFileEntry> {
    const safeVault = sanitizeVaultId(vaultId);
    return readJsonWithBackupStrict<Record<string, LiveFileEntry>>(path.join(LIVE_DIR, safeVault, 'live-index.json'), {});
  }

  private writeLiveIndex(vaultId: string, index: Record<string, LiveFileEntry>): void {
    const safeVault = sanitizeVaultId(vaultId);
    writeJsonWithBackup(path.join(LIVE_DIR, safeVault, 'live-index.json'), index);
  }

  private validateCriticalIndexes(): void {
    this.readIndex();
    let vaultEntries: fs.Dirent[] = [];
    try {
      vaultEntries = fs.readdirSync(LIVE_DIR, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of vaultEntries) {
      if (!entry.isDirectory()) continue;
      const indexPath = path.join(LIVE_DIR, entry.name, 'live-index.json');
      if (!fs.existsSync(indexPath) && !fs.existsSync(`${indexPath}.bak`)) continue;
      const index = readJsonWithBackupStrict<Record<string, LiveFileEntry>>(indexPath, {});
      this.repairLiveFilesFromIndex(entry.name, index);
    }
  }

  private repairLiveFilesFromIndex(vaultId: string, index: Record<string, LiveFileEntry>): void {
    for (const item of Object.values(index)) {
      if (!item?.relativePath || isIgnoredLivePath(item.relativePath)) continue;
      const live = this.getLivePaths(vaultId, item.relativePath);
      if (item.deleted) {
        if (fs.existsSync(live.filePath)) fs.unlinkSync(live.filePath);
        continue;
      }

      let currentValid = false;
      if (fs.existsSync(live.filePath)) {
        const current = fs.readFileSync(live.filePath);
        const currentHash = crypto.createHash('sha256').update(current).digest('hex');
        currentValid = currentHash === item.sha256;
      }
      if (currentValid) continue;

      const historyPath = path.join(this.getLiveHistoryDir(vaultId, item.relativePath), `${item.revisionId || ''}.json`);
      const history = item.revisionId ? this.readLiveHistoryRecord(historyPath, true) : null;
      if (!history || typeof history.contentBase64 !== 'string') {
        throw new Error(`LiveFileIntegrityError: no recoverable content for ${vaultId}/${item.relativePath}`);
      }
      const recovered = Buffer.from(history.contentBase64, 'base64');
      const recoveredHash = crypto.createHash('sha256').update(recovered).digest('hex');
      if (recoveredHash !== item.sha256) {
        throw new Error(`LiveFileIntegrityError: history checksum mismatch for ${vaultId}/${item.relativePath}`);
      }
      atomicWriteFile(live.filePath, recovered);
    }
  }

  private createLiveTransactionId(serverRevision: number): string {
    return `${String(serverRevision).padStart(12, '0')}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  private getLiveTransactionPath(transaction: LiveMutationTransaction): string {
    const safeVault = sanitizeVaultId(transaction.vaultId);
    return path.join(LIVE_TRANSACTIONS_DIR, safeVault, `${transaction.transactionId}.json`);
  }

  private commitLiveMutation(transaction: LiveMutationTransaction): void {
    const transactionPath = this.getLiveTransactionPath(transaction);
    writeJson(transactionPath, transaction);
    this.applyLiveMutationTransaction(transaction);
    fs.unlinkSync(transactionPath);
    removeEmptyDirectory(path.dirname(transactionPath));
  }

  private applyLiveMutationTransaction(transaction: LiveMutationTransaction): void {
    const live = this.getLivePaths(transaction.vaultId, transaction.relativePath);
    const index = this.readLiveIndex(transaction.vaultId);
    const current = index[live.cleanPath];
    const currentRevision = Math.max(0, Number(current?.serverRevision || 0));
    if (currentRevision > transaction.serverRevision) return;

    if (transaction.action === 'update') {
      const historyPath = path.join(this.getLiveHistoryDir(transaction.vaultId, live.cleanPath), `${transaction.revisionId}.json`);
      const history = this.readLiveHistoryRecord(historyPath, true);
      if (!history || typeof history.contentBase64 !== 'string') {
        throw new Error(`LiveTransactionRecoveryError: missing history content for ${transaction.vaultId}/${live.cleanPath}`);
      }
      const content = Buffer.from(history.contentBase64, 'base64');
      const actualSha256 = crypto.createHash('sha256').update(content).digest('hex');
      if (actualSha256 !== transaction.sha256 || content.length !== transaction.size) {
        throw new Error(`LiveTransactionRecoveryError: history checksum mismatch for ${transaction.vaultId}/${live.cleanPath}`);
      }
      atomicWriteFile(live.filePath, content);
      index[live.cleanPath] = {
        relativePath: live.cleanPath,
        sha256: transaction.sha256,
        size: transaction.size,
        updatedAt: transaction.updatedAt,
        deleted: false,
        serverRevision: transaction.serverRevision,
        revisionId: transaction.revisionId,
        updatedByClientId: transaction.clientId,
        updatedByDeviceId: transaction.deviceId,
      };
      this.writeLiveIndex(transaction.vaultId, index);
      return;
    }

    index[live.cleanPath] = {
      relativePath: live.cleanPath,
      sha256: '',
      size: 0,
      updatedAt: transaction.updatedAt,
      deleted: true,
      serverRevision: transaction.serverRevision,
      revisionId: transaction.revisionId,
      updatedByClientId: transaction.clientId,
      updatedByDeviceId: transaction.deviceId,
      tombstoneExpiresAt: transaction.tombstoneExpiresAt,
    };
    this.writeLiveIndex(transaction.vaultId, index);
    if (fs.existsSync(live.filePath)) fs.unlinkSync(live.filePath);
  }

  private recoverLiveTransactions(): void {
    let vaultEntries: fs.Dirent[] = [];
    try {
      vaultEntries = fs.readdirSync(LIVE_TRANSACTIONS_DIR, { withFileTypes: true });
    } catch {
      return;
    }

    for (const vaultEntry of vaultEntries) {
      if (!vaultEntry.isDirectory()) continue;
      const vaultTransactionDir = path.join(LIVE_TRANSACTIONS_DIR, vaultEntry.name);
      const transactionFiles = fs.readdirSync(vaultTransactionDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name)
        .sort();
      for (const name of transactionFiles) {
        const transactionPath = path.join(vaultTransactionDir, name);
        const transaction = readJsonRequired<LiveMutationTransaction>(transactionPath);
        if (
          transaction.version !== 1
          || !transaction.transactionId
          || !transaction.vaultId
          || !transaction.relativePath
          || (transaction.action !== 'update' && transaction.action !== 'delete')
          || !Number.isFinite(Number(transaction.serverRevision))
          || Number(transaction.serverRevision) <= 0
          || !transaction.revisionId
        ) {
          throw new Error(`LiveTransactionRecoveryError: invalid transaction journal ${transactionPath}`);
        }
        this.applyLiveMutationTransaction(transaction);
        fs.unlinkSync(transactionPath);
      }
      removeEmptyDirectory(vaultTransactionDir);
    }
  }

  private nextLiveServerRevision(index: Record<string, LiveFileEntry>): number {
    const latest = Object.values(index).reduce((max, item) => {
      const value = Number(item?.serverRevision || 0);
      return Number.isFinite(value) && value > max ? value : max;
    }, 0);
    return latest + 1;
  }

  private getClientHistoryIndexPath(vaultId: string): string {
    const safeVault = sanitizeVaultId(vaultId);
    return path.join(CLIENT_HISTORY_DIR, safeVault, 'clients.json');
  }

  private readClientHistoryIndex(vaultId: string): Record<string, LiveSyncClientHistoryEntry> {
    const raw = readJsonSafe<any>(this.getClientHistoryIndexPath(vaultId), { version: 1, clients: {} });
    const source = raw && typeof raw === 'object' && raw.clients && typeof raw.clients === 'object'
      ? raw.clients
      : raw;
    const result: Record<string, LiveSyncClientHistoryEntry> = {};
    for (const [key, value] of Object.entries(source || {})) {
      const normalized = normalizeClientHistoryEntry({
        ...(typeof value === 'object' && value ? value as Record<string, unknown> : {}),
        clientKey: key,
        vaultId,
      });
      if (normalized) result[normalized.clientKey] = normalized;
    }
    return result;
  }

  private writeClientHistoryIndex(vaultId: string, index: Record<string, LiveSyncClientHistoryEntry>): void {
    writeJson(this.getClientHistoryIndexPath(vaultId), {
      version: 1,
      updatedAt: new Date().toISOString(),
      clients: index,
    });
  }

  private getClientEventLogPath(vaultId: string): string {
    const safeVault = sanitizeVaultId(vaultId);
    return path.join(CLIENT_HISTORY_DIR, safeVault, 'events.json');
  }

  private readClientEventLog(vaultId: string): LiveSyncClientEventEntry[] {
    const raw = readJsonSafe<any>(this.getClientEventLogPath(vaultId), { version: 1, events: [] });
    const source: unknown[] = Array.isArray(raw) ? raw : (Array.isArray(raw?.events) ? raw.events : []);
    return source
      .map(normalizeClientEventEntry)
      .filter((item): item is LiveSyncClientEventEntry => !!item)
      .sort(compareClientEventsDesc);
  }

  private writeClientEventLog(vaultId: string, events: LiveSyncClientEventEntry[]): void {
    writeJson(this.getClientEventLogPath(vaultId), {
      version: 1,
      updatedAt: new Date().toISOString(),
      events: events.sort(compareClientEventsDesc),
    });
  }

  private getLiveHistoryDir(vaultId: string, relativePath: string): string {
    const safeVault = sanitizeVaultId(vaultId);
    const cleanPath = sanitizeRelativePath(relativePath);
    const historyDir = path.resolve(path.join(LIVE_HISTORY_DIR, safeVault, safeHistoryPathPart(cleanPath)));
    const resolvedVaultHistoryDir = path.resolve(path.join(LIVE_HISTORY_DIR, safeVault));
    if (historyDir !== resolvedVaultHistoryDir && !historyDir.startsWith(resolvedVaultHistoryDir + path.sep)) {
      throw new Error('PathEscape: live history path escapes vault history directory');
    }
    return historyDir;
  }

  private collectLiveHistoryFiles(dirPath: string, results: string[], scanLimit: number): void {
    if (results.length >= scanLimit) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= scanLimit) return;
      const childPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        this.collectLiveHistoryFiles(childPath, results, scanLimit);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        results.push(childPath);
      }
    }
  }

  private readLiveHistoryRecord(filePath: string, includeContent: boolean): LiveFileHistoryEntry | null {
    const raw = readJsonSafe<any | null>(filePath, null);
    if (!raw || typeof raw !== 'object') return null;

    const revisionId = String(raw.revisionId || path.basename(filePath, '.json'));
    if (!isSafeRevisionId(revisionId)) return null;

    const relativePath = String(raw.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!relativePath) return null;

    const item: LiveFileHistoryEntry = {
      revisionId,
      relativePath,
      action: String(raw.action || 'unknown'),
      recordedAt: normalizeLiveUpdatedAt(raw.recordedAt),
      updatedAt: normalizeLiveUpdatedAt(raw.updatedAt),
      sha256: String(raw.sha256 || ''),
      size: Number(raw.size) || 0,
      deleted: !!raw.deleted,
      reason: typeof raw.reason === 'string' && raw.reason ? raw.reason : undefined,
      serverRevision: normalizePositiveInteger(raw.serverRevision),
      clientId: optionalShortText(raw.clientId, 160),
      deviceId: optionalShortText(raw.deviceId, 160),
      tombstoneExpiresAt: raw.tombstoneExpiresAt ? normalizeLiveUpdatedAt(raw.tombstoneExpiresAt) : undefined,
    };

    if (includeContent && typeof raw.contentBase64 === 'string') {
      item.contentBase64 = raw.contentBase64;
    }

    return item;
  }

  private writeLiveHistory(
    vaultId: string,
    relativePath: string,
    action: string,
    data: {
      sha256: string;
      size: number;
      updatedAt: string;
      deleted?: boolean;
      contentBase64?: string;
      reason?: string;
      serverRevision?: number;
      clientId?: string;
      deviceId?: string;
      tombstoneExpiresAt?: string;
    },
  ): LiveFileHistoryEntry {
    const safeVault = sanitizeVaultId(vaultId);
    const historyDir = path.join(LIVE_HISTORY_DIR, safeVault, safeHistoryPathPart(relativePath));
    fs.mkdirSync(historyDir, { recursive: true });

    const recordedAt = new Date().toISOString();
    const stamp = recordedAt.replace(/[:.]/g, '-');
    const suffix = crypto.randomBytes(3).toString('hex');
    const record = {
      version: 1,
      revisionId: `${stamp}-${suffix}`,
      relativePath,
      action,
      recordedAt,
      updatedAt: data.updatedAt,
      sha256: data.sha256,
      size: data.size,
      deleted: !!data.deleted,
      reason: data.reason || undefined,
      serverRevision: normalizePositiveInteger(data.serverRevision),
      clientId: cleanLiveMetadataValue(data.clientId),
      deviceId: cleanLiveMetadataValue(data.deviceId),
      tombstoneExpiresAt: data.tombstoneExpiresAt ? normalizeLiveUpdatedAt(data.tombstoneExpiresAt) : undefined,
      contentBase64: data.contentBase64,
    };

    writeJson(path.join(historyDir, `${record.revisionId}.json`), record);
    this.pruneLiveHistoryDirectory(historyDir);
    return record;
  }

  private pruneLiveHistoryDirectory(historyDir: string): void {
    try {
      const versions = fs.readdirSync(historyDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name)
        .sort();
      if (versions.length <= MAX_LIVE_HISTORY_VERSIONS) return;
      for (const name of versions.slice(0, versions.length - MAX_LIVE_HISTORY_VERSIONS)) {
        fs.unlinkSync(path.join(historyDir, name));
      }
    } catch { /* best effort */ }
  }
}

/* ── Path sanitization ── */

/**
 * Sanitize a relative path to prevent directory traversal.
 * Rules:
 *   - No '..' components
 *   - No absolute paths (starts with / or drive letter)
 *   - No backslash (normalize to forward slash)
 *   - No null bytes
 *   - No file:// or other protocol schemes
 */
export function sanitizeRelativePath(relPath: string): string {
  if (!relPath || typeof relPath !== 'string') {
    throw new Error('InvalidPath: relativePath is empty or not a string');
  }

  /* Reject null bytes */
  if (relPath.includes('\0')) {
    throw new Error('InvalidPath: null byte in path');
  }

  /* Reject protocol schemes */
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(relPath)) {
    throw new Error('InvalidPath: protocol scheme not allowed');
  }

  /* Normalize separators */
  let normalized = relPath.replace(/\\/g, '/');

  /* Reject absolute paths */
  if (normalized.startsWith('/')) {
    throw new Error('InvalidPath: absolute path not allowed');
  }

  /* Split into components and reject '..' */
  const parts = normalized.split('/').filter(Boolean);
  for (const part of parts) {
    if (part === '..') {
      throw new Error('InvalidPath: parent directory traversal (..) not allowed');
    }
    if (part === '.') {
      continue; /* skip current dir references */
    }
  }

  /* Rebuild clean path */
  const clean = parts.filter(p => p !== '.').join('/');
  if (!clean) {
    throw new Error('InvalidPath: empty path after sanitization');
  }

  return clean;
}

function sanitizeVaultId(vaultId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(vaultId)) {
    throw new Error('InvalidVaultId: only alphanumeric, dashes, underscores allowed');
  }
  return vaultId;
}

function isSafeRevisionId(revisionId: string): boolean {
  return /^[a-zA-Z0-9_.-]+$/.test(revisionId);
}

function sanitizeRevisionId(revisionId: string): string {
  const clean = String(revisionId || '').trim();
  if (!clean || !isSafeRevisionId(clean)) {
    throw new Error('InvalidRevisionId: only alphanumeric, dashes, underscores, and dots allowed');
  }
  return clean;
}

function compareLiveHistoryDesc(a: LiveFileHistoryEntry, b: LiveFileHistoryEntry): number {
  const byRecordedAt = b.recordedAt.localeCompare(a.recordedAt);
  if (byRecordedAt !== 0) return byRecordedAt;
  return b.revisionId.localeCompare(a.revisionId);
}

function safeClientHistoryKey(value: string): string {
  const clean = String(value || '').trim().replace(/[^\w:.-]+/g, '_').slice(0, 160);
  return clean || `session_${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeClientHistoryEntry(raw: any): LiveSyncClientHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const clientId = String(raw.clientId || raw.clientKey || '').trim();
  const clientKey = safeClientHistoryKey(String(raw.clientKey || raw.deviceId || clientId || ''));
  const vaultId = String(raw.vaultId || '').trim();
  if (!vaultId || !clientId || !clientKey) return null;
  const connectedAt = normalizeLiveUpdatedAt(raw.connectedAt || raw.firstSeenAt || raw.lastSeenAt);
  const lastSeenAt = normalizeLiveUpdatedAt(raw.lastSeenAt || connectedAt);
  const updatedAt = normalizeLiveUpdatedAt(raw.updatedAt || lastSeenAt);
  const status = raw.webSocketStatus === 'online' ? 'online' : 'offline';
  const safetyLevel = raw.safetyLevel === 'danger' || raw.safetyLevel === 'warning' || raw.safetyLevel === 'ok'
    ? raw.safetyLevel
    : 'warning';
  const versionStatus = ['ok', 'old', 'newer', 'unknown'].includes(String(raw.versionStatus))
    ? raw.versionStatus
    : 'unknown';
  const protocolStatus = ['ok', 'old', 'unknown'].includes(String(raw.protocolStatus))
    ? raw.protocolStatus
    : 'unknown';

  return {
    vaultId,
    clientKey,
    clientId,
    deviceId: optionalShortText(raw.deviceId, 160),
    deviceName: optionalShortText(raw.deviceName, 160),
    platform: optionalShortText(raw.platform, 80),
    appVersion: optionalShortText(raw.appVersion, 40),
    protocolVersion: normalizePositiveInteger(raw.protocolVersion),
    requiredProtocolVersion: normalizePositiveInteger(raw.requiredProtocolVersion) || 1,
    serverVersion: optionalShortText(raw.serverVersion, 40) || SERVER_VERSION,
    firstSeenAt: normalizeLiveUpdatedAt(raw.firstSeenAt || connectedAt),
    connectedAt,
    lastSeenAt,
    lastActivityAt: normalizeLiveUpdatedAt(raw.lastActivityAt || raw.lastAcceptedAt || raw.lastFileChangeAt || lastSeenAt),
    disconnectedAt: raw.disconnectedAt ? normalizeLiveUpdatedAt(raw.disconnectedAt) : undefined,
    lastDisconnectReason: optionalShortText(raw.lastDisconnectReason, 120),
    connectedSeconds: Math.max(0, Math.floor(Number(raw.connectedSeconds) || 0)),
    idleSeconds: Math.max(0, Math.floor(Number(raw.idleSeconds) || 0)),
    receivedCount: Math.max(0, Math.floor(Number(raw.receivedCount) || 0)),
    sentCount: Math.max(0, Math.floor(Number(raw.sentCount) || 0)),
    bytesReceived: Math.max(0, Math.floor(Number(raw.bytesReceived) || 0)),
    webSocketStatus: status,
    safetyLevel,
    versionStatus,
    protocolStatus,
    safetyMessages: Array.isArray(raw.safetyMessages)
      ? raw.safetyMessages.slice(0, 10).map((item: unknown) => String(item || '').slice(0, 240)).filter(Boolean)
      : [],
    lastMessageType: optionalShortText(raw.lastMessageType, 80),
    lastPingAt: raw.lastPingAt ? normalizeLiveUpdatedAt(raw.lastPingAt) : undefined,
    lastFileChangeAt: raw.lastFileChangeAt ? normalizeLiveUpdatedAt(raw.lastFileChangeAt) : undefined,
    lastAcceptedAt: raw.lastAcceptedAt ? normalizeLiveUpdatedAt(raw.lastAcceptedAt) : undefined,
    lastRejectedAt: raw.lastRejectedAt ? normalizeLiveUpdatedAt(raw.lastRejectedAt) : undefined,
    lastRejectedReason: optionalShortText(raw.lastRejectedReason, 120),
    lastRelativePath: optionalShortText(raw.lastRelativePath, 260),
    lastAction: optionalShortText(raw.lastAction, 40),
    updatedAt,
  };
}

function normalizeClientEventEntry(raw: any): LiveSyncClientEventEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const vaultId = String(raw.vaultId || '').trim();
  const clientId = String(raw.clientId || raw.clientKey || '').trim();
  const clientKey = safeClientHistoryKey(String(raw.clientKey || raw.deviceId || clientId || ''));
  if (!vaultId || !clientId || !clientKey) return null;
  const eventType = ['connect', 'disconnect', 'file-accepted', 'file-rejected'].includes(String(raw.eventType))
    ? raw.eventType
    : 'file-accepted';
  const level = ['info', 'warning', 'danger'].includes(String(raw.level))
    ? raw.level
    : (eventType === 'file-rejected' ? 'danger' : 'info');
  const eventId = optionalShortText(raw.eventId, 160)
    || `${normalizeLiveUpdatedAt(raw.createdAt).replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;

  return {
    eventId,
    vaultId,
    clientKey,
    clientId,
    deviceId: optionalShortText(raw.deviceId, 160),
    deviceName: optionalShortText(raw.deviceName, 160),
    platform: optionalShortText(raw.platform, 80),
    appVersion: optionalShortText(raw.appVersion, 40),
    protocolVersion: normalizePositiveInteger(raw.protocolVersion),
    serverVersion: optionalShortText(raw.serverVersion, 40) || SERVER_VERSION,
    eventType,
    level,
    messageType: optionalShortText(raw.messageType, 80),
    relativePath: optionalRelativePath(raw.relativePath),
    action: optionalShortText(raw.action, 40),
    sha256: optionalSha256(raw.sha256),
    reason: optionalShortText(raw.reason, 160),
    currentSha256: optionalSha256(raw.currentSha256),
    currentUpdatedAt: raw.currentUpdatedAt ? normalizeLiveUpdatedAt(raw.currentUpdatedAt) : undefined,
    currentDeleted: typeof raw.currentDeleted === 'boolean' ? raw.currentDeleted : undefined,
    historyRevisionId: optionalShortText(raw.historyRevisionId, 180),
    historyContentAvailable: typeof raw.historyContentAvailable === 'boolean' ? raw.historyContentAvailable : undefined,
    webSocketStatus: raw.webSocketStatus === 'offline' ? 'offline' : raw.webSocketStatus === 'online' ? 'online' : undefined,
    createdAt: normalizeLiveUpdatedAt(raw.createdAt),
  };
}

function pruneClientEventLog(events: LiveSyncClientEventEntry[]): LiveSyncClientEventEntry[] {
  return events
    .map(normalizeClientEventEntry)
    .filter((item): item is LiveSyncClientEventEntry => !!item)
    .sort(compareClientEventsDesc)
    .slice(0, 2000);
}

function compareClientEventsDesc(a: LiveSyncClientEventEntry, b: LiveSyncClientEventEntry): number {
  const byTime = b.createdAt.localeCompare(a.createdAt);
  if (byTime !== 0) return byTime;
  return b.eventId.localeCompare(a.eventId);
}

function pruneClientHistoryIndex(index: Record<string, LiveSyncClientHistoryEntry>): Record<string, LiveSyncClientHistoryEntry> {
  const keep = Object.values(index)
    .map((item) => normalizeClientHistoryEntry(item))
    .filter((item): item is LiveSyncClientHistoryEntry => !!item)
    .sort(compareClientHistoryDesc)
    .slice(0, 200);
  return Object.fromEntries(keep.map((item) => [item.clientKey, item]));
}

function compareClientHistoryDesc(a: LiveSyncClientHistoryEntry, b: LiveSyncClientHistoryEntry): number {
  const aOnline = a.webSocketStatus === 'online' ? 1 : 0;
  const bOnline = b.webSocketStatus === 'online' ? 1 : 0;
  if (aOnline !== bOnline) return bOnline - aOnline;
  const byActivity = (b.lastActivityAt || b.lastSeenAt || '').localeCompare(a.lastActivityAt || a.lastSeenAt || '');
  if (byActivity !== 0) return byActivity;
  return (b.updatedAt || '').localeCompare(a.updatedAt || '');
}

function optionalShortText(value: unknown, maxLength: number): string | undefined {
  const text = String(value || '').trim();
  return text ? text.slice(0, maxLength) : undefined;
}

function optionalRelativePath(value: unknown): string | undefined {
  const text = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  return text ? text.slice(0, 260) : undefined;
}

function optionalSha256(value: unknown): string | undefined {
  const text = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(text) ? text : undefined;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function safeDirectChildPath(parentDir: string, childName: string): string {
  if (!childName || typeof childName !== 'string') {
    throw new Error('InvalidPath: child path is empty or not a string');
  }
  if (childName.includes('\0')) {
    throw new Error('InvalidPath: null byte in child path');
  }
  if (path.isAbsolute(childName) || childName.includes('/') || childName.includes('\\') || childName === '.' || childName === '..') {
    throw new Error('InvalidPath: child path must be a single directory name');
  }

  const resolvedParent = path.resolve(parentDir);
  const resolvedChild = path.resolve(resolvedParent, childName);
  if (resolvedChild === resolvedParent || !resolvedChild.startsWith(resolvedParent + path.sep)) {
    throw new Error('PathEscape: child path escapes parent directory');
  }
  return resolvedChild;
}

function removeDirectoryIfExists(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return false;
  fs.rmSync(dirPath, { recursive: true, force: true });
  return true;
}

/* ── JSON helpers ── */

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function findVaultInIndex(index: Record<string, StoredVault>, vaultId: string): { key: string; vault: StoredVault } | null {
  const clean = String(vaultId || '').trim();
  if (!clean) return null;
  const found = Object.entries(index).find(
    ([key, vault]) => key === clean || vault.vaultId === clean || vault.serverVaultId === clean
  );
  return found ? { key: found[0], vault: found[1] } : null;
}

function copyDirectoryRecursive(sourceDir: string, targetDir: string): void {
  const resolvedSource = path.resolve(sourceDir);
  const resolvedTarget = path.resolve(targetDir);
  if (!fs.existsSync(resolvedSource)) return;
  fs.mkdirSync(resolvedTarget, { recursive: true });

  for (const entry of fs.readdirSync(resolvedSource, { withFileTypes: true })) {
    const sourcePath = path.resolve(path.join(resolvedSource, entry.name));
    const targetPath = path.resolve(path.join(resolvedTarget, entry.name));
    if (!sourcePath.startsWith(resolvedSource + path.sep)) {
      throw new Error('PathEscape: source copy path escapes source directory');
    }
    if (!targetPath.startsWith(resolvedTarget + path.sep)) {
      throw new Error('PathEscape: target copy path escapes target directory');
    }
    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function copyDirectoryContentsNoOverwrite(sourceDir: string, targetDir: string, conflictSuffix: string): number {
  const resolvedSource = path.resolve(sourceDir);
  const resolvedTarget = path.resolve(targetDir);
  if (!fs.existsSync(resolvedSource)) return 0;
  fs.mkdirSync(resolvedTarget, { recursive: true });

  let copied = 0;
  const walk = (dirPath: string): void => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const sourcePath = path.resolve(path.join(dirPath, entry.name));
      if (sourcePath !== resolvedSource && !sourcePath.startsWith(resolvedSource + path.sep)) {
        throw new Error('PathEscape: source history path escapes source directory');
      }
      const rel = path.relative(resolvedSource, sourcePath);
      let targetPath = path.resolve(path.join(resolvedTarget, rel));
      if (targetPath !== resolvedTarget && !targetPath.startsWith(resolvedTarget + path.sep)) {
        throw new Error('PathEscape: target history path escapes target directory');
      }

      if (entry.isDirectory()) {
        fs.mkdirSync(targetPath, { recursive: true });
        walk(sourcePath);
      } else if (entry.isFile()) {
        if (fs.existsSync(targetPath)) {
          const ext = path.extname(targetPath);
          const base = targetPath.slice(0, targetPath.length - ext.length);
          targetPath = `${base}.${safeExportName(conflictSuffix)}${ext || '.json'}`;
        }
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(sourcePath, targetPath);
        copied++;
      }
    }
  };

  walk(resolvedSource);
  return copied;
}

function uniqueBackupId(targetBackupRoot: string, desiredBackupId: string): string {
  const base = safeExportName(desiredBackupId).replace(/-/g, '_') || 'merged_backup';
  let candidate = base;
  let counter = 1;
  while (fs.existsSync(safeDirectChildPath(targetBackupRoot, candidate))) {
    counter++;
    candidate = `${base}_${counter}`;
  }
  return candidate;
}

function rewriteBackupMetaForMerge(targetBackupDir: string, targetServerVaultId: string, targetBackupId: string): void {
  const metaPath = path.join(targetBackupDir, 'backup-meta.json');
  const meta = readJsonSafe<any | null>(metaPath, null);
  if (!meta || typeof meta !== 'object') return;
  meta.vaultId = targetServerVaultId;
  meta.backupId = targetBackupId;
  writeJson(metaPath, meta);
}

function manifestFileEntries(manifest: unknown): Array<{ relativePath: string; deleted?: boolean }> {
  const files = Array.isArray((manifest as any)?.files) ? (manifest as any).files : [];
  return files
    .map((file: any) => ({
      relativePath: String(file?.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, ''),
      deleted: !!file?.deleted,
    }))
    .filter((file: { relativePath: string }) => !!file.relativePath);
}

function safeExportName(value: string): string {
  return String(value || 'vault')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'vault';
}

function sanitizeServerExportFileName(value: string): string {
  const raw = String(value || '').trim();
  const fileName = path.basename(raw);
  if (!fileName || fileName !== raw) {
    throw new Error('InvalidServerExportName: fileName must be a single file name');
  }
  if (!/^ars-note-server-full-export-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json(?:\.gz)?$/.test(fileName)) {
    throw new Error('InvalidServerExportName: unexpected server export file name');
  }
  return fileName;
}

function normalizeServerExportKeepLatest(value?: number): number {
  const raw = typeof value === 'number'
    ? value
    : Number(process.env.ARS_NOTE_SERVER_EXPORT_KEEP_LATEST || DEFAULT_SERVER_EXPORT_KEEP_LATEST);
  if (!Number.isFinite(raw)) return DEFAULT_SERVER_EXPORT_KEEP_LATEST;
  return Math.max(1, Math.min(60, Math.floor(raw)));
}

function normalizeServerExportIndexItem(raw: any): ServerDataExportItem | null {
  if (!raw || typeof raw !== 'object') return null;
  try {
    return {
      exportedAt: normalizeLiveUpdatedAt(raw.exportedAt),
      fileName: sanitizeServerExportFileName(String(raw.fileName || '')),
      size: Math.max(0, Number(raw.size) || 0),
      sha256: String(raw.sha256 || ''),
      sourceVaultCount: Math.max(0, Number(raw.sourceVaultCount) || 0),
      vaultCount: Math.max(0, Number(raw.vaultCount) || 0),
      skippedCount: Math.max(0, Number(raw.skippedCount) || 0),
      skipped: Array.isArray(raw.skipped)
        ? raw.skipped.slice(0, 100).map((item: any) => ({
          vaultId: String(item?.vaultId || ''),
          vaultName: String(item?.vaultName || ''),
          error: String(item?.error || ''),
        }))
        : [],
      reason: raw.reason ? String(raw.reason).slice(0, 80) : undefined,
    };
  } catch {
    return null;
  }
}

function compareServerExportsDesc(a: ServerDataExportItem, b: ServerDataExportItem): number {
  const byDate = b.exportedAt.localeCompare(a.exportedAt);
  if (byDate !== 0) return byDate;
  return b.fileName.localeCompare(a.fileName);
}

function normalizeServerSnapshotFileSource(value: unknown): ServerSnapshotFileSource | undefined {
  const raw = String(value || '').trim();
  if (raw === 'live' || raw === 'live-history' || raw === 'backup') return raw;
  return undefined;
}

function normalizeSnapshotRelativePath(value: unknown): string | null {
  try {
    return sanitizeRelativePath(String(value || '').replace(/\\/g, '/'));
  } catch {
    return null;
  }
}

function normalizeSnapshotTimestamp(value: unknown, fallback = '1970-01-01T00:00:00.000Z'): string {
  const parsed = Date.parse(String(value || ''));
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  const fallbackParsed = Date.parse(fallback);
  if (Number.isFinite(fallbackParsed)) return new Date(fallbackParsed).toISOString();
  return '1970-01-01T00:00:00.000Z';
}

function stripServerSnapshotContent(item: ServerSnapshotFileCandidateWithContent): ServerSnapshotFileCandidate {
  const { contentBase64: _contentBase64, ...candidate } = item;
  return candidate;
}

function compareServerSnapshotCandidatesDesc(a: ServerSnapshotFileCandidate, b: ServerSnapshotFileCandidate): number {
  const aTime = a.recordedAt || a.updatedAt || '';
  const bTime = b.recordedAt || b.updatedAt || '';
  const byTime = bTime.localeCompare(aTime);
  if (byTime !== 0) return byTime;
  const byPath = a.relativePath.localeCompare(b.relativePath);
  if (byPath !== 0) return byPath;
  const bySource = a.source.localeCompare(b.source);
  if (bySource !== 0) return bySource;
  return String(b.revisionId || b.backupId || '').localeCompare(String(a.revisionId || a.backupId || ''));
}

function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, data: unknown): void {
  atomicWriteFile(filePath, Buffer.from(JSON.stringify(data, null, 2), 'utf-8'));
}

function writeJsonWithBackup(filePath: string, data: unknown): void {
  const content = Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
  atomicWriteFile(`${filePath}.bak`, content);
  atomicWriteFile(filePath, content);
}

function readJsonRequired<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

function readJsonWithBackupStrict<T>(filePath: string, fallback: T): T {
  const backupPath = `${filePath}.bak`;
  const candidates = [filePath, backupPath]
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => ({
      filePath: candidate,
      modifiedAt: fs.statSync(candidate).mtimeMs,
    }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);

  if (candidates.length === 0) {
    writeJsonWithBackup(filePath, fallback);
    return fallback;
  }

  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      const parsed = readJsonRequired<T>(candidate.filePath);
      if (candidate.filePath !== filePath) {
        atomicWriteFile(filePath, Buffer.from(JSON.stringify(parsed, null, 2), 'utf-8'));
      }
      return parsed;
    } catch (err: any) {
      errors.push(`${candidate.filePath}: ${err?.message || err}`);
    }
  }

  throw new Error(`StorageIndexCorrupt: ${errors.join(' | ')}`);
}

function atomicWriteFile(filePath: string, content: Buffer): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(tempPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tempPath, filePath);
    syncDirectoryBestEffort(dir);
  } catch (err) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* ignore close cleanup */ }
    }
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* ignore temp cleanup */ }
    throw err;
  }
}

function syncDirectoryBestEffort(dirPath: string): void {
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(dirPath, 'r');
    fs.fsyncSync(descriptor);
  } catch {
    /* Windows and some NAS filesystems do not allow directory fsync. */
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch { /* ignore */ }
    }
  }
}

function removeEmptyDirectory(dirPath: string): void {
  try {
    if (fs.existsSync(dirPath) && fs.readdirSync(dirPath).length === 0) {
      fs.rmdirSync(dirPath);
    }
  } catch {
    /* best effort cleanup */
  }
}
