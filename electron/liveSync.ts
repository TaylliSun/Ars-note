/* ── Electron Live Sync — Real-time vault synchronization ── */
/* Watches vault files with chokidar and syncs changes via WebSocket */
/* No external ws library — uses Node.js built-in http upgrade */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import { URL } from 'url';

/* ── Resolve app version from package.json ── */
let _cachedVersion: string | null = null;
function getAppVersion(): string {
  if (_cachedVersion) return _cachedVersion;
  try {
    const pkg = require(path.resolve(__dirname, '..', 'package.json'));
    _cachedVersion = pkg?.version || 'unknown';
  } catch {
    _cachedVersion = 'unknown';
  }
  return _cachedVersion || 'unknown';
}

/* ── Types ── */

export interface LiveSyncConfig {
  enabled: boolean;
  serverUrl: string;
  apiKey?: string;
  vaultId?: string;
  connectionMode?: LiveSyncConnectionMode;
}

export interface LiveSyncStartOptions {
  serverSafetyVerified?: boolean;
}

export type LiveSyncConnectionMode = 'join' | 'rebuild';

export function normalizeLiveSyncConnectionMode(value: unknown): LiveSyncConnectionMode {
  return value === 'rebuild' ? 'rebuild' : 'join';
}

export function normalizeLiveSyncServerUrl(serverUrl: string): string {
  const trimmed = String(serverUrl || '').trim();
  if (!trimmed) return '';

  const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  const url = new URL(withProtocol.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:'));
  let pathname = url.pathname.replace(/\/+$/, '');

  pathname = pathname
    .replace(/\/ws\/live-sync$/i, '')
    .replace(/\/api\/live-sync\/(?:status|files)$/i, '')
    .replace(/\/api\/version$/i, '')
    .replace(/\/health$/i, '')
    .replace(/\/admin$/i, '');

  url.pathname = pathname && pathname !== '/' ? pathname : '/';
  url.search = '';
  url.hash = '';

  return url.toString().replace(/\/$/, '');
}

interface LiveSyncState {
  connected: boolean;
  clientId: string;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  initialSnapshotTimer: ReturnType<typeof setTimeout> | null;
  pingTimer: ReturnType<typeof setInterval> | null;
  watcher: any | null; /* chokidar.FSWatcher */
  socket: any | null;  /* net.Socket */
  syncConfig: LiveSyncConfig;
  vaultPath: string;
  connectedAt: string | null;
  pendingChanges: Set<string>;
  queuedFilePushes: Map<string, QueuedFilePush>;
  recentLocalPushes: Map<string, { sha256: string; size: number; at: number }>;
  deleteShadowCache: Map<string, DeleteShadowSnapshot>;
  deleteShadowTotalBytes: number;
  lastActivity: LiveSyncActivity | null;
  lastRejectedWrite: LiveSyncRejectedWrite | null;
  lastError: string;
  latencyMs: number | null;
  lastPongAt: string | null;
  receivedRemoteSnapshot: boolean;
  preflightComplete: boolean;
  snapshotReconcileInProgress: boolean;
  lastRemoteSnapshotReceivedAt: string | null;
  uploadFrozen: boolean;
  uploadFrozenReason: string;
  preflightBlockedUploadCount: number;
  preflightBlockedUploadFiles: string[];
  deleteGuardTimestamps: number[];
  deleteStormBlockedCount: number;
  deleteStormBlockedFiles: string[];
  serverAdoptionArchiveDir: string | null;
  lastServerAuthorityAdoption: LiveSyncServerAuthorityAdoption | null;
  lastRemoteFiles: Map<string, any>;
  deferredRemoteChanges: any[];
  lastPing: number;
  reconnectAttempts: number;
}

interface QueuedFilePush {
  action: 'create' | 'update' | 'delete';
  contentBase64: string;
  sha256: string;
  size: number;
  updatedAt: string;
  queuedAfterPreflight: boolean;
  baseSha256: string;
  baseDeleted: boolean;
  baseUpdatedAt: string;
  baseSize: number;
  baseServerRevision?: number;
  baseRevisionId?: string;
  queuedAt: string;
}

/* ── Rename detection ── */
/* When a file is unlinked, we save its content hash briefly.
   If a file with the same hash appears within RENAME_WINDOW_MS,
   we treat it as a rename instead of delete + create. */

interface PendingUnlink {
  relativePath: string;
  sha256: string;
  contentBase64: string;
  size: number;
  deleteStormGuarded?: boolean;
  timer: ReturnType<typeof setTimeout>;
}

const RENAME_WINDOW_MS = 800;
const pendingUnlinks = new Map<string, PendingUnlink>(); /* key = sha256 */

interface LiveSyncActivity {
  direction: 'in' | 'out';
  action: string;
  relativePath: string;
  timestamp: string;
}

interface LiveSyncRejectedWrite {
  relativePath: string;
  action: string;
  reason: string;
  message: string;
  rejectedAt: string;
  clientSha256: string;
  serverSha256: string;
  serverDeleted: boolean;
  serverUpdatedAt: string;
  serverHistoryRevisionId?: string;
  serverHistoryContentAvailable?: boolean;
  rejectedSourceClientId?: string;
  rejectedSourceDeviceId?: string;
}

interface LiveSyncServerAuthorityAdoption {
  mode: JoinSnapshotAuthorityDecision['mode'];
  reason: string;
  completedAt: string;
  baselineFileCount: number;
  remoteFileCount: number;
  protectedCount: number;
  protectedLocalOnlyCount: number;
  protectedDivergedCount: number;
  protectedQueuedCount: number;
  appliedRemoteCount: number;
  matchedCount: number;
  uploadedCount: number;
  skippedCount: number;
  files: string[];
}

/* ── State ── */

let state: LiveSyncState | null = null;

const ARS_NOTE_DIR = '.ars-note';
const AI_MEMORY_DIR = '.ai-memory';
const AI_MEMORY_LIVE_MANIFEST_FILE = '__manifest.json';
const AI_MEMORY_LIVE_MANIFEST_PATH = `${AI_MEMORY_DIR}/${AI_MEMORY_LIVE_MANIFEST_FILE}`;
const TEAM_SCHEDULE_DIR = '.ars-team';
const SYNCABLE_HIDDEN_DIRS = new Set([AI_MEMORY_DIR, TEAM_SCHEDULE_DIR]);
const VAULT_CONFIG_FILE = 'vault.json';
const SYNC_FILE = 'sync.json';
const LIVE_SYNC_STATE_FILE = 'live-sync-state.json';
const SAFE_SERVER_DELETE_QUEUE_FILE = 'safe-server-delete-queue.json';
const AI_SERVER_DELETE_HOLD_FILE = 'ai-server-delete-holds.json';
const LIVE_HISTORY_DIR = 'live-history';
const MAX_HISTORY_VERSIONS = 20;
const REMOTE_LOCAL_CLOCK_SKEW_GRACE_MS = 3000;
const INITIAL_SNAPSHOT_WAIT_MS = 8000;
const SNAPSHOT_CONTENT_FETCH_CONCURRENCY = 4;
const SNAPSHOT_CONTENT_FETCH_TIMEOUT_MS = 120000;
const MAX_SNAPSHOT_FILE_RESPONSE_BYTES = 384 * 1024 * 1024;
const PREFLIGHT_BLOCKED_FILE_LIMIT = 30;
const PREFLIGHT_STALE_BASELINE_MS = 6 * 60 * 60 * 1000;
const EMPTY_SERVER_INITIAL_UPLOAD_REASON = 'empty-server-initial-upload-blocked';
const STALE_BASELINE_UPLOAD_REASON = 'stale-baseline-remote-ahead';
const REBUILD_MODE_EXPLICIT_PUBLISH_REASON = 'rebuild-mode-explicit-publish-required';
const SERVER_AUTHORITATIVE_ADOPTION_REASON = 'server-authoritative-adoption';
const SERVER_SAFETY_CAPABILITIES_REASON = 'server-safety-capabilities-missing';
const DELETE_STORM_WINDOW_MS = 10 * 1000;
const DELETE_STORM_THRESHOLD = 10;
const DELETE_STORM_BLOCKED_FILE_LIMIT = 30;
const AUTO_SYNC_DELETE_STORMS = process.env.ARS_NOTE_AUTO_SYNC_DELETE_STORMS !== '0';
const DELETE_SHADOW_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DELETE_SHADOW_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const DESTRUCTIVE_TRUNCATION_GUARD_REASON = 'destructive-truncation-guard';
const DESTRUCTIVE_TRUNCATION_MIN_PREVIOUS_BYTES = 16 * 1024;
const DESTRUCTIVE_TRUNCATION_MAX_NEW_BYTES = 8 * 1024;
const DESTRUCTIVE_TRUNCATION_MAX_RATIO = 0.2;
const LIVE_SYNC_CLIENT_PROTOCOL_VERSION = 4;
const DELETE_SHADOW_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.json', '.jsonc', '.yaml', '.yml',
  '.csv', '.tsv', '.canvas', '.excalidraw', '.taskpaper',
  '.js', '.ts', '.tsx', '.jsx', '.css', '.html', '.xml',
]);
const REQUIRED_SERVER_SAFETY_CAPABILITIES = [
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
const SERVER_SAFETY_CAPABILITY_LABELS: Record<(typeof REQUIRED_SERVER_SAFETY_CAPABILITIES)[number], string> = {
  livePersistence: 'server live-file snapshots',
  liveHistory: 'server live-history restore',
  serverSnapshotProofProtection: 'server snapshot write-proof protection',
  rebuildPreWriteSnapshots: 'server rebuild pre-write snapshots',
  serverRestoreMetadataBroadcast: 'server restore metadata broadcast',
  staleWriteProtection: 'stale-write protection',
  missingBaseProtection: 'missing-base protection',
  revisionBaseProtection: 'server revision base protection',
  deletedTombstoneProtection: 'deleted-tombstone protection',
  tombstoneRetention30Days: '30-day tombstone retention',
  prunedTombstoneHistoryProtection: 'pruned-tombstone history protection',
  deleteStormProtection: 'delete-storm protection',
  destructiveTruncationProtection: 'destructive-truncation protection',
  vaultIdentityAutoResolve: 'vault identity auto-resolve',
  atomicLivePersistence: 'atomic live-file persistence',
  crashRecoveryJournal: 'crash-recovery transaction journal',
  serializedVaultWrites: 'serialized per-Vault writes',
  startupStorageReadiness: 'storage-ready startup gate',
  metadataOnlySnapshots: 'metadata-only reconnect snapshots',
};

interface DeleteShadowSnapshot {
  relativePath: string;
  sha256: string;
  size: number;
  updatedAt: string;
  capturedAt: number;
  contentBase64: string;
}

interface SyncedFileState {
  sha256: string;
  updatedAt: string;
  deleted?: boolean;
  size?: number;
  serverRevision?: number;
  revisionId?: string;
  updatedByClientId?: string;
  updatedByDeviceId?: string;
  tombstoneExpiresAt?: string;
}

interface LiveSyncBaseline {
  version: 1;
  vaultId: string;
  updatedAt: string;
  files: Record<string, SyncedFileState>;
}

export interface SafeServerDeleteQueueItem {
  id: string;
  vaultId: string;
  relativePath: string;
  sha256: string;
  size: number;
  updatedAt: string;
  serverRevision?: number;
  revisionId?: string;
  queuedAt: string;
  source: 'local-authority-rebuild' | 'manual' | 'ai-delete';
  reason: string;
}

interface AIServerDeleteHoldItem {
  relativePath: string;
  sha256?: string;
  size?: number;
  updatedAt?: string;
  deletedAt?: string;
  recoveryPath?: string;
  reason?: string;
  source?: string;
}

interface LocalFileSnapshot {
  relativePath: string;
  fullPath: string;
  sha256: string;
  size: number;
  mtimeMs: number;
}

function sanitizeRemoteVaultId(value: string): string {
  const trimmed = (value || '').trim();
  const cleaned = trimmed
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
  if (cleaned && /[a-zA-Z0-9]/.test(cleaned)) return cleaned;
  return 'vault_' + crypto.createHash('sha1').update(trimmed || 'vault').digest('hex').slice(0, 16);
}

function readVaultConfig(vaultPath: string): any {
  try {
    const configPath = path.join(path.resolve(vaultPath), ARS_NOTE_DIR, VAULT_CONFIG_FILE);
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch { /* ignore invalid config */ }
  return {};
}

function readSyncConfig(vaultPath: string): any {
  try {
    const syncPath = path.join(path.resolve(vaultPath), ARS_NOTE_DIR, SYNC_FILE);
    if (fs.existsSync(syncPath)) {
      return JSON.parse(fs.readFileSync(syncPath, 'utf-8'));
    }
  } catch { /* ignore invalid sync config */ }
  return {};
}

function getStableVaultId(vaultPath: string, config: LiveSyncConfig): string {
  const vc = readVaultConfig(vaultPath);
  const syncCfg = readSyncConfig(vaultPath);
  return sanitizeRemoteVaultId(config.vaultId || syncCfg.remoteVaultId || vc.vaultId || path.basename(path.resolve(vaultPath)));
}

function isConflictArtifact(relPath: string): boolean {
  return /(^|\/)[^/]+\.conflict-\d+$/.test(relPath.replace(/\\/g, '/'));
}

export function isLiveSyncRecoveryArchivePath(relPath: string): boolean {
  const normalized = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return normalized.startsWith(`${ARS_NOTE_DIR}/sync-recovery/`);
}

export function isUserVisibleConflictArtifactPath(relPath: string): boolean {
  const normalized = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!isConflictArtifact(normalized)) return false;
  if (normalized.startsWith(`${ARS_NOTE_DIR}/`)) return false;
  if (normalized.startsWith(`${AI_MEMORY_DIR}/`)) return false;
  if (normalized.startsWith(`${TEAM_SCHEDULE_DIR}/`)) return false;
  return true;
}

function safeVaultRelativePath(value: string): string {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some(part => part === '..')) {
    throw new Error('Invalid vault relative path');
  }
  return normalized;
}

function safeArchivePath(root: string, relPath: string): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(path.join(resolvedRoot, safeVaultRelativePath(relPath).replace(/\//g, path.sep)));
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Archive path escapes recovery directory');
  }
  return target;
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function getServerAdoptionArchiveDir(): string {
  if (!state) throw new Error('Live Sync is not running');
  if (!state.serverAdoptionArchiveDir) {
    state.serverAdoptionArchiveDir = path.join(
      state.vaultPath,
      ARS_NOTE_DIR,
      'sync-recovery',
      `${SERVER_AUTHORITATIVE_ADOPTION_REASON}-${timestampForPath()}`,
    );
  }
  fs.mkdirSync(state.serverAdoptionArchiveDir, { recursive: true });
  return state.serverAdoptionArchiveDir;
}

function archiveBufferForRecovery(relPath: string, content: Buffer, suffix = ''): string {
  const archiveRoot = getServerAdoptionArchiveDir();
  const archiveRel = suffix ? `${safeVaultRelativePath(relPath)}${suffix}` : safeVaultRelativePath(relPath);
  const archivePath = safeArchivePath(archiveRoot, archiveRel);
  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  fs.writeFileSync(archivePath, content);
  return path.relative(state!.vaultPath, archivePath).replace(/\\/g, '/');
}

function archiveExistingFileForRecovery(fullPath: string, relPath: string, suffix = ''): string | null {
  if (!state || !fs.existsSync(fullPath)) return null;
  const resolvedFile = path.resolve(fullPath);
  if (resolvedFile !== state.vaultPath && !resolvedFile.startsWith(state.vaultPath + path.sep)) {
    throw new Error('Refusing to archive file outside vault');
  }
  const content = fs.readFileSync(resolvedFile);
  return archiveBufferForRecovery(relPath, content, suffix);
}

function isLiveSyncIgnoredPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return (
    normalized.startsWith('.ars-note/') ||
    normalized === '.ai-config.json' ||
    normalized === `${AI_MEMORY_DIR}/live-session.json` ||
    normalized === `${AI_MEMORY_DIR}/history` ||
    normalized.startsWith(`${AI_MEMORY_DIR}/history/`) ||
    normalized.startsWith('__probe/')
  );
}

function isAiMemoryLiveManifestPath(relPath: string): boolean {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '') === AI_MEMORY_LIVE_MANIFEST_PATH;
}

function isPortableAiMemoryPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return (
    normalized.startsWith(`${AI_MEMORY_DIR}/`) &&
    !isAiMemoryLiveManifestPath(normalized) &&
    !isLiveSyncIgnoredPath(normalized) &&
    !isConflictArtifact(normalized)
  );
}

function shouldSkipLiveHistorySnapshot(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return (
    normalized === `${AI_MEMORY_DIR}/live-session.json` ||
    normalized.startsWith(`${AI_MEMORY_DIR}/history/`) ||
    normalized === AI_MEMORY_LIVE_MANIFEST_PATH
  );
}

function baselinePath(): string | null {
  if (!state) return null;
  return path.join(state.vaultPath, ARS_NOTE_DIR, LIVE_SYNC_STATE_FILE);
}

function readLiveBaseline(): LiveSyncBaseline {
  const now = new Date().toISOString();
  const vaultId = state?.syncConfig.vaultId || '';
  const fallback: LiveSyncBaseline = {
    version: 1,
    vaultId,
    updatedAt: now,
    files: {},
  };
  const filePath = baselinePath();
  if (!filePath || !fs.existsSync(filePath)) return fallback;

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<LiveSyncBaseline>;
    if (!raw || typeof raw !== 'object' || raw.version !== 1 || !raw.files || typeof raw.files !== 'object') {
      return fallback;
    }
    return {
      version: 1,
      vaultId: raw.vaultId || vaultId,
      updatedAt: raw.updatedAt || now,
      files: raw.files as Record<string, SyncedFileState>,
    };
  } catch {
    return fallback;
  }
}

function writeLiveBaseline(baseline: LiveSyncBaseline): void {
  const filePath = baselinePath();
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(baseline, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[LiveSync] Failed to write sync baseline:', err.message);
  }
}

function baselineMetadataFrom(source: any): Partial<SyncedFileState> {
  const serverRevision = Number(source?.serverRevision);
  return {
    serverRevision: Number.isFinite(serverRevision) && serverRevision > 0 ? Math.floor(serverRevision) : undefined,
    revisionId: typeof source?.revisionId === 'string' && source.revisionId ? source.revisionId : undefined,
    updatedByClientId: typeof source?.updatedByClientId === 'string' && source.updatedByClientId ? source.updatedByClientId : undefined,
    updatedByDeviceId: typeof source?.updatedByDeviceId === 'string' && source.updatedByDeviceId ? source.updatedByDeviceId : undefined,
    tombstoneExpiresAt: typeof source?.tombstoneExpiresAt === 'string' && source.tombstoneExpiresAt ? source.tombstoneExpiresAt : undefined,
  };
}

function markBaselineSynced(
  relPath: string,
  sha256: string,
  deleted = false,
  updatedAt?: string,
  size = 0,
  metadata: Partial<SyncedFileState> = {},
): void {
  if (!state || !relPath || isConflictArtifact(relPath) || isLiveSyncIgnoredPath(relPath)) return;
  const baseline = readLiveBaseline();
  const now = updatedAt || new Date().toISOString();
  baseline.vaultId = state.syncConfig.vaultId || baseline.vaultId;
  baseline.updatedAt = now;
  baseline.files[relPath] = {
    sha256: deleted ? '' : sha256,
    updatedAt: now,
    deleted,
    size: deleted ? 0 : Math.max(0, Math.floor(Number(size) || 0)),
    ...metadata,
  };
  writeLiveBaseline(baseline);
}

