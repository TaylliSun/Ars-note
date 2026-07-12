export type ExtractedTaskPriority = 'high' | 'medium' | 'low';
export type ExtractedTaskStatus = 'todo' | 'doing' | 'review' | 'blocked';

export interface ExtractedTeamTask {
  title: string;
  owner: string;
  priority: ExtractedTaskPriority;
  status: ExtractedTaskStatus;
  dueDate: string;
  linkedDoc: string;
  deliverable: string;
  dependency: string;
  acceptance: string;
  notes: string;
}

const TASK_SECTION_RE = /(任务|行动|待办|下一步|今日|本周|排程|计划|开发|实现|落地|负责人|Action|Next|Task|Schedule|Plan)/i;
const NON_TASK_HEADING_RE = /(摘要|背景|风险|问题|世界观|剧情|台词|演出|说明|分析|建议|原则|要求|Summary|Risk|Issue|World|Story|Dialogue)/i;

function normalizeDate(value: string): string {
  const match = String(value || '').match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!match) return '';
  return [
    match[1],
    match[2].padStart(2, '0'),
    match[3].padStart(2, '0'),
  ].join('-');
}

function stripMarkdown(value: string): string {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/\[\[([^|\]]+)\|([^\]]+)]]/g, '$2')
    .replace(/\[\[([^\]]+)]]/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitle(value: string): string {
  return stripMarkdown(value)
    .replace(/^\s*(?:TODO|待办|行动项|任务|Action|Task)\s*[:：-]\s*/i, '')
    .replace(/^\s*\[[^\]]+]\s*/, '')
    .replace(/\s*(?:负责人|owner|截止|due|deadline|优先级|priority|状态|status|依赖|dependency|验收|acceptance)\s*[:：].*$/i, '')
    .replace(/\s*[，,;；]\s*(?:负责人|owner|截止|due|deadline|优先级|priority|状态|status|依赖|dependency|验收|acceptance)\s*[:：]?.*$/i, '')
    .trim();
}

