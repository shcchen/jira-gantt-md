#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
ISSUES_DIR = ROOT / "issues"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]+", "-", value.strip()).strip("-").lower()
    return slug[:48] or "issue"


def issue_path(issue_id: str, title: str = "issue") -> Path:
    existing = next(ISSUES_DIR.glob(f"{issue_id}-*.md"), None)
    if existing:
        return existing
    return ISSUES_DIR / f"{issue_id}-{slugify(title)}.md"


def parse_markdown(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8")
    meta: dict[str, str] = {}
    body = raw

    if raw.startswith("---\n"):
        _, rest = raw.split("---\n", 1)
        front, body = rest.split("\n---\n", 1) if "\n---\n" in rest else (rest, "")
        for line in front.splitlines():
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            meta[key.strip()] = value.strip()

    return {
        "id": meta.get("id", path.stem.split("-", 1)[0]),
        "parent_id": meta.get("parent_id", ""),
        "title": meta.get("title", "未命名項目"),
        "created_at": meta.get("created_at", ""),
        "start_date": meta.get("start_date", ""),
        "deadline": meta.get("deadline", ""),
        "status": meta.get("status", "todo"),
        "description": body.strip(),
        "file": str(path.relative_to(ROOT)),
    }


def write_issue(issue: dict) -> dict:
    ISSUES_DIR.mkdir(exist_ok=True)
    issue_id = issue.get("id") or uuid.uuid4().hex[:8]
    created_at = issue.get("created_at") or utc_now()
    saved = {
        "id": issue_id,
        "parent_id": issue.get("parent_id", ""),
        "title": issue.get("title", "").strip() or "未命名項目",
        "created_at": created_at,
        "start_date": issue.get("start_date", ""),
        "deadline": issue.get("deadline", ""),
        "status": issue.get("status", "todo"),
        "description": issue.get("description", "").strip(),
    }
    path = issue_path(issue_id, saved["title"])
    new_path = ISSUES_DIR / f"{issue_id}-{slugify(saved['title'])}.md"
    if path != new_path and path.exists():
        path.rename(new_path)
        path = new_path

    front_matter = "\n".join(
        [
            "---",
            f"id: {saved['id']}",
            f"parent_id: {saved['parent_id']}",
            f"title: {saved['title']}",
            f"created_at: {saved['created_at']}",
            f"start_date: {saved['start_date']}",
            f"deadline: {saved['deadline']}",
            f"status: {saved['status']}",
            "---",
            "",
            saved["description"],
            "",
        ]
    )
    path.write_text(front_matter, encoding="utf-8")
    saved["file"] = str(path.relative_to(ROOT))
    return saved


def read_issues() -> list[dict]:
    ISSUES_DIR.mkdir(exist_ok=True)
    issues = [parse_markdown(path) for path in ISSUES_DIR.glob("*.md")]
    return sorted(issues, key=lambda item: (item.get("created_at") or "", item.get("title") or ""))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/issues":
            self.send_json(read_issues())
            return
        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/issues":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_json(write_issue(self.read_json()), HTTPStatus.CREATED)

    def do_PUT(self) -> None:
        match = re.fullmatch(r"/api/issues/([^/]+)", urlparse(self.path).path)
        if not match:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        payload = self.read_json()
        payload["id"] = unquote(match.group(1))
        self.send_json(write_issue(payload))

    def do_DELETE(self) -> None:
        match = re.fullmatch(r"/api/issues/([^/]+)", urlparse(self.path).path)
        if not match:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        issue_id = unquote(match.group(1))
        removed = False
        for issue_file in ISSUES_DIR.glob(f"{issue_id}-*.md"):
            issue_file.unlink()
            removed = True
        self.send_json({"ok": removed})

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        return json.loads(raw)

    def send_json(self, payload: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_static(self, request_path: str) -> None:
        relative = "index.html" if request_path in ("", "/") else request_path.lstrip("/")
        path = (STATIC_DIR / relative).resolve()
        if not path.is_file() or STATIC_DIR not in path.parents:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        content_type = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
        }.get(path.suffix, "application/octet-stream")
        body = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}")


if __name__ == "__main__":
    ISSUES_DIR.mkdir(exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 8000), Handler)
    print("Jira Gantt MD prototype running at http://127.0.0.1:8000")
    server.serve_forever()
