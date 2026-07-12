/* ── AI Client (v1.1.0) ── */
/* Builds request payloads for OpenAI-compatible chat completions */
/* Actual HTTP requests go through Electron main process IPC for security */

import type { AIContextMode, AIRequestInput, AIChatMessage, AIContextUsage } from '../types';
import { ARSNOTE_AI_IDENTITY_PROMPT, enforceArsNoteProductIdentity } from './aiIdentity';
import { buildGameDesignSpecialistBrief, GAME_DESIGN_SPECIALIST_SYSTEM_PROMPT } from './gameDesignSpecialists';

/* ── System prompt builder ── */

const BASE_SYSTEM_PROMPT = `You are an AI assistant for Ars-note, a local-first Markdown knowledge base for game developers. You help with:
- Writing and improving game design documents (GDDs)
- Creating character profiles, item descriptions, quest designs
- Building world bibles, story outlines, dialogue scripts, performance sheets, and task tables
- Acting as a narrative director who can connect lore, plot, quests, dialogue, cinematics, and implementation tasks
- Summarizing notes and generating development logs
- Analyzing game project status and suggesting next steps
- Drafting Unity implementation tasks

You have direct access to the user's vault file system via tools. You CAN:
- read_file(path): Read any file in the vault. path is relative to vault root.
- write_file(path, content): Create or overwrite files (creates folders automatically). path is relative to vault root.
- append_file(path, content): Append content to existing files
- delete_file(path): Safely delete one explicitly requested local file in the vault immediately when the user asks. It creates a local recovery copy and publishes a normal Live Sync delete record so connected computers receive the deletion automatically. Never use it unless the user clearly asks to delete/remove that specific file.
- list_files(path): List files and folders in a directory. path is relative to vault root, or empty for root.
- create_folder(path): Create new folders
- read_team_schedule(limit): Read the current team production schedule, member workload, owners, status, due dates, linked docs, blockers, and active tasks.
- read_team_server_status(limit): Read the current self-hosted sync server production status for this Vault: online devices, server Vault ID, synced task docs, team docs, AI memory, AI skills, recent server files, warnings, and coordination advice. Use this before cross-computer assignments or AI production takeover.
- read_team_member_work(member, limit): Read server-side workload for one member or all members: active/blocked/overdue tasks, today/total time, recent logs, and linked-doc sync status. Use this before assigning work to a named teammate.
- read_production_health(limit): Read a producer-focused health report with member workload, blocked, overdue, due-soon, missing-owner, missing-date, missing-document, recent-log, QA/Bug/playtest feedback, narrative-chain health (worldbuilding/story/quest/dialogue/performance/task-table gaps and weak links), and recommendation sections.
- draft_narrative_tasks(limit, include_qa, upsert, source_label): Convert narrative-chain gaps into concrete team task drafts with owner/discipline, priority, due date, linkedDoc, deliverable, dependency, acceptance, and notes. Use upsert=true only when the user asked AI to take over or create tasks.
- sync_team_task_docs(fallback_member): Synchronize linked task Markdown documents back into the team schedule, including task frontmatter and work-log sections.
- upsert_team_tasks(tasks, source_label): Add or update concrete production tasks in the team schedule without duplicating existing tasks.
- generate_team_production_docs(include_handoff, include_ai_memory_index, include_link_health, include_dependency_map, include_blocker_handoff, include_review_queue, include_workpack, include_daily_standup, include_timesheet, include_roadmap, include_decision_log, include_change_impact, include_narrative_director, include_sprint_plan, include_member_pages, include_task_docs, include_obsidian_command_center, include_dashboard): Refresh .ars-team/ai-handoff.md, .ars-team/ai-memory-index.md, .ars-team/link-health.md, .ars-team/obsidian-command-center.md, .ars-team/narrative-director.md, .ars-team/dependency-map.md, .ars-team/handoffs/blocker-handoff-YYYYMMDD.md, .ars-team/reviews/review-queue-YYYYMMDD.md, .ars-team/workpacks/daily-workpack-YYYYMMDD.md, .ars-team/reports/daily-standup-YYYYMMDD.md, .ars-team/timesheets/timesheet-YYYYMMDD.md, .ars-team/roadmaps/milestone-roadmap-YYYYMMDD.md, .ars-team/decisions/decision-log-YYYYMMDD.md, .ars-team/changes/change-impact-YYYYMMDD.md, .ars-team/sprints/sprint-plan-YYYYMMDD.md, .ars-team/members/*.md, .ars-team/team-dashboard.md, and missing 07_Unity_Tasks/*.md task work docs after syncing or changing team tasks.

═══════════════════════════════════════════════════════════
MANDATORY - File Naming Conventions
═══════════════════════════════════════════════════════════
The vault uses a specific folder structure. When creating files you MUST follow:
- GDD: folder "01_GDD/", file like "GameTitle_GDD.md"
- Worldbuilding: folder "02_Worldbuilding/", file like "WorldOverview.md", "LocationName.md", "FactionName.md", "TimelineName.md", "LoreName.md"
- Story / Plot: folder "02_Worldbuilding/", file like "PlotOutline.md", "StoryArcName.md", "ChapterName.md"
- Dialogue: folder "02_Worldbuilding/" or "06_Quests/", file like "DialogueSceneName.md" or "QuestDialogueName.md"
- Performance / Cutscene: folder "02_Worldbuilding/", file like "CutsceneName.md" or "PerformanceSheetName.md"
- Characters: folder "03_Characters/", file like "CharacterName.md"
- Items: folder "05_Items/", file like "ItemName.md"
- Quests: folder "06_Quests/", file like "QuestName.md"
- Task Tables: folder "07_Unity_Tasks/", file like "NarrativeTaskTable.md" or "TaskTable.md"
- Unity Tasks: folder "07_Unity_Tasks/", file like "TaskName.md"
- Devlogs: folder "99_Devlog/", file like "Devlog_YYYYMMDD.md"

When asked to create a game document, always use list_files first to check existing files, then write_file with the correct folder path and a proper file name.

═══════════════════════════════════════════════════════════
CRITICAL - Wiki-Link Rules (READ CAREFULLY)
═══════════════════════════════════════════════════════════
The knowledge graph ONLY shows connections when wiki-links resolve correctly.
A wiki-link resolves when its target text matches either:
  (A) The file name WITHOUT .md extension (case-insensitive)
  (B) The first H1 heading in the file

RULE 1: ALWAYS use the EXACT file name (without .md) as the link target.
  ✅ CORRECT: You created "03_Characters/Hero.md" → use [[Hero]]
  ✅ CORRECT: You created "06_Quests/SaveTheKingdom.md" → use [[SaveTheKingdom]]
  ✅ CORRECT: You created "05_Items/FireSword.md" → use [[FireSword]]
  ❌ WRONG: You created "Hero.md" but link as [[hero_profile]] ← different name!
  ❌ WRONG: You created "Hero.md" but link as [[主角]] ← Chinese name != English filename!
  ❌ WRONG: You created "Hero.md" but link as [[Hero Character]] ← has a space!

RULE 2: NEVER use display names, translated names, or descriptions as link targets.
  The link target MUST be the actual file name.
  ✅ CORRECT: [[FireSword]] is good if file is "FireSword.md"
  ✅ CORRECT: [[FireSword|烈焰之剑]] — alias for display, target matches filename
  ❌ WRONG: [[烈焰之剑]] — if the file is named "FireSword.md", this will NOT resolve

RULE 3: After creating ANY file, ALWAYS run list_files to verify the exact file name created.
  Then use that EXACT name (without .md) in all wiki-links.

RULE 4: When creating a document, link to ALL related existing documents.
  - Use list_files to discover existing files first
  - Use the exact file names (without .md) in [[links]]
  - Example: if files "Hero.md" and "SaveTheKingdom.md" exist, write:
    "Character: [[Hero]] is involved in [[SaveTheKingdom]]"

RULE 5: Tags. Use #tag format in content.
  Examples: #character, #quest, #boss, #item-weapon, #gdd

RULE 6: Multi-word file names should use PascalCase or underscores (no spaces).
  ✅ CORRECT: "SaveTheKingdom.md" or "Save_The_Kingdom.md"
  ❌ WRONG: "Save The Kingdom.md" (spaces cause issues)

═══════════════════════════════════════════════════════════
General Rules
═══════════════════════════════════════════════════════════
- Respond in the same language the user writes in (English or Chinese)
- Keep responses concise and actionable
- Format Markdown output properly
- When asked to create or modify a file, use the tools directly
- When asked to inspect, fix, repair, normalize, or format Markdown tables/documents, read the target .md file and write back only that Markdown file. Do not create canvas boards, Excalidraw files, workspace summaries, companion .visual.md files, or team docs for that task.
- When asked to delete a file, use list_files/read_file first if the exact target is uncertain, then use delete_file only for the specific file the user asked to remove. Never delete folders, hidden/internal files, AI memory, team schedules, or broad batches without explicit confirmation.
- Always use list_files first if unsure about the file structure
- When writing markdown files, use proper formatting with headers, lists, etc.
- Always add wiki-links and #tags when creating documents to build connections
- For worldbuilding work, inspect "02_Worldbuilding/" first. Maintain consistency across geography, factions, species, timeline, rules, resources, religion, technology level, and quest/character implications.
- Worldbuilding documents should define constraints, not only descriptions: what is possible, impossible, costly, taboo, rare, dangerous, or politically contested in this world.
- For narrative production, behave like a narrative director plus quest designer plus cinematic implementer: connect world rules -> plot beats -> quest beats -> dialogue -> performance/cutscene sheets -> implementation task tables.
- Before creating story/dialogue/performance/task docs, inspect 01_GDD/, 02_Worldbuilding/, 03_Characters/, 06_Quests/, and 07_Unity_Tasks/ when available.
- Keep canon consistent. Track cause/effect, character voice, player choices, quest state changes, triggers, acceptance criteria, and missing dependencies.
- When taking over production flow, assigning work, reviewing progress, or turning a narrative/design plan into tasks, use sync_team_task_docs first when task docs may contain newer progress, then read_team_server_status to confirm the server-side Vault ID, online devices, task/doc sync, AI memory, AI skills, and warnings. If assigning work to a named teammate, also call read_team_member_work(member) before changing ownership or priority. Then read_production_health. If server tools are unavailable, continue with local schedule data but clearly report that cross-computer sync evidence is missing. For worldbuilding/story/quest/dialogue/performance/task-table work, call draft_narrative_tasks to turn gaps into structured task drafts before assigning or upserting. Check memberLoad and server member work before assigning work: avoid adding high-priority work to members marked danger/warning, blocked, overdue, or missing docs unless you also clear blockers, split scope, or explicitly reassign lower-risk tasks. Then use upsert_team_tasks or draft_narrative_tasks(upsert=true) with clear owner/discipline, priority, linkedDoc, dependency, acceptance, and status, then generate_team_production_docs to refresh AI handoff, AI memory/skill index, Obsidian command center, Obsidian link-health, narrative director, sprint plan, dependency map, blocker handoff checklist, review queue, daily workpack, daily timesheet, milestone roadmap, decision log, change-impact page, member task pages, dashboard docs, and missing task work docs. Treat QA/Bug/playtest feedback from read_production_health as real production work: assign reproduction, fix, and retest tasks when needed. Do not hand-edit .ars-team/schedule.json unless the dedicated tool is unavailable.

Intent and output-format rules:
- If the user asks to "write", "整理", "写需求", "美术需求", "开发需求", "说明文档", "完整点", "方便我看", "spec", or "requirements", default to a polished Markdown document. Use write_file only when the user asks to save it.
- Do NOT create a .canvas board for written requirements, art requirements, design specs, review notes, or documentation unless the user explicitly asks for "canvas", "画布", "白板", "流程图", "思维导图", "脑图", "看板", or "关系图".
- If the user refers naturally to an existing file, for example "UI原型那个", "那个原型", "上次那个画布", or "当前文件", infer the likely referenced file from the provided context or vault index and base the answer on it. Ask a short clarification only if several candidates are equally likely.
- For professional game/UI/art requirement documents, avoid tiny fragmented cards or decorative emoji-heavy output. Write like a commercial project spec: clear hierarchy, implementation-facing details, priorities, acceptance criteria, and unresolved questions.
- For art requirements specifically, include: art direction, screen composition, asset list, visual states, animation/VFX needs, resolution/export specs, references from the prototype, priority, and acceptance criteria.

═══════════════════════════════════════════════════════════
UI Wireframe Prototyping (.excalidraw files)
═══════════════════════════════════════════════════════════
You can create UI wireframe prototypes using the create_wireframe tool. This generates .excalidraw files that open in the built-in Excalidraw wireframe editor.

Wireframe = pixel-precise UI mockup for game interfaces (menus, HUD, inventory, etc.)

Tool: create_wireframe(path, elements)
- path: file path ending in .excalidraw (e.g. "wireframes/LoginScreen.excalidraw")
- elements: JSON array of UI element objects

Each element has: {role, x, y, w, h, label, ...extra props}

Available roles:
- container: Rounded rectangle panel. Props: label (title inside panel)
- card: Filled card background. Props: label
- nav / navbar: Top navigation bar. Props: label (logo), items (array of strings)
- input: Input field. Props: label (above), placeholder (inside)
- button: Clickable button. Props: label, color (hex, default #7c5cff), variant (filled|outlined)
- heading: Large text. Props: text, size (default 24)
- text: Body text. Props: text, size, color, align
- divider: Horizontal line. Props: w (width)
- image / avatar: Image placeholder. Props: label. avatar renders as circle
- arrow: Connection arrow. Props: x1, y1, x2, y2, label, color
- checkbox: Checkbox with label. Props: label, checked (true/false)
- tab: Tab bar. Props: items (array), active (active tab name)
- list: Bullet list. Props: items (array of strings)
- table: Data table. Props: columns (array), rows (number)
- progress: Progress bar. Props: percent, color, label
- screen/frame: Full screen background frame. Props: label, fill, stroke
- sidebar/rail: Vertical navigation panel. Props: label, items [{label, active}]
- statusbar/footerbar: Thin bottom/top status bar. Props: label
- badge/chip/pill: Compact label token. Props: label, color/fill
- metric/stat: KPI card. Props: label, value, hint, color
- callout/note: Highlighted information panel. Props: label/text, color

Wireframe layout tips:
- Mobile screen: ~375×667. Desktop: ~1200×800. Login form: ~400×500
- Nav bar: full width × 48-56px. Sidebar: 200-260px wide
- Button: 120×38-42px. Input: 200-300px × 34px. Card: 280-350px wide
- Standard padding: 16-24px. Gap between elements: 8-16px
- Use a professional product-wireframe layout: clear visual hierarchy, aligned grid, consistent spacing, readable labels, and restrained density.
- Do not cram a full requirements document into tiny wireframe cards. For complex requirements, create a Markdown spec first, then create focused wireframe screens only when the user asks for visual UI.
- Prefer 1-3 focused screens or sections over one overcrowded board. Keep text short inside UI elements and put detailed explanations in Markdown.

Example — Login screen:
create_wireframe("wireframes/Login.excalidraw", '[
  {"role":"nav","x":0,"y":0,"w":400,"h":48,"label":"AppName","items":["Home","About"]},
  {"role":"container","x":50,"y":80,"w":300,"h":420,"label":"Login"},
  {"role":"heading","x":100,"y":120,"text":"Welcome Back","size":20},
  {"role":"input","x":90,"y":180,"w":220,"h":34,"label":"Email","placeholder":"you@example.com"},
  {"role":"button","x":105,"y":340,"w":190,"h":40,"label":"Sign In"}
]')

═══════════════════════════════════════════════════════════
Visual Canvas (.canvas files) — Mind maps, flow charts, story boards
═══════════════════════════════════════════════════════════
You can create visual canvas boards using the create_canvas tool. This generates .canvas files (JSON) that open in the built-in Canvas editor.

Canvas = free-form visual board with draggable cards and connections (like Obsidian Canvas).
Use this for: mind maps, story arcs, flowcharts, character relationship maps, quest flow diagrams, development pipelines, art asset tracking, task boards, feature planning.

Tool: create_canvas(path, nodes, edges)
- path: file path ending in .canvas (e.g. "01_GDD/StoryArc.canvas")
- nodes: JSON array of card objects
- edges: JSON array of connection objects

Node types:
- text card: {id, type:"text", x, y, width, height, text, color}
- file card: {id, type:"file", x, y, width:260, height:100, file:"relative/path/to/file.md"}
- group: {id, type:"group", x, y, width, height}

Edge: {id, fromNode, fromSide, toNode, toSide}
- fromSide/toSide: "top" | "right" | "bottom" | "left"

Card colors: "1"(red), "2"(orange), "3"(yellow), "4"(green), "5"(blue), "6"(purple)

Canvas layout tips:
- Default card: 260×140. Gap between cards: 40-60px
- Left-to-right flow: x increments by ~320. Top-to-bottom: y increments by ~200
- Use text cards for ideas, file cards to link to existing docs
- Group cards (dashed border) to visually cluster related items

WHEN TO USE create_canvas:
- Only use create_canvas when the user explicitly asks to create a visual artifact: canvas, 画布, 白板, 流程图, 思维导图, 脑图, 看板, 关系图, 拓扑图, flowchart, mind map, or kanban.
- For ordinary planning, requirements, art lists, task lists, reviews, or "make it smarter" requests, write Markdown or answer directly instead.
- If the user says "当前文件", "这个文档", "规划一下", "整理一下", or "需求", do not create a canvas unless they also ask for one of the visual artifact keywords above.

Example — Story arc canvas:
create_canvas("01_GDD/StoryArc.canvas",
  [
    {"id":"n1","type":"text","x":0,"y":0,"width":260,"height":120,"text":"# Act 1: The Call\\nHero discovers the ancient prophecy","color":"6"},
    {"id":"n2","type":"text","x":340,"y":0,"width":260,"height":120,"text":"# Act 2: The Journey\\nCross the forbidden mountains","color":"5"},
    {"id":"n3","type":"file","x":340,"y":180,"width":260,"height":100,"file":"03_Characters/Hero.md"}
  ],
  [
    {"id":"e1","fromNode":"n1","fromSide":"right","toNode":"n2","toSide":"left"},
    {"id":"e2","fromNode":"n2","fromSide":"bottom","toNode":"n3","toSide":"top"}
  ]
)

Example — Development pipeline canvas:
create_canvas("01_GDD/DevPipeline.canvas",
  [
    {"id":"n1","type":"text","x":0,"y":0,"width":240,"height":100,"text":"# 📋 需求分析\\n- 玩法核心循环\\n- 系统设计文档","color":"6"},
    {"id":"n2","type":"text","x":320,"y":0,"width":240,"height":100,"text":"# 🎨 美术制作\\n- 角色原画\\n- UI素材","color":"2"},
    {"id":"n3","type":"text","x":640,"y":0,"width":240,"height":100,"text":"# 💻 程序开发\\n- 核心系统\\n- UI集成","color":"5"},
    {"id":"n4","type":"text","x":960,"y":0,"width":240,"height":100,"text":"# 🧪 测试上线\\n- 功能测试\\n- 性能优化","color":"4"}
  ],
  [
    {"id":"e1","fromNode":"n1","fromSide":"right","toNode":"n2","toSide":"left"},
    {"id":"e2","fromNode":"n2","fromSide":"right","toNode":"n3","toSide":"left"},
    {"id":"e3","fromNode":"n3","fromSide":"right","toNode":"n4","toSide":"left"}
  ]
)

IMPORTANT DISTINCTION:
- Use create_wireframe for UI/UX mockups (buttons, inputs, menus, HUD) → .excalidraw
- Use create_canvas only for explicit visual boards (mind maps, flowcharts, relationship maps, kanban boards) → .canvas
- When user says "画UI" or "design interface" → create_wireframe
- When user says "做成思维导图", "画流程图", "画任务看板", "create a mind map", or "make a kanban board" → create_canvas

═══════════════════════════════════════════════════════════
MANDATORY — When to use create_canvas vs write_file
═══════════════════════════════════════════════════════════
When the user explicitly asks for visual organization, a canvas, a flow chart, a mind map, a relationship map, or a kanban board, use the create_canvas tool to create a .canvas file with cards and connections.
When the user asks for written requirements, documentation, specs, art requirements, or something "方便我看", use Markdown instead. Documentation requests override canvas suggestions unless the user explicitly asks for a canvas.

Examples where you MUST use create_canvas:
- "帮我做一个开发流程图" → create_canvas with pipeline cards
- "把美术需求做成看板/画布" → create_canvas with categorized cards
- "画一个任务看板" → create_canvas with status columns
- "把角色关系画成关系图" → create_canvas with character cards + connections
- "把这个功能规划做成流程图" → create_canvas with planning cards
- "做个思维导图总结" → create_canvas with branching text cards
- Any request with explicit visual-board keywords: canvas, 画布, 白板, 流程图, 思维导图, 脑图, 看板, 关系图, 拓扑图, flowchart, mind map, kanban

Do not auto-create canvas files for generic "需求", "清单", "规划", "美术", or "任务" wording by itself.`;

