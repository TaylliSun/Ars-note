import * as crypto from 'crypto';
import type { StorageBackend, LiveFileEntry, LiveFileHistoryEntry, LiveFileSummary, LiveSyncClientEventEntry, LiveSyncClientHistoryEntry, ServerDataExportItem, ServerSnapshotFileCandidate, ServerSnapshotFileSource, VaultDeleteResult } from '../storage/storageTypes';
import type { BackupListItem, StoredVault } from '../types';
import { LIVE_SYNC_TOMBSTONE_RETENTION_DAYS, SERVER_APP_NAME, SERVER_VERSION } from '../types';
import {
  getActiveVaultCount,
  getLiveSyncClientSnapshot,
  getSyncMetrics,
  getTotalConnections,
  getVaultClients,
  summarizeLiveSyncClient,
} from './liveSync';

export interface AdminOverviewOptions {
  storageBackend: string;
  host: string;
  port: number;
  startedAt: string;
  apiKeyConfigured: boolean;
  devMode: boolean;
}

interface AdminClientSummary {
  vaultId?: string;
  clientKey?: string;
  clientId: string;
  deviceId?: string;
  deviceName?: string;
  platform?: string;
  appVersion?: string;
  protocolVersion?: number;
  requiredProtocolVersion?: number;
  serverVersion?: string;
  connectedAt: string;
  lastSeenAt: string;
  lastActivityAt?: string;
  firstSeenAt?: string;
  disconnectedAt?: string;
  lastDisconnectReason?: string;
  connectedSeconds?: number;
  idleSeconds?: number;
  receivedCount: number;
  sentCount?: number;
  bytesReceived?: number;
  webSocketStatus?: 'online' | 'offline';
  safetyLevel?: 'ok' | 'warning' | 'danger';
  versionStatus?: 'ok' | 'old' | 'newer' | 'unknown';
  protocolStatus?: 'ok' | 'old' | 'unknown';
  safetyMessages?: string[];
  lastMessageType?: string;
  lastPingAt?: string;
  lastFileChangeAt?: string;
  lastAcceptedAt?: string;
  lastRejectedAt?: string;
  lastRejectedReason?: string;
  lastRelativePath?: string;
  lastAction?: string;
}

interface AdminMemberWorkLog {
  taskId: string;
  taskTitle: string;
  member: string;
  date: string;
  minutes: number;
  note: string;
  createdAt: string;
}

interface AdminMemberWorkTask {
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
  latestLog: AdminMemberWorkLog | null;
}

