const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AI_CHAT_CENTER_WINDOW_SIZE,
  getAIChatScrollToken,
  getAIChatWindow,
  getAIConversationIdentity,
  isAIChatNearBottom,
} = require('../dist-test/src/utils/aiChatPresentation.js');

function message(index, overrides = {}) {
  return {
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message-${index}`,
    createdAt: `2026-07-13T00:${String(index).padStart(2, '0')}:00.000Z`,
    ...overrides,
  };
}

test('AI chat window renders the newest messages and keeps older history available', () => {
  const messages = Array.from({ length: 80 }, (_, index) => message(index));
  const window = getAIChatWindow(messages, AI_CHAT_CENTER_WINDOW_SIZE);

  assert.equal(window.hiddenCount, 56);
  assert.equal(window.startIndex, 56);
  assert.equal(window.visibleItems.length, 24);
  assert.equal(window.visibleItems[0].content, 'message-56');
  assert.equal(window.visibleItems.at(-1).content, 'message-79');
});

test('AI chat conversation identity stays stable when messages append and changes for another history', () => {
  const firstConversation = [message(0), message(1)];
  const appendedConversation = [...firstConversation, message(2)];
  const otherConversation = [message(0, { content: 'different first message' }), message(1)];

  assert.equal(getAIConversationIdentity(firstConversation), getAIConversationIdentity(appendedConversation));
  assert.notEqual(getAIConversationIdentity(firstConversation), getAIConversationIdentity(otherConversation));
});

test('AI chat scroll token detects same-length history replacements', () => {
  const firstHistory = [message(0), message(1)];
  const secondHistory = [message(0, { content: 'another opening' }), message(1, { content: 'another response' })];

  assert.notEqual(getAIChatScrollToken(firstHistory), getAIChatScrollToken(secondHistory));
  assert.notEqual(getAIChatScrollToken(firstHistory, 'idle'), getAIChatScrollToken(firstHistory, 'sending'));
});

test('AI chat bottom detection allows a small layout tolerance without overriding deliberate reading', () => {
  assert.equal(isAIChatNearBottom({ scrollHeight: 1000, scrollTop: 820, clientHeight: 100 }), true);
  assert.equal(isAIChatNearBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 100 }), false);
});
