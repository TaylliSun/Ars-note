import * as fs from 'fs';
import * as path from 'path';

const SKIP_DIRS = new Set([
  '.ars-note',
  '.ai-memory',
  '.git',
  '.cache',
  'node_modules',
  'dist',
  'out',
  '__pycache__',
]);
const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;

export interface VaultTextMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
  inCodeBlock: boolean;
}

export interface VaultTextSearchResult {
  query: string;
  fileCount: number;
  matchCount: number;
  matches: VaultTextMatch[];
  truncated: boolean;
  skippedFiles: Array<{ path: string; reason: string }>;
}

export interface VaultTermRefactorPlanItem {
  path: string;
  fullPath: string;
  before: string;
  after: string;
  replacementCount: number;
  preservedCodeBlockMatches: number;
}

export interface VaultTermRefactorPlan {
  from: string;
  to: string;
  requestedPaths: string[];
  changed: VaultTermRefactorPlanItem[];
  unchanged: string[];
  skipped: Array<{ path: string; reason: string }>;
  replacementCount: number;
  preservedCodeBlockMatches: number;
}

export interface VaultTextSearchOptions {
  paths?: unknown;
  pathScope?: string;
  caseSensitive?: boolean;
  maxMatches?: number;
}

export interface VaultTermRefactorOptions {
  from: string;
  to: string;
  paths: unknown;
  caseSensitive?: boolean;
  replaceInCodeBlocks?: boolean;
}

function normalizeRelativePath(value: unknown): string {
  const normalized = String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '');
  if (!normalized || /^[A-Za-z]:\//.test(normalized)) return '';
  const segments = normalized.split('/');
  if (segments.some(segment => segment === '..' || segment === '.')) return '';
  return normalized;
}

export function parseVaultTerminologyPaths(input: unknown, limit = 500): string[] {
  let values: unknown[] = [];
  if (Array.isArray(input)) {
    values = input;
  } else {
    const raw = String(input || '').trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      values = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      values = raw.split(/\r?\n|,/);
    }
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const candidate = value && typeof value === 'object'
      ? (value as { path?: unknown; relativePath?: unknown }).path
        ?? (value as { relativePath?: unknown }).relativePath
      : value;
    const relativePath = normalizeRelativePath(candidate);
    if (!relativePath || !relativePath.toLowerCase().endsWith('.md')) continue;
    const key = relativePath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(relativePath);
    if (result.length >= limit) break;
  }
  return result;
}

function resolveInsideVault(vaultPath: string, relativePath: string): string {
  const root = path.resolve(vaultPath);
  const fullPath = path.resolve(root, relativePath);
  const relative = path.relative(root, fullPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes or resolves to the vault root: ${relativePath}`);
  }
  return fullPath;
}

function collectMarkdownPaths(vaultPath: string, pathScope = ''): string[] {
  const root = path.resolve(vaultPath);
  const normalizedScope = normalizeRelativePath(pathScope);
  const start = normalizedScope ? resolveInsideVault(root, normalizedScope) : root;
  if (!fs.existsSync(start)) return [];

  const result: string[] = [];
  const walk = (directory: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        result.push(path.relative(root, fullPath).replace(/\\/g, '/'));
      }
    }
  };

  const stat = fs.statSync(start);
  if (stat.isFile()) {
    if (start.toLowerCase().endsWith('.md')) {
      result.push(path.relative(root, start).replace(/\\/g, '/'));
    }
  } else if (stat.isDirectory()) {
    walk(start);
  }
  return result;
}

function buildLiteralRegex(term: string, caseSensitive: boolean): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, caseSensitive ? 'gu' : 'giu');
}

function countLiteralMatches(text: string, term: string, caseSensitive: boolean): number {
  if (!text || !term) return 0;
  return Array.from(text.matchAll(buildLiteralRegex(term, caseSensitive))).length;
}

function readMarkdownFile(fullPath: string, relativePath: string): { content?: string; reason?: string } {
  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return { reason: 'not-a-file' };
    if (stat.size > MAX_MARKDOWN_BYTES) return { reason: 'file-too-large' };
    return { content: fs.readFileSync(fullPath, 'utf-8') };
  } catch (error: any) {
    return { reason: error?.message || 'read-failed' };
  }
}

function markdownLinesWithFenceState(content: string): Array<{ text: string; inCodeBlock: boolean }> {
  const lines = content.split(/\r\n|\n|\r/);
  const result: Array<{ text: string; inCodeBlock: boolean }> = [];
  let activeFence = '';
  for (const text of lines) {
    const fence = text.match(/^\s*(```+|~~~+)/)?.[1] || '';
    const onFenceLine = !!fence;
    result.push({ text, inCodeBlock: !!activeFence || onFenceLine });
    if (fence) {
      if (!activeFence) activeFence = fence[0];
      else if (fence[0] === activeFence) activeFence = '';
    }
  }
  return result;
}

function candidatePaths(vaultPath: string, pathsInput: unknown, pathScope = ''): string[] {
  const explicitPaths = parseVaultTerminologyPaths(pathsInput);
  return explicitPaths.length > 0 ? explicitPaths : collectMarkdownPaths(vaultPath, pathScope);
}

