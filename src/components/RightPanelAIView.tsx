import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AIChatMessage,
  AIContextMode,
  AIContextUsage,
  AIControlMode,
  AIOperationAuditEvent,
  AIOperationRollbackPreview,
  AIProviderConfig,
  AISafetySelfTestResult,
} from '../types';
import { useI18n } from '../i18n';
import { QUICK_PROMPTS } from '../utils/aiClient';
import { getAIChatScrollToken } from '../utils/aiChatPresentation';
import AIChatMessageList, { useAIChatAutoScroll } from './AIChatMessageList';
import AIContextMeter from './AIContextMeter';
import AIWritingQualityCard from './AIWritingQualityCard';

interface AiSyncFileBreakdown {
  core: number;
  skills: number;
  crons: number;
  evolutions: number;
}

function getAiSyncFileBreakdown(files: string[]): AiSyncFileBreakdown {
  const normalized = files.map((item) => String(item || '').replace(/\\/g, '/'));
  return {
    core: normalized.filter((item) => item === 'MEMORY.md' || item === 'USER.md' || item === 'SOUL.md').length,
    skills: normalized.filter((item) => item.startsWith('skills/') && item.endsWith('.md')).length,
    crons: normalized.filter((item) => item === 'crons.json').length,
    evolutions: normalized.filter((item) => item.startsWith('evolution/') && item.endsWith('.md')).length,
  };
}

