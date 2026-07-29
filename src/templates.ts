import type { TemplateDef, TemplateCategory } from './types';
import type { Language, Translations } from './i18n';

const V = '1.3.0';
const foot = `---\n*Created with Ars-note v${V}*`;
const footZh = `---\n*由 Ars-note v${V} 创建*`;

/* ── Categories ── */
export const CATEGORIES: { id: string; nameEn: string; nameZh: string; folder: string }[] = [
  { id: 'game-design', nameEn: 'Game Design', nameZh: '游戏设计', folder: '01_GDD' },
  { id: 'worldbuilding', nameEn: 'Worldbuilding', nameZh: '世界观', folder: '02_Worldbuilding' },
  { id: 'characters', nameEn: 'Characters', nameZh: '角色', folder: '03_Characters' },
  { id: 'items', nameEn: 'Items', nameZh: '道具', folder: '05_Items' },
  { id: 'quests', nameEn: 'Quests', nameZh: '任务', folder: '06_Quests' },
  { id: 'unity', nameEn: 'Unity', nameZh: 'Unity', folder: '07_Unity_Tasks' },
  { id: 'devlog', nameEn: 'Devlog', nameZh: '开发日志', folder: '08_Devlog' },
];

/* ── Template definitions ── */
interface TmplDef {
  id: string; category: string; folder: string; defaultFileName: string;
  nameEn: string; nameZh: string; descEn: string; descZh: string;
  contentEn: string; contentZh: string;
}

