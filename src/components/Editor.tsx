import React, { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, rectangularSelection, highlightSpecialChars } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
} from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, autocompletion } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { wikiLinkSource, tagCompletionSource } from '../utils/wikiLinkCompletion';
import { createLivePreviewExtension, slashCommandSource } from '../utils/livePreview';
import { normalizeCompressedMarkdownTablesInText } from '../utils/markdownTableRepair';

interface EditorProps {
  documentKey?: string;
  content: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  vaultPath?: string;
  vaultFiles?: string[];
  vaultTags?: string[];
  livePreview?: boolean;
  readOnly?: boolean;
  onReady?: (documentKey: string) => void;
}

export interface EditorHandle {
  getView: () => EditorView | null;
  wrapSelection: (before: string, after: string) => void;
  prependLine: (prefix: string) => void;
  insertAtCursor: (text: string) => void;
  getSelection: () => string;
  replaceSelection: (text: string) => void;
}

const LARGE_DOCUMENT_PROGRESSIVE_THRESHOLD = 120_000;
const LARGE_DOCUMENT_CHUNK_SIZE = 40_000;

function getProgressiveChunkEnd(content: string, from: number): number {
  const target = Math.min(content.length, from + LARGE_DOCUMENT_CHUNK_SIZE);
  if (target >= content.length) return content.length;
  const nextLineBreak = content.indexOf('\n', target);
  return nextLineBreak >= 0 ? nextLineBreak + 1 : content.length;
}

