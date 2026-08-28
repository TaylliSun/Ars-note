import {
  auditGDDLogic,
  formatGDDLogicGateFailure,
  isLikelyGDDDocument,
} from './gddLogicQuality';
import {
  auditHumanizationFidelity,
  auditHumanizedWriting,
  formatHumanizationFidelityFailure,
  formatHumanizationGateFailure,
} from './humanizedWriting';
import {
  auditDesignEvidenceClaims,
  auditProfessionalDesignDocument,
  formatDesignEvidenceGateFailure,
  formatProfessionalDesignGateFailure,
  getProfessionalDesignGateContract,
  inferProfessionalDesignKind,
  type ProfessionalDesignKind,
} from './designWritingQuality';

export type AIControlMode = 'readonly' | 'member' | 'producer';

export type AITaskPrimary =
  | 'markdown-spec'
  | 'design-review'
  | 'markdown-repair'
  | 'humanize'
  | 'terminology-migration'
  | 'canvas'
  | 'wireframe'
  | 'file-operation'
  | 'team-operation'
  | 'direct-answer';

export interface AITaskPolicy {
  primary: AITaskPrimary;
  allowCanvas: boolean;
  allowWireframe: boolean;
  allowTeamTools: boolean;
  allowMutations: boolean;
  revisionIntent: boolean;
  multiDocumentIntent: boolean;
  explicitVersionBranchIntent: boolean;
  requiresGddLogicGate: boolean;
  requiresProfessionalDesignGate: boolean;
  professionalDesignKind: ProfessionalDesignKind;
  requestedPaths: string[];
  requestEvidence: string;
  systemHint: string;
}

export interface AIToolCallLike {
  name?: string;
  args?: Record<string, unknown>;
  result?: string;
}

export interface AIToolPolicyDecision {
  allowed: boolean;
  reason?: string;
}

