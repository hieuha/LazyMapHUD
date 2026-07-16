// Leaflet map init + follow-cam (TRACK LOCK) + click-to-track flyTo(z15) + the
// 1 km chaser range ring. The follow-cam ports the exact `isProgrammaticMove`
// guard + `animate:false` setView from the mockup (the fixed self-suspend bug):
// programmatic camera moves flag themselves so genuine user gestures alone suspend
// the follow.
import L from 'leaflet';
import type { EntityEngine, Chaser } from '../entities/entity-engine.js';
import { CHASER_COLOR, RANGE_M } from '../entities/entity-engine.js';
import { store, FOLLOW_SUSPEND } from '../state/store.js';
import type { HudEntity } from '../entities/entity-types.js';

/** Default map center on an empty boot (no live entities yet) — Hanoi, the
 * project's reference operating area (SondeHub Y0322352 / README example). */
const DEFAULT_CENTER: [number, number] = [21.0285, 105.8542];

export class MapController {
  readonly map: L.Map;
  readonly rangeRing: L.Circle;

  constructor(
    private readonly engine: EntityEngine,
    private readonly getSelected: () => HudEntity | undefined,
    private readonly onSelectAndTrack: (id: string) => void,
  ) {
    this.map = L.map('leaflet', {
      center: DEFAULT_CENTER,
      zoom: 13,
      minZoom: 3,
      maxZoom: 19,
      zoomControl: false,
      // Attribution hidden to keep the tactical map uncluttered (operator
      // request). Note: public tile providers' terms generally require
      // attribution — restore this (or credit them elsewhere) before any
      // public-facing deployment.
      attributionControl: false,
      zoomAnimation: true,
      fadeAnimation: true,
    });
    L.control.zoom({ position: 'bottomleft' }).addTo(this.map);

    // Not added to the map yet — no chaser has been fed real data at boot
    // (empty-start: no placeholder ring visible until the viewer's chaser
    // actually arrives). `syncRing` adds/removes it lazily.
    this.rangeRing = L.circle(DEFAULT_CENTER, {
      radius: RANGE_M,
      color: CHASER_COLOR,
      weight: 1,
      opacity: 0.8,
      dashArray: '5 5',
      fill: true,
      fillColor: CHASER_COLOR,
      fillOpacity: 0.05,
      interactive: false,
    });

    this.wireInteraction();
  }

  styleRing(alert: boolean): void {
    this.rangeRing.setStyle(
      alert
        ? { color: '#ff3b30', weight: 2, opacity: 1, dashArray: undefined, fillColor: '#ff3b30', fillOpacity: 0.1 }
        : { color: CHASER_COLOR, weight: 1, opacity: 0.8, dashArray: '5 5', fillColor: CHASER_COLOR, fillOpacity: 0.05 },
    );
  }

  /** Keep the Leaflet ring layer synced with the viewer's own chaser; lazily
   * add it on that chaser's first real position, and remove it when there is
   * no resolved own-chaser (none chosen among several, or it dropped out) so a
   * stale ring never lingers around a teammate's or an old position. */
  syncRing(chaser: Chaser | undefined): void {
    if (!chaser || !chaser.cur) {
      if (this.map.hasLayer(this.rangeRing)) this.map.removeLayer(this.rangeRing);
      return;
    }
    if (!this.map.hasLayer(this.rangeRing)) this.rangeRing.addTo(this.map);
    this.rangeRing.setLatLng([chaser.lat, chaser.lon]);
  }

  /** container-point projection used by every renderer. */
  pt(lat: number, lon: number): L.Point {
    return this.map.latLngToContainerPoint([lat, lon]);
  }

  // ---- click-to-track: fly-to z18, then keep following the target ----
  selectAndTrack(id: string): void {
    store.followChaserId = ''; // selecting a roster target stops chaser-follow
    store.trackLock = true;
    store.lastInteract = 0; // allow immediate follow
    store.camLL = null; // re-sync tracking camera after the fly-to
    const e = this.engine.entities.find((x) => x.id === id);
    if (e && e.cur) {
      store.flyingToTarget = true;
      store.isProgrammaticMove = true;
      this.map.flyTo([e.cur.lat, e.cur.lon], 15, { animate: true, duration: 1.1 });
      store.isProgrammaticMove = false;
      // safety net: if moveend is ever missed, resume follow shortly after the fly.
      clearTimeout(this.flyTimer);
      this.flyTimer = window.setTimeout(() => {
        store.flyingToTarget = false;
        store.lastInteract = 0;
        store.camLL = null;
      }, 1400);
    }
  }
  private flyTimer = 0;

