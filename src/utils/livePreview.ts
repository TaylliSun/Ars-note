/* ── Live Preview Extension for CodeMirror 6 ────────── */
/* Renders Markdown inline in Ars-note Live Preview */
/* Uses CM6 decoration system on the Lezer parse tree     */

import {
  EditorView, Decoration, DecorationSet, ViewPlugin, WidgetType
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { EditorState, Extension, Range, StateEffect, StateField } from '@codemirror/state';
import { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { repairCompressedMarkdownTable } from './markdownTableRepair';
import { sanitizeMarkdownHref } from './markdownRenderer';
import {
  escapeMarkdownTableCell as escapeTableCell,
  formatMarkdownTableRow,
  getMarkdownTableAlignments as getTableAlignments,
  getMarkdownTableCellSpans as getTableCellSpans,
  isMarkdownTableSeparatorRow as isTableSeparatorRow,
  normalizeEditableTableCellInput,
  normalizeMarkdownTableCells as normalizeTableCells,
  splitMarkdownTableRow as splitTableRow,
} from './markdownTableModel';
import type { TableAlignment, TableCellSpan } from './markdownTableModel';

/* ═══════════════════════════════════════════════════════
   Widget Types — custom DOM elements inserted into editor
   ═══════════════════════════════════════════════════════ */

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) { super(); }
  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'cm-lp-checkbox-wrap';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.checked;
    input.className = 'cm-lp-checkbox';
    input.setAttribute('readonly', '');
    wrap.appendChild(input);
    return wrap;
  }
  ignoreEvent() { return false; }
}

class HrWidget extends WidgetType {
  toDOM() {
    const hr = document.createElement('span');
    hr.className = 'cm-lp-hr';
    return hr;
  }
  ignoreEvent() { return true; }
}

class QuoteBarWidget extends WidgetType {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-lp-quote-bar';
    return span;
  }
  ignoreEvent() { return true; }
}

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) { super(); }
  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'cm-lp-image-wrap';
    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    img.className = 'cm-lp-image';
    img.loading = 'lazy';
    img.onerror = () => { wrap.classList.add('cm-lp-image-broken'); };
    wrap.appendChild(img);
    return wrap;
  }
  ignoreEvent() { return true; }
  eq(other: ImageWidget) { return other.src === this.src && other.alt === this.alt; }
}

/* ── Table Widget — renders a complete HTML table for a markdown table block ── */

/* Parse inline markdown within a table cell → returns HTML string */
class CodeBlockWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly language: string,
    readonly sourceFrom: number,
    readonly contentFrom: number,
  ) { super(); }

  get estimatedHeight() {
    const lineCount = Math.max(1, this.code.split('\n').length);
    return 34 + lineCount * 22;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-lp-codeblock-widget';
    wrap.title = 'Click to edit code block source';
    const surface = document.createElement('div');
    surface.className = 'cm-lp-codeblock-surface';

    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    if (this.language) codeEl.dataset.language = this.language;
    codeEl.textContent = this.code || '\u200b';
    pre.appendChild(codeEl);
    surface.appendChild(pre);
    wrap.appendChild(surface);

    wrap.addEventListener('mousedown', event => {
      if (view.state.facet(EditorState.readOnly)) return;
      event.preventDefault();
      event.stopPropagation();
      const anchor = Math.max(this.sourceFrom, Math.min(view.state.doc.length, this.contentFrom));
      view.dispatch({ selection: { anchor } });
      view.focus();
      requestAnimationFrame(() => view.requestMeasure());
    });

    requestAnimationFrame(() => view.requestMeasure());
    return wrap;
  }

  ignoreEvent() { return true; }

  eq(other: CodeBlockWidget) {
    return other.code === this.code
      && other.language === this.language
      && other.sourceFrom === this.sourceFrom
      && other.contentFrom === this.contentFrom;
  }
}

type TableSourceLine = { text: string; isSep: boolean; cells: string[] };
type TableRowKind = 'header' | 'body' | 'metadata' | 'separator';

function sameStringArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameTableCellSpans(left: readonly TableCellSpan[], right: readonly TableCellSpan[]) {
  return left.length === right.length && left.every((value, index) => (
    value.from === right[index]?.from && value.to === right[index]?.to
  ));
}

function sameTableRows(left: readonly string[][], right: readonly string[][]) {
  return left.length === right.length && left.every((row, index) => sameStringArray(row, right[index] || []));
}

function sameTableSourceLines(left: readonly TableSourceLine[], right: readonly TableSourceLine[]) {
  return left.length === right.length && left.every((line, index) => {
    const candidate = right[index];
    return Boolean(candidate)
      && line.text === candidate.text
      && line.isSep === candidate.isSep
      && sameStringArray(line.cells, candidate.cells);
  });
}

function sanitizeColorValue(value: string): string | null {
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

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeBasicHtml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function renderWikiLink(raw: string): string {
  const decoded = decodeBasicHtml(raw).replace(/\\\|/g, '|');
  const [targetRaw, ...aliasParts] = decoded.split('|');
  const target = (targetRaw || '').trim();
  const alias = (aliasParts.length ? aliasParts.join('|') : target).trim();
  const display = alias
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<span class="cm-lp-wiki-link" data-wiki="${escapeHtmlAttribute(target)}" title="Open [[${escapeHtmlAttribute(target)}]]">${display}</span>`;
}

function dispatchWikiOpen(target: string): void {
  const cleanTarget = target.trim();
  if (!cleanTarget) return;
  window.dispatchEvent(new CustomEvent('ars-note:open-wiki-link', {
    detail: { target: cleanTarget },
  }));
}

function openWikiFromEvent(event: Event): boolean {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLElement>('.cm-lp-wiki-link')
    : null;
  if (!target) return false;
  event.preventDefault();
  event.stopPropagation();
  dispatchWikiOpen(target.dataset.wiki || target.textContent || '');
  return true;
}

function renderCellMarkdown(text: string): string {
  const safeSpans: string[] = [];
  const withSafeSpans = text.replace(/<span\s+style=(["'])([\s\S]*?)\1\s*>([\s\S]*?)<\/span>/gi, (match, _quote, rawStyle, inner) => {
    const safeStyle = sanitizeSpanStyle(rawStyle);
    if (!safeStyle) return match;
    const token = `@@ARS_SAFE_SPAN_${safeSpans.length}@@`;
    safeSpans.push(`<span style="${safeStyle}">${renderCellMarkdown(inner)}</span>`);
    return token;
  });

  let html = withSafeSpans
    /* Escape HTML entities first */
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    /* Inline code: `code` */
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    /* Bold: **text** or __text__ */
    .replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight:700;color:inherit">$1</strong>')
    .replace(/__(.+?)__/g, '<strong style="font-weight:700;color:inherit">$1</strong>')
    /* Italic: *text* or _text_ */
    .replace(/\*(.+?)\*/g, '<em style="font-style:italic;color:inherit">$1</em>')
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, '<em style="font-style:italic;color:inherit">$1</em>')
    /* Strikethrough: ~~text~~ */
    .replace(/~~(.+?)~~/g, '<del style="opacity:0.6">$1</del>')
    /* Links: [text](url) */
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, rawHref) => {
      const href = sanitizeMarkdownHref(rawHref);
      if (!href) return `<span class="cm-lp-link-invalid">${label}</span>`;
      return `<a href="${escapeHtmlAttribute(href)}" target="_blank" rel="noreferrer" style="color:#9cc6ff;text-decoration:underline">${label}</a>`;
    })
    /* Wiki links: [[text]] */
    .replace(/\[\[([^\]]+)\]\]/g, (_match, wikiTarget) => renderWikiLink(wikiTarget));
  safeSpans.forEach((span, index) => {
    html = html.replace(`@@ARS_SAFE_SPAN_${index}@@`, span);
  });
  return html;
}

function getTableColumnTemplate(rows: string[][], colCount: number, hasHeader: boolean): string {
  if (!hasHeader && colCount === 2) return 'minmax(92px, 0.32fr) minmax(220px, 1fr)';

  const weights = Array.from({ length: colCount }, (_, columnIndex) => {
    const maxLength = Math.max(
      4,
      ...rows.map(row => (row[columnIndex] || '').replace(/[*_~`[\]()]/g, '').length),
    );
    return Math.min(24, Math.max(6, maxLength));
  });

  return weights
    .map(weight => `minmax(${Math.min(16, weight + 2)}ch, ${weight}fr)`)
    .join(' ');
}

class TableLineWidget extends WidgetType {
  constructor(
    readonly cells: string[],
    readonly cellSpans: TableCellSpan[],
    readonly colCount: number,
    readonly alignments: TableAlignment[],
    readonly kind: TableRowKind,
    readonly lineFrom: number,
    readonly lineTo: number,
    readonly columnTemplate: string,
    readonly isFirst: boolean,
    readonly isLast: boolean,
  ) { super(); }

