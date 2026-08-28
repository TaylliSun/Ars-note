export type GameDesignDisciplineId =
  | 'lead'
  | 'system'
  | 'economy'
  | 'level'
  | 'combat'
  | 'narrative'
  | 'technical'
  | 'ux'
  | 'liveops';

export interface GameDesignSpecialistDefinition {
  id: GameDesignDisciplineId;
  label: string;
  mission: string;
  evidencePaths: string[];
  outputContract: string[];
  signals: Array<{ pattern: RegExp; weight: number; reason: string }>;
  defaultReviewers: GameDesignDisciplineId[];
}

export interface GameDesignSpecialistRoute {
  primary: GameDesignSpecialistDefinition;
  reviewers: GameDesignSpecialistDefinition[];
  matchedReasons: string[];
  requestedArtifact: 'new-design' | 'design-review' | 'design-repair' | 'design-breakdown';
}

const PLANNING_INTENT_RE = /策划|设计案|策划案|需求文档|玩法|机制|系统|数值|平衡|经济|成长|关卡|战斗|技能|剧情|世界观|任务(?:设计|策划|系统|表|流程|链)|台词|演出|cutscene|unity|技术方案|架构|编辑器|工具链|\bui\b|\bux\b|交互|商业化|付费|活动设计|留存|gdd|game\s*design|system\s*design|level\s*design|combat\s*design|technical\s*design|economy|balance|progression|quest|narrative|live\s*ops/i;

const CORE_LOOP_INTENT_RE = /核心(?:玩法|体验)?循环|游戏(?:玩法)?循环|玩法闭环|行为闭环|秒级循环|局内循环|单局循环|会话循环|局外循环|成长循环|长期循环|core\s*(?:gameplay\s*)?loop|gameplay\s*loop|moment[-\s]to[-\s]moment|session\s*loop|meta\s*loop|progression\s*loop/i;
const FULL_GDD_INTENT_RE = /(?:完整|整体|全局|正式|生产级|专业).{0,16}(?:gdd|游戏设计文档|游戏策划案)|(?:写|生成|创建|完善|更新|修订|重构).{0,20}(?:gdd|游戏设计文档|游戏策划案)|(?:full|complete|production[-\s]ready).{0,12}(?:gdd|game\s+design\s+document)/i;
const GDD_PATH_RE = /(?:^|\/)(?:gdd|newgdd|game[-_ ]?design(?:spec|document)?|[^/]*[_-]gdd)\.md$/i;

