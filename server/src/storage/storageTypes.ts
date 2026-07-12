/* Storage abstraction types. */

import type { StoredVault, StoredBackupMeta, BackupListItem } from '../types';

export interface BackupListItemWithVault extends BackupListItem {
  vaultId: string;
  vaultName: string;
}

export interface LiveFileEntry {
  relativePath: string;
  sha256: string;
  size: number;
  updatedAt: string;
  deleted?: boolean;
  contentBase64?: string;
  serverRevision?: number;
  revisionId?: string;
  updatedByClientId?: string;
  updatedByDeviceId?: string;
  tombstoneExpiresAt?: string;
}

export interface LiveFileSummary {
  fileCount: number;
  deletedCount: number;
  totalSize: number;
  lastUpdatedAt: string | null;
  recentFiles: Array<{
    relativePath: string;
    size: number;
    updatedAt: string;
    deleted?: boolean;
  }>;
}

export interface LiveFileHistoryEntry {
  revisionId: string;
  relativePath: string;
  action: string;
  recordedAt: string;
  updatedAt: string;
  sha256: string;
  size: number;
  deleted?: boolean;
  reason?: string;
  contentBase64?: string;
  serverRevision?: number;
  clientId?: string;
  deviceId?: string;
  tombstoneExpiresAt?: string;
}

export interface LiveSyncClientHistoryEntry {
  vaultId: string;
  clientKey: string;
  clientId: string;
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  appVersion?: string;
  protocolVersion?: number;
  requiredProtocolVersion: number;
  serverVersion: string;
  firstSeenAt: string;
  connectedAt: string;
  lastSeenAt: string;
  lastActivityAt: string;
  disconnectedAt?: string;
  lastDisconnectReason?: string;
  connectedSeconds: number;
  idleSeconds: number;
  receivedCount: number;
  sentCount: number;
  bytesReceived: number;
  webSocketStatus: 'online' | 'offline';
  safetyLevel: 'ok' | 'warning' | 'danger';
  versionStatus: 'ok' | 'old' | 'newer' | 'unknown';
  protocolStatus: 'ok' | 'old' | 'unknown';
  safetyMessages: string[];
  lastMessageType?: string;
  lastPingAt?: string;
  lastFileChangeAt?: string;
  lastAcceptedAt?: string;
  lastRejectedAt?: string;
  lastRejectedReason?: string;
  lastRelativePath?: string;
  lastAction?: string;
  updatedAt: string;
}

export interface LiveSyncClientEventEntry {
  eventId: string;
  vaultId: string;
  clientKey: string;
  clientId: string;
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  appVersion?: string;
  protocolVersion?: number;
  serverVersion: string;
  eventType: 'connect' | 'disconnect' | 'file-accepted' | 'file-rejected';
  level: 'info' | 'warning' | 'danger';
  messageType?: string;
  relativePath?: string;
  action?: string;
  sha256?: string;
  reason?: string;
  currentSha256?: string;
  currentUpdatedAt?: string;
  currentDeleted?: boolean;
  historyRevisionId?: string;
  historyContentAvailable?: boolean;
  webSocketStatus?: 'online' | 'offline';
  createdAt: string;
}

export interface VaultDeleteResult {
  deleted: boolean;
  vaultId: string;
  serverVaultId: string;
  vaultName?: string;
  backupsDeleted: boolean;
  liveDeleted: boolean;
  vaultRecordDeleted: boolean;
}

export interface VaultMergeResult {
  merged: boolean;
  sourceVaultId: string;
  sourceServerVaultId: string;
  targetVaultId: string;
  targetServerVaultId: string;
  backupsCopied: number;
  liveFilesCopied: number;
  liveFilesSkipped: number;
  liveConflictsCopied: number;
  liveHistoryRecordsCopied: number;
  sourceDeleted: boolean;
  conflictPrefix?: string;
  warnings: string[];
}

export interface VaultExportResult {
  vaultId: string;
  serverVaultId: string;
  vaultName: string;
  exportedAt: string;
  fileName: string;
  size: number;
  sha256: string;
  contentBase64: string;
}

