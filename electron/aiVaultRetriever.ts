import type { VaultFileEntry } from './aiVaultScanner';

const ENGLISH_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'what',
  'when', 'where', 'which', 'will', 'would', 'should', 'could', 'have',
  'has', 'had', 'are', 'was', 'were', 'been', 'about', 'your', 'you',
  'please', 'help', 'make', 'write', 'create', 'update', 'change',
]);
const CHINESE_STOP_WORDS = new Set([
  '这个', '那个', '什么', '怎么', '可以', '需要', '现在', '还是', '一个',
  '我们', '你们', '他们', '帮我', '进行', '里面', '部分', '东西',
]);

export interface VaultRetrievalChunk {
  path: string;
  title: string;
  heading: string;
  startLine: number;
  content: string;
  score: number;
}

export interface VaultRetrievalResult {
  contextText: string;
  query: string;
  queryTokens: string[];
  chunks: VaultRetrievalChunk[];
  scannedFileCount: number;
  scannedChunkCount: number;
}

export interface VaultRetrievalOptions {
  maxChunks?: number;
  maxChars?: number;
  maxChunksPerFile?: number;
}

export function extractAIUserIntentText(value: string): string {
  const text = String(value || '').trim();
  if (!text) return '';
  const marker = 'User request:';
  const markerIndex = text.lastIndexOf(marker);
  if (markerIndex >= 0) return text.slice(markerIndex + marker.length).trim().slice(-6000);
  const separators = ['\n\n---\n\n', '\r\n\r\n---\r\n\r\n'];
  for (const separator of separators) {
    const index = text.lastIndexOf(separator);
    if (index >= 0 && index + separator.length < text.length) {
      return text.slice(index + separator.length).trim().slice(-6000);
    }
  }
  return text.slice(-6000);
}

function tokenizeCjkSequence(sequence: string): string[] {
  const clean = sequence.trim();
  if (clean.length < 2 || CHINESE_STOP_WORDS.has(clean)) return [];
  const tokens = new Set<string>();
  if (clean.length <= 12) tokens.add(clean);
  for (const size of [2, 3, 4]) {
    if (clean.length < size) continue;
    for (let index = 0; index <= clean.length - size; index += 1) {
      const token = clean.slice(index, index + size);
      if (!CHINESE_STOP_WORDS.has(token)) tokens.add(token);
    }
  }
  return Array.from(tokens);
}

export function tokenizeVaultRetrievalText(value: string, maxTokens = 96): string[] {
  const text = String(value || '').toLowerCase();
  const tokens = new Set<string>();
  const english = text.match(/[a-z0-9][a-z0-9_-]{1,}/g) || [];
  for (const token of english) {
    if (!ENGLISH_STOP_WORDS.has(token)) tokens.add(token);
    if (tokens.size >= maxTokens) break;
  }
  if (tokens.size < maxTokens) {
    const cjkSequences = text.match(/[\u3400-\u9fff\uf900-\ufaff]{2,}/g) || [];
    for (const sequence of cjkSequences) {
      for (const token of tokenizeCjkSequence(sequence)) {
        tokens.add(token);
        if (tokens.size >= maxTokens) break;
      }
      if (tokens.size >= maxTokens) break;
    }
  }
  return Array.from(tokens);
}

function chunkMarkdown(entry: VaultFileEntry, maxChars = 1800): VaultRetrievalChunk[] {
  const lines = entry.content.split(/\r\n|\n|\r/);
  const chunks: VaultRetrievalChunk[] = [];
  let heading = entry.title;
  let startLine = 1;
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (content) {
      chunks.push({
        path: entry.relPath,
        title: entry.title,
        heading,
        startLine,
        content,
        score: 0,
      });
    }
    buffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      flush();
      heading = headingMatch[1].trim();
      startLine = index + 1;
      buffer.push(line);
      continue;
    }
    if (buffer.length === 0) startLine = index + 1;
    const projectedLength = buffer.reduce((sum, item) => sum + item.length + 1, 0) + line.length;
    if (projectedLength > maxChars && buffer.length > 0) {
      flush();
      startLine = index + 1;
    }
    buffer.push(line);
  }
  flush();
  return chunks;
}

