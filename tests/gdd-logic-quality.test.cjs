const test = require('node:test');
const assert = require('node:assert/strict');

const {
  auditGDDLogic,
  formatGDDLogicGateFailure,
  isLikelyGDDDocument,
} = require('../dist-electron/gddLogicQuality.js');

const strongGdd = `# 游戏设计文档：浮岛工坊

## 1. 设计命题与依据
目标玩家是喜欢短时经营与长期收集的桌面玩家。玩家承诺是在每次短会话中做出有取舍的岛屿经营选择，并逐渐形成自己的浮岛生态。体验支柱是清晰反馈、可表达成长和低压力恢复；非目标是高强度连续战斗。

## 2. 多层体验循环
秒级操作层负责观察和选择；遭遇任务层验证本轮策略；单局 / 会话层完成一次生产目标；局外 / 成长层解锁新选项；长期精通层形成不同岛屿流派。每层都消耗上一层产出，并改变玩家返回下层时的决策。

## 3. 核心玩法循环
玩家目标是完成当前岛屿订单并塑造理想生态。玩家先观察天气、库存和订单，在采集、加工或调整建筑之间做有意义的选择与取舍；输入行动后，系统根据地块、时间和配方规则结算状态变化，并用动画、音效和产量预览提供即时反馈。玩家获得材料、灵气或时间成本，再把资源投入建筑升级、配方研究和伙伴装备，形成明确的资源去向。成长与解锁提供新选项和新策略，改变下一轮选择。完成、失败或中断后保留关键进度，通过新的订单目标明确重入并进入下一轮。

| 玩家意图 | 选择与行动 | 规则 / 状态变化 | 即时反馈 | 奖励 / 成本 | 消耗 / 投入 / 转化 | 成长 / 解锁 | 下一轮改变的决策 | 失败 / 恢复 | 重入条件 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 完成订单 | 选择采集与生产路线 | 天气和配方结算库存 | 产量预览与动画 | 材料与时间成本 | 投入升级或研究 | 解锁新配方 | 改变下一轮路线 | 保留库存并降级订单 | 接受新订单 |

## 4. 系统关系与依赖
系统拓扑由订单、天气、采集、加工、库存、建筑成长和伙伴反馈组成。资源流从采集来源进入加工转化，经库存上限约束后进入升级消耗；UI 依赖各系统状态并把输出反馈给玩家。

## 5. 成长与经济资源流
材料来源于采集，经过加工转化后存入有限库存，主要 sink / 消耗是建筑升级、研究和伙伴装备。每次解锁必须提供新决策而不是只增加数值；数值负责人维护产消和套利风险。

## 6. 内容与挑战推进
前期建立动词，中期组合天气与订单，后期要求跨岛资源调度。内容生产按配方、订单和岛屿规则复用，避免只堆数值。

## 7. 失败、恢复与返回
失败会降低订单收益但保留核心进度；中断时保存本轮状态，恢复后从决策点继续；资源不足允许选择替代订单或低成本恢复路线，并给出明确重试和重入条件。

## 8. 交互反馈、美术与音频
每个规则结算都有 UI 状态、动画、VFX 和 SFX 反馈，并覆盖加载、失败、恢复和可访问性。

## 10. 技术、数据与生产
配置记录订单输入输出、资源上限、解锁条件和系统依赖，支持存档迁移和调试。

## 11. 原型、埋点与验收
最小可玩原型验证一次订单闭环。观察计划记录玩家是否理解资源去向和下一目标；埋点覆盖选择、产出、消耗、解锁、失败和重入。验收标准要求玩家无需说明即可完成两轮并说出第二轮为何改变策略。
`;

test('recognizes canonical GDD paths and headings', () => {
  assert.equal(isLikelyGDDDocument('01_GDD/GDD.md'), true);
  assert.equal(isLikelyGDDDocument('01_GDD/GameDesignSpec.md'), true);
  assert.equal(isLikelyGDDDocument('01_GDD/CombatSystem.md', '# 游戏设计文档：战斗'), true);
  assert.equal(isLikelyGDDDocument('01_GDD/CombatSystem.md', '# 战斗系统'), false);
});

test('rejects a GDD whose core loop is only a feature name', () => {
  const audit = auditGDDLogic(`# 游戏设计文档：Demo

## 核心玩法循环
战斗。

## 系统
角色、武器、敌人。
`);
  assert.equal(audit.passed, false);
  assert.ok(audit.issues.some((issue) => /player need|motivation|goal/i.test(issue)));
  assert.match(formatGDDLogicGateFailure(audit), /Combat.*not a core loop/i);
});

test('accepts a production GDD with a closed causal loop and connected horizons', () => {
  const audit = auditGDDLogic(strongGdd);
  assert.equal(audit.passed, true, audit.issues.join('\n'));
  assert.ok(audit.score >= audit.requiredScore);
});
