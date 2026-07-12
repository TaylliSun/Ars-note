/* ── Game Workspace Create Helper (v0.9.1) ── */
/* Generates folder / fileName / content for quick-create game docs */

import type { GameDocType } from '../types';
import { getTemplateById } from '../templates';
import type { Translations, Language } from '../i18n';

export interface GameDocCreateInfo {
  folder: string;
  fileName: string;
  content: string;
  templateId: string;
}

export interface NarrativeProductionKitFile {
  folder: string;
  fileName: string;
  content: string;
  openAfterCreate?: boolean;
}

const DOC_CONFIG: Record<GameDocType, { templateId: string; folder: string; defaultFileName: string }> = {
  gdd: { templateId: 'gdd', folder: '01_GDD', defaultFileName: 'NewGDD.md' },
  worldbuilding: { templateId: 'worldbuilding', folder: '02_Worldbuilding', defaultFileName: 'WorldOverview.md' },
  story: { templateId: 'plot-outline', folder: '02_Worldbuilding', defaultFileName: 'PlotOutline.md' },
  dialogue: { templateId: 'dialogue-script', folder: '02_Worldbuilding', defaultFileName: 'DialogueScript.md' },
  performance: { templateId: 'cutscene', folder: '02_Worldbuilding', defaultFileName: 'Cutscene.md' },
  character: { templateId: 'character', folder: '03_Characters', defaultFileName: 'NewCharacter.md' },
  item: { templateId: 'item', folder: '05_Items', defaultFileName: 'NewItem.md' },
  quest: { templateId: 'quest', folder: '06_Quests', defaultFileName: 'NewQuest.md' },
  taskTable: { templateId: 'task-table', folder: '07_Unity_Tasks', defaultFileName: 'TaskTable.md' },
  unityTask: { templateId: 'unity-task', folder: '07_Unity_Tasks', defaultFileName: 'NewUnityTask.md' },
  devlog: { templateId: 'devlog', folder: '99_Devlog', defaultFileName: '' }, // date-based
};

/**
 * Generate the creation info for a game workspace document.
 * Returns folder, fileName, and template content.
 */
export function createGameWorkspaceDoc(
  type: GameDocType,
  t: Translations,
  language: Language,
): GameDocCreateInfo {
  const config = DOC_CONFIG[type];
  if (!config) throw new Error('Unknown game doc type: ' + type);

  const template = getTemplateById(config.templateId, t, language);
  if (!template) throw new Error('Template not found: ' + config.templateId);

  let fileName: string;
  if (type === 'devlog') {
    /* Devlog uses date-based filename */
    const now = new Date();
    const dateStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('');
    fileName = `Devlog_${dateStr}.md`;
  } else {
    fileName = config.defaultFileName;
  }

  /* Replace placeholders in content */
  const title = fileName.replace(/\.md$/i, '');
  const date = new Date().toISOString().split('T')[0];
  const content = template.content
    .replace(/{TITLE}/g, title)
    .replace(/{DATE}/g, date);

  return {
    folder: config.folder,
    fileName,
    content,
    templateId: config.templateId,
  };
}

/**
 * Generate a non-conflicting filename by appending _2, _3, etc.
 */
