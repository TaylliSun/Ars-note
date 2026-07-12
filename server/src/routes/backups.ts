/* ── Backup handlers (v0.8.6) ── */

import * as crypto from 'crypto';
import type {
  BackupUploadMetadataRequest,
  BackupUploadMetadataResponse,
  FileUploadRequest,
  FileUploadResponse,
  BackupListResponse,
} from '../types';
import type { ServerDataExportItem, StorageBackend } from '../storage/storageTypes';
import { getCachedVault, createUploadSession, getUploadSession, updateSessionStats } from '../db/memoryDb';
import { cacheVault } from '../db/memoryDb';

async function resolveVault(storage: StorageBackend, vaultId: string, vaultName?: string) {
  const cached = getCachedVault(vaultId);
  if (cached) return cached;

  const stored = await storage.registerVault(vaultId, vaultName || vaultId);
  cacheVault(stored);
  return stored;
}

async function createBackupDeleteSnapshot(
  storage: StorageBackend,
  vaultId: string,
  backupId: string,
): Promise<{ ok: true; preOperationSnapshot: ServerDataExportItem | null } | { ok: false; error: string }> {
  if (typeof storage.createServerDataSnapshot !== 'function') {
    return { ok: true, preOperationSnapshot: null };
  }

  try {
    const preOperationSnapshot = await storage.createServerDataSnapshot({
      reason: `pre-delete-backup:${String(vaultId || '').slice(0, 80)}:${String(backupId || '').slice(0, 80)}`,
    });
    return { ok: true, preOperationSnapshot };
  } catch (err: any) {
    return {
      ok: false,
      error: `Pre-operation server snapshot failed; backup delete was cancelled: ${err?.message || String(err)}`,
    };
  }
}

/* ── Upload metadata ── */

export async function handleUploadMetadata(
  storage: StorageBackend,
  body: BackupUploadMetadataRequest,
): Promise<BackupUploadMetadataResponse | { ok: false; error: string }> {
  const { vaultId, backupId, manifest, manifestHash, fileCount, totalSize } = body || {};

  if (!vaultId || !backupId || !manifestHash) {
    return { ok: false, error: 'Missing required fields: vaultId, backupId, manifestHash' };
  }

  /* Validate backupId format */
  if (!/^[a-zA-Z0-9_-]+$/.test(backupId)) {
    return { ok: false, error: 'Invalid backupId format' };
  }

  /* Look up server vault ID */
  const vault = await resolveVault(storage, vaultId, typeof (manifest as any)?.vaultName === 'string' ? (manifest as any).vaultName : vaultId);

  /* Check for duplicate backup */
  const _metaExists = await storage.backupMetaExists(vault.serverVaultId, backupId);
  if (_metaExists) {
    return { ok: false, error: 'Backup already exists: ' + backupId };
  }

  /* Store metadata */
  const uploadSessionId = createUploadSession(vaultId, backupId, vault.serverVaultId);

  await storage.storeBackupMeta({
    backupId,
    vaultId: vault.serverVaultId,
    uploadSessionId,
    uploadedAt: new Date().toISOString(),
    fileCount: fileCount || 0,
    totalSize: totalSize || 0,
    manifestHash,
    manifest,
  });

  /* Also store manifest.json as a file in the backup directory */
  await storage.storeFile(
    vault.serverVaultId,
    backupId,
    'manifest.json',
    Buffer.from(JSON.stringify(manifest || {}, null, 2), 'utf-8'),
  );

  return {
    ok: true,
    backupId,
    uploadSessionId,
  };
}

/* ── Upload single file ── */

export async function handleUploadFile(
  storage: StorageBackend,
  body: FileUploadRequest,
): Promise<FileUploadResponse | { ok: false; error: string }> {
  const { vaultId, backupId, relativePath, contentBase64, sha256, size } = body || {};

  if (!vaultId || !backupId || !relativePath || !contentBase64 || !sha256) {
    return { ok: false, error: 'Missing required fields: vaultId, backupId, relativePath, contentBase64, sha256' };
  }

  /* Look up server vault ID */
  const vault = await resolveVault(storage, vaultId);

  /* Verify backup exists */
  const _backupExists = await storage.backupMetaExists(vault.serverVaultId, backupId);
  if (!_backupExists) {
    return { ok: false, error: 'Backup metadata not found. Upload metadata first.' };
  }

  /* Decode base64 */
  let content: Buffer;
  try {
    content = Buffer.from(contentBase64, 'base64');
  } catch {
    return { ok: false, error: 'Invalid base64 encoding' };
  }

  /* Verify size */
  if (size !== undefined && content.length !== size) {
    return { ok: false, error: 'Size mismatch: expected ' + size + ', got ' + content.length };
  }

  /* Verify sha256 */
  const computedHash = crypto.createHash('sha256').update(content).digest('hex');
  if (computedHash !== sha256) {
    return { ok: false, error: 'SHA256 mismatch: expected ' + sha256 + ', computed ' + computedHash };
  }

  /* Store file */
  try {
    await storage.storeFile(vault.serverVaultId, backupId, relativePath, content);
  } catch (err: any) {
    return { ok: false, error: err.message || 'Failed to store file' };
  }

  /* Update session stats */
  updateSessionStats(vault.serverVaultId + '_' + backupId, content.length);

  return {
    ok: true,
    relativePath,
    size: content.length,
    sha256: computedHash,
  };
}

