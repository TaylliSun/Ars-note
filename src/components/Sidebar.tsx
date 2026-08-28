import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { FileNode } from '../types';
import { useI18n } from '../i18n';
import FileTree from './FileTree';
import { ArsLogoIcon, PlusIcon, SearchIcon, GraphIcon, BotIcon, BackupIcon, SettingsIcon, SunIcon, MoonIcon, TemplateIcon, BoardIcon, FileIcon, RefreshIcon, LocateIcon, CollapseIcon, FolderIcon, CloseIcon, ClockIcon, BalanceIcon } from './icons/ArsIcons';
import { APP_VERSION_LABEL } from '../appVersion';

interface SidebarProps {
  fileTree: FileNode[];
  vaultPath: string;
  currentFile: string;
  onOpenFile: (path: string) => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onNewFromTemplate?: () => void;
  onNewWireframe?: () => void;
  onNewCanvas?: () => void;
  onDelete: (path: string) => void;
  onSetContextTarget: (path: string) => void;
  onRefresh: () => void;
  onNavigateToTab?: (tab: string) => void;
  onOpenSettings?: (section?: string) => void;
  onMoveItem?: (srcPath: string, destDir: string) => void;
  bookmarkedFiles?: string[];
  recentFiles?: string[];
  onToggleBookmark?: (path: string) => void;
  isConnected?: boolean;
  appVersion?: string;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  onSearchInVault?: (query: string) => void;
  activePanelTab?: string;
  revealCurrentFileRequest?: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const normalizeFilePath = (path: string) => path.replace(/\\/g, '/').toLowerCase();
const expandedStorageKey = (vaultPath: string) => `ars-note.explorer.expanded:${normalizeFilePath(vaultPath)}`;
const recentHiddenStorageKey = (vaultPath: string) => `ars-note.explorer.recentHidden:${normalizeFilePath(vaultPath)}`;
const syncConflictArtifactPattern = /(^|\/)[^/]+\.conflict-\d+$/i;

function isSyncConflictArtifactPath(path: string): boolean {
  return syncConflictArtifactPattern.test(path.replace(/\\/g, '/'));
}

function stripSyncConflictArtifacts(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) => {
    if (!node.isDir && isSyncConflictArtifactPath(node.path || node.name)) return [];
    if (!node.isDir) return [node];
    return [{ ...node, children: stripSyncConflictArtifacts(node.children || []) }];
  });
}

function filterFileTree(nodes: FileNode[], query: string): FileNode[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return nodes;
  return nodes.flatMap((node) => {
    const searchable = `${node.name} ${node.path}`.replace(/\\/g, '/').toLowerCase();
    const nodeMatches = terms.every((term) => searchable.includes(term));
    if (!node.isDir) return nodeMatches ? [node] : [];
    if (nodeMatches) return [node];
    const children = filterFileTree(node.children || [], query);
    return children.length > 0 ? [{ ...node, children }] : [];
  });
}

function collectTreeStats(nodes: FileNode[]): { files: number; folders: number; folderPaths: string[] } {
  let files = 0;
  let folders = 0;
  const folderPaths: string[] = [];
  const walk = (items: FileNode[]) => {
    for (const node of items) {
      if (node.isDir) {
        folders += 1;
        folderPaths.push(node.path);
        walk(node.children || []);
      } else {
        files += 1;
      }
    }
  };
  walk(nodes);
  return { files, folders, folderPaths };
}

