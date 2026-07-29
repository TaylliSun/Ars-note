const test = require('node:test');
const assert = require('node:assert/strict');

const { createDebouncedLatestWriter } = require('../dist-test/src/utils/debouncedLatestWriter.js');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('debounced writer persists only the latest queued value', async () => {
  const written = [];
  const writer = createDebouncedLatestWriter(async (value) => { written.push(value); }, 15);

  writer.schedule('first');
  writer.schedule('second');
  writer.schedule('latest');
  await wait(40);

  assert.deepEqual(written, ['latest']);
  assert.equal(writer.hasPending(), false);
});

test('writes stay serialized and edits during a write collapse to the latest value', async () => {
  const written = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  let releaseFirstWrite;
  const firstWriteGate = new Promise((resolve) => { releaseFirstWrite = resolve; });
  const writer = createDebouncedLatestWriter(async (value) => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    written.push(value);
    if (value === 1) await firstWriteGate;
    concurrent -= 1;
  }, 1000);

  writer.schedule(1);
  const flushing = writer.flush();
  writer.schedule(2);
  writer.schedule(3);
  releaseFirstWrite();
  await flushing;

  assert.deepEqual(written, [1, 3]);
  assert.equal(maxConcurrent, 1);
  assert.equal(writer.hasPending(), false);
});

test('flush bypasses the debounce delay', async () => {
  const written = [];
  const writer = createDebouncedLatestWriter(async (value) => { written.push(value); }, 60_000);

  writer.schedule('save-now');
  await writer.flush();

  assert.deepEqual(written, ['save-now']);
});

test('a failed value remains pending for an explicit retry', async () => {
  let attempts = 0;
  const writer = createDebouncedLatestWriter(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('disk unavailable');
  }, 60_000);

  writer.schedule('retry-me');
  await assert.rejects(writer.flush(), /disk unavailable/);
  assert.equal(writer.hasPending(), true);
  await writer.flush();

  assert.equal(attempts, 2);
  assert.equal(writer.hasPending(), false);
});