export interface ServerDataExportSkippedItem {
  vaultId: string;
  vaultName: string;
  error: string;
}

export interface ServerDataExportItem {
  exportedAt: string;
  fileName: string;
  size: number;
  sha256: string;
  sourceVaultCount: number;
  vaultCount: number;
  skippedCount: number;
  skipped: ServerDataExportSkippedItem[];
  reason?: string;
}

export interface ServerDataExportResult extends ServerDataExportItem {
  contentBase64: string;
}

export type ServerSnapshotFileSource = 'live' | 'live-history' | 'backup';

export interface ServerSnapshotFileCandidate {
  vaultId: string;
  serverVaultId: string;
  vaultName: string;
  relativePath: string;
  source: ServerSnapshotFileSource;
  size: number;
  sha256: string;
  updatedAt: string;
  recordedAt?: string;
  backupId?: string;
  revisionId?: string;
  action?: string;
  deleted?: boolean;
  contentAvailable: boolean;
}

export interface ServerSnapshotFileRestoreResult {
  restoredAt: string;
  file: LiveFileEntry;
  candidate: ServerSnapshotFileCandidate;
}

export interface StorageBackend {
  /** Ensure the data directory structure exists */
  initialize(): Promise<void>;

  /** Register or retrieve a vault */
  registerVault(vaultId: string, vaultName: string, clientId?: string): Promise<StoredVault>;

  /** Check if a vault exists */
  vaultExists(vaultId: string): boolean;

  /** List registered vaults for admin/status views */
  listVaults?(): Promise<StoredVault[]>;

  /** Delete a registered vault plus all persisted server-side data for it */
  deleteVault?(vaultId: string): Promise<VaultDeleteResult>;

  /** Rename a registered vault display name without changing its vaultId */
  renameVault?(vaultId: string, newVaultName: string): Promise<StoredVault | null>;

  /** Merge one registered vault into another while preserving conflicting files */
  mergeVaults?(sourceVaultId: string, targetVaultId: string, options?: { deleteSource?: boolean }): Promise<VaultMergeResult>;

  /** Export one vault's server-side data as a portable JSON backup bundle */
  exportVaultData?(vaultId: string): Promise<VaultExportResult | null>;

  /** Export all server-side vault data as a portable JSON backup bundle */
  exportServerData?(): Promise<ServerDataExportResult>;

  /** Persist one full server export on the server itself for accident recovery */
  createServerDataSnapshot?(options?: { reason?: string; keepLatest?: number }): Promise<ServerDataExportItem>;

  /** List persisted server-side export snapshots, newest first */
  listServerDataSnapshots?(limit?: number): Promise<ServerDataExportItem[]>;

  /** Read one persisted server-side export snapshot for download */
  readServerDataSnapshot?(fileName: string): Promise<ServerDataExportResult | null>;

  /** List file versions contained inside one server-side export snapshot */
  listServerSnapshotFiles?(fileName: string, options?: {
    vaultId?: string;
    relativePath?: string;
    query?: string;
    source?: ServerSnapshotFileSource;
    limit?: number;
  }): Promise<ServerSnapshotFileCandidate[]>;

  /** Restore one content-bearing file version from a server-side export snapshot into live sync */
  restoreServerSnapshotFile?(fileName: string, options: {
    vaultId: string;
    relativePath: string;
    source?: ServerSnapshotFileSource;
    backupId?: string;
    revisionId?: string;
    restoredAt?: string;
  }): Promise<ServerSnapshotFileRestoreResult | null>;

  /** Store backup metadata */
  storeBackupMeta(meta: StoredBackupMeta): Promise<void>;

  /** Check if backup metadata exists */
  backupMetaExists(vaultId: string, backupId: string): Promise<boolean>;

  /** Get backup metadata */
  getBackupMeta(vaultId: string, backupId: string): Promise<StoredBackupMeta | null>;

  /** List all backups for a vault */
  listBackups(vaultId: string): Promise<BackupListItem[]>;