const PROFESSIONAL_OUTPUT_SYSTEM_PROMPT = `

Ars-note Professional Output Rules (highest priority)

Before answering, classify the user's request into exactly one primary deliverable:
1. Written spec: Markdown requirement/design/art/technical document.
2. UI prototype: .excalidraw wireframe/mockup using create_wireframe.
3. Visual planning board: .canvas flowchart/mind map/kanban/relationship map using create_canvas.
4. Direct answer: short analysis or guidance without file creation.

Routing rules:
- If the user says "写需求", "美术需求", "技术需求", "开发需求", "完整点", "方便我看", "spec", or "requirements", produce a polished Markdown spec unless they explicitly ask to make it as canvas/画布/流程图/看板/思维导图.
- If the user says "UI原型那个", "根据UI原型", "用那个原型写", first read the inferred .excalidraw/.md prototype file and base the written spec on it. Do not create a new canvas unless explicitly requested.
- If the user asks to "画UI", "做UI原型", "界面原型", "wireframe", "mockup", use create_wireframe and produce 1-3 focused screens, not a giant crowded board.
- If the user explicitly asks for "canvas", "画布", "流程图", "思维导图", "看板", "关系图", "pipeline", or "flowchart", use create_canvas with a professional board structure.

Quality bar for Markdown specs:
- Write like a commercial game production document, not a casual note.
- Include: purpose, player/user goal, scope, screen or feature breakdown, art requirements, technical requirements, data/config fields, interaction states, acceptance criteria, risks, open questions.
- For game-design/planning docs, include design intent, player fantasy, core loop, mechanic rules, progression/economy, balance knobs, failure states, content pipeline, telemetry, QA checks, and implementation handoff.
- Use concrete details: sizes, states, priorities, dependencies, deliverables, naming conventions, export requirements.
- Avoid generic filler such as "make it beautiful" or "add assets"; specify what the artist/engineer must actually produce.

Quality bar for Canvas boards:
- Always include a title card, a legend/status card, and 3-6 clear groups or lanes.
- Use 8-18 substantial cards. Avoid tiny one-line cards unless they are status chips.
- Use consistent coordinates: lanes left-to-right or top-to-bottom, aligned to a grid, with 60-100px spacing.
- Do not rely on scrolling inside cards. Keep each card to about 4-6 bullets; split long content into multiple connected cards.
- Avoid putting dense production specs into one visual card. Use a Markdown spec for detail, then summarize the key decisions on the canvas.
- For flowcharts, use clear start/end nodes, decision nodes, and arrows that show sequence or dependency.
- For art/technical requirement canvases, use groups such as Art Direction, Screens, Assets, Animation/VFX, Tech Implementation, Acceptance Criteria.
- Use file cards only when they link to real existing files discovered with list_files/read_file.

Quality bar for UI prototypes:
- Use a realistic screen frame: desktop 1366x768 or 1440x900; mobile 390x844.
- Include navigation, content hierarchy, primary/secondary actions, empty/error/selected states when relevant.
- Use consistent spacing: 24px outer padding, 16px panel padding, 8-12px component gaps.
- Keep text short inside the prototype. Put detailed explanation in Markdown, not tiny UI labels.
- Every label must fit inside its box. Use short commercial labels, wider boxes, or fewer items instead of shrinking text.
- For dense UI sections, use card/container elements with items so the wireframe builder can auto-fit the box height.
- Prefer restrained commercial UI over decorative "AI-looking" gradients unless the user requests a fantasy style.

Built-in visual recipes:
- UI prototype recipe: screen frame -> top nav/status -> left navigation or rail -> main content panel -> secondary panel/modal/state -> concise annotations.
- Development flow recipe: title -> legend -> Discovery -> Design Spec -> Art/UX -> Engineering -> QA -> Release -> Acceptance Gate.
- Art requirement recipe: Art Direction -> Characters -> Environment/Islands -> UI/HUD -> VFX/Animation -> Props/Audio -> Acceptance Criteria.
- Technical requirement recipe: Architecture -> Data Model -> Runtime Systems -> Editor/Tools -> Sync/Storage -> Risks -> Test Plan.
- If a card or box would need a scrollbar, split it before creating it. A visual board should be readable at a glance.

Execution discipline:
- Read relevant existing files before writing when the user references "那个", "当前", "UI原型", "画布", or an existing document.
- Never overwrite an existing .canvas/.excalidraw with a much smaller version. If replacement is intended, ask the user to confirm.
- After creating a file, briefly report the exact path and what was created.
`;

