/* ── Ars-note Sync Server — Entry point (v1.3.1) ── */
/* Uses Node.js built-in http + WebSocket — zero external dependencies */

import * as http from 'http';
import * as crypto from 'crypto';
import { URL } from 'url';
import { LocalStorageBackend } from './storage/localStorage';
import { S3StorageBackend, type S3Config } from './storage/s3Storage';
import type { StorageBackend } from './storage/storageTypes';
import { handleHealth } from './routes/health';
import {
  handleAdminCreateServerSnapshot,
  handleAdminDeleteBackup,
  handleAdminDeleteDuplicateVaults,
  handleAdminDeleteVault,
  handleAdminExportServerData,
  handleAdminExportVaultData,
  handleAdminListServerSnapshots,
  handleAdminListServerSnapshotFiles,
  handleAdminListLiveHistory,
  handleAdminMergeVaults,
  handleAdminReadServerSnapshot,
  handleAdminRenameVault,
  handleAdminRestoreServerSnapshotFile,
  handleAdminVaultIdentity,
  handleAdminListBackupFiles,
  handleAdminOverview,
  handleAdminPruneBackups,
  handleAdminPruneIgnoredLiveFiles,
  handleAdminPruneLiveTombstones,
  handleAdminReadBackupFile,
  handleAdminReadLiveHistoryFile,
  handleAdminReadLiveFile,
  handleAdminRestoreLiveHistory,
  handleTeamMemberWork,
  handleTeamProductionStatus,
  renderAdminPage,
} from './routes/admin';
import { handleVaultRegister } from './routes/vaults';
import {
  handleUploadMetadata,
  handleUploadFile,
  handleListBackups,
  handleListAllBackups,
  handleDeleteBackup,
  handleGetManifest,
  handleDownloadFile,
} from './routes/backups';
import {
  LIVE_SYNC_SAFETY_CAPABILITY_SCHEMA,
  LIVE_SYNC_TOMBSTONE_RETENTION_DAYS,
  REQUIRED_LIVE_SYNC_SAFETY_CAPABILITIES,
  SERVER_APP_NAME,
  SERVER_BUILD_ID,
  SERVER_VERSION,
} from './types';
import { requireApiKey, isDevMode, getServerApiKey } from './auth';
import { handleAISyncPush, handleAISyncPull, handleAISyncStatus } from './routes/aiSync';
import {
  registerClient,
  unregisterClient,
  broadcastToVault,
  handleMessage,
  createWelcomeEvent,
  getLiveSyncPolicy,
  LIVE_SYNC_PROTOCOL_VERSION,
  getTotalConnections,
  getActiveVaultCount,
  getVaultClients,
  summarizeLiveSyncClient,
  persistLiveSyncClientHistory,
  persistLiveSyncClientEvent,
  isLiveSyncablePath,
} from './routes/liveSync';

const PORT = parseInt(process.env.ARSNOTE_PORT || '3141', 10);
const HOST = process.env.ARSNOTE_HOST || '127.0.0.1';
const STORAGE_BACKEND = (process.env.ARS_NOTE_STORAGE_BACKEND || 'local').toLowerCase();
const REQUIRE_API_KEY = parseEnvBoolean(process.env.ARS_NOTE_REQUIRE_API_KEY, false);
const SERVER_STARTED_AT = new Date().toISOString();
const SERVER_EXPORT_AUTO_ENABLED = parseEnvBoolean(process.env.ARS_NOTE_SERVER_EXPORT_AUTO, true);
const SERVER_EXPORT_INTERVAL_MS = Math.max(5 * 60 * 1000, Math.floor(parsePositiveNumber(process.env.ARS_NOTE_SERVER_EXPORT_INTERVAL_HOURS, 24) * 60 * 60 * 1000));
const SERVER_EXPORT_STARTUP_DELAY_MS = Math.max(10_000, Math.floor(parsePositiveNumber(process.env.ARS_NOTE_SERVER_EXPORT_STARTUP_DELAY_MS, 60_000)));
const SERVER_EXPORT_KEEP_LATEST = Math.max(1, Math.min(60, Math.floor(parsePositiveNumber(process.env.ARS_NOTE_SERVER_EXPORT_KEEP_LATEST, 7))));
const MAX_HTTP_BODY_BYTES = Math.max(1024 * 1024, Math.floor(parsePositiveNumber(process.env.ARS_NOTE_MAX_HTTP_BODY_BYTES, 256 * 1024 * 1024)));
const MAX_WEBSOCKET_MESSAGE_BYTES = Math.max(1024 * 1024, Math.floor(parsePositiveNumber(process.env.ARS_NOTE_MAX_WEBSOCKET_MESSAGE_BYTES, 256 * 1024 * 1024)));

/* ── Storage backend factory (v0.8.6) ── */

let storage: StorageBackend;

if (STORAGE_BACKEND === 's3') {
  const s3Config: S3Config = {
    endpoint: process.env.ARS_NOTE_S3_ENDPOINT || '',
    region: process.env.ARS_NOTE_S3_REGION || 'us-east-1',
    bucket: process.env.ARS_NOTE_S3_BUCKET || '',
    accessKeyId: process.env.ARS_NOTE_S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.ARS_NOTE_S3_SECRET_ACCESS_KEY || '',
    forcePathStyle: process.env.ARS_NOTE_S3_FORCE_PATH_STYLE === 'true',
  };

  /* Validate required S3 env vars — list which ones are missing */
  const missing: string[] = [];
  if (!s3Config.endpoint) missing.push('ARS_NOTE_S3_ENDPOINT');
  if (!s3Config.bucket) missing.push('ARS_NOTE_S3_BUCKET');
  if (!s3Config.accessKeyId) missing.push('ARS_NOTE_S3_ACCESS_KEY_ID');
  if (!s3Config.secretAccessKey) missing.push('ARS_NOTE_S3_SECRET_ACCESS_KEY');
  if (missing.length > 0) {
    console.error('ERROR: S3 storage backend enabled but missing required environment variables:');
    for (const v of missing) {
      console.error('  ✗ ' + v);
    }
    console.error('');
    console.error('Set these in your .env file or environment. See .env.example for reference.');
    process.exit(1);
  }

  storage = new S3StorageBackend(s3Config);
  console.log(`Storage backend: S3 (endpoint: ${s3Config.endpoint}, bucket: ${s3Config.bucket}, region: ${s3Config.region}, pathStyle: ${s3Config.forcePathStyle})`);
} else {
  storage = new LocalStorageBackend();
  console.log('Storage backend: Local filesystem (server-data/)');
}

function parseEnvBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildServerCapabilities(storageBackend: StorageBackend): Record<string, boolean> {
  const localAtomicStorage = storageBackend instanceof LocalStorageBackend;
  return {
    livePersistence: typeof storageBackend.getLiveFileSummary === 'function',
    liveHistory: !!storageBackend.listLiveHistory && !!storageBackend.getLiveHistoryEntry && !!storageBackend.restoreLiveHistoryEntry,
    liveSyncClientHistory: typeof storageBackend.listLiveSyncClientHistory === 'function',
    liveSyncClientEvents: typeof storageBackend.listLiveSyncClientEvents === 'function',
    preOperationServerSnapshots: typeof storageBackend.createServerDataSnapshot === 'function',
    serverDataSnapshots: !!storageBackend.createServerDataSnapshot && !!storageBackend.listServerDataSnapshots && !!storageBackend.readServerDataSnapshot,
    serverSnapshotFileRestore: !!storageBackend.listServerSnapshotFiles && !!storageBackend.restoreServerSnapshotFile,
    serverSnapshotProofProtection: true,
    rebuildPreWriteSnapshots: typeof storageBackend.createServerDataSnapshot === 'function',
    serverRestoreMetadataBroadcast: true,
    staleWriteProtection: true,
    missingBaseProtection: true,
    revisionBaseProtection: true,
    deletedTombstoneProtection: true,
    tombstoneRetention30Days: LIVE_SYNC_TOMBSTONE_RETENTION_DAYS >= 30,
    prunedTombstoneHistoryProtection: typeof storageBackend.listLiveHistory === 'function',
    deleteStormProtection: true,
    destructiveTruncationProtection: true,
    vaultIdentityAutoResolve: typeof storageBackend.listVaults === 'function',
    simpleSyncExperience: true,
    aiMemorySync: true,
    teamProductionStatus: true,
    atomicLivePersistence: localAtomicStorage,
    crashRecoveryJournal: localAtomicStorage,
    serializedVaultWrites: true,
    startupStorageReadiness: true,
    payloadLimits: true,
    metadataOnlySnapshots: localAtomicStorage,
  };
}

function buildSafetyProfile(capabilities: Record<string, boolean>) {
  const missingRequired = REQUIRED_LIVE_SYNC_SAFETY_CAPABILITIES.filter((key) => capabilities[key] !== true);
  return {
    name: 'ars-note-safe-live-sync',
    schemaVersion: LIVE_SYNC_SAFETY_CAPABILITY_SCHEMA,
    buildId: SERVER_BUILD_ID,
    tombstoneRetentionDays: LIVE_SYNC_TOMBSTONE_RETENTION_DAYS,
    requiredProtocolVersion: LIVE_SYNC_PROTOCOL_VERSION,
    requiredCapabilities: REQUIRED_LIVE_SYNC_SAFETY_CAPABILITIES,
    missingRequiredCapabilities: missingRequired,
    readyForLiveSync: missingRequired.length === 0,
    features: Object.keys(capabilities).filter((key) => capabilities[key]),
  };
}