function countOccurrences(text: string, token: string, cap = 8): number {
  if (!text || !token) return 0;
  let count = 0;
  let offset = 0;
  while (count < cap) {
    const index = text.indexOf(token, offset);
    if (index < 0) break;
    count += 1;
    offset = index + Math.max(1, token.length);
  }
  return count;
}

export function retrieveRelevantVaultContext(
  entries: VaultFileEntry[],
  rawQuery: string,
  options: VaultRetrievalOptions = {},
): VaultRetrievalResult {
  const query = extractAIUserIntentText(rawQuery);
  const queryTokens = tokenizeVaultRetrievalText(query);
  const maxChunks = Math.max(1, Math.min(20, Math.floor(options.maxChunks || 8)));
  const maxChars = Math.max(2000, Math.min(50000, Math.floor(options.maxChars || 14000)));
  const maxChunksPerFile = Math.max(1, Math.min(5, Math.floor(options.maxChunksPerFile || 2)));
  const chunks = entries.flatMap(entry => chunkMarkdown(entry));
  if (!query || queryTokens.length === 0 || chunks.length === 0) {
    return {
      contextText: '',
      query,
      queryTokens,
      chunks: [],
      scannedFileCount: entries.length,
      scannedChunkCount: chunks.length,
    };
  }

  const documentFrequency = new Map<string, number>();
  for (const token of queryTokens) {
    let count = 0;
    for (const chunk of chunks) {
      const searchable = `${chunk.path}\n${chunk.title}\n${chunk.heading}\n${chunk.content}`.toLowerCase();
      if (searchable.includes(token)) count += 1;
    }
    documentFrequency.set(token, count);
  }

  const queryLower = query.toLowerCase();
  const scored = chunks.map(chunk => {
    const pathText = chunk.path.toLowerCase();
    const titleText = `${chunk.title} ${chunk.heading}`.toLowerCase();
    const contentText = chunk.content.toLowerCase();
    let score = countOccurrences(contentText, queryLower, 3) * 18;
    for (const token of queryTokens) {
      const tf = countOccurrences(contentText, token);
      const df = documentFrequency.get(token) || 0;
      const idf = Math.log((chunks.length + 1) / (df + 1)) + 1;
      const lengthNorm = 0.65 + Math.min(1.5, 900 / Math.max(600, chunk.content.length));
      score += tf * idf * lengthNorm;
      if (titleText.includes(token)) score += 7 * idf;
      if (pathText.includes(token)) score += 5 * idf;
    }
    return { ...chunk, score };
  }).filter(chunk => chunk.score > 1.5);

  scored.sort((left, right) => right.score - left.score
    || left.path.localeCompare(right.path)
    || left.startLine - right.startLine);

  const selected: VaultRetrievalChunk[] = [];
  const fileCounts = new Map<string, number>();
  let usedChars = 0;
  for (const chunk of scored) {
    if (selected.length >= maxChunks) break;
    const fileCount = fileCounts.get(chunk.path) || 0;
    if (fileCount >= maxChunksPerFile) continue;
    const header = `--- SOURCE: ${chunk.path}:${chunk.startLine} | ${chunk.heading} ---\n`;
    if (selected.length > 0 && usedChars + header.length + chunk.content.length > maxChars) continue;
    selected.push(chunk);
    fileCounts.set(chunk.path, fileCount + 1);
    usedChars += header.length + chunk.content.length + 2;
  }

  const contextText = selected.length > 0
    ? [
      `=== RETRIEVED VAULT CONTEXT (${selected.length} chunks from ${fileCounts.size} files) ===`,
      'These are locally retrieved Markdown excerpts. Treat source paths and line numbers as evidence; use read_file when full context is required.',
      ...selected.flatMap(chunk => [
        `--- SOURCE: ${chunk.path}:${chunk.startLine} | ${chunk.heading} | score ${chunk.score.toFixed(2)} ---`,
        chunk.content,
      ]),
    ].join('\n')
    : '';

  return {
    contextText,
    query,
    queryTokens,
    chunks: selected,
    scannedFileCount: entries.length,
    scannedChunkCount: chunks.length,
  };
}
