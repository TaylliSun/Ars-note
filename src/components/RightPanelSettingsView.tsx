import type { SyncProvider } from '../types';
import { useI18n } from '../i18n';
import { APP_VERSION_LABEL } from '../appVersion';
import { formatBytes } from '../utils/vaultManifest';
import { createLiveSyncRendererHint } from '../utils/liveSyncVaultScope';

export interface RightPanelSettingsScope {
  accidentRecoveryBusy: any;
  accidentRecoveryMessage: any;
  accidentRecoveryPlan: any;
  activeSettingsSection: any;
  aiConfig: any;
  aiFormApiKey: any;
  aiFormBaseUrl: any;
  aiFormModel: any;
  aiFormProvider: any;
  aiMemoryOverview: any;
  aiSyncBusy: any;
  aiSyncExcludedRules: any;
  aiSyncLocalBreakdown: any;
  aiSyncLocalFiles: any;
  aiSyncLocalPreview: any;
  aiSyncMsg: any;
  aiSyncRemoteBreakdown: any;
  aiSyncRemoteInfo: any;
  aiSyncRemotePreview: any;
  aiTestResult: any;
  aiTesting: any;
  aiTrashActionBusy: any;
  aiTrashMessage: any;
  applyLiveSyncSafeDeleteQueue: any;
  applyRecoveryAdvisorHighConfidence: any;
  applyRecoveryAdvisorItem: any;
  arshisConfig: any;
  arshisExportMsg: any;
  arshisExporting: any;
  batchRestoreBusy: any;
  batchRestoreMessage: any;
  batchRestorePlan: any;
  clearLiveSyncSafeDeleteQueue: any;
  conflictActionBusy: any;
  conflictCleaning: any;
  conflictMergeDeleteAfterSave: any;
  conflictMergeText: any;
  conflictMessage: any;
  conflictPreview: any;
  conflictPreviewLoading: any;
  conflictScanning: any;
  conflictSummary: any;
  createServerSnapshotNow: any;
  currentFilePath: any;
  currentFileRel: any;
  exportServerBackupToLocal: any;
  formatHistoryReason: any;
  formatRecoveryCandidateHeadline: any;
  formatRecoveryCandidateMeta: any;
  formatShortDuration: any;
  handleApplyConflict: any;
  handleCleanupVaultStorage: any;
  handleCreateConflictMergeDraft: any;
  handleDeleteConflict: any;
  handlePreviewConflict: any;
  handlePreviewHistory: any;
  handlePreviewServerHistory: any;
  handleResolveConflictLatest: any;
  handleRestoreAiTrashFile: any;
  handleRestoreHistory: any;
  handleRestoreProtectedLocalRecoveryFile: any;
  handleRestoreServerHistory: any;
  handleSaveConflictMergeResult: any;
  historyActionBusy: any;
  historyLoading: any;
  historyMessage: any;
  historyPreview: any;
  historyPreviewLoading: any;
  historyPreviewSource: any;
  isRecoveryCandidateRecommended: any;
  lastBackup: any;
  lastManifest: any;
  liveHistory: any;
  liveSyncActivity: any;
  liveSyncAdminUrl: any;
  liveSyncApiKey: any;
  liveSyncClientId: any;
  liveSyncConnected: any;
  liveSyncConnecting: any;
  liveSyncConnectionMode: any;
  liveSyncDiagnosticText: any;
  liveSyncError: any;
  liveSyncExpectedWebSocketUrl: any;
  liveSyncHealth: any;
  liveSyncHealthLoading: any;
  liveSyncHealthMessages: any;
  liveSyncHealthReasonLabel: any;
  liveSyncHealthStatusLabel: any;
  liveSyncLaunchReadiness: any;
  liveSyncLaunchReadinessBadgeClass: any;
  liveSyncLaunchReadinessLabel: any;
  liveSyncMissingSafetyCapabilityLabels: any;
  liveSyncPreflightGuidance: any;
  liveSyncSafeDeleteBusy: any;
  liveSyncSafeDeleteQueue: any;
  liveSyncSafetyCompatibilityLabel: any;
  liveSyncSelfTest: any;
  liveSyncSelfTestStepHint: any;
  liveSyncSelfTestStepLabel: any;
  liveSyncSelfTesting: any;
  liveSyncServerBaseUrl: any;
  liveSyncServerClientEvents: any;
  liveSyncServerClients: any;
  liveSyncServerToolMsg: any;
  liveSyncSimpleSummary: any;
  liveSyncStatusTimerRef: any;
  liveSyncTimeline: any;
  liveSyncTimelineStorageKey: any;
  liveSyncUrl: any;
  liveSyncVersionWarning: any;
  onAIClearConfig: any;
  onAIFormChange: any;
  onAISaveConfig: any;
  onAITestConnection: any;
  onArshisConfigChange: any;
  onArshisExportGameContext: any;
  onClearS3Credentials: any;
  onClearSelfHostedCredentials: any;
  onSaveSyncConfig: any;
  onSetS3Credentials: any;
  onSetSelfHostedCredentials: any;
  onTestS3Connection: any;
  previewAccidentRecoveryPlan: any;
  previewBatchRestoreFromLiveHistory: any;
  previewRecoveryAdvisorPlan: any;
  previewServerBatchRestoreFromLiveHistory: any;
  protectedLocalActionBusy: any;
  protectedLocalMessage: any;
  publishLocalAuthorityToLiveSyncServer: any;
  recoveryAdvisorActionBusy: any;
  recoveryAdvisorBusy: any;
  recoveryAdvisorMessage: any;
  recoveryAdvisorPlan: any;
  recoveryCandidateRole: any;
  refreshAiMemoryOverview: any;
  refreshConflictSummary: any;
  refreshLiveHistory: any;
  refreshLiveSyncHealth: any;
  refreshServerLiveHistory: any;
  refreshServerSnapshots: any;
  refreshSyncRecoveryOverview: any;
  refreshVaultStorageReport: any;
  restoreServerSnapshotCandidate: any;
  resumeLiveSyncAfterDeleteStormReview: any;
  resumeLiveSyncAfterDestructiveTruncationReview: any;
  resumeLiveSyncAfterStaleBaselineReview: any;
  runBatchRestoreFromLiveHistory: any;
  runLiveSyncSelfTest: any;
  runRecommendedAccidentRecovery: any;
  runSafeRecoveryAutopilot: any;
  runServerBatchRestoreFromLiveHistory: any;
  s3AccessKey: any;
  s3Bucket: any;
  s3ConnectionTest: any;
  s3CredentialStatus: any;
  s3Endpoint: any;
  s3ForcePathStyle: any;
  s3Region: any;
  s3SecretKey: any;
  s3Testing: any;
  safeRecoveryAutopilotBusy: any;
  safeRecoveryAutopilotMessage: any;
  scrollToSettingsSection: any;
  searchServerSnapshotFiles: any;
  selfHostedCredentialStatus: any;
  serverBatchRestoreBusy: any;
  serverBatchRestoreMessage: any;
  serverBatchRestorePlan: any;
  serverHistoryLoading: any;
  serverHistoryMessage: any;
  serverLiveHistory: any;
  serverRecoveryDeletedItems: any;
  serverRecoveryDeletedRecent: any;
  serverRecoveryError: any;
  serverRecoveryHistory: any;
  serverRecoveryRejectedItems: any;
  serverRecoveryRejectedRecent: any;
  serverSnapshotBusy: any;
  serverSnapshotFiles: any;
  serverSnapshotMessage: any;
  serverSnapshotQuery: any;
  serverSnapshotSelected: any;
  serverSnapshots: any;
  setAiSyncBusy: any;
  setAiSyncMsg: any;
  setAiSyncRemoteInfo: any;
  setConflictCleaning: any;
  setConflictMergeDeleteAfterSave: any;
  setConflictMergeText: any;
  setConflictMessage: any;
  setConflictPreview: any;
  setHistoryPreview: any;
  setLiveSyncApiKey: any;
  setLiveSyncClientId: any;
  setLiveSyncConnected: any;
  setLiveSyncConnecting: any;
  setLiveSyncConnectionMode: any;
  setLiveSyncError: any;
  setLiveSyncHealth: any;
  setLiveSyncPreflightGuidance: any;
  setLiveSyncSelfTest: any;
  setLiveSyncServerToolMsg: any;
  setLiveSyncTimeline: any;
  setLiveSyncUrl: any;
  setS3AccessKey: any;
  setS3Bucket: any;
  setS3Endpoint: any;
  setS3ForcePathStyle: any;
  setS3Region: any;
  setS3SecretKey: any;
  setServerHistoryMessage: any;
  setServerLiveHistory: any;
  setServerSnapshotQuery: any;
  setServerSnapshotSelected: any;
  setSettingsShowAdvanced: any;
  setShApiKey: any;
  setShEndpoint: any;
  setStorageKeepLatestBackups: any;
  setSyncBucket: any;
  setSyncEnabled: any;
  setSyncEndpoint: any;
  setSyncProvider: any;
  setSyncRecoveryToolsOpen: any;
  setSyncRemoteVaultId: any;
  setVersionHistoryAdvancedOpen: any;
  settingsShowAdvanced: any;
  shApiKey: any;
  shEndpoint: any;
  showConfirm: any;
  showLiveSyncAdvancedDetails: any;
  startWizard: any;
  storageCleaning: any;
  storageCleanupSummary: any;
  storageKeepLatestBackups: any;
  storageMessage: any;
  storageReport: any;
  storageScanning: any;
  syncBucket: any;
  syncConfig: any;
  syncEnabled: any;
  syncEndpoint: any;
  syncProvider: any;
  syncRecoveryLoading: any;
  syncRecoveryMessage: any;
  syncRecoveryOverview: any;
  syncRecoveryToolsOpen: any;
  syncRemoteVaultId: any;
  syncRemoteVaultIdInvalid: any;
  syncRemoteVaultIdWarning: any;
  trustLocalInitialLiveSyncUpload: any;
  vaultPath: any;
  versionHistoryAdvancedOpen: any;
}

interface RightPanelSettingsViewProps {
  scope: RightPanelSettingsScope;
}

