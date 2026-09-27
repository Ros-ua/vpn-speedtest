// Общий стенд для проб: страница открывается в настоящем Chromium, но
// ВСЯ сеть подменена — сайт отдаётся из файлов репозитория (как с Pages),
// источники трафика отдают нули, IP-сервисы отвечают тем, что задаст проба.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://ros-ua.github.io/vpn-speedtest/';

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json' };

async function openPage(opts = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 800 } });
  const state = {
    ip: opts.ip || { ip: '1.1.1.1', country: 'Germany', country_code: 'DE', city: 'Berlin', connection: { org: 'Node-A' } },
    ipByHost: opts.ipByHost || null,
    hits: {},
    sourceRanges: {}   // заголовок Range запросов к источникам трафика → сколько раз ('' — без Range)
  };
  const chunk = Buffer.alloc(opts.chunkBytes || 256 * 1024);

  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const host = url.hostname;
    state.hits[host] = (state.hits[host] || 0) + 1;
    const cors = { 'access-control-allow-origin': '*' };

    if (url.href.startsWith(SITE)) {
      let rel = url.pathname.slice('/vpn-speedtest/'.length) || 'index.html';
      if (opts.files && rel in opts.files) {
        const f = opts.files[rel];
        if (f === null) return route.fulfill({ status: 404, body: 'nf' });
        return route.fulfill({ status: 200, body: f, contentType: TYPES[path.extname(rel)] || 'text/plain' });
      }
      const p = path.join(ROOT, rel);
      if (!fs.existsSync(p)) return route.fulfill({ status: 404, body: 'nf' });
      return route.fulfill({ status: 200, body: fs.readFileSync(p), contentType: TYPES[path.extname(rel)] || 'text/plain' });
    }

    if (host === 'ipwho.is' || host === 'ipapi.co' || host === 'ipinfo.io') {
      let res = state.ipByHost ? state.ipByHost[host] : (host === 'ipwho.is' ? state.ip : null);
      if (res === null) return route.fulfill({ status: 429, headers: cors, body: '{"error":true,"success":false}' });
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(Object.assign({ success: true }, res)) });
    }

    if (host === 'speed.cloudflare.com' || /jsdelivr\.net$|unpkg\.com$/.test(host)) {
      if (opts.sourceHang) return; // promise never resolves
      if (opts.sourceStatus && opts.sourceStatus[host]) {
        return route.fulfill({ status: opts.sourceStatus[host], headers: cors, body: 'err' });
      }
      // какой Range пришёл с запросом к источнику: без него jsDelivr и unpkg отдают файл сжатым,
      // браузер распаковывает, и страница насчитывает втрое больше, чем прошло по сети.
      // Само сжатие стенд воспроизвести НЕ может: route.fulfill отдаёт тело браузеру как есть,
      // без распаковки (проверено 27.09 — прямой fetch получил сырой gzip). Поэтому здесь
      // сторожим поведение страницы, а ответ серверов на Range сверяет tools/check_sources.py.
      const range = route.request().headers()['range'] || '';
      state.sourceRanges[range] = (state.sourceRanges[range] || 0) + 1;
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/octet-stream', body: chunk });
    }
    return route.fulfill({ status: 404, body: 'blocked in test' });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (opts.initScript) await page.addInitScript(opts.initScript);
  await page.goto(SITE + (opts.pathSuffix || ''));
  return { browser, page, state, errors, close: () => browser.close() };
}

module.exports = { openPage, ROOT, SITE };