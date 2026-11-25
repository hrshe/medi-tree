"""End-to-end API and database tests for the Medinetz Decision Tree server."""

import http.cookiejar
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request
from wsgiref.util import setup_testing_defaults

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from sample_tree import SAMPLE_TREE
from server import create_app, create_server, tree_to_markdown, tree_to_mermaid, validate_tree_payload
import wsgi


class MedinetzServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "test.db"
        with patch.dict("os.environ", {
            "MEDINETZ_ADMIN_USER": "admin",
            "MEDINETZ_ADMIN_PASSWORD": "test-admin-password-2026",
        }):
            self.server = create_server(
                host="127.0.0.1",
                port=0,
                db_path=self.db_path,
            )
        self.port = self.server.server_address[1]
        self.base_url = f"http://127.0.0.1:{self.port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

        self.cookie_jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookie_jar))

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.tmpdir.cleanup()

    def request(self, method: str, path: str, body=None, use_cookies: bool = True):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"Content-Type": "application/json"} if body is not None else {}
        req = urllib.request.Request(f"{self.base_url}{path}", data=data, headers=headers, method=method)
        opener = self.opener if use_cookies else urllib.request.build_opener()
        try:
            with opener.open(req) as resp:
                raw = resp.read().decode("utf-8")
                return resp.status, raw, dict(resp.headers)
        except urllib.error.HTTPError as err:
            return err.code, err.read().decode("utf-8"), dict(err.headers)

    def test_stateless_schema_has_no_client_tables(self) -> None:
        conn = sqlite3.connect(self.db_path)
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        conn.close()
        self.assertEqual(tables, {"admins", "sessions", "trees", "sqlite_sequence"})

    def test_public_pages_and_published_tree(self) -> None:
        status, html, _ = self.request("GET", "/", use_cookies=False)
        self.assertEqual(status, 200)
        self.assertIn("Medinetz Decision Guide", html)

        status, admin_html, _ = self.request("GET", "/admin", use_cookies=False)
        self.assertEqual(status, 200)
        self.assertIn("Medinetz Admin Studio", admin_html)

        for asset, expected_mime in [
            ("/static/styles.css", "text/css"),
            ("/static/graph-core.js", "application/javascript"),
            ("/static/volunteer.js", "application/javascript"),
            ("/static/admin.js", "application/javascript"),
        ]:
            st, body, hdrs = self.request("GET", asset, use_cookies=False)
            self.assertEqual(st, 200, f"Failed to fetch {asset}")
            self.assertIn(expected_mime, hdrs.get("Content-Type", ""))
            self.assertGreater(len(body), 100)

        status, raw, _ = self.request("GET", "/api/tree/published", use_cookies=False)
        self.assertEqual(status, 200)
        payload = json.loads(raw)
        self.assertEqual(payload["version"], 1)
        self.assertEqual(payload["tree"]["rootNodeId"], SAMPLE_TREE["rootNodeId"])

    def test_admin_auth_guards(self) -> None:
        for method, path in [
            ("GET", "/api/admin/tree"),
            ("PUT", "/api/admin/tree"),
            ("POST", "/api/admin/tree/publish"),
            ("GET", "/api/admin/tree/export?format=json"),
            ("POST", "/api/admin/tree/import"),
            ("POST", "/api/admin/password"),
        ]:
            status, _, _ = self.request(method, path, body={} if method != "GET" else None, use_cookies=False)
            self.assertEqual(status, 401, f"Expected 401 for {method} {path}")

        status, _, _ = self.request("POST", "/api/admin/login", {"username": "admin", "password": "wrong"})
        self.assertEqual(status, 401)

    def test_draft_publish_export_import_and_password_flow(self) -> None:
        # Login
        status, raw, _ = self.request("POST", "/api/admin/login", {"username": "admin", "password": "test-admin-password-2026"})
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(raw)["authenticated"])

        # Save draft (not yet published)
        modified = json.loads(json.dumps(SAMPLE_TREE))
        modified["title"] = "Updated Draft Title"
        status, raw, _ = self.request("PUT", "/api/admin/tree", {"tree": modified, "publish": False})
        self.assertEqual(status, 200)
        admin_data = json.loads(raw)
        self.assertTrue(admin_data["hasUnpublishedChanges"])
        self.assertEqual(admin_data["draftVersion"], 2)
        self.assertEqual(admin_data["publishedVersion"], 1)

        # Public published endpoint still serves v1 title
        _, pub_raw, _ = self.request("GET", "/api/tree/published", use_cookies=False)
        self.assertEqual(json.loads(pub_raw)["tree"]["title"], SAMPLE_TREE["title"])

        # Publish draft
        status, raw, _ = self.request("POST", "/api/admin/tree/publish", {})
        self.assertEqual(status, 200)
        pub_resp = json.loads(raw)
        self.assertFalse(pub_resp["hasUnpublishedChanges"])
        self.assertEqual(pub_resp["publishedVersion"], 2)

        # Public endpoint now reflects updated title
        _, pub_raw2, _ = self.request("GET", "/api/tree/published", use_cookies=False)
        self.assertEqual(json.loads(pub_raw2)["tree"]["title"], "Updated Draft Title")

        # Export formats
        for fmt, expected_substr in [
            ("json", "Updated Draft Title"),
            ("mermaid", "flowchart TD"),
            ("markdown", "# Updated Draft Title"),
        ]:
            st, text, _ = self.request("GET", f"/api/admin/tree/export?format={fmt}")
            self.assertEqual(st, 200)
            self.assertIn(expected_substr, text)

        # Import validation failure
        st, _, _ = self.request("POST", "/api/admin/tree/import", {"tree": {"title": "Bad", "nodes": [], "edges": []}})
        self.assertEqual(st, 400)

        # Import valid tree
        modified["title"] = "Imported Medinetz Tree"
        st, imp_raw, _ = self.request("POST", "/api/admin/tree/import", {"tree": modified, "publish": False})
        self.assertEqual(st, 200)
        self.assertEqual(json.loads(imp_raw)["tree"]["title"], "Imported Medinetz Tree")

        # Change password & re-login
        st, _, _ = self.request(
            "POST",
            "/api/admin/password",
            {"currentPassword": "test-admin-password-2026", "newPassword": "new-secure-password"},
        )
        self.assertEqual(st, 200)

        st, _, _ = self.request("POST", "/api/admin/logout", {})
        self.assertEqual(st, 200)

        # Confirm session invalidated
        st, _, _ = self.request("GET", "/api/admin/tree")
        self.assertEqual(st, 401)

        # Login with new password
        st, _, _ = self.request("POST", "/api/admin/login", {"username": "admin", "password": "new-secure-password"})
        self.assertEqual(st, 200)

    def test_tree_validators_and_formatters(self) -> None:
        bad_self_loop = {
            "title": "Test",
            "rootNodeId": "a",
            "nodes": [{"id": "a", "type": "question", "title": "Q"}],
            "edges": [{"id": "e1", "source": "a", "target": "a", "label": "loop"}],
        }
        norm, errs = validate_tree_payload(bad_self_loop)
        self.assertIsNone(norm)
        self.assertTrue(any("itself" in e for e in errs))

        mmd = tree_to_mermaid(SAMPLE_TREE)
        self.assertIn("START:", mmd)
        md = tree_to_markdown(SAMPLE_TREE)
        self.assertIn("## Emergency Red Flags?", md)

    def test_wsgi_application_callable(self) -> None:
        app = create_app(db_path=self.db_path)
        self.assertTrue(callable(wsgi.application))
        environ: dict = {}
        setup_testing_defaults(environ)
        environ["REQUEST_METHOD"] = "GET"
        environ["PATH_INFO"] = "/api/health"

        captured: dict = {}

        def start_response(status, headers):
            captured["status"] = status
            captured["headers"] = dict(headers)

        body = b"".join(app(environ, start_response))
        self.assertTrue(captured["status"].startswith("200"))
        self.assertEqual(json.loads(body.decode("utf-8")), {"status": "ok"})


if __name__ == "__main__":
    unittest.main()
