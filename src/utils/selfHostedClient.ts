/* ── Self-hosted Sync Server HTTP client (v0.8.2) ── */

/**
 * Lightweight HTTP client for Ars-note Self-hosted Sync Server.
 * Uses Node.js fetch (available since Node 18+ / Electron 28+).
 * No external dependencies.
 *
 * v0.8.2: All functions accept optional apiKey for Bearer auth.
 *         API key is NEVER logged or included in error messages.
 */

/** Normalize endpoint URL: trim trailing slash */
function normalizeEndpoint(endpoint: string): string {
  let url = endpoint.trim();
  while (url.endsWith('/')) {
    url = url.slice(0, -1);
  }
  return url;
}

/** Validate endpoint: must be http:// or https:// */
function validateEndpoint(endpoint: string): string {
  const url = normalizeEndpoint(endpoint);
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('Endpoint must start with http:// or https://');
  }
  if (url.startsWith('file://')) {
    throw new Error('file:// endpoints are not allowed');
  }
  return url;
}

/** Build headers object, optionally including Bearer auth */
function buildHeaders(apiKey?: string, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (apiKey) {
    headers['Authorization'] = 'Bearer ' + apiKey;
  }
  return headers;
}

/** Generic POST helper */
async function postJson<T>(endpoint: string, path: string, body: unknown, apiKey?: string): Promise<T> {
  const url = validateEndpoint(endpoint) + path;
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(apiKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || `Server error: ${res.status}`);
  }
  return data as T;
}

/** Generic GET helper */
async function getJson<T>(endpoint: string, path: string, apiKey?: string): Promise<T> {
  const url = validateEndpoint(endpoint) + path;
  const headers = buildHeaders(apiKey);
  const res = await fetch(url, {
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || `Server error: ${res.status}`);
  }
  return data as T;
}

/* ── Public API ── */

export interface HealthResponse {
  ok: boolean;
  app: string;
  version: string;
}

export interface RegisterVaultResponse {
  ok: boolean;
  vaultId: string;
  serverVaultId: string;
}

export interface UploadMetadataResponse {
  ok: boolean;
  backupId: string;
  uploadSessionId: string;
}

export interface UploadFileResponse {
  ok: boolean;
  relativePath: string;
  size: number;
  sha256: string;
}

export interface BackupListEntry {
  backupId: string;
  uploadedAt: string;
  fileCount: number;
  totalSize: number;
  manifestHash: string;
}

export interface BackupListResponse {
  ok: boolean;
  vaultId: string;
  backups: BackupListEntry[];
}

export interface ManifestResponse {
  ok: boolean;
  backupId: string;
  manifest: unknown;
  manifestHash: string;
  fileCount: number;
  totalSize: number;
  uploadedAt: string;
}

export interface DownloadFileResponse {
  ok: boolean;
  relativePath: string;
  contentBase64: string;
  size: number;
  sha256: string;
}

/** Health check: GET /health (no auth required) */
export async function checkHealth(endpoint: string): Promise<HealthResponse> {
  const url = validateEndpoint(endpoint) + '/health';
  const res = await fetch(url);
  return (await res.json()) as HealthResponse;
}

/** Register vault: POST /api/vaults/register */
export async function registerVault(
  endpoint: string,
  vaultId: string,
  vaultName: string,
  clientId?: string,
  apiKey?: string,
): Promise<RegisterVaultResponse> {
  return postJson<RegisterVaultResponse>(endpoint, '/api/vaults/register', {
    vaultId,
    vaultName,
    clientId,
  }, apiKey);
}

/** Upload backup metadata: POST /api/backups/upload-metadata */
export async function uploadBackupMetadata(
  endpoint: string,
  payload: {
    vaultId: string;
    backupId: string;
    manifest: unknown;
    manifestHash: string;
    fileCount: number;
    totalSize: number;
  },
  apiKey?: string,
): Promise<UploadMetadataResponse> {
  return postJson<UploadMetadataResponse>(endpoint, '/api/backups/upload-metadata', payload, apiKey);
}

/** Upload single file: POST /api/backups/upload-file */
export async function uploadBackupFile(
  endpoint: string,
  payload: {
    vaultId: string;
    backupId: string;
    relativePath: string;
    contentBase64: string;
    sha256: string;
    size: number;
  },
  apiKey?: string,
): Promise<UploadFileResponse> {
  return postJson<UploadFileResponse>(endpoint, '/api/backups/upload-file', payload, apiKey);
}

/** List backups: GET /api/backups/list?vaultId=xxx */
export async function listBackups(
  endpoint: string,
  vaultId: string,
  apiKey?: string,
): Promise<BackupListResponse> {
  const encoded = encodeURIComponent(vaultId);
  return getJson<BackupListResponse>(endpoint, `/api/backups/list?vaultId=${encoded}`, apiKey);
}

export async function deleteBackup(
  endpoint: string,
  vaultId: string,
  backupId: string,
  apiKey?: string,
): Promise<{ ok: true; vaultId: string; backupId: string; deleted: boolean; deletedAt: string }> {
  return postJson(endpoint, '/api/backups/delete', { vaultId, backupId }, apiKey);
}

/** Get manifest: GET /api/backups/manifest?vaultId=xxx&backupId=xxx */
export async function getManifest(
  endpoint: string,
  vaultId: string,
  backupId: string,
  apiKey?: string,
): Promise<ManifestResponse> {
  const v = encodeURIComponent(vaultId);
  const b = encodeURIComponent(backupId);
  return getJson<ManifestResponse>(endpoint, `/api/backups/manifest?vaultId=${v}&backupId=${b}`, apiKey);
}

/** Download file: GET /api/backups/download-file?vaultId=xxx&backupId=xxx&relativePath=xxx */
export async function downloadFile(
  endpoint: string,
  vaultId: string,
  backupId: string,
  relativePath: string,
  apiKey?: string,
): Promise<DownloadFileResponse> {
  const v = encodeURIComponent(vaultId);
  const b = encodeURIComponent(backupId);
  const r = encodeURIComponent(relativePath);
  return getJson<DownloadFileResponse>(
    endpoint,
    `/api/backups/download-file?vaultId=${v}&backupId=${b}&relativePath=${r}`,
    apiKey,
  );
}
