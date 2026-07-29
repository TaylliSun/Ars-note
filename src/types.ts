/* ── Ars-note shared type definitions ── */

/** File tree node */
export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children: FileNode[];
  expanded?: boolean;
}

/** Vault metadata */
export interface VaultConfig {
  appName: string;
  vaultId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  appVersion: string;
}

/** Result from vault:create or vault:open IPC */
export interface VaultOpenResult {
  path: string;
  name: string;
  config: VaultConfig;
}

/** Vault settings */
export interface VaultSettings {
  theme: 'light' | 'dark';
  fontSize: number;
  autoSave: boolean;
  autoSaveDelay: number;
}

/** Template definition */
export interface TemplateDef {
  id: string;
  category: string;
  name: string;
  description: string;
  folder: string;
  defaultFileName: string;
  content: string;
}

/** Template category info */
export interface TemplateCategory {
  id: string;
  name: string;
  folder: string;
}

/** Parsed tag from markdown content */
export interface ParsedTag {
  name: string;
  line: number;
}

/** Parsed wiki-link from markdown content */
export interface WikiLink {
  target: string;
  line: number;
}

/** Entry in the vault index for one note */
/** Metadata extracted from markdown content */
export interface NoteMetadata {
  status?: string;
  priority?: string;
  owner?: string;
  updatedAt?: string;
  summary?: string;
}

export interface NoteIndexEntry {
  filePath: string;
  relativePath: string;
  fileName: string;
  title: string;
  tags: string[];
  wikiLinks: string[];
  metadata?: NoteMetadata;
}

/** Backlink info for a specific note */
export interface BacklinkEntry {
  filePath: string;
  relativePath: string;
  fileName: string;
  title: string;
  line: number;
  snippet: string;
}

/** Grouped incoming backlink */
export interface GroupedBacklink {
  filePath: string;
  relativePath: string;
  fileName: string;
  title: string;
  refCount: number;
  snippets: string[];
}

/** Rich outgoing link info with status, alias, and candidates */
export interface OutgoingLinkInfo {
  target: string;
  alias: string;
  status: 'resolved' | 'missing' | 'ambiguous';
  filePath: string;
  relativePath: string;
  fileName: string;
  title: string;
  candidates: CandidateFile[];
}

/** A candidate file for ambiguous wiki-link resolution */
export interface CandidateFile {
  filePath: string;
  relativePath: string;
  fileName: string;
  title: string;
}

/** Info about a note that uses a specific tag */
export interface TagNoteInfo {
  filePath: string;
  relativePath: string;
  fileName: string;
  title: string;
  tagCount: number;
}

/** The full vault index */
export interface VaultIndex {
  notes: Record<string, NoteIndexEntry>;
  updatedAt: string;
}

/** Search result entry */
export interface SearchResult {
  filePath: string;
  relativePath: string;
  fileName: string;
  title: string;
  line: number;
  snippet: string;
}

/* ── Graph data types ── */

