import http.server
import subprocess
import json
import os
from pathlib import Path

PORT = 8765
ROOT = Path(__file__).parent.resolve()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path == '/run-converter':
            self._run_converter()
        else:
            self.send_error(404)

    def _run_converter(self):
        venv_py = ROOT / 'converter' / 'venv' / 'Scripts' / 'python.exe'
        script  = ROOT / 'converter' / 'converter.py'
        cwd     = ROOT / 'converter'

        if not venv_py.exists():
            return self._json({
                'ok': False,
                'output': (
                    '[ERRO] venv nao encontrado em converter/venv/\n'
                    'Execute no terminal:\n'
                    '  cd converter\n'
                    '  python -m venv venv\n'
                    '  venv\\Scripts\\pip install pandas openpyxl\n'
                )
            })

        try:
            result = subprocess.run(
                [str(venv_py), str(script)],
                cwd=str(cwd),
                capture_output=True,
                text=True,
                encoding='utf-8',
                errors='replace',
            )
            output = result.stdout
            if result.stderr:
                output += '\n[STDERR]\n' + result.stderr
            self._json({'ok': result.returncode == 0, 'output': output})
        except Exception as e:
            self._json({'ok': False, 'output': f'[ERRO] {e}'})

    def _json(self, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def log_message(self, format, *args):
        pass


if __name__ == '__main__':
    os.chdir(ROOT)
    with http.server.HTTPServer(('localhost', PORT), Handler) as httpd:
        print(f'Flow  →  http://localhost:{PORT}/dashboard.html')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('Encerrado.')
