import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload bridge: exposes a safe API to the renderer process.
 * The renderer accesses file system ONLY through these IPC calls.
 * No direct Node.js / fs access in the renderer.
 */

const api = {
  /* vault */
  createVault: (dir: string, name: string) =>
    ipcRenderer.invoke('vault:create', dir, name),
  openVault: (dir: string) =>
    ipcRenderer.invoke('vault:open', dir),
  getRecentVaults: () =>
    ipcRenderer.invoke('vault:getRecent'),
  addRecentVault: (dir: string) =>
    ipcRenderer.invoke('vault:addRecent', dir),

  /* file tree */
  readFileTree: (vaultPath: string) =>
    ipcRenderer.invoke('fs:readFileTree', vaultPath),

  /* file operations */
  readFile: (filePath: string) =>
    ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('fs:writeFile', filePath, content),
  saveImageToVault: (vp: string, relPath: string, data: number[]) =>
    ipcRenderer.invoke('fs:saveImageToVault', vp, relPath, data),
  createFile: (filePath: string, content?: string) =>
    ipcRenderer.invoke('fs:createFile', filePath, content),
  createFolder: (folderPath: string) =>
    ipcRenderer.invoke('fs:createFolder', folderPath),
  deleteItem: (itemPath: string, vaultPath: string) =>
    ipcRenderer.invoke('fs:deleteItem', itemPath, vaultPath),
  renameItem: (oldPath: string, newName: string) =>
    ipcRenderer.invoke('fs:renameItem', oldPath, newName),
  moveItem: (srcPath: string, destDir: string) =>
    ipcRenderer.invoke('fs:moveItem', srcPath, destDir),

  /* search */
  searchFiles: (vaultPath: string, query: string) =>
    ipcRenderer.invoke('search:files', vaultPath, query),

  /* vault index */
  scanVaultIndex: (vaultPath: string) =>
    ipcRenderer.invoke('vault:scanIndex', vaultPath),

  /* backup / manifest */
  generateVaultManifest: (vaultPath: string) =>
    ipcRenderer.invoke('vault:generateManifest', vaultPath),
  exportVaultBackup: (vaultPath: string, options?: any) =>
    ipcRenderer.invoke('vault:exportBackup', vaultPath, options),

  listVaultBackups: (vaultPath: string) =>
    ipcRenderer.invoke('vault:listBackups', vaultPath),
  analyzeVaultStorage: (vaultPath: string, keepLatestBackups?: number) =>
    ipcRenderer.invoke('vault:analyzeStorage', vaultPath, keepLatestBackups),
  cleanupVaultStorage: (vaultPath: string, options?: any) =>
    ipcRenderer.invoke('vault:cleanupStorage', vaultPath, options),
  listVaultBackupFiles: (vaultPath: string, backupPath: string) =>
    ipcRenderer.invoke('vault:listBackupFiles', vaultPath, backupPath),
  restoreVaultBackupFile: (vaultPath: string, backupPath: string, relativePath: string) =>
    ipcRenderer.invoke('vault:restoreBackupFile', vaultPath, backupPath, relativePath),
  pruneVaultBackups: (vaultPath: string, keepLatest: number) =>
    ipcRenderer.invoke('vault:pruneBackups', vaultPath, keepLatest),
  deleteVaultBackup: (vaultPath: string, backupPath: string) =>
    ipcRenderer.invoke('vault:deleteBackup', vaultPath, backupPath),
  restoreVaultBackup: (vaultPath: string, backupPath: string) =>
    ipcRenderer.invoke('vault:restoreBackup', vaultPath, backupPath),

  verifyVaultBackup: (vaultPath: string, backupPath: string) =>
    ipcRenderer.invoke('vault:verifyBackup', vaultPath, backupPath),

  loadSyncConfig: (vaultPath: string) =>
    ipcRenderer.invoke('sync:loadConfig', vaultPath),
  saveSyncConfig: (vaultPath: string, config: any) =>
    ipcRenderer.invoke('sync:saveConfig', vaultPath, config),

  uploadBackupToRemote: (vaultPath: string, backupPath: string) =>
    ipcRenderer.invoke('cloud:uploadBackup', vaultPath, backupPath),
  listRemoteBackups: (vaultPath: string) =>
    ipcRenderer.invoke('cloud:listRemote', vaultPath),
  deleteRemoteBackup: (vaultPath: string, remoteId: string) =>
    ipcRenderer.invoke('cloud:deleteRemoteBackup', vaultPath, remoteId),
  downloadRemoteBackup: (vaultPath: string, remoteId: string) =>
    ipcRenderer.invoke('cloud:downloadBackup', vaultPath, remoteId),

  validateProviderConfig: (vaultPath: string) =>
    ipcRenderer.invoke('cloud:validateProvider', vaultPath),

  setS3RuntimeCredentials: (vaultPath: string, credentials: any) =>
    ipcRenderer.invoke('s3:setCredentials', vaultPath, credentials),
  clearS3RuntimeCredentials: (vaultPath: string) =>
    ipcRenderer.invoke('s3:clearCredentials', vaultPath),
  getS3CredentialStatus: (vaultPath: string) =>
    ipcRenderer.invoke('s3:getCredentialStatus', vaultPath),
  testS3Connection: (vaultPath: string) =>
    ipcRenderer.invoke('s3:testConnection', vaultPath),

  /* self-hosted credentials (v0.8.2) */
  setSelfHostedRuntimeCredentials: (vaultPath: string, credentials: any) =>
    ipcRenderer.invoke('selfhosted:setCredentials', vaultPath, credentials),
  clearSelfHostedRuntimeCredentials: (vaultPath: string) =>
    ipcRenderer.invoke('selfhosted:clearCredentials', vaultPath),
  getSelfHostedCredentialStatus: (vaultPath: string) =>
    ipcRenderer.invoke('selfhosted:getCredentialStatus', vaultPath),
  selfHostedHealthCheck: (endpoint: string) =>
    ipcRenderer.invoke('selfhosted:healthCheck', endpoint),

  listDownloadedBackups: (vaultPath: string) =>
    ipcRenderer.invoke('cloud:listDownloaded', vaultPath),
  verifyDownloadedBackup: (vaultPath: string, downloadedPath: string) =>
    ipcRenderer.invoke('cloud:verifyDownloaded', vaultPath, downloadedPath),
  restoreDownloadedBackup: (vaultPath: string, downloadedPath: string) =>
    ipcRenderer.invoke('cloud:restoreDownloaded', vaultPath, downloadedPath),

  compareLocalRemoteState: (vaultPath: string) =>
    ipcRenderer.invoke('sync:compareLocalRemote', vaultPath),

  compareLocalWithRemoteBackup: (vaultPath: string, remoteId: string) =>
    ipcRenderer.invoke('sync:compareWithRemote', vaultPath, remoteId),

  compareLocalWithRemoteFiles: (vaultPath: string, remoteId: string) =>
    ipcRenderer.invoke('sync:previewDiff', vaultPath, remoteId),

  /* dialogs */
  showOpenDialog: () =>
    ipcRenderer.invoke('dialog:openFolder'),
  showSaveDialog: (defaultPath?: string) =>
    ipcRenderer.invoke('dialog:save', defaultPath),

  /* path utils */
  joinPath: (...segments: string[]) =>
    ipcRenderer.invoke('path:join', ...segments),
  basename: (filePath: string) =>
    ipcRenderer.invoke('path:basename', filePath),
  dirname: (filePath: string) =>
    ipcRenderer.invoke('path:dirname', filePath),

  /* app info */
  getAppVersion: () =>
    ipcRenderer.invoke('app:version'),
  windowMinimize: () =>
    ipcRenderer.invoke('window:minimize'),
  windowMaximize: () =>
    ipcRenderer.invoke('window:maximize'),
  windowClose: () =>
    ipcRenderer.invoke('window:close'),
  windowIsMaximized: () =>
    ipcRenderer.invoke('window:isMaximized'),
  onWindowMaximizedChanged: (callback: (data: { maximized: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { maximized: boolean }) => callback(data);
    ipcRenderer.on('window:maximized-changed', handler);
    return () => ipcRenderer.removeListener('window:maximized-changed', handler);
  },

  openExternalUrl: (url: string) =>
    ipcRenderer.invoke('shell:openExternal', url),

  /* AI Assistant (v1.1.0) */

  setAIRuntimeConfig: (vaultPath: string, config: { provider: string; baseUrl: string; model: string; apiKey: string }) =>
    ipcRenderer.invoke('ai:setRuntimeConfig', vaultPath, config),
  clearAIRuntimeConfig: (vaultPath: string) =>
    ipcRenderer.invoke('ai:clearRuntimeConfig', vaultPath),
  getAIRuntimeStatus: (vaultPath: string) =>
    ipcRenderer.invoke('ai:getRuntimeStatus', vaultPath),
  testAIConnection: (vaultPath: string) =>
    ipcRenderer.invoke('ai:testConnection', vaultPath),
  sendAIChat: (vaultPath: string, messages: Array<{ role: string; content: string }>, options?: any) =>
    ipcRenderer.invoke('ai:sendChat', vaultPath, messages, options),
  aiSafetySelfTest: (vaultPath: string) =>
    ipcRenderer.invoke('ai:safetySelfTest', vaultPath),
  aiListOperationAudit: (vaultPath: string, limit?: number) =>
    ipcRenderer.invoke('ai:listOperationAudit', vaultPath, limit),
  aiPreviewOperationRollback: (vaultPath: string, token: string) =>
    ipcRenderer.invoke('ai:previewOperationRollback', vaultPath, token),
  aiRollbackOperation: (vaultPath: string, token: string) =>
    ipcRenderer.invoke('ai:rollbackOperation', vaultPath, token),

  /* Team production helpers */
  draftNarrativeTasks: (vaultPath: string, options?: any) =>
    ipcRenderer.invoke('team:draftNarrativeTasks', vaultPath, options),
  upsertTeamTasks: (vaultPath: string, tasks: any[], sourceLabel?: string) =>
    ipcRenderer.invoke('team:upsertTasks', vaultPath, tasks, sourceLabel),
  bootstrapTeamWorkspace: (vaultPath: string, options?: any) =>
    ipcRenderer.invoke('team:bootstrapWorkspace', vaultPath, options),
  syncTeamTaskDocs: (vaultPath: string, fallbackMember?: string) =>
    ipcRenderer.invoke('team:syncTaskDocs', vaultPath, fallbackMember),
  generateTeamProductionDocs: (vaultPath: string, options?: any) =>
    ipcRenderer.invoke('team:generateProductionDocs', vaultPath, options),
  getTeamServerProductionStatus: (vaultPath: string) =>
    ipcRenderer.invoke('team:getServerProductionStatus', vaultPath),
  getTeamServerMemberWork: (vaultPath: string, options?: any) =>
    ipcRenderer.invoke('team:getServerMemberWork', vaultPath, options),

  /* AI tool call progress events */
  onAIToolProgress: (callback: (data: { name: string; args: Record<string, string>; status: string }) => void) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on('ai:tool-progress', listener);
    return () => { ipcRenderer.removeListener('ai:tool-progress', listener); };
  },

  /* AI 5-Pillar System */
  aiInitMemory: (vp: string) => ipcRenderer.invoke('ai:initMemory', vp),
  aiGetMemoryStatus: (vp: string) => ipcRenderer.invoke('ai:getMemoryStatus', vp),
  aiGetMemoryOverview: (vp: string) => ipcRenderer.invoke('ai:getMemoryOverview', vp),
  aiReadMemory: (vp: string) => ipcRenderer.invoke('ai:readMemory', vp),
  aiAppendMemory: (vp: string, entry: string) => ipcRenderer.invoke('ai:appendMemory', vp, entry),
  aiDeleteMemoryEntry: (vp: string, lineIndex: number) => ipcRenderer.invoke('ai:deleteMemoryEntry', vp, lineIndex),
  aiSetMemoryEntryLocked: (vp: string, lineIndex: number, locked: boolean) => ipcRenderer.invoke('ai:setMemoryEntryLocked', vp, lineIndex, locked),
  aiConsolidateMemory: (vp: string) => ipcRenderer.invoke('ai:consolidateMemory', vp),
  aiReadSoul: (vp: string) => ipcRenderer.invoke('ai:readSoul', vp),
  aiWriteSoul: (vp: string, content: string) => ipcRenderer.invoke('ai:writeSoul', vp, content),
  aiReadUser: (vp: string) => ipcRenderer.invoke('ai:readUser', vp),
  aiWriteUser: (vp: string, content: string) => ipcRenderer.invoke('ai:writeUser', vp, content),
  aiListSkills: (vp: string) => ipcRenderer.invoke('ai:listSkills', vp),
  aiCreateSkill: (vp: string, skill: any) => ipcRenderer.invoke('ai:createSkill', vp, skill),
  aiReadSkill: (vp: string, id: string) => ipcRenderer.invoke('ai:readSkill', vp, id),
  aiDeleteSkill: (vp: string, id: string) => ipcRenderer.invoke('ai:deleteSkill', vp, id),
  aiListCrons: (vp: string) => ipcRenderer.invoke('ai:listCrons', vp),
  aiCreateCron: (vp: string, cron: any) => ipcRenderer.invoke('ai:createCron', vp, cron),
  aiUpdateCron: (vp: string, id: string, u: any) => ipcRenderer.invoke('ai:updateCron', vp, id, u),
  aiDeleteCron: (vp: string, id: string) => ipcRenderer.invoke('ai:deleteCron', vp, id),
  aiListEvolutions: (vp: string) => ipcRenderer.invoke('ai:listEvolutions', vp),
  aiEvolveSkill: (vp: string, skillId: string) => ipcRenderer.invoke('ai:evolveSkill', vp, skillId),
  aiStartCronScheduler: (vp: string) => ipcRenderer.invoke('ai:startCronScheduler', vp),
  aiStopCronScheduler: () => ipcRenderer.invoke('ai:stopCronScheduler'),

  /* AI Conversation History */
  /* AI Memory Sync (v0.9.5) */
  aiSyncNow: (vaultPath: string) => ipcRenderer.invoke('ai:syncNow', vaultPath),
  aiSyncPush: (vaultPath: string) => ipcRenderer.invoke('ai:syncPush', vaultPath),
  aiSyncPull: (vaultPath: string) => ipcRenderer.invoke('ai:syncPull', vaultPath),
  aiSyncStatus: (vaultPath: string) => ipcRenderer.invoke('ai:syncStatus', vaultPath),
  aiStartAutoSync: (vaultPath: string) => ipcRenderer.invoke('ai:startAutoSync', vaultPath),
  aiStopAutoSync: () => ipcRenderer.invoke('ai:stopAutoSync'),

  aiSaveConversation: (vp: string, messages: any[]) => ipcRenderer.invoke('ai:saveConversation', vp, messages),
  aiListConversations: (vp: string) => ipcRenderer.invoke('ai:listConversations', vp),
  aiLoadConversation: (vp: string, file: string) => ipcRenderer.invoke('ai:loadConversation', vp, file),
  aiLoadLatestConversation: (vp: string) => ipcRenderer.invoke('ai:loadLatestConversation', vp),
  aiDeleteConversation: (vp: string, file: string) => ipcRenderer.invoke('ai:deleteConversation', vp, file),

  /* Live Sync — Real-time vault sync (v1.0.0) */
  liveSyncPreflightStart: (vaultPath: string, config: any) => ipcRenderer.invoke('live-sync:preflight-start', vaultPath, config),
  liveSyncStart: (vaultPath: string, config: any) => ipcRenderer.invoke('live-sync:start', vaultPath, config),
  liveSyncStop: () => ipcRenderer.invoke('live-sync:stop'),
  liveSyncStatus: () => ipcRenderer.invoke('live-sync:status'),
  liveSyncLoadConfig: (vaultPath: string) => ipcRenderer.invoke('live-sync:load-config', vaultPath),
  liveSyncSaveConfig: (vaultPath: string, config: any) => ipcRenderer.invoke('live-sync:save-config', vaultPath, config),
  liveSyncClearConfig: (vaultPath: string) => ipcRenderer.invoke('live-sync:clear-config', vaultPath),
  liveSyncPushFile: (filePath: string, content: string) => ipcRenderer.invoke('live-sync:push-file', filePath, content),
  liveSyncTrustLocalInitialUpload: (vaultPath?: string) => ipcRenderer.invoke('live-sync:trust-local-initial-upload', vaultPath),
  liveSyncResumeAfterStaleBaselineReview: () => ipcRenderer.invoke('live-sync:resume-after-stale-baseline-review'),
  liveSyncPublishLocalAuthority: (vaultPathOrOptions?: any, options?: any) => ipcRenderer.invoke('live-sync:publish-local-authority', vaultPathOrOptions, options),
  liveSyncSafeDeleteQueue: () => ipcRenderer.invoke('live-sync:safe-delete-queue'),
  liveSyncClearSafeDeleteQueue: (ids?: string[]) => ipcRenderer.invoke('live-sync:clear-safe-delete-queue', ids),
  liveSyncApplySafeDeleteQueue: (vaultPath: string, options?: any) => ipcRenderer.invoke('live-sync:apply-safe-delete-queue', vaultPath, options),
  liveSyncResumeAfterDeleteStormReview: () => ipcRenderer.invoke('live-sync:resume-after-delete-storm-review'),
  liveSyncResumeAfterDestructiveTruncationReview: () => ipcRenderer.invoke('live-sync:resume-after-destructive-truncation-review'),
  liveSyncHealth: (vaultPath: string) => ipcRenderer.invoke('live-sync:health', vaultPath),
  liveSyncSelfTest: (vaultPath: string) => ipcRenderer.invoke('live-sync:self-test', vaultPath),
  scanSyncConflicts: (vaultPath: string) => ipcRenderer.invoke('sync:scanConflicts', vaultPath),
  previewSyncConflict: (vaultPath: string, conflictRelativePath: string) => ipcRenderer.invoke('sync:previewConflict', vaultPath, conflictRelativePath),
  applySyncConflict: (vaultPath: string, conflictRelativePath: string) => ipcRenderer.invoke('sync:applyConflict', vaultPath, conflictRelativePath),
  resolveSyncConflictLatest: (vaultPath: string, conflictRelativePath: string) => ipcRenderer.invoke('sync:resolveConflictLatest', vaultPath, conflictRelativePath),
  createConflictMergeDraft: (vaultPath: string, conflictRelativePath: string) => ipcRenderer.invoke('sync:createConflictMergeDraft', vaultPath, conflictRelativePath),
  saveConflictMergeResult: (vaultPath: string, conflictRelativePath: string, mergedContent: string, deleteConflict?: boolean) => ipcRenderer.invoke('sync:saveConflictMergeResult', vaultPath, conflictRelativePath, mergedContent, deleteConflict),
  deleteSyncConflict: (vaultPath: string, conflictRelativePath: string) => ipcRenderer.invoke('sync:deleteConflict', vaultPath, conflictRelativePath),
  cleanupSyncConflicts: (vaultPath: string) => ipcRenderer.invoke('sync:cleanupConflicts', vaultPath),
  getSyncRecoveryOverview: (vaultPath: string) => ipcRenderer.invoke('sync:recoveryOverview', vaultPath),
  previewSyncAccidentRecovery: (vaultPath: string, options?: any) => ipcRenderer.invoke('sync:previewAccidentRecovery', vaultPath, options),
  previewSyncRecoveryAdvisor: (vaultPath: string, options?: any) => ipcRenderer.invoke('sync:previewRecoveryAdvisor', vaultPath, options),
  applySyncRecoveryAdvisorItem: (vaultPath: string, item: any) => ipcRenderer.invoke('sync:applyRecoveryAdvisorItem', vaultPath, item),
  applySyncRecoveryAdvisorPlan: (vaultPath: string, options?: any) => ipcRenderer.invoke('sync:applyRecoveryAdvisorPlan', vaultPath, options),
  runSafeSyncRecoveryAutopilot: (vaultPath: string, options?: any) => ipcRenderer.invoke('sync:runSafeRecoveryAutopilot', vaultPath, options),
  listServerDataSnapshots: (vaultPath: string, limit?: number) => ipcRenderer.invoke('sync:listServerDataSnapshots', vaultPath, limit),
  createServerDataSnapshot: (vaultPath: string, options?: any) => ipcRenderer.invoke('sync:createServerDataSnapshot', vaultPath, options),
  exportServerDataBackup: (vaultPath: string) => ipcRenderer.invoke('sync:exportServerDataBackup', vaultPath),
  listServerSnapshotFiles: (vaultPath: string, options?: any) => ipcRenderer.invoke('sync:listServerSnapshotFiles', vaultPath, options),
  restoreServerSnapshotFile: (vaultPath: string, fileName: string, candidate: any) => ipcRenderer.invoke('sync:restoreServerSnapshotFile', vaultPath, fileName, candidate),
  previewAiTrashFile: (vaultPath: string, recoveryRelativePath: string) => ipcRenderer.invoke('sync:previewAiTrashFile', vaultPath, recoveryRelativePath),
  restoreAiTrashFile: (vaultPath: string, recoveryRelativePath: string) => ipcRenderer.invoke('sync:restoreAiTrashFile', vaultPath, recoveryRelativePath),
  previewProtectedLocalRecoveryFile: (vaultPath: string, recoveryRelativePath: string) => ipcRenderer.invoke('sync:previewProtectedLocalRecoveryFile', vaultPath, recoveryRelativePath),
  restoreProtectedLocalRecoveryFile: (vaultPath: string, recoveryRelativePath: string) => ipcRenderer.invoke('sync:restoreProtectedLocalRecoveryFile', vaultPath, recoveryRelativePath),
  listLiveHistory: (vaultPath: string, relativePath?: string) => ipcRenderer.invoke('sync:listLiveHistory', vaultPath, relativePath),
  previewLiveHistory: (vaultPath: string, relativePath: string, versionId: string) => ipcRenderer.invoke('sync:previewLiveHistory', vaultPath, relativePath, versionId),
  restoreLiveHistory: (vaultPath: string, relativePath: string, versionId: string) => ipcRenderer.invoke('sync:restoreLiveHistory', vaultPath, relativePath, versionId),
  previewLiveHistoryBatchRestore: (vaultPath: string, options?: any) => ipcRenderer.invoke('sync:previewLiveHistoryBatchRestore', vaultPath, options),
  restoreLiveHistoryBatch: (vaultPath: string, options?: any) => ipcRenderer.invoke('sync:restoreLiveHistoryBatch', vaultPath, options),
  listServerLiveHistory: (vaultPath: string, relativePath?: string, limit?: number) => ipcRenderer.invoke('sync:listServerLiveHistory', vaultPath, relativePath, limit),
  previewServerLiveHistory: (vaultPath: string, relativePath: string, versionId: string) => ipcRenderer.invoke('sync:previewServerLiveHistory', vaultPath, relativePath, versionId),
  restoreServerLiveHistory: (vaultPath: string, relativePath: string, versionId: string) => ipcRenderer.invoke('sync:restoreServerLiveHistory', vaultPath, relativePath, versionId),
  previewServerLiveHistoryBatchRestore: (vaultPath: string, options?: any) => ipcRenderer.invoke('sync:previewServerLiveHistoryBatchRestore', vaultPath, options),
  restoreServerLiveHistoryBatch: (vaultPath: string, options?: any) => ipcRenderer.invoke('sync:restoreServerLiveHistoryBatch', vaultPath, options),
  onLiveSyncStatus: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('live-sync:status', handler);
    return () => ipcRenderer.removeListener('live-sync:status', handler);
  },
  onLiveSyncActivity: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('live-sync:activity', handler);
    return () => ipcRenderer.removeListener('live-sync:activity', handler);
  },
  onLiveSyncFileUpdated: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('live-sync:file-updated', handler);
    return () => ipcRenderer.removeListener('live-sync:file-updated', handler);
  },
  onLiveSyncConflict: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('live-sync:conflict', handler);
    return () => ipcRenderer.removeListener('live-sync:conflict', handler);
  },
  onLiveSyncVersionCheck: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data);
    ipcRenderer.on('live-sync:version-check', handler);
    return () => ipcRenderer.removeListener('live-sync:version-check', handler);
  },

  /* PDF Export (v1.0.0) */
  exportPdf: (html: string, fileName: string) => ipcRenderer.invoke('export:pdf', { html, fileName }),
};

export type ArsNoteAPI = typeof api;
contextBridge.exposeInMainWorld('arsnote', api);
