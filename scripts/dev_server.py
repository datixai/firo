"""
scripts/dev_server.py
─────────────────────────────────────────────────────────────
Local preview server that behaves like the Vercel deployment:

  • serves the static site from  public/
  • clean URLs:  /login → public/login.html,  /login.html → 308 /login
  • GET /api/config  → same code as the Vercel function (api/config.py)

No pip install needed (standard library only).

Usage (from the repo root, venv optional):

    python scripts/dev_server.py            # http://localhost:3000
    python scripts/dev_server.py --port 8080

Config is read from (first match wins per variable):
  1. real environment variables
  2. .env.local  (or .env) in the repo root   ← see .env.example
  3. the "firebase_client" section of secrets/service_account_key.json
─────────────────────────────────────────────────────────────
"""

import argparse
import importlib.util
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ROOT_DIR   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_DIR = os.path.join(ROOT_DIR, "public")
KEY_PATH   = os.environ.get("FIRO_KEY_PATH", os.path.join(ROOT_DIR, "secrets", "service_account_key.json"))

# Load api/config.py by path so local and Vercel share one implementation
_spec = importlib.util.spec_from_file_location("firo_api_config", os.path.join(ROOT_DIR, "api", "config.py"))
api_config = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(api_config)


def read_dotenv(path):
    """Minimal KEY=VALUE parser (ignores comments and blank lines)."""
    values = {}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def read_service_key_client_config(path):
    """Map the firebase_client section of service_account_key.json to env var names."""
    with open(path, "r", encoding="utf-8") as f:
        client = json.load(f).get("firebase_client", {})
    return {
        env_var: client[key]
        for key, env_var in api_config.FIREBASE_ENV_VARS.items()
        if client.get(key)
    }


def load_local_env():
    env = {}
    source = None
    if os.path.exists(KEY_PATH):
        env.update(read_service_key_client_config(KEY_PATH))
        source = os.path.relpath(KEY_PATH, ROOT_DIR)
    for name in (".env", ".env.local"):
        path = os.path.join(ROOT_DIR, name)
        if os.path.exists(path):
            env.update(read_dotenv(path))
            source = name
    env.update(os.environ)
    return env, source


class DevHandler(SimpleHTTPRequestHandler):
    env = {}
    # Windows can map .js to text/plain via the registry, which breaks ES modules
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js":   "text/javascript",
        ".json": "application/json",
        ".png":  "image/png",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def end_headers(self):
        # Always fetch fresh files while developing
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = urlsplit(self.path).path

        if path == "/api/config":
            status, body = api_config.config_response(self.env)
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return

        # Vercel cleanUrls: /page.html → 308 /page  (and /index → /)
        if path.endswith(".html") or path == "/index":
            target = path[: -len(".html")] if path.endswith(".html") else path
            target = "/" if target in ("/index", "") else target
            self.send_response(308)
            self.send_header("Location", target)
            self.end_headers()
            return

        # /page → public/page.html
        if path != "/" and "." not in os.path.basename(path):
            candidate = os.path.join(PUBLIC_DIR, path.lstrip("/") + ".html")
            if os.path.isfile(candidate):
                self.path = path + ".html"

        super().do_GET()


def main():
    parser = argparse.ArgumentParser(description="FIRO local preview server")
    parser.add_argument("--port", type=int, default=3000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    env, source = load_local_env()
    DevHandler.env = env
    _, missing = api_config.build_config(env)

    print(f"[FIRO] Serving {os.path.relpath(PUBLIC_DIR, ROOT_DIR)}/ at http://localhost:{args.port}")
    if missing:
        print("[FIRO] WARNING: missing config values: " + ", ".join(missing))
        print("[FIRO]          Create .env.local from .env.example (or put your key in secrets/).")
    else:
        print(f"[FIRO] Firebase config loaded from: {source or 'environment variables'}")
    print("[FIRO] Press Ctrl+C to stop.")

    server = ThreadingHTTPServer((args.host, args.port), DevHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[FIRO] Stopped.")
        server.server_close()
        sys.exit(0)


if __name__ == "__main__":
    main()
