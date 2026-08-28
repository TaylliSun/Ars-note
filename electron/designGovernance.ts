import * as fs from 'fs';
import * as path from 'path';
import type { VaultFileEntry } from './aiVaultScanner';

export const DESIGN_CANON_REGISTRY_PATH = '.ars-team/design-canon.json';

export interface DesignCanonEntry {
  domain: string;
  path: string;
  label: string;
  responsibility: string;
  updatedAt: string;
}

export interface DesignCanonRegistry {
  kind: 'ars-note.design-canon';
  version: 1;
  updatedAt: string;
  entries: DesignCanonEntry[];
}

export interface CanonicalDocumentCandidate {
  domain: string;
  path: string;
  title: string;
  score: number;
  reasons: string[];
}

export interface DesignImpactTask {
  id: string;
  title: string;
  owner: string;
  status: string;
  linkedDoc: string;
  reasons: string[];
}

export interface DesignImpactResult {
  ok: true;
  sourcePath: string;
  sourceDomain: string;
  canonicalDomains: string[];
  terms: string[];
  impactedDocuments: Array<{
    path: string;
    title: string;
    area: string;
    severity: 'high' | 'medium' | 'low';
    score: number;
    reasons: string[];
    evidence: string[];
  }>;
  impactedTasks: DesignImpactTask[];
  reviewAreas: string[];
  scheduleDecisionRequired: boolean;
  decisionRequirements: string[];
}

const EMPTY_REGISTRY = (): DesignCanonRegistry => ({
  kind: 'ars-note.design-canon',
  version: 1,
  updatedAt: '',
  entries: [],
});

const DOMAIN_ALIASES: Record<string, string> = {
  gdd: 'gdd',
  overall: 'gdd',
  master: 'gdd',
  'core-loop': 'core-loop',
  coreloop: 'core-loop',
  gameplay: 'core-loop',
  system: 'system',
  economy: 'economy',
  balance: 'economy',
  world: 'worldbuilding',
  worldbuilding: 'worldbuilding',
  narrative: 'narrative',
  story: 'narrative',
  dialogue: 'dialogue',
  performance: 'performance',
  cutscene: 'performance',
  character: 'character',
  level: 'level',
  map: 'level',
  item: 'item',
  quest: 'quest',
  ux: 'ux',
  ui: 'ux',
  technical: 'technical',
  tech: 'technical',
  production: 'production',
};

