const test = require('node:test');
const assert = require('node:assert');
const { openPage } = require('./helpers');

test('телефон 375×667: график не сжат и не наезжает на таблицу, нет прокрутки вбок', async () => {
  const s = await openPage({ viewport: { width: 375, height: 667 } });
  try {
    const chartWrap = await s.page.locator('.chart-wrap').boundingBox();
    const right = await s.page.locator('.right').boundingBox();
    const canvasH = await s.page.evaluate(() => document.getElementById('speedChart').offsetHeight);
    const scrollW = await s.page.evaluate(() => document.documentElement.scrollWidth);
    const clientW = await s.page.evaluate(() => document.documentElement.clientWidth);

    assert.ok(canvasH >= 170, 'высота канваса мала');
    assert.ok(chartWrap.y + chartWrap.height <= right.y + 1, 'график наезжает на правую колонку');
    assert.ok(scrollW <= clientW + 1, 'есть горизонтальная прокрутка');
  } finally { await s.close(); }
});

test('без теста IP опрашивается редко (не раз в 3 с), но опрашивается', { timeout: 40000 }, async () => {
  const s = await openPage();
  const ipHits = () => (s.state.hits['ipwho.is'] || 0) + (s.state.hits['ipapi.co'] || 0) + (s.state.hits['ipinfo.io'] || 0);
  try {
    await new Promise(r => setTimeout(r, 7000));
    assert.ok(ipHits() <= 2, `слишком много опросов IP (${ipHits()})`);
    // и нижняя граница: опрос без теста не должен пропасть вовсе
    // (проба только сверху зеленела бы и при полностью выключенном опросе)
    await new Promise(r => setTimeout(r, 16000));
    assert.ok(ipHits() >= 2, `без теста IP больше не опрашивается (${ipHits()} за 23 с)`);
  } finally { await s.close(); }
});

test('другой IP-сервис видит другой адрес — это не смена ноды, нового замера нет', async () => {
  const s = await openPage({
    ipByHost: {
      'ipwho.is': { ip: '1.1.1.1', country: 'DE', country_code: 'DE', city: 'B' },
      'ipapi.co': null,
      'ipinfo.io': null
    }
  });
  try {
    await s.page.click('#btn-start');
    await s.page.waitForFunction(() => document.getElementById('ip-addr').textContent === '1.1.1.1');
    
    s.state.ipByHost['ipwho.is'] = null;
    s.state.ipByHost['ipinfo.io'] = { ip: '2.2.2.2', country: 'DE', org: 'X', city: 'Y' };
    
    await new Promise(r => setTimeout(r, 8000));
    
    const ip = await s.page.evaluate(() => document.getElementById('ip-addr').textContent);
    const segs = await s.page.evaluate(() => segments.length);
    const log = await s.page.evaluate(() => document.getElementById('log').textContent);
    
    assert.strictEqual(ip, '2.2.2.2');
    assert.strictEqual(segs, 1, 'создан новый сегмент, а не должен');
    assert.ok(!log.includes('⚑ IP изменился'), 'в логе флаг смены, хотя должен быть dim-лог');
    assert.ok(log.includes('IP-сервис сменился'), 'нет сообщения о смене сервиса');
  } finally { await s.close(); }
});

test('источник отвечает ошибкой — пишется в лог и исключается до конца теста', async () => {
  const s = await openPage({ sourceStatus: { 'cdn.jsdelivr.net': 503 } });
  try {
    await s.page.click('#btn-start');
    // воркеры, которые стартовали на плохом домене: после исключения именно
    // ОНИ должны качать с другого (а не просто замолчать — тогда запросов к
    // мёртвому тоже нет и общая скорость есть, проба зеленела бы зря)
    await s.page.evaluate(() => {
      window.__moved = [];
      workers.filter(w => epHost(w.ep) === 'cdn.jsdelivr.net').forEach(w => {
        const orig = w.onmessage;
        w.onmessage = (ev) => { if (ev.data.type === 'b') window.__moved.push(ev.data.host); orig(ev); };
      });
    });
    await s.page.waitForFunction(() =>
      document.getElementById('log').textContent.includes('cdn.jsdelivr.net отвечает ошибкой 503') &&
      document.getElementById('log').textContent.includes('исключён'),
      null, { timeout: 10000 });

    const hitsBefore = s.state.hits['cdn.jsdelivr.net'];
    await s.page.evaluate(() => { window.__moved = []; });
    await new Promise(r => setTimeout(r, 4000));
    const hitsAfter = s.state.hits['cdn.jsdelivr.net'];

    assert.ok(hitsAfter - hitsBefore <= 2, 'запросы на мертвый домен продолжаются');
    const moved = await s.page.evaluate(() => window.__moved);
    assert.ok(moved.length > 0 && moved.every(h => h !== 'cdn.jsdelivr.net'),
      `воркеры с мёртвого домена не качают с живого: ${JSON.stringify(moved.slice(0, 5))}`);
    const speed = await s.page.evaluate(() => parseFloat(document.getElementById('speed-value').textContent));
    assert.ok(speed > 1, 'скорость должна быть > 1 за счёт других доменов');
  } finally { await s.close(); }
});

