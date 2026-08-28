import type { CloudProviderInfo } from '../types';
import type { RightPanelProps } from './RightPanel';
import { useI18n } from '../i18n';
import { getCloudProviders, mapSyncProviderToCloudId } from '../utils/cloudBackupProvider';
import { formatBytes } from '../utils/vaultManifest';
import './RightPanelBackupView.css';

type RightPanelBackupViewProps = Pick<RightPanelProps,
  | 'backupBusy'
  | 'backupFileList'
  | 'backupFileLoading'
  | 'backupFileRestoreSummary'
  | 'backupLifecycleMessage'
  | 'backupList'
  | 'backupPruneBusy'
  | 'backupPruneSummary'
  | 'backupRetentionLimit'
  | 'backupVerifyResult'
  | 'cloudBusy'
  | 'cloudDownloadSummary'
  | 'cloudUploadSummary'
  | 'deletingBackupId'
  | 'deletingRemoteBackupId'
  | 'downloadedBackups'
  | 'downloadedBusy'
  | 'downloadedRestoreSummary'
  | 'downloadedVerifyResult'
  | 'lastManifest'
  | 'onBackupRetentionLimitChange'
  | 'onCompareLocalRemote'
  | 'onCompareWithRemote'
  | 'onDeleteBackup'
  | 'onDeleteRemoteBackup'
  | 'onDownloadRemoteBackup'
  | 'onExportBackup'
  | 'onGenerateManifest'
  | 'onListBackupFiles'
  | 'onListDownloadedBackups'
  | 'onListRemoteBackups'
  | 'onManualPull'
  | 'onManualPush'
  | 'onPreviewRemoteDiff'
  | 'onPruneBackups'
  | 'onRestoreBackup'
  | 'onRestoreBackupFile'
  | 'onRestoreDownloadedBackup'
  | 'onTabChange'
  | 'onUploadBackupToRemote'
  | 'onVerifyBackup'
  | 'onVerifyDownloadedBackup'
  | 'providerValidation'
  | 'remoteBackups'
  | 'restoreSummary'
  | 'restoringBackupFileKey'
  | 'showConfirm'
  | 'syncBusy'
  | 'syncCompareResult'
  | 'syncConfig'
  | 'syncPreview'
  | 'syncPreviewBusy'
  | 'verifyingBackupId'
> & {
  onStartWizard: () => void;
};

