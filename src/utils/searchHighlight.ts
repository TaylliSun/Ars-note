export interface SearchHighlightPart {
  text: string;
  highlighted: boolean;
}

export function splitSearchHighlight(text: string, query: string): SearchHighlightPart[] {
  const source = String(text || '');
  if (!source) return [];

  const needle = String(query || '').trim();
  if (!needle) return [{ text: source, highlighted: false }];

  const sourceKey = source.toLocaleLowerCase();
  const needleKey = needle.toLocaleLowerCase();
  const parts: SearchHighlightPart[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const matchIndex = sourceKey.indexOf(needleKey, cursor);
    if (matchIndex < 0) break;
    if (matchIndex > cursor) {
      parts.push({ text: source.slice(cursor, matchIndex), highlighted: false });
    }
    const matchEnd = matchIndex + needle.length;
    parts.push({ text: source.slice(matchIndex, matchEnd), highlighted: true });
    cursor = matchEnd;
  }

  if (cursor < source.length) {
    parts.push({ text: source.slice(cursor), highlighted: false });
  }

  return parts.length ? parts : [{ text: source, highlighted: false }];
}
