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

### Payload — canonical `Entity` shape (default/`generic` adapter)

```ts
{
  id: string;              // stable per-entity id, e.g. "Y0322352" or "chase-lead"
  type: 'balloon' | 'aircraft' | 'vehicle' | 'chaser';
  lat: number;              // -90..90
  lon: number;               // -180..180
  altitude_m: number;
  heading: number;           // degrees, 0..360
  speed_ms: number;          // ground speed, >= 0
  climb_ms: number;          // vertical rate, +up
  ts?: number;                // epoch ms, source time — defaults to server-receive time if omitted
  meta?: Record<string, string | number | boolean>; // optional, <=32 keys, <=2048 bytes serialized
}
```

A schema-invalid body (wrong types, out-of-range lat/lon/heading, oversized
`meta`, etc.) gets `400` with a Zod `issues` array. `meta` flows through
end-to-end: stored as a JSON column, broadcast over the WebSocket, and
rendered in the frontend's entity detail panel (every key shown).

### Source adapters — `?source=` query param (or `source` field in the body)

The webhook accepts payloads shaped like a third-party feed instead of the
canonical `Entity`, by naming an adapter:

| `source` value | Expects | Notes |
|---|---|---|
| _(unset / unknown)_ | canonical `Entity` JSON (above) | `generic` adapter — default; only fills in `ts` if omitted |
| `sondehub` | a single [SondeHub](https://sondehub.org) telemetry frame, or a JSON array of frames | same field mapping as the built-in SondeHub poller (`SONDEHUB_SERIALS`); only the first mapped frame is upserted per request |
| `adsb` | a single `aircraft.json`-style record, or `{ "aircraft": [...] }` | same mapping as the built-in ADS-B poller (`ENABLE_ADSB`); only the first mapped record is upserted per request |

Example: `POST /webhook?source=sondehub` with a raw SondeHub frame body.

### Example: signing + sending with `curl`

```bash
SECRET="your-webhook-secret"
BODY='{"id":"chaser-lead","type":"chaser","lat":21.0285,"lon":105.8542,"altitude_m":10,"heading":45,"speed_ms":3,"climb_ms":0,"ts":1700000000000}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')

curl -X POST "https://your-host/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIG" \
  -d "$BODY"
# -> 200 {"ok":true,"id":"chaser-lead"}
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

Powers the Chaser-mode device page (`chase.html`) — a phone/tablet running
`navigator.geolocation.watchPosition()` in the browser, which cannot hold
the webhook's HMAC secret client-side. This route trades authentication for
network trust.

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
  lat: number;              // -90..90
  lon: number;               // -180..180
  altitude_m?: number;       // default 0
  heading?: number;          // default 0, 0..360
  speed_ms?: number;         // default 0, >= 0
  meta?: Record<string, string | number | boolean>;
}
```

`type` is always forced to `'chaser'` server-side; `climb_ms` is always `0`;
`ts` is always the server-receive time (the browser's device clock is not
trusted for ordering).

### Guards in place today

- Body size cap: 4KB.
- Per-IP rate limit: 5 requests/second (sliding window) — `429` over limit.
- Standard `EntitySchema` validation after the payload is mapped — `400` on
  invalid lat/lon/heading.

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
-> { "id": "...", "points": [{ lat, lon, altitude_m, heading, speed_ms, climb_ms, ts }, ...] }
```

`limit` defaults to 1000, capped at 5000. `since` filters by the point's
source `ts` (not `recv_ts`).

**Why ordering is by receive time, not source time:** an entity's history
row also stores `recv_ts` — the server's wall-clock at the moment it
accepted the point. `history()` orders by `recv_ts` (falling back to `ts`
for any legacy row), not by the source-supplied `ts`. This means even a
misbehaving or malicious *but correctly signed* source can't submit
scrambled/out-of-order `ts` values to corrupt trail rendering — the trail
always reflects true arrival order.
