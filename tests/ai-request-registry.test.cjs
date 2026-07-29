const test = require('node:test');
const assert = require('node:assert/strict');
const { AIRequestRegistry } = require('../dist-test/electron/aiRequestRegistry.js');

test('AI request registry cancels and cleans up an active request', () => {
  const registry = new AIRequestRegistry();
  const handle = registry.begin(7, 'request-a', 10_000);

  assert.equal(handle.signal.aborted, false);
  assert.equal(registry.activeCount, 1);
  assert.equal(registry.cancel(7, 'request-a'), true);
  assert.equal(handle.signal.aborted, true);
  assert.equal(handle.getAbortReason(), 'cancelled');

  handle.dispose();
  assert.equal(registry.activeCount, 0);
});

test('AI request registry times out an abandoned request', async () => {
  const registry = new AIRequestRegistry();
  const handle = registry.begin(3, 'request-timeout', 5);

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(handle.signal.aborted, true);
  assert.equal(handle.getAbortReason(), 'timeout');
  handle.dispose();
  assert.equal(registry.activeCount, 0);
});

test('starting the same request id replaces the old request safely', () => {
  const registry = new AIRequestRegistry();
  const first = registry.begin(9, 'same-id', 10_000);
  const second = registry.begin(9, 'same-id', 10_000);

  assert.equal(first.signal.aborted, true);
  assert.equal(first.getAbortReason(), 'cancelled');
  assert.equal(second.signal.aborted, false);
  assert.equal(registry.activeCount, 1);

  first.dispose();
  assert.equal(registry.activeCount, 1);
  second.dispose();
  assert.equal(registry.activeCount, 0);
});