function buildLiveSyncExperience(input: {
  vaultId: string;
  safetyProfile: ReturnType<typeof buildSafetyProfile>;
  clientSummaries: any[];
  liveSummary: any;
}): {
  status: 'ready' | 'needs_attention' | 'needs_action' | 'protected_paused' | 'offline';
  label: string;
  title: string;
  detail: string;
  action: 'connect' | 'update_server' | 'check_devices' | 'run_self_test' | 'open_recovery' | 'none';
  facts: string[];
  blockers: string[];
  warnings: string[];
} {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const clientSummaries = Array.isArray(input.clientSummaries) ? input.clientSummaries : [];
  const onlineCount = clientSummaries.length;
  const dangerClients = clientSummaries.filter((client) => client?.safetyLevel === 'danger');
  const warningClients = clientSummaries.filter((client) => client?.safetyLevel === 'warning');
  const liveSummary = input.liveSummary || {};
  const realtimeFiles = Number(liveSummary.realTimeFiles ?? liveSummary.fileCount ?? 0);
  const deletedFiles = Number(liveSummary.deletedFiles ?? liveSummary.deletedCount ?? 0);
  const facts = [
    input.vaultId ? `Vault ${input.vaultId}` : '',
    `${onlineCount} online client${onlineCount === 1 ? '' : 's'}`,
    Number.isFinite(realtimeFiles) && realtimeFiles > 0 ? `${realtimeFiles} live file${realtimeFiles === 1 ? '' : 's'}` : '',
    Number.isFinite(deletedFiles) && deletedFiles > 0 ? `${deletedFiles} tombstone${deletedFiles === 1 ? '' : 's'}` : '',
  ].filter(Boolean);

  if (!input.vaultId) {
    return {
      status: 'offline',
      label: '未连接',
      title: '先填写服务器地址并加入 Vault',
      detail: '服务器已在线，但这次状态检查没有带 Vault ID。普通成员只需要输入服务器地址和密钥，然后加入现有 Vault。',
      action: 'connect',
      facts,
      blockers,
      warnings,
    };
  }

  const missingRequired = Array.isArray(input.safetyProfile?.missingRequiredCapabilities)
    ? input.safetyProfile.missingRequiredCapabilities
    : [];
  if (missingRequired.length > 0 || input.safetyProfile?.readyForLiveSync === false) {
    blockers.push(`Missing server safety capabilities: ${missingRequired.join(', ') || 'unknown'}.`);
    return {
      status: 'needs_action',
      label: '需要更新服务器',
      title: 'NAS 服务器不是完整安全同步版本',
      detail: '先覆盖上传最新 server 文件夹并重启 Docker。客户端会暂停高风险写入，避免旧电脑覆盖服务器。',
      action: 'update_server',
      facts,
      blockers,
      warnings,
    };
  }

  if (onlineCount <= 0) {
    warnings.push('No WebSocket client is currently online for this Vault.');
    return {
      status: 'offline',
      label: '等待客户端',
      title: '服务器正常，等待电脑连接',
      detail: '服务器具备安全同步能力，但还没有看到当前 Vault 的在线客户端。连接 Ars-note 后再运行同步自检。',
      action: 'connect',
      facts,
      blockers,
      warnings,
    };
  }

  if (dangerClients.length > 0) {
    blockers.push(...dangerClients.flatMap((client) => Array.isArray(client.safetyMessages) ? client.safetyMessages : []).slice(0, 6));
    return {
      status: 'needs_action',
      label: '需要处理',
      title: '有旧客户端或被拒绝写入需要处理',
      detail: '至少一台设备存在旧版本、旧协议或最近被服务器拒绝的写入。先更新客户端并打开同步恢复中心。',
      action: 'open_recovery',
      facts,
      blockers,
      warnings,
    };
  }

  if (warningClients.length > 0) {
    warnings.push(...warningClients.flatMap((client) => Array.isArray(client.safetyMessages) ? client.safetyMessages : []).slice(0, 6));
    return {
      status: 'needs_attention',
      label: '需要注意',
      title: '同步可用，但有设备状态需要观察',
      detail: '服务器安全能力完整，实时同步可用；建议运行同步自检确认第二客户端广播接收正常。',
      action: 'run_self_test',
      facts,
      blockers,
      warnings,
    };
  }

  if (onlineCount < 2) {
    warnings.push('Only one client is online. Two-computer real-time verification is not complete.');
    return {
      status: 'needs_attention',
      label: '单设备在线',
      title: '当前设备可安全同步，另一台电脑尚未在线',
      detail: '这不会阻止写入，但还不能证明两台电脑之间的实时同步体验。让另一台电脑连接同一个 Vault ID 后运行同步自检。',
      action: 'run_self_test',
      facts,
      blockers,
      warnings,
    };
  }

  return {
    status: 'ready',
    label: '正常',
    title: '实时同步已按服务器权威时间线运行',
    detail: '服务器安全能力完整，在线客户端状态正常；旧基线、危险删除和冲突会进入保护/恢复流程。',
    action: 'none',
    facts,
    blockers,
    warnings,
  };
}

async function createServerExportIfDue(reason: string): Promise<void> {
  if (!SERVER_EXPORT_AUTO_ENABLED || typeof storage.createServerDataSnapshot !== 'function') return;

  try {
    const latest = typeof storage.listServerDataSnapshots === 'function'
      ? await storage.listServerDataSnapshots(1)
      : [];
    const lastAt = Date.parse(latest[0]?.exportedAt || '');
    if (Number.isFinite(lastAt) && Date.now() - lastAt < SERVER_EXPORT_INTERVAL_MS) {
      console.log(`Server data snapshot skipped (${reason}); latest snapshot is still within interval.`);
      return;
    }

    const result = await storage.createServerDataSnapshot({
      reason,
      keepLatest: SERVER_EXPORT_KEEP_LATEST,
    });
    console.log(`Server data snapshot created: ${result.fileName} (${result.size} bytes, ${result.vaultCount}/${result.sourceVaultCount} vaults)`);
  } catch (err: any) {
    console.error('Server data snapshot failed:', err?.message || err);
  }
}

function startServerExportScheduler(activeStorage: StorageBackend): void {
  if (!SERVER_EXPORT_AUTO_ENABLED) {
    console.log('Server data snapshots: disabled by ARS_NOTE_SERVER_EXPORT_AUTO=false');
    return;
  }
  if (typeof activeStorage.createServerDataSnapshot !== 'function') {
    console.log('Server data snapshots: storage backend does not support local snapshots');
    return;
  }

  console.log(`Server data snapshots: enabled every ${Math.round(SERVER_EXPORT_INTERVAL_MS / 3600000)}h, keep latest ${SERVER_EXPORT_KEEP_LATEST}`);
  setTimeout(() => {
    createServerExportIfDue('auto-startup').catch((err: any) => console.error('Server snapshot startup check failed:', err?.message || err));
  }, SERVER_EXPORT_STARTUP_DELAY_MS);
  setInterval(() => {
    createServerExportIfDue('auto-interval').catch((err: any) => console.error('Server snapshot interval check failed:', err?.message || err));
  }, SERVER_EXPORT_INTERVAL_MS);
}

class RequestBodyTooLargeError extends Error {
  readonly statusCode = 413;

