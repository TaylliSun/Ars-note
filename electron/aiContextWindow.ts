export const AI_RUNTIME_CONTEXT_TOKEN_LIMIT = 120_000;

export interface AIContextWindowUsage {
  limitTokens: number;
  usedTokens: number;
  availableTokens: number;
  usedPercent: number;
  messageCount: number;
  compressed: boolean;
  compressionNotes: string[];
}

export type AIContextMessage = {
  role: string;
  content?: string;
  tool_calls?: unknown;
  tool_call_id?: string;
  [key: string]: unknown;
};

export function estimateAIContextTokens(text: string): number {
  const value = String(text || '');
  if (!value) return 0;
  const cjk = value.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length || 0;
  return Math.max(1, Math.ceil(cjk * 0.85 + Math.max(0, value.length - cjk) / 4));
}

function measure(
  messages: AIContextMessage[],
  limitTokens: number,
  compressed: boolean,
  compressionNotes: string[],
): AIContextWindowUsage {
  const usedTokens = messages.reduce((sum, message) => (
    sum
    + estimateAIContextTokens(message.role)
    + estimateAIContextTokens(message.content || '')
    + 8
  ), 0);
  return {
    limitTokens,
    usedTokens,
    availableTokens: Math.max(0, limitTokens - usedTokens),
    usedPercent: Math.min(100, (usedTokens / limitTokens) * 100),
    messageCount: messages.length,
    compressed,
    compressionNotes,
  };
}

function truncateMiddle(text: string, maxChars: number, label: string): string {
  const value = String(text || '');
  if (value.length <= maxChars) return value;
  const safeLimit = Math.max(300, maxChars);
  const head = Math.floor(safeLimit * 0.58);
  const tail = Math.floor(safeLimit * 0.34);
  return `${value.slice(0, head).trimEnd()}\n\n...[${label}: ${value.length - head - tail} chars omitted]...\n\n${value.slice(-tail).trimStart()}`;
}

function compactHistoricalMessage(message: AIContextMessage): AIContextMessage {
  const content = String(message.content || '');
  if (content.length <= 1800) return message;
  const lines = content.split(/\r?\n/);
  const evidenceLines = lines.filter(line => (
    /(?:^|\s)(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.\-\u3400-\u9fff]+\.(?:md|json|canvas|excalidraw)\b/.test(line)
    || /(?:决定|改为|改成|结论|约束|风险|待办|必须|不要|完成|失败|decision|constraint|risk|todo|must|changed|created|updated)/i.test(line)
  )).slice(0, 12);
  const compact = [
    truncateMiddle(content, 1100, 'older turn compressed'),
    evidenceLines.length > 0 ? `\n[Preserved evidence]\n${evidenceLines.join('\n')}` : '',
  ].filter(Boolean).join('\n');
  return { ...message, content: compact };
}

function collapseOlderMessages(messages: AIContextMessage[]): AIContextMessage[] {
  const recent = messages.slice(-8);
  const older = messages.slice(1, -8);
  const preservedEvidence = older
    .flatMap(message => String(message.content || '').split(/\r?\n/))
    .filter(line => (
      /(?:^|\s)(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.\-\u3400-\u9fff]+\.(?:md|json|canvas|excalidraw)\b/.test(line)
      || /(?:decision|constraint|risk|todo|must|changed|created|updated)/i.test(line)
    ))
    .slice(0, 40);
  return [
    messages[0],
    {
      role: 'system',
      content: [
        `[${older.length} older messages were collapsed to keep the request within its context budget.]`,
        preservedEvidence.length > 0 ? '[Preserved evidence]' : '',
        ...preservedEvidence,
      ].filter(Boolean).join('\n'),
    },
    ...recent,
  ];
}