export const GAME_DESIGN_SPECIALISTS: GameDesignSpecialistDefinition[] = [
  {
    id: 'lead',
    label: '主策划 / 设计负责人',
    mission: '统一产品目标、玩家体验、范围、优先级和跨岗位依赖，负责最终设计取舍。',
    evidencePaths: ['01_GDD/', '07_Unity_Tasks/', '.ars-team/'],
    outputContract: [
      '产品支柱、目标玩家、体验目标、范围与非目标',
      '核心循环、系统关系、里程碑、依赖与风险排序',
      '设计决策记录，以及系统/数值/内容/技术之间的冲突取舍',
      '按岗位拆分的交付物、负责人、预估、验收和复查入口',
    ],
    signals: [
      { pattern: /主策划|制作人|整体|全局|完整\s*gdd|总案|产品支柱|跨系统|里程碑|项目规划|总体策划/i, weight: 6, reason: '涉及整体设计或跨岗位统筹' },
      { pattern: /策划案|设计案|gdd|项目方案/i, weight: 2, reason: '请求通用策划交付物' },
    ],
    defaultReviewers: ['system', 'technical'],
  },
  {
    id: 'system',
    label: '系统策划',
    mission: '把玩家目标转化为可实现、可配置、可验证的规则系统。',
    evidencePaths: ['01_GDD/', '05_Items/', '06_Quests/', '07_Unity_Tasks/'],
    outputContract: [
      '玩家承诺、核心动词，以及秒级操作、单局/任务、会话、局外成长和长期目标之间的循环层级',
      '每个循环步骤的玩家意图、输入、规则、反馈、奖励/成本、关键选择和回到下一轮的条件',
      '资源来源/转化/储存/消耗、解锁、失败、回退、中断、异常与防滥用规则',
      '配置字段、默认值、枚举、持久化和跨系统事件',
      'UI 反馈、埋点、验收用例和边界回归清单',
    ],
    signals: [
      { pattern: CORE_LOOP_INTENT_RE, weight: 10, reason: '请求设计跨时间尺度的核心玩法循环' },
      { pattern: /系统策划|系统设计|玩法系统|功能系统|状态机|规则|解锁|背包|养成|建造|合成|采集|交互机制/i, weight: 6, reason: '包含系统规则或玩法循环' },
      { pattern: /机制|玩法|资源流|冷却|触发|条件|限制/i, weight: 3, reason: '需要规则和状态定义' },
    ],
    defaultReviewers: ['economy', 'technical'],
  },
  {
    id: 'economy',
    label: '数值 / 经济策划',
    mission: '建立可计算、可调参、可验证的成长、产消和难度模型。',
    evidencePaths: ['01_GDD/', '05_Items/', '06_Quests/', '07_Unity_Tasks/'],
    outputContract: [
      '变量、单位、基线假设、公式、取整规则和至少一组演算样例',
      '来源/消耗、产出速率、库存上限、成长曲线、软硬上限和追赶机制',
      '关键参数的敏感性、极端值、通胀/套利/最优解风险',
      '目标区间、埋点口径、模拟方案、调参表和版本平衡验收线',
    ],
    signals: [
      { pattern: /数值策划|数值设计|经济系统|平衡|成长曲线|伤害公式|收益|概率|掉落|产出|消耗|通胀|定价|货币/i, weight: 7, reason: '包含数值模型、经济或平衡问题' },
      { pattern: /公式|倍率|百分比|概率|上限|下限|速率|曲线|权重|期望值/i, weight: 4, reason: '需要量化模型和演算' },
    ],
    defaultReviewers: ['system', 'technical'],
  },
  {
    id: 'level',
    label: '关卡策划',
    mission: '把目标体验转化为可灰盒、可迭代、节奏清晰的空间和遭遇流程。',
    evidencePaths: ['01_GDD/', '04_Maps/', '06_Quests/', '07_Unity_Tasks/'],
    outputContract: [
      '关卡目标、关键路径、可选路径、空间分区、节奏曲线和体验节拍',
      '出生点、触发器、遭遇、资源点、引导、检查点、失败与重试规则',
      '灰盒尺寸、距离/时长基线、内容预算、难度变量和动态调整点',
      '关卡数据表、所需资产、性能预算、可玩性测试和验收路线',
    ],
    signals: [
      { pattern: /关卡策划|关卡设计|地图设计|副本|场景布局|路线|动线|灰盒|遭遇|检查点|出生点|刷怪|boss房/i, weight: 7, reason: '涉及关卡空间、流程或遭遇设计' },
      { pattern: /节奏|探索|路径|区域|地形|触发器|重试/i, weight: 3, reason: '需要关卡节拍和空间规则' },
    ],
    defaultReviewers: ['system', 'technical'],
  },
  {
    id: 'combat',
    label: '战斗策划',
    mission: '定义操作、技能、敌人、反馈与战斗节奏，使策略和手感可实现、可调试。',
    evidencePaths: ['01_GDD/', '03_Characters/', '05_Items/', '07_Unity_Tasks/'],
    outputContract: [
      '玩家战斗动词、输入、目标选择、取消/打断、无敌/硬直和状态优先级',
      '技能与敌人行为表：时序、范围、命中、资源、冷却、伤害和异常状态',
      '反馈分层：动画、镜头、VFX、SFX、UI、命中停顿和可读性',
      '战斗数值接口、AI 状态、调试工具、测试场景和手感验收标准',
    ],
    signals: [
      { pattern: /战斗策划|战斗系统|技能|攻击|连招|敌人ai|boss|打击感|硬直|闪避|格挡|仇恨|命中/i, weight: 7, reason: '涉及战斗动作、技能或敌人行为' },
      { pattern: /伤害|冷却|帧|前摇|后摇|范围|状态效果|控制效果/i, weight: 4, reason: '需要战斗时序或数值接口' },
    ],
    defaultReviewers: ['economy', 'technical'],
  },
  {
    id: 'narrative',
    label: '剧情 / 文案策划',
    mission: '维护世界观与角色一致性，并把剧情转换为任务、台词、演出和实现状态。',
    evidencePaths: ['01_GDD/', '02_Worldbuilding/', '03_Characters/', '06_Quests/', '07_Unity_Tasks/'],
    outputContract: [
      '正史依据、世界规则、角色动机、冲突、因果、信息揭示和情绪曲线',
      '剧情节点到任务状态、分支条件、台词意图、演出节拍的映射',
      '角色语气、潜台词、本地化变量、跳过/中断/重复触发规则',
      '所需资产、实现任务、连贯性审查、QA 路径和正史变更影响',
    ],
    signals: [
      { pattern: /剧情策划|文案策划|世界观|剧情|故事|角色弧光|台词|对话|演出|过场|任务剧情|叙事/i, weight: 7, reason: '涉及世界观、剧情、台词或演出' },
      { pattern: /人物动机|分支|伏笔|章节|情绪曲线|正史|canon|quest|dialogue|cutscene/i, weight: 4, reason: '需要叙事一致性和状态映射' },
    ],
    defaultReviewers: ['system', 'technical'],
  },
  {
    id: 'technical',
    label: '技术策划',
    mission: '把策划需求翻译成 Unity 运行时、数据、编辑器工具和调试链路。',
    evidencePaths: ['01_GDD/', '07_Unity_Tasks/', '10_SystemDesign/'],
    outputContract: [
      '运行时模块、职责边界、数据流、事件/API、生命周期和依赖图',
      '配置结构、编辑器工具、批量生产、校验器、版本迁移和回滚方案',
      '存档/同步影响、性能/内存预算、异步与错误恢复、调试可观测性',
      '实现拆分、伪代码或接口草案、自动测试、性能测试和技术验收标准',
    ],
    signals: [
      { pattern: /技术策划|技术方案|unity|架构|模块|接口|api|事件总线|数据结构|编辑器|工具链|配置表|存档|序列化|性能|内存|调试/i, weight: 7, reason: '涉及 Unity 实现、工具或技术约束' },
      { pattern: /程序|实现|运行时|组件|prefab|scriptableobject|addressables|迁移|兼容/i, weight: 4, reason: '需要工程落地和数据管线' },
    ],
    defaultReviewers: ['system', 'lead'],
  },
  {
    id: 'ux',
    label: 'UI / UX 策划',
    mission: '把规则和信息转化为清晰、低成本、具备完整状态反馈的玩家流程。',
    evidencePaths: ['01_GDD/', '07_Unity_Tasks/', '10_SystemDesign/'],
    outputContract: [
      '用户目标、入口、任务流、信息层级、组件和导航结构',
      '默认/悬停/选中/禁用/加载/空/错误/成功等完整状态',
      '输入方式、快捷操作、可访问性、文案、反馈和打断恢复',
      'UI 数据契约、埋点、原型验收、分辨率适配和边界测试',
    ],
    signals: [
      { pattern: /ui策划|ux|交互设计|界面需求|用户流程|信息架构|hud|菜单|面板|弹窗|引导|可访问性/i, weight: 7, reason: '涉及界面、信息或交互流程' },
      { pattern: /点击|拖拽|筛选|状态反馈|空状态|错误状态|导航/i, weight: 3, reason: '需要交互状态和反馈定义' },
    ],
    defaultReviewers: ['system', 'technical'],
  },
  {
    id: 'liveops',
    label: '商业化 / 运营策划',
    mission: '设计长期目标、内容节奏和商业模型，同时保护体验、公平性与经济健康。',
    evidencePaths: ['01_GDD/', '05_Items/', '06_Quests/', '07_Unity_Tasks/'],
    outputContract: [
      '用户分层、生命周期目标、活动循环、内容日历和奖励节奏',
      '商品/礼包/通行证/广告或活动规则、价格锚点、限制与补偿',
      '经济影响、公平性、疲劳、付费压力、法规与未成年人风险',
      '核心指标、实验分组、护栏指标、停止条件和运营复盘模板',
    ],
    signals: [
      { pattern: /商业化策划|运营策划|付费|商城|礼包|通行证|广告|活动|签到|留存|召回|赛季|liveops|monetization/i, weight: 7, reason: '涉及运营节奏或商业模型' },
      { pattern: /arpu|ltv|转化率|留存率|日活|月活|用户分层|a\/b/i, weight: 4, reason: '需要指标、实验和商业护栏' },
    ],
    defaultReviewers: ['economy', 'lead'],
  },
];

