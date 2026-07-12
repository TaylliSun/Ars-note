import React, { useEffect, useRef, useState } from 'react';
import type { FileNode } from '../types';
import { FolderIcon, FolderOpenIcon, MarkdownIcon, FileIcon as GenericFileIcon, ChevronRightIcon, ChevronDownIcon } from './icons/ArsIcons';
import { useI18n } from '../i18n';

interface FileTreeProps {
  nodes: FileNode[];
  currentFile: string;
  onOpenFile: (path: string) => void;
  onDelete: (path: string) => void;
  onSetContextTarget: (path: string) => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRefresh: () => void;
  onMoveItem?: (srcPath: string, destDir: string) => void;
  bookmarkedFiles?: string[];
  onToggleBookmark?: (path: string) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onExpandFolder: (path: string) => void;
  revealRequest: number;
  filterQuery?: string;
  depth: number;
}

const normalizeFilePath = (path: string) => path.replace(/\\/g, '/').toLowerCase();

const FileTree: React.FC<FileTreeProps> = ({
  nodes,
  currentFile,
  onOpenFile,
  onDelete,
  onSetContextTarget,
  onNewFile,
  onNewFolder,
  onRefresh,
  onMoveItem,
  bookmarkedFiles = [],
  onToggleBookmark,
  expandedFolders,
  onToggleFolder,
  onExpandFolder,
  revealRequest,
  filterQuery = '',
  depth,
}) => {
  const { t } = useI18n();
  const [contextInfo, setContextInfo] = useState<{
    path: string;
    isDir: boolean;
    name: string;
    x: number;
    y: number;
  } | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const activeItemRef = useRef<HTMLDivElement>(null);
  const bookmarkedSet = new Set(bookmarkedFiles.map(normalizeFilePath));

  useEffect(() => {
    if (revealRequest > 0) activeItemRef.current?.scrollIntoView({ block: 'center' });
  }, [revealRequest]);

  const handleClick = (node: FileNode) => {
    if (node.isDir) {
      onToggleFolder(node.path);
    } else {
      onOpenFile(node.path);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, node: FileNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextInfo({
      path: node.path,
      isDir: node.isDir,
      name: node.name,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const closeContext = () => {
    setContextInfo(null);
  };

  const isBookmarked = (path: string) => bookmarkedSet.has(normalizeFilePath(path));

  /* ── Rename logic ── */
  const startRename = (path: string, name: string) => {
    setRenaming(path);
    setRenameValue(name);
    closeContext();
  };

  const commitRename = async () => {
    if (!renaming || !renameValue.trim()) {
      setRenaming(null);
      return;
    }
    const api = (window as any).arsnote;
    if (api?.renameItem) {
      try {
        await api.renameItem(renaming, renameValue.trim());
        setRenaming(null);
        onRefresh();
      } catch {
        setRenaming(null);
      }
    } else {
      setRenaming(null);
    }
  };

  const getIconClass = (node: FileNode): string => {
    if (node.isDir) return 'icon-folder';
    if (node.name.endsWith('.md')) return 'icon-md';
    if (node.name.endsWith('.excalidraw')) return 'icon-excalidraw';
    if (node.name.endsWith('.canvas')) return 'icon-canvas';
    if (node.name.endsWith('.png') || node.name.endsWith('.jpg') || node.name.endsWith('.jpeg') || node.name.endsWith('.gif') || node.name.endsWith('.svg')) return 'icon-img';
    return 'icon-file';
  };

  const getIconJSX = (node: FileNode) => {
    if (node.isDir) return expandedFolders.has(node.path) ? <FolderOpenIcon size={14} /> : <FolderIcon size={14} />;
    if (node.name.endsWith('.md')) return <MarkdownIcon size={14} />;
    if (node.name.endsWith('.excalidraw')) return <span style={{ fontSize: 14, lineHeight: 1 }} title="Excalidraw Wireframe">✏</span>;
    if (node.name.endsWith('.canvas')) return <span style={{ fontSize: 14, lineHeight: 1 }} title="Canvas">⬡</span>;
    return <GenericFileIcon size={14} />;
  };

  const renderTreeName = (name: string) => {
    const term = filterQuery.trim().toLowerCase().split(/\s+/).find((part) => name.toLowerCase().includes(part));
    if (!term) return name;
    const index = name.toLowerCase().indexOf(term);
    return (
      <>
        {name.slice(0, index)}
        <mark className="tree-filter-match">{name.slice(index, index + term.length)}</mark>
        {name.slice(index + term.length)}
      </>
    );
  };

  /* ── Drag & Drop handlers ── */
  const handleDragStart = (e: React.DragEvent, node: FileNode) => {
    e.dataTransfer.setData('text/plain', node.path);
    e.dataTransfer.effectAllowed = 'move';
    (e.currentTarget as HTMLElement).classList.add('tree-item-dragging');
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove('tree-item-dragging');
    setDragOverPath(null);
  };

  const handleDragOver = (e: React.DragEvent, node: FileNode) => {
    if (!node.isDir) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverPath(node.path);
  };

  const handleDragEnter = (e: React.DragEvent, node: FileNode) => {
    if (!node.isDir) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(node.path);
  };

  const handleDragLeave = (e: React.DragEvent, node: FileNode) => {
    e.stopPropagation();
    if (dragOverPath === node.path) {
      setDragOverPath(null);
    }
  };

  const handleDrop = (e: React.DragEvent, destNode: FileNode) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(null);
    if (!destNode.isDir || !onMoveItem) return;
    const srcPath = e.dataTransfer.getData('text/plain');
    if (!srcPath) return;
    if (srcPath === destNode.path) return;
    const srcDir = srcPath.substring(0, srcPath.lastIndexOf('/'));
    if (srcDir === destNode.path) return;
    if (destNode.path.startsWith(srcPath + '/')) return;
    onMoveItem(srcPath, destNode.path);
    onExpandFolder(destNode.path);
  };

  return (
    <div className="tree-children">
      {nodes.map((node) => {
        const isActive = !node.isDir && normalizeFilePath(currentFile) === normalizeFilePath(node.path);
        return (
        <div key={node.path}>
          <div
            ref={isActive ? activeItemRef : undefined}
            className={`tree-item${isActive ? ' active' : ''}${dragOverPath === node.path ? ' tree-item-drop-target' : ''}`}
            onClick={() => handleClick(node)}
            onContextMenu={(e) => handleContextMenu(e, node)}
            draggable={true}
            onDragStart={(e) => handleDragStart(e, node)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, node)}
            onDragEnter={(e) => handleDragEnter(e, node)}
            onDragLeave={(e) => handleDragLeave(e, node)}
            onDrop={(e) => handleDrop(e, node)}
          >
            {Array.from({ length: depth }).map((_, i) => (
              <span key={i} className="tree-indent" />
            ))}
            {node.isDir && (
              <span className="tree-expand" onClick={(e) => { e.stopPropagation(); onToggleFolder(node.path); }}>
                {expandedFolders.has(node.path) ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
              </span>
            )}
            {!node.isDir && <span className="tree-indent" />}
            <span className={`tree-icon ${getIconClass(node)}`}>{getIconJSX(node)}</span>
            {renaming === node.path ? (
              <input
                className="tree-rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setRenaming(null);
                }}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="tree-name" title={node.path}>{renderTreeName(node.name)}</span>
            )}
            {!node.isDir && onToggleBookmark && (
              <button
                className={'tree-bookmark-btn' + (isBookmarked(node.path) ? ' active' : '')}
                title={isBookmarked(node.path) ? 'Remove bookmark' : 'Add bookmark'}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleBookmark(node.path);
                }}
                type="button"
              >
                {isBookmarked(node.path) ? 'Pinned' : 'Pin'}
              </button>
            )}
          </div>

          {node.isDir && expandedFolders.has(node.path) && (
            node.children.length > 0 ? (
              <FileTree
                nodes={node.children}
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
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                onExpandFolder={onExpandFolder}
                revealRequest={revealRequest}
                filterQuery={filterQuery}
                depth={depth + 1}
              />
            ) : (
              <div className="tree-empty">
                <span style={{ opacity: 0.4, fontSize: 11 }}>空文件夹</span>
              </div>
            )
          )}
        </div>
        );
      })}

      {/* Context menu */}
      {contextInfo && (
        <>
          <div className="context-menu-overlay" onClick={closeContext} />
          <div
            className="context-menu"
            style={{
              left: Math.min(contextInfo.x, window.innerWidth - 180),
              top: Math.min(contextInfo.y, window.innerHeight - 240),
            }}
          >
            {contextInfo.isDir && (
              <>
                <div className="context-menu-item" onClick={() => { onSetContextTarget(contextInfo.path); onNewFile(); closeContext(); }}>
                  <span className="ctx-icon">📄</span> {t.newFile}
                </div>
                <div className="context-menu-item" onClick={() => { onSetContextTarget(contextInfo.path); onNewFolder(); closeContext(); }}>
                  <span className="ctx-icon">📁</span> {t.newFolder}
                </div>
                <div className="context-menu-separator" />
              </>
            )}
            {!contextInfo.isDir && onToggleBookmark && (
              <div className="context-menu-item" onClick={() => { onToggleBookmark(contextInfo.path); closeContext(); }}>
                <span className="ctx-icon">{isBookmarked(contextInfo.path) ? 'Unpin' : 'Pin'}</span> {isBookmarked(contextInfo.path) ? 'Remove bookmark' : 'Add bookmark'}
              </div>
            )}
            <div className="context-menu-item" onClick={() => startRename(contextInfo.path, contextInfo.name)}>
              <span className="ctx-icon">✏️</span> {t.rename || 'Rename'}
            </div>
            <div className="context-menu-item" onClick={() => {
              navigator.clipboard.writeText(contextInfo.path).catch(() => {});
              closeContext();
            }}>
              <span className="ctx-icon">📋</span> {t.copyPath || 'Copy Path'}
            </div>
            <div className="context-menu-separator" />
            <div
              className="context-menu-item danger"
              onClick={() => { onDelete(contextInfo.path); closeContext(); }}
            >
              <span className="ctx-icon">🗑️</span> {t.delete}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default FileTree;