export interface GraphNode {
  id: string;
  label: string;
  relativePath: string;
  type: 'note' | 'tag' | 'missing' | 'gameDoc';
  /** For gameDoc nodes: one of GameDocType */
  gameDocType?: string;
  linkCount: number;
  tagCount: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'wiki' | 'tag';
  label?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphSummary {
  totalNodes: number;
  totalEdges: number;
  noteNodes: number;
  tagNodes: number;
  missingNodes: number;
  gameDocNodes: number;
  gameDocByType: Record<string, number>;
}

/* ── Backup / Manifest types (v0.4.0) ── */

/** A single file entry in the vault manifest */
export interface VaultFileManifestEntry {
  id: string;
  relativePath: string;
  type: 'markdown' | 'asset' | 'config' | 'other';
  size: number;
  sha256: string;
  updatedAt: string;
  deleted: boolean;
}

/** The full vault manifest */
export interface VaultManifest {
  vaultId: string;
  vaultName: string;
  appVersion: string;
  generatedAt: string;
  fileCount: number;
  totalSize: number;
  files: VaultFileManifestEntry[];
}

/** Summary of a completed backup export */
export interface BackupSummary {
  backupId: string;
  vaultName: string;
  generatedAt: string;
  fileCount: number;
  totalSize: number;
  manifestPath: string;
  backupPath: string;
  skipped?: boolean;
  reason?: string;
  prunedBackups?: BackupPruneSummary;
}


/** A single backup entry in the backup list */
export interface BackupListItem {
  backupId: string;
  backupPath: string;
  generatedAt: string;
  fileCount: number;
  totalSize: number;
  manifestPath: string;
}

export interface BackupFileItem {
  relativePath: string;
  type: 'markdown' | 'asset' | 'config' | 'other' | string;
  size: number;
  sha256: string;
  updatedAt: string;
  exists: boolean;
}

export interface BackupFileListResult {
  backupId: string;
  backupPath: string;
  generatedAt: string;
  fileCount: number;
  totalSize: number;
  files: BackupFileItem[];
}

export interface BackupFileRestoreSummary {
  ok: boolean;
  backupId: string;
  relativePath: string;
  restoredPath: string;
  restoredAt: string;
  size: number;
}

export interface DeleteBackupSummary {
  backupId: string;
  backupPath: string;
  deletedAt: string;
}

export interface BackupPruneSummary {
  keepLatest: number;
  deletedCount: number;
  deletedSize: number;
  deletedBackups: Array<{ backupId: string; backupPath: string; totalSize: number }>;
}

export interface BackupExportOptions {
  skipIfUnchanged?: boolean;
  keepLatest?: number;
}

export type VaultStorageCleanupAction =
  | 'prune-backups'
  | 'clean-generated-history'
  | 'prune-ai-conversations';

export interface VaultStorageBucket {
  id: string;
  label: string;
  path: string;
  size: number;
  fileCount: number;
  cleanupAction?: VaultStorageCleanupAction | 'manual';
  safeToClean: boolean;
  description: string;
}

export interface VaultStorageReport {
  vaultPath: string;
  checkedAt: string;
  totalSize: number;
  totalFileCount: number;
  backupPayloadSize: number;
  teamProductionSize: number;
  portableAiMemorySize: number;
  suggestedReclaimableSize: number;
  backupKeepLatest: number;
  buckets: VaultStorageBucket[];
  warnings: string[];
}

export interface VaultStorageCleanupOptions {
  keepLatestBackups?: number;
  pruneBackups?: boolean;
  cleanGeneratedHistory?: boolean;
  pruneAiConversations?: boolean;
  keepAiConversations?: number;
}

export interface VaultStorageCleanupSummary {
  ok: boolean;
  cleanedAt: string;
  deletedCount: number;
  deletedSize: number;
  actions: Array<{ action: VaultStorageCleanupAction; deletedCount: number; deletedSize: number; detail: string }>;
  report: VaultStorageReport;
}

/** Summary of a completed backup restore */
export interface RestoreSummary {
  backupId: string;
  restoredTo: string;
  restoredAt: string;
  fileCount: number;
  totalSize: number;
  appliedToCurrentVault?: boolean;
  safetyBackupPath?: string;
}

/** Result of backup integrity verification */
export interface BackupVerifyResult {
  backupId: string;
  checkedAt: string;
  valid: boolean;
  fileCount: number;
  checkedFileCount: number;
  missingFiles: string[];
  hashMismatchFiles: string[];
  totalSize: number;
  errors: string[];
}

/* ── Sync Config types (v0.4.3) ── */

export type SyncProvider = 'local' | 'supabase' | 's3' | 'self-hosted' | 'custom';
export type SyncStatus = 'localOnly' | 'notConfigured' | 'configured' | 'syncing' | 'synced' | 'error';

export interface SyncConfig {
  enabled: boolean;
  provider: SyncProvider;
  status: SyncStatus;
  remoteVaultId?: string;
  lastSyncAt?: string;
  lastError?: string;
  endpoint?: string;
  bucket?: string;
}

/* ── Cloud Provider types (v0.5.2) ── */

export type CloudProviderId = 'local-mock' | 'supabase' | 's3' | 'self-hosted' | 'custom';
export type CloudProviderCapability = 'upload' | 'list' | 'download' | 'verify' | 'restore';

export interface CloudProviderInfo {
  id: CloudProviderId;
  label: string;
  description: string;
  implemented: boolean;
  requiresEndpoint: boolean;
  requiresBucket: boolean;
  capabilities: CloudProviderCapability[];
}

export interface ProviderValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/* ── S3 Runtime Credentials (v0.5.3) ── */

export interface S3RuntimeCredentials {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export interface S3CredentialStatus {
  hasCredentials: boolean;
  endpoint?: string;
  bucket?: string;
  region?: string;
  forcePathStyle?: boolean;
  lastSetAt?: string;
}

export interface S3ConnectionTestResult {
  checkedAt: string;
  ok: boolean;
  provider: 's3';
  endpoint?: string;
  bucket?: string;
  region?: string;
  canListBucket: boolean;
  canReadIndex: boolean;
  canWriteTestObject: boolean;
  canDeleteTestObject: boolean;
  errors: string[];
  warnings: string[];
}

/* ── Sync Snapshot & Compare types (v0.6.0) ── */

export interface SyncSnapshot {
  snapshotId: string;
  vaultId: string;
  vaultName: string;
  provider: string;
  generatedAt: string;
  manifestHash: string;
  fileCount: number;
  totalSize: number;
  source: 'local' | 'remote';
}

export type SyncCompareStatus = 'localOnly' | 'remoteOnly' | 'same' | 'localNewer' | 'remoteNewer' | 'diverged' | 'unknown';
export type SyncRecommendedAction = 'exportBackup' | 'uploadBackup' | 'downloadRemote' | 'verifyDownloaded' | 'manualReview' | 'none';

export interface SyncCompareResult {
  comparedAt: string;
  localSnapshot?: SyncSnapshot;
  remoteSnapshot?: SyncSnapshot;
  status: SyncCompareStatus;
  warnings: string[];
  recommendedAction: SyncRecommendedAction;
}

/* ── Sync Preview / File-level Diff (v0.6.2) ── */

export type SyncFileDiffStatus = 'modified' | 'unchanged' | 'localOnly' | 'remoteOnly';

export interface SyncFileDiff {
  relativePath: string;
  status: SyncFileDiffStatus;
  localSha256?: string;
  remoteSha256?: string;
  localSize?: number;
  remoteSize?: number;
}

export interface SyncPreviewResult {
  generatedAt: string;
  localFileCount: number;
  remoteFileCount: number;
  localOnlyCount: number;
  remoteOnlyCount: number;
  modifiedCount: number;
  unchangedCount: number;
  diffs: SyncFileDiff[];
}

export interface SyncConflictFile {
  path?: string;
  relativePath: string;
  originalRelativePath?: string;
  reason?: string;
  hiddenRecoveryCopy?: boolean;
  size: number;
  modifiedAt: string;
}

export interface SyncConflictPreview {
  conflictRelativePath: string;
  baseRelativePath: string;
  baseExists: boolean;
  baseSize: number;
  conflictSize: number;
  baseModifiedAt: string | null;
  conflictModifiedAt: string;
  baseContent: string;
  conflictContent: string;
  baseTruncated: boolean;
  conflictTruncated: boolean;
  diff: {
    baseLines: number;
    conflictLines: number;
    changedLines: number;
    firstChangedLine: number | null;
  };
}

export interface LiveHistoryItem {
  versionId: string;
  relativePath: string;
  savedAt: string;
  reason: string;
  deletedSnapshot?: boolean;
  size: number;
  sha256: string;
}

export interface LiveHistoryPreview extends LiveHistoryItem {
  content: string;
  contentTruncated: boolean;
  currentExists: boolean;
  currentSize: number;
  currentModifiedAt: string | null;
  currentContent: string;
  currentTruncated: boolean;
  diff: {
    baseLines: number;
    conflictLines: number;
    changedLines: number;
    firstChangedLine: number | null;
  };
}

export interface LiveHistoryBatchRestoreItem extends LiveHistoryItem {
  currentExists: boolean;
  currentSize: number;
  currentModifiedAt: string | null;
  currentSha256: string;
  action: 'restore' | 'skip';
  skipReason?: string;
}

export interface LiveHistoryBatchRestorePlan {
  checkedAt: string;
  source?: 'local' | 'server';
  sinceHours: number;
  includeAllReasons: boolean;
  limit: number;
  totalCandidates: number;
  restoreCount: number;
  skippedCount: number;
  items: LiveHistoryBatchRestoreItem[];
  warnings: string[];
}

export interface ProtectedLocalRecoveryFile {
  relativePath: string;
  originalRelativePath: string;
  reason: string;
  size: number;
  modifiedAt: string;
}

export interface SyncRecoveryOverview {
  checkedAt: string;
  conflict: {
    count: number;
    totalSize: number;
    files: SyncConflictFile[];
  };
  history: {
    count: number;
    deletedCount: number;
    overwriteCount: number;
    recent: LiveHistoryItem[];
    deletedRecent: LiveHistoryItem[];
  };
  protectedLocal: {
    count: number;
    totalSize: number;
    files: ProtectedLocalRecoveryFile[];
  };
  aiTrash: {
    count: number;
    totalSize: number;
    files: Array<{ relativePath: string; originalRelativePath?: string; size: number; modifiedAt: string }>;
  };
  riskLevel: 'ok' | 'watch' | 'danger';
  recommendedActions: string[];
}

export interface SyncAccidentRecoveryAction {
  priority: number;
  source: 'conflict' | 'server-history' | 'local-history' | 'ai-trash' | 'manual';
  title: string;
  detail: string;
  count: number;
  recommended: boolean;
  files: string[];
}

export interface SyncAccidentRecoveryPlan {
  checkedAt: string;
  sinceHours: number;
  riskLevel: 'ok' | 'watch' | 'danger';
  recommendedSource: 'server-history' | 'local-history' | 'conflict' | 'ai-trash' | 'none';
  summary: {
    conflictCount: number;
    localRestoreCount: number;
    serverRestoreCount: number;
    aiTrashCount: number;
    localDeletedCount: number;
    serverDeletedCount: number;
  };
  actions: SyncAccidentRecoveryAction[];
  localPlan: LiveHistoryBatchRestorePlan;
  serverPlan: LiveHistoryBatchRestorePlan | null;
  serverError?: string;
  warnings: string[];
}

export type SyncRecoveryAdvisorAction =
  | 'keep-current'
  | 'merge-conflict'
  | 'resolve-conflict-latest'
  | 'restore-server-history'
  | 'restore-local-history'
  | 'restore-protected-local'
  | 'review-ai-trash';

export interface SyncRecoveryAdvisorCandidate {
  source: 'current' | 'conflict' | 'server-history' | 'local-history' | 'protected-local' | 'ai-trash';
  sourceRole?: 'current-local' | 'conflict-copy' | 'server-history' | 'same-computer-history' | 'other-computer-history' | 'protected-local' | 'ai-trash';
  relativePath: string;
  label?: string;
  versionId?: string;
  revisionId?: string;
  recoveryRelativePath?: string;
  reason?: string;
  savedAt?: string;
  modifiedAt?: string;
  updatedAt?: string;
  sha256?: string;
  size?: number;
  serverRevision?: number;
  clientId?: string;
  clientKey?: string;
  deviceId?: string;
  deviceName?: string;
  appVersion?: string;
  tombstoneExpiresAt?: string;
  deletedSnapshot?: boolean;
  restorable?: boolean;
  timeMs?: number;
}

export interface SyncRecoveryAdvisorItem {
  relativePath: string;
  recommendedAction: SyncRecoveryAdvisorAction;
  recommendedLabel: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  candidate: SyncRecoveryAdvisorCandidate | null;
  candidates: SyncRecoveryAdvisorCandidate[];
  canApply: boolean;
}

export interface SyncRecoveryAdvisorPlan {
  checkedAt: string;
  sinceHours: number;
  riskLevel: 'ok' | 'watch' | 'danger';
  summary: {
    totalFiles: number;
    applyReadyCount: number;
    reviewCount: number;
    keepCurrentCount: number;
    serverRecommendedCount: number;
    localRecommendedCount: number;
    protectedLocalRecommendedCount: number;
  };
  items: SyncRecoveryAdvisorItem[];
  localPlan: LiveHistoryBatchRestorePlan;
  serverPlan: LiveHistoryBatchRestorePlan | null;
  serverError?: string;
  warnings: string[];
  reportMarkdown: string;
}

export interface SafeSyncRecoveryAutopilotResult {
  ok: boolean;
  checkedAt: string;
  mode: string;
  archivedConflicts: {
    archivedCount: number;
    archivedSize: number;
    archiveRelativePath?: string;
  };
  appliedCount: number;
  draftedCount: number;
  failedCount: number;
  skippedCount: number;
  reportRelativePath?: string;
  planSummary: SyncRecoveryAdvisorPlan['summary'];
  nextSummary: SyncRecoveryAdvisorPlan['summary'];
  nextPlan: SyncRecoveryAdvisorPlan;
  overview: SyncRecoveryOverview;
  drafted: any[];
  failed: any[];
  skipped: any[];
}

export interface ServerDataSnapshotItem {
  exportedAt: string;
  fileName: string;
  size: number;
  sha256: string;
  sourceVaultCount: number;
  vaultCount: number;
  skippedCount: number;
  skipped: Array<{ vaultId: string; vaultName: string; error: string }>;
  reason?: string;
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

export interface ServerDataSnapshotListResult {
  ok: boolean;
  endpoint: string;
  vaultId: string;
  snapshots: ServerDataSnapshotItem[];
}

export interface ServerDataSnapshotCreateResult {
  ok: boolean;
  endpoint: string;
  vaultId: string;
  snapshot: ServerDataSnapshotItem;
}

export interface ServerDataExportBackupResult extends ServerDataSnapshotItem {
  ok: boolean;
  endpoint: string;
  vaultId: string;
  savedPath: string;
  relativePath: string;
}

export interface ServerSnapshotFileListResult {
  ok: boolean;
  endpoint: string;
  vaultId: string;
  fileName: string;
  snapshot?: ServerDataSnapshotItem | null;
  files: ServerSnapshotFileCandidate[];
}

export interface ServerSnapshotFileRestoreResult {
  ok: boolean;
  endpoint: string;
  vaultId: string;
  fileName: string;
  restoredPath: string;
  restoredAt: string;
  candidate: ServerSnapshotFileCandidate;
  preOperationSnapshot?: ServerDataSnapshotItem | null;
}

export interface LiveSyncSelfTestStep {
  name: string;
  ok: boolean;
  detail: string;
  durationMs?: number;
}

export interface LiveSyncSelfTestResult {
  ok: boolean;
  checkedAt: string;
  durationMs: number;
  vaultId?: string;
  serverUrl?: string;
  testFile?: string;
  steps: LiveSyncSelfTestStep[];
}

export interface AISafetySelfTestStep {
  name: string;
  ok: boolean;
  detail: string;
  durationMs?: number;
}

export interface AISafetySelfTestResult {
  ok: boolean;
  checkedAt: string;
  durationMs: number;
  testFile?: string;
  token?: string;
  recoveryPath?: string;
  auditEventCount?: number;
  steps: AISafetySelfTestStep[];
}

/* ── Cloud Backup types (v0.5.0) ── */

export interface AIOperationAuditEvent {
  version?: number;
  event: string;
  at: string;
  token?: string;
  toolName?: string;
  requestHash?: string;
  rollbackAvailable?: boolean;
  rollbackFileCount?: number;
  result?: string;
  error?: string;
}

export interface AIOperationRollbackPlanItem {
  relativePath: string;
  action: 'restore' | 'delete_created' | 'remove_directory' | 'skip';
  skipReason?: string;
  directory?: boolean;
  before?: {
    exists: boolean;
    sha256?: string;
    size?: number;
    hasContent?: boolean;
  };
  after?: {
    exists: boolean;
    sha256?: string;
    size?: number;
  };
  current?: {
    exists: boolean;
    isFile: boolean;
    sha256?: string;
    size?: number;
  };
}

export interface AIOperationRollbackPreview {
  ok: boolean;
  token: string;
  toolName: string;
  requestHash: string;
  operationStatus: string;
  rollbackStatus: string;
  createdAt: string;
  finalizedAt?: string;
  restorableCount: number;
  skippedCount: number;
  warnings: string[];
  items: AIOperationRollbackPlanItem[];
}

export interface AIOperationRollbackResult {
  ok: boolean;
  token: string;
  restoredCount: number;
  deletedCount: number;
  removedDirectoryCount: number;
  skippedCount: number;
  failedCount: number;
  restored?: string[];
  deleted?: string[];
  removedDirectories?: string[];
  skipped?: Array<{ relativePath: string; reason: string }>;
  failed?: Array<{ relativePath: string; error: string }>;
  plan?: AIOperationRollbackPreview;
  message?: string;
}

export interface RemoteBackupItem {
  remoteId: string;
  backupId: string;
  provider: string;
  vaultName: string;
  uploadedAt: string;
  fileCount: number;
  totalSize: number;
  manifestHash: string;
  remotePath: string;
}

export interface RemoteBackupDeleteSummary {
  remoteId: string;
  backupId?: string;
  provider: string;
  deletedAt: string;
  deleted?: boolean;
  deletedFiles?: number;
}

export interface CloudUploadSummary {
  remoteId: string;
  backupId: string;
  provider: string;
  uploadedAt: string;
  fileCount: number;
  totalSize: number;
  remotePath: string;
}

export interface CloudDownloadSummary {
  remoteId: string;
  downloadedTo: string;
  downloadedAt: string;
  fileCount: number;
  totalSize: number;
}

/** A downloaded remote backup entry */
export interface DownloadedBackupItem {
  downloadId: string;
  remoteId: string;
  backupId: string;
  downloadedAt: string;
  downloadedPath: string;
  fileCount: number;
  totalSize: number;
  manifestPath: string;
}


/* ── Self-hosted Sync Server types (v0.8.0) ── */

export interface SelfHostedSyncConfig {
  endpoint: string;
  serverVaultId?: string;
  clientId?: string;
}

export interface SelfHostedUploadSummary {
  ok: boolean;
  backupId: string;
  uploadSessionId: string;
  fileCount: number;
  totalSize: number;
}

export interface SelfHostedBackupItem {
  backupId: string;
  uploadedAt: string;
  fileCount: number;
  totalSize: number;
  manifestHash: string;
}

/* v0.8.2 Self-hosted runtime credentials (in-memory only) */
export interface SelfHostedRuntimeCredentials {
  endpoint: string;
  apiKey: string;
}

export interface SelfHostedCredentialStatus {
  hasCredentials: boolean;
  endpoint?: string;
  lastSetAt?: string;
}

/* ── Game Workspace types (v0.9.0) ── */

export type GameDocType =
  | 'gdd'
  | 'coreLoop'
  | 'worldbuilding'
  | 'story'
  | 'dialogue'
  | 'performance'
  | 'character'
  | 'item'
  | 'quest'
  | 'taskTable'
  | 'unityTask'
  | 'devlog';

export interface GameWorkspaceEntry {
  type: GameDocType;
  title: string;
  relativePath: string;
  tags: string[];
  status?: string;
  priority?: string;
  owner?: string;
  updatedAt?: string;
  summary?: string;
}

export interface GameWorkspaceSummary {
  gddCount: number;
  coreLoopCount: number;
  worldbuildingCount: number;
  storyCount: number;
  dialogueCount: number;
  performanceCount: number;
  characterCount: number;
  itemCount: number;
  questCount: number;
  taskTableCount: number;
  unityTaskCount: number;
  devlogCount: number;
  totalGameDocs: number;
  draftCount: number;
  doneCount: number;
  highPriorityCount: number;
}

export interface GameWorkspaceFilters {
  type: GameDocType | 'all';
  status: string;
  priority: string;
  owner: string;
  query: string;
}

export interface GameWorkspaceDashboard {
  missingCoreDocs: GameDocType[];
  highPriorityEntries: GameWorkspaceEntry[];
  draftEntries: GameWorkspaceEntry[];
  recentlyUpdatedEntries: GameWorkspaceEntry[];
  missingMetadataEntries: GameWorkspaceEntry[];
}

/* ── Arshis Integration (v1.0.0) ── */

export interface ArshisIntegrationConfig {
  enabled: boolean;
  projectName?: string;
  exportFolder?: string;
  lastExportedAt?: string;
}

export interface ArshisGameContext {
  generatedAt: string;
  projectName: string;
  summary: GameWorkspaceSummary;
  entries: GameWorkspaceEntry[];
  recommendedNextSteps: string[];
}

/* ── AI Assistant (v1.1.0) ── */

export type AIProvider = 'openai-compatible' | 'ollama' | 'custom';

export interface AIProviderConfig {
  enabled: boolean;
  provider: AIProvider;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  lastTestAt?: string;
  lastError?: string;
}


export type AIContextMode = 'currentNote' | 'gameWorkspace' | 'arshisContext';
export type AIControlMode = 'readonly' | 'member' | 'producer';

export type AITeamTaskStatus = 'todo' | 'doing' | 'review' | 'blocked' | 'done';
export type AITeamTaskPriority = 'high' | 'medium' | 'low';

export interface AITeamScheduleTaskSnapshot {
  title: string;
  owner: string;
  status: AITeamTaskStatus;
  priority: AITeamTaskPriority;
  dueDate: string;
  linkedDoc: string;
  deliverable: string;
  dependency: string;
  blocker: string;
  acceptance: string;
  notes: string;
  spentMinutes: number;
  updatedAt: string;
  latestReview?: {
    reviewer: string;
    date: string;
    result: 'approved' | 'changes' | 'note';
    note: string;
  } | null;
}

export interface AITeamScheduleContext {
  updatedAt: string;
  members: string[];
  total: number;
  active: number;
  done: number;
  overdue: number;
  blocked: number;
  dueSoon: number;
  missingOwner: number;
  missingDueDate: number;
  totalMinutes: number;
  topTasks: AITeamScheduleTaskSnapshot[];
}

export interface NarrativeTaskDraft {
  title: string;
  owner?: string;
  status?: AITeamTaskStatus;
  priority?: AITeamTaskPriority;
  dueDate?: string;
  estimateMinutes?: number;
  linkedDoc?: string;
  deliverable?: string;
  dependency?: string;
  blocker?: string;
  acceptance?: string;
  notes?: string;
}

export interface NarrativeTaskDraftSummary {
  generatedAt?: string;
  narrativeMissingStages?: number;
  narrativeWeakLinks?: number;
  docsWithoutNarrativeLinks?: number;
  qaItems?: number;
  draftedTasks?: number;
}

export interface NarrativeTaskDraftResult {
  ok: boolean;
  tasks: NarrativeTaskDraft[];
  summary: NarrativeTaskDraftSummary;
  health?: any;
  upsert?: { importedCount: number; updatedCount: number; skippedCount: number; schedulePath: string; content: string };
}

export interface TeamProductionDocsResult {
  paths: string[];
  summary: {
    taskDocs?: {
      createdCount?: number;
      linkedCount?: number;
      alreadyExistsCount?: number;
      upgradedCount?: number;
      skippedCount?: number;
      checkedCount?: number;
      paths?: string[];
      schedulePath?: string;
      content?: string;
    };
    [key: string]: any;
  };
}

export interface TeamWorkspaceBootstrapResult {
  ok: boolean;
  createdAt: string;
  taskCount: number;
  schedulePath: string;
  content: string;
  upsert: { importedCount: number; updatedCount: number; skippedCount: number; schedulePath: string; content: string };
  productionDocs: TeamProductionDocsResult;
  health?: any;
}

export interface TeamTaskDocsSyncResult {
  scannedCount: number;
  changedCount: number;
  addedLogCount: number;
  addedReviewCount: number;
  inferredStatusCount: number;
  missingCount: number;
  skippedCount: number;
  schedulePath: string;
  content: string;
}

export interface TeamServerProductionStatus {
  ok: boolean;
  vaultId: string;
  serverVaultId?: string;
  vaultName?: string;
  endpoint?: string;
  expectedVaultId?: string;
  expectedVaultName?: string;
  checkedAt?: string;
  onlineClients?: Array<{
    clientId: string;
    deviceId?: string;
    deviceName?: string;
    platform?: string;
    appVersion?: string;
    connectedAt?: string;
    lastSeenAt?: string;
    receivedCount?: number;
  }>;
  team?: {
    scheduleSynced?: boolean;
    scheduleUpdatedAt?: string | null;
    members?: number;
    memberNames?: string[];
    memberWork?: TeamServerMemberWorkSummary[];
    totalTasks?: number;
    activeTasks?: number;
    doneTasks?: number;
    blockedTasks?: number;
    overdueTasks?: number;
    dueSoonTasks?: number;
    missingOwnerTasks?: number;
    missingDueDateTasks?: number;
    missingDocTasks?: number;
    recentLogCount?: number;
    loggedMinutes?: number;
    teamDocs?: number;
    taskDocs?: number;
    aiMemoryFiles?: number;
    aiSkills?: number;
    aiMemoryManifestSynced?: boolean;
    aiMemoryCoreFiles?: Array<{
      key: string;
      label: string;
      relativePath: string;
      synced: boolean;
      inManifest?: boolean;
      updatedAt?: string | null;
      size?: number;
    }>;
    missingAiMemoryCoreFiles?: number;
    coreDocs?: Array<{
      key: string;
      label: string;
      relativePath: string;
      synced: boolean;
      updatedAt?: string | null;
      size?: number;
    }>;
    missingCoreDocs?: number;
    lastTeamFileAt?: string | null;
    warnings?: string[];
  };
  liveFileCount?: number;
  recentTeamFiles?: Array<{
    relativePath: string;
    size: number;
    updatedAt: string;
    deleted?: boolean;
  }>;
  sourceFiles?: {
    schedule?: boolean;
    aiMemoryManifest?: boolean;
    teamDocs?: number;
    taskDocs?: number;
    aiMemoryFiles?: number;
    aiSkills?: number;
    aiMemoryCoreFiles?: Array<{
      key: string;
      label: string;
      relativePath: string;
      synced: boolean;
      inManifest?: boolean;
      updatedAt?: string | null;
      size?: number;
    }>;
    missingAiMemoryCoreFiles?: number;
    coreDocs?: Array<{
      key: string;
      label: string;
      relativePath: string;
      synced: boolean;
      updatedAt?: string | null;
      size?: number;
    }>;
    missingCoreDocs?: number;
  };
}

export interface TeamServerMemberWorkLog {
  taskId: string;
  taskTitle: string;
  member: string;
  date: string;
  minutes: number;
  note: string;
  createdAt?: string;
}

export interface TeamServerMemberWorkTask {
  id: string;
  title: string;
  owner: string;
  status: string;
  priority: string;
  dueDate: string;
  linkedDoc: string;
  linkedDocSynced: boolean;
  deliverable: string;
  dependency: string;
  blocker: string;
  acceptance: string;
  notes: string;
  estimateMinutes: number;
  spentMinutes: number;
  memberSpentMinutes: number;
  updatedAt: string;
  latestLog: TeamServerMemberWorkLog | null;
}

export interface TeamServerMemberWorkSummary {
  member: string;
  totalTasks: number;
  activeTasks: number;
  doneTasks: number;
  blockedTasks: number;
  overdueTasks: number;
  dueSoonTasks: number;
  missingDocTasks: number;
  spentMinutes: number;
  todayMinutes: number;
  todayLogCount: number;
  recentLogCount: number;
}

export interface TeamServerMemberWorkStatus {
  ok: boolean;
  vaultId: string;
  serverVaultId?: string;
  vaultName?: string;
  endpoint?: string;
  expectedVaultId?: string;
  expectedVaultName?: string;
  checkedAt?: string;
  member: string;
  members: string[];
  memberWork: TeamServerMemberWorkSummary[];
  summary: TeamServerMemberWorkSummary | null;
  tasks: TeamServerMemberWorkTask[];
  recentLogs: TeamServerMemberWorkLog[];
  sourceFiles?: {
    schedule?: boolean;
    teamDocs?: number;
    taskDocs?: number;
  };
}

export interface AIRequestInput {
  prompt?: string;
  contextMode: AIContextMode;
  controlMode?: AIControlMode;
  currentFilePath?: string;
  currentFileContent?: string;
  selectedText?: string;
  gameWorkspaceSummary?: GameWorkspaceSummary;
  gameWorkspaceEntries?: GameWorkspaceEntry[];
  teamScheduleContext?: AITeamScheduleContext;
  arshisContext?: string;
}

export interface AIContextUsage {
  limitTokens: number;
  usedTokens: number;
  availableTokens: number;
  usedPercent: number;
  messageCount: number;
  compressed: boolean;
  compressionNotes: string[];
}

export interface AIResponse {
  ok: boolean;
  content?: string;
  error?: string;
  cancelled?: boolean;
  timedOut?: boolean;
  model?: string;
  contextUsage?: AIContextUsage;
  createdAt: string;
  toolCalls?: AIToolCallRecord[];
}

export interface AIArtifactSummary {
  path: string;
  type: 'markdown' | 'canvas' | 'wireframe' | 'image' | 'other';
  action: 'created' | 'updated' | 'copied' | 'checked' | 'deleted';
  qualityStatus: 'not_applicable' | 'checked' | 'auto_fixed';
  notes: string[];
}

export interface AIConnectionTestResult {
  ok: boolean;
  model?: string;
  error?: string;
  testedAt: string;
}

/* ── AI 5-Pillar System (v1.2.0) ── */

export interface AIToolCallRecord {
  name: string;
  args: Record<string, string>;
  result: string;
  status: 'running' | 'done' | 'error';
  artifacts?: AIArtifactSummary[];
}

export interface AIChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  toolCalls?: AIToolCallRecord[];
}

/* Pillar 1: Memory */
export interface AIMemoryEntry {
  id: string;
  content: string;
  createdAt: string;
  source: 'conversation' | 'consolidation' | 'skill' | 'manual';
  tags?: string[];
}

export interface AIMemoryStatus {
  memorySize: number;
  memoryCap: number;
  userSize: number;
  historyCount: number;
  needsConsolidation: boolean;
}

/* Pillar 2: Skills */
export interface AISkill {
  id: string;
  name: string;
  trigger: string;
  description: string;
  steps: string;
  createdAt: string;
  updatedAt: string;
  useCount: number;
  successRate: number;
  lastUsedAt?: string;
}

/* Pillar 3: Soul */
export interface AISoul {
  name: string;
  role: string;
  personality: string;
  directives: string[];
  language: string;
  expertise: string[];
}

/* Pillar 4: Crons */
export interface AICronJob {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  lastRunAt?: string;
  lastResult?: string;
  createdAt: string;
}

export interface AICronExecution {
  cronId: string;
  executedAt: string;
  success: boolean;
  result: string;
  duration: number;
}

/* Pillar 5: Evolution */
export interface AISkillVariant {
  id: string;
  skillId: string;
  prompt: string;
  score: number;
  metrics: Record<string, number>;
  generation: number;
}

export interface AIEvolutionRecord {
  skillId: string;
  skillName: string;
  currentBestVariantId: string;
  generation: number;
  variants: AISkillVariant[];
  lastEvolvedAt: string;
  totalEvolutions: number;
}

export interface AIEvolutionResult {
  skillId: string;
  improved: boolean;
  previousScore: number;
  newScore: number;
  generationsRun: number;
}

/* Combined 5-pillar status */
export interface AIFivePillarStatus {
  memory: AIMemoryStatus;
  skillsCount: number;
  soulDefined: boolean;
  cronCount: number;
  cronActiveCount: number;
  evolutionCount: number;
}

export interface AIRuntimeStatus {
  hasConfig: boolean;
  provider: AIProvider;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  lastTestAt?: string;
  lastError?: string;
}

/** IPC API exposed via preload */

export interface ArsNoteAPI {
  /* vault */
  createVault: (dir: string, name: string) => Promise<VaultOpenResult>;
  openVault: (dir: string) => Promise<VaultOpenResult | null>;
  getRecentVaults: () => Promise<string[]>;
  addRecentVault: (dir: string) => Promise<void>;
  readFileTree: (vaultPath: string) => Promise<FileNode[]>;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  saveImageToVault: (vp: string, relPath: string, data: number[]) => Promise<string>;
  createFile: (filePath: string, content?: string) => Promise<void>;
  createFolder: (folderPath: string) => Promise<void>;
  deleteItem: (itemPath: string, vaultPath: string) => Promise<void>;
  renameItem: (oldPath: string, newName: string) => Promise<string>;
  moveItem: (srcPath: string, destDir: string) => Promise<string>;
  searchFiles: (vaultPath: string, query: string) => Promise<SearchResult[]>;
  scanVaultIndex: (vaultPath: string) => Promise<VaultIndex>;
  generateVaultManifest: (vaultPath: string) => Promise<VaultManifest>;
  exportVaultBackup: (vaultPath: string, options?: BackupExportOptions) => Promise<BackupSummary>;
  listVaultBackups: (vaultPath: string) => Promise<BackupListItem[]>;
  analyzeVaultStorage: (vaultPath: string, keepLatestBackups?: number) => Promise<VaultStorageReport>;
  cleanupVaultStorage: (vaultPath: string, options?: VaultStorageCleanupOptions) => Promise<VaultStorageCleanupSummary>;
  listVaultBackupFiles: (vaultPath: string, backupPath: string) => Promise<BackupFileListResult>;
  restoreVaultBackupFile: (vaultPath: string, backupPath: string, relativePath: string) => Promise<BackupFileRestoreSummary>;
  pruneVaultBackups: (vaultPath: string, keepLatest: number) => Promise<BackupPruneSummary>;
  deleteVaultBackup: (vaultPath: string, backupPath: string) => Promise<DeleteBackupSummary>;
  restoreVaultBackup: (vaultPath: string, backupPath: string) => Promise<RestoreSummary>;
  verifyVaultBackup: (vaultPath: string, backupPath: string) => Promise<BackupVerifyResult>;
  loadSyncConfig: (vaultPath: string) => Promise<SyncConfig>;
  saveSyncConfig: (vaultPath: string, config: SyncConfig) => Promise<SyncConfig>;
  validateProviderConfig: (vaultPath: string) => Promise<ProviderValidationResult>;
  setS3RuntimeCredentials: (vaultPath: string, credentials: S3RuntimeCredentials) => Promise<S3CredentialStatus>;
  clearS3RuntimeCredentials: (vaultPath: string) => Promise<void>;
  getS3CredentialStatus: (vaultPath: string) => Promise<S3CredentialStatus>;
  testS3Connection: (vaultPath: string) => Promise<S3ConnectionTestResult>;
  setSelfHostedRuntimeCredentials: (vaultPath: string, credentials: SelfHostedRuntimeCredentials) => Promise<SelfHostedCredentialStatus>;
  clearSelfHostedRuntimeCredentials: (vaultPath: string) => Promise<void>;
  getSelfHostedCredentialStatus: (vaultPath: string) => Promise<SelfHostedCredentialStatus>;
  selfHostedHealthCheck: (endpoint: string) => Promise<{ ok: boolean; error?: string; info?: any }>;
  uploadBackupToRemote: (vaultPath: string, backupPath: string) => Promise<CloudUploadSummary>;
  listRemoteBackups: (vaultPath: string) => Promise<RemoteBackupItem[]>;
  deleteRemoteBackup: (vaultPath: string, remoteId: string) => Promise<RemoteBackupDeleteSummary>;
  downloadRemoteBackup: (vaultPath: string, remoteId: string) => Promise<CloudDownloadSummary>;
  listDownloadedBackups: (vaultPath: string) => Promise<DownloadedBackupItem[]>;
  verifyDownloadedBackup: (vaultPath: string, downloadedPath: string) => Promise<BackupVerifyResult>;
  restoreDownloadedBackup: (vaultPath: string, downloadedPath: string) => Promise<RestoreSummary>;
  compareLocalRemoteState: (vaultPath: string) => Promise<SyncCompareResult>;
  compareLocalWithRemoteBackup: (vaultPath: string, remoteId: string) => Promise<SyncCompareResult>;
  compareLocalWithRemoteFiles: (vaultPath: string, remoteId: string) => Promise<SyncPreviewResult>;
  showOpenDialog: () => Promise<string | null>;
  showSaveDialog: (defaultPath?: string) => Promise<string | null>;
  joinPath: (...segments: string[]) => Promise<string>;
  basename: (filePath: string) => Promise<string>;
  dirname: (filePath: string) => Promise<string>;
  getAppVersion: () => Promise<string>;
  windowMinimize: () => Promise<{ ok: boolean }>;
  windowMaximize: () => Promise<{ ok: boolean; maximized: boolean }>;
  windowClose: () => Promise<{ ok: boolean }>;
  windowIsMaximized: () => Promise<{ ok: boolean; maximized: boolean }>;
  onWindowMaximizedChanged: (callback: (data: { maximized: boolean }) => void) => () => void;
  openExternalUrl: (url: string) => Promise<void>;
  setAIRuntimeConfig: (vaultPath: string, config: { provider: string; baseUrl: string; model: string; apiKey: string }) => Promise<void>;
  clearAIRuntimeConfig: (vaultPath: string) => Promise<void>;
  getAIRuntimeStatus: (vaultPath: string) => Promise<AIRuntimeStatus>;
  testAIConnection: (vaultPath: string) => Promise<AIConnectionTestResult>;
  aiSafetySelfTest: (vaultPath: string) => Promise<AISafetySelfTestResult>;
  aiListOperationAudit: (vaultPath: string, limit?: number) => Promise<AIOperationAuditEvent[]>;
  aiPreviewOperationRollback: (vaultPath: string, token: string) => Promise<AIOperationRollbackPreview>;
  aiRollbackOperation: (vaultPath: string, token: string) => Promise<AIOperationRollbackResult>;
  draftNarrativeTasks: (vaultPath: string, options?: { limit?: number; includeQa?: boolean; upsert?: boolean; sourceLabel?: string }) => Promise<NarrativeTaskDraftResult>;
  upsertTeamTasks: (vaultPath: string, tasks: NarrativeTaskDraft[], sourceLabel?: string) => Promise<{ importedCount: number; updatedCount: number; skippedCount: number; schedulePath: string; content: string }>;
  bootstrapTeamWorkspace: (vaultPath: string, options?: { currentMember?: string; limit?: number }) => Promise<TeamWorkspaceBootstrapResult>;
  syncTeamTaskDocs: (vaultPath: string, fallbackMember?: string) => Promise<TeamTaskDocsSyncResult>;
  generateTeamProductionDocs: (vaultPath: string, options?: {
    includeDashboard?: boolean;
    includeObsidianCommandCenter?: boolean;
    includeProductionHealth?: boolean;
    includeDependencyMap?: boolean;
    includeHandoff?: boolean;
    includeAiMemoryIndex?: boolean;
    includeLinkHealth?: boolean;
    includeBlockerHandoff?: boolean;
    includeReviewQueue?: boolean;
    includeWorkpack?: boolean;
    includeDailyStandup?: boolean;
    includeTimesheet?: boolean;
    includeRoadmap?: boolean;
    includeDecisionLog?: boolean;
    includeChangeImpact?: boolean;
    includeNarrativeDirector?: boolean;
    includeSprintPlan?: boolean;
    includeMemberPages?: boolean;
    includeTaskDocs?: boolean;
    includeTakeoverPlan?: boolean;
  }) => Promise<TeamProductionDocsResult>;
  getTeamServerProductionStatus: (vaultPath: string) => Promise<TeamServerProductionStatus>;
  getTeamServerMemberWork: (vaultPath: string, options?: { member?: string; limit?: number }) => Promise<TeamServerMemberWorkStatus>;
  aiSyncNow: (vaultPath: string) => Promise<{
    ok: boolean;
    pulledFileCount: number;
    pushedFileCount: number;
    conflictCount: number;
    conflictFiles?: string[];
    syncedAt: string;
    status?: { ok: boolean; hasData: boolean; syncedAt: string; fileCount: number; files: string[] } | null;
  }>;
  aiSyncPush: (vaultPath: string) => Promise<{ ok: boolean; syncedAt: string; fileCount: number }>;
  aiSyncPull: (vaultPath: string) => Promise<{ ok: boolean; fileCount: number; syncedAt: string; conflictCount?: number; conflictFiles?: string[] }>;
  aiSyncStatus: (vaultPath: string) => Promise<{ ok: boolean; hasData: boolean; syncedAt: string; fileCount: number; files: string[] }>;
  aiStartAutoSync: (vaultPath: string) => Promise<void>;
  aiStopAutoSync: () => Promise<void>;
  sendAIChat: (vaultPath: string, messages: Array<{ role: string; content: string }>, options?: { controlMode?: AIControlMode; requestId?: string }) => Promise<AIResponse>;
  cancelAIChat: (requestId: string) => Promise<{ ok: boolean }>;
  onAIToolProgress: (callback: (data: { name: string; args: Record<string, string>; status: string }) => void) => () => void;
  aiInitMemory: (vp: string) => Promise<void>;
  aiGetMemoryStatus: (vp: string) => Promise<AIMemoryStatus>;
  aiGetMemoryOverview: (vp: string) => Promise<any>;
  aiReadMemory: (vp: string) => Promise<string>;
  aiAppendMemory: (vp: string, entry: string) => Promise<void>;
  aiDeleteMemoryEntry: (vp: string, lineIndex: number) => Promise<{ ok: boolean }>;
  aiSetMemoryEntryLocked: (vp: string, lineIndex: number, locked: boolean) => Promise<{ ok: boolean }>;
  aiConsolidateMemory: (vp: string) => Promise<string>;
  aiReadSoul: (vp: string) => Promise<string>;
  aiWriteSoul: (vp: string, content: string) => Promise<void>;
  aiReadUser: (vp: string) => Promise<string>;
  aiWriteUser: (vp: string, content: string) => Promise<void>;
  aiListSkills: (vp: string) => Promise<AISkill[]>;
  aiCreateSkill: (vp: string, skill: any) => Promise<string>;
  aiReadSkill: (vp: string, id: string) => Promise<string>;
  aiDeleteSkill: (vp: string, id: string) => Promise<void>;
  aiListCrons: (vp: string) => Promise<AICronJob[]>;
  aiCreateCron: (vp: string, cron: any) => Promise<AICronJob>;
  aiUpdateCron: (vp: string, id: string, updates: any) => Promise<AICronJob | null>;
  aiDeleteCron: (vp: string, id: string) => Promise<boolean>;
  aiListEvolutions: (vp: string) => Promise<AIEvolutionRecord[]>;
  aiSaveConversation: (vp: string, messages: any[]) => Promise<void>;
  aiListConversations: (vp: string) => Promise<Array<{ file: string; date: string; messageCount: number }>>;
  aiLoadConversation: (vp: string, file: string) => Promise<any[]>;
  aiLoadLatestConversation: (vp: string) => Promise<any[]>;
  aiDeleteConversation: (vp: string, file: string) => Promise<{ ok: boolean }>;

