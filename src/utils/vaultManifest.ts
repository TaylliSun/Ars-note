/* ── Vault manifest utilities ── */
/* v0.4.0 — Local manifest for future sync prep */

import type { VaultManifest, VaultFileManifestEntry } from '../types';

/**
 * Classify a vault file by its extension/path into a type category.
 */
export function classifyVaultFile(relativePath: string): 'markdown' | 'asset' | 'config' | 'other' {
  const lower = relativePath.toLowerCase();
  const fileName = lower.split('/').pop() ?? lower.split('\\').pop() ?? '';

  /* Config files inside .ars-note */
  if (lower.includes('.ars-note/')) {
    return 'config';
  }

  /* Markdown */
  if (fileName.endsWith('.md')) {
    return 'markdown';
  }

  /* Common asset types */
  if (/\.(png|jpg|jpeg|gif|svg|webp|bmp|ico|tiff|tif)$/i.test(fileName)) return 'asset';
  if (/\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(fileName)) return 'asset';
  if (/\.(mp4|webm|avi|mov|mkv)$/i.test(fileName)) return 'asset';
  if (/\.(ttf|otf|woff|woff2|eot)$/i.test(fileName)) return 'asset';
  if (/\.(json|yaml|yml|toml|xml)$/i.test(fileName)) return 'asset';

  /* Everything else */
  return 'other';
}

/**
 * Format byte count into human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(i, units.length - 1);
  const val = bytes / Math.pow(k, idx);
  return val.toFixed(idx === 0 ? 0 : 1) + ' ' + units[idx];
}

/**
 * Build a short summary string from a manifest for display.
 */
export function buildManifestSummary(manifest: VaultManifest): string {
  const md = manifest.files.filter((f) => f.type === 'markdown' && !f.deleted).length;
  const assets = manifest.files.filter((f) => f.type === 'asset' && !f.deleted).length;
  const configs = manifest.files.filter((f) => f.type === 'config' && !f.deleted).length;
  const others = manifest.files.filter((f) => f.type === 'other' && !f.deleted).length;
  return [
    `${manifest.fileCount} files`,
    `${formatBytes(manifest.totalSize)}`,
    `${md} md, ${assets} assets, ${configs} config, ${others} other`,
  ].join(' · ');
}
