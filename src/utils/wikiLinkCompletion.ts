/**
 * CodeMirror 6 completions for Wiki-links ([[file]]) and Tags (#tag).
 */
import { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';

/**
 * Create a wiki-link completion source that suggests .md files from the vault.
 * Usage: pass `wikiLinkCompletion(files)` into Editor extensions.
 */
export function wikiLinkSource(files: string[]): (context: CompletionContext) => CompletionResult | null {
  return (context: CompletionContext): CompletionResult | null => {
    // Look for [[ before cursor
    const textBefore = context.matchBefore(/\[\[[^\]]*$/);
    if (!textBefore || textBefore.from === textBefore.to) return null;

    const query = textBefore.text.slice(2).toLowerCase(); // remove [[
    const start = textBefore.from;

    const options: Completion[] = files
      .filter(f => {
        const name = f.toLowerCase();
        const base = f.split('/').pop()!.replace(/\.md$/, '').toLowerCase();
        return base.includes(query) || name.includes(query);
      })
      .slice(0, 30)
      .map(f => {
        const display = f.replace(/\.md$/, '');
        const base = f.split('/').pop()!.replace(/\.md$/, '');
        return {
          label: display,
          detail: f.includes('/') ? f.split('/').slice(0, -1).join('/') : undefined,
          apply: display + ']]',
          type: 'file',
          boost: base.startsWith(query) ? 2 : 0,
        };
      });

    if (options.length === 0) return null;

    return {
      from: start + 2,
      options,
      validFor: /[^\]]*/,
      filter: true,
    };
  };
}

/**
 * Create a tag completion source that suggests existing tags.
 */
export function tagCompletionSource(tags: string[]): (context: CompletionContext) => CompletionResult | null {
  return (context: CompletionContext): CompletionResult | null => {
    // Match #tag at start of line or after whitespace/punctuation
    const textBefore = context.matchBefore(/(?:^|[\s:,(\[])(#[\w一-鿿/-]*)$/);
    if (!textBefore) return null;

    const hashPart = textBefore.text;
    const hashIdx = hashPart.indexOf('#');
    if (hashIdx === -1) return null;

    const query = hashPart.slice(hashIdx + 1).toLowerCase();
    const start = textBefore.from + hashIdx;

    const options: Completion[] = tags
      .filter(tag => tag.toLowerCase().includes(query))
      .slice(0, 20)
      .map(tag => ({
        label: '#' + tag,
        apply: '#' + tag,
        type: 'keyword',
        detail: 'tag',
      }));

    if (options.length === 0) return null;

    return {
      from: start,
      options,
      validFor: /#[\w一-鿿/-]*/,
      filter: true,
    };
  };
}
