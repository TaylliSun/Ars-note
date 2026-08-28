import React, { useEffect, useRef, useImperativeHandle, forwardRef, useCallback, useState, useMemo } from 'react';
import type { EditorHandle } from './Editor';
import { FileIcon } from './icons/ArsIcons';
import { escapeHtml, sanitizeColorValue, sanitizeMarkdownHref } from '../utils/markdownRenderer';

interface LiveEditorProps {
  content: string;
  onChange: (value: string) => void;
  availableFiles?: string[];
  onOpenFile?: (path: string) => void;
}

/* ═══════════════════════════════════════════════════════════
   Markdown → HTML (full render for initial display)
   ═══════════════════════════════════════════════════════════ */

function escHtml(s: string): string {
  return escapeHtml(s);
}

function inlineMd(text: string): string {
  let h = escHtml(text);
  // Wiki-links [[file]]
  h = h.replace(/\[\[([^\]]+)\]\]/g, '<span class="wiki-link" data-wiki="$1">$1</span>');
  h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" />');
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, rawHref) => {
    const href = sanitizeMarkdownHref(rawHref);
    return href
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${label}</a>`
      : `<span class="md-link-invalid">${label}</span>`;
  });
  h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
  h = h.replace(/~~(.+?)~~/g, '<del>$1</del>');
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/&lt;span style=&quot;color:([^&]+)&quot;&gt;(.+?)&lt;\/span&gt;/g, (_match, rawColor, inner) => {
    const color = sanitizeColorValue(rawColor);
    return color ? `<span style="color:${color}">${inner}</span>` : inner;
  });
  return h;
}

function renderFullHtml(md: string): string {
  if (!md) return '<div data-type="p" data-editing="true"><br></div>';
  const lines = md.split('\n');
  const blocks: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        blocks.push('<pre data-type="code"><code>' + escHtml(codeBuf.join('\n')) + '</code></pre>');
        codeBuf = [];
        inCode = false;
      } else { inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(escHtml(line)); continue; }

    if (/^---+$/.test(line.trim())) { blocks.push('<hr data-type="hr" />'); continue; }

    const h1 = line.match(/^# (.+)$/);    if (h1) { blocks.push('<h1 data-type="h1">' + inlineMd(h1[1]) + '</h1>'); continue; }
    const h2 = line.match(/^## (.+)$/);   if (h2) { blocks.push('<h2 data-type="h2">' + inlineMd(h2[1]) + '</h2>'); continue; }
    const h3 = line.match(/^### (.+)$/);  if (h3) { blocks.push('<h3 data-type="h3">' + inlineMd(h3[1]) + '</h3>'); continue; }
    const h4 = line.match(/^#### (.+)$/); if (h4) { blocks.push('<h4 data-type="h4">' + inlineMd(h4[1]) + '</h4>'); continue; }

    const qm = line.match(/^> (.+)$/);
    if (qm) { blocks.push('<blockquote data-type="blockquote">' + inlineMd(qm[1]) + '</blockquote>'); continue; }

    const tm = line.match(/^- \[([ xX])\] (.+)$/);
    if (tm) {
      const chk = tm[1] !== ' ' ? ' checked' : '';
      blocks.push('<div class="md-task" data-type="task"><input type="checkbox"' + chk + ' disabled /><span>' + inlineMd(tm[2]) + '</span></div>');
      continue;
    }
    const ulm = line.match(/^- (.+)$/);
    if (ulm) { blocks.push('<div data-type="ul">• ' + inlineMd(ulm[1]) + '</div>'); continue; }
    const olm = line.match(/^\d+\. (.+)$/);
    if (olm) { blocks.push('<div data-type="ol">' + inlineMd(line) + '</div>'); continue; }

    if (line.trim() === '') { blocks.push('<div data-type="p"><br></div>'); continue; }

    // table row
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue;
      const cells = line.split('|').filter(c => c.trim() !== '');
      blocks.push('<div data-type="table-row">' + cells.map(c => '<span class="md-cell">' + inlineMd(c.trim()) + '</span>').join('') + '</div>');
      continue;
    }

    blocks.push('<div data-type="p">' + inlineMd(line) + '</div>');
  }
  if (inCode) blocks.push('<pre data-type="code"><code>' + escHtml(codeBuf.join('\n')) + '</code></pre>');
  return blocks.join('');
}

/* ═══════════════════════════════════════════════════════════
   DOM → Markdown
   ═══════════════════════════════════════════════════════════ */

function walkInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const inner = Array.from(el.childNodes).map(walkInline).join('');
  switch (tag) {
    case 'strong': case 'b': return '**' + inner + '**';
    case 'em': case 'i': return '*' + inner + '*';
    case 'del': case 's': return '~~' + inner + '~~';
    case 'code': return '`' + inner + '`';
    case 'a': return '[' + inner + '](' + (el as HTMLAnchorElement).getAttribute('href') + ')';
    case 'img': return '![' + (el.getAttribute('alt') || '') + '](' + (el.getAttribute('src') || '') + ')';
    case 'br': return '';
    case 'span':
      if (el.classList.contains('wiki-link')) {
        const wiki = el.getAttribute('data-wiki') || el.textContent || '';
        return '[[' + wiki + ']]';
      }
      return inner;
    default: return inner;
  }
}

function domToMarkdown(root: HTMLElement): string {
  const parts: string[] = [];
  for (const child of Array.from(root.children)) {
    const tag = child.tagName.toLowerCase();
    const dtype = child.getAttribute('data-type') || tag;
    const isEditing = child.getAttribute('data-editing') === 'true';

    if (isEditing) {
      // Raw text editing mode — text IS the markdown
      parts.push(child.textContent === '\n' || child.textContent === '' ? '' : (child.textContent || ''));
      continue;
    }

    switch (dtype) {
      case 'h1': parts.push('# ' + walkInline(child)); break;
      case 'h2': parts.push('## ' + walkInline(child)); break;
      case 'h3': parts.push('### ' + walkInline(child)); break;
      case 'h4': parts.push('#### ' + walkInline(child)); break;
      case 'blockquote': parts.push('> ' + walkInline(child)); break;
      case 'code': parts.push('```\n' + (child.textContent || '') + '\n```'); break;
      case 'hr': parts.push('---'); break;
      case 'ul': {
        const inner = walkInline(child);
        const cleaned = inner.replace(/^•\s*/, '');
        parts.push('- ' + cleaned);
        break;
      }
      case 'ol': {
        const inner = walkInline(child);
        const cleaned = inner.replace(/^\d+\.\s*/, '');
        parts.push('1. ' + cleaned);
        break;
      }
      case 'task': {
        const cb = child.querySelector('input');
        const span = child.querySelector('span');
        const checked = cb && (cb as HTMLInputElement).checked ? 'x' : ' ';
        parts.push('- [' + checked + '] ' + (span ? walkInline(span) : ''));
        break;
      }
      case 'table-row': {
        const cells = Array.from(child.querySelectorAll('.md-cell'));
        parts.push('| ' + cells.map(c => (c.textContent || '').trim()).join(' | ') + ' |');
        break;
      }
      case 'p':
      default: {
        const text = child.textContent || '';
        parts.push(text === '\n' || text === '' ? '' : walkInline(child));
        break;
      }
    }
  }
  let md = parts.join('\n');
  md = md.replace(/\n{3,}/g, '\n\n');
  return md;
}

/* ═══════════════════════════════════════════════════════════
   Block type detection for immediate CSS feedback
   ═══════════════════════════════════════════════════════════ */

function detectBlockType(text: string): string {
  if (text.startsWith('#### ')) return 'h4';
  if (text.startsWith('### ')) return 'h3';
  if (text.startsWith('## ')) return 'h2';
  if (text.startsWith('# ')) return 'h1';
  if (text.startsWith('> ')) return 'blockquote';
  if (text.startsWith('- [ ] ') || text.startsWith('- [x] ') || text.startsWith('- [X] ')) return 'task';
  if (text.startsWith('- ')) return 'ul';
  if (/^\d+\. /.test(text)) return 'ol';
  if (text === '---' || text === '***') return 'hr';
  if (text.startsWith('```')) return 'code';
  return 'p';
}

