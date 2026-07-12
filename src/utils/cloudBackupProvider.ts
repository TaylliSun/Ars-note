/* ── Cloud Backup Provider abstraction (v0.5.2) ── */

import type { RemoteBackupItem, CloudUploadSummary, CloudDownloadSummary, CloudProviderId, CloudProviderCapability, CloudProviderInfo, SyncConfig } from '../types';

/**
 * Interface for cloud backup providers.
 * Each provider implements upload, list, and download for remote backups.
 *
 * Currently only LocalMockProvider is implemented.
 * Future providers: SupabaseProvider, S3Provider, CustomProvider.
 */
export interface CloudBackupProvider {
  readonly providerId: CloudProviderId;
  readonly displayName: string;
  uploadBackup(backupPath: string, manifest: { fileCount: number; totalSize: number; vaultName?: string }): Promise<CloudUploadSummary>;
  listRemoteBackups(vaultId: string): Promise<RemoteBackupItem[]>;
  downloadBackup(remoteId: string, targetPath: string): Promise<CloudDownloadSummary>;
}

/* ── Provider Registry (v0.5.2) ── */

const PROVIDER_REGISTRY: CloudProviderInfo[] = [
  {
    id: 'local-mock',
    label: 'Local Mock',
    description: 'Local mock remote for testing cloud backup workflows',
    implemented: true,
    requiresEndpoint: false,
    requiresBucket: false,
    capabilities: ['upload', 'list', 'download', 'verify', 'restore'],
  },
  {
    id: 'supabase',
    label: 'Supabase',
    description: 'Supabase Storage provider (coming soon)',
    implemented: false,
    requiresEndpoint: true,
    requiresBucket: true,
    capabilities: [],
  },
  {
    id: 's3',
    label: 'S3 / MinIO / R2',
    description: 'S3-compatible storage: AWS S3, MinIO, Cloudflare R2',
    implemented: true,
    requiresEndpoint: true,
    requiresBucket: true,
    capabilities: ['upload', 'list', 'download', 'verify', 'restore'],
  },
  {
    id: 'self-hosted',
    label: 'Self-hosted Server',
    description: 'Self-hosted Ars-note Sync Server (prototype)',
    implemented: true,
    requiresEndpoint: true,
    requiresBucket: false,
    capabilities: ['upload', 'list', 'download'],
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Custom HTTP provider (coming soon)',
    implemented: false,
    requiresEndpoint: true,
    requiresBucket: false,
    capabilities: [],
  },
];

/**
 * Get all registered cloud providers.
 */
export function getCloudProviders(): CloudProviderInfo[] {
  return [...PROVIDER_REGISTRY];
}

/**
 * Get info for a specific provider.
 */
export function getProviderInfo(providerId: CloudProviderId | string): CloudProviderInfo | null {
  return PROVIDER_REGISTRY.find(p => p.id === providerId) ?? null;
}

/**
 * Map legacy SyncProvider value to CloudProviderId.
 * 'local' → 'local-mock' (backward compat with old sync.json)
 */
export function mapSyncProviderToCloudId(syncProvider: string): CloudProviderId {
  if (syncProvider === 'local') return 'local-mock';
  if (syncProvider === 'supabase' || syncProvider === 's3' || syncProvider === 'self-hosted' || syncProvider === 'custom') return syncProvider;
  return 'local-mock';
}

/**
 * Validate a sync config against the provider registry.
 */
export function validateProviderConfig(
  providerId: CloudProviderId | string,
  syncConfig: SyncConfig | null,
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const cloudId = mapSyncProviderToCloudId(providerId);
  const info = getProviderInfo(cloudId);

  if (!info) {
    errors.push('Unknown provider: ' + providerId);
    return { valid: false, errors, warnings };
  }

  if (!info.implemented) {
    errors.push('ProviderNotImplemented');
    return { valid: false, errors, warnings };
  }

  if (!syncConfig) {
    errors.push('NoSyncConfig');
    return { valid: false, errors, warnings };
  }

  if (info.requiresEndpoint && !syncConfig.endpoint) {
    warnings.push('EndpointRequired');
  }

  if (info.requiresBucket && !syncConfig.bucket) {
    warnings.push('BucketRequired');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Get provider display name.
 */
export function getProviderDisplayName(providerId: CloudProviderId | string, lang: string = 'en'): string {
  const cloudId = mapSyncProviderToCloudId(providerId);
  const info = getProviderInfo(cloudId);
  if (!info) return providerId;
  return info.label;
}

/**
 * Helper: format a timestamp for remote IDs.
 * Returns YYYYMMDD_HHmmss format.
 */
export function formatTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Helper: build a RemoteBackupItem from raw data.
 */
export function buildRemoteBackupItem(data: {
  remoteId: string;
  backupId: string;
  provider: string;
  vaultName: string;
  uploadedAt: string;
  fileCount: number;
  totalSize: number;
  manifestHash: string;
  remotePath: string;
}): RemoteBackupItem {
  return {
    remoteId: data.remoteId,
    backupId: data.backupId,
    provider: data.provider,
    vaultName: data.vaultName,
    uploadedAt: data.uploadedAt,
    fileCount: data.fileCount,
    totalSize: data.totalSize,
    manifestHash: data.manifestHash,
    remotePath: data.remotePath,
  };
}
