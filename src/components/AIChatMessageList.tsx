import React, { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AIChatMessage } from '../types';
import { renderMarkdown } from '../utils/markdownRenderer';
import {
  AI_CHAT_CENTER_WINDOW_SIZE,
  AI_CHAT_COMPACT_WINDOW_SIZE,
  AI_CHAT_WINDOW_STEP,
  getAIChatWindow,
  getAIConversationIdentity,
  isAIChatNearBottom,
} from '../utils/aiChatPresentation';

type AIChatMessageVariant = 'center' | 'compact';

interface AIChatMessageItemProps {
  absoluteIndex: number;
  message: AIChatMessage;
  variant: AIChatMessageVariant;
}

interface AIChatMessageListProps {
  messages: AIChatMessage[];
  variant: AIChatMessageVariant;
  emptyTitle: string;
  emptyHint: string;
  locale?: 'en' | 'zh';
  showEmpty?: boolean;
  windowSize?: number;
}

interface MessageWindowState {
  conversationIdentity: string;
  visibleCount: number;
}

function isErrorMessage(message: AIChatMessage): boolean {
  if (message.role !== 'assistant') return false;
  const content = message.content.toLowerCase();
  return content.startsWith('error') || content.includes('failed to');
}

const AIChatMessageItem = memo(function AIChatMessageItem({
  absoluteIndex,
  message,
  variant,
}: AIChatMessageItemProps) {
  const renderedMarkdown = useMemo(
    () => variant === 'center' && message.role === 'assistant' ? renderMarkdown(message.content) : '',
    [message.content, message.role, variant],
  );
  const resultLimit = variant === 'center' ? 200 : 180;

  return (
    <div
      className={
        `ai-message ai-message-${message.role}`
        + (isErrorMessage(message) ? ' ai-message-error' : '')
      }
      data-message-index={absoluteIndex}
    >
      <div className="ai-message-header">
        <span className={`ai-message-role ${message.role}`}>{message.role === 'user' ? 'You' : 'AI'}</span>
        <span className="ai-message-meta">{(message.createdAt || '').replace('T', ' ').substring(0, 19)}</span>
      </div>

      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="ai-tool-calls">
          <div
            className="ai-tool-calls-header"
            onClick={variant === 'center' ? (event) => {
              event.currentTarget.parentElement?.classList.toggle('collapsed');
            } : undefined}
          >
            {variant === 'center' && <span className="ai-tool-calls-icon">{'▶'}</span>}
            <span>{`Tools (${message.toolCalls.length})`}</span>
          </div>
          <div className="ai-tool-calls-body">
            {message.toolCalls.map((toolCall, toolIndex) => (
              <div key={`${toolCall.name}-${toolIndex}`} className={`ai-tool-card ai-tool-card-${toolCall.status}`}>
                <div className="ai-tool-card-header">
                  <span className="ai-tool-status-dot" />
                  <span className="ai-tool-name">{toolCall.name}</span>
                  <span className="ai-tool-status-label">
                    {toolCall.status === 'done' ? (variant === 'center' ? '✓' : '完成') : toolCall.status === 'error' ? 'Error' : '...'}
                  </span>
                </div>
                {variant === 'center' && toolCall.args && (
                  <div className="ai-tool-card-args">
                    {Object.entries(toolCall.args).map(([key, value]) => (
                      <div key={key} className="ai-tool-arg">
                        <span className="ai-tool-arg-key">{key}:</span>{' '}
                        <span className="ai-tool-arg-val">
                          {typeof value === 'string' && value.length > 120 ? `${value.slice(0, 120)}...` : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {toolCall.artifacts && toolCall.artifacts.length > 0 && (
                  <div className="ai-artifact-list">
                    {toolCall.artifacts.map((artifact, artifactIndex) => (
                      <div key={`${artifact.path}-${artifactIndex}`} className={`ai-artifact-card ai-artifact-${artifact.type}`}>
                        <div className="ai-artifact-top">
                          <span className="ai-artifact-kind">{artifact.type}</span>
                          <span className={`ai-artifact-quality ai-artifact-quality-${artifact.qualityStatus}`}>
                            {artifact.qualityStatus === 'auto_fixed' ? '已自动修复' : artifact.qualityStatus === 'checked' ? '已检查' : '已记录'}
                          </span>
                        </div>
                        <div className="ai-artifact-path">{artifact.path}</div>
                        {artifact.notes && artifact.notes.length > 0 && (
                          <div className="ai-artifact-notes">
                            {artifact.notes.slice(0, 2).map((note, noteIndex) => <div key={noteIndex}>{note}</div>)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {toolCall.result && (
                  <div className="ai-tool-card-result">
                    {toolCall.result.length > resultLimit ? `${toolCall.result.slice(0, resultLimit)}...` : toolCall.result}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {variant === 'center' && message.role === 'assistant' ? (
        <div
          className="ai-message-content ai-message-markdown markdown-preview-body"
          dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
        />
      ) : (
        <div className="ai-message-content">{message.content}</div>
      )}
    </div>
  );
});

const AIChatMessageList = memo(function AIChatMessageList({
  messages,
  variant,
  emptyTitle,
  emptyHint,
  locale = 'zh',
  showEmpty = true,
  windowSize,
}: AIChatMessageListProps) {
  const initialWindowSize = windowSize
    || (variant === 'center' ? AI_CHAT_CENTER_WINDOW_SIZE : AI_CHAT_COMPACT_WINDOW_SIZE);
  const conversationIdentity = getAIConversationIdentity(messages);
  const [windowState, setWindowState] = useState<MessageWindowState>(() => ({
    conversationIdentity,
    visibleCount: initialWindowSize,
  }));
  const visibleCount = windowState.conversationIdentity === conversationIdentity
    ? windowState.visibleCount
    : initialWindowSize;
  const messageWindow = useMemo(
    () => getAIChatWindow(messages, visibleCount),
    [messages, visibleCount],
  );

  if (messages.length === 0) {
    if (!showEmpty) return null;
    return (
      <div className="ai-chat-empty">
        <div className="ai-chat-empty-icon">{'['}</div>
        <div className="ai-chat-empty-text">{emptyTitle}</div>
        <div className="ai-chat-empty-hint">{emptyHint}</div>
      </div>
    );
  }

  const revealCount = Math.min(AI_CHAT_WINDOW_STEP, messageWindow.hiddenCount);
  return (
    <>
      {messageWindow.hiddenCount > 0 && (
        <button
          type="button"
          className="ai-chat-load-older"
          onClick={() => setWindowState({
            conversationIdentity,
            visibleCount: Math.min(messages.length, visibleCount + AI_CHAT_WINDOW_STEP),
          })}
        >
          <span>{locale === 'zh' ? `显示更早的 ${revealCount} 条消息` : `Show ${revealCount} earlier messages`}</span>
          <small>{locale === 'zh' ? `还有 ${messageWindow.hiddenCount} 条较早记录` : `${messageWindow.hiddenCount} earlier messages hidden`}</small>
        </button>
      )}
      {messageWindow.visibleItems.map((message, index) => {
        const absoluteIndex = messageWindow.startIndex + index;
        return (
          <AIChatMessageItem
            key={`${message.createdAt || 'message'}-${absoluteIndex}`}
            absoluteIndex={absoluteIndex}
            message={message}
            variant={variant}
          />
        );
      })}
    </>
  );
});

export function useAIChatAutoScroll(
  containerRef: React.RefObject<HTMLDivElement>,
  enabled: boolean,
  updateToken: string,
): void {
  const stickToLatestRef = useRef(true);
  const wasEnabledRef = useRef(false);

  React.useEffect(() => {
    if (!enabled) return;
    const target = containerRef.current;
    if (!target) return;

    const handleScroll = () => {
      stickToLatestRef.current = isAIChatNearBottom(target);
    };
    target.addEventListener('scroll', handleScroll, { passive: true });
    return () => target.removeEventListener('scroll', handleScroll);
  }, [containerRef, enabled]);

  useLayoutEffect(() => {
    if (!enabled) {
      wasEnabledRef.current = false;
      return;
    }

    const target = containerRef.current;
    if (!target) return;
    if (!wasEnabledRef.current) stickToLatestRef.current = true;
    wasEnabledRef.current = true;
    if (!stickToLatestRef.current) return;

    let secondFrame = 0;
    const scrollToLatest = () => {
      if (stickToLatestRef.current) target.scrollTop = target.scrollHeight;
    };
    const firstFrame = window.requestAnimationFrame(() => {
      scrollToLatest();
      secondFrame = window.requestAnimationFrame(scrollToLatest);
    });
    const settleTimer = window.setTimeout(scrollToLatest, 120);

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(settleTimer);
    };
  }, [containerRef, enabled, updateToken]);
}

export default AIChatMessageList;
