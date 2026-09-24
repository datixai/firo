"""
scripts/demo_data.py
─────────────────────────────────────────────────────────────
Load (or remove) realistic DEMO data in Firestore so every page of
the FIRO control room has something to show: camera readings with
fire incidents, citizen reports in every workflow state, and a few
contact messages.

Every demo document has  demo: true  and demo camera names end in
"(demo)", so real data is never touched and removal is exact.

Usage (from the project folder):

    pip install google-auth requests
    python scripts/demo_data.py load      # add demo data (30 days)
    python scripts/demo_data.py status    # count demo documents
    python scripts/demo_data.py remove    # delete all demo data

Options:
    --key PATH     service account key (default: secrets/service_account_key.json)
    --days N       days of history to generate (default: 30)

Uses the Firestore REST API with your service account (Admin access,
security rules do not apply). Set FIRESTORE_EMULATOR_HOST to target
the local emulator instead.

Firestore free tier: 20,000 writes/day. "load" writes about 7,000
documents and "remove" deletes the same number.
─────────────────────────────────────────────────────────────
"""

import argparse
import json
import math
import os
import random
import sys
from datetime import datetime, timedelta, timezone

import requests

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_KEY = os.path.join(ROOT_DIR, "secrets", "service_account_key.json")
PKT = timezone(timedelta(hours=5))          # Pakistan Standard Time
MIN = 60 * 1000
HOUR = 60 * MIN
DAY = 24 * HOUR

# Demo camera sites across Azad Jammu & Kashmir (approximate coordinates)
CAMERAS = [
    # name,                          lat,      lon,      offline_for_hours
    ("Kurti Ridge Tower (demo)",     33.4838,  73.9076,  0),
    ("UOK Hilltop (demo)",           33.4858,  73.9042,  0),
    ("Khuiratta Forest (demo)",      33.3544,  74.0231,  0),
    ("Nakyal Pine Belt (demo)",      33.4580,  74.1260,  0),
    ("Sehnsa Valley (demo)",         33.5238,  73.7427,  0),
    ("Banjosa Lake (demo)",          33.8130,  73.8150,  0),
    ("Pir Chinasi (demo)",           34.3885,  73.5560,  0),
    ("Neelum Athmuqam (demo)",       34.5794,  73.9006,  5),   # shows as offline
]

# Fire incidents: (camera index, days ago, local hour, minute, duration minutes, resolved)
INCIDENTS = [
    (2, 0, None, None, 20, False),   # active right now at Khuiratta (last 20 min)
    (0, 1, 14, 20, 40, True),
    (3, 2, 15, 5, 60, True),
    (4, 3, 13, 40, 30, True),
    (2, 5, 16, 10, 50, True),
    (6, 6, 12, 30, 20, True),
    (1, 8, 15, 45, 30, True),
    (3, 10, 14, 0, 70, True),
    (5, 12, 17, 15, 20, True),
    (0, 14, 13, 5, 40, True),
    (2, 17, 22, 30, 30, True),
    (3, 20, 15, 25, 60, True),
    (7, 23, 14, 50, 40, True),
    (4, 26, 16, 35, 30, True),
]

PLACES = [
    ("Kurti village hill", 33.484, 73.908), ("Behind UOK main gate", 33.487, 73.901),
    ("Khuiratta road, km 12", 33.360, 74.010), ("Nakyal forest ridge", 33.455, 74.120),
    ("Sehnsa pine slope", 33.520, 73.750), ("Tatta Pani bridge", 33.590, 73.950),
    ("Banjosa lake forest", 33.810, 73.812), ("Pir Chinasi road", 34.385, 73.560),
    ("Gulpur jungle track", 33.440, 73.870), ("Dhirkot pine forest", 34.020, 73.580),
]
TYPES = [("smoke", 35), ("small_fire", 30), ("large_fire", 20), ("near_homes", 15)]
DESCRIPTIONS = [
    "Smoke rising behind the trees, can see it from the road.",
    "Small fire in dry grass near the forest edge.",
    "Fire spreading uphill quickly, wind is strong.",
    "Flames close to houses, people are trying to put it out with water.",
    "Thick white smoke over the ridge since morning.",
    "",
]
NAMES = ["Ali Raza", "Sana Bibi", "Imran Khan", "", "Ayesha Noor", "", "Usman Tariq"]


