import { auditHumanizedWriting } from './humanizedWriting';

export type ProfessionalDesignKind =
  | 'gdd'
  | 'system'
  | 'economy'
  | 'level'
  | 'combat'
  | 'narrative'
  | 'ux'
  | 'technical'
  | 'art'
  | 'general';

export interface ProfessionalDesignCheck {
  id: string;
  label: string;
  passed: boolean;
  critical?: boolean;
  discipline?: boolean;
}

export interface ProfessionalDesignAudit {
  kind: ProfessionalDesignKind;
  passed: boolean;
  score: number;
  requiredScore: number;
  checks: ProfessionalDesignCheck[];
  issues: string[];
  naturalnessScore: number;
}

export interface DesignNumericClaim {
  token: string;
  context: string;
}

export interface DesignEvidenceAudit {
  passed: boolean;
  checkedClaimCount: number;
  evidenceClaimCount: number;
  unqualifiedClaims: DesignNumericClaim[];
}

export type DesignReadiness = 'draft' | 'review-ready' | 'implementation-ready';

export interface DesignQualityReport {
  path: string;
  kind: ProfessionalDesignKind;
  readiness: DesignReadiness;
  passed: boolean;
  maturityScore: number;
  naturalnessScore: number;
  characterCount: number;
  analyzedCharacterCount: number;
  analysisScope: 'full' | 'sampled';
  checks: ProfessionalDesignCheck[];
  issues: ProfessionalDesignCheck[];
  strengths: ProfessionalDesignCheck[];
  naturalnessIssues: string[];
  analyzedAt: string;
}

const FULL_GDD_RE = /(?:完整|整体|正式|生产级|专业).{0,16}(?:gdd|游戏设计文档|游戏策划案)|(?:full|complete|production[-\s]ready).{0,12}(?:gdd|game\s+design\s+document)|(?:^|\/)gdd\.md/i;

const DESIGN_KIND_PATTERNS: Array<[ProfessionalDesignKind, RegExp]> = [
  ['economy', /数值|经济|平衡|成长曲线|掉落|概率|伤害公式|economy|balance|formula|drop\s+rate/i],
  ['combat', /战斗|技能|攻击|敌人\s*AI|Boss|打击感|combat|skill|enemy\s+ai/i],
  ['level', /关卡|地图|副本|灰盒|遭遇|动线|level\s+design|map\s+design|greybox|graybox/i],
  ['narrative', /剧情|世界观|角色弧|任务剧情|台词|演出|叙事|narrative|story|dialogue|cutscene/i],
  ['ux', /(?:\bui\b|\bux\b|界面|交互|用户流程|HUD|信息架构|wireframe|accessibility)/i],
  ['technical', /技术|Unity|架构|模块|接口|数据流|编辑器工具|性能|存档|technical|architecture|runtime|editor\s+tool/i],
  ['art', /美术|美工|视觉|原画|建模|贴图|动画|特效|音频资产|art\s+(?:brief|requirement|direction)|asset\s+spec/i],
  ['system', /系统|机制|规则|状态机|资源流|玩法|system\s+design|mechanic|state\s+machine|gameplay/i],
];

function contains(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

export function inferProfessionalDesignKind(source: string): ProfessionalDesignKind {
  const text = String(source || '');
  if (FULL_GDD_RE.test(text)) return 'gdd';
  const lead = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 2).join(' ');
  for (const [kind, pattern] of DESIGN_KIND_PATTERNS) {
    if (pattern.test(lead)) return kind;
  }
  for (const [kind, pattern] of DESIGN_KIND_PATTERNS) {
    if (pattern.test(text)) return kind;
  }
  return 'general';
}

