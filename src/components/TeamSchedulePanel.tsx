import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  FileNode,
  NarrativeTaskDraft,
  NarrativeTaskDraftResult,
  LiveHistoryItem,
  LiveSyncSelfTestResult,
  TeamServerMemberWorkStatus,
  TeamServerProductionStatus,
} from '../types';
import { ClockIcon, FileIcon, PlusIcon, RefreshIcon, SearchIcon, CloseIcon } from './icons/ArsIcons';

type TeamTaskStatus = 'todo' | 'doing' | 'review' | 'blocked' | 'done';
type TeamTaskPriority = 'high' | 'medium' | 'low';
type TeamReviewResult = 'approved' | 'changes' | 'note';
type TeamScheduleViewMode = 'focus' | 'table' | 'board' | 'logs';
type TeamScheduleSortMode = 'dueAsc' | 'priorityDesc' | 'updatedDesc' | 'ownerAsc' | 'spentDesc';
type TeamFocusScope = 'mine' | 'team';
type TaskDocStatus = 'linked' | 'missing' | 'none';

interface TeamTimeLog {
  id: string;
  member: string;
  date: string;
  minutes: number;
  note: string;
  createdAt: string;
}

interface TeamReviewLog {
  id: string;
  reviewer: string;
  date: string;
  result: TeamReviewResult;
  note: string;
  createdAt: string;
}

interface TeamScheduleTask {
  id: string;
  title: string;
  owner: string;
  status: TeamTaskStatus;
  priority: TeamTaskPriority;
  startDate: string;
  dueDate: string;
  estimateMinutes: number;
  linkedDoc: string;
  deliverable: string;
  dependency: string;
  blocker: string;
  acceptance: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  logs: TeamTimeLog[];
  reviewLogs: TeamReviewLog[];
}

interface TeamScheduleData {
  version: 1;
  updatedAt: string;
  members: string[];
  tasks: TeamScheduleTask[];
  deletedTaskIds?: string[];
}

interface ActiveWorkSession {
  taskId: string;
  taskTitle: string;
  member: string;
  startedAt: string;
  note: string;
}

interface AITakeoverPreviewOwner {
  member: string;
  draftCount: number;
  openTasks: number;
  remainingMinutes: number;
  high: number;
  blocked: number;
  overdue: number;
  level: 'ok' | 'warning' | 'danger';
}

interface AITakeoverReassignment {
  title: string;
  fromOwner: string;
  toOwner: string;
  reason: string;
  projectedLoad: string;
}

interface AITakeoverPreview {
  checkedAt: string;
  result: NarrativeTaskDraftResult;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  warnings: string[];
  affectedOwners: AITakeoverPreviewOwner[];
  reassignments: AITakeoverReassignment[];
}

interface TeamSchedulePanelProps {
  vaultPath: string;
  fileTree: FileNode[];
  onOpenFile: (relativePath: string) => void;
  onRefreshVault?: () => Promise<void>;
  currentFileRelativePath?: string;
  onImportCurrentDocumentTasks?: () => Promise<{
    extractedCount: number;
    importedCount: number;
    updatedCount?: number;
    skippedCount: number;
    productionDocPaths?: string[];
    taskDocCreatedCount?: number;
    taskDocLinkedCount?: number;
    taskDocUpgradedCount?: number;
    taskDocSkippedCount?: number;
    taskDocPaths?: string[];
  }>;
}

const api = window.arsnote;
type TeamProductionDocOptions = NonNullable<Parameters<typeof api.generateTeamProductionDocs>[1]>;

const SCHEDULE_DIR = '.ars-team';
const SCHEDULE_FILE = 'schedule.json';
const SCHEDULE_RELATIVE_PATH = `${SCHEDULE_DIR}/${SCHEDULE_FILE}`;
const OBSIDIAN_COMMAND_CENTER_PATH = `${SCHEDULE_DIR}/obsidian-command-center.md`;
const BOOTSTRAP_COMMAND_TASK_TITLE = '初始化 Obsidian 团队制作控制台';
const STATUS_ORDER: TeamTaskStatus[] = ['todo', 'doing', 'review', 'blocked', 'done'];
const STATUS_LABELS: Record<TeamTaskStatus, string> = {
  todo: '待开始',
  doing: '进行中',
  review: '待验收',
  blocked: '阻塞',
  done: '完成',
};
const PRIORITY_LABELS: Record<TeamTaskPriority, string> = {
  high: '高',
  medium: '中',
  low: '低',
};
const PRIORITY_WEIGHT: Record<TeamTaskPriority, number> = { high: 3, medium: 2, low: 1 };
const REVIEW_RESULT_LABELS: Record<TeamReviewResult, string> = {
  approved: '通过',
  changes: '退回',
  note: '记录',
};

function productionDocSubset(enabled: Partial<TeamProductionDocOptions>): TeamProductionDocOptions {
  return {
    includeDashboard: false,
    includeObsidianCommandCenter: false,
    includeProductionHealth: false,
    includeDependencyMap: false,
    includeHandoff: false,
    includeAiMemoryIndex: false,
    includeLinkHealth: false,
    includeBlockerHandoff: false,
    includeReviewQueue: false,
    includeWorkpack: false,
    includeDailyStandup: false,
    includeTimesheet: false,
    includeRoadmap: false,
    includeDecisionLog: false,
    includeChangeImpact: false,
    includeNarrativeDirector: false,
    includeSprintPlan: false,
    includeMemberPages: false,
    includeTaskDocs: false,
    includeTakeoverPlan: false,
    ...enabled,
  };
}

function allProductionDocs(): TeamProductionDocOptions {
  return {
    includeDashboard: true,
    includeObsidianCommandCenter: true,
    includeProductionHealth: true,
    includeDependencyMap: true,
    includeHandoff: true,
    includeAiMemoryIndex: true,
    includeLinkHealth: true,
    includeBlockerHandoff: true,
    includeReviewQueue: true,
    includeWorkpack: true,
    includeDailyStandup: true,
    includeTimesheet: true,
    includeRoadmap: true,
    includeDecisionLog: true,
    includeChangeImpact: true,
    includeNarrativeDirector: true,
    includeSprintPlan: true,
    includeMemberPages: true,
    includeTaskDocs: true,
    includeTakeoverPlan: true,
  };
}