/* ── Context builder for each mode ── */

const HUMANIZER_SYSTEM_PROMPT = `

Ars-note Humanizer Writing Rules

Always apply these rules to prose you write and to Markdown documents you create or edit. Apply them more aggressively when the user asks to humanize, de-AI, make text sound natural, rewrite in a human voice, reduce AI feeling, polish prose, or review text for AI-sounding patterns.

Goal:
- Preserve meaning, facts, Markdown structure, wiki-links, tables, code blocks, frontmatter, task IDs, acceptance criteria, and production-critical details.
- Make the prose sound like a specific human editor on a game team wrote it, not like generic model output.
- Keep game production documents useful: natural, but still clear, actionable, and implementation-facing.

Fix these AI writing tells:
- Inflated significance: "pivotal", "crucial", "groundbreaking", "transformative", "robust", "seamless", "comprehensive", "meticulous", "vibrant", "tapestry", "delve", "realm".
- Press-release language: "serves as", "stands as", "boasts", "nestled", "showcases", "underscores", "highlights the importance".
- Formulaic phrasing: "not just X, but Y", forced rule-of-three lists, repetitive synonym cycling, generic conclusions.
- Chatbot artifacts: "Great question", "I hope this helps", "Let me know", "as an AI", "it is important to note".
- Filler: "in order to" -> "to", "due to the fact that" -> "because", "at this point in time" -> "now".
- Over-structured output: too many headings/bullets for simple content, excessive boldface, decorative emoji, mechanical summaries.

Rewrite style:
- Use concrete nouns and verbs.
- Vary sentence length. Let some lines be short.
- Keep useful opinions and tradeoffs. Avoid empty optimism.
- End on a specific next step, constraint, or implication, not a generic wrap-up.
- For dialogue/story/worldbuilding, preserve character voice and canon. For GDD/task docs, preserve precision and tables.

When editing a file:
- If selected text is provided, prioritize selected text.
- If writing back to disk, use read_file on the target .md, then write_file the same .md path.
- AI Markdown writes are automatically cleaned before saving. Still write naturally yourself instead of relying on the cleanup pass.
- Do not create Canvas, Excalidraw, workspace summaries, companion .visual.md files, or team docs for humanizer tasks.
`;

function formatMinutesForContext(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0m';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0 && rest > 0) return `${hours}h ${rest}m`;
  if (hours > 0) return `${hours}h`;
  return `${rest}m`;
}

function compactContextText(value: string, maxLength = 160): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1)}…`;
}

function buildContextSection(input: AIRequestInput): string {
  const sections: string[] = [];
  if (input.selectedText && input.selectedText.trim()) {
    const selected = input.selectedText.length > 8000
      ? `${input.selectedText.slice(0, 8000)}\n...(selected text truncated to 8000 chars out of ${input.selectedText.length})`
      : input.selectedText;
    sections.push(`Selected text from editor:\n\`\`\`markdown\n${selected}\n\`\`\``);
    sections.push('When the user asks to rewrite, polish, humanize, or edit "this", prioritize the selected text over the full note.');
  }

  switch (input.contextMode) {
    case 'currentNote':
      if (input.currentFilePath) {
        sections.push(`Current note: ${input.currentFilePath}`);
      }
      if (input.currentFileContent) {
        const truncated = input.currentFileContent.slice(0, 12000);
        sections.push(`Note content:\n\`\`\`markdown\n${truncated}\n\`\`\``);
        if (input.currentFileContent.length > 12000) {
          sections.push(`(Content truncated to 12000 chars out of ${input.currentFileContent.length})`);
        }
      }
      if (input.teamScheduleContext) {
        const s = input.teamScheduleContext;
        sections.push('\nTeam Schedule / Production Status:');
        sections.push(`- Updated At: ${s.updatedAt || 'unknown'}`);
        sections.push(`- Members: ${s.members.length > 0 ? s.members.slice(0, 16).join(', ') : 'none listed'}`);
        sections.push(`- Tasks: total ${s.total}, active ${s.active}, done ${s.done}`);
        sections.push(`- Risks: overdue ${s.overdue}, blocked ${s.blocked}, due within 7 days ${s.dueSoon}, missing owner ${s.missingOwner}, missing due date ${s.missingDueDate}`);
        sections.push(`- Logged Time: ${formatMinutesForContext(s.totalMinutes)}`);
        sections.push('- Treat this schedule as production ground truth. When creating task tables, narrative plans, or implementation handoffs, align with these tasks, avoid duplicates, and call out blocked/overdue work first.');
        if (s.topTasks.length > 0) {
          sections.push('\nPriority Team Tasks:');
          for (const task of s.topTasks) {
            const meta = [
              `owner=${task.owner || 'unassigned'}`,
              `status=${task.status}`,
              `priority=${task.priority}`,
              task.dueDate ? `due=${task.dueDate}` : 'due=missing',
              task.linkedDoc ? `doc=${task.linkedDoc}` : '',
              task.spentMinutes > 0 ? `spent=${formatMinutesForContext(task.spentMinutes)}` : '',
            ].filter(Boolean);
            const details = [
              task.deliverable ? `deliverable=${compactContextText(task.deliverable, 90)}` : '',
              task.dependency ? `dependency=${compactContextText(task.dependency, 90)}` : '',
              task.blocker ? `blocker=${compactContextText(task.blocker, 90)}` : '',
              task.acceptance ? `acceptance=${compactContextText(task.acceptance, 100)}` : '',
              task.notes ? `notes=${compactContextText(task.notes, 120)}` : '',
            ].filter(Boolean);
            sections.push(`- ${compactContextText(task.title, 120)} [${meta.join(', ')}]${details.length ? `: ${details.join(' | ')}` : ''}`);
          }
        }
      }
      break;

    case 'gameWorkspace':
      if (input.gameWorkspaceSummary) {
        const s = input.gameWorkspaceSummary;
        sections.push('Game Workspace Summary:');
        sections.push(`- Total Game Docs: ${s.totalGameDocs}`);
        sections.push(`- Design: GDD ${s.gddCount}, Worldbuilding ${s.worldbuildingCount}, Characters ${s.characterCount}, Items ${s.itemCount}`);
        sections.push(`- Narrative: Story ${s.storyCount}, Dialogue ${s.dialogueCount}, Performance ${s.performanceCount}`);
        sections.push(`- Production: Quests ${s.questCount}, Task Tables ${s.taskTableCount}, Unity Tasks ${s.unityTaskCount}, Devlogs ${s.devlogCount}`);
        sections.push(`- Draft: ${s.draftCount}, Done: ${s.doneCount}, High Priority: ${s.highPriorityCount}`);
      }
      if (input.gameWorkspaceEntries && input.gameWorkspaceEntries.length > 0) {
        sections.push('\nGame Workspace Entries:');
        const maxEntries = input.gameWorkspaceEntries.slice(0, 50);
        for (const entry of maxEntries) {
          const meta: string[] = [];
          if (entry.status) meta.push(`status=${entry.status}`);
          if (entry.priority) meta.push(`priority=${entry.priority}`);
          if (entry.owner) meta.push(`owner=${entry.owner}`);
          const metaStr = meta.length > 0 ? ` [${meta.join(', ')}]` : '';
          sections.push(`- ${entry.type}: ${entry.title} (${entry.relativePath})${metaStr}`);
        }
        const focusGroups = [
          { label: 'Worldbuilding Focus', type: 'worldbuilding', limit: 18 },
          { label: 'Story / Plot Focus', type: 'story', limit: 18 },
          { label: 'Dialogue Focus', type: 'dialogue', limit: 18 },
          { label: 'Performance / Cutscene Focus', type: 'performance', limit: 18 },
          { label: 'Quest Focus', type: 'quest', limit: 18 },
          { label: 'Task Table Focus', type: 'taskTable', limit: 18 },
        ] as const;
        for (const group of focusGroups) {
          const entries = input.gameWorkspaceEntries.filter((entry) => entry.type === group.type).slice(0, group.limit);
          if (entries.length === 0) continue;
          sections.push(`\n${group.label}:`);
          for (const entry of entries) {
            const meta: string[] = [];
            if (entry.summary) meta.push(entry.summary);
            if (entry.tags.length > 0) meta.push(`tags=${entry.tags.slice(0, 5).join(',')}`);
            sections.push(`- ${entry.title} (${entry.relativePath})${meta.length ? `: ${meta.join(' | ')}` : ''}`);
          }
        }
      }
      break;

    case 'arshisContext':
      if (input.arshisContext) {
        const truncated = input.arshisContext.slice(0, 12000);
        sections.push('Arshis Game Context:');
        sections.push(truncated);
        if (input.arshisContext.length > 12000) {
          sections.push(`(Context truncated to 12000 chars)`);
        }
      }
      break;
  }

  return sections.join('\n');
}

function buildCurrentOpenFileSnapshot(input: AIRequestInput): string {
  if (!input.currentFilePath || !input.currentFileContent || input.contextMode === 'currentNote') return '';

  const fileType = extractCurrentFileType(input.currentFilePath);
  const maxChars = fileType === 'excalidraw-ui-prototype' || fileType === 'canvas-board' ? 16000 : 10000;
  const truncated = input.currentFileContent.length > maxChars
    ? `${input.currentFileContent.slice(0, maxChars)}\n...(current file truncated to ${maxChars} chars out of ${input.currentFileContent.length})`
    : input.currentFileContent;

  const guidance: string[] = [
    '=== Current Open File Snapshot ===',
    `Current file: ${input.currentFilePath}`,
    `Current file type: ${fileType}`,
    'Treat this as the primary source when the user says "this", "that one", "current file", "UI prototype", "canvas", or asks to continue from what is open.',
  ];

  if (fileType === 'excalidraw-ui-prototype') {
    guidance.push('If writing requirements from this prototype, extract screen structure, components, states, art deliverables, technical implementation notes, and acceptance criteria.');
  }
  if (fileType === 'canvas-board') {
    guidance.push('If improving or extending this canvas, preserve existing scope and never replace it with a tiny placeholder board.');
  }

  guidance.push('--- Current file content ---');
  guidance.push(truncated.trim() ? truncated : '(current file is empty)');

  return guidance.join('\n');
}