export function getProfessionalDesignGateContract(kind: ProfessionalDesignKind): string[] {
  const shared = [
    'Professional design maturity gate: write as the accountable discipline owner, not as an encyclopedia or brainstorming assistant.',
    'Required reasoning chain: source evidence -> player/production problem -> design decision -> operating rule/state change -> implementation/data/feedback consequence -> failure/edge case -> observable acceptance evidence.',
    'Separate confirmed facts, decisions, assumptions, and open questions. State scope and non-goals. Do not hide uncertainty behind polished prose.',
    'Treat every numeric target as a claim. Reuse numbers only when they appear in inspected project evidence; otherwise label them provisional or assumed and attach a measurement method, tuning owner, acceptance gate, and decision point.',
    'Every substantial requirement needs an owner-facing handoff: dependency, data/config or asset implication, acceptance/QA evidence, risk, and the decision that follows a failed test.',
    'Use natural team prose in the user language. Remove canned transitions, empty claims, marketing language, symmetrical AI lists, and generic conclusions.',
  ];
  const discipline: Record<ProfessionalDesignKind, string> = {
    gdd: 'GDD review: prove the causal core loop, connected time horizons, system topology, resource sinks, progression return, recovery/re-entry, scope, and prototype evidence.',
    system: 'System-design review: define triggers, states, transitions, resources, limits, data fields, cross-system events, interruption/recovery, exploits, and test cases.',
    economy: 'Economy review: define variables and units, formulas and rounding, sources/sinks/caps, worked examples, sensitivity, extreme cases, exploits, telemetry, and tuning ownership.',
    level: 'Level review: define player goal, route and optional choices, encounter beats, greybox metrics, checkpoints/retry, content budget, playtest route, and measurable acceptance.',
    combat: 'Combat review: define inputs, timing windows, targeting, cancel/interrupt/state priority, resource and damage interfaces, feedback stack, enemy response, debug scenario, and feel acceptance.',
    narrative: 'Narrative review: anchor canon, motivation and causality, map beats to quest/dialogue/performance states, define branches/interrupts, assets, implementation dependencies, and continuity QA.',
    ux: 'UX review: define entry and exit, task flow, information hierarchy, complete UI states, input/accessibility, data contract, feedback timing, telemetry, and usability acceptance.',
    technical: 'Technical-design review: define module boundaries, lifecycle and data flow, APIs/events, authoring tools, persistence/migration, performance, errors/recovery, observability, and automated tests.',
    art: 'Art-production review: define deliverable list, visual intent, dimensions/formats, states/variants, naming/export rules, animation/VFX needs, dependencies, budget, review stages, and acceptance references.',
    general: 'General-spec review: define purpose, user outcome, exact behavior, scope, states, implementation implications, edge cases, ownership, and acceptance evidence.',
  };
  return [...shared, discipline[kind]];
}