  // ---- follow-cam: recenter on the active target every frame (the fixed bug) ----
  followCam(now: number, dt: number): void {
    if (!store.trackLock) return;
    if (store.flyingToTarget) return; // let the click-to-track flyTo finish
    if (now - store.lastInteract < FOLLOW_SUSPEND) {
      store.camLL = null;
      return;
    } // suspended only by REAL user input
    const target = this.followTarget();
    if (!target) return;

    const p = this.pt(target.lat, target.lon);
    const size = this.map.getSize();
    const offX = p.x - size.x / 2;
    const offY = p.y - size.y / 2;
    const DEAD = 18; // soft dead-zone: ignore micro-jitter near center
    if (Math.hypot(offX, offY) < DEAD && store.camLL) return;

    if (!store.camLL) store.camLL = { lat: this.map.getCenter().lat, lng: this.map.getCenter().lng };
    const k = 1 - Math.exp(-(dt / 1000) / 0.45); // ~0.45 s time-constant → gentle glide
    store.camLL.lat += (target.lat - store.camLL.lat) * k;
    store.camLL.lng += (target.lon - store.camLL.lng) * k;
    // setView WITHOUT Leaflet animation, flagged programmatic so the user-suspend
    // logic ignores the movestart/move/moveend churn this call generates.
    store.isProgrammaticMove = true;
    this.map.setView([store.camLL.lat, store.camLL.lng], this.map.getZoom(), { animate: false });
    store.isProgrammaticMove = false; // events fire synchronously here
  }

  /** The point the follow-cam should stay centered on: a bound chaser (chase
   * mode) takes precedence over the selected roster target. */
  private followTarget(): { lat: number; lon: number } | null {
    if (store.followChaserId) {
      return this.engine.chasers.get(store.followChaserId)?.cur ?? null;
    }
    return this.getSelected()?.cur ?? null;
  }

  /** Click-to-pan onto a chaser. In chase mode it also binds the follow-cam to
   * that chaser (continuous tracking as it moves); in viewer mode it's a one-off
   * pan that holds there. */
  panToChaser(c: Chaser): void {
    if (!c.cur) return;
    const zoom = Math.max(this.map.getZoom(), 15);
    if (store.isChaseMode) {
      store.followChaserId = c.id; // follow-cam now tracks this chaser
      store.selectedId = ''; // not tracking a roster target
      store.trackLock = true;
      store.lastInteract = 0; // allow immediate follow
      store.camLL = null;
      store.flyingToTarget = true;
      store.isProgrammaticMove = true;
      this.map.flyTo([c.cur.lat, c.cur.lon], zoom, { animate: true, duration: 1.0 });
      store.isProgrammaticMove = false;
      clearTimeout(this.flyTimer);
      this.flyTimer = window.setTimeout(() => {
        store.flyingToTarget = false;
        store.lastInteract = 0;
        store.camLL = null;
      }, 1300);
    } else {
      // Viewer mode: pan once and hold (don't continuously chase a chaser).
      this.map.flyTo([c.cur.lat, c.cur.lon], zoom, { animate: true, duration: 1.0 });
      store.lastInteract = performance.now();
      store.camLL = null;
    }
  }

  // Click hit-test over both targets and chasers (whichever marker is nearest
  // the click within ~40px): a target is selected + tracked; a chaser just
  // pans the camera to it.
  private pickAt(clientX: number, clientY: number): boolean {
    const hud = document.getElementById('hud');
    if (!hud) return false;
    const r = hud.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    const HIT_PX2 = 1600; // (40px)^2

    let bestEntity: HudEntity | null = null;
    let bdEntity = HIT_PX2;
    this.engine.entities.forEach((e) => {
      if (!e.cur) return;
      const p = this.pt(e.cur.lat, e.cur.lon);
      const d = (p.x - px) ** 2 + (p.y - py) ** 2;
      if (d < bdEntity) {
        bdEntity = d;
        bestEntity = e;
      }
    });

    let bestChaser: Chaser | null = null;
    let bdChaser = HIT_PX2;
    for (const c of this.engine.chasers.values()) {
      if (!c.cur) continue;
      const p = this.pt(c.cur.lat, c.cur.lon);
      const d = (p.x - px) ** 2 + (p.y - py) ** 2;
      if (d < bdChaser) {
        bdChaser = d;
        bestChaser = c;
      }
    }

    // Nearest wins; ties favor the chaser (its label is what the user clicks).
    if (bestChaser && bdChaser <= bdEntity) {
      this.panToChaser(bestChaser);
      return true;
    }
    if (bestEntity) {
      this.onSelectAndTrack((bestEntity as HudEntity).id);
      return true;
    }
    return false;
  }

  private wireInteraction(): void {
    this.map.on('click', (ev: L.LeafletMouseEvent) => {
      this.pickAt(ev.originalEvent.clientX, ev.originalEvent.clientY);
    });
    // Suspend follow ONLY on genuine user gestures (guarded by isProgrammaticMove).
    const userSuspend = (): void => {
      if (!store.isProgrammaticMove) store.lastInteract = performance.now();
    };
    this.map.on('dragstart', userSuspend);
    this.map.on('wheel', userSuspend);
    const el = this.map.getContainer();
    el.addEventListener('mousedown', userSuspend, { passive: true });
    el.addEventListener('touchstart', userSuspend, { passive: true });
    el.addEventListener('wheel', userSuspend, { passive: true });
    this.map.on('mousemove', (ev: L.LeafletMouseEvent) => {
      const c = document.getElementById('ov-cursor');
      if (c) c.textContent = `${ev.latlng.lat.toFixed(3)} , ${ev.latlng.lng.toFixed(3)}`;
    });
    // Resume follow when the click-to-track flyTo finishes.
    this.map.on('moveend zoomend', () => {
      if (store.flyingToTarget) {
        store.flyingToTarget = false;
        store.lastInteract = 0;
        store.camLL = null;
      }
    });
  }
}