export function searchVaultText(
  vaultPath: string,
  query: string,
  options: VaultTextSearchOptions = {},
): VaultTextSearchResult {
  const cleanQuery = String(query || '');
  if (!cleanQuery.trim()) throw new Error('Search query is required.');
  if (cleanQuery.length > 500) throw new Error('Search query is too long.');

  const maxMatches = Math.max(1, Math.min(1000, Math.floor(options.maxMatches || 300)));
  const caseSensitive = !!options.caseSensitive;
  const paths = candidatePaths(vaultPath, options.paths, options.pathScope);
  const matches: VaultTextMatch[] = [];
  const skippedFiles: Array<{ path: string; reason: string }> = [];
  let fileCount = 0;
  let matchCount = 0;

  for (const relativePath of paths) {
    let fullPath = '';
    try {
      fullPath = resolveInsideVault(vaultPath, relativePath);
    } catch (error: any) {
      skippedFiles.push({ path: relativePath, reason: error?.message || 'invalid-path' });
      continue;
    }
    if (!fs.existsSync(fullPath)) {
      skippedFiles.push({ path: relativePath, reason: 'missing' });
      continue;
    }
    const file = readMarkdownFile(fullPath, relativePath);
    if (typeof file.content !== 'string') {
      skippedFiles.push({ path: relativePath, reason: file.reason || 'read-failed' });
      continue;
    }
    fileCount += 1;
    const lines = markdownLinesWithFenceState(file.content);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const occurrences = Array.from(line.text.matchAll(buildLiteralRegex(cleanQuery, caseSensitive)));
      matchCount += occurrences.length;
      for (const occurrence of occurrences) {
        if (matches.length >= maxMatches) continue;
        const column = (occurrence.index || 0) + 1;
        const start = Math.max(0, column - 61);
        const preview = line.text.slice(start, start + 180).trim();
        matches.push({
          path: relativePath,
          line: lineIndex + 1,
          column,
          preview,
          inCodeBlock: line.inCodeBlock,
        });
      }
    }
  }

  return {
    query: cleanQuery,
    fileCount,
    matchCount,
    matches,
    truncated: matchCount > matches.length,
    skippedFiles,
  };
}

function replaceOutsideCodeBlocks(
  content: string,
  from: string,
  to: string,
  caseSensitive: boolean,
  replaceInCodeBlocks: boolean,
): { content: string; replacementCount: number; preservedCodeBlockMatches: number } {
  const parts = content.split(/(\r\n|\n|\r)/);
  let activeFence = '';
  let replacementCount = 0;
  let preservedCodeBlockMatches = 0;
  const pattern = buildLiteralRegex(from, caseSensitive);

  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index] || '';
    const fence = line.match(/^\s*(```+|~~~+)/)?.[1] || '';
    const inCodeBlock = !!activeFence || !!fence;
    if (inCodeBlock && !replaceInCodeBlocks) {
      preservedCodeBlockMatches += countLiteralMatches(line, from, caseSensitive);
    } else {
      parts[index] = line.replace(pattern, () => {
        replacementCount += 1;
        return to;
      });
    }
    if (fence) {
      if (!activeFence) activeFence = fence[0];
      else if (fence[0] === activeFence) activeFence = '';
    }
  }

  return { content: parts.join(''), replacementCount, preservedCodeBlockMatches };
}

export function planVaultTermRefactor(
  vaultPath: string,
  options: VaultTermRefactorOptions,
): VaultTermRefactorPlan {
  const from = String(options.from || '');
  const to = String(options.to || '');
  if (!from.trim()) throw new Error('Source term is required.');
  if (!to.trim()) throw new Error('Replacement term is required.');
  if (from === to) throw new Error('Source and replacement terms are identical.');
  if (from.length > 500 || to.length > 500) throw new Error('Source or replacement term is too long.');

  const requestedPaths = parseVaultTerminologyPaths(options.paths);
  if (requestedPaths.length === 0) {
    throw new Error('At least one explicit Markdown path is required for a terminology migration.');
  }

  const changed: VaultTermRefactorPlanItem[] = [];
  const unchanged: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  let replacementCount = 0;
  let preservedCodeBlockMatches = 0;

  for (const relativePath of requestedPaths) {
    let fullPath = '';
    try {
      fullPath = resolveInsideVault(vaultPath, relativePath);
    } catch (error: any) {
      skipped.push({ path: relativePath, reason: error?.message || 'invalid-path' });
      continue;
    }
    if (!fs.existsSync(fullPath)) {
      skipped.push({ path: relativePath, reason: 'missing' });
      continue;
    }
    const file = readMarkdownFile(fullPath, relativePath);
    if (typeof file.content !== 'string') {
      skipped.push({ path: relativePath, reason: file.reason || 'read-failed' });
      continue;
    }
    const replaced = replaceOutsideCodeBlocks(
      file.content,
      from,
      to,
      !!options.caseSensitive,
      !!options.replaceInCodeBlocks,
    );
    preservedCodeBlockMatches += replaced.preservedCodeBlockMatches;
    if (replaced.replacementCount === 0) {
      unchanged.push(relativePath);
      continue;
    }
    replacementCount += replaced.replacementCount;
    changed.push({
      path: relativePath,
      fullPath,
      before: file.content,
      after: replaced.content,
      replacementCount: replaced.replacementCount,
      preservedCodeBlockMatches: replaced.preservedCodeBlockMatches,
    });
  }

  return {
    from,
    to,
    requestedPaths,
    changed,
    unchanged,
    skipped,
    replacementCount,
    preservedCodeBlockMatches,
  };
}