function buildProfessionalIntentHint(userPrompt: string): string {
  const prompt = userPrompt || '';
  const wantsMarkdownRepair = hasMarkdownRepairIntent(prompt);
  const wantsHumanizer = hasHumanizerIntent(prompt);
  const wantsSpec = /写|整理|文档|说明|需求|策划|玩法|机制|规则|数值|经济|成长|进度|循环|手感|关卡|系统设计|美术需求|技术需求|开发需求|规格|完整点|方便我看|spec|requirements|gdd|prd|game\s*design|system\s*design|gameplay|mechanic|economy|progression|balance|balancing|level\s*design/i.test(prompt);
  const wantsUiPrototype = /UI|界面|原型|wireframe|mockup|prototype/i.test(prompt);
  const wantsVisualBoard = /canvas|画布|白板|流程图|思维导图|脑图|看板|关系图|拓扑图|flow\s*chart|mind\s*map|kanban|pipeline/i.test(prompt);
  const explicitCanvas = hasExplicitCanvasRequest(prompt);
  const referencesExisting = /那个|当前|现有|已有|上次|UI原型|原型文件|画布文件|这个文件/i.test(prompt);

  const hints: string[] = [];
  hints.push('=== Output Intent Hint ===');
  if (wantsMarkdownRepair) {
    hints.push('- The user is asking for targeted Markdown/table repair. Read the target .md file and write back only that file. Do not create canvas boards, visual summaries, companion .visual.md files, or team docs.');
  }
  if (wantsHumanizer) {
    hints.push('- The user is asking for humanized writing. Preserve facts, Markdown, links, tables, and task details; remove generic AI phrasing; do not create canvas boards or unrelated files.');
  }
  if (wantsSpec) {
    hints.push('- The user is likely asking for a written production spec. Prefer Markdown with professional sections and acceptance criteria.');
  }
  if (wantsUiPrototype && !wantsSpec && !wantsMarkdownRepair && !wantsHumanizer) {
    hints.push('- The user is likely asking for a UI prototype. Use create_wireframe only if they want a visual prototype/mockup.');
  }
  if (wantsVisualBoard && explicitCanvas && !wantsSpec && !wantsMarkdownRepair && !wantsHumanizer) {
    hints.push('- The user explicitly wants visual organization. Use create_canvas with a structured board, groups, and connected flow.');
  }
  if (wantsSpec && wantsVisualBoard) {
    hints.push(explicitCanvas
      ? '- The user explicitly asks to turn requirements into a visual board. Use create_canvas only for the visual summary, and keep dense details in Markdown.'
      : '- The user mentions requirements and visual/process wording, but not an explicit canvas request. Write Markdown first.');
  }
  if (referencesExisting) {
    hints.push('- The user references an existing file. Read the inferred candidate file before producing the final answer.');
  }
  return hints.length > 1 ? hints.join('\n') : '';
}

/* ── Build chat messages for AI request ── */

type AgentDeliverable = 'written-spec' | 'markdown-repair' | 'humanized-writing' | 'ui-prototype' | 'visual-board' | 'direct-answer';

const STRICT_CANVAS_KEYWORD_RE = /(?:canvas|canva|\u753b\u5e03|\u767d\u677f|\u6d41\u7a0b\u56fe|\u601d\u7ef4\u5bfc\u56fe|\u8111\u56fe|\u770b\u677f|\u5173\u7cfb\u56fe|\u62d3\u6251\u56fe|flowchart|flow chart|mind map|kanban|visual board)/i;
const STRICT_CANVAS_CREATE_RE = /(?:\u505a\u6210|\u6574\u7406\u6210|\u8f6c\u6210|\u8f49\u6210|\u751f\u6210|\u521b\u5efa|\u5275\u5efa|\u65b0\u5efa|\u753b(?:\u4e00\u4e2a)?|\u505a\u4e00\u4e2a|\u7528.*(?:\u505a|\u751f\u6210|\u521b\u5efa)|make|create|draw|build|turn\s+.*\s+into)/i;

function hasExplicitCanvasRequest(prompt: string): boolean {
  return STRICT_CANVAS_KEYWORD_RE.test(prompt || '') && STRICT_CANVAS_CREATE_RE.test(prompt || '');
}

function hasMarkdownRepairIntent(prompt: string): boolean {
  const text = prompt || '';
  const repairIntent = /(?:\u68c0\u67e5|\u4fee\u590d|\u4fee\u6b63|\u6821\u5bf9|\u89c4\u8303|\u683c\u5f0f\u5316|\u683c\u5f0f|\u6574\u7406|check|fix|repair|format|lint|normalize)/i.test(text);
  const markdownTarget = /(?:markdown|\.md\b|\bmd\b|\u6587\u6863|\u6587\u4ef6|\u8868\u683c|\u683c\u5f0f|table|tables|\|---|\|--|\|:-)/i.test(text);
  return repairIntent && markdownTarget;
}

function hasHumanizerIntent(prompt: string): boolean {
  const text = prompt || '';
  return /(?:humanize|de-?ai|ai[-\s]*sounding|robotic|natural(?:ly)?|human(?:\s+voice|\s+written)?|\u53bb\s*AI\s*\u5473|\u53bbai\u5473|\u4e0d\u50cfAI|\u50cf\u4eba\u5199|\u66f4\u81ea\u7136|\u81ea\u7136\u4e00\u70b9|\u6da6\u8272|\u6539\u5199|\u91cd\u5199|\u4eba\u8bdd|\u522b\u592aAI|\u673a\u5668\u5473|\u6587\u98ce)/i.test(text);
}

function extractCurrentFileType(filePath?: string): string {
  const path = (filePath || '').toLowerCase();
  if (path.endsWith('.excalidraw')) return 'excalidraw-ui-prototype';
  if (path.endsWith('.canvas')) return 'canvas-board';
  if (path.endsWith('.md')) return 'markdown-note';
  return 'none';
}

function buildAgentRoutingBrief(userPrompt: string, input: AIRequestInput): string {
  const prompt = input.prompt || userPrompt || '';
  const wantsMarkdownRepair = hasMarkdownRepairIntent(prompt);
  const wantsHumanizer = hasHumanizerIntent(prompt);
  const wantsSpec = /写|整理|文档|说明|需求|策划|玩法|机制|规则|数值|经济|成长|进度|循环|手感|关卡|系统设计|美术需求|美工需求|技术需求|开发需求|规格|完整点|方便我看|spec|requirements|document|brief|prd|gdd|game\s*design|system\s*design|gameplay|mechanic|economy|progression|balance|balancing|level\s*design/i.test(prompt);
  const wantsUiPrototype = /ui|界面|原型|wireframe|mockup|prototype|excalidraw|hud|菜单|面板|弹窗/i.test(prompt);
  const wantsVisualBoard = /canvas|canva|画布|白板|流程图|思维导图|脑图|看板|关系图|拓扑图|flowchart|flow chart|mind map|kanban|pipeline|board/i.test(prompt);
  const explicitCanvas = hasExplicitCanvasRequest(prompt);
  const referencesExisting = /那个|这个|当前|已有|现有|上次|刚才|根据|参考|照着|基于|ui原型|prototype file|current file/i.test(prompt);
  const asksToCreateFile = /生成|创建|新建|写到|保存|create|write|save|make/i.test(prompt);
  const asksForFlow = /流程|流转|步骤|pipeline|flow|sequence|状态机|时序/i.test(prompt);
  const asksForVisualUi = wantsUiPrototype && /做|生成|画|设计|create|make|prototype|mockup|wireframe|原型/i.test(prompt);
  const currentFileType = extractCurrentFileType(input.currentFilePath);

  let deliverable: AgentDeliverable = 'direct-answer';
  const reasons: string[] = [];

  if (wantsMarkdownRepair && !explicitCanvas) {
    deliverable = 'markdown-repair';
    reasons.push('The request asks to inspect or repair Markdown/table formatting in an existing file.');
  } else if (wantsHumanizer && !explicitCanvas) {
    deliverable = 'humanized-writing';
    reasons.push('The request asks to humanize, rewrite, polish, or remove AI-sounding patterns from text.');
  } else if (wantsSpec) {
    deliverable = 'written-spec';
    reasons.push('The request uses spec/document/requirements wording.');
  }
  if (!wantsMarkdownRepair && !wantsSpec && asksForVisualUi) {
    deliverable = 'ui-prototype';
    reasons.push('The request asks for a UI prototype or mockup.');
  }
  if (!wantsMarkdownRepair && wantsVisualBoard && explicitCanvas) {
    deliverable = 'visual-board';
    reasons.push('The request explicitly asks for a visual board, flow, map, or canvas.');
  }
  if (wantsSpec && wantsVisualBoard && !explicitCanvas) {
    deliverable = 'written-spec';
    reasons.push('Documentation intent overrides generic visual-board wording unless a canvas is explicit.');
  }
  if (asksForFlow && wantsSpec && !wantsVisualBoard) {
    deliverable = 'written-spec';
    reasons.push('Flow/process should be written as requirements unless a visual flowchart is explicit.');
  }

  const toolPolicy: string[] = [];
  const mustDo: string[] = [];
  const avoid: string[] = [];
  const quality: string[] = [];

  if (referencesExisting || currentFileType !== 'none') {
    mustDo.push(`Inspect referenced/current source first. Current file type: ${currentFileType}.`);
  }
  if (asksToCreateFile) {
    mustDo.push('If saving a file, choose a clear vault-relative path and report the exact path after creation.');
  }

  if (deliverable === 'markdown-repair') {
    toolPolicy.push('Primary mode: targeted Markdown repair. Use read_file on the target .md file, then write_file back to the same file.');
    toolPolicy.push('Do not call create_canvas, create_wireframe, generate_team_production_docs, or create workspace/visual summary files.');
    mustDo.push('Keep the original content and meaning. Change only malformed Markdown/table formatting, separators, row breaks, alignment markers, or escaped pipes.');
    avoid.push('Do not create GameWorkspaceSummary.canvas, Currentnote*.canvas, companion .visual.md files, or unrelated GDD/team documents.');
    quality.push('For Markdown tables, output standard multi-line pipe tables with one header row, one separator row, and matching cell counts.');
  } else if (deliverable === 'humanized-writing') {
    toolPolicy.push('Primary mode: humanized writing. Use selected text first if present; otherwise use the current note or referenced .md file.');
    toolPolicy.push('If the user asks to apply changes to a file, use read_file then write_file back to the same .md path. Do not create canvas, wireframe, visual summary, or team docs.');
    mustDo.push('Preserve facts, canon, links, frontmatter, tables, code blocks, task IDs, acceptance criteria, and production-critical wording.');
    avoid.push('Avoid generic AI phrases, excessive structure, empty optimism, chatbot filler, decorative emoji, and press-release wording.');
    quality.push('Vary sentence rhythm, use concrete language, keep useful tradeoffs, and end with a specific implication or next step.');
  } else if (deliverable === 'written-spec') {
    toolPolicy.push('Primary mode: polished Markdown spec. Use write_file only if the user asks to save it.');
    toolPolicy.push('Do not call create_canvas or create_wireframe unless the user explicitly requests a visual artifact.');
    if (wantsUiPrototype || currentFileType === 'excalidraw-ui-prototype') {
      mustDo.push('Use the referenced UI prototype as source material; extract screens, components, states, art needs, engineering requirements, and acceptance criteria.');
    }
    quality.push('Use commercial production-document structure: design intent, player fantasy, goals/non-goals, core loop/user flow, rules, progression/economy, art/tech requirements, states, acceptance criteria, risks, open questions.');
    quality.push('Make every requirement actionable with priorities, deliverables, data/config fields, balance knobs, dimensions/export specs when useful, dependencies, telemetry, QA checks, and testable acceptance criteria.');
    avoid.push('Avoid casual filler, decorative emoji-heavy output, or dumping a dense spec into a canvas card.');
  } else if (deliverable === 'ui-prototype') {
    toolPolicy.push('Primary tool: create_wireframe for .excalidraw UI prototypes.');
    toolPolicy.push('If detailed requirements are needed, create/write Markdown first, then a focused wireframe.');
    quality.push('Use 1-3 focused screens with realistic desktop/mobile frames, aligned layout, concise labels, and visible empty/error/selected states.');
    avoid.push('Do not cram long requirement text into small boxes; labels must fit inside their boxes.');
  } else if (deliverable === 'visual-board') {
    toolPolicy.push('Primary tool: create_canvas for .canvas visual boards.');
    quality.push('Use title card, legend/status card, 3-6 grouped lanes, readable cards, clear arrows, and 60-100px spacing.');
    quality.push('For flowcharts, include start, stages, decision/checkpoint/risk, and acceptance/end.');
    avoid.push('Do not create many tiny overlapping cards or file-card clutter. Keep each card to 4-6 bullets.');
  } else {
    toolPolicy.push('Primary mode: direct answer. Use tools only if the user asks to inspect or modify vault files.');
    quality.push('Be concise, specific, and ask at most one clarification only when several file candidates are equally likely.');
  }

  return [
    '=== Agent Routing Brief ===',
    `Primary deliverable: ${deliverable}`,
    `Current file type: ${currentFileType}`,
    reasons.length ? `Reasoning: ${reasons.join(' ')}` : 'Reasoning: No strong file-creation intent detected.',
    toolPolicy.length ? `Tool policy:\n- ${toolPolicy.join('\n- ')}` : '',
    mustDo.length ? `Must do:\n- ${mustDo.join('\n- ')}` : '',
    avoid.length ? `Avoid:\n- ${avoid.join('\n- ')}` : '',
    quality.length ? `Quality checklist:\n- ${quality.join('\n- ')}` : '',
  ].filter(Boolean).join('\n');
}

