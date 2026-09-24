"""
api/seo.py
─────────────────────────────────────────────────────────────
Files for search engines and AI assistants, built on request so
they always list the current products and blog posts:

  /robots.txt   → GET /api/seo?file=robots
  /sitemap.xml  → GET /api/seo?file=sitemap
  /llms.txt     → GET /api/seo?file=llms     (summary for AI assistants,
                                              see https://llmstxt.org)

Products and posts are read from Firestore's public REST API (only
published items are readable, same as on the website). If Firestore
has none yet, the built-in items from public/js are used, just like
the website does.

Environment variables:
  FIRO_SITE_URL        (optional) e.g. https://firo.example.com
                        Default: the address the request came to.
  FIREBASE_PROJECT_ID  (required for live products and posts)
  FIREBASE_API_KEY     (required for live products and posts)
─────────────────────────────────────────────────────────────
"""

import json
import os
import re
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlsplit, parse_qs, quote
from xml.sax.saxutils import escape

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Public pages and how often they change
PAGES = [
    ("/",           "weekly",  "1.0"),
    ("/products",   "weekly",  "0.9"),
    ("/about",      "monthly", "0.8"),
    ("/report",     "monthly", "0.8"),
    ("/volunteers", "monthly", "0.7"),
    ("/donate",     "monthly", "0.7"),
    ("/blog",       "weekly",  "0.7"),
    ("/terms",      "yearly",  "0.3"),
    ("/privacy",    "yearly",  "0.3"),
]

PRIVATE_PATHS = ["/admin", "/login", "/dashboard", "/analytics", "/map",
                 "/incidents", "/cameras", "/logs", "/api/"]

# AI and search crawlers that are welcome (listed so the intent is explicit)
WELCOME_BOTS = ["Googlebot", "Bingbot", "GPTBot", "OAI-SearchBot", "ChatGPT-User",
                "Google-Extended", "ClaudeBot", "Claude-User", "PerplexityBot",
                "Applebot", "Applebot-Extended", "CCBot", "DuckDuckBot"]

REGIONS = ["Azad Jammu and Kashmir (AJK)", "Jammu and Kashmir", "Ladakh", "Gilgit-Baltistan",
           "Pakistan", "India", "United Kingdom", "United States", "Canada", "Italy",
           "Germany", "Greece", "Spain", "Portugal", "Turkey", "Australia"]

SALES_WHATSAPP = "+92 340 8226347"


def site_url(headers, env=None):
    env = os.environ if env is None else env
    configured = env.get("FIRO_SITE_URL", "").strip().rstrip("/")
    if configured.startswith("https://") or configured.startswith("http://"):
        return configured
    host = (headers.get("x-forwarded-host") or headers.get("host") or "localhost").split(",")[0].strip()
    # Only allow a plain host name (and port): never echo anything else into the files
    if not re.fullmatch(r"[A-Za-z0-9.-]+(:\d{1,5})?", host):
        host = "localhost"
    proto = (headers.get("x-forwarded-proto") or ("http" if host.startswith(("localhost", "127.")) else "https")).split(",")[0].strip()
    proto = "http" if proto == "http" else "https"
    return f"{proto}://{host}"


# ── Built-in items (read from the website's own JS files) ──────────
def _read(rel):
    try:
        with open(os.path.join(ROOT_DIR, rel), encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def _js_items(text, fields):
    """Pull simple `key: "value"` fields out of the starter lists, one dict per slug."""
    items, cur = [], None
    for m in re.finditer(r'^\s*(\w+):\s*"((?:[^"\\]|\\.)*)"', text, re.M):
        key, value = m.group(1), m.group(2).replace('\\"', '"')
        if key == "slug":
            cur = {"slug": value}
            items.append(cur)
        elif cur is not None and key in fields and key not in cur:
            cur[key] = value
    return items


def starter_products():
    return _js_items(_read("public/js/products.js"), ("name", "summary", "category", "price"))


def starter_posts():
    return _js_items(_read("public/js/blog-data.js"), ("title", "excerpt"))


# ── Live items from Firestore ──────────────────────────────────────
def _fs_value(v):
    if "stringValue" in v:
        return v["stringValue"]
    if "booleanValue" in v:
        return v["booleanValue"]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return v["doubleValue"]
    return None


def firestore_published(collection, env=None):
    """Published docs of a collection as dicts, or None if Firestore can't be read."""
    env = os.environ if env is None else env
    project, key = env.get("FIREBASE_PROJECT_ID", "").strip(), env.get("FIREBASE_API_KEY", "").strip()
    if not project or not key or not re.fullmatch(r"[a-z0-9-]+", project):
        return None
    url = (f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)"
           f"/documents:runQuery?key={quote(key)}")
    body = json.dumps({"structuredQuery": {
        "from": [{"collectionId": collection}],
        "where": {"fieldFilter": {"field": {"fieldPath": "published"}, "op": "EQUAL",
                                  "value": {"booleanValue": True}}},
        "limit": 500,
    }}).encode("utf-8")
    try:
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=6) as r:
            rows = json.load(r)
    except Exception:
        return None
    out = []
    for row in rows:
        d = row.get("document")
        if not d:
            continue
        fields = {k: _fs_value(v) for k, v in d.get("fields", {}).items()}
        fields["slug"] = d["name"].rsplit("/", 1)[-1]
        out.append(fields)
    return out