const CANVAS_KEYWORD_RE = /(?:canvas|canva|画布|白板|流程图|思维导图|脑图|看板|关系图|拓扑图|pipeline|flow\s*chart|flowchart|mind\s*map|kanban|visual\s*board)/i;
const CREATE_INTENT_RE = /(?:做成|整理成|转成|轉成|生成|创建|創建|新建|画(?:一个)?|做一个|用.*(?:做|生成|创建)|make|create|draw|build|turn\s+.*\s+into)/i;
const WIREFRAME_KEYWORD_RE = /(?:wireframe|mockup|prototype|\bui\b|hud|界面|原型|线框图|菜单|交互|按钮)/i;
const TEAM_KEYWORD_RE = /(?:团队|成员|排期|时间表|任务表|任务文档|制作台|交接|负责人|里程碑|team|schedule|assignment|production\s+docs?)/i;
const TEAM_ACTION_RE = /(?:创建|生成|更新|分配|导入|补齐|初始化|接管|同步任务|create|generate|update|assign|bootstrap|take\s*over)/i;
const FILE_OPERATION_RE = /(?:删除|移除|清理|重命名|移动|覆盖|修改|更新|写入|追加|保存到|delete|remove|rename|move|overwrite|edit|append|write\s+to)/i;
const FILE_TARGET_RE = /(?:文件|文档|目录|文件夹|\.md\b|\.json\b|\.canvas\b|\.excalidraw\b|file|folder|document)/i;
const TERMINOLOGY_MIGRATION_ACTION_RE = /(?:改为|改成|替换为|统一为|统一成|重命名为|旧称|原来.+现在|现在(?:改)?(?:叫|是)|rename|replace|terminology|canonical\s+name)/i;
const TERMINOLOGY_MIGRATION_SCOPE_RE = /(?:全库|全项目|全部|所有|其他文档|部分文档|跨文档|一致|残留|遗漏|仍然|同步更新|术语|设定|canon|cross[-\s]*document|vault[-\s]*wide)/i;
const DESIGN_REVISION_RE = /(?:完善|改进|优化|整理|收敛|重构|修订|更新|补全|补充|检查|审查|评审|指出.+不足|找.+问题|improve|revise|refine|rewrite|review|audit|converge)/i;
const DESIGN_REVIEW_RE = /(?:检查|审查|评审|指出.+不足|找.+问题|分析.+问题|批评|review|audit|critique|find.+(?:gaps?|problems?))/i;
const DESIGN_MUTATION_RE = /(?:修改|改进|完善|优化|整理|收敛|重构|修订|更新|补全|补充|重写|写入|保存|创建|生成|modify|edit|improve|revise|refine|rewrite|update|save|create|generate)/i;
const DESIGN_READ_ONLY_RE = /(?:只读|不要(?:创建|修改|写入|保存)|不得(?:创建|修改|写入|保存)|read[-\s]*only|do\s+not\s+(?:create|modify|edit|write|save)|without\s+(?:creating|modifying|editing|writing))/i;
const MULTI_DOCUMENT_RE = /(?:全库|全项目|全部|所有|多个|整套|其他文档|部分文档|跨文档|相关文档|whole\s+project|all\s+(?:docs?|documents?|files?)|cross[-\s]*document)/i;
const EXPLICIT_VERSION_BRANCH_RE = /(?:另存|分支|历史版本|保留旧版|创建.+(?:v\d+|版本|副本)|new\s+version|version\s+branch|save\s+as|keep\s+the\s+old\s+version)/i;
const VERSION_COPY_PATH_RE = /(?:^|[._ -])(?:v(?:er(?:sion)?)?\d+(?:\.\d+)*|final\d*|new|copy\d*|draft\d*|新版|新版本|优化版|改进版|重写版|重制版|最终版|终版|副本|备份)(?=\.md$)/i;
const FULL_GDD_INTENT_RE = /(?:完整|整体|全局|正式|生产级|专业).{0,16}(?:gdd|游戏设计文档|游戏策划案)|(?:写|生成|创建|完善|更新|修订|重构).{0,20}(?:gdd|游戏设计文档|游戏策划案)|(?:full|complete|production[-\s]ready).{0,12}(?:gdd|game\s+design\s+document)/i;
const PROFESSIONAL_DESIGN_INTENT_RE = /策划|设计案|需求文档|美术需求|美工需求|技术需求|开发需求|玩法|机制|数值|平衡|经济|成长|关卡|战斗|技能|剧情|世界观|任务设计|台词|演出|\bui\b|\bux\b|交互|gdd|game\s*design|system\s*design|level\s*design|combat\s*design|technical\s*design|art\s*(?:brief|requirement)|economy|balance|progression|quest|narrative/i;
const PROFESSIONAL_DESIGN_PATH_RE = /(?:^|\/)(?:01_GDD|02_Worldbuilding|03_Characters|04_Maps|05_Items|06_Quests|07_Unity_Tasks|10_SystemDesign)\//i;

const MUTATION_TOOLS = new Set([
  'write_file',
  'refactor_vault_term',
  'set_canonical_design_document',
  'delete_file',
  'delete_files',
  'create_folder',
  'append_file',
  'apply_ai_operation',
  'cancel_ai_operation',
  'apply_sync_recovery_advisor_plan',
  'bootstrap_team_workspace',
  'draft_narrative_tasks',
  'sync_team_task_docs',
  'upsert_team_tasks',
  'generate_team_production_docs',
  'copy_image',
  'create_wireframe',
  'create_canvas',
]);

const TEAM_TOOLS = new Set([
  'bootstrap_team_workspace',
  'draft_narrative_tasks',
  'sync_team_task_docs',
  'upsert_team_tasks',
  'generate_team_production_docs',
]);

export function hasStrictCanvasCreationIntent(prompt: string): boolean {
  return CANVAS_KEYWORD_RE.test(prompt || '') && CREATE_INTENT_RE.test(prompt || '');
}

export function hasStrictWireframeCreationIntent(prompt: string): boolean {
  return WIREFRAME_KEYWORD_RE.test(prompt || '') && CREATE_INTENT_RE.test(prompt || '');
}

export function hasMarkdownRepairIntent(prompt: string): boolean {
  const text = prompt || '';
  const repair = /(?:检查|修复|修正|校对|规范|格式化|格式|整理|check|fix|repair|format|lint|normalize)/i.test(text);
  const target = /(?:markdown\s*格式|md\s*格式|表格|格式|排版|分隔行|对齐标记|table|tables|format|lint|\|---|\|--|\|:-)/i.test(text);
  return repair && target;
}

