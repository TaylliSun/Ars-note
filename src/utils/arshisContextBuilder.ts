/* ── Arshis Context Builder (v1.0.0) ── */
/* Builds game context for Arshis Game Dev Agent integration */
/* Pure computation — no file I/O, no side effects, no network */

import type {
  GameWorkspaceSummary,
  GameWorkspaceEntry,
  GameDocType,
  ArshisGameContext,
} from '../types';

/* ── Helpers ── */

const DOC_TYPE_LABELS: Record<GameDocType, string> = {
  gdd: 'GDD',
  worldbuilding: 'Worldbuilding',
  story: 'Story / Plot',
  dialogue: 'Dialogue',
  performance: 'Performance / Cutscenes',
  character: 'Characters',
  item: 'Items',
  quest: 'Quests',
  taskTable: 'Task Tables',
  unityTask: 'Unity Tasks',
  devlog: 'Devlog',
};

const ALL_DOC_TYPES: GameDocType[] = ['gdd', 'worldbuilding', 'story', 'dialogue', 'performance', 'character', 'item', 'quest', 'taskTable', 'unityTask', 'devlog'];

function entriesByType(entries: GameWorkspaceEntry[], type: GameDocType): GameWorkspaceEntry[] {
  return entries.filter((e) => e.type === type);
}

function entryToRow(entry: GameWorkspaceEntry): string {
  const parts: string[] = [];
  parts.push(`- **${entry.title}**`);
  parts.push(`  \`${entry.relativePath}\``);
  if (entry.status) parts.push(`  Status: ${entry.status}`);
  if (entry.priority) parts.push(`  Priority: ${entry.priority}`);
  if (entry.owner) parts.push(`  Owner: ${entry.owner}`);
  if (entry.updatedAt) parts.push(`  Updated: ${entry.updatedAt}`);
  if (entry.summary) parts.push(`  Summary: ${entry.summary}`);
  if (entry.tags.length > 0) parts.push(`  Tags: ${entry.tags.join(', ')}`);
  return parts.join('\n');
}

/* ── Recommended Next Steps (rule-based, no AI) ── */

function buildRecommendedNextSteps(
  summary: GameWorkspaceSummary,
  entries: GameWorkspaceEntry[],
): string[] {
  const steps: string[] = [];

  if (summary.gddCount === 0) {
    steps.push('Create a Game Design Document (GDD) first — it defines the core vision.');
  }
  if (summary.worldbuildingCount === 0) {
    steps.push('Create a worldbuilding overview to define setting rules, regions, factions, timeline, and lore constraints.');
  }
  if (summary.storyCount === 0) {
    steps.push('Create a plot outline or story arc so quests, dialogue, and scenes have narrative direction.');
  }
  if (summary.dialogueCount === 0) {
    steps.push('Add dialogue scripts or dialogue scenes to capture character voice and branching conversation needs.');
  }
  if (summary.performanceCount === 0) {
    steps.push('Add cutscene/performance sheets for camera, animation, dialogue timing, and implementation notes.');
  }
  if (summary.characterCount === 0) {
    steps.push('Add character profiles to define the cast of your game.');
  }
  if (summary.unityTaskCount === 0) {
    steps.push('Create Unity implementation tasks to track technical progress.');
  }
  if (summary.taskTableCount === 0) {
    steps.push('Create a task table to connect design, art, code, QA, dependencies, and acceptance criteria.');
  }

  const highPriority = entries.filter((e) => e.priority === 'high');
  if (highPriority.length > 0) {
    steps.push(`Review ${highPriority.length} high-priority doc(s): ${highPriority.map((e) => e.title).join(', ')}.`);
  }

  const draftDocs = entries.filter((e) => e.status === 'draft' || e.status === 'todo');
  if (draftDocs.length > 0) {
    steps.push(`${draftDocs.length} doc(s) still in draft/todo status — consider moving them forward.`);
  }

  const noMetadata = entries.filter((e) => !e.status && !e.priority && !e.owner);
  if (noMetadata.length > 0) {
    steps.push(`${noMetadata.length} doc(s) have no metadata — add status/priority/owner for better tracking.`);
  }

  if (summary.devlogCount === 0) {
    steps.push('Start a devlog to record development progress and decisions.');
  }

  if (steps.length === 0) {
    steps.push('All core docs present and tracked. Keep up the good work!');
  }

  return steps;
}

