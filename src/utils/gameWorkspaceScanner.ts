/* ── Game Workspace Scanner (v0.9.2) ── */
/* Scans vault index entries to identify game dev documents */
/* Pure computation — no file reads, no side effects */

import type { VaultIndex, GameDocType, GameWorkspaceEntry, GameWorkspaceSummary, GameWorkspaceFilters, GameWorkspaceDashboard } from '../types';

/* ── Recognition rules ── */

interface DocRule {
  type: GameDocType;
  pathPrefixes: string[];
  titlePatterns: RegExp[];
}

const DOC_RULES: DocRule[] = [
  {
    type: 'gdd',
    pathPrefixes: ['01_GDD/', '01_gdd/'],
    titlePatterns: [
      /# Game Design Document/i,
      /# 游戏设计文档/,
      /# GDD\b/i,
    ],
  },
  {
    type: 'story',
    pathPrefixes: [],
    titlePatterns: [
      /StoryArc/i,
      /PlotOutline/i,
      /Plot Outline/i,
      /Story Arc/i,
      /# Plot\b/i,
      /# Story\b/i,
      /# 剧情/,
      /# 故事线/,
      /# 剧情大纲/,
    ],
  },
  {
    type: 'dialogue',
    pathPrefixes: [],
    titlePatterns: [
      /DialogueScript/i,
      /DialogueScene/i,
      /Dialogue Profile/i,
      /Dialogue Script/i,
      /Dialogue Scene/i,
      /Banter/i,
      /# Dialogue\b/i,
      /# 台词/,
      /# 对话/,
      /# 闲聊/,
    ],
  },
  {
    type: 'performance',
    pathPrefixes: [],
    titlePatterns: [
      /Cutscene/i,
      /Storyboard/i,
      /Performance/i,
      /Cinematic/i,
      /# Cutscene\b/i,
      /# Storyboard\b/i,
      /# 演出/,
      /# 分镜/,
      /# 过场/,
      /# 过场动画/,
    ],
  },
  {
    type: 'worldbuilding',
    pathPrefixes: ['02_Worldbuilding/', '02_worldbuilding/'],
    titlePatterns: [
      /# World\b/i,
      /# Worldbuilding/i,
      /# World Overview/i,
      /# Location\b/i,
      /# Faction\b/i,
      /# Race\b/i,
      /# Species\b/i,
      /# Timeline\b/i,
      /# Lore\b/i,
      /# 世界观/,
      /# 地点/,
      /# 派系/,
      /# 时间线/,
    ],
  },
  {
    type: 'character',
    pathPrefixes: ['03_Characters/', '03_characters/'],
    titlePatterns: [
      /# Character\b/i,
      /# 角色/,
      /# Character Profile/i,
      /# 角色设定/,
    ],
  },
  {
    type: 'item',
    pathPrefixes: ['05_Items/', '05_items/'],
    titlePatterns: [
      /# Item\b/i,
      /# 道具/,
      /# Item Design/i,
      /# 物品设计/,
    ],
  },
  {
    type: 'quest',
    pathPrefixes: ['06_Quests/', '06_quests/'],
    titlePatterns: [
      /# Quest\b/i,
      /# 任务/,
      /# Quest Design/i,
      /# 任务设计/,
    ],
  },
  {
    type: 'taskTable',
    pathPrefixes: [],
    titlePatterns: [
      /TaskTable/i,
      /Task List/i,
      /Task Sheet/i,
      /Production Task/i,
      /Milestone/i,
      /# 任务表/,
      /# 任务清单/,
      /# 开发任务表/,
      /# 里程碑/,
    ],
  },
  {
    type: 'unityTask',
    pathPrefixes: [
      '07_Unity/', '07_unity/',
      '07_Unity_Tasks/', '07_unity_tasks/',
      '07_UnityTasks/', '07_unitytasks/',
      'Unity/', 'Unity_Tasks/',
    ],
    titlePatterns: [
      /# Unity Task/i,
      /# Unity 任务/,
      /# Implementation Task/i,
      /# 技术任务/,
    ],
  },
  {
    type: 'devlog',
    pathPrefixes: [
      '99_Devlog/', '99_devlog/',
      '08_Devlog/', '08_devlog/',
    ],
    titlePatterns: [
      /# Devlog\b/i,
      /# 开发日志/,
      /# Development Log/i,
      /# 日志/,
    ],
  },
];

/* ── Classification ── */

export function classifyEntry(relativePath: string, title: string): GameDocType | null {
  const normalizedPath = relativePath.replace(/\\/g, '/');

  for (const rule of DOC_RULES) {
    for (const prefix of rule.pathPrefixes) {
      if (normalizedPath.startsWith(prefix)) {
        return rule.type;
      }
    }
    for (const pattern of rule.titlePatterns) {
      if (pattern.test('# ' + title) || pattern.test(title) || pattern.test(normalizedPath)) {
        return rule.type;
      }
    }
  }

  return null;
}

/* ── Extract status from tags ── */