const RightPanelBackupView: React.FC<RightPanelBackupViewProps> = ({
  backupBusy,
  backupFileList,
  backupFileLoading,
  backupFileRestoreSummary,
  backupLifecycleMessage,
  backupList,
  backupPruneBusy,
  backupPruneSummary,
  backupRetentionLimit,
  backupVerifyResult,
  cloudBusy,
  cloudDownloadSummary,
  cloudUploadSummary,
  deletingBackupId,
  deletingRemoteBackupId,
  downloadedBackups,
  downloadedBusy,
  downloadedRestoreSummary,
  downloadedVerifyResult,
  lastManifest,
  onBackupRetentionLimitChange,
  onCompareLocalRemote,
  onCompareWithRemote,
  onDeleteBackup,
  onDeleteRemoteBackup,
  onDownloadRemoteBackup,
  onExportBackup,
  onGenerateManifest,
  onListBackupFiles,
  onListDownloadedBackups,
  onListRemoteBackups,
  onManualPull,
  onManualPush,
  onPreviewRemoteDiff,
  onPruneBackups,
  onRestoreBackup,
  onRestoreBackupFile,
  onRestoreDownloadedBackup,
  onStartWizard,
  onTabChange,
  onUploadBackupToRemote,
  onVerifyBackup,
  onVerifyDownloadedBackup,
  providerValidation,
  remoteBackups,
  restoreSummary,
  restoringBackupFileKey,
  showConfirm,
  syncBusy,
  syncCompareResult,
  syncConfig,
  syncPreview,
  syncPreviewBusy,
  verifyingBackupId,
}) => {
  const { t } = useI18n();

  return (
    <div className="backup-panel">
      {/* Safety Notice */}
      <div className="backup-safety-notice">
        {t.backupSafetyNotice}
      </div>

      {/* Actions */}
      <div className="backup-actions">
        <button type="button" className="backup-action-btn" onClick={onGenerateManifest} disabled={backupBusy}>
          {t.generateManifest}
        </button>
        <button type="button" className="backup-action-btn backup-action-primary" onClick={onExportBackup} disabled={backupBusy}>
          {backupBusy ? t.creatingGameDoc || '...' : t.exportBackup}
        </button>
      </div>

      <div className="bl-section sync-section-card backup-retention-card">
        <div className="bl-section-header section-card-header">备份保留</div>
        <div className="backup-retention-row">
          <label className="backup-retention-label" htmlFor="backup-retention-limit">保留最近</label>
          <input
            id="backup-retention-limit"
            className="backup-retention-input"
            type="number"
            min={1}
            max={200}
            value={backupRetentionLimit}
            onChange={(event) => onBackupRetentionLimitChange(Number(event.target.value))}
          />
          <span className="backup-retention-label">个本地备份</span>
          <button
            type="button"
            className="backup-action-btn"
            onClick={onPruneBackups}
            disabled={backupBusy || backupPruneBusy}
          >
            {backupPruneBusy ? '清理中...' : '清理旧备份'}
          </button>
        </div>
        <div className="backup-retention-note">
          自动备份会跳过未变化的内容，并在导出后按这个数量清理旧备份。
        </div>
        {backupLifecycleMessage && (
          <div className="backup-retention-message">{backupLifecycleMessage}</div>
        )}
        {backupPruneSummary && (
          <div className="backup-retention-stats">
            最近一次清理：删除 {backupPruneSummary.deletedCount} 个，释放 {formatBytes(backupPruneSummary.deletedSize)}。
          </div>
        )}
      </div>

      {/* Last Manifest */}
      <div className="bl-section sync-section-card">
        <div className="bl-section-header section-card-header">{t.lastManifest}</div>
        {lastManifest ? (
          <div className="backup-info-card">
            <div className="backup-info-row">
              <span className="backup-info-label">{t.fileCount}</span>
              <span className="backup-info-value">{lastManifest.fileCount}</span>
            </div>
            <div className="backup-info-row">
              <span className="backup-info-label">{t.totalSize}</span>
              <span className="backup-info-value">{formatBytes(lastManifest.totalSize)}</span>
            </div>
            <div className="backup-info-row">
              <span className="backup-info-label">{t.manifestPath}</span>
              <span className="backup-info-value backup-info-path">.ars-note/manifest.json</span>
            </div>
            <div className="backup-info-meta">
              {lastManifest.generatedAt.replace('T', ' ').substring(0, 19)}
            </div>
          </div>
        ) : (
          <div className="bl-empty-hint">{t.noManifestYet}</div>
        )}
      </div>

      {/* Backups */}
      <div className="bl-section sync-section-card">
        <div className="bl-section-header section-card-header">{t.backupList}</div>
        {backupList.length > 0 ? (
          <div className="backup-list">
            {backupList.map((bk) => (
              <div key={bk.backupId} className="backup-list-item backup-card">
                <div className="backup-list-item-header">
                  <span className="backup-list-item-id">{bk.backupId}</span>
                  <div className="backup-list-item-actions">
                    <button
                      className="backup-verify-btn"
                      type="button"
                      onClick={() => onListBackupFiles(bk.backupPath)}
                      disabled={backupFileLoading}
                      title="浏览备份文件"
                    >
                      {backupFileLoading && backupFileList?.backupId === bk.backupId ? '...' : '文件'}
                    </button>
                    <button
                      className="backup-verify-btn"
                      type="button"
                      onClick={() => onVerifyBackup(bk.backupPath, bk.backupId)}
                      disabled={backupBusy || verifyingBackupId === bk.backupId}
                      title={t.verifyBackup}
                    >
                      {verifyingBackupId === bk.backupId ? '...' : t.valid}
                    </button>
                    <button
                      className="backup-upload-btn"
                      type="button"
                      onClick={() => onUploadBackupToRemote(bk.backupPath)}
                      disabled={cloudBusy || (providerValidation !== null && !providerValidation.valid)}
                      title={!providerValidation || providerValidation.valid ? t.uploadToRemote : t.uploadDisabled}
                    >
                      {cloudBusy ? '...' : '↑'}
                    </button>
                    <button
                      className="backup-restore-btn"
                      type="button"
                      onClick={() => onRestoreBackup(bk.backupPath)}
                      disabled={backupBusy}
                      title={t.restoreBackup}
                    >
                      {backupBusy ? '...' : t.restore}
                    </button>
                    <button
                      className="backup-delete-btn"
                      type="button"
                      onClick={async () => {
                        const confirmed = await showConfirm(
                          '删除备份',
                          `确定删除本地备份 ${bk.backupId} 吗？此操作不会影响当前 Vault，也不会删除远程备份。`
                        );
                        if (confirmed) await onDeleteBackup(bk.backupPath, bk.backupId);
                      }}
                      disabled={backupBusy || deletingBackupId === bk.backupId}
                      title={t.delete || 'Delete'}
                    >
                      {deletingBackupId === bk.backupId ? '...' : (t.delete || 'Delete')}
                    </button>
                  </div>
                </div>
                <div className="backup-list-item-meta">
                  <span>{bk.generatedAt.replace('T', ' ').substring(0, 19)}</span>
                  <span>{bk.fileCount} {t.fileCount.toLowerCase()}</span>
                  <span>{formatBytes(bk.totalSize)}</span>
                </div>
                <div className="backup-list-item-path">{bk.backupPath}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bl-empty-hint">{t.noBackupsFound}</div>
        )}
      </div>

      {backupFileList && (
        <div className="bl-section sync-section-card backup-file-restore-panel">
          <div className="bl-section-header section-card-header">
            备份文件恢复
            <span className="bl-count">{backupFileList.fileCount}</span>
          </div>
          <div className="backup-file-restore-head">
            <div>
              <div className="backup-file-restore-title">{backupFileList.backupId}</div>
              <div className="backup-file-restore-subtitle">
                {backupFileList.generatedAt ? backupFileList.generatedAt.replace('T', ' ').substring(0, 19) : '-'} · {formatBytes(backupFileList.totalSize)}
              </div>
            </div>
            <button className="backup-action-btn" type="button" onClick={() => onListBackupFiles(backupFileList.backupPath)} disabled={backupFileLoading}>
              {backupFileLoading ? '刷新中...' : '刷新文件'}
            </button>
          </div>
          <div className="backup-file-restore-list">
            {backupFileList.files.slice(0, 80).map((file) => {
              const restoreKey = `${backupFileList.backupPath}:${file.relativePath}`;
              return (
                <div className={'backup-file-restore-row ' + (!file.exists ? 'missing' : '')} key={file.relativePath}>
                  <div className="backup-file-restore-path" title={file.relativePath}>{file.relativePath}</div>
                  <span className="backup-file-type">{file.type}</span>
                  <span className="backup-file-size">{formatBytes(file.size)}</span>
                  <button
                    className="backup-restore-btn"
                    type="button"
                    onClick={() => onRestoreBackupFile(backupFileList.backupPath, file.relativePath)}
                    disabled={!file.exists || restoringBackupFileKey === restoreKey}
                  >
                    {restoringBackupFileKey === restoreKey ? '恢复中...' : '恢复'}
                  </button>
                </div>
              );
            })}
          </div>
          {backupFileList.files.length > 80 && (
            <div className="backup-info-meta">仅显示前 80 个文件；文件很多时建议先用搜索定位，再做单文件恢复。</div>
          )}
          {backupFileRestoreSummary && backupFileRestoreSummary.backupId === backupFileList.backupId && (
            <div className="backup-retention-message">
              已恢复 {backupFileRestoreSummary.relativePath} · {formatBytes(backupFileRestoreSummary.size)}
            </div>
          )}
        </div>
      )}

      {/* Last Verification */}
      <div className="bl-section sync-section-card">
        <div className="bl-section-header section-card-header">{t.verificationResult}</div>
        {backupVerifyResult ? (
          <div className={`backup-verify-card ${backupVerifyResult.valid ? 'backup-verify-valid' : 'backup-verify-invalid'}`}>
            <div className="backup-verify-status">
              <span className={`backup-verify-badge ${backupVerifyResult.valid ? 'badge-valid' : 'badge-invalid'}`}>
                {backupVerifyResult.valid ? t.backupValid : t.backupInvalid}
              </span>
              <span className="backup-verify-id">{backupVerifyResult.backupId}</span>
            </div>
            <div className="backup-info-row">
              <span className="backup-info-label">{t.checkedFiles}</span>
              <span className="backup-info-value">{backupVerifyResult.checkedFileCount} / {backupVerifyResult.fileCount}</span>
            </div>
            {backupVerifyResult.missingFiles.length > 0 && (
              <div className="backup-verify-errors">
                <div className="backup-verify-error-label">{t.missingFiles} ({backupVerifyResult.missingFiles.length})</div>
                {backupVerifyResult.missingFiles.map((f) => (
                  <div key={f} className="backup-verify-error-file">{f}</div>
                ))}
              </div>
            )}
            {backupVerifyResult.hashMismatchFiles.length > 0 && (
              <div className="backup-verify-errors">
                <div className="backup-verify-error-label">{t.hashMismatchFiles} ({backupVerifyResult.hashMismatchFiles.length})</div>
                {backupVerifyResult.hashMismatchFiles.map((f) => (
                  <div key={f} className="backup-verify-error-file">{f}</div>
                ))}
              </div>
            )}
            {backupVerifyResult.errors.length > 0 && (
              <div className="backup-verify-errors">
                {backupVerifyResult.errors.map((e, i) => (
                  <div key={i} className="backup-verify-error-file">{e}</div>
                ))}
              </div>
            )}
            <div className="backup-info-meta">
              {backupVerifyResult.checkedAt.replace('T', ' ').substring(0, 19)}
            </div>
          </div>
        ) : (
          <div className="bl-empty-hint">{t.noVerificationYet}</div>
        )}
      </div>

      {/* Restore Summary */}
      {restoreSummary && (
        <div className="bl-section sync-section-card">
          <div className="bl-section-header section-card-header">{t.restoreComplete}</div>
          <div className="backup-info-card">
            <div className="backup-info-row">
              <span className="backup-info-label">{t.restoredTo}</span>
              <span className="backup-info-value backup-info-path">{restoreSummary.restoredTo}</span>
            </div>
            <div className="backup-info-row">
              <span className="backup-info-label">{t.restoredAt}</span>
              <span className="backup-info-value">{restoreSummary.restoredAt.replace('T', ' ').substring(0, 19)}</span>
            </div>
            <div className="backup-info-row">
              <span className="backup-info-label">{t.fileCount}</span>
              <span className="backup-info-value">{restoreSummary.fileCount}</span>
            </div>
            <div className="backup-info-row">
              <span className="backup-info-label">{t.totalSize}</span>
              <span className="backup-info-value">{formatBytes(restoreSummary.totalSize)}</span>
            </div>
          </div>
        </div>
      )}

      {/* File breakdown */}
      {lastManifest && lastManifest.files.length > 0 && (
        <div className="bl-section sync-section-card">
          <div className="bl-section-header section-card-header">{t.fileBreakdown}</div>
          <div className="backup-file-stats">
            {(() => {
              const types: Record<string, number> = { markdown: 0, asset: 0, config: 0, other: 0 };
              for (const f of lastManifest.files) { if (f.type in types) types[f.type]++; }
              return (
                <>
                  {types.markdown > 0 && <div className="backup-file-stat"><span className="backup-file-stat-type">Markdown</span><span className="backup-file-stat-count">{types.markdown}</span></div>}
                  {types.asset > 0 && <div className="backup-file-stat"><span className="backup-file-stat-type">Assets</span><span className="backup-file-stat-count">{types.asset}</span></div>}
                  {types.config > 0 && <div className="backup-file-stat"><span className="backup-file-stat-type">Config</span><span className="backup-file-stat-count">{types.config}</span></div>}
                  {types.other > 0 && <div className="backup-file-stat"><span className="backup-file-stat-type">Other</span><span className="backup-file-stat-count">{types.other}</span></div>}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Cloud Backup Prototype */}
      <div className="bl-section sync-section-card">
        <div className="bl-section-header section-card-header">{t.cloudBackup} <span className="cloud-mock-badge">{t.localMockRemote}</span></div>

        {/* Provider Status (v0.5.2) */}
        <div className="provider-status-section">
          <div className="provider-status-header">{t.providerStatus}</div>
          {getCloudProviders().map((p: CloudProviderInfo) => {
            const isCurrentProvider = syncConfig && mapSyncProviderToCloudId(syncConfig.provider) === p.id;
            return (
              <div key={p.id} className={`provider-status-row ${isCurrentProvider ? 'provider-status-active' : ''}`}>
                <span className="provider-status-name">{p.label}</span>
                <span className={`provider-status-badge ${p.implemented ? 'provider-badge-available' : 'provider-badge-coming'}`}>
                  {p.implemented ? t.available : t.comingSoon}
                </span>
              </div>
            );
          })}
        </div>

        {/* Provider Validation Errors/Warnings (v0.5.2) */}
        {providerValidation && !providerValidation.valid && (
          <div className="provider-validation-card credential-status-card">
            <div className="provider-validation-title">{t.providerValidation}</div>
            {providerValidation.errors.map((err, i) => (
              <div key={i} className="provider-validation-error">
                {err === 'ProviderNotImplemented' ? t.providerNotImplemented : err}
              </div>
            ))}
            {providerValidation.warnings.map((w, i) => (
              <div key={i} className="provider-validation-warning">
                {w === 'EndpointRequired' ? t.endpointRequired : w === 'BucketRequired' ? t.bucketRequired : w}
              </div>
            ))}
          </div>
        )}

        <div className="cloud-safety-notice">
          {t.cloudSafetyNotice}
        </div>

        {/* Upload: each local backup has an upload button in the backup list above */}

        {/* Coming Soon notice when provider not implemented (v0.5.2) */}
        {providerValidation && !providerValidation.valid && (
          <div className="provider-coming-soon-notice">
            {t.providerComingSoon}
          </div>
        )}

        {/* Remote Backup List */}
        <div className="cloud-remote-header">
          <span>{t.remoteBackups}</span>
          <button type="button" className="cloud-refresh-btn" onClick={onListRemoteBackups} disabled={cloudBusy}>
            {t.refresh || 'Refresh'}
          </button>
        </div>
        {remoteBackups.length > 0 ? (
          <div className="cloud-remote-list">
            {remoteBackups.map((rb) => (
              <div key={rb.remoteId} className="cloud-remote-item remote-backup-card">
                <div className="cloud-remote-item-header">
                  <span className="cloud-remote-item-id">{rb.remoteId}</span>
                  <button
                    type="button"
                    className="cloud-download-btn"
                    onClick={() => onDownloadRemoteBackup(rb.remoteId)}
                    disabled={cloudBusy || deletingRemoteBackupId === rb.remoteId}
                    title={t.downloadRemoteBackup}
                  >
                    {cloudBusy ? '...' : t.downloadRemoteBackup}
                  </button>
                  <button
                    type="button"
                    className="backup-delete-btn"
                    onClick={async () => {
                      const confirmed = await showConfirm(
                        '删除远程备份',
                        `确定删除远程备份 ${rb.backupId || rb.remoteId} 吗？这只会删除同步服务器/NAS 上的备份，不会影响当前 Vault。`
                      );
                      if (confirmed) await onDeleteRemoteBackup(rb.remoteId);
                    }}
                    disabled={cloudBusy || deletingRemoteBackupId === rb.remoteId}
                    title={t.delete || 'Delete'}
                  >
                    {deletingRemoteBackupId === rb.remoteId ? '...' : (t.delete || 'Delete')}
                  </button>
                </div>
                <div className="cloud-remote-item-meta">
                  <span>{rb.uploadedAt.replace('T', ' ').substring(0, 19)}</span>
                  <span>{rb.fileCount} {t.fileCount.toLowerCase()}</span>
                  <span>{formatBytes(rb.totalSize)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bl-empty-hint">{t.noRemoteBackups}</div>
        )}

        {/* Last Upload Summary */}
        {cloudUploadSummary && (
          <div className="cloud-summary-card backup-summary-card">
            <div className="cloud-summary-title">{t.uploadComplete}</div>
            <div className="backup-info-row">
              <span className="backup-info-label">{t.remoteId}</span>
              <span className="backup-info-value">{cloudUploadSummary.remoteId}</span>
            </div>
            <div className="backup-info-row">
              <span className="backup-info-label">{t.fileCount}</span>
              <span className="backup-info-value">{cloudUploadSummary.fileCount}</span>
            </div>
            <div className="backup-info-row">
              <span className="backup-info-label">{t.totalSize}</span>
              <span className="backup-info-value">{formatBytes(cloudUploadSummary.totalSize)}</span>
            </div>
          </div>
        )}

        {/* Last Download Summary */}
        {cloudDownloadSummary && (
          <div className="cloud-summary-card backup-summary-card">
            <div className="cloud-summary-title">{t.downloadComplete}</div>
            <div className="backup-info-row">
              <span className="backup-info-label">{t.remoteId}</span>
              <span className="backup-info-value">{cloudDownloadSummary.remoteId}</span>
            </div>
            <div className="backup-info-row">
              <span className="backup-info-label">{t.downloadedTo}</span>
              <span className="backup-info-value backup-info-path">{cloudDownloadSummary.downloadedTo}</span>
            </div>
            <div className="backup-info-row">
              <span className="backup-info-label">{t.fileCount}</span>
              <span className="backup-info-value">{cloudDownloadSummary.fileCount}</span>
            </div>
          </div>
        )}
      </div>

      {/* Sync Wizard (v0.7.0) */}
      <div className="bl-section sync-section-card">
        <button
          className="sync-wizard-entry-btn"
          onClick={onStartWizard}
        >
          <span className="sync-wizard-entry-icon">{'↻'}</span>
          <span>{t.startSyncWizard}</span>
        </button>
      </div>

      {/* Manual Sync (v0.6.1) */}
      {(providerValidation === null || providerValidation.valid) && (
      <div className="bl-section sync-section-card">
        <div className="bl-section-header section-card-header">{t.manualSync}</div>

        <div className="cloud-safety-notice">
          {t.neverOverwriteCurrentVault}
        </div>

        <div className="sync-actions-row">
          <button
            className="sync-save-btn"
            disabled={syncBusy}
            onClick={() => { if (onCompareLocalRemote) onCompareLocalRemote(); }}
          >
            {syncBusy ? '...' : t.compareLocalRemote}
          </button>
        </div>

        {syncCompareResult && (
          <div className="sync-compare-result">
            <div className="sync-compare-header">
              <span className="sync-compare-label">{t.syncCompareResult}</span>
              <span className="sync-compare-time">{syncCompareResult.comparedAt.replace('T', ' ').substring(0, 19)}</span>
            </div>

            {/* Status badge with color */}
            <div className="sync-status-badge-row">
              <span className={"sync-status-badge sync-status-" + syncCompareResult.status}>{
                syncCompareResult.status === 'localOnly' ? t.localOnly :
                syncCompareResult.status === 'remoteOnly' ? t.remoteOnly :
                syncCompareResult.status === 'same' ? t.same :
                syncCompareResult.status === 'localNewer' ? t.localNewer :
                syncCompareResult.status === 'remoteNewer' ? t.remoteNewer :
                syncCompareResult.status === 'diverged' ? t.diverged :
                '—'
              }</span>
            </div>

            {/* Manifest Hash Display */}
            {syncCompareResult.localSnapshot && (
              <div className="sync-snapshot-info">
                <span className="sync-snapshot-label">Local:</span>
                <span>{syncCompareResult.localSnapshot.fileCount} files, {formatBytes(syncCompareResult.localSnapshot.totalSize)}</span>
                <span className="hash-text"> {t.localHash}: {syncCompareResult.localSnapshot.manifestHash ? syncCompareResult.localSnapshot.manifestHash.substring(0, 12) : '-'}</span>
              </div>
            )}
            {syncCompareResult.remoteSnapshot && (
              <div className="sync-snapshot-info">
                <span className="sync-snapshot-label">Remote:</span>
                <span>{syncCompareResult.remoteSnapshot.fileCount} files, {formatBytes(syncCompareResult.remoteSnapshot.totalSize)}</span>
                <span className="hash-text"> {t.remoteHash}: {syncCompareResult.remoteSnapshot.manifestHash ? syncCompareResult.remoteSnapshot.manifestHash.substring(0, 12) : '-'}</span>
              </div>
            )}
            <div className="sync-snapshot-info">
              <span className="sync-snapshot-label">{t.comparedAt}:</span>
              <span>{syncCompareResult.comparedAt.replace('T', ' ').substring(0, 19)}</span>
            </div>

            {/* Conflict Explanation for diverged */}
            {syncCompareResult.status === 'diverged' && (
              <div className="conflict-warning sync-warning-card">
                <div className="conflict-warning-title">{t.diverged}</div>
                <div className="conflict-warning-text">{t.conflictExplanation}</div>
              </div>
            )}

            {/* Recommended Action Buttons */}
            <div className="sync-recommended">
              <span className="sync-recommended-label">{t.recommendedAction}:</span>
              <span className="sync-recommended-value">{
                syncCompareResult.recommendedAction === 'exportBackup' ? t.exportBackup :
                syncCompareResult.recommendedAction === 'uploadBackup' ? t.manualPush :
                syncCompareResult.recommendedAction === 'downloadRemote' ? t.manualPullLatest :
                syncCompareResult.recommendedAction === 'verifyDownloaded' ? t.goToDownloadedBackups :
                syncCompareResult.recommendedAction === 'manualReview' ? t.manualReviewRequired :
                syncCompareResult.recommendedAction === 'none' ? t.noActionNeeded :
                '—'
              }</span>
            </div>

            <div className="sync-actions-row">
              {syncCompareResult.recommendedAction === 'exportBackup' && (
                <button className="sync-save-btn" disabled={backupBusy} onClick={() => { if (onExportBackup) onExportBackup(); }}>
                  {backupBusy ? '...' : t.exportBackup}
                </button>
              )}
              {syncCompareResult.recommendedAction === 'uploadBackup' && (
                <button className="sync-save-btn" disabled={syncBusy} onClick={() => { if (onManualPush) onManualPush(); }}>
                  {syncBusy ? '...' : t.manualPush}
                </button>
              )}
              {syncCompareResult.recommendedAction === 'downloadRemote' && (
                <button className="backup-verify-btn" disabled={syncBusy || !remoteBackups || remoteBackups.length === 0}
                  onClick={() => { if (onManualPull && remoteBackups && remoteBackups.length > 0) { onManualPull(remoteBackups[0].remoteId); } }}>
                  {syncBusy ? '...' : t.manualPullLatest}
                </button>
              )}
              {syncCompareResult.recommendedAction === 'verifyDownloaded' && (
                <button className="backup-verify-btn" onClick={() => onTabChange('backup')}>
                  {t.goToDownloadedBackups}
                </button>
              )}
              {syncCompareResult.recommendedAction === 'manualReview' && (
                <div className="conflict-warning-text">{t.manualReviewRequired}</div>
              )}
              {syncCompareResult.recommendedAction === 'none' && (
                <span className="sync-recommended-value">{t.noActionNeeded}</span>
              )}
            </div>

            {syncCompareResult.warnings.length > 0 && (
              <div className="s3-test-warnings">
                {syncCompareResult.warnings.map((w, i) => (
                  <div key={i} className="s3-test-warning">{w}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Remote History Browser (v0.6.1) */}
        {remoteBackups.length > 0 && (
          <div className="remote-history-section">
            <div className="remote-history-header">{t.remoteHistory}</div>
            {remoteBackups.map((rb) => (
              <div key={rb.remoteId} className="remote-history-card">
                <div className="remote-history-card-header">
                  <span className="remote-history-card-id">{rb.backupId || rb.remoteId}</span>
                  <div className="remote-history-card-actions">
                    <button
                      type="button"
                      className="backup-verify-btn"
                      disabled={cloudBusy || deletingRemoteBackupId === rb.remoteId}
                      onClick={() => onDownloadRemoteBackup(rb.remoteId)}
                      title={t.downloadRemoteBackup}
                    >
                      {cloudBusy ? '...' : t.downloadRemoteBackup}
                    </button>
                    <button
                      type="button"
                      className="sync-save-btn"
                      disabled={syncBusy || deletingRemoteBackupId === rb.remoteId}
                      onClick={() => { if (onCompareWithRemote) onCompareWithRemote(rb.remoteId); }}
                      title={t.compareWithLocal}
                    >
                      {syncBusy ? '...' : t.compareWithLocal}
                    </button>
                    <button
                      type="button"
                      className="backup-verify-btn"
                      disabled={syncPreviewBusy || deletingRemoteBackupId === rb.remoteId}
                      onClick={() => { if (onPreviewRemoteDiff) onPreviewRemoteDiff(rb.remoteId); }}
                      title={t.previewDiff}
                    >
                      {syncPreviewBusy ? '...' : t.previewDiff}
                    </button>
                    <button
                      type="button"
                      className="backup-delete-btn"
                      disabled={cloudBusy || deletingRemoteBackupId === rb.remoteId}
                      onClick={async () => {
                        const confirmed = await showConfirm(
                          '删除远程备份',
                          `确定删除远程备份 ${rb.backupId || rb.remoteId} 吗？这只会删除同步服务器/NAS 上的备份，不会影响当前 Vault。`
                        );
                        if (confirmed) await onDeleteRemoteBackup(rb.remoteId);
                      }}
                      title={t.delete || 'Delete'}
                    >
                      {deletingRemoteBackupId === rb.remoteId ? '...' : (t.delete || 'Delete')}
                    </button>
                  </div>
                </div>
                <div className="remote-history-card-meta">
                  <span>{rb.uploadedAt.replace('T', ' ').substring(0, 19)}</span>
                  <span>{rb.fileCount} files</span>
                  <span>{formatBytes(rb.totalSize)}</span>
                </div>
                <div className="remote-history-card-detail">
                  <span className="hash-text">{t.localHash === 'Local Hash' ? 'Hash' : 'Hash'}: {rb.manifestHash ? rb.manifestHash.substring(0, 12) : '-'}</span>
                  <span>{rb.provider}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {remoteBackups.length === 0 && (
          <div className="bl-empty-hint">{t.noRemoteHistory}</div>
        )}

        {/* Sync Preview / File Diff (v0.6.2) */}
        {syncPreview && (
          <div className="sync-preview-card">
            <div className="sync-preview-header">{t.syncPreview}</div>
            <div className="sync-preview-stats">
              <div className="sync-preview-stat diff-local-only">
                <span className="sync-preview-stat-value">{syncPreview.localOnlyCount}</span>
                <span className="sync-preview-stat-label">{t.localOnlyFiles}</span>
              </div>
              <div className="sync-preview-stat diff-remote-only">
                <span className="sync-preview-stat-value">{syncPreview.remoteOnlyCount}</span>
                <span className="sync-preview-stat-label">{t.remoteOnlyFiles}</span>
              </div>
              <div className="sync-preview-stat diff-modified">
                <span className="sync-preview-stat-value">{syncPreview.modifiedCount}</span>
                <span className="sync-preview-stat-label">{t.modifiedFiles}</span>
              </div>
              <div className="sync-preview-stat diff-unchanged">
                <span className="sync-preview-stat-value">{syncPreview.unchangedCount}</span>
                <span className="sync-preview-stat-label">{t.unchangedFiles}</span>
              </div>
            </div>

            <div className="sync-preview-meta">
              <span>Local: {syncPreview.localFileCount} files</span>
              <span>Remote: {syncPreview.remoteFileCount} files</span>
            </div>

            {syncPreview.diffs.length > 0 ? (
              <div className="sync-diff-list">
                <div className="sync-diff-header">{t.fileDifferences}</div>
                {syncPreview.diffs
                  .filter((d) => d.status !== 'unchanged')
                  .slice(0, 50)
                  .map((diff) => (
                    <div key={diff.relativePath} className={"sync-diff-item diff-" + diff.status}>
                      <span className="sync-diff-status">{
                        diff.status === 'localOnly' ? t.localOnly :
                        diff.status === 'remoteOnly' ? t.remoteOnly :
                        diff.status === 'modified' ? t.modifiedFiles :
                        t.unchangedFiles
                      }</span>
                      <span className="sync-diff-path">{diff.relativePath}</span>
                      {diff.status === 'modified' && (
                        <span className="sync-diff-sizes">{formatBytes(diff.localSize || 0)} vs {formatBytes(diff.remoteSize || 0)}</span>
                      )}
                    </div>
                  ))
                }
                {syncPreview.diffs.filter((d) => d.status !== 'unchanged').length > 50 && (
                  <div className="sync-diff-more">{t.showingFirstFiles}</div>
                )}
              </div>
            ) : (
              <div className="bl-empty-hint">{t.noFileDifferences}</div>
            )}
          </div>
        )}
      </div>
      )}

      {/* Downloaded Backups */}
      <div className="bl-section sync-section-card">
        <div className="bl-section-header section-card-header">{t.downloadedBackups}</div>

        <div className="cloud-safety-notice">
          {t.downloadSafetyNotice}
        </div>

        <div className="cloud-remote-header">
          <span>{t.downloadedBackups}</span>
          <button className="cloud-refresh-btn" onClick={onListDownloadedBackups} disabled={downloadedBusy}>
            {t.refresh || 'Refresh'}
          </button>
        </div>
        {downloadedBackups.length > 0 ? (
          <div className="cloud-remote-list">
            {downloadedBackups.map((db) => (
              <div key={db.downloadId} className="cloud-remote-item remote-backup-card">
                <div className="cloud-remote-item-header">
                  <span className="cloud-remote-item-id">{db.downloadId}</span>
                  <div className="backup-list-item-actions">
                    <button
                      className="backup-verify-btn"
                      onClick={() => onVerifyDownloadedBackup(db.downloadedPath)}
                      disabled={downloadedBusy}
                      title={t.verifyDownloadedBackup}
                    >
                      {downloadedBusy ? '...' : t.valid}
                    </button>
                    <button
                      className="backup-restore-btn"
                      onClick={() => onRestoreDownloadedBackup(db.downloadedPath)}
                      disabled={downloadedBusy}
                      title={t.restoreDownloadedBackup}
                    >
                      {downloadedBusy ? '...' : t.restore}
                    </button>
                  </div>
                </div>
                <div className="cloud-remote-item-meta">
                  <span>{db.remoteId}</span>
                  <span>{db.fileCount} {t.fileCount.toLowerCase()}</span>
                  <span>{formatBytes(db.totalSize)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bl-empty-hint">{t.noDownloadedBackups}</div>
        )}

        {/* Downloaded Verification Result */}
        {downloadedVerifyResult && (
          <div className={`backup-verify-card ${downloadedVerifyResult.valid ? 'backup-verify-valid' : 'backup-verify-invalid'}`}>
            <div className="backup-verify-status">
              <span className={`backup-verify-badge ${downloadedVerifyResult.valid ? 'badge-valid' : 'badge-invalid'}`}>
                {downloadedVerifyResult.valid ? t.backupValid : t.backupInvalid}
              </span>
              <span className="backup-verify-id">{downloadedVerifyResult.backupId}</span>
            </div>
            <div className="backup-info-row">
              <span className="backup-info-label">{t.checkedFiles}</span>
              <span className="backup-info-value">{downloadedVerifyResult.checkedFileCount} / {downloadedVerifyResult.fileCount}</span>
            </div>
            {downloadedVerifyResult.missingFiles.length > 0 && (
              <div className="backup-verify-errors">
                <div className="backup-verify-error-label">{t.missingFiles} ({downloadedVerifyResult.missingFiles.length})</div>
                {downloadedVerifyResult.missingFiles.slice(0, 5).map((f) => (
                  <div key={f} className="backup-verify-error-file">{f}</div>
                ))}
              </div>
            )}
            {downloadedVerifyResult.hashMismatchFiles.length > 0 && (
              <div className="backup-verify-errors">
                <div className="backup-verify-error-label">{t.hashMismatchFiles} ({downloadedVerifyResult.hashMismatchFiles.length})</div>
                {downloadedVerifyResult.hashMismatchFiles.slice(0, 5).map((f) => (
                  <div key={f} className="backup-verify-error-file">{f}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Downloaded Restore Summary */}
        {downloadedRestoreSummary && (
          <div className="cloud-summary-card backup-summary-card">
            <div className="cloud-summary-title">{t.restoreComplete}</div>
            <div className="backup-info-row">
              <span className="backup-info-label">{t.restoredTo}</span>
              <span className="backup-info-value backup-info-path">{downloadedRestoreSummary.restoredTo}</span>
            </div>
            <div className="backup-info-row">
              <span className="backup-info-label">{t.fileCount}</span>
              <span className="backup-info-value">{downloadedRestoreSummary.fileCount}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RightPanelBackupView;
