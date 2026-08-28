const test = require('node:test');
const assert = require('node:assert/strict');

const {
  auditDesignEvidenceClaims,
  auditProfessionalDesignDocument,
  buildDesignQualityReport,
  inferProfessionalDesignKind,
} = require('../dist-electron/designWritingQuality.js');

const strongSystemSpec = `# 浮岛订单系统

## 依据与状态

- 已确认：单次会话以完成一张订单为主要目标，来源为 [[GDD]]。
- 设计决策：订单只消耗现有材料，不新增货币。
- 假设：玩家能在十秒内读懂库存缺口，原型测试后确认。
- 开放问题：失败订单是否保留一半进度，由主策划评审。

## 设计意图、玩家目标与范围

设计目标是让玩家在天气、库存和交付期限之间做一次明确取舍。玩家目标是用当前库存完成订单，同时保留下一轮需要的材料。本阶段范围包含接单、生产检查、交付和失败恢复；非目标是不做随机词条、订单连锁和跨岛交易。里程碑边界是可运行的单岛原型。

## 运行规则与状态机

触发条件是玩家在订单板选择一张可接订单。输入包括订单编号、库存快照、天气状态和剩余时间。玩家选择立即接单或刷新一次；接单后系统按 Locked -> Active -> Ready -> Completed / Failed 转换状态。规则结算输出材料缺口、交付结果、灵气奖励和冷却时间。每个状态变化都发送事件，不能从 Failed 直接进入 Completed。

## 反馈与界面状态

UI 显示可接、材料不足、进行中、可交付、失败和恢复六种状态。库存不足时标出具体材料，不使用统一红色警告。交付成功播放短动画和 SFX；失败只显示原因、保留进度和恢复入口。

## 数据、配置与依赖

配置字段包括 order_id、required_items、duration_sec、reward_energy、failure_cooldown_sec 和 unlock_rule。数据由订单系统持久化，依赖库存、天气、成长和存档模块。系统策划负责规则与默认值，程序负责人维护状态事件，UI 负责人维护反馈映射。

## 失败、边界与防滥用

中断时保存 Active 状态和剩余时间；加载失败时回到接单前库存快照。边界用例包含零库存、订单过期、重复交付和存档版本缺字段。刷新订单有冷却，避免反复刷新套利；同一 order_id 的奖励只结算一次。

## 风险与取舍

主要风险是玩家为了最高奖励反复等待天气。更简单方案是原型阶段固定天气，只验证库存取舍；当前选择保留三种天气，因为天气判断是核心决策，但暂缓订单连锁。若测试者只按奖励排序，移除天气倍率并改为材料稀缺度提示。

## 原型、QA、埋点与验收

最小原型提供六张订单和三种天气。QA 测试所有状态转换、重复交付、退出恢复和旧存档迁移。埋点记录订单曝光、接取、刷新、完成、失败、恢复和材料缺口。验收标准：五名测试者中至少四人能在不看说明的情况下完成两轮，并准确说出第二轮为何保留某种材料。

## 可追溯与交付

可追溯链：玩家目标 -> 接单规则 -> OrderConfig -> UI 状态 -> 系统策划 / 程序负责人 -> QA 与埋点验收。下一步由系统策划冻结字段，程序制作状态机原型，QA 编写恢复和重复结算用例。
`;

test('infers discipline-specific design document kinds', () => {
  assert.equal(inferProfessionalDesignKind('写一份数值平衡与掉落概率文档'), 'economy');
  assert.equal(inferProfessionalDesignKind('01_GDD/CombatSystem.md 战斗技能时序'), 'combat');
  assert.equal(inferProfessionalDesignKind('完整 GDD 游戏设计文档'), 'gdd');
  assert.equal(inferProfessionalDesignKind('美术资产导出规格'), 'art');
  assert.equal(inferProfessionalDesignKind('OrderSystem.md\n# 浮岛订单系统\n正文包含 UI 状态和交互反馈'), 'system');
});

test('rejects generic feature prose with no operating model or acceptance evidence', () => {
  const audit = auditProfessionalDesignDocument(`# 订单系统

订单系统旨在打造丰富多样的沉浸式体验。系统会显著提升玩家体验，并为后续玩法注入新的活力。`, 'system');
  assert.equal(audit.passed, false);
  assert.ok(audit.issues.some((issue) => /trigger\/input/i.test(issue)));
  assert.ok(audit.issues.some((issue) => /acceptance/i.test(issue)));
});

test('accepts a reviewable system design with evidence, rules, handoff, and tests', () => {
  const audit = auditProfessionalDesignDocument(strongSystemSpec, 'system');
  assert.equal(audit.passed, true, audit.issues.join('\n'));
  assert.ok(audit.score >= audit.requiredScore);
  assert.ok(audit.naturalnessScore >= 90);
});

test('numeric design claims require source evidence or an explicit provisional label', () => {
  const source = '# 已确认参数\n订单上限为 12 个，冷却时间为 30 秒。';
  const grounded = auditDesignEvidenceClaims('订单上限保持 12 个，冷却时间保持 30 秒。', [source]);
  assert.equal(grounded.passed, true);

  const invented = auditDesignEvidenceClaims('订单上限调整为 20 个，冷却时间改为 10 秒。', [source]);
  assert.equal(invented.passed, false);
  assert.deepEqual(invented.unqualifiedClaims.map((claim) => claim.token), ['20个', '10秒']);

  const provisional = auditDesignEvidenceClaims('订单上限暂定 20 个，作为原型参数；测试后由系统策划根据完成率调参。', [source]);
  assert.equal(provisional.passed, true, JSON.stringify(provisional.unqualifiedClaims));
});

test('quality report exposes maturity, naturalness, strengths, and prioritized gaps', () => {
  const report = buildDesignQualityReport('01_GDD/OrderSystem.md', strongSystemSpec);
  assert.equal(report.kind, 'system');
  assert.equal(report.readiness, 'implementation-ready');
  assert.equal(report.passed, true);
  assert.ok(report.maturityScore >= 80);
  assert.ok(report.naturalnessScore >= 90);
  assert.ok(report.strengths.length > 0);

  const sampled = buildDesignQualityReport('01_GDD/OrderSystem.md', strongSystemSpec.slice(0, 900), {
    sampled: true,
    totalCharacterCount: 900000,
  });
  assert.equal(sampled.analysisScope, 'sampled');
  assert.equal(sampled.passed, false);
  assert.equal(sampled.characterCount, 900000);
});
