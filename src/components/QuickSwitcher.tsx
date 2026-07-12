import React, { useState, useEffect, useRef, useMemo } from 'react';

export interface QuickCommand {
  id: string;
  title: string;
  subtitle?: string;
  shortcut?: string;
  keywords?: string[];
  run: () => void | Promise<void>;
}

export interface QuickFileMeta {
  title?: string;
  relativePath?: string;
  fileName?: string;
  keywords?: string[];
}

interface Props {
  files: string[];
  fileMetadata?: Record<string, QuickFileMeta>;
  commands?: QuickCommand[];
  currentPath?: string;
  recentFiles?: string[];
  pinnedFiles?: string[];
  bookmarkedFiles?: string[];
  rootPath?: string;
  initialMode?: 'files' | 'commands';
  onSelect: (path: string) => void | Promise<void>;
  onCreateNote?: (name: string) => void | Promise<void>;
  onClearRecent?: () => void;
  onClose: () => void;
}

type PaletteItem =
  | { type: 'command'; id: string; title: string; subtitle: string; command: QuickCommand; score: number; section: string; recent: boolean }
  | { type: 'create'; id: string; title: string; subtitle: string; value: string; score: number; section: string; recent: false }
  | { type: 'file'; id: string; title: string; subtitle: string; path: string; score: number; section: string; recent: boolean; current: boolean; pinned: boolean; bookmarked: boolean; kind: string };

const RECENT_KEY = 'ars-note.quick-switcher.recent';
const RECENT_COMMAND_KEY = 'ars-note.command-palette.recent';

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\\/g, '/').replace(/\s+/g, ' ').trim();
}

function splitQuery(query: string): string[] {
  return normalizeText(query).split(/[\s/]+/).filter(Boolean);
}

function relativeDisplayPath(path: string, rootPath: string): string {
  const normalized = path.replace(/\\/g, '/');
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalizedRoot) return normalized;
  if (normalized.toLowerCase() === normalizedRoot.toLowerCase()) return '';
  if (normalized.toLowerCase().startsWith(normalizedRoot.toLowerCase() + '/')) {
    return normalized.slice(normalizedRoot.length + 1);
  }
  return normalized;
}

function fileTitle(path: string): string {
  return path.split('/').pop() || path;
}

function fileFolder(path: string): string {
  return path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : 'Vault root';
}

function fuzzyScore(text: string, query: string, parts: string[]): number {
  if (!query) return 1;
  const haystack = normalizeText(text);
  const needle = normalizeText(query);
  if (!parts.every(part => haystack.includes(part))) return -1;

  let score = 20;
  if (haystack === needle) score += 160;
  if (haystack.startsWith(needle)) score += 90;
  if (haystack.includes(`/${needle}`) || haystack.includes(` ${needle}`)) score += 55;
  score += Math.max(0, 80 - haystack.indexOf(parts[0]));
  score -= Math.max(0, haystack.length - needle.length) * 0.02;
  return score;
}

function recentStorageKey(rootPath: string): string {
  return rootPath ? `${RECENT_KEY}:${normalizeText(rootPath)}` : RECENT_KEY;
}

function readRecentFiles(files: string[], rootPath: string): string[] {
  const available = new Set(files.map(normalizeText));
  try {
    const raw = localStorage.getItem(recentStorageKey(rootPath));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && available.has(normalizeText(item))).slice(0, 12)
      : [];
  } catch {
    return [];
  }
}

function rememberRecentFile(path: string, rootPath: string): void {
  try {
    const key = recentStorageKey(rootPath);
    const existing = localStorage.getItem(key);
    const parsed = existing ? JSON.parse(existing) : [];
    const list = Array.isArray(parsed) ? parsed.filter((item: unknown): item is string => typeof item === 'string') : [];
    const normalizedPath = normalizeText(path);
    localStorage.setItem(key, JSON.stringify([path, ...list.filter(item => normalizeText(item) !== normalizedPath)].slice(0, 18)));
  } catch {
    // LocalStorage is optional; quick switcher should still work without it.
  }
}

function clearRecentFiles(rootPath: string): void {
  try {
    localStorage.removeItem(recentStorageKey(rootPath));
  } catch {
    // LocalStorage is optional.
  }
}

