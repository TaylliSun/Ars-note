const test = require('node:test');
const assert = require('node:assert/strict');

const { createCoalescedAsyncRunner } = require('../dist-test/src/utils/coalescedAsyncRunner.js');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('scheduled async work is debounced into one run', async () => {
  let runCount = 0;
  const runner = createCoalescedAsyncRunner(async () => { runCount += 1; }, 15);

  runner.schedule();
  runner.schedule();
  runner.schedule();
  await wait(40);

  assert.equal(runCount, 1);
  assert.equal(runner.isPending(), false);
});

test('requests received during a run coalesce into one follow-up run', async () => {
  let runCount = 0;
  let releaseFirstRun;
  const firstRunGate = new Promise((resolve) => { releaseFirstRun = resolve; });
  const runner = createCoalescedAsyncRunner(async () => {
    runCount += 1;
    if (runCount === 1) await firstRunGate;
  });

  const first = runner.runNow();
  const second = runner.runNow();
  const third = runner.runNow();
  releaseFirstRun();
  await Promise.all([first, second, third]);

  assert.equal(runCount, 2);
  assert.equal(runner.isPending(), false);
});

test('cancelling drops scheduled work that has not started', async () => {
  let runCount = 0;
  const runner = createCoalescedAsyncRunner(async () => { runCount += 1; }, 10);

  runner.schedule();
  runner.cancel();
  await wait(30);

  assert.equal(runCount, 0);
  assert.equal(runner.isPending(), false);
});

test('a failed run clears queued state and the runner can be used again', async () => {
  let runCount = 0;
  const runner = createCoalescedAsyncRunner(async () => {
    runCount += 1;
    if (runCount === 1) throw new Error('scan failed');
  });

  await assert.rejects(runner.runNow(), /scan failed/);
  assert.equal(runner.isPending(), false);
  await runner.runNow();

  assert.equal(runCount, 2);
  assert.equal(runner.isPending(), false);
});
