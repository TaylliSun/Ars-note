export type WritingLanguage = 'zh' | 'en' | 'mixed' | 'unknown';

export interface HumanizedWritingSignal {
  id: string;
  label: string;
  count: number;
  penalty: number;
}

export interface HumanizedWritingAudit {
  language: WritingLanguage;
  score: number;
  passed: boolean;
  proseLength: number;
  signals: HumanizedWritingSignal[];
  issues: string[];
}

export interface HumanizationFidelityAudit {
  passed: boolean;
  score: number;
  sourceComplete: boolean;
  missingNumbers: string[];
  addedNumbers: string[];
  missingWikiLinks: string[];
  addedWikiLinks: string[];
  missingUrls: string[];
  addedUrls: string[];
  missingTaskIds: string[];
  addedTaskIds: string[];
  changedFrontmatter: boolean;
  changedCode: boolean;
  changedHeadingStructure: boolean;
  changedTableStructure: boolean;
  issues: string[];
}

function stripNonProse(markdown: string): string {
  let text = String(markdown || '');
  text = text.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, ' ');
  text = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ');
  text = text.replace(/^\s*\|.*\|\s*$/gm, ' ');
  text = text.replace(/`[^`]*`/g, ' ');
  text = text.replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1');
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, alias) => alias || target);
  return text.replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/[*_~>|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function countMatches(text: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return Array.from(text.matchAll(new RegExp(pattern.source, flags))).length;
}

export function detectWritingLanguage(markdown: string): WritingLanguage {
  const prose = stripNonProse(markdown);
  const zh = (prose.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const en = (prose.match(/[A-Za-z]/g) || []).length;
  if (zh < 12 && en < 24) return 'unknown';
  if (zh >= 12 && en >= 24 && Math.min(zh, en) / Math.max(zh, en) >= 0.22) return 'mixed';
  return zh > en * 0.32 ? 'zh' : 'en';
}

function sentenceOpenings(prose: string, language: WritingLanguage): string[] {
  const sentences = prose
    .split(language === 'zh' ? /[。！？!?]+/ : /[.!?]+(?:\s+|$)/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 12);
  return sentences.map((sentence) => {
    if (language === 'zh' || language === 'mixed') {
      return sentence.replace(/^[“”"'（(\s]+/, '').slice(0, 5);
    }
    return (sentence.toLowerCase().match(/[a-z]+/g) || []).slice(0, 3).join(' ');
  }).filter(Boolean);
}

function repeatedOpeningCount(prose: string, language: WritingLanguage): number {
  const openings = sentenceOpenings(prose, language);
  const counts = new Map<string, number>();
  for (const opening of openings) counts.set(opening, (counts.get(opening) || 0) + 1);
  return Array.from(counts.values()).reduce((sum, count) => sum + Math.max(0, count - 2), 0);
}

export function auditHumanizedWriting(markdown: string, minimumScore = 78): HumanizedWritingAudit {
  const prose = stripNonProse(markdown);
  const language = detectWritingLanguage(prose);
  const signals: HumanizedWritingSignal[] = [];

  const addSignal = (
    id: string,
    label: string,
    patternOrCount: RegExp | number,
    penaltyEach: number,
    allowance = 0,
    maxPenalty = 24,
  ) => {
    const count = typeof patternOrCount === 'number' ? patternOrCount : countMatches(prose, patternOrCount);
    const penalty = Math.min(maxPenalty, Math.max(0, count - allowance) * penaltyEach);
    if (penalty > 0) signals.push({ id, label, count, penalty });
  };

  addSignal(
    'chatbot-meta',
    'chatbot self-reference, offer-to-help, or generic closing language',
    /(?:作为(?:一个)?\s*AI|希望(?:以上|这些|本回答).{0,18}(?:帮助|有用)|如果你(?:还有|仍有|需要).{0,40}(?:告诉我|随时|继续)|as an AI|great question|I hope this helps|let me know if|feel free to)/gi,
    12,
    0,
    36,
  );
  addSignal(
    'zh-canned-transitions',
    'Chinese canned transitions used as a paragraph scaffold',
    /(?:首先|其次|再次|此外|与此同时|最后但同样重要|综上所述|总而言之|总的来说|值得注意的是|需要指出的是|不难发现|可以看出)[，,:：]?/g,
    4,
    2,
    24,
  );
  addSignal(
    'zh-inflated-language',
    'inflated Chinese marketing language without a concrete claim',
    /(?:赋能|打造(?:一个|出)?|全方位|多维度|深度赋能|极大(?:地)?(?:提升|增强|丰富)|显著(?:提升|增强|改善)|无缝衔接|沉浸式体验|独特魅力|丰富多样|保驾护航|注入(?:新的)?活力)/g,
    3,
    1,
    24,
  );
  addSignal(
    'zh-formulaic-pairs',
    'formulaic Chinese paired clauses such as not-only/but-also or through/thereby',
    /(?:不仅.{0,45}(?:而且|更|还)|既.{0,35}又|通过.{0,60}从而)/g,
    5,
    1,
    20,
  );
  addSignal(
    'zh-vague-outcomes',
    'vague player-value claims without observable behavior',
    /(?:提升玩家体验|增强游戏性|丰富游戏内容|提高可玩性|带来更好的体验|让玩家感受到更强的)/g,
    5,
    0,
    20,
  );
  addSignal(
    'en-canned-transitions',
    'English canned transitions or generic conclusion markers',
    /(?:\bAdditionally\b|\bMoreover\b|\bFurthermore\b|\bIt is (?:important|worth) to note\b|\bIn conclusion\b|\bUltimately\b|\bOverall\b)/gi,
    4,
    2,
    24,
  );
  addSignal(
    'en-inflated-language',
    'inflated English model or press-release vocabulary',
    /\b(?:pivotal|groundbreaking|transformative|robust|seamless|comprehensive|meticulous|vibrant|tapestry|delve|realm|paramount|boasts|underscores)\b/gi,
    3,
    2,
    24,
  );
  addSignal(
    'en-formulaic-pairs',
    'formulaic English paired clauses',
    /\bnot only\b.{0,80}\bbut also\b|\bby (?:doing|using|leveraging)\b.{0,90}\b(?:thereby|ensures? that)\b/gi,
    5,
    0,
    20,
  );
  addSignal(
    'en-vague-outcomes',
    'vague English player-value claims without observable behavior',
    /\b(?:enhance the player experience|create an engaging experience|improve overall gameplay|deliver a seamless experience|provide a rich and immersive experience)\b/gi,
    6,
    0,
    24,
  );
  addSignal(
    'repeated-openings',
    'several sentences begin with the same mechanical pattern',
    repeatedOpeningCount(prose, language),
    4,
    0,
    16,
  );

  const penalty = signals.reduce((sum, signal) => sum + signal.penalty, 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const passed = score >= minimumScore || (prose.length < 160 && penalty <= 4);
  return {
    language,
    score,
    passed,
    proseLength: prose.length,
    signals,
    issues: signals.map((signal) => `${signal.label} (${signal.count})`),
  };
}

export function formatHumanizationGateFailure(audit: HumanizedWritingAudit, minimumScore = 78): string {
  return [
    `Humanized-writing quality gate blocked this write (naturalness ${audit.score}/100; required ${minimumScore}).`,
    `Detected: ${audit.issues.join('; ') || 'repetitive model-like prose'}.`,
    'Rewrite at paragraph level rather than swapping synonyms. Keep the facts and document structure, but use a specific team-author voice, concrete subjects and verbs, varied sentence rhythm, and direct evidence-to-decision reasoning.',
    audit.language === 'zh'
      ? 'For Chinese, remove canned transitions, slogan-like four-character phrases, translation-shaped clauses, and empty claims such as “提升玩家体验”.'
      : 'For English, remove canned transitions, nominalized or inflated claims, symmetric list patterns, and generic wrap-up language.',
  ].join(' ');
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function missingValues(source: string[], target: string[]): string[] {
  const targetSet = new Set(target);
  return source.filter((value) => !targetSet.has(value));
}

function extractFrontmatter(markdown: string): string {
  const match = String(markdown || '').match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match ? match[1].replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim() : '';
}

function extractFencedCode(markdown: string): string[] {
  const matches = String(markdown || '').match(/(?:```+|~~~+)[^\n]*\r?\n[\s\S]*?(?:```+|~~~+)/g) || [];
  return uniqueSorted(matches.map((value) => value.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim()));
}

function extractInlineCode(markdown: string): string[] {
  const withoutFences = String(markdown || '').replace(/(?:```+|~~~+)[^\n]*\r?\n[\s\S]*?(?:```+|~~~+)/g, ' ');
  return uniqueSorted(Array.from(withoutFences.matchAll(/`([^`\r\n]+)`/g), (match) => match[1]));
}

