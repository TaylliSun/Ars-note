/* ── Live Sync — WebSocket real-time vault sync (v1.0.0) ── */
/* Manages WebSocket connections per vault and broadcasts file changes */
/* Uses Node.js built-in http — still zero external dependencies */

import * as crypto from 'crypto';
import { SERVER_VERSION } from '../types';
import type { LiveFileHistoryEntry, LiveSyncClientEventEntry, LiveSyncClientHistoryEntry } from '../storage/storageTypes';

/** Connected client */
export interface LiveSyncClient {
  ws: any; /* WebSocket-like object (duck-typed for testability) */
  vaultId: string;
  clientId: string;
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  appVersion?: string;
  protocolVersion?: number;
  connectedAt: string;
  lastSeenAt: string;
  lastMessageType?: string;
  lastPingAt?: string;
  lastFileChangeAt?: string;
  lastAcceptedAt?: string;
  lastRejectedAt?: string;
  lastRejectedReason?: string;
  lastRelativePath?: string;
  lastAction?: string;
  receivedCount: number;
  sentCount: number;
  bytesReceived: number;
  deleteEventTimestamps: number[];
  lastSnapshotSentAt?: string;
  rebuildSafetySnapshotAt?: string;
  rebuildSafetySnapshotFileName?: string;
}

export const LIVE_SYNC_PROTOCOL_VERSION = 4;
const STALE_WRITE_GRACE_MS = 3000;
const STALE_BASELINE_UPLOAD_MS = 6 * 60 * 60 * 1000;
const REBUILD_SAFETY_SNAPSHOT_KEEP_LATEST = 30;
const DELETE_STORM_WINDOW_MS = 10 * 1000;
const DELETE_STORM_THRESHOLD = 10;
const DESTRUCTIVE_TRUNCATION_MIN_PREVIOUS_BYTES = 16 * 1024;
const DESTRUCTIVE_TRUNCATION_MAX_NEW_BYTES = 8 * 1024;
const DESTRUCTIVE_TRUNCATION_MAX_RATIO = 0.2;
const ALLOW_LEGACY_LIVE_WRITES = parseEnvBoolean(process.env.ARS_NOTE_ALLOW_LEGACY_LIVE_WRITES, false);
const DESTRUCTIVE_TRUNCATION_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.json', '.jsonc', '.yaml', '.yml',
  '.csv', '.tsv', '.canvas', '.excalidraw', '.taskpaper',
  '.js', '.ts', '.tsx', '.jsx', '.css', '.html', '.xml',
]);

export interface LiveSyncClientMetadata {
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  appVersion?: string;
  protocolVersion?: string | number;
}

export interface LiveSyncClientSummary {
  clientId: string;
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  appVersion?: string;
  protocolVersion?: number;
  requiredProtocolVersion: number;
  serverVersion: string;
  connectedAt: string;
  lastSeenAt: string;
  lastActivityAt: string;
  connectedSeconds: number;
  idleSeconds: number;
  receivedCount: number;
  sentCount: number;
  bytesReceived: number;
  webSocketStatus: 'online';
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
}

/** File change event broadcast to clients */
export interface FileChangeEvent {
  type: 'file-change';
  protocolVersion: number;
  vaultId: string;
  clientId: string;
  relativePath: string;
  action: 'create' | 'update' | 'delete';
  contentBase64: string;
  sha256: string;
  size?: number;
  updatedAt: string;
  timestamp: string;
  serverRevision?: number;
  revisionId?: string;
  updatedByClientId?: string;
  updatedByDeviceId?: string;
  baseServerRevision?: number;
  baseRevisionId?: string;
  clientMutationSource?: string;
}

/** Sync status event */
export interface SyncStatusEvent {
  type: 'sync-status';
  vaultId: string;
  clientCount: number;
  connectedClients: string[];
}

/** Welcome event sent on connection */
export interface WelcomeEvent {
  type: 'welcome';
  vaultId: string;
  clientId: string;
  clientCount: number;
  serverVersion: string;
  requiredProtocolVersion: number;
  legacyLiveWritesAllowed: boolean;
}

/** File request (pull a specific file from another client) */
export interface FileRequestEvent {
  type: 'file-request';
  vaultId: string;
  clientId: string;
  relativePath: string;
}

/** File response (response to file-request) */
export interface FileResponseEvent {
  type: 'file-response';
  vaultId: string;
  relativePath: string;
  contentBase64: string;
  sha256: string;
  exists: boolean;
}

/** Full sync request — get all file list from server */
export interface FullSyncRequest {
  type: 'full-sync-request';
  vaultId: string;
  clientId: string;
}

/** Full sync response — list of files with hashes */
export interface FullSyncResponse {
  type: 'full-sync-response';
  vaultId: string;
  files: Array<{ relativePath: string; sha256: string; size: number }>;
}

export interface LiveSnapshotEvent {
  type: 'live-snapshot';
  vaultId: string;
  files: Array<{
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
  }>;
  timestamp: string;
}

/** In-memory client registry: vaultId → Map<clientId, LiveSyncClient> */
const clientsByVault = new Map<string, Map<string, LiveSyncClient>>();

/* File validation and persistence must observe one server timeline per Vault. */
const liveMutationQueues = new Map<string, Promise<void>>();

function enqueueLiveMutation(vaultId: string, task: () => Promise<void>): Promise<void> {
  const previous = liveMutationQueues.get(vaultId) || Promise.resolve();
  let current: Promise<void>;
  current = previous
    .catch(() => { /* a failed write must not permanently block the Vault queue */ })
    .then(task)
    .finally(() => {
      if (liveMutationQueues.get(vaultId) === current) {
        liveMutationQueues.delete(vaultId);
      }
    });
  liveMutationQueues.set(vaultId, current);
  return current;
}