  /* Live Sync — Real-time vault sync */
  liveSyncPreflightStart: (vaultPath: string, config: { enabled: boolean; serverUrl: string; apiKey?: string; vaultId?: string; connectionMode?: 'join' | 'rebuild' }) => Promise<{
    ok: boolean;
    blocked?: boolean;
    warning?: boolean;
    error?: string;
    config?: { enabled: boolean; serverUrl: string; apiKey?: string; vaultId?: string; connectionMode?: 'join' | 'rebuild' };
    readiness?: {
      status: 'ready' | 'warning' | 'blocked';
      summary: string;
      blockers: string[];
      warnings: string[];
      actions: string[];
    };
    health?: any;
  }>;
  liveSyncStart: (vaultPath: string, config: { enabled: boolean; serverUrl: string; apiKey?: string; vaultId?: string; connectionMode?: 'join' | 'rebuild' }) => Promise<{
    ok: boolean;
    error?: string;
    config?: { enabled: boolean; serverUrl: string; apiKey?: string; vaultId?: string; connectionMode?: 'join' | 'rebuild' };
    safety?: {
      ok: boolean;
      detail: string;
      serverVersion?: string;
      compatibility?: {
        ok: boolean;
        reported: boolean;
        missing: string[];
        missingCritical: string[];
      };
    };
  }>;
  liveSyncStop: () => Promise<{ ok: boolean }>;
  liveSyncStatus: () => Promise<{ connected: boolean; clientId: string; vaultId: string; serverUrl: string; connectedAt: string | null; connectionMode?: 'join' | 'rebuild' } | null>;
  liveSyncLoadConfig: (vaultPath: string) => Promise<{ enabled: boolean; serverUrl: string; apiKey?: string; vaultId?: string; connectionMode?: 'join' | 'rebuild' } | null>;
  liveSyncSaveConfig: (vaultPath: string, config: { enabled: boolean; serverUrl: string; apiKey?: string; vaultId?: string; connectionMode?: 'join' | 'rebuild' }) => Promise<{ enabled: boolean; serverUrl: string; apiKey?: string; vaultId?: string; connectionMode?: 'join' | 'rebuild' } | null>;
  liveSyncClearConfig: (vaultPath: string) => Promise<{ ok: boolean }>;
  liveSyncPushFile: (filePath: string, content: string) => Promise<{ ok: boolean; error?: string }>;
  liveSyncTrustLocalInitialUpload: (vaultPath: string) => Promise<{ ok: boolean; error?: string; uploadedCount?: number; files?: string[]; reason?: string; preOperationSnapshot?: { fileName?: string; exportedAt?: string; size?: number; sha256?: string } | null }>;
  liveSyncResumeAfterStaleBaselineReview: () => Promise<{ ok: boolean; error?: string; reason?: string; clearedQueuedCount?: number }>;
  liveSyncPublishLocalAuthority: (
    vaultPath: string,
    options?: { includeCreates?: boolean; includeUpdates?: boolean; includeDeletes?: boolean; scopePrefix?: string; scopePrefixes?: string[]; deleteDelayMs?: number },
  ) => Promise<{ ok: boolean; error?: string; createdCount?: number; updatedCount?: number; deletedCount?: number; scheduledDeleteCount?: number; queuedDeleteCount?: number; matchedCount?: number; files?: string[]; preOperationSnapshot?: { fileName?: string; exportedAt?: string; size?: number; sha256?: string } | null }>;
  liveSyncSafeDeleteQueue: () => Promise<{ ok: boolean; count: number; error?: string; items: Array<{ id: string; vaultId: string; relativePath: string; sha256: string; size: number; updatedAt: string; queuedAt: string; source: string; reason: string; serverRevision?: number; revisionId?: string }> }>;
  liveSyncClearSafeDeleteQueue: (ids?: string[]) => Promise<{ ok: boolean; error?: string; clearedCount: number; remainingCount: number }>;
  liveSyncApplySafeDeleteQueue: (
    vaultPath: string,
    options?: { ids?: string[]; deleteDelayMs?: number },
  ) => Promise<{ ok: boolean; error?: string; appliedCount?: number; skippedCount?: number; staleCount?: number; remainingCount?: number; files?: string[]; preOperationSnapshot?: { fileName?: string; exportedAt?: string; size?: number; sha256?: string } | null }>;
  liveSyncResumeAfterDeleteStormReview: () => Promise<{ ok: boolean; error?: string; reason?: string; discardedQueuedDeletes?: number; heldDeleteCount?: number; heldDeleteFiles?: string[] }>;
  liveSyncResumeAfterDestructiveTruncationReview: () => Promise<{ ok: boolean; error?: string; reason?: string; clearedQueuedCount?: number; heldFiles?: string[] }>;
  liveSyncHealth: (vaultPath: string) => Promise<any>;
  liveSyncSelfTest: (vaultPath: string) => Promise<LiveSyncSelfTestResult>;
  scanSyncConflicts: (vaultPath: string) => Promise<{ count: number; totalSize: number; files: SyncConflictFile[] }>;
  previewSyncConflict: (vaultPath: string, conflictRelativePath: string) => Promise<SyncConflictPreview>;
  applySyncConflict: (vaultPath: string, conflictRelativePath: string) => Promise<{ ok: boolean; restoredPath: string; deletedConflict: string }>;
  resolveSyncConflictLatest: (vaultPath: string, conflictRelativePath: string) => Promise<{ ok: boolean; action: string; chosen: 'current' | 'conflict'; restoredPath: string; deletedConflict: string; baseRelativePath: string; conflictRelativePath: string; baseModifiedAt?: string | null; conflictModifiedAt?: string; sha256?: string; size?: number }>;
  createConflictMergeDraft: (vaultPath: string, conflictRelativePath: string) => Promise<{
    ok: boolean;
    draftPath: string;
    draftRelativePath: string;
    baseRelativePath: string;
    conflictRelativePath: string;
    mergedContent?: string;
    report?: string[];
    stats?: { sectionsMerged: number; conflictOnlyLines: number; tableRowsAdded: number; needsReview: boolean };
  }>;
  saveConflictMergeResult: (vaultPath: string, conflictRelativePath: string, mergedContent: string, deleteConflict?: boolean) => Promise<{ ok: boolean; restoredPath: string; deletedConflict: string }>;
  deleteSyncConflict: (vaultPath: string, conflictRelativePath: string) => Promise<{ ok: boolean; deleted: boolean; deletedConflict?: string }>;
  cleanupSyncConflicts: (vaultPath: string) => Promise<{
    ok: boolean;
    deletedCount: number;
    deletedSize: number;
    archivedCount?: number;
    archivedSize?: number;
    archiveRelativePath?: string;
  }>;
  getSyncRecoveryOverview: (vaultPath: string) => Promise<SyncRecoveryOverview>;
  previewSyncAccidentRecovery: (vaultPath: string, options?: { sinceHours?: number; includeAllReasons?: boolean; limit?: number }) => Promise<SyncAccidentRecoveryPlan>;
  previewSyncRecoveryAdvisor: (vaultPath: string, options?: { sinceHours?: number; includeAllReasons?: boolean; limit?: number }) => Promise<SyncRecoveryAdvisorPlan>;
  applySyncRecoveryAdvisorItem: (vaultPath: string, item: SyncRecoveryAdvisorItem) => Promise<any>;
  applySyncRecoveryAdvisorPlan: (vaultPath: string, options?: { sinceHours?: number; includeAllReasons?: boolean; limit?: number; applyLimit?: number; includeMedium?: boolean; generateMergeDrafts?: boolean }) => Promise<{
    ok: boolean;
    checkedAt: string;
    mode: string;
    appliedCount: number;
    draftedCount: number;
    failedCount: number;
    skippedCount: number;
    applied: any[];
    drafted: any[];
    failed: any[];
    skipped: any[];
    reportPath: string;
    reportRelativePath: string;
    planSummary: SyncRecoveryAdvisorPlan['summary'];
    nextSummary: SyncRecoveryAdvisorPlan['summary'];
    nextPlan: SyncRecoveryAdvisorPlan;
  }>;
  runSafeSyncRecoveryAutopilot: (vaultPath: string, options?: { sinceHours?: number; includeAllReasons?: boolean; limit?: number; applyLimit?: number; includeMedium?: boolean; generateMergeDrafts?: boolean }) => Promise<SafeSyncRecoveryAutopilotResult>;
  listServerDataSnapshots: (vaultPath: string, limit?: number) => Promise<ServerDataSnapshotListResult>;
  createServerDataSnapshot: (vaultPath: string, options?: { reason?: string; keepLatest?: number }) => Promise<ServerDataSnapshotCreateResult>;
  exportServerDataBackup: (vaultPath: string) => Promise<ServerDataExportBackupResult>;
  listServerSnapshotFiles: (vaultPath: string, options?: { fileName?: string; relativePath?: string; query?: string; source?: ServerSnapshotFileSource; limit?: number }) => Promise<ServerSnapshotFileListResult>;
  restoreServerSnapshotFile: (vaultPath: string, fileName: string, candidate: ServerSnapshotFileCandidate) => Promise<ServerSnapshotFileRestoreResult>;
  previewAiTrashFile: (vaultPath: string, recoveryRelativePath: string) => Promise<any>;
  restoreAiTrashFile: (vaultPath: string, recoveryRelativePath: string) => Promise<{ ok: boolean; restoredPath: string; recoveryPath: string; restoredAt: string }>;
  previewProtectedLocalRecoveryFile: (vaultPath: string, recoveryRelativePath: string) => Promise<any>;
  restoreProtectedLocalRecoveryFile: (vaultPath: string, recoveryRelativePath: string) => Promise<{ ok: boolean; restoredPath: string; recoveryPath: string; restoredAt: string }>;
  listLiveHistory: (vaultPath: string, relativePath?: string) => Promise<LiveHistoryItem[]>;
  previewLiveHistory: (vaultPath: string, relativePath: string, versionId: string) => Promise<LiveHistoryPreview>;
  restoreLiveHistory: (vaultPath: string, relativePath: string, versionId: string) => Promise<{ ok: boolean; restoredPath: string }>;
  previewLiveHistoryBatchRestore: (vaultPath: string, options?: { sinceHours?: number; includeAllReasons?: boolean; limit?: number }) => Promise<LiveHistoryBatchRestorePlan>;
  restoreLiveHistoryBatch: (vaultPath: string, options?: { sinceHours?: number; includeAllReasons?: boolean; limit?: number }) => Promise<{ ok: boolean; restoredCount: number; failedCount: number; skippedCount: number; restoredFiles: string[]; failed: Array<{ relativePath: string; error: string }>; plan: LiveHistoryBatchRestorePlan }>;
  listServerLiveHistory: (vaultPath: string, relativePath?: string, limit?: number) => Promise<LiveHistoryItem[]>;
  previewServerLiveHistory: (vaultPath: string, relativePath: string, versionId: string) => Promise<LiveHistoryPreview>;
  restoreServerLiveHistory: (vaultPath: string, relativePath: string, versionId: string) => Promise<{ ok: boolean; restoredPath: string; serverRestoredAt?: string }>;
  previewServerLiveHistoryBatchRestore: (vaultPath: string, options?: { sinceHours?: number; includeAllReasons?: boolean; limit?: number }) => Promise<LiveHistoryBatchRestorePlan>;
  restoreServerLiveHistoryBatch: (vaultPath: string, options?: { sinceHours?: number; includeAllReasons?: boolean; limit?: number }) => Promise<{ ok: boolean; restoredCount: number; failedCount: number; skippedCount: number; restoredFiles: string[]; failed: Array<{ relativePath: string; error: string }>; plan: LiveHistoryBatchRestorePlan }>;
  onLiveSyncStatus: (cb: (data: any) => void) => () => void;
  onLiveSyncActivity: (cb: (data: any) => void) => () => void;
  onLiveSyncFileUpdated: (cb: (data: any) => void) => () => void;
  onLiveSyncConflict: (cb: (data: any) => void) => () => void;
  onLiveSyncVersionCheck: (cb: (data: any) => void) => () => void;

  /* PDF Export */
  exportPdf: (html: string, fileName: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
}

declare global {
  interface Window {
    arsnote: ArsNoteAPI;
  }
}
