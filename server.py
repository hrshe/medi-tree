"""Medinetz Decision Tree Server & WSGI Application.

Lightweight, zero-external-dependency WSGI + SQLite application providing:
- Volunteer frontend (stateless: zero client/patient data stored)
- Admin frontend (username/password auth, drag-and-drop flowchart editor)
- Tree persistence (draft + published), validation, and JSON/Mermaid/Markdown exports
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import hmac
from http import cookies, HTTPStatus
from io import BytesIO
import json
import mimetypes
import os
from pathlib import Path
import secrets
from socketserver import ThreadingMixIn
import sqlite3
import sys
import threading
import time
from typing import Any, Callable
from urllib.parse import parse_qs
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server

from sample_tree import SAMPLE_TREE

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = Path(os.environ.get("MEDINETZ_DATA_DIR", BASE_DIR / "data"))
DB_PATH = DATA_DIR / "medinetz.db"

SESSION_COOKIE_NAME = "medinetz_admin_session"
SESSION_TTL_SECONDS = 60 * 60 * 12  # 12 hours
PBKDF2_ITERATIONS = 200_000
MAX_BODY_BYTES = 2 * 1024 * 1024  # 2 MB

VALID_NODE_TYPES = {"question", "outcome"}
VALID_OUTCOME_LEVELS = {"urgent", "action", "referral", "info"}

DB_LOCK = threading.Lock()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def hash_password(password: str, salt: bytes | None = None) -> str:
    if salt is None:
        salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, iters_str, salt_hex, digest_hex = encoded.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        iterations = int(iters_str)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except (ValueError, TypeError):
        return False
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(candidate, expected)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def get_connection(db_path: Path = DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def validate_tree_payload(data: Any) -> tuple[dict[str, Any] | None, list[str]]:
    """Validate and normalize a decision tree JSON object."""
    errors: list[str] = []
    if not isinstance(data, dict):
        return None, ["Tree payload must be a JSON object."]

    title = str(data.get("title", "")).strip()
    if not title:
        errors.append("Tree title is required.")
    description = str(data.get("description", "")).strip()

    raw_nodes = data.get("nodes")
    raw_edges = data.get("edges")
    if not isinstance(raw_nodes, list) or len(raw_nodes) == 0:
        errors.append("At least one node is required.")
        return None, errors
    if not isinstance(raw_edges, list):
        errors.append("Edges must be a list.")
        return None, errors

    nodes: list[dict[str, Any]] = []
    seen_node_ids: set[str] = set()
    for idx, raw_node in enumerate(raw_nodes):
        if not isinstance(raw_node, dict):
            errors.append(f"Node at index {idx} must be an object.")
            continue
        node_id = str(raw_node.get("id", "")).strip()
        if not node_id:
            errors.append(f"Node at index {idx} is missing an id.")
            continue
        if node_id in seen_node_ids:
            errors.append(f"Duplicate node id '{node_id}'.")
            continue
        seen_node_ids.add(node_id)

        node_type = str(raw_node.get("type", "question")).strip()
        if node_type not in VALID_NODE_TYPES:
            errors.append(f"Node '{node_id}' has invalid type '{node_type}'.")
            continue

        node_title = str(raw_node.get("title", "")).strip() or "Untitled Step"
        prompt = str(raw_node.get("prompt", "")).strip()
        guidance = str(raw_node.get("guidance", "")).strip()

        outcome_level = str(raw_node.get("outcomeLevel", "action")).strip()
        if outcome_level not in VALID_OUTCOME_LEVELS:
            outcome_level = "action"

        raw_checklist = raw_node.get("checklist", [])
        checklist: list[str] = []
        if isinstance(raw_checklist, list):
            checklist = [str(item).strip() for item in raw_checklist if str(item).strip()]

        raw_pos = raw_node.get("position", {})
        try:
            pos_x = float(raw_pos.get("x", 0)) if isinstance(raw_pos, dict) else 0.0
            pos_y = float(raw_pos.get("y", 0)) if isinstance(raw_pos, dict) else 0.0
        except (TypeError, ValueError):
            pos_x, pos_y = 0.0, 0.0

        nodes.append(
            {
                "id": node_id,
                "type": node_type,
                "title": node_title,
                "prompt": prompt,
                "guidance": guidance,
                "outcomeLevel": outcome_level,
                "checklist": checklist,
                "position": {"x": round(pos_x, 2), "y": round(pos_y, 2)},
            }
        )

    root_node_id = str(data.get("rootNodeId", "")).strip()
    if root_node_id not in seen_node_ids:
        errors.append("rootNodeId must reference an existing node.")

    edges: list[dict[str, Any]] = []
    seen_edge_ids: set[str] = set()
    for idx, raw_edge in enumerate(raw_edges):
        if not isinstance(raw_edge, dict):
            errors.append(f"Edge at index {idx} must be an object.")
            continue
        edge_id = str(raw_edge.get("id", "")).strip() or f"e_{idx + 1}"
        if edge_id in seen_edge_ids:
            errors.append(f"Duplicate edge id '{edge_id}'.")
            continue
        seen_edge_ids.add(edge_id)

        source = str(raw_edge.get("source", "")).strip()
        target = str(raw_edge.get("target", "")).strip()
        if source not in seen_node_ids or target not in seen_node_ids:
            errors.append(f"Edge '{edge_id}' references a missing source or target node.")
            continue
        if source == target:
            errors.append(f"Edge '{edge_id}' cannot connect a node to itself.")
            continue

        label = str(raw_edge.get("label", "")).strip() or "Next"
        try:
            order = int(raw_edge.get("order", idx + 1))
        except (TypeError, ValueError):
            order = idx + 1

        edges.append(
            {
                "id": edge_id,
                "source": source,
                "target": target,
                "label": label,
                "order": order,
            }
        )

    if errors:
        return None, errors

    normalized = {
        "title": title,
        "description": description,
        "rootNodeId": root_node_id,
        "nodes": nodes,
        "edges": edges,
    }
    return normalized, []


def tree_to_mermaid(tree: dict[str, Any]) -> str:
    """Render a decision tree as a Mermaid flowchart."""
    lines = ["flowchart TD"]
    node_map = {n["id"]: n for n in tree.get("nodes", [])}

    def esc(text: str) -> str:
        return text.replace('"', "'").replace("\n", " ").strip()

    for node in tree.get("nodes", []):
        nid = node["id"]
        label = esc(node.get("title") or nid)
        if node.get("type") == "outcome":
            lines.append(f'    {nid}(["{label}"])')
        elif nid == tree.get("rootNodeId"):
            lines.append(f'    {nid}{{"START: {label}"}}')
        else:
            lines.append(f'    {nid}{{"{label}"}}')

    sorted_edges = sorted(tree.get("edges", []), key=lambda e: (e.get("source", ""), e.get("order", 0)))
    for edge in sorted_edges:
        src = edge["source"]
        tgt = edge["target"]
        if src in node_map and tgt in node_map:
            lbl = esc(edge.get("label", ""))
            lines.append(f'    {src} -->|"{lbl}"| {tgt}')

    return "\n".join(lines) + "\n"


def tree_to_markdown(tree: dict[str, Any]) -> str:
    """Render a human-readable Markdown guide for the decision tree."""
    lines = [
        f"# {tree.get('title', 'Decision Tree')}",
        "",
    ]
    if tree.get("description"):
        lines.extend([tree["description"], ""])

    node_map = {n["id"]: n for n in tree.get("nodes", [])}
    outgoing: dict[str, list[dict[str, Any]]] = {}
    for edge in tree.get("edges", []):
        outgoing.setdefault(edge["source"], []).append(edge)
    for lst in outgoing.values():
        lst.sort(key=lambda e: e.get("order", 0))

    lines.append(f"**Start Node:** `{tree.get('rootNodeId')}`")
    lines.append("")

    for node in tree.get("nodes", []):
        nid = node["id"]
        kind = "Outcome" if node["type"] == "outcome" else "Question"
        badge = f" [{node['outcomeLevel'].upper()}]" if node["type"] == "outcome" else ""
        lines.append(f"## {node['title']} (`{nid}` — {kind}{badge})")
        if node.get("prompt"):
            lines.extend(["", node["prompt"]])
        if node.get("guidance"):
            lines.extend(["", f"> **Guidance:** {node['guidance']}"])
        if node.get("checklist"):
            lines.append("")
            for item in node["checklist"]:
                lines.append(f"- [ ] {item}")
        branches = outgoing.get(nid, [])
        if branches:
            lines.extend(["", "**Branches:**"])
            for edge in branches:
                tgt_title = node_map.get(edge["target"], {}).get("title", edge["target"])
                lines.append(f"- **{edge['label']}** -> {tgt_title} (`{edge['target']}`)")
        lines.append("")

    return "\n".join(lines)


class Database:
    """Thread-safe SQLite wrapper storing only admin credentials, sessions, and tree definitions."""

    def __init__(self, db_path: Path = DB_PATH) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.init_schema()

    def init_schema(self) -> None:
        with DB_LOCK, get_connection(self.db_path) as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS admins (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    admin_id INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS trees (
                    slug TEXT PRIMARY KEY,
                    draft_json TEXT NOT NULL,
                    published_json TEXT NOT NULL,
                    draft_version INTEGER NOT NULL DEFAULT 1,
                    published_version INTEGER NOT NULL DEFAULT 1,
                    updated_at TEXT NOT NULL,
                    published_at TEXT NOT NULL,
                    updated_by TEXT NOT NULL
                );
                """
            )
            self._seed_defaults(conn)

    def _seed_defaults(self, conn: sqlite3.Connection) -> None:
        admin_count = conn.execute("SELECT COUNT(*) FROM admins").fetchone()[0]
        if admin_count == 0:
            default_user = os.environ.get("MEDINETZ_ADMIN_USER", "admin").strip() or "admin"
            default_pass = os.environ.get("MEDINETZ_ADMIN_PASSWORD", "medinetz-admin")
            conn.execute(
                "INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)",
                (default_user, hash_password(default_pass), utc_now_iso()),
            )

        tree_count = conn.execute("SELECT COUNT(*) FROM trees").fetchone()[0]
        if tree_count == 0:
            now = utc_now_iso()
            serialized = json.dumps(SAMPLE_TREE)
            conn.execute(
                """
                INSERT INTO trees (
                    slug, draft_json, published_json, draft_version, published_version,
                    updated_at, published_at, updated_by
                ) VALUES (?, ?, ?, 1, 1, ?, ?, ?)
                """,
                ("default", serialized, serialized, now, now, "system"),
            )

    def authenticate_admin(self, username: str, password: str) -> dict[str, Any] | None:
        with DB_LOCK, get_connection(self.db_path) as conn:
            row = conn.execute(
                "SELECT id, username, password_hash FROM admins WHERE username = ?",
                (username,),
            ).fetchone()
            if not row or not verify_password(password, row["password_hash"]):
                return None
            token = secrets.token_urlsafe(32)
            expires_at = int(time.time()) + SESSION_TTL_SECONDS
            conn.execute(
                "DELETE FROM sessions WHERE expires_at < ?",
                (int(time.time()),),
            )
            conn.execute(
                "INSERT INTO sessions (token_hash, admin_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
                (hash_token(token), row["id"], expires_at, utc_now_iso()),
            )
            return {"token": token, "id": row["id"], "username": row["username"], "expiresAt": expires_at}

    def get_session_admin(self, token: str | None) -> dict[str, Any] | None:
        if not token:
            return None
        with DB_LOCK, get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT a.id, a.username, s.expires_at
                FROM sessions s
                JOIN admins a ON a.id = s.admin_id
                WHERE s.token_hash = ?
                """,
                (hash_token(token),),
            ).fetchone()
            if not row:
                return None
            if int(row["expires_at"]) < int(time.time()):
                conn.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(token),))
                return None
            return {"id": row["id"], "username": row["username"]}

    def logout_session(self, token: str | None) -> None:
        if not token:
            return
        with DB_LOCK, get_connection(self.db_path) as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(token),))

    def change_password(self, admin_id: int, current_password: str, new_password: str) -> tuple[bool, str]:
        if len(new_password) < 8:
            return False, "New password must be at least 8 characters long."
        with DB_LOCK, get_connection(self.db_path) as conn:
            row = conn.execute("SELECT password_hash FROM admins WHERE id = ?", (admin_id,)).fetchone()
            if not row or not verify_password(current_password, row["password_hash"]):
                return False, "Current password is incorrect."
            conn.execute(
                "UPDATE admins SET password_hash = ? WHERE id = ?",
                (hash_password(new_password), admin_id),
            )
            return True, "Password updated."

    def upsert_admin(self, username: str, password: str) -> None:
        with DB_LOCK, get_connection(self.db_path) as conn:
            existing = conn.execute("SELECT id FROM admins WHERE username = ?", (username,)).fetchone()
            if existing:
                conn.execute(
                    "UPDATE admins SET password_hash = ? WHERE id = ?",
                    (hash_password(password), existing["id"]),
                )
            else:
                conn.execute(
                    "INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)",
                    (username, hash_password(password), utc_now_iso()),
                )

    def get_published_tree(self) -> dict[str, Any]:
        with DB_LOCK, get_connection(self.db_path) as conn:
            row = conn.execute(
                "SELECT published_json, published_version, published_at FROM trees WHERE slug = 'default'"
            ).fetchone()
            tree = json.loads(row["published_json"])
            return {
                "tree": tree,
                "version": row["published_version"],
                "publishedAt": row["published_at"],
            }

    def get_admin_tree(self) -> dict[str, Any]:
        with DB_LOCK, get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT draft_json, published_json, draft_version, published_version,
                       updated_at, published_at, updated_by
                FROM trees WHERE slug = 'default'
                """
            ).fetchone()
            return {
                "tree": json.loads(row["draft_json"]),
                "draftVersion": row["draft_version"],
                "publishedVersion": row["published_version"],
                "hasUnpublishedChanges": row["draft_json"] != row["published_json"],
                "updatedAt": row["updated_at"],
                "publishedAt": row["published_at"],
                "updatedBy": row["updated_by"],
            }

    def save_tree(self, tree: dict[str, Any], username: str, publish: bool = False) -> dict[str, Any]:
        serialized = json.dumps(tree)
        now = utc_now_iso()
        with DB_LOCK, get_connection(self.db_path) as conn:
            row = conn.execute(
                "SELECT draft_version, published_version FROM trees WHERE slug = 'default'"
            ).fetchone()
            next_draft_version = int(row["draft_version"]) + 1
            if publish:
                next_pub_version = int(row["published_version"]) + 1
                conn.execute(
                    """
                    UPDATE trees
                    SET draft_json = ?, published_json = ?, draft_version = ?,
                        published_version = ?, updated_at = ?, published_at = ?, updated_by = ?
                    WHERE slug = 'default'
                    """,
                    (serialized, serialized, next_draft_version, next_pub_version, now, now, username),
                )
            else:
                conn.execute(
                    """
                    UPDATE trees
                    SET draft_json = ?, draft_version = ?, updated_at = ?, updated_by = ?
                    WHERE slug = 'default'
                    """,
                    (serialized, next_draft_version, now, username),
                )
        return self.get_admin_tree()

    def publish_draft(self, username: str) -> dict[str, Any]:
        now = utc_now_iso()
        with DB_LOCK, get_connection(self.db_path) as conn:
            row = conn.execute(
                "SELECT draft_json, published_version FROM trees WHERE slug = 'default'"
            ).fetchone()
            next_pub_version = int(row["published_version"]) + 1
            conn.execute(
                """
                UPDATE trees
                SET published_json = ?, published_version = ?, published_at = ?, updated_by = ?
                WHERE slug = 'default'
                """,
                (row["draft_json"], next_pub_version, now, username),
            )
        return self.get_admin_tree()


