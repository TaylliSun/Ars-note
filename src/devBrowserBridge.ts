import type { ArsNoteAPI, FileNode, VaultIndex, VaultOpenResult } from './types';

const DEMO_VAULT_PATH = 'C:\\Ars-note\\DemoVault';

const demoFiles = new Map<string, string>([
  [
    `${DEMO_VAULT_PATH}\\00_Index.md`,
    `# 示例游戏项目

> [!info] 今日制作焦点
> 完成莲池岛核心循环、数值验收和任务交接。

## 当前进度

| 模块 | 负责人 | 状态 | 下一步 |
| --- | --- | --- | --- |
| 莲池岛核心循环 | 系统策划 | 进行中 | 验证产出节奏 |
| 灵气经济 | 数值策划 | 待验收 | 补充三档参数 |
| 新手任务 | 关卡策划 | 已完成 | 交给 QA |

## 核心循环

\`\`\`text
放置岛屿 -> 岛屿产出灵气 -> 收集灵气 -> 解锁新岛屿
    ↻ 调整位置 -> 触发五行组合 -> 提升效率 -> 扩张灵境
\`\`\`

## 本周任务

- [x] 明确首日目标
- [ ] 完成 Lv.1-Lv.5 数值曲线
- [ ] 检查任务引导与 UI 文案
`,
  ],
  [
    `${DEMO_VAULT_PATH}\\01_GDD\\GDD.md`,
    `# 游戏设计文档

## 设计目标

让玩家在轻量放置中持续获得布置、发现与成长的满足感。

## 玩家体验

玩家每次调整岛屿，都能看到组合关系、资源效率和世界外观产生清晰变化。
`,
  ],
  [
    `${DEMO_VAULT_PATH}\\02_Worldbuilding\\WorldOverview.md`,
    `# 世界观总览

灵境由漂浮岛屿组成。灵气沿五行关系流动，玩家通过修复岛屿逐步恢复世界秩序。
`,
  ],
  [
    `${DEMO_VAULT_PATH}\\04_Maps\\LotusPondIsland.md`,
    `# 莲池岛

## 等级表现

| 等级 | 池水面 | 莲花 | 石桥 | 水雾 |
| --- | --- | --- | --- | --- |
| Lv.1 | 简单圆形水池 | 2 朵 | 无 | 淡蓝薄雾 |
| Lv.3 | 水面扩大 | 3 朵 | 小石桥 | 水雾增多 |
| Lv.5 | 水面最大并出现水纹 | 5 朵盛开 | 完整石桥 | 浓密水雾 |
`,
  ],
]);

const toFileNode = (relativePath: string): FileNode => {
  const absolutePath = `${DEMO_VAULT_PATH}\\${relativePath}`;
  return {
    name: relativePath.split('\\').pop() || relativePath,
    path: absolutePath,
    isDir: false,
    children: [],
  };
};

const demoTree: FileNode[] = [
  toFileNode('00_Index.md'),
  {
    name: '01_GDD',
    path: `${DEMO_VAULT_PATH}\\01_GDD`,
    isDir: true,
    children: [toFileNode('01_GDD\\GDD.md')],
  },
  {
    name: '02_Worldbuilding',
    path: `${DEMO_VAULT_PATH}\\02_Worldbuilding`,
    isDir: true,
    children: [toFileNode('02_Worldbuilding\\WorldOverview.md')],
  },
  {
    name: '04_Maps',
    path: `${DEMO_VAULT_PATH}\\04_Maps`,
    isDir: true,
    children: [toFileNode('04_Maps\\LotusPondIsland.md')],
  },
];

const demoVault: VaultOpenResult = {
  path: DEMO_VAULT_PATH,
  name: 'DemoVault',
  config: {
    appName: 'Ars-note',
    vaultId: 'browser-ui-demo',
    name: 'DemoVault',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    appVersion: 'dev',
  },
};