function extractNumericFacts(markdown: string): string[] {
  const prepared = String(markdown || '')
    .replace(/^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ' ')
    .replace(/(?:```+|~~~+)[^\n]*\r?\n[\s\S]*?(?:```+|~~~+)/g, ' ')
    .replace(/`[^`\r\n]+`/g, ' ')
    .replace(/\[\[[^\]]+\]\]/g, ' ')
    .replace(/!?\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/https?:\/\/[^\s)>\]}]+/g, ' ')
    .replace(/\b[A-Z][A-Z0-9]{1,11}-\d{1,7}\b/g, ' ')
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\s{0,3}#{1,6}\s+\d+(?:\.\d+)*(?:[.)、])?\s*/, '')
      .replace(/^\s*\d+[.)、]\s+/, '')
      .replace(/^\s*\|\s*\d+\s*\|/, '| # |'))
    .join('\n');
  const pattern = /(?:^|[^\p{L}\p{N}_])([-+]?\d+(?:,\d{3})*(?:\.\d+)?(?:\s*(?:%|％|px|ms|fps|hz|kb|mb|gb|tb|b|s|min|h|d|秒|分钟|小时|天|帧|级|个|次|元|米|厘米|毫米))?)/giu;
  return uniqueSorted(Array.from(prepared.matchAll(pattern), (match) => match[1].replace(/\s+/g, '').toLowerCase()));
}

function extractWikiLinks(markdown: string): string[] {
  return uniqueSorted(Array.from(String(markdown || '').matchAll(/\[\[[^\]]+\]\]/g), (match) => match[0]));
}

function extractUrls(markdown: string): string[] {
  const text = String(markdown || '');
  const markdownUrls = Array.from(text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g), (match) => match[1]);
  const bareUrls = Array.from(text.matchAll(/https?:\/\/[^\s)>\]}]+/g), (match) => match[0].replace(/[.,;:!?，。；：！？]+$/, ''));
  return uniqueSorted([...markdownUrls, ...bareUrls]);
}

function extractTaskIds(markdown: string): string[] {
  return uniqueSorted(Array.from(String(markdown || '').matchAll(/\b[A-Z][A-Z0-9]{1,11}-\d{1,7}\b/g), (match) => match[0]));
}

function extractHeadingStructure(markdown: string): string[] {
  return Array.from(String(markdown || '').matchAll(/^\s{0,3}(#{1,6})\s+/gm), (match) => String(match[1].length));
}

function tableColumnCount(line: string): number {
  let separators = 0;
  let escaped = false;
  for (const char of line) {
    if (char === '\\' && !escaped) {
      escaped = true;
      continue;
    }
    if (char === '|' && !escaped) separators += 1;
    escaped = false;
  }
  return Math.max(0, separators - (line.trim().startsWith('|') ? 1 : 0) - (line.trim().endsWith('|') ? 1 : 0) + 1);
}

function extractTableStructure(markdown: string): string[] {
  return String(markdown || '')
    .split(/\r?\n/)
    .filter((line) => /^\s*\|.*\|\s*$/.test(line))
    .map((line) => String(tableColumnCount(line)));
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function auditHumanizationFidelity(sourceMarkdown: string, rewrittenMarkdown: string): HumanizationFidelityAudit {
  const source = String(sourceMarkdown || '');
  const target = String(rewrittenMarkdown || '');
  const sourceComplete = !/\.\.\. \(truncated, file is too large\)\s*$/i.test(source);

  const sourceNumbers = extractNumericFacts(source);
  const targetNumbers = extractNumericFacts(target);
  const sourceWikiLinks = extractWikiLinks(source);
  const targetWikiLinks = extractWikiLinks(target);
  const sourceUrls = extractUrls(source);
  const targetUrls = extractUrls(target);
  const sourceTaskIds = extractTaskIds(source);
  const targetTaskIds = extractTaskIds(target);

  const missingNumbers = missingValues(sourceNumbers, targetNumbers);
  const addedNumbers = missingValues(targetNumbers, sourceNumbers);
  const missingWikiLinks = missingValues(sourceWikiLinks, targetWikiLinks);
  const addedWikiLinks = missingValues(targetWikiLinks, sourceWikiLinks);
  const missingUrls = missingValues(sourceUrls, targetUrls);
  const addedUrls = missingValues(targetUrls, sourceUrls);
  const missingTaskIds = missingValues(sourceTaskIds, targetTaskIds);
  const addedTaskIds = missingValues(targetTaskIds, sourceTaskIds);
  const changedFrontmatter = extractFrontmatter(source) !== extractFrontmatter(target);
  const changedCode = !arraysEqual(extractFencedCode(source), extractFencedCode(target))
    || !arraysEqual(extractInlineCode(source), extractInlineCode(target));
  const changedHeadingStructure = !arraysEqual(extractHeadingStructure(source), extractHeadingStructure(target));
  const changedTableStructure = !arraysEqual(extractTableStructure(source), extractTableStructure(target));

  const issues: string[] = [];
  if (!sourceComplete) issues.push('the source read was truncated, so full-document fidelity cannot be verified');
  if (missingNumbers.length) issues.push(`removed numeric facts: ${missingNumbers.slice(0, 8).join(', ')}`);
  if (addedNumbers.length) issues.push(`invented numeric facts: ${addedNumbers.slice(0, 8).join(', ')}`);
  if (missingWikiLinks.length) issues.push(`removed wiki-links: ${missingWikiLinks.slice(0, 5).join(', ')}`);
  if (addedWikiLinks.length) issues.push(`invented wiki-links: ${addedWikiLinks.slice(0, 5).join(', ')}`);
  if (missingUrls.length) issues.push(`removed URLs: ${missingUrls.slice(0, 5).join(', ')}`);
  if (addedUrls.length) issues.push(`invented URLs: ${addedUrls.slice(0, 5).join(', ')}`);
  if (missingTaskIds.length) issues.push(`removed task IDs: ${missingTaskIds.slice(0, 8).join(', ')}`);
  if (addedTaskIds.length) issues.push(`invented task IDs: ${addedTaskIds.slice(0, 8).join(', ')}`);
  if (changedFrontmatter) issues.push('frontmatter changed');
  if (changedCode) issues.push('fenced or inline code changed');
  if (changedHeadingStructure) issues.push('heading levels or section structure changed');
  if (changedTableStructure) issues.push('table row or column structure changed');

  const score = Math.max(0, 100
    - (!sourceComplete ? 40 : 0)
    - Math.min(24, (missingNumbers.length + addedNumbers.length) * 6)
    - Math.min(24, (missingWikiLinks.length + addedWikiLinks.length + missingUrls.length + addedUrls.length) * 8)
    - Math.min(20, (missingTaskIds.length + addedTaskIds.length) * 8)
    - (changedFrontmatter ? 18 : 0)
    - (changedCode ? 18 : 0)
    - (changedHeadingStructure ? 10 : 0)
    - (changedTableStructure ? 12 : 0));

  return {
    passed: sourceComplete && issues.length === 0,
    score,
    sourceComplete,
    missingNumbers,
    addedNumbers,
    missingWikiLinks,
    addedWikiLinks,
    missingUrls,
    addedUrls,
    missingTaskIds,
    addedTaskIds,
    changedFrontmatter,
    changedCode,
    changedHeadingStructure,
    changedTableStructure,
    issues,
  };
}

export function formatHumanizationFidelityFailure(audit: HumanizationFidelityAudit): string {
  return [
    `Humanization fidelity gate blocked this write (source fidelity ${audit.score}/100).`,
    `Detected: ${audit.issues.join('; ') || 'the rewrite no longer matches the protected source contract'}.`,
    'Return to the source and rewrite only its prose. Restore every number and unit, wiki-link, URL, task ID, frontmatter field, code fragment, heading level, and table shape exactly; do not add facts that were not in the source.',
  ].join(' ');
}

export function autoHumanizeMarkdownContent(content: string): { content: string; changed: boolean; count: number } {
  const lines = String(content || '').split(/\r?\n/);
  let count = 0;
  let inFence = false;
  let fenceMarker = '';
  let inFrontmatter = lines[0]?.trim() === '---';
  let frontmatterClosed = !inFrontmatter;

  const protectSegments = (line: string) => {
    const protectedSegments: string[] = [];
    const text = line.replace(/(`[^`]*`|\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\))/g, (match) => {
      const token = `@@ARSNOTE_PROTECTED_${protectedSegments.length}@@`;
      protectedSegments.push(match);
      return token;
    });
    return {
      text,
      restore: (value: string) => value.replace(/@@ARSNOTE_PROTECTED_(\d+)@@/g, (_match, index) => protectedSegments[Number(index)] || _match),
    };
  };

  const replaceTracked = (value: string, pattern: RegExp, replacement: string | ((match: string, ...args: any[]) => string)) => value.replace(pattern, (...args) => {
    count += 1;
    const match = args[0];
    return typeof replacement === 'function' ? replacement(match, ...args.slice(1)) : replacement;
  });

  const cleanupLine = (line: string) => {
    const protectedLine = protectSegments(line);
    let next = protectedLine.text;
    next = replaceTracked(next, /^\s*(?:Great question!?|As an AI(?: language model)?[,，]?|It is (?:important|worth) to note that\s*)/gi, '');
    next = replaceTracked(next, /^\s*(?:Additionally|Moreover|Furthermore|In conclusion|Ultimately|Overall)[,:]\s*/gi, '');
    next = replaceTracked(next, /\bI hope this helps!?\s*/gi, '');
    next = replaceTracked(next, /\bLet me know if[^.。!！?？]*(?:[.。!！?？]|$)/gi, '');
    next = replaceTracked(next, /\bIn order to\b/gi, 'To');
    next = replaceTracked(next, /\bdue to the fact that\b/gi, 'because');
    next = replaceTracked(next, /\bat this point in time\b/gi, 'now');
    next = replaceTracked(next, /\butili[sz]e\b/gi, 'use');
    next = replaceTracked(next, /^\s*(?:值得注意的是|需要指出的是|不难发现|可以看出|综上所述|总而言之|总的来说)[，,:：\s]*/g, '');
    next = replaceTracked(next, /希望(?:以上|这些|本回答).{0,18}(?:能对你有所帮助|对你有帮助|有所帮助)[。.!！]?\s*$/g, '');
    next = replaceTracked(next, /如果你(?:还有|仍有|需要).{0,40}(?:告诉我|随时联系|可以继续)[。.!！]?\s*$/g, '');
    next = next.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.!?;:，。！？；：])/g, '$1').replace(/^\s+|\s+$/g, '');
    return protectedLine.restore(next);
  };

  const nextLines = lines.map((line, index) => {
    const trimmed = line.trim();
    if (inFrontmatter) {
      if (index > 0 && trimmed === '---') {
        inFrontmatter = false;
        frontmatterClosed = true;
      }
      return line;
    }
    if (!frontmatterClosed && trimmed === '---') {
      inFrontmatter = true;
      return line;
    }
    const fenceStart = trimmed.match(/^(```+|~~~+)/);
    if (fenceStart) {
      const marker = fenceStart[1].slice(0, 3);
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = '';
      }
      return line;
    }
    if (inFence || !trimmed || /^\|.*\|$/.test(trimmed) || /^\s{0,3}#{1,6}\s+/.test(line)) return line;
    return cleanupLine(line);
  });

  const nextContent = nextLines.join(content.includes('\r\n') ? '\r\n' : '\n');
  return { content: nextContent, changed: nextContent !== content, count };
}
