#!/usr/bin/env python3
import json
import os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
os.makedirs(DATA_DIR, exist_ok=True)

DATA_FILES = {
    "announcements": "announcements.json",
    "matches": "matches.json",
    "teams": "teams.json",
}


def read_json(name, default):
    path = os.path.join(DATA_DIR, DATA_FILES[name])
    if not os.path.exists(path):
        write_json(name, default)
        return default
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return default


def write_json(name, value):
    path = os.path.join(DATA_DIR, DATA_FILES[name])
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(value, fh, ensure_ascii=False, indent=2)


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/announcements":
            self.send_json(read_json("announcements", []))
            return
        if parsed.path == "/api/matches":
            self.send_json(read_json("matches", []))
            return
        if parsed.path == "/api/teams":
            self.send_json(read_json("teams", {}))
            return
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"
        try:
            payload = json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
            return

        if parsed.path == "/api/announcements":
            if isinstance(payload, list):
                write_json("announcements", payload)
                self.send_json({"ok": True, "data": payload})
                return
            items = read_json("announcements", [])
            items.insert(0, payload)
            write_json("announcements", items)
            self.send_json({"ok": True, "data": items})
            return

        if parsed.path == "/api/matches":
            if isinstance(payload, list):
                write_json("matches", payload)
                self.send_json({"ok": True, "data": payload})
                return
            items = read_json("matches", [])
            items.append(payload)
            write_json("matches", items)
            self.send_json({"ok": True, "data": items})
            return

        if parsed.path == "/api/teams":
            items = read_json("teams", {})
            if isinstance(payload, dict):
                items.update(payload)
                write_json("teams", items)
                self.send_json({"ok": True, "data": items})
                return
            if isinstance(payload, list):
                write_json("teams", payload)
                self.send_json({"ok": True, "data": payload})
                return
            write_json("teams", items)
            self.send_json({"ok": True, "data": items})
            return

        self.send_error(404, "Not found")

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/matches/"):
            match_id = parsed.path.split("/")[-1]
            items = read_json("matches", [])
            items = [item for item in items if item.get("id") != match_id]
            write_json("matches", items)
            self.send_json({"ok": True, "data": items})
            return
        self.send_error(404, "Not found")

    def send_json(self, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


if __name__ == "__main__":
    port = 8000
    print(f"Serving on http://localhost:{port}")
    ThreadingHTTPServer(("0.0.0.0", port), AppHandler).serve_forever()