export default function RightPanelSettingsView({ scope }: RightPanelSettingsViewProps) {
  const { t, language } = useI18n();
  const {
    accidentRecoveryBusy,
    accidentRecoveryMessage,
    accidentRecoveryPlan,
    activeSettingsSection,
    aiConfig,
    aiFormApiKey,
    aiFormBaseUrl,
    aiFormModel,
    aiFormProvider,
    aiMemoryOverview,
    aiSyncBusy,
    aiSyncExcludedRules,
    aiSyncLocalBreakdown,
    aiSyncLocalFiles,
    aiSyncLocalPreview,
    aiSyncMsg,
    aiSyncRemoteBreakdown,
    aiSyncRemoteInfo,
    aiSyncRemotePreview,
    aiTestResult,
    aiTesting,
    aiTrashActionBusy,
    aiTrashMessage,
    applyLiveSyncSafeDeleteQueue,
    applyRecoveryAdvisorHighConfidence,
    applyRecoveryAdvisorItem,
    arshisConfig,
    arshisExportMsg,
    arshisExporting,
    batchRestoreBusy,
    batchRestoreMessage,
    batchRestorePlan,
    clearLiveSyncSafeDeleteQueue,
    conflictActionBusy,
    conflictCleaning,
    conflictMergeDeleteAfterSave,
    conflictMergeText,
    conflictMessage,
    conflictPreview,
    conflictPreviewLoading,
    conflictScanning,
    conflictSummary,
    createServerSnapshotNow,
    currentFilePath,
    currentFileRel,
    exportServerBackupToLocal,
    formatHistoryReason,
    formatRecoveryCandidateHeadline,
    formatRecoveryCandidateMeta,
    formatShortDuration,
    handleApplyConflict,
    handleCleanupVaultStorage,
    handleCreateConflictMergeDraft,
    handleDeleteConflict,
    handlePreviewConflict,
    handlePreviewHistory,
    handlePreviewServerHistory,
    handleResolveConflictLatest,
    handleRestoreAiTrashFile,
    handleRestoreHistory,
    handleRestoreProtectedLocalRecoveryFile,
    handleRestoreServerHistory,
    handleSaveConflictMergeResult,
    historyActionBusy,
    historyLoading,
    historyMessage,
    historyPreview,
    historyPreviewLoading,
    historyPreviewSource,
    isRecoveryCandidateRecommended,
    lastBackup,
    lastManifest,
    liveHistory,
    liveSyncActivity,
    liveSyncAdminUrl,
    liveSyncApiKey,
    liveSyncClientId,
    liveSyncConnected,
    liveSyncConnecting,
    liveSyncConnectionMode,
    liveSyncDiagnosticText,
    liveSyncError,
    liveSyncExpectedWebSocketUrl,
    liveSyncHealth,
    liveSyncHealthLoading,
    liveSyncHealthMessages,
    liveSyncHealthReasonLabel,
    liveSyncHealthStatusLabel,
    liveSyncLaunchReadiness,
    liveSyncLaunchReadinessBadgeClass,
    liveSyncLaunchReadinessLabel,
    liveSyncMissingSafetyCapabilityLabels,
    liveSyncPreflightGuidance,
    liveSyncSafeDeleteBusy,
    liveSyncSafeDeleteQueue,
    liveSyncSafetyCompatibilityLabel,
    liveSyncSelfTest,
    liveSyncSelfTestStepHint,
    liveSyncSelfTestStepLabel,
    liveSyncSelfTesting,
    liveSyncServerBaseUrl,
    liveSyncServerClientEvents,
    liveSyncServerClients,
    liveSyncServerToolMsg,
    liveSyncSimpleSummary,
    liveSyncStatusTimerRef,
    liveSyncTimeline,
    liveSyncTimelineStorageKey,
    liveSyncUrl,
    liveSyncVersionWarning,
    onAIClearConfig,
    onAIFormChange,
    onAISaveConfig,
    onAITestConnection,
    onArshisConfigChange,
    onArshisExportGameContext,
    onClearS3Credentials,
    onClearSelfHostedCredentials,
    onSaveSyncConfig,
    onSetS3Credentials,
    onSetSelfHostedCredentials,
    onTestS3Connection,
    previewAccidentRecoveryPlan,
    previewBatchRestoreFromLiveHistory,
    previewRecoveryAdvisorPlan,
    previewServerBatchRestoreFromLiveHistory,
    protectedLocalActionBusy,
    protectedLocalMessage,
    publishLocalAuthorityToLiveSyncServer,
    recoveryAdvisorActionBusy,
    recoveryAdvisorBusy,
    recoveryAdvisorMessage,
    recoveryAdvisorPlan,
    recoveryCandidateRole,
    refreshAiMemoryOverview,
    refreshConflictSummary,
    refreshLiveHistory,
    refreshLiveSyncHealth,
    refreshServerLiveHistory,
    refreshServerSnapshots,
    refreshSyncRecoveryOverview,
    refreshVaultStorageReport,
    restoreServerSnapshotCandidate,
    resumeLiveSyncAfterDeleteStormReview,
    resumeLiveSyncAfterDestructiveTruncationReview,
    resumeLiveSyncAfterStaleBaselineReview,
    runBatchRestoreFromLiveHistory,
    runLiveSyncSelfTest,
    runRecommendedAccidentRecovery,
    runSafeRecoveryAutopilot,
    runServerBatchRestoreFromLiveHistory,
    s3AccessKey,
    s3Bucket,
    s3ConnectionTest,
    s3CredentialStatus,
    s3Endpoint,
    s3ForcePathStyle,
    s3Region,
    s3SecretKey,
    s3Testing,
    safeRecoveryAutopilotBusy,
    safeRecoveryAutopilotMessage,
    scrollToSettingsSection,
    searchServerSnapshotFiles,
    selfHostedCredentialStatus,
    serverBatchRestoreBusy,
    serverBatchRestoreMessage,
    serverBatchRestorePlan,
    serverHistoryLoading,
    serverHistoryMessage,
    serverLiveHistory,
    serverRecoveryDeletedItems,
    serverRecoveryDeletedRecent,
    serverRecoveryError,
    serverRecoveryHistory,
    serverRecoveryRejectedItems,
    serverRecoveryRejectedRecent,
    serverSnapshotBusy,
    serverSnapshotFiles,
    serverSnapshotMessage,
    serverSnapshotQuery,
    serverSnapshotSelected,
    serverSnapshots,
    setAiSyncBusy,
    setAiSyncMsg,
    setAiSyncRemoteInfo,
    setConflictCleaning,
    setConflictMergeDeleteAfterSave,
    setConflictMergeText,
    setConflictMessage,
    setConflictPreview,
    setHistoryPreview,
    setLiveSyncApiKey,
    setLiveSyncClientId,
    setLiveSyncConnected,
    setLiveSyncConnecting,
    setLiveSyncConnectionMode,
    setLiveSyncError,
    setLiveSyncHealth,
    setLiveSyncPreflightGuidance,
    setLiveSyncSelfTest,
    setLiveSyncServerToolMsg,
    setLiveSyncTimeline,
    setLiveSyncUrl,
    setS3AccessKey,
    setS3Bucket,
    setS3Endpoint,
    setS3ForcePathStyle,
    setS3Region,
    setS3SecretKey,
    setServerHistoryMessage,
    setServerLiveHistory,
    setServerSnapshotQuery,
    setServerSnapshotSelected,
    setSettingsShowAdvanced,
    setShApiKey,
    setShEndpoint,
    setStorageKeepLatestBackups,
    setSyncBucket,
    setSyncEnabled,
    setSyncEndpoint,
    setSyncProvider,
    setSyncRecoveryToolsOpen,
    setSyncRemoteVaultId,
    setVersionHistoryAdvancedOpen,
    settingsShowAdvanced,
    shApiKey,
    shEndpoint,
    showConfirm,
    showLiveSyncAdvancedDetails,
    startWizard,
    storageCleaning,
    storageCleanupSummary,
    storageKeepLatestBackups,
    storageMessage,
    storageReport,
    storageScanning,
    syncBucket,
    syncConfig,
    syncEnabled,
    syncEndpoint,
    syncProvider,
    syncRecoveryLoading,
    syncRecoveryMessage,
    syncRecoveryOverview,
    syncRecoveryToolsOpen,
    syncRemoteVaultId,
    syncRemoteVaultIdInvalid,
    syncRemoteVaultIdWarning,
    trustLocalInitialLiveSyncUpload,
    vaultPath,
    versionHistoryAdvancedOpen,
  } = scope;

  return (
    <div className={`settings-panel settings-simple-panel settings-page-${activeSettingsSection} ${settingsShowAdvanced ? 'show-advanced' : ''} ${syncRecoveryToolsOpen ? 'show-sync-recovery' : ''}`} data-settings-section={activeSettingsSection}>
      <section className="settings-quick-console settings-section-home">
        <header>
          <div>
            <span className="settings-quick-eyebrow">Settings</span>
            <h3>常用设置</h3>
            <p>这里只显示当前 Vault、实时同步和 AI。诊断、恢复与服务器工具收在对应页面的高级设置中。</p>
          </div>
          <button type="button" onClick={() => setSettingsShowAdvanced((value: any) => !value)}>
            {settingsShowAdvanced ? '收起高级设置' : '显示高级设置'}
          </button>
        </header>
        <div className="settings-quick-grid">
          <article className={liveSyncConnected ? 'ok' : liveSyncUrl.trim() ? 'warning' : 'muted'}>
            <span>实时同步</span>
            <strong>{liveSyncConnected ? '已连接' : liveSyncUrl.trim() ? '已填写地址' : '未配置'}</strong>
            <small>{liveSyncHealth?.local?.latencyMs ? `${liveSyncHealth.local.latencyMs} ms` : (liveSyncHealthStatusLabel(liveSyncHealth) || liveSyncUrl || '先填写服务器地址')}</small>
          </article>
          <article className={aiConfig.hasApiKey ? 'ok' : 'warning'}>
            <span>AI</span>
            <strong>{aiConfig.hasApiKey ? '已配置' : '未配置'}</strong>
            <small>{aiFormModel || aiConfig.model || '设置模型和 API Key 后可用'}</small>
          </article>
          <article className={vaultPath ? 'ok' : 'warning'}>
            <span>当前 Vault</span>
            <strong>{vaultPath ? '已打开' : '未打开'}</strong>
            <small title={vaultPath || ''}>{vaultPath || t.noVaultOpen}</small>
          </article>
        </div>
        <div className="settings-quick-actions">
          <button type="button" className="settings-primary-action" onClick={() => scrollToSettingsSection('settings-live-sync')}>
            实时同步
          </button>
          <button type="button" onClick={() => scrollToSettingsSection('settings-ai')}>
            AI 设置
          </button>
        </div>
      </section>

      <div className="bl-section sync-section-card settings-section-editor settings-static-page-card">
        <div className="bl-section-header section-card-header">编辑器</div>
        <div className="settings-safety-note">
          编辑器布局、Markdown 工具栏、HTML/PDF 切换和实时预览已经整合在主编辑区。这里会保留为后续字体、行宽、自动保存和快捷编辑选项的独立入口。
        </div>
        <div className="settings-info-row">
          <span className="settings-info-label">默认模式</span>
          <span className="settings-info-value">Live Markdown Editor</span>
        </div>
        <div className="settings-info-row">
          <span className="settings-info-label">当前文件</span>
          <span className="settings-info-value settings-info-path">{currentFilePath || '-'}</span>
        </div>
      </div>

      <div className="bl-section sync-section-card settings-section-appearance settings-static-page-card">
        <div className="bl-section-header section-card-header">外观</div>
        <div className="settings-safety-note">
          当前界面采用 Ars-note 统一深色主题，设置窗口、侧栏、编辑器背景和右侧面板会保持一致。后续主题切换也会放在这里。
        </div>
        <div className="settings-info-row">
          <span className="settings-info-label">主题</span>
          <span className="settings-info-value">Things / Dark</span>
        </div>
        <div className="settings-info-row">
          <span className="settings-info-label">设置窗口</span>
          <span className="settings-info-value">独立分栏模式</span>
        </div>
      </div>

      <div className="bl-section sync-section-card settings-section-commands settings-static-page-card">
        <div className="bl-section-header section-card-header">命令面板</div>
        <div className="settings-safety-note">
          命令面板入口会集中管理快速切换、打开团队工作台、同步自检、AI 工具和导出动作。当前可通过主界面快捷入口与侧栏按钮使用。
        </div>
        <div className="settings-info-row">
          <span className="settings-info-label">快速切换</span>
          <span className="settings-info-value">已启用</span>
        </div>
        <div className="settings-info-row">
          <span className="settings-info-label">团队工作台</span>
          <span className="settings-info-value">已接入</span>
        </div>
      </div>

      <div className="bl-section sync-section-card settings-section-preview settings-static-page-card">
        <div className="bl-section-header section-card-header">页面预览</div>
        <div className="settings-safety-note">
          页面预览、HTML 渲染和 PDF 模式仍在编辑器右上角切换。这里独立出来，后面可以继续放预览字体、图片显示、代码块样式和 PDF 导出选项。
        </div>
        <div className="settings-info-row">
          <span className="settings-info-label">HTML 预览</span>
          <span className="settings-info-value">已启用</span>
        </div>
        <div className="settings-info-row">
          <span className="settings-info-label">PDF 预览</span>
          <span className="settings-info-value">已启用</span>
        </div>
      </div>
      {/* General */}
      <div className="bl-section sync-section-card settings-core-card settings-section-home settings-section-about">
        <div className="bl-section-header section-card-header">{t.general}</div>
        <div className="settings-info-row">
          <span className="settings-info-label">{t.language}</span>
          <span className="settings-info-value">{language === 'zh-CN' ? 'Chinese (Simplified)' : 'English'}</span>
        </div>
        <div className="settings-info-row">
          <span className="settings-info-label">{t.appVersion}</span>
          <span className="settings-info-value"><span className="settings-version-badge">{APP_VERSION_LABEL}</span></span>
        </div>
        <div className="settings-info-row">
          <span className="settings-info-label">{t.currentVaultPath}</span>
          <span className="settings-info-value settings-info-path">{vaultPath || t.noVaultOpen}</span>
        </div>
      </div>

      {/* Backup Settings */}
      <div className="bl-section sync-section-card settings-section-files settings-section-recovery">
        <div className="bl-section-header section-card-header">{t.backupSettings}</div>
        <div className="settings-info-row">
          <span className="settings-info-label">{t.lastManifestInfo}</span>
          <span className="settings-info-value">{lastManifest ? (lastManifest.fileCount + ' files, ' + formatBytes(lastManifest.totalSize)) : '-'}</span>
        </div>
        <div className="settings-info-row">
          <span className="settings-info-label">{t.lastBackupInfo}</span>
          <span className="settings-info-value">{lastBackup ? (lastBackup.fileCount + ' files, ' + formatBytes(lastBackup.totalSize)) : '-'}</span>
        </div>
        <div className="settings-info-row">
          <span className="settings-info-label">{t.backupFolderPath}</span>
          <span className="settings-info-value settings-info-path">.ars-note/backups</span>
        </div>
      </div>

      {/* Sync Settings */}
      <div id="settings-sync-base" className="bl-section sync-section-card settings-core-card settings-section-files settings-section-sync">
        <div className="bl-section-header section-card-header">{t.syncSettings}</div>

        <div className="sync-safety-notice">
          {t.syncSafetyNotice}
        </div>

        {syncConfig && (
          <div className="sync-status-row">
            <span className="sync-status-label">{t.syncStatus}</span>
            <span className={'sync-status-badge sync-status-' + syncConfig.status}>
              {t[syncConfig.status as keyof typeof t] || syncConfig.status}
            </span>
          </div>
        )}

        <div className="sync-form">
          <label className="sync-checkbox-row">
            <input type="checkbox" checked={syncEnabled} onChange={(e) => setSyncEnabled(e.target.checked)} />
            <span>{t.enableSync}</span>
          </label>

          <div className="sync-field">
            <label className="sync-field-label">{t.provider}</label>
            <select
              className="sync-select"
              value={syncProvider}
              onChange={(e) => setSyncProvider(e.target.value as SyncProvider)}
              disabled={!syncEnabled}
            >
              <option value="local">{t.localOnly}</option>
              <option value="supabase">Supabase</option>
              <option value="s3">S3 / R2</option>
              <option value="self-hosted">{t.selfHostedServer}</option>
              <option value="custom">{t.provider}</option>
            </select>
          </div>

          {syncEnabled && syncProvider !== 'local' && (
            <>
              <div className="sync-field">
                <label className="sync-field-label">{t.endpoint}</label>
                <input
                  className="sync-input"
                  type="text"
                  value={syncEndpoint}
                  onChange={(e) => setSyncEndpoint(e.target.value)}
                  placeholder={syncProvider === 'supabase' ? 'https://xxx.supabase.co' : 'https://s3.amazonaws.com'}
                />
              </div>
              <div className="sync-field">
                <label className="sync-field-label">{t.bucket}</label>
                <input
                  className="sync-input"
                  type="text"
                  value={syncBucket}
                  onChange={(e) => setSyncBucket(e.target.value)}
                  placeholder={syncProvider === 'supabase' ? 'vault-data' : 'my-bucket'}
                />
              </div>
              {syncProvider === 'self-hosted' && (
                <div className="sync-field">
                  <label className="sync-field-label">{t.remoteVaultId}</label>
                  <input
                    className={'sync-input' + (syncRemoteVaultIdInvalid ? ' sync-input-warning' : '')}
                    type="text"
                    value={syncRemoteVaultId}
                    onChange={(e) => setSyncRemoteVaultId(e.target.value)}
                    placeholder="bdd53ecc-13ee-4739-bf86-d17a70813893"
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    {t.remoteVaultIdDesc}
                  </div>
                  {syncRemoteVaultIdWarning && (
                    <div className="sync-field-warning">
                      {syncRemoteVaultIdWarning}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <button
            className="sync-save-btn"
            disabled={syncRemoteVaultIdInvalid}
            title={syncRemoteVaultIdWarning || undefined}
            onClick={() => {
              if (!onSaveSyncConfig) return;
              onSaveSyncConfig({
                enabled: syncEnabled,
                provider: syncProvider,
                status: syncEnabled ? (syncProvider === 'local' ? 'localOnly' : 'configured') : 'localOnly',
                endpoint: syncEndpoint || undefined,
                bucket: syncBucket || undefined,
                remoteVaultId: syncRemoteVaultId.trim() || undefined,
              });
            }}
          >
            {t.saveSyncSettings}
          </button>
        </div>
      </div>

      {/* Sync Wizard Entry (v0.7.0) */}
      <div className="bl-section sync-section-card settings-section-sync">
        <div className="bl-section-header section-card-header">{t.syncWizard}</div>
        <button
          className="backup-action-btn backup-action-btn-primary"
          onClick={startWizard}
          style={{ width: '100%' }}
        >
          {t.startSyncWizard}
        </button>
      </div>

      {/* S3 / MinIO Settings */}
      {syncEnabled && syncProvider === 's3' && (
      <div className="bl-section sync-section-card settings-section-sync">
        <div className="bl-section-header section-card-header">{t.s3MinioSettings}</div>

        <div className="s3-credentials-notice">
          {t.credentialsMemoryOnly}
        </div>

        {s3CredentialStatus && (
          <div className={'s3-credential-status ' + (s3CredentialStatus.hasCredentials ? 's3-creds-set' : 's3-creds-notset')}>
            {s3CredentialStatus.hasCredentials ? t.credentialsSet : t.credentialsNotSet}
            {s3CredentialStatus.hasCredentials && s3CredentialStatus.endpoint && (
              <span className="s3-cred-detail"> — {s3CredentialStatus.endpoint}/{s3CredentialStatus.bucket}</span>
            )}
          </div>
        )}

        <div className="sync-field">
          <label className="sync-field-label">{t.s3Endpoint}</label>
          <input
            className="sync-input"
            type="text"
            value={s3Endpoint}
            onChange={(e) => setS3Endpoint(e.target.value)}
            placeholder="https://s3.amazonaws.com or http://localhost:9000"
          />
        </div>
        <div className="sync-field">
          <label className="sync-field-label">{t.s3Region}</label>
          <input
            className="sync-input"
            type="text"
            value={s3Region}
            onChange={(e) => setS3Region(e.target.value)}
            placeholder="us-east-1"
          />
        </div>
        <div className="sync-field">
          <label className="sync-field-label">{t.s3BucketLabel}</label>
          <input
            className="sync-input"
            type="text"
            value={s3Bucket}
            onChange={(e) => setS3Bucket(e.target.value)}
            placeholder="my-bucket"
          />
        </div>
        <div className="sync-field">
          <label className="sync-field-label">{t.accessKeyId}</label>
          <input
            className="sync-input"
            type="password"
            value={s3AccessKey}
            onChange={(e) => setS3AccessKey(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="sync-field">
          <label className="sync-field-label">{t.secretAccessKey}</label>
          <input
            className="sync-input"
            type="password"
            value={s3SecretKey}
            onChange={(e) => setS3SecretKey(e.target.value)}
            autoComplete="off"
          />
        </div>
        <label className="sync-checkbox-row">
          <input type="checkbox" checked={s3ForcePathStyle} onChange={(e) => setS3ForcePathStyle(e.target.checked)} />
          <span>{t.forcePathStyle}</span>
        </label>

        <div className="s3-cred-actions">
          <button
            className="sync-save-btn"
            disabled={!s3Endpoint || !s3Bucket || !s3AccessKey || !s3SecretKey}
            onClick={() => {
              if (!onSetS3Credentials) return;
              onSetS3Credentials({
                endpoint: s3Endpoint,
                region: s3Region || 'us-east-1',
                bucket: s3Bucket,
                accessKeyId: s3AccessKey,
                secretAccessKey: s3SecretKey,
                forcePathStyle: s3ForcePathStyle,
              });
            }}
          >
            {t.saveRuntimeCredentials}
          </button>
          <button
            className="backup-verify-btn"
            onClick={() => { if (onClearS3Credentials) onClearS3Credentials(); }}
          >
            {t.clearRuntimeCredentials}
          </button>
        </div>

        {/* Test S3 Connection */}
        <div className="s3-test-section">
          <button
            className="sync-save-btn s3-test-btn"
            disabled={!(s3CredentialStatus && s3CredentialStatus.hasCredentials) || s3Testing}
            onClick={() => { if (onTestS3Connection) onTestS3Connection(); }}
          >
            {s3Testing ? '...' : t.testS3Connection}
          </button>

          {s3ConnectionTest && (
            <div className={'s3-test-result ' + (s3ConnectionTest.ok ? 's3-test-pass' : 's3-test-fail')}>
              <div className="s3-test-result-header">
                <span className={'s3-test-badge ' + (s3ConnectionTest.ok ? 's3-badge-ok' : 's3-badge-fail')}>
                  {s3ConnectionTest.ok ? t.connectionOk : t.connectionFailed}
                </span>
                <span className="s3-test-time">{s3ConnectionTest.checkedAt.replace('T', ' ').substring(0, 19)}</span>
              </div>

              <div className="s3-test-checks">
                <div className={'s3-test-check ' + (s3ConnectionTest.canListBucket ? 'check-pass' : 'check-fail')}>
                  <span className="check-icon">{s3ConnectionTest.canListBucket ? '✓' : '✗'}</span>
                  <span>{t.canListBucket}</span>
                </div>
                <div className={'s3-test-check ' + (s3ConnectionTest.canReadIndex ? 'check-pass' : 'check-neutral')}>
                  <span className="check-icon">{s3ConnectionTest.canReadIndex ? '✓' : '-'}</span>
                  <span>{t.canReadIndex}</span>
                </div>
                <div className={'s3-test-check ' + (s3ConnectionTest.canWriteTestObject ? 'check-pass' : 'check-fail')}>
                  <span className="check-icon">{s3ConnectionTest.canWriteTestObject ? '✓' : '✗'}</span>
                  <span>{t.canWriteTestObject}</span>
                </div>
                <div className={'s3-test-check ' + (s3ConnectionTest.canDeleteTestObject ? 'check-pass' : 'check-neutral')}>
                  <span className="check-icon">{s3ConnectionTest.canDeleteTestObject ? '✓' : '-'}</span>
                  <span>{t.canDeleteTestObject}</span>
                </div>
              </div>

              {s3ConnectionTest.errors.length > 0 && (
                <div className="s3-test-errors">
                  {s3ConnectionTest.errors.map((err: any, i: any) => (
                    <div key={i} className="s3-test-error">{err}</div>
                  ))}
                </div>
              )}
              {s3ConnectionTest.warnings.length > 0 && (
                <div className="s3-test-warnings">
                  {s3ConnectionTest.warnings.map((w: any, i: any) => (
                    <div key={i} className="s3-test-warning">{w}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* S3 Safety Status */}
        {s3CredentialStatus && s3CredentialStatus.hasCredentials && (
        <div className="s3-safety-status">
          <div className="s3-safety-header">{t.safetyStatus}</div>
          <div className="s3-safety-items">
            <div className="s3-safety-item s3-safety-pass">
              <span className="s3-safety-dot" />
              <span>{t.runtimeOnly}</span>
            </div>
            <div className="s3-safety-item s3-safety-pass">
              <span className="s3-safety-dot" />
              <span>{t.notSavedToDisk}</span>
            </div>
            <div className="s3-safety-item s3-safety-pass">
              <span className="s3-safety-dot" />
              <span>{t.secretHidden}</span>
            </div>
            <div className={'s3-safety-item ' + (s3ConnectionTest ? (s3ConnectionTest.ok ? 's3-safety-pass' : 's3-safety-warn') : 's3-safety-muted')}>
              <span className="s3-safety-dot" />
              <span>{t.lastTestStatus}: {s3ConnectionTest ? (s3ConnectionTest.ok ? t.connectionOk : t.connectionFailed) : '—'}</span>
            </div>
          </div>
        </div>
        )}
      </div>
      )}

      {/* Self-hosted Credentials (v0.8.5) */}
      {syncEnabled && syncProvider === 'self-hosted' && (
      <div className="bl-section sync-section-card settings-section-sync">
        <div className="bl-section-header section-card-header">{t.selfHostedCredentials}</div>

        <div className="s3-credentials-notice">
          {t.selfHostedApiKeyNotice}
        </div>

        {selfHostedCredentialStatus && (
          <div className={'s3-credential-status ' + (selfHostedCredentialStatus.hasCredentials ? 's3-creds-set' : 's3-creds-notset')}>
            {selfHostedCredentialStatus.hasCredentials ? t.credentialsSet : t.credentialsNotSet}
            {selfHostedCredentialStatus.hasCredentials && selfHostedCredentialStatus.endpoint && (
              <span className="s3-cred-detail"> — {selfHostedCredentialStatus.endpoint}</span>
            )}
          </div>
        )}

        <div className="sync-field">
          <label className="sync-field-label">{t.serverEndpoint}</label>
          <input
            className="sync-input"
            type="text"
            value={shEndpoint}
            onChange={(e) => setShEndpoint(e.target.value)}
            placeholder="http://your-server:3141"
          />
        </div>
        <div className="sync-field">
          <label className="sync-field-label">{t.selfHostedApiKey}</label>
          <input
            className="sync-input"
            type="password"
            value={shApiKey}
            onChange={(e) => setShApiKey(e.target.value)}
            autoComplete="off"
            placeholder="(optional — leave empty for dev mode)"
          />
        </div>

        <div className="s3-cred-actions">
          <button
            className="sync-save-btn"
            disabled={!shEndpoint}
            onClick={() => {
              if (!onSetSelfHostedCredentials) return;
              onSetSelfHostedCredentials({
                endpoint: shEndpoint,
                apiKey: shApiKey,
              });
            }}
          >
            {t.saveRuntimeCredentials}
          </button>
          <button
            className="backup-verify-btn"
            onClick={() => { if (onClearSelfHostedCredentials) onClearSelfHostedCredentials(); }}
          >
            {t.clearRuntimeCredentials}
          </button>
        </div>

        {/* Safety Status */}
        {selfHostedCredentialStatus && selfHostedCredentialStatus.hasCredentials && (
        <div className="s3-safety-status">
          <div className="s3-safety-header">{t.safetyStatus}</div>
          <div className="s3-safety-items">
            <div className="s3-safety-item s3-safety-pass">
              <span className="s3-safety-dot" />
              <span>{t.runtimeOnly}</span>
            </div>
            <div className="s3-safety-item s3-safety-pass">
              <span className="s3-safety-dot" />
              <span>{t.notSavedToDisk}</span>
            </div>
            <div className="s3-safety-item s3-safety-pass">
              <span className="s3-safety-dot" />
              <span>{t.secretHidden}</span>
            </div>
          </div>
        </div>
        )}
      </div>
      )}

      {/* ── Arshis Integration (v1.0.0) ── */}
      <div className="bl-section settings-card settings-section-ars-ai">
        <div className="bl-section-header section-card-header">{t.arshisIntegration}</div>
        <div className="settings-field">
          <label>{t.enableArshisIntegration}</label>
          <input
            type="checkbox"
            className="settings-toggle"
            checked={arshisConfig.enabled}
            onChange={(e) => onArshisConfigChange({ ...arshisConfig, enabled: e.target.checked })}
          />
        </div>
        {arshisConfig.enabled && (
          <>
            <div className="settings-field">
              <label>{t.arshisProjectName}</label>
              <input
                type="text"
                value={arshisConfig.projectName || ''}
                onChange={(e) => onArshisConfigChange({ ...arshisConfig, projectName: e.target.value })}
                placeholder={'My Game'}
              />
            </div>
            <div className="settings-field">
              <label>{t.exportFolder}</label>
              <input
                type="text"
                value={arshisConfig.exportFolder || '99_Devlog'}
                onChange={(e) => onArshisConfigChange({ ...arshisConfig, exportFolder: e.target.value })}
                placeholder="99_Devlog"
              />
            </div>
            {arshisConfig.lastExportedAt && (
              <div className="settings-meta-info">
                {t.lastExported}: {arshisConfig.lastExportedAt.replace('T', ' ').substring(0, 19)}
              </div>
            )}
            <button
              className="settings-primary-action"
              disabled={arshisExporting}
              onClick={onArshisExportGameContext}
            >
              {arshisExporting ? '...' : t.exportGameContext}
            </button>
            {arshisExportMsg && (
              <div className="settings-action-msg">{arshisExportMsg}</div>
            )}
          </>
        )}
      </div>

      {/* AI Settings (v1.1.0) */}
      <div id="settings-ai" className="bl-section settings-card settings-core-card settings-section-ai settings-section-ars-ai">
        <div className="bl-section-header section-card-header">{t.aiSettings}</div>
        <div className="settings-safety-note">{t.aiSettingsNotice}</div>
        <div className="settings-field">
          <label>{t.aiProvider}</label>
          <select value={aiFormProvider} onChange={(e) => onAIFormChange('provider', e.target.value)}>
            <option value="openai-compatible">OpenAI-compatible</option>
            <option value="ollama">Ollama</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div className="settings-field">
          <label>{t.aiBaseUrl}</label>
          <input type="text" value={aiFormBaseUrl} onChange={(e) => onAIFormChange('baseUrl', e.target.value)} placeholder="https://api.openai.com/v1" />
        </div>
        <div className="settings-field">
          <label>{t.aiModel}</label>
          <input type="text" value={aiFormModel} onChange={(e) => onAIFormChange('model', e.target.value)} placeholder="gpt-4o-mini" />
        </div>
        <div className="settings-field">
          <label>{t.aiApiKey}</label>
          <input type="password" value={aiFormApiKey} onChange={(e) => onAIFormChange('apiKey', e.target.value)} placeholder={t.aiApiKeyPlaceholder} />
        </div>
        <div className="settings-actions">
          <button onClick={onAISaveConfig}>{t.saveRuntimeCredentials}</button>
          <button onClick={onAIClearConfig}>{t.clearRuntimeCredentials}</button>
          <button disabled={aiTesting} onClick={onAITestConnection}>{aiTesting ? '...' : t.testAIConnection}</button>
        </div>
        {aiConfig.hasApiKey && !aiConfig.lastError && (
          <div className="settings-status-badge status-ok">{t.credentialsSet}</div>
        )}
        {aiTestResult && (
          <div className={'settings-status-badge ' + (aiTestResult.ok ? 'status-ok' : 'status-error')}>
            {aiTestResult.ok ? t.aiConnectionOk + (aiTestResult.model ? ' (' + aiTestResult.model + ')' : '') : t.aiConnectionFailed + ': ' + aiTestResult.error}
          </div>
        )}
        {aiConfig.lastError && !aiTestResult && (
          <div className="settings-status-badge status-error">{aiConfig.lastError}</div>
        )}
      </div>

      {/* AI Memory Sync (v0.9.5) */}
      <div className="bl-section settings-card settings-section-ars-ai">
        <div className="bl-section-header section-card-header">{t.aiMemorySync}</div>
        <div className="settings-safety-note">{t.aiSyncDesc}</div>

        <div className="ai-sync-overview-grid">
          <div className="ai-sync-overview-card">
            <span>本地记忆</span>
            <strong>{aiMemoryOverview?.status?.historyCount ?? '-'}</strong>
            <small>{aiMemoryOverview?.status?.initialized ? '已初始化' : '未初始化'}</small>
          </div>
          <div className="ai-sync-overview-card">
            <span>Skills / Crons</span>
            <strong>{(aiMemoryOverview?.skills?.length || 0)} / {(aiMemoryOverview?.crons?.length || 0)}</strong>
            <small>会随 .ai-memory 同步</small>
          </div>
          <div className="ai-sync-overview-card">
            <span>远端状态</span>
            <strong>{aiSyncRemoteInfo?.hasData ? aiSyncRemoteInfo.fileCount : '-'}</strong>
            <small>{aiSyncRemoteInfo?.syncedAt ? aiSyncRemoteInfo.syncedAt.replace('T', ' ').substring(0, 19) : '尚未检查'}</small>
          </div>
        </div>
        <div className="ai-sync-scope-card">
          <div className="ai-sync-scope-head">
            <strong>同步覆盖范围</strong>
            <span>{aiSyncLocalFiles.length} 个本地 AI 文件会上传；live-session 和 history 不会上传</span>
          </div>
          <div className="ai-sync-breakdown-grid">
            <div><span>核心记忆</span><strong>{aiSyncLocalBreakdown.core}/3</strong></div>
            <div><span>Skills</span><strong>{aiSyncLocalBreakdown.skills}</strong></div>
            <div><span>Crons</span><strong>{aiSyncLocalBreakdown.crons}</strong></div>
            <div><span>Evolution</span><strong>{aiSyncLocalBreakdown.evolutions}</strong></div>
          </div>
          {aiSyncLocalFiles.length > 0 ? (
            <div className="ai-sync-file-chips">
              {aiSyncLocalPreview.shown.map((file: string) => (
                <span key={file} title={file}>{file}</span>
              ))}
              {aiSyncLocalPreview.hidden > 0 && <span>+{aiSyncLocalPreview.hidden} more</span>}
            </div>
          ) : (
            <div className="backup-info-meta">本地还没有可同步的 AI 记忆文件；打开 AI 面板会自动初始化。</div>
          )}
          <div className="ai-sync-excluded-row">
            <span>不会同步</span>
            {aiSyncExcludedRules.map((rule: any) => <code key={rule}>{rule}</code>)}
          </div>
        </div>

        {!syncConfig?.enabled || syncConfig.provider !== 'self-hosted' ? (
          <div className="settings-status-badge status-error">{t.aiSyncNoConfig}</div>
        ) : (
          <>
            <div className="settings-actions" style={{ marginTop: 8, gap: 8 }}>
              <button
                onClick={async () => {
                  setAiSyncBusy('now');
                  setAiSyncMsg('');
                  try {
                    const api = (window as any).arsnote;
                    const result = await api.aiSyncNow(vaultPath);
                    const pulled = result.pulledFileCount || 0;
                    const pushed = result.pushedFileCount || 0;
                    const conflicts = result.conflictCount || 0;
                    const conflictNote = conflicts ? `，已保护 ${conflicts} 个本地冲突副本` : '';
                    setAiSyncMsg(`AI 记忆和技能已双向同步：拉取 ${pulled} 个文件，上传 ${pushed} 个文件${conflictNote}。`);
                    if (result.status) setAiSyncRemoteInfo(result.status);
                    await refreshAiMemoryOverview();
                  } catch (err: any) {
                    setAiSyncMsg(err.message || 'AI memory sync failed');
                  }
                  setAiSyncBusy(null);
                }}
                disabled={aiSyncBusy !== null}
                title="先拉取其他电脑的 AI 记忆/技能，再上传本机的新记忆/技能"
              >
                {aiSyncBusy === 'now' ? '同步中...' : '一键同步记忆和技能'}
              </button>
              <button
                onClick={async () => {
                  setAiSyncBusy('push');
                  setAiSyncMsg('');
                  try {
                    const api = (window as any).arsnote;
                    const result = await api.aiSyncPush(vaultPath);
                    setAiSyncMsg(t.aiSyncPushOk + ' (' + result.fileCount + ' files, ' + result.syncedAt.replace('T', ' ').substring(0, 19) + ')');
                    setAiSyncRemoteInfo({ hasData: true, syncedAt: result.syncedAt, fileCount: result.fileCount, files: aiSyncLocalFiles });
                    refreshAiMemoryOverview();
                  } catch (err: any) {
                    setAiSyncMsg(err.message || 'Push failed');
                  }
                  setAiSyncBusy(null);
                }}
                disabled={aiSyncBusy !== null}
              >
                {aiSyncBusy === 'push' ? t.aiSyncPushing : t.aiSyncPush}
              </button>
              <button
                onClick={async () => {
                  setAiSyncBusy('pull');
                  setAiSyncMsg('');
                  try {
                    const api = (window as any).arsnote;
                    const result = await api.aiSyncPull(vaultPath);
                    const conflictNote = result.conflictCount ? `，已保护 ${result.conflictCount} 个本地冲突副本` : '';
                    setAiSyncMsg(t.aiSyncPullOk.replace('{count}', String(result.fileCount)) + conflictNote);
                    refreshAiMemoryOverview();
                  } catch (err: any) {
                    setAiSyncMsg(err.message || 'Pull failed');
                  }
                  setAiSyncBusy(null);
                }}
                disabled={aiSyncBusy !== null}
              >
                {aiSyncBusy === 'pull' ? t.aiSyncPulling : t.aiSyncPull}
              </button>
              <button
                onClick={async () => {
                  setAiSyncBusy('status');
                  setAiSyncMsg('');
                  try {
                    const api = (window as any).arsnote;
                    const result = await api.aiSyncStatus(vaultPath);
                    setAiSyncRemoteInfo(result);
                    refreshAiMemoryOverview();
                  } catch (err: any) {
                    setAiSyncMsg(err.message || 'Status check failed');
                  }
                  setAiSyncBusy(null);
                }}
                disabled={aiSyncBusy !== null}
              >
                {t.aiSyncCheckStatus}
              </button>
            </div>

            {aiSyncRemoteInfo && (
              <div className="backup-info-card" style={{ marginTop: 8 }}>
                <div className="backup-info-row">
                  <span className="backup-info-label">{t.aiSyncStatus}</span>
                  <span className="backup-info-value">{aiSyncRemoteInfo.hasData ? '✓ ' + t.aiSyncServerFiles + ': ' + aiSyncRemoteInfo.fileCount : t.aiSyncNoData}</span>
                </div>
                {aiSyncRemoteInfo.syncedAt && (
                  <div className="backup-info-row">
                    <span className="backup-info-label">{t.aiSyncLastTime}</span>
                    <span className="backup-info-value">{aiSyncRemoteInfo.syncedAt.replace('T', ' ').substring(0, 19)}</span>
                  </div>
                )}
                {aiSyncRemoteInfo.hasData && (
                  <div className="ai-sync-remote-breakdown">
                    <span>核心 {aiSyncRemoteBreakdown.core}/3</span>
                    <span>Skills {aiSyncRemoteBreakdown.skills}</span>
                    <span>Crons {aiSyncRemoteBreakdown.crons}</span>
                    <span>Evolution {aiSyncRemoteBreakdown.evolutions}</span>
                    {aiSyncRemoteBreakdown.other > 0 && <span>Other {aiSyncRemoteBreakdown.other}</span>}
                  </div>
                )}
                {aiSyncRemoteInfo.files && aiSyncRemoteInfo.files.length > 0 && (
                  <div className="ai-sync-file-chips compact">
                    {aiSyncRemotePreview.shown.map((file: any) => (
                      <span key={file} title={file}>{file}</span>
                    ))}
                    {aiSyncRemotePreview.hidden > 0 && <span>+{aiSyncRemotePreview.hidden} more</span>}
                  </div>
                )}
              </div>
            )}

            {aiSyncMsg && (
              <div className={'settings-status-badge ' + (aiSyncMsg.includes('failed') || aiSyncMsg.includes('Error') ? 'status-error' : 'status-ok')} style={{ marginTop: 8 }}>
                {aiSyncMsg}
              </div>
            )}
          </>
        )}
      </div>

      {/* Live Sync — Real-time vault sync (v1.0.0) */}
      <div id="settings-live-sync" className="bl-section settings-card settings-core-card settings-live-sync-card settings-section-live-sync">
        <div className="bl-section-header section-card-header">
          {t.liveSyncTitle || 'Live Sync'}
        </div>
        <div className="settings-safety-note">
          {t.liveSyncDesc || 'Real-time sync between computers. Type on one, instantly appears on the other.'}
        </div>

        <div className="live-sync-member-onboarding">
          <div className="live-sync-member-copy">
            <span>普通成员入口</span>
            <strong>加入现有 Vault</strong>
            <small>只需要填写服务器地址和密钥。连接时先下载服务器权威版本，本机旧文件、空文件、缺基线文件不会直接上传覆盖服务器。</small>
          </div>
          <div className="live-sync-member-steps">
            <span>1 填服务器地址</span>
            <span>2 填密钥</span>
            <span>3 点击加入</span>
          </div>
        </div>

        {showLiveSyncAdvancedDetails && (
          <>
            <div className="live-sync-mode-selector">
              <button
                type="button"
                className={'live-sync-mode-card ' + (liveSyncConnectionMode === 'join' ? 'selected' : '')}
                onClick={() => setLiveSyncConnectionMode('join')}
                disabled={liveSyncConnected}
              >
                <span>加入现有 Vault</span>
                <strong>推荐</strong>
                <small>服务器永远是权威时间线；旧电脑不会直接上传覆盖服务器。</small>
              </button>
              <button
                type="button"
                className={'live-sync-mode-card danger ' + (liveSyncConnectionMode === 'rebuild' ? 'selected' : '')}
                onClick={() => setLiveSyncConnectionMode('rebuild')}
                disabled={liveSyncConnected}
              >
                <span>用本机重建服务器</span>
                <strong>管理员</strong>
                <small>只在这台电脑确认是最新完整版本时使用；执行前会创建服务器安全快照。</small>
              </button>
            </div>

            <div className={'settings-status-badge ' + (liveSyncConnectionMode === 'rebuild' ? 'status-warning' : 'status-ok')} style={{ marginTop: 8, marginBottom: 8 }}>
              {liveSyncConnectionMode === 'rebuild'
                ? '当前是危险修复模式：先安全连接服务器，不自动上传旧数据；连接后再手动执行“以本机为准重建服务器”。'
                : '当前是安全加入模式：连接时先拉取服务器快照，服务器已有数据时本机旧数据不会直接覆盖服务器。'}
            </div>
          </>
        )}

        {!showLiveSyncAdvancedDetails && (
          <button
            type="button"
            className="live-sync-admin-link"
            onClick={() => setSettingsShowAdvanced(true)}
          >
            管理员修复服务器 / 高级诊断
          </button>
        )}
        {showLiveSyncAdvancedDetails && (
          <button
            type="button"
            className="live-sync-admin-link"
            onClick={() => {
              if (syncRecoveryToolsOpen) {
                setSyncRecoveryToolsOpen(false);
                return;
              }
              setSyncRecoveryToolsOpen(true);
              refreshSyncRecoveryOverview();
              window.setTimeout(() => scrollToSettingsSection('settings-live-sync-recovery'), 80);
            }}
          >
            {syncRecoveryToolsOpen ? '隐藏同步恢复中心' : '打开同步恢复中心'}
          </button>
        )}

        {/* Connection indicator */}
        <div className="sync-status-row" style={{ marginBottom: 8 }}>
          <span className="sync-status-label">{t.liveSyncStatus || 'Status'}</span>
          <span className={'sync-status-badge ' + (liveSyncConnected ? 'sync-status-synced' : 'sync-status-notConfigured')}>
            {liveSyncConnected ? (t.liveSyncConnected || 'Connected') : (t.liveSyncDisconnected || 'Disconnected')}
          </span>
        </div>

        <div className={'live-sync-simple-card ' + liveSyncSimpleSummary.tone}>
          <div className="live-sync-simple-main">
            <span className="live-sync-simple-kicker">Ars-note 安全实时同步</span>
            <div className="live-sync-simple-title">
              <span className={'live-sync-simple-badge ' + liveSyncSimpleSummary.tone}>
                {liveSyncSimpleSummary.label}
              </span>
              <strong>{liveSyncSimpleSummary.title}</strong>
            </div>
            <p>{liveSyncSimpleSummary.detail}</p>
            {liveSyncSimpleSummary.facts.length > 0 && (
              <div className="live-sync-simple-facts">
                {liveSyncSimpleSummary.facts.map((fact: any) => (
                  <span key={fact}>{fact}</span>
                ))}
              </div>
            )}
          </div>
          {liveSyncSimpleSummary.action !== 'none' && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={liveSyncSimpleSummary.action === 'autopilot' && safeRecoveryAutopilotBusy}
              onClick={async () => {
                if (liveSyncSimpleSummary.action === 'refresh') {
                  await refreshLiveSyncHealth();
                  return;
                }
                if (liveSyncSimpleSummary.action === 'recovery') {
                  setSettingsShowAdvanced(true);
                  setSyncRecoveryToolsOpen(true);
                  window.setTimeout(() => scrollToSettingsSection('settings-live-sync-recovery'), 80);
                  return;
                }
                if (liveSyncSimpleSummary.action === 'autopilot') {
                  await runSafeRecoveryAutopilot();
                  await refreshLiveSyncHealth();
                  return;
                }
                if (liveSyncSimpleSummary.action === 'safe-delete') {
                  setSettingsShowAdvanced(true);
                  window.setTimeout(() => scrollToSettingsSection('settings-live-sync'), 80);
                  return;
                }
                if (liveSyncSimpleSummary.action === 'admin') {
                  if (liveSyncAdminUrl) {
                    await (window as any).arsnote?.openExternalUrl?.(liveSyncAdminUrl);
                  } else {
                    await refreshLiveSyncHealth();
                  }
                }
              }}
            >
              {liveSyncSimpleSummary.actionLabel}
            </button>
          )}
        </div>

        {/* Version mismatch warning */}
        {liveSyncVersionWarning && (
          <div style={{ padding: '6px 10px', marginBottom: 8, borderRadius: 4, background: 'rgba(255, 180, 0, 0.15)', border: '1px solid rgba(255, 180, 0, 0.3)', color: 'var(--text-secondary)', fontSize: 12 }}>
            ⚠ {liveSyncVersionWarning}
          </div>
        )}

        {/* Server URL */}
        <div className="settings-form-group">
          <label className="settings-label">{t.liveSyncServerUrl || 'Sync Server URL'}</label>
          <input
            type="text"
            className="settings-input"
            placeholder="ws://192.168.1.100:8787"
            value={liveSyncUrl}
            onChange={(e) => setLiveSyncUrl(e.target.value)}
            disabled={liveSyncConnected}
          />
        </div>

        {/* API Key */}
        <div className="settings-form-group">
          <label className="settings-label">{t.liveSyncApiKey || 'Server API Key (optional)'}</label>
          <input
            type="password"
            className="settings-input"
            placeholder="••••••••"
            value={liveSyncApiKey}
            onChange={(e) => setLiveSyncApiKey(e.target.value)}
            disabled={liveSyncConnected}
          />
        </div>

        {/* Connect / Disconnect buttons */}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {!liveSyncConnected ? (
            <button
              className="btn btn-primary"
              disabled={!liveSyncUrl.trim() || liveSyncConnecting}
              onClick={async () => {
                setLiveSyncConnecting(true);
                setLiveSyncError('');
                setLiveSyncPreflightGuidance(null);
                const api = (window as any).arsnote;
                if (!api?.liveSyncStart) {
                  setLiveSyncError('Live sync not available in this version. Please update Ars-note.');
                  setLiveSyncConnecting(false);
                  return;
                }
                try {
                  const selectedConnectionMode = settingsShowAdvanced ? liveSyncConnectionMode : 'join';
                  let config = {
                    enabled: true,
                    serverUrl: liveSyncUrl.trim(),
                    apiKey: liveSyncApiKey.trim() || undefined,
                    vaultId: syncConfig?.remoteVaultId || undefined,
                    connectionMode: selectedConnectionMode,
                  };
                  if (api?.liveSyncPreflightStart) {
                    const preflight = await api.liveSyncPreflightStart(vaultPath, config);
                    if (preflight?.health) setLiveSyncHealth(preflight.health);
                    if (preflight?.guidance) setLiveSyncPreflightGuidance(preflight.guidance);
                    if (preflight?.config) {
                      config = {
                        enabled: true,
                        serverUrl: preflight.config.serverUrl || config.serverUrl,
                        apiKey: preflight.config.apiKey || config.apiKey,
                        vaultId: preflight.config.vaultId || config.vaultId,
                        connectionMode: preflight.config.connectionMode || config.connectionMode,
                      };
                    }
                    const readiness = preflight?.readiness || preflight?.health?.launchReadiness;
                    if (readiness?.status === 'blocked' || preflight?.blocked) {
                      const guidance = preflight?.guidance || {};
                      setLiveSyncError(
                        guidance.title
                          ? ''
                          : (readiness?.summary || preflight?.error || '同步已被保护暂停，请按同步向导处理。'),
                      );
                      setLiveSyncConnecting(false);
                      return;
                    }
                    if ((readiness?.status === 'warning' || preflight?.warning) && selectedConnectionMode === 'rebuild') {
                      const warnings = Array.isArray(readiness?.warnings) ? readiness.warnings.slice(0, 5) : [];
                      const actions = Array.isArray(readiness?.actions) ? readiness.actions.slice(0, 4) : [];
                      const confirmed = await showConfirm(
                        '管理员重建模式提醒',
                        [
                          '当前选择的是“用本机重建服务器”。连接本身不会发布本机文件，但后续重建服务器是危险操作。',
                          readiness?.summary || '上线前检查发现需要注意的同步风险。',
                          warnings.length ? `\n提醒：\n- ${warnings.join('\n- ')}` : '',
                          actions.length ? `\n建议：\n- ${actions.join('\n- ')}` : '',
                          '\n仍要继续进入管理员重建模式吗？',
                        ].filter(Boolean).join('\n'),
                      );
                      if (!confirmed) {
                        setLiveSyncError('已取消连接：管理员重建模式需要先确认风险。');
                        setLiveSyncConnecting(false);
                        return;
                      }
                    }
                  }
                  const result = await api.liveSyncStart(vaultPath, config);
                  if (result.ok) {
                    setLiveSyncPreflightGuidance(null);
                    const savedConfig = result.config || config;
                    if (savedConfig.serverUrl) setLiveSyncUrl(savedConfig.serverUrl);
                    localStorage.setItem('ars-note.live-sync', JSON.stringify(createLiveSyncRendererHint(vaultPath, {
                      serverUrl: savedConfig.serverUrl || config.serverUrl,
                      vaultId: savedConfig.vaultId || config.vaultId || '',
                      connectionMode: savedConfig.connectionMode || config.connectionMode || 'join',
                    })));
                    api.liveSyncSaveConfig?.(vaultPath, savedConfig).catch(() => {});
                    /* Wait briefly for WebSocket connection status */
                    if (liveSyncStatusTimerRef.current !== null) {
                      window.clearTimeout(liveSyncStatusTimerRef.current);
                    }
                    liveSyncStatusTimerRef.current = window.setTimeout(async () => {
                      try {
                        const status = await api.liveSyncStatus?.();
                        if (status?.connected) {
                          setLiveSyncConnected(true);
                          setLiveSyncClientId(status.clientId || '');
                          setLiveSyncError('');
                        } else {
                          setLiveSyncError(status?.lastError || '服务器已响应，但 WebSocket 仍未建立。若使用节点小宝/中转链路，请检查长连接是否稳定；服务器地址只填到端口，例如 http://NAS_IP:8787。');
                        }
                      } catch {
                        setLiveSyncError('Could not verify connection status.');
                      }
                      setLiveSyncConnecting(false);
                      liveSyncStatusTimerRef.current = null;
                    }, 20000);
                  } else {
                    setLiveSyncError(result.error || 'Connection failed');
                    setLiveSyncConnecting(false);
                  }
                } catch (err: any) {
                  setLiveSyncError(err.message || 'Connection failed');
                  setLiveSyncConnecting(false);
                }
              }}
            >
              {liveSyncConnecting
                ? '连接中...'
                : (settingsShowAdvanced && liveSyncConnectionMode === 'rebuild')
                  ? '先安全连接服务器'
                  : '加入现有 Vault'}
            </button>
          ) : (
            <button
              className="btn btn-secondary"
              onClick={async () => {
                const api = (window as any).arsnote;
                if (!api?.liveSyncStop) return;
                await api.liveSyncStop();
                if (liveSyncStatusTimerRef.current !== null) {
                  window.clearTimeout(liveSyncStatusTimerRef.current);
                  liveSyncStatusTimerRef.current = null;
                }
                setLiveSyncConnected(false);
              }}
            >
              {t.liveSyncDisconnect || 'Disconnect'}
            </button>
          )}
        </div>

        {liveSyncConnectionMode === 'rebuild' && liveSyncConnected && (
          <div className="live-sync-rebuild-panel">
            <div>
              <strong>本机重建服务器</strong>
              <small>这会把当前电脑作为权威版本：新增/覆盖/删除服务器文件。执行前会自动创建服务器快照。</small>
            </div>
            <button className="btn btn-danger" type="button" onClick={() => void publishLocalAuthorityToLiveSyncServer()}>
              以本机为准重建服务器
            </button>
          </div>
        )}

        {/* Error message */}
        {liveSyncError && (
          <div className="settings-status-badge status-error" style={{ marginTop: 8 }}>
            {liveSyncError}
          </div>
        )}

        {liveSyncPreflightGuidance && !liveSyncConnected && (
          <div className={'live-sync-simple-card ' + (liveSyncPreflightGuidance.tone || 'warning')} style={{ marginTop: 10 }}>
            <div className="live-sync-simple-main">
              <span className="live-sync-simple-kicker">同步向导</span>
              <div className="live-sync-simple-title">
                <span className={'live-sync-simple-badge ' + (liveSyncPreflightGuidance.tone || 'warning')}>
                  {liveSyncPreflightGuidance.status === 'ready' ? '可以同步' : liveSyncPreflightGuidance.status === 'protected_paused' ? '已保护' : '需要处理'}
                </span>
                <strong>{liveSyncPreflightGuidance.title || '同步上线前检查'}</strong>
              </div>
              <p>{liveSyncPreflightGuidance.detail || 'Ars-note 已完成同步上线前检查。'}</p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {liveSyncPreflightGuidance.primaryAction && liveSyncPreflightGuidance.primaryAction !== 'none' && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={liveSyncPreflightGuidance.primaryAction === 'autopilot' && safeRecoveryAutopilotBusy}
                  onClick={async () => {
                    const action = liveSyncPreflightGuidance.primaryAction;
                    if (action === 'recovery') {
                      setSettingsShowAdvanced(true);
                      setSyncRecoveryToolsOpen(true);
                      window.setTimeout(() => scrollToSettingsSection('settings-live-sync-recovery'), 80);
                      return;
                    }
                    if (action === 'autopilot') {
                      await runSafeRecoveryAutopilot();
                      await refreshLiveSyncHealth();
                      return;
                    }
                    if (action === 'admin') {
                      if (liveSyncAdminUrl) await (window as any).arsnote?.openExternalUrl?.(liveSyncAdminUrl);
                      else await refreshLiveSyncHealth();
                      return;
                    }
                    if (action === 'retry') {
                      await refreshLiveSyncHealth();
                      return;
                    }
                    if (action === 'copyDiagnostics') {
                      await navigator.clipboard.writeText(liveSyncDiagnosticText);
                      setLiveSyncServerToolMsg('已复制同步诊断信息。');
                      return;
                    }
                    if (action === 'continue') {
                      setLiveSyncPreflightGuidance(null);
                    }
                  }}
                >
                  {liveSyncPreflightGuidance.primaryLabel || '处理'}
                </button>
              )}
              {liveSyncPreflightGuidance.secondaryAction && liveSyncPreflightGuidance.secondaryAction !== 'none' && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={liveSyncPreflightGuidance.secondaryAction === 'autopilot' && safeRecoveryAutopilotBusy}
                  onClick={async () => {
                    const action = liveSyncPreflightGuidance.secondaryAction;
                    if (action === 'recovery') {
                      setSettingsShowAdvanced(true);
                      setSyncRecoveryToolsOpen(true);
                      window.setTimeout(() => scrollToSettingsSection('settings-live-sync-recovery'), 80);
                      return;
                    }
                    if (action === 'autopilot') {
                      await runSafeRecoveryAutopilot();
                      await refreshLiveSyncHealth();
                      return;
                    }
                    if (action === 'admin') {
                      if (liveSyncAdminUrl) await (window as any).arsnote?.openExternalUrl?.(liveSyncAdminUrl);
                      else await refreshLiveSyncHealth();
                      return;
                    }
                    if (action === 'retry') {
                      await refreshLiveSyncHealth();
                      return;
                    }
                    if (action === 'copyDiagnostics') {
                      await navigator.clipboard.writeText(liveSyncDiagnosticText);
                      setLiveSyncServerToolMsg('已复制同步诊断信息。');
                    }
                  }}
                >
                  {liveSyncPreflightGuidance.secondaryLabel || '更多'}
                </button>
              )}
            </div>
          </div>
        )}

        {!showLiveSyncAdvancedDetails && (
          <div className="live-sync-quiet-note">
            <span>已隐藏高级诊断</span>
            <strong>普通成员只需要看上面的状态。</strong>
            <small>WebSocket、Vault ID、队列和客户端事件仍会记录；需要排查时再打开“管理员修复服务器 / 高级诊断”。</small>
          </div>
        )}

        {showLiveSyncAdvancedDetails && (
          <>

        {/* Client ID when connected */}
        {liveSyncConnected && liveSyncClientId && (
          <div className="backup-info-card" style={{ marginTop: 8 }}>
            <div className="backup-info-row">
              <span className="backup-info-label">Client ID</span>
              <span className="backup-info-value" style={{ fontFamily: 'monospace', fontSize: 11 }}>{liveSyncClientId}</span>
            </div>
          </div>
        )}

        <div className="backup-info-card" style={{ marginTop: 10 }}>
          <div className="backup-info-row">
            <span className="backup-info-label">同步服务器</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={refreshLiveSyncHealth} disabled={liveSyncHealthLoading}>
                {liveSyncHealthLoading ? '检查中...' : '刷新'}
              </button>
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 10px', fontSize: 12 }}
                disabled={!liveSyncAdminUrl}
                title={liveSyncAdminUrl || '先填写同步服务器地址'}
                onClick={async () => {
                  if (!liveSyncAdminUrl) return;
                  try {
                    await (window as any).arsnote?.openExternalUrl?.(liveSyncAdminUrl);
                    setLiveSyncServerToolMsg(`已打开服务器管理台：${liveSyncAdminUrl}`);
                  } catch (err: any) {
                    setLiveSyncServerToolMsg(err?.message || '打开服务器管理台失败');
                  }
                }}
              >
                管理台
              </button>
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 10px', fontSize: 12 }}
                disabled={!liveSyncServerBaseUrl && !liveSyncHealth}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(liveSyncDiagnosticText);
                    setLiveSyncServerToolMsg('已复制同步诊断信息。');
                  } catch {
                    setLiveSyncServerToolMsg('复制失败，当前系统没有开放剪贴板权限。');
                  }
                }}
              >
                复制诊断
              </button>
            </div>
          </div>
          {liveSyncServerToolMsg && (
            <div className="settings-status-badge status-ok" style={{ marginTop: 6 }}>
              {liveSyncServerToolMsg}
            </div>
          )}
          <div className="backup-info-row">
            <span className="backup-info-label">管理台地址</span>
            <span className="backup-info-value" title={liveSyncAdminUrl || ''}>
              {liveSyncAdminUrl || '-'}
            </span>
          </div>
          <div className="backup-info-row">
            <span className="backup-info-label">WebSocket 地址</span>
            <span className="backup-info-value" title={liveSyncExpectedWebSocketUrl || ''}>
              {liveSyncExpectedWebSocketUrl || '-'}
            </span>
          </div>
          <div className="backup-info-row">
            <span className="backup-info-label">服务器状态</span>
            <span className="backup-info-value">
              {liveSyncHealthStatusLabel(liveSyncHealth)}
            </span>
          </div>
          <div className="backup-info-row">
            <span className="backup-info-label">上线前检查</span>
            <span className="backup-info-value" title={liveSyncLaunchReadiness(liveSyncHealth)?.summary || ''}>
              {liveSyncLaunchReadinessLabel(liveSyncHealth)}
            </span>
          </div>
          {liveSyncLaunchReadiness(liveSyncHealth) && (
            <div className={'settings-status-badge ' + liveSyncLaunchReadinessBadgeClass(liveSyncHealth)} style={{ marginTop: 6 }}>
              {liveSyncLaunchReadiness(liveSyncHealth)?.summary}
              {Array.isArray(liveSyncLaunchReadiness(liveSyncHealth)?.blockers) && liveSyncLaunchReadiness(liveSyncHealth).blockers.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {liveSyncLaunchReadiness(liveSyncHealth).blockers.slice(0, 3).map((item: string) => (
                    <div key={item}>阻止项：{item}</div>
                  ))}
                </div>
              )}
              {Array.isArray(liveSyncLaunchReadiness(liveSyncHealth)?.warnings) && liveSyncLaunchReadiness(liveSyncHealth).warnings.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {liveSyncLaunchReadiness(liveSyncHealth).warnings.slice(0, 3).map((item: string) => (
                    <div key={item}>提醒：{item}</div>
                  ))}
                </div>
              )}
              {Array.isArray(liveSyncLaunchReadiness(liveSyncHealth)?.actions) && liveSyncLaunchReadiness(liveSyncHealth).actions.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {liveSyncLaunchReadiness(liveSyncHealth).actions.slice(0, 3).map((item: string) => (
                    <div key={item}>建议：{item}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="backup-info-row">
            <span className="backup-info-label">服务器版本</span>
            <span className="backup-info-value">
              {liveSyncHealth?.server?.serverVersion || liveSyncHealth?.server?.version || '-'}
            </span>
          </div>
          <div className="backup-info-row">
            <span className="backup-info-label">网络安全模式</span>
            <span className="backup-info-value">
              {liveSyncHealth?.server?.security?.mode === 'public'
                ? (liveSyncHealth?.server?.security?.httpsRequired ? '公网严格模式 · HTTPS/WSS' : '公网模式配置异常')
                : (liveSyncHealth?.server?.security ? '局域网模式' : '-')}
            </span>
          </div>
          {liveSyncHealth?.server?.security?.mode === 'lan' && (
            <div className="settings-status-badge status-warn" style={{ marginTop: 6 }}>
              当前服务器不会强制 HTTPS。不要直接映射公网端口；公网使用时请部署 docker-compose.public.yml。
            </div>
          )}
          <div className="backup-info-row">
            <span className="backup-info-label">同步安全能力</span>
            <span className="backup-info-value" title={liveSyncMissingSafetyCapabilityLabels(liveSyncHealth).join(' / ')}>
              {liveSyncSafetyCompatibilityLabel(liveSyncHealth)}
            </span>
          </div>
          {liveSyncMissingSafetyCapabilityLabels(liveSyncHealth).length > 0 && (
            <div className="settings-status-badge status-error" style={{ marginTop: 6 }}>
              NAS 服务端缺少新版同步保护：{liveSyncMissingSafetyCapabilityLabels(liveSyncHealth).slice(0, 4).join('、')}。请覆盖上传最新 server 文件夹并重建容器。
            </div>
          )}
          <div className="backup-info-row">
            <span className="backup-info-label">存储后端</span>
            <span className="backup-info-value">
              {liveSyncHealth?.server?.storageBackend || '-'}
            </span>
          </div>
          <div className="backup-info-row">
            <span className="backup-info-label">运行时间</span>
            <span className="backup-info-value" title={liveSyncHealth?.server?.startedAt || ''}>
              {formatShortDuration(liveSyncHealth?.server?.uptimeSeconds)}
            </span>
          </div>
          <div className="backup-info-row">
            <span className="backup-info-label">Vault ID</span>
            <span className="backup-info-value" title={liveSyncHealth?.local?.vaultId || syncConfig?.remoteVaultId || ''}>
              {liveSyncHealth?.local?.vaultId || syncConfig?.remoteVaultId || '-'}
            </span>
          </div>
          <div className="backup-info-row">
            <span className="backup-info-label">在线设备</span>
            <span className="backup-info-value">
              {typeof liveSyncHealth?.server?.vaultClients === 'number' ? liveSyncHealth.server.vaultClients : '-'}
              {typeof liveSyncHealth?.server?.totalConnections === 'number' ? ` / 总连接 ${liveSyncHealth.server.totalConnections}` : ''}
            </span>
          </div>
          <div className="backup-info-row">
            <span className="backup-info-label">延迟</span>
            <span className="backup-info-value">{typeof liveSyncHealth?.local?.latencyMs === 'number' ? `${liveSyncHealth.local.latencyMs} ms` : '-'}</span>
          </div>
          <div className="backup-info-row">
            <span className="backup-info-label">最近心跳</span>
            <span className="backup-info-value" title={liveSyncHealth?.local?.lastPongAt || ''}>
              {liveSyncHealth?.local?.lastPongAt ? liveSyncHealth.local.lastPongAt.replace('T', ' ').substring(0, 19) : '-'}
            </span>
          </div>
          <div className="backup-info-row">
            <span className="backup-info-label">检查时间</span>
            <span className="backup-info-value" title={liveSyncHealth?.checkedAt || liveSyncHealth?.server?.serverTime || ''}>
              {liveSyncHealth?.checkedAt ? `${liveSyncHealth.checkedAt.replace('T', ' ').substring(11, 19)} · ${liveSyncHealth.durationMs || 0} ms` : '-'}
            </span>
          </div>
          <div className="backup-info-row">
            <span className="backup-info-label">最后同步</span>
            <span className="backup-info-value" title={liveSyncHealth?.local?.lastActivity?.relativePath || ''}>
              {liveSyncHealth?.local?.lastActivity ? `${liveSyncHealth.local.lastActivity.action}: ${liveSyncHealth.local.lastActivity.relativePath}` : '-'}
            </span>
          </div>
          <div className="backup-info-row">
            <span className="backup-info-label">{liveSyncHealthReasonLabel(liveSyncHealth)}</span>
            <span className="backup-info-value" title={liveSyncHealthMessages(liveSyncHealth).join('；')}>
              {liveSyncHealthMessages(liveSyncHealth).join('；') || '-'}
            </span>
          </div>
          {liveSyncServerClients.length > 0 && (
            <div className="server-client-list">
              {liveSyncServerClients.slice(0, 6).map((client: any) => {
                const safetyLevel = client.safetyLevel || 'warning';
                const webSocketStatus = client.webSocketStatus || 'online';
                const safetyMessages = Array.isArray(client.safetyMessages) ? client.safetyMessages : [];
                const lastAction = [client.lastAction || client.lastMessageType || 'connected', client.lastRelativePath || ''].filter(Boolean).join(': ');
                const connectionAge = webSocketStatus === 'offline'
                  ? (client.disconnectedAt ? `offline ${client.disconnectedAt.replace('T', ' ').substring(0, 19)}` : 'offline')
                  : (client.idleSeconds !== undefined ? `idle ${formatShortDuration(client.idleSeconds)}` : '');
                return (
                  <div className={'server-client-row ' + safetyLevel} key={client.clientKey || client.clientId}>
                    <span title={client.clientId}>
                      {client.deviceName || client.deviceId || client.clientId}
                      <b>{safetyLevel === 'ok' ? 'safe' : safetyLevel === 'danger' ? 'risk' : 'check'}</b>
                      <b>{webSocketStatus}</b>
                    </span>
                    <small title={safetyMessages.join('；')}>
                      {[
                        client.platform,
                        client.appVersion ? `v${client.appVersion}` : '版本未知',
                        client.protocolVersion ? `协议 ${client.protocolVersion}/${client.requiredProtocolVersion || '-'}` : '协议未知',
                        webSocketStatus,
                        connectionAge,
                      ].filter(Boolean).join(' / ')}
                    </small>
                    <small title={lastAction}>{lastAction || '-'}</small>
                    {client.lastRejectedReason && <small className="server-client-risk">拒绝写入：{client.lastRejectedReason}</small>}
                    {safetyMessages.length > 0 && <small className="server-client-risk">{safetyMessages[0]}</small>}
                  </div>
                );
              })}
              {liveSyncServerClients.length > 6 && (
                <div className="conflict-file-more">More devices: {liveSyncServerClients.length - 6}</div>
              )}
            </div>
          )}
          {liveSyncServerClientEvents.length > 0 && (
            <div className="server-client-list" style={{ marginTop: 8 }}>
              <div className="conflict-file-more">Recent sync events</div>
              {liveSyncServerClientEvents.slice(0, 6).map((event: any) => {
                const level = event.level || 'info';
                const eventLabel = [event.eventType || '-', event.action || '', event.relativePath || ''].filter(Boolean).join(': ');
                const actor = event.deviceName || event.deviceId || event.clientId || '-';
                return (
                  <div className={'server-client-row ' + (level === 'danger' ? 'danger' : level === 'warning' ? 'warning' : 'ok')} key={event.eventId || `${event.createdAt}-${actor}-${eventLabel}`}>
                    <span title={event.clientId || ''}>
                      {actor}
                      <b>{level}</b>
                    </span>
                    <small title={eventLabel}>{eventLabel}</small>
                    <small title={event.createdAt || ''}>{event.createdAt ? event.createdAt.replace('T', ' ').substring(0, 19) : '-'}</small>
                    {event.reason && <small className="server-client-risk">{event.reason}</small>}
                    {event.historyRevisionId && <small className="server-client-risk">history {String(event.historyRevisionId).slice(0, 18)}</small>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {(() => {
          const local = liveSyncHealth?.local || {};
          const serverAuthorityAdoption = local.serverAuthorityAdoption || null;
          const serverAuthorityAdoptionProtectedCount = Number(serverAuthorityAdoption?.protectedCount || 0);
          const queuedFiles = Array.isArray(local.queuedFiles) ? local.queuedFiles : [];
          const pendingRemoteFiles = Array.isArray(local.pendingRemoteFiles) ? local.pendingRemoteFiles : [];
          const safeDeleteQueue = liveSyncSafeDeleteQueue.length > 0
            ? liveSyncSafeDeleteQueue
            : (Array.isArray(local.safeDeleteQueueFiles)
              ? local.safeDeleteQueueFiles.map((relativePath: string) => ({ id: relativePath, relativePath }))
              : []);
          const aiDeleteQueueCount = safeDeleteQueue.filter((item: any) => item?.source === 'ai-delete').length;
          const recentIn = liveSyncActivity.filter((item: any) => item.direction === 'in').length;
          const recentOut = liveSyncActivity.filter((item: any) => item.direction === 'out').length;
          return (
            <div className="live-sync-queue-card">
              <div className="live-sync-queue-head">
                <div>
                  <div className="live-sync-queue-title">同步状态</div>
                  <div className="live-sync-queue-subtitle">正常情况下会自动同步；这里只在有待同步删除、暂停上传或近期事件时给出提示。</div>
                </div>
                <span className={'live-sync-queue-state ' + (liveSyncConnected ? 'online' : 'offline')}>
                  {liveSyncConnected ? '在线' : '离线'}
                </span>
              </div>
              <div className="live-sync-queue-stats">
                <span><strong>{queuedFiles.length || local.queuedFileCount || 0}</strong> 待上传</span>
                <span><strong>{pendingRemoteFiles.length || local.pendingRemoteApplyCount || 0}</strong> 应用中</span>
                <span><strong>{recentOut}</strong> 发出</span>
                <span><strong>{recentIn}</strong> 收到</span>
                {(local.uploadFrozen || local.preflightBlockedUploadCount) ? (
                  <span><strong>{local.uploadFrozen ? '暂停' : local.preflightBlockedUploadCount}</strong> 已暂停上传</span>
                ) : null}
                {local.deleteStormBlockedCount > 0 ? (
                  <span><strong>{local.deleteStormBlockedCount}</strong> 删除拦截</span>
                ) : null}
                {(safeDeleteQueue.length || local.safeDeleteQueueCount) ? (
                  <span><strong>{safeDeleteQueue.length || local.safeDeleteQueueCount || 0}</strong> 待同步删除</span>
                ) : null}
              </div>
              {serverAuthorityAdoptionProtectedCount > 0 && (
                <div className="settings-status-badge status-ok" style={{ marginTop: 8 }}>
                  已按服务器权威时间线安全加入：{serverAuthorityAdoptionProtectedCount} 个本机旧差异已收纳到同步恢复中心，服务器版本已成为当前基线。
                </div>
              )}
              {local.uploadFrozen && (
                <div className="settings-safety-note" style={{ marginTop: 8 }}>
                  同步前校验已暂停上传：{local.uploadFrozenReason || '等待服务器快照'}。本机队列会先保留，不会直接覆盖服务器。
                </div>
              )}
              {local.uploadFrozenReason === 'empty-server-initial-upload-blocked' && liveSyncConnectionMode === 'rebuild' && (
                <div className="team-server-status-actions" style={{ marginTop: 8 }}>
                  <button className="btn btn-primary" type="button" onClick={() => void trustLocalInitialLiveSyncUpload()}>
                    信任本机并初始化服务器
                  </button>
                  <span className="backup-info-meta">
                    仅当这台电脑是最新完整版本时使用；否则先恢复/切换正确 Vault ID。
                  </span>
                </div>
              )}
              {String(local.uploadFrozenReason || '').startsWith('stale-baseline-remote-ahead') && (
                <div className="team-server-status-actions" style={{ marginTop: 8 }}>
                  <button className="btn btn-primary" type="button" onClick={() => void resumeLiveSyncAfterStaleBaselineReview()}>
                    已检查，恢复后续上传
                  </button>
                  <span className="backup-info-meta">
                    旧待上传队列会被清空；旧本地差异可从冲突副本和 live-history 找回。
                  </span>
                </div>
              )}
              {liveSyncConnected && liveSyncConnectionMode === 'rebuild' && (
                <div className="team-server-status-actions" style={{ marginTop: 8 }}>
                  <button className="btn btn-secondary" type="button" onClick={() => void publishLocalAuthorityToLiveSyncServer()}>
                    以本机为准修复服务器
                  </button>
                  <span className="backup-info-meta">
                    管理员修复用：只在这台电脑确认是最新完整版本时执行，其他成员之后会自动跟随服务器。
                  </span>
                </div>
              )}
              {safeDeleteQueue.length > 0 && (
                <div className="settings-safety-note" style={{ marginTop: 8 }}>
                  <strong>待同步删除：{safeDeleteQueue.length} 项</strong>
                  <div style={{ marginTop: 6 }}>
                    {aiDeleteQueueCount > 0
                      ? `其中 ${aiDeleteQueueCount} 项来自 AI 本地删除。确认前不会删除服务器版本，可以随时清空队列撤销。`
                      : '这些文件在服务器上存在、但当前电脑没有。确认前不会删除服务器版本。'}
                  </div>
                  <div className="live-sync-queue-files" style={{ marginTop: 8 }}>
                    {safeDeleteQueue.slice(0, 5).map((item: any) => (
                      <div className="live-sync-queue-row" key={`safe-delete-${item.id || item.relativePath}`}>
                        <span className="live-sync-queue-dot out">!</span>
                        <span title={item.relativePath}>delete? · {item.relativePath}</span>
                        <small>{item.updatedAt ? String(item.updatedAt).replace('T', ' ').substring(0, 19) : ''}</small>
                      </div>
                    ))}
                    {safeDeleteQueue.length > 5 && (
                      <div className="conflict-file-more">还有 {safeDeleteQueue.length - 5} 项未显示</div>
                    )}
                  </div>
                  <div className="team-server-status-actions" style={{ marginTop: 8 }}>
                    <button
                      className="btn btn-danger"
                      type="button"
                      disabled={!!liveSyncSafeDeleteBusy || !liveSyncConnected}
                      onClick={() => void applyLiveSyncSafeDeleteQueue()}
                    >
                    {liveSyncSafeDeleteBusy === 'apply' ? '删除中...' : '同步删除'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={!!liveSyncSafeDeleteBusy}
                      onClick={() => void clearLiveSyncSafeDeleteQueue()}
                    >
                      {liveSyncSafeDeleteBusy === 'clear' ? '清空中...' : '清空队列'}
                    </button>
                  </div>
                </div>
              )}
              {String(local.uploadFrozenReason || '').startsWith('delete-storm-guard') && (
                <div className="team-server-status-actions" style={{ marginTop: 8 }}>
                  <button className="btn btn-primary" type="button" onClick={() => void resumeLiveSyncAfterDeleteStormReview()}>
                    已检查，放弃本批删除并恢复同步
                  </button>
                  <span className="backup-info-meta">
                    被拦截的删除不会继续上传；如需找回文件，请从 live-history 或服务器历史恢复。
                  </span>
                </div>
              )}
              {String(local.uploadFrozenReason || '').startsWith('destructive-truncation-guard') && (
                <div className="team-server-status-actions" style={{ marginTop: 8 }}>
                  <button className="btn btn-primary" type="button" onClick={() => void resumeLiveSyncAfterDestructiveTruncationReview()}>
                    已检查，放弃危险截断并恢复同步
                  </button>
                  <span className="backup-info-meta">
                    大文档突然变空或极小时会先暂停上传，避免空 GDD 扩散到其他电脑。
                  </span>
                </div>
              )}
              {!local.uploadFrozen && local.preflightBlockedUploadCount > 0 && (
                <div className="settings-safety-note" style={{ marginTop: 8 }}>
                  已阻止 {local.preflightBlockedUploadCount} 个没有服务器基线的本地文件自动上传。{Array.isArray(local.preflightBlockedUploadFiles) && local.preflightBlockedUploadFiles.length ? `示例：${local.preflightBlockedUploadFiles.slice(0, 3).join(', ')}` : ''}
                </div>
              )}
              {(queuedFiles.length > 0 || pendingRemoteFiles.length > 0) && (
                <div className="live-sync-queue-files">
                  {queuedFiles.slice(0, 5).map((item: any) => (
                    <div className="live-sync-queue-row" key={`queued-${item.relativePath}`}>
                      <span className="live-sync-queue-dot out">↑</span>
                      <span title={item.relativePath}>{item.action || 'update'} · {item.relativePath}</span>
                      <small>{item.queuedAt ? item.queuedAt.replace('T', ' ').substring(11, 19) : ''}</small>
                    </div>
                  ))}
                  {pendingRemoteFiles.slice(0, 5).map((item: any) => (
                    <div className="live-sync-queue-row" key={`pending-${item.relativePath}`}>
                      <span className="live-sync-queue-dot in">↓</span>
                      <span title={item.relativePath}>remote · {item.relativePath}</span>
                      <small>应用中</small>
                    </div>
                  ))}
                </div>
              )}
              {liveSyncActivity.length > 0 ? (
                <div className="live-sync-event-list">
                  {liveSyncActivity.slice(0, 10).map((item: any, idx: any) => (
                    <div key={`${item.timestamp}-${idx}`} className="live-sync-event-row">
                      <span className={'live-sync-queue-dot ' + (item.direction === 'in' ? 'in' : 'out')}>
                        {item.direction === 'in' ? '↓' : '↑'}
                      </span>
                      <span className="live-sync-event-action">{item.action}</span>
                      <span className="live-sync-event-file" title={item.relativePath}>{item.relativePath}</span>
                      <small>{item.timestamp.replace('T', ' ').substring(11, 19)}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="live-sync-queue-empty">暂无同步事件。编辑或连接另一台设备后会显示。</div>
              )}
            </div>
          );
        })()}

        <div className="live-sync-timeline-card">
          <div className="live-sync-queue-head">
            <div>
              <div className="live-sync-queue-title">同步时间线</div>
              <div className="live-sync-queue-subtitle">记录连接、健康检查、文件同步和冲突事件，方便判断哪一步出了问题。</div>
            </div>
            <button
              className="btn btn-secondary"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => {
                setLiveSyncTimeline([]);
                try { localStorage.removeItem(liveSyncTimelineStorageKey); } catch { /* ignore */ }
              }}
              disabled={!liveSyncTimeline.length}
            >
              清空
            </button>
          </div>
          {liveSyncTimeline.length > 0 ? (
            <div className="live-sync-timeline-list">
              {liveSyncTimeline.slice(0, 16).map((item: any) => (
                <div className={'live-sync-timeline-row ' + (item.status || 'info')} key={item.id}>
                  <span className="live-sync-timeline-line" />
                  <span className="live-sync-timeline-dot" />
                  <div className="live-sync-timeline-main">
                    <div className="live-sync-timeline-title">
                      <span>{item.title}</span>
                      <small>{item.timestamp ? item.timestamp.replace('T', ' ').substring(11, 19) : ''}</small>
                    </div>
                    {item.detail && (
                      <div className="live-sync-timeline-detail" title={item.detail}>{item.detail}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="live-sync-queue-empty">还没有同步事件。连接服务器、编辑文件或运行自检后会自动出现。</div>
          )}
        </div>
          </>
        )}
      </div>

      <div className="bl-section settings-card settings-section-live-sync settings-advanced-card">
        <div className="bl-section-header section-card-header">同步可靠性自检</div>
        <div className="settings-safety-note">
          自动创建一个临时测试文件，验证创建、修改、删除是否都能实时写入服务器快照。测试结束会清理本地测试文件。
        </div>
        <div className="live-sync-self-test-card">
          <div className="live-sync-self-test-head">
            <div>
              <div className="live-sync-queue-title">Live Sync Pipeline Test</div>
              <div className="live-sync-queue-subtitle">
                用来确认当前客户端、文件监听器、WebSocket 和服务器快照都在同一条链路上。
              </div>
            </div>
            <span className={'live-sync-queue-state ' + (liveSyncSelfTest?.ok ? 'online' : 'offline')}>
              {liveSyncSelfTesting ? '测试中' : (liveSyncSelfTest ? (liveSyncSelfTest.ok ? '通过' : '异常') : '未测试')}
            </span>
          </div>
          <div className="live-sync-queue-stats">
            <span><strong>{liveSyncSelfTest?.steps.filter((step: any) => step.ok).length || 0}</strong> 通过</span>
            <span><strong>{liveSyncSelfTest?.steps.filter((step: any) => !step.ok).length || 0}</strong> 失败</span>
            <span><strong>{liveSyncSelfTest?.durationMs ? `${liveSyncSelfTest.durationMs}ms` : '-'}</strong> 耗时</span>
          </div>
          {liveSyncSelfTest?.steps?.length ? (
            <div className="sync-self-test-steps">
              {liveSyncSelfTest.steps.map((step: any, idx: any) => (
                <div className={'sync-self-test-step ' + (step.ok ? 'ok' : 'fail')} key={`${step.name}-${idx}`}>
                  <span className="sync-self-test-dot">{step.ok ? '✓' : '!'}</span>
                  <span className="sync-self-test-name" title={step.name}>{liveSyncSelfTestStepLabel(step.name)}</span>
                  <span
                    className="sync-self-test-detail"
                    title={`${step.detail}\n${liveSyncSelfTestStepHint(step.name, step.ok)}`}
                  >
                    {step.detail}
                    <small>{liveSyncSelfTestStepHint(step.name, step.ok)}</small>
                  </span>
                  <small>{typeof step.durationMs === 'number' ? `${step.durationMs}ms` : ''}</small>
                </div>
              ))}
            </div>
          ) : (
            <div className="live-sync-queue-empty">连接 Live Sync 后点击自检，即可确认文件能否在多台设备间自动双向同步。</div>
          )}
          {liveSyncSelfTest?.testFile && (
            <div className="backup-info-meta" style={{ marginTop: 8 }} title={liveSyncSelfTest.testFile}>
              测试文件：{liveSyncSelfTest.testFile}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={runLiveSyncSelfTest} disabled={liveSyncSelfTesting || !liveSyncConnected}>
            {liveSyncSelfTesting ? '正在自检...' : '运行同步自检'}
          </button>
          <button className="btn btn-secondary" onClick={() => setLiveSyncSelfTest(null)} disabled={liveSyncSelfTesting || !liveSyncSelfTest}>
            清空结果
          </button>
          {!liveSyncConnected && (
            <div className="settings-status-badge status-error" style={{ marginTop: 0 }}>
              需要先连接 Live Sync
            </div>
          )}
        </div>
      </div>

      <div id="settings-live-sync-recovery" className="bl-section settings-card settings-section-recovery">
        <div className="bl-section-header section-card-header">同步清理</div>
        <div className="settings-safety-note">
          自动扫描 Live Sync 早期产生的 <code>*.conflict-*</code> 文件，并移入同步恢复中心；不会删除正常笔记，也不会丢失冲突内容。
        </div>
        <div className={'sync-recovery-card ' + (syncRecoveryOverview?.riskLevel || 'ok')}>
          <div className="sync-recovery-head">
            <div>
              <div className="sync-recovery-title">同步事故恢复中心</div>
              <div className="sync-recovery-sub">
                {syncRecoveryOverview?.checkedAt
                  ? `检查时间 ${syncRecoveryOverview.checkedAt.replace('T', ' ').substring(0, 19)}`
                  : '集中查看冲突、删除快照、覆盖历史和 AI 删除回收副本。'}
              </div>
            </div>
            <button className="btn btn-secondary btn-small" onClick={refreshSyncRecoveryOverview} disabled={syncRecoveryLoading}>
              {syncRecoveryLoading ? '检查中...' : '重新检查'}
            </button>
          </div>
          <div className="sync-recovery-grid">
            <button className="sync-recovery-metric" type="button" onClick={refreshConflictSummary}>
              <span>冲突副本</span>
              <strong>{syncRecoveryOverview?.conflict.count ?? conflictSummary?.count ?? '-'}</strong>
              <small>{syncRecoveryOverview ? formatBytes(syncRecoveryOverview.conflict.totalSize) : '可预览/合并/覆盖'}</small>
            </button>
            <button className="sync-recovery-metric" type="button" onClick={refreshLiveHistory}>
              <span>历史版本</span>
              <strong>{syncRecoveryOverview?.history.count ?? liveHistory.length}</strong>
              <small>删除快照 {syncRecoveryOverview?.history.deletedCount ?? '-'}</small>
            </button>
            <button
              className="sync-recovery-metric"
              type="button"
              onClick={() => {
                setServerLiveHistory(serverRecoveryHistory);
                setServerHistoryMessage(serverRecoveryError || `已载入服务器恢复历史：${serverRecoveryHistory.length} 条`);
              }}
            >
              <span>服务器历史</span>
              <strong>{serverRecoveryHistory.length || '-'}</strong>
              <small>删除 {serverRecoveryDeletedItems.length} / 拒绝 {serverRecoveryRejectedItems.length}</small>
            </button>
            <div className="sync-recovery-metric">
              <span>AI 删除回收</span>
              <strong>{syncRecoveryOverview?.aiTrash.count ?? '-'}</strong>
              <small>{syncRecoveryOverview ? formatBytes(syncRecoveryOverview.aiTrash.totalSize) : '删除前保留副本'}</small>
            </div>
            <div className="sync-recovery-metric">
              <span>受保护本地差异</span>
              <strong>{syncRecoveryOverview?.protectedLocal?.count ?? '-'}</strong>
              <small>{syncRecoveryOverview ? formatBytes(syncRecoveryOverview.protectedLocal?.totalSize || 0) : '服务器接管时保留'}</small>
            </div>
            <div className="sync-recovery-metric">
              <span>风险</span>
              <strong>{syncRecoveryOverview?.riskLevel === 'danger' ? '需处理' : syncRecoveryOverview?.riskLevel === 'watch' ? '观察' : '正常'}</strong>
              <small>{syncRecoveryMessage || '先运行检查'}</small>
            </div>
          </div>
          {syncRecoveryOverview?.recommendedActions?.length ? (
            <div className="sync-recovery-actions">
              {syncRecoveryOverview.recommendedActions.slice(0, 4).map((item: any) => (
                <div key={item}>- {item}</div>
              ))}
            </div>
          ) : null}
          <div className="sync-recovery-actions">
            <button
              className="btn btn-primary btn-small"
              onClick={runSafeRecoveryAutopilot}
              disabled={safeRecoveryAutopilotBusy || recoveryAdvisorBusy || !!recoveryAdvisorActionBusy || conflictCleaning}
              title="自动迁移可见冲突，并只应用高置信、可恢复的同步修复"
            >
              {safeRecoveryAutopilotBusy ? '安全整理中...' : '安全整理同步问题'}
            </button>
            <button
              className="btn btn-secondary btn-small"
              onClick={previewAccidentRecoveryPlan}
              disabled={accidentRecoveryBusy}
            >
              {accidentRecoveryBusy ? '生成中...' : '生成综合恢复向导'}
            </button>
            <button
              className="btn btn-primary btn-small"
              onClick={previewRecoveryAdvisorPlan}
              disabled={recoveryAdvisorBusy}
            >
              {recoveryAdvisorBusy ? '判断中...' : 'AI 智能判断版本'}
            </button>
            <button
              className="btn btn-primary btn-small"
              onClick={applyRecoveryAdvisorHighConfidence}
              disabled={recoveryAdvisorBusy || !!recoveryAdvisorActionBusy}
            >
              {recoveryAdvisorActionBusy === '__batch__' ? '处理中...' : '一键应用高置信'}
            </button>
            <button
              className="btn btn-primary btn-small"
              onClick={runRecommendedAccidentRecovery}
              disabled={accidentRecoveryBusy}
            >
              执行推荐恢复
            </button>
            <span>
              {accidentRecoveryPlan
                ? `综合计划：冲突 ${accidentRecoveryPlan.summary.conflictCount} / 服务器可恢复 ${accidentRecoveryPlan.summary.serverRestoreCount} / 本地可恢复 ${accidentRecoveryPlan.summary.localRestoreCount}`
                : '汇总冲突、本地历史、服务器历史和 AI 回收，先给出恢复顺序'}
            </span>
          </div>
          {safeRecoveryAutopilotMessage && (
            <div className={'settings-status-badge ' + (safeRecoveryAutopilotMessage.includes('失败') ? 'status-error' : 'status-ok')} style={{ marginTop: 8 }}>
              {safeRecoveryAutopilotMessage}
            </div>
          )}
          {accidentRecoveryPlan?.actions?.length ? (
            <div className="sync-recovery-recent">
              <div className="sync-recovery-title small">综合恢复向导</div>
              {accidentRecoveryPlan.actions.slice(0, 5).map((action: any) => (
                <div className="conflict-file-row" key={`accident-${action.source}-${action.priority}`}>
                  <div className="conflict-file-main">
                    <span className="conflict-file-name">{action.recommended ? '建议：' : ''}{action.title}</span>
                    <span className="conflict-file-meta">
                      {action.detail}{action.files.length ? ` 示例：${action.files.slice(0, 3).join(', ')}` : ''}
                    </span>
                  </div>
                  <div className="conflict-file-actions">
                    <span className="backup-info-meta">{action.count} 项</span>
                  </div>
                </div>
              ))}
              {accidentRecoveryPlan.warnings.map((warning: any) => (
                <div className="conflict-file-more" key={warning}>{warning}</div>
              ))}
            </div>
          ) : null}
          {accidentRecoveryMessage && (
            <div className={'settings-status-badge ' + (accidentRecoveryMessage.includes('失败') ? 'status-error' : 'status-ok')} style={{ marginTop: 8 }}>
              {accidentRecoveryMessage}
            </div>
          )}
          {recoveryAdvisorPlan?.items?.length ? (
            <div className="sync-recovery-recent">
              <div className="sync-recovery-title small">AI 智能恢复建议</div>
              <div className="conflict-file-more">
                已分析 {recoveryAdvisorPlan.summary.totalFiles} 个文件；可一键恢复 {recoveryAdvisorPlan.summary.applyReadyCount} 个；需要合并/检查 {recoveryAdvisorPlan.summary.reviewCount} 个。
              </div>
              {recoveryAdvisorPlan.items.slice(0, 8).map((item: any) => (
                <div className="conflict-file-row" key={`advisor-${item.relativePath}-${item.recommendedAction}`}>
                  <div className="conflict-file-main">
                    <span className="conflict-file-name" title={item.relativePath}>
                      {item.relativePath}
                    </span>
                    <span className="conflict-file-meta">
                      {item.recommendedLabel} · 置信度 {item.confidence} · {item.reason}
                    </span>
                    <div className="recovery-decision-panel">
                      <div className="recovery-decision-picked">
                        <span>推荐保留</span>
                        <strong>{item.candidate ? formatRecoveryCandidateHeadline(item.candidate) : item.recommendedLabel}</strong>
                        <small>{item.recommendedLabel}</small>
                      </div>
                      <div className="recovery-version-grid">
                        {item.candidates.slice(0, 5).map((candidate: any, idx: any) => {
                          const role = recoveryCandidateRole(candidate);
                          const recommended = isRecoveryCandidateRecommended(item, candidate);
                          return (
                            <div
                              className={`recovery-version-card ${role.className}${recommended ? ' recommended' : ''}`}
                              key={`${item.relativePath}-${candidate.source}-${candidate.versionId || candidate.revisionId || candidate.recoveryRelativePath || idx}`}
                              title={[
                                candidate.relativePath,
                                candidate.reason,
                                candidate.tombstoneExpiresAt ? `tombstone expires ${candidate.tombstoneExpiresAt}` : '',
                                formatRecoveryCandidateMeta(candidate),
                              ].filter(Boolean).join('\n')}
                            >
                              <span>{role.label}</span>
                              <strong>{formatRecoveryCandidateHeadline(candidate)}</strong>
                              <small>{formatRecoveryCandidateMeta(candidate)}</small>
                              {recommended && <b>推荐</b>}
                            </div>
                          );
                        })}
                      </div>
                      {item.candidates.length > 5 && (
                        <div className="conflict-file-more">还有 {item.candidates.length - 5} 个候选版本未显示。</div>
                      )}
                    </div>
                  </div>
                  <div className="conflict-file-actions">
                    {item.canApply ? (
                      <button
                        className="btn btn-primary btn-small"
                        onClick={() => applyRecoveryAdvisorItem(item)}
                        disabled={!!recoveryAdvisorActionBusy}
                      >
                        {recoveryAdvisorActionBusy === item.relativePath ? '应用中...' : '应用推荐'}
                      </button>
                    ) : (
                      <span className="backup-info-meta">需人工检查</span>
                    )}
                  </div>
                </div>
              ))}
              {recoveryAdvisorPlan.items.length > 8 && (
                <div className="conflict-file-more">还有 {recoveryAdvisorPlan.items.length - 8} 个智能建议未显示。</div>
              )}
              {recoveryAdvisorPlan.warnings.map((warning: any) => (
                <div className="conflict-file-more" key={`advisor-warning-${warning}`}>{warning}</div>
              ))}
            </div>
          ) : null}
          {recoveryAdvisorMessage && (
            <div className={'settings-status-badge ' + (recoveryAdvisorMessage.includes('失败') ? 'status-error' : 'status-ok')} style={{ marginTop: 8 }}>
              {recoveryAdvisorMessage}
            </div>
          )}
          <div className="sync-recovery-actions">
            <button
              className="btn btn-secondary btn-small"
              onClick={previewBatchRestoreFromLiveHistory}
              disabled={batchRestoreBusy}
            >
              {batchRestoreBusy ? '处理中...' : '生成 48h 事故恢复计划'}
            </button>
            <button
              className="btn btn-primary btn-small"
              onClick={runBatchRestoreFromLiveHistory}
              disabled={batchRestoreBusy || !batchRestorePlan?.restoreCount}
            >
              执行恢复计划
            </button>
            <span>
              {batchRestorePlan
                ? `计划：可恢复 ${batchRestorePlan.restoreCount} 个，跳过 ${batchRestorePlan.skippedCount} 个`
                : '从本地 live-history 批量恢复事故相关版本'}
            </span>
          </div>
          {batchRestorePlan?.items?.length ? (
            <div className="sync-recovery-recent">
              <div className="sync-recovery-title small">批量恢复计划预览</div>
              {batchRestorePlan.items.slice(0, 5).map((item: any) => (
                <div className="conflict-file-row" key={`batch-restore-${item.relativePath}-${item.versionId}`}>
                  <div className="conflict-file-main">
                    <span className="conflict-file-name" title={item.relativePath}>{item.relativePath}</span>
                    <span className="conflict-file-meta">
                      {item.action === 'restore' ? '将恢复' : `跳过：${item.skipReason || '-'}`} · {formatHistoryReason(item.reason)} · {item.savedAt ? item.savedAt.replace('T', ' ').substring(0, 19) : item.versionId}
                    </span>
                  </div>
                  <div className="conflict-file-actions">
                    <button className="btn btn-secondary btn-small" onClick={() => handlePreviewHistory(item)} disabled={historyPreviewLoading || !!historyActionBusy}>预览</button>
                  </div>
                </div>
              ))}
              {batchRestorePlan.items.length > 5 && (
                <div className="conflict-file-more">还有 {batchRestorePlan.items.length - 5} 个恢复计划项未显示。</div>
              )}
              {batchRestorePlan.warnings.map((warning: any) => (
                <div className="conflict-file-more" key={warning}>{warning}</div>
              ))}
            </div>
          ) : null}
          {batchRestoreMessage && (
            <div className={'settings-status-badge ' + (batchRestoreMessage.includes('失败') ? 'status-error' : 'status-ok')} style={{ marginTop: 8 }}>
              {batchRestoreMessage}
            </div>
          )}
          <div className="sync-recovery-actions">
            <button
              className="btn btn-secondary btn-small"
              onClick={previewServerBatchRestoreFromLiveHistory}
              disabled={serverBatchRestoreBusy}
            >
              {serverBatchRestoreBusy ? '处理中...' : '生成服务器 48h 恢复计划'}
            </button>
            <button
              className="btn btn-primary btn-small"
              onClick={runServerBatchRestoreFromLiveHistory}
              disabled={serverBatchRestoreBusy || !serverBatchRestorePlan?.restoreCount}
            >
              执行服务器恢复
            </button>
            <span>
              {serverBatchRestorePlan
                ? `服务器计划：可恢复 ${serverBatchRestorePlan.restoreCount} 个，跳过 ${serverBatchRestorePlan.skippedCount} 个`
                : '从 NAS server history 批量恢复事故相关版本'}
            </span>
          </div>
          {serverBatchRestorePlan?.items?.length ? (
            <div className="sync-recovery-recent">
              <div className="sync-recovery-title small">服务器批量恢复计划预览</div>
              {serverBatchRestorePlan.items.slice(0, 5).map((item: any) => (
                <div className="conflict-file-row" key={`server-batch-restore-${item.relativePath}-${item.versionId}`}>
                  <div className="conflict-file-main">
                    <span className="conflict-file-name" title={item.relativePath}>{item.relativePath}</span>
                    <span className="conflict-file-meta">
                      {item.action === 'restore' ? '将恢复' : `跳过：${item.skipReason || '-'}`} · {formatHistoryReason(item.reason)} · {item.savedAt ? item.savedAt.replace('T', ' ').substring(0, 19) : item.versionId}
                    </span>
                  </div>
                  <div className="conflict-file-actions">
                    <button className="btn btn-secondary btn-small" onClick={() => handlePreviewServerHistory(item)} disabled={historyPreviewLoading || !!historyActionBusy}>预览</button>
                  </div>
                </div>
              ))}
              {serverBatchRestorePlan.items.length > 5 && (
                <div className="conflict-file-more">还有 {serverBatchRestorePlan.items.length - 5} 个服务器恢复计划项未显示。</div>
              )}
              {serverBatchRestorePlan.warnings.map((warning: any) => (
                <div className="conflict-file-more" key={warning}>{warning}</div>
              ))}
            </div>
          ) : null}
          {serverBatchRestoreMessage && (
            <div className={'settings-status-badge ' + (serverBatchRestoreMessage.includes('失败') ? 'status-error' : 'status-ok')} style={{ marginTop: 8 }}>
              {serverBatchRestoreMessage}
            </div>
          )}
          <div className="sync-recovery-actions">
            <button
              className="btn btn-secondary btn-small"
              onClick={refreshServerSnapshots}
              disabled={!!serverSnapshotBusy}
            >
              {serverSnapshotBusy === 'list' ? '读取中...' : '读取服务器安全快照'}
            </button>
            <button
              className="btn btn-secondary btn-small"
              onClick={createServerSnapshotNow}
              disabled={!!serverSnapshotBusy}
            >
              {serverSnapshotBusy === 'create' ? '创建中...' : '立即创建服务器快照'}
            </button>
            <button
              className="btn btn-secondary btn-small"
              onClick={exportServerBackupToLocal}
              disabled={!!serverSnapshotBusy}
            >
              {serverSnapshotBusy === 'export' ? '导出中...' : '导出服务器完整备份'}
            </button>
            <span>
              {serverSnapshots.length
                ? `服务器快照 ${serverSnapshots.length} 个，最新 ${serverSnapshots[0]?.exportedAt?.replace('T', ' ').substring(0, 19) || serverSnapshots[0]?.fileName}`
                : '完整服务器快照用于 live-history 找不到时兜底恢复'}
            </span>
          </div>
          {(serverSnapshots.length > 0 || serverSnapshotFiles.length > 0 || serverSnapshotMessage) && (
            <div className="sync-recovery-recent">
              <div className="sync-recovery-title small">服务器完整快照恢复</div>
              <div className="server-snapshot-tools">
                <select value={serverSnapshotSelected} onChange={(event) => setServerSnapshotSelected(event.target.value)}>
                  {!serverSnapshots.length && <option value="">使用服务器最新快照</option>}
                  {serverSnapshots.map((snapshot: any) => (
                    <option key={snapshot.fileName} value={snapshot.fileName}>
                      {snapshot.exportedAt ? snapshot.exportedAt.replace('T', ' ').substring(0, 19) : snapshot.fileName} · {formatBytes(snapshot.size)}
                    </option>
                  ))}
                </select>
                <input
                  value={serverSnapshotQuery}
                  onChange={(event) => setServerSnapshotQuery(event.target.value)}
                  placeholder={currentFileRel ? `留空搜索当前文件：${currentFileRel}` : '输入文件名/路径关键词'}
                />
                <button className="btn btn-secondary btn-small" onClick={searchServerSnapshotFiles} disabled={!!serverSnapshotBusy}>
                  {serverSnapshotBusy === 'files' ? '搜索中...' : '搜索快照文件'}
                </button>
              </div>
              {serverSnapshotFiles.slice(0, 8).map((item: any) => {
                const sourceLabel = item.source === 'live-history'
                  ? '历史'
                  : item.source === 'backup'
                    ? '备份'
                    : '实时';
                const busyKey = `restore:${item.relativePath}:${item.revisionId || item.backupId || item.source}`;
                return (
                  <div className="conflict-file-row" key={`server-snapshot-${item.relativePath}-${item.source}-${item.revisionId || item.backupId || item.updatedAt}`}>
                    <div className="conflict-file-main">
                      <span className="conflict-file-name" title={item.relativePath}>{item.relativePath}</span>
                      <span className="conflict-file-meta">
                        {sourceLabel} · {item.deleted ? '删除记录' : '可恢复'} · {item.updatedAt ? item.updatedAt.replace('T', ' ').substring(0, 19) : item.recordedAt || '-'} · {formatBytes(item.size)}
                      </span>
                    </div>
                    <div className="conflict-file-actions">
                      <button
                        className="btn btn-primary btn-small"
                        onClick={() => restoreServerSnapshotCandidate(item)}
                        disabled={!!serverSnapshotBusy || !item.contentAvailable || !!item.deleted}
                      >
                        {serverSnapshotBusy === busyKey ? '恢复中...' : '恢复'}
                      </button>
                    </div>
                  </div>
                );
              })}
              {serverSnapshotFiles.length > 8 && (
                <div className="conflict-file-more">还有 {serverSnapshotFiles.length - 8} 个服务器快照文件版本未显示，请缩小关键词。</div>
              )}
              {serverSnapshotMessage && (
                <div className={'settings-status-badge ' + (serverSnapshotMessage.includes('失败') ? 'status-error' : 'status-ok')} style={{ marginTop: 8 }}>
                  {serverSnapshotMessage}
                </div>
              )}
            </div>
          )}
          {syncRecoveryOverview?.history.deletedRecent?.length ? (
            <div className="sync-recovery-recent">
              <div className="sync-recovery-title small">最近删除快照</div>
              {syncRecoveryOverview.history.deletedRecent.slice(0, 3).map((item: any) => (
                <div className="conflict-file-row" key={`deleted-${item.relativePath}-${item.versionId}`}>
                  <div className="conflict-file-main">
                    <span className="conflict-file-name" title={item.relativePath}>{item.relativePath}</span>
                    <span className="conflict-file-meta">{item.savedAt ? item.savedAt.replace('T', ' ').substring(0, 19) : item.versionId} · {formatBytes(item.size)}</span>
                  </div>
                  <div className="conflict-file-actions">
                    <button className="btn btn-secondary btn-small" onClick={() => handlePreviewHistory(item)} disabled={historyPreviewLoading || !!historyActionBusy}>预览</button>
                    <button className="btn btn-primary btn-small" onClick={() => handleRestoreHistory(item)} disabled={!!historyActionBusy || historyPreviewLoading}>恢复</button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {serverRecoveryDeletedRecent.length ? (
            <div className="sync-recovery-recent">
              <div className="sync-recovery-title small">服务器最近删除快照</div>
              {serverRecoveryDeletedRecent.slice(0, 4).map((item: any) => (
                <div className="conflict-file-row" key={`server-deleted-${item.relativePath}-${item.versionId}`}>
                  <div className="conflict-file-main">
                    <span className="conflict-file-name" title={item.relativePath}>{item.relativePath}</span>
                    <span className="conflict-file-meta">{item.savedAt ? item.savedAt.replace('T', ' ').substring(0, 19) : item.versionId} · {formatBytes(item.size)}</span>
                  </div>
                  <div className="conflict-file-actions">
                    <button className="btn btn-secondary btn-small" onClick={() => handlePreviewServerHistory(item)} disabled={historyPreviewLoading || !!historyActionBusy}>预览</button>
                    <button className="btn btn-primary btn-small" onClick={() => handleRestoreServerHistory(item)} disabled={!!historyActionBusy || historyPreviewLoading}>恢复</button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {serverRecoveryRejectedRecent.length ? (
            <div className="sync-recovery-recent">
              <div className="sync-recovery-title small">服务器最近拒绝写入</div>
              {serverRecoveryRejectedRecent.slice(0, 4).map((item: any) => (
                <div className="conflict-file-row" key={`server-rejected-${item.relativePath}-${item.versionId}`}>
                  <div className="conflict-file-main">
                    <span className="conflict-file-name" title={item.relativePath}>{item.relativePath}</span>
                    <span className="conflict-file-meta">{formatHistoryReason(item.reason)} · {item.savedAt ? item.savedAt.replace('T', ' ').substring(0, 19) : item.versionId}</span>
                  </div>
                  <div className="conflict-file-actions">
                    <button className="btn btn-secondary btn-small" onClick={() => handlePreviewServerHistory(item)} disabled={historyPreviewLoading || !!historyActionBusy}>预览</button>
                    <button className="btn btn-primary btn-small" onClick={() => handleRestoreServerHistory(item)} disabled={!!historyActionBusy || historyPreviewLoading || item.deletedSnapshot}>恢复</button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {syncRecoveryOverview?.protectedLocal?.files?.length ? (
            <div className="sync-recovery-recent">
              <div className="sync-recovery-title small">受保护本地差异</div>
              {syncRecoveryOverview.protectedLocal.files.slice(0, 5).map((item: any) => (
                <div className="conflict-file-row" key={`protected-local-${item.relativePath}`}>
                  <div className="conflict-file-main">
                    <span className="conflict-file-name" title={item.relativePath}>
                      {item.originalRelativePath || item.relativePath}
                    </span>
                    <span className="conflict-file-meta">
                      {item.modifiedAt ? item.modifiedAt.replace('T', ' ').substring(0, 19) : '-'} · {formatBytes(item.size)}
                      {item.reason ? ` · ${item.reason}` : ''}
                    </span>
                  </div>
                  <div className="conflict-file-actions">
                    <button
                      className="btn btn-primary btn-small"
                      onClick={() => handleRestoreProtectedLocalRecoveryFile(item)}
                      disabled={!!protectedLocalActionBusy}
                    >
                      {protectedLocalActionBusy === item.relativePath ? '恢复中...' : '恢复'}
                    </button>
                  </div>
                </div>
              ))}
              {syncRecoveryOverview.protectedLocal.files.length > 5 && (
                <div className="conflict-file-more">还有 {syncRecoveryOverview.protectedLocal.files.length - 5} 个受保护本地差异未显示。</div>
              )}
            </div>
          ) : null}
          {syncRecoveryOverview?.aiTrash.files?.length ? (
            <div className="sync-recovery-recent">
              <div className="sync-recovery-title small">AI 删除回收副本</div>
              {syncRecoveryOverview.aiTrash.files.slice(0, 5).map((item: any) => (
                <div className="conflict-file-row" key={`ai-trash-${item.relativePath}`}>
                  <div className="conflict-file-main">
                    <span className="conflict-file-name" title={item.originalRelativePath || item.relativePath}>
                      {item.originalRelativePath || item.relativePath}
                    </span>
                    <span className="conflict-file-meta">
                      {item.modifiedAt ? item.modifiedAt.replace('T', ' ').substring(0, 19) : '-'} · {formatBytes(item.size)}
                    </span>
                  </div>
                  <div className="conflict-file-actions">
                    <button
                      className="btn btn-primary btn-small"
                      onClick={() => handleRestoreAiTrashFile(item)}
                      disabled={!!aiTrashActionBusy}
                    >
                      {aiTrashActionBusy === item.relativePath ? '恢复中...' : '恢复'}
                    </button>
                  </div>
                </div>
              ))}
              {syncRecoveryOverview.aiTrash.files.length > 5 && (
                <div className="conflict-file-more">还有 {syncRecoveryOverview.aiTrash.files.length - 5} 个 AI 删除回收副本未显示。</div>
              )}
            </div>
          ) : null}
          {aiTrashMessage && (
            <div className={'settings-status-badge ' + (aiTrashMessage.includes('失败') ? 'status-error' : 'status-ok')} style={{ marginTop: 8 }}>
              {aiTrashMessage}
            </div>
          )}
          {protectedLocalMessage && (
            <div className={'settings-status-badge ' + (protectedLocalMessage.includes('失败') ? 'status-error' : 'status-ok')} style={{ marginTop: 8 }}>
              {protectedLocalMessage}
            </div>
          )}
        </div>

        <div className="backup-info-card">
          <div className="backup-info-row">
            <span className="backup-info-label">冲突文件</span>
            <span className="backup-info-value">
              {conflictSummary ? `${conflictSummary.count} 个，${formatBytes(conflictSummary.totalSize)}` : '未扫描'}
            </span>
          </div>
          {conflictSummary?.files?.length ? (
            <div className="conflict-file-list">
              {conflictSummary.files.slice(0, 12).map((file: any) => {
                const applyBusy = conflictActionBusy === `apply:${file.relativePath}`;
                const latestBusy = conflictActionBusy === `latest:${file.relativePath}`;
                const deleteBusy = conflictActionBusy === `delete:${file.relativePath}`;
                const isActive = conflictPreview?.conflictRelativePath === file.relativePath;
                const displayPath = file.originalRelativePath || file.relativePath;
                return (
                  <div className={'conflict-file-row ' + (isActive ? 'active' : '')} key={file.relativePath}>
                    <div className="conflict-file-main">
                      <span className="conflict-file-name" title={file.relativePath}>{displayPath}</span>
                      <span className="conflict-file-meta">
                        {formatBytes(file.size)}
                        {file.modifiedAt ? ` · ${file.modifiedAt.replace('T', ' ').substring(0, 19)}` : ''}
                        {file.hiddenRecoveryCopy ? ' · 恢复中心' : ''}
                      </span>
                    </div>
                    <div className="conflict-file-actions">
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => handlePreviewConflict(file.relativePath)}
                        disabled={conflictPreviewLoading || !!conflictActionBusy}
                      >
                        {conflictPreviewLoading && isActive ? '读取中...' : '查看'}
                      </button>
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => handleApplyConflict(file.relativePath)}
                        disabled={!!conflictActionBusy || conflictScanning || conflictCleaning}
                      >
                        {applyBusy ? '使用中...' : '使用'}
                      </button>
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => handleResolveConflictLatest(file.relativePath)}
                        disabled={!!conflictActionBusy || conflictScanning || conflictCleaning}
                      >
                        {latestBusy ? '处理中...' : '最新为准'}
                      </button>
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => handleCreateConflictMergeDraft(file.relativePath)}
                        disabled={!!conflictActionBusy || conflictScanning || conflictCleaning}
                      >
                        {conflictActionBusy === `draft:${file.relativePath}` ? '生成中...' : '智能合并'}
                      </button>
                      <button
                        className="btn btn-danger btn-small"
                        onClick={() => handleDeleteConflict(file.relativePath)}
                        disabled={!!conflictActionBusy || conflictScanning || conflictCleaning}
                      >
                        {deleteBusy ? '删除中...' : '删除'}
                      </button>
                    </div>
                  </div>
                );
              })}
              {conflictSummary.files.length > 12 && (
                <div className="conflict-file-more">还有 {conflictSummary.files.length - 12} 个冲突副本未显示，可先处理或一键移入恢复中心。</div>
              )}
            </div>
          ) : (
            <div className="backup-info-meta">暂无冲突副本。</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn btn-secondary" onClick={refreshConflictSummary} disabled={conflictScanning || conflictCleaning || !!conflictActionBusy}>
            {conflictScanning ? '扫描中...' : '扫描冲突文件'}
          </button>
          <button
            className="btn btn-primary"
            disabled={!conflictSummary?.files?.some((file: any) => !file.hiddenRecoveryCopy) || conflictScanning || conflictCleaning || !!conflictActionBusy}
            onClick={async () => {
              const count = conflictSummary?.files?.filter((file: any) => !file.hiddenRecoveryCopy).length || 0;
              const confirmed = await showConfirm(
                '移入恢复中心',
                `将把 ${count} 个 *.conflict-* 冲突副本移入同步恢复中心，正常笔记不会被删除，冲突内容仍可预览/恢复。确定继续吗？`,
              );
              if (!confirmed) {
                setConflictMessage('已取消清理。');
                return;
              }
              const api = (window as any).arsnote;
              setConflictCleaning(true);
              setConflictMessage('正在把冲突副本移入恢复中心...');
              try {
                const result = await api.cleanupSyncConflicts(vaultPath);
                setConflictPreview(null);
                const archivedCount = result.archivedCount ?? result.deletedCount ?? 0;
                const archivedSize = result.archivedSize ?? result.deletedSize ?? 0;
                const archivePath = result.archiveRelativePath ? `，位置：${result.archiveRelativePath}` : '';
                setConflictMessage(`已将 ${archivedCount} 个冲突副本移入恢复中心，大小 ${formatBytes(archivedSize)}${archivePath}。`);
                await refreshConflictSummary();
                await refreshSyncRecoveryOverview();
              } catch (err: any) {
                setConflictMessage(err.message || '清理失败');
              } finally {
                setConflictCleaning(false);
              }
            }}
          >
            {conflictCleaning ? '迁移中...' : '移入恢复中心'}
          </button>
        </div>
        {conflictPreviewLoading && !conflictPreview && (
          <div className="conflict-diff-card">
            <div className="conflict-diff-title">正在读取冲突差异...</div>
          </div>
        )}
        {conflictPreview && (
          <div className="conflict-diff-card">
            <div className="conflict-diff-head">
              <div>
                <div className="conflict-diff-title">冲突差异预览</div>
                <div className="conflict-diff-meta" title={conflictPreview.baseRelativePath}>
                  原文件：{conflictPreview.baseRelativePath}
                </div>
                <div className="conflict-diff-meta" title={conflictPreview.conflictRelativePath}>
                  冲突副本：{conflictPreview.conflictRelativePath}
                </div>
              </div>
              <button className="btn btn-secondary btn-small" onClick={() => setConflictPreview(null)}>关闭</button>
            </div>
            <div className="conflict-diff-stats">
              <span>{conflictPreview.baseExists ? '原文件存在' : '原文件不存在'}</span>
              <span>差异行：{conflictPreview.diff.changedLines}</span>
              <span>首次差异：{conflictPreview.diff.firstChangedLine ? `第 ${conflictPreview.diff.firstChangedLine} 行` : '-'}</span>
            </div>
            {(conflictPreview.baseTruncated || conflictPreview.conflictTruncated) && (
              <div className="conflict-diff-note">文件较大，预览只显示前 256 KB，处理操作仍会使用完整文件。</div>
            )}
            <div className="conflict-diff-actions">
              <button
                className="btn btn-primary"
                onClick={() => handleApplyConflict(conflictPreview.conflictRelativePath)}
                disabled={!!conflictActionBusy || conflictScanning || conflictCleaning}
              >
                {conflictActionBusy === `apply:${conflictPreview.conflictRelativePath}` ? '使用中...' : '使用冲突版本覆盖原文件'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => handleResolveConflictLatest(conflictPreview.conflictRelativePath)}
                disabled={!!conflictActionBusy || conflictScanning || conflictCleaning}
              >
                {conflictActionBusy === `latest:${conflictPreview.conflictRelativePath}` ? '处理中...' : '以最新版本为准'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => handleCreateConflictMergeDraft(conflictPreview.conflictRelativePath)}
                disabled={!!conflictActionBusy || conflictScanning || conflictCleaning}
              >
                {conflictActionBusy === `draft:${conflictPreview.conflictRelativePath}` ? '生成中...' : '生成智能合并草稿'}
              </button>
              <button
                className="btn btn-danger"
                onClick={() => handleDeleteConflict(conflictPreview.conflictRelativePath)}
                disabled={!!conflictActionBusy || conflictScanning || conflictCleaning}
              >
                {conflictActionBusy === `delete:${conflictPreview.conflictRelativePath}` ? '删除中...' : '删除这个冲突副本'}
              </button>
            </div>
            <div className="conflict-merge-card">
              <div className="conflict-diff-head">
                <div>
                  <div className="conflict-diff-title">手动合并结果</div>
                  <div className="conflict-diff-meta">可以先点“生成智能合并草稿”，系统会把建议合并结果填到这里；确认后再保存回原文件。</div>
                </div>
                <span className="conflict-merge-badge">
                  {conflictPreview.baseTruncated || conflictPreview.conflictTruncated ? '预览截断' : '可保存'}
                </span>
              </div>
              {(conflictPreview.baseTruncated || conflictPreview.conflictTruncated) ? (
                <div className="conflict-diff-note">当前文件太大，预览内容被截断。为了避免误保存半截文件，这里只允许生成合并草稿后手动处理。</div>
              ) : (
                <>
                  <div className="conflict-diff-actions">
                    <button className="btn btn-secondary btn-small" onClick={() => setConflictMergeText(conflictPreview.baseContent)}>
                      填入原文件
                    </button>
                    <button className="btn btn-secondary btn-small" onClick={() => setConflictMergeText(conflictPreview.conflictContent)}>
                      填入冲突副本
                    </button>
                    <label className="conflict-merge-check">
                      <input
                        type="checkbox"
                        checked={conflictMergeDeleteAfterSave}
                        onChange={(event) => setConflictMergeDeleteAfterSave(event.target.checked)}
                      />
                      保存后删除冲突副本
                    </label>
                  </div>
                  <textarea
                    className="conflict-merge-textarea"
                    value={conflictMergeText}
                    onChange={(event) => setConflictMergeText(event.target.value)}
                    spellCheck={false}
                  />
                  <div className="conflict-diff-actions">
                    <button
                      className="btn btn-primary"
                      onClick={handleSaveConflictMergeResult}
                      disabled={!!conflictActionBusy || conflictScanning || conflictCleaning}
                    >
                      {conflictActionBusy === `merge:${conflictPreview.conflictRelativePath}` ? '保存中...' : '保存合并结果'}
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className="conflict-diff-grid">
              <div className="conflict-diff-pane">
                <div className="conflict-diff-pane-title">当前原文件</div>
                <pre>{conflictPreview.baseExists ? (conflictPreview.baseContent || '空文件') : '原文件不存在'}</pre>
              </div>
              <div className="conflict-diff-pane">
                <div className="conflict-diff-pane-title">冲突副本</div>
                <pre>{conflictPreview.conflictContent || '空文件'}</pre>
              </div>
            </div>
          </div>
        )}
        {conflictMessage && (
          <div className={'settings-status-badge ' + (conflictMessage.includes('失败') ? 'status-error' : 'status-ok')} style={{ marginTop: 8 }}>
            {conflictMessage}
          </div>
        )}
      </div>

      <div className="bl-section settings-card settings-section-recovery">
        <div className="bl-section-header section-card-header">版本历史</div>
        <div className="settings-safety-note">
          查看当前文件的最近版本。需要服务器历史、误删快照和详细差异时再展开高级版本历史。
        </div>
        <div className="backup-info-card">
          <div className="backup-info-row">
            <span className="backup-info-label">当前文件</span>
            <span className="backup-info-value" title={currentFileRel}>{currentFileRel || '-'}</span>
          </div>
          {historyLoading && <div className="backup-info-meta">正在读取版本历史...</div>}
          {!historyLoading && liveHistory.length === 0 && (
            <div className="backup-info-meta">暂无历史版本。保存、同步覆盖或删除文件前会自动出现。</div>
          )}
          {!historyLoading && liveHistory.slice(0, 8).map((item: any) => (
            <div className="backup-info-row" key={`${item.relativePath}-${item.versionId}`} style={{ alignItems: 'center' }}>
              <span className="backup-info-label" title={item.relativePath} style={{ display: 'grid', gap: 2 }}>
                <span>{item.savedAt ? item.savedAt.replace('T', ' ').substring(0, 19) : item.versionId}</span>
                <span className="backup-info-meta">
                  {formatHistoryReason(item.reason)}{item.deletedSnapshot ? ' · 可恢复误删' : ''}
                </span>
              </span>
              <span className="backup-info-value" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                <span>{formatBytes(item.size)}</span>
                <button
                  className="btn btn-secondary btn-small"
                  onClick={() => handlePreviewHistory(item)}
                  disabled={historyPreviewLoading || !!historyActionBusy}
                >
                  {historyPreviewLoading && historyPreview?.versionId === item.versionId ? '读取中...' : '预览'}
                </button>
                <button
                  className="btn btn-secondary btn-small"
                  onClick={() => handleRestoreHistory(item)}
                  disabled={!!historyActionBusy || historyPreviewLoading}
                >
                  {historyActionBusy === `${item.relativePath}:${item.versionId}` ? '恢复中...' : '恢复'}
                </button>
              </span>
            </div>
          ))}
          <div className="backup-info-row" style={{ marginTop: 10 }}>
            <span className="backup-info-label">更多版本</span>
            <span className="backup-info-value" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary btn-small"
                onClick={() => {
                  const next = !versionHistoryAdvancedOpen;
                  setVersionHistoryAdvancedOpen(next);
                  if (next && !serverLiveHistory.length && !serverHistoryLoading) refreshServerLiveHistory();
                }}
                disabled={historyPreviewLoading || !!historyActionBusy}
              >
                {versionHistoryAdvancedOpen ? '隐藏高级版本历史' : '高级版本历史'}
              </button>
              <button className="btn btn-secondary btn-small" onClick={refreshLiveHistory} disabled={historyLoading || historyPreviewLoading || !!historyActionBusy}>
                {historyLoading ? '刷新中...' : '刷新'}
              </button>
            </span>
          </div>
          {versionHistoryAdvancedOpen && (
            <div className="backup-info-card version-history-advanced-card">
              <div className="backup-info-row">
                <span className="backup-info-label">服务器历史</span>
                <span className="backup-info-value" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                  <span>{serverHistoryLoading ? '读取中...' : `${serverLiveHistory.length} 条`}</span>
                  <button className="btn btn-secondary btn-small" onClick={refreshServerLiveHistory} disabled={serverHistoryLoading || historyPreviewLoading || !!historyActionBusy}>
                    刷新服务器历史
                  </button>
                </span>
              </div>
              {serverHistoryMessage && (
                <div className={'settings-status-badge ' + (serverHistoryMessage.includes('失败') || serverHistoryMessage.includes('failed') || serverHistoryMessage.includes('Failed') ? 'status-error' : 'status-ok')} style={{ marginTop: 8 }}>
                  {serverHistoryMessage}
                </div>
              )}
              {!serverHistoryLoading && serverLiveHistory.slice(0, 8).map((item: any) => (
                <div className="backup-info-row" key={`server-${item.relativePath}-${item.versionId}`} style={{ alignItems: 'center' }}>
                  <span className="backup-info-label" title={item.relativePath} style={{ display: 'grid', gap: 2 }}>
                    <span>{item.savedAt ? item.savedAt.replace('T', ' ').substring(0, 19) : item.versionId}</span>
                    <span className="backup-info-meta">
                      服务器 · {formatHistoryReason(item.reason)}{item.deletedSnapshot ? ' · 删除前快照' : ''}
                    </span>
                  </span>
                  <span className="backup-info-value" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                    <span>{formatBytes(item.size)}</span>
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={() => handlePreviewServerHistory(item)}
                      disabled={historyPreviewLoading || !!historyActionBusy}
                    >
                      {historyPreviewLoading && historyPreviewSource === 'server' && historyPreview?.versionId === item.versionId ? '读取中...' : '预览'}
                    </button>
                    <button
                      className="btn btn-primary btn-small"
                      onClick={() => handleRestoreServerHistory(item)}
                      disabled={!!historyActionBusy || historyPreviewLoading}
                    >
                      {historyActionBusy === `server:${item.relativePath}:${item.versionId}` ? '恢复中...' : '恢复'}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {historyPreviewLoading && !historyPreview && (
          <div className="conflict-diff-card">
            <div className="conflict-diff-title">正在读取历史版本...</div>
          </div>
        )}
        {historyPreview && (
          <div className="conflict-diff-card history-preview-card">
            <div className="conflict-diff-head">
              <div>
                <div className="conflict-diff-title">{historyPreviewSource === 'server' ? '服务器历史版本预览' : (historyPreview.deletedSnapshot ? '删除前版本预览' : '历史版本预览')}</div>
                <div className="conflict-diff-meta" title={historyPreview.relativePath}>
                  文件：{historyPreview.relativePath}
                </div>
                <div className="conflict-diff-meta">
                  保存时间：{historyPreview.savedAt ? historyPreview.savedAt.replace('T', ' ').substring(0, 19) : historyPreview.versionId}
                </div>
              </div>
              <button className="btn btn-secondary btn-small" onClick={() => setHistoryPreview(null)}>关闭</button>
            </div>
            {versionHistoryAdvancedOpen && (
              <div className="conflict-diff-stats">
                <span>{formatHistoryReason(historyPreview.reason)}{historyPreview.deletedSnapshot ? ' · 可恢复误删' : ''}</span>
                <span>{formatBytes(historyPreview.size)}</span>
                <span>差异行：{historyPreview.diff.changedLines}</span>
                <span>首次差异：{historyPreview.diff.firstChangedLine ? `第 ${historyPreview.diff.firstChangedLine} 行` : '-'}</span>
              </div>
            )}
            {(historyPreview.currentTruncated || historyPreview.contentTruncated) && (
              <div className="conflict-diff-note">文件较大，预览只显示前 256 KB，恢复操作仍会使用完整版本。</div>
            )}
            <div className="conflict-diff-actions">
              <button
                className="btn btn-primary"
                onClick={() => historyPreviewSource === 'server' ? handleRestoreServerHistory(historyPreview) : handleRestoreHistory(historyPreview)}
                disabled={!!historyActionBusy || historyPreviewLoading}
              >
                {historyActionBusy === `${historyPreview.relativePath}:${historyPreview.versionId}` || historyActionBusy === `server:${historyPreview.relativePath}:${historyPreview.versionId}`
                  ? '恢复中...'
                  : (historyPreviewSource === 'server' ? '恢复这个服务器历史版本' : '恢复这个历史版本')}
              </button>
            </div>
            <div className="conflict-diff-grid">
              <div className="conflict-diff-pane">
                <div className="conflict-diff-pane-title">当前文件</div>
                <pre>{historyPreview.currentExists ? (historyPreview.currentContent || '空文件') : '当前文件不存在'}</pre>
              </div>
              <div className="conflict-diff-pane">
                <div className="conflict-diff-pane-title">历史版本</div>
                <pre>{historyPreview.content || '空文件'}</pre>
              </div>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {historyMessage && (
            <div className={'settings-status-badge ' + (historyMessage.includes('失败') ? 'status-error' : 'status-ok')} style={{ marginTop: 0 }}>
              {historyMessage}
            </div>
          )}
        </div>
      </div>

      <div className="bl-section settings-card settings-section-files settings-section-recovery">
        <div className="bl-section-header section-card-header">Vault 存档体检</div>
        <div className="settings-safety-note">
          扫描当前 Vault 的正文、备份、Live History 和 AI 运行快照，帮助判断空间是否被生成缓存占用。清理只处理旧备份和可再生历史，不会删除正文、素材、MEMORY.md、SOUL.md、USER.md 或 skills。
        </div>
        <div className="backup-info-card">
          <div className="backup-info-row">
            <span className="backup-info-label">Vault 总大小</span>
            <span className="backup-info-value">{storageReport ? `${formatBytes(storageReport.totalSize)} / ${storageReport.totalFileCount} files` : '未扫描'}</span>
          </div>
          <div className="backup-info-row">
            <span className="backup-info-label">有效备份内容</span>
            <span className="backup-info-value">{storageReport ? formatBytes(storageReport.backupPayloadSize) : '-'}</span>
          </div>
          <div className="backup-info-row">
            <span className="backup-info-label">团队生产数据</span>
            <span className="backup-info-value">{storageReport ? formatBytes(storageReport.teamProductionSize) : '-'}</span>
          </div>
          <div className="backup-info-row">
            <span className="backup-info-label">AI 长期记忆 / skills</span>
            <span className="backup-info-value">{storageReport ? formatBytes(storageReport.portableAiMemorySize) : '-'}</span>
          </div>
          <div className="backup-info-row">
            <span className="backup-info-label">建议可释放</span>
            <span className="backup-info-value">{storageReport ? formatBytes(storageReport.suggestedReclaimableSize) : '-'}</span>
          </div>
          {storageReport?.warnings?.length ? (
            <div className="backup-info-meta" style={{ marginTop: 8 }}>
              {storageReport.warnings.map((warning: any) => (
                <div key={warning}>- {warning}</div>
              ))}
            </div>
          ) : null}
        </div>

        {storageReport?.buckets?.length ? (
          <div className="conflict-file-list" style={{ marginTop: 8 }}>
            {storageReport.buckets.map((bucket: any) => (
              <div className="conflict-file-row" key={bucket.id}>
                <div className="conflict-file-main">
                  <span className="conflict-file-name" title={bucket.path}>{bucket.label}</span>
                  <span className="conflict-file-meta">{bucket.description}</span>
                </div>
                <span className="backup-info-value" style={{ textAlign: 'right' }}>
                  {formatBytes(bucket.size)}
                  <span className="backup-info-meta" style={{ display: 'block' }}>{bucket.fileCount} files</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="backup-info-meta" style={{ marginTop: 8 }}>点击扫描后会显示详细占用。</div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="backup-info-meta" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            保留最近
            <input
              className="sync-input"
              type="number"
              min={1}
              max={50}
              value={storageKeepLatestBackups}
              onChange={(event) => setStorageKeepLatestBackups(Math.max(1, Math.min(50, Number(event.target.value) || 2)))}
              style={{ width: 72, padding: '4px 8px' }}
            />
            个备份
          </label>
          <button className="btn btn-secondary" onClick={refreshVaultStorageReport} disabled={storageScanning || storageCleaning}>
            {storageScanning ? '扫描中...' : '扫描占用'}
          </button>
          <button className="btn btn-primary" onClick={handleCleanupVaultStorage} disabled={storageScanning || storageCleaning || !storageReport}>
            {storageCleaning ? '清理中...' : '清理生成缓存'}
          </button>
        </div>

        {storageCleanupSummary?.actions?.length ? (
          <div className="backup-info-card" style={{ marginTop: 8 }}>
            {storageCleanupSummary.actions.map((action: any) => (
              <div className="backup-info-row" key={action.action}>
                <span className="backup-info-label">{action.action}</span>
                <span className="backup-info-value">{action.deletedCount} / {formatBytes(action.deletedSize)}</span>
              </div>
            ))}
          </div>
        ) : null}

        {storageMessage && (
          <div className={'settings-status-badge ' + (storageMessage.includes('失败') ? 'status-error' : 'status-ok')} style={{ marginTop: 8 }}>
            {storageMessage}
          </div>
        )}
      </div>

      {/* About */}
      <div className="bl-section settings-card settings-about-card settings-section-about">
        <div className="bl-section-header section-card-header">{t.about}</div>
        <div className="settings-about-notice">
          <div className="settings-about-icon">{'{'}</div>
          <div className="settings-about-text">{t.localFirstNotice}</div>
          <div className="settings-about-text">{t.dataSafetyNotice}</div>
          <div className="settings-about-version">Ars-note {APP_VERSION_LABEL} — Local-first knowledge base for game developers</div>
        </div>
      </div>
    </div>
  );
}
