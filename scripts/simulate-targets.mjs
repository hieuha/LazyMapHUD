#!/usr/bin/env node
// Simulate a fleet of moving targets (and optionally chasers) into a running
// LazyMapHUD backend, so the HUD populates with ~10 live objects that actually
// move — for demoing/scale-testing the map, roster, trails, and proximity.
//
// Each tick it dead-reckons every target forward along its heading/speed,
// nudges altitude per type (balloons ascend then burst+descend, aircraft
// cruise, vehicles crawl), and POSTs a flat JSON body to /webhook (HMAC-
// signed). Only name/type/lat/lon/altitude_m are required by the server;
// heading/speed_ms/climb_ms and any extra keys are auto-bucketed into `meta`.
//
// Usage:
//   node scripts/simulate-targets.mjs
//   WEBHOOK_SECRET=your-secret node scripts/simulate-targets.mjs
//   SEED=./scripts/fixtures/targets.sample.json WEBHOOK_SECRET=xxx node scripts/simulate-targets.mjs
//   COUNT=10 CHASERS=3 PERIOD_MS=1000 WEBHOOK_SECRET=xxx node scripts/simulate-targets.mjs
//
// Env:
//   URL             webhook endpoint      (default http://localhost:3000/webhook)
//   CHASER_URL      chaser endpoint       (default http://localhost:3000/chaser)
//   WEBHOOK_SECRET  HMAC secret; must match the server (default local-dev-secret)
//   SEED            path to a targets JSON you fill with real data (see format below)
//   COUNT           # of synthetic targets when no SEED (default 10)
//   CHASERS         # of synthetic chaser devices to also drive (default 0)
//   PERIOD_MS       ms between ticks      (default 1000)
//   CENTER          "lat,lon" spawn center for synthetic data (default Hanoi)
//
// SEED file format — an array (or { "targets": [...] }) of objects. Only
// name/type/lat/lon/altitude_m are required; the rest seed initial motion +
// metadata and are optional:
//   [
//     { "name": "VN123", "type": "aircraft", "lat": 21.02, "lon": 105.85,
//       "altitude_m": 10000, "heading": 270, "speed_ms": 230,
//       "callsign": "HVN123", "freq_mhz": 118.1 }
//   ]
// type ∈ balloon | aircraft | vehicle.  Any key beyond the core becomes meta.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ENDPOINT = process.env.URL ?? 'http://localhost:3000/webhook';
const CHASER_ENDPOINT = process.env.CHASER_URL ?? 'http://localhost:3000/chaser';
const SECRET = process.env.WEBHOOK_SECRET ?? 'local-dev-secret';
const PERIOD_MS = Number(process.env.PERIOD_MS ?? 1000);
const COUNT = Number(process.env.COUNT ?? 10);
const CHASERS = Number(process.env.CHASERS ?? 0);
const [CLAT, CLON] = (process.env.CENTER ?? '21.0285,105.8542').split(',').map(Number);

const EARTH_M_PER_DEG = 111_320; // meters per degree latitude (good enough near the equator/mid-lats)
const BURST_ALT_M = 30_000; // radiosonde balloons burst around here, then descend

// Deterministic-ish jitter without Math.random seeding noise concerns — good
// enough for a demo feed. (Node's Math.random is fine here; this is not crypto.)
const rand = (a, b) => a + Math.random() * (b - a);
const wrap360 = (d) => ((d % 360) + 360) % 360;

// Advance a lat/lon by `speed` m/s along `heading` deg over `dt` s.
function move(lat, lon, heading, speed, dt) {
  const rad = (heading * Math.PI) / 180;
  const north = speed * Math.cos(rad) * dt;
  const east = speed * Math.sin(rad) * dt;
  const dLat = north / EARTH_M_PER_DEG;
  const dLon = east / (EARTH_M_PER_DEG * Math.cos((lat * Math.PI) / 180));
  return [lat + dLat, lon + dLon];
}

// Build the synthetic default fleet: a spread of balloons/aircraft/vehicles
// around CENTER. Replace this by passing a SEED file with real data.
function defaultFleet(n) {
  const types = ['balloon', 'aircraft', 'vehicle'];
  const fleet = [];
  for (let i = 0; i < n; i++) {
    const type = types[i % types.length];
    const base = {
      name: `${type}-${String(i + 1).padStart(2, '0')}`,
      type,
      lat: CLAT + rand(-0.15, 0.15),
      lon: CLON + rand(-0.15, 0.15),
      heading: rand(0, 360),
    };
    if (type === 'aircraft') {
      Object.assign(base, { altitude_m: rand(6000, 11000), speed_ms: rand(180, 250), climb_ms: 0,
        callsign: `HVN${100 + i}`, freq_mhz: 118.1 });
    } else if (type === 'vehicle') {
      Object.assign(base, { altitude_m: rand(5, 60), speed_ms: rand(8, 22), climb_ms: 0, plate: `29A-${1000 + i}` });
    } else {
      Object.assign(base, { altitude_m: rand(500, 4000), speed_ms: rand(4, 14), climb_ms: 5,
        callsign: `SONDE${i}`, freq_mhz: 403 + i * 0.01, sats: 9, batt_v: 3.1 });
    }
    fleet.push(base);
  }
  return fleet;
}

