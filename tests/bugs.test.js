// Пробы на найденные ошибки. Каждая была КРАСНОЙ на коде до починки.
const test = require('node:test');
const assert = require('node:assert');
const { openPage } = require('./helpers');

// Ошибка 1: время байтов считалось через Date.now() воркера минус сдвиг,
// снятый ОДИН раз при загрузке. Системные часы (Date) могут прыгнуть —
// синхронизация времени, сон ноутбука — и тогда метки байтов уезжают:
// вперёд → скорость раздувается в разы, назад → «0, нет трафика» и
// бесконечные перезапуски потоков. Моделируем: часы страницы на 60с
// впереди часов воркеров (ровно то же, что прыжок часов после загрузки).
test('скорость не ломается, если системные часы прыгнули', async () => {
  const s = await openPage({ initScript: `(() => { const r = Date.now; Date.now = () => r() + 60000; })();` });
  try {
    await s.page.click('#btn-start');
    await s.page.waitForFunction(
      () => parseFloat(document.getElementById('speed-value').textContent) > 1,
      null, { timeout: 8000 });
  } finally { await s.close(); }
});

// Ошибка 2: после перезапуска потоков посреди замера (смена IP / маркер /
// «трафик встал») новые потоки заново разгоняются лесенкой ~3с, и этот
// провал шёл в среднюю замера. README обещает: разгон в среднюю не идёт.
// Обычный путь: переключил ноду → обрыв → новый замер → через 3–6с
// подтвердилась смена IP → рестарт потоков уже ПОСЛЕ 5с разгона замера →
// рейтинг ноды занижен.
test('разгон после перезапуска потоков не идёт в среднюю замера', async () => {
  const s = await openPage();
  try {
    const { page } = s;
    await page.click('#btn-start');
    const added = await page.evaluate(() => {
      curSeg.startT -= 20000;           // замер идёт давно, его разгон позади
      const b0 = curSeg.bytes;
      restartStreams('проба');          // новая лесенка потоков
      lastTickT = performance.now() - 100;
      totalBytes += 1e6;                // байты, пришедшие во время разгона
      updateDisplay(10, true);
      return curSeg.bytes - b0;
    });
    assert.strictEqual(added, 0, 'байты разгона попали в среднюю замера');
  } finally { await s.close(); }
});

// Проба выше подменяет часы только странице, и откат ВОРКЕРНОЙ половины
// починки (метка снова по Date.now()) её не красит — проверено подсадкой.
// Прыжок системных часов виден и ВОРКЕРАМ: отводим Date.now внутри каждого воркера на 60 с НАЗАД.
const shiftWorkers = `(() => {
  const B = window.Blob;
  window.Blob = function (parts, opts) {
    if (opts && /javascript/.test(opts.type || '')) parts = ['(()=>{const r=Date.now;Date.now=()=>r()-60000})();'].concat(parts);
    return new B(parts, opts);
  };
  window.Blob.prototype = B.prototype;
})();`;
test('скорость не ломается, если часы прыгнули назад и в ВОРКЕРАХ', async () => {
  const s = await openPage({ initScript: shiftWorkers });
  try {
    await s.page.click('#btn-start');
    await s.page.waitForFunction(
      () => parseFloat(document.getElementById('speed-value').textContent) > 1, null, { timeout: 8000 });
  } finally { await s.close(); }
});

// Проба выше зеленеет, пока идёт первый 5-секундный разгон замера, и до
// починки в restartStreams не доходит (подсадка её не красит). Здесь
// разгон замера уже прошёл — работает только продление в restartStreams.
test('перезапуск потоков после разгона замера — его разгон тоже не идёт в среднюю', async () => {
  const s = await openPage();
  try {
    await s.page.click('#btn-start');
    const added = await s.page.evaluate(() => {
      curSeg.startT -= 20000;
      if ('graceUntil' in curSeg) curSeg.graceUntil = performance.now() - 1;  // разгон замера ПРОШЁЛ
      const b0 = curSeg.bytes;
      restartStreams('проба');
      lastTickT = performance.now() - 100;
      totalBytes += 1e6;
      updateDisplay(10, true);
      return curSeg.bytes - b0;
    });
    assert.strictEqual(added, 0, 'байты разгона попали в среднюю: ' + added);
  } finally { await s.close(); }
});
