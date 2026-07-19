#!/usr/bin/env node
// Auto-feed live radiosonde telemetry from a LOCAL radiosonde_auto_rx station
// straight into the webhook — no SondeHub round-trip.
//
// auto_rx (the same software that uploads to SondeHub) exposes a local web API.
// We poll its /get_telemetry_archive, which returns the latest decoded frame
// per serial the station is currently tracking, take each still-fresh sonde's
// latest frame, and POST it (HMAC-signed) to /webhook. Lower latency and
// fresher frames than the SondeHub area API (which can repeat a cached frame),
// so the HUD marker moves continuously instead of appearing to stall.
//
// Usage (from the repo root):
//   WEBHOOK_SECRET=$(grep '^WEBHOOK_SECRET=' .env | cut -d= -f2) \
//     AUTORX_HOST=100.123.219.82:5000 \
//     node scripts/autorx-poller.mjs
//
// Env:
//   AUTORX_HOST     auto_rx host:port    (default 100.123.219.82:5000)
//   AUTORX_URL      full archive URL     (overrides AUTORX_HOST if set)
//   URL             webhook endpoint     (default http://localhost:3000/webhook)
//   WEBHOOK_SECRET  HMAC secret; must match the server
//   FRESH_S         max frame age sec    (default 120 — skip landed/stale flights)
//   PERIOD_MS       poll interval ms     (default 1000)
import { createHmac } from 'node:crypto';

const AUTORX_HOST = process.env.AUTORX_HOST ?? '100.123.219.82:5000';
const ARCHIVE_URL = process.env.AUTORX_URL ?? `http://${AUTORX_HOST}/get_telemetry_archive`;
const ENDPOINT = process.env.URL ?? 'http://localhost:3000/webhook';
const SECRET = process.env.WEBHOOK_SECRET ?? '';
const FRESH_S = Number(process.env.FRESH_S ?? 120);
const PERIOD_MS = Number(process.env.PERIOD_MS ?? 1000);

if (!SECRET) {
  console.error('WEBHOOK_SECRET is required (must match the server).');
  process.exit(1);
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const isReal = (v, floor) => num(v) !== undefined && v > floor; // drop -273 temp / -1 sentinels

/**
 * The archive response is `{ serial: { timestamp, latest_telem, path } }`.
 * Keep only sondes whose latest frame is still fresh (updated within FRESH_S)
 * so a landed flight lingering in the archive isn't re-fed forever.
 */
function freshSondes(data, now) {
  const out = [];
  if (!data || typeof data !== 'object') return out;
  for (const [serial, rec] of Object.entries(data)) {
    const t = rec?.latest_telem;
    if (!t || typeof t !== 'object') continue;
    if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon) || !Number.isFinite(t.alt)) continue;
    // rec.timestamp is unix seconds (float) of the last update for this serial.
    const ageS = Number.isFinite(rec.timestamp) ? now / 1000 - rec.timestamp : 0;
    if (ageS > FRESH_S) continue;
    out.push({ serial, t });
  }
  return out;
}

/** Map an auto_rx latest_telem frame to the webhook entity (core + flexible meta). */
function toBody(serial, t) {
  const meta = { callsign: serial };
  if (typeof t.type === 'string') meta.model = t.type;
  if (num(t.freq_float) !== undefined) meta.freq_mhz = t.freq_float;
  if (num(t.frame) !== undefined) meta.frame = t.frame;
  if (num(t.sats) !== undefined) meta.sats = t.sats;
  if (num(t.batt) !== undefined) meta.batt_v = t.batt;
  if (num(t.snr) !== undefined) meta.snr = t.snr;
  if (isReal(t.temp, -270)) meta.temp_c = t.temp;
  if (isReal(t.humidity, -1)) meta.humidity_pct = t.humidity;
  if (isReal(t.pressure, -1)) meta.pressure_hpa = t.pressure;
  return {
    name: serial,
    type: 'balloon',
    lat: t.lat,
    lon: t.lon,
    altitude_m: t.alt,
    heading: num(t.heading) ?? 0,
    speed_ms: Math.max(0, num(t.vel_h) ?? 0),
    climb_ms: num(t.vel_v) ?? 0,
    ...meta,
  };
}

async function post(body) {
  const raw = JSON.stringify(body);
  const sig = createHmac('sha256', SECRET).update(raw).digest('hex');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': sig },
    body: raw,
  });
  return res.status;
}

console.log(`polling auto_rx ${ARCHIVE_URL} -> ${ENDPOINT} every ${PERIOD_MS}ms (fresh<=${FRESH_S}s)`);

let tickN = 0;
async function tick() {
  tickN++;
  let data;
  try {
    const res = await fetch(ARCHIVE_URL, { headers: { accept: 'application/json' } });
    if (!res.ok) { console.log(`tick ${tickN} — auto_rx HTTP ${res.status}`); return; }
    data = await res.json();
  } catch (e) {
    console.log(`tick ${tickN} — fetch failed: ${e.message}`);
    return;
  }
  const sondes = freshSondes(data, Date.now());
  if (sondes.length === 0) { console.log(`tick ${tickN} — no fresh sondes`); return; }
  const results = await Promise.allSettled(sondes.map(({ serial, t }) => post(toBody(serial, t))));
  const ok = results.filter((r) => r.status === 'fulfilled' && r.value === 200).length;
  const bad = results.length - ok;
  console.log(
    `tick ${tickN} — ${ok}/${sondes.length} fed${bad ? ` (${bad} failed — check WEBHOOK_SECRET)` : ''}: ` +
      sondes.map(({ serial, t }) => `${serial}@${Math.round(t.alt)}m`).join(', '),
  );
}

await tick();
const timer = setInterval(tick, PERIOD_MS);
process.on('SIGINT', () => { clearInterval(timer); console.log('\nstopped.'); process.exit(0); });
