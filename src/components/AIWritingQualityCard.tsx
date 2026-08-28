import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AIControlMode, AIDesignQualityCheck, AIDesignQualityReport } from '../types';
import { QUICK_PROMPTS } from '../utils/aiClient';
import { requestDesignQualityAudit } from '../utils/designQualityAuditClient';
import { useI18n } from '../i18n';

const MAX_AUTOMATIC_AUDIT_CHARS = 360_000;

const KIND_LABELS = {
  zh: {
    gdd: '完整 GDD', system: '系统策划', economy: '数值经济', level: '关卡设计', combat: '战斗设计',
    narrative: '叙事设计', ux: 'UX 设计', technical: '技术设计', art: '美术需求', general: '通用策划',
  },
  en: {
    gdd: 'Full GDD', system: 'System design', economy: 'Economy design', level: 'Level design', combat: 'Combat design',
    narrative: 'Narrative design', ux: 'UX design', technical: 'Technical design', art: 'Art brief', general: 'Design spec',
  },
} as const;

const CHECK_LABELS_ZH: Record<string, string> = {
  'intent-value': '设计意图与可观察的玩家或制作结果',
  'evidence-status': '事实、决策、假设和开放问题分离',
  scope: '范围、非目标与里程碑边界',
  'operating-model': '触发、输入、选择、规则变化与输出闭环',
  'feedback-states': '玩家反馈与完整界面状态',
  'production-contract': '数据、配置、资产、依赖和负责人交接',
  'failure-edge': '失败、中断、恢复、滥用和边界处理',
  validation: '原型、QA、埋点与可观察验收标准',
  'tradeoff-risk': '风险、取舍、简化方案与失败后的决定',
  traceability: '目标到实现、负责人和证据的追溯链',
  'revision-ledger': '下一项决定、变更账本与排期影响',
  'natural-author-voice': '自然、明确的岗位作者语气',
  'economy-model': '变量、单位、公式、取整与演算示例',
  'economy-flow': '来源、消耗、上限、节奏与套利压力',
  'economy-validation': '敏感性、极值、埋点与调参责任',
  'combat-contract': '输入、时序、目标、取消和状态优先级',
  'combat-feedback': '动画、特效、音效、镜头与命中可读性',
  'combat-validation': '调试场景、帧数据与手感验收',
  'level-flow': '关键路线、可选路线、遭遇节拍与检查点',
  'level-metrics': '灰盒尺寸、距离时间基线与内容预算',
  'level-validation': '试玩路线、观察记录与量化验收',
  'narrative-canon': '正史依据、角色动机、冲突与因果揭示',
  'narrative-state': '任务、台词、演出、分支与中断状态',
  'narrative-handoff': '资产映射、实现交接、连续性与 QA',
  'ux-flow': '入口出口、任务流、导航与信息层级',
  'ux-states': '加载、空、错误、禁用、成功与无障碍状态',
  'ux-validation': 'UI 数据契约、埋点和可用性验收',
  'technical-architecture': '模块边界、生命周期、数据流、接口与事件',
  'technical-resilience': '存档迁移、性能预算、错误与恢复',
  'technical-validation': '可观测性、调试工具和自动化测试',
  'art-deliverables': '资产清单、尺寸、格式、命名与导出规则',
  'art-states': '状态、变体、动画特效与视觉参考',
  'art-production': '优先级、依赖、预算、评审与验收参考',
  'gdd-loop': '资源回流、成长变化和重入完整的核心循环',
  'gdd-horizons': '即时、会话、局外与长期体验层级',
  'gdd-topology': '系统拓扑、内容负担、范围与原型证据',
  'system-states': '触发、状态转换、资源限制与中断规则',
  'system-data': '配置字段、持久化、事件与跨系统依赖',
  'system-validation': '边界、套利、埋点与回归测试',
  'general-behavior': '明确行为、状态与约束',
  'general-handoff': '实现或制作交付细节',
  'general-validation': '边界情况与验收证据',
};

function checkLabel(check: AIDesignQualityCheck, chinese: boolean): string {
  return chinese ? (CHECK_LABELS_ZH[check.id] || check.label) : check.label;
}

function naturalnessLabel(issue: string, chinese: boolean): string {
  if (!chinese) return issue;
  if (/chatbot/i.test(issue)) return '客服式开场、自我说明或通用收尾';
  if (/Chinese canned/i.test(issue)) return '机械中文连接词和段落脚手架';
  if (/inflated Chinese/i.test(issue)) return '空泛中文营销词';
  if (/formulaic Chinese/i.test(issue)) return '中文成对模板句和翻译腔';
  if (/vague player/i.test(issue)) return '没有行为证据的玩家体验结论';
  if (/English canned/i.test(issue)) return '机械英文连接词和总结句';
  if (/inflated English/i.test(issue)) return '夸张英文形容词和公关措辞';
  if (/formulaic English/i.test(issue)) return '英文模板化对称句';
  if (/vague English/i.test(issue)) return '没有证据的英文体验结论';
  if (/begin with the same/i.test(issue)) return '重复的句子开头和机械节奏';
  return issue;
}

