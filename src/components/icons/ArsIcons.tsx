import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}

const defaults: Required<Pick<IconProps, 'size'>> = { size: 18 };

function svg(sz: number, cls: string | undefined, sty: React.CSSProperties | undefined, onClick: (() => void) | undefined, paths: React.ReactNode) {
  return (
    <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      className={cls} style={sty} onClick={onClick}>
      {paths}
    </svg>
  );
}

/* ═══ Basic ═══ */

export const FileIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>);

export const FolderIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></>);

export const FolderOpenIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M5 19a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l2 3h9a2 2 0 0 1 2 2v1"/><path d="M4 10h16l-2.5 9H6.5z"/></>);

export const SearchIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></>);

export const SettingsIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>);

export const PlusIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>);

export const ChevronRightIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <polyline points="9 18 15 12 9 6"/>);

export const ChevronDownIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <polyline points="6 9 12 15 18 9"/>);

export const CloseIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>);

export const MenuIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>);

export const RefreshIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/></>);

export const LocateIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/></>);

export const CollapseIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/></>);

/* ═══ Functional ═══ */

export const GamepadIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><line x1="6" y1="10" x2="6" y2="14"/><line x1="4" y1="12" x2="8" y2="12"/></>);

export const GraphIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><circle cx="12" cy="12" r="2"/><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><line x1="12" y1="12" x2="5" y2="6"/><line x1="12" y1="12" x2="19" y2="6"/><line x1="12" y1="12" x2="5" y2="18"/><line x1="12" y1="12" x2="19" y2="18"/></>);

export const BotIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M12 3v4"/><circle cx="9" cy="13" r="1" fill="currentColor"/><circle cx="15" cy="13" r="1" fill="currentColor"/><path d="M9 17h6"/></>);

export const BackupIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>);

export const SyncIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></>);

export const TemplateIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/></>);

export const LinkIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>);

export const TagIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></>);

export const MarkdownIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15V9l2.5 3L12 9v6"/><path d="M17 15V9l-2 1.5"/></>);

export const ExportIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>);

export const CopyIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>);

export const DownloadIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>);

export const UploadIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>);

export const ShieldIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>);

export const WarningIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>);

export const CheckIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <polyline points="20 6 9 17 4 12"/>);

export const InfoIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></>);

/* ═══ Game Workspace ═══ */

export const GddIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8"/><path d="M8 11h6"/></>);

export const CharacterIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>);

export const ItemIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></>);

export const QuestIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></>);

export const UnityTaskIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/><line x1="14" y1="4" x2="10" y2="20"/></>);

export const DevlogIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>);

export const BoardIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="12" rx="1"/></>);

export const ListIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></>);

export const ReportIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></>);

/* ═══ AI ═══ */

export const AIIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><circle cx="9" cy="7" r="0.5" fill="currentColor"/><circle cx="15" cy="7" r="0.5" fill="currentColor"/></>);

export const SparkIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></>);

export const SendIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>);

export const ContextIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><line x1="2" y1="12" x2="22" y2="12"/></>);

/* ═══ Graph ═══ */

export const NodeIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="8" strokeDasharray="4 4"/></>);

export const MissingNodeIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><circle cx="12" cy="12" r="10" strokeDasharray="4 4"/><line x1="8" y1="8" x2="16" y2="16"/><line x1="16" y1="8" x2="8" y2="16"/></>);

export const LocalGraphIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><line x1="12" y1="12" x2="5" y2="5"/><line x1="12" y1="12" x2="19" y2="5"/><line x1="12" y1="12" x2="5" y2="19"/></>);

export const GlobalGraphIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z"/></>);

/* ═══ Misc ═══ */

export const SunIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></>);

export const MoonIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>);

export const MaximizeIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></>);

export const MinimizeIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></>);

/* ═══ Five Pillars ═══ */

export const BrainIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></>);

export const GlobeIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></>);

export const ClockIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>);

/* ═══ Ars-note Logo ═══ */
export const ArsLogoIcon = ({ size = defaults.size, className, style, onClick }: IconProps) =>
  svg(size, className, style, onClick, <><path d="M6 3h12l-3 18H9z" strokeWidth={2.2}/><path d="M9 9h6" strokeWidth={2}/><path d="M10 14h4" strokeWidth={2}/></>);
