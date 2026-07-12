import React from 'react';
import type { AIContextUsage } from '../types';

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 2)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(Math.max(0, Math.round(value)));
}

export default function AIContextMeter({ usage, compact = false }: { usage: AIContextUsage; compact?: boolean }) {
  const percent = Math.min(100, Math.max(0, usage.usedPercent || 0));
  const color = percent >= 90 ? '#ef4444' : percent >= 75 ? '#f59e0b' : 'var(--accent)';
  const title = [
    `Request context usage: ${formatTokenCount(usage.usedTokens)} / ${formatTokenCount(usage.limitTokens)} tokens (${Math.round(percent)}%)`,
    `Available: ${formatTokenCount(usage.availableTokens)} tokens`,
    `Messages in request: ${usage.messageCount}`,
    usage.compressed ? 'Auto compression: on' : 'Auto compression: standby',
    ...(usage.compressionNotes || []),
  ].filter(Boolean).join('\n');

  return (
    <div
      className={'ai-context-meter' + (compact ? ' ai-context-meter-compact' : '') + (usage.compressed ? ' ai-context-meter-compressed' : '')}
      title={title}
      style={{
        '--ai-context-percent': `${percent}%`,
        '--ai-context-color': color,
      } as React.CSSProperties}
      aria-label={title}
    >
      <div className="ai-context-meter-ring">
        <span>{Math.round(percent)}%</span>
      </div>
      {!compact && (
        <div className="ai-context-meter-copy">
          <strong>{formatTokenCount(usage.usedTokens)}</strong>
          <small>{usage.compressed ? 'auto-compressed' : 'request context'}</small>
        </div>
      )}
    </div>
  );
}
