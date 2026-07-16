#!/usr/bin/env node
// Auto-feed live radiosonde telemetry near a launch station into the webhook.
//
// Polls the SondeHub area API for any sonde within RADIUS of a point (default:
// the Hanoi / Láng station 48820, ~21.02N 105.80E), takes each sonde's latest
// frame, and POSTs it (HMAC-signed) to /webhook. Catches whatever launches —
// no need to know the serial in advance. Leave it running; when tomorrow's
// balloon goes up it appears automatically and is tracked as it drifts.
//
// Usage (on the server, from the repo root):
//   WEBHOOK_SECRET=$(grep '^WEBHOOK_SECRET=' .env | cut -d= -f2) \
//     node scripts/sondehub-station-poller.mjs
//
// Env:
//   URL             webhook endpoint     (default http://localhost:3000/webhook)
//   WEBHOOK_SECRET  HMAC secret; must match the server
//   LAT,LON         station center       (default 21.0333,105.80 — Hanoi 48820)
//   RADIUS_M        search radius meters  (default 250000 — covers ascent+drift)
//   LAST_S          telemetry window sec  (default 7200 — last 2h)
//   PERIOD_MS       poll interval        (default 15000)
//
// Note: SondeHub has no "telemetry by station" endpoint — the /sondes area
// query around the station's coordinates (48820 = Ha Noi, [105.80, 21.0333],
// launches 00Z & 12Z) is the way to auto-catch whatever it launches.
import { createHmac } from 'node:crypto';

const API = 'https://api.v2.sondehub.org/sondes';
const ENDPOINT = process.env.URL ?? 'http://localhost:3000/webhook';
const SECRET = process.env.WEBHOOK_SECRET ?? '';
const LAT = Number(process.env.LAT ?? 21.0333);
const LON = Number(process.env.LON ?? 105.80);
const RADIUS_M = Number(process.env.RADIUS_M ?? 250000);
const LAST_S = Number(process.env.LAST_S ?? 7200);
const PERIOD_MS = Number(process.env.PERIOD_MS ?? 15000);

if (!SECRET) {
  console.error('WEBHOOK_SECRET is required (must match the server).');
  process.exit(1);
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const isReal = (v, floor) => num(v) !== undefined && v > floor; // drop -273 temp / -1 sentinels

/** The area response is `{ serial: latestFrame }` — one flat latest frame per sonde. */
function sondesInRange(data) {
  const out = [];
  if (!data || typeof data !== 'object') return out;
  for (const [serial, f] of Object.entries(data)) {
    if (f && typeof f === 'object' && Number.isFinite(f.lat) && Number.isFinite(f.lon) && Number.isFinite(f.alt)) {
      out.push({ serial, f });
    }
  }
  return out;
}

/** Map a SondeHub frame to the webhook entity (core + flexible meta). */
function toBody(serial, f) {
  const meta = { callsign: serial };
  if (typeof f.type === 'string') meta.model = f.type;
  if (typeof f.manufacturer === 'string') meta.manufacturer = f.manufacturer;
  if (num(f.frequency) !== undefined) meta.freq_mhz = f.frequency;
  if (num(f.frame) !== undefined) meta.frame = f.frame;
  if (num(f.sats) !== undefined) meta.sats = f.sats;
  if (num(f.batt) !== undefined) meta.batt_v = f.batt;
  if (num(f.snr) !== undefined) meta.snr = f.snr;
  if (isReal(f.temp, -270)) meta.temp_c = f.temp;
  if (isReal(f.humidity, -1)) meta.humidity_pct = f.humidity;
  if (isReal(f.pressure, -1)) meta.pressure_hpa = f.pressure;
  return {
    name: serial,
    type: 'balloon',
    lat: f.lat,
    lon: f.lon,
    altitude_m: f.alt,
    heading: num(f.heading) ?? 0,
    speed_ms: Math.max(0, num(f.vel_h) ?? 0),
    climb_ms: num(f.vel_v) ?? 0,
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

const url = `${API}?lat=${LAT}&lon=${LON}&distance=${RADIUS_M}&last=${LAST_S}`;
console.log(`polling SondeHub within ${RADIUS_M / 1000}km of ${LAT},${LON} -> ${ENDPOINT} every ${PERIOD_MS}ms`);

let tickN = 0;
async function tick() {
  tickN++;
  let data;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) { console.log(`tick ${tickN} — SondeHub HTTP ${res.status}`); return; }
    data = await res.json();
  } catch (e) {
    console.log(`tick ${tickN} — fetch failed: ${e.message}`);
    return;
  }
  const sondes = sondesInRange(data);
  if (sondes.length === 0) { console.log(`tick ${tickN} — no sondes in range yet`); return; }
  const results = await Promise.allSettled(sondes.map(({ serial, f }) => post(toBody(serial, f))));
  const ok = results.filter((r) => r.status === 'fulfilled' && r.value === 200).length;
  const bad = results.length - ok;
  console.log(
    `tick ${tickN} — ${ok}/${sondes.length} fed${bad ? ` (${bad} failed — check WEBHOOK_SECRET)` : ''}: ` +
      sondes.map(({ serial, f }) => `${serial}@${Math.round(f.alt)}m`).join(', '),
  );
}

await tick();
const timer = setInterval(tick, PERIOD_MS);
process.on('SIGINT', () => { clearInterval(timer); console.log('\nstopped.'); process.exit(0); });
