const test = require('node:test');
const assert = require('node:assert/strict');

const {
  auditHumanizationFidelity,
  auditHumanizedWriting,
  autoHumanizeMarkdownContent,
  detectWritingLanguage,
} = require('../dist-electron/humanizedWriting.js');

const naturalChinese = `制作组本周只确认订单系统的第一轮闭环。玩家接单后选择一座浮岛，系统根据天气和库存计算可交付物。订单完成时发放灵气；灵气只能用于研究配方或扩建仓库，两条路线会改变下一轮的生产选择。

失败订单不清空库存。玩家承担一段冷却时间，再从原订单或低一级订单中选一个继续。这个处理保留了前一轮投入，也让失败有实际成本。

原型先做三种天气、六张订单和两条升级路线。测试时记录玩家查看库存的次数、第一次改换生产路线的时点，以及失败后是否理解恢复入口。若五名测试者中有三人无法说明灵气的用途，先改反馈，不增加新资源。`;

test('detects Chinese, English, and mixed production prose', () => {
  assert.equal(detectWritingLanguage(naturalChinese), 'zh');
  assert.equal(detectWritingLanguage('The combat designer owns input timing, hit feedback, and the debug scenario. The engineer owns state replication and logging.'), 'en');
  assert.equal(detectWritingLanguage('玩家完成 Quest 后更新 quest_state，并由 UI 显示 Next objective 和奖励。'), 'mixed');
});

test('flags Chinese template language while accepting direct team prose', () => {
  const artificial = `首先，我们将全面赋能核心玩法，打造丰富多样的沉浸式体验。此外，通过多维度系统的深度融合，从而显著提升玩家体验。其次，这套方案不仅能够增强游戏性，而且还能极大丰富游戏内容。综上所述，该系统将为项目注入新的活力。希望以上内容能对你有所帮助，如果你还有问题可以继续告诉我。`;
  const bad = auditHumanizedWriting(artificial, 78);
  const good = auditHumanizedWriting(naturalChinese, 78);
  assert.equal(bad.passed, false);
  assert.ok(bad.score < 60);
  assert.ok(bad.issues.some((issue) => /Chinese canned transitions/i.test(issue)));
  assert.equal(good.passed, true, good.issues.join('\n'));
  assert.ok(good.score >= 90);
});

test('flags English chatbot and press-release prose', () => {
  const artificial = `Great question! Additionally, this groundbreaking system serves as a robust and seamless framework. Moreover, it not only enhances the player experience but also delivers a rich and immersive experience. Ultimately, this transformative approach underscores the importance of comprehensive design. I hope this helps. Let me know if you need anything else.`;
  const audit = auditHumanizedWriting(artificial, 78);
  assert.equal(audit.passed, false);
  assert.ok(audit.issues.some((issue) => /chatbot/i.test(issue)));
  assert.ok(audit.issues.some((issue) => /inflated English/i.test(issue)));
});

test('safe cleanup removes certain filler without changing Markdown contracts', () => {
  const source = `---
type: design
---

# 系统说明

值得注意的是，订单完成后更新 [[OrderState|订单状态]]，详情见 [规则](rules.md)。

| 字段 | 值 |
| --- | --- |
| status | done |

\`\`\`ts
const message = "I hope this helps";
\`\`\`

Additionally, In order to continue, utilize the saved state.
`;
  const result = autoHumanizeMarkdownContent(source);
  assert.equal(result.changed, true);
  assert.match(result.content, /订单完成后更新 \[\[OrderState\|订单状态\]\]/);
  assert.match(result.content, /\| status \| done \|/);
  assert.match(result.content, /const message = "I hope this helps";/);
  assert.match(result.content, /To continue, use the saved state\./);
  assert.doesNotMatch(result.content, /值得注意的是/);
});

test('fidelity audit preserves protected facts while allowing prose rewrites', () => {
  const source = `---
type: system
owner: design
---

# 订单系统

玩家完成 3 份订单后获得 120 灵气，并更新 [[OrderState|订单状态]]。实现任务为 TASK-204，详情见 [接口](https://example.com/order-api)。

| 字段 | 默认值 |
| --- | --- |
| cap | 120 |

\`order_state\` 由以下逻辑更新：

\`\`\`ts
setOrderState('done');
\`\`\`
`;
  const naturalRewrite = source.replace('玩家完成 3 份订单后获得 120 灵气，并更新', '完成第 3 份订单时，系统发放 120 灵气，同时更新');
  const audit = auditHumanizationFidelity(source, naturalRewrite);
  assert.equal(audit.passed, true, audit.issues.join('\n'));
  assert.equal(audit.score, 100);
});

test('fidelity audit blocks lost or invented facts and Markdown structure', () => {
  const source = '# 订单系统\n\n完成 3 份订单后获得 120 灵气，更新 [[OrderState]]，任务 TASK-204。\n';
  const rewrite = '## 订单系统\n\n完成 5 份订单后获得 200 灵气，任务 TASK-205。\n';
  const audit = auditHumanizationFidelity(source, rewrite);
  assert.equal(audit.passed, false);
  assert.deepEqual(audit.missingNumbers, ['120', '3']);
  assert.deepEqual(audit.addedNumbers, ['200', '5']);
  assert.deepEqual(audit.missingWikiLinks, ['[[OrderState]]']);
  assert.deepEqual(audit.missingTaskIds, ['TASK-204']);
  assert.equal(audit.changedHeadingStructure, true);
});
