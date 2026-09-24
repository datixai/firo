"""
api/config.py
─────────────────────────────────────────────────────────────
GET /api/config  →  client-safe runtime config for the dashboard.

Runs as a Vercel Python serverless function in production and is
reused by scripts/dev_server.py when running locally.

Only PUBLIC Firebase web-app settings are returned (the same values
Firebase shows under Project Settings → Your apps → Web app).
The service-account private key is never read or exposed here.

Environment variables (set in Vercel → Project → Settings →
Environment Variables, or in .env.local for local development):

  FIREBASE_API_KEY              (required)
  FIREBASE_AUTH_DOMAIN          (required)
  FIREBASE_PROJECT_ID           (required)
  FIREBASE_APP_ID               (required)
  FIREBASE_STORAGE_BUCKET       (optional)
  FIREBASE_MESSAGING_SENDER_ID  (optional)
  FIRO_WHATSAPP_NUMBER          (optional, international format without "+")
  FIRO_CONTACT_EMAIL            (optional, shown on the Contact page)
  FIRO_GOOGLE_MAPS_KEY          (optional, use Google Maps in the control room;
                                 restrict it to your site's domain in Google Cloud)
  FIRO_GOOGLE_MAP_ID            (optional, Google Maps map ID; default DEMO_MAP_ID)
─────────────────────────────────────────────────────────────
"""

import json
import os
from http.server import BaseHTTPRequestHandler

# Firebase client config key → environment variable name
FIREBASE_ENV_VARS = {
    "apiKey":            "FIREBASE_API_KEY",
    "authDomain":        "FIREBASE_AUTH_DOMAIN",
    "projectId":         "FIREBASE_PROJECT_ID",
    "storageBucket":     "FIREBASE_STORAGE_BUCKET",
    "messagingSenderId": "FIREBASE_MESSAGING_SENDER_ID",
    "appId":             "FIREBASE_APP_ID",
}
REQUIRED_KEYS = ("apiKey", "authDomain", "projectId", "appId")

# Forest Department WhatsApp number used by the "Send" button
DEFAULT_WHATSAPP_NUMBER = "923408226347"


def build_config(env=None):
    """
    Build the client config from environment variables.
    Returns (config_dict, missing_env_var_names).
    """
    env = os.environ if env is None else env
    firebase = {key: env.get(var, "").strip() for key, var in FIREBASE_ENV_VARS.items()}
    firebase = {key: value for key, value in firebase.items() if value}
    missing = [FIREBASE_ENV_VARS[key] for key in REQUIRED_KEYS if key not in firebase]

    config = {
        "firebase": firebase,
        "whatsappNumber": env.get("FIRO_WHATSAPP_NUMBER", "").strip() or DEFAULT_WHATSAPP_NUMBER,
        "contactEmail": env.get("FIRO_CONTACT_EMAIL", "").strip(),
        "googleMapsKey": env.get("FIRO_GOOGLE_MAPS_KEY", "").strip(),
        "googleMapId": env.get("FIRO_GOOGLE_MAP_ID", "").strip(),
    }
    return config, missing


def config_response(env=None):
    """Return (http_status, json_bytes) for GET /api/config."""
    config, missing = build_config(env)
    if missing:
        body = {"error": "Missing environment variables: " + ", ".join(missing)}
        return 500, json.dumps(body).encode("utf-8")
    return 200, json.dumps(config).encode("utf-8")


class handler(BaseHTTPRequestHandler):
    """Vercel Python runtime entry point."""

    def do_GET(self):
        status, body = config_response()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
