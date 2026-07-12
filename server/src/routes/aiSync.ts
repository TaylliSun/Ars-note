/* ── AI Memory Sync handler (v0.9.5) ── */
/* Lightweight sync for portable .ai-memory state: memory, skills, crons, evolution */

import type { StorageBackend } from '../storage/storageTypes';

const AI_SYNC_BACKUP_ID = '__ai_sync__';
const AI_SYNC_MANIFEST_FILE = '__manifest.json';

/* AI file list to sync (relative paths within .ai-memory/) */
const AI_SYNC_FILES = [
  'MEMORY.md',
  'USER.md',
  'SOUL.md',
  'crons.json',
];

function normalizeAiSyncPath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function isConflictArtifactName(name: string): boolean {
  return /\.conflict-\d+$/.test(name);
}

function shouldSkipAiSyncArtifact(relativePath: string): boolean {
  const normalized = normalizeAiSyncPath(relativePath);
  const name = normalized.split('/').pop() || '';
  return (
    normalized === 'live-session.json' ||
    normalized === 'history' ||
    normalized.startsWith('history/') ||
    isConflictArtifactName(name)
  );
}

function isValidAiSyncPath(relativePath: string): boolean {
  const normalized = normalizeAiSyncPath(relativePath);
  return !!normalized &&
    !normalized.includes('..') &&
    !normalized.startsWith('/') &&
    !normalized.includes('\\') &&
    !shouldSkipAiSyncArtifact(normalized);
}

function sanitizeManifestEntries(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === 'string')
    .map(normalizeAiSyncPath)
    .filter((item) => item !== AI_SYNC_MANIFEST_FILE && isValidAiSyncPath(item))
    .sort();
}

/* ── Push: upload AI memory files to server ── */

export async function handleAISyncPush(
  storage: StorageBackend,
  body: {
    vaultId: string;
    files: Record<string, string>; /* relativePath → base64 content */
  },
): Promise<{ ok: boolean; syncedAt: string; fileCount: number }> {
  const { vaultId, files } = body || {};
  if (!vaultId || typeof vaultId !== 'string') {
    throw new Error('Missing vaultId');
  }
  if (!files || typeof files !== 'object') {
    throw new Error('Missing files');
  }

  /* Auto-register vault if not exists */
  const stored = await storage.registerVault(vaultId, vaultId);
  const serverVaultId = stored.serverVaultId;

  await storage.deleteBackup(serverVaultId, AI_SYNC_BACKUP_ID).catch(() => false);

  let fileCount = 0;
  for (const [relativePath, contentBase64] of Object.entries(files)) {
    const normalizedPath = normalizeAiSyncPath(relativePath);
    if (normalizedPath !== AI_SYNC_MANIFEST_FILE && !isValidAiSyncPath(normalizedPath)) {
      continue;
    }

    let buffer = Buffer.from(contentBase64, 'base64');
    if (normalizedPath === AI_SYNC_MANIFEST_FILE) {
      try {
        buffer = Buffer.from(JSON.stringify(sanitizeManifestEntries(JSON.parse(buffer.toString('utf-8'))), null, 2), 'utf-8');
      } catch {
        buffer = Buffer.from('[]', 'utf-8');
      }
    } else {
      fileCount++;
    }
    await storage.storeFile(serverVaultId, AI_SYNC_BACKUP_ID, normalizedPath, buffer);
  }

  /* Store sync metadata */
  const metaBuffer = Buffer.from(JSON.stringify({
    syncedAt: new Date().toISOString(),
    fileCount,
    vaultId,
  }));
  await storage.storeFile(serverVaultId, AI_SYNC_BACKUP_ID, '__sync-meta.json', metaBuffer);

  return {
    ok: true,
    syncedAt: new Date().toISOString(),
    fileCount,
  };
}

/* ── Pull: download AI memory files from server ── */

