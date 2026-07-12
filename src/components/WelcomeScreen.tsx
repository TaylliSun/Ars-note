import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { APP_VERSION_LABEL } from '../appVersion';
import { ChevronRightIcon, FolderIcon, FolderOpenIcon, PlusIcon } from './icons/ArsIcons';
import AnimatedArsLogo from './AnimatedArsLogo';

interface WelcomeScreenProps {
  onCreateVault: () => void;
  onOpenVault: () => void;
  onOpenRecent: (path: string) => void;
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onCreateVault,
  onOpenVault,
  onOpenRecent,
}) => {
  const { t } = useI18n();
  const [recentVaults, setRecentVaults] = useState<string[]>([]);
  const [notFoundPath, setNotFoundPath] = useState<string | null>(null);
  const [logoAnimated, setLogoAnimated] = useState(false);

  useEffect(() => {
    window.arsnote.getRecentVaults().then(setRecentVaults);
  }, []);

  useEffect(() => {
    let secondFrame = 0;
    let timer = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        timer = window.setTimeout(() => setLogoAnimated(true), 180);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const handleOpenRecent = async (vaultPath: string) => {
    try {
      const result = await window.arsnote.openVault(vaultPath);
      if (!result) {
        setNotFoundPath(vaultPath);
        return;
      }
      onOpenRecent(vaultPath);
    } catch {
      setNotFoundPath(vaultPath);
    }
  };

  const handleRemoveRecent = async () => {
    if (!notFoundPath) return;
    const updated = recentVaults.filter((v) => v !== notFoundPath);
    setRecentVaults(updated);
    setNotFoundPath(null);
  };

  const handleDismissNotFound = () => {
    setNotFoundPath(null);
  };

  return (
    <div className="welcome-screen">
      <div className="welcome-shell">
        <aside className="welcome-start-panel">
          <div className="welcome-brand">
            <div className="welcome-app-mark" aria-hidden="true">
              <AnimatedArsLogo animate={logoAnimated} />
            </div>
            <div className="welcome-brand-copy">
              <div className="welcome-logo">{t.welcomeTitle}</div>
              <div className="welcome-subtitle">{t.welcomeSubtitle}</div>
            </div>
          </div>

          <div className="welcome-actions">
            <button type="button" className="welcome-card welcome-card-open" onClick={onOpenVault}>
              <span className="welcome-card-icon"><FolderOpenIcon size={18} /></span>
              <span className="welcome-card-copy">
                <span className="welcome-card-title">{t.openVault}</span>
                <span className="welcome-card-desc">{t.openVaultDesc}</span>
              </span>
            </button>
            <button type="button" className="welcome-card welcome-card-create" onClick={onCreateVault}>
              <span className="welcome-card-icon"><PlusIcon size={18} /></span>
              <span className="welcome-card-copy">
                <span className="welcome-card-title">{t.createVault}</span>
                <span className="welcome-card-desc">{t.createVaultDesc}</span>
              </span>
            </button>
          </div>

          <div className="welcome-version">{t.appName} {APP_VERSION_LABEL}</div>
        </aside>

        <main className="welcome-recent">
          <div className="welcome-recent-header">
            <span className="welcome-recent-title">{t.recentVaults}</span>
            <span className="welcome-recent-count">{recentVaults.length}</span>
          </div>
          <div className="welcome-recent-list">
            {recentVaults.length > 0 ? (
              recentVaults.map((v) => {
                const name = v.split(/[\\/]/).pop() || v;
                return (
                  <button type="button" key={v} className="recent-item" onClick={() => handleOpenRecent(v)}>
                    <span className="recent-item-icon"><FolderIcon size={16} /></span>
                    <span className="recent-item-copy">
                      <span className="recent-item-name">{name}</span>
                      <span className="recent-item-path">{v}</span>
                    </span>
                    <span className="recent-item-arrow" aria-hidden="true"><ChevronRightIcon size={16} /></span>
                  </button>
                );
              })
            ) : (
              <div className="welcome-recent-empty">
                {t.noRecentVaultsHint}
              </div>
            )}
          </div>
        </main>
      </div>

      {notFoundPath && (
        <div className="dialog-overlay">
          <div className="dialog">
            <div className="dialog-title">{t.vaultNotFoundTitle}</div>
            <div className="dialog-message">
              {t.vaultNotFoundRemove}
              <br />
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{notFoundPath}</span>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={handleDismissNotFound}>
                {t.cancel}
              </button>
              <button className="btn btn-danger" onClick={handleRemoveRecent}>
                {t.remove}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WelcomeScreen;
