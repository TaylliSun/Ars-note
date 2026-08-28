export interface ExcalidrawDocumentData {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseExcalidrawDocument(content: string): ExcalidrawDocumentData {
  try {
    const parsed = JSON.parse(content || '{}');
    return {
      elements: Array.isArray(parsed?.elements) ? parsed.elements : [],
      appState: isRecord(parsed?.appState) ? parsed.appState : {},
      files: isRecord(parsed?.files) ? parsed.files : {},
    };
  } catch {
    return { elements: [], appState: {}, files: {} };
  }
}

export function serializeExcalidrawDocument(
  elements: readonly unknown[],
  state: Record<string, unknown> | null | undefined,
  files: Record<string, unknown> | null | undefined,
): string {
  const appState = state || {};
  return JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'ars-note',
    elements: Array.isArray(elements) ? elements : [],
    appState: {
      viewBackgroundColor: appState.viewBackgroundColor,
      theme: appState.theme,
      currentItemStrokeColor: appState.currentItemStrokeColor,
      currentItemBackgroundColor: appState.currentItemBackgroundColor,
      currentItemFillStyle: appState.currentItemFillStyle,
      currentItemFontFamily: appState.currentItemFontFamily,
      currentItemStrokeWidth: appState.currentItemStrokeWidth,
      currentItemRoughness: appState.currentItemRoughness,
      currentItemOpacity: appState.currentItemOpacity,
      scrollX: appState.scrollX,
      scrollY: appState.scrollY,
      zoom: appState.zoom,
      gridSize: appState.gridSize,
    },
    files: files && isRecord(files) ? files : {},
  });
}

export function haveExcalidrawElementsChanged(
  initialElements: readonly unknown[],
  currentElements: readonly unknown[],
): boolean {
  try {
    return JSON.stringify(initialElements) !== JSON.stringify(currentElements);
  } catch {
    return true;
  }
}