interface AdminMemberWorkSummary {
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

interface AdminVaultSummary {
  vaultId: string;
  serverVaultId: string;
  vaultName: string;
  registeredAt: string;
  clientId?: string;
  onlineClients: AdminClientSummary[];
  clientHistory: AdminClientSummary[];
  clientEvents: LiveSyncClientEventEntry[];
  backupCount: number;
  backupTotalSize: number;
  backupFileCount: number;
  lastBackupAt: string | null;
  live: LiveFileSummary | null;
  team: AdminTeamProductionSummary | null;
  lastActivityAt: string | null;
}

interface AdminCoreTeamDocSummary {
  key: string;
  label: string;
  relativePath: string;
  synced: boolean;
  updatedAt: string | null;
  size: number;
}

interface AdminAiMemoryCoreFileSummary {
  key: string;
  label: string;
  relativePath: string;
  synced: boolean;
  inManifest: boolean;
  updatedAt: string | null;
  size: number;
}

interface AdminTeamProductionSummary {
  scheduleSynced: boolean;
  scheduleUpdatedAt: string | null;
  members: number;
  memberNames: string[];
  memberWork: AdminMemberWorkSummary[];
  totalTasks: number;
  activeTasks: number;
  doneTasks: number;
  blockedTasks: number;
  overdueTasks: number;
  dueSoonTasks: number;
  missingOwnerTasks: number;
  missingDueDateTasks: number;
  missingDocTasks: number;
  recentLogCount: number;
  loggedMinutes: number;
  teamDocs: number;
  taskDocs: number;
  aiMemoryFiles: number;
  aiSkills: number;
  aiMemoryManifestSynced: boolean;
  aiMemoryCoreFiles: AdminAiMemoryCoreFileSummary[];
  missingAiMemoryCoreFiles: number;
  coreDocs: AdminCoreTeamDocSummary[];
  missingCoreDocs: number;
  lastTeamFileAt: string | null;
  warnings: string[];
}

interface AdminWarning {
  level: 'info' | 'warning' | 'danger';
  title: string;
  message: string;
  vaultId?: string;
}

interface AdminDuplicateVaultGroup {
  name: string;
  keeperVaultId: string;
  keeperReason: string;
  vaults: Array<{
    vaultId: string;
    serverVaultId: string;
    vaultName: string;
    onlineClients: number;
    backupCount: number;
    liveFileCount: number;
    teamTaskCount: number;
    lastActivityAt: string | null;
    recommended: boolean;
    deleteSafe: boolean;
  }>;
}

interface AdminDuplicateVaultCleanupItem {
  groupName: string;
  keeperVaultId: string;
  vaultId: string;
  vaultName: string;
  deleted: boolean;
  skippedReason?: string;
  result?: VaultDeleteResult;
}

type AdminPreOperationSnapshot = ServerDataExportItem | null;

function cleanSnapshotReasonPart(value: string): string {
  return String(value || 'operation')
    .replace(/[^a-zA-Z0-9:._/-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || 'operation';
}

export async function createAdminPreOperationSnapshot(
  storage: StorageBackend,
  reason: string,
): Promise<{ ok: true; preOperationSnapshot: AdminPreOperationSnapshot } | { ok: false; error: string }> {
  if (typeof storage.createServerDataSnapshot !== 'function') {
    return { ok: true, preOperationSnapshot: null };
  }

  try {
    const preOperationSnapshot = await storage.createServerDataSnapshot({
      reason: `pre-admin:${cleanSnapshotReasonPart(reason)}`,
    });
    return { ok: true, preOperationSnapshot };
  } catch (err: any) {
    return {
      ok: false,
      error: `Pre-operation server snapshot failed; dangerous operation was cancelled: ${err?.message || String(err)}`,
    };
  }
}

interface AdminRecentLiveFile {
  vaultId: string;
  vaultName: string;
  relativePath: string;
  size: number;
  updatedAt: string;
  deleted?: boolean;
}

interface TeamProductionStatusResponse {
  ok: true;
  vaultId: string;
  serverVaultId: string;
  vaultName: string;
  checkedAt: string;
  onlineClients: AdminClientSummary[];
  team: AdminTeamProductionSummary;
  liveFileCount: number;
  recentTeamFiles: Array<{
    relativePath: string;
    size: number;
    updatedAt: string;
    deleted?: boolean;
  }>;
  sourceFiles: {
    schedule: boolean;
    aiMemoryManifest: boolean;
    teamDocs: number;
    taskDocs: number;
    aiMemoryFiles: number;
    aiSkills: number;
    aiMemoryCoreFiles: AdminAiMemoryCoreFileSummary[];
    missingAiMemoryCoreFiles: number;
    coreDocs: AdminCoreTeamDocSummary[];
    missingCoreDocs: number;
  };
}

interface TeamMemberWorkResponse {
  ok: true;
  vaultId: string;
  serverVaultId: string;
  vaultName: string;
  checkedAt: string;
  member: string;
  members: string[];
  memberWork: AdminMemberWorkSummary[];
  summary: AdminMemberWorkSummary | null;
  tasks: AdminMemberWorkTask[];
  recentLogs: AdminMemberWorkLog[];
  sourceFiles: {
    schedule: boolean;
    teamDocs: number;
    taskDocs: number;
  };
}

interface VaultIdentityDiagnosticsResponse {
  ok: true;
  checkedAt: string;
  query: {
    vaultId: string;
    vaultName: string;
  };
  exactMatch: boolean;
  exactVault: AdminVaultSummary | null;
  nameMatches: AdminVaultSummary[];
  recommendedVaultId?: string;
  recommendedReason?: string;
  currentIsRecommended?: boolean;
  duplicateNameRisk: boolean;
  advice: string[];
}

interface AdminBackupFileEntry {
  relativePath: string;
  type: string;
  size: number;
  sha256: string;
  updatedAt: string;
  deleted?: boolean;
}

function newestDate(values: Array<string | null | undefined>): string | null {
  const valid = values.filter((v): v is string => !!v).sort((a, b) => b.localeCompare(a));
  return valid[0] || null;
}

function decodeLiveText(file: LiveFileEntry | undefined): string {
  if (!file || file.deleted || !file.contentBase64) return '';
  try {
    return Buffer.from(file.contentBase64, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function parseLiveJson<T = any>(file: LiveFileEntry | undefined): T | null {
  const raw = decodeLiveText(file).trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeAdminDate(value: unknown): string {
  const raw = String(value || '').trim();
  const match = raw.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!match) return '';
  return [match[1], match[2].padStart(2, '0'), match[3].padStart(2, '0')].join('-');
}

function normalizeAdminTaskStatus(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'done' || raw === 'completed' || raw === 'closed' || /完成|通过|关闭/.test(raw)) return 'done';
  if (raw === 'blocked' || /阻塞|卡住/.test(raw)) return 'blocked';
  if (raw === 'review' || /验收|复查|检查/.test(raw)) return 'review';
  if (raw === 'doing' || raw === 'wip' || /进行|制作|处理中/.test(raw)) return 'doing';
  return 'todo';
}

function parseAdminMinutes(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function normalizeAdminMemberName(value: unknown): string {
  return String(value || '').trim();
}

function normalizeAdminRelativePath(value: unknown): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
}

function normalizeAdminSnapshotFileSource(value: unknown): ServerSnapshotFileSource | undefined {
  const raw = String(value || '').trim();
  if (raw === 'live' || raw === 'live-history' || raw === 'backup') return raw;
  return undefined;
}

function normalizeAdminPriority(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'high' || raw === 'medium' || raw === 'low') return raw;
  if (/urgent|critical|p0|p1|楂榑绱ф€急/.test(raw)) return 'high';
  if (/low|p3|浣庣骇/.test(raw)) return 'low';
  return 'medium';
}

function collectAdminTeamMembers(schedule: any, tasks: any[]): string[] {
  const members = new Set<string>();
  for (const member of Array.isArray(schedule?.members) ? schedule.members : []) {
    const clean = normalizeAdminMemberName(member);
    if (clean) members.add(clean);
  }
  for (const task of tasks) {
    const owner = normalizeAdminMemberName(task?.owner);
    if (owner) members.add(owner);
    for (const log of Array.isArray(task?.logs) ? task.logs : []) {
      const member = normalizeAdminMemberName(log?.member || owner);
      if (member) members.add(member);
    }
    for (const log of Array.isArray(task?.reviewLogs) ? task.reviewLogs : []) {
      const reviewer = normalizeAdminMemberName(log?.reviewer || log?.member || owner);
      if (reviewer) members.add(reviewer);
    }
  }
  return Array.from(members).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function taskLogsForMember(task: any, member = ''): AdminMemberWorkLog[] {
  const cleanMember = normalizeAdminMemberName(member);
  const owner = normalizeAdminMemberName(task?.owner);
  return (Array.isArray(task?.logs) ? task.logs : [])
    .map((log: any): AdminMemberWorkLog => ({
      taskId: String(task?.id || ''),
      taskTitle: String(task?.title || ''),
      member: normalizeAdminMemberName(log?.member || owner),
      date: normalizeAdminDate(log?.date || log?.createdAt),
      minutes: parseAdminMinutes(log?.minutes),
      note: String(log?.note || '').trim(),
      createdAt: typeof log?.createdAt === 'string' ? log.createdAt : '',
    }))
    .filter((log: AdminMemberWorkLog) => log.minutes > 0 && (!cleanMember || log.member === cleanMember));
}

function taskSpentMinutes(task: any, member = ''): number {
  return taskLogsForMember(task, member).reduce((sum, log) => sum + log.minutes, 0);
}

function taskMatchesMember(task: any, member: string): boolean {
  const cleanMember = normalizeAdminMemberName(member);
  if (!cleanMember) return true;
  if (normalizeAdminMemberName(task?.owner) === cleanMember) return true;
  return taskLogsForMember(task, cleanMember).length > 0;
}

function latestAdminWorkLog(task: any, member = ''): AdminMemberWorkLog | null {
  const logs = taskLogsForMember(task, member)
    .sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date));
  return logs[0] || null;
}

function toAdminMemberWorkTask(task: any, byPath: Set<string>, member = ''): AdminMemberWorkTask {
  const linkedDoc = normalizeAdminRelativePath(task?.linkedDoc);
  return {
    id: String(task?.id || ''),
    title: String(task?.title || '').trim(),
    owner: normalizeAdminMemberName(task?.owner),
    status: normalizeAdminTaskStatus(task?.status),
    priority: normalizeAdminPriority(task?.priority),
    dueDate: normalizeAdminDate(task?.dueDate),
    linkedDoc,
    linkedDocSynced: !!linkedDoc && byPath.has(linkedDoc.toLowerCase()),
    deliverable: String(task?.deliverable || '').trim(),
    dependency: String(task?.dependency || task?.dependencies || '').trim(),
    blocker: String(task?.blocker || task?.blockedReason || '').trim(),
    acceptance: String(task?.acceptance || task?.acceptanceCriteria || '').trim(),
    notes: String(task?.notes || '').trim(),
    estimateMinutes: parseAdminMinutes(task?.estimateMinutes),
    spentMinutes: taskSpentMinutes(task),
    memberSpentMinutes: taskSpentMinutes(task, member),
    updatedAt: typeof task?.updatedAt === 'string' ? task.updatedAt : '',
    latestLog: latestAdminWorkLog(task, member),
  };
}

function sortAdminWorkTasks(tasks: AdminMemberWorkTask[]): AdminMemberWorkTask[] {
  const statusRank: Record<string, number> = { blocked: 0, doing: 1, review: 2, todo: 3, done: 4 };
  const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return [...tasks].sort((a, b) => {
    const statusDelta = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
    if (statusDelta) return statusDelta;
    const aDue = a.dueDate || '9999-12-31';
    const bDue = b.dueDate || '9999-12-31';
    if (aDue !== bDue) return aDue.localeCompare(bDue);
    const priorityDelta = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
    if (priorityDelta) return priorityDelta;
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
}

function buildAdminMemberWorkSummary(member: string, tasks: any[], byPath: Set<string>, today: string, soonDate: string): AdminMemberWorkSummary {
  const ownedTasks = tasks.filter((task) => normalizeAdminMemberName(task?.owner) === member);
  const memberLogs = tasks.flatMap((task) => taskLogsForMember(task, member));
  const activeOwnedTasks = ownedTasks.filter((task) => normalizeAdminTaskStatus(task?.status) !== 'done');
  return {
    member,
    totalTasks: ownedTasks.length,
    activeTasks: activeOwnedTasks.length,
    doneTasks: ownedTasks.length - activeOwnedTasks.length,
    blockedTasks: activeOwnedTasks.filter((task) => normalizeAdminTaskStatus(task?.status) === 'blocked' || String(task?.blocker || '').trim()).length,
    overdueTasks: activeOwnedTasks.filter((task) => {
      const dueDate = normalizeAdminDate(task?.dueDate);
      return !!dueDate && dueDate < today;
    }).length,
    dueSoonTasks: activeOwnedTasks.filter((task) => {
      const dueDate = normalizeAdminDate(task?.dueDate);
      return !!dueDate && dueDate >= today && dueDate <= soonDate;
    }).length,
    missingDocTasks: activeOwnedTasks.filter((task) => {
      const linkedDoc = normalizeAdminRelativePath(task?.linkedDoc);
      return !linkedDoc || !byPath.has(linkedDoc.toLowerCase());
    }).length,
    spentMinutes: memberLogs.reduce((sum, log) => sum + log.minutes, 0),
    todayMinutes: memberLogs.filter((log) => log.date === today).reduce((sum, log) => sum + log.minutes, 0),
    todayLogCount: memberLogs.filter((log) => log.date === today).length,
    recentLogCount: memberLogs.filter((log) => log.date && log.date >= today).length,
  };
}

function buildAdminTeamMemberWork(schedule: any, tasks: any[], byPath: Set<string>, today: string, soonDate: string): AdminMemberWorkSummary[] {
  return collectAdminTeamMembers(schedule, tasks)
    .map((member) => buildAdminMemberWorkSummary(member, tasks, byPath, today, soonDate))
    .sort((a, b) => {
      if (b.activeTasks !== a.activeTasks) return b.activeTasks - a.activeTasks;
      if (b.blockedTasks !== a.blockedTasks) return b.blockedTasks - a.blockedTasks;
      return a.member.localeCompare(b.member, 'zh-CN');
    });
}

function normalizeAiMemoryManifestPath(item: unknown): string {
  if (typeof item === 'string') return item.replace(/\\/g, '/');
  if (!item || typeof item !== 'object') return '';
  const record = item as Record<string, unknown>;
  const raw = record.relativePath || record.path || record.file || '';
  return String(raw || '').replace(/\\/g, '/');
}

const CORE_TEAM_PRODUCTION_DOCS: Array<{ key: string; label: string; relativePath: string }> = [
  { key: 'commandCenter', label: 'Obsidian 控制台', relativePath: '.ars-team/obsidian-command-center.md' },
  { key: 'dashboard', label: '团队首页', relativePath: '.ars-team/team-dashboard.md' },
  { key: 'productionHealth', label: '生产健康报告', relativePath: '.ars-team/production-health.md' },
  { key: 'aiHandoff', label: 'AI 交接页', relativePath: '.ars-team/ai-handoff.md' },
  { key: 'aiMemoryIndex', label: 'AI 记忆索引', relativePath: '.ars-team/ai-memory-index.md' },
  { key: 'linkHealth', label: '链接健康页', relativePath: '.ars-team/link-health.md' },
  { key: 'narrativeDirector', label: '叙事导演台', relativePath: '.ars-team/narrative-director.md' },
];

const ADMIN_PRODUCTION_TIMEZONE = process.env.ARS_NOTE_TIMEZONE || process.env.TZ || 'Asia/Shanghai';

function formatAdminLocalDate(date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: ADMIN_PRODUCTION_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    /* Fall through to the runtime local date when the configured timezone is invalid. */
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const CORE_AI_MEMORY_FILES: Array<{ key: string; label: string; relativePath: string; manifestPath: string }> = [
  { key: 'memory', label: '长期项目记忆', relativePath: '.ai-memory/MEMORY.md', manifestPath: 'MEMORY.md' },
  { key: 'user', label: '用户/团队偏好', relativePath: '.ai-memory/USER.md', manifestPath: 'USER.md' },
  { key: 'soul', label: 'AI 行为设定', relativePath: '.ai-memory/SOUL.md', manifestPath: 'SOUL.md' },
  { key: 'crons', label: 'AI 计划任务', relativePath: '.ai-memory/crons.json', manifestPath: 'crons.json' },
];

function buildAdminTeamProductionSummary(liveFiles: LiveFileEntry[]): AdminTeamProductionSummary {
  const activeLiveFiles = liveFiles.filter((file) => !file.deleted);
  const byPath = new Map(activeLiveFiles.map((file) => [file.relativePath.replace(/\\/g, '/').toLowerCase(), file]));
  const scheduleFile = byPath.get('.ars-team/schedule.json');
  const schedule = parseLiveJson<any>(scheduleFile);
  const tasks: any[] = Array.isArray(schedule?.tasks) ? schedule.tasks : [];
  const now = new Date();
  const today = formatAdminLocalDate(now);
  const dateKey = today.replace(/-/g, '');
  const soon = new Date();
  soon.setDate(soon.getDate() + 7);
  const soonDate = formatAdminLocalDate(soon);
  const taskDocs = activeLiveFiles.filter((file) => /^07_Unity_Tasks\/.+\.md$/i.test(file.relativePath)).length;
  const teamDocs = activeLiveFiles.filter((file) => /^\.ars-team\/.+\.(md|json)$/i.test(file.relativePath)).length;
  const byPathSet = new Set(activeLiveFiles.map((file) => file.relativePath.replace(/\\/g, '/').toLowerCase()));
  const dailyCoreDocs: Array<{ key: string; label: string; relativePath: string }> = [
    { key: 'dailyStandup', label: '今日日报', relativePath: `.ars-team/reports/daily-standup-${dateKey}.md` },
    { key: 'dailyWorkpack', label: '今日工作包', relativePath: `.ars-team/workpacks/daily-workpack-${dateKey}.md` },
    { key: 'timesheet', label: '今日工时表', relativePath: `.ars-team/timesheets/timesheet-${dateKey}.md` },
  ];
  const coreDocs = [...CORE_TEAM_PRODUCTION_DOCS, ...dailyCoreDocs].map((doc) => {
    const file = byPath.get(doc.relativePath.toLowerCase());
    return {
      ...doc,
      synced: !!file,
      updatedAt: file?.updatedAt || null,
      size: Number(file?.size || 0),
    };
  });
  const missingCoreDocs = coreDocs.filter((doc) => !doc.synced).length;
  const aiMemoryManifest = byPath.get('.ai-memory/__manifest.json');
  const aiManifest = parseLiveJson<any>(aiMemoryManifest);
  const aiManifestFiles = Array.isArray(aiManifest)
    ? aiManifest
    : (Array.isArray(aiManifest?.files) ? aiManifest.files : []);
  const aiManifestPaths = aiManifestFiles
    .map((item: unknown) => normalizeAiMemoryManifestPath(item))
    .filter(Boolean);
  const aiManifestPathSet = new Set(aiManifestPaths.map((item: string) => item.toLowerCase()));
  const aiMemoryLiveFiles = activeLiveFiles
    .filter((file) => /^\.ai-memory\/.+/i.test(file.relativePath) && !/\/history\/|live-session\.json/i.test(file.relativePath));
  const aiMemoryFiles = aiManifestPaths.length || aiMemoryLiveFiles.length;
  const aiSkills = aiManifestPaths.length
    ? aiManifestPaths.filter((item: string) => /^skills\/.+\.md$/i.test(item)).length
    : aiMemoryLiveFiles.filter((file) => /^\.ai-memory\/skills\/.+\.md$/i.test(file.relativePath)).length;
  const aiMemoryCoreFiles = CORE_AI_MEMORY_FILES.map((item) => {
    const file = byPath.get(item.relativePath.toLowerCase());
    return {
      key: item.key,
      label: item.label,
      relativePath: item.relativePath,
      synced: !!file,
      inManifest: aiManifestPathSet.has(item.manifestPath.toLowerCase()),
      updatedAt: file?.updatedAt || null,
      size: Number(file?.size || 0),
    };
  });
  const missingAiMemoryCoreFiles = aiMemoryCoreFiles.filter((file) => !file.synced).length;
  let loggedMinutes = 0;
  let recentLogCount = 0;
  let activeTasks = 0;
  let doneTasks = 0;
  let blockedTasks = 0;
  let overdueTasks = 0;
  let dueSoonTasks = 0;
  let missingOwnerTasks = 0;
  let missingDueDateTasks = 0;
  let missingDocTasks = 0;

  for (const task of tasks) {
    const status = normalizeAdminTaskStatus(task?.status);
    const dueDate = normalizeAdminDate(task?.dueDate);
    const owner = String(task?.owner || '').trim();
    const linkedDoc = String(task?.linkedDoc || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const logs = Array.isArray(task?.logs) ? task.logs : [];
    loggedMinutes += logs.reduce((sum: number, log: any) => sum + parseAdminMinutes(log?.minutes), 0);
    recentLogCount += logs.filter((log: any) => {
      const date = normalizeAdminDate(log?.date || log?.createdAt);
      return date && date >= today;
    }).length;
    if (status === 'done') {
      doneTasks += 1;
      continue;
    }
    activeTasks += 1;
    if (status === 'blocked' || String(task?.blocker || '').trim()) blockedTasks += 1;
    if (dueDate && dueDate < today) overdueTasks += 1;
    if (dueDate && dueDate >= today && dueDate <= soonDate) dueSoonTasks += 1;
    if (!owner || owner === '未分配') missingOwnerTasks += 1;
    if (!dueDate) missingDueDateTasks += 1;
    if (!linkedDoc || !byPath.has(linkedDoc.toLowerCase())) missingDocTasks += 1;
  }

  const warnings: string[] = [];
  if (!schedule) warnings.push('未同步 .ars-team/schedule.json');
  if (activeTasks > 0 && recentLogCount === 0) warnings.push('今天还没有工时记录');
  if (blockedTasks > 0) warnings.push(`${blockedTasks} 个任务阻塞`);
  if (overdueTasks > 0) warnings.push(`${overdueTasks} 个任务逾期`);
  if (missingOwnerTasks > 0) warnings.push(`${missingOwnerTasks} 个任务缺负责人`);
  if (missingDocTasks > 0) warnings.push(`${missingDocTasks} 个任务缺文档`);
  if (schedule && missingCoreDocs > 0) {
    const missing = coreDocs.filter((doc) => !doc.synced).map((doc) => doc.label).slice(0, 4).join('、');
    warnings.push(`核心工作台文档缺 ${missingCoreDocs} 个：${missing}`);
  }
  if (!aiMemoryManifest && aiMemoryLiveFiles.length === 0) {
    warnings.push('AI 记忆/Skill 未同步');
  } else {
    if (!aiMemoryManifest) warnings.push('AI 记忆 manifest 未同步');
    if (missingAiMemoryCoreFiles > 0) {
      const missing = aiMemoryCoreFiles.filter((file) => !file.synced).map((file) => file.label).slice(0, 4).join('、');
      warnings.push(`AI 核心记忆缺 ${missingAiMemoryCoreFiles} 个：${missing}`);
    }
    if (aiSkills === 0) warnings.push('AI Skill 未同步');
  }

  const memberNames = collectAdminTeamMembers(schedule, tasks);
  const memberWork = buildAdminTeamMemberWork(schedule, tasks, byPathSet, today, soonDate);

  return {
    scheduleSynced: !!schedule,
    scheduleUpdatedAt: typeof schedule?.updatedAt === 'string' ? schedule.updatedAt : null,
    members: memberNames.length,
    memberNames,
    memberWork,
    totalTasks: tasks.length,
    activeTasks,
    doneTasks,
    blockedTasks,
    overdueTasks,
    dueSoonTasks,
    missingOwnerTasks,
    missingDueDateTasks,
    missingDocTasks,
    recentLogCount,
    loggedMinutes,
    teamDocs,
    taskDocs,
    aiMemoryFiles,
    aiSkills,
    aiMemoryManifestSynced: !!aiMemoryManifest,
    aiMemoryCoreFiles,
    missingAiMemoryCoreFiles,
    coreDocs,
    missingCoreDocs,
    lastTeamFileAt: newestDate(activeLiveFiles
      .filter((file) => /^(?:\.ars-team\/|07_Unity_Tasks\/|\.ai-memory\/)/i.test(file.relativePath))
      .map((file) => file.updatedAt)),
    warnings,
  };
}

function buildWarnings(summaries: AdminVaultSummary[], capabilities: { listVaults: boolean; livePersistence: boolean; deleteVault: boolean }): AdminWarning[] {
  const warnings: AdminWarning[] = [];

  if (!capabilities.listVaults) {
    warnings.push({
      level: 'warning',
      title: '当前存储后端不支持完整 Vault 列表',
      message: '管理台只能显示有限信息，建议优先使用 local 后端或补齐该后端的 listVaults 能力。',
    });
  }

  if (!capabilities.livePersistence) {
    warnings.push({
      level: 'info',
      title: '实时同步没有持久化快照',
      message: '在线设备之间仍可实时广播，但新设备上线时无法从服务器直接拉取最新文件快照。',
    });
  }

  const byName = new Map<string, AdminVaultSummary[]>();
  for (const group of buildDuplicateVaultGroups(summaries, capabilities)) {
    warnings.push({
      level: 'warning',
      title: '重复 Vault 需要整理',
      message: `同名 Vault "${group.name}" 有 ${group.vaults.length} 个记录。建议所有电脑统一使用 Vault ID：${group.keeperVaultId}；离线且不是建议保留项的记录可以在“Vault 管理”里删除。`,
    });
  }

  for (const vault of summaries) {
    const key = vault.vaultName.trim().toLowerCase();
    if (!key) continue;
    byName.set(key, [...(byName.get(key) || []), vault]);
  }

  for (const group of byName.values()) {
    if (false && group.length > 1) {
      warnings.push({
        level: 'warning',
        title: '发现同名 Vault',
        message: group.map((vault) => `${vault.vaultName} (${vault.vaultId})`).join('、') + ' 使用了相同名称。若它们其实是同一个库，建议统一客户端的 vaultId，避免看起来像重复数据。',
      });
    }
  }

  for (const vault of summaries) {
    const clientsForSafety = vault.clientHistory && vault.clientHistory.length ? vault.clientHistory : vault.onlineClients || [];
    for (const client of clientsForSafety) {
      if (client.safetyLevel === 'danger' || client.safetyLevel === 'warning') {
        const label = client.deviceName || client.deviceId || client.clientId;
        const messages = Array.isArray(client.safetyMessages) && client.safetyMessages.length
          ? client.safetyMessages.slice(0, 3).join(' ')
          : 'Client needs sync safety review.';
        const online = client.webSocketStatus !== 'offline';
        warnings.push({
          level: client.safetyLevel === 'danger' ? 'danger' : 'warning',
          title: client.safetyLevel === 'danger'
            ? (online ? 'Unsafe sync client online' : 'Unsafe sync client seen recently')
            : (online ? 'Sync client needs attention' : 'Offline sync client needs attention'),
          message: `${vault.vaultName}: ${label}. ${messages}`,
          vaultId: vault.vaultId,
        });
      }
    }

    for (const event of (vault.clientEvents || []).filter((item) => item.eventType === 'file-rejected').slice(0, 3)) {
      const label = event.deviceName || event.deviceId || event.clientId;
      warnings.push({
        level: 'danger',
        title: 'Server rejected a sync write',
        message: `${vault.vaultName}: ${label} ${event.action || 'write'} ${event.relativePath || '-'} was rejected (${event.reason || 'unknown'}) at ${event.createdAt}.`,
        vaultId: vault.vaultId,
      });
    }

    if (vault.live && vault.live.fileCount > 0 && vault.backupCount === 0) {
      warnings.push({
        level: 'info',
        title: 'Vault 只有实时同步数据',
        message: `${vault.vaultName} 目前没有远程备份。如果误删文件，只能依赖实时快照和本地历史。`,
        vaultId: vault.vaultId,
      });
    }

    if ((vault.live?.deletedCount || 0) >= 20) {
      warnings.push({
        level: 'info',
        title: '实时同步删除记录较多',
        message: `${vault.vaultName} 有 ${vault.live?.deletedCount || 0} 条删除记录，可在“实时同步管理”里清理墓碑记录。`,
        vaultId: vault.vaultId,
      });
    }

    if (vault.team?.scheduleSynced && (vault.team.blockedTasks > 0 || vault.team.overdueTasks > 0 || vault.team.missingDocTasks > 0)) {
      warnings.push({
        level: vault.team.blockedTasks > 0 || vault.team.overdueTasks > 0 ? 'warning' : 'info',
        title: '团队制作需要处理',
        message: `${vault.vaultName}：阻塞 ${vault.team.blockedTasks}，逾期 ${vault.team.overdueTasks}，缺文档 ${vault.team.missingDocTasks}。`,
        vaultId: vault.vaultId,
      });
    }
  }

  return warnings;
}

function normalizeDuplicateVaultName(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function duplicateVaultScore(vault: AdminVaultSummary): number {
  const lastActivityMs = Date.parse(vault.lastActivityAt || vault.registeredAt || '') || 0;
  return (
    vault.onlineClients.length * 1_000_000_000_000_000 +
    (vault.team?.scheduleSynced ? 500_000_000_000_000 : 0) +
    (vault.team?.totalTasks || 0) * 10_000_000 +
    (vault.live?.fileCount || 0) * 100_000 +
    vault.backupCount * 10_000 +
    Math.floor(lastActivityMs / 1000)
  );
}

function duplicateVaultKeeperReason(vault: AdminVaultSummary): string {
  const reasons: string[] = [];
  if (vault.onlineClients.length > 0) reasons.push(`${vault.onlineClients.length} online client(s)`);
  if (vault.team?.scheduleSynced) reasons.push(`${vault.team.totalTasks || 0} team task(s)`);
  if (vault.live?.fileCount) reasons.push(`${vault.live.fileCount} live file(s)`);
  if (vault.backupCount) reasons.push(`${vault.backupCount} backup(s)`);
  if (vault.lastActivityAt) reasons.push(`last active ${vault.lastActivityAt}`);
  return reasons.join(', ') || 'most recent registration';
}

function buildDuplicateVaultGroups(
  summaries: AdminVaultSummary[],
  capabilities: { deleteVault: boolean },
): AdminDuplicateVaultGroup[] {
  const byName = new Map<string, AdminVaultSummary[]>();
  for (const vault of summaries) {
    const key = normalizeDuplicateVaultName(vault.vaultName);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) || []), vault]);
  }

  return Array.from(byName.entries())
    .filter(([, group]) => group.length > 1)
    .map(([name, group]) => {
      const sorted = [...group].sort((a, b) => duplicateVaultScore(b) - duplicateVaultScore(a));
      const keeper = sorted[0];
      return {
        name,
        keeperVaultId: keeper.vaultId,
        keeperReason: duplicateVaultKeeperReason(keeper),
        vaults: sorted.map((vault) => ({
          vaultId: vault.vaultId,
          serverVaultId: vault.serverVaultId,
          vaultName: vault.vaultName,
          onlineClients: vault.onlineClients.length,
          backupCount: vault.backupCount,
          liveFileCount: vault.live?.fileCount || 0,
          teamTaskCount: vault.team?.totalTasks || 0,
          lastActivityAt: vault.lastActivityAt,
          recommended: vault.vaultId === keeper.vaultId,
          deleteSafe: capabilities.deleteVault && vault.onlineClients.length === 0 && vault.vaultId !== keeper.vaultId,
        })),
      };
    })
    .sort((a, b) => b.vaults.length - a.vaults.length || a.name.localeCompare(b.name));
}

async function getAdminVaults(storage: StorageBackend): Promise<StoredVault[]> {
  return storage.listVaults ? await storage.listVaults() : [];
}

async function resolveAdminVault(storage: StorageBackend, vaultId: string): Promise<StoredVault | null> {
  if (!vaultId) return null;
  const vaults = await getAdminVaults(storage);
  const found = vaults.find((vault) => vault.vaultId === vaultId || vault.serverVaultId === vaultId);
  if (found) return found;

  return {
    vaultId,
    serverVaultId: vaultId,
    vaultName: vaultId,
    registeredAt: '',
  };
}

function adminClientKey(client: Partial<AdminClientSummary | LiveSyncClientHistoryEntry>): string {
  return String(client.clientKey || client.deviceId || client.clientId || '').trim();
}

function sortAdminClients(a: AdminClientSummary, b: AdminClientSummary): number {
  const aOnline = a.webSocketStatus === 'online' ? 1 : 0;
  const bOnline = b.webSocketStatus === 'online' ? 1 : 0;
  if (aOnline !== bOnline) return bOnline - aOnline;
  const byActivity = (b.lastActivityAt || b.lastSeenAt || '').localeCompare(a.lastActivityAt || a.lastSeenAt || '');
  if (byActivity !== 0) return byActivity;
  return (b.connectedAt || '').localeCompare(a.connectedAt || '');
}

async function getAdminClientHistory(
  storage: StorageBackend,
  vaultId: string,
  onlineClients: AdminClientSummary[],
): Promise<AdminClientSummary[]> {
  const byKey = new Map<string, AdminClientSummary>();
  if (typeof storage.listLiveSyncClientHistory === 'function') {
    const history = await storage.listLiveSyncClientHistory(vaultId, 80).catch(() => [] as LiveSyncClientHistoryEntry[]);
    for (const client of history) {
      const key = adminClientKey(client);
      if (!key) continue;
      byKey.set(key, {
        ...client,
        webSocketStatus: client.webSocketStatus || 'offline',
      });
    }
  }

  for (const client of onlineClients) {
    const key = adminClientKey(client);
    const existing = key ? byKey.get(key) : undefined;
    byKey.set(key || client.clientId, {
      ...existing,
      ...client,
      vaultId,
      clientKey: existing?.clientKey || key || client.clientId,
      firstSeenAt: existing?.firstSeenAt || client.connectedAt,
      webSocketStatus: 'online',
    });
  }

  return Array.from(byKey.values()).sort(sortAdminClients).slice(0, 80);
}

async function buildAdminVaultSummary(storage: StorageBackend, vault: StoredVault): Promise<AdminVaultSummary> {
  const backups = await storage.listBackups(vault.serverVaultId).catch(() => [] as BackupListItem[]);
  const onlineClients = getVaultClients(vault.vaultId).map((client) => summarizeLiveSyncClient(client));
  const clientHistory = await getAdminClientHistory(storage, vault.vaultId, onlineClients);
  const clientEvents = storage.listLiveSyncClientEvents
    ? await storage.listLiveSyncClientEvents(vault.vaultId, { limit: 80 }).catch(() => [] as LiveSyncClientEventEntry[])
    : [];
  const live = storage.getLiveFileSummary
    ? await storage.getLiveFileSummary(vault.vaultId).catch(() => null)
    : null;
  const liveFiles = storage.listLiveFiles
    ? await storage.listLiveFiles(vault.vaultId).catch(() => [] as LiveFileEntry[])
    : null;
  const team = liveFiles ? buildAdminTeamProductionSummary(liveFiles) : null;
  const lastBackupAt = backups[0]?.uploadedAt || null;
  const lastClientAt = newestDate(clientHistory.map((client) => client.lastActivityAt || client.lastSeenAt || client.connectedAt));

  return {
    vaultId: vault.vaultId,
    serverVaultId: vault.serverVaultId,
    vaultName: vault.vaultName,
    registeredAt: vault.registeredAt,
    clientId: vault.clientId,
    onlineClients,
    clientHistory,
    clientEvents,
    backupCount: backups.length,
    backupTotalSize: backups.reduce((sum, item) => sum + (Number(item.totalSize) || 0), 0),
    backupFileCount: backups.reduce((sum, item) => sum + (Number(item.fileCount) || 0), 0),
    lastBackupAt,
    live,
    team,
    lastActivityAt: newestDate([team?.lastTeamFileAt, live?.lastUpdatedAt, lastBackupAt, lastClientAt, vault.registeredAt]),
  };
}

function normalizeKeepLatest(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

export async function handleAdminOverview(
  storage: StorageBackend,
  options: AdminOverviewOptions,
): Promise<{
  ok: true;
  server: {
    app: string;
    version: string;
    storageBackend: string;
    host: string;
    port: number;
    startedAt: string;
    serverTime: string;
    uptimeSeconds: number;
    apiKeyConfigured: boolean;
    devMode: boolean;
    totalConnections: number;
    knownClients: number;
    activeVaults: number;
  };
  totals: {
    vaults: number;
    backups: number;
    backupTotalSize: number;
    backupFileCount: number;
    liveFiles: number;
    liveDeleted: number;
    liveTotalSize: number;
  };
  capabilities: {
    listVaults: boolean;
    livePersistence: boolean;
    liveHistory: boolean;
    liveSyncClientHistory: boolean;
    liveSyncClientEvents: boolean;
    pruneLiveTombstones: boolean;
    deleteVault: boolean;
    renameVault: boolean;
    mergeVaults: boolean;
    exportVaultData: boolean;
    exportServerData: boolean;
    serverDataSnapshots: boolean;
    serverSnapshotFileRestore: boolean;
    serverSnapshotProofProtection: boolean;
    rebuildPreWriteSnapshots: boolean;
    serverRestoreMetadataBroadcast: boolean;
    tombstoneRetention30Days: boolean;
    tombstoneRetentionDays: number;
    prunedTombstoneHistoryProtection: boolean;
    destructiveTruncationProtection: boolean;
  };
  warnings: AdminWarning[];
  duplicateVaultGroups: AdminDuplicateVaultGroup[];
  serverDataSnapshots: import('../storage/storageTypes').ServerDataExportItem[];
  vaults: AdminVaultSummary[];
  recentBackups: Array<BackupListItem & { vaultId: string; vaultName: string }>;
  recentLiveFiles: AdminRecentLiveFile[];
  activeClients: Array<{ vaultId: string; clients: AdminClientSummary[] }>;
  clientHistory: Array<{ vaultId: string; clients: AdminClientSummary[] }>;
  clientEvents: Array<{ vaultId: string; events: LiveSyncClientEventEntry[] }>;
  syncMetrics: ReturnType<typeof getSyncMetrics>;
}> {
  const vaults: StoredVault[] = await getAdminVaults(storage);
  const summaries: AdminVaultSummary[] = [];

  for (const vault of vaults) {
    const backups = await storage.listBackups(vault.serverVaultId).catch(() => [] as BackupListItem[]);
    const onlineClients = getVaultClients(vault.vaultId).map((client) => summarizeLiveSyncClient(client));
    const clientHistory = await getAdminClientHistory(storage, vault.vaultId, onlineClients);
    const clientEvents = storage.listLiveSyncClientEvents
      ? await storage.listLiveSyncClientEvents(vault.vaultId, { limit: 80 }).catch(() => [] as LiveSyncClientEventEntry[])
      : [];
    const live = storage.getLiveFileSummary
      ? await storage.getLiveFileSummary(vault.vaultId).catch(() => null)
      : null;
    const liveFiles = storage.listLiveFiles
      ? await storage.listLiveFiles(vault.vaultId).catch(() => [] as LiveFileEntry[])
      : null;
    const team = liveFiles ? buildAdminTeamProductionSummary(liveFiles) : null;
    const lastBackupAt = backups[0]?.uploadedAt || null;
    const lastClientAt = newestDate(clientHistory.map((client) => client.lastActivityAt || client.lastSeenAt || client.connectedAt));

    summaries.push({
      vaultId: vault.vaultId,
      serverVaultId: vault.serverVaultId,
      vaultName: vault.vaultName,
      registeredAt: vault.registeredAt,
      clientId: vault.clientId,
      onlineClients,
      clientHistory,
      clientEvents,
      backupCount: backups.length,
      backupTotalSize: backups.reduce((sum, item) => sum + (Number(item.totalSize) || 0), 0),
      backupFileCount: backups.reduce((sum, item) => sum + (Number(item.fileCount) || 0), 0),
      lastBackupAt,
      live,
      team,
      lastActivityAt: newestDate([team?.lastTeamFileAt, live?.lastUpdatedAt, lastBackupAt, lastClientAt, vault.registeredAt]),
    });
  }

  summaries.sort((a, b) => (b.lastActivityAt || '').localeCompare(a.lastActivityAt || ''));

  const recentBackups = (await storage.listAllBackups().catch(() => []))
    .slice(0, 80)
    .map((backup) => ({
      ...backup,
      vaultId: backup.vaultId,
      vaultName: backup.vaultName,
    }));

  const recentLiveFiles: AdminRecentLiveFile[] = summaries
    .flatMap((vault) => (vault.live?.recentFiles || []).map((file) => ({
      vaultId: vault.vaultId,
      vaultName: vault.vaultName,
      relativePath: file.relativePath,
      size: file.size,
      updatedAt: file.updatedAt,
      deleted: file.deleted,
    })))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 80);

  const capabilities = {
    listVaults: !!storage.listVaults,
    livePersistence: !!storage.getLiveFileSummary,
    liveHistory: !!storage.listLiveHistory && !!storage.getLiveHistoryEntry && !!storage.restoreLiveHistoryEntry,
    liveSyncClientHistory: !!storage.listLiveSyncClientHistory,
    liveSyncClientEvents: !!storage.listLiveSyncClientEvents,
    pruneLiveTombstones: !!storage.pruneLiveTombstones,
    deleteVault: !!storage.deleteVault,
    renameVault: !!storage.renameVault,
    mergeVaults: !!storage.mergeVaults,
    exportVaultData: !!storage.exportVaultData,
    exportServerData: !!(storage.exportServerData || (storage.listVaults && storage.exportVaultData)),
    serverDataSnapshots: !!storage.createServerDataSnapshot && !!storage.listServerDataSnapshots && !!storage.readServerDataSnapshot,
    serverSnapshotFileRestore: !!storage.listServerSnapshotFiles && !!storage.restoreServerSnapshotFile,
    serverSnapshotProofProtection: true,
    rebuildPreWriteSnapshots: typeof storage.createServerDataSnapshot === 'function',
    serverRestoreMetadataBroadcast: true,
    tombstoneRetention30Days: LIVE_SYNC_TOMBSTONE_RETENTION_DAYS >= 30,
    tombstoneRetentionDays: LIVE_SYNC_TOMBSTONE_RETENTION_DAYS,
    prunedTombstoneHistoryProtection: typeof storage.listLiveHistory === 'function',
    destructiveTruncationProtection: true,
  };
  const serverDataSnapshots = storage.listServerDataSnapshots
    ? await storage.listServerDataSnapshots(10).catch(() => [])
    : [];
  const duplicateVaultGroups = buildDuplicateVaultGroups(summaries, capabilities);

  return {
    ok: true,
    server: {
      app: SERVER_APP_NAME,
      version: SERVER_VERSION,
      storageBackend: options.storageBackend,
      host: options.host,
      port: options.port,
      startedAt: options.startedAt,
      serverTime: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      apiKeyConfigured: options.apiKeyConfigured,
      devMode: options.devMode,
      totalConnections: getTotalConnections(),
      knownClients: summaries.reduce((sum, item) => sum + item.clientHistory.length, 0),
      activeVaults: getActiveVaultCount(),
    },
    totals: {
      vaults: summaries.length,
      backups: summaries.reduce((sum, item) => sum + item.backupCount, 0),
      backupTotalSize: summaries.reduce((sum, item) => sum + item.backupTotalSize, 0),
      backupFileCount: summaries.reduce((sum, item) => sum + item.backupFileCount, 0),
      liveFiles: summaries.reduce((sum, item) => sum + (item.live?.fileCount || 0), 0),
      liveDeleted: summaries.reduce((sum, item) => sum + (item.live?.deletedCount || 0), 0),
      liveTotalSize: summaries.reduce((sum, item) => sum + (item.live?.totalSize || 0), 0),
    },
    capabilities,
    warnings: buildWarnings(summaries, capabilities),
    duplicateVaultGroups,
    serverDataSnapshots,
    vaults: summaries,
    recentBackups,
    recentLiveFiles,
    activeClients: getLiveSyncClientSnapshot() as Array<{ vaultId: string; clients: AdminClientSummary[] }>,
    clientHistory: summaries.map((vault) => ({ vaultId: vault.vaultId, clients: vault.clientHistory })),
    clientEvents: summaries.map((vault) => ({ vaultId: vault.vaultId, events: vault.clientEvents })),
    syncMetrics: getSyncMetrics(),
  };
}

function isTeamProductionLiveFile(relativePath: string): boolean {
  return /^(?:\.ars-team\/|07_Unity_Tasks\/|\.ai-memory\/)/i.test(relativePath.replace(/\\/g, '/'));
}

function summarizeOnlineClients(vaultId: string): AdminClientSummary[] {
  return getVaultClients(vaultId).map((client) => summarizeLiveSyncClient(client));
}

export async function handleTeamProductionStatus(
  storage: StorageBackend,
  query: { vaultId: string; limit?: string | number },
): Promise<TeamProductionStatusResponse | { ok: false; error: string }> {
  const vaultId = String(query?.vaultId || '').trim();
  if (!vaultId) return { ok: false, error: 'Missing query param: vaultId' };
  if (typeof storage.listLiveFiles !== 'function') {
    return { ok: false, error: 'Live file persistence is not available for this storage backend' };
  }

  const vault = await resolveAdminVault(storage, vaultId);
  if (!vault) return { ok: false, error: 'Vault not found' };

  const limit = Math.max(1, Math.min(200, Number(query?.limit) || 40));
  const liveFiles = await storage.listLiveFiles(vault.vaultId);
  const activeLiveFiles = liveFiles.filter((file) => !file.deleted);
  const team = buildAdminTeamProductionSummary(liveFiles);
  const byPath = new Set(activeLiveFiles.map((file) => file.relativePath.replace(/\\/g, '/').toLowerCase()));
  const recentTeamFiles = liveFiles
    .filter((file) => isTeamProductionLiveFile(file.relativePath))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
    .map((file) => ({
      relativePath: file.relativePath.replace(/\\/g, '/'),
      size: Number(file.size) || 0,
      updatedAt: file.updatedAt,
      deleted: !!file.deleted,
    }));

  return {
    ok: true,
    vaultId: vault.vaultId,
    serverVaultId: vault.serverVaultId,
    vaultName: vault.vaultName,
    checkedAt: new Date().toISOString(),
    onlineClients: summarizeOnlineClients(vault.vaultId),
    team,
    liveFileCount: liveFiles.length,
    recentTeamFiles,
    sourceFiles: {
      schedule: byPath.has('.ars-team/schedule.json'),
      aiMemoryManifest: byPath.has('.ai-memory/__manifest.json'),
      teamDocs: team.teamDocs,
      taskDocs: team.taskDocs,
      aiMemoryFiles: team.aiMemoryFiles,
      aiSkills: team.aiSkills,
      aiMemoryCoreFiles: team.aiMemoryCoreFiles,
      missingAiMemoryCoreFiles: team.missingAiMemoryCoreFiles,
      coreDocs: team.coreDocs,
      missingCoreDocs: team.missingCoreDocs,
    },
  };
}

export async function handleTeamMemberWork(
  storage: StorageBackend,
  query: { vaultId: string; member?: string; limit?: string | number },
): Promise<TeamMemberWorkResponse | { ok: false; error: string }> {
  const vaultId = String(query?.vaultId || '').trim();
  if (!vaultId) return { ok: false, error: 'Missing query param: vaultId' };
  if (typeof storage.listLiveFiles !== 'function') {
    return { ok: false, error: 'Live file persistence is not available for this storage backend' };
  }

  const vault = await resolveAdminVault(storage, vaultId);
  if (!vault) return { ok: false, error: 'Vault not found' };

  const limit = Math.max(1, Math.min(200, Number(query?.limit) || 40));
  const member = normalizeAdminMemberName(query?.member);
  const liveFiles = await storage.listLiveFiles(vault.vaultId);
  const activeLiveFiles = liveFiles.filter((file) => !file.deleted);
  const byPath = new Map(activeLiveFiles.map((file) => [file.relativePath.replace(/\\/g, '/').toLowerCase(), file]));
  const byPathSet = new Set(byPath.keys());
  const scheduleFile = byPath.get('.ars-team/schedule.json');
  const schedule = parseLiveJson<any>(scheduleFile);
  const tasks = Array.isArray(schedule?.tasks) ? schedule.tasks : [];
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date();
  soon.setDate(soon.getDate() + 7);
  const soonDate = soon.toISOString().slice(0, 10);
  const members = collectAdminTeamMembers(schedule, tasks);
  const memberWork = buildAdminTeamMemberWork(schedule, tasks, byPathSet, today, soonDate);
  const summary = member
    ? memberWork.find((row) => row.member === member) || buildAdminMemberWorkSummary(member, tasks, byPathSet, today, soonDate)
    : null;
  const selectedTasks = member
    ? sortAdminWorkTasks(tasks
      .filter((task: any) => taskMatchesMember(task, member))
      .map((task: any) => toAdminMemberWorkTask(task, byPathSet, member)))
      .slice(0, limit)
    : [];
  const recentLogs = tasks
    .flatMap((task: any) => taskLogsForMember(task, member))
    .sort((a: AdminMemberWorkLog, b: AdminMemberWorkLog) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date))
    .slice(0, limit);

  return {
    ok: true,
    vaultId: vault.vaultId,
    serverVaultId: vault.serverVaultId,
    vaultName: vault.vaultName,
    checkedAt: new Date().toISOString(),
    member,
    members,
    memberWork,
    summary,
    tasks: selectedTasks,
    recentLogs,
    sourceFiles: {
      schedule: !!scheduleFile,
      teamDocs: activeLiveFiles.filter((file) => /^\.ars-team\/.+\.(md|json)$/i.test(file.relativePath)).length,
      taskDocs: activeLiveFiles.filter((file) => /^07_Unity_Tasks\/.+\.md$/i.test(file.relativePath)).length,
    },
  };
}

export async function handleAdminVaultIdentity(
  storage: StorageBackend,
  query: { vaultId?: string; vaultName?: string },
): Promise<VaultIdentityDiagnosticsResponse | { ok: false; error: string }> {
  if (typeof storage.listVaults !== 'function') {
    return { ok: false, error: 'Current storage backend does not support listing vaults' };
  }

  const vaultId = String(query?.vaultId || '').trim();
  const vaultName = String(query?.vaultName || '').trim();
  if (!vaultId && !vaultName) {
    return { ok: false, error: 'Missing query param: vaultId or vaultName' };
  }

  const vaults = await getAdminVaults(storage);
  const exact = vaultId
    ? vaults.find((vault) => vault.vaultId === vaultId || vault.serverVaultId === vaultId) || null
    : null;
  const nameKey = vaultName.trim().toLowerCase();
  const idAsNameKey = vaultId.trim().toLowerCase();
  const nameMatchesRaw = vaults.filter((vault) => {
    const candidate = vault.vaultName.trim().toLowerCase();
    return !!candidate && (candidate === nameKey || candidate === idAsNameKey);
  });

  const exactVault = exact ? await buildAdminVaultSummary(storage, exact) : null;
  const nameMatches = await Promise.all(
    nameMatchesRaw
      .filter((vault) => !exact || vault.vaultId !== exact.vaultId)
      .slice(0, 12)
      .map((vault) => buildAdminVaultSummary(storage, vault)),
  );
  const recommendationCandidates = [exactVault, ...nameMatches]
    .filter((vault): vault is AdminVaultSummary => !!vault);
  const recommendedVault = recommendationCandidates.length > 0
    ? [...recommendationCandidates].sort((a, b) => duplicateVaultScore(b) - duplicateVaultScore(a))[0]
    : null;
  const currentIsRecommended = !!(
    exactVault
    && recommendedVault
    && exactVault.vaultId === recommendedVault.vaultId
  );

  const advice: string[] = [];
  if (exactVault) {
    advice.push(`当前 Vault ID 已在服务器注册：${exactVault.vaultName} (${exactVault.vaultId})。`);
  } else if (vaultId) {
    advice.push(`服务器上没有找到当前 Vault ID：${vaultId}。`);
  }
  if (!exactVault && nameMatches.length > 0) {
    advice.push('你输入的值更像 Vault 显示名称，不是实际 Vault ID。请从下面同名 Vault 中复制 Vault ID。');
  }
  if (nameMatches.length > 1) {
    advice.push('服务器上存在多个同名 Vault。请保留正确的一个，删除不用的重复 Vault，避免团队成员连到不同库。');
  }
  if (!exactVault && nameMatches.length === 0) {
    advice.push('没有找到同名 Vault。请先在正确电脑上连接/注册一次，或从服务器管理页复制现有 Vault ID。');
  }
  if (exactVault && nameMatches.length > 0) {
    advice.push('当前 ID 可用，但服务器上还有同名 Vault。建议清理不用的重复 Vault，降低队友错连风险。');
  }
  if (recommendedVault && exactVault && !currentIsRecommended) {
    advice.push(`当前 ID 可用，但它不像主 Vault。建议团队统一使用：${recommendedVault.vaultId}。判断依据：${duplicateVaultKeeperReason(recommendedVault)}。`);
  } else if (recommendedVault && !exactVault) {
    advice.push(`建议使用服务器上最像主库的 Vault ID：${recommendedVault.vaultId}。判断依据：${duplicateVaultKeeperReason(recommendedVault)}。`);
  }

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    query: { vaultId, vaultName },
    exactMatch: !!exactVault,
    exactVault,
    nameMatches,
    recommendedVaultId: recommendedVault?.vaultId,
    recommendedReason: recommendedVault ? duplicateVaultKeeperReason(recommendedVault) : undefined,
    currentIsRecommended,
    duplicateNameRisk: nameMatches.length > 0 || (!exactVault && nameMatches.length > 1),
    advice,
  };
}

export async function handleAdminDeleteBackup(
  storage: StorageBackend,
  body: { vaultId: string; backupId: string },
): Promise<{ ok: true; vaultId: string; backupId: string; deleted: boolean; deletedAt: string; preOperationSnapshot: AdminPreOperationSnapshot } | { ok: false; error: string }> {
  const { vaultId, backupId } = body || {};
  if (!vaultId || !backupId) {
    return { ok: false, error: 'Missing required fields: vaultId, backupId' };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(backupId)) {
    return { ok: false, error: 'Invalid backupId format' };
  }

  const vault = await resolveAdminVault(storage, vaultId);
  if (!vault) return { ok: false, error: 'Vault not found' };

  const snapshot = await createAdminPreOperationSnapshot(storage, `delete-backup:${vault.vaultId}:${backupId}`);
  if (!snapshot.ok) return snapshot;

  const deleted = await storage.deleteBackup(vault.serverVaultId, backupId);
  return {
    ok: true,
    vaultId: vault.vaultId,
    backupId,
    deleted,
    deletedAt: new Date().toISOString(),
    preOperationSnapshot: snapshot.preOperationSnapshot,
  };
}

export async function handleAdminDeleteVault(
  storage: StorageBackend,
  body: { vaultId: string },
): Promise<({ ok: true; deletedAt: string; preOperationSnapshot: AdminPreOperationSnapshot } & VaultDeleteResult) | { ok: false; error: string }> {
  if (typeof storage.deleteVault !== 'function') {
    return { ok: false, error: 'Current storage backend does not support deleting vaults' };
  }

  const vaultId = String(body?.vaultId || '').trim();
  if (!vaultId) {
    return { ok: false, error: 'Missing required field: vaultId' };
  }

  const vaults = await getAdminVaults(storage);
  const vault = vaults.find((item) => item.vaultId === vaultId || item.serverVaultId === vaultId);
  if (!vault) {
    return { ok: false, error: 'Vault not found' };
  }

  const onlineCount = getVaultClients(vault.vaultId).length;
  if (onlineCount > 0) {
    return { ok: false, error: `Vault has ${onlineCount} online client(s); disconnect them before deleting` };
  }

  const snapshot = await createAdminPreOperationSnapshot(storage, `delete-vault:${vault.vaultId}`);
  if (!snapshot.ok) return snapshot;

  const result = await storage.deleteVault(vault.vaultId);
  if (!result.deleted) {
    return { ok: false, error: 'Vault not found' };
  }

  return {
    ok: true,
    ...result,
    deletedAt: new Date().toISOString(),
    preOperationSnapshot: snapshot.preOperationSnapshot,
  };
}

export async function handleAdminRenameVault(
  storage: StorageBackend,
  body: { vaultId: string; newVaultName: string },
): Promise<{ ok: true; vaultId: string; serverVaultId: string; vaultName: string; renamedAt: string; preOperationSnapshot: AdminPreOperationSnapshot } | { ok: false; error: string }> {
  if (typeof storage.renameVault !== 'function') {
    return { ok: false, error: 'Current storage backend does not support renaming vaults' };
  }

  const vaultId = String(body?.vaultId || '').trim();
  const newVaultName = String(body?.newVaultName || '').trim();
  if (!vaultId || !newVaultName) {
    return { ok: false, error: 'Missing required fields: vaultId, newVaultName' };
  }
  if (newVaultName.length > 120) {
    return { ok: false, error: 'Vault name is too long' };
  }

  const existing = await resolveAdminVault(storage, vaultId);
  if (!existing) return { ok: false, error: 'Vault not found' };

  const snapshot = await createAdminPreOperationSnapshot(storage, `rename-vault:${existing.vaultId}`);
  if (!snapshot.ok) return snapshot;

  const vault = await storage.renameVault(vaultId, newVaultName);
  if (!vault) return { ok: false, error: 'Vault not found' };

  return {
    ok: true,
    vaultId: vault.vaultId,
    serverVaultId: vault.serverVaultId,
    vaultName: vault.vaultName,
    renamedAt: new Date().toISOString(),
    preOperationSnapshot: snapshot.preOperationSnapshot,
  };
}

export async function handleAdminMergeVaults(
  storage: StorageBackend,
  body: { sourceVaultId: string; targetVaultId: string; deleteSource?: boolean },
): Promise<{ ok: true; mergedAt: string; result: Awaited<ReturnType<NonNullable<StorageBackend['mergeVaults']>>>; preOperationSnapshot: AdminPreOperationSnapshot } | { ok: false; error: string }> {
  if (typeof storage.mergeVaults !== 'function') {
    return { ok: false, error: 'Current storage backend does not support merging vaults' };
  }

  const sourceVaultId = String(body?.sourceVaultId || '').trim();
  const targetVaultId = String(body?.targetVaultId || '').trim();
  if (!sourceVaultId || !targetVaultId) {
    return { ok: false, error: 'Missing required fields: sourceVaultId, targetVaultId' };
  }
  if (sourceVaultId === targetVaultId) {
    return { ok: false, error: 'Source and target vault are the same' };
  }

  const source = await resolveAdminVault(storage, sourceVaultId);
  const target = await resolveAdminVault(storage, targetVaultId);
  if (!source) return { ok: false, error: 'Source vault not found' };
  if (!target) return { ok: false, error: 'Target vault not found' };

  const onlineSourceCount = getVaultClients(source.vaultId).length;
  if (onlineSourceCount > 0) {
    return { ok: false, error: `Source vault has ${onlineSourceCount} online client(s); disconnect them before merging` };
  }

  const snapshot = await createAdminPreOperationSnapshot(storage, `merge-vault:${source.vaultId}:into:${target.vaultId}`);
  if (!snapshot.ok) return snapshot;

  const result = await storage.mergeVaults(source.vaultId, target.vaultId, {
    deleteSource: body?.deleteSource !== false,
  });

  return {
    ok: true,
    mergedAt: new Date().toISOString(),
    result,
    preOperationSnapshot: snapshot.preOperationSnapshot,
  };
}

export async function handleAdminExportVaultData(
  storage: StorageBackend,
  query: { vaultId: string },
): Promise<{ ok: true } & Awaited<ReturnType<NonNullable<StorageBackend['exportVaultData']>>> | { ok: false; error: string }> {
  if (typeof storage.exportVaultData !== 'function') {
    return { ok: false, error: 'Current storage backend does not support full vault export' };
  }

  const vaultId = String(query?.vaultId || '').trim();
  if (!vaultId) return { ok: false, error: 'Missing query param: vaultId' };

  const result = await storage.exportVaultData(vaultId);
  if (!result) return { ok: false, error: 'Vault not found' };
  return {
    ok: true,
    ...result,
  };
}

export async function handleAdminExportServerData(
  storage: StorageBackend,
): Promise<{
  ok: true;
  exportedAt: string;
  fileName: string;
  size: number;
  sha256: string;
  sourceVaultCount: number;
  vaultCount: number;
  skippedCount: number;
  skipped: Array<{ vaultId: string; vaultName: string; error: string }>;
  contentBase64: string;
} | { ok: false; error: string }> {
  if (typeof storage.exportServerData === 'function') {
    const result = await storage.exportServerData();
    return {
      ok: true,
      ...result,
    };
  }

  if (typeof storage.listVaults !== 'function' || typeof storage.exportVaultData !== 'function') {
    return { ok: false, error: 'Current storage backend does not support full server export' };
  }

  const exportedAt = new Date().toISOString();
  const vaults = await getAdminVaults(storage);
  const vaultExports: any[] = [];
  const skipped: Array<{ vaultId: string; vaultName: string; error: string }> = [];

  for (const vault of vaults) {
    try {
      const result = await storage.exportVaultData(vault.vaultId);
      if (!result) {
        skipped.push({ vaultId: vault.vaultId, vaultName: vault.vaultName, error: 'Vault not found during export' });
        continue;
      }

      let payload: any = null;
      try {
        payload = JSON.parse(Buffer.from(result.contentBase64, 'base64').toString('utf-8'));
      } catch (err: any) {
        skipped.push({
          vaultId: vault.vaultId,
          vaultName: vault.vaultName,
          error: err?.message || 'Unable to decode vault export payload',
        });
        continue;
      }

      vaultExports.push({
        vaultId: result.vaultId,
        serverVaultId: result.serverVaultId,
        vaultName: result.vaultName,
        fileName: result.fileName,
        size: result.size,
        sha256: result.sha256,
        payload,
      });
    } catch (err: any) {
      skipped.push({
        vaultId: vault.vaultId,
        vaultName: vault.vaultName,
        error: err?.message || 'Vault export failed',
      });
    }
  }

  const bundle = {
    version: 1,
    app: SERVER_APP_NAME,
    serverVersion: SERVER_VERSION,
    exportType: 'full-server-data',
    exportedAt,
    sourceVaultCount: vaults.length,
    vaultCount: vaultExports.length,
    skippedCount: skipped.length,
    skipped,
    vaultExports,
  };
  const buffer = Buffer.from(JSON.stringify(bundle, null, 2), 'utf-8');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    ok: true,
    exportedAt,
    fileName: `ars-note-server-full-export-${exportedAt.slice(0, 19).replace(/[:T]/g, '-')}.json`,
    size: buffer.length,
    sha256,
    sourceVaultCount: vaults.length,
    vaultCount: vaultExports.length,
    skippedCount: skipped.length,
    skipped,
    contentBase64: buffer.toString('base64'),
  };
}

export async function handleAdminCreateServerSnapshot(
  storage: StorageBackend,
  body?: { reason?: string; keepLatest?: number },
): Promise<({ ok: true } & import('../storage/storageTypes').ServerDataExportItem) | { ok: false; error: string }> {
  if (typeof storage.createServerDataSnapshot !== 'function') {
    return { ok: false, error: 'Current storage backend does not support server-side snapshots' };
  }

  const result = await storage.createServerDataSnapshot({
    reason: body?.reason || 'manual-admin',
    keepLatest: body?.keepLatest,
  });
  return {
    ok: true,
    ...result,
  };
}

export async function handleAdminListServerSnapshots(
  storage: StorageBackend,
  query: { limit?: string | number },
): Promise<{ ok: true; snapshots: import('../storage/storageTypes').ServerDataExportItem[] } | { ok: false; error: string }> {
  if (typeof storage.listServerDataSnapshots !== 'function') {
    return { ok: false, error: 'Current storage backend does not support server-side snapshots' };
  }

  const limit = Math.max(1, Math.min(200, Math.floor(Number(query?.limit) || 50)));
  return {
    ok: true,
    snapshots: await storage.listServerDataSnapshots(limit),
  };
}

export async function handleAdminReadServerSnapshot(
  storage: StorageBackend,
  query: { fileName?: string },
): Promise<({ ok: true } & import('../storage/storageTypes').ServerDataExportResult) | { ok: false; error: string }> {
  if (typeof storage.readServerDataSnapshot !== 'function') {
    return { ok: false, error: 'Current storage backend does not support server-side snapshots' };
  }

  const fileName = String(query?.fileName || '').trim();
  if (!fileName) return { ok: false, error: 'Missing query param: fileName' };
  const result = await storage.readServerDataSnapshot(fileName);
  if (!result) return { ok: false, error: 'Server snapshot not found' };
  return {
    ok: true,
    ...result,
  };
}

export async function handleAdminListServerSnapshotFiles(
  storage: StorageBackend,
  query: {
    fileName?: string;
    vaultId?: string;
    relativePath?: string;
    q?: string;
    source?: string;
    limit?: string | number;
  },
): Promise<{ ok: true; fileName: string; files: ServerSnapshotFileCandidate[] } | { ok: false; error: string }> {
  if (typeof storage.listServerSnapshotFiles !== 'function') {
    return { ok: false, error: 'Current storage backend does not support snapshot file browsing' };
  }

  const fileName = String(query?.fileName || '').trim();
  if (!fileName) return { ok: false, error: 'Missing query param: fileName' };
  const limit = Math.max(1, Math.min(500, Math.floor(Number(query?.limit) || 200)));
  const source = normalizeAdminSnapshotFileSource(query?.source);
  const files = await storage.listServerSnapshotFiles(fileName, {
    vaultId: String(query?.vaultId || '').trim() || undefined,
    relativePath: String(query?.relativePath || '').trim() || undefined,
    query: String(query?.q || '').trim() || undefined,
    source,
    limit,
  });
  return {
    ok: true,
    fileName,
    files,
  };
}

export async function handleAdminRestoreServerSnapshotFile(
  storage: StorageBackend,
  body?: {
    fileName?: string;
    vaultId?: string;
    relativePath?: string;
    source?: string;
    backupId?: string;
    revisionId?: string;
  },
): Promise<{
  ok: true;
  vaultId: string;
  file: LiveFileEntry;
  candidate: ServerSnapshotFileCandidate;
  restoredAt: string;
  preOperationSnapshot: AdminPreOperationSnapshot;
} | { ok: false; error: string }> {
  if (typeof storage.restoreServerSnapshotFile !== 'function') {
    return { ok: false, error: 'Current storage backend does not support snapshot file restore' };
  }

  const fileName = String(body?.fileName || '').trim();
  const vaultId = String(body?.vaultId || '').trim();
  const relativePath = String(body?.relativePath || '').trim();
  if (!fileName) return { ok: false, error: 'Missing field: fileName' };
  if (!vaultId) return { ok: false, error: 'Missing field: vaultId' };
  if (!relativePath) return { ok: false, error: 'Missing field: relativePath' };

  const snapshot = await createAdminPreOperationSnapshot(storage, `restore-server-snapshot-file:${vaultId}:${relativePath}`);
  if (!snapshot.ok) return snapshot;

  const result = await storage.restoreServerSnapshotFile(fileName, {
    vaultId,
    relativePath,
    source: normalizeAdminSnapshotFileSource(body?.source),
    backupId: String(body?.backupId || '').trim() || undefined,
    revisionId: String(body?.revisionId || '').trim() || undefined,
  });
  if (!result) return { ok: false, error: 'Snapshot file version not found or has no recoverable content' };

  return {
    ok: true,
    vaultId: result.candidate.vaultId,
    file: result.file,
    candidate: result.candidate,
    restoredAt: result.restoredAt,
    preOperationSnapshot: snapshot.preOperationSnapshot,
  };
}

export async function handleAdminDeleteDuplicateVaults(
  storage: StorageBackend,
  body?: { dryRun?: boolean },
): Promise<{
  ok: true;
  dryRun: boolean;
  checkedAt: string;
  groupCount: number;
  candidates: number;
  deleted: number;
  skipped: number;
  items: AdminDuplicateVaultCleanupItem[];
  preOperationSnapshot: AdminPreOperationSnapshot;
} | { ok: false; error: string }> {
  if (typeof storage.deleteVault !== 'function') {
    return { ok: false, error: 'Current storage backend does not support deleting vaults' };
  }

  const dryRun = body?.dryRun === true;
  const vaults = await getAdminVaults(storage);
  const summaries = await Promise.all(vaults.map((vault) => buildAdminVaultSummary(storage, vault)));
  const groups = buildDuplicateVaultGroups(summaries, { deleteVault: true });
  const items: AdminDuplicateVaultCleanupItem[] = [];
  const candidateCount = groups.reduce((sum, group) => sum + group.vaults.filter((vault) => vault.deleteSafe).length, 0);
  const snapshot = !dryRun && candidateCount > 0
    ? await createAdminPreOperationSnapshot(storage, `delete-duplicate-vaults:${candidateCount}`)
    : { ok: true as const, preOperationSnapshot: null };
  if (!snapshot.ok) return snapshot;

  for (const group of groups) {
    for (const vault of group.vaults) {
      if (!vault.deleteSafe) continue;

      const onlineCount = getVaultClients(vault.vaultId).length;
      if (onlineCount > 0) {
        items.push({
          groupName: group.name,
          keeperVaultId: group.keeperVaultId,
          vaultId: vault.vaultId,
          vaultName: vault.vaultName,
          deleted: false,
          skippedReason: `Vault has ${onlineCount} online client(s)`,
        });
        continue;
      }

      if (dryRun) {
        items.push({
          groupName: group.name,
          keeperVaultId: group.keeperVaultId,
          vaultId: vault.vaultId,
          vaultName: vault.vaultName,
          deleted: false,
        });
        continue;
      }

      const result = await storage.deleteVault(vault.vaultId);
      items.push({
        groupName: group.name,
        keeperVaultId: group.keeperVaultId,
        vaultId: vault.vaultId,
        vaultName: vault.vaultName,
        deleted: result.deleted,
        skippedReason: result.deleted ? undefined : 'Vault not found',
        result,
      });
    }
  }

  return {
    ok: true,
    dryRun,
    checkedAt: new Date().toISOString(),
    groupCount: groups.length,
    candidates: items.length,
    deleted: items.filter((item) => item.deleted).length,
    skipped: items.filter((item) => !!item.skippedReason).length,
    items,
    preOperationSnapshot: snapshot.preOperationSnapshot,
  };
}

export async function handleAdminPruneBackups(
  storage: StorageBackend,
  body: { vaultId?: string; keepLatest?: number },
): Promise<{ ok: true; keepLatest: number; deleted: number; vaults: Array<{ vaultId: string; vaultName: string; deleted: number }>; preOperationSnapshot: AdminPreOperationSnapshot } | { ok: false; error: string }> {
  const keepLatest = normalizeKeepLatest(body?.keepLatest);
  const allVaults = await getAdminVaults(storage);
  const targetVaults = body?.vaultId && body.vaultId !== 'all'
    ? allVaults.filter((vault) => vault.vaultId === body.vaultId || vault.serverVaultId === body.vaultId)
    : allVaults;

  if (body?.vaultId && body.vaultId !== 'all' && targetVaults.length === 0) {
    return { ok: false, error: 'Vault not found' };
  }

  const snapshot = await createAdminPreOperationSnapshot(storage, `prune-backups:${body?.vaultId || 'all'}:keep-${keepLatest}`);
  if (!snapshot.ok) return snapshot;

  const results: Array<{ vaultId: string; vaultName: string; deleted: number }> = [];
  let deletedTotal = 0;

  for (const vault of targetVaults) {
    const backups = await storage.listBackups(vault.serverVaultId);
    const oldBackups = backups.slice(keepLatest);
    let deleted = 0;

    for (const backup of oldBackups) {
      if (await storage.deleteBackup(vault.serverVaultId, backup.backupId)) {
        deleted++;
        deletedTotal++;
      }
    }

    results.push({
      vaultId: vault.vaultId,
      vaultName: vault.vaultName,
      deleted,
    });
  }

  return {
    ok: true,
    keepLatest,
    deleted: deletedTotal,
    vaults: results,
    preOperationSnapshot: snapshot.preOperationSnapshot,
  };
}

export async function handleAdminPruneLiveTombstones(
  storage: StorageBackend,
  body: { vaultId: string; olderThanDays?: number; force?: boolean },
): Promise<{ ok: true; vaultId: string; vaultName: string; removed: number; retentionDays: number; force: boolean; prunedAt: string; preOperationSnapshot: AdminPreOperationSnapshot } | { ok: false; error: string }> {
  if (!storage.pruneLiveTombstones) {
    return { ok: false, error: 'Current storage backend does not support live tombstone cleanup' };
  }

  const { vaultId } = body || {};
  if (!vaultId) {
    return { ok: false, error: 'Missing required field: vaultId' };
  }

  const vault = await resolveAdminVault(storage, vaultId);
  if (!vault) return { ok: false, error: 'Vault not found' };

  const retentionDays = Math.max(1, Math.min(3650, Math.floor(Number(body?.olderThanDays) || 30)));
  const force = body?.force === true;
  const snapshot = await createAdminPreOperationSnapshot(storage, `prune-live-tombstones:${vault.vaultId}:older-than-${retentionDays}${force ? ':force' : ''}`);
  if (!snapshot.ok) return snapshot;

  const removed = await storage.pruneLiveTombstones(vault.vaultId, { olderThanDays: retentionDays, force });
  return {
    ok: true,
    vaultId: vault.vaultId,
    vaultName: vault.vaultName,
    removed,
    retentionDays,
    force,
    prunedAt: new Date().toISOString(),
    preOperationSnapshot: snapshot.preOperationSnapshot,
  };
}

export async function handleAdminPruneIgnoredLiveFiles(
  storage: StorageBackend,
  body: { vaultId: string },
): Promise<{ ok: true; vaultId: string; vaultName: string; removed: number; prunedAt: string; preOperationSnapshot: AdminPreOperationSnapshot } | { ok: false; error: string }> {
  if (!storage.pruneIgnoredLiveFiles) {
    return { ok: false, error: 'Live ignored-file pruning is not available for this storage backend' };
  }

  const vaultId = String(body?.vaultId || '').trim();
  if (!vaultId) return { ok: false, error: 'Missing required field: vaultId' };

  const vault = await resolveAdminVault(storage, vaultId);
  if (!vault) return { ok: false, error: 'Vault not found' };

  const snapshot = await createAdminPreOperationSnapshot(storage, `prune-ignored-live-files:${vault.vaultId}`);
  if (!snapshot.ok) return snapshot;

  const removed = await storage.pruneIgnoredLiveFiles(vault.vaultId);
  return {
    ok: true,
    vaultId: vault.vaultId,
    vaultName: vault.vaultName,
    removed,
    prunedAt: new Date().toISOString(),
    preOperationSnapshot: snapshot.preOperationSnapshot,
  };
}

function normalizeManifestFiles(manifest: any): AdminBackupFileEntry[] {
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  return files
    .filter((file: any) => typeof file?.relativePath === 'string' && file.relativePath)
    .map((file: any) => ({
      relativePath: String(file.relativePath).replace(/\\/g, '/'),
      type: String(file.type || 'other'),
      size: Number(file.size) || 0,
      sha256: String(file.sha256 || ''),
      updatedAt: String(file.updatedAt || ''),
      deleted: !!file.deleted,
    }))
    .sort((a: AdminBackupFileEntry, b: AdminBackupFileEntry) => a.relativePath.localeCompare(b.relativePath));
}

export async function handleAdminListBackupFiles(
  storage: StorageBackend,
  query: { vaultId: string; backupId: string },
): Promise<{ ok: true; vaultId: string; vaultName: string; backupId: string; uploadedAt: string; fileCount: number; totalSize: number; files: AdminBackupFileEntry[] } | { ok: false; error: string }> {
  const { vaultId, backupId } = query;
  if (!vaultId || !backupId) {
    return { ok: false, error: 'Missing query params: vaultId, backupId' };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(backupId)) {
    return { ok: false, error: 'Invalid backupId format' };
  }

  const vault = await resolveAdminVault(storage, vaultId);
  if (!vault) return { ok: false, error: 'Vault not found' };

  const meta = await storage.getBackupMeta(vault.serverVaultId, backupId);
  if (!meta) return { ok: false, error: 'Backup not found' };

  return {
    ok: true,
    vaultId: vault.vaultId,
    vaultName: vault.vaultName,
    backupId: meta.backupId,
    uploadedAt: meta.uploadedAt,
    fileCount: meta.fileCount,
    totalSize: meta.totalSize,
    files: normalizeManifestFiles(meta.manifest),
  };
}

export async function handleAdminReadBackupFile(
  storage: StorageBackend,
  query: { vaultId: string; backupId: string; relativePath: string },
): Promise<{ ok: true; vaultId: string; backupId: string; relativePath: string; contentBase64: string; size: number; sha256: string } | { ok: false; error: string }> {
  const { vaultId, backupId, relativePath } = query;
  if (!vaultId || !backupId || !relativePath) {
    return { ok: false, error: 'Missing query params: vaultId, backupId, relativePath' };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(backupId)) {
    return { ok: false, error: 'Invalid backupId format' };
  }

  const vault = await resolveAdminVault(storage, vaultId);
  if (!vault) return { ok: false, error: 'Vault not found' };

  const content = await storage.readFile(vault.serverVaultId, backupId, relativePath);
  if (!content) return { ok: false, error: 'File not found in backup' };

  return {
    ok: true,
    vaultId: vault.vaultId,
    backupId,
    relativePath: String(relativePath).replace(/\\/g, '/'),
    contentBase64: content.toString('base64'),
    size: content.length,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  };
}

export async function handleAdminReadLiveFile(
  storage: StorageBackend,
  query: { vaultId: string; relativePath: string },
): Promise<{ ok: true; vaultId: string; relativePath: string; contentBase64: string; size: number; sha256: string; updatedAt: string } | { ok: false; error: string }> {
  const { vaultId, relativePath } = query;
  if (!vaultId || !relativePath) {
    return { ok: false, error: 'Missing query params: vaultId, relativePath' };
  }
  if (typeof storage.listLiveFiles !== 'function') {
    return { ok: false, error: 'Live file persistence is not available for this storage backend' };
  }

  const files = await storage.listLiveFiles(vaultId);
  const file = files.find((item) => item.relativePath === relativePath);
  if (!file) return { ok: false, error: 'Live file not found' };
  if (file.deleted) return { ok: false, error: 'Live file is a delete record, not downloadable' };
  if (!file.contentBase64) return { ok: false, error: 'Live file content is not available' };

  return {
    ok: true,
    vaultId,
    relativePath: file.relativePath,
    contentBase64: file.contentBase64,
    size: file.size,
    sha256: file.sha256,
    updatedAt: file.updatedAt,
  };
}

function normalizeLiveHistoryLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(500, Math.floor(parsed)));
}

