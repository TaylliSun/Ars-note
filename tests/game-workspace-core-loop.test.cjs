const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyEntry,
} = require('../dist-test/src/utils/gameWorkspaceScanner.js');
const {
  createGameWorkspaceDoc,
} = require('../dist-test/src/utils/gameWorkspaceHelper.js');
const {
  getTemplateById,
} = require('../dist-test/src/templates.js');

test('classifies a dedicated gameplay-loop document before the broad GDD folder rule', () => {
  assert.equal(
    classifyEntry('01_GDD/GameplayLoop.md', '核心玩法循环'),
    'coreLoop',
  );
  assert.equal(
    classifyEntry('01_GDD/GDD.md', '游戏设计文档'),
    'gdd',
  );
});

test('core-loop quick creation uses the production template and canonical path', () => {
  const info = createGameWorkspaceDoc('coreLoop', {}, 'zh-CN');
  assert.equal(info.folder, '01_GDD');
  assert.equal(info.fileName, 'GameplayLoop.md');
  assert.equal(info.templateId, 'core-gameplay-loop');
  assert.match(info.content, /## 3\. 多层循环关系/);
  assert.match(info.content, /## 4\. 单步契约/);
  assert.match(info.content, /## 9\. 原型与验证/);
  assert.match(info.content, /## 10\. 可追溯矩阵/);
  assert.match(info.content, /重入条件/);
});

test('English core-loop template covers progression, recovery, telemetry, and review gates', () => {
  const template = getTemplateById('core-gameplay-loop', {}, 'en');
  assert.ok(template);
  assert.match(template.content, /Connected Loop Horizons/);
  assert.match(template.content, /Failure, Recovery, and Return/);
  assert.match(template.content, /Prototype and Measurement/);
  assert.match(template.content, /Traceability/);
  assert.match(template.content, /Passed.*Needs review.*Blocked/s);
});

test('GDD template is organized as a causal design document rather than a feature inventory', () => {
  const template = getTemplateById('gdd', {}, 'zh-CN');
  assert.ok(template);
  assert.match(template.content, /## 2\. 多层体验循环/);
  assert.match(template.content, /## 3\. 核心玩法循环/);
  assert.match(template.content, /消耗 \/ 投入 \/ 转化/);
  assert.match(template.content, /下一轮改变的决策/);
  assert.match(template.content, /## 4\. 系统关系与依赖/);
  assert.match(template.content, /战斗、采集、建造、探索、对话和经营只是行动或子系统/);
  assert.match(template.content, /最小可玩原型/);
});
