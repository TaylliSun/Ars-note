/* ── S3 Path Validation & Helpers (v0.5.5) ── */

/**
 * Sanitize a string for use as part of an S3 object key.
 * Removes path traversal, backslashes, and dangerous characters.
 */
export function sanitizeS3KeyPart(value: string): string {
  if (!value) return 'unnamed';
  return value
    .replace(/\\/g, '/')
    .replace(/\.\./g, '')
    .replace(/\/+/g, '/')
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    || 'unnamed';
}

/**
 * Normalize an S3 object key to use forward slashes only.
 * Rejects path traversal and absolute paths.
 */
export function normalizeS3ObjectKey(key: string): string {
  if (!key) return '';
  let normalized = key.replace(/\\/g, '/');
  // Reject path traversal
  if (normalized.includes('..')) {
    normalized = normalized.replace(/\.\./g, '');
  }
  // Remove leading slashes (no absolute paths)
  normalized = normalized.replace(/^\/+/, '');
  // Collapse multiple slashes
  normalized = normalized.replace(/\/+/g, '/');
  return normalized;
}

/**
 * Build the S3 prefix for a backup.
 * Format: vaults/{remoteVaultId}/backups/{backupId}
 */
export function buildS3BackupPrefix(remoteVaultId: string, backupId: string): string {
  const safeVault = sanitizeS3KeyPart(remoteVaultId);
  const safeBackup = sanitizeS3KeyPart(backupId);
  return `vaults/${safeVault}/backups/${safeBackup}`;
}

/**
 * Build the S3 key for remote-index.json.
 * Format: vaults/{remoteVaultId}/remote-index.json
 */
export function buildS3RemoteIndexKey(remoteVaultId: string): string {
  const safeVault = sanitizeS3KeyPart(remoteVaultId);
  return `vaults/${safeVault}/remote-index.json`;
}

/**
 * Format an S3 error into a user-friendly message.
 * Never includes secrets in the output.
 */
export function formatS3Error(error: unknown): string {
  if (!error) return 'Unknown error';

  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  if (lower.includes('accessdenied') || lower.includes('403')) {
    return 'Access Denied';
  }
  if (lower.includes('nosuchbucket') || (lower.includes('404') && lower.includes('bucket'))) {
    return 'Bucket Not Found';
  }
  if (lower.includes('signaturedoesnotmatch') || lower.includes('signature')) {
    return 'Signature Mismatch — check credentials';
  }
  if (lower.includes('invalidaccesskeyid') || lower.includes('invalid access key')) {
    return 'Invalid Access Key';
  }
  if (lower.includes('enotfound') || lower.includes('econnrefused') || lower.includes('network error')) {
    return 'Invalid Endpoint or Network Error';
  }
  if (lower.includes('timeout')) {
    return 'Network Timeout';
  }
  if (lower.includes('nosuchkey') || (lower.includes('404') && lower.includes('key'))) {
    return 'Object Not Found';
  }

  // Strip any accidental credential leakage
  let safe = msg;
  safe = safe.replace(/AKIA[A-Z0-9]{16}/g, '[REDACTED_KEY]');
  safe = safe.replace(/[a-zA-Z0-9+/]{40}/g, (match) => {
    // Heuristic: if it looks like a base64 secret, redact
    if (match.length >= 32 && /^[a-zA-Z0-9+/=]+$/.test(match)) return '[REDACTED]';
    return match;
  });

  return safe.substring(0, 200);
}
