const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAITaskPolicy,
  evaluateAIToolCall,
  extractRequestedPaths,
} = require('../dist-electron/aiTaskPolicy.js');

test('Markdown repair blocks unrelated Canvas and requires reading the target first', () => {
  const policy = buildAITaskPolicy('检查并修复 04_Maps/LotusPondIsland.md 里的全部表格格式', 'member');
  assert.equal(policy.primary, 'markdown-repair');
  assert.equal(policy.allowCanvas, false);
  assert.deepEqual(policy.requestedPaths, ['04_Maps/LotusPondIsland.md']);

  const canvas = evaluateAIToolCall(policy, 'create_canvas', { path: '01_GDD/GameWorkspaceSummary.canvas' });
  assert.equal(canvas.allowed, false);

  const earlyWrite = evaluateAIToolCall(policy, 'write_file', { path: '04_Maps/LotusPondIsland.md' });
  assert.equal(earlyWrite.allowed, false);
  assert.match(earlyWrite.reason, /Read the target/i);

  const verifiedWrite = evaluateAIToolCall(
    policy,
    'write_file',
    { path: '04_Maps/LotusPondIsland.md' },
    [{ name: 'read_file', args: { path: '04_Maps/LotusPondIsland.md' }, result: '# Lotus Pond' }],
  );
  assert.equal(verifiedWrite.allowed, true);
});

test('Direct answers are read-only and cannot silently create files', () => {
  const policy = buildAITaskPolicy('莲池岛的核心体验是什么？', 'producer');
  assert.equal(policy.primary, 'direct-answer');
  assert.equal(policy.allowMutations, false);
  assert.equal(evaluateAIToolCall(policy, 'read_file', { path: '04_Maps/LotusPondIsland.md' }).allowed, true);
  assert.equal(evaluateAIToolCall(policy, 'write_file', { path: '01_GDD/Answer.md' }).allowed, false);
});

test('Explicit file deletion is allowed only as a scoped file operation', () => {
  const policy = buildAITaskPolicy('删除 01_GDD/UITest3.visual.md 这个文件', 'member');
  assert.equal(policy.primary, 'file-operation');
  assert.equal(policy.allowMutations, true);
  assert.equal(evaluateAIToolCall(policy, 'delete_file', { path: '01_GDD/UITest3.visual.md' }).allowed, true);

  const specPolicy = buildAITaskPolicy('写一份莲池岛美术需求文档', 'member');
  assert.equal(evaluateAIToolCall(specPolicy, 'delete_file', { path: '01_GDD/GDD.md' }).allowed, false);
});

test('Team-wide tools require explicit team intent and Producer mode', () => {
  const member = buildAITaskPolicy('更新团队任务表并重新分配成员任务', 'member');
  assert.equal(member.primary, 'team-operation');
  assert.equal(member.allowTeamTools, false);
  assert.equal(evaluateAIToolCall(member, 'upsert_team_tasks', { tasks: '[]' }).allowed, false);

  const producer = buildAITaskPolicy('更新团队任务表并重新分配成员任务', 'producer');
  assert.equal(producer.allowTeamTools, true);
  assert.equal(evaluateAIToolCall(producer, 'upsert_team_tasks', { tasks: '[]' }).allowed, true);
});

test('Explicit visual requests allow one matching visual tool', () => {
  const canvas = buildAITaskPolicy('把这个开发流程做成一个 Canvas 流程图', 'member');
  assert.equal(canvas.primary, 'canvas');
  assert.equal(evaluateAIToolCall(canvas, 'create_canvas', { path: '01_GDD/DevFlow.canvas' }).allowed, true);
  assert.equal(evaluateAIToolCall(canvas, 'create_wireframe', { path: '01_GDD/DevFlow.excalidraw' }).allowed, false);
});

test('Requested path extraction supports Windows and vault-relative paths', () => {
  const paths = extractRequestedPaths('修复 C:\\Project\\Vault\\01_GDD\\GDD.md 和 04_Maps/LotusPondIsland.md');
  assert.equal(paths.length, 2);
  assert.ok(paths.some(path => path.endsWith('01_GDD/GDD.md')));
  assert.ok(paths.includes('04_Maps/LotusPondIsland.md'));
});

test('task contract repeats the Ars-note runtime identity after retrieved context', () => {
  const policy = buildAITaskPolicy('你是谁？', 'readonly');
  assert.match(policy.systemHint, /You are Ars-note AI Agent/);
  assert.match(policy.systemHint, /You are not Obsidian/);
});
