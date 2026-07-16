# Webhook Contract

LazyMapHUD has a single authenticated ingest endpoint — `POST /webhook` —
plus one unauthenticated, trusted-network-only endpoint — `POST /chaser` —
for the chaser device's own GPS. Both upsert an `Entity` into the live store
and broadcast the change to every connected WebSocket client.

## `POST /webhook` (HMAC-authenticated)

### Auth: `X-Signature`

Every request must carry an `X-Signature` header: the hex-encoded
HMAC-SHA256 of the **raw request body** (bytes as sent, before any JSON
re-serialization), keyed by `WEBHOOK_SECRET`. A `sha256=` prefix (GitHub
convention) is accepted and stripped if present. Verification is
timing-safe. Missing or mismatched signatures get `401`.

The server also enforces, in front of the signature check:

- **Body size cap: 64KB.** Larger bodies get `413` before signature
  verification even runs.
- **Per-IP rate limit: 20 requests/second** (sliding window). Over-limit
  requests get `429`. This is a coarse abuse guard on top of HMAC, not a
  replacement for it — HMAC remains the actual trust boundary.

### Payload — minimal core + free-form metadata (default/`generic` adapter)

Only five fields are **required** to put a tracked object on the map.
Everything else is optional and treated as metadata.

```ts
{
  // --- required core ---
  name: string;              // display name; also the identity when `id` is omitted
  type: 'balloon' | 'aircraft' | 'vehicle' | 'chaser';
  lat: number;               // -90..90
  lon: number;               // -180..180
  altitude_m: number;

  // --- optional ---
  id?: string;               // stable correlation key; defaults to `name` when omitted
  ts?: number;               // epoch ms, source time — defaults to server-receive time if omitted
  meta?: Record<string, string | number | boolean>; // <=64 keys, <=4096 bytes serialized

  // --- anything else is metadata ---
  // Any other top-level scalar field (heading, speed_ms, climb_ms, callsign,
  // freq_mhz, battery_v, …) is auto-bucketed into `meta`. You can send a flat
  // JSON object; the server sorts core fields from metadata for you.
}
```

**Well-known meta keys** the HUD reads for dedicated readouts when present
(all optional): `heading` (deg), `speed_ms`, `climb_ms`, `sats`, `batt`,
`freq_mhz`, `mfr`. Any other key is shown verbatim in the detail panel's
metadata grid — attach whatever a source wants.

A schema-invalid body (missing `name`, wrong types, out-of-range lat/lon,
oversized `meta`) gets `400` with a Zod `issues` array. `meta` flows through
end-to-end: held in the in-memory store, broadcast over the WebSocket, and
rendered flexibly in the frontend's entity detail panel.

### Source adapters — `?source=` query param (or `source` field in the body)

The webhook accepts payloads shaped like a third-party feed instead of the
canonical `Entity`, by naming an adapter:

| `source` value | Expects | Notes |
|---|---|---|
| _(unset / unknown)_ | flat JSON with the required core (above) | `generic` adapter — default; fills `id` from `name` and `ts` if omitted, auto-buckets extra fields into `meta` |
| `sondehub` | a single [SondeHub](https://sondehub.org) telemetry frame, or a JSON array of frames | same field mapping as the built-in SondeHub poller (`SONDEHUB_SERIALS`); only the first mapped frame is upserted per request |
| `adsb` | a single `aircraft.json`-style record, or `{ "aircraft": [...] }` | same mapping as the built-in ADS-B poller (`ENABLE_ADSB`); only the first mapped record is upserted per request |

Example: `POST /webhook?source=sondehub` with a raw SondeHub frame body.

### Example: signing + sending with `curl`

```bash
SECRET="your-webhook-secret"
# Flat body: name/type/lat/lon/altitude_m are core; heading/speed_ms become meta.
BODY='{"name":"Chase Lead","type":"chaser","lat":21.0285,"lon":105.8542,"altitude_m":10,"heading":45,"speed_ms":3}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')

curl -X POST "https://your-host/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIG" \
  -d "$BODY"
# -> 200 {"ok":true,"id":"Chase Lead"}   (id defaults to name)
```

The signature must be computed over exactly the bytes in `-d "$BODY"` — if
you pipe through `jq` or otherwise reformat before sending, re-sign the
reformatted bytes, not the original.

### Response codes

| Code | Meaning |
|---|---|
| 200 | `{ "ok": true, "id": "<entity id>" }` — upserted |
| 400 | malformed JSON, or schema-invalid entity (`issues` array included) |
| 401 | missing/invalid `X-Signature` |
| 413 | body over 64KB |
| 429 | rate-limited (per source IP) |

## `POST /chaser` (open, trusted-network-only)

Powers chase mode — a phone/tablet opening the HUD with `?chase=<name>`
(see `web/src/controls/chase-mode.ts`) runs `navigator.geolocation.watchPosition()`
in the browser, which cannot hold the webhook's HMAC secret client-side. This
route trades authentication for network trust.

> **This endpoint has no authentication.** Anyone who can reach it can
> inject an arbitrary `type: 'chaser'` entity. It is designed to sit behind
> a VPN, a private LAN, or a reverse-proxy ACL — **do not expose it on the
> open internet without adding a gate** (device token, mTLS, or a
> Caddy/firewall rule restricting the path to a known network). See
> `docs/deployment.md` for concrete gating options before any public
> deploy.

### Payload

```ts
{
  id: string;              // device id, e.g. "chase-lead" (from ?id= or generated + persisted in localStorage)
  name?: string;             // display name; defaults to `id`
  lat: number;               // -90..90
  lon: number;               // -180..180
  altitude_m?: number;       // default 0
  heading?: number;          // 0..360 — folded into meta.heading
  speed_ms?: number;         // >= 0 — folded into meta.speed_ms
  meta?: Record<string, string | number | boolean>;
}
```

The device still sends flat `heading`/`speed_ms`; the server folds them into
`meta` to match the canonical contract (motion is metadata). `type` is always
forced to `'chaser'` server-side; `ts` is always the server-receive time (the
browser's device clock is not trusted for ordering).

### Guards in place today

- Body size cap: 4KB.
- Per-IP rate limit: 5 requests/second (sliding window) — `429` over limit.
- Standard `EntitySchema` validation after the payload is mapped — `400` on
  invalid lat/lon or a missing required core field.

### Example

```bash
curl -X POST "https://your-host/chaser" \
  -H "Content-Type: application/json" \
  -d '{"id":"chase-lead","lat":21.0285,"lon":105.8542,"heading":90,"speed_ms":4.2}'
# -> 200 {"ok":true,"id":"chase-lead"}
```

## `GET /history/:id`

Read-only, no auth (same trust level as the public map itself). Returns
recent track points for one entity, oldest-first, ordered by **server
receive time** (not the source-supplied `ts` — see the `recv_ts` note
below) — used for trail rendering and replay.

```
GET /history/:id?since=<epoch_ms>&limit=<n>
-> { "id": "...", "points": [{ lat, lon, altitude_m, ts }, ...] }
```

A trail point is just the path over time (position + altitude + timestamp);
motion is metadata on the live entity, not part of the trail. `limit`
defaults to 1000, capped at 5000. `since` filters by the point's source `ts`.

**Why ordering is by receive time, not source time:** each history point also
carries `recv_ts` — the server's wall-clock at the moment it accepted the
point. `history()` orders by `recv_ts`, not by the source-supplied `ts`. This
means even a misbehaving or malicious *but correctly signed* source can't
submit scrambled/out-of-order `ts` values to corrupt trail rendering — the
trail always reflects true arrival order.