  /** List backups across every registered vault */
  listAllBackups(): Promise<BackupListItemWithVault[]>;

  /** Delete a backup and all stored files for it */
  deleteBackup(vaultId: string, backupId: string): Promise<boolean>;

  /** Store a single file for a backup */
  storeFile(vaultId: string, backupId: string, relativePath: string, content: Buffer): Promise<void>;

  /** Read a single file from a backup */
  readFile(vaultId: string, backupId: string, relativePath: string): Promise<Buffer | null>;

  /** Check if a file exists */
  fileExists(vaultId: string, backupId: string, relativePath: string): Promise<boolean>;

  /** Store the latest live-sync copy of a file */
  storeLiveFile?(vaultId: string, relativePath: string, content: Buffer, sha256: string, updatedAt?: string, metadata?: {
    clientId?: string;
    deviceId?: string;
    reason?: string;
  }): Promise<void>;

  /** Store a live-sync tombstone for a deleted file */
  deleteLiveFile?(vaultId: string, relativePath: string, updatedAt?: string, metadata?: {
    clientId?: string;
    deviceId?: string;
    reason?: string;
  }): Promise<void>;

  /** Return one live-sync file, optionally with content */
  getLiveFile?(vaultId: string, relativePath: string): Promise<LiveFileEntry | null>;

  /** Preserve a rejected live-sync write for audit and recovery */
  recordRejectedLiveFile?(vaultId: string, relativePath: string, action: 'create' | 'update' | 'delete', content: Buffer | null, sha256: string, updatedAt?: string, reason?: string, metadata?: {
    clientId?: string;
    deviceId?: string;
  }): Promise<LiveFileHistoryEntry | null>;

  /** Return server-side live-sync history, newest first. Content can be omitted for listings. */
  listLiveHistory?(vaultId: string, relativePath?: string, limit?: number): Promise<LiveFileHistoryEntry[]>;

  /** Return one server-side live-sync history record with content when available. */
  getLiveHistoryEntry?(vaultId: string, relativePath: string, revisionId: string): Promise<LiveFileHistoryEntry | null>;

  /** Restore one content-bearing live-sync history record as the current live file. */
  restoreLiveHistoryEntry?(vaultId: string, relativePath: string, revisionId: string, restoredAt?: string, metadata?: {
    clientId?: string;
    deviceId?: string;
    reason?: string;
  }): Promise<LiveFileEntry | null>;

  /** Persist the latest known sync status for a client/device, including offline sessions. */
  upsertLiveSyncClientHistory?(vaultId: string, entry: LiveSyncClientHistoryEntry): Promise<void>;

  /** Return recently seen live-sync clients for a vault, including offline devices. */
  listLiveSyncClientHistory?(vaultId: string, limit?: number): Promise<LiveSyncClientHistoryEntry[]>;

  /** Append one live-sync client event for accident audit and sync forensics. */
  appendLiveSyncClientEvent?(vaultId: string, event: LiveSyncClientEventEntry): Promise<void>;

  /** Return recent live-sync client events, newest first. */
  listLiveSyncClientEvents?(vaultId: string, options?: {
    limit?: number;
    clientKey?: string;
    level?: 'info' | 'warning' | 'danger';
    relativePath?: string;
  }): Promise<LiveSyncClientEventEntry[]>;

  /** Return the latest live-sync snapshot for a vault */
  listLiveFiles?(vaultId: string, options?: { includeContent?: boolean }): Promise<LiveFileEntry[]>;

  /** Return a lightweight live-sync summary without file contents */
  getLiveFileSummary?(vaultId: string): Promise<LiveFileSummary>;

  /** Remove persisted live-sync tombstones while leaving active files untouched */
  pruneLiveTombstones?(vaultId: string, options?: { olderThanDays?: number; now?: string; force?: boolean }): Promise<number>;

  /** Remove persisted live-sync files that are intentionally excluded from real-time sync */
  pruneIgnoredLiveFiles?(vaultId: string): Promise<number>;
}
