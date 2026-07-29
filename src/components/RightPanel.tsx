import React, { useState, useMemo, useEffect, useRef } from 'react';
import type { SearchResult, OutgoingLinkInfo, GroupedBacklink, TagNoteInfo, GraphData, GraphSummary, VaultManifest, BackupSummary, BackupListItem, BackupFileListResult, BackupFileRestoreSummary, BackupPruneSummary, RestoreSummary, BackupVerifyResult, VaultStorageReport, VaultStorageCleanupSummary, SyncConfig, SyncProvider, SyncStatus, RemoteBackupItem, CloudUploadSummary, CloudDownloadSummary, DownloadedBackupItem, ProviderValidationResult, CloudProviderInfo, S3RuntimeCredentials, S3CredentialStatus, S3ConnectionTestResult, SyncCompareResult, SyncPreviewResult, SyncConflictFile, SyncConflictPreview, LiveHistoryItem, LiveHistoryPreview, LiveHistoryBatchRestorePlan, ProtectedLocalRecoveryFile, SyncRecoveryOverview, SyncAccidentRecoveryPlan, SyncRecoveryAdvisorPlan, SyncRecoveryAdvisorItem, ServerDataSnapshotItem, ServerSnapshotFileCandidate, LiveSyncSelfTestResult, AISafetySelfTestResult, AIOperationAuditEvent, AIOperationRollbackPreview, SelfHostedRuntimeCredentials, SelfHostedCredentialStatus, GameWorkspaceSummary, GameWorkspaceEntry, GameDocType, GameWorkspaceFilters, GameWorkspaceDashboard, AIProviderConfig, AIChatMessage, AIContextMode, AIControlMode, AIConnectionTestResult, AIContextUsage, VaultIndex } from '../types';
import type { BoardGroup } from '../utils/gameWorkspaceScanner';
import { formatBytes } from '../utils/vaultManifest';
import { getCloudProviders, mapSyncProviderToCloudId } from '../utils/cloudBackupProvider';
import { buildS3SafetyReport } from '../utils/s3SafetyReport';
import { renderMarkdown } from '../utils/markdownRenderer';
import { getCategories, getTemplates } from '../templates';
import { useI18n } from '../i18n';
import { buildGameWorkspaceDashboard, filterGameWorkspaceEntries, getGameWorkspaceOwners, groupGameWorkspaceEntriesByStatus, groupGameWorkspaceEntriesByType } from '../utils/gameWorkspaceScanner';
import { buildGameWorkspaceReportMarkdown } from '../utils/gameWorkspaceReport';
import { QUICK_PROMPTS } from '../utils/aiClient';
import { getAIChatScrollToken } from '../utils/aiChatPresentation';
import { splitSearchHighlight } from '../utils/searchHighlight';
import { getCategoryIcon, getRightPanelTabIcon, getGameDocIcon } from './icons/iconMap';
import OutlineView from './OutlineView';
import ProductionCommandCenter from './ProductionCommandCenter';
import AIContextMeter from './AIContextMeter';
import AIChatMessageList, { useAIChatAutoScroll } from './AIChatMessageList';
import { APP_VERSION_LABEL } from '../appVersion';

const GraphView = React.lazy(() => import('./GraphView'));

type RightTab = 'preview' | 'search' | 'templates' | 'backlinks' | 'graph' | 'backup' | 'settings' | 'game' | 'ai' | 'outline';
type RightCategory = 'workspace' | 'knowledge' | 'ai';
type LiveSyncTimelineKind = 'status' | 'activity' | 'conflict' | 'health' | 'self-test';

interface LiveSyncTimelineItem {
  id: string;
  kind: LiveSyncTimelineKind;
  timestamp: string;
  title: string;
  detail?: string;
  status?: 'ok' | 'warn' | 'error' | 'info';
  direction?: string;
  relativePath?: string;
}

const LIVE_SYNC_TIMELINE_LIMIT = 80;
const LIVE_SYNC_TIMELINE_DEDUPE_MS = 60000;
const LIVE_SYNC_HEALTH_POLL_MS = 45000;

function liveSyncSelfTestStepLabel(name: string): string {
  if (name === 'peerBroadcastDelivery') return '第二客户端广播接收';
  if (name === 'revisionBaseProtection') return '服务器版本号写入保护';
  if (name === 'joinServerAuthorityAdoption') return '加入 Vault 只拉取保护';
  if (name === 'incomingServerAuthorityConflictHold') return '远端主线冲突保护';
  if (name === 'hiddenConflictRecoveryRouting') return '冲突进入恢复中心';
  if (name === 'remoteSnapshotUploadGate') return '远端快照上传闸门';
  if (name === 'joinMissingBaseQueuedWriteGate') return '无服务器基线禁止上传';
  if (name === 'serverSnapshotProofProtection') return '服务器快照证明保护';
  if (name === 'serverPreSnapshotLocalWriteProtection') return '旧本地文件上行保护';
  if (name === 'destructiveTruncationGuard') return '危险截断保护';
  if (name === 'serverDestructiveTruncationProtection') return '服务器危险截断保护';
  if (name === 'tombstoneRetention30Days') return '删除记录保留 30 天';
  if (name === 'prunedTombstoneHistoryProtection') return '清理后删除历史保护';
  const labels: Record<string, string> = {
    api: '客户端自检接口',
    config: '同步配置',
    connection: 'WebSocket 连接',
    serverSafetyCapabilities: '服务器安全能力',
    multiDevicePresence: '同库在线设备',
    serverLiveFilesApi: '服务器快照接口',
    createUpload: '新建文件上传',
    updateUpload: '修改文件上传',
    staleWriteProtection: '旧写入保护',
    staleBaselinePreflight: '陈旧基线预检',
    deleteStormGuard: '批量删除保护',
    serverMissingBaseProtection: '服务器缺失基线保护',
    deleteUpload: '删除同步',
    tombstoneRetention30Days: '删除记录保留 30 天',
    prunedTombstoneHistoryProtection: '清理后删除历史保护',
    deleteRecoveryHistory: '删除恢复历史',
    serverDeleteRecoveryHistory: '服务器删除恢复历史',
    serverHistoryRestore: '服务器历史恢复',
    serverRestoreMetadataBroadcast: '服务器恢复版本指纹',
    teamScheduleHiddenDir: '团队数据目录同步',
    aiMemoryPortableHiddenDir: 'AI 记忆目录同步',
    aiMemorySkillsHiddenDir: 'AI skill 目录同步',
    error: '自检异常',
  };
  return labels[name] || name;
}

function liveSyncSelfTestStepHint(name: string, ok: boolean): string {
  if (name === 'peerBroadcastDelivery') {
    return ok
      ? '自检临时打开了第二个 WebSocket 观察者，并确认它收到了服务器广播的文件变更；这说明实时同步链路不是只写进了服务器，而是真的能推送给另一端。'
      : '服务器能连接但第二客户端没有收到广播。请检查 Tailscale/反代/防火墙是否允许 WebSocket 长连接，并确认所有电脑都连接同一个 Vault ID。';
  }
  if (name === 'revisionBaseProtection') {
    return ok
      ? '服务器会校验每次写入基于哪一个 serverRevision/revisionId；即使内容 hash 一样，旧 revision 也不能继续写。'
      : '服务器还没有启用 revision 级写入保护，请覆盖上传最新 server 文件夹并重启 NAS Docker 容器。';
  }
  if (name === 'joinServerAuthorityAdoption') {
    return ok
      ? '第一次加入已有服务器，或本机基线明显落后时，服务器会被视为权威版本；本地多出来的旧文件只会进恢复中心，不会自动上传覆盖服务器。'
      : '加入 Vault 保护失败：旧电脑第一次连接已有服务器时，可能仍会把本地旧文件当作新内容上传。请先不要继续同步，更新客户端和 NAS server。';
  }
  if (name === 'incomingServerAuthorityConflictHold') {
    return ok
      ? 'Join 模式收到服务器更新时，服务器版本会继续作为同步主线；本机不同版本会进入恢复中心，不会自动反推覆盖服务器。'
      : '远端主线冲突保护失败：收到服务器更新时，本机不同版本可能自动反推服务器。请先不要继续同步。';
  }
  if (name === 'hiddenConflictRecoveryRouting') {
    return ok
      ? '新的冲突副本会写入 .ars-note/sync-recovery，同步恢复中心负责展示和合并；文档目录里遗留的 *.conflict-* 只作为待清理风险提示。'
      : '冲突恢复路由失败：新冲突可能仍会散落在文档目录里。请先不要继续同步，更新客户端后重新自检。';
  }
  if (name === 'remoteSnapshotUploadGate') {
    return ok
      ? '客户端必须先收到服务器快照，才允许任何本地队列或恢复按钮继续上传。'
      : '远端快照上传闸门失败：旧电脑刚连上、还没完成服务器对账时，可能过早上传旧数据。';
  }
  if (name === 'joinMissingBaseQueuedWriteGate') {
    return ok
      ? '加入现有 Vault 时，没有服务器基线的旧本地写入会被拦住；只有完成快照后产生的新文件才允许上传。'
      : '无服务器基线保护失败：旧电脑可能把本机旧文件当作新改动上传。';
  }
  if (name === 'serverSnapshotProofProtection') {
    return ok
      ? '服务器会拒绝还没证明“已收到服务器快照”的客户端写入，避免旧客户端绕过加入流程。'
      : '服务器快照证明保护失败：请上传最新 server 文件夹并重启 NAS 容器。';
  }
  if (name === 'serverPreSnapshotLocalWriteProtection') {
    return ok
      ? '服务器会拒绝客户端在收到快照前提交的本地旧文件，防止旧电脑把旧数据灌回服务器。'
      : '旧本地文件上行保护失败：请上传最新 server 文件夹并重启 NAS 容器。';
  }
  if (name === 'destructiveTruncationGuard') {
    return ok
      ? '大文档突然变空或极小时会先暂停上传，避免空 GDD/旧内容扩散到其他电脑。'
      : '危险截断保护失败：大文档被写成空文件时，仍可能被当作正常更新上传。';
  }
  if (name === 'serverDestructiveTruncationProtection') {
    return ok
      ? 'NAS 服务端会拒绝大文档突然变空/极小的写入，即使旧客户端绕过本机保护也不会污染服务器。'
      : '服务器危险截断保护失败：请上传最新 server 文件夹并重启 NAS 容器。';
  }
  if (name === 'tombstoneRetention30Days') {
    return ok
      ? '服务器会把删除先保存为 tombstone，并至少保留 30 天；这段时间内误删可恢复，旧电脑也不能让已删文件复活。'
      : '删除记录保留失败：服务器没有证明 tombstone 至少保留 30 天。请上传最新 server 文件夹并重启 NAS 容器。';
  }
  if (name === 'prunedTombstoneHistoryProtection') {
    return ok
      ? '服务器即使清理了过期删除记录，也会用 live-history 阻止旧电脑把已删除文件重新上传回来。'
      : '清理后删除历史保护失败：请上传最新 server 文件夹并重启 NAS 容器，否则旧电脑可能让已删除文件复活。';
  }
  if (ok) {
    if (name === 'teamScheduleHiddenDir') return '.ars-team 时间表、工作包、周计划可以实时同步。';
    if (name === 'aiMemoryPortableHiddenDir') return '.ai-memory 里的长期记忆、USER/SOUL、crons 可以实时同步。';
    if (name === 'aiMemorySkillsHiddenDir') return '.ai-memory/skills 里的 AI skill 可以实时同步。';
    if (name === 'serverSafetyCapabilities') return 'NAS 服务端已报告新版防覆盖、防误删和恢复能力。';
    if (name === 'multiDevicePresence') return '用于确认服务器当前能看到几台电脑连在同一个 Vault ID 上。';
    if (name === 'staleWriteProtection') return '服务器会拒绝旧电脑/旧基线覆盖新文件。';
    if (name === 'staleBaselinePreflight') return '本机基线明显落后服务器时，预检会阻止本地改动自动上传。';
    if (name === 'deleteStormGuard') return '短时间大量删除会先暂停上传，避免误删扩散到全队。';
    if (name === 'serverMissingBaseProtection') return '服务器缺少基线文件时，会拒绝旧客户端把旧内容当作更新灌回去。';
    if (name === 'deleteRecoveryHistory') return '删除后本机会留下可恢复的 live-history 快照。';
    if (name === 'serverDeleteRecoveryHistory') return 'NAS 服务器会保存被删文件的内容快照，换电脑也能从服务器历史找回。';
    if (name === 'serverHistoryRestore') return 'NAS 服务器历史可以真正恢复成 live 文件，并同步回本机。';
    if (name === 'serverRestoreMetadataBroadcast') return '服务器恢复历史后，会把 serverRevision/revisionId 同步写入本机指纹。';
    return '这一环节正常。';
  }
  const hints: Record<string, string> = {
    config: '先保存 Live Sync 服务器地址和 Vault ID。',
    connection: '先连接 Live Sync；如果频繁断开，优先检查服务器地址、反代/WebSocket 和网络延迟。',
    serverSafetyCapabilities: 'NAS 服务端没有报告新版安全能力。请上传最新 server 文件夹并重建容器，否则旧电脑仍可能覆盖新文件。',
    multiDevicePresence: '如果最终目标是两台电脑实时同步，请让两台电脑同时连接同一个 Vault ID 后重新运行自检。',
    serverLiveFilesApi: '服务器 HTTP 可达但快照接口异常，通常需要重新部署新版 server/dist。',
    createUpload: '文件监听或 WebSocket 上传异常，另一台电脑不会实时收到新文件。',
    updateUpload: '修改上传异常，另一台电脑可能只能看到旧内容。',
    staleWriteProtection: '旧写入保护失败：服务器可能还没部署严格 base 版本校验，旧电脑有覆盖新文件风险。',
    staleBaselinePreflight: '陈旧基线预检失败：旧电脑离线很久后，仍可能把本地旧改动自动上传。',
    deleteStormGuard: '批量删除保护失败：误删文件夹时，删除可能会快速扩散到其他电脑。',
    serverMissingBaseProtection: '服务器缺失基线保护失败：服务器数据为空或连错 Vault 时，旧电脑可能把旧文件重新上传。',
    deleteUpload: '删除墓碑没有写入服务器，其他电脑可能不会同步删除。',
    deleteRecoveryHistory: '删除恢复历史失败：本地删除后没有发现 live-history 快照，误删恢复可能不可用。',
    serverDeleteRecoveryHistory: '服务器删除恢复历史失败：NAS 没有保存可下载的被删文件快照，换电脑恢复会受影响。请上传最新 server 文件夹并重启容器。',
    serverHistoryRestore: '服务器历史恢复失败：NAS 找到了历史但无法恢复为 live 文件。请上传最新 server 文件夹并重启容器。',
    serverRestoreMetadataBroadcast: '服务器恢复版本指纹失败：恢复内容可能成功，但本机没有记录服务器版本号。请上传最新 server 文件夹并重启容器。',
    teamScheduleHiddenDir: '.ars-team 没同步，团队时间表、任务页、周计划不会稳定跨电脑。',
    aiMemoryPortableHiddenDir: '.ai-memory 长期记忆没同步，AI 记忆不会带到其他电脑。',
    aiMemorySkillsHiddenDir: '.ai-memory/skills 没同步，AI 记忆和自提炼 skill 不会带到其他电脑。',
  };
  return hints[name] || '查看详细信息并重新运行自检。';
}

function aiSafetySelfTestStepLabel(name: string): string {
  const labels: Record<string, string> = {
    api: '自检接口',
    vault: 'Vault 检查',
    setup: '创建临时文件',
    readonlyBlocksDelete: '只读模式阻止删除',
    directDeleteApplies: 'AI 直接执行删除',
    directWriteApplies: 'AI 直接执行写入',
    previewRequiresToken: '删除前预览和确认码',
    syncRecoveryAdvisorRead: '同步恢复建议读取',
    legacyPreviewAvailable: '旧版预览兼容',
    syncRecoveryAdvisorApplyPreview: '同步恢复应用预览',
    applyWithoutLatestTokenBlocked: '无确认码拒绝执行',
    applyWithTokenDeletesFile: '确认后执行删除',
    aiServerDeletePublishes: 'AI 删除同步服务器',
    aiTrashRecoveryCopy: 'AI 回收副本',
    liveHistoryBeforeDelete: '删除前历史快照',
    operationAuditTrail: '操作审计日志',
    operationRollbackPreview: '回滚预览',
    operationRollbackRestore: '一键回滚恢复',
    error: '自检异常',
  };
  return labels[name] || name;
}

interface AiSyncFileBreakdown {
  core: number;
  skills: number;
  crons: number;
  evolutions: number;
  other: number;
}

function getAiSyncFileBreakdown(files: string[] = []): AiSyncFileBreakdown {
  const normalized = files.map((item) => String(item || '').replace(/\\/g, '/'));
  const core = normalized.filter((item) => item === 'MEMORY.md' || item === 'USER.md' || item === 'SOUL.md').length;
  const skills = normalized.filter((item) => item.startsWith('skills/') && item.endsWith('.md')).length;
  const crons = normalized.filter((item) => item === 'crons.json').length;
  const evolutions = normalized.filter((item) => item.startsWith('evolution/') && item.endsWith('.evo.json')).length;
  return {
    core,
    skills,
    crons,
    evolutions,
    other: Math.max(0, normalized.length - core - skills - crons - evolutions),
  };
}

function previewAiSyncFiles(files: string[] = [], limit = 12): { shown: string[]; hidden: number } {
  const shown = files.slice(0, limit);
  return { shown, hidden: Math.max(0, files.length - shown.length) };
}

function normalizeServerBaseUrl(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  let candidate = trimmed.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `http://${candidate}`;
  try {
    const parsed = new URL(candidate);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return candidate.replace(/\/+$/, '').replace(/\/(?:admin|ws\/live-sync).*$/i, '');
  }
}

function buildServerAdminUrl(value: string): string {
  const base = normalizeServerBaseUrl(value);
  return base ? `${base}/admin` : '';
}

function liveSyncHealthMessages(health: any): string[] {
  return [
    health?.local?.lastRejectedWrite?.message,
    health?.local?.lastError,
    health?.serverError,
    health?.diagnosticWarning,
  ].filter(Boolean);
}

function liveSyncSafetyCompatibility(health: any): any {
  return health?.server?.safetyCompatibility || null;
}

function liveSyncSafetyCompatibilityLabel(health: any): string {
  const compatibility = liveSyncSafetyCompatibility(health);
  if (!compatibility) return '-';
  if (compatibility.ok) return '完整';
  const critical = Array.isArray(compatibility.missingCritical) ? compatibility.missingCritical.length : 0;
  const total = Array.isArray(compatibility.missing) ? compatibility.missing.length : 0;
  return critical > 0 ? `缺少关键能力 ${critical} 项` : `缺少可选能力 ${total} 项`;
}

function liveSyncMissingSafetyCapabilityLabels(health: any): string[] {
  const compatibility = liveSyncSafetyCompatibility(health);
  if (!compatibility || compatibility.ok) return [];
  const labels = compatibility.labels || {};
  const missing = Array.isArray(compatibility.missingCritical) && compatibility.missingCritical.length > 0
    ? compatibility.missingCritical
    : (Array.isArray(compatibility.missing) ? compatibility.missing : []);
  return missing.map((key: string) => labels[key] || key);
}

function liveSyncHealthStatusLabel(health: any): string {
  if (!health) return '-';
  if (health.server?.ok && !health.degraded) return '在线';
  if (health.local?.connected && health.ok && health.degraded) return 'WebSocket 在线 / HTTP 慢';
  if (health.local?.connected && health.ok) return 'WebSocket 在线';
  if (health.serverError || health.local?.lastError || health.status === 'error') return '异常';
  return '-';
}

function liveSyncHealthReasonLabel(health: any): string {
  if (!health) return '失败原因';
  if (health.local?.connected && health.ok && health.degraded) return '链路提示';
  if (health.diagnosticWarning && !health.local?.lastError && !health.serverError) return '诊断提示';
  return '失败原因';
}

function liveSyncLaunchReadiness(health: any): any {
  return health?.launchReadiness || null;
}

function liveSyncLaunchReadinessLabel(health: any): string {
  const readiness = liveSyncLaunchReadiness(health);
  if (!readiness) return '-';
  if (readiness.status === 'ready') return '可以同步';
  if (readiness.status === 'warning') return '谨慎同步';
  if (readiness.status === 'blocked') return '先别同步';
  return readiness.status || '-';
}

function liveSyncLaunchReadinessBadgeClass(health: any): string {
  const status = liveSyncLaunchReadiness(health)?.status;
  if (status === 'ready') return 'status-ok';
  if (status === 'warning') return 'status-warning';
  return 'status-error';
}

type LiveSyncSimpleAction = 'refresh' | 'recovery' | 'autopilot' | 'safe-delete' | 'admin' | 'none';

function buildLiveSyncSimpleSummary(
  health: any,
  connected: boolean,
  mode: 'join' | 'rebuild',
  safeDeleteQueueCount = 0,
): {
  tone: 'ok' | 'warning' | 'paused' | 'error' | 'offline';
  label: string;
  title: string;
  detail: string;
  action: LiveSyncSimpleAction;
  actionLabel: string;
  facts: string[];
} {
  const readiness = liveSyncLaunchReadiness(health);
  const missingCapabilities = liveSyncMissingSafetyCapabilityLabels(health);
  const uploadFrozen = !!health?.local?.uploadFrozen;
  const uploadFrozenReason = String(health?.local?.uploadFrozenReason || '');
  const serverAdoption = health?.local?.serverAuthorityAdoption || null;
  const serverAdoptionProtectedCount = Number(serverAdoption?.protectedCount || 0);
  const serverError = health?.serverError || health?.local?.lastError || '';
  const serverExperience = health?.server?.experience || null;
  const onlineClients = typeof health?.server?.vaultClients === 'number' ? health.server.vaultClients : null;
  const latency = typeof health?.local?.latencyMs === 'number' ? `${health.local.latencyMs} ms` : '';
  const facts = [
    mode === 'rebuild' ? '当前：管理员重建模式' : '当前：安全加入模式',
    onlineClients !== null ? `在线设备 ${onlineClients}` : '',
    latency ? `延迟 ${latency}` : '',
  ].filter(Boolean);

  if (!connected && !health) {
    return {
      tone: 'offline',
      label: '未连接',
      title: '输入服务器地址后加入现有 Vault',
      detail: mode === 'rebuild'
        ? '当前选择了管理员重建模式。普通成员不要使用这个模式。'
        : '默认会先拉取服务器权威版本，本机旧文件不会直接覆盖服务器。',
      action: 'refresh',
      actionLabel: '检查服务器',
      facts,
    };
  }

  if (missingCapabilities.length > 0) {
    return {
      tone: 'error',
      label: '需要处理',
      title: 'NAS 服务端不是完整安全同步版本',
      detail: `缺少 ${missingCapabilities.length} 项安全能力。先覆盖上传最新 server 文件夹并重启容器，再让成员同步。`,
      action: 'admin',
      actionLabel: '打开管理台',
      facts,
    };
  }

  if (readiness?.status === 'blocked') {
    const firstBlocker = Array.isArray(readiness.blockers) ? readiness.blockers[0] : '';
    const blockerText = [
      readiness.summary,
      ...(Array.isArray(readiness.blockers) ? readiness.blockers : []),
      ...(Array.isArray(readiness.actions) ? readiness.actions : []),
    ].join(' ');
    const canAutoTriage = /conflict|冲突|recovery|恢复|protected local|受保护|AI trash|回收/i.test(blockerText);
    return {
      tone: 'error',
      label: '需要处理',
      title: '同步已被保护性阻止',
      detail: readiness.summary || firstBlocker || '存在冲突副本、旧基线或恢复风险。先让 Ars-note 安全整理，再继续同步。',
      action: canAutoTriage ? 'autopilot' : 'recovery',
      actionLabel: canAutoTriage ? '一键安全整理' : '打开恢复中心',
      facts,
    };
  }

  if (safeDeleteQueueCount > 0) {
    return {
      tone: 'ok',
      label: '自动同步',
      title: '正在后台同步删除',
      detail: `${safeDeleteQueueCount} 个删除会自动发送到服务器；已保留本地/服务器历史，通常不需要手动处理。`,
      action: 'refresh',
      actionLabel: '刷新状态',
      facts,
    };
  }

  if (connected && serverAdoptionProtectedCount > 0 && !uploadFrozen) {
    return {
      tone: 'ok',
      label: '正常',
      title: '已按服务器权威时间线完成同步',
      detail: `Ars-note 已保护 ${serverAdoptionProtectedCount} 个本机旧差异，服务器版本已成为当前基线；被保护内容可在同步恢复中心找回或合并。`,
      action: 'recovery',
      actionLabel: '查看恢复中心',
      facts: [
        ...facts,
        serverAdoption?.mode === 'first-connect-server-authority' ? '首次加入：只拉取服务器' : '旧基线：服务器优先',
      ],
    };
  }

  if (uploadFrozen) {
    const isRebuild = uploadFrozenReason.includes('rebuild') || uploadFrozenReason.includes('initial-upload');
    const isOldBaseline = uploadFrozenReason.includes('stale-baseline') || uploadFrozenReason.includes('missing-base');
    if (mode === 'join' && isOldBaseline) {
      return {
        tone: 'ok',
        label: '正常',
        title: '已按服务器时间线同步',
        detail: '这台电脑落后的本地改动已被保护到恢复中心，不会自动上传覆盖服务器；服务器上的当前文件会继续正常同步。',
        action: 'recovery',
        actionLabel: '查看恢复中心',
        facts,
      };
    }
    return {
      tone: 'paused',
      label: '已保护暂停',
      title: isRebuild ? '等待管理员确认权威版本' : '旧数据上传已暂停',
      detail: isRebuild
        ? 'Ars-note 已连接服务器，但不会自动用本机覆盖服务器。只有明确执行重建才会发布。'
        : isOldBaseline
          ? '这台电脑的同步指纹落后服务器，旧文件不会自动上传覆盖新数据。'
          : '检测到批量删除、危险截断或其他高风险写入，已暂停上传等待确认。',
      action: 'recovery',
      actionLabel: '打开恢复中心',
      facts,
    };
  }

  if (serverError) {
    return {
      tone: 'error',
      label: '连接异常',
      title: '服务器或 WebSocket 需要检查',
      detail: serverError || '服务器 HTTP 可达但实时连接不稳定。检查 Tailscale/节点小宝、端口和 WebSocket 长连接。',
      action: 'refresh',
      actionLabel: '重新检查',
      facts,
    };
  }

  if (serverExperience?.status) {
    const status = String(serverExperience.status);
    const detail = String(serverExperience.detail || '');
    const title = String(serverExperience.title || '');
    const label = String(serverExperience.label || '');
    if (status === 'ready') {
      return {
        tone: 'ok',
        label: '正常',
        title: title || '实时同步已按服务器权威时间线运行',
        detail: detail || '服务器安全能力完整；旧基线、危险删除和冲突会进入保护/恢复流程。',
        action: 'refresh',
        actionLabel: '刷新状态',
        facts,
      };
    }
    if (status === 'needs_action') {
      const serverAction = String(serverExperience.action || '');
      return {
        tone: 'error',
        label: '需要处理',
        title: title || '同步需要先处理',
        detail: detail || '服务器或设备状态需要处理后再信任多设备同步。',
        action: serverAction === 'update_server' ? 'admin' : 'recovery',
        actionLabel: serverAction === 'update_server' ? '打开管理台' : '打开恢复中心',
        facts,
      };
    }
    if (status === 'protected_paused') {
      return {
        tone: 'paused',
        label: '已保护暂停',
        title: title || '同步已保护性暂停',
        detail: detail || '高风险写入已被暂停，先查看恢复中心再继续。',
        action: 'recovery',
        actionLabel: '打开恢复中心',
        facts,
      };
    }
    if (status === 'needs_attention') {
      return {
        tone: 'warning',
        label: '正常',
        title: title || '同步可用，但建议先确认',
        detail: detail || '建议运行同步自检或连接另一台电脑完成实时验证。',
        action: 'refresh',
        actionLabel: '刷新状态',
        facts,
      };
    }
    if (status === 'offline') {
      return {
        tone: connected ? 'warning' : 'offline',
        label: label || '未连接',
        title: title || '等待客户端连接',
        detail: detail || '填写服务器地址和密钥后加入现有 Vault。',
        action: 'refresh',
        actionLabel: '检查服务器',
        facts,
      };
    }
  }

  if (readiness?.status === 'warning' || health?.degraded || health?.diagnosticWarning) {
    return {
      tone: 'warning',
      label: '正常',
      title: health?.degraded ? '同步可用，链路较慢' : '同步可用，提醒已收起',
      detail: health?.degraded
        ? '服务器已经在线，实时同步可继续使用。链路较慢时 Ars-note 会保留队列并等待确认，不会让旧数据直接覆盖服务器。'
        : '服务器安全能力可用。恢复记录、单设备在线、历史提示这些信息已经收进高级诊断，不会打断普通加入流程。',
      action: 'refresh',
      actionLabel: '刷新状态',
      facts,
    };
  }

  if (connected || health?.ok) {
    return {
      tone: 'ok',
      label: '正常',
      title: '实时同步已受保护运行',
      detail: '服务器是权威时间线；旧电脑、缺基线文件和危险删除会被拦截进恢复中心。',
      action: 'refresh',
      actionLabel: '刷新状态',
      facts,
    };
  }

  return {
    tone: 'offline',
    label: '未连接',
    title: '还没有建立实时同步',
    detail: '填写服务器地址和密钥后，使用“加入现有 Vault”。',
    action: 'refresh',
    actionLabel: '检查服务器',
    facts,
  };
}

function normalizeRemoteVaultIdPreview(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
}

function isExactRemoteVaultId(value: string): boolean {
  const trimmed = String(value || '').trim();
  return !trimmed || /^[a-zA-Z0-9_-]{1,128}$/.test(trimmed);
}

const CATEGORY_TABS: { cat: RightCategory; tabs: RightTab[] }[] = [
  { cat: 'workspace', tabs: ['game', 'preview', 'templates'] },
  { cat: 'knowledge', tabs: ['outline', 'backlinks', 'graph', 'search'] },
  { cat: 'ai', tabs: ['ai'] },
];

function categoryForTab(tab: RightTab): RightCategory {
  for (const { cat, tabs } of CATEGORY_TABS) {
    if (tabs.includes(tab)) return cat;
  }
  return 'workspace';
}

