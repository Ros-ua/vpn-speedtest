#!/usr/bin/env python3
"""Живы ли источники трафика и IP-сервисы, которыми пользуется страница.

Если какой-то домен перестал отдавать большой файл или запретил CORS,
страница об этом НЕ скажет — просто скорость станет ниже. Этот скрипт
проверяет каждый источник так же, как это делает браузер.

    python3 tools/check_sources.py        (нужен интернет, лучше без VPN-правил DIRECT)
Код выхода 0 — всё живо.
"""
import json
import os
import re
import sys
import urllib.request

ORIGIN = 'https://ros-ua.github.io'
# путь через os.path: replace('tools/…') на Windows не срабатывал (там «\»),
# и скрипт молча читал САМ СЕБЯ — проверял 1 источник из 6
HTML = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'index.html')
# браузерный User-Agent: Cloudflare отвечает 403 клиенту «Python-urllib»,
# а браузеру — 200; без этого скрипт пугал ложным FAIL
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'


def sources():
    src = open(HTML, encoding='utf-8').read()
    bigfile = re.search(r"const BIGFILE = '([^']+)'", src).group(1)
    urls = ['https://speed.cloudflare.com/__down?bytes=1000000']
    for m in re.finditer(r"\{ base: '([^']+)'( \+ BIGFILE)? \}", src):
        urls.append(m.group(1) + (bigfile if m.group(2) else ''))
    # разобрал меньше источников, чем их в странице, — это провал, а не «всё ок»
    want = src.count('{ cf: true }') + src.count('{ base:')
    if len(urls) != want:
        sys.exit(f'FAIL разобрал {len(urls)} источников из {want} в {HTML} — поправь разбор')
    return urls


def check(url, want_bytes):
    """Источник трафика: CORS есть, отдаёт БЕЗ сжатия, размер ИЗВЕСТЕН и не меньше want_bytes, тело не пустое.

    Запрос — ровно как у страницы: Range: bytes=0-, а на запрос с Range браузер сам ставит
    Accept-Encoding: identity (спецификация Fetch; снято с живого Chromium 27.09 через CDP).
    Сжатый ответ = FAIL: браузер его распакует, и страница насчитает больше байт, чем прошло
    по сети (27.09: ×3,5).
    """
    req = urllib.request.Request(url, headers={'Origin': ORIGIN, 'User-Agent': UA, 'Range': 'bytes=0-',
                                               'Accept-Encoding': 'identity'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            cors = r.headers.get('Access-Control-Allow-Origin')
            enc = r.headers.get('Content-Encoding')
            size = r.headers.get('Content-Range', '').split('/')[-1] or r.headers.get('Content-Length', '')
            body = r.read(2048)
    except Exception as e:
        return False, f'ошибка: {e}'
    if cors not in ('*', ORIGIN):
        return False, f'нет CORS (Access-Control-Allow-Origin={cors})'
    if enc and enc.lower() != 'identity':
        return False, f'отдаёт сжатым ({enc}) даже с Range — скорость на этом источнике будет завышена'
    # неизвестный размер («*» или нет заголовка) — это не «ок», а «не проверено»
    if not size.isdigit():
        return False, f'размер не известен ({size or "нет заголовка"})'
    if int(size) < want_bytes:
        return False, f'файл маленький: {size} байт'
    if not body:
        return False, 'пустое тело'
    return True, f'ok, размер {size}'


def check_ip(url):
    """IP-сервис: CORS есть и ответ — JSON с адресом, как его разбирает страница."""
    req = urllib.request.Request(url, headers={'Origin': ORIGIN, 'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            cors = r.headers.get('Access-Control-Allow-Origin')
            d = json.loads(r.read(65536).decode('utf-8'))
    except Exception as e:
        return False, f'ошибка: {e}'
    if cors not in ('*', ORIGIN):
        return False, f'нет CORS (Access-Control-Allow-Origin={cors})'
    # страница отвергает ответ с error / success:false даже при HTTP 200
    if d.get('error') or d.get('success') is False or not d.get('ip'):
        return False, f'ответ без адреса: {str(d)[:80]}'
    return True, 'ok'


def main():
    ok = True
    for url in sources():
        # 5 МБ, не 10: часть узлов jsDelivr на Range+identity отдаёт несжатые байты, но пишет в
        # Content-Range длину СЖАТОЙ версии (9,26 МБ из 32) — поток просто перезапросит, байты честные
        good, msg = check(url, 1_000_000 if 'cloudflare' in url else 5_000_000)
        ok &= good
        print(('OK  ' if good else 'FAIL'), url, '—', msg)
    for url in ('https://ipwho.is/', 'https://ipapi.co/json/', 'https://ipinfo.io/json'):
        good, msg = check_ip(url)
        ok &= good
        print(('OK  ' if good else 'FAIL'), url, '—', msg)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
