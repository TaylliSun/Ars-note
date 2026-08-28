import React, { useEffect, useMemo, useState } from 'react';
import {
  getModelPrimaryMetric,
  sampleSimulationPoints,
  simulateCombat,
  simulateDrop,
  simulateEconomy,
  simulateGrowth,
  simulateModelPoints,
  simulateSensitivity,
  type BalanceConfig,
  type BalanceModelKind,
  type CombatConfig,
  type DropConfig,
  type EconomyConfig,
  type GrowthConfig,
  type SimulationPoint,
} from '../utils/balanceSimulator';
import { CloseIcon, CopyIcon, DownloadIcon, PlusIcon } from './icons/ArsIcons';

type BalanceLabProps = {
  vaultPath: string;
  vaultName: string;
  onClose: () => void;
};

type SavedScenario = {
  id: string;
  name: string;
  kind: BalanceModelKind;
  config: BalanceConfig;
  updatedAt: string;
};

const DEFAULT_GROWTH: GrowthConfig = { mode: 'compound', startValue: 100, levels: 50, linearStep: 12, growthRate: 0.08, exponent: 1.5 };
const DEFAULT_COMBAT: CombatConfig = { attack: 320, defense: 120, skillMultiplier: 1.8, critRate: 0.25, critMultiplier: 1.75, hitCount: 3, enemyHp: 12000, actionInterval: 1.2 };
const DEFAULT_ECONOMY: EconomyConfig = { startBalance: 1000, days: 30, dailyIncome: 180, dailyExpense: 120, incomeGrowthRate: 0, expenseGrowthRate: 0.015 };
const DEFAULT_DROP: DropConfig = { baseRate: 0.02, attempts: 100, pityAt: 80, guaranteedPity: true };

const MODEL_META: Record<BalanceModelKind, { label: string; short: string; description: string }> = {
  growth: { label: '成长曲线', short: 'Growth', description: '等级属性、经验与价格曲线' },
  combat: { label: '战斗伤害', short: 'Combat', description: '减伤、暴击、DPS 与击杀时间' },
  economy: { label: '经济产消', short: 'Economy', description: '货币流入、消耗与破产风险' },
  drop: { label: '掉落概率', short: 'Drop', description: '抽取概率、保底与期望产出' },
};

const SENSITIVITY_OPTIONS: Record<BalanceModelKind, Array<{ key: string; label: string }>> = {
  growth: [{ key: 'growthRate', label: '每级增长率' }, { key: 'linearStep', label: '每级增量' }, { key: 'exponent', label: '增长指数' }, { key: 'startValue', label: '初始值' }],
  combat: [{ key: 'attack', label: '攻击力' }, { key: 'defense', label: '目标防御' }, { key: 'skillMultiplier', label: '技能倍率' }, { key: 'critRate', label: '暴击率' }, { key: 'critMultiplier', label: '暴击倍率' }],
  economy: [{ key: 'dailyIncome', label: '每日产出' }, { key: 'dailyExpense', label: '每日消耗' }, { key: 'incomeGrowthRate', label: '产出增长率' }, { key: 'expenseGrowthRate', label: '消耗增长率' }],
  drop: [{ key: 'baseRate', label: '基础掉率' }, { key: 'pityAt', label: '保底次数' }, { key: 'attempts', label: '抽取次数' }],
};

const MODEL_PRIMARY_LABEL: Record<BalanceModelKind, string> = {
  growth: '最终数值',
  combat: '期望 DPS',
  economy: '期末余额',
  drop: '至少获得一次概率',
};

const COMPARE_COLORS = ['#7c6cff', '#23b7d8', '#f3ad35', '#ef6f75'];

const formatNumber = (value: number, digits = 2) => {
  if (!Number.isFinite(value)) return '∞';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}m`;
  if (absolute >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return value.toLocaleString('zh-CN', { maximumFractionDigits: digits });
};
const formatPercent = (value: number) => `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
const storageKey = (vaultPath: string) => `ars-note.balance-lab:${vaultPath.replace(/\\/g, '/').toLowerCase()}`;

const NumberField: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}> = ({ label, value, onChange, suffix, min, max, step = 1, hint }) => (
  <label className="balance-field">
    <span className="balance-field-label">{label}{hint && <small>{hint}</small>}</span>
    <span className="balance-field-input-wrap">
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {suffix && <span>{suffix}</span>}
    </span>
  </label>
);

