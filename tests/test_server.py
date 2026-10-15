"""HTTP boundaries for the local demo server, using only temporary fixtures."""
import http.client
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("portfolio_server_under_test", ROOT / "server.py")
portfolio_server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(portfolio_server)


class FakeService:
    @staticmethod
    def handle(method, path, query, body):
        if path == "/error":
            raise RuntimeError("private diagnostic details")
        return {"method": method, "path": path, "body": body}


class QuietHandler(portfolio_server.Handler):
    def log_message(self, *args):
        pass


class LocalHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.outside = tempfile.TemporaryDirectory()
        cls.saved_root = portfolio_server.ROOT
        cls.saved_services = portfolio_server.SERVICES
        portfolio_server.ROOT = Path(cls.temp.name).resolve()
        portfolio_server.SERVICES = {"test": FakeService}
        (portfolio_server.ROOT / "index.html").write_text("<h1>Synthetic demo</h1>")
        (portfolio_server.ROOT / "app.js").write_text("console.log('demo');")
        (portfolio_server.ROOT / "server.py").write_text("PRIVATE_SOURCE_MARKER")
        (portfolio_server.ROOT / "empty").mkdir()
        (portfolio_server.ROOT / ".git").mkdir()
        (portfolio_server.ROOT / ".git" / "config.md").write_text("PRIVATE_GIT_MARKER")
        (Path(cls.outside.name) / "private.html").write_text("PRIVATE_OUTSIDE_MARKER")
        (portfolio_server.ROOT / "linked.html").symlink_to(Path(cls.outside.name) / "private.html")
        cls.httpd = portfolio_server.LocalHTTPServer(("127.0.0.1", 0), QuietHandler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)
        portfolio_server.ROOT = cls.saved_root
        portfolio_server.SERVICES = cls.saved_services
        cls.temp.cleanup()
        cls.outside.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection(*self.httpd.server_address, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def post_json(self, path, body, **headers):
        return self.request("POST", path, json.dumps(body), {"Content-Type": "application/json", **headers})

    def test_static_index_and_assets_are_accessible(self):
        for path in ["/", "/index.html", "/app.js"]:
            with self.subTest(path=path):
                status, _, body = self.request("GET", path)
                self.assertEqual(200, status)
                self.assertTrue(body)

    def test_static_source_dotfiles_and_directory_listings_are_blocked(self):
        for method in ["GET", "HEAD"]:
            for path in ["/server.py", "/.git/config.md", "/empty/", "/%2e%2e/server.py", "/%2e%67it/config.md"]:
                with self.subTest(method=method, path=path):
                    status, _, body = self.request(method, path)
                    self.assertEqual(404, status)
                    self.assertNotIn(b"PRIVATE_", body)

    def test_static_symlink_cannot_escape_served_root(self):
        for method in ["GET", "HEAD"]:
            with self.subTest(method=method):
                status, _, body = self.request(method, "/linked.html")
                self.assertEqual(404, status)
                self.assertNotIn(b"PRIVATE_OUTSIDE_MARKER", body)

    def test_health_json_names_only_available_services(self):
        status, headers, body = self.request("GET", "/api/health")
        self.assertEqual(200, status)
        self.assertIn("application/json", headers["Content-Type"])
        self.assertEqual({"status": "ok", "synthetic": True, "services": ["test"]}, json.loads(body))

    def test_valid_json_body_reaches_service(self):
        status, _, body = self.post_json("/api/test/echo", {"value": 3})
        self.assertEqual(200, status)
        self.assertEqual({"method": "POST", "path": "/echo", "body": {"value": 3}}, json.loads(body))

    def test_unknown_api_service_is_a_404(self):
        self.assertEqual(404, self.post_json("/api/unknown/reset", {})[0])

    def test_non_api_path_cannot_invoke_mutation(self):
        self.assertEqual(404, self.post_json("/unexpected/test/echo", {})[0])

    def test_array_and_malformed_json_are_bad_requests(self):
        self.assertEqual(400, self.post_json("/api/test/echo", [1, 2])[0])
        self.assertEqual(400, self.request("POST", "/api/test/echo", "{", {"Content-Type": "application/json"})[0])

    def test_text_plain_json_is_rejected(self):
        self.assertEqual(415, self.request("POST", "/api/test/echo", "{}", {"Content-Type": "text/plain"})[0])

    def test_large_declared_body_is_rejected_before_read(self):
        status, _, _ = self.request("POST", "/api/test/echo", "{}", {"Content-Length": "1000001", "Content-Type": "application/json"})
        self.assertIn(status, [400, 413])

    def test_cross_origin_mutation_is_rejected(self):
        status, _, _ = self.post_json("/api/test/echo", {}, Origin="https://unrelated.example")
        self.assertEqual(403, status)

    def test_nonlocal_host_is_rejected_before_serving(self):
        self.assertEqual(403, self.request("GET", "/", headers={"Host": "unrelated.example"})[0])
        self.assertEqual(403, self.post_json("/api/test/echo", {}, Host="unrelated.example", Origin="http://unrelated.example")[0])

    def test_same_origin_mutation_is_allowed(self):
        host, port = self.httpd.server_address
        self.assertEqual(200, self.post_json("/api/test/echo", {}, Origin=f"http://{host}:{port}")[0])

    def test_unexpected_errors_do_not_echo_diagnostics(self):
        status, _, body = self.post_json("/api/test/error", {})
        self.assertEqual(500, status)
        self.assertNotIn(b"private diagnostic", body)


if __name__ == "__main__":
    unittest.main()
