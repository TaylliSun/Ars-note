import { normalizeCompressedMarkdownTablesInText } from './markdownTableRepair';

export interface MarkdownRenderOptions {
  resolveImageSrc?: (src: string) => string | null;
  imageNotFoundText?: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeBasicHtml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function sanitizeColorValue(value: string): string | null {
  const color = value.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  if (/^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(?:\s*,\s*(?:0|1|0?\.\d+|[\d.]+%))?\s*\)$/i.test(color)) return color;
  if (/^hsla?\(\s*[\d.]+(?:deg|rad|turn)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%(?:\s*,\s*(?:0|1|0?\.\d+|[\d.]+%))?\s*\)$/i.test(color)) return color;
  const namedColors = new Set(['black', 'white', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray', 'grey', 'brown', 'cyan', 'magenta', 'transparent']);
  return namedColors.has(color.toLowerCase()) ? color.toLowerCase() : null;
}

function sanitizeSpanStyle(styleText: string): string | null {
  const safeRules: string[] = [];
  for (const declaration of styleText.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator === -1) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const rawValue = declaration.slice(separator + 1).trim();
    if (!['color', 'background-color', 'background'].includes(property)) continue;
    const safeColor = sanitizeColorValue(rawValue);
    if (!safeColor) continue;
    const safeProperty = property === 'background' ? 'background-color' : property;
    safeRules.push(`${safeProperty}:${safeColor}`);
  }
  return safeRules.length ? safeRules.join(';') : null;
}

function renderPreviewWikiLink(raw: string): string {
  const decoded = decodeBasicHtml(raw).replace(/\\\|/g, '|');
  const [targetRaw, ...aliasParts] = decoded.split('|');
  const target = (targetRaw || '').trim();
  const alias = (aliasParts.length ? aliasParts.join('|') : target).trim();
  return `<span class="md-wiki-link" data-wiki="${escapeHtml(target)}" title="Open [[${escapeHtml(target)}]]">${escapeHtml(alias)}</span>`;
}

function renderImage(alt: string, src: string, options: MarkdownRenderOptions): string {
  const rawSrc = decodeBasicHtml(src);
  const resolvedSrc = options.resolveImageSrc ? options.resolveImageSrc(rawSrc) : rawSrc;
  if (!resolvedSrc) {
    return `<span class="preview-image-missing">${escapeHtml(options.imageNotFoundText || 'Image not found')}${alt ? ' - ' + escapeHtml(alt) : ''}</span>`;
  }
  return `<img class="md-img" src="${escapeHtml(resolvedSrc)}" alt="${escapeHtml(decodeBasicHtml(alt))}" />`;
}

export function sanitizeMarkdownHref(value: string): string | null {
  const href = decodeBasicHtml(value).trim();
  if (!href || /[\u0000-\u001f\u007f]/.test(href) || href.startsWith('//')) return null;

  const protocolMatch = href.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!protocolMatch) return href;
  const protocol = protocolMatch[1].toLowerCase();
  if (!['http', 'https', 'mailto'].includes(protocol)) return null;

