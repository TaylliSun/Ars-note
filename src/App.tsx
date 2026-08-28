import React, { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from 'react';
import type { FileNode, VaultConfig, VaultOpenResult, SearchResult, VaultIndex, OutgoingLinkInfo, CandidateFile, GroupedBacklink, TagNoteInfo, GraphData, GraphSummary, VaultManifest, BackupSummary, BackupListItem, BackupFileListResult, BackupFileRestoreSummary, BackupPruneSummary, RestoreSummary, BackupVerifyResult, SyncConfig, RemoteBackupItem, CloudUploadSummary, CloudDownloadSummary, DownloadedBackupItem, ProviderValidationResult, S3RuntimeCredentials, S3CredentialStatus, S3ConnectionTestResult, SyncCompareResult, SyncPreviewResult, SelfHostedRuntimeCredentials, SelfHostedCredentialStatus, GameWorkspaceSummary, GameWorkspaceEntry, GameDocType, GameWorkspaceDashboard, ArshisIntegrationConfig, AIProviderConfig, AIChatMessage, AIContextMode, AIControlMode, AIResponse, AIRuntimeStatus, AIConnectionTestResult, AIContextUsage, AITeamScheduleContext } from './types';
import { buildGraphData, computeGraphSummary } from './utils/graphBuilder';
import { resolveWikiLink } from './utils/markdownLinks';
import { scanGameWorkspace } from './utils/gameWorkspaceScanner';
import { buildGameWorkspaceReportMarkdown } from './utils/gameWorkspaceReport';
import { buildArshisGameContext, buildArshisContextMarkdown, buildArshisContextJson, getArshisContextBaseName } from './utils/arshisContextBuilder';
import { AI_CONTEXT_TOKEN_LIMIT, buildAIChatRequest, QUICK_PROMPTS, estimateAIContextUsageFromMessages } from './utils/aiClient';
import { extractTeamTasksFromAIResponse, extractTeamTasksFromMarkdownContent, type ExtractedTeamTask } from './utils/aiTaskExtraction';
import { importTasksToTeamSchedule, type TeamScheduleImportResult } from './utils/teamScheduleImport';
import { buildAITeamScheduleContext } from './utils/teamScheduleContext';
import { mapSyncProviderToCloudId, validateProviderConfig as validateProviderConfigFn } from './utils/cloudBackupProvider';
import { formatBytes } from './utils/vaultManifest';
import { buildExportDocument as buildMarkdownExportDocument, renderMarkdown as renderMarkdownHtml } from './utils/markdownRenderer';
import { getAIChatScrollToken } from './utils/aiChatPresentation';
import { createCoalescedAsyncRunner } from './utils/coalescedAsyncRunner';
import {
  createLiveSyncRendererHint,
  isLiveSyncRendererHintForVault,
  isSameLiveSyncTarget,
} from './utils/liveSyncVaultScope';
import {
  WORKSPACE_SESSION_VERSION,
  migrateWorkspaceSession,
  type WorkspaceSession,
} from './utils/workspaceSession';
import { useI18n } from './i18n';
import TitleBar from './components/TitleBar';
import type { EditorHandle } from './components/Editor';
import WelcomeScreen from './components/WelcomeScreen';
import ConfirmDialog from './components/ConfirmDialog';
import NewItemDialog from './components/NewItemDialog';
import PromptDialog from './components/PromptDialog';
import ErrorBoundary from './components/ErrorBoundary';
import AIChatMessageList, { useAIChatAutoScroll } from './components/AIChatMessageList';
import AIWritingQualityCard from './components/AIWritingQualityCard';
import type { QuickCommand, QuickFileMeta } from './components/QuickSwitcher';
import { BotIcon, GraphIcon, FileIcon, ChevronRightIcon, SyncIcon, CloseIcon, MenuIcon, LocateIcon, CopyIcon, ClockIcon } from './components/icons/ArsIcons';
import { APP_VERSION, APP_VERSION_LABEL } from './appVersion';

const GraphView = React.lazy(() => import('./components/GraphView'));
const RightPanel = React.lazy(() => import('./components/RightPanel'));
const Sidebar = React.lazy(() => import('./components/Sidebar'));
const Editor = React.lazy(() => import('./components/Editor'));
const StatusBar = React.lazy(() => import('./components/StatusBar'));
const EditorToolbar = React.lazy(() => import('./components/EditorToolbar'));
const TemplateDialog = React.lazy(() => import('./components/TemplateDialog'));
const QuickSwitcher = React.lazy(() => import('./components/QuickSwitcher'));
const ShortcutGuide = React.lazy(() => import('./components/ShortcutGuide'));
const AIContextMeter = React.lazy(() => import('./components/AIContextMeter'));
const ExcalidrawEditor = React.lazy(() => import('./components/ExcalidrawEditor'));
const CanvasEditor = React.lazy(() => import('./components/CanvasEditor'));
const AIFivePillarPanel = React.lazy(() => import('./components/AIFivePillarPanel'));
const TeamSchedulePanel = React.lazy(() => import('./components/TeamSchedulePanel'));
const BalanceLab = React.lazy(() => import('./components/BalanceLab'));

const LazyPanelFallback: React.FC<{ label?: string }> = ({ label = '正在加载工作区...' }) => (
  <div className="lazy-panel-fallback" role="status">{label}</div>
);

const api = window.arsnote;

type RightTab = 'preview' | 'search' | 'templates' | 'backlinks' | 'graph' | 'backup' | 'settings' | 'game' | 'ai' | 'outline';
type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';
type NoticeTone = 'info' | 'success' | 'warning' | 'error';
type AppNotice = {
  id: string;
  message: string;
  tone: NoticeTone;
};
const RIGHT_TABS: RightTab[] = ['preview', 'search', 'templates', 'backlinks', 'graph', 'backup', 'settings', 'game', 'ai', 'outline'];
const SIDEBAR_WIDTH_DEFAULT = 286;
const SIDEBAR_WIDTH_MIN = 220;
const SIDEBAR_WIDTH_MAX = 420;
const RIGHT_PANEL_WIDTH_DEFAULT = 380;
const RIGHT_PANEL_WIDTH_MIN = 300;
const RIGHT_PANEL_WIDTH_MAX = 560;
type WorkspaceSnapshot = WorkspaceSession & {
  id: string;
  name: string;
};

function isValidFileName(name: string): string | null {
  if (!name || !name.trim()) return 'nameEmpty';
  const segments = name.trim().split('/');
  for (const seg of segments) {
    const s = seg.trim();
    if (!s) return 'nameEmpty';
    if (/[<>:"|?*\\]/.test(s)) return 'nameIllegalChars';
    if (s.endsWith('.')) return 'nameIllegalChars';
  }
  return null;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function orderTabsByPinned(tabs: string[], pinnedTabs: string[]): string[] {
  const pinnedKeys = new Set(pinnedTabs.map((path) => normalizePath(path).toLowerCase()));
  return [
    ...tabs.filter((path) => pinnedKeys.has(normalizePath(path).toLowerCase())),
    ...tabs.filter((path) => !pinnedKeys.has(normalizePath(path).toLowerCase())),
  ];
}

function getWorkspaceSessionKey(vaultPath: string): string {
  return `ars-note.workspace:${normalizePath(vaultPath).toLowerCase()}`;
}

function getWorkspaceSnapshotsKey(vaultPath: string): string {
  return `ars-note.workspace-snapshots:${normalizePath(vaultPath).toLowerCase()}`;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function parseWorkspaceSession(parsed: any): WorkspaceSession | null {
  return migrateWorkspaceSession(parsed, {
    sidebarDefault: SIDEBAR_WIDTH_DEFAULT,
    sidebarMin: SIDEBAR_WIDTH_MIN,
    sidebarMax: SIDEBAR_WIDTH_MAX,
    rightPanelDefault: RIGHT_PANEL_WIDTH_DEFAULT,
    rightPanelMin: RIGHT_PANEL_WIDTH_MIN,
    rightPanelMax: RIGHT_PANEL_WIDTH_MAX,
  }, APP_VERSION)?.session || null;
}

function readWorkspaceSession(vaultPath: string): WorkspaceSession | null {
  try {
    const raw = localStorage.getItem(getWorkspaceSessionKey(vaultPath));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const migration = migrateWorkspaceSession(parsed, {
      sidebarDefault: SIDEBAR_WIDTH_DEFAULT,
      sidebarMin: SIDEBAR_WIDTH_MIN,
      sidebarMax: SIDEBAR_WIDTH_MAX,
      rightPanelDefault: RIGHT_PANEL_WIDTH_DEFAULT,
      rightPanelMin: RIGHT_PANEL_WIDTH_MIN,
      rightPanelMax: RIGHT_PANEL_WIDTH_MAX,
    }, APP_VERSION);
    if (!migration) return null;
    if (migration.migrated) {
      localStorage.setItem(getWorkspaceSessionKey(vaultPath), JSON.stringify(migration.session));
    }
    return migration.session;
  } catch {
    return null;
  }
}

function readWorkspaceSnapshots(vaultPath: string): WorkspaceSnapshot[] {
  try {
    const raw = localStorage.getItem(getWorkspaceSnapshotsKey(vaultPath));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item: any): WorkspaceSnapshot[] => {
      const session = parseWorkspaceSession(item);
      if (!session || typeof item.id !== 'string' || typeof item.name !== 'string' || !item.name.trim()) return [];
      return [{ ...session, id: item.id, name: item.name.trim() }];
    }).slice(0, 12);
  } catch {
    return [];
  }
}

function collectOpenableFilePaths(nodes: FileNode[], out = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.isDir) {
      collectOpenableFilePaths(node.children || [], out);
    } else {
      out.add(normalizePath(node.path).toLowerCase());
    }
  }
  return out;
}

function replaceMovedPath(path: string, fromPath: string, toPath: string): string {
  const normalizedPath = normalizePath(path);
  const normalizedFrom = normalizePath(fromPath).replace(/\/+$/, '');
  const normalizedTo = normalizePath(toPath).replace(/\/+$/, '');
  if (normalizedPath.toLowerCase() === normalizedFrom.toLowerCase()) return toPath;
  if (normalizedPath.toLowerCase().startsWith(normalizedFrom.toLowerCase() + '/')) {
    return normalizedTo + normalizedPath.slice(normalizedFrom.length);
  }
  return path;
}

function findFirstMarkdownPath(nodes: FileNode[]): string | null {
  for (const node of nodes) {
    if (!node.isDir && node.name.toLowerCase().endsWith('.md')) return node.path;
    if (node.isDir && node.children?.length) {
      const childPath = findFirstMarkdownPath(node.children);
      if (childPath) return childPath;
    }
  }
  return null;
}

const EMPTY_INDEX: VaultIndex = { notes: {}, updatedAt: '' };

function resolveVaultRelativeFile(vaultPath: string, relativePath: string): string {
  const cleanVault = vaultPath.replace(/[\\/]+$/, '');
  const separator = cleanVault.includes('\\') ? '\\' : '/';
  return cleanVault + separator + relativePath.replace(/\//g, separator);
}

const MAX_DISPLAYED_AI_HISTORY_MESSAGES = 80;

function normalizeDisplayAIChatMessages(messages: any[], maxMessages = MAX_DISPLAYED_AI_HISTORY_MESSAGES): AIChatMessage[] {
  const chatMsgs: AIChatMessage[] = [];
  const source = Array.isArray(messages) && messages.length > maxMessages
    ? messages.slice(-maxMessages)
    : (messages || []);
  for (const m of source) {
    if (m?.role === 'user' || m?.role === 'assistant' || m?.role === 'system') {
      chatMsgs.push({
        role: m.role,
        content: m.content || '',
        createdAt: m.createdAt || m.savedAt || new Date().toISOString(),
        toolCalls: m.toolCalls || m.tool_calls || undefined,
      });
    }
  }
  return chatMsgs;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debouncedValue;
}

function flattenAIContextFiles(nodes: FileNode[], prefix = ''): string[] {
  const files: string[] = [];
  for (const node of nodes) {
    const rel = prefix ? `${prefix}/${node.name}` : node.name;
    if (node.isDir) {
      files.push(...flattenAIContextFiles(node.children || [], rel));
      continue;
    }
    if (/\.(md|canvas|excalidraw)$/i.test(node.name)) files.push(rel);
  }
  return files;
}

function tokenizeAIReferenceText(text: string): string[] {
  const normalized = text.toLowerCase();
  const tokens = new Set<string>();
  for (const part of normalized.split(/[\s,.;:!?'"()[\]{}<>|\\/`~，。；：！？“”‘’（）【】、]+/)) {
    if (part.length >= 2) tokens.add(part);
  }
  for (const match of normalized.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    tokens.add(match);
  }
  return Array.from(tokens).filter(token => ![
    '这个', '那个', '一下', '还是', '用我', '方便', '完整', '生成', '写', '做', '的',
    'the', 'and', 'for', 'with', 'this', 'that', 'please',
  ].includes(token));
}

function scoreAIReferencedFile(prompt: string, relPath: string, currentRelPath: string): number {
  const q = prompt.toLowerCase();
  const rel = normalizePath(relPath).toLowerCase();
  const base = rel.split('/').pop() || rel;
  let score = 0;

  if (currentRelPath && rel === normalizePath(currentRelPath).toLowerCase()) {
    if (/当前|这个|这里|继续|根据|用|this|current/.test(q)) score += 16;
  }
  if (/ui|界面|原型|prototype|wireframe|mockup|figma/.test(q)) {
    if (/ui|界面|原型|prototype|wireframe|mockup|figma/.test(rel)) score += 24;
    if (rel.endsWith('.excalidraw')) score += 14;
  }
  if (/画布|白板|canvas|canva/.test(q) && rel.endsWith('.canvas')) score += 18;
  if (/需求|美术|美工|视觉|技术|开发|art|tech|spec|requirements/.test(q) && /\.(md|excalidraw|canvas)$/i.test(rel)) score += 8;

  for (const token of tokenizeAIReferenceText(q)) {
    if (rel.includes(token)) score += 8;
    if (base.includes(token)) score += 4;
  }

  return score;
}

function wantsWrittenSpec(prompt: string): boolean {
  return /写|整理|文档|说明|需求|美术需求|美工需求|技术需求|开发需求|规格|完整点|方便我看|spec|requirements/i.test(prompt);
}

function explicitlyWantsCanvas(prompt: string): boolean {
  return /canvas|canva|画布|白板|流程图|思维导图|脑图|看板|关系图|拓扑图|flow\s*chart|mind\s*map|kanban/i.test(prompt);
}

function shouldInferAIReferencedFiles(prompt: string): boolean {
  const text = String(prompt || '');
  const explicitPath = /(?:[A-Za-z]:[\\/][^\r\n]+|(?:[\w\u4e00-\u9fff ._-]+[\\/])+[\w\u4e00-\u9fff ._-]+\.(?:md|json|canvas|excalidraw)|[\w\u4e00-\u9fff ._-]+\.(?:md|json|canvas|excalidraw))/i.test(text);
  const naturalReference = /(?:这个|那个|当前|刚才|上面|打开的|现有的).{0,12}(?:文件|文档|笔记|原型|画布|白板|界面|UI|canvas|wireframe|prototype)/i.test(text);
  const namedVisualSource = /(?:UI\s*原型|界面原型|wireframe|mockup|prototype|excalidraw|canvas|画布|白板)/i.test(text);
  return explicitPath || naturalReference || namedVisualSource;
}

async function buildAIReferencedFileContext(params: {
  prompt: string;
  vaultPath: string;
  currentFile: string;
  currentContent: string;
  fileTree: FileNode[];
}): Promise<string> {
  const { prompt, vaultPath, currentFile, currentContent, fileTree } = params;
  if (!shouldInferAIReferencedFiles(prompt)) return '';
  const currentRelPath = currentFile
    ? normalizePath(currentFile.replace(vaultPath, '').replace(/^[\\/]/, ''))
    : '';
  const allFiles = flattenAIContextFiles(fileTree);
  const scored = allFiles
    .filter(relativePath => normalizePath(relativePath) !== currentRelPath)
    .map(relativePath => ({ relativePath, score: scoreAIReferencedFile(prompt, relativePath, currentRelPath) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  if (scored.length === 0) return '';

  const sections: string[] = [];
  sections.push('=== Referenced vault files inferred from the user request ===');
  sections.push('The user may refer to files naturally, such as "UI原型那个" or "那个画布". Use these candidate files before asking for a path.');
  if (wantsWrittenSpec(prompt) && !explicitlyWantsCanvas(prompt)) {
    sections.push('Important output intent: the user is asking for a written requirements/spec document. Prefer polished Markdown. Do not create a canvas unless explicitly requested.');
  }
  if (/ui|界面|原型|prototype|wireframe|mockup/i.test(prompt) && wantsWrittenSpec(prompt)) {
    sections.push('If a prototype/wireframe file is listed below, treat it as the source of truth. Extract screen structure, components, interactions, visual states, art deliverables, engineering requirements, and acceptance criteria from it.');
  }
  if (explicitlyWantsCanvas(prompt)) {
    sections.push('If creating a canvas, make it a professional production board: title, legend, grouped lanes, substantial cards, clear dependencies, and no one-card placeholder output.');
  }

  for (const item of scored) {
    try {
      const fullPath = resolveVaultRelativeFile(vaultPath, item.relativePath);
      const raw = normalizePath(item.relativePath) === currentRelPath ? currentContent : await api.readFile(fullPath);
      const truncated = raw.length > 8000 ? `${raw.slice(0, 8000)}\n...(truncated)` : raw;
      sections.push(`--- Candidate file: ${item.relativePath} (score ${item.score}) ---`);
      sections.push(truncated.trim() ? truncated : '(file is empty)');
    } catch {
      sections.push(`--- Candidate file: ${item.relativePath} ---`);
      sections.push('(failed to read file)');
    }
  }

  return sections.join('\n');
}

/** Parse wiki-links from raw content, returning target + alias pairs */
function parseWikiLinksWithAliases(content: string): { target: string; alias: string }[] {
  const results: { target: string; alias: string }[] = [];
  const lines = content.split('\n');
  let inCodeBlock = false;
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
    if (inCodeBlock) continue;
    const stripped = line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
    const regex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
    let m: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((m = regex.exec(stripped)) !== null) {
      let target = m[1].trim();
      const hashIdx = target.indexOf('#');
      if (hashIdx > 0) target = target.substring(0, hashIdx).trim();
      if (target.length > 0) {
        results.push({ target, alias: m[2]?.trim() || '' });
      }
    }
  }
  return results;
}

type DocumentOpeningEventDetail = {
  path: string;
  label: string;
  requestId: number;
  immediate: boolean;
};

const DOCUMENT_OPENING_START_EVENT = 'ars-note:document-opening-start';
const DOCUMENT_OPENING_FINISH_EVENT = 'ars-note:document-opening-finish';

function startDocumentOpening(detail: DocumentOpeningEventDetail) {
  window.dispatchEvent(new CustomEvent(DOCUMENT_OPENING_START_EVENT, { detail }));
}

function finishDocumentOpeningEvent(filePath: string) {
  window.dispatchEvent(new CustomEvent(DOCUMENT_OPENING_FINISH_EVENT, { detail: { path: filePath } }));
}

const DocumentOpeningOverlay = React.memo(() => {
  const [current, setCurrent] = useState<DocumentOpeningEventDetail | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (!timerRef.current) return;
      clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    const handleStart = (event: Event) => {
      const detail = (event as CustomEvent<DocumentOpeningEventDetail>).detail;
      clearTimer();
      if (detail.immediate) {
        setCurrent(detail);
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setCurrent(detail);
      }, 90);
    };
    const handleFinish = (event: Event) => {
      const filePath = (event as CustomEvent<{ path: string }>).detail.path;
      clearTimer();
      setCurrent((value) => (
        value && normalizePath(value.path).toLowerCase() === normalizePath(filePath).toLowerCase()
          ? null
          : value
      ));
    };

    window.addEventListener(DOCUMENT_OPENING_START_EVENT, handleStart);
    window.addEventListener(DOCUMENT_OPENING_FINISH_EVENT, handleFinish);
    return () => {
      clearTimer();
      window.removeEventListener(DOCUMENT_OPENING_START_EVENT, handleStart);
      window.removeEventListener(DOCUMENT_OPENING_FINISH_EVENT, handleFinish);
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    try {
      performance.mark('ars-note:document-opening-visible', {
        detail: { path: current.path, requestId: current.requestId },
      });
    } catch { /* Performance diagnostics are optional. */ }
    const fallbackTimer = setTimeout(() => {
      setCurrent((value) => value?.requestId === current.requestId ? null : value);
    }, 8_000);
    return () => clearTimeout(fallbackTimer);
  }, [current]);

  if (!current) return null;
  return (
    <div className="document-opening-overlay" role="status" aria-live="polite" aria-label={`正在打开 ${current.label}`}>
      <div className="document-opening-card">
        <span className="document-opening-spinner" aria-hidden="true" />
        <span className="document-opening-copy">
          <strong>正在打开 {current.label}</strong>
          <span>准备编辑器与实时预览</span>
        </span>
        <span className="document-opening-progress" aria-hidden="true"><i /></span>
      </div>
    </div>
  );
});

const App: React.FC = () => {
  const { t, language } = useI18n();

  /* ── Core state ── */
  const [vault, setVault] = useState<VaultConfig | null>(null);
  const [vaultPath, setVaultPath] = useState<string>('');
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [currentFile, setCurrentFile] = useState<string>('');
  const [bookmarkedFiles, setBookmarkedFiles] = useState<string[]>([]);
  const [currentContent, setCurrentContent] = useState<string>('');
  const documentOpenRequestRef = useRef(0);
  const deferredCurrentContent = useDeferredValue(currentContent);
  const [savedContent, setSavedContent] = useState<string>('');
  const currentFileStateRef = useRef(currentFile);
  const currentContentStateRef = useRef(currentContent);
  const savedContentStateRef = useRef(savedContent);
  currentFileStateRef.current = currentFile;
  currentContentStateRef.current = currentContent;
  savedContentStateRef.current = savedContent;
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [rightTab, setRightTab] = useState<RightTab>('game');
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsModalSection, setSettingsModalSection] = useState('home');
  const [showCenterGraph, setShowCenterGraph] = useState(false);
  const [showCenterAI, setShowCenterAI] = useState(false);
  const [showCenterSchedule, setShowCenterSchedule] = useState(false);
  const [showBalanceLab, setShowBalanceLab] = useState(false);
  const [aiPanelTab, setAiPanelTab] = useState<'chat' | 'pillars'>('chat');
  const editorRef = useRef<EditorHandle>(null);
  const [viewMode, setViewMode] = useState<'source' | 'preview' | 'split' | 'live'>('live');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [creationMsg, setCreationMsg] = useState('');
  const [notices, setNotices] = useState<AppNotice[]>([]);
  const noticeTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [lastManifest, setLastManifest] = useState<VaultManifest | null>(null);
  const [lastBackup, setLastBackup] = useState<BackupSummary | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupList, setBackupList] = useState<BackupListItem[]>([]);
  const [backupFileList, setBackupFileList] = useState<BackupFileListResult | null>(null);
  const [backupFileLoading, setBackupFileLoading] = useState(false);
  const [backupFileRestoreSummary, setBackupFileRestoreSummary] = useState<BackupFileRestoreSummary | null>(null);
  const [restoringBackupFileKey, setRestoringBackupFileKey] = useState('');
  const [restoreSummary, setRestoreSummary] = useState<RestoreSummary | null>(null);
  const [backupVerifyResult, setBackupVerifyResult] = useState<BackupVerifyResult | null>(null);
  const [verifyingBackupId, setVerifyingBackupId] = useState<string>('');
  const [deletingBackupId, setDeletingBackupId] = useState<string>('');
  const [backupRetentionLimit, setBackupRetentionLimit] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('ars-note.backup.keepLatest') || '20');
      return Number.isFinite(saved) ? Math.max(1, Math.min(200, Math.floor(saved))) : 20;
    } catch {
      return 20;
    }
  });
  const [backupPruneSummary, setBackupPruneSummary] = useState<BackupPruneSummary | null>(null);
  const [backupPruneBusy, setBackupPruneBusy] = useState(false);
  const [backupLifecycleMessage, setBackupLifecycleMessage] = useState('');
  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(null);
  const [remoteBackups, setRemoteBackups] = useState<RemoteBackupItem[]>([]);
  const [deletingRemoteBackupId, setDeletingRemoteBackupId] = useState('');
  const [cloudUploadSummary, setCloudUploadSummary] = useState<CloudUploadSummary | null>(null);
  const [cloudDownloadSummary, setCloudDownloadSummary] = useState<CloudDownloadSummary | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [downloadedBackups, setDownloadedBackups] = useState<DownloadedBackupItem[]>([]);
  const [downloadedVerifyResult, setDownloadedVerifyResult] = useState<BackupVerifyResult | null>(null);
  const [downloadedRestoreSummary, setDownloadedRestoreSummary] = useState<RestoreSummary | null>(null);
  const [downloadedBusy, setDownloadedBusy] = useState(false);
  const [providerValidation, setProviderValidation] = useState<ProviderValidationResult | null>(null);
  const [s3CredentialStatus, setS3CredentialStatus] = useState<S3CredentialStatus | null>(null);
  const [s3ConnectionTest, setS3ConnectionTest] = useState<S3ConnectionTestResult | null>(null);
  const [s3Testing, setS3Testing] = useState(false);
  const [selfHostedCredentialStatus, setSelfHostedCredentialStatus] = useState<SelfHostedCredentialStatus | null>(null);
  const [syncCompareResult, setSyncCompareResult] = useState<SyncCompareResult | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncPreview, setSyncPreview] = useState<SyncPreviewResult | null>(null);
  const [syncPreviewBusy, setSyncPreviewBusy] = useState(false);
  const [vaultIndex, setVaultIndex] = useState<VaultIndex>(EMPTY_INDEX);
  const [indexRefreshMsg, setIndexRefreshMsg] = useState('');
  const [teamWorkspaceOpening, setTeamWorkspaceOpening] = useState(false);
  const activeVaultPathRef = useRef(vaultPath);
  const indexRefreshRunnerRef = useRef<ReturnType<typeof createCoalescedAsyncRunner> | null>(null);
  const scheduleIndexRefreshRef = useRef<() => void>(() => {});
  const indexRefreshMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  activeVaultPathRef.current = vaultPath;

  const dismissNotice = useCallback((id: string) => {
    const timer = noticeTimersRef.current.get(id);
    if (timer) clearTimeout(timer);
    noticeTimersRef.current.delete(id);
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const showNotice = useCallback((message: unknown, tone: NoticeTone = 'error', duration = 4200) => {
    const text = String(message || '').trim();
    if (!text) return;
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setNotices((current) => [...current.slice(-3), { id, message: text, tone }]);
    const timer = setTimeout(() => {
      noticeTimersRef.current.delete(id);
      setNotices((current) => current.filter((notice) => notice.id !== id));
    }, duration);
    noticeTimersRef.current.set(id, timer);
  }, []);

  useEffect(() => () => {
    noticeTimersRef.current.forEach((timer) => clearTimeout(timer));
    noticeTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (creationMsg) showNotice(creationMsg, 'success', 3000);
  }, [creationMsg, showNotice]);

  /* ── Dialog state ── */
  const [showNewFile, setShowNewFile] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showNewFromTemplate, setShowNewFromTemplate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string>('');
  const [contextTarget, setContextTarget] = useState<string>('');

  /* ── Prompt dialog state ── */
  const [promptConfig, setPromptConfig] = useState<{
    title: string; message: string; defaultValue: string; placeholder: string;
    resolve: ((value: string | null) => void) | null;
  } | null>(null);

  const showPrompt = useCallback((title: string, message: string, defaultValue = '', placeholder = ''): Promise<string | null> => {
    return new Promise((resolve) => { setPromptConfig({ title, message, defaultValue, placeholder, resolve }); });
  }, []);

  const handlePromptConfirm = useCallback((value: string) => { promptConfig?.resolve?.(value); setPromptConfig(null); }, [promptConfig]);
  const handlePromptCancel = useCallback(() => { promptConfig?.resolve?.(null); setPromptConfig(null); }, [promptConfig]);

  /* ── Confirm dialog ── */
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    confirmTone?: 'primary' | 'danger';
    resolve: ((value: boolean) => void) | null;
  } | null>(null);

  /* ── AI state ── */
  const [aiConfig, setAiConfig] = useState<AIProviderConfig>({
    provider: 'openai-compatible' as any,
    baseUrl: '',
    model: '',
    hasApiKey: false,
    enabled: false,
  });
  const [aiChatMessages, setAiChatMessages] = useState<AIChatMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const debouncedAIInput = useDebouncedValue(aiInput, 240);
  const [aiContextMode, setAiContextMode] = useState<AIContextMode>('gameWorkspace');
  const [aiControlMode, setAiControlMode] = useState<AIControlMode>(() => {
    try {
      const saved = localStorage.getItem('ars-note.ai.controlMode');
      return saved === 'member' || saved === 'producer' || saved === 'readonly' ? saved : 'readonly';
    } catch {
      return 'readonly';
    }
  });
  const [centerAIToolsOpen, setCenterAIToolsOpen] = useState(false);
  const [aiContextUsage, setAiContextUsage] = useState<AIContextUsage>(() => estimateAIContextUsageFromMessages([], '', AI_CONTEXT_TOKEN_LIMIT));
  const [aiTeamScheduleContextPreview, setAiTeamScheduleContextPreview] = useState<AITeamScheduleContext | undefined>(undefined);
  const [aiSending, setAiSending] = useState(false);
  const [aiRetryPrompt, setAiRetryPrompt] = useState('');
  const activeAIRequestIdRef = useRef<string | null>(null);
  const [aiCopiedResponse, setAiCopiedResponse] = useState(false);
  const [aiHistoryList, setAiHistoryList] = useState<Array<{ file: string; date?: string; savedAt?: string; messageCount?: number }>>([]);
  const [aiShowHistory, setAiShowHistory] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<AIConnectionTestResult | null>(null);
  const [aiFormProvider, setAiFormProvider] = useState('openai-compatible');
  const [aiFormBaseUrl, setAiFormBaseUrl] = useState('');
  const [aiFormModel, setAiFormModel] = useState('gpt-4o-mini');
  const [aiFormApiKey, setAiFormApiKey] = useState('');
  const [aiLiveToolCalls, setAiLiveToolCalls] = useState<import('./types').AIToolCallRecord[]>([]);
  const centerAiMessagesRef = useRef<HTMLDivElement | null>(null);
  const centerAIChatScrollToken = getAIChatScrollToken(
    aiChatMessages,
    `${aiLiveToolCalls.length}:${aiSending ? 'sending' : 'idle'}`,
  );
  useAIChatAutoScroll(
    centerAiMessagesRef,
    showCenterAI && aiPanelTab === 'chat',
    centerAIChatScrollToken,
  );

  useEffect(() => {
    try { localStorage.setItem('ars-note.ai.controlMode', aiControlMode); } catch { /* ignore */ }
  }, [aiControlMode]);

  useEffect(() => {
    let cancelled = false;
    if (!vaultPath || aiContextMode !== 'gameWorkspace') {
      setAiTeamScheduleContextPreview(undefined);
      return () => { cancelled = true; };
    }

    buildAITeamScheduleContext(vaultPath)
      .then((context) => {
        if (!cancelled) setAiTeamScheduleContextPreview(context);
      })
      .catch(() => {
        if (!cancelled) setAiTeamScheduleContextPreview(undefined);
      });

    return () => { cancelled = true; };
  }, [aiContextMode, vaultPath]);

  const [showQuickSwitch, setShowQuickSwitch] = useState(false);
  const [quickSwitchMode, setQuickSwitchMode] = useState<'files' | 'commands'>('files');
  const [showShortcutGuide, setShowShortcutGuide] = useState(false);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [closedTabs, setClosedTabs] = useState<string[]>([]);
  const [pinnedTabs, setPinnedTabs] = useState<string[]>([]);
  const [tabContextMenu, setTabContextMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [openTabsMenu, setOpenTabsMenu] = useState<{ x: number; y: number } | null>(null);
  const [sidebarRevealRequest, setSidebarRevealRequest] = useState(0);
  const [workspaceSnapshotsOpen, setWorkspaceSnapshotsOpen] = useState(false);
  const [workspaceSnapshots, setWorkspaceSnapshots] = useState<WorkspaceSnapshot[]>([]);
  const [draggedTabPath, setDraggedTabPath] = useState('');
  const [tabDropTarget, setTabDropTarget] = useState<{ path: string; side: 'before' | 'after' } | null>(null);
  const [navigationHistory, setNavigationHistory] = useState<string[]>([]);
  const [navigationIndex, setNavigationIndex] = useState(-1);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { const saved = localStorage.getItem('arsnote-theme'); return saved === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  });
  const [focusMode, setFocusMode] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH_DEFAULT);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_WIDTH_DEFAULT);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const leftCollapsedRef = useRef(false);
  const rightCollapsedRef = useRef(false);
  const compactLeftLayoutRef = useRef(false);
  const compactRightLayoutRef = useRef(false);
  const autoLeftCollapsedRef = useRef(false);
  const autoRightCollapsedRef = useRef(false);
  const rightTabBeforeSettingsRef = useRef<RightTab>('game');
  const rightCollapsedBeforeSettingsRef = useRef(false);
  const rightCollapsedBeforeCenterAIRef = useRef(false);
  const workspaceSessionRestoreRef = useRef(false);
  const navigationHistoryRef = useRef<string[]>([]);
  const navigationIndexRef = useRef(-1);
  const mainContentRef = useRef<HTMLDivElement | null>(null);
  const tabElementRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    navigationHistoryRef.current = navigationHistory;
  }, [navigationHistory]);

  useEffect(() => {
    navigationIndexRef.current = navigationIndex;
  }, [navigationIndex]);

  useEffect(() => {
    leftCollapsedRef.current = leftCollapsed;
  }, [leftCollapsed]);

  useEffect(() => {
    rightCollapsedRef.current = rightCollapsed;
  }, [rightCollapsed]);

  useEffect(() => {
    const syncResponsiveLayout = () => {
      const compactLeft = window.innerWidth <= 920;
      const compactRight = window.innerWidth <= 1180;

      if (compactLeft && !compactLeftLayoutRef.current) {
        compactLeftLayoutRef.current = true;
        if (!leftCollapsedRef.current) {
          autoLeftCollapsedRef.current = true;
          leftCollapsedRef.current = true;
          setLeftCollapsed(true);
        }
      }

      if (!compactLeft && compactLeftLayoutRef.current) {
        compactLeftLayoutRef.current = false;
        if (autoLeftCollapsedRef.current) {
          autoLeftCollapsedRef.current = false;
          leftCollapsedRef.current = false;
          setLeftCollapsed(false);
        }
      }

      if (compactRight && !compactRightLayoutRef.current) {
        compactRightLayoutRef.current = true;
        if (!rightCollapsedRef.current) {
          autoRightCollapsedRef.current = true;
          rightCollapsedRef.current = true;
          setRightCollapsed(true);
        }
        return;
      }

      if (!compactRight && compactRightLayoutRef.current) {
        compactRightLayoutRef.current = false;
        if (autoRightCollapsedRef.current) {
          autoRightCollapsedRef.current = false;
          rightCollapsedRef.current = false;
          setRightCollapsed(false);
        }
      }
    };

    syncResponsiveLayout();
    window.addEventListener('resize', syncResponsiveLayout);
    return () => window.removeEventListener('resize', syncResponsiveLayout);
  }, []);

  const revealLeftPanel = useCallback(() => {
    autoLeftCollapsedRef.current = false;
    leftCollapsedRef.current = false;
    setLeftCollapsed(false);
  }, []);

  const toggleLeftPanel = useCallback(() => {
    autoLeftCollapsedRef.current = false;
    setLeftCollapsed(prev => {
      leftCollapsedRef.current = !prev;
      return !prev;
    });
  }, []);

  const revealRightPanel = useCallback(() => {
    autoRightCollapsedRef.current = false;
    rightCollapsedRef.current = false;
    setRightCollapsed(false);
  }, []);

  const toggleRightPanel = useCallback(() => {
    autoRightCollapsedRef.current = false;
    setRightCollapsed(prev => {
      rightCollapsedRef.current = !prev;
      return !prev;
    });
  }, []);

  const openSettingsModal = useCallback((section: string = 'home') => {
    const targetSection = typeof section === 'string' ? section : 'home';
    if (!settingsModalOpen) {
      rightTabBeforeSettingsRef.current = rightTab === 'settings' ? 'game' : rightTab;
      rightCollapsedBeforeSettingsRef.current = rightCollapsedRef.current;
    }
    setSettingsModalSection(targetSection);
    autoRightCollapsedRef.current = false;
    rightCollapsedRef.current = false;
    setRightCollapsed(false);
    setShowCenterGraph(false);
    setShowCenterAI(false);
    setShowCenterSchedule(false);
    setShowBalanceLab(false);
    setRightTab('settings');
    setSettingsModalOpen(true);
  }, [rightTab, settingsModalOpen]);

  const closeSettingsModal = useCallback(() => {
    const previousTab = rightTabBeforeSettingsRef.current === 'settings'
      ? 'game'
      : rightTabBeforeSettingsRef.current;
    const previousCollapsed = rightCollapsedBeforeSettingsRef.current;
    const compactRight = window.innerWidth <= 1180;
    const nextCollapsed = previousCollapsed || compactRight;
    autoRightCollapsedRef.current = compactRight && !previousCollapsed;
    rightCollapsedRef.current = nextCollapsed;
    setRightTab(previousTab);
    setRightCollapsed(nextCollapsed);
    setSettingsModalOpen(false);
  }, []);

  const closeCenterAI = useCallback(() => {
    const compactRight = window.innerWidth <= 1180;
    const nextCollapsed = compactRight || rightCollapsedBeforeCenterAIRef.current;
    autoRightCollapsedRef.current = compactRight && !rightCollapsedBeforeCenterAIRef.current;
    rightCollapsedRef.current = nextCollapsed;
    setRightCollapsed(nextCollapsed);
    setCenterAIToolsOpen(false);
    setAiShowHistory(false);
    setShowCenterAI(false);
  }, []);

  const handleRightPanelTabChange = useCallback((tab: RightTab) => {
    if (tab === 'settings') {
      openSettingsModal();
      return;
    }
    setSettingsModalOpen(false);
    setRightTab(tab);
  }, [openSettingsModal]);

  const scrollSettingsModalTo = useCallback((targetId?: string) => {
    const sectionByTarget: Record<string, string> = {
      'settings-sync-base': 'sync',
      'settings-live-sync': 'live-sync',
      'settings-ai': 'ai',
    };
    setSettingsModalSection(targetId ? (sectionByTarget[targetId] || targetId) : 'home');
    requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>('.app-layout.settings-modal-open .right-panel-content');
      panel?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, []);

  const settingsNavItem = (section: string, label: string) => (
    <button
      type="button"
      className={'ars-settings-nav-item' + (settingsModalSection === section ? ' active' : '')}
      onClick={() => setSettingsModalSection(section)}
    >
      {label}
    </button>
  );

  useEffect(() => {
    if (!settingsModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSettingsModal();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeSettingsModal, settingsModalOpen]);

  const beginSidebarResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    autoLeftCollapsedRef.current = false;
    const rect = mainContentRef.current?.getBoundingClientRect();
    if (!rect) return;
    document.body.classList.add('workspace-resizing');

    const handleMove = (moveEvent: MouseEvent) => {
      setSidebarWidth(clampNumber(moveEvent.clientX - rect.left, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_DEFAULT));
    };
    const handleUp = () => {
      document.body.classList.remove('workspace-resizing');
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, []);

  const beginRightPanelResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    autoRightCollapsedRef.current = false;
    const rect = mainContentRef.current?.getBoundingClientRect();
    if (!rect) return;
    document.body.classList.add('workspace-resizing');

    const handleMove = (moveEvent: MouseEvent) => {
      const nextWidth = rect.right - moveEvent.clientX - 14;
      setRightPanelWidth(clampNumber(nextWidth, RIGHT_PANEL_WIDTH_MIN, RIGHT_PANEL_WIDTH_MAX, RIGHT_PANEL_WIDTH_DEFAULT));
    };
    const handleUp = () => {
      document.body.classList.remove('workspace-resizing');
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('ars-note.backup.keepLatest', String(backupRetentionLimit));
    } catch { /* ignore storage failures */ }
  }, [backupRetentionLimit]);
  const aiConversationSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressAiConversationSaveRef = useRef(false);

  /* Auto-save AI chat messages when they change */
  useEffect(() => {
    if (suppressAiConversationSaveRef.current) {
      suppressAiConversationSaveRef.current = false;
      return;
    }

    if (!vaultPath || aiChatMessages.length === 0) return;
    if (!api.aiSaveConversation) return;
    if (aiConversationSaveTimerRef.current) clearTimeout(aiConversationSaveTimerRef.current);
    aiConversationSaveTimerRef.current = setTimeout(() => {
      aiConversationSaveTimerRef.current = null;
      api.aiSaveConversation(vaultPath, aiChatMessages).catch(() => {});
    }, 500);

    return () => {
      if (aiConversationSaveTimerRef.current) {
        clearTimeout(aiConversationSaveTimerRef.current);
        aiConversationSaveTimerRef.current = null;
      }
    };
  }, [aiChatMessages, vaultPath]);

  /* Start AI memory auto-sync when vault opens with self-hosted sync (v0.9.6) */
  useEffect(() => {
    if (!vaultPath || !api.aiStartAutoSync) return;
    api.aiStartAutoSync(vaultPath).catch(() => {});
    return () => { if (api.aiStopAutoSync) api.aiStopAutoSync().catch(() => {}); };
  }, [vaultPath]);

  /* Live Sync — auto-reload files when remote changes arrive (v1.0.0) */
  useEffect(() => {
    const api = (window as any).arsnote;
    if (!api?.onLiveSyncFileUpdated) return;

    const unsub = api.onLiveSyncFileUpdated((data: any) => {
      if (!vaultPath) return;
      /* Refresh file tree */
      refreshTree(true);
      if (typeof data.relativePath !== 'string' || !data.relativePath.startsWith('.')) {
        scheduleIndexRefreshRef.current();
      }
      if (typeof data.relativePath === 'string' && data.relativePath.startsWith('.ai-memory/')) {
        api.aiListConversations?.(vaultPath).then((list: any[]) => {
          setAiHistoryList(list || []);
        }).catch(() => {});
        if (data.relativePath.startsWith('.ai-memory/history/') && aiChatMessages.length === 0) {
          api.aiLoadLatestConversation?.(vaultPath).then((msgs: any[]) => {
            const chatMsgs: AIChatMessage[] = [];
            for (const m of msgs || []) {
              if (m.role === 'user' || m.role === 'assistant') {
                chatMsgs.push({
                  role: m.role,
                  content: m.content || '',
                  createdAt: m.createdAt || new Date().toISOString(),
                  toolCalls: m.toolCalls || m.tool_calls || undefined,
                });
              }
            }
            if (chatMsgs.length > 0) setAiChatMessages(chatMsgs);
          }).catch(() => {});
        }
      }
      /* If the currently open file was updated, reload it */
      if (currentFile && data.relativePath) {
        const currentRelPath = currentFile.replace(/\\/g, '/');
        if (currentRelPath.endsWith(data.relativePath)) {
          api.readFile(currentFile).then((content: string) => {
            setCurrentContent(content);
            setSavedContent(content);
            setSaveStatus('saved');
          }).catch((err: any) => {
            console.error('Failed to reload live-synced file:', err);
          });
        }
      }
    });

    return () => { if (unsub) unsub(); };
  }, [vaultPath, currentFile, aiChatMessages.length]);

  /* A process has one file watcher. Always release the previous Vault before switching projects. */
  useEffect(() => {
    if (!vaultPath || !api.liveSyncStop) return;
    return () => {
      api.liveSyncStop?.().catch(() => {});
    };
  }, [vaultPath]);

  /* Live Sync — auto-connect on startup if this Vault has a saved config (v1.0.0) */
  useEffect(() => {
    if (!vaultPath) return;
    const api = (window as any).arsnote;
    if (!api?.liveSyncStart) return;
    let cancelled = false;
    const autoConnectProtectionKey = 'ars-note.live-sync.auto-connect-protection';
    const rememberAutoConnectProtection = (payload: any) => {
      const safeConfig = payload?.config && typeof payload.config === 'object'
        ? { ...payload.config, apiKey: undefined }
        : payload?.config;
      const notice = {
        ...payload,
        config: safeConfig,
        vaultPath,
        checkedAt: new Date().toISOString(),
      };
      try {
        localStorage.setItem(autoConnectProtectionKey, JSON.stringify(notice));
      } catch {
        // Ignore storage errors; the connection is still safely blocked.
      }
      window.dispatchEvent(new CustomEvent('ars-note:live-sync-auto-connect-protected', { detail: notice }));
    };
    const autoConnect = async () => {
      try {
        const persistedCfg = await api.liveSyncLoadConfig?.(vaultPath);
        const saved = localStorage.getItem('ars-note.live-sync');
        const savedCfg = saved ? JSON.parse(saved) : null;
        const expectedVaultId = String(
          persistedCfg?.vaultId || syncConfig?.remoteVaultId || vault?.vaultId || '',
        ).trim();
        const scopedRendererCfg = isLiveSyncRendererHintForVault(savedCfg, vaultPath, expectedVaultId)
          ? savedCfg
          : null;
        const legacyRendererApiKey = typeof scopedRendererCfg?.apiKey === 'string' ? scopedRendererCfg.apiKey : '';
        const hasVaultLiveConfig = !!(
          (persistedCfg?.enabled && persistedCfg?.serverUrl)
          || (syncConfig?.enabled && syncConfig.provider === 'self-hosted' && syncConfig.endpoint)
        );
        if (!hasVaultLiveConfig) return;
        let cfg: any = {
          enabled: true,
          serverUrl: persistedCfg?.serverUrl || syncConfig?.endpoint || scopedRendererCfg?.serverUrl || '',
          apiKey: persistedCfg?.apiKey || legacyRendererApiKey || undefined,
          vaultId: persistedCfg?.vaultId || syncConfig?.remoteVaultId || vault?.vaultId || scopedRendererCfg?.vaultId || undefined,
          connectionMode: 'join',
        };

        if (legacyRendererApiKey && !persistedCfg?.apiKey) {
          await api.liveSyncSaveConfig?.(vaultPath, cfg).catch(() => {});
        }

        if (cancelled || !cfg.serverUrl) return;

        const status = await api.liveSyncStatus?.().catch(() => null);
        if (cancelled) return;
        if (isSameLiveSyncTarget(status, cfg)) return;

        if (false && api.liveSyncPreflightStart) {
          const preflight = await api.liveSyncPreflightStart(vaultPath, cfg);
          if (cancelled) return;
          if (preflight?.blocked) {
            rememberAutoConnectProtection({
              type: 'blocked',
              summary: preflight.readiness?.summary || preflight.error || '实时同步自动连接已被安全预检暂停。',
              blockers: Array.isArray(preflight.readiness?.blockers) ? preflight.readiness.blockers.slice(0, 8) : [],
              actions: Array.isArray(preflight.readiness?.actions) ? preflight.readiness.actions.slice(0, 8) : [],
              config: preflight.config || cfg,
            });
            return;
          }
          if (preflight?.config) {
            cfg = {
              ...cfg,
              ...preflight.config,
              connectionMode: 'join',
            };
          }
        }

        const result = await api.liveSyncStart(vaultPath, cfg).catch((err: any) => ({
          ok: false,
          error: err?.message || '实时同步自动连接失败。',
        }));
        if (cancelled) return;
        if (!result?.ok) {
          rememberAutoConnectProtection({
            type: 'failed',
            summary: result?.error || '实时同步自动连接失败，尚未信任服务器快照。',
            config: result?.config || cfg,
          });
          return;
        }
        const savedConfig = result.config || cfg;
        try {
          localStorage.removeItem(autoConnectProtectionKey);
          localStorage.setItem('ars-note.live-sync', JSON.stringify(createLiveSyncRendererHint(vaultPath, {
            serverUrl: savedConfig.serverUrl || cfg.serverUrl,
            vaultId: savedConfig.vaultId || cfg.vaultId || '',
            connectionMode: 'join',
          })));
        } catch {
          // Persisting the convenience config is optional.
        }
      } catch {
        // Auto-connect should never block opening the vault.
      }
    };
    const startupTimer = window.setTimeout(() => { void autoConnect(); }, 1_500);
    return () => {
      cancelled = true;
      window.clearTimeout(startupTimer);
    };
  }, [vault?.vaultId, vaultPath, syncConfig]);

  /* ── Global Ctrl+P quick file switcher ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        setShowShortcutGuide(false);
        setQuickSwitchMode('files');
        setShowQuickSwitch(true);
        return;
      }
      if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowShortcutGuide(false);
        setQuickSwitchMode('commands');
        setShowQuickSwitch(true);
        return;
      }
      if (mod && (e.key === '/' || e.code === 'Slash')) {
        e.preventDefault();
        setShowQuickSwitch(false);
        setShowShortcutGuide((visible) => !visible);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /* ── Focus mode toggle (Ctrl+Shift+F) ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setFocusMode(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /* ── Theme toggle ── */
  useEffect(() => {
    document.body.classList.toggle('light-theme', theme === 'light');
    try { localStorage.setItem('arsnote-theme', theme); } catch {}
  }, [theme]);

  /* ── Listen for real-time AI tool call progress ── */
  useEffect(() => {
    if (!api.onAIToolProgress) return;
    const unsub = api.onAIToolProgress((data) => {
      setAiLiveToolCalls((prev) => {
        if (data.status === 'running') {
          return [...prev, { name: data.name, args: data.args, result: '', status: 'running' as const }];
        }
        if (data.status === 'done') {
          // Update last matching "running" entry to "done"
          const idx = [...prev].reverse().findIndex(tc => tc.name === data.name && tc.status === 'running');
          if (idx === -1) return prev;
          const realIdx = prev.length - 1 - idx;
          const updated = [...prev];
          updated[realIdx] = { ...updated[realIdx], status: 'done' as const };
          return updated;
        }
        return prev;
      });
    });
    return unsub;
  }, []);

  const deleteItemName = deleteTarget ? deleteTarget.split(/[\\/]/).pop() || '' : '';

  const showConfirm = useCallback((title: string, message: string, options?: { confirmLabel?: string; confirmTone?: 'primary' | 'danger' }): Promise<boolean> => {
    const isDeleteConfirm = /删除|delete/i.test(title || '');
    return new Promise((resolve) => {
      setConfirmConfig({
        title,
        message,
        confirmLabel: options?.confirmLabel || (isDeleteConfirm ? t.delete : undefined),
        confirmTone: options?.confirmTone || (isDeleteConfirm ? 'danger' : 'primary'),
        resolve,
      });
    });
  }, [t.delete]);

  /* ── Vault index scanning ── */
  const refreshIndex = useCallback(async () => {
    const runner = indexRefreshRunnerRef.current;
    if (!runner || !activeVaultPathRef.current) return;
    try {
      await runner.runNow();
      setIndexRefreshMsg(t.indexRefreshed);
      if (indexRefreshMessageTimerRef.current) clearTimeout(indexRefreshMessageTimerRef.current);
      indexRefreshMessageTimerRef.current = setTimeout(() => {
        indexRefreshMessageTimerRef.current = null;
        setIndexRefreshMsg('');
      }, 2000);
    } catch (err) {
      console.error('Failed to scan vault index:', err);
    }
  }, [t.indexRefreshed]);

  const scheduleIndexRefresh = useCallback(() => {
    indexRefreshRunnerRef.current?.schedule();
  }, []);

  useEffect(() => {
    indexRefreshRunnerRef.current?.cancel();
    if (!vaultPath) {
      indexRefreshRunnerRef.current = null;
      scheduleIndexRefreshRef.current = () => {};
      setVaultIndex(EMPTY_INDEX);
      return;
    }

    const indexedVaultPath = vaultPath;
    const runner = createCoalescedAsyncRunner(async () => {
      const index = await api.scanVaultIndex(indexedVaultPath);
      if (activeVaultPathRef.current === indexedVaultPath) setVaultIndex(index);
    }, 800, (error) => {
      console.error('Failed to scan vault index:', error);
    });
    const scheduleCurrentIndex = () => runner.schedule();
    indexRefreshRunnerRef.current = runner;
    scheduleIndexRefreshRef.current = scheduleCurrentIndex;
    setVaultIndex(EMPTY_INDEX);
    const initialScanTimer = window.setTimeout(() => {
      void runner.runNow().catch((error) => console.error('Failed to scan vault index:', error));
    }, 700);

    return () => {
      window.clearTimeout(initialScanTimer);
      runner.cancel();
      if (indexRefreshRunnerRef.current === runner) indexRefreshRunnerRef.current = null;
      if (scheduleIndexRefreshRef.current === scheduleCurrentIndex) scheduleIndexRefreshRef.current = () => {};
    };
  }, [vaultPath]);

  useEffect(() => () => {
    if (indexRefreshMessageTimerRef.current) clearTimeout(indexRefreshMessageTimerRef.current);
  }, []);

  /* ── Auto-save ── */
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const livePushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleLivePush = useCallback((filePath: string, content: string) => {
    if (!filePath || !api.liveSyncPushFile) return;
    if (livePushTimerRef.current) clearTimeout(livePushTimerRef.current);
    livePushTimerRef.current = setTimeout(() => {
      livePushTimerRef.current = null;
      api.liveSyncPushFile(filePath, content).catch(() => {});
    }, 350);
  }, []);

  useEffect(() => {
    return () => {
      if (livePushTimerRef.current) clearTimeout(livePushTimerRef.current);
    };
  }, []);

  const handleEditorChange = useCallback((value: string) => {
    currentContentStateRef.current = value;
    setCurrentContent(value);
    if (currentFile) scheduleLivePush(currentFile, value);
  }, [currentFile, scheduleLivePush]);

  const flushExcalidrawContent = useCallback(async (value: string) => {
    const filePath = currentFile;
    if (!filePath) return;
    try {
      await api.writeFile(filePath, value);
      scheduleLivePush(filePath, value);
      scheduleIndexRefresh();
    } catch (error) {
      console.error('Failed to flush Excalidraw scene:', error);
    }
  }, [currentFile, scheduleIndexRefresh, scheduleLivePush]);

  const doSave = useCallback(async () => {
    if (!currentFile || currentContent === savedContent) return;
    setSaveStatus('saving');
    try { await api.writeFile(currentFile, currentContent); savedContentStateRef.current = currentContent; setSavedContent(currentContent); setSaveStatus('saved'); scheduleIndexRefresh(); }
    catch (err) { console.error('Save failed:', err); setSaveStatus('error'); }
  }, [currentFile, currentContent, savedContent, scheduleIndexRefresh]);

  const saveNow = useCallback(async () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    if (!currentFile || currentContent === savedContent) return;
    setSaveStatus('saving');
    try { await api.writeFile(currentFile, currentContent); savedContentStateRef.current = currentContent; setSavedContent(currentContent); setSaveStatus('saved'); scheduleIndexRefresh(); }
    catch (err) { console.error('Save failed:', err); setSaveStatus('error'); }
  }, [currentFile, currentContent, savedContent, scheduleIndexRefresh]);

  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (currentFile && currentContent !== savedContent) { setSaveStatus('unsaved'); saveTimerRef.current = setTimeout(doSave, 1000); }
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [currentContent, currentFile, savedContent, doSave]);

  /* ── Load file tree ── */
  const refreshTree = useCallback(async (force = false) => {
    if (!vaultPath) return;
    try { const tree = await api.readFileTree(vaultPath, force); setFileTree(tree); }
    catch (err) { console.error('Failed to read file tree:', err); }
  }, [vaultPath]);

  const handleMoveItem = useCallback(async (srcPath: string, destDir: string) => {
    try {
      const newPath = await api.moveItem(srcPath, destDir);
      await refreshTree();
      setOpenTabs((prev) => prev.map((path) => replaceMovedPath(path, srcPath, newPath)));
      setClosedTabs((prev) => prev.map((path) => replaceMovedPath(path, srcPath, newPath)));
      setPinnedTabs((prev) => prev.map((path) => replaceMovedPath(path, srcPath, newPath)));
      const nextNavigationHistory = navigationHistoryRef.current.map((path) => replaceMovedPath(path, srcPath, newPath));
      navigationHistoryRef.current = nextNavigationHistory;
      setNavigationHistory(nextNavigationHistory);
      setNavigationIndex(navigationIndexRef.current);
      // If the moved file was the current file, update the reference
      const updatedCurrentFile = replaceMovedPath(currentFile, srcPath, newPath);
      if (updatedCurrentFile !== currentFile) {
        setCurrentFile(updatedCurrentFile);
      }
    } catch (err) {
      console.error('Failed to move item:', err);
    }
  }, [vaultPath, currentFile, refreshTree]);

  useEffect(() => { refreshTree(); }, [refreshTree]);

  const bookmarkStorageKey = useMemo(
    () => vaultPath ? `ars-note.bookmarks:${normalizePath(vaultPath).toLowerCase()}` : '',
    [vaultPath],
  );

  const workspaceSessionKey = useMemo(
    () => vaultPath ? getWorkspaceSessionKey(vaultPath) : '',
    [vaultPath],
  );

  const workspaceSnapshotsKey = useMemo(
    () => vaultPath ? getWorkspaceSnapshotsKey(vaultPath) : '',
    [vaultPath],
  );

  useEffect(() => {
    setWorkspaceSnapshots(vaultPath ? readWorkspaceSnapshots(vaultPath) : []);
    setWorkspaceSnapshotsOpen(false);
  }, [vaultPath]);

  const persistWorkspaceSnapshots = useCallback((next: WorkspaceSnapshot[]) => {
    const limited = next.slice(0, 12);
    setWorkspaceSnapshots(limited);
    if (!workspaceSnapshotsKey) return;
    try {
      window.localStorage.setItem(workspaceSnapshotsKey, JSON.stringify(limited));
    } catch {
      // Ignore local workspace persistence failures.
    }
  }, [workspaceSnapshotsKey]);

  useEffect(() => {
    if (!bookmarkStorageKey) {
      setBookmarkedFiles([]);
      return;
    }
    try {
      const raw = window.localStorage.getItem(bookmarkStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setBookmarkedFiles(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
    } catch {
      setBookmarkedFiles([]);
    }
  }, [bookmarkStorageKey]);

  const toggleBookmark = useCallback((filePath: string) => {
    if (!bookmarkStorageKey || !filePath) return;
    setBookmarkedFiles((prev) => {
      const normalizedTarget = normalizePath(filePath).toLowerCase();
      const exists = prev.some((path) => normalizePath(path).toLowerCase() === normalizedTarget);
      const next = exists
        ? prev.filter((path) => normalizePath(path).toLowerCase() !== normalizedTarget)
        : [filePath, ...prev.filter((path) => normalizePath(path).toLowerCase() !== normalizedTarget)].slice(0, 24);
      window.localStorage.setItem(bookmarkStorageKey, JSON.stringify(next));
      return next;
    });
  }, [bookmarkStorageKey]);

  /* ── Open file ── */
  const togglePinnedTab = useCallback((filePath: string) => {
    if (!filePath) return;
    const targetKey = normalizePath(filePath).toLowerCase();
    const isPinned = pinnedTabs.some((path) => normalizePath(path).toLowerCase() === targetKey);
    const nextPinned = isPinned
      ? pinnedTabs.filter((path) => normalizePath(path).toLowerCase() !== targetKey)
      : [...pinnedTabs.filter((path) => normalizePath(path).toLowerCase() !== targetKey), filePath];
    setPinnedTabs(nextPinned);
    setOpenTabs((prev) => orderTabsByPinned(prev, nextPinned));
  }, [pinnedTabs]);

  const applyNavigationState = useCallback((history: string[], index: number) => {
    navigationHistoryRef.current = history;
    navigationIndexRef.current = index;
    setNavigationHistory(history);
    setNavigationIndex(index);
  }, []);

  const recordNavigation = useCallback((filePath: string) => {
    if (!filePath) return;
    const normalizedTarget = normalizePath(filePath).toLowerCase();
    const history = navigationHistoryRef.current;
    const rawIndex = navigationIndexRef.current;
    const activeIndex = rawIndex >= 0 && rawIndex < history.length ? rawIndex : history.length - 1;
    const activePath = activeIndex >= 0 ? history[activeIndex] : '';

    if (activePath && normalizePath(activePath).toLowerCase() === normalizedTarget) return;

    const nextBase = history.slice(0, activeIndex + 1);
    const dedupedBase = nextBase.filter((path) => normalizePath(path).toLowerCase() !== normalizedTarget);
    const nextHistory = [...dedupedBase, filePath].slice(-80);
    applyNavigationState(nextHistory, nextHistory.length - 1);
  }, [applyNavigationState]);

  const buildCurrentWorkspaceSession = useCallback((): WorkspaceSession => ({
    version: WORKSPACE_SESSION_VERSION,
    appVersion: APP_VERSION,
    currentFile,
    openTabs: openTabs.filter((tabPath) => Boolean(tabPath)).slice(-16),
    pinnedTabs: pinnedTabs.filter((tabPath) => Boolean(tabPath)).slice(-16),
    navigationHistory: navigationHistory.filter((tabPath) => Boolean(tabPath)).slice(-80),
    navigationIndex,
    rightTab,
    viewMode,
    showCenterGraph,
    showCenterAI,
    showCenterSchedule,
    focusMode,
    leftCollapsed,
    rightCollapsed,
    sidebarWidth,
    rightPanelWidth,
    updatedAt: new Date().toISOString(),
  }), [currentFile, focusMode, leftCollapsed, navigationHistory, navigationIndex, openTabs, pinnedTabs, rightCollapsed, rightPanelWidth, rightTab, showCenterAI, showCenterGraph, showCenterSchedule, sidebarWidth, viewMode]);

  useEffect(() => {
    if (!workspaceSessionKey || workspaceSessionRestoreRef.current) return;
    try {
      window.localStorage.setItem(workspaceSessionKey, JSON.stringify(buildCurrentWorkspaceSession()));
    } catch {
      // Ignore local workspace persistence failures.
    }
  }, [buildCurrentWorkspaceSession, workspaceSessionKey]);

  const loadFileIntoEditor = useCallback(async (filePath: string, baseTabs?: string[], options?: { recordHistory?: boolean }) => {
    const requestId = ++documentOpenRequestRef.current;
    const label = filePath.split(/[\\/]/).pop() || filePath;
    const hasMountedEditor = Boolean(editorRef.current?.getView());
    startDocumentOpening({ path: filePath, label, requestId, immediate: !hasMountedEditor });
    if (!hasMountedEditor) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (requestId !== documentOpenRequestRef.current) return;
    }

    let content: string;
    let readTimeout: ReturnType<typeof setTimeout> | null = null;
    try {
      content = await Promise.race([
        api.readFile(filePath),
        new Promise<string>((_resolve, reject) => {
          readTimeout = setTimeout(() => reject(new Error(`Timed out opening ${label}`)), 20_000);
        }),
      ]);
    } catch (error) {
      if (requestId === documentOpenRequestRef.current) finishDocumentOpeningEvent(filePath);
      throw error;
    } finally {
      if (readTimeout) clearTimeout(readTimeout);
    }
    if (requestId !== documentOpenRequestRef.current) return;
    currentFileStateRef.current = filePath;
    currentContentStateRef.current = content;
    savedContentStateRef.current = content;
    setCurrentFile(filePath);
    setCurrentContent(content);
    setSavedContent(content);
    setSaveStatus('saved');
    setOpenTabs((prev) => {
      const sourceTabs = baseTabs || prev;
      if (sourceTabs.includes(filePath)) return sourceTabs;
      const next = [...sourceTabs, filePath];
      if (next.length <= 16) return next;
      const pinnedKeys = new Set(pinnedTabs.map((path) => normalizePath(path).toLowerCase()));
      const removableIndex = next.findIndex((path) => (
        path !== filePath && !pinnedKeys.has(normalizePath(path).toLowerCase())
      ));
      if (removableIndex >= 0) next.splice(removableIndex, 1);
      return next.slice(-16);
    });
    if (options?.recordHistory !== false) recordNavigation(filePath);
    if (!/\.md$/i.test(filePath) || viewMode === 'preview') {
      requestAnimationFrame(() => requestAnimationFrame(() => finishDocumentOpeningEvent(filePath)));
    }
  }, [pinnedTabs, recordNavigation, viewMode]);

  const openFile = useCallback(async (filePath: string) => {
    setShowCenterGraph(false);
    setShowCenterAI(false);
    setShowCenterSchedule(false);
    setShowBalanceLab(false);
    const activeFile = currentFileStateRef.current;
    const activeContent = currentContentStateRef.current;
    if (activeFile && activeContent !== savedContentStateRef.current) {
      try {
        await api.writeFile(activeFile, activeContent);
        savedContentStateRef.current = activeContent;
        setSavedContent(activeContent);
      }
      catch (err) { console.error('Failed to save before switching:', err); }
    }
    try { await loadFileIntoEditor(filePath); }
    catch (err) {
      console.error('Failed to open file:', err);
      const label = filePath.split(/[\\/]/).pop() || filePath;
      setCreationMsg(`打开失败：${label}`);
      setTimeout(() => setCreationMsg(''), 3_500);
    }
  }, [loadFileIntoEditor]);

  const navigateFileHistory = useCallback(async (delta: -1 | 1) => {
    const history = navigationHistoryRef.current;
    const targetIndex = navigationIndexRef.current + delta;
    if (targetIndex < 0 || targetIndex >= history.length) return;
    const targetPath = history[targetIndex];
    if (!targetPath) return;

    if (currentFile && currentContent !== savedContent) {
      try {
        await api.writeFile(currentFile, currentContent);
        setSavedContent(currentContent);
      } catch (err) {
        console.error('Failed to save before navigating history:', err);
        setSaveStatus('error');
        return;
      }
    }

    try {
      await loadFileIntoEditor(targetPath, undefined, { recordHistory: false });
      applyNavigationState(history, targetIndex);
    } catch (err) {
      console.error('Failed to navigate file history:', err);
      const normalizedTarget = normalizePath(targetPath).toLowerCase();
      const nextHistory = history.filter((path) => normalizePath(path).toLowerCase() !== normalizedTarget);
      const nextIndex = Math.min(Math.max(targetIndex - 1, 0), nextHistory.length - 1);
      applyNavigationState(nextHistory, nextIndex);
    }
  }, [applyNavigationState, currentContent, currentFile, loadFileIntoEditor, savedContent]);

  const reloadCurrentFile = useCallback(async () => {
    if (!currentFile) return;
    try {
      const content = await api.readFile(currentFile);
      setCurrentContent(content);
      setSavedContent(content);
      setSaveStatus('saved');
      await refreshIndex();
    } catch (err) {
      console.error('Failed to reload current file:', err);
    }
  }, [currentFile, refreshIndex]);

  /* ── Apply vault result ── */
  const restoreWorkspaceSession = useCallback(async (result: VaultOpenResult) => {
    workspaceSessionRestoreRef.current = true;
    const session = readWorkspaceSession(result.path);

    setOpenTabs([]);
    setClosedTabs([]);
    setPinnedTabs([]);
    applyNavigationState([], -1);
    setRightTab(session?.rightTab || 'game');
    setViewMode(session?.viewMode || 'live');
    setShowCenterSchedule(Boolean(session?.showCenterSchedule));
    setShowCenterAI(Boolean(session?.showCenterAI && !session?.showCenterSchedule));
    setShowCenterGraph(Boolean(session?.showCenterGraph && !session?.showCenterAI && !session?.showCenterSchedule));
    setShowBalanceLab(false);
    setFocusMode(Boolean(session?.focusMode));
    autoLeftCollapsedRef.current = false;
    leftCollapsedRef.current = Boolean(session?.leftCollapsed);
    setLeftCollapsed(Boolean(session?.leftCollapsed));
    setSidebarWidth(session?.sidebarWidth || SIDEBAR_WIDTH_DEFAULT);
    setRightPanelWidth(session?.rightPanelWidth || RIGHT_PANEL_WIDTH_DEFAULT);
    autoRightCollapsedRef.current = false;
    rightCollapsedRef.current = Boolean(session?.rightCollapsed);
    setRightCollapsed(Boolean(session?.rightCollapsed));

    try {
      const tree = await api.readFileTree(result.path);
      setFileTree(tree);
      const existingFiles = collectOpenableFilePaths(tree);
      const exists = (filePath: string) => existingFiles.has(normalizePath(filePath).toLowerCase());
      const restoredPinnedTabs = (session?.pinnedTabs || []).filter(exists).slice(-16);
      const restoredTabs = orderTabsByPinned((session?.openTabs || []).filter(exists).slice(-16), restoredPinnedTabs);
      const restoredNavigation = (session?.navigationHistory || []).filter(exists).slice(-80);
      const restoredCurrent = session?.currentFile && exists(session.currentFile) ? session.currentFile : '';
      const restoredTarget = restoredCurrent || restoredTabs[restoredTabs.length - 1] || '';

      if (restoredPinnedTabs.length > 0) setPinnedTabs(restoredPinnedTabs);
      if (restoredTabs.length > 0) setOpenTabs(restoredTabs);
      if (restoredTarget) {
        await loadFileIntoEditor(restoredTarget, restoredTabs, { recordHistory: false });
        const normalizedTarget = normalizePath(restoredTarget).toLowerCase();
        const targetIndex = restoredNavigation.findIndex((path) => normalizePath(path).toLowerCase() === normalizedTarget);
        if (targetIndex >= 0) {
          applyNavigationState(restoredNavigation, targetIndex);
        } else {
          const nextNavigation = [...restoredNavigation, restoredTarget].slice(-80);
          applyNavigationState(nextNavigation, nextNavigation.length - 1);
        }
        return;
      }

      const preferredFiles = [
        await api.joinPath(result.path, '00_Index.md'),
        await api.joinPath(result.path, '01_GDD', 'GDD.md'),
        await api.joinPath(result.path, 'GDD.md'),
      ];

      for (const filePath of preferredFiles) {
        if (!exists(filePath)) continue;
        await loadFileIntoEditor(filePath, [], { recordHistory: false });
        applyNavigationState([filePath], 0);
        return;
      }

      const firstMarkdown = findFirstMarkdownPath(tree);
      if (firstMarkdown) {
        await loadFileIntoEditor(firstMarkdown, [], { recordHistory: false });
        applyNavigationState([firstMarkdown], 0);
      }
    } catch (err) {
      console.error('Failed to restore workspace session:', err);
    } finally {
      workspaceSessionRestoreRef.current = false;
    }
  }, [applyNavigationState, loadFileIntoEditor]);

  const saveWorkspaceSnapshot = useCallback(async () => {
    if (!vaultPath) return;
    const defaultName = `Workspace ${workspaceSnapshots.length + 1}`;
    const requestedName = await showPrompt(
      'Save workspace',
      'Save the current tabs and layout under a name.',
      defaultName,
      'Workspace name',
    );
    const name = requestedName?.trim();
    if (!name) return;

    const existing = workspaceSnapshots.find((snapshot) => snapshot.name.toLowerCase() === name.toLowerCase());
    const snapshot: WorkspaceSnapshot = {
      ...buildCurrentWorkspaceSession(),
      id: existing?.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      updatedAt: new Date().toISOString(),
    };
    persistWorkspaceSnapshots([
      snapshot,
      ...workspaceSnapshots.filter((item) => item.id !== snapshot.id),
    ]);
    setWorkspaceSnapshotsOpen(true);
  }, [buildCurrentWorkspaceSession, persistWorkspaceSnapshots, showPrompt, vaultPath, workspaceSnapshots]);

  const restoreWorkspaceSnapshot = useCallback(async (snapshot: WorkspaceSnapshot) => {
    if (!vaultPath) return;
    if (currentFile && currentContent !== savedContent) {
      try {
        await api.writeFile(currentFile, currentContent);
        setSavedContent(currentContent);
        setSaveStatus('saved');
      } catch (err) {
        console.error('Failed to save before restoring workspace:', err);
        setSaveStatus('error');
        return;
      }
    }

    workspaceSessionRestoreRef.current = true;
    try {
      const existingFiles = collectOpenableFilePaths(fileTree);
      const exists = (filePath: string) => existingFiles.has(normalizePath(filePath).toLowerCase());
      const restoredPinnedTabs = snapshot.pinnedTabs.filter(exists).slice(-16);
      const restoredTabs = orderTabsByPinned(snapshot.openTabs.filter(exists).slice(-16), restoredPinnedTabs);
      const restoredNavigation = snapshot.navigationHistory.filter(exists).slice(-80);
      const restoredCurrent = snapshot.currentFile && exists(snapshot.currentFile) ? snapshot.currentFile : '';
      const restoredTarget = restoredCurrent || restoredTabs[restoredTabs.length - 1] || '';

      setPinnedTabs(restoredPinnedTabs);
      setOpenTabs(restoredTabs);
      setClosedTabs([]);
      setRightTab(snapshot.rightTab);
      setViewMode(snapshot.viewMode);
      setShowCenterSchedule(snapshot.showCenterSchedule);
      setShowCenterAI(snapshot.showCenterAI && !snapshot.showCenterSchedule);
      setShowCenterGraph(snapshot.showCenterGraph && !snapshot.showCenterAI && !snapshot.showCenterSchedule);
      setShowBalanceLab(false);
      setFocusMode(snapshot.focusMode);
      autoLeftCollapsedRef.current = false;
      leftCollapsedRef.current = snapshot.leftCollapsed;
      setLeftCollapsed(snapshot.leftCollapsed);
      setSidebarWidth(snapshot.sidebarWidth || SIDEBAR_WIDTH_DEFAULT);
      setRightPanelWidth(snapshot.rightPanelWidth || RIGHT_PANEL_WIDTH_DEFAULT);
      autoRightCollapsedRef.current = false;
      rightCollapsedRef.current = snapshot.rightCollapsed;
      setRightCollapsed(snapshot.rightCollapsed);

      if (restoredTarget) {
        await loadFileIntoEditor(restoredTarget, restoredTabs, { recordHistory: false });
        const targetKey = normalizePath(restoredTarget).toLowerCase();
        const requestedIndex = restoredNavigation.findIndex((path) => normalizePath(path).toLowerCase() === targetKey);
        if (requestedIndex >= 0) {
          applyNavigationState(restoredNavigation, requestedIndex);
        } else {
          const nextNavigation = [...restoredNavigation, restoredTarget].slice(-80);
          applyNavigationState(nextNavigation, nextNavigation.length - 1);
        }
      } else {
        setCurrentFile('');
        setCurrentContent('');
        setSavedContent('');
        setSaveStatus('saved');
        applyNavigationState([], -1);
      }
      setWorkspaceSnapshotsOpen(false);
    } catch (err) {
      console.error('Failed to restore named workspace:', err);
    } finally {
      workspaceSessionRestoreRef.current = false;
    }
  }, [applyNavigationState, currentContent, currentFile, fileTree, loadFileIntoEditor, savedContent, vaultPath]);

  const deleteWorkspaceSnapshot = useCallback(async (snapshot: WorkspaceSnapshot) => {
    const confirmed = await showConfirm(
      'Delete workspace',
      `Delete "${snapshot.name}"? This only removes the saved layout and does not delete any files.`,
    );
    if (!confirmed) return;
    persistWorkspaceSnapshots(workspaceSnapshots.filter((item) => item.id !== snapshot.id));
  }, [persistWorkspaceSnapshots, showConfirm, workspaceSnapshots]);

  const applyVaultResult = useCallback((result: VaultOpenResult) => {
    setVault(result.config); setVaultPath(result.path);
    setSyncConfig(null);
    setCurrentFile(''); setCurrentContent(''); setSavedContent(''); setSaveStatus('saved');
    void restoreWorkspaceSession(result);
    // Auto-load saved AI config for this vault
    api.getAIRuntimeStatus(result.path).then((status: any) => {
      if (status && status.hasConfig) {
        setAiConfig({ provider: status.provider, baseUrl: status.baseUrl, model: status.model, hasApiKey: status.hasApiKey, enabled: true });
        setAiFormProvider(status.provider || 'openai-compatible');
        setAiFormBaseUrl(status.baseUrl || '');
        setAiFormModel(status.model || '');
        setAiFormApiKey(''); // Don't restore API key to form for security
      }
    }).catch(() => {});
    // Auto-load last AI conversation
    setAiChatMessages([]);
    if (api.aiLoadLatestConversation) {
      const openedVaultPath = result.path;
      window.setTimeout(() => api.aiLoadLatestConversation(openedVaultPath).then((msgs: any[]) => {
        if (activeVaultPathRef.current !== openedVaultPath) return;
        if (msgs && msgs.length > 0) {
          const chatMsgs = normalizeDisplayAIChatMessages(msgs).filter((message) => message.role !== 'system');
          if (chatMsgs.length > 0) {
            suppressAiConversationSaveRef.current = true;
            setAiChatMessages(chatMsgs);
          }
        }
      }).catch(() => {}), 900);
    }
  }, [restoreWorkspaceSession]);

  /* ── Vault operations ── */
  const openDefaultVaultFile = useCallback(async (result: VaultOpenResult): Promise<boolean> => {
    const preferredFiles = [
      await api.joinPath(result.path, '00_Index.md'),
      await api.joinPath(result.path, '01_GDD', 'GDD.md'),
      await api.joinPath(result.path, 'GDD.md'),
    ];

    for (const filePath of preferredFiles) {
      try {
        await api.readFile(filePath);
        await openFile(filePath);
        return true;
      } catch {
        // Try the next common entry file.
      }
    }

    try {
      const tree = await api.readFileTree(result.path);
      setFileTree(tree);
      const firstMarkdown = findFirstMarkdownPath(tree);
      if (firstMarkdown) {
        await openFile(firstMarkdown);
        return true;
      }
    } catch (err) {
      console.error('Failed to locate default file in restored vault:', err);
    }

    return false;
  }, [openFile]);

  const handleCreateVault = async () => {
    const dir = await api.showOpenDialog(); if (!dir) return;
    const name = await showPrompt(t.createVault, t.vaultNamePrompt, 'MyGameVault', t.vaultNamePrompt); if (!name) return;
    try { const result = await api.createVault(dir, name); applyVaultResult(result); }
    catch (err: any) { showNotice(err.message || t.createFailed); }
  };

  const handleOpenVault = async () => {
    const dir = await api.showOpenDialog(); if (!dir) return;
    try {
      const result = await api.openVault(dir);
      if (!result) { showNotice(t.vaultNotFound + '\n' + t.vaultNotFoundHint, 'warning'); return; }
      applyVaultResult(result);
    } catch (err: any) { showNotice(t.operationFailed); }
  };

  const handleOpenRecent = async (vaultDir: string) => {
    try {
      const result = await api.openVault(vaultDir);
      if (!result) { showNotice(t.vaultNotFoundAt + vaultDir, 'warning'); return; }
      applyVaultResult(result);
    } catch (err: any) { showNotice(t.operationFailed); }
  };

  /* ── File/Folder operations ── */
  const handleNewFile = async (name: string) => {
    if (!vaultPath) return;
    const errKey = isValidFileName(name); if (errKey) { showNotice(t[errKey as keyof typeof t] || errKey, 'warning'); return; }
    const parentDir = contextTarget || vaultPath;
    const segments = name.trim().split('/');
    const lastSeg = segments[segments.length - 1];
    const fileName = lastSeg.endsWith('.md') ? lastSeg : lastSeg + '.md';
    const filePath = await api.joinPath(parentDir, ...segments.slice(0, -1), fileName);
    try { await api.createFile(filePath); await refreshTree(); await refreshIndex(); await openFile(filePath); setShowNewFile(false); }
    catch (err: any) { const msg = err.message || ''; if (msg.includes('already exists')) { showNotice(t.nameAlreadyExists, 'warning'); } else { showNotice(msg); } }
  };

  const handleQuickCreateNote = useCallback(async (name: string) => {
    if (!vaultPath) return;
    const errKey = isValidFileName(name);
    if (errKey) {
      showNotice(t[errKey as keyof typeof t] || errKey, 'warning');
      return;
    }
    const segments = name.trim().split('/');
    const lastSegment = segments[segments.length - 1];
    const fileName = lastSegment.endsWith('.md') ? lastSegment : `${lastSegment}.md`;
    const filePath = await api.joinPath(vaultPath, ...segments.slice(0, -1), fileName);
    try {
      await api.createFile(filePath);
      await refreshTree();
      await refreshIndex();
      await openFile(filePath);
    } catch (err: any) {
      const message = err.message || '';
      showNotice(message.includes('already exists') ? t.nameAlreadyExists : message || t.operationFailed, message.includes('already exists') ? 'warning' : 'error');
    }
  }, [openFile, refreshIndex, refreshTree, t, vaultPath]);

  const handleNewFolder = async (name: string) => {
    if (!vaultPath) return;
    const errKey = isValidFileName(name); if (errKey) { showNotice(t[errKey as keyof typeof t] || errKey, 'warning'); return; }
    const parentDir = contextTarget || vaultPath;
    const folderPath = await api.joinPath(parentDir, name.trim());
    try { await api.createFolder(folderPath); await refreshTree(); setShowNewFolder(false); }
    catch (err: any) { const msg = err.message || ''; if (msg.includes('already exists')) { showNotice(t.nameAlreadyExists, 'warning'); } else { showNotice(msg); } }
  };

  /* ── Delete ── */
  const handleDelete = async () => {
    if (!deleteTarget || !vaultPath) return;
    try {
      await api.deleteItem(deleteTarget, vaultPath);
      const normalizedDeleted = normalizePath(deleteTarget).replace(/\/+$/, '').toLowerCase();
      const isDeletedPath = (path: string) => {
        const normalized = normalizePath(path).toLowerCase();
        return normalized === normalizedDeleted || normalized.startsWith(normalizedDeleted + '/');
      };
      setOpenTabs((prev) => prev.filter((path) => !isDeletedPath(path)));
      setClosedTabs((prev) => prev.filter((path) => !isDeletedPath(path)));
      setPinnedTabs((prev) => prev.filter((path) => !isDeletedPath(path)));
      setBookmarkedFiles((prev) => {
        const next = prev.filter((path) => !isDeletedPath(path));
        if (bookmarkStorageKey) window.localStorage.setItem(bookmarkStorageKey, JSON.stringify(next));
        return next;
      });
      const nextNavigation = navigationHistoryRef.current.filter((path) => !isDeletedPath(path));
      applyNavigationState(nextNavigation, Math.min(navigationIndexRef.current, nextNavigation.length - 1));
      if (currentFile === deleteTarget || currentFile.startsWith(deleteTarget + '\\') || currentFile.startsWith(deleteTarget + '/')) {
        setCurrentFile(''); setCurrentContent(''); setSavedContent(''); setSaveStatus('saved');
      }
      await refreshTree(); await refreshIndex(); setDeleteTarget('');
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('vault root')) { showNotice(t.cannotDeleteRoot, 'warning'); } else if (msg.includes('configuration folder')) { showNotice(t.cannotDeleteConfig, 'warning'); } else { showNotice(msg || t.operationFailed); }
      setDeleteTarget('');
    }
  };

  /* ── Create from template ── */
  const handleCreateFromTemplate = async (templateId: string) => {
    if (!vaultPath) return;
    const { getTemplates } = await import('./templates');
    const templates = getTemplates(t, language);
    const tmpl = templates.find((tmpl) => tmpl.id === templateId);
    if (!tmpl) return;
    const name = await showPrompt(t.newFromTemplate, t.fileNamePrompt, tmpl.defaultFileName, t.filenamePlaceholder); if (!name) return;
    const folder = await api.joinPath(vaultPath, tmpl.folder);
    const fileName = name.trim().endsWith('.md') || name.trim().endsWith('.excalidraw') ? name.trim() : name.trim() + '.md';
    const filePath = await api.joinPath(folder, fileName);
    try {
      const date = new Date().toISOString().split('T')[0];
      const content = tmpl.content.replace(/{TITLE}/g, name.replace('.md', '')).replace(/{DATE}/g, date);
      await api.createFile(filePath, content); await refreshTree(); await refreshIndex(); await openFile(filePath);
      setShowNewFromTemplate(false);
      setCreationMsg(t.templateCreated); setTimeout(() => setCreationMsg(''), 2500);
    } catch (err: any) { const msg = err.message || ''; if (msg.includes('already exists')) { showNotice(t.nameAlreadyExists, 'warning'); } else { showNotice(msg); } }
  };

  /* ── Quick wireframe — create & open Excalidraw file ── */
  const handleNewWireframe = useCallback(async () => {
    if (!vaultPath) return;
    const name = await showPrompt(t.newWireframe || 'New Wireframe', t.fileNamePrompt || 'File name', 'UIPrototype.excalidraw', t.filenamePlaceholder || 'filename');
    if (!name) return;
    const folder = await api.joinPath(vaultPath, '01_GDD');
    const fileName = name.trim().endsWith('.excalidraw') ? name.trim() : name.trim() + '.excalidraw';
    const filePath = await api.joinPath(folder, fileName);
    const wireframeContent = JSON.stringify({
      type: 'excalidraw', version: 2, source: 'ars-note',
      elements: [
        { type: 'rectangle', id: 'screen', x: 200, y: 80, width: 400, height: 700, strokeColor: '#868e96', backgroundColor: 'transparent', strokeWidth: 2, roughness: 0, fillStyle: 'solid' },
        { type: 'rectangle', id: 'header', x: 200, y: 80, width: 400, height: 50, strokeColor: '#868e96', backgroundColor: '#e9ecef', strokeWidth: 1, roughness: 0, fillStyle: 'solid' },
        { type: 'text', id: 'title', x: 220, y: 90, text: fileName.replace(/\.excalidraw$/, ''), fontSize: 20, strokeColor: '#212529', roughness: 0 },
        { type: 'rectangle', id: 'content', x: 220, y: 200, width: 360, height: 300, strokeColor: '#adb5bd', backgroundColor: '#f8f9fa', strokeWidth: 1, roughness: 0, fillStyle: 'solid' },
        { type: 'text', id: 'hint', x: 240, y: 260, text: 'Draw your UI here', fontSize: 18, strokeColor: '#adb5bd', roughness: 0 },
      ],
      appState: { viewBackgroundColor: '#1e1e1e' },
      files: {},
    });
    try {
      await api.createFile(filePath, wireframeContent);
      await refreshTree();
      await refreshIndex();
      await openFile(filePath);
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('already exists')) { showNotice(t.nameAlreadyExists || 'Already exists', 'warning'); }
      else { showNotice(msg); }
    }
  }, [vaultPath, t, refreshTree, refreshIndex, openFile]);

  /* ── Quick canvas — create & open .canvas file ── */
  const handleNewCanvas = useCallback(async () => {
    if (!vaultPath) return;
    const name = await showPrompt(t.newCanvas || 'New Canvas', t.fileNamePrompt || 'File name', 'MindMap.canvas', t.filenamePlaceholder || 'filename');
    if (!name) return;
    const folder = await api.joinPath(vaultPath, '01_GDD');
    const fileName = name.trim().endsWith('.canvas') ? name.trim() : name.trim() + '.canvas';
    const filePath = await api.joinPath(folder, fileName);
    const canvasContent = JSON.stringify({
      nodes: [],
      edges: [],
    });
    try {
      await api.createFile(filePath, canvasContent);
      await refreshTree();
      await refreshIndex();
      await openFile(filePath);
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('already exists')) { showNotice(t.nameAlreadyExists || 'Already exists', 'warning'); }
      else { showNotice(msg); }
    }
  }, [vaultPath, t, refreshTree, refreshIndex, openFile, showPrompt]);

  /* ── Create missing note — supports nested paths ── */
  const handleCreateMissingNote = useCallback(async (targetName: string) => {
    if (!vaultPath) return;
    /* Preserve path structure: [[Characters/Yui]] -> Characters/Yui.md */
    const normalizedTarget = targetName.replace(/\\/g, '/');
    const parts = normalizedTarget.split('/').filter(Boolean);
    /* Validate each segment */
    for (const seg of parts) {
      const s = seg.replace(/\.md$/i, '');
      if (!s.trim()) continue;
      if (/[<>:"|?*\\]/.test(s)) { showNotice(t.nameIllegalChars, 'warning'); return; }
    }
    const lastPart = parts[parts.length - 1];
    const fileName = lastPart.endsWith('.md') ? lastPart : lastPart + '.md';
    const pathParts = [...parts.slice(0, -1), fileName];
    const filePath = await api.joinPath(vaultPath, ...pathParts);
    const noteName = fileName.replace(/\.md$/i, '');
    const noteContent = `# ${noteName}\n`;
    try {
      await api.createFile(filePath, noteContent);
      await refreshTree(); await refreshIndex(); await openFile(filePath);
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('already exists')) { showNotice(t.nameAlreadyExists, 'warning'); await openFile(filePath); }
      else { showNotice(msg); }
    }
  }, [vaultPath, refreshTree, refreshIndex, openFile, t]);

  useEffect(() => {
    const handleWikiOpen = async (event: Event) => {
      const target = (event as CustomEvent<{ target?: string }>).detail?.target?.trim();
      if (!target || !vaultPath) return;
      const cleanTarget = target.split('|')[0].split('#')[0].trim();
      if (!cleanTarget) return;

      const resolved = resolveWikiLink(cleanTarget, vaultIndex);
      if (resolved.type === 'resolved') {
        const filePath = await api.joinPath(vaultPath, ...resolved.relativePath.split('/'));
        await openFile(filePath);
        return;
      }

      if (resolved.type === 'ambiguous' && resolved.relativePaths.length > 0) {
        const filePath = await api.joinPath(vaultPath, ...resolved.relativePaths[0].split('/'));
        await openFile(filePath);
        return;
      }

      const confirmed = window.confirm(`没有找到 [[${cleanTarget}]]，是否新建这个笔记？`);
      if (confirmed) {
        await handleCreateMissingNote(cleanTarget);
      }
    };

    window.addEventListener('ars-note:open-wiki-link', handleWikiOpen as EventListener);
    return () => window.removeEventListener('ars-note:open-wiki-link', handleWikiOpen as EventListener);
  }, [vaultPath, vaultIndex, openFile, handleCreateMissingNote]);


  /* ── Game Workspace quick-create (v0.9.1) ── */
  const [gameDocCreating, setGameDocCreating] = useState(false);

  const handleCreateGameDoc = useCallback(async (type: GameDocType) => {
    if (!vaultPath || gameDocCreating) return;
    setGameDocCreating(true);
    try {
      const { createGameWorkspaceDoc, resolveFileName } = await import('./utils/gameWorkspaceHelper');
      const info = createGameWorkspaceDoc(type, t, language);

      /* Ensure folder exists */
      const folder = await api.joinPath(vaultPath, info.folder);
      try { await api.createFolder(folder); } catch { /* folder may already exist */ }

      /* Resolve filename conflicts — list existing files in folder */
      let existingFiles: string[] = [];
      try {
        const tree = await api.readFileTree(vaultPath);
        existingFiles = findFilesInFolder(tree, info.folder);
      } catch { /* ignore */ }

      const fileName = resolveFileName(info.fileName, existingFiles);
      const filePath = await api.joinPath(folder, fileName);

      await api.createFile(filePath, info.content);
      await refreshTree();
      await refreshIndex();
      await openFile(filePath);
      setCreationMsg(t.templateCreated);
      setTimeout(() => setCreationMsg(''), 2500);
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('already exists')) {
        showNotice(t.nameAlreadyExists, 'warning');
      } else {
        showNotice(msg);
      }
    } finally {
      setGameDocCreating(false);
    }
  }, [vaultPath, gameDocCreating, t, language, refreshTree, refreshIndex, openFile]);

  const handleCreateNarrativeProductionKit = useCallback(async () => {
    if (!vaultPath || gameDocCreating) return;
    setGameDocCreating(true);
    try {
      const { createNarrativeProductionKit } = await import('./utils/gameWorkspaceHelper');
      const kitFiles = createNarrativeProductionKit(vault?.name || 'Game Project');
      let openTargetPath = '';
      let createdCount = 0;
      let skippedCount = 0;

      for (const info of kitFiles) {
        const folder = await api.joinPath(vaultPath, info.folder);
        try { await api.createFolder(folder); } catch { /* folder may already exist */ }
        const filePath = await api.joinPath(folder, info.fileName);
        let exists = false;
        try {
          await api.readFile(filePath);
          exists = true;
        } catch {
          exists = false;
        }
        if (exists) {
          skippedCount += 1;
        } else {
          await api.createFile(filePath, info.content);
          createdCount += 1;
        }
        if (info.openAfterCreate) openTargetPath = filePath;
      }

      await refreshTree();
      await refreshIndex();
      if (openTargetPath) await openFile(openTargetPath);
      setCreationMsg(`叙事制作包已就绪：新建 ${createdCount} 个，保留已有 ${skippedCount} 个`);
      setTimeout(() => setCreationMsg(''), 3000);
    } catch (err: any) {
      showNotice(err.message || '创建叙事制作包失败');
    } finally {
      setGameDocCreating(false);
    }
  }, [vaultPath, gameDocCreating, vault?.name, refreshTree, refreshIndex, openFile]);

  /** Helper: find all filenames within a specific folder from the file tree */
  function findFilesInFolder(tree: FileNode[], folder: string): string[] {
    const results: string[] = [];
    const parts = folder.replace(/\\/g, '/').split('/');
    let nodes = tree;
    for (const part of parts) {
      const found = nodes.find(n => n.name === part && n.isDir);
      if (!found) return results;
      nodes = found.children || [];
    }
    for (const node of nodes) {
      if (!node.isDir && node.name.endsWith('.md')) {
        results.push(node.name);
      }
    }
    return results;
  }

  /* ── Tag click — switch to backlinks tab with Tag Browser ── */
  const handleTagClick = useCallback((tag: string) => {
    setRightTab('backlinks');
  }, []);

  /* ── Generate Manifest ── */
  const handleGenerateManifest = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const manifest = await api.generateVaultManifest(vaultPath);
      setLastManifest(manifest);
    } catch (err) {
      console.error('Failed to generate manifest:', err);
    }
  }, [vaultPath]);

  /* ── List Backups ── */
  const handleListBackups = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const list = await api.listVaultBackups(vaultPath);
      setBackupList(list);
    } catch (err) {
      console.error('Failed to list backups:', err);
    }
  }, [vaultPath]);

  /* ── Auto-load backup list when vault opens ── */
  useEffect(() => { if (vaultPath) handleListBackups(); }, [vaultPath, handleListBackups]);

  /* ── Export Backup ── */
  const handleExportBackup = useCallback(async () => {
    if (!vaultPath) return;
    setBackupBusy(true);
    setBackupLifecycleMessage('');
    try {
      const summary = await api.exportVaultBackup(vaultPath, { keepLatest: backupRetentionLimit });
      setLastBackup(summary);
      if (summary.prunedBackups) setBackupPruneSummary(summary.prunedBackups);
      /* Also update manifest since backup generates one */
      setLastManifest({ vaultId: summary.vaultName, vaultName: summary.vaultName, appVersion: '', generatedAt: summary.generatedAt, fileCount: summary.fileCount, totalSize: summary.totalSize, files: [] });
      const prunedCount = summary.prunedBackups?.deletedCount || 0;
      setBackupLifecycleMessage(prunedCount > 0 ? `已导出备份，并自动清理 ${prunedCount} 个旧备份。` : '已导出备份。');
    } catch (err) {
      console.error('Failed to export backup:', err);
      setBackupLifecycleMessage('导出备份失败。');
    }
    setBackupBusy(false);
    handleListBackups();
  }, [vaultPath, backupRetentionLimit, handleListBackups]);

  const handleAutoBackup = useCallback(async () => {
    if (!vaultPath || backupBusy) return;
    setBackupBusy(true);
    setBackupLifecycleMessage('');
    try {
      const summary = await api.exportVaultBackup(vaultPath, {
        skipIfUnchanged: true,
        keepLatest: backupRetentionLimit,
      });
      if (!summary.skipped) {
        setLastBackup(summary);
        setLastManifest({ vaultId: summary.vaultName, vaultName: summary.vaultName, appVersion: '', generatedAt: summary.generatedAt, fileCount: summary.fileCount, totalSize: summary.totalSize, files: [] });
      }
      if (summary.prunedBackups) setBackupPruneSummary(summary.prunedBackups);
      const prunedCount = summary.prunedBackups?.deletedCount || 0;
      setBackupLifecycleMessage(summary.skipped
        ? (prunedCount > 0 ? `内容未变化，已跳过自动备份，并清理 ${prunedCount} 个旧备份。` : '内容未变化，已跳过自动备份。')
        : (prunedCount > 0 ? `已自动备份，并清理 ${prunedCount} 个旧备份。` : '已自动备份。'));
    } catch (err) {
      console.error('Failed to run auto backup:', err);
      setBackupLifecycleMessage('自动备份失败。');
    } finally {
      setBackupBusy(false);
      handleListBackups();
    }
  }, [vaultPath, backupBusy, backupRetentionLimit, handleListBackups]);

  /* Auto-backup timer (every 30 minutes) */
  useEffect(() => {
    if (!vaultPath) return;
    const interval = setInterval(() => {
      if (!backupBusy && vaultPath) {
        handleAutoBackup();
      }
    }, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [vaultPath, backupBusy, handleAutoBackup]);

  /* ── Restore Backup ── */
  const handleRestoreBackup = useCallback(async (backupPath: string) => {
    if (!vaultPath) return;
    setBackupBusy(true);
    try {
      const summary = await api.restoreVaultBackup(vaultPath, backupPath);
      setRestoreSummary(summary);
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('current vault')) {
        showNotice(t.cannotRestoreToVault, 'warning');
      } else if (msg.includes('backups folder')) {
        showNotice(t.cannotRestoreInBackups, 'warning');
      } else {
        showNotice(msg || t.operationFailed);
      }
    }
    setBackupBusy(false);
  }, [vaultPath, t]);

  /* ── Verify Backup ── */
  const handleListBackupFiles = useCallback(async (backupPath: string) => {
    if (!vaultPath) return;
    setBackupFileLoading(true);
    try {
      const result = await api.listVaultBackupFiles(vaultPath, backupPath);
      setBackupFileList(result);
      setBackupLifecycleMessage(`已打开备份 ${result.backupId}，可以按文件恢复。`);
    } catch (err: any) {
      showNotice(err?.message || t.operationFailed);
      setBackupFileList(null);
    } finally {
      setBackupFileLoading(false);
    }
  }, [vaultPath, t.operationFailed]);

  const handleRestoreBackupFile = useCallback(async (backupPath: string, relativePath: string) => {
    if (!vaultPath) return;
    const confirmed = await showConfirm(
      '恢复单个文件',
      `将从备份恢复 ${relativePath} 到当前 Vault。当前同名文件会先进入 Live History，再被覆盖。确定继续吗？`,
    );
    if (!confirmed) return;
    const busyKey = `${backupPath}:${relativePath}`;
    setRestoringBackupFileKey(busyKey);
    try {
      const summary = await api.restoreVaultBackupFile(vaultPath, backupPath, relativePath);
      setBackupFileRestoreSummary(summary);
      setBackupLifecycleMessage(`已恢复 ${summary.relativePath}，覆盖前版本已写入 Live History。`);
      await refreshTree();
      await refreshIndex();
      const restoredFullPath = resolveVaultRelativeFile(vaultPath, summary.relativePath);
      if (normalizePath(restoredFullPath).toLowerCase() === normalizePath(currentFile).toLowerCase()) {
        const content = await api.readFile(currentFile);
        setCurrentContent(content);
        setSavedContent(content);
        setSaveStatus('saved');
      }
    } catch (err: any) {
      showNotice(err?.message || t.operationFailed);
    } finally {
      setRestoringBackupFileKey('');
    }
  }, [currentFile, refreshIndex, refreshTree, showConfirm, t.operationFailed, vaultPath]);

  const handleVerifyBackup = useCallback(async (backupPath: string, backupId: string) => {
    if (!vaultPath) return;
    setVerifyingBackupId(backupId);
    setBackupVerifyResult(null);
    try {
      const result = await api.verifyVaultBackup(vaultPath, backupPath);
      setBackupVerifyResult(result);
    } catch (err) {
      console.error('Failed to verify backup:', err);
    }
    setVerifyingBackupId('');
  }, [vaultPath]);

  /* ── Sync Config ── */
  const handleDeleteBackup = useCallback(async (backupPath: string, backupId: string) => {
    if (!vaultPath) return;
    setDeletingBackupId(backupId);
    try {
      await api.deleteVaultBackup(vaultPath, backupPath);
      setBackupList((list) => list.filter((bk) => bk.backupId !== backupId));
      setLastBackup((backup) => backup?.backupId === backupId ? null : backup);
      setBackupVerifyResult((result) => result?.backupId === backupId ? null : result);
      setBackupFileList((result) => result?.backupId === backupId ? null : result);
    } catch (err: any) {
      showNotice(err?.message || t.operationFailed);
    } finally {
      setDeletingBackupId('');
      handleListBackups();
    }
  }, [vaultPath, handleListBackups, t.operationFailed]);

  const handleBackupRetentionLimitChange = useCallback((value: number) => {
    const next = Math.max(1, Math.min(200, Math.floor(Number(value) || 20)));
    setBackupRetentionLimit(next);
  }, []);

  const handlePruneBackups = useCallback(async () => {
    if (!vaultPath) return;
    setBackupPruneBusy(true);
    setBackupLifecycleMessage('');
    try {
      const result = await api.pruneVaultBackups(vaultPath, backupRetentionLimit);
      setBackupPruneSummary(result);
      setBackupLifecycleMessage(result.deletedCount > 0
        ? `已清理 ${result.deletedCount} 个旧备份，释放 ${formatBytes(result.deletedSize)}。`
        : `没有需要清理的旧备份，当前保留最近 ${result.keepLatest} 个。`);
    } catch (err: any) {
      showNotice(err?.message || t.operationFailed);
      setBackupLifecycleMessage('清理旧备份失败。');
    } finally {
      setBackupPruneBusy(false);
      handleListBackups();
    }
  }, [vaultPath, backupRetentionLimit, handleListBackups, t.operationFailed]);

  const handleLoadSyncConfig = useCallback(async () => {
    if (!vaultPath) return;
    const requestedVaultPath = vaultPath;
    try {
      const config = await api.loadSyncConfig(requestedVaultPath);
      if (activeVaultPathRef.current !== requestedVaultPath) return;
      setSyncConfig(config);
    } catch (err) {
      if (activeVaultPathRef.current !== requestedVaultPath) return;
      console.error('Failed to load sync config:', err);
    }
  }, [vaultPath]);

  const handleSaveSyncConfig = useCallback(async (config: SyncConfig) => {
    if (!vaultPath) return;
    try {
      const saved = await api.saveSyncConfig(vaultPath, config);
      setSyncConfig(saved);
      if (saved.enabled && saved.provider === 'self-hosted' && saved.endpoint && api.liveSyncStart) {
        const storedLiveConfig: any = await api.liveSyncLoadConfig?.(vaultPath).catch(() => null) || {};
        const liveConfig = {
          enabled: true,
          serverUrl: saved.endpoint,
          apiKey: storedLiveConfig.apiKey || undefined,
          vaultId: saved.remoteVaultId,
        };
        localStorage.setItem('ars-note.live-sync', JSON.stringify(createLiveSyncRendererHint(vaultPath, {
          serverUrl: liveConfig.serverUrl,
          vaultId: liveConfig.vaultId || vault?.vaultId || '',
          connectionMode: 'join',
        })));
        api.liveSyncSaveConfig?.(vaultPath, liveConfig).catch(() => {});
        api.liveSyncStart(vaultPath, liveConfig).catch(() => {});
      }
      /* Re-validate provider after save */
      if (vaultPath) {
        try {
          const vr = await api.validateProviderConfig(vaultPath);
          setProviderValidation(vr);
        } catch { /* ignore */ }
      }
    } catch (err) {
      console.error('Failed to save sync config:', err);
      showNotice((err as any)?.message || t.operationFailed, 'error', 6200);
    }
  }, [showNotice, t.operationFailed, vault?.vaultId, vaultPath]);

  /* ── Auto-load sync config when vault opens ── */
  useEffect(() => { if (vaultPath) handleLoadSyncConfig(); }, [vaultPath, handleLoadSyncConfig]);

  /* ── Compute provider validation when syncConfig changes (v0.5.2) ── */
  useEffect(() => {
    if (!syncConfig) { setProviderValidation(null); return; }
    const cloudId = mapSyncProviderToCloudId(syncConfig.provider);
    const result = validateProviderConfigFn(cloudId, syncConfig);
    setProviderValidation(result);
  }, [syncConfig]);

  /* ── Cloud Backup Handlers ── */
  const pruneRemoteBackupsIfNeeded = useCallback(async (backups: RemoteBackupItem[]) => {
    if (!vaultPath || backupRetentionLimit < 1 || backups.length <= backupRetentionLimit) return backups;

    const byNewest = [...backups].sort((a, b) => {
      const left = Date.parse(a.uploadedAt || '');
      const right = Date.parse(b.uploadedAt || '');
      return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
    });
    const keep = byNewest.slice(0, backupRetentionLimit);
    const stale = byNewest.slice(backupRetentionLimit);
    const failed: RemoteBackupItem[] = [];
    let deletedCount = 0;

    for (const backup of stale) {
      try {
        await api.deleteRemoteBackup(vaultPath, backup.remoteId);
        deletedCount += 1;
      } catch (err) {
        console.error('Failed to prune remote backup:', backup.remoteId, err);
        failed.push(backup);
      }
    }

    if (deletedCount > 0 && failed.length === 0) {
      setBackupLifecycleMessage(`远程备份已保留最近 ${backupRetentionLimit} 个，清理 ${deletedCount} 个旧备份。`);
    } else if (deletedCount > 0 || failed.length > 0) {
      setBackupLifecycleMessage(`远程备份清理完成 ${deletedCount} 个，失败 ${failed.length} 个。失败时通常需要先重新部署自建同步服务器。`);
    }

    return [...keep, ...failed].sort((a, b) => {
      const left = Date.parse(a.uploadedAt || '');
      const right = Date.parse(b.uploadedAt || '');
      return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
    });
  }, [vaultPath, backupRetentionLimit]);

  const handleUploadBackupToRemote = useCallback(async (backupPath: string) => {
    if (!vaultPath) return;
    setCloudBusy(true);
    try {
      const summary = await api.uploadBackupToRemote(vaultPath, backupPath);
      setCloudUploadSummary(summary);
      /* Refresh remote backup list after upload */
      const list = await api.listRemoteBackups(vaultPath);
      setRemoteBackups(await pruneRemoteBackupsIfNeeded(list));
    } catch (err) {
      console.error('Failed to upload backup to remote:', err);
    }
    setCloudBusy(false);
  }, [vaultPath, pruneRemoteBackupsIfNeeded]);

  const handleDeleteRemoteBackup = useCallback(async (remoteId: string) => {
    if (!vaultPath) return;
    setDeletingRemoteBackupId(remoteId);
    try {
      await api.deleteRemoteBackup(vaultPath, remoteId);
      setRemoteBackups((list) => list.filter((backup) => backup.remoteId !== remoteId));
      if (cloudUploadSummary?.remoteId === remoteId) setCloudUploadSummary(null);
      const list = await api.listRemoteBackups(vaultPath);
      setRemoteBackups(list);
    } catch (err: any) {
      console.error('Failed to delete remote backup:', err);
      showNotice(err?.message || t.operationFailed);
    } finally {
      setDeletingRemoteBackupId('');
    }
  }, [vaultPath, cloudUploadSummary, t.operationFailed]);

  const handleListRemoteBackups = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const list = await api.listRemoteBackups(vaultPath);
      setRemoteBackups(list);
    } catch (err) {
      console.error('Failed to list remote backups:', err);
    }
  }, [vaultPath]);

  const handleDownloadRemoteBackup = useCallback(async (remoteId: string) => {
    if (!vaultPath) return;
    setCloudBusy(true);
    try {
      const summary = await api.downloadRemoteBackup(vaultPath, remoteId);
      setCloudDownloadSummary(summary);
      /* Refresh downloaded backups list */
      const dlList = await api.listDownloadedBackups(vaultPath);
      setDownloadedBackups(dlList);
    } catch (err) {
      console.error('Failed to download remote backup:', err);
    }
    setCloudBusy(false);
  }, [vaultPath]);

  /* ── S3 Runtime Credentials Handlers (v0.5.3) ── */
  const handleSetS3Credentials = useCallback(async (credentials: S3RuntimeCredentials) => {
    if (!vaultPath) return;
    try {
      const status = await api.setS3RuntimeCredentials(vaultPath, credentials);
      setS3CredentialStatus(status);
      /* Re-validate provider after setting credentials */
      const vr = await api.validateProviderConfig(vaultPath);
      setProviderValidation(vr);
    } catch (err) {
      console.error('Failed to set S3 credentials:', err);
    }
  }, [vaultPath]);

  const handleClearS3Credentials = useCallback(async () => {
    if (!vaultPath) return;
    try {
      await api.clearS3RuntimeCredentials(vaultPath);
      setS3CredentialStatus({ hasCredentials: false });
      setS3ConnectionTest(null);
      /* Re-validate provider after clearing credentials */
      const vr = await api.validateProviderConfig(vaultPath);
      setProviderValidation(vr);
    } catch (err) {
      console.error('Failed to clear S3 credentials:', err);
    }
  }, [vaultPath]);

  /* ── Self-hosted Credentials (v0.8.2) ── */
  const handleSetSelfHostedCredentials = useCallback(async (credentials: SelfHostedRuntimeCredentials) => {
    if (!vaultPath) return;
    try {
      const status = await api.setSelfHostedRuntimeCredentials(vaultPath, credentials);
      setSelfHostedCredentialStatus(status);
      if (credentials.endpoint && api.liveSyncStart) {
        const liveConfig = {
          enabled: true,
          serverUrl: credentials.endpoint,
          apiKey: credentials.apiKey || undefined,
          vaultId: syncConfig?.remoteVaultId,
        };
        localStorage.setItem('ars-note.live-sync', JSON.stringify(createLiveSyncRendererHint(vaultPath, {
          serverUrl: liveConfig.serverUrl,
          vaultId: liveConfig.vaultId || vault?.vaultId || '',
          connectionMode: 'join',
        })));
        api.liveSyncSaveConfig?.(vaultPath, liveConfig).catch(() => {});
        api.liveSyncStart(vaultPath, liveConfig).catch(() => {});
      }
      const vr = await api.validateProviderConfig(vaultPath);
      setProviderValidation(vr);
    } catch (err) {
      console.error('Failed to set self-hosted credentials:', err);
    }
  }, [vault?.vaultId, vaultPath, syncConfig?.remoteVaultId]);

  const handleClearSelfHostedCredentials = useCallback(async () => {
    if (!vaultPath) return;
    try {
      await api.clearSelfHostedRuntimeCredentials(vaultPath);
      setSelfHostedCredentialStatus({ hasCredentials: false });
      const vr = await api.validateProviderConfig(vaultPath);
      setProviderValidation(vr);
    } catch (err) {
      console.error('Failed to clear self-hosted credentials:', err);
    }
  }, [vaultPath]);

  const handleTestS3Connection = useCallback(async () => {
    if (!vaultPath) return;
    setS3Testing(true);
    try {
      const result = await api.testS3Connection(vaultPath);
      setS3ConnectionTest(result);
    } catch (err) {
      console.error('S3 connection test failed:', err);
    }
    setS3Testing(false);
  }, [vaultPath]);

  /* ── Manual Sync: Compare Local vs Remote (v0.6.0) ── */
  const handleCompareLocalRemote = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const result = await api.compareLocalRemoteState(vaultPath);
      setSyncCompareResult(result);
    } catch (err) {
      console.error('Failed to compare local vs remote:', err);
    }
  }, [vaultPath]);

  /* ── Manual Push: export + verify + upload (v0.6.0) ── */
  const handleManualPush = useCallback(async () => {
    if (!vaultPath) return;
    setSyncBusy(true);
    try {
      // 1. Export backup
      const backupSummary = await api.exportVaultBackup(vaultPath, { keepLatest: backupRetentionLimit });
      // 2. Verify backup
      await api.verifyVaultBackup(vaultPath, backupSummary.backupPath);
      // 3. Upload to remote
      await api.uploadBackupToRemote(vaultPath, backupSummary.backupPath);
      // 4. Refresh remote list
      const list = await api.listRemoteBackups(vaultPath);
      setRemoteBackups(await pruneRemoteBackupsIfNeeded(list));
      // 5. Re-compare
      const result = await api.compareLocalRemoteState(vaultPath);
      setSyncCompareResult(result);
    } catch (err) {
      console.error('Manual push failed:', err);
    }
    setSyncBusy(false);
  }, [vaultPath, backupRetentionLimit, pruneRemoteBackupsIfNeeded]);

  /* ── Manual Pull: download latest remote (v0.6.0) ── */
  const handleManualPull = useCallback(async (remoteId: string) => {
    if (!vaultPath) return;
    setSyncBusy(true);
    try {
      // 1. Download remote backup
      await api.downloadRemoteBackup(vaultPath, remoteId);
      // 2. Refresh downloaded backups list
      const dlList = await api.listDownloadedBackups(vaultPath);
      setDownloadedBackups(dlList);
      // 3. Re-compare
      const result = await api.compareLocalRemoteState(vaultPath);
      setSyncCompareResult(result);
    } catch (err) {
      console.error('Manual pull failed:', err);
    }
    setSyncBusy(false);
  }, [vaultPath]);

  /* ── Compare Local with Specific Remote Backup (v0.6.1) ── */
  const handleCompareWithRemote = useCallback(async (remoteId: string) => {
    if (!vaultPath) return;
    try {
      const result = await api.compareLocalWithRemoteBackup(vaultPath, remoteId);
      setSyncCompareResult(result);
    } catch (err) {
      console.error('Failed to compare with remote backup:', err);
    }
  }, [vaultPath]);

  /* ── Preview File-level Diff (v0.6.2) ── */
  const handlePreviewRemoteDiff = useCallback(async (remoteId: string) => {
    if (!vaultPath) return;
    setSyncPreviewBusy(true);
    try {
      const result = await api.compareLocalWithRemoteFiles(vaultPath, remoteId);
      setSyncPreview(result);
    } catch (err) {
      console.error('Failed to preview remote diff:', err);
    }
    setSyncPreviewBusy(false);
  }, [vaultPath]);

  const handleLoadS3CredentialStatus = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const status = await api.getS3CredentialStatus(vaultPath);
      setS3CredentialStatus(status);
    } catch (err) {
      console.error('Failed to get S3 credential status:', err);
    }
  }, [vaultPath]);

  /* Auto-load S3 credential status when vault opens */
  useEffect(() => { if (vaultPath) handleLoadS3CredentialStatus(); }, [vaultPath, handleLoadS3CredentialStatus]);

  /* ── Downloaded Backup Handlers ── */
  const handleListDownloadedBackups = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const list = await api.listDownloadedBackups(vaultPath);
      setDownloadedBackups(list);
    } catch (err) {
      console.error('Failed to list downloaded backups:', err);
    }
  }, [vaultPath]);

  const handleVerifyDownloadedBackup = useCallback(async (downloadedPath: string) => {
    if (!vaultPath) return;
    setDownloadedBusy(true);
    try {
      const result = await api.verifyDownloadedBackup(vaultPath, downloadedPath);
      setDownloadedVerifyResult(result);
    } catch (err) {
      console.error('Failed to verify downloaded backup:', err);
    }
    setDownloadedBusy(false);
  }, [vaultPath]);

  const handleRestoreDownloadedBackup = useCallback(async (downloadedPath: string) => {
    if (!vaultPath) return;
    setDownloadedBusy(true);
    try {
      if (currentFile && currentContent !== savedContent) {
        await api.writeFile(currentFile, currentContent);
        setSavedContent(currentContent);
      }
      const summary = await api.restoreDownloadedBackup(vaultPath, downloadedPath);
      setDownloadedRestoreSummary(summary);
      const restoredVault = await api.openVault(summary.restoredTo);
      if (!restoredVault) {
        showNotice(`${t.operationFailed}\n${summary.restoredTo}`);
        return;
      }
      applyVaultResult(restoredVault);
      await openDefaultVaultFile(restoredVault);
      await refreshTree();
      await refreshIndex();
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('current vault')) {
        showNotice(t.cannotRestoreToVault, 'warning');
      } else {
        showNotice(msg || t.operationFailed);
      }
    } finally {
      setDownloadedBusy(false);
    }
  }, [vaultPath, currentFile, currentContent, savedContent, t, applyVaultResult, openDefaultVaultFile, refreshTree, refreshIndex]);

  /* ── Search ── */
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (!vaultPath || !query.trim()) { setSearchResults([]); return; }
    try { const results = await api.searchFiles(vaultPath, query); setSearchResults(results); }
    catch (err) { console.error('Search failed:', err); setSearchResults([]); }
  }, [vaultPath]);



  /* ── AI config handlers ── */
  const handleAISaveConfig = useCallback(async (config: AIProviderConfig) => {
    if (!vaultPath) return;
    try {
      await api.setAIRuntimeConfig(vaultPath, { provider: config.provider || 'openai-compatible', baseUrl: config.baseUrl || '', model: config.model || '', apiKey: aiFormApiKey });
      setAiConfig(config);
      setCreationMsg('AI config saved');
      setTimeout(() => setCreationMsg(''), 2000);
    } catch (err: any) { console.error('AI save failed:', err); }
  }, [vaultPath, aiFormApiKey]);

  const handleAITestConnection = useCallback(async () => {
    if (!vaultPath) return;
    setAiTesting(true);
    try {
      await api.setAIRuntimeConfig(vaultPath, { provider: aiFormProvider, baseUrl: aiFormBaseUrl, model: aiFormModel, apiKey: aiFormApiKey });
      const result = await api.testAIConnection(vaultPath);
      setAiTestResult(result);
      if (result.ok) { setAiConfig(prev => ({ ...prev, hasApiKey: true, provider: aiFormProvider as any, model: result.model || aiFormModel })); }
    } catch (err: any) { setAiTestResult({ ok: false, error: err.message, testedAt: new Date().toISOString() }); }
    finally { setAiTesting(false); }
  }, [vaultPath, aiFormProvider, aiFormBaseUrl, aiFormModel, aiFormApiKey]);

  const handleAIClearConfig = useCallback(async () => {
    if (!vaultPath) return;
    try {
      await api.clearAIRuntimeConfig(vaultPath);
      setAiConfig({ provider: 'openai-compatible' as any, baseUrl: '', model: '', hasApiKey: false, enabled: false });
      setAiFormProvider('openai-compatible');
      setAiFormBaseUrl('');
      setAiFormModel('gpt-4o-mini');
      setAiFormApiKey('');
      setAiTestResult(null);
    } catch (err: any) { console.error('AI clear failed:', err); }
  }, [vaultPath]);

  const gameWorkspace = useMemo(() => {
    if (!vaultPath) return { summary: undefined as GameWorkspaceSummary | undefined, entries: [] as GameWorkspaceEntry[], grouped: undefined as Record<any, GameWorkspaceEntry[]> | undefined };
    const result = scanGameWorkspace(vaultIndex);
    return { summary: result.summary, entries: result.entries, grouped: result.grouped };
  }, [vaultIndex, vaultPath, fileTree]);

  const handleAISendChat = useCallback(async (userPrompt: string) => {
    if (!vaultPath || aiSending || !userPrompt.trim()) return;
    if (!aiConfig.hasApiKey && !aiConfig.baseUrl) {
      setAiChatMessages((prev) => [...prev, { role: 'assistant' as const, content: t.aiNotConfigured, createdAt: new Date().toISOString() }]);
      return;
    }
    const normalizedPrompt = userPrompt.trim();
    const userMsg: AIChatMessage = { role: 'user', content: normalizedPrompt, createdAt: new Date().toISOString() };
    const requestId = globalThis.crypto?.randomUUID?.() || `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    activeAIRequestIdRef.current = requestId;
    setAiChatMessages((prev) => [...prev, userMsg]);
    setAiSending(true);
    setAiRetryPrompt('');
    setAiInput('');
    setAiLiveToolCalls([]); // clear live progress
    try {
      const selectedText = editorRef.current?.getSelection?.() || '';
      const inferredFileContext = await buildAIReferencedFileContext({
        prompt: userPrompt,
        vaultPath,
        currentFile,
        currentContent,
        fileTree,
      });
      const promptForAI = inferredFileContext
        ? `${inferredFileContext}\n\n---\n\nUser request:\n${userPrompt}`
        : userPrompt;
      const teamScheduleContext = aiContextMode === 'gameWorkspace'
        ? await buildAITeamScheduleContext(vaultPath)
        : undefined;

      const builtRequest = buildAIChatRequest(promptForAI, {
        prompt: userPrompt,
        contextMode: aiContextMode,
        currentFilePath: currentFile,
        currentFileContent: deferredCurrentContent,
        selectedText,
        gameWorkspaceSummary: gameWorkspace.summary ?? undefined,
        gameWorkspaceEntries: gameWorkspace.entries,
        teamScheduleContext,
        arshisContext: buildArshisContextMarkdown(buildArshisGameContext(gameWorkspace.summary!, gameWorkspace.entries, vault?.name || '')),
      }, aiChatMessages);
      setAiContextUsage(builtRequest.usage);
      const contextMessages = builtRequest.messages;
      const currentFilePath = currentFile
        ? normalizePath(currentFile.replace(vaultPath, '').replace(/^[\\/]/, ''))
        : undefined;
      const response: AIResponse = await api.sendAIChat(vaultPath, contextMessages, {
        controlMode: aiControlMode,
        requestId,
        currentFilePath,
      });
      if (response.contextUsage) setAiContextUsage(response.contextUsage);
      if (response.ok) {
        const toolCalls = (response as any).toolCalls as import('./types').AIToolCallRecord[] | undefined;
        let assistantContent = response.content || '(AI completed file operations with no text response)';
        const finalToolCalls: import('./types').AIToolCallRecord[] | undefined =
          toolCalls && toolCalls.length > 0 ? toolCalls.map(tc => ({ name: tc.name, args: tc.args, result: tc.result, status: 'done' as const, artifacts: tc.artifacts })) : undefined;
        if (toolCalls && toolCalls.length > 0) {
          await refreshTree();
          await refreshIndex();
          if (currentFile) {
            try { const updated = await api.readFile(currentFile); setCurrentContent(updated); setSavedContent(updated); } catch {}
          }
        }
        setAiChatMessages((prev) => [...prev, {
          role: 'assistant' as const,
          content: assistantContent,
          createdAt: response.createdAt,
          toolCalls: finalToolCalls,
        }]);
      } else {
        setAiRetryPrompt(normalizedPrompt);
        const failureMessage = response.cancelled
          ? t.aiRequestCancelled
          : response.timedOut
            ? t.aiRequestTimedOut
            : 'Error: ' + (response.error || 'Unknown error');
        setAiChatMessages((prev) => [...prev, { role: 'assistant' as const, content: failureMessage, createdAt: response.createdAt }]);
      }
    } catch (err: any) {
      setAiRetryPrompt(normalizedPrompt);
      setAiChatMessages((prev) => [...prev, { role: 'assistant' as const, content: 'Error: ' + err.message, createdAt: new Date().toISOString() }]);
    } finally {
      if (activeAIRequestIdRef.current === requestId) activeAIRequestIdRef.current = null;
      setAiSending(false);
      setAiLiveToolCalls([]);
    }
  }, [vaultPath, aiSending, aiConfig, aiContextMode, aiControlMode, currentFile, currentContent, fileTree, gameWorkspace, vault, t, refreshTree, refreshIndex]);

  const handleAICancelChat = useCallback(async () => {
    const requestId = activeAIRequestIdRef.current;
    if (!requestId) return;
    try {
      await api.cancelAIChat(requestId);
    } catch (err: any) {
      showNotice(err?.message || 'Unable to stop the AI request.', 'error');
    }
  }, []);

  /* ── Render helpers ── */
  const handleImportTasksToSchedule = useCallback(async (
    tasks: ExtractedTeamTask[],
    sourceLabel = '导入',
  ): Promise<TeamScheduleImportResult> => {
    if (!vaultPath) {
      throw new Error('No vault is open');
    }
    const imported = api.upsertTeamTasks
      ? await api.upsertTeamTasks(vaultPath, tasks as any, sourceLabel)
      : await importTasksToTeamSchedule(vaultPath, tasks, { sourceLabel });
    const changedCount = imported.importedCount + (imported.updatedCount || 0);
    let productionDocPaths: string[] = [];
    let taskDocCreatedCount = 0;
    let taskDocLinkedCount = 0;
    let taskDocSkippedCount = 0;
    let taskDocPaths: string[] = [];
    let taskDocUpgradedCount = 0;
    if (changedCount > 0) {
      const rawSchedulePath = imported.schedulePath || '';
      const normalizedSchedulePath = normalizePath(rawSchedulePath);
      const schedulePath = /^[a-zA-Z]:\//.test(normalizedSchedulePath) || normalizedSchedulePath.startsWith('/') || normalizedSchedulePath.startsWith('//')
        ? rawSchedulePath
        : await api.joinPath(vaultPath, ...normalizedSchedulePath.split('/').filter(Boolean));
      scheduleLivePush(schedulePath, imported.content);
      const generated = await api.generateTeamProductionDocs(vaultPath, {
        includeHandoff: true,
        includeAiMemoryIndex: true,
        includeLinkHealth: true,
        includeDependencyMap: true,
        includeBlockerHandoff: true,
        includeReviewQueue: true,
        includeWorkpack: true,
        includeDailyStandup: true,
        includeTimesheet: true,
        includeRoadmap: true,
        includeDecisionLog: true,
        includeChangeImpact: true,
        includeNarrativeDirector: true,
        includeSprintPlan: true,
        includeMemberPages: true,
        includeTaskDocs: true,
        includeTeamCommandCenter: true,
        includeDashboard: true,
      });
      productionDocPaths = Array.isArray(generated?.paths) ? generated.paths : [];
      const taskDocs = generated?.summary?.taskDocs || {};
      taskDocCreatedCount = Number(taskDocs.createdCount || 0);
      taskDocLinkedCount = Number(taskDocs.linkedCount || 0);
      taskDocUpgradedCount = Number(taskDocs.upgradedCount || 0);
      taskDocSkippedCount = Number(taskDocs.skippedCount || 0);
      taskDocPaths = Array.isArray(taskDocs.paths) ? taskDocs.paths : [];
      await refreshTree();
      await refreshIndex();
    }
    return { ...imported, productionDocPaths, taskDocCreatedCount, taskDocLinkedCount, taskDocUpgradedCount, taskDocSkippedCount, taskDocPaths };
  }, [refreshIndex, refreshTree, scheduleLivePush, vaultPath]);

  const handleOpenTeamWorkspace = useCallback(async () => {
    if (!vaultPath || teamWorkspaceOpening) return;

    setShowCenterSchedule(true);
    setShowCenterAI(false);
    setShowCenterGraph(false);
    setShowBalanceLab(false);
    revealRightPanel();
    setRightTab('game');

    setTeamWorkspaceOpening(true);
    try {
      const result = await api.bootstrapTeamWorkspace(vaultPath, { limit: 48 });
      const rawSchedulePath = result.schedulePath || result.upsert?.schedulePath || '';
      if (rawSchedulePath && result.content) {
        const normalizedSchedulePath = normalizePath(rawSchedulePath);
        const schedulePath = /^[a-zA-Z]:\//.test(normalizedSchedulePath) || normalizedSchedulePath.startsWith('/') || normalizedSchedulePath.startsWith('//')
          ? rawSchedulePath
          : await api.joinPath(vaultPath, ...normalizedSchedulePath.split('/').filter(Boolean));
        scheduleLivePush(schedulePath, result.content);
      }
      await refreshTree();
      await refreshIndex();

      const importedCount = Number(result.upsert?.importedCount || 0);
      const updatedCount = Number(result.upsert?.updatedCount || 0);
      const docCount = Array.isArray(result.productionDocs?.paths) ? result.productionDocs.paths.length : 0;
      const taskDocs = result.productionDocs?.summary?.taskDocs || {};
      showNotice(
        `Ars-note 团队工作台已准备好：新增 ${importedCount} 个任务，更新 ${updatedCount} 个任务，刷新 ${docCount} 个团队文档；任务文档创建 ${Number(taskDocs.createdCount || 0)}、关联 ${Number(taskDocs.linkedCount || 0)}、升级 ${Number(taskDocs.upgradedCount || 0)}。`,
        'success',
        6500,
      );
    } catch (err: any) {
      showNotice(err?.message || '打开 Ars-note 团队工作台失败');
    } finally {
      setTeamWorkspaceOpening(false);
    }
  }, [refreshIndex, refreshTree, revealRightPanel, scheduleLivePush, showNotice, teamWorkspaceOpening, vaultPath]);

  const handleAIImportTasksToSchedule = useCallback(async () => {
    if (!vaultPath) return;
    const lastAssistant = [...aiChatMessages].reverse().find((message) => message.role === 'assistant');
    if (!lastAssistant?.content) {
      showNotice('没有可导入的 AI 回复。', 'warning');
      return;
    }

    const extracted = extractTeamTasksFromAIResponse(lastAssistant.content, 30);
    if (extracted.length === 0) {
      showNotice('没有从最近的 AI 回复里识别到明确任务。可以让 AI 输出“任务表 / 行动项 / 负责人 / 截止日期”后再导入。', 'warning', 6200);
      return;
    }

    const confirmed = await showConfirm(
      '导入团队任务',
      `将从最近 AI 回复中提取 ${extracted.length} 个任务并加入团队时间表。\n\n已存在的同名任务会自动跳过。是否继续？`,
    );
    if (!confirmed) return;

    try {
      const imported = await handleImportTasksToSchedule(extracted, '由 AI 回复导入');
      const changedCount = imported.importedCount + (imported.updatedCount || 0);
      if (changedCount === 0) {
        showNotice('这些任务已经在团队时间表里了，没有重复导入。', 'info');
        return;
      }
      const taskDocNote = imported.taskDocCreatedCount ? `补齐 ${imported.taskDocCreatedCount} 个任务文档。` : '';
      showNotice(`已处理 ${changedCount} 个任务：新增 ${imported.importedCount}，更新 ${imported.updatedCount || 0}。已刷新 ${imported.productionDocPaths?.length || 0} 个团队执行文档。${taskDocNote}`, 'success');
    } catch (err: any) {
      showNotice(err?.message || '导入团队任务失败。', 'error');
    }
  }, [aiChatMessages, handleImportTasksToSchedule, showConfirm, showNotice, vaultPath]);

  const handleImportCurrentDocumentTasks = useCallback(async (): Promise<{ extractedCount: number; importedCount: number; updatedCount?: number; skippedCount: number; productionDocPaths?: string[]; taskDocCreatedCount?: number; taskDocLinkedCount?: number; taskDocUpgradedCount?: number; taskDocSkippedCount?: number; taskDocPaths?: string[] }> => {
    if (!vaultPath || !currentFile) {
      throw new Error('请先打开一个 Markdown 文档。');
    }
    const relativePath = normalizePath(currentFile.replace(vaultPath, '').replace(/^[\\/]/, ''));
    if (!/\.md$/i.test(relativePath)) {
      throw new Error('当前打开的文件不是 Markdown 文档，暂时不能抽取任务。');
    }
    const extracted = extractTeamTasksFromMarkdownContent(currentContent, relativePath, 50);
    if (extracted.length === 0) {
      return { extractedCount: 0, importedCount: 0, skippedCount: 0 };
    }
    const imported = await handleImportTasksToSchedule(extracted, `由当前文档导入：${relativePath}`);
    return {
      extractedCount: extracted.length,
      importedCount: imported.importedCount,
      updatedCount: imported.updatedCount,
      skippedCount: imported.skippedCount,
      productionDocPaths: imported.productionDocPaths,
      taskDocCreatedCount: imported.taskDocCreatedCount,
      taskDocLinkedCount: imported.taskDocLinkedCount,
      taskDocUpgradedCount: imported.taskDocUpgradedCount,
      taskDocSkippedCount: imported.taskDocSkippedCount,
      taskDocPaths: imported.taskDocPaths,
    };
  }, [currentContent, currentFile, handleImportTasksToSchedule, vaultPath]);

  const isDirty = currentContent !== savedContent;
  const currentFileName = currentFile ? currentFile.split(/[\\/]/).pop() || '' : '';
  const currentFileRelPath = vaultPath && currentFile ? currentFile.replace(vaultPath, '').replace(/^[\\/]/, '') : '';
  const currentFileBreadcrumbs = useMemo(() => {
    const parts = normalizePath(currentFileRelPath).split('/').filter(Boolean);
    return parts.map((label, index) => ({
      label,
      path: parts.slice(0, index + 1).join('/'),
      isFile: index === parts.length - 1,
    }));
  }, [currentFileRelPath]);
  const isMarkdownFile = currentFile ? currentFile.toLowerCase().endsWith('.md') : false;
  const isExcalidrawFile = currentFile ? currentFile.toLowerCase().endsWith('.excalidraw') : false;
  const isCanvasFile = currentFile ? currentFile.toLowerCase().endsWith('.canvas') : false;
  const aiBusy = aiSending;
  const aiContextMeterVisible = showCenterAI || (!rightCollapsed && rightTab === 'ai');
  const aiContextUsagePreview = useMemo(() => {
    if (!aiContextMeterVisible) return aiContextUsage;
    const prompt = debouncedAIInput.trim() || ' ';
    try {
      const arshisContext = gameWorkspace.summary
        ? buildArshisContextMarkdown(buildArshisGameContext(gameWorkspace.summary, gameWorkspace.entries, vault?.name || ''))
        : undefined;
      return buildAIChatRequest(prompt, {
        prompt,
        contextMode: aiContextMode,
        currentFilePath: currentFile,
        currentFileContent: currentContent,
        selectedText: editorRef.current?.getSelection?.() || '',
        gameWorkspaceSummary: gameWorkspace.summary ?? undefined,
        gameWorkspaceEntries: gameWorkspace.entries,
        teamScheduleContext: aiContextMode === 'gameWorkspace' ? aiTeamScheduleContextPreview : undefined,
        arshisContext,
      }, aiChatMessages).usage;
    } catch {
      return estimateAIContextUsageFromMessages(aiChatMessages, debouncedAIInput, AI_CONTEXT_TOKEN_LIMIT);
    }
  }, [aiChatMessages, aiContextMode, aiContextMeterVisible, aiContextUsage, aiTeamScheduleContextPreview, deferredCurrentContent, currentFile, debouncedAIInput, gameWorkspace.entries, gameWorkspace.summary, vault?.name]);
  const visibleAIContextUsage = useMemo(() => {
    if (aiSending) return aiContextUsage;
    return aiContextUsagePreview;
  }, [aiContextUsage, aiContextUsagePreview, aiSending]);
  const rightPanelDocumentContent = rightTab === 'preview' || rightTab === 'outline'
    ? deferredCurrentContent
    : '';
  const editorPreviewContent = viewMode === 'split' ? deferredCurrentContent : currentContent;
  const editorPreviewHtml = useMemo(() => (
    viewMode === 'preview' || viewMode === 'split'
      ? renderMarkdownHtml(editorPreviewContent)
      : ''
  ), [editorPreviewContent, viewMode]);
  const handleRightPanelJumpToLine = useCallback((line: number) => {
    const view = editorRef.current?.getView();
    if (!view) return;
    const pos = view.state.doc.line(Math.min(line, view.state.doc.lines)).from;
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
  }, []);
  const handleRightPanelAISaveConfig = useCallback(async () => {
    await handleAISaveConfig({
      provider: aiFormProvider as any,
      baseUrl: aiFormBaseUrl,
      model: aiFormModel,
      hasApiKey: !!aiFormApiKey,
      enabled: true,
    });
  }, [aiFormApiKey, aiFormBaseUrl, aiFormModel, aiFormProvider, handleAISaveConfig]);
  const handleRightPanelAIFormChange = useCallback((field: string, value: string) => {
    if (field === 'provider') setAiFormProvider(value);
    else if (field === 'baseUrl') setAiFormBaseUrl(value);
    else if (field === 'model') setAiFormModel(value);
    else if (field === 'apiKey') setAiFormApiKey(value);
  }, []);
  const handleRightPanelAIRetry = useCallback(async () => {
    await handleAISendChat(aiRetryPrompt);
  }, [aiRetryPrompt, handleAISendChat]);
  const handleRightPanelRefreshVault = useCallback(async () => {
    await refreshTree();
    await refreshIndex();
  }, [refreshIndex, refreshTree]);
  const handleRightPanelCopyResponse = useCallback(() => {
    const lastAssistant = [...aiChatMessages].reverse().find(message => message.role === 'assistant');
    if (!lastAssistant) return;
    navigator.clipboard.writeText(lastAssistant.content)
      .then(() => {
        setAiCopiedResponse(true);
        setTimeout(() => setAiCopiedResponse(false), 2000);
      })
      .catch(() => {});
  }, [aiChatMessages]);
  const handleToggleFocusMode = useCallback(() => setFocusMode(current => !current), []);
  const handleOpenShortcutGuide = useCallback(() => setShowShortcutGuide(true), []);
  const handleSidebarNewFile = useCallback(() => {
    setContextTarget(vaultPath);
    setShowNewFile(true);
  }, [vaultPath]);
  const handleSidebarNewFolder = useCallback(() => {
    setContextTarget(vaultPath);
    setShowNewFolder(true);
  }, [vaultPath]);
  const handleSidebarNewFromTemplate = useCallback(() => setShowNewFromTemplate(true), []);
  const handleSidebarDelete = useCallback((path: string) => setDeleteTarget(path), []);
  const handleSidebarRefresh = useCallback(() => {
    void refreshTree(true);
  }, [refreshTree]);
  const handleSidebarToggleTheme = useCallback(() => {
    setTheme(current => current === 'dark' ? 'light' : 'dark');
  }, []);
  const handleSidebarSearch = useCallback((query: string) => {
    revealLeftPanel();
    revealRightPanel();
    setRightTab('search');
    void handleSearch(query);
  }, [handleSearch, revealLeftPanel, revealRightPanel]);
  const handleSidebarNavigate = useCallback((tab: string) => {
    if (tab === 'graph') {
      setShowCenterGraph(true);
      setShowCenterAI(false);
      setShowCenterSchedule(false);
      setShowBalanceLab(false);
    } else if (tab === 'ai') {
      rightCollapsedBeforeCenterAIRef.current = rightCollapsedRef.current;
      autoRightCollapsedRef.current = false;
      rightCollapsedRef.current = true;
      setRightCollapsed(true);
      setShowCenterAI(true);
      setShowCenterGraph(false);
      setShowCenterSchedule(false);
      setShowBalanceLab(false);
    } else if (tab === 'schedule') {
      revealLeftPanel();
      setShowCenterSchedule(true);
      setShowCenterAI(false);
      setShowCenterGraph(false);
      setShowBalanceLab(false);
    } else if (tab === 'balance') {
      revealLeftPanel();
      setShowBalanceLab(true);
      setShowCenterSchedule(false);
      setShowCenterAI(false);
      setShowCenterGraph(false);
    } else if (tab === 'settings') {
      openSettingsModal();
    } else {
      revealLeftPanel();
      revealRightPanel();
      setSettingsModalOpen(false);
      setShowCenterGraph(false);
      setShowCenterAI(false);
      setShowCenterSchedule(false);
      setShowBalanceLab(false);
      setRightTab(tab as RightTab);
    }
  }, [openSettingsModal, revealLeftPanel, revealRightPanel]);
  const canNavigateBack = navigationIndex > 0;
  const canNavigateForward = navigationIndex >= 0 && navigationIndex < navigationHistory.length - 1;
  const recentFilePaths = useMemo(() => {
    const seen = new Set<string>();
    const paths: string[] = [];
    for (let i = navigationHistory.length - 1; i >= 0; i -= 1) {
      const path = navigationHistory[i];
      const key = normalizePath(path).toLowerCase();
      if (!path || seen.has(key)) continue;
      seen.add(key);
      paths.push(path);
      if (paths.length >= 10) break;
    }
    return paths;
  }, [navigationHistory]);

  const allMdFiles = useMemo(() => {
    const files: string[] = [];
    function walk(nodes: any[], prefix = '') {
      for (const n of nodes) {
        const rel = prefix ? prefix + '/' + n.name : n.name;
        if (n.isDir) walk(n.children, rel);
        else if (n.name.endsWith('.md')) files.push(rel);
      }
    }
    walk(fileTree);
    return files;
  }, [fileTree]);

  const allQuickSwitcherFiles = useMemo(() => {
    const files: string[] = [];
    function walk(nodes: FileNode[]) {
      for (const node of nodes) {
        if (node.isDir) {
          walk(node.children || []);
          continue;
        }
        if (/\.(md|canvas|excalidraw)$/i.test(node.name)) files.push(node.path);
      }
    }
    walk(fileTree);
    return files;
  }, [fileTree]);

  const quickSwitcherFileMetadata = useMemo(() => {
    const metadata: Record<string, QuickFileMeta> = {};
    for (const note of Object.values(vaultIndex.notes || {})) {
      const keywords = [
        ...(note.tags || []),
        note.metadata?.status || '',
        note.metadata?.priority || '',
        note.metadata?.owner || '',
        note.metadata?.summary || '',
      ].filter(Boolean);
      metadata[normalizePath(note.filePath).toLowerCase()] = {
        title: note.title,
        relativePath: note.relativePath,
        fileName: note.fileName,
        keywords,
      };
    }
    return metadata;
  }, [vaultIndex]);

  const availableFiles = useMemo(() => {
    const files: string[] = [];
    function walk(nodes: FileNode[]) {
      for (const n of nodes) {
        if (n.isDir) walk(n.children);
        else if (n.name.endsWith('.md')) files.push(n.name.replace(/\.md$/, ''));
      }
    }
    walk(fileTree);
    return files;
  }, [fileTree]);

  const { currentTags, groupedIncomingLinks, outgoingLinksInfo } = useMemo(() => {
    const tags: string[] = [];
    const incomingMap: Record<string, GroupedBacklink[]> = {};
    const outgoing: OutgoingLinkInfo[] = [];
    if (vaultIndex && currentFile) {
      const rel = currentFile.replace(vaultPath + '/', '').replace(vaultPath + '\\', '');
      const note = vaultIndex.notes[rel];
      if (note) {
        tags.push(...(note.tags || []));
        for (const wl of (note.wikiLinks || [])) {
          outgoing.push({ target: wl, alias: '', status: 'resolved' as const, filePath: currentFile, relativePath: rel, fileName: note.fileName, title: note.title, candidates: [] });
        }
      }
      for (const [filePath, info] of Object.entries(vaultIndex.notes)) {
        if ((info.wikiLinks || []).includes(rel)) {
          const existing = incomingMap[filePath];
          if (!existing) {
            incomingMap[filePath] = [{ filePath, relativePath: info.relativePath, fileName: info.fileName, title: info.title, refCount: 1, snippets: [] }];
          }
        }
      }
    }
    return { currentTags: tags, groupedIncomingLinks: Object.values(incomingMap).flat(), outgoingLinksInfo: outgoing };
  }, [vaultIndex, currentFile, vaultPath]);

  const allVaultTags = useMemo((): [string, number][] => {
    if (!vaultIndex) return [];
    const countMap: Record<string, number> = {};
    for (const note of Object.values(vaultIndex.notes)) { for (const tag of (note.tags || [])) { countMap[tag] = (countMap[tag] || 0) + 1; } }
    return Object.entries(countMap).sort((a, b) => a[0].localeCompare(b[0]));
  }, [vaultIndex]);

  const tagToNotesMap = useMemo((): Map<string, TagNoteInfo[]> => {
    const map = new Map<string, TagNoteInfo[]>();
    if (!vaultIndex) return map;
    for (const [fp, info] of Object.entries(vaultIndex.notes)) {
      for (const tag of (info.tags || [])) {
        if (!map.has(tag)) map.set(tag, []);
        map.get(tag)!.push({ filePath: fp, relativePath: info.relativePath, fileName: info.fileName, title: info.title, tagCount: 1 });
      }
    }
    return map;
  }, [vaultIndex]);

  const noteCount = vaultIndex ? Object.keys(vaultIndex.notes).length : 0;
  const tagCount = allVaultTags.length;

  const graphData = useMemo(() => buildGraphData(vaultIndex), [vaultIndex]);
  const graphSummary = useMemo(() => computeGraphSummary(graphData), [graphData]);

  

  const arshisConfig = useMemo((): ArshisIntegrationConfig => ({ enabled: false }), []);
  const setArshisConfig = useCallback((_c: ArshisIntegrationConfig) => {}, []);
  const arshisExporting = false;
  const arshisExportMsg = '';
  const handleArshisExportGameContext = useCallback(async () => {}, []);
  const handleExportGameWorkspaceReport = useCallback(async () => {
    if (!vaultPath || !gameWorkspace.summary) return;
    setReportBusy(true);
    try {
      const report = buildGameWorkspaceReportMarkdown({ summary: gameWorkspace.summary!, dashboard: {} as GameWorkspaceDashboard, entries: gameWorkspace.entries, generatedAt: new Date().toISOString(), vaultName: vault?.name || '' });
      const reportPath = vaultPath + '/GameWorkspace-Report.md';
      await api.createFile(reportPath, report);
      await refreshTree();
    } catch (err: any) { console.error('Export report failed:', err); }
    finally { setReportBusy(false); }
  }, [vaultPath, gameWorkspace, vault, refreshTree]);
  const [reportBusy, setReportBusy] = useState(false);

  const commandPaletteCommands = useMemo<QuickCommand[]>(() => {
    const openRightTab = (tab: RightTab) => {
      if (tab === 'settings') {
        openSettingsModal();
        return;
      }
      setSettingsModalOpen(false);
      revealRightPanel();
      setShowCenterGraph(false);
      setShowCenterAI(false);
      setShowCenterSchedule(false);
      setShowBalanceLab(false);
      setRightTab(tab);
    };
    const currentFileBookmarked = currentFile
      ? bookmarkedFiles.some((path) => normalizePath(path).toLowerCase() === normalizePath(currentFile).toLowerCase())
      : false;
    const currentFilePinned = currentFile
      ? pinnedTabs.some((path) => normalizePath(path).toLowerCase() === normalizePath(currentFile).toLowerCase())
      : false;

    return [
      {
        id: 'quick-open-files',
        title: 'Quick Open Files',
        subtitle: 'Search all notes, canvases, and drawings',
        shortcut: 'Ctrl+O',
        keywords: ['open', 'switch', 'files', 'quick', '打开', '切换', '文件'],
        run: () => { setQuickSwitchMode('files'); setShowQuickSwitch(true); },
      },
      {
        id: 'show-keyboard-shortcuts',
        title: '查看键盘快捷键',
        subtitle: '浏览并搜索 Ars-note 的快捷键',
        shortcut: 'Ctrl+/',
        keywords: ['keyboard', 'hotkeys', 'shortcuts', 'help', '键盘', '快捷键', '帮助'],
        run: () => setShowShortcutGuide(true),
      },
      {
        id: 'save-note',
        shortcut: 'Ctrl+S',
        title: '保存当前笔记',
        subtitle: currentFileName ? `Ctrl+S · ${currentFileName}` : '没有打开的笔记',
        keywords: ['save', '保存', 'note', '笔记'],
        run: () => { if (currentFile) void saveNow(); },
      },
      {
        id: 'navigate-back',
        shortcut: 'Alt+Left',
        title: 'Go Back',
        subtitle: canNavigateBack ? 'Alt+Left - previous file' : 'No previous file',
        keywords: ['back', 'history', 'previous', 'navigate', '返回', '后退'],
        run: () => { if (canNavigateBack) void navigateFileHistory(-1); },
      },
      {
        id: 'navigate-forward',
        shortcut: 'Alt+Right',
        title: 'Go Forward',
        subtitle: canNavigateForward ? 'Alt+Right - next file' : 'No next file',
        keywords: ['forward', 'history', 'next', 'navigate', '前进'],
        run: () => { if (canNavigateForward) void navigateFileHistory(1); },
      },
      {
        id: 'toggle-bookmark',
        title: currentFileBookmarked ? 'Remove Current Bookmark' : 'Bookmark Current File',
        subtitle: currentFileName ? `${currentFileBookmarked ? 'Unpin' : 'Pin'} - ${currentFileName}` : 'Open a file first',
        keywords: ['bookmark', 'pin', 'favorite', 'star', '收藏', '书签', '固定'],
        run: () => { if (currentFile) toggleBookmark(currentFile); },
      },
      {
        id: 'toggle-pin-current-tab',
        title: currentFilePinned ? 'Unpin Current Tab' : 'Pin Current Tab',
        subtitle: currentFileName ? `${currentFilePinned ? 'Unpin' : 'Pin'} - ${currentFileName}` : 'Open a file first',
        keywords: ['pin', 'tab', 'fixed', '固定', '标签'],
        run: () => { if (currentFile) togglePinnedTab(currentFile); },
      },
      {
        id: 'show-open-tabs',
        title: 'Show Open Tabs',
        subtitle: `${openTabs.length} open tab${openTabs.length === 1 ? '' : 's'}`,
        keywords: ['tabs', 'open files', 'switch', '标签', '打开文件'],
        run: () => setOpenTabsMenu({
          x: Math.max(8, window.innerWidth / 2 - 165),
          y: Math.max(8, Math.min(110, window.innerHeight - 360)),
        }),
      },
      {
        id: 'save-workspace-snapshot',
        title: 'Save Current Workspace',
        subtitle: 'Save open tabs, pinned tabs, and the current layout',
        keywords: ['workspace', 'layout', 'snapshot', 'save', '工作区', '布局', '保存'],
        run: () => { void saveWorkspaceSnapshot(); },
      },
      {
        id: 'manage-workspace-snapshots',
        title: 'Manage Workspaces',
        subtitle: `${workspaceSnapshots.length} saved workspace${workspaceSnapshots.length === 1 ? '' : 's'}`,
        keywords: ['workspace', 'layout', 'snapshot', 'manage', '工作区', '布局', '管理'],
        run: () => setWorkspaceSnapshotsOpen(true),
      },
      ...workspaceSnapshots.map((snapshot): QuickCommand => ({
        id: `load-workspace-${snapshot.id}`,
        title: `Load Workspace: ${snapshot.name}`,
        subtitle: `${snapshot.openTabs.length} tabs - ${snapshot.viewMode} view`,
        keywords: ['workspace', 'layout', 'snapshot', 'load', snapshot.name, '工作区', '布局', '恢复'],
        run: () => { void restoreWorkspaceSnapshot(snapshot); },
      })),
      {
        id: 'new-note',
        title: '新建 Markdown 文件',
        subtitle: '在当前 Vault 中创建新笔记',
        keywords: ['new', 'file', 'markdown', '新建', '文件'],
        run: () => { setContextTarget(vaultPath); setShowNewFile(true); },
      },
      {
        id: 'new-template',
        title: '从模板新建',
        subtitle: '打开模板库',
        keywords: ['template', '模板', 'new'],
        run: () => setShowNewFromTemplate(true),
      },
      {
        id: 'new-canvas',
        title: '新建画布',
        subtitle: '创建 .canvas 可视化白板',
        keywords: ['canvas', '画布', 'whiteboard'],
        run: () => { void handleNewCanvas(); },
      },
      {
        id: 'new-wireframe',
        title: '新建 UI 原型',
        subtitle: '创建 Excalidraw 原型文件',
        keywords: ['wireframe', 'ui', '原型', 'excalidraw'],
        run: () => { void handleNewWireframe(); },
      },
      {
        id: 'refresh-vault',
        title: '刷新 Vault 索引',
        subtitle: '重新扫描文件树、标签、链接和工作区',
        keywords: ['refresh', 'index', 'scan', '刷新', '索引'],
        run: async () => { await refreshTree(); await refreshIndex(); },
      },
      {
        id: 'reveal-current-file',
        title: '在文件浏览器中定位当前文件',
        subtitle: currentFileName || '请先打开一个文件',
        keywords: ['reveal', 'explorer', 'current file', '定位', '文件浏览器', '当前文件'],
        run: () => {
          revealLeftPanel();
          setSidebarRevealRequest((value) => value + 1);
        },
      },
      {
        id: 'collapse-file-explorer',
        title: '折叠文件浏览器中的全部文件夹',
        subtitle: '保持文件树整洁',
        keywords: ['collapse', 'explorer', 'folders', '折叠', '文件夹', '文件浏览器'],
        run: () => window.dispatchEvent(new Event('ars-note:collapse-explorer')),
      },
      {
        id: 'view-live',
        title: '切换到实时编辑',
        subtitle: 'Ars-note 所见即所得 Live Preview',
        keywords: ['edit', 'live', 'preview', '编辑', '实时'],
        run: () => setViewMode('live'),
      },
      {
        id: 'view-source',
        title: 'Switch to Source Mode',
        subtitle: 'Edit raw Markdown without live rendering',
        keywords: ['source', 'markdown', 'raw', '源码', '源代码'],
        run: () => setViewMode('source'),
      },
      {
        id: 'view-split',
        title: 'Switch to Split View',
        subtitle: 'Edit and preview the current note side by side',
        keywords: ['split', 'edit preview', '分屏', '预览'],
        run: () => setViewMode('split'),
      },
      {
        id: 'view-preview',
        title: '切换到只读预览',
        subtitle: '当前笔记不可编辑，只阅读渲染结果',
        keywords: ['preview', 'read', '预览', '阅读'],
        run: () => setViewMode('preview'),
      },
      {
        id: 'open-workspace',
        title: '打开 Ars-note 团队工作台',
        subtitle: '团队时间表、制作指挥中心和生产文档刷新',
        keywords: ['workspace', 'game', 'team', 'ars-note', 'production', 'schedule', '工作台', '团队', '时间表', '制作指挥中心'],
        run: () => { void handleOpenTeamWorkspace(); },
      },
      {
        id: 'open-preview-panel',
        title: '打开右侧预览',
        subtitle: '右侧面板 · 当前笔记预览',
        keywords: ['preview', '预览', 'right'],
        run: () => openRightTab('preview'),
      },
      {
        id: 'open-search',
        title: '打开搜索面板',
        subtitle: '右侧面板 · 搜索',
        keywords: ['search', 'find', '搜索', '查找'],
        run: () => openRightTab('search'),
      },
      {
        id: 'open-outline',
        title: 'Open Document Outline',
        subtitle: 'Right panel - headings in the current note',
        keywords: ['outline', 'headings', 'toc', '大纲', '标题'],
        run: () => openRightTab('outline'),
      },
      {
        id: 'open-backlinks',
        title: 'Open Backlinks',
        subtitle: 'Right panel - notes linking to the current file',
        keywords: ['backlinks', 'links', 'references', '反向链接', '引用'],
        run: () => openRightTab('backlinks'),
      },
      {
        id: 'open-templates',
        title: '打开模板面板',
        subtitle: '右侧面板 · 模板',
        keywords: ['templates', '模板'],
        run: () => openRightTab('templates'),
      },
      {
        id: 'open-ai',
        title: '打开 AI 助手',
        subtitle: '右侧面板 · AI',
        keywords: ['ai', 'assistant', '助手'],
        run: () => openRightTab('ai'),
      },
      {
        id: 'open-system',
        title: '打开系统与同步设置',
        subtitle: '右侧面板 · 系统',
        keywords: ['settings', 'system', 'sync', 'backup', '设置', '同步', '备份'],
        run: () => openRightTab('settings'),
      },
      {
        id: 'open-graph-panel',
        title: '打开知识图谱',
        subtitle: '中间主视图',
        keywords: ['graph', 'knowledge', '图谱', '知识'],
        run: () => { setShowCenterAI(false); setShowCenterSchedule(false); setShowBalanceLab(false); setShowCenterGraph(true); setRightTab('graph'); },
      },
      {
        id: 'open-balance-lab',
        title: '打开数值实验室',
        subtitle: '成长、战斗、经济与掉落模拟',
        keywords: ['balance', 'simulator', '数值', '模拟器', '策划'],
        run: () => {
          revealLeftPanel();
          setShowCenterAI(false);
          setShowCenterSchedule(false);
          setShowCenterGraph(false);
          setShowBalanceLab(true);
        },
      },
      {
        id: 'export-backup',
        title: '导出本地备份',
        subtitle: '生成当前 Vault 备份',
        keywords: ['backup', 'export', '备份', '导出'],
        run: () => { void handleExportBackup(); },
      },
      {
        id: 'generate-manifest',
        title: '生成 Vault 清单',
        subtitle: '扫描文件数量、大小和哈希',
        keywords: ['manifest', '清单', 'scan'],
        run: () => { void handleGenerateManifest(); },
      },
      {
        id: 'sync-compare',
        title: '检查同步状态',
        subtitle: '对比本地与远程备份状态',
        keywords: ['sync', 'compare', '同步', '对比'],
        run: () => { openRightTab('settings'); void handleCompareLocalRemote(); },
      },
      {
        id: 'sync-push',
        title: '手动 Push 到同步服务器',
        subtitle: '上传当前 Vault 最新备份',
        keywords: ['sync', 'push', 'upload', '同步', '上传'],
        run: () => { openRightTab('settings'); void handleManualPush(); },
      },
      {
        id: 'toggle-theme',
        title: theme === 'dark' ? '切换到浅色主题' : '切换到深色主题',
        subtitle: '切换 Ars-note 外观',
        keywords: ['theme', 'light', 'dark', '主题', '白天', '夜间'],
        run: () => setTheme(prev => prev === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'toggle-left-panel',
        title: leftCollapsed ? 'Expand Left Sidebar' : 'Collapse Left Sidebar',
        subtitle: 'Show or hide the file explorer while keeping the icon rail',
        keywords: ['left panel', 'file explorer', 'sidebar', 'collapse', 'expand', '左侧栏', '文件浏览器', '折叠'],
        run: toggleLeftPanel,
      },
      {
        id: 'toggle-right-panel',
        title: rightCollapsed ? 'Expand Right Panel' : 'Collapse Right Panel',
        subtitle: 'Show or hide the workspace side panel',
        keywords: ['right panel', 'sidebar', 'collapse', 'expand', '右侧栏', '折叠'],
        run: toggleRightPanel,
      },
      {
        id: 'toggle-focus',
        title: focusMode ? '退出专注模式' : '进入专注模式',
        subtitle: 'Ctrl+Shift+F',
        shortcut: 'Ctrl+Shift+F',
        keywords: ['focus', '专注', 'zen'],
        run: () => setFocusMode(prev => !prev),
      },
    ];
  }, [
    bookmarkedFiles,
    canNavigateBack,
    canNavigateForward,
    currentFile,
    currentFileName,
    focusMode,
    gameWorkspace.summary,
    handleCompareLocalRemote,
    handleExportBackup,
    handleGenerateManifest,
    handleOpenTeamWorkspace,
    handleManualPush,
    handleNewCanvas,
    handleNewWireframe,
    leftCollapsed,
    navigateFileHistory,
    openSettingsModal,
    openTabs,
    pinnedTabs,
    refreshIndex,
    refreshTree,
    revealLeftPanel,
    revealRightPanel,
    rightCollapsed,
    restoreWorkspaceSnapshot,
    saveNow,
    saveWorkspaceSnapshot,
    theme,
    toggleBookmark,
    toggleLeftPanel,
    togglePinnedTab,
    toggleRightPanel,
    vaultPath,
    workspaceSnapshots,
  ]);

  function handleMarkdownPreviewClick(event: React.MouseEvent<HTMLDivElement>): void {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('.md-wiki-link')
      : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    window.dispatchEvent(new CustomEvent('ars-note:open-wiki-link', {
      detail: { target: target.dataset.wiki || target.textContent || '' },
    }));
  }

  /* ── Keyboard shortcuts ── */
  const anyDialogOpen = !!(showNewFile || showNewFolder || showNewFromTemplate || deleteTarget || promptConfig || confirmConfig || workspaceSnapshotsOpen || showShortcutGuide);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 's' && !e.shiftKey) { e.preventDefault(); saveNow(); return; }
      if (!anyDialogOpen && e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        if (canNavigateBack) void navigateFileHistory(-1);
        return;
      }
      if (!anyDialogOpen && e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowRight') {
        e.preventDefault();
        if (canNavigateForward) void navigateFileHistory(1);
        return;
      }
      if (e.key === 'Escape' && anyDialogOpen) {
        e.preventDefault();
        if (confirmConfig) { confirmConfig.resolve?.(false); setConfirmConfig(null); return; }
        if (deleteTarget) { setDeleteTarget(''); return; }
        if (showNewFile) { setShowNewFile(false); return; }
        if (showNewFolder) { setShowNewFolder(false); return; }
        if (showNewFromTemplate) { setShowNewFromTemplate(false); return; }
        if (promptConfig) { handlePromptCancel(); return; }
        if (workspaceSnapshotsOpen) { setWorkspaceSnapshotsOpen(false); return; }
        if (showShortcutGuide) { setShowShortcutGuide(false); return; }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [anyDialogOpen, canNavigateBack, canNavigateForward, navigateFileHistory, saveNow, confirmConfig, deleteTarget, showNewFile, showNewFolder, showNewFromTemplate, promptConfig, handlePromptCancel, showShortcutGuide, workspaceSnapshotsOpen]);

  const saveStatusText = (() => {
    switch (saveStatus) { case 'saving': return t.saving; case 'error': return t.saveError; case 'unsaved': return t.unsaved; default: return t.saved; }
  })();

  const closeEditorTab = useCallback(async (tabPath: string) => {
    const closingIndex = openTabs.findIndex((path) => path === tabPath);
    if (closingIndex < 0) return;

    if (tabPath === currentFile && currentFile && currentContent !== savedContent) {
      try {
        await api.writeFile(currentFile, currentContent);
        setSavedContent(currentContent);
      } catch (err) {
        console.error('Failed to save before closing tab:', err);
        setSaveStatus('error');
        return;
      }
    }

    const nextTabs = openTabs.filter((path) => path !== tabPath);
    setOpenTabs(nextTabs);
    setPinnedTabs((prev) => prev.filter((path) => normalizePath(path).toLowerCase() !== normalizePath(tabPath).toLowerCase()));
    setClosedTabs((prev) => [...prev.filter((path) => path !== tabPath), tabPath].slice(-20));
    if (tabPath !== currentFile) return;

    const fallbackPath = nextTabs[Math.min(closingIndex, nextTabs.length - 1)];
    if (fallbackPath) {
      void loadFileIntoEditor(fallbackPath, nextTabs);
      return;
    }

    setCurrentFile('');
    setCurrentContent('');
    setSavedContent('');
    setSaveStatus('saved');
  }, [currentContent, currentFile, loadFileIntoEditor, openTabs, savedContent]);

  const closeEditorTabs = useCallback(async (tabPaths: string[]) => {
    const pinnedKeys = new Set(pinnedTabs.map((path) => normalizePath(path).toLowerCase()));
    const closeKeys = new Set(
      tabPaths
        .map((path) => normalizePath(path).toLowerCase())
        .filter((path) => !pinnedKeys.has(path)),
    );
    const tabsToClose = openTabs.filter((path) => closeKeys.has(normalizePath(path).toLowerCase()));
    if (tabsToClose.length === 0) return;

    const closesCurrent = currentFile && closeKeys.has(normalizePath(currentFile).toLowerCase());
    if (closesCurrent && currentContent !== savedContent) {
      try {
        await api.writeFile(currentFile, currentContent);
        setSavedContent(currentContent);
      } catch (err) {
        console.error('Failed to save before closing tabs:', err);
        setSaveStatus('error');
        return;
      }
    }

    const currentIndex = openTabs.findIndex((path) => path === currentFile);
    const nextTabs = openTabs.filter((path) => !closeKeys.has(normalizePath(path).toLowerCase()));
    setOpenTabs(nextTabs);
    setClosedTabs((prev) => {
      const retained = prev.filter((path) => !closeKeys.has(normalizePath(path).toLowerCase()));
      return [...retained, ...tabsToClose].slice(-20);
    });

    if (!closesCurrent) return;
    const fallbackPath = nextTabs[Math.min(Math.max(currentIndex, 0), nextTabs.length - 1)];
    if (fallbackPath) {
      await loadFileIntoEditor(fallbackPath, nextTabs);
      return;
    }

    setCurrentFile('');
    setCurrentContent('');
    setSavedContent('');
    setSaveStatus('saved');
  }, [currentContent, currentFile, loadFileIntoEditor, openTabs, pinnedTabs, savedContent]);

  const reopenLastClosedTab = useCallback(async () => {
    const targetPath = closedTabs[closedTabs.length - 1];
    if (!targetPath) return;
    try {
      await openFile(targetPath);
      setClosedTabs((prev) => prev.slice(0, -1));
    } catch (err) {
      console.error('Failed to reopen closed tab:', err);
      setClosedTabs((prev) => prev.filter((path) => path !== targetPath));
    }
  }, [closedTabs, openFile]);

  const cycleEditorTab = useCallback((delta: -1 | 1) => {
    if (openTabs.length < 2 || !currentFile) return;
    const currentIndex = openTabs.findIndex((path) => path === currentFile);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const targetIndex = (baseIndex + delta + openTabs.length) % openTabs.length;
    const targetPath = openTabs[targetIndex];
    if (targetPath && targetPath !== currentFile) void openFile(targetPath);
  }, [currentFile, openFile, openTabs]);

  useEffect(() => {
    const activeTab = tabElementRefs.current.get(currentFile);
    activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [currentFile, openTabs]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (anyDialogOpen || showQuickSwitch) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(key) && openTabs.length > 0) {
        e.preventDefault();
        const requestedIndex = key === '9' ? openTabs.length - 1 : Number(key) - 1;
        const targetPath = openTabs[Math.min(requestedIndex, openTabs.length - 1)];
        if (targetPath && targetPath !== currentFile) void openFile(targetPath);
        return;
      }
      if (mod && !e.shiftKey && key === 'w' && currentFile) {
        e.preventDefault();
        void closeEditorTab(currentFile);
        return;
      }
      if (mod && e.shiftKey && key === 't' && closedTabs.length > 0) {
        e.preventDefault();
        void reopenLastClosedTab();
        return;
      }
      if (mod && (e.key === 'Tab' || e.key === 'PageDown')) {
        e.preventDefault();
        cycleEditorTab(e.shiftKey ? -1 : 1);
        return;
      }
      if (mod && e.key === 'PageUp') {
        e.preventDefault();
        cycleEditorTab(-1);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [anyDialogOpen, closeEditorTab, closedTabs.length, currentFile, cycleEditorTab, openFile, openTabs, reopenLastClosedTab, showQuickSwitch]);

  useEffect(() => {
    if (!tabContextMenu && !openTabsMenu) return;
    const closeMenu = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTabContextMenu(null);
        setOpenTabsMenu(null);
      }
    };
    window.addEventListener('keydown', closeMenu);
    return () => window.removeEventListener('keydown', closeMenu);
  }, [openTabsMenu, tabContextMenu]);

  return (
    <div className={"app-layout" + (focusMode ? " focus-mode" : "") + (settingsModalOpen ? " settings-modal-open" : "")}>
      <TitleBar
        vaultName={vault?.name || ''}
        saveStatus={creationMsg || saveStatusText}
        isDirty={!!vault && (isDirty || saveStatus === 'error')}
        onSave={saveNow}
        welcome={!vault}
      />
      <DocumentOpeningOverlay />
      {!vault ? (
        <WelcomeScreen onCreateVault={handleCreateVault} onOpenVault={handleOpenVault} onOpenRecent={handleOpenRecent} />
      ) : (
        <React.Suspense fallback={<LazyPanelFallback label="正在加载工作区..." />}>
          <div
            className="main-content"
            ref={mainContentRef}
            style={{
              '--sidebar-width': `${sidebarWidth}px`,
              '--right-panel-width': `${rightPanelWidth}px`,
            } as React.CSSProperties}
          >
            <Sidebar onNewFile={handleSidebarNewFile} onNewFolder={handleSidebarNewFolder}
              onNewFromTemplate={handleSidebarNewFromTemplate}
              onNewWireframe={handleNewWireframe}
              onNewCanvas={handleNewCanvas}
              onDelete={handleSidebarDelete} onSetContextTarget={setContextTarget} onRefresh={handleSidebarRefresh} fileTree={fileTree} vaultPath={vaultPath} currentFile={currentFile} onOpenFile={openFile}
              onMoveItem={handleMoveItem}
              bookmarkedFiles={bookmarkedFiles}
              recentFiles={recentFilePaths}
              onToggleBookmark={toggleBookmark}
              isConnected={!!vault}
              appVersion={APP_VERSION_LABEL}
              theme={theme}
              activePanelTab={showBalanceLab ? 'balance' : showCenterSchedule ? 'schedule' : showCenterAI ? 'ai' : showCenterGraph ? 'graph' : rightTab}
              revealCurrentFileRequest={sidebarRevealRequest}
              collapsed={leftCollapsed}
              onToggleCollapse={toggleLeftPanel}
              onOpenSettings={openSettingsModal}
              onToggleTheme={handleSidebarToggleTheme}
              onSearchInVault={handleSidebarSearch}
              onNavigateToTab={handleSidebarNavigate} />
            {!leftCollapsed && (
              <div
                className="workspace-resizer workspace-resizer-left"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize left sidebar"
                onMouseDown={beginSidebarResize}
              />
            )}
            <div className={'editor-area' + ((showCenterGraph || showCenterAI || showCenterSchedule || showBalanceLab) ? ' editor-area-graph' : '')}>
              {currentFile && (openTabs.length > 1 || navigationHistory.length > 1) && !showCenterGraph && !showCenterAI && !showCenterSchedule && !showBalanceLab && (
                <div className="document-tab-bar" role="tablist" aria-label="Open files">
                  <div className="document-tab-nav" aria-label="File navigation history">
                    <button
                      type="button"
                      className="document-tab-nav-btn"
                      disabled={!canNavigateBack}
                      title="Back (Alt+Left)"
                      onClick={() => { if (canNavigateBack) void navigateFileHistory(-1); }}
                    >
                      <ChevronRightIcon size={14} style={{ transform: 'rotate(180deg)' }} />
                    </button>
                    <button
                      type="button"
                      className="document-tab-nav-btn"
                      disabled={!canNavigateForward}
                      title="Forward (Alt+Right)"
                      onClick={() => { if (canNavigateForward) void navigateFileHistory(1); }}
                    >
                      <ChevronRightIcon size={14} />
                    </button>
                    <button
                      type="button"
                      className="document-tab-nav-btn"
                      disabled={closedTabs.length === 0}
                      title="Reopen closed tab (Ctrl+Shift+T)"
                      onClick={() => { if (closedTabs.length > 0) void reopenLastClosedTab(); }}
                    >
                      <SyncIcon size={13} />
                    </button>
                    <button
                      type="button"
                      className="document-tab-nav-btn document-tab-overview-btn"
                      title="Open tabs"
                      aria-label={`Open tabs (${openTabs.length})`}
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTabContextMenu(null);
                        setOpenTabsMenu((prev) => prev ? null : { x: rect.left, y: rect.bottom + 5 });
                      }}
                    >
                      <MenuIcon size={13} />
                      <span className="document-tab-count">{openTabs.length}</span>
                    </button>
                  </div>
                  {openTabs.map(tabPath => {
                    const tabName = tabPath.split(/[\\/]/).pop() || '';
                    const isActive = tabPath === currentFile;
                    const isPinned = pinnedTabs.some((path) => normalizePath(path).toLowerCase() === normalizePath(tabPath).toLowerCase());
                    const dropSide = tabDropTarget?.path === tabPath ? tabDropTarget.side : '';
                    return (
                      <div
                        key={tabPath}
                        ref={(element) => {
                          if (element) tabElementRefs.current.set(tabPath, element);
                          else tabElementRefs.current.delete(tabPath);
                        }}
                        role="tab"
                        aria-selected={isActive}
                        className={
                          'document-tab'
                          + (isActive ? ' active' : '')
                          + (isPinned ? ' pinned' : '')
                          + (draggedTabPath === tabPath ? ' dragging' : '')
                          + (dropSide ? ` drop-${dropSide}` : '')
                        }
                        title={`${tabPath}${isPinned ? ' (Pinned)' : ''}`}
                        draggable
                        onClick={() => { if (tabPath !== currentFile) openFile(tabPath); }}
                        onMouseDown={(e) => {
                          if (e.button !== 1) return;
                          e.preventDefault();
                          void closeEditorTab(tabPath);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setOpenTabsMenu(null);
                          setTabContextMenu({ path: tabPath, x: e.clientX, y: e.clientY });
                        }}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', tabPath);
                          setTabContextMenu(null);
                          setDraggedTabPath(tabPath);
                          setTabDropTarget(null);
                        }}
                        onDragOver={(e) => {
                          if (!draggedTabPath || draggedTabPath === tabPath) return;
                          const draggedIsPinned = pinnedTabs.some((path) => normalizePath(path).toLowerCase() === normalizePath(draggedTabPath).toLowerCase());
                          if (draggedIsPinned !== isPinned) {
                            setTabDropTarget(null);
                            return;
                          }
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          const rect = e.currentTarget.getBoundingClientRect();
                          const side = e.clientX >= rect.left + rect.width / 2 ? 'after' : 'before';
                          setTabDropTarget((prev) => prev?.path === tabPath && prev.side === side ? prev : { path: tabPath, side });
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const sourcePath = draggedTabPath || e.dataTransfer.getData('text/plain');
                          if (sourcePath && sourcePath !== tabPath) {
                            const sourceIsPinned = pinnedTabs.some((path) => normalizePath(path).toLowerCase() === normalizePath(sourcePath).toLowerCase());
                            if (sourceIsPinned !== isPinned) {
                              setDraggedTabPath('');
                              setTabDropTarget(null);
                              return;
                            }
                            const rect = e.currentTarget.getBoundingClientRect();
                            const insertAfter = e.clientX >= rect.left + rect.width / 2;
                            setOpenTabs((prev) => {
                              if (!prev.includes(sourcePath) || !prev.includes(tabPath)) return prev;
                              const reordered = prev.filter((path) => path !== sourcePath);
                              const targetIndex = reordered.indexOf(tabPath);
                              reordered.splice(targetIndex + (insertAfter ? 1 : 0), 0, sourcePath);
                              return reordered;
                            });
                          }
                          setDraggedTabPath('');
                          setTabDropTarget(null);
                        }}
                        onDragEnd={() => {
                          setDraggedTabPath('');
                          setTabDropTarget(null);
                        }}
                      >
                        {isPinned && <span className="document-tab-pin" title="Pinned tab" aria-label="Pinned tab" />}
                        <span className="document-tab-name">{tabName}</span>
                        {isActive && isDirty && <span className="document-tab-dirty" title="Unsaved changes" />}
                        <button
                          type="button"
                          className="document-tab-close"
                          aria-label={`Close ${tabName}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void closeEditorTab(tabPath);
                          }}
                        >
                          <CloseIcon size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {showBalanceLab ? (
                <ErrorBoundary>
                  <React.Suspense fallback={<LazyPanelFallback label="正在加载数值实验室..." />}>
                    <BalanceLab
                      vaultPath={vaultPath}
                      vaultName={vault?.name || ''}
                      onClose={() => setShowBalanceLab(false)}
                    />
                  </React.Suspense>
                </ErrorBoundary>
              ) : showCenterSchedule ? (
                <ErrorBoundary>
                  <React.Suspense fallback={<LazyPanelFallback label="正在加载团队时间表..." />}>
                    <TeamSchedulePanel
                      vaultPath={vaultPath}
                      fileTree={fileTree}
                      currentFileRelativePath={currentFileRelPath}
                      onImportCurrentDocumentTasks={handleImportCurrentDocumentTasks}
                      onOpenFile={(relativePath) => {
                        if (!vaultPath || !relativePath) return;
                        void (async () => {
                          const fullPath = await api.joinPath(vaultPath, ...relativePath.replace(/\\/g, '/').split('/').filter(Boolean));
                          setShowCenterSchedule(false);
                          await openFile(fullPath);
                        })();
                      }}
                      onRefreshVault={async () => {
                        await refreshTree();
                        await refreshIndex();
                      }}
                    />
                  </React.Suspense>
                </ErrorBoundary>
              ) : showCenterAI ? (
                <ErrorBoundary>
                  <div className="center-ai-view">
                    <div className="center-ai-header">
                      <button className="center-graph-back-btn" onClick={closeCenterAI} aria-label="返回编辑器">{'←'}</button>
                      <div className="center-ai-heading">
                        <BotIcon size={16} />
                        <div>
                          <strong>AI 助手</strong>
                          <span className={aiConfig.hasApiKey ? 'connected' : 'disconnected'}>
                            <i />{aiConfig.hasApiKey ? `${aiConfig.model || aiConfig.provider}` : '尚未配置'}
                          </span>
                        </div>
                      </div>
                      <div className="ai-header-tabs" role="tablist" aria-label="AI 工作区">
                        <button className={"ai-header-tab" + (aiPanelTab === 'chat' ? ' active' : '')} onClick={() => setAiPanelTab('chat')}>对话</button>
                        <button className={"ai-header-tab" + (aiPanelTab === 'pillars' ? ' active' : '')} onClick={() => setAiPanelTab('pillars')}>AI 系统</button>
                      </div>
                    </div>
                    <div className="center-ai-body">
                      {aiPanelTab === 'pillars' && (
                        <React.Suspense fallback={<LazyPanelFallback label="正在加载 AI 系统..." />}>
                          <AIFivePillarPanel vaultPath={vaultPath || ''} api={api} />
                        </React.Suspense>
                      )}
                      {aiPanelTab === 'chat' && (
                        <div className="center-ai-chat-content">
                          <div className="center-ai-chat-messages" ref={centerAiMessagesRef}>
                            {aiChatMessages.length === 0 && aiLiveToolCalls.length === 0 ? (
                              <div className="ai-chat-empty">
                                <div className="ai-chat-empty-icon">{'['}</div>
                                <div className="ai-chat-empty-text">{t.aiNoResponse}</div>
                                <div className="ai-chat-empty-hint">{t.aiChatEmptyHint || 'Type a question below or use a quick prompt to get started.'}</div>
                              </div>
                            ) : (
                              <React.Fragment>
                                <AIChatMessageList
                                  messages={aiChatMessages}
                                  variant="center"
                                  emptyTitle={t.aiNoResponse}
                                  emptyHint={t.aiChatEmptyHint || 'Type a question below or use a quick prompt to get started.'}
                                  locale={language === 'zh-CN' ? 'zh' : 'en'}
                                  showEmpty={false}
                                />
                                {aiBusy && aiLiveToolCalls.length > 0 && (
                                  <div className="ai-message ai-message-assistant">
                                    <div className="ai-message-header">
                                      <span className="ai-message-role assistant">AI</span>
                                      <span className="ai-message-meta">working...</span>
                                    </div>
                                    <div className="ai-tool-calls">
                                      <div className="ai-tool-calls-header ai-tool-calls-live">
                                        <span className="ai-tool-calls-spinner" />
                                        <span>{'Tools (' + aiLiveToolCalls.length + ')'}</span>
                                      </div>
                                      <div className="ai-tool-calls-body">
                                        {aiLiveToolCalls.map((tc, ti) => (
                                          <div key={ti} className={"ai-tool-card ai-tool-card-" + tc.status}>
                                            <div className="ai-tool-card-header">
                                              <span className="ai-tool-status-dot" />
                                              <span className="ai-tool-name">{tc.name}</span>
                                              <span className="ai-tool-status-label">{tc.status === 'done' ? '✓' : '...'}</span>
                                            </div>
                                            <div className="ai-tool-card-args">
                                              {tc.args && Object.entries(tc.args).map(([k, v]) => (
                                                <div key={k} className="ai-tool-arg"><span className="ai-tool-arg-key">{k}:</span> <span className="ai-tool-arg-val">{typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + '...' : String(v)}</span></div>
                                              ))}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                )}
                                {aiBusy && aiLiveToolCalls.length === 0 && (
                                  <div className="ai-message ai-message-assistant">
                                    <div className="ai-message-header">
                                      <span className="ai-message-role assistant">AI</span>
                                      <span className="ai-message-meta">thinking...</span>
                                    </div>
                                    <div className="ai-message-content">
                                      <span className="ai-thinking-dots"><span>.</span><span>.</span><span>.</span></span>
                                    </div>
                                  </div>
                                )}
                              </React.Fragment>
                            )}
                          </div>
                          <AIWritingQualityCard
                            active={showCenterAI && aiPanelTab === 'chat'}
                            currentFilePath={currentFile || ''}
                            content={deferredCurrentContent}
                            configured={aiConfig.hasApiKey}
                            sending={aiBusy}
                            controlMode={aiControlMode}
                            onSendPrompt={handleAISendChat}
                            variant="center"
                          />
                          <div className={'center-ai-input-area' + (centerAIToolsOpen ? ' tools-open' : '')}>
                            {centerAIToolsOpen && (
                              <div className="center-ai-tools-drawer">
                                <div className="center-ai-tools-drawer-head">
                                  <strong>AI 工作方式</strong>
                                  <span>权限、上下文与快捷指令</span>
                                </div>
                                <div className="center-ai-tools-section">
                                  <span className="center-ai-tools-label">权限模式</span>
                                  <div className="ai-context-options ai-control-options">
                                    {([
                                      ['readonly', '只读分析'],
                                      ['member', '成员执行'],
                                      ['producer', '制作人接管'],
                                    ] as [AIControlMode, string][]).map(([mode, label]) => (
                                      <button key={mode} className={"ai-context-btn ai-control-btn ai-control-" + mode + (aiControlMode === mode ? " active" : "")} onClick={() => setAiControlMode(mode)} title={mode === 'readonly' ? '只读分析，不允许写入或删除' : mode === 'member' ? '按明确要求直接修改普通文件，并自动保存回滚记录' : '可直接维护团队排期与生产文档，并自动保存审计和回滚记录'}>
                                        {label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="center-ai-tools-section">
                                  <span className="center-ai-tools-label">读取范围</span>
                                  <div className="ai-context-options">
                                    {([['currentNote', t.contextCurrentNote], ['gameWorkspace', t.contextGameWorkspace], ['arshisContext', t.contextArshisContext]] as [AIContextMode, string][]).map(([mode, label]) => (
                                      <button key={mode} className={"ai-context-btn" + (aiContextMode === mode ? " active" : "")} onClick={() => setAiContextMode(mode)}>
                                        {label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="center-ai-tools-section center-ai-tools-prompts">
                                  <span className="center-ai-tools-label">快捷指令</span>
                                  <div className="center-ai-quick-prompts">
                                    {QUICK_PROMPTS.map((qp) => (
                                      <button key={qp.id} className="ai-quick-prompt-btn" disabled={aiBusy || !aiConfig.hasApiKey} onClick={() => { setCenterAIToolsOpen(false); handleAISendChat(qp.prompt); }} title={qp.prompt}>
                                        {(t as any)[qp.labelKey] || qp.labelKey}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}
                            <div className="center-ai-composer">
                              <textarea
                                value={aiInput}
                                onChange={(e) => setAiInput(e.target.value)}
                                placeholder={aiConfig.hasApiKey ? t.aiChatPlaceholder : t.aiNotConfigured}
                                rows={2}
                                disabled={!aiConfig.hasApiKey}
                                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && aiConfig.hasApiKey && !aiBusy) { e.preventDefault(); handleAISendChat(aiInput); } }}
                              />
                              <div className="center-ai-input-actions">
                                <div className="center-ai-input-primary">
                                  <button
                                    type="button"
                                    className={'center-ai-tools-plus' + (centerAIToolsOpen ? ' active' : '')}
                                    onClick={() => setCenterAIToolsOpen((open) => !open)}
                                    aria-label={centerAIToolsOpen ? '收起 AI 工具' : '打开 AI 工具'}
                                    title={centerAIToolsOpen ? '收起 AI 工具' : 'AI 工具'}
                                  >
                                    {centerAIToolsOpen ? '×' : '+'}
                                  </button>
                                  <span className="center-ai-mode-chip">{aiControlMode === 'readonly' ? '只读' : aiControlMode === 'member' ? '成员执行' : '制作人接管'}</span>
                                  <span className="center-ai-mode-chip muted">{aiContextMode === 'currentNote' ? t.contextCurrentNote : aiContextMode === 'gameWorkspace' ? t.contextGameWorkspace : t.contextArshisContext}</span>
                                  <AIContextMeter usage={visibleAIContextUsage} compact />
                                </div>
                                <div className="center-ai-input-secondary">
                                  {aiChatMessages.length > 0 && (() => {
                                    const lastAssistant = [...aiChatMessages].reverse().find(m => m.role === 'assistant');
                                    return lastAssistant ? (
                                      <button className={"center-ai-utility-btn" + (aiCopiedResponse ? " success" : "")} title={t.copyResponse} onClick={() => {
                                        navigator.clipboard.writeText(lastAssistant.content).then(() => { setAiCopiedResponse(true); setTimeout(() => setAiCopiedResponse(false), 2000); }).catch(() => {});
                                      }}>
                                        <CopyIcon size={14} />
                                      </button>
                                    ) : null;
                                  })()}
                                  <div className="center-ai-history-wrap">
                                    <button className="center-ai-utility-btn" title={t.aiHistory || 'History'} onClick={async () => {
                                      if (!vaultPath) return;
                                      if (aiShowHistory) { setAiShowHistory(false); return; }
                                      try {
                                        const list = await api.aiListConversations(vaultPath);
                                        setAiHistoryList(list || []);
                                        setAiShowHistory(true);
                                      } catch {}
                                    }}>
                                      <ClockIcon size={14} />
                                    </button>
                                    {aiShowHistory && (
                                      <div className="ai-history-dropdown">
                                        {aiHistoryList.length > 0 ? aiHistoryList.slice(0, 15).map((item: any) => (
                                          <button key={item.file} className="ai-history-item" onClick={async (e) => {
                                            e.stopPropagation();
                                            try {
                                              const loaded = await api.aiLoadConversation(vaultPath, item.file);
                                              if (Array.isArray(loaded)) {
                                                const displayMessages = normalizeDisplayAIChatMessages(loaded).filter((message) => message.role !== 'system');
                                                suppressAiConversationSaveRef.current = true;
                                                setAiChatMessages(displayMessages);
                                                setAiShowHistory(false);
                                              }
                                            } catch {}
                                          }}>
                                            <strong>{(item.savedAt || item.date) ? (item.savedAt || item.date).replace('T', ' ').substring(0, 16) : item.file}</strong>
                                            <span>{item.messageCount || 0} 条消息</span>
                                          </button>
                                        )) : <div className="ai-history-empty">暂无历史对话</div>}
                                        <button className="ai-history-item new" onClick={(e) => {
                                          e.stopPropagation();
                                          setAiChatMessages([]);
                                          setAiShowHistory(false);
                                        }}>
                                          {t.aiNewChat || 'New Chat'}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  {!aiBusy && aiRetryPrompt && (
                                    <button className="center-ai-retry-btn" onClick={() => handleAISendChat(aiRetryPrompt)}>
                                      {t.aiRetryLast}
                                    </button>
                                  )}
                                  {aiSending ? (
                                    <button className="ai-send-btn ai-stop-btn" onClick={handleAICancelChat}>
                                      {t.aiStopGenerating}
                                    </button>
                                  ) : (
                                    <button className="ai-send-btn" disabled={aiBusy || !aiInput.trim() || !aiConfig.hasApiKey} onClick={() => handleAISendChat(aiInput)}>
                                      {aiBusy ? t.aiSending : t.aiSend}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </ErrorBoundary>
              ) : showCenterGraph ? (
                <div className="center-graph-view">
                  <div className="center-graph-header">
                    <button className="center-graph-back-btn" onClick={() => setShowCenterGraph(false)}>{'← Back'}</button>
                    <span className="center-graph-title"><GraphIcon size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />Knowledge Graph</span>
                  </div>
                  <div className="center-graph-body">
                    <React.Suspense fallback={<LazyPanelFallback label="正在加载知识图谱..." />}>
                      <GraphView
                        graphData={graphData}
                        graphSummary={graphSummary}
                        onOpenFile={(relPath) => { setShowCenterGraph(false); openFile(relPath); }}
                        onTagClick={handleTagClick}
                        onCreateMissingNote={handleCreateMissingNote}
                        currentFilePath={currentFileRelPath}
                        vaultIndex={vaultIndex}
                      />
                    </React.Suspense>
                  </div>
                </div>
              ) : currentFile ? (
                isMarkdownFile ? (
                  <>
                    <div className="editor-titlebar">
                      <div className="editor-titlebar-main">
                        <div className="editor-breadcrumbs editor-context-path" title={currentFileRelPath}>
                          {isDirty && <span className="editor-dirty-dot" />}
                          <span className="editor-breadcrumb-root">{vault?.name || 'Vault'}</span>
                          {currentFileBreadcrumbs.map((part) => (
                            <React.Fragment key={part.path}>
                              <ChevronRightIcon size={11} className="editor-breadcrumb-separator" />
                              <span className={'editor-breadcrumb-part' + (part.isFile ? ' file' : '')}>{part.label}</span>
                            </React.Fragment>
                          ))}
                          {isDirty && <span className="editor-modified-pill">{t.modified}</span>}
                        </div>
                      </div>
                      <span className="editor-titlebar-right">
                      <button
                        type="button"
                        className="editor-title-action"
                        title="定位到文件浏览器"
                        onClick={() => {
                          revealLeftPanel();
                          setSidebarRevealRequest((value) => value + 1);
                        }}
                      >
                        <LocateIcon size={13} />
                        <span>Reveal</span>
                      </button>
                      <button
                        type="button"
                        className="editor-title-action"
                        title="复制相对路径"
                        onClick={() => {
                          void navigator.clipboard.writeText(currentFileRelPath || currentFile).then(() => {
                            showNotice('路径已复制', 'success', 1800);
                          }).catch(() => showNotice('复制失败', 'warning'));
                        }}
                      >
                        <CopyIcon size={13} />
                        <span>Path</span>
                      </button>
                      <span className="editor-export-actions">
                        <button title="Export HTML" className="editor-export-btn"
                          onClick={() => {
                            const html = renderMarkdownHtml(currentContent);
                            const full = buildMarkdownExportDocument(html, currentFileName || 'document');
                            const blob = new Blob([full], { type: 'text/html' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a'); a.href = url; a.download = (currentFileName || 'document').replace(/\.md$/i, '') + '.html'; a.click();
                            URL.revokeObjectURL(url);
                          }}>HTML</button>
                        <button title="Export as PDF" className="editor-export-btn editor-export-btn-primary"
                          onClick={async () => {
                            if (!api?.exportPdf) return;
                              const html = renderMarkdownHtml(currentContent);
                              const fullHtml = buildMarkdownExportDocument(html, currentFileName || 'document');
                            try {
                              const result = await api.exportPdf(fullHtml, currentFileName || 'document');
                              if (result.ok) { setCreationMsg('PDF exported'); setTimeout(() => setCreationMsg(''), 2500); }
                            } catch (err: any) { console.error('PDF export failed:', err); }
                          }}>PDF</button>
                      </span>
                    </span></div>
                    <EditorToolbar editorRef={editorRef} viewMode={viewMode} onViewModeChange={setViewMode} />
                    <div className={'editor-body-area' + (viewMode === 'split' ? ' split-mode' : '')}>
                      {viewMode === 'preview' ? (
                        <div className="markdown-preview preview-full">
                          <div className="markdown-preview-body" onClick={handleMarkdownPreviewClick} dangerouslySetInnerHTML={{ __html: editorPreviewHtml }} />
                        </div>
                      ) : (
                        (viewMode === 'live' || viewMode === 'source' || viewMode === 'split') && (
                          <div className={viewMode === 'split' ? 'editor-split-pane' : viewMode === 'live' ? 'cm-live-editor-shell' : 'cm-editor-shell'}>
                            <Editor key={viewMode === 'live' ? 'lp' : 'src'} ref={editorRef} documentKey={currentFile} content={currentContent} onChange={handleEditorChange} onSave={saveNow} vaultPath={vaultPath} vaultFiles={allMdFiles} vaultTags={allVaultTags.map(t => t[0])} livePreview={viewMode === 'live'} readOnly={false} onReady={finishDocumentOpeningEvent} />
                          </div>
                        )
                      )}
                      {viewMode === 'split' && (
                        <div className={'markdown-preview' + (viewMode === 'split' ? ' preview-split-pane' : ' preview-full')}>
                          <div className="markdown-preview-body" onClick={handleMarkdownPreviewClick} dangerouslySetInnerHTML={{ __html: editorPreviewHtml }} />
                        </div>
                      )}
                    </div>
                  </>
                ) : isExcalidrawFile ? (
                  <React.Suspense fallback={<LazyPanelFallback label="正在加载 UI 原型编辑器..." />}>
                    <ExcalidrawEditor
                      key={currentFile}
                      content={currentContent}
                      onChange={handleEditorChange}
                      onSave={saveNow}
                      onFlush={flushExcalidrawContent}
                      vaultPath={vaultPath || undefined}
                      fileName={currentFileName}
                    />
                  </React.Suspense>
                ) : isCanvasFile ? (
                  <React.Suspense fallback={<LazyPanelFallback label="正在加载 Canvas 编辑器..." />}>
                    <CanvasEditor
                      key={currentFile}
                      content={currentContent}
                      onChange={(val) => { setCurrentContent(val); setSaveStatus('unsaved'); }}
                      onSave={saveNow}
                      vaultPath={vaultPath || undefined}
                      fileName={currentFileName}
                      onOpenFile={(relPath) => {
                        const fullPath = vaultPath + '/' + relPath.replace(/\\/g, '/');
                        openFile(fullPath);
                      }}
                    />
                  </React.Suspense>
                ) : (
                  <div className="empty-state"><div className="empty-state-icon"><FileIcon size={24} /></div><div className="empty-state-text">{t.unsupportedFileType}</div><div className="empty-state-hint">{currentFileName}</div></div>
                )
              ) : (
                <div className="editor-welcome">
                    <div className="editor-welcome-card">
                      <div className="editor-welcome-kicker">{vault?.name || 'Vault'} is open</div>
                      <div className="editor-welcome-icon">{'{A}'}</div>
                      <div className="editor-welcome-title">Ars-note Game Dev Hub</div>
                      <div className="editor-welcome-subtitle">Pick up from your index, create a note, or jump into the project panels.</div>
                      <div className="editor-welcome-actions">
                        <button className="editor-welcome-btn editor-welcome-btn-primary" onClick={async () => {
                          if (!vaultPath) return;
                          const indexPath = await api.joinPath(vaultPath, '00_Index.md');
                          await openFile(indexPath);
                        }}>
                          <span className="editor-welcome-btn-title">Open 00_Index.md</span>
                          <span className="editor-welcome-btn-desc">Start from the vault home note</span>
                        </button>
                        <button className="editor-welcome-btn" onClick={() => { setContextTarget(vaultPath); setShowNewFile(true); }}>
                          <span className="editor-welcome-btn-title">New note</span>
                          <span className="editor-welcome-btn-desc">Create a Markdown file in this vault</span>
                        </button>
                        <button className="editor-welcome-btn" onClick={() => { setQuickSwitchMode('files'); setShowQuickSwitch(true); }}>
                          <span className="editor-welcome-btn-title">Quick switcher</span>
                          <span className="editor-welcome-btn-desc">Search files and commands</span>
                        </button>
                        <button
                          className="editor-welcome-btn"
                          disabled={teamWorkspaceOpening}
                          aria-busy={teamWorkspaceOpening}
                          onClick={() => { void handleOpenTeamWorkspace(); }}
                        >
                          <span className="editor-welcome-btn-title">Ars-note 团队工作台</span>
                          <span className="editor-welcome-btn-desc">
                            {teamWorkspaceOpening ? '正在准备团队任务、成员页和制作控制台...' : '团队时间表、制作指挥中心、AI接管和文档缺口集中入口'}
                          </span>
                        </button>
                        <button className="editor-welcome-btn" onClick={() => { setShowCenterSchedule(false); setShowCenterGraph(true); }}>
                          <span className="editor-welcome-btn-title">Open graph</span>
                          <span className="editor-welcome-btn-desc">Explore links across the vault</span>
                        </button>
                        <button className="editor-welcome-btn" onClick={async () => {
                          if (!vaultPath) return;
                          const today = new Date();
                          const dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
                          const dailyPath = await api.joinPath(vaultPath, '98_Daily', dateStr + '.md');
                          const content = '# Daily Note - ' + dateStr + '\n\n## Tasks\n- [ ] \n\n## Notes\n\n## Ideas\n';
                          try { await api.createFile(dailyPath, content); } catch {}
                          await refreshTree(); await refreshIndex(); await openFile(dailyPath);
                        }}>
                          <span className="editor-welcome-btn-title">Today's note</span>
                          <span className="editor-welcome-btn-desc">Capture tasks and ideas for today</span>
                        </button>
                      </div>
                    </div>
                  </div>
              )}
            </div>
            {!rightCollapsed && !settingsModalOpen && (
              <div
                className="workspace-resizer workspace-resizer-right"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize right sidebar"
                onMouseDown={beginRightPanelResize}
              />
            )}
            {/* Right panel toggle button */}
            {!settingsModalOpen && (
            <button className="right-panel-toggle" onClick={toggleRightPanel} title={rightCollapsed ? ((t as any).expandPanel || 'Expand') : ((t as any).collapsePanel || 'Collapse')}>
              <span className="right-toggle-icon">{rightCollapsed ? '◂' : '▸'}</span>
            </button>
            )}
            {/* Right panel wrapper */}
            {settingsModalOpen && <div className="ars-settings-backdrop" onClick={closeSettingsModal} />}
            <div className={'right-panel-wrapper' + (rightCollapsed && !settingsModalOpen ? ' collapsed' : '')}>
            {settingsModalOpen && (
              <aside className="ars-settings-sidebar" aria-label="Settings categories">
                <div className="ars-settings-nav-clean">
                  <button type="button" className="ars-settings-back" onClick={closeSettingsModal}>←</button>
                  <div className="ars-settings-label">选项</div>
                  {settingsNavItem('home', '常用设置')}
                  {settingsNavItem('about', '关于')}
                  {settingsNavItem('editor', '编辑器')}
                  {settingsNavItem('appearance', '外观')}
                  {settingsNavItem('files', '文件与链接')}
                  {settingsNavItem('sync', '同步')}
                  {settingsNavItem('ai', 'AI')}
                  <div className="ars-settings-label">核心插件</div>
                  {settingsNavItem('recovery', '文件恢复')}
                  {settingsNavItem('commands', '命令面板')}
                  {settingsNavItem('preview', '页面预览')}
                  <div className="ars-settings-label">第三方插件</div>
                  {settingsNavItem('ars-ai', 'Ars-note AI')}
                  {settingsNavItem('live-sync', 'Live Sync')}
                </div>
              </aside>
            )}
            {settingsModalOpen && (
              <button type="button" className="ars-settings-close" onClick={closeSettingsModal} aria-label="Close settings">×</button>
            )}
            <React.Suspense fallback={<LazyPanelFallback label="正在加载右侧工作区..." />}>
            <RightPanel activeTab={rightTab} onTabChange={handleRightPanelTabChange} settingsSection={settingsModalSection} onSettingsSectionChange={setSettingsModalSection} previewContent={rightPanelDocumentContent} searchQuery={searchQuery} searchResults={searchResults}
              onSearch={handleSearch} onSearchResultClick={openFile} onCreateFromTemplate={handleCreateFromTemplate}
              currentFilePath={currentFile} vaultPath={vaultPath} vaultId={vault?.vaultId || ''}
              currentTags={currentTags} groupedIncomingLinks={groupedIncomingLinks} outgoingLinksInfo={outgoingLinksInfo}
              allVaultTags={allVaultTags} tagToNotesMap={tagToNotesMap}
              noteCount={noteCount} tagCount={tagCount}
              graphData={graphData} graphSummary={graphSummary}
              onRefreshIndex={refreshIndex} indexRefreshMsg={indexRefreshMsg}
              lastManifest={lastManifest} lastBackup={lastBackup} backupBusy={backupBusy}
              onGenerateManifest={handleGenerateManifest} onExportBackup={handleExportBackup}
              backupList={backupList} restoreSummary={restoreSummary}
              backupVerifyResult={backupVerifyResult} verifyingBackupId={verifyingBackupId}
              deletingBackupId={deletingBackupId}
              backupRetentionLimit={backupRetentionLimit}
              backupPruneSummary={backupPruneSummary}
              backupPruneBusy={backupPruneBusy}
              backupLifecycleMessage={backupLifecycleMessage}
              syncConfig={syncConfig}
              remoteBackups={remoteBackups} cloudUploadSummary={cloudUploadSummary} cloudDownloadSummary={cloudDownloadSummary} cloudBusy={cloudBusy}
              deletingRemoteBackupId={deletingRemoteBackupId}
              downloadedBackups={downloadedBackups} downloadedVerifyResult={downloadedVerifyResult} downloadedRestoreSummary={downloadedRestoreSummary} downloadedBusy={downloadedBusy}
              providerValidation={providerValidation}
              s3CredentialStatus={s3CredentialStatus}
              onSetS3Credentials={handleSetS3Credentials}
              onClearS3Credentials={handleClearS3Credentials}
              s3ConnectionTest={s3ConnectionTest}
              s3Testing={s3Testing}
              onTestS3Connection={handleTestS3Connection}
              selfHostedCredentialStatus={selfHostedCredentialStatus}
              onSetSelfHostedCredentials={handleSetSelfHostedCredentials}
              onClearSelfHostedCredentials={handleClearSelfHostedCredentials}
              syncCompareResult={syncCompareResult}
              syncBusy={syncBusy}
              onCompareLocalRemote={handleCompareLocalRemote}
              onManualPush={handleManualPush}
              onManualPull={handleManualPull}
              onCompareWithRemote={handleCompareWithRemote}
              syncPreview={syncPreview}
              syncPreviewBusy={syncPreviewBusy}
              onPreviewRemoteDiff={handlePreviewRemoteDiff}
              onListBackups={handleListBackups} onRestoreBackup={handleRestoreBackup} onVerifyBackup={handleVerifyBackup}
              backupFileList={backupFileList}
              backupFileLoading={backupFileLoading}
              backupFileRestoreSummary={backupFileRestoreSummary}
              restoringBackupFileKey={restoringBackupFileKey}
              onListBackupFiles={handleListBackupFiles}
              onRestoreBackupFile={handleRestoreBackupFile}
              onDeleteBackup={handleDeleteBackup}
              onBackupRetentionLimitChange={handleBackupRetentionLimitChange}
              onPruneBackups={handlePruneBackups}
              onSaveSyncConfig={handleSaveSyncConfig}
              onUploadBackupToRemote={handleUploadBackupToRemote} onListRemoteBackups={handleListRemoteBackups} onDownloadRemoteBackup={handleDownloadRemoteBackup}
              onDeleteRemoteBackup={handleDeleteRemoteBackup}
              onListDownloadedBackups={handleListDownloadedBackups} onVerifyDownloadedBackup={handleVerifyDownloadedBackup} onRestoreDownloadedBackup={handleRestoreDownloadedBackup}
              onTagClick={handleTagClick}
              onCreateMissingNote={handleCreateMissingNote} showConfirm={showConfirm}
              onNotify={showNotice}
              vaultIndex={vaultIndex}
              onReloadCurrentFile={reloadCurrentFile}
              onJumpToLine={handleRightPanelJumpToLine}
              gameWorkspaceSummary={gameWorkspace.summary!}
              gameWorkspaceEntries={gameWorkspace.entries}
              onOpenTeamWorkspace={handleOpenTeamWorkspace}
              onCreateGameDoc={handleCreateGameDoc}
              onCreateNarrativeProductionKit={handleCreateNarrativeProductionKit}
              gameDocCreating={gameDocCreating}
              onExportGameWorkspaceReport={handleExportGameWorkspaceReport}
              reportBusy={reportBusy}
              arshisConfig={arshisConfig}
              onArshisConfigChange={setArshisConfig}
              onArshisExportGameContext={handleArshisExportGameContext}
              arshisExporting={arshisExporting}
              arshisExportMsg={arshisExportMsg}
              aiConfig={aiConfig}
              onAISaveConfig={handleRightPanelAISaveConfig}
              onAITestConnection={handleAITestConnection}
              onAIClearConfig={handleAIClearConfig}
              aiTesting={aiTesting}
              aiTestResult={aiTestResult}
              aiFormProvider={aiFormProvider}
              aiFormBaseUrl={aiFormBaseUrl}
              aiFormModel={aiFormModel}
              aiFormApiKey={aiFormApiKey}
              onAIFormChange={handleRightPanelAIFormChange}
              aiChatMessages={aiChatMessages}
              aiInput={aiInput}
              aiContextMode={aiContextMode}
              aiControlMode={aiControlMode}
              aiContextUsage={visibleAIContextUsage}
              aiSending={aiBusy}
              aiCanCancel={aiSending}
              aiCanRetry={!aiBusy && Boolean(aiRetryPrompt)}
              aiCopiedResponse={aiCopiedResponse}
              onAIInputChange={setAiInput}
              onAIContextModeChange={setAiContextMode}
              onAIControlModeChange={setAiControlMode}
              onAISendChat={handleAISendChat}
              onAICancelChat={handleAICancelChat}
              onAIRetryLast={handleRightPanelAIRetry}
              onAIImportTasksToSchedule={handleAIImportTasksToSchedule}
              onRefreshVault={handleRightPanelRefreshVault}
              onAICopyResponse={handleRightPanelCopyResponse} />
            </React.Suspense>
            </div>{/* end right-panel-wrapper */}
          </div>
          <StatusBar filePath={currentFileRelPath} fileName={currentFileName} isDirty={isDirty} saving={saveStatus === 'saving'} saveStatus={saveStatusText} hasVault={!!vault} content={deferredCurrentContent} appVersion={APP_VERSION_LABEL} vaultName={vault?.name} focusMode={focusMode} onToggleFocus={handleToggleFocusMode} onOpenShortcuts={handleOpenShortcutGuide} />
        </React.Suspense>
      )}
      {showNewFile && <NewItemDialog title={t.newMarkdownFile} placeholder={t.filenamePlaceholder} onConfirm={handleNewFile} onCancel={() => setShowNewFile(false)} />}
      {showNewFolder && <NewItemDialog title={t.newFolderTitle} placeholder={t.folderPlaceholder} onConfirm={handleNewFolder} onCancel={() => setShowNewFolder(false)} />}
      {showNewFromTemplate && (
        <React.Suspense fallback={null}>
          <TemplateDialog onSelect={handleCreateFromTemplate} onCancel={() => setShowNewFromTemplate(false)} />
        </React.Suspense>
      )}
      {deleteTarget && (
        <ConfirmDialog
          title={t.confirmDelete}
          message={deleteItemName}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget('')}
          confirmLabel={t.delete}
          confirmTone="danger"
        />
      )}
      {confirmConfig && (
        <ConfirmDialog
          title={confirmConfig.title}
          message={confirmConfig.message}
          onConfirm={() => { confirmConfig.resolve?.(true); setConfirmConfig(null); }}
          onCancel={() => { confirmConfig.resolve?.(false); setConfirmConfig(null); }}
          confirmLabel={confirmConfig.confirmLabel}
          confirmTone={confirmConfig.confirmTone}
        />
      )}
      {promptConfig && (
        <PromptDialog
          title={promptConfig.title}
          message={promptConfig.message}
          defaultValue={promptConfig.defaultValue}
          placeholder={promptConfig.placeholder}
          onConfirm={handlePromptConfirm}
          onCancel={handlePromptCancel}
        />
      )}
      {notices.length > 0 && (
        <aside className="app-notice-stack" aria-live="polite" aria-label="Notifications">
          {notices.map((notice) => (
            <div className={`app-notice ${notice.tone}`} key={notice.id} role={notice.tone === 'error' ? 'alert' : 'status'}>
              <span className="app-notice-indicator" aria-hidden="true" />
              <span className="app-notice-message">{notice.message}</span>
              <button
                type="button"
                className="app-notice-close"
                aria-label="Dismiss notification"
                onClick={() => dismissNotice(notice.id)}
              >
                <CloseIcon size={11} />
              </button>
            </div>
          ))}
        </aside>
      )}
      {workspaceSnapshotsOpen && (
        <div className="workspace-snapshot-overlay" onMouseDown={() => setWorkspaceSnapshotsOpen(false)}>
          <section
            className="workspace-snapshot-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Saved workspaces"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="workspace-snapshot-header">
              <div>
                <span className="workspace-snapshot-eyebrow">Layout library</span>
                <h3>Workspaces</h3>
                <p>Switch between task-focused tab and panel arrangements.</p>
              </div>
              <button
                type="button"
                className="workspace-snapshot-close"
                aria-label="Close saved workspaces"
                onClick={() => setWorkspaceSnapshotsOpen(false)}
              >
                <CloseIcon size={14} />
              </button>
            </header>
            <div className="workspace-snapshot-toolbar">
              <button
                type="button"
                className="workspace-snapshot-save"
                onClick={() => {
                  setWorkspaceSnapshotsOpen(false);
                  void saveWorkspaceSnapshot();
                }}
              >
                Save current workspace
              </button>
              <span>{workspaceSnapshots.length}/12 saved</span>
            </div>
            <div className="workspace-snapshot-list">
              {workspaceSnapshots.length === 0 ? (
                <div className="workspace-snapshot-empty">
                  <strong>No saved workspaces yet</strong>
                  <span>Save a layout for writing, planning, review, or research.</span>
                </div>
              ) : workspaceSnapshots.map((snapshot) => (
                <article className="workspace-snapshot-item" key={snapshot.id}>
                  <button
                    type="button"
                    className="workspace-snapshot-load"
                    onClick={() => { void restoreWorkspaceSnapshot(snapshot); }}
                  >
                    <span className="workspace-snapshot-glyph">{snapshot.openTabs.length}</span>
                    <span className="workspace-snapshot-copy">
                      <strong>{snapshot.name}</strong>
                      <small>
                        {snapshot.openTabs.length} tabs · {snapshot.pinnedTabs.length} pinned · {snapshot.viewMode} view
                      </small>
                    </span>
                    <span className="workspace-snapshot-date">
                      {snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleDateString() : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="workspace-snapshot-delete"
                    aria-label={`Delete ${snapshot.name}`}
                    onClick={() => { void deleteWorkspaceSnapshot(snapshot); }}
                  >
                    <CloseIcon size={12} />
                  </button>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
      {openTabsMenu && (
        <>
          <div className="context-menu-overlay" onMouseDown={() => setOpenTabsMenu(null)} />
          <div
            className="context-menu open-tabs-menu"
            role="menu"
            aria-label="Open tabs"
            style={{
              left: Math.max(8, Math.min(openTabsMenu.x, window.innerWidth - 338)),
              top: Math.max(8, Math.min(openTabsMenu.y, window.innerHeight - Math.min(460, 82 + openTabs.length * 45))),
            }}
          >
            <div className="open-tabs-menu-header">
              <span>Open tabs</span>
              <span>{openTabs.length}</span>
            </div>
            <div className="open-tabs-menu-list">
              {openTabs.map((tabPath, index) => {
                const tabName = tabPath.split(/[\\/]/).pop() || tabPath;
                const normalizedRoot = normalizePath(vaultPath).replace(/\/+$/, '');
                const relativePath = normalizePath(tabPath).startsWith(normalizedRoot + '/')
                  ? normalizePath(tabPath).slice(normalizedRoot.length + 1)
                  : normalizePath(tabPath);
                const isActive = tabPath === currentFile;
                const isPinned = pinnedTabs.some((path) => normalizePath(path).toLowerCase() === normalizePath(tabPath).toLowerCase());
                return (
                  <div
                    key={tabPath}
                    className={'open-tabs-menu-item' + (isActive ? ' active' : '')}
                    role="menuitem"
                    onClick={() => {
                      if (!isActive) void openFile(tabPath);
                      setOpenTabsMenu(null);
                    }}
                  >
                    <span className="open-tabs-menu-index">{index < 8 ? index + 1 : index === openTabs.length - 1 ? 9 : ''}</span>
                    {isPinned ? <span className="document-tab-pin" title="Pinned tab" /> : <FileIcon size={13} />}
                    <span className="open-tabs-menu-label">
                      <strong>{tabName}</strong>
                      <small>{relativePath}</small>
                    </span>
                    <button
                      type="button"
                      className="open-tabs-menu-close"
                      aria-label={`Close ${tabName}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void closeEditorTab(tabPath);
                      }}
                    >
                      <CloseIcon size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
            {openTabs.some((path) => !pinnedTabs.some((pinnedPath) => normalizePath(pinnedPath).toLowerCase() === normalizePath(path).toLowerCase())) && (
              <button
                type="button"
                className="open-tabs-menu-clear"
                onClick={() => {
                  void closeEditorTabs(openTabs);
                  setOpenTabsMenu(null);
                }}
              >
                Close unpinned tabs
              </button>
            )}
          </div>
        </>
      )}
      {tabContextMenu && (() => {
        const targetIndex = openTabs.findIndex((path) => path === tabContextMenu.path);
        const targetKey = normalizePath(tabContextMenu.path).toLowerCase();
        const isBookmarked = bookmarkedFiles.some((path) => normalizePath(path).toLowerCase() === targetKey);
        const isPinned = pinnedTabs.some((path) => normalizePath(path).toLowerCase() === targetKey);
        const isPinnedPath = (path: string) => pinnedTabs.some((pinnedPath) => normalizePath(pinnedPath).toLowerCase() === normalizePath(path).toLowerCase());
        const tabsRight = targetIndex >= 0 ? openTabs.slice(targetIndex + 1).filter((path) => !isPinnedPath(path)) : [];
        const otherTabs = openTabs.filter((path) => path !== tabContextMenu.path && !isPinnedPath(path));
        const closeMenu = () => setTabContextMenu(null);
        return (
          <>
            <div className="context-menu-overlay" onMouseDown={closeMenu} />
            <div
              className="context-menu tab-context-menu"
              role="menu"
              aria-label="Tab actions"
              style={{
                left: Math.max(8, Math.min(tabContextMenu.x, window.innerWidth - 218)),
                top: Math.max(8, Math.min(tabContextMenu.y, window.innerHeight - 290)),
              }}
            >
              <div className="context-menu-item" role="menuitem" onClick={() => { void closeEditorTab(tabContextMenu.path); closeMenu(); }}>
                <span className="ctx-icon">×</span>
                Close tab
                <span className="tab-context-shortcut">Ctrl+W</span>
              </div>
              <div className="context-menu-item" role="menuitem" onClick={() => { togglePinnedTab(tabContextMenu.path); closeMenu(); }}>
                <span className="ctx-icon">{isPinned ? '−' : '+'}</span>
                {isPinned ? 'Unpin tab' : 'Pin tab'}
              </div>
              {otherTabs.length > 0 && (
                <div className="context-menu-item" role="menuitem" onClick={() => { void closeEditorTabs(otherTabs); closeMenu(); }}>
                  <span className="ctx-icon">1</span>
                  Close other tabs
                </div>
              )}
              {tabsRight.length > 0 && (
                <div className="context-menu-item" role="menuitem" onClick={() => { void closeEditorTabs(tabsRight); closeMenu(); }}>
                  <span className="ctx-icon">→</span>
                  Close tabs to the right
                </div>
              )}
              {closedTabs.length > 0 && (
                <div className="context-menu-item" role="menuitem" onClick={() => { void reopenLastClosedTab(); closeMenu(); }}>
                  <span className="ctx-icon">↻</span>
                  Reopen closed tab
                  <span className="tab-context-shortcut">Ctrl+Shift+T</span>
                </div>
              )}
              <div className="context-menu-separator" />
              <div className="context-menu-item" role="menuitem" onClick={() => { toggleBookmark(tabContextMenu.path); closeMenu(); }}>
                <span className="ctx-icon">{isBookmarked ? '−' : '+'}</span>
                {isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
              </div>
              <div
                className="context-menu-item"
                role="menuitem"
                onClick={() => {
                  void navigator.clipboard.writeText(tabContextMenu.path).catch(() => {});
                  closeMenu();
                }}
              >
                <span className="ctx-icon">#</span>
                Copy file path
              </div>
            </div>
          </>
        );
      })()}
      {showQuickSwitch && vaultPath && (
        <React.Suspense fallback={null}>
          <QuickSwitcher
            key={quickSwitchMode}
            files={allQuickSwitcherFiles}
            fileMetadata={quickSwitcherFileMetadata}
            commands={commandPaletteCommands}
            currentPath={currentFile}
            recentFiles={recentFilePaths}
            pinnedFiles={pinnedTabs}
            bookmarkedFiles={bookmarkedFiles}
            rootPath={vaultPath}
            initialMode={quickSwitchMode}
            onSelect={openFile}
            onCreateNote={handleQuickCreateNote}
            onClearRecent={() => applyNavigationState(currentFile ? [currentFile] : [], currentFile ? 0 : -1)}
            onClose={() => setShowQuickSwitch(false)}
          />
        </React.Suspense>
      )}
      {showShortcutGuide && (
        <React.Suspense fallback={null}>
          <ShortcutGuide onClose={() => setShowShortcutGuide(false)} />
        </React.Suspense>
      )}
    </div>
  );
};

export default App;