function stripLiveHistoryContent(item: LiveFileHistoryEntry): LiveFileHistoryEntry {
  const { contentBase64: _contentBase64, ...rest } = item;
  return rest;
}

export async function handleAdminListLiveHistory(
  storage: StorageBackend,
  query: { vaultId: string; relativePath?: string; limit?: string | number },
): Promise<{ ok: true; vaultId: string; vaultName: string; relativePath: string | null; count: number; history: LiveFileHistoryEntry[] } | { ok: false; error: string }> {
  if (typeof storage.listLiveHistory !== 'function') {
    return { ok: false, error: 'Live history is not available for this storage backend' };
  }

  const vaultId = String(query?.vaultId || '').trim();
  if (!vaultId) return { ok: false, error: 'Missing query param: vaultId' };

  const vault = await resolveAdminVault(storage, vaultId);
  if (!vault) return { ok: false, error: 'Vault not found' };

  const relativePath = String(query?.relativePath || '').trim();
  const limit = normalizeLiveHistoryLimit(query?.limit);
  const history = await storage.listLiveHistory(vault.vaultId, relativePath || undefined, limit);

  return {
    ok: true,
    vaultId: vault.vaultId,
    vaultName: vault.vaultName,
    relativePath: relativePath || null,
    count: history.length,
    history: history.map(stripLiveHistoryContent),
  };
}

