const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGameDesignSpecialistBrief,
  routeGameDesignSpecialists,
} = require('../dist-test/src/utils/gameDesignSpecialists.js');
const { buildAIChatRequest, QUICK_PROMPTS } = require('../dist-test/src/utils/aiClient.js');

test('routes a resource-loop feature to system design with economy and technical review', () => {
  const route = routeGameDesignSpecialists({
    prompt: '设计莲池岛养成系统，包含灵气产出、消耗、解锁条件和防止无限刷资源的规则。',
    currentFilePath: '01_GDD/GDD.md',
  });
  assert.equal(route.primary.id, 'system');
  assert.deepEqual(route.reviewers.map((item) => item.id), ['economy', 'technical']);
});

test('routes formulas and balancing work to economy design', () => {
  const route = routeGameDesignSpecialists({
    prompt: '完善角色成长曲线和伤害公式，给出变量单位、概率、上限、演算样例和调参区间。',
  });
  assert.equal(route.primary.id, 'economy');
  assert.match(route.primary.outputContract.join('\n'), /公式/);
});

test('uses the current file path to strengthen technical and narrative routing', () => {
  const technical = routeGameDesignSpecialists({
    prompt: '完善当前 Unity 技术方案和编辑器工具需求。',
    currentFilePath: '07_Unity_Tasks/T027_ComboIndicator.md',
  });
  const narrative = routeGameDesignSpecialists({
    prompt: '整理这段剧情的角色动机、任务分支、台词和演出节拍。',
    currentFilePath: '02_Worldbuilding/NarrativePipeline.md',
  });
  assert.equal(technical.primary.id, 'technical');
  assert.equal(narrative.primary.id, 'narrative');
});

test('uses lead design for a whole-project GDD and ignores non-planning chat', () => {
  assert.equal(routeGameDesignSpecialists({ prompt: '写一份完整 GDD 策划案，梳理产品支柱和里程碑。' }).primary.id, 'lead');
  assert.equal(routeGameDesignSpecialists({ prompt: '帮我把这句话写得自然一点。' }), null);
  assert.equal(routeGameDesignSpecialists({ prompt: 'build the desktop package and delete the old task file' }), null);
});

test('specialist brief requires evidence, traceability, cross-review, and non-numeric gates', () => {
  const brief = buildGameDesignSpecialistBrief({
    prompt: '写一份关卡策划案，包括灰盒、动线、检查点和刷怪节奏。',
    currentFilePath: '04_Maps/LotusPondIsland.md',
  });
  assert.match(brief, /Primary specialist: 关卡策划/);
  assert.match(brief, /Inspect first:/);
  assert.match(brief, /traceability matrix/);
  assert.match(brief, /Cross-review contract/);
  assert.match(brief, /Do not claim quality scores such as 100\/100/);
});

test('AI requests inject the selected professional design studio brief', () => {
  const request = buildAIChatRequest('设计一套技能战斗系统，包含前摇、命中、伤害和打击反馈。', {
    contextMode: 'gameWorkspace',
    currentFilePath: '01_GDD/GDD.md',
  });
  const system = request.messages[0].content;
  const user = request.messages.at(-1).content;
  assert.match(system, /Professional Game Design Studio Protocol/);
  assert.match(user, /Professional Game Design Studio Brief/);
  assert.match(user, /Primary specialist: 战斗策划/);
  assert.match(user, /Review specialists:/);
});

test('professional design review quick prompt is read-only and invokes discipline review gates', () => {
  const prompt = QUICK_PROMPTS.find((item) => item.id === 'professional-design-review');
  assert.ok(prompt);
  assert.equal(prompt.contextMode, 'currentNote');
  assert.match(prompt.prompt, /read-only review/i);
  assert.match(prompt.prompt, /Passed, Needs review, or Blocked/);
  assert.doesNotMatch(prompt.prompt, /create_canvas|create_wireframe/);
});
