const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DesignQualityAuditCache,
  createDesignQualityAuditKey,
} = require('../dist-test/src/utils/designQualityAuditCache.js');

function report(path, marker) {
  return {
    path,
    kind: 'gdd',
    readiness: 'draft',
    passed: false,
    maturityScore: marker,
    naturalnessScore: 80,
    characterCount: 10,
    analyzedCharacterCount: 10,
    analysisScope: 'full',
    checks: [],
    issues: [],
    strengths: [],
    naturalnessIssues: [],
    analyzedAt: '2026-08-09T00:00:00.000Z',
  };
}

test('concurrent requests for the same document share one audit run', async () => {
  const cache = new DesignQualityAuditCache();
  const request = { filePath: 'D:\\Vault\\GDD.md', content: '# GDD' };
  let runs = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const runner = async () => {
    runs += 1;
    await gate;
    return report(request.filePath, runs);
  };

  const first = cache.request(request, runner);
  const second = cache.request(request, runner);
  release();
  const [firstReport, secondReport] = await Promise.all([first, second]);

  assert.equal(runs, 1);
  assert.strictEqual(firstReport, secondReport);
  assert.equal(cache.getStats().joins, 1);
});

test('completed reports are reused until document content changes', async () => {
  const cache = new DesignQualityAuditCache();
  let runs = 0;
  const runner = async (request) => report(request.filePath, ++runs);
  const base = { filePath: 'D:/Vault/GDD.md', content: 'first' };

  const first = await cache.request(base, runner);
  const cached = await cache.request({ ...base }, runner);
  const changed = await cache.request({ ...base, content: 'second' }, runner);

  assert.strictEqual(cached, first);
  assert.equal(changed.maturityScore, 2);
  assert.equal(runs, 2);
  assert.equal(cache.getStats().hits, 1);
});

test('path normalization and audit options form a stable cache key', () => {
  const first = createDesignQualityAuditKey({
    filePath: 'D:\\Vault\\GDD.md',
    content: 'same',
    options: { totalCharacterCount: 100, sampled: true },
  });
  const second = createDesignQualityAuditKey({
    filePath: 'd:/vault/gdd.md',
    content: 'same',
    options: { totalCharacterCount: 100, sampled: true },
  });
  const full = createDesignQualityAuditKey({
    filePath: 'd:/vault/gdd.md',
    content: 'same',
    options: { totalCharacterCount: 100, sampled: false },
  });

  assert.equal(first, second);
  assert.notEqual(first, full);
});

test('forced requests bypass a completed report but join an active run', async () => {
  const cache = new DesignQualityAuditCache();
  const request = { filePath: 'GDD.md', content: 'body' };
  let runs = 0;
  const runner = async () => report(request.filePath, ++runs);

  await cache.request(request, runner);
  await cache.request(request, runner, { force: true });
  assert.equal(runs, 2);

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const slowRunner = async () => {
    runs += 1;
    await gate;
    return report(request.filePath, runs);
  };
  const active = cache.request({ ...request, content: 'changed' }, slowRunner);
  const joined = cache.request({ ...request, content: 'changed' }, slowRunner, { force: true });
  release();
  await Promise.all([active, joined]);
  assert.equal(runs, 3);
});

test('the cache evicts least recently used reports at its size bound', async () => {
  const cache = new DesignQualityAuditCache(2);
  let runs = 0;
  const runner = async (request) => report(request.filePath, ++runs);
  const first = { filePath: 'one.md', content: 'one' };
  const second = { filePath: 'two.md', content: 'two' };
  const third = { filePath: 'three.md', content: 'three' };

  await cache.request(first, runner);
  await cache.request(second, runner);
  await cache.request(first, runner);
  await cache.request(third, runner);
  await cache.request(second, runner);

  assert.equal(runs, 4);
  assert.equal(cache.getStats().entries, 2);
});

test('failed audits are never cached', async () => {
  const cache = new DesignQualityAuditCache();
  const request = { filePath: 'broken.md', content: 'body' };
  let runs = 0;
  const runner = async () => {
    runs += 1;
    if (runs === 1) throw new Error('audit failed');
    return report(request.filePath, runs);
  };

  await assert.rejects(cache.request(request, runner), /audit failed/);
  const recovered = await cache.request(request, runner);

  assert.equal(recovered.maturityScore, 2);
  assert.equal(runs, 2);
});