const SPECIALIST_BY_ID = new Map(GAME_DESIGN_SPECIALISTS.map((specialist) => [specialist.id, specialist]));

function detectRequestedArtifact(prompt: string): GameDesignSpecialistRoute['requestedArtifact'] {
  if (/检查|审查|评审|review|audit|找问题|风险/i.test(prompt)) return 'design-review';
  if (/修复|补全|完善|整理|重构|改进|repair|improve|rewrite/i.test(prompt)) return 'design-repair';
  if (/拆分|任务表|排期|落地|分工|breakdown|implementation\s*tasks/i.test(prompt)) return 'design-breakdown';
  return 'new-design';
}

export function routeGameDesignSpecialists(input: {
  prompt: string;
  currentFilePath?: string;
}): GameDesignSpecialistRoute | null {
  const prompt = String(input.prompt || '').trim();
  const currentFilePath = String(input.currentFilePath || '');
  const source = `${prompt}\n${currentFilePath}`;
  if (!PLANNING_INTENT_RE.test(source)) return null;
  const isCoreLoopRequest = CORE_LOOP_INTENT_RE.test(source);

  const scored = GAME_DESIGN_SPECIALISTS.map((specialist) => {
    let score = 0;
    const reasons: string[] = [];
    for (const signal of specialist.signals) {
      if (!signal.pattern.test(source)) continue;
      score += signal.weight;
      reasons.push(signal.reason);
    }
    if (specialist.id === 'narrative' && /02_Worldbuilding|03_Characters|06_Quests/i.test(currentFilePath)) score += 3;
    if (specialist.id === 'level' && /04_Maps/i.test(currentFilePath)) score += 4;
    if (specialist.id === 'technical' && /07_Unity_Tasks|10_SystemDesign/i.test(currentFilePath)) score += 4;
    if (specialist.id === 'system' && /01_GDD/i.test(currentFilePath)) score += 2;
    if (isCoreLoopRequest && specialist.id === 'system') {
      score += 6;
      reasons.push('核心循环由系统策划负责闭环规则和层级关系');
    }
    if (isCoreLoopRequest && specialist.id === 'economy') {
      score += 4;
      reasons.push('核心循环需要校验奖励、产消和成长回流');
    }
    if (isCoreLoopRequest && specialist.id === 'ux') {
      score += 4;
      reasons.push('核心循环需要校验反馈、决策可读性和重入成本');
    }
    return { specialist, score, reasons };
  }).sort((a, b) => b.score - a.score);

  const top = scored[0];
  const primary = top.score > 0 ? top.specialist : SPECIALIST_BY_ID.get('lead')!;
  const reviewers: GameDesignSpecialistDefinition[] = [];
  const reviewerIds = new Set<GameDesignDisciplineId>();
  for (const item of scored) {
    if (item.specialist.id === primary.id || item.score < 3 || reviewers.length >= 2) continue;
    reviewers.push(item.specialist);
    reviewerIds.add(item.specialist.id);
  }
  for (const reviewerId of primary.defaultReviewers) {
    if (reviewers.length >= 2 || reviewerId === primary.id || reviewerIds.has(reviewerId)) continue;
    const reviewer = SPECIALIST_BY_ID.get(reviewerId);
    if (reviewer) reviewers.push(reviewer);
  }

  const matchedReasons = scored
    .filter((item) => item.score > 0)
    .flatMap((item) => item.reasons.map((reason) => `${item.specialist.label}：${reason}`))
    .slice(0, 5);

  return {
    primary,
    reviewers,
    matchedReasons: matchedReasons.length ? matchedReasons : ['通用策划请求，由主策划负责统筹。'],
    requestedArtifact: detectRequestedArtifact(prompt),
  };
}

