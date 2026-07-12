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
      '玩家循环、功能边界、前置条件、状态机和完整规则表',
      '资源来源/消耗、解锁、失败、回退、中断、异常与防滥用规则',
      '配置字段、默认值、枚举、持久化和跨系统事件',
      'UI 反馈、埋点、验收用例和边界回归清单',
    ],
    signals: [
      { pattern: /系统策划|系统设计|玩法系统|功能系统|核心循环|状态机|规则|解锁|背包|养成|建造|合成|采集|交互机制/i, weight: 6, reason: '包含系统规则或玩法循环' },
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
    'Completion gate:',
    '- Do not claim quality scores such as 100/100. Report Passed, Needs review, or Blocked for each applicable gate and name the exact unresolved evidence.',
  ].join('\n');
}

export const GAME_DESIGN_SPECIALIST_SYSTEM_PROMPT = `

Professional Game Design Studio Protocol

For game-planning work, follow the Professional Game Design Studio Brief supplied with the user request.
- Use one primary specialist as the decision owner and at most two review specialists. Do not blend every discipline into generic filler.
- Inspect project evidence before changing an existing design. Preserve canon and existing production decisions unless the user asks for a redesign.
- Write for implementation and review, not for inspiration alone. Every major decision needs behavior, data/config, feedback, owner, acceptance, and risk implications.
- Mark confirmed facts, decisions, assumptions, and open questions separately.
- For revisions, include a concise change-impact section covering affected documents, systems, data, UI, engineering, content, QA, schedule, and migration.
- For professional documents, finish with discipline review gates and concrete next tasks. Do not invent a numeric quality score.
`;
