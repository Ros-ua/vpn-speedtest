"""Пробы tools/check_sources.py: сеть подменена, интернет не нужен.

Каждая проба ловит то, в чём скрипт врал раньше:
- на Windows он читал САМ СЕБЯ вместо index.html и проверял 1 источник из 6;
- неизвестный размер файла («*») считал «ок»;
- IP-сервис с HTTP 200, но {"error": true} считал «ок», хотя страница его отвергает.
"""
import io
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools'))
import check_sources as cs  # noqa: E402


class FakeResp(io.BytesIO):
    def __init__(self, body, headers):
        super().__init__(body)
        self.headers = headers

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def fake(body=b'x' * 10, **headers):
    return mock.patch.object(cs.urllib.request, 'urlopen', return_value=FakeResp(body, headers))


class CheckSources(unittest.TestCase):
    def test_reads_index_html_all_sources(self):
        urls = cs.sources()
        self.assertTrue(cs.HTML.endswith('index.html'), cs.HTML)
        self.assertEqual(len(urls), 6, urls)

    def test_unknown_size_is_not_ok(self):
        with fake(**{'Access-Control-Allow-Origin': '*', 'Content-Range': 'bytes 0-0/*'}):
            good, msg = cs.check('https://example/x', 10_000_000)
        self.assertFalse(good, msg)

    def test_big_file_ok(self):
        with fake(**{'Access-Control-Allow-Origin': '*', 'Content-Range': 'bytes 0-1023/32129114'}):
            good, msg = cs.check('https://example/x', 10_000_000)
        self.assertTrue(good, msg)

    def test_ip_service_error_body_is_not_ok(self):
        # адрес в ответе есть (так ipapi.co отвечает при лимите) — отвергать надо по error,
        # иначе проба краснела бы и без проверки error: просто из-за отсутствия ip
        body = {'ip': '1.2.3.4', 'error': True, 'reason': 'RateLimited'}
        with fake(json.dumps(body).encode(), **{'Access-Control-Allow-Origin': '*'}):
            good, msg = cs.check_ip('https://example/ip')
        self.assertFalse(good, msg)

    def test_ip_service_ok(self):
        with fake(json.dumps({'ip': '1.2.3.4'}).encode(), **{'Access-Control-Allow-Origin': '*'}):
            good, msg = cs.check_ip('https://example/ip')
        self.assertTrue(good, msg)


if __name__ == '__main__':
    unittest.main()
