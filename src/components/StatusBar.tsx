import React from 'react';
import { useI18n } from '../i18n';
import { MaximizeIcon, MinimizeIcon } from './icons/ArsIcons';
import { APP_VERSION_LABEL } from '../appVersion';

interface StatusBarProps {
  filePath: string;
  fileName: string;
  isDirty: boolean;
  saving: boolean;
  saveStatus: string;
  hasVault: boolean;
  content?: string;
  appVersion?: string;
  focusMode?: boolean;
  onToggleFocus?: () => void;
  onOpenShortcuts?: () => void;
  vaultName?: string;
}

const StatusBar: React.FC<StatusBarProps> = ({ filePath, fileName, isDirty, saving, saveStatus, hasVault, content, appVersion, focusMode, onToggleFocus, onOpenShortcuts, vaultName }) => {
  const { t } = useI18n();

  const statusDotClass = saving
    ? 'saving'
    : saveStatus === t.saveError
      ? 'error'
      : isDirty
        ? 'unsaved'
        : '';

  const hasContent = typeof content === 'string';
  const lines = hasContent ? content.split('\n').length : 0;
  const chars = hasContent ? content.length : 0;
  const words = hasContent ? content.trim().split(/\s+/).filter(Boolean).length : 0;

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        {vaultName && <span className="statusbar-vault">{vaultName}</span>}
        {filePath ? (
          <span className="statusbar-path">{filePath}</span>
        ) : (
          <span>{hasVault ? '' : t.localOnly}</span>
        )}
      </div>
      <div className="statusbar-center">
        <span className={'status-dot ' + statusDotClass} />
        <span>{hasVault ? saveStatus : t.noVault}</span>
      </div>
      <div className="statusbar-right">
        {hasContent && (
          <span className="statusbar-stats" title="Document statistics">
            <span>Ln {lines}</span>
            <span>Words {words}</span>
            <span>Chars {chars}</span>
          </span>
        )}
        <span className="statusbar-version">{t.appName + ' ' + (appVersion || APP_VERSION_LABEL)}</span>
        {onOpenShortcuts && (
          <button className="statusbar-action" type="button" onClick={onOpenShortcuts} title="Keyboard shortcuts (Ctrl+/)" aria-label="Open keyboard shortcuts">
            Keys
          </button>
        )}
        {onToggleFocus && (
          <button className={'statusbar-action' + (focusMode ? ' active' : '')} type="button" onClick={onToggleFocus} title={focusMode ? 'Exit Focus Mode (Ctrl+Shift+F)' : 'Focus Mode (Ctrl+Shift+F)'}>
            {focusMode ? <MinimizeIcon size={12} /> : <MaximizeIcon size={12} />}
          </button>
        )}
      </div>
    </div>
  );
};

export default StatusBar;