const Editor = forwardRef<EditorHandle, EditorProps>(({ documentKey, content, onChange, onSave, vaultPath, vaultFiles, vaultTags, livePreview, readOnly, onReady }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const extensionsRef = useRef<any[]>([]);
  const documentKeyRef = useRef(documentKey);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onReadyRef = useRef(onReady);
  const isExternalUpdate = useRef(false);
  const progressiveTaskRef = useRef(0);
  const progressiveDocumentKeyRef = useRef<string | null>(null);
  const progressiveTargetContentRef = useRef<string | null>(null);

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onReadyRef.current = onReady;

  const finishProgressiveLoad = useCallback((view?: EditorView) => {
    if (progressiveTaskRef.current) window.clearTimeout(progressiveTaskRef.current);
    progressiveTaskRef.current = 0;
    progressiveDocumentKeyRef.current = null;
    progressiveTargetContentRef.current = null;
    isExternalUpdate.current = false;
    const activeView = view || viewRef.current;
    activeView?.dom.removeAttribute('aria-busy');
    activeView?.contentDOM.removeAttribute('inert');
    containerRef.current?.classList.remove('editor-loading-large-document');
    if (containerRef.current) delete containerRef.current.dataset.loadingLabel;
  }, []);

  const startProgressiveLoad = useCallback((view: EditorView, fullContent: string, key: string, loadedTo: number) => {
    finishProgressiveLoad(view);
    if (loadedTo >= fullContent.length) {
      onReadyRef.current?.(key);
      return;
    }

    progressiveDocumentKeyRef.current = key;
    progressiveTargetContentRef.current = fullContent;
    isExternalUpdate.current = true;
    view.dom.setAttribute('aria-busy', 'true');
    view.contentDOM.setAttribute('inert', '');
    view.contentDOM.blur();
    containerRef.current?.classList.add('editor-loading-large-document');
    if (containerRef.current) containerRef.current.dataset.loadingLabel = '正在载入完整文档...';

    const startedAt = performance.now();
    const appendNextChunk = () => {
      progressiveTaskRef.current = 0;
      if (viewRef.current !== view || progressiveTargetContentRef.current !== fullContent) return;

      const from = view.state.doc.length;
      const to = getProgressiveChunkEnd(fullContent, from);
      const chunkStartedAt = performance.now();
      view.dispatch({ changes: { from, insert: fullContent.slice(from, to) } });
      const chunkFinishedAt = performance.now();
      if (chunkFinishedAt - chunkStartedAt >= 8) {
        try {
          performance.measure('ars-note:editor-document-chunk', {
            start: chunkStartedAt,
            end: chunkFinishedAt,
            detail: { from, to, documentLength: fullContent.length },
          });
        } catch { /* Performance diagnostics are optional. */ }
      }

      if (to >= fullContent.length) {
        try {
          performance.measure('ars-note:editor-progressive-load', {
            start: startedAt,
            end: performance.now(),
            detail: { documentLength: fullContent.length },
          });
        } catch { /* Performance diagnostics are optional. */ }
        finishProgressiveLoad(view);
        view.requestMeasure();
        onReadyRef.current?.(key);
        return;
      }
      progressiveTaskRef.current = window.setTimeout(appendNextChunk, 0);
    };

    progressiveTaskRef.current = window.setTimeout(appendNextChunk, 0);
  }, [finishProgressiveLoad]);

  useImperativeHandle(ref, () => ({
    getView: () => viewRef.current,
    wrapSelection: (before: string, after: string) => {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      const selected = view.state.sliceDoc(from, to);
      view.dispatch({
        changes: { from, to, insert: before + selected + after },
        selection: { anchor: from + before.length, head: from + before.length + selected.length },
      });
      view.focus();
    },
    prependLine: (prefix: string) => {
      const view = viewRef.current;
      if (!view) return;
      const { from } = view.state.selection.main;
      const line = view.state.doc.lineAt(from);
      view.dispatch({
        changes: { from: line.from, to: line.from, insert: prefix },
        selection: { anchor: line.from + prefix.length },
      });
      view.focus();
    },
    insertAtCursor: (text: string) => {
      const view = viewRef.current;
      if (!view) return;
      const { from } = view.state.selection.main;
      view.dispatch({
        changes: { from, insert: text },
        selection: { anchor: from + text.length },
      });
      view.focus();
    },
    getSelection: () => {
      const view = viewRef.current;
      if (!view) return '';
      const { from, to } = view.state.selection.main;
      return view.state.sliceDoc(from, to);
    },
    replaceSelection: (text: string) => {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      });
      view.focus();
    },
  }));

  useEffect(() => {
    if (!containerRef.current) return;

    const extraKeymaps: any[] = [];
    if (onSave) {
      extraKeymaps.push({
        key: 'Mod-s',
        run: () => { onSaveRef.current?.(); return true; },
        preventDefault: true,
      });
    }

    /* Build extensions list */
    const extensions: any[] = [
      EditorState.readOnly.of(!!readOnly),
      EditorView.editable.of(!readOnly),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      rectangularSelection(),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      EditorView.lineWrapping,
      /* In live preview mode, skip defaultHighlightStyle and oneDark —
         they apply syntax highlighting that conflicts with our decorations.
         We provide our own styling via inline style attributes instead. */
      ...(livePreview ? [] : [
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        oneDark,
      ]),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      autocompletion({
        override: [
          wikiLinkSource(vaultFiles || []),
          tagCompletionSource(vaultTags || []),
          ...(livePreview ? [slashCommandSource] : []),
        ],
        icons: false,
        activateOnTyping: true,
      }),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        indentWithTab,
        ...extraKeymaps,
      ]),
      EditorView.updateListener.of((update) => {
        if (containerRef.current) {
          const selectionLine = update.state.doc.lineAt(update.state.selection.main.head).number;
          containerRef.current.dataset.selectionLine = String(selectionLine);
        }
        if (update.docChanged && !isExternalUpdate.current && !readOnly) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
      /* Base theme — different for live preview vs source mode */
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': {
          overflow: 'auto',
          ...(livePreview
            ? { fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, 'Noto Sans SC', sans-serif" }
            : { fontFamily: 'inherit' }),
        },
        '.cm-content': {
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
        },
        '.cm-line': {
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
        },
        '.cm-cursor': { borderLeftColor: '#7c5cff', borderLeftWidth: '2px' },
        '.cm-selectionBackground': { backgroundColor: 'rgba(124, 92, 255, 0.2) !important' },
        '.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(124, 92, 255, 0.3) !important' },
        '.cm-activeLine': { backgroundColor: 'rgba(124, 92, 255, 0.04)' },
        '.cm-gutters': { borderRight: '1px solid #1e2436' },
        /* Dark background for the editor */
        '&.cm-editor': { backgroundColor: '#0f1117', color: '#d1d5db' },
      }),
    ];

    /* Live preview mode: add decorations, hide gutters, wider padding */
    if (livePreview) {
      extensions.push(...createLivePreviewExtension());
      extensions.push(EditorView.theme({
        '.cm-gutters': { display: 'none' },
        '.cm-content': {
          padding: '24px 16px',
          caretColor: '#7c5cff',
          maxWidth: '800px',
          margin: '0 auto',
          fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, 'Noto Sans SC', sans-serif",
        },
        '.cm-line': {
          padding: '2px 24px',
          lineHeight: '1.75',
          color: '#d1d5db',
        },
        '.cm-activeLine': {
          backgroundColor: 'rgba(124, 92, 255, 0.05) !important',
          borderRadius: '3px',
        },
        '.cm-activeLineGutter': { backgroundColor: 'transparent !important' },
        '.cm-focused .cm-cursor': {
          borderLeftColor: '#7c5cff',
          borderLeftWidth: '2px',
        },
        '.cm-focused .cm-selectionBackground': {
          backgroundColor: 'rgba(124, 92, 255, 0.25) !important',
        },
        /* Smooth scrollbar */
        '.cm-scroller': {
          overflow: 'auto',
          scrollbarWidth: 'thin',
          scrollbarColor: '#313952 transparent',
        },
      }));
    } else {
      extensions.push(syntaxHighlighting(defaultHighlightStyle, { fallback: true }));
      extensions.push(oneDark);
      extensions.push(lineNumbers());
      extensions.push(highlightActiveLine());
    }

    /* Image paste/drop handler */
    extensions.push(EditorView.domEventHandlers({
      paste(event) {
        const pastedText = event.clipboardData?.getData('text/plain') || '';
        if (pastedText && !readOnly) {
          const repairedText = normalizeCompressedMarkdownTablesInText(pastedText);
          if (repairedText !== pastedText) {
            event.preventDefault();
            const view = viewRef.current;
            if (!view) return true;
            const { from, to } = view.state.selection.main;
            view.dispatch({
              changes: { from, to, insert: repairedText },
              selection: { anchor: from + repairedText.length },
            });
            return true;
          }
        }

        const files = event.clipboardData?.files;
        if (!files || files.length === 0) return false;
        for (const file of files) {
          if (!file.type.startsWith('image/')) continue;
          event.preventDefault();
          const view = viewRef.current;
          if (!view) return true;
          const reader = new FileReader();
          reader.onload = () => {
            const arr = new Uint8Array(reader.result as ArrayBuffer);
            const ts = Date.now().toString(36);
            const ext = file.type.split('/').pop() || 'png';
            const imgName = `img_${ts}.${ext}`;
            const api = (window as any).arsnote;
            if (api && api.saveImageToVault) {
              api.saveImageToVault(vaultPath || '', 'assets/' + imgName, Array.from(arr)).then(() => {
                const pos = view.state.selection.main.head;
                view.dispatch({ changes: { from: pos, insert: `![${imgName}](assets/${imgName})` } });
              }).catch(() => {
                const pos = view.state.selection.main.head;
                view.dispatch({ changes: { from: pos, insert: `![image](assets/${imgName})` } });
              });
            }
          };
          reader.readAsArrayBuffer(file);
          return true;
        }
        return false;
      },
      drop(event) {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        for (const file of files) {
          if (!file.type.startsWith('image/')) continue;
          event.preventDefault();
          const view = viewRef.current;
          if (!view) return true;
          const reader = new FileReader();
          reader.onload = () => {
            const arr = new Uint8Array(reader.result as ArrayBuffer);
            const ts = Date.now().toString(36);
            const ext = file.type.split('/').pop() || 'png';
            const imgName = `img_${ts}.${ext}`;
            const api = (window as any).arsnote;
            if (api && api.saveImageToVault) {
              api.saveImageToVault(vaultPath || '', 'assets/' + imgName, Array.from(arr)).then(() => {
                const pos = view.state.selection.main.head;
                view.dispatch({ changes: { from: pos, insert: `![${imgName}](assets/${imgName})\n` } });
              });
            }
          };
          reader.readAsArrayBuffer(file);
          return true;
        }
        return false;
      },
    }));

    extensionsRef.current = extensions;
    documentKeyRef.current = documentKey;

    const initialChunkEnd = content.length > LARGE_DOCUMENT_PROGRESSIVE_THRESHOLD
      ? getProgressiveChunkEnd(content, 0)
      : content.length;
    const initialContent = content.slice(0, initialChunkEnd);
    const stateStartedAt = performance.now();
    const state = EditorState.create({ doc: initialContent, extensions });
    const stateFinishedAt = performance.now();

    const viewStartedAt = performance.now();
    const view = new EditorView({ state, parent: containerRef.current });
    const viewFinishedAt = performance.now();
    if (stateFinishedAt - stateStartedAt >= 8) {
      try {
        performance.measure('ars-note:editor-state-create', { start: stateStartedAt, end: stateFinishedAt });
      } catch { /* Performance diagnostics are optional. */ }
    }
    if (viewFinishedAt - viewStartedAt >= 8) {
      try {
        performance.measure('ars-note:editor-view-mount', { start: viewStartedAt, end: viewFinishedAt });
      } catch { /* Performance diagnostics are optional. */ }
    }
    viewRef.current = view;
    startProgressiveLoad(view, content, documentKey || '', initialChunkEnd);
    containerRef.current.dataset.selectionLine = String(view.state.doc.lineAt(view.state.selection.main.head).number);

    let measureFrame = 0;
    const scheduleMeasure = () => {
      if (measureFrame) cancelAnimationFrame(measureFrame);
      measureFrame = requestAnimationFrame(() => {
        measureFrame = 0;
        view.requestMeasure();
      });
    };

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleMeasure)
      : null;
    resizeObserver?.observe(containerRef.current);
    resizeObserver?.observe(view.dom);
    if (containerRef.current.parentElement) {
      resizeObserver?.observe(containerRef.current.parentElement);
    }
    window.addEventListener('resize', scheduleMeasure);
    scheduleMeasure();
    requestAnimationFrame(() => requestAnimationFrame(scheduleMeasure));

    return () => {
      finishProgressiveLoad(view);
      if (measureFrame) cancelAnimationFrame(measureFrame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      view.destroy();
      viewRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishProgressiveLoad, livePreview, readOnly, startProgressiveLoad]);

  /* Sync content from external changes */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (progressiveDocumentKeyRef.current === (documentKey || '')
      && progressiveTargetContentRef.current === content) return;
    finishProgressiveLoad(view);
    const currentDoc = view.state.doc.toString();
    if (documentKeyRef.current !== documentKey) {
      isExternalUpdate.current = true;
      const switchStartedAt = performance.now();
      const initialChunkEnd = content.length > LARGE_DOCUMENT_PROGRESSIVE_THRESHOLD
        ? getProgressiveChunkEnd(content, 0)
        : content.length;
      const nextState = EditorState.create({
        doc: content.slice(0, initialChunkEnd),
        extensions: extensionsRef.current,
      });
      view.setState(nextState);
      const switchFinishedAt = performance.now();
      documentKeyRef.current = documentKey;
      if (switchFinishedAt - switchStartedAt >= 8) {
        try {
          performance.measure('ars-note:editor-document-switch', {
            start: switchStartedAt,
            end: switchFinishedAt,
            detail: { previousLength: currentDoc.length, nextLength: content.length },
          });
        } catch { /* Performance diagnostics are optional. */ }
      }
      isExternalUpdate.current = false;
      startProgressiveLoad(view, content, documentKey || '', initialChunkEnd);
      return;
    }
    if (currentDoc !== content) {
      isExternalUpdate.current = true;
      const updateStartedAt = performance.now();
      view.dispatch({ changes: { from: 0, to: currentDoc.length, insert: content } });
      const updateFinishedAt = performance.now();
      if (updateFinishedAt - updateStartedAt >= 8) {
        try {
          performance.measure('ars-note:editor-external-update', {
            start: updateStartedAt,
            end: updateFinishedAt,
            detail: { previousLength: currentDoc.length, nextLength: content.length },
          });
        } catch { /* Performance diagnostics are optional. */ }
      }
      isExternalUpdate.current = false;
    }
  }, [content, documentKey, finishProgressiveLoad, startProgressiveLoad]);

  return <div ref={containerRef} className={(livePreview ? 'editor-container live-preview-active' : 'editor-container') + (readOnly ? ' editor-readonly' : '')} />;
});

Editor.displayName = 'Editor';

export default Editor;
