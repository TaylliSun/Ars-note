/* ── Excalidraw Wireframe Editor (v2.0.0) ── */
/* Clean integration — zero CSS overrides, let Excalidraw handle everything */

import React, { useEffect, useState, useRef, useCallback, Component, lazy, Suspense } from 'react';
import {
  haveExcalidrawElementsChanged,
  parseExcalidrawDocument,
  serializeExcalidrawDocument,
} from '../utils/excalidrawPersistence';

/* ── Error Boundary ── */
class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(e: any) { return { error: e?.message || String(e) }; }
  render() {
    if (this.state.error) return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#b0b8cc', flexDirection: 'column', gap: 12, padding: 40 }}>
        <div style={{ fontSize: 32 }}>⚠</div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Wireframe editor error</div>
        <div style={{ fontSize: 12, color: '#9ca3af', maxWidth: 400, textAlign: 'center' }}>{this.state.error}</div>
      </div>
    );
    return this.props.children;
  }
}

/* Lazy load Excalidraw — heavy library, don't block initial render */
const Excalidraw = lazy(() => import('@excalidraw/excalidraw').then(m => ({ default: m.Excalidraw })));

/* ── Types ── */
interface Props {
  content: string;
  onChange: (json: string) => void;
  onSave?: () => void;
  onFlush?: (json: string) => void | Promise<void>;
  vaultPath?: string;
  fileName?: string;
}

/* ── Component ── */
export default function ExcalidrawEditor({ content, onChange, onSave, onFlush, fileName }: Props) {
  const apiRef = useRef<any>(null);
  const debounceRef = useRef<any>(null);
  const pendingSceneRef = useRef<string | null>(null);
  const firstRender = useRef(true);
  const [error, setError] = useState<string | null>(null);

  /* Build initialData — memoized once */
  const initialDataRef = useRef<any>(null);
  if (initialDataRef.current === null) {
    initialDataRef.current = parseExcalidrawDocument(content);
  }

  const commitPendingScene = useCallback(() => {
    const pending = pendingSceneRef.current;
    if (!pending) return;
    pendingSceneRef.current = null;
    onChange(pending);
  }, [onChange]);

  /* Keep rapid pointer updates cheap, but never discard the final scene. */
  const handleChange = useCallback((elements: readonly any[], state: any, files: Record<string, unknown>) => {
    if (firstRender.current) {
      firstRender.current = false;
      if (!haveExcalidrawElementsChanged(initialDataRef.current.elements, elements)) return;
    }

    pendingSceneRef.current = serializeExcalidrawDocument(elements, state, files);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      commitPendingScene();
    }, 250);
  }, [commitPendingScene]);

  /* Ctrl+S */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = null;
        const pending = pendingSceneRef.current;
        if (pending) {
          pendingSceneRef.current = null;
          onChange(pending);
          void onFlush?.(pending);
        } else {
          onSave?.();
        }
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onChange, onFlush, onSave]);

  /* Cleanup */
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const pending = pendingSceneRef.current;
    pendingSceneRef.current = null;
    if (pending) void onFlush?.(pending);
  }, [onFlush]);

  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#b0b8cc', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 32 }}>⚠</div>
      <div style={{ fontSize: 12, color: '#9ca3af' }}>{error}</div>
    </div>
  );

  return (
    <div className="excalidraw-host">
      <div className="editor-titlebar">
        <span className="editor-titlebar-name">
          <span style={{ color: '#e8590c', marginRight: 6 }}>▣</span>
          {fileName || 'Wireframe'}
        </span>
      </div>
      <div className="excalidraw-canvas-area">
        <ErrorBoundary>
          <Suspense fallback={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', flexDirection: 'column', gap: 12 }}>
              <div className="ai-thinking-dots"><span>.</span><span>.</span><span>.</span></div>
              <div>Loading wireframe editor...</div>
            </div>
          }>
            <Excalidraw
              initialData={{
                elements: initialDataRef.current.elements,
                appState: {
                  ...initialDataRef.current.appState,
                  viewBackgroundColor: initialDataRef.current.appState.viewBackgroundColor || '#1e1e2e',
                  currentItemStrokeColor: initialDataRef.current.appState.currentItemStrokeColor || '#e2e8f0',
                  currentItemBackgroundColor: initialDataRef.current.appState.currentItemBackgroundColor || 'transparent',
                  currentItemFillStyle: initialDataRef.current.appState.currentItemFillStyle || 'hachure',
                  currentItemFontFamily: initialDataRef.current.appState.currentItemFontFamily || 1,
                  currentItemStrokeWidth: initialDataRef.current.appState.currentItemStrokeWidth || 2,
                  currentItemRoughness: initialDataRef.current.appState.currentItemRoughness ?? 1,
                  currentItemOpacity: initialDataRef.current.appState.currentItemOpacity ?? 100,
                },
                files: initialDataRef.current.files,
              }}
              onChange={handleChange}
              excalidrawAPI={(api: any) => { apiRef.current = api; }}
              theme="dark"
              gridModeEnabled={false}
              viewModeEnabled={false}
              langCode="zh"
              isCollaborating={false}
              renderTopRightUI={() => null}
              validateEmbeddable={false}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
