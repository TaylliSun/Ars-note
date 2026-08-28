export interface LiveSyncRendererHint {
  serverUrl?: string;
  vaultId?: string;
  vaultPath?: string;
  connectionMode?: 'join' | 'rebuild';
  updatedAt?: string;
}

export interface LiveSyncTarget {
  connected?: boolean;
  serverUrl?: string;
  vaultId?: string;
}

function normalizeVaultPath(value: string): string {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLocaleLowerCase('en-US');
}

function normalizeServerUrl(value: string): string {
  return String(value || '').trim().replace(/\/+$/, '').toLocaleLowerCase('en-US');
}

export function isLiveSyncRendererHintForVault(
  hint: LiveSyncRendererHint | null | undefined,
  vaultPath: string,
  expectedVaultId?: string,
): boolean {
  if (!hint || typeof hint !== 'object') return false;

  const requestedPath = normalizeVaultPath(vaultPath);
  const hintedPath = normalizeVaultPath(hint.vaultPath || '');
  const requestedVaultId = String(expectedVaultId || '').trim();
  const hintedVaultId = String(hint.vaultId || '').trim();

  if (hintedPath) {
    if (!requestedPath || hintedPath !== requestedPath) return false;
    return !requestedVaultId || !hintedVaultId || hintedVaultId === requestedVaultId;
  }

  // Legacy renderer hints had no path. Reuse them only when the exact Vault ID proves ownership.
  return !!requestedVaultId && hintedVaultId === requestedVaultId;
}

export function createLiveSyncRendererHint(
  vaultPath: string,
  config: LiveSyncRendererHint,
): LiveSyncRendererHint {
  return {
    serverUrl: String(config.serverUrl || '').trim(),
    vaultId: String(config.vaultId || '').trim(),
    vaultPath: String(vaultPath || '').trim(),
    connectionMode: config.connectionMode === 'rebuild' ? 'rebuild' : 'join',
    updatedAt: new Date().toISOString(),
  };
}

export function isSameLiveSyncTarget(
  current: LiveSyncTarget | null | undefined,
  requested: LiveSyncTarget | null | undefined,
): boolean {
  if (!current?.connected || !requested) return false;
  const currentVaultId = String(current.vaultId || '').trim();
  const requestedVaultId = String(requested.vaultId || '').trim();
  if (!currentVaultId || !requestedVaultId || currentVaultId !== requestedVaultId) return false;
  return normalizeServerUrl(current.serverUrl || '') === normalizeServerUrl(requested.serverUrl || '');
}
