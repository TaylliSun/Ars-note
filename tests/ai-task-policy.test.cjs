const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAITaskPolicy,
  evaluateAIToolCall,
  extractRequestedPaths,
} = require('../dist-electron/aiTaskPolicy.js');
const retiredIdentityPattern = new RegExp(String.fromCharCode(79, 98, 115, 105, 100, 105, 97, 110), 'i');

function designRevisionPrerequisites(path) {
  return [
    { name: 'read_file', args: { path }, result: '# Canonical design' },
    { name: 'get_design_canon', args: { domain: 'gdd' }, result: '{"ok":true}' },
    {
      name: 'analyze_design_change',
      args: { source_path: path, change_summary: '收敛规则并移除重复范围' },
      result: '{"ok":true}',
    },
  ];
}

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
  assert.match(policy.systemHint, /product identity is always Ars-note/);
  assert.doesNotMatch(policy.systemHint, retiredIdentityPattern);
});

test('cross-document terminology migration requires a vault search before batch refactoring', () => {
  const policy = buildAITaskPolicy('原来是装饰，现在统一改成灵纹，部分文档仍然有装饰残留', 'member');
  assert.equal(policy.primary, 'terminology-migration');
  assert.equal(evaluateAIToolCall(policy, 'search_vault_text', { query: '装饰' }).allowed, true);

  const earlyRefactor = evaluateAIToolCall(policy, 'refactor_vault_term', {
    from: '装饰',
    to: '灵纹',
    paths: '["01_GDD/GDD.md"]',
  });
  assert.equal(earlyRefactor.allowed, false);
  assert.match(earlyRefactor.reason, /Search the entire vault/i);

  const reviewedRefactor = evaluateAIToolCall(
    policy,
    'refactor_vault_term',
    {
      from: '装饰',
      to: '灵纹',
      paths: '["01_GDD/GDD.md","04_Maps/LotusPondIsland.md"]',
    },
    [{ name: 'search_vault_text', args: { query: '装饰' }, result: '{"matchCount":2}' }],
  );
  assert.equal(reviewedRefactor.allowed, true);
  assert.match(policy.systemHint, /search_vault_text\(old term\)/);
});

test('vault terminology refactor is blocked for unrelated requests', () => {
  const policy = buildAITaskPolicy('莲池岛的核心体验是什么？', 'producer');
  const decision = evaluateAIToolCall(
    policy,
    'refactor_vault_term',
    { from: '装饰', to: '灵纹', paths: '["01_GDD/GDD.md"]' },
    [{ name: 'search_vault_text', args: { query: '装饰' } }],
  );
  assert.equal(decision.allowed, false);
});

test('design revisions update one canonical Markdown document in place', () => {
  const policy = buildAITaskPolicy('完善 01_GDD/GDD.md，指出逻辑不足并收敛项目范围', 'member');
  assert.equal(policy.primary, 'markdown-spec');
  assert.equal(policy.revisionIntent, true);
  assert.equal(policy.multiDocumentIntent, false);

  const duplicate = evaluateAIToolCall(
    policy,
    'write_file',
    { path: '01_GDD/GDD_优化版.md' },
    [{ name: 'read_file', args: { path: '01_GDD/GDD.md' } }],
  );
  assert.equal(duplicate.allowed, false);
  assert.match(duplicate.reason, /canonical|versions are blocked/i);

  const earlyCanonicalWrite = evaluateAIToolCall(policy, 'write_file', { path: '01_GDD/GDD.md' });
  assert.equal(earlyCanonicalWrite.allowed, false);
  assert.match(earlyCanonicalWrite.reason, /Read the canonical/i);

  const canonicalWrite = evaluateAIToolCall(
    policy,
    'write_file',
    { path: '01_GDD/GDD.md' },
    designRevisionPrerequisites('01_GDD/GDD.md'),
  );
  assert.equal(canonicalWrite.allowed, true);
  assert.match(policy.systemHint, /Added\/Changed\/Removed\/Deferred/);
});