function readRecentCommands(rootPath: string): string[] {
  try {
    const raw = localStorage.getItem(`${RECENT_COMMAND_KEY}:${normalizeText(rootPath)}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}

function rememberRecentCommand(id: string, rootPath: string): void {
  try {
    const key = `${RECENT_COMMAND_KEY}:${normalizeText(rootPath)}`;
    const existing = localStorage.getItem(key);
    const parsed = existing ? JSON.parse(existing) : [];
    const list = Array.isArray(parsed) ? parsed.filter((item: unknown): item is string => typeof item === 'string') : [];
    localStorage.setItem(key, JSON.stringify([id, ...list.filter(item => item !== id)].slice(0, 18)));
  } catch {
    // Command history is optional.
  }
}

function clearRecentCommands(rootPath: string): void {
  try {
    localStorage.removeItem(`${RECENT_COMMAND_KEY}:${normalizeText(rootPath)}`);
  } catch {
    // Command history is optional.
  }
}

function fileKind(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.canvas')) return 'CANVAS';
  if (lower.endsWith('.excalidraw')) return 'DRAW';
  return 'MD';
}

function highlightMatch(text: string, rawQuery: string): React.ReactNode {
  const query = normalizeText(rawQuery.replace(/^>/, ''));
  if (!query) return text;
  const lower = text.toLowerCase();
  const directIndex = lower.indexOf(query);
  if (directIndex < 0) return text;
  return (
    <>
      {text.slice(0, directIndex)}
      <mark>{text.slice(directIndex, directIndex + query.length)}</mark>
      {text.slice(directIndex + query.length)}
    </>
  );
}

export default function QuickSwitcher({
  files,
  fileMetadata = {},
  commands = [],
  currentPath = '',
  recentFiles: externalRecentFiles = [],
  pinnedFiles = [],
  bookmarkedFiles = [],
  rootPath = '',
  initialMode = 'files',
  onSelect,
  onCreateNote,
  onClearRecent,
  onClose,
}: Props) {
  const [query, setQuery] = useState(initialMode === 'commands' ? '> ' : '');
  const [activeIdx, setActiveIdx] = useState(0);
  const [storedRecentFiles, setStoredRecentFiles] = useState<string[]>(() => readRecentFiles(files, rootPath));
  const [recentCommandIds, setRecentCommandIds] = useState<string[]>(() => readRecentCommands(rootPath));
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);
  const commandMode = query.trim().startsWith('>');

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActiveIdx(0); }, [query]);
  useEffect(() => { setStoredRecentFiles(readRecentFiles(files, rootPath)); }, [files, rootPath]);
  useEffect(() => { setRecentCommandIds(readRecentCommands(rootPath)); }, [rootPath]);
  useEffect(() => { activeItemRef.current?.scrollIntoView({ block: 'nearest' }); }, [activeIdx]);

  const filtered = useMemo<PaletteItem[]>(() => {
    const rawQuery = query.trim();
    const commandOnly = rawQuery.startsWith('>');
    const normalizedQuery = commandOnly ? rawQuery.slice(1).trim() : rawQuery;
    const parts = splitQuery(normalizedQuery);
    const isEmpty = normalizedQuery.length === 0;
    const recentSet = new Set([...externalRecentFiles, ...storedRecentFiles].map(normalizeText));
    const pinnedSet = new Set(pinnedFiles.map(normalizeText));
    const bookmarkedSet = new Set(bookmarkedFiles.map(normalizeText));
    const normalizedCurrent = normalizeText(currentPath);
    const recentCommandRank = new Map(recentCommandIds.map((id, index) => [id, recentCommandIds.length - index]));

    const commandItems = initialMode === 'files' && !commandOnly ? [] : commands
      .map<PaletteItem | null>(command => {
        const haystack = [command.title, command.subtitle || '', ...(command.keywords || [])].join(' ');
        const score = fuzzyScore(haystack, normalizedQuery, parts);
        if (!isEmpty && score < 0) return null;
        const recent = recentCommandRank.has(command.id);
        return {
          type: 'command',
          id: `command:${command.id}`,
          title: command.title,
          subtitle: command.subtitle || 'Command',
          command,
          score: score + (commandOnly ? 40 : 0) + (recent ? 55 + (recentCommandRank.get(command.id) || 0) : 0),
          section: commandOnly || !isEmpty ? 'Commands' : recent ? 'Recent commands' : 'Suggested commands',
          recent,
        };
      })
      .filter((item): item is PaletteItem => !!item)
      .sort((a, b) => b.score - a.score)
      .slice(0, commandOnly ? 36 : isEmpty ? 7 : 12);

    const fileItems = commandOnly ? [] : files
      .map<PaletteItem | null>(file => {
        const meta = fileMetadata[normalizeText(file)];
        const displayPath = meta?.relativePath || relativeDisplayPath(file, rootPath);
        const rawFileTitle = meta?.fileName || fileTitle(displayPath);
        const title = meta?.title?.trim() || rawFileTitle;
        const folder = fileFolder(displayPath);
        const subtitle = title !== rawFileTitle ? `${rawFileTitle} · ${folder}` : folder;
        const score = fuzzyScore(`${title} ${rawFileTitle} ${displayPath} ${(meta?.keywords || []).join(' ')}`, normalizedQuery, parts);
        if (!isEmpty && score < 0) return null;
        const recent = recentSet.has(normalizeText(file));
        const current = normalizeText(file) === normalizedCurrent;
        const pinned = pinnedSet.has(normalizeText(file));
        const bookmarked = bookmarkedSet.has(normalizeText(file));
        return {
          type: 'file',
          id: `file:${file}`,
          title,
          subtitle,
          path: file,
          score: score + (recent ? 45 : 0) + (bookmarked ? 70 : 0) + (pinned ? 90 : 0) + (current ? 120 : 0),
          section: !isEmpty ? 'Files' : current ? 'Current file' : pinned ? 'Pinned tabs' : bookmarked ? 'Bookmarks' : recent ? 'Recent files' : 'Files',
          recent,
          current,
          pinned,
          bookmarked,
          kind: fileKind(file),
        };
      })
      .filter((item): item is PaletteItem => !!item)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, isEmpty ? 28 : 42);

    if (!isEmpty) {
      const exactMatch = fileItems.some(item => item.type === 'file' && (
        normalizeText(item.title) === normalizeText(normalizedQuery)
        || normalizeText(item.path).replace(/\.md$/, '') === normalizeText(normalizedQuery)
      ));
      const createItems: PaletteItem[] = !commandOnly && onCreateNote && !exactMatch
        ? [{
            type: 'create',
            id: `create:${normalizedQuery}`,
            title: `Create note "${normalizedQuery}"`,
            subtitle: 'Create a new Markdown note in the Vault root',
            value: normalizedQuery,
            score: 0,
            section: 'Create',
            recent: false,
          }]
        : [];
      return [...commandItems, ...fileItems, ...createItems].slice(0, 56);
    }

    const currentItems = fileItems.filter(item => item.type === 'file' && item.current).slice(0, 1);
    const pinnedItems = fileItems.filter(item => item.type === 'file' && !item.current && item.pinned).slice(0, 10);
    const bookmarkItems = fileItems.filter(item => item.type === 'file' && !item.current && !item.pinned && item.bookmarked).slice(0, 10);
    const recentItems = fileItems.filter(item => item.type === 'file' && !item.current && !item.pinned && !item.bookmarked && item.recent).slice(0, 10);
    const regularFileItems = fileItems.filter(item => item.type === 'file' && !item.current && !item.pinned && !item.bookmarked && !item.recent).slice(0, 20);

    return [...commandItems, ...currentItems, ...pinnedItems, ...bookmarkItems, ...recentItems, ...regularFileItems].slice(0, 56);
  }, [bookmarkedFiles, commands, currentPath, externalRecentFiles, fileMetadata, files, initialMode, onCreateNote, pinnedFiles, query, recentCommandIds, rootPath, storedRecentFiles]);

  useEffect(() => {
    if (filtered.length === 0) {
      setActiveIdx(0);
      return;
    }
    setActiveIdx(index => Math.min(index, filtered.length - 1));
  }, [filtered.length]);

  const runItem = (item: PaletteItem) => {
    onClose();
    if (item.type === 'command') {
      rememberRecentCommand(item.command.id, rootPath);
      void Promise.resolve(item.command.run());
      return;
    }
    if (item.type === 'create') {
      void Promise.resolve(onCreateNote?.(item.value));
      return;
    }
    rememberRecentFile(item.path, rootPath);
    void Promise.resolve(onSelect(item.path));
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      setQuery(query.trim().startsWith('>') ? '' : '> ');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Backspace' && !query.trim().replace(/^>/, '').trim()) {
      e.preventDefault();
      clearRecentFiles(rootPath);
      clearRecentCommands(rootPath);
      setStoredRecentFiles([]);
      setRecentCommandIds([]);
      onClearRecent?.();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(index => filtered.length ? (index + 1) % filtered.length : 0);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(index => filtered.length ? (index - 1 + filtered.length) % filtered.length : 0);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      setActiveIdx(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      setActiveIdx(Math.max(0, filtered.length - 1));
      return;
    }
    if (e.key === 'Enter' && filtered[activeIdx]) {
      e.preventDefault();
      runItem(filtered[activeIdx]);
    }
  };

  const switchMode = (mode: 'files' | 'commands') => {
    setQuery(mode === 'commands' ? '> ' : '');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  let lastSection = '';

  return (
    <div
      className="quick-switcher-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div className="quick-switcher-dialog" role="dialog" aria-label="Quick switcher">
        <div className="qs-mode-bar">
          <div className="qs-mode-tabs" role="tablist" aria-label="Quick switcher mode">
            <button className={!commandMode ? 'active' : ''} type="button" role="tab" aria-selected={!commandMode} onClick={() => switchMode('files')}>
              文件
              <kbd>Ctrl O</kbd>
            </button>
            <button className={commandMode ? 'active' : ''} type="button" role="tab" aria-selected={commandMode} onClick={() => switchMode('commands')}>
              命令
              <kbd>Ctrl P</kbd>
            </button>
          </div>
          <span className="qs-result-count">{filtered.length} 个结果</span>
        </div>
        <div className="qs-search-row">
          <div className="qs-search-prefix">{commandMode ? 'CMD' : 'GO'}</div>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="搜索标题、文件名、路径或命令；按 Tab 切换模式"
            aria-label="Search files and commands"
          />
        </div>

        <div className="qs-results" role="listbox" aria-activedescendant={filtered[activeIdx]?.id}>
          {filtered.length === 0 && (
            <div className="qs-empty">
              <strong>没有找到匹配项</strong>
              <span>试试文档标题、文件名、文件夹、标签或命令关键词。</span>
            </div>
          )}
          {filtered.map((item, index) => {
            const showSection = item.section !== lastSection;
            lastSection = item.section;
            return (
              <React.Fragment key={item.id}>
                {showSection && <div className="qs-section">{item.section}</div>}
                <button
                  ref={index === activeIdx ? activeItemRef : undefined}
                  id={item.id}
                  className={`qs-item ${index === activeIdx ? 'active' : ''}`}
                  onClick={() => runItem(item)}
                  onMouseEnter={() => setActiveIdx(index)}
                  role="option"
                  aria-selected={index === activeIdx}
                  type="button"
                >
                  <span className={`qs-badge ${item.type}${item.type === 'file' ? item.current ? ' current' : item.pinned ? ' pinned' : item.bookmarked ? ' bookmarked' : item.recent ? ' recent' : '' : ''}`}>
                    {item.type === 'command'
                      ? item.recent ? 'RECENT' : 'CMD'
                      : item.type === 'create' ? 'NEW'
                      : item.current ? 'NOW' : item.pinned ? 'PIN' : item.bookmarked ? 'STAR' : item.recent ? 'RECENT' : item.kind}
                  </span>
                  <span className="qs-item-main">
                    <strong>{highlightMatch(item.title, query)}</strong>
                    <small>{item.subtitle}</small>
                  </span>
                  <span className="qs-action-hint">{item.type === 'command' && item.command.shortcut ? item.command.shortcut : index === activeIdx ? 'Enter' : ''}</span>
                </button>
              </React.Fragment>
            );
          })}
        </div>

        <div className="qs-footer">
          <span>↑↓ 选择</span>
          <span>Enter 打开</span>
          <span>Tab 文件 / 命令</span>
          <span>Ctrl+Backspace 清理最近记录</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}
