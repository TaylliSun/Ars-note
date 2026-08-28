import React, { useState, useMemo, useEffect } from 'react';
import type { SearchResult, OutgoingLinkInfo, GroupedBacklink, TagNoteInfo, GraphData, GraphSummary, VaultManifest, BackupSummary, BackupListItem, BackupFileListResult, BackupFileRestoreSummary, BackupPruneSummary, RestoreSummary, BackupVerifyResult, VaultStorageReport, VaultStorageCleanupSummary, SyncConfig, SyncProvider, SyncStatus, RemoteBackupItem, CloudUploadSummary, CloudDownloadSummary, DownloadedBackupItem, ProviderValidationResult, S3RuntimeCredentials, S3CredentialStatus, S3ConnectionTestResult, SyncCompareResult, SyncPreviewResult, SyncConflictFile, SyncConflictPreview, LiveHistoryItem, LiveHistoryPreview, LiveHistoryBatchRestorePlan, ProtectedLocalRecoveryFile, SyncRecoveryOverview, SyncAccidentRecoveryPlan, SyncRecoveryAdvisorPlan, SyncRecoveryAdvisorItem, ServerDataSnapshotItem, ServerSnapshotFileCandidate, LiveSyncSelfTestResult, AISafetySelfTestResult, AIOperationAuditEvent, AIOperationRollbackPreview, SelfHostedRuntimeCredentials, SelfHostedCredentialStatus, GameWorkspaceSummary, GameWorkspaceEntry, GameDocType, AIProviderConfig, AIChatMessage, AIContextMode, AIControlMode, AIConnectionTestResult, AIContextUsage, VaultIndex } from '../types';
import { formatBytes } from '../utils/vaultManifest';
import { buildS3SafetyReport } from '../utils/s3SafetyReport';
import { renderMarkdown } from '../utils/markdownRenderer';
import { useI18n } from '../i18n';
import { splitSearchHighlight } from '../utils/searchHighlight';
import { isLiveSyncRendererHintForVault } from '../utils/liveSyncVaultScope';
import { getCategoryIcon, getRightPanelTabIcon, getGameDocIcon } from './icons/iconMap';
import OutlineView from './OutlineView';
import { APP_VERSION_LABEL } from '../appVersion';

const GraphView = React.lazy(() => import('./GraphView'));
const TemplateBrowserPanel = React.lazy(() => import('./TemplateBrowserPanel'));
const RightPanelGameView = React.lazy(() => import('./RightPanelGameView'));
const RightPanelAIView = React.lazy(() => import('./RightPanelAIView'));
const RightPanelBackupView = React.lazy(() => import('./RightPanelBackupView'));
const RightPanelSettingsView = React.lazy(() => import('./RightPanelSettingsView'));

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

export interface RightPanelProps {
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
  vaultId?: string;
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
  onSearch, onSearchResultClick, onCreateFromTemplate, currentFilePath, vaultPath, vaultId = '',
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
  const [settingsShowAdvanced, setSettingsShowAdvanced] = useState<boolean>(() => {
    try { return localStorage.getItem('ars-note.settings.showAdvanced') === 'true'; } catch { return false; }
  });
  const [syncRecoveryToolsOpen, setSyncRecoveryToolsOpen] = useState(false);
  const [versionHistoryAdvancedOpen, setVersionHistoryAdvancedOpen] = useState(false);
  const activeSettingsSection = settingsSection || 'home';

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

  /* Never carry connection fields from one project into another project. */
  React.useEffect(() => {
    setSyncEnabled(false);
    setSyncProvider('local');
    setSyncEndpoint('');
    setSyncBucket('');
    setSyncRemoteVaultId('');
    setLiveSyncUrl('');
    setLiveSyncApiKey('');
    setLiveSyncConnected(false);
    setLiveSyncClientId('');
    setLiveSyncError('');
    setLiveSyncActivity([]);
    setLiveSyncHealth(null);
  }, [vaultPath]);

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
    let disposed = false;
    const expectedVaultId = syncConfig?.remoteVaultId || vaultId;

    const applySavedLiveConfig = (cfg: any) => {
      if (!cfg || disposed) return;
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
      if (isLiveSyncRendererHintForVault(rendererConfig, vaultPath, expectedVaultId)) {
        applySavedLiveConfig(rendererConfig);
      }
    } catch {}