const Sidebar: React.FC<SidebarProps> = ({
  fileTree, vaultPath, currentFile, onOpenFile, onNewFile, onNewFolder, onNewFromTemplate, onNewWireframe, onNewCanvas,
  onDelete, onSetContextTarget, onRefresh, onNavigateToTab, onMoveItem,
  onOpenSettings,
  bookmarkedFiles = [], recentFiles = [], onToggleBookmark,
  isConnected = true, appVersion = APP_VERSION_LABEL, theme = 'dark', onToggleTheme,
  onSearchInVault, activePanelTab,
  revealCurrentFileRequest = 0,
  collapsed = false,
  onToggleCollapse,
}) => {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [revealRequest, setRevealRequest] = useState(0);
  const [recentExpanded, setRecentExpanded] = useState(false);
  const [recentHidden, setRecentHidden] = useState(false);
  const skipExpandedPersistRef = useRef(false);
  const visibleFileTree = useMemo(() => stripSyncConflictArtifacts(fileTree), [fileTree]);

  useEffect(() => {
    skipExpandedPersistRef.current = true;
    try {
      const raw = localStorage.getItem(expandedStorageKey(vaultPath));
      const parsed = raw ? JSON.parse(raw) : [];
      setExpandedFolders(new Set(Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === 'string') : []));
    } catch {
      setExpandedFolders(new Set());
    }
  }, [vaultPath]);

  useEffect(() => {
    if (skipExpandedPersistRef.current) {
      skipExpandedPersistRef.current = false;
      return;
    }
    try {
      localStorage.setItem(expandedStorageKey(vaultPath), JSON.stringify([...expandedFolders]));
    } catch {
      // Explorer state persistence is optional.
    }
  }, [expandedFolders, vaultPath]);

  useEffect(() => {
    try {
      setRecentHidden(localStorage.getItem(recentHiddenStorageKey(vaultPath)) === '1');
      setRecentExpanded(false);
    } catch {
      setRecentHidden(false);
    }
  }, [vaultPath]);

  useEffect(() => {
    try {
      localStorage.setItem(recentHiddenStorageKey(vaultPath), recentHidden ? '1' : '0');
    } catch {
      // Recent visibility persistence is optional.
    }
  }, [recentHidden, vaultPath]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim() && onSearchInVault) {
      onSearchInVault(searchQuery.trim());
    }
  };

  const fileNodeMap = useMemo(() => {
    const fileMap = new Map<string, FileNode>();
    const walk = (nodes: FileNode[]) => {
      for (const node of nodes) {
        if (node.isDir) {
          walk(node.children || []);
        } else {
          fileMap.set(normalizeFilePath(node.path), node);
        }
      }
    };
    walk(visibleFileTree);
    return fileMap;
  }, [visibleFileTree]);

  const trimmedSearchQuery = searchQuery.trim();
  const isFilteringFiles = trimmedSearchQuery.length > 0;
  const filteredFileTree = useMemo(() => filterFileTree(visibleFileTree, trimmedSearchQuery), [visibleFileTree, trimmedSearchQuery]);
  const filteredExplorerStats = useMemo(() => collectTreeStats(filteredFileTree), [filteredFileTree]);
  const visibleExpandedFolders = useMemo(
    () => isFilteringFiles ? new Set(filteredExplorerStats.folderPaths) : expandedFolders,
    [expandedFolders, filteredExplorerStats.folderPaths, isFilteringFiles],
  );

  const bookmarkedFileNodes = useMemo(() => {
    return bookmarkedFiles
      .map((path) => fileNodeMap.get(normalizeFilePath(path)))
      .filter((node): node is FileNode => Boolean(node));
  }, [bookmarkedFiles, fileNodeMap]);

  const recentFileNodes = useMemo(() => {
    const seen = new Set<string>();
    return recentFiles
      .map((path) => fileNodeMap.get(normalizeFilePath(path)))
      .filter((node): node is FileNode => {
        if (!node) return false;
        const key = normalizeFilePath(node.path);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 7);
  }, [fileNodeMap, recentFiles]);
  const visibleRecentFileNodes = recentHidden ? [] : recentExpanded ? recentFileNodes : recentFileNodes.slice(0, 3);

  const toggleRecentHidden = () => {
    const nextHidden = !recentHidden;
    setRecentHidden(nextHidden);
    if (nextHidden) setRecentExpanded(false);
  };

  const getParentFolderLabel = (path: string) => {
    const normalized = path.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 2] : 'Vault root';
  };

  const getAncestorFolders = (targetPath: string) => {
    const normalizedTarget = normalizeFilePath(targetPath);
    const folders: string[] = [];
    const walk = (nodes: FileNode[]) => {
      for (const node of nodes) {
        if (!node.isDir) continue;
        const normalizedDir = normalizeFilePath(node.path).replace(/\/+$/, '');
        if (normalizedTarget.startsWith(normalizedDir + '/')) {
          folders.push(node.path);
          walk(node.children || []);
        }
      }
    };
    walk(visibleFileTree);
    return folders;
  };

  useEffect(() => {
    if (!currentFile) return;
    const ancestors = getAncestorFolders(currentFile);
    if (ancestors.length === 0) return;
    setExpandedFolders((previous) => {
      const next = new Set(previous);
      let changed = false;
      for (const path of ancestors) {
        if (!next.has(path)) {
          next.add(path);
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [currentFile, visibleFileTree]);

  const toggleFolder = (path: string) => {
    setExpandedFolders((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const expandFolder = (path: string) => {
    setExpandedFolders((previous) => {
      if (previous.has(path)) return previous;
      const next = new Set(previous);
      next.add(path);
      return next;
    });
  };

  const revealCurrentFile = () => {
    if (!currentFile) return;
    setExpandedFolders((previous) => new Set([...previous, ...getAncestorFolders(currentFile)]));
    setRevealRequest((value) => value + 1);
  };

  useEffect(() => {
    if (revealCurrentFileRequest > 0) revealCurrentFile();
  }, [revealCurrentFileRequest]);

  useEffect(() => {
    const reveal = () => revealCurrentFile();
    const collapse = () => setExpandedFolders(new Set());
    window.addEventListener('ars-note:reveal-current-file', reveal);
    window.addEventListener('ars-note:collapse-explorer', collapse);
    return () => {
      window.removeEventListener('ars-note:reveal-current-file', reveal);
      window.removeEventListener('ars-note:collapse-explorer', collapse);
    };
  }, [currentFile, visibleFileTree]);

  const railAction = (
    key: string,
    title: string,
    icon: React.ReactNode,
    onClick?: () => void,
    active = false,
  ) => (
    <button
      key={key}
      className={'sidebar-rail-btn' + (active ? ' active' : '')}
      title={title}
      onClick={onClick}
      type="button"
    >
      {icon}
    </button>
  );

  return (
    <div className={'sidebar' + (collapsed ? ' sidebar-collapsed' : '')}>
      <div className="sidebar-rail" aria-label="Primary navigation">
        <div className="sidebar-rail-top">
          <div className="sidebar-rail-logo" title="Ars-note">
            <ArsLogoIcon size={20} />
          </div>
          {railAction('files', 'Files', <FolderIcon size={17} />, onToggleCollapse, !collapsed)}
          {railAction('new-file', t.newFile, <PlusIcon size={17} />, () => { onSetContextTarget(''); onNewFile(); })}
          {onNewFromTemplate && railAction('template', t.newFromTemplate, <TemplateIcon size={17} />, onNewFromTemplate)}
          {onNewCanvas && railAction('canvas', t.newCanvas || 'Canvas', <BoardIcon size={17} />, onNewCanvas)}
          {onNewWireframe && railAction('wireframe', t.newWireframe || 'New Wireframe', <FileIcon size={17} />, onNewWireframe)}
          <div className="sidebar-rail-separator" />
          {onNavigateToTab && (
            <>
              {railAction('team-workspace', 'Ars-note 团队工作台', <ClockIcon size={17} />, () => onNavigateToTab('schedule'), activePanelTab === 'schedule')}
              {railAction('balance-lab', '数值实验室', <BalanceIcon size={17} />, () => onNavigateToTab('balance'), activePanelTab === 'balance')}
              {railAction('graph', t.graph, <GraphIcon size={17} />, () => onNavigateToTab('graph'), activePanelTab === 'graph')}
              {railAction('ai', t.aiAssistant, <BotIcon size={17} />, () => onNavigateToTab('ai'), activePanelTab === 'ai')}
              {railAction('backup', t.backup, <BackupIcon size={17} />, () => onNavigateToTab('backup'), activePanelTab === 'backup')}
              {railAction('search', t.search, <SearchIcon size={17} />, () => onNavigateToTab('search'), activePanelTab === 'search')}
              {railAction('settings', t.settings, <SettingsIcon size={17} />, onOpenSettings || (() => onNavigateToTab('settings')), activePanelTab === 'settings')}
            </>
          )}
        </div>
        <div className="sidebar-rail-bottom">
          {onToggleTheme && railAction('theme', theme === 'dark' ? 'Light Mode' : 'Dark Mode', theme === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />, onToggleTheme)}
          <span className={'sidebar-rail-status' + (isConnected ? ' connected' : '')} title={isConnected ? 'Connected' : 'No Vault'} />
        </div>
      </div>

      <div className="sidebar-main">
        <div className="sidebar-pane-header">
          <span className="sidebar-pane-title">{t.explorer}</span>
          <div className="sidebar-pane-actions">
            {recentFileNodes.length > 0 && !isFilteringFiles && (
              <button
                className={'btn-icon sidebar-recent-visibility-btn' + (!recentHidden ? ' active' : '')}
                title={recentHidden ? 'Show recent files' : 'Hide recent files'}
                aria-label={recentHidden ? 'Show recent files' : 'Hide recent files'}
                aria-pressed={!recentHidden}
                onClick={toggleRecentHidden}
              >
                <ClockIcon size={14} />
              </button>
            )}
            <button className="btn-icon" title={t.newFile} aria-label={t.newFile} onClick={() => { onSetContextTarget(''); onNewFile(); }}>
              <PlusIcon size={14} />
            </button>
            {onNewFolder && (
              <button className="btn-icon" title={t.newFolderTitle || 'New Folder'} aria-label={t.newFolderTitle || 'New Folder'} onClick={() => { onSetContextTarget(''); onNewFolder(); }}>
                <FolderIcon size={14} />
              </button>
            )}
            <button className="btn-icon" title="定位当前文件" aria-label="定位当前文件" disabled={!currentFile} onClick={revealCurrentFile}><LocateIcon size={14} /></button>
            <button className="btn-icon" title="全部折叠" aria-label="全部折叠" disabled={expandedFolders.size === 0} onClick={() => setExpandedFolders(new Set())}><CollapseIcon size={14} /></button>
            <button className="btn-icon" title={t.refresh} aria-label={t.refresh} onClick={onRefresh}><RefreshIcon size={14} /></button>
          </div>
        </div>

        {/* Search bar */}
        <form className={'sidebar-search-form' + (isFilteringFiles ? ' filtering' : '')} onSubmit={handleSearch}>
          <SearchIcon size={14} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
          <input
            className="sidebar-search-input"
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && searchQuery) {
                event.preventDefault();
                setSearchQuery('');
              }
            }}
            placeholder="筛选文件，Enter 搜索内容..."
          />
          {searchQuery && (
            <button className="sidebar-search-clear" type="button" onClick={() => setSearchQuery('')} title="清除筛选" aria-label="清除筛选">
              <CloseIcon size={12} />
            </button>
          )}
        </form>
        {isFilteringFiles && (
          <div className="sidebar-search-meta">
            <span>{filteredExplorerStats.files} 个文件匹配</span>
            <button type="button" onClick={() => onSearchInVault?.(trimmedSearchQuery)}>全文搜索</button>
          </div>
        )}

        {!isFilteringFiles && bookmarkedFileNodes.length > 0 && (
          <div className="sidebar-bookmarks">
            <div className="sidebar-section-label sidebar-bookmark-label">Bookmarks</div>
            <div className="sidebar-bookmark-list">
              {bookmarkedFileNodes.map((node) => (
                <button
                  key={node.path}
                  className={'sidebar-bookmark-item' + (normalizeFilePath(currentFile) === normalizeFilePath(node.path) ? ' active' : '')}
                  onClick={() => onOpenFile(node.path)}
                  type="button"
                  title={node.path}
                >
                  <span className="sidebar-bookmark-mark">Pin</span>
                  <span className="sidebar-bookmark-name">{node.name.replace(/\.(md|canvas|excalidraw)$/i, '')}</span>
                  {onToggleBookmark && (
                    <span
                      className="sidebar-bookmark-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleBookmark(node.path);
                      }}
                      title="Remove bookmark"
                    >
                      x
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isFilteringFiles && !recentHidden && recentFileNodes.length > 0 && (
          <div className="sidebar-recent-files">
            <div className="sidebar-section-label sidebar-recent-label">
              <button
                type="button"
                className="sidebar-section-title-button"
                onClick={toggleRecentHidden}
                title={recentHidden ? '显示最近文件' : '隐藏最近文件'}
              >
                Recent
              </button>
              <span className="sidebar-section-count">{recentFileNodes.length}</span>
              <button
                type="button"
                className="sidebar-section-toggle"
                onClick={toggleRecentHidden}
              >
                {recentHidden ? '显示' : '隐藏'}
              </button>
              {!recentHidden && recentFileNodes.length > 3 && (
                <button
                  type="button"
                  className="sidebar-section-toggle"
                  onClick={() => setRecentExpanded((value) => !value)}
                >
                  {recentExpanded ? '收起' : '展开'}
                </button>
              )}
            </div>
            {!recentHidden && (
              <div className={'sidebar-recent-list' + (recentExpanded ? ' expanded' : '')}>
                {visibleRecentFileNodes.map((node) => {
                  const isActive = normalizeFilePath(currentFile) === normalizeFilePath(node.path);
                  return (
                    <button
                      key={node.path}
                      className={'sidebar-recent-item' + (isActive ? ' active' : '')}
                      onClick={() => onOpenFile(node.path)}
                      type="button"
                      title={node.path}
                    >
                      <span className="sidebar-recent-icon"><FileIcon size={13} /></span>
                      <span className="sidebar-recent-body">
                        <span className="sidebar-recent-name">{node.name.replace(/\.(md|canvas|excalidraw)$/i, '')}</span>
                        <span className="sidebar-recent-folder">{getParentFolderLabel(node.path)}</span>
                      </span>
                      {isActive && <span className="sidebar-recent-badge">Now</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="sidebar-tree">
          {filteredFileTree.length === 0 ? (
            <div className="sidebar-placeholder">
              {isFilteringFiles ? `没有匹配“${trimmedSearchQuery}”的文件` : t.emptyVault}
            </div>
          ) : (
            <FileTree
              nodes={filteredFileTree}
              currentFile={currentFile}
              onOpenFile={onOpenFile}
              onDelete={onDelete}
              onSetContextTarget={onSetContextTarget}
              onNewFile={onNewFile}
              onNewFolder={onNewFolder}
              onRefresh={onRefresh}
              onMoveItem={onMoveItem}
              bookmarkedFiles={bookmarkedFiles}
              onToggleBookmark={onToggleBookmark}
              expandedFolders={visibleExpandedFolders}
              onToggleFolder={toggleFolder}
              onExpandFolder={expandFolder}
              revealRequest={revealRequest}
              filterQuery={trimmedSearchQuery}
              depth={0}
            />
          )}
        </div>

        {/* Bottom status */}
        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <span className={"sidebar-status-dot" + (isConnected ? " connected" : "")} />
            <span className="sidebar-status-text">{isConnected ? 'Connected' : 'No Vault'}</span>
          </div>
          <span className="sidebar-version">{appVersion}</span>
        </div>
      </div>
    </div>
  );
};

export default React.memo(Sidebar);
