#!/usr/bin/env python3
"""Живы ли источники трафика и IP-сервисы, которыми пользуется страница.

Если какой-то домен перестал отдавать большой файл или запретил CORS,
страница об этом НЕ скажет — просто скорость станет ниже. Этот скрипт
проверяет каждый источник так же, как это делает браузер.

    python3 tools/check_sources.py        (нужен интернет, лучше без VPN-правил DIRECT)
Код выхода 0 — всё живо.
"""
import re
import sys
import urllib.request

ORIGIN = 'https://ros-ua.github.io'
HTML = __file__.replace('tools/check_sources.py', 'index.html')


def sources():
    src = open(HTML, encoding='utf-8').read()
    bigfile = re.search(r"const BIGFILE = '([^']+)'", src).group(1)
    urls = ['https://speed.cloudflare.com/__down?bytes=1000000']
    for m in re.finditer(r"\{ base: '([^']+)'( \+ BIGFILE)? \}", src):
        urls.append(m.group(1) + (bigfile if m.group(2) else ''))
    return urls


def check(url, want_bytes):
    req = urllib.request.Request(url, headers={'Origin': ORIGIN, 'Range': 'bytes=0-1023'
                                               if want_bytes > 1 else 'bytes=0-0'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            cors = r.headers.get('Access-Control-Allow-Origin')
            size = r.headers.get('Content-Range', '').split('/')[-1] or r.headers.get('Content-Length', '0')
            r.read(2048)
    except Exception as e:
        return False, f'ошибка: {e}'
    if cors not in ('*', ORIGIN):
        return False, f'нет CORS (Access-Control-Allow-Origin={cors})'
    if size.isdigit() and int(size) < want_bytes:
        return False, f'файл маленький: {size} байт'
    return True, f'ok, размер {size}'


def main():
    ok = True
    for url in sources():
        good, msg = check(url, 1_000_000 if 'cloudflare' in url else 10_000_000)
        ok &= good
        print(('OK  ' if good else 'FAIL'), url, '—', msg)
    for url in ('https://ipwho.is/', 'https://ipapi.co/json/', 'https://ipinfo.io/json'):
        good, msg = check(url, 1)
        ok &= good
        print(('OK  ' if good else 'FAIL'), url, '—', msg)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