test('explicit historical version branches are allowed after inspecting the source', () => {
  const policy = buildAITaskPolicy('基于 01_GDD/GDD.md 创建一个 v2 历史版本分支，并保留旧版', 'member');
  assert.equal(policy.explicitVersionBranchIntent, true);
  const decision = evaluateAIToolCall(
    policy,
    'write_file',
    { path: '01_GDD/GDD_v2.md' },
    [{ name: 'read_file', args: { path: '01_GDD/GDD_v2.md' } }],
  );
  assert.equal(decision.allowed, true);
});

test('current-note revisions inherit the open canonical path when the prompt omits it', () => {
  const policy = buildAITaskPolicy('完善当前策划文档，收住范围并指出逻辑不足', 'member', '01_GDD/GDD.md');
  assert.deepEqual(policy.requestedPaths, ['01_GDD/GDD.md']);

  const unrelatedRewrite = evaluateAIToolCall(
    policy,
    'write_file',
    { path: '01_GDD/GDD_Rework.md' },
    [{ name: 'read_file', args: { path: '01_GDD/GDD.md' } }],
  );
  assert.equal(unrelatedRewrite.allowed, false);
  assert.match(unrelatedRewrite.reason, /canonical file named by the user/i);

  const canonicalWrite = evaluateAIToolCall(
    policy,
    'write_file',
    { path: '01_GDD/GDD.md' },
    designRevisionPrerequisites('01_GDD/GDD.md'),
  );
  assert.equal(canonicalWrite.allowed, true);
});

test('design critique is read-only until the user explicitly asks for changes', () => {
  const policy = buildAITaskPolicy('检查当前策划，指出逻辑不足、范围膨胀和工期风险', 'producer', '01_GDD/GDD.md');
  assert.equal(policy.primary, 'design-review');
  assert.equal(policy.allowMutations, false);
  assert.equal(evaluateAIToolCall(policy, 'read_file', { path: '01_GDD/GDD.md' }).allowed, true);
  assert.equal(evaluateAIToolCall(policy, 'write_file', { path: '01_GDD/GDD.md' }).allowed, false);
  assert.match(policy.systemHint, /keep\/change\/cut\/defer/);
});

test('reviewing a named Markdown design file is not misclassified as format repair', () => {
  const policy = buildAITaskPolicy('检查 01_GDD/GDD.md 的策划不足和范围问题', 'member');
  assert.equal(policy.primary, 'design-review');
  assert.equal(policy.allowMutations, false);
});

test('an explicit read-only review stays read-only despite negative create wording', () => {
  const policy = buildAITaskPolicy(
    'Review the current GDD and identify scope risks. This is a read-only review: do not create or modify files.',
    'producer',
    '01_GDD/GDD.md',
  );
  assert.equal(policy.primary, 'design-review');
  assert.equal(policy.allowMutations, false);
});

test('design revision requires canonical registry inspection and impact analysis before writing', () => {
  const policy = buildAITaskPolicy('完善 01_GDD/GDD.md 并控制项目范围', 'member');
  const readOnly = [{ name: 'read_file', args: { path: '01_GDD/GDD.md' }, result: '# GDD' }];
  const missingRegistry = evaluateAIToolCall(policy, 'write_file', { path: '01_GDD/GDD.md' }, readOnly);
  assert.equal(missingRegistry.allowed, false);
  assert.match(missingRegistry.reason, /get_design_canon/);

  const missingImpact = evaluateAIToolCall(
    policy,
    'write_file',
    { path: '01_GDD/GDD.md' },
    [...readOnly, { name: 'get_design_canon', args: { domain: 'gdd' }, result: '{"ok":true}' }],
  );
  assert.equal(missingImpact.allowed, false);
  assert.match(missingImpact.reason, /analyze_design_change/);

  const ready = evaluateAIToolCall(
    policy,
    'write_file',
    { path: '01_GDD/GDD.md' },
    designRevisionPrerequisites('01_GDD/GDD.md'),
  );
  assert.equal(ready.allowed, true);
});