/* ═══════════════════════════════════════════════════════════
   LiveEditor Component
   ═══════════════════════════════════════════════════════════ */

const LiveEditor = forwardRef<EditorHandle, LiveEditorProps>(({ content, onChange, availableFiles, onOpenFile }, ref) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternal = useRef(false);
  const onChangeRef = useRef(onChange);
  const contentRef = useRef(content);
  const rerenderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  onChangeRef.current = onChange;
  contentRef.current = content;

  /* ── Autocomplete state ── */
  const [acVisible, setAcVisible] = useState(false);
  const [acQuery, setAcQuery] = useState('');
  const [acActive, setAcActive] = useState(0);
  const [acPos, setAcPos] = useState({ top: 0, left: 0 });
  const wikiStartNode = useRef<Text | null>(null);
  const wikiStartOffset = useRef(0);

  const suggestions = useMemo(() => {
    const files = availableFiles || [];
    if (!acQuery) return files.slice(0, 15);
    const q = acQuery.toLowerCase();
    return files.filter(f => f.toLowerCase().includes(q)).slice(0, 15);
  }, [availableFiles, acQuery]);

  /* ── Cursor helpers ── */
  const saveCursor = useCallback((): { blockIdx: number; offset: number; blockText: string } | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorRef.current) return null;
    const range = sel.getRangeAt(0);
    let node: Node | null = range.startContainer;
    while (node && node.parentNode !== editorRef.current) node = node.parentNode;
    if (!node) return null;
    const blockIdx = Array.from(editorRef.current.children).indexOf(node as Element);
    if (blockIdx === -1) return null;
    const pre = document.createRange();
    pre.selectNodeContents(node as Node);
    pre.setEnd(range.startContainer, range.startOffset);
    return { blockIdx, offset: pre.toString().length, blockText: (node as Element).textContent || '' };
  }, []);

  const restoreCursor = useCallback((info: { blockIdx: number; offset: number; blockText: string } | null) => {
    if (!info || !editorRef.current) return;
    const block = editorRef.current.children[info.blockIdx] as HTMLElement | undefined;
    if (!block) return;
    // Adjust offset: rendered text may be shorter (prefix removed like "# ")
    const newText = block.textContent || '';
    let off = info.offset;
    const diff = info.blockText.length - newText.length;
    if (diff > 0 && off > newText.length) off = Math.max(0, off - diff);
    off = Math.min(off, newText.length);
    // Walk text nodes to place cursor
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let pos = 0;
    while (walker.nextNode()) {
      const tn = walker.currentNode as Text;
      if (pos + tn.length >= off) {
        const sel = window.getSelection();
        if (sel) { const r = document.createRange(); r.setStart(tn, off - pos); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
        return;
      }
      pos += tn.length;
    }
    // Fallback: end of block
    const sel = window.getSelection();
    if (sel) { const r = document.createRange(); r.selectNodeContents(block); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
  }, []);



  /* ── Immediate block-type update (no innerHTML change) ── */
  const updateCurrentBlockType = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorRef.current) return;
    let node: Node | null = sel.anchorNode;
    while (node && node.parentNode !== editorRef.current) node = node.parentNode;
    if (!node || !(node instanceof HTMLElement)) return;
    const text = node.textContent || '';
    node.setAttribute('data-type', detectBlockType(text));
  }, []);

  /* ── Debounced block re-render: render markdown syntax while typing ── */
  const rerenderCurrentBlock = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorRef.current) return;
    let node: Node | null = sel.anchorNode;
    while (node && node.parentNode !== editorRef.current) node = node.parentNode;
    if (!node || !(node instanceof HTMLElement)) return;

    const text = node.textContent || '';
    const dtype = detectBlockType(text);

    // Skip re-rendering for code blocks, tables, hr — they need special handling
    if (dtype === 'code' || dtype === 'table-row' || dtype === 'hr') return;

    // Skip if block is already rendered (has inner HTML elements)
    const hasFormatting = node.querySelector('strong, em, del, code, a, img, .wiki-link, span[style]');
    if (dtype === 'p' && !hasFormatting) return; // plain paragraph with no formatting — skip

    // Get raw markdown text
    let rawText = text;
    // Strip block prefix based on current type for inline rendering
    const prevType = node.getAttribute('data-type') || 'p';
    if (prevType === 'h1' && rawText.startsWith('# ')) rawText = rawText.substring(2);
    else if (prevType === 'h2' && rawText.startsWith('## ')) rawText = rawText.substring(3);
    else if (prevType === 'h3' && rawText.startsWith('### ')) rawText = rawText.substring(4);
    else if (prevType === 'h4' && rawText.startsWith('#### ')) rawText = rawText.substring(5);
    else if (prevType === 'blockquote' && rawText.startsWith('> ')) rawText = rawText.substring(2);
    else if (prevType === 'ul') {
      rawText = rawText.replace(/^[-•]\s*/, '');
    }
    else if (prevType === 'ol') {
      rawText = rawText.replace(/^\d+\.\s*/, '');
    }
    else if (prevType === 'task') {
      rawText = rawText.replace(/^- \[[ xX]\]\s*/, '');
    }

    // Determine the new element type based on current data-type
    const tagMap: Record<string, string> = {
      h1: 'H1', h2: 'H2', h3: 'H3', h4: 'H4', blockquote: 'BLOCKQUOTE',
    };
    const newTag = tagMap[dtype];

    // Save cursor before re-render
    const cursorInfo = saveCursor();

    if (newTag) {
      // Heading or blockquote: re-render with proper tag + inline formatting
      if (node.tagName !== newTag) {
        const newEl = document.createElement(newTag);
        newEl.setAttribute('data-type', dtype);
        newEl.innerHTML = inlineMd(rawText);
        node.replaceWith(newEl);
        node = newEl;
      } else {
        // Same tag — just re-render inline formatting
        (node as HTMLElement).innerHTML = inlineMd(rawText);
      }
    } else if (dtype === 'ul') {
      (node as HTMLElement).innerHTML = '• ' + inlineMd(rawText);
    } else if (dtype === 'ol') {
      const m = text.match(/^(\d+\.)\s/);
      const num = m ? m[1] : '1.';
      (node as HTMLElement).innerHTML = num + ' ' + inlineMd(rawText);
    } else if (dtype === 'task') {
      const checked = text.match(/^- \[([ xX])\]/);
      const chk = checked && checked[1] !== ' ' ? ' checked' : '';
      (node as HTMLElement).innerHTML = '<input type="checkbox"' + chk + ' disabled /><span>' + inlineMd(rawText) + '</span>';
    } else {
      // Paragraph: render inline formatting
      (node as HTMLElement).innerHTML = inlineMd(text);
    }

    // Restore cursor
    if (cursorInfo) restoreCursor(cursorInfo);
  }, [saveCursor, restoreCursor]);

  const scheduleRerender = useCallback(() => {
    if (rerenderTimer.current) clearTimeout(rerenderTimer.current);
    rerenderTimer.current = setTimeout(() => {
      rerenderCurrentBlock();
    }, 600);
  }, [rerenderCurrentBlock]);

  /* ── EditorHandle for toolbar ── */
  useImperativeHandle(ref, () => ({
    getView: () => null,
    wrapSelection(before: string, after: string) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !editorRef.current) return;
      const text = sel.toString();
      if (!text) return;
      // Use native commands for best undo support
      if (before === '**' && after === '**') { document.execCommand('bold'); }
      else if (before === '*' && after === '*') { document.execCommand('italic'); }
      else if (before === '~~' && after === '~~') { document.execCommand('strikeThrough'); }
      else if (before === '\n```\n' && after === '\n```\n') {
        // Code block: wrap selection in <pre><code>
        const r = sel.getRangeAt(0);
        const selected = r.toString();
        r.deleteContents();
        const pre = document.createElement('pre');
        pre.setAttribute('data-type', 'code');
        const code = document.createElement('code');
        code.textContent = selected;
        pre.appendChild(code);
        r.insertNode(pre);
      }
      else {
        // Generic wrap (inline code, etc.)
        const r = sel.getRangeAt(0);
        const frag = document.createDocumentFragment();
        frag.appendChild(document.createTextNode(before));
        frag.appendChild(r.extractContents());
        frag.appendChild(document.createTextNode(after));
        r.insertNode(frag);
        r.collapse(false);
      }
      isInternal.current = true;
      onChangeRef.current(domToMarkdown(editorRef.current));
    },
    prependLine(prefix: string) {
      if (!editorRef.current) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      let node: Node | null = sel.anchorNode;
      while (node && node.parentNode !== editorRef.current) node = node.parentNode;
      if (!node || !(node instanceof HTMLElement)) return;
      // Get cleaned text (remove existing markdown prefixes)
      const text = node.textContent || '';
      const cleaned = text.replace(/^#{1,4}\s*/, '').replace(/^>\s*/, '').replace(/^[-•]\s*/, '').replace(/^\d+\.\s*/, '').replace(/^- \[[ xX]\]\s*/, '');
      // Map prefix to HTML element type
      const tagMap: Record<string, string> = {
        '# ': 'H1', '## ': 'H2', '### ': 'H3', '#### ': 'H4',
        '> ': 'BLOCKQUOTE',
      };
      const newTag = tagMap[prefix];
      const isList = prefix === '- ' || prefix === '1. ' || prefix === '- [ ] ';
      if (newTag) {
        // Replace the block element with the right heading/quote type
        const newEl = document.createElement(newTag);
        newEl.setAttribute('data-type', detectBlockType(prefix + cleaned));
        newEl.innerHTML = inlineMd(cleaned);
        node.replaceWith(newEl);
        const ns = window.getSelection();
        if (ns) { const r = document.createRange(); r.selectNodeContents(newEl); r.collapse(false); ns.removeAllRanges(); ns.addRange(r); }
      } else if (isList) {
        const newEl = document.createElement('div');
        newEl.setAttribute('data-type', detectBlockType(prefix + cleaned));
        if (prefix === '- ') {
          newEl.innerHTML = '• ' + inlineMd(cleaned);
        } else if (prefix === '- [ ] ') {
          newEl.innerHTML = '<input type="checkbox" disabled /><span>' + inlineMd(cleaned) + '</span>';
        } else {
          newEl.textContent = prefix + cleaned;
        }
        node.replaceWith(newEl);
        const ns = window.getSelection();
        if (ns) { const r = document.createRange(); r.selectNodeContents(newEl); r.collapse(false); ns.removeAllRanges(); ns.addRange(r); }
      }
      isInternal.current = true;
      onChangeRef.current(domToMarkdown(editorRef.current));
    },
    insertAtCursor(text: string) {
      document.execCommand('insertText', false, text);
      if (editorRef.current) { isInternal.current = true; onChangeRef.current(domToMarkdown(editorRef.current)); }
    },
    getSelection: () => { const sel = window.getSelection(); return sel ? sel.toString() : ''; },
    replaceSelection(text: string) {
      document.execCommand('insertText', false, text);
      if (editorRef.current) { isInternal.current = true; onChangeRef.current(domToMarkdown(editorRef.current)); }
    },
  }));

  /* ── Render on mount + external content changes ── */
  useEffect(() => {
    if (!editorRef.current) return;
    if (isInternal.current) { isInternal.current = false; return; }
    editorRef.current.innerHTML = renderFullHtml(content);
  }, [content]);

  /* ── Close autocomplete on outside click ── */
  useEffect(() => {
    const handler = () => { /* noop — autocomplete closes on Escape/selection */ };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  /* ── Wiki-link detection ── */
  const checkWikiLink = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE) { setAcVisible(false); return; }
    const text = node.textContent || '';
    const offset = sel.anchorOffset;
    // Find [[ before cursor
    const before = text.substring(0, offset);
    const lastOpen = before.lastIndexOf('[[');
    if (lastOpen === -1 || before.lastIndexOf(']]') > lastOpen) { setAcVisible(false); return; }
    // Check there's no ]] between [[ and cursor
    const between = before.substring(lastOpen + 2);
    if (between.includes(']]')) { setAcVisible(false); return; }
    // Extract query
    const query = between;
    setAcQuery(query);
    setAcActive(0);
    wikiStartNode.current = node as Text;
    wikiStartOffset.current = lastOpen;
    // Position popup at cursor
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const editorRect = editorRef.current?.getBoundingClientRect();
    if (editorRect) {
      setAcPos({ top: rect.bottom - editorRect.top + 4, left: rect.left - editorRect.left });
    }
    setAcVisible(true);
  }, []);

  const selectSuggestion = useCallback((idx: number) => {
    const file = suggestions[idx];
    if (!file) return;
    const node = wikiStartNode.current;
    if (!node || !editorRef.current) return;
    const text = node.textContent || '';
    const offset = sel_anchorOffset();
    const before = text.substring(0, wikiStartOffset.current);
    const after = text.substring(offset);
    const linkText = '[[' + file + ']]';
    node.textContent = before + linkText + after;
    // Render [[file]] as a blue link in the block
    let block: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement;
    while (block && block.parentElement !== editorRef.current) block = block.parentElement;
    if (block) {
      // Use inlineMd to re-render the whole block with wiki-links
      const rawText = block.textContent || '';
      const dtype = block.getAttribute('data-type') || 'p';
      // Strip block prefix for re-rendering
      let inlineContent = rawText;
      if (dtype === 'h1' && inlineContent.startsWith('# ')) inlineContent = inlineContent.substring(2);
      else if (dtype === 'h2' && inlineContent.startsWith('## ')) inlineContent = inlineContent.substring(3);
      else if (dtype === 'h3' && inlineContent.startsWith('### ')) inlineContent = inlineContent.substring(4);

      block.innerHTML = inlineMd(inlineContent);
      // Place cursor after the link span
      const linkSpan = block.querySelector('.wiki-link:last-of-type');
      if (linkSpan) {
        const s = window.getSelection();
        if (s) { const r = document.createRange(); r.setStartAfter(linkSpan); r.collapse(true); s.removeAllRanges(); s.addRange(r); }
      }
    }
    isInternal.current = true;
    onChangeRef.current(domToMarkdown(editorRef.current));
    setAcVisible(false);
  }, [suggestions]);

  function sel_anchorOffset(): number {
    const sel = window.getSelection();
    return sel ? sel.anchorOffset : 0;
  }

  /* ── Input handler ── */
  const handleInput = useCallback(() => {
    if (!editorRef.current) return;
    isInternal.current = true;
    const md = domToMarkdown(editorRef.current);
    onChangeRef.current(md);
    updateCurrentBlockType();
    checkWikiLink();
    // Schedule debounced block re-render for inline formatting
    scheduleRerender();
  }, [updateCurrentBlockType, checkWikiLink, scheduleRerender]);

  /* ── Keydown handler ── */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Autocomplete navigation
    if (acVisible) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcActive(i => Math.min(i + 1, suggestions.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAcActive(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectSuggestion(acActive); return; }
      if (e.key === 'Escape') { e.preventDefault(); setAcVisible(false); return; }
    }
    // Enter: let browser create new div, then update data-type + immediate re-render of previous block
    if (e.key === 'Enter' && !e.shiftKey) {
      // Immediately re-render the current block before Enter creates a new one
      rerenderCurrentBlock();
      setTimeout(() => {
        if (editorRef.current) {
          isInternal.current = true;
          onChangeRef.current(domToMarkdown(editorRef.current));
          updateCurrentBlockType();
        }
      }, 0);
    }
    // Tab: indent
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    }
  }, [acVisible, suggestions, acActive, selectSuggestion, updateCurrentBlockType, rerenderCurrentBlock]);

  /* ── Paste: plain text ── */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text) document.execCommand('insertText', false, text);
  }, []);

  /* ── Click: navigate wiki-links or just let browser handle editing ── */
  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // If clicked on a wiki-link, open the file
    if (target.classList.contains('wiki-link') || target.closest('.wiki-link')) {
      const link = target.closest('.wiki-link') as HTMLElement || target;
      const wiki = link.getAttribute('data-wiki');
      if (wiki && onOpenFile) {
        onOpenFile(wiki + '.md');
      }
      return;
    }
    // Otherwise, let the browser handle editing the rendered content directly.
  }, [onOpenFile]);

  return (
    <div className="live-editor-wrapper">
      <div
        ref={editorRef}
        className="live-editor"
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onClick={handleClick}
        spellCheck={true}
      />
      {acVisible && suggestions.length > 0 && (
        <div className="wiki-autocomplete" style={{ top: acPos.top, left: acPos.left }}>
          {suggestions.map((file, i) => (
            <div
              key={file}
              className={'ac-item' + (i === acActive ? ' active' : '')}
              onMouseDown={(e) => { e.preventDefault(); selectSuggestion(i); }}
            >
              <FileIcon size={14} className="ac-icon" />
              <span className="ac-name">{file}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

/* Extract raw markdown from a rendered block element */
function getRawFromRendered(el: HTMLElement, dtype: string): string {
  const text = el.textContent || '';
  switch (dtype) {
    case 'h1': return '# ' + text;
    case 'h2': return '## ' + text;
    case 'h3': return '### ' + text;
    case 'h4': return '#### ' + text;
    case 'blockquote': return '> ' + text;
    case 'ul': {
      const cleaned = text.replace(/^•\s*/, '');
      return '- ' + cleaned;
    }
    case 'ol': {
      const cleaned = text.replace(/^\d+\.\s*/, '');
      return '1. ' + cleaned;
    }
    case 'task': {
      const cb = el.querySelector('input');
      const span = el.querySelector('span');
      const checked = cb && (cb as HTMLInputElement).checked ? 'x' : ' ';
      return '- [' + checked + '] ' + (span?.textContent || '');
    }
    case 'code': return '```\n' + text + '\n```';
    case 'hr': return '---';
    default: return text;
  }
}

LiveEditor.displayName = 'LiveEditor';

export default LiveEditor;