interface RightPanelProps {
  activeTab: RightTab;
  onTabChange: (tab: RightTab) => void;
  settingsSection?: string;
  onSettingsSectionChange?: (section: string) => void;
  previewContent: string;
  searchQuery: string;
  searchResults: SearchResult[];
  onSearch: (query: string) => void;
  onSearchResultClick: (path: string) => void;
  onCreateFromTemplate: (templateId: string) => void;
  currentFilePath: string;
  vaultPath: string;
  currentTags: string[];
  groupedIncomingLinks: GroupedBacklink[];
  outgoingLinksInfo: OutgoingLinkInfo[];
  allVaultTags: [string, number][];
  tagToNotesMap: Map<string, TagNoteInfo[]>;
  noteCount: number;
  tagCount: number;
  graphData: GraphData;
  graphSummary: GraphSummary;
  lastManifest: VaultManifest | null;
  lastBackup: BackupSummary | null;
  backupBusy: boolean;
  backupList: BackupListItem[];
  restoreSummary: RestoreSummary | null;
  backupVerifyResult: BackupVerifyResult | null;
  verifyingBackupId: string;
  deletingBackupId: string;
  backupRetentionLimit: number;
  backupPruneSummary: BackupPruneSummary | null;
  backupPruneBusy: boolean;
  backupLifecycleMessage: string;
  backupFileList: BackupFileListResult | null;
  backupFileLoading: boolean;
  backupFileRestoreSummary: BackupFileRestoreSummary | null;
  restoringBackupFileKey: string;
  syncConfig: SyncConfig | null;
  onGenerateManifest: () => Promise<void>;
  onExportBackup: () => Promise<void>;
  onListBackups: () => Promise<void>;
  onRestoreBackup: (backupPath: string) => Promise<void>;
  onVerifyBackup: (backupPath: string, backupId: string) => Promise<void>;
  onListBackupFiles: (backupPath: string) => Promise<void>;
  onRestoreBackupFile: (backupPath: string, relativePath: string) => Promise<void>;
  onDeleteBackup: (backupPath: string, backupId: string) => Promise<void>;
  onBackupRetentionLimitChange: (value: number) => void;
  onPruneBackups: () => Promise<void>;
  onSaveSyncConfig: (config: SyncConfig) => Promise<void>;
  remoteBackups: RemoteBackupItem[];
  cloudUploadSummary: CloudUploadSummary | null;
  cloudDownloadSummary: CloudDownloadSummary | null;
  cloudBusy: boolean;
  deletingRemoteBackupId: string;
  onUploadBackupToRemote: (backupPath: string) => Promise<void>;
  onListRemoteBackups: () => Promise<void>;
  onDownloadRemoteBackup: (remoteId: string) => Promise<void>;
  onDeleteRemoteBackup: (remoteId: string) => Promise<void>;
  providerValidation: ProviderValidationResult | null;
  s3CredentialStatus: S3CredentialStatus | null;
  onSetS3Credentials: (credentials: S3RuntimeCredentials) => Promise<void>;
  onClearS3Credentials: () => Promise<void>;

  /* self-hosted credentials (v0.8.5) */
  selfHostedCredentialStatus: SelfHostedCredentialStatus | null;
  onSetSelfHostedCredentials: (credentials: SelfHostedRuntimeCredentials) => Promise<void>;
  onClearSelfHostedCredentials: () => Promise<void>;
  s3ConnectionTest: S3ConnectionTestResult | null;
  s3Testing: boolean;
  onTestS3Connection: () => Promise<void>;
  syncCompareResult: SyncCompareResult | null;
  syncBusy: boolean;
  onCompareLocalRemote: () => Promise<void>;
  onManualPush: () => Promise<void>;
  onManualPull: (remoteId: string) => Promise<void>;
  onCompareWithRemote: (remoteId: string) => Promise<void>;
  syncPreview: SyncPreviewResult | null;
  syncPreviewBusy: boolean;
  onPreviewRemoteDiff: (remoteId: string) => Promise<void>;
  downloadedBackups: DownloadedBackupItem[];
  downloadedVerifyResult: BackupVerifyResult | null;
  downloadedRestoreSummary: RestoreSummary | null;
  downloadedBusy: boolean;
  onListDownloadedBackups: () => Promise<void>;
  onVerifyDownloadedBackup: (downloadedPath: string) => Promise<void>;
  onRestoreDownloadedBackup: (downloadedPath: string) => Promise<void>;
  gameWorkspaceSummary: GameWorkspaceSummary;
  gameWorkspaceEntries: GameWorkspaceEntry[];
  onOpenTeamWorkspace?: () => void | Promise<void>;
  onCreateGameDoc: (type: GameDocType) => Promise<void>;
  onCreateNarrativeProductionKit: () => Promise<void>;
  gameDocCreating: boolean;
  onExportGameWorkspaceReport: () => Promise<void>;
  reportBusy: boolean;
  arshisConfig: import('../types').ArshisIntegrationConfig;
  onArshisConfigChange: (config: import('../types').ArshisIntegrationConfig) => void;
  onArshisExportGameContext: () => Promise<void>;
  arshisExporting: boolean;
  arshisExportMsg: string;
  /* AI Assistant (v1.1.0) */
  aiConfig: AIProviderConfig;
  onAISaveConfig: () => Promise<void>;
  onAITestConnection: () => Promise<void>;
  onAIClearConfig: () => Promise<void>;
  aiTesting: boolean;
  aiTestResult: AIConnectionTestResult | null;
  aiFormProvider: string;
  aiFormBaseUrl: string;
  aiFormModel: string;
  aiFormApiKey: string;
  onAIFormChange: (field: string, value: string) => void;
  aiChatMessages: AIChatMessage[];
  aiInput: string;
  aiContextMode: AIContextMode;
  aiControlMode: AIControlMode;
  aiContextUsage: AIContextUsage;
  aiSending: boolean;
  aiCanCancel: boolean;
  aiCanRetry: boolean;
  aiCopiedResponse: boolean;
  onAIInputChange: (value: string) => void;
  onAIContextModeChange: (mode: AIContextMode) => void;
  onAIControlModeChange: (mode: AIControlMode) => void;
  onAISendChat: (prompt: string) => Promise<void>;
  onAICancelChat: () => Promise<void>;
  onAIRetryLast: () => Promise<void>;
  onAICopyResponse: () => void;
  onAIImportTasksToSchedule?: () => Promise<void>;
  onRefreshVault?: () => Promise<void>;
  onRefreshIndex: () => Promise<void>;
  indexRefreshMsg: string;
  onTagClick: (tag: string) => void;
  onCreateMissingNote: (targetName: string) => Promise<void>;
  showConfirm: (title: string, message: string, options?: { confirmLabel?: string; confirmTone?: 'primary' | 'danger' }) => Promise<boolean>;
  onNotify?: (message: unknown, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  vaultIndex: VaultIndex;
  onJumpToLine?: (line: number) => void;
  onReloadCurrentFile?: () => Promise<void>;
}

/* ── Local image path resolution ── */

function resolveRelativePath(baseDir: string, relPath: string): string {
  const normalizedBase = baseDir.replace(/\\/g, '/');
  const parts = normalizedBase.split('/').filter(Boolean);
  const relParts = relPath.replace(/\\/g, '/').split('/');
  for (const part of relParts) {
    if (part === '..') { parts.pop(); }
    else if (part !== '.' && part !== '') { parts.push(part); }
  }
  return parts.join('/');
}

function isInsideVault(resolvedPath: string, vaultPath: string): boolean {
  const normResolved = resolvedPath.replace(/\\/g, '/').toLowerCase();
  const normVault = vaultPath.replace(/\\/g, '/').toLowerCase();
  return normResolved.startsWith(normVault);
}

const PreviewImage: React.FC<{
  src?: string; alt?: string;
  currentFilePath: string; vaultPath: string; notFoundText: string;
}> = ({ src, alt, currentFilePath, vaultPath, notFoundText }) => {
  const [error, setError] = useState(false);
  if (!src) return null;
  if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:') || src.startsWith('blob:')) {
    return <img src={src} alt={alt} className="preview-image" onError={() => setError(true)} />;
  }
  const fileDir = currentFilePath.includes('/')
    ? currentFilePath.substring(0, currentFilePath.lastIndexOf('/'))
    : currentFilePath.substring(0, currentFilePath.lastIndexOf('\\'));
  const resolved = resolveRelativePath(fileDir, src);
  if (!isInsideVault(resolved, vaultPath)) {
    return <div className="preview-image-missing">{notFoundText}</div>;
  }
  const fileUrl = 'file:///' + resolved.replace(/\\/g, '/');
  if (error) {
    return <div className="preview-image-missing">{notFoundText}{alt ? ' — ' + alt : ''}</div>;
  }
  return <img src={fileUrl} alt={alt} className="preview-image" onError={() => setError(true)} />;
};

/* ── Recent templates ── */
const RECENT_KEY = 'ars-note.recentTemplates';

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function formatHistoryReason(reason: string): string {
  if (/remote-delete/i.test(reason || '')) return '远端删除前';
  if (/delete|remove|trash|unlink|删除|移除/i.test(reason || '')) return '删除前备份';
  if (/server-rejected/i.test(reason || '')) return '服务器拒绝写入前';
  if (/conflict/i.test(reason || '')) return '冲突处理前';
  switch (reason) {
    case 'local-save': return '本地保存';
    case 'remote-overwrite': return '同步覆盖前';
    case 'before-history-restore': return '恢复前备份';
    case 'before-backup-file-restore': return '备份恢复前';
    case 'ai-write-file': return 'AI 写入前';
    case 'ai-delete-file': return 'AI 删除前';
    case 'ai-append-file': return 'AI 追加前';
    default: return reason || '自动保存';
  }
}

function formatRecoveryCandidateMeta(candidate: SyncRecoveryAdvisorItem['candidates'][number]): string {
  const time = candidate.savedAt || candidate.modifiedAt || candidate.updatedAt || '';
  const timeLabel = time ? String(time).replace('T', ' ').substring(0, 19) : '';
  const sourceLabel = candidate.label || candidate.source;
  const revision = candidate.serverRevision
    ? `服务器 rev ${candidate.serverRevision}`
    : candidate.revisionId || candidate.versionId
      ? `版本 ${String(candidate.revisionId || candidate.versionId).slice(0, 18)}`
      : '';
  const actor = candidate.deviceName
    ? `设备 ${candidate.deviceName}`
    : candidate.clientId
      ? `客户端 ${String(candidate.clientId).slice(0, 12)}`
      : candidate.deviceId
      ? `设备 ${String(candidate.deviceId).slice(0, 12)}`
      : candidate.source === 'current'
        ? '本机当前'
        : '';
  const hash = candidate.sha256 ? `hash ${candidate.sha256.slice(0, 8)}` : '';
  const deleted = candidate.deletedSnapshot ? '删除记录' : '';
  return [sourceLabel, revision, actor, timeLabel, hash, deleted].filter(Boolean).join(' · ');
}

function recoveryCandidateRole(candidate: SyncRecoveryAdvisorItem['candidates'][number]): {
  label: string;
  className: string;
} {
  switch (candidate.sourceRole || candidate.source) {
    case 'current-local':
    case 'current':
      return { label: '本机当前', className: 'local' };
    case 'same-computer-history':
    case 'local-history':
      return { label: '本机历史', className: 'local' };
    case 'other-computer-history':
      return { label: '其他电脑版本', className: 'remote' };
    case 'server-history':
      return { label: '服务器历史', className: 'server' };
    case 'conflict-copy':
    case 'conflict':
      return { label: '冲突副本', className: 'conflict' };
    case 'protected-local':
      return { label: '受保护本地差异', className: 'protected' };
    case 'ai-trash':
      return { label: 'AI 回收副本', className: 'ai' };
    default:
      return { label: candidate.label || candidate.source, className: 'unknown' };
  }
}

function formatRecoveryCandidateHeadline(candidate: SyncRecoveryAdvisorItem['candidates'][number]): string {
  if (candidate.deletedSnapshot) return '删除前快照';
  if (candidate.serverRevision) return `服务器 rev ${candidate.serverRevision}`;
  if (candidate.revisionId || candidate.versionId) return `版本 ${String(candidate.revisionId || candidate.versionId).slice(0, 18)}`;
  if (candidate.sha256) return `hash ${candidate.sha256.slice(0, 8)}`;
  return candidate.label || candidate.source;
}

function isRecoveryCandidateRecommended(
  item: SyncRecoveryAdvisorItem,
  candidate: SyncRecoveryAdvisorItem['candidates'][number],
): boolean {
  const picked = item.candidate;
  if (!picked) return item.recommendedAction === 'keep-current' && candidate.source === 'current';
  if (picked.recoveryRelativePath && candidate.recoveryRelativePath) {
    return picked.recoveryRelativePath === candidate.recoveryRelativePath;
  }
  if (picked.versionId && candidate.versionId) return picked.versionId === candidate.versionId;
  if (picked.revisionId && candidate.revisionId) return picked.revisionId === candidate.revisionId;
  if (picked.sha256 && candidate.sha256 && picked.source === candidate.source) return picked.sha256 === candidate.sha256;
  return picked.source === candidate.source && picked.relativePath === candidate.relativePath;
}