export function fitAIContextWindow(
  sourceMessages: AIContextMessage[],
  limitTokens = AI_RUNTIME_CONTEXT_TOKEN_LIMIT,
): { messages: AIContextMessage[]; usage: AIContextWindowUsage } {
  let messages: AIContextMessage[] = sourceMessages.map(message => ({ ...message, content: String(message.content || '') }));
  const notes: string[] = [];
  let usage = measure(messages, limitTokens, false, notes);
  if (usage.usedTokens <= limitTokens) return { messages, usage };

  const recentStart = Math.max(1, messages.length - 12);
  messages = messages.map((message, index) => (
    index > 0 && index < recentStart ? compactHistoricalMessage(message) : message
  ));
  notes.push('Compacted older conversation and tool-result messages while preserving recent turns.');
  usage = measure(messages, limitTokens, true, notes);
  if (usage.usedTokens <= limitTokens) return { messages, usage };

  messages = messages.map((message, index) => {
    if (index === 0 || index >= messages.length - 6) return message;
    return { ...message, content: truncateMiddle(String(message.content || ''), 5000, 'historical message trimmed') };
  });
  notes.push('Trimmed oversized historical messages.');
  usage = measure(messages, limitTokens, true, notes);
  if (usage.usedTokens <= limitTokens) return { messages, usage };

  const lastIndex = messages.length - 1;
  const fixedTokens = measure(messages.slice(0, lastIndex), limitTokens, true, notes).usedTokens;
  const latestBudgetChars = Math.max(8000, Math.floor((limitTokens - fixedTokens - 6000) * 2.4));
  messages[lastIndex] = {
    ...messages[lastIndex],
    content: truncateMiddle(String(messages[lastIndex].content || ''), latestBudgetChars, 'current workspace context trimmed'),
  };
  notes.push('Trimmed oversized current workspace context while preserving the beginning and latest user request.');
  usage = measure(messages, limitTokens, true, notes);
  if (usage.usedTokens <= limitTokens) return { messages, usage };

  const systemBudgetChars = Math.max(16000, Math.floor(limitTokens * 1.8));
  messages[0] = {
    ...messages[0],
    content: truncateMiddle(String(messages[0].content || ''), systemBudgetChars, 'system and retrieved context trimmed'),
  };
  notes.push('Trimmed the middle of system/retrieved context while preserving instructions at both ends.');
  usage = measure(messages, limitTokens, true, notes);

  if (usage.usedTokens > limitTokens && messages.length > 80) {
    messages = collapseOlderMessages(messages);
    notes.push('Collapsed very long multi-turn history into one evidence summary.');
    usage = measure(messages, limitTokens, true, notes);
  }

  if (usage.usedTokens > limitTokens) {
    const lastIndex = messages.length - 1;
    for (let pass = 0; pass < 120 && usage.usedTokens > limitTokens; pass += 1) {
      const candidates = messages
        .map((message, index) => {
          const content = String(message.content || '');
          const minimumChars = index === 0 ? 8000 : index === lastIndex ? 4000 : 500;
          return {
            index,
            content,
            minimumChars,
            reducibleChars: Math.max(0, content.length - minimumChars),
            tokens: estimateAIContextTokens(content),
          };
        })
        .filter(candidate => candidate.reducibleChars > 0)
        .sort((left, right) => {
          const leftPriority = left.index > 0 && left.index < lastIndex ? 2 : left.index === 0 ? 1 : 0;
          const rightPriority = right.index > 0 && right.index < lastIndex ? 2 : right.index === 0 ? 1 : 0;
          return rightPriority - leftPriority || right.tokens - left.tokens;
        });
      const candidate = candidates[0];
      if (!candidate) break;
      const excessTokens = usage.usedTokens - limitTokens;
      const reductionChars = Math.max(300, Math.ceil(excessTokens * 1.4));
      const nextChars = Math.max(candidate.minimumChars, candidate.content.length - reductionChars);
      messages[candidate.index] = {
        ...messages[candidate.index],
        content: truncateMiddle(candidate.content, nextChars, 'hard context budget compression'),
      };
      usage = measure(messages, limitTokens, true, notes);
    }
    notes.push('Applied final token-budget compression to the largest remaining context blocks.');
    usage = measure(messages, limitTokens, true, notes);
  }

  if (usage.usedTokens > limitTokens && messages.length > 10) {
    messages = collapseOlderMessages(messages);
    notes.push('Collapsed very long multi-turn history into one evidence summary.');
    usage = measure(messages, limitTokens, true, notes);
  }

  if (usage.usedTokens > limitTokens) {
    const lastIndex = messages.length - 1;
    const perMessageChars = Math.max(600, Math.floor((limitTokens * 0.9) / Math.max(1, messages.length)));
    messages = messages.map((message, index) => ({
      ...message,
      content: truncateMiddle(
        String(message.content || ''),
        index === lastIndex ? Math.max(2000, perMessageChars) : perMessageChars,
        'final context limit',
      ),
    }));
    notes.push('Applied absolute final context limit.');
    usage = measure(messages, limitTokens, true, notes);
  }
  return { messages, usage };
}