  constructor(limit: number) {
    super(`Request body exceeds the ${limit} byte limit`);
    this.name = 'RequestBodyTooLargeError';
  }
}

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_HTTP_BODY_BYTES) {
      reject(new RequestBodyTooLargeError(MAX_HTTP_BODY_BYTES));
      return;
    }
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let rejected = false;
    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_HTTP_BODY_BYTES) {
        rejected = true;
        req.pause();
        reject(new RequestBodyTooLargeError(MAX_HTTP_BODY_BYTES));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function html(res: http.ServerResponse, body: string, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function broadcastServerRestoredLiveFile(vaultId: string, file: any): void {
  if (!file?.contentBase64) return;
  broadcastToVault(vaultId, 'server-admin', {
    type: 'file-change',
    protocolVersion: LIVE_SYNC_PROTOCOL_VERSION,
    vaultId,
    clientId: 'server-admin',
    relativePath: file.relativePath,
    action: 'update',
    contentBase64: file.contentBase64,
    sha256: file.sha256,
    size: file.size,
    updatedAt: file.updatedAt,
    timestamp: new Date().toISOString(),
    serverRevision: file.serverRevision,
    revisionId: file.revisionId,
    updatedByClientId: file.updatedByClientId,
    updatedByDeviceId: file.updatedByDeviceId,
    tombstoneExpiresAt: file.tombstoneExpiresAt,
  });
}

const KNOWN_ROUTE_PATHS = [
  '/api/admin/live/prune-tombstones',
  '/api/admin/backups/upload-metadata',
  '/api/admin/backups/download-file',
  '/api/admin/backups/delete',
  '/api/admin/vaults/delete-duplicates',
  '/api/admin/server/snapshots/create',
  '/api/admin/server/snapshots/restore',
  '/api/admin/server/snapshots/files',
  '/api/admin/server/snapshots/file',
  '/api/admin/server/snapshots',
  '/api/admin/server/export',
  '/api/admin/vaults/export',
  '/api/admin/vaults/merge',
  '/api/admin/vaults/rename',
  '/api/admin/vaults/delete',
  '/api/admin/vaults/identity',
  '/api/admin/backups/prune',
  '/api/admin/backups/files',
  '/api/admin/backups/file',
  '/api/admin/live/prune-ignored',
  '/api/admin/live/history/restore',
  '/api/admin/live/history/file',
  '/api/admin/live/history',
  '/api/admin/live/file',
  '/api/admin/overview',
  '/api/team/member-work',
  '/api/team/production-status',
  '/api/backups/upload-metadata',
  '/api/backups/download-file',
  '/api/backups/upload-file',
  '/api/backups/list-all',
  '/api/backups/delete',
  '/api/backups/manifest',
  '/api/backups/list',
  '/api/live-sync/status',
  '/api/live-sync/file',
  '/api/live-sync/files',
  '/api/vaults/register',
  '/api/ai/sync-status',
  '/api/ai/sync-push',
  '/api/ai/sync-pull',
  '/api/version',
  '/ws/live-sync',
  '/health',
  '/admin',
] as const;

function normalizeKnownRoutePath(pathname: string): string {
  if (pathname === '/') return pathname;
  const exact = KNOWN_ROUTE_PATHS.find((route) => pathname === route);
  if (exact) return exact;
  return KNOWN_ROUTE_PATHS.find((route) => pathname.endsWith(route)) || pathname;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = url.pathname;
    const routePath = normalizeKnownRoutePath(pathname);
    const method = (req.method || 'GET').toUpperCase();

    /* CORS headers for local dev */
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-ars-note-api-key');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    /* ── Route matching ── */

    if (routePath === '/health' && method === 'GET') {
      return json(res, handleHealth());
    }

    /* ── Public version endpoint (no auth required) ── */
    if (routePath === '/api/version' && method === 'GET') {
      const capabilities = buildServerCapabilities(storage);
      return json(res, {
        ok: true,
        app: SERVER_APP_NAME,
        version: SERVER_VERSION,
        buildId: SERVER_BUILD_ID,
        liveSyncPolicy: getLiveSyncPolicy(),
        tombstoneRetentionDays: LIVE_SYNC_TOMBSTONE_RETENTION_DAYS,
        capabilities,
        safetyProfile: buildSafetyProfile(capabilities),
        serverTime: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
      });
    }

    if ((routePath === '/' || routePath === '/admin') && method === 'GET') {
      return html(res, renderAdminPage());
    }

    /* ── API Key Auth Gate (v0.8.2) ── */
    if (routePath.startsWith('/api/')) {
      const authResult = requireApiKey(req);
      if (!authResult.ok) {
        return json(res, { ok: false, error: authResult.error }, authResult.statusCode || 401);
      }
    }

    if (routePath === '/api/admin/overview' && method === 'GET') {
      return json(res, await handleAdminOverview(storage, {
        storageBackend: STORAGE_BACKEND,
        host: HOST,
        port: PORT,
        startedAt: SERVER_STARTED_AT,
        apiKeyConfigured: !!getServerApiKey(),
        devMode: isDevMode(),
      }));
    }

    if (routePath === '/api/admin/server/export' && method === 'GET') {
      return json(res, await handleAdminExportServerData(storage));
    }

    if (routePath === '/api/admin/server/snapshots/create' && method === 'POST') {
      const body = JSON.parse(await parseBody(req));
      return json(res, await handleAdminCreateServerSnapshot(storage, body));
    }

    if (routePath === '/api/admin/server/snapshots' && method === 'GET') {
      return json(res, await handleAdminListServerSnapshots(storage, {
        limit: url.searchParams.get('limit') || '',
      }));
    }

    if (routePath === '/api/admin/server/snapshots/file' && method === 'GET') {
      return json(res, await handleAdminReadServerSnapshot(storage, {
        fileName: url.searchParams.get('fileName') || '',
      }));
    }

    if (routePath === '/api/admin/server/snapshots/files' && method === 'GET') {
      return json(res, await handleAdminListServerSnapshotFiles(storage, {
        fileName: url.searchParams.get('fileName') || '',
        vaultId: url.searchParams.get('vaultId') || '',
        relativePath: url.searchParams.get('relativePath') || '',
        q: url.searchParams.get('q') || '',
        source: url.searchParams.get('source') || '',
        limit: url.searchParams.get('limit') || '',
      }));
    }

    if (routePath === '/api/admin/server/snapshots/restore' && method === 'POST') {
      const body = JSON.parse(await parseBody(req));
      const result = await handleAdminRestoreServerSnapshotFile(storage, body);
      if (result.ok) broadcastServerRestoredLiveFile(result.vaultId, result.file);
      return json(res, result);
    }

    if (routePath === '/api/admin/backups/delete' && method === 'POST') {
      const body = JSON.parse(await parseBody(req));
      return json(res, await handleAdminDeleteBackup(storage, body));
    }

    if (routePath === '/api/admin/vaults/delete' && method === 'POST') {
      const body = JSON.parse(await parseBody(req));
      return json(res, await handleAdminDeleteVault(storage, body));
    }

    if (routePath === '/api/admin/vaults/rename' && method === 'POST') {
      const body = JSON.parse(await parseBody(req));
      return json(res, await handleAdminRenameVault(storage, body));
    }

    if (routePath === '/api/admin/vaults/merge' && method === 'POST') {
      const body = JSON.parse(await parseBody(req));
      return json(res, await handleAdminMergeVaults(storage, body));
    }

    if (routePath === '/api/admin/vaults/export' && method === 'GET') {
      return json(res, await handleAdminExportVaultData(storage, {
        vaultId: url.searchParams.get('vaultId') || '',
      }));
    }

    if (routePath === '/api/admin/vaults/delete-duplicates' && method === 'POST') {
      const body = JSON.parse(await parseBody(req));
      return json(res, await handleAdminDeleteDuplicateVaults(storage, body));
    }

    if (routePath === '/api/admin/vaults/identity' && method === 'GET') {
      return json(res, await handleAdminVaultIdentity(storage, {
        vaultId: url.searchParams.get('vaultId') || '',
        vaultName: url.searchParams.get('vaultName') || '',
      }));
    }

    if (routePath === '/api/admin/backups/prune' && method === 'POST') {
      const body = JSON.parse(await parseBody(req));
      return json(res, await handleAdminPruneBackups(storage, body));
    }

    if (routePath === '/api/admin/backups/files' && method === 'GET') {
      return json(res, await handleAdminListBackupFiles(storage, {
        vaultId: url.searchParams.get('vaultId') || '',
        backupId: url.searchParams.get('backupId') || '',
      }));
    }

    if (routePath === '/api/admin/backups/file' && method === 'GET') {
      return json(res, await handleAdminReadBackupFile(storage, {
        vaultId: url.searchParams.get('vaultId') || '',
        backupId: url.searchParams.get('backupId') || '',
        relativePath: url.searchParams.get('relativePath') || '',
      }));
    }

    if (routePath === '/api/admin/live/prune-tombstones' && method === 'POST') {
      const body = JSON.parse(await parseBody(req));
      return json(res, await handleAdminPruneLiveTombstones(storage, body));
    }

    if (routePath === '/api/admin/live/prune-ignored' && method === 'POST') {
      const body = JSON.parse(await parseBody(req));
      return json(res, await handleAdminPruneIgnoredLiveFiles(storage, body));
    }

    if (routePath === '/api/admin/live/file' && method === 'GET') {
      return json(res, await handleAdminReadLiveFile(storage, {
        vaultId: url.searchParams.get('vaultId') || '',
        relativePath: url.searchParams.get('relativePath') || '',
      }));
    }

    if (routePath === '/api/admin/live/history' && method === 'GET') {
      return json(res, await handleAdminListLiveHistory(storage, {
        vaultId: url.searchParams.get('vaultId') || '',
        relativePath: url.searchParams.get('relativePath') || '',
        limit: url.searchParams.get('limit') || '',
      }));
    }

    if (routePath === '/api/admin/live/history/file' && method === 'GET') {
      return json(res, await handleAdminReadLiveHistoryFile(storage, {
        vaultId: url.searchParams.get('vaultId') || '',
        relativePath: url.searchParams.get('relativePath') || '',
        revisionId: url.searchParams.get('revisionId') || '',
      }));
    }

    if (routePath === '/api/admin/live/history/restore' && method === 'POST') {
      const body = JSON.parse(await parseBody(req));
      const result = await handleAdminRestoreLiveHistory(storage, body);
      if (result.ok) broadcastServerRestoredLiveFile(result.vaultId, result.file);
      return json(res, result);
    }

    if (routePath === '/api/team/production-status' && method === 'GET') {
      return json(res, await handleTeamProductionStatus(storage, {
        vaultId: url.searchParams.get('vaultId') || '',
        limit: url.searchParams.get('limit') || '',
      }));
    }

    if (routePath === '/api/team/member-work' && method === 'GET') {
      return json(res, await handleTeamMemberWork(storage, {
        vaultId: url.searchParams.get('vaultId') || '',
        member: url.searchParams.get('member') || '',
        limit: url.searchParams.get('limit') || '',
      }));
    }

    if (routePath === '/api/vaults/register' && method === 'POST') {
      const body = JSON.parse(await parseBody(req));
      return json(res, await handleVaultRegister(storage, body));
    }

    if (routePath === '/api/backups/upload-metadata' && method === 'POST') {
      const body = JSON.parse(await parseBody(req));
      return json(res, await handleUploadMetadata(storage, body));
    }

    if (routePath === '/api/backups/upload-file' && method === 'POST') {
      const body = JSON.parse(await parseBody(req));
      return json(res, await handleUploadFile(storage, body));
    }

    if (routePath === '/api/backups/list' && method === 'GET') {
      const vaultId = url.searchParams.get('vaultId') || '';
      return json(res, await handleListBackups(storage, { vaultId }));
    }

    if (routePath === '/api/backups/list-all' && method === 'GET') {
      return json(res, await handleListAllBackups(storage));
    }

    if (routePath === '/api/backups/delete' && method === 'POST') {
      const body = JSON.parse(await parseBody(req));
      return json(res, await handleDeleteBackup(storage, body));
    }

    if (routePath === '/api/backups/manifest' && method === 'GET') {
      const vaultId = url.searchParams.get('vaultId') || '';
      const backupId = url.searchParams.get('backupId') || '';
      return json(res, await handleGetManifest(storage, { vaultId, backupId }));
    }

    if (routePath === '/api/backups/download-file' && method === 'GET') {
      const vaultId = url.searchParams.get('vaultId') || '';
      const backupId = url.searchParams.get('backupId') || '';
      const relativePath = url.searchParams.get('relativePath') || '';
      return json(res, await handleDownloadFile(storage, { vaultId, backupId, relativePath }));
    }

    /* ── AI Memory Sync (v0.9.5) ── */
    if (routePath === '/api/ai/sync-push' && method === 'POST') {
      const body = JSON.parse(await parseBody(req));
      return json(res, await handleAISyncPush(storage, body));
    }

    if (routePath === '/api/ai/sync-pull' && method === 'POST') {
      const body = JSON.parse(await parseBody(req));
      return json(res, await handleAISyncPull(storage, body));
    }

    if (routePath === '/api/ai/sync-status' && method === 'GET') {
      const vaultId = url.searchParams.get('vaultId') || '';
      return json(res, await handleAISyncStatus(storage, vaultId));
    }

    /* ── Live Sync Status API ── */
    if (routePath === '/api/live-sync/status' && method === 'GET') {
      const vaultId = url.searchParams.get('vaultId') || '';
      const includeSummary = url.searchParams.get('summary') !== '0';
      const vaultClients = vaultId ? getVaultClients(vaultId) : [];
      const requestHost = String(req.headers['x-forwarded-host'] || req.headers.host || `${HOST}:${PORT}`).split(',')[0].trim();
      const requestProto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim().toLowerCase();
      const wsProtocol = requestProto === 'https' ? 'wss' : 'ws';
      const webSocketPath = '/ws/live-sync';
      const webSocketUrl = requestHost
        ? `${wsProtocol}://${requestHost}${webSocketPath}?vaultId=${encodeURIComponent(vaultId || '<vaultId>')}`
        : `${wsProtocol}://${HOST}:${PORT}${webSocketPath}?vaultId=${encodeURIComponent(vaultId || '<vaultId>')}`;
      const liveSummary = includeSummary && vaultId && typeof storage.getLiveFileSummary === 'function'
        ? await storage.getLiveFileSummary(vaultId).catch(() => null)
        : null;
      const clientHistory = vaultId && typeof storage.listLiveSyncClientHistory === 'function'
        ? await storage.listLiveSyncClientHistory(vaultId, 50).catch(() => [])
        : [];
      const clientEvents = vaultId && typeof storage.listLiveSyncClientEvents === 'function'
        ? await storage.listLiveSyncClientEvents(vaultId, { limit: 80 }).catch(() => [])
        : [];
      const capabilities = buildServerCapabilities(storage);
      const safetyProfile = buildSafetyProfile(capabilities);
      const clientSummaries = vaultClients.map((client: any) => ({
        ...summarizeLiveSyncClient(client),
      }));
      const experience = buildLiveSyncExperience({
        vaultId,
        safetyProfile,
        clientSummaries,
        liveSummary,
      });
      return json(res, {
        ok: true,
        app: SERVER_APP_NAME,
        serverVersion: SERVER_VERSION,
        buildId: SERVER_BUILD_ID,
        active: true,
        storageBackend: STORAGE_BACKEND,
        host: HOST,
        port: PORT,
        startedAt: SERVER_STARTED_AT,
        serverTime: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        apiKeyConfigured: !!getServerApiKey(),
        devMode: isDevMode(),
        liveSyncPolicy: getLiveSyncPolicy(),
        capabilities,
        safetyProfile,
        experience,
        totalConnections: getTotalConnections(),
        activeVaults: getActiveVaultCount(),
        liveSummary,
        vaultClients: vaultId ? vaultClients.length : undefined,
        webSocket: {
          path: webSocketPath,
          url: webSocketUrl,
          expectedVaultId: vaultId || '',
          onlineClientsForVault: vaultId ? vaultClients.length : undefined,
        },
        diagnostics: {
          httpReachable: true,
          requestHost,
          requestProto,
          forwardedHost: req.headers['x-forwarded-host'] || '',
          forwardedProto: req.headers['x-forwarded-proto'] || '',
          proxyHints: [
            `WebSocket endpoint must upgrade ${webSocketPath}.`,
            'Client server URL should be only scheme + host + port, for example http://NAS_IP:8787. Do not append /admin.',
            'If HTTP works but WebSocket does not connect, check reverse proxy, tunnel, firewall, and idle timeout settings for Upgrade / Connection headers.',
            'All computers that should sync the same Vault must use the exact same Vault ID.',
            `Clients must use Live Sync protocol v${LIVE_SYNC_PROTOCOL_VERSION} or newer; old clients are blocked from writing unless ARS_NOTE_ALLOW_LEGACY_LIVE_WRITES=true.`,
          ],
        },
        clients: clientSummaries,
        clientHistory,
        clientEvents,
      });
    }

    if (routePath === '/api/live-sync/file' && method === 'GET') {
      const vaultId = url.searchParams.get('vaultId') || '';
      const relativePath = url.searchParams.get('relativePath') || '';
      if (!vaultId || !relativePath) {
        return json(res, { ok: false, error: 'Missing vaultId or relativePath' }, 400);
      }
      if (typeof storage.getLiveFile !== 'function') {
        return json(res, { ok: false, error: 'Live file persistence is not available for this storage backend' }, 501);
      }
      const file = await storage.getLiveFile(vaultId, relativePath);
      if (!file) return json(res, { ok: false, error: 'Live file not found' }, 404);
      return json(res, { ok: true, vaultId, file });
    }

    if (routePath === '/api/live-sync/files' && method === 'GET') {
      const vaultId = url.searchParams.get('vaultId') || '';
      if (!vaultId) {
        return json(res, { ok: false, error: 'Missing query param: vaultId' }, 400);
      }
      if (typeof storage.listLiveFiles !== 'function') {
        return json(res, { ok: false, error: 'Live file persistence is not available for this storage backend' }, 501);
      }
      const limit = Math.max(1, Math.min(5000, parseInt(url.searchParams.get('limit') || '5000', 10) || 5000));
      const files = (await storage.listLiveFiles(vaultId, { includeContent: false }))
        .filter((file) => isLiveSyncablePath(file.relativePath));
      return json(res, {
        ok: true,
        vaultId,
        files: files
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, limit)
          .map((file) => ({
            relativePath: file.relativePath,
            sha256: file.sha256,
            size: file.size,
            updatedAt: file.updatedAt,
            deleted: !!file.deleted,
            serverRevision: file.serverRevision,
            revisionId: file.revisionId,
            updatedByClientId: file.updatedByClientId,
            updatedByDeviceId: file.updatedByDeviceId,
            tombstoneExpiresAt: file.tombstoneExpiresAt,
          })),
      });
    }

    /* 404 */
    json(res, { ok: false, error: 'Not found' }, 404);
  } catch (err: any) {
    console.error('Request error:', err.message);
    const statusCode = Number(err?.statusCode || 500);
    if (statusCode === 413) res.setHeader('Connection', 'close');
    if (!res.headersSent) {
      json(res, { ok: false, error: err.message || 'Internal server error' }, statusCode);
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

/* ═══════════════════════════════════════════════════
   WebSocket Live Sync — upgrade handler (v1.0.0)
   ═══════════════════════════════════════════════════ */

function parseWebSocketFrame(data: Buffer): { opcode: number; payload: string } | null {
  if (data.length < 2) return null;
  const firstByte = data[0];
  const secondByte = data[1];
  const opcode = firstByte & 0x0F;
  const isMasked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7F;
  let offset = 2;

  if (payloadLength === 126) {
    if (data.length < 4) return null;
    payloadLength = data.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (data.length < 10) return null;
    payloadLength = Number(data.readBigUInt64BE(2));
    offset = 10;
  }

  let payload: Buffer;
  if (isMasked) {
    if (data.length < offset + 4 + payloadLength) return null;
    const maskKey = data.slice(offset, offset + 4);
    offset += 4;
    payload = Buffer.alloc(payloadLength);
    for (let i = 0; i < payloadLength; i++) {
      payload[i] = data[offset + i] ^ maskKey[i % 4];
    }
  } else {
    if (data.length < offset + payloadLength) return null;
    payload = data.slice(offset, offset + payloadLength);
  }

  return { opcode, payload: payload.toString('utf-8') };
}

function inspectWebSocketFrame(data: Buffer): { payloadLength: number; frameSize: number } | null {
  if (data.length < 2) return null;
  const secondByte = data[1];
  const isMasked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7F;
  let headerSize = 2;

  if (payloadLength === 126) {
    if (data.length < 4) return null;
    payloadLength = data.readUInt16BE(2);
    headerSize = 4;
  } else if (payloadLength === 127) {
    if (data.length < 10) return null;
    const largeLength = data.readBigUInt64BE(2);
    payloadLength = largeLength > BigInt(Number.MAX_SAFE_INTEGER) ? Number.POSITIVE_INFINITY : Number(largeLength);
    headerSize = 10;
  }

  return {
    payloadLength,
    frameSize: headerSize + (isMasked ? 4 : 0) + payloadLength,
  };
}

function createWebSocketFrame(payload: string): Buffer {
  const payloadBuf = Buffer.from(payload, 'utf-8');
  const length = payloadBuf.length;

  if (length < 126) {
    const frame = Buffer.alloc(2 + length);
    frame[0] = 0x81;
    frame[1] = length;
    payloadBuf.copy(frame, 2);
    return frame;
  } else if (length < 65536) {
    const frame = Buffer.alloc(4 + length);
    frame[0] = 0x81;
    frame[1] = 126;
    frame.writeUInt16BE(length, 2);
    payloadBuf.copy(frame, 4);
    return frame;
  } else {
    const frame = Buffer.alloc(10 + length);
    frame[0] = 0x81;
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(length), 2);
    payloadBuf.copy(frame, 10);
    return frame;
  }
}

function wsSend(socket: any, data: string): void {
  try {
    const frame = createWebSocketFrame(data);
    socket.write(frame);
  } catch { /* ignore write errors */ }
}

function performHandshake(req: http.IncomingMessage, socket: any, head: Buffer): boolean {
  const wsKey = req.headers['sec-websocket-key'];
  if (!wsKey) return false;

  const acceptHash = crypto
    .createHash('sha1')
    .update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + acceptHash + '\r\n\r\n'
  );
  return true;
}

server.on('upgrade', (req: http.IncomingMessage, socket: any, head: Buffer) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const pathname = url.pathname;
  const routePath = normalizeKnownRoutePath(pathname);

  if (routePath !== '/ws/live-sync') {
    socket.destroy();
    return;
  }

  /* Auth check */
  const configuredKey = getServerApiKey();
  if (configuredKey) {
    const authHeader = req.headers['authorization'];
    const customHeader = req.headers['x-ars-note-api-key'];
    const queryKey = url.searchParams.get('apiKey');
    const key = (authHeader && String(authHeader).replace('Bearer ', '')) || customHeader || queryKey;
    if (key !== configuredKey) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
  }

  /* Get vaultId from query */
  const vaultId = url.searchParams.get('vaultId');
  if (!vaultId) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\nMissing vaultId\r\n');
    socket.destroy();
    return;
  }

  /* Perform WebSocket handshake */
  if (!performHandshake(req, socket, head)) {
    socket.destroy();
    return;
  }

  const wsProxy = {
    send: (data: string) => wsSend(socket, data),
    _socket: socket,
  };

  const client = registerClient(vaultId, wsProxy, {
    deviceId: url.searchParams.get('deviceId') || undefined,
    deviceName: url.searchParams.get('deviceName') || undefined,
    platform: url.searchParams.get('platform') || undefined,
    appVersion: url.searchParams.get('appVersion') || undefined,
    protocolVersion: url.searchParams.get('protocolVersion') || undefined,
  });
  console.log(`[LiveSync] Client ${client.clientId} connected to vault "${vaultId}" (${getVaultClients(vaultId).length} clients)`);
  void persistLiveSyncClientHistory(storage, client);
  void persistLiveSyncClientEvent(storage, client, 'connect', {
    level: 'info',
    webSocketStatus: 'online',
  });

  const welcome = createWelcomeEvent(vaultId, client.clientId);
  wsSend(socket, JSON.stringify(welcome));
  client.sentCount++;

  if (typeof storage.listLiveFiles === 'function') {
    const metadataOnly = Number(client.protocolVersion || 0) >= 4;
    storage.listLiveFiles(vaultId, { includeContent: !metadataOnly })
      .then((files) => {
        const syncableFiles = files.filter((file) => isLiveSyncablePath(file.relativePath));
        const snapshotSentAt = new Date().toISOString();
        wsSend(socket, JSON.stringify({
          type: 'live-snapshot',
          vaultId,
          files: syncableFiles,
          contentMode: metadataOnly ? 'metadata' : 'inline',
          timestamp: snapshotSentAt,
        }));
        client.lastSnapshotSentAt = snapshotSentAt;
        client.sentCount++;
        void persistLiveSyncClientHistory(storage, client);
      })
      .catch(() => {});
  }

  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 2) {
      const frameInfo = inspectWebSocketFrame(buffer);
      if (!frameInfo) break;
      if (!Number.isFinite(frameInfo.payloadLength) || frameInfo.payloadLength > MAX_WEBSOCKET_MESSAGE_BYTES) {
        console.warn(`[LiveSync] Closing oversized WebSocket message from ${client.clientId}: ${frameInfo.payloadLength} bytes`);
        socket.end();
        return;
      }
      if (buffer.length < frameInfo.frameSize) break;
      const frame = parseWebSocketFrame(buffer);
      if (!frame) break;

      if (frame.opcode === 0x8) {
        socket.end();
        return;
      }
      if (frame.opcode === 0x9) {
        wsSend(socket, frame.payload);
      }
      if (frame.opcode === 0x1 && frame.payload) {
        handleMessage(client, frame.payload, storage);
      }

      buffer = buffer.slice(frameInfo.frameSize);
    }
  });

  socket.on('close', () => {
    void persistLiveSyncClientHistory(storage, client, {
      webSocketStatus: 'offline',
      disconnectedAt: new Date().toISOString(),
      lastDisconnectReason: 'close',
    });
    void persistLiveSyncClientEvent(storage, client, 'disconnect', {
      level: 'warning',
      reason: 'close',
      webSocketStatus: 'offline',
    });
    unregisterClient(vaultId, client.clientId);
    console.log(`[LiveSync] Client ${client.clientId} disconnected from vault "${vaultId}"`);
  });

  socket.on('error', (err: any) => {
    void persistLiveSyncClientHistory(storage, client, {
      webSocketStatus: 'offline',
      disconnectedAt: new Date().toISOString(),
      lastDisconnectReason: err?.message || 'socket-error',
    });
    void persistLiveSyncClientEvent(storage, client, 'disconnect', {
      level: 'warning',
      reason: err?.message || 'socket-error',
      webSocketStatus: 'offline',
    });
    unregisterClient(vaultId, client.clientId);
    console.error(`[LiveSync] Socket error for client ${client.clientId}:`, err.message);
  });
});

