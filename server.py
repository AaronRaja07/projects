#!/usr/bin/env python3
"""Local, dependency-free demo server. Synthetic data only; bind to loopback."""
import argparse
import importlib.util
import json
import socketserver
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

ROOT = Path(__file__).resolve().parent
SERVICES = {}
for slug, prefix in [('mission-control', 'mission'), ('signal-lab', 'signal'), ('pipeline-rescue', 'pipeline')]:
    path = ROOT / slug / 'service.py'
    if path.exists():
        spec = importlib.util.spec_from_file_location(prefix, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        SERVICES[prefix] = module

class LocalHTTPServer(ThreadingHTTPServer):
    def server_bind(self):
        # Avoid reverse-DNS lookup during local startup.
        socketserver.TCPServer.server_bind(self)
        self.server_name = 'localhost'
        self.server_port = self.server_address[1]

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status, payload):
        data = json.dumps(payload, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def parse_request(self):
        if not super().parse_request():
            return False
        host = self.headers.get('Host', '')
        port = self.server.server_address[1]
        if host not in {f'127.0.0.1:{port}', f'localhost:{port}'}:
            self.send_error(403, 'Use the local demo address')
            return False
        return True

    def do_HEAD(self):
        if not self.static_allowed():
            return self.send_error(404)
        return super().do_HEAD()

    def static_allowed(self):
        path = unquote(urlsplit(self.path).path)
        parts = Path(path).parts
        target = (ROOT / path.lstrip('/')).resolve()
        allowed = {'.html', '.css', '.js', '.svg', '.png', '.md'}
        return (target.is_relative_to(ROOT) and not any(part.startswith('.') or part == '..' for part in parts) and (not target.suffix or target.suffix in allowed) and (not target.is_dir() or (target / 'index.html').exists()))

    def do_GET(self):
        if urlsplit(self.path).path.startswith('/api/'):
            return self.route('GET')
        if not self.static_allowed():
            return self.send_error(404)
        return super().do_GET()

    def do_POST(self):
        origin = self.headers.get('Origin')
        host = self.headers.get('Host', '')
        if origin and origin not in ('http://' + host, 'https://' + host):
            return self.send_json(403, {'error': 'Cross-origin mutation rejected'})
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.send_json(415, {'error': 'Use application/json'})
        self.route('POST')

    def route(self, method):
        parsed = urlsplit(self.path)
        parts = parsed.path.strip('/').split('/')
        if parsed.path == '/api/health':
            return self.send_json(200, {'status': 'ok', 'synthetic': True, 'services': sorted(SERVICES)})
        if len(parts) < 2 or parts[0] != 'api' or parts[1] not in SERVICES:
            return self.send_json(404, {'error': 'Unknown endpoint'})
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length < 0 or length > 1_000_000:
                raise ValueError('Request must be smaller than 1 MB')
            body = json.loads(self.rfile.read(length)) if length else {}
            if not isinstance(body, dict):
                raise ValueError('Expected a JSON object')
            result = SERVICES[parts[1]].handle(method, '/' + '/'.join(parts[2:]), parse_qs(parsed.query), body)
            self.send_json(200, result)
        except (ValueError, TypeError, KeyError) as exc:
            self.send_json(400, {'error': str(exc)})
        except Exception:
            self.send_json(500, {'error': 'Unexpected demo error'})

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    server = LocalHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Portfolio demos: http://127.0.0.1:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
