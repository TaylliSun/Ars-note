const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractAIUserIntentText,
  retrieveRelevantVaultContext,
  tokenizeVaultRetrievalText,
} = require('../dist-test/electron/aiVaultRetriever.js');

function entry(relPath, title, content, tags = []) {
  return {
    relPath,
    fullPath: `C:/vault/${relPath}`,
    title,
    tags,
    content,
    searchContent: content.toLowerCase(),
  };
}

test('retrieval extracts the actual user request from injected context', () => {
  const input = 'Current note:\nLots of unrelated text\n\nUser request:\n检查灵纹系统和莲池岛的一致性';
  assert.equal(extractAIUserIntentText(input), '检查灵纹系统和莲池岛的一致性');
});

test('Chinese tokenization creates useful phrase and n-gram search terms', () => {
  const tokens = tokenizeVaultRetrievalText('检查灵纹系统和莲池岛的一致性');
  assert.ok(tokens.includes('灵纹'));
  assert.ok(tokens.includes('莲池'));
  assert.ok(tokens.some(token => token.includes('灵纹系统')));
});

test('chunk retrieval returns the relevant heading instead of unrelated full documents', () => {
  const entries = [
    entry(
      '01_GDD/GDD.md',
      'Game Design',
      '# 核心玩法\n玩家建设岛屿并收集资源。\n\n## 灵纹系统\n灵纹用于组合五行效果，并驱动莲池岛反馈。\n\n## 商店\n商店出售基础材料。',
    ),
    entry(
      '03_Characters/Hero.md',
      'Hero',
      '# 主角\n角色喜欢冒险，与灵纹系统没有直接设计关系。',
    ),
    entry(
      '99_Devlog/Build.md',
      'Build Log',
      '# 构建记录\n修复窗口按钮。',
    ),
  ];

  const result = retrieveRelevantVaultContext(entries, '检查灵纹系统和莲池岛的一致性', {
    maxChunks: 3,
    maxChunksPerFile: 1,
  });

  assert.ok(result.chunks.length >= 1);
  assert.equal(result.chunks[0].path, '01_GDD/GDD.md');
  assert.equal(result.chunks[0].heading, '灵纹系统');
  assert.match(result.contextText, /SOURCE: 01_GDD\/GDD\.md/);
  assert.doesNotMatch(result.contextText, /构建记录/);
});
