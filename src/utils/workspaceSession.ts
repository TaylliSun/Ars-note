export const WORKSPACE_SESSION_VERSION = 2 as const;

export type WorkspaceRightTab =
  | 'preview'
  | 'search'
  | 'templates'
  | 'backlinks'
  | 'graph'
  | 'backup'
  | 'settings'
  | 'game'
  | 'ai'
  | 'outline';

export type WorkspaceViewMode = 'source' | 'preview' | 'split' | 'live';

export type WorkspaceSession = {
  version: typeof WORKSPACE_SESSION_VERSION;
  appVersion: string;
  currentFile: string;
  openTabs: string[];
  pinnedTabs: string[];
  navigationHistory: string[];
  navigationIndex: number;
  rightTab: WorkspaceRightTab;
  viewMode: WorkspaceViewMode;
  showCenterGraph: boolean;
  showCenterAI: boolean;
  showCenterSchedule: boolean;
  focusMode: boolean;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  sidebarWidth: number;
  rightPanelWidth: number;
  updatedAt: string;
};

export type WorkspaceSessionBounds = {
  sidebarDefault: number;
  sidebarMin: number;
  sidebarMax: number;
  rightPanelDefault: number;
  rightPanelMin: number;
  rightPanelMax: number;
};

export type WorkspaceSessionMigration = {
  session: WorkspaceSession;
  sourceVersion: number;
  migrated: boolean;
};

const RIGHT_TABS: WorkspaceRightTab[] = [
  'preview', 'search', 'templates', 'backlinks', 'graph',
  'backup', 'settings', 'game', 'ai', 'outline',
];
const VIEW_MODES: WorkspaceViewMode[] = ['source', 'preview', 'split', 'live'];

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function cleanPathList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const key = item.replace(/\\/g, '/').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result.slice(-limit);
}

/**
 * Converts persisted v1 layouts into the current shape and sanitizes corrupted
 * values. Future session versions are ignored so an older client cannot damage
 * settings written by a newer build.
 */
export function migrateWorkspaceSession(
  value: unknown,
  bounds: WorkspaceSessionBounds,
  appVersion: string,
): WorkspaceSessionMigration | null {
  if (!value || typeof value !== 'object') return null;
  const parsed = value as Record<string, unknown>;
  const sourceVersion = Number.isFinite(Number(parsed.version)) ? Math.max(1, Math.floor(Number(parsed.version))) : 1;
  if (sourceVersion > WORKSPACE_SESSION_VERSION) return null;

  const openTabs = cleanPathList(parsed.openTabs, 16);
  const openTabKeys = new Set(openTabs.map((item) => item.replace(/\\/g, '/').toLowerCase()));
  const pinnedTabs = cleanPathList(parsed.pinnedTabs, 16)
    .filter((item) => openTabKeys.has(item.replace(/\\/g, '/').toLowerCase()));
  const navigationHistory = cleanPathList(parsed.navigationHistory, 80);
  const requestedNavigationIndex = Number.isFinite(Number(parsed.navigationIndex))
    ? Math.floor(Number(parsed.navigationIndex))
    : -1;
  const navigationIndex = navigationHistory.length === 0
    ? -1
    : Math.max(0, Math.min(navigationHistory.length - 1, requestedNavigationIndex));

  // Only one center workspace can be active. Older builds could persist several.
  const showCenterSchedule = Boolean(parsed.showCenterSchedule);
  const showCenterAI = !showCenterSchedule && Boolean(parsed.showCenterAI);
  const showCenterGraph = !showCenterSchedule && !showCenterAI && Boolean(parsed.showCenterGraph);

  const rightTab = typeof parsed.rightTab === 'string' && RIGHT_TABS.includes(parsed.rightTab as WorkspaceRightTab)
    ? parsed.rightTab as WorkspaceRightTab
    : 'game';
  const viewMode = typeof parsed.viewMode === 'string' && VIEW_MODES.includes(parsed.viewMode as WorkspaceViewMode)
    ? parsed.viewMode as WorkspaceViewMode
    : 'live';

  const session: WorkspaceSession = {
    version: WORKSPACE_SESSION_VERSION,
    appVersion: typeof parsed.appVersion === 'string' && parsed.appVersion.trim() ? parsed.appVersion : appVersion,
    currentFile: typeof parsed.currentFile === 'string' ? parsed.currentFile : '',
    openTabs,
    pinnedTabs,
    navigationHistory,
    navigationIndex,
    rightTab,
    viewMode,
    showCenterGraph,
    showCenterAI,
    showCenterSchedule,
    focusMode: Boolean(parsed.focusMode),
    leftCollapsed: Boolean(parsed.leftCollapsed),
    rightCollapsed: Boolean(parsed.rightCollapsed),
    sidebarWidth: clampNumber(parsed.sidebarWidth, bounds.sidebarMin, bounds.sidebarMax, bounds.sidebarDefault),
    rightPanelWidth: clampNumber(parsed.rightPanelWidth, bounds.rightPanelMin, bounds.rightPanelMax, bounds.rightPanelDefault),
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
  };

  return {
    session,
    sourceVersion,
    migrated: sourceVersion !== WORKSPACE_SESSION_VERSION || parsed.appVersion !== session.appVersion,
  };
}
