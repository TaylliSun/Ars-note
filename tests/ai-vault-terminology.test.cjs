const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseVaultTerminologyPaths,
  planVaultTermRefactor,
  searchVaultText,
} = require('../dist-electron/aiVaultTerminology.js');

function withVault(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ars-note-terminology-'));
  try {
    fs.mkdirSync(path.join(root, '01_GDD'), { recursive: true });
    fs.mkdirSync(path.join(root, '04_Maps'), { recursive: true });
    fs.mkdirSync(path.join(root, '.ars-note'), { recursive: true });
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('vault text search reports all Markdown hits with line and code-block context', () => withVault((root) => {
  fs.writeFileSync(
    path.join(root, '01_GDD', 'GDD.md'),
    '# GDD\n装饰系统改版。\n\n```txt\n旧装饰字段\n```\n',
    'utf8',
  );
  fs.writeFileSync(path.join(root, '04_Maps', 'Island.md'), '岛屿装饰提供反馈。\n', 'utf8');
  fs.writeFileSync(path.join(root, '.ars-note', 'hidden.md'), '装饰不应被搜索。\n', 'utf8');

  const result = searchVaultText(root, '装饰');
  assert.equal(result.fileCount, 2);
  assert.equal(result.matchCount, 3);
  assert.equal(result.matches.length, 3);
  assert.equal(result.matches.filter(match => match.inCodeBlock).length, 1);
  assert.ok(result.matches.every(match => match.line > 0 && match.column > 0));
}));

test('terminology refactor handles same-length CJK terms and preserves fenced code by default', () => withVault((root) => {
  const gddPath = path.join(root, '01_GDD', 'GDD.md');
  const mapPath = path.join(root, '04_Maps', 'Island.md');
  fs.writeFileSync(gddPath, '# GDD\n装饰系统与装饰槽。\n\n```json\n{"type":"装饰"}\n```\n', 'utf8');
  fs.writeFileSync(mapPath, '此处只有灵纹。\n', 'utf8');

  const plan = planVaultTermRefactor(root, {
    from: '装饰',
    to: '灵纹',
    paths: ['01_GDD/GDD.md', '04_Maps/Island.md'],
  });

  assert.equal(plan.changed.length, 1);
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.replacementCount, 2);
  assert.equal(plan.preservedCodeBlockMatches, 1);
  assert.match(plan.changed[0].after, /灵纹系统与灵纹槽/);
  assert.match(plan.changed[0].after, /"type":"装饰"/);
}));

test('terminology path parsing accepts JSON and rejects non-Markdown or escaping paths', () => {
  assert.deepEqual(
    parseVaultTerminologyPaths('["01_GDD/GDD.md","../outside.md","image.png","01_GDD/GDD.md"]'),
    ['01_GDD/GDD.md'],
  );
});