function disciplineChecks(kind: ProfessionalDesignKind, text: string): ProfessionalDesignCheck[] {
  const check = (id: string, label: string, pattern: RegExp): ProfessionalDesignCheck => ({
    id,
    label,
    passed: contains(pattern, text),
    discipline: true,
  });

  switch (kind) {
    case 'economy':
      return [
        check('economy-model', 'variables, units, formulas, rounding, and a worked example', /变量|单位|公式|取整|演算|样例|variable|unit|formula|rounding|worked\s+example/i),
        check('economy-flow', 'sources, sinks, caps, pacing, and exploit pressure', /来源|产出|消耗|去向|上限|产消|套利|source|sink|cap|pacing|exploit/i),
        check('economy-validation', 'sensitivity/extreme-case analysis, telemetry, and tuning ownership', /敏感性|极端值|通胀|埋点|调参|负责人|sensitivity|extreme|inflation|telemetry|tuning\s+owner/i),
      ];
    case 'combat':
      return [
        check('combat-contract', 'inputs, timing, targeting, cancel/interrupt, and state priority', /输入|前摇|后摇|时序|目标选择|取消|打断|状态优先级|input|timing|targeting|cancel|interrupt|state\s+priority/i),
        check('combat-feedback', 'animation, VFX, SFX, camera, hit feedback, and readability', /动画|特效|VFX|音效|SFX|镜头|命中|打击感|可读性|animation|camera|hit\s+feedback|readability/i),
        check('combat-validation', 'combat debug/test scenarios and feel acceptance', /测试场景|调试|手感验收|帧数据|假人|debug|test\s+scenario|feel\s+acceptance|frame\s+data/i),
      ];
    case 'level':
      return [
        check('level-flow', 'critical/optional routes, encounter beats, and checkpoints', /关键路径|可选路径|动线|遭遇|节拍|检查点|critical\s+path|optional\s+path|encounter|beat|checkpoint/i),
        check('level-metrics', 'greybox dimensions, distance/time baselines, and content budget', /灰盒|尺寸|距离|时长|内容预算|greybox|graybox|dimension|distance|duration|content\s+budget/i),
        check('level-validation', 'a playtest route, observations, and measurable acceptance', /可玩性测试|测试路线|观察|验收路线|playtest|test\s+route|observation|acceptance\s+route/i),
      ];
    case 'narrative':
      return [
        check('narrative-canon', 'canon source, character motivation, conflict, and causal reveal', /正史|依据|角色动机|冲突|因果|揭示|canon|motivation|conflict|causality|reveal/i),
        check('narrative-state', 'quest/dialogue/performance states, branches, and interruption rules', /任务状态|台词意图|演出|分支条件|跳过|中断|quest\s+state|dialogue\s+intent|performance|branch|skip|interrupt/i),
        check('narrative-handoff', 'assets, implementation mapping, continuity review, and QA path', /所需资产|实现任务|映射|连贯性|QA|asset|implementation\s+mapping|continuity|qa\s+path/i),
      ];
    case 'ux':
      return [
        check('ux-flow', 'entry/exit, user task flow, navigation, and information hierarchy', /入口|出口|用户流程|任务流|导航|信息层级|entry|exit|user\s+flow|task\s+flow|navigation|information\s+hierarchy/i),
        check('ux-states', 'complete loading/empty/error/disabled/success states and accessibility', /加载|空状态|错误|禁用|成功|可访问性|loading|empty|error|disabled|success|accessibility/i),
        check('ux-validation', 'UI data contract, telemetry, usability test, and acceptance', /UI\s*数据|数据契约|埋点|可用性测试|验收|data\s+contract|telemetry|usability\s+test|acceptance/i),
      ];
    case 'technical':
      return [
        check('technical-architecture', 'module boundaries, lifecycle, data flow, APIs, and events', /模块|职责边界|生命周期|数据流|接口|事件|module|boundary|lifecycle|data\s+flow|api|event/i),
        check('technical-resilience', 'persistence/migration, performance budget, errors, and recovery', /存档|迁移|性能|内存|错误|恢复|persistence|migration|performance|memory|error|recovery/i),
        check('technical-validation', 'observability, debug tools, automated and performance tests', /可观测|调试工具|自动测试|性能测试|日志|observability|debug\s+tool|automated\s+test|performance\s+test|logging/i),
      ];
    case 'art':
      return [
        check('art-deliverables', 'asset deliverables, dimensions, formats, naming, and export rules', /资产清单|交付物|尺寸|格式|命名|导出|asset\s+list|deliverable|dimension|format|naming|export/i),
        check('art-states', 'states, variants, animation/VFX needs, and visual references', /状态|变体|动画|VFX|特效|参考图|state|variant|animation|visual\s+reference/i),
        check('art-production', 'priority, dependency, budget, review stages, and acceptance reference', /优先级|依赖|预算|评审|验收|priority|dependency|budget|review\s+stage|acceptance\s+reference/i),
      ];
    case 'gdd':
      return [
        check('gdd-loop', 'a causal core loop with reward use, progression return, and re-entry', /核心玩法循环|core\s+(?:gameplay\s+)?loop[\s\S]{0,2000}(?:消耗|转化|spend|transform)[\s\S]{0,1200}(?:重入|re-entry|re-enter)/i),
        check('gdd-horizons', 'moment, session, meta, and long-term experience horizons', /秒级|即时|moment-to-moment[\s\S]{0,1600}(?:会话|单局|session)[\s\S]{0,1600}(?:局外|长期|meta|long-term)/i),
        check('gdd-topology', 'system topology, content burden, scope, and prototype evidence', /系统关系|系统拓扑|system\s+topology[\s\S]{0,2400}(?:内容生产|内容预算|content\s+(?:burden|budget))[\s\S]{0,2400}(?:原型|prototype)/i),
      ];
    case 'system':
      return [
        check('system-states', 'triggers, states/transitions, resources, limits, and interruption', /触发|状态机|状态变化|转换|资源|限制|中断|trigger|state\s+machine|transition|resource|limit|interrupt/i),
        check('system-data', 'configuration fields, persistence, events, and cross-system dependencies', /配置|字段|持久化|事件|跨系统|依赖|config|field|persistence|event|cross-system|dependency/i),
        check('system-validation', 'edge cases, exploits, telemetry, and regression tests', /边界|异常|套利|滥用|埋点|回归|edge|exploit|abuse|telemetry|regression/i),
      ];
    default:
      return [
        check('general-behavior', 'exact behavior, states, and constraints', /行为|规则|状态|约束|behavior|rule|state|constraint/i),
        check('general-handoff', 'implementation or production handoff details', /实现|制作|交付|负责人|依赖|implementation|production|deliverable|owner|dependency/i),
        check('general-validation', 'edge cases and acceptance evidence', /边界|异常|验收|测试|edge|error|acceptance|test/i),
      ];
  }
}

