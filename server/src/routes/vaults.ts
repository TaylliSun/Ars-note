/* ── Vault registration handler (v0.8.6) ── */

import * as crypto from 'crypto';
import type { VaultRegisterRequest, VaultRegisterResponse, StoredVault } from '../types';
import type { StorageBackend } from '../storage/storageTypes';
import { cacheVault } from '../db/memoryDb';

export async function handleVaultRegister(
  storage: StorageBackend,
  body: VaultRegisterRequest,
): Promise<VaultRegisterResponse | { ok: false; error: string }> {
  const { vaultId, vaultName, clientId } = body || {};

  if (!vaultId || typeof vaultId !== 'string') {
    return { ok: false, error: 'Missing or invalid vaultId' };
  }
  if (!vaultName || typeof vaultName !== 'string') {
    return { ok: false, error: 'Missing or invalid vaultName' };
  }

  /* Validate vaultId: alphanumeric + dashes + underscores only */
  if (!/^[a-zA-Z0-9_-]+$/.test(vaultId)) {
    return { ok: false, error: 'Invalid vaultId: only alphanumeric, dashes, underscores allowed' };
  }
  if (vaultId.length > 128) {
    return { ok: false, error: 'vaultId too long (max 128 chars)' };
  }

  const stored = await storage.registerVault(vaultId, vaultName, clientId);
  cacheVault(stored);

  return {
    ok: true,
    vaultId: stored.vaultId,
    serverVaultId: stored.serverVaultId,
  };
}