function formatShortDuration(seconds: number | undefined | null): string {
  if (!Number.isFinite(seconds || NaN)) return '-';
  const total = Math.max(0, Math.floor(seconds || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}天 ${hours}小时`;
  if (hours > 0) return `${hours}小时 ${minutes}分钟`;
  if (minutes > 0) return `${minutes}分钟`;
  return `${total}秒`;
}

/* ── Main panel ── */

const RightPanel: React.FC<RightPanelProps> = ({
  activeTab, onTabChange, settingsSection = 'home', onSettingsSectionChange, previewContent, searchQuery, searchResults,
  onSearch, onSearchResultClick, onCreateFromTemplate, currentFilePath, vaultPath,
  currentTags, groupedIncomingLinks, outgoingLinksInfo, allVaultTags, tagToNotesMap,
  noteCount, tagCount, graphData, graphSummary,
  lastManifest, lastBackup, backupBusy, backupList, restoreSummary,
  backupVerifyResult, verifyingBackupId, deletingBackupId,
  backupRetentionLimit, backupPruneSummary, backupPruneBusy, backupLifecycleMessage,
  backupFileList, backupFileLoading, backupFileRestoreSummary, restoringBackupFileKey,
  syncConfig,
  onGenerateManifest, onExportBackup, onListBackups, onRestoreBackup, onVerifyBackup, onListBackupFiles, onRestoreBackupFile, onDeleteBackup,
  onBackupRetentionLimitChange, onPruneBackups,
  onSaveSyncConfig,
  remoteBackups, cloudUploadSummary, cloudDownloadSummary, cloudBusy, deletingRemoteBackupId,
  onUploadBackupToRemote, onListRemoteBackups, onDownloadRemoteBackup, onDeleteRemoteBackup,
  providerValidation,
  s3CredentialStatus, onSetS3Credentials, onClearS3Credentials,
  s3ConnectionTest, s3Testing, onTestS3Connection,
  selfHostedCredentialStatus, onSetSelfHostedCredentials, onClearSelfHostedCredentials,
  syncCompareResult, syncBusy, onCompareLocalRemote, onManualPush, onManualPull, onCompareWithRemote,
  syncPreview, syncPreviewBusy, onPreviewRemoteDiff,
  downloadedBackups, downloadedVerifyResult, downloadedRestoreSummary, downloadedBusy,
  onListDownloadedBackups, onVerifyDownloadedBackup, onRestoreDownloadedBackup,
  onRefreshIndex, indexRefreshMsg, onTagClick, onCreateMissingNote, showConfirm,
  gameWorkspaceSummary, gameWorkspaceEntries, onOpenTeamWorkspace,
  onCreateGameDoc, onCreateNarrativeProductionKit, gameDocCreating,
  onExportGameWorkspaceReport, reportBusy,
  arshisConfig, onArshisConfigChange, onArshisExportGameContext, arshisExporting, arshisExportMsg,
  aiConfig, onAISaveConfig, onAITestConnection, onAIClearConfig, aiTesting, aiTestResult,
  aiFormProvider, aiFormBaseUrl, aiFormModel, aiFormApiKey, onAIFormChange,
  aiChatMessages, aiInput, aiContextMode, aiControlMode, aiContextUsage, aiSending, aiCanCancel, aiCanRetry, aiCopiedResponse,
  onAIInputChange, onAIContextModeChange, onAIControlModeChange, onAISendChat, onAICancelChat, onAIRetryLast, onAICopyResponse, onAIImportTasksToSchedule, onRefreshVault,
  vaultIndex,
  onJumpToLine,
  onReloadCurrentFile,
  onNotify,
}) => {
  const { t, language } = useI18n();
  const notify = React.useCallback((message: unknown, tone: 'info' | 'success' | 'warning' | 'error' = 'error') => {
    if (onNotify) {
      onNotify(message, tone);
      return;
    }
    console.warn(message);
  }, [onNotify]);
  const categories = getCategories(t, language);
  const templates = getTemplates(t, language);

  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [aiQuickPromptsOpen, setAiQuickPromptsOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('ars-note.right.ai.quickPromptsOpen') === 'true'; } catch { return false; }
  });
  const [aiToolsOpen, setAiToolsOpen] = useState(false);
  const [settingsShowAdvanced, setSettingsShowAdvanced] = useState<boolean>(() => {
    try { return localStorage.getItem('ars-note.settings.showAdvanced') === 'true'; } catch { return false; }
  });
  const [syncRecoveryToolsOpen, setSyncRecoveryToolsOpen] = useState(false);
  const [versionHistoryAdvancedOpen, setVersionHistoryAdvancedOpen] = useState(false);
  const aiMessagesRef = useRef<HTMLDivElement | null>(null);
  const activeSettingsSection = settingsSection || 'home';
  const aiChatScrollToken = getAIChatScrollToken(aiChatMessages, aiSending ? 'sending' : 'idle');
  useAIChatAutoScroll(aiMessagesRef, activeTab === 'ai', aiChatScrollToken);

  useEffect(() => {
    try { localStorage.setItem('ars-note.right.ai.quickPromptsOpen', aiQuickPromptsOpen ? 'true' : 'false'); } catch { /* ignore */ }
  }, [aiQuickPromptsOpen]);

  useEffect(() => {
    try { localStorage.setItem('ars-note.settings.showAdvanced', settingsShowAdvanced ? 'true' : 'false'); } catch { /* ignore */ }
  }, [settingsShowAdvanced]);

  /* Sync config local edit state */
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [syncProvider, setSyncProvider] = useState<SyncProvider>('local');
  const [syncEndpoint, setSyncEndpoint] = useState('');
  const [syncBucket, setSyncBucket] = useState('');
  const [syncRemoteVaultId, setSyncRemoteVaultId] = useState('');

  /* S3 Runtime Credentials local edit state (v0.5.3) */
  const [s3Endpoint, setS3Endpoint] = useState('');
  const [s3Region, setS3Region] = useState('us-east-1');
  const [s3Bucket, setS3Bucket] = useState('');
  const [s3AccessKey, setS3AccessKey] = useState('');
  const [s3SecretKey, setS3SecretKey] = useState('');
  const [s3ForcePathStyle, setS3ForcePathStyle] = useState(false);

  /* self-hosted credential state (v0.8.5) */
  const [shEndpoint, setShEndpoint] = useState('');
  const [shApiKey, setShApiKey] = useState('');
  const liveSyncTimelineStorageKey = useMemo(() => `ars-note.live-sync.timeline:${vaultPath || 'global'}`, [vaultPath]);
  const [liveSyncTimeline, setLiveSyncTimeline] = useState<LiveSyncTimelineItem[]>([]);
  const liveSyncStatusTimerRef = React.useRef<number | null>(null);
  const liveSyncHealthInFlightRef = React.useRef(false);

  React.useEffect(() => {
    return () => {
      if (liveSyncStatusTimerRef.current !== null) {
        window.clearTimeout(liveSyncStatusTimerRef.current);
        liveSyncStatusTimerRef.current = null;
      }
    };
  }, []);

  const addLiveSyncTimeline = React.useCallback((entry: Omit<LiveSyncTimelineItem, 'id' | 'timestamp'> & { timestamp?: string }) => {
    const item: LiveSyncTimelineItem = {
      id: `${entry.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString(),
    };
    setLiveSyncTimeline((prev) => {
      const last = prev[0];
      if (
        last &&
        last.kind === item.kind &&
        last.title === item.title &&
        last.detail === item.detail &&
        last.status === item.status &&
        Math.abs(new Date(item.timestamp).getTime() - new Date(last.timestamp).getTime()) < LIVE_SYNC_TIMELINE_DEDUPE_MS
      ) {
        return prev;
      }
      const next = [item, ...prev].slice(0, LIVE_SYNC_TIMELINE_LIMIT);
      try { localStorage.setItem(liveSyncTimelineStorageKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [liveSyncTimelineStorageKey]);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(liveSyncTimelineStorageKey);
      setLiveSyncTimeline(raw ? JSON.parse(raw).slice(0, LIVE_SYNC_TIMELINE_LIMIT) : []);
    } catch {
      setLiveSyncTimeline([]);
    }
  }, [liveSyncTimelineStorageKey]);

  /* Initialize sync edit state from loaded config */
  React.useEffect(() => {
    if (syncConfig) {
      setSyncEnabled(syncConfig.enabled);
      setSyncProvider(syncConfig.provider);
      setSyncEndpoint(syncConfig.endpoint || '');
      setSyncBucket(syncConfig.bucket || '');
      setSyncRemoteVaultId(syncConfig.remoteVaultId || '');
    }
  }, [syncConfig]);

  /* Live Sync — listen for status changes and load saved config */
  React.useEffect(() => {
    const api = (window as any).arsnote;
    if (!api) return;

    const applySavedLiveConfig = (cfg: any) => {
      if (!cfg) return;
      if (cfg.serverUrl) setLiveSyncUrl(cfg.serverUrl);
      if (cfg.apiKey) setLiveSyncApiKey(cfg.apiKey);
      if (cfg.connectionMode === 'rebuild' || cfg.connectionMode === 'join') {
        setLiveSyncConnectionMode(cfg.connectionMode);
      }
    };

    try {
      const saved = localStorage.getItem('ars-note.live-sync');
      const rendererConfig = saved ? JSON.parse(saved) : null;
      if (rendererConfig && typeof rendererConfig === 'object') delete rendererConfig.apiKey;
      applySavedLiveConfig(rendererConfig);
    } catch {}

    if (vaultPath && api.liveSyncLoadConfig) {
      api.liveSyncLoadConfig(vaultPath).then((cfg: any) => {
        applySavedLiveConfig(cfg || (syncConfig?.endpoint ? {
          serverUrl: syncConfig.endpoint,
          vaultId: syncConfig.remoteVaultId,
        } : null));
      }).catch(() => {});
    } else if (syncConfig?.endpoint) {
      setLiveSyncUrl(syncConfig.endpoint);
    }

    const applyAutoConnectProtection = (notice: any) => {
      if (!notice || typeof notice !== 'object') return;
      if (notice.vaultPath && vaultPath && notice.vaultPath !== vaultPath) return;
      const summary = notice.summary || notice.error || '实时同步自动连接已被安全预检暂停。';
      const blockers = Array.isArray(notice.blockers) ? notice.blockers.slice(0, 3) : [];
      const actions = Array.isArray(notice.actions) ? notice.actions.slice(0, 2) : [];
      const detail = [
        summary,
        blockers.length ? `阻止项：${blockers.join('；')}` : '',
        actions.length ? `建议：${actions.join('；')}` : '',
      ].filter(Boolean).join(' ');
      setLiveSyncError(detail);
      if (notice.config?.serverUrl) setLiveSyncUrl(notice.config.serverUrl);
      setLiveSyncConnectionMode('join');
      addLiveSyncTimeline({
        kind: 'status',
        title: '实时同步自动连接已保护暂停',
        detail,
        status: 'warn',
        timestamp: notice.checkedAt || new Date().toISOString(),
      });
    };

    try {
      const autoConnectProtection = localStorage.getItem('ars-note.live-sync.auto-connect-protection');
      applyAutoConnectProtection(autoConnectProtection ? JSON.parse(autoConnectProtection) : null);
    } catch {}

    const onAutoConnectProtected = (event: Event) => {
      applyAutoConnectProtection((event as CustomEvent).detail);
    };
    window.addEventListener('ars-note:live-sync-auto-connect-protected', onAutoConnectProtected as EventListener);

    /* Listen for live sync status changes */
    const unsubStatus = api.onLiveSyncStatus?.((data: any) => {
      setLiveSyncConnected(data.connected);
      if (data.clientId) setLiveSyncClientId(data.clientId);
      if (data.connectionMode === 'rebuild' || data.connectionMode === 'join') {
        setLiveSyncConnectionMode(data.connectionMode);
      }
      if (data.connected) {
        setLiveSyncError('');
        try { localStorage.removeItem('ars-note.live-sync.auto-connect-protection'); } catch {}
        setLiveSyncConnecting(false);
        if (liveSyncStatusTimerRef.current !== null) {
          window.clearTimeout(liveSyncStatusTimerRef.current);
          liveSyncStatusTimerRef.current = null;
        }
      }
      const adoption = data.serverAuthorityAdoption || null;
      const adoptionProtectedCount = Number(adoption?.protectedCount || 0);
      addLiveSyncTimeline({
        kind: 'status',
        title: adoptionProtectedCount > 0
          ? '已安全加入服务器时间线'
          : data.connected
          ? (data.uploadFrozen ? '同步前校验已保护性暂停上传' : (data.preflightComplete ? '同步前校验完成' : '实时同步已连接，等待服务器快照'))
          : '实时同步已断开',
        detail: adoptionProtectedCount > 0
          ? `已保护 ${adoptionProtectedCount} 个本机旧差异；服务器版本已成为当前基线，旧内容可在恢复中心找回。`
          : data.error || data.warning || (data.uploadFrozen
          ? `原因：${data.uploadFrozenReason || '等待服务器快照'}；本机队列会先保留，不会直接覆盖服务器。`
          : (data.preflightBlockedUploadCount
            ? `已阻止 ${data.preflightBlockedUploadCount} 个无服务器基线的本地文件自动上传。`
            : (data.preflightComplete ? '已完成远端快照对账，允许上传本地队列' : data.serverUrl || data.vaultId || ''))),
        status: adoptionProtectedCount > 0 ? 'ok' : (data.connected ? ((data.uploadFrozen || data.warning) ? 'warn' : 'ok') : (data.error ? 'error' : 'warn')),
        timestamp: data.connectedAt || new Date().toISOString(),
      });
    });

    /* Listen for live sync activity */
    const unsubActivity = api.onLiveSyncActivity?.((data: any) => {
      setLiveSyncActivity(prev => [data, ...prev].slice(0, 50));
      addLiveSyncTimeline({
        kind: 'activity',
        title: String(data.action || '').startsWith('server-rejected-') ? '同步保护拦截旧写入' : (data.direction === 'in' ? '收到远端更新' : '已上传本地更改'),
        detail: `${data.action || 'update'} · ${data.relativePath || ''}`,
        status: String(data.action || '').startsWith('server-rejected-') ? 'warn' : 'info',
        direction: data.direction,
        relativePath: data.relativePath,
        timestamp: data.timestamp,
      });
    });

    const unsubConflict = api.onLiveSyncConflict?.((data: any) => {
      addLiveSyncTimeline({
        kind: 'conflict',
        title: '发现同步冲突',
        detail: data.relativePath || data.backupFile || '',
        status: 'warn',
        relativePath: data.relativePath,
        timestamp: data.timestamp,
      });
      refreshConflictSummary();
    });

    /* Listen for version mismatch warnings */
    const unsubVersionCheck = api.onLiveSyncVersionCheck?.((data: any) => {
      if (data && !data.match) {
        setLiveSyncVersionWarning(data.message || `Server v${data.serverVersion}, client v${data.clientVersion}`);
        addLiveSyncTimeline({
          kind: 'status',
          title: '版本不一致',
          detail: data.message || `Server v${data.serverVersion}, client v${data.clientVersion}`,
          status: 'warn',
          timestamp: new Date().toISOString(),
        });
      } else {
        setLiveSyncVersionWarning(null);
      }
    });

    /* Check current status */
    api.liveSyncStatus?.().then((status: any) => {
      if (status) {
        setLiveSyncConnected(status.connected);
        if (status.clientId) setLiveSyncClientId(status.clientId);
        if (status.serverUrl) setLiveSyncUrl(status.serverUrl);
        addLiveSyncTimeline({
          kind: 'status',
          title: status.connected ? '当前实时同步在线' : '当前实时同步离线',
          detail: status.serverUrl || status.vaultId || '',
          status: status.connected ? 'ok' : 'warn',
          timestamp: status.connectedAt || new Date().toISOString(),
        });
      }
    }).catch(() => {});

    return () => {
      unsubStatus?.();
      unsubActivity?.();
      unsubConflict?.();
      unsubVersionCheck?.();
      window.removeEventListener('ars-note:live-sync-auto-connect-protected', onAutoConnectProtected as EventListener);
    };
  }, [addLiveSyncTimeline, vaultPath, syncConfig?.endpoint, syncConfig?.remoteVaultId]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedAmbiguous, setExpandedAmbiguous] = useState<Set<string>>(new Set());
  const [expandedIncoming, setExpandedIncoming] = useState<Set<string>>(new Set());
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [linkFilter, setLinkFilter] = useState('');

  /* Sync Wizard state (v0.7.0) */
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0); // 0..6
  const [wizardProvider, setWizardProvider] = useState<SyncProvider>('local');
  const [wizardS3Endpoint, setWizardS3Endpoint] = useState('');
  const [wizardS3Region, setWizardS3Region] = useState('us-east-1');
  const [wizardS3Bucket, setWizardS3Bucket] = useState('');
  const [wizardS3AccessKey, setWizardS3AccessKey] = useState('');
  const [wizardS3SecretKey, setWizardS3SecretKey] = useState('');
  const [wizardS3ForcePathStyle, setWizardS3ForcePathStyle] = useState(false);
  const [wizardShApiKey, setWizardShApiKey] = useState('');
  const [wizardTesting, setWizardTesting] = useState(false);
  const [wizardTestOk, setWizardTestOk] = useState<boolean | null>(null);
  const [wizardCreating, setWizardCreating] = useState(false);
  const [wizardBackupCreated, setWizardBackupCreated] = useState(false);
  const [wizardUploading, setWizardUploading] = useState(false);
  const [wizardUploaded, setWizardUploaded] = useState(false);
  const [wizardBackupPath, setWizardBackupPath] = useState('');

  /* AI Memory Sync state (must be top-level for rules of hooks) */
  const [aiSyncBusy, setAiSyncBusy] = useState<'now' | 'push' | 'pull' | 'status' | null>(null);
  const [aiSyncMsg, setAiSyncMsg] = useState('');
  const [aiSyncRemoteInfo, setAiSyncRemoteInfo] = useState<{hasData: boolean; syncedAt: string; fileCount: number; files: string[]} | null>(null);

  /* Live Sync state (real-time vault sync) */
  const [liveSyncUrl, setLiveSyncUrl] = useState('');
  const [liveSyncApiKey, setLiveSyncApiKey] = useState('');
  const [liveSyncConnectionMode, setLiveSyncConnectionMode] = useState<'join' | 'rebuild'>('join');
  const [liveSyncConnected, setLiveSyncConnected] = useState(false);
  const [liveSyncClientId, setLiveSyncClientId] = useState('');
  const [liveSyncConnecting, setLiveSyncConnecting] = useState(false);
  const [liveSyncVersionWarning, setLiveSyncVersionWarning] = useState<string | null>(null);
  const [liveSyncError, setLiveSyncError] = useState('');
  const [liveSyncPreflightGuidance, setLiveSyncPreflightGuidance] = useState<any>(null);
  const [liveSyncActivity, setLiveSyncActivity] = useState<Array<{direction: string; action: string; relativePath: string; timestamp: string}>>([]);
  const [liveSyncHealth, setLiveSyncHealth] = useState<any>(null);
  const [liveSyncHealthLoading, setLiveSyncHealthLoading] = useState(false);
  const [liveSyncServerToolMsg, setLiveSyncServerToolMsg] = useState('');
  const [liveSyncSafeDeleteQueue, setLiveSyncSafeDeleteQueue] = useState<any[]>([]);
  const [liveSyncSafeDeleteBusy, setLiveSyncSafeDeleteBusy] = useState('');
  const [liveSyncSelfTest, setLiveSyncSelfTest] = useState<LiveSyncSelfTestResult | null>(null);
  const [liveSyncSelfTesting, setLiveSyncSelfTesting] = useState(false);
  const [conflictSummary, setConflictSummary] = useState<{count: number; totalSize: number; files: SyncConflictFile[]} | null>(null);
  const [syncRecoveryOverview, setSyncRecoveryOverview] = useState<SyncRecoveryOverview | null>(null);
  const [syncRecoveryLoading, setSyncRecoveryLoading] = useState(false);
  const [syncRecoveryMessage, setSyncRecoveryMessage] = useState('');
  const [accidentRecoveryPlan, setAccidentRecoveryPlan] = useState<SyncAccidentRecoveryPlan | null>(null);
  const [accidentRecoveryBusy, setAccidentRecoveryBusy] = useState(false);
  const [accidentRecoveryMessage, setAccidentRecoveryMessage] = useState('');
  const [recoveryAdvisorPlan, setRecoveryAdvisorPlan] = useState<SyncRecoveryAdvisorPlan | null>(null);
  const [recoveryAdvisorBusy, setRecoveryAdvisorBusy] = useState(false);
  const [recoveryAdvisorMessage, setRecoveryAdvisorMessage] = useState('');
  const [recoveryAdvisorActionBusy, setRecoveryAdvisorActionBusy] = useState('');
  const [safeRecoveryAutopilotBusy, setSafeRecoveryAutopilotBusy] = useState(false);
  const [safeRecoveryAutopilotMessage, setSafeRecoveryAutopilotMessage] = useState('');
  const [conflictPreview, setConflictPreview] = useState<SyncConflictPreview | null>(null);
  const [conflictPreviewLoading, setConflictPreviewLoading] = useState(false);
  const [conflictActionBusy, setConflictActionBusy] = useState('');
  const [conflictScanning, setConflictScanning] = useState(false);
  const [conflictCleaning, setConflictCleaning] = useState(false);
  const [conflictMessage, setConflictMessage] = useState('');
  const [conflictMergeText, setConflictMergeText] = useState('');
  const [conflictMergeDeleteAfterSave, setConflictMergeDeleteAfterSave] = useState(true);
  const [liveHistory, setLiveHistory] = useState<LiveHistoryItem[]>([]);
  const [historyPreview, setHistoryPreview] = useState<LiveHistoryPreview | null>(null);
  const [historyPreviewSource, setHistoryPreviewSource] = useState<'local' | 'server'>('local');
  const [historyPreviewLoading, setHistoryPreviewLoading] = useState(false);
  const [historyActionBusy, setHistoryActionBusy] = useState('');
  const [historyMessage, setHistoryMessage] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [batchRestorePlan, setBatchRestorePlan] = useState<LiveHistoryBatchRestorePlan | null>(null);
  const [batchRestoreBusy, setBatchRestoreBusy] = useState(false);
  const [batchRestoreMessage, setBatchRestoreMessage] = useState('');
  const [serverBatchRestorePlan, setServerBatchRestorePlan] = useState<LiveHistoryBatchRestorePlan | null>(null);
  const [serverBatchRestoreBusy, setServerBatchRestoreBusy] = useState(false);
  const [serverBatchRestoreMessage, setServerBatchRestoreMessage] = useState('');

  useEffect(() => {
    if (!settingsShowAdvanced && !liveSyncConnected && liveSyncConnectionMode === 'rebuild') {
      setLiveSyncConnectionMode('join');
    }
  }, [settingsShowAdvanced, liveSyncConnected, liveSyncConnectionMode]);
  const [serverLiveHistory, setServerLiveHistory] = useState<LiveHistoryItem[]>([]);
  const [serverRecoveryHistory, setServerRecoveryHistory] = useState<LiveHistoryItem[]>([]);
  const [serverRecoveryError, setServerRecoveryError] = useState('');
  const [serverHistoryLoading, setServerHistoryLoading] = useState(false);
  const [serverHistoryMessage, setServerHistoryMessage] = useState('');
  const [serverSnapshots, setServerSnapshots] = useState<ServerDataSnapshotItem[]>([]);
  const [serverSnapshotFiles, setServerSnapshotFiles] = useState<ServerSnapshotFileCandidate[]>([]);
  const [serverSnapshotSelected, setServerSnapshotSelected] = useState('');
  const [serverSnapshotQuery, setServerSnapshotQuery] = useState('');
  const [serverSnapshotBusy, setServerSnapshotBusy] = useState('');
  const [serverSnapshotMessage, setServerSnapshotMessage] = useState('');
  const [protectedLocalActionBusy, setProtectedLocalActionBusy] = useState('');
  const [protectedLocalMessage, setProtectedLocalMessage] = useState('');
  const [aiTrashActionBusy, setAiTrashActionBusy] = useState('');
  const [aiTrashMessage, setAiTrashMessage] = useState('');
  const [aiMemoryOverview, setAiMemoryOverview] = useState<any>(null);
  const [aiMemoryLoading, setAiMemoryLoading] = useState(false);
  const [newMemoryEntry, setNewMemoryEntry] = useState('');
  const [aiMemoryActionBusy, setAiMemoryActionBusy] = useState(false);
  const [aiSafetySelfTest, setAiSafetySelfTest] = useState<AISafetySelfTestResult | null>(null);
  const [aiSafetyTesting, setAiSafetyTesting] = useState(false);
  const [aiOperationAudit, setAiOperationAudit] = useState<AIOperationAuditEvent[]>([]);
  const [aiAuditLoading, setAiAuditLoading] = useState(false);
  const [aiRollbackPreview, setAiRollbackPreview] = useState<AIOperationRollbackPreview | null>(null);
  const [aiRollbackBusy, setAiRollbackBusy] = useState('');
  const [aiAuditMessage, setAiAuditMessage] = useState('');
  const [storageReport, setStorageReport] = useState<VaultStorageReport | null>(null);
  const [storageCleanupSummary, setStorageCleanupSummary] = useState<VaultStorageCleanupSummary | null>(null);
  const [storageScanning, setStorageScanning] = useState(false);
  const [storageCleaning, setStorageCleaning] = useState(false);
  const [storageKeepLatestBackups, setStorageKeepLatestBackups] = useState(2);
  const [storageMessage, setStorageMessage] = useState('');

  const currentFileRel = useMemo(() => {
    if (!vaultPath || !currentFilePath) return '';
    const normalizedVault = vaultPath.replace(/\\/g, '/').replace(/\/+$/, '');
    const normalizedFile = currentFilePath.replace(/\\/g, '/');
    if (!normalizedFile.toLowerCase().startsWith(normalizedVault.toLowerCase())) return '';
    return normalizedFile.slice(normalizedVault.length).replace(/^\/+/, '');
  }, [vaultPath, currentFilePath]);
  const aiSyncLocalOverview = aiMemoryOverview?.syncOverview || null;
  const aiSyncLocalFiles: string[] = Array.isArray(aiSyncLocalOverview?.syncedFiles)
    ? aiSyncLocalOverview.syncedFiles
    : Array.isArray(aiMemoryOverview?.syncFiles)
      ? aiMemoryOverview.syncFiles
      : [];
  const aiSyncRemoteFiles: string[] = Array.isArray(aiSyncRemoteInfo?.files) ? aiSyncRemoteInfo.files : [];
  const aiSyncLocalBreakdown = getAiSyncFileBreakdown(aiSyncLocalFiles);
  const aiSyncRemoteBreakdown = getAiSyncFileBreakdown(aiSyncRemoteFiles);
  const aiSyncLocalPreview = previewAiSyncFiles(aiSyncLocalFiles);
  const aiSyncRemotePreview = previewAiSyncFiles(aiSyncRemoteFiles);
  const aiSyncExcludedRules: string[] = Array.isArray(aiSyncLocalOverview?.excludedRules)
    ? aiSyncLocalOverview.excludedRules
    : ['live-session.json', 'history/', '*.conflict-*'];
  const serverRecoveryDeletedItems = useMemo(() => (
    serverRecoveryHistory.filter((item) => !!item.deletedSnapshot)
  ), [serverRecoveryHistory]);
  const serverRecoveryRejectedItems = useMemo(() => (
    serverRecoveryHistory
      .filter((item) => /rejected|stale|base|missing|delete-storm/i.test(`${item.reason || ''} ${item.versionId || ''}`))
  ), [serverRecoveryHistory]);
  const serverRecoveryDeletedRecent = useMemo(() => serverRecoveryDeletedItems.slice(0, 5), [serverRecoveryDeletedItems]);
  const serverRecoveryRejectedRecent = useMemo(() => serverRecoveryRejectedItems.slice(0, 5), [serverRecoveryRejectedItems]);
  const appliedAiAuditEvents = useMemo(() => (
    aiOperationAudit.filter((event) => (event.event === 'applied' || event.event === 'direct_applied') && !!event.token)
  ), [aiOperationAudit]);
  const syncRemoteVaultIdTrimmed = syncRemoteVaultId.trim();
  const syncRemoteVaultIdPreview = useMemo(() => normalizeRemoteVaultIdPreview(syncRemoteVaultIdTrimmed), [syncRemoteVaultIdTrimmed]);
  const syncRemoteVaultIdInvalid = syncProvider === 'self-hosted' && !!syncRemoteVaultIdTrimmed && !isExactRemoteVaultId(syncRemoteVaultIdTrimmed);
  const syncRemoteVaultIdWarning = syncRemoteVaultIdInvalid
    ? (language === 'zh-CN'
      ? `这个不是服务器可用的 Vault ID。请从服务器 /admin 里复制 Vault 名称下面那串 ID。当前输入如果被清洗会变成 "${syncRemoteVaultIdPreview || '-'}"，容易连错库。`
      : `This is not a valid server Vault ID. Copy the ID shown under the vault name in /admin. If sanitized, this value would become "${syncRemoteVaultIdPreview || '-'}", which can connect to the wrong vault.`)
    : '';
  const liveSyncServerBaseUrl = useMemo(() => normalizeServerBaseUrl(
    liveSyncUrl || liveSyncHealth?.local?.serverUrl || selfHostedCredentialStatus?.endpoint || syncConfig?.endpoint || ''
  ), [liveSyncUrl, liveSyncHealth?.local?.serverUrl, selfHostedCredentialStatus?.endpoint, syncConfig?.endpoint]);
  const liveSyncAdminUrl = useMemo(() => buildServerAdminUrl(liveSyncServerBaseUrl), [liveSyncServerBaseUrl]);
  const liveSyncExpectedWebSocketUrl = liveSyncHealth?.server?.webSocket?.url || (
    liveSyncServerBaseUrl
      ? `${liveSyncServerBaseUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')}/ws/live-sync?vaultId=${encodeURIComponent(liveSyncHealth?.local?.vaultId || syncConfig?.remoteVaultId || '<vaultId>')}`
      : ''
  );
  const liveSyncServerClients = useMemo(() => {
    const history = liveSyncHealth?.server?.clientHistory;
    if (Array.isArray(history) && history.length > 0) return history;
    const clients = liveSyncHealth?.server?.clients;
    return Array.isArray(clients) ? clients : [];
  }, [liveSyncHealth]);
  const liveSyncServerClientEvents = useMemo(() => {
    const events = liveSyncHealth?.server?.clientEvents;
    return Array.isArray(events) ? events : [];
  }, [liveSyncHealth]);
  const liveSyncDiagnosticText = useMemo(() => [
    'Ars-note Live Sync diagnostics',
    `Server: ${liveSyncServerBaseUrl || '-'}`,
    `Admin: ${liveSyncAdminUrl || '-'}`,
    `Expected WebSocket: ${liveSyncExpectedWebSocketUrl || '-'}`,
    `Vault ID: ${liveSyncHealth?.local?.vaultId || syncConfig?.remoteVaultId || '-'}`,
    `Vault ID auto resolved: ${liveSyncHealth?.local?.vaultIdAutoResolved ? `${liveSyncHealth.local.vaultIdAutoResolved.previousVaultId || '-'} -> ${liveSyncHealth.local.vaultIdAutoResolved.vaultId || '-'} (${liveSyncHealth.local.vaultIdAutoResolved.reason || '-'})` : '-'}`,
    `Connected: ${liveSyncHealth?.local?.connected ? 'yes' : 'no'}`,
    `Server version: ${liveSyncHealth?.server?.serverVersion || liveSyncHealth?.server?.version || '-'}`,
    `Safety capabilities: ${liveSyncSafetyCompatibilityLabel(liveSyncHealth)}`,
    `Missing safety capabilities: ${liveSyncMissingSafetyCapabilityLabels(liveSyncHealth).join(' | ') || '-'}`,
    `Launch readiness: ${liveSyncLaunchReadinessLabel(liveSyncHealth)}`,
    `Launch blockers: ${Array.isArray(liveSyncHealth?.launchReadiness?.blockers) ? liveSyncHealth.launchReadiness.blockers.join(' | ') || '-' : '-'}`,
    `Launch warnings: ${Array.isArray(liveSyncHealth?.launchReadiness?.warnings) ? liveSyncHealth.launchReadiness.warnings.join(' | ') || '-' : '-'}`,
    `Launch actions: ${Array.isArray(liveSyncHealth?.launchReadiness?.actions) ? liveSyncHealth.launchReadiness.actions.join(' | ') || '-' : '-'}`,
    `Storage: ${liveSyncHealth?.server?.storageBackend || '-'}`,
    `Online clients for vault: ${typeof liveSyncHealth?.server?.vaultClients === 'number' ? liveSyncHealth.server.vaultClients : '-'}`,
    `Server vault identity exact: ${typeof liveSyncHealth?.server?.vaultIdentity?.exactMatch === 'boolean' ? (liveSyncHealth.server.vaultIdentity.exactMatch ? 'yes' : 'no') : '-'}`,
    `Same-name vault candidates: ${Array.isArray(liveSyncHealth?.server?.vaultIdentity?.nameMatches) ? liveSyncHealth.server.vaultIdentity.nameMatches.map((item: any) => `${item.vaultName}=${item.vaultId}`).join(' | ') || '-' : '-'}`,
    `Vault identity advice: ${Array.isArray(liveSyncHealth?.server?.vaultIdentity?.advice) ? liveSyncHealth.server.vaultIdentity.advice.join(' | ') : (liveSyncHealth?.server?.vaultIdentityError || '-')}`,
    `Total connections: ${typeof liveSyncHealth?.server?.totalConnections === 'number' ? liveSyncHealth.server.totalConnections : '-'}`,
    `Latency: ${typeof liveSyncHealth?.local?.latencyMs === 'number' ? `${liveSyncHealth.local.latencyMs} ms` : '-'}`,
    `Last pong: ${liveSyncHealth?.local?.lastPongAt || '-'}`,
    `Upload frozen: ${liveSyncHealth?.local?.uploadFrozen ? 'yes' : 'no'}`,
    `Upload frozen reason: ${liveSyncHealth?.local?.uploadFrozenReason || '-'}`,
    `Preflight blocked uploads: ${liveSyncHealth?.local?.preflightBlockedUploadCount || 0}`,
    `Preflight blocked files: ${Array.isArray(liveSyncHealth?.local?.preflightBlockedUploadFiles) ? liveSyncHealth.local.preflightBlockedUploadFiles.join(' | ') || '-' : '-'}`,
    `Server-authoritative adoption: ${liveSyncHealth?.local?.serverAuthorityAdoption ? `protected=${liveSyncHealth.local.serverAuthorityAdoption.protectedCount || 0} mode=${liveSyncHealth.local.serverAuthorityAdoption.mode || '-'} reason=${liveSyncHealth.local.serverAuthorityAdoption.reason || '-'}` : '-'}`,
    `Server-authoritative protected files: ${Array.isArray(liveSyncHealth?.local?.serverAuthorityAdoption?.files) ? liveSyncHealth.local.serverAuthorityAdoption.files.join(' | ') || '-' : '-'}`,
    `Auto archived conflicts: ${liveSyncHealth?.local?.autoArchivedConflicts?.archivedCount || 0}`,
    `Preflight recovery report: ${liveSyncHealth?.local?.autoRecoveryReport?.reportRelativePath || '-'}`,
    `Safe delete queue: ${liveSyncSafeDeleteQueue.length || liveSyncHealth?.local?.safeDeleteQueueCount || 0}`,
    `Last rejected preserved history: ${liveSyncHealth?.local?.lastRejectedWrite?.serverHistoryRevisionId || '-'}${liveSyncHealth?.local?.lastRejectedWrite?.rejectedSourceDeviceId ? ` device=${liveSyncHealth.local.lastRejectedWrite.rejectedSourceDeviceId}` : ''}`,
    `Last local error: ${liveSyncHealth?.local?.lastError || '-'}`,
    `Server error: ${liveSyncHealth?.serverError || '-'}`,
    `Diagnostic warning: ${liveSyncHealth?.diagnosticWarning || '-'}`,
    `Clients: ${liveSyncServerClients.length ? liveSyncServerClients.map((client: any) => {
      const name = client.deviceName || client.deviceId || client.clientId || '-';
      const level = client.safetyLevel || '-';
      const version = client.appVersion ? `v${client.appVersion}` : 'version-unknown';
      const protocol = client.protocolVersion ? `p${client.protocolVersion}/${client.requiredProtocolVersion || '-'}` : 'protocol-unknown';
      const ws = client.webSocketStatus || 'unknown';
      const last = client.lastAction || client.lastMessageType || 'connected';
      const path = client.lastRelativePath ? `:${client.lastRelativePath}` : '';
      const rejected = client.lastRejectedReason ? ` rejected=${client.lastRejectedReason}` : '';
      return `${name} ${level} ${ws} ${version} ${protocol} last=${last}${path}${rejected}`;
    }).join(' | ') : '-'}`,
    `Recent client events: ${liveSyncServerClientEvents.length ? liveSyncServerClientEvents.slice(0, 12).map((event: any) => {
      const name = event.deviceName || event.deviceId || event.clientId || '-';
      const file = [event.action || event.eventType || '-', event.relativePath || ''].filter(Boolean).join(':');
      const reason = event.reason ? ` reason=${event.reason}` : '';
      const revision = event.historyRevisionId ? ` history=${event.historyRevisionId}` : '';
      return `${event.createdAt || '-'} ${event.level || 'info'} ${event.eventType || '-'} ${name} ${file}${reason}${revision}`;
    }).join(' | ') : '-'}`,
    `Proxy hints: ${Array.isArray(liveSyncHealth?.server?.diagnostics?.proxyHints) ? liveSyncHealth.server.diagnostics.proxyHints.join(' | ') : '-'}`,
  ].join('\n'), [liveSyncAdminUrl, liveSyncExpectedWebSocketUrl, liveSyncHealth, liveSyncSafeDeleteQueue.length, liveSyncServerBaseUrl, liveSyncServerClientEvents, liveSyncServerClients, syncConfig?.remoteVaultId]);
  const liveSyncSimpleSummary = useMemo(() => buildLiveSyncSimpleSummary(
    liveSyncHealth,
    liveSyncConnected,
    liveSyncConnectionMode,
    liveSyncSafeDeleteQueue.length || liveSyncHealth?.local?.safeDeleteQueueCount || 0,
  ), [liveSyncConnected, liveSyncConnectionMode, liveSyncHealth, liveSyncSafeDeleteQueue.length]);
  const showLiveSyncAdvancedDetails = settingsShowAdvanced || liveSyncConnectionMode === 'rebuild';

  const refreshLiveSyncSafeDeleteQueue = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!api?.liveSyncSafeDeleteQueue) {
      setLiveSyncSafeDeleteQueue([]);
      return;
    }
    try {
      const result = await api.liveSyncSafeDeleteQueue();
      setLiveSyncSafeDeleteQueue(result?.ok && Array.isArray(result.items) ? result.items : []);
    } catch {
      setLiveSyncSafeDeleteQueue([]);
    }
  }, []);

  const refreshLiveSyncHealth = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.liveSyncHealth) {
      setLiveSyncHealth({ ok: false, local: null, server: null, serverError: 'Live Sync health API unavailable' });
      setLiveSyncHealthLoading(false);
      return;
    }
    if (liveSyncHealthInFlightRef.current) return;
    liveSyncHealthInFlightRef.current = true;
    setLiveSyncHealthLoading(true);
    try {
      const health = await Promise.race([
        api.liveSyncHealth(vaultPath),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Health check did not return within 25s')), 25000)),
      ]);
      setLiveSyncHealth(health);
      await refreshLiveSyncSafeDeleteQueue();
      if (health?.ok && !health?.degraded && !health?.local?.lastError && !health?.diagnosticWarning) {
        return;
      }
      const detail = liveSyncHealthMessages(health).join('；') || `${health?.durationMs || 0} ms`;
      addLiveSyncTimeline({
        kind: 'health',
        title: health?.ok ? (health?.degraded ? '同步可用但链路较慢' : '同步健康检查通过') : '同步健康检查异常',
        detail,
        status: health?.ok ? (health?.degraded ? 'warn' : 'ok') : 'warn',
        timestamp: health?.checkedAt || new Date().toISOString(),
      });
    } catch (err: any) {
      setLiveSyncHealth({ ok: false, local: null, server: null, serverError: err.message || 'Health check failed' });
      addLiveSyncTimeline({
        kind: 'health',
        title: '同步健康检查失败',
        detail: err.message || 'Health check failed',
        status: 'error',
      });
    } finally {
      liveSyncHealthInFlightRef.current = false;
      setLiveSyncHealthLoading(false);
    }
  }, [addLiveSyncTimeline, refreshLiveSyncSafeDeleteQueue, vaultPath]);

  const runLiveSyncSelfTest = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.liveSyncSelfTest) {
      setLiveSyncSelfTest({
        ok: false,
        checkedAt: new Date().toISOString(),
        durationMs: 0,
        steps: [{ name: 'api', ok: false, detail: 'Live Sync self-test API unavailable' }],
      });
      return;
    }
    setLiveSyncSelfTesting(true);
    setLiveSyncSelfTest(null);
    try {
      const result = await api.liveSyncSelfTest(vaultPath);
      setLiveSyncSelfTest(result);
      addLiveSyncTimeline({
        kind: 'self-test',
        title: result.ok ? '同步自检通过' : '同步自检异常',
        detail: `${result.steps.filter((step: LiveSyncSelfTestResult['steps'][number]) => step.ok).length}/${result.steps.length} 通过 · ${result.durationMs} ms`,
        status: result.ok ? 'ok' : 'error',
        timestamp: result.checkedAt,
      });
      await refreshLiveSyncHealth();
    } catch (err: any) {
      setLiveSyncSelfTest({
        ok: false,
        checkedAt: new Date().toISOString(),
        durationMs: 0,
        steps: [{ name: 'error', ok: false, detail: err.message || 'Live Sync self-test failed' }],
      });
      addLiveSyncTimeline({
        kind: 'self-test',
        title: '同步自检失败',
        detail: err.message || 'Live Sync self-test failed',
        status: 'error',
      });
    } finally {
      setLiveSyncSelfTesting(false);
    }
  }, [addLiveSyncTimeline, refreshLiveSyncHealth, vaultPath]);

  const trustLocalInitialLiveSyncUpload = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.liveSyncTrustLocalInitialUpload) return;
    const confirmed = await showConfirm(
      '信任本机初始化服务器',
      '服务器当前是空的，Ars-note 已阻止本机自动全量上传。\n\n只有当你确认“这台电脑上的 Vault 是最新、最完整的版本”，才继续。建议先在备份页导出一个本地备份。\n\n确定用本机内容初始化服务器吗？',
    );
    if (!confirmed) {
      setLiveSyncServerToolMsg('已取消本机初始化服务器。');
      return;
    }
    setLiveSyncServerToolMsg('正在用本机内容初始化服务器...');
    try {
      const result = await api.liveSyncTrustLocalInitialUpload(vaultPath);
      if (!result?.ok) {
        setLiveSyncServerToolMsg(result?.error || '初始化服务器失败。');
        return;
      }
      const snapshotName = result.preOperationSnapshot?.fileName
        ? `服务器安全快照：${result.preOperationSnapshot.fileName}。`
        : '';
      setLiveSyncServerToolMsg(`已开始上传本机快照：${result.uploadedCount || 0} 个文件。${snapshotName}`);
      await refreshLiveSyncHealth();
    } catch (err: any) {
      setLiveSyncServerToolMsg(err.message || '初始化服务器失败。');
    }
  }, [refreshLiveSyncHealth, showConfirm, vaultPath]);

  const resumeLiveSyncAfterStaleBaselineReview = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.liveSyncResumeAfterStaleBaselineReview) return;
    const confirmed = await showConfirm(
      '恢复实时同步上传',
      '这台电脑的同步基线明显落后服务器，Ars-note 已经暂停上传，避免旧数据覆盖新数据。\n\n请先检查冲突副本和 live-history，确认服务器版本是正确的。继续后会清空旧的待上传队列，只恢复后续新的正常同步。\n\n确定恢复后续上传吗？',
    );
    if (!confirmed) {
      setLiveSyncServerToolMsg('已继续保持上传暂停。');
      return;
    }
    setLiveSyncServerToolMsg('正在恢复后续实时同步上传...');
    try {
      const result = await api.liveSyncResumeAfterStaleBaselineReview();
      if (!result?.ok) {
        setLiveSyncServerToolMsg(result?.error || '恢复上传失败。');
        return;
      }
      setLiveSyncServerToolMsg(`已恢复后续上传，旧待上传队列已清空 ${result.clearedQueuedCount || 0} 项。`);
      await refreshLiveSyncHealth();
    } catch (err: any) {
      setLiveSyncServerToolMsg(err.message || '恢复上传失败。');
    }
  }, [refreshLiveSyncHealth, showConfirm, vaultPath]);

  const publishLocalAuthorityToLiveSyncServer = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.liveSyncPublishLocalAuthority) return;
    const confirmed = await showConfirm(
      '以本机为准修复同步服务器',
      '这个操作会把当前电脑的 Vault 作为权威版本发布到实时同步服务器：本机有而服务器没有的文件会上传，内容不同的文件会覆盖服务器版本；服务器多出来但本机没有的旧文件会写入删除记录，并同步到其他电脑。\n\n操作前会自动创建服务器安全快照。只在确认这台电脑就是最新、最完整版本时使用。继续前建议先导出本地备份。',
      { confirmLabel: '确认重建服务器', confirmTone: 'danger' },
    );
    if (!confirmed) {
      setLiveSyncServerToolMsg('已取消以本机为准修复服务器。');
      return;
    }
    setLiveSyncServerToolMsg('正在以本机 Vault 快照修复同步服务器...');
    try {
      const result = await api.liveSyncPublishLocalAuthority(vaultPath, { deleteDelayMs: 1500, applyDeletes: true });
      if (!result?.ok) {
        setLiveSyncServerToolMsg(result?.error || '以本机为准修复服务器失败。');
        return;
      }
      const queuedDeleteCount = result.queuedDeleteCount ?? result.scheduledDeleteCount ?? result.deletedCount ?? 0;
      const appliedDeleteCount = result.appliedDeleteCount ?? result.deleteApplyResult?.appliedCount ?? 0;
      const staleDeleteCount = result.staleDeleteCount ?? result.deleteApplyResult?.staleCount ?? 0;
      const remainingDeleteCount = result.remainingDeleteCount ?? result.deleteApplyResult?.remainingCount ?? 0;
      const snapshotName = result.preOperationSnapshot?.fileName
        ? `服务器安全快照：${result.preOperationSnapshot.fileName}。`
        : '';
      const deleteTail = queuedDeleteCount > 0
        ? `，服务器删除记录 ${appliedDeleteCount}/${queuedDeleteCount}${staleDeleteCount ? `，跳过版本变化 ${staleDeleteCount}` : ''}${remainingDeleteCount ? `，剩余待确认 ${remainingDeleteCount}` : ''}`
        : '';
      setLiveSyncServerToolMsg(`已重建服务器时间线：上传新增 ${result.createdCount || 0}，覆盖更新 ${result.updatedCount || 0}${deleteTail}，已匹配 ${result.matchedCount || 0}。${snapshotName}`);
      await refreshLiveSyncSafeDeleteQueue();
      await refreshLiveSyncHealth();
    } catch (err: any) {
      setLiveSyncServerToolMsg(err.message || '以本机为准修复服务器失败。');
    }
  }, [refreshLiveSyncHealth, refreshLiveSyncSafeDeleteQueue, showConfirm, vaultPath]);

  const applyLiveSyncSafeDeleteQueue = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.liveSyncApplySafeDeleteQueue) return;
    const queueCount = liveSyncSafeDeleteQueue.length || liveSyncHealth?.local?.safeDeleteQueueCount || 0;
    const confirmed = await showConfirm(
      '确认删除服务器多余文件',
      `有 ${queueCount} 个服务器文件等待同步删除。这些文件在当前电脑上不存在，确认后会写入服务器删除记录，并同步到其他电脑。\n\n操作前会自动创建服务器快照，后续可从恢复中心找回。确认同步这些删除吗？`,
      { confirmLabel: '同步删除', confirmTone: 'danger' },
    );
    if (!confirmed) {
      setLiveSyncServerToolMsg('已保留待同步删除，服务器文件没有被删除。');
      return;
    }
    setLiveSyncSafeDeleteBusy('apply');
    setLiveSyncServerToolMsg('正在同步删除...');
    try {
      const result = await api.liveSyncApplySafeDeleteQueue(vaultPath, {});
      if (!result?.ok) {
        setLiveSyncServerToolMsg(result?.error || '同步删除失败。');
        return;
      }
      const snapshotName = result.preOperationSnapshot?.fileName
        ? `服务器安全快照：${result.preOperationSnapshot.fileName}。`
        : '';
      setLiveSyncServerToolMsg(`已同步删除：发送删除 ${result.appliedCount || 0}，已不存在 ${result.skippedCount || 0}，版本变化未删除 ${result.staleCount || 0}，剩余 ${result.remainingCount || 0}。${snapshotName}`);
      await refreshLiveSyncSafeDeleteQueue();
      await refreshLiveSyncHealth();
    } catch (err: any) {
      setLiveSyncServerToolMsg(err.message || '同步删除失败。');
    } finally {
      setLiveSyncSafeDeleteBusy('');
    }
  }, [liveSyncHealth?.local?.safeDeleteQueueCount, liveSyncSafeDeleteQueue.length, refreshLiveSyncHealth, refreshLiveSyncSafeDeleteQueue, showConfirm, vaultPath]);

  const clearLiveSyncSafeDeleteQueue = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!api?.liveSyncClearSafeDeleteQueue) return;
    const confirmed = await showConfirm(
      '清空待同步删除',
      '清空后不会删除服务器文件，只是放弃本次待确认删除列表。以后再次以本机为准修复服务器时会重新生成。',
      { confirmLabel: '清空队列', confirmTone: 'primary' },
    );
    if (!confirmed) return;
    setLiveSyncSafeDeleteBusy('clear');
    try {
      const result = await api.liveSyncClearSafeDeleteQueue();
      if (!result?.ok) {
        setLiveSyncServerToolMsg(result?.error || '清空待同步删除失败。');
        return;
      }
      setLiveSyncServerToolMsg(`已清空待同步删除：${result.clearedCount || 0} 项。服务器文件没有被删除。`);
      await refreshLiveSyncSafeDeleteQueue();
      await refreshLiveSyncHealth();
    } catch (err: any) {
      setLiveSyncServerToolMsg(err.message || '清空待同步删除失败。');
    } finally {
      setLiveSyncSafeDeleteBusy('');
    }
  }, [refreshLiveSyncHealth, refreshLiveSyncSafeDeleteQueue, showConfirm]);

  const publishLocalAuthorityToLiveSyncServerLegacy = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.liveSyncPublishLocalAuthority) return;
    const confirmed = await showConfirm(
      '以本机为准修复同步服务器',
      '这个操作会把当前这台电脑的 Vault 作为权威版本发布到实时同步服务器：本机有而服务器没有的文件会上传；内容不同的文件会覆盖服务器版本；服务器多出来但本机没有的旧文件会同步删除。\n\n只在你确认“这台电脑就是最新、最完整版本”时使用。继续前建议先导出本地备份。\n\n确定以本机为准修复服务器吗？',
      { confirmLabel: '确认修复', confirmTone: 'primary' },
    );
    if (!confirmed) {
      setLiveSyncServerToolMsg('已取消以本机为准修复服务器。');
      return;
    }
    setLiveSyncServerToolMsg('正在以本机 Vault 快照修复同步服务器...');
    try {
      const result = await api.liveSyncPublishLocalAuthority(vaultPath, { deleteDelayMs: 1500 });
      if (!result?.ok) {
        setLiveSyncServerToolMsg(result?.error || '以本机为准修复服务器失败。');
        return;
      }
      const snapshotName = result.preOperationSnapshot?.fileName
        ? `服务器安全快照：${result.preOperationSnapshot.fileName}。`
        : '';
      setLiveSyncServerToolMsg(`已开始修复服务器：上传新增 ${result.createdCount || 0}，覆盖更新 ${result.updatedCount || 0}，计划删除旧文件 ${result.deletedCount || 0}，已匹配 ${result.matchedCount || 0}。删除会分批发送以避开误删保护。${snapshotName}`);
      await refreshLiveSyncHealth();
    } catch (err: any) {
      setLiveSyncServerToolMsg(err.message || '以本机为准修复服务器失败。');
    }
  }, [refreshLiveSyncHealth, showConfirm, vaultPath]);

  const resumeLiveSyncAfterDeleteStormReview = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.liveSyncResumeAfterDeleteStormReview) return;
    const confirmed = await showConfirm(
      '恢复同步并放弃本批危险删除',
      'Ars-note 检测到短时间内大量文件删除，已经暂停上传，避免误删扩散到其他电脑。\n\n继续后，这批被拦截的删除不会同步到服务器；相关文件的可恢复快照会保留在 live-history 中。后续新的正常编辑会继续同步。\n\n确定已经检查过，并恢复后续同步吗？',
    );
    if (!confirmed) {
      setLiveSyncServerToolMsg('已继续保持删除保护暂停。');
      return;
    }
    setLiveSyncServerToolMsg('正在放弃本批危险删除并恢复后续同步...');
    try {
      const result = await api.liveSyncResumeAfterDeleteStormReview();
      if (!result?.ok) {
        setLiveSyncServerToolMsg(result?.error || '恢复删除保护后的同步失败。');
        return;
      }
      setLiveSyncServerToolMsg(`已恢复后续同步：拦截删除 ${result.heldDeleteCount || 0} 项，丢弃待发送删除 ${result.discardedQueuedDeletes || 0} 项。`);
      await refreshLiveSyncHealth();
    } catch (err: any) {
      setLiveSyncServerToolMsg(err.message || '恢复删除保护后的同步失败。');
    }
  }, [refreshLiveSyncHealth, showConfirm, vaultPath]);

  const resumeLiveSyncAfterDestructiveTruncationReview = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.liveSyncResumeAfterDestructiveTruncationReview) return;
    const confirmed = await showConfirm(
      '恢复同步并放弃危险截断上传',
      'Ars-note 检测到已有大文档突然变成空文件或极小文件，已经暂停上传，避免把空 GDD/旧内容同步到其他电脑。\n\n继续后，这次被拦截的危险截断不会上传；如果确实要清空文件，请先确认历史版本和冲突副本都已经检查过，再重新编辑保存。\n\n确定恢复后续同步吗？',
    );
    if (!confirmed) {
      setLiveSyncServerToolMsg('已继续保持危险截断保护暂停。');
      return;
    }
    setLiveSyncServerToolMsg('正在放弃本次危险截断上传并恢复后续同步...');
    try {
      const result = await api.liveSyncResumeAfterDestructiveTruncationReview();
      if (!result?.ok) {
        setLiveSyncServerToolMsg(result?.error || '恢复危险截断保护后的同步失败。');
        return;
      }
      setLiveSyncServerToolMsg(`已恢复后续同步，已清空待上传队列 ${result.clearedQueuedCount || 0} 项。`);
      await refreshLiveSyncHealth();
    } catch (err: any) {
      setLiveSyncServerToolMsg(err.message || '恢复危险截断保护后的同步失败。');
    }
  }, [refreshLiveSyncHealth, showConfirm, vaultPath]);

  const previewAccidentRecoveryPlan = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.previewSyncAccidentRecovery) return;
    setAccidentRecoveryBusy(true);
    setAccidentRecoveryMessage('正在生成综合同步事故恢复向导...');
    try {
      const plan = await api.previewSyncAccidentRecovery(vaultPath, {
        sinceHours: 48,
        includeAllReasons: false,
        limit: 100,
      });
      setAccidentRecoveryPlan(plan);
      if (plan?.localPlan) setBatchRestorePlan(plan.localPlan);
      if (plan?.serverPlan) setServerBatchRestorePlan(plan.serverPlan);
      const sourceLabel =
        plan?.recommendedSource === 'server-history' ? '优先检查服务器历史'
        : plan?.recommendedSource === 'local-history' ? '优先检查本地 live-history'
        : plan?.recommendedSource === 'conflict' ? '优先处理冲突副本'
        : plan?.recommendedSource === 'ai-trash' ? '优先检查 AI 删除回收'
        : '暂未发现明显事故恢复项';
      setAccidentRecoveryMessage(`${sourceLabel}。本计划只预览，不会自动改文件。`);
    } catch (err: any) {
      setAccidentRecoveryPlan(null);
      setAccidentRecoveryMessage(err.message || '生成综合恢复向导失败');
    } finally {
      setAccidentRecoveryBusy(false);
    }
  }, [vaultPath]);

  const previewRecoveryAdvisorPlan = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.previewSyncRecoveryAdvisor) return;
    setRecoveryAdvisorBusy(true);
    setRecoveryAdvisorMessage('正在让同步恢复顾问判断各文件版本...');
    try {
      const plan: SyncRecoveryAdvisorPlan = await api.previewSyncRecoveryAdvisor(vaultPath, {
        sinceHours: 72,
        includeAllReasons: false,
        limit: 120,
      });
      setRecoveryAdvisorPlan(plan);
      setRecoveryAdvisorMessage(
        plan.summary.totalFiles
          ? `已生成智能建议：${plan.summary.applyReadyCount} 个可一键恢复，${plan.summary.reviewCount} 个需要人工合并/检查。`
          : '没有发现需要智能恢复判断的文件。',
      );
    } catch (err: any) {
      setRecoveryAdvisorPlan(null);
      setRecoveryAdvisorMessage(err.message || '生成智能恢复建议失败');
    } finally {
      setRecoveryAdvisorBusy(false);
    }
  }, [vaultPath]);

  React.useEffect(() => {
    if (activeTab !== 'settings' || !vaultPath) return;
    if (!liveSyncConnected && !liveSyncUrl.trim()) return;
    refreshLiveSyncHealth();
    const timer = window.setInterval(() => {
      refreshLiveSyncHealth();
    }, LIVE_SYNC_HEALTH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [activeTab, vaultPath, liveSyncConnected, liveSyncUrl, refreshLiveSyncHealth]);

  const refreshConflictSummary = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.scanSyncConflicts) return;
    setConflictScanning(true);
    setConflictMessage('正在扫描冲突文件...');
    try {
      const summary = await api.scanSyncConflicts(vaultPath);
      setConflictSummary(summary);
      if (!summary.count) setConflictPreview(null);
      setConflictMessage(summary.count > 0 ? `发现 ${summary.count} 个冲突文件。` : '没有发现冲突文件。');
    } catch (err: any) {
      setConflictSummary(null);
      setConflictMessage(err.message || '扫描失败');
    } finally {
      setConflictScanning(false);
    }
  }, [vaultPath]);

  const refreshSyncRecoveryOverview = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.getSyncRecoveryOverview) return;
    setSyncRecoveryLoading(true);
    setServerRecoveryError('');
    try {
      const overview = await api.getSyncRecoveryOverview(vaultPath);
      let serverRows: LiveHistoryItem[] = [];
      let serverError = '';
      if (api?.listServerLiveHistory) {
        try {
          serverRows = await api.listServerLiveHistory(vaultPath, undefined, 100);
        } catch (err: any) {
          serverError = err.message || '读取服务器历史失败';
        }
      }
      setServerRecoveryHistory(serverRows);
      setServerRecoveryError(serverError);
      const serverDeletedCount = serverRows.filter((item) => !!item.deletedSnapshot).length;
      const serverRejectedCount = serverRows.filter((item) => /rejected|stale|base|missing|delete-storm/i.test(`${item.reason || ''} ${item.versionId || ''}`)).length;
      const protectedLocalCount = Number(overview.protectedLocal?.count || 0);
      setSyncRecoveryOverview(overview);
      const serverNote = serverError
        ? `服务器历史读取失败：${serverError}`
        : `服务器历史 ${serverRows.length} 条，删除快照 ${serverDeletedCount}，拒绝写入 ${serverRejectedCount}`;
      setSyncRecoveryMessage(overview.riskLevel === 'ok' && serverDeletedCount === 0 && serverRejectedCount === 0
        ? `同步恢复中心未发现明显事故痕迹。${serverNote}`
        : `发现 ${overview.conflict.count} 个冲突、${protectedLocalCount} 个受保护本地差异、${overview.history.deletedCount} 个本地删除快照、${overview.aiTrash.count} 个 AI 回收副本。${serverNote}`);
    } catch (err: any) {
      setSyncRecoveryOverview(null);
      setServerRecoveryHistory([]);
      setSyncRecoveryMessage(err.message || '读取同步恢复中心失败');
    } finally {
      setSyncRecoveryLoading(false);
    }
  }, [vaultPath]);

  const refreshVaultStorageReport = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.analyzeVaultStorage) return;
    setStorageScanning(true);
    setStorageMessage('正在扫描 Vault 占用...');
    try {
      const report = await api.analyzeVaultStorage(vaultPath, storageKeepLatestBackups);
      setStorageReport(report);
      setStorageMessage(report.suggestedReclaimableSize > 0
        ? `发现可安全释放 ${formatBytes(report.suggestedReclaimableSize)}。`
        : '没有发现明显可清理的生成缓存。');
    } catch (err: any) {
      setStorageReport(null);
      setStorageMessage(err.message || '存档体检失败');
    } finally {
      setStorageScanning(false);
    }
  }, [storageKeepLatestBackups, vaultPath]);

  const refreshLiveHistory = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.listLiveHistory) return;
    setHistoryLoading(true);
    try {
      const rows = await api.listLiveHistory(vaultPath, currentFileRel || undefined);
      setLiveHistory(rows);
      if (!rows.length) setHistoryPreview(null);
    } catch {
      setLiveHistory([]);
      setHistoryPreview(null);
    } finally {
      setHistoryLoading(false);
    }
  }, [vaultPath, currentFileRel]);

  const refreshServerLiveHistory = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.listServerLiveHistory) return;
    setServerHistoryLoading(true);
    setServerHistoryMessage('正在读取服务器历史...');
    try {
      const rows = await api.listServerLiveHistory(vaultPath, currentFileRel || undefined, 100);
      setServerLiveHistory(rows);
      setServerHistoryMessage(rows.length ? `服务器历史：${rows.length} 条记录` : '服务器暂无历史记录。');
    } catch (err: any) {
      setServerLiveHistory([]);
      setServerHistoryMessage(err.message || '读取服务器历史失败');
    } finally {
      setServerHistoryLoading(false);
    }
  }, [vaultPath, currentFileRel]);

  const refreshServerSnapshots = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.listServerDataSnapshots) return;
    setServerSnapshotBusy('list');
    setServerSnapshotMessage('正在读取服务器安全快照...');
    try {
      const result = await api.listServerDataSnapshots(vaultPath, 30);
      const rows = Array.isArray(result?.snapshots) ? result.snapshots : [];
      setServerSnapshots(rows);
      setServerSnapshotSelected((previous) => previous && rows.some((item: ServerDataSnapshotItem) => item.fileName === previous)
        ? previous
        : (rows[0]?.fileName || ''));
      setServerSnapshotMessage(rows.length ? `已读取 ${rows.length} 个服务器快照。` : '服务器还没有安全快照，可以先创建一个。');
    } catch (err: any) {
      setServerSnapshots([]);
      setServerSnapshotFiles([]);
      setServerSnapshotMessage(err.message || '读取服务器安全快照失败');
    } finally {
      setServerSnapshotBusy('');
    }
  }, [vaultPath]);

  const createServerSnapshotNow = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.createServerDataSnapshot) return;
    setServerSnapshotBusy('create');
    setServerSnapshotMessage('正在创建服务器安全快照...');
    try {
      const result = await api.createServerDataSnapshot(vaultPath, {
        reason: 'desktop-recovery-center',
        keepLatest: 30,
      });
      const snapshot = result?.snapshot;
      setServerSnapshotSelected(snapshot?.fileName || '');
      setServerSnapshotMessage(snapshot?.fileName
        ? `已创建服务器安全快照：${snapshot.fileName}。`
        : '已创建服务器安全快照。');
      await refreshServerSnapshots();
    } catch (err: any) {
      setServerSnapshotMessage(err.message || '创建服务器安全快照失败');
    } finally {
      setServerSnapshotBusy('');
    }
  }, [refreshServerSnapshots, vaultPath]);

  const exportServerBackupToLocal = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.exportServerDataBackup) return;
    setServerSnapshotBusy('export');
    setServerSnapshotMessage('正在导出服务器完整数据备份到本机...');
    try {
      const result = await api.exportServerDataBackup(vaultPath);
      setServerSnapshotMessage(`已导出服务器备份：${result.relativePath || result.savedPath} · ${formatBytes(result.size || 0)}。`);
    } catch (err: any) {
      setServerSnapshotMessage(err.message || '导出服务器备份失败');
    } finally {
      setServerSnapshotBusy('');
    }
  }, [vaultPath]);

  const searchServerSnapshotFiles = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.listServerSnapshotFiles) return;
    setServerSnapshotBusy('files');
    setServerSnapshotMessage('正在搜索服务器快照内文件...');
    try {
      const query = serverSnapshotQuery.trim();
      const result = await api.listServerSnapshotFiles(vaultPath, {
        fileName: serverSnapshotSelected || undefined,
        relativePath: query ? undefined : (currentFileRel || undefined),
        query: query || undefined,
        limit: 120,
      });
      setServerSnapshotSelected(result.fileName || serverSnapshotSelected);
      const rows = Array.isArray(result?.files) ? result.files : [];
      setServerSnapshotFiles(rows);
      setServerSnapshotMessage(rows.length
        ? `在快照 ${result.fileName} 中找到 ${rows.length} 个可检查版本。`
        : `快照 ${result.fileName} 中没有找到匹配文件。`);
    } catch (err: any) {
      setServerSnapshotFiles([]);
      setServerSnapshotMessage(err.message || '搜索服务器快照失败');
    } finally {
      setServerSnapshotBusy('');
    }
  }, [currentFileRel, serverSnapshotQuery, serverSnapshotSelected, vaultPath]);

  const restoreServerSnapshotCandidate = React.useCallback(async (item: ServerSnapshotFileCandidate) => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.restoreServerSnapshotFile || !serverSnapshotSelected) return;
    const confirmed = await showConfirm(
      '从服务器安全快照恢复',
      `将从服务器完整快照恢复 ${item.relativePath}。\n\n服务器端会先自动再创建一份操作前快照，本机当前文件也会写入 live-history。确定继续吗？`,
    );
    if (!confirmed) {
      setServerSnapshotMessage('已取消服务器快照恢复。');
      return;
    }
    const busyKey = `restore:${item.relativePath}:${item.revisionId || item.backupId || item.source}`;
    setServerSnapshotBusy(busyKey);
    setServerSnapshotMessage('正在从服务器安全快照恢复...');
    try {
      const result = await api.restoreServerSnapshotFile(vaultPath, serverSnapshotSelected, item);
      if (item.relativePath === currentFileRel) {
        await onReloadCurrentFile?.();
      }
      await onRefreshIndex();
      await refreshLiveHistory();
      await refreshServerLiveHistory();
      await refreshSyncRecoveryOverview();
      setServerSnapshotMessage([
        `已从服务器快照恢复：${item.relativePath}`,
        result?.preOperationSnapshot?.fileName ? `操作前安全快照：${result.preOperationSnapshot.fileName}` : '',
      ].filter(Boolean).join('；'));
    } catch (err: any) {
      setServerSnapshotMessage(err.message || '服务器快照恢复失败');
    } finally {
      setServerSnapshotBusy('');
    }
  }, [currentFileRel, onRefreshIndex, onReloadCurrentFile, refreshLiveHistory, refreshServerLiveHistory, refreshSyncRecoveryOverview, serverSnapshotSelected, showConfirm, vaultPath]);

  const handlePreviewHistory = React.useCallback(async (item: LiveHistoryItem) => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.previewLiveHistory) return;
    setHistoryPreviewLoading(true);
    setHistoryMessage('正在读取历史版本...');
    try {
      const preview = await api.previewLiveHistory(vaultPath, item.relativePath, item.versionId);
      setHistoryPreview(preview);
      setHistoryPreviewSource('local');
      setHistoryMessage(`已打开 ${item.relativePath} 的历史版本预览。`);
    } catch (err: any) {
      setHistoryPreview(null);
      setHistoryMessage(err.message || '读取历史版本失败');
    } finally {
      setHistoryPreviewLoading(false);
    }
  }, [vaultPath]);

  const handleRestoreHistory = React.useCallback(async (item?: LiveHistoryItem | LiveHistoryPreview | null) => {
    const target = item || historyPreview;
    const api = (window as any).arsnote;
    if (!target || !vaultPath || !api?.restoreLiveHistory) return;
    const confirmed = await showConfirm(
      '恢复历史版本',
      `将把 ${target.relativePath} 恢复到 ${target.savedAt || target.versionId}。恢复前会保留当前版本，确定继续吗？`,
    );
    if (!confirmed) {
      setHistoryMessage('已取消恢复历史版本。');
      return;
    }
    setHistoryActionBusy(`${target.relativePath}:${target.versionId}`);
    setHistoryMessage('正在恢复历史版本...');
    try {
      await api.restoreLiveHistory(vaultPath, target.relativePath, target.versionId);
      if (target.relativePath === currentFileRel) {
        await onReloadCurrentFile?.();
      }
      await onRefreshIndex();
      setHistoryPreview(null);
      setHistoryMessage('已恢复历史版本。');
      await refreshLiveHistory();
      await refreshSyncRecoveryOverview();
    } catch (err: any) {
      setHistoryMessage(err.message || '恢复失败');
    } finally {
      setHistoryActionBusy('');
    }
  }, [currentFileRel, historyPreview, onRefreshIndex, onReloadCurrentFile, refreshLiveHistory, refreshSyncRecoveryOverview, showConfirm, vaultPath]);

  const previewBatchRestoreFromLiveHistory = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.previewLiveHistoryBatchRestore) return;
    setBatchRestoreBusy(true);
    setBatchRestoreMessage('正在生成最近 48 小时事故恢复计划...');
    try {
      const plan = await api.previewLiveHistoryBatchRestore(vaultPath, {
        sinceHours: 48,
        includeAllReasons: false,
        limit: 100,
      });
      setBatchRestorePlan(plan);
      setBatchRestoreMessage(
        plan.restoreCount > 0
          ? `恢复计划已生成：可恢复 ${plan.restoreCount} 个文件，跳过 ${plan.skippedCount} 个。`
          : '恢复计划已生成，但没有发现需要批量恢复的事故历史。',
      );
    } catch (err: any) {
      setBatchRestorePlan(null);
      setBatchRestoreMessage(err.message || '生成恢复计划失败');
    } finally {
      setBatchRestoreBusy(false);
    }
  }, [vaultPath]);

  const runBatchRestoreFromLiveHistory = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.restoreLiveHistoryBatch) return;
    const plan = batchRestorePlan || await api.previewLiveHistoryBatchRestore?.(vaultPath, {
      sinceHours: 48,
      includeAllReasons: false,
      limit: 100,
    });
    if (!plan?.restoreCount) {
      setBatchRestorePlan(plan || null);
      setBatchRestoreMessage('没有可执行的批量恢复项。');
      return;
    }
    const confirmed = await showConfirm(
      '批量恢复 live-history',
      `将从最近 48 小时事故历史中恢复 ${plan.restoreCount} 个文件。\n\n每个当前文件都会先保存一份新的 live-history，再写回历史版本。确定继续吗？`,
    );
    if (!confirmed) {
      setBatchRestoreMessage('已取消批量恢复。');
      return;
    }
    setBatchRestoreBusy(true);
    setBatchRestoreMessage('正在执行批量恢复...');
    try {
      const result = await api.restoreLiveHistoryBatch(vaultPath, {
        sinceHours: 48,
        includeAllReasons: false,
        limit: 100,
      });
      setBatchRestorePlan(result.plan || null);
      if (Array.isArray(result.restoredFiles) && currentFileRel && result.restoredFiles.includes(currentFileRel)) {
        await onReloadCurrentFile?.();
      }
      await onRefreshIndex();
      await refreshLiveHistory();
      await refreshSyncRecoveryOverview();
      setBatchRestoreMessage(
        result.failedCount
          ? `批量恢复完成：恢复 ${result.restoredCount} 个，失败 ${result.failedCount} 个。`
          : `批量恢复完成：恢复 ${result.restoredCount} 个文件。`,
      );
    } catch (err: any) {
      setBatchRestoreMessage(err.message || '批量恢复失败');
    } finally {
      setBatchRestoreBusy(false);
    }
  }, [batchRestorePlan, currentFileRel, onRefreshIndex, onReloadCurrentFile, refreshLiveHistory, refreshSyncRecoveryOverview, showConfirm, vaultPath]);

  const previewServerBatchRestoreFromLiveHistory = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.previewServerLiveHistoryBatchRestore) return;
    setServerBatchRestoreBusy(true);
    setServerBatchRestoreMessage('正在生成服务器最近 48 小时事故恢复计划...');
    try {
      const plan = await api.previewServerLiveHistoryBatchRestore(vaultPath, {
        sinceHours: 48,
        includeAllReasons: false,
        limit: 100,
      });
      setServerBatchRestorePlan(plan);
      setServerBatchRestoreMessage(
        plan.restoreCount > 0
          ? `服务器恢复计划已生成：可恢复 ${plan.restoreCount} 个文件，跳过 ${plan.skippedCount} 个。`
          : '服务器恢复计划已生成，但没有发现需要批量恢复的事故历史。',
      );
    } catch (err: any) {
      setServerBatchRestorePlan(null);
      setServerBatchRestoreMessage(err.message || '生成服务器恢复计划失败');
    } finally {
      setServerBatchRestoreBusy(false);
    }
  }, [vaultPath]);

  const runServerBatchRestoreFromLiveHistory = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.restoreServerLiveHistoryBatch) return;
    const plan = serverBatchRestorePlan || await api.previewServerLiveHistoryBatchRestore?.(vaultPath, {
      sinceHours: 48,
      includeAllReasons: false,
      limit: 100,
    });
    if (!plan?.restoreCount) {
      setServerBatchRestorePlan(plan || null);
      setServerBatchRestoreMessage('没有可执行的服务器批量恢复项。');
      return;
    }
    const confirmed = await showConfirm(
      '批量恢复服务器历史',
      `将从服务器最近 48 小时事故历史中恢复 ${plan.restoreCount} 个文件。\n\n恢复会先写回 NAS live snapshot，再同步落到本机；本机当前文件也会先保存 live-history。确定继续吗？`,
    );
    if (!confirmed) {
      setServerBatchRestoreMessage('已取消服务器批量恢复。');
      return;
    }
    setServerBatchRestoreBusy(true);
    setServerBatchRestoreMessage('正在执行服务器批量恢复...');
    try {
      const result = await api.restoreServerLiveHistoryBatch(vaultPath, {
        sinceHours: 48,
        includeAllReasons: false,
        limit: 100,
      });
      setServerBatchRestorePlan(result.plan || null);
      if (Array.isArray(result.restoredFiles) && currentFileRel && result.restoredFiles.includes(currentFileRel)) {
        await onReloadCurrentFile?.();
      }
      await onRefreshIndex();
      await refreshLiveHistory();
      await refreshServerLiveHistory();
      await refreshSyncRecoveryOverview();
      setServerBatchRestoreMessage(
        result.failedCount
          ? `服务器批量恢复完成：恢复 ${result.restoredCount} 个，失败 ${result.failedCount} 个。`
          : `服务器批量恢复完成：恢复 ${result.restoredCount} 个文件。`,
      );
    } catch (err: any) {
      setServerBatchRestoreMessage(err.message || '服务器批量恢复失败');
    } finally {
      setServerBatchRestoreBusy(false);
    }
  }, [currentFileRel, onRefreshIndex, onReloadCurrentFile, refreshLiveHistory, refreshServerLiveHistory, refreshSyncRecoveryOverview, serverBatchRestorePlan, showConfirm, vaultPath]);

  const runRecommendedAccidentRecovery = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.previewSyncAccidentRecovery) return;

    setAccidentRecoveryBusy(true);
    setAccidentRecoveryMessage('正在确认推荐恢复方案...');

    try {
      const plan: SyncAccidentRecoveryPlan = accidentRecoveryPlan || await api.previewSyncAccidentRecovery(vaultPath, {
        sinceHours: 48,
        includeAllReasons: false,
        limit: 100,
      });
      setAccidentRecoveryPlan(plan);
      if (plan?.localPlan) setBatchRestorePlan(plan.localPlan);
      if (plan?.serverPlan) setServerBatchRestorePlan(plan.serverPlan);

      const source = plan?.recommendedSource || 'none';
      const serverRestoreCount = Number(plan?.serverPlan?.restoreCount || 0);
      const localRestoreCount = Number(plan?.localPlan?.restoreCount || 0);

      if (source === 'conflict') {
        await refreshConflictSummary();
        setAccidentRecoveryMessage('推荐先处理冲突副本：请先预览/合并冲突文件，再决定是否恢复历史。');
        return;
      }

      if (source === 'ai-trash') {
        setAccidentRecoveryMessage('推荐先检查 AI 删除回收副本：这些文件需要逐个确认恢复，避免把已确认删除的内容带回来。');
        return;
      }

      if (source === 'server-history' && serverRestoreCount > 0) {
        if (!api?.restoreServerLiveHistoryBatch) {
          setAccidentRecoveryMessage('当前版本缺少服务器批量恢复接口。');
          return;
        }
        const confirmed = await showConfirm(
          '执行推荐恢复：服务器历史',
          `将从 NAS server history 恢复 ${serverRestoreCount} 个事故相关文件。\n\n恢复前会保留当前版本，并且服务器会创建操作前快照。确定继续吗？`,
        );
        if (!confirmed) {
          setAccidentRecoveryMessage('已取消推荐恢复。');
          return;
        }

        setServerBatchRestoreBusy(true);
        setServerBatchRestoreMessage('正在执行推荐恢复：NAS server history...');
        const result = await api.restoreServerLiveHistoryBatch(vaultPath, {
          sinceHours: plan.sinceHours || 48,
          includeAllReasons: false,
          limit: plan.serverPlan?.limit || 100,
        });
        setServerBatchRestorePlan(result.plan || plan.serverPlan || null);
        if (Array.isArray(result.restoredFiles) && currentFileRel && result.restoredFiles.includes(currentFileRel)) {
          await onReloadCurrentFile?.();
        }
        await onRefreshIndex();
        await refreshLiveHistory();
        await refreshServerLiveHistory();
        await refreshSyncRecoveryOverview();
        setServerBatchRestoreMessage(
          result.failedCount
            ? `推荐恢复完成：服务器历史恢复 ${result.restoredCount} 个，失败 ${result.failedCount} 个。`
            : `推荐恢复完成：服务器历史恢复 ${result.restoredCount} 个文件。`,
        );
        setAccidentRecoveryMessage(
          result.failedCount
            ? `推荐恢复执行完毕，但有 ${result.failedCount} 个文件失败，请查看服务器恢复计划。`
            : `推荐恢复执行完毕：已从服务器历史恢复 ${result.restoredCount} 个文件。`,
        );
        return;
      }

      if (source === 'local-history' && localRestoreCount > 0) {
        if (!api?.restoreLiveHistoryBatch) {
          setAccidentRecoveryMessage('当前版本缺少本地批量恢复接口。');
          return;
        }
        const confirmed = await showConfirm(
          '执行推荐恢复：本地历史',
          `将从本地 live-history 恢复 ${localRestoreCount} 个事故相关文件。\n\n每个当前文件都会先保存一份新的 live-history，再写回历史版本。确定继续吗？`,
        );
        if (!confirmed) {
          setAccidentRecoveryMessage('已取消推荐恢复。');
          return;
        }

        setBatchRestoreBusy(true);
        setBatchRestoreMessage('正在执行推荐恢复：本地 live-history...');
        const result = await api.restoreLiveHistoryBatch(vaultPath, {
          sinceHours: plan.sinceHours || 48,
          includeAllReasons: false,
          limit: plan.localPlan?.limit || 100,
        });
        setBatchRestorePlan(result.plan || plan.localPlan || null);
        if (Array.isArray(result.restoredFiles) && currentFileRel && result.restoredFiles.includes(currentFileRel)) {
          await onReloadCurrentFile?.();
        }
        await onRefreshIndex();
        await refreshLiveHistory();
        await refreshSyncRecoveryOverview();
        setBatchRestoreMessage(
          result.failedCount
            ? `推荐恢复完成：本地历史恢复 ${result.restoredCount} 个，失败 ${result.failedCount} 个。`
            : `推荐恢复完成：本地历史恢复 ${result.restoredCount} 个文件。`,
        );
        setAccidentRecoveryMessage(
          result.failedCount
            ? `推荐恢复执行完毕，但有 ${result.failedCount} 个文件失败，请查看本地恢复计划。`
            : `推荐恢复执行完毕：已从本地历史恢复 ${result.restoredCount} 个文件。`,
        );
        return;
      }

      if (serverRestoreCount > 0) {
        setAccidentRecoveryMessage('综合向导没有把服务器历史列为第一推荐，因为还有更高优先级风险；请先处理冲突/回收项，或使用下方服务器恢复按钮。');
        return;
      }
      if (localRestoreCount > 0) {
        setAccidentRecoveryMessage('综合向导没有把本地历史列为第一推荐，因为还有更高优先级风险；请先处理冲突/回收项，或使用下方本地恢复按钮。');
        return;
      }

      setAccidentRecoveryMessage('暂未发现可自动执行的推荐恢复项。');
    } catch (err: any) {
      setAccidentRecoveryMessage(err.message || '执行推荐恢复失败');
    } finally {
      setAccidentRecoveryBusy(false);
      setBatchRestoreBusy(false);
      setServerBatchRestoreBusy(false);
    }
  }, [accidentRecoveryPlan, currentFileRel, onRefreshIndex, onReloadCurrentFile, refreshConflictSummary, refreshLiveHistory, refreshServerLiveHistory, refreshSyncRecoveryOverview, showConfirm, vaultPath]);

  const handlePreviewServerHistory = React.useCallback(async (item: LiveHistoryItem) => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.previewServerLiveHistory) return;
    setHistoryPreviewLoading(true);
    setServerHistoryMessage('正在读取服务器历史版本...');
    try {
      const preview = await api.previewServerLiveHistory(vaultPath, item.relativePath, item.versionId);
      setHistoryPreview(preview);
      setHistoryPreviewSource('server');
      setServerHistoryMessage(`已打开服务器历史：${item.relativePath}`);
    } catch (err: any) {
      setHistoryPreview(null);
      setServerHistoryMessage(err.message || '读取服务器历史版本失败');
    } finally {
      setHistoryPreviewLoading(false);
    }
  }, [vaultPath]);

  const handleRestoreServerHistory = React.useCallback(async (item?: LiveHistoryItem | LiveHistoryPreview | null) => {
    const target = item || historyPreview;
    const api = (window as any).arsnote;
    if (!target || !vaultPath || !api?.restoreServerLiveHistory) return;
    const confirmed = await showConfirm(
      '恢复服务器历史',
      `将从服务器历史恢复 ${target.relativePath}（${target.savedAt || target.versionId}）。恢复前会先把本机当前版本写入本地历史，确定继续吗？`,
    );
    if (!confirmed) {
      setServerHistoryMessage('已取消服务器历史恢复。');
      return;
    }
    setHistoryActionBusy(`server:${target.relativePath}:${target.versionId}`);
    setServerHistoryMessage('正在恢复服务器历史...');
    try {
      await api.restoreServerLiveHistory(vaultPath, target.relativePath, target.versionId);
      if (target.relativePath === currentFileRel) {
        await onReloadCurrentFile?.();
      }
      await onRefreshIndex();
      setHistoryPreview(null);
      setServerHistoryMessage('已恢复服务器历史。');
      await refreshLiveHistory();
      await refreshServerLiveHistory();
      await refreshSyncRecoveryOverview();
    } catch (err: any) {
      setServerHistoryMessage(err.message || '恢复服务器历史失败');
    } finally {
      setHistoryActionBusy('');
    }
  }, [currentFileRel, historyPreview, onRefreshIndex, onReloadCurrentFile, refreshLiveHistory, refreshServerLiveHistory, refreshSyncRecoveryOverview, showConfirm, vaultPath]);

  const handleRestoreAiTrashFile = React.useCallback(async (item: { relativePath: string; originalRelativePath?: string; size?: number; modifiedAt?: string }) => {
    const api = (window as any).arsnote;
    if (!vaultPath || !item?.relativePath || !api?.restoreAiTrashFile) return;
    const originalPath = item.originalRelativePath || item.relativePath.split('/').slice(3).join('/');
    const confirmed = await showConfirm(
      '恢复 AI 删除副本',
      `将把 AI 删除回收副本恢复到原位置：${originalPath || item.relativePath}\n\n恢复前会先保留当前目标文件版本，回收副本本身不会删除。确定继续吗？`,
    );
    if (!confirmed) {
      setAiTrashMessage('已取消恢复 AI 删除副本。');
      return;
    }
    setAiTrashActionBusy(item.relativePath);
    setAiTrashMessage('正在恢复 AI 删除副本...');
    try {
      const result = await api.restoreAiTrashFile(vaultPath, item.relativePath);
      if (result.restoredPath === currentFileRel) {
        await onReloadCurrentFile?.();
      }
      await onRefreshIndex();
      await refreshLiveHistory();
      await refreshSyncRecoveryOverview();
      setAiTrashMessage(`已恢复 AI 删除副本：${result.restoredPath}`);
    } catch (err: any) {
      setAiTrashMessage(err.message || '恢复 AI 删除副本失败');
    } finally {
      setAiTrashActionBusy('');
    }
  }, [currentFileRel, onRefreshIndex, onReloadCurrentFile, refreshLiveHistory, refreshSyncRecoveryOverview, showConfirm, vaultPath]);

  const handleRestoreProtectedLocalRecoveryFile = React.useCallback(async (item: ProtectedLocalRecoveryFile) => {
    const api = (window as any).arsnote;
    if (!vaultPath || !item?.relativePath || !api?.restoreProtectedLocalRecoveryFile) return;
    const originalPath = item.originalRelativePath || item.relativePath;
    const confirmed = await showConfirm(
      '恢复受保护本地差异',
      `将把服务器接管时保留的本机版本恢复到原位置：${originalPath}\n\n恢复前会先保留当前目标文件版本；这不会直接把旧版本发布到服务器，只会恢复到本机供你检查。确定继续吗？`,
    );
    if (!confirmed) {
      setProtectedLocalMessage('已取消恢复受保护本地差异。');
      return;
    }
    setProtectedLocalActionBusy(item.relativePath);
    setProtectedLocalMessage('正在恢复受保护本地差异...');
    try {
      const result = await api.restoreProtectedLocalRecoveryFile(vaultPath, item.relativePath);
      if (result.restoredPath === currentFileRel) {
        await onReloadCurrentFile?.();
      }
      await onRefreshIndex();
      await refreshLiveHistory();
      await refreshSyncRecoveryOverview();
      setProtectedLocalMessage(`已恢复受保护本地差异：${result.restoredPath}`);
    } catch (err: any) {
      setProtectedLocalMessage(err.message || '恢复受保护本地差异失败');
    } finally {
      setProtectedLocalActionBusy('');
    }
  }, [currentFileRel, onRefreshIndex, onReloadCurrentFile, refreshLiveHistory, refreshSyncRecoveryOverview, showConfirm, vaultPath]);

  const applyRecoveryAdvisorItem = React.useCallback(async (item: SyncRecoveryAdvisorItem) => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.applySyncRecoveryAdvisorItem || !item?.canApply) return;
    const confirmed = await showConfirm(
      '应用智能恢复建议',
      `将对 ${item.relativePath} 执行：${item.recommendedLabel}\n\n原因：${item.reason}\n\n执行前会保留当前版本。确定继续吗？`,
    );
    if (!confirmed) {
      setRecoveryAdvisorMessage('已取消应用智能恢复建议。');
      return;
    }
    setRecoveryAdvisorActionBusy(item.relativePath);
    setRecoveryAdvisorMessage('正在应用智能恢复建议...');
    try {
      const result = await api.applySyncRecoveryAdvisorItem(vaultPath, item);
      if (item.relativePath === currentFileRel) {
        await onReloadCurrentFile?.();
      }
      await onRefreshIndex();
      await refreshLiveHistory();
      await refreshServerLiveHistory();
      await refreshSyncRecoveryOverview();
      if (api?.previewSyncRecoveryAdvisor) {
        const nextPlan = await api.previewSyncRecoveryAdvisor(vaultPath, {
          sinceHours: 72,
          includeAllReasons: false,
          limit: 120,
        });
        setRecoveryAdvisorPlan(nextPlan);
      }
      if (result?.draftRelativePath) {
        setRecoveryAdvisorMessage(`已生成智能合并草稿：${result.draftRelativePath}。请打开草稿审核后保存合并结果。`);
        return;
      }
      if (result?.chosen === 'conflict') {
        setRecoveryAdvisorMessage(`已按最新版本解决冲突：采用冲突副本 ${result.restoredPath}。`);
        return;
      }
      if (result?.chosen === 'current') {
        setRecoveryAdvisorMessage(`已按最新版本解决冲突：保留当前文件，并清理 ${result.deletedConflict}。`);
        return;
      }
      setRecoveryAdvisorMessage(`已应用智能恢复建议：${item.relativePath}`);
    } catch (err: any) {
      setRecoveryAdvisorMessage(err.message || '应用智能恢复建议失败');
    } finally {
      setRecoveryAdvisorActionBusy('');
    }
  }, [currentFileRel, onRefreshIndex, onReloadCurrentFile, refreshLiveHistory, refreshServerLiveHistory, refreshSyncRecoveryOverview, showConfirm, vaultPath]);

  const applyRecoveryAdvisorHighConfidence = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.applySyncRecoveryAdvisorPlan) return;
    const localHighConfidenceCount = recoveryAdvisorPlan?.items?.filter((item) => (
      item.canApply
      && item.confidence === 'high'
      && item.recommendedAction !== 'merge-conflict'
      && item.recommendedAction !== 'review-ai-trash'
      && item.recommendedAction !== 'keep-current'
    )).length || 0;
    const confirmed = await showConfirm(
      '一键应用高置信同步恢复建议',
      [
        'Ars-note 会重新扫描恢复中心，并只自动执行高置信、可恢复的建议。',
        localHighConfidenceCount ? `当前界面预计可处理 ${localHighConfidenceCount} 项。` : '如果扫描后没有高置信项目，不会改动文件。',
        '',
        '不会自动删除服务器文件；服务器删除需要你在待同步删除里点“同步删除”。',
        '时间接近的冲突仍会保留为合并草稿或人工检查。',
        '',
        '确定继续吗？',
      ].join('\n'),
    );
    if (!confirmed) {
      setRecoveryAdvisorMessage('已取消一键应用高置信恢复建议。');
      return;
    }
    setRecoveryAdvisorActionBusy('__batch__');
    setRecoveryAdvisorMessage('正在一键应用高置信恢复建议...');
    try {
      const result = await api.applySyncRecoveryAdvisorPlan(vaultPath, {
        sinceHours: 72,
        includeAllReasons: false,
        limit: 120,
        applyLimit: 80,
        includeMedium: false,
        generateMergeDrafts: true,
      });
      if (result?.nextPlan) setRecoveryAdvisorPlan(result.nextPlan);
      await onRefreshIndex();
      await onReloadCurrentFile?.();
      await refreshConflictSummary();
      await refreshLiveHistory();
      await refreshServerLiveHistory();
      await refreshSyncRecoveryOverview();
      setRecoveryAdvisorMessage(
        `已应用高置信恢复建议 ${result?.appliedCount || 0} 项，失败 ${result?.failedCount || 0} 项，跳过 ${result?.skippedCount || 0} 项。恢复报告：${result?.reportRelativePath || '-'}`,
      );
    } catch (err: any) {
      setRecoveryAdvisorMessage(err.message || '一键应用高置信恢复建议失败');
    } finally {
      setRecoveryAdvisorActionBusy('');
    }
  }, [onRefreshIndex, onReloadCurrentFile, recoveryAdvisorPlan?.items, refreshConflictSummary, refreshLiveHistory, refreshServerLiveHistory, refreshSyncRecoveryOverview, showConfirm, vaultPath]);

  const runSafeRecoveryAutopilot = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.runSafeSyncRecoveryAutopilot) return;
    const confirmed = await showConfirm(
      '安全整理同步问题',
      [
        'Ars-note 会自动扫描同步恢复中心，并只执行高置信、可撤回的修复。',
        '',
        '会做：',
        '1. 把可见的 *.conflict-* 移入同步恢复中心。',
        '2. 自动判断服务器版本、本机版本、历史版本和受保护本地差异。',
        '3. 只应用高置信建议，并在覆盖前保留历史版本。',
        '',
        '不会做：',
        '1. 不会自动删除服务器文件。',
        '2. 不会绕过待同步删除确认。',
        '3. 不会强行合并低置信冲突。',
        '',
        '确定开始安全整理吗？',
      ].join('\n'),
    );
    if (!confirmed) {
      setSafeRecoveryAutopilotMessage('已取消安全整理。');
      return null;
    }
    setSafeRecoveryAutopilotBusy(true);
    setSafeRecoveryAutopilotMessage('正在安全整理同步问题...');
    setRecoveryAdvisorActionBusy('__autopilot__');
    try {
      const result = await api.runSafeSyncRecoveryAutopilot(vaultPath, {
        sinceHours: 720,
        includeAllReasons: false,
        limit: 160,
        applyLimit: 80,
        includeMedium: false,
        generateMergeDrafts: true,
      });
      if (result?.nextPlan) setRecoveryAdvisorPlan(result.nextPlan);
      if (result?.overview) setSyncRecoveryOverview(result.overview);
      await onRefreshIndex();
      await onReloadCurrentFile?.();
      await refreshConflictSummary();
      await refreshLiveHistory();
      await refreshServerLiveHistory();
      await refreshSyncRecoveryOverview();
      const archived = result?.archivedConflicts?.archivedCount || 0;
      const applied = result?.appliedCount || 0;
      const drafted = result?.draftedCount || 0;
      const failed = result?.failedCount || 0;
      const skipped = result?.skippedCount || 0;
      setSafeRecoveryAutopilotMessage(
        `安全整理完成：迁移冲突 ${archived} 个，自动修复 ${applied} 个，失败 ${failed} 个，保留人工检查 ${skipped} 个。报告：${result?.reportRelativePath || '-'}`,
      );
      setSafeRecoveryAutopilotMessage(
        `安全整理完成：迁移冲突 ${archived} 个，自动修复 ${applied} 个，生成合并草稿 ${drafted} 个，失败 ${failed} 个，保留人工检查 ${skipped} 个。报告：${result?.reportRelativePath || '-'}`,
      );
      return result;
    } catch (err: any) {
      setSafeRecoveryAutopilotMessage(err.message || '安全整理同步问题失败');
      return null;
    } finally {
      setRecoveryAdvisorActionBusy('');
      setSafeRecoveryAutopilotBusy(false);
    }
  }, [onRefreshIndex, onReloadCurrentFile, refreshConflictSummary, refreshLiveHistory, refreshServerLiveHistory, refreshSyncRecoveryOverview, showConfirm, vaultPath]);

  const handlePreviewConflict = React.useCallback(async (relativePath: string) => {
    const api = (window as any).arsnote;
    if (!vaultPath || !relativePath || !api?.previewSyncConflict) return;
    setConflictPreviewLoading(true);
    setConflictMessage('正在读取冲突差异...');
    try {
      const preview = await api.previewSyncConflict(vaultPath, relativePath);
      setConflictPreview(preview);
      setConflictMergeText(preview.baseExists ? preview.baseContent : preview.conflictContent);
      setConflictMergeDeleteAfterSave(true);
      setConflictMessage(`已打开 ${preview.conflictRelativePath} 的差异预览。`);
    } catch (err: any) {
      setConflictPreview(null);
      setConflictMessage(err.message || '读取冲突差异失败');
    } finally {
      setConflictPreviewLoading(false);
    }
  }, [vaultPath]);

  const handleApplyConflict = React.useCallback(async (relativePath?: string) => {
    const api = (window as any).arsnote;
    const target = relativePath || conflictPreview?.conflictRelativePath;
    if (!vaultPath || !target || !api?.applySyncConflict) return;
    let preview = conflictPreview?.conflictRelativePath === target ? conflictPreview : null;
    try {
      if (!preview && api?.previewSyncConflict) {
        preview = await api.previewSyncConflict(vaultPath, target);
      }
      const baseLabel = preview?.baseRelativePath || target.replace(/\.conflict-\d+$/, '');
      const confirmed = await showConfirm(
        '使用冲突版本',
        `将用 ${target} 覆盖 ${baseLabel}，覆盖前会保存一份版本历史。确定继续吗？`,
      );
      if (!confirmed) {
        setConflictMessage('已取消使用冲突版本。');
        return;
      }
      setConflictActionBusy(`apply:${target}`);
      setConflictMessage('正在应用冲突版本...');
      const result = await api.applySyncConflict(vaultPath, target);
      setConflictPreview(null);
      setConflictMessage(`已使用冲突版本恢复 ${result.restoredPath}。`);
      await refreshConflictSummary();
      if (result.restoredPath === currentFileRel) {
        await onReloadCurrentFile?.();
      }
      await onRefreshIndex();
      await refreshLiveHistory();
    } catch (err: any) {
      setConflictMessage(err.message || '应用冲突版本失败');
    } finally {
      setConflictActionBusy('');
    }
  }, [conflictPreview, currentFileRel, onRefreshIndex, onReloadCurrentFile, refreshConflictSummary, refreshLiveHistory, showConfirm, vaultPath]);

  const handleResolveConflictLatest = React.useCallback(async (relativePath?: string) => {
    const api = (window as any).arsnote;
    const target = relativePath || conflictPreview?.conflictRelativePath;
    if (!vaultPath || !target || !api?.resolveSyncConflictLatest) return;
    let preview = conflictPreview?.conflictRelativePath === target ? conflictPreview : null;
    try {
      if (!preview && api?.previewSyncConflict) {
        preview = await api.previewSyncConflict(vaultPath, target);
      }
      const baseLabel = preview?.baseRelativePath || target.replace(/\.conflict-\d+$/, '');
      const confirmed = await showConfirm(
        '以最新版本为准解决冲突',
        `Ars-note 会比较 ${baseLabel} 和冲突副本的修改时间：较新的版本会被保留，较旧的冲突副本会被清理。\n\n如果冲突副本更新，会先保留当前文件历史再覆盖；如果当前文件更新，只会删除冲突副本。\n\n确定按最新版本解决这个冲突吗？`,
      );
      if (!confirmed) {
        setConflictMessage('已取消按最新版本解决冲突。');
        return;
      }
      setConflictActionBusy(`latest:${target}`);
      setConflictMessage('正在按最新版本解决冲突...');
      const result = await api.resolveSyncConflictLatest(vaultPath, target);
      setConflictPreview(null);
      setConflictMessage(result?.chosen === 'conflict'
        ? `已采用较新的冲突副本：${result.restoredPath}`
        : `已保留较新的当前文件，并清理冲突副本：${result.deletedConflict}`);
      await refreshConflictSummary();
      if (result?.restoredPath === currentFileRel) {
        await onReloadCurrentFile?.();
      }
      await onRefreshIndex();
      await refreshLiveHistory();
      await refreshSyncRecoveryOverview();
    } catch (err: any) {
      setConflictMessage(err.message || '按最新版本解决冲突失败');
    } finally {
      setConflictActionBusy('');
    }
  }, [conflictPreview, currentFileRel, onRefreshIndex, onReloadCurrentFile, refreshConflictSummary, refreshLiveHistory, refreshSyncRecoveryOverview, showConfirm, vaultPath]);

  const handleCreateConflictMergeDraft = React.useCallback(async (relativePath?: string) => {
    const api = (window as any).arsnote;
    const target = relativePath || conflictPreview?.conflictRelativePath;
    if (!vaultPath || !target || !api?.createConflictMergeDraft) return;
    setConflictActionBusy(`draft:${target}`);
    setConflictMessage('正在生成智能合并草稿...');
    try {
      const result = await api.createConflictMergeDraft(vaultPath, target);
      if (result.mergedContent) {
        setConflictMergeText(result.mergedContent);
        setConflictMergeDeleteAfterSave(true);
      }
      const stats = result.stats;
      const detail = stats
        ? `追加冲突独有行 ${stats.conflictOnlyLines || 0}，合并表格行 ${stats.tableRowsAdded || 0}${stats.needsReview ? '，需要审核标记区' : ''}`
        : '';
      setConflictMessage(`已生成智能合并草稿：${result.draftRelativePath}${detail ? `。${detail}` : ''}`);
      await onRefreshIndex();
    } catch (err: any) {
      setConflictMessage(err.message || '生成智能合并草稿失败');
    } finally {
      setConflictActionBusy('');
    }
  }, [conflictPreview, onRefreshIndex, vaultPath]);

  const handleSaveConflictMergeResult = React.useCallback(async () => {
    const api = (window as any).arsnote;
    const target = conflictPreview?.conflictRelativePath;
    if (!vaultPath || !target || !api?.saveConflictMergeResult) return;
    if (conflictPreview?.baseTruncated || conflictPreview?.conflictTruncated) {
      setConflictMessage('文件预览被截断，不能直接保存合并结果；请先生成合并草稿手动处理。');
      return;
    }
    const confirmed = await showConfirm(
      '保存合并结果',
      `将用合并编辑框里的内容覆盖 ${conflictPreview.baseRelativePath}，保存前会自动保留历史版本。确定继续吗？`,
    );
    if (!confirmed) {
      setConflictMessage('已取消保存合并结果。');
      return;
    }

    setConflictActionBusy(`merge:${target}`);
    setConflictMessage('正在保存合并结果...');
    try {
      const result = await api.saveConflictMergeResult(vaultPath, target, conflictMergeText, conflictMergeDeleteAfterSave);
      if (result.deletedConflict) {
        setConflictPreview(null);
      } else if (api.previewSyncConflict) {
        const preview = await api.previewSyncConflict(vaultPath, target);
        setConflictPreview(preview);
        setConflictMergeText(preview.baseContent);
      }
      setConflictMessage(`已保存合并结果：${result.restoredPath}`);
      await refreshConflictSummary();
      if (result.restoredPath === currentFileRel) {
        await onReloadCurrentFile?.();
      }
      await onRefreshIndex();
      await refreshLiveHistory();
    } catch (err: any) {
      setConflictMessage(err.message || '保存合并结果失败');
    } finally {
      setConflictActionBusy('');
    }
  }, [conflictMergeDeleteAfterSave, conflictMergeText, conflictPreview, currentFileRel, onRefreshIndex, onReloadCurrentFile, refreshConflictSummary, refreshLiveHistory, showConfirm, vaultPath]);

  const handleDeleteConflict = React.useCallback(async (relativePath?: string) => {
    const api = (window as any).arsnote;
    const target = relativePath || conflictPreview?.conflictRelativePath;
    if (!vaultPath || !target || !api?.deleteSyncConflict) return;
    const confirmed = await showConfirm(
      '删除冲突副本',
      `只会删除 ${target} 这个冲突副本，不会删除正常笔记。确定删除吗？`,
    );
    if (!confirmed) {
      setConflictMessage('已取消删除冲突副本。');
      return;
    }
    setConflictActionBusy(`delete:${target}`);
    setConflictMessage('正在删除冲突副本...');
    try {
      await api.deleteSyncConflict(vaultPath, target);
      if (conflictPreview?.conflictRelativePath === target) {
        setConflictPreview(null);
      }
      setConflictMessage(`已删除冲突副本 ${target}。`);
      await refreshConflictSummary();
    } catch (err: any) {
      setConflictMessage(err.message || '删除冲突副本失败');
    } finally {
      setConflictActionBusy('');
    }
  }, [conflictPreview, refreshConflictSummary, showConfirm, vaultPath]);

  const refreshAiMemoryOverview = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.aiGetMemoryOverview) return;
    setAiMemoryLoading(true);
    try {
      setAiMemoryOverview(await api.aiGetMemoryOverview(vaultPath));
    } catch {
      setAiMemoryOverview(null);
    } finally {
      setAiMemoryLoading(false);
    }
  }, [vaultPath]);

  const runAiSafetySelfTest = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.aiSafetySelfTest) {
      setAiSafetySelfTest({
        ok: false,
        checkedAt: new Date().toISOString(),
        durationMs: 0,
        steps: [{ name: 'api', ok: false, detail: 'AI safety self-test API unavailable' }],
      });
      return;
    }
    setAiSafetyTesting(true);
    setAiSafetySelfTest(null);
    try {
      const result = await api.aiSafetySelfTest(vaultPath);
      setAiSafetySelfTest(result);
      await refreshAiMemoryOverview();
      if (api?.aiListOperationAudit) {
        setAiOperationAudit(await api.aiListOperationAudit(vaultPath, 80));
      }
    } catch (err: any) {
      setAiSafetySelfTest({
        ok: false,
        checkedAt: new Date().toISOString(),
        durationMs: 0,
        steps: [{ name: 'error', ok: false, detail: err.message || 'AI safety self-test failed' }],
      });
    } finally {
      setAiSafetyTesting(false);
    }
  }, [refreshAiMemoryOverview, vaultPath]);

  const refreshAiOperationAudit = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.aiListOperationAudit) return;
    setAiAuditLoading(true);
    setAiAuditMessage('');
    try {
      const rows = await api.aiListOperationAudit(vaultPath, 100);
      setAiOperationAudit(Array.isArray(rows) ? rows : []);
      setAiAuditMessage(`已载入 ${Array.isArray(rows) ? rows.length : 0} 条 AI 操作审计。`);
    } catch (err: any) {
      setAiOperationAudit([]);
      setAiAuditMessage(err.message || '读取 AI 操作审计失败');
    } finally {
      setAiAuditLoading(false);
    }
  }, [vaultPath]);

  const previewAiOperationRollback = React.useCallback(async (token?: string) => {
    const api = (window as any).arsnote;
    const cleanToken = String(token || '').trim();
    if (!vaultPath || !cleanToken || !api?.aiPreviewOperationRollback) return;
    setAiRollbackBusy(`preview:${cleanToken}`);
    setAiAuditMessage('');
    try {
      const preview = await api.aiPreviewOperationRollback(vaultPath, cleanToken);
      setAiRollbackPreview(preview);
      setAiAuditMessage(preview.restorableCount > 0
        ? `回滚预览已生成：可处理 ${preview.restorableCount} 项，跳过 ${preview.skippedCount} 项。`
        : `这个 AI 操作当前没有可安全回滚的项目，跳过 ${preview.skippedCount} 项。`);
    } catch (err: any) {
      setAiRollbackPreview(null);
      setAiAuditMessage(err.message || '生成 AI 回滚预览失败');
    } finally {
      setAiRollbackBusy('');
    }
  }, [vaultPath]);

  const runAiOperationRollback = React.useCallback(async (token?: string) => {
    const api = (window as any).arsnote;
    const cleanToken = String(token || aiRollbackPreview?.token || '').trim();
    if (!vaultPath || !cleanToken || !api?.aiRollbackOperation) return;
    const preview = aiRollbackPreview?.token === cleanToken
      ? aiRollbackPreview
      : (api?.aiPreviewOperationRollback ? await api.aiPreviewOperationRollback(vaultPath, cleanToken) : null);
    if (!preview?.restorableCount) {
      setAiAuditMessage('没有可安全回滚的 AI 操作项目。');
      return;
    }
    const confirmed = await showConfirm(
      '回滚 AI 操作',
      `将回滚 ${cleanToken}：${preview.toolName}\n\n可处理 ${preview.restorableCount} 项，跳过 ${preview.skippedCount} 项。\n如果文件在 AI 执行后又被你手动修改过，会自动跳过。确定继续吗？`,
    );
    if (!confirmed) {
      setAiAuditMessage('已取消 AI 操作回滚。');
      return;
    }
    setAiRollbackBusy(`rollback:${cleanToken}`);
    try {
      const result = await api.aiRollbackOperation(vaultPath, cleanToken);
      setAiAuditMessage(
        `AI 回滚完成：恢复 ${result.restoredCount || 0}，删除新建 ${result.deletedCount || 0}，移除空目录 ${result.removedDirectoryCount || 0}，跳过 ${result.skippedCount || 0}，失败 ${result.failedCount || 0}。`,
      );
      setAiRollbackPreview(result.plan || null);
      await refreshAiOperationAudit();
      await refreshAiMemoryOverview();
      await refreshLiveHistory();
      await onRefreshIndex?.();
      await onReloadCurrentFile?.();
    } catch (err: any) {
      setAiAuditMessage(err.message || 'AI 操作回滚失败');
    } finally {
      setAiRollbackBusy('');
    }
  }, [aiRollbackPreview, onRefreshIndex, onReloadCurrentFile, refreshAiMemoryOverview, refreshAiOperationAudit, refreshLiveHistory, showConfirm, vaultPath]);

  const refreshAiSyncStatus = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.aiSyncStatus) {
      setAiSyncRemoteInfo(null);
      return;
    }
    try {
      setAiSyncRemoteInfo(await api.aiSyncStatus(vaultPath));
    } catch {
      setAiSyncRemoteInfo(null);
    }
  }, [vaultPath]);

  const handleCleanupVaultStorage = React.useCallback(async () => {
    const api = (window as any).arsnote;
    if (!vaultPath || !api?.cleanupVaultStorage) return;
    const keepLatest = Math.max(1, Math.min(50, Math.floor(Number(storageKeepLatestBackups) || 2)));
    const confirmed = await showConfirm(
      '清理 Vault 生成缓存',
      `将保留最近 ${keepLatest} 个本地备份，并清理 AI 会话快照/旧聊天历史等可再生文件。\n\n不会删除正文、图片、MEMORY.md、SOUL.md、USER.md 或 skills。\n\n确定继续吗？`,
    );
    if (!confirmed) {
      setStorageMessage('已取消清理。');
      return;
    }

    setStorageCleaning(true);
    setStorageMessage('正在清理生成缓存...');
    try {
      const result = await api.cleanupVaultStorage(vaultPath, {
        keepLatestBackups: keepLatest,
        pruneBackups: true,
        cleanGeneratedHistory: true,
        pruneAiConversations: true,
        keepAiConversations: 12,
      });
      setStorageCleanupSummary(result);
      setStorageReport(result.report);
      setStorageMessage(`已清理 ${result.deletedCount} 个文件/目录，释放 ${formatBytes(result.deletedSize)}。`);
      await onListBackups();
      await refreshConflictSummary();
      await refreshLiveHistory();
      await refreshServerLiveHistory();
      await refreshAiMemoryOverview();
    } catch (err: any) {
      setStorageMessage(err.message || '清理失败');
    } finally {
      setStorageCleaning(false);
    }
  }, [onListBackups, refreshAiMemoryOverview, refreshConflictSummary, refreshLiveHistory, refreshServerLiveHistory, showConfirm, storageKeepLatestBackups, vaultPath]);

  React.useEffect(() => {
    if (activeTab !== 'settings') return;
    refreshLiveSyncHealth();
    refreshSyncRecoveryOverview();
    refreshConflictSummary();
    refreshLiveHistory();
    refreshServerLiveHistory();
    refreshAiMemoryOverview();
    refreshAiSyncStatus();
    refreshVaultStorageReport();
  }, [activeTab, refreshLiveSyncHealth, refreshSyncRecoveryOverview, refreshConflictSummary, refreshLiveHistory, refreshServerLiveHistory, refreshAiMemoryOverview, refreshAiSyncStatus, refreshVaultStorageReport]);

  React.useEffect(() => {
    if (activeTab !== 'ai') return;
    refreshAiMemoryOverview();
    refreshAiOperationAudit();
  }, [activeTab, refreshAiMemoryOverview, refreshAiOperationAudit]);

  /* Game Workspace state (must be top-level for rules of hooks) */
  const [gFilter, setGFilter] = useState<{type: GameDocType | 'all'; status: string; priority: string; owner: string; query: string}>({
    type: 'all', status: 'all', priority: 'all', owner: 'all', query: '',
  });
  const [reportCopied, setReportCopied] = useState(false);
  const [gameViewMode, setGameViewMode] = useState<'list' | 'board'>('list');
  const [boardGroupBy, setBoardGroupBy] = useState<'status' | 'type'>('status');
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  const resetWizard = () => {
    setWizardStep(0);
    setWizardProvider('local');
    setWizardS3Endpoint('');
    setWizardS3Region('us-east-1');
    setWizardS3Bucket('');
    setWizardS3AccessKey('');
    setWizardS3SecretKey('');
    setWizardS3ForcePathStyle(false);
    setWizardTesting(false);
    setWizardTestOk(null);
    setWizardCreating(false);
    setWizardBackupCreated(false);
    setWizardUploading(false);
    setWizardUploaded(false);
    setWizardBackupPath('');
    setWizardShApiKey('');
  };

  const startWizard = () => {
    resetWizard();
    setWizardOpen(true);
  };

  const closeWizard = () => {
    setWizardOpen(false);
  };

  /* Wizard step handlers */
  const wizardTestConnection = async () => {
    if (wizardProvider === 'local') {
      setWizardTestOk(true);
      return;
    }
    // Set S3 credentials first
    if (onSetS3Credentials) {
      await onSetS3Credentials({
        endpoint: wizardS3Endpoint,
        region: wizardS3Region || 'us-east-1',
        bucket: wizardS3Bucket,
        accessKeyId: wizardS3AccessKey,
        secretAccessKey: wizardS3SecretKey,
        forcePathStyle: wizardS3ForcePathStyle,
      });
    }
    setWizardTesting(true);
    try {
      if (onTestS3Connection) await onTestS3Connection();
      setWizardTestOk(true);
    } catch {
      setWizardTestOk(false);
    }
    setWizardTesting(false);
  };

  const wizardCreateBackup = async () => {
    setWizardCreating(true);
    try {
      if (onGenerateManifest) await onGenerateManifest();
      if (onExportBackup) await onExportBackup();
      setWizardBackupCreated(true);
    } catch (err) {
      console.error('Wizard: create backup failed', err);
    }
    setWizardCreating(false);
  };

  const wizardUploadBackup = async () => {
    if (!wizardBackupPath && lastBackup) {
      setWizardBackupPath(lastBackup.backupPath);
    }
    const bp = wizardBackupPath || (lastBackup ? lastBackup.backupPath : '');
    if (!bp) {
      console.error('Wizard: no backup path available for upload');
      return;
    }
    setWizardUploading(true);
    try {
      if (onUploadBackupToRemote) await onUploadBackupToRemote(bp);
      /* onUploadBackupToRemote already refreshes remote list in App.tsx */
      setWizardUploaded(true);
    } catch (err) {
      console.error('Wizard: upload failed', err);
    }
    setWizardUploading(false);
  };



  const toggleCat = (catId: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId); else next.add(catId);
      return next;
    });
  };

  /* Recent templates */
  const recentIds = useMemo(() => loadRecent(), []);
  const recentTemplates = useMemo(
    () => recentIds.map((id) => templates.find((tp) => tp.id === id)).filter(Boolean) as any[],
    [recentIds, templates],
  );

  const previewHtml = useMemo(() => renderMarkdown(previewContent, {
    imageNotFoundText: t.imageNotFound,
    resolveImageSrc: (src) => {
      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:') || src.startsWith('blob:')) {
        return src;
      }
      if (!currentFilePath || !vaultPath) return null;
      const fileDir = currentFilePath.includes('/')
        ? currentFilePath.substring(0, currentFilePath.lastIndexOf('/'))
        : currentFilePath.substring(0, currentFilePath.lastIndexOf('\\'));
      const resolved = resolveRelativePath(fileDir, src);
      if (!isInsideVault(resolved, vaultPath)) return null;
      return 'file:///' + resolved.replace(/\\/g, '/');
    },
  }), [previewContent, currentFilePath, vaultPath, t.imageNotFound]);

  const handlePreviewClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const wikiTarget = event.target instanceof Element
      ? event.target.closest<HTMLElement>('.md-wiki-link')
      : null;
    if (wikiTarget) {
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new CustomEvent('ars-note:open-wiki-link', {
        detail: { target: wikiTarget.dataset.wiki || wikiTarget.textContent || '' },
      }));
      return;
    }

    const linkTarget = event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>('a[href]')
      : null;
    if (!linkTarget) return;

    event.preventDefault();
    event.stopPropagation();
    const rawHref = linkTarget.getAttribute('href') || '';
    const lower = rawHref.toLowerCase();
    if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:')) {
      window.arsnote.openExternalUrl(rawHref);
      return;
    }
    if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('file://')) return;
    if (!currentFilePath || !vaultPath) return;

    const normVault = vaultPath.replace(/\\/g, '/');
    const normCurrent = currentFilePath.replace(/\\/g, '/');
    let decodedHref = rawHref;
    try { decodedHref = decodeURIComponent(rawHref); } catch { /* use as-is */ }
    const hashIdx = decodedHref.indexOf('#');
    if (hashIdx >= 0) decodedHref = decodedHref.substring(0, hashIdx);
    const lastSlash = normCurrent.lastIndexOf('/');
    const currentDir = lastSlash >= 0 ? normCurrent.substring(0, lastSlash) : normVault;
    const hrefParts = decodedHref.replace(/\\/g, '/').split('/');
    const resolvedParts: string[] = [];
    const baseParts = currentDir.split('/').filter(Boolean);
    for (const part of [...baseParts, ...hrefParts]) {
      if (part === '..') {
        if (resolvedParts.length > 0) resolvedParts.pop();
      } else if (part !== '.' && part !== '') {
        resolvedParts.push(part);
      }
    }
    const resolvedPath = resolvedParts.join('/');
    if (!resolvedPath.toLowerCase().startsWith(normVault.toLowerCase().replace(/\\/g, '/'))) {
      notify(t.linkTargetNotFound, 'warning');
      return;
    }
    if (!resolvedPath.toLowerCase().endsWith('.md')) {
      notify(t.unsupportedLinkType, 'warning');
      return;
    }
    onSearchResultClick(resolvedPath);
  };

  const mdComponents = {
    img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { node?: any }) => (
      <PreviewImage src={src} alt={alt} currentFilePath={currentFilePath} vaultPath={vaultPath} notFoundText={t.imageNotFound} />
    ),
    a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: any }) => {
      if (!href) return <a {...props}>{children}</a>;

      /* Prevent default navigation for ALL links in preview */
      const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        e.stopPropagation();

        const rawHref = href;

        /* External links: open in system browser */
        const lower = rawHref.toLowerCase();
        if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:')) {
          window.arsnote.openExternalUrl(rawHref);
          return;
        }

        /* Block dangerous protocols */
        if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('file://')) {
          return;
        }

        /* Internal link: resolve path relative to current file */
        if (!currentFilePath || !vaultPath) return;

        const normVault = vaultPath.replace(/\\/g, '/');
        const normCurrent = currentFilePath.replace(/\\/g, '/');

        /* Decode URI encoding in href */
        let decodedHref = rawHref;
        try { decodedHref = decodeURIComponent(rawHref); } catch { /* use as-is */ }

        /* Strip anchor fragments */
        const hashIdx = decodedHref.indexOf('#');
        if (hashIdx >= 0) decodedHref = decodedHref.substring(0, hashIdx);

        /* Resolve relative path from current file's directory */
        const lastSlash = normCurrent.lastIndexOf('/');
        const currentDir = lastSlash >= 0 ? normCurrent.substring(0, lastSlash) : normVault;

        /* Split and resolve .. / . */
        const hrefParts = decodedHref.replace(/\\/g, '/').split('/');
        const resolvedParts: string[] = [];
        const baseParts = currentDir.split('/').filter(Boolean);
        for (const part of [...baseParts, ...hrefParts]) {
          if (part === '..') {
            if (resolvedParts.length > 0) resolvedParts.pop();
          } else if (part !== '.' && part !== '') {
            resolvedParts.push(part);
          }
        }
        const resolvedPath = resolvedParts.join('/');

        /* Safety: ensure resolved path is inside vault */
        if (!resolvedPath.toLowerCase().startsWith(normVault.toLowerCase().replace(/\\/g, '/'))) {
          notify(t.linkTargetNotFound, 'warning');
          return;
        }

        /* Check file extension */
        if (!resolvedPath.toLowerCase().endsWith('.md')) {
          notify(t.unsupportedLinkType, 'warning');
          return;
        }

        /* Try to open the file */
        onSearchResultClick(resolvedPath);
      };

      return (
        <a href={href} onClick={handleClick} style={{ cursor: 'pointer' }} {...props}>
          {children}
        </a>
      );
    },
  };

  /* Handle refresh index button */
  const handleRefreshIndex = async () => {
    setIsRefreshing(true);
    await onRefreshIndex();
    setIsRefreshing(false);
  };

  /* Handle missing note click */
  const handleMissingClick = async (targetName: string) => {
    const baseName = targetName.split('/').pop() || targetName;
    const confirmed = await showConfirm(
      t.createMissingNote,
      `"${baseName.replace(/\.md$/i, '')}.md" ${t.createMissingNoteDesc}`,
    );
    if (confirmed) {
      await onCreateMissingNote(targetName);
    }
  };

  /* Toggle ambiguous candidate expansion */
  const toggleAmbiguous = (target: string) => {
    setExpandedAmbiguous((prev) => {
      const next = new Set(prev);
      if (next.has(target)) next.delete(target); else next.add(target);
      return next;
    });
  };

  /* Toggle incoming link snippet expansion */
  const toggleIncoming = (relPath: string) => {
    setExpandedIncoming((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath); else next.add(relPath);
      return next;
    });
  };

  const scrollToSettingsSection = React.useCallback((sectionId: string) => {
    if (onSettingsSectionChange) {
      const targetSection = sectionId === 'settings-ai'
        ? 'ai'
        : sectionId === 'settings-live-sync'
          ? 'live-sync'
          : sectionId === 'settings-sync-base'
            ? 'sync'
            : sectionId === 'settings-live-sync-recovery'
              ? 'recovery'
              : sectionId;
      onSettingsSectionChange(targetSection);
      window.setTimeout(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
      return;
    }
    window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [onSettingsSectionChange]);

  React.useEffect(() => {
    const openRecoveryCenter = () => {
      setSettingsShowAdvanced(true);
      setSyncRecoveryToolsOpen(true);
      refreshSyncRecoveryOverview();
      scrollToSettingsSection('settings-live-sync-recovery');
    };
    window.addEventListener('ars-note:open-sync-recovery-center', openRecoveryCenter);
    return () => window.removeEventListener('ars-note:open-sync-recovery-center', openRecoveryCenter);
  }, [refreshSyncRecoveryOverview, scrollToSettingsSection]);

  /* Handle tag pill click — select tag in Tag Browser */
  const handleTagPillClick = (tag: string) => {
    setSelectedTag(tag);
    onTagClick(tag);
  };

  /* Notes for the selected tag */
  const selectedTagNotes = useMemo<TagNoteInfo[]>(() => {
    if (!selectedTag) return [];
    return tagToNotesMap.get(selectedTag) ?? [];
  }, [selectedTag, tagToNotesMap]);

  const normalizedLinkFilter = linkFilter.trim().toLowerCase();
  const matchesLinkFilter = (values: Array<string | undefined>) => {
    if (!normalizedLinkFilter) return true;
    return values.some((value) => (value || '').toLowerCase().includes(normalizedLinkFilter));
  };

  const filteredVaultTags = useMemo(
    () => allVaultTags.filter(([tag]) => matchesLinkFilter([tag])),
    [allVaultTags, normalizedLinkFilter],
  );

  const filteredSelectedTagNotes = useMemo(
    () => selectedTagNotes.filter((note) => matchesLinkFilter([note.title, note.fileName, note.relativePath])),
    [selectedTagNotes, normalizedLinkFilter],
  );

  const filteredIncomingLinks = useMemo(
    () => groupedIncomingLinks.filter((link) => matchesLinkFilter([link.title, link.fileName, link.relativePath, ...link.snippets])),
    [groupedIncomingLinks, normalizedLinkFilter],
  );

  const filteredOutgoingLinks = useMemo(
    () => outgoingLinksInfo.filter((link) => matchesLinkFilter([
      link.target,
      link.alias,
      link.title,
      link.fileName,
      link.relativePath,
      link.status,
      ...link.candidates.map((candidate) => `${candidate.title} ${candidate.fileName} ${candidate.relativePath}`),
    ])),
    [outgoingLinksInfo, normalizedLinkFilter],
  );

  /* Group outgoing links by status */
  const resolvedLinks = useMemo(() => filteredOutgoingLinks.filter((l) => l.status === 'resolved'), [filteredOutgoingLinks]);
  const missingLinks = useMemo(() => filteredOutgoingLinks.filter((l) => l.status === 'missing'), [filteredOutgoingLinks]);
  const ambiguousLinks = useMemo(() => filteredOutgoingLinks.filter((l) => l.status === 'ambiguous'), [filteredOutgoingLinks]);

  /* Status badge for outgoing links */
  const renderStatusBadge = (status: 'resolved' | 'missing' | 'ambiguous') => {
    if (status === 'resolved') return <span className="bl-status-badge bl-status-resolved">✓</span>;
    if (status === 'missing') return <span className="bl-status-badge bl-status-missing">✗</span>;
    return <span className="bl-status-badge bl-status-ambiguous">?</span>;
  };

  /* Render a single outgoing link card */
  const renderOutgoingCard = (info: OutgoingLinkInfo, idx: number) => {
    const isExpanded = expandedAmbiguous.has(info.target);
    const isMissing = info.status === 'missing';
    const isAmbiguous = info.status === 'ambiguous';

    return (
      <div key={`out-${info.status}-${idx}`}>
        <div
          className={`bl-link-card ${isMissing ? 'bl-link-missing' : ''} ${isAmbiguous ? 'bl-link-ambiguous' : ''}`}
          onClick={() => {
            if (isMissing) handleMissingClick(info.target);
            else if (isAmbiguous) toggleAmbiguous(info.target);
            else if (info.filePath) onSearchResultClick(info.filePath);
          }}
        >
          <div className="bl-link-title">
            {renderStatusBadge(info.status)}
            {info.alias || info.title}
            {info.alias && info.alias !== info.target && (
              <span className="bl-alias-label">{t.alias}: {info.target}</span>
            )}
            {isMissing && <span className="bl-missing-badge">{t.missingNote}</span>}
            {isAmbiguous && <span className="bl-ambiguous-badge">{t.ambiguousLink}</span>}
          </div>
          {(info.relativePath || info.target) && (
            <div className="bl-link-path">{info.relativePath || info.target}</div>
          )}
          {isAmbiguous && info.candidates.length > 0 && (
            <div className="bl-link-hint">
              {isExpanded ? '▾' : '▸'} {info.candidates.length} {t.linkCandidates}
            </div>
          )}
        </div>

        {isAmbiguous && isExpanded && info.candidates.length > 0 && (
          <div className="bl-candidate-list">
            <div className="bl-candidate-header">{t.chooseTarget}</div>
            {info.candidates.map((cand, cIdx) => (
              <div
                key={`cand-${cIdx}`}
                className="bl-candidate-item"
                onClick={(e) => { e.stopPropagation(); if (cand.filePath) onSearchResultClick(cand.filePath); }}
              >
                <div className="bl-candidate-name">{cand.fileName.replace(/\.md$/i, '')}</div>
                <div className="bl-candidate-path">{cand.relativePath}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="right-panel">
      <div className="right-panel-nav">
        {/* Category tabs */}
        <div className="right-category-tabs">
          {CATEGORY_TABS.map(({ cat }) => (
            <button
              key={cat}
              className={`right-cat-tab ${categoryForTab(activeTab) === cat ? 'active' : ''}`}
              onClick={() => {
                const entry = CATEGORY_TABS.find(c => c.cat === cat);
                if (entry && !entry.tabs.includes(activeTab)) onTabChange(entry.tabs[0]);
              }}
            >
{React.createElement(getCategoryIcon(cat), { size: 12, style: { marginRight: 4, verticalAlign: 'middle' } })}
              {cat === 'workspace' ? (t.workspace || 'Workspace')
                : cat === 'knowledge' ? (t.knowledge || 'Knowledge')
                : (t.ai || 'AI')}
            </button>
          ))}
        </div>
        {/* Sub-tabs for active category */}
        {(CATEGORY_TABS.find(c => c.cat === categoryForTab(activeTab))?.tabs.length || 0) > 1 && (
          <div className="right-sub-tabs">
            {CATEGORY_TABS.find(c => c.cat === categoryForTab(activeTab))?.tabs.map((tab) => (
            <button
              key={tab}
              className={`right-sub-tab ${activeTab === tab ? 'active' : ''}`}
              onClick={() => onTabChange(tab)}
            >
{React.createElement(getRightPanelTabIcon(tab), { size: 11, style: { marginRight: 3, verticalAlign: 'middle' } })}
              {tab === 'game' ? '文档雷达'
                : tab === 'preview' ? (t.preview || 'Preview')
                : tab === 'templates' ? (t.templates || 'Templates')
                : tab === 'backlinks' ? (t.backlinks || 'Links')
                : tab === 'graph' ? (t.graph || 'Graph')
                : tab === 'search' ? (t.search || 'Search')
                : tab === 'ai' ? (t.aiAssistant || 'AI Chat')
                : tab === 'backup' ? (t.backup || 'Backup')
                : tab === 'settings' ? (t.settings || 'Settings')
                : tab}
            </button>
            ))}
          </div>
        )}
      </div>
      <div className="right-panel-content">
        {activeTab === 'preview' && (
          <div className="preview-content markdown-preview-body" onClick={handlePreviewClick}>
            {previewContent ? (
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
            ) : (
              <div className="preview-empty">{t.openFileToPreview}</div>
            )}
          </div>
        )}

        {activeTab === 'search' && (
          <div>
            <div className="search-input-wrapper">
              <input className="search-input" placeholder={t.searchPlaceholder} value={searchQuery} onChange={(e) => onSearch(e.target.value)} autoFocus />
              {searchQuery && <button className="search-clear-btn" onClick={() => onSearch('')} title={t.clearSearch}>×</button>}
            </div>
            <div className="search-results">
              {searchResults.map((result, idx) => (
                <div key={`${result.filePath}-${result.line}-${idx}`} className="search-result-item"
                  onClick={() => onSearchResultClick(result.filePath)}>
                  <div className="search-result-file">
                    {result.fileName}
                    {result.relativePath && result.relativePath !== result.fileName && (
                      <span className="search-result-path">{result.relativePath.replace(/[/\\][^/\\]+$/, '')}</span>
                    )}
                  </div>
                  {result.line > 0 && (
                    <div className="search-result-line">
                      {language === 'zh-CN' ? `${t.line}${result.line}行` : `${t.line} ${result.line}`}
                    </div>
                  )}
                  {result.snippet && (
                    <div className="search-result-snippet">
                      {splitSearchHighlight(result.snippet, searchQuery).map((part, partIndex) => (
                        part.highlighted
                          ? <mark className="search-result-highlight" key={partIndex}>{part.text}</mark>
                          : <React.Fragment key={partIndex}>{part.text}</React.Fragment>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {searchQuery && searchResults.length === 0 && <div className="search-no-results">{t.noResults}</div>}
            </div>
          </div>
        )}

        {activeTab === 'outline' && (
          <div className="outline-panel">
            <div className="bl-section-header section-card-header">Outline</div>
            <OutlineView content={previewContent} onJumpToLine={onJumpToLine} />
          </div>
        )}

        {activeTab === 'backlinks' && (
          <div className="backlinks-panel">
            {/* Index header with refresh and stats */}
            <div className="bl-index-header">
              <div className="bl-index-stats">
                <span className="bl-index-note-count">{noteCount} {t.indexNoteCount}</span>
                <span className="bl-index-tag-count">{tagCount} {t.tagCountLabel}</span>
              </div>
              <button className="bl-refresh-btn" onClick={handleRefreshIndex} disabled={isRefreshing} title={t.refreshIndex}>
                {isRefreshing ? '...' : t.refreshIndex}
              </button>
            </div>
            {indexRefreshMsg && <div className="bl-refresh-feedback">{t.indexRefreshed}</div>}
            {noteCount === 0 && <div className="bl-empty-hint">{t.noNotesIndexed}</div>}

            <div className="bl-filter-row">
              <input
                className="bl-filter-input"
                value={linkFilter}
                onChange={(e) => setLinkFilter(e.target.value)}
                placeholder="Filter links, tags, paths..."
              />
              {linkFilter && (
                <button className="bl-filter-clear" onClick={() => setLinkFilter('')} title="Clear filter">
                  Clear
                </button>
              )}
            </div>

            {/* ── Graph Summary ── */}
            {graphSummary.totalNodes > 0 && (
              <div className="bl-section sync-section-card">
                <div className="bl-section-header section-card-header">{t.graphSummary}</div>
                <div className="bl-graph-stats">
                  <div className="bl-graph-stat">
                    <span className="bl-graph-stat-value">{graphSummary.totalNodes}</span>
                    <span className="bl-graph-stat-label">{t.nodes}</span>
                  </div>
                  <div className="bl-graph-stat">
                    <span className="bl-graph-stat-value">{graphSummary.totalEdges}</span>
                    <span className="bl-graph-stat-label">{t.edges}</span>
                  </div>
                  <div className="bl-graph-stat">
                    <span className="bl-graph-stat-value">{graphSummary.noteNodes}</span>
                    <span className="bl-graph-stat-label">{t.noteNodes}</span>
                  </div>
                  <div className="bl-graph-stat">
                    <span className="bl-graph-stat-value">{graphSummary.tagNodes}</span>
                    <span className="bl-graph-stat-label">{t.tagNodes}</span>
                  </div>
                  <div className="bl-graph-stat">
                    <span className="bl-graph-stat-value">{graphSummary.missingNodes}</span>
                    <span className="bl-graph-stat-label">{t.missingNodes}</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Tag Browser ── */}
            <div className="bl-section sync-section-card">
              <div className="bl-section-header section-card-header">{t.tagBrowser}</div>
              {allVaultTags.length > 0 ? (
                <>
                  <div className="bl-tag-list">
                    {filteredVaultTags.map(([tag, count]) => (
                      <span
                        key={tag}
                        className={`bl-tag-pill bl-tag-clickable ${selectedTag === tag ? 'bl-tag-selected' : ''}`}
                        onClick={() => handleTagPillClick(tag)}
                        title={`${count} ${t.notesUsingTag}`}
                      >
                        #{tag}
                        <span className="bl-tag-count">{count}</span>
                      </span>
                    ))}
                  </div>

                  {/* Selected tag file list */}
                  {selectedTag && (
                    <div className="bl-tag-detail">
                      <div className="bl-tag-detail-header">
                        <span className="bl-tag-detail-label">{t.selectedTag}: #{selectedTag}</span>
                        <span className="bl-tag-detail-count">{filteredSelectedTagNotes.length} {t.notesUsingTag}</span>
                      </div>
                      {filteredSelectedTagNotes.length > 0 ? (
                        <div className="bl-link-list">
                          {filteredSelectedTagNotes.map((note) => (
                            <div key={note.relativePath} className="bl-link-card" onClick={() => onSearchResultClick(note.filePath)}>
                              <div className="bl-link-title">{note.fileName.replace(/\.md$/i, '')}</div>
                              <div className="bl-link-path">{note.relativePath}</div>
                              {note.tagCount > 1 && (
                                <div className="bl-link-meta">{t.referenceCount}: {note.tagCount}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="bl-empty-hint">{normalizedLinkFilter ? 'No matching notes for this tag.' : t.noCandidateFiles}</div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="bl-empty-hint">{t.noTags}</div>
              )}
              {allVaultTags.length > 0 && filteredVaultTags.length === 0 && (
                <div className="bl-empty-hint">No matching tags.</div>
              )}
            </div>

            {/* ── Current file tags (only when a file is open) ── */}
            {currentFilePath && (
              <div className="bl-section sync-section-card">
                <div className="bl-section-header section-card-header">{t.currentFileTags}</div>
                {currentTags.length > 0 ? (
                  <div className="bl-tag-list">
                    {currentTags.map((tag) => (
                      <span key={tag} className="bl-tag-pill bl-tag-clickable" onClick={() => handleTagPillClick(tag)} title={`${tag} — ${t.notesUsingTag}`}>
                        #{tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="bl-empty-hint">{t.noTags}</div>
                )}
              </div>
            )}

            {/* ── Incoming links (grouped by source file) ── */}
            {currentFilePath && (
              <div className="bl-section sync-section-card">
                <div className="bl-section-header section-card-header">
                  {t.incomingLinks}
                  <span className="bl-count">{filteredIncomingLinks.length}</span>
                </div>
                {filteredIncomingLinks.length > 0 ? (
                  <div className="bl-link-list">
                    {filteredIncomingLinks.map((bl) => {
                      const isExpanded = expandedIncoming.has(bl.relativePath);
                      return (
                        <div key={bl.relativePath}>
                          <div
                            className="bl-link-card bl-link-grouped"
                            onClick={() => {
                              if (bl.refCount === 1) onSearchResultClick(bl.filePath);
                              else toggleIncoming(bl.relativePath);
                            }}
                          >
                            <div className="bl-link-title">
                              {bl.title}
                              {bl.refCount > 1 && (
                                <span className="bl-ref-count">{bl.refCount}x</span>
                              )}
                            </div>
                            <div className="bl-link-path">{bl.relativePath}</div>
                            {bl.refCount > 1 && (
                              <div className="bl-link-hint">
                                {isExpanded ? t.hideReferences : `${t.showReferences} (${bl.refCount})`}
                              </div>
                            )}
                          </div>

                          {isExpanded && bl.snippets.length > 0 && (
                            <div className="bl-snippet-list">
                              {bl.snippets.map((snippet, sIdx) => (
                                <div key={sIdx} className="bl-snippet-item">{snippet}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="bl-empty-hint">{normalizedLinkFilter ? 'No matching backlinks.' : t.noBacklinks}</div>
                )}
              </div>
            )}

            {/* ── Outgoing links (grouped by status) ── */}
            {currentFilePath && (
              <div className="bl-section sync-section-card">
                <div className="bl-section-header section-card-header">
                  {t.outgoingLinks}
                  <span className="bl-count">{filteredOutgoingLinks.length}</span>
                </div>
                {filteredOutgoingLinks.length > 0 ? (
                  <div className="bl-link-list">
                    {/* Resolved group */}
                    {resolvedLinks.length > 0 && (
                      <div className="bl-outgoing-group">
                        <div className="bl-outgoing-group-header">
                          {renderStatusBadge('resolved')}
                          {t.resolvedLinks}
                          <span className="bl-count">{resolvedLinks.length}</span>
                        </div>
                        {resolvedLinks.map((info, idx) => renderOutgoingCard(info, idx))}
                      </div>
                    )}

                    {/* Missing group */}
                    {missingLinks.length > 0 && (
                      <div className="bl-outgoing-group">
                        <div className="bl-outgoing-group-header">
                          {renderStatusBadge('missing')}
                          {t.missingLinks}
                          <span className="bl-count">{missingLinks.length}</span>
                        </div>
                        {missingLinks.map((info, idx) => renderOutgoingCard(info, idx))}
                      </div>
                    )}

                    {/* Ambiguous group */}
                    {ambiguousLinks.length > 0 && (
                      <div className="bl-outgoing-group">
                        <div className="bl-outgoing-group-header">
                          {renderStatusBadge('ambiguous')}
                          {t.ambiguousLinks}
                          <span className="bl-count">{ambiguousLinks.length}</span>
                        </div>
                        {ambiguousLinks.map((info, idx) => renderOutgoingCard(info, idx))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bl-empty-hint">{normalizedLinkFilter ? 'No matching outgoing links.' : t.noOutgoingLinks}</div>
                )}
              </div>
            )}

            {!currentFilePath && (
              <div className="backlinks-empty">{t.openFileToLinks}</div>
            )}
          </div>
        )}

        {activeTab === 'graph' && (
          <React.Suspense fallback={<div className="lazy-panel-fallback" role="status">正在加载知识图谱...</div>}>
            <GraphView
              graphData={graphData}
              graphSummary={graphSummary}
              currentFilePath={currentFilePath}
              vaultIndex={vaultIndex}
              onOpenFile={(relPath) => {
                if (!relPath) return;
                const fullPath = vaultPath + '/' + relPath.replace(/\\/g, '/');
                onSearchResultClick(fullPath);
              }}
              onTagClick={(tag) => onTagClick(tag)}
              onCreateMissingNote={(target) => onCreateMissingNote(target)}
            />
          </React.Suspense>
        )}

        {activeTab === 'backup' && (
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
                onClick={startWizard}
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
        )}

        {activeTab === 'templates' && (
          <div className="template-grid">
            <div className="template-grid-hint">{t.createFromTemplate}</div>
            {recentTemplates.length > 0 && (
              <div className="tmpl-rp-group">
                <div className="tmpl-rp-group-header">
                  <span className="tmpl-rp-toggle">▾</span>
                  <span className="tmpl-rp-group-name">{t.recentlyUsed}</span>
                  <span className="tmpl-rp-group-count">{recentTemplates.length}</span>
                </div>
                <div className="tmpl-rp-cards">
                  {recentTemplates.map((tmpl) => (
                    <div key={tmpl.id} className="template-card" onClick={() => onCreateFromTemplate(tmpl.id)}>
                      <div className="template-card-name">{tmpl.name}</div>
                      <div className="template-card-desc">{tmpl.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {categories.map((cat) => {
              const catTemplates = templates.filter((tmpl) => tmpl.category === cat.id);
              if (catTemplates.length === 0) return null;
              const isCollapsed = collapsedCats.has(cat.id);
              return (
                <div key={cat.id} className="tmpl-rp-group">
                  <div className="tmpl-rp-group-header" onClick={() => toggleCat(cat.id)}>
                    <span className="tmpl-rp-toggle">{isCollapsed ? '▸' : '▾'}</span>
                    <span className="tmpl-rp-group-name">{cat.name}</span>
                    <span className="tmpl-rp-group-count">{catTemplates.length}</span>
                  </div>
                  {!isCollapsed && (
                    <div className="tmpl-rp-cards">
                      {catTemplates.map((tmpl) => (
                        <div key={tmpl.id} className="template-card" onClick={() => onCreateFromTemplate(tmpl.id)}>
                          <div className="template-card-name">{tmpl.name}</div>
                          <div className="template-card-desc">{tmpl.description}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className={`settings-panel settings-simple-panel settings-page-${activeSettingsSection} ${settingsShowAdvanced ? 'show-advanced' : ''} ${syncRecoveryToolsOpen ? 'show-sync-recovery' : ''}`} data-settings-section={activeSettingsSection}>
            <section className="settings-quick-console settings-section-home">
              <header>
                <div>
                  <span className="settings-quick-eyebrow">Settings</span>
                  <h3>常用设置</h3>
                  <p>这里只显示当前 Vault、实时同步和 AI。诊断、恢复与服务器工具收在对应页面的高级设置中。</p>
                </div>
                <button type="button" onClick={() => setSettingsShowAdvanced((value) => !value)}>
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
                当前界面采用 Obsidian Things 风格的深色主题，设置窗口、侧栏、编辑器背景和右侧面板会统一跟随这套视觉。后续主题切换也会放在这里。
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
                        {s3ConnectionTest.errors.map((err, i) => (
                          <div key={i} className="s3-test-error">{err}</div>
                        ))}
                      </div>
                    )}
                    {s3ConnectionTest.warnings.length > 0 && (
                      <div className="s3-test-warnings">
                        {s3ConnectionTest.warnings.map((w, i) => (
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
                  {aiSyncExcludedRules.map((rule) => <code key={rule}>{rule}</code>)}
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
                          {aiSyncRemotePreview.shown.map((file) => (
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
                  <span className="live-sync-simple-kicker">Obsidian Sync 式安全同步</span>
                  <div className="live-sync-simple-title">
                    <span className={'live-sync-simple-badge ' + liveSyncSimpleSummary.tone}>
                      {liveSyncSimpleSummary.label}
                    </span>
                    <strong>{liveSyncSimpleSummary.title}</strong>
                  </div>
                  <p>{liveSyncSimpleSummary.detail}</p>
                  {liveSyncSimpleSummary.facts.length > 0 && (
                    <div className="live-sync-simple-facts">
                      {liveSyncSimpleSummary.facts.map((fact) => (
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
                          localStorage.setItem('ars-note.live-sync', JSON.stringify({
                            serverUrl: savedConfig.serverUrl || config.serverUrl,
                            connectionMode: savedConfig.connectionMode || config.connectionMode || 'join',
                          }));
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
                const recentIn = liveSyncActivity.filter(item => item.direction === 'in').length;
                const recentOut = liveSyncActivity.filter(item => item.direction === 'out').length;
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
                        {liveSyncActivity.slice(0, 10).map((item, idx) => (
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
                    {liveSyncTimeline.slice(0, 16).map((item) => (
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
                  <span><strong>{liveSyncSelfTest?.steps.filter(step => step.ok).length || 0}</strong> 通过</span>
                  <span><strong>{liveSyncSelfTest?.steps.filter(step => !step.ok).length || 0}</strong> 失败</span>
                  <span><strong>{liveSyncSelfTest?.durationMs ? `${liveSyncSelfTest.durationMs}ms` : '-'}</strong> 耗时</span>
                </div>
                {liveSyncSelfTest?.steps?.length ? (
                  <div className="sync-self-test-steps">
                    {liveSyncSelfTest.steps.map((step, idx) => (
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
                  <div className="live-sync-queue-empty">连接 Live Sync 后点击自检，就能确认是否真的像 Obsidian Sync 一样自动来回同步。</div>
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
                    {syncRecoveryOverview.recommendedActions.slice(0, 4).map((item) => (
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
                    {accidentRecoveryPlan.actions.slice(0, 5).map((action) => (
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
                    {accidentRecoveryPlan.warnings.map((warning) => (
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
                    {recoveryAdvisorPlan.items.slice(0, 8).map((item) => (
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
                              {item.candidates.slice(0, 5).map((candidate, idx) => {
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
                    {recoveryAdvisorPlan.warnings.map((warning) => (
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
                    {batchRestorePlan.items.slice(0, 5).map((item) => (
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
                    {batchRestorePlan.warnings.map((warning) => (
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
                    {serverBatchRestorePlan.items.slice(0, 5).map((item) => (
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
                    {serverBatchRestorePlan.warnings.map((warning) => (
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
                        {serverSnapshots.map((snapshot) => (
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
                    {serverSnapshotFiles.slice(0, 8).map((item) => {
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
                    {syncRecoveryOverview.history.deletedRecent.slice(0, 3).map((item) => (
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
                    {serverRecoveryDeletedRecent.slice(0, 4).map((item) => (
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
                    {serverRecoveryRejectedRecent.slice(0, 4).map((item) => (
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
                    {syncRecoveryOverview.protectedLocal.files.slice(0, 5).map((item) => (
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
                    {syncRecoveryOverview.aiTrash.files.slice(0, 5).map((item) => (
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
                    {conflictSummary.files.slice(0, 12).map((file) => {
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
                  disabled={!conflictSummary?.files?.some((file) => !file.hiddenRecoveryCopy) || conflictScanning || conflictCleaning || !!conflictActionBusy}
                  onClick={async () => {
                    const count = conflictSummary?.files?.filter((file) => !file.hiddenRecoveryCopy).length || 0;
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
                像 Obsidian 一样查看当前文件的最近版本。需要服务器历史、误删快照和详细差异时再展开高级版本历史。
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
                {!historyLoading && liveHistory.slice(0, 8).map((item) => (
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
                    {!serverHistoryLoading && serverLiveHistory.slice(0, 8).map((item) => (
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
                    {storageReport.warnings.map((warning) => (
                      <div key={warning}>- {warning}</div>
                    ))}
                  </div>
                ) : null}
              </div>

              {storageReport?.buckets?.length ? (
                <div className="conflict-file-list" style={{ marginTop: 8 }}>
                  {storageReport.buckets.map((bucket) => (
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
                  {storageCleanupSummary.actions.map((action) => (
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
        )}

        {activeTab === 'ai' && (() => {
          /* ── Context mode descriptions ── */
          const contextDescs: Record<AIContextMode, string> = {
            currentNote: t.aiContextCurrentNoteDesc || 'AI will read your current note as context.',
            gameWorkspace: t.aiContextGameWorkspaceDesc || 'AI will use the team workspace, doc radar, and task summary as context.',
            arshisContext: t.aiContextArshisContextDesc || 'AI will use the Arshis game context export.',
          };
          const controlDescs: Record<AIControlMode, string> = {
            readonly: '只读分析：AI 只能读取和分析，不允许写入、删除或确认执行。',
            member: '成员执行：允许普通文件操作，但必须先预览并由你确认；不能接管团队排期。',
            producer: '制作人接管：允许团队时间表和生产文档工具，但所有改动仍需确认码。',
          };
          const isConfigured = aiConfig.hasApiKey;
          const lastMsg = aiChatMessages.length > 0 ? aiChatMessages[aiChatMessages.length - 1] : null;
          const hasAssistantResponse = lastMsg && lastMsg.role === 'assistant';

          return (
          <div className={'ai-panel' + (aiToolsOpen ? ' ai-tools-open' : '')}>
            {/* ── Provider Status Bar ── */}
            <div className="ai-panel-header">
              <h3>{t.aiAssistant}</h3>
              <div className={"ai-status-bar " + (isConfigured ? "ai-status-connected" : "ai-status-disconnected")}>
                <span className="ai-status-dot" />
                <span className="ai-status-text">{isConfigured ? (aiConfig.provider + ' / ' + aiConfig.model) : t.aiNotConfigured}</span>
              </div>
            </div>

            {/* ── Safety Notice ── */}
            <div className="ai-safety-note">
              <span className="ai-safety-icon">{'{'}</span>
              <span>{t.aiSafetyNote || 'AI mutating tools apply directly in execution modes and save rollback snapshots automatically. API key is stored in memory only.'}</span>
            </div>

            <div className="backup-info-card" style={{ marginBottom: 12 }}>
              <div className="backup-info-row" style={{ alignItems: 'center', gap: 10 }}>
                <span className="backup-info-label">
                  AI 安全自检
                  <small className="backup-info-meta" style={{ display: 'block', marginTop: 2 }}>
                    验证只读模式、删除预览、确认码、AI 回收副本、live-history 和审计日志。
                  </small>
                </span>
                <span className="backup-info-value" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                  <span className={'live-sync-queue-state ' + (aiSafetySelfTest?.ok ? 'online' : 'offline')}>
                    {aiSafetyTesting ? '测试中' : (aiSafetySelfTest ? (aiSafetySelfTest.ok ? '通过' : '异常') : '未测试')}
                  </span>
                  <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={runAiSafetySelfTest} disabled={aiSafetyTesting || !vaultPath}>
                    {aiSafetyTesting ? '自检中...' : '运行自检'}
                  </button>
                </span>
              </div>
              {aiSafetySelfTest?.steps?.length ? (
                <div className="sync-self-test-list" style={{ marginTop: 8 }}>
                  {aiSafetySelfTest.steps.map((step, idx) => (
                    <div key={`${step.name}-${idx}`} className={'sync-self-test-row ' + (step.ok ? 'ok' : 'error')}>
                      <span className="sync-self-test-dot" />
                      <span className="sync-self-test-name" title={step.name}>{aiSafetySelfTestStepLabel(step.name)}</span>
                      <span className="sync-self-test-detail" title={step.detail}>
                        {step.ok ? '通过' : '失败'}
                        {step.durationMs !== undefined ? ` · ${step.durationMs}ms` : ''}
                        <small>{step.detail}</small>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {aiSafetySelfTest && (
                <div className="backup-info-meta" style={{ marginTop: 8 }}>
                  {aiSafetySelfTest.steps.filter(step => step.ok).length}/{aiSafetySelfTest.steps.length} 通过 · {aiSafetySelfTest.durationMs}ms
                  {aiSafetySelfTest.auditEventCount !== undefined ? ` · 审计 ${aiSafetySelfTest.auditEventCount} 条` : ''}
                </div>
              )}
            </div>

            <div className="backup-info-card" style={{ marginBottom: 12 }}>
              <div className="backup-info-row" style={{ alignItems: 'center', gap: 10 }}>
                <span className="backup-info-label">
                  AI 操作审计 / 回滚
                  <small className="backup-info-meta" style={{ display: 'block', marginTop: 2 }}>
                    AI 真正执行写入、删除、生成团队文档后，会记录可回滚快照；如果之后又被手动改过，会自动跳过。
                  </small>
                </span>
                <span className="backup-info-value" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={refreshAiOperationAudit} disabled={aiAuditLoading || !vaultPath}>
                    {aiAuditLoading ? '读取中...' : '刷新审计'}
                  </button>
                </span>
              </div>

              {appliedAiAuditEvents.length ? (
                <div className="sync-self-test-list" style={{ marginTop: 8 }}>
                  {appliedAiAuditEvents.slice(0, 6).map((event) => {
                    const token = event.token || '';
                    const canRollback = !!event.rollbackAvailable && !!token;
                    return (
                      <div key={`${event.at}-${token}-${event.toolName}`} className={'sync-self-test-row ' + (canRollback ? 'ok' : 'error')}>
                        <span className="sync-self-test-dot" />
                        <span className="sync-self-test-name" title={token}>{event.toolName || 'AI operation'}</span>
                        <span className="sync-self-test-detail" title={event.result || ''}>
                          {event.at ? event.at.replace('T', ' ').substring(0, 19) : '-'}
                          <small>
                            {token || '-'} · {canRollback ? `可回滚 ${event.rollbackFileCount || 0} 项` : '无回滚快照'}
                          </small>
                        </span>
                        <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '3px 8px', fontSize: 11 }}
                            disabled={!canRollback || !!aiRollbackBusy}
                            onClick={() => void previewAiOperationRollback(token)}
                          >
                            {aiRollbackBusy === `preview:${token}` ? '预览中...' : '预览回滚'}
                          </button>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '3px 8px', fontSize: 11 }}
                            disabled={!canRollback || !!aiRollbackBusy}
                            onClick={() => void runAiOperationRollback(token)}
                          >
                            {aiRollbackBusy === `rollback:${token}` ? '回滚中...' : '执行回滚'}
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="backup-info-meta" style={{ marginTop: 8 }}>
                  还没有已执行的 AI 操作审计，或尚未刷新。
                </div>
              )}

              {aiRollbackPreview && (
                <div className="backup-info-card" style={{ marginTop: 8 }}>
                  <div className="backup-info-row">
                    <span className="backup-info-label">当前回滚预览</span>
                    <span className="backup-info-value">
                      {aiRollbackPreview.token} · {aiRollbackPreview.toolName} · 可处理 {aiRollbackPreview.restorableCount} / 跳过 {aiRollbackPreview.skippedCount}
                    </span>
                  </div>
                  {aiRollbackPreview.items.slice(0, 5).map((item) => (
                    <div className="backup-info-row" key={`${item.relativePath}-${item.action}`}>
                      <span className="backup-info-label" title={item.relativePath}>{item.relativePath}</span>
                      <span className="backup-info-value">
                        {item.action === 'restore'
                          ? '恢复旧内容'
                          : item.action === 'delete_created'
                            ? '删除 AI 新建文件'
                            : item.action === 'remove_directory'
                              ? '移除空目录'
                              : `跳过：${item.skipReason || '-'}`}
                      </span>
                    </div>
                  ))}
                  {aiRollbackPreview.items.length > 5 && (
                    <div className="backup-info-meta">还有 {aiRollbackPreview.items.length - 5} 项未显示。</div>
                  )}
                  {aiRollbackPreview.warnings.slice(0, 3).map((warning) => (
                    <div className="backup-info-meta" key={warning}>{warning}</div>
                  ))}
                </div>
              )}

              {aiAuditMessage && (
                <div className={'settings-status-badge ' + (aiAuditMessage.includes('失败') ? 'status-error' : 'status-ok')} style={{ marginTop: 8 }}>
                  {aiAuditMessage}
                </div>
              )}
            </div>

            <div className="bl-section settings-card" style={{ marginBottom: 12 }}>
              <div className="bl-section-header section-card-header">
                <span>AI 记忆管理</span>
                <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={refreshAiMemoryOverview} disabled={aiMemoryLoading}>
                  {aiMemoryLoading ? '刷新中...' : '刷新'}
                </button>
              </div>
              <div className="settings-safety-note">
                这里显示 AI 已记住的内容、自动生成的技能、历史对话，以及会跟随 Live Sync 同步的记忆文件。
              </div>
              <div className="backup-info-card">
                <div className="backup-info-row">
                  <span className="backup-info-label">记忆状态</span>
                  <span className="backup-info-value">
                    {aiMemoryOverview?.status
                      ? `${aiMemoryOverview.status.initialized ? '已初始化' : '未初始化'} / ${aiMemoryOverview.status.historyCount || 0} 段历史`
                      : '未读取'}
                  </span>
                </div>
                <div className="backup-info-row">
                  <span className="backup-info-label">技能 / 任务 / 进化</span>
                  <span className="backup-info-value">
                    {(aiMemoryOverview?.skills?.length || 0)} / {(aiMemoryOverview?.crons?.length || 0)} / {(aiMemoryOverview?.evolutions?.length || 0)}
                  </span>
                </div>
                <div className="backup-info-row">
                  <span className="backup-info-label">同步范围</span>
                  <span className="backup-info-value" title={aiSyncLocalFiles.join(', ') || ''}>
                    核心 {aiSyncLocalBreakdown.core}/3 · Skills {aiSyncLocalBreakdown.skills} · Crons {aiSyncLocalBreakdown.crons} · Evolution {aiSyncLocalBreakdown.evolutions}
                  </span>
                </div>
              </div>

              <div className="backup-info-card" style={{ marginTop: 8 }}>
                <div className="backup-info-label" style={{ marginBottom: 6 }}>手动添加记忆</div>
                <textarea
                  className="sync-textarea"
                  value={newMemoryEntry}
                  onChange={(e) => setNewMemoryEntry(e.target.value)}
                  placeholder="例如：用户偏好简洁中文回答，项目主引擎是 Unity。"
                  rows={3}
                  style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box' }}
                />
                <button
                  className="btn btn-primary"
                  style={{ marginTop: 8 }}
                  disabled={aiMemoryActionBusy || !newMemoryEntry.trim()}
                  onClick={async () => {
                    const text = newMemoryEntry.trim();
                    if (!text) return;
                    setAiMemoryActionBusy(true);
                    try {
                      await (window as any).arsnote.aiAppendMemory(vaultPath, text);
                      setNewMemoryEntry('');
                      await refreshAiMemoryOverview();
                    } catch (err: any) {
                      notify(err.message || '添加失败');
                    } finally {
                      setAiMemoryActionBusy(false);
                    }
                  }}
                >
                  {aiMemoryActionBusy ? '保存中...' : '加入记忆'}
                </button>
              </div>

              {aiMemoryOverview?.memoryEntries?.length > 0 && (
                <div className="backup-info-card" style={{ marginTop: 8 }}>
                  <div className="backup-info-label" style={{ marginBottom: 6 }}>记忆条目</div>
                  {aiMemoryOverview.memoryEntries.slice(0, 8).map((entry: any) => (
                    <div className="backup-info-row" key={`${entry.lineIndex}-${entry.raw}`} style={{ alignItems: 'center', gap: 10 }}>
                      <span className="backup-info-label" title={entry.text} style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                        <span>{entry.text}</span>
                        <span className="backup-info-meta">{entry.date}{entry.locked ? ' / 已锁定' : ''}</span>
                      </span>
                      <span className="backup-info-value" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '3px 8px', fontSize: 11 }}
                          onClick={async () => {
                            try {
                              await (window as any).arsnote.aiSetMemoryEntryLocked(vaultPath, entry.lineIndex, !entry.locked);
                              await refreshAiMemoryOverview();
                            } catch (err: any) {
                              notify(err.message || '操作失败');
                            }
                          }}
                        >
                          {entry.locked ? '解锁' : '锁定'}
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '3px 8px', fontSize: 11 }}
                          onClick={async () => {
                            const confirmed = await showConfirm('删除 AI 记忆', `确定删除这条记忆吗？\n\n${entry.text}`);
                            if (!confirmed) return;
                            try {
                              await (window as any).arsnote.aiDeleteMemoryEntry(vaultPath, entry.lineIndex);
                              await refreshAiMemoryOverview();
                            } catch (err: any) {
                              notify(err.message || '删除失败');
                            }
                          }}
                        >
                          删除
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {aiMemoryOverview?.memoryPreview && (
                <div className="backup-info-card" style={{ marginTop: 8 }}>
                  <div className="backup-info-label" style={{ marginBottom: 6 }}>最近记忆预览</div>
                  <pre style={{ margin: 0, maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--text-secondary)' }}>
                    {aiMemoryOverview.memoryPreview}
                  </pre>
                </div>
              )}

              {aiMemoryOverview?.skills?.length > 0 && (
                <div className="backup-info-card" style={{ marginTop: 8 }}>
                  <div className="backup-info-label" style={{ marginBottom: 6 }}>自动技能</div>
                  {aiMemoryOverview.skills.slice(0, 6).map((skill: any) => (
                    <div className="backup-info-row" key={skill.id || skill.name}>
                      <span className="backup-info-label" title={skill.description || skill.trigger || ''}>{skill.name || skill.id}</span>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={async () => {
                          const confirmed = await showConfirm('删除 AI 技能', `确定删除技能 "${skill.name || skill.id}" 吗？`);
                          if (!confirmed) return;
                          try {
                            await (window as any).arsnote.aiDeleteSkill(vaultPath, skill.id);
                            await refreshAiMemoryOverview();
                          } catch (err: any) {
                            notify(err.message || '删除失败');
                          }
                        }}
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {aiMemoryOverview?.conversations?.length > 0 && (
                <div className="backup-info-card" style={{ marginTop: 8 }}>
                  <div className="backup-info-label" style={{ marginBottom: 6 }}>最近对话历史</div>
                  {aiMemoryOverview.conversations.slice(0, 5).map((conv: any) => (
                    <div className="backup-info-row" key={conv.file}>
                      <span className="backup-info-label" title={conv.file}>{conv.date || conv.file}</span>
                      <span className="backup-info-value" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                        <span>{conv.messageCount || 0} 条</span>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '3px 8px', fontSize: 11 }}
                          onClick={async () => {
                            const confirmed = await showConfirm('删除对话历史', `确定删除 ${conv.file} 吗？`);
                            if (!confirmed) return;
                            try {
                              await (window as any).arsnote.aiDeleteConversation(vaultPath, conv.file);
                              await refreshAiMemoryOverview();
                            } catch (err: any) {
                              notify(err.message || '删除失败');
                            }
                          }}
                        >
                          删除
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Context Mode Selector ── */}
            <div className="ai-context-selector ai-control-selector">
              <div className="ai-context-label">AI 接管模式</div>
              <div className="ai-context-options">
                {([
                  ['readonly', '只读分析'],
                  ['member', '成员执行'],
                  ['producer', '制作人接管'],
                ] as [AIControlMode, string][]).map(([mode, label]) => (
                  <button
                    key={mode}
                    className={"ai-context-btn ai-control-btn ai-control-" + mode + (aiControlMode === mode ? " active" : "")}
                    onClick={() => onAIControlModeChange(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="ai-context-desc">{controlDescs[aiControlMode]}</div>
            </div>

            <div className="ai-context-selector">
              <div className="ai-context-label">{t.contextMode}</div>
              <div className="ai-context-options">
                {([['currentNote', t.contextCurrentNote], ['gameWorkspace', t.contextGameWorkspace], ['arshisContext', t.contextArshisContext]] as [AIContextMode, string][]).map(([mode, label]) => (
                  <button
                    key={mode}
                    className={"ai-context-btn" + (aiContextMode === mode ? " active" : "")}
                    onClick={() => onAIContextModeChange(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="ai-context-desc">{contextDescs[aiContextMode]}</div>
              {aiContextMode === 'currentNote' && !currentFilePath && (
                <div className="ai-context-warning">{t.aiNoCurrentFileWarning || 'No file is currently open. Open a file to use Current Note context.'}</div>
              )}
            </div>

            {/* ── Quick Prompts ── */}
            <div className={'ai-quick-prompts ai-quick-prompts-collapsible' + (aiQuickPromptsOpen ? ' open' : ' collapsed')}>
              <button className="ai-quick-prompts-toggle" onClick={() => setAiQuickPromptsOpen((open) => !open)}>
                <span>{t.quickPrompts}</span>
                <small>{aiQuickPromptsOpen ? 'Hide' : `${QUICK_PROMPTS.length} ready`}</small>
              </button>
              {aiQuickPromptsOpen && (
                <div className="ai-quick-prompts-grid">
                  {QUICK_PROMPTS.map((qp) => (
                    <button key={qp.id} className="ai-quick-prompt-btn" disabled={aiSending || !isConfigured} onClick={() => onAISendChat(qp.prompt)} title={qp.prompt}>
                      {(t as any)[qp.labelKey] || qp.labelKey}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Chat Messages ── */}
            <div className="ai-chat-messages" ref={aiMessagesRef}>
              <AIChatMessageList
                messages={aiChatMessages}
                variant="compact"
                emptyTitle={t.aiNoResponse}
                emptyHint={t.aiChatEmptyHint || 'Type a question below or use a quick prompt to get started.'}
                locale={language === 'zh-CN' ? 'zh' : 'en'}
              />
            </div>

            {/* ── Chat Input ── */}
            <div className="ai-chat-input-row">
              <button
                type="button"
                className={'ai-tools-plus' + (aiToolsOpen ? ' active' : '')}
                onClick={() => setAiToolsOpen((open) => !open)}
                title={aiToolsOpen ? 'Hide AI tools' : 'AI tools'}
                aria-label={aiToolsOpen ? 'Hide AI tools' : 'AI tools'}
              >
                {aiToolsOpen ? 'x' : '+'}
              </button>
              <AIContextMeter usage={aiContextUsage} compact />
              <textarea
                value={aiInput}
                onChange={(e) => onAIInputChange(e.target.value)}
                placeholder={isConfigured ? t.aiChatPlaceholder : t.aiNotConfigured}
                rows={2}
                disabled={!isConfigured}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && isConfigured) { e.preventDefault(); onAISendChat(aiInput); } }}
              />
              {aiCanCancel ? (
                <button className="ai-send-btn ai-stop-btn" onClick={onAICancelChat}>
                  {t.aiStopGenerating}
                </button>
              ) : (
                <button className="ai-send-btn" disabled={aiSending || !aiInput.trim() || !isConfigured} onClick={() => onAISendChat(aiInput)}>
                  {aiSending ? t.aiSending : t.aiSend}
                </button>
              )}
            </div>

            {/* ── Copy Response ── */}
            {hasAssistantResponse && (
              <div className="ai-response-actions">
                {aiCanRetry && (
                  <button className="ai-action-btn" disabled={aiSending} onClick={onAIRetryLast}>
                    {t.aiRetryLast}
                  </button>
                )}
                {onAIImportTasksToSchedule && (
                  <button className="ai-action-btn" disabled={aiSending} onClick={onAIImportTasksToSchedule}>
                    导入团队任务
                  </button>
                )}
                <button className={"ai-action-btn" + (aiCopiedResponse ? " ai-action-success" : "")} onClick={onAICopyResponse}>
                  {aiCopiedResponse ? t.copiedResponse : t.copyResponse}
                </button>
              </div>
            )}
          </div>
          );
        })()}

        {/* Sync Wizard Modal Overlay (v0.7.0) */}
        {wizardOpen && (
          <div className="wizard-overlay">
            <div className="wizard-modal">
              <div className="wizard-header">
                <span className="wizard-title">{t.syncWizard}</span>
                <span className="wizard-step-indicator">{t.wizardStep} {wizardStep + 1} / 7</span>
                <button className="wizard-close-btn" onClick={closeWizard}>×</button>
              </div>

              <div className="wizard-progress">
                {[0,1,2,3,4,5,6].map((s) => (
                  <div
                    key={s}
                    className={'wizard-progress-dot' + (s === wizardStep ? ' wizard-progress-active' : (s < wizardStep ? ' wizard-progress-done' : ''))}
                  />
                ))}
              </div>

              <div className="wizard-body">
                {/* Step 0: Choose Provider */}
                {wizardStep === 0 && (
                  <div className="wizard-step">
                    <div className="wizard-step-title">{t.wizardChooseProvider}</div>
                    <div className="wizard-provider-options">
                      <div
                        className={'wizard-provider-card' + (wizardProvider === 'local' ? ' wizard-provider-selected' : '')}
                        onClick={() => setWizardProvider('local')}
                      >
                        <div className="wizard-provider-name">Local Mock</div>
                        <div className="wizard-provider-desc">{t.wizardLocalMockNoConfig}</div>
                      </div>
                      <div
                        className={'wizard-provider-card' + (wizardProvider === 's3' ? ' wizard-provider-selected' : '')}
                        onClick={() => setWizardProvider('s3')}
                      >
                        <div className="wizard-provider-name">S3 / MinIO / R2</div>
                        <div className="wizard-provider-desc">{t.s3MinioSettings}</div>
                      </div>
                      <div
                        className={'wizard-provider-card' + (wizardProvider === 'self-hosted' ? ' wizard-provider-selected' : '')}
                        onClick={() => setWizardProvider('self-hosted')}
                      >
                        <div className="wizard-provider-name">{t.selfHostedServer}</div>
                        <div className="wizard-provider-desc">{t.serverEndpoint}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 1: Configure Provider */}
                {wizardStep === 1 && (
                  <div className="wizard-step">
                    <div className="wizard-step-title">{t.wizardConfigureProvider}</div>
                    {wizardProvider === 'local' ? (
                      <div className="wizard-info-box">
                        <div className="wizard-info-text">{t.wizardLocalMockNoConfig}</div>
                      </div>
                    ) : wizardProvider === 'self-hosted' ? (
                      <div className="wizard-form">
                        <div className="sync-field">
                          <label className="sync-field-label">{t.serverEndpoint}</label>
                          <input className="sync-input" type="text" value={wizardS3Endpoint}
                            onChange={(e) => setWizardS3Endpoint(e.target.value)}
                            placeholder="http://localhost:3141" />
                        </div>
                        <div className="sync-field">
                          <label className="sync-field-label">{t.selfHostedApiKey}</label>
                          <input className="sync-input" type="password" value={wizardShApiKey}
                            onChange={(e) => setWizardShApiKey(e.target.value)}
                            placeholder="(optional)" autoComplete="off" />
                        </div>
                        <div className="s3-credentials-notice">{t.selfHostedApiKeyNotice}</div>
                      </div>
                    ) : (
                      <div className="wizard-form">
                        <div className="sync-field">
                          <label className="sync-field-label">{t.s3Endpoint}</label>
                          <input className="sync-input" type="text" value={wizardS3Endpoint}
                            onChange={(e) => setWizardS3Endpoint(e.target.value)}
                            placeholder="https://s3.amazonaws.com or http://localhost:9000" />
                        </div>
                        <div className="sync-field">
                          <label className="sync-field-label">{t.s3Region}</label>
                          <input className="sync-input" type="text" value={wizardS3Region}
                            onChange={(e) => setWizardS3Region(e.target.value)}
                            placeholder="us-east-1" />
                        </div>
                        <div className="sync-field">
                          <label className="sync-field-label">{t.s3BucketLabel}</label>
                          <input className="sync-input" type="text" value={wizardS3Bucket}
                            onChange={(e) => setWizardS3Bucket(e.target.value)}
                            placeholder="my-bucket" />
                        </div>
                        <div className="sync-field">
                          <label className="sync-field-label">{t.accessKeyId}</label>
                          <input className="sync-input" type="password" value={wizardS3AccessKey}
                            onChange={(e) => setWizardS3AccessKey(e.target.value)} autoComplete="off" />
                        </div>
                        <div className="sync-field">
                          <label className="sync-field-label">{t.secretAccessKey}</label>
                          <input className="sync-input" type="password" value={wizardS3SecretKey}
                            onChange={(e) => setWizardS3SecretKey(e.target.value)} autoComplete="off" />
                        </div>
                        <label className="sync-checkbox-row">
                          <input type="checkbox" checked={wizardS3ForcePathStyle}
                            onChange={(e) => setWizardS3ForcePathStyle(e.target.checked)} />
                          <span>{t.forcePathStyle}</span>
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {/* Step 2: Test Connection */}
                {wizardStep === 2 && (
                  <div className="wizard-step">
                    <div className="wizard-step-title">{t.wizardTestConnection}</div>
                    {wizardProvider === 'local' ? (
                      <div className="wizard-info-box wizard-info-success">
                        <div className="wizard-info-text">{t.wizardTestPassed}</div>
                      </div>
                    ) : wizardProvider === 'self-hosted' ? (
                      <>
                        <button className="backup-action-btn backup-action-btn-primary wizard-action-btn"
                          onClick={async () => {
                            setWizardTesting(true);
                            try {
                              /* Use IPC (main process) to bypass CSP restrictions */
                              const result = await (window as any).arsnote.selfHostedHealthCheck(wizardS3Endpoint);
                              setWizardTestOk(result.ok === true);
                            } catch {
                              setWizardTestOk(false);
                            }
                            setWizardTesting(false);
                          }}
                          disabled={wizardTesting || !wizardS3Endpoint}
                        >
                          {wizardTesting ? t.wizardTesting : t.serverHealthCheck}
                        </button>
                        {wizardTestOk === true && (
                          <div className="wizard-info-box wizard-info-success">
                            <div className="wizard-info-text">{t.selfHostedTestPassed}</div>
                          </div>
                        )}
                        {wizardTestOk === false && (
                          <div className="wizard-info-box wizard-info-error">
                            <div className="wizard-info-text">{t.selfHostedTestFailed}</div>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <button className="backup-action-btn backup-action-btn-primary wizard-action-btn"
                          onClick={wizardTestConnection}
                          disabled={wizardTesting || (!wizardS3Endpoint || !wizardS3Bucket || !wizardS3AccessKey || !wizardS3SecretKey)}
                        >
                          {wizardTesting ? t.wizardTesting : t.wizardTestConnection}
                        </button>
                        {wizardTestOk === true && (
                          <div className="wizard-info-box wizard-info-success">
                            <div className="wizard-info-text">{t.wizardTestPassed}</div>
                          </div>
                        )}
                        {wizardTestOk === false && (
                          <div className="wizard-info-box wizard-info-error">
                            <div className="wizard-info-text">{t.wizardTestFailed}</div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Step 3: Create Local Backup */}
                {wizardStep === 3 && (
                  <div className="wizard-step">
                    <div className="wizard-step-title">{t.wizardCreateBackup}</div>
                    <button className="backup-action-btn backup-action-btn-primary wizard-action-btn"
                      onClick={wizardCreateBackup}
                      disabled={wizardCreating}
                    >
                      {wizardCreating ? t.wizardCreating : t.wizardCreateBackup}
                    </button>
                    {wizardBackupCreated && (
                      <div className="wizard-info-box wizard-info-success">
                        <div className="wizard-info-text">{t.wizardBackupCreated}</div>
                        {lastBackup && (
                          <div className="wizard-info-detail">
                            {lastBackup.fileCount} files, {formatBytes(lastBackup.totalSize)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Step 4: Upload Backup */}
                {wizardStep === 4 && (
                  <div className="wizard-step">
                    <div className="wizard-step-title">{t.wizardUploadBackup}</div>
                    {(wizardProvider === 'local' || wizardProvider === 'self-hosted') ? (
                      wizardProvider === 'local' ? (
                        <div className="wizard-info-box">
                          <div className="wizard-info-text">{t.wizardLocalMockNoConfig}</div>
                        </div>
                      ) : (
                        <>
                          <button className="backup-action-btn backup-action-btn-primary wizard-action-btn"
                            onClick={wizardUploadBackup}
                            disabled={wizardUploading || !wizardBackupCreated}
                          >
                            {wizardUploading ? t.wizardUploading : t.wizardUploadBackup}
                          </button>
                          {wizardUploaded && (
                            <div className="wizard-info-box wizard-info-success">
                              <div className="wizard-info-text">{t.selfHostedUploadComplete}</div>
                              {cloudUploadSummary && (
                                <div className="wizard-info-detail">
                                  ID: {cloudUploadSummary.remoteId}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )
                    ) : (
                      <>
                        <button className="backup-action-btn backup-action-btn-primary wizard-action-btn"
                          onClick={wizardUploadBackup}
                          disabled={wizardUploading || !wizardBackupCreated}
                        >
                          {wizardUploading ? t.wizardUploading : t.wizardUploadBackup}
                        </button>
                        {wizardUploaded && (
                          <div className="wizard-info-box wizard-info-success">
                            <div className="wizard-info-text">{t.wizardUploadComplete}</div>
                            {cloudUploadSummary && (
                              <div className="wizard-info-detail">
                                ID: {cloudUploadSummary.remoteId}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Step 5: Confirm Remote */}
                {wizardStep === 5 && (
                  <div className="wizard-step">
                    <div className="wizard-step-title">{t.wizardConfirmRemote}</div>
                    {remoteBackups.length > 0 ? (
                      <div className="wizard-remote-list">
                        {remoteBackups.slice(0, 3).map((rb) => (
                          <div key={rb.remoteId} className="wizard-remote-item">
                            <div className="wizard-remote-id">{rb.backupId || rb.remoteId}</div>
                            <div className="wizard-remote-meta">
                              <span>{rb.uploadedAt.replace('T', ' ').substring(0, 19)}</span>
                              <span>{rb.fileCount} files</span>
                              <span>{formatBytes(rb.totalSize)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="wizard-info-box">
                        <div className="wizard-info-text">{t.noRemoteBackups}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Step 6: Safety Summary */}
                {wizardStep === 6 && (
                  <div className="wizard-step">
                    <div className="wizard-step-title">{t.wizardSafetySummary}</div>
                    <div className="wizard-safety-items">
                      <div className="wizard-safety-item">
                        <span className="wizard-safety-dot wizard-safety-pass" />
                        <span>{t.wizardPullSafety}</span>
                      </div>
                      <div className="wizard-safety-item">
                        <span className="wizard-safety-dot wizard-safety-pass" />
                        <span>{t.wizardRestoreSafety}</span>
                      </div>
                      <div className="wizard-safety-item">
                        <span className="wizard-safety-dot wizard-safety-info" />
                        <span>{t.wizardAutoSync}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="wizard-footer">
                <button className="btn btn-secondary" onClick={closeWizard}>
                  {t.wizardClose}
                </button>
                {wizardStep > 0 && (
                  <button className="btn btn-secondary" onClick={() => setWizardStep(wizardStep - 1)}>
                    {t.wizardBack}
                  </button>
                )}
                {wizardStep < 6 ? (
                  <button
                    className="btn btn-primary"
                    onClick={async () => {
                      /* BUG FIX: Save syncConfig to sync.json before advancing
                         so that resolveCloudProvider reads the correct provider.
                         Without this, S3 uploads would route to local-mock. */
                      if (wizardStep === 1 && onSaveSyncConfig) {
                        await onSaveSyncConfig({
                          enabled: true,
                          provider: wizardProvider,
                          status: wizardProvider === 'local' ? 'localOnly' : 'configured',
                          endpoint: (wizardProvider === 's3' || wizardProvider === 'self-hosted') ? wizardS3Endpoint || undefined : undefined,
                          bucket: wizardProvider === 's3' ? wizardS3Bucket || undefined : undefined,
                        });
                      }
                      /* Save self-hosted API key as runtime credentials (v0.8.6) */
                      if (wizardStep === 1 && wizardProvider === 'self-hosted' && onSetSelfHostedCredentials && wizardShApiKey) {
                        await onSetSelfHostedCredentials({
                          endpoint: wizardS3Endpoint,
                          apiKey: wizardShApiKey,
                        });
                      }
                      /* Refresh remote list before entering Confirm Remote step */
                      if (wizardStep === 4 && onListRemoteBackups) {
                        await onListRemoteBackups();
                      }
                      setWizardStep(wizardStep + 1);
                    }}
                    disabled={
                      (wizardStep === 1 && wizardProvider === 's3' && (!wizardS3Endpoint || !wizardS3Bucket || !wizardS3AccessKey || !wizardS3SecretKey)) || (wizardStep === 1 && wizardProvider === 'self-hosted' && !wizardS3Endpoint) ||
                      (wizardStep === 2 && wizardProvider !== 'local' && wizardProvider !== 'self-hosted' && wizardTestOk !== true) || (wizardStep === 2 && wizardProvider === 'self-hosted' && wizardTestOk !== true) ||
                      wizardTesting || wizardCreating || wizardUploading
                    }
                  >
                    {t.wizardNext}
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={closeWizard}>
                    {t.wizardFinish}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'game' && (() => {
          /* ── Filters state (moved to top level) ── */
          const owners = getGameWorkspaceOwners(gameWorkspaceEntries);
          const dashboard = buildGameWorkspaceDashboard(gameWorkspaceEntries, gameWorkspaceSummary);
          const filters: GameWorkspaceFilters = gFilter;
          const filtered = filterGameWorkspaceEntries(gameWorkspaceEntries, filters);
          const hasActiveFilters = filters.type !== 'all' || filters.status !== 'all' || filters.priority !== 'all' || filters.owner !== 'all' || filters.query !== '';

          const clearFilters = () => setGFilter({ type: 'all', status: 'all', priority: 'all', owner: 'all', query: '' });

          /* ── View mode state (moved to top level) ── */

          /* ── Entry card renderer ── */
          const renderEntry = (entry: GameWorkspaceEntry) => (
            <div key={entry.relativePath} className="game-entry-card" onClick={() => onSearchResultClick(entry.relativePath)}>
              <div className="game-entry-card-header">
                <span className={"entry-type-badge badge-" + entry.type}>{entry.type}</span>
                <span className="entry-title">{entry.title}</span>
              </div>
              <div className="game-entry-meta">
                {entry.status && <span className={"game-entry-status status-" + entry.status}>{entry.status}</span>}
                {entry.priority && <span className={"game-entry-priority priority-" + entry.priority}>{entry.priority}</span>}
                {entry.owner && <span className="game-entry-owner">{entry.owner}</span>}
                {entry.updatedAt && <span className="game-entry-updated">{entry.updatedAt}</span>}
              </div>
              {entry.summary && <div className="game-entry-summary">{entry.summary}</div>}
              {entry.tags.length > 0 && (
                <div className="game-entry-tags">
                  {entry.tags.slice(0, 3).map((tag: string) => (
                    <span key={tag} className="tag-chip">#{tag}</span>
                  ))}
                  {entry.tags.length > 3 && <span className="tag-more">+{entry.tags.length - 3}</span>}
                </div>
              )}
            </div>
          );

          /* ── Quick section renderer ── */
          const renderQuickSection = (title: string, entries: GameWorkspaceEntry[]) => {
            if (entries.length === 0) return null;
            return (
              <div className="game-quick-section">
                <h4>{title}</h4>
                <div className="game-quick-list">
                  {entries.map(renderEntry)}
                </div>
              </div>
            );
          };

          /* ── Doc type labels for create buttons ── */
          const docTypeLabels: Record<GameDocType, string> = {
            gdd: t.createGDD,
            coreLoop: t.createCoreLoop,
            worldbuilding: t.createWorldbuilding,
            story: t.createStory,
            dialogue: t.createDialogue,
            performance: t.createPerformance,
            character: t.createCharacter,
            item: t.createItem,
            quest: t.createQuest,
            taskTable: t.createTaskTable,
            unityTask: t.createUnityTask,
            devlog: t.createDevlog,
          };

          return (
          <div className="game-workspace-panel">
            <div className="game-workspace-heading">
              <div>
                <span className="game-workspace-kicker">团队工作台的只读辅助视图</span>
                <h3>文档雷达</h3>
              </div>
              {onOpenTeamWorkspace && (
                <button className="game-open-team-workspace-btn" onClick={() => { void onOpenTeamWorkspace(); }}>
                  打开完整团队工作台
                </button>
              )}
            </div>
            <div className="game-workspace-bridge">
              这里只做文档浏览、筛选、缺口提示和报表导出；排期、成员任务、工时、AI 接管、服务器同步健康与生产文档刷新都请进入完整团队工作台处理。
            </div>

            {/* ── View mode toggle (v0.9.4) ── */}
            <div className="game-view-toggle">
              <button className={gameViewMode === 'list' ? 'active' : ''} onClick={() => setGameViewMode('list')}>{t.listView}</button>
              <button className={gameViewMode === 'board' ? 'active' : ''} onClick={() => setGameViewMode('board')}>{t.boardView}</button>
            </div>

            {/* ── Dashboard ── */}
            <div className="game-dashboard">
              <div className="game-dashboard-grid">
                <div className="game-dashboard-card card-total">
                  <span className="stat-value">{gameWorkspaceSummary.totalGameDocs}</span>
                  <span className="stat-label">{t.totalGameDocs}</span>
                </div>
                <div className="game-dashboard-card card-draft">
                  <span className="stat-value">{gameWorkspaceSummary.draftCount}</span>
                  <span className="stat-label">{t.draft}</span>
                </div>
                <div className="game-dashboard-card card-wip">
                  <span className="stat-value">{Math.max(0, gameWorkspaceSummary.totalGameDocs - gameWorkspaceSummary.draftCount - gameWorkspaceSummary.doneCount)}</span>
                  <span className="stat-label">{t.inProgressShort}</span>
                </div>
                <div className="game-dashboard-card card-done">
                  <span className="stat-value">{gameWorkspaceSummary.doneCount}</span>
                  <span className="stat-label">{t.done}</span>
                </div>
                <div className="game-dashboard-card card-high">
                  <span className="stat-value">{gameWorkspaceSummary.highPriorityCount}</span>
                  <span className="stat-label">{t.highPriority}</span>
                </div>
                <div className="game-dashboard-card card-missing">
                  <span className="stat-value">{dashboard.missingCoreDocs.length}</span>
                  <span className="stat-label">{t.missingCoreDocs}</span>
                </div>
              </div>
            </div>

            {/* ── Missing Core Docs ── */}
            {dashboard.missingCoreDocs.length > 0 && (
              <div className="game-missing-core">
                <div className="game-missing-core-header">
                  <span className="game-missing-core-icon">!</span>
                  <span>{t.missingCoreDocs}</span>
                </div>
                <div className="game-missing-core-items">
                  {dashboard.missingCoreDocs.map((docType: GameDocType) => (
                    <div key={docType} className="game-missing-core-item">
                      <span className={"game-missing-type-badge badge-" + docType}>{docType}</span>
                      <button className="game-create-btn game-create-primary" disabled={gameDocCreating} onClick={() => onCreateGameDoc(docType)} title={docTypeLabels[docType]}>
                        + {t.create}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <ProductionCommandCenter
              vaultPath={vaultPath}
              vaultIndex={vaultIndex}
              onOpenFile={onSearchResultClick}
              onRefreshVault={onRefreshVault}
              onOpenTeamWorkspace={onOpenTeamWorkspace}
            />

            {/* ── Quick Sections (only when no filters active) ── */}
            {!hasActiveFilters && (
              <>
                {renderQuickSection(t.highPriorityDocs, dashboard.highPriorityEntries)}
                {renderQuickSection(t.draftDocs, dashboard.draftEntries)}
                {renderQuickSection(t.recentlyUpdated, dashboard.recentlyUpdatedEntries)}
                {renderQuickSection(t.missingMetadata, dashboard.missingMetadataEntries)}
              </>
            )}

            {/* ── Filters ── */}
            {gameWorkspaceEntries.length > 0 && (
              <div className={"game-filter-bar" + (hasActiveFilters ? " game-filter-active" : "")}>
                <div className="game-filter-row">
                  <div className={"game-filter-control" + (filters.type !== 'all' ? " filter-on" : "")}>
                    <select value={filters.type} onChange={(e) => setGFilter({ ...gFilter, type: e.target.value as GameDocType | 'all' })}>
                      <option value="all">{t.allTypes}</option>
                      <option value="gdd">{t.gddDashboard}</option>
                      <option value="worldbuilding">{t.worldbuilding}</option>
                      <option value="story">{t.storyDocs}</option>
                      <option value="dialogue">{t.dialogueDocs}</option>
                      <option value="performance">{t.performanceDocs}</option>
                      <option value="character">{t.characters}</option>
                      <option value="item">{t.items}</option>
                      <option value="quest">{t.quests}</option>
                      <option value="taskTable">{t.taskTables}</option>
                      <option value="unityTask">{t.unityTasks}</option>
                      <option value="devlog">{t.devlogTimeline}</option>
                    </select>
                  </div>
                  <div className={"game-filter-control" + (filters.status !== 'all' ? " filter-on" : "")}>
                    <select value={filters.status} onChange={(e) => setGFilter({ ...gFilter, status: e.target.value })}>
                      <option value="all">{t.allStatus}</option>
                      <option value="draft">{t.draft}</option>
                      <option value="wip">{t.inProgressShort}</option>
                      <option value="review">Review</option>
                      <option value="done">{t.done}</option>
                    </select>
                  </div>
                  <div className={"game-filter-control" + (filters.priority !== 'all' ? " filter-on" : "")}>
                    <select value={filters.priority} onChange={(e) => setGFilter({ ...gFilter, priority: e.target.value })}>
                      <option value="all">{t.allPriorities}</option>
                      <option value="high">{t.highPriority}</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                  {owners.length > 0 && (
                    <div className={"game-filter-control" + (filters.owner !== 'all' ? " filter-on" : "")}>
                      <select value={filters.owner} onChange={(e) => setGFilter({ ...gFilter, owner: e.target.value })}>
                        <option value="all">{t.allOwners}</option>
                        {owners.map((o: string) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {hasActiveFilters && (
                    <button className="game-filter-clear" onClick={clearFilters}>{t.clearFilters}</button>
                  )}
                </div>
                <div className="game-filter-row">
                  <div className={"game-filter-control" + (filters.query ? " filter-on" : "")} style={{ flex: 1 }}>
                    <input
                      type="text"
                      placeholder={t.searchGameDocs}
                      value={filters.query}
                      onChange={(e) => setGFilter({ ...gFilter, query: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── Filtered Entries ── */}
            {gameWorkspaceEntries.length === 0 ? (
              <div className="game-workspace-empty game-empty-onboarding">
                <div className="empty-icon">{'◎'}</div>
                <div className="empty-title">{t.noGameDocsFound}</div>
                <div className="empty-desc">{t.gameWorkspaceEmptyDesc || 'Start by creating game design documents to organize your project.'}</div>
                <div className="game-onboarding-actions">
                  <button className="game-create-btn game-create-primary" disabled={gameDocCreating} onClick={() => onCreateGameDoc('gdd')}>{t.createGDD}</button>
                  <button className="game-create-btn game-create-primary" disabled={gameDocCreating} onClick={() => onCreateGameDoc('worldbuilding')}>{t.createWorldbuilding}</button>
                  <button className="game-create-btn game-create-primary" disabled={gameDocCreating} onClick={() => onCreateGameDoc('story')}>{t.createStory}</button>
                  <button className="game-create-btn game-create-primary" disabled={gameDocCreating} onClick={() => onCreateGameDoc('dialogue')}>{t.createDialogue}</button>
                  <button className="game-create-btn game-create-primary" disabled={gameDocCreating} onClick={() => onCreateGameDoc('character')}>{t.createCharacter}</button>
                  <button className="game-create-btn game-create-primary" disabled={gameDocCreating} onClick={() => onCreateGameDoc('quest')}>{t.createQuest}</button>
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="game-empty-filter">
                <p>{t.noMatchingDocs}</p>
                <button className="game-filter-clear" onClick={clearFilters} style={{ marginTop: '8px' }}>{t.clearFilters}</button>
              </div>
            ) : gameViewMode === 'list' ? (
              /* ── List View ── */
              <>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                  <button className="btn-icon" style={{ fontSize: 11, padding: '3px 10px', background: batchMode ? 'var(--accent)' : 'var(--bg-card)', color: batchMode ? '#fff' : 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }}
                    onClick={() => { setBatchMode(!batchMode); setBatchSelected(new Set()); }}>
                    {batchMode ? 'Cancel' : 'Batch'}
                  </button>
                  {batchMode && <>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{batchSelected.size} selected</span>
                    <button style={{ fontSize: 11, padding: '3px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-main)', cursor: 'pointer' }}
                      onClick={() => { const all = new Set(filtered.map((e: GameWorkspaceEntry) => e.relativePath)); setBatchSelected(all); }}>All</button>
                    <button style={{ fontSize: 11, padding: '3px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-main)', cursor: 'pointer' }}
                      onClick={() => setBatchSelected(new Set())}>None</button>
                    {batchSelected.size > 0 && <>
                      <select style={{ fontSize: 11, padding: '2px 6px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 4 }}
                        id="batch-action-select">
                        <option value="done">Mark Done</option>
                        <option value="draft">Mark Draft</option>
                        <option value="high">Set High Priority</option>
                        <option value="low">Set Low Priority</option>
                      </select>
                      <button disabled={batchBusy} style={{ fontSize: 11, padding: '3px 10px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: batchBusy ? 'wait' : 'pointer' }}
                        onClick={async () => {
                          if (!(window as any).arsnote?.writeFile) return;
                          const sel = document.getElementById('batch-action-select') as HTMLSelectElement;
                          const action = sel?.value || 'done';
                          setBatchBusy(true);
                          const vp = (window as any).arsnote;
                          for (const relPath of batchSelected) {
                            try {
                              const fullPath = await vp.joinPath((window as any).__vaultPath || '', relPath);
                              const fileContent = await vp.readFile(fullPath);
                              let updated = fileContent;
                              if (action === 'done' || action === 'draft') {
                                if (updated.startsWith('---\n')) {
                                  updated = updated.replace(/status:\s*.+/i, 'status: ' + action);
                                } else {
                                  updated = '---\nstatus: ' + action + '\n---\n' + updated;
                                }
                              } else if (action === 'high' || action === 'low') {
                                if (updated.startsWith('---\n')) {
                                  updated = updated.replace(/priority:\s*.+/i, 'priority: ' + action);
                                } else {
                                  updated = '---\npriority: ' + action + '\n---\n' + updated;
                                }
                              }
                              await vp.writeFile(fullPath, updated);
                            } catch {}
                          }
                          setBatchBusy(false);
                          setBatchMode(false);
                          setBatchSelected(new Set());
                          if ((window as any).__refreshIndex) (window as any).__refreshIndex();
                        }}>Apply</button>
                    </>}
                  </>}
                </div>
                <div className="game-entry-group">
                  {filtered.map((entry: GameWorkspaceEntry) => (
                    <div key={entry.relativePath} className="game-entry-card" style={batchMode ? { display: 'flex', alignItems: 'flex-start', gap: 8 } : {}}
                      onClick={() => { if (!batchMode) onSearchResultClick(entry.relativePath); }}>
                      {batchMode && <input type="checkbox" checked={batchSelected.has(entry.relativePath)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => {
                          setBatchSelected((prev: Set<string>) => {
                            const next = new Set(prev);
                            if (next.has(entry.relativePath)) next.delete(entry.relativePath); else next.add(entry.relativePath);
                            return next;
                          });
                        }}
                        style={{ marginTop: 4, accentColor: 'var(--accent)' }} />}
                      <div style={{ flex: 1 }}>
                        <div className="game-entry-card-header">
                          <span className={"entry-type-badge badge-" + entry.type}>{entry.type}</span>
                          <span className="entry-title">{entry.title}</span>
                        </div>
                        <div className="game-entry-meta">
                          {entry.status && <span className={"game-entry-status status-" + entry.status}>{entry.status}</span>}
                          {entry.priority && <span className={"game-entry-priority priority-" + entry.priority}>{entry.priority}</span>}
                          {entry.owner && <span className="game-entry-owner">{entry.owner}</span>}
                          {entry.updatedAt && <span className="game-entry-updated">{entry.updatedAt}</span>}
                        </div>
                        {entry.summary && <div className="game-entry-summary">{entry.summary}</div>}
                        {entry.tags.length > 0 && (
                          <div className="game-entry-tags">
                            {entry.tags.slice(0, 3).map((tag: string) => (<span key={tag} className="tag-chip">#{tag}</span>))}
                            {entry.tags.length > 3 && <span className="tag-more">+{entry.tags.length - 3}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              /* ── Board View (v0.9.4) ── */
              <>
                <div className="game-board-toolbar">
                  <span>{t.groupBy}:</span>
                  <select value={boardGroupBy} onChange={(e) => setBoardGroupBy(e.target.value as 'status' | 'type')}>
                    <option value="status">{t.groupByStatus}</option>
                    <option value="type">{t.groupByType}</option>
                  </select>
                </div>
                <div className="game-board">
                  {(boardGroupBy === 'status'
                    ? groupGameWorkspaceEntriesByStatus(filtered)
                    : groupGameWorkspaceEntriesByType(filtered)
                  ).map((group: BoardGroup) => (
                    <div key={group.id} className="game-board-column">
                      <div className="game-board-column-header">
                        <span className="col-label">{group.label}</span>
                        <span className="col-count">{group.entries.length}</span>
                      </div>
                      {group.entries.length === 0 ? (
                        <div className="game-board-empty-col">
                          <span className="game-board-empty-icon">-</span>
                          <span>{t.noCards}</span>
                        </div>
                      ) : (
                        group.entries.map((entry: GameWorkspaceEntry) => (
                          <div key={entry.relativePath} className="game-board-card" onClick={() => onSearchResultClick(entry.relativePath)}>
                            <div className="card-title">{entry.title}</div>
                            <div className="game-board-card-meta">
                              {entry.type && <span className={"badge badge-type badge-" + entry.type}>{entry.type}</span>}
                              {entry.status && <span className={"badge badge-status status-" + entry.status}>{entry.status}</span>}
                              {entry.priority && <span className={"badge badge-priority priority-" + entry.priority}>{entry.priority}</span>}
                            </div>
                            {entry.summary && <div className="card-summary">{entry.summary.slice(0, 80)}</div>}
                            <div className="card-meta-bottom">
                              {entry.owner && <span>{entry.owner}</span>}
                              {entry.updatedAt && <span>{entry.updatedAt}</span>}
                            </div>
                            {entry.tags.length > 0 && (
                              <div className="game-entry-tags" style={{ marginTop: '3px' }}>
                                {entry.tags.slice(0, 3).map((tag: string) => (
                                  <span key={tag} className="tag-chip">#{tag}</span>
                                ))}
                                {entry.tags.length > 3 && <span className="tag-more">+{entry.tags.length - 3}</span>}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ── Report Actions (v0.9.5) ── */}
            {gameWorkspaceEntries.length > 0 && (
              <div className="game-action-area">
                <div className="game-action-area-label">{t.reportActions || 'Report'}</div>
                <div className="game-action-area-buttons">
                  <button
                    className={"game-action-btn" + (reportCopied ? " game-action-success" : "")}
                    onClick={() => {
                      const now = new Date();
                      const dashboard = buildGameWorkspaceDashboard(gameWorkspaceEntries, gameWorkspaceSummary);
                      const md = buildGameWorkspaceReportMarkdown({
                        summary: gameWorkspaceSummary,
                        dashboard,
                        entries: gameWorkspaceEntries,
                        generatedAt: now.toISOString(),
                      });
                      navigator.clipboard.writeText(md).then(() => {
                        setReportCopied(true);
                        setTimeout(() => setReportCopied(false), 2000);
                      }).catch(() => {});
                    }}
                  >
                    {reportCopied ? t.reportCopied : t.copyReport}
                  </button>
                  <button
                    className="game-action-btn"
                    disabled={reportBusy}
                    onClick={onExportGameWorkspaceReport}
                  >
                    {reportBusy ? t.creatingGameDoc || '...' : t.exportReport}
                  </button>
                </div>
              </div>
            )}

            {/* ── Create buttons (always visible at bottom) ── */}
            <div className="game-action-group">
              <div className="game-action-area-label">{t.createGameDocs || 'Create'}</div>
              <div className="game-create-groups">
                <div className="game-create-group">
                  <span className="game-create-group-label">{t.designDocs || 'Design'}</span>
                  <div className="game-create-group-btns">
                    <button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('gdd')}>{t.createGDD}</button>
                    <button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('coreLoop')}>{t.createCoreLoop}</button>
                    <button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('worldbuilding')}>{t.createWorldbuilding}</button>
                    <button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('character')}>{t.createCharacter}</button>
                    <button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('item')}>{t.createItem}</button>
                    <button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('quest')}>{t.createQuest}</button>
                  </div>
                </div>
                <div className="game-create-group">
                  <span className="game-create-group-label">{t.narrativeDocs}</span>
                  <div className="game-create-group-btns">
                    <button className="game-create-btn game-create-primary" disabled={gameDocCreating} onClick={onCreateNarrativeProductionKit}>{t.createNarrativeKit}</button>
                    <button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('story')}>{t.createStory}</button>
                    <button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('dialogue')}>{t.createDialogue}</button>
                    <button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('performance')}>{t.createPerformance}</button>
                    <button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('taskTable')}>{t.createTaskTable}</button>
                  </div>
                </div>
                <div className="game-create-group">
                  <span className="game-create-group-label">{t.devDocs || 'Development'}</span>
                  <div className="game-create-group-btns">
                    <button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('unityTask')}>{t.createUnityTask}</button>
                    <button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('devlog')}>{t.createDevlog}</button>
                  </div>
                </div>
              </div>
              {gameDocCreating && <div className="game-creating-hint">{t.creatingGameDoc}</div>}
            </div>
          </div>
          );
        })()}
      </div>
    </div>
  );
};

export default RightPanel;