def load_items(env=None):
    products = firestore_published("products", env)
    posts = firestore_published("blog_posts", env)
    return (products or starter_products()), (posts or starter_posts())


# ── Files ──────────────────────────────────────────────────────────
def robots_txt(base):
    lines = []
    for bot in WELCOME_BOTS + ["*"]:
        lines.append(f"User-agent: {bot}")
        lines += [f"Disallow: {p}" for p in PRIVATE_PATHS]
        lines.append("Allow: /")
        lines.append("")
    lines.append(f"Sitemap: {base}/sitemap.xml")
    return "\n".join(lines) + "\n"


def sitemap_xml(base, products, posts):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    urls = [(base + path, freq, prio) for path, freq, prio in PAGES]
    urls += [(f"{base}/products/{quote(p['slug'])}", "monthly", "0.8") for p in products]
    urls += [(f"{base}/blog/{quote(p['slug'])}", "monthly", "0.6") for p in posts]
    body = "\n".join(
        f"  <url><loc>{escape(u)}</loc><lastmod>{today}</lastmod>"
        f"<changefreq>{f}</changefreq><priority>{p}</priority></url>" for u, f, p in urls)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + "\n</urlset>\n")


def _one_line(s, limit=300):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


def llms_txt(base, products, posts):
    out = [
        "# FIRO",
        "",
        "> FIRO is a wildfire (forest fire) early-warning system from Azad Jammu and Kashmir, Pakistan. "
        "Cameras with on-device AI detect fire and smoke on-site and alert forest teams in seconds. "
        "FIRO also sells its technology: edge AI fire detection cameras, fire and smoke detection models, "
        "detection software, control room dashboards, and hardware setup and configuration.",
        "",
        "Key facts:",
        "- Developed by Datix AI for the forests of Azad Jammu and Kashmir (AJK), Pakistan.",
        "- Detection runs on the device (edge AI), so it works in remote forests with weak internet.",
        "- Anyone can report a forest fire on the website; reports reach the FIRO control room. In an emergency in Pakistan, call 1122.",
        "- Products are ordered on WhatsApp: " + SALES_WHATSAPP + ".",
        "- Products are available to customers in " + ", ".join(REGIONS) + ", and other countries facing wildfires.",
        "",
        "## Pages",
        f"- [Home]({base}/): What FIRO is and how it detects wildfires",
        f"- [Products]({base}/products): Wildfire detection cameras, AI models, software, dashboards and setup services",
        f"- [About]({base}/about): The team, the problem of forest fires in Kashmir, and frequently asked questions",
        f"- [Report a fire]({base}/report): Report a forest fire with its location",
        f"- [Volunteers]({base}/volunteers): Environmentalists from Jammu and Kashmir, Ladakh, Gilgit-Baltistan and beyond, and how to volunteer",
        f"- [Donate]({base}/donate): Support tree plantation, equipment and awareness, with yearly spending reports",
        f"- [Blog]({base}/blog): News and research about wildfires and technology",
        "",
        "## Products",
    ]
    for p in products:
        price = f" Price: {_one_line(p.get('price'), 80)}." if p.get("price") else ""
        out.append(f"- [{_one_line(p.get('name'), 120)}]({base}/products/{quote(p['slug'])}): "
                   f"{_one_line(p.get('summary'))}{price}")
    out += ["", "## Blog posts"]
    for p in posts:
        out.append(f"- [{_one_line(p.get('title'), 160)}]({base}/blog/{quote(p['slug'])}): {_one_line(p.get('excerpt'))}")
    out += ["", "## Contact",
            f"- WhatsApp: {SALES_WHATSAPP} (sales and questions)",
            "- Fire emergency in Pakistan: call 1122",
            f"- Report a fire online: {base}/report", ""]
    return "\n".join(out)


def seo_response(which, headers, env=None):
    """Return (status, content_type, body_bytes)."""
    base = site_url(headers, env)
    if which == "robots":
        return 200, "text/plain; charset=utf-8", robots_txt(base).encode("utf-8")
    if which in ("sitemap", "llms"):
        products, posts = load_items(env)
        if which == "sitemap":
            return 200, "application/xml; charset=utf-8", sitemap_xml(base, products, posts).encode("utf-8")
        return 200, "text/plain; charset=utf-8", llms_txt(base, products, posts).encode("utf-8")
    return 404, "text/plain; charset=utf-8", b"Not found\n"


class handler(BaseHTTPRequestHandler):
    """Vercel Python runtime entry point."""

    def do_GET(self):
        which = parse_qs(urlsplit(self.path).query).get("file", [""])[0]
        headers = {k.lower(): v for k, v in self.headers.items()}
        status, ctype, body = seo_response(which, headers)
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)