const LineChart: React.FC<{ points: SimulationPoint[]; valueLabel: string; accent?: string }> = ({ points, valueLabel, accent = '#6f7cff' }) => {
  const chart = useMemo(() => {
    if (points.length === 0) return null;
    const width = 900;
    const height = 310;
    const padding = { left: 58, right: 24, top: 22, bottom: 42 };
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.value);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);
    if (minY === maxY) { minY -= 1; maxY += 1; }
    const scaleX = (x: number) => padding.left + ((x - minX) / Math.max(1, maxX - minX)) * (width - padding.left - padding.right);
    const scaleY = (y: number) => height - padding.bottom - ((y - minY) / (maxY - minY)) * (height - padding.top - padding.bottom);
    const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${scaleX(point.x).toFixed(2)} ${scaleY(point.value).toFixed(2)}`).join(' ');
    const area = `${path} L ${scaleX(points[points.length - 1].x)} ${height - padding.bottom} L ${scaleX(points[0].x)} ${height - padding.bottom} Z`;
    const yTicks = Array.from({ length: 5 }, (_, index) => minY + ((maxY - minY) * index) / 4).reverse();
    const xTicks = Array.from({ length: 5 }, (_, index) => minX + ((maxX - minX) * index) / 4);
    return { width, height, padding, path, area, yTicks, xTicks, scaleX, scaleY, minX, maxX };
  }, [points]);

  if (!chart) return <div className="balance-chart-empty">暂无可绘制数据</div>;
  const last = points[points.length - 1];
  return (
    <svg className="balance-chart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`${valueLabel}变化曲线`}>
      <defs>
        <linearGradient id="balance-chart-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.28" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {chart.yTicks.map((tick, index) => {
        const y = chart.scaleY(tick);
        return <g key={`y-${index}`}><line x1={chart.padding.left} y1={y} x2={chart.width - chart.padding.right} y2={y} className="balance-chart-grid" /><text x={chart.padding.left - 10} y={y + 4} textAnchor="end">{formatNumber(tick)}</text></g>;
      })}
      {chart.xTicks.map((tick, index) => <text key={`x-${index}`} x={chart.scaleX(tick)} y={chart.height - 15} textAnchor="middle">{formatNumber(tick, 0)}</text>)}
      <path d={chart.area} fill="url(#balance-chart-fill)" />
      <path d={chart.path} fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={chart.scaleX(last.x)} cy={chart.scaleY(last.value)} r="5" fill={accent} stroke="var(--bg-primary)" strokeWidth="3" />
    </svg>
  );
};

type ComparisonSeries = { id?: string; name: string; points: SimulationPoint[]; color: string };

const MultiLineChart: React.FC<{ series: ComparisonSeries[]; valueLabel: string }> = ({ series, valueLabel }) => {
  const chart = useMemo(() => {
    const allPoints = series.flatMap((item) => item.points);
    if (allPoints.length === 0) return null;
    const width = 900;
    const height = 310;
    const padding = { left: 58, right: 24, top: 22, bottom: 42 };
    const xs = allPoints.map((point) => point.x);
    const ys = allPoints.map((point) => point.value);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);
    if (minY === maxY) { minY -= 1; maxY += 1; }
    const scaleX = (x: number) => padding.left + ((x - minX) / Math.max(1, maxX - minX)) * (width - padding.left - padding.right);
    const scaleY = (y: number) => height - padding.bottom - ((y - minY) / (maxY - minY)) * (height - padding.top - padding.bottom);
    const yTicks = Array.from({ length: 5 }, (_, index) => minY + ((maxY - minY) * index) / 4).reverse();
    const xTicks = Array.from({ length: 5 }, (_, index) => minX + ((maxX - minX) * index) / 4);
    return { width, height, padding, scaleX, scaleY, yTicks, xTicks };
  }, [series]);

  if (!chart) return <div className="balance-chart-empty">请选择需要对比的方案</div>;
  return (
    <div className="balance-comparison-chart">
      <div className="balance-chart-legend">
        {series.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}</span>)}
      </div>
      <svg className="balance-chart" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`${valueLabel}方案对比曲线`}>
        {chart.yTicks.map((tick, index) => {
          const y = chart.scaleY(tick);
          return <g key={`y-${index}`}><line x1={chart.padding.left} y1={y} x2={chart.width - chart.padding.right} y2={y} className="balance-chart-grid" /><text x={chart.padding.left - 10} y={y + 4} textAnchor="end">{formatNumber(tick)}</text></g>;
        })}
        {chart.xTicks.map((tick, index) => <text key={`x-${index}`} x={chart.scaleX(tick)} y={chart.height - 15} textAnchor="middle">{formatNumber(tick, 0)}</text>)}
        {series.map((item, seriesIndex) => {
          const path = item.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${chart.scaleX(point.x).toFixed(2)} ${chart.scaleY(point.value).toFixed(2)}`).join(' ');
          return <path key={`${item.id || 'current'}-${seriesIndex}`} d={path} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />;
        })}
      </svg>
    </div>
  );
};