function baselineForChange(relPath: string): {
  sha256: string;
  deleted: boolean;
  updatedAt: string;
  size: number;
  serverRevision?: number;
  revisionId?: string;
} {
  const previous = readLiveBaseline().files[relPath];
  return {
    sha256: previous?.deleted ? '' : (previous?.sha256 || ''),
    deleted: !!previous?.deleted,
    updatedAt: previous?.updatedAt || '',
    size: previous?.deleted ? 0 : Math.max(0, Math.floor(Number(previous?.size) || 0)),
    serverRevision: previous?.serverRevision,
    revisionId: previous?.revisionId,
  };
}

/* ── WebSocket client — minimal RFC 6455 implementation ── */

function buildWebSocketKey(): string {
  return crypto.randomBytes(16).toString('base64');
}

function createWebSocketFrame(payload: string): Buffer {
  const payloadBuf = Buffer.from(payload, 'utf-8');
  const length = payloadBuf.length;
  const maskKey = crypto.randomBytes(4);
  const headerLength = length < 126 ? 2 : length < 65536 ? 4 : 10;
  const frame = Buffer.alloc(headerLength + 4 + length);

  if (length < 126) {
    frame[0] = 0x81;
    frame[1] = 0x80 | length;
  } else if (length < 65536) {
    frame[0] = 0x81;
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(length, 2);
  } else {
    frame[0] = 0x81;
    frame[1] = 0x80 | 127;
    frame.writeBigUInt64BE(BigInt(length), 2);
  }

  maskKey.copy(frame, headerLength);
  for (let i = 0; i < payloadBuf.length; i++) {
    frame[headerLength + 4 + i] = payloadBuf[i] ^ maskKey[i % 4];
  }
  return frame;
}

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

/* ── File hashing ── */

function fileSha256(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/* ── Connection management ── */

export function startLiveSync(
  vaultPath: string,
  config: LiveSyncConfig,
  sendToRenderer: (channel: string, data: any) => void,
  options: LiveSyncStartOptions = {},
): void {
  stopLiveSync();

  if (!config.enabled || !config.serverUrl) return;

  const serverUrl = normalizeLiveSyncServerUrl(config.serverUrl);
  if (!serverUrl) return;

  const vaultId = getStableVaultId(vaultPath, config);
  const connectionMode = normalizeLiveSyncConnectionMode(config.connectionMode);

  state = {
    connected: false,
    clientId: crypto.randomBytes(8).toString('hex'),
    reconnectTimer: null,
    initialSnapshotTimer: null,
    pingTimer: null,
    watcher: null,
    socket: null,
    syncConfig: { ...config, serverUrl, vaultId, connectionMode },
    vaultPath: path.resolve(vaultPath),
    connectedAt: null,
    pendingChanges: new Set(),
    queuedFilePushes: new Map(),
    recentLocalPushes: new Map(),
    deleteShadowCache: new Map(),
    deleteShadowTotalBytes: 0,
    lastActivity: null,
    lastRejectedWrite: null,
    lastError: '',
    latencyMs: null,
    lastPongAt: null,
    receivedRemoteSnapshot: false,
    preflightComplete: false,
    snapshotReconcileInProgress: false,
    lastRemoteSnapshotReceivedAt: null,
    uploadFrozen: false,
    uploadFrozenReason: '',
    preflightBlockedUploadCount: 0,
    preflightBlockedUploadFiles: [],
    deleteGuardTimestamps: [],
    deleteStormBlockedCount: 0,
    deleteStormBlockedFiles: [],
    serverAdoptionArchiveDir: null,
    lastServerAuthorityAdoption: null,
    lastRemoteFiles: new Map(),
    deferredRemoteChanges: [],
    lastPing: 0,
    reconnectAttempts: 0,
  };

  startFileWatcher(sendToRenderer);
  connectWebSocket(sendToRenderer, options.serverSafetyVerified === true);
}

export function stopLiveSync(): void {
  if (!state) return;

  if (state.watcher) {
    try { state.watcher.close(); } catch { /* ignore */ }
    state.watcher = null;
  }
  if (state.socket) {
    try { state.socket.end(); } catch { /* ignore */ }
    state.socket = null;
  }
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  for (const pending of pendingUnlinks.values()) {
    try { clearTimeout(pending.timer); } catch { /* ignore */ }
  }
  pendingUnlinks.clear();
  if (state.initialSnapshotTimer) {
    clearTimeout(state.initialSnapshotTimer);
    state.initialSnapshotTimer = null;
  }
  if (state.pingTimer) {
    clearInterval(state.pingTimer);
    state.pingTimer = null;
  }

  state = null;
}

export function getLiveSyncStatus(): { connected: boolean; clientId: string; vaultId: string; serverUrl: string; connectedAt: string | null; connectionMode: LiveSyncConnectionMode; lastError?: string } | null {
  if (!state) return null;
  return {
    connected: state.connected,
    clientId: state.clientId,
    vaultId: state.syncConfig.vaultId || '',
    serverUrl: state.syncConfig.serverUrl,
    connectedAt: state.connectedAt,
    connectionMode: normalizeLiveSyncConnectionMode(state.syncConfig.connectionMode),
    lastError: state.lastError || undefined,
  };
}

export function getLiveSyncHealthSnapshot(): any | null {
  if (!state) return null;
  const safeDeleteQueue = readSafeServerDeleteQueue();
  return {
    connected: state.connected,
    clientId: state.clientId,
    vaultId: state.syncConfig.vaultId || '',
    serverUrl: state.syncConfig.serverUrl,
    connectionMode: normalizeLiveSyncConnectionMode(state.syncConfig.connectionMode),
    connectedAt: state.connectedAt,
    lastActivity: state.lastActivity,
    lastRejectedWrite: state.lastRejectedWrite,
    lastError: state.lastError,
    latencyMs: state.latencyMs,
    lastPongAt: state.lastPongAt,
    preflightComplete: state.preflightComplete,
    receivedRemoteSnapshot: state.receivedRemoteSnapshot,
    snapshotReconcileInProgress: state.snapshotReconcileInProgress,
    lastRemoteSnapshotReceivedAt: state.lastRemoteSnapshotReceivedAt,
    uploadFrozen: state.uploadFrozen,
    uploadFrozenReason: state.uploadFrozenReason,
    preflightBlockedUploadCount: state.preflightBlockedUploadCount,
    preflightBlockedUploadFiles: state.preflightBlockedUploadFiles.slice(0, PREFLIGHT_BLOCKED_FILE_LIMIT),
    deleteStormBlockedCount: state.deleteStormBlockedCount,
    deleteStormBlockedFiles: state.deleteStormBlockedFiles.slice(0, DELETE_STORM_BLOCKED_FILE_LIMIT),
    serverAuthorityAdoption: state.lastServerAuthorityAdoption,
    queuedFileCount: state.queuedFilePushes.size,
    pendingRemoteApplyCount: state.pendingChanges.size,
    deleteShadowCount: state.deleteShadowCache.size,
    deleteShadowTotalBytes: state.deleteShadowTotalBytes,
    safeDeleteQueueCount: safeDeleteQueue.length,
    safeDeleteQueueFiles: safeDeleteQueue.slice(0, PREFLIGHT_BLOCKED_FILE_LIMIT).map((item) => item.relativePath),
    queuedFiles: Array.from(state.queuedFilePushes.entries()).map(([relativePath, item]) => ({
      relativePath,
      action: item.action,
      queuedAt: item.queuedAt,
      queuedAfterPreflight: item.queuedAfterPreflight,
      size: item.size,
    })),
    pendingRemoteFiles: Array.from(state.pendingChanges).map(relativePath => ({ relativePath })),
    recentLocalFiles: Array.from(state.recentLocalPushes.entries()).map(([relativePath, item]) => ({
      relativePath,
      sha256: item.sha256,
      size: item.size,
      at: new Date(item.at).toISOString(),
    })),
  };
}

/* ── Pre-connect version check ── */

function checkServerVersion(sendToRenderer: (channel: string, data: any) => void): void {
  if (!state) return;

  const config = state.syncConfig;
  const url = new URL(normalizeLiveSyncServerUrl(config.serverUrl));
  const transport = url.protocol === 'https:' ? https : http;
  const basePath = url.pathname && url.pathname !== '/' ? url.pathname.replace(/\/+$/, '') : '';

  const req = transport.request({
    hostname: url.hostname,
    port: parseInt(url.port || (url.protocol === 'https:' ? '443' : '80')),
    path: `${basePath}/api/version`,
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    timeout: 5000,
  }, (res) => {
    let body = '';
    res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    res.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.ok && data.version) {
          const clientVer = getAppVersion();
          if (data.version !== clientVer) {
            console.warn(`[LiveSync] Version check: client ${clientVer}, server ${data.version}`);
            sendToRenderer('live-sync:version-check', {
              match: false,
              clientVersion: clientVer,
              serverVersion: data.version,
              message: `Server v${data.version}, client v${clientVer}`,
            });
          }
        }
      } catch { /* ignore parse errors — non-critical */ }
    });
  });

  req.on('error', () => { /* ignore — non-critical check */ });
  req.on('timeout', () => { req.destroy(); });
  req.end();
}

/* ── WebSocket connection ── */

function blockUnsafeLiveSocketConnect(
  message: string,
  sendToRenderer: (channel: string, data: any) => void,
): void {
  if (!state) return;
  state.lastError = message;
  state.uploadFrozen = true;
  state.uploadFrozenReason = SERVER_SAFETY_CAPABILITIES_REASON;
  state.preflightComplete = false;
  emitActivity(sendToRenderer, {
    direction: 'in',
    action: 'server-safety-check-blocked',
    relativePath: message,
    timestamp: new Date().toISOString(),
  });
  sendToRenderer('live-sync:status', {
    connected: false,
    error: message,
    clientId: state.clientId,
    vaultId: state.syncConfig.vaultId,
    serverUrl: state.syncConfig.serverUrl,
    connectedAt: null,
    preflightComplete: state.preflightComplete,
    receivedRemoteSnapshot: state.receivedRemoteSnapshot,
    uploadFrozen: state.uploadFrozen,
    uploadFrozenReason: state.uploadFrozenReason,
    preflightBlockedUploadCount: state.preflightBlockedUploadCount,
    preflightBlockedUploadFiles: state.preflightBlockedUploadFiles.slice(0, PREFLIGHT_BLOCKED_FILE_LIMIT),
    serverAuthorityAdoption: state.lastServerAuthorityAdoption,
  });
}

async function verifyServerSafetyBeforeSocket(
  sendToRenderer: (channel: string, data: any) => void,
): Promise<boolean> {
  if (!state) return false;
  if (process.env.ARS_NOTE_ALLOW_UNSAFE_LIVE_SYNC === '1') return true;

  const config = state.syncConfig;
  const url = new URL(normalizeLiveSyncServerUrl(config.serverUrl));
  const transport = url.protocol === 'https:' ? https : http;
  const basePath = url.pathname && url.pathname !== '/' ? url.pathname.replace(/\/+$/, '') : '';
  const requestPath = `${basePath}/api/live-sync/status?vaultId=${encodeURIComponent(config.vaultId || '')}&summary=0`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.apiKey) {
    headers.Authorization = 'Bearer ' + config.apiKey;
    headers['x-ars-note-api-key'] = config.apiKey;
  }

  const result = await new Promise<{ ok: boolean; data?: any; error?: string; statusCode?: number }>((resolve) => {
    const req = transport.request({
      hostname: url.hostname,
      port: parseInt(url.port || (url.protocol === 'https:' ? '443' : '80')),
      path: requestPath,
      method: 'GET',
      headers,
      timeout: 15000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300 || !data?.ok) {
            resolve({ ok: false, data, statusCode: res.statusCode || 0, error: data?.error || `HTTP ${res.statusCode || 0}` });
            return;
          }
          resolve({ ok: true, data, statusCode: res.statusCode || 0 });
        } catch (err: any) {
          resolve({ ok: false, statusCode: res.statusCode || 0, error: err?.message || 'Invalid server safety response' });
        }
      });
    });
    req.on('error', (err: any) => resolve({ ok: false, error: err?.message || 'Server safety check failed' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Server safety check timeout' });
    });
    req.end();
  });

  if (!state) return false;
  if (!result.ok || !result.data) {
    blockUnsafeLiveSocketConnect(
      `实时同步重连前安全检查失败：${result.error || 'server unavailable'}。为避免旧数据覆盖，已暂停 WebSocket 连接。`,
      sendToRenderer,
    );
    return false;
  }

  const capabilities = result.data.capabilities;
  const reported = !!capabilities && typeof capabilities === 'object';
  const missing = reported
    ? REQUIRED_SERVER_SAFETY_CAPABILITIES.filter((key) => capabilities[key] !== true)
    : [...REQUIRED_SERVER_SAFETY_CAPABILITIES];
  if (missing.length > 0) {
    const labels = missing.map((key) => SERVER_SAFETY_CAPABILITY_LABELS[key]).join(', ');
    blockUnsafeLiveSocketConnect(
      reported
        ? `实时同步重连已被拦截：服务器缺少关键安全能力：${labels}。请更新 NAS server 后再连接。`
        : '实时同步重连已被拦截：服务器没有报告新版安全能力。请更新 NAS server 后再连接。',
      sendToRenderer,
    );
    return false;
  }

  clearLiveUploadFreeze(SERVER_SAFETY_CAPABILITIES_REASON);
  if (state.lastError && /安全检查|safety/i.test(state.lastError)) state.lastError = '';
  return true;
}

function connectWebSocket(sendToRenderer: (channel: string, data: any) => void, serverSafetyVerified = false): void {
  if (!state) return;
  if (serverSafetyVerified) {
    clearLiveUploadFreeze(SERVER_SAFETY_CAPABILITIES_REASON);
    openWebSocketConnection(sendToRenderer);
    return;
  }
  void verifyServerSafetyBeforeSocket(sendToRenderer)
    .then((safe) => {
      if (!state) return;
      if (!safe) {
        scheduleReconnect(sendToRenderer);
        return;
      }
      openWebSocketConnection(sendToRenderer);
    })
    .catch((err: any) => {
      if (!state) return;
      blockUnsafeLiveSocketConnect(
        `实时同步重连前安全检查异常：${err?.message || err || 'unknown error'}。为避免旧数据覆盖，已暂停 WebSocket 连接。`,
        sendToRenderer,
      );
      scheduleReconnect(sendToRenderer);
    });
}

function openWebSocketConnection(sendToRenderer: (channel: string, data: any) => void): void {
  if (!state) return;

  const config = state.syncConfig;
  const wsUrl = new URL(normalizeLiveSyncServerUrl(config.serverUrl));
  const transport = wsUrl.protocol === 'https:' ? https : http;
  const host = wsUrl.hostname;
  const port = wsUrl.port || (wsUrl.protocol === 'https:' ? '443' : '80');
  const basePath = wsUrl.pathname && wsUrl.pathname !== '/' ? wsUrl.pathname.replace(/\/+$/, '') : '';
  const query = new URLSearchParams({
    vaultId: config.vaultId || '',
    deviceId: state.clientId,
    deviceName: os.hostname(),
    platform: os.platform(),
    appVersion: getAppVersion(),
    protocolVersion: String(LIVE_SYNC_CLIENT_PROTOCOL_VERSION),
  });
  if (config.apiKey) query.set('apiKey', config.apiKey);
  const wsPath = `${basePath}/ws/live-sync?${query.toString()}`;
  const wsKey = buildWebSocketKey();

  const headers: Record<string, string> = {
    'Host': host + ':' + port,
    'Upgrade': 'websocket',
    'Connection': 'Upgrade',
    'Sec-WebSocket-Key': wsKey,
    'Sec-WebSocket-Version': '13',
  };

  if (config.apiKey) {
    headers['x-ars-note-api-key'] = config.apiKey;
  }

  const req = transport.request({
    hostname: host,
    port: parseInt(port),
    path: wsPath,
    method: 'GET',
    headers,
  });

  req.on('upgrade', (res, socket, head) => {
    if (!state) { socket.destroy(); return; }

    state.socket = socket;
    state.connected = true;
    state.connectedAt = new Date().toISOString();
    state.reconnectAttempts = 0; /* reset backoff on successful connect */
    state.lastError = '';
    state.receivedRemoteSnapshot = false;
    state.preflightComplete = false;
    state.snapshotReconcileInProgress = false;
    state.lastRemoteSnapshotReceivedAt = null;
    state.deferredRemoteChanges = [];

    console.log('[LiveSync] Connected to', config.serverUrl, 'as client', state.clientId);

    /* Send welcome to renderer */
    sendToRenderer('live-sync:status', {
      connected: true,
      clientId: state.clientId,
      vaultId: config.vaultId,
      serverUrl: config.serverUrl,
      connectedAt: state.connectedAt,
    });

    /* Start file watcher */
    startFileWatcher(sendToRenderer);
    scheduleInitialSnapshot(sendToRenderer);

    /* Start ping interval */
    state.pingTimer = setInterval(() => {
      if (state && state.connected) {
        try {
          wsSend('{\"type\":\"ping\"}');
          state.lastPing = Date.now();
        } catch {
          /* connection lost */
          handleDisconnect(sendToRenderer);
        }
      }
    }, 30000);

    /* Buffer for incoming frames */
    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk: Buffer) => {
      if (!state) return;
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 2) {
        const frame = parseWebSocketFrame(buffer);
        if (!frame) break;

        /* Calculate frame size */
        let frameSize = 2;
        const secondByte = buffer[1];
        let payloadLen = secondByte & 0x7F;
        const isMasked = (secondByte & 0x80) !== 0;
        if (payloadLen === 126) { frameSize = 4; payloadLen = buffer.readUInt16BE(2); }
        else if (payloadLen === 127) { frameSize = 10; payloadLen = Number(buffer.readBigUInt64BE(2)); }
        if (isMasked) frameSize += 4;
        frameSize += payloadLen;

        if (buffer.length < frameSize) break;

        if (frame.opcode === 0x8) {
          socket.end();
          return;
        }

        if (frame.opcode === 0x1 && frame.payload) {
          handleServerMessage(frame.payload, sendToRenderer);
        }

        buffer = buffer.slice(frameSize);
      }
    });

    socket.on('close', () => {
      handleDisconnect(sendToRenderer);
    });

    socket.on('error', (err: any) => {
      console.error('[LiveSync] Socket error:', err.message);
      handleDisconnect(sendToRenderer);
    });
  });

  req.on('error', (err: any) => {
    console.error('[LiveSync] Connection error:', err.message);
    if (state) state.lastError = err.message || 'Connection error';
    /* Notify renderer of error */
    sendToRenderer('live-sync:status', {
      connected: false,
      error: err.message,
      clientId: state?.clientId || '',
      vaultId: config.vaultId,
      serverUrl: config.serverUrl,
      connectedAt: null,
    });
    scheduleReconnect(sendToRenderer);
  });

  req.on('response', (res: any) => {
    const statusCode = res.statusCode || 0;
    const error = `WebSocket upgrade failed: HTTP ${statusCode}`;
    console.error('[LiveSync]', error);
    if (state) state.lastError = error;
    try { res.resume(); } catch { /* ignore */ }
    sendToRenderer('live-sync:status', {
      connected: false,
      error,
      clientId: state?.clientId || '',
      vaultId: config.vaultId,
      serverUrl: config.serverUrl,
      connectedAt: null,
    });
    scheduleReconnect(sendToRenderer);
  });

  req.end();
}

function wsSend(data: string): void {
  if (!state || !state.socket) return;
  const frame = createWebSocketFrame(data);
  state.socket.write(frame);
}

function emitActivity(sendToRenderer: (channel: string, data: any) => void, activity: LiveSyncActivity): void {
  if (state) state.lastActivity = activity;
  sendToRenderer('live-sync:activity', activity);
}

