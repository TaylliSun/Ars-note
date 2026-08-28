import React, { useState, useEffect, useCallback } from 'react';
import { BrainIcon, SparkIcon, GlobeIcon, ClockIcon } from './icons/ArsIcons';

type PillarTab = 'memory' | 'skills' | 'soul' | 'crons';

interface Props {
  vaultPath: string;
  api: any;
}

const normalizeTextResult = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
};

const AIFivePillarPanel: React.FC<Props> = ({ vaultPath, api }) => {
  const [tab, setTab] = useState<PillarTab>('memory');
  const [memStatus, setMemStatus] = useState<any>(null);
  const [memContent, setMemContent] = useState('');
  const [soulContent, setSoulContent] = useState('');
  const [userContent, setUserContent] = useState('');
  const [skills, setSkills] = useState<any[]>([]);
  const [crons, setCrons] = useState<any[]>([]);
  const [memInput, setMemInput] = useState('');
  const [cronName, setCronName] = useState('');
  const [cronSchedule, setCronSchedule] = useState('0 9 * * *');
  const [cronPrompt, setCronPrompt] = useState('');
  const [evolving, setEvolving] = useState<string | null>(null);
  const [evolutions, setEvolutions] = useState<any[]>([]);

  const loadAll = useCallback(async () => {
    if (!vaultPath) return;
    try {
      api.aiInitMemory(vaultPath);
      const [status, mem, soul, user, sk, cr, evo] = await Promise.all([
        api.aiGetMemoryStatus(vaultPath),
        api.aiReadMemory(vaultPath),
        api.aiReadSoul(vaultPath),
        api.aiReadUser(vaultPath),
        api.aiListSkills(vaultPath),
        api.aiListCrons(vaultPath),
        api.aiListEvolutions(vaultPath),
      ]);
      setMemStatus(status && typeof status === 'object' ? status : null);
      setMemContent(normalizeTextResult(mem));
      setSoulContent(normalizeTextResult(soul));
      setUserContent(normalizeTextResult(user));
      setSkills(Array.isArray(sk) ? sk : []);
      setCrons(Array.isArray(cr) ? cr : []);
      setEvolutions(Array.isArray(evo) ? evo : []);
    } catch (err) { console.error('5-pillar load failed:', err); }
  }, [vaultPath, api]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleAppendMemory = async () => {
    if (!memInput.trim()) return;
    await api.aiAppendMemory(vaultPath, memInput.trim());
    setMemInput('');
    loadAll();
  };

  const handleConsolidate = async () => {
    await api.aiConsolidateMemory(vaultPath);
    loadAll();
  };

  const handleSaveSoul = async () => {
    await api.aiWriteSoul(vaultPath, soulContent);
    loadAll();
  };

  const handleSaveUser = async () => {
    await api.aiWriteUser(vaultPath, userContent);
    loadAll();
  };

  const handleDeleteSkill = async (id: string) => {
    await api.aiDeleteSkill(vaultPath, id);
    loadAll();
  };

  const handleEvolve = async (id: string) => {
    setEvolving(id);
    try { await api.aiEvolveSkill(vaultPath, id); } catch (err) { console.error('Evolution failed:', err); }
    setEvolving(null);
    loadAll();
  };

  const handleCreateCron = async () => {
    if (!cronName.trim() || !cronPrompt.trim()) return;
    await api.aiCreateCron(vaultPath, { name: cronName.trim(), prompt: cronPrompt.trim(), schedule: cronSchedule });
    setCronName(''); setCronPrompt('');
    loadAll();
    // Restart scheduler
    await api.aiStartCronScheduler(vaultPath);
  };

  const handleToggleCron = async (id: string, enabled: boolean) => {
    await api.aiUpdateCron(vaultPath, id, { enabled: !enabled });
    loadAll();
  };

  const handleDeleteCron = async (id: string) => {
    await api.aiDeleteCron(vaultPath, id);
    loadAll();
  };

  const tabs: { key: PillarTab; label: string; icon: React.ReactNode }[] = [
    { key: 'memory', label: 'Memory', icon: <BrainIcon size={14} /> },
    { key: 'skills', label: 'Skills', icon: <SparkIcon size={14} /> },
    { key: 'soul', label: 'Soul', icon: <GlobeIcon size={14} /> },
    { key: 'crons', label: 'Crons', icon: <ClockIcon size={14} /> },
  ];

  return (
    <div className="ai-pillar-panel">
      <div className="ai-pillar-tabs">
        {tabs.map(t => (
          <button key={t.key} className={'ai-pillar-tab' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'memory' && (
        <div className="ai-pillar-section">
          {memStatus && (
            <div className="ai-pillar-metrics">
              <span>Memory: {memStatus.memorySize}/{memStatus.memoryCap} chars</span>
              <span>History: {memStatus.historyCount}</span>
              {memStatus.needsConsolidation && <span className="ai-pillar-warning">Needs consolidation</span>}
            </div>
          )}
          <div className="ai-pillar-subtabs">
            <span className="ai-pillar-subtitle">MEMORY.md</span>
            <button className="ai-pillar-btn" onClick={handleConsolidate}>Consolidate</button>
          </div>
          <pre className="ai-pillar-pre">{memContent || '(empty)'}</pre>
          <div className="ai-pillar-input-row">
            <input className="ai-pillar-input" value={memInput} onChange={e => setMemInput(e.target.value)} placeholder="Add memory entry..." />
            <button className="ai-pillar-btn" onClick={handleAppendMemory}>Add</button>
          </div>
          <div className="ai-pillar-subtitle">USER.md</div>
          <textarea className="ai-pillar-textarea" value={userContent} onChange={e => setUserContent(e.target.value)} />
          <button className="ai-pillar-btn" onClick={handleSaveUser}>Save User Profile</button>
        </div>
      )}

      {tab === 'skills' && (
        <div className="ai-pillar-section">
          <div className="ai-pillar-metrics">
            <span>Skills: {skills.length}</span>
            <span>Evolutions: {evolutions.length}</span>
          </div>
          {skills.length === 0 ? (
            <div className="ai-pillar-empty">No skills yet. Ars-note promotes a reusable Skill after the same workflow succeeds more than once.</div>
          ) : skills.map(sk => {
            const evo = evolutions.find((e: any) => e.skillId === sk.id);
            return (
              <div key={sk.id} className="ai-pillar-card">
                <div className="ai-pillar-card-header">
                  <span className="ai-pillar-card-name">{sk.name}</span>
                  <span className="ai-pillar-card-meta">Used: {sk.useCount} | Rate: {sk.successRate}%</span>
                </div>
                <div className="ai-pillar-card-desc">{sk.description}</div>
                {evo && <div className="ai-pillar-card-meta">Gen: {evo.generation} | Best score: {evo.variants?.find((v: any) => v.id === evo.currentBestVariantId)?.score || '-'}</div>}
                <div className="ai-pillar-card-actions">
                  <button className="ai-pillar-btn" disabled={evolving === sk.id} onClick={() => handleEvolve(sk.id)}>
                    {evolving === sk.id ? 'Evolving...' : 'Evolve (GEPA)'}
                  </button>
                  <button className="ai-pillar-btn ai-pillar-btn-danger" onClick={() => handleDeleteSkill(sk.id)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'soul' && (
        <div className="ai-pillar-section">
          <div className="ai-pillar-subtitle">SOUL.md - AI Identity & Behavior</div>
          <textarea className="ai-pillar-textarea ai-pillar-textarea-tall" value={soulContent} onChange={e => setSoulContent(e.target.value)} />
          <button className="ai-pillar-btn" onClick={handleSaveSoul}>Save Soul</button>
        </div>
      )}

      {tab === 'crons' && (
        <div className="ai-pillar-section">
          <div className="ai-pillar-metrics"><span>Active: {crons.filter((c: any) => c.enabled).length}/{crons.length}</span></div>
          <div className="ai-pillar-card">
            <div className="ai-pillar-subtitle">New Cron Job</div>
            <input className="ai-pillar-input" value={cronName} onChange={e => setCronName(e.target.value)} placeholder="Name (e.g. Daily Summary)" />
            <input className="ai-pillar-input" value={cronSchedule} onChange={e => setCronSchedule(e.target.value)} placeholder="Schedule (e.g. 0 9 * * *)" />
            <textarea className="ai-pillar-textarea" value={cronPrompt} onChange={e => setCronPrompt(e.target.value)} placeholder="Prompt for AI..." />
            <button className="ai-pillar-btn" onClick={handleCreateCron}>Create Cron</button>
          </div>
          {crons.map((cr: any) => (
            <div key={cr.id} className={'ai-pillar-card' + (cr.enabled ? '' : ' ai-pillar-card-disabled')}>
              <div className="ai-pillar-card-header">
                <span className="ai-pillar-card-name">{cr.name}</span>
                <span className="ai-pillar-card-meta">{cr.schedule}</span>
              </div>
              <div className="ai-pillar-card-desc">{cr.prompt.slice(0, 100)}</div>
              {cr.lastRunAt && <div className="ai-pillar-card-meta">Last: {cr.lastRunAt.replace('T', ' ').slice(0, 19)}</div>}
              {cr.lastResult && <div className="ai-pillar-card-result">{cr.lastResult.slice(0, 150)}</div>}
              <div className="ai-pillar-card-actions">
                <button className="ai-pillar-btn" onClick={() => handleToggleCron(cr.id, cr.enabled)}>{cr.enabled ? 'Disable' : 'Enable'}</button>
                <button className="ai-pillar-btn ai-pillar-btn-danger" onClick={() => handleDeleteCron(cr.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AIFivePillarPanel;
