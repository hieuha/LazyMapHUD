// Proximity detection + full-screen RED warning. Horizontal great-circle distance
// (shared haversine) from the chaser to each target's GROUND position; any target
// inside the 1 km ring fires the warning and flags the ring red. The active
// target's distance is always shown in the top-right overlay.
import { haversineMeters, formatDistance } from 'shared';
import type { EntityEngine } from '../entities/entity-engine.js';
import { RANGE_M } from '../entities/entity-engine.js';
import type { MapController } from '../map/leaflet-map.js';
import { $ } from '../hud/format.js';
import { store } from '../state/store.js';

export class Proximity {
  /** ids currently inside the ring — render-entities flashes these red. */
  readonly warnIds = new Set<string>();
  private warnActive = false;

  constructor(
    private readonly engine: EntityEngine,
    private readonly mapCtrl: MapController,
  ) {}

  update(): void {
    const chaser = this.engine.chaser;
    if (!chaser.cur) return;
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
    const distId = $('#dist-id');
    const distVal = $<HTMLElement>('#dist-val');
    if (distId) distId.textContent = active ? active.id : '—';
    if (distVal) distVal.textContent = aKm != null ? formatDistance(aKm * 1000, u) : '— ' + (u === 'imperial' ? 'mi' : 'km');

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
        wt.innerHTML =
          'TARGET LOCKED — <b>' + bannerTgt.id + '</b> — ' + formatDistance(bannerTgt._km! * 1000, u).toUpperCase();
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