def _status_line(code: int) -> str:
    try:
        phrase = HTTPStatus(code).phrase
    except ValueError:
        phrase = "OK"
    return f"{code} {phrase}"


class MedinetzApp:
    """Framework-free WSGI application compatible with PythonAnywhere and standalone servers."""

    def __init__(self, db: Database) -> None:
        self.db = db

    def __call__(self, environ: dict[str, Any], start_response: Callable[..., Any]) -> list[bytes]:
        method = environ.get("REQUEST_METHOD", "GET").upper()
        path = environ.get("PATH_INFO", "/") or "/"
        query_string = environ.get("QUERY_STRING", "")

        status_code, headers, body = self._dispatch(method, path, query_string, environ)
        start_response(_status_line(status_code), headers)
        return [body]

    def _json_response(
        self, status: int, payload: dict[str, Any], extra_headers: list[tuple[str, str]] | None = None
    ) -> tuple[int, list[tuple[str, str]], bytes]:
        body = json.dumps(payload).encode("utf-8")
        headers = [
            ("Content-Type", "application/json; charset=utf-8"),
            ("Content-Length", str(len(body))),
            ("Cache-Control", "no-store"),
        ]
        if extra_headers:
            headers.extend(extra_headers)
        return status, headers, body

    def _text_response(
        self,
        status: int,
        text: str,
        content_type: str = "text/plain; charset=utf-8",
        download_filename: str | None = None,
    ) -> tuple[int, list[tuple[str, str]], bytes]:
        body = text.encode("utf-8")
        headers = [
            ("Content-Type", content_type),
            ("Content-Length", str(len(body))),
            ("Cache-Control", "no-store"),
        ]
        if download_filename:
            headers.append(("Content-Disposition", f'attachment; filename="{download_filename}"'))
        return status, headers, body

    def _serve_file(self, file_path: Path) -> tuple[int, list[tuple[str, str]], bytes]:
        if not file_path.exists() or not file_path.is_file():
            return self._json_response(404, {"error": "Not found"})
        resolved = file_path.resolve()
        if not str(resolved).startswith(str(STATIC_DIR.resolve())):
            return self._json_response(403, {"error": "Forbidden"})
        mime_type, _ = mimetypes.guess_type(str(resolved))
        if resolved.suffix == ".js":
            mime_type = "application/javascript; charset=utf-8"
        elif resolved.suffix == ".css":
            mime_type = "text/css; charset=utf-8"
        elif resolved.suffix == ".html":
            mime_type = "text/html; charset=utf-8"
        elif resolved.suffix == ".svg":
            mime_type = "image/svg+xml"
        data = resolved.read_bytes()
        headers = [
            ("Content-Type", mime_type or "application/octet-stream"),
            ("Content-Length", str(len(data))),
            ("Cache-Control", "no-cache"),
        ]
        return 200, headers, data

    def _read_json_body(self, environ: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
        try:
            length = int(environ.get("CONTENT_LENGTH") or "0")
        except ValueError:
            return None, "Invalid Content-Length header."
        if length <= 0:
            return {}, None
        if length > MAX_BODY_BYTES:
            return None, "Request body too large."
        stream = environ.get("wsgi.input")
        if stream is None:
            return {}, None
        raw = stream.read(length)
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None, "Invalid JSON payload."
        if not isinstance(parsed, dict):
            return None, "JSON body must be an object."
        return parsed, None

    def _get_session_token(self, environ: dict[str, Any]) -> str | None:
        raw_cookie = environ.get("HTTP_COOKIE", "")
        if not raw_cookie:
            return None
        jar = cookies.SimpleCookie()
        try:
            jar.load(raw_cookie)
        except cookies.CookieError:
            return None
        morsel = jar.get(SESSION_COOKIE_NAME)
        return morsel.value if morsel else None

    def _is_https(self, environ: dict[str, Any]) -> bool:
        return (
            environ.get("wsgi.url_scheme", "").lower() == "https"
            or environ.get("HTTP_X_FORWARDED_PROTO", "").lower() == "https"
        )

    def _cookie_header(self, environ: dict[str, Any], value: str, max_age: int) -> tuple[str, str]:
        secure_attr = "; Secure" if self._is_https(environ) else ""
        return (
            "Set-Cookie",
            f"{SESSION_COOKIE_NAME}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure_attr}",
        )

    def _dispatch(
        self, method: str, path: str, query_string: str, environ: dict[str, Any]
    ) -> tuple[int, list[tuple[str, str]], bytes]:
        if method == "GET":
            if path in ("/", "/volunteer", "/volunteer/"):
                return self._serve_file(STATIC_DIR / "index.html")
            if path in ("/admin", "/admin/"):
                return self._serve_file(STATIC_DIR / "admin.html")
            if path.startswith("/static/"):
                return self._serve_file(STATIC_DIR / path[len("/static/"):])
            if path == "/api/health":
                return self._json_response(200, {"status": "ok", "stateless": True})
            if path == "/api/tree/published":
                return self._json_response(200, self.db.get_published_tree())
            if path == "/api/admin/me":
                admin = self.db.get_session_admin(self._get_session_token(environ))
                if not admin:
                    return self._json_response(200, {"authenticated": False})
                return self._json_response(200, {"authenticated": True, "admin": admin})
            if path == "/api/admin/tree":
                admin = self.db.get_session_admin(self._get_session_token(environ))
                if not admin:
                    return self._json_response(401, {"error": "Authentication required."})
                return self._json_response(200, self.db.get_admin_tree())
            if path == "/api/admin/tree/export":
                admin = self.db.get_session_admin(self._get_session_token(environ))
                if not admin:
                    return self._json_response(401, {"error": "Authentication required."})
                query = parse_qs(query_string)
                fmt = (query.get("format", ["json"])[0] or "json").lower()
                scope = (query.get("scope", ["draft"])[0] or "draft").lower()
                tree_data = (
                    self.db.get_published_tree()["tree"]
                    if scope == "published"
                    else self.db.get_admin_tree()["tree"]
                )
                if fmt == "json":
                    return self._text_response(
                        200,
                        json.dumps(tree_data, indent=2),
                        "application/json; charset=utf-8",
                        "medinetz-decision-tree.json",
                    )
                if fmt == "mermaid":
                    return self._text_response(
                        200,
                        tree_to_mermaid(tree_data),
                        "text/plain; charset=utf-8",
                        "medinetz-decision-tree.mmd",
                    )
                if fmt == "markdown":
                    return self._text_response(
                        200,
                        tree_to_markdown(tree_data),
                        "text/markdown; charset=utf-8",
                        "medinetz-decision-tree.md",
                    )
                return self._json_response(400, {"error": f"Unsupported export format '{fmt}'."})
            return self._json_response(404, {"error": "Endpoint not found."})

        if method == "POST":
            if path == "/api/admin/login":
                body, err = self._read_json_body(environ)
                if err or body is None:
                    return self._json_response(400, {"error": err or "Invalid request."})
                username = str(body.get("username", "")).strip()
                password = str(body.get("password", ""))
                session = self.db.authenticate_admin(username, password)
                if not session:
                    return self._json_response(401, {"error": "Invalid username or password."})
                return self._json_response(
                    200,
                    {"authenticated": True, "admin": {"id": session["id"], "username": session["username"]}},
                    extra_headers=[self._cookie_header(environ, session["token"], SESSION_TTL_SECONDS)],
                )
            if path == "/api/admin/logout":
                self.db.logout_session(self._get_session_token(environ))
                return self._json_response(
                    200,
                    {"authenticated": False},
                    extra_headers=[self._cookie_header(environ, "", 0)],
                )
            if path == "/api/admin/password":
                admin = self.db.get_session_admin(self._get_session_token(environ))
                if not admin:
                    return self._json_response(401, {"error": "Authentication required."})
                body, err = self._read_json_body(environ)
                if err or body is None:
                    return self._json_response(400, {"error": err or "Invalid request."})
                ok, msg = self.db.change_password(
                    admin["id"],
                    str(body.get("currentPassword", "")),
                    str(body.get("newPassword", "")),
                )
                if not ok:
                    return self._json_response(400, {"error": msg})
                return self._json_response(200, {"message": msg})
            if path == "/api/admin/tree/publish":
                admin = self.db.get_session_admin(self._get_session_token(environ))
                if not admin:
                    return self._json_response(401, {"error": "Authentication required."})
                return self._json_response(200, self.db.publish_draft(admin["username"]))
            if path == "/api/admin/tree/import":
                admin = self.db.get_session_admin(self._get_session_token(environ))
                if not admin:
                    return self._json_response(401, {"error": "Authentication required."})
                body, err = self._read_json_body(environ)
                if err or body is None:
                    return self._json_response(400, {"error": err or "Invalid request."})
                tree_payload = body.get("tree", body)
                normalized, errors = validate_tree_payload(tree_payload)
                if errors or normalized is None:
                    return self._json_response(400, {"error": "Validation failed.", "details": errors})
                publish = bool(body.get("publish", False))
                return self._json_response(200, self.db.save_tree(normalized, admin["username"], publish=publish))
            return self._json_response(404, {"error": "Endpoint not found."})

        if method == "PUT":
            if path == "/api/admin/tree":
                admin = self.db.get_session_admin(self._get_session_token(environ))
                if not admin:
                    return self._json_response(401, {"error": "Authentication required."})
                body, err = self._read_json_body(environ)
                if err or body is None:
                    return self._json_response(400, {"error": err or "Invalid request."})
                tree_payload = body.get("tree", body)
                normalized, errors = validate_tree_payload(tree_payload)
                if errors or normalized is None:
                    return self._json_response(400, {"error": "Validation failed.", "details": errors})
                publish = bool(body.get("publish", False))
                return self._json_response(200, self.db.save_tree(normalized, admin["username"], publish=publish))
            return self._json_response(404, {"error": "Endpoint not found."})

        return self._json_response(405, {"error": "Method not allowed."})


def create_app(db_path: Path = DB_PATH) -> MedinetzApp:
    """Create a WSGI application instance."""
    return MedinetzApp(Database(db_path=db_path))


class ThreadingWSGIServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True


class QuietWSGIHandler(WSGIRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write(f"[http] {self.command} {self.path.split('?', 1)[0]} -> {args[1] if len(args) > 1 else ''}\n")


def create_server(host: str = "127.0.0.1", port: int = 8080, db_path: Path = DB_PATH) -> ThreadingWSGIServer:
    app = create_app(db_path=db_path)
    return make_server(host, port, app, server_class=ThreadingWSGIServer, handler_class=QuietWSGIHandler)


def main() -> None:
    parser = argparse.ArgumentParser(description="Medinetz Decision Tree Server")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8080")))
    parser.add_argument("--set-admin", nargs=2, metavar=("USERNAME", "PASSWORD"), help="Create or update an admin user and exit")
    args = parser.parse_args()

    if args.set_admin:
        db = Database()
        db.upsert_admin(args.set_admin[0], args.set_admin[1])
        print(f"Admin user '{args.set_admin[0]}' configured.")
        return

    server = create_server(host=args.host, port=args.port)
    print(f"Medinetz Decision Tree running at http://{args.host}:{args.port}")
    print(f"  Volunteer view: http://{args.host}:{args.port}/")
    print(f"  Admin studio:   http://{args.host}:{args.port}/admin")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