export async function handleAdminReadLiveHistoryFile(
  storage: StorageBackend,
  query: { vaultId: string; relativePath: string; revisionId: string },
): Promise<{ ok: true; vaultId: string; vaultName: string; relativePath: string; revisionId: string; action: string; recordedAt: string; updatedAt: string; contentBase64: string; size: number; sha256: string; deleted: boolean; reason?: string } | { ok: false; error: string }> {
  if (typeof storage.getLiveHistoryEntry !== 'function') {
    return { ok: false, error: 'Live history is not available for this storage backend' };
  }

  const vaultId = String(query?.vaultId || '').trim();
  const relativePath = String(query?.relativePath || '').trim();
  const revisionId = String(query?.revisionId || '').trim();
  if (!vaultId || !relativePath || !revisionId) {
    return { ok: false, error: 'Missing query params: vaultId, relativePath, revisionId' };
  }

  const vault = await resolveAdminVault(storage, vaultId);
  if (!vault) return { ok: false, error: 'Vault not found' };

  const record = await storage.getLiveHistoryEntry(vault.vaultId, relativePath, revisionId);
  if (!record) return { ok: false, error: 'Live history record not found' };
  if (!record.contentBase64) return { ok: false, error: 'This history record has no downloadable content' };

  return {
    ok: true,
    vaultId: vault.vaultId,
    vaultName: vault.vaultName,
    relativePath: record.relativePath,
    revisionId: record.revisionId,
    action: record.action,
    recordedAt: record.recordedAt,
    updatedAt: record.updatedAt,
    contentBase64: record.contentBase64,
    size: record.size,
    sha256: record.sha256,
    deleted: !!record.deleted,
    reason: record.reason,
  };
}

export async function handleAdminRestoreLiveHistory(
  storage: StorageBackend,
  body: { vaultId: string; relativePath: string; revisionId: string },
): Promise<{ ok: true; vaultId: string; vaultName: string; relativePath: string; revisionId: string; restoredAt: string; file: LiveFileEntry; preOperationSnapshot: AdminPreOperationSnapshot } | { ok: false; error: string }> {
  if (typeof storage.restoreLiveHistoryEntry !== 'function') {
    return { ok: false, error: 'Live history restore is not available for this storage backend' };
  }

  const vaultId = String(body?.vaultId || '').trim();
  const relativePath = String(body?.relativePath || '').trim();
  const revisionId = String(body?.revisionId || '').trim();
  if (!vaultId || !relativePath || !revisionId) {
    return { ok: false, error: 'Missing required fields: vaultId, relativePath, revisionId' };
  }

  const vault = await resolveAdminVault(storage, vaultId);
  if (!vault) return { ok: false, error: 'Vault not found' };

  const snapshot = await createAdminPreOperationSnapshot(storage, `restore-live-history:${vault.vaultId}:${relativePath}`);
  if (!snapshot.ok) return snapshot;

  const restoredAt = new Date().toISOString();
  const file = await storage.restoreLiveHistoryEntry(vault.vaultId, relativePath, revisionId, restoredAt);
  if (!file || file.deleted || !file.contentBase64) {
    return { ok: false, error: 'Only content-bearing history records can be restored' };
  }

  return {
    ok: true,
    vaultId: vault.vaultId,
    vaultName: vault.vaultName,
    relativePath: file.relativePath,
    revisionId,
    restoredAt: file.updatedAt,
    file,
    preOperationSnapshot: snapshot.preOperationSnapshot,
  };
}