function rememberPreflightBlockedUpload(relPath: string): void {
  if (!state || !relPath) return;
  state.preflightBlockedUploadCount++;
  if (!state.preflightBlockedUploadFiles.includes(relPath) && state.preflightBlockedUploadFiles.length < PREFLIGHT_BLOCKED_FILE_LIMIT) {
    state.preflightBlockedUploadFiles.push(relPath);
  }
}

function freezeLiveUploads(reason: string, sendToRenderer: (channel: string, data: any) => void): void {
  if (!state) return;
  state.uploadFrozen = true;
  state.uploadFrozenReason = reason;
  state.preflightComplete = false;
  emitActivity(sendToRenderer, {
    direction: 'in',
    action: 'preflight-upload-frozen',
    relativePath: reason,
    timestamp: new Date().toISOString(),
  });
  sendToRenderer('live-sync:status', {
    connected: state.connected,
    clientId: state.clientId,
    vaultId: state.syncConfig.vaultId,
    serverUrl: state.syncConfig.serverUrl,
    connectionMode: normalizeLiveSyncConnectionMode(state.syncConfig.connectionMode),
    connectedAt: state.connectedAt,
    preflightComplete: state.preflightComplete,
    receivedRemoteSnapshot: state.receivedRemoteSnapshot,
    uploadFrozen: state.uploadFrozen,
    uploadFrozenReason: state.uploadFrozenReason,
    preflightBlockedUploadCount: state.preflightBlockedUploadCount,
    preflightBlockedUploadFiles: state.preflightBlockedUploadFiles.slice(0, PREFLIGHT_BLOCKED_FILE_LIMIT),
    deleteStormBlockedCount: state.deleteStormBlockedCount,
    deleteStormBlockedFiles: state.deleteStormBlockedFiles.slice(0, DELETE_STORM_BLOCKED_FILE_LIMIT),
    serverAuthorityAdoption: state.lastServerAuthorityAdoption,
  });
}

function clearLiveUploadFreeze(reasonPrefix?: string): void {
  if (!state) return;
  if (reasonPrefix && state.uploadFrozenReason && !state.uploadFrozenReason.startsWith(reasonPrefix)) return;
  state.uploadFrozen = false;
  state.uploadFrozenReason = '';
}

export function canSendLiveWriteAfterPreflight(input: {
  connected: boolean;
  socketReady: boolean;
  receivedRemoteSnapshot: boolean;
  preflightComplete: boolean;
  uploadFrozen: boolean;
}): boolean {
  return !!(input.connected && input.socketReady && input.receivedRemoteSnapshot && input.preflightComplete && !input.uploadFrozen);
}

export function shouldHoldMissingBaseQueuedWriteInJoin(input: {
  connectionMode?: LiveSyncConnectionMode | string;
  hasFileBaseline: boolean;
  queuedAfterPreflight: boolean;
  action: 'create' | 'update' | 'delete';
}): boolean {
  if (normalizeLiveSyncConnectionMode(input.connectionMode) !== 'join') return false;
  if (input.hasFileBaseline) return false;
  if (!input.queuedAfterPreflight) return true;
  return input.action !== 'create';
}

export function shouldGuardDestructiveTruncation(input: {
  action: 'create' | 'update' | 'delete';
  relativePath: string;
  previousSize: number;
  newSize: number;
  previousDeleted?: boolean;
}): boolean {
  if (input.action !== 'update' || input.previousDeleted) return false;
  const relPath = String(input.relativePath || '').replace(/\\/g, '/');
  if (!relPath || isConflictArtifact(relPath) || shouldSkipLiveHistorySnapshot(relPath)) return false;
  const ext = path.posix.extname(relPath.toLowerCase());
  if (!DELETE_SHADOW_EXTENSIONS.has(ext)) return false;

  const previousSize = Math.max(0, Math.floor(Number(input.previousSize) || 0));
  const newSize = Math.max(0, Math.floor(Number(input.newSize) || 0));
  if (previousSize < DESTRUCTIVE_TRUNCATION_MIN_PREVIOUS_BYTES) return false;
  if (newSize === 0) return true;
  return newSize <= DESTRUCTIVE_TRUNCATION_MAX_NEW_BYTES
    && newSize <= Math.floor(previousSize * DESTRUCTIVE_TRUNCATION_MAX_RATIO);
}

function canSendLiveWriteNow(): boolean {
  return !!(state && canSendLiveWriteAfterPreflight({
    connected: state.connected,
    socketReady: !!state.socket,
    receivedRemoteSnapshot: state.receivedRemoteSnapshot,
    preflightComplete: state.preflightComplete,
    uploadFrozen: state.uploadFrozen,
  }));
}

function emitLiveSyncStatus(sendToRenderer: (channel: string, data: any) => void): void {
  if (!state) return;
  sendToRenderer('live-sync:status', {
    connected: state.connected,
    clientId: state.clientId,
    vaultId: state.syncConfig.vaultId,
    serverUrl: state.syncConfig.serverUrl,
    connectionMode: normalizeLiveSyncConnectionMode(state.syncConfig.connectionMode),
    connectedAt: state.connectedAt,
    preflightComplete: state.preflightComplete,
    receivedRemoteSnapshot: state.receivedRemoteSnapshot,
    uploadFrozen: state.uploadFrozen,
    uploadFrozenReason: state.uploadFrozenReason,
    preflightBlockedUploadCount: state.preflightBlockedUploadCount,
    preflightBlockedUploadFiles: state.preflightBlockedUploadFiles.slice(0, PREFLIGHT_BLOCKED_FILE_LIMIT),
    deleteStormBlockedCount: state.deleteStormBlockedCount,
    deleteStormBlockedFiles: state.deleteStormBlockedFiles.slice(0, DELETE_STORM_BLOCKED_FILE_LIMIT),
  });
}

export function trustLocalSnapshotForInitialLiveSyncUpload(
  sendToRenderer: (channel: string, data: any) => void,
): { ok: boolean; error?: string; uploadedCount?: number; files?: string[]; reason?: string } {
  if (!state) return { ok: false, error: 'Live Sync is not running' };
  if (normalizeLiveSyncConnectionMode(state.syncConfig.connectionMode) !== 'rebuild') {
    return {
      ok: false,
      error: 'Refusing to initialize the server from this computer while connection mode is join. Switch to "rebuild server from this computer" and reconnect before publishing local data.',
    };
  }
  if (!state.connected || !state.socket) return { ok: false, error: 'Live Sync is not connected' };
  if (!state.receivedRemoteSnapshot) {
    return { ok: false, error: 'Waiting for the server snapshot before allowing any manual upload resume.' };
  }
  if (!state.uploadFrozen || state.uploadFrozenReason !== EMPTY_SERVER_INITIAL_UPLOAD_REASON) {
    return {
      ok: false,
      error: 'Initial upload is not blocked. This action is only available when the server is empty and local upload was paused.',
      reason: state.uploadFrozenReason,
    };
  }

  const localFiles = collectLocalFileSnapshots();
  clearLiveUploadFreeze(EMPTY_SERVER_INITIAL_UPLOAD_REASON);
  state.preflightComplete = true;
  state.queuedFilePushes.clear();
  state.preflightBlockedUploadCount = 0;
  state.preflightBlockedUploadFiles = [];

  let uploadedCount = 0;
  const files: string[] = [];
  for (const local of localFiles.values()) {
    pushLocalSnapshotFile(local, 'create', 'trusted-initial-local-upload', sendToRenderer);
    uploadedCount++;
    if (files.length < PREFLIGHT_BLOCKED_FILE_LIMIT) files.push(local.relativePath);
  }

  emitActivity(sendToRenderer, {
    direction: 'out',
    action: 'trusted-initial-local-upload',
    relativePath: `${uploadedCount} files`,
    timestamp: new Date().toISOString(),
  });
  emitLiveSyncStatus(sendToRenderer);

  return { ok: true, uploadedCount, files, reason: EMPTY_SERVER_INITIAL_UPLOAD_REASON };
}

export function resumeLiveSyncAfterStaleBaselineReview(
  sendToRenderer: (channel: string, data: any) => void,
): { ok: boolean; error?: string; reason?: string; clearedQueuedCount?: number } {
  if (!state) return { ok: false, error: 'Live Sync is not running' };
  if (!state.connected || !state.socket) return { ok: false, error: 'Live Sync is not connected' };
  if (!state.receivedRemoteSnapshot) {
    return { ok: false, error: 'Waiting for the server snapshot before allowing upload resume.', reason: state.uploadFrozenReason };
  }
  if (!state.uploadFrozen || !state.uploadFrozenReason.startsWith(STALE_BASELINE_UPLOAD_REASON)) {
    return {
      ok: false,
      error: 'Stale baseline review is not required right now.',
      reason: state.uploadFrozenReason,
    };
  }

  const reason = state.uploadFrozenReason;
  const clearedQueuedCount = state.queuedFilePushes.size;
  state.queuedFilePushes.clear();
  state.preflightBlockedUploadCount = 0;
  state.preflightBlockedUploadFiles = [];
  clearLiveUploadFreeze(STALE_BASELINE_UPLOAD_REASON);
  state.preflightComplete = true;

  emitActivity(sendToRenderer, {
    direction: 'out',
    action: 'stale-baseline-review-resumed',
    relativePath: `${clearedQueuedCount} queued writes cleared`,
    timestamp: new Date().toISOString(),
  });
  emitLiveSyncStatus(sendToRenderer);

  return { ok: true, reason, clearedQueuedCount };
}

export function resumeLiveSyncAfterDeleteStormReview(
  sendToRenderer: (channel: string, data: any) => void,
): {
  ok: boolean;
  error?: string;
  reason?: string;
  discardedQueuedDeletes?: number;
  heldDeleteCount?: number;
  heldDeleteFiles?: string[];
} {
  if (!state) return { ok: false, error: 'Live Sync is not running' };
  if (!state.connected || !state.socket) return { ok: false, error: 'Live Sync is not connected' };
  if (!state.receivedRemoteSnapshot) {
    return { ok: false, error: 'Waiting for the server snapshot before allowing upload resume.', reason: state.uploadFrozenReason };
  }
  if (!isDeleteStormFreezeActive()) {
    return {
      ok: false,
      error: 'Delete storm review is not required right now.',
      reason: state.uploadFrozenReason,
    };
  }

  const reason = state.uploadFrozenReason;
  const heldDeleteCount = state.deleteStormBlockedCount;
  const heldDeleteFiles = state.deleteStormBlockedFiles.slice(0, DELETE_STORM_BLOCKED_FILE_LIMIT);
  let discardedQueuedDeletes = 0;
  for (const [relPath, item] of Array.from(state.queuedFilePushes.entries())) {
    if (item.action !== 'delete') continue;
    state.queuedFilePushes.delete(relPath);
    discardedQueuedDeletes++;
  }

  state.deleteGuardTimestamps = [];
  state.deleteStormBlockedCount = 0;
  state.deleteStormBlockedFiles = [];
  clearLiveUploadFreeze('delete-storm-guard');
  state.preflightComplete = true;

  emitActivity(sendToRenderer, {
    direction: 'out',
    action: 'delete-storm-review-resumed',
    relativePath: `${heldDeleteCount} held deletes, ${discardedQueuedDeletes} queued deletes discarded`,
    timestamp: new Date().toISOString(),
  });
  emitLiveSyncStatus(sendToRenderer);
  flushQueuedFilePushes(sendToRenderer);

  return { ok: true, reason, discardedQueuedDeletes, heldDeleteCount, heldDeleteFiles };
}

export function resumeLiveSyncAfterDestructiveTruncationReview(
  sendToRenderer: (channel: string, data: any) => void,
): { ok: boolean; error?: string; reason?: string; clearedQueuedCount?: number; heldFiles?: string[] } {
  if (!state) return { ok: false, error: 'Live Sync is not running' };
  if (!state.connected || !state.socket) return { ok: false, error: 'Live Sync is not connected' };
  if (!state.receivedRemoteSnapshot) {
    return { ok: false, error: 'Waiting for the server snapshot before allowing upload resume.', reason: state.uploadFrozenReason };
  }
  if (!state.uploadFrozen || !state.uploadFrozenReason.startsWith(DESTRUCTIVE_TRUNCATION_GUARD_REASON)) {
    return {
      ok: false,
      error: 'Destructive truncation review is not required right now.',
      reason: state.uploadFrozenReason,
    };
  }

  const reason = state.uploadFrozenReason;
  const heldFiles = state.preflightBlockedUploadFiles.slice(0, PREFLIGHT_BLOCKED_FILE_LIMIT);
  const clearedQueuedCount = state.queuedFilePushes.size;
  state.queuedFilePushes.clear();
  state.preflightBlockedUploadCount = 0;
  state.preflightBlockedUploadFiles = [];
  clearLiveUploadFreeze(DESTRUCTIVE_TRUNCATION_GUARD_REASON);
  state.preflightComplete = true;

  emitActivity(sendToRenderer, {
    direction: 'out',
    action: 'destructive-truncation-review-resumed',
    relativePath: `${clearedQueuedCount} queued writes cleared`,
    timestamp: new Date().toISOString(),
  });
  emitLiveSyncStatus(sendToRenderer);
  flushQueuedFilePushes(sendToRenderer);

  return { ok: true, reason, clearedQueuedCount, heldFiles };
}

function remoteFileBase(file: any): { sha256: string; deleted: boolean; updatedAt: string; size: number } {
  const deleted = !!file?.deleted;
  return {
    sha256: deleted ? '' : String(file?.sha256 || ''),
    deleted,
    updatedAt: String(file?.updatedAt || file?.timestamp || ''),
    size: deleted ? 0 : Math.max(0, Math.floor(Number(file?.size) || 0)),
  };
}

function safeServerDeleteQueuePath(): string | null {
  if (!state?.vaultPath) return null;
  return path.join(state.vaultPath, ARS_NOTE_DIR, SAFE_SERVER_DELETE_QUEUE_FILE);
}

function aiServerDeleteHoldPath(): string | null {
  if (!state?.vaultPath) return null;
  return path.join(state.vaultPath, ARS_NOTE_DIR, AI_SERVER_DELETE_HOLD_FILE);
}

function safeDeleteQueueItemId(vaultId: string, relPath: string, remote: any): string {
  return crypto.createHash('sha1')
    .update([
      vaultId,
      relPath,
      String(remote?.sha256 || ''),
      String(remote?.updatedAt || remote?.timestamp || ''),
      String(remote?.serverRevision || ''),
      String(remote?.revisionId || ''),
    ].join('\0'))
    .digest('hex');
}

function normalizeSafeDeleteQueueItem(raw: any, vaultId: string): SafeServerDeleteQueueItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const relativePath = String(raw.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!relativePath || relativePath.includes('\0') || relativePath.split('/').includes('..')) return null;
  const itemVaultId = String(raw.vaultId || vaultId || '').trim();
  if (!itemVaultId || (vaultId && itemVaultId !== vaultId)) return null;
  const serverRevision = Number(raw.serverRevision);
  return {
    id: String(raw.id || safeDeleteQueueItemId(itemVaultId, relativePath, raw)).replace(/[^\w.-]+/g, '').slice(0, 80),
    vaultId: itemVaultId,
    relativePath,
    sha256: String(raw.sha256 || ''),
    size: Math.max(0, Math.floor(Number(raw.size) || 0)),
    updatedAt: String(raw.updatedAt || ''),
    serverRevision: Number.isFinite(serverRevision) && serverRevision > 0 ? Math.floor(serverRevision) : undefined,
    revisionId: typeof raw.revisionId === 'string' && raw.revisionId ? raw.revisionId : undefined,
    queuedAt: String(raw.queuedAt || new Date().toISOString()),
    source: raw.source === 'manual' || raw.source === 'ai-delete' ? raw.source : 'local-authority-rebuild',
    reason: String(raw.reason || 'server-delete-requires-review').slice(0, 200),
  };
}

function normalizeAIServerDeleteHoldItem(raw: any): AIServerDeleteHoldItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const relativePath = String(raw.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!relativePath || relativePath.includes('\0') || relativePath.split('/').includes('..')) return null;
  if (isLiveSyncIgnoredPath(relativePath) || isConflictArtifact(relativePath)) return null;
  return {
    relativePath,
    sha256: typeof raw.sha256 === 'string' ? raw.sha256 : undefined,
    size: Math.max(0, Math.floor(Number(raw.size) || 0)),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
    deletedAt: typeof raw.deletedAt === 'string' ? raw.deletedAt : undefined,
    recoveryPath: typeof raw.recoveryPath === 'string' ? raw.recoveryPath : undefined,
    reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 240) : undefined,
    source: typeof raw.source === 'string' ? raw.source : undefined,
  };
}

function readAIServerDeleteHolds(): AIServerDeleteHoldItem[] {
  const filePath = aiServerDeleteHoldPath();
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const items = Array.isArray(raw?.items) ? raw.items : (Array.isArray(raw) ? raw : []);
    return items
      .map((item: any) => normalizeAIServerDeleteHoldItem(item))
      .filter((item: AIServerDeleteHoldItem | null): item is AIServerDeleteHoldItem => !!item);
  } catch {
    return [];
  }
}

function writeAIServerDeleteHolds(items: AIServerDeleteHoldItem[]): void {
  const filePath = aiServerDeleteHoldPath();
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    items,
  }, null, 2), 'utf-8');
}

function consumeAIServerDeleteHold(relPath: string): AIServerDeleteHoldItem | null {
  const normalized = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) return null;
  const items = readAIServerDeleteHolds();
  const index = items.findIndex((item) => item.relativePath === normalized);
  if (index < 0) return null;
  const [item] = items.splice(index, 1);
  writeAIServerDeleteHolds(items);
  return item || null;
}

function readSafeServerDeleteQueue(): SafeServerDeleteQueueItem[] {
  const filePath = safeServerDeleteQueuePath();
  const vaultId = state?.syncConfig.vaultId || '';
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const items = Array.isArray(raw?.items) ? raw.items : (Array.isArray(raw) ? raw : []);
    return items
      .map((item: any) => normalizeSafeDeleteQueueItem(item, vaultId))
      .filter((item: SafeServerDeleteQueueItem | null): item is SafeServerDeleteQueueItem => !!item)
      .sort((a: SafeServerDeleteQueueItem, b: SafeServerDeleteQueueItem) => a.queuedAt.localeCompare(b.queuedAt));
  } catch {
    return [];
  }
}

function writeSafeServerDeleteQueue(items: SafeServerDeleteQueueItem[]): void {
  const filePath = safeServerDeleteQueuePath();
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({
    version: 1,
    vaultId: state?.syncConfig.vaultId || '',
    updatedAt: new Date().toISOString(),
    items,
  }, null, 2), 'utf-8');
}

function queueSafeServerDeletes(
  deleteJobs: Array<[string, any]>,
  source: SafeServerDeleteQueueItem['source'],
  reason = 'Remote file is absent from the selected local-authority computer. Review before deleting from server.',
): SafeServerDeleteQueueItem[] {
  if (!state) return [];
  const existing = readSafeServerDeleteQueue();
  const byPath = new Map(existing.map((item) => [item.relativePath, item]));
  const queued: SafeServerDeleteQueueItem[] = [];
  const queuedAt = new Date().toISOString();

  for (const [relPath, remote] of deleteJobs) {
    const relativePath = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!relativePath || remote?.deleted) continue;
    const item: SafeServerDeleteQueueItem = {
      id: safeDeleteQueueItemId(state.syncConfig.vaultId || '', relativePath, remote),
      vaultId: state.syncConfig.vaultId || '',
      relativePath,
      sha256: String(remote?.sha256 || ''),
      size: Math.max(0, Math.floor(Number(remote?.size) || 0)),
      updatedAt: String(remote?.updatedAt || remote?.timestamp || ''),
      serverRevision: baselineMetadataFrom(remote).serverRevision,
      revisionId: baselineMetadataFrom(remote).revisionId,
      queuedAt,
      source,
      reason,
    };
    byPath.set(relativePath, item);
    queued.push(item);
  }

  writeSafeServerDeleteQueue(Array.from(byPath.values()).sort((a, b) => a.relativePath.localeCompare(b.relativePath)));
  return queued;
}