function aiSafetySelfTestStepLabel(name: string): string {
  const labels: Record<string, string> = {
    api: '自检接口',
    vault: 'Vault 检查',
    setup: '创建临时文件',
    readonlyBlocksDelete: '只读模式阻止删除',
    directDeleteApplies: 'AI 直接执行删除',
    directWriteApplies: 'AI 直接执行写入',
    previewRequiresToken: '旧版删除预览兼容',
    syncRecoveryAdvisorRead: '同步恢复建议读取',
    legacyPreviewAvailable: '旧版预览兼容',
    syncRecoveryAdvisorApplyPreview: '同步恢复应用预览',
    applyWithoutLatestTokenBlocked: '旧令牌越权保护',
    applyWithTokenDeletesFile: '旧令牌执行兼容',
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

interface RightPanelAIViewProps {
  vaultPath: string;
  currentFilePath: string;
  previewContent: string;
  aiConfig: AIProviderConfig;
  aiSafetySelfTest: AISafetySelfTestResult | null;
  aiSafetyTesting: boolean;
  aiOperationAudit: AIOperationAuditEvent[];
  aiAuditLoading: boolean;
  aiRollbackPreview: AIOperationRollbackPreview | null;
  aiRollbackBusy: string;
  aiAuditMessage: string;
  aiMemoryOverview: any;
  aiMemoryLoading: boolean;
  aiSyncLocalFiles: string[];
  aiChatMessages: AIChatMessage[];
  aiInput: string;
  aiContextMode: AIContextMode;
  aiControlMode: AIControlMode;
  aiContextUsage: AIContextUsage;
  aiSending: boolean;
  aiCanCancel: boolean;
  aiCanRetry: boolean;
  aiCopiedResponse: boolean;
  runAiSafetySelfTest: () => void | Promise<void>;
  refreshAiOperationAudit: () => void | Promise<void>;
  previewAiOperationRollback: (token?: string) => void | Promise<void>;
  runAiOperationRollback: (token?: string) => void | Promise<void>;
  refreshAiMemoryOverview: () => void | Promise<void>;
  onAIInputChange: (value: string) => void;
  onAIContextModeChange: (mode: AIContextMode) => void;
  onAIControlModeChange: (mode: AIControlMode) => void;
  onAISendChat: (prompt: string) => Promise<void>;
  onAICancelChat: () => Promise<void>;
  onAIRetryLast: () => Promise<void>;
  onAICopyResponse: () => void;
  onAIImportTasksToSchedule?: () => Promise<void>;
  showConfirm: (title: string, message: string, options?: { confirmLabel?: string; confirmTone?: 'primary' | 'danger' }) => Promise<boolean>;
  notify: (message: unknown, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

const RightPanelAIView: React.FC<RightPanelAIViewProps> = ({
  vaultPath,
  currentFilePath,
  previewContent,
  aiConfig,
  aiSafetySelfTest,
  aiSafetyTesting,
  aiOperationAudit,
  aiAuditLoading,
  aiRollbackPreview,
  aiRollbackBusy,
  aiAuditMessage,
  aiMemoryOverview,
  aiMemoryLoading,
  aiSyncLocalFiles,
  aiChatMessages,
  aiInput,
  aiContextMode,
  aiControlMode,
  aiContextUsage,
  aiSending,
  aiCanCancel,
  aiCanRetry,
  aiCopiedResponse,
  runAiSafetySelfTest,
  refreshAiOperationAudit,
  previewAiOperationRollback,
  runAiOperationRollback,
  refreshAiMemoryOverview,
  onAIInputChange,
  onAIContextModeChange,
  onAIControlModeChange,
  onAISendChat,
  onAICancelChat,
  onAIRetryLast,
  onAICopyResponse,
  onAIImportTasksToSchedule,
  showConfirm,
  notify,
}) => {
  const { t, language } = useI18n();
  const [aiQuickPromptsOpen, setAiQuickPromptsOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('ars-note.right.ai.quickPromptsOpen') === 'true'; } catch { return false; }
  });
  const [aiToolsOpen, setAiToolsOpen] = useState(false);
  const [newMemoryEntry, setNewMemoryEntry] = useState('');
  const [aiMemoryActionBusy, setAiMemoryActionBusy] = useState(false);
  const aiMessagesRef = useRef<HTMLDivElement | null>(null);
  const aiChatScrollToken = getAIChatScrollToken(aiChatMessages, aiSending ? 'sending' : 'idle');
  const aiSyncLocalBreakdown = getAiSyncFileBreakdown(aiSyncLocalFiles);
  const appliedAiAuditEvents = useMemo(() => (
    aiOperationAudit.filter((event) => (event.event === 'applied' || event.event === 'direct_applied') && !!event.token)
  ), [aiOperationAudit]);

  useAIChatAutoScroll(aiMessagesRef, true, aiChatScrollToken);

  useEffect(() => {
    try { localStorage.setItem('ars-note.right.ai.quickPromptsOpen', aiQuickPromptsOpen ? 'true' : 'false'); } catch { /* ignore */ }
  }, [aiQuickPromptsOpen]);
          /* ── Context mode descriptions ── */
          const contextDescs: Record<AIContextMode, string> = {
            currentNote: t.aiContextCurrentNoteDesc || 'AI will read your current note as context.',
            gameWorkspace: t.aiContextGameWorkspaceDesc || 'AI will use the team workspace, doc radar, and task summary as context.',
            arshisContext: t.aiContextArshisContextDesc || 'AI will use the Arshis game context export.',
          };
          const controlDescs: Record<AIControlMode, string> = {
            readonly: '只读分析：AI 只能读取和分析，不允许写入、删除或确认执行。',
            member: '成员执行：按你的明确要求直接修改普通文件，并自动保存历史与回滚快照；不能接管团队排期。',
            producer: '制作人接管：除普通文件外，还可直接维护团队时间表与生产文档；所有改动都有审计和回滚记录。',
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
                    验证只读拦截、直接执行、旧令牌兼容、AI 回收副本、live-history 和审计日志。
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

            <AIWritingQualityCard
              active
              currentFilePath={currentFilePath}
              content={previewContent}
              configured={isConfigured}
              sending={aiSending}
              controlMode={aiControlMode}
              onSendPrompt={onAISendChat}
              variant="sidebar"
            />

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
};

export default RightPanelAIView;
