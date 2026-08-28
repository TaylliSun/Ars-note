/* ── AI 5-Pillar System (v1.2.0) ── */
/* Memory, Skills, Soul, Crons, Self-Improving Loop */

import * as fs from 'fs';
import * as path from 'path';
import { tokenizeVaultRetrievalText } from './aiVaultRetriever';

/* ── Helpers ── */

const AI_DIR = '.ai-memory';
const MEMORY_FILE = 'MEMORY.md';
const USER_FILE = 'USER.md';
const SOUL_FILE = 'SOUL.md';
const SKILLS_DIR = 'skills';
const HISTORY_DIR = 'history';
const CURRENT_SESSION_FILE = 'current-session.json';
const CRONS_FILE = 'crons.json';
const EVOLUTION_DIR = 'evolution';
const WORKFLOW_CANDIDATES_FILE = 'workflow-candidates.json';
const MEMORY_CAP = 16000;
const MAX_CONVERSATION_HISTORY = 12;
const WORKFLOW_PROMOTION_THRESHOLD = 2;
const MAX_WORKFLOW_CANDIDATES = 80;

function aiDir(vp: string): string { return path.join(vp, AI_DIR); }
function ensureDir(dir: string): void { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function readText(fp: string): string { return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf-8') : ''; }
function writeText(fp: string, content: string): void { ensureDir(path.dirname(fp)); fs.writeFileSync(fp, content, 'utf-8'); }
function readJSON<T>(fp: string, fallback: T): T { try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { return fallback; } }
function writeJSON(fp: string, data: any): void { ensureDir(path.dirname(fp)); fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8'); }
function uid(): string { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function stableHash(text: string): string {
  let hash = 0x811c9dc5;
  for (const ch of text) {
    hash ^= ch.codePointAt(0) || 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function skillIdFromName(name: string): string {
  const source = String(name || '').trim();
  const slug = source
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 56);
  return slug || `skill-${stableHash(source || uid())}`;
}

function uniqueSkillId(dir: string, baseId: string): string {
  const safeBase = baseId || `skill-${stableHash(uid())}`;
  let candidate = safeBase;
  let suffix = 2;
  while (fs.existsSync(path.join(dir, `${candidate}.md`))) {
    candidate = `${safeBase}-${suffix}`;
    suffix++;
  }
  return candidate;
}

function singleLine(value: unknown, maxLength = 1200): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeComparableText(value: unknown): string {
  return singleLine(value).normalize('NFKC').toLowerCase();
}

function buildSkillContent(skill: { name: string; trigger: string; description: string; steps: string }, createdAt?: string): string {
  const ts = new Date().toISOString();
  return `---
name: ${singleLine(skill.name, 160)}
trigger: ${singleLine(skill.trigger, 240)}
description: ${singleLine(skill.description, 320)}
created: ${createdAt || ts}
updated: ${ts}
use_count: 0
success_rate: 0
last_used:
---

${String(skill.steps || '').trim()}
`;
}

function normalizeWorkflowIntent(value: string): string {
  return singleLine(value, 600)
    .replace(/[A-Za-z]:[\\/][^\s"'<>|*?]+/g, '<path>')
    .replace(/(?:[\w\u4e00-\u9fff ._-]+[\\/])+[\w\u4e00-\u9fff ._-]+\.(?:md|json|canvas|excalidraw)/gi, '<path>')
    .replace(/\b\d+(?:\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export interface RelevantSkillMatch {
  id: string;
  name: string;
  trigger: string;
  score: number;
  context: string;
}

interface WorkflowCandidate {
  signature: string;
  intent: string;
  example: string;
  toolNames: string[];
  successCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  promotedSkillId?: string;
}

export interface WorkflowObservationResult {
  observed: boolean;
  successCount: number;
  promotedSkillId?: string;
}

/* ═══════════════════════════════════════════
   Pillar 1: MEMORY
   ═══════════════════════════════════════════ */

export function initMemorySystem(vp: string): void {
  const dir = aiDir(vp);
  ensureDir(dir);
  ensureDir(path.join(dir, SKILLS_DIR));
  ensureDir(path.join(dir, HISTORY_DIR));
  ensureDir(path.join(dir, EVOLUTION_DIR));

  // Create default SOUL.md if not exists
  const soulPath = path.join(dir, SOUL_FILE);
  if (!fs.existsSync(soulPath)) {
    writeText(soulPath, `# Ars-note AI Soul

## Name
Ars (阿尔斯)

## Role
Game development knowledge assistant for Ars-note vault.

## Personality
- Helpful, concise, bilingual (中文/English)
- Proactive about game design best practices
- Respects user's creative vision

## Directives
- Respond in the same language the user writes in
- Use tools to read/write files when asked
- Keep responses actionable and concise
- When creating game docs, follow standard industry formats
- Always check existing files before creating new ones
- Summarize learnings after completing complex tasks

## Expertise
- Game Design Documents (GDD)
- Character profiles and worldbuilding
- Quest and level design
- Unity implementation tasks
- Development logs and project management
`);
  }

  // Create default USER.md if not exists
  const userPath = path.join(dir, USER_FILE);
  if (!fs.existsSync(userPath)) {
    writeText(userPath, `# User Profile
<!-- Edit this file to tell the AI about yourself -->
## Preferences
- Language: Auto-detect
- Detail level: Concise
`);
  }

  // Create default MEMORY.md if not exists
  const memPath = path.join(dir, MEMORY_FILE);
  if (!fs.existsSync(memPath)) {
    writeText(memPath, '# AI Memory\n<!-- Auto-managed. Entries are consolidated when memory is full. -->\n');
  }

  // Create default crons.json if not exists
  const cronsPath = path.join(dir, CRONS_FILE);
  if (!fs.existsSync(cronsPath)) {
    writeJSON(cronsPath, []);
  }
}

export function getMemoryStatus(vp: string) {
  const dir = aiDir(vp);
  const memContent = readText(path.join(dir, MEMORY_FILE));
  const userContent = readText(path.join(dir, USER_FILE));
  const historyDir = path.join(dir, HISTORY_DIR);
  let historyCount = 0;
  try { historyCount = fs.readdirSync(historyDir).filter(f => f.endsWith('.json')).length; } catch {}

  return {
    memorySize: memContent.length,
    memoryCap: MEMORY_CAP,
    userSize: userContent.length,
    historyCount,
    needsConsolidation: memContent.length > MEMORY_CAP,
  };
}

export function readMemory(vp: string): string { return readText(path.join(aiDir(vp), MEMORY_FILE)); }

export function appendMemory(vp: string, entry: string): void {
  const fp = path.join(aiDir(vp), MEMORY_FILE);
  const current = readText(fp);
  const cleanEntry = singleLine(entry);
  if (!cleanEntry) return;
  const comparable = normalizeComparableText(cleanEntry);
  const duplicate = current.split(/\r?\n/).some(line => {
    const match = line.match(/^\s*-\s+\[.*?\]\s*(?:\[locked\]\s*)?(.*)$/i);
    return !!match && normalizeComparableText(match[1]) === comparable;
  });
  if (duplicate) return;
  const timestamp = new Date().toISOString().split('T')[0];
  const newLine = `\n- [${timestamp}] ${cleanEntry}`;
  writeText(fp, current + newLine);
}

export function listMemoryEntries(vp: string): Array<{ lineIndex: number; date: string; text: string; locked: boolean; raw: string }> {
  const lines = readMemory(vp).split(/\r?\n/);
  return lines
    .map((line, index) => {
      const match = line.match(/^\s*-\s+\[(.*?)\]\s*(.*)$/);
      if (!match) return null;
      const text = match[2].replace(/^\[locked\]\s*/i, '').trim();
      return {
        lineIndex: index,
        date: match[1],
        text,
        locked: /^\[locked\]\s*/i.test(match[2]),
        raw: line,
      };
    })
    .filter(Boolean)
    .reverse() as Array<{ lineIndex: number; date: string; text: string; locked: boolean; raw: string }>;
}

export function deleteMemoryEntry(vp: string, lineIndex: number): boolean {
  const fp = path.join(aiDir(vp), MEMORY_FILE);
  const lines = readMemory(vp).split(/\r?\n/);
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) return false;
  if (!/^\s*-\s+\[.*?\]/.test(lines[lineIndex])) return false;
  lines.splice(lineIndex, 1);
  writeText(fp, lines.join('\n'));
  return true;
}

export function setMemoryEntryLocked(vp: string, lineIndex: number, locked: boolean): boolean {
  const fp = path.join(aiDir(vp), MEMORY_FILE);
  const lines = readMemory(vp).split(/\r?\n/);
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) return false;
  const match = lines[lineIndex].match(/^(\s*-\s+\[.*?\]\s*)(.*)$/);
  if (!match) return false;
  const text = match[2].replace(/^\[locked\]\s*/i, '').trim();
  lines[lineIndex] = `${match[1]}${locked ? '[locked] ' : ''}${text}`;
  writeText(fp, lines.join('\n'));
  return true;
}

export function consolidateMemory(vp: string): string {
  const fp = path.join(aiDir(vp), MEMORY_FILE);
  const current = readText(fp);
  if (current.length <= MEMORY_CAP) return 'No consolidation needed.';

  const consolidated = buildMemoryContext(current, MEMORY_CAP);
  if (consolidated === current) return 'No consolidation needed.';
  const archiveName = `memory-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
  writeText(path.join(aiDir(vp), HISTORY_DIR, archiveName), current);
  writeText(fp, consolidated);
  return `Consolidated: ${current.length} -> ${consolidated.length} chars`;
}

export function buildMemoryContext(memory: string, maxChars = MEMORY_CAP): string {
  const source = String(memory || '').trim();
  if (!source || source.length <= maxChars) return source;

  const lines = source.split(/\r?\n/);
  const firstEntryIndex = lines.findIndex(line => /^\s*-\s+\[.*?\]/.test(line));
  const header = (firstEntryIndex >= 0 ? lines.slice(0, firstEntryIndex) : lines.slice(0, 2))
    .join('\n')
    .trim()
    .slice(0, 1600);
  const entries = lines.filter(line => /^\s*-\s+\[.*?\]/.test(line));
  if (entries.length === 0) {
    const paragraphs = source.split(/\n{2,}/);
    const selected: string[] = [];
    let used = 0;
    for (let index = paragraphs.length - 1; index >= 0; index--) {
      const paragraph = paragraphs[index].trim();
      if (!paragraph) continue;
      if (used + paragraph.length + 2 > maxChars && selected.length > 0) break;
      selected.unshift(paragraph);
      used += paragraph.length + 2;
    }
    return selected.join('\n\n').slice(-maxChars);
  }

  const locked = Array.from(new Set(entries.filter(line => /\]\s*\[locked\]/i.test(line))));
  const recentCandidates = entries.filter(line => !/\]\s*\[locked\]/i.test(line));
  const recent: string[] = [];
  const fixedLength = header.length
    + (locked.length ? locked.join('\n').length + 24 : 0)
    + 36;
  let used = fixedLength;
  for (let index = recentCandidates.length - 1; index >= 0; index--) {
    const line = recentCandidates[index];
    if (used + line.length + 1 > maxChars && recent.length > 0) break;
    recent.unshift(line);
    used += line.length + 1;
  }

  return [
    header,
    locked.length ? `## Locked Memory\n${locked.join('\n')}` : '',
    recent.length ? `## Recent Memory\n${recent.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

export function readSoul(vp: string): string { return readText(path.join(aiDir(vp), SOUL_FILE)); }
export function writeSoul(vp: string, content: string): void { writeText(path.join(aiDir(vp), SOUL_FILE), content); }
export function readUser(vp: string): string { return readText(path.join(aiDir(vp), USER_FILE)); }
export function writeUser(vp: string, content: string): void { writeText(path.join(aiDir(vp), USER_FILE), content); }

/* ═══════════════════════════════════════════
   Pillar 1b: CONVERSATION HISTORY
   ═══════════════════════════════════════════ */

export function saveConversation(vp: string, messages: Array<{ role: string; content: string; toolCalls?: any[] }>): void {
  const dir = path.join(aiDir(vp), HISTORY_DIR);
  ensureDir(dir);
  const cleanMessages = (messages || [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
    .map(m => ({
      role: m.role,
      content: m.content || '',
      createdAt: (m as any).createdAt || new Date().toISOString(),
      toolCalls: m.toolCalls || (m as any).tool_calls || undefined,
    }))
    .filter(m => m.content.trim() || (m.toolCalls && m.toolCalls.length > 0));
  if (cleanMessages.length === 0) return;

  const savedAt = new Date().toISOString();
  writeJSON(path.join(dir, CURRENT_SESSION_FILE), { messages: cleanMessages, savedAt });

  const last = cleanMessages[cleanMessages.length - 1];
  if (last?.role === 'assistant') {
    const ts = savedAt.replace(/[:.]/g, '-');
    writeJSON(path.join(dir, `${ts}.json`), { messages: cleanMessages, savedAt });
  }

  // Keep a compact local chat trail; durable AI memory lives in MEMORY.md and skills/.
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== CURRENT_SESSION_FILE).sort();
    if (files.length > MAX_CONVERSATION_HISTORY) {
      for (let i = 0; i < files.length - MAX_CONVERSATION_HISTORY; i++) {
        fs.unlinkSync(path.join(dir, files[i]));
      }
    }
  } catch {}
}

export function listConversations(vp: string): Array<{ file: string; date: string; messageCount: number }> {
  const dir = path.join(aiDir(vp), HISTORY_DIR);
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
          return { file: f, date: data.savedAt || f, messageCount: data.messages?.length || 0 };
        } catch { return { file: f, date: f, messageCount: 0 }; }
      })
      .filter(item => item.messageCount > 0)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 20);
  } catch { return []; }
}

export function loadConversation(vp: string, file: string): Array<{ role: string; content: string; toolCalls?: any[] }> {
  const fp = path.join(aiDir(vp), HISTORY_DIR, file);
  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    return data.messages || [];
  } catch { return []; }
}

function readConversationCandidate(fp: string): { messages: Array<{ role: string; content: string; toolCalls?: any[] }>; time: number } | null {
  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    const messages = Array.isArray(data.messages) ? data.messages : [];
    if (messages.length === 0) return null;
    const rawTime = Number(data.updatedAtMs || Date.parse(data.updatedAt || data.savedAt || ''));
    const time = Number.isFinite(rawTime) && rawTime > 0 ? rawTime : fs.statSync(fp).mtimeMs;
    return { messages, time };
  } catch {
    return null;
  }
}

export function loadLatestConversation(vp: string): Array<{ role: string; content: string; toolCalls?: any[] }> {
  const dir = path.join(aiDir(vp), HISTORY_DIR);
  try {
    const candidates: Array<{ messages: Array<{ role: string; content: string; toolCalls?: any[] }>; time: number }> = [];

    const current = readConversationCandidate(path.join(dir, CURRENT_SESSION_FILE));
    if (current) candidates.push(current);

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== CURRENT_SESSION_FILE).sort();
    if (files.length > 0) {
      const latest = readConversationCandidate(path.join(dir, files[files.length - 1]));
      if (latest) candidates.push(latest);
    }

    candidates.sort((a, b) => b.time - a.time);
    return candidates[0]?.messages || [];
  } catch { return []; }
}

/* ═══════════════════════════════════════════
   Pillar 2: SKILLS
   ═══════════════════════════════════════════ */

export function listSkills(vp: string): any[] {
  const dir = path.join(aiDir(vp), SKILLS_DIR);
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const content = readText(path.join(dir, f));
        const frontmatter: Record<string, string> = {};
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          for (const line of fmMatch[1].split('\n')) {
            const colonIdx = line.indexOf(':');
            if (colonIdx > 0) frontmatter[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
          }
        }
        return {
          id: f.replace('.md', ''),
          name: frontmatter.name || f.replace('.md', ''),
          trigger: frontmatter.trigger || '',
          description: frontmatter.description || '',
          steps: content.replace(/^---[\s\S]*?---\n*/, ''),
          createdAt: frontmatter.created || '',
          updatedAt: frontmatter.updated || '',
          useCount: parseInt(frontmatter.use_count || '0'),
          successRate: parseFloat(frontmatter.success_rate || '0'),
          lastUsedAt: frontmatter.last_used || '',
        };
      });
  } catch { return []; }
}

export function createSkill(vp: string, skill: { name: string; trigger: string; description: string; steps: string }): string {
  const dir = path.join(aiDir(vp), SKILLS_DIR);
  ensureDir(dir);
  const id = uniqueSkillId(dir, skillIdFromName(skill.name));
  writeText(path.join(dir, `${id}.md`), buildSkillContent(skill));
  return id;
}

export function updateSkillUsage(vp: string, skillId: string, success: boolean): void {
  const fp = path.join(aiDir(vp), SKILLS_DIR, `${skillId}.md`);
  if (!fs.existsSync(fp)) return;
  let content = readText(fp);

  const getCount = (m: RegExpMatchArray | null) => m ? parseInt(m[1]) : 0;
  const useCountMatch = content.match(/use_count: (\d+)/);
  const successRateMatch = content.match(/success_rate: ([\d.]+)/);
  const useCount = getCount(useCountMatch) + 1;
  const oldRate = successRateMatch ? parseFloat(successRateMatch[1]) : 0;
  const newRate = Math.round(((oldRate * (useCount - 1)) + (success ? 100 : 0)) / useCount);

  content = content.replace(/use_count: \d+/, `use_count: ${useCount}`);
  content = content.replace(/success_rate: [\d.]+/, `success_rate: ${newRate}`);
  content = content.replace(/last_used:.*/, `last_used: ${new Date().toISOString()}`);
  content = content.replace(/updated:.*/, `updated: ${new Date().toISOString()}`);

  writeText(fp, content);
}

export function readSkill(vp: string, skillId: string): string {
  return readText(path.join(aiDir(vp), SKILLS_DIR, `${skillId}.md`));
}

export function deleteSkill(vp: string, skillId: string): void {
  const fp = path.join(aiDir(vp), SKILLS_DIR, `${skillId}.md`);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

export function getRelevantSkillMatches(vp: string, query: string, limit = 3): RelevantSkillMatch[] {
  const skills = listSkills(vp);
  if (skills.length === 0) return [];
  const queryLower = query.toLowerCase();
  const queryTokens = tokenizeVaultRetrievalText(queryLower, 64);
  return skills
    .map(skill => {
      const searchText = `${skill.name} ${skill.trigger} ${skill.description} ${skill.steps}`.toLowerCase();
      let score = 0;
      if (skill.trigger && queryLower.includes(String(skill.trigger).toLowerCase())) score += 20;
      for (const token of queryTokens) {
        if (searchText.includes(token)) score += token.length >= 4 ? 3 : 1;
      }
      score += Math.min(3, Number(skill.useCount || 0)) * 0.25;
      score += Math.max(0, Math.min(100, Number(skill.successRate || 0))) / 200;
      return {
        id: String(skill.id || ''),
        name: String(skill.name || ''),
        trigger: String(skill.trigger || ''),
        score,
        context: `### Skill: ${skill.name}\nTrigger: ${skill.trigger}\n${skill.steps}`,
      };
    })
    .filter(item => item.score >= 2)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(8, limit)));
}

export function getRelevantSkills(vp: string, query: string): string {
  return getRelevantSkillMatches(vp, query).map(match => match.context).join('\n\n');
}

export function observeReusableWorkflow(
  vp: string,
  observation: { userText: string; toolNames: string[]; successful: boolean },
): WorkflowObservationResult {
  const intent = normalizeWorkflowIntent(observation.userText);
  const toolNames = (observation.toolNames || [])
    .map(name => singleLine(name, 120))
    .filter(Boolean)
    .slice(0, 16);
  if (!observation.successful || intent.length < 8 || toolNames.length === 0) {
    return { observed: false, successCount: 0 };
  }

  const signature = stableHash(`${intent}\n${toolNames.join('>')}`);
  const fp = path.join(aiDir(vp), WORKFLOW_CANDIDATES_FILE);
  const candidates = readJSON<WorkflowCandidate[]>(fp, []);
  const now = new Date().toISOString();
  let candidate = candidates.find(item => item.signature === signature);
  if (!candidate) {
    candidate = {
      signature,
      intent,
      example: singleLine(observation.userText, 240),
      toolNames,
      successCount: 0,
      firstSeenAt: now,
      lastSeenAt: now,
    };
    candidates.push(candidate);
  }
  candidate.successCount += 1;
  candidate.lastSeenAt = now;

  if (candidate.successCount >= WORKFLOW_PROMOTION_THRESHOLD && !candidate.promotedSkillId) {
    const skillId = `learned-${signature}`;
    const skillPath = path.join(aiDir(vp), SKILLS_DIR, `${skillId}.md`);
    ensureDir(path.dirname(skillPath));
    if (!fs.existsSync(skillPath)) {
      writeText(skillPath, buildSkillContent({
        name: `Learned workflow ${signature}`,
        trigger: candidate.example,
        description: `Promoted after ${candidate.successCount} successful executions in Ars-note.`,
        steps: [
          '## Reusable execution pattern',
          '',
          `Intent pattern: ${candidate.intent}`,
          `Tool sequence: ${candidate.toolNames.join(' -> ')}`,
          '',
          'Re-read the current target, apply only the requested scope, verify every mutation, and report exact changed paths.',
        ].join('\n'),
      }));
    }
    candidate.promotedSkillId = skillId;
  }

  const retained = candidates
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
    .slice(0, MAX_WORKFLOW_CANDIDATES);
  writeJSON(fp, retained);
  return {
    observed: true,
    successCount: candidate.successCount,
    promotedSkillId: candidate.promotedSkillId,
  };
}

/* ═══════════════════════════════════════════
   Pillar 4: CRONS
   ═══════════════════════════════════════════ */

export function listCrons(vp: string): any[] { return readJSON(path.join(aiDir(vp), CRONS_FILE), [] as any[]); }

export function createCron(vp: string, cron: { name: string; prompt: string; schedule: string }): any {
  const crons = listCrons(vp);
  const newCron = { id: uid(), name: cron.name, prompt: cron.prompt, schedule: cron.schedule, enabled: true, createdAt: new Date().toISOString() };
  crons.push(newCron);
  writeJSON(path.join(aiDir(vp), CRONS_FILE), crons);
  return newCron;
}

export function updateCron(vp: string, cronId: string, updates: Record<string, any>): any | null {
  const crons = listCrons(vp);
  const idx = crons.findIndex((c: any) => c.id === cronId);
  if (idx === -1) return null;
  Object.assign(crons[idx], updates);
  writeJSON(path.join(aiDir(vp), CRONS_FILE), crons);
  return crons[idx];
}

export function deleteCron(vp: string, cronId: string): boolean {
  const crons = listCrons(vp);
  const filtered = crons.filter((c: any) => c.id !== cronId);
  if (filtered.length === crons.length) return false;
  writeJSON(path.join(aiDir(vp), CRONS_FILE), filtered);
  return true;
}

/* ═══════════════════════════════════════════
   Pillar 5: EVOLUTION (GEPA-style)
   ═══════════════════════════════════════════ */

export function getEvolutionRecord(vp: string, skillId: string): any | null {
  const fp = path.join(aiDir(vp), EVOLUTION_DIR, `${skillId}.evo.json`);
  return readJSON(fp, null);
}

export function saveEvolutionRecord(vp: string, record: any): void {
  writeJSON(path.join(aiDir(vp), EVOLUTION_DIR, `${record.skillId}.evo.json`), record);
}

export function listEvolutions(vp: string): any[] {
  const dir = path.join(aiDir(vp), EVOLUTION_DIR);
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.evo.json'))
      .map(f => readJSON(path.join(dir, f), {} as any))
      .filter(r => r.skillId);
  } catch { return []; }
}

export function buildFivePillarContext(vp: string): string {
  const sections: string[] = [];

  // Soul (always loaded)
  const soul = readSoul(vp);
  if (soul) sections.push('=== AI IDENTITY ===\n' + soul);

  // User profile (always loaded)
  const user = readUser(vp);
  if (user) sections.push('=== USER PROFILE ===\n' + user);

  // Memory (always loaded, capped)
  const memory = readMemory(vp);
  if (memory && memory.length > 50) sections.push('=== MEMORY ===\n' + buildMemoryContext(memory, MEMORY_CAP));

  // Active crons summary
  const crons = listCrons(vp).filter((c: any) => c.enabled);
  if (crons.length > 0) {
    sections.push('=== ACTIVE CRONS ===\n' + crons.map((c: any) => `- [${c.schedule}] ${c.name}`).join('\n'));
  }

  return sections.join('\n\n');
}


/* ── Cron Scheduler ── */

let cronInterval: ReturnType<typeof setInterval> | null = null;

export function startCronScheduler(vp: string, aiCaller: (vaultPath: string, prompt: string) => Promise<string>): void {
  stopCronScheduler();
  cronInterval = setInterval(async () => {
    try {
      const crons = listCrons(vp).filter((c: any) => c.enabled);
      const now = new Date();
      for (const cr of crons) {
        if (shouldRunCron(cr.schedule, now)) {
          try {
            const result = await aiCaller(vp, cr.prompt);
            cr.lastRunAt = new Date().toISOString();
            cr.lastResult = result;
            updateCron(vp, cr.id, { lastRunAt: cr.lastRunAt, lastResult: cr.lastResult });
          } catch (err: any) {
            cr.lastRunAt = new Date().toISOString();
            cr.lastResult = 'Error: ' + (err.message || 'Unknown');
            updateCron(vp, cr.id, { lastRunAt: cr.lastRunAt, lastResult: cr.lastResult });
          }
        }
      }
    } catch (err) {
      console.error('Cron scheduler tick error:', err);
    }
  }, 60_000);
}

export function stopCronScheduler(): void {
  if (cronInterval) { clearInterval(cronInterval); cronInterval = null; }
}

function shouldRunCron(expr: string, now: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minS, hourS, domS, monS, dowS] = parts;
  const match = (field: string, value: number, min: number, max: number) => {
    if (field === '*') return true;
    return field.split(',').some(p => {
      if (p.includes('/')) {
        const [base, step] = p.split('/');
        const s = parseInt(step);
        const start = base === '*' ? min : parseInt(base);
        return value >= start && (value - start) % s === 0;
      }
      return parseInt(p) === value;
    });
  };
  return match(minS, now.getMinutes(), 0, 59)
    && match(hourS, now.getHours(), 0, 23)
    && match(domS, now.getDate(), 1, 31)
    && match(monS, now.getMonth() + 1, 1, 12)
    && match(dowS, now.getDay(), 0, 6);
}

/* ── GEPA Skill Evolution ── */

export async function evolveSkill(vp: string, skillId: string, llmCaller: (prompt: string) => Promise<string>): Promise<any> {
  const skill = readSkill(vp, skillId);
  if (!skill) throw new Error('Skill not found: ' + skillId);

  let evo = getEvolutionRecord(vp, skillId);
  if (!evo) {
    evo = { skillId, generation: 0, variants: [{ id: 'v0', content: skill, score: 0.5 }], currentBestVariantId: 'v0' };
  }

  // Generate 2 mutant variants via LLM
  const mutants: any[] = [];
  for (let i = 0; i < 2; i++) {
    const prompt = `You are a skill evolution engine. Improve the following AI skill prompt. Make it clearer, more actionable, and more effective. Output ONLY the improved skill text, nothing else.

Current skill:
${skill}

Variant #${i + 1}:`;
    try {
      const improved = await llmCaller(prompt);
      if (improved && improved.trim().length > 20) {
        mutants.push({ id: 'm' + evo.generation + '_' + i, content: improved.trim() });
      }
    } catch (err) {
      console.error('Mutant generation failed for variant', i, err);
    }
  }

  // Score all variants
  const allVariants = [...(evo.variants || []), ...mutants];
  for (const v of allVariants) {
    if (v.score && v.score > 0) continue; // already scored
    try {
      const scorePrompt = `Rate this AI skill prompt on three metrics (0.0 to 1.0). Reply ONLY with JSON: {"clarity": 0.x, "completeness": 0.x, "actionability": 0.x}

${v.content.slice(0, 500)}`;
      const scoreRaw = await llmCaller(scorePrompt);
      const scoreMatch = scoreRaw.match(/\{[\s\S]*?\}/);
      if (scoreMatch) {
        const scores = JSON.parse(scoreMatch[0]);
        v.score = ((scores.clarity || 0.5) + (scores.completeness || 0.5) + (scores.actionability || 0.5)) / 3;
      } else {
        v.score = 0.5;
      }
    } catch {
      v.score = 0.5;
    }
  }

  // Pareto: select best variant by highest score
  allVariants.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
  const best = allVariants[0];

  evo.variants = allVariants.slice(0, 5); // keep top 5
  evo.generation = (evo.generation || 0) + 1;
  evo.currentBestVariantId = best.id;

  // Write improved skill back
  if (best.content && best.content !== skill) {
    writeText(path.join(aiDir(vp), 'skills', skillId + '.md'), best.content);
  }

  saveEvolutionRecord(vp, evo);
  return evo;
}