function publishAIServerDelete(
  relPath: string,
  hold: AIServerDeleteHoldItem,
  shadow: DeleteShadowSnapshot | PendingUnlink | undefined,
  sendToRenderer: (channel: string, data: any) => void,
): boolean {
  if (!state) return false;
  const baseline = readLiveBaseline();
  const baselineEntry = baseline.files[relPath];
  const remoteEntry = state.lastRemoteFiles.get(relPath);
  const fallbackBase = {
    sha256: hold.sha256 || shadow?.sha256 || '',
    deleted: false,
    size: Number(hold.size || shadow?.size || 0),
    updatedAt: hold.updatedAt || baselineEntry?.updatedAt || '',
  };
  const base = remoteEntry
    ? remoteFileBase(remoteEntry)
    : (baselineEntry ? baselineForChange(relPath) : fallbackBase);

  if (!canSendLiveWriteNow()) {
    queueFilePush(relPath, 'delete', '', '');
    emitActivity(sendToRenderer, {
      direction: 'out',
      action: 'ai-delete-queued',
      relativePath: relPath,
      timestamp: new Date().toISOString(),
    });
    emitLiveSyncStatus(sendToRenderer);
    return true;
  }

  sendFileChange(
    relPath,
    'delete',
    '',
    '',
    'ai-delete',
    sendToRenderer,
    new Date().toISOString(),
    base,
  );
  emitLiveSyncStatus(sendToRenderer);
  return true;
}

export function getLiveSyncSafeDeleteQueue(): { ok: boolean; items: SafeServerDeleteQueueItem[]; count: number; error?: string } {
  if (!state) return { ok: false, items: [], count: 0, error: 'Live Sync is not running' };
  const items = readSafeServerDeleteQueue();
  return { ok: true, items, count: items.length };
}

export function clearLiveSyncSafeDeleteQueue(ids?: string[]): { ok: boolean; clearedCount: number; remainingCount: number; error?: string } {
  if (!state) return { ok: false, clearedCount: 0, remainingCount: 0, error: 'Live Sync is not running' };
  const wanted = new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean));
  const items = readSafeServerDeleteQueue();
  const remaining = wanted.size > 0 ? items.filter((item) => !wanted.has(item.id)) : [];
  writeSafeServerDeleteQueue(remaining);
  return { ok: true, clearedCount: items.length - remaining.length, remainingCount: remaining.length };
}

export function applyLiveSyncSafeDeleteQueue(
  sendToRenderer: (channel: string, data: any) => void,
  options: { ids?: string[]; deleteDelayMs?: number } = {},
): { ok: boolean; error?: string; appliedCount?: number; skippedCount?: number; staleCount?: number; remainingCount?: number; files?: string[] } {
  if (!state) return { ok: false, error: 'Live Sync is not running' };
  if (!state.connected || !state.socket) return { ok: false, error: 'Live Sync is not connected' };
  if (!state.receivedRemoteSnapshot) return { ok: false, error: 'Waiting for the server snapshot before applying safe deletes.' };

  const wanted = new Set((Array.isArray(options.ids) ? options.ids : []).map(String).filter(Boolean));
  const queue = readSafeServerDeleteQueue();
  const selected = wanted.size > 0 ? queue.filter((item) => wanted.has(item.id)) : queue;
  const appliedIds = new Set<string>();
  const files: string[] = [];
  let skippedCount = 0;
  let staleCount = 0;

  selected.forEach((item) => {
    const remote = state?.lastRemoteFiles.get(item.relativePath);
    if (!remote || remote.deleted) {
      skippedCount++;
      appliedIds.add(item.id);
      return;
    }
    const remoteSha = String(remote.sha256 || '');
    const remoteUpdatedAt = String(remote.updatedAt || remote.timestamp || '');
    const sameRevision = item.revisionId && remote.revisionId
      ? item.revisionId === remote.revisionId
      : true;
    if ((item.sha256 && remoteSha && item.sha256 !== remoteSha) || (item.updatedAt && remoteUpdatedAt && item.updatedAt !== remoteUpdatedAt) || !sameRevision) {
      staleCount++;
      return;
    }

    if (!state || !state.socket) return;
    sendFileChange(
      item.relativePath,
      'delete',
      '',
      '',
      'safe-delete-queue',
      sendToRenderer,
      new Date().toISOString(),
      remoteFileBase(remote),
      'safe-delete-queue',
    );
    appliedIds.add(item.id);
    if (files.length < PREFLIGHT_BLOCKED_FILE_LIMIT) files.push(item.relativePath);
  });

  const remaining = queue.filter((item) => !appliedIds.has(item.id));
  writeSafeServerDeleteQueue(remaining);
  emitActivity(sendToRenderer, {
    direction: 'out',
    action: 'safe-delete-queue-applied',
    relativePath: `${appliedIds.size} delete / ${staleCount} stale / ${skippedCount} already gone`,
    timestamp: new Date().toISOString(),
  });
  emitLiveSyncStatus(sendToRenderer);

  return {
    ok: true,
    appliedCount: appliedIds.size,
    skippedCount,
    staleCount,
    remainingCount: remaining.length,
    files,
  };
}

