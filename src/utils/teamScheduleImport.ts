import type { ExtractedTeamTask, ExtractedTaskPriority, ExtractedTaskStatus } from './aiTaskExtraction';

export interface TeamScheduleImportOptions {
  sourceLabel?: string;
  unassignedLabel?: string;
}

export interface TeamScheduleImportResult {
  importedCount: number;
  updatedCount?: number;
  skippedCount: number;
  schedulePath: string;
  content: string;
  productionDocPaths?: string[];
  taskDocCreatedCount?: number;
  taskDocLinkedCount?: number;
  taskDocUpgradedCount?: number;
  taskDocSkippedCount?: number;
  taskDocPaths?: string[];
}

const TEAM_SCHEDULE_DIR = '.ars-team';
const TEAM_SCHEDULE_FILE = 'schedule.json';

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  const cryptoApi = typeof crypto !== 'undefined' ? crypto : null;
  if (cryptoApi && 'randomUUID' in cryptoApi) return `${prefix}-${cryptoApi.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePriority(value: unknown): ExtractedTaskPriority {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'medium';
}

function normalizeStatus(value: unknown): ExtractedTaskStatus {
  if (value === 'doing' || value === 'review' || value === 'blocked') return value;
  return 'todo';
}

function taskKey(task: { title?: unknown; owner?: unknown; linkedDoc?: unknown }): string {
  return [
    String(task.title || '').trim().toLowerCase(),
    String(task.owner || '').trim().toLowerCase(),
    String(task.linkedDoc || '').trim().toLowerCase(),
  ].join('|');
}

function cleanText(value: unknown): string {
  return String(value || '').trim();
}

export async function importTasksToTeamSchedule(
  vaultPath: string,
  tasks: ExtractedTeamTask[],
  options: TeamScheduleImportOptions = {},
): Promise<TeamScheduleImportResult> {
  const api = window.arsnote;
  const sourceLabel = options.sourceLabel || 'Import';
  const unassignedLabel = options.unassignedLabel || '未分配';
  const scheduleDir = await api.joinPath(vaultPath, TEAM_SCHEDULE_DIR);
  try { await api.createFolder(scheduleDir); } catch {}
  const schedulePath = await api.joinPath(vaultPath, TEAM_SCHEDULE_DIR, TEAM_SCHEDULE_FILE);

  let existing: any = null;
  try {
    const raw = await api.readFile(schedulePath);
    existing = JSON.parse(raw);
  } catch {
    existing = null;
  }

  const currentTasks = Array.isArray(existing?.tasks) ? existing.tasks : [];
  const seen = new Set(currentTasks.map(taskKey));
  const now = nowIso();
  let skippedCount = 0;
  const importedTasks = tasks.flatMap((item): any[] => {
    const title = cleanText(item.title);
    if (!title) {
      skippedCount += 1;
      return [];
    }
    const owner = cleanText(item.owner) || unassignedLabel;
    const linkedDoc = cleanText(item.linkedDoc).replace(/\\/g, '/');
    const key = taskKey({ title, owner, linkedDoc });
    if (seen.has(key)) {
      skippedCount += 1;
      return [];
    }
    seen.add(key);
    const notes = cleanText(item.notes);
    return [{
      id: makeId('task'),
      title,
      owner,
      status: normalizeStatus(item.status),
      priority: normalizePriority(item.priority),
      startDate: '',
      dueDate: cleanText(item.dueDate),
      estimateMinutes: 0,
      linkedDoc,
      deliverable: cleanText(item.deliverable) || title,
      dependency: cleanText(item.dependency),
      blocker: '',
      acceptance: cleanText(item.acceptance),
      notes: notes ? `${sourceLabel}: ${notes}` : sourceLabel,
      createdAt: now,
      updatedAt: now,
      logs: [],
      reviewLogs: [],
    }];
  });

  const members = new Set<string>();
  for (const member of Array.isArray(existing?.members) ? existing.members : []) {
    const clean = cleanText(member);
    if (clean) members.add(clean);
  }
  for (const task of [...currentTasks, ...importedTasks]) {
    const owner = cleanText(task.owner);
    if (owner && owner !== unassignedLabel) members.add(owner);
  }

  const next = {
    version: 1,
    updatedAt: now,
    members: Array.from(members).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    tasks: [...currentTasks, ...importedTasks],
    deletedTaskIds: Array.isArray(existing?.deletedTaskIds) ? existing.deletedTaskIds : [],
  };
  const content = JSON.stringify(next, null, 2);
  await api.writeFile(schedulePath, content);
  return {
    importedCount: importedTasks.length,
    skippedCount,
    schedulePath,
    content,
  };
}