function extractStatusFromTags(tags: string[]): string | undefined {
  const statusTags = ['draft', 'wip', 'review', 'done', 'approved', 'rejected', 'archived',
    'todo', 'in-progress', 'completed'];
  for (const tag of tags) {
    const lower = tag.toLowerCase().replace(/[_-]/g, ' ');
    if (statusTags.includes(lower)) {
      return lower;
    }
  }
  return undefined;
}

/* ── Normalize status value ── */

function normalizeStatus(raw: string): string {
  const lower = raw.toLowerCase().trim();
  const map: Record<string, string> = {
    'draft': 'draft',
    'wip': 'wip',
    'in progress': 'wip',
    'in-progress': 'wip',
    'review': 'review',
    'done': 'done',
    'completed': 'done',
    'approved': 'approved',
    'rejected': 'rejected',
    'archived': 'archived',
    'todo': 'todo',
  };
  return map[lower] || lower;
}

/* ── Normalize priority value ── */

function normalizePriority(raw: string): string {
  const lower = raw.toLowerCase().trim();
  const map: Record<string, string> = {
    'p0': 'high',
    'p1': 'high',
    'p2': 'medium',
    'p3': 'low',
    'high': 'high',
    'medium': 'medium',
    'low': 'low',
    'critical': 'high',
    'important': 'high',
  };
  return map[lower] || lower;
}

/* ── Main scan function ── */

export interface GameWorkspaceResult {
  summary: GameWorkspaceSummary;
  entries: GameWorkspaceEntry[];
  grouped: Record<GameDocType, GameWorkspaceEntry[]>;
}

export function scanGameWorkspace(vaultIndex: VaultIndex): GameWorkspaceResult {
  const entries: GameWorkspaceEntry[] = [];
  const grouped: Record<GameDocType, GameWorkspaceEntry[]> = {
    gdd: [],
    worldbuilding: [],
    story: [],
    dialogue: [],
    performance: [],
    character: [],
    item: [],
    quest: [],
    taskTable: [],
    unityTask: [],
    devlog: [],
  };

  let draftCount = 0;
  let doneCount = 0;
  let highPriorityCount = 0;

  for (const entry of Object.values(vaultIndex.notes)) {
    const docType = classifyEntry(entry.relativePath, entry.title);
    if (!docType) continue;

    /* Status: prefer metadata, then tags */
    let status: string | undefined;
    if (entry.metadata?.status) {
      status = normalizeStatus(entry.metadata.status);
    } else {
      status = extractStatusFromTags(entry.tags || []);
    }

    /* Priority from metadata */
    let priority: string | undefined;
    if (entry.metadata?.priority) {
      priority = normalizePriority(entry.metadata.priority);
    }

    /* Owner from metadata */
    const owner = entry.metadata?.owner;

    /* Updated date from metadata */
    const updatedAt = entry.metadata?.updatedAt;

    /* Summary from metadata */
    const summary = entry.metadata?.summary;

    /* Count status/priority for summary */
    if (status === 'draft' || status === 'todo') draftCount++;
    if (status === 'done' || status === 'completed') doneCount++;
    if (priority === 'high') highPriorityCount++;

    const gameEntry: GameWorkspaceEntry = {
      type: docType,
      title: entry.title || entry.fileName,
      relativePath: entry.relativePath,
      tags: entry.tags || [],
      status,
      priority,
      owner,
      updatedAt,
      summary,
    };

    entries.push(gameEntry);
    grouped[docType].push(gameEntry);
  }

  /* Sort each group by title */
  for (const key of Object.keys(grouped) as GameDocType[]) {
    grouped[key].sort((a, b) => a.title.localeCompare(b.title));
  }

  const summary: GameWorkspaceSummary = {
    gddCount: grouped.gdd.length,
    worldbuildingCount: grouped.worldbuilding.length,
    storyCount: grouped.story.length,
    dialogueCount: grouped.dialogue.length,
    performanceCount: grouped.performance.length,
    characterCount: grouped.character.length,
    itemCount: grouped.item.length,
    questCount: grouped.quest.length,
    taskTableCount: grouped.taskTable.length,
    unityTaskCount: grouped.unityTask.length,
    devlogCount: grouped.devlog.length,
    totalGameDocs: entries.length,
    draftCount,
    doneCount,
    highPriorityCount,
  };

  return { summary, entries, grouped };
}

/* ── Dashboard builder (v0.9.3) ── */

const ALL_DOC_TYPES: GameDocType[] = ['gdd', 'worldbuilding', 'story', 'dialogue', 'performance', 'character', 'item', 'quest', 'taskTable', 'unityTask', 'devlog'];