export function resolveFileName(fileName: string, existingFiles: string[]): string {
  if (!existingFiles.includes(fileName)) return fileName;

  const base = fileName.replace(/\.md$/i, '');
  let counter = 2;
  while (existingFiles.includes(`${base}_${counter}.md`)) {
    counter++;
  }
  return `${base}_${counter}.md`;
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function kitFrontmatter(type: string, title: string): string {
  return [
    '---',
    `type: ${type}`,
    `title: ${JSON.stringify(title)}`,
    'status: draft',
    'priority: high',
    'owner: narrative',
    `updated: ${today()}`,
    'tags:',
    '  - game-dev',
    '  - narrative-production',
    '---',
    '',
  ].join('\n');
}

export function createNarrativeProductionKit(projectName = 'Game Project'): NarrativeProductionKitFile[] {
  const date = today();
  const project = projectName.trim() || 'Game Project';
  const files: NarrativeProductionKitFile[] = [];

  files.push({
    folder: '02_Worldbuilding',
    fileName: 'NarrativePipeline.md',
    openAfterCreate: true,
    content: `${kitFrontmatter('narrative-pipeline', 'Narrative Pipeline')}# 叙事制作管线

> 项目：${project}
> 生成日期：${date}
> 用途：把世界观、剧情、任务、台词、演出和 Unity 实现任务串成一条可执行链路。

## 1. 核心叙事目标
- 玩家最终要理解的世界真相：
- 玩家在前 30 分钟要感受到的情绪：
- 本阶段必须服务的玩法目标：
- 禁止破坏的设定/调性：

## 2. Canon 地图
| 层级 | 当前结论 | 关联文档 | 缺口 |
| --- | --- | --- | --- |
| 世界规则 | 待补 | [[WorldBible]] | 明确规则、代价、禁忌 |
| 主要冲突 | 待补 | [[PlotOutline]] | 明确阵营/角色动机 |
| 角色动机 | 待补 | [[NewCharacter]] | 补核心角色设定 |
| 任务链 | 待补 | [[NarrativeTaskTable]] | 关联 Quest 文档 |
| 台词风格 | 待补 | [[DialogueScript]] | 补角色声线 |
| 演出风格 | 待补 | [[PerformanceSheet]] | 补镜头/动画/VFX |

## 3. 世界规则 → 剧情节拍 → 实现任务
| 世界规则 | 剧情节拍 | 玩家行为 | 任务/台词/演出需求 | Unity 实现任务 | 验收标准 |
| --- | --- | --- | --- | --- | --- |
| 规则 A | 节拍 A | 玩家发现/选择/战斗 | 台词、镜头、任务目标 | [[NarrativeTaskTable]] | 玩家能理解因果且任务可完成 |

## 4. 章节/任务链
| 顺序 | 章节/任务 | 情绪目标 | 关键角色 | 场景 | 依赖文档 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | 待定 | 好奇/紧张/释然 | 待定 | 待定 | [[PlotOutline]] | todo |

## 5. AI 接管指令
把下面这段交给 AI，可以继续扩展整条叙事链：

\`\`\`text
请作为资深叙事总监接管本项目叙事流程。先读取 01_GDD/、02_Worldbuilding/、03_Characters/、06_Quests/、07_Unity_Tasks/，然后补全：
1. 世界规则和禁忌
2. 剧情大纲与章节节拍
3. 任务链与玩家选择
4. 台词脚本与角色声线
5. 演出表：镜头、动画、VFX、SFX、UI 提示
6. Unity 实现任务表和验收标准
请把所有输出写成 Markdown 文档，并使用精确 [[wiki-links]]。
\`\`\`

## 6. 制作人检查清单
- [ ] 每个剧情节拍都有明确世界规则支撑。
- [ ] 每个任务都有玩家目标、失败/中断处理和奖励。
- [ ] 每段关键台词都有说话人意图、潜台词和情绪。
- [ ] 每个演出节点都有触发条件、镜头、动画、音效、跳过处理。
- [ ] 每个叙事需求都落到了任务表，并有验收标准。
`,
  });

  files.push({
    folder: '02_Worldbuilding',
    fileName: 'WorldBible.md',
    content: `${kitFrontmatter('world-bible', 'World Bible')}# 世界观圣经

## 核心前提
- 世界一句话：
- 玩家身份：
- 中心矛盾：
- 不可违背的调性：

## 硬规则
| 规则 | 代价 | 谁知道 | 玩家如何发现 | 关联任务/剧情 |
| --- | --- | --- | --- | --- |
| 待补 | 待补 | 待补 | 待补 | [[NarrativePipeline]] |

## 地理与势力
| 地点/势力 | 资源 | 欲望 | 冲突 | 可产出的任务 |
| --- | --- | --- | --- | --- |
| 待补 | 待补 | 待补 | 待补 | 待补 |

## 时间线
| 时间 | 事件 | 后果 | 证据/物件 | 玩家可见程度 |
| --- | --- | --- | --- | --- |
| 过去 | 待补 | 待补 | 待补 | 低/中/高 |

## 禁忌、成本和例外
- 什么事情绝对不可能：
- 什么事情可以发生但代价很高：
- 什么事情只有少数角色知道：

## 开放问题
- [ ] 哪条世界规则最能驱动玩法？
- [ ] 哪个秘密适合作为中期反转？
- [ ] 哪些设定需要避免和现有 GDD 冲突？
`,
  });

  files.push({
    folder: '02_Worldbuilding',
    fileName: 'PlotOutline.md',
    content: `${kitFrontmatter('plot-outline', 'Plot Outline')}# 剧情大纲

## 故事承诺
- 玩家一开始相信：
- 中段被迫重新理解：
- 结局必须回答：

## 三幕/章节结构
| 阶段 | 剧情节拍 | 玩家目标 | 角色动机 | 世界规则 | 任务/演出需求 |
| --- | --- | --- | --- | --- | --- |
| 开端 | 待补 | 待补 | 待补 | [[WorldBible]] | [[NarrativeTaskTable]] |
| 对抗 | 待补 | 待补 | 待补 | [[WorldBible]] | [[PerformanceSheet]] |
| 结局 | 待补 | 待补 | 待补 | [[WorldBible]] | [[DialogueScript]] |

## 分支和失败态
- 玩家拒绝任务时：
- 玩家失败/死亡/中断时：
- 玩家提前发现真相时：

## 伏笔与回收
| 伏笔 | 首次出现 | 回收时机 | 玩家反馈 | 关联文档 |
| --- | --- | --- | --- | --- |
| 待补 | 待补 | 待补 | 待补 | [[NarrativePipeline]] |
`,
  });

  files.push({
    folder: '02_Worldbuilding',
    fileName: 'DialogueScript.md',
    content: `${kitFrontmatter('dialogue-script', 'Dialogue Script')}# 台词脚本

## 场景信息
- 场景/任务：
- 触发条件：
- 参与角色：
- 玩家当前目标：
- 关联剧情：[[PlotOutline]]

## 角色声线约束
| 角色 | 说话习惯 | 禁忌 | 情绪底色 | 参考文档 |
| --- | --- | --- | --- | --- |
| 待补 | 待补 | 待补 | 待补 | [[NewCharacter]] |

## 主线台词
| 行号 | 说话人 | 意图 | 情绪/表演 | 台词 | 条件 | 后续状态 |
| --- | --- | --- | --- | --- | --- | --- |
| D001 | 待补 | 推进信息 | 克制 | “待补” | 默认 | 进入下一句 |

## 玩家选择
| 选择 | 玩家语气 | NPC 反应 | 任务状态变化 | 后续演出 |
| --- | --- | --- | --- | --- |
| A | 待补 | 待补 | 待补 | [[PerformanceSheet]] |

## 本地化备注
- 是否有双关/专有名词：
- 哪些词必须统一：
- 哪些句子需要语音表演注意：
`,
  });

  files.push({
    folder: '02_Worldbuilding',
    fileName: 'PerformanceSheet.md',
    content: `${kitFrontmatter('performance-sheet', 'Performance Sheet')}# 演出表

## 场景概览
- 场景名：
- 触发条件：
- 可跳过：是/否
- 中断处理：
- 关联台词：[[DialogueScript]]
- 关联剧情：[[PlotOutline]]

## 演出节拍
| Beat | 触发 | 镜头/构图 | 角色动作 | 表情 | VFX | SFX/BGM | UI 提示 | 依赖 | 验收 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P001 | 待补 | 中景/特写/跟随 | 待补 | 待补 | 待补 | 待补 | 待补 | 待补 | 播放顺畅且玩家理解目标 |

## 边界情况
- 玩家快速点击：
- 玩家离开触发区：
- 战斗中触发：
- 联机/同步状态：

## 资产清单
| 资产 | 类型 | 负责人 | 优先级 | 任务表 |
| --- | --- | --- | --- | --- |
| 待补 | 动画/VFX/SFX/UI | 待补 | high | [[NarrativeTaskTable]] |
`,
  });

  files.push({
    folder: '07_Unity_Tasks',
    fileName: 'NarrativeTaskTable.md',
    content: `${kitFrontmatter('narrative-task-table', 'Narrative Task Table')}# 叙事实现任务表

> 这里的任务可以复制到团队时间表，或者让 AI 根据本表导入任务。

| ID | 类别 | 交付物 | 负责人/工种 | 优先级 | 依赖 | 关联文档 | 实现说明 | 验收标准 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NAR-001 | 世界观 | 补全核心规则和禁忌 | Narrative | high | GDD | [[WorldBible]] | 明确能/不能/代价 | 规则能支撑至少 3 个任务节拍 | todo |
| NAR-002 | 剧情 | 补全章节节拍 | Narrative | high | NAR-001 | [[PlotOutline]] | 每个节拍映射玩家行为 | 每个节拍有任务/台词/演出需求 | todo |
| NAR-003 | 台词 | 写关键场景台词 | Narrative | medium | NAR-002 | [[DialogueScript]] | 含情绪、潜台词、分支 | 可直接交给本地化/配音 | todo |
| NAR-004 | 演出 | 制作演出表 | Cinematic | medium | NAR-003 | [[PerformanceSheet]] | 镜头、动作、VFX、SFX、UI | 工程师能按表实现触发和播放 | todo |
| NAR-005 | Unity | 实现任务触发和状态流 | Engineer | high | NAR-002/NAR-004 | [[NarrativePipeline]] | Quest state + cutscene trigger | 测试能覆盖开始/完成/失败/中断 | todo |

## 导入团队时间表建议
- owner 可以填 Narrative / Cinematic / Engineer / Designer。
- priority 对应 high / medium / low。
- linkedDoc 使用上表的关联文档。
- acceptance criteria 放到交付物或备注里。
`,
  });

  files.push({
    folder: '02_Worldbuilding',
    fileName: 'NarrativeAudit.md',
    content: `${kitFrontmatter('narrative-audit', 'Narrative Audit')}# 叙事一致性巡检

## 巡检范围
- [[WorldBible]]
- [[PlotOutline]]
- [[DialogueScript]]
- [[PerformanceSheet]]
- [[NarrativeTaskTable]]

## 高风险问题
| 严重度 | 问题 | 影响 | 修复建议 | 负责人 | 状态 |
| --- | --- | --- | --- | --- | --- |
| high | 待补 | 待补 | 待补 | Narrative | todo |

## 缺失链路
| 上游 | 下游 | 缺失内容 | 处理动作 |
| --- | --- | --- | --- |
| 世界规则 | 剧情节拍 | 待补 | 补到 [[NarrativePipeline]] |
| 剧情节拍 | 台词 | 待补 | 补到 [[DialogueScript]] |
| 台词 | 演出 | 待补 | 补到 [[PerformanceSheet]] |
| 演出 | Unity 实现 | 待补 | 补到 [[NarrativeTaskTable]] |

## 明日复查
- [ ] 所有 high 风险是否降级或关闭。
- [ ] 新增剧情是否都能找到世界观依据。
- [ ] 新增台词是否有角色声线依据。
- [ ] 新增演出是否已经进入任务表。
`,
  });

  return files;
}
