import type { AIChatMessage } from '../types';

export const AI_CHAT_CENTER_WINDOW_SIZE = 24;
export const AI_CHAT_COMPACT_WINDOW_SIZE = 18;
export const AI_CHAT_WINDOW_STEP = 24;
export const AI_CHAT_BOTTOM_THRESHOLD_PX = 96;

export interface AIChatWindow<T> {
  hiddenCount: number;
  startIndex: number;
  visibleItems: T[];
}

export interface AIChatScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

export function getAIChatWindow<T>(items: T[], requestedCount: number): AIChatWindow<T> {
  const safeCount = Number.isFinite(requestedCount)
    ? Math.max(1, Math.floor(requestedCount))
    : 1;
  const startIndex = Math.max(0, items.length - safeCount);
  return {
    hiddenCount: startIndex,
    startIndex,
    visibleItems: items.slice(startIndex),
  };
}

function messageFingerprint(message: AIChatMessage | undefined): string {
  if (!message) return '-';
  const content = message.content || '';
  return [
    message.role,
    message.createdAt || '',
    content.length,
    content.slice(0, 32),
    content.slice(-32),
    message.toolCalls?.length || 0,
  ].join('|');
}

export function getAIConversationIdentity(messages: AIChatMessage[]): string {
  return messages.length > 0 ? messageFingerprint(messages[0]) : 'empty';
}

export function getAIChatScrollToken(messages: AIChatMessage[], extra = ''): string {
  return [
    messages.length,
    messageFingerprint(messages[0]),
    messageFingerprint(messages[messages.length - 1]),
    extra,
  ].join('::');
}

export function isAIChatNearBottom(
  metrics: AIChatScrollMetrics,
  threshold = AI_CHAT_BOTTOM_THRESHOLD_PX,
): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold;
}