export function renderAdminPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Ars-note Sync Admin</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #15171a;
      --sidebar: #181a1e;
      --panel: #1c1f23;
      --panel-2: #191b1f;
      --panel-3: #23262b;
      --border: #303338;
      --border-strong: #43474e;
      --text: #e5e7ea;
      --muted: #969ba2;
      --muted-2: #6f747b;
      --accent: #9aafbf;
      --accent-strong: #526a7b;
      --green: #58b889;
      --orange: #c99a52;
      --red: #cf6868;
      --shadow: none;
    }
    * { box-sizing: border-box; }
    html { background: var(--bg); }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background: var(--bg);
      line-height: 1.45;
    }
    button, input, select { font: inherit; }
    .shell { width: 100%; max-width: 1440px; min-height: 100vh; margin: 0 auto; background: #181a1e; border-inline: 1px solid #24272b; }
    .topbar {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      align-items: center;
      min-height: 58px;
      padding: 9px 18px;
      border-bottom: 1px solid var(--border);
      background: #1b1d21;
    }
    .brand { display: flex; align-items: center; min-width: 0; }
    h1 { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: 0; }
    .sub { margin-top: 2px; color: var(--muted); font-size: 12px; }
    .auth { display: flex; gap: 8px; align-items: center; min-width: 0; }
    .auth input { flex: 1 1 220px; min-width: 0; }
    .auth button { flex: 0 0 auto; white-space: nowrap; }
    .auth-hint { color: var(--muted-2); font-size: 11px; white-space: nowrap; }
    input, select { min-width: 170px; height: 32px; border: 1px solid var(--border); border-radius: 4px; background: #141619; color: var(--text); padding: 0 10px; outline: none; }
    input:focus, select:focus { border-color: #687783; box-shadow: 0 0 0 1px #3b444b; }
    button { min-height: 32px; border: 1px solid #454950; border-radius: 4px; background: #30343a; color: var(--text); font-weight: 600; padding: 0 12px; cursor: pointer; transition: background .12s ease, border-color .12s ease; }
    button:hover { background: #393e45; border-color: #555b63; }
    button:disabled { opacity: .46; cursor: not-allowed; }
    button.secondary { background: #25282d; border-color: #3a3e44; color: var(--text); }
    button.secondary:hover { background: #30343a; border-color: #4a4f56; }
    button.danger { background: #2b1d20; border-color: #71383e; color: #ffb8bd; }
    button.danger:hover { background: #382126; border-color: #96505a; }
    button.ghost { background: transparent; border-color: var(--border); color: var(--muted); }
    .admin-layout { display: grid; grid-template-columns: 184px minmax(0, 1fr); align-items: stretch; }
    .sidebar { position: sticky; top: 0; display: flex; min-height: calc(100vh - 58px); flex-direction: column; padding: 14px 10px; border-right: 1px solid var(--border); background: var(--sidebar); }
    .nav-label { margin: 12px 10px 5px; color: var(--muted-2); font-size: 11px; font-weight: 500; letter-spacing: 0; }
    .tabs { display: flex; flex-direction: column; gap: 3px; }
    .tab { width: 100%; min-height: 34px; padding: 0 10px; border-color: transparent; background: transparent; color: var(--muted); text-align: left; font-weight: 500; }
    .tab:hover { border-color: transparent; background: #22252a; color: var(--text); }
    .tab.active { border-color: transparent; background: #282b30; color: #fff; box-shadow: inset 2px 0 0 #8499aa; }
    .tab-note { display: block; margin-top: 1px; color: var(--muted-2); font-size: 10px; font-weight: 500; }
    .sidebar-status { display: flex; gap: 8px; align-items: flex-start; margin-top: auto; padding: 12px 10px 2px; border-top: 1px solid var(--border); }
    .sidebar-status strong { display: block; margin-bottom: 2px; font-size: 12px; }
    .status-line { min-width: 0; color: var(--muted); font-size: 11px; }
    .dot { width: 8px; height: 8px; margin-top: 5px; flex: 0 0 auto; border-radius: 50%; background: var(--orange); }
    .dot.ok { background: var(--green); box-shadow: 0 0 0 3px rgba(59,201,138,.12); }
    .workspace { min-width: 0; padding: 20px 24px 40px; }
    .page-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-end; padding: 0 0 16px; }
    .page-head h2 { margin: 0; font-size: 19px; font-weight: 650; letter-spacing: 0; }
    .page-head p { max-width: 720px; margin: 4px 0 0; color: var(--muted); font-size: 12px; }
    .eyebrow { color: var(--accent); font-size: 10px; font-weight: 850; letter-spacing: .12em; text-transform: uppercase; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 12px; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 10px; border: 1px solid var(--border); background: var(--panel); }
    .summary-item { min-height: 72px; padding: 13px 15px; border-right: 1px solid var(--border); }
    .summary-item:last-child { border-right: 0; }
    .summary-grid.compact { margin: 0; border: 0; background: transparent; }
    .summary-grid.compact .summary-item { min-height: 64px; padding: 10px 14px; background: var(--panel-2); }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .card { border: 1px solid var(--border); border-radius: 4px; background: var(--panel); box-shadow: none; }
    .metric { min-height: 82px; padding: 14px; box-shadow: none; }
    .label { color: var(--muted); font-size: 11px; font-weight: 500; letter-spacing: 0; }
    .value { margin-top: 6px; font-size: 20px; font-weight: 650; letter-spacing: 0; }
    .section { padding: 16px; margin-top: 10px; }
    .section:first-of-type { margin-top: 0; }
    .section-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
    .section-head > div:first-child { min-width: 0; }
    .section-title { font-size: 14px; font-weight: 650; }
    .section-description { max-width: 760px; margin-top: 4px; color: var(--muted); font-size: 12px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
    .pill { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: 3px; padding: 3px 7px; color: var(--muted); background: #22252a; font-size: 11px; white-space: nowrap; }
    .pill.ok { color: #a6edca; border-color: #2d654f; background: #193128; }
    .pill.warn { color: #f5d28f; border-color: #71562b; background: #2c261a; }
    .pill.danger { color: #ffb8bd; border-color: #71383e; background: #2b1d20; }
    .maintenance-note { padding: 10px 11px; border-left: 3px solid #716449; background: #22211d; color: #c8bea7; font-size: 12px; }
    .danger-zone { border-color: #55373a; background: var(--panel); }
    .danger-zone .section-head { border-bottom-color: #553137; }
    .diagnostics-details { margin-top: 10px; border: 1px solid var(--border); border-radius: 4px; background: var(--panel-2); }
    .diagnostics-details summary { padding: 11px 13px; color: var(--muted); font-size: 12px; font-weight: 750; cursor: pointer; user-select: none; }
    .diagnostics-details[open] summary { border-bottom: 1px solid var(--border); color: var(--text); }
    .diagnostics-details .table-wrap { margin: 0 !important; border: 0; border-radius: 0 0 9px 9px; }
    .vault { display: grid; grid-template-columns: minmax(210px, 1.4fr) repeat(5, minmax(78px, .42fr)) minmax(250px, .8fr); gap: 10px; align-items: center; padding: 12px; border-bottom: 1px solid var(--border); background: var(--panel-2); }
    .vault-name { font-weight: 850; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vault-id { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 4px; }
    .vault-server-id { color: var(--muted-2); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 3px; }
    .team-inline-summary { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
    .identity-result { display: grid; gap: 10px; }
    .identity-advice { display: grid; gap: 8px; margin-bottom: 4px; }
    .identity-advice div { border: 1px solid #34516a; border-radius: 8px; padding: 10px; color: #b9dcf7; background: #182631; font-size: 13px; line-height: 1.45; }
    .identity-vault-list { display: grid; gap: 9px; }
    .identity-vault { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; border: 1px solid var(--border); border-radius: 9px; padding: 11px; background: var(--panel-2); }
    .identity-vault.recommended { border-color: #356650; background: #17271f; }
    .identity-vault-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
    .duplicate-vault-groups { display: grid; gap: 12px; margin-bottom: 14px; }
    .duplicate-vault-card { border: 1px solid #675029; border-radius: 9px; padding: 14px; background: #262116; }
    .duplicate-vault-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 10px; }
    .duplicate-vault-title { font-weight: 900; }
    .duplicate-vault-advice { color: var(--muted); font-size: 12px; line-height: 1.45; margin-top: 4px; }
    .duplicate-vault-list { display: grid; gap: 8px; }
    .duplicate-vault-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; border: 1px solid var(--border); border-radius: 8px; padding: 10px; background: var(--panel-2); }
    .duplicate-vault-row.keep { border-color: #356650; background: #17271f; }
    .duplicate-vault-row-id { color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 3px; }
    .duplicate-vault-row-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
    .team-vault-card { border: 1px solid var(--border); border-radius: 9px; background: var(--panel-2); padding: 14px; margin-bottom: 10px; }
    .team-vault-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
    .team-vault-title { font-weight: 900; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .team-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .team-stat { border: 1px solid var(--border); border-radius: 8px; padding: 10px; background: #1d2128; min-width: 0; }
    .team-stat span { color: var(--muted); font-size: 11px; display: block; margin-bottom: 5px; }
    .team-stat strong { font-size: 18px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .team-warning-list { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; }
    .team-member-list { margin-top: 12px; display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
    .team-member-card { border: 1px solid var(--border); border-radius: 8px; padding: 10px; background: #1d2128; min-width: 0; }
    .team-member-name { font-weight: 900; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .team-member-meta { color: var(--muted); font-size: 11px; line-height: 1.5; margin-top: 6px; }
    .cell-label { color: var(--muted); font-size: 11px; }
    .cell-value { font-weight: 850; margin-top: 4px; }
    .table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: 4px; background: var(--panel-2); }
    .table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 780px; }
    th, td { text-align: left; padding: 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
    th { color: var(--muted); font-size: 11px; letter-spacing: .04em; background: #20252d; }
    tr:last-child td { border-bottom: 0; }
    .row-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .backup-file-browser { margin-top: 14px; }
    .backup-file-browser .section-head { margin-top: 0; }
    .backup-file-browser .table { min-width: 860px; }
    .file-type { text-transform: uppercase; font-size: 11px; font-weight: 850; color: var(--muted); }
    .muted { color: var(--muted); }
    .path { max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .warning-list { display: grid; gap: 10px; }
    .warning { padding: 12px; border-radius: 4px; border: 1px solid var(--border); background: #202328; }
    .warning.info { border-color: #34516a; background: #182631; }
    .warning.warning { border-color: #675029; background: #262116; }
    .warning.danger { border-color: #71383e; background: #2b1d20; }
    .warning-title { font-weight: 900; margin-bottom: 5px; }
    .warning-message { color: var(--muted); font-size: 13px; line-height: 1.5; }
    .panel { display: none; }
    .panel.active { display: block; }
    .error { color: #ffc0c5; background: #2b1d20; border: 1px solid #71383e; padding: 12px; border-radius: 9px; display: none; margin-bottom: 12px; }
    .toast { position: fixed; right: 20px; bottom: 20px; max-width: 360px; padding: 12px 14px; border-radius: 4px; border: 1px solid var(--border-strong); background: #24272c; color: var(--text); display: none; z-index: 10; }
    .empty { color: var(--muted); padding: 18px; text-align: center; border-top: 1px solid var(--border); }
    @media (max-width: 1100px) {
      .auth-hint { display: none; }
      .admin-layout { grid-template-columns: 168px minmax(0, 1fr); }
      .vault { grid-template-columns: minmax(210px, 1fr) repeat(2, minmax(86px, .4fr)); }
      .vault > :nth-child(4), .vault > :nth-child(5), .vault > :nth-child(6) { display: none; }
    }
    @media (max-width: 860px) {
      .shell { width: 100%; border-inline: 0; }
      .topbar { align-items: flex-start; flex-direction: column; }
      .auth { width: 100%; }
      .auth input { width: auto; }
      .admin-layout { display: block; }
      .sidebar { position: static; min-height: 0; border-right: 0; border-bottom: 1px solid var(--border); }
      .nav-label, .sidebar-status { display: none; }
      .tabs { flex-direction: row; overflow-x: auto; padding-bottom: 2px; }
      .tabs + .nav-label + .tabs { margin-top: 3px; }
      .tab { width: auto; min-width: max-content; }
      .workspace { padding: 16px; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .summary-item:nth-child(2) { border-right: 0; }
      .summary-item:nth-child(-n+2) { border-bottom: 1px solid var(--border); }
      .team-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .two { grid-template-columns: 1fr; }
    }
    @media (max-width: 620px) {
      .topbar { padding: 11px; }
      .auth { display: grid; grid-template-columns: 1fr 1fr; }
      .auth input { grid-column: 1 / -1; }
      .page-head { align-items: flex-start; flex-direction: column; }
      .grid { grid-template-columns: 1fr; }
      .team-grid { grid-template-columns: 1fr; }
      .section { padding: 14px; }
      .section-head { align-items: flex-start; flex-direction: column; }
      .vault { grid-template-columns: 1fr 1fr; }
      .vault > :nth-child(1), .vault > :last-child { grid-column: 1 / -1; }
      .identity-vault, .duplicate-vault-row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <div class="topbar">
      <div class="brand">
        <div>
          <h1>Ars-note 服务器</h1>
          <div class="sub">服务器管理</div>
        </div>
      </div>
      <div class="auth">
        <input id="apiKey" type="password" aria-label="服务器管理密钥" placeholder="服务器管理密钥" autocomplete="off" />
        <button id="saveKey" class="secondary">保存密钥</button>
        <button id="refresh">刷新数据</button>
      </div>
    </div>

    <div id="error" class="error"></div>

    <div class="admin-layout">
      <aside class="sidebar">
        <div class="nav-label">管理</div>
        <nav class="tabs" aria-label="日常运维">
          <button class="tab active" data-tab="overview">总览</button>
          <button class="tab" data-tab="live">实时同步</button>
          <button class="tab" data-tab="vaults">Vault</button>
          <button class="tab" data-tab="team">团队制作</button>
        </nav>
        <div class="nav-label">维护</div>
        <nav class="tabs" aria-label="维护工具">
          <button class="tab" data-tab="backups">备份</button>
          <button class="tab" data-tab="diagnostics">高级管理</button>
        </nav>
        <div class="sidebar-status">
          <span id="statusDot" class="dot"></span>
          <div class="status-line"><span id="statusText">等待服务器数据...</span></div>
        </div>
      </aside>

      <div class="workspace">

    <section id="panel-overview" class="panel active">
      <div class="page-head">
        <div>
          <h2>总览</h2>
          <p>服务器与实时同步状态</p>
        </div>
      </div>
      <section class="summary-grid">
        <div class="summary-item"><div class="label">Vault</div><div id="mVaults" class="value">-</div></div>
        <div class="summary-item"><div class="label">在线设备</div><div id="mDevices" class="value">-</div></div>
        <div class="summary-item"><div class="label">备份</div><div id="mBackups" class="value">-</div></div>
        <div class="summary-item"><div class="label">实时文件</div><div id="mLive" class="value">-</div></div>
      </section>

      <section class="card section">
        <div class="section-head">
          <div>
            <div class="section-title">同步服务器</div>
            <div class="section-description">服务版本、存储方式与本次运行状态。</div>
          </div>
          <div id="serverPills"></div>
        </div>
        <div class="grid">
          <div><div class="cell-label">版本</div><div id="serverVersion" class="cell-value">-</div></div>
          <div><div class="cell-label">存储</div><div id="serverStorage" class="cell-value">-</div></div>
          <div><div class="cell-label">运行时间</div><div id="serverUptime" class="cell-value">-</div></div>
          <div><div class="cell-label">启动时间</div><div id="serverStarted" class="cell-value">-</div></div>
        </div>
      </section>

      <section class="card section">
        <div class="section-head">
          <div>
            <div class="section-title">本次运行统计</div>
            <div class="section-description">用于判断连接是否稳定，不影响同步内容。</div>
          </div>
          <span id="metricsSince" class="pill">-</span>
        </div>
        <div class="summary-grid compact">
          <div class="summary-item"><div class="label">累计连接</div><div id="metricConn" class="value">-</div></div>
          <div class="summary-item"><div class="label">累计断开</div><div id="metricDisconn" class="value">-</div></div>
          <div class="summary-item"><div class="label">文件变更</div><div id="metricChanges" class="value">-</div></div>
          <div class="summary-item"><div class="label">传输量</div><div id="metricBytes" class="value">-</div></div>
        </div>
      </section>

      <section class="card section">
        <div class="section-head">
          <div>
            <div class="section-title">需要关注</div>
            <div class="section-description">没有提示时，服务器无需额外处理。</div>
          </div>
          <span id="warningCount" class="pill">0 条</span>
        </div>
        <div id="warnings" class="warning-list"></div>
      </section>
    </section>

    <section id="panel-vaults" class="panel">
      <div class="page-head">
        <div>
          <h2>Vault</h2>
          <p>连接身份与服务器空间</p>
        </div>
      </div>
      <section class="card section">
        <div class="section-head">
          <div>
            <div class="section-title">连接身份检查</div>
            <div class="section-description">团队成员若只填写显示名称，可能选中旧 ID。输入名称或 ID 后，可直接复制正确连接信息。</div>
          </div>
          <span class="pill">避免错连</span>
        </div>
        <div class="toolbar">
          <input id="identityVaultInput" type="text" placeholder="输入 Vault 名称或 ID，例如 GameDesign" style="min-width:320px;flex:1;" />
          <button id="checkVaultIdentity" class="secondary">诊断 Vault ID</button>
        </div>
        <div id="vaultIdentityResult" class="identity-result">
          <div class="empty">输入队友填写的名称或 ID 后，可以直接复制正确连接配置给他。</div>
        </div>
      </section>
      <section class="card section">
        <div class="section-head">
          <div>
            <div class="section-title">服务器空间</div>
            <div class="section-description">在线空间不会开放删除；复制连接配置可减少成员手工填写错误。</div>
          </div>
          <span id="vaultCount" class="pill">0 个</span>
        </div>
        <div id="vaults"></div>
      </section>
    </section>

    <section id="panel-backups" class="panel">
      <div class="page-head">
        <div>
          <h2>备份</h2>
          <p>服务器备份与文件版本</p>
        </div>
      </div>
      <section class="card section">
        <div class="section-head">
          <div>
            <div class="section-title">备份记录</div>
            <div class="section-description">删除前需要再次确认；保留策略只作用于当前筛选的 Vault。</div>
          </div>
          <span id="backupTotal" class="pill">0 个</span>
        </div>
        <div class="toolbar">
          <select id="backupVaultSelect"></select>
          <input id="keepLatest" type="number" min="1" max="200" value="20" />
          <button id="pruneBackups" class="secondary">只保留最近 N 个备份</button>
        </div>
        <div id="backups"></div>
        <div id="backupFiles" class="backup-file-browser"></div>
      </section>
    </section>

    <section id="panel-live" class="panel">
      <div class="page-head">
        <div>
          <h2>实时同步</h2>
          <p>在线设备、文件活动与历史版本</p>
        </div>
        <span id="liveCapability" class="pill">-</span>
      </div>
      <section class="card section">
        <div class="section-head">
          <div>
            <div class="section-title">设备连接</div>
            <div class="section-description">显示在线状态、客户端版本、协议和最近一次同步动作。</div>
          </div>
          <span id="clientTotal" class="pill">0 台</span>
        </div>
        <div id="clients"></div>
      </section>
      <section class="card section">
        <div class="section-head">
          <div>
            <div class="section-title">最近文件活动</div>
            <div class="section-description">可下载服务器当前版本或查看单个文件的同步历史。</div>
          </div>
          <span id="liveFileTotal" class="pill">0 个</span>
        </div>
        <div id="liveFiles"></div>
        <div id="liveHistory" class="backup-file-browser"></div>
      </section>
    </section>

    <section id="panel-team" class="panel">
      <div class="page-head">
        <div>
          <h2>团队制作</h2>
          <p>任务、文档与 AI 记忆同步状态</p>
        </div>
      </div>
      <section class="card section">
        <div class="section-head">
          <div>
            <div class="section-title">团队制作健康</div>
            <div class="section-description">从实时快照读取团队时间表、日报、任务文档和 AI 记忆/Skill 状态。</div>
          </div>
          <span id="teamVaultTotal" class="pill">0 个 Vault</span>
        </div>
        <div id="teamProduction"></div>
      </section>
    </section>

    <section id="panel-diagnostics" class="panel">
      <div class="page-head">
        <div>
          <h2>高级管理</h2>
          <p>备份、诊断和清理操作</p>
        </div>
        <span class="pill warn">谨慎操作</span>
      </div>
      <section class="card section">
        <div class="section-head">
          <div>
            <div class="section-title">服务器保护与诊断</div>
            <div class="section-description">重大维护前先生成本地快照；诊断文件不包含正文和 API Key。</div>
          </div>
          <div class="row-actions">
            <button id="createServerSnapshot">生成安全快照</button>
            <button id="downloadServerExport" class="secondary">下载整服备份</button>
            <button id="downloadDiagnostics" class="secondary">下载诊断文件</button>
          </div>
        </div>
        <div class="maintenance-note">服务器快照保存在 server-data/server-exports，默认保留最近 7 份。整服下载不会修改服务器数据。</div>
        <div id="serverSnapshots" style="margin-top:12px;"></div>
        <div id="serverSnapshotFiles" class="backup-file-browser"></div>
        <details class="diagnostics-details">
          <summary>查看完整诊断详情</summary>
          <pre id="diagnosticsText" class="table-wrap" style="padding:14px;white-space:pre-wrap;max-height:460px;overflow:auto;"></pre>
        </details>
      </section>

      <section class="card section">
        <div class="section-head">
          <div>
            <div class="section-title">删除记录维护</div>
            <div class="section-description">只清理服务器保存的过期 tombstone，不会删除当前正常文件。通常无需手工执行。</div>
          </div>
        </div>
        <div class="toolbar">
          <select id="liveVaultSelect" aria-label="选择要维护的 Vault"></select>
          <button id="pruneTombstones" class="secondary">清理过期删除记录</button>
        </div>
      </section>

      <section class="card section danger-zone">
        <div class="section-head">
          <div>
            <div class="section-title">重复 Vault 清理</div>
            <div class="section-description">同名 Vault 可能让成员连接到不同 ID。系统只允许删除已离线且判断为安全的重复项。</div>
          </div>
          <div class="row-actions">
            <span id="duplicateVaultCount" class="pill warn">0 组</span>
            <button id="deleteDuplicateVaults" class="danger" disabled>没有可安全清理的项目</button>
          </div>
        </div>
        <div id="duplicateVaultGroups"></div>
      </section>
    </section>
      </div>
    </div>
  </main>
  <div id="toast" class="toast"></div>

  <script>
    const keyInput = document.getElementById('apiKey');
    const saved = sessionStorage.getItem('ars-note.admin.apiKey') || '';
    keyInput.value = saved;

    let latestData = null;
    let pendingDeleteKey = '';
    let pendingDeleteTimer = 0;

    function $(id) { return document.getElementById(id); }
    function fmtBytes(n) {
      n = Number(n) || 0;
      if (n < 1024) return n + ' B';
      const units = ['KB', 'MB', 'GB', 'TB'];
      let value = n / 1024;
      let i = 0;
      while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
      return value.toFixed(value >= 10 ? 1 : 2) + ' ' + units[i];
    }
    function fmtDate(v) {
      if (!v) return '-';
      try { return new Date(v).toLocaleString(); } catch { return v; }
    }
    function fmtDuration(seconds) {
      seconds = Number(seconds) || 0;
      const d = Math.floor(seconds / 86400);
      const h = Math.floor((seconds % 86400) / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      if (d) return d + ' 天 ' + h + ' 小时';
      if (h) return h + ' 小时 ' + m + ' 分钟';
      return m + ' 分钟';
    }
    function fmtMinutes(minutes) {
      minutes = Number(minutes) || 0;
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      if (h && m) return h + 'h ' + m + 'm';
      if (h) return h + 'h';
      return m + 'm';
    }
    function hasTeamProductionData(team) {
      return !!team && (team.scheduleSynced || team.teamDocs > 0 || team.taskDocs > 0 || team.aiMemoryFiles > 0 || team.aiSkills > 0);
    }
    function teamHealthLevel(team) {
      if (!team || !team.scheduleSynced) return 'warn';
      if (team.blockedTasks > 0 || team.overdueTasks > 0) return 'danger';
      if (team.missingOwnerTasks > 0 || team.missingDocTasks > 0 || team.missingDueDateTasks > 0) return 'warn';
      return 'ok';
    }
    function teamHealthLabel(team) {
      if (!team || !team.scheduleSynced) return '缺少团队表';
      if (team.blockedTasks > 0) return '有阻塞';
      if (team.overdueTasks > 0) return '有逾期';
      if (team.missingOwnerTasks > 0 || team.missingDocTasks > 0 || team.missingDueDateTasks > 0) return '待补资料';
      return '健康';
    }
    function text(id, value) { $(id).textContent = value; }
    function escapeHtml(value) {
      const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
      return String(value ?? '').replace(/[&<>"']/g, (ch) => map[ch]);
    }
    function toast(message) {
      const el = $('toast');
      el.textContent = message;
      el.style.display = 'block';
      window.clearTimeout(el._timer);
      el._timer = window.setTimeout(() => { el.style.display = 'none'; }, 3200);
    }
    function snapshotNotice(result) {
      const snap = result && result.preOperationSnapshot;
      return snap && snap.fileName ? ' Safety snapshot: ' + snap.fileName : '';
    }
    function apiHeaders() {
      const key = keyInput.value.trim();
      const headers = { 'Content-Type': 'application/json' };
      if (key) headers['x-ars-note-api-key'] = key;
      return headers;
    }
    async function postJson(path, body) {
      const res = await fetch(path, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify(body || {}),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    }

    function liveSyncWebSocketUrl(vaultId) {
      const wsOrigin = window.location.origin.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
      return wsOrigin + '/ws/live-sync?vaultId=' + encodeURIComponent(vaultId || '<vaultId>');
    }

    function liveSyncConnectionText(vault) {
      const vaultId = vault && vault.vaultId ? vault.vaultId : '';
      return [
        'Ars-note Live Sync connection',
        'Vault name: ' + ((vault && vault.vaultName) || ''),
        'Vault ID: ' + vaultId,
        'Server URL: ' + window.location.origin,
        'WebSocket URL: ' + liveSyncWebSocketUrl(vaultId),
        '',
        'Client setup:',
        '1. Sync Server URL 填：' + window.location.origin,
        '2. Vault ID 必须填这一串，不要只填显示名称：' + vaultId,
        '3. API Key 填服务器密钥。',
      ].join('\\n');
    }

    async function copyText(value, label) {
      const text = String(value || '');
      if (!text) {
        toast('没有可复制的内容。');
        return;
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const el = document.createElement('textarea');
          el.value = text;
          el.setAttribute('readonly', 'readonly');
          el.style.position = 'fixed';
          el.style.left = '-9999px';
          document.body.appendChild(el);
          el.select();
          document.execCommand('copy');
          el.remove();
        }
        toast('已复制' + (label ? '：' + label : ''));
      } catch (err) {
        toast('复制失败：' + (err.message || String(err)));
      }
    }

    async function loadOverview() {
      const error = $('error');
      error.style.display = 'none';
      const started = performance.now();
      try {
        const res = await fetch('/api/admin/overview', { headers: apiHeaders() });
        const latency = Math.round(performance.now() - started);
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        latestData = data;
        render(data, latency);
      } catch (err) {
        $('statusDot').className = 'dot';
        text('statusText', '无法读取管理数据');
        error.textContent = err.message || String(err);
        error.style.display = 'block';
      }
    }

    function render(data, latency) {
      $('statusDot').className = 'dot ok';
      text('statusText', '已连接 · ' + latency + 'ms · ' + fmtDate(data.server.serverTime));
      text('mVaults', data.totals.vaults);
      text('mDevices', data.server.totalConnections + (data.server.knownClients ? (' / ' + data.server.knownClients) : ''));
      text('mBackups', data.totals.backups);
      text('mLive', data.totals.liveFiles);
      text('serverVersion', data.server.version);
      text('serverStorage', data.server.storageBackend === 'local' ? '本地文件系统' : data.server.storageBackend);
      text('serverUptime', fmtDuration(data.server.uptimeSeconds));
      text('serverStarted', fmtDate(data.server.startedAt));
      $('serverPills').innerHTML = [
        '<span class="pill ' + (data.server.apiKeyConfigured ? 'ok' : 'warn') + '">' + (data.server.apiKeyConfigured ? 'API Key 已启用' : '开发模式') + '</span>',
        '<span class="pill">备份 ' + fmtBytes(data.totals.backupTotalSize) + '</span>',
        '<span class="pill">实时 ' + fmtBytes(data.totals.liveTotalSize) + '</span>'
      ].join(' ');

      renderWarnings(data);
      renderDuplicateVaultGroupsV2(data);
      renderVaultsV2(data);
      renderBackups(data);
      renderLive(data);
      renderTeamProduction(data);
      renderDiagnostics(data);

      const serverExportButton = $('downloadServerExport');
      if (serverExportButton) {
        const canExportServerData = !!(data.capabilities && data.capabilities.exportServerData);
        serverExportButton.disabled = !canExportServerData;
        serverExportButton.title = canExportServerData
          ? 'Export all server-side vault backups, live snapshots, and live history.'
          : 'Current storage backend does not support full server export.';
      }
      const createServerSnapshotButton = $('createServerSnapshot');
      if (createServerSnapshotButton) {
        const canUseServerSnapshots = !!(data.capabilities && data.capabilities.serverDataSnapshots);
        createServerSnapshotButton.disabled = !canUseServerSnapshots;
        createServerSnapshotButton.title = canUseServerSnapshots
          ? 'Create a compressed full server snapshot in server-data/server-exports.'
          : 'Current storage backend does not support local server snapshots.';
      }
      renderServerSnapshots(data);

      /* Sync metrics */
      if (data.syncMetrics) {
        text('metricConn', data.syncMetrics.totalConnections);
        text('metricDisconn', data.syncMetrics.totalDisconnections);
        text('metricChanges', data.syncMetrics.totalFileChanges);
        text('metricBytes', fmtBytes(data.syncMetrics.totalBytesTransferred));
        text('metricsSince', '自 ' + fmtDate(data.syncMetrics.startedAt));
      }
    }

    function renderServerSnapshots(data) {
      const box = $('serverSnapshots');
      if (!box) return;
      const fileBox = $('serverSnapshotFiles');
      const items = Array.isArray(data.serverDataSnapshots) ? data.serverDataSnapshots : [];
      if (!data.capabilities || !data.capabilities.serverDataSnapshots) {
        box.innerHTML = '<div class="empty">当前存储方式不支持服务器本地快照。</div>';
        if (fileBox) fileBox.innerHTML = '';
        return;
      }
      if (!items.length) {
        box.innerHTML = '<div class="empty">还没有服务器快照。可以立即生成，或等待每日自动快照。</div>';
        if (fileBox) fileBox.innerHTML = '';
        return;
      }
      const canBrowseFiles = !!(data.capabilities && data.capabilities.serverSnapshotFileRestore);
      box.innerHTML = '<div class="table-wrap"><table class="table"><thead><tr><th>快照</th><th>大小</th><th>Vault</th><th>跳过</th><th>原因</th><th>SHA256</th><th>操作</th></tr></thead><tbody>' +
        items.slice(0, 10).map((item) => '<tr>' +
          '<td class="path" title="' + escapeHtml(item.fileName || '') + '">' + escapeHtml(fmtDate(item.exportedAt)) + '<br /><span class="muted">' + escapeHtml(item.fileName || '-') + '</span></td>' +
          '<td>' + fmtBytes(item.size || 0) + '</td>' +
          '<td>' + escapeHtml(item.vaultCount || 0) + ' / ' + escapeHtml(item.sourceVaultCount || 0) + '</td>' +
          '<td>' + escapeHtml(item.skippedCount || 0) + '</td>' +
          '<td>' + escapeHtml(item.reason || '-') + '</td>' +
          '<td class="path" title="' + escapeHtml(item.sha256 || '') + '">' + escapeHtml(String(item.sha256 || '').slice(0, 12) || '-') + '</td>' +
          '<td><div class="row-actions">' +
            (canBrowseFiles ? '<button class="secondary" data-action="list-server-snapshot-files" data-file-name="' + escapeHtml(item.fileName || '') + '">文件</button>' : '') +
            '<button class="secondary" data-action="download-server-snapshot" data-file-name="' + escapeHtml(item.fileName || '') + '">下载</button>' +
          '</div></td>' +
        '</tr>').join('') +
        '</tbody></table></div>';
    }

    function renderWarnings(data) {
      text('warningCount', data.warnings.length + ' 条');
      const box = $('warnings');
      if (!data.warnings.length) {
        box.innerHTML = '<div class="empty">当前未发现异常。</div>';
        return;
      }
      box.innerHTML = data.warnings.map((item) => '<div class="warning ' + escapeHtml(item.level) + '">' +
        '<div class="warning-title">' + escapeHtml(item.title) + '</div>' +
        '<div class="warning-message">' + escapeHtml(item.message) + '</div>' +
      '</div>').join('');
    }

    function renderVaultSelectors(data) {
      const previousBackupVault = $('backupVaultSelect').value || 'all';
      const previousLiveVault = $('liveVaultSelect').value || '';
      const options = ['<option value="all">全部 Vault</option>'].concat(data.vaults.map((v) =>
        '<option value="' + escapeHtml(v.vaultId) + '">' + escapeHtml(v.vaultName) + '</option>'
      )).join('');
      $('backupVaultSelect').innerHTML = options;
      $('liveVaultSelect').innerHTML = data.vaults.map((v) =>
        '<option value="' + escapeHtml(v.vaultId) + '">' + escapeHtml(v.vaultName) + '</option>'
      ).join('');
      if ([...$('backupVaultSelect').options].some((option) => option.value === previousBackupVault)) {
        $('backupVaultSelect').value = previousBackupVault;
      }
      if ([...$('liveVaultSelect').options].some((option) => option.value === previousLiveVault)) {
        $('liveVaultSelect').value = previousLiveVault;
      }
    }

    function renderDuplicateVaultGroups(data) {
      const groups = Array.isArray(data.duplicateVaultGroups) ? data.duplicateVaultGroups : [];
      text('duplicateVaultCount', groups.length + ' groups');
      const safeDeleteCount = groups.reduce((sum, group) => sum + ((group.vaults || []).filter((vault) => vault.deleteSafe).length), 0);
      const cleanupButton = $('deleteDuplicateVaults');
      if (cleanupButton) {
        cleanupButton.disabled = safeDeleteCount === 0;
        cleanupButton.textContent = safeDeleteCount > 0 ? ('清理安全重复项 ' + safeDeleteCount) : '没有可安全清理项';
      }
      const box = $('duplicateVaultGroups');
      if (!groups.length) {
        box.innerHTML = '<div class="empty">没有发现同名重复 Vault。团队成员只要复制正确 Vault ID 即可。</div>';
        return;
      }

      box.innerHTML = '<div class="duplicate-vault-groups">' + groups.map((group) => {
        const rows = (group.vaults || []).map((vault) => {
          const mergeButton = (!vault.recommended && data.capabilities.mergeVaults && (vault.onlineClients || 0) === 0)
            ? '<button class="secondary" data-action="merge-vault" data-source-vault-id="' + escapeHtml(vault.vaultId) + '" data-target-vault-id="' + escapeHtml(group.keeperVaultId) + '">Merge</button>'
            : '';
          const action = vault.recommended
            ? '<span class="pill ok">建议保留</span>'
            : (vault.deleteSafe
              ? '<button class="danger" data-action="delete-vault" data-vault-id="' + escapeHtml(vault.vaultId) + '" data-vault-name="' + escapeHtml(vault.vaultName) + '">删除重复项</button>'
              : '<span class="pill warn">先断开设备</span>');
          return '<div class="duplicate-vault-row ' + (vault.recommended ? 'keep' : '') + '">' +
            '<div>' +
              '<div class="vault-name">' + escapeHtml(vault.vaultName) + '</div>' +
              '<div class="duplicate-vault-row-id" title="' + escapeHtml(vault.vaultId) + '">Vault ID: ' + escapeHtml(vault.vaultId) + '</div>' +
              '<div class="duplicate-vault-row-id" title="' + escapeHtml(vault.serverVaultId || '') + '">Server ID: ' + escapeHtml(vault.serverVaultId || '') + '</div>' +
              '<div class="duplicate-vault-row-meta">' +
                '<span class="pill">Online ' + escapeHtml(vault.onlineClients || 0) + '</span>' +
                '<span class="pill">Tasks ' + escapeHtml(vault.teamTaskCount || 0) + '</span>' +
                '<span class="pill">Live ' + escapeHtml(vault.liveFileCount || 0) + '</span>' +
                '<span class="pill">Backups ' + escapeHtml(vault.backupCount || 0) + '</span>' +
                '<span class="pill">Last ' + escapeHtml(fmtDate(vault.lastActivityAt)) + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="row-actions">' + action + '<button class="secondary" data-action="copy-vault-id" data-vault-id="' + escapeHtml(vault.vaultId) + '">复制ID</button></div>' +
          '</div>';
        }).join('');
        return '<article class="duplicate-vault-card">' +
          '<div class="duplicate-vault-head">' +
            '<div><div class="duplicate-vault-title">同名 Vault：' + escapeHtml(group.name) + '</div>' +
            '<div class="duplicate-vault-advice">建议所有电脑统一使用：' + escapeHtml(group.keeperVaultId) + '。判断依据：' + escapeHtml(group.keeperReason || '-') + '</div></div>' +
            '<span class="pill warn">' + escapeHtml((group.vaults || []).length) + ' duplicates</span>' +
          '</div>' +
          '<div class="duplicate-vault-list">' + rows + '</div>' +
        '</article>';
      }).join('') + '</div>';
    }

    function renderDuplicateVaultGroupsV2(data) {
      const groups = Array.isArray(data.duplicateVaultGroups) ? data.duplicateVaultGroups : [];
      text('duplicateVaultCount', groups.length + ' 组');
      const safeDeleteCount = groups.reduce((sum, group) => sum + ((group.vaults || []).filter((vault) => vault.deleteSafe).length), 0);
      const cleanupButton = $('deleteDuplicateVaults');
      if (cleanupButton) {
        cleanupButton.disabled = safeDeleteCount === 0;
        cleanupButton.textContent = safeDeleteCount > 0 ? ('清理安全重复项 ' + safeDeleteCount + ' 个') : '没有可安全清理的项目';
      }
      const box = $('duplicateVaultGroups');
      if (!groups.length) {
        box.innerHTML = '<div class="empty">没有发现同名 Vault。将准确 Vault ID 分享给成员即可。</div>';
        return;
      }

      box.innerHTML = '<div class="duplicate-vault-groups">' + groups.map((group) => {
        const rows = (group.vaults || []).map((vault) => {
          const canMerge = !vault.recommended && data.capabilities.mergeVaults && (vault.onlineClients || 0) === 0;
          const canDelete = vault.deleteSafe;
          const keep = vault.recommended ? '<span class="pill ok">保留</span>' : '';
          const merge = canMerge
            ? '<button class="secondary" data-action="merge-vault" data-source-vault-id="' + escapeHtml(vault.vaultId) + '" data-target-vault-id="' + escapeHtml(group.keeperVaultId) + '">合并到保留项</button>'
            : '';
          const del = !vault.recommended && canDelete
            ? '<button class="danger" data-action="delete-vault" data-vault-id="' + escapeHtml(vault.vaultId) + '" data-vault-name="' + escapeHtml(vault.vaultName) + '">删除重复项</button>'
            : (!vault.recommended ? '<span class="pill warn">请先断开设备</span>' : '');
          return '<div class="duplicate-vault-row ' + (vault.recommended ? 'keep' : '') + '">' +
            '<div>' +
              '<div class="vault-name">' + escapeHtml(vault.vaultName) + '</div>' +
              '<div class="duplicate-vault-row-id" title="' + escapeHtml(vault.vaultId) + '">Vault ID: ' + escapeHtml(vault.vaultId) + '</div>' +
              '<div class="duplicate-vault-row-id" title="' + escapeHtml(vault.serverVaultId || '') + '">Server ID: ' + escapeHtml(vault.serverVaultId || '') + '</div>' +
              '<div class="duplicate-vault-row-meta">' +
                '<span class="pill">在线 ' + escapeHtml(vault.onlineClients || 0) + '</span>' +
                '<span class="pill">任务 ' + escapeHtml(vault.teamTaskCount || 0) + '</span>' +
                '<span class="pill">实时文件 ' + escapeHtml(vault.liveFileCount || 0) + '</span>' +
                '<span class="pill">备份 ' + escapeHtml(vault.backupCount || 0) + '</span>' +
                '<span class="pill">最后活动 ' + escapeHtml(fmtDate(vault.lastActivityAt)) + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="row-actions">' + keep + merge + del + '<button class="secondary" data-action="copy-vault-id" data-vault-id="' + escapeHtml(vault.vaultId) + '">复制 ID</button></div>' +
          '</div>';
        }).join('');
        return '<article class="duplicate-vault-card">' +
          '<div class="duplicate-vault-head">' +
            '<div><div class="duplicate-vault-title">同名空间：' + escapeHtml(group.name) + '</div>' +
            '<div class="duplicate-vault-advice">建议保留 ID：' + escapeHtml(group.keeperVaultId) + '。依据：' + escapeHtml(group.keeperReason || '-') + '</div></div>' +
            '<span class="pill warn">' + escapeHtml((group.vaults || []).length) + ' 个同名项</span>' +
          '</div>' +
          '<div class="duplicate-vault-list">' + rows + '</div>' +
        '</article>';
      }).join('') + '</div>';
    }

    function vaultCandidateHtml(vault, recommendedLabel) {
      if (!vault) return '';
      const team = vault.team || null;
      const teamSummary = hasTeamProductionData(team)
        ? '<span class="pill ' + teamHealthLevel(team) + '">' + teamHealthLabel(team) + '</span><span class="pill">任务 ' + escapeHtml(team.activeTasks || 0) + '/' + escapeHtml(team.totalTasks || 0) + '</span><span class="pill">Skill ' + escapeHtml(team.aiSkills || 0) + '</span>'
        : '<span class="pill">无团队数据</span>';
      const activity = fmtDate(vault.lastActivityAt);
      return '<div class="identity-vault ' + (recommendedLabel ? 'recommended' : '') + '">' +
        '<div>' +
          '<div class="vault-name">' + escapeHtml(vault.vaultName) + (recommendedLabel ? ' <span class="pill ok">' + escapeHtml(recommendedLabel) + '</span>' : '') + '</div>' +
          '<div class="vault-id" title="' + escapeHtml(vault.vaultId) + '">Vault ID: ' + escapeHtml(vault.vaultId) + '</div>' +
          '<div class="vault-server-id" title="' + escapeHtml(vault.serverVaultId || '') + '">Server ID: ' + escapeHtml(vault.serverVaultId || '') + '</div>' +
          '<div class="identity-vault-meta">' +
            '<span class="pill">Online ' + escapeHtml((vault.onlineClients || []).length || 0) + '</span>' +
            '<span class="pill">Backups ' + escapeHtml(vault.backupCount || 0) + '</span>' +
            '<span class="pill">Live ' + escapeHtml(vault.live ? vault.live.fileCount : '-') + '</span>' +
            '<span class="pill">Last ' + escapeHtml(activity) + '</span>' +
            teamSummary +
          '</div>' +
        '</div>' +
        '<div class="row-actions">' +
          '<button class="secondary" data-action="copy-vault-id" data-vault-id="' + escapeHtml(vault.vaultId) + '">复制ID</button>' +
          '<button class="secondary" data-action="copy-live-config" data-vault-id="' + escapeHtml(vault.vaultId) + '" data-vault-name="' + escapeHtml(vault.vaultName) + '" data-server-vault-id="' + escapeHtml(vault.serverVaultId || '') + '">复制连接</button>' +
        '</div>' +
      '</div>';
    }

    function renderVaultIdentity(result) {
      const box = $('vaultIdentityResult');
      const advice = Array.isArray(result.advice) ? result.advice : [];
      const exact = result.exactVault || null;
      const matches = Array.isArray(result.nameMatches) ? result.nameMatches : [];
      const cards = [];
      if (exact) cards.push(vaultCandidateHtml(exact, '当前 ID 可用'));
      matches.forEach((vault, index) => cards.push(vaultCandidateHtml(vault, !exact && index === 0 ? '建议复制给队友' : '同名候选')));
      const risk = result.duplicateNameRisk
        ? '<span class="pill warn">存在同名/误连风险</span>'
        : '<span class="pill ok">身份清晰</span>';
      const adviceHtml = advice.length
        ? '<div class="identity-advice">' + advice.map((item) => '<div>' + escapeHtml(item) + '</div>').join('') + '</div>'
        : '';
      const query = result.query || {};
      box.innerHTML =
        '<div class="section-head" style="padding-bottom:8px;margin-bottom:4px;">' +
          '<div><div class="section-title">诊断结果</div><div class="muted">查询：' + escapeHtml(query.vaultId || query.vaultName || '-') + ' · ' + escapeHtml(fmtDate(result.checkedAt)) + '</div></div>' +
          risk +
        '</div>' +
        adviceHtml +
        (cards.length
          ? '<div class="identity-vault-list">' + cards.join('') + '</div>'
          : '<div class="empty">服务器没有找到对应 Vault。请先让正确电脑连接一次同步服务器，或检查输入是否拼错。</div>');
    }

    async function checkVaultIdentity() {
      const input = $('identityVaultInput');
      const raw = (input && input.value ? input.value : '').trim();
      if (!raw) {
        toast('请先输入 Vault 名称或 ID。');
        return;
      }
      const button = $('checkVaultIdentity');
      const oldText = button.textContent;
      button.disabled = true;
      button.textContent = '诊断中';
      try {
        const params = new URLSearchParams();
        params.set('vaultId', raw);
        params.set('vaultName', raw);
        const res = await fetch('/api/admin/vaults/identity?' + params.toString(), { headers: apiHeaders() });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        renderVaultIdentity(data);
      } finally {
        button.disabled = false;
        button.textContent = oldText || '诊断 Vault ID';
      }
    }

    function renderVaultsV2(data) {
      renderVaultSelectors(data);
      text('vaultCount', data.vaults.length + ' 个 Vault');
      const vaults = $('vaults');
      if (!data.vaults.length) {
        vaults.innerHTML = '<div class="empty">服务器还没有注册 Vault。</div>';
        return;
      }
      vaults.innerHTML = data.vaults.map((v) => {
        const team = v.team || null;
        const teamSummary = hasTeamProductionData(team)
          ? '<div class="team-inline-summary"><span class="pill ' + teamHealthLevel(team) + '">' + teamHealthLabel(team) + '</span><span class="pill">任务 ' + escapeHtml(team.activeTasks || 0) + '/' + escapeHtml(team.totalTasks || 0) + '</span><span class="pill">Skill ' + escapeHtml(team.aiSkills || 0) + '</span></div>'
          : '';
        const canDeleteVault = data.capabilities.deleteVault && v.onlineClients.length === 0;
        const canRenameVault = data.capabilities.renameVault;
        const canExportVault = data.capabilities.exportVaultData;
        const deleteTitle = !data.capabilities.deleteVault
          ? 'Storage backend does not support vault deletion'
          : (v.onlineClients.length > 0 ? '删除前需要断开此 Vault 的所有设备' : '删除注册信息、备份和实时快照');
        return '<div class="vault">' +
          '<div><div class="vault-name">' + escapeHtml(v.vaultName) + '</div><div class="vault-id" title="' + escapeHtml(v.vaultId) + '">Vault ID: ' + escapeHtml(v.vaultId) + '</div><div class="vault-server-id" title="' + escapeHtml(v.serverVaultId || '') + '">Server ID: ' + escapeHtml(v.serverVaultId || '') + '</div>' + teamSummary + '</div>' +
          '<div><div class="cell-label">在线</div><div class="cell-value">' + escapeHtml(v.onlineClients.length) + '</div></div>' +
          '<div><div class="cell-label">备份</div><div class="cell-value">' + escapeHtml(v.backupCount) + '</div></div>' +
          '<div><div class="cell-label">备份大小</div><div class="cell-value">' + fmtBytes(v.backupTotalSize) + '</div></div>' +
          '<div><div class="cell-label">实时文件</div><div class="cell-value">' + (v.live ? escapeHtml(v.live.fileCount) : '-') + '</div></div>' +
          '<div><div class="cell-label">最后活动</div><div class="cell-value">' + fmtDate(v.lastActivityAt) + '</div></div>' +
          '<div class="row-actions">' +
            '<button class="secondary" data-action="copy-vault-id" data-vault-id="' + escapeHtml(v.vaultId) + '">复制 ID</button>' +
            '<button class="secondary" data-action="copy-live-config" data-vault-id="' + escapeHtml(v.vaultId) + '" data-vault-name="' + escapeHtml(v.vaultName) + '" data-server-vault-id="' + escapeHtml(v.serverVaultId || '') + '">复制连接</button>' +
            '<button class="secondary" data-action="rename-vault" data-vault-id="' + escapeHtml(v.vaultId) + '" data-vault-name="' + escapeHtml(v.vaultName) + '" ' + (canRenameVault ? '' : 'disabled') + '>重命名</button>' +
            '<button class="secondary" data-action="export-vault" data-vault-id="' + escapeHtml(v.vaultId) + '" ' + (canExportVault ? '' : 'disabled') + '>导出</button>' +
            '<button class="danger" data-action="delete-vault" data-vault-id="' + escapeHtml(v.vaultId) + '" data-vault-name="' + escapeHtml(v.vaultName) + '" title="' + escapeHtml(deleteTitle) + '" ' + (canDeleteVault ? '' : 'disabled') + '>删除</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function renderVaults(data) {
      renderVaultSelectors(data);
      text('vaultCount', data.vaults.length + ' vaults');
      const vaults = $('vaults');
      if (!data.vaults.length) {
        vaults.innerHTML = '<div class="empty">还没有注册的 Vault。</div>';
        return;
      }
      vaults.innerHTML = data.vaults.map((v) => {
        const team = v.team || null;
        const teamSummary = hasTeamProductionData(team)
          ? '<div class="team-inline-summary"><span class="pill ' + teamHealthLevel(team) + '">' + teamHealthLabel(team) + '</span><span class="pill">任务 ' + team.activeTasks + '/' + team.totalTasks + '</span><span class="pill">Skill ' + team.aiSkills + '</span></div>'
          : '';
        const canDeleteVault = data.capabilities.deleteVault && v.onlineClients.length === 0;
        const deleteTitle = !data.capabilities.deleteVault
          ? 'Storage backend does not support vault deletion'
          : (v.onlineClients.length > 0 ? 'Disconnect all clients before deleting this vault' : 'Delete registration, backups, and live snapshot');
        return '<div class="vault">' +
          '<div><div class="vault-name">' + escapeHtml(v.vaultName) + '</div><div class="vault-id" title="' + escapeHtml(v.vaultId) + '">Vault ID: ' + escapeHtml(v.vaultId) + '</div><div class="vault-server-id" title="' + escapeHtml(v.serverVaultId || '') + '">Server ID: ' + escapeHtml(v.serverVaultId || '') + '</div>' + teamSummary + '</div>' +
          '<div><div class="cell-label">在线</div><div class="cell-value">' + v.onlineClients.length + '</div></div>' +
          '<div><div class="cell-label">备份</div><div class="cell-value">' + v.backupCount + '</div></div>' +
          '<div><div class="cell-label">备份大小</div><div class="cell-value">' + fmtBytes(v.backupTotalSize) + '</div></div>' +
          '<div><div class="cell-label">实时文件</div><div class="cell-value">' + (v.live ? v.live.fileCount : '-') + '</div></div>' +
          '<div><div class="cell-label">最后活动</div><div class="cell-value">' + fmtDate(v.lastActivityAt) + '</div></div>' +
          '<div class="row-actions"><button class="secondary" data-action="copy-vault-id" data-vault-id="' + escapeHtml(v.vaultId) + '">复制ID</button><button class="secondary" data-action="copy-live-config" data-vault-id="' + escapeHtml(v.vaultId) + '" data-vault-name="' + escapeHtml(v.vaultName) + '" data-server-vault-id="' + escapeHtml(v.serverVaultId || '') + '">复制连接</button><button class="danger" data-action="delete-vault" data-vault-id="' + escapeHtml(v.vaultId) + '" data-vault-name="' + escapeHtml(v.vaultName) + '" title="' + escapeHtml(deleteTitle) + '" ' + (canDeleteVault ? '' : 'disabled') + '>删除Vault</button></div>' +
        '</div>';
      }).join('');
    }

    function renderBackups(data) {
      text('backupTotal', data.recentBackups.length + ' 个备份');
      const backups = $('backups');
      if (!data.recentBackups.length) {
        $('backupFiles').innerHTML = '';
        backups.innerHTML = '<div class="empty">还没有远程备份。</div>';
        return;
      }
      backups.innerHTML = '<div class="table-wrap"><table class="table"><thead><tr><th>备份</th><th>Vault</th><th>文件</th><th>大小</th><th>上传时间</th><th>操作</th></tr></thead><tbody>' +
        data.recentBackups.map((b) => '<tr><td>' + escapeHtml(b.backupId) + '</td><td>' + escapeHtml(b.vaultName) + '</td><td>' + b.fileCount + '</td><td>' + fmtBytes(b.totalSize) + '</td><td>' + fmtDate(b.uploadedAt) + '</td><td><button class="danger" data-action="delete-backup" data-vault-id="' + escapeHtml(b.vaultId) + '" data-backup-id="' + escapeHtml(b.backupId) + '">删除</button></td></tr>').join('') +
      '</tbody></table></div>';
      backups.querySelectorAll('button[data-action="delete-backup"]').forEach((button) => {
        const vaultId = button.getAttribute('data-vault-id') || '';
        const backupId = button.getAttribute('data-backup-id') || '';
        if (!vaultId || !backupId || button.parentElement?.classList.contains('row-actions')) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'row-actions';
        const filesButton = document.createElement('button');
        filesButton.className = 'secondary';
        filesButton.textContent = 'Files';
        filesButton.setAttribute('data-action', 'list-backup-files');
        filesButton.setAttribute('data-vault-id', vaultId);
        filesButton.setAttribute('data-backup-id', backupId);
        const parent = button.parentElement;
        if (!parent) return;
        parent.textContent = '';
        wrapper.appendChild(filesButton);
        wrapper.appendChild(button);
        parent.appendChild(wrapper);
      });
    }

    function renderLive(data) {
      text('clientTotal', data.server.totalConnections + ' 台在线 / ' + (data.server.knownClients || data.server.totalConnections || 0) + ' 台已知');
      text('liveCapability', data.capabilities.liveHistory ? '历史版本可用' : (data.capabilities.pruneLiveTombstones ? '仅支持清理' : '只读'));
      text('liveFileTotal', data.recentLiveFiles.length + ' 个文件');

      const clients = $('clients');
      const groups = (data.clientHistory && data.clientHistory.length) ? data.clientHistory : (data.activeClients || []);
      if (!groups.length) {
        clients.innerHTML = '<div class="empty">当前没有在线设备。打开另一台 Ars-note 并连接 Live Sync 后，这里会出现设备。</div>';
      } else {
        clients.innerHTML = groups.map((group) => '<div class="warning info">' +
          '<div class="warning-title">' + escapeHtml(group.vaultId) + '</div>' +
          group.clients.map((client) => {
            const label = client.deviceName || client.deviceId || client.clientId;
            const level = client.safetyLevel || 'warning';
            const wsStatus = client.webSocketStatus || 'online';
            const protocol = client.protocolVersion ? ('协议 v' + client.protocolVersion + '/' + (client.requiredProtocolVersion || '-')) : '协议未知';
            const version = client.appVersion ? ('客户端 v' + client.appVersion + ' / 服务器 v' + (client.serverVersion || '-')) : '客户端版本未知';
            const details = [client.platform, version, protocol, '会话 ' + client.clientId].filter(Boolean).join(' | ');
            const lastAction = [client.lastAction || client.lastMessageType || 'connected', client.lastRelativePath || ''].filter(Boolean).join(': ');
            const messages = Array.isArray(client.safetyMessages) && client.safetyMessages.length
              ? '<div class="warning-message">' + client.safetyMessages.slice(0, 4).map((msg) => escapeHtml(msg)).join('<br>') + '</div>'
              : '';
            const connectionLine = wsStatus === 'offline'
              ? 'WebSocket 离线 | 断开于 ' + fmtDate(client.disconnectedAt) + ' | 最后出现 ' + fmtDate(client.lastSeenAt) + (client.lastDisconnectReason ? (' | 原因 ' + escapeHtml(client.lastDisconnectReason)) : '')
              : 'WebSocket 在线 | 已连接 ' + fmtDuration(client.connectedSeconds || 0) + ' | 空闲 ' + fmtDuration(client.idleSeconds || 0) + ' | 最后活动 ' + fmtDate(client.lastSeenAt);
            return '<div class="warning ' + escapeHtml(level) + '" style="margin-top:8px;">' +
              '<div class="warning-title">' + escapeHtml(label) + ' <span class="pill ' + escapeHtml(level === 'danger' ? 'danger' : level === 'ok' ? 'ok' : 'warn') + '">' + escapeHtml(level) + '</span> <span class="pill ' + escapeHtml(wsStatus === 'online' ? 'ok' : 'warn') + '">' + escapeHtml(wsStatus) + '</span></div>' +
              '<div class="warning-message">' + escapeHtml(details) + '</div>' +
              '<div class="warning-message">' + connectionLine + '</div>' +
              '<div class="warning-message">最近同步：' + escapeHtml(lastAction) + ' | 接受 ' + fmtDate(client.lastAcceptedAt) + ' | 拒绝 ' + fmtDate(client.lastRejectedAt) + '</div>' +
              '<div class="warning-message">消息 收/发 ' + escapeHtml(client.receivedCount || 0) + '/' + escapeHtml(client.sentCount || 0) + ' | 已接收 ' + fmtBytes(client.bytesReceived || 0) + '</div>' +
              messages +
            '</div>';
          }).join('') +
        '</div>').join('');
      }

      const eventGroups = Array.isArray(data.clientEvents) ? data.clientEvents : [];
      const recentEvents = eventGroups.flatMap((group) => (group.events || []).map((event) => ({ ...event, vaultId: group.vaultId }))).slice(0, 24);
      if (recentEvents.length) {
        clients.innerHTML += '<div class="warning info" style="margin-top:10px;">' +
          '<div class="warning-title">最近设备同步事件</div>' +
          recentEvents.map((event) => {
            const level = event.level || 'info';
            const label = event.deviceName || event.deviceId || event.clientId || '-';
            const file = [event.action || event.eventType, event.relativePath || ''].filter(Boolean).join(': ');
            const reason = event.reason ? (' | reason ' + event.reason) : '';
            const historyActions = event.relativePath
              ? '<div class="row-actions" style="margin-top:6px;">' +
                  '<button class="secondary" data-action="list-live-history" data-vault-id="' + escapeHtml(event.vaultId || '') + '" data-relative-path="' + escapeHtml(event.relativePath || '') + '">历史</button>' +
                  ((event.historyRevisionId && event.historyContentAvailable)
                    ? '<button class="danger" data-action="restore-live-history" data-vault-id="' + escapeHtml(event.vaultId || '') + '" data-relative-path="' + escapeHtml(event.relativePath || '') + '" data-revision-id="' + escapeHtml(event.historyRevisionId || '') + '">恢复被拒绝版本</button>'
                    : '') +
                '</div>'
              : '';
            return '<div class="warning ' + escapeHtml(level === 'danger' ? 'danger' : level === 'warning' ? 'warning' : 'info') + '" style="margin-top:8px;">' +
              '<div class="warning-title">' + escapeHtml(event.eventType || '-') + ' <span class="pill">' + escapeHtml(label) + '</span></div>' +
              '<div class="warning-message">Vault ' + escapeHtml(event.vaultId || '-') + ' | ' + escapeHtml(fmtDate(event.createdAt)) + '</div>' +
              '<div class="warning-message">' + escapeHtml(file || '-') + escapeHtml(reason) + '</div>' +
              (event.historyRevisionId ? '<div class="warning-message">历史版本：' + escapeHtml(String(event.historyRevisionId).slice(0, 32)) + '</div>' : '') +
              historyActions +
            '</div>';
          }).join('') +
        '</div>';
      }

      const liveFiles = $('liveFiles');
      if (!data.recentLiveFiles.length) {
        liveFiles.innerHTML = '<div class="empty">还没有实时同步文件快照。</div>';
      } else {
        liveFiles.innerHTML = '<div class="table-wrap"><table class="table"><thead><tr><th>Vault</th><th>文件</th><th>状态</th><th>大小</th><th>更新时间</th><th>操作</th></tr></thead><tbody>' +
          data.recentLiveFiles.map((file) => {
            const downloadButton = file.deleted
              ? '<span class="muted">-</span>'
              : '<button class="secondary" data-action="download-live-file" data-vault-id="' + escapeHtml(file.vaultId) + '" data-relative-path="' + escapeHtml(file.relativePath) + '">下载</button>';
            const historyButton = data.capabilities.liveHistory
              ? '<button class="secondary" data-action="list-live-history" data-vault-id="' + escapeHtml(file.vaultId) + '" data-relative-path="' + escapeHtml(file.relativePath) + '">历史</button>'
              : '';
            return '<tr><td>' + escapeHtml(file.vaultName) + '</td><td class="path" title="' + escapeHtml(file.relativePath) + '">' + escapeHtml(file.relativePath) + '</td><td>' + (file.deleted ? '<span class="pill warn">已删除</span>' : '<span class="pill ok">正常</span>') + '</td><td>' + fmtBytes(file.size) + '</td><td>' + fmtDate(file.updatedAt) + '</td><td><div class="row-actions">' + downloadButton + historyButton + '</div></td></tr>';
          }).join('') +
        '</tbody></table></div>';
      }
    }

    function renderTeamProduction(data) {
      const teamVaults = (data.vaults || []).filter((vault) => hasTeamProductionData(vault.team));
      text('teamVaultTotal', teamVaults.length + ' 个 Vault');
      const box = $('teamProduction');
      if (!teamVaults.length) {
        box.innerHTML = '<div class="empty">服务器还没有收到团队制作数据。先在客户端点击“初始化/补齐团队工作区”，然后等待实时同步上传 .ars-team、07_Unity_Tasks 和 .ai-memory。</div>';
        return;
      }

      function stat(label, value) {
        return '<div class="team-stat"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
      }

      box.innerHTML = teamVaults.map((vault) => {
        const team = vault.team || {};
        const warnings = Array.isArray(team.warnings) ? team.warnings : [];
        const level = teamHealthLevel(team);
        const coreDocs = Array.isArray(team.coreDocs) ? team.coreDocs : [];
        const coreDocsSynced = coreDocs.filter((doc) => doc && doc.synced).length;
        const aiMemoryCoreFiles = Array.isArray(team.aiMemoryCoreFiles) ? team.aiMemoryCoreFiles : [];
        const aiMemoryCoreSynced = aiMemoryCoreFiles.filter((file) => file && file.synced).length;
        const warningHtml = warnings.length
          ? warnings.map((warning) => '<span class="pill ' + (level === 'danger' ? 'danger' : 'warn') + '">' + escapeHtml(warning) + '</span>').join('')
          : '<span class="pill ok">暂无制作风险</span>';
        const memberRows = Array.isArray(team.memberWork) ? team.memberWork.slice(0, 12) : [];
        const memberHtml = memberRows.length
          ? '<div class="team-member-list">' + memberRows.map((row) => (
              '<div class="team-member-card">' +
                '<div class="team-member-name" title="' + escapeHtml(row.member) + '">' + escapeHtml(row.member) + '</div>' +
                '<div class="team-member-meta">' +
                  'Active ' + escapeHtml(row.activeTasks || 0) +
                  ' / Blocked ' + escapeHtml(row.blockedTasks || 0) +
                  ' / Overdue ' + escapeHtml(row.overdueTasks || 0) +
                  '<br />Today ' + escapeHtml(fmtMinutes(row.todayMinutes || 0)) +
                  ' / Total ' + escapeHtml(fmtMinutes(row.spentMinutes || 0)) +
                  '<br />API: <code>/api/team/member-work?vaultId=' + encodeURIComponent(vault.vaultId) + '&member=' + encodeURIComponent(row.member) + '</code>' +
                '</div>' +
              '</div>'
            )).join('') + '</div>'
          : '<div class="muted" style="margin-top:10px;">No member task rows yet.</div>';
        return '<article class="team-vault-card">' +
          '<div class="team-vault-head"><div><div class="team-vault-title">' + escapeHtml(vault.vaultName) + '</div><div class="vault-id" title="' + escapeHtml(vault.vaultId) + '">' + escapeHtml(vault.vaultId) + '</div></div><span class="pill ' + level + '">' + teamHealthLabel(team) + '</span></div>' +
          '<div class="team-grid">' +
            stat('成员', team.members || 0) +
            stat('活跃/全部任务', (team.activeTasks || 0) + '/' + (team.totalTasks || 0)) +
            stat('已完成', team.doneTasks || 0) +
            stat('阻塞', team.blockedTasks || 0) +
            stat('逾期', team.overdueTasks || 0) +
            stat('7天内到期', team.dueSoonTasks || 0) +
            stat('缺负责人', team.missingOwnerTasks || 0) +
            stat('缺文档', team.missingDocTasks || 0) +
            stat('今日工时记录', team.recentLogCount || 0) +
            stat('累计工时', fmtMinutes(team.loggedMinutes || 0)) +
            stat('团队文档', team.teamDocs || 0) +
            stat('核心入口', coreDocs.length ? (coreDocsSynced + '/' + coreDocs.length) : '-') +
            stat('任务文档', team.taskDocs || 0) +
            stat('AI 记忆文件', team.aiMemoryFiles || 0) +
            stat('AI 核心记忆', aiMemoryCoreFiles.length ? (aiMemoryCoreSynced + '/' + aiMemoryCoreFiles.length) : '-') +
            stat('AI Skill', team.aiSkills || 0) +
            stat('AI Manifest', team.aiMemoryManifestSynced ? '已同步' : '未同步') +
            stat('团队表', team.scheduleSynced ? '已同步' : '未同步') +
          '</div>' +
          '<div class="team-warning-list">' + warningHtml + '</div>' +
          memberHtml +
          '<div class="muted" style="margin-top:10px;">Schedule: ' + fmtDate(team.scheduleUpdatedAt) + ' · Team file: ' + fmtDate(team.lastTeamFileAt) + '</div>' +
        '</article>';
      }).join('');
    }

    function renderDiagnostics(data) {
      const clone = JSON.parse(JSON.stringify(data));
      clone.adminApiKey = '[not exported]';
      $('diagnosticsText').textContent = JSON.stringify(clone, null, 2);
    }

    async function deleteBackup(vaultId, backupId, button) {
      const key = vaultId + ':' + backupId;
      if (pendingDeleteKey !== key) {
        pendingDeleteKey = key;
        button.textContent = '再点确认';
        toast('为了防止误删，请再点一次确认删除该备份。');
        window.clearTimeout(pendingDeleteTimer);
        pendingDeleteTimer = window.setTimeout(() => {
          pendingDeleteKey = '';
          loadOverview();
        }, 5000);
        return;
      }

      button.disabled = true;
      button.textContent = '删除中';
      const result = await postJson('/api/admin/backups/delete', { vaultId, backupId });
      pendingDeleteKey = '';
      toast('备份已删除：' + backupId + snapshotNotice(result));
      await loadOverview();
    }

    async function deleteVault(vaultId, vaultName, button) {
      if (!vaultId) return;
      const key = 'vault:' + vaultId;
      if (pendingDeleteKey !== key) {
        pendingDeleteKey = key;
        button.textContent = '确认删除';
        toast('再点一次会删除该 Vault 的服务器注册、所有备份和实时快照。');
        window.clearTimeout(pendingDeleteTimer);
        pendingDeleteTimer = window.setTimeout(() => {
          pendingDeleteKey = '';
          loadOverview();
        }, 5000);
        return;
      }

      button.disabled = true;
      button.textContent = '删除中';
      const result = await postJson('/api/admin/vaults/delete', { vaultId });
      pendingDeleteKey = '';
      toast('Vault 已删除：' + (vaultName || result.vaultName || vaultId) + snapshotNotice(result));
      await loadOverview();
    }

    async function deleteDuplicateVaults(button) {
      const key = 'duplicate-vaults';
      if (pendingDeleteKey !== key) {
        pendingDeleteKey = key;
        button.textContent = '再次点击确认清理';
        toast('将只删除离线、非建议保留的重复 Vault。请再点一次确认。');
        window.clearTimeout(pendingDeleteTimer);
        pendingDeleteTimer = window.setTimeout(() => {
          pendingDeleteKey = '';
          loadOverview();
        }, 5000);
        return;
      }

      button.disabled = true;
      button.textContent = '清理中...';
      const result = await postJson('/api/admin/vaults/delete-duplicates', { dryRun: false });
      pendingDeleteKey = '';
      toast('已清理重复 Vault ' + result.deleted + ' 个，跳过 ' + result.skipped + ' 个。' + snapshotNotice(result));
      await loadOverview();
    }

    async function renameVault(vaultId, currentName, button) {
      if (!vaultId) return;
      const newVaultName = window.prompt('New vault display name', currentName || '');
      if (newVaultName === null) return;
      const clean = String(newVaultName || '').trim();
      if (!clean) {
        toast('Vault name cannot be empty.');
        return;
      }
      const oldText = button.textContent;
      button.disabled = true;
      button.textContent = 'Renaming...';
      try {
        const result = await postJson('/api/admin/vaults/rename', { vaultId, newVaultName: clean });
        toast('Renamed vault: ' + result.vaultName + snapshotNotice(result));
        await loadOverview();
      } finally {
        button.disabled = false;
        button.textContent = oldText || 'Rename';
      }
    }

    async function mergeVault(sourceVaultId, targetVaultId, button) {
      if (!sourceVaultId || !targetVaultId) return;
      const key = 'merge-vault:' + sourceVaultId + ':' + targetVaultId;
      if (pendingDeleteKey !== key) {
        pendingDeleteKey = key;
        button.textContent = 'Confirm merge';
        toast('Click again to merge source vault into the recommended keeper. Conflicting files are copied to 00_ServerMergeConflicts instead of overwriting.');
        window.clearTimeout(pendingDeleteTimer);
        pendingDeleteTimer = window.setTimeout(() => {
          pendingDeleteKey = '';
          loadOverview();
        }, 7000);
        return;
      }

      button.disabled = true;
      button.textContent = 'Merging...';
      const result = await postJson('/api/admin/vaults/merge', { sourceVaultId, targetVaultId, deleteSource: true });
      pendingDeleteKey = '';
      const summary = result.result || {};
      toast('Merged: files ' + (summary.liveFilesCopied || 0) + ', conflicts ' + (summary.liveConflictsCopied || 0) + ', backups ' + (summary.backupsCopied || 0) + snapshotNotice(result));
      await loadOverview();
    }

    async function exportVault(vaultId, button) {
      if (!vaultId) return;
      const oldText = button.textContent;
      button.disabled = true;
      button.textContent = 'Exporting...';
      try {
        const res = await fetch('/api/admin/vaults/export?vaultId=' + encodeURIComponent(vaultId), { headers: apiHeaders() });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        downloadBlob(base64ToBlob(data.contentBase64), data.fileName || 'ars-note-server-export.json');
        toast('Exported server vault backup. SHA256: ' + String(data.sha256 || '').slice(0, 16));
      } finally {
        button.disabled = false;
        button.textContent = oldText || 'Export';
      }
    }

    async function exportServerData(button) {
      const oldText = button.textContent;
      if (!confirm('This downloads a full server data backup with vault file contents, backups, live snapshots, and live history. Continue?')) {
        return;
      }
      button.disabled = true;
      button.textContent = 'Exporting...';
      try {
        const res = await fetch('/api/admin/server/export', { headers: apiHeaders() });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        downloadBlob(base64ToBlob(data.contentBase64), data.fileName || 'ars-note-server-full-export.json');
        toast('Exported full server backup: ' + (data.vaultCount || 0) + '/' + (data.sourceVaultCount || 0) + ' vaults. SHA256: ' + String(data.sha256 || '').slice(0, 16));
      } finally {
        button.disabled = false;
        button.textContent = oldText || 'Export server data';
      }
    }

    async function createServerSnapshot(button) {
      const oldText = button.textContent;
      if (!confirm('Create a compressed full server snapshot on the NAS under server-data/server-exports?')) {
        return;
      }
      button.disabled = true;
      button.textContent = 'Creating...';
      try {
        const data = await postJson('/api/admin/server/snapshots/create', { reason: 'manual-admin' });
        toast('Created server snapshot: ' + (data.fileName || '-') + ' / ' + fmtBytes(data.size || 0));
        await loadOverview();
      } finally {
        button.disabled = false;
        button.textContent = oldText || 'Create server snapshot';
      }
    }

    async function downloadServerSnapshot(fileName, button) {
      if (!fileName) return;
      const oldText = button.textContent;
      button.disabled = true;
      button.textContent = 'Downloading...';
      try {
        const res = await fetch('/api/admin/server/snapshots/file?fileName=' + encodeURIComponent(fileName), { headers: apiHeaders() });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        downloadBlob(base64ToBlob(data.contentBase64), data.fileName || fileName);
        toast('Downloaded server snapshot. SHA256: ' + String(data.sha256 || '').slice(0, 16));
      } finally {
        button.disabled = false;
        button.textContent = oldText || 'Download';
      }
    }

    async function loadServerSnapshotFiles(fileName, button) {
      if (!fileName) return;
      const box = $('serverSnapshotFiles');
      const oldText = button ? button.textContent : '';
      if (button) {
        button.disabled = true;
        button.textContent = 'Loading...';
      }
      box.innerHTML = '<div class="empty">Loading server snapshot file versions...</div>';
      try {
        const params = new URLSearchParams();
        params.set('fileName', fileName);
        params.set('limit', '300');
        const res = await fetch('/api/admin/server/snapshots/files?' + params.toString(), { headers: apiHeaders() });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        renderServerSnapshotFiles(data);
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = oldText || 'Files';
        }
      }
    }

    function renderServerSnapshotFiles(data) {
      const box = $('serverSnapshotFiles');
      const files = Array.isArray(data.files) ? data.files : [];
      const shown = files.slice(0, 300);
      const rows = shown.map((item) => {
        const version = snapshotFileVersionLabel(item);
        const restoreButton = item.contentAvailable
          ? '<button class="danger" data-action="restore-server-snapshot-file" data-file-name="' + escapeHtml(data.fileName || '') + '" data-vault-id="' + escapeHtml(item.vaultId || '') + '" data-relative-path="' + escapeHtml(item.relativePath || '') + '" data-source="' + escapeHtml(item.source || '') + '" data-backup-id="' + escapeHtml(item.backupId || '') + '" data-revision-id="' + escapeHtml(item.revisionId || '') + '">Restore</button>'
          : '<span class="pill warn">No content</span>';
        return '<tr>' +
          '<td class="path" title="' + escapeHtml(item.relativePath || '') + '">' + escapeHtml(item.relativePath || '-') + '<br /><span class="muted">' + escapeHtml(item.vaultName || item.vaultId || '-') + '</span></td>' +
          '<td>' + escapeHtml(item.source || '-') + '</td>' +
          '<td>' + escapeHtml(item.deleted ? 'deleted record' : 'active') + '</td>' +
          '<td>' + fmtBytes(item.size || 0) + '</td>' +
          '<td>' + fmtDate(item.recordedAt || item.updatedAt) + '</td>' +
          '<td class="path" title="' + escapeHtml(version) + '">' + escapeHtml(version) + '</td>' +
          '<td><div class="row-actions">' + restoreButton + '</div></td>' +
        '</tr>';
      }).join('');
      box.innerHTML = '<section class="card section">' +
        '<div class="section-head"><div><div class="section-title">Server snapshot files</div><div class="muted">' + escapeHtml(data.fileName || '-') + ' / ' + files.length + ' versions shown. Restore broadcasts the selected version to online clients.</div></div><button class="secondary" data-action="close-server-snapshot-files">Close</button></div>' +
        (shown.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>Path</th><th>Source</th><th>State</th><th>Size</th><th>Time</th><th>Version</th><th>Action</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">No recoverable files found in this server snapshot.</div>') +
      '</section>';
    }

    function snapshotFileVersionLabel(item) {
      if (!item) return '-';
      if (item.source === 'live-history') return String(item.action || 'history') + ' / ' + String(item.revisionId || '-').slice(0, 24);
      if (item.source === 'backup') return 'backup / ' + String(item.backupId || '-');
      return 'live / ' + String(item.sha256 || '-').slice(0, 12);
    }

    async function restoreServerSnapshotFile(fileName, vaultId, relativePath, source, backupId, revisionId, button) {
      if (!fileName || !vaultId || !relativePath) return;
      const key = 'server-snapshot-restore:' + fileName + ':' + vaultId + ':' + relativePath + ':' + source + ':' + backupId + ':' + revisionId;
      if (pendingDeleteKey !== key) {
        pendingDeleteKey = key;
        button.textContent = 'Confirm restore';
        toast('Click again to restore this server snapshot version as the current live file.');
        window.clearTimeout(pendingDeleteTimer);
        pendingDeleteTimer = window.setTimeout(() => {
          pendingDeleteKey = '';
          loadServerSnapshotFiles(fileName).catch((err) => toast(err.message || String(err)));
        }, 7000);
        return;
      }

      button.disabled = true;
      button.textContent = 'Restoring...';
      const result = await postJson('/api/admin/server/snapshots/restore', {
        fileName,
        vaultId,
        relativePath,
        source,
        backupId,
        revisionId,
      });
      pendingDeleteKey = '';
      toast('Restored server snapshot file: ' + (result.file?.relativePath || relativePath) + snapshotNotice(result));
      await loadServerSnapshotFiles(fileName);
      await loadOverview();
    }

    function base64ToBlob(contentBase64) {
      const raw = atob(contentBase64 || '');
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return new Blob([bytes], { type: 'application/octet-stream' });
    }

    function downloadBlob(blob, fileName) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'ars-note-backup-file';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    async function loadBackupFiles(vaultId, backupId) {
      const box = $('backupFiles');
      box.innerHTML = '<div class="empty">Loading backup files...</div>';
      const res = await fetch('/api/admin/backups/files?vaultId=' + encodeURIComponent(vaultId) + '&backupId=' + encodeURIComponent(backupId), {
        headers: apiHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));

      const files = Array.isArray(data.files) ? data.files : [];
      const shown = files.slice(0, 300);
      box.innerHTML = '<section class="card section">' +
        '<div class="section-head"><div><div class="section-title">Backup files</div><div class="muted">' + escapeHtml(data.vaultName) + ' / ' + escapeHtml(data.backupId) + ' / ' + files.length + ' files / ' + fmtBytes(data.totalSize) + '</div></div><button class="secondary" data-action="close-backup-files">Close</button></div>' +
        (files.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>Path</th><th>Type</th><th>Size</th><th>Updated</th><th>SHA256</th><th>Action</th></tr></thead><tbody>' +
          shown.map((file) => '<tr><td class="path" title="' + escapeHtml(file.relativePath) + '">' + escapeHtml(file.relativePath) + '</td><td><span class="file-type">' + escapeHtml(file.type || 'other') + '</span></td><td>' + fmtBytes(file.size) + '</td><td>' + fmtDate(file.updatedAt) + '</td><td class="path" title="' + escapeHtml(file.sha256 || '') + '">' + escapeHtml(file.sha256 || '-').slice(0, 12) + '</td><td><button class="secondary" data-action="download-backup-file" data-vault-id="' + escapeHtml(vaultId) + '" data-backup-id="' + escapeHtml(backupId) + '" data-relative-path="' + escapeHtml(file.relativePath) + '">Download</button></td></tr>').join('') +
          '</tbody></table></div>' +
          (files.length > shown.length ? '<div class="muted" style="margin-top:10px;">Showing first ' + shown.length + ' files. Narrow this later with search/filter if needed.</div>' : '')
          : '<div class="empty">No files were recorded in this backup manifest.</div>') +
      '</section>';
    }

    async function downloadBackupFile(vaultId, backupId, relativePath, button) {
      const oldText = button.textContent;
      button.disabled = true;
      button.textContent = 'Downloading...';
      try {
        const res = await fetch('/api/admin/backups/file?vaultId=' + encodeURIComponent(vaultId) + '&backupId=' + encodeURIComponent(backupId) + '&relativePath=' + encodeURIComponent(relativePath), {
          headers: apiHeaders(),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        const fileName = String(relativePath || 'backup-file').split('/').pop() || 'backup-file';
        downloadBlob(base64ToBlob(data.contentBase64), fileName);
        toast('Downloaded ' + relativePath);
      } finally {
        button.disabled = false;
        button.textContent = oldText || 'Download';
      }
    }

    async function downloadLiveFile(vaultId, relativePath, button) {
      const oldText = button.textContent;
      button.disabled = true;
      button.textContent = 'Downloading...';
      try {
        const res = await fetch('/api/admin/live/file?vaultId=' + encodeURIComponent(vaultId) + '&relativePath=' + encodeURIComponent(relativePath), {
          headers: apiHeaders(),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        const fileName = String(relativePath || 'live-file').split('/').pop() || 'live-file';
        downloadBlob(base64ToBlob(data.contentBase64), fileName);
        toast('Downloaded live file ' + relativePath);
      } finally {
        button.disabled = false;
        button.textContent = oldText || 'Download';
      }
    }

    function liveHistoryDownloadName(relativePath, revisionId) {
      const base = String(relativePath || 'live-history-file').split('/').pop() || 'live-history-file';
      return String(revisionId || 'history') + '-' + base;
    }

    async function loadLiveHistory(vaultId, relativePath) {
      const box = $('liveHistory');
      box.innerHTML = '<div class="empty">Loading server live history...</div>';
      const params = new URLSearchParams();
      params.set('vaultId', vaultId || '');
      params.set('relativePath', relativePath || '');
      params.set('limit', '80');
      const res = await fetch('/api/admin/live/history?' + params.toString(), { headers: apiHeaders() });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));

      const history = Array.isArray(data.history) ? data.history : [];
      const rows = history.map((item) => {
        const canRestore = !item.deleted && Number(item.size || 0) >= 0;
        const downloadButton = canRestore
          ? '<button class="secondary" data-action="download-live-history-file" data-vault-id="' + escapeHtml(data.vaultId) + '" data-relative-path="' + escapeHtml(item.relativePath) + '" data-revision-id="' + escapeHtml(item.revisionId) + '">Download</button>'
          : '<span class="muted">-</span>';
        const restoreButton = canRestore
          ? '<button class="danger" data-action="restore-live-history" data-vault-id="' + escapeHtml(data.vaultId) + '" data-relative-path="' + escapeHtml(item.relativePath) + '" data-revision-id="' + escapeHtml(item.revisionId) + '">Restore</button>'
          : '';
        return '<tr>' +
          '<td class="path" title="' + escapeHtml(item.relativePath) + '">' + escapeHtml(item.relativePath) + '</td>' +
          '<td>' + escapeHtml(item.action || '-') + (item.reason ? '<br /><span class="muted">' + escapeHtml(item.reason) + '</span>' : '') + '</td>' +
          '<td>' + (item.deleted ? '<span class="pill warn">Delete marker</span>' : '<span class="pill ok">Content</span>') + '</td>' +
          '<td>' + fmtBytes(item.size || 0) + '</td>' +
          '<td>' + fmtDate(item.recordedAt) + '</td>' +
          '<td class="path" title="' + escapeHtml(item.revisionId) + '">' + escapeHtml(String(item.revisionId || '').slice(0, 22)) + '</td>' +
          '<td><div class="row-actions">' + downloadButton + restoreButton + '</div></td>' +
        '</tr>';
      }).join('');

      box.innerHTML = '<section class="card section">' +
        '<div class="section-head"><div><div class="section-title">Server live history</div><div class="muted">' + escapeHtml(data.vaultName || data.vaultId || '') + ' / ' + escapeHtml(data.relativePath || 'all files') + ' / ' + history.length + ' records</div></div><button class="secondary" data-action="close-live-history">Close</button></div>' +
        (history.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>Path</th><th>Action</th><th>Type</th><th>Size</th><th>Recorded</th><th>Revision</th><th>Action</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">No server history exists for this live file yet.</div>') +
        '<div class="muted" style="margin-top:10px;">Restore writes the selected server history version back as the current live file and broadcasts it to online clients.</div>' +
      '</section>';
    }

    async function downloadLiveHistoryFile(vaultId, relativePath, revisionId, button) {
      const oldText = button.textContent;
      button.disabled = true;
      button.textContent = 'Downloading...';
      try {
        const params = new URLSearchParams();
        params.set('vaultId', vaultId || '');
        params.set('relativePath', relativePath || '');
        params.set('revisionId', revisionId || '');
        const res = await fetch('/api/admin/live/history/file?' + params.toString(), { headers: apiHeaders() });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
        downloadBlob(base64ToBlob(data.contentBase64), liveHistoryDownloadName(data.relativePath || relativePath, data.revisionId || revisionId));
        toast('Downloaded server history ' + (data.relativePath || relativePath));
      } finally {
        button.disabled = false;
        button.textContent = oldText || 'Download';
      }
    }

    async function restoreLiveHistory(vaultId, relativePath, revisionId, button) {
      const key = 'live-history-restore:' + vaultId + ':' + relativePath + ':' + revisionId;
      if (pendingDeleteKey !== key) {
        pendingDeleteKey = key;
        button.textContent = 'Confirm restore';
        toast('Click again to restore this server history version as the current live file.');
        window.clearTimeout(pendingDeleteTimer);
        pendingDeleteTimer = window.setTimeout(() => {
          pendingDeleteKey = '';
          loadLiveHistory(vaultId, relativePath).catch((err) => toast(err.message || String(err)));
        }, 5000);
        return;
      }

      button.disabled = true;
      button.textContent = 'Restoring...';
      const result = await postJson('/api/admin/live/history/restore', { vaultId, relativePath, revisionId });
      pendingDeleteKey = '';
      toast('Restored server history: ' + (result.relativePath || relativePath) + snapshotNotice(result));
      await loadLiveHistory(vaultId, relativePath);
      await loadOverview();
    }

    document.body.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const tab = target.getAttribute('data-tab');
      if (tab) {
        document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el.getAttribute('data-tab') === tab));
        document.querySelectorAll('.panel').forEach((el) => el.classList.toggle('active', el.id === 'panel-' + tab));
        return;
      }

      if (target.getAttribute('data-action') === 'copy-vault-id') {
        await copyText(target.getAttribute('data-vault-id') || '', 'Vault ID');
      }

      if (target.getAttribute('data-action') === 'copy-live-config') {
        const vault = {
          vaultId: target.getAttribute('data-vault-id') || '',
          vaultName: target.getAttribute('data-vault-name') || '',
          serverVaultId: target.getAttribute('data-server-vault-id') || '',
        };
        await copyText(liveSyncConnectionText(vault), '连接配置');
      }

      if (target.id === 'checkVaultIdentity') {
        try {
          await checkVaultIdentity();
        } catch (err) {
          toast(err.message || String(err));
        }
      }

      if (target.getAttribute('data-action') === 'delete-vault') {
        try {
          await deleteVault(target.getAttribute('data-vault-id'), target.getAttribute('data-vault-name'), target);
        } catch (err) {
          toast(err.message || String(err));
          await loadOverview();
        }
      }

      if (target.getAttribute('data-action') === 'rename-vault') {
        try {
          await renameVault(target.getAttribute('data-vault-id'), target.getAttribute('data-vault-name'), target);
        } catch (err) {
          toast(err.message || String(err));
          await loadOverview();
        }
      }

      if (target.getAttribute('data-action') === 'merge-vault') {
        try {
          await mergeVault(target.getAttribute('data-source-vault-id'), target.getAttribute('data-target-vault-id'), target);
        } catch (err) {
          toast(err.message || String(err));
          await loadOverview();
        }
      }

      if (target.getAttribute('data-action') === 'export-vault') {
        try {
          await exportVault(target.getAttribute('data-vault-id'), target);
        } catch (err) {
          toast(err.message || String(err));
        }
      }

      if (target.id === 'downloadServerExport') {
        try {
          await exportServerData(target);
        } catch (err) {
          toast(err.message || String(err));
        }
      }

      if (target.id === 'createServerSnapshot') {
        try {
          await createServerSnapshot(target);
        } catch (err) {
          toast(err.message || String(err));
          await loadOverview();
        }
      }

      if (target.getAttribute('data-action') === 'download-server-snapshot') {
        try {
          await downloadServerSnapshot(target.getAttribute('data-file-name'), target);
        } catch (err) {
          toast(err.message || String(err));
        }
      }

      if (target.getAttribute('data-action') === 'list-server-snapshot-files') {
        try {
          await loadServerSnapshotFiles(target.getAttribute('data-file-name'), target);
        } catch (err) {
          toast(err.message || String(err));
        }
      }

      if (target.getAttribute('data-action') === 'restore-server-snapshot-file') {
        try {
          await restoreServerSnapshotFile(
            target.getAttribute('data-file-name'),
            target.getAttribute('data-vault-id'),
            target.getAttribute('data-relative-path'),
            target.getAttribute('data-source'),
            target.getAttribute('data-backup-id'),
            target.getAttribute('data-revision-id'),
            target,
          );
        } catch (err) {
          toast(err.message || String(err));
          await loadServerSnapshotFiles(target.getAttribute('data-file-name')).catch(() => {});
        }
      }

      if (target.id === 'deleteDuplicateVaults') {
        try {
          await deleteDuplicateVaults(target);
        } catch (err) {
          toast(err.message || String(err));
          await loadOverview();
        }
      }

      if (target.getAttribute('data-action') === 'delete-backup') {
        try {
          await deleteBackup(target.getAttribute('data-vault-id'), target.getAttribute('data-backup-id'), target);
        } catch (err) {
          toast(err.message || String(err));
          await loadOverview();
        }
      }

      if (target.getAttribute('data-action') === 'list-backup-files') {
        try {
          await loadBackupFiles(target.getAttribute('data-vault-id'), target.getAttribute('data-backup-id'));
        } catch (err) {
          toast(err.message || String(err));
        }
      }

      if (target.getAttribute('data-action') === 'download-backup-file') {
        try {
          await downloadBackupFile(target.getAttribute('data-vault-id'), target.getAttribute('data-backup-id'), target.getAttribute('data-relative-path'), target);
        } catch (err) {
          toast(err.message || String(err));
        }
      }

      if (target.getAttribute('data-action') === 'download-live-file') {
        try {
          await downloadLiveFile(target.getAttribute('data-vault-id'), target.getAttribute('data-relative-path'), target);
        } catch (err) {
          toast(err.message || String(err));
        }
      }

      if (target.getAttribute('data-action') === 'list-live-history') {
        try {
          await loadLiveHistory(target.getAttribute('data-vault-id'), target.getAttribute('data-relative-path'));
        } catch (err) {
          toast(err.message || String(err));
        }
      }

      if (target.getAttribute('data-action') === 'download-live-history-file') {
        try {
          await downloadLiveHistoryFile(
            target.getAttribute('data-vault-id'),
            target.getAttribute('data-relative-path'),
            target.getAttribute('data-revision-id'),
            target,
          );
        } catch (err) {
          toast(err.message || String(err));
        }
      }

      if (target.getAttribute('data-action') === 'restore-live-history') {
        try {
          await restoreLiveHistory(
            target.getAttribute('data-vault-id'),
            target.getAttribute('data-relative-path'),
            target.getAttribute('data-revision-id'),
            target,
          );
        } catch (err) {
          toast(err.message || String(err));
          await loadLiveHistory(target.getAttribute('data-vault-id'), target.getAttribute('data-relative-path')).catch(() => {});
        }
      }

      if (target.getAttribute('data-action') === 'close-live-history') {
        $('liveHistory').innerHTML = '';
      }

      if (target.getAttribute('data-action') === 'close-backup-files') {
        $('backupFiles').innerHTML = '';
      }

      if (target.getAttribute('data-action') === 'close-server-snapshot-files') {
        $('serverSnapshotFiles').innerHTML = '';
      }
    });

    document.body.addEventListener('keydown', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.id === 'identityVaultInput' && event.key === 'Enter') {
        event.preventDefault();
        try {
          await checkVaultIdentity();
        } catch (err) {
          toast(err.message || String(err));
        }
      }
    });

    $('pruneBackups').addEventListener('click', async () => {
      const vaultId = $('backupVaultSelect').value;
      const keepLatest = Number($('keepLatest').value) || 20;
      try {
        const result = await postJson('/api/admin/backups/prune', { vaultId, keepLatest });
        toast('已清理旧备份 ' + result.deleted + ' 个，保留最近 ' + result.keepLatest + ' 个。' + snapshotNotice(result));
        await loadOverview();
      } catch (err) {
        toast(err.message || String(err));
      }
    });

    $('pruneTombstones').addEventListener('click', async () => {
      const vaultId = $('liveVaultSelect').value;
      if (!vaultId) {
        toast('没有可清理的 Vault。');
        return;
      }
      try {
        const result = await postJson('/api/admin/live/prune-tombstones', { vaultId });
        toast('已清理删除记录 ' + result.removed + ' 条。' + snapshotNotice(result));
        await loadOverview();
      } catch (err) {
        toast(err.message || String(err));
      }
    });

    $('downloadDiagnostics').addEventListener('click', () => {
      if (!latestData) return;
      const clone = JSON.parse(JSON.stringify(latestData));
      clone.adminApiKey = '[not exported]';
      const blob = new Blob([JSON.stringify(clone, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ars-note-sync-diagnostics.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    $('saveKey').addEventListener('click', () => {
      sessionStorage.setItem('ars-note.admin.apiKey', keyInput.value.trim());
      loadOverview();
    });
    $('refresh').addEventListener('click', loadOverview);
    keyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        sessionStorage.setItem('ars-note.admin.apiKey', keyInput.value.trim());
        loadOverview();
      }
    });
    loadOverview();
    setInterval(loadOverview, 5000);
  </script>
</body>
</html>`;
}
