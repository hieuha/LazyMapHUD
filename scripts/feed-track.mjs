#!/usr/bin/env node
// Replay a recorded track into a running LazyMapHUD backend via HMAC-signed
// POST /webhook, one frame per second, so an entity flies its real path on the
// HUD for tracking observation / smoke testing. Loops back to the start.
//
// Usage:
//   node scripts/feed-track.mjs
//   WEBHOOK_SECRET=xxx URL=http://host:3000/webhook PERIOD_MS=500 node scripts/feed-track.mjs
//   TRACK=./scripts/fixtures/Y0322352.track.json ID=Y0322352 node scripts/feed-track.mjs
//
// Env:
//   URL             webhook endpoint (default http://localhost:3000/webhook)
//   WEBHOOK_SECRET  HMAC secret, must match the server (default local-dev-secret)
//   TRACK           path to a SondeHub-style track JSON (default: bundled Y0322352)
//   ID              entity id to feed under (default: track serial)
//   PERIOD_MS       ms between frames (default 1000)
//   LOOP            "false" to stop after the last frame (default loops)
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENDPOINT = process.env.URL ?? 'http://localhost:3000/webhook';
const SECRET = process.env.WEBHOOK_SECRET ?? 'local-dev-secret';
const TRACK = process.env.TRACK
  ? process.env.TRACK
  : fileURLToPath(new URL('./fixtures/Y0322352.track.json', import.meta.url));
const PERIOD_MS = Number(process.env.PERIOD_MS ?? 1000);
const LOOP = process.env.LOOP !== 'false';

const doc = JSON.parse(readFileSync(TRACK, 'utf8'));
const frames = doc.frames ?? [];
if (!frames.length) {
  console.error(`no frames in ${TRACK}`);
  process.exit(1);
}
const ID = process.env.ID ?? String(doc.serial ?? 'track');
console.log(`feeding ${frames.length} frames of ${ID} -> ${ENDPOINT} every ${PERIOD_MS}ms${LOOP ? ' (loops)' : ''}`);

// Map one SondeHub-style frame {t,lat,lon,alt,vv,vh,hdg,sats,batt,frame} to the
// canonical Entity the /webhook generic adapter expects.
function toEntity(f, seq) {
  return {
    id: ID,
    name: ID,
    type: 'balloon',
    lat: f.lat,
    lon: f.lon,
    altitude_m: f.alt,
    heading: f.hdg ?? 0,
    speed_ms: f.vh ?? 0,
    climb_ms: f.vv ?? 0,
    ts: Date.now(),
    meta: {
      serial: String(doc.serial ?? ID),
      model: String(doc.type ?? 'RS41'),
      manufacturer: String(doc.manufacturer ?? 'Vaisala'),
      freq_mhz: Number(doc.frequency ?? 403),
      frame: Number(f.frame ?? seq),
      sats: Number(f.sats ?? 0),
      batt_v: Number(f.batt ?? 0),
    },
  };
}

let i = 0;
async function tick() {
  const f = frames[i % frames.length];
  const entity = toEntity(f, i);
  const body = JSON.stringify(entity);
  const sig = createHmac('sha256', SECRET).update(body).digest('hex');
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': sig },
      body,
    });
    const climb = entity.climb_ms >= 0 ? `+${entity.climb_ms}` : `${entity.climb_ms}`;
    console.log(
      `[${String(i + 1).padStart(3)}/${frames.length}] frame ${entity.meta.frame} ` +
        `alt ${entity.altitude_m.toFixed(0)}m climb ${climb}m/s ` +
        `@ ${entity.lat.toFixed(4)},${entity.lon.toFixed(4)} -> ${res.status}`,
    );
  } catch (e) {
    console.error(`POST failed: ${e.message}`);
  }
  i++;
  if (!LOOP && i >= frames.length) {
    clearInterval(timer);
    console.log('done (LOOP=false)');
  }
}

await tick();
const timer = setInterval(tick, PERIOD_MS);
