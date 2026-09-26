// Пробы главного сценария: переключил ноду в Clash → IP сменился →
// страница сама начала новый замер и переоткрыла соединения.
const test = require('node:test');
const assert = require('node:assert');
const { openPage } = require('./helpers');

test('смена IP (два опроса подряд) → новый замер и перезапуск потоков', async () => {
  const s = await openPage();
  try {
    const { page } = s;
    await page.waitForFunction(() => currentIP === '1.1.1.1', null, { timeout: 5000 });
    await page.click('#btn-start');
    await page.evaluate(() => { curSeg.startT -= 13000; });   // замер №1 уже старше 12с
    s.state.ip = { ip: '2.2.2.2', country: 'Netherlands', country_code: 'NL', city: 'Amsterdam', connection: { org: 'Node-B' } };
    await page.waitForFunction(() => segCounter === 2, null, { timeout: 12000 });
    const log = await page.textContent('#log');
    assert.match(log, /IP изменился: 1\.1\.1\.1 → 2\.2\.2\.2/);
    assert.match(log, /перезапуск потоков — IP сменился/);
    assert.match(await page.textContent('#segs'), /№2 🇳🇱 Netherlands · 2\.2\.2\.2/);
    assert.deepStrictEqual(s.errors, []);
  } finally { await s.close(); }
});

test('один «чужой» ответ IP-сервиса не считается сменой ноды', async () => {
  const s = await openPage();
  try {
    const { page } = s;
    await page.click('#btn-start');
    const r = await page.evaluate(() => {
      metronome.onmessage = null;    // опросы IP сами по себе не мешают пробе
      curSeg.startT -= 13000;
      const base = { country: 'X', org: '', city: '', flag: '' };
      handleIpResult(Object.assign({ ip: '1.1.1.1' }, base));
      handleIpResult(Object.assign({ ip: '9.9.9.9' }, base));   // разовый выброс
      handleIpResult(Object.assign({ ip: '1.1.1.1' }, base));
      return { segCounter, currentIP };
    });
    assert.deepStrictEqual(r, { segCounter: 1, currentIP: '1.1.1.1' });
  } finally { await s.close(); }
});
