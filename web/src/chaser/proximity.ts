// Proximity detection + full-screen RED warning. Horizontal great-circle distance
// (shared haversine) from the VIEWER'S OWN chaser to each target's GROUND
// position; any target inside the 1 km ring fires the warning and flags the
// ring red. The active target's distance is always shown in the top-right
// overlay. With no own-chaser resolved (several chasers, none chosen yet) there
// is no ring/warning to compute.
import { haversineMeters, formatDistance } from 'shared';
import type { EntityEngine } from '../entities/entity-engine.js';
import { RANGE_M } from '../entities/entity-engine.js';
import type { MapController } from '../map/leaflet-map.js';
import { resolveMyChaser } from './my-chaser.js';
import { $ } from '../hud/format.js';
import { store } from '../state/store.js';

interface LatLon {
  lat: number;
  lon: number;
}

/** Initial compass bearing (deg, 0-360) from point a to point b. */
function bearingDeg(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const phi1 = a.lat * rad;
  const phi2 = b.lat * rad;
  const dLon = (b.lon - a.lon) * rad;
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

/** Set an element's textContent by selector (no-op when absent). */
function txt(sel: string, v: string): void {
  const el = $(sel);
  if (el) el.textContent = v;
}

export class Proximity {
  /** ids currently inside the ring — render-entities flashes these red. */
  readonly warnIds = new Set<string>();
  private warnActive = false;

  constructor(
    private readonly engine: EntityEngine,
    private readonly mapCtrl: MapController,
  ) {}

  update(): void {
    const chaser = resolveMyChaser(this.engine);
    if (!chaser || !chaser.cur) {
      // No own-chaser to measure from — blank the range readout and clear any
      // lingering warning state.
      txt('#dist-from', 'NO CHASER');
      txt('#dist-id', '—');
      txt('#dist-val', '—');
      txt('#dist-brg', '—');
      if (this.warnIds.size > 0) this.warnIds.clear();
      if (this.warnActive) {
        this.mapCtrl.styleRing(false);
        this.warnActive = false;
        $('#warn-overlay')?.classList.remove('on');
        $('#warn-banner')?.classList.remove('on');
        $('#ov-dist')?.classList.remove('warn');
      }
      return;
    }
    this.warnIds.clear();
    let closestIn: (typeof this.engine.entities)[number] | null = null;
    let closestInKm = 1e9;
    this.engine.entities.forEach((e) => {
      if (!e.cur) return;
      const km = haversineMeters(chaser.cur!, { lat: e.cur.lat, lon: e.cur.lon }) / 1000;
      e._km = km;
      if (km * 1000 <= RANGE_M) {
        this.warnIds.add(e.id);
        if (km < closestInKm) {
          closestInKm = km;
          closestIn = e;
        }
      }
    });

    const active = this.engine.entities.find((x) => x.id === store.selectedId);
    const aKm = active && active._km != null ? active._km : null;
    const u = store.units;
    // Range readout: from the viewer's own chaser -> the selected target, with
    // a compass bearing so a chase crew knows which way to drive.
    txt('#dist-from', chaser.name);
    txt('#dist-id', active ? active.name : '—');
    txt('#dist-val', aKm != null ? formatDistance(aKm * 1000, u) : '—');
    txt(
      '#dist-brg',
      active && active.cur ? String(Math.round(bearingDeg(chaser.cur, active.cur))).padStart(3, '0') + '°' : '—',
    );
    const distVal = $<HTMLElement>('#dist-val');

    const inRange = this.warnIds.size > 0;
    const bannerTgt = active && this.warnIds.has(active.id) ? active : closestIn;
    const ov = $('#ov-dist');
    const overlay = $('#warn-overlay');
    const banner = $('#warn-banner');
    ov?.classList.toggle('warn', inRange);
    if (inRange && bannerTgt) {
      overlay?.classList.add('on');
      banner?.classList.add('on');
      const wt = $('#warn-text');
      if (wt)
        wt.textContent =
          'TARGET LOCKED — ' + bannerTgt.name + ' — ' + formatDistance(bannerTgt._km! * 1000, u).toUpperCase();
      if (distVal) distVal.style.color = '#fff';
    } else {
      overlay?.classList.remove('on');
      banner?.classList.remove('on');
      if (distVal) distVal.style.color = '';
    }
    if (inRange !== this.warnActive) {
      this.mapCtrl.styleRing(inRange);
      this.warnActive = inRange;
    }
  }
}
