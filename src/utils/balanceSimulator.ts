export type BalanceModelKind = 'growth' | 'combat' | 'economy' | 'drop';

export type SimulationPoint = {
  x: number;
  value: number;
  secondary?: number;
};

export type GrowthConfig = {
  mode: 'linear' | 'compound' | 'power';
  startValue: number;
  levels: number;
  linearStep: number;
  growthRate: number;
  exponent: number;
};

export type CombatConfig = {
  attack: number;
  defense: number;
  skillMultiplier: number;
  critRate: number;
  critMultiplier: number;
  hitCount: number;
  enemyHp: number;
  actionInterval: number;
};

export type EconomyConfig = {
  startBalance: number;
  days: number;
  dailyIncome: number;
  dailyExpense: number;
  incomeGrowthRate: number;
  expenseGrowthRate: number;
};

export type DropConfig = {
  baseRate: number;
  attempts: number;
  pityAt: number;
  guaranteedPity: boolean;
};

export type BalanceConfig = GrowthConfig | CombatConfig | EconomyConfig | DropConfig;

export type SensitivityPoint = SimulationPoint & {
  input: number;
  multiplier: number;
};

export type GrowthResult = {
  points: SimulationPoint[];
  start: number;
  end: number;
  totalGrowth: number;
  averageStep: number;
};

export type CombatResult = {
  points: SimulationPoint[];
  normalHit: number;
  expectedActionDamage: number;
  minActionDamage: number;
  maxActionDamage: number;
  actionsToDefeat: number;
  expectedSeconds: number;
  expectedDps: number;
};

export type EconomyResult = {
  points: SimulationPoint[];
  endBalance: number;
  totalIncome: number;
  totalExpense: number;
  netChange: number;
  firstDeficitDay: number | null;
};

export type DropResult = {
  points: SimulationPoint[];
  probabilityAtLeastOne: number;
  expectedCopies: number;
  averagePullsPerCopy: number;
  probabilityNoDrop: number;
};

const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, finite(value, min)));
const positiveInteger = (value: number, max: number) => Math.round(clamp(value, 1, max));

export function simulateGrowth(config: GrowthConfig): GrowthResult {
  const levels = positiveInteger(config.levels, 1000);
  const start = Math.max(0, finite(config.startValue));
  const rate = clamp(config.growthRate, -0.99, 10);
  const step = finite(config.linearStep);
  const exponent = clamp(config.exponent, 0.01, 8);
  const points = Array.from({ length: levels }, (_, index) => {
    const level = index + 1;
    let value = start;
    if (config.mode === 'linear') value = start + step * index;
    if (config.mode === 'compound') value = start * Math.pow(1 + rate, index);
    if (config.mode === 'power') value = start * Math.pow(level, exponent);
    return { x: level, value: Math.max(0, finite(value)) };
  });
  const end = points[points.length - 1]?.value ?? start;
  return {
    points,
    start,
    end,
    totalGrowth: end - start,
    averageStep: levels > 1 ? (end - start) / (levels - 1) : 0,
  };
}

export function simulateCombat(config: CombatConfig): CombatResult {
  const attack = Math.max(0, finite(config.attack));
  const defense = Math.max(0, finite(config.defense));
  const multiplier = Math.max(0, finite(config.skillMultiplier));
  const critRate = clamp(config.critRate, 0, 1);
  const critMultiplier = Math.max(1, finite(config.critMultiplier, 1));
  const hitCount = positiveInteger(config.hitCount, 100);
  const enemyHp = Math.max(1, finite(config.enemyHp, 1));
  const actionInterval = Math.max(0.01, finite(config.actionInterval, 1));
  const mitigation = 100 / (100 + defense);
  const normalHit = attack * multiplier * mitigation;
  const minActionDamage = normalHit * hitCount;
  const maxActionDamage = minActionDamage * critMultiplier;
  const expectedActionDamage = normalHit * hitCount * (1 + critRate * (critMultiplier - 1));
  const safeExpectedDamage = Math.max(expectedActionDamage, Number.EPSILON);
  const actionsToDefeat = Math.ceil(enemyHp / safeExpectedDamage);
  const expectedSeconds = actionsToDefeat * actionInterval;
  const expectedDps = expectedActionDamage / actionInterval;
  const pointCount = Math.min(actionsToDefeat, 80);
  const points = Array.from({ length: pointCount + 1 }, (_, index) => {
    const action = pointCount === actionsToDefeat ? index : Math.round((index / pointCount) * actionsToDefeat);
    return {
      x: action,
      value: Math.max(0, enemyHp - expectedActionDamage * action),
      secondary: Math.min(enemyHp, expectedActionDamage * action),
    };
  });
  return { points, normalHit, expectedActionDamage, minActionDamage, maxActionDamage, actionsToDefeat, expectedSeconds, expectedDps };
}

