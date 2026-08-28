import React, { useEffect, useRef, useState } from 'react';
import type {
  GameDocType,
  GameWorkspaceEntry,
  GameWorkspaceFilters,
  GameWorkspaceSummary,
  VaultIndex,
} from '../types';
import type { BoardGroup } from '../utils/gameWorkspaceScanner';
import {
  buildGameWorkspaceDashboard,
  filterGameWorkspaceEntries,
  getGameWorkspaceOwners,
  groupGameWorkspaceEntriesByStatus,
  groupGameWorkspaceEntriesByType,
} from '../utils/gameWorkspaceScanner';
import { buildGameWorkspaceReportMarkdown } from '../utils/gameWorkspaceReport';
import { useI18n } from '../i18n';

const ProductionCommandCenter = React.lazy(() => import('./ProductionCommandCenter'));

const EMPTY_FILTERS: GameWorkspaceFilters = {
  type: 'all',
  status: 'all',
  priority: 'all',
  owner: 'all',
  query: '',
};

interface RightPanelGameViewProps {
  vaultPath: string;
  vaultIndex: VaultIndex;
  gameWorkspaceSummary: GameWorkspaceSummary;
  gameWorkspaceEntries: GameWorkspaceEntry[];
  gameDocCreating: boolean;
  reportBusy: boolean;
  onOpenFile: (relativePath: string) => void;
  onOpenTeamWorkspace?: () => void | Promise<void>;
  onCreateGameDoc: (type: GameDocType) => Promise<void>;
  onCreateNarrativeProductionKit: () => Promise<void>;
  onExportGameWorkspaceReport: () => Promise<void>;
  onRefreshVault?: () => Promise<void>;
}