const DOMAIN_RULES: Array<{
  domain: string;
  path: RegExp;
  title: RegExp;
  preferredName?: RegExp;
}> = [
  { domain: 'gdd', path: /^01_GDD\//i, title: /\bGDD\b|Game Design Document|游戏设计文档/i, preferredName: /(?:^|\/)GDD\.md$/i },
  { domain: 'core-loop', path: /^01_GDD\//i, title: /Core.*Loop|GameplayLoop|核心(?:玩法)?循环|玩法闭环/i, preferredName: /(?:Gameplay|CoreGameplay)Loop\.md$/i },
  { domain: 'system', path: /^(?:01_GDD|10_SystemDesign)\//i, title: /System Design|系统设计|系统策划/i },
  { domain: 'economy', path: /^(?:01_GDD|05_Items)\//i, title: /Economy|Balance|Progression|数值|经济|平衡|成长/i },
  { domain: 'worldbuilding', path: /^02_Worldbuilding\//i, title: /World|Lore|世界观|设定集/i, preferredName: /World(?:Overview|Bible)\.md$/i },
  { domain: 'narrative', path: /^(?:02_Worldbuilding|06_Quests)\//i, title: /Narrative|Story|Plot|剧情|叙事|故事/i },
  { domain: 'dialogue', path: /^(?:02_Worldbuilding|06_Quests)\//i, title: /Dialogue|台词|对话/i },
  { domain: 'performance', path: /^(?:02_Worldbuilding|06_Quests)\//i, title: /Performance|Cutscene|Cinematic|演出|分镜|过场/i },
  { domain: 'character', path: /^03_Characters\//i, title: /Character|角色/i },
  { domain: 'level', path: /^04_Maps\//i, title: /Level|Map|Island|关卡|地图|岛/i },
  { domain: 'item', path: /^05_Items\//i, title: /Item|道具|物品/i },
  { domain: 'quest', path: /^06_Quests\//i, title: /Quest|任务/i },
  { domain: 'technical', path: /^(?:07_Unity_Tasks|10_SystemDesign)\//i, title: /Technical|Unity|Architecture|技术|架构/i },
  { domain: 'production', path: /^(?:07_Unity_Tasks|\.ars-team)\//i, title: /Task|Production|Milestone|任务|制作|里程碑/i },
];

const VERSION_COPY_RE = /(?:^|[._ -])(?:v(?:er(?:sion)?)?\d+(?:\.\d+)*|final\d*|new|copy\d*|draft\d*|新版|新版本|优化版|改进版|重写版|最终版|终版|副本|备份)(?=\.md$)/i;
const GENERATED_OR_RECOVERY_RE = /(?:\.visual\.md$|\.conflict-|\.merge-|(?:^|\/)(?:recovered|restored|archive|backup|trash)(?:\/|[_.-]))/i;

function normalizeRelativePath(value: string): string {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+/g, '/');
}

function normalizeDomain(value: string): string {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  const domain = DOMAIN_ALIASES[normalized] || normalized;
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(domain)) {
    throw new Error('Canonical domain must be a short identifier such as gdd, core-loop, worldbuilding, narrative, economy, or technical.');
  }
  return domain;
}

function resolveInsideVault(vaultPath: string, relativePath: string): { relativePath: string; fullPath: string } {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized || path.isAbsolute(normalized) || normalized.includes('../') || normalized === '..') {
    throw new Error('A safe vault-relative path is required.');
  }
  const root = path.resolve(vaultPath);
  const fullPath = path.resolve(root, normalized);
  if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
    throw new Error('Path escapes the current vault.');
  }
  return { relativePath: normalized, fullPath };
}

function parseRegistry(raw: string): DesignCanonRegistry {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${DESIGN_CANON_REGISTRY_PATH} contains invalid JSON. Repair it before changing canonical document ownership.`);
  }
  if (!parsed || parsed.kind !== 'ars-note.design-canon' || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error(`${DESIGN_CANON_REGISTRY_PATH} has an unsupported schema.`);
  }
  const entries: DesignCanonEntry[] = [];
  const seen = new Set<string>();
  for (const rawEntry of parsed.entries) {
    const domain = normalizeDomain(rawEntry?.domain || '');
    if (seen.has(domain)) continue;
    const entryPath = normalizeRelativePath(rawEntry?.path || '');
    if (!entryPath.toLowerCase().endsWith('.md')) continue;
    seen.add(domain);
    entries.push({
      domain,
      path: entryPath,
      label: String(rawEntry?.label || domain).trim().slice(0, 120),
      responsibility: String(rawEntry?.responsibility || '').trim().slice(0, 500),
      updatedAt: String(rawEntry?.updatedAt || ''),
    });
  }
  return {
    kind: 'ars-note.design-canon',
    version: 1,
    updatedAt: String(parsed.updatedAt || ''),
    entries,
  };
}

export function readDesignCanonRegistry(vaultPath: string): DesignCanonRegistry {
  const target = resolveInsideVault(vaultPath, DESIGN_CANON_REGISTRY_PATH);
  if (!fs.existsSync(target.fullPath)) return EMPTY_REGISTRY();
  return parseRegistry(fs.readFileSync(target.fullPath, 'utf-8'));
}

export function setCanonicalDesignDocument(
  vaultPath: string,
  input: { domain: string; path: string; label?: string; responsibility?: string },
): { registry: DesignCanonRegistry; entry: DesignCanonEntry; replaced?: DesignCanonEntry } {
  const domain = normalizeDomain(input.domain);
  const targetDocument = resolveInsideVault(vaultPath, input.path);
  if (!targetDocument.relativePath.toLowerCase().endsWith('.md')) {
    throw new Error('A canonical design document must be a Markdown file.');
  }
  if (targetDocument.relativePath.startsWith('.ars-note/') || targetDocument.relativePath.startsWith('.ars-team/')) {
    throw new Error('Generated/internal files cannot be registered as canonical design documents.');
  }
  if (!fs.existsSync(targetDocument.fullPath) || !fs.statSync(targetDocument.fullPath).isFile()) {
    throw new Error(`Canonical document does not exist: ${targetDocument.relativePath}`);
  }

  const registry = readDesignCanonRegistry(vaultPath);
  const replaced = registry.entries.find((entry) => entry.domain === domain);
  const now = new Date().toISOString();
  const entry: DesignCanonEntry = {
    domain,
    path: targetDocument.relativePath,
    label: String(input.label || domain).trim().slice(0, 120),
    responsibility: String(input.responsibility || '').trim().slice(0, 500),
    updatedAt: now,
  };
  const entries = registry.entries.filter((item) => item.domain !== domain);
  entries.push(entry);
  entries.sort((left, right) => left.domain.localeCompare(right.domain));
  const next: DesignCanonRegistry = {
    kind: 'ars-note.design-canon',
    version: 1,
    updatedAt: now,
    entries,
  };
  const registryTarget = resolveInsideVault(vaultPath, DESIGN_CANON_REGISTRY_PATH);
  fs.mkdirSync(path.dirname(registryTarget.fullPath), { recursive: true });
  fs.writeFileSync(registryTarget.fullPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return { registry: next, entry, replaced };
}

function inferDocumentArea(relativePath: string, title = '', content = ''): string {
  const source = `${relativePath}\n${title}\n${content.slice(0, 1500)}`;
  for (const rule of DOMAIN_RULES) {
    if (rule.preferredName?.test(relativePath) || (rule.path.test(relativePath) && rule.title.test(source))) return rule.domain;
  }
  if (/^01_GDD\//i.test(relativePath)) return 'gdd';
  if (/^02_Worldbuilding\//i.test(relativePath)) return 'worldbuilding';
  if (/^03_Characters\//i.test(relativePath)) return 'character';
  if (/^04_Maps\//i.test(relativePath)) return 'level';
  if (/^05_Items\//i.test(relativePath)) return 'item';
  if (/^06_Quests\//i.test(relativePath)) return 'quest';
  if (/^(?:07_Unity_Tasks|10_SystemDesign)\//i.test(relativePath)) return 'technical';
  if (/^\.ars-team\//i.test(relativePath)) return 'production';
  return 'other';
}

export function suggestCanonicalDocuments(
  entries: VaultFileEntry[],
  requestedDomain = '',
  maxPerDomain = 4,
): CanonicalDocumentCandidate[] {
  const domainFilter = requestedDomain ? normalizeDomain(requestedDomain) : '';
  const candidates: CanonicalDocumentCandidate[] = [];
  for (const entry of entries) {
    const relPath = normalizeRelativePath(entry.relPath);
    const fileName = relPath.split('/').pop() || '';
    if (!relPath.toLowerCase().endsWith('.md') || VERSION_COPY_RE.test(fileName) || GENERATED_OR_RECOVERY_RE.test(relPath)) continue;
    for (const rule of DOMAIN_RULES) {
      if (domainFilter && rule.domain !== domainFilter) continue;
      let score = 0;
      const reasons: string[] = [];
      if (rule.preferredName?.test(relPath)) {
        score += 12;
        reasons.push('preferred canonical filename');
      }
      if (rule.path.test(relPath)) {
        score += 4;
        reasons.push('expected design folder');
      }
      if (rule.title.test(`${entry.title}\n${entry.content.slice(0, 1200)}`)) {
        score += 5;
        reasons.push('title/content matches responsibility');
      }
      if (/status\s*:\s*(?:approved|done)|#approved\b/i.test(entry.content.slice(0, 1500))) {
        score += 3;
        reasons.push('approved status');
      }
      if (/status\s*:\s*(?:draft|wip)|#draft\b/i.test(entry.content.slice(0, 1500))) {
        score -= 2;
        reasons.push('draft status');
      }
      if (score >= 5) candidates.push({ domain: rule.domain, path: relPath, title: entry.title, score, reasons });
    }
  }

  const counts = new Map<string, number>();
  return candidates
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .filter((candidate) => {
      const count = counts.get(candidate.domain) || 0;
      if (count >= maxPerDomain) return false;
      counts.set(candidate.domain, count + 1);
      return true;
    });
}

function parseExplicitTerms(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  const raw = String(value || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item || '').trim()).filter(Boolean);
  } catch {}
  return raw.split(/[\n,，;；|]/).map((item) => item.trim()).filter(Boolean);
}

function deriveImpactTerms(changeSummary: string): string[] {
  const terms: string[] = [];
  const quoted = changeSummary.match(/`([^`]{2,40})`|“([^”]{2,40})”|"([^"]{2,40})"/g) || [];
  for (const match of quoted) terms.push(match.replace(/^[`“"]|[`”"]$/g, '').trim());
  const migration = changeSummary.match(/([\p{L}\p{N}_-]{2,24})\s*(?:改为|改成|替换为|→|->)\s*([\p{L}\p{N}_-]{2,24})/gu);
  for (const match of migration || []) {
    const parts = match.split(/改为|改成|替换为|→|->/).map((item) => item.trim());
    terms.push(...parts);
  }
  return terms;
}

function uniqueTerms(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const term = value.trim().replace(/\s+/g, ' ');
    const key = term.toLowerCase();
    if (term.length < 2 || term.length > 48 || seen.has(key)) continue;
    seen.add(key);
    result.push(term);
    if (result.length >= 12) break;
  }
  return result;
}

function countOccurrences(content: string, term: string): number {
  if (!content || !term) return 0;
  const haystack = content.toLowerCase();
  const needle = term.toLowerCase();
  let count = 0;
  let offset = 0;
  while (count < 20) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) break;
    count += 1;
    offset = index + Math.max(needle.length, 1);
  }
  return count;
}

function evidenceAround(content: string, term: string): string {
  const index = content.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return '';
  const start = Math.max(0, index - 70);
  const end = Math.min(content.length, index + term.length + 110);
  return content.slice(start, end).replace(/\s+/g, ' ').trim();
}

function linksToSource(content: string, sourcePath: string): boolean {
  const normalizedSource = normalizeRelativePath(sourcePath).replace(/\.md$/i, '');
  const baseName = normalizedSource.split('/').pop() || normalizedSource;
  const links = content.match(/\[\[([^\]]+)\]\]/g) || [];
  return links.some((rawLink) => {
    const target = rawLink.slice(2, -2).split('|')[0].split('#')[0].trim().replace(/\\/g, '/').replace(/\.md$/i, '');
    return target.toLowerCase() === normalizedSource.toLowerCase()
      || target.toLowerCase() === baseName.toLowerCase()
      || normalizedSource.toLowerCase().endsWith(`/${target.toLowerCase()}`);
  });
}

const DOWNSTREAM_AREAS: Record<string, string[]> = {
  gdd: ['core-loop', 'system', 'economy', 'worldbuilding', 'narrative', 'character', 'level', 'item', 'quest', 'ux', 'technical', 'production'],
  'core-loop': ['system', 'economy', 'level', 'item', 'quest', 'ux', 'technical', 'production'],
  system: ['economy', 'level', 'item', 'quest', 'ux', 'technical', 'production'],
  economy: ['system', 'item', 'quest', 'ux', 'technical', 'production'],
  worldbuilding: ['narrative', 'character', 'level', 'item', 'quest', 'dialogue', 'performance', 'technical', 'production'],
  narrative: ['character', 'quest', 'dialogue', 'performance', 'technical', 'production'],
  dialogue: ['performance', 'quest', 'technical', 'production'],
  performance: ['technical', 'production'],
  character: ['narrative', 'dialogue', 'quest', 'performance', 'technical'],
  level: ['quest', 'ux', 'technical', 'production'],
  item: ['economy', 'quest', 'ux', 'technical'],
  quest: ['dialogue', 'performance', 'ux', 'technical', 'production'],
  ux: ['technical', 'production'],
  technical: ['production'],
};

export function analyzeDesignChange(
  entries: VaultFileEntry[],
  registry: DesignCanonRegistry,
  input: {
    sourcePath: string;
    changeSummary: string;
    terms?: unknown;
    tasks?: any[];
    maxResults?: number;
  },
): DesignImpactResult {
  const sourcePath = normalizeRelativePath(input.sourcePath);
  if (!sourcePath.toLowerCase().endsWith('.md')) throw new Error('source_path must be a vault-relative Markdown document.');
  const sourceEntry = entries.find((entry) => normalizeRelativePath(entry.relPath).toLowerCase() === sourcePath.toLowerCase());
  const sourceDomain = registry.entries.find((entry) => entry.path.toLowerCase() === sourcePath.toLowerCase())?.domain
    || inferDocumentArea(sourcePath, sourceEntry?.title, sourceEntry?.content);
  const canonicalDomains = registry.entries.filter((entry) => entry.path.toLowerCase() === sourcePath.toLowerCase()).map((entry) => entry.domain);
  const terms = uniqueTerms([
    ...parseExplicitTerms(input.terms),
    ...deriveImpactTerms(String(input.changeSummary || '')),
    sourceEntry?.title || '',
    path.basename(sourcePath, '.md'),
  ]);
  const downstream = new Set(DOWNSTREAM_AREAS[sourceDomain] || []);
  const impactedDocuments: DesignImpactResult['impactedDocuments'] = [];

  for (const entry of entries) {
    const relPath = normalizeRelativePath(entry.relPath);
    if (relPath.toLowerCase() === sourcePath.toLowerCase() || GENERATED_OR_RECOVERY_RE.test(relPath)) continue;
    const area = inferDocumentArea(relPath, entry.title, entry.content);
    const reasons: string[] = [];
    const evidence: string[] = [];
    let score = 0;
    if (linksToSource(entry.content, sourcePath)) {
      score += 12;
      reasons.push('direct wiki-link dependency');
    }
    for (const term of terms) {
      const count = countOccurrences(entry.content, term);
      if (count <= 0) continue;
      score += Math.min(8, 2 + count);
      reasons.push(`uses "${term}" (${count})`);
      const sample = evidenceAround(entry.content, term);
      if (sample && evidence.length < 3) evidence.push(sample);
    }
    if (score > 0 && downstream.has(area)) {
      score += 3;
      reasons.push(`${area} is downstream of ${sourceDomain}`);
    }
    if (score < 3) continue;
    impactedDocuments.push({
      path: relPath,
      title: entry.title,
      area,
      severity: score >= 12 ? 'high' : score >= 7 ? 'medium' : 'low',
      score,
      reasons: [...new Set(reasons)],
      evidence,
    });
  }

  const taskList = Array.isArray(input.tasks) ? input.tasks : [];
  const impactedTasks: DesignImpactTask[] = [];
  for (const task of taskList) {
    const linkedDoc = normalizeRelativePath(task?.linkedDoc || task?.doc || '');
    const searchable = [
      task?.title,
      task?.deliverable,
      task?.notes,
      task?.acceptance,
      task?.dependency,
    ].map((value) => String(value || '')).join('\n');
    const reasons: string[] = [];
    if (linkedDoc && linkedDoc.toLowerCase() === sourcePath.toLowerCase()) reasons.push('task links directly to source document');
    for (const term of terms) {
      if (countOccurrences(searchable, term) > 0) reasons.push(`task uses "${term}"`);
    }
    if (reasons.length === 0) continue;
    impactedTasks.push({
      id: String(task?.id || ''),
      title: String(task?.title || task?.deliverable || 'Untitled task'),
      owner: String(task?.owner || ''),
      status: String(task?.status || ''),
      linkedDoc,
      reasons: [...new Set(reasons)],
    });
  }

  const maxResults = Math.max(1, Math.min(100, Number(input.maxResults || 30) || 30));
  impactedDocuments.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  const reviewAreas = [...new Set([
    ...impactedDocuments.map((entry) => entry.area),
    ...downstream,
  ])].filter((area) => area !== 'other').slice(0, 12);
  const scheduleDecisionRequired = impactedTasks.length > 0
    || impactedDocuments.some((entry) => entry.area === 'technical' || entry.area === 'production')
    || /新增|增加|扩展|重做|重构|new|add|expand|rewrite/i.test(String(input.changeSummary || ''));

  return {
    ok: true,
    sourcePath,
    sourceDomain,
    canonicalDomains,
    terms,
    impactedDocuments: impactedDocuments.slice(0, maxResults),
    impactedTasks: impactedTasks.slice(0, maxResults),
    reviewAreas,
    scheduleDecisionRequired,
    decisionRequirements: [
      'Confirm the canonical document and the exact rule being changed.',
      'Classify the proposal as Required now, Replace existing, Defer, or Reject.',
      'List Added, Changed, Removed, Deferred, and Rejected scope.',
      'Name affected owners, dependencies, acceptance checks, QA/retest, migration, and schedule impact.',
      'Do not write until high-severity dependents and active linked tasks have a disposition.',
    ],
  };
}

export function buildDesignCanonPromptContext(
  vaultPath: string,
  entries: VaultFileEntry[],
): string {
  const registry = readDesignCanonRegistry(vaultPath);
  const lines = ['=== ARS-NOTE CANONICAL DESIGN DOCUMENTS ==='];
  if (registry.entries.length === 0) {
    lines.push('No explicit canonical design documents are registered yet.');
    const candidates = suggestCanonicalDocuments(entries, '', 1).slice(0, 8);
    if (candidates.length > 0) {
      lines.push('High-confidence candidates (inspect before registering):');
      for (const candidate of candidates) lines.push(`- ${candidate.domain}: ${candidate.path} (${candidate.reasons.join(', ')})`);
    }
    lines.push(`Registry path: ${DESIGN_CANON_REGISTRY_PATH}. Use get_design_canon before design work.`);
    return lines.join('\n');
  }
  for (const entry of registry.entries.slice(0, 20)) {
    const fullPath = path.resolve(vaultPath, entry.path);
    lines.push(`- ${entry.domain}: ${entry.path}${fs.existsSync(fullPath) ? '' : ' [MISSING]'}${entry.responsibility ? ` — ${entry.responsibility}` : ''}`);
  }
  lines.push('Update registered canonical documents in place; dependent documents should link to them instead of redefining their rules.');
  return lines.join('\n');
}