const BalanceLab: React.FC<BalanceLabProps> = ({ vaultPath, vaultName, onClose }) => {
  const [kind, setKind] = useState<BalanceModelKind>('growth');
  const [scenarioName, setScenarioName] = useState('新数值方案');
  const [growth, setGrowth] = useState(DEFAULT_GROWTH);
  const [combat, setCombat] = useState(DEFAULT_COMBAT);
  const [economy, setEconomy] = useState(DEFAULT_ECONOMY);
  const [drop, setDrop] = useState(DEFAULT_DROP);
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>([]);
  const [feedback, setFeedback] = useState('');
  const [analysisMode, setAnalysisMode] = useState<'trend' | 'sensitivity' | 'compare'>('trend');
  const [sensitivityParameter, setSensitivityParameter] = useState(SENSITIVITY_OPTIONS.growth[0].key);
  const [sensitivityRange, setSensitivityRange] = useState(0.2);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    try {
      const raw = localStorage.getItem(storageKey(vaultPath));
      const parsed = raw ? JSON.parse(raw) : [];
      setSavedScenarios(Array.isArray(parsed) ? parsed : []);
    } catch {
      setSavedScenarios([]);
    }
    void (async () => {
      try {
        const scenarioFile = await window.arsnote.joinPath(vaultPath, '.ars-team', 'balance-lab.json');
        const raw = await window.arsnote.readFile(scenarioFile);
        const parsed = JSON.parse(raw);
        const scenarios = Array.isArray(parsed) ? parsed : parsed?.scenarios;
        if (!cancelled && Array.isArray(scenarios)) {
          setSavedScenarios(scenarios);
          localStorage.setItem(storageKey(vaultPath), JSON.stringify(scenarios));
        }
      } catch {
        // A new Vault has no shared Balance Lab file yet; the local cache remains usable.
      }
    })();
    return () => { cancelled = true; };
  }, [vaultPath]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(''), 2200);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const growthResult = useMemo(() => simulateGrowth(growth), [growth]);
  const combatResult = useMemo(() => simulateCombat(combat), [combat]);
  const economyResult = useMemo(() => simulateEconomy(economy), [economy]);
  const dropResult = useMemo(() => simulateDrop(drop), [drop]);
  const activeConfig = useMemo<BalanceConfig>(() => (
    kind === 'growth' ? growth : kind === 'combat' ? combat : kind === 'economy' ? economy : drop
  ), [combat, drop, economy, growth, kind]);

  const view = useMemo(() => {
    if (kind === 'growth') return {
      points: growthResult.points,
      valueLabel: '属性值',
      accent: '#7c6cff',
      xLabel: '等级',
      metrics: [
        ['初始值', formatNumber(growthResult.start)],
        ['最终值', formatNumber(growthResult.end)],
        ['总增幅', formatNumber(growthResult.totalGrowth)],
        ['平均每级', formatNumber(growthResult.averageStep)],
      ],
      insight: `从 Lv.1 到 Lv.${growth.levels}，数值扩大为初始值的 ${formatNumber(growthResult.start > 0 ? growthResult.end / growthResult.start : 0)} 倍。`,
    };
    if (kind === 'combat') return {
      points: combatResult.points,
      valueLabel: '敌方剩余生命',
      accent: '#ff716b',
      xLabel: '行动次数',
      metrics: [
        ['单次普攻伤害', formatNumber(combatResult.normalHit)],
        ['期望行动伤害', formatNumber(combatResult.expectedActionDamage)],
        ['期望 DPS', formatNumber(combatResult.expectedDps)],
        ['击杀时间', `${formatNumber(combatResult.expectedSeconds)} 秒`],
      ],
      insight: `预计需要 ${combatResult.actionsToDefeat} 次行动击败目标；单次行动伤害区间为 ${formatNumber(combatResult.minActionDamage)} - ${formatNumber(combatResult.maxActionDamage)}。`,
    };
    if (kind === 'economy') return {
      points: economyResult.points,
      valueLabel: '货币余额',
      accent: '#2acb82',
      xLabel: '天数',
      metrics: [
        ['期末余额', formatNumber(economyResult.endBalance)],
        ['累计产出', formatNumber(economyResult.totalIncome)],
        ['累计消耗', formatNumber(economyResult.totalExpense)],
        ['净变化', formatNumber(economyResult.netChange)],
      ],
      insight: economyResult.firstDeficitDay === null ? `在 ${economy.days} 天模拟周期内未出现负余额。` : `第 ${economyResult.firstDeficitDay} 天出现负余额，需要调整产出或消耗。`,
    };
    return {
      points: dropResult.points,
      valueLabel: '至少获得一次的概率',
      accent: '#f3ad35',
      xLabel: '抽取次数',
      metrics: [
        ['至少获得 1 次', formatPercent(dropResult.probabilityAtLeastOne)],
        ['期望获得数量', formatNumber(dropResult.expectedCopies, 3)],
        ['平均每个所需抽数', formatNumber(dropResult.averagePullsPerCopy)],
        ['全程未获得', formatPercent(dropResult.probabilityNoDrop)],
      ],
      insight: `${drop.attempts} 次抽取的期望产出为 ${formatNumber(dropResult.expectedCopies, 3)} 个${drop.guaranteedPity ? `，第 ${drop.pityAt} 抽触发硬保底` : '，当前未启用硬保底'}。`,
    };
  }, [combat, combatResult, drop, dropResult, economy, economyResult, growth, growthResult, kind]);

  const sensitivityPoints = useMemo(
    () => simulateSensitivity(kind, activeConfig, sensitivityParameter, sensitivityRange, 9),
    [activeConfig, kind, sensitivityParameter, sensitivityRange],
  );
  const sensitivityImpact = useMemo(() => {
    if (sensitivityPoints.length < 2) return { ratio: 0, level: 'low' as const, label: '低敏感' };
    const values = sensitivityPoints.map((point) => point.value);
    const midpoint = Math.abs(values[Math.floor(values.length / 2)]) || 1;
    const ratio = (Math.max(...values) - Math.min(...values)) / midpoint;
    if (ratio >= 0.5) return { ratio, level: 'high' as const, label: '高敏感' };
    if (ratio >= 0.2) return { ratio, level: 'medium' as const, label: '中敏感' };
    return { ratio, level: 'low' as const, label: '低敏感' };
  }, [sensitivityPoints]);
  const comparableScenarios = useMemo(
    () => savedScenarios.filter((scenario) => scenario.kind === kind),
    [kind, savedScenarios],
  );
  const comparisonSeries = useMemo<ComparisonSeries[]>(() => {
    const selected = comparableScenarios.filter((scenario) => compareIds.includes(scenario.id)).slice(0, 3);
    return [
      { name: scenarioName.trim() || '当前方案', points: view.points, color: COMPARE_COLORS[0] },
      ...selected.map((scenario, index) => ({
        id: scenario.id,
        name: scenario.name,
        points: simulateModelPoints(kind, scenario.config),
        color: COMPARE_COLORS[index + 1],
      })),
    ];
  }, [comparableScenarios, compareIds, kind, scenarioName, view.points]);
  const comparisonMetrics = useMemo(() => comparisonSeries.map((series, index) => ({
    name: series.name,
    color: series.color,
    value: index === 0
      ? getModelPrimaryMetric(kind, activeConfig)
      : getModelPrimaryMetric(kind, comparableScenarios.find((scenario) => scenario.id === series.id)?.config || activeConfig),
  })), [activeConfig, comparableScenarios, comparisonSeries, kind]);

  const changeModel = (nextKind: BalanceModelKind) => {
    setKind(nextKind);
    setSensitivityParameter(SENSITIVITY_OPTIONS[nextKind][0].key);
    setCompareIds([]);
    setAnalysisMode('trend');
  };

  const toggleComparison = (id: string) => {
    setCompareIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 3) {
        setFeedback('最多同时对比 3 个已保存方案');
        return current;
      }
      return [...current, id];
    });
  };

  const currentConfig = (): SavedScenario['config'] => activeConfig;
  const persistScenarios = (next: SavedScenario[]) => {
    setSavedScenarios(next);
    try { localStorage.setItem(storageKey(vaultPath), JSON.stringify(next)); } catch { /* Local persistence is best effort. */ }
    void (async () => {
      try {
        const teamFolder = await window.arsnote.joinPath(vaultPath, '.ars-team');
        try { await window.arsnote.createFolder(teamFolder); } catch { /* The shared team folder usually exists. */ }
        const scenarioFile = await window.arsnote.joinPath(teamFolder, 'balance-lab.json');
        await window.arsnote.writeFile(scenarioFile, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), scenarios: next }, null, 2));
      } catch {
        setFeedback('方案已保存在本机，Vault 写入失败');
      }
    })();
  };
  const saveScenario = () => {
    const name = scenarioName.trim() || `${MODEL_META[kind].label}方案`;
    const existing = savedScenarios.find((item) => item.name === name && item.kind === kind);
    const scenario: SavedScenario = { id: existing?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`, name, kind, config: currentConfig(), updatedAt: new Date().toISOString() };
    persistScenarios([scenario, ...savedScenarios.filter((item) => item.id !== scenario.id)].slice(0, 40));
    setScenarioName(name);
    setFeedback(existing ? '方案已更新' : '方案已保存');
  };
  const loadScenario = (scenario: SavedScenario) => {
    changeModel(scenario.kind);
    setScenarioName(scenario.name);
    if (scenario.kind === 'growth') setGrowth({ ...DEFAULT_GROWTH, ...(scenario.config as GrowthConfig) });
    if (scenario.kind === 'combat') setCombat({ ...DEFAULT_COMBAT, ...(scenario.config as CombatConfig) });
    if (scenario.kind === 'economy') setEconomy({ ...DEFAULT_ECONOMY, ...(scenario.config as EconomyConfig) });
    if (scenario.kind === 'drop') setDrop({ ...DEFAULT_DROP, ...(scenario.config as DropConfig) });
    setFeedback('方案已载入');
  };

  const buildReport = () => {
    const rows = sampleSimulationPoints(view.points, 16).map((point) => `| ${formatNumber(point.x, 0)} | ${formatNumber(point.value, 4)} |`).join('\n');
    return `# ${scenarioName.trim() || MODEL_META[kind].label}\n\n> Ars-note 数值实验室 · ${MODEL_META[kind].label}\n> Vault: ${vaultName || 'Untitled'}\n> 生成时间: ${new Date().toLocaleString('zh-CN')}\n\n## 结论\n\n${view.insight}\n\n## 关键指标\n\n${view.metrics.map(([label, value]) => `- **${label}**: ${value}`).join('\n')}\n\n## 抽样数据\n\n| ${view.xLabel} | ${view.valueLabel} |\n|---:|---:|\n${rows}\n`;
  };
  const copyReport = async () => {
    try { await navigator.clipboard.writeText(buildReport()); setFeedback('Markdown 报告已复制'); }
    catch { setFeedback('复制失败'); }
  };
  const downloadReport = () => {
    const blob = new Blob([buildReport()], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(scenarioName.trim() || MODEL_META[kind].label).replace(/[<>:"/\\|?*]/g, '-')}.md`;
    link.click();
    URL.revokeObjectURL(url);
    setFeedback('报告已导出');
  };

  const downloadCsv = () => {
    const escapeCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    let rows: Array<Array<string | number>>;
    if (analysisMode === 'sensitivity') {
      rows = [['参数', MODEL_PRIMARY_LABEL[kind], '相对基准'], ...sensitivityPoints.map((point) => [point.input, point.value, point.multiplier])];
    } else if (analysisMode === 'compare') {
      rows = [['方案', view.xLabel, view.valueLabel], ...comparisonSeries.flatMap((series) => series.points.map((point) => [series.name, point.x, point.value]))];
    } else {
      rows = [[view.xLabel, view.valueLabel, '辅助值'], ...view.points.map((point) => [point.x, point.value, point.secondary ?? ''])];
    }
    const csv = `\uFEFF${rows.map((row) => row.map(escapeCell).join(',')).join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(scenarioName.trim() || MODEL_META[kind].label).replace(/[<>:"/\\|?*]/g, '-')}-${analysisMode}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setFeedback('CSV 数据已导出');
  };

  const activeTablePoints = analysisMode === 'sensitivity' ? sensitivityPoints : view.points;
  const sampledRows = sampleSimulationPoints(activeTablePoints, 12);
  return (
    <div className="balance-lab">
      <header className="balance-lab-header">
        <div>
          <span className="balance-lab-kicker">GAME BALANCE WORKBENCH</span>
          <h1>数值实验室</h1>
          <p>快速验证策划假设，先看趋势，再改参数。</p>
        </div>
        <div className="balance-lab-header-actions">
          {feedback && <span className="balance-feedback" role="status">{feedback}</span>}
          <button type="button" className="balance-icon-btn" onClick={copyReport} title="复制 Markdown 报告"><CopyIcon size={15} /></button>
          <button type="button" className="balance-button balance-button-secondary" onClick={downloadCsv}><DownloadIcon size={15} />CSV</button>
          <button type="button" className="balance-button" onClick={downloadReport}><DownloadIcon size={15} />导出报告</button>
          <button type="button" className="balance-icon-btn" onClick={onClose} title="返回编辑器"><CloseIcon size={16} /></button>
        </div>
      </header>

      <nav className="balance-model-tabs" aria-label="数值模型">
        {(Object.keys(MODEL_META) as BalanceModelKind[]).map((modelKind) => (
          <button key={modelKind} type="button" className={kind === modelKind ? 'active' : ''} onClick={() => changeModel(modelKind)}>
            <span>{MODEL_META[modelKind].label}</span><small>{MODEL_META[modelKind].description}</small>
          </button>
        ))}
      </nav>

      <main className="balance-lab-grid">
        <aside className="balance-controls-panel">
          <div className="balance-panel-heading">
            <div><span>{MODEL_META[kind].short}</span><h2>模型参数</h2></div>
            <button type="button" className="balance-reset-btn" onClick={() => {
              if (kind === 'growth') setGrowth(DEFAULT_GROWTH);
              if (kind === 'combat') setCombat(DEFAULT_COMBAT);
              if (kind === 'economy') setEconomy(DEFAULT_ECONOMY);
              if (kind === 'drop') setDrop(DEFAULT_DROP);
            }}>重置</button>
          </div>

          <div className="balance-fields">
            {kind === 'growth' && <>
              <label className="balance-field"><span className="balance-field-label">曲线类型</span><select value={growth.mode} onChange={(event) => {
                const mode = event.target.value as GrowthConfig['mode'];
                setGrowth({ ...growth, mode });
                setSensitivityParameter(mode === 'linear' ? 'linearStep' : mode === 'power' ? 'exponent' : 'growthRate');
              }}><option value="linear">线性增长</option><option value="compound">复合增长</option><option value="power">幂函数增长</option></select></label>
              <NumberField label="初始值" value={growth.startValue} min={0} onChange={(value) => setGrowth({ ...growth, startValue: value })} />
              <NumberField label="等级数量" value={growth.levels} min={1} max={1000} onChange={(value) => setGrowth({ ...growth, levels: value })} />
              {growth.mode === 'linear' && <NumberField label="每级增量" value={growth.linearStep} onChange={(value) => setGrowth({ ...growth, linearStep: value })} />}
              {growth.mode === 'compound' && <NumberField label="每级增长率" value={growth.growthRate * 100} step={0.1} suffix="%" onChange={(value) => setGrowth({ ...growth, growthRate: value / 100 })} />}
              {growth.mode === 'power' && <NumberField label="增长指数" value={growth.exponent} step={0.05} min={0.01} onChange={(value) => setGrowth({ ...growth, exponent: value })} />}
            </>}
            {kind === 'combat' && <>
              <NumberField label="攻击力" value={combat.attack} min={0} onChange={(value) => setCombat({ ...combat, attack: value })} />
              <NumberField label="目标防御" value={combat.defense} min={0} onChange={(value) => setCombat({ ...combat, defense: value })} />
              <NumberField label="技能倍率" value={combat.skillMultiplier} min={0} step={0.05} suffix="x" onChange={(value) => setCombat({ ...combat, skillMultiplier: value })} />
              <NumberField label="每次命中数" value={combat.hitCount} min={1} max={100} onChange={(value) => setCombat({ ...combat, hitCount: value })} />
              <NumberField label="暴击率" value={combat.critRate * 100} min={0} max={100} step={0.5} suffix="%" onChange={(value) => setCombat({ ...combat, critRate: value / 100 })} />
              <NumberField label="暴击倍率" value={combat.critMultiplier} min={1} step={0.05} suffix="x" onChange={(value) => setCombat({ ...combat, critMultiplier: value })} />
              <NumberField label="目标生命" value={combat.enemyHp} min={1} onChange={(value) => setCombat({ ...combat, enemyHp: value })} />
              <NumberField label="行动间隔" value={combat.actionInterval} min={0.01} step={0.1} suffix="秒" onChange={(value) => setCombat({ ...combat, actionInterval: value })} />
            </>}
            {kind === 'economy' && <>
              <NumberField label="初始余额" value={economy.startBalance} onChange={(value) => setEconomy({ ...economy, startBalance: value })} />
              <NumberField label="模拟周期" value={economy.days} min={1} max={3650} suffix="天" onChange={(value) => setEconomy({ ...economy, days: value })} />
              <NumberField label="每日基础产出" value={economy.dailyIncome} min={0} onChange={(value) => setEconomy({ ...economy, dailyIncome: value })} />
              <NumberField label="每日基础消耗" value={economy.dailyExpense} min={0} onChange={(value) => setEconomy({ ...economy, dailyExpense: value })} />
              <NumberField label="产出日增长" value={economy.incomeGrowthRate * 100} step={0.1} suffix="%" onChange={(value) => setEconomy({ ...economy, incomeGrowthRate: value / 100 })} />
              <NumberField label="消耗日增长" value={economy.expenseGrowthRate * 100} step={0.1} suffix="%" onChange={(value) => setEconomy({ ...economy, expenseGrowthRate: value / 100 })} />
            </>}
            {kind === 'drop' && <>
              <NumberField label="基础掉率" value={drop.baseRate * 100} min={0} max={100} step={0.01} suffix="%" onChange={(value) => setDrop({ ...drop, baseRate: value / 100 })} />
              <NumberField label="抽取次数" value={drop.attempts} min={1} max={5000} onChange={(value) => setDrop({ ...drop, attempts: value })} />
              <NumberField label="保底次数" value={drop.pityAt} min={1} max={1000} onChange={(value) => setDrop({ ...drop, pityAt: value })} />
              <label className="balance-toggle"><span><strong>硬保底</strong><small>达到保底次数时必定获得</small></span><input type="checkbox" checked={drop.guaranteedPity} onChange={(event) => setDrop({ ...drop, guaranteedPity: event.target.checked })} /></label>
            </>}
          </div>

          <div className="balance-save-block">
            <span className="balance-section-label">当前方案</span>
            <div className="balance-save-row"><input value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} maxLength={60} /><button type="button" onClick={saveScenario}><PlusIcon size={14} />保存</button></div>
            <small className="balance-save-hint">保存到 Vault，可通过 Live Sync 同步</small>
          </div>
          {savedScenarios.length > 0 && <div className="balance-scenarios"><span className="balance-section-label">已保存方案</span>{savedScenarios.map((scenario) => <div className="balance-scenario" key={scenario.id}><button type="button" onClick={() => loadScenario(scenario)}><strong>{scenario.name}</strong><span>{MODEL_META[scenario.kind].label}</span></button><button type="button" className="delete" title="删除方案" onClick={() => persistScenarios(savedScenarios.filter((item) => item.id !== scenario.id))}>×</button></div>)}</div>}
        </aside>

        <section className="balance-results-panel">
          <div className="balance-metrics">
            {view.metrics.map(([label, value], index) => <article key={label}><span>{label}</span><strong>{value}</strong><i style={{ '--metric-index': index } as React.CSSProperties} /></article>)}
          </div>
          <div className="balance-insight"><span>DESIGN READOUT</span><p>{view.insight}</p></div>

          <div className="balance-analysis-bar">
            <div className="balance-analysis-tabs" role="tablist" aria-label="分析视图">
              <button type="button" className={analysisMode === 'trend' ? 'active' : ''} onClick={() => setAnalysisMode('trend')}>趋势</button>
              <button type="button" className={analysisMode === 'sensitivity' ? 'active' : ''} onClick={() => setAnalysisMode('sensitivity')}>敏感性</button>
              <button type="button" className={analysisMode === 'compare' ? 'active' : ''} onClick={() => setAnalysisMode('compare')}>方案对比</button>
            </div>
            {analysisMode === 'sensitivity' && (
              <div className="balance-analysis-options">
                <label>观察参数<select value={sensitivityParameter} onChange={(event) => setSensitivityParameter(event.target.value)}>{SENSITIVITY_OPTIONS[kind].map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
                <label>变化范围<select value={sensitivityRange} onChange={(event) => setSensitivityRange(Number(event.target.value))}><option value={0.1}>±10%</option><option value={0.2}>±20%</option><option value={0.3}>±30%</option><option value={0.5}>±50%</option></select></label>
                <span>输出：{MODEL_PRIMARY_LABEL[kind]}</span>
                <span className={`balance-sensitivity-level ${sensitivityImpact.level}`}>{sensitivityImpact.label} · 输出摆幅 {formatPercent(sensitivityImpact.ratio)}</span>
              </div>
            )}
            {analysisMode === 'compare' && (
              <div className="balance-compare-picker">
                {comparableScenarios.length === 0 ? <span>先保存同类型方案，再进行对比</span> : comparableScenarios.map((scenario) => (
                  <button key={scenario.id} type="button" className={compareIds.includes(scenario.id) ? 'selected' : ''} onClick={() => toggleComparison(scenario.id)}>
                    <i style={{ background: compareIds.includes(scenario.id) ? COMPARE_COLORS[Math.max(1, compareIds.indexOf(scenario.id) + 1)] : undefined }} />{scenario.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="balance-chart-card">
            <div className="balance-card-header">
              <div><span>{analysisMode === 'trend' ? '趋势预览' : analysisMode === 'sensitivity' ? '参数敏感性' : '方案对比'}</span><h2>{analysisMode === 'sensitivity' ? MODEL_PRIMARY_LABEL[kind] : view.valueLabel}</h2></div>
              <small>{analysisMode === 'compare' ? `当前方案 + ${compareIds.length} 个已保存方案` : '参数修改后即时重算'}</small>
            </div>
            {analysisMode === 'trend' && <LineChart points={view.points} valueLabel={view.valueLabel} accent={view.accent} />}
            {analysisMode === 'sensitivity' && <LineChart points={sensitivityPoints} valueLabel={MODEL_PRIMARY_LABEL[kind]} accent="#23b7d8" />}
            {analysisMode === 'compare' && <MultiLineChart series={comparisonSeries} valueLabel={view.valueLabel} />}
          </div>

          <div className="balance-table-card">
            <div className="balance-card-header"><div><span>分析明细</span><h2>{analysisMode === 'compare' ? '方案关键指标' : '关键节点'}</h2></div><small>CSV 可导出完整数据</small></div>
            {analysisMode === 'compare' ? (
              <div className="balance-table-wrap"><table><thead><tr><th>方案</th><th>{MODEL_PRIMARY_LABEL[kind]}</th><th>相对当前</th></tr></thead><tbody>{comparisonMetrics.map((metric, index) => {
                const currentValue = comparisonMetrics[0]?.value || 0;
                const delta = index === 0 || currentValue === 0 ? 0 : (metric.value - currentValue) / Math.abs(currentValue);
                return <tr key={`${metric.name}-${index}`}><td><span className="balance-table-series"><i style={{ background: metric.color }} />{metric.name}</span></td><td>{kind === 'drop' ? formatPercent(metric.value) : formatNumber(metric.value, 4)}</td><td className={delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''}>{index === 0 ? '基准' : `${delta > 0 ? '+' : ''}${formatPercent(delta)}`}</td></tr>;
              })}</tbody></table></div>
            ) : (
              <div className="balance-table-wrap"><table><thead><tr><th>{analysisMode === 'sensitivity' ? SENSITIVITY_OPTIONS[kind].find((option) => option.key === sensitivityParameter)?.label : view.xLabel}</th><th>{analysisMode === 'sensitivity' ? MODEL_PRIMARY_LABEL[kind] : view.valueLabel}</th>{analysisMode === 'trend' && sampledRows.some((row) => row.secondary !== undefined) && <th>辅助值</th>}</tr></thead><tbody>{sampledRows.map((point) => <tr key={`${point.x}-${point.value}`}><td>{formatNumber(point.x, 4)}</td><td>{kind === 'drop' ? formatPercent(point.value) : formatNumber(point.value, 4)}</td>{analysisMode === 'trend' && sampledRows.some((row) => row.secondary !== undefined) && <td>{formatNumber(point.secondary ?? 0, 4)}</td>}</tr>)}</tbody></table></div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

export default BalanceLab;