function buildSample(content: string): { content: string; sampled: boolean } {
  if (content.length <= MAX_AUTOMATIC_AUDIT_CHARS) return { content, sampled: false };
  const headLength = 260_000;
  const tailLength = MAX_AUTOMATIC_AUDIT_CHARS - headLength;
  return {
    content: `${content.slice(0, headLength)}\n\n${content.slice(-tailLength)}`,
    sampled: true,
  };
}

interface AIWritingQualityCardProps {
  active: boolean;
  currentFilePath: string;
  content: string;
  configured: boolean;
  sending: boolean;
  controlMode: AIControlMode;
  onSendPrompt: (prompt: string) => void | Promise<void>;
  variant?: 'center' | 'sidebar';
}

const AIWritingQualityCard: React.FC<AIWritingQualityCardProps> = ({
  active,
  currentFilePath,
  content,
  configured,
  sending,
  controlMode,
  onSendPrompt,
  variant = 'sidebar',
}) => {
  const { language } = useI18n();
  const chinese = language === 'zh-CN';
  const [report, setReport] = useState<AIDesignQualityReport | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const auditedPathRef = useRef(currentFilePath);
  const handledRefreshTokenRef = useRef(0);
  const isMarkdown = /\.md$/i.test(currentFilePath || '');

  useEffect(() => {
    if (!active || !isMarkdown || !content.trim()) {
      setReport(null);
      setError('');
      setRefreshing(false);
      return;
    }
    if (auditedPathRef.current !== currentFilePath) {
      auditedPathRef.current = currentFilePath;
      setReport(null);
    }
    let cancelled = false;
    setRefreshing(true);
    const timer = window.setTimeout(async () => {
      const force = refreshToken !== handledRefreshTokenRef.current;
      handledRefreshTokenRef.current = refreshToken;
      const sample = buildSample(content);
      try {
        const next = await requestDesignQualityAudit({
          filePath: currentFilePath,
          content: sample.content,
          options: {
            totalCharacterCount: content.length,
            sampled: sample.sampled,
          },
        }, { force });
        if (!cancelled) {
          setReport(next);
          setError('');
        }
      } catch (reason: any) {
        if (!cancelled) setError(reason?.message || (chinese ? '本地质量检测失败' : 'Local quality audit failed'));
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    }, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, chinese, content, currentFilePath, isMarkdown, refreshToken]);

  const promptMap = useMemo(() => new Map(QUICK_PROMPTS.map((item) => [item.id, item.prompt])), []);
  if (!active || !isMarkdown) return null;

  const kindLabel = report ? KIND_LABELS[chinese ? 'zh' : 'en'][report.kind] : (chinese ? '策划文档' : 'Design document');
  const readinessLabel = !report
    ? (chinese ? '待检测' : 'Not checked')
    : report.readiness === 'implementation-ready'
      ? (chinese ? '可实现' : 'Implementation-ready')
      : report.readiness === 'review-ready'
        ? (chinese ? '可评审' : 'Review-ready')
        : (chinese ? '草稿' : 'Draft');
  const canMutate = configured && !sending && controlMode !== 'readonly';

  const sendQualityPrompt = (id: string) => {
    const base = promptMap.get(id);
    if (!base) return;
    const gapBrief = report?.issues.slice(0, 7).map((item) => checkLabel(item, chinese)).join('；') || (chinese ? '尚未完成本地检测' : 'Local preflight has not completed');
    const naturalBrief = report?.naturalnessIssues.slice(0, 4).map((item) => naturalnessLabel(item, chinese)).join('；') || (chinese ? '未发现明显模板腔' : 'No severe template voice detected');
    void onSendPrompt(`${base}\n\nLocal Ars-note preflight for the current note:\n- Document: ${currentFilePath}\n- Maturity: ${report?.maturityScore ?? '-'} / 100\n- Naturalness: ${report?.naturalnessScore ?? '-'} / 100\n- Priority gaps: ${gapBrief}\n- Voice findings: ${naturalBrief}\nUse these findings as a repair queue. Re-read the source before changing it and do not claim a gate passed until the exact document has been verified after writing.`);
  };

  return (
    <section className={`ai-writing-quality ai-writing-quality-${variant}${expanded ? ' expanded' : ''}`} aria-label={chinese ? '当前策划质量' : 'Current design quality'}>
      <button className="ai-writing-quality-summary" type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        <span className={`ai-writing-quality-state readiness-${report?.readiness || 'pending'}`} aria-hidden="true" />
        <span className="ai-writing-quality-title">
          <strong>{kindLabel}</strong>
          <small>{report?.analysisScope === 'sampled' ? (chinese ? '超大文档抽样' : 'Large-file sample') : readinessLabel}</small>
        </span>
        <span className="ai-writing-quality-scores">
          <span><b>{report?.maturityScore ?? '-'}</b><small>{chinese ? '专业度' : 'Maturity'}</small></span>
          <span><b>{report?.naturalnessScore ?? '-'}</b><small>{chinese ? '自然度' : 'Voice'}</small></span>
        </span>
        <span className="ai-writing-quality-chevron">{expanded ? '−' : '+'}</span>
      </button>

      {expanded && (
        <div className="ai-writing-quality-body">
          <div className="ai-writing-quality-meter" aria-label={chinese ? '策划成熟度' : 'Design maturity'}>
            <span style={{ width: `${report?.maturityScore || 0}%` }} />
          </div>
          <p className="ai-writing-quality-note">
            {report?.analysisScope === 'sampled'
              ? (chinese ? `为避免卡顿，只分析 ${report.analyzedCharacterCount.toLocaleString()} / ${report.characterCount.toLocaleString()} 字符；结果用于定位，不作为完整通过证明。` : `To avoid blocking, ${report.analyzedCharacterCount.toLocaleString()} of ${report.characterCount.toLocaleString()} characters were sampled.`)
              : (chinese ? '本地结构审计，不调用模型、不消耗额度；最终方案仍需岗位负责人评审。' : 'Local structural audit. No model call or token usage; discipline-owner review is still required.')}
          </p>
          {refreshing && <div className="ai-writing-quality-loading">{chinese ? '正在更新检测...' : 'Refreshing audit...'}</div>}
          {error && <div className="ai-writing-quality-error">{error}</div>}

          {report && (
            <div className="ai-writing-quality-columns">
              <div>
                <h4>{chinese ? '优先补齐' : 'Priority gaps'}</h4>
                {report.issues.length ? (
                  <ul>{report.issues.slice(0, 6).map((item) => <li className={item.critical ? 'critical' : ''} key={item.id}>{checkLabel(item, chinese)}</li>)}</ul>
                ) : <p className="ai-writing-quality-empty">{chinese ? '结构门禁已通过' : 'Structural gate passed'}</p>}
              </div>
              <div>
                <h4>{chinese ? '已具备' : 'Strengths'}</h4>
                {report.strengths.length ? (
                  <ul>{report.strengths.slice(0, 4).map((item) => <li className="passed" key={item.id}>{checkLabel(item, chinese)}</li>)}</ul>
                ) : <p className="ai-writing-quality-empty">{chinese ? '需要先建立完整策划骨架' : 'Build the design spine first'}</p>}
              </div>
            </div>
          )}

          {report?.naturalnessIssues.length ? (
            <div className="ai-writing-quality-voice">
              <strong>{chinese ? '写作痕迹' : 'Voice findings'}</strong>
              <span>{report.naturalnessIssues.slice(0, 3).map((item) => naturalnessLabel(item, chinese)).join('；')}</span>
            </div>
          ) : null}

          <div className="ai-writing-quality-actions">
            <button type="button" disabled={!canMutate} onClick={() => sendQualityPrompt('professionalize-current-design')} title={controlMode === 'readonly' ? (chinese ? '切换到成员执行后可修改当前文档' : 'Switch to Member execution to edit') : ''}>
              {chinese ? '按缺口专业化' : 'Repair gaps'}
            </button>
            <button type="button" disabled={!configured || sending} onClick={() => sendQualityPrompt('professional-design-review')}>
              {chinese ? '只读评审' : 'Read-only review'}
            </button>
            <button type="button" disabled={!canMutate} onClick={() => sendQualityPrompt('humanize-current-text')}>
              {chinese ? '中英去 AI 化' : 'Naturalize ZH/EN'}
            </button>
            <button type="button" className="quiet" disabled={refreshing} onClick={() => setRefreshToken((value) => value + 1)}>
              {chinese ? '重新检测' : 'Recheck'}
            </button>
          </div>
          {controlMode === 'readonly' && (
            <div className="ai-writing-quality-mode-hint">{chinese ? '当前为只读分析。切换到“成员执行”后才允许修改文档。' : 'Read-only mode is active. Switch to Member execution before editing.'}</div>
          )}
        </div>
      )}
    </section>
  );
};

export default AIWritingQualityCard;
