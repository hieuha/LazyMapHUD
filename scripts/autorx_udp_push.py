#!/usr/bin/env python3
"""Push local radiosonde_auto_rx telemetry to a remote LazyMapHUD webhook — via
the Payload Summary UDP broadcast instead of the web API on port 5000.

auto_rx broadcasts a JSON `PAYLOAD_SUMMARY` packet on UDP (default port 55673)
the moment it decodes each frame — the feed built for ChaseMapper. This is
push, not poll: lower latency than the /get_telemetry_archive HTTP poll, and it
does not need the auto_rx web server ([web]) running at all.

Runs ON the auto_rx station box (e.g. a Raspberry Pi). Binds the UDP port, and
for each packet HMAC-signs the mapped frame and POSTs it to LazyMapHUD's public
/webhook. LazyMapHUD stays passive — the station pushes out.

Enable the feed in auto_rx's station.cfg (it is on by default):
    [oziplotter]
    payload_summary_enabled = True
    payload_summary_port = 55673

Pure standard library (socket/urllib/hmac/hashlib/json) — no pip installs, so it
runs on a bare Raspberry Pi auto_rx image.

Usage (on the auto_rx box):
    WEBHOOK_URL=https://map.hatrunghieu.com/webhook \\
    WEBHOOK_SECRET=<same secret as the LazyMapHUD server> \\
        python3 autorx_udp_push.py

Env:
    WEBHOOK_URL     LazyMapHUD webhook       (required, e.g. https://host/webhook)
    WEBHOOK_SECRET  HMAC secret; must match the LazyMapHUD server   (required)
    UDP_PORT        payload_summary_port     (default 55673)
    BIND_ADDR       listen address           (default "" = all interfaces)
"""
import hashlib
import hmac
import json
import os
import socket
import sys
import urllib.request

WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "")
SECRET = os.environ.get("WEBHOOK_SECRET", "")
UDP_PORT = int(os.environ.get("UDP_PORT", "55673"))
BIND_ADDR = os.environ.get("BIND_ADDR", "")

if not WEBHOOK_URL or not SECRET:
    sys.exit("WEBHOOK_URL and WEBHOOK_SECRET are required.")


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _is_real(v, floor):
    n = _num(v)
    return n if n is not None and n > floor else None  # drop -273 temp / -1 sentinels


def _freq_mhz(v):
    """auto_rx sends freq as a string like '402.500 MHz' (occasionally numeric)."""
    if _num(v) is not None:
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.split()[0])
        except (ValueError, IndexError):
            return None
    return None


def to_body(p):
    """Map a PAYLOAD_SUMMARY packet to the webhook entity (core + flexible meta).

    heading/speed carry a -1 sentinel when unavailable. vel_h/vel_v (m/s) ride
    along as EXTRA_FIELDS, so prefer them over the km/h `speed` for exactness."""
    serial = p["callsign"]
    heading = _num(p.get("heading"))
    heading = heading if heading is not None and heading >= 0 else 0
    speed_ms = _num(p.get("vel_h"))
    if speed_ms is None:
        spd_kmh = _num(p.get("speed"))
        speed_ms = spd_kmh / 3.6 if spd_kmh is not None and spd_kmh >= 0 else 0
    body = {
        "name": serial,
        "type": "balloon",
        "lat": p["latitude"],
        "lon": p["longitude"],
        "altitude_m": p["altitude"],
        "heading": heading,
        "speed_ms": max(0.0, speed_ms),
        "climb_ms": _num(p.get("vel_v")) or 0,
        "callsign": serial,
    }
    if isinstance(p.get("model"), str):
        body["model"] = p["model"]
    fmhz = _freq_mhz(p.get("freq"))
    if fmhz is not None:
        body["freq_mhz"] = fmhz
    if _num(p.get("frame")) is not None:
        body["frame"] = p["frame"]
    for src, dst in (("sats", "sats"), ("batt", "batt_v"), ("snr", "snr")):
        if _num(p.get(src)) is not None:
            body[dst] = p[src]
    if _is_real(p.get("temp"), -270) is not None:
        body["temp_c"] = p["temp"]
    if _is_real(p.get("humidity"), -1) is not None:
        body["humidity_pct"] = p["humidity"]
    if _is_real(p.get("pressure"), -1) is not None:
        body["pressure_hpa"] = p["pressure"]
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


def open_socket():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    # SO_REUSEPORT lets this coexist with ChaseMapper (or another listener) on
    # the same broadcast port where the OS supports it; harmless where it doesn't.
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
    except (AttributeError, OSError):
        pass
    sock.bind((BIND_ADDR, UDP_PORT))
    return sock


def main():
    sock = open_socket()
    print(
        f"listening auto_rx PAYLOAD_SUMMARY on udp/{UDP_PORT} -> {WEBHOOK_URL}",
        flush=True,
    )
    n = 0
    while True:
        try:
            raw, _addr = sock.recvfrom(65535)
        except OSError as e:
            print(f"recv failed: {e}", flush=True)
            continue
        try:
            p = json.loads(raw.decode("ascii", "replace"))
        except (ValueError, UnicodeError):
            continue  # not JSON — ignore stray packets
        if not isinstance(p, dict) or p.get("type") != "PAYLOAD_SUMMARY":
            continue
        if (
            _num(p.get("latitude")) is None
            or _num(p.get("longitude")) is None
            or _num(p.get("altitude")) is None
        ):
            continue
        n += 1
        serial = p.get("callsign")
        try:
            st = post(to_body(p))
            note = "" if st == 200 else f" (HTTP {st} — check WEBHOOK_SECRET/URL)"
            print(f"packet {n} — {serial}@{round(_num(p.get('altitude')) or 0)}m{note}", flush=True)
        except Exception as e:  # noqa: BLE001 — one bad post must not stop the listener
            print(f"packet {n} — post {serial} failed: {e}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nstopped.")
