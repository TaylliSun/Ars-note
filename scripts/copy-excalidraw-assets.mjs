import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptsDir, '..');
const sourceDir = path.join(
  rootDir,
  'node_modules',
  '@excalidraw',
  'excalidraw',
  'dist',
  'excalidraw-assets',
);
const targetDir = path.join(rootDir, 'public', 'dist', 'excalidraw-assets');

if (!existsSync(sourceDir)) {
  throw new Error(`Missing Excalidraw assets: ${sourceDir}. Run npm install first.`);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(path.dirname(targetDir), { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });
console.log(`Copied Excalidraw assets to ${path.relative(rootDir, targetDir)}.`);
