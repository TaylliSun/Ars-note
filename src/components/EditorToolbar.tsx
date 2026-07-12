import React, { useCallback, useEffect, useRef, useState } from 'react';
import { undo, redo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import type { EditorHandle } from './Editor';

export type ViewMode = 'source' | 'preview' | 'split' | 'live';

interface EditorToolbarProps {
  editorRef: React.RefObject<EditorHandle | null>;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

type Panel = 'style' | 'textColor' | 'bgColor' | 'more' | null;

interface FloatingState {
  visible: boolean;
  left: number;
  top: number;
}

interface PanelAnchor {
  left: number;
  top: number;
}

type ColorOption = { name: string; value: string };

const TABLE_TEMPLATE = '| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell 1 | Cell 2 | Cell 3 |\n| Cell 4 | Cell 5 | Cell 6 |';

const TEXT_COLORS: ColorOption[] = [
  { name: 'Snow', value: '#f8fafc' },
  { name: 'Mist', value: '#cbd5e1' },
  { name: 'Rose', value: '#fb7185' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Gold', value: '#facc15' },
  { name: 'Mint', value: '#34d399' },
  { name: 'Cyan', value: '#22d3ee' },
  { name: 'Sky', value: '#60a5fa' },
  { name: 'Violet', value: '#a78bfa' },
  { name: 'Pink', value: '#f472b6' },
];

const BG_COLORS: ColorOption[] = [
  { name: 'Slate', value: '#334155' },
  { name: 'Wine', value: '#7f1d1d' },
  { name: 'Clay', value: '#7c2d12' },
  { name: 'Olive', value: '#713f12' },
  { name: 'Forest', value: '#14532d' },
  { name: 'Teal', value: '#164e63' },
  { name: 'Navy', value: '#1e3a8a' },
  { name: 'Indigo', value: '#4c1d95' },
  { name: 'Plum', value: '#831843' },
  { name: 'Ink', value: '#111827' },
];

const STYLE_OPTIONS = [
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'h1', label: 'Heading 1' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
  { value: 'h4', label: 'Heading 4' },
  { value: 'h5', label: 'Heading 5' },
  { value: 'h6', label: 'Heading 6' },
];

function selectedText(editor: EditorHandle | null): string {
  return editor?.getSelection() || '';
}

function applyLineTransform(editor: EditorHandle | null, transform: (line: string, index: number) => string) {
  const view = editor?.getView();
  if (!view || view.state.facet(EditorState.readOnly)) return;

  const selection = view.state.selection.main;
  const startLine = view.state.doc.lineAt(selection.from);
  const endLine = view.state.doc.lineAt(selection.to);
  const lines: string[] = [];

  for (let lineNo = startLine.number; lineNo <= endLine.number; lineNo++) {
    lines.push(transform(view.state.doc.line(lineNo).text, lineNo - startLine.number));
  }

  view.dispatch({
    changes: {
      from: startLine.from,
      to: endLine.to,
      insert: lines.join('\n'),
    },
    selection: { anchor: startLine.from },
  });
  view.focus();
}

function wrapSelection(editor: EditorHandle | null, before: string, after: string = before, placeholder = 'text') {
  if (!editor) return;

  const selected = selectedText(editor);
  if (selected) {
    editor.wrapSelection(before, after);
  } else {
    editor.insertAtCursor(before + placeholder + after);
  }
}

function applySpan(editor: EditorHandle | null, styleName: 'color' | 'background-color', value: string) {
  if (!editor) return;

  const selected = selectedText(editor);
  const text = selected || 'text';
  editor.replaceSelection(`<span style="${styleName}:${value}">${text}</span>`);
}

function applyHeading(editor: EditorHandle | null, level: number) {
  applyLineTransform(editor, (line) => {
    const body = line.replace(/^#{1,6}\s+/, '');
    return level === 0 ? body : `${'#'.repeat(level)} ${body}`;
  });
}

function togglePrefix(editor: EditorHandle | null, prefix: string, matcher?: RegExp) {
  applyLineTransform(editor, (line, index) => {
    const re = matcher || new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (re.test(line)) return line.replace(re, '');
    if (prefix === '1. ') return `${index + 1}. ${line.replace(/^\d+\.\s+/, '')}`;
    return prefix + line;
  });
}

function wrapBlock(editor: EditorHandle | null, before: string, after: string) {
  if (!editor) return;

  const selected = selectedText(editor) || 'text';
  editor.replaceSelection(before + selected + after);
}

type TableColumnAlignment = 'default' | 'left' | 'center' | 'right';

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

function isMarkdownTableSeparator(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  if (!cells) return false;
  return cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
}

function normalizeCells(cells: string[], colCount: number, fill = ''): string[] {
  return Array.from({ length: colCount }, (_, index) => cells[index] ?? fill);
}

function getSeparatorAlignment(cell: string): TableColumnAlignment {
  const compact = cell.replace(/\s+/g, '');
  const starts = compact.startsWith(':');
  const ends = compact.endsWith(':');
  if (starts && ends) return 'center';
  if (starts) return 'left';
  if (ends) return 'right';
  return 'default';
}

function formatSeparatorCell(width: number, alignment: TableColumnAlignment): string {
  const reserved = alignment === 'center' ? 2 : alignment === 'left' || alignment === 'right' ? 1 : 0;
  const dashes = '-'.repeat(Math.max(3, width - reserved));
  if (alignment === 'center') return `:${dashes}:`;
  if (alignment === 'left') return `:${dashes}`;
  if (alignment === 'right') return `${dashes}:`;
  return dashes;
}

function formatTableLines(lines: string[]): string[] {
  const parsed = lines.map(line => ({
    cells: splitMarkdownTableRow(line) || [],
    separator: isMarkdownTableSeparator(line),
  })).filter(row => row.cells.length > 0);
  if (parsed.length === 0) return lines;

  const hasSeparator = parsed.some(row => row.separator);
  if (!hasSeparator && parsed.length > 0) {
    parsed.splice(1, 0, { cells: parsed[0].cells.map(() => '---'), separator: true });
  }

  const colCount = Math.max(...parsed.map(row => row.cells.length), 2);
  const separatorCells = parsed.find(row => row.separator)?.cells || [];
  const alignments = Array.from({ length: colCount }, (_, col) => getSeparatorAlignment(separatorCells[col] || '---'));
  const widths = Array.from({ length: colCount }, (_, col) => {
    return Math.max(
      3,
      ...parsed
        .filter(row => !row.separator)
        .map(row => (row.cells[col] || '').length),
    );
  });

  return parsed.map(row => {
    const cells = normalizeCells(row.cells, colCount, row.separator ? '---' : '');
    if (row.separator) {
      return `| ${widths.map((width, col) => formatSeparatorCell(width, alignments[col])).join(' | ')} |`;
    }
    return `| ${cells.map((cell, col) => cell.padEnd(widths[col], ' ')).join(' | ')} |`;
  });
}

function findTableBlock(editor: EditorHandle | null) {
  const view = editor?.getView();
  if (!view || view.state.facet(EditorState.readOnly)) return null;
  const cursorLine = view.state.doc.lineAt(view.state.selection.main.from);
  if (!splitMarkdownTableRow(cursorLine.text)) return null;

  let fromLine = cursorLine.number;
  let toLine = cursorLine.number;
  while (fromLine > 1 && splitMarkdownTableRow(view.state.doc.line(fromLine - 1).text)) fromLine--;
  while (toLine < view.state.doc.lines && splitMarkdownTableRow(view.state.doc.line(toLine + 1).text)) toLine++;

  const lines: string[] = [];
  for (let lineNo = fromLine; lineNo <= toLine; lineNo++) {
    lines.push(view.state.doc.line(lineNo).text);
  }

  return {
    view,
    from: view.state.doc.line(fromLine).from,
    /* Use from + text.length, NOT .to — .to includes the trailing newline,
       which would consume the line break after the table and merge it with
       whatever text follows. */
    to: view.state.doc.line(toLine).from + view.state.doc.line(toLine).text.length,
    cursorLine,
    lines,
  };
}

function getCurrentTableColumn(lineText: string, cursorOffset: number): number {
  const text = lineText.trim();
  const originalLeadingTrim = lineText.length - lineText.trimStart().length;
  const offset = Math.max(0, cursorOffset - originalLeadingTrim);
  const pipeIndexes = getTableDelimiterIndices(text);
  const startsWithPipe = pipeIndexes[0] === 0;
  if (pipeIndexes.length < 2) return 0;
  for (let i = 0; i < pipeIndexes.length - 1; i++) {
    if (offset <= pipeIndexes[i + 1]) return startsWithPipe ? i : i + 1;
  }
  return Math.max(0, pipeIndexes.length - (startsWithPipe ? 2 : 1));
}

function replaceTableBlock(editor: EditorHandle | null, transform: (lines: string[], block: NonNullable<ReturnType<typeof findTableBlock>>) => string[]) {
  const block = findTableBlock(editor);
  if (!block) {
    editor?.insertAtCursor('\n' + TABLE_TEMPLATE + '\n');
    return;
  }

  const nextLines = transform(block.lines, block);
  block.view.dispatch({
    changes: { from: block.from, to: block.to, insert: nextLines.join('\n') },
    selection: { anchor: block.cursorLine.from },
  });
  block.view.focus();
}

function formatCurrentTable(editor: EditorHandle | null) {
  replaceTableBlock(editor, (lines) => formatTableLines(lines));
}

function insertTableRowBelow(editor: EditorHandle | null) {
  const block = findTableBlock(editor);
  if (!block) {
    editor?.insertAtCursor('\n' + TABLE_TEMPLATE + '\n');
    return;
  }
  const colCount = Math.max(...block.lines.map(line => splitMarkdownTableRow(line)?.length || 0), 2);
  const lineIndex = block.cursorLine.number - block.view.state.doc.lineAt(block.from).number;
  const insertAt = isMarkdownTableSeparator(block.cursorLine.text) ? lineIndex + 1 : lineIndex + 1;
  const nextLines = [...block.lines];
  nextLines.splice(insertAt, 0, `| ${Array.from({ length: colCount }, () => '').join(' | ')} |`);
  const formatted = formatTableLines(nextLines);
  block.view.dispatch({
    changes: { from: block.from, to: block.to, insert: formatted.join('\n') },
    selection: { anchor: block.cursorLine.to + formatted[insertAt].length + 1 },
  });
  block.view.focus();
}

function insertTableRowAbove(editor: EditorHandle | null) {
  const block = findTableBlock(editor);
  if (!block) {
    editor?.insertAtCursor('\n' + TABLE_TEMPLATE + '\n');
    return;
  }
  const colCount = Math.max(...block.lines.map(line => splitMarkdownTableRow(line)?.length || 0), 2);
  const lineIndex = block.cursorLine.number - block.view.state.doc.lineAt(block.from).number;
  const separatorIndex = block.lines.findIndex(isMarkdownTableSeparator);
  const insertAt = separatorIndex >= 0 && lineIndex <= separatorIndex ? separatorIndex + 1 : Math.max(0, lineIndex);
  const nextLines = [...block.lines];
  nextLines.splice(insertAt, 0, `| ${Array.from({ length: colCount }, () => '').join(' | ')} |`);
  const formatted = formatTableLines(nextLines);
  block.view.dispatch({
    changes: { from: block.from, to: block.to, insert: formatted.join('\n') },
    selection: { anchor: block.from },
  });
  block.view.focus();
}

function deleteCurrentTableRow(editor: EditorHandle | null) {
  const block = findTableBlock(editor);
  if (!block) return;
  const lineIndex = block.cursorLine.number - block.view.state.doc.lineAt(block.from).number;
  if (isMarkdownTableSeparator(block.lines[lineIndex])) return;
  if (lineIndex === 0 && isMarkdownTableSeparator(block.lines[1] || '')) return;
  const nextLines = block.lines.filter((_, index) => index !== lineIndex);
  if (nextLines.filter(line => !isMarkdownTableSeparator(line)).length === 0) return;
  replaceTableBlock(editor, () => formatTableLines(nextLines));
}

function insertTableColumnRight(editor: EditorHandle | null) {
  const block = findTableBlock(editor);
  if (!block) {
    editor?.insertAtCursor('\n' + TABLE_TEMPLATE + '\n');
    return;
  }
  const colCount = Math.max(...block.lines.map(line => splitMarkdownTableRow(line)?.length || 0), 2);
  const cursorOffset = block.view.state.selection.main.from - block.cursorLine.from;
  const currentCol = Math.min(getCurrentTableColumn(block.cursorLine.text, cursorOffset), colCount - 1);
  const nextLines = block.lines.map(line => {
    const cells = normalizeCells(splitMarkdownTableRow(line) || [], colCount, '');
    cells.splice(currentCol + 1, 0, isMarkdownTableSeparator(line) ? '---' : '');
    return `| ${cells.join(' | ')} |`;
  });
  replaceTableBlock(editor, () => formatTableLines(nextLines));
}

function insertTableColumnLeft(editor: EditorHandle | null) {
  const block = findTableBlock(editor);
  if (!block) {
    editor?.insertAtCursor('\n' + TABLE_TEMPLATE + '\n');
    return;
  }
  const colCount = Math.max(...block.lines.map(line => splitMarkdownTableRow(line)?.length || 0), 2);
  const cursorOffset = block.view.state.selection.main.from - block.cursorLine.from;
  const currentCol = Math.min(getCurrentTableColumn(block.cursorLine.text, cursorOffset), colCount - 1);
  const nextLines = block.lines.map(line => {
    const cells = normalizeCells(splitMarkdownTableRow(line) || [], colCount, '');
    cells.splice(currentCol, 0, isMarkdownTableSeparator(line) ? '---' : '');
    return `| ${cells.join(' | ')} |`;
  });
  replaceTableBlock(editor, () => formatTableLines(nextLines));
}

function deleteCurrentTableColumn(editor: EditorHandle | null) {
  const block = findTableBlock(editor);
  if (!block) return;
  const colCount = Math.max(...block.lines.map(line => splitMarkdownTableRow(line)?.length || 0), 2);
  if (colCount <= 2) return;
  const cursorOffset = block.view.state.selection.main.from - block.cursorLine.from;
  const currentCol = Math.min(getCurrentTableColumn(block.cursorLine.text, cursorOffset), colCount - 1);
  const nextLines = block.lines.map(line => {
    const cells = normalizeCells(splitMarkdownTableRow(line) || [], colCount, '');
    cells.splice(currentCol, 1);
    return `| ${cells.join(' | ')} |`;
  });
  replaceTableBlock(editor, () => formatTableLines(nextLines));
}

function alignCurrentTableColumn(editor: EditorHandle | null, alignment: Exclude<TableColumnAlignment, 'default'>): boolean {
  const block = findTableBlock(editor);
  if (!block) return false;

  const colCount = Math.max(...block.lines.map(line => splitMarkdownTableRow(line)?.length || 0), 2);
  const cursorOffset = block.view.state.selection.main.from - block.cursorLine.from;
  const currentCol = Math.min(getCurrentTableColumn(block.cursorLine.text, cursorOffset), colCount - 1);
  let separatorIndex = block.lines.findIndex(isMarkdownTableSeparator);
  const nextLines = [...block.lines];

  if (separatorIndex < 0) {
    separatorIndex = Math.min(1, nextLines.length);
    nextLines.splice(separatorIndex, 0, `| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`);
  }

  nextLines[separatorIndex] = (() => {
    const cells = normalizeCells(splitMarkdownTableRow(nextLines[separatorIndex]) || [], colCount, '---');
    cells[currentCol] = formatSeparatorCell(3, alignment);
    return `| ${cells.join(' | ')} |`;
  })();

  replaceTableBlock(editor, () => formatTableLines(nextLines));
  return true;
}

function useFloatingToolbar(editorRef: React.RefObject<EditorHandle | null>, disabled: boolean): FloatingState {
  const [floating, setFloating] = useState<FloatingState>({ visible: false, left: 0, top: 0 });

  useEffect(() => {
    if (disabled) {
      setFloating({ visible: false, left: 0, top: 0 });
      return;
    }

    const update = () => {
      const view = editorRef.current?.getView();
      if (!view) return;

      const selection = view.state.selection.main;
      if (selection.empty) {
        setFloating(prev => prev.visible ? { visible: false, left: 0, top: 0 } : prev);
        return;
      }

      const head = view.coordsAtPos(selection.from);
      const tail = view.coordsAtPos(selection.to);
      if (!head || !tail) return;

      const left = Math.max(12, Math.min(head.left, tail.left));
      const top = Math.max(46, Math.min(head.top, tail.top) - 44);
      setFloating({ visible: true, left, top });
    };

    document.addEventListener('mouseup', update);
    document.addEventListener('keyup', update);
    document.addEventListener('selectionchange', update);

    return () => {
      document.removeEventListener('mouseup', update);
      document.removeEventListener('keyup', update);
      document.removeEventListener('selectionchange', update);
    };
  }, [disabled, editorRef]);

  return floating;
}

const EditorToolbar: React.FC<EditorToolbarProps> = ({ editorRef, viewMode, onViewModeChange }) => {
  const [openPanel, setOpenPanel] = useState<Panel>(null);
  const [panelAnchor, setPanelAnchor] = useState<PanelAnchor>({ left: 0, top: 0 });
  const [headingValue, setHeadingValue] = useState('paragraph');
  const panelRef = useRef<HTMLDivElement>(null);
  const floatingPanelRef = useRef<HTMLDivElement>(null);
  const toolbarLeftRef = useRef<HTMLDivElement>(null);
  const isReadOnlyPreview = viewMode === 'preview';
  const floating = useFloatingToolbar(editorRef, isReadOnlyPreview);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !panelRef.current?.contains(target)
        && !floatingPanelRef.current?.contains(target)
      ) {
        setOpenPanel(null);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const run = useCallback((command: string, value?: string) => {
    if (isReadOnlyPreview) return;

    const editor = editorRef.current;
    const view = editor?.getView();
    if (!editor || !view) return;

    switch (command) {
      case 'undo':
        undo(view);
        break;
      case 'redo':
        redo(view);
        break;
      case 'bold':
        wrapSelection(editor, '**', '**');
        break;
      case 'italic':
        wrapSelection(editor, '*', '*');
        break;
      case 'strike':
        wrapSelection(editor, '~~', '~~');
        break;
      case 'code':
        wrapSelection(editor, '`', '`', 'code');
        break;
      case 'codeblock':
        wrapBlock(editor, '\n```\n', '\n```\n');
        break;
      case 'link': {
        const text = selectedText(editor) || 'text';
        editor.replaceSelection(`[${text}](url)`);
        break;
      }
      case 'image':
        editor.replaceSelection('![alt](url)');
        break;
      case 'quote':
        togglePrefix(editor, '> ');
        break;
      case 'bullet':
        togglePrefix(editor, '- ');
        break;
      case 'number':
        togglePrefix(editor, '1. ', /^\d+\.\s+/);
        break;
      case 'task':
        togglePrefix(editor, '- [ ] ', /^- \[[ xX]\]\s+/);
        break;
      case 'indent':
        applyLineTransform(editor, line => '  ' + line);
        break;
      case 'outdent':
        applyLineTransform(editor, line => line.replace(/^ {1,2}/, ''));
        break;
      case 'hr':
        editor.insertAtCursor('\n---\n');
        break;
      case 'table':
        editor.insertAtCursor('\n' + TABLE_TEMPLATE + '\n');
        break;
      case 'tableFormat':
        formatCurrentTable(editor);
        break;
      case 'tableRow':
        insertTableRowBelow(editor);
        break;
      case 'tableRowAbove':
        insertTableRowAbove(editor);
        break;
      case 'tableRowDelete':
        deleteCurrentTableRow(editor);
        break;
      case 'tableCol':
        insertTableColumnRight(editor);
        break;
      case 'tableColLeft':
        insertTableColumnLeft(editor);
        break;
      case 'tableColDelete':
        deleteCurrentTableColumn(editor);
        break;
      case 'left':
        if (alignCurrentTableColumn(editor, 'left')) break;
        wrapBlock(editor, '<p align="left">', '</p>');
        break;
      case 'center':
        if (alignCurrentTableColumn(editor, 'center')) break;
        wrapBlock(editor, '<center>', '</center>');
        break;
      case 'right':
        if (alignCurrentTableColumn(editor, 'right')) break;
        wrapBlock(editor, '<p align="right">', '</p>');
        break;
      case 'justify':
        wrapBlock(editor, '<p align="justify">', '</p>');
        break;
      case 'textColor':
        if (value) applySpan(editor, 'color', value);
        setOpenPanel(null);
        break;
      case 'bgColor':
        if (value) applySpan(editor, 'background-color', value);
        setOpenPanel(null);
        break;
    }
  }, [editorRef, isReadOnlyPreview]);

  const applyHeadingValue = (value: string) => {
    setHeadingValue(value);
    applyHeading(editorRef.current, value === 'paragraph' ? 0 : Number(value.replace('h', '')));
    setOpenPanel(null);
  };

  const handleToolbarWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const el = toolbarLeftRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    event.preventDefault();
    el.scrollLeft += delta;
  };

  const togglePanel = (panel: Exclude<Panel, null>, target: HTMLElement) => {
    if (openPanel === panel) {
      setOpenPanel(null);
      return;
    }

    const rect = target.getBoundingClientRect();
    const width = panel === 'more' ? 180 : panel === 'style' ? 172 : 152;
    setPanelAnchor({
      left: Math.max(10, Math.min(rect.left, window.innerWidth - width - 10)),
      top: rect.bottom + 8,
    });
    setOpenPanel(panel);
  };

  const colorPanel = (kind: 'textColor' | 'bgColor', colors: ColorOption[], title: string, hint: string) => (
    <div className="et-color-popover">
      <div className="et-panel-head">
        <span>{title}</span>
        <small>{hint}</small>
      </div>
      <div className="et-color-panel">
        {colors.map(color => (
          <button
            key={color.value}
            type="button"
            className="et-color-swatch"
            style={{ background: color.value }}
            title={`${color.name} ${color.value}`}
            onClick={() => run(kind, color.value)}
          >
            <span className="et-color-swatch-name">{color.name}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const stylePanel = (
    <div className="et-style-menu">
      {STYLE_OPTIONS.map(option => (
        <button
          key={option.value}
          type="button"
          className={'et-style-option' + (headingValue === option.value ? ' active' : '')}
          onClick={() => applyHeadingValue(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  const currentStyleLabel = STYLE_OPTIONS.find(option => option.value === headingValue)?.label || 'Paragraph';

  const floatingButton = (label: string, command: string, ariaLabel: string, className = '') => (
    <button type="button" className={'et-float-btn ' + className} aria-label={ariaLabel} onMouseDown={e => e.preventDefault()} onClick={() => run(command)}>
      {label}
    </button>
  );

  return (
    <>
      <div className="editor-toolbar editing-toolbar" ref={panelRef}>
        <div
          ref={toolbarLeftRef}
          className={'editing-toolbar-left' + (isReadOnlyPreview ? ' toolbar-disabled' : '')}
          onWheel={handleToolbarWheel}
        >
          <div className="et-segment et-history-group" aria-label="History">
            <button type="button" className="et-btn" aria-label="Undo" title="Undo" onClick={() => run('undo')}>↶</button>
            <button type="button" className="et-btn" aria-label="Redo" title="Redo" onClick={() => run('redo')}>↷</button>
          </div>

          <div className="toolbar-separator" />

          <label className="et-style-picker">
            <span className="et-style-label">Style</span>
            <button
              type="button"
              className="et-select et-select-button"
              title="Paragraph style"
              onClick={(event) => togglePanel('style', event.currentTarget)}
            >
              <span>{currentStyleLabel}</span>
              <span className="et-select-caret">v</span>
            </button>
          </label>

          <div className="toolbar-separator" />

          <div className="et-segment" aria-label="Inline formatting">
            <button type="button" className="et-btn et-bold" title="Bold" onClick={() => run('bold')}>B</button>
            <button type="button" className="et-btn et-italic" title="Italic" onClick={() => run('italic')}>I</button>
            <button type="button" className="et-btn et-strike" title="Strikethrough" onClick={() => run('strike')}>S</button>
            <button type="button" className="et-btn" title="Inline code" onClick={() => run('code')}>{'<>'}</button>
          </div>

          <div className="et-segment et-list-group" aria-label="Lists">
            <button type="button" className="et-btn" title="Bullet list" onClick={() => run('bullet')}>List</button>
            <button type="button" className="et-btn" title="Numbered list" onClick={() => run('number')}>1.</button>
            <button type="button" className="et-btn" title="Task list" onClick={() => run('task')}>[ ]</button>
          </div>

          <div className="toolbar-separator" />

          <div className="et-segment et-insert-group" aria-label="Insert">
            <button type="button" className="et-btn" title="Link" onClick={() => run('link')}>Link</button>
            <button type="button" className="et-btn" title="Quote" onClick={() => run('quote')}>Quote</button>
            <button type="button" className="et-btn" title="Table" onClick={() => run('table')}>Table</button>
          </div>

          <div className="et-more-wrapper">
            <button type="button" className="et-btn et-more-btn" title="More commands" onClick={(event) => togglePanel('more', event.currentTarget)}>More</button>
          </div>
        </div>

        <div className="editor-toolbar-right">
          <div className="toolbar-view-toggle">
            <button type="button" className={'view-toggle-btn' + (viewMode === 'live' ? ' active' : '')} title="Edit" onClick={() => onViewModeChange('live')}>Edit</button>
            <button type="button" className={'view-toggle-btn' + (viewMode === 'preview' ? ' active' : '')} title="Preview" onClick={() => onViewModeChange('preview')}>Preview</button>
          </div>
        </div>
      </div>

      {openPanel && (
        <div
          ref={floatingPanelRef}
          className="et-floating-panel"
          role="dialog"
          aria-label="Formatting options"
          style={{ left: panelAnchor.left, top: panelAnchor.top }}
        >
          {openPanel === 'textColor' && colorPanel('textColor', TEXT_COLORS, 'Text color', 'Applies to selected text')}
          {openPanel === 'bgColor' && colorPanel('bgColor', BG_COLORS, 'Highlight', 'Adds a readable background')}
          {openPanel === 'style' && stylePanel}
          {openPanel === 'more' && (
            <div className="et-more-menu" role="menu" aria-label="More commands">
              <button type="button" role="menuitem" aria-label="Text color" onClick={(event) => togglePanel('textColor', event.currentTarget)}><span>Text color</span><small>color</small></button>
              <button type="button" role="menuitem" aria-label="Highlight" onClick={(event) => togglePanel('bgColor', event.currentTarget)}><span>Highlight</span><small>color</small></button>
              <button type="button" role="menuitem" aria-label="Insert link" onClick={() => run('link')}><span>Link</span><small>insert</small></button>
              <button type="button" role="menuitem" aria-label="Insert quote" onClick={() => run('quote')}><span>Quote</span><small>insert</small></button>
              <button type="button" role="menuitem" aria-label="Insert table" onClick={() => run('table')}><span>Table</span><small>insert</small></button>
              <button type="button" role="menuitem" aria-label="Outdent" onClick={() => run('outdent')}><span>Outdent</span><small>list</small></button>
              <button type="button" role="menuitem" aria-label="Indent" onClick={() => run('indent')}><span>Indent</span><small>list</small></button>
              <button type="button" role="menuitem" aria-label="Insert divider" onClick={() => run('hr')}><span>Divider</span><small>---</small></button>
              <button type="button" role="menuitem" aria-label="Insert code block" onClick={() => run('codeblock')}><span>Code block</span><small>```</small></button>
              <button type="button" role="menuitem" aria-label="Insert image" onClick={() => run('image')}><span>Image</span><small>![]()</small></button>
              <button type="button" role="menuitem" aria-label="Format table" onClick={() => run('tableFormat')}><span>Format table</span><small>table</small></button>
              <button type="button" role="menuitem" aria-label="Add row below" onClick={() => run('tableRow')}><span>Row below</span><small>table</small></button>
              <button type="button" role="menuitem" aria-label="Add row above" onClick={() => run('tableRowAbove')}><span>Row above</span><small>table</small></button>
              <button type="button" role="menuitem" aria-label="Delete current row" onClick={() => run('tableRowDelete')}><span>Delete row</span><small>table</small></button>
              <button type="button" role="menuitem" aria-label="Add column right" onClick={() => run('tableCol')}><span>Column right</span><small>table</small></button>
              <button type="button" role="menuitem" aria-label="Add column left" onClick={() => run('tableColLeft')}><span>Column left</span><small>table</small></button>
              <button type="button" role="menuitem" aria-label="Delete current column" onClick={() => run('tableColDelete')}><span>Delete column</span><small>table</small></button>
              <button type="button" role="menuitem" aria-label="Align left" onClick={() => run('left')}><span>Align left</span><small>left</small></button>
              <button type="button" role="menuitem" aria-label="Align center" onClick={() => run('center')}><span>Center</span><small>center</small></button>
              <button type="button" role="menuitem" aria-label="Align right" onClick={() => run('right')}><span>Align right</span><small>right</small></button>
              <button type="button" role="menuitem" aria-label="Justify text" onClick={() => run('justify')}><span>Justify</span><small>wide</small></button>
            </div>
          )}
        </div>
      )}

      {floating.visible && (
        <div className="editing-toolbar-floating" role="toolbar" aria-label="Quick formatting" style={{ left: floating.left, top: floating.top }} onMouseDown={e => e.preventDefault()}>
          {floatingButton('B', 'bold', 'Bold', 'et-bold')}
          {floatingButton('I', 'italic', 'Italic', 'et-italic')}
          {floatingButton('S', 'strike', 'Strikethrough', 'et-strike')}
          {floatingButton('<>', 'code', 'Inline code')}
          {floatingButton('Link', 'link', 'Insert link')}
        </div>
      )}
    </>
  );
};

export default EditorToolbar;