export function hasHumanizerIntent(prompt: string): boolean {
  return /(?:humanize|de-?ai|ai[-\s]*sounding|robotic|natural(?:ly)?|human(?:\s+voice|\s+written)?|去\s*AI\s*味|去ai味|不像AI|像人写|类人化|自然化|人工写作感|更自然|自然一点|润色|改写|重写|人话|别太AI|机器味|文风)/i.test(prompt || '');
}

export function hasTerminologyMigrationIntent(prompt: string): boolean {
  const text = prompt || '';
  return TERMINOLOGY_MIGRATION_ACTION_RE.test(text) && TERMINOLOGY_MIGRATION_SCOPE_RE.test(text);
}

function hasWrittenSpecIntent(prompt: string): boolean {
  return /(?:写|整理|文档|说明|需求|策划|玩法|机制|规则|数值|经济|成长|进度|循环|手感|关卡|系统设计|美术需求|美工需求|技术需求|开发需求|规格|完整点|方便我看|正式文档|权威文档|单一来源|spec|requirements|requirement\s+doc|production\s+spec|gdd|prd|game\s*design|system\s*design|gameplay|mechanic|economy|progression|balance|balancing|level\s*design|canonical\s+document|source\s+of\s+truth)/i.test(prompt || '');
}

function hasTeamOperationIntent(prompt: string): boolean {
  const text = prompt || '';
  return TEAM_KEYWORD_RE.test(text) && TEAM_ACTION_RE.test(text);
}

function hasFileOperationIntent(prompt: string): boolean {
  const text = prompt || '';
  return FILE_OPERATION_RE.test(text) && (FILE_TARGET_RE.test(text) || extractRequestedPaths(text).length > 0);
}

export function shouldAutoCreateCanvasFromPrompt(prompt: string): boolean {
  return !hasMarkdownRepairIntent(prompt) && !hasHumanizerIntent(prompt) && hasStrictCanvasCreationIntent(prompt);
}

export function isAIToolMutationName(toolName: string): boolean {
  return MUTATION_TOOLS.has(toolName || '');
}

