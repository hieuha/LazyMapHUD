#!/usr/bin/env node
// Replay real RS41 radiosonde flight logs into a running LazyMapHUD backend —
// all files at once, one frame per tick each — so the HUD shows a whole fleet
// of real balloons flying their true ascent/burst/descent paths simultaneously.
//
// Input: the `*_sonde.log` CSV logs in scripts/fixtures/ (header row:
//   timestamp,serial,frame,lat,lon,alt,vel_v,vel_h,heading,temp,humidity,
//   pressure,type,freq_mhz,snr,f_error_hz,sats,batt_v,burst_timer,aux_data)
// Each file is one sonde (its serial = the entity name). Absolute timestamps
// are ignored (the flights are from different days) — frames are replayed in
// order at a synthetic cadence so they all appear "now" and move together.
//
// Usage:
//   node scripts/replay-sondes.mjs
//   WEBHOOK_SECRET=xxx node scripts/replay-sondes.mjs
//   FILES="a.log,b.log" STEP=4 PERIOD_MS=1000 LOOP=false node scripts/replay-sondes.mjs
//
// Env:
//   URL             webhook endpoint (default http://localhost:3000/webhook)
//   WEBHOOK_SECRET  HMAC secret; must match the server (default local-dev-secret)
//   FILES           comma-separated log paths (default: all fixtures/*_sonde.log)
//   PERIOD_MS       ms between ticks (default 1000)
//   STEP            frames advanced per tick per sonde (default 1; raise to fast-forward)
//   LOOP            "false" to stop each sonde at its last frame (default loops)
import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENDPOINT = process.env.URL ?? 'http://localhost:3000/webhook';
const SECRET = process.env.WEBHOOK_SECRET ?? 'local-dev-secret';
const PERIOD_MS = Number(process.env.PERIOD_MS ?? 1000);
const STEP = Math.max(1, Number(process.env.STEP ?? 1));
const LOOP = process.env.LOOP !== 'false';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const files = process.env.FILES
  ? process.env.FILES.split(',').map((s) => s.trim()).filter(Boolean)
  : readdirSync(FIXTURES).filter((f) => f.endsWith('_sonde.log')).map((f) => FIXTURES + f);

if (files.length === 0) {
  console.error('no *_sonde.log files found (set FILES=...)');
  process.exit(1);
}

// Sentinels used in these logs for "no reading" — dropped so meta stays clean.
const isReal = (n, floor) => Number.isFinite(n) && n > floor;

// Parse one CSV log into { serial, frames: [{lat,lon,alt,vv,vh,hdg,...meta}] }.
function parseLog(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
  const cols = lines[0].split(',');
  const idx = Object.fromEntries(cols.map((c, i) => [c, i]));
  const num = (r, key) => Number(r[idx[key]]);
  const frames = [];
  let serial = 'sonde';
  for (let i = 1; i < lines.length; i++) {
    const r = lines[i].split(',');
    const lat = num(r, 'lat');
    const lon = num(r, 'lon');
    const alt = num(r, 'alt');
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(alt)) continue;
    serial = r[idx.serial] || serial;
    const meta = {
      model: r[idx.type] || 'RS41',
      freq_mhz: num(r, 'freq_mhz'),
      frame: num(r, 'frame'),
      sats: num(r, 'sats'),
      batt_v: num(r, 'batt_v'),
      snr: num(r, 'snr'),
    };
    const temp = num(r, 'temp');
    const humidity = num(r, 'humidity');
    const pressure = num(r, 'pressure');
    if (isReal(temp, -273)) meta.temp_c = temp;
    if (isReal(humidity, -1)) meta.humidity_pct = humidity;
    if (isReal(pressure, -1)) meta.pressure_hpa = pressure;
    const burst = r[idx.burst_timer];
    if (burst) meta.burst_timer = burst;
    frames.push({ lat, lon, alt, vv: num(r, 'vel_v'), vh: num(r, 'vel_h'), hdg: num(r, 'heading'), meta });
  }
  return { serial, frames };
}

const sondes = files
  .map((f) => {
    try {
      const s = parseLog(f);
      return s.frames.length ? { ...s, cursor: 0, done: false } : null;
    } catch (e) {
      console.error(`skip ${f}: ${e.message}`);
      return null;
    }
  })
  .filter(Boolean);

console.log(
  `replaying ${sondes.length} sonde(s) -> ${ENDPOINT} @ ${PERIOD_MS}ms x${STEP}${LOOP ? ' (loops)' : ''}:\n  ` +
    sondes.map((s) => `${s.serial}(${s.frames.length})`).join(', '),
);

function toBody(serial, f) {
  return {
    name: serial,
    type: 'balloon',
    lat: f.lat,
    lon: f.lon,
    altitude_m: f.alt,
    heading: Number.isFinite(f.hdg) ? f.hdg : 0,
    speed_ms: Number.isFinite(f.vh) ? Math.max(0, f.vh) : 0,
    climb_ms: Number.isFinite(f.vv) ? f.vv : 0,
    callsign: serial,
    ...f.meta,
  };
}

async function postFrame(serial, f) {
  const raw = JSON.stringify(toBody(serial, f));
  const sig = createHmac('sha256', SECRET).update(raw).digest('hex');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': sig },
    body: raw,
  });
  return res.status;
}

let tickN = 0;
async function tick() {
  tickN++;
  const results = await Promise.allSettled(
    sondes.map((s) => {
      if (s.done) return Promise.resolve(null);
      const f = s.frames[Math.min(s.cursor, s.frames.length - 1)];
      s.cursor += STEP;
      if (s.cursor >= s.frames.length) {
        if (LOOP) s.cursor = 0;
        else s.done = true;
      }
      return postFrame(s.serial, f);
    }),
  );
  const active = sondes.filter((s) => !s.done).length;
  const ok = results.filter((r) => r.status === 'fulfilled' && r.value === 200).length;
  const bad = results.filter((r) => r.status === 'fulfilled' && r.value && r.value !== 200).length;
  console.log(`tick ${String(tickN).padStart(4)} — ${ok} ok${bad ? ` / ${bad} FAILED (check WEBHOOK_SECRET)` : ''}, ${active} flying`);
  if (active === 0) {
    clearInterval(timer);
    console.log('all sondes reached end of flight (LOOP=false).');
  }
}

await tick();
const timer = setInterval(tick, PERIOD_MS);
process.on('SIGINT', () => {
  clearInterval(timer);
  console.log('\nstopped.');
  process.exit(0);
});
