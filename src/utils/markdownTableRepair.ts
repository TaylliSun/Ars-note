type ParsedTableRow = {
  cells: string[];
  separator: boolean;
};

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

function splitMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  const outerPipes = getTableDelimiterIndices(trimmed);
  if (outerPipes.length === 0) return null;
  const startsWithPipe = outerPipes[0] === 0;
  const endsWithPipe = outerPipes[outerPipes.length - 1] === trimmed.length - 1;
  const body = trimmed.slice(startsWithPipe ? 1 : 0, endsWithPipe ? -1 : undefined);
  const delimiters = getTableDelimiterIndices(body);
  const cells: string[] = [];
  let cellStart = 0;
  for (const delimiter of delimiters) {
    cells.push(body.slice(cellStart, delimiter).trim().replace(/\\\|/g, '|'));
    cellStart = delimiter + 1;
  }
  cells.push(body.slice(cellStart).trim().replace(/\\\|/g, '|'));
  return cells.length >= 2 ? cells : null;
}

function isLooseSeparatorCell(cell: string): boolean {
  return /^:?-{1,}:?$/.test(cell.replace(/\s+/g, ''));
}

function isLooseMarkdownTableSeparator(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  return !!cells && cells.length > 0 && cells.every(isLooseSeparatorCell);
}

function normalizeSeparatorCell(cell: string | undefined): string {
  const compact = (cell || '').replace(/\s+/g, '');
  const starts = compact.startsWith(':');
  const ends = compact.endsWith(':');
  if (starts && ends) return ':---:';
  if (starts) return ':---';
  if (ends) return '---:';
  return '---';
}

function normalizeRowCells(cells: string[], colCount: number, fill: string): string[] {
  return Array.from({ length: colCount }, (_value, index) => cells[index] ?? fill);
}

function formatTableRow(cells: string[]): string {
  return `| ${cells.map(cell => cell.replace(/\r?\n+/g, ' ').trim()).join(' | ')} |`;
}

function splitCompressedTableRows(text: string): string[] {
  const trimmed = text.trim();
  const rows: string[] = [];
  const boundary = /\|\s+(?=\|)/g;
  let start = 0;
  let match: RegExpExecArray | null;

  while ((match = boundary.exec(trimmed)) !== null) {
    const end = match.index + 1;
    rows.push(trimmed.slice(start, end).trim());
    start = boundary.lastIndex;
  }
  rows.push(trimmed.slice(start).trim());
  return rows.filter(Boolean);
}

export function repairCompressedMarkdownTable(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.includes('|') || !/\|\s+\|/.test(trimmed)) return null;

  const rawRows = splitCompressedTableRows(trimmed);
  if (rawRows.length < 3) return null;

  const rows: ParsedTableRow[] = rawRows
    .map(row => ({
      cells: splitMarkdownTableRow(row) || [],
      separator: isLooseMarkdownTableSeparator(row),
    }))
    .filter(row => row.cells.length >= 2);

  if (rows.length < 3) return null;
  const separatorIndex = rows.findIndex(row => row.separator);
  if (separatorIndex <= 0) return null;
  if (!rows.slice(separatorIndex + 1).some(row => !row.separator)) return null;

  const colCount = Math.max(...rows.map(row => row.cells.length), 2);
  const normalizedRows = rows.map(row => {
    if (row.separator) {
      return formatTableRow(normalizeRowCells(row.cells, colCount, '---').map(normalizeSeparatorCell));
    }
    return formatTableRow(normalizeRowCells(row.cells, colCount, ''));
  });

  return normalizedRows.join('\n');
}

export function normalizeCompressedMarkdownTablesInText(text: string): string {
  if (!text || !text.includes('|')) return text;

  const normalizedLineEndings = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedLineEndings.split('\n');
  let changed = false;
  let inFence = false;

  const repairedLines = lines.map(line => {
    if (/^\s*```/.test(line.trim())) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    const repaired = repairCompressedMarkdownTable(line);
    if (!repaired) return line;
    changed = true;
    return repaired;
  });

  return changed ? repairedLines.join('\n') : text;
}