const RightPanelGameView: React.FC<RightPanelGameViewProps> = ({
  vaultPath,
  vaultIndex,
  gameWorkspaceSummary,
  gameWorkspaceEntries,
  gameDocCreating,
  reportBusy,
  onOpenFile,
  onOpenTeamWorkspace,
  onCreateGameDoc,
  onCreateNarrativeProductionKit,
  onExportGameWorkspaceReport,
  onRefreshVault,
}) => {
  const { t } = useI18n();
  const [filters, setFilters] = useState<GameWorkspaceFilters>(EMPTY_FILTERS);
  const [viewMode, setViewMode] = useState<'list' | 'board'>(() => {
    try { return localStorage.getItem('ars-note.game.viewMode') === 'board' ? 'board' : 'list'; } catch { return 'list'; }
  });
  const [boardGroupBy, setBoardGroupBy] = useState<'status' | 'type'>('status');
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [batchAction, setBatchAction] = useState<'done' | 'draft' | 'high' | 'low'>('done');
  const [batchBusy, setBatchBusy] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  const reportCopiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    try { localStorage.setItem('ars-note.game.viewMode', viewMode); } catch { /* ignore */ }
  }, [viewMode]);

  useEffect(() => () => {
    if (reportCopiedTimerRef.current !== null) window.clearTimeout(reportCopiedTimerRef.current);
  }, []);

  const owners = getGameWorkspaceOwners(gameWorkspaceEntries);
  const dashboard = buildGameWorkspaceDashboard(gameWorkspaceEntries, gameWorkspaceSummary);
  const filteredEntries = filterGameWorkspaceEntries(gameWorkspaceEntries, filters);
  const hasActiveFilters = filters.type !== 'all'
    || filters.status !== 'all'
    || filters.priority !== 'all'
    || filters.owner !== 'all'
    || filters.query !== '';

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

  const renderEntry = (entry: GameWorkspaceEntry) => (
    <div key={entry.relativePath} className="game-entry-card" onClick={() => onOpenFile(entry.relativePath)}>
      <div className="game-entry-card-header">
        <span className={`entry-type-badge badge-${entry.type}`}>{entry.type}</span>
        <span className="entry-title">{entry.title}</span>
      </div>
      <div className="game-entry-meta">
        {entry.status && <span className={`game-entry-status status-${entry.status}`}>{entry.status}</span>}
        {entry.priority && <span className={`game-entry-priority priority-${entry.priority}`}>{entry.priority}</span>}
        {entry.owner && <span className="game-entry-owner">{entry.owner}</span>}
        {entry.updatedAt && <span className="game-entry-updated">{entry.updatedAt}</span>}
      </div>
      {entry.summary && <div className="game-entry-summary">{entry.summary}</div>}
      {entry.tags.length > 0 && (
        <div className="game-entry-tags">
          {entry.tags.slice(0, 3).map((tag) => <span key={tag} className="tag-chip">#{tag}</span>)}
          {entry.tags.length > 3 && <span className="tag-more">+{entry.tags.length - 3}</span>}
        </div>
      )}
    </div>
  );

  const renderQuickSection = (title: string, entries: GameWorkspaceEntry[]) => {
    if (entries.length === 0) return null;
    return (
      <div className="game-quick-section">
        <h4>{title}</h4>
        <div className="game-quick-list">{entries.map(renderEntry)}</div>
      </div>
    );
  };

  const applyBatchAction = async () => {
    if (!vaultPath || batchSelected.size === 0) return;
    setBatchBusy(true);
    try {
      for (const relativePath of batchSelected) {
        try {
          const fullPath = await window.arsnote.joinPath(vaultPath, relativePath);
          const content = await window.arsnote.readFile(fullPath);
          let updated = content;
          if (batchAction === 'done' || batchAction === 'draft') {
            updated = content.startsWith('---\n')
              ? content.replace(/status:\s*.+/i, `status: ${batchAction}`)
              : `---\nstatus: ${batchAction}\n---\n${content}`;
          } else {
            updated = content.startsWith('---\n')
              ? content.replace(/priority:\s*.+/i, `priority: ${batchAction}`)
              : `---\npriority: ${batchAction}\n---\n${content}`;
          }
          await window.arsnote.writeFile(fullPath, updated);
        } catch {
          // Continue with the remaining selected documents.
        }
      }
      await onRefreshVault?.();
      setBatchMode(false);
      setBatchSelected(new Set());
    } finally {
      setBatchBusy(false);
    }
  };

  const copyReport = () => {
    const markdown = buildGameWorkspaceReportMarkdown({
      summary: gameWorkspaceSummary,
      dashboard,
      entries: gameWorkspaceEntries,
      generatedAt: new Date().toISOString(),
    });
    navigator.clipboard.writeText(markdown).then(() => {
      setReportCopied(true);
      if (reportCopiedTimerRef.current !== null) window.clearTimeout(reportCopiedTimerRef.current);
      reportCopiedTimerRef.current = window.setTimeout(() => {
        setReportCopied(false);
        reportCopiedTimerRef.current = null;
      }, 2000);
    }).catch(() => {});
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

      <div className="game-view-toggle">
        <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}>{t.listView}</button>
        <button className={viewMode === 'board' ? 'active' : ''} onClick={() => setViewMode('board')}>{t.boardView}</button>
      </div>

      <div className="game-dashboard">
        <div className="game-dashboard-grid">
          <div className="game-dashboard-card card-total"><span className="stat-value">{gameWorkspaceSummary.totalGameDocs}</span><span className="stat-label">{t.totalGameDocs}</span></div>
          <div className="game-dashboard-card card-draft"><span className="stat-value">{gameWorkspaceSummary.draftCount}</span><span className="stat-label">{t.draft}</span></div>
          <div className="game-dashboard-card card-wip"><span className="stat-value">{Math.max(0, gameWorkspaceSummary.totalGameDocs - gameWorkspaceSummary.draftCount - gameWorkspaceSummary.doneCount)}</span><span className="stat-label">{t.inProgressShort}</span></div>
          <div className="game-dashboard-card card-done"><span className="stat-value">{gameWorkspaceSummary.doneCount}</span><span className="stat-label">{t.done}</span></div>
          <div className="game-dashboard-card card-high"><span className="stat-value">{gameWorkspaceSummary.highPriorityCount}</span><span className="stat-label">{t.highPriority}</span></div>
          <div className="game-dashboard-card card-missing"><span className="stat-value">{dashboard.missingCoreDocs.length}</span><span className="stat-label">{t.missingCoreDocs}</span></div>
        </div>
      </div>

      {dashboard.missingCoreDocs.length > 0 && (
        <div className="game-missing-core">
          <div className="game-missing-core-header"><span className="game-missing-core-icon">!</span><span>{t.missingCoreDocs}</span></div>
          <div className="game-missing-core-items">
            {dashboard.missingCoreDocs.map((docType) => (
              <div key={docType} className="game-missing-core-item">
                <span className={`game-missing-type-badge badge-${docType}`}>{docType}</span>
                <button className="game-create-btn game-create-primary" disabled={gameDocCreating} onClick={() => onCreateGameDoc(docType)} title={docTypeLabels[docType]}>+ {t.create}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <React.Suspense fallback={<div className="lazy-panel-fallback" role="status">正在加载制作指挥中心...</div>}>
        <ProductionCommandCenter
          vaultPath={vaultPath}
          vaultIndex={vaultIndex}
          onOpenFile={onOpenFile}
          onRefreshVault={onRefreshVault}
          onOpenTeamWorkspace={onOpenTeamWorkspace}
        />
      </React.Suspense>

      {!hasActiveFilters && (
        <>
          {renderQuickSection(t.highPriorityDocs, dashboard.highPriorityEntries)}
          {renderQuickSection(t.draftDocs, dashboard.draftEntries)}
          {renderQuickSection(t.recentlyUpdated, dashboard.recentlyUpdatedEntries)}
          {renderQuickSection(t.missingMetadata, dashboard.missingMetadataEntries)}
        </>
      )}

      {gameWorkspaceEntries.length > 0 && (
        <div className={`game-filter-bar${hasActiveFilters ? ' game-filter-active' : ''}`}>
          <div className="game-filter-row">
            <div className={`game-filter-control${filters.type !== 'all' ? ' filter-on' : ''}`}>
              <select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value as GameDocType | 'all' })}>
                <option value="all">{t.allTypes}</option><option value="gdd">{t.gddDashboard}</option><option value="worldbuilding">{t.worldbuilding}</option><option value="story">{t.storyDocs}</option><option value="dialogue">{t.dialogueDocs}</option><option value="performance">{t.performanceDocs}</option><option value="character">{t.characters}</option><option value="item">{t.items}</option><option value="quest">{t.quests}</option><option value="taskTable">{t.taskTables}</option><option value="unityTask">{t.unityTasks}</option><option value="devlog">{t.devlogTimeline}</option>
              </select>
            </div>
            <div className={`game-filter-control${filters.status !== 'all' ? ' filter-on' : ''}`}>
              <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
                <option value="all">{t.allStatus}</option><option value="draft">{t.draft}</option><option value="wip">{t.inProgressShort}</option><option value="review">Review</option><option value="done">{t.done}</option>
              </select>
            </div>
            <div className={`game-filter-control${filters.priority !== 'all' ? ' filter-on' : ''}`}>
              <select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}>
                <option value="all">{t.allPriorities}</option><option value="high">{t.highPriority}</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
            </div>
            {owners.length > 0 && (
              <div className={`game-filter-control${filters.owner !== 'all' ? ' filter-on' : ''}`}>
                <select value={filters.owner} onChange={(event) => setFilters({ ...filters, owner: event.target.value })}>
                  <option value="all">{t.allOwners}</option>{owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
                </select>
              </div>
            )}
            {hasActiveFilters && <button className="game-filter-clear" onClick={() => setFilters(EMPTY_FILTERS)}>{t.clearFilters}</button>}
          </div>
          <div className="game-filter-row">
            <div className={`game-filter-control${filters.query ? ' filter-on' : ''}`} style={{ flex: 1 }}>
              <input type="text" placeholder={t.searchGameDocs} value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} />
            </div>
          </div>
        </div>
      )}

      {gameWorkspaceEntries.length === 0 ? (
        <div className="game-workspace-empty game-empty-onboarding">
          <div className="empty-icon">◎</div><div className="empty-title">{t.noGameDocsFound}</div>
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
      ) : filteredEntries.length === 0 ? (
        <div className="game-empty-filter"><p>{t.noMatchingDocs}</p><button className="game-filter-clear" onClick={() => setFilters(EMPTY_FILTERS)} style={{ marginTop: 8 }}>{t.clearFilters}</button></div>
      ) : viewMode === 'list' ? (
        <>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <button className="btn-icon" style={{ fontSize: 11, padding: '3px 10px', background: batchMode ? 'var(--accent)' : 'var(--bg-card)', color: batchMode ? '#fff' : 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }} onClick={() => { setBatchMode(!batchMode); setBatchSelected(new Set()); }}>{batchMode ? 'Cancel' : 'Batch'}</button>
            {batchMode && (
              <>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{batchSelected.size} selected</span>
                <button style={{ fontSize: 11, padding: '3px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-main)', cursor: 'pointer' }} onClick={() => setBatchSelected(new Set(filteredEntries.map((entry) => entry.relativePath)))}>All</button>
                <button style={{ fontSize: 11, padding: '3px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-main)', cursor: 'pointer' }} onClick={() => setBatchSelected(new Set())}>None</button>
                {batchSelected.size > 0 && (
                  <>
                    <select value={batchAction} onChange={(event) => setBatchAction(event.target.value as typeof batchAction)} style={{ fontSize: 11, padding: '2px 6px', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 4 }}>
                      <option value="done">Mark Done</option><option value="draft">Mark Draft</option><option value="high">Set High Priority</option><option value="low">Set Low Priority</option>
                    </select>
                    <button disabled={batchBusy} style={{ fontSize: 11, padding: '3px 10px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: batchBusy ? 'wait' : 'pointer' }} onClick={() => { void applyBatchAction(); }}>Apply</button>
                  </>
                )}
              </>
            )}
          </div>
          <div className="game-entry-group">
            {filteredEntries.map((entry) => (
              <div key={entry.relativePath} className="game-entry-card" style={batchMode ? { display: 'flex', alignItems: 'flex-start', gap: 8 } : {}} onClick={() => { if (!batchMode) onOpenFile(entry.relativePath); }}>
                {batchMode && <input type="checkbox" checked={batchSelected.has(entry.relativePath)} onClick={(event) => event.stopPropagation()} onChange={() => setBatchSelected((previous) => { const next = new Set(previous); if (next.has(entry.relativePath)) next.delete(entry.relativePath); else next.add(entry.relativePath); return next; })} style={{ marginTop: 4, accentColor: 'var(--accent)' }} />}
                <div style={{ flex: 1 }}>
                  <div className="game-entry-card-header"><span className={`entry-type-badge badge-${entry.type}`}>{entry.type}</span><span className="entry-title">{entry.title}</span></div>
                  <div className="game-entry-meta">{entry.status && <span className={`game-entry-status status-${entry.status}`}>{entry.status}</span>}{entry.priority && <span className={`game-entry-priority priority-${entry.priority}`}>{entry.priority}</span>}{entry.owner && <span className="game-entry-owner">{entry.owner}</span>}{entry.updatedAt && <span className="game-entry-updated">{entry.updatedAt}</span>}</div>
                  {entry.summary && <div className="game-entry-summary">{entry.summary}</div>}
                  {entry.tags.length > 0 && <div className="game-entry-tags">{entry.tags.slice(0, 3).map((tag) => <span key={tag} className="tag-chip">#{tag}</span>)}{entry.tags.length > 3 && <span className="tag-more">+{entry.tags.length - 3}</span>}</div>}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="game-board-toolbar"><span>{t.groupBy}:</span><select value={boardGroupBy} onChange={(event) => setBoardGroupBy(event.target.value as 'status' | 'type')}><option value="status">{t.groupByStatus}</option><option value="type">{t.groupByType}</option></select></div>
          <div className="game-board">
            {(boardGroupBy === 'status' ? groupGameWorkspaceEntriesByStatus(filteredEntries) : groupGameWorkspaceEntriesByType(filteredEntries)).map((group: BoardGroup) => (
              <div key={group.id} className="game-board-column">
                <div className="game-board-column-header"><span className="col-label">{group.label}</span><span className="col-count">{group.entries.length}</span></div>
                {group.entries.length === 0 ? <div className="game-board-empty-col"><span className="game-board-empty-icon">-</span><span>{t.noCards}</span></div> : group.entries.map((entry) => (
                  <div key={entry.relativePath} className="game-board-card" onClick={() => onOpenFile(entry.relativePath)}>
                    <div className="card-title">{entry.title}</div>
                    <div className="game-board-card-meta">{entry.type && <span className={`badge badge-type badge-${entry.type}`}>{entry.type}</span>}{entry.status && <span className={`badge badge-status status-${entry.status}`}>{entry.status}</span>}{entry.priority && <span className={`badge badge-priority priority-${entry.priority}`}>{entry.priority}</span>}</div>
                    {entry.summary && <div className="card-summary">{entry.summary.slice(0, 80)}</div>}
                    <div className="card-meta-bottom">{entry.owner && <span>{entry.owner}</span>}{entry.updatedAt && <span>{entry.updatedAt}</span>}</div>
                    {entry.tags.length > 0 && <div className="game-entry-tags" style={{ marginTop: 3 }}>{entry.tags.slice(0, 3).map((tag) => <span key={tag} className="tag-chip">#{tag}</span>)}{entry.tags.length > 3 && <span className="tag-more">+{entry.tags.length - 3}</span>}</div>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {gameWorkspaceEntries.length > 0 && (
        <div className="game-action-area">
          <div className="game-action-area-label">{t.reportActions || 'Report'}</div>
          <div className="game-action-area-buttons">
            <button className={`game-action-btn${reportCopied ? ' game-action-success' : ''}`} onClick={copyReport}>{reportCopied ? t.reportCopied : t.copyReport}</button>
            <button className="game-action-btn" disabled={reportBusy} onClick={onExportGameWorkspaceReport}>{reportBusy ? t.creatingGameDoc || '...' : t.exportReport}</button>
          </div>
        </div>
      )}

      <div className="game-action-group">
        <div className="game-action-area-label">{t.createGameDocs || 'Create'}</div>
        <div className="game-create-groups">
          <div className="game-create-group"><span className="game-create-group-label">{t.designDocs || 'Design'}</span><div className="game-create-group-btns"><button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('gdd')}>{t.createGDD}</button><button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('coreLoop')}>{t.createCoreLoop}</button><button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('worldbuilding')}>{t.createWorldbuilding}</button><button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('character')}>{t.createCharacter}</button><button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('item')}>{t.createItem}</button><button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('quest')}>{t.createQuest}</button></div></div>
          <div className="game-create-group"><span className="game-create-group-label">{t.narrativeDocs}</span><div className="game-create-group-btns"><button className="game-create-btn game-create-primary" disabled={gameDocCreating} onClick={onCreateNarrativeProductionKit}>{t.createNarrativeKit}</button><button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('story')}>{t.createStory}</button><button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('dialogue')}>{t.createDialogue}</button><button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('performance')}>{t.createPerformance}</button><button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('taskTable')}>{t.createTaskTable}</button></div></div>
          <div className="game-create-group"><span className="game-create-group-label">{t.devDocs || 'Development'}</span><div className="game-create-group-btns"><button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('unityTask')}>{t.createUnityTask}</button><button className="game-create-btn" disabled={gameDocCreating} onClick={() => onCreateGameDoc('devlog')}>{t.createDevlog}</button></div></div>
        </div>
        {gameDocCreating && <div className="game-creating-hint">{t.creatingGameDoc}</div>}
      </div>
    </div>
  );
};

export default RightPanelGameView;
