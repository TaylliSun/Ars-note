import type { AITeamScheduleContext, AITeamTaskPriority, AITeamTaskStatus } from '../types';

const TEAM_SCHEDULE_DIR = '.ars-team';
const TEAM_SCHEDULE_FILE = 'schedule.json';
const TOP_TASK_LIMIT = 24;

function cleanText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePath(value: unknown): string {
  return cleanText(value).replace(/\\/g, '/');
}

function normalizeStatus(value: unknown): AITeamTaskStatus {
  if (value === 'todo' || value === 'doing' || value === 'review' || value === 'blocked' || value === 'done') return value;
  if (value === 'wip') return 'doing';
  return 'todo';
}

function normalizePriority(value: unknown): AITeamTaskPriority {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'medium';
}

function normalizeDate(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) return '';
  const match = raw.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : raw.slice(0, 10);
}

function todayKey(): string {
  const today = new Date();
  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
}

function addDaysKey(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function spentMinutes(rawLogs: unknown): number {
  if (!Array.isArray(rawLogs)) return 0;
  return rawLogs.reduce((sum, log: any) => {
    const minutes = Number(log?.minutes || 0);
    return sum + (Number.isFinite(minutes) ? Math.max(0, minutes) : 0);
  }, 0);
}

function normalizeReviewResult(value: unknown): 'approved' | 'changes' | 'note' {
  if (value === 'approved' || value === 'changes' || value === 'note') return value;
  const raw = cleanText(value).toLowerCase();
  if (/pass|approve|done|通过|完成/.test(raw)) return 'approved';
  if (/change|reject|fail|return|退回|修改|不通过/.test(raw)) return 'changes';
  return 'note';
}

function latestReview(rawLogs: unknown): AITeamScheduleContext['topTasks'][number]['latestReview'] {
  if (!Array.isArray(rawLogs)) return null;
  const latest = rawLogs
    .filter((log: any) => log && typeof log === 'object')
    .slice()
    .sort((a: any, b: any) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')))[0];
  if (!latest) return null;
  return {
    reviewer: cleanText(latest.reviewer || latest.member),
    date: normalizeDate(latest.date),
    result: normalizeReviewResult(latest.result || latest.status || latest.conclusion),
    note: cleanText(latest.note).slice(0, 260),
  };
}

function priorityWeight(priority: AITeamTaskPriority): number {
  if (priority === 'high') return 3;
  if (priority === 'medium') return 2;
  return 1;
}

function scheduleSortValue(task: AITeamScheduleContext['topTasks'][number], today: string): number {
  const overdue = task.status !== 'done' && task.dueDate && task.dueDate < today ? 1000 : 0;
  const blocked = task.status === 'blocked' ? 800 : 0;
  const doing = task.status === 'doing' ? 300 : 0;
  const review = task.status === 'review' ? 220 : 0;
  const returned = task.latestReview?.result === 'changes' ? 180 : 0;
  const priority = priorityWeight(task.priority) * 80;
  const hasDueDate = task.dueDate ? 40 : 0;
  const missingOwner = task.owner ? 0 : 60;
  return overdue + blocked + doing + review + returned + priority + hasDueDate + missingOwner;
}

export async function buildAITeamScheduleContext(vaultPath: string): Promise<AITeamScheduleContext | undefined> {
  try {
    const api = window.arsnote;
    const schedulePath = await api.joinPath(vaultPath, TEAM_SCHEDULE_DIR, TEAM_SCHEDULE_FILE);
    const raw = await api.readFile(schedulePath);
    const parsed = JSON.parse(raw);
    const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
    const members = new Set<string>();
    const today = todayKey();
    const soon = addDaysKey(7);
    const context: AITeamScheduleContext = {
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : '',
      members: [],
      total: 0,
      active: 0,
      done: 0,
      overdue: 0,
      blocked: 0,
      dueSoon: 0,
      missingOwner: 0,
      missingDueDate: 0,
      totalMinutes: 0,
      topTasks: [],
    };

    for (const member of Array.isArray(parsed?.members) ? parsed.members : []) {
      const clean = cleanText(member);
      if (clean) members.add(clean);
    }

    for (const rawTask of tasks) {
      const title = cleanText(rawTask?.title);
      if (!title) continue;
      const owner = cleanText(rawTask?.owner);
      const status = normalizeStatus(rawTask?.status);
      const priority = normalizePriority(rawTask?.priority);
      const dueDate = normalizeDate(rawTask?.dueDate);
      const linkedDoc = normalizePath(rawTask?.linkedDoc);
      const minutes = spentMinutes(rawTask?.logs);
      const updatedAt = typeof rawTask?.updatedAt === 'string' ? rawTask.updatedAt : '';
      if (owner && owner !== '未分配') members.add(owner);
      for (const review of Array.isArray(rawTask?.reviewLogs) ? rawTask.reviewLogs : []) {
        const reviewer = cleanText(review?.reviewer || review?.member);
        if (reviewer && reviewer !== '未分配') members.add(reviewer);
      }

      context.total += 1;
      context.totalMinutes += minutes;
      if (status === 'done') {
        context.done += 1;
      } else {
        context.active += 1;
      }
      if (status === 'blocked') context.blocked += 1;
      if (status !== 'done' && dueDate && dueDate < today) context.overdue += 1;
      if (status !== 'done' && dueDate && dueDate >= today && dueDate <= soon) context.dueSoon += 1;
      if (status !== 'done' && !owner) context.missingOwner += 1;
      if (status !== 'done' && !dueDate) context.missingDueDate += 1;

      if (status !== 'done') {
        context.topTasks.push({
          title,
          owner,
          status,
          priority,
          dueDate,
          linkedDoc,
          deliverable: cleanText(rawTask?.deliverable),
          dependency: cleanText(rawTask?.dependency || rawTask?.dependencies),
          blocker: cleanText(rawTask?.blocker || rawTask?.blockedReason),
          acceptance: cleanText(rawTask?.acceptance || rawTask?.acceptanceCriteria),
          notes: cleanText(rawTask?.notes).slice(0, 260),
          spentMinutes: minutes,
          updatedAt,
          latestReview: latestReview(rawTask?.reviewLogs),
        });
      }
    }

    context.members = Array.from(members).sort((a, b) => a.localeCompare(b, 'zh-CN'));
    context.topTasks = context.topTasks
      .sort((a, b) => {
        const scoreDiff = scheduleSortValue(b, today) - scheduleSortValue(a, today);
        if (scoreDiff !== 0) return scoreDiff;
        if (a.dueDate !== b.dueDate) return (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99');
        return (b.updatedAt || '').localeCompare(a.updatedAt || '');
      })
      .slice(0, TOP_TASK_LIMIT);

    return context;
  } catch {
    return undefined;
  }
}