  toDOM(view: EditorView) {
    const row = document.createElement('span');
    row.className = [
      'cm-lp-table-line-widget',
      `cm-lp-table-line-${this.kind}`,
      this.isFirst ? 'cm-lp-table-line-first' : '',
      this.isLast ? 'cm-lp-table-line-last' : '',
    ].filter(Boolean).join(' ');
    row.style.gridTemplateColumns = this.columnTemplate;
    const readOnly = view.state.facet(EditorState.readOnly);
    row.title = readOnly ? 'Rendered table row' : 'Click a cell to edit it directly';

    if (this.kind === 'separator') {
      row.setAttribute('aria-hidden', 'true');
    } else {
      for (let ci = 0; ci < this.colCount; ci++) {
        const cell = document.createElement('span');
        cell.className = 'cm-lp-table-line-cell';
        cell.dataset.cellIndex = String(ci);
        cell.dataset.tableLineFrom = String(this.lineFrom);
        cell.style.textAlign = this.alignments[ci] || 'left';
        const sourceText = this.cells[ci] || '';
        if (readOnly) {
          cell.innerHTML = renderCellMarkdown(sourceText);
        } else {
          cell.classList.add('cm-lp-table-cell-ready');
          cell.innerHTML = renderCellMarkdown(sourceText);
        }
        row.appendChild(cell);
      }
    }

    if (!readOnly && this.isFirst) {
      row.appendChild(this.createTableAction('cm-lp-table-line-add-col', 'Add column', () => this.addColumn(view)));
    }
    if (!readOnly && this.isLast) {
      row.appendChild(this.createTableAction('cm-lp-table-line-add-row', 'Add row', () => this.addRow(view)));
    }

    const focusSource = (event: MouseEvent) => {
      if (view.state.facet(EditorState.readOnly)) return;
      const wikiTarget = event.target instanceof Element
        ? event.target.closest<HTMLElement>('.cm-lp-wiki-link')
        : null;
      if (wikiTarget) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-cell-index]')
        : null;
      const cellIndex = target?.dataset.cellIndex ? Number(target.dataset.cellIndex) : 0;
      const span = this.cellSpans[Number.isFinite(cellIndex) ? cellIndex : 0] || this.cellSpans[0];
      const anchor = Math.max(this.lineFrom, Math.min(this.lineTo, this.lineFrom + (span?.from || 0)));
      view.dispatch({ selection: { anchor } });
      view.focus();
      requestAnimationFrame(() => view.requestMeasure());
    };

    row.addEventListener('mousedown', event => {
      if (event.altKey) focusSource(event);
    });
    row.addEventListener('click', event => {
      if (openWikiFromEvent(event)) return;
      if (event.target instanceof Element && event.target.closest('.cm-lp-table-cell-editable')) {
        event.stopPropagation();
        return;
      }
      const tableCell = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-cell-index]')
        : null;
      if (!readOnly && tableCell) {
        event.preventDefault();
        event.stopPropagation();
        const cellIndex = Number(tableCell.dataset.cellIndex || 0);
        this.activateEditableCell(tableCell, this.cells[cellIndex] || '', view, cellIndex);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    });
    return row;
  }

  private createTableAction(className: string, label: string, action: () => void) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `cm-lp-table-line-action ${className}`;
    button.textContent = '+';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.contentEditable = 'false';
    const stop = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    button.addEventListener('mousedown', stop);
    button.addEventListener('click', event => {
      stop(event);
      action();
    });
    return button;
  }

  private findTableBlock(view: EditorView) {
    const doc = view.state.doc;
    const currentLine = doc.lineAt(Math.min(this.lineFrom, doc.length));
    let fromLine = currentLine.number;
    let toLine = currentLine.number;
    while (fromLine > 1 && splitTableRow(doc.line(fromLine - 1).text)) fromLine -= 1;
    while (toLine < doc.lines && splitTableRow(doc.line(toLine + 1).text)) toLine += 1;
    const lines = Array.from({ length: toLine - fromLine + 1 }, (_, index) => doc.line(fromLine + index));
    return { doc, lines, from: lines[0].from, to: lines[lines.length - 1].to };
  }

  private addColumn(view: EditorView) {
    const block = this.findTableBlock(view);
    const colCount = Math.max(...block.lines.map(line => splitTableRow(line.text)?.length || 0), this.colCount);
    const nextColCount = colCount + 1;
    const nextLines = block.lines.map(line => {
      const cells = normalizeTableCells(splitTableRow(line.text) || [], colCount);
      cells.push(isTableSeparatorRow(line.text) ? '---' : '');
      return formatMarkdownTableRow(cells, nextColCount);
    });
    view.dispatch({ changes: { from: block.from, to: block.to, insert: nextLines.join('\n') } });
    requestAnimationFrame(() => view.requestMeasure());
  }

  private addRow(view: EditorView) {
    const block = this.findTableBlock(view);
    const colCount = Math.max(...block.lines.map(line => splitTableRow(line.text)?.length || 0), this.colCount);
    view.dispatch({
      changes: {
        from: block.to,
        insert: `\n${formatMarkdownTableRow([], colCount)}`,
      },
    });
    requestAnimationFrame(() => view.requestMeasure());
  }

  private activateEditableCell(cell: HTMLElement, sourceText: string, view: EditorView, cellIndex: number) {
    if (cell.isContentEditable) {
      cell.focus();
      return;
    }

    cell.classList.remove('cm-lp-table-cell-ready');
    cell.classList.add('cm-lp-table-cell-editable');
    cell.textContent = sourceText;
    cell.contentEditable = 'plaintext-only';
    cell.spellcheck = false;

    let lastCommitted = sourceText;
    const listeners = new AbortController();
    const renderInactive = () => {
      listeners.abort();
      cell.contentEditable = 'false';
      cell.classList.remove('cm-lp-table-cell-editable');
      cell.classList.add('cm-lp-table-cell-ready');
      cell.innerHTML = renderCellMarkdown(lastCommitted);
    };
    const commit = () => {
      const nextValue = normalizeEditableTableCellInput(cell.textContent || '');
      if (nextValue === lastCommitted) {
        renderInactive();
        return;
      }
      lastCommitted = nextValue;
      const span = this.cellSpans[cellIndex] || this.cellSpans[0];
      if (!span) {
        renderInactive();
        return;
      }
      const from = Math.max(this.lineFrom, Math.min(this.lineTo, this.lineFrom + span.from));
      const to = Math.max(from, Math.min(this.lineTo, this.lineFrom + span.to));
      view.dispatch({ changes: { from, to, insert: escapeTableCell(nextValue) } });
      requestAnimationFrame(() => view.requestMeasure());
    };

    const stopClipboardPropagation = (event: Event) => event.stopPropagation();
    const listenerOptions = { signal: listeners.signal };
    cell.addEventListener('paste', stopClipboardPropagation, listenerOptions);
    cell.addEventListener('copy', stopClipboardPropagation, listenerOptions);
    cell.addEventListener('cut', stopClipboardPropagation, listenerOptions);
    cell.addEventListener('blur', commit, listenerOptions);
    cell.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        cell.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        renderInactive();
        view.focus();
      }
    }, listenerOptions);

    cell.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(cell);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    requestAnimationFrame(() => view.requestMeasure());
  }

  ignoreEvent() { return true; }

  eq(other: TableLineWidget) {
    return sameStringArray(other.cells, this.cells)
      && sameTableCellSpans(other.cellSpans, this.cellSpans)
      && other.colCount === this.colCount
      && sameStringArray(other.alignments, this.alignments)
      && other.kind === this.kind
      && other.lineFrom === this.lineFrom
      && other.lineTo === this.lineTo
      && other.columnTemplate === this.columnTemplate
      && other.isFirst === this.isFirst
      && other.isLast === this.isLast;
  }
}

class TableWidget extends WidgetType {
  constructor(
    readonly headerCells: string[],
    readonly bodyRows: string[][],
    readonly colCount: number,
    readonly alignments: TableAlignment[] = [],
    readonly hasHeader: boolean = true,
    readonly sourceFrom: number = 0,
    readonly sourceTo: number = 0,
    readonly sourceLines: TableSourceLine[] = [],
  ) { super(); }