function normalizePath(path: string): string {
  return String(path || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '');
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatLocalDateTime(value: string): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function bytesToLabel(bytes: number): string {
  const size = Math.max(0, Number(bytes) || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function serverAdminUrlFromEndpoint(endpoint: unknown): string {
  const raw = String(endpoint || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.pathname = '/admin';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanMemberName(value: string): string {
  return String(value || '').trim() || '未分配';
}

function isUnassignedMember(value: unknown): boolean {
  const member = cleanMemberName(String(value || ''));
  return member === '未分配' || /^unassigned$/i.test(member);
}

function cleanTaskKeyText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function teamScheduleTaskKey(task: { title?: unknown; owner?: unknown; linkedDoc?: unknown }): string {
  const owner = cleanTaskKeyText(task.owner) || '未分配';
  return [
    cleanTaskKeyText(task.title).toLowerCase(),
    owner.toLowerCase(),
    normalizePath(String(task.linkedDoc || '')).toLowerCase(),
  ].join('|');
}

function minutesToLabel(minutes: number): string {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

function normalizeStatus(value: unknown): TeamTaskStatus {
  const raw = String(value || '').toLowerCase();
  if (raw === 'doing' || raw === 'in-progress' || raw === 'wip') return 'doing';
  if (raw === 'review' || raw === 'qa') return 'review';
  if (raw === 'blocked' || raw === 'stuck') return 'blocked';
  if (raw === 'done' || raw === 'complete' || raw === 'completed') return 'done';
  return 'todo';
}

function normalizePriority(value: unknown): TeamTaskPriority {
  const raw = String(value || '').toLowerCase();
  if (raw === 'high' || raw === 'p0' || raw === 'p1') return 'high';
  if (raw === 'low' || raw === 'p3') return 'low';
  return 'medium';
}

function normalizeReviewResult(value: unknown): TeamReviewResult {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('approved') || raw.includes('pass') || raw.includes('通过')) return 'approved';
  if (raw.includes('change') || raw.includes('reject') || raw.includes('退回')) return 'changes';
  return 'note';
}

function toMinutes(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, Math.round(numberValue)) : 0;
}

function projectedTaskMinutes(task: NarrativeTaskDraft): number {
  const explicit = Number(task.estimateMinutes);
  if (Number.isFinite(explicit) && explicit > 0) return Math.max(15, Math.round(explicit));
  return normalizePriority(task.priority) === 'high' ? 120 : 60;
}

function loadRiskScore(load: {
  openTasks: number;
  remainingMinutes: number;
  high: number;
  blocked: number;
  overdue: number;
  assignedDrafts: number;
}): number {
  return (
    load.openTasks * 100 +
    Math.ceil(load.remainingMinutes / 60) * 25 +
    load.high * 60 +
    load.blocked * 180 +
    load.overdue * 180 +
    load.assignedDrafts * 85
  );
}

function normalizeTask(raw: any): TeamScheduleTask | null {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title || raw.name || '').trim();
  if (!title) return null;
  const logs = Array.isArray(raw.logs) ? raw.logs : [];
  const reviewLogs = Array.isArray(raw.reviewLogs) ? raw.reviewLogs : [];
  return {
    id: String(raw.id || uid('task')),
    title,
    owner: cleanMemberName(String(raw.owner || raw.assignee || raw.member || '')),
    status: normalizeStatus(raw.status),
    priority: normalizePriority(raw.priority),
    startDate: String(raw.startDate || raw.start || '').slice(0, 10),
    dueDate: String(raw.dueDate || raw.due || raw.deadline || '').slice(0, 10),
    estimateMinutes: toMinutes(raw.estimateMinutes || raw.estimate),
    linkedDoc: normalizePath(String(raw.linkedDoc || raw.doc || raw.path || '')),
    deliverable: String(raw.deliverable || raw.summary || ''),
    dependency: String(raw.dependency || raw.dependencies || ''),
    blocker: String(raw.blocker || raw.blockedReason || ''),
    acceptance: String(raw.acceptance || raw.acceptanceCriteria || ''),
    notes: String(raw.notes || raw.note || ''),
    createdAt: String(raw.createdAt || nowIso()),
    updatedAt: String(raw.updatedAt || nowIso()),
    logs: logs.flatMap((log: any): TeamTimeLog[] => {
      if (!log || typeof log !== 'object') return [];
      return [{
        id: String(log.id || uid('log')),
        member: cleanMemberName(String(log.member || raw.owner || '')),
        date: String(log.date || todayString()).slice(0, 10),
        minutes: toMinutes(log.minutes),
        note: String(log.note || ''),
        createdAt: String(log.createdAt || nowIso()),
      }];
    }),
    reviewLogs: reviewLogs.flatMap((log: any): TeamReviewLog[] => {
      if (!log || typeof log !== 'object') return [];
      return [{
        id: String(log.id || uid('review')),
        reviewer: cleanMemberName(String(log.reviewer || log.member || raw.owner || '')),
        date: String(log.date || todayString()).slice(0, 10),
        result: normalizeReviewResult(log.result || log.status),
        note: String(log.note || ''),
        createdAt: String(log.createdAt || nowIso()),
      }];
    }),
  };
}

function createEmptySchedule(memberName = ''): TeamScheduleData {
  const member = cleanMemberName(memberName);
  return {
    version: 1,
    updatedAt: nowIso(),
    members: member ? [member] : [],
    tasks: [],
    deletedTaskIds: [],
  };
}

function normalizeScheduleData(raw: unknown, memberName = ''): TeamScheduleData {
  const parsed = raw && typeof raw === 'object' ? raw as any : {};
  const tasks = Array.isArray(parsed.tasks)
    ? parsed.tasks.flatMap((task: any): TeamScheduleTask[] => {
      const normalized = normalizeTask(task);
      return normalized ? [normalized] : [];
    })
    : [];
  const members = new Set<string>();
  if (Array.isArray(parsed.members)) {
    for (const member of parsed.members) members.add(cleanMemberName(String(member)));
  }
  if (memberName) members.add(cleanMemberName(memberName));
  for (const task of tasks) {
    if (task.owner) members.add(cleanMemberName(task.owner));
    for (const log of task.logs) members.add(cleanMemberName(log.member));
    for (const log of task.reviewLogs) members.add(cleanMemberName(log.reviewer));
  }
  return {
    version: 1,
    updatedAt: String(parsed.updatedAt || nowIso()),
    members: Array.from(members).filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    tasks,
    deletedTaskIds: Array.isArray(parsed.deletedTaskIds) ? parsed.deletedTaskIds.map(String).slice(-500) : [],
  };
}

function collectDocumentPaths(nodes: FileNode[], vaultPath: string): string[] {
  const root = normalizePath(vaultPath).replace(/\/+$/, '');
  const docs: string[] = [];
  const walk = (items: FileNode[]) => {
    for (const node of items) {
      if (node.isDir) {
        walk(node.children || []);
        continue;
      }
      if (!/\.(md|canvas|excalidraw)$/i.test(node.name)) continue;
      const normalized = normalizePath(node.path);
      const relative = normalized.toLowerCase().startsWith(root.toLowerCase() + '/')
        ? normalized.slice(root.length + 1)
        : normalized;
      docs.push(relative);
    }
  };
  walk(nodes);
  return Array.from(new Set(docs)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function createDocumentPathSet(paths: string[]): Set<string> {
  return new Set(paths.map((path) => normalizePath(path).toLowerCase()));
}

function taskSpentMinutes(task: TeamScheduleTask): number {
  return task.logs.reduce((sum, log) => sum + log.minutes, 0);
}

function latestReviewLog(task: TeamScheduleTask): TeamReviewLog | null {
  return task.reviewLogs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
}

function isOverdue(task: TeamScheduleTask): boolean {
  return Boolean(task.dueDate && task.status !== 'done' && task.dueDate < todayString());
}

function taskDocStatus(task: TeamScheduleTask, documentPathSet: Set<string>): TaskDocStatus {
  if (!task.linkedDoc) return 'none';
  return documentPathSet.has(normalizePath(task.linkedDoc).toLowerCase()) ? 'linked' : 'missing';
}

function isBootstrapCommandTask(task: TeamScheduleTask): boolean {
  return normalizePath(task.linkedDoc).toLowerCase() === '07_unity_tasks/teamproductionbootstrap.md' ||
    task.title.trim() === BOOTSTRAP_COMMAND_TASK_TITLE;
}

function formatTeamServerError(error: any): string {
  const raw = String(error?.message || error || '').replace(/^Error invoking remote method '[^']+':\s*/i, '').trim();
  if (/fetch failed|failed to fetch|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|timeout/i.test(raw)) {
    return '服务器不可达：请确认节点小宝/Tailscale/局域网连接已开启，服务器地址和端口能访问。';
  }
  if (/not configured|server is not configured/i.test(raw)) return '还没有配置同步服务器地址。';
  return raw || '读取服务器团队状态失败';
}

function tasksMissingWorkDocs(tasks: TeamScheduleTask[], documentPathSet: Set<string>): TeamScheduleTask[] {
  return tasks.filter((task) => task.status !== 'done' && taskDocStatus(task, documentPathSet) !== 'linked');
}

function tasksMissingAcceptance(tasks: TeamScheduleTask[]): TeamScheduleTask[] {
  return tasks.filter((task) => task.status !== 'done' && !task.acceptance.trim());
}

function taskDueLabel(task: TeamScheduleTask): string {
  if (!task.dueDate) return '无截止';
  const today = todayString();
  if (task.dueDate < today && task.status !== 'done') return `逾期 ${task.dueDate}`;
  if (task.dueDate === today) return '今天截止';
  return task.dueDate;
}

function taskUrgencyClass(task: TeamScheduleTask): string {
  if (task.status === 'blocked' || task.blocker.trim()) return 'danger';
  if (isOverdue(task)) return 'danger';
  if (task.dueDate === todayString() && task.status !== 'done') return 'warning';
  if (task.priority === 'high' && task.status !== 'done') return 'warning';
  if (task.status === 'done') return 'done';
  return 'normal';
}

function taskProgressPercent(task: TeamScheduleTask): number {
  if (task.status === 'done') return 100;
  if (!task.estimateMinutes) return 0;
  return Math.max(0, Math.min(100, Math.round((taskSpentMinutes(task) / task.estimateMinutes) * 100)));
}

function normalizeTaskDocPath(path: string, title: string): string {
  const current = normalizePath(path).trim();
  if (current && /\.md$/i.test(current)) return current;
  const safeTitle = String(title || 'Task')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || 'Task';
  return `07_Unity_Tasks/${safeTitle}.md`;
}

function compareDate(left: string, right: string): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right);
}

function sortTasks(tasks: TeamScheduleTask[], sortMode: TeamScheduleSortMode): TeamScheduleTask[] {
  const sorted = [...tasks];
  sorted.sort((a, b) => {
    if (sortMode === 'priorityDesc') return PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] || compareDate(a.dueDate, b.dueDate);
    if (sortMode === 'updatedDesc') return b.updatedAt.localeCompare(a.updatedAt);
    if (sortMode === 'ownerAsc') return a.owner.localeCompare(b.owner, 'zh-CN') || compareDate(a.dueDate, b.dueDate);
    if (sortMode === 'spentDesc') return taskSpentMinutes(b) - taskSpentMinutes(a);
    return compareDate(a.dueDate, b.dueDate)
      || STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
      || PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
  });
  return sorted;
}

function buildScheduleCsv(tasks: TeamScheduleTask[]): string {
  const cell = (value: unknown) => {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = [
    ['Title', 'Owner', 'Status', 'Priority', 'StartDate', 'DueDate', 'EstimateMinutes', 'SpentMinutes', 'LinkedDoc', 'Deliverable', 'Dependency', 'Blocker', 'Acceptance', 'Notes', 'UpdatedAt'],
    ...tasks.map((task) => [
      task.title,
      task.owner,
      STATUS_LABELS[task.status],
      PRIORITY_LABELS[task.priority],
      task.startDate,
      task.dueDate,
      task.estimateMinutes,
      taskSpentMinutes(task),
      task.linkedDoc,
      task.deliverable,
      task.dependency,
      task.blocker,
      task.acceptance,
      task.notes,
      task.updatedAt,
    ]),
  ];
  return rows.map((row) => row.map(cell).join(',')).join('\n');
}

function buildScheduleReport(data: TeamScheduleData, tasks: TeamScheduleTask[], documentPaths: string[]): string {
  const documentPathSet = createDocumentPathSet(documentPaths);
  const lines: string[] = [
    '# 团队时间表汇总',
    '',
    `生成时间：${new Date().toLocaleString()}`,
    `任务数：${tasks.length}`,
    `总用时：${minutesToLabel(tasks.reduce((sum, task) => sum + taskSpentMinutes(task), 0))}`,
    `缺任务文档：${tasksMissingWorkDocs(tasks, documentPathSet).length}`,
    `缺验收标准：${tasksMissingAcceptance(tasks).length}`,
    `更新时间：${data.updatedAt}`,
    '',
    '## 任务',
  ];
  for (const task of tasks) {
    lines.push(`- [${STATUS_LABELS[task.status]}] ${task.title}`);
    lines.push(`  - owner: ${task.owner || '未分配'}; priority: ${PRIORITY_LABELS[task.priority]}; due: ${task.dueDate || '-'}; spent: ${minutesToLabel(taskSpentMinutes(task))}`);
    lines.push(`  - doc: ${task.linkedDoc || '未指定'}`);
    if (task.deliverable) lines.push(`  - deliverable: ${task.deliverable}`);
    if (task.dependency) lines.push(`  - dependency: ${task.dependency}`);
    if (task.blocker) lines.push(`  - blocker: ${task.blocker}`);
    if (task.acceptance) lines.push(`  - acceptance: ${task.acceptance}`);
  }
  return lines.join('\n');
}

const TeamSchedulePanel: React.FC<TeamSchedulePanelProps> = ({
  vaultPath,
  fileTree,
  onOpenFile,
  onRefreshVault,
  currentFileRelativePath,
  onImportCurrentDocumentTasks,
}) => {
  const [data, setData] = useState<TeamScheduleData>(() => createEmptySchedule());
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [currentMember, setCurrentMember] = useState(() => localStorage.getItem('ars-note.team.currentMember') || '');
  const [viewMode, setViewMode] = useState<TeamScheduleViewMode>('focus');
  const [focusScope, setFocusScope] = useState<TeamFocusScope>(() => {
    const saved = localStorage.getItem('ars-note.team.focusScope');
    if (saved === 'mine' || saved === 'team') return saved;
    return localStorage.getItem('ars-note.team.currentMember') ? 'mine' : 'team';
  });
  const [sortMode, setSortMode] = useState<TeamScheduleSortMode>('dueAsc');
  const [statusFilter, setStatusFilter] = useState<TeamTaskStatus | 'all'>('all');
  const [memberFilter, setMemberFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newOwner, setNewOwner] = useState('');
  const [newDoc, setNewDoc] = useState('');
  const [newDue, setNewDue] = useState('');
  const [timeInputs, setTimeInputs] = useState<Record<string, { minutes: string; note: string }>>({});
  const [exportMsg, setExportMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [serverStatus, setServerStatus] = useState<TeamServerProductionStatus | null>(null);
  const [memberWork, setMemberWork] = useState<TeamServerMemberWorkStatus | null>(null);
  const [serverStatusError, setServerStatusError] = useState('');
  const [liveSyncHealth, setLiveSyncHealth] = useState<any | null>(null);
  const [liveSyncSelfTest, setLiveSyncSelfTest] = useState<LiveSyncSelfTestResult | null>(null);
  const [liveSyncTesting, setLiveSyncTesting] = useState(false);
  const [aiTakeoverPreview, setAiTakeoverPreview] = useState<AITakeoverPreview | null>(null);
  const [scheduleHistory, setScheduleHistory] = useState<LiveHistoryItem[]>([]);
  const [scheduleHistoryOpen, setScheduleHistoryOpen] = useState(false);
  const [scheduleHistoryLoading, setScheduleHistoryLoading] = useState(false);
  const [scheduleHistoryBusy, setScheduleHistoryBusy] = useState('');
  const [activeSession, setActiveSession] = useState<ActiveWorkSession | null>(() => {
    try {
      const raw = localStorage.getItem('ars-note.team.activeSession');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const newTaskInputRef = useRef<HTMLInputElement>(null);

  const documentPaths = useMemo(() => collectDocumentPaths(fileTree, vaultPath), [fileTree, vaultPath]);
  const documentPathSet = useMemo(() => createDocumentPathSet(documentPaths), [documentPaths]);
  const commandCenterReady = useMemo(() => (
    documentPathSet.has(normalizePath(OBSIDIAN_COMMAND_CENTER_PATH).toLowerCase())
  ), [documentPathSet]);

  const schedulePath = useCallback(async () => {
    return api.joinPath(vaultPath, SCHEDULE_DIR, SCHEDULE_FILE);
  }, [vaultPath]);

  const loadSchedule = useCallback(async () => {
    if (!vaultPath) return;
    setLoading(true);
    try {
      const fullPath = await schedulePath();
      const content = await api.readFile(fullPath);
      setData(normalizeScheduleData(JSON.parse(content), currentMember));
      setSaveState('saved');
    } catch {
      setData(createEmptySchedule(currentMember));
      setSaveState('idle');
    } finally {
      setLoading(false);
    }
  }, [currentMember, schedulePath, vaultPath]);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  useEffect(() => {
    if (currentMember.trim()) localStorage.setItem('ars-note.team.currentMember', currentMember.trim());
    else localStorage.removeItem('ars-note.team.currentMember');
  }, [currentMember]);

  useEffect(() => {
    localStorage.setItem('ars-note.team.focusScope', focusScope);
  }, [focusScope]);

  useEffect(() => {
    if (focusScope !== 'mine') return;
    const rawMember = currentMember.trim();
    if (!rawMember) {
      setFocusScope('team');
      setMemberFilter('all');
      return;
    }
    const member = cleanMemberName(rawMember);
    setMemberFilter(member);
  }, [currentMember, focusScope]);

  useEffect(() => {
    if (activeSession) localStorage.setItem('ars-note.team.activeSession', JSON.stringify(activeSession));
    else localStorage.removeItem('ars-note.team.activeSession');
  }, [activeSession]);

  const persistData = useCallback(async (next: TeamScheduleData) => {
    setSaveState('saving');
    const fullPath = await schedulePath();
    await api.writeFile(fullPath, JSON.stringify(next, null, 2));
    setSaveState('saved');
  }, [schedulePath]);

  const commitData = useCallback((updater: (previous: TeamScheduleData) => TeamScheduleData) => {
    setData((previous) => {
      const next = updater(previous);
      const normalized = normalizeScheduleData({ ...next, updatedAt: nowIso() }, currentMember);
      void persistData(normalized).catch((error) => {
        setSaveState('error');
        setExportMsg(error?.message || '保存团队时间表失败');
      });
      return normalized;
    });
  }, [currentMember, persistData]);

  const refreshServerStatus = useCallback(async (showMessage = false) => {
    if (!vaultPath) return;
    try {
      const [production, work] = await Promise.all([
        api.getTeamServerProductionStatus(vaultPath),
        api.getTeamServerMemberWork(vaultPath, { member: currentMember || undefined, limit: 16 }),
      ]);
      setServerStatus(production);
      setMemberWork(work);
      setServerStatusError('');
      if (showMessage) setExportMsg('服务器团队状态已刷新。');
    } catch (error: any) {
      const message = formatTeamServerError(error);
      setServerStatusError(message);
      setServerStatus(null);
      setMemberWork(null);
      if (showMessage) setExportMsg(message);
    }
  }, [currentMember, vaultPath]);

  useEffect(() => {
    void refreshServerStatus(false);
  }, [refreshServerStatus]);

  const refreshLiveSyncReadiness = useCallback(async (showMessage = false) => {
    if (!vaultPath || !api.liveSyncHealth) return;
    try {
      const health = await api.liveSyncHealth(vaultPath);
      setLiveSyncHealth(health);
      if (showMessage) {
        const readiness = health?.launchReadiness;
        setExportMsg(readiness?.summary || (health?.ok ? '同步就绪状态已刷新。' : '同步就绪状态需要检查。'));
      }
    } catch (error: any) {
      setLiveSyncHealth({ ok: false, serverError: error?.message || '暂时无法读取同步就绪状态' });
      if (showMessage) setExportMsg(error?.message || '暂时无法读取同步就绪状态');
    }
  }, [vaultPath]);

  useEffect(() => {
    void refreshLiveSyncReadiness(false);
  }, [refreshLiveSyncReadiness]);

  const runLiveSyncDeliveryDrill = useCallback(async () => {
    if (!vaultPath || !api.liveSyncSelfTest) return;
    setLiveSyncTesting(true);
    setBusy('sync-drill');
    try {
      const health = await api.liveSyncHealth(vaultPath).catch(() => null);
      if (health) setLiveSyncHealth(health);
      const result = await api.liveSyncSelfTest(vaultPath);
      setLiveSyncSelfTest(result);
      const passed = result.steps.filter((step) => step.ok).length;
      const failed = result.steps.length - passed;
      setExportMsg(result.ok
        ? `同步交付检查已通过：${passed}/${result.steps.length} 项，耗时 ${result.durationMs}ms。`
        : `同步交付检查需要处理：${failed} 项失败，${passed} 项通过。请到同步恢复中心查看详情。`);
    } catch (error: any) {
      setLiveSyncSelfTest(null);
      setExportMsg(error?.message || '同步交付检查失败');
    } finally {
      setLiveSyncTesting(false);
      setBusy('');
    }
  }, [vaultPath]);

  const openServerAdmin = useCallback(async () => {
    const endpoint = serverStatus?.endpoint
      || memberWork?.endpoint
      || liveSyncHealth?.local?.serverUrl
      || liveSyncHealth?.serverUrl
      || '';
    const adminUrl = serverAdminUrlFromEndpoint(endpoint);
    if (!adminUrl) {
      setExportMsg('暂时没有可用的服务器管理地址，请先刷新服务器状态。');
      await Promise.all([
        refreshServerStatus(false),
        refreshLiveSyncReadiness(false),
      ]).catch(() => {});
      return;
    }
    await api.openExternalUrl(adminUrl);
    setExportMsg(`已打开服务器管理页：${adminUrl}`);
  }, [liveSyncHealth, memberWork?.endpoint, refreshLiveSyncReadiness, refreshServerStatus, serverStatus?.endpoint]);

  const refreshScheduleHistory = useCallback(async (showMessage = false) => {
    if (!vaultPath) return;
    setScheduleHistoryLoading(true);
    try {
      const rows = await api.listLiveHistory(vaultPath, SCHEDULE_RELATIVE_PATH);
      setScheduleHistory(rows.slice(0, 8));
      if (showMessage) {
        setExportMsg(rows.length ? `已读取时间表历史：${rows.length} 个快照` : '暂时没有时间表历史快照。');
      }
    } catch (error: any) {
      setScheduleHistory([]);
      if (showMessage) setExportMsg(error?.message || '读取时间表历史失败');
    } finally {
      setScheduleHistoryLoading(false);
    }
  }, [vaultPath]);

  useEffect(() => {
    void refreshScheduleHistory(false);
  }, [refreshScheduleHistory]);

  const restoreScheduleHistory = useCallback(async (item: LiveHistoryItem) => {
    if (!vaultPath) return;
    const confirmed = window.confirm(
      `确定把团队时间表恢复到这个历史快照吗？\n\n时间：${formatLocalDateTime(item.savedAt)}\n来源：${item.reason}\n大小：${bytesToLabel(item.size)}\n\n恢复前会自动再保存当前版本，方便反悔。`,
    );
    if (!confirmed) return;
    setScheduleHistoryBusy(item.versionId);
    try {
      await api.restoreLiveHistory(vaultPath, SCHEDULE_RELATIVE_PATH, item.versionId);
      await loadSchedule();
      await refreshScheduleHistory(false);
      await onRefreshVault?.();
      setExportMsg(`已恢复团队时间表历史：${formatLocalDateTime(item.savedAt)}`);
    } catch (error: any) {
      setExportMsg(error?.message || '恢复团队时间表历史失败');
    } finally {
      setScheduleHistoryBusy('');
    }
  }, [loadSchedule, onRefreshVault, refreshScheduleHistory, vaultPath]);

  const members = useMemo(() => {
    const names = new Set<string>(data.members);
    if (currentMember.trim()) names.add(cleanMemberName(currentMember));
    for (const task of data.tasks) names.add(cleanMemberName(task.owner));
    return Array.from(names).filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [currentMember, data.members, data.tasks]);

  const filteredTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortTasks(data.tasks.filter((task) => {
      if (statusFilter !== 'all' && task.status !== statusFilter) return false;
      if (memberFilter !== 'all' && task.owner !== memberFilter) return false;
      if (!q) return true;
      return [task.title, task.owner, task.linkedDoc, task.deliverable, task.dependency, task.blocker, task.acceptance, task.notes]
        .join(' ')
        .toLowerCase()
        .includes(q);
    }), sortMode);
  }, [data.tasks, memberFilter, query, sortMode, statusFilter]);

  const stats = useMemo(() => {
    const productionTasks = data.tasks.filter((task) => !(commandCenterReady && isBootstrapCommandTask(task)));
    const active = productionTasks.filter((task) => task.status !== 'done');
    return {
      total: productionTasks.length,
      active: active.length,
      done: productionTasks.filter((task) => task.status === 'done').length,
      blocked: active.filter((task) => task.status === 'blocked' || task.blocker.trim()).length,
      overdue: active.filter(isOverdue).length,
      missingDocs: tasksMissingWorkDocs(active, documentPathSet).length,
      missingAcceptance: tasksMissingAcceptance(active).length,
      minutes: productionTasks.reduce((sum, task) => sum + taskSpentMinutes(task), 0),
    };
  }, [commandCenterReady, data.tasks, documentPathSet]);

  const memberLoads = useMemo(() => {
    return members.map((member) => {
      const tasks = data.tasks.filter((task) => task.owner === member && task.status !== 'done');
      const spent = tasks.reduce((sum, task) => sum + taskSpentMinutes(task), 0);
      const remaining = tasks.reduce((sum, task) => sum + Math.max(0, task.estimateMinutes - taskSpentMinutes(task)), 0);
      const high = tasks.filter((task) => task.priority === 'high').length;
      const blocked = tasks.filter((task) => task.status === 'blocked' || task.blocker.trim()).length;
      const overdue = tasks.filter(isOverdue).length;
      const level = blocked || overdue || high >= 3 ? 'danger' : tasks.length >= 5 || high >= 2 ? 'warning' : 'ok';
      return { member, tasks, spent, remaining, high, blocked, overdue, level };
    });
  }, [data.tasks, members]);

  const balanceDraftTasksByLoad = useCallback((draftTasks: NarrativeTaskDraft[]) => {
    type LoadState = {
      member: string;
      openTasks: number;
      remainingMinutes: number;
      high: number;
      blocked: number;
      overdue: number;
      assignedDrafts: number;
    };

    const candidateNames = new Set<string>();
    for (const member of members) {
      const clean = cleanMemberName(member);
      if (!isUnassignedMember(clean)) candidateNames.add(clean);
    }
    for (const summary of memberWork?.memberWork || []) {
      const clean = cleanMemberName(summary.member);
      if (!isUnassignedMember(clean)) candidateNames.add(clean);
    }

    if (candidateNames.size === 0) return { tasks: draftTasks, reassignments: [] as AITakeoverReassignment[] };

    const loadByMember = new Map<string, LoadState>();
    const ensureLoad = (member: string): LoadState => {
      const clean = cleanMemberName(member);
      const existing = loadByMember.get(clean);
      if (existing) return existing;
      const created: LoadState = {
        member: clean,
        openTasks: 0,
        remainingMinutes: 0,
        high: 0,
        blocked: 0,
        overdue: 0,
        assignedDrafts: 0,
      };
      loadByMember.set(clean, created);
      return created;
    };

    for (const member of candidateNames) ensureLoad(member);
    for (const load of memberLoads) {
      if (!candidateNames.has(cleanMemberName(load.member))) continue;
      const target = ensureLoad(load.member);
      target.openTasks = Math.max(target.openTasks, load.tasks.length);
      target.remainingMinutes = Math.max(target.remainingMinutes, load.remaining);
      target.high = Math.max(target.high, load.high);
      target.blocked = Math.max(target.blocked, load.blocked);
      target.overdue = Math.max(target.overdue, load.overdue);
    }
    for (const summary of memberWork?.memberWork || []) {
      if (!candidateNames.has(cleanMemberName(summary.member))) continue;
      const target = ensureLoad(summary.member);
      target.openTasks = Math.max(target.openTasks, Number(summary.activeTasks || 0));
      target.remainingMinutes = Math.max(target.remainingMinutes, Number(summary.activeTasks || 0) * 60);
      target.blocked = Math.max(target.blocked, Number(summary.blockedTasks || 0));
      target.overdue = Math.max(target.overdue, Number(summary.overdueTasks || 0));
    }

    const sortedCandidates = () => Array.from(loadByMember.values()).sort((a, b) => {
      const scoreDelta = loadRiskScore(a) - loadRiskScore(b);
      return scoreDelta || a.member.localeCompare(b.member, 'zh-CN');
    });

    const reassignments: AITakeoverReassignment[] = [];
    const balancedTasks = draftTasks.map((rawTask) => {
      const task: NarrativeTaskDraft = { ...rawTask };
      const originalOwner = cleanMemberName(String(task.owner || ''));
      const best = sortedCandidates()[0];
      if (!best) return task;

      const current = loadByMember.get(originalOwner);
      const currentScore = current ? loadRiskScore(current) : Number.POSITIVE_INFINITY;
      const bestScore = loadRiskScore(best);
      const currentIsDanger = !!current && (current.blocked > 0 || current.overdue > 0 || current.high >= 3 || current.openTasks >= 6);
      const bestIsMeaningfullySafer = current && best.member !== originalOwner && best.blocked === 0 && best.overdue === 0 && bestScore + 120 < currentScore;

      let targetOwner = originalOwner;
      let reason = '';
      if (isUnassignedMember(task.owner)) {
        targetOwner = best.member;
        reason = '原任务未分配，按成员负载自动分配';
      } else if (!current) {
        targetOwner = best.member;
        reason = `负责人 ${originalOwner} 不在当前成员/服务器成员列表，按负载改派`;
      } else if (currentIsDanger && bestIsMeaningfullySafer) {
        targetOwner = best.member;
        reason = '原负责人已处于高风险负载，改派给当前更空的成员';
      }

      const targetLoad = loadByMember.get(targetOwner) || best;
      if (targetOwner !== originalOwner) {
        task.owner = targetOwner;
        reassignments.push({
          title: cleanTaskKeyText(task.title || task.deliverable) || '未命名任务',
          fromOwner: originalOwner,
          toOwner: targetOwner,
          reason,
          projectedLoad: `${targetOwner}: ${targetLoad.openTasks + 1} 个活跃 / 剩余 ${minutesToLabel(targetLoad.remainingMinutes + projectedTaskMinutes(task))}`,
        });
      }

      targetLoad.openTasks += 1;
      targetLoad.remainingMinutes += projectedTaskMinutes(task);
      targetLoad.assignedDrafts += 1;
      if (normalizePriority(task.priority) === 'high') targetLoad.high += 1;
      return task;
    });

    return { tasks: balancedTasks, reassignments };
  }, [memberLoads, memberWork?.memberWork, members]);

  const serverWarning = useMemo(() => {
    const teamWarnings = serverStatus?.team?.warnings || [];
    return teamWarnings[0] || (serverStatus as any)?.warnings?.[0] || (serverStatus as any)?.coordinationAdvice?.[0] || '';
  }, [serverStatus]);

  const aiMemoryRemoteCoverage = useMemo(() => {
    const team: any = serverStatus?.team || serverStatus?.sourceFiles || null;
    const coreFiles = Array.isArray(team?.aiMemoryCoreFiles) ? team.aiMemoryCoreFiles : [];
    const coreTotal = coreFiles.length || 3;
    const coreSynced = coreFiles.filter((file: { synced?: boolean }) => file?.synced).length;
    const files = Number(team?.aiMemoryFiles || 0);
    const skills = Number(team?.aiSkills || 0);
    const manifest = Boolean(team?.aiMemoryManifestSynced || serverStatus?.sourceFiles?.aiMemoryManifest);
    const missingCore = Number(team?.missingAiMemoryCoreFiles ?? Math.max(0, coreTotal - coreSynced));
    const ok = Boolean(serverStatus?.ok && files > 0 && manifest && missingCore === 0);
    const level = !serverStatus ? 'unknown' : ok ? (skills > 0 ? 'ok' : 'warning') : 'danger';
    const title = !serverStatus
      ? '未读取'
      : ok
        ? (skills > 0 ? '可继承' : '记忆可继承，暂无 skill')
        : '未完整同步';
    const detail = serverStatus
      ? `核心 ${coreSynced}/${coreTotal} · Skills ${skills} · 文件 ${files} · Manifest ${manifest ? '已同步' : '缺失'}`
      : '刷新服务器状态后显示远端 AI 记忆/skill 覆盖。';
    return { level, title, detail };
  }, [serverStatus]);

  const recentLogs = useMemo(() => {
    return data.tasks.flatMap((task) => task.logs.map((log) => ({
      ...log,
      taskTitle: task.title,
      linkedDoc: task.linkedDoc,
    }))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40);
  }, [data.tasks]);

  const activeTasks = useMemo(() => (
    data.tasks.filter((task) => task.status !== 'done' && !(commandCenterReady && isBootstrapCommandTask(task)))
  ), [commandCenterReady, data.tasks]);

  const myOpenTasks = useMemo(() => {
    const member = currentMember.trim();
    if (!member) return [];
    const normalizedMember = cleanMemberName(member);
    return sortTasks(activeTasks.filter((task) => cleanMemberName(task.owner) === normalizedMember), sortMode).slice(0, 6);
  }, [activeTasks, currentMember, sortMode]);

  const focusTasks = useMemo(() => {
    const rawMember = currentMember.trim();
    const member = rawMember ? cleanMemberName(rawMember) : '';
    const candidates = focusScope === 'mine' && member
      ? activeTasks.filter((task) => cleanMemberName(task.owner) === member)
      : activeTasks;
    const important = candidates.filter((task) => (
      task.status === 'blocked' ||
      task.status === 'review' ||
      task.priority === 'high' ||
      isOverdue(task) ||
      task.dueDate === todayString() ||
      taskDocStatus(task, documentPathSet) !== 'linked'
    ));
    return sortTasks(important.length ? important : candidates, 'dueAsc').slice(0, 8);
  }, [activeTasks, currentMember, documentPathSet, focusScope]);

  const nextTask = useMemo(() => {
    return focusTasks[0] || null;
  }, [focusTasks]);

  const saveStateLabel = saveState === 'saving'
    ? '保存中'
    : saveState === 'saved'
      ? '已保存'
      : saveState === 'error'
        ? '保存失败'
        : '未保存';
  const serverStatusLabel = serverStatus?.ok ? '在线' : serverStatusError ? '不可达' : serverStatus ? '有异常' : '未读取';
  const highRiskMemberCount = memberLoads.filter((item) => item.level === 'danger').length;
  const currentMemberLoad = currentMember
    ? memberLoads.find((item) => cleanMemberName(item.member) === cleanMemberName(currentMember))
    : null;
  const serverAdminUrl = serverAdminUrlFromEndpoint(
    serverStatus?.endpoint || memberWork?.endpoint || liveSyncHealth?.local?.serverUrl || liveSyncHealth?.serverUrl || '',
  );
  const syncReadinessStatus = liveSyncSelfTest
    ? (liveSyncSelfTest.ok ? 'ok' : 'danger')
    : liveSyncHealth?.launchReadiness?.status === 'blocked'
      ? 'danger'
      : liveSyncHealth?.launchReadiness?.status === 'warning' || liveSyncHealth?.degraded
        ? 'warning'
        : liveSyncHealth?.ok
          ? 'ok'
          : 'unknown';
  const deliveryReadinessItems = useMemo(() => {
    const syncDetail = liveSyncSelfTest
      ? `${liveSyncSelfTest.steps.filter((step) => step.ok).length}/${liveSyncSelfTest.steps.length} 项检查通过`
      : liveSyncHealth?.launchReadiness?.summary || liveSyncHealth?.diagnosticWarning || liveSyncHealth?.serverError || '交付前运行一次同步检查。';
    return [
      {
        key: 'sync',
        title: '同步安全',
        state: syncReadinessStatus,
        detail: syncDetail,
      },
      {
        key: 'server',
        title: '团队服务器',
        state: serverStatus?.ok ? 'ok' : serverStatusError ? 'danger' : 'warning',
        detail: serverStatus?.ok
          ? `${serverStatus.onlineClients?.length || 0} 台在线设备 · ${serverStatus.liveFileCount || 0} 个实时文件`
          : serverStatusError || '刷新服务器状态并核对 Vault ID。',
      },
      {
        key: 'workspace',
        title: '团队工作区',
        state: commandCenterReady && stats.total > 0 ? 'ok' : 'warning',
        detail: commandCenterReady
          ? `${stats.total} 个任务 · ${stats.active} 个推进中 · ${stats.done} 个完成`
          : '初始化 Ars-note 团队制作台和工作看板。',
      },
      {
        key: 'docs',
        title: '任务文档',
        state: stats.missingDocs === 0 && stats.missingAcceptance === 0 ? 'ok' : 'warning',
        detail: `${stats.missingDocs} 个缺文档 · ${stats.missingAcceptance} 个缺验收标准`,
      },
      {
        key: 'flow',
        title: '制作流程',
        state: stats.blocked || stats.overdue || highRiskMemberCount ? 'danger' : 'ok',
        detail: `${stats.blocked} 个阻塞 · ${stats.overdue} 个逾期 · ${highRiskMemberCount} 个成员超负载`,
      },
      {
        key: 'ai',
        title: 'AI 记忆与 Skill',
        state: aiMemoryRemoteCoverage.level,
        detail: aiMemoryRemoteCoverage.detail,
      },
    ] as Array<{ key: string; title: string; state: 'ok' | 'warning' | 'danger' | 'unknown'; detail: string }>;
  }, [aiMemoryRemoteCoverage.detail, aiMemoryRemoteCoverage.level, commandCenterReady, highRiskMemberCount, liveSyncHealth, liveSyncSelfTest, serverStatus, serverStatusError, stats, syncReadinessStatus]);
  const deliveryDangerCount = deliveryReadinessItems.filter((item) => item.state === 'danger').length;
  const deliveryWarningCount = deliveryReadinessItems.filter((item) => item.state === 'warning' || item.state === 'unknown').length;
  const deliveryReadyCount = deliveryReadinessItems.filter((item) => item.state === 'ok').length;
  const deliveryReadinessLevel = deliveryDangerCount ? 'danger' : deliveryWarningCount ? 'warning' : 'ok';
  const deliveryReadinessTitle = deliveryReadinessLevel === 'ok'
    ? '可以交接'
    : deliveryReadinessLevel === 'warning'
      ? '检查后交接'
      : '暂缓交接';

  const updateTask = (taskId: string, patch: Partial<TeamScheduleTask>) => {
    commitData((previous) => ({
      ...previous,
      tasks: previous.tasks.map((task) => task.id === taskId ? { ...task, ...patch, updatedAt: nowIso() } : task),
    }));
  };

  const addTask = () => {
    const title = newTitle.trim();
    if (!title) return;
    const owner = cleanMemberName(newOwner || currentMember);
    const task: TeamScheduleTask = {
      id: uid('task'),
      title,
      owner,
      status: 'todo',
      priority: 'medium',
      startDate: todayString(),
      dueDate: newDue,
      estimateMinutes: 0,
      linkedDoc: normalizePath(newDoc),
      deliverable: '',
      dependency: '',
      blocker: '',
      acceptance: '',
      notes: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      logs: [],
      reviewLogs: [],
    };
    commitData((previous) => ({ ...previous, members: [...previous.members, owner], tasks: [task, ...previous.tasks] }));
    setNewTitle('');
    setNewOwner('');
    setNewDoc('');
    setNewDue('');
  };

  const deleteTask = (taskId: string) => {
    commitData((previous) => ({
      ...previous,
      tasks: previous.tasks.filter((task) => task.id !== taskId),
      deletedTaskIds: [...(previous.deletedTaskIds || []), taskId].slice(-500),
    }));
  };

  const addLogWithValues = (task: TeamScheduleTask, minutesValue: number | string, noteValue: string) => {
    const minutes = Math.max(1, Math.round(Number(minutesValue) || 0));
    if (!minutes) return;
    const member = cleanMemberName(currentMember || task.owner);
    const log: TeamTimeLog = {
      id: uid('log'),
      member,
      date: todayString(),
      minutes,
      note: String(noteValue || '').trim(),
      createdAt: nowIso(),
    };
    commitData((previous) => ({
      ...previous,
      members: [...previous.members, member],
      tasks: previous.tasks.map((item) => item.id === task.id
        ? { ...item, status: item.status === 'todo' ? 'doing' : item.status, logs: [log, ...item.logs], updatedAt: nowIso() }
        : item),
    }));
    setTimeInputs((previous) => ({ ...previous, [task.id]: { minutes: '30', note: '' } }));
  };

  const addLog = (task: TeamScheduleTask) => {
    const input = timeInputs[task.id] || { minutes: '30', note: '' };
    addLogWithValues(task, input.minutes, input.note);
  };

  const addReviewLog = (task: TeamScheduleTask, result: TeamReviewResult) => {
    const reviewer = cleanMemberName(currentMember || task.owner);
    const review: TeamReviewLog = {
      id: uid('review'),
      reviewer,
      date: todayString(),
      result,
      note: '',
      createdAt: nowIso(),
    };
    commitData((previous) => ({
      ...previous,
      members: [...previous.members, reviewer],
      tasks: previous.tasks.map((item) => item.id === task.id
        ? {
          ...item,
          status: result === 'approved' ? 'done' : result === 'changes' ? 'doing' : item.status,
          reviewLogs: [review, ...item.reviewLogs],
          updatedAt: nowIso(),
        }
        : item),
    }));
  };

  const applyGeneratedTaskSchedule = async (content: unknown): Promise<TeamScheduleData | null> => {
    if (typeof content !== 'string' || !content.trim()) return null;
    const next = normalizeScheduleData(JSON.parse(content), currentMember);
    setData(next);
    setSaveState('saved');
    return next;
  };

  const refreshTaskWorkDocsFromMain = async () => {
    const generated = await api.generateTeamProductionDocs(vaultPath, productionDocSubset({ includeTaskDocs: true }));
    const taskDocs = generated?.summary?.taskDocs || {};
    const schedule = await applyGeneratedTaskSchedule(taskDocs.content);
    if (!schedule) await loadSchedule();
    await onRefreshVault?.();
    return { generated, taskDocs, schedule };
  };

  const ensureTaskDocument = async (task: TeamScheduleTask): Promise<{ relativePath: string; created: boolean } | null> => {
    const relativePath = normalizeTaskDocPath(task.linkedDoc, task.title);
    if (taskDocStatus({ ...task, linkedDoc: relativePath }, documentPathSet) === 'linked') {
      if (task.linkedDoc !== relativePath) updateTask(task.id, { linkedDoc: relativePath });
      return { relativePath, created: false };
    }
    const { generated, taskDocs, schedule } = await refreshTaskWorkDocsFromMain();
    const refreshed = schedule?.tasks.find((item) => item.id === task.id);
    const nextRelativePath = normalizeTaskDocPath(refreshed?.linkedDoc || relativePath, task.title);
    const generatedPaths = new Set<string>([
      ...((Array.isArray(generated?.paths) ? generated.paths : []) as string[]),
      ...((Array.isArray(taskDocs?.paths) ? taskDocs.paths : []) as string[]),
    ].map((item) => normalizePath(item).toLowerCase()));
    const created = Number(taskDocs?.createdCount || 0) > 0 && generatedPaths.has(nextRelativePath.toLowerCase());
    return { relativePath: nextRelativePath, created };
  };

  const createOrOpenTaskDoc = async (task: TeamScheduleTask) => {
    setBusy(`doc-${task.id}`);
    try {
      const result = await ensureTaskDocument(task);
      if (result?.relativePath) onOpenFile(result.relativePath);
      setExportMsg(result?.created ? `已创建任务文档：${result.relativePath}` : `已打开任务文档：${result?.relativePath || task.linkedDoc}`);
    } catch (error: any) {
      setExportMsg(error?.message || '生成任务文档失败');
    } finally {
      setBusy('');
    }
  };

  const generateMissingTaskDocs = async () => {
    setBusy('task-docs');
    try {
      const targets = tasksMissingWorkDocs(data.tasks, documentPathSet);
      const { taskDocs } = await refreshTaskWorkDocsFromMain();
      const changedPaths = Array.isArray(taskDocs.paths) ? taskDocs.paths as string[] : [];
      setExportMsg([
        `已处理 ${targets.length} 个缺任务文档任务`,
        `新建 ${Number(taskDocs.createdCount || 0)} 个`,
        `关联 ${Number(taskDocs.linkedCount || 0)} 个`,
        `升级 ${Number(taskDocs.upgradedCount || 0)} 个`,
        changedPaths.length ? `示例：${changedPaths.slice(0, 3).join('、')}` : '',
      ].filter(Boolean).join('；'));
    } catch (error: any) {
      setExportMsg(error?.message || '补齐任务文档失败');
    } finally {
      setBusy('');
    }
  };

  const syncLinkedTaskDocs = async () => {
    setBusy('sync-docs');
    try {
      const result = await api.syncTeamTaskDocs(vaultPath, currentMember || undefined);
      const next = normalizeScheduleData(JSON.parse(result.content), currentMember);
      setData(next);
      setSaveState('saved');
      await onRefreshVault?.();
      setExportMsg(`同步任务文档完成：扫描 ${result.scannedCount}，变更 ${result.changedCount}，新增工时 ${result.addedLogCount}，新增验收 ${result.addedReviewCount}。`);
    } catch (error: any) {
      setExportMsg(error?.message || '同步任务文档失败');
    } finally {
      setBusy('');
    }
  };

  const refreshProductionDocsAndOpen = async (label: string, targetPath: string, options: TeamProductionDocOptions) => {
    setBusy(label);
    try {
      const generated = await api.generateTeamProductionDocs(vaultPath, options);
      await onRefreshVault?.();
      setExportMsg(`已刷新 ${generated.paths.length} 个团队文档。`);
      onOpenFile(targetPath);
    } catch (error: any) {
      setExportMsg(error?.message || '刷新团队文档失败');
    } finally {
      setBusy('');
    }
  };

  const syncAiMemoryNow = async () => {
    setBusy('ai-memory-sync');
    try {
      const result = await api.aiSyncNow(vaultPath);
      await refreshServerStatus();
      const pulled = Number(result.pulledFileCount || 0);
      const pushed = Number(result.pushedFileCount || 0);
      const conflicts = Number(result.conflictCount || 0);
      setExportMsg(`AI 记忆和 Skill 已双向同步：拉取 ${pulled} 个文件，上传 ${pushed} 个文件${conflicts > 0 ? `，冲突 ${conflicts} 个` : ''}。`);
    } catch (error: any) {
      setExportMsg(error?.message || 'AI 记忆同步失败');
    } finally {
      setBusy('');
    }
  };

  const bootstrapWorkspace = async () => {
    setBusy('bootstrap');
    try {
      const result = await api.bootstrapTeamWorkspace(vaultPath, { currentMember: currentMember || undefined, limit: 48 });
      const content = result.content || result.upsert?.content;
      if (content) setData(normalizeScheduleData(JSON.parse(content), currentMember));
      await onRefreshVault?.();
      setExportMsg(`团队工作台已准备好：任务 ${result.taskCount}，生成文档 ${result.productionDocs?.paths?.length || 0} 个。`);
    } catch (error: any) {
      setExportMsg(error?.message || '初始化团队工作台失败');
    } finally {
      setBusy('');
    }
  };

  const importCurrentDocumentTasks = async () => {
    if (!onImportCurrentDocumentTasks) return;
    setBusy('import-current');
    try {
      const result = await onImportCurrentDocumentTasks();
      await loadSchedule();
      await onRefreshVault?.();
      setExportMsg(`从当前文档导入：识别 ${result.extractedCount}，新增 ${result.importedCount}，更新 ${result.updatedCount || 0}，跳过 ${result.skippedCount}。`);
    } catch (error: any) {
      setExportMsg(error?.message || '导入当前文档任务失败');
    } finally {
      setBusy('');
    }
  };

  const draftNarrativeTasks = async (upsert: boolean) => {
    setBusy(upsert ? 'draft-upsert' : 'draft');
    try {
      if (upsert && !window.confirm('AI 将把叙事草稿写入团队时间表。建议优先使用“预演 AI 接管”查看会新增/更新哪些任务。确定继续吗？')) {
        return;
      }
      const result = await api.draftNarrativeTasks(vaultPath, { limit: 40, includeQa: true, upsert, sourceLabel: '叙事导演' });
      if (result.upsert?.content) setData(normalizeScheduleData(JSON.parse(result.upsert.content), currentMember));
      if (result.upsert) setAiTakeoverPreview(null);
      await api.generateTeamProductionDocs(vaultPath, allProductionDocs());
      await onRefreshVault?.();
      setExportMsg(`叙事任务草稿 ${result.tasks.length} 个${result.upsert ? `，写入 ${result.upsert.importedCount + result.upsert.updatedCount} 个` : ''}。`);
    } catch (error: any) {
      setExportMsg(error?.message || '生成叙事任务失败');
    } finally {
      setBusy('');
    }
  };

  const previewAiTakeoverSchedule = async () => {
    setBusy('ai-takeover-preview');
    try {
      const drafted = await api.draftNarrativeTasks(vaultPath, {
        limit: 60,
        includeQa: true,
        upsert: false,
        sourceLabel: 'AI 接管时间表预演',
      });
      const rawTasks = Array.isArray(drafted.tasks) ? drafted.tasks : [];
      const { tasks, reassignments } = balanceDraftTasksByLoad(rawTasks);
      const existingKeys = new Set(data.tasks.map(teamScheduleTaskKey));
      const ownerDraftCounts = new Map<string, number>();
      let importedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      for (const task of tasks) {
        const title = cleanTaskKeyText(task.title || task.deliverable);
        if (!title) {
          skippedCount += 1;
          continue;
        }
        const owner = cleanMemberName(task.owner || '未分配');
        const key = teamScheduleTaskKey({ title, owner, linkedDoc: task.linkedDoc });
        if (existingKeys.has(key)) updatedCount += 1;
        else importedCount += 1;
        ownerDraftCounts.set(owner, (ownerDraftCounts.get(owner) || 0) + 1);
      }

      const affectedOwners: AITakeoverPreviewOwner[] = Array.from(ownerDraftCounts.entries()).map(([member, draftCount]) => {
        const load = memberLoads.find((item) => cleanMemberName(item.member) === cleanMemberName(member));
        const openTasks = load?.tasks.length || 0;
        const remainingMinutes = load?.remaining || 0;
        const high = load?.high || 0;
        const blocked = load?.blocked || 0;
        const overdue = load?.overdue || 0;
        const level: AITakeoverPreviewOwner['level'] = load?.level === 'danger' || draftCount >= 5 || blocked > 0 || overdue > 0
          ? 'danger'
          : load?.level === 'warning' || draftCount >= 3 || openTasks + draftCount >= 5 || high >= 2
            ? 'warning'
            : 'ok';
        return { member, draftCount, openTasks, remainingMinutes, high, blocked, overdue, level };
      }).sort((a, b) => {
        const rank = { danger: 0, warning: 1, ok: 2 };
        return rank[a.level] - rank[b.level] || b.draftCount - a.draftCount || a.member.localeCompare(b.member, 'zh-CN');
      });

      const warnings: string[] = [];
      if (tasks.length === 0) warnings.push('这次没有生成可接管的任务，先检查叙事/任务文档是否已经足够完整。');
      if (serverStatusError) warnings.push(`服务器状态暂不可确认：${serverStatusError}`);
      else if (!serverStatus?.ok) warnings.push('尚未确认服务器生产状态，执行前建议刷新服务器状态，避免团队看到旧任务表。');
      if (highRiskMemberCount > 0) warnings.push(`当前已有 ${highRiskMemberCount} 个成员处于高风险负载，AI 分配前需要人工看一眼。`);
      const overloaded = affectedOwners.filter((owner) => owner.level === 'danger');
      if (overloaded.length > 0) warnings.push(`预演会继续影响高风险成员：${overloaded.slice(0, 4).map((owner) => owner.member).join('、')}。`);
      if (reassignments.length > 0) warnings.push(`AI 已按成员负载自动改派 ${reassignments.length} 个草稿任务，执行前请确认负责人是否合理。`);
      if (importedCount + updatedCount > 30) warnings.push('本次计划写入的任务较多，建议先分批执行或先处理阻塞/逾期任务。');

      const result: NarrativeTaskDraftResult = { ...drafted, tasks };
      setAiTakeoverPreview({
        checkedAt: nowIso(),
        result,
        importedCount,
        updatedCount,
        skippedCount,
        warnings,
        affectedOwners,
        reassignments,
      });
      setExportMsg(`AI 接管预演完成：预计新增 ${importedCount} 个，更新 ${updatedCount} 个，跳过 ${skippedCount} 个，负载改派 ${reassignments.length} 个。确认后再执行写入。`);
    } catch (error: any) {
      setExportMsg(error?.message || 'AI 接管预演失败');
      setAiTakeoverPreview(null);
    } finally {
      setBusy('');
    }
  };

  const aiTakeoverSchedule = async () => {
    if (!aiTakeoverPreview) {
      await previewAiTakeoverSchedule();
      return;
    }
    const changeCount = aiTakeoverPreview.importedCount + aiTakeoverPreview.updatedCount;
    if (changeCount <= 0) {
      setExportMsg('当前预演没有可写入/更新的任务，未执行 AI 接管。');
      return;
    }
    const confirmed = window.confirm(
      `AI 将按刚才的预演写入团队时间表：新增 ${aiTakeoverPreview.importedCount} 个，更新 ${aiTakeoverPreview.updatedCount} 个，负载改派 ${aiTakeoverPreview.reassignments.length} 个。\n\n` +
      '执行前会先同步任务文档，写入后会刷新团队生产文档。确定继续吗？',
    );
    if (!confirmed) return;
    setBusy('ai-takeover');
    let syncSummary = '';
    try {
      try {
        const synced = await api.syncTeamTaskDocs(vaultPath, currentMember || undefined);
        if (synced.content) setData(normalizeScheduleData(JSON.parse(synced.content), currentMember));
        syncSummary = `任务文档同步：扫描 ${synced.scannedCount}，变更 ${synced.changedCount}`;
      } catch (syncError: any) {
        syncSummary = `任务文档同步跳过：${formatTeamServerError(syncError)}`;
      }
      const upserted = await api.upsertTeamTasks(vaultPath, aiTakeoverPreview.result.tasks as NarrativeTaskDraft[], 'AI 接管时间表');
      if (upserted.content) setData(normalizeScheduleData(JSON.parse(upserted.content), currentMember));
      const generated = await api.generateTeamProductionDocs(vaultPath, allProductionDocs());
      await refreshServerStatus(false);
      await onRefreshVault?.();
      const changed = (upserted.importedCount || 0) + (upserted.updatedCount || 0);
      setAiTakeoverPreview(null);
      setExportMsg(`AI 接管时间表完成：${syncSummary}；新增 ${upserted.importedCount} 个，更新 ${upserted.updatedCount} 个，跳过 ${upserted.skippedCount} 个；刷新 ${generated.paths.length} 个团队文档。`);
    } catch (error: any) {
      setExportMsg(error?.message || 'AI 接管时间表失败');
    } finally {
      setBusy('');
    }
  };

  const exportSchedule = async (kind: 'json' | 'csv' | 'report') => {
    try {
      const defaultName = kind === 'json' ? 'team-schedule.json' : kind === 'csv' ? 'team-schedule.csv' : 'team-schedule-report.md';
      const target = await api.showSaveDialog(defaultName);
      if (!target) return;
      const content = kind === 'json'
        ? JSON.stringify(data, null, 2)
        : kind === 'csv'
          ? buildScheduleCsv(filteredTasks)
          : buildScheduleReport(data, filteredTasks, documentPaths);
      await api.writeFile(target, content);
      setExportMsg(`已导出：${target}`);
    } catch (error: any) {
      setExportMsg(error?.message || '导出失败');
    }
  };

  const startTimer = (task: TeamScheduleTask) => {
    setActiveSession({
      taskId: task.id,
      taskTitle: task.title,
      member: cleanMemberName(currentMember || task.owner),
      startedAt: nowIso(),
      note: '',
    });
  };

  const stopTimer = (taskId: string) => {
    if (!activeSession || activeSession.taskId !== taskId) return;
    const started = new Date(activeSession.startedAt).getTime();
    const minutes = Math.max(1, Math.round((Date.now() - started) / 60000));
    const task = data.tasks.find((item) => item.id === taskId);
    if (task) {
      addLogWithValues(task, minutes, activeSession.note || '计时记录');
    }
    setActiveSession(null);
  };

  const renderStatusPill = (task: TeamScheduleTask) => (
    <span className={`team-doc-status ${taskDocStatus(task, documentPathSet)}`}>
      {taskDocStatus(task, documentPathSet) === 'linked' ? '文档已连接' : taskDocStatus(task, documentPathSet) === 'missing' ? '文档缺失' : '未指定文档'}
    </span>
  );

  const renderFocusTaskCard = (task: TeamScheduleTask, featured = false) => {
    const input = timeInputs[task.id] || { minutes: '30', note: '' };
    const spent = taskSpentMinutes(task);
    const progress = taskProgressPercent(task);
    const timing = activeSession?.taskId === task.id;
    const latestLog = task.logs[0];
    return (
      <article key={task.id} className={`team-focus-task-card ${featured ? 'featured' : ''} ${taskUrgencyClass(task)} status-${task.status}`}>
        <div className="team-focus-task-main">
          <div className="team-focus-task-title">
            <span className={`team-priority-pill priority-${task.priority}`}>{PRIORITY_LABELS[task.priority]}</span>
            <strong>{task.title}</strong>
          </div>
          <p>{task.deliverable || task.acceptance || task.notes || '还没有交付说明。可以在“明细”里补充验收标准。'}</p>
          <div className="team-focus-task-meta">
            <span>{task.owner || '未分配'}</span>
            <span className={isOverdue(task) ? 'danger' : task.dueDate === todayString() ? 'warning' : ''}>{taskDueLabel(task)}</span>
            <span>{STATUS_LABELS[task.status]}</span>
            <span>{minutesToLabel(spent)} / {task.estimateMinutes ? minutesToLabel(task.estimateMinutes) : '未估算'}</span>
            {renderStatusPill(task)}
          </div>
          {(task.blocker || task.dependency) && (
            <div className="team-focus-risk-line">
              {task.blocker && <span>阻塞：{task.blocker}</span>}
              {task.dependency && <span>依赖：{task.dependency}</span>}
            </div>
          )}
          <div className="team-focus-progress" aria-label={`任务进度 ${progress}%`}>
            <i style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div className="team-focus-task-actions">
          <div className="team-focus-primary-actions">
            <select value={task.status} onChange={(event) => updateTask(task.id, { status: event.target.value as TeamTaskStatus })} aria-label="任务状态">
              {STATUS_ORDER.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
            </select>
            <button type="button" onClick={() => void createOrOpenTaskDoc(task)} disabled={busy === `doc-${task.id}`}>
              <FileIcon size={12} /> {taskDocStatus(task, documentPathSet) === 'linked' ? '打开文档' : '生成文档'}
            </button>
            {timing
              ? <button type="button" className="team-timer-stop" onClick={() => stopTimer(task.id)}>结束计时</button>
              : <button type="button" className="team-timer-start" disabled={!!activeSession} onClick={() => startTimer(task)}><ClockIcon size={12} /> 开始工作</button>}
            <button type="button" className="team-focus-done-btn" disabled={task.status === 'review'} onClick={() => updateTask(task.id, { status: 'review' })}>
              {task.status === 'review' ? '等待验收' : '提交验收'}
            </button>
          </div>
          <details className="team-focus-log-details">
            <summary>{latestLog ? `补记工时 · 最近 ${minutesToLabel(latestLog.minutes)}` : '补记工时'}</summary>
            <div className="team-focus-log-row">
              <input type="number" min={1} step={15} value={input.minutes} onChange={(event) => setTimeInputs((previous) => ({ ...previous, [task.id]: { ...input, minutes: event.target.value } }))} aria-label="本次用时（分钟）" />
              <input value={input.note} onChange={(event) => setTimeInputs((previous) => ({ ...previous, [task.id]: { ...input, note: event.target.value } }))} placeholder="刚做了什么" />
              <button type="button" onClick={() => addLog(task)}>记入工时</button>
            </div>
          </details>
        </div>
      </article>
    );
  };

  return (
    <section className="team-schedule-panel">
      <header className="team-schedule-header team-workbench-header">
        <div className="team-header-copy">
          <span className="team-panel-eyebrow">今日工作</span>
          <h2>团队工作台</h2>
          <p>先看自己的下一项，打开关联文档开始工作，结束后记录用时并提交验收。</p>
        </div>
        <div className="team-header-actions team-header-actions-clean">
          <label className="team-header-member">
            <span>当前成员</span>
            <input value={currentMember} onChange={(event) => setCurrentMember(event.target.value)} placeholder="填写你的名字" list="team-members" />
          </label>
          <button className="team-primary-action" type="button" onClick={() => {
            newTaskInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            newTaskInputRef.current?.focus();
          }}><PlusIcon size={14} /> 新建任务</button>
          <button className="team-secondary-action" type="button" onClick={() => void loadSchedule()} disabled={loading}><RefreshIcon size={14} /> 刷新</button>
          <details className="team-more-actions">
            <summary>更多操作</summary>
            <div className="team-more-actions-panel">
              <button type="button" onClick={() => void bootstrapWorkspace()} disabled={!!busy}>初始化团队工作台</button>
              <button type="button" onClick={() => void syncLinkedTaskDocs()} disabled={!!busy}>同步任务文档</button>
              <button type="button" onClick={() => void generateMissingTaskDocs()} disabled={!!busy}>补齐任务文档</button>
              <button type="button" onClick={() => void refreshServerStatus(true)}>刷新服务器状态</button>
              <button type="button" onClick={() => {
                const nextOpen = !scheduleHistoryOpen;
                setScheduleHistoryOpen(nextOpen);
                if (nextOpen) void refreshScheduleHistory(true);
              }} disabled={scheduleHistoryLoading}>
                {scheduleHistoryOpen ? '隐藏时间表历史' : '查看时间表历史'}
              </button>
              <button type="button" onClick={() => void syncAiMemoryNow()} disabled={busy === 'ai-memory-sync'}>{busy === 'ai-memory-sync' ? '同步中...' : '同步记忆和 Skill'}</button>
            </div>
          </details>
        </div>
      </header>

      {scheduleHistoryOpen && (
        <section className="team-schedule-history-panel" aria-label="团队时间表历史">
          <header>
            <div>
              <span className="team-panel-eyebrow">Schedule Recovery</span>
              <strong>时间表历史快照</strong>
              <small>每次覆盖保存前都会留下快照，恢复前也会再保存当前版本。</small>
            </div>
            <button type="button" onClick={() => void refreshScheduleHistory(true)} disabled={scheduleHistoryLoading}>
              <RefreshIcon size={14} /> {scheduleHistoryLoading ? '读取中' : '刷新历史'}
            </button>
          </header>
          {scheduleHistory.length === 0 ? (
            <div className="team-schedule-history-empty">
              {scheduleHistoryLoading ? '正在读取时间表历史...' : '暂时没有可恢复的时间表历史。保存或 AI 写入后会自动生成。'}
            </div>
          ) : (
            <div className="team-schedule-history-list">
              {scheduleHistory.map((item) => (
                <article key={item.versionId} className="team-schedule-history-item">
                  <div>
                    <strong>{formatLocalDateTime(item.savedAt)}</strong>
                    <span>{item.reason || 'local-save'} · {bytesToLabel(item.size)}</span>
                    <small>{item.versionId}</small>
                  </div>
                  <button type="button" onClick={() => void restoreScheduleHistory(item)} disabled={!!scheduleHistoryBusy}>
                    {scheduleHistoryBusy === item.versionId ? '恢复中' : '恢复这个版本'}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="team-status-overview" aria-label="团队时间表状态总览">
        <article className={`team-status-card save-${saveState}`}>
          <span>保存</span>
          <strong>{saveStateLabel}</strong>
          <small>{stats.total} 个任务 · {minutesToLabel(stats.minutes)}</small>
        </article>
        <article className="team-status-card">
          <span>进度</span>
          <strong>{stats.done}/{stats.total}</strong>
          <small>{stats.active} 个待推进</small>
        </article>
        <article className={`team-status-card ${stats.blocked || stats.overdue ? 'danger' : 'ok'}`}>
          <span>风险</span>
          <strong>{stats.blocked + stats.overdue}</strong>
          <small>{stats.blocked} 阻塞 · {stats.overdue} 逾期</small>
        </article>
        <article className={`team-status-card ${stats.missingDocs || stats.missingAcceptance ? 'warning' : 'ok'}`}>
          <span>闭环</span>
          <strong>{stats.missingDocs + stats.missingAcceptance}</strong>
          <small>{stats.missingDocs} 缺文档 · {stats.missingAcceptance} 缺验收</small>
        </article>
      </section>

      <section className={`team-focus-hero ${stats.blocked || stats.overdue ? 'needs-attention' : ''}`}>
        <div className="team-focus-hero-main">
          <span className="team-panel-eyebrow">{focusScope === 'mine' && currentMember ? '我的下一项' : '团队下一项'}</span>
          <h3>{nextTask ? nextTask.title : focusScope === 'mine' && currentMember ? '今天没有分配给你的任务' : '今天还没有活跃任务'}</h3>
          <p>
            {nextTask
              ? `${nextTask.owner || '未分配'} · ${taskDueLabel(nextTask)} · ${nextTask.linkedDoc || '未连接任务文档'}`
              : focusScope === 'mine' && currentMember ? '可以切到“团队全部”查看其他任务，或新建一项工作。' : '新增一个任务，或从当前文档导入行动项。'}
          </p>
          <div className="team-focus-hero-actions">
            {nextTask ? (
              <>
                <button type="button" onClick={() => void createOrOpenTaskDoc(nextTask)}>{taskDocStatus(nextTask, documentPathSet) === 'linked' ? '打开任务文档' : '生成任务文档'}</button>
                <button type="button" onClick={() => updateTask(nextTask.id, { status: nextTask.status === 'todo' ? 'doing' : nextTask.status })} disabled={nextTask.status !== 'todo'}>{nextTask.status === 'todo' ? '开始推进' : STATUS_LABELS[nextTask.status]}</button>
                <button type="button" onClick={() => startTimer(nextTask)} disabled={!!activeSession}>开始工作</button>
              </>
            ) : (
              <button type="button" onClick={() => newTaskInputRef.current?.focus()}>新建任务</button>
            )}
          </div>
        </div>
        <div className="team-focus-scoreboard">
          <div><strong>{stats.active}</strong><span>待推进</span></div>
          <div className={stats.blocked ? 'danger' : ''}><strong>{stats.blocked}</strong><span>阻塞</span></div>
          <div className={stats.overdue ? 'danger' : ''}><strong>{stats.overdue}</strong><span>逾期</span></div>
          <div className={stats.missingDocs ? 'warning' : ''}><strong>{stats.missingDocs}</strong><span>缺文档</span></div>
        </div>
      </section>

      {activeSession && (
        <section className="team-active-session-bar" aria-label="当前计时任务">
          <div className="team-active-session-copy">
            <ClockIcon size={16} />
            <div>
              <strong>{activeSession.taskTitle}</strong>
              <span>{activeSession.member} · {new Date(activeSession.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 开始</span>
            </div>
          </div>
          <input value={activeSession.note} onChange={(event) => setActiveSession((session) => session ? { ...session, note: event.target.value } : session)} placeholder="正在做什么（可选）" />
          <button type="button" className="team-timer-stop" onClick={() => stopTimer(activeSession.taskId)}>结束并记录</button>
          <button type="button" onClick={() => setActiveSession(null)}>取消计时</button>
        </section>
      )}

      <details className="team-management-tools">
        <summary>
          <span>团队管理与交付</span>
          <small>{serverStatusLabel} · {stats.blocked + stats.overdue} 个风险 · {deliveryReadyCount}/{deliveryReadinessItems.length} 项就绪</small>
        </summary>
        <div className="team-management-tools-body">
      <section className="team-ops-summary" aria-label="同步与协作状态">
        <article className="team-ops-card team-member-card">
          <div>
            <span>当前成员</span>
            <strong>{currentMember || '未填写'}</strong>
            <small>{currentMemberLoad ? `${currentMemberLoad.tasks.length} 个活跃任务 · 剩余 ${minutesToLabel(currentMemberLoad.remaining)}` : '填写后会显示自己的任务和工时。'}</small>
          </div>
          <input value={currentMember} onChange={(event) => setCurrentMember(event.target.value)} placeholder="你的名字" list="team-members" />
        </article>
        <article className={`team-ops-card ${serverStatus?.ok ? 'ok' : (serverStatus || serverStatusError) ? 'danger' : 'unknown'}`}>
          <span>服务器</span>
          <strong>{serverStatusLabel}</strong>
          <small>{serverStatusError || serverWarning || memberWork?.endpoint || '刷新后读取服务器生产状态'}</small>
          <button type="button" onClick={() => void refreshServerStatus(true)}>刷新</button>
        </article>
        <article className={`team-ops-card ${aiMemoryRemoteCoverage.level}`}>
          <span>AI 记忆同步</span>
          <strong>{aiMemoryRemoteCoverage.title}</strong>
          <small>{aiMemoryRemoteCoverage.detail}</small>
          <div className="team-ops-card-actions">
            <button type="button" onClick={() => void refreshProductionDocsAndOpen('ai-memory', `${SCHEDULE_DIR}/ai-memory-index.md`, productionDocSubset({ includeAiMemoryIndex: true }))}>索引</button>
            <button type="button" onClick={() => void syncAiMemoryNow()} disabled={busy === 'ai-memory-sync'}>同步</button>
          </div>
        </article>
        <article className={`team-ops-card ${highRiskMemberCount ? 'danger' : 'ok'}`}>
          <span>成员负载</span>
          <strong>{highRiskMemberCount} 个高风险</strong>
          <small>{memberWork?.summary ? `${memberWork.summary.member}: ${memberWork.summary.activeTasks} 个活跃任务` : '会综合本地任务和服务器快照'}</small>
        </article>
      </section>

      <section className={`team-delivery-readiness ${deliveryReadinessLevel}`} aria-label="团队交付就绪检查">
        <header>
          <div>
            <span className="team-panel-eyebrow">交付检查</span>
            <h3>{deliveryReadinessTitle}</h3>
            <p>{deliveryReadyCount}/{deliveryReadinessItems.length} 项通过。多人协作或 AI 接管前再运行即可，日常成员无需处理。</p>
          </div>
          <div className="team-delivery-score">
            <strong>{deliveryReadyCount}</strong>
            <span>已通过</span>
          </div>
        </header>
        <div className="team-delivery-checks">
          {deliveryReadinessItems.map((item) => (
            <article key={item.key} className={item.state}>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </article>
          ))}
        </div>
        {liveSyncSelfTest?.steps?.length ? (
          <div className="team-sync-drill-result">
            <strong>最近同步检查：{liveSyncSelfTest.ok ? '已通过' : '需要处理'} · {liveSyncSelfTest.durationMs}ms</strong>
            <div>
              {liveSyncSelfTest.steps.slice(0, 8).map((step) => (
                <span key={step.name} className={step.ok ? 'ok' : 'danger'} title={step.detail}>
                  {step.ok ? '通过' : '失败'} {step.name}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        <div className="team-delivery-actions">
          <button type="button" className="team-primary-action" onClick={() => void runLiveSyncDeliveryDrill()} disabled={liveSyncTesting || !!busy}>
            {liveSyncTesting ? '检查中...' : '运行同步交付检查'}
          </button>
          <button type="button" onClick={() => void refreshLiveSyncReadiness(true)} disabled={liveSyncTesting}>
            刷新同步状态
          </button>
          <button type="button" onClick={() => void openServerAdmin()} disabled={liveSyncTesting} title={serverAdminUrl || '请先刷新服务器状态'}>
            打开 NAS 管理
          </button>
          <button type="button" onClick={() => void previewAiTakeoverSchedule()} disabled={!!busy}>
            预演 AI 接管
          </button>
          <button type="button" className="team-ai-takeover-btn" onClick={() => void aiTakeoverSchedule()} disabled={!!busy || !aiTakeoverPreview}>
            执行已预演的接管
          </button>
        </div>
        <div className="team-ai-flow-steps">
          <span><b>1</b> 同步任务文档</span>
          <span><b>2</b> 预演任务接管</span>
          <span><b>3</b> 确认写入</span>
          <span><b>4</b> 刷新制作文档</span>
          <span><b>5</b> 复查日志</span>
        </div>
      </section>
        </div>
      </details>

      <details className="team-advanced-tools">
        <summary>
          <span>AI / 生产工具</span>
          <small>叙事导演、健康检查、AI 写入任务与 Ars-note 制作台</small>
        </summary>
        <section className="team-production-actions">
          <div className="team-production-action-group">
            <strong>制作文档</strong>
            <button type="button" onClick={() => void refreshProductionDocsAndOpen('command', `${SCHEDULE_DIR}/obsidian-command-center.md`, allProductionDocs())}>打开 Ars-note 制作台</button>
            <button type="button" onClick={() => void refreshProductionDocsAndOpen('dashboard', `${SCHEDULE_DIR}/team-dashboard.md`, allProductionDocs())}>刷新团队看板</button>
            <button type="button" onClick={() => void refreshProductionDocsAndOpen('health', `${SCHEDULE_DIR}/production-health.md`, allProductionDocs())}>制作健康检查</button>
            <button type="button" onClick={() => void refreshProductionDocsAndOpen('narrative', `${SCHEDULE_DIR}/narrative-director.md`, allProductionDocs())}>叙事导演页</button>
          </div>
          <div className="team-production-action-group">
            <strong>AI 接管</strong>
            <button type="button" onClick={() => void refreshProductionDocsAndOpen('ai-memory-index', `${SCHEDULE_DIR}/ai-memory-index.md`, productionDocSubset({ includeAiMemoryIndex: true }))}>AI 记忆索引</button>
            <button type="button" onClick={() => void draftNarrativeTasks(false)}>草拟叙事任务</button>
            <button type="button" onClick={() => void draftNarrativeTasks(true)}>AI 写入叙事任务</button>
            <button type="button" onClick={() => void previewAiTakeoverSchedule()} disabled={!!busy}>预演接管</button>
            <button type="button" className="team-ai-takeover-btn" onClick={() => void aiTakeoverSchedule()} disabled={!!busy || !aiTakeoverPreview}>
              {aiTakeoverPreview ? '执行预演结果' : '请先预演'}
            </button>
          </div>
          <div className="team-production-action-group">
            <strong>服务器与恢复</strong>
            <button type="button" onClick={() => void runLiveSyncDeliveryDrill()} disabled={liveSyncTesting || !!busy}>{liveSyncTesting ? '检查中...' : '同步交付检查'}</button>
            <button type="button" onClick={() => void openServerAdmin()}>打开 NAS 管理</button>
            <button type="button" onClick={() => void syncLinkedTaskDocs()} disabled={!!busy}>同步任务文档</button>
            <button type="button" onClick={() => void generateMissingTaskDocs()} disabled={!!busy}>修复任务文档</button>
            <button type="button" onClick={() => void importCurrentDocumentTasks()} disabled={!onImportCurrentDocumentTasks || !!busy}>导入当前文档任务</button>
          </div>
          <button type="button" onClick={() => void refreshProductionDocsAndOpen('command', `${SCHEDULE_DIR}/obsidian-command-center.md`, allProductionDocs())}>打开 Ars-note 制作台</button>
          <button type="button" onClick={() => void refreshProductionDocsAndOpen('dashboard', `${SCHEDULE_DIR}/team-dashboard.md`, allProductionDocs())}>刷新团队看板</button>
          <button type="button" onClick={() => void refreshProductionDocsAndOpen('health', `${SCHEDULE_DIR}/production-health.md`, allProductionDocs())}>制作健康检查</button>
          <button type="button" onClick={() => void refreshProductionDocsAndOpen('narrative', `${SCHEDULE_DIR}/narrative-director.md`, allProductionDocs())}>叙事导演页</button>
          <button type="button" onClick={() => void refreshProductionDocsAndOpen('ai-memory-index', `${SCHEDULE_DIR}/ai-memory-index.md`, productionDocSubset({ includeAiMemoryIndex: true }))}>AI 记忆索引</button>
          <button type="button" onClick={() => void draftNarrativeTasks(false)}>草拟叙事任务</button>
          <button type="button" onClick={() => void draftNarrativeTasks(true)}>AI 写入叙事任务</button>
          <button type="button" onClick={() => void previewAiTakeoverSchedule()} disabled={!!busy}>预演 AI 接管</button>
          <button type="button" className="team-ai-takeover-btn" onClick={() => void aiTakeoverSchedule()} disabled={!!busy || !aiTakeoverPreview}>
            {aiTakeoverPreview ? '确认执行接管' : '先预演再接管'}
          </button>
          <button type="button" onClick={() => void importCurrentDocumentTasks()} disabled={!onImportCurrentDocumentTasks || !!busy}>导入当前文档任务</button>
        </section>
        {aiTakeoverPreview && (
          <section className="team-ai-takeover-preview">
            <header>
              <div>
                <span className="team-panel-eyebrow">AI 接管预演</span>
                <strong>接管预演已生成</strong>
                <small>{new Date(aiTakeoverPreview.checkedAt).toLocaleString()} · 只读预演，尚未写入时间表</small>
              </div>
              <div className="team-ai-preview-badges">
                <b>新增 {aiTakeoverPreview.importedCount}</b>
                <b>更新 {aiTakeoverPreview.updatedCount}</b>
                <b>改派 {aiTakeoverPreview.reassignments.length}</b>
                <b>跳过 {aiTakeoverPreview.skippedCount}</b>
              </div>
            </header>
            {aiTakeoverPreview.warnings.length > 0 && (
              <div className="team-ai-preview-warnings">
                {aiTakeoverPreview.warnings.slice(0, 4).map((warning) => <span key={warning}>{warning}</span>)}
              </div>
            )}
            <div className="team-ai-preview-summary">
              <span>缺叙事阶段 <b>{aiTakeoverPreview.result.summary.narrativeMissingStages || 0}</b></span>
              <span>弱链接 <b>{aiTakeoverPreview.result.summary.narrativeWeakLinks || 0}</b></span>
              <span>缺链文档 <b>{aiTakeoverPreview.result.summary.docsWithoutNarrativeLinks || 0}</b></span>
              <span>QA 项 <b>{aiTakeoverPreview.result.summary.qaItems || 0}</b></span>
            </div>
            {aiTakeoverPreview.affectedOwners.length > 0 && (
              <div className="team-ai-preview-owners">
                {aiTakeoverPreview.affectedOwners.slice(0, 6).map((owner) => (
                  <article key={owner.member} className={owner.level}>
                    <strong>{owner.member}</strong>
                    <span>预演新增/更新 {owner.draftCount} · 当前活跃 {owner.openTasks} · 剩余 {minutesToLabel(owner.remainingMinutes)}</span>
                    <small>高优 {owner.high} · 阻塞 {owner.blocked} · 逾期 {owner.overdue}</small>
                  </article>
                ))}
              </div>
            )}
            {aiTakeoverPreview.reassignments.length > 0 && (
              <div className="team-ai-preview-reassignments">
                <strong>负载改派</strong>
                {aiTakeoverPreview.reassignments.slice(0, 6).map((item, index) => (
                  <article key={`${item.title}-${index}`}>
                    <span>{item.title}</span>
                    <small>{item.fromOwner} → {item.toOwner} · {item.reason}</small>
                    <em>{item.projectedLoad}</em>
                  </article>
                ))}
              </div>
            )}
            <div className="team-ai-preview-task-list">
              {aiTakeoverPreview.result.tasks.slice(0, 8).map((task, index) => (
                <article key={`${task.title}-${task.linkedDoc}-${index}`}>
                  <strong>{task.title || task.deliverable || '未命名任务'}</strong>
                  <span>{task.owner || '未分配'} · {PRIORITY_LABELS[normalizePriority(task.priority)]} · {task.dueDate || '无截止'} · {task.linkedDoc || '未连接文档'}</span>
                </article>
              ))}
            </div>
            <footer>
              <button type="button" className="team-ai-takeover-btn" onClick={() => void aiTakeoverSchedule()} disabled={!!busy}>确认执行接管</button>
              <button type="button" onClick={() => setAiTakeoverPreview(null)} disabled={!!busy}>清除预演</button>
            </footer>
          </section>
        )}
      </details>

      <section className="team-toolbar">
        <div className="team-scope-tabs" role="group" aria-label="任务范围">
          <button type="button" className={focusScope === 'mine' ? 'active' : ''} disabled={!currentMember.trim()} onClick={() => {
            setFocusScope('mine');
            setMemberFilter(cleanMemberName(currentMember));
          }}>我的任务 <span>{myOpenTasks.length}</span></button>
          <button type="button" className={focusScope === 'team' ? 'active' : ''} onClick={() => {
            setFocusScope('team');
            setMemberFilter('all');
          }}>团队全部 <span>{stats.active}</span></button>
        </div>
        <div className="team-search-box">
          <SearchIcon size={14} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务、成员或文档..." />
          {query && <button type="button" onClick={() => setQuery('')}><CloseIcon size={12} /></button>}
        </div>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as TeamTaskStatus | 'all')}>
          <option value="all">全部状态</option>
          {STATUS_ORDER.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
        </select>
        <select value={memberFilter} onChange={(event) => setMemberFilter(event.target.value)}>
          <option value="all">全部成员</option>
          {members.map((member) => <option key={member} value={member}>{member}</option>)}
        </select>
        <select value={sortMode} onChange={(event) => setSortMode(event.target.value as TeamScheduleSortMode)}>
          <option value="dueAsc">按截止日期</option>
          <option value="priorityDesc">按优先级</option>
          <option value="updatedDesc">按更新时间</option>
          <option value="ownerAsc">按负责人</option>
          <option value="spentDesc">按已用时</option>
        </select>
        <div className="team-view-tabs">
          <button type="button" className={viewMode === 'focus' ? 'active' : ''} onClick={() => setViewMode('focus')}>今天</button>
          <button type="button" className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')}>任务表</button>
          <button type="button" className={viewMode === 'board' ? 'active' : ''} onClick={() => setViewMode('board')}>看板</button>
          <button type="button" className={viewMode === 'logs' ? 'active' : ''} onClick={() => setViewMode('logs')}>工时</button>
        </div>
      </section>

      <section className="team-new-task-card">
        <div className="team-new-task-main">
          <input ref={newTaskInputRef} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && newTitle.trim()) addTask();
          }} placeholder="任务名称，按 Enter 快速创建" />
          <input value={newOwner} onChange={(event) => setNewOwner(event.target.value)} placeholder={currentMember ? `负责人默认 ${currentMember}` : '负责人'} list="team-members" />
          <input value={newDoc} onChange={(event) => setNewDoc(event.target.value)} placeholder="关联文档路径" list="team-documents" />
          <input type="date" value={newDue} onChange={(event) => setNewDue(event.target.value)} title="截止日期" />
        </div>
        <button className="team-add-task-btn" type="button" onClick={addTask}><PlusIcon size={14} /> 新增</button>
      </section>

      {exportMsg && <div className="team-export-message">{exportMsg}</div>}
      {busy && <div className="team-export-message">正在处理：{busy}</div>}

      {viewMode === 'focus' && (
        <div className="team-focus-layout">
          <section className="team-focus-column">
            <header>
              <div>
                <span>{focusScope === 'mine' && currentMember ? currentMember : '团队'}</span>
                <strong>今日任务</strong>
              </div>
              <small>{focusTasks.length} 个待推进</small>
            </header>
            {focusTasks.length === 0 ? (
              <div className="team-empty-state">
                <strong>{focusScope === 'mine' && currentMember ? '今天没有分配给你的任务' : '今天没有需要处理的任务'}</strong>
                <span>{focusScope === 'mine' && currentMember ? '切到“团队全部”查看完整排期。' : '新增任务，或从当前文档导入行动项。'}</span>
              </div>
            ) : focusTasks.map((task, index) => renderFocusTaskCard(task, index === 0))}
          </section>
          <aside className="team-focus-side">
            <section className="team-personal-overview">
              <header><strong>{currentMember || '个人概览'}</strong><span>{myOpenTasks.length}</span></header>
              {currentMemberLoad ? (
                <div className="team-personal-metrics">
                  <div><strong>{currentMemberLoad.tasks.length}</strong><span>活跃任务</span></div>
                  <div><strong>{minutesToLabel(currentMemberLoad.remaining)}</strong><span>剩余预估</span></div>
                  <div className={currentMemberLoad.overdue ? 'danger' : ''}><strong>{currentMemberLoad.overdue}</strong><span>逾期</span></div>
                  <div className={currentMemberLoad.blocked ? 'danger' : ''}><strong>{currentMemberLoad.blocked}</strong><span>阻塞</span></div>
                </div>
              ) : (
                <div className="team-mini-empty">在顶部填写名字，就能只看自己的任务和工时。</div>
              )}
            </section>
            <section>
              <header><strong>成员负载</strong><span>{memberLoads.length}</span></header>
              <div className="team-mini-load-list">
                {memberLoads.slice(0, 6).map((item) => (
                  <div key={item.member} className={`team-mini-load ${item.level}`}>
                    <strong>{item.member}</strong>
                    <span>{item.tasks.length} 个任务 · {item.overdue} 逾期 · {item.blocked} 阻塞</span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      )}

      {viewMode === 'table' && (
        <div className="team-table-shell">
          <table className="team-schedule-table">
            <thead>
              <tr>
                <th>任务</th>
                <th>负责人</th>
                <th>状态</th>
                <th>优先级</th>
                <th>关联文档</th>
                <th>闭环</th>
                <th>计划</th>
                <th>预计/已用</th>
                <th>本次记录</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <div className="team-empty-state">
                      <strong>{data.tasks.length === 0 ? '还没有任务' : '没有匹配的任务'}</strong>
                      <span>可以新增任务，或点击初始化工作台让 AI/服务器生成基础制作任务。</span>
                    </div>
                  </td>
                </tr>
              ) : filteredTasks.map((task) => {
                const input = timeInputs[task.id] || { minutes: '30', note: '' };
                const spent = taskSpentMinutes(task);
                const latestLog = task.logs[0];
                const latestReview = latestReviewLog(task);
                const timing = activeSession?.taskId === task.id;
                return (
                  <tr key={task.id} className={`team-task-row status-${task.status}${isOverdue(task) ? ' overdue' : ''}${timing ? ' timing' : ''}`}>
                    <td className="team-task-title-cell">
                      <input value={task.title} onChange={(event) => updateTask(task.id, { title: event.target.value })} />
                      <textarea value={task.deliverable} onChange={(event) => updateTask(task.id, { deliverable: event.target.value })} placeholder="交付物" />
                    </td>
                    <td><input value={task.owner} onChange={(event) => updateTask(task.id, { owner: event.target.value })} list="team-members" /></td>
                    <td>
                      <select value={task.status} onChange={(event) => updateTask(task.id, { status: event.target.value as TeamTaskStatus })}>
                        {STATUS_ORDER.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={task.priority} onChange={(event) => updateTask(task.id, { priority: event.target.value as TeamTaskPriority })}>
                        {(['high', 'medium', 'low'] as TeamTaskPriority[]).map((priority) => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}
                      </select>
                    </td>
                    <td className="team-doc-cell">
                      <input value={task.linkedDoc} onChange={(event) => updateTask(task.id, { linkedDoc: normalizePath(event.target.value) })} placeholder="选择或输入文档" list="team-documents" />
                      {renderStatusPill(task)}
                      <button type="button" onClick={() => void createOrOpenTaskDoc(task)} disabled={busy === `doc-${task.id}`}><FileIcon size={12} /> {taskDocStatus(task, documentPathSet) === 'linked' ? '打开文档' : '生成文档'}</button>
                    </td>
                    <td className="team-production-cell">
                      <textarea value={task.dependency} onChange={(event) => updateTask(task.id, { dependency: event.target.value })} placeholder="依赖" />
                      <textarea value={task.blocker} onChange={(event) => updateTask(task.id, { blocker: event.target.value, status: event.target.value.trim() ? 'blocked' : task.status })} placeholder="阻塞原因" />
                      <textarea value={task.acceptance} onChange={(event) => updateTask(task.id, { acceptance: event.target.value })} placeholder="验收标准" />
                    </td>
                    <td className="team-date-cell">
                      <input type="date" value={task.startDate} onChange={(event) => updateTask(task.id, { startDate: event.target.value })} />
                      <input type="date" value={task.dueDate} onChange={(event) => updateTask(task.id, { dueDate: event.target.value })} />
                      {isOverdue(task) && <span className="team-overdue-pill">逾期</span>}
                    </td>
                    <td className="team-time-cell">
                      <input type="number" min={0} step={15} value={task.estimateMinutes || ''} onChange={(event) => updateTask(task.id, { estimateMinutes: toMinutes(event.target.value) })} placeholder="预计分钟" />
                      <span>{minutesToLabel(spent)} / {task.estimateMinutes ? minutesToLabel(task.estimateMinutes) : '未估算'}</span>
                      {timing && <span className="team-timing-pill">计时中</span>}
                    </td>
                    <td className="team-log-cell">
                      <div className="team-log-inputs">
                        <input type="number" min={1} step={15} value={input.minutes} onChange={(event) => setTimeInputs((previous) => ({ ...previous, [task.id]: { ...input, minutes: event.target.value } }))} />
                        <input value={input.note} onChange={(event) => setTimeInputs((previous) => ({ ...previous, [task.id]: { ...input, note: event.target.value } }))} placeholder="做了什么" />
                        <button type="button" onClick={() => addLog(task)}>记录</button>
                      </div>
                      <div className="team-timer-actions">
                        {timing
                          ? <button type="button" className="team-timer-stop" onClick={() => stopTimer(task.id)}>结束计时</button>
                          : <button type="button" className="team-timer-start" disabled={!!activeSession} onClick={() => startTimer(task)}><ClockIcon size={12} /> 开始计时</button>}
                      </div>
                      {latestLog && <div className="team-last-log" title={latestLog.note}>{latestLog.member} · {minutesToLabel(latestLog.minutes)} · {latestLog.note || latestLog.date}</div>}
                      {latestReview && <div className={`team-last-review result-${latestReview.result}`} title={latestReview.note}>{REVIEW_RESULT_LABELS[latestReview.result]} · {latestReview.reviewer}</div>}
                    </td>
                    <td className="team-row-actions">
                      <button type="button" className="review-approve" onClick={() => addReviewLog(task, 'approved')}>通过</button>
                      <button type="button" className="review-changes" onClick={() => addReviewLog(task, 'changes')}>退回</button>
                      <button type="button" className="review-note" onClick={() => addReviewLog(task, 'note')}>复查</button>
                      <button type="button" onClick={() => deleteTask(task.id)}>删除</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {viewMode === 'board' && (
        <div className="team-board-view">
          {STATUS_ORDER.map((status) => {
            const tasks = filteredTasks.filter((task) => task.status === status);
            return (
              <section key={status} className={`team-board-column status-${status}`}>
                <header><strong>{STATUS_LABELS[status]}</strong><span>{tasks.length}</span></header>
                <div className="team-board-card-list">
                  {tasks.length === 0 ? <div className="team-board-empty">暂无任务</div> : tasks.map((task) => (
                    <article key={task.id} className={`team-board-card priority-${task.priority}${isOverdue(task) ? ' overdue' : ''}`}>
                      <div className="team-board-card-top"><strong>{task.title}</strong><span>{PRIORITY_LABELS[task.priority]}</span></div>
                      <div className="team-board-card-meta"><span>{task.owner}</span><span>{task.dueDate || '无截止'}</span><span>{minutesToLabel(taskSpentMinutes(task))}</span></div>
                      {task.deliverable && <p>{task.deliverable}</p>}
                      {(task.dependency || task.blocker || task.acceptance) && (
                        <div className="team-board-production">
                          {task.dependency && <span>依赖：{task.dependency}</span>}
                          {task.blocker && <span>阻塞：{task.blocker}</span>}
                          {task.acceptance && <span>验收：{task.acceptance}</span>}
                        </div>
                      )}
                      <div className="team-board-card-actions">
                        <button type="button" onClick={() => addReviewLog(task, 'approved')}>通过</button>
                        <button type="button" onClick={() => addReviewLog(task, 'changes')}>退回</button>
                        <button type="button" onClick={() => void createOrOpenTaskDoc(task)}>{taskDocStatus(task, documentPathSet) === 'linked' ? '打开文档' : '生成文档'}</button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {viewMode === 'logs' && (
        <div className="team-logs-view">
          <div className="team-logs-header"><strong>最近工时流水</strong><span>{recentLogs.length} 条记录</span></div>
          {recentLogs.length === 0 ? (
            <div className="team-empty-state"><strong>还没有工时记录</strong><span>在表格里给任务填写“做了什么”和分钟数后，这里会形成流水。</span></div>
          ) : recentLogs.map((log) => (
            <article key={log.id} className="team-log-record">
              <div><strong>{log.taskTitle}</strong><span>{log.note || '未填写说明'}</span></div>
              <div className="team-log-record-meta">
                <span>{log.member}</span>
                <span>{minutesToLabel(log.minutes)}</span>
                <span>{log.date}</span>
                {log.linkedDoc && <button type="button" onClick={() => onOpenFile(log.linkedDoc)}>打开文档</button>}
              </div>
            </article>
          ))}
        </div>
      )}

      <details className="team-report-tools">
        <summary><span>报表与完整成员负载</span><small>JSON、CSV、汇总文档和成员统计</small></summary>
      <section className="team-export-actions">
        <button type="button" onClick={() => void exportSchedule('json')}>导出 JSON</button>
        <button type="button" onClick={() => void exportSchedule('csv')}>导出 CSV</button>
        <button type="button" onClick={() => void exportSchedule('report')}>导出汇总</button>
        {currentFileRelativePath && <span>当前文档：{currentFileRelativePath}</span>}
      </section>

      <section className="team-member-load-list">
        {memberLoads.map((item) => (
          <article key={item.member} className={`team-member-load-card ${item.level}`}>
            <strong>{item.member}</strong>
            <span>{item.tasks.length} 个活跃任务 · 高优 {item.high} · 阻塞 {item.blocked} · 逾期 {item.overdue}</span>
            <small>剩余 {minutesToLabel(item.remaining)} · 已记录 {minutesToLabel(item.spent)}</small>
          </article>
        ))}
      </section>
      </details>

      <datalist id="team-documents">
        {documentPaths.map((path) => <option key={path} value={path} />)}
      </datalist>
      <datalist id="team-members">
        {members.map((member) => <option key={member} value={member} />)}
      </datalist>
    </section>
  );
};

export default TeamSchedulePanel;