export function buildGameDesignSpecialistBrief(input: {
  prompt: string;
  currentFilePath?: string;
}): string {
  const route = routeGameDesignSpecialists(input);
  if (!route) return '';

  const evidencePaths = Array.from(new Set([
    ...route.primary.evidencePaths,
    ...route.reviewers.flatMap((reviewer) => reviewer.evidencePaths),
  ])).slice(0, 8);
  const source = `${input.prompt}\n${input.currentFilePath || ''}`;
  const fullGddProtocol = (FULL_GDD_INTENT_RE.test(source) || GDD_PATH_RE.test(String(input.currentFilePath || '').replace(/\\/g, '/')))
    ? [
        'Full GDD causal architecture protocol:',
        '- Build one causal spine before drafting sections: target player + player promise -> immediate goal -> meaningful choice/action -> rule resolution -> readable feedback -> reward/cost -> spend/transform -> progression/unlock -> changed next decision -> explicit re-entry.',
        '- A core loop is a closed state transition, not a feature category. Combat, collection, construction, exploration, dialogue, or management may be one action/subsystem, but none is the complete loop unless its output changes progression and creates the reason and decision for the next run.',
        '- Organize the GDD in dependency order: design thesis and non-goals -> experience horizons -> canonical core loop -> meta/progression and economy -> system topology -> content/challenge progression -> failure/recovery -> UX/feedback -> production/technology -> validation and decision ledger.',
        '- Connect moment-to-moment, encounter/task, session, meta/progression, and long-term mastery. Explicitly state what each horizon consumes, what it outputs, and how that output changes the horizon below when the player returns.',
        '- Every major system section must state: role in the core loop, player goal, inputs, meaningful decisions, rules/state changes, outputs, dependencies, feedback, failure/recovery, tuning owner, and acceptance evidence. Delete or defer systems that cannot justify a loop role.',
        '- Add a system-topology table and a traceability table so readers can follow player value -> loop step -> supporting system -> resource/data -> UI feedback -> content/engineering owner -> validation evidence.',
        '- Before writing, run a logic audit. Reject the draft if rewards have no sink, progression does not change later decisions, failure has no recovery/re-entry, section claims contradict the causal spine, or the document reads as an inventory of unrelated features.',
      ]
    : [];
  const coreLoopProtocol = CORE_LOOP_INTENT_RE.test(source)
    ? [
        'Core loop design protocol:',
        '- Start with the player promise, target emotion, play context, core verbs, and meaningful decisions. A feature list is not a loop.',
        '- Model at least four connected horizons: moment-to-moment (seconds), encounter/task (minutes), session, and meta/long-term progression. State how the output of each horizon becomes the input or motivation for the next.',
        '- For every step specify: player intent -> input/action -> system rule/state change -> immediate feedback -> reward/cost -> decision -> re-entry condition. Reject any dead end, reward without a new decision, or progression that bypasses the core verbs.',
        '- Map resource sources, transformations, storage/caps, sinks, gates, reset points, failure/recovery, interruption/resume, catch-up, and exploit pressure.',
        '- Show early/mid/late variants and the content-production burden. Repetition must gain new decisions, mastery, expression, or stakes rather than only larger numbers.',
        '- Define a smallest playable loop prototype, observation plan, telemetry events, success/failure interpretation, and the design decision each result will trigger. Do not invent target metrics without project evidence.',
        '- Treat retention as sustained player value and clear goals; flag compulsion, fatigue, pay pressure, or dark-pattern risks instead of optimizing them silently.',
      ]
    : [];

  return [
    '=== Professional Game Design Studio Brief ===',
    `Work type: ${route.requestedArtifact}`,
    `Primary specialist: ${route.primary.label}`,
    `Primary responsibility: ${route.primary.mission}`,
    `Review specialists: ${route.reviewers.map((reviewer) => reviewer.label).join(' + ') || '主策划自审'}`,
    `Routing evidence: ${route.matchedReasons.join('；')}`,
    `Inspect first: ${evidencePaths.join(', ')}`,
    'Primary output contract:',
    ...route.primary.outputContract.map((item) => `- ${item}`),
    'Cross-review contract:',
    ...route.reviewers.map((reviewer) => `- ${reviewer.label}: verify ${reviewer.outputContract.slice(0, 2).join('；')}`),
    'Decision discipline:',
    '- Separate confirmed project facts, design decisions, assumptions, and open questions. Never present assumptions as canon.',
    '- Include a traceability matrix for substantial specs: design goal -> rule/content -> data/config -> UI/feedback -> implementation owner -> acceptance/telemetry.',
    '- Use numbers with units, baselines, formulas, examples, ranges, caps, and tuning ownership whenever the design is quantitative.',
    '- Run contradiction, exploit, edge-case, failure/recovery, save/migration, performance, accessibility, localization, and QA checks where relevant.',
    '- Convert approved design into discipline-tagged tasks with dependency, estimate, linked document, acceptance, QA/retest, and status. Do not write team schedule tasks unless the user asked to create/assign/take over work.',
    '- Write in the voice of the accountable primary specialist. Lead with decisions and evidence, vary paragraph rhythm, and remove canned Chinese/English transitions, inflated claims, consultant language, and generic summaries.',
    '- Do not use polished prose to hide a missing rule. Replace “improves the experience” with the exact player behavior, state change, production requirement, or observation that supports the claim.',
    ...fullGddProtocol,
    ...coreLoopProtocol,
    'Completion gate:',
    '- Do not claim quality scores such as 100/100. Report Passed, Needs review, or Blocked for each applicable gate and name the exact unresolved evidence.',
  ].join('\n');
}