test('full GDD writes are rejected when the core loop is only combat', () => {
  const policy = buildAITaskPolicy('完善 01_GDD/GDD.md 的完整 GDD 逻辑', 'member');
  assert.equal(policy.requiresGddLogicGate, true);
  const decision = evaluateAIToolCall(
    policy,
    'write_file',
    {
      path: '01_GDD/GDD.md',
      content: '# 游戏设计文档：Demo\n\n## 核心玩法循环\n战斗。\n\n## 其他系统\n角色和武器。',
    },
    designRevisionPrerequisites('01_GDD/GDD.md'),
  );
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /GDD logic quality gate blocked/);
  assert.match(decision.reason, /Combat.*not a core loop/i);
});

test('canonical registration requires candidate inspection and reading the selected document', () => {
  const policy = buildAITaskPolicy('将 01_GDD/GDD.md 登记为正式文档', 'member');
  const early = evaluateAIToolCall(policy, 'set_canonical_design_document', {
    domain: 'gdd',
    path: '01_GDD/GDD.md',
  });
  assert.equal(early.allowed, false);
  assert.match(early.reason, /get_design_canon/);

  const inspected = evaluateAIToolCall(
    policy,
    'set_canonical_design_document',
    { domain: 'gdd', path: '01_GDD/GDD.md' },
    [
      { name: 'get_design_canon', args: { domain: 'gdd' }, result: '{"ok":true}' },
      { name: 'read_file', args: { path: '01_GDD/GDD.md' }, result: '# GDD' },
    ],
  );
  assert.equal(inspected.allowed, true);
});

test('saving a game design spec uses the professional design contract instead of generic file mode', () => {
  const request = '写一份订单系统策划案，订单上限为 12 个、冷却时间为 30 秒，并保存到 01_GDD/OrderSystem.md';
  const policy = buildAITaskPolicy(request, 'member');
  assert.equal(policy.primary, 'markdown-spec');
  assert.equal(policy.requiresProfessionalDesignGate, true);
  assert.equal(policy.professionalDesignKind, 'system');
  assert.equal(policy.requestEvidence, request);
  assert.match(policy.systemHint, /Professional design maturity gate/);

  const weak = evaluateAIToolCall(policy, 'write_file', {
    path: '01_GDD/OrderSystem.md',
    content: '# 订单系统\n\n这个系统旨在全面提升玩家体验，打造丰富多样的玩法。',
  });
  assert.equal(weak.allowed, false);
  assert.match(weak.reason, /Professional system design quality gate blocked/);
});

test('humanizer recognizes Chinese class-humanization wording and rejects remaining AI prose', () => {
  const policy = buildAITaskPolicy('把 01_GDD/OrderSystem.md 做中文类人化，去掉机器味', 'member');
  assert.equal(policy.primary, 'humanize');
  assert.equal(policy.requiresGddLogicGate, false);
  const decision = evaluateAIToolCall(
    policy,
    'write_file',
    {
      path: '01_GDD/OrderSystem.md',
      content: '# 订单系统\n\n首先，我们将全面赋能玩法。此外，通过多维度融合，从而显著提升玩家体验。综上所述，这套方案将注入新的活力。希望以上内容能对你有所帮助。',
    },
    [{ name: 'read_file', args: { path: '01_GDD/OrderSystem.md' }, result: '# source' }],
  );
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /Humanized-writing quality gate blocked/);
});

test('humanizer blocks a natural-sounding rewrite that changes protected facts', () => {
  const policy = buildAITaskPolicy('把 01_GDD/OrderSystem.md 做中文类人化，写回原文档', 'member');
  const source = '# 订单系统\n\n玩家完成 3 份订单后获得 120 灵气，并更新 [[OrderState]]。实现任务是 TASK-204。';
  const changed = '# 订单系统\n\n完成 5 份订单时，系统发放 200 灵气，并更新 [[OrderState]]。实现任务是 TASK-204。';
  const decision = evaluateAIToolCall(
    policy,
    'write_file',
    { path: '01_GDD/OrderSystem.md', content: changed },
    [{ name: 'read_file', args: { path: '01_GDD/OrderSystem.md' }, result: source }],
  );
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /Humanization fidelity gate blocked/);
  assert.match(decision.reason, /removed numeric facts/i);
  assert.match(decision.reason, /invented numeric facts/i);
});
