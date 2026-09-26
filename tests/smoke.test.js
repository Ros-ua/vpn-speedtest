// Дымовая проба: страница открывается без ошибок, Старт даёт скорость,
// Стоп останавливает. Ловит «сломал JS одной опечаткой — страница мёртвая».
const test = require('node:test');
const assert = require('node:assert');
const { openPage } = require('./helpers');

test('страница грузится, старт меряет, стоп останавливает', async () => {
  const s = await openPage();
  try {
    const { page, errors } = s;
    await page.waitForFunction(() => document.getElementById('ip-addr').textContent === '1.1.1.1', null, { timeout: 5000 });
    await page.click('#btn-start');
    await page.waitForFunction(() => parseFloat(document.getElementById('speed-value').textContent) > 1, null, { timeout: 10000 });
    assert.match(await page.textContent('#segs'), /№1/);
    await page.click('#btn-stop');
    assert.strictEqual(await page.textContent('#status-text'), 'остановлен');
    assert.deepStrictEqual(errors, []);
  } finally { await s.close(); }
});