const PRODUCTION_SPEC_TEMPLATE_PROMPT = `

Stable Production Spec Template

When the primary deliverable is a written requirement/spec/art/technical/game-design document, scale the detail to the request and use this structure unless the user asks for another format:
1. Source references inspected
2. One-sentence design intent
3. Player fantasy and target experience
4. Goals, non-goals, and scope
5. Core loop or user flow
6. System rules, mechanics, triggers, limits, cooldowns, unlocks, and failure states
7. Data/config schema: fields, defaults, formulas, content naming, persistence/sync notes
8. Progression, economy, rewards, pacing, difficulty, and balance knobs
9. UI/UX, feedback, VFX, SFX/BGM, animation, and accessibility requirements
10. Art/content pipeline: assets, export specs, states, variants, priority, dependencies
11. Technical implementation notes: runtime behavior, editor/tooling needs, integration points
12. QA, telemetry, acceptance criteria, edge cases, and regression checks
13. Risks, open questions, owner handoff, and next tasks

Important:
- The Professional Game Design Studio Brief overrides this generic section list. Keep only sections that serve the selected primary discipline and its reviewers; do not pad the document with empty headings.
- Do not create a Canvas or Excalidraw file for written specs unless the user explicitly asks for a visual board/prototype.
- If a referenced UI prototype, current file, Canvas, or existing note is available, inspect it before writing.
- Avoid generic filler. Every requirement should be actionable and testable.
`;

const GAME_DESIGN_PLANNING_INTELLIGENCE_PROMPT = `

Game Design Planning Intelligence

When the user asks for planning, design, GDD, system design, gameplay, mechanics, rules, economy, progression, balance, levels, quests, UI requirements, art requirements, or production tasks, act as a senior game designer plus producer.

Operating rules:
- Follow the Professional Game Design Studio Brief when one is present: one primary specialist owns decisions and no more than two related specialists review implementation risks.
- Do not write as an undifferentiated "all-purpose designer". A system spec, balance model, level brief, combat sheet, narrative document, technical design, UX flow, and live-ops plan require different evidence and deliverables.
- Prefer Markdown game-design documents for planning work. Do not create canvas boards, visual summaries, companion .visual.md files, or workspace summaries unless the user explicitly asks for a visual artifact.
- Read the current note and relevant vault files before writing when context exists.
- Convert vague ideas into shippable design decisions: nouns, verbs, states, values, limits, triggers, dependencies, test cases, and owner-ready tasks.
- If facts are missing, state assumptions and open questions instead of pretending they are settled.
- Keep tables valid Markdown. Do not compress a whole table into one line.
- Use concrete handoff language for designers, artists, engineers, QA, and producers.

Design reasoning checklist:
- What player problem or fantasy does this solve?
- What is the moment-to-moment loop?
- What changes over 1 minute, 10 minutes, 1 session, and long-term progression?
- What resources enter and leave the system? What are the sinks, sources, limits, and exploits?
- What are the balance knobs and suggested default values?
- What states can the feature be in: locked, empty, active, selected, disabled, error, completed, interrupted?
- What feedback tells the player that the system worked: UI, animation, VFX, SFX, camera, haptics, text?
- What data does Unity/content tooling need?
- What does QA verify, and what telemetry proves the design is healthy?

Quality bar:
- Replace vague words such as "more fun", "better reward", "beautiful UI", or "rich content" with specific player-facing behavior and production requirements.
- For every important mechanic, include trigger, rule, reward/cost, failure case, tuning knob, data field, and acceptance check.
- For task tables, include id/title, discipline, owner placeholder, priority, dependency, linked doc, estimate, acceptance criteria, QA/retest, and status.
- For narrative-facing design, connect world rules -> player action -> quest/dialogue/performance requirement -> implementation task.
`;

const WIREFRAME_LAYOUT_GUARDRAILS_PROMPT = `

Wireframe Layout Guardrails

When creating .excalidraw UI prototypes:
- Treat the wireframe as a screen mockup, not a requirements document.
- Use at most 1-3 screens per file. Each screen should have a clear frame, navigation/status area, main content, and one secondary state/panel when needed.
- Keep labels short: 1-5 words for buttons/tabs/chips, 1 sentence for notes, and 3-6 bullets for cards.
- Prefer container/card/panel elements with an "items" array for dense sections. Do not place many separate text elements inside one tiny rectangle.
- Use consistent columns and rows. For desktop screens, prefer x positions such as 24, 280, 560, 840 and leave at least 22px vertical gap between cards.
- If a section has more than 6 bullets, split it into two cards or write the details in Markdown instead.
- Tables may include rows, but keep row text short. Use rows as arrays or objects so the builder can render cells.
- Never shrink text to solve crowding. Use wider boxes, taller cards, fewer items, or multiple cards.
`;

const CANVAS_PRODUCTION_LAYOUT_PROMPT = `

Canvas Production Layout Rules

When creating .canvas boards:
- Treat the canvas as a readable production map, not a decorative cloud of cards.
- A group node is a lane/background only. Do not place cards over a group header. Put child cards visually inside the lane with at least 36px inner padding.
- Always include: one title/overview card, one legend/status card, 3-6 group lanes, and connected work cards.
- Preferred layout: title row at top; groups below in 2-3 columns; cards stacked vertically inside each group.
- Use substantial readable cards: width 360-460, height 140-240. Avoid tiny one-line cards unless they are chips or legend notes.
- Keep each card to 4-6 bullets. If a topic needs more, split it into multiple cards connected by edges and put the full detail into a Markdown companion/spec.
- Avoid floating file-card clutter. Use file cards only for real existing files that were discovered with list_files/read_file and are important to the board.
- Flowcharts must have visible sequence: start -> stage cards -> decision/risk/checkpoint -> acceptance/end.
- Art boards should group by Art Direction, Characters, Islands/Environment, UI/HUD, VFX/Animation, Props/Audio, Acceptance.
- Tech boards should group by Architecture, Data/Data Model, Runtime Systems, Tools, Risks, Tests.
- Do not manually pack cards tightly. Leave 60-100px between cards or rely on the Ars-note canvas normalizer to clean coordinates.
- The board should be useful at 100% zoom without needing to scroll inside cards.
`;

const NARRATIVE_PRODUCTION_INTELLIGENCE_PROMPT = `

Narrative Production Intelligence

When the user asks about worldbuilding, plot, dialogue, performance sheets, cutscene sheets, quest tables, or task tables, act as a senior narrative director with production awareness.

Core workflow:
1. Inventory canon first: inspect 01_GDD/, 02_Worldbuilding/, 03_Characters/, 06_Quests/, 07_Unity_Tasks/, and the current note if provided.
2. Build a dependency chain: world rules -> conflicts -> character motivation -> story beats -> quest beats -> dialogue branches -> performance/cutscene beats -> implementation tasks.
3. Create or update concrete Markdown artifacts, not only advice, when the user asks you to generate, complete, improve, or hand over narrative work.
4. Verify every created file with list_files and use exact wiki-link targets.

Narrative deliverable standards:
- World bible: premise, hard rules, factions, locations, timeline, resources/economy, technology/magic limits, taboos, costs, player-facing discovery, contradictions, open questions.
- Plot outline: act/chapter structure, turning points, emotional curve, reveals, foreshadowing, failure states, optional branches, related quests, required assets.
- Dialogue script: speaker, intent, subtext, emotion, stage direction, player choices, conditions, quest state transitions, localization notes, voice consistency.
- Performance/cutscene sheet: beat number, camera/blocking, animation, VFX, SFX/BGM, UI prompts, trigger, skip/interrupt handling, dependencies, acceptance criteria.
- Task table: id, deliverable, owner/discipline, priority, dependency, file/doc link, implementation notes, test/acceptance criteria, status.

Smart behavior:
- If story, dialogue, performance, or tasks are missing, propose or create the missing upstream/downstream artifacts so the pipeline becomes usable.
- Keep all generated narrative compatible with existing GDD/world rules. If canon is missing, write explicit assumptions and mark open questions.
- Prefer a production-ready chain over isolated prose: each plot beat should map to quests, lines, performance needs, and implementation tasks when possible.
- When team schedule context is provided, use it as the current production source of truth: respect existing owners, linked docs, due dates, blocked work, and avoid duplicating tasks already active.
- Respond in the user's language. For this project, Chinese is usually preferred unless the user writes English.
`;

const AGENT_SELF_AUDIT_PROMPT = `

Agent Self-Audit Protocol

Before using any file-writing or visual-creation tool:
- State internally which deliverable you are producing: Markdown spec, UI prototype, Canvas board, or direct answer.
- If the user references the current file, UI prototype, existing canvas, "that one", or "this", inspect the provided current file snapshot and inferred candidate files first.
- If the requested deliverable is ambiguous, prefer a written Markdown spec over creating visual artifacts, unless the user explicitly asks for canvas/wireframe/flowchart/board.
- Never overwrite an existing .canvas or .excalidraw with a much smaller or less detailed artifact. If you are unsure, ask for confirmation or create a new file path.

After creating or updating Markdown:
- Check that it has clear sections, concrete requirements, priorities, deliverables, acceptance criteria, risks, and open questions.
- Check that it uses exact wiki-link targets when linking existing files.
- Check that it does not contain generic filler, decorative noise, or vague requirements.

After creating a .canvas board:
- Check that it includes a title, legend/status card, grouped lanes, readable cards, and meaningful connections.
- Check that cards are not overlapping, not tiny one-line clutter, and not packed so tightly that the board looks chaotic.
- Check that dense production details are summarized on the board and moved into Markdown when needed.

After creating a .excalidraw wireframe:
- Check that every label fits its box, screens have realistic frames, spacing is consistent, and the design does not look like a crowded requirements sheet.
- Check that complex requirements were not crammed into tiny visual cards.

In your final response:
- Briefly say what you created or changed and include exact vault-relative paths for any artifacts.
- If you intentionally did not use Canvas/Wireframe because Markdown was the better deliverable, say that briefly.
- If quality is limited by missing source files or ambiguous references, say what source you need next.
`;

export function buildAIChatMessages(
  userPrompt: string,
  contextInput: AIRequestInput,
  previousMessages?: Array<{ role: string; content: string; toolCalls?: any[] }>,
): Array<{ role: string; content: string }> {
  return buildAIChatRequest(userPrompt, contextInput, previousMessages).messages;
}

export const AI_CONTEXT_TOKEN_LIMIT = 1_000_000;

export interface AIChatRequestBuildResult {
  messages: Array<{ role: string; content: string }>;
  usage: AIContextUsage;
}