    if (vaultPath && api.liveSyncLoadConfig) {
      api.liveSyncLoadConfig(vaultPath).then((cfg: any) => {
        if (disposed) return;
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
      if (!isLiveSyncRendererHintForVault({
        vaultPath: notice.vaultPath,
        vaultId: notice.config?.vaultId,
      }, vaultPath, expectedVaultId)) return;
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
      if (expectedVaultId && data?.vaultId && data.vaultId !== expectedVaultId) return;
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
          title: '同步服务器需要更新',
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
      if (disposed || (expectedVaultId && status?.vaultId && status.vaultId !== expectedVaultId)) return;
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
      disposed = true;
      unsubStatus?.();
      unsubActivity?.();
      unsubConflict?.();
      unsubVersionCheck?.();
      window.removeEventListener('ars-note:live-sync-auto-connect-protected', onAutoConnectProtected as EventListener);
    };
  }, [addLiveSyncTimeline, vaultId, vaultPath, syncConfig?.endpoint, syncConfig?.remoteVaultId]);

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



  const previewHtml = useMemo(() => activeTab === 'preview' ? renderMarkdown(previewContent, {
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
  }) : '', [activeTab, previewContent, currentFilePath, vaultPath, t.imageNotFound]);

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
          <React.Suspense fallback={<div className="lazy-panel-fallback" role="status">正在加载备份工作区...</div>}>
            <RightPanelBackupView
              {...{
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
              }}
              onStartWizard={startWizard}
            />
          </React.Suspense>
        )}
        {activeTab === 'templates' && (
          <React.Suspense fallback={<div className="lazy-panel-fallback" role="status">正在加载模板库...</div>}>
            <TemplateBrowserPanel onCreateFromTemplate={onCreateFromTemplate} />
          </React.Suspense>
        )}

        {activeTab === 'settings' && (
          <React.Suspense fallback={<div className="lazy-panel-fallback" role="status">正在加载设置与同步...</div>}>
            <RightPanelSettingsView
              scope={{
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
              }}
            />
          </React.Suspense>
        )}
        {activeTab === 'ai' && (
          <React.Suspense fallback={<div className="lazy-panel-fallback" role="status">正在加载 AI 工作区...</div>}>
            <RightPanelAIView
              vaultPath={vaultPath}
              currentFilePath={currentFilePath}
              previewContent={previewContent}
              aiConfig={aiConfig}
              aiSafetySelfTest={aiSafetySelfTest}
              aiSafetyTesting={aiSafetyTesting}
              aiOperationAudit={aiOperationAudit}
              aiAuditLoading={aiAuditLoading}
              aiRollbackPreview={aiRollbackPreview}
              aiRollbackBusy={aiRollbackBusy}
              aiAuditMessage={aiAuditMessage}
              aiMemoryOverview={aiMemoryOverview}
              aiMemoryLoading={aiMemoryLoading}
              aiSyncLocalFiles={aiSyncLocalFiles}
              aiChatMessages={aiChatMessages}
              aiInput={aiInput}
              aiContextMode={aiContextMode}
              aiControlMode={aiControlMode}
              aiContextUsage={aiContextUsage}
              aiSending={aiSending}
              aiCanCancel={aiCanCancel}
              aiCanRetry={aiCanRetry}
              aiCopiedResponse={aiCopiedResponse}
              runAiSafetySelfTest={runAiSafetySelfTest}
              refreshAiOperationAudit={refreshAiOperationAudit}
              previewAiOperationRollback={previewAiOperationRollback}
              runAiOperationRollback={runAiOperationRollback}
              refreshAiMemoryOverview={refreshAiMemoryOverview}
              onAIInputChange={onAIInputChange}
              onAIContextModeChange={onAIContextModeChange}
              onAIControlModeChange={onAIControlModeChange}
              onAISendChat={onAISendChat}
              onAICancelChat={onAICancelChat}
              onAIRetryLast={onAIRetryLast}
              onAICopyResponse={onAICopyResponse}
              onAIImportTasksToSchedule={onAIImportTasksToSchedule}
              showConfirm={showConfirm}
              notify={notify}
            />
          </React.Suspense>
        )}

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

        {activeTab === 'game' && (
          <React.Suspense fallback={<div className="lazy-panel-fallback" role="status">正在加载文档雷达...</div>}>
            <RightPanelGameView
              vaultPath={vaultPath}
              vaultIndex={vaultIndex}
              gameWorkspaceSummary={gameWorkspaceSummary}
              gameWorkspaceEntries={gameWorkspaceEntries}
              gameDocCreating={gameDocCreating}
              reportBusy={reportBusy}
              onOpenFile={onSearchResultClick}
              onOpenTeamWorkspace={onOpenTeamWorkspace}
              onCreateGameDoc={onCreateGameDoc}
              onCreateNarrativeProductionKit={onCreateNarrativeProductionKit}
              onExportGameWorkspaceReport={onExportGameWorkspaceReport}
              onRefreshVault={onRefreshVault}
            />
          </React.Suspense>
        )}
      </div>
    </div>
  );
};

export default React.memo(RightPanel);