function normalizeAuthorityScopePrefixes(input: any): string[] {
  const raw = Array.isArray(input?.scopePrefixes)
    ? input.scopePrefixes
    : (typeof input?.scopePrefix === 'string' ? [input.scopePrefix] : []);
  return raw
    .map((value: any) => String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter((value: string) => value && !value.split('/').includes('..'));
}

function isInsideAuthorityScope(relPath: string, prefixes: string[]): boolean {
  if (prefixes.length === 0) return true;
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return prefixes.some(prefix => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

export function publishLocalSnapshotAsServerAuthority(
  sendToRenderer: (channel: string, data: any) => void,
  options: {
    includeCreates?: boolean;
    includeUpdates?: boolean;
    includeDeletes?: boolean;
    scopePrefix?: string;
    scopePrefixes?: string[];
    deleteDelayMs?: number;
  } = {},
): {
  ok: boolean;
  error?: string;
  createdCount?: number;
  updatedCount?: number;
  deletedCount?: number;
  scheduledDeleteCount?: number;
    matchedCount?: number;
    queuedDeleteCount?: number;
    files?: string[];
} {
  if (!state) return { ok: false, error: 'Live Sync is not running' };
  if (normalizeLiveSyncConnectionMode(state.syncConfig.connectionMode) !== 'rebuild') {
    return {
      ok: false,
      error: 'Refusing to publish this computer as server authority while connection mode is join. Switch to "rebuild server from this computer" and reconnect before this dangerous operation.',
    };
  }
  if (!state.connected || !state.socket) return { ok: false, error: 'Live Sync is not connected' };
  if (!state.receivedRemoteSnapshot || state.lastRemoteFiles.size === 0) {
    return { ok: false, error: 'Waiting for the server snapshot before publishing local authority.' };
  }

  const includeCreates = options.includeCreates !== false;
  const includeUpdates = options.includeUpdates !== false;
  const includeDeletes = options.includeDeletes !== false;
  const scopePrefixes = normalizeAuthorityScopePrefixes(options);
  const localFiles = collectLocalFileSnapshots();
  const remoteFiles = new Map(state.lastRemoteFiles);
  const files: string[] = [];
  let createdCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;
  let matchedCount = 0;
  let queuedDeleteCount = 0;

  clearLiveUploadFreeze();
  state.preflightComplete = true;
  state.preflightBlockedUploadCount = 0;
  state.preflightBlockedUploadFiles = [];
  state.queuedFilePushes.clear();

  for (const [relPath, local] of localFiles) {
    if (!isInsideAuthorityScope(relPath, scopePrefixes)) continue;
    const remote = remoteFiles.get(relPath);
    remoteFiles.delete(relPath);

    if (remote && !remote.deleted && String(remote.sha256 || '') === local.sha256) {
      markBaselineSynced(relPath, local.sha256, false, remote.updatedAt || remote.timestamp, local.size, baselineMetadataFrom(remote));
      matchedCount++;
      continue;
    }

    const action = !remote || remote.deleted ? 'create' : 'update';
    if ((action === 'create' && !includeCreates) || (action === 'update' && !includeUpdates)) continue;

    try {
      const content = fs.readFileSync(local.fullPath);
      const sha256 = crypto.createHash('sha256').update(content).digest('hex');
      sendFileChange(
        relPath,
        action,
        content.toString('base64'),
        sha256,
        'local-authority-publish',
        sendToRenderer,
        new Date().toISOString(),
        remote ? remoteFileBase(remote) : { sha256: '', deleted: false, updatedAt: '', size: 0 },
      );
      if (action === 'create') createdCount++;
      else updatedCount++;
      if (files.length < PREFLIGHT_BLOCKED_FILE_LIMIT) files.push(`${action}: ${relPath}`);
    } catch (err: any) {
      console.error('[LiveSync] Failed to publish authoritative local file:', relPath, err.message);
    }
  }

  if (includeDeletes) {
    const deleteJobs = Array.from(remoteFiles.entries())
      .filter(([relPath, remote]) => isInsideAuthorityScope(relPath, scopePrefixes) && remote && !remote.deleted);
    const queuedDeletes = queueSafeServerDeletes(deleteJobs, 'local-authority-rebuild');
    queuedDeleteCount = queuedDeletes.length;
    deletedCount = queuedDeleteCount;
    queuedDeletes.forEach((item) => {
      if (files.length < PREFLIGHT_BLOCKED_FILE_LIMIT) files.push(`queue-delete: ${item.relativePath}`);
    });
  }

  emitActivity(sendToRenderer, {
    direction: 'out',
    action: 'local-authority-publish',
    relativePath: `${createdCount} create / ${updatedCount} update / ${queuedDeleteCount} queued delete / ${matchedCount} same`,
    timestamp: new Date().toISOString(),
  });
  emitLiveSyncStatus(sendToRenderer);

  return {
    ok: true,
    createdCount,
    updatedCount,
    deletedCount,
    scheduledDeleteCount: queuedDeleteCount,
    queuedDeleteCount,
    matchedCount,
    files,
  };
}

function isDeleteStormFreezeActive(): boolean {
  return !!(state?.uploadFrozen && state.uploadFrozenReason.startsWith('delete-storm-guard'));
}

export function shouldTriggerDeleteStormGuard(
  timestamps: number[],
  now = Date.now(),
  threshold = DELETE_STORM_THRESHOLD,
  windowMs = DELETE_STORM_WINDOW_MS,
): boolean {
  const cutoff = now - Math.max(1, windowMs);
  return timestamps.filter((ts) => Number.isFinite(ts) && ts >= cutoff && ts <= now + 1000).length >= Math.max(1, threshold);
}

function rememberDeleteStormBlocked(relPath: string): void {
  if (!state || !relPath) return;
  state.deleteStormBlockedCount++;
  if (!state.deleteStormBlockedFiles.includes(relPath) && state.deleteStormBlockedFiles.length < DELETE_STORM_BLOCKED_FILE_LIMIT) {
    state.deleteStormBlockedFiles.push(relPath);
  }
  rememberPreflightBlockedUpload(relPath);
}

function recordLocalDeleteForStormGuard(relPath: string, sendToRenderer: (channel: string, data: any) => void): boolean {
  if (!state || !relPath) return false;
  const now = Date.now();
  const cutoff = now - DELETE_STORM_WINDOW_MS;
  state.deleteGuardTimestamps = state.deleteGuardTimestamps.filter((ts) => ts >= cutoff);
  state.deleteGuardTimestamps.push(now);

  const shouldFreeze = isDeleteStormFreezeActive() || shouldTriggerDeleteStormGuard(state.deleteGuardTimestamps, now);
  if (AUTO_SYNC_DELETE_STORMS) {
    if (shouldFreeze && !isDeleteStormFreezeActive()) {
      emitActivity(sendToRenderer, {
        direction: 'out',
        action: 'delete-storm-auto-sync',
        relativePath: `${state.deleteGuardTimestamps.length} deletes in ${Math.round(DELETE_STORM_WINDOW_MS / 1000)}s`,
        timestamp: new Date().toISOString(),
      });
    }
    return false;
  }
  if (!shouldFreeze) return false;

  if (!isDeleteStormFreezeActive()) {
    freezeLiveUploads(`delete-storm-guard:${state.deleteGuardTimestamps.length} deletes in ${Math.round(DELETE_STORM_WINDOW_MS / 1000)}s`, sendToRenderer);
    emitActivity(sendToRenderer, {
      direction: 'in',
      action: 'delete-storm-guard',
      relativePath: relPath,
      timestamp: new Date().toISOString(),
    });
  }
  rememberDeleteStormBlocked(relPath);
  return true;
}

function rememberLocalPush(relPath: string, sha256: string, size = 0): void {
  if (!state || !relPath || !sha256) return;
  const now = Date.now();
  state.recentLocalPushes.set(relPath, { sha256, size: Math.max(0, Math.floor(Number(size) || 0)), at: now });

  for (const [pathKey, info] of state.recentLocalPushes) {
    if (now - info.at > 30000) {
      state.recentLocalPushes.delete(pathKey);
    }
  }
}

function sendFileChange(
  relPath: string,
  action: 'create' | 'update' | 'delete',
  contentBase64: string,
  sha256: string,
  activityAction: string,
  sendToRenderer: (channel: string, data: any) => void,
  updatedAt = new Date().toISOString(),
  base = baselineForChange(relPath),
  mutationSource = activityAction,
): void {
  const baseline = readLiveBaseline();
  const snapshotReceivedAt = state?.lastRemoteSnapshotReceivedAt || state?.connectedAt || new Date().toISOString();
  const snapshotProofReady = !!(state?.receivedRemoteSnapshot && (state.preflightComplete || state.snapshotReconcileInProgress));
  wsSend(JSON.stringify({
    type: 'file-change',
    protocolVersion: LIVE_SYNC_CLIENT_PROTOCOL_VERSION,
    relativePath: relPath,
    action,
    contentBase64,
    sha256,
    size: contentBase64 ? Buffer.byteLength(contentBase64, 'base64') : 0,
    updatedAt,
    clientHasServerSnapshot: snapshotProofReady,
    clientPreflightComplete: snapshotProofReady,
    clientSnapshotReceivedAt: snapshotProofReady ? snapshotReceivedAt : '',
    clientSnapshotFileCount: state?.lastRemoteFiles?.size || 0,
    clientBaselineUpdatedAt: snapshotProofReady ? (baseline.updatedAt || base.updatedAt || snapshotReceivedAt) : '',
    clientConnectionMode: normalizeLiveSyncConnectionMode(state?.syncConfig.connectionMode),
    clientMutationSource: mutationSource,
    baseSha256: base.sha256,
    baseDeleted: base.deleted,
    baseUpdatedAt: base.updatedAt,
    baseSize: base.size,
    baseServerRevision: base.serverRevision,
    baseRevisionId: base.revisionId,
  }));

  rememberLocalPush(relPath, sha256, contentBase64 ? Buffer.byteLength(contentBase64, 'base64') : 0);

  emitActivity(sendToRenderer, {
    direction: 'out',
    action: activityAction,
    relativePath: relPath,
    timestamp: new Date().toISOString(),
  });
}

function queueFilePush(relPath: string, action: 'create' | 'update' | 'delete', contentBase64: string, sha256: string, updatedAt = new Date().toISOString()): void {
  if (!state) return;
  const base = baselineForChange(relPath);
  const existing = state.queuedFilePushes.get(relPath);
  const safeAction = existing?.action === 'create' && action === 'update' ? 'create' : action;
  state.queuedFilePushes.set(relPath, {
    action: safeAction,
    contentBase64,
    sha256,
    size: contentBase64 ? Buffer.byteLength(contentBase64, 'base64') : 0,
    updatedAt,
    queuedAfterPreflight: !!(state.receivedRemoteSnapshot && state.preflightComplete),
    baseSha256: base.sha256,
    baseDeleted: base.deleted,
    baseUpdatedAt: base.updatedAt,
    baseSize: base.size,
    baseServerRevision: base.serverRevision,
    baseRevisionId: base.revisionId,
    queuedAt: new Date().toISOString(),
  });
}

function collectAiMemoryLiveManifestEntries(): string[] {
  const entries: string[] = [];
  if (!state) return entries;

  const aiDir = path.join(state.vaultPath, AI_MEMORY_DIR);
  if (!fs.existsSync(aiDir)) return entries;

  function walk(dir: string): void {
    let dirEntries: fs.Dirent[];
    try {
      dirEntries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of dirEntries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const relToAiMemory = path.relative(aiDir, fullPath).replace(/\\/g, '/');
      if (!relToAiMemory || path.posix.basename(relToAiMemory) === AI_MEMORY_LIVE_MANIFEST_FILE) continue;
      if (!isPortableAiMemoryPath(`${AI_MEMORY_DIR}/${relToAiMemory}`)) continue;
      entries.push(relToAiMemory);
    }
  }

  walk(aiDir);
  return entries.sort((a, b) => a.localeCompare(b));
}

function writeAiMemoryLiveManifest(): { action: 'create' | 'update'; contentBase64: string; sha256: string } | null {
  if (!state) return null;

  const aiDir = path.join(state.vaultPath, AI_MEMORY_DIR);
  const manifestPath = path.join(aiDir, AI_MEMORY_LIVE_MANIFEST_FILE);
  if (!fs.existsSync(aiDir)) return null;

  const files = collectAiMemoryLiveManifestEntries();
  const existed = fs.existsSync(manifestPath);
  if (files.length === 0 && !existed) return null;

  const content = `${JSON.stringify({
    version: 1,
    scope: AI_MEMORY_DIR,
    files,
  }, null, 2)}\n`;

  try {
    if (existed && fs.readFileSync(manifestPath, 'utf-8') === content) {
      return null;
    }

    fs.mkdirSync(aiDir, { recursive: true });
    state.pendingChanges.add(AI_MEMORY_LIVE_MANIFEST_PATH);
    fs.writeFileSync(manifestPath, content, 'utf-8');
    setTimeout(() => {
      state?.pendingChanges.delete(AI_MEMORY_LIVE_MANIFEST_PATH);
    }, 3000);

    const buffer = Buffer.from(content, 'utf-8');
    return {
      action: existed ? 'update' : 'create',
      contentBase64: buffer.toString('base64'),
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    };
  } catch (err: any) {
    console.error('[LiveSync] Failed to write AI memory manifest:', err.message);
    state.pendingChanges.delete(AI_MEMORY_LIVE_MANIFEST_PATH);
    return null;
  }
}

function publishAiMemoryLiveManifest(sendToRenderer: (channel: string, data: any) => void): void {
  if (!state) return;

  const manifest = writeAiMemoryLiveManifest();
  if (!manifest) return;

  if (!canSendLiveWriteNow()) {
    queueFilePush(AI_MEMORY_LIVE_MANIFEST_PATH, manifest.action, manifest.contentBase64, manifest.sha256);
    return;
  }

  sendFileChange(
    AI_MEMORY_LIVE_MANIFEST_PATH,
    manifest.action,
    manifest.contentBase64,
    manifest.sha256,
    'ai-memory-manifest',
    sendToRenderer,
  );
}

function safeHistoryPathPart(value: string): string {
  return value.replace(/\\/g, '/').split('/').map(part => encodeURIComponent(part)).join('/');
}

function isDeleteShadowEligible(relPath: string, size: number): boolean {
  if (!relPath || isConflictArtifact(relPath) || shouldSkipLiveHistorySnapshot(relPath)) return false;
  if (!Number.isFinite(size) || size <= 0 || size > DELETE_SHADOW_MAX_FILE_BYTES) return false;
  const ext = path.posix.extname(relPath.toLowerCase());
  return DELETE_SHADOW_EXTENSIONS.has(ext);
}

function rememberDeleteShadow(relPath: string, content: Buffer, sha256: string, updatedAt: string): void {
  if (!state || !isDeleteShadowEligible(relPath, content.length)) return;

  const previous = state.deleteShadowCache.get(relPath);
  if (previous) {
    state.deleteShadowTotalBytes = Math.max(0, state.deleteShadowTotalBytes - previous.size);
  }

  const item: DeleteShadowSnapshot = {
    relativePath: relPath,
    sha256,
    size: content.length,
    updatedAt,
    capturedAt: Date.now(),
    contentBase64: content.toString('base64'),
  };
  state.deleteShadowCache.set(relPath, item);
  state.deleteShadowTotalBytes += item.size;

  if (state.deleteShadowTotalBytes <= DELETE_SHADOW_MAX_TOTAL_BYTES) return;

  const entries = Array.from(state.deleteShadowCache.entries())
    .sort((a, b) => a[1].capturedAt - b[1].capturedAt);
  for (const [key, value] of entries) {
    if (state.deleteShadowTotalBytes <= DELETE_SHADOW_MAX_TOTAL_BYTES) break;
    state.deleteShadowCache.delete(key);
    state.deleteShadowTotalBytes = Math.max(0, state.deleteShadowTotalBytes - value.size);
  }
}

function forgetDeleteShadow(relPath: string): void {
  if (!state) return;
  const previous = state.deleteShadowCache.get(relPath);
  if (!previous) return;
  state.deleteShadowCache.delete(relPath);
  state.deleteShadowTotalBytes = Math.max(0, state.deleteShadowTotalBytes - previous.size);
}

function saveLiveHistoryBuffer(relPath: string, content: Buffer, reason: string, sha256?: string): boolean {
  if (!state || !relPath || content.length === 0 || isConflictArtifact(relPath) || shouldSkipLiveHistorySnapshot(relPath)) return false;
  try {
    const historyFileDir = path.join(state.vaultPath, ARS_NOTE_DIR, LIVE_HISTORY_DIR, safeHistoryPathPart(relPath));
    fs.mkdirSync(historyFileDir, { recursive: true });
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const contentSha = sha256 || crypto.createHash('sha256').update(content).digest('hex');
    const record = {
      versionId: stamp,
      relativePath: relPath,
      savedAt: now.toISOString(),
      reason,
      deletedSnapshot: /delete|remove|trash|unlink|删除|移除/i.test(reason),
      size: content.length,
      sha256: contentSha,
      contentBase64: content.toString('base64'),
    };
    fs.writeFileSync(path.join(historyFileDir, `${stamp}.json`), JSON.stringify(record, null, 2), 'utf-8');
    pruneHistoryVersions(historyFileDir);
    return true;
  } catch (err: any) {
    console.error('[LiveSync] Failed to save history buffer:', relPath, err.message);
    return false;
  }
}

function saveDeleteShadowHistory(
  relPath: string,
  shadow: { contentBase64?: string; sha256?: string } | undefined,
  reason = 'local-delete-shadow',
): boolean {
  if (!shadow?.contentBase64) return false;
  try {
    const content = Buffer.from(shadow.contentBase64, 'base64');
    return saveLiveHistoryBuffer(relPath, content, reason, shadow.sha256);
  } catch {
    return false;
  }
}

function holdDeleteStormWrite(
  relPath: string,
  shadow: { contentBase64?: string; sha256?: string } | undefined,
  sendToRenderer: (channel: string, data: any) => void,
): void {
  if (!state) return;
  saveDeleteShadowHistory(relPath, shadow, 'delete-storm-held');
  forgetDeleteShadow(relPath);
  state.queuedFilePushes.delete(relPath);
  emitActivity(sendToRenderer, {
    direction: 'in',
    action: 'delete-storm-held',
    relativePath: relPath,
    timestamp: new Date().toISOString(),
  });
}

function holdDestructiveTruncationWrite(
  relPath: string,
  fullPath: string,
  newContent: Buffer,
  newSha256: string,
  previousShadow: DeleteShadowSnapshot | undefined,
  previousBaseline: SyncedFileState | undefined,
  sendToRenderer: (channel: string, data: any) => void,
): void {
  if (!state) return;

  state.queuedFilePushes.delete(relPath);

  if (newContent.length > 0) {
    writeIncomingConflictCopy(fullPath, newContent, relPath, sendToRenderer);
    saveLiveHistoryBuffer(relPath, newContent, 'destructive-truncation-guard-held', newSha256);
  }

  let restored = false;
  if (previousShadow?.contentBase64) {
    try {
      const previousContent = Buffer.from(previousShadow.contentBase64, 'base64');
      if (previousContent.length > 0) {
        saveDeleteShadowHistory(relPath, previousShadow, 'destructive-truncation-guard-before');
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        state.pendingChanges.add(relPath);
        fs.writeFileSync(fullPath, previousContent);
        rememberDeleteShadow(relPath, previousContent, previousShadow.sha256, previousShadow.updatedAt);
        restored = true;
        clearPendingChangeSoon(relPath);
      }
    } catch (err: any) {
      state.pendingChanges.delete(relPath);
      console.error('[LiveSync] Failed to restore guarded truncation:', relPath, err.message);
    }
  }

  if (!restored) {
    const updatedAt = new Date().toISOString();
    const snapshotProofReady = !!(
      state.connected
      && state.socket
      && state.receivedRemoteSnapshot
      && (state.preflightComplete || state.snapshotReconcileInProgress)
    );
    if (snapshotProofReady) {
      sendFileChange(
        relPath,
        'update',
        newContent.toString('base64'),
        newSha256,
        'destructive-truncation-auto-review',
        sendToRenderer,
        updatedAt,
        baselineForChange(relPath),
      );
    } else {
      queueFilePush(relPath, 'update', newContent.toString('base64'), newSha256, updatedAt);
    }
  }
  emitActivity(sendToRenderer, {
    direction: 'in',
    action: restored ? 'destructive-truncation-restored' : 'destructive-truncation-auto-review',
    relativePath: `${relPath} ${newContent.length}B from ${previousShadow?.size || previousBaseline?.size || 0}B`,
    timestamp: new Date().toISOString(),
  });
  emitLiveSyncStatus(sendToRenderer);
}

function pruneHistoryVersions(historyFileDir: string): void {
  try {
    const versions = fs.readdirSync(historyFileDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => entry.name)
      .sort();
    if (versions.length <= MAX_HISTORY_VERSIONS) return;
    for (const name of versions.slice(0, versions.length - MAX_HISTORY_VERSIONS)) {
      fs.unlinkSync(path.join(historyFileDir, name));
    }
  } catch { /* best effort */ }
}

function saveLiveHistoryVersion(relPath: string, fullPath: string, reason: string): void {
  if (!state || !fs.existsSync(fullPath) || isConflictArtifact(relPath) || shouldSkipLiveHistorySnapshot(relPath)) return;
  try {
    const content = fs.readFileSync(fullPath);
    const historyFileDir = path.join(state.vaultPath, ARS_NOTE_DIR, LIVE_HISTORY_DIR, safeHistoryPathPart(relPath));
    fs.mkdirSync(historyFileDir, { recursive: true });
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const record = {
      versionId: stamp,
      relativePath: relPath,
      savedAt: now.toISOString(),
      reason,
      deletedSnapshot: /delete|remove|trash|unlink|删除|移除/i.test(reason),
      size: content.length,
      sha256,
      contentBase64: content.toString('base64'),
    };
    fs.writeFileSync(path.join(historyFileDir, `${stamp}.json`), JSON.stringify(record, null, 2), 'utf-8');
    pruneHistoryVersions(historyFileDir);
  } catch (err: any) {
    console.error('[LiveSync] Failed to save history version:', relPath, err.message);
  }
}

function queuedWriteHasServerFileBaseline(item: QueuedFilePush): boolean {
  return !!(
    item.baseDeleted
    || String(item.baseSha256 || '').trim()
    || String(item.baseUpdatedAt || '').trim()
    || String(item.baseRevisionId || '').trim()
    || Number(item.baseServerRevision || 0) > 0
  );
}

function shouldHoldQueuedWriteWithoutServerBaseline(item: QueuedFilePush): boolean {
  if (!state) return false;
  return shouldHoldMissingBaseQueuedWriteInJoin({
    connectionMode: state.syncConfig.connectionMode,
    hasFileBaseline: queuedWriteHasServerFileBaseline(item),
    queuedAfterPreflight: item.queuedAfterPreflight,
    action: item.action,
  });
}

function holdQueuedWriteWithoutServerBaseline(
  relPath: string,
  item: QueuedFilePush,
  sendToRenderer: (channel: string, data: any) => void,
): void {
  if (!state) return;
  const remote = state.lastRemoteFiles.get(relPath);
  const fullPath = path.join(state.vaultPath, relPath.replace(/\//g, path.sep));

  try {
    if (item.contentBase64) {
      archiveBufferForRecovery(relPath, Buffer.from(item.contentBase64, 'base64'), `.local-only-${Date.now()}`);
    } else if (fs.existsSync(fullPath)) {
      archiveExistingFileForRecovery(fullPath, relPath, `.local-only-${Date.now()}`);
    }
  } catch (err: any) {
    console.error('[LiveSync] Failed to archive queued missing-base write:', relPath, err.message);
  }

  rememberPreflightBlockedUpload(relPath);

  if (remote) {
    applyRemoteSnapshotAuthoritative(remote, sendToRenderer, 'preflight-queued-missing-base-remote-wins');
  } else if (fs.existsSync(fullPath)) {
    try {
      saveLiveHistoryVersion(relPath, fullPath, 'preflight-queued-missing-base-held');
      state.pendingChanges.add(relPath);
      fs.unlinkSync(fullPath);
      sendToRenderer('live-sync:file-updated', { relativePath: relPath, action: 'delete' });
      clearPendingChangeSoon(relPath);
    } catch (err: any) {
      state.pendingChanges.delete(relPath);
      console.error('[LiveSync] Failed to remove queued missing-base local file:', relPath, err.message);
    }
  }

  emitActivity(sendToRenderer, {
    direction: 'in',
    action: 'preflight-queued-missing-base-held',
    relativePath: relPath,
    timestamp: new Date().toISOString(),
  });
}

function flushQueuedFilePushes(sendToRenderer: (channel: string, data: any) => void): void {
  if (!state || !state.connected || !state.socket || !state.receivedRemoteSnapshot || !state.preflightComplete || state.queuedFilePushes.size === 0) return;
  if (state.uploadFrozen) {
    emitActivity(sendToRenderer, {
      direction: 'in',
      action: 'preflight-flush-blocked',
      relativePath: state.uploadFrozenReason || 'upload frozen',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const queued = Array.from(state.queuedFilePushes.entries());
  state.queuedFilePushes.clear();
  let sent = 0;
  let held = 0;

  for (const [relPath, item] of queued) {
    if (shouldHoldQueuedWriteWithoutServerBaseline(item)) {
      holdQueuedWriteWithoutServerBaseline(relPath, item, sendToRenderer);
      held++;
      continue;
    }
    sendFileChange(relPath, item.action, item.contentBase64, item.sha256, 'typing', sendToRenderer, item.updatedAt, {
      sha256: item.baseSha256,
      deleted: item.baseDeleted,
      updatedAt: item.baseUpdatedAt,
      size: item.baseSize,
      serverRevision: item.baseServerRevision,
      revisionId: item.baseRevisionId,
    });
    sent++;
  }

  emitActivity(sendToRenderer, {
    direction: sent > 0 ? 'out' : 'in',
    action: 'preflight-flush',
    relativePath: `${sent} sent / ${held} held missing-base queued changes`,
    timestamp: new Date().toISOString(),
  });
}

function autoApplySafeDeleteQueue(sendToRenderer: (channel: string, data: any) => void, reason = 'auto'): void {
  if (!state || !state.connected || !state.socket || !state.receivedRemoteSnapshot || !state.preflightComplete) return;
  const queue = readSafeServerDeleteQueue();
  if (queue.length === 0) return;

  const result = applyLiveSyncSafeDeleteQueue(sendToRenderer, {});
  if (!result.ok) {
    emitActivity(sendToRenderer, {
      direction: 'in',
      action: 'safe-delete-queue-auto-skipped',
      relativePath: result.error || reason,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  emitActivity(sendToRenderer, {
    direction: 'out',
    action: 'safe-delete-queue-auto-sync',
    relativePath: `${result.appliedCount || 0} delete / ${result.remainingCount || 0} remaining`,
    timestamp: new Date().toISOString(),
  });
}

function handleDisconnect(sendToRenderer: (channel: string, data: any) => void): void {
  if (!state) return;

  const wasConnected = state.connected;
  state.connected = false;
  state.connectedAt = null;

  if (state.pingTimer) {
    clearInterval(state.pingTimer);
    state.pingTimer = null;
  }

  if (wasConnected) {
    console.log('[LiveSync] Disconnected');
    sendToRenderer('live-sync:status', {
      connected: false,
      clientId: state.clientId,
      vaultId: state.syncConfig.vaultId,
      serverUrl: state.syncConfig.serverUrl,
      connectedAt: null,
    });
  }

  scheduleReconnect(sendToRenderer);
}

function scheduleReconnect(sendToRenderer: (channel: string, data: any) => void): void {
  if (!state) return;
  if (state.reconnectTimer) return; /* already scheduled */

  /* Exponential backoff: 2s, 4s, 8s, 16s, 30s (capped) */
  const baseDelay = 2000;
  const maxDelay = 30000;
  const delay = Math.min(maxDelay, baseDelay * Math.pow(2, state.reconnectAttempts));
  const jitter = Math.floor(Math.random() * 1000); /* ±1s jitter to avoid thundering herd */
  const totalDelay = delay + jitter;
  state.reconnectAttempts++;

  console.log(`[LiveSync] Reconnecting in ${Math.round(totalDelay / 1000)}s (attempt ${state.reconnectAttempts})...`);
  state.reconnectTimer = setTimeout(() => {
    if (!state) return;
    state.reconnectTimer = null;
    connectWebSocket(sendToRenderer);
  }, totalDelay);
}

/* ── File watcher ── */

function startFileWatcher(sendToRenderer: (channel: string, data: any) => void): void {
  if (!state) return;
  if (state.watcher) return;

  /* Dynamic import chokidar — it's bundled with Electron */
  try {
    const chokidar = require('chokidar');

    const vaultPath = state.vaultPath;
    const ignorePatterns = [
      '**/node_modules/**',
      '**/.ars-note/**',
      '**/.ai-config.json',
      '**/.git/**',
      '**/dist/**',
      '**/release/**',
      '**/*.conflict-*',
      '**/server-data/**',
    ];

    state.watcher = chokidar.watch(vaultPath, {
      ignored: ignorePatterns,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    state.watcher.on('add', (filePath: string) => {
      handleFileChange(filePath, 'create', sendToRenderer);
    });

    state.watcher.on('change', (filePath: string) => {
      handleFileChange(filePath, 'update', sendToRenderer);
    });

    state.watcher.on('unlink', (filePath: string) => {
      handleFileDelete(filePath, sendToRenderer);
    });

    state.watcher.on('error', (err: any) => {
      console.error('[LiveSync] Watcher error:', err.message);
    });

    console.log('[LiveSync] File watcher started for', vaultPath);
    setTimeout(() => seedDeleteShadowCache(), 1000);
  } catch (err: any) {
    console.error('[LiveSync] Failed to start file watcher:', err.message);
    console.error('[LiveSync] Install chokidar: npm install chokidar');
  }
}

function handleFileChange(filePath: string, action: 'create' | 'update', sendToRenderer: (channel: string, data: any) => void): void {
  if (!state) return;

  const relPath = path.relative(state.vaultPath, filePath).replace(/\\/g, '/');
  if (isLiveSyncIgnoredPath(relPath)) return;
  if (isConflictArtifact(relPath)) return;
  const shouldRefreshAiManifest = isPortableAiMemoryPath(relPath);

  try {
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const contentBase64 = content.toString('base64');
    const updatedAt = isoFromMtimeMs(stat.mtimeMs);
    const previousShadow = state.deleteShadowCache.get(relPath);
    const previousBaseline = readLiveBaseline().files[relPath];
    const previousSize = previousShadow?.size || previousBaseline?.size || 0;

    if (state.pendingChanges.has(relPath)) {
      state.pendingChanges.delete(relPath);
      const matchesAppliedRemote = !!previousBaseline
        && !previousBaseline.deleted
        && previousBaseline.sha256 === sha256;
      if (matchesAppliedRemote) return;
    }

    if (shouldGuardDestructiveTruncation({
      action,
      relativePath: relPath,
      previousSize,
      newSize: content.length,
      previousDeleted: !!previousBaseline?.deleted,
    })) {
      holdDestructiveTruncationWrite(relPath, filePath, content, sha256, previousShadow, previousBaseline, sendToRenderer);
      if (shouldRefreshAiManifest) publishAiMemoryLiveManifest(sendToRenderer);
      return;
    }

    rememberDeleteShadow(relPath, content, sha256, updatedAt);

    /* Check for rename: if this file's hash matches a recently unlinked file, treat as rename */
    if (action === 'create' && pendingUnlinks.has(sha256)) {
      const pending = pendingUnlinks.get(sha256)!;
      clearTimeout(pending.timer);
      pendingUnlinks.delete(sha256);
      forgetDeleteShadow(pending.relativePath);

      console.log(`[LiveSync] Rename detected: ${pending.relativePath} → ${relPath}`);

      /* Send delete for old path, then create for new path */
      if (canSendLiveWriteNow()) {
        sendFileChange(pending.relativePath, 'delete', '', '', 'delete', sendToRenderer);
        sendFileChange(relPath, 'create', contentBase64, sha256, 'rename', sendToRenderer, updatedAt);
      } else {
        if (pending.deleteStormGuarded || isDeleteStormFreezeActive()) {
          holdDeleteStormWrite(pending.relativePath, pending, sendToRenderer);
        } else {
          queueFilePush(pending.relativePath, 'delete', '', '');
        }
        queueFilePush(relPath, 'create', contentBase64, sha256, updatedAt);
      }
      if (shouldRefreshAiManifest || isPortableAiMemoryPath(pending.relativePath)) {
        publishAiMemoryLiveManifest(sendToRenderer);
      }
      return;
    }

    if (!canSendLiveWriteNow()) {
      queueFilePush(relPath, action, contentBase64, sha256, updatedAt);
      if (shouldRefreshAiManifest) publishAiMemoryLiveManifest(sendToRenderer);
      return;
    }

    sendFileChange(relPath, action, contentBase64, sha256, action, sendToRenderer, updatedAt);
    if (shouldRefreshAiManifest) publishAiMemoryLiveManifest(sendToRenderer);
  } catch (err: any) {
    console.error('[LiveSync] Error reading file for sync:', filePath, err.message);
  }
}

export function pushLiveFileContent(filePath: string, contentText: string, sendToRenderer: (channel: string, data: any) => void): { ok: boolean; error?: string } {
  if (!state) return { ok: false, error: 'Live sync is not started' };

  const resolvedFile = path.resolve(filePath);
  const rel = path.relative(state.vaultPath, resolvedFile);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, error: 'File is outside the active vault' };
  }

  const relPath = rel.replace(/\\/g, '/');
  if (!relPath || relPath.startsWith('.ars-note/')) {
    return { ok: false, error: 'File is not syncable' };
  }
  if (isLiveSyncIgnoredPath(relPath)) {
    return { ok: false, error: 'File is not syncable' };
  }
  if (isConflictArtifact(relPath)) {
    return { ok: false, error: 'Conflict backup files are not live-synced' };
  }

  const content = Buffer.from(contentText || '', 'utf-8');
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  const action = fs.existsSync(resolvedFile) ? 'update' : 'create';
  const updatedAt = new Date().toISOString();
  const previousShadow = state.deleteShadowCache.get(relPath);
  const previousBaseline = readLiveBaseline().files[relPath];
  const previousSize = previousShadow?.size || previousBaseline?.size || 0;

  if (shouldGuardDestructiveTruncation({
    action,
    relativePath: relPath,
    previousSize,
    newSize: content.length,
    previousDeleted: !!previousBaseline?.deleted,
  })) {
    holdDestructiveTruncationWrite(relPath, resolvedFile, content, sha256, previousShadow, previousBaseline, sendToRenderer);
    return { ok: true };
  }

  rememberDeleteShadow(relPath, content, sha256, updatedAt);

  if (!canSendLiveWriteNow()) {
    queueFilePush(relPath, action, content.toString('base64'), sha256, updatedAt);
    return { ok: true };
  }

  sendFileChange(relPath, action, content.toString('base64'), sha256, 'typing', sendToRenderer, updatedAt);

  return { ok: true };
}

function handleFileDelete(filePath: string, sendToRenderer: (channel: string, data: any) => void): void {
  if (!state) return;

  const relPath = path.relative(state.vaultPath, filePath).replace(/\\/g, '/');
  if (isLiveSyncIgnoredPath(relPath)) return;
  if (isConflictArtifact(relPath)) return;
  const shouldRefreshAiManifest = isPortableAiMemoryPath(relPath);

  const baseline = readLiveBaseline();
  const baselineEntry = baseline.files[relPath];
  if (state.pendingChanges.has(relPath)) {
    state.pendingChanges.delete(relPath);
    if (!baselineEntry || baselineEntry.deleted) return;
  }

  const deleteStormGuarded = recordLocalDeleteForStormGuard(relPath, sendToRenderer);

  /* Try to save the deleted file's hash for rename detection */
  const recentPush = state.recentLocalPushes.get(relPath);
  const shadow = state.deleteShadowCache.get(relPath);
  const savedSha256 = shadow?.sha256 || recentPush?.sha256 || baselineEntry?.sha256 || '';
  const savedContent = shadow?.contentBase64 || '';
  const savedSize = shadow?.size || (savedContent ? Buffer.byteLength(savedContent, 'base64') : 0);

  if (savedSha256) {
    /* Store for rename detection — if a file with the same hash appears within RENAME_WINDOW_MS,
       we'll treat it as a rename instead of delete + create */
    const timer = setTimeout(() => {
      pendingUnlinks.delete(savedSha256);
      /* Timer expired — now send the actual delete */
      if (!state) return;
      const aiDeleteHold = consumeAIServerDeleteHold(relPath);
      if (aiDeleteHold) {
        saveDeleteShadowHistory(relPath, shadow);
        forgetDeleteShadow(relPath);
        publishAIServerDelete(relPath, aiDeleteHold, shadow, sendToRenderer);
        if (shouldRefreshAiManifest) publishAiMemoryLiveManifest(sendToRenderer);
        return;
      }
      if (deleteStormGuarded || isDeleteStormFreezeActive()) {
        holdDeleteStormWrite(relPath, shadow, sendToRenderer);
        if (shouldRefreshAiManifest) publishAiMemoryLiveManifest(sendToRenderer);
        return;
      }
      saveDeleteShadowHistory(relPath, shadow);
      forgetDeleteShadow(relPath);
      if (!canSendLiveWriteNow()) {
        queueFilePush(relPath, 'delete', '', '');
        if (shouldRefreshAiManifest) publishAiMemoryLiveManifest(sendToRenderer);
        return;
      }
      sendFileChange(relPath, 'delete', '', '', 'delete', sendToRenderer);
      if (shouldRefreshAiManifest) publishAiMemoryLiveManifest(sendToRenderer);
    }, RENAME_WINDOW_MS);

    pendingUnlinks.set(savedSha256, {
      relativePath: relPath,
      sha256: savedSha256,
      contentBase64: savedContent,
      size: savedSize,
      deleteStormGuarded,
      timer,
    });
    return; /* Don't send delete yet — wait for potential rename match */
  }

  const aiDeleteHold = consumeAIServerDeleteHold(relPath);
  if (aiDeleteHold) {
    saveDeleteShadowHistory(relPath, shadow);
    forgetDeleteShadow(relPath);
    publishAIServerDelete(relPath, aiDeleteHold, shadow, sendToRenderer);
    if (shouldRefreshAiManifest) publishAiMemoryLiveManifest(sendToRenderer);
    return;
  }

  if (deleteStormGuarded || isDeleteStormFreezeActive()) {
    holdDeleteStormWrite(relPath, shadow, sendToRenderer);
    if (shouldRefreshAiManifest) publishAiMemoryLiveManifest(sendToRenderer);
    return;
  }

  saveDeleteShadowHistory(relPath, shadow);
  forgetDeleteShadow(relPath);

  if (!canSendLiveWriteNow()) {
    queueFilePush(relPath, 'delete', '', '');
    if (shouldRefreshAiManifest) publishAiMemoryLiveManifest(sendToRenderer);
    return;
  }

  sendFileChange(relPath, 'delete', '', '', 'delete', sendToRenderer);
  if (shouldRefreshAiManifest) publishAiMemoryLiveManifest(sendToRenderer);
}

/* ── Handle incoming server messages ── */

function shouldSkipWalkEntry(entryName: string, relDir = ''): boolean {
  if (entryName === ARS_NOTE_DIR) return true;
  if (entryName === 'node_modules' || entryName === '.git' || entryName === 'dist' || entryName === 'release') return true;
  if (entryName === 'out' || entryName === '.cache' || entryName === '__pycache__') return true;
  const relPath = relDir ? `${relDir}/${entryName}` : entryName;
  if (isLiveSyncIgnoredPath(relPath)) return true;
  return entryName.startsWith('.') && !SYNCABLE_HIDDEN_DIRS.has(entryName);
}

function seedDeleteShadowCache(): void {
  if (!state) return;

  function walk(dir: string, relDir = ''): void {
    if (!state || state.deleteShadowTotalBytes >= DELETE_SHADOW_MAX_TOTAL_BYTES) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!state || state.deleteShadowTotalBytes >= DELETE_SHADOW_MAX_TOTAL_BYTES) return;
      if (shouldSkipWalkEntry(entry.name, relDir)) continue;

      const fullPath = path.join(dir, entry.name);
      const entryRelPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, entryRelPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const relPath = path.relative(state.vaultPath, fullPath).replace(/\\/g, '/');
      if (!relPath || !isDeleteShadowEligible(relPath, 1)) continue;

      try {
        const stat = fs.statSync(fullPath);
        if (!isDeleteShadowEligible(relPath, stat.size)) continue;
        const content = fs.readFileSync(fullPath);
        const sha256 = crypto.createHash('sha256').update(content).digest('hex');
        rememberDeleteShadow(relPath, content, sha256, isoFromMtimeMs(stat.mtimeMs));
      } catch {
        /* skip unreadable files */
      }
    }
  }

  walk(state.vaultPath);
}

function collectLocalFileSnapshots(): Map<string, LocalFileSnapshot> {
  const result = new Map<string, LocalFileSnapshot>();
  if (!state) return result;

  function walk(dir: string, relDir = ''): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (shouldSkipWalkEntry(entry.name, relDir)) continue;

      const fullPath = path.join(dir, entry.name);
      const entryRelPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, entryRelPath);
        continue;
      }

      try {
        const stat = fs.statSync(fullPath);
        const relPath = path.relative(state!.vaultPath, fullPath).replace(/\\/g, '/');
        if (!relPath || isConflictArtifact(relPath) || isLiveSyncIgnoredPath(relPath)) continue;
        const content = fs.readFileSync(fullPath);
        const sha256 = crypto.createHash('sha256').update(content).digest('hex');
        rememberDeleteShadow(relPath, content, sha256, isoFromMtimeMs(stat.mtimeMs));
        result.set(relPath, {
          relativePath: relPath,
          fullPath,
          sha256,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        /* skip unreadable files */
      }
    }
  }

  walk(state.vaultPath);
  return result;
}

function pushLocalSnapshotFile(
  local: LocalFileSnapshot,
  action: 'create' | 'update',
  activityAction: string,
  sendToRenderer: (channel: string, data: any) => void,
  options: { updatedAt?: string; base?: ReturnType<typeof baselineForChange> } = {},
): void {
  if (!state) return;
  try {
    const content = fs.readFileSync(local.fullPath);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const previousShadow = state.deleteShadowCache.get(local.relativePath);
    const previousBaseline = readLiveBaseline().files[local.relativePath];
    const guardAction = previousBaseline && !previousBaseline.deleted ? 'update' : action;
    const previousSize = previousShadow?.size || previousBaseline?.size || 0;
    if (shouldGuardDestructiveTruncation({
      action: guardAction,
      relativePath: local.relativePath,
      previousSize,
      newSize: content.length,
      previousDeleted: !!previousBaseline?.deleted,
    })) {
      holdDestructiveTruncationWrite(local.relativePath, local.fullPath, content, sha256, previousShadow, previousBaseline, sendToRenderer);
      return;
    }
    sendFileChange(
      local.relativePath,
      action,
      content.toString('base64'),
      sha256,
      activityAction,
      sendToRenderer,
      options.updatedAt || isoFromMtimeMs(local.mtimeMs),
      options.base || baselineForChange(local.relativePath),
    );
  } catch (err: any) {
    console.error('[LiveSync] Failed to push local file:', local.relativePath, err.message);
  }
}

function remoteTimeMs(file: any): number {
  const parsed = Date.parse(file?.updatedAt || file?.timestamp || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function remoteSnapshotMaxUpdatedAt(files: Map<string, any>): string {
  let maxMs = 0;
  for (const file of files.values()) {
    const fileMs = remoteTimeMs(file);
    if (fileMs > maxMs) maxMs = fileMs;
  }
  return maxMs > 0 ? new Date(maxMs).toISOString() : '';
}

function isoFromMtimeMs(mtimeMs: number): string {
  return Number.isFinite(mtimeMs) && mtimeMs > 0
    ? new Date(mtimeMs).toISOString()
    : new Date().toISOString();
}

function timeMs(value?: string): number {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isPreflightBaselineStaleAgainstRemote(
  baselineUpdatedAt: string | undefined,
  remoteMaxUpdatedAt: string | undefined,
  thresholdMs = PREFLIGHT_STALE_BASELINE_MS,
): boolean {
  const baselineMs = timeMs(baselineUpdatedAt);
  const remoteMs = timeMs(remoteMaxUpdatedAt);
  if (!baselineMs || !remoteMs) return false;
  return remoteMs - baselineMs > Math.max(0, thresholdMs);
}

export interface JoinSnapshotAuthorityDecision {
  connectionMode: LiveSyncConnectionMode;
  baselineFileCount: number;
  remoteFileCount: number;
  staleBaselineAgainstRemote: boolean;
  firstConnectToPopulatedServer: boolean;
  serverAuthoritativeAdoption: boolean;
  adoptLocalOnlyToRecovery: boolean;
  blockAutomaticLocalOnlyUpload: boolean;
  mode:
    | 'normal-join'
    | 'first-connect-server-authority'
    | 'rebuild-explicit-publish';
}

export function getJoinSnapshotAuthorityDecision(input: {
  connectionMode?: LiveSyncConnectionMode | string;
  baselineFileCount: number;
  remoteFileCount: number;
  baselineUpdatedAt?: string;
  remoteMaxUpdatedAt?: string;
  hasPreviousFileBaseline?: boolean;
}): JoinSnapshotAuthorityDecision {
  const connectionMode = normalizeLiveSyncConnectionMode(input.connectionMode);
  const baselineFileCount = Math.max(0, Math.floor(Number(input.baselineFileCount) || 0));
  const remoteFileCount = Math.max(0, Math.floor(Number(input.remoteFileCount) || 0));
  const staleBaselineAgainstRemote = connectionMode === 'join'
    && baselineFileCount > 0
    && isPreflightBaselineStaleAgainstRemote(input.baselineUpdatedAt, input.remoteMaxUpdatedAt);
  const firstConnectToPopulatedServer = connectionMode === 'join'
    && baselineFileCount === 0
    && remoteFileCount > 0;
  /* A stale global timestamp is diagnostic only. Existing devices reconcile per file. */
  const serverAuthoritativeAdoption = firstConnectToPopulatedServer;
  const hasPreviousFileBaseline = !!input.hasPreviousFileBaseline;
  const adoptLocalOnlyToRecovery = serverAuthoritativeAdoption
    && !hasPreviousFileBaseline;

  return {
    connectionMode,
    baselineFileCount,
    remoteFileCount,
    staleBaselineAgainstRemote,
    firstConnectToPopulatedServer,
    serverAuthoritativeAdoption,
    adoptLocalOnlyToRecovery,
    blockAutomaticLocalOnlyUpload: connectionMode === 'rebuild' || serverAuthoritativeAdoption,
    mode: connectionMode === 'rebuild'
      ? 'rebuild-explicit-publish'
      : firstConnectToPopulatedServer
        ? 'first-connect-server-authority'
        : 'normal-join',
  };
}

function staleBaselineUploadFreezeReason(baselineUpdatedAt: string | undefined, remoteMaxUpdatedAt: string | undefined): string {
  const baselineMs = timeMs(baselineUpdatedAt);
  const remoteMs = timeMs(remoteMaxUpdatedAt);
  const lagMs = baselineMs && remoteMs ? Math.max(0, remoteMs - baselineMs) : 0;
  const lagHours = lagMs > 0 ? Math.round(lagMs / (60 * 60 * 1000)) : 0;
  return lagHours > 0
    ? `${STALE_BASELINE_UPLOAD_REASON}:${lagHours}h`
    : STALE_BASELINE_UPLOAD_REASON;
}

function isLocalNewerThanRemote(localMtimeMs: number, remoteMs: number): boolean {
  return remoteMs > 0 && localMtimeMs > remoteMs + REMOTE_LOCAL_CLOCK_SKEW_GRACE_MS;
}

export function shouldApplyServerAuthorityOverIncomingConflictInMode(connectionMode?: LiveSyncConnectionMode | string): boolean {
  return normalizeLiveSyncConnectionMode(connectionMode) === 'join';
}

function shouldApplyServerAuthorityOverIncomingConflict(): boolean {
  return shouldApplyServerAuthorityOverIncomingConflictInMode(state?.syncConfig.connectionMode);
}

function pushExistingLocalFile(
  relPath: string,
  fullPath: string,
  activityAction: string,
  sendToRenderer: (channel: string, data: any) => void,
): boolean {
  if (!state || !fs.existsSync(fullPath)) return false;
  try {
    const stat = fs.statSync(fullPath);
    const content = fs.readFileSync(fullPath);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const updatedAt = isoFromMtimeMs(stat.mtimeMs);
    if (!canSendLiveWriteNow()) {
      queueFilePush(relPath, 'update', content.toString('base64'), sha256, updatedAt);
    } else {
      sendFileChange(relPath, 'update', content.toString('base64'), sha256, activityAction, sendToRenderer, updatedAt);
    }
    return true;
  } catch (err: any) {
    console.error('[LiveSync] Failed to preserve local file:', relPath, err.message);
    return false;
  }
}

function writeIncomingConflictCopy(fullPath: string, content: Buffer, relPath: string, sendToRenderer: (channel: string, data: any) => void): void {
  try {
    const backupFile = archiveBufferForRecovery(relPath, content, `.conflict-${Date.now()}`);
    sendToRenderer('live-sync:conflict', {
      relativePath: relPath,
      backupFile,
      recoveryRelativePath: backupFile,
      hiddenRecoveryCopy: isLiveSyncRecoveryArchivePath(backupFile),
      visibleConflictFile: isUserVisibleConflictArtifactPath(backupFile),
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[LiveSync] Failed to store incoming conflict copy:', relPath, err.message);
  }
}

function writeLocalConflictBackup(fullPath: string, relPath: string, sendToRenderer: (channel: string, data: any) => void): void {
  if (!fs.existsSync(fullPath)) return;
  try {
    const backupFile = archiveExistingFileForRecovery(fullPath, relPath, `.conflict-${Date.now()}`) || '';
    sendToRenderer('live-sync:conflict', {
      relativePath: relPath,
      backupFile,
      recoveryRelativePath: backupFile,
      hiddenRecoveryCopy: isLiveSyncRecoveryArchivePath(backupFile),
      visibleConflictFile: isUserVisibleConflictArtifactPath(backupFile),
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[LiveSync] Failed to store local conflict backup:', relPath, err.message);
  }
}

function clearPendingChangeSoon(relPath: string): void {
  setTimeout(() => {
    state?.pendingChanges.delete(relPath);
  }, 3000);
}

function fetchSnapshotFileOnce(file: any): Promise<any> {
  if (!state) return Promise.reject(new Error('Live Sync stopped during snapshot download'));
  const config = state.syncConfig;
  const url = new URL(normalizeLiveSyncServerUrl(config.serverUrl));
  const transport = url.protocol === 'https:' ? https : http;
  const basePath = url.pathname && url.pathname !== '/' ? url.pathname.replace(/\/+$/, '') : '';
  const requestPath = `${basePath}/api/live-sync/file?vaultId=${encodeURIComponent(config.vaultId || '')}&relativePath=${encodeURIComponent(file.relativePath || '')}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
    headers['x-ars-note-api-key'] = config.apiKey;
  }

  return new Promise((resolve, reject) => {
    const req = transport.request({
      hostname: url.hostname,
      port: parseInt(url.port || (url.protocol === 'https:' ? '443' : '80')),
      path: requestPath,
      method: 'GET',
      headers,
      timeout: SNAPSHOT_CONTENT_FETCH_TIMEOUT_MS,
    }, (res) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      res.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_SNAPSHOT_FILE_RESPONSE_BYTES) {
          req.destroy(new Error(`Snapshot file response is too large: ${file.relativePath}`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300 || !data?.ok || !data?.file) {
            reject(new Error(data?.error || `Snapshot file HTTP ${res.statusCode || 0}: ${file.relativePath}`));
            return;
          }
          const hydrated = { ...file, ...data.file, relativePath: file.relativePath };
          if (!hydrated.deleted) {
            if (typeof hydrated.contentBase64 !== 'string') {
              reject(new Error(`Snapshot file has no content: ${file.relativePath}`));
              return;
            }
            const content = Buffer.from(hydrated.contentBase64, 'base64');
            const actualSha256 = crypto.createHash('sha256').update(content).digest('hex');
            if (actualSha256 !== String(file.sha256 || '').toLowerCase()) {
              reject(new Error(`Snapshot file checksum mismatch: ${file.relativePath}`));
              return;
            }
          }
          resolve(hydrated);
        } catch (err: any) {
          reject(new Error(`Invalid snapshot file response for ${file.relativePath}: ${err?.message || err}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Snapshot file download timeout: ${file.relativePath}`)));
    req.end();
  });
}

async function fetchSnapshotFile(file: any): Promise<any> {
  let lastError: any = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetchSnapshotFileOnce(file);
    } catch (err) {
      lastError = err;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError || new Error(`Snapshot file download failed: ${file.relativePath}`);
}

async function hydrateLiveSnapshot(msg: any, sendToRenderer: (channel: string, data: any) => void): Promise<any> {
  if (!state || !Array.isArray(msg.files)) return msg;
  const files = msg.files.map((file: any) => ({ ...file }));
  const localFiles = collectLocalFileSnapshots();
  const baseline = readLiveBaseline();
  const pendingIndexes: number[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file?.relativePath || file.deleted || typeof file.contentBase64 === 'string') continue;
    const relPath = String(file.relativePath).replace(/\\/g, '/');
    const local = localFiles.get(relPath);
    if (local?.sha256 === file.sha256) continue;
    const previous = baseline.files[relPath];
    const remoteUnchangedFromBaseline = !!(
      local
      && previous
      && !previous.deleted
      && previous.sha256 === file.sha256
      && local.sha256 !== previous.sha256
    );
    if (remoteUnchangedFromBaseline) continue;
    pendingIndexes.push(index);
  }

  if (pendingIndexes.length === 0) return { ...msg, files };
  emitActivity(sendToRenderer, {
    direction: 'in',
    action: 'snapshot-content-download',
    relativePath: `${pendingIndexes.length} changed file(s)`,
    timestamp: new Date().toISOString(),
  });

  let cursor = 0;
  const workers = Array.from({ length: Math.min(SNAPSHOT_CONTENT_FETCH_CONCURRENCY, pendingIndexes.length) }, async () => {
    while (cursor < pendingIndexes.length) {
      const pendingIndex = pendingIndexes[cursor];
      cursor += 1;
      files[pendingIndex] = await fetchSnapshotFile(files[pendingIndex]);
    }
  });
  await Promise.all(workers);
  return { ...msg, files };
}

function flushDeferredRemoteChanges(sendToRenderer: (channel: string, data: any) => void): void {
  if (!state || state.deferredRemoteChanges.length === 0) return;
  const changes = state.deferredRemoteChanges.splice(0);
  for (const change of changes) applyFileChange(change, sendToRenderer);
}

function scheduleInitialSnapshot(sendToRenderer: (channel: string, data: any) => void): void {
  if (!state) return;
  if (state.initialSnapshotTimer) {
    clearTimeout(state.initialSnapshotTimer);
  }

  state.initialSnapshotTimer = setTimeout(() => {
    if (!state) return;
    state.initialSnapshotTimer = null;
    if (state.receivedRemoteSnapshot) return;
    freezeLiveUploads('remote-snapshot-unavailable', sendToRenderer);
  }, INITIAL_SNAPSHOT_WAIT_MS);
}

function handleServerMessage(raw: string, sendToRenderer: (channel: string, data: any) => void): void {
  if (!state) return;

  let msg: any;
  try { msg = JSON.parse(raw); } catch { return; }

  switch (msg.type) {
    case 'welcome': {
      console.log('[LiveSync] Server welcome. Clients:', msg.clientCount);
      break;
    }

    case 'pong': {
      /* Heartbeat response */
      if (state.lastPing) {
        state.latencyMs = Math.max(0, Date.now() - state.lastPing);
        state.lastPongAt = new Date().toISOString();
      }
      break;
    }

    case 'file-change': {
      /* Incoming file change from another client */
      if (state.snapshotReconcileInProgress) {
        state.deferredRemoteChanges.push(msg);
        break;
      }
      applyFileChange(msg, sendToRenderer);
      break;
    }

    case 'file-accepted': {
      applyFileAccepted(msg);
      break;
    }

    case 'file-rejected': {
      applyFileRejected(msg, sendToRenderer);
      break;
    }

    case 'live-snapshot': {
      if (Array.isArray(msg.files)) {
        state.receivedRemoteSnapshot = true;
        state.lastRemoteSnapshotReceivedAt = new Date().toISOString();
        state.snapshotReconcileInProgress = true;
        if (state.initialSnapshotTimer) {
          clearTimeout(state.initialSnapshotTimer);
          state.initialSnapshotTimer = null;
        }
      }
      const snapshotSocket = state.socket;
      void hydrateLiveSnapshot(msg, sendToRenderer)
        .then((hydrated) => {
          if (!state || state.socket !== snapshotSocket) return;
          applyLiveSnapshot(hydrated, sendToRenderer);
          flushDeferredRemoteChanges(sendToRenderer);
        })
        .catch((err: any) => {
          if (!state || state.socket !== snapshotSocket) return;
          state.lastError = err?.message || 'Snapshot content download failed';
          state.snapshotReconcileInProgress = false;
          state.deferredRemoteChanges = [];
          freezeLiveUploads('snapshot-content-download-failed', sendToRenderer);
          try { state.socket?.destroy(); } catch { /* reconnect will retry the snapshot */ }
        });
      break;
    }

    case 'file-request': {
      /* Another client is requesting a file — send it if we have it */
      respondToFileRequest(msg);
      break;
    }

    case 'full-sync-request': {
      /* Another client wants to know our file list */
      respondToFullSyncRequest(msg);
      break;
    }
  }
}

function applyFileAccepted(msg: any): void {
  if (!state) return;
  const relPath = msg.relativePath;
  if (!relPath || isLiveSyncIgnoredPath(relPath) || isConflictArtifact(relPath)) return;
  const deleted = !!msg.deleted || msg.action === 'delete';
  const recent = state.recentLocalPushes.get(relPath);
  markBaselineSynced(
    relPath,
    deleted ? '' : (msg.sha256 || ''),
    deleted,
    msg.updatedAt || msg.timestamp,
    deleted ? 0 : Number(msg.size || recent?.size || 0),
    baselineMetadataFrom(msg),
  );
}

function describeRejectedWriteReason(reason: string): string {
  switch (reason) {
    case 'base-revision-mismatch':
      return 'Server rejected a stale write because this computer edited an older server revision. Reopen Live Sync so Ars-note can pull the newest server timeline first.';
    case 'base-version-mismatch':
      return 'Server rejected a stale write because this file changed on another device first.';
    case 'missing-base-version':
      return 'Server rejected an unsafe write from a client that did not send its base file version.';
    case 'stale-write':
      return 'Server rejected an older write because the server already has a newer timestamp.';
    case 'server-missing-base-file':
      return 'Server rejected this write because the client claimed an existing base version, but the server has no current copy. Check vault ID/server data before uploading old local content.';
    case 'deleted-tombstone-resurrection':
      return 'Server rejected an unsafe resurrection of a deleted file. This prevents an old computer from bringing back content that was already deleted on another device.';
    case 'legacy-client-protocol':
      return 'Server rejected an old client protocol. Update every computer before syncing this vault.';
    case 'missing-server-snapshot-proof':
      return 'Server rejected this write because this computer has not proven it received and reconciled the server snapshot first. Reconnect Live Sync and wait for the health check to become ready.';
    case 'pre-snapshot-local-write':
      return 'Server rejected a local-only file that existed before this computer received the server snapshot. This prevents old local files from being uploaded as new server files.';
    case 'stale-baseline-missing-base-write':
      return 'Server rejected a local-only write because this computer baseline is too old to create files without a server file baseline. Review it in Sync Recovery Center instead of uploading the batch.';
    case 'rebuild-safety-snapshot-unavailable':
      return 'Server rejected rebuild-mode writing because this NAS server cannot create a safety snapshot before the dangerous operation. Update the server folder before rebuilding.';
    case 'rebuild-safety-snapshot-failed':
      return 'Server rejected rebuild-mode writing because it failed to create the required safety snapshot first. Check NAS storage space and server logs.';
    case 'content-sha-mismatch':
      return 'Server rejected the upload because file content did not match its SHA256 checksum.';
    case 'storage-write-failed':
      return 'Server could not persist this write. Check NAS storage and server logs.';
    case 'delete-storm-guard':
      return 'Server blocked a burst of delete operations to prevent accidental mass deletion from spreading.';
    case 'destructive-truncation':
      return 'Server rejected a sudden empty/tiny rewrite of an existing large text document. This prevents blank GDD or truncated documents from spreading.';
    default:
      return `Server rejected this write for safety: ${reason || 'unknown reason'}.`;
  }
}

function recordRejectedWriteNotice(msg: any, current: any, sendToRenderer: (channel: string, data: any) => void): void {
  if (!state) return;
  const reason = String(msg.reason || 'write-rejected');
  const rejected: LiveSyncRejectedWrite = {
    relativePath: String(msg.relativePath || ''),
    action: String(msg.action || 'update'),
    reason,
    message: msg.historyRevisionId
      ? `${describeRejectedWriteReason(reason)} Protected copy saved in server history for Sync Recovery Center.`
      : describeRejectedWriteReason(reason),
    rejectedAt: new Date().toISOString(),
    clientSha256: String(msg.sha256 || ''),
    serverSha256: String(current?.sha256 || ''),
    serverDeleted: !!current?.deleted,
    serverUpdatedAt: String(current?.updatedAt || ''),
    serverHistoryRevisionId: typeof msg.historyRevisionId === 'string' ? msg.historyRevisionId : undefined,
    serverHistoryContentAvailable: typeof msg.historyContentAvailable === 'boolean' ? msg.historyContentAvailable : undefined,
    rejectedSourceClientId: typeof msg.rejectedSourceClientId === 'string' ? msg.rejectedSourceClientId : undefined,
    rejectedSourceDeviceId: typeof msg.rejectedSourceDeviceId === 'string' ? msg.rejectedSourceDeviceId : undefined,
  };
  state.lastRejectedWrite = rejected;
  emitActivity(sendToRenderer, {
    direction: 'in',
    action: `server-rejected-${reason}`,
    relativePath: rejected.relativePath,
    timestamp: rejected.rejectedAt,
  });
  sendToRenderer('live-sync:status', {
    connected: state.connected,
    clientId: state.clientId,
    vaultId: state.syncConfig.vaultId,
    serverUrl: state.syncConfig.serverUrl,
    connectedAt: state.connectedAt,
    warning: rejected.message,
    lastRejectedWrite: rejected,
  });
}

function applyFileRejected(msg: any, sendToRenderer: (channel: string, data: any) => void): void {
  if (!state) return;
  const relPath = msg.relativePath;
  if (!relPath || isLiveSyncIgnoredPath(relPath) || isConflictArtifact(relPath)) return;

  const current = msg.current || null;
  const fullPath = path.join(state.vaultPath, relPath.replace(/\//g, path.sep));
  state.pendingChanges.add(relPath);
  recordRejectedWriteNotice(msg, current, sendToRenderer);

  try {
    if (fs.existsSync(fullPath)) {
      saveLiveHistoryVersion(relPath, fullPath, `server-rejected-${msg.reason || 'write'}`);
      writeLocalConflictBackup(fullPath, relPath, sendToRenderer);
    }

    if (!current || current.deleted) {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
      forgetDeleteShadow(relPath);
      markBaselineSynced(relPath, '', true, current?.updatedAt || msg.updatedAt || msg.timestamp, 0, baselineMetadataFrom(current || msg));
      emitActivity(sendToRenderer, {
        direction: 'in',
        action: 'rejected-delete',
        relativePath: relPath,
        timestamp: new Date().toISOString(),
      });
      sendToRenderer('live-sync:file-updated', { relativePath: relPath, action: 'delete' });
      clearPendingChangeSoon(relPath);
      return;
    }

    if (!current.contentBase64) {
      state.pendingChanges.delete(relPath);
      emitActivity(sendToRenderer, {
        direction: 'out',
        action: 'rejected-kept-local',
        relativePath: relPath,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const content = Buffer.from(current.contentBase64, 'base64');
    fs.writeFileSync(fullPath, content);
    const appliedHash = current.sha256 || crypto.createHash('sha256').update(content).digest('hex');
    const appliedAt = current.updatedAt || msg.updatedAt || msg.timestamp;
    rememberDeleteShadow(relPath, content, appliedHash, appliedAt);
    markBaselineSynced(relPath, appliedHash, false, appliedAt, content.length, baselineMetadataFrom(current || msg));
    emitActivity(sendToRenderer, {
      direction: 'in',
      action: 'rejected-current',
      relativePath: relPath,
      timestamp: new Date().toISOString(),
    });
    sendToRenderer('live-sync:file-updated', { relativePath: relPath, action: 'update' });
  } catch (err: any) {
    state.pendingChanges.delete(relPath);
    console.error('[LiveSync] Error applying rejected file response:', fullPath, err.message);
    return;
  }

  clearPendingChangeSoon(relPath);
}

function queuedBaseMatchesRemote(item: QueuedFilePush, file: any): boolean {
  const remoteDeleted = !!file.deleted;
  const remoteSha = remoteDeleted ? '' : String(file.sha256 || '');
  const baseSha = item.baseDeleted ? '' : String(item.baseSha256 || '');
  return item.baseDeleted === remoteDeleted && baseSha === remoteSha;
}

function applyRemoteSnapshotAuthoritative(file: any, sendToRenderer: (channel: string, data: any) => void, reason: string): void {
  if (!state || !file?.relativePath) return;
  const relPath = String(file.relativePath).replace(/\\/g, '/');
  if (!relPath || isLiveSyncIgnoredPath(relPath) || isConflictArtifact(relPath)) return;

  const fullPath = path.join(state.vaultPath, relPath.replace(/\//g, path.sep));
  const remoteUpdatedAt = file.updatedAt || file.timestamp || new Date().toISOString();
  state.pendingChanges.add(relPath);

  try {
    if (file.deleted) {
      if (fs.existsSync(fullPath)) {
        saveLiveHistoryVersion(relPath, fullPath, reason);
        fs.unlinkSync(fullPath);
      }
      forgetDeleteShadow(relPath);
      markBaselineSynced(relPath, '', true, remoteUpdatedAt, 0, baselineMetadataFrom(file));
      sendToRenderer('live-sync:file-updated', { relativePath: relPath, action: 'delete' });
      return;
    }

    const content = Buffer.from(file.contentBase64 || '', 'base64');
    if (!file.contentBase64 && content.length === 0) return;
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    if (fs.existsSync(fullPath)) saveLiveHistoryVersion(relPath, fullPath, reason);
    fs.writeFileSync(fullPath, content);
    const appliedHash = file.sha256 || crypto.createHash('sha256').update(content).digest('hex');
    rememberDeleteShadow(relPath, content, appliedHash, remoteUpdatedAt);
    markBaselineSynced(relPath, appliedHash, false, remoteUpdatedAt, content.length || Number(file.size || 0), baselineMetadataFrom(file));
    sendToRenderer('live-sync:file-updated', { relativePath: relPath, action: 'update' });
  } catch (err: any) {
    console.error('[LiveSync] Failed to apply authoritative remote snapshot:', relPath, err.message);
  } finally {
    clearPendingChangeSoon(relPath);
  }
}

function blockQueuedWriteAgainstRemoteSnapshot(relPath: string, item: QueuedFilePush, file: any, sendToRenderer: (channel: string, data: any) => void): boolean {
  if (!state || queuedBaseMatchesRemote(item, file)) return false;

  state.queuedFilePushes.delete(relPath);
  const fullPath = path.join(state.vaultPath, relPath.replace(/\//g, path.sep));
  if (item.action !== 'delete' && item.contentBase64) {
    writeIncomingConflictCopy(fullPath, Buffer.from(item.contentBase64, 'base64'), relPath, sendToRenderer);
  } else if (fs.existsSync(fullPath)) {
    writeLocalConflictBackup(fullPath, relPath, sendToRenderer);
  }

  applyRemoteSnapshotAuthoritative(file, sendToRenderer, 'preflight-remote-wins');
  emitActivity(sendToRenderer, {
    direction: 'in',
    action: 'preflight-blocked-stale-local',
    relativePath: relPath,
    timestamp: new Date().toISOString(),
  });
  return true;
}

function blockQueuedWriteForStaleBaseline(
  relPath: string,
  item: QueuedFilePush,
  file: any,
  sendToRenderer: (channel: string, data: any) => void,
  keepBlocked = true,
): void {
  if (!state) return;
  state.queuedFilePushes.delete(relPath);
  const fullPath = path.join(state.vaultPath, relPath.replace(/\//g, path.sep));
  if (item.action !== 'delete' && item.contentBase64) {
    writeIncomingConflictCopy(fullPath, Buffer.from(item.contentBase64, 'base64'), relPath, sendToRenderer);
  } else if (fs.existsSync(fullPath)) {
    writeLocalConflictBackup(fullPath, relPath, sendToRenderer);
  }

  if (keepBlocked) rememberPreflightBlockedUpload(relPath);
  applyRemoteSnapshotAuthoritative(file, sendToRenderer, 'preflight-stale-baseline-remote-wins');
  emitActivity(sendToRenderer, {
    direction: 'in',
    action: 'preflight-stale-baseline-blocked-queued',
    relativePath: relPath,
    timestamp: new Date().toISOString(),
  });
}

function applyRemoteSnapshotOverDivergedLocal(relPath: string, file: any, sendToRenderer: (channel: string, data: any) => void): void {
  if (!state) return;
  const fullPath = path.join(state.vaultPath, relPath.replace(/\//g, path.sep));
  if (fs.existsSync(fullPath)) {
    writeLocalConflictBackup(fullPath, relPath, sendToRenderer);
  }
  rememberPreflightBlockedUpload(relPath);
  applyRemoteSnapshotAuthoritative(file, sendToRenderer, 'preflight-diverged-remote-wins');
  emitActivity(sendToRenderer, {
    direction: 'in',
    action: 'preflight-diverged-remote-wins',
    relativePath: relPath,
    timestamp: new Date().toISOString(),
  });
}

function applyRemoteSnapshotOverStaleBaselineLocal(
  relPath: string,
  file: any,
  sendToRenderer: (channel: string, data: any) => void,
  keepBlocked = true,
): void {
  if (!state) return;
  const fullPath = path.join(state.vaultPath, relPath.replace(/\//g, path.sep));
  if (fs.existsSync(fullPath)) {
    writeLocalConflictBackup(fullPath, relPath, sendToRenderer);
  }
  if (keepBlocked) rememberPreflightBlockedUpload(relPath);
  applyRemoteSnapshotAuthoritative(file, sendToRenderer, 'preflight-stale-baseline-remote-wins');
  emitActivity(sendToRenderer, {
    direction: 'in',
    action: 'preflight-stale-baseline-remote-wins',
    relativePath: relPath,
    timestamp: new Date().toISOString(),
  });
}

function blockLocalOnlyForStaleBaseline(local: LocalFileSnapshot, sendToRenderer: (channel: string, data: any) => void): void {
  if (!state) return;
  state.queuedFilePushes.delete(local.relativePath);
  writeLocalConflictBackup(local.fullPath, local.relativePath, sendToRenderer);
  rememberPreflightBlockedUpload(local.relativePath);
  emitActivity(sendToRenderer, {
    direction: 'in',
    action: 'preflight-stale-baseline-blocked-local-only',
    relativePath: local.relativePath,
    timestamp: new Date().toISOString(),
  });
}

function adoptServerAuthorityForLocalOnlyFile(local: LocalFileSnapshot, sendToRenderer: (channel: string, data: any) => void): void {
  if (!state) return;
  state.queuedFilePushes.delete(local.relativePath);
  try {
    if (fs.existsSync(local.fullPath)) {
      saveLiveHistoryVersion(local.relativePath, local.fullPath, SERVER_AUTHORITATIVE_ADOPTION_REASON);
      archiveExistingFileForRecovery(local.fullPath, local.relativePath, `.local-only-${Date.now()}`);
      state.pendingChanges.add(local.relativePath);
      fs.unlinkSync(local.fullPath);
    }
  } catch (err: any) {
    console.error('[LiveSync] Failed to archive local-only file during server adoption:', local.relativePath, err.message);
    writeLocalConflictBackup(local.fullPath, local.relativePath, sendToRenderer);
    rememberPreflightBlockedUpload(local.relativePath);
    return;
  }
  emitActivity(sendToRenderer, {
    direction: 'in',
    action: SERVER_AUTHORITATIVE_ADOPTION_REASON,
    relativePath: local.relativePath,
    timestamp: new Date().toISOString(),
  });
  sendToRenderer('live-sync:file-updated', { relativePath: local.relativePath, action: 'delete' });
}

function applyLiveSnapshot(msg: any, sendToRenderer: (channel: string, data: any) => void): void {
  if (!state || !Array.isArray(msg.files)) return;
  state.snapshotReconcileInProgress = true;
  clearLiveUploadFreeze('remote-snapshot-unavailable');
  state.preflightBlockedUploadCount = 0;
  state.preflightBlockedUploadFiles = [];

  const baseline = readLiveBaseline();
  const localFiles = collectLocalFileSnapshots();
  const remoteFiles = new Map<string, any>();
  let applied = 0;
  let uploaded = 0;
  let matched = 0;
  let skipped = 0;
  let blocked = 0;
  let protectedLocalOnlyCount = 0;
  let protectedDivergedCount = 0;
  let protectedQueuedCount = 0;
  const protectedFiles: string[] = [];
  const baselineFileCount = Object.keys(baseline.files).length;

  for (const file of msg.files) {
    if (!file?.relativePath) continue;
    const relPath = String(file.relativePath).replace(/\\/g, '/');
    if (isConflictArtifact(relPath) || isLiveSyncIgnoredPath(relPath)) continue;
    remoteFiles.set(relPath, { ...file, relativePath: relPath });
  }
  state.lastRemoteFiles = new Map(remoteFiles);

  const remoteMaxUpdatedAt = remoteSnapshotMaxUpdatedAt(remoteFiles);
  const connectionMode = normalizeLiveSyncConnectionMode(state.syncConfig.connectionMode);
  const rebuildMode = connectionMode === 'rebuild';
  const authorityDecision = getJoinSnapshotAuthorityDecision({
    connectionMode,
    baselineFileCount,
    remoteFileCount: remoteFiles.size,
    baselineUpdatedAt: baseline.updatedAt,
    remoteMaxUpdatedAt,
  });

  if (rebuildMode) {
    state.queuedFilePushes.clear();
    state.preflightBlockedUploadCount = 0;
    state.preflightBlockedUploadFiles = [];
    for (const relPath of localFiles.keys()) {
      rememberPreflightBlockedUpload(relPath);
    }
    freezeLiveUploads(
      remoteFiles.size === 0 ? EMPTY_SERVER_INITIAL_UPLOAD_REASON : REBUILD_MODE_EXPLICIT_PUBLISH_REASON,
      sendToRenderer,
    );
    state.preflightComplete = true;
    emitActivity(sendToRenderer, {
      direction: 'in',
      action: 'rebuild-mode-waiting-for-explicit-publish',
      relativePath: `${localFiles.size} local / ${remoteFiles.size} server`,
      timestamp: new Date().toISOString(),
    });
    state.snapshotReconcileInProgress = false;
    emitLiveSyncStatus(sendToRenderer);
    return;
  }

  const serverAuthoritativeAdoption = authorityDecision.serverAuthoritativeAdoption;
  if (serverAuthoritativeAdoption) {
    clearLiveUploadFreeze(STALE_BASELINE_UPLOAD_REASON);
    state.preflightBlockedUploadCount = 0;
    state.preflightBlockedUploadFiles = [];
  }

  for (const [relPath, file] of remoteFiles) {
    const queued = state.queuedFilePushes.get(file.relativePath);
    if (queued) {
      if (serverAuthoritativeAdoption) {
        blockQueuedWriteForStaleBaseline(file.relativePath, queued, file, sendToRenderer, false);
        protectedQueuedCount++;
        if (protectedFiles.length < PREFLIGHT_BLOCKED_FILE_LIMIT) protectedFiles.push(file.relativePath);
        localFiles.delete(relPath);
        applied++;
        continue;
      }
      if (blockQueuedWriteAgainstRemoteSnapshot(file.relativePath, queued, file, sendToRenderer)) {
        localFiles.delete(relPath);
        applied++;
        continue;
      }
      localFiles.delete(relPath);
      skipped++;
      continue;
    }
    const recentLocal = state.recentLocalPushes.get(file.relativePath);
    if (recentLocal && Date.now() - recentLocal.at < 30000 && recentLocal.sha256 !== file.sha256) {
      continue;
    }

    const local = localFiles.get(relPath);
    const previous = baseline.files[relPath];
    const remoteHash = file.deleted ? '' : (file.sha256 || '');

    if (local && !file.deleted && local.sha256 === remoteHash) {
      markBaselineSynced(relPath, remoteHash, false, file.updatedAt || file.timestamp, Number(file.size || local.size || 0), baselineMetadataFrom(file));
      localFiles.delete(relPath);
      matched++;
      continue;
    }

    if (local) {
      const localChangedSinceBaseline = !previous || previous.deleted || previous.sha256 !== local.sha256;
      const remoteChangedSinceBaseline = !previous || previous.deleted !== !!file.deleted || previous.sha256 !== remoteHash;

      if (serverAuthoritativeAdoption && localChangedSinceBaseline) {
        applyRemoteSnapshotOverStaleBaselineLocal(relPath, file, sendToRenderer, false);
        protectedDivergedCount++;
        if (protectedFiles.length < PREFLIGHT_BLOCKED_FILE_LIMIT) protectedFiles.push(relPath);
        localFiles.delete(relPath);
        applied++;
        continue;
      }

      if (previous && !remoteChangedSinceBaseline && localChangedSinceBaseline) {
        pushLocalSnapshotFile(local, file.deleted ? 'create' : 'update', 'offline-local', sendToRenderer);
        localFiles.delete(relPath);
        uploaded++;
        continue;
      }

      if (previous && !localChangedSinceBaseline && remoteChangedSinceBaseline) {
        applyFileChange({
          ...file,
          relativePath: relPath,
          action: file.deleted ? 'delete' : 'update',
          contentBase64: file.contentBase64 || '',
          sha256: remoteHash,
          updatedAt: file.updatedAt || file.timestamp,
        }, sendToRenderer);
        localFiles.delete(relPath);
        applied++;
        continue;
      }

      if (localChangedSinceBaseline && remoteChangedSinceBaseline) {
        applyRemoteSnapshotOverDivergedLocal(relPath, file, sendToRenderer);
        localFiles.delete(relPath);
        applied++;
        blocked++;
        continue;
      }
    } else if (previous && !previous.deleted && !file.deleted && !serverAuthoritativeAdoption) {
      const remoteChangedSinceBaseline = previous.deleted !== !!file.deleted || previous.sha256 !== remoteHash;
      if (!remoteChangedSinceBaseline) {
        const aiDeleteHold = consumeAIServerDeleteHold(relPath);
        if (aiDeleteHold) {
          publishAIServerDelete(relPath, aiDeleteHold, undefined, sendToRenderer);
          blocked++;
          continue;
        }
        sendFileChange(relPath, 'delete', '', '', 'delete', sendToRenderer, new Date().toISOString(), {
          sha256: previous.sha256 || '',
          deleted: false,
          updatedAt: previous.updatedAt || '',
          size: Number(previous.size || 0),
        });
        markBaselineSynced(relPath, '', true, new Date().toISOString(), 0);
        applied++;
        continue;
      }
    }

    applyFileChange({
      ...file,
      relativePath: relPath,
      action: file.deleted ? 'delete' : 'update',
      contentBase64: file.contentBase64 || '',
      sha256: remoteHash,
      updatedAt: file.updatedAt || file.timestamp,
    }, sendToRenderer);
    localFiles.delete(relPath);
    applied++;
  }

  const initialServerSeed = remoteFiles.size === 0;

  for (const [relPath, local] of localFiles) {
    const previous = baseline.files[relPath];
    if (previous && !previous.deleted && previous.sha256 === local.sha256 && remoteFiles.has(relPath)) {
      continue;
    }

    if (initialServerSeed) {
      pushLocalSnapshotFile(local, 'create', 'initial-server-seed', sendToRenderer, {
        updatedAt: new Date().toISOString(),
        base: { sha256: '', deleted: false, updatedAt: '', size: 0 },
      });
      uploaded++;
      continue;
    }

    if (getJoinSnapshotAuthorityDecision({
      connectionMode,
      baselineFileCount,
      remoteFileCount: remoteFiles.size,
      baselineUpdatedAt: baseline.updatedAt,
      remoteMaxUpdatedAt,
      hasPreviousFileBaseline: !!previous,
    }).adoptLocalOnlyToRecovery) {
      adoptServerAuthorityForLocalOnlyFile(local, sendToRenderer);
      protectedLocalOnlyCount++;
      if (protectedFiles.length < PREFLIGHT_BLOCKED_FILE_LIMIT) protectedFiles.push(relPath);
      applied++;
      continue;
    }

    if (previous?.deleted) {
      const deletedAtMs = timeMs(previous.updatedAt);
      if (!isLocalNewerThanRemote(local.mtimeMs, deletedAtMs)) {
        skipped++;
        continue;
      }
    }

    if (previous && !previous.deleted) {
      const localChangedSinceBaseline = previous.sha256 !== local.sha256;
      const previousMs = timeMs(previous.updatedAt);
      if (!localChangedSinceBaseline || !isLocalNewerThanRemote(local.mtimeMs, previousMs)) {
        skipped++;
        continue;
      }
    }

    if (!previous && baselineFileCount > 0) {
      const baselineMs = timeMs(baseline.updatedAt);
      if (!isLocalNewerThanRemote(local.mtimeMs, baselineMs)) {
        skipped++;
        continue;
      }
    }

    pushLocalSnapshotFile(local, 'create', 'offline-local', sendToRenderer);
    uploaded++;
  }

  if (blocked > 0) {
    emitActivity(sendToRenderer, {
      direction: 'in',
      action: 'preflight-blocked-local-only',
      relativePath: `${blocked} local-only files`,
      timestamp: new Date().toISOString(),
    });
  }

  if (serverAuthoritativeAdoption) {
    state.queuedFilePushes.clear();
    state.preflightBlockedUploadCount = 0;
    state.preflightBlockedUploadFiles = [];
    clearLiveUploadFreeze(STALE_BASELINE_UPLOAD_REASON);
    const reason = 'first-connect-to-populated-server';
    state.lastServerAuthorityAdoption = {
      mode: authorityDecision.mode,
      reason,
      completedAt: new Date().toISOString(),
      baselineFileCount,
      remoteFileCount: remoteFiles.size,
      protectedCount: protectedLocalOnlyCount + protectedDivergedCount + protectedQueuedCount,
      protectedLocalOnlyCount,
      protectedDivergedCount,
      protectedQueuedCount,
      appliedRemoteCount: applied,
      matchedCount: matched,
      uploadedCount: uploaded,
      skippedCount: skipped,
      files: protectedFiles,
    };
    emitActivity(sendToRenderer, {
      direction: 'in',
      action: SERVER_AUTHORITATIVE_ADOPTION_REASON,
      relativePath: reason,
      timestamp: new Date().toISOString(),
    });
  } else {
    state.lastServerAuthorityAdoption = null;
  }

  if (applied > 0 || uploaded > 0 || matched > 0 || skipped > 0 || blocked > 0) {
    emitActivity(sendToRenderer, {
      direction: uploaded > 0 && applied === 0 ? 'out' : 'in',
      action: uploaded > 0 ? 'reconcile' : 'snapshot',
      relativePath: `${applied} in / ${uploaded} out / ${matched} same / ${skipped} skipped / ${blocked} blocked`,
      timestamp: new Date().toISOString(),
    });
  }

  state.preflightComplete = true;
  state.snapshotReconcileInProgress = false;
  sendToRenderer('live-sync:status', {
    connected: true,
    clientId: state.clientId,
    vaultId: state.syncConfig.vaultId,
    serverUrl: state.syncConfig.serverUrl,
    connectedAt: state.connectedAt,
    preflightComplete: true,
    receivedRemoteSnapshot: true,
    uploadFrozen: state.uploadFrozen,
    uploadFrozenReason: state.uploadFrozenReason,
    preflightBlockedUploadCount: state.preflightBlockedUploadCount,
    preflightBlockedUploadFiles: state.preflightBlockedUploadFiles.slice(0, PREFLIGHT_BLOCKED_FILE_LIMIT),
    deleteStormBlockedCount: state.deleteStormBlockedCount,
    deleteStormBlockedFiles: state.deleteStormBlockedFiles.slice(0, DELETE_STORM_BLOCKED_FILE_LIMIT),
    serverAuthorityAdoption: state.lastServerAuthorityAdoption,
  });
  flushQueuedFilePushes(sendToRenderer);
  autoApplySafeDeleteQueue(sendToRenderer, 'snapshot-reconcile-complete');
}

function applyFileChange(msg: any, sendToRenderer: (channel: string, data: any) => void): void {
  if (!state) return;

  const relPath = msg.relativePath;
  if (!relPath) return;
  if (isLiveSyncIgnoredPath(relPath)) return;
  if (isConflictArtifact(relPath)) return;
  const shouldRefreshAiManifest = isPortableAiMemoryPath(relPath);
  const hasReliableRemoteUpdatedAt = typeof msg.updatedAt === 'string' && msg.updatedAt.trim().length > 0;
  const remoteUpdatedAt = msg.updatedAt || msg.timestamp || '';
  const remoteMs = timeMs(remoteUpdatedAt);

  /* Mark as pending so our watcher doesn't re-broadcast it */
  state.pendingChanges.add(relPath);

  const fullPath = path.join(state.vaultPath, relPath.replace(/\//g, path.sep));
  let heldLocalForServerAuthority = false;

  if (msg.action === 'delete') {
    try {
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        const localHash = fileSha256(fullPath);
        const previous = readLiveBaseline().files[relPath];
        const localChangedSinceBaseline = !previous || previous.deleted || previous.sha256 !== localHash;
        if (isLocalNewerThanRemote(stat.mtimeMs, remoteMs) || (!hasReliableRemoteUpdatedAt && localChangedSinceBaseline)) {
          if (shouldApplyServerAuthorityOverIncomingConflict()) {
            saveLiveHistoryVersion(relPath, fullPath, 'server-authority-remote-delete-local-held');
            writeLocalConflictBackup(fullPath, relPath, sendToRenderer);
            heldLocalForServerAuthority = true;
            emitActivity(sendToRenderer, {
              direction: 'in',
              action: 'server-authority-local-held',
              relativePath: relPath,
              timestamp: new Date().toISOString(),
            });
          } else {
            saveLiveHistoryVersion(relPath, fullPath, 'stale-remote-delete-rejected');
            state.pendingChanges.delete(relPath);
            pushExistingLocalFile(relPath, fullPath, 'protect-local', sendToRenderer);
            emitActivity(sendToRenderer, {
              direction: 'out',
              action: 'protect-local',
              relativePath: relPath,
              timestamp: new Date().toISOString(),
            });
            return;
          }
        }
        if (!heldLocalForServerAuthority) {
          saveLiveHistoryVersion(relPath, fullPath, 'remote-delete');
        }
        fs.unlinkSync(fullPath);
      }
      forgetDeleteShadow(relPath);
      markBaselineSynced(relPath, '', true, remoteUpdatedAt, 0, baselineMetadataFrom(msg));
      emitActivity(sendToRenderer, {
        direction: 'in',
        action: 'delete',
        relativePath: relPath,
        timestamp: new Date().toISOString(),
      });
      sendToRenderer('live-sync:file-updated', { relativePath: relPath, action: 'delete' });
      if (shouldRefreshAiManifest) publishAiMemoryLiveManifest(sendToRenderer);
    } catch (err: any) {
      console.error('[LiveSync] Error deleting file:', fullPath, err.message);
    }
    return;
  }

  /* create or update */
  try {
    if (!msg.contentBase64) {
      state.pendingChanges.delete(relPath);
      return;
    }

    if (msg.sha256 && fs.existsSync(fullPath)) {
      const localHash = fileSha256(fullPath);
      if (localHash === msg.sha256) {
        markBaselineSynced(relPath, msg.sha256, false, remoteUpdatedAt, fs.statSync(fullPath).size, baselineMetadataFrom(msg));
        state.pendingChanges.delete(relPath);
        return;
      }
    }

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = Buffer.from(msg.contentBase64, 'base64');
    if (msg.action === 'update' && fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      const localHash = fileSha256(fullPath);
      const previous = readLiveBaseline().files[relPath];
      const localChangedSinceBaseline = !previous || previous.deleted || previous.sha256 !== localHash;
      if (isLocalNewerThanRemote(stat.mtimeMs, remoteMs) || (!hasReliableRemoteUpdatedAt && localChangedSinceBaseline)) {
        if (shouldApplyServerAuthorityOverIncomingConflict()) {
          saveLiveHistoryVersion(relPath, fullPath, 'server-authority-remote-overwrite-local-held');
          writeLocalConflictBackup(fullPath, relPath, sendToRenderer);
          heldLocalForServerAuthority = true;
          emitActivity(sendToRenderer, {
            direction: 'in',
            action: 'server-authority-local-held',
            relativePath: relPath,
            timestamp: new Date().toISOString(),
          });
        } else {
          saveLiveHistoryVersion(relPath, fullPath, 'stale-remote-overwrite-rejected');
          writeIncomingConflictCopy(fullPath, content, relPath, sendToRenderer);
          state.pendingChanges.delete(relPath);
          pushExistingLocalFile(relPath, fullPath, 'protect-local', sendToRenderer);
          emitActivity(sendToRenderer, {
            direction: 'out',
            action: 'protect-local',
            relativePath: relPath,
            timestamp: new Date().toISOString(),
          });
          return;
        }
      }
      if (!heldLocalForServerAuthority) {
        saveLiveHistoryVersion(relPath, fullPath, 'remote-overwrite');
      }
    }

    /*
     * Normal live sync should simply apply the latest remote edit.
     * Keep a conflict backup only when an unsent local edit exists.
     */
    if (!heldLocalForServerAuthority && msg.action === 'update' && fs.existsSync(fullPath) && msg.sha256 && state.queuedFilePushes.has(relPath)) {
      const localHash = fileSha256(fullPath);
      if (localHash !== msg.sha256) {
        writeLocalConflictBackup(fullPath, relPath, sendToRenderer);
      }
    }

    fs.writeFileSync(fullPath, content);
    const appliedHash = msg.sha256 || crypto.createHash('sha256').update(content).digest('hex');
    rememberDeleteShadow(relPath, content, appliedHash, remoteUpdatedAt);
    markBaselineSynced(relPath, appliedHash, false, remoteUpdatedAt, content.length, baselineMetadataFrom(msg));

    emitActivity(sendToRenderer, {
      direction: 'in',
      action: msg.action,
      relativePath: relPath,
      timestamp: new Date().toISOString(),
    });

    sendToRenderer('live-sync:file-updated', { relativePath: relPath, action: msg.action });
    if (shouldRefreshAiManifest) publishAiMemoryLiveManifest(sendToRenderer);
  } catch (err: any) {
    console.error('[LiveSync] Error applying file change:', fullPath, err.message);
  }
}

function respondToFileRequest(msg: any): void {
  if (!state) return;

  const relPath = msg.relativePath;
  const fullPath = path.join(state.vaultPath, relPath.replace(/\//g, path.sep));

  const response: any = {
    type: 'file-response',
    relativePath: relPath,
    targetClientId: msg.clientId,
  };

  if (fs.existsSync(fullPath)) {
    try {
      const content = fs.readFileSync(fullPath);
      response.contentBase64 = content.toString('base64');
      response.sha256 = crypto.createHash('sha256').update(content).digest('hex');
      response.exists = true;
    } catch {
      response.exists = false;
    }
  } else {
    response.exists = false;
  }

  wsSend(JSON.stringify(response));
}

function respondToFullSyncRequest(msg: any): void {
  if (!state) return;

  /* Walk the vault and collect all files with their hashes */
  const files = Array.from(collectLocalFileSnapshots().values()).map((file) => ({
    relativePath: file.relativePath,
    sha256: file.sha256,
    size: file.size,
  }));

  wsSend(JSON.stringify({
    type: 'full-sync-response',
    targetClientId: msg.clientId,
    files,
  }));
}