const normalizeDemoPath = (value: string) => value.replace(/\//g, '\\');

const demoIndex: VaultIndex = {
  notes: Object.fromEntries([...demoFiles.keys()].map((filePath) => {
    const relativePath = filePath.slice(DEMO_VAULT_PATH.length + 1);
    const fileName = relativePath.split('\\').pop() || relativePath;
    const title = demoFiles.get(filePath)?.match(/^#\s+(.+)$/m)?.[1] || fileName.replace(/\.md$/i, '');
    return [relativePath.replace(/\\/g, '/'), {
      filePath,
      relativePath: relativePath.replace(/\\/g, '/'),
      fileName,
      title,
      tags: [],
      wikiLinks: [],
    }];
  })),
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const demoAIConversation = [
  {
    role: 'user',
    content: '整理莲池岛的美术规格，并给出验收重点。',
    createdAt: '2026-07-10T10:20:00.000Z',
  },
  {
    role: 'assistant',
    content: `## 莲池岛美术规格

| 项目 | 规格 | 验收重点 |
| --- | --- | --- |
| 主体画布 | 256 × 256 PNG-24 | 边缘干净，无杂色 |
| 莲花层级 | Lv.1 / Lv.3 / Lv.5 | 轮廓和色阶可辨识 |
| 水雾特效 | 低、中、高三档 | 不遮挡交互区域 |

> [!info] 交付建议
> 保留源文件、导出文件和 Unity 预制体命名的一致性。

下一步先完成 **Lv.1 基础版**，通过构图验收后再扩展高等级表现。`,
    createdAt: '2026-07-10T10:20:08.000Z',
  },
];

function genericDemoResult(method: string): unknown {
  if (method.startsWith('list') || method.startsWith('aiList')) return [];
  if (method.includes('Status') || method.includes('Config')) return null;
  if (method.startsWith('scan')) return { count: 0, totalSize: 0, files: [] };
  return { ok: true };
}

export function installDevBrowserBridge(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined' || (window as any).arsnote) return;

  const bridge: Partial<ArsNoteAPI> = {
    getRecentVaults: async () => [DEMO_VAULT_PATH],
    openVault: async () => demoVault,
    readFileTree: async () => demoTree,
    readFile: async (filePath) => demoFiles.get(normalizeDemoPath(filePath)) || '# Untitled',
    writeFile: async (filePath, content) => { demoFiles.set(normalizeDemoPath(filePath), content); },
    joinPath: async (...segments) => segments.filter(Boolean).join('\\').replace(/\\+/g, '\\'),
    basename: async (filePath) => normalizeDemoPath(filePath).split('\\').pop() || filePath,
    dirname: async (filePath) => normalizeDemoPath(filePath).split('\\').slice(0, -1).join('\\'),
    scanVaultIndex: async () => demoIndex,
    getAppVersion: async () => 'dev',
    getAIRuntimeStatus: async () => ({
      provider: 'openai-compatible',
      baseUrl: '',
      model: '',
      hasApiKey: false,
      hasConfig: false,
    }),
    aiGetMemoryStatus: async () => ({
      memorySize: 0,
      memoryCap: 12000,
      userSize: 0,
      historyCount: 0,
      needsConsolidation: false,
    }),
    aiReadMemory: async () => '',
    aiReadSoul: async () => '',
    aiReadUser: async () => '',
    aiListConversations: async () => [{ file: 'demo-conversation.json', date: '2026-07-10T10:20:00.000Z', messageCount: demoAIConversation.length }],
    aiLoadConversation: async () => demoAIConversation,
    aiLoadLatestConversation: async () => demoAIConversation,
    listVaultBackups: async () => [],
    loadSyncConfig: async () => null as any,
    liveSyncLoadConfig: async () => null,
    liveSyncStatus: async () => null,
    windowIsMaximized: async () => ({ ok: true, maximized: false }),
    windowMinimize: async () => ({ ok: true }),
    windowMaximize: async () => ({ ok: true, maximized: false }),
    windowClose: async () => ({ ok: true }),
  };

  (window as any).arsnote = new Proxy(bridge, {
    get(target, property: string | symbol) {
      if (typeof property !== 'string') return Reflect.get(target, property);
      const existing = (target as Record<string, unknown>)[property];
      if (existing) return existing;
      if (property.startsWith('on')) return () => () => undefined;
      return async () => genericDemoResult(property);
    },
  }) as ArsNoteAPI;
}

installDevBrowserBridge();