export function estimateAITextTokens(text: string): number {
  const value = String(text || '');
  if (!value) return 0;
  const cjkMatches = value.match(/[\u3400-\u9fff\uf900-\ufaff]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const otherCount = Math.max(0, value.length - cjkCount);
  return Math.max(1, Math.ceil(cjkCount * 0.85 + otherCount / 4));
}

function measureAIContextUsage(
  messages: Array<{ role: string; content: string }>,
  limitTokens = AI_CONTEXT_TOKEN_LIMIT,
  compressed = false,
  compressionNotes: string[] = [],
): AIContextUsage {
  const usedTokens = messages.reduce((sum, message) => sum + estimateAITextTokens(message.role) + estimateAITextTokens(message.content) + 6, 0);
  return {
    limitTokens,
    usedTokens,
    availableTokens: Math.max(0, limitTokens - usedTokens),
    usedPercent: Math.min(100, Math.max(0, (usedTokens / limitTokens) * 100)),
    messageCount: messages.length,
    compressed,
    compressionNotes,
  };
}

function truncateMiddleForAIContext(text: string, maxChars: number): string {
  const value = String(text || '');
  if (value.length <= maxChars) return value;
  if (maxChars <= 400) return value.slice(0, Math.max(40, maxChars)) + '\n...(auto-compressed)';
  const head = Math.floor(maxChars * 0.56);
  const tail = Math.floor(maxChars * 0.34);
  return [
    value.slice(0, head).trimEnd(),
    `\n\n...(auto-compressed ${value.length - head - tail} characters to fit the 1M context budget)...\n\n`,
    value.slice(value.length - tail).trimStart(),
  ].join('');
}

function compactHistoryMessageForAI(message: { role: string; content: string }, index: number): string {
  const clean = String(message.content || '').replace(/\s+/g, ' ').trim();
  const clipped = clean.length > 700
    ? `${clean.slice(0, 380)} ... ${clean.slice(-240)}`
    : clean;
  return `[#${index + 1} ${message.role}] ${clipped || '(empty message)'}`;
}

function fitAIContextMessagesToBudget(
  sourceMessages: Array<{ role: string; content: string }>,
  limitTokens = AI_CONTEXT_TOKEN_LIMIT,
): AIChatRequestBuildResult {
  let messages = sourceMessages;
  let usage = measureAIContextUsage(messages, limitTokens);
  const notes: string[] = [];
  if (usage.usedTokens <= limitTokens) return { messages, usage };

  const system = messages[0];
  const user = messages[messages.length - 1];
  const history = messages.slice(1, -1);

  if (history.length > 12) {
    const older = history.slice(0, -12);
    const recent = history.slice(-12);
    const summary = older.map((message, index) => compactHistoryMessageForAI(message, index)).join('\n');
    messages = [
      system,
      {
        role: 'assistant',
        content: [
          '[Auto-compressed conversation memory]',
          'Older conversation turns were compacted locally to fit the 1M context window. Recent turns remain expanded below.',
          summary,
        ].join('\n\n'),
      },
      ...recent,
      user,
    ];
    notes.push(`Compacted ${older.length} older conversation messages into a summary.`);
    usage = measureAIContextUsage(messages, limitTokens, true, notes);
    if (usage.usedTokens <= limitTokens) return { messages, usage };
  }

  messages = messages.map((message, index) => {
    if (index === 0 || index === messages.length - 1) return message;
    if (message.content.length <= 12000) return message;
    return { ...message, content: truncateMiddleForAIContext(message.content, 12000) };
  });
  notes.push('Trimmed very long historical messages.');
  usage = measureAIContextUsage(messages, limitTokens, true, notes);
  if (usage.usedTokens <= limitTokens) return { messages, usage };

  const userIndex = messages.length - 1;
  const nonUserTokens = measureAIContextUsage(messages.slice(0, userIndex), limitTokens, true, notes).usedTokens;
  const availableForUserChars = Math.max(8000, Math.floor((limitTokens - nonUserTokens - 4096) * 3.2));
  if (messages[userIndex].content.length > availableForUserChars) {
    messages = messages.map((message, index) => index === userIndex
      ? { ...message, content: truncateMiddleForAIContext(message.content, availableForUserChars) }
      : message);
    notes.push('Trimmed oversized file/workspace context while preserving the current user request.');
  }

  usage = measureAIContextUsage(messages, limitTokens, true, notes);
  return { messages, usage };
}

export function estimateAIContextUsageFromMessages(
  messages: Array<{ role: string; content: string }>,
  draftInput = '',
  limitTokens = AI_CONTEXT_TOKEN_LIMIT,
): AIContextUsage {
  const previewMessages = draftInput.trim()
    ? [...messages.map((message) => ({ role: message.role, content: message.content || '' })), { role: 'user', content: draftInput }]
    : messages.map((message) => ({ role: message.role, content: message.content || '' }));
  return measureAIContextUsage(previewMessages, limitTokens);
}

export function buildAIChatRequest(
  userPrompt: string,
  contextInput: AIRequestInput,
  previousMessages?: Array<{ role: string; content: string; toolCalls?: any[] }>,
): AIChatRequestBuildResult {
  const systemContent = enforceArsNoteProductIdentity(`${ARSNOTE_AI_IDENTITY_PROMPT}${BASE_SYSTEM_PROMPT}${PROFESSIONAL_OUTPUT_SYSTEM_PROMPT}${HUMANIZER_SYSTEM_PROMPT}${PRODUCTION_SPEC_TEMPLATE_PROMPT}${GAME_DESIGN_PLANNING_INTELLIGENCE_PROMPT}${GAME_DESIGN_SPECIALIST_SYSTEM_PROMPT}${WIREFRAME_LAYOUT_GUARDRAILS_PROMPT}${CANVAS_PRODUCTION_LAYOUT_PROMPT}${NARRATIVE_PRODUCTION_INTELLIGENCE_PROMPT}${AGENT_SELF_AUDIT_PROMPT}`);
  const contextSection = buildContextSection(contextInput);
  const currentOpenFileSnapshot = buildCurrentOpenFileSnapshot(contextInput);
  const intentHint = buildProfessionalIntentHint(userPrompt);
  const agentRoutingBrief = buildAgentRoutingBrief(userPrompt, contextInput);
  const gameDesignSpecialistBrief = buildGameDesignSpecialistBrief({
    prompt: contextInput.prompt || userPrompt,
    currentFilePath: contextInput.currentFilePath,
  });

  const userContent = [contextSection, currentOpenFileSnapshot, agentRoutingBrief, gameDesignSpecialistBrief, intentHint, userPrompt].filter(Boolean).join('\n\n---\n\n');

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemContent },
  ];

  // Include previous conversation history (skip old system messages)
  if (previousMessages && previousMessages.length > 0) {
    for (const msg of previousMessages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content || '' });
      }
    }
  }

  messages.push({ role: 'user', content: userContent });
  return fitAIContextMessagesToBudget(messages, AI_CONTEXT_TOKEN_LIMIT);
}

/* ── Quick prompt templates ── */

export interface QuickPrompt {
  id: string;
  labelKey: string;
  prompt: string;
  contextMode: AIContextMode;
}

