/* ── Ars-note Sync Server Types (v0.8.0) ── */

export const SERVER_VERSION = '1.5.64';
export const SERVER_APP_NAME = 'Ars-note Sync Server';
export const SERVER_BUILD_ID = 'sync-v4-public-release-20260712-1245';
export const LIVE_SYNC_SAFETY_CAPABILITY_SCHEMA = 11;
export const LIVE_SYNC_TOMBSTONE_RETENTION_DAYS = 30;
export const REQUIRED_LIVE_SYNC_SAFETY_CAPABILITIES = [
  'livePersistence',
  'liveHistory',
  'serverSnapshotProofProtection',
  'rebuildPreWriteSnapshots',
  'serverRestoreMetadataBroadcast',
  'staleWriteProtection',
  'missingBaseProtection',
  'revisionBaseProtection',
  'deletedTombstoneProtection',
  'tombstoneRetention30Days',
  'prunedTombstoneHistoryProtection',
  'deleteStormProtection',
  'destructiveTruncationProtection',
  'vaultIdentityAutoResolve',
  'atomicLivePersistence',
  'crashRecoveryJournal',
  'serializedVaultWrites',
  'startupStorageReadiness',
  'metadataOnlySnapshots',
] as const;

/** Health check response */
export interface HealthResponse {
  ok: boolean;
  app: string;
  version: string;
  buildId: string;
  capabilitySchemaVersion: number;
  requiredLiveSyncSafetyCapabilities: readonly string[];
}

/** Vault registration request */
export interface VaultRegisterRequest {
  vaultId: string;
  vaultName: string;
  clientId?: string;
}

/** Vault registration response */
export interface VaultRegisterResponse {
  ok: boolean;
  vaultId: string;
  serverVaultId: string;
}

/** Backup metadata upload request */
export interface BackupUploadMetadataRequest {
  vaultId: string;
  backupId: string;
  manifest: unknown;
  manifestHash: string;
  fileCount: number;
  totalSize: number;
}

/** Backup metadata upload response */
export interface BackupUploadMetadataResponse {
  ok: boolean;
  backupId: string;
  uploadSessionId: string;
}

/** Single file upload request */
export interface FileUploadRequest {
  vaultId: string;
  backupId: string;
  relativePath: string;
  contentBase64: string;
  sha256: string;
  size: number;
}

/** File upload response */
export interface FileUploadResponse {
  ok: boolean;
  relativePath: string;
  size: number;
  sha256: string;
}

/** Backup list item */
export interface BackupListItem {
  backupId: string;
  uploadedAt: string;
  fileCount: number;
  totalSize: number;
  manifestHash: string;
}

/** Backup list response */
export interface BackupListResponse {
  ok: boolean;
  vaultId: string;
  backups: BackupListItem[];
}

/** Stored vault entry */
export interface StoredVault {
  serverVaultId: string;
  vaultId: string;
  vaultName: string;
  clientId?: string;
  registeredAt: string;
}

/** Stored backup metadata */
export interface StoredBackupMeta {
  backupId: string;
  vaultId: string;
  uploadSessionId: string;
  uploadedAt: string;
  fileCount: number;
  totalSize: number;
  manifestHash: string;
  manifest: unknown;
}
