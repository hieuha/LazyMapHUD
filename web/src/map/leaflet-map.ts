// Leaflet map init + follow-cam (TRACK LOCK) + click-to-track flyTo(z18) + the
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
      attributionControl: true,
      zoomAnimation: true,
      fadeAnimation: true,
    });
    L.control.zoom({ position: 'bottomleft' }).addTo(this.map);

    // Not added to the map yet — no chaser has been fed real data at boot
    // (empty-start: no placeholder ring visible until the webhook-fed chaser
    // or DEMO's scripted chaser actually arrives). `syncRing` adds it lazily.
    const c = engine.chaser;
    this.rangeRing = L.circle([c.lat, c.lon], {
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

  /** Keep the Leaflet ring layer synced with the chaser; lazily add it to the
   * map on the chaser's first real position so an empty/disconnected boot
   * never shows a placeholder ring. */
  syncRing(chaser: Chaser): void {
    if (!chaser.cur) return;
    if (!this.map.hasLayer(this.rangeRing)) this.rangeRing.addTo(this.map);
    this.rangeRing.setLatLng([chaser.lat, chaser.lon]);
  }

  /** container-point projection used by every renderer. */
  pt(lat: number, lon: number): L.Point {
    return this.map.latLngToContainerPoint([lat, lon]);
  }

  // ---- click-to-track: fly-to z18, then keep following the target ----
  selectAndTrack(id: string): void {
    store.trackLock = true;
    store.lastInteract = 0; // allow immediate follow
    store.camLL = null; // re-sync tracking camera after the fly-to
    const e = this.engine.entities.find((x) => x.id === id);
    if (e && e.cur) {
      store.flyingToTarget = true;
      store.isProgrammaticMove = true;
      this.map.flyTo([e.cur.lat, e.cur.lon], 18, { animate: true, duration: 1.1 });
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
    const e = this.getSelected();
    if (!e || !e.cur) return;

    const target = e.cur;
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

  private pickEntity(clientX: number, clientY: number): boolean {
    const hud = document.getElementById('hud');
    if (!hud) return false;
    const r = hud.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    let best: HudEntity | null = null;
    let bd = 1e9;
    this.engine.entities.forEach((e) => {
      if (!e.cur) return;
      const p = this.pt(e.cur.lat, e.cur.lon);
      const dx = p.x - px;
      const dy = p.y - py;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = e;
      }
    });
    if (best && bd < 1600) {
      this.onSelectAndTrack((best as HudEntity).id);
      return true;
    }
    return false;
  }

  private wireInteraction(): void {
    this.map.on('click', (ev: L.LeafletMouseEvent) => {
      this.pickEntity(ev.originalEvent.clientX, ev.originalEvent.clientY);
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
