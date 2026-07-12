import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CloseIcon, SearchIcon } from './icons/ArsIcons';

type ShortcutEntry = {
  group: string;
  label: string;
  description: string;
  keys: string[];
};

interface ShortcutGuideProps {
  onClose: () => void;
}

const SHORTCUTS: ShortcutEntry[] = [
  { group: '快速访问', label: '快速打开文件', description: '搜索 Vault 中的笔记、画布和原型', keys: ['Ctrl', 'O'] },
  { group: '快速访问', label: '打开命令面板', description: '搜索并执行 Ars-note 的全部命令', keys: ['Ctrl', 'P'] },
  { group: '快速访问', label: '打开快捷键指南', description: '随时查看当前可用快捷键', keys: ['Ctrl', '/'] },
  { group: '笔记编辑', label: '保存当前笔记', description: '立即保存当前编辑内容', keys: ['Ctrl', 'S'] },
  { group: '笔记编辑', label: '关闭当前标签页', description: '关闭当前文件标签页', keys: ['Ctrl', 'W'] },
  { group: '笔记编辑', label: '重新打开关闭的标签页', description: '恢复最近关闭的标签页', keys: ['Ctrl', 'Shift', 'T'] },
  { group: '导航', label: '返回上一个文件', description: '沿浏览历史后退', keys: ['Alt', '←'] },
  { group: '导航', label: '前进到下一个文件', description: '沿浏览历史前进', keys: ['Alt', '→'] },
  { group: '导航', label: '切换到下一个标签页', description: '循环切换当前打开的文件', keys: ['Ctrl', 'Tab'] },
  { group: '导航', label: '切换到上一个标签页', description: '反向循环切换当前打开的文件', keys: ['Ctrl', 'Shift', 'Tab'] },
  { group: '导航', label: '按序号切换标签页', description: 'Ctrl+9 会跳到最后一个标签页', keys: ['Ctrl', '1–9'] },
  { group: '界面', label: '切换专注模式', description: '隐藏干扰区域，专注当前内容', keys: ['Ctrl', 'Shift', 'F'] },
  { group: '弹窗与面板', label: '关闭当前弹窗', description: '关闭命令面板、指南或确认窗口', keys: ['Esc'] },
  { group: '命令面板', label: '切换文件 / 命令模式', description: '在快速打开和命令搜索之间切换', keys: ['Tab'] },
  { group: '命令面板', label: '清理最近记录', description: '清除快速切换器的最近文件与命令', keys: ['Ctrl', 'Backspace'] },
];

export default function ShortcutGuide({ onClose }: ShortcutGuideProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const groups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = normalized
      ? SHORTCUTS.filter((item) => `${item.group} ${item.label} ${item.description} ${item.keys.join(' ')}`.toLowerCase().includes(normalized))
      : SHORTCUTS;
    return filtered.reduce<Array<{ name: string; items: ShortcutEntry[] }>>((result, item) => {
      const existing = result.find((group) => group.name === item.group);
      if (existing) existing.items.push(item);
      else result.push({ name: item.group, items: [item] });
      return result;
    }, []);
  }, [query]);

  return (
    <div className="shortcut-guide-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="shortcut-guide-dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <header className="shortcut-guide-header">
          <div>
            <span className="shortcut-guide-eyebrow">ARS-NOTE COMMANDS</span>
            <h2>键盘快捷键</h2>
            <p>更少移动鼠标，更快进入你的工作流。</p>
          </div>
          <button className="shortcut-guide-close" type="button" onClick={onClose} aria-label="Close keyboard shortcuts">
            <CloseIcon size={15} />
          </button>
        </header>

        <label className="shortcut-guide-search">
          <SearchIcon size={15} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索命令或快捷键..."
          />
          <span>{SHORTCUTS.length} commands</span>
        </label>

        <div className="shortcut-guide-content">
          {groups.length === 0 && (
            <div className="shortcut-guide-empty">
              <strong>没有匹配的快捷键</strong>
              <span>换一个命令名称或按键试试。</span>
            </div>
          )}
          {groups.map((group) => (
            <section className="shortcut-guide-group" key={group.name}>
              <h3>{group.name}</h3>
              <div className="shortcut-guide-list">
                {group.items.map((item) => (
                  <div className="shortcut-guide-item" key={`${group.name}-${item.label}`}>
                    <span className="shortcut-guide-copy">
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                    <span className="shortcut-guide-keys" aria-label={item.keys.join(' plus ')}>
                      {item.keys.map((key) => <kbd key={key}>{key}</kbd>)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer className="shortcut-guide-footer">
          <span>命令面板还可以搜索更多功能</span>
          <span><kbd>Ctrl</kbd><kbd>P</kbd></span>
        </footer>
      </section>
    </div>
  );
}
