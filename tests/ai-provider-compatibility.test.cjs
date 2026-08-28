const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldRetryAIRequestWithoutTools,
} = require('../dist-test/electron/aiProviderCompatibility.js');

test('tool capability errors retry as a plain chat request', () => {
  assert.equal(
    shouldRetryAIRequestWithoutTools(400, '{"error":"unknown field tools: this model does not support tool calls"}'),
    true,
  );
  assert.equal(
    shouldRetryAIRequestWithoutTools(422, 'function_call is not supported by this endpoint'),
    true,
  );
});

test('authentication and unrelated request errors do not hide behind a tool fallback', () => {
  assert.equal(shouldRetryAIRequestWithoutTools(401, 'invalid api key'), false);
  assert.equal(shouldRetryAIRequestWithoutTools(400, 'maximum context length exceeded'), false);
  assert.equal(shouldRetryAIRequestWithoutTools(500, 'tool backend unavailable'), false);
});
