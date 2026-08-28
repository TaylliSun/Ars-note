import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { NoteIndexEntry, VaultIndex } from '../types';
import { CheckIcon, ClockIcon, FileIcon, RefreshIcon, WarningIcon } from './icons/ArsIcons';

type ProductionPriority = 'high' | 'medium' | 'low';
type CommandSource = 'markdown' | 'schedule';
type QAItemType = 'bug' | 'playtest' | 'feedback';
type NarrativeStage = 'worldbuilding' | 'story' | 'quest' | 'dialogue' | 'performance' | 'taskTable';

interface CommandActionItem {
  id: string;
  text: string;
  relativePath: string;
  line: number;
  owner: string;
  dueDate: string;
  priority: ProductionPriority;
  source: CommandSource;
  status?: string;
  linkedDoc?: string;
  dependency?: string;
  acceptance?: string;
  blocker?: string;
  details?: string;
}

interface CommandRiskItem {
  id: string;
  text: string;
  relativePath: string;
  line: number;
  severity: ProductionPriority;
}

interface CommandQAItem {
  id: string;
  text: string;
  relativePath: string;
  line: number;
  severity: ProductionPriority;
  status: string;
  owner: string;
  buildVersion: string;
  itemType: QAItemType;
  details?: string;
}

interface NarrativeDocBrief {
  type: NarrativeStage;
  title: string;
  relativePath: string;
  status: string;
  owner: string;
  priority: string;
  linkCount: number;
  narrativeLinkCount: number;
}

interface NarrativeChainStats {
  worldbuilding: number;
  story: number;
  quest: number;
  dialogue: number;
  performance: number;
  taskTable: number;
  pipeline: number;
  missingStages: NarrativeStage[];
  weakLinks: string[];
  docsWithoutNarrativeLinks: NarrativeDocBrief[];
  recentDocs: NarrativeDocBrief[];
}

interface ScheduleStats {
  total: number;
  active: number;
  done: number;
  overdue: number;
  blocked: number;
  dueSoon: number;
  totalMinutes: number;
  missingOwner: number;
  missingDueDate: number;
  missingDocs: number;
}

interface CommandCenterResult {
  generatedAt: string;
  scannedDocs: number;
  skippedDocs: number;
  actionItems: CommandActionItem[];
  risks: CommandRiskItem[];
  qaItems: CommandQAItem[];
  narrative: NarrativeChainStats;
  schedule: ScheduleStats;
  recommendations: string[];
}

interface ProductionCommandCenterProps {
  vaultPath: string;
  vaultIndex: VaultIndex;
  onOpenFile: (relativePath: string) => void;
  onRefreshVault?: () => Promise<void>;
  onOpenTeamWorkspace?: () => Promise<void> | void;
}

const MAX_SCANNED_DOCS = 400;
const SCAN_BATCH_SIZE = 16;
const SCHEDULE_DIR = '.ars-team';
const SCHEDULE_FILE = 'schedule.json';

const EMPTY_SCHEDULE: ScheduleStats = {
  total: 0,
  active: 0,
  done: 0,
  overdue: 0,
  blocked: 0,
  dueSoon: 0,
  totalMinutes: 0,
  missingOwner: 0,
  missingDueDate: 0,
  missingDocs: 0,
};

const EMPTY_NARRATIVE_CHAIN: NarrativeChainStats = {
  worldbuilding: 0,
  story: 0,
  quest: 0,
  dialogue: 0,
  performance: 0,
  taskTable: 0,
  pipeline: 0,
  missingStages: [],
  weakLinks: [],
  docsWithoutNarrativeLinks: [],
  recentDocs: [],
};

const NARRATIVE_STAGE_LABELS: Record<NarrativeStage, string> = {
  worldbuilding: '世界观',
  story: '剧情',
  quest: '任务',
  dialogue: '台词',
  performance: '演出',
  taskTable: '任务表',
};

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function normalizeLinkKey(value: string): string {
  return normalizePath(value || '')
    .replace(/\.md$/i, '')
    .split('/')
    .pop()
    ?.toLowerCase()
    .trim() || '';
}

function classifyNarrativeStage(entry: NoteIndexEntry): NarrativeStage | null {
  const relativePath = normalizePath(entry.relativePath || entry.filePath || '');
  const title = String(entry.title || entry.fileName || '');
  const tags = (entry.tags || []).join(' ');
  const text = `${relativePath}\n${title}\n${tags}`.toLowerCase();

  if (/(narrativetasktable|tasktable|task table|production task|implementation task|07_unity_tasks|07_unity|07_unitytasks|任务表|任务清单|开发任务表)/i.test(text)) {
    return 'taskTable';
  }
  if (/(dialoguescript|dialoguescene|dialogue profile|dialogue script|dialogue scene|banter|台词|对白|对话|闲聊)/i.test(text)) {
    return 'dialogue';
  }
  if (/(performancesheet|performance sheet|cutscene|storyboard|cinematic|分镜|演出|过场|过场动画)/i.test(text)) {
    return 'performance';
  }
  if (/(plotoutline|storyarc|plot outline|story arc|剧情|故事线|剧情大纲|story|plot)/i.test(text)) {
    return 'story';
  }
  if (/^(06_quests|06_quests\/|06_Quests\/)/i.test(relativePath) || /(quest|任务设计|主线任务|支线任务)/i.test(text)) {
    return 'quest';
  }
  if (/^(02_worldbuilding|02_worldbuilding\/|02_Worldbuilding\/)/i.test(relativePath) || /(worldbible|worldbuilding|world overview|location|faction|race|species|timeline|lore|世界观|地点|派系|时间线)/i.test(text)) {
    return 'worldbuilding';
  }
  return null;
}

function buildNarrativeChainStats(entries: NoteIndexEntry[]): NarrativeChainStats {
  const narrativeDocs = entries
    .map((entry) => ({ entry, type: classifyNarrativeStage(entry) }))
    .filter((item): item is { entry: NoteIndexEntry; type: NarrativeStage } => Boolean(item.type));
  const targetToStage = new Map<string, NarrativeStage>();

  for (const { entry, type } of narrativeDocs) {
    const relativePath = normalizePath(entry.relativePath || entry.filePath || '');
    const title = String(entry.title || entry.fileName || '').replace(/\.md$/i, '');
    const base = relativePath.split('/').pop()?.replace(/\.md$/i, '') || title;
    for (const key of [normalizeLinkKey(title), normalizeLinkKey(base), normalizeLinkKey(relativePath)]) {
      if (!key) continue;
      targetToStage.set(key, type);
    }
  }

  const docs: NarrativeDocBrief[] = [];
  const linkedPairs = new Set<string>();
  for (const { entry, type } of narrativeDocs) {
    const relativePath = normalizePath(entry.relativePath || entry.filePath || '');
    const narrativeTargets = new Set<NarrativeStage>();
    for (const link of entry.wikiLinks || []) {
      const stage = targetToStage.get(normalizeLinkKey(link));
      if (!stage) continue;
      narrativeTargets.add(stage);
      linkedPairs.add(`${type}->${stage}`);
    }
    docs.push({
      type,
      title: String(entry.title || entry.fileName || relativePath),
      relativePath,
      status: String(entry.metadata?.status || ''),
      owner: String(entry.metadata?.owner || ''),
      priority: String(entry.metadata?.priority || ''),
      linkCount: (entry.wikiLinks || []).length,
      narrativeLinkCount: narrativeTargets.size,
    });
  }

  const counts = docs.reduce((acc, item) => {
    acc[item.type] += 1;
    return acc;
  }, {
    worldbuilding: 0,
    story: 0,
    quest: 0,
    dialogue: 0,
    performance: 0,
    taskTable: 0,
  } as Record<NarrativeStage, number>);

  const requiredStages: NarrativeStage[] = ['worldbuilding', 'story', 'quest', 'dialogue', 'performance', 'taskTable'];
  const missingStages = requiredStages.filter((stage) => counts[stage] === 0);
  const weakLinks: string[] = [];
  const expectPair = (from: NarrativeStage, to: NarrativeStage, text: string) => {
    if (counts[from] > 0 && counts[to] > 0 && !linkedPairs.has(`${from}->${to}`) && !linkedPairs.has(`${to}->${from}`)) {
      weakLinks.push(text);
    }
  };
  expectPair('worldbuilding', 'story', '世界观和剧情之间缺少明确链接');
  expectPair('story', 'quest', '剧情和任务之间缺少明确链接');
  expectPair('quest', 'dialogue', '任务和台词之间缺少明确链接');
  expectPair('dialogue', 'performance', '台词和演出表之间缺少明确链接');
  expectPair('performance', 'taskTable', '演出表和实现任务表之间缺少明确链接');

  const pipeline = docs.filter((doc) => /narrativepipeline/i.test(doc.relativePath) || /叙事制作管线|narrative pipeline/i.test(doc.title)).length;
  if (pipeline === 0 && docs.length > 0) {
    weakLinks.unshift('缺少 NarrativePipeline 作为世界观、剧情、台词、演出和任务表的总入口');
  }

  const docsWithoutNarrativeLinks = docs
    .filter((doc) => doc.narrativeLinkCount === 0)
    .sort((a, b) => a.type.localeCompare(b.type) || a.relativePath.localeCompare(b.relativePath, 'zh-CN'))
    .slice(0, 12);

  const recentDocs = [...docs]
    .sort((a, b) => {
      const aScore = (a.priority || '').toLowerCase() === 'high' ? 1 : 0;
      const bScore = (b.priority || '').toLowerCase() === 'high' ? 1 : 0;
      return bScore - aScore || a.relativePath.localeCompare(b.relativePath, 'zh-CN');
    })
    .slice(0, 10);

  return {
    ...counts,
    pipeline,
    missingStages,
    weakLinks: weakLinks.slice(0, 10),
    docsWithoutNarrativeLinks,
    recentDocs,
  };
}