const T: TmplDef[] = [

/* ══════════ Game Design ══════════ */

{ id:'gdd', category:'game-design', folder:'01_GDD', defaultFileName:'NewGDD.md',
  nameEn:'GDD', nameZh:'GDD 模板',
  descEn:'Full Game Design Document', descZh:'完整游戏设计文档',
  contentEn:`# Game Design Document: {TITLE}

## 1. Overview
- **Game Title**:
- **Genre**:
- **Platform**:
- **Target Audience**:
- **Estimated Release Date**:

## 2. Core Concept
### Elevator Pitch
> Describe your game in one or two sentences.

### Core Gameplay Loop
1. ...
2. ...
3. ...

## 3. Game Mechanics
### Player Actions
-
### Progression System
-
### Economy / Resources
-

## 4. Story & Narrative
### Premise
-
### Main Characters
-
### World Setting
-

## 5. Art Style
- **Visual Style**:
- **Color Palette**:
- **Reference Images**:

## 6. Audio
- **Music Style**:
- **Key SFX**:

## 7. Technical Notes
- **Engine**: Unity
- **Target Resolution**:
- **Performance Budget**:

## 8. Monetization
-

## 9. Milestones
| Phase | Date | Deliverable |
|-------|------|-------------|
| Prototype | | |
| Alpha | | |
| Beta | | |
| Release | | |

${foot}`,
  contentZh:`# 游戏设计文档: {TITLE}

## 1. 概览
- **游戏名称**：
- **类型**：
- **平台**：
- **目标受众**：
- **预计发布日期**：

## 2. 核心概念
### 一句话介绍
> 用一两句话描述你的游戏。

### 核心玩法循环
1. ...
2. ...
3. ...

## 3. 游戏机制
### 玩家操作
-
### 进阶系统
-
### 经济 / 资源
-

## 4. 故事与叙事
### 前提
-
### 主要角色
-
### 世界设定
-

## 5. 美术风格
- **视觉风格**：
- **配色方案**：
- **参考图**：

## 6. 音频
- **音乐风格**：
- **关键音效**：

## 7. 技术说明
- **引擎**：Unity
- **目标分辨率**：
- **性能预算**：

## 8. 商业化
-

## 9. 里程碑
| 阶段 | 日期 | 交付物 |
|------|------|--------|
| 原型 | | |
| Alpha | | |
| Beta | | |
| 正式发布 | | |

${footZh}` },

{ id:'game-concept', category:'game-design', folder:'01_GDD', defaultFileName:'GameConcept.md',
  nameEn:'Game Concept', nameZh:'游戏概念',
  descEn:'Short game concept pitch', descZh:'游戏概念提案',
  contentEn:`# Game Concept: {TITLE}

## Elevator Pitch
> One or two sentences describing the game.

## Genre & Platform
- **Genre**:
- **Platform**:

## Core Hook
What makes this game unique?

## Target Audience
-

## Unique Selling Points
1.
2.
3.

## Inspirations
-

## Risk Assessment
| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| | | |

${foot}`,
  contentZh:`# 游戏概念: {TITLE}

## 一句话介绍
> 用一两句话描述这个游戏。

## 类型与平台
- **类型**：
- **平台**：

## 核心卖点
这个游戏独特之处是什么？

## 目标受众
-

## 独特优势
1.
2.
3.

## 灵感来源
-

## 风险评估
| 风险 | 可能性 | 应对措施 |
|------|--------|----------|
| | | |

${footZh}` },

{ id:'core-gameplay-loop', category:'game-design', folder:'01_GDD', defaultFileName:'GameplayLoop.md',
  nameEn:'Core Gameplay Loop', nameZh:'核心玩法循环',
  descEn:'Production-ready multi-horizon gameplay loop design', descZh:'可验证、可落地的多层核心循环设计',
  contentEn:`# Core Gameplay Loop: {TITLE}

> Owner: Lead / System Design
> Cross-review: Economy + UX
> Status: Draft / Review / Approved

## 1. Experience Contract

- **Player promise**: What can the player repeatedly become, master, create, discover, or express?
- **Target emotion**: What should one successful loop feel like?
- **Play context**: Platform, input, expected session length, solo/co-op, online/offline.
- **Core verbs**: 3-7 verbs that carry most play.
- **Meaningful decisions**: What trade-offs prevent the loop from becoming automatic?
- **Non-goals**: Experiences this loop is not trying to provide.

### Evidence and Decisions

| Kind | Statement | Source / Owner | Status |
| --- | --- | --- | --- |
| Confirmed fact |  | [[GDD]] | Confirmed |
| Design decision |  | System Design | Proposed |
| Assumption |  | Playtest needed | Unverified |
| Open question |  | Owner needed | Blocked |

## 2. Loop Thesis

> Because the player wants **[goal/fantasy]**, they repeatedly **[core verbs]** to gain **[feedback/reward]**, then spend or transform it to make **[new decision/unlock]**, which changes the next round by **[new mastery/expression/stakes]**.

### Canonical Flow

\`\`\`
Need / Goal
  → Observe and choose
  → Commit an action
  → System resolves rules and risk
  → Immediate readable feedback
  → Reward, cost, or consequence
  → Spend, transform, equip, or unlock
  → New option, harder goal, or expressive choice
  ↺ Re-enter with a changed decision
\`\`\`

## 3. Connected Loop Horizons

| Horizon | Expected cadence | Player goal | Entry | Main actions | Output | How it feeds the next horizon |
| --- | --- | --- | --- | --- | --- | --- |
| Moment-to-moment | 5-30 seconds |  |  |  |  |  |
| Encounter / task | 2-10 minutes |  |  |  |  |  |
| Session | 15-60 minutes |  |  |  |  |  |
| Meta / progression | Day / week |  |  |  |  |  |
| Long-term mastery | Weeks / months |  |  |  |  |  |

> Replace cadence ranges with project evidence. Each row must consume an output or motivation from the row above and return a new decision to it.

## 4. Step Contract

| # | Player intent | Input / action | Rule and state change | Feedback | Reward / cost | Meaningful decision | Failure / recovery | Re-entry condition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 |  |  |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |  |  |

### Loop Integrity Checks

- [ ] Every action changes state and produces readable feedback.
- [ ] Every reward enables a new decision, mastery opportunity, expression, or stake.
- [ ] No step is a dead end; interruption, failure, and completion all define re-entry.
- [ ] Progression strengthens or transforms the core verbs instead of bypassing them.
- [ ] Repetition changes decisions, not only numeric scale.

## 5. Resource and Progression Topology

| Resource / state | Source | Transformation | Storage / cap | Sink / cost | Gate / unlock | Reset / decay | Exploit pressure |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |

| Phase | New verb / option | New decision | New risk | Content need | Why the loop feels different |
| --- | --- | --- | --- | --- | --- |
| Onboarding |  |  |  |  |  |
| Early game |  |  |  |  |  |
| Mid game |  |  |  |  |  |
| Late game |  |  |  |  |  |

## 6. Failure, Recovery, and Return

| Situation | Trigger | Consequence | Preserved progress | Recovery path | Retry cost | Anti-frustration rule |
| --- | --- | --- | --- | --- | --- | --- |
| Failure |  |  |  |  |  |  |
| Interruption / quit |  |  |  |  |  |  |
| Resource shortage |  |  |  |  |  |  |
| Invalid / exploit state |  |  |  |  |  |  |

## 7. Feedback and UX

| Loop beat | Visual / animation | SFX / music | UI information | Timing | Accessibility / fallback |
| --- | --- | --- | --- | --- | --- |
| Choice |  |  |  |  |  |
| Commitment |  |  |  |  |  |
| Resolution |  |  |  |  |  |
| Reward / consequence |  |  |  |  |  |
| Re-entry |  |  |  |  |  |

## 8. Dependencies and Content Burden

| Dependency | What the loop needs | Owner | Minimum viable version | Scale cost / risk |
| --- | --- | --- | --- | --- |
| System / data |  |  |  |  |
| Economy / balance |  |  |  |  |
| Level / quest / content |  |  |  |  |
| UI / art / audio |  |  |  |  |
| Engineering / save |  |  |  |  |
| QA / analytics |  |  |  |  |

## 9. Prototype and Measurement

### Smallest Playable Loop

- **Prototype boundary**:
- **Required assets**:
- **Test duration and participants**:
- **What observers record**:
- **Pass condition**:
- **Stop / redesign condition**:

| Hypothesis | Event / observation | Interpretation | Design decision triggered |
| --- | --- | --- | --- |
| Players understand the next goal |  |  |  |
| Choices produce visible trade-offs |  |  |  |
| Rewards create a reason to re-enter |  |  |  |
| Failure teaches without erasing motivation |  |  |  |

> Do not invent target metrics. Add numeric thresholds only after a benchmark, prototype, or product decision exists.

## 10. Traceability

| Design goal | Loop rule | Data / config | UI / feedback | Implementation owner | Acceptance / telemetry |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

## 11. Review Gates

| Gate | Status | Evidence / unresolved issue |
| --- | --- | --- |
| Player promise and core verbs | Needs review |  |
| Cross-horizon re-entry | Needs review |  |
| Economy and anti-exploit | Needs review |  |
| UX feedback and accessibility | Needs review |  |
| Failure, interruption, and save recovery | Needs review |  |
| Prototype and measurement plan | Needs review |  |

Use only **Passed**, **Needs review**, or **Blocked**. Do not use invented quality scores.

${foot}`,
  contentZh:`# 核心玩法循环: {TITLE}

> 主责：主策划 / 系统策划
> 交叉评审：数值策划 + UI/UX 策划
> 状态：草稿 / 评审 / 已通过

## 1. 体验契约

- **玩家承诺**：玩家能反复成为什么、掌握什么、创造什么、发现什么或表达什么？
- **目标情绪**：完成一轮后，玩家应该获得什么感受？
- **游玩场景**：平台、输入方式、预计单次时长、单人/多人、在线/离线。
- **核心动词**：承担主要游玩内容的 3-7 个动词。
- **关键选择**：哪些取舍让循环不会退化为机械点击？
- **非目标**：本循环明确不提供哪些体验？

### 事实与决策

| 类型 | 内容 | 依据 / 负责人 | 状态 |
| --- | --- | --- | --- |
| 已确认事实 |  | [[GDD]] | 已确认 |
| 设计决策 |  | 系统策划 | 待评审 |
| 假设 |  | 需要试玩验证 | 未验证 |
| 开放问题 |  | 待指定负责人 | 阻塞 |

## 2. 循环命题

> 因为玩家想要 **[目标/幻想]**，所以会反复使用 **[核心动词]** 获得 **[反馈/奖励]**，再将其消耗或转化为 **[新选择/解锁]**，使下一轮产生 **[新的熟练度、表达空间或风险]**。

### 标准流程

\`\`\`
需求 / 目标
  → 观察并选择
  → 承诺一次行动
  → 系统结算规则与风险
  → 立即且清晰的反馈
  → 获得奖励、成本或后果
  → 消耗、转化、装备或解锁
  → 出现新选项、更高目标或表达选择
  ↺ 带着变化后的决策重新进入
\`\`\`

## 3. 多层循环关系

| 层级 | 参考节奏 | 玩家目标 | 入口 | 主要行动 | 产出 | 如何进入下一层 |
| --- | --- | --- | --- | --- | --- | --- |
| 秒级操作循环 | 5-30 秒 |  |  |  |  |  |
| 遭遇 / 任务循环 | 2-10 分钟 |  |  |  |  |  |
| 单次会话循环 | 15-60 分钟 |  |  |  |  |  |
| 局外 / 成长循环 | 天 / 周 |  |  |  |  |  |
| 长期掌握循环 | 周 / 月 |  |  |  |  |  |

> 节奏区间必须按项目证据调整。每一层都要承接上一层的产出或动机，并向上一层返回一个新的决策。

## 4. 单步契约

| # | 玩家意图 | 输入 / 行动 | 规则与状态变化 | 反馈 | 奖励 / 成本 | 关键选择 | 失败 / 恢复 | 重入条件 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 |  |  |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |  |  |

### 闭环检查

- [ ] 每个行动都会改变状态并产生可读反馈。
- [ ] 每个奖励都会开启新的决策、熟练度、表达空间或风险。
- [ ] 没有死路；中断、失败和完成都定义了重入方式。
- [ ] 成长会强化或改变核心动词，而不是绕过核心玩法。
- [ ] 重复带来决策变化，而不只是数字变大。

## 5. 资源与成长拓扑

| 资源 / 状态 | 来源 | 转化 | 储存 / 上限 | 消耗 | 门槛 / 解锁 | 重置 / 衰减 | 套利风险 |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |

| 阶段 | 新动词 / 新选项 | 新决策 | 新风险 | 内容需求 | 循环为何产生变化 |
| --- | --- | --- | --- | --- | --- |
| 新手期 |  |  |  |  |  |
| 前期 |  |  |  |  |  |
| 中期 |  |  |  |  |  |
| 后期 |  |  |  |  |  |

## 6. 失败、恢复与返回

| 情况 | 触发条件 | 后果 | 保留进度 | 恢复路径 | 重试成本 | 防挫败规则 |
| --- | --- | --- | --- | --- | --- | --- |
| 失败 |  |  |  |  |  |  |
| 中断 / 退出 |  |  |  |  |  |  |
| 资源不足 |  |  |  |  |  |  |
| 非法 / 套利状态 |  |  |  |  |  |  |

## 7. 反馈与 UX

| 循环节拍 | 视觉 / 动画 | 音效 / 音乐 | UI 信息 | 时机 | 无障碍 / 降级方案 |
| --- | --- | --- | --- | --- | --- |
| 选择 |  |  |  |  |  |
| 承诺行动 |  |  |  |  |  |
| 规则结算 |  |  |  |  |  |
| 奖励 / 后果 |  |  |  |  |  |
| 重新进入 |  |  |  |  |  |

## 8. 依赖与内容成本

| 依赖 | 循环需要什么 | 负责人 | 最小可用版本 | 扩量成本 / 风险 |
| --- | --- | --- | --- | --- |
| 系统 / 数据 |  |  |  |  |
| 数值 / 经济 |  |  |  |  |
| 关卡 / 任务 / 内容 |  |  |  |  |
| UI / 美术 / 音频 |  |  |  |  |
| 程序 / 存档 |  |  |  |  |
| QA / 数据分析 |  |  |  |  |

## 9. 原型与验证

### 最小可玩循环

- **原型边界**：
- **必需资产**：
- **测试时长与人数**：
- **观察记录项**：
- **通过条件**：
- **停止 / 重做条件**：

| 假设 | 事件 / 观察项 | 结果解释 | 触发的设计决策 |
| --- | --- | --- | --- |
| 玩家能理解下一个目标 |  |  |  |
| 选择能产生清晰取舍 |  |  |  |
| 奖励能形成再次进入的理由 |  |  |  |
| 失败能教学且不会清空动机 |  |  |  |

> 不要凭空编造目标指标。只有存在基准、原型结果或明确产品决策时，才填写数值阈值。

## 10. 可追溯矩阵

| 设计目标 | 循环规则 | 数据 / 配置 | UI / 反馈 | 实现负责人 | 验收 / 埋点 |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

## 11. 评审门

| 评审项 | 状态 | 证据 / 未解决问题 |
| --- | --- | --- |
| 玩家承诺与核心动词 | 待评审 |  |
| 多层循环重入关系 | 待评审 |  |
| 经济闭环与防套利 | 待评审 |  |
| UX 反馈与无障碍 | 待评审 |  |
| 失败、中断与存档恢复 | 待评审 |  |
| 原型与验证计划 | 待评审 |  |

状态只使用 **已通过**、**待评审** 或 **阻塞**，不要编造“100/100”等质量分。

${footZh}` },

{ id:'mechanic-design', category:'game-design', folder:'01_GDD', defaultFileName:'Mechanic.md',
  nameEn:'Mechanic Design', nameZh:'机制设计',
  descEn:'Individual mechanic specification', descZh:'单个游戏机制规格',
  contentEn:`# Mechanic: {TITLE}

## Overview
-

## Player Input
-

## System Response
-

## Edge Cases
-

## Balancing
| Parameter | Value | Notes |
|-----------|-------|-------|
| | | |

## Dependencies
-

## Prototype Notes
-

${foot}`,
  contentZh:`# 机制设计: {TITLE}

## 概述
-

## 玩家输入
-

## 系统响应
-

## 边界情况
-

## 平衡性
| 参数 | 数值 | 备注 |
|------|------|------|
| | | |

## 依赖关系
-

## 原型笔记
-

${footZh}` },

{ id:'level-design', category:'game-design', folder:'01_GDD', defaultFileName:'LevelDesign.md',
  nameEn:'Level Design', nameZh:'关卡设计',
  descEn:'Level design document', descZh:'关卡设计文档',
  contentEn:`# Level Design: {TITLE}

## Level Overview
- **Theme**:
- **Estimated Play Time**:
- **Difficulty**:

## Player Path
1. Entry point
2. First challenge
3. Mid-point
4. Boss / Climax
5. Exit

## Key Encounters
| Enemy | Count | Location | Difficulty |
|-------|-------|----------|------------|
| | | | |

## Pacing Chart
| Section | Action Level | Emotion |
|---------|-------------|---------|
| | | |

## Secrets & Collectibles
-

## Technical Requirements
- **Scene**:
- **NavMesh**: Yes / No
- **LOD Levels**:

${foot}`,
  contentZh:`# 关卡设计: {TITLE}

## 关卡概览
- **主题**：
- **预计游玩时长**：
- **难度**：

## 玩家路径
1. 入口
2. 第一个挑战
3. 中点
4. Boss / 高潮
5. 出口

## 关键遭遇
| 敌人 | 数量 | 位置 | 难度 |
|------|------|------|------|
| | | | |

## 节奏图
| 阶段 | 行动强度 | 情绪 |
|------|----------|------|
| | | |

## 秘密与收集品
-

## 技术要求
- **场景**：
- **导航网格**：是 / 否
- **LOD 级别**：

${footZh}` },

{ id:'economy-design', category:'game-design', folder:'01_GDD', defaultFileName:'Economy.md',
  nameEn:'Economy Design', nameZh:'经济系统设计',
  descEn:'Game economy and balance doc', descZh:'游戏经济与平衡文档',
  contentEn:`# Economy Design: {TITLE}

## Resources
| Resource | Source | Sink | Notes |
|----------|--------|------|-------|
| | | | |

## Currencies
-

## Income Sources
-

## Sinks
-

## Balance Table
| Item | Cost | Value | Ratio |
|------|------|-------|-------|
| | | | |

## Monetization Impact
-

${foot}`,
  contentZh:`# 经济系统设计: {TITLE}

## 资源
| 资源 | 来源 | 消耗 | 备注 |
|------|------|------|------|
| | | | |

## 货币
-

## 收入来源
-

## 消耗途径
-

## 平衡表
| 物品 | 成本 | 价值 | 比率 |
|------|------|------|------|
| | | | |

## 商业化影响
-

${footZh}` },

{ id:'ui-ux-design', category:'game-design', folder:'01_GDD', defaultFileName:'UIUX.md',
  nameEn:'UI/UX Design', nameZh:'UI/UX 设计',
  descEn:'UI/UX design document', descZh:'界面与用户体验设计',
  contentEn:`# UI/UX Design: {TITLE}

## Screen Overview
| Screen | Purpose | Key Elements |
|--------|---------|-------------|
| | | |

## Wireframes
*(Describe or link wireframes)*

## Interaction Flow
1.
2.
3.

## Navigation Map
-

## Accessibility
-

## Technical Notes
-

${foot}`,
  contentZh:`# UI/UX 设计: {TITLE}

## 界面概览
| 界面 | 用途 | 关键元素 |
|------|------|----------|
| | | |

## 线框图
*（描述或链接线框图）*

## 交互流程
1.
2.
3.

## 导航结构
-

## 无障碍设计
-

## 技术说明
-

${footZh}` },

/* ══════════ Worldbuilding ══════════ */

{ id:'worldbuilding', category:'worldbuilding', folder:'02_Worldbuilding', defaultFileName:'NewLocation.md',
  nameEn:'World Overview', nameZh:'世界观概览',
  descEn:'World / location design template', descZh:'世界 / 地点设计模板',
  contentEn:`# Location: {TITLE}

## Overview
- **Type**:
- **Region**:
- **Climate**:
- **Population**:

## Description
### Visual Description
-
### Atmosphere & Mood
-

## Map & Layout
### Key Areas
1.
2.
3.

### Points of Interest
| Location | Description | Significance |
|----------|-------------|-------------|
| | | |

## History
-

## Factions & Politics
| Faction | Alignment | Goals |
|---------|-----------|-------|
| | | |

## Economy
- **Primary Resources**:
- **Trade**:
- **Currency**:

## Encounters
| Enemy / Event | Location | Difficulty |
|---------------|----------|------------|
| | | |

## Quests Available
- [ ] Quest 1
- [ ] Quest 2

## Technical Notes (Unity)
- **Scene Name**:
- **Lighting Setup**:
- **NavMesh**: Yes / No

${foot}`,
  contentZh:`# 地点: {TITLE}

## 概览
- **类型**：
- **区域**：
- **气候**：
- **人口**：

## 描述
### 视觉描述
-
### 氛围与情绪
-

## 地图与布局
### 关键区域
1.
2.
3.

### 兴趣点
| 地点 | 描述 | 重要性 |
|------|------|--------|
| | | |

## 历史
-

## 派系与政治
| 派系 | 阵营 | 目标 |
|------|------|------|
| | | |

## 经济
- **主要资源**：
- **贸易**：
- **货币**：

## 遭遇战
| 敌人 / 事件 | 地点 | 难度 |
|-------------|------|------|
| | | |

## 可接任务
- [ ] 任务 1
- [ ] 任务 2

## 技术说明 (Unity)
- **场景名称**：
- **光照设置**：
- **导航网格**：是 / 否

${footZh}` },

{ id:'location', category:'worldbuilding', folder:'02_Worldbuilding', defaultFileName:'Location.md',
  nameEn:'Location', nameZh:'地点详情',
  descEn:'Specific location document', descZh:'具体地点文档',
  contentEn:`# Location: {TITLE}

- **Type**:
- **Region**:
- **Climate**:

## Description
-

## Notable Features
-

## Connections
| Direction | Location | Travel Time |
|-----------|----------|-------------|
| | | |

## Events
-

## Technical Notes
-

${foot}`,
  contentZh:`# 地点详情: {TITLE}

- **类型**：
- **区域**：
- **气候**：

## 描述
-

## 显著特征
-

## 连接
| 方向 | 地点 | 旅行时间 |
|------|------|----------|
| | | |

## 事件
-

## 技术说明
-

${footZh}` },

{ id:'race-species', category:'worldbuilding', folder:'02_Worldbuilding', defaultFileName:'Race.md',
  nameEn:'Race / Species', nameZh:'种族 / 物种',
  descEn:'Race or species document', descZh:'种族或物种文档',
  contentEn:`# Race / Species: {TITLE}

## Overview
-

## Physical Traits
-

## Culture
-

## Language
-

## Relations
| Race | Attitude | Notes |
|------|----------|-------|
| | | |

## Abilities
-

## Lore
-

## Playable
- [ ] Yes  [ ] No

${foot}`,
  contentZh:`# 种族 / 物种: {TITLE}

## 概述
-

## 生理特征
-

## 文化
-

## 语言
-

## 种族关系
| 种族 | 态度 | 备注 |
|------|------|------|
| | | |

## 能力
-

## 传说
-

## 可选种族
- [ ] 是  [ ] 否

${footZh}` },

{ id:'faction', category:'worldbuilding', folder:'02_Worldbuilding', defaultFileName:'Faction.md',
  nameEn:'Faction', nameZh:'派系',
  descEn:'Faction or organization document', descZh:'派系或组织文档',
  contentEn:`# Faction: {TITLE}

## Overview
- **Leader**:
- **Territory**:
- **Alignment**:

## Goals
-

## Structure
| Rank | Title | Responsibilities |
|------|-------|------------------|
| | | |

## Relations
| Faction | Relation | Notes |
|---------|----------|-------|
| | | |

## Quests
-

## Rewards
-

${foot}`,
  contentZh:`# 派系: {TITLE}

## 概述
- **首领**：
- **领地**：
- **阵营**：

## 目标
-

## 组织结构
| 等级 | 头衔 | 职责 |
|------|------|------|
| | | |

## 关系
| 派系 | 关系 | 备注 |
|------|------|------|
| | | |

## 任务
-

## 奖励
-

${footZh}` },

{ id:'timeline', category:'worldbuilding', folder:'02_Worldbuilding', defaultFileName:'Timeline.md',
  nameEn:'Timeline', nameZh:'时间线',
  descEn:'Timeline of events', descZh:'事件时间线',
  contentEn:`# Timeline: {TITLE}

## Era Overview
-

## Key Events
| Date | Event | Impact |
|------|-------|--------|
| | | |

## Connected Locations
-

## References
-

${foot}`,
  contentZh:`# 时间线: {TITLE}

## 时代概览
-

## 关键事件
| 日期 | 事件 | 影响 |
|------|------|------|
| | | |

## 相关地点
-

## 参考资料
-

${footZh}` },

{ id:'lore-entry', category:'worldbuilding', folder:'02_Worldbuilding', defaultFileName:'Lore.md',
  nameEn:'Lore Entry', nameZh:'世界观条目',
  descEn:'Individual lore entry', descZh:'单个世界观条目',
  contentEn:`# Lore Entry: {TITLE}

- **Category**:
- **Discovered By**:
- **In-Game Location**:

## Summary
-

## Full Text
-

## Related Entries
-

${foot}`,
  contentZh:`# 世界观条目: {TITLE}

- **分类**：
- **发现者**：
- **游戏内位置**：

## 概要
-

## 全文
-

## 相关条目
-

${footZh}` },

/* ══════════ Characters ══════════ */

{ id:'character', category:'characters', folder:'03_Characters', defaultFileName:'NewCharacter.md',
  nameEn:'Character', nameZh:'角色',
  descEn:'Full character design document', descZh:'完整角色设计文档',
  contentEn:`# Character: {TITLE}

## Basic Info
- **Name**:
- **Role**: (Protagonist / NPC / Enemy / Boss)
- **Age**:
- **Species / Race**:

## Appearance
- **Height**:
- **Build**:
- **Hair**:
- **Eyes**:
- **Distinguishing Features**:
- **Outfit / Armor**:

## Personality
- **Traits**:
- **Motivations**:
- **Fears**:
- **Speech Pattern**:

## Backstory
-

## Stats & Abilities
| Stat | Value | Notes |
|------|-------|-------|
| HP | | |
| ATK | | |
| DEF | | |
| SPD | | |

### Special Abilities
1. **Ability Name**: Description
2. **Ability Name**: Description

## Relationships
| Character | Relationship | Notes |
|-----------|-------------|-------|
| | | |

## AI Behavior (if NPC / Enemy)
- **Aggression Level**:
- **Attack Pattern**:
- **Weakness**:

## Concept Art References
-

${foot}`,
  contentZh:`# 角色: {TITLE}

## 基本信息
- **姓名**：
- **身份**：（主角 / NPC / 敌人 / Boss）
- **年龄**：
- **种族**：

## 外貌
- **身高**：
- **体型**：
- **发型**：
- **瞳色**：
- **显著特征**：
- **服装 / 装备**：

## 性格
- **性格特征**：
- **动机**：
- **恐惧**：
- **说话方式**：

## 背景故事
-

## 属性与能力
| 属性 | 数值 | 备注 |
|------|------|------|
| 生命值 | | |
| 攻击力 | | |
| 防御力 | | |
| 速度 | | |

### 特殊能力
1. **能力名称**：描述
2. **能力名称**：描述

## 人物关系
| 角色 | 关系 | 备注 |
|------|------|------|
| | | |

## AI 行为（NPC / 敌人）
- **攻击性等级**：
- **攻击模式**：
- **弱点**：

## 概念图参考
-

${footZh}` },

{ id:'npc', category:'characters', folder:'03_Characters', defaultFileName:'NewNPC.md',
  nameEn:'NPC', nameZh:'NPC',
  descEn:'Non-player character document', descZh:'NPC 文档',
  contentEn:`# NPC: {TITLE}

- **Role**:
- **Location**:
- **Schedule**:

## Dialogue Personality
-

## Quests Offered
-

## Inventory
| Item | Quantity | Notes |
|------|----------|-------|
| | | |

## Availability
-

${foot}`,
  contentZh:`# NPC: {TITLE}

- **角色**：
- **位置**：
- **时间表**：

## 对话性格
-

## 提供任务
-

## 物品栏
| 物品 | 数量 | 备注 |
|------|------|------|
| | | |

## 出现条件
-

${footZh}` },

{ id:'enemy', category:'characters', folder:'03_Characters', defaultFileName:'NewEnemy.md',
  nameEn:'Enemy', nameZh:'敌人',
  descEn:'Enemy design document', descZh:'敌人设计文档',
  contentEn:`# Enemy: {TITLE}

- **Type**:
- **HP**:
- **XP Reward**:

## Attack Patterns
| Attack | Damage | Cooldown | Range |
|--------|--------|----------|-------|
| | | | |

## Weaknesses
-

## Resistances
-

## Spawn Locations
-

## Drops
| Item | Chance | Notes |
|------|--------|-------|
| | | |

## Scaling
| Level | HP | ATK | DEF |
|-------|----|-----|-----|
| 1 | | | |
| 5 | | | |
| 10 | | | |

${foot}`,
  contentZh:`# 敌人: {TITLE}

- **类型**：
- **生命值**：
- **经验奖励**：

## 攻击模式
| 攻击 | 伤害 | 冷却 | 范围 |
|------|------|------|------|
| | | | |

## 弱点
-

## 抗性
-

## 出现地点
-

## 掉落物
| 物品 | 概率 | 备注 |
|------|------|------|
| | | |

## 缩放
| 等级 | 生命值 | 攻击力 | 防御力 |
|------|--------|--------|--------|
| 1 | | | |
| 5 | | | |
| 10 | | | |

${footZh}` },

{ id:'boss', category:'characters', folder:'03_Characters', defaultFileName:'NewBoss.md',
  nameEn:'Boss', nameZh:'Boss',
  descEn:'Boss design document', descZh:'Boss 设计文档',
  contentEn:`# Boss: {TITLE}

## Phase Overview
| Phase | HP Threshold | Behavior Change |
|-------|-------------|-----------------|
| Phase 1 | 100%-50% | |
| Phase 2 | 50%-25% | |
| Phase 3 | 25%-0% | |

## Attack Table
| Attack | Phase | Damage | Dodge Window |
|--------|-------|--------|-------------|
| | | | |

## Weak Points
-

## Enrage Timer
-

## Loot Table
| Item | Chance | Notes |
|------|--------|-------|
| | | | |

## Arena Description
-

${foot}`,
  contentZh:`# Boss: {TITLE}

## 阶段概览
| 阶段 | 生命值阈值 | 行为变化 |
|------|-----------|----------|
| 阶段 1 | 100%-50% | |
| 阶段 2 | 50%-25% | |
| 阶段 3 | 25%-0% | |

## 攻击表
| 攻击 | 阶段 | 伤害 | 闪避窗口 |
|------|------|------|----------|
| | | | |

## 弱点
-

## 狂暴计时
-

## 掉落表
| 物品 | 概率 | 备注 |
|------|------|------|
| | | | |

## 竞技场描述
-

${footZh}` },

{ id:'companion', category:'characters', folder:'03_Characters', defaultFileName:'NewCompanion.md',
  nameEn:'Companion', nameZh:'同伴',
  descEn:'Companion design document', descZh:'同伴设计文档',
  contentEn:`# Companion: {TITLE}

## Overview
-

## Recruitment
-

## Abilities
| Ability | Unlock Level | Description |
|---------|-------------|-------------|
| | | |

## Affinity System
| Level | Unlock | Perk |
|-------|--------|------|
| 1 | | |
| 2 | | |
| 3 | | |

## Dialogue Style
-

## Combat Role
-

## Upgrade Path
-

${foot}`,
  contentZh:`# 同伴: {TITLE}

## 概述
-

## 招募方式
-

## 能力
| 能力 | 解锁等级 | 描述 |
|------|----------|------|
| | | |

## 好感系统
| 等级 | 解锁 | 奖励 |
|------|------|------|
| 1 | | |
| 2 | | |
| 3 | | |

## 对话风格
-

## 战斗角色
-

## 升级路线
-

${footZh}` },

{ id:'dialogue-profile', category:'characters', folder:'03_Characters', defaultFileName:'DialogueProfile.md',
  nameEn:'Dialogue Profile', nameZh:'对话设定',
  descEn:'Dialogue characterization document', descZh:'对话人设文档',
  contentEn:`# Dialogue Profile: {TITLE}

## Voice Description
-

## Sample Lines
### Greeting
> "..."

### Combat
> "..."

### Idle
> "..."

### Quest
> "..."

## Taboo Topics
-

## Relationships
| Character | Tone | Notes |
|-----------|------|-------|
| | | |

${foot}`,
  contentZh:`# 对话设定: {TITLE}

## 声线描述
-

## 示例台词
### 问候
> "……"

### 战斗
> "……"

### 待机
> "……"

### 任务
> "……"

## 禁忌话题
-

## 人际关系
| 角色 | 语气 | 备注 |
|------|------|------|
| | | |

${footZh}` },

/* ══════════ Items ══════════ */

{ id:'item', category:'items', folder:'05_Items', defaultFileName:'NewItem.md',
  nameEn:'Item', nameZh:'物品',
  descEn:'General item design document', descZh:'通用物品设计文档',
  contentEn:`# Item: {TITLE}

## Basic Info
- **Type**:
- **Rarity**:
- **Sell Price**:
- **Buy Price**:

## Description
### Flavor Text
> "*Italicized description.*"

### Mechanics
-

## Stats
| Stat | Value | Notes |
|------|-------|-------|
| Damage | | |
| Defense | | |
| Speed | | |

## Special Effects
-

## Crafting Recipe
| Material | Quantity | Source |
|----------|----------|--------|
| | | |

## Upgrade Path
| Level | Cost | Boost |
|-------|------|-------|
| +1 | | |

## Technical Notes (Unity)
- **Prefab**:
- **Item ID**:

${foot}`,
  contentZh:`# 物品: {TITLE}

## 基本信息
- **类型**：
- **稀有度**：
- **卖出价格**：
- **买入价格**：

## 描述
### 描述文本
> "*斜体描述文本。*"

### 机制描述
-

## 属性
| 属性 | 数值 | 备注 |
|------|------|------|
| 伤害 | | |
| 防御 | | |
| 速度 | | |

## 特殊效果
-

## 制作配方
| 材料 | 数量 | 来源 |
|------|------|------|
| | | |

## 升级路线
| 等级 | 成本 | 提升 |
|------|------|------|
| +1 | | |

## 技术说明 (Unity)
- **预制体**：
- **物品 ID**：

${footZh}` },

{ id:'weapon', category:'items', folder:'05_Items', defaultFileName:'NewWeapon.md',
  nameEn:'Weapon', nameZh:'武器',
  descEn:'Weapon design document', descZh:'武器设计文档',
  contentEn:`# Weapon: {TITLE}

- **Type**:
- **Damage**:
- **Attack Speed**:
- **Range**:

## Combo System
| Hit | Damage Multiplier | Animation |
|-----|-------------------|-----------|
| 1 | | |
| 2 | | |
| 3 | | |

## Special Ability
-

## Materials
-

## Upgrades
| Level | Material Cost | Damage Boost |
|-------|--------------|-------------|
| +1 | | |

${foot}`,
  contentZh:`# 武器: {TITLE}

- **类型**：
- **伤害**：
- **攻击速度**：
- **范围**：

## 连招系统
| 击数 | 伤害倍率 | 动画 |
|------|----------|------|
| 1 | | |
| 2 | | |
| 3 | | |

## 特殊能力
-

## 材料
-

## 升级
| 等级 | 材料消耗 | 伤害提升 |
|------|----------|----------|
| +1 | | |

${footZh}` },

{ id:'consumable', category:'items', folder:'05_Items', defaultFileName:'NewConsumable.md',
  nameEn:'Consumable', nameZh:'消耗品',
  descEn:'Consumable item document', descZh:'消耗品文档',
  contentEn:`# Consumable: {TITLE}

- **Type**:
- **Effect**:
- **Duration**:
- **Cooldown**:
- **Stack Size**:

## Crafting
| Material | Quantity |
|----------|----------|
| | |

## Acquisition
-

## Balance Notes
-

${foot}`,
  contentZh:`# 消耗品: {TITLE}

- **类型**：
- **效果**：
- **持续时间**：
- **冷却时间**：
- **堆叠数量**：

## 制作
| 材料 | 数量 |
|------|------|
| | |

## 获取方式
-

## 平衡备注
-

${footZh}` },

{ id:'quest-item', category:'items', folder:'05_Items', defaultFileName:'QuestItem.md',
  nameEn:'Quest Item', nameZh:'任务物品',
  descEn:'Quest / key item document', descZh:'任务 / 关键物品文档',
  contentEn:`# Quest Item: {TITLE}

- **Associated Quest**:
- **Acquisition**:
- **Usage**:
- **Return Location**:

## Visual Description
-

## Notes
-

${foot}`,
  contentZh:`# 任务物品: {TITLE}

- **关联任务**：
- **获取方式**：
- **用途**：
- **归还地点**：

## 外观描述
-

## 备注
-

${footZh}` },

{ id:'collectible', category:'items', folder:'05_Items', defaultFileName:'Collectible.md',
  nameEn:'Collectible', nameZh:'收集品',
  descEn:'Collectible tracking document', descZh:'收集品追踪文档',
  contentEn:`# Collectible: {TITLE}

- **Category**:
- **Total Count**:

## Locations
| # | Location | Coordinates | Notes |
|---|----------|-------------|-------|
| 1 | | | |
| 2 | | | |

## Reward Tiers
| Count | Reward |
|-------|--------|
| 5 | |
| 10 | |
| All | |

${foot}`,
  contentZh:`# 收集品: {TITLE}

- **分类**：
- **总数**：

## 位置
| # | 地点 | 坐标 | 备注 |
|---|------|------|------|
| 1 | | | |
| 2 | | | |

## 奖励层级
| 数量 | 奖励 |
|------|------|
| 5 | |
| 10 | |
| 全部 | |

${footZh}` },

/* ══════════ Quests ══════════ */

{ id:'quest', category:'quests', folder:'06_Quests', defaultFileName:'NewQuest.md',
  nameEn:'Quest', nameZh:'任务',
  descEn:'General quest design document', descZh:'通用任务设计文档',
  contentEn:`# Quest: {TITLE}

## Basic Info
- **Type**:
- **Giver**:
- **Location**:
- **Prerequisites**:

## Objective
-

## Steps
1. [ ] Step 1
2. [ ] Step 2
3. [ ] Step 3

## Branching Paths
### Path A
-
### Path B
-

## Rewards
| Reward | Type | Quantity |
|--------|------|----------|
| | | |

## Dialogue
### Start
> NPC: "..."
### Complete
> NPC: "..."

## Technical
- **Quest ID**:
- **Trigger**:
- **Completion Event**:

${foot}`,
  contentZh:`# 任务: {TITLE}

## 基本信息
- **类型**：
- **发布者**：
- **地点**：
- **前置条件**：

## 目标
-

## 步骤
1. [ ] 步骤 1
2. [ ] 步骤 2
3. [ ] 步骤 3

## 分支路径
### 路径 A
-
### 路径 B
-

## 奖励
| 奖励 | 类型 | 数量 |
|------|------|------|
| | | |

## 对话
### 开始
> NPC："……"
### 完成
> NPC："……"

## 技术实现
- **任务 ID**：
- **触发事件**：
- **完成事件**：

${footZh}` },

{ id:'main-quest', category:'quests', folder:'06_Quests', defaultFileName:'MainQuest.md',
  nameEn:'Main Quest', nameZh:'主线任务',
  descEn:'Main story quest document', descZh:'主线故事任务文档',
  contentEn:`# Main Quest: {TITLE}

- **Chapter**:
- **Story Beat**:
- **Prerequisites**:

## Objectives
-

## Key Dialogue
-

## Branching Decisions
| Decision | Consequence | Affected Quests |
|----------|-------------|-----------------|
| | | |

## Rewards
-

## Next Quest
-

${foot}`,
  contentZh:`# 主线任务: {TITLE}

- **章节**：
- **故事节点**：
- **前置条件**：

## 目标
-

## 关键对话
-

## 分支决策
| 决策 | 后果 | 影响任务 |
|------|------|----------|
| | | |

## 奖励
-

## 下一个任务
-

${footZh}` },

{ id:'side-quest', category:'quests', folder:'06_Quests', defaultFileName:'SideQuest.md',
  nameEn:'Side Quest', nameZh:'支线任务',
  descEn:'Side quest document', descZh:'支线任务文档',
  contentEn:`# Side Quest: {TITLE}

- **Giver**:
- **Location**:
- **Time Limit**:
- **Repeatable**: Yes / No

## Objective
-

## Steps
1. [ ]
2. [ ]

## Rewards
| Reward | Type | Quantity |
|--------|------|----------|
| | | |

## Prerequisites
-

${foot}`,
  contentZh:`# 支线任务: {TITLE}

- **发布者**：
- **地点**：
- **时间限制**：
- **可重复**：是 / 否

## 目标
-

## 步骤
1. [ ]
2. [ ]

## 奖励
| 奖励 | 类型 | 数量 |
|------|------|------|
| | | |

## 前置条件
-

${footZh}` },

{ id:'dialogue-scene', category:'quests', folder:'06_Quests', defaultFileName:'DialogueScene.md',
  nameEn:'Dialogue Scene', nameZh:'对话场景',
  descEn:'Dialogue scene or event', descZh:'对话场景或事件',
  contentEn:`# Dialogue Scene: {TITLE}

- **Characters**:
- **Location**:
- **Trigger**:

## Lines
| Speaker | Line | Emotion | Choice |
|---------|------|---------|--------|
| | | | |

## Branches
-

## Outcome
-

${foot}`,
  contentZh:`# 对话场景: {TITLE}

- **角色**：
- **地点**：
- **触发条件**：

## 台词
| 说话者 | 台词 | 情绪 | 选项 |
|--------|------|------|------|
| | | | |

## 分支
-

## 结果
-

${footZh}` },

{ id:'puzzle-design', category:'quests', folder:'06_Quests', defaultFileName:'PuzzleDesign.md',
  nameEn:'Puzzle Design', nameZh:'谜题设计',
  descEn:'Puzzle design document', descZh:'谜题设计文档',
  contentEn:`# Puzzle Design: {TITLE}

- **Location**:
- **Difficulty**:
- **Mechanics Used**:

## Solution (Spoiler)
-

## Hints
1. Hint 1
2. Hint 2
3. Hint 3

## Fail States
-

## Rewards
-

## Accessibility
-

${foot}`,
  contentZh:`# 谜题设计: {TITLE}

- **地点**：
- **难度**：
- **使用机制**：

## 解法（剧透）
-

## 提示
1. 提示 1
2. 提示 2
3. 提示 3

## 失败状态
-

## 奖励
-

## 无障碍
-

${footZh}` },

/* ══════════ Unity ══════════ */

{ id:'task-table', category:'unity', folder:'07_Unity_Tasks', defaultFileName:'TaskTable.md',
  nameEn:'Task Table', nameZh:'任务表',
  descEn:'Production / implementation task table', descZh:'制作 / 开发任务清单表',
  contentEn:`# Task Table: {TITLE}

## Overview
- **Milestone**:
- **Owner**:
- **Sprint / Date Range**:
- **Related Feature / Quest**:

## Task Table
| ID | Type | Task | Owner | Priority | Status | Estimate | Dependency | Acceptance |
|----|------|------|-------|----------|--------|----------|------------|------------|
| T-001 | Design / Art / Code / QA | | | P0 / P1 / P2 | Todo / WIP / Review / Done | | | |

## Narrative / Content Dependencies
| Related Doc | Needed By | Notes |
|-------------|-----------|-------|
| [[]] | | |

## Risks
- 

## Review Checklist
- [ ] Tasks have clear owners
- [ ] Acceptance criteria are testable
- [ ] Blocking dependencies are linked
- [ ] High-priority tasks are visible

${foot}`,
  contentZh:`# 任务表: {TITLE}

## 概览
- **里程碑**：
- **负责人**：
- **周期 / 日期范围**：
- **关联功能 / 任务**：

## 任务表
| ID | 类型 | 任务 | 负责人 | 优先级 | 状态 | 预估 | 依赖 | 验收标准 |
|----|------|------|--------|--------|------|------|------|----------|
| T-001 | 设计 / 美术 / 程序 / QA | | | P0 / P1 / P2 | Todo / WIP / Review / Done | | | |

## 剧情 / 内容依赖
| 关联文档 | 需要时间 | 备注 |
|----------|----------|------|
| [[]] | | |

## 风险
- 

## 复查清单
- [ ] 每个任务都有负责人
- [ ] 验收标准可以测试
- [ ] 阻塞依赖已经链接
- [ ] 高优先级任务清晰可见

${footZh}` },

{ id:'unity-task', category:'unity', folder:'07_Unity_Tasks', defaultFileName:'NewTask.md',
  nameEn:'Unity Task', nameZh:'Unity 任务',
  descEn:'Unity development task', descZh:'Unity 开发任务',
  contentEn:`# Unity Task: {TITLE}

## Task Info
- **Priority**: (P0 / P1 / P2)
- **Status**: TODO / IN PROGRESS / DONE
- **Assignee**:
- **Estimate**:

## What
-

## Why
-

## Technical Details
### Affected Files
-

### Implementation Plan
1.
2.
3.

### Unity Specifics
- **Scenes**:
- **Prefabs**:
- **Scripts**:

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Testing
- [ ] Play mode test
- [ ] Edge cases
- [ ] Performance check

## Dependencies
| Dependency | Status |
|------------|--------|
| | |

${foot}`,
  contentZh:`# Unity 任务: {TITLE}

## 任务信息
- **优先级**：（P0 / P1 / P2）
- **状态**：待办 / 进行中 / 已完成
- **负责人**：
- **预估工时**：

## 做什么
-

## 为什么
-

## 技术详情
### 涉及文件
-

### 实现计划
1.
2.
3.

### Unity 相关
- **场景**：
- **预制体**：
- **脚本**：

## 验收标准
- [ ] 标准 1
- [ ] 标准 2

## 测试
- [ ] Play 模式测试
- [ ] 边界情况
- [ ] 性能检查

## 依赖
| 依赖项 | 状态 |
|--------|------|
| | |

${footZh}` },

{ id:'scene-setup', category:'unity', folder:'07_Unity_Tasks', defaultFileName:'SceneSetup.md',
  nameEn:'Scene Setup', nameZh:'场景设置',
  descEn:'Scene setup document', descZh:'场景设置文档',
  contentEn:`# Scene Setup: {TITLE}

- **Scene Name**:
- **Lighting**:
- **Environment**:

## NPCs
-

## Interactive Objects
| Object | Script | Collider |
|--------|--------|----------|
| | | |

## NavMesh
- [ ] Generated
- [ ] Off-mesh Links

## Performance
- **Target FPS**:
- **Draw Calls Budget**:
- **LOD Levels**:

## Loading Strategy
-

${foot}`,
  contentZh:`# 场景设置: {TITLE}

- **场景名称**：
- **光照**：
- **环境**：

## NPC
-

## 交互物体
| 物体 | 脚本 | 碰撞体 |
|------|------|--------|
| | | |

## 导航网格
- [ ] 已生成
- [ ] Off-mesh 链接

## 性能
- **目标帧率**：
- **Draw Call 预算**：
- **LOD 级别**：

## 加载策略
-

${footZh}` },

{ id:'script-plan', category:'unity', folder:'07_Unity_Tasks', defaultFileName:'ScriptPlan.md',
  nameEn:'Script Plan', nameZh:'脚本计划',
  descEn:'Script planning document', descZh:'脚本规划文档',
  contentEn:`# Script Plan: {TITLE}

- **Class Name**:
- **Inherits From**:

## Public Methods
| Method | Parameters | Returns | Description |
|--------|-----------|---------|-------------|
| | | | |

## Events
| Event | When | Listeners |
|-------|------|-----------|
| | | |

## State Machine
| State | Transition | Action |
|-------|-----------|--------|
| | | |

## Pseudocode
\`\`\`
// Key logic here
\`\`\`

## Test Cases
-

${foot}`,
  contentZh:`# 脚本计划: {TITLE}

- **类名**：
- **继承自**：

## 公开方法
| 方法 | 参数 | 返回值 | 描述 |
|------|------|--------|------|
| | | | |

## 事件
| 事件 | 触发时机 | 监听者 |
|------|----------|--------|
| | | |

## 状态机
| 状态 | 转换 | 动作 |
|------|------|------|
| | | |

## 伪代码
\`\`\`
// 核心逻辑
\`\`\`

## 测试用例
-

${footZh}` },

{ id:'bug-report', category:'unity', folder:'07_Unity_Tasks', defaultFileName:'BugReport.md',
  nameEn:'Bug Report', nameZh:'Bug 报告',
  descEn:'Bug report template', descZh:'Bug 报告模板',
  contentEn:`# Bug Report: {TITLE}

- **Severity**: Critical / Major / Minor
- **Priority**: P0 / P1 / P2
- **Status**: Open / In Progress / Fixed
- **Build Version**:

## Reproduction Steps
1.
2.
3.

## Expected Behavior
-

## Actual Behavior
-

## Platform
- **OS**:
- **Device**:

## Screenshots
-

## Assignee**:
-

${foot}`,
  contentZh:`# Bug 报告: {TITLE}

- **严重程度**：严重 / 主要 / 次要
- **优先级**：P0 / P1 / P2
- **状态**：打开 / 处理中 / 已修复
- **构建版本**：

## 复现步骤
1.
2.
3.

## 预期行为
-

## 实际行为
-

## 平台
- **操作系统**：
- **设备**：

## 截图
-

## 负责人
-

${footZh}` },

{ id:'playtest-report', category:'unity', folder:'07_Unity_Tasks', defaultFileName:'PlaytestReport.md',
  nameEn:'Playtest Report', nameZh:'测试报告',
  descEn:'Playtest report template', descZh:'测试报告模板',
  contentEn:`# Playtest Report: {TITLE}

- **Date**: {DATE}
- **Build**:
- **Tester**:
- **Session Length**:

## Summary
-

## Issues Found
| # | Severity | Description | Steps |
|---|----------|-------------|-------|
| 1 | | | |

## Feedback
-

## Action Items
| Task | Owner | Deadline |
|------|-------|----------|
| | | |

${foot}`,
  contentZh:`# 测试报告: {TITLE}

- **日期**：{DATE}
- **构建版本**：
- **测试者**：
- **测试时长**：

## 概要
-

## 发现的问题
| # | 严重程度 | 描述 | 步骤 |
|---|----------|------|------|
| 1 | | | |

## 反馈
-

## 行动项
| 任务 | 负责人 | 截止日期 |
|------|--------|----------|
| | | |

${footZh}` },

/* ══════════ Devlog ══════════ */

{ id:'devlog', category:'devlog', folder:'08_Devlog', defaultFileName:'NewDevlog.md',
  nameEn:'Daily Devlog', nameZh:'开发日志',
  descEn:'Daily development log', descZh:'每日开发日志',
  contentEn:`# Devlog: {DATE} - {TITLE}

## Date
**Date**: {DATE}

## Summary
> One-sentence summary of today's progress.

## What I Did
### Completed
- [x] Task 1
- [x] Task 2

### In Progress
- [ ] Task 3

## Technical Notes
### What I Learned
-

### Problems Encountered
| Problem | Solution | Time Lost |
|---------|----------|-----------|
| | | |

## Tomorrow's Plan
1.
2.
3.

## Metrics
- **Hours Worked**:
- **Commits**:

${foot}`,
  contentZh:`# 开发日志: {DATE} - {TITLE}

## 日期
**日期**：{DATE}

## 概要
> 用一句话总结今天的进展。

## 今日工作
### 已完成
- [x] 任务 1
- [x] 任务 2

### 进行中
- [ ] 任务 3

## 技术笔记
### 学到了什么
-

### 遇到的问题
| 问题 | 解决方案 | 耗时 |
|------|----------|------|
| | | |

## 明天计划
1.
2.
3.

## 数据统计
- **工作时长**：
- **提交次数**：

${footZh}` },

{ id:'weekly-devlog', category:'devlog', folder:'08_Devlog', defaultFileName:'WeeklyDevlog.md',
  nameEn:'Weekly Devlog', nameZh:'周报',
  descEn:'Weekly development summary', descZh:'每周开发总结',
  contentEn:`# Weekly Devlog: {DATE} - {TITLE}

## Week Summary
-

## Completed
-

## In Progress
-

## Blocked
-

## Key Decisions
-

## Next Week Goals
1.
2.
3.

## Metrics
- **Hours**:
- **Commits**:

${foot}`,
  contentZh:`# 周报: {DATE} - {TITLE}

## 本周总结
-

## 已完成
-

## 进行中
-

## 阻塞
-

## 关键决策
-

## 下周目标
1.
2.
3.

## 数据统计
- **工时**：
- **提交次数**：

${footZh}` },

{ id:'version-changelog', category:'devlog', folder:'08_Devlog', defaultFileName:'Changelog.md',
  nameEn:'Version Changelog', nameZh:'更新日志',
  descEn:'Version changelog template', descZh:'版本更新日志模板',
  contentEn:`# Changelog: {TITLE}

- **Version**:
- **Date**: {DATE}

## Summary
-

## Added
-

## Changed
-

## Fixed
-

## Removed
-

## Known Issues
-

## Breaking Changes
-

${foot}`,
  contentZh:`# 更新日志: {TITLE}

- **版本**：
- **日期**：{DATE}

## 概要
-

## 新增
-

## 变更
-

## 修复
-

## 移除
-

## 已知问题
-

## 不兼容变更
-

${footZh}` },

{ id:'meeting-notes', category:'devlog', folder:'08_Devlog', defaultFileName:'MeetingNotes.md',
  nameEn:'Meeting Notes', nameZh:'会议记录',
  descEn:'Meeting notes template', descZh:'会议记录模板',
  contentEn:`# Meeting Notes: {DATE} - {TITLE}

- **Date**: {DATE}
- **Attendees**:

## Agenda
1.
2.
3.

## Discussion Points
-

## Decisions
-

## Action Items
| Task | Owner | Deadline |
|------|-------|----------|
| | | |

## Next Meeting
-

${foot}`,
  contentZh:`# 会议记录: {DATE} - {TITLE}

- **日期**：{DATE}
- **参会人员**：

## 议程
1.
2.
3.

## 讨论要点
-

## 决策
-

## 行动项
| 任务 | 负责人 | 截止日期 |
|------|--------|----------|
| | | |

## 下次会议
-

${footZh}` },

  /* ── Skill System ── */
  { id:'skill-system', category:'game-design', folder:'01_GDD', defaultFileName:'SkillSystem',
    nameEn:'Skill System', nameZh:'技能系统',
    descEn:'Skill tree and ability progression design', descZh:'技能树和能力进阶设计',
    contentEn:`# Skill System Design

## Overview
- **Skill Tree Type**: Linear / Branching / Grid / Hybrid
- **Total Skills**: 
- **Max Equippable**: 
- **Progression Resource**: Skill Points / XP / Class-specific

## Skill Categories
### Active Skills
| Skill | Type | Cost | Cooldown | Description |
|-------|------|-----|----------|-------------|
|       |      |     |          |             |

### Passive Skills
| Skill | Effect | Prerequisite | Description |
|-------|--------|-------------|-------------|
|       |        |             |             |

## Skill Trees
### Tree 1: 
- Tier 1:
- Tier 2:
- Tier 3:

## Unlock Conditions
-

## Balance Notes
- 

${foot}`,
    contentZh:`# 技能系统设计

## 概述
- **技能树类型**: 线性 / 分支 / 网格 / 混合
- **技能总数**: 
- **最大装备数**: 
- **进阶资源**: 技能点 / 经验值 / 职业专属

## 技能分类
### 主动技能
| 技能 | 类型 | 消耗 | 冷却 | 描述 |
|------|------|------|------|------|
|      |      |      |      |      |

### 被动技能
| 技能 | 效果 | 前置条件 | 描述 |
|------|------|----------|------|
|      |      |          |      |

## 技能树
### 树 1:
- 第1层:
- 第2层:
- 第3层:

## 解锁条件
-

## 平衡备注
- 

${footZh}` },

  /* ── Achievement System ── */
  { id:'achievement-system', category:'game-design', folder:'01_GDD', defaultFileName:'AchievementSystem',
    nameEn:'Achievement System', nameZh:'成就系统',
    descEn:'Achievement and milestone tracking design', descZh:'成就和里程碑追踪设计',
    contentEn:`# Achievement System Design

## Overview
- **Categories**: Combat / Exploration / Collection / Story / Social / Hidden
- **Total Achievements**: 
- **Rewards**: Cosmetic / Unlocks / Titles / In-game Currency

## Achievement List
### Combat
| ID | Name | Condition | Reward |
|----|------|-----------|--------|
|    |      |           |        |

### Exploration
| ID | Name | Condition | Reward |
|----|------|-----------|--------|
|    |      |           |        |

### Collection
| ID | Name | Condition | Reward |
|----|------|-----------|--------|
|    |      |           |        |

### Story
| ID | Name | Condition | Reward |
|----|------|-----------|--------|
|    |      |           |        |

### Hidden
| ID | Name | Condition | Reward | Hint |
|----|------|-----------|--------|------|
|    |      |           |        |      |

## Progression Tiers
- Bronze: 10 achievements
- Silver: 25 achievements
- Gold: 50 achievements
- Platinum: All achievements

## UI Requirements
- Popup notification on unlock
- Progress bar for multi-step achievements
- Gallery / showcase page

${foot}`,
    contentZh:`# 成就系统设计

## 概述
- **类别**: 战斗 / 探索 / 收集 / 剧情 / 社交 / 隐藏
- **成就总数**: 
- **奖励**: 外观 / 解锁 / 称号 / 游戏内货币

## 成就列表
### 战斗
| ID | 名称 | 条件 | 奖励 |
|----|------|------|------|
|    |      |      |      |

### 探索
| ID | 名称 | 条件 | 奖励 |
|----|------|------|------|
|    |      |      |      |

### 收集
| ID | 名称 | 条件 | 奖励 |
|----|------|------|------|
|    |      |      |      |

### 剧情
| ID | 名称 | 条件 | 奖励 |
|----|------|------|------|
|    |      |      |      |

### 隐藏
| ID | 名称 | 条件 | 奖励 | 提示 |
|----|------|------|------|------|
|    |      |      |      |      |

## 进阶等级
- 铜牌: 10个成就
- 银牌: 25个成就
- 金牌: 50个成就
- 白金: 全部成就

## UI 要求
- 解锁时弹出通知
- 多步骤成就进度条
- 展示/收藏页面

${footZh}` },

  /* ── Combat System ── */
  { id:'combat-system', category:'game-design', folder:'01_GDD', defaultFileName:'CombatSystem',
    nameEn:'Combat System', nameZh:'战斗系统',
    descEn:'Combat mechanics and damage formulas', descZh:'战斗机制和伤害公式',
    contentEn:`# Combat System Design

## Core Mechanics
- **Combat Type**: Real-time / Turn-based / Action / Hybrid
- **Party Size**: 
- **Encounter Rate**: 

## Damage Formula
\`\`\`
Base Damage = (ATK * Skill_Multiplier) - (DEF * Defense_Modifier)
Final Damage = Base_Damage * Element_Modifier * Crit_Modifier * Random(0.95, 1.05)
\`\`\`

## Stats
| Stat | Abbreviation | Description |
|------|-------------|-------------|
| HP | Health Points | 
| MP | Mana Points | 
| ATK | Attack | 
| DEF | Defense | 
| SPD | Speed | 
| CRT | Critical Rate | 
| CRD | Critical Damage | 

## Status Effects
| Effect | Duration | Effect | Cure |
|--------|----------|--------|------|
| Poison | 3 turns | -5% HP/turn | Antidote |
| Stun | 1 turn | Skip turn | - |
| Burn | 2 turns | -3% HP/turn | Water |
| Freeze | 1 turn | Skip turn | Fire |

## Action Point System
- Max AP per turn: 
- Move cost: 
- Attack cost: 
- Skill cost: 

## Balance Notes
- 

${foot}`,
    contentZh:`# 战斗系统设计

## 核心机制
- **战斗类型**: 即时 / 回合制 / 动作 / 混合
- **队伍人数**: 
- **遇敌频率**: 

## 伤害公式
\`\`\`
基础伤害 = (攻击力 * 技能倍率) - (防御力 * 防御系数)
最终伤害 = 基础伤害 * 属性系数 * 暴击系数 * 随机(0.95, 1.05)
\`\`\`

## 属性
| 属性 | 缩写 | 说明 |
|------|------|------|
| 生命值 | HP | 
| 魔力值 | MP | 
| 攻击力 | ATK | 
| 防御力 | DEF | 
| 速度 | SPD | 
| 暴击率 | CRT | 
| 暴击伤害 | CRD | 

## 状态效果
| 效果 | 持续 | 效果 | 治愈 |
|------|------|------|------|
| 中毒 | 3回合 | -5% HP/回合 | 解毒药 |
| 眩晕 | 1回合 | 跳过回合 | - |
| 燃烧 | 2回合 | -3% HP/回合 | 水 |
| 冰冻 | 1回合 | 跳过回合 | 火 |

## 行动点系统
- 每回合最大 AP: 
- 移动消耗: 
- 攻击消耗: 
- 技能消耗: 

## 平衡备注
- 

${footZh}` },

/* ══════════ Worldbuilding Extended (v0.9.6) ══════════ */

{ id:'story-arc', category:'worldbuilding', folder:'02_Worldbuilding', defaultFileName:'StoryArc.md',
  nameEn:'Story Arc', nameZh:'故事线',
  descEn:'Story arc / chapter outline with plot beats', descZh:'故事线/章节大纲',
  contentEn:`# Story Arc: {TITLE}

## Overview
- **Arc Type**: Main Story / Side Story / Character Arc / DLC
- **Chapter Number**:
- **Estimated Play Time**:
- **Tone**: Dark / Lighthearted / Bittersweet / Epic / Mysterious
- **Related Arcs**:

## Plot Summary
> One paragraph summary of the entire arc.

## Plot Beats
### Act 1 — Setup
1. **Hook**:
2. **Inciting Incident**:
3. **First Plot Point**:

### Act 2 — Confrontation
1. **Rising Action**:
2. **Midpoint Twist**:
3. **All Is Lost Moment**:

### Act 3 — Resolution
1. **Climax**:
2. **Final Battle / Confrontation**:
3. **Denouement**:

## Key Characters
| Character | Role in Arc | Arc Impact |
|-----------|------------|------------|
| | | |

## Key Locations
- 

## Emotional Arc
Tension ───────────────────
   |          *
   |        *   *
   |      *       *
   |    *           *
   |  *               *
   |*_______________________
     Act1    Act2    Act3

## Themes
- 

## Choices & Branches
| Choice Point | Option A | Option B | Consequence |
|-------------|----------|----------|-------------|
| | | | |

## Unresolved Threads
- 

## Notes
- 

${foot}`,
  contentZh:`# 故事线: {TITLE}

## 概览
- **故事类型**: 主线 / 支线 / 角色线 / DLC
- **章节编号**：
- **预计游玩时长**：
- **基调**: 黑暗 / 轻松 / 苦乐参半 / 史诗 / 神秘
- **关联故事线**：

## 剧情概要
> 一段话概括整个故事线。

## 剧情节拍
### 第一幕 — 铺垫
1. **钩子**：
2. **触发事件**：
3. **第一转折点**：

### 第二幕 — 冲突
1. **上升行动**：
2. **中点转折**：
3. **最低谷**：

### 第三幕 — 解决
1. **高潮**：
2. **最终决战/对峙**：
3. **收尾**：

## 关键角色
| 角色 | 故事中的角色 | 剧情影响 |
|------|------------|---------|
| | | |

## 关键地点
- 

## 情感曲线
- 开篇情绪：
- 中段转折：
- 结尾感受：

## 主题
- 

## 选择与分支
| 选择点 | 选项A | 选项B | 后果 |
|--------|-------|-------|------|
| | | | |

## 未解决的伏笔
- 

## 备注
- 

${footZh}` },

{ id:'dialogue-script', category:'worldbuilding', folder:'02_Worldbuilding', defaultFileName:'DialogueScript.md',
  nameEn:'Dialogue Script', nameZh:'台词剧本',
  descEn:'Full dialogue script with stage directions', descZh:'完整台词剧本（含舞台指示）',
  contentEn:`# Dialogue Script: {TITLE}

## Metadata
- **Scene**: 
- **Characters Present**:
- **Location**: 
- **Time of Day**:
- **Mood**: 
- **Prerequisites**:

## Context
> What happened just before this scene?

---

## Script

**[{Character A} enters from the left, looking exhausted]**

**{Character A}**: "You're still here? I thought everyone left hours ago."

**[{Character B} doesn't look up from the table]**

**{Character B}**: "And I thought you'd have given up by now. Guess we're both full of surprises."

**[{Character A} sits down across from {Character B}]**

**{Character A}**: "I need to talk to you about what happened at the tower."

**{Character B}**: *[finally looks up, eyes sharp]* "Do you really? Or do you just want to feel better about it?"

---

### Branch: Player Choice

**[Choice A: "I made a mistake."]**

**{Character A}**: "I made a mistake. I know that now."

**{Character B}**: *[pauses, then slowly exhales]* "That's the first honest thing you've said all day."

> *Continue to: [[Reconciliation Scene]]*

---

**[Choice B: "I'd do it again."]**

**{Character A}**: "Given the same choice, I'd do it again."

**{Character B}**: *[stands abruptly, chair scraping]* "Then we have nothing left to discuss."

> *Continue to: [[Confrontation Scene]]*

---

## Stage Directions Key
- [brackets] = Physical action / movement
- *asterisks* = Emotion / expression
- > italics = Scene transition / technical note
- [[wiki-link]] = Connected document

## Emotional Notes
| Character | Start Emotion | End Emotion | Why |
|-----------|--------------|-------------|-----|
| | | | |

## Voice Notes
- **{Character A}**: 
- **{Character B}**: 

${foot}`,
  contentZh:`# 台词剧本: {TITLE}

## 元数据
- **场景**：
- **在场角色**：
- **地点**：
- **时间**：
- **氛围**：
- **前置条件**：

## 背景
> 这场戏之前发生了什么？

---

## 剧本

**【{角色A}从左侧走入，神色疲惫】**

**{角色A}**：「你还在？我以为大家早走了。」

**【{角色B}没有抬头】**

**{角色B}**：「我还以为你早就放弃了呢。看来我们都挺出人意料。」

**【{角色A}在{角色B}对面坐下】**

**{角色A}**：「塔楼发生的事……我想跟你谈谈。」

**{角色B}**：*【终于抬头，目光锐利】*「你真的想谈？还是只想让自己好受点？」

---

### 分支：玩家选择

**【选项A：「我犯了一个错误。」】**

**{角色A}**：「我犯了一个错误。我现在明白了。」

**{角色B}**：*【停顿，缓缓呼气】*「这是你今天说的第一句真话。」

> *转至：[[和解场景]]*

---

**【选项B：「我会再做一次。」】**

**{角色A}**：「同样的选择，我还会那么做。」

**{角色B}**：*【猛地站起，椅子摩擦地面】*「那我们没什么好谈的了。」

> *转至：[[对峙场景]]*

---

## 舞台指示说明
- 【】 = 肢体动作/移动
- *【】* = 情绪/表情
- > 斜体 = 场景转换/技术注释
- [[]] = 关联文档

## 情绪记录
| 角色 | 起始情绪 | 结束情绪 | 原因 |
|------|---------|---------|------|
| | | | |

## 声线备注
- **{角色A}**：
- **{角色B}**：

${footZh}` },

{ id:'cutscene', category:'worldbuilding', folder:'02_Worldbuilding', defaultFileName:'Cutscene.md',
  nameEn:'Cutscene', nameZh:'过场动画',
  descEn:'Cutscene storyboard with camera and dialogue', descZh:'过场动画分镜（含镜头和台词）',
  contentEn:`# Cutscene: {TITLE}

## Overview
- **Duration**: ~ seconds
- **Characters**: 
- **Location**: 
- **Trigger**: 
- **Music**:

## Storyboard

### Shot 1
- **Camera**: Wide shot, establishing
- **Action**: 
- **Dialogue**: 
- **SFX**: 
- **Duration**: s

### Shot 2
- **Camera**: Close-up on {Character}
- **Action**: 
- **Dialogue**: 
- **SFX**: 
- **Duration**: s

### Shot 3
- **Camera**: Over-the-shoulder
- **Action**: 
- **Dialogue**: 
- **SFX**: 
- **Duration**: s

### Shot 4
- **Camera**: Dramatic zoom / pan
- **Action**: 
- **Dialogue**: 
- **SFX**: 
- **Duration**: s

### Shot 5
- **Camera**: Fade to black
- **Action**: 
- **Dialogue**: 
- **SFX**: 
- **Duration**: s

## Full Dialogue Script
| Shot | Speaker | Line | Emotion |
|------|---------|------|---------|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |

## Technical Notes
- **Animation Triggers**: 
- **Particle Effects**: 
- **Camera Transitions**: 
- **Voice Acting Notes**: 

## Connected Documents
- Related quest: [[]]
- Related characters: [[]]
- Related location: [[]]

${foot}`,
  contentZh:`# 过场动画: {TITLE}

## 概览
- **时长**：约 秒
- **角色**：
- **地点**：
- **触发条件**：
- **背景音乐**：

## 分镜表

### 镜头 1
- **摄像机**：远景，建立镜头
- **动作**：
- **台词**：
- **音效**：
- **时长**：秒

### 镜头 2
- **摄像机**：{角色}特写
- **动作**：
- **台词**：
- **音效**：
- **时长**：秒

### 镜头 3
- **摄像机**：过肩镜头
- **动作**：
- **台词**：
- **音效**：
- **时长**：秒

### 镜头 4
- **摄像机**：戏剧性推拉/平移
- **动作**：
- **台词**：
- **音效**：
- **时长**：秒

### 镜头 5
- **摄像机**：淡出黑屏
- **动作**：
- **台词**：
- **音效**：
- **时长**：秒

## 完整台词
| 镜头 | 说话者 | 台词 | 情绪 |
|------|--------|------|------|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |

## 技术备注
- **动画触发**：
- **粒子效果**：
- **镜头转场**：
- **配音备注**：

## 关联文档
- 相关任务：[[]]
- 相关角色：[[]]
- 相关地点：[[]]

${footZh}` },

{ id:'character-banter', category:'characters', folder:'03_Characters', defaultFileName:'Banter.md',
  nameEn:'Party Banter', nameZh:'队伍闲聊',
  descEn:'Party banter / idle dialogue between characters', descZh:'角色间的闲聊/待机对话',
  contentEn:`# Party Banter: {TITLE}

## Participants
- **Character A**: 
- **Character B**: 
- **Trigger Condition**: Walking together / Camp / Specific location / Timer

## Banter Script

### Topic 1: [Topic Name]
**Trigger**: [What triggers this banter]

**{Character A}**: "..."

**{Character B}**: "..."

**{Character A}**: "..."

**{Character B}**: "..."

---

### Topic 2: [Topic Name]
**Trigger**: [What triggers this banter]

**{Character A}**: "..."

**{Character B}**: "..."

**{Character A}**: "..."

---

### Topic 3: [Topic Name]
**Trigger**: [What triggers this banter]

**{Character A}**: "..."

**{Character B}**: "..."

## Banter Rules
- {Character A}'s speech patterns: 
- {Character B}'s speech patterns: 
- Their relationship dynamic: 
- Topics they agree on: 
- Topics they argue about: 
- Inside jokes: 

## Voice Notes
| Character | Pitch | Speed | Accent | Quirks |
|-----------|-------|-------|--------|--------|
| | | | | |

## Connected Characters
- [[]]
- [[]]

${foot}`,
  contentZh:`# 队伍闲聊: {TITLE}

## 参与者
- **角色A**：
- **角色B**：
- **触发条件**：一起行走 / 营地 / 特定地点 / 计时器

## 闲聊剧本

### 话题 1：[话题名]
**触发**：[什么触发这段闲聊]

**{角色A}**：「……」

**{角色B}**：「……」

**{角色A}**：「……」

**{角色B}**：「……」

---

### 话题 2：[话题名]
**触发**：[什么触发这段闲聊]

**{角色A}**：「……」

**{角色B}**：「……」

**{角色A}**：「……」

---

### 话题 3：[话题名]
**触发**：[什么触发这段闲聊]

**{角色A}**：「……」

**{角色B}**：「……」

## 闲聊规则
- {角色A}的说话方式：
- {角色B}的说话方式：
- 两人的关系动态：
- 一致的话题：
- 争论的话题：
- 内部笑话：

## 声线备注
| 角色 | 音调 | 语速 | 口音 | 特点 |
|------|------|------|------|------|
| | | | | |

## 关联角色
- [[]]
- [[]]

${footZh}` },

{ id:'plot-outline', category:'worldbuilding', folder:'02_Worldbuilding', defaultFileName:'PlotOutline.md',
  nameEn:'Plot Outline', nameZh:'剧情大纲',
  descEn:'Full game plot outline with chapters', descZh:'完整游戏剧情大纲（含章节）',
  contentEn:`# Plot Outline: {TITLE}

## Game Vision
> One sentence that captures the emotional core of the story.

## Central Conflict
- **External Conflict**: 
- **Internal Conflict**: 
- **Thematic Question**: 

## Act Structure

### Prologue
- **Purpose**: Hook the player, introduce the world
- **Key Events**:
  1. 
  2. 
- **Ending Hook**: 
- **Characters Introduced**: 

---

### Chapter 1: [Title]
- **Theme**: 
- **Location**: 
- **POV Character**: 

**Plot Points:**
1. 
2. 
3. 

**Character Development**: 

**New Reveals**: 

---

### Chapter 2: [Title]
- **Theme**: 
- **Location**: 
- **POV Character**: 

**Plot Points:**
1. 
2. 
3. 

**Character Development**: 

**New Reveals**: 

---

### Chapter 3: [Title]
- **Theme**: 
- **Location**: 
- **POV Character**: 

**Plot Points:**
1. 
2. 
3. 

**Character Development**: 

**New Reveals**: 

---

### Midpoint Twist
> The event that changes everything.
- **What**: 
- **Why it matters**: 
- **How it recontextualizes**: 

---

### Chapter 4: [Title]
- **Theme**: 
- **Location**: 

**Plot Points:**
1. 
2. 
3. 

---

### Chapter 5: [Title]
- **Theme**: 
- **Location**: 

**Plot Points:**
1. 
2. 
3. 

---

### Climax
- **Setting**: 
- **Antagonist Reveal**: 
- **Final Choice**: 
  - Option A → Ending A:
  - Option B → Ending B:

---

### Epilogue
- **Tone**: 
- **What Changed**: 
- **Unresolved Mysteries** (for sequel?): 

## Foreshadowing Map
| Hint | Placed In | Revealed In | What It Means |
|------|-----------|-------------|---------------|
| | | | |

## Character Arcs Summary
| Character | Start State | Turning Point | End State |
|-----------|------------|---------------|-----------|
| | | | |

## Connected Documents
- World: [[]]
- Characters: [[]]
- Locations: [[]]

${foot}`,
  contentZh:`# 剧情大纲: {TITLE}

## 游戏愿景
> 一句话概括故事的情感核心。

## 核心冲突
- **外部冲突**：
- **内部冲突**：
- **主题问题**：

## 幕结构

### 序章
- **目的**：吸引玩家，介绍世界观
- **关键事件**：
  1. 
  2. 
- **结尾钩子**：
- **登场的角色**：

---

### 第一章：[标题]
- **主题**：
- **地点**：
- **视角角色**：

**剧情点：**
1. 
2. 
3. 

**角色发展**：

**新揭示**：

---

### 第二章：[标题]
- **主题**：
- **地点**：
- **视角角色**：

**剧情点：**
1. 
2. 
3. 

**角色发展**：

**新揭示**：

---

### 第三章：[标题]
- **主题**：
- **地点**：
- **视角角色**：

**剧情点：**
1. 
2. 
3. 

**角色发展**：

**新揭示**：

---

### 中点转折
> 改变一切的事件。
- **什么**：
- **为何重要**：
- **如何重新定义之前的认知**：

---

### 第四章：[标题]
- **主题**：
- **地点**：

**剧情点：**
1. 
2. 
3. 

---

### 第五章：[标题]
- **主题**：
- **地点**：

**剧情点：**
1. 
2. 
3. 

---

### 高潮
- **场景**：
- **反派揭示**：
- **最终选择**：
  - 选项A → 结局A：
  - 选项B → 结局B：

---

### 尾声
- **基调**：
- **改变了什么**：
- **未解之谜**（续作伏笔？）：

## 伏笔地图
| 暗示 | 放置章节 | 揭示章节 | 含义 |
|------|---------|---------|------|
| | | | |

## 角色成长线总结
| 角色 | 起始状态 | 转折点 | 最终状态 |
|------|---------|--------|---------|
| | | | |

## 关联文档
- 世界观：[[]]
- 角色：[[]]
- 地点：[[]]

${footZh}` },

{ id:'world-map', category:'worldbuilding', folder:'02_Worldbuilding', defaultFileName:'WorldMap.md',
  nameEn:'World Map', nameZh:'世界地图',
  descEn:'World/region map description and key locations', descZh:'世界/区域地图描述与关键地点',
  contentEn:`# World Map: {TITLE}

## Overview
- **World Name**: 
- **Scale**: Continent / Region / Island / Planet
- **Tech Level**: Medieval / Steampunk / Modern / Sci-Fi / Fantasy
- **Map Type**: Open World / Hub-based / Linear

## Regions

### Region 1: [Name]
- **Terrain**: 
- **Climate**: 
- **Danger Level**: 1-10
- **Faction Control**: 
- **Key Locations**:
  1. 
  2. 
- **Resources**: 
- **Enemies**: 
- **Connected Regions**: 
- **Story Relevance**: 

### Region 2: [Name]
- **Terrain**: 
- **Climate**: 
- **Danger Level**: 1-10
- **Faction Control**: 
- **Key Locations**:
  1. 
  2. 
- **Resources**: 
- **Enemies**: 
- **Connected Regions**: 
- **Story Relevance**: 

### Region 3: [Name]
- **Terrain**: 
- **Climate**: 
- **Danger Level**: 1-10
- **Faction Control**: 
- **Key Locations**:
  1. 
  2. 
- **Resources**: 
- **Enemies**: 
- **Connected Regions**: 
- **Story Relevance**: 

## Travel Rules
- **Fast Travel**: Yes / No / Unlockable
- **Travel Hazards**: 
- **Mount System**: 
- **Random Encounters**: 

## Point of Interest Index
| Location | Region | Type | Level | Quest |
|----------|--------|------|-------|-------|
| | | | | |

## Connected Documents
- [[]]
- [[]]

${foot}`,
  contentZh:`# 世界地图: {TITLE}

## 概览
- **世界名称**：
- **尺度**：大陆 / 区域 / 岛屿 / 星球
- **科技水平**：中世纪 / 蒸汽朋克 / 现代 / 科幻 / 奇幻
- **地图类型**：开放世界 / 枢纽式 / 线性

## 区域

### 区域 1：[名称]
- **地形**：
- **气候**：
- **危险等级**：1-10
- **势力控制**：
- **关键地点**：
  1. 
  2. 
- **资源**：
- **敌人**：
- **相邻区域**：
- **剧情相关性**：

### 区域 2：[名称]
- **地形**：
- **气候**：
- **危险等级**：1-10
- **势力控制**：
- **关键地点**：
  1. 
  2. 
- **资源**：
- **敌人**：
- **相邻区域**：
- **剧情相关性**：

### 区域 3：[名称]
- **地形**：
- **气候**：
- **危险等级**：1-10
- **势力控制**：
- **关键地点**：
  1. 
  2. 
- **资源**：
- **敌人**：
- **相邻区域**：
- **剧情相关性**：

## 移动规则
- **快速旅行**：是 / 否 / 可解锁
- **旅行危险**：
- **坐骑系统**：
- **随机遭遇**：

## 兴趣点索引
| 地点 | 区域 | 类型 | 等级 | 任务 |
|------|------|------|------|------|
| | | | | |

## 关联文档
- [[]]
- [[]]

${footZh}` },


{ id:'ui-wireframe', category:'game-design', folder:'01_GDD', defaultFileName:'UIWireframe.excalidraw',
  nameEn:'UI Wireframe', nameZh:'UI线框图',
  descEn:'Interactive UI wireframe (Excalidraw)', descZh:'交互式UI线框图（Excalidraw）',
  contentEn:JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'ars-note',
    elements: [
      { type: 'rectangle', id: 'screen', x: 200, y: 80, width: 400, height: 700, strokeColor: '#868e96', backgroundColor: 'transparent', strokeWidth: 2, roughness: 0, fillStyle: 'solid' },
      { type: 'rectangle', id: 'header', x: 200, y: 80, width: 400, height: 50, strokeColor: '#868e96', backgroundColor: '#e9ecef', strokeWidth: 1, roughness: 0, fillStyle: 'solid' },
      { type: 'text', id: 'title', x: 220, y: 90, text: 'Screen Title', fontSize: 20, strokeColor: '#212529', roughness: 0 },
      { type: 'rectangle', id: 'nav', x: 200, y: 140, width: 400, height: 40, strokeColor: '#868e96', backgroundColor: '#dee2e6', strokeWidth: 1, roughness: 0, fillStyle: 'solid' },
      { type: 'text', id: 'navtext', x: 220, y: 148, text: 'Tab 1    Tab 2    Tab 3', fontSize: 14, strokeColor: '#495057', roughness: 0 },
      { type: 'rectangle', id: 'content', x: 220, y: 200, width: 360, height: 200, strokeColor: '#adb5bd', backgroundColor: '#f8f9fa', strokeWidth: 1, roughness: 0, fillStyle: 'solid' },
      { type: 'text', id: 'contenttxt', x: 240, y: 220, text: 'Content Area\n\nDrag elements here\nto build your UI', fontSize: 16, strokeColor: '#868e96', roughness: 0 },
      { type: 'rectangle', id: 'btn1', x: 220, y: 420, width: 120, height: 40, strokeColor: '#228be6', backgroundColor: '#228be6', strokeWidth: 1, roughness: 0, fillStyle: 'solid' },
      { type: 'text', id: 'btn1txt', x: 248, y: 430, text: 'Action', fontSize: 16, strokeColor: '#ffffff', roughness: 0 },
      { type: 'rectangle', id: 'btn2', x: 360, y: 420, width: 120, height: 40, strokeColor: '#868e96', backgroundColor: 'transparent', strokeWidth: 1, roughness: 0, fillStyle: 'solid' },
      { type: 'text', id: 'btn2txt', x: 392, y: 430, text: 'Cancel', fontSize: 16, strokeColor: '#495057', roughness: 0 },
      { type: 'text', id: 'label', x: 200, y: 500, text: '# UI Wireframe Template\nEdit this to design your game UI.\nUse Excalidraw tools to add buttons, lists, images.', fontSize: 14, strokeColor: '#adb5bd', roughness: 0 },
    ],
    appState: { viewBackgroundColor: '#1e1e1e' },
    files: {},
  }),
  contentZh:JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'ars-note',
    elements: [
      { type: 'rectangle', id: 'screen', x: 200, y: 80, width: 400, height: 700, strokeColor: '#868e96', backgroundColor: 'transparent', strokeWidth: 2, roughness: 0, fillStyle: 'solid' },
      { type: 'rectangle', id: 'header', x: 200, y: 80, width: 400, height: 50, strokeColor: '#868e96', backgroundColor: '#e9ecef', strokeWidth: 1, roughness: 0, fillStyle: 'solid' },
      { type: 'text', id: 'title', x: 220, y: 90, text: 'Screen Title', fontSize: 20, strokeColor: '#212529', roughness: 0 },
      { type: 'rectangle', id: 'nav', x: 200, y: 140, width: 400, height: 40, strokeColor: '#868e96', backgroundColor: '#dee2e6', strokeWidth: 1, roughness: 0, fillStyle: 'solid' },
      { type: 'text', id: 'navtext', x: 220, y: 148, text: 'Tab 1    Tab 2    Tab 3', fontSize: 14, strokeColor: '#495057', roughness: 0 },
      { type: 'rectangle', id: 'content', x: 220, y: 200, width: 360, height: 200, strokeColor: '#adb5bd', backgroundColor: '#f8f9fa', strokeWidth: 1, roughness: 0, fillStyle: 'solid' },
      { type: 'text', id: 'contenttxt', x: 240, y: 220, text: 'Content Area\n\nDrag elements here\nto build your UI', fontSize: 16, strokeColor: '#868e96', roughness: 0 },
      { type: 'rectangle', id: 'btn1', x: 220, y: 420, width: 120, height: 40, strokeColor: '#228be6', backgroundColor: '#228be6', strokeWidth: 1, roughness: 0, fillStyle: 'solid' },
      { type: 'text', id: 'btn1txt', x: 248, y: 430, text: 'Action', fontSize: 16, strokeColor: '#ffffff', roughness: 0 },
      { type: 'rectangle', id: 'btn2', x: 360, y: 420, width: 120, height: 40, strokeColor: '#868e96', backgroundColor: 'transparent', strokeWidth: 1, roughness: 0, fillStyle: 'solid' },
      { type: 'text', id: 'btn2txt', x: 392, y: 430, text: 'Cancel', fontSize: 16, strokeColor: '#495057', roughness: 0 },
      { type: 'text', id: 'label', x: 200, y: 500, text: '# UI Wireframe Template\nEdit this to design your game UI.\nUse Excalidraw tools to add buttons, lists, images.', fontSize: 14, strokeColor: '#adb5bd', roughness: 0 },
    ],
    appState: { viewBackgroundColor: '#1e1e1e' },
    files: {},
  }),
},

];

/* ── Exports ── */

export function getCategories(t: Translations, lang: Language): TemplateCategory[] {
  return CATEGORIES.map((c) => ({
    id: c.id,
    name: lang === 'zh-CN' ? c.nameZh : c.nameEn,
    folder: c.folder,
  }));
}

export function getTemplates(t: Translations, lang: Language): TemplateDef[] {
  return T.map((def) => ({
    id: def.id,
    category: def.category,
    name: lang === 'zh-CN' ? def.nameZh : def.nameEn,
    description: lang === 'zh-CN' ? def.descZh : def.descEn,
    folder: def.folder,
    defaultFileName: def.defaultFileName,
    content: lang === 'zh-CN' ? def.contentZh : def.contentEn,
  }));
}

export function getTemplateById(id: string, t: Translations, lang: Language): TemplateDef | undefined {
  return getTemplates(t, lang).find((tpl) => tpl.id === id);
}
