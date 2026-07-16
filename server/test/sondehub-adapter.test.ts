import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mapSondehubFrames } from '../src/adapters/sondehub.js';

const FIXTURE_PATH = fileURLToPath(
  new URL('../../concepts/data/Y0322352.track.json', import.meta.url),
);

/** Fixture shape: `{ serial, type, frames: [{ t, lat, lon, alt, vv, vh, hdg, sats, batt, frame }] }`. */
interface FixtureFrame {
  t: string;
  lat: number;
  lon: number;
  alt: number;
  vv: number;
  vh: number;
  hdg: number;
  frame: number;
}
interface Fixture {
  serial: string;
  type: string;
  frames: FixtureFrame[];
}

/** Convert the saved fixture's renamed fields to the live SondeHub v2 API's flat-array shape. */
function toRawApiShape(fixture: Fixture): unknown[] {
  return fixture.frames.map((f) => ({
    serial: fixture.serial,
    type: fixture.type,
    datetime: f.t,
    lat: f.lat,
    lon: f.lon,
    alt: f.alt,
    vel_v: f.vv,
    vel_h: f.vh,
    heading: f.hdg,
    frame: f.frame,
  }));
}

function loadFixture(): Fixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture;
}

describe('mapSondehubFrames', () => {
  it('maps the fixture flight to a single latest-frame Entity for the serial', () => {
    const fixture = loadFixture();
    const raw = toRawApiShape(fixture);
    const now = Date.parse('2026-07-15T13:00:00.000Z');

    const entities = mapSondehubFrames(raw, now);

    expect(entities).toHaveLength(1);
    const entity = entities[0]!;
    expect(entity.id).toBe('sonde-Y0322352');
    expect(entity.name).toBe('Y0322352');
    expect(entity.type).toBe('balloon');

    const lastFrame = fixture.frames[fixture.frames.length - 1]!;
    expect(entity.lat).toBe(lastFrame.lat);
    expect(entity.lon).toBe(lastFrame.lon);
    expect(entity.altitude_m).toBe(lastFrame.alt);
    // Motion travels as meta now (not core fields).
    expect(entity.meta?.climb_ms).toBe(lastFrame.vv);
    expect(entity.meta?.speed_ms).toBe(lastFrame.vh);
    expect(entity.meta?.heading).toBeCloseTo(lastFrame.hdg, 5);
    expect(entity.ts).toBe(Date.parse(lastFrame.t));
  });

  it('dedupes by frame number, keeping the record with the latest ts per frame', () => {
    const base = {
      serial: 'Y0322352',
      type: 'RS41',
      lat: 21.0,
      lon: 105.8,
      alt: 500,
      vel_v: 5,
      vel_h: 8,
      heading: 90,
      frame: 100,
    };
    const raw = [
      { ...base, datetime: '2026-07-15T12:00:00.000Z' },
      // Same frame number re-uploaded by a second receiver with a later ts
      // and a different fix — the later ts should win.
      { ...base, datetime: '2026-07-15T12:00:05.000Z', lat: 21.001, alt: 505 },
    ];
    const now = Date.parse('2026-07-15T12:01:00.000Z');

    const entities = mapSondehubFrames(raw, now);

    expect(entities).toHaveLength(1);
    expect(entities[0]!.lat).toBe(21.001);
    expect(entities[0]!.altitude_m).toBe(505);
    expect(entities[0]!.ts).toBe(Date.parse('2026-07-15T12:00:05.000Z'));
  });

  it('keeps only the latest frame per serial when multiple frames are present', () => {
    const raw = [
      {
        serial: 'Y0322352',
        datetime: '2026-07-15T12:00:00.000Z',
        lat: 21.0,
        lon: 105.8,
        alt: 500,
        vel_v: 5,
        vel_h: 8,
        heading: 90,
        frame: 100,
      },
      {
        serial: 'Y0322352',
        datetime: '2026-07-15T12:05:00.000Z',
        lat: 21.05,
        lon: 105.85,
        alt: 1000,
        vel_v: 6,
        vel_h: 9,
        heading: 95,
        frame: 130,
      },
    ];
    const now = Date.parse('2026-07-15T12:06:00.000Z');

    const entities = mapSondehubFrames(raw, now);

    expect(entities).toHaveLength(1);
    expect(entities[0]!.altitude_m).toBe(1000);
  });

  it('handles multiple serials independently', () => {
    const raw = [
      {
        serial: 'AAA111',
        datetime: '2026-07-15T12:00:00.000Z',
        lat: 21.0,
        lon: 105.8,
        alt: 500,
        vel_v: 5,
        vel_h: 8,
        heading: 90,
        frame: 1,
      },
      {
        serial: 'BBB222',
        datetime: '2026-07-15T12:00:00.000Z',
        lat: 10.0,
        lon: 100.0,
        alt: 200,
        vel_v: 1,
        vel_h: 2,
        heading: 45,
        frame: 1,
      },
    ];
    const now = Date.parse('2026-07-15T12:01:00.000Z');

    const entities = mapSondehubFrames(raw, now);

    expect(entities).toHaveLength(2);
    expect(entities.map((e) => e.id).sort()).toEqual(['sonde-AAA111', 'sonde-BBB222']);
  });

  it('clamps out negative ground speed and skips malformed/non-object entries', () => {
    const raw = [
      null,
      42,
      { serial: 'Y0322352' }, // missing required fields
      {
        serial: 'Y0322352',
        datetime: '2026-07-15T12:00:00.000Z',
        lat: 21.0,
        lon: 105.8,
        alt: 500,
        vel_v: -2,
        vel_h: -5, // implausible negative ground speed
        heading: 400, // out-of-range heading, should normalize into [0,360)
        frame: 1,
      },
    ];
    const now = Date.parse('2026-07-15T12:01:00.000Z');

    const entities = mapSondehubFrames(raw, now);

    expect(entities).toHaveLength(1);
    expect(entities[0]!.meta?.speed_ms).toBe(0);
    expect(entities[0]!.meta?.climb_ms).toBe(-2);
    expect(entities[0]!.meta?.heading).toBe(40);
  });

  it('ignores frames with an absurd future timestamp', () => {
    const raw = [
      {
        serial: 'Y0322352',
        datetime: '2099-01-01T00:00:00.000Z',
        lat: 21.0,
        lon: 105.8,
        alt: 500,
        vel_v: 5,
        vel_h: 8,
        heading: 90,
        frame: 1,
      },
    ];
    const now = Date.parse('2026-07-15T12:00:00.000Z');

    const entities = mapSondehubFrames(raw, now);

    expect(entities).toHaveLength(0);
  });

  it('returns an empty array for non-array input', () => {
    expect(mapSondehubFrames(undefined)).toEqual([]);
    expect(mapSondehubFrames(null)).toEqual([]);
    expect(mapSondehubFrames({ frames: [] })).toEqual([]);
  });
});
