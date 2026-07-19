#!/usr/bin/env python3
"""Push local radiosonde_auto_rx telemetry to a remote LazyMapHUD webhook.

Runs ON the auto_rx station box (e.g. 100.123.219.82). Reads the station's own
local /get_telemetry_archive, and for each still-fresh sonde HMAC-signs its
latest frame and POSTs it to LazyMapHUD's public /webhook. LazyMapHUD stays
passive — it never reaches back to the station; the station pushes out.

Pure standard library (urllib/hmac/hashlib/json) — no pip installs, so it runs
on a bare Raspberry Pi auto_rx image.

Usage (on the auto_rx box):
    WEBHOOK_URL=https://map.example.org/webhook \\
    WEBHOOK_SECRET=<same secret as the LazyMapHUD server> \\
        python3 autorx_push.py

Env:
    WEBHOOK_URL     LazyMapHUD webhook       (required, e.g. https://host/webhook)
    WEBHOOK_SECRET  HMAC secret; must match the LazyMapHUD server   (required)
    AUTORX_URL      local archive endpoint   (default http://127.0.0.1:5000/get_telemetry_archive)
    FRESH_S         max frame age seconds    (default 120 — skip landed/stale flights)
    PERIOD_S        poll interval seconds    (default 1.0)
"""
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.request

AUTORX_URL = os.environ.get("AUTORX_URL", "http://127.0.0.1:5000/get_telemetry_archive")
WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "")
SECRET = os.environ.get("WEBHOOK_SECRET", "")
FRESH_S = float(os.environ.get("FRESH_S", "120"))
PERIOD_S = float(os.environ.get("PERIOD_S", "1.0"))

if not WEBHOOK_URL or not SECRET:
    sys.exit("WEBHOOK_URL and WEBHOOK_SECRET are required.")


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _is_real(v, floor):
    n = _num(v)
    return n if n is not None and n > floor else None  # drop -273 temp / -1 sentinels


def fresh_sondes(data, now):
    """Archive is {serial: {timestamp, latest_telem, path}}. Keep only sondes
    whose latest frame updated within FRESH_S so landed flights aren't re-fed."""
    out = []
    if not isinstance(data, dict):
        return out
    for serial, rec in data.items():
        if not isinstance(rec, dict):
            continue
        t = rec.get("latest_telem")
        if not isinstance(t, dict):
            continue
        if _num(t.get("lat")) is None or _num(t.get("lon")) is None or _num(t.get("alt")) is None:
            continue
        ts = rec.get("timestamp")
        age = now - ts if isinstance(ts, (int, float)) else 0
        if age > FRESH_S:
            continue
        out.append((serial, t))
    return out


def to_body(serial, t):
    """Map an auto_rx latest_telem frame to the webhook entity (core + meta)."""
    body = {
        "name": serial,
        "type": "balloon",
        "lat": t["lat"],
        "lon": t["lon"],
        "altitude_m": t["alt"],
        "heading": _num(t.get("heading")) or 0,
        "speed_ms": max(0.0, _num(t.get("vel_h")) or 0),
        "climb_ms": _num(t.get("vel_v")) or 0,
        "callsign": serial,
    }
    if isinstance(t.get("type"), str):
        body["model"] = t["type"]
    for src, dst in (("freq_float", "freq_mhz"), ("frame", "frame"), ("sats", "sats"),
                     ("batt", "batt_v"), ("snr", "snr")):
        if _num(t.get(src)) is not None:
            body[dst] = t[src]
    if _is_real(t.get("temp"), -270) is not None:
        body["temp_c"] = t["temp"]
    if _is_real(t.get("humidity"), -1) is not None:
        body["humidity_pct"] = t["humidity"]
    if _is_real(t.get("pressure"), -1) is not None:
        body["pressure_hpa"] = t["pressure"]
    return body


def post(body):
    raw = json.dumps(body, separators=(",", ":")).encode("utf-8")
    sig = hmac.new(SECRET.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    req = urllib.request.Request(
        WEBHOOK_URL,
        data=raw,
        headers={"content-type": "application/json", "x-signature": sig},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        return res.status


def tick(n):
    try:
        with urllib.request.urlopen(AUTORX_URL, timeout=8) as res:
            data = json.load(res)
    except Exception as e:  # noqa: BLE001 — log + continue, never crash the loop
        print(f"tick {n} — auto_rx fetch failed: {e}", flush=True)
        return
    sondes = fresh_sondes(data, time.time())
    if not sondes:
        print(f"tick {n} — no fresh sondes", flush=True)
        return
    ok = 0
    for serial, t in sondes:
        try:
            if post(to_body(serial, t)) == 200:
                ok += 1
        except Exception as e:  # noqa: BLE001 — one bad post must not stop the rest
            print(f"tick {n} — post {serial} failed: {e}", flush=True)
    bad = len(sondes) - ok
    tail = ", ".join(f"{s}@{round(t['alt'])}m" for s, t in sondes)
    note = f" ({bad} failed — check WEBHOOK_SECRET/URL)" if bad else ""
    print(f"tick {n} — {ok}/{len(sondes)} pushed{note}: {tail}", flush=True)


def main():
    print(f"pushing auto_rx {AUTORX_URL} -> {WEBHOOK_URL} every {PERIOD_S}s (fresh<={FRESH_S}s)", flush=True)
    n = 0
    while True:
        n += 1
        tick(n)
        time.sleep(PERIOD_S)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nstopped.")
