const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGameDesignGovernanceBrief,
  buildGameDesignSpecialistBrief,
  routeGameDesignSpecialists,
} = require('../dist-test/src/utils/gameDesignSpecialists.js');
const { buildAdaptiveAISystemPrompt, buildAIChatRequest, QUICK_PROMPTS } = require('../dist-test/src/utils/aiClient.js');

test('routes a resource-loop feature to system design with economy and technical review', () => {
  const route = routeGameDesignSpecialists({
    prompt: '设计莲池岛养成系统，包含灵气产出、消耗、解锁条件和防止无限刷资源的规则。',
    currentFilePath: '01_GDD/GDD.md',
  });
  assert.equal(route.primary.id, 'system');
  assert.deepEqual(route.reviewers.map((item) => item.id), ['economy', 'technical']);
});

test('routes core-loop design to system with economy and UX cross-review', () => {
  const route = routeGameDesignSpecialists({
    prompt: '重新设计核心玩法循环，打通秒级操作、单次会话、局外成长和长期目标。',
    currentFilePath: '01_GDD/GameplayLoop.md',
  });
  assert.equal(route.primary.id, 'system');
  assert.deepEqual(route.reviewers.map((item) => item.id), ['economy', 'ux']);
  assert.match(route.matchedReasons.join('\n'), /核心循环/);
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

test('core-loop brief requires connected horizons, re-entry, prototype evidence, and ethical retention', () => {
  const brief = buildGameDesignSpecialistBrief({
    prompt: '设计游戏核心循环和会话循环。',
    currentFilePath: '01_GDD/GameplayLoop.md',
  });
  assert.match(brief, /moment-to-moment/);
  assert.match(brief, /re-entry condition/);
  assert.match(brief, /smallest playable loop prototype/);
  assert.match(brief, /dark-pattern risks/);
});

test('full GDD brief enforces one causal spine instead of treating combat as the loop', () => {
  const brief = buildGameDesignSpecialistBrief({
    prompt: '写一份完整 GDD，并把现有玩法整理成正式游戏设计文档。',
    currentFilePath: '01_GDD/GDD.md',
  });
  assert.match(brief, /Full GDD causal architecture protocol/);
  assert.match(brief, /Combat, collection, construction, exploration, dialogue, or management/);
  assert.match(brief, /target player \+ player promise.*explicit re-entry/s);
  assert.match(brief, /system-topology table/);
  assert.match(brief, /rewards have no sink/);
});

test('design governance forces critique, innovation evidence, convergence, and schedule accounting', () => {
  const brief = buildGameDesignGovernanceBrief({
    prompt: '完善当前 GDD，指出策划不足并增强创新性，但不要继续扩大工期。',
    currentFilePath: '01_GDD/GDD.md',
  });
  assert.match(brief, /convergent revision/);
  assert.match(brief, /Update the inspected canonical document in place/);
  assert.match(brief, /finding -> evidence -> player\/production consequence/);
  assert.match(brief, /cheapest prototype/);
  assert.match(brief, /Required now, Replace existing, Defer, or Reject/);
  assert.match(brief, /Net scope: smaller \/ unchanged \/ larger/);
  assert.match(brief, /Schedule impact:/);
});

test('non-planning chat does not receive game design governance', () => {
  assert.equal(buildGameDesignGovernanceBrief({ prompt: '你好，今天怎么样？' }), '');
});

test('AI requests inject the selected professional design studio brief', () => {
  const request = buildAIChatRequest('设计一套技能战斗系统，包含前摇、命中、伤害和打击反馈。', {
    contextMode: 'gameWorkspace',
    currentFilePath: '01_GDD/GDD.md',
  });
  const system = request.messages[0].content;
  const user = request.messages.at(-1).content;
  assert.match(system, /Professional Game Design Studio Protocol/);
  assert.match(system, /Lead Designer Governance Protocol/);
  assert.match(user, /Professional Game Design Studio Brief/);
  assert.match(user, /Lead Designer Scope & Version Governance/);
  assert.match(user, /Primary specialist: 战斗策划/);
  assert.match(user, /Review specialists:/);
});

test('system prompt loads specialist modules only when the request needs them', () => {
  const generic = buildAdaptiveAISystemPrompt('你好', { contextMode: 'currentNote' }, false);
  assert.doesNotMatch(generic, /Wireframe Layout Guardrails/);
  assert.doesNotMatch(generic, /Canvas Production Layout Rules/);
  assert.doesNotMatch(generic, /Narrative Production Intelligence/);

  const planning = buildAdaptiveAISystemPrompt(
    '设计莲池岛核心循环与数值成长，并写成系统策划案',
    { contextMode: 'currentNote', currentFilePath: '01_GDD/GameplayLoop.md' },
    true,
  );
  assert.match(planning, /Game Design Planning Intelligence/);
  assert.match(planning, /Professional Game Design Studio Brief/);
});

test('generic chat no longer pays the full all-discipline prompt cost', () => {
  const request = buildAIChatRequest('你好', { contextMode: 'currentNote' });
  assert.ok(request.usage.usedTokens < 9500);
});

test('AI prompts apply bilingual natural author voice and five-pass professional design review', () => {
  const humanized = buildAIChatRequest('把当前中文策划做类人化，去掉机器味。', {
    contextMode: 'currentNote',
    currentFilePath: '01_GDD/OrderSystem.md',
  });
  const humanSystem = humanized.messages[0].content;
  assert.match(humanSystem, /Natural Team-Author Voice/);
  assert.match(humanSystem, /Chinese authoring/);
  assert.match(humanSystem, /English authoring/);
  assert.match(humanSystem, /Editing workflow/);

  const design = buildAIChatRequest('写一份订单系统策划案。', {
    contextMode: 'gameWorkspace',
    currentFilePath: '01_GDD/OrderSystem.md',
  });
  assert.match(design.messages[0].content, /Five-pass professional authoring method/);
  assert.match(design.messages[0].content, /Evidence pass/);
  assert.match(design.messages[0].content, /Implementation-ready/);
});

test('professional design review quick prompt is read-only and invokes discipline review gates', () => {
  const prompt = QUICK_PROMPTS.find((item) => item.id === 'professional-design-review');
  assert.ok(prompt);
  assert.equal(prompt.contextMode, 'currentNote');
  assert.match(prompt.prompt, /read-only review/i);
  assert.match(prompt.prompt, /Passed, Needs review, or Blocked/);
  assert.match(prompt.prompt, /keep\/change\/cut\/defer/);
  assert.match(prompt.prompt, /net scope and schedule impact/);
  assert.doesNotMatch(prompt.prompt, /create_canvas|create_wireframe/);
});

test('professionalize quick prompt rewrites the canonical note with production and naturalness gates', () => {
  const prompt = QUICK_PROMPTS.find((item) => item.id === 'professionalize-current-design');
  assert.ok(prompt);
  assert.equal(prompt.contextMode, 'currentNote');
  assert.match(prompt.prompt, /accountable discipline lead/i);
  assert.match(prompt.prompt, /same canonical Markdown file only/i);
  assert.match(prompt.prompt, /observable acceptance criteria/i);
  assert.match(prompt.prompt, /natural Chinese or English team-author prose/i);
  assert.match(prompt.prompt, /source-fidelity passes/i);
});

test('game design spec quick prompt preserves one canonical version and forces convergence', () => {
  const prompt = QUICK_PROMPTS.find((item) => item.id === 'write-game-design-spec');
  assert.ok(prompt);
  assert.match(prompt.prompt, /one canonical/);
  assert.match(prompt.prompt, /Never create v2\/final\/new\/optimized\/copy/);
  assert.match(prompt.prompt, /simpler option/);
  assert.match(prompt.prompt, /Added\/Changed\/Removed\/Deferred\/Rejected/);
  assert.match(prompt.prompt, /schedule impact/);
  assert.match(prompt.prompt, /one causal spine/);
  assert.match(prompt.prompt, /not complete core loops by themselves/);
  assert.match(prompt.prompt, /changed next decision/);
});

test('core-loop quick prompt writes one Markdown spec without unrelated visual artifacts', () => {
  const prompt = QUICK_PROMPTS.find((item) => item.id === 'design-core-gameplay-loop');
  assert.ok(prompt);
  assert.equal(prompt.contextMode, 'gameWorkspace');
  assert.match(prompt.prompt, /01_GDD\/GameplayLoop\.md/);
  assert.match(prompt.prompt, /moment-to-moment/);
  assert.match(prompt.prompt, /economy and UX cross-review/i);
  assert.match(prompt.prompt, /Passed\/Needs review\/Blocked/);
  assert.doesNotMatch(prompt.prompt, /create_canvas|create_wireframe/);
});
