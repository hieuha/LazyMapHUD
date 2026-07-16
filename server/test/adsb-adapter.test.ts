import { describe, it, expect } from 'vitest';
import { mapAdsbAircraft } from '../src/adapters/adsb.js';

describe('mapAdsbAircraft', () => {
  it('maps a dump1090/tar1090 aircraft.json sample to canonical Entities', () => {
    const sample = {
      now: 1752570000, // epoch seconds
      aircraft: [
        {
          hex: 'a1b2c3',
          flight: 'UAL123  ',
          lat: 37.615,
          lon: -122.389,
          alt_baro: 35000, // feet
          gs: 480, // knots
          track: 270.5,
          baro_rate: -640, // ft/min (descending)
        },
      ],
    };

    const entities = mapAdsbAircraft(sample);

    expect(entities).toHaveLength(1);
    const e = entities[0]!;
    expect(e.id).toBe('adsb-a1b2c3');
    expect(e.name).toBe('UAL123'); // `flight` callsign, trimmed
    expect(e.type).toBe('aircraft');
    expect(e.lat).toBe(37.615);
    expect(e.lon).toBe(-122.389);
    expect(e.altitude_m).toBeCloseTo(35000 * 0.3048, 3);
    // Motion travels as meta now (not core fields).
    expect(e.meta?.speed_ms).toBeCloseTo(480 * 0.514444, 3);
    expect(e.meta?.heading).toBeCloseTo(270.5, 5);
    expect(e.meta?.climb_ms).toBeCloseTo((-640 * 0.3048) / 60, 5);
    expect(e.ts).toBe(1752570000 * 1000);
  });

  it('treats "ground" baro altitude as 0m and omits absent motion fields', () => {
    const sample = {
      aircraft: [
        { hex: 'deadbe', lat: 10, lon: 20, alt_baro: 'ground' as const },
      ],
    };

    const entities = mapAdsbAircraft(sample, 1_700_000_000_000);

    expect(entities).toHaveLength(1);
    const e = entities[0]!;
    expect(e.name).toBe('deadbe'); // no `flight` -> falls back to the ICAO hex
    expect(e.altitude_m).toBe(0);
    // No gs/track/baro_rate reported -> no motion meta at all (omitted, not 0).
    expect(e.meta).toBeUndefined();
    expect(e.ts).toBe(1_700_000_000_000);
  });

  it('skips aircraft without a lat/lon fix', () => {
    const sample = {
      aircraft: [{ hex: 'nofix1', alt_baro: 10000 }],
    };

    expect(mapAdsbAircraft(sample)).toEqual([]);
  });

  it('returns an empty array for a malformed/missing payload', () => {
    expect(mapAdsbAircraft(undefined)).toEqual([]);
    expect(mapAdsbAircraft(null)).toEqual([]);
    expect(mapAdsbAircraft({})).toEqual([]);
    expect(mapAdsbAircraft({ aircraft: 'not-an-array' })).toEqual([]);
  });
});