/* ── List backups ── */

export async function handleListBackups(
  storage: StorageBackend,
  query: { vaultId: string },
): Promise<BackupListResponse | { ok: false; error: string }> {
  const { vaultId } = query;

  if (!vaultId) {
    return { ok: false, error: 'Missing query param: vaultId' };
  }

  const vault = await resolveVault(storage, vaultId);

  const backups = await storage.listBackups(vault.serverVaultId);

  return {
    ok: true,
    vaultId,
    backups,
  };
}

/* 鈹€鈹€ List backups across all vaults 鈹€鈹€ */

export async function handleDeleteBackup(
  storage: StorageBackend,
  body: { vaultId: string; backupId: string },
): Promise<{ ok: true; vaultId: string; backupId: string; deleted: boolean; deletedAt: string; preOperationSnapshot: ServerDataExportItem | null } | { ok: false; error: string }> {
  const { vaultId, backupId } = body || {};

  if (!vaultId || !backupId) {
    return { ok: false, error: 'Missing required fields: vaultId, backupId' };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(backupId)) {
    return { ok: false, error: 'Invalid backupId format' };
  }

  const vault = await resolveVault(storage, vaultId);
  const snapshot = await createBackupDeleteSnapshot(storage, vault.vaultId, backupId);
  if (!snapshot.ok) return snapshot;

  const deleted = await storage.deleteBackup(vault.serverVaultId, backupId);

  return {
    ok: true,
    vaultId,
    backupId,
    deleted,
    deletedAt: new Date().toISOString(),
    preOperationSnapshot: snapshot.preOperationSnapshot,
  };
}

export async function handleListAllBackups(
  storage: StorageBackend,
): Promise<{ ok: true; backups: Awaited<ReturnType<StorageBackend['listAllBackups']>> } | { ok: false; error: string }> {
  const backups = await storage.listAllBackups();
  return {
    ok: true,
    backups,
  };
}

/* ── Get manifest ── */

export async function handleGetManifest(
  storage: StorageBackend,
  query: { vaultId: string; backupId: string },
): Promise<{ ok: boolean; [key: string]: unknown }> {
  const { vaultId, backupId } = query;

  if (!vaultId || !backupId) {
    return { ok: false, error: 'Missing query params: vaultId, backupId' };
  }

  const vault = await resolveVault(storage, vaultId);

  const meta = await storage.getBackupMeta(vault.serverVaultId, backupId);
  if (!meta) {
    return { ok: false, error: 'Backup not found' };
  }

  return {
    ok: true,
    backupId: meta.backupId,
    manifest: meta.manifest,
    manifestHash: meta.manifestHash,
    fileCount: meta.fileCount,
    totalSize: meta.totalSize,
    uploadedAt: meta.uploadedAt,
  };
}

/* ── Download file ── */

export async function handleDownloadFile(
  storage: StorageBackend,
  query: { vaultId: string; backupId: string; relativePath: string },
): Promise<{ ok: boolean; [key: string]: unknown }> {
  const { vaultId, backupId, relativePath } = query;

  if (!vaultId || !backupId || !relativePath) {
    return { ok: false, error: 'Missing query params: vaultId, backupId, relativePath' };
  }

  const vault = await resolveVault(storage, vaultId);

  let content: Buffer | null;
  try {
    content = await storage.readFile(vault.serverVaultId, backupId, relativePath);
  } catch (err: any) {
    return { ok: false, error: err.message || 'Path validation failed' };
  }

  if (!content) {
    return { ok: false, error: 'File not found' };
  }

  return {
    ok: true,
    relativePath,
    contentBase64: content.toString('base64'),
    size: content.length,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  };
}
