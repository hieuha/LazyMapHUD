# Live radiosonde feed (local auto_rx station)

Feed telemetry from your **own** [radiosonde_auto_rx](https://github.com/projecthorus/radiosonde_auto_rx)
receiver straight into the HUD — no SondeHub round-trip. auto_rx already does
the hard part: it scans a frequency band, auto-detects any radiosonde in range
(RS41/RS92/DFM/M10…), and decodes it. A small sidecar forwards each decoded
frame to `/webhook` (HMAC-signed). New flights appear automatically — no serial
known in advance.

Lower latency and fresher frames than the SondeHub area API (which can repeat a
cached frame), so the marker moves continuously instead of stalling.

## Which transport

auto_rx exposes decoded telemetry three ways; pick one sidecar:

| Script | Reads from auto_rx via | Runs on | Notes |
|---|---|---|---|
| `scripts/autorx_udp_push.py` | **Payload Summary UDP** (udp/55673) | station | **Recommended.** Push, real-time; needs no auto_rx web server. Pure stdlib. |
| `scripts/autorx_push.py` | web API `/get_telemetry_archive` | station | HTTP poll (1 s). Richest meta. Pure stdlib. |
| `scripts/autorx-poller.mjs` | web API `/get_telemetry_archive` | LazyMapHUD server | Server **pulls** the station (needs same tailnet). Node. |

The station-side scripts **push out** to LazyMapHUD's public `/webhook`, so
LazyMapHUD stays passive and never reaches back into the station — ideal when
the station sits behind NAT and the map is a public VPS.

## Recommended: UDP Payload Summary push

auto_rx broadcasts a JSON `PAYLOAD_SUMMARY` packet on UDP the moment it decodes
each frame (the feed built for ChaseMapper). Push, not poll, and it does **not**
need the auto_rx web server (`[web]`, port 5000) running at all.

### 1. Enable the feed in auto_rx

In `station.cfg` (on by default):

```ini
[oziplotter]
payload_summary_enabled = True
payload_summary_port = 55673
```

Restart auto_rx if you changed it. Confirm packets are flowing while a sonde is
being decoded:

```bash
python3 -c "import socket;s=socket.socket(2,2);s.setsockopt(1,2,1);s.bind(('',55673));print(s.recvfrom(65535)[0][:200])"
```

Silence between flights is normal — auto_rx only broadcasts while decoding.

### 2. Install the sidecar on the station

```bash
sudo install -Dm755 scripts/autorx_udp_push.py /opt/lazymaphud-push/autorx_udp_push.py

# secrets (root-only): WEBHOOK_URL + WEBHOOK_SECRET, one KEY=VALUE per line
sudo tee /etc/lazymaphud-push.env >/dev/null <<'EOF'
WEBHOOK_URL=https://map.example.org/webhook
WEBHOOK_SECRET=<same secret as the LazyMapHUD server>
EOF
sudo chmod 600 /etc/lazymaphud-push.env

sudo cp deploy/systemd/lazymaphud-autorx-udp-push.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lazymaphud-autorx-udp-push
journalctl -u lazymaphud-autorx-udp-push -f      # "packet N — <serial>@<alt>m"
```

`WEBHOOK_SECRET` must match the LazyMapHUD server's `.env`.

### 3. Test the full path without a live sonde

Inject a fake `PAYLOAD_SUMMARY` packet locally; it should traverse the whole
chain and pop up on the map (then TTL out after ~2 min):

```bash
python3 -c "import socket,json;d=json.dumps({'type':'PAYLOAD_SUMMARY','callsign':'TEST01','latitude':21.03,'longitude':105.8,'altitude':1234,'speed':10,'heading':90,'model':'RS41','freq':'402.500 MHz','frame':1,'vel_h':3,'vel_v':1}).encode();socket.socket(2,2).sendto(d,('127.0.0.1',55673))"
journalctl -u lazymaphud-autorx-udp-push -n 5 --no-pager
```

Expect `packet 1 — TEST01@1234m` with no error.

### Tunables (env vars)

| Var | Default | Meaning |
|---|---|---|
| `WEBHOOK_URL` | _(required)_ | LazyMapHUD webhook, e.g. `https://host/webhook` |
| `WEBHOOK_SECRET` | _(required)_ | HMAC secret; must match the server |
| `UDP_PORT` | `55673` | must equal `payload_summary_port` |
| `BIND_ADDR` | `""` (all interfaces) | listen address |

## Gotcha: CDN/WAF blocks default library User-Agent

If your webhook is fronted by Cloudflare (or another WAF), a `POST` with
urllib's default `User-Agent: Python-urllib/x.y` gets a **403** *before* it
reaches the server. Note the app's `/webhook` route only ever returns
`429/401/400/200` — **a 403 is always the edge, never the app.** Both push
scripts already send an explicit `User-Agent` to avoid this; any non-library UA
passes.

Quick way to tell a bad secret (`401`) from an edge block (`403`):

```bash
# route alive + demands HMAC → 401 is the healthy answer here
curl -sS -o /dev/null -w "HTTP %{http_code}\n" -X POST https://map.example.org/webhook \
     -H 'content-type: application/json' -d '{}'
```

## 24/7 vs launch-window gating

The UDP sidecar is cheap — it just waits for packets — so running it 24/7 is
fine. To gate it to launch windows instead (a flight is ~2.5 h), reuse the cron
pattern in **[sondehub-feed.md](sondehub-feed.md)** (remember `CRON_TZ=UTC`).

## Avoid double-feeding

Run only one telemetry source into a given `/webhook`. If you switch to the
auto_rx feed, disable the SondeHub poller and any other auto_rx sidecar:

```bash
sudo systemctl disable --now lazymaphud-sonde 2>/dev/null || true
sudo systemctl disable --now lazymaphud-autorx-push 2>/dev/null || true
```