export function auditProfessionalDesignDocument(
  markdown: string,
  kind: ProfessionalDesignKind,
  revision = false,
): ProfessionalDesignAudit {
  const text = String(markdown || '').trim();
  const checks: ProfessionalDesignCheck[] = [
    {
      id: 'intent-value',
      label: 'design intent plus a concrete player/user or production outcome',
      passed: contains(/设计意图|设计目标|玩家目标|用户目标|玩家价值|体验目标|制作目标|design\s+intent|design\s+goal|player\s+goal|user\s+goal|player\s+value|production\s+goal|purpose/i, text),
      critical: true,
    },
    {
      id: 'evidence-status',
      label: 'source evidence separated from decisions, assumptions, and open questions',
      passed: contains(/依据|来源|已确认|设计决策|假设|开放问题|evidence|source|confirmed|design\s+decision|assumption|open\s+question/i, text),
    },
    {
      id: 'scope',
      label: 'scope, non-goals/out-of-scope items, and milestone boundary',
      passed: contains(/范围|非目标|不包含|暂缓|里程碑|scope|non[-\s]?goal|out\s+of\s+scope|defer|milestone/i, text),
    },
    {
      id: 'operating-model',
      label: 'trigger/input, meaningful decision or requirement, rule/state change, and output',
      passed: contains(/触发|输入|条件|玩家(?:选择|行动)|规则|状态变化|输出|trigger|input|condition|player\s+(?:choice|action)|rule|state\s+change|output/i, text),
      critical: true,
    },
    {
      id: 'feedback-states',
      label: 'player-facing feedback and relevant UI/content states',
      passed: contains(/反馈|界面状态|UI|动画|VFX|SFX|提示|feedback|ui\s+state|animation|prompt/i, text),
    },
    {
      id: 'production-contract',
      label: 'data/config or asset implications, dependencies, and ownership',
      passed: contains(/数据|配置|字段|资产|依赖|负责人|所有者|data|config|field|asset|dependency|owner/i, text),
    },
    {
      id: 'failure-edge',
      label: 'failure, interruption, recovery, exploit, and edge-case handling',
      passed: contains(/失败|异常|边界|中断|恢复|套利|滥用|failure|error|edge|interrupt|recovery|exploit|abuse/i, text),
    },
    {
      id: 'validation',
      label: 'prototype/test method, QA, telemetry, and observable acceptance criteria',
      passed: contains(/原型|测试|QA|埋点|验收|通过条件|prototype|test|telemetry|acceptance|pass\s+criteria/i, text),
      critical: true,
    },
    {
      id: 'tradeoff-risk',
      label: 'risks, tradeoffs or alternatives, and a decision response',
      passed: contains(/风险|取舍|替代方案|更简单方案|否决|继续条件|risk|trade[-\s]?off|alternative|simpler\s+option|reject|continue\s+criteria/i, text),
    },
    {
      id: 'traceability',
      label: 'traceability from goal to rule/content, implementation owner, and evidence',
      passed: contains(/可追溯|追溯矩阵|目标.{0,20}(?:规则|内容).{0,30}(?:负责人|验收)|traceability|goal.{0,30}(?:rule|content).{0,40}(?:owner|acceptance)/i, text),
    },
    {
      id: 'revision-ledger',
      label: revision
        ? 'an Added/Changed/Removed/Deferred decision ledger and schedule impact'
        : 'a concrete next decision or owner-ready handoff',
      passed: revision
        ? contains(/新增|修改|移除|暂缓|Added|Changed|Removed|Deferred/i, text) && contains(/工期影响|排期影响|schedule\s+impact/i, text)
        : contains(/下一步|待决策|负责人|交付|next\s+(?:step|decision)|owner|handoff|deliverable/i, text),
    },
    ...disciplineChecks(kind, text),
  ];

  const humanized = auditHumanizedWriting(text, 68);
  checks.push({
    id: 'natural-author-voice',
    label: 'natural discipline-owner prose without severe Chinese/English AI-writing signals',
    passed: humanized.passed,
  });

  const score = checks.filter((check) => check.passed).length;
  const requiredScore = Math.ceil(checks.length * 0.72);
  const criticalPassed = checks.filter((check) => check.critical).every((check) => check.passed);
  const disciplinePassed = checks.filter((check) => check.discipline && check.passed).length >= 2;
  const issues = checks.filter((check) => !check.passed).map((check) => check.label);
  return {
    kind,
    passed: text.length >= 520 && criticalPassed && disciplinePassed && score >= requiredScore,
    score,
    requiredScore,
    checks,
    issues,
    naturalnessScore: humanized.score,
  };
}

