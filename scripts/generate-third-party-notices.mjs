#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const packages = lock && typeof lock.packages === 'object' ? lock.packages : {};
const rows = [];
const seen = new Set();

function packageNameFromLockPath(lockPath) {
  const marker = 'node_modules/';
  const index = lockPath.lastIndexOf(marker);
  if (index < 0) return '';
  const suffix = lockPath.slice(index + marker.length);
  if (suffix.startsWith('@')) return suffix.split('/').slice(0, 2).join('/');
  return suffix.split('/')[0];
}

for (const [lockPath, metadata] of Object.entries(packages)) {
  if (!lockPath || !lockPath.includes('node_modules/') || metadata?.dev === true) continue;
  const name = metadata?.name || packageNameFromLockPath(lockPath);
  const version = metadata?.version || '';
  if (!name || !version) continue;
  const key = `${name}@${version}`;
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push({
    name,
    version,
    license: typeof metadata?.license === 'string' ? metadata.license : '未在 package-lock 中声明',
  });
}

rows.sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));

const lines = [
  '# 第三方软件声明',
  '',
  '本文件根据发布构建所使用的 `package-lock.json` 自动生成。各组件仍受其原始许可证约束；完整许可证文本以组件发行包中的 LICENSE/NOTICE 文件为准。',
  '',
  `生成时间：${new Date().toISOString()}`,
  '',
  '| 组件 | 版本 | 许可证标识 |',
  '|---|---:|---|',
  ...rows.map((row) => `| ${row.name.replaceAll('|', '\\|')} | ${row.version} | ${row.license.replaceAll('|', '\\|')} |`),
  '',
  `共 ${rows.length} 个生产依赖组件。`,
  '',
];

fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'), 'utf8');
console.log(`Generated THIRD_PARTY_NOTICES.md with ${rows.length} production dependencies.`);
