export type TableAlignment = 'left' | 'center' | 'right';
export type TableCellSpan = { from: number; to: number };

function isEscapedMarkdownChar(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor--) slashCount++;
  return slashCount % 2 === 1;
}

function getTableDelimiterIndices(text: string): number[] {
  const pipes: number[] = [];
  let inWikiLink = false;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '[' && text[index + 1] === '[' && !isEscapedMarkdownChar(text, index)) {
      inWikiLink = true;
      index++;
      continue;
    }
    if (inWikiLink && text[index] === ']' && text[index + 1] === ']' && !isEscapedMarkdownChar(text, index)) {
      inWikiLink = false;
      index++;
      continue;
    }
    if (text[index] === '|' && !inWikiLink && !isEscapedMarkdownChar(text, index)) pipes.push(index);
  }
  return pipes;
}

function trimCellSpan(text: string, from: number, to: number): TableCellSpan {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return { from: start, to: end };
}

export function splitMarkdownTableRow(text: string): string[] | null {
  const trimmed = text.trim();
  const outerPipes = getTableDelimiterIndices(trimmed);
  if (outerPipes.length === 0) return null;
  const startsWithPipe = outerPipes[0] === 0;
  const endsWithPipe = outerPipes[outerPipes.length - 1] === trimmed.length - 1;
  const normalized = trimmed.slice(startsWithPipe ? 1 : 0, endsWithPipe ? -1 : undefined);
  const delimiters = getTableDelimiterIndices(normalized);
  const cells: string[] = [];
  let cellStart = 0;
  for (const delimiter of delimiters) {
    cells.push(normalized.slice(cellStart, delimiter).trim().replace(/\\\|/g, '|'));
    cellStart = delimiter + 1;
  }
  cells.push(normalized.slice(cellStart).trim().replace(/\\\|/g, '|'));
  return cells.length > 1 ? cells : null;
}

export function isMarkdownTableSeparatorRow(text: string): boolean {
  const cells = splitMarkdownTableRow(text);
  return !!cells && cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
}

export function getMarkdownTableAlignments(separatorText: string | undefined, colCount: number): TableAlignment[] {
  const cells = separatorText ? splitMarkdownTableRow(separatorText) : null;
  return Array.from({ length: colCount }, (_, index) => {
    const cell = (cells?.[index] || '').replace(/\s+/g, '');
    const starts = cell.startsWith(':');
    const ends = cell.endsWith(':');
    if (starts && ends) return 'center';
    if (ends) return 'right';
    return 'left';
  });
}

export function normalizeMarkdownTableCells(cells: string[], colCount: number): string[] {
  return Array.from({ length: colCount }, (_, index) => cells[index] || '');
}

export function normalizeEditableTableCellInput(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/\r?\n+/g, ' ').trim();
}

export function escapeMarkdownTableCell(text: string): string {
  return normalizeEditableTableCellInput(text).replace(/\|/g, '\\|');
}

export function formatMarkdownTableRow(cells: string[], colCount: number): string {
  return `| ${normalizeMarkdownTableCells(cells, colCount).map(escapeMarkdownTableCell).join(' | ')} |`;
}

export function getMarkdownTableCellSpans(text: string, colCount: number): TableCellSpan[] {
  const pipes = getTableDelimiterIndices(text);
  const spans: TableCellSpan[] = [];
  if (pipes.length > 0) {
    const firstNonSpace = text.search(/\S/);
    const hasLeadingPipe = firstNonSpace >= 0 && pipes[0] === firstNonSpace;
    const trimmedEnd = text.trimEnd();
    const hasTrailingPipe = pipes[pipes.length - 1] === trimmedEnd.length - 1;
    let segmentFrom = hasLeadingPipe ? pipes[0] + 1 : 0;
    const firstBoundary = hasLeadingPipe ? 1 : 0;

    for (let pipeIndex = firstBoundary; pipeIndex < pipes.length; pipeIndex++) {
      const segmentTo = pipes[pipeIndex];
      if (segmentTo >= segmentFrom) spans.push(trimCellSpan(text, segmentFrom, segmentTo));
      segmentFrom = segmentTo + 1;
    }
    if (!hasTrailingPipe && segmentFrom <= text.length) spans.push(trimCellSpan(text, segmentFrom, text.length));
  }

  const fallback = trimCellSpan(text, 0, text.length);
  return Array.from({ length: colCount }, (_, index) => spans[index] || fallback);
}

export function applyMarkdownTableCellEdit(line: string, colCount: number, cellIndex: number, value: string): string {
  const spans = getMarkdownTableCellSpans(line, colCount);
  const span = spans[cellIndex];
  if (!span) return line;
  return `${line.slice(0, span.from)}${escapeMarkdownTableCell(value)}${line.slice(span.to)}`;
}

export function addMarkdownTableColumn(lines: string[]): string[] {
  const colCount = Math.max(1, ...lines.map(line => splitMarkdownTableRow(line)?.length || 0));
  return lines.map(line => {
    const cells = normalizeMarkdownTableCells(splitMarkdownTableRow(line) || [], colCount);
    cells.push(isMarkdownTableSeparatorRow(line) ? '---' : '');
    return formatMarkdownTableRow(cells, colCount + 1);
  });
}

export function addMarkdownTableRow(lines: string[]): string[] {
  const colCount = Math.max(1, ...lines.map(line => splitMarkdownTableRow(line)?.length || 0));
  return [...lines, formatMarkdownTableRow([], colCount)];
}
