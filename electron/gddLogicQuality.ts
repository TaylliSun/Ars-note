export interface GDDLogicCheck {
  id: string;
  label: string;
  passed: boolean;
  critical?: boolean;
}

export interface GDDLogicAudit {
  passed: boolean;
  score: number;
  requiredScore: number;
  checks: GDDLogicCheck[];
  issues: string[];
}

const GDD_PATH_RE = /(?:^|\/)(?:gdd|newgdd|game[-_ ]?design(?:spec|document)?|[^/]*[_-]gdd)\.md$/i;
const GDD_HEADING_RE = /^(?:game\s+design\s+document|gdd|游戏设计文档|游戏策划案)(?:\s*[:：-]|$)/i;
const CORE_LOOP_HEADING_RE = /(?:核心(?:玩法|体验)?(?:循环|闭环)|核心玩法|core\s*(?:gameplay\s*)?loop)/i;

function contains(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

function extractMarkdownSection(markdown: string, headingPattern: RegExp): string {
  const lines = String(markdown || '').split(/\r?\n/);
  let start = -1;
  let level = 7;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match || !contains(headingPattern, match[2])) continue;
    start = index + 1;
    level = match[1].length;
    break;
  }
  if (start < 0) return '';

  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s{0,3}(#{1,6})\s+/);
    if (match && match[1].length <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

export function isLikelyGDDDocument(path: string, markdown = ''): boolean {
  const normalized = String(path || '').replace(/\\/g, '/');
  if (GDD_PATH_RE.test(normalized)) return true;
  const firstHeading = String(markdown || '').split(/\r?\n/).find((line) => /^\s{0,3}#\s+/.test(line));
  return !!firstHeading && GDD_HEADING_RE.test(firstHeading.replace(/^\s{0,3}#\s+/, '').trim());
}

export function auditGDDLogic(markdown: string): GDDLogicAudit {
  const documentText = String(markdown || '').trim();
  const coreLoop = extractMarkdownSection(documentText, CORE_LOOP_HEADING_RE);
  const loopText = coreLoop || '';

  const checks: GDDLogicCheck[] = [
    {
      id: 'experience-thesis',
      label: 'target player, player promise/fantasy, design pillars, and non-goals',
      passed: contains(/目标(?:玩家|用户|受众)|玩家(?:承诺|幻想|体验)|核心体验|设计支柱|体验支柱|非目标|target\s+(?:player|audience)|player\s+(?:promise|fantasy)|experience\s+pillar|non[-\s]?goals?/i, documentText),
    },
    {
      id: 'core-loop-section',
      label: 'a dedicated core-loop section with real content',
      passed: loopText.replace(/[`#|\-:>\s]/g, '').length >= 40,
      critical: true,
    },
    {
      id: 'player-goal',
      label: 'the player need, motivation, or goal that starts the loop',
      passed: contains(/玩家(?:意图|目标|动机|需求)|短期目标|当前目标|目标\/需求|need\s*\/\s*goal|player\s+(?:intent|goal|need|motivation)|motivation/i, loopText),
      critical: true,
    },
    {
      id: 'choice-action',
      label: 'a meaningful player choice and the action/input that commits it',
      passed: contains(/选择|决策|取舍|输入|行动|操作|核心动词|commit|choose|choice|decision|trade[-\s]?off|input|action|core\s+verbs?/i, loopText),
      critical: true,
    },
    {
      id: 'resolution-feedback',
      label: 'system resolution/state change and immediate readable feedback',
      passed: contains(/规则(?:结算|解析)|系统结算|状态变化|即时反馈|可读反馈|结果反馈|resolve|resolution|state\s+change|immediate\s+feedback|readable\s+feedback/i, loopText),
    },
    {
      id: 'reward-output',
      label: 'an explicit reward, cost, consequence, or output',
      passed: contains(/奖励|成本|代价|后果|产出|获得|收益|掉落|reward|cost|consequence|output|gain|loot/i, loopText),
      critical: true,
    },
    {
      id: 'resource-use',
      label: 'where the output is spent, transformed, equipped, or invested',
      passed: contains(/消耗|投入|转化|加工|装备|分配|使用资源|资源去向|spend|sink|transform|convert|equip|invest/i, loopText),
      critical: true,
    },
    {
      id: 'progression-return',
      label: 'progression/unlock that changes the next decision instead of only increasing numbers',
      passed: contains(/成长|进度|解锁|新选项|新能力|新策略|改变下一轮|下一轮(?:选择|决策)|progression|unlock|new\s+(?:option|ability|strategy)|changes?\s+the\s+next/i, loopText),
    },
    {
      id: 're-entry',
      label: 'an explicit re-entry link back to a changed next loop',
      passed: contains(/重入|重新进入|回到下一轮|进入下一轮|再次选择|循环入口|re[-\s]?entry|re-enter|next\s+(?:round|loop)|repeat\s+with/i, loopText),
      critical: true,
    },
    {
      id: 'connected-horizons',
      label: 'connected moment-to-moment, session, and meta/long-term horizons',
      passed: [
        /秒级|即时|操作层|moment[-\s]to[-\s]moment/i,
        /会话|单局|单次游玩|session/i,
        /局外|元循环|长期|跨会话|meta|long[-\s]?term/i,
      ].every((pattern) => contains(pattern, documentText)),
    },
    {
      id: 'failure-recovery',
      label: 'failure, interruption, recovery, retry, and preserved progress',
      passed: contains(/失败|中断|恢复|重试|保留进度|回退|failure|interruption|recovery|retry|resume|preserved\s+progress/i, documentText),
    },
    {
      id: 'system-topology',
      label: 'system/resource dependencies showing how sections support the core loop',
      passed: contains(/系统关系|系统拓扑|依赖关系|输入系统|输出系统|资源流|产消|system\s+(?:topology|dependency|relationship)|resource\s+flow|source.+sink/i, documentText),
    },
    {
      id: 'validation',
      label: 'prototype, observable evidence, telemetry, and acceptance criteria',
      passed: contains(/最小可玩原型|原型验证|观察计划|埋点|验收标准|通过条件|playable\s+prototype|observation\s+plan|telemetry|acceptance\s+criteria/i, documentText),
    },
  ];

  const score = checks.filter((check) => check.passed).length;
  const requiredScore = 10;
  const criticalPassed = checks.filter((check) => check.critical).every((check) => check.passed);
  const issues = checks.filter((check) => !check.passed).map((check) => check.label);
  return {
    passed: documentText.length >= 600 && criticalPassed && score >= requiredScore,
    score,
    requiredScore,
    checks,
    issues,
  };
}

export function formatGDDLogicGateFailure(audit: GDDLogicAudit): string {
  return [
    `GDD logic quality gate blocked this write (${audit.score}/${audit.checks.length}; required ${audit.requiredScore} plus all critical links).`,
    `Missing: ${audit.issues.join('; ') || 'the document is too short to be a production GDD'}.`,
    'Rewrite the same canonical document. The core loop must show: player goal -> meaningful choice/action -> rule resolution and feedback -> reward/cost -> spend/transform -> progression or unlock -> changed next decision -> explicit re-entry.',
    'Combat, collection, construction, or exploration may be an action inside this chain; a feature name by itself is not a core loop.',
  ].join(' ');
}
