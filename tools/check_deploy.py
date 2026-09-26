#!/usr/bin/env python3
"""Честная проверка: какая версия РЕАЛЬНО выложена на GitHub Pages.

API Pages может показывать не тот коммит, поэтому смотрим сам сайт:
  1. version.json с сайта — какой коммит вписал Jekyll при сборке;
  2. index.html с сайта — сверяем байт в байт с index.html из git
     (это работает, даже если version.json нет или он пустой).

Запуск (из папки репозитория, нужен интернет):
    python3 tools/check_deploy.py              # ждём версию из origin/main
    python3 tools/check_deploy.py --expect HEAD
Код выхода 0 — выложено ровно то, что ждали; 1 — нет (причина в выводе).
"""
import argparse
import json
import random
import subprocess
import sys
import urllib.request

SITE = 'https://ros-ua.github.io/vpn-speedtest/'


def git(*args, binary=False):
    out = subprocess.run(['git', *args], capture_output=True, check=True).stdout
    return out if binary else out.decode().strip()


def fetch(url):
    # случайный параметр — мимо кэша CDN Pages (он держит файлы до 10 минут)
    sep = '&' if '?' in url else '?'
    req = urllib.request.Request(f'{url}{sep}nocache={random.random()}',
                                 headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def commit_with_same_index(html):
    """Какой коммит из истории даёт ровно такой index.html (или None)."""
    for sha in git('rev-list', '--all', '--', 'index.html').split():
        try:
            if git('show', f'{sha}:index.html', binary=True) == html:
                return sha
        except subprocess.CalledProcessError:
            pass
    return None


def default_expect():
    for ref in ('origin/main', 'main'):
        try:
            return git('rev-parse', ref)
        except subprocess.CalledProcessError:
            pass
    return git('rev-parse', 'HEAD')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--site', default=SITE)
    ap.add_argument('--expect', help='коммит/ветка, который должен быть выложен (по умолчанию origin/main)')
    a = ap.parse_args(argv)
    site = a.site if a.site.endswith('/') else a.site + '/'
    expect = git('rev-parse', a.expect) if a.expect else default_expect()
    ok = True

    html = fetch(site)
    same = commit_with_same_index(html)
    want = git('show', f'{expect}:index.html', binary=True)
    if html == want:
        print(f'OK   index.html на сайте = index.html коммита {expect[:7]}')
    else:
        ok = False
        where = f'совпадает с коммитом {same[:7]}' if same else 'не совпадает ни с одним коммитом'
        print(f'FAIL index.html на сайте НЕ тот, что в {expect[:7]} ({where})')

    try:
        v = json.loads(fetch(site + 'version.json'))
        sha = str(v.get('sha', ''))
        if sha == expect:
            print(f'OK   version.json: выложен {sha[:7]}, собран {v.get("built", "?")}')
        else:
            ok = False
            print(f'FAIL version.json говорит {sha[:7] or "(пусто)"}, а ждали {expect[:7]}')
    except Exception as e:  # нет файла / не JSON / Jekyll не подставил
        ok = False
        print(f'FAIL version.json не читается: {e}')

    print('ИТОГ:', 'выложено то, что ждали' if ok else 'выложено НЕ то (или не видно, что)')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