test('медленная нода (< 1 Мбит/с, но байты идут) — не обрыв, потоки не перезапускаются', { timeout: 40000 }, async () => {
  const s = await openPage({ sourceHang: true });
  try {
    await s.page.click('#btn-start');
    const startT = Date.now();
    const timer = setInterval(async () => {
      await s.page.evaluate(() => {
        if (workers.length > 0) {
          workers[0].onmessage({ data: { type: 'b', n: 2000, t: performance.timeOrigin + performance.now(), host: 'speed.cloudflare.com' } });
        }
      });
    }, 200); 

    await new Promise(r => setTimeout(r, 18000));
    clearInterval(timer);
    
    const log = await s.page.evaluate(() => document.getElementById('log').textContent);
    assert.ok(!log.includes('трафик встал'), 'ложное срабатывание обрыва при медленных байтах');
    const status = await s.page.evaluate(() => document.getElementById('status-text').textContent);
    assert.strictEqual(status, 'измерение...', 'статус должен быть измерение');
  } finally { await s.close(); }
});
test('после перезапуска потоков исключённый источник не возвращается', async () => {
  const s = await openPage({ sourceStatus: { 'cdn.jsdelivr.net': 503 } });
  try {
    await s.page.click('#btn-start');
    await s.page.waitForFunction(() => document.getElementById('log').textContent.includes('исключён'),
      null, { timeout: 10000 });
    await s.page.evaluate(() => restartStreams('проба'));
    const before = s.state.hits['cdn.jsdelivr.net'];
    await new Promise(r => setTimeout(r, 5000));
    assert.ok(s.state.hits['cdn.jsdelivr.net'] - before <= 2,
      `после перезапуска на мёртвый домен снова пошли запросы: ${s.state.hits['cdn.jsdelivr.net'] - before}`);
  } finally { await s.close(); }
});

// Остановленный воркер живёт ещё 500 мс: его запоздалые ошибки не должны
// исключить источник в НОВОМ тесте (находка вычитки Astra 26.09).
test('ошибки воркеров прошлого запуска не исключают источник в новом тесте', async () => {
  const s = await openPage();
  try {
    await s.page.click('#btn-start');
    const excluded = await s.page.evaluate(() => {
      const old = workers[0];
      stopTest(); startTest();
      for (let i = 0; i < 3; i++) old.onmessage({ data: { type: 'err', host: 'cdn.jsdelivr.net', status: 503 } });
      return document.getElementById('log').textContent.includes('исключён');
    });
    assert.strictEqual(excluded, false, 'источник исключён ошибками остановленного воркера');
  } finally { await s.close(); }
});

// Перезапуск потоков посреди тишины: сторож обрыва обязан считать 15 с от
// перезапуска, а не от прежней тишины (находка вычитки Astra 26.09).
test('после перезапуска потоков новым соединениям даются полные 15 с', { timeout: 40000 }, async () => {
  const s = await openPage({ sourceHang: true });
  try {
    await s.page.click('#btn-start');
    await s.page.evaluate(() => {
      lastByteT = performance.now() - 14000;   // тишина длится уже 14 с
      stallSince = lastByteT;
      restartStreams('проба');
    });
    await new Promise(r => setTimeout(r, 9000));   // разгон ~3 с + запас
    const log = await s.page.evaluate(() => document.getElementById('log').textContent);
    assert.ok(!log.includes('трафик встал'), 'сторож перезапустил потоки через секунды после перезапуска');
  } finally { await s.close(); }
});

// Совет (оба qwen) предположил, что исключить можно ВСЕ домены. По коду
// последний защищён — проверяем замером: все шесть отвечают 503.
test('все источники отвечают ошибкой — последний не исключается', async () => {
  const bad = {};
  for (const h of ['speed.cloudflare.com', 'fastly.jsdelivr.net', 'cdn.jsdelivr.net',
                   'gcore.jsdelivr.net', 'testingcf.jsdelivr.net', 'unpkg.com']) bad[h] = 503;
  const s = await openPage({ sourceStatus: bad });
  try {
    await s.page.click('#btn-start');
    await new Promise(r => setTimeout(r, 9000));
    const n = await s.page.evaluate(() => (document.getElementById('log').textContent.match(/исключён/g) || []).length);
    assert.ok(n <= 5, `исключено ${n} источников из 6 — качать не с чего`);
    const errs = await s.page.evaluate(() => {
      try { ENDPOINTS.filter(e => !isDead(e))[0].cf; return null; } catch (e) { return String(e); }
    });
    assert.strictEqual(errs, null, 'живых эндпоинтов не осталось');
  } finally { await s.close(); }
});
