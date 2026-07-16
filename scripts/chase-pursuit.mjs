#!/usr/bin/env node
// Simulate a recovery chaser pursuing a live target: each tick it reads the
// target's current ground position (from GET /history/:id, last point) and
// drives the chaser toward it at a ground speed, closing the gap until it
// enters the 1 km recovery ring — which fires the HUD proximity warning.
//
// Needs the target already being fed (e.g. replay-sondes.mjs running).
//
// Usage:
//   node scripts/chase-pursuit.mjs                       # chase Y0342819
//   TARGET=Y0322353 SPEED_MS=35 node scripts/chase-pursuit.mjs
//
// Env:
//   API         backend base URL     (default http://localhost:3000)
//   TARGET      entity id/name to chase (default Y0342819)
//   CHASER_ID   chaser device id     (default chase-lead)
//   CHASER_NAME chaser display name  (default "Recovery Lead")
//   SPEED_MS    chaser ground speed  (default 30 m/s ≈ 108 km/h)
//   START_KM    initial distance behind the target (default 6 km)
//   PERIOD_MS   ms between ticks     (default 1000)
const API = process.env.API ?? 'http://localhost:3000';
const TARGET = process.env.TARGET ?? 'Y0342819';
const CHASER_ID = process.env.CHASER_ID ?? 'chase-lead';
const CHASER_NAME = process.env.CHASER_NAME ?? 'Recovery Lead';
const SPEED_MS = Number(process.env.SPEED_MS ?? 30);
const START_KM = Number(process.env.START_KM ?? 6);
const PERIOD_MS = Number(process.env.PERIOD_MS ?? 1000);

const M_PER_DEG = 111_320;
const dt = PERIOD_MS / 1000;

// Geodesy on a local flat approximation (fine at chase ranges).
function vec(from, to) {
  const north = (to.lat - from.lat) * M_PER_DEG;
  const east = (to.lon - from.lon) * M_PER_DEG * Math.cos((from.lat * Math.PI) / 180);
  return { north, east, dist: Math.hypot(north, east) };
}
function move(pos, heading, meters) {
  const rad = (heading * Math.PI) / 180;
  return {
    lat: pos.lat + (meters * Math.cos(rad)) / M_PER_DEG,
    lon: pos.lon + (meters * Math.sin(rad)) / (M_PER_DEG * Math.cos((pos.lat * Math.PI) / 180)),
  };
}
const bearing = (v) => (Math.atan2(v.east, v.north) * 180) / Math.PI;

async function targetPos() {
  const res = await fetch(`${API}/history/${encodeURIComponent(TARGET)}?limit=1000`);
  if (!res.ok) return null;
  const pts = (await res.json()).points;
  const p = pts?.[pts.length - 1];
  return p ? { lat: p.lat, lon: p.lon } : null;
}
async function postChaser(body) {
  const res = await fetch(`${API}/chaser`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.status;
}

// Wait for the target to exist, then spawn the chaser START_KM behind it.
let chaser = null;
async function ensureStart() {
  const t = await targetPos();
  if (!t) return false;
  // Start START_KM due south-west of the target so it visibly closes in.
  chaser = move(t, 225, START_KM * 1000);
  console.log(`chasing ${TARGET}: start ${START_KM}km out, ${SPEED_MS} m/s -> POST ${API}/chaser`);
  return true;
}

let tickN = 0;
async function tick() {
  const t = await targetPos();
  if (!t) {
    console.log(`waiting for target ${TARGET} to appear...`);
    return;
  }
  if (!chaser) chaser = move(t, 225, START_KM * 1000);
  tickN++;

  const v = vec(chaser, t);
  const hdg = (bearing(v) + 360) % 360;
  const stepM = Math.min(SPEED_MS * dt, v.dist); // don't overshoot the target
  chaser = move(chaser, hdg, stepM);

  const status = await postChaser({
    id: CHASER_ID,
    name: CHASER_NAME,
    lat: Number(chaser.lat.toFixed(6)),
    lon: Number(chaser.lon.toFixed(6)),
    altitude_m: 12,
    heading: Number(hdg.toFixed(1)),
    speed_ms: SPEED_MS,
  });
  const km = (v.dist / 1000).toFixed(2);
  const inRing = v.dist <= 1000 ? '  <<< INSIDE 1km RING >>>' : '';
  console.log(`tick ${String(tickN).padStart(4)} — gap ${km}km hdg ${hdg.toFixed(0)}° -> ${status}${inRing}`);
}

await ensureStart();
await tick();
const timer = setInterval(tick, PERIOD_MS);
process.on('SIGINT', () => {
  clearInterval(timer);
  console.log('\nstopped.');
  process.exit(0);
});