export function buildDesignQualityReport(
  filePath: string,
  markdown: string,
  options: { totalCharacterCount?: number; sampled?: boolean } = {},
): DesignQualityReport {
  const text = String(markdown || '');
  const kind = inferProfessionalDesignKind(`${filePath || ''}\n${text.slice(0, 12000)}`);
  const audit = auditProfessionalDesignDocument(text, kind);
  const naturalness = auditHumanizedWriting(text, 78);
  const criticalFailures = audit.checks.filter((check) => check.critical && !check.passed).length;
  const disciplinePasses = audit.checks.filter((check) => check.discipline && check.passed).length;
  const maturityScore = audit.checks.length > 0
    ? Math.round((audit.score / audit.checks.length) * 100)
    : 0;
  const readiness: DesignReadiness = audit.passed
    ? 'implementation-ready'
    : maturityScore >= 58 && criticalFailures <= 1 && disciplinePasses >= 1
      ? 'review-ready'
      : 'draft';
  const issues = audit.checks
    .filter((check) => !check.passed)
    .sort((left, right) => Number(Boolean(right.critical)) - Number(Boolean(left.critical))
      || Number(Boolean(right.discipline)) - Number(Boolean(left.discipline)));
  const strengths = audit.checks
    .filter((check) => check.passed)
    .sort((left, right) => Number(Boolean(right.critical)) - Number(Boolean(left.critical))
      || Number(Boolean(right.discipline)) - Number(Boolean(left.discipline)));
  const sampled = Boolean(options.sampled);
  return {
    path: String(filePath || ''),
    kind,
    readiness,
    passed: !sampled && audit.passed,
    maturityScore,
    naturalnessScore: naturalness.score,
    characterCount: Math.max(text.length, Number(options.totalCharacterCount || 0)),
    analyzedCharacterCount: text.length,
    analysisScope: sampled ? 'sampled' : 'full',
    checks: audit.checks,
    issues,
    strengths,
    naturalnessIssues: naturalness.issues,
    analyzedAt: new Date().toISOString(),
  };
}

function normalizeNumericToken(value: string): string {
  return value.replace(/\s+/g, '').replace(/，/g, ',').toLowerCase();
}