async function startServer(): Promise<void> {
  const configuredApiKey = getServerApiKey() || '';
  if (REQUIRE_API_KEY && configuredApiKey.length < 16) {
    throw new Error('ARS_NOTE_REQUIRE_API_KEY=true requires ARS_NOTE_SERVER_API_KEY with at least 16 characters');
  }
  await storage.initialize();
  if (storage.listVaults && storage.pruneIgnoredLiveFiles) {
    const vaults = await storage.listVaults();
    let removedIgnoredFiles = 0;
    for (const vault of vaults) {
      removedIgnoredFiles += await storage.pruneIgnoredLiveFiles(vault.vaultId);
    }
    if (removedIgnoredFiles > 0) {
      console.warn(`Removed ${removedIgnoredFiles} internal or credential file(s) from live-sync storage.`);
    }
  }
  startServerExportScheduler(storage);
  server.listen(PORT, HOST, () => {
  console.log(`${SERVER_APP_NAME} v${SERVER_VERSION} listening on http://${HOST}:${PORT}`);
  console.log(`  Build ID: ${SERVER_BUILD_ID}`);
  console.log(`  Live Sync: ws://${HOST}:${PORT}/ws/live-sync?vaultId=<vaultId>`);
  const liveSyncPolicy = getLiveSyncPolicy();
  console.log(`  Live Sync policy: requiredProtocolVersion=${liveSyncPolicy.requiredProtocolVersion}, legacyLiveWritesAllowed=${liveSyncPolicy.legacyLiveWritesAllowed}`);
  const capabilities = buildServerCapabilities(storage);
  const safetyProfile = buildSafetyProfile(capabilities);
  console.log(
    `  Live Sync safety: ready=${safetyProfile.readyForLiveSync}, schema=${safetyProfile.schemaVersion}, missing=${safetyProfile.missingRequiredCapabilities.join(', ') || '-'}`,
  );
  if (isDevMode()) {
    console.warn('⚠ WARNING: No ARS_NOTE_SERVER_API_KEY set. Running in dev mode — no authentication required.');
    console.warn('  Set ARS_NOTE_SERVER_API_KEY=<your-secret> to enable API key authentication.');
  } else {
    console.log('🔒 API key authentication enabled.');
  }
  });
}

void startServer().catch((err: any) => {
  console.error('Fatal storage initialization error; server was not started:', err?.message || err);
  process.exitCode = 1;
});
