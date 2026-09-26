// Пробы метки версии: по странице должно быть видно, какой коммит выложен.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { openPage, ROOT } = require('./helpers');

const SHA = '0123456789abcdef0123456789abcdef01234567';

// то, что сделает Jekyll на Pages: срежет шапку и подставит значения
function renderLikePages(sha) {
  const src = fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8');
  const m = src.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  assert.ok(m, 'version.json без шапки --- ... --- : Jekyll его не обработает');
  return m[1]
    .replace(/\{\{\s*site\.github\.build_revision\s*\}\}/g, sha)
    .replace(/\{\{\s*site\.time \| date_to_xmlschema\s*\}\}/g, '2026-09-26T12:00:00+00:00');
}

test('version.json после подстановки — правильный JSON с коммитом', () => {
  const out = renderLikePages(SHA);
  assert.doesNotMatch(out, /\{\{|\{%/, 'осталась неподставленная переменная');
  assert.strictEqual(JSON.parse(out).sha, SHA);
});

test('шапка показывает выложенный коммит (#ver)', async () => {
  const s = await openPage({ files: { 'version.json': renderLikePages(SHA) } });
  try {
    await s.page.waitForFunction(() => document.getElementById('ver').dataset.sha, null, { timeout: 5000 });
    assert.match(await s.page.textContent('#ver'), /· 0123456$/);
    assert.strictEqual(await s.page.getAttribute('#ver', 'data-sha'), SHA);
    assert.deepStrictEqual(s.errors, []);
  } finally { await s.close(); }
});

test('без Jekyll (сырой шаблон) — шапка не ломается и не врёт', async () => {
  const raw = fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8');
  const s = await openPage({ files: { 'version.json': raw } });
  try {
    await s.page.waitForFunction(() => document.getElementById('ver').dataset.sha, null, { timeout: 5000 });
    assert.strictEqual(await s.page.getAttribute('#ver', 'data-sha'), 'unknown');
    assert.doesNotMatch(await s.page.textContent('#ver'), /\{|·\s*$/);
  } finally { await s.close(); }
});

// GitHub Pages прогоняет через Liquid все файлы с шапкой --- и ВСЕ .md
// (даже без шапки). Случайные {{ / {% там = кривая страница или
// упавшая сборка = выкладка не прошла. И index.html без шапки: иначе
// Liquid полезет в JS.
test('Jekyll не споткнётся: нет Liquid-мусора в .md и шапки в index.html', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(!html.startsWith('---'), 'index.html с шапкой --- : Liquid испортит JS');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.name.startsWith('.') || e.name.startsWith('_') || e.name === 'node_modules' ? []
      : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(ROOT).filter(f => f.endsWith('.md'))) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /\{\{|\{%/, f + ': Liquid-скобки');
  }
});
