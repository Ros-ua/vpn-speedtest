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
  const state = { ip: opts.ip || { ip: '1.1.1.1', country: 'Germany', country_code: 'DE', city: 'Berlin', connection: { org: 'Node-A' } } };
  const chunk = Buffer.alloc(opts.chunkBytes || 256 * 1024);

  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
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
    if (url.hostname === 'ipwho.is') {
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify(Object.assign({ success: true }, state.ip)) });
    }
    if (url.hostname === 'ipapi.co' || url.hostname === 'ipinfo.io') {
      return route.fulfill({ status: 429, headers: cors, body: '{"error":true}' });
    }
    if (url.hostname === 'speed.cloudflare.com' || /jsdelivr\.net$|unpkg\.com$/.test(url.hostname)) {
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
