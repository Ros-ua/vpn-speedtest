"""Проба для tools/check_deploy.py: поднимаем локальный «Pages» и проверяем,
что скрипт говорит OK на правильной выкладке и FAIL на неправильной."""
import contextlib
import functools
import http.server
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import check_deploy  # noqa: E402


class FakePages:
    def __init__(self, files):
        self.dir = tempfile.TemporaryDirectory()
        for name, data in files.items():
            with open(os.path.join(self.dir.name, name), 'wb') as f:
                f.write(data)
        h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=self.dir.name)
        h.log_message = lambda *a: None
        self.srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), h)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = f'http://127.0.0.1:{self.srv.server_port}/'

    def close(self):
        self.srv.shutdown()
        self.dir.cleanup()


def run(files, expect):
    os.environ['no_proxy'] = os.environ['NO_PROXY'] = '127.0.0.1,localhost'
    site = FakePages(files)
    out = io.StringIO()
    cwd = os.getcwd()
    try:
        os.chdir(ROOT)
        with contextlib.redirect_stdout(out):
            code = check_deploy.main(['--site', site.url, '--expect', expect])
    finally:
        os.chdir(cwd)
        site.close()
    return code, out.getvalue()


def git(*a):
    return subprocess.run(['git', *a], cwd=ROOT, capture_output=True, check=True).stdout


class CheckDeploy(unittest.TestCase):
    def test_ok_when_site_matches_commit(self):
        sha = git('rev-parse', 'HEAD').decode().strip()
        files = {'index.html': git('show', 'HEAD:index.html'),
                 'version.json': json.dumps({'sha': sha, 'built': 'x'}).encode()}
        code, out = run(files, 'HEAD')
        self.assertEqual(code, 0, out)

    def test_fail_when_old_version_deployed(self):
        # на сайте старый index.html и нет version.json — так было до этой ветки
        first = git('rev-list', '--max-parents=0', 'HEAD').decode().split()[0]
        old = git('rev-list', '-n1', 'HEAD~0', '--', 'index.html').decode().strip()
        prev = git('rev-list', '-n1', old + '~1', '--', 'index.html').decode().strip() or first
        code, out = run({'index.html': git('show', f'{prev}:index.html')}, 'HEAD')
        self.assertEqual(code, 1, out)
        self.assertIn(f'совпадает с коммитом {prev[:7]}', out)

    def test_fail_when_version_json_not_substituted(self):
        with open(os.path.join(ROOT, 'version.json'), 'rb') as f:
            raw = f.read()
        files = {'index.html': git('show', 'HEAD:index.html'), 'version.json': raw}
        code, out = run(files, 'HEAD')
        self.assertEqual(code, 1, out)
        self.assertIn('version.json не читается', out)


if __name__ == '__main__':
    unittest.main()