function extractOwner(text: string): string {
  const explicit = text.match(/(?:负责人|owner|Owner|负责)\s*[:：]\s*([^\s,，。;；|]+)/);
  if (explicit) return stripMarkdown(explicit[1]);
  const mention = text.match(/@([^\s,，。;；|#]+)/);
  return mention ? stripMarkdown(mention[1]) : '';
}

function extractPriority(text: string): ExtractedTaskPriority {
  if (/(?:\bP0\b|\bP1\b|\bhigh\b|高优先|高优先级|紧急|最高|必须|阻塞|blocked|blocker)/i.test(text)) return 'high';
  if (/(?:\bP3\b|\blow\b|低优先|低优先级|可延后|以后再做)/i.test(text)) return 'low';
  return 'medium';
}

function extractStatus(text: string): ExtractedTaskStatus {
  if (/(阻塞|卡住|blocked|blocker)/i.test(text)) return 'blocked';
  if (/(review|验收|检查|待确认|待审核)/i.test(text)) return 'review';
  if (/(doing|进行中|处理中|制作中|开发中)/i.test(text)) return 'doing';
  return 'todo';
}

function extractDueDate(text: string): string {
  const explicit = text.match(/(?:截止|到期|完成时间|due|deadline)\s*[:：]?\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/i);
  if (explicit) return normalizeDate(explicit[1]);
  return normalizeDate(text);
}

function extractLinkedDoc(text: string): string {
  const path = text.match(/(?:文档|doc|文件|link)\s*[:：]\s*([^\s,，。;；|]+\.md)/i);
  if (path) return path[1].replace(/\\/g, '/').trim();
  const anyPath = text.match(/([A-Za-z0-9_.\-/\u4e00-\u9fa5]+\.md)/);
  if (anyPath) return anyPath[1].replace(/\\/g, '/').trim();
  const wiki = text.match(/\[\[([^|\]]+)(?:\|[^\]]+)?]]/);
  if (wiki) {
    const target = wiki[1].trim();
    return target.endsWith('.md') ? target : `${target}.md`;
  }
  return '';
}

function extractDependency(text: string): string {
  const match = text.match(/(?:依赖|前置|dependency|depends?)\s*[:：]\s*([^。；;\n|]+)/i);
  return match ? stripMarkdown(match[1]).slice(0, 240) : '';
}

function extractAcceptance(text: string): string {
  const match = text.match(/(?:验收|验收标准|测试|acceptance|criteria|test)\s*[:：]\s*([^。；;\n|]+)/i);
  return match ? stripMarkdown(match[1]).slice(0, 300) : '';
}

function makeTask(rawTitle: string, rawText: string, fallbackNotes = ''): ExtractedTeamTask | null {
  const title = cleanTitle(rawTitle);
  if (!title || title.length < 3) return null;
  if (/^(请|根据|输出|要求|Respond|Use |Create |First |IMPORTANT)/i.test(title)) return null;
  return {
    title: title.slice(0, 120),
    owner: extractOwner(rawText),
    priority: extractPriority(rawText),
    status: extractStatus(rawText),
    dueDate: extractDueDate(rawText),
    linkedDoc: extractLinkedDoc(rawText),
    deliverable: title.slice(0, 120),
    dependency: extractDependency(rawText),
    acceptance: extractAcceptance(rawText),
    notes: stripMarkdown(fallbackNotes || rawText).slice(0, 500),
  };
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return [];
  return trimmed.slice(1, -1).split('|').map((cell) => stripMarkdown(cell));
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function findColumn(headers: string[], patterns: RegExp[], fallback = -1): number {
  const index = headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
  return index >= 0 ? index : fallback;
}

function parseTables(lines: string[]): ExtractedTeamTask[] {
  const tasks: ExtractedTeamTask[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const headers = splitMarkdownTableRow(lines[i]);
    if (headers.length < 2) continue;
    const next = splitMarkdownTableRow(lines[i + 1] || '');
    if (!isSeparatorRow(next)) continue;
    const hasTaskHeader = headers.some((header) => /(任务|事项|行动|交付|deliverable|task|action|work|内容)/i.test(header));
    if (!hasTaskHeader) continue;

    const titleIdx = findColumn(headers, [/任务|事项|行动|交付|deliverable|task|action|work|内容/i], 0);
    const ownerIdx = findColumn(headers, [/负责人|owner|角色|discipline|成员/i]);
    const priorityIdx = findColumn(headers, [/优先|priority|P级|级别/i]);
    const dueIdx = findColumn(headers, [/截止|日期|due|deadline|时间/i]);
    const docIdx = findColumn(headers, [/文档|doc|link|关联|链接/i]);
    const statusIdx = findColumn(headers, [/状态|status/i]);
    const dependencyIdx = findColumn(headers, [/依赖|dependency|depends|前置/i]);
    const acceptanceIdx = findColumn(headers, [/验收|acceptance|criteria|测试|test/i]);
    const notesIdx = findColumn(headers, [/备注|说明|notes|实现|验收|acceptance/i]);

    let row = i + 2;
    while (row < lines.length) {
      const cells = splitMarkdownTableRow(lines[row]);
      if (cells.length < 2 || isSeparatorRow(cells)) break;
      const merged = cells.join('，');
      const task = makeTask(cells[titleIdx] || '', merged, cells[notesIdx] || merged);
      if (task) {
        task.owner = ownerIdx >= 0 ? stripMarkdown(cells[ownerIdx] || task.owner) : task.owner;
        task.priority = priorityIdx >= 0 ? extractPriority(cells[priorityIdx] || merged) : task.priority;
        task.dueDate = dueIdx >= 0 ? extractDueDate(cells[dueIdx] || merged) : task.dueDate;
        task.linkedDoc = docIdx >= 0 ? extractLinkedDoc(cells[docIdx] || merged) : task.linkedDoc;
        task.status = statusIdx >= 0 ? extractStatus(cells[statusIdx] || merged) : task.status;
        task.dependency = dependencyIdx >= 0 ? stripMarkdown(cells[dependencyIdx] || '') : task.dependency;
        task.acceptance = acceptanceIdx >= 0 ? stripMarkdown(cells[acceptanceIdx] || '') : task.acceptance;
        tasks.push(task);
      }
      row += 1;
    }
    i = row;
  }
  return tasks;
}

function parseLists(lines: string[]): ExtractedTeamTask[] {
  const tasks: ExtractedTeamTask[] = [];
  let taskSectionDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,6}\s+/.test(trimmed)) {
      const heading = stripMarkdown(trimmed.replace(/^#{1,6}\s+/, ''));
      taskSectionDepth = TASK_SECTION_RE.test(heading) && !NON_TASK_HEADING_RE.test(heading) ? 24 : 0;
      continue;
    }
    if (!trimmed) {
      if (taskSectionDepth > 0) taskSectionDepth -= 1;
      continue;
    }

    const bullet = line.match(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)(.+)$/);
    const todo = bullet ? null : line.match(/^\s*(?:TODO|待办|行动项|任务|Action|Task)\s*[:：]\s+(.+)$/i);
    if (!bullet && !todo) {
      if (taskSectionDepth > 0) taskSectionDepth -= 1;
      continue;
    }

    const raw = (bullet?.[1] || todo?.[1] || '').trim();
    const likelyTask = taskSectionDepth > 0
      || /(负责人|owner|截止|due|deadline|优先|priority|\bP[0-3]\b|验收|实现|交付|deliverable|状态|status)/i.test(raw);
    if (likelyTask) {
      const task = makeTask(raw, raw);
      if (task) tasks.push(task);
    }
    if (taskSectionDepth > 0) taskSectionDepth -= 1;
  }

  return tasks;
}

function taskKey(task: ExtractedTeamTask): string {
  return `${task.title}|${task.owner}|${task.linkedDoc}`.toLowerCase();
}

export function extractTeamTasksFromAIResponse(content: string, limit = 30): ExtractedTeamTask[] {
  const lines = String(content || '').split(/\r?\n/);
  const tasks = [...parseTables(lines), ...parseLists(lines)];
  const deduped: ExtractedTeamTask[] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    const key = taskKey(task);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(task);
    if (deduped.length >= limit) break;
  }
  return deduped;
}

export function extractTeamTasksFromMarkdownContent(content: string, sourcePath = '', limit = 50): ExtractedTeamTask[] {
  const normalizedSource = String(sourcePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return extractTeamTasksFromAIResponse(content, limit).map((task) => ({
    ...task,
    linkedDoc: task.linkedDoc || normalizedSource,
    notes: [
      normalizedSource ? `Source document: ${normalizedSource}` : '',
      task.notes,
    ].filter(Boolean).join('\n'),
  }));
}
