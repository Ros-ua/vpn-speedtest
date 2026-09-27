// Источники jsDelivr и unpkg отдают файл СЖАТЫМ (br/gzip), если не попросить иначе. Браузер
// распаковывает, и страница считала распакованные байты — скорость выходила примерно втрое выше
// настоящей (замер 27.09 в Chromium с живой страницы: 38 Мбит/с на экране против 11 по сети).
// Починка — запрос с Range: bytes=0-: на него сервер отдаёт файл без сжатия (проверено там же).
//
// Стенд сжатие воспроизвести не может (route.fulfill не даёт браузеру распаковать тело — первая
// версия этой пробы на таком стенде была зелёной и без починки). Поэтому проба сторожит то,
// за что отвечает страница: КАЖДЫЙ запрос к источнику уходит с Range: bytes=0-.
// Ответ серверов на такой запрос сверяет tools/check_sources.py живьём.
const test = require('node:test');
const assert = require('node:assert');
const { openPage } = require('./helpers');

test('запросы к источникам просят файл без сжатия (Range: bytes=0-)', async () => {
  const s = await openPage();
  try {
    await s.page.click('#btn-start');
    await new Promise(r => setTimeout(r, 4000));
    const ranges = s.state.sourceRanges;
    const total = Object.values(ranges).reduce((a, b) => a + b, 0);
    assert.ok(total > 0, 'к источникам не ушло ни одного запроса');
    assert.deepStrictEqual(Object.keys(ranges), ['bytes=0-'],
      `не все запросы к источникам с Range: bytes=0- — ${JSON.stringify(ranges)}`);
  } finally { await s.close(); }
});
