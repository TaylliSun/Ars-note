import React from 'react';
import { useI18n } from '../i18n';

interface TitleBarProps {
  vaultName: string;
  saveStatus: string;
  isDirty: boolean;
  onSave: () => void;
  welcome?: boolean;
}

const TitleBar: React.FC<TitleBarProps> = ({ vaultName, saveStatus, isDirty, onSave, welcome = false }) => {
  const { t, language, setLanguage } = useI18n();
  const [isMaximized, setIsMaximized] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    window.arsnote.windowIsMaximized()
      .then((result) => {
        if (!cancelled) setIsMaximized(!!result?.maximized);
      })
      .catch(() => {
        if (!cancelled) setIsMaximized(false);
      });

    const unsubscribe = window.arsnote.onWindowMaximizedChanged((data) => {
      setIsMaximized(!!data?.maximized);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const toggleLang = () => {
    setLanguage(language === 'zh-CN' ? 'en' : 'zh-CN');
  };

  const statusDotClass = isDirty
    ? 'unsaved'
    : saveStatus === t.saving
      ? 'saving'
      : saveStatus === t.saveError
        ? 'error'
        : '';

  return (
    <div className={`titlebar${welcome ? ' titlebar-welcome' : ''}`}>
      <div className="titlebar-left">
        <div className="titlebar-brand-copy">
          <span className="titlebar-logo">{t.appName}</span>
          <span className="titlebar-subtitle">Local Markdown Studio</span>
        </div>
      </div>

      <div className="titlebar-center">
        {!welcome && (
          <>
            <span className="titlebar-vault-label">Vault</span>
            <span className="titlebar-vault">{vaultName}</span>
          </>
        )}
      </div>

      <div className="titlebar-right">
        {!welcome && (
          <div className={`titlebar-status ${statusDotClass || 'saved'}`}>
            <span className={`titlebar-status-dot ${statusDotClass}`} />
            <span>{saveStatus}</span>
          </div>
        )}

        {!welcome && isDirty && (
          <button className="titlebar-save-btn" onClick={onSave}>
            {t.save}
          </button>
        )}

        <button
          className="lang-toggle"
          onClick={toggleLang}
          title={language === 'zh-CN' ? 'Switch to English' : '切换到中文'}
        >
          {t.langSwitchLabel}
        </button>

        <div className="window-controls" aria-label="Window controls">
          <button
            className="window-control-btn window-control-minimize"
            onClick={() => { void window.arsnote.windowMinimize(); }}
            aria-label="Minimize"
            title="Minimize"
          >
            <span className="window-control-icon window-control-icon-minimize" aria-hidden="true" />
          </button>
          <button
            className="window-control-btn window-control-maximize"
            onClick={() => { void window.arsnote.windowMaximize(); }}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            <span
              className={`window-control-icon ${isMaximized ? 'window-control-icon-restore' : 'window-control-icon-maximize'}`}
              aria-hidden="true"
            />
          </button>
          <button
            className="window-control-btn window-control-close"
            onClick={() => { void window.arsnote.windowClose(); }}
            aria-label="Close"
            title="Close"
          >
            <span className="window-control-icon window-control-icon-close" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default TitleBar;