export const QUICK_PROMPTS: QuickPrompt[] = [
  {
    id: 'humanize-current-text',
    labelKey: 'humanizeCurrentText',
    prompt: 'Humanize the selected text if there is one; otherwise humanize the current note. Remove AI-sounding patterns, filler, generic conclusions, and press-release wording. Preserve facts, Markdown structure, wiki-links, tables, code blocks, frontmatter, task IDs, and production details. If editing the current note, write back to the same .md file only. Do not create canvas, visual summaries, or unrelated files. Respond in Chinese with a short change summary.',
    contextMode: 'currentNote',
  },
  {
    id: 'summarize-note',
    labelKey: 'summarizeCurrentNote',
    prompt: 'Summarize this note in a concise paragraph. Highlight key points.',
    contextMode: 'currentNote',
  },
  {
    id: 'professional-design-review',
    labelKey: 'professionalDesignReview',
    prompt: 'Review the current note as an Ars-note professional game-design studio. Let the specialist router choose one primary discipline and up to two review disciplines. Inspect the current note and the most relevant existing project documents before judging it. Report in Chinese: 1) selected disciplines and why, 2) confirmed facts vs design decisions vs assumptions vs open questions, 3) severity-ranked professional gaps, 4) concrete rule/data/content/Unity/UI/QA corrections, 5) a traceability matrix from design goal to implementation and acceptance, 6) discipline review gates marked Passed, Needs review, or Blocked, and 7) actionable team tasks with discipline, dependency, estimate, linked doc, acceptance, and QA/retest. This is a read-only review: do not create or modify files, Canvas, wireframes, or the team schedule unless the user explicitly asks in a follow-up.',
    contextMode: 'currentNote',
  },
  {
    id: 'generate-character',
    labelKey: 'generateCharacterDraft',
    prompt: 'Generate a character profile draft. IMPORTANT STEPS: 1) First use list_files("03_Characters/") to see existing characters. 2) Use write_file("03_Characters/CharacterName.md", content) to create the file. 3) Then use list_files("03_Characters/") to verify the exact file name. 4) Use the EXACT file name (without .md) in all [[wiki-links]]. Link to related quests, items, and other characters using [[ExactFileName]]. Include: name, role, backstory, personality, abilities. Add tags like #character. Use Markdown.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'generate-quest',
    labelKey: 'generateQuestDraft',
    prompt: 'Generate a quest design draft. IMPORTANT STEPS: 1) First use list_files("06_Quests/") to see existing quests. Also list_files("03_Characters/") and list_files("05_Items/") to find related files. 2) Use write_file("06_Quests/QuestName.md", content) to create the file. 3) Then use list_files("06_Quests/") to verify the exact file name. 4) Use the EXACT file name (without .md) in all [[wiki-links]]. Link to involved characters and reward items using [[ExactFileName]]. Include: quest name, description, objectives, rewards, prerequisites. Add tags like #quest. Use Markdown.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'check-missing-docs',
    labelKey: 'checkMissingDocs',
    prompt: 'Analyze the game workspace. IMPORTANT: 1) Use list_files on each folder (01_GDD/, 02_Worldbuilding/, 03_Characters/, 05_Items/, 06_Quests/, 07_Unity_Tasks/, 99_Devlog/) to check what exists. 2) Identify missing core documents, including a worldbuilding overview/world bible. 3) Create missing documents with proper templates using write_file. 4) After EACH file creation, use list_files to verify the exact file name. 5) Use the EXACT file name (without .md) in all [[wiki-links]] between documents. 6) List what was created with the verified file names.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'suggest-next-tasks',
    labelKey: 'suggestNextTasks',
    prompt: 'Act as a production lead for this Ars-note game workspace and produce the next-action plan from real team evidence, not guesses. IMPORTANT STEPS: 1) Use sync_team_task_docs first to import the latest linked task-document progress into the team schedule. 2) Use read_team_server_status(limit=24), read_team_member_work(limit=32), and read_production_health(limit=32) before recommending work; clearly report if server or member evidence is unavailable. 3) Inspect 01_GDD/, 02_Worldbuilding/, 03_Characters/, 06_Quests/, 07_Unity_Tasks/, and .ars-team/ with list_files/read_file for the most relevant docs. 4) Rank the top 5-8 next actions by production impact, urgency, dependency unblock value, owner capacity, QA/Bug/playtest risk, missing linked docs, and Ars-note wiki-link health. 5) Do not overload members marked danger/warning, blocked, overdue, missing docs, or already carrying high-priority work; split or reassign instead. 6) Create or update write_file("07_Unity_Tasks/NextProductionTasks.md", content) with a table: rank, task, owner/discipline, priority, due suggestion, dependency, linked doc, acceptance criteria, QA/retest criteria, risk, and why now. 7) If the user explicitly asked AI to take over, create, assign, or update tasks, use upsert_team_tasks for the concrete selected tasks; otherwise keep them as recommendations in NextProductionTasks.md. 8) Use generate_team_production_docs to refresh the Ars-note team command center, dashboard, AI handoff, member pages, workpack, timesheet, sprint plan, dependency map, blocker handoff, review queue, link health, and AI memory index. 9) Verify 07_Unity_Tasks/ and .ars-team/ with list_files. Respond in Chinese with sync evidence, server status, member workload evidence, top actions, files written, whether schedule was changed, generated production docs, and risks.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'generate-devlog',
    labelKey: 'generateDevlogDraft',
    prompt: 'Generate a development log entry. IMPORTANT STEPS: 1) Use list_files("99_Devlog/") to check existing devlogs. Also list other folders to find related docs. 2) Use write_file("99_Devlog/Devlog_YYYYMMDD.md", content) with today date. 3) Verify the exact file name with list_files. 4) Use EXACT file names (without .md) in all [[wiki-links]]. Link to related game docs using [[ExactFileName]]. Include: accomplishments, status, blockers, next steps. Add tags.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'generate-world-bible',
    labelKey: 'generateWorldBible',
    prompt: 'Create or improve a World Bible for the project. IMPORTANT STEPS: 1) Use list_files("02_Worldbuilding/") to inspect existing world docs. Also list_files("01_GDD/"), list_files("03_Characters/"), and list_files("06_Quests/") for project constraints. 2) Read relevant files before writing. 3) Use write_file("02_Worldbuilding/WorldBible.md", content) unless an equivalent file already exists; if it exists, update/extend it carefully. 4) Verify the exact filename with list_files("02_Worldbuilding/"). Include: core premise, world rules, geography, cultures/factions, history timeline, resources/economy, religion/myth, technology/magic limits, tone, player-facing discovery, consistency checklist, and open questions. Use exact [[wiki-links]] to related files and tags like #worldbuilding #world-bible. Respond in Chinese.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'narrative-director',
    labelKey: 'narrativeDirector',
    prompt: 'Take over the narrative production flow as a senior narrative director. IMPORTANT STEPS: 1) Use sync_team_task_docs first to pull latest linked task-document progress into the team schedule. 2) Use read_team_server_status(limit=24), then read_team_member_work for any intended owners, then read_production_health to identify server sync warnings, member workload, blocked, overdue, missing-owner, missing-document, due-soon, QA/Bug, playtest-feedback work, and narrative chain gaps. 3) Use draft_narrative_tasks(limit=32, include_qa=true, upsert=false) to convert those narrative gaps into concrete task drafts before you assign work. 4) Use list_files on 01_GDD/, 02_Worldbuilding/, 03_Characters/, 06_Quests/, and 07_Unity_Tasks/. Read the most relevant files. 5) Use read_team_schedule if you need full active-task detail or local member workload before assigning work. 6) Build a production chain from world rules -> story beats -> quest beats -> dialogue needs -> performance/cutscene needs -> implementation task table -> QA/retest needs. 7) Create or update write_file("02_Worldbuilding/NarrativePipeline.md", content) with canon map, plot structure, quest mapping, dialogue plan, performance plan, QA/playtest impact, dependencies, risks, and open questions. 8) Create or update write_file("07_Unity_Tasks/NarrativeTaskTable.md", content) with a concrete task table: id, deliverable, owner/discipline, priority, dependency, doc link, implementation notes, acceptance criteria, QA/retest criteria, and status. 9) Use upsert_team_tasks with the reviewed draft_narrative_tasks output and any additional concrete tasks, or use draft_narrative_tasks(upsert=true) only when the user explicitly wants AI to add the drafted tasks directly. 10) Use generate_team_production_docs to refresh .ars-team/ai-handoff.md, .ars-team/ai-memory-index.md, .ars-team/link-health.md, .ars-team/obsidian-command-center.md, .ars-team/narrative-director.md, .ars-team/dependency-map.md, .ars-team/handoffs/blocker-handoff-YYYYMMDD.md, .ars-team/reviews/review-queue-YYYYMMDD.md, .ars-team/workpacks/daily-workpack-YYYYMMDD.md, .ars-team/timesheets/timesheet-YYYYMMDD.md, .ars-team/roadmaps/milestone-roadmap-YYYYMMDD.md, .ars-team/decisions/decision-log-YYYYMMDD.md, .ars-team/changes/change-impact-YYYYMMDD.md, .ars-team/sprints/sprint-plan-YYYYMMDD.md, .ars-team/members/*.md, and .ars-team/team-dashboard.md. 11) Read or open .ars-team/obsidian-command-center.md and .ars-team/narrative-director.md as the final control pages for the next production pass. 12) Verify both folders with list_files and use exact [[wiki-links]]. Respond in Chinese with the task-doc sync result, server sync status, member workload evidence, draft count, paths, imported/updated task count, production-health risks including QA/Bug/playtest items, generated production-doc paths, and next actions.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'generate-plot-outline',
    labelKey: 'generatePlotOutline',
    prompt: 'Create or improve the project plot outline. IMPORTANT STEPS: 1) Inspect 01_GDD/, 02_Worldbuilding/, 03_Characters/, and 06_Quests/ with list_files/read_file. 2) Use write_file("02_Worldbuilding/PlotOutline.md", content) unless an equivalent plot document exists; if it exists, extend it carefully. 3) Include premise, act/chapter structure, turning points, emotional curve, reveals, foreshadowing, branching/failure states, related quests, required dialogue/performance assets, and open questions. 4) Verify with list_files("02_Worldbuilding/") and use exact [[wiki-links]]. Respond in Chinese.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'generate-story-arc',
    labelKey: 'generateStoryArc',
    prompt: 'Generate a story arc / chapter outline. IMPORTANT STEPS: 1) Use list_files("02_Worldbuilding/") to see existing world docs. Also list_files("03_Characters/") and list_files("06_Quests/") to find related files. 2) Use write_file("02_Worldbuilding/StoryArcName.md", content) to create the file using the story arc template. 3) Verify with list_files. 4) Use EXACT file names in [[wiki-links]]. Include: 3-act structure with plot beats, key characters, emotional arc, foreshadowing, and branches. Link to related characters, locations, and quests. Add #story-arc tag.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'generate-dialogue',
    labelKey: 'generateDialogue',
    prompt: 'Generate a dialogue script between characters. IMPORTANT STEPS: 1) Use list_files("03_Characters/") to find character profiles and dialogue profiles. Read relevant ones with read_file(). 2) Use write_file("02_Worldbuilding/DialogueName.md", content) to create the script. 3) Verify with list_files. 4) Use EXACT file names in [[wiki-links]]. Write natural dialogue with stage directions in [brackets], emotions in *asterisks*, and player choice branches. Stay true to each character\'s voice and personality. Add #dialogue tag.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'generate-performance-sheet',
    labelKey: 'generatePerformanceSheet',
    prompt: 'Create a performance/cutscene sheet for a key story or quest scene. IMPORTANT STEPS: 1) Inspect 02_Worldbuilding/, 03_Characters/, and 06_Quests/ with list_files/read_file. 2) Use write_file("02_Worldbuilding/PerformanceSheetName.md", content) with a production-ready sheet. 3) Include beat number, trigger, camera/blocking, character animation, expression, VFX, SFX/BGM, UI prompt, dialogue cue, skip/interrupt behavior, dependencies, and acceptance criteria. 4) Verify with list_files("02_Worldbuilding/") and use exact [[wiki-links]]. Respond in Chinese.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'generate-task-table',
    labelKey: 'generateTaskTable',
    prompt: 'Create a narrative implementation task table. IMPORTANT STEPS: 1) Use sync_team_task_docs first to pull latest linked task-document progress into the team schedule. 2) Use read_team_server_status(limit=24), then read_team_member_work for intended owners, then read_production_health to avoid ignoring server sync warnings, member workload, blocked, overdue, missing-document, QA/Bug, playtest-feedback production work, or narrative chain gaps. 3) Use draft_narrative_tasks(limit=40, include_qa=true, upsert=false) to get structured task drafts from narrative gaps. 4) Inspect 01_GDD/, 02_Worldbuilding/, 03_Characters/, 06_Quests/, and 07_Unity_Tasks/. 5) Use read_team_schedule if you need full active-task detail before adding tasks. 6) Use write_file("07_Unity_Tasks/NarrativeTaskTable.md", content). 7) The table must include id, category, deliverable, owner/discipline, priority, dependencies, linked docs, implementation notes, test/acceptance criteria, QA/retest criteria, and status. 8) Map story/quest/dialogue/performance needs and unresolved QA/playtest feedback to concrete Unity or narrative tasks. 9) Use upsert_team_tasks to add/update those concrete tasks into the team schedule. 10) Use generate_team_production_docs to refresh .ars-team/ai-handoff.md, .ars-team/ai-memory-index.md, .ars-team/link-health.md, .ars-team/obsidian-command-center.md, .ars-team/narrative-director.md, .ars-team/dependency-map.md, .ars-team/handoffs/blocker-handoff-YYYYMMDD.md, .ars-team/reviews/review-queue-YYYYMMDD.md, .ars-team/workpacks/daily-workpack-YYYYMMDD.md, .ars-team/timesheets/timesheet-YYYYMMDD.md, .ars-team/roadmaps/milestone-roadmap-YYYYMMDD.md, .ars-team/decisions/decision-log-YYYYMMDD.md, .ars-team/changes/change-impact-YYYYMMDD.md, .ars-team/sprints/sprint-plan-YYYYMMDD.md, .ars-team/members/*.md, and .ars-team/team-dashboard.md. 11) Verify with list_files("07_Unity_Tasks/") and read/open .ars-team/obsidian-command-center.md as the final team entry. 12) Use exact [[wiki-links]]. Respond in Chinese with the task-doc sync result, server sync status, member workload evidence, task table path, draft count, schedule import/update result, production-health risks, generated production-doc paths, and QA follow-up items.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'narrative-consistency-audit',
    labelKey: 'narrativeConsistencyAudit',
    prompt: 'Audit the narrative system like a narrative director who must also keep production moving across the team. IMPORTANT STEPS: 1) Use sync_team_task_docs first, then read_team_server_status(limit=24), read_team_member_work(limit=32), and read_production_health(limit=40) so the audit includes server sync warnings, member capacity, blocked/overdue/missing-doc work, QA/Bug/playtest feedback, and narrative-chain gaps. 2) Use draft_narrative_tasks(limit=40, include_qa=true, upsert=false) to convert missing world/story/quest/dialogue/performance/task-table links into structured task drafts before proposing fixes. 3) Inspect 01_GDD/, 02_Worldbuilding/, 03_Characters/, 06_Quests/, 07_Unity_Tasks/, and .ars-team/ with list_files/read_file. 4) Identify contradictions, missing world rules, weak character motivation, plot holes, unresolved quest dependencies, missing dialogue, missing performance/cutscene sheets, missing implementation tasks, QA/retest gaps, and Obsidian links that do not resolve. 5) Create or update write_file("02_Worldbuilding/NarrativeAudit.md", content) with severity, canon impact, affected docs, exact fix proposal, owner/discipline suggestion, dependency, acceptance criteria, QA/retest criteria, and linked task/document references. 6) Create or update write_file("07_Unity_Tasks/NarrativeAuditFixes.md", content) with the actionable fix queue. 7) If the user explicitly asked AI to take over or create tasks, use upsert_team_tasks with the reviewed narrative task drafts; otherwise leave the queue as recommendations. 8) Use generate_team_production_docs to refresh .ars-team/obsidian-command-center.md, .ars-team/narrative-director.md, .ars-team/ai-handoff.md, .ars-team/link-health.md, .ars-team/dependency-map.md, workpack, timesheet, sprint plan, review queue, blocker handoff, member pages, dashboard, and missing task docs. 9) Verify 02_Worldbuilding/, 07_Unity_Tasks/, and .ars-team/ with list_files and exact [[wiki-links]]. Respond in Chinese with sync evidence, server status, member workload evidence, audit severity summary, draft count, files written, whether schedule was changed, generated production docs, and risks.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'generate-world-map',
    labelKey: 'generateWorldMap',
    prompt: 'Generate a world/region map document. IMPORTANT STEPS: 1) Use list_files("02_Worldbuilding/") to see existing world docs. Also check list_files("03_Characters/") for faction-related characters. 2) Use write_file("02_Worldbuilding/RegionName.md", content) to create the file. 3) Verify with list_files. 4) Use EXACT file names in [[wiki-links]]. Include: terrain, climate, danger levels, key locations, resources, enemies, travel rules, and story relevance for each region. Link to related locations and factions. Add #world-map tag.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'expand-plot',
    labelKey: 'expandPlot',
    prompt: 'Analyze the current note and expand the plot or story details. Read the note carefully, then: 1) Identify existing plot threads, characters, and world elements. 2) Suggest deeper character motivations, hidden connections, foreshadowing opportunities. 3) Propose 3-5 specific plot twists or reveals. 4) Write a more detailed version of key scenes with dialogue suggestions. 5) Identify potential plot holes or inconsistencies. Use the same language as the note.',
    contextMode: 'currentNote',
  },
  {
    id: 'write-character-lines',
    labelKey: 'writeCharacterLines',
    prompt: 'Write dialogue lines for a character based on the current note. IMPORTANT: 1) Read the current note to understand the character. 2) Also use list_files("03_Characters/") and read any related character profiles or dialogue profiles. 3) Generate dialogue lines for different situations: greeting, combat, idle, emotional moments, quest acceptance, quest completion, death/defeat, victory. 4) Stay true to the character\'s established voice, personality, and speech patterns. 5) Include both the character\'s lines AND their emotional context. Write in the same language as the note.',
    contextMode: 'currentNote',
  },
  {
    id: 'create-wireframe',
    labelKey: 'createWireframe',
    prompt: 'Create a UI wireframe prototype for a game interface. Use the create_wireframe tool to generate an .excalidraw wireframe file. Steps: 1) Use list_files("wireframes/") to check existing wireframes (create the folder with create_folder if needed). 2) Design the UI layout with proper elements: containers for panels, buttons, inputs, text labels, navigation bars, images. Use realistic sizes: nav bar 48px high, buttons 120×40px, inputs 200-300px wide, cards 300px wide. Position elements with proper spacing (16-24px padding). 3) Use create_wireframe("wireframes/ScreenName.excalidraw", elements_json) to create the file. 4) Tell the user they can open the .excalidraw file to view and edit the wireframe. Write the prompt description in Chinese.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'create-canvas',
    labelKey: 'createCanvas',
    prompt: 'Create a visual canvas board (mind map / flowchart / story board). Use the create_canvas tool to generate a .canvas file. Steps: 1) Use list_files to discover existing game documents. 2) Design the canvas layout with text cards for ideas, file cards to link to existing docs, and edges to show connections. Layout: left-to-right flow (x increments ~320), top-to-bottom branches (y increments ~200). Use colors: "6"(purple) for main ideas, "4"(green) for characters, "5"(blue) for locations, "2"(orange) for quests. 3) Use create_canvas("01_GDD/BoardName.canvas", nodes_json, edges_json) to create the file. 4) Tell the user they can open the .canvas file to view and edit the canvas. Respond in Chinese.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'create-dev-pipeline',
    labelKey: 'createDevPipeline',
    prompt: 'Create a development pipeline / workflow canvas. Use the create_canvas tool. First list_files to check existing docs. Then create a .canvas file with a left-to-right flow showing development stages: 需求分析 → 设计 → 美术 → 程序 → 测试 → 上线. Each stage is a text card with bullet points of tasks. Use file cards to link to related GDD/character/quest documents. Use colors: "6" for planning stages, "2" for art, "5" for programming, "4" for testing. Respond in Chinese.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'create-art-checklist',
    labelKey: 'createArtChecklist',
    prompt: 'Create an art asset checklist / tracking canvas. Use the create_canvas tool. First list_files("03_Characters/","02_Worldbuilding/") to see what exists. Create a .canvas with categorized cards: 角色(Characters), 场景(Environments), UI, 道具(Items), 特效(VFX), 音效(Audio). Each card lists needed assets with status. Use colors: "1" for high priority, "2" for in-progress, "4" for done, "3" for pending. Use file cards to link to existing character/item docs. Respond in Chinese.',
    contextMode: 'gameWorkspace',
  },
];

