const test = require('node:test');
const assert = require('node:assert/strict');
const {
  addMarkdownTableColumn,
  addMarkdownTableRow,
  applyMarkdownTableCellEdit,
  getMarkdownTableAlignments,
  getMarkdownTableCellSpans,
  normalizeEditableTableCellInput,
  splitMarkdownTableRow,
} = require('../dist-test/src/utils/markdownTableModel.js');
const {
  normalizeCompressedMarkdownTablesInText,
} = require('../dist-test/src/utils/markdownTableRepair.js');
const { renderMarkdown } = require('../dist-test/src/utils/markdownRenderer.js');

test('Compressed one-line Markdown tables are repaired into stable source lines', () => {
  const source = '| 等级 | 莲花 | |--|--| | Lv.1 | 2 朵 | | Lv.5 | 5 朵 |';
  const repaired = normalizeCompressedMarkdownTablesInText(source);
  assert.equal(repaired.split('\n').length, 4);
  assert.match(repaired, /^\| 等级 \| 莲花 \|/);
  assert.match(repaired, /\| --- \| --- \|/);
});

test('Table parsing ignores wiki-link pipes and preserves escaped pipes', () => {
  assert.deepEqual(splitMarkdownTableRow('| 文档 | [[GDD|游戏设计]] |'), ['文档', '[[GDD|游戏设计]]']);
  assert.deepEqual(splitMarkdownTableRow('| 公式 | A\\|B |'), ['公式', 'A|B']);
});

test('Chinese composition input is committed to one source line', () => {
  const input = '莲花\nLv.5\u00a0盛开';
  assert.equal(normalizeEditableTableCellInput(input), '莲花 Lv.5 盛开');

  const source = '| 等级 | 表现 |';
  const edited = applyMarkdownTableCellEdit(source, 2, 1, input);
  assert.equal(edited, '| 等级 | 莲花 Lv.5 盛开 |');
  assert.equal(edited.split('\n').length, 1);
});

test('Cell spans map to the exact visible cells without a one-line offset', () => {
  const source = '| 模块 | 负责人 | 状态 |';
  const spans = getMarkdownTableCellSpans(source, 3);
  assert.equal(source.slice(spans[0].from, spans[0].to), '模块');
  assert.equal(source.slice(spans[1].from, spans[1].to), '负责人');
  assert.equal(source.slice(spans[2].from, spans[2].to), '状态');
});

test('Adding rows and columns preserves table row boundaries and alignments', () => {
  const rows = ['| 名称 | 数量 |', '| :--- | ---: |', '| 莲花 | 2 |'];
  assert.deepEqual(getMarkdownTableAlignments(rows[1], 2), ['left', 'right']);

  const withColumn = addMarkdownTableColumn(rows);
  assert.equal(withColumn.length, rows.length);
  assert.deepEqual(splitMarkdownTableRow(withColumn[1]), [':---', '---:', '---']);

  const withRow = addMarkdownTableRow(withColumn);
  assert.equal(withRow.length, rows.length + 1);
  assert.deepEqual(splitMarkdownTableRow(withRow.at(-1)), ['', '', '']);
});

test('Preview renderer groups callouts and renders repaired tables instead of raw pipes', () => {
  const markdown = '> [!info] 验收\n> 表格和代码块需要正常显示。\n\n| A | B | |--|--| | 1 | 2 |';
  const html = renderMarkdown(markdown);
  assert.match(html, /class="md-callout/);
  assert.match(html, /<table(?:\s|>)/);
  assert.doesNotMatch(html, /\|--\|/);
});
