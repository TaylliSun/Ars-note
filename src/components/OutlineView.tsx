import React, { useMemo } from 'react';

export interface HeadingItem {
  level: number;
  text: string;
  line: number;  // 1-based line number
}

interface Props {
  content: string;
  onJumpToLine?: (line: number) => void;
}

export function parseHeadings(content: string): HeadingItem[] {
  const headings: HeadingItem[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        line: i + 1,
      });
    }
  }
  return headings;
}

const OutlineView: React.FC<Props> = ({ content, onJumpToLine }) => {
  const headings = useMemo(() => parseHeadings(content), [content]);

  if (headings.length === 0) {
    return (
      <div className="outline-empty" style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
        No headings in this note
      </div>
    );
  }

  return (
    <div className="outline-view">
      {headings.map((h, i) => (
        <button
          key={i}
          className="outline-item"
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: `4px ${4 + (h.level - 1) * 12}px`,
            background: 'transparent',
            border: 'none',
            color: h.level === 1 ? 'var(--text-main)' : 'var(--text-secondary)',
            fontSize: h.level === 1 ? 13 : 12,
            fontWeight: h.level <= 2 ? 600 : 400,
            cursor: 'pointer',
            borderRadius: 4,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: 1.6,
          }}
          title={`Line ${h.line}: ${h.text}`}
          onClick={() => onJumpToLine?.(h.line)}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          {h.text}
        </button>
      ))}
    </div>
  );
};

export default OutlineView;