  try {
    const parsed = new URL(href);
    if ((protocol === 'http' || protocol === 'https') && (parsed.username || parsed.password)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function renderMarkdownLink(label: string, rawHref: string): string {
  const href = sanitizeMarkdownHref(rawHref);
  if (!href) return `<span class="md-link md-link-invalid">${label}</span>`;
  return `<a class="md-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${label}</a>`;
}

export function renderInlineMarkdown(text: string, options: MarkdownRenderOptions = {}): string {
  const codeSpans: string[] = [];
  const safeSpans: string[] = [];
  const withSafeSpans = text.replace(/<span\s+style=(["'])([\s\S]*?)\1\s*>([\s\S]*?)<\/span>/gi, (match, _quote, rawStyle, inner) => {
    const safeStyle = sanitizeSpanStyle(rawStyle);
    if (!safeStyle) return match;
    const token = `@@ARS_SAFE_SPAN_${safeSpans.length}@@`;
    safeSpans.push(`<span class="md-color-span" style="${safeStyle}">${renderInlineMarkdown(inner, options)}</span>`);
    return token;
  });

  let html = escapeHtml(withSafeSpans).replace(/`([^`]+)`/g, (_match, code) => {
    const token = `@@ARS_CODE_${codeSpans.length}@@`;
    codeSpans.push(`<code class="md-inline-code">${code}</code>`);
    return token;
  });

  html = html
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, src) => renderImage(alt, src, options))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => renderMarkdownLink(label, href))
    .replace(/\[\[([^\]]+)\]\]/g, (_match, wikiTarget) => renderPreviewWikiLink(wikiTarget))
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>')
    .replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '<em>$1</em>');

  codeSpans.forEach((code, index) => {
    html = html.replace(`@@ARS_CODE_${index}@@`, code);
  });
  safeSpans.forEach((span, index) => {
    html = html.replace(`@@ARS_SAFE_SPAN_${index}@@`, span);
  });
  return html;
}

function isEscapedMarkdownChar(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor--) slashCount++;
  return slashCount % 2 === 1;
}

function getMarkdownTableDelimiterIndices(text: string): number[] {
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

export function splitMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  const outerPipes = getMarkdownTableDelimiterIndices(trimmed);
  if (outerPipes.length === 0) return null;
  const startsWithPipe = outerPipes[0] === 0;
  const endsWithPipe = outerPipes[outerPipes.length - 1] === trimmed.length - 1;
  const normalized = trimmed.slice(startsWithPipe ? 1 : 0, endsWithPipe ? -1 : undefined);
  const delimiters = getMarkdownTableDelimiterIndices(normalized);
  const cells: string[] = [];
  let cellStart = 0;
  for (const delimiter of delimiters) {
    cells.push(normalized.slice(cellStart, delimiter).trim().replace(/\\\|/g, '|'));
    cellStart = delimiter + 1;
  }
  cells.push(normalized.slice(cellStart).trim().replace(/\\\|/g, '|'));
  return cells.length > 1 ? cells : null;
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  return !!cells && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
}

function getMarkdownTableAlignments(separatorLine: string | undefined, colCount: number): Array<'left' | 'center' | 'right'> {
  const cells = separatorLine ? splitMarkdownTableRow(separatorLine) : null;
  return Array.from({ length: colCount }, (_value, index) => {
    const cell = (cells?.[index] || '').replace(/\s+/g, '');
    const starts = cell.startsWith(':');
    const ends = cell.endsWith(':');
    if (starts && ends) return 'center';
    if (ends) return 'right';
    return 'left';
  });
}

function renderMarkdownTable(lines: string[], options: MarkdownRenderOptions): string {
  const rows = lines
    .map(line => ({ cells: splitMarkdownTableRow(line) || [], isSeparator: isMarkdownTableSeparator(line), source: line }))
    .filter(row => row.cells.length > 1);
  const hasHeader = rows.length > 1 && !rows[0].isSeparator && rows[1].isSeparator;
  const separatorLine = rows.find(row => row.isSeparator)?.source;
  const dataRows = rows.filter((row, index) => !row.isSeparator && !(hasHeader && index === 0));
  const headerCells = hasHeader ? rows[0].cells : null;
  const colCount = Math.max(...rows.filter(row => !row.isSeparator).map(row => row.cells.length), 0);
  const alignments = getMarkdownTableAlignments(separatorLine, colCount);

  const renderCells = (cells: string[], tag: 'td' | 'th') => Array.from({ length: colCount }, (_value, index) => {
    const align = alignments[index];
    const className = tag === 'th' ? 'md-th' : 'md-td';
    return `<${tag} class="${className}" style="text-align:${align}">${renderInlineMarkdown(cells[index] || '', options)}</${tag}>`;
  }).join('');

  const tableClass = hasHeader ? 'md-table' : 'md-table md-table-metadata';
  const thead = headerCells ? `<thead><tr>${renderCells(headerCells, 'th')}</tr></thead>` : '';
  const tbody = `<tbody>${dataRows.map(row => `<tr>${renderCells(row.cells, 'td')}</tr>`).join('')}</tbody>`;
  return `<table class="${tableClass}">${thead}${tbody}</table>`;
}

export function renderMarkdown(md: string, options: MarkdownRenderOptions = {}): string {
  if (!md) return '';
  const lines = normalizeCompressedMarkdownTablesInText(md).replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let inFence = false;
  let fenceLang = '';
  let fenceLines: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p class="md-p">${paragraph.map(line => renderInlineMarkdown(line, options)).join(' ')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listType || !listItems.length) return;
    blocks.push(`<${listType} class="md-list">${listItems.join('')}</${listType}>`);
    listItems = [];
    listType = null;
  };
  const flushBlocks = () => {
    flushParagraph();
    flushList();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (inFence) {
      if (/^```/.test(trimmed)) {
        blocks.push(`<pre class="md-pre"><code class="${fenceLang ? `language-${escapeHtml(fenceLang)}` : ''}">${escapeHtml(fenceLines.join('\n'))}</code></pre>`);
        inFence = false;
        fenceLang = '';
        fenceLines = [];
      } else {
        fenceLines.push(line);
      }
      continue;
    }

    const fenceMatch = trimmed.match(/^```(\w*)/);
    if (fenceMatch) {
      flushBlocks();
      inFence = true;
      fenceLang = fenceMatch[1] || '';
      fenceLines = [];
      continue;
    }

    const tableCells = splitMarkdownTableRow(line);
    const nextLine = lines[i + 1] || '';
    const tableMayStart = tableCells && (isMarkdownTableSeparator(nextLine) || isMarkdownTableSeparator(line));
    if (tableMayStart) {
      flushBlocks();
      const tableLines: string[] = [];
      while (i < lines.length && splitMarkdownTableRow(lines[i])) {
        tableLines.push(lines[i]);
        i += 1;
      }
      i -= 1;
      blocks.push(renderMarkdownTable(tableLines, options));
      continue;
    }

    if (!trimmed) {
      flushBlocks();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushBlocks();
      const level = heading[1].length;
      blocks.push(`<h${level} class="md-h${level}">${renderInlineMarkdown(heading[2], options)}</h${level}>`);
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushBlocks();
      blocks.push('<hr class="md-hr" />');
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushBlocks();
      const quoteLines: string[] = [];
      while (i < lines.length) {
        const quoteLine = lines[i].match(/^>\s?(.*)$/);
        if (!quoteLine) break;
        quoteLines.push(quoteLine[1]);
        i += 1;
      }
      i -= 1;

      const callout = quoteLines[0]?.match(/^\[!([a-z0-9_-]+)\](?:\s+(.+))?$/i);
      if (callout) {
        const calloutType = callout[1].toLowerCase().replace(/[^a-z0-9_-]/g, '');
        const fallbackTitles: Record<string, string> = {
          info: 'Info', note: 'Note', tip: 'Tip', warning: 'Warning', danger: 'Danger',
          success: 'Success', question: 'Question', example: 'Example', quote: 'Quote',
        };
        const title = callout[2] || fallbackTitles[calloutType] || calloutType;
        const body = quoteLines.slice(1).filter(lineText => lineText.trim().length > 0);
        blocks.push(
          `<aside class="md-callout md-callout-${calloutType}">`
          + `<div class="md-callout-title">${renderInlineMarkdown(title, options)}</div>`
          + (body.length > 0 ? `<div class="md-callout-body">${body.map(lineText => renderInlineMarkdown(lineText, options)).join('<br />')}</div>` : '')
          + '</aside>',
        );
      } else {
        blocks.push(`<blockquote class="md-blockquote">${quoteLines.map(lineText => renderInlineMarkdown(lineText, options)).join('<br />')}</blockquote>`);
      }
      continue;
    }

    const task = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/);
    if (task) {
      flushParagraph();
      if (listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(`<li class="md-task"><input type="checkbox" disabled ${task[1].toLowerCase() === 'x' ? 'checked' : ''} />${renderInlineMarkdown(task[2], options)}</li>`);
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(`<li class="md-li">${renderInlineMarkdown(unordered[1], options)}</li>`);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(`<li class="md-oli">${renderInlineMarkdown(ordered[1], options)}</li>`);
      continue;
    }

    paragraph.push(line);
  }

  if (inFence) {
    blocks.push(`<pre class="md-pre"><code class="${fenceLang ? `language-${escapeHtml(fenceLang)}` : ''}">${escapeHtml(fenceLines.join('\n'))}</code></pre>`);
  }
  flushBlocks();
  return blocks.join('\n');
}

export function buildExportDocument(bodyHtml: string, title: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    body{font-family:"Segoe UI",system-ui,sans-serif;max-width:840px;margin:40px auto;padding:0 28px;color:#1f2937;line-height:1.72;background:#fff}
    h1,h2,h3,h4{color:#111827;line-height:1.25;margin:1.35em 0 .55em}h1{font-size:30px;border-bottom:2px solid #e5e7eb;padding-bottom:10px}h2{font-size:23px;border-bottom:1px solid #e5e7eb;padding-bottom:7px}h3{font-size:19px}h4{font-size:16px;color:#4b5563}
    p{margin:9px 0}strong{font-weight:700}em{color:#374151}del{opacity:.65}.md-color-span{border-radius:3px;padding:0 2px}.md-color-span,.md-color-span strong,.md-color-span em,.md-color-span del{color:inherit}.md-inline-code{background:#f3f4f6;color:#6d28d9;padding:2px 6px;border-radius:4px;font-family:"Cascadia Code",Consolas,monospace;font-size:.9em}
    pre{background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:14px;overflow:auto;white-space:pre-wrap;word-break:break-word}pre code{background:transparent;color:#111827;padding:0}
    blockquote{border-left:4px solid #c4b5fd;background:#f8fafc;margin:14px 0;padding:9px 16px;color:#4b5563;border-radius:0 8px 8px 0}
    a{color:#2563eb;text-decoration:none;border-bottom:1px solid #93c5fd}img{max-width:100%;border-radius:8px}hr{border:0;border-top:1px solid #e5e7eb;margin:24px 0}
    ul,ol{padding-left:24px}.md-task{list-style:none;margin-left:-22px}.md-task input{margin-right:8px}
    table{border-collapse:collapse;width:100%;margin:18px 0 24px;font-size:14px;line-height:1.45;page-break-inside:auto;box-shadow:0 1px 2px rgba(15,23,42,.05)}
    th,td{border:1px solid #cbd5e1;padding:8px 11px;text-align:left;vertical-align:top;word-break:break-word}th{background:#eef2f7;color:#111827;font-weight:700}tr:nth-child(even) td{background:#f8fafc}.md-table-metadata td:first-child{width:150px;background:#f1f5f9;color:#111827;font-weight:700;white-space:nowrap}
  </style></head><body>${bodyHtml}</body></html>`;
}