function extractDesignNumericClaims(markdown: string): DesignNumericClaim[] {
  const withoutProtectedSyntax = String(markdown || '')
    .replace(/^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ' ')
    .replace(/(?:```+|~~~+)[^\n]*\r?\n[\s\S]*?(?:```+|~~~+)/g, ' ')
    .replace(/`[^`\r\n]+`/g, ' ')
    .replace(/\[\[[^\]]+\]\]/g, ' ')
    .replace(/!?\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/https?:\/\/[^\s)>\]}]+/g, ' ')
    .replace(/\b[A-Z][A-Z0-9]{1,11}-\d{1,7}\b/g, ' ')
    .replace(/\bv?\d+(?:\.\d+){2,}\b/gi, ' ')
    .replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, ' ')
    .replace(/\d{4}年\d{1,2}月\d{1,2}日/g, ' ');
  const claims: DesignNumericClaim[] = [];
  const pattern = /(?:^|[^\p{L}\p{N}_])([-+]?\d+(?:,\d{3})*(?:\.\d+)?(?:\s*(?:%|％|px|ms|fps|hz|kb|mb|gb|tb|b|s|min|h|d|秒|分钟|小时|天|帧|级|个|次|元|米|厘米|毫米))?)/giu;

  for (const rawLine of withoutProtectedSyntax.split(/\r?\n/)) {
    const line = rawLine
      .replace(/^\s{0,3}#{1,6}\s+\d+(?:\.\d+)*(?:[.)、])?\s*/, '')
      .replace(/^\s*\d+[.)、]\s+/, '')
      .replace(/^\s*\|\s*\d+\s*\|/, '| # |');
    for (const match of line.matchAll(pattern)) {
      const token = normalizeNumericToken(match[1]);
      if (!token) continue;
      const start = Math.max(0, (match.index || 0) - 80);
      const end = Math.min(line.length, (match.index || 0) + match[0].length + 120);
      claims.push({ token, context: line.slice(start, end).trim() });
    }
  }
  return claims;
}

const QUALIFIED_NUMERIC_CLAIM_RE = /(?:假设|暂定|占位|待验证|待测试|原型参数|测试参数|初始建议|建议初值|演算示例|示例值|调参起点|测量后调整|以实测为准|assumption|assumed|provisional|placeholder|to validate|to test|prototype value|test value|worked example|tuning baseline|measure before locking)/i;

export function auditDesignEvidenceClaims(markdown: string, evidenceTexts: string[] = []): DesignEvidenceAudit {
  const claims = extractDesignNumericClaims(markdown);
  const evidenceTokens = new Set(evidenceTexts.flatMap((text) => extractDesignNumericClaims(text).map((claim) => claim.token)));
  const unqualified = new Map<string, DesignNumericClaim>();
  for (const claim of claims) {
    if (evidenceTokens.has(claim.token) || QUALIFIED_NUMERIC_CLAIM_RE.test(claim.context)) continue;
    if (!unqualified.has(claim.token)) unqualified.set(claim.token, claim);
  }
  return {
    passed: unqualified.size === 0,
    checkedClaimCount: claims.length,
    evidenceClaimCount: evidenceTokens.size,
    unqualifiedClaims: Array.from(unqualified.values()),
  };
}

export function formatDesignEvidenceGateFailure(audit: DesignEvidenceAudit): string {
  const examples = audit.unqualifiedClaims.slice(0, 8).map((claim) => `${claim.token} in “${claim.context.slice(0, 110)}”`);
  return [
    `Design evidence gate blocked ${audit.unqualifiedClaims.length} unsupported numeric claim(s).`,
    `Unsupported: ${examples.join('; ') || 'numeric targets without source evidence'}.`,
    'Do not present invented numbers as approved facts. Either restore a value found in the inspected project evidence, or label the new value explicitly as provisional/assumed/prototype-only and add how it will be measured, tuned, accepted, and owned.',
  ].join(' ');
}

export function formatProfessionalDesignGateFailure(audit: ProfessionalDesignAudit): string {
  return [
    `Professional ${audit.kind} design quality gate blocked this write (${audit.score}/${audit.checks.length}; required ${audit.requiredScore}, all critical checks, and two discipline checks).`,
    `Missing: ${audit.issues.join('; ') || 'sufficient production detail'}.`,
    'Rewrite the same target as an accountable senior designer. Start from evidence and the player/production problem, make explicit decisions and operating rules, then carry each decision through data/assets, dependencies, failure cases, QA/telemetry, acceptance evidence, owner, and next decision.',
    `Naturalness score: ${audit.naturalnessScore}/100. Prefer direct team-authored prose over polished generic filler.`,
  ].join(' ');
}
