import React from 'react';
import {
  FileIcon, FolderIcon, FolderOpenIcon, SearchIcon, SettingsIcon,
  GamepadIcon, GraphIcon, BotIcon, BackupIcon, SyncIcon, TemplateIcon,
  LinkIcon, TagIcon, MarkdownIcon, GddIcon, CharacterIcon, ItemIcon,
  QuestIcon, UnityTaskIcon, DevlogIcon, BoardIcon, ListIcon, ReportIcon,
  AIIcon, SparkIcon, SendIcon, NodeIcon, MissingNodeIcon,
} from './ArsIcons';

type IconComponent = React.FC<{ size?: number; className?: string; style?: React.CSSProperties }>;

/** Get icon for a file based on name/extension */
export function getFileIcon(fileName: string, isDir?: boolean, isOpen?: boolean): IconComponent {
  if (isDir) return isOpen ? FolderOpenIcon : FolderIcon;
  if (fileName.endsWith('.md')) return MarkdownIcon;
  return FileIcon;
}

/** Get icon for a game doc type */
export function getGameDocIcon(docType: string): IconComponent {
  switch (docType) {
    case 'gdd': return GddIcon;
    case 'character': return CharacterIcon;
    case 'item': return ItemIcon;
    case 'quest': return QuestIcon;
    case 'unityTask': return UnityTaskIcon;
    case 'devlog': return DevlogIcon;
    default: return FileIcon;
  }
}

/** Get icon for right-panel primary tab */
export function getCategoryIcon(category: string): IconComponent {
  switch (category) {
    case 'workspace': return GamepadIcon;
    case 'knowledge': return GraphIcon;
    case 'ai': return BotIcon;
    case 'system': return SettingsIcon;
    default: return FileIcon;
  }
}

/** Get icon for right-panel sub-tab */
export function getRightPanelTabIcon(tab: string): IconComponent {
  switch (tab) {
    case 'game': return GamepadIcon;
    case 'preview': return MarkdownIcon;
    case 'templates': return TemplateIcon;
    case 'backlinks': return LinkIcon;
    case 'graph': return GraphIcon;
    case 'search': return SearchIcon;
    case 'ai': return AIIcon;
    case 'backup': return BackupIcon;
    case 'settings': return SettingsIcon;
    case 'outline': return ListIcon;
    default: return FileIcon;
  }
}

/** Get icon for sidebar tool */
export function getSidebarToolIcon(tool: string): IconComponent {
  switch (tool) {
    case 'game': return GamepadIcon;
    case 'graph': return GraphIcon;
    case 'ai': return BotIcon;
    case 'backup': return BackupIcon;
    case 'search': return SearchIcon;
    case 'settings': return SettingsIcon;
    default: return FileIcon;
  }
}

/** Get graph node icon by type */
export function getGraphNodeIcon(nodeType: string): IconComponent {
  switch (nodeType) {
    case 'note': return NodeIcon;
    case 'tag': return TagIcon;
    case 'missing': return MissingNodeIcon;
    case 'gameDoc': return FileIcon;    default: return FileIcon;
  }
}