/* ── Build ArshisGameContext object ── */

export function buildArshisGameContext(
  summary: GameWorkspaceSummary,
  entries: GameWorkspaceEntry[],
  projectName: string,
): ArshisGameContext {
  const generatedAt = new Date().toISOString();
  const recommendedNextSteps = buildRecommendedNextSteps(summary, entries);

  return {
    generatedAt,
    projectName,
    summary,
    entries,
    recommendedNextSteps,
  };
}

/* ── Build Markdown output ── */

export function buildArshisContextMarkdown(context: ArshisGameContext): string {
  const { summary, entries, generatedAt, projectName, recommendedNextSteps } = context;
  const lines: string[] = [];

  /* Header */
  lines.push('# Arshis Game Context');
  lines.push('');
  lines.push(`> **Project**: ${projectName}`);
  lines.push(`> **Generated**: ${generatedAt}`);
  lines.push('');

  /* Project Summary */
  lines.push('## Project Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Total Game Docs | ${summary.totalGameDocs} |`);
  lines.push(`| GDD | ${summary.gddCount} |`);
  lines.push(`| Worldbuilding | ${summary.worldbuildingCount} |`);
  lines.push(`| Story / Plot | ${summary.storyCount} |`);
  lines.push(`| Dialogue | ${summary.dialogueCount} |`);
  lines.push(`| Performance / Cutscenes | ${summary.performanceCount} |`);
  lines.push(`| Characters | ${summary.characterCount} |`);
  lines.push(`| Items | ${summary.itemCount} |`);
  lines.push(`| Quests | ${summary.questCount} |`);
  lines.push(`| Task Tables | ${summary.taskTableCount} |`);
  lines.push(`| Unity Tasks | ${summary.unityTaskCount} |`);
  lines.push(`| Devlog | ${summary.devlogCount} |`);
  lines.push(`| Draft | ${summary.draftCount} |`);
  lines.push(`| Done | ${summary.doneCount} |`);
  lines.push(`| High Priority | ${summary.highPriorityCount} |`);

  const missingTypes = ALL_DOC_TYPES.filter((type) => {
    const key = (type + 'Count') as keyof GameWorkspaceSummary;
    return (summary[key] as number) === 0;
  });
  if (missingTypes.length > 0) {
    lines.push(`| Missing Core Docs | ${missingTypes.length} |`);
  } else {
    lines.push('| Missing Core Docs | 0 |');
  }
  lines.push('');

  /* Sections for each doc type */
  for (const docType of ALL_DOC_TYPES) {
    const groupEntries = entriesByType(entries, docType);
    lines.push(`## ${DOC_TYPE_LABELS[docType]}`);
    lines.push('');
    if (groupEntries.length === 0) {
      lines.push(`*No ${DOC_TYPE_LABELS[docType]} documents found.*`);
    } else {
      for (const entry of groupEntries) {
        lines.push(entryToRow(entry));
      }
    }
    lines.push('');
  }

  /* Recommended Next Steps */
  lines.push('## Recommended Next Steps');
  lines.push('');
  for (const step of recommendedNextSteps) {
    lines.push(`- ${step}`);
  }
  lines.push('');

  /* Footer */
  lines.push('---');
  lines.push('');
  lines.push(`*Generated by Ars-note Arshis Integration v1.0.0 at ${generatedAt}*`);
  lines.push('');

  return lines.join('\n');
}

/* ── Build JSON output ── */

export function buildArshisContextJson(context: ArshisGameContext): string {
  return JSON.stringify(context, null, 2);
}

/* ── Date-based filename helper ── */

export function getArshisContextBaseName(): string {
  const now = new Date();
  const dateStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  return `Arshis_Context_${dateStr}`;
}
