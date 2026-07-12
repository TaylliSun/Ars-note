const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ARSNOTE_AI_IDENTITY_PROMPT,
  enforceArsNoteProductIdentity,
} = require('../dist-test/src/utils/aiIdentity.js');
const { buildAIChatRequest, QUICK_PROMPTS } = require('../dist-test/src/utils/aiClient.js');

test('system prompt identifies the assistant as Ars-note rather than Obsidian', () => {
  const request = buildAIChatRequest('你是谁？', { contextMode: 'currentNote' });
  const system = request.messages[0]?.content || '';
  assert.match(system, /You are Ars-note AI Agent/);
  assert.match(system, /You are not Obsidian/);
  assert.doesNotMatch(system, /this Obsidian game workspace/i);
});

test('identity normalization preserves the legacy path but fixes product wording', () => {
  const source = 'Act in this Obsidian game workspace. Refresh the Obsidian command center at .ars-team/obsidian-command-center.md.';
  const normalized = enforceArsNoteProductIdentity(source);
  assert.match(normalized, /this Ars-note game workspace/);
  assert.match(normalized, /Ars-note team command center/);
  assert.match(normalized, /\.ars-team\/obsidian-command-center\.md/);
  assert.match(ARSNOTE_AI_IDENTITY_PROMPT, /built-in AI Agent/);
});

test('production quick prompts no longer frame the current app as Obsidian', () => {
  const nextTasks = QUICK_PROMPTS.find((prompt) => prompt.id === 'suggest-next-tasks');
  assert.ok(nextTasks);
  assert.doesNotMatch(nextTasks.prompt, /this Obsidian game workspace/i);
});