export function buildGameDesignGovernanceBrief(input: {
  prompt: string;
  currentFilePath?: string;
}): string {
  const route = routeGameDesignSpecialists(input);
  if (!route) return '';

  const source = `${input.prompt}\n${input.currentFilePath || ''}`;
  const revision = route.requestedArtifact === 'design-repair';
  const reviewOnly = route.requestedArtifact === 'design-review';
  const wholeProject = /整体|全局|完整\s*gdd|总案|全项目|全部策划|所有策划|whole\s+project|full\s+gdd/i.test(source);
  const target = input.currentFilePath?.trim() || '(discover the existing canonical document before choosing a path)';

  return [
    '=== Lead Designer Scope & Version Governance ===',
    `Work posture: ${reviewOnly ? 'critique before mutation' : revision ? 'convergent revision' : 'bounded design proposal'}`,
    `Canonical target: ${target}`,
    'Single-source-of-truth rules:',
    `- ${revision ? 'Update the inspected canonical document in place.' : 'Prefer an existing canonical document; create at most one new primary design document only when no suitable source exists or the user explicitly asks for one.'}`,
    '- Do not create v2/v3, final, new, optimized, rewritten, copy, duplicate, dated, or companion variants of a design document unless the user explicitly requests a historical branch.',
    '- Keep one approved rule in one authoritative location. Other documents should link to it and contain only their discipline-specific consequences, not copied competing definitions.',
    '- Treat chat drafts, merge files, visual summaries, and recovered copies as evidence, never as a second source of truth.',
    'Diagnosis before expansion:',
    '- Identify the player or production problem, current evidence, affected core-loop link, contradictions, and the smallest decision that resolves it.',
    '- Report weaknesses first, ordered by severity: finding -> evidence -> player/production consequence -> recommended decision. Do not praise by default and do not hide uncertainty.',
    '- Separate confirmed canon, approved decisions, assumptions, rejected options, deferred ideas, and open questions.',
    'Innovation test:',
    '- Innovation means a stronger player decision, interaction, expression, emotional payoff, or production method, not a larger feature count.',
    '- For each proposed innovation state: player value, differentiator, fit with product pillars/core loop, implementation/content cost, main risk, cheapest prototype, and kill/continue evidence.',
    '- Compare at least two materially different options for a major decision, including the option to simplify or remove it. Recommend one and explain the tradeoff.',
    'Scope and schedule gate:',
    `- Work inside ${wholeProject ? 'an explicit whole-project scope budget' : 'the current feature or milestone boundary'}; define In scope, Non-goals, Deferred, and Removed before adding detail.`,
    '- Classify every requested or discovered addition as Required now, Replace existing, Defer, or Reject. Optional ideas go to a short parking-lot list, not into the committed design.',
    '- A new system, content family, platform, mode, resource, narrative branch, or tool may enter committed scope only with owner, estimate, dependency, acceptance test, and schedule impact.',
    '- No silent scope growth: an addition must replace/remove comparable work, fit the stated reserve, or be marked Blocked pending an explicit milestone change.',
    '- Prefer the smallest playable/testable slice. Cap recommendations to the few decisions that materially improve the current milestone.',
    'Required decision ledger for substantial work:',
    '- Added | Changed | Removed | Deferred | Rejected.',
    '- Net scope: smaller / unchanged / larger. Schedule impact: reduced / neutral / +N person-days or unknown-blocked.',
    '- Affected canonical documents, systems, data, UI, engineering, content, QA, migration, owner, and acceptance evidence.',
    'Completion gate:',
    '- A design is not complete because it is long. It is ready only when the core decision is coherent, scope is bounded, dependencies and acceptance are explicit, and unresolved items cannot silently expand the milestone.',
    '- If critical evidence, schedule budget, or authority is missing, return Needs review or Blocked with one concrete decision request instead of inventing more design.',
  ].join('\n');
}

