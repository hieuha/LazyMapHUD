# Live radiosonde feed (SondeHub poller)

`scripts/sondehub-station-poller.mjs` auto-feeds live radiosonde telemetry into
the HUD. It polls the [SondeHub](https://sondehub.org) area API around a launch
station's coordinates and POSTs every sonde's latest frame to `/webhook`
(HMAC-signed, straight to `127.0.0.1:3000`, bypassing the CDN). It catches
whatever launches — no serial needed in advance.

> Running your own `radiosonde_auto_rx` receiver? Feed it directly (lower
> latency, no SondeHub round-trip) — see **[autorx-feed.md](autorx-feed.md)**.

## Why an area query (not "by station")

SondeHub has **no telemetry-by-station endpoint**. The available endpoints are:

- `GET /sonde/{serial}` — all frames for one serial.
- `GET /sondes?lat=&lon=&distance=&last=` — latest frame per sonde within
  `distance` metres of a point over the last `last` seconds. Response shape is
  `{ serial: latestFrame }` (one flat frame per sonde).

So the poller queries the area around the **station's coordinates**. Station
metadata (coords, launch schedule) comes from `GET /sites`:

| Station | Name | Position (lon, lat) | Launches (UTC) |
|---|---|---|---|
| `48820` | Ha Noi (Vietnam) | `105.80, 21.0333` | 00Z & 12Z |

## Tunables (env vars)

| Var | Default | Meaning |
|---|---|---|
| `WEBHOOK_SECRET` | _(required)_ | HMAC secret; must match the server |
| `URL` | `http://localhost:3000/webhook` | webhook endpoint |
| `LAT`, `LON` | `21.0333`, `105.80` | station center (Hanoi 48820) |
| `RADIUS_M` | `250000` | search radius, metres (covers ascent + drift) |
| `LAST_S` | `7200` | telemetry window, seconds (last 2 h) |
| `PERIOD_MS` | `1000` | poll interval, ms |

Quick run (feeds any sonde flying near Hanoi right now):

```bash
WEBHOOK_SECRET=$(grep '^WEBHOOK_SECRET=' .env | cut -d= -f2) \
  node scripts/sondehub-station-poller.mjs
```

## Run it as a service

Ready-to-copy files: `deploy/systemd/lazymaphud-sonde.service` and
`deploy/cron/lazymaphud-sonde` (see the app's `deploy/systemd/lazymaphud.service`
too). Copy them and adjust paths, or generate the unit inline:

```bash
NODE_DIR=$(dirname "$(which node)")
sudo tee /etc/systemd/system/lazymaphud-sonde.service >/dev/null <<UNIT
[Unit]
Description=LazyMapHUD SondeHub poller (Hanoi 48820)
After=network-online.target lazymaphud.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/lazymaphud
EnvironmentFile=/var/www/lazymaphud/.env
Environment=URL=http://127.0.0.1:3000/webhook
Environment=PATH=$NODE_DIR:/usr/bin:/bin
ExecStart=$NODE_DIR/node scripts/sondehub-station-poller.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
```

`WEBHOOK_SECRET` comes from `.env` (EnvironmentFile). Override tunables with
`Environment=` lines. `enable --now` it to run 24/7, or gate it with cron
(below) to save resources.

## Gate to launch windows with cron

A sonde flight lasts ~2.5 h (ascent to ~30 km burst, then descent), so run the
poller from ~15 min before launch to ~3 h after, and keep it stopped the rest
of the day. Use `CRON_TZ=UTC` so the launch times (00Z/12Z) map directly,
independent of the server's timezone:

```bash
sudo systemctl disable --now lazymaphud-sonde   # cron controls it, not boot
sudo tee /etc/cron.d/lazymaphud-sonde >/dev/null <<'CRON'
# Hanoi 48820 launches 00Z & 12Z (UTC). Open 15 min before, close ~3 h after.
CRON_TZ=UTC
45 23 * * *  root  systemctl start lazymaphud-sonde
0  3  * * *  root  systemctl stop  lazymaphud-sonde
45 11 * * *  root  systemctl start lazymaphud-sonde
0  15 * * *  root  systemctl stop  lazymaphud-sonde
CRON
sudo systemctl restart cron
```

> **`CRON_TZ=UTC` is required** — without it a server on ICT reads `23:45` as
> local time and runs at the wrong hour. Verify with `head -3
> /etc/cron.d/lazymaphud-sonde`.

Windows in local ICT (UTC+7): **06:45–10:00** (00Z launch) and **18:45–22:00**
(12Z launch). Between windows the service is stopped and the map empties (live
entities TTL out after ~2 min) — expected.

## Monitor

```bash
journalctl -u lazymaphud-sonde -f      # "tick N — 1/1 fed: Y0xxxxxxx@22479m"
systemctl status lazymaphud-sonde
```

## Adapting to another station

Look the station up in `GET https://api.v2.sondehub.org/sites` (keyed by WMO
number), take its `position` (`[lon, lat]`) and launch `times`, then set
`LAT`/`LON` (+ optionally `RADIUS_M`) on the service and the cron hours to
match its launch schedule (remember: `CRON_TZ=UTC`).
