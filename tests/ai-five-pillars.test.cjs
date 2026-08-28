const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  appendMemory,
  buildMemoryContext,
  consolidateMemory,
  getRelevantSkillMatches,
  listSkills,
  observeReusableWorkflow,
  readMemory,
  updateSkillUsage,
} = require('../dist-test/electron/fivePillars.js');

function makeVault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ars-note-ai-pillars-'));
}

test('memory append ignores exact duplicate durable facts', (t) => {
  const vault = makeVault();
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));

  appendMemory(vault, '莲池岛的正式术语是灵纹，不再使用装饰。');
  appendMemory(vault, '  莲池岛的正式术语是灵纹，不再使用装饰。  ');

  const matches = readMemory(vault).match(/莲池岛的正式术语是灵纹/g) || [];
  assert.equal(matches.length, 1);
});

test('memory compression preserves locked facts and complete recent entries', (t) => {
  const vault = makeVault();
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  const memoryDir = path.join(vault, '.ai-memory');
  fs.mkdirSync(path.join(memoryDir, 'history'), { recursive: true });
  const entries = [
    '# Project Memory',
    '',
    '- [2026-01-01] [locked] 核心设定：装饰已经正式改名为灵纹。',
    ...Array.from({ length: 260 }, (_, index) => (
      `- [2026-07-${String((index % 28) + 1).padStart(2, '0')}] 记录 ${index}：${'完整项目事实'.repeat(10)}`
    )),
  ].join('\n');
  fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), entries, 'utf8');

  const preview = buildMemoryContext(entries, 1800);
  assert.match(preview, /核心设定：装饰已经正式改名为灵纹/);
  assert.match(preview, /记录 259/);
  assert.doesNotMatch(preview, /记录 0：/);

  const result = consolidateMemory(vault);
  assert.match(result, /Consolidated/);
  const compacted = readMemory(vault);
  assert.match(compacted, /核心设定：装饰已经正式改名为灵纹/);
  assert.match(compacted, /记录 259/);
  assert.ok(fs.readdirSync(path.join(memoryDir, 'history')).some(name => name.startsWith('memory-')));
});

test('workflow learning promotes only after repeated successful execution and stays deduplicated', (t) => {
  const vault = makeVault();
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  const observation = {
    userText: '检查 04_Maps/LotusPondIsland.md 的全部表格格式并修复',
    toolNames: ['read_file', 'write_file'],
    successful: true,
  };

  const first = observeReusableWorkflow(vault, observation);
  assert.equal(first.successCount, 1);
  assert.equal(first.promotedSkillId, undefined);
  assert.equal(listSkills(vault).length, 0);

  const second = observeReusableWorkflow(vault, observation);
  assert.equal(second.successCount, 2);
  assert.match(second.promotedSkillId, /^learned-/);
  assert.equal(listSkills(vault).length, 1);
  assert.match(listSkills(vault)[0].steps, /read_file -> write_file/);

  observeReusableWorkflow(vault, observation);
  assert.equal(listSkills(vault).length, 1);

  const matches = getRelevantSkillMatches(vault, '再检查莲池岛文档的表格格式');
  assert.equal(matches.length, 1);
  updateSkillUsage(vault, matches[0].id, true);
  const learned = listSkills(vault)[0];
  assert.equal(learned.useCount, 1);
  assert.equal(learned.successRate, 100);
});

test('failed workflow observations never create candidates or skills', (t) => {
  const vault = makeVault();
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));

  const result = observeReusableWorkflow(vault, {
    userText: '删除错误文件',
    toolNames: ['delete_file'],
    successful: false,
  });

  assert.equal(result.observed, false);
  assert.equal(listSkills(vault).length, 0);
});