export async function handleAISyncPull(
  storage: StorageBackend,
  body: {
    vaultId: string;
    since?: string; /* ISO timestamp — only return files modified after this */
  },
): Promise<{ ok: boolean; files: Record<string, string>; syncedAt: string }> {
  const { vaultId } = body || {};
  if (!vaultId || typeof vaultId !== 'string') {
    throw new Error('Missing vaultId');
  }

  /* Auto-register vault if not exists */
  const stored = await storage.registerVault(vaultId, vaultId);
  const serverVaultId = stored.serverVaultId;

  const files: Record<string, string> = {};

  const rootManifest = await readRootManifest(storage, serverVaultId);
  if (rootManifest) {
    for (const relPath of rootManifest) {
      const buf = await storage.readFile(serverVaultId, AI_SYNC_BACKUP_ID, relPath);
      if (buf) files[relPath] = buf.toString('base64');
    }
    const manifestBuf = await storage.readFile(serverVaultId, AI_SYNC_BACKUP_ID, AI_SYNC_MANIFEST_FILE);
    if (manifestBuf) files[AI_SYNC_MANIFEST_FILE] = manifestBuf.toString('base64');
  } else {
  /* Pull core files */
  for (const relPath of AI_SYNC_FILES) {
    const buf = await storage.readFile(serverVaultId, AI_SYNC_BACKUP_ID, relPath);
    if (buf) {
      files[relPath] = buf.toString('base64');
    }
  }

  /* Pull skills (skills/*.md) */
  await pullDirectory(storage, serverVaultId, 'skills', '.md', files);

  /* Pull evolution records (evolution/*.evo.json) */
  await pullDirectory(storage, serverVaultId, 'evolution', '.evo.json', files);
  }

  /* Get sync metadata */
  let syncedAt = '';
  const metaBuf = await storage.readFile(serverVaultId, AI_SYNC_BACKUP_ID, '__sync-meta.json');
  if (metaBuf) {
    try {
      const meta = JSON.parse(metaBuf.toString('utf-8'));
      syncedAt = meta.syncedAt || '';
    } catch { /* ignore */ }
  }

  return { ok: true, files, syncedAt };
}

/* ── Status: check what AI data exists on server ── */

export async function handleAISyncStatus(
  storage: StorageBackend,
  vaultId: string,
): Promise<{
  ok: boolean;
  hasData: boolean;
  syncedAt: string;
  fileCount: number;
  files: string[];
}> {
  if (!vaultId) {
    throw new Error('Missing vaultId');
  }

  const stored = await storage.registerVault(vaultId, vaultId);
  const serverVaultId = stored.serverVaultId;

  /* Check sync metadata */
  const metaBuf = await storage.readFile(serverVaultId, AI_SYNC_BACKUP_ID, '__sync-meta.json');
  if (!metaBuf) {
    return { ok: true, hasData: false, syncedAt: '', fileCount: 0, files: [] };
  }

  let syncedAt = '';
  let fileCount = 0;
  try {
    const meta = JSON.parse(metaBuf.toString('utf-8'));
    syncedAt = meta.syncedAt || '';
    fileCount = meta.fileCount || 0;
  } catch { /* ignore */ }

  let fileList: string[] = [];
  const rootManifest = await readRootManifest(storage, serverVaultId);
  if (rootManifest) {
    fileList = rootManifest;
  } else {
  /* List available files */
  for (const relPath of AI_SYNC_FILES) {
    const exists = await storage.fileExists(serverVaultId, AI_SYNC_BACKUP_ID, relPath);
    if (exists) fileList.push(relPath);
  }
  /* Skills */
  await listDirectory(storage, serverVaultId, 'skills', '.md', fileList);
  /* Evolutions */
  await listDirectory(storage, serverVaultId, 'evolution', '.evo.json', fileList);
  }

  return {
    ok: true,
    hasData: fileList.length > 0,
    syncedAt,
    fileCount: fileList.length,
    files: fileList,
  };
}

/* ── Helpers ── */

async function readRootManifest(
  storage: StorageBackend,
  serverVaultId: string,
): Promise<string[] | null> {
  const manifestBuf = await storage.readFile(serverVaultId, AI_SYNC_BACKUP_ID, AI_SYNC_MANIFEST_FILE);
  if (!manifestBuf) return null;
  try {
    const manifest = JSON.parse(manifestBuf.toString('utf-8'));
    return sanitizeManifestEntries(manifest);
  } catch {
    return null;
  }
}

async function pullDirectory(
  storage: StorageBackend,
  serverVaultId: string,
  dir: string,
  ext: string,
  files: Record<string, string>,
): Promise<void> {
  /* Try to pull known files by checking numbered indices.
     Since we don't have a directory listing API, we use a manifest approach. */
  const manifestBuf = await storage.readFile(serverVaultId, AI_SYNC_BACKUP_ID, `${dir}/__manifest.json`);
  if (manifestBuf) {
    try {
      const manifest = JSON.parse(manifestBuf.toString('utf-8'));
      if (Array.isArray(manifest)) {
        for (const fileName of manifest) {
          const buf = await storage.readFile(serverVaultId, AI_SYNC_BACKUP_ID, `${dir}/${fileName}`);
          if (buf) {
            files[`${dir}/${fileName}`] = buf.toString('base64');
          }
        }
      }
    } catch { /* ignore */ }
  }
}

async function listDirectory(
  storage: StorageBackend,
  serverVaultId: string,
  dir: string,
  ext: string,
  fileList: string[],
): Promise<void> {
  const manifestBuf = await storage.readFile(serverVaultId, AI_SYNC_BACKUP_ID, `${dir}/__manifest.json`);
  if (manifestBuf) {
    try {
      const manifest = JSON.parse(manifestBuf.toString('utf-8'));
      if (Array.isArray(manifest)) {
        for (const fileName of manifest) {
          fileList.push(`${dir}/${fileName}`);
        }
      }
    } catch { /* ignore */ }
  }
}