/** Generate a client ID */
export function generateClientId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/* ── Sync metrics (since server start) ── */

interface SyncMetrics {
  totalConnections: number;
  totalDisconnections: number;
  totalFileChanges: number;
  totalRejectedFileChanges: number;
  totalFileRequests: number;
  totalBytesTransferred: number;
  startedAt: string;
}

const metrics: SyncMetrics = {
  totalConnections: 0,
  totalDisconnections: 0,
  totalFileChanges: 0,
  totalRejectedFileChanges: 0,
  totalFileRequests: 0,
  totalBytesTransferred: 0,
  startedAt: new Date().toISOString(),
};

export function getSyncMetrics(): SyncMetrics {
  return { ...metrics };
}

export function getLiveSyncPolicy(): {
  requiredProtocolVersion: number;
  legacyLiveWritesAllowed: boolean;
  staleWriteGraceMs: number;
  deleteStormWindowMs: number;
  deleteStormThreshold: number;
  destructiveTruncationMinPreviousBytes: number;
  destructiveTruncationMaxNewBytes: number;
  destructiveTruncationMaxRatio: number;
} {
  return {
    requiredProtocolVersion: LIVE_SYNC_PROTOCOL_VERSION,
    legacyLiveWritesAllowed: ALLOW_LEGACY_LIVE_WRITES,
    staleWriteGraceMs: STALE_WRITE_GRACE_MS,
    deleteStormWindowMs: DELETE_STORM_WINDOW_MS,
    deleteStormThreshold: DELETE_STORM_THRESHOLD,
    destructiveTruncationMinPreviousBytes: DESTRUCTIVE_TRUNCATION_MIN_PREVIOUS_BYTES,
    destructiveTruncationMaxNewBytes: DESTRUCTIVE_TRUNCATION_MAX_NEW_BYTES,
    destructiveTruncationMaxRatio: DESTRUCTIVE_TRUNCATION_MAX_RATIO,
  };
}

function parseEnvBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function isLiveSyncablePath(relativePath: string): boolean {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) return false;
  if (normalized.startsWith('.ars-note/')) return false;
  if (normalized === '.ai-config.json') return false;
  if (normalized === '.ai-memory/live-session.json') return false;
  if (normalized === '.ai-memory/history') return false;
  if (normalized.startsWith('.ai-memory/history/')) return false;
  if (normalized.startsWith('__probe/')) return false;
  if (/(^|\/)[^/]+\.conflict-\d+$/.test(normalized)) return false;
  return true;
}

