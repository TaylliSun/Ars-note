const test = require('node:test');
const assert = require('node:assert/strict');

const { splitSearchHighlight } = require('../dist-test/src/utils/searchHighlight.js');

test('search highlighting preserves untrusted snippets as plain text parts', () => {
  const snippet = '<img src=x onerror=alert(1)> unsafe';
  const parts = splitSearchHighlight(snippet, 'onerror');

  assert.equal(parts.map((part) => part.text).join(''), snippet);
  assert.deepEqual(parts.filter((part) => part.highlighted).map((part) => part.text), ['onerror']);
  assert.equal(parts.some((part) => Object.hasOwn(part, 'html')), false);
});

test('search highlighting treats regular-expression characters literally', () => {
  const parts = splitSearchHighlight('Use [draft].md, then [DRAFT].md.', '[draft].md');

  assert.equal(parts.map((part) => part.text).join(''), 'Use [draft].md, then [DRAFT].md.');
  assert.equal(parts.filter((part) => part.highlighted).length, 2);
});

test('empty queries return one unchanged plain-text segment', () => {
  assert.deepEqual(splitSearchHighlight('unchanged', '   '), [
    { text: 'unchanged', highlighted: false },
  ]);
});
