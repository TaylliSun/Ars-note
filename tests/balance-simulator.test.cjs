const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sampleSimulationPoints,
  getModelPrimaryMetric,
  simulateCombat,
  simulateDrop,
  simulateEconomy,
  simulateGrowth,
  simulateSensitivity,
} = require('../dist-test/src/utils/balanceSimulator.js');

test('growth simulator produces stable linear and compound curves', () => {
  const linear = simulateGrowth({ mode: 'linear', startValue: 100, levels: 5, linearStep: 25, growthRate: 0, exponent: 1 });
  assert.deepEqual(linear.points.map((point) => point.value), [100, 125, 150, 175, 200]);
  assert.equal(linear.averageStep, 25);

  const compound = simulateGrowth({ mode: 'compound', startValue: 100, levels: 3, linearStep: 0, growthRate: 0.1, exponent: 1 });
  assert.ok(Math.abs(compound.end - 121) < 1e-9);
});

test('combat simulator applies defense, crit expectation and action timing', () => {
  const result = simulateCombat({ attack: 200, defense: 100, skillMultiplier: 1, critRate: 0.5, critMultiplier: 2, hitCount: 2, enemyHp: 1000, actionInterval: 2 });
  assert.equal(result.normalHit, 100);
  assert.equal(result.expectedActionDamage, 300);
  assert.equal(result.actionsToDefeat, 4);
  assert.equal(result.expectedSeconds, 8);
  assert.equal(result.expectedDps, 150);
});

test('economy simulator identifies first deficit day and totals', () => {
  const result = simulateEconomy({ startBalance: 100, days: 4, dailyIncome: 10, dailyExpense: 50, incomeGrowthRate: 0, expenseGrowthRate: 0 });
  assert.equal(result.firstDeficitDay, 3);
  assert.equal(result.endBalance, -60);
  assert.equal(result.totalIncome, 40);
  assert.equal(result.totalExpense, 200);
});

test('drop simulator supports exact hard pity probability and expected copies', () => {
  const guaranteed = simulateDrop({ baseRate: 0, attempts: 20, pityAt: 10, guaranteedPity: true });
  assert.equal(guaranteed.probabilityAtLeastOne, 1);
  assert.equal(guaranteed.expectedCopies, 2);
  assert.equal(guaranteed.averagePullsPerCopy, 10);

  const ordinary = simulateDrop({ baseRate: 0.1, attempts: 2, pityAt: 100, guaranteedPity: false });
  assert.ok(Math.abs(ordinary.probabilityAtLeastOne - 0.19) < 1e-12);
  assert.ok(Math.abs(ordinary.expectedCopies - 0.2) < 1e-12);
});

test('point sampling preserves first and last values', () => {
  const points = Array.from({ length: 100 }, (_, x) => ({ x, value: x * x }));
  const sampled = sampleSimulationPoints(points, 12);
  assert.equal(sampled.length, 12);
  assert.deepEqual(sampled[0], points[0]);
  assert.deepEqual(sampled.at(-1), points.at(-1));
});

test('sensitivity analysis varies one input and returns the selected primary metric', () => {
  const config = { attack: 200, defense: 100, skillMultiplier: 1, critRate: 0.25, critMultiplier: 2, hitCount: 1, enemyHp: 1000, actionInterval: 1 };
  const points = simulateSensitivity('combat', config, 'attack', 0.2, 5);
  assert.equal(points.length, 5);
  assert.equal(points[0].input, 160);
  assert.equal(points.at(-1).input, 240);
  assert.ok(points.every((point, index) => index === 0 || point.value > points[index - 1].value));
  assert.equal(points[2].value, getModelPrimaryMetric('combat', config));
});

test('sensitivity analysis rejects non-numeric parameters without throwing', () => {
  const config = { mode: 'compound', startValue: 100, levels: 10, linearStep: 10, growthRate: 0.1, exponent: 1.5 };
  assert.deepEqual(simulateSensitivity('growth', config, 'mode'), []);
});
