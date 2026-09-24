"""
scripts/fetch_nasa_fires.py
─────────────────────────────────────────────────────────────
Download NASA FIRMS satellite fire detections (VIIRS, 375 m) for the
Azad Jammu & Kashmir region and save them for the control room's
"Fire-prone zones — NASA satellite" map layer and analytics.

Source: NASA FIRMS yearly country archives (public, no key needed)
  https://firms.modaps.eosdis.nasa.gov/country/
Optional: the last 1–10 days of near-real-time data with a free
FIRMS MAP_KEY (https://firms.modaps.eosdis.nasa.gov/api/map_key/).

Usage (from the project folder, standard library only):

    python scripts/fetch_nasa_fires.py                       # 2012 → last year
    python scripts/fetch_nasa_fires.py --from 2018 --to 2025
    python scripts/fetch_nasa_fires.py --map-key YOUR_KEY    # + last 10 days

Writes: public/data/fire-history.json   (commit it so Vercel serves it)

Notes
  • The region is a rectangle around AJK (see --bbox); it can include
    areas just across the Line of Control.
  • Kept: vegetation fires only (type 0) with nominal/high confidence.
  • Yearly country files are large (tens of MB each); the download is
    streamed and only matching rows are kept.
─────────────────────────────────────────────────────────────
"""

import argparse
import csv
import io
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(ROOT_DIR, "public", "data", "fire-history.json")
BASE_URL = "https://firms.modaps.eosdis.nasa.gov"
# south, west, north, east — rectangle around Azad Jammu & Kashmir
DEFAULT_BBOX = (32.8, 73.2, 35.2, 75.0)


def stream_csv(url):
    """Yield dict rows from a CSV URL without loading it all into memory."""
    req = urllib.request.Request(url, headers={"User-Agent": "FIRO-fire-history/1.0"})
    with urllib.request.urlopen(req, timeout=180) as resp:
        text = io.TextIOWrapper(resp, encoding="utf-8", newline="")
        yield from csv.DictReader(text)


def keep(row, bbox):
    try:
        lat, lon = float(row["latitude"]), float(row["longitude"])
    except (KeyError, ValueError):
        return None
    s, w, n, e = bbox
    if not (s <= lat <= n and w <= lon <= e):
        return None
    if str(row.get("type", "0")).strip() not in ("0", ""):          # 0 = presumed vegetation fire
        return None
    if str(row.get("confidence", "n")).strip().lower() in ("l", "low"):
        return None
    try:
        frp = round(float(row.get("frp") or 0), 1)
    except ValueError:
        frp = 0.0
    return [round(lat, 4), round(lon, 4), row.get("acq_date", ""), frp, str(row.get("acq_time", "")).zfill(4)]


def fetch_year(base, sensor, year, country, bbox):
    url = f"{base}/data/country/{sensor}/{year}/{sensor}_{year}_{country}.csv"
    print(f"  {sensor} {year} {country} … ", end="", flush=True)
    found, scanned = [], 0
    try:
        for row in stream_csv(url):
            scanned += 1
            p = keep(row, bbox)
            if p:
                found.append(p)
    except urllib.error.HTTPError as err:
        print(f"not available ({err.code})")
        return []
    except urllib.error.URLError as err:
        print(f"failed ({err.reason})")
        return []
    print(f"{len(found)} in region (of {scanned:,} rows)")
    return found


def fetch_recent(base, key, days, bbox):
    s, w, n, e = bbox
    url = f"{base}/api/area/csv/{key}/VIIRS_SNPP_NRT/{w},{s},{e},{n}/{days}"
    print(f"  near-real-time, last {days} days … ", end="", flush=True)
    try:
        found = [p for p in (keep(r, bbox) for r in stream_csv(url)) if p]
    except (urllib.error.HTTPError, urllib.error.URLError) as err:
        print(f"failed ({err})")
        return []
    print(f"{len(found)} in region")
    return found


def main():
    last_year = datetime.now().year - 1
    ap = argparse.ArgumentParser(description="Download NASA FIRMS fire detections for AJK")
    ap.add_argument("--from", dest="start", type=int, default=2012, help="first year (VIIRS starts 2012)")
    ap.add_argument("--to", dest="end", type=int, default=last_year, help="last year")
    ap.add_argument("--country", action="append", default=None,
                    help="FIRMS country file name (default: Pakistan; repeat to add, e.g. --country India)")
    ap.add_argument("--sensor", default="viirs-snpp", choices=["viirs-snpp", "viirs-noaa20", "modis"])
    ap.add_argument("--map-key", default=os.environ.get("FIRMS_MAP_KEY", ""), help="optional FIRMS MAP_KEY for the last days")
    ap.add_argument("--recent-days", type=int, default=10)
    ap.add_argument("--bbox", default=",".join(map(str, DEFAULT_BBOX)), help="south,west,north,east")
    ap.add_argument("--out", default=OUT_PATH)
    ap.add_argument("--base-url", default=BASE_URL, help=argparse.SUPPRESS)
    args = ap.parse_args()

    bbox = tuple(float(x) for x in args.bbox.split(","))
    countries = args.country or ["Pakistan"]
    print(f"NASA FIRMS {args.sensor}, {args.start}–{args.end}, region {bbox}")

    points, years = [], []
    for year in range(args.start, args.end + 1):
        got = []
        for country in countries:
            got += fetch_year(args.base_url, args.sensor, year, country, bbox)
        if got:
            years.append(year)
        points += got
    if args.map_key:
        points += fetch_recent(args.base_url, args.map_key, max(1, min(args.recent_days, 10)), bbox)

    # de-duplicate (the same pixel can appear in two country files)
    unique = {(p[0], p[1], p[2], p[4]): p[:4] for p in points}
    points = sorted(unique.values(), key=lambda p: p[2])

    if not points:
        print("\nNo detections found. Check your internet connection, or try --country India "
              "if the region is filed under a different country.")
        sys.exit(1)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    data = {
        "source": f"NASA FIRMS {args.sensor.upper()} (375 m), vegetation fires, nominal/high confidence",
        "citation": "NASA FIRMS, https://earthdata.nasa.gov/firms",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bbox": {"south": bbox[0], "west": bbox[1], "north": bbox[2], "east": bbox[3]},
        "years": sorted(set(years + [int(p[2][:4]) for p in points if p[2][:4].isdigit()])),
        "fields": ["lat", "lon", "date", "frp_mw"],
        "points": points,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"\nSaved {len(points):,} detections to {os.path.relpath(args.out, ROOT_DIR)} "
          f"({os.path.getsize(args.out) / 1024:.0f} KB). Reload /map or /analytics to see them.")


if __name__ == "__main__":
    main()