function parseProtocolVersion(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function compareSemver(left: unknown, right: unknown): number | null {
  const parse = (value: unknown): number[] | null => {
    const clean = String(value || '').trim().replace(/^v/i, '');
    const match = clean.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!match) return null;
    return [match[1], match[2] || '0', match[3] || '0'].map((part) => Number(part));
  };
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

export function summarizeLiveSyncClient(client: LiveSyncClient, now = Date.now()): LiveSyncClientSummary {
  const connectedMs = Date.parse(client.connectedAt || '') || now;
  const lastSeenMs = Date.parse(client.lastSeenAt || client.connectedAt || '') || connectedMs;
  const protocolVersion = parseProtocolVersion(client.protocolVersion);
  const versionStatus: LiveSyncClientSummary['versionStatus'] = client.appVersion ? 'ok' : 'unknown';
  const protocolStatus: LiveSyncClientSummary['protocolStatus'] = protocolVersion === undefined
    ? 'unknown'
    : protocolVersion < LIVE_SYNC_PROTOCOL_VERSION
      ? 'old'
      : 'ok';
  const safetyMessages: string[] = [];
  if (versionStatus === 'unknown') safetyMessages.push('Client app version is unknown.');
  if (protocolStatus === 'old') safetyMessages.push(`Client protocol v${protocolVersion} is older than required v${LIVE_SYNC_PROTOCOL_VERSION}.`);
  if (protocolStatus === 'unknown') safetyMessages.push('Client protocol version is unknown until it reconnects with the latest desktop build.');
  if (client.lastRejectedReason) safetyMessages.push(`Last write rejected: ${client.lastRejectedReason}.`);
  const idleSeconds = Math.max(0, Math.floor((now - lastSeenMs) / 1000));
  if (idleSeconds > 120) safetyMessages.push(`No WebSocket message for ${idleSeconds}s.`);

  const safetyLevel: LiveSyncClientSummary['safetyLevel'] = protocolStatus === 'old' || !!client.lastRejectedReason
    ? 'danger'
    : protocolStatus === 'unknown' || versionStatus === 'unknown' || idleSeconds > 120
      ? 'warning'
      : 'ok';

  return {
    clientId: client.clientId,
    deviceId: client.deviceId,
    deviceName: client.deviceName,
    platform: client.platform,
    appVersion: client.appVersion,
    protocolVersion,
    requiredProtocolVersion: LIVE_SYNC_PROTOCOL_VERSION,
    serverVersion: SERVER_VERSION,
    connectedAt: client.connectedAt,
    lastSeenAt: client.lastSeenAt,
    lastActivityAt: client.lastAcceptedAt || client.lastFileChangeAt || client.lastPingAt || client.lastSeenAt || client.connectedAt,
    connectedSeconds: Math.max(0, Math.floor((now - connectedMs) / 1000)),
    idleSeconds,
    receivedCount: client.receivedCount,
    sentCount: client.sentCount,
    bytesReceived: client.bytesReceived,
    webSocketStatus: 'online',
    safetyLevel,
    versionStatus,
    protocolStatus,
    safetyMessages,
    lastMessageType: client.lastMessageType,
    lastPingAt: client.lastPingAt,
    lastFileChangeAt: client.lastFileChangeAt,
    lastAcceptedAt: client.lastAcceptedAt,
    lastRejectedAt: client.lastRejectedAt,
    lastRejectedReason: client.lastRejectedReason,
    lastRelativePath: client.lastRelativePath,
    lastAction: client.lastAction,
  };
}

function getLiveSyncClientKey(client: LiveSyncClient): string {
  return String(client.deviceId || client.clientId || '').trim() || client.clientId;
}

export function summarizeLiveSyncClientHistory(
  client: LiveSyncClient,
  options: { webSocketStatus?: 'online' | 'offline'; disconnectedAt?: string; lastDisconnectReason?: string; now?: number } = {},
): LiveSyncClientHistoryEntry {
  const now = options.now || Date.now();
  const nowIso = new Date(now).toISOString();
  const summary = summarizeLiveSyncClient(client, now);
  const status = options.webSocketStatus || 'online';
  const safetyMessages = [...summary.safetyMessages];
  if (status === 'offline') {
    safetyMessages.push(`WebSocket disconnected${options.lastDisconnectReason ? `: ${options.lastDisconnectReason}` : ''}.`);
  }

  return {
    ...summary,
    vaultId: client.vaultId,
    clientKey: getLiveSyncClientKey(client),
    firstSeenAt: client.connectedAt,
    webSocketStatus: status,
    disconnectedAt: status === 'offline' ? (options.disconnectedAt || nowIso) : undefined,
    lastDisconnectReason: options.lastDisconnectReason,
    safetyMessages,
    updatedAt: nowIso,
  };
}

export async function persistLiveSyncClientHistory(
  storage: any,
  client: LiveSyncClient,
  options: { webSocketStatus?: 'online' | 'offline'; disconnectedAt?: string; lastDisconnectReason?: string; now?: number } = {},
): Promise<void> {
  if (typeof storage?.upsertLiveSyncClientHistory !== 'function') return;
  try {
    await storage.upsertLiveSyncClientHistory(client.vaultId, summarizeLiveSyncClientHistory(client, options));
  } catch {
    /* best-effort diagnostics only */
  }
}

export async function persistLiveSyncClientEvent(
  storage: any,
  client: LiveSyncClient,
  eventType: LiveSyncClientEventEntry['eventType'],
  details: Partial<Pick<
    LiveSyncClientEventEntry,
    'level' | 'relativePath' | 'action' | 'sha256' | 'reason' | 'currentSha256' | 'currentUpdatedAt' | 'currentDeleted' | 'historyRevisionId' | 'historyContentAvailable' | 'webSocketStatus' | 'createdAt' | 'messageType'
  >> = {},
): Promise<void> {
  if (typeof storage?.appendLiveSyncClientEvent !== 'function') return;
  const createdAt = details.createdAt || new Date().toISOString();
  const level = details.level || (eventType === 'file-rejected' ? 'danger' : eventType === 'disconnect' ? 'warning' : 'info');
  const event: LiveSyncClientEventEntry = {
    eventId: `${createdAt.replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`,
    vaultId: client.vaultId,
    clientKey: getLiveSyncClientKey(client),
    clientId: client.clientId,
    deviceId: client.deviceId,
    deviceName: client.deviceName,
    platform: client.platform,
    appVersion: client.appVersion,
    protocolVersion: parseProtocolVersion(client.protocolVersion),
    serverVersion: SERVER_VERSION,
    eventType,
    level,
    messageType: details.messageType || client.lastMessageType,
    relativePath: details.relativePath || client.lastRelativePath,
    action: details.action || client.lastAction,
    sha256: details.sha256,
    reason: details.reason,
    currentSha256: details.currentSha256,
    currentUpdatedAt: details.currentUpdatedAt,
    currentDeleted: details.currentDeleted,
    historyRevisionId: details.historyRevisionId,
    historyContentAvailable: details.historyContentAvailable,
    webSocketStatus: details.webSocketStatus || 'online',
    createdAt,
  };
  try {
    await storage.appendLiveSyncClientEvent(client.vaultId, event);
  } catch {
    /* best-effort diagnostics only */
  }
}

/** Get all clients for a vault */
export function getVaultClients(vaultId: string): LiveSyncClient[] {
  const vault = clientsByVault.get(vaultId);
  if (!vault) return [];
  return Array.from(vault.values());
}

/** Get total connection count */
export function getTotalConnections(): number {
  let count = 0;
  for (const vault of clientsByVault.values()) {
    count += vault.size;
  }
  return count;
}

/** Get total vault count with active connections */
export function getActiveVaultCount(): number {
  return clientsByVault.size;
}

/** Get active clients grouped by vault for admin/status views */
export function getLiveSyncClientSnapshot(): Array<{ vaultId: string; clients: LiveSyncClientSummary[] }> {
  const now = Date.now();
  return Array.from(clientsByVault.entries()).map(([vaultId, clients]) => ({
    vaultId,
    clients: Array.from(clients.values()).map((client) => summarizeLiveSyncClient(client, now)),
  }));
}

function cleanMetadataValue(value?: string): string | undefined {
  const text = String(value || '').trim();
  if (!text) return undefined;
  return text.slice(0, 96);
}

/** Register a new client connection */
export function registerClient(vaultId: string, ws: any, metadata: LiveSyncClientMetadata = {}): LiveSyncClient {
  const clientId = generateClientId();
  const client: LiveSyncClient = {
    ws,
    vaultId,
    clientId,
    deviceId: cleanMetadataValue(metadata.deviceId),
    deviceName: cleanMetadataValue(metadata.deviceName),
    platform: cleanMetadataValue(metadata.platform),
    appVersion: cleanMetadataValue(metadata.appVersion),
    protocolVersion: parseProtocolVersion(metadata.protocolVersion),
    connectedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    receivedCount: 0,
    sentCount: 0,
    bytesReceived: 0,
    deleteEventTimestamps: [],
  };

  if (!clientsByVault.has(vaultId)) {
    clientsByVault.set(vaultId, new Map());
  }
  clientsByVault.get(vaultId)!.set(clientId, client);

  metrics.totalConnections++;

  return client;
}

/** Remove a client connection */
export function unregisterClient(vaultId: string, clientId: string): void {
  const vault = clientsByVault.get(vaultId);
  if (!vault) return;
  vault.delete(clientId);
  metrics.totalDisconnections++;
  if (vault.size === 0) {
    clientsByVault.delete(vaultId);
  }
}

/** Send a message to all clients in a vault EXCEPT the sender */
export function broadcastToVault(vaultId: string, senderClientId: string, message: any): number {
  const vault = clientsByVault.get(vaultId);
  if (!vault) return 0;

  let sent = 0;
  const data = JSON.stringify(message);
  for (const [cid, client] of vault) {
    if (cid === senderClientId) continue;
    try {
      client.ws.send(data);
      client.sentCount++;
      sent++;
    } catch {
      /* client disconnected, will be cleaned up */
    }
  }
  return sent;
}

/** Send a message to a specific client */
export function sendToClient(vaultId: string, clientId: string, message: any): boolean {
  const vault = clientsByVault.get(vaultId);
  if (!vault) return false;
  const client = vault.get(clientId);
  if (!client) return false;
  try {
    client.ws.send(JSON.stringify(message));
    client.sentCount++;
    return true;
  } catch {
    return false;
  }
}

function normalizeEventUpdatedAt(value?: string): string {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function eventTimeMs(value?: string): number {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function liveStateHash(file: any): string {
  return file?.deleted ? '' : String(file?.sha256 || '');
}

function liveStateDeleted(file: any): boolean {
  return !!file?.deleted;
}

function incomingHash(msg: any): string {
  return msg.action === 'delete' ? '' : String(msg.sha256 || '');
}

function incomingDeleted(msg: any): boolean {
  return msg.action === 'delete';
}

function incomingContentSize(msg: any): number {
  if (msg.action === 'delete' || typeof msg.contentBase64 !== 'string') return 0;
  try {
    return Buffer.from(msg.contentBase64, 'base64').length;
  } catch {
    return 0;
  }
}

function relativePathExtension(relativePath: unknown): string {
  const normalized = String(relativePath || '').replace(/\\/g, '/').toLowerCase();
  const name = normalized.split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot) : '';
}

function incomingProtocolVersion(msg: any): number {
  const parsed = Number(msg?.protocolVersion ?? 1);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function hasServerSnapshotWriteProof(msg: any): boolean {
  return msg?.clientHasServerSnapshot === true
    && msg?.clientPreflightComplete === true
    && typeof msg?.clientSnapshotReceivedAt === 'string'
    && msg.clientSnapshotReceivedAt.trim().length > 0
    && typeof msg?.clientBaselineUpdatedAt === 'string'
    && msg.clientBaselineUpdatedAt.trim().length > 0;
}

function incomingConnectionMode(msg: any): 'join' | 'rebuild' {
  return msg?.clientConnectionMode === 'rebuild' ? 'rebuild' : 'join';
}

function isAllowedFileAction(action: unknown): action is 'create' | 'update' | 'delete' {
  return action === 'create' || action === 'update' || action === 'delete';
}

function validateIncomingFileChange(msg: any): string | null {
  if (!isAllowedFileAction(msg?.action)) return 'invalid-action';
  if (typeof msg.relativePath !== 'string' || !msg.relativePath.trim()) return 'invalid-path';

  if (msg.action === 'delete') return null;

  if (typeof msg.contentBase64 !== 'string') return 'missing-content';

  const declaredSha = String(msg.sha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(declaredSha)) return 'invalid-sha256';

  try {
    const content = Buffer.from(msg.contentBase64, 'base64');
    const actualSha = crypto.createHash('sha256').update(content).digest('hex');
    if (actualSha !== declaredSha) return 'content-sha-mismatch';
  } catch {
    return 'invalid-content';
  }

  return null;
}

function hasClientBase(msg: any): boolean {
  return (
    typeof msg.baseSha256 === 'string' ||
    typeof msg.baseDeleted === 'boolean' ||
    typeof msg.baseUpdatedAt === 'string' ||
    typeof msg.baseRevisionId === 'string' ||
    Number(msg.baseServerRevision || 0) > 0
  );
}

function baseMatchesCurrent(msg: any, current: any): boolean {
  if (!hasClientBase(msg)) return true;
  const baseDeleted = !!msg.baseDeleted;
  const baseSha256 = baseDeleted ? '' : String(msg.baseSha256 || '');
  return liveStateDeleted(current) === baseDeleted && liveStateHash(current) === baseSha256;
}

function baseRevisionMismatch(msg: any, current: any): boolean {
  if (!hasClientBase(msg) || !current) return false;
  const baseRevisionId = String(msg.baseRevisionId || '').trim();
  const currentRevisionId = String(current?.revisionId || '').trim();
  if (baseRevisionId && currentRevisionId && baseRevisionId !== currentRevisionId) return true;

  const baseServerRevision = Number(msg.baseServerRevision || 0);
  const currentServerRevision = Number(current?.serverRevision || 0);
  if (
    Number.isFinite(baseServerRevision)
    && baseServerRevision > 0
    && Number.isFinite(currentServerRevision)
    && currentServerRevision > 0
    && Math.floor(baseServerRevision) !== Math.floor(currentServerRevision)
  ) {
    return true;
  }

  return false;
}

function hasKnownNonDeletedBase(msg: any): boolean {
  if (!hasClientBase(msg) || !!msg.baseDeleted) return false;
  return !!(
    String(msg.baseSha256 || '').trim()
    || String(msg.baseUpdatedAt || '').trim()
    || String(msg.baseRevisionId || '').trim()
    || Number(msg.baseServerRevision || 0) > 0
  );
}

function rejectNoCurrentWriteWithoutKnownBase(
  msg: any,
  updatedAt: string,
  serverSnapshotSentAt?: string,
): string | null {
  if (incomingConnectionMode(msg) === 'rebuild') return null;
  if (msg.action === 'delete') return 'server-missing-base-file';

  const incomingMs = eventTimeMs(updatedAt);
  const snapshotMs = eventTimeMs(serverSnapshotSentAt);
  const baselineMs = eventTimeMs(msg?.clientBaselineUpdatedAt);

  if (!incomingMs || !snapshotMs) return 'pre-snapshot-local-write';

  if (baselineMs > 0 && snapshotMs - baselineMs > STALE_BASELINE_UPLOAD_MS) {
    return 'stale-baseline-missing-base-write';
  }

  if (incomingMs + STALE_WRITE_GRACE_MS >= snapshotMs) return null;
  if (baselineMs > 0 && incomingMs > baselineMs + STALE_WRITE_GRACE_MS) return null;

  return 'pre-snapshot-local-write';
}

function incomingMatchesCurrent(msg: any, current: any): boolean {
  return liveStateDeleted(current) === incomingDeleted(msg) && liveStateHash(current) === incomingHash(msg);
}

function isUnsafeDeletedTombstoneResurrection(msg: any, current: any): boolean {
  if (!current?.deleted || incomingDeleted(msg)) return false;

  const incomingMs = eventTimeMs(msg.updatedAt || msg.clientUpdatedAt || msg.timestamp);
  const tombstoneMs = eventTimeMs(current.updatedAt);

  /*
   * A deleted live file is a tombstone, not an empty slot. If an old device
   * still has a local copy, it may try to "create" the file again from a
   * deleted base. Only allow that resurrection when the client proves this is
   * a fresh edit after the tombstone time.
   */
  if (!incomingMs || !tombstoneMs) return true;
  return incomingMs <= tombstoneMs + STALE_WRITE_GRACE_MS;
}

async function findLatestDeletedLiveHistoryEntry(
  storage: any,
  vaultId: string,
  relativePath: string,
): Promise<LiveFileHistoryEntry | null> {
  if (typeof storage?.listLiveHistory !== 'function') return null;
  try {
    const history = await storage.listLiveHistory(vaultId, relativePath, 40);
    if (!Array.isArray(history)) return null;
    return history.find((item: LiveFileHistoryEntry) => (
      !!item
      && !!item.deleted
      && /delete/i.test(String(item.action || ''))
    )) || null;
  } catch {
    return null;
  }
}

function shouldRejectPrunedTombstoneHistoryResurrection(
  msg: any,
  deletedHistory: LiveFileHistoryEntry | null,
  updatedAt: string,
): string | null {
  if (!deletedHistory || incomingDeleted(msg)) return null;

  const incomingSha = incomingHash(msg);
  const deletedSha = String(deletedHistory.sha256 || '').trim().toLowerCase();
  if (incomingSha && deletedSha && incomingSha === deletedSha) {
    return 'pruned-tombstone-content-resurrection';
  }

  const incomingMs = eventTimeMs(updatedAt);
  const deletedMs = eventTimeMs(deletedHistory.updatedAt || deletedHistory.recordedAt);
  if (!incomingMs || !deletedMs) return 'pruned-tombstone-resurrection';
  if (incomingMs <= deletedMs + STALE_WRITE_GRACE_MS) return 'pruned-tombstone-resurrection';

  const baselineMs = eventTimeMs(msg?.clientBaselineUpdatedAt);
  if (baselineMs > 0 && baselineMs <= deletedMs + STALE_WRITE_GRACE_MS) {
    return 'pruned-tombstone-stale-baseline';
  }

  return null;
}

function isUnsafeDestructiveTruncation(msg: any, current: any): boolean {
  if (!current || current.deleted || incomingDeleted(msg)) return false;
  const ext = relativePathExtension(msg.relativePath);
  if (!DESTRUCTIVE_TRUNCATION_EXTENSIONS.has(ext)) return false;

  const currentSize = Math.max(0, Math.floor(Number(current.size) || 0));
  const nextSize = incomingContentSize(msg);
  if (currentSize < DESTRUCTIVE_TRUNCATION_MIN_PREVIOUS_BYTES) return false;
  if (nextSize === 0) return true;
  return nextSize <= DESTRUCTIVE_TRUNCATION_MAX_NEW_BYTES
    && nextSize <= Math.floor(currentSize * DESTRUCTIVE_TRUNCATION_MAX_RATIO);
}

export function shouldTriggerServerDeleteStormGuard(
  timestamps: number[],
  now = Date.now(),
  threshold = DELETE_STORM_THRESHOLD,
  windowMs = DELETE_STORM_WINDOW_MS,
): boolean {
  const cutoff = now - Math.max(1, windowMs);
  return timestamps.filter((ts) => Number.isFinite(ts) && ts >= cutoff && ts <= now + 1000).length >= Math.max(1, threshold);
}

function shouldRejectDeleteStorm(client: LiveSyncClient, msg: any): string | null {
  if (msg.action !== 'delete') return null;
  if (msg.clientMutationSource === 'safe-delete-queue' || msg.clientMutationSource === 'ai-delete') return null;
  if (
    incomingProtocolVersion(msg) >= LIVE_SYNC_PROTOCOL_VERSION
    && hasServerSnapshotWriteProof(msg)
    && hasKnownNonDeletedBase(msg)
  ) {
    return null;
  }
  const now = Date.now();
  const cutoff = now - DELETE_STORM_WINDOW_MS;
  client.deleteEventTimestamps = client.deleteEventTimestamps.filter((ts) => ts >= cutoff);
  client.deleteEventTimestamps.push(now);
  return shouldTriggerServerDeleteStormGuard(client.deleteEventTimestamps, now)
    ? 'delete-storm-guard'
    : null;
}

export function shouldRejectIncomingWrite(
  msg: any,
  current: any,
  updatedAt: string,
  options: { serverSnapshotSentToClient?: boolean; serverSnapshotSentAt?: string } = {},
): string | null {
  const protocolVersion = incomingProtocolVersion(msg);
  if (protocolVersion < LIVE_SYNC_PROTOCOL_VERSION && !ALLOW_LEGACY_LIVE_WRITES) {
    return 'legacy-client-protocol';
  }

  const validationError = validateIncomingFileChange(msg);
  if (validationError) return validationError;

  if (protocolVersion >= 3 && (!options.serverSnapshotSentToClient || !hasServerSnapshotWriteProof(msg))) {
    return 'missing-server-snapshot-proof';
  }

  if (!current) {
    if (hasKnownNonDeletedBase(msg)) return 'server-missing-base-file';
    if (protocolVersion >= 3) {
      return rejectNoCurrentWriteWithoutKnownBase(msg, updatedAt, options.serverSnapshotSentAt);
    }
    return null;
  }
  if (incomingMatchesCurrent(msg, current)) return null;
  if (!hasClientBase(msg)) return 'missing-base-version';

  const incomingMs = eventTimeMs(updatedAt);
  const currentMs = eventTimeMs(current.updatedAt);
  if (incomingMs > 0 && currentMs > 0 && incomingMs + STALE_WRITE_GRACE_MS < currentMs) {
    return 'stale-write';
  }

  if (isUnsafeDestructiveTruncation(msg, current)) {
    return 'destructive-truncation';
  }

  if (isUnsafeDeletedTombstoneResurrection(msg, current)) {
    return 'deleted-tombstone-resurrection';
  }

  if (baseRevisionMismatch(msg, current)) {
    return 'base-revision-mismatch';
  }

  if (!baseMatchesCurrent(msg, current)) {
    return 'base-version-mismatch';
  }

  return null;
}

async function recordRejectedWrite(client: LiveSyncClient, storage: any, vaultId: string, msg: any, updatedAt: string, reason: string): Promise<{ revisionId?: string; contentAvailable: boolean }> {
  if (typeof storage?.recordRejectedLiveFile !== 'function') return { contentAvailable: false };
  try {
    const content = typeof msg.contentBase64 === 'string' ? Buffer.from(msg.contentBase64, 'base64') : null;
    const record = await storage.recordRejectedLiveFile(vaultId, msg.relativePath, msg.action, content, incomingHash(msg), updatedAt, reason, {
      clientId: msg.clientId || client.clientId,
      deviceId: msg.deviceId || client.deviceId,
    });
    return {
      revisionId: record?.revisionId,
      contentAvailable: !!record?.contentBase64,
    };
  } catch {
    return { contentAvailable: false };
  }
}

async function rejectFileChange(client: LiveSyncClient, storage: any, msg: any, updatedAt: string, reason: string, current: any): Promise<void> {
  const vaultId = client.vaultId;
  metrics.totalRejectedFileChanges++;
  client.lastRejectedAt = new Date().toISOString();
  client.lastRejectedReason = reason;
  client.lastRelativePath = msg.relativePath;
  client.lastAction = msg.action;
  const rejectedHistory = await recordRejectedWrite(client, storage, vaultId, msg, updatedAt, reason);
  await persistLiveSyncClientEvent(storage, client, 'file-rejected', {
    level: 'danger',
    relativePath: msg.relativePath,
    action: msg.action,
    sha256: incomingHash(msg),
    reason,
    currentSha256: current?.sha256 || '',
    currentUpdatedAt: current?.updatedAt,
    currentDeleted: !!current?.deleted,
    historyRevisionId: rejectedHistory.revisionId,
    historyContentAvailable: rejectedHistory.contentAvailable,
  });
  await persistLiveSyncClientHistory(storage, client);
  sendToClient(vaultId, client.clientId, {
    type: 'file-rejected',
    protocolVersion: LIVE_SYNC_PROTOCOL_VERSION,
    vaultId,
    clientId: client.clientId,
    relativePath: msg.relativePath,
    action: msg.action,
    sha256: incomingHash(msg),
    updatedAt,
    reason,
    historyRevisionId: rejectedHistory.revisionId,
    historyContentAvailable: rejectedHistory.contentAvailable,
    rejectedSourceClientId: msg.clientId || client.clientId,
    rejectedSourceDeviceId: msg.deviceId || client.deviceId,
    requiredProtocolVersion: LIVE_SYNC_PROTOCOL_VERSION,
    legacyLiveWritesAllowed: ALLOW_LEGACY_LIVE_WRITES,
    current: current ? {
      relativePath: current.relativePath,
      sha256: current.sha256 || '',
      size: current.size || 0,
      updatedAt: current.updatedAt,
      deleted: !!current.deleted,
      contentBase64: current.contentBase64 || '',
    } : null,
    timestamp: new Date().toISOString(),
  });
}

async function ensureRebuildSafetySnapshotBeforeWrite(client: LiveSyncClient, storage: any, msg: any): Promise<string | null> {
  if (incomingConnectionMode(msg) !== 'rebuild') return null;
  if (client.rebuildSafetySnapshotAt) return null;
  if (typeof storage?.createServerDataSnapshot !== 'function') {
    return 'rebuild-safety-snapshot-unavailable';
  }

  try {
    const label = String(client.deviceName || client.deviceId || client.clientId || 'unknown-client')
      .replace(/[^\w .@-]+/g, '-')
      .slice(0, 80);
    const snapshot = await storage.createServerDataSnapshot({
      reason: `before-live-rebuild:${client.vaultId}:${label}`,
      keepLatest: REBUILD_SAFETY_SNAPSHOT_KEEP_LATEST,
    });
    client.rebuildSafetySnapshotAt = snapshot?.exportedAt || new Date().toISOString();
    client.rebuildSafetySnapshotFileName = snapshot?.fileName;
    await persistLiveSyncClientHistory(storage, client);
    await persistLiveSyncClientEvent(storage, client, 'connect', {
      level: 'warning',
      reason: 'rebuild-safety-snapshot-created',
      currentSha256: client.rebuildSafetySnapshotFileName,
      currentUpdatedAt: client.rebuildSafetySnapshotAt,
    });
    return null;
  } catch (err: any) {
    console.error('[LiveSync] Failed to create rebuild safety snapshot:', err?.message || err);
    return 'rebuild-safety-snapshot-failed';
  }
}

async function processFileChange(client: LiveSyncClient, msg: any, storage: any): Promise<void> {
  const vaultId = client.vaultId;
  const relativePath = typeof msg.relativePath === 'string'
    ? msg.relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
    : '';
  if (!isLiveSyncablePath(relativePath)) return;
  msg = { ...msg, relativePath };
  client.protocolVersion = incomingProtocolVersion(msg);
  client.lastFileChangeAt = new Date().toISOString();
  client.lastRelativePath = relativePath;
  client.lastAction = msg.action;

  const updatedAt = normalizeEventUpdatedAt(msg.updatedAt || msg.clientUpdatedAt || msg.timestamp);
  const current = typeof storage?.getLiveFile === 'function'
    ? await storage.getLiveFile(vaultId, msg.relativePath).catch(() => null)
    : null;
  let rejectionReason = shouldRejectIncomingWrite(msg, current, updatedAt, {
    serverSnapshotSentToClient: !!client.lastSnapshotSentAt,
    serverSnapshotSentAt: client.lastSnapshotSentAt,
  });
  if (!rejectionReason && !current && msg.action !== 'delete') {
    const deletedHistory = await findLatestDeletedLiveHistoryEntry(storage, vaultId, msg.relativePath);
    rejectionReason = shouldRejectPrunedTombstoneHistoryResurrection(msg, deletedHistory, updatedAt);
  }

  if (rejectionReason) {
    await rejectFileChange(client, storage, msg, updatedAt, rejectionReason, current);
    return;
  }

  if (current && incomingMatchesCurrent(msg, current)) {
    client.lastAcceptedAt = new Date().toISOString();
    client.lastRejectedReason = undefined;
    await persistLiveSyncClientEvent(storage, client, 'file-accepted', {
      level: 'info',
      relativePath: msg.relativePath,
      action: msg.action,
      sha256: liveStateHash(current),
    });
    await persistLiveSyncClientHistory(storage, client);
    sendToClient(vaultId, client.clientId, {
      type: 'file-accepted',
      protocolVersion: LIVE_SYNC_PROTOCOL_VERSION,
      vaultId,
      relativePath: msg.relativePath,
      action: msg.action,
      sha256: liveStateHash(current),
      size: current.size || 0,
      updatedAt: current.updatedAt,
      deleted: !!current.deleted,
      serverRevision: current.serverRevision,
      revisionId: current.revisionId,
      updatedByClientId: current.updatedByClientId,
      updatedByDeviceId: current.updatedByDeviceId,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const deleteStormReason = shouldRejectDeleteStorm(client, msg);
  if (deleteStormReason) {
    await rejectFileChange(client, storage, msg, updatedAt, deleteStormReason, current);
    return;
  }

  const rebuildSnapshotReason = await ensureRebuildSafetySnapshotBeforeWrite(client, storage, msg);
  if (rebuildSnapshotReason) {
    await rejectFileChange(client, storage, msg, updatedAt, rebuildSnapshotReason, current);
    return;
  }

  try {
    if (msg.action === 'delete' && typeof storage?.deleteLiveFile === 'function') {
      await storage.deleteLiveFile(vaultId, msg.relativePath, updatedAt, {
        clientId: client.clientId,
        deviceId: client.deviceId,
      });
    } else if (msg.action !== 'delete' && typeof storage?.storeLiveFile === 'function') {
      const content = Buffer.from(msg.contentBase64, 'base64');
      await storage.storeLiveFile(vaultId, msg.relativePath, content, incomingHash(msg), updatedAt, {
        clientId: client.clientId,
        deviceId: client.deviceId,
      });
    }
  } catch (err: any) {
    await rejectFileChange(client, storage, msg, updatedAt, 'storage-write-failed', current);
    console.error('[LiveSync] Failed to persist live file change:', err?.message || err);
      return;
  }

  const persisted = typeof storage?.getLiveFile === 'function'
    ? await storage.getLiveFile(vaultId, msg.relativePath).catch(() => null)
    : null;
  const acceptedDeleted = !!persisted?.deleted || msg.action === 'delete';
  const acceptedSha = acceptedDeleted ? '' : (persisted?.sha256 || incomingHash(msg));
  const acceptedSize = acceptedDeleted ? 0 : Number(persisted?.size || Buffer.from(msg.contentBase64 || '', 'base64').length);
  const acceptedUpdatedAt = persisted?.updatedAt || updatedAt;
  const event: FileChangeEvent = {
    type: 'file-change',
    protocolVersion: LIVE_SYNC_PROTOCOL_VERSION,
    vaultId,
    clientId: client.clientId,
    relativePath: msg.relativePath,
    action: msg.action,
    contentBase64: acceptedDeleted ? '' : (persisted?.contentBase64 || msg.contentBase64 || ''),
    sha256: acceptedSha,
    size: acceptedSize,
    updatedAt: acceptedUpdatedAt,
    timestamp: new Date().toISOString(),
    serverRevision: persisted?.serverRevision,
    revisionId: persisted?.revisionId,
    updatedByClientId: persisted?.updatedByClientId,
    updatedByDeviceId: persisted?.updatedByDeviceId,
  };
  broadcastToVault(vaultId, client.clientId, event);
  sendToClient(vaultId, client.clientId, {
    type: 'file-accepted',
    protocolVersion: LIVE_SYNC_PROTOCOL_VERSION,
    vaultId,
    relativePath: msg.relativePath,
    action: msg.action,
    sha256: event.sha256,
    size: event.size || 0,
    updatedAt: event.updatedAt,
    deleted: acceptedDeleted,
    serverRevision: event.serverRevision,
    revisionId: event.revisionId,
    updatedByClientId: event.updatedByClientId,
    updatedByDeviceId: event.updatedByDeviceId,
    timestamp: event.timestamp,
  });
  client.lastAcceptedAt = event.timestamp;
  client.lastRejectedReason = undefined;
  await persistLiveSyncClientEvent(storage, client, 'file-accepted', {
    level: 'info',
    relativePath: event.relativePath,
    action: event.action,
    sha256: event.sha256,
    createdAt: event.timestamp,
  });
  await persistLiveSyncClientHistory(storage, client);
  metrics.totalFileChanges++;
  if (msg.contentBase64) {
    try { metrics.totalBytesTransferred += Buffer.from(msg.contentBase64, 'base64').length; } catch { /* ignore */ }
  }
}

/** Handle an incoming WebSocket message */
export function handleMessage(client: LiveSyncClient, raw: string, storage: any): void {
  client.lastSeenAt = new Date().toISOString();
  client.receivedCount++;
  client.bytesReceived += Buffer.byteLength(raw || '', 'utf-8');

  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return; /* ignore malformed messages */
  }

  const vaultId = client.vaultId;
  client.lastMessageType = typeof msg?.type === 'string' ? msg.type : 'unknown';
  const parsedProtocol = parseProtocolVersion(msg?.protocolVersion);
  if (parsedProtocol) client.protocolVersion = parsedProtocol;
  void persistLiveSyncClientHistory(storage, client);

  switch (msg.type) {
    case 'file-change': {
      enqueueLiveMutation(vaultId, () => processFileChange(client, msg, storage)).catch((err: any) => {
        console.error('[LiveSync] Failed to process file-change:', err?.message || err);
      });
      break;
    }

    case 'file-request': {
      /* Another client is requesting a file — broadcast the request */
      const req: FileRequestEvent = {
        type: 'file-request',
        vaultId,
        clientId: client.clientId,
        relativePath: msg.relativePath,
      };
      broadcastToVault(vaultId, client.clientId, req);
      metrics.totalFileRequests++;
      break;
    }

    case 'file-response': {
      /* A client is responding to a file request — route to the requester */
      const resp: FileResponseEvent = {
        type: 'file-response',
        vaultId,
        relativePath: msg.relativePath,
        contentBase64: msg.contentBase64 || '',
        sha256: msg.sha256 || '',
        exists: msg.exists !== false,
      };
      /* Send to the client that requested (msg.targetClientId) */
      if (msg.targetClientId) {
        sendToClient(vaultId, msg.targetClientId, resp);
      }
      break;
    }

    case 'full-sync-request': {
      /* Client wants to know what files exist on other clients */
      const syncReq: FullSyncRequest = {
        type: 'full-sync-request',
        vaultId,
        clientId: client.clientId,
      };
      broadcastToVault(vaultId, client.clientId, syncReq);
      break;
    }

    case 'full-sync-response': {
      /* A client responded with its file list — route to requester */
      if (msg.targetClientId) {
        const syncResp: FullSyncResponse = {
          type: 'full-sync-response',
          vaultId,
          files: msg.files || [],
        };
        sendToClient(vaultId, msg.targetClientId, syncResp);
      }
      break;
    }

    case 'ping': {
      /* Keep-alive ping */
      client.lastPingAt = new Date().toISOString();
      void persistLiveSyncClientHistory(storage, client);
      try {
        client.ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        client.sentCount++;
      } catch { /* ignore */ }
      break;
    }
  }
}

/** Create a welcome event for a newly connected client */
export function createWelcomeEvent(vaultId: string, clientId: string): WelcomeEvent {
  const vault = clientsByVault.get(vaultId);
  return {
    type: 'welcome',
    vaultId,
    clientId,
    clientCount: vault ? vault.size : 1,
    serverVersion: SERVER_VERSION,
    requiredProtocolVersion: LIVE_SYNC_PROTOCOL_VERSION,
    legacyLiveWritesAllowed: ALLOW_LEGACY_LIVE_WRITES,
  };
}