export const GAME_DESIGN_SPECIALIST_SYSTEM_PROMPT = `

Professional Game Design Studio Protocol

For game-planning work, follow the Professional Game Design Studio Brief supplied with the user request.
- Use one primary specialist as the decision owner and at most two review specialists. Do not blend every discipline into generic filler.
- Inspect project evidence before changing an existing design. Preserve canon and existing production decisions unless the user asks for a redesign.
- Write for implementation and review, not for inspiration alone. Every major decision needs behavior, data/config, feedback, owner, acceptance, and risk implications.
- Mark confirmed facts, decisions, assumptions, and open questions separately.
- For core-loop work, prove the re-entry link between moment-to-moment play, session goals, progression, and long-term motivation. A list of systems or rewards is not a loop.
- For a full GDD, build and preserve one causal spine across every section. Combat is never accepted as the whole core loop merely because it is the most detailed subsystem.
- Audit reward destinations, resource sinks, progression effects, changed next-run decisions, failure recovery, and explicit re-entry before writing the canonical GDD.
- For revisions, include a concise change-impact section covering affected documents, systems, data, UI, engineering, content, QA, schedule, and migration.
- For professional documents, finish with discipline review gates and concrete next tasks. Do not invent a numeric quality score.
`;

export const GAME_DESIGN_GOVERNANCE_SYSTEM_PROMPT = `

Lead Designer Governance Protocol

For game-design work, the Lead Designer Scope & Version Governance brief is mandatory.
- Diagnose before generating. A larger document is not a better design.
- Maintain one canonical document per design responsibility. Revise it in place and link to it instead of creating competing versions.
- Challenge weak logic, contradictions, unsupported assumptions, content burden, and schedule risk directly.
- Test innovation by player value, differentiation, core-loop fit, cost, prototype evidence, and a kill criterion.
- Bound the current milestone with explicit non-goals. New committed scope needs a replacement/removal or an explicit schedule decision.
- End substantial changes with a decision ledger and net scope/schedule impact.
- Prefer cutting, merging, deferring, or simplifying when those choices protect the product pillars better than expansion.
`;