# ── Firestore REST helpers ─────────────────────────────────────

def to_value(v):
    if v is None:
        return {"nullValue": None}
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, datetime):
        return {"timestampValue": v.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")}
    return {"stringValue": str(v)}


class Firestore:
    def __init__(self, key_path):
        with open(key_path, "r", encoding="utf-8") as f:
            key = json.load(f)
        self.project = key["project_id"]
        emulator = os.environ.get("FIRESTORE_EMULATOR_HOST")
        if emulator:
            self.base = f"http://{emulator}/v1"
            self.headers = {"Authorization": "Bearer owner"}
        else:
            from google.oauth2 import service_account
            from google.auth.transport.requests import Request
            creds = service_account.Credentials.from_service_account_info(
                key, scopes=["https://www.googleapis.com/auth/datastore"])
            creds.refresh(Request())
            self.base = "https://firestore.googleapis.com/v1"
            self.headers = {"Authorization": f"Bearer {creds.token}"}
        self.root = f"projects/{self.project}/databases/(default)/documents"

    def commit(self, writes):
        for i in range(0, len(writes), 400):
            r = requests.post(f"{self.base}/{self.root}:commit", headers=self.headers,
                              json={"writes": writes[i:i + 400]}, timeout=60)
            if r.status_code != 200:
                raise RuntimeError(f"Firestore commit failed ({r.status_code}): {r.text[:500]}")
            print(f"  … {min(i + 400, len(writes))}/{len(writes)}", end="\r")
        print()

    def set_write(self, path, data):
        return {"update": {"name": f"{self.root}/{path}", "fields": {k: to_value(v) for k, v in data.items()}}}

    def demo_names(self, parent, collection):
        """Full names of documents with demo == true in a collection."""
        parent_path = f"{self.root}/{parent}" if parent else self.root
        query = {"structuredQuery": {
            "from": [{"collectionId": collection}],
            "where": {"fieldFilter": {"field": {"fieldPath": "demo"}, "op": "EQUAL", "value": {"booleanValue": True}}},
            "select": {"fields": [{"fieldPath": "__name__"}]},
        }}
        r = requests.post(f"{self.base}/{parent_path}:runQuery", headers=self.headers, json=query, timeout=120)
        if r.status_code != 200:
            raise RuntimeError(f"Query failed ({r.status_code}): {r.text[:500]}")
        return [row["document"]["name"] for row in r.json() if "document" in row]


def collections(project):
    """(parent path, collection id, short label) for every collection demo data touches."""
    return [
        (f"artifacts/{project}/public/data", "fire_logs", "camera readings"),
        ("", "reports", "citizen reports"),
        ("", "contact_messages", "contact messages"),
    ]


# ── Demo data generation ───────────────────────────────────────

def ts_str(ms):
    return datetime.fromtimestamp(ms / 1000, tz=PKT).strftime("%Y-%m-%d %H:%M:%S")


def local_time(days_ago, hour, minute, now_ms):
    d = datetime.fromtimestamp(now_ms / 1000, tz=PKT) - timedelta(days=days_ago)
    return int(d.replace(hour=hour, minute=minute, second=0, microsecond=0).timestamp() * 1000)


def build_logs(now_ms, days, rng):
    """Camera readings: hourly for the history, every 10 minutes for the last 24 h, plus fire incidents."""
    fire_windows = {}   # camera index -> list of (start, end, resolved)
    for cam, days_ago, hour, minute, dur, resolved in INCIDENTS:
        if days_ago >= days:
            continue
        if hour is None:
            start = now_ms - dur * MIN
        else:
            start = local_time(days_ago, hour, minute, now_ms)
        fire_windows.setdefault(cam, []).append((start, start + dur * MIN, resolved))

    docs = {}
    for ci, (name, lat, lon, offline_h) in enumerate(CAMERAS):
        stop = now_ms - offline_h * HOUR
        times = set()
        t = now_ms - days * DAY
        while t < now_ms - DAY:
            times.add(t - t % HOUR)
            t += HOUR
        t = now_ms - DAY
        while t <= now_ms:
            times.add(t - t % (10 * MIN))
            t += 10 * MIN
        for start, end, _ in fire_windows.get(ci, []):         # dense readings during incidents
            t = start
            while t <= end:
                times.add(t)
                t += 10 * MIN
        for t in sorted(times):
            if t > stop:
                continue
            fire = next(((s, e, res) for s, e, res in fire_windows.get(ci, []) if s <= t <= e), None)
            doc = {
                "camera_location": name,
                "coords_y": lat,
                "coords_x": lon,
                "detection_class": "FIRE DETECTED" if fire else "SAFE",
                "fire_probability": round(rng.uniform(0.72, 0.98) if fire else rng.uniform(0.01, 0.16), 4),
                "timestamp_ms": int(t),
                "timestamp_str": ts_str(t),
                "device_id": f"rpi5-demo-{ci + 1:02d}",
                "demo": True,
            }
            if fire and fire[2]:
                doc["status"] = "resolved"
                doc["resolved_ms"] = int(fire[1] + rng.randint(5, 45) * MIN)
            docs[f"demo_log_{ci + 1:02d}_{int(t)}"] = doc
    return docs


def weighted(rng, pairs):
    total = sum(w for _, w in pairs)
    x = rng.uniform(0, total)
    for v, w in pairs:
        x -= w
        if x <= 0:
            return v
    return pairs[-1][0]


def build_reports(now_ms, days, rng):
    docs = {}
    count = max(12, int(days * 1.8))
    for i in range(count):
        days_ago = rng.uniform(0.2, days - 0.1)
        hour = weighted(rng, [(h, 3 if 12 <= h <= 17 else 2 if 9 <= h <= 20 else 0.5) for h in range(24)])
        created = local_time(int(days_ago), hour, rng.randint(0, 59), now_ms)
        if created > now_ms - 3 * HOUR:
            created = now_ms - rng.randint(3, 20) * HOUR
        place, plat, plon = rng.choice(PLACES)
        rtype = weighted(rng, TYPES)
        age_days = (now_ms - created) / DAY
        if age_days > 2:
            status = weighted(rng, [("resolved", 60), ("dismissed", 20), ("verified", 8), ("reviewing", 4)])
        else:
            status = weighted(rng, [("reviewing", 35), ("verified", 30), ("resolved", 25), ("new", 10)])
        has_loc = rng.random() > 0.15
        doc = {
            "type": rtype,
            "place": place,
            "description": rng.choice(DESCRIPTIONS),
            "lat": round(plat + rng.uniform(-0.01, 0.01), 5) if has_loc else None,
            "lon": round(plon + rng.uniform(-0.01, 0.01), 5) if has_loc else None,
            "accuracy_m": rng.choice([8, 12, 20, 35, 60]) if has_loc else None,
            "photo": "",
            "name": rng.choice(NAMES),
            "phone": f"0300 0000 {rng.randint(100, 999)}" if rng.random() > 0.3 else "",
            "status": status,
            "created_ms": int(created),
            "created_at": datetime.fromtimestamp(created / 1000, tz=timezone.utc),
            "demo": True,
        }
        if status != "new":
            ack = created + int(math.exp(rng.uniform(math.log(3), math.log(50))) * MIN)
            doc["acknowledged_ms"] = ack
            doc["updated_ms"] = ack
            doc["handled_by"] = "demo-operator@firo.pk"
            if status in ("resolved", "dismissed"):
                doc["resolved_ms"] = ack + int(math.exp(rng.uniform(math.log(20), math.log(600))) * MIN)
                doc["updated_ms"] = doc["resolved_ms"]
        docs[f"demo_report_{i + 1:03d}"] = doc

    # A few fresh, unhandled reports so the live desk has work to do
    fresh = [
        ("near_homes", "Behind Kurti school", 33.4841, 73.9071, 9, "Fire very close to houses, spreading fast", "Sana Bibi", "0300 0000 111", "new"),
        ("smoke", "UOK hostel hill", None, None, 35, "", "", "", "new"),
        ("large_fire", "Khuiratta forest, near the tower", 33.3551, 74.0240, 110, "Big flames on the slope, the camera tower is close.", "Imran Khan", "0300 0000 222", "reviewing"),
    ]
    for j, (rtype, place, lat, lon, mins, desc, name, phone, status) in enumerate(fresh):
        created = now_ms - mins * MIN
        doc = {
            "type": rtype, "place": place, "description": desc, "lat": lat, "lon": lon,
            "accuracy_m": 12 if lat else None, "photo": "", "name": name, "phone": phone,
            "status": status, "created_ms": int(created),
            "created_at": datetime.fromtimestamp(created / 1000, tz=timezone.utc), "demo": True,
        }
        if status == "reviewing":
            doc.update({"acknowledged_ms": created + 6 * MIN, "updated_ms": created + 6 * MIN, "handled_by": "demo-operator@firo.pk"})
        docs[f"demo_report_live_{j + 1}"] = doc
    return docs


def build_messages(now_ms):
    msgs = [
        ("Hamza Ali", "hamza@example.com", "Partnership / deployment", "We manage a forest reserve near Bagh and would like to discuss installing FIRO cameras.", 2, "unread"),
        ("Dr. Farah", "farah@example.com", "Research / academic", "Could you share the dataset details used for the MobileNetV2 model?", 5, "read"),
        ("Local News AJK", "news@example.com", "Media", "We are preparing a story on wildfire technology in Kotli. Can we interview the team?", 9, "unread"),
        ("Bilal", "bilal@example.com", "Feedback on the website", "The report page worked well on my phone. Great work!", 14, "read"),
    ]
    docs = {}
    for i, (name, email, subject, message, days_ago, status) in enumerate(msgs):
        created = now_ms - days_ago * DAY - i * 37 * MIN
        docs[f"demo_message_{i + 1}"] = {
            "name": name, "email": email, "subject": subject, "message": message, "status": status,
            "created_ms": int(created), "created_at": datetime.fromtimestamp(created / 1000, tz=timezone.utc), "demo": True,
        }
    return docs


# ── Commands ───────────────────────────────────────────────────

def cmd_status(fs):
    total = 0
    for parent, col, label in collections(fs.project):
        n = len(fs.demo_names(parent, col))
        total += n
        print(f"  {label:<18} {n:>6}")
    print(f"  {'total':<18} {total:>6}")
    return total


def cmd_remove(fs):
    names = []
    for parent, col, label in collections(fs.project):
        found = fs.demo_names(parent, col)
        print(f"  {label:<18} {len(found):>6} to delete")
        names += found
    if not names:
        print("No demo data found.")
        return
    fs.commit([{"delete": n} for n in names])
    print(f"Removed {len(names)} demo documents.")


def cmd_load(fs, days, replace):
    existing = sum(len(fs.demo_names(p, c)) for p, c, _ in collections(fs.project))
    if existing and not replace:
        print(f"{existing} demo documents already exist. Run 'remove' first, or add --replace.")
        sys.exit(1)
    if existing:
        cmd_remove(fs)
    rng = random.Random(2026)
    now_ms = int(datetime.now(tz=timezone.utc).timestamp() * 1000)
    logs = build_logs(now_ms, days, rng)
    reports = build_reports(now_ms, days, rng)
    messages = build_messages(now_ms)
    writes = [fs.set_write(f"artifacts/{fs.project}/public/data/fire_logs/{k}", v) for k, v in logs.items()]
    writes += [fs.set_write(f"reports/{k}", v) for k, v in reports.items()]
    writes += [fs.set_write(f"contact_messages/{k}", v) for k, v in messages.items()]
    print(f"Writing {len(logs)} camera readings, {len(reports)} citizen reports, {len(messages)} messages "
          f"({len(writes)} documents) to project '{fs.project}'…")
    fs.commit(writes)
    print("Done. Open /dashboard to see it. Remove it later with:  python scripts/demo_data.py remove")


def main():
    ap = argparse.ArgumentParser(description="Load or remove FIRO demo data in Firestore")
    ap.add_argument("command", choices=["load", "remove", "status"])
    ap.add_argument("--key", default=DEFAULT_KEY, help="service account key JSON")
    ap.add_argument("--days", type=int, default=30, help="days of history to generate (load)")
    ap.add_argument("--replace", action="store_true", help="remove existing demo data before loading")
    args = ap.parse_args()
    if not os.path.exists(args.key):
        sys.exit(f"Key file not found: {args.key}\nPut service_account_key.json in the secrets/ folder or pass --key.")
    fs = Firestore(args.key)
    if args.command == "status":
        cmd_status(fs)
    elif args.command == "remove":
        cmd_remove(fs)
    else:
        cmd_load(fs, max(2, min(args.days, 90)), args.replace)


if __name__ == "__main__":
    main()
