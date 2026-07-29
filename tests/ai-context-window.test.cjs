const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AI_RUNTIME_CONTEXT_TOKEN_LIMIT,
  estimateAIContextTokens,
  fitAIContextWindow,
} = require('../dist-test/electron/aiContextWindow.js');

test('context token estimation accounts for Chinese text more heavily than ASCII characters', () => {
  assert.ok(estimateAIContextTokens('灵纹系统与莲池岛') > estimateAIContextTokens('abcdefgh'));
});

test('runtime context manager compresses old turns and preserves the latest request', () => {
  const system = {
    role: 'system',
    content: `SYSTEM START\n${'rules '.repeat(1500)}\nSYSTEM END`,
  };
  const history = Array.from({ length: 24 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `turn-${index} 01_GDD/GDD.md 决定：保留灵纹设定。\n${'旧对话内容'.repeat(2200)}`,
  }));
  const latest = {
    role: 'user',
    content: `CURRENT REQUEST START\n${'当前文档上下文'.repeat(9000)}\n请检查所有灵纹文档\nCURRENT REQUEST END`,
  };

  const result = fitAIContextWindow([system, ...history, latest], 18_000);
  assert.equal(result.usage.compressed, true);
  assert.ok(result.usage.usedTokens <= 18_500);
  assert.match(String(result.messages.at(-1).content), /CURRENT REQUEST START/);
  assert.match(String(result.messages.at(-1).content), /CURRENT REQUEST END/);
  assert.match(String(result.messages[1].content), /01_GDD\/GDD\.md/);
  assert.match(String(result.messages[1].content), /决定/);
});

test('default runtime budget is a conservative 120K tokens', () => {
  assert.equal(AI_RUNTIME_CONTEXT_TOKEN_LIMIT, 120_000);
});

test('hundreds of old turns collapse into one evidence summary within budget', () => {
  const messages = [
    { role: 'system', content: 'Ars-note system rules\n' + '规则'.repeat(8000) },
    ...Array.from({ length: 320 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `turn ${index}\nDecision: keep 02_Worldbuilding/WorldOverview.md\n${'长期历史'.repeat(450)}`,
    })),
    { role: 'user', content: '当前请求：检查所有文档中的“装饰”，统一改为“灵纹”。' },
  ];

  const result = fitAIContextWindow(messages, 24_000);

  assert.ok(result.usage.usedTokens <= 24_000);
  assert.match(result.messages.at(-1).content, /当前请求/);
  assert.ok(result.usage.compressionNotes.some(note => note.includes('Collapsed very long multi-turn history')));
  assert.ok(result.messages.some(message => message.content.includes('02_Worldbuilding/WorldOverview.md')));
});