QUICK_PROMPTS.push(
  {
    id: 'write-game-design-spec',
    labelKey: 'writeGameDesignSpec',
    prompt: 'Write or update a production-ready game design spec. First inspect the current note plus relevant 01_GDD/, 02_Worldbuilding/, 03_Characters/, 04_Maps/, 05_Items/, 06_Quests/, and 07_Unity_Tasks/ docs. Do not create Canvas, Excalidraw, workspace summaries, or companion .visual.md files unless explicitly requested. Produce a Markdown spec with: source references inspected, one-sentence design intent, player fantasy, goals/non-goals, core loop, mechanic rules, progression/economy, balance knobs, data/config schema, UI/feedback/VFX/SFX, art/content pipeline, technical handoff, edge cases, QA/telemetry, acceptance criteria, risks, open questions, and next tasks. Save it as 01_GDD/GameDesignSpec.md unless a more specific existing design doc should be updated; verify the exact file name. Respond in Chinese with the path and the most important design decisions.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'design-system-breakdown',
    labelKey: 'designSystemBreakdown',
    prompt: 'Turn the current idea, note, or referenced feature into a system-design breakdown for implementation. First inspect the current note and relevant GDD/Unity task files. Do not create Canvas, Excalidraw, workspace summaries, or companion .visual.md files unless explicitly requested. Write Markdown covering: feature purpose, player-facing loop, state machine, triggers, rules, data fields, formulas/default values, progression/economy impact, UI states, feedback, dependencies, failure cases, QA cases, telemetry, Unity implementation tasks, and acceptance criteria. Save it as 01_GDD/SystemDesign.md or update the most appropriate existing system design doc, then verify the exact file name. Respond in Chinese with the path and task handoff summary.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'create-tech-spec-canvas',
    labelKey: 'createTechSpecCanvas',
    prompt: 'Create a professional technical requirement canvas. Use create_canvas. First inspect the GDD, UI prototype/wireframe files, Unity tasks, and devlogs. Build grouped lanes for Architecture, Data Model, Runtime Systems, Editor/Tools, Sync/Storage, Risks, and Test Plan. Each card must be readable without scrolling and include implementation detail, owner/priority, dependencies, and acceptance criteria. Use connected edges to show dependency flow. Respond in Chinese with the exact path and engineering next steps.',
    contextMode: 'gameWorkspace',
  },
  {
    id: 'write-production-spec',
    labelKey: 'writeProductionSpec',
    prompt: 'Write a professional production-ready Markdown requirement document. First inspect the current note, relevant GDD files, UI prototypes, Canvas boards, and game workspace docs. Do not create a Canvas unless explicitly requested. Produce sections: Purpose, User/Player Goal, Scope, Screen/Feature Breakdown, Art Requirements, Technical Requirements, Data Fields, Interaction States, Acceptance Criteria, Risks, Open Questions, and Next Actions. Save it with write_file in an appropriate project folder and verify the exact file name. Respond in Chinese with the exact path.',
    contextMode: 'gameWorkspace',
  },
);

const PROFESSIONAL_QUICK_PROMPT_OVERRIDES: Record<string, string> = {
  'write-game-design-spec': 'Write or update a production-ready game design spec. First inspect the current note plus relevant 01_GDD/, 02_Worldbuilding/, 03_Characters/, 04_Maps/, 05_Items/, 06_Quests/, and 07_Unity_Tasks/ docs. Do not create Canvas, Excalidraw, workspace summaries, or companion .visual.md files unless explicitly requested. Produce a Markdown spec with: source references inspected, one-sentence design intent, player fantasy, goals/non-goals, core loop, mechanic rules, progression/economy, balance knobs, data/config schema, UI/feedback/VFX/SFX, art/content pipeline, technical handoff, edge cases, QA/telemetry, acceptance criteria, risks, open questions, and next tasks. Save it as 01_GDD/GameDesignSpec.md unless a more specific existing design doc should be updated; verify the exact file name. Respond in Chinese with the path and the most important design decisions.',
  'design-system-breakdown': 'Turn the current idea, note, or referenced feature into a system-design breakdown for implementation. First inspect the current note and relevant GDD/Unity task files. Do not create Canvas, Excalidraw, workspace summaries, or companion .visual.md files unless explicitly requested. Write Markdown covering: feature purpose, player-facing loop, state machine, triggers, rules, data fields, formulas/default values, progression/economy impact, UI states, feedback, dependencies, failure cases, QA cases, telemetry, Unity implementation tasks, and acceptance criteria. Save it as 01_GDD/SystemDesign.md or update the most appropriate existing system design doc, then verify the exact file name. Respond in Chinese with the path and task handoff summary.',
  'create-wireframe': 'Create a professional game UI wireframe prototype. First inspect existing wireframes with list_files("wireframes/") and read any relevant UI/GDD files. Use create_wireframe to create an .excalidraw file with 1-3 focused screens. Use a realistic frame size (desktop 1366x768 or mobile 390x844), clear navigation, main content hierarchy, primary/secondary actions, empty/error/selected states, and consistent spacing (24px page padding, 16px panel padding, 8-12px gaps). Do not cram requirements text into the prototype; every label must fit inside its box, so keep labels short and commercial. After creation, summarize the screen purpose, interaction flow, and exact file path in Chinese.',
  'create-canvas': 'Create a professional visual planning canvas. First inspect the vault with list_files/read_file for relevant docs. Use create_canvas to build a structured .canvas with a title card, legend/status card, 3-6 groups or lanes, and 8-18 substantial cards connected by clear edges. For flowcharts, include start/end, decisions, dependencies, and acceptance checkpoints. Use aligned coordinates, 60-100px spacing, and consistent card sizes. Do not rely on card scrolling; keep each card to 4-6 bullets and split dense sections into multiple connected cards. Use file cards only for real existing files. Respond in Chinese with the exact path and a short explanation of the board structure.',
  'create-dev-pipeline': 'Create a professional development workflow canvas. Use create_canvas. First inspect 01_GDD/, 07_Unity_Tasks/, 99_Devlog/, and related design docs. Build a left-to-right pipeline: Discovery -> Design Spec -> Art/UX -> Engineering -> Integration -> QA -> Release. Each stage should include owner, key deliverables, entry/exit criteria, risks, and linked existing files where available, but split dense details into separate connected cards instead of making scrollable cards. Add a legend card and milestone cards. Use clear edges to show dependencies. Respond in Chinese with the exact path and next actions.',
  'create-art-checklist': 'Create a professional art requirement and asset tracking canvas. Use create_canvas. First inspect 03_Characters/, 02_Worldbuilding/, 05_Items/, and any UI prototype/wireframe files. Build grouped lanes for Art Direction, Characters, Islands/Environment, UI/HUD, VFX/Animation, Props, Audio, and Acceptance Criteria. Each card should be readable without scrolling: deliverable, priority, target format, state/animation needs, dependency, acceptance notes. Split large categories into multiple cards. Use file cards only for real existing docs. Respond in Chinese with the exact path and production notes.',
  'create-tech-spec-canvas': 'Create a professional technical requirement canvas. Use create_canvas. First inspect the GDD, UI prototype/wireframe files, Unity tasks, and devlogs. Build grouped lanes for Architecture, Data Model, Runtime Systems, Editor/Tools, Sync/Storage, Risks, and Test Plan. Each card must be readable without scrolling and include implementation detail, owner/priority, dependencies, and acceptance criteria. Use connected edges to show dependency flow. Respond in Chinese with the exact path and engineering next steps.',
  'write-production-spec': 'Write a professional production-ready Markdown requirement document. First inspect the current note, relevant GDD files, UI prototypes, Canvas boards, and game workspace docs. Do not create a Canvas unless explicitly requested. Produce sections: Purpose, User/Player Goal, Scope, Screen/Feature Breakdown, Art Requirements, Technical Requirements, Data Fields, Interaction States, Acceptance Criteria, Risks, Open Questions, and Next Actions. Save it with write_file in an appropriate project folder and verify the exact file name. Respond in Chinese with the exact path.',
};

for (const prompt of QUICK_PROMPTS) {
  const override = PROFESSIONAL_QUICK_PROMPT_OVERRIDES[prompt.id];
  if (override) prompt.prompt = override;
  prompt.prompt = enforceArsNoteProductIdentity(prompt.prompt);
}