export function simulateEconomy(config: EconomyConfig): EconomyResult {
  const days = positiveInteger(config.days, 3650);
  const startBalance = finite(config.startBalance);
  const baseIncome = Math.max(0, finite(config.dailyIncome));
  const baseExpense = Math.max(0, finite(config.dailyExpense));
  const incomeRate = clamp(config.incomeGrowthRate, -0.99, 2);
  const expenseRate = clamp(config.expenseGrowthRate, -0.99, 2);
  let balance = startBalance;
  let totalIncome = 0;
  let totalExpense = 0;
  let firstDeficitDay: number | null = balance < 0 ? 0 : null;
  const points: SimulationPoint[] = [{ x: 0, value: balance, secondary: 0 }];
  for (let day = 1; day <= days; day += 1) {
    const income = baseIncome * Math.pow(1 + incomeRate, day - 1);
    const expense = baseExpense * Math.pow(1 + expenseRate, day - 1);
    totalIncome += income;
    totalExpense += expense;
    balance += income - expense;
    if (firstDeficitDay === null && balance < 0) firstDeficitDay = day;
    points.push({ x: day, value: balance, secondary: income - expense });
  }
  return { points, endBalance: balance, totalIncome, totalExpense, netChange: balance - startBalance, firstDeficitDay };
}

export function simulateDrop(config: DropConfig): DropResult {
  const attempts = positiveInteger(config.attempts, 5000);
  const baseRate = clamp(config.baseRate, 0, 1);
  const pityAt = positiveInteger(config.pityAt, 1000);
  let pityStates = new Float64Array(pityAt);
  pityStates[0] = 1;
  let expectedCopies = 0;
  let noDropProbability = 1;
  let noDropPity = 0;
  const points: SimulationPoint[] = [{ x: 0, value: 0, secondary: 0 }];

  for (let pull = 1; pull <= attempts; pull += 1) {
    const nextStates = new Float64Array(pityAt);
    let successThisPull = 0;
    for (let pity = 0; pity < pityAt; pity += 1) {
      const stateProbability = pityStates[pity];
      if (stateProbability === 0) continue;
      const guaranteed = config.guaranteedPity && pity + 1 >= pityAt;
      const successRate = guaranteed ? 1 : baseRate;
      const successProbability = stateProbability * successRate;
      successThisPull += successProbability;
      nextStates[0] += successProbability;
      if (!guaranteed) nextStates[Math.min(pity + 1, pityAt - 1)] += stateProbability * (1 - successRate);
    }
    pityStates = nextStates;
    expectedCopies += successThisPull;

    const noDropGuaranteed = config.guaranteedPity && noDropPity + 1 >= pityAt;
    const noDropSuccessRate = noDropGuaranteed ? 1 : baseRate;
    noDropProbability *= 1 - noDropSuccessRate;
    noDropPity = noDropGuaranteed ? 0 : Math.min(noDropPity + 1, pityAt - 1);
    points.push({ x: pull, value: 1 - noDropProbability, secondary: expectedCopies });
  }

  return {
    points,
    probabilityAtLeastOne: 1 - noDropProbability,
    expectedCopies,
    averagePullsPerCopy: expectedCopies > 0 ? attempts / expectedCopies : Number.POSITIVE_INFINITY,
    probabilityNoDrop: noDropProbability,
  };
}

export function simulateModelPoints(kind: BalanceModelKind, config: BalanceConfig): SimulationPoint[] {
  if (kind === 'growth') return simulateGrowth(config as GrowthConfig).points;
  if (kind === 'combat') return simulateCombat(config as CombatConfig).points;
  if (kind === 'economy') return simulateEconomy(config as EconomyConfig).points;
  return simulateDrop(config as DropConfig).points;
}

export function getModelPrimaryMetric(kind: BalanceModelKind, config: BalanceConfig): number {
  if (kind === 'growth') return simulateGrowth(config as GrowthConfig).end;
  if (kind === 'combat') return simulateCombat(config as CombatConfig).expectedDps;
  if (kind === 'economy') return simulateEconomy(config as EconomyConfig).endBalance;
  return simulateDrop(config as DropConfig).probabilityAtLeastOne;
}

export function simulateSensitivity(
  kind: BalanceModelKind,
  config: BalanceConfig,
  parameter: string,
  range = 0.2,
  steps = 9,
): SensitivityPoint[] {
  const source = config as unknown as Record<string, unknown>;
  const baseValue = Number(source[parameter]);
  if (!Number.isFinite(baseValue)) return [];
  const safeRange = clamp(range, 0.01, 0.95);
  const safeSteps = Math.round(clamp(steps, 3, 51));
  const denominator = Math.max(1, safeSteps - 1);
  const scale = Math.max(Math.abs(baseValue), 1);
  return Array.from({ length: safeSteps }, (_, index) => {
    const offset = -safeRange + (safeRange * 2 * index) / denominator;
    const input = baseValue + scale * offset;
    const candidate = { ...source, [parameter]: input } as unknown as BalanceConfig;
    return {
      x: input,
      input,
      multiplier: 1 + offset,
      value: getModelPrimaryMetric(kind, candidate),
    };
  });
}

export function sampleSimulationPoints(points: SimulationPoint[], limit = 12): SimulationPoint[] {
  if (points.length <= limit) return points;
  const indexes = new Set<number>([0, points.length - 1]);
  for (let i = 1; i < limit - 1; i += 1) indexes.add(Math.round((i / (limit - 1)) * (points.length - 1)));
  return [...indexes].sort((a, b) => a - b).map((index) => points[index]);
}
