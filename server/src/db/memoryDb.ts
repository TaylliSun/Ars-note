/* ── In-memory database for vault/backup tracking (v0.8.6) ── */

import * as crypto from 'crypto';
import type { StoredVault, StoredBackupMeta } from '../types';

/**
 * Lightweight in-memory store for tracking vault registrations and upload sessions.
 * Data is ephemeral — vault registrations and backup metadata are persisted to disk
 * via the StorageBackend, but upload sessions are purely in-memory.
 *
 * Future: replace with PostgreSQL for durability.
 */

interface UploadSession {
  sessionId: string;
  vaultId: string;
  backupId: string;
  serverVaultId: string;
  createdAt: string;
  fileCount: number;
  totalSize: number;
}

const vaultCache = new Map<string, StoredVault>();
const sessions = new Map<string, UploadSession>();

export function cacheVault(vault: StoredVault): void {
  vaultCache.set(vault.vaultId, vault);
}

export function getCachedVault(vaultId: string): StoredVault | undefined {
  return vaultCache.get(vaultId);
}

export function createUploadSession(
  vaultId: string,
  backupId: string,
  serverVaultId: string,
): string {
  const sessionId = 'us_' + crypto.randomUUID().replace(/-/g, '').substring(0, 16);
  sessions.set(sessionId, {
    sessionId,
    vaultId,
    backupId,
    serverVaultId,
    createdAt: new Date().toISOString(),
    fileCount: 0,
    totalSize: 0,
  });
  return sessionId;
}

export function getUploadSession(sessionId: string): UploadSession | undefined {
  return sessions.get(sessionId);
}

export function updateSessionStats(sessionId: string, fileSize: number): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.fileCount += 1;
    session.totalSize += fileSize;
  }
}