export function buildGameWorkspaceDashboard(
  entries: GameWorkspaceEntry[],
  summary: GameWorkspaceSummary,
): GameWorkspaceDashboard {
  /* Missing core docs */
  const missingCoreDocs = ALL_DOC_TYPES.filter((type) => {
    const key = (type + 'Count') as keyof GameWorkspaceSummary;
    return (summary[key] as number) === 0;
  });

  /* High priority */
  const highPriorityEntries = entries
    .filter((e) => e.priority === 'high')
    .slice(0, 5);

  /* Draft */
  const draftEntries = entries
    .filter((e) => e.status === 'draft' || e.status === 'todo')
    .slice(0, 5);

  /* Recently updated — sort by updatedAt desc */
  const recentlyUpdatedEntries = [...entries]
    .filter((e) => e.updatedAt)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, 5);

  /* Missing metadata — no status AND no priority AND no owner AND no summary */
  const missingMetadataEntries = entries
    .filter((e) => !e.status && !e.priority && !e.owner && !e.summary)
    .slice(0, 5);

  return {
    missingCoreDocs,
    highPriorityEntries,
    draftEntries,
    recentlyUpdatedEntries,
    missingMetadataEntries,
  };
}

/* ── Filter function (v0.9.3) ── */

export function filterGameWorkspaceEntries(
  entries: GameWorkspaceEntry[],
  filters: GameWorkspaceFilters,
): GameWorkspaceEntry[] {
  let filtered = entries;

  if (filters.type !== 'all') {
    filtered = filtered.filter((e) => e.type === filters.type);
  }

  if (filters.status && filters.status !== 'all') {
    filtered = filtered.filter((e) => {
      if (filters.status === 'wip') return e.status === 'wip' || e.status === 'in progress';
      return e.status === filters.status;
    });
  }

  if (filters.priority && filters.priority !== 'all') {
    filtered = filtered.filter((e) => e.priority === filters.priority);
  }

  if (filters.owner && filters.owner !== 'all') {
    filtered = filtered.filter((e) => e.owner === filters.owner);
  }

  if (filters.query) {
    const q = filters.query.toLowerCase();
    filtered = filtered.filter((e) =>
      e.title.toLowerCase().includes(q) ||
      e.relativePath.toLowerCase().includes(q) ||
      (e.summary && e.summary.toLowerCase().includes(q)) ||
      e.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  }

  return filtered;
}

/* ── Owner list (v0.9.3) ── */

export function getGameWorkspaceOwners(entries: GameWorkspaceEntry[]): string[] {
  const owners = new Set<string>();
  for (const entry of entries) {
    if (entry.owner) {
      owners.add(entry.owner);
    }
  }
  return [...owners].sort();
}

/* ── Board grouping functions (v0.9.4) ── */

export interface BoardGroup {
  id: string;
  label: string;
  entries: GameWorkspaceEntry[];
}

const STATUS_COLUMNS: { id: string; label: string; statuses: string[] }[] = [
  { id: 'no-status', label: 'No Status', statuses: [''] },
  { id: 'draft', label: 'Draft', statuses: ['draft', 'todo'] },
  { id: 'wip', label: 'In Progress', statuses: ['wip', 'in progress'] },
  { id: 'review', label: 'Review', statuses: ['review'] },
  { id: 'done', label: 'Done', statuses: ['done', 'completed', 'approved'] },
];

const TYPE_COLUMNS: { id: GameDocType; label: string }[] = [
  { id: 'gdd', label: 'GDD' },
  { id: 'worldbuilding', label: 'Worldbuilding' },
  { id: 'story', label: 'Story' },
  { id: 'dialogue', label: 'Dialogue' },
  { id: 'performance', label: 'Performance' },
  { id: 'character', label: 'Characters' },
  { id: 'item', label: 'Items' },
  { id: 'quest', label: 'Quests' },
  { id: 'taskTable', label: 'Task Tables' },
  { id: 'unityTask', label: 'Unity Tasks' },
  { id: 'devlog', label: 'Devlog' },
];

export function groupGameWorkspaceEntriesByStatus(entries: GameWorkspaceEntry[]): BoardGroup[] {
  const groups: BoardGroup[] = STATUS_COLUMNS.map((col) => ({
    id: col.id,
    label: col.label,
    entries: [],
  }));

  for (const entry of entries) {
    const status = entry.status || '';
    let matched = false;
    for (let i = 0; i < STATUS_COLUMNS.length; i++) {
      if (STATUS_COLUMNS[i].statuses.includes(status)) {
        groups[i].entries.push(entry);
        matched = true;
        break;
      }
    }
    if (!matched) {
      groups[0].entries.push(entry); // fallback to "No Status"
    }
  }

  return groups;
}

export function groupGameWorkspaceEntriesByType(entries: GameWorkspaceEntry[]): BoardGroup[] {
  const groups: BoardGroup[] = TYPE_COLUMNS.map((col) => ({
    id: col.id,
    label: col.label,
    entries: [],
  }));

  for (const entry of entries) {
    let matched = false;
    for (let i = 0; i < TYPE_COLUMNS.length; i++) {
      if (entry.type === TYPE_COLUMNS[i].id) {
        groups[i].entries.push(entry);
        matched = true;
        break;
      }
    }
    if (!matched) {
      groups[0].entries.push(entry);
    }
  }

  return groups;
}