function loadSeed(path) {
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const arr = Array.isArray(doc) ? doc : doc.targets;
  if (!Array.isArray(arr) || arr.length === 0) throw new Error(`no targets in ${path}`);
  // Seed sane motion defaults so entries can omit them.
  return arr.map((t) => ({ heading: 0, speed_ms: 0, climb_ms: 0, ...t }));
}

// One physics step, mutating the target's position/altitude/heading in place.
function step(t, dt) {
  [t.lat, t.lon] = move(t.lat, t.lon, t.heading, t.speed_ms ?? 0, dt);
  if (t.type === 'balloon') {
    if (t.altitude_m >= BURST_ALT_M) t.climb_ms = -8; // burst -> descend
    t.altitude_m = Math.max(0, t.altitude_m + (t.climb_ms ?? 0) * dt);
    t.heading = wrap360(t.heading + rand(-4, 4)); // wind drift
  } else if (t.type === 'aircraft') {
    t.heading = wrap360(t.heading + rand(-1.5, 1.5)); // gentle turns
  } else {
    t.heading = wrap360(t.heading + rand(-8, 8)); // road wander
    t.altitude_m = Math.max(0, (t.altitude_m ?? 10) + rand(-1, 1));
  }
}

// Split the core fields from everything else (which becomes meta on the wire).
const CORE = new Set(['name', 'type', 'lat', 'lon', 'altitude_m', 'heading', 'speed_ms', 'climb_ms']);
function toBody(t) {
  const body = {
    name: t.name,
    type: t.type,
    lat: round(t.lat, 6),
    lon: round(t.lon, 6),
    altitude_m: round(t.altitude_m, 1),
    heading: round(wrap360(t.heading), 1),
    speed_ms: round(t.speed_ms ?? 0, 2),
    climb_ms: round(t.climb_ms ?? 0, 2),
  };
  for (const [k, v] of Object.entries(t)) if (!CORE.has(k)) body[k] = v; // pass-through meta
  return body;
}
const round = (n, d) => Number(n.toFixed(d));

async function postSigned(url, body) {
  const raw = JSON.stringify(body);
  const sig = createHmac('sha256', SECRET).update(raw).digest('hex');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': sig },
    body: raw,
  });
  return res.status;
}
async function postChaser(body) {
  const res = await fetch(CHASER_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.status;
}

// --- build the fleet ---
const targets = process.env.SEED ? loadSeed(process.env.SEED) : defaultFleet(COUNT);
const chasers = Array.from({ length: CHASERS }, (_, i) => ({
  id: `chase-${i + 1}`,
  name: `Team ${i + 1}`,
  lat: CLAT + rand(-0.05, 0.05),
  lon: CLON + rand(-0.05, 0.05),
  heading: rand(0, 360),
  speed_ms: rand(10, 20),
}));

console.log(
  `simulating ${targets.length} target(s)` +
    (CHASERS ? ` + ${CHASERS} chaser(s)` : '') +
    ` -> ${ENDPOINT} every ${PERIOD_MS}ms (secret ${SECRET === 'local-dev-secret' ? 'default' : 'set'})`,
);

const dt = PERIOD_MS / 1000;
let tickN = 0;
async function tick() {
  tickN++;
  const results = await Promise.allSettled(
    targets.map((t) => {
      step(t, dt);
      return postSigned(ENDPOINT, toBody(t));
    }),
  );
  for (const c of chasers) {
    [c.lat, c.lon] = move(c.lat, c.lon, c.heading, c.speed_ms, dt);
    c.heading = wrap360(c.heading + rand(-6, 6));
    await postChaser({ id: c.id, name: c.name, lat: round(c.lat, 6), lon: round(c.lon, 6), heading: round(c.heading, 1), speed_ms: round(c.speed_ms, 2) });
  }
  const ok = results.filter((r) => r.status === 'fulfilled' && r.value === 200).length;
  const bad = results.length - ok;
  console.log(`tick ${String(tickN).padStart(4)} — ${ok}/${results.length} ok${bad ? ` (${bad} failed — check WEBHOOK_SECRET)` : ''}`);
}

await tick();
const timer = setInterval(tick, PERIOD_MS);
process.on('SIGINT', () => {
  clearInterval(timer);
  console.log('\nstopped.');
  process.exit(0);
});
