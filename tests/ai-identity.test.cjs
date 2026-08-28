const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ARSNOTE_AI_IDENTITY_PROMPT,
} = require('../dist-test/src/utils/aiIdentity.js');
const { buildAIChatRequest, QUICK_PROMPTS } = require('../dist-test/src/utils/aiClient.js');
const retiredIdentityPattern = new RegExp(String.fromCharCode(79, 98, 115, 105, 100, 105, 97, 110), 'i');

test('system prompt exposes only the Ars-note product identity', () => {
  const request = buildAIChatRequest('你是谁？', { contextMode: 'currentNote' });
  const system = request.messages[0]?.content || '';
  assert.match(system, /You are Ars-note AI Agent/);
  assert.match(system, /current product identity is always Ars-note|Always call the current application/i);
  assert.doesNotMatch(system, retiredIdentityPattern);
  assert.match(ARSNOTE_AI_IDENTITY_PROMPT, /built-in AI Agent/);
});

test('production quick prompts expose only Ars-note identity', () => {
  const nextTasks = QUICK_PROMPTS.find((prompt) => prompt.id === 'suggest-next-tasks');
  assert.ok(nextTasks);
  assert.doesNotMatch(nextTasks.prompt, retiredIdentityPattern);
});
