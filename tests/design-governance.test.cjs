const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DESIGN_CANON_REGISTRY_PATH,
  analyzeDesignChange,
  buildDesignCanonPromptContext,
  readDesignCanonRegistry,
  setCanonicalDesignDocument,
  suggestCanonicalDocuments,
} = require('../dist-electron/designGovernance.js');

function entry(relPath, title, content) {
  return {
    relPath,
    fullPath: relPath,
    title,
    tags: [],
    content,
    searchContent: content.toLowerCase(),
  };
}

function makeVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ars-note-design-governance-'));
  fs.mkdirSync(path.join(root, '01_GDD'), { recursive: true });
  fs.mkdirSync(path.join(root, '02_Worldbuilding'), { recursive: true });
  fs.writeFileSync(path.join(root, '01_GDD', 'GDD.md'), '# GDD\n\n## 核心玩法\n灵纹驱动岛屿成长。\n', 'utf8');
  fs.writeFileSync(path.join(root, '01_GDD', 'GameDesignSpec_v2.md'), '# GDD 优化版\n', 'utf8');
  fs.writeFileSync(path.join(root, '02_Worldbuilding', 'WorldOverview.md'), '# 世界观\n', 'utf8');
  return root;
}

test('canonical registry keeps one synchronized source of truth per responsibility', () => {
  const vault = makeVault();
  try {
    const first = setCanonicalDesignDocument(vault, {
      domain: 'gdd',
      path: '01_GDD/GDD.md',
      label: '总策划案',
      responsibility: '产品支柱、核心玩法与项目范围',
    });
    assert.equal(first.registry.entries.length, 1);
    assert.equal(first.entry.path, '01_GDD/GDD.md');
    assert.ok(fs.existsSync(path.join(vault, DESIGN_CANON_REGISTRY_PATH)));

    const second = setCanonicalDesignDocument(vault, {
      domain: 'gdd',
      path: '02_Worldbuilding/WorldOverview.md',
      label: '临时替换',
    });
    assert.equal(second.registry.entries.length, 1);
    assert.equal(second.replaced.path, '01_GDD/GDD.md');
    assert.equal(readDesignCanonRegistry(vault).entries[0].path, '02_Worldbuilding/WorldOverview.md');
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test('canonical suggestions prefer stable source files and reject version or recovery copies', () => {
  const entries = [
    entry('01_GDD/GDD.md', 'GDD', '# Game Design Document\nstatus: approved'),
    entry('01_GDD/GameDesignSpec_v2.md', 'GDD v2', '# Game Design Document\nstatus: approved'),
    entry('01_GDD/GDD.md.conflict-123.md', 'Conflict', '# Game Design Document'),
    entry('02_Worldbuilding/WorldOverview.md', 'World Overview', '# 世界观'),
  ];
  const candidates = suggestCanonicalDocuments(entries);
  assert.ok(candidates.some((candidate) => candidate.domain === 'gdd' && candidate.path === '01_GDD/GDD.md'));
  assert.ok(candidates.some((candidate) => candidate.domain === 'worldbuilding' && candidate.path === '02_Worldbuilding/WorldOverview.md'));
  assert.equal(candidates.some((candidate) => /v2|conflict/i.test(candidate.path)), false);
});

test('change impact analysis finds direct document dependents, terminology users, and active tasks', () => {
  const entries = [
    entry('01_GDD/GDD.md', 'GDD', '# GDD\n灵纹驱动岛屿成长。'),
    entry('04_Maps/LotusPondIsland.md', 'Lotus Pond Island', '# 莲池岛\n依据 [[GDD]]，灵纹决定产出。'),
    entry('03_Characters/Spirit.md', 'Spirit', '# 角色\n角色会解锁灵纹。'),
    entry('99_Devlog/Old.md', 'Old', '# 日志\n无关记录。'),
  ];
  const registry = {
    kind: 'ars-note.design-canon',
    version: 1,
    updatedAt: '2026-07-31T00:00:00.000Z',
    entries: [{
      domain: 'gdd',
      path: '01_GDD/GDD.md',
      label: 'GDD',
      responsibility: '核心规则',
      updatedAt: '2026-07-31T00:00:00.000Z',
    }],
  };
  const result = analyzeDesignChange(entries, registry, {
    sourcePath: '01_GDD/GDD.md',
    changeSummary: '收敛灵纹规则并移除重复成长层级',
    terms: '["灵纹"]',
    tasks: [{
      id: 'T-01',
      title: '实现灵纹产出',
      owner: '程序',
      status: 'doing',
      linkedDoc: '01_GDD/GDD.md',
    }],
  });
  assert.equal(result.sourceDomain, 'gdd');
  assert.deepEqual(result.canonicalDomains, ['gdd']);
  assert.equal(result.impactedDocuments[0].path, '04_Maps/LotusPondIsland.md');
  assert.equal(result.impactedDocuments[0].severity, 'high');
  assert.ok(result.impactedDocuments.some((document) => document.path === '03_Characters/Spirit.md'));
  assert.equal(result.impactedTasks[0].id, 'T-01');
  assert.equal(result.scheduleDecisionRequired, true);
  assert.match(result.decisionRequirements.join('\n'), /Required now/);
});

test('prompt context exposes registered canonical ownership to every planning request', () => {
  const vault = makeVault();
  try {
    setCanonicalDesignDocument(vault, {
      domain: 'gdd',
      path: '01_GDD/GDD.md',
      responsibility: '核心玩法和范围',
    });
    const context = buildDesignCanonPromptContext(vault, [
      entry('01_GDD/GDD.md', 'GDD', '# GDD'),
    ]);
    assert.match(context, /ARS-NOTE CANONICAL DESIGN DOCUMENTS/);
    assert.match(context, /gdd: 01_GDD\/GDD\.md/);
    assert.match(context, /Update registered canonical documents in place/);
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});
