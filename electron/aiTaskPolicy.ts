export type AIControlMode = 'readonly' | 'member' | 'producer';

export type AITaskPrimary =
  | 'markdown-spec'
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
  requestedPaths: string[];
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

const MUTATION_TOOLS = new Set([
  'write_file',
  'refactor_vault_term',
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
  const target = /(?:markdown|\.md\b|\bmd\b|文档|文件|表格|格式|table|tables|\|---|\|--|\|:-)/i.test(text);
  return repair && target;
}

export function hasHumanizerIntent(prompt: string): boolean {
  return /(?:humanize|de-?ai|ai[-\s]*sounding|robotic|natural(?:ly)?|human(?:\s+voice|\s+written)?|去\s*AI\s*味|去ai味|不像AI|像人写|更自然|自然一点|润色|改写|重写|人话|别太AI|机器味|文风)/i.test(prompt || '');
}

export function hasTerminologyMigrationIntent(prompt: string): boolean {
  const text = prompt || '';
  return TERMINOLOGY_MIGRATION_ACTION_RE.test(text) && TERMINOLOGY_MIGRATION_SCOPE_RE.test(text);
}

function hasWrittenSpecIntent(prompt: string): boolean {
  return /(?:写|整理|文档|说明|需求|策划|玩法|机制|规则|数值|经济|成长|进度|循环|手感|关卡|系统设计|美术需求|美工需求|技术需求|开发需求|规格|完整点|方便我看|spec|requirements|requirement\s+doc|production\s+spec|gdd|prd|game\s*design|system\s*design|gameplay|mechanic|economy|progression|balance|balancing|level\s*design)/i.test(prompt || '');
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

export function buildAITaskPolicy(prompt: string, controlMode: AIControlMode = 'readonly'): AITaskPolicy {
  const text = prompt || '';
  const wantsMarkdownRepair = hasMarkdownRepairIntent(text);
  const wantsHumanizer = hasHumanizerIntent(text);
  const wantsSpec = hasWrittenSpecIntent(text);
  const wantsTerminologyMigration = hasTerminologyMigrationIntent(text);
  const explicitCanvas = hasStrictCanvasCreationIntent(text);
  const explicitWireframe = hasStrictWireframeCreationIntent(text) && !wantsSpec;
  const teamOperation = hasTeamOperationIntent(text);
  const fileOperation = hasFileOperationIntent(text);

  let primary: AITaskPrimary = 'direct-answer';
  if (wantsTerminologyMigration && !explicitCanvas) primary = 'terminology-migration';
  else if (wantsMarkdownRepair && !explicitCanvas) primary = 'markdown-repair';
  else if (wantsHumanizer && !explicitCanvas) primary = 'humanize';
  else if (teamOperation) primary = 'team-operation';
  else if (fileOperation) primary = 'file-operation';
  else if (wantsSpec && !explicitCanvas) primary = 'markdown-spec';
  else if (explicitCanvas) primary = 'canvas';
  else if (explicitWireframe) primary = 'wireframe';

  const allowCanvas = primary === 'canvas';
  const allowWireframe = primary === 'wireframe';
  const allowTeamTools = primary === 'team-operation' && controlMode === 'producer';
  const allowMutations = controlMode !== 'readonly' && primary !== 'direct-answer';
  const requestedPaths = extractRequestedPaths(text);
  const lines = [
    '=== Ars-note AI Task Contract ===',
    `Primary deliverable: ${primary}`,
    `Requested target paths: ${requestedPaths.length ? requestedPaths.join(', ') : '(infer from current note only when necessary)'}`,
    `Canvas allowed: ${allowCanvas ? 'yes' : 'no'}`,
    `Wireframe allowed: ${allowWireframe ? 'yes' : 'no'}`,
    `Team-wide tools allowed: ${allowTeamTools ? 'yes' : 'no'}`,
    `Mutation allowed: ${allowMutations ? 'yes' : 'no'}`,
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
    lines.push('Humanizer contract: preserve facts, links, tables, code, task IDs, and acceptance criteria; write back only when asked and never create visual artifacts.');
  } else if (primary === 'markdown-spec') {
    lines.push('Spec contract: produce actionable Markdown with assumptions, data/config fields, edge cases, QA checks, acceptance criteria, risks, and next actions.');
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
    'You are not Obsidian and not an Obsidian plugin. Obsidian-compatible Markdown, Canvas formats, or legacy file names are compatibility details only; never call the current app or workspace Obsidian.',
  );

  return { primary, allowCanvas, allowWireframe, allowTeamTools, allowMutations, requestedPaths, systemHint: lines.join('\n') };
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
  if (TEAM_TOOLS.has(name) && !policy.allowTeamTools) {
    return { allowed: false, reason: 'Team-wide production tools require an explicit team operation in Producer mode.' };
  }
  if (isAIToolMutationName(name) && !policy.allowMutations) {
    return { allowed: false, reason: 'The current task contract is read-only or direct-answer only.' };
  }
  if (name === 'write_file' || name === 'append_file') {
    const lower = candidatePath.toLowerCase();
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
  }
  if ((name === 'delete_file' || name === 'delete_files') && policy.primary !== 'file-operation') {
    return { allowed: false, reason: 'Delete tools require an explicit file deletion or cleanup request.' };
  }

  return { allowed: true };
}
