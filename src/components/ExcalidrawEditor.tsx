/* ── Excalidraw Wireframe Editor (v2.0.0) ── */
/* Clean integration — zero CSS overrides, let Excalidraw handle everything */

import React, { useEffect, useState, useRef, useCallback, Component, lazy, Suspense } from 'react';

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
  vaultPath?: string;
  fileName?: string;
}

/* ── Component ── */
export default function ExcalidrawEditor({ content, onChange, onSave, fileName }: Props) {
  const apiRef = useRef<any>(null);
  const debounceRef = useRef<any>(null);
  const firstRender = useRef(true);
  const [error, setError] = useState<string | null>(null);

  /* Build initialData — memoized once */
  const initialDataRef = useRef<any>(null);
  if (initialDataRef.current === null) {
    let elements: any[] = [];
    let appState: any = {};
    if (content && content.trim()) {
      try {
        const parsed = JSON.parse(content);
        elements = parsed.elements || [];
        appState = parsed.appState || {};
      } catch { /* empty file */ }
    }
    initialDataRef.current = { elements, appState };
  }

  /* onChange: just debounce-save, NO element patching */
  const handleChange = useCallback((elements: readonly any[], state: any) => {
    /* Skip the very first onChange (initial render sync) */
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        onChange(JSON.stringify({
          type: 'excalidraw',
          version: 2,
          elements: elements as any[],
          appState: {
            viewBackgroundColor: state.viewBackgroundColor,
            theme: state.theme,
            currentItemStrokeColor: state.currentItemStrokeColor,
            currentItemBackgroundColor: state.currentItemBackgroundColor,
          },
          files: {},
        }));
      } catch {}
    }, 250);
  }, [onChange]);

  /* Ctrl+S */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); onSave?.(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onSave]);

  /* Cleanup */
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

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
                  viewBackgroundColor: '#1e1e2e',
                  currentItemStrokeColor: '#e2e8f0',
                  currentItemBackgroundColor: 'transparent',
                  currentItemFillStyle: 'hachure',
                  currentItemFontFamily: 1,
                  currentItemStrokeWidth: 2,
                  currentItemRoughness: 1,
                  currentItemOpacity: 100,
                },
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