function normalizeRelativePath(value: string): string {
  let normalized = value.trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^['"`]|['"`,.;:!?，。；：！？]$/g, '');
  if (!/^[A-Za-z]:\//.test(normalized)) {
    const firstSlash = normalized.indexOf('/');
    if (firstSlash >= 0) {
      const head = normalized.slice(0, firstSlash).trim().split(/\s+/).pop() || '';
      normalized = `${head}${normalized.slice(firstSlash)}`;
    } else if (/\s/.test(normalized)) {
      normalized = normalized.split(/\s+/).pop() || normalized;
    }
  }
  return normalized;
}

export function extractRequestedPaths(prompt: string): string[] {
  const text = prompt || '';
  const matches = text.match(/(?:[A-Za-z]:[\\/][^\r\n"'<>|*?]+?\.(?:md|json|canvas|excalidraw)|(?:[\w\u4e00-\u9fff ._-]+[\\/])+[\w\u4e00-\u9fff ._-]+\.(?:md|json|canvas|excalidraw)|[\w\u4e00-\u9fff ._-]+\.(?:md|json|canvas|excalidraw))/gi) || [];
  return Array.from(new Set(matches.map(normalizeRelativePath).filter(Boolean)));
}

function modeLabel(mode: AIControlMode): string {
  if (mode === 'producer') return 'Producer takeover';
  if (mode === 'member') return 'Member execution';
  return 'Read-only analysis';
}

export function buildAITaskPolicy(
  prompt: string,
  controlMode: AIControlMode = 'readonly',
  currentFilePath = '',
): AITaskPolicy {
  const text = prompt || '';
  const wantsMarkdownRepair = hasMarkdownRepairIntent(text);
  const wantsHumanizer = hasHumanizerIntent(text);
  const wantsSpec = hasWrittenSpecIntent(text);
  const reviewOnlyIntent = wantsSpec
    && DESIGN_REVIEW_RE.test(text)
    && (DESIGN_READ_ONLY_RE.test(text) || !DESIGN_MUTATION_RE.test(text));
  const wantsTerminologyMigration = hasTerminologyMigrationIntent(text);
  const explicitCanvas = hasStrictCanvasCreationIntent(text);
  const explicitWireframe = hasStrictWireframeCreationIntent(text) && !wantsSpec;
  const teamOperation = hasTeamOperationIntent(text);
  const fileOperation = hasFileOperationIntent(text);
  const destructiveFileOperation = fileOperation && /(?:删除|移除|清理|重命名|移动|delete|remove|rename|move)/i.test(text);
  const revisionIntent = !reviewOnlyIntent && DESIGN_REVISION_RE.test(text) && hasWrittenSpecIntent(text);
  const multiDocumentIntent = MULTI_DOCUMENT_RE.test(text);
  const explicitVersionBranchIntent = EXPLICIT_VERSION_BRANCH_RE.test(text);
  const currentLooksLikeGdd = isLikelyGDDDocument(currentFilePath);
  const promptTargetsGdd = extractRequestedPaths(text).some((requestedPath) => isLikelyGDDDocument(requestedPath));
  const gddLogicIntent = wantsSpec && (FULL_GDD_INTENT_RE.test(text) || currentLooksLikeGdd || promptTargetsGdd);

  let primary: AITaskPrimary = 'direct-answer';
  if (wantsTerminologyMigration && !explicitCanvas) primary = 'terminology-migration';
  else if (wantsMarkdownRepair && !explicitCanvas) primary = 'markdown-repair';
  else if (wantsHumanizer && !explicitCanvas) primary = 'humanize';
  else if (reviewOnlyIntent && !explicitCanvas) primary = 'design-review';
  else if (teamOperation) primary = 'team-operation';
  else if (destructiveFileOperation) primary = 'file-operation';
  else if (wantsSpec && !explicitCanvas) primary = 'markdown-spec';
  else if (fileOperation) primary = 'file-operation';
  else if (explicitCanvas) primary = 'canvas';
  else if (explicitWireframe) primary = 'wireframe';

  const requiresGddLogicGate = primary === 'markdown-spec' && gddLogicIntent;
  const professionalDesignSource = `${text}\n${currentFilePath || ''}`;
  const professionalDesignKind = inferProfessionalDesignKind(professionalDesignSource);
  const requiresProfessionalDesignGate = primary === 'markdown-spec'
    && (PROFESSIONAL_DESIGN_INTENT_RE.test(text) || PROFESSIONAL_DESIGN_PATH_RE.test(String(currentFilePath || '').replace(/\\/g, '/')));

  const allowCanvas = primary === 'canvas';
  const allowWireframe = primary === 'wireframe';
  const allowTeamTools = primary === 'team-operation' && controlMode === 'producer';
  const allowMutations = controlMode !== 'readonly' && primary !== 'direct-answer' && primary !== 'design-review';
  const promptRequestedPaths = extractRequestedPaths(text);
  const inferredCurrentPath = normalizeRelativePath(currentFilePath || '');
  const requestedPaths = Array.from(new Set([
    ...promptRequestedPaths,
    ...(revisionIntent && promptRequestedPaths.length === 0 && inferredCurrentPath ? [inferredCurrentPath] : []),
  ]));
  const lines = [
    '=== Ars-note AI Task Contract ===',
    `Primary deliverable: ${primary}`,
    `Requested target paths: ${requestedPaths.length ? requestedPaths.join(', ') : '(infer from current note only when necessary)'}`,
    `Canvas allowed: ${allowCanvas ? 'yes' : 'no'}`,
    `Wireframe allowed: ${allowWireframe ? 'yes' : 'no'}`,
    `Team-wide tools allowed: ${allowTeamTools ? 'yes' : 'no'}`,
    `Mutation allowed: ${allowMutations ? 'yes' : 'no'}`,
    `Convergent revision: ${revisionIntent ? 'yes' : 'no'}`,
    `Multiple canonical documents requested: ${multiDocumentIntent ? 'yes' : 'no'}`,
    `Explicit version branch requested: ${explicitVersionBranchIntent ? 'yes' : 'no'}`,
    `Full GDD logic gate required: ${requiresGddLogicGate ? 'yes' : 'no'}`,
    `Professional design maturity gate: ${requiresProfessionalDesignGate ? `yes (${professionalDesignKind})` : 'no'}`,
    `Control mode: ${modeLabel(controlMode)} (${controlMode})`,
    'Execution loop: understand the requested deliverable, inspect the target source, perform only relevant actions, verify every mutation, then report exact paths and verification results.',
    'Do not create extra summaries, companion documents, Canvas boards, wireframes, team documents, or unrelated files unless they are explicitly requested.',
  ];

  if (primary === 'markdown-repair') {
    lines.push('Repair contract: read the target Markdown file first, preserve its meaning, write back to the same .md path, and verify that the resulting table/Markdown is structurally valid.');
  } else if (primary === 'terminology-migration') {
    lines.push(
      'Terminology migration contract: treat this as a vault-wide design-canon change, not a single-file edit.',
      'Required sequence: search_vault_text(old term) -> classify every hit -> refactor_vault_term with an explicit Markdown path list -> search_vault_text(old term) again.',
      'Update downstream GDD, worldbuilding, character, map, item, quest, dialogue, performance, UI, task, and technical documents when the old concept is used as current canon.',
      'Preserve historical quotations, changelogs, source code, identifiers, file names, and fenced code blocks unless the user explicitly asks to change them.',
      'Do not claim completion while unexplained old-term matches remain. Report changed paths, replacement count, preserved matches, and residual paths.',
    );
  } else if (primary === 'humanize') {
    lines.push(
      'Humanizer contract: preserve facts, links, tables, code, task IDs, acceptance criteria, terminology, uncertainty, and author intent; write back only when asked and never create visual artifacts.',
      'Rewrite at paragraph level, not by swapping synonyms. Infer the real author (designer, producer, engineer, writer) and audience, then preserve that accountable voice.',
      'Chinese: remove canned 首先/其次/此外/综上 scaffolding, slogan-like four-character marketing phrases, translation-shaped “通过...从而...” clauses, empty “提升玩家体验” claims, and repetitive sentence openings.',
      'English: remove canned transitions, inflated adjectives, nominalized claims, symmetric rule-of-three patterns, generic wrap-ups, and chatbot offers. Prefer actor-first clauses and direct verbs.',
      'Before write_file, compare meaning and structure against the source, then run a second naturalness pass. The write will be rejected if strong AI-writing signals remain.',
    );
  } else if (primary === 'design-review') {
    lines.push(
      'Design-review contract: inspect the canonical document and relevant project evidence, then report severity-ranked findings, contradictions, unsupported assumptions, scope/schedule risks, simpler alternatives, and a clear keep/change/cut/defer recommendation.',
      'This review is read-only. Do not create or modify design files, tasks, Canvas boards, or companion summaries unless the user explicitly asks in a follow-up.',
    );
  } else if (primary === 'markdown-spec') {
    lines.push(
      'Spec contract: produce actionable Markdown with assumptions, data/config fields, edge cases, QA checks, acceptance criteria, risks, and next actions.',
      'Design governance: diagnose weaknesses before expanding, maintain one canonical document, define non-goals, and report Added/Changed/Removed/Deferred plus net scope and schedule impact.',
      'Before a substantial design revision: call get_design_canon, read the canonical source, then call analyze_design_change with the proposed change and exact affected terms. Resolve high-severity dependents and active linked tasks before writing.',
      revisionIntent
        ? 'Revision contract: inspect and update the canonical Markdown document in place. Do not create v2/final/new/optimized/copy variants or a second competing specification.'
        : 'Creation contract: prefer an existing canonical document and create at most one primary specification unless multiple deliverables were explicitly requested.',
    );
    if (requiresGddLogicGate) {
      lines.push(
        'GDD logic contract: organize the document around one causal spine: player promise -> immediate goal -> meaningful choice/action -> rule resolution and feedback -> reward/cost -> resource use -> progression/unlock -> changed next decision -> explicit re-entry.',
        'Combat, collection, construction, exploration, or dialogue is a subsystem/action, not a complete core loop by itself. Show how its output feeds progression and why the player returns with a changed decision.',
        'Before write_file, self-audit the full document for connected moment-to-moment, session, and meta/long-term horizons; failure/recovery; system dependencies; prototype evidence; telemetry; and acceptance criteria. A weak GDD write will be rejected automatically.',
      );
    }
    if (requiresProfessionalDesignGate) {
      lines.push(...getProfessionalDesignGateContract(professionalDesignKind));
    }
  } else if (primary === 'file-operation') {
    lines.push('File-operation contract: touch only the named or clearly referenced files. Never broaden a delete, move, rename, or overwrite request to other files.');
  } else if (primary === 'team-operation') {
    lines.push('Team-operation contract: modify team schedules/docs only within the explicitly requested scope and verify generated task counts and paths.');
  } else if (primary === 'canvas') {
    lines.push('Canvas contract: create one requested visual board with readable cards and connections. Do not create an additional workspace summary or companion .visual.md file.');
  } else if (primary === 'wireframe') {
    lines.push('Wireframe contract: create only the requested UI prototype. Keep long specifications in the existing/current Markdown document unless the user asks for a new one.');
  } else {
    lines.push('Direct-answer contract: answer without mutating files. Read-only inspection is allowed when needed.');
  }

  lines.push(
    'Runtime identity: You are Ars-note AI Agent inside the Ars-note desktop application and the currently opened Ars-note Vault.',
    'The current product identity is always Ars-note. Markdown wiki-links, Canvas formats, and legacy file names are compatibility details only; always call the app, Vault, editor, and team workspace Ars-note.',
    'Project memory: in Member or Producer mode, call remember_project_fact once when the user explicitly establishes a durable canon fact, terminology rule, production decision, or lasting preference. Never store transient tasks, inferred guesses, raw retrieved context, or secrets.',
  );

  return {
    primary,
    allowCanvas,
    allowWireframe,
    allowTeamTools,
    allowMutations,
    revisionIntent,
    multiDocumentIntent,
    explicitVersionBranchIntent,
    requiresGddLogicGate,
    requiresProfessionalDesignGate,
    professionalDesignKind,
    requestedPaths,
    requestEvidence: text,
    systemHint: lines.join('\n'),
  };
}

function pathFromArgs(args: Record<string, unknown>): string {
  const raw = args.path ?? args.relative_path ?? args.file ?? args.source ?? '';
  return normalizeRelativePath(String(raw || ''));
}

function requestedPathMatches(policy: AITaskPolicy, candidate: string): boolean {
  if (!candidate || policy.requestedPaths.length === 0) return true;
  const lower = candidate.toLowerCase();
  return policy.requestedPaths.some(requested => {
    const normalized = requested.toLowerCase();
    return lower === normalized || lower.endsWith(`/${normalized}`) || normalized.endsWith(`/${lower}`);
  });
}

function isUnrequestedGeneratedArtifact(candidate: string): boolean {
  const lower = candidate.toLowerCase();
  return lower.endsWith('.visual.md')
    || /(?:^|\/)(?:gameworkspacesummary|currentnote[^/]*|workspace-summary|workspace_summary)\.(?:md|canvas)$/i.test(lower);
}

function isVersionCopyPath(candidate: string): boolean {
  const fileName = candidate.replace(/\\/g, '/').split('/').pop() || '';
  return VERSION_COPY_PATH_RE.test(fileName);
}

export function evaluateAIToolCall(
  policy: AITaskPolicy,
  toolName: string,
  args: Record<string, unknown> = {},
  priorCalls: AIToolCallLike[] = [],
): AIToolPolicyDecision {
  const name = toolName || '';
  const candidatePath = pathFromArgs(args);

  if (name === 'create_canvas' && !policy.allowCanvas) {
    return { allowed: false, reason: 'Canvas creation is unrelated to the current task contract.' };
  }
  if (name === 'create_wireframe' && !policy.allowWireframe) {
    return { allowed: false, reason: 'Wireframe creation is unrelated to the current task contract.' };
  }
  if (name === 'refactor_vault_term') {
    if (policy.primary !== 'terminology-migration') {
      return { allowed: false, reason: 'Vault-wide terminology refactoring requires an explicit cross-document terminology migration request.' };
    }
    const from = String((args as any).from || (args as any).source || '');
    const paths = Array.isArray((args as any).paths)
      ? (args as any).paths
      : String((args as any).paths || '').trim();
    if (!from.trim() || (Array.isArray(paths) ? paths.length === 0 : !paths)) {
      return { allowed: false, reason: 'Terminology refactoring requires a source term and an explicit Markdown path list.' };
    }
    const searchedFirst = priorCalls.some(call => (
      call.name === 'search_vault_text'
      && String((call.args as any)?.query || (call.args as any)?.term || '').trim() === from.trim()
    ));
    if (!searchedFirst) {
      return { allowed: false, reason: 'Search the entire vault for the old term before applying a terminology migration.' };
    }
  }
  if (name === 'set_canonical_design_document') {
    const inspectedCanon = priorCalls.some(call => call.name === 'get_design_canon' && !/^Error:/i.test(String(call.result || '')));
    if (!inspectedCanon) {
      return { allowed: false, reason: 'Inspect the canonical registry and candidates with get_design_canon before registering a document.' };
    }
    const readTarget = priorCalls.some(call => (
      call.name === 'read_file'
      && requestedPathMatches({ ...policy, requestedPaths: candidatePath ? [candidatePath] : [] }, pathFromArgs(call.args || {}))
      && !/^Error:/i.test(String(call.result || ''))
    ));
    if (!readTarget) {
      return { allowed: false, reason: 'Read the candidate Markdown document before registering it as canonical.' };
    }
  }
  if (TEAM_TOOLS.has(name) && !policy.allowTeamTools) {
    return { allowed: false, reason: 'Team-wide production tools require an explicit team operation in Producer mode.' };
  }
  if (isAIToolMutationName(name) && !policy.allowMutations) {
    return { allowed: false, reason: 'The current task contract is read-only or direct-answer only.' };
  }
  if (name === 'write_file' || name === 'append_file') {
    const lower = candidatePath.toLowerCase();
    if (
      name === 'write_file'
      && policy.primary === 'humanize'
      && Object.prototype.hasOwnProperty.call(args, 'content')
    ) {
      const content = String(args.content || '');
      const audit = auditHumanizedWriting(content, 78);
      if (!audit.passed) return { allowed: false, reason: formatHumanizationGateFailure(audit, 78) };
      const sourceRead = [...priorCalls].reverse().find(call => (
        call.name === 'read_file'
        && requestedPathMatches({ ...policy, requestedPaths: candidatePath ? [candidatePath] : policy.requestedPaths }, pathFromArgs(call.args || {}))
        && !/^Error:/i.test(String(call.result || ''))
      ));
      if (sourceRead) {
        const fidelity = auditHumanizationFidelity(String(sourceRead.result || ''), content);
        if (!fidelity.passed) return { allowed: false, reason: formatHumanizationFidelityFailure(fidelity) };
      }
    }
    if (
      name === 'write_file'
      && policy.requiresGddLogicGate
      && Object.prototype.hasOwnProperty.call(args, 'content')
    ) {
      const content = String(args.content || '');
      if (isLikelyGDDDocument(candidatePath, content)) {
        const audit = auditGDDLogic(content);
        if (!audit.passed) return { allowed: false, reason: formatGDDLogicGateFailure(audit) };
      }
    }
    if (
      name === 'write_file'
      && lower.endsWith('.md')
      && policy.requiresProfessionalDesignGate
      && Object.prototype.hasOwnProperty.call(args, 'content')
    ) {
      const audit = auditProfessionalDesignDocument(
        String(args.content || ''),
        policy.professionalDesignKind,
        policy.revisionIntent,
      );
      if (!audit.passed) return { allowed: false, reason: formatProfessionalDesignGateFailure(audit) };
      const evidenceTexts = [policy.requestEvidence, ...priorCalls
        .filter(call => call.name === 'read_file' && !/^Error:/i.test(String(call.result || '')))
        .map(call => String(call.result || ''))];
      const evidenceAudit = auditDesignEvidenceClaims(String(args.content || ''), evidenceTexts);
      if (!evidenceAudit.passed) return { allowed: false, reason: formatDesignEvidenceGateFailure(evidenceAudit) };
    }
    if (lower.endsWith('.canvas') && !policy.allowCanvas) {
      return { allowed: false, reason: 'Writing a .canvas file is blocked because no Canvas was requested.' };
    }
    if (lower.endsWith('.excalidraw') && !policy.allowWireframe) {
      return { allowed: false, reason: 'Writing an .excalidraw file is blocked because no wireframe was requested.' };
    }
    if (isUnrequestedGeneratedArtifact(candidatePath) && !requestedPathMatches(policy, candidatePath)) {
      return { allowed: false, reason: 'Unrequested workspace summary or companion visual artifact blocked.' };
    }
    if ((policy.primary === 'markdown-repair' || policy.primary === 'humanize') && !lower.endsWith('.md')) {
      return { allowed: false, reason: 'This task may write only the target Markdown file.' };
    }
    if ((policy.primary === 'markdown-repair' || policy.primary === 'humanize') && !requestedPathMatches(policy, candidatePath)) {
      return { allowed: false, reason: 'The write target does not match the file named by the user.' };
    }
    if (policy.primary === 'markdown-repair' || policy.primary === 'humanize') {
      const readFirst = priorCalls.some(call => call.name === 'read_file' && requestedPathMatches({ ...policy, requestedPaths: candidatePath ? [candidatePath] : policy.requestedPaths }, pathFromArgs(call.args || {})));
      if (!readFirst) return { allowed: false, reason: 'Read the target Markdown file before writing it.' };
    }
    if (policy.primary === 'markdown-spec' && policy.revisionIntent) {
      if (!lower.endsWith('.md')) {
        return { allowed: false, reason: 'A design revision may write only the canonical Markdown document.' };
      }
      if (!policy.explicitVersionBranchIntent && isVersionCopyPath(candidatePath)) {
        return { allowed: false, reason: 'Competing v2/final/new/optimized/copy design versions are blocked. Update the canonical document in place.' };
      }
      if (policy.requestedPaths.length > 0 && !policy.multiDocumentIntent && !requestedPathMatches(policy, candidatePath)) {
        return { allowed: false, reason: 'The design revision must update the canonical file named by the user instead of creating another document.' };
      }
      const readFirst = priorCalls.some(call => (
        call.name === 'read_file'
        && requestedPathMatches({ ...policy, requestedPaths: candidatePath ? [candidatePath] : policy.requestedPaths }, pathFromArgs(call.args || {}))
      ));
      if (!readFirst) {
        return { allowed: false, reason: 'Read the canonical design document before revising it.' };
      }
      const canonInspected = priorCalls.some(call => (
        call.name === 'get_design_canon' && !/^Error:/i.test(String(call.result || ''))
      ));
      if (!canonInspected) {
        return { allowed: false, reason: 'Inspect the synchronized canonical design registry with get_design_canon before revising the document.' };
      }
      const impactAnalyzed = priorCalls.some(call => {
        if (call.name !== 'analyze_design_change' || /^Error:/i.test(String(call.result || ''))) return false;
        const analyzedPath = normalizeRelativePath(String((call.args as any)?.source_path || (call.args as any)?.path || ''));
        return requestedPathMatches({ ...policy, requestedPaths: candidatePath ? [candidatePath] : [] }, analyzedPath);
      });
      if (!impactAnalyzed) {
        return { allowed: false, reason: 'Analyze cross-document and team-task impact with analyze_design_change before writing a design revision.' };
      }
      if (!policy.multiDocumentIntent) {
        const earlierDifferentWrite = priorCalls.some(call => (
          call.name === 'write_file'
          && pathFromArgs(call.args || {}).toLowerCase() !== candidatePath.toLowerCase()
        ));
        if (earlierDifferentWrite) {
          return { allowed: false, reason: 'This revision is limited to one canonical design document. Additional design files require explicit scope.' };
        }
      }
    }
  }
  if ((name === 'delete_file' || name === 'delete_files') && policy.primary !== 'file-operation') {
    return { allowed: false, reason: 'Delete tools require an explicit file deletion or cleanup request.' };
  }

  return { allowed: true };
}