function normalizeDate(value: string): string {
  const match = String(value || '').match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!match) return '';
  return [
    match[1],
    match[2].padStart(2, '0'),
    match[3].padStart(2, '0'),
  ].join('-');
}

function todayKey(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
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

function minutesToLabel(minutes: number): string {
  const total = Math.max(0, Math.round(minutes || 0));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

function extractOwner(text: string): string {
  const explicit = text.match(/负责人\s*[:：]\s*([^\s,，。;；#]+)/);
  if (explicit) return explicit[1].trim();
  const mention = text.match(/@([^\s,，。;；#]+)/);
  return mention ? mention[1].trim() : '';
}

function extractDueDate(text: string): string {
  const match = text.match(/(?:due|deadline|截止|到期|完成时间)\s*[:：]?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/i);
  return match ? normalizeDate(match[1]) : '';
}

function extractPriority(text: string): ProductionPriority {
  if (/(?:#?p0\b|#?p1\b|#?high\b|高优先级|高优先|紧急|严重|必须)/i.test(text)) return 'high';
  if (/(?:#?p3\b|#?low\b|低优先级|低优先|可延后|以后再做)/i.test(text)) return 'low';
  return 'medium';
}

function cleanInlineText(text: string): string {
  return text
    .replace(/\s+#(?:p0|p1|p2|p3|high|medium|low)\b/gi, '')
    .replace(/\s+(?:due|deadline|截止|到期|完成时间)\s*[:：]?\s*\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/gi, '')
    .trim();
}

function stripMarkdown(text: string): string {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/\[\[([^|\]]+)\|([^\]]+)]]/g, '$2')
    .replace(/\[\[([^\]]+)]]/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return [];
  return trimmed.slice(1, -1).split('|').map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function findColumn(headers: string[], patterns: RegExp[], fallback = -1): number {
  const normalized = headers.map(stripMarkdown);
  const index = normalized.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
  return index >= 0 ? index : fallback;
}

function cleanTableCell(cells: string[], index: number): string {
  if (index < 0) return '';
  return stripMarkdown(cells[index] || '');
}

function extractWikiOrPath(text: string): string {
  const wiki = String(text || '').match(/\[\[([^|\]]+)(?:\|[^\]]+)?]]/);
  if (wiki) {
    const target = wiki[1].trim().replace(/\\/g, '/');
    return target.endsWith('.md') ? target : `${target}.md`;
  }
  const path = String(text || '').match(/([A-Za-z0-9_.\-/\u4e00-\u9fa5]+\.md)/);
  return path ? path[1].replace(/\\/g, '/').trim() : '';
}

function normalizeTableStatus(value: string): string {
  const raw = stripMarkdown(value).toLowerCase().replace(/[_-]/g, ' ').trim();
  if (/(done|completed|complete|closed|完成|已完成|关闭)/i.test(raw)) return 'done';
  if (/(blocked|blocker|卡住|阻塞)/i.test(raw)) return 'blocked';
  if (/(review|验收|检查|待确认|待审核)/i.test(raw)) return 'review';
  if (/(doing|wip|in progress|进行中|处理中|制作中|开发中)/i.test(raw)) return 'doing';
  return raw || 'todo';
}

function parseTaskTables(relativePath: string, lines: string[]): CommandActionItem[] {
  const items: CommandActionItem[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const headers = splitMarkdownTableRow(lines[i]);
    if (headers.length < 2) continue;
    const separator = splitMarkdownTableRow(lines[i + 1] || '');
    if (!isSeparatorRow(separator)) continue;

    const titleIdx = findColumn(headers, [
      /交付|deliverable/i,
      /任务|事项|行动|工作|内容/i,
      /\btask\b|\baction\b|\bwork\b/i,
    ]);
    const idIdx = findColumn(headers, [/^id$/i, /编号|序号/i]);
    const categoryIdx = findColumn(headers, [/类别|分类|category|type/i]);
    const ownerIdx = findColumn(headers, [/负责人|owner|工种|discipline|成员|assignee/i]);
    const priorityIdx = findColumn(headers, [/优先|priority|P级|级别/i]);
    const dependencyIdx = findColumn(headers, [/依赖|dependency|depends/i]);
    const docIdx = findColumn(headers, [/关联文档|文档|doc|link|链接/i]);
    const notesIdx = findColumn(headers, [/实现|说明|备注|notes|implementation/i]);
    const acceptanceIdx = findColumn(headers, [/验收|acceptance|测试|test/i]);
    const dueIdx = findColumn(headers, [/截止|日期|due|deadline|完成时间/i]);
    const statusIdx = findColumn(headers, [/状态|status/i]);
    const hasTaskShape = titleIdx >= 0 && (
      ownerIdx >= 0 || priorityIdx >= 0 || docIdx >= 0 || acceptanceIdx >= 0 || statusIdx >= 0
    );
    if (!hasTaskShape) continue;

    let row = i + 2;
    while (row < lines.length) {
      const cells = splitMarkdownTableRow(lines[row]);
      if (cells.length < 2 || isSeparatorRow(cells)) break;

      const title = cleanTableCell(cells, titleIdx);
      const status = normalizeTableStatus(cleanTableCell(cells, statusIdx));
      if (title && status !== 'done') {
        const id = cleanTableCell(cells, idIdx);
        const category = cleanTableCell(cells, categoryIdx);
        const owner = cleanTableCell(cells, ownerIdx);
        const priorityText = cleanTableCell(cells, priorityIdx);
        const dependency = cleanTableCell(cells, dependencyIdx);
        const docRaw = cells[docIdx] || '';
        const docText = cleanTableCell(cells, docIdx);
        const implementation = cleanTableCell(cells, notesIdx);
        const acceptance = cleanTableCell(cells, acceptanceIdx);
        const dueDate = cleanTableCell(cells, dueIdx);
        const details = [
          id ? `ID：${id}` : '',
          category ? `类别：${category}` : '',
          dependency ? `依赖：${dependency}` : '',
          implementation ? `实现：${implementation}` : '',
          acceptance ? `验收：${acceptance}` : '',
        ].filter(Boolean).join('；');

        items.push({
          id: `${relativePath}:${row + 1}:table:${id || title}`,
          text: id ? `${id} ${title}` : title,
          relativePath,
          line: row + 1,
          owner,
          dueDate: normalizeDate(dueDate),
          priority: extractPriority(priorityText || `${title} ${details}`),
          source: 'markdown',
          status: status === 'blocked' || status === 'review' || status === 'doing' ? status : 'todo',
          linkedDoc: extractWikiOrPath(docRaw) || (docText ? extractWikiOrPath(docText) : ''),
          dependency,
          acceptance,
          blocker: status === 'blocked' ? dependency || implementation : '',
          details,
        });
      }
      row += 1;
    }
    i = row;
  }
  return items;
}

function markdownCell(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').trim();
}

function wikiLink(relativePath: string, label?: string): string {
  const clean = normalizePath(relativePath || '').trim();
  if (!clean) return '-';
  const target = clean.replace(/\.md$/i, '');
  return `[[${target}${label ? `|${label}` : ''}]]`;
}

function buildProductionRadarReport(result: CommandCenterResult): string {
  const generated = result.generatedAt.replace('T', ' ').substring(0, 19);
  const markdownActions = result.actionItems.filter((item) => item.source === 'markdown');
  const scheduleActions = result.actionItems.filter((item) => item.source === 'schedule');
  const missingOwner = result.actionItems.filter((item) => !item.owner).length;
  const missingDueDate = result.actionItems.filter((item) => !item.dueDate).length;
  const lines: string[] = [];

  lines.push('---');
  lines.push('type: ars-production-radar');
  lines.push(`generated: ${JSON.stringify(result.generatedAt)}`);
  lines.push(`scannedDocs: ${result.scannedDocs}`);
  lines.push(`skippedDocs: ${result.skippedDocs}`);
  lines.push('tags:');
  lines.push('  - production-radar');
  lines.push('  - game-dev');
  lines.push('---');
  lines.push('');
  lines.push('# 制作巡检报告');
  lines.push('');
  lines.push(`> 生成时间：${generated}`);
  lines.push('');

  lines.push('## 摘要');
  lines.push(`- 扫描文档：${result.scannedDocs} 个${result.skippedDocs > 0 ? `，另有 ${result.skippedDocs} 个超出扫描上限` : ''}。`);
  lines.push(`- 行动项：${result.actionItems.length} 个，其中来自文档/任务表 ${markdownActions.length} 个，来自团队时间表 ${scheduleActions.length} 个。`);
  lines.push(`- 风险/阻塞记录：${result.risks.length} 条。`);
  lines.push(`- QA / Bug / 试玩反馈：${result.qaItems.length} 条，其中高严重度 ${result.qaItems.filter((item) => item.severity === 'high').length} 条。`);
  lines.push(`- 缺负责人：${missingOwner} 个；缺截止日期：${missingDueDate} 个。`);
  lines.push(`- 团队时间表：总任务 ${result.schedule.total}，活跃 ${result.schedule.active}，完成 ${result.schedule.done}，逾期 ${result.schedule.overdue}，阻塞 ${result.schedule.blocked}，7 天内到期 ${result.schedule.dueSoon}，缺关联文档 ${result.schedule.missingDocs}，已记录用时 ${minutesToLabel(result.schedule.totalMinutes)}。`);
  lines.push('');

  lines.push('## 系统建议');
  if (result.recommendations.length === 0) {
    lines.push('- 暂无建议。');
  } else {
    for (const rec of result.recommendations) lines.push(`- ${rec}`);
  }
  lines.push('');

  lines.push('## 叙事链路健康');
  lines.push('| 阶段 | 文档数 |');
  lines.push('| --- | --- |');
  lines.push(`| 世界观 | ${result.narrative.worldbuilding} |`);
  lines.push(`| 剧情 | ${result.narrative.story} |`);
  lines.push(`| 任务 | ${result.narrative.quest} |`);
  lines.push(`| 台词 | ${result.narrative.dialogue} |`);
  lines.push(`| 演出 | ${result.narrative.performance} |`);
  lines.push(`| 任务表 | ${result.narrative.taskTable} |`);
  lines.push(`| 总入口 NarrativePipeline | ${result.narrative.pipeline} |`);
  lines.push('');
  if (result.narrative.missingStages.length > 0) {
    lines.push(`- 缺少阶段：${result.narrative.missingStages.map((stage) => NARRATIVE_STAGE_LABELS[stage]).join('、')}。`);
  }
  if (result.narrative.weakLinks.length > 0) {
    for (const weak of result.narrative.weakLinks) lines.push(`- ${weak}。`);
  }
  if (result.narrative.docsWithoutNarrativeLinks.length > 0) {
    lines.push('- 这些叙事文档还没有链接到其他叙事节点：');
    for (const doc of result.narrative.docsWithoutNarrativeLinks.slice(0, 8)) {
      lines.push(`  - ${NARRATIVE_STAGE_LABELS[doc.type]}：${wikiLink(doc.relativePath, doc.title)}`);
    }
  }
  if (result.narrative.missingStages.length === 0 && result.narrative.weakLinks.length === 0 && result.narrative.docsWithoutNarrativeLinks.length === 0) {
    lines.push('- 世界观、剧情、任务、台词、演出和任务表链路当前没有明显缺口。');
  }
  lines.push('');

  lines.push('## 今日优先行动');
  const topActions = result.actionItems.slice(0, 30);
  if (topActions.length === 0) {
    lines.push('- 暂无行动项。');
  } else {
    lines.push('| 优先级 | 状态 | 负责人 | 截止 | 任务 | 来源 | 关联 | 说明 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const item of topActions) {
      const source = item.source === 'schedule'
        ? '时间表'
        : `${wikiLink(item.relativePath)}${item.line > 1 ? `:${item.line}` : ''}`;
      lines.push([
        item.priority,
        item.status || 'todo',
        item.owner || '未分配',
        item.dueDate || '-',
        item.text,
        source,
        item.linkedDoc ? wikiLink(item.linkedDoc) : '-',
        item.details || '',
      ].map(markdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');

  lines.push('## QA / Bug / 试玩反馈');
  if (result.qaItems.length === 0) {
    lines.push('- 暂无未关闭 QA 项。');
  } else {
    lines.push('| 严重度 | 状态 | 类型 | 负责人 | 版本 | 问题 | 来源 | 说明 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const item of result.qaItems.slice(0, 40)) {
      lines.push([
        priorityLabel(item.severity),
        statusLabel(item.status),
        item.itemType,
        item.owner || '-',
        item.buildVersion || '-',
        item.text,
        `${wikiLink(item.relativePath)}:${item.line}`,
        item.details || '',
      ].map(markdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');

  lines.push('## 风险雷达');
  if (result.risks.length === 0) {
    lines.push('- 暂无明显风险。');
  } else {
    lines.push('| 严重度 | 风险 | 来源 |');
    lines.push('| --- | --- | --- |');
    for (const risk of result.risks.slice(0, 40)) {
      lines.push([
        risk.severity,
        risk.text,
        `${wikiLink(risk.relativePath)}:${risk.line}`,
      ].map(markdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');

  lines.push('## 需要制作人补齐');
  const needAttention = result.actionItems.filter((item) => !item.owner || !item.dueDate).slice(0, 25);
  if (needAttention.length === 0) {
    lines.push('- 暂无明显缺口。');
  } else {
    for (const item of needAttention) {
      const gaps = [!item.owner ? '缺负责人' : '', !item.dueDate ? '缺截止日期' : ''].filter(Boolean).join(' / ');
      lines.push(`- ${gaps}：${item.text}（${item.relativePath ? `${wikiLink(item.relativePath)}:${item.line}` : '时间表'}）`);
    }
  }
  lines.push('');

  lines.push('## 明日复查清单');
  lines.push('- [ ] 高优先级行动项是否已经进入团队时间表。');
  lines.push('- [ ] 阻塞项是否写清楚卡点、需要谁支持、下一步决策。');
  lines.push('- [ ] 叙事任务表中的世界观、剧情、台词、演出、Unity 实现是否都有对应负责人。');
  lines.push('- [ ] 今日新增文档是否包含 status / priority / owner / acceptance criteria。');
  lines.push('');
  lines.push(`*Generated by Ars-note Production Command Center at ${result.generatedAt}*`);

  return lines.join('\n');
}

function priorityLabel(priority: ProductionPriority): string {
  if (priority === 'high') return '高';
  if (priority === 'low') return '低';
  return '中';
}

function statusLabel(status?: string): string {
  if (status === 'doing') return '进行中';
  if (status === 'review') return '待验收';
  if (status === 'blocked') return '卡住';
  if (status === 'done') return '完成';
  return '待办';
}

function sourceLink(item: CommandActionItem): string {
  const source = normalizePath(item.relativePath || item.linkedDoc || '').trim();
  if (!source) return `\`${SCHEDULE_DIR}/${SCHEDULE_FILE}\``;
  const link = /\.md$/i.test(source) ? wikiLink(source) : `\`${source}\``;
  return item.line > 1 ? `${link}:${item.line}` : link;
}

function groupActionsByOwner(items: CommandActionItem[]): Array<{ owner: string; items: CommandActionItem[] }> {
  const groups = new Map<string, CommandActionItem[]>();
  for (const item of items) {
    const owner = item.owner?.trim() || '未分配';
    const existing = groups.get(owner) || [];
    existing.push(item);
    groups.set(owner, existing);
  }
  return Array.from(groups.entries())
    .map(([owner, groupItems]) => ({ owner, items: groupItems }))
    .sort((a, b) => {
      if (a.owner === '未分配') return -1;
      if (b.owner === '未分配') return 1;
      return priorityWeight(b.items[0]?.priority || 'low') - priorityWeight(a.items[0]?.priority || 'low')
        || a.owner.localeCompare(b.owner, 'zh-CN');
    });
}

function buildDailyProductionBrief(result: CommandCenterResult): string {
  const generated = result.generatedAt.replace('T', ' ').substring(0, 19);
  const today = todayKey();
  const topActions = result.actionItems.slice(0, 12);
  const ownerGroups = groupActionsByOwner(result.actionItems.slice(0, 60));
  const highRisks = result.risks.filter((risk) => risk.severity === 'high');
  const mediumRisks = result.risks.filter((risk) => risk.severity === 'medium');
  const missingOwner = result.actionItems.filter((item) => !item.owner).length;
  const missingDueDate = result.actionItems.filter((item) => !item.dueDate).length;
  const overdue = result.actionItems.filter((item) => item.dueDate && item.dueDate < today);
  const dueToday = result.actionItems.filter((item) => item.dueDate === today);
  const blocked = result.actionItems.filter((item) => item.status === 'blocked' || item.blocker);
  const highQA = result.qaItems.filter((item) => item.severity === 'high');
  const lines: string[] = [];

  lines.push('---');
  lines.push('type: ars-production-daily-brief');
  lines.push(`generated: ${JSON.stringify(result.generatedAt)}`);
  lines.push(`date: ${JSON.stringify(today)}`);
  lines.push(`schedule: ${JSON.stringify(`${SCHEDULE_DIR}/${SCHEDULE_FILE}`)}`);
  lines.push('tags:');
  lines.push('  - production-brief');
  lines.push('  - team-daily');
  lines.push('  - game-dev');
  lines.push('---');
  lines.push('');
  lines.push(`# 每日制作指挥简报 ${today}`);
  lines.push('');
  lines.push(`> 生成时间：${generated}。这份简报会跟随 Vault 同步，适合作为当天团队工作入口。`);
  lines.push('');

  lines.push('## 今日判断');
  lines.push(`- 时间表：总任务 ${result.schedule.total}，活跃 ${result.schedule.active}，完成 ${result.schedule.done}，7 天内到期 ${result.schedule.dueSoon}，已记录用时 ${minutesToLabel(result.schedule.totalMinutes)}。`);
  lines.push(`- 风险：逾期 ${result.schedule.overdue || overdue.length}，卡住 ${result.schedule.blocked || blocked.length}，高风险 ${highRisks.length}，中风险 ${mediumRisks.length}。`);
  lines.push(`- QA：未关闭 Bug / 试玩反馈 ${result.qaItems.length} 条，高严重度 ${highQA.length} 条。`);
  lines.push(`- 叙事链路：世界观 ${result.narrative.worldbuilding}，剧情 ${result.narrative.story}，任务 ${result.narrative.quest}，台词 ${result.narrative.dialogue}，演出 ${result.narrative.performance}，任务表 ${result.narrative.taskTable}；缺口 ${result.narrative.missingStages.length}，弱链接 ${result.narrative.weakLinks.length}。`);
  lines.push(`- 数据缺口：缺负责人 ${missingOwner}，缺截止日期 ${missingDueDate}，缺可打开任务文档 ${result.schedule.missingDocs}。`);
  lines.push(`- 扫描范围：${result.scannedDocs} 个文档${result.skippedDocs > 0 ? `，另有 ${result.skippedDocs} 个文档未纳入本次扫描` : ''}。`);
  lines.push('');

  lines.push('## 今日焦点');
  if (topActions.length === 0) {
    lines.push('- 暂无明确行动项。');
  } else {
    lines.push('| 优先级 | 状态 | 负责人 | 截止 | 任务 | 入口 | 验收/说明 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const item of topActions) {
      lines.push([
        priorityLabel(item.priority),
        statusLabel(item.status),
        item.owner || '未分配',
        item.dueDate || '-',
        item.text,
        sourceLink(item),
        item.acceptance || item.details || item.dependency || item.blocker || '',
      ].map(markdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');

  lines.push('## 按负责人推进');
  if (ownerGroups.length === 0) {
    lines.push('- 暂无可分配任务。');
  } else {
    for (const group of ownerGroups.slice(0, 12)) {
      lines.push(`### ${group.owner}`);
      for (const item of group.items.slice(0, 8)) {
        const tags = [
          priorityLabel(item.priority),
          statusLabel(item.status),
          item.dueDate ? `截止 ${item.dueDate}` : '缺截止',
          item.source === 'schedule' ? '时间表' : '文档待办',
        ].join(' / ');
        lines.push(`- [ ] ${item.text}（${tags}）`);
        lines.push(`  - 入口：${sourceLink(item)}`);
        if (item.dependency) lines.push(`  - 依赖：${item.dependency}`);
        if (item.blocker) lines.push(`  - 卡点：${item.blocker}`);
        if (item.acceptance) lines.push(`  - 验收：${item.acceptance}`);
      }
      lines.push('');
    }
  }

  lines.push('## QA / Bug / 试玩反馈');
  if (result.qaItems.length === 0) {
    lines.push('- 暂无未关闭 QA 项。');
  } else {
    for (const item of result.qaItems.slice(0, 18)) {
      const tags = [
        priorityLabel(item.severity),
        statusLabel(item.status),
        item.itemType,
        item.buildVersion ? `版本 ${item.buildVersion}` : '',
        item.owner ? `负责人 ${item.owner}` : '缺负责人',
      ].filter(Boolean).join(' / ');
      lines.push(`- [ ] ${item.text}（${tags}）`);
      lines.push(`  - 来源：${wikiLink(item.relativePath)}:${item.line}`);
      if (item.details) lines.push(`  - 说明：${item.details}`);
    }
  }
  lines.push('');

  lines.push('## 风险与决策');
  const importantRisks = [...highRisks, ...mediumRisks, ...result.risks.filter((risk) => risk.severity === 'low')].slice(0, 20);
  if (importantRisks.length === 0) {
    lines.push('- 暂无明显风险记录。');
  } else {
    lines.push('| 严重度 | 风险 | 来源 | 需要的动作 |');
    lines.push('| --- | --- | --- | --- |');
    for (const risk of importantRisks) {
      const action = risk.severity === 'high' ? '今天定负责人和处理方案' : '本周内复查并补充结论';
      lines.push([
        priorityLabel(risk.severity),
        risk.text,
        `${wikiLink(risk.relativePath)}:${risk.line}`,
        action,
      ].map(markdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
  }
  lines.push('');

  lines.push('## 生产缺口');
  if (missingOwner === 0 && missingDueDate === 0 && result.schedule.missingDocs === 0 && dueToday.length === 0) {
    lines.push('- 当前没有明显的负责人、截止日期或任务文档缺口。');
  } else {
    if (missingOwner > 0) lines.push(`- [ ] 给 ${missingOwner} 个行动项补负责人。`);
    if (missingDueDate > 0) lines.push(`- [ ] 给 ${missingDueDate} 个行动项补截止日期。`);
    if (result.schedule.missingDocs > 0) lines.push(`- [ ] 在团队时间表点击“生成缺失任务文档”，补齐 ${result.schedule.missingDocs} 个任务入口。`);
    if (dueToday.length > 0) lines.push(`- [ ] 今天到期 ${dueToday.length} 个行动项，收尾前确认验收结果。`);
  }
  lines.push('');

  lines.push('## AI 接管提示');
  lines.push('- 点击制作指挥中心里的“AI接管”，让 AI 先同步任务文档，再读取生产健康状态，然后补齐任务表。');
  lines.push('- 要求 AI 输出：今天 5 个最高优先级、每个负责人下一步、风险处理方案、叙事链路影响、明日验收清单。');
  lines.push('- 如果 AI 新增任务，必须写入团队时间表并关联到具体文档，不能只停留在建议。');
  lines.push('');

  lines.push('## 收工复查');
  lines.push('- [ ] 今日焦点里的高优先级项是否已有结果或新卡点。');
  lines.push('- [ ] 每个成员是否至少记录一条工时或进展。');
  lines.push('- [ ] 卡住任务是否写清楚“谁能解除卡点”。');
  lines.push('- [ ] 新增剧情、台词、演出、任务表是否已经拆成 Unity / 美术 / 叙事执行任务。');
  lines.push('- [ ] 缺文档任务是否已经生成工作页。');
  lines.push('');
  lines.push(`*Generated by Ars-note Production Command Center at ${result.generatedAt}*`);

  return lines.join('\n');
}

function riskSeverity(text: string): ProductionPriority {
  if (/(阻塞|卡住|严重|宕机|不可用|critical|blocker|blocked|fatal)/i.test(text)) return 'high';
  if (/(风险|延期|依赖|不稳定|risk|delay|dependency)/i.test(text)) return 'medium';
  return 'low';
}

function extractFieldFromContent(content: string, labels: string[]): string {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bold = content.match(new RegExp(`^\\s*-?\\s*\\*\\*\\s*${escaped}\\s*\\*\\*\\s*[:：]?\\s*(.+?)\\s*$`, 'im'));
    if (bold?.[1]) return stripMarkdown(bold[1]);
    const plain = content.match(new RegExp(`^\\s*-?\\s*${escaped}\\s*[:：]\\s*(.+?)\\s*$`, 'im'));
    if (plain?.[1]) return stripMarkdown(plain[1]);
  }
  return '';
}

function normalizeQAStatus(value: string): string {
  const raw = stripMarkdown(value).toLowerCase().trim();
  if (/(fixed|done|closed|resolved|verified|pass|通过|已修复|已关闭|已解决|完成|验证通过)/i.test(raw)) return 'closed';
  if (/(in progress|doing|wip|处理中|修复中|进行中)/i.test(raw)) return 'doing';
  if (/(review|verify|待验证|待验收|待确认|复测)/i.test(raw)) return 'review';
  if (/(open|todo|new|fail|失败|打开|未解决|待处理)/i.test(raw)) return 'open';
  return raw || 'open';
}

function qaSeverityFromText(text: string): ProductionPriority {
  if (/(critical|blocker|fatal|crash|p0|p1|严重|崩溃|卡死|阻塞|无法继续|主流程断)/i.test(text)) return 'high';
  if (/(major|p2|中等|明显|影响体验|性能|卡顿|错误|异常|bug)/i.test(text)) return 'medium';
  return 'low';
}

function extractSectionPreview(lines: string[], headings: string[]): string {
  const headingRe = new RegExp(`^#{1,6}\\s*(?:${headings.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*$`, 'i');
  const start = lines.findIndex((line) => headingRe.test(line.trim()));
  if (start < 0) return '';
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,6}\s+/.test(lines[i])) break;
    const clean = stripMarkdown(lines[i].replace(/^[-*+]\s+/, ''));
    if (clean) body.push(clean);
    if (body.length >= 2) break;
  }
  return body.join('；').slice(0, 180);
}

function qaTypeForDoc(relativePath: string, content: string): QAItemType {
  const head = `${relativePath}\n${content.slice(0, 500)}`;
  if (/(bug|缺陷|错误报告|Bug 报告|Bug报告)/i.test(head)) return 'bug';
  if (/(playtest|测试报告|试玩|反馈)/i.test(head)) return 'playtest';
  return 'feedback';
}

function isQADoc(relativePath: string, content: string): boolean {
  return /(bug|缺陷|错误报告|Bug 报告|Bug报告|playtest|测试报告|试玩|反馈|复现步骤|实际行为|预期行为)/i
    .test(`${relativePath}\n${content.slice(0, 1400)}`);
}

function parseQAIssues(relativePath: string, content: string, lines: string[]): CommandQAItem[] {
  if (!isQADoc(relativePath, content)) return [];
  const items: CommandQAItem[] = [];
  const itemType = qaTypeForDoc(relativePath, content);
  const docStatus = normalizeQAStatus(extractFieldFromContent(content, ['Status', '状态', '狀態']));
  const docSeverity = qaSeverityFromText(extractFieldFromContent(content, ['Severity', '严重程度', '嚴重程度', 'Priority', '优先级', '優先級']) || content);
  const owner = extractFieldFromContent(content, ['Assignee', 'Owner', '负责人', '負責人', '测试者', '測試者']);
  const buildVersion = extractFieldFromContent(content, ['Build Version', '构建版本', '構建版本', '版本']);
  const title = stripMarkdown((lines.find((line) => /^#\s+/.test(line)) || '').replace(/^#\s+/, '')) || relativePath.replace(/\.md$/i, '');

  if (itemType === 'bug' && docStatus !== 'closed') {
    const expected = extractSectionPreview(lines, ['Expected Behavior', '预期行为', '預期行為']);
    const actual = extractSectionPreview(lines, ['Actual Behavior', '实际行为', '實際行為']);
    items.push({
      id: `${relativePath}:doc-bug`,
      text: title,
      relativePath,
      line: 1,
      severity: docSeverity,
      status: docStatus,
      owner,
      buildVersion,
      itemType,
      details: [actual ? `实际：${actual}` : '', expected ? `预期：${expected}` : ''].filter(Boolean).join('；'),
    });
  }

  let qaSectionDepth = 0;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const lineNo = index + 1;
    if (/^#{1,6}\s*(反馈|问题|Bug|缺陷|异常|测试结论|Playtest Feedback|Feedback|Issues?|Bugs?)/i.test(trimmed)) {
      qaSectionDepth = 20;
      return;
    }
    if (!trimmed) {
      if (qaSectionDepth > 0) qaSectionDepth -= 1;
      return;
    }
    const bullet = trimmed.match(/^[-*+]\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/);
    const direct = /(bug|缺陷|异常|崩溃|卡死|反馈|问题|不舒服|不好用|卡顿|穿模|丢失|错误)/i.test(trimmed);
    if ((qaSectionDepth > 0 && bullet) || direct) {
      const text = cleanInlineText(stripMarkdown((bullet?.[1] || trimmed).replace(/^反馈[:：]\s*/i, '')));
      const status = normalizeQAStatus(text);
      if (text && status !== 'closed') {
        items.push({
          id: `${relativePath}:${lineNo}:qa`,
          text,
          relativePath,
          line: lineNo,
          severity: qaSeverityFromText(text),
          status: status === text.toLowerCase() ? 'open' : status,
          owner: extractOwner(text) || owner,
          buildVersion,
          itemType: itemType === 'bug' ? 'bug' : 'feedback',
        });
      }
    }
    if (qaSectionDepth > 0) qaSectionDepth -= 1;
  });

  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.relativePath}:${item.line}:${item.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseMarkdownContent(relativePath: string, content: string): {
  actionItems: CommandActionItem[];
  risks: CommandRiskItem[];
  qaItems: CommandQAItem[];
} {
  const actionItems: CommandActionItem[] = [];
  const risks: CommandRiskItem[] = [];
  const qaItems: CommandQAItem[] = [];
  const seenRisks = new Set<string>();
  const lines = content.split(/\r?\n/);
  actionItems.push(...parseTaskTables(relativePath, lines));
  qaItems.push(...parseQAIssues(relativePath, content, lines));
  let riskSectionDepth = 0;

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const trimmed = line.trim();
    if (!trimmed) {
      if (riskSectionDepth > 0) riskSectionDepth -= 1;
      return;
    }

    const taskMatch = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/);
    const todoMatch = taskMatch ? null : line.match(/^\s*(?:TODO|待办|行动项|Action)\s*[:：]\s+(.+?)\s*$/i);
    if (taskMatch && taskMatch[1].toLowerCase() !== 'x') {
      const rawText = taskMatch[2].trim();
      actionItems.push({
        id: `${relativePath}:${lineNo}:task`,
        text: cleanInlineText(rawText),
        relativePath,
        line: lineNo,
        owner: extractOwner(rawText),
        dueDate: extractDueDate(rawText),
        priority: extractPriority(rawText),
        source: 'markdown',
      });
    } else if (todoMatch) {
      const rawText = todoMatch[1].trim();
      actionItems.push({
        id: `${relativePath}:${lineNo}:todo`,
        text: cleanInlineText(rawText),
        relativePath,
        line: lineNo,
        owner: extractOwner(rawText),
        dueDate: extractDueDate(rawText),
        priority: extractPriority(rawText),
        source: 'markdown',
      });
    }

    if (/^#{1,6}\s*(风险|阻塞|问题|依赖|Risks?|Blockers?|Blocked)/i.test(trimmed)) {
      riskSectionDepth = 8;
      return;
    }

    const bulletInRiskSection = riskSectionDepth > 0 && /^\s*[-*+]\s+/.test(line);
    const directRiskLine = /(风险|阻塞|卡住|延期|依赖|不稳定|risk|blocker|blocked|delay|dependency)/i.test(trimmed);
    if ((bulletInRiskSection || directRiskLine) && !/^\s*[-*+]\s+\[[xX]\]/.test(line)) {
      const text = cleanInlineText(trimmed.replace(/^\s*[-*+]\s+/, ''));
      const key = `${relativePath}:${lineNo}`;
      if (text && !seenRisks.has(key)) {
        seenRisks.add(key);
        risks.push({
          id: `${key}:risk`,
          text,
          relativePath,
          line: lineNo,
          severity: riskSeverity(text),
        });
      }
    }

    if (riskSectionDepth > 0) riskSectionDepth -= 1;
  });

  return { actionItems, risks, qaItems };
}

function priorityWeight(priority: ProductionPriority): number {
  if (priority === 'high') return 3;
  if (priority === 'medium') return 2;
  return 1;
}

function sortActionItems(items: CommandActionItem[]): CommandActionItem[] {
  const today = todayKey();
  return [...items].sort((a, b) => {
    const aOverdue = a.dueDate && a.dueDate < today ? 1 : 0;
    const bOverdue = b.dueDate && b.dueDate < today ? 1 : 0;
    if (aOverdue !== bOverdue) return bOverdue - aOverdue;
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return priorityWeight(b.priority) - priorityWeight(a.priority)
      || a.text.localeCompare(b.text, 'zh-CN');
  });
}

function sortRisks(items: CommandRiskItem[]): CommandRiskItem[] {
  return [...items].sort((a, b) => priorityWeight(b.severity) - priorityWeight(a.severity)
    || a.relativePath.localeCompare(b.relativePath, 'zh-CN')
    || a.line - b.line);
}

function sortQAItems(items: CommandQAItem[]): CommandQAItem[] {
  return [...items].sort((a, b) => {
    const aOpen = a.status !== 'closed' ? 1 : 0;
    const bOpen = b.status !== 'closed' ? 1 : 0;
    if (aOpen !== bOpen) return bOpen - aOpen;
    return priorityWeight(b.severity) - priorityWeight(a.severity)
      || a.relativePath.localeCompare(b.relativePath, 'zh-CN')
      || a.line - b.line;
  });
}

function isIgnoredDoc(entry: NoteIndexEntry): boolean {
  const path = normalizePath(entry.relativePath || entry.filePath || '');
  if (!/\.md$/i.test(path)) return true;
  return path.startsWith('.ars-team/')
    || path.startsWith('.ars-ai/')
    || path.startsWith('.ars-live/')
    || path.startsWith('.ars-backups/')
    || path.startsWith('.trash/');
}

async function vaultRelativeToAbsolute(vaultPath: string, relativePath: string): Promise<string> {
  const api = window.arsnote;
  const parts = normalizePath(relativePath).split('/').filter(Boolean);
  return api.joinPath(vaultPath, ...parts);
}

async function scanMarkdownDocs(vaultPath: string, entries: NoteIndexEntry[]): Promise<{
  actionItems: CommandActionItem[];
  risks: CommandRiskItem[];
  qaItems: CommandQAItem[];
}> {
  const actionItems: CommandActionItem[] = [];
  const risks: CommandRiskItem[] = [];
  const qaItems: CommandQAItem[] = [];
  const api = window.arsnote;

  for (let start = 0; start < entries.length; start += SCAN_BATCH_SIZE) {
    const batch = entries.slice(start, start + SCAN_BATCH_SIZE);
    const results = await Promise.all(batch.map(async (entry) => {
      try {
        const relativePath = normalizePath(entry.relativePath);
        const fullPath = entry.filePath || await vaultRelativeToAbsolute(vaultPath, relativePath);
        const content = await api.readFile(fullPath);
        return parseMarkdownContent(relativePath, content);
      } catch {
        return { actionItems: [], risks: [], qaItems: [] };
      }
    }));
    for (const result of results) {
      actionItems.push(...result.actionItems);
      risks.push(...result.risks);
      qaItems.push(...result.qaItems);
    }
  }

  return { actionItems, risks, qaItems };
}

function normalizeTaskStatus(value: unknown): string {
  const raw = String(value || 'todo').toLowerCase();
  if (raw === 'wip') return 'doing';
  if (['todo', 'doing', 'review', 'blocked', 'done'].includes(raw)) return raw;
  return 'todo';
}

function normalizeSchedulePriority(value: unknown): ProductionPriority {
  if (value === 'high' || value === 'medium' || value === 'low') return value;
  return 'medium';
}

async function readSchedule(vaultPath: string, documentPaths: string[] = []): Promise<{
  stats: ScheduleStats;
  actions: CommandActionItem[];
}> {
  try {
    const api = window.arsnote;
    const filePath = await api.joinPath(vaultPath, SCHEDULE_DIR, SCHEDULE_FILE);
    const raw = await api.readFile(filePath);
    const parsed = JSON.parse(raw);
    const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
    const today = todayKey();
    const soon = addDaysKey(7);
    const documentPathSet = new Set(documentPaths.map((item) => normalizePath(item).toLowerCase()));
    const stats: ScheduleStats = { ...EMPTY_SCHEDULE };
    const actions: CommandActionItem[] = [];

    for (const task of tasks) {
      const title = String(task?.title || '').trim();
      if (!title) continue;
      const status = normalizeTaskStatus(task?.status);
      const dueDate = normalizeDate(String(task?.dueDate || ''));
      const owner = String(task?.owner || '').trim();
      const linkedDoc = normalizePath(String(task?.linkedDoc || '').trim());
      const logs = Array.isArray(task?.logs) ? task.logs : [];
      const spent = logs.reduce((sum: number, log: any) => {
        const minutes = Number(log?.minutes || 0);
        return sum + (Number.isFinite(minutes) ? Math.max(0, minutes) : 0);
      }, 0);

      stats.total += 1;
      stats.totalMinutes += spent;
      if (status === 'done') stats.done += 1;
      else stats.active += 1;
      if (status === 'blocked') stats.blocked += 1;
      if (status !== 'done' && dueDate && dueDate < today) stats.overdue += 1;
      if (status !== 'done' && dueDate && dueDate >= today && dueDate <= soon) stats.dueSoon += 1;
      if (status !== 'done' && !owner) stats.missingOwner += 1;
      if (status !== 'done' && !dueDate) stats.missingDueDate += 1;
      if (status !== 'done' && linkedDoc && /\.md$/i.test(linkedDoc) && !documentPathSet.has(linkedDoc.toLowerCase())) {
        stats.missingDocs += 1;
      }

      if (status !== 'done') {
        actions.push({
          id: String(task?.id || `schedule:${title}`),
          text: title,
          relativePath: linkedDoc,
          line: 1,
          owner,
          dueDate,
          priority: normalizeSchedulePriority(task?.priority),
          source: 'schedule',
          status,
          dependency: String(task?.dependency || '').trim(),
          acceptance: String(task?.acceptance || '').trim(),
          blocker: String(task?.blocker || '').trim(),
          details: [
            task?.dependency ? `依赖：${task.dependency}` : '',
            task?.blocker ? `阻塞：${task.blocker}` : '',
            task?.acceptance ? `验收：${task.acceptance}` : '',
          ].filter(Boolean).join('；'),
        });
      }
    }

    return { stats, actions };
  } catch {
    return { stats: { ...EMPTY_SCHEDULE }, actions: [] };
  }
}

function buildRecommendations(result: Omit<CommandCenterResult, 'recommendations'>): string[] {
  const recs: string[] = [];
  const highRisks = result.risks.filter((risk) => risk.severity === 'high').length;
  const highQA = result.qaItems.filter((item) => item.severity === 'high' && item.status !== 'closed').length;
  const missingOwner = result.actionItems.filter((item) => !item.owner).length;
  const missingDueDate = result.actionItems.filter((item) => !item.dueDate).length;

  if (result.schedule.overdue > 0) {
    recs.push(`有 ${result.schedule.overdue} 个逾期任务，建议先开一个 15 分钟同步会确认是否改期或拆分。`);
  }
  if (result.schedule.blocked > 0) {
    recs.push(`有 ${result.schedule.blocked} 个阻塞任务，优先让负责人写清楚卡点和需要谁支持。`);
  }
  if (highRisks > 0) {
    recs.push(`发现 ${highRisks} 条高风险/阻塞记录，建议今天就补决策结论，避免问题藏在文档里。`);
  }
  if (highQA > 0) {
    recs.push(`发现 ${highQA} 个高严重度 QA/Bug/试玩反馈项，建议今天安排复现、修复负责人和验证标准。`);
  }
  if (result.narrative.missingStages.length > 0) {
    recs.push(`叙事链路缺少 ${result.narrative.missingStages.map((stage) => NARRATIVE_STAGE_LABELS[stage]).join('、')}，AI 接管叙事前建议先补齐这些核心文档。`);
  }
  if (result.narrative.weakLinks.length > 0) {
    recs.push(`叙事链路有 ${result.narrative.weakLinks.length} 个弱链接，建议把世界观、剧情、任务、台词、演出和任务表用 [[wiki-link]] 串起来。`);
  }
  if (missingOwner > 0 || missingDueDate > 0) {
    recs.push(`有 ${missingOwner} 个行动项缺负责人、${missingDueDate} 个行动项缺截止日期，补齐后 AI 才能更准确接管排期。`);
  }
  if (result.schedule.missingDocs > 0) {
    recs.push(`有 ${result.schedule.missingDocs} 个活跃任务缺可打开的关联文档，建议先生成任务文档，让成员能直接进入工作页。`);
  }
  if (result.skippedDocs > 0) {
    recs.push(`Vault 文档很多，本次先扫描前 ${result.scannedDocs} 个；需要更完整的生产巡检时可以提升扫描上限。`);
  }
  if (recs.length === 0) {
    recs.push('当前没有明显逾期、阻塞或高风险项，可以把精力放到下一批设计/实现拆解。');
  }
  return recs.slice(0, 5);
}

const ProductionCommandCenter: React.FC<ProductionCommandCenterProps> = ({
  vaultPath,
  vaultIndex,
  onOpenFile,
  onRefreshVault,
  onOpenTeamWorkspace,
}) => {
  const [result, setResult] = useState<CommandCenterResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exportingReport, setExportingReport] = useState(false);
  const [exportingBrief, setExportingBrief] = useState(false);
  const [importMessage, setImportMessage] = useState('');

  const allDocs = useMemo(() => {
    return Object.values(vaultIndex?.notes || {})
      .filter((entry) => !isIgnoredDoc(entry))
      .sort((a, b) => normalizePath(a.relativePath).localeCompare(normalizePath(b.relativePath), 'zh-CN'));
  }, [vaultIndex]);

  const runScan = useCallback(async () => {
    if (!vaultPath) return;
    setLoading(true);
    setError('');
    try {
      const docs = allDocs.slice(0, MAX_SCANNED_DOCS);
      const [{ actionItems, risks, qaItems }, schedule] = await Promise.all([
        scanMarkdownDocs(vaultPath, docs),
        readSchedule(vaultPath, allDocs.map((entry) => entry.relativePath)),
      ]);
      const nextWithoutRecs: Omit<CommandCenterResult, 'recommendations'> = {
        generatedAt: new Date().toISOString(),
        scannedDocs: docs.length,
        skippedDocs: Math.max(0, allDocs.length - docs.length),
        actionItems: sortActionItems([...actionItems, ...schedule.actions]),
        risks: sortRisks(risks),
        qaItems: sortQAItems(qaItems),
        narrative: buildNarrativeChainStats(allDocs),
        schedule: schedule.stats,
      };
      setResult({
        ...nextWithoutRecs,
        recommendations: buildRecommendations(nextWithoutRecs),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [allDocs, vaultPath]);

  useEffect(() => {
    void runScan();
  }, [runScan]);

  const summary = result || {
    generatedAt: '',
    scannedDocs: 0,
    skippedDocs: 0,
    actionItems: [],
    risks: [],
    qaItems: [],
    narrative: EMPTY_NARRATIVE_CHAIN,
    schedule: EMPTY_SCHEDULE,
    recommendations: [],
  };
  const today = todayKey();
  const overdueActions = summary.actionItems.filter((item) => item.dueDate && item.dueDate < today).length;
  const topActions = summary.actionItems.slice(0, 7);
  const topRisks = summary.risks.slice(0, 6);
  const topQAItems = summary.qaItems.slice(0, 6);
  const narrativeGapItems = [
    ...summary.narrative.missingStages.map((stage) => ({
      key: `missing:${stage}`,
      title: `缺少${NARRATIVE_STAGE_LABELS[stage]}文档`,
      detail: '建议用“创建叙事制作包”或让 AI 生成对应文档。',
      relativePath: '',
      severity: 'high' as ProductionPriority,
    })),
    ...summary.narrative.weakLinks.map((weak, index) => ({
      key: `weak:${index}`,
      title: weak,
      detail: '建议用 [[wiki-link]] 把相邻制作阶段串起来。',
      relativePath: '',
      severity: 'medium' as ProductionPriority,
    })),
    ...summary.narrative.docsWithoutNarrativeLinks.slice(0, 6).map((doc) => ({
      key: `orphan:${doc.relativePath}`,
      title: `${NARRATIVE_STAGE_LABELS[doc.type]}文档缺少叙事链接：${doc.title}`,
      detail: `${doc.relativePath} · 当前叙事链接 ${doc.narrativeLinkCount}`,
      relativePath: doc.relativePath,
      severity: 'low' as ProductionPriority,
    })),
  ].slice(0, 8);

  const handleExportRadarReport = useCallback(async () => {
    if (!result || !vaultPath) return;
    setExportingReport(true);
    setImportMessage('');
    setError('');
    try {
      const api = window.arsnote;
      const teamDir = await api.joinPath(vaultPath, SCHEDULE_DIR);
      try { await api.createFolder(teamDir); } catch { /* already exists */ }
      const reportDir = await api.joinPath(vaultPath, SCHEDULE_DIR, 'reports');
      try { await api.createFolder(reportDir); } catch { /* already exists */ }
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
      const fileName = `production-radar-${stamp}.md`;
      const filePath = await api.joinPath(vaultPath, SCHEDULE_DIR, 'reports', fileName);
      await api.writeFile(filePath, buildProductionRadarReport(result));
      const relativePath = `${SCHEDULE_DIR}/reports/${fileName}`;
      setImportMessage(`已导出制作巡检报告 ${relativePath}`);
      await onRefreshVault?.();
      onOpenFile(relativePath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingReport(false);
    }
  }, [onOpenFile, onRefreshVault, result, vaultPath]);

  const handleExportDailyBrief = useCallback(async () => {
    if (!result || !vaultPath) return;
    setExportingBrief(true);
    setImportMessage('');
    setError('');
    try {
      const api = window.arsnote;
      const teamDir = await api.joinPath(vaultPath, SCHEDULE_DIR);
      try { await api.createFolder(teamDir); } catch { /* already exists */ }
      const briefDir = await api.joinPath(vaultPath, SCHEDULE_DIR, 'briefs');
      try { await api.createFolder(briefDir); } catch { /* already exists */ }
      const fileName = `daily-brief-${todayKey()}.md`;
      const filePath = await api.joinPath(vaultPath, SCHEDULE_DIR, 'briefs', fileName);
      await api.writeFile(filePath, buildDailyProductionBrief(result));
      const relativePath = `${SCHEDULE_DIR}/briefs/${fileName}`;
      setImportMessage(`已生成今日制作简报 ${relativePath}`);
      await onRefreshVault?.();
      onOpenFile(relativePath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingBrief(false);
    }
  }, [onOpenFile, onRefreshVault, result, vaultPath]);

  return (
    <section className="production-command-card production-command-radar">
      <div className="production-command-header">
        <div>
          <div className="production-command-kicker">
            <CheckIcon size={13} />
            文档生产雷达
          </div>
          <p>只做文档、风险、QA 和叙事链路扫描；排期、成员任务、AI 接管和服务器状态集中到完整团队工作台处理。</p>
        </div>
        <div className="production-command-actions">
          {onOpenTeamWorkspace && (
            <button className="production-command-ai" onClick={() => { void onOpenTeamWorkspace(); }} title="打开完整 Ars-note 团队工作台">
              打开团队工作台
            </button>
          )}
          <button
            className="production-command-export"
            onClick={handleExportDailyBrief}
            disabled={!result || loading || exportingBrief}
            title="生成今天的团队制作简报，保存到 .ars-team/briefs 并同步给其他电脑"
          >
            {exportingBrief ? '生成中' : '生成今日简报'}
          </button>
          <button
            className="production-command-export"
            onClick={handleExportRadarReport}
            disabled={!result || loading || exportingReport}
            title="把本次扫描结果保存为 Ars-note Markdown 报告"
          >
            {exportingReport ? '导出中' : '导出巡检'}
          </button>
          <button className="production-command-refresh" onClick={runScan} disabled={loading} title="重新扫描">
            <RefreshIcon size={13} />
            {loading ? '扫描中' : '刷新'}
          </button>
        </div>
      </div>

      {error && <div className="production-command-error">{error}</div>}
      {importMessage && <div className="production-command-import-msg">{importMessage}</div>}

      <div className="production-command-stats">
        <div className="production-command-stat">
          <span>{summary.actionItems.length}</span>
          <label>行动项</label>
        </div>
        <div className="production-command-stat risk">
          <span>{summary.risks.length}</span>
          <label>风险/阻塞</label>
        </div>
        <div className="production-command-stat qa">
          <span>{summary.qaItems.length}</span>
          <label>QA/Bug</label>
        </div>
        <div className="production-command-stat narrative">
          <span>{summary.narrative.missingStages.length + summary.narrative.weakLinks.length}</span>
          <label>叙事缺口</label>
        </div>
        <div className="production-command-stat hot">
          <span>{summary.schedule.overdue || overdueActions}</span>
          <label>逾期</label>
        </div>
        <div className="production-command-stat">
          <span>{summary.schedule.blocked}</span>
          <label>卡住</label>
        </div>
        <div className="production-command-stat">
          <span>{summary.schedule.missingDocs}</span>
          <label>缺文档</label>
        </div>
        <div className="production-command-stat">
          <span>{minutesToLabel(summary.schedule.totalMinutes)}</span>
          <label>已记录用时</label>
        </div>
      </div>

      {summary.recommendations.length > 0 && (
        <div className="production-command-recs">
          {summary.recommendations.map((rec) => (
            <div key={rec} className="production-command-rec">{rec}</div>
          ))}
        </div>
      )}

      <div className="production-command-lists">
        <div className="production-command-list">
          <div className="production-command-list-title">
            <ClockIcon size={13} />
            近期行动
          </div>
          {loading && !result ? (
            <div className="production-command-empty">正在扫描 Vault...</div>
          ) : topActions.length === 0 ? (
            <div className="production-command-empty">还没有扫到未完成行动项。</div>
          ) : (
            topActions.map((item) => {
              const canOpen = Boolean(item.relativePath);
              const isOverdue = item.dueDate && item.dueDate < today;
              return (
                <button
                  key={`${item.source}:${item.id}`}
                  className={'production-command-item' + (!canOpen ? ' disabled' : '')}
                  onClick={() => canOpen && onOpenFile(item.relativePath)}
                  disabled={!canOpen}
                >
                  <span className={'production-priority-dot priority-' + item.priority} />
                  <span className="production-command-item-main">
                    <strong>{item.text}</strong>
                    <small>
                      {item.source === 'schedule' ? '时间表' : item.relativePath}
                      {item.line > 1 ? `:${item.line}` : ''}
                      {item.linkedDoc ? ` · 关联 ${item.linkedDoc}` : ''}
                    </small>
                    {item.details && <span className="production-command-item-detail">{item.details}</span>}
                  </span>
                  <span className="production-command-item-meta">
                    {item.owner && <em>{item.owner}</em>}
                    {item.dueDate && <b className={isOverdue ? 'overdue' : ''}>{item.dueDate}</b>}
                    {item.status && <i>{item.status}</i>}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="production-command-list">
          <div className="production-command-list-title">
            <WarningIcon size={13} />
            风险雷达
          </div>
          {loading && !result ? (
            <div className="production-command-empty">正在读取风险段落...</div>
          ) : topRisks.length === 0 ? (
            <div className="production-command-empty">暂无明显风险记录。</div>
          ) : (
            topRisks.map((risk) => (
              <button
                key={risk.id}
                className="production-command-risk-item"
                onClick={() => onOpenFile(risk.relativePath)}
              >
                <span className={'production-risk-severity severity-' + risk.severity}>{risk.severity}</span>
                <span>
                  <strong>{risk.text}</strong>
                  <small><FileIcon size={11} /> {risk.relativePath}:{risk.line}</small>
                </span>
              </button>
            ))
          )}
        </div>

        <div className="production-command-list">
          <div className="production-command-list-title">
            <WarningIcon size={13} />
            QA / Bug / 试玩反馈
          </div>
          {loading && !result ? (
            <div className="production-command-empty">正在读取 QA 与测试反馈...</div>
          ) : topQAItems.length === 0 ? (
            <div className="production-command-empty">暂无未关闭 QA 项。</div>
          ) : (
            topQAItems.map((item) => (
              <button
                key={item.id}
                className="production-command-risk-item"
                onClick={() => onOpenFile(item.relativePath)}
              >
                <span className={'production-risk-severity severity-' + item.severity}>{priorityLabel(item.severity)}</span>
                <span>
                  <strong>{item.text}</strong>
                  <small>
                    <FileIcon size={11} /> {item.relativePath}:{item.line}
                    {item.buildVersion ? ` · ${item.buildVersion}` : ''}
                    {item.owner ? ` · ${item.owner}` : ''}
                  </small>
                  {item.details && <span className="production-command-item-detail">{item.details}</span>}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="production-command-list">
          <div className="production-command-list-title">
            <FileIcon size={13} />
            叙事链路
          </div>
          {loading && !result ? (
            <div className="production-command-empty">正在检查世界观、剧情、台词、演出和任务表...</div>
          ) : narrativeGapItems.length === 0 ? (
            <div className="production-command-empty">叙事链路当前没有明显缺口。</div>
          ) : (
            narrativeGapItems.map((item) => (
              <button
                key={item.key}
                className={'production-command-risk-item' + (!item.relativePath ? ' disabled' : '')}
                onClick={() => item.relativePath && onOpenFile(item.relativePath)}
                disabled={!item.relativePath}
              >
                <span className={'production-risk-severity severity-' + item.severity}>{priorityLabel(item.severity)}</span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="production-command-footnote">
        右侧雷达不会直接改排期；需要分配成员、导入任务、刷新服务器状态或让 AI 接管时，请进入完整团队工作台。
        已扫描 {summary.scannedDocs} 个文档
        {summary.skippedDocs > 0 ? `，跳过 ${summary.skippedDocs} 个超出上限的文档` : ''}
        {summary.schedule.total > 0 ? `；时间表任务 ${summary.schedule.total} 个，7 天内到期 ${summary.schedule.dueSoon} 个，缺文档 ${summary.schedule.missingDocs} 个。` : '。'}
      </div>
    </section>
  );
};

export default ProductionCommandCenter;