  get estimatedHeight() {
    const rowCount = Math.max(1, this.bodyRows.length + (this.hasHeader ? 1 : 0));
    /* Table actions are absolutely positioned and add no layout height. The
       previous extra 34px made CM6 map every click after a rendered table to
       roughly one line below the pointer. Wrapped cells are remeasured by the
       ResizeObserver after mount. */
    return rowCount * 29;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-lp-table-wrap';
    wrap.dataset.columns = String(this.colCount);
    wrap.contentEditable = 'false';
    wrap.title = view.state.facet(EditorState.readOnly)
      ? 'Rendered table'
      : 'Click a cell to edit. Alt+click the table to edit markdown source.';

    const table = document.createElement('table');
    table.className = 'cm-lp-table';
    table.contentEditable = 'false';
    if (!this.hasHeader) table.classList.add('cm-lp-table-no-header');
    if (!this.hasHeader && this.colCount === 2) table.classList.add('cm-lp-table-metadata');
    const dataLineIndices = this.sourceLines
      .map((line, index) => line.isSep ? -1 : index)
      .filter(index => index >= 0);
    const headerSourceLineIndex = this.hasHeader ? (dataLineIndices[0] ?? -1) : -1;
    const bodySourceLineIndices = this.hasHeader ? dataLineIndices.slice(1) : dataLineIndices;

    if (!this.hasHeader && this.colCount === 2) {
      const colgroup = document.createElement('colgroup');
      for (let ci = 0; ci < this.colCount; ci++) {
        const col = document.createElement('col');
        col.style.width = `${ci === 0 ? 30 : 70}%`;
        colgroup.appendChild(col);
      }
      table.appendChild(colgroup);
    }

    if (this.hasHeader) {
      const thead = document.createElement('thead');
      const htr = document.createElement('tr');
      for (let ci = 0; ci < this.colCount; ci++) {
        const th = document.createElement('th');
        const sourceText = this.headerCells[ci] || '';
        th.style.textAlign = this.alignments[ci] || 'left';
        this.renderTableCell(th, sourceText, view, headerSourceLineIndex, ci);
        htr.appendChild(th);
      }
      thead.appendChild(htr);
      table.appendChild(thead);
    }

    /* Body */
    const tbody = document.createElement('tbody');
    for (let ri = 0; ri < this.bodyRows.length; ri++) {
      const row = this.bodyRows[ri];
      const tr = document.createElement('tr');
      for (let ci = 0; ci < this.colCount; ci++) {
        const td = document.createElement('td');
        const sourceText = row[ci] || '';
        td.style.textAlign = this.alignments[ci] || 'left';
        this.renderTableCell(td, sourceText, view, bodySourceLineIndices[ri] ?? -1, ci);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    wrap.appendChild(table);
    if (!view.state.facet(EditorState.readOnly)) {
      const openSourceFromTable = (event: MouseEvent) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('.cm-lp-table-action') || target?.closest('.cm-lp-wiki-link')) return;
        if (!event.altKey) return;
        event.preventDefault();
        event.stopPropagation();
        this.editSource(view);
      };
      wrap.addEventListener('mousedown', openSourceFromTable);
      wrap.addEventListener('click', (event) => {
        if (openWikiFromEvent(event)) return;
      });

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'cm-lp-table-action cm-lp-table-edit';
      editButton.title = 'Edit table source';
      editButton.textContent = 'Edit';
      editButton.contentEditable = 'false';

      const formatButton = document.createElement('button');
      formatButton.type = 'button';
      formatButton.className = 'cm-lp-table-action cm-lp-table-format';
      formatButton.title = 'Format markdown table';
      formatButton.textContent = 'Format';
      formatButton.contentEditable = 'false';

      const addColumnButton = document.createElement('button');
      addColumnButton.type = 'button';
      addColumnButton.className = 'cm-lp-table-action cm-lp-table-add-col';
      addColumnButton.title = 'Add column';
      addColumnButton.textContent = '+ Col';
      addColumnButton.contentEditable = 'false';

      const addRowButton = document.createElement('button');
      addRowButton.type = 'button';
      addRowButton.className = 'cm-lp-table-action cm-lp-table-add-row';
      addRowButton.title = 'Add row';
      addRowButton.textContent = '+ Row';
      addRowButton.contentEditable = 'false';

      const stop = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      editButton.addEventListener('mousedown', stop);
      editButton.addEventListener('click', (event) => {
        stop(event);
        this.editSource(view);
      });
      formatButton.addEventListener('mousedown', stop);
      formatButton.addEventListener('click', (event) => {
        stop(event);
        this.formatSource(view);
      });
      addColumnButton.addEventListener('mousedown', stop);
      addColumnButton.addEventListener('click', (event) => {
        stop(event);
        this.addColumn(view);
      });
      addRowButton.addEventListener('mousedown', stop);
      addRowButton.addEventListener('click', (event) => {
        stop(event);
        this.addRow(view);
      });

      wrap.appendChild(editButton);
      wrap.appendChild(formatButton);
      wrap.appendChild(addColumnButton);
      wrap.appendChild(addRowButton);
    }

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => view.requestMeasure());
      observer.observe(wrap);
      (wrap as HTMLElement & { __arsTableResizeObserver?: ResizeObserver }).__arsTableResizeObserver = observer;
    }

    requestAnimationFrame(() => view.requestMeasure());
    return wrap;
  }

  private renderTableCell(
    cell: HTMLTableCellElement,
    sourceText: string,
    view: EditorView,
    sourceLineIndex: number,
    cellIndex: number,
  ) {
    if (view.state.facet(EditorState.readOnly) || sourceLineIndex < 0) {
      cell.innerHTML = renderCellMarkdown(sourceText);
      return;
    }

    cell.textContent = sourceText;
    cell.contentEditable = 'plaintext-only';
    cell.spellcheck = false;
    cell.classList.add('cm-lp-table-cell-editable');
    cell.dataset.sourceLineIndex = String(sourceLineIndex);
    cell.dataset.cellIndex = String(cellIndex);

    let lastCommitted = sourceText;
    const commit = () => {
      const nextValue = (cell.textContent || '').replace(/\u00a0/g, ' ').replace(/\r?\n+/g, ' ').trim();
      if (nextValue === lastCommitted) return;
      lastCommitted = nextValue;
      this.updateCell(view, sourceLineIndex, cellIndex, nextValue);
    };

    const stopEditorEvent = (event: Event) => {
      event.stopPropagation();
    };
    cell.addEventListener('mousedown', stopEditorEvent);
    cell.addEventListener('mouseup', stopEditorEvent);
    cell.addEventListener('click', stopEditorEvent);
    cell.addEventListener('dblclick', stopEditorEvent);
    cell.addEventListener('beforeinput', stopEditorEvent);
    cell.addEventListener('input', event => {
      event.stopPropagation();
      requestAnimationFrame(() => view.requestMeasure());
    });
    cell.addEventListener('compositionstart', stopEditorEvent);
    cell.addEventListener('compositionupdate', stopEditorEvent);
    cell.addEventListener('compositionend', event => {
      event.stopPropagation();
      requestAnimationFrame(() => view.requestMeasure());
    });
    cell.addEventListener('paste', stopEditorEvent);
    cell.addEventListener('copy', stopEditorEvent);
    cell.addEventListener('cut', stopEditorEvent);

    cell.addEventListener('focus', () => {
      cell.classList.add('cm-lp-table-cell-editing');
      requestAnimationFrame(() => view.requestMeasure());
    });
    cell.addEventListener('blur', () => {
      cell.classList.remove('cm-lp-table-cell-editing');
      commit();
    });
    cell.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
        cell.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cell.textContent = lastCommitted;
        cell.blur();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        commit();
        this.focusAdjacentCell(view, sourceLineIndex, cellIndex, event.shiftKey);
      }
    });
  }

  private focusAdjacentCell(view: EditorView, sourceLineIndex: number, cellIndex: number, backwards: boolean) {
    const dataLineIndices = this.sourceLines
      .map((line, index) => line.isSep ? -1 : index)
      .filter(index => index >= 0);
    const rowIndex = dataLineIndices.indexOf(sourceLineIndex);
    if (rowIndex < 0) return;

    let nextRowIndex = rowIndex;
    let nextCellIndex = backwards ? cellIndex - 1 : cellIndex + 1;
    if (nextCellIndex < 0) {
      nextRowIndex -= 1;
      nextCellIndex = this.colCount - 1;
    } else if (nextCellIndex >= this.colCount) {
      nextRowIndex += 1;
      nextCellIndex = 0;
    }
    const nextSourceLineIndex = dataLineIndices[nextRowIndex];
    if (nextSourceLineIndex === undefined) return;

    requestAnimationFrame(() => {
      const selector = `[data-source-line-index="${nextSourceLineIndex}"][data-cell-index="${nextCellIndex}"]`;
      const nextCell = view.dom.querySelector<HTMLElement>(selector);
      nextCell?.focus();
      if (!nextCell) return;
      const range = document.createRange();
      range.selectNodeContents(nextCell);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  }

  private replaceSource(view: EditorView, lines: string[], focusEditor: boolean = true) {
    if (view.state.facet(EditorState.readOnly) || !this.sourceLines.length) return;
    const insert = lines.join('\n');
    const newSourceTo = this.sourceFrom + insert.length;
    const docLengthAfterChange = view.state.doc.length - (this.sourceTo - this.sourceFrom) + insert.length;
    const anchor = this.sourceFrom > 0
      ? this.sourceFrom - 1
      : Math.min(docLengthAfterChange, newSourceTo + 1);
    view.dispatch({
      changes: { from: this.sourceFrom, to: this.sourceTo, insert },
      selection: { anchor },
    });
    if (focusEditor) view.focus();
    requestAnimationFrame(() => view.requestMeasure());
  }

  private updateCell(view: EditorView, sourceLineIndex: number, cellIndex: number, value: string) {
    if (view.state.facet(EditorState.readOnly) || !this.sourceLines.length) return;
    const sourceLine = this.sourceLines[sourceLineIndex];
    if (!sourceLine || sourceLine.isSep) return;

    const lines = this.sourceLines.map(line => line.text);
    const cells = normalizeTableCells(sourceLine.cells, this.colCount);
    cells[cellIndex] = value;
    lines[sourceLineIndex] = formatMarkdownTableRow(cells, this.colCount);
    this.replaceSource(view, lines, false);
  }

  private editSource(view: EditorView) {
    if (view.state.facet(EditorState.readOnly)) return;
    const anchor = Math.min(this.sourceFrom + 1, this.sourceTo);
    view.dispatch({ selection: { anchor } });
    view.focus();
    view.requestMeasure();
    requestAnimationFrame(() => view.requestMeasure());
  }

  private addColumn(view: EditorView) {
    const nextColCount = this.colCount + 1;
    const lines = this.sourceLines.map(line => {
      const cells = normalizeTableCells(line.cells, this.colCount);
      cells.push(line.isSep ? '---' : '');
      return formatMarkdownTableRow(cells, nextColCount);
    });
    this.replaceSource(view, lines);
  }

  private addRow(view: EditorView) {
    const lines = this.sourceLines.map(line => line.text);
    lines.push(formatMarkdownTableRow([], this.colCount));
    this.replaceSource(view, lines);
  }

  private formatSource(view: EditorView) {
    const lines = this.sourceLines.map(line => {
      const cells = normalizeTableCells(line.cells, this.colCount);
      return formatMarkdownTableRow(cells, this.colCount);
    });
    this.replaceSource(view, lines);
  }

  ignoreEvent(event: Event) {
    return true;
  }

  destroy(dom: HTMLElement) {
    (dom as HTMLElement & { __arsTableResizeObserver?: ResizeObserver }).__arsTableResizeObserver?.disconnect();
  }

  eq(other: TableWidget) {
    return sameStringArray(other.headerCells, this.headerCells)
      && sameTableRows(other.bodyRows, this.bodyRows)
      && sameStringArray(other.alignments, this.alignments)
      && other.hasHeader === this.hasHeader
      && other.sourceFrom === this.sourceFrom
      && other.sourceTo === this.sourceTo
      && sameTableSourceLines(other.sourceLines, this.sourceLines);
  }
}

/* ═══════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════ */

function cursorNearRange(state: EditorState, from: number, to: number, margin: number = 1): boolean {
  const sel = state.selection.main;
  return sel.from <= to + margin && sel.to >= from - margin;
}

function cursorOnThisLine(state: EditorState, from: number, to: number): boolean {
  const line = state.doc.lineAt(from);
  const sel = state.selection.main;
  return sel.from >= line.from && sel.to <= line.to;
}

type LivePreviewRange = { from: number; to: number };

const LARGE_DOCUMENT_LINE_THRESHOLD = 900;
const INITIAL_PREVIEW_LINES_BEFORE = 48;
const INITIAL_PREVIEW_LINES_AFTER = 240;
const VIEWPORT_PREVIEW_LINE_MARGIN = 120;

function lineRangeToDocumentRange(state: EditorState, fromLine: number, toLine: number): LivePreviewRange {
  const safeFromLine = Math.max(1, Math.min(state.doc.lines, fromLine));
  const safeToLine = Math.max(safeFromLine, Math.min(state.doc.lines, toLine));
  return {
    from: state.doc.line(safeFromLine).from,
    to: state.doc.line(safeToLine).to,
  };
}

function expandRangeToTableBoundaries(state: EditorState, range: LivePreviewRange): LivePreviewRange {
  let fromLine = state.doc.lineAt(Math.max(0, Math.min(state.doc.length, range.from))).number;
  let toLine = state.doc.lineAt(Math.max(0, Math.min(state.doc.length, Math.max(range.from, range.to - 1)))).number;

  if (splitTableRow(state.doc.line(fromLine).text)) {
    while (fromLine > 1 && splitTableRow(state.doc.line(fromLine - 1).text)) fromLine -= 1;
  }
  if (splitTableRow(state.doc.line(toLine).text)) {
    while (toLine < state.doc.lines && splitTableRow(state.doc.line(toLine + 1).text)) toLine += 1;
  }

  return lineRangeToDocumentRange(state, fromLine, toLine);
}

function mergeLivePreviewRanges(state: EditorState, ranges: LivePreviewRange[]): LivePreviewRange[] {
  if (state.doc.length === 0) return [{ from: 0, to: 0 }];
  const normalized = ranges
    .map(range => expandRangeToTableBoundaries(state, range))
    .sort((a, b) => a.from - b.from);
  const merged: LivePreviewRange[] = [];

  for (const range of normalized) {
    const previous = merged[merged.length - 1];
    if (!previous || range.from > previous.to + 1) {
      merged.push({ ...range });
      continue;
    }
    previous.to = Math.max(previous.to, range.to);
  }
  return merged;
}

function getInitialLivePreviewRanges(state: EditorState): LivePreviewRange[] {
  if (state.doc.lines <= LARGE_DOCUMENT_LINE_THRESHOLD) {
    return [{ from: 0, to: state.doc.length }];
  }
  const selectionLine = state.doc.lineAt(state.selection.main.head).number;
  return mergeLivePreviewRanges(state, [lineRangeToDocumentRange(
    state,
    selectionLine - INITIAL_PREVIEW_LINES_BEFORE,
    selectionLine + INITIAL_PREVIEW_LINES_AFTER,
  )]);
}

function isRangeCovered(ranges: LivePreviewRange[], target: LivePreviewRange): boolean {
  return ranges.some(range => range.from <= target.from && range.to >= target.to);
}

/* ═══════════════════════════════════════════════════════
   Build Decorations from the syntax tree
   ═══════════════════════════════════════════════════════ */

function buildDecorations(state: EditorState, requestedRanges = getInitialLivePreviewRanges(state)): DecorationSet {
  const buildStartedAt = typeof performance !== 'undefined' ? performance.now() : 0;
  const decs: Range<Decoration>[] = [];
  const tree = syntaxTree(state);
  const doc = state.doc;
  const renderAll = state.facet(EditorState.readOnly);
  const scanRanges = mergeLivePreviewRanges(state, requestedRanges);
  const scanLineRanges = scanRanges.map(range => ({
    fromLine: doc.lineAt(range.from).number,
    toLine: doc.lineAt(Math.max(range.from, range.to - 1)).number,
  }));
  const parents: { name: string; from: number; to: number }[] = [];
  const renderedTableLines = new Set<number>();

  if (!renderAll) {
    for (const scanLineRange of scanLineRanges) {
      let lineNumber = scanLineRange.fromLine;
      while (lineNumber <= scanLineRange.toLine) {
      const firstLine = doc.line(lineNumber);
      if (!splitTableRow(firstLine.text)) {
        lineNumber += 1;
        continue;
      }

      const blockLineNumbers: number[] = [];
      let hasSeparator = false;
      while (lineNumber <= scanLineRange.toLine) {
        const line = doc.line(lineNumber);
        if (!splitTableRow(line.text)) break;
        blockLineNumbers.push(lineNumber);
        hasSeparator ||= isTableSeparatorRow(line.text);
        lineNumber += 1;
      }

      if (blockLineNumbers.length < 2 || !hasSeparator) continue;
      const sourceFrom = doc.line(blockLineNumbers[0]).from;
      const sourceTo = doc.line(blockLineNumbers[blockLineNumbers.length - 1]).to;
      if (!cursorNearRange(state, sourceFrom, sourceTo, 0)) {
        blockLineNumbers.forEach(value => renderedTableLines.add(value));
      }
      }
    }
  }

  const addEditableTableRows = (
    blockLines: Array<{ ln: number; text: string; isSep: boolean }>,
    colCount: number,
    alignments: TableAlignment[],
    hasHeader: boolean,
  ) => {
    const visibleRows = blockLines
      .filter(line => !line.isSep)
      .map(line => normalizeTableCells(splitTableRow(line.text) || [], colCount));
    const columnTemplate = getTableColumnTemplate(visibleRows, colCount, hasHeader);
    let visibleRowIndex = 0;

    blockLines.forEach((blockLine, blockIndex) => {
      const line = doc.line(blockLine.ln);
      const cells = normalizeTableCells(splitTableRow(blockLine.text) || [], colCount);
      let kind: TableRowKind = 'separator';
      if (!blockLine.isSep) {
        kind = hasHeader && visibleRowIndex === 0
          ? 'header'
          : (!hasHeader && colCount === 2 ? 'metadata' : 'body');
        visibleRowIndex += 1;
      }

      decs.push(Decoration.line({
        class: blockLine.isSep
          ? 'cm-lp-table-render-line cm-lp-table-render-separator-line'
          : 'cm-lp-table-render-line',
      }).range(line.from));
      decs.push(Decoration.replace({
        widget: new TableLineWidget(
          cells,
          getTableCellSpans(blockLine.text, colCount),
          colCount,
          alignments,
          kind,
          line.from,
          line.to,
          columnTemplate,
          blockIndex === 0,
          blockIndex === blockLines.length - 1,
        ),
      }).range(line.from, line.to));
    });
  };

  for (const scanRange of scanRanges) {
    parents.length = 0;
    tree.iterate({
    from: scanRange.from,
    to: scanRange.to,
    enter(node) {
      const parent = parents.length > 0 ? parents[parents.length - 1] : null;
      const { from, to, name } = node;
      if (renderedTableLines.has(doc.lineAt(from).number)) return false;

      switch (name) {

        /* ── Headings: hide # marks, style with inline attrs ── */
        case 'HeaderMark': {
          if (renderAll || !cursorOnThisLine(state, from, to)) {
            const nextChar = to < doc.length ? doc.sliceString(to, to + 1) : '';
            const hideTo = nextChar === ' ' ? to + 1 : to;
            decs.push(Decoration.replace({}).range(from, hideTo));
          }
          break;
        }
        case 'ATXHeading1': case 'ATXHeading2': case 'ATXHeading3':
        case 'ATXHeading4': case 'ATXHeading5': case 'ATXHeading6': {
          const level = parseInt(name.replace('ATXHeading', ''));
          const sizes = ['', '2em', '1.6em', '1.3em', '1.1em', '1em', '0.95em'];
          const weights = ['', '700', '700', '600', '600', '600', '600'];
          const lineStart = doc.lineAt(from).from;
          /* Line decoration for spacing */
          decs.push(Decoration.line({
            class: `cm-lp-heading cm-lp-h${level}`,
            attributes: {
              style: `font-size: ${sizes[level]}; font-weight: ${weights[level]}; line-height: 1.45`
            }
          }).range(lineStart));
          break;
        }

        /* ── Emphasis marks: hide * ** when cursor is outside ── */
        case 'EmphasisMark': {
          if (parent && (renderAll || !cursorNearRange(state, parent.from, parent.to))) {
            decs.push(Decoration.replace({}).range(from, to));
          }
          break;
        }

        /* ── Strong Emphasis: bold style with inline attrs ── */
        case 'StrongEmphasis': {
          if (renderAll || !cursorNearRange(state, from, to)) {
            decs.push(Decoration.mark({
              class: 'cm-lp-bold',
              attributes: { style: 'font-weight: 700 !important; color: inherit' }
            }).range(from, to));
          }
          break;
        }

        /* ── Emphasis: italic style with inline attrs ── */
        case 'Emphasis': {
          if (parent?.name === 'StrongEmphasis') break;
          if (renderAll || !cursorNearRange(state, from, to)) {
            decs.push(Decoration.mark({
              class: 'cm-lp-italic',
              attributes: { style: 'font-style: italic !important; color: inherit' }
            }).range(from, to));
          }
          break;
        }

        /* ── Strikethrough ── */
        case 'Strikethrough': {
          if (renderAll || !cursorNearRange(state, from, to)) {
            const innerFrom = from + 2;
            const innerTo = to - 2;
            if (innerFrom < innerTo) {
              decs.push(Decoration.replace({}).range(from, innerFrom));
              decs.push(Decoration.replace({}).range(innerTo, to));
              decs.push(Decoration.mark({
                class: 'cm-lp-strike',
                attributes: { style: 'text-decoration: line-through; opacity: 0.6' }
              }).range(innerFrom, innerTo));
            }
          }
          break;
        }

        /* ── Inline Code ── */
        case 'InlineCode': {
          if (renderAll || !cursorNearRange(state, from, to)) {
            const text = doc.sliceString(from, to);
            const m = text.match(/^(`+)([\s\S]*?)(\1)$/);
            if (m) {
              const markLen = m[1].length;
              decs.push(Decoration.replace({}).range(from, from + markLen));
              decs.push(Decoration.replace({}).range(to - markLen, to));
              if (from + markLen < to - markLen) {
                decs.push(Decoration.mark({
                  class: 'cm-lp-inline-code',
                  attributes: { style: 'background: rgba(124,92,255,0.15); color: #c4b5fd; padding: 1px 5px; border-radius: 4px; font-family: "Fira Code","JetBrains Mono","Consolas",monospace; font-size: 0.88em' }
                }).range(from + markLen, to - markLen));
              }
            }
          }
          break;
        }

        /* ── Links: hide brackets, style link text ── */
        case 'Link': {
          if (renderAll || !cursorNearRange(state, from, to)) {
            const text = doc.sliceString(from, to);
            const linkMatch = text.match(/^\[([\s\S]*?)\]\(([\s\S]*?)\)$/);
            if (linkMatch) {
              const linkText = linkMatch[1];
              const url = linkMatch[2];
              const textStart = from + 1;
              const textEnd = textStart + linkText.length;
              decs.push(Decoration.replace({}).range(from, textStart));
              decs.push(Decoration.replace({}).range(textEnd, to));
              if (textStart < textEnd) {
                decs.push(Decoration.mark({
                  class: 'cm-lp-link',
                  attributes: { style: 'color: #7c5cff; text-decoration: underline; cursor: pointer', title: url }
                }).range(textStart, textEnd));
              }
            }
          }
          break;
        }

        /* ── Images: keep edit mode coordinate-stable. Full image rendering belongs
           to the read-only/HTML preview, not editable CodeMirror. ── */
        case 'Image': {
          if (renderAll && !cursorOnThisLine(state, from, to)) {
            const text = doc.sliceString(from, to);
            const imgMatch = text.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
            if (imgMatch) {
              decs.push(Decoration.replace({
                widget: new ImageWidget(imgMatch[2], imgMatch[1])
              }).range(from, to));
            }
          }
          break;
        }

        /* ── Blockquote: widgets can desync editable hit testing, so edit mode
           only styles the quote marker. ── */
        case 'QuoteMark': {
          const line = doc.lineAt(from);
          const calloutMatch = line.text.match(/^>\s*\[!([a-z0-9_-]+)\]\s*/i);
          const hideEnd = to < doc.length && doc.sliceString(to, to + 1) === ' '
            ? to + 1 : to;
          if (renderAll && !cursorOnThisLine(state, from, to)) {
            decs.push(Decoration.replace({
              widget: new QuoteBarWidget()
            }).range(from, hideEnd));
          } else if (!renderAll) {
            const cursorOnLine = cursorOnThisLine(state, from, to);
            if (!cursorOnLine) {
              const syntaxEnd = calloutMatch
                ? Math.min(line.to, line.from + calloutMatch[0].length)
                : hideEnd;
              decs.push(Decoration.replace({}).range(from, syntaxEnd));
            } else {
              decs.push(Decoration.mark({
                class: 'cm-lp-quote-mark',
                attributes: { style: 'color: #61afef; font-weight: 700' }
              }).range(from, hideEnd));
            }
            decs.push(Decoration.line({
              class: calloutMatch ? 'cm-lp-quote-line cm-lp-callout-title' : 'cm-lp-quote-line',
            }).range(line.from));
          }
          break;
        }

        /* ── Task Marker: no checkbox widget while editing, because even small
           replaced controls can make mouse coordinates drift after scrolling. ── */
        case 'TaskMarker': {
          if (renderAll && !cursorNearRange(state, from, to)) {
            const text = doc.sliceString(from, to);
            const checked = text.includes('x') || text.includes('X');
            const afterChar = to < doc.length ? doc.sliceString(to, to + 1) : '';
            const hideEnd = afterChar === ' ' ? to + 1 : to;
            decs.push(Decoration.replace({
              widget: new CheckboxWidget(checked)
            }).range(from, hideEnd));
          } else if (!renderAll) {
            decs.push(Decoration.mark({
              class: 'cm-lp-task-marker',
              attributes: { style: 'color: #7c5cff; font-weight: 600' }
            }).range(from, to));
          }
          break;
        }

        /* ── Horizontal Rule ── */
        case 'HorizontalRule': {
          if (renderAll && !cursorOnThisLine(state, from, to)) {
            decs.push(Decoration.replace({
              widget: new HrWidget()
            }).range(from, to));
          } else if (!renderAll) {
            decs.push(Decoration.mark({
              class: 'cm-lp-hr-text',
              attributes: { style: 'color: #6b7280; letter-spacing: 0.08em' }
            }).range(from, to));
          }
          break;
        }

        /* ── Fenced Code: keep editable hit testing stable. ── */
        case 'FencedCode': {
          const firstLine = doc.lineAt(from);
          const lastLine = doc.lineAt(Math.max(from, to - 1));
          const sourceFrom = firstLine.from;
          const sourceTo = lastLine.to;

          if (renderAll || !cursorNearRange(state, sourceFrom, sourceTo, 0)) {
            const contentFrom = firstLine.to < sourceTo ? firstLine.to + 1 : firstLine.to;
            const contentTo = Math.max(contentFrom, lastLine.from);
            const codeText = doc.sliceString(contentFrom, contentTo).replace(/\r?\n$/, '');
            const language = firstLine.text.replace(/^```\s*/, '').trim();
            decs.push(Decoration.replace({
              widget: new CodeBlockWidget(codeText, language, sourceFrom, contentFrom),
              block: true,
            }).range(sourceFrom, sourceTo));
            return false;
          }

          for (let lineNo = firstLine.number; lineNo <= lastLine.number; lineNo++) {
            const line = doc.line(lineNo);
            const classes = ['cm-lp-codeblock'];
            const isFenceLine = lineNo === firstLine.number || lineNo === lastLine.number;
            if (lineNo === firstLine.number) classes.push('cm-lp-codeblock-first');
            if (lineNo === lastLine.number) classes.push('cm-lp-codeblock-last');
            if (isFenceLine && !cursorOnThisLine(state, line.from, line.to)) classes.push('cm-lp-codeblock-fence');
            if (lineNo > firstLine.number && lineNo < lastLine.number) classes.push('cm-lp-codeblock-content');
            if (firstLine.number === lastLine.number) classes.push('cm-lp-codeblock-single');
            decs.push(Decoration.line({ class: classes.join(' ') }).range(line.from));
          }
          break;
        }

        /* ── Code info line (```js) ── */
        case 'CodeInfo': {
          if (renderAll || !cursorOnThisLine(state, from, to)) {
            decs.push(Decoration.mark({
              class: 'cm-lp-code-lang',
              attributes: { style: 'color: #7c5cff; font-size: 0.85em; font-weight: 500' }
            }).range(from, to));
          }
          break;
        }

        /* ── CodeMark (backticks for fences) ── */
        case 'CodeMark': {
          if (parent?.name === 'FencedCode' && (renderAll || !cursorOnThisLine(state, from, to))) {
            decs.push(Decoration.replace({}).range(from, to));
          }
          break;
        }

        /* ── List marks: subtle styling ── */
        case 'ListMark': {
          if (renderAll || !cursorOnThisLine(state, from, to)) {
            decs.push(Decoration.mark({
              class: 'cm-lp-list-mark',
              attributes: { style: 'color: #7c5cff; font-weight: 600' }
            }).range(from, to));
          }
          break;
        }

      }

      parents.push({ name, from, to });
    },
    leave() {
      parents.pop();
    }
    });
  }

  /* ── Wiki-links: detect via regex ── */
  for (const scanRange of scanRanges) {
    const rangeText = doc.sliceString(scanRange.from, scanRange.to);
    const wikiRegex = /\[\[([^\]]+)\]\]/g;
    let wikiMatch;
    while ((wikiMatch = wikiRegex.exec(rangeText)) !== null) {
    const start = scanRange.from + wikiMatch.index;
    const end = start + wikiMatch[0].length;
    if (renderedTableLines.has(doc.lineAt(start).number)) continue;
    if (renderAll || !cursorNearRange(state, start, end)) {
      decs.push(Decoration.replace({}).range(start, start + 2));
      decs.push(Decoration.replace({}).range(end - 2, end));
      if (start + 2 < end - 2) {
        decs.push(Decoration.mark({
          class: 'cm-lp-wiki-link',
          attributes: { style: 'color: #2f8cff; background: rgba(47,140,255,0.1); padding: 1px 4px; border-radius: 4px; cursor: pointer' }
        }).range(start + 2, end - 2));
      }
    }
    }
  }

  /* ── Tables ── */
  /* Dynamic block widgets can desync CM6 hit testing while editing, especially
     when table rows wrap. Edit mode keeps source lines stable; read-only
     preview can still render the full table widget. */

  /* Safe inline color spans inserted by the editing toolbar. */
  for (const scanRange of scanRanges) {
    const rangeText = doc.sliceString(scanRange.from, scanRange.to);
    const colorSpanRegex = /<span\s+style=(["'])([\s\S]*?)\1\s*>([\s\S]*?)<\/span>/gi;
    let colorSpanMatch;
    while ((colorSpanMatch = colorSpanRegex.exec(rangeText)) !== null) {
    const fullMatch = colorSpanMatch[0];
    const safeStyle = sanitizeSpanStyle(colorSpanMatch[2]);
    if (!safeStyle) continue;

    const start = scanRange.from + colorSpanMatch.index;
    const end = start + fullMatch.length;
    if (renderedTableLines.has(doc.lineAt(start).number)) continue;
    if (!renderAll && cursorNearRange(state, start, end)) continue;

    const openTag = fullMatch.match(/^<span\s+style=(["'])([\s\S]*?)\1\s*>/i)?.[0];
    const closeTag = '</span>';
    if (!openTag || !fullMatch.toLowerCase().endsWith(closeTag)) continue;

    const innerFrom = start + openTag.length;
    const innerTo = end - closeTag.length;
    if (innerFrom >= innerTo) continue;

    decs.push(Decoration.replace({}).range(start, innerFrom));
    decs.push(Decoration.replace({}).range(innerTo, end));
    decs.push(Decoration.mark({
      class: 'cm-lp-color-span',
      attributes: { style: safeStyle }
    }).range(innerFrom, innerTo));
    }
  }

  for (const scanLineRange of scanLineRanges) {
  let ti = scanLineRange.fromLine;
  while (ti <= scanLineRange.toLine) {
    const tLine = doc.line(ti);
    const tText = tLine.text;
    const repairedCompressedTable = repairCompressedMarkdownTable(tText);
    if (repairedCompressedTable) {
      const blockLines = repairedCompressedTable.split('\n').map(text => ({
        ln: ti,
        text,
        isSep: isTableSeparatorRow(text),
      }));
      const firstSeparatorIndex = blockLines.findIndex(line => line.isSep);
      const dataRows: { ln: number; cells: string[] }[] = [];
      for (const blockLine of blockLines) {
        if (blockLine.isSep) continue;
        const cells = splitTableRow(blockLine.text);
        if (cells) dataRows.push({ ln: blockLine.ln, cells });
      }

      if (blockLines.length >= 2 && firstSeparatorIndex > 0 && dataRows.length > 0) {
        const hasHeader = true;
        const colCount = Math.max(...dataRows.map(r => r.cells.length));
        const alignments = getTableAlignments(blockLines[firstSeparatorIndex]?.text, colCount);
        const headerCells = dataRows[0].cells;
        const bodyRows = dataRows.slice(1).map(r => r.cells);
        const sourceLines: TableSourceLine[] = blockLines.map(line => ({
          text: line.text,
          isSep: line.isSep,
          cells: splitTableRow(line.text) || [],
        }));
        const sourceFrom = tLine.from;
        const sourceTo = tLine.to;

        if (!renderAll) {
          /* A compressed multi-row table occupies one source line. Expanding it
             into a multi-line block widget would make every click below it
             ambiguous, so editable mode keeps the repairable source visible. */
          decs.push(Decoration.line({ class: 'cm-lp-table-source-line' }).range(tLine.from));
        } else {
          decs.push(Decoration.replace({
            widget: new TableWidget(headerCells, bodyRows, colCount, alignments, hasHeader, sourceFrom, sourceTo, sourceLines),
            block: true,
          }).range(sourceFrom, sourceTo));
        }
        ti++;
        continue;
      }
    }

    if (!splitTableRow(tText)) { ti++; continue; }

    /* Collect contiguous table rows */
    const blockLines: { ln: number; text: string; isSep: boolean }[] = [];
    while (ti <= scanLineRange.toLine) {
      const bl = doc.line(ti);
      if (!splitTableRow(bl.text)) break;
      blockLines.push({ ln: ti, text: bl.text, isSep: isTableSeparatorRow(bl.text) });
      ti++;
    }
    if (blockLines.length < 2 || !blockLines.some(line => line.isSep)) continue;

    const firstSeparatorIndex = blockLines.findIndex(line => line.isSep);

    /* Parse non-separator rows */
    const dataRows: { ln: number; cells: string[] }[] = [];
    for (const blockLine of blockLines) {
      if (blockLine.isSep) continue;
      const cells = splitTableRow(blockLine.text);
      if (cells) dataRows.push({ ln: blockLine.ln, cells });
    }
    if (dataRows.length === 0) continue;

    const hasHeader = firstSeparatorIndex > 0;
    const colCount = Math.max(...dataRows.map(r => r.cells.length));
    const alignments = getTableAlignments(blockLines[firstSeparatorIndex]?.text, colCount);
    const headerCells = hasHeader ? dataRows[0].cells : [];
    const bodyRows = hasHeader ? dataRows.slice(1).map(r => r.cells) : dataRows.map(r => r.cells);
    const sourceLines: TableSourceLine[] = blockLines.map(line => ({
      text: line.text,
      isSep: line.isSep,
      cells: splitTableRow(line.text) || [],
    }));
    const sourceFrom = doc.line(blockLines[0].ln).from;
    const sourceTo = doc.line(blockLines[blockLines.length - 1].ln).to;

    if (!renderAll) {
      if (!cursorNearRange(state, sourceFrom, sourceTo, 0)) {
        addEditableTableRows(blockLines, colCount, alignments, hasHeader);
        continue;
      }

      for (const blockLine of blockLines) {
        const line = doc.line(blockLine.ln);
        decs.push(Decoration.line({
          class: blockLine.isSep
            ? 'cm-lp-table-source-line cm-lp-table-separator-line'
            : 'cm-lp-table-source-line',
        }).range(line.from));
      }
      continue;
    }

    /* Build table data for read-only preview rendering. */
    decs.push(Decoration.replace({
      widget: new TableWidget(headerCells, bodyRows, colCount, alignments, hasHeader, sourceFrom, sourceTo, sourceLines),
      block: true,
    }).range(sourceFrom, sourceTo));
  }
  }

  /* Sort and build DecorationSet — only filter cross-line replace decorations.
     Mark decorations can safely span lines; only plain replace causes CM6 errors. */
  const safeDecs = decs.filter(d => {
    if (d.from === d.to) return true; // point/line ranges always safe
    const fromLine = doc.lineAt(d.from).number;
    const toLine = doc.lineAt(d.to).number;
    if (fromLine === toLine) return true; // same line always safe
    try {
      if (!d.value.spec.replace) return true;
      return Boolean(d.value.spec.block);
    } catch { return false; }
  });
  const decorationSet = Decoration.set(safeDecs, true);
  if (buildStartedAt > 0 && typeof performance !== 'undefined') {
    const buildFinishedAt = performance.now();
    if (buildFinishedAt - buildStartedAt >= 8) {
      try {
        performance.measure('ars-note:live-preview-decorations', {
          start: buildStartedAt,
          end: buildFinishedAt,
          detail: {
            documentLength: doc.length,
            decorationCount: safeDecs.length,
            renderedCharacters: scanRanges.reduce((total, range) => total + range.to - range.from, 0),
          },
        });
      } catch { /* Performance diagnostics are optional. */ }
    }
  }
  return decorationSet;
}

/* ═══════════════════════════════════════════════════════
   ViewPlugin — recomputes decorations on every change
   ═══════════════════════════════════════════════════════ */

type LivePreviewDecorationState = {
  decorations: DecorationSet;
  ranges: LivePreviewRange[];
};

const extendLivePreviewRanges = StateEffect.define<LivePreviewRange[]>();

function replaceDecorationsInRanges(
  state: EditorState,
  current: DecorationSet,
  requestedRanges: LivePreviewRange[],
): DecorationSet {
  const ranges = mergeLivePreviewRanges(state, requestedRanges);
  const replacement = buildDecorations(state, ranges);
  const additions: Range<Decoration>[] = [];
  replacement.between(0, state.doc.length, (from, to, value) => {
    additions.push(value.range(from, to));
  });
  return current.update({
    filter: (from, to) => !ranges.some(range => (
      from === to
        ? from >= range.from && from <= range.to
        : from <= range.to && to >= range.from
    )),
    add: additions,
    sort: true,
  });
}

function getSelectionRefreshRange(state: EditorState): LivePreviewRange {
  const selection = state.selection.main;
  const fromLine = state.doc.lineAt(selection.from).number;
  const toLine = state.doc.lineAt(selection.to).number;
  return lineRangeToDocumentRange(state, fromLine - 1, toLine + 1);
}

const livePreviewDecorations = StateField.define<LivePreviewDecorationState>({
  create(state) {
    const ranges = getInitialLivePreviewRanges(state);
    return { decorations: buildDecorations(state, ranges), ranges };
  },
  update(value, tr) {
    const requestedRanges = tr.effects
      .filter(effect => effect.is(extendLivePreviewRanges))
      .flatMap(effect => effect.value);

    if (tr.docChanged) {
      const coveredTo = value.ranges.reduce((maximum, range) => Math.max(maximum, range.to), 0);
      let changesOnlyAfterRenderedContent = true;
      let insertedCharacters = 0;
      tr.changes.iterChanges((fromA, _toA, fromB, toB) => {
        if (fromA < coveredTo) changesOnlyAfterRenderedContent = false;
        insertedCharacters += toB - fromB;
      });
      if (changesOnlyAfterRenderedContent && insertedCharacters >= 1_000) {
        return {
          decorations: value.decorations.map(tr.changes),
          ranges: value.ranges,
        };
      }
      const ranges = getInitialLivePreviewRanges(tr.state);
      return { decorations: buildDecorations(tr.state, ranges), ranges };
    }

    if (requestedRanges.length > 0) {
      const ranges = mergeLivePreviewRanges(tr.state, [...value.ranges, ...requestedRanges]);
      if (ranges.length === value.ranges.length
        && ranges.every((range, index) => (
          range.from === value.ranges[index]?.from && range.to === value.ranges[index]?.to
        ))) {
        return value;
      }
      return {
        decorations: replaceDecorationsInRanges(tr.state, value.decorations, requestedRanges),
        ranges,
      };
    }

    if (!tr.docChanged) {
      if (tr.startState.selection.eq(tr.state.selection)) return value;

      /* Cursor movement only changes preview decorations on Markdown-bearing
         lines. Keeping the existing set for plain prose avoids an O(document)
         rebuild whenever the user clicks or moves through a large note. */
      const selectionTouchesPreviewSyntax = (state: EditorState): boolean => {
        const selection = state.selection.main;
        const firstLine = state.doc.lineAt(selection.from);
        const lastLine = state.doc.lineAt(selection.to);
        if (lastLine.number - firstLine.number > 12) return true;
        for (let lineNumber = firstLine.number; lineNumber <= lastLine.number; lineNumber += 1) {
          const text = state.doc.line(lineNumber).text;
          if (/[*_~`\[\]<>|]/.test(text)) return true;
          if (/^\s*(?:#{1,6}\s|>|[-+*]\s|\d+[.)]\s|```)/.test(text)) return true;
        }
        return false;
      };

      if (!selectionTouchesPreviewSyntax(tr.startState) && !selectionTouchesPreviewSyntax(tr.state)) {
        return value;
      }
    }
    const refreshRanges = [
      getSelectionRefreshRange(tr.startState),
      getSelectionRefreshRange(tr.state),
    ];
    return {
      decorations: replaceDecorationsInRanges(tr.state, value.decorations, refreshRanges),
      ranges: mergeLivePreviewRanges(tr.state, [...value.ranges, ...refreshRanges]),
    };
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
});

const livePreviewViewportLoader = ViewPlugin.fromClass(class {
  private frame = 0;

  constructor(view: EditorView) {
    this.schedule(view);
  }

  update(update: { view: EditorView; viewportChanged: boolean; geometryChanged: boolean }) {
    if (update.viewportChanged || update.geometryChanged) this.schedule(update.view);
  }

  private schedule(view: EditorView) {
    if (view.state.doc.lines <= LARGE_DOCUMENT_LINE_THRESHOLD || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!view.dom.isConnected) return;
      const field = view.state.field(livePreviewDecorations, false);
      if (!field) return;

      const visibleRanges = view.visibleRanges.map(range => {
        const fromLine = view.state.doc.lineAt(range.from).number;
        const toLine = view.state.doc.lineAt(Math.max(range.from, range.to - 1)).number;
        return lineRangeToDocumentRange(
          view.state,
          fromLine - VIEWPORT_PREVIEW_LINE_MARGIN,
          toLine + VIEWPORT_PREVIEW_LINE_MARGIN,
        );
      });
      const missingRanges = visibleRanges.filter(range => !isRangeCovered(field.ranges, range));
      if (missingRanges.length === 0) return;
      view.dispatch({ effects: extendLivePreviewRanges.of(missingRanges) });
    });
  }

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame);
  }
});

/* ═══════════════════════════════════════════════════════
   Slash Commands
   ═══════════════════════════════════════════════════════ */

const SLASH_COMMANDS = [
  { label: '# 一级标题', apply: '# ', type: 'text', detail: 'H1' },
  { label: '## 二级标题', apply: '## ', type: 'text', detail: 'H2' },
  { label: '### 三级标题', apply: '### ', type: 'text', detail: 'H3' },
  { label: '**粗体**', apply: '**粗体**', type: 'text', detail: 'Bold' },
  { label: '*斜体*', apply: '*斜体*', type: 'text', detail: 'Italic' },
  { label: '~~删除线~~', apply: '~~文本~~', type: 'text', detail: 'Strike' },
  { label: '`行内代码`', apply: '`代码`', type: 'text', detail: 'Code' },
  { label: '```代码块```', apply: '```\n\n```', type: 'text', detail: 'Code Block' },
  { label: '> 引用', apply: '> ', type: 'text', detail: 'Quote' },
  { label: '- 列表', apply: '- ', type: 'text', detail: 'List' },
  { label: '1. 有序列表', apply: '1. ', type: 'text', detail: 'Ordered List' },
  { label: '- [ ] 任务', apply: '- [ ] ', type: 'text', detail: 'Task' },
  { label: '--- 分隔线', apply: '\n---\n', type: 'text', detail: 'Divider' },
  { label: '表格', apply: '| 标题 | 标题 |\n|------|------|\n| 内容 | 内容 |', type: 'text', detail: 'Table' },
  { label: '链接', apply: '[文本](url)', type: 'text', detail: 'Link' },
  { label: '图片', apply: '![描述](url)', type: 'text', detail: 'Image' },
];

export function slashCommandSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\/\S*$/);
  if (!match) return null;
  const lineStart = context.state.doc.lineAt(match.from).from;
  const beforeSlash = context.state.sliceDoc(lineStart, match.from).trim();
  if (beforeSlash !== '') return null;

  return {
    from: match.from,
    options: SLASH_COMMANDS,
    filter: true,
  };
}

/* ═══════════════════════════════════════════════════════
   Export — the CM6 extension bundle
   ═══════════════════════════════════════════════════════ */

export function createLivePreviewExtension(): Extension[] {
  return [
    livePreviewDecorations,
    livePreviewViewportLoader,

    /* Theme for widget elements (images, checkboxes, etc.) */
    EditorView.baseTheme({
      '.cm-lp-image-wrap': {
        display: 'inline-block',
        maxWidth: '100%',
        verticalAlign: 'middle',
      },
      '.cm-lp-image': {
        maxWidth: '100%',
        maxHeight: '250px',
        borderRadius: '8px',
        border: '1px solid rgba(124, 92, 255, 0.2)',
        objectFit: 'contain',
      },
      '.cm-lp-image-broken img': { display: 'none' },
      '.cm-lp-image-broken::after': {
        content: '"🖼 broken"',
        color: '#6b7280',
        fontSize: '0.85em',
        fontStyle: 'italic',
      },
      '.cm-lp-quote-bar': {
        display: 'inline-block',
        width: '3px',
        height: '1em',
        backgroundColor: '#7c5cff',
        borderRadius: '2px',
        marginRight: '8px',
        verticalAlign: 'middle',
      },
      '.cm-lp-hr': {
        display: 'inline-block',
        width: '100%',
        height: '0',
        border: '0',
        borderTop: '1px solid #2b3245',
        verticalAlign: 'middle',
      },
      '.cm-lp-checkbox-wrap': {
        display: 'inline-flex',
        alignItems: 'center',
        marginRight: '4px',
        verticalAlign: 'middle',
      },
      '.cm-lp-checkbox': {
        accentColor: '#7c5cff',
        cursor: 'pointer',
        width: '16px',
        height: '16px',
      },

      '.cm-lp-table-source-line': {
        background: 'linear-gradient(90deg, rgba(96, 165, 250, 0.09), rgba(96, 165, 250, 0.025))',
        borderLeft: '2px solid rgba(96, 165, 250, 0.5)',
      },
      '.cm-line.cm-lp-table-source-line': {
        paddingLeft: '8px',
      },
      '.cm-lp-table-separator-line': {
        color: '#7890b2',
      },
      '.cm-lp-table-render-line': {
        paddingTop: '0 !important',
        paddingBottom: '0 !important',
      },
      '.cm-lp-table-render-separator-line': {
        height: '0 !important',
        minHeight: '0 !important',
        lineHeight: '0 !important',
        paddingTop: '0 !important',
        paddingBottom: '0 !important',
        overflow: 'hidden !important',
      },
      '.cm-line.cm-lp-table-render-separator-line': {
        height: '0 !important',
        minHeight: '0 !important',
        lineHeight: '0 !important',
        paddingTop: '0 !important',
        paddingBottom: '0 !important',
      },
      '.cm-lp-table-line-widget': {
        display: 'inline-grid',
        width: 'min(100%, 820px)',
        maxWidth: '100%',
        boxSizing: 'border-box',
        verticalAlign: 'top',
        lineHeight: '1.45',
        color: '#f8fafc',
        background: '#0f141f',
        borderLeft: '1px solid rgba(112, 164, 255, 0.72)',
        borderTop: '1px solid rgba(112, 164, 255, 0.72)',
        cursor: 'text',
        overflow: 'hidden',
        boxShadow: 'none',
      },
      '.cm-lp-table-line-first': {
        borderTopLeftRadius: '7px',
        borderTopRightRadius: '7px',
      },
      '.cm-lp-table-line-last': {
        borderBottom: '1px solid rgba(112, 164, 255, 0.72)',
        borderBottomLeftRadius: '7px',
        borderBottomRightRadius: '7px',
      },
      '.cm-lp-table-line-cell': {
        minWidth: '0',
        padding: '7px 12px',
        borderRight: '1px solid rgba(112, 164, 255, 0.72)',
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
        whiteSpace: 'normal',
      },
      '.cm-lp-table-line-header': {
        background: '#17243a',
      },
      '.cm-lp-table-line-header .cm-lp-table-line-cell': {
        color: '#ffffff',
        fontWeight: '800',
      },
      '.cm-lp-table-line-body:nth-child(even), .cm-lp-table-line-metadata:nth-child(even)': {
        background: '#121b2b',
      },
      '.cm-lp-table-line-widget:hover .cm-lp-table-line-cell': {
        background: 'rgba(96, 165, 250, 0.08)',
      },
      '.cm-lp-table-line-metadata .cm-lp-table-line-cell:first-child': {
        color: '#ffffff',
        fontWeight: '800',
        background: '#17243a',
      },
      '.cm-lp-table-line-separator': {
        height: '1px',
        minHeight: '1px',
        lineHeight: '1px',
        background: 'transparent',
        borderTop: '0',
        boxShadow: 'none',
      },
      '.cm-lp-table-line-separator .cm-lp-table-line-cell': {
        height: '1px',
        minHeight: '1px',
        padding: '0',
        background: 'transparent',
      },
      '.cm-lp-table-line-widget code': {
        background: 'rgba(125, 158, 207, 0.16)',
        color: '#dbeafe',
        padding: '1px 5px',
        borderRadius: '3px',
        border: '1px solid rgba(148, 163, 184, 0.24)',
        fontFamily: 'Consolas, monospace',
        fontSize: '0.88em',
      },
      '.cm-lp-table-line-widget a': {
        color: '#aac7ff',
      },

      /* Table styles for Ars-note Live Preview. */
      '.cm-lp-table-wrap': {
        display: 'block',
        position: 'relative',
        width: 'fit-content',
        maxWidth: '100%',
        margin: '18px 24px 24px',
        padding: '12px 18px 18px 0',
        boxSizing: 'border-box',
        overflowX: 'visible',
        overflowY: 'visible',
      },
      '.cm-lp-table': {
        width: 'max-content',
        maxWidth: '100%',
        minWidth: '420px',
        tableLayout: 'auto',
        borderCollapse: 'collapse',
        borderSpacing: '0',
        fontSize: '0.96em',
        lineHeight: '1.45',
        border: '1px solid rgba(148, 163, 184, 0.34)',
        backgroundColor: '#101722',
        color: '#f8fafc',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.18)',
      },
      '.cm-lp-table th': {
        background: '#182235',
        color: '#ffffff',
        fontWeight: '700',
        letterSpacing: '0',
        textAlign: 'left',
        padding: '8px 13px',
        border: '1px solid rgba(148, 163, 184, 0.34)',
        whiteSpace: 'nowrap',
      },
      '.cm-lp-table td': {
        padding: '8px 13px',
        border: '1px solid rgba(148, 163, 184, 0.34)',
        color: '#f8fafc',
        backgroundColor: '#0f141f',
        verticalAlign: 'top',
        transition: 'background-color 120ms ease, color 120ms ease',
      },
      '.cm-lp-table td:first-child': {
        fontWeight: '700',
        color: '#ffffff',
        whiteSpace: 'nowrap',
      },
      '.cm-lp-table tbody tr:nth-child(even) td': {
        backgroundColor: '#121a28',
      },
      '.cm-lp-table tbody tr:hover td': {
        backgroundColor: '#17243a',
      },
      '.cm-lp-table.cm-lp-table-metadata td:first-child': {
        background: '#17243a',
        color: '#ffffff',
        fontWeight: '700',
        minWidth: '96px',
      },
      '.cm-lp-table.cm-lp-table-metadata tbody tr:nth-child(even) td:first-child': {
        background: '#1a2942',
      },
      '.cm-lp-table.cm-lp-table-metadata tbody tr:hover td:first-child': {
        background: '#203250',
      },
      '.cm-lp-table.cm-lp-table-metadata td:last-child': {
        color: '#f8fafc',
      },
      '.cm-lp-table code': {
        background: 'rgba(125, 158, 207, 0.16)',
        color: '#dbeafe',
        padding: '1px 5px',
        borderRadius: '3px',
        border: '1px solid rgba(148, 163, 184, 0.24)',
        fontFamily: 'Consolas, monospace',
        fontSize: '0.88em',
      },
      '.cm-lp-table a': {
        color: '#aac7ff',
      },
      '.cm-lp-table-action': {
        position: 'absolute',
        zIndex: '3',
        width: '24px',
        height: '24px',
        border: '1px solid rgba(148, 163, 184, 0.45)',
        borderRadius: '999px',
        background: 'rgba(18, 25, 39, 0.94)',
        color: '#b8c7e6',
        cursor: 'pointer',
        fontSize: '15px',
        fontWeight: '700',
        lineHeight: '22px',
        padding: '0',
        display: 'grid',
        placeItems: 'center',
        opacity: '0.42',
        boxShadow: '0 8px 18px rgba(0, 0, 0, 0.28)',
        transition: 'opacity 120ms ease, background-color 120ms ease, border-color 120ms ease, color 120ms ease',
      },
      '.cm-lp-table-wrap:hover .cm-lp-table-action': {
        opacity: '1',
      },
      '.cm-lp-table-action:hover': {
        background: '#253654',
        borderColor: 'rgba(180, 198, 232, 0.72)',
        color: '#ffffff',
      },
      '.cm-lp-table-edit': {
        top: '-2px',
        right: '2px',
        width: '44px',
        height: '24px',
        fontSize: '11px',
        lineHeight: '22px',
        borderRadius: '999px',
        opacity: '0.72',
      },
      '.cm-lp-table-format': {
        top: '-2px',
        right: '52px',
        width: '58px',
        height: '24px',
        fontSize: '11px',
        lineHeight: '22px',
        borderRadius: '999px',
        opacity: '0.72',
      },
      '.cm-lp-table-add-col': {
        right: '-28px',
        top: 'calc(50% - 12px)',
        width: '56px',
        height: '24px',
        fontSize: '11px',
      },
      '.cm-lp-table-add-row': {
        left: 'calc(50% - 28px)',
        bottom: '-12px',
        width: '56px',
        height: '24px',
        fontSize: '11px',
      },
    }),
  ];
}
